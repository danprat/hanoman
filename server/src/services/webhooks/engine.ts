import {
  WEBHOOK_BACKOFF_SEC, WEBHOOK_DEFAULT_PER_MINUTE, WEBHOOK_FAIL_LIMIT, WEBHOOK_HISTORY_KEEP,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { normalize, refreshWebhookCache, type EndpointRow } from "./endpoints";
import { sendOnce, type SenderDeps } from "./sender";

// SPEC-481 · ADR-0100 · worker antrean in-process. Bukan message queue (ADR-0024 utuh): tabel
// durable + `setInterval` yang di-start dari `server.ts`, persis pola governor scheduler
// (ADR-0072) dan outbox Telegram (ADR-0096).

const TICK_MS = 2_000;
const MAX_IN_FLIGHT = 4;          // mesin ini juga menanggung sesi agen; jangan rakus
const PRUNE_EVERY_TICKS = 30;

/** Jeda percobaan ke-`attempt` (1-basis) dihitung dari tabel — bukan rumus, agar bisa didokumentasikan. */
export function backoffAt(from: Date, attempt: number): Date {
  const sec = WEBHOOK_BACKOFF_SEC[attempt] ?? WEBHOOK_BACKOFF_SEC[WEBHOOK_BACKOFF_SEC.length - 1]!;
  return new Date(from.getTime() + sec * 1000);
}

// Token bucket per endpoint, in-memory. Batas laju melindungi PENERIMA; kehilangan bucket saat
// restart tak berbahaya (paling banter satu menit lebih longgar).
const buckets = new Map<string, { tokens: number; at: number }>();
export function __resetBuckets(): void { buckets.clear(); }

function takeToken(id: string, perMinute: number, now: number): boolean {
  const cap = Math.max(1, perMinute || WEBHOOK_DEFAULT_PER_MINUTE);
  const b = buckets.get(id) ?? { tokens: cap, at: now };
  const refill = Math.floor((now - b.at) / 60_000) * cap;
  const tokens = Math.min(cap, b.tokens + Math.max(0, refill));
  const at = refill > 0 ? now : b.at;
  if (tokens <= 0) { buckets.set(id, { tokens, at }); return false; }
  buckets.set(id, { tokens: tokens - 1, at });
  return true;
}

async function disable(e: EndpointRow, reason: string): Promise<void> {
  const at = new Date();
  await prisma.webhookEndpoint.update({
    where: { id: e.id }, data: { enabled: false, disabledAt: at, disabledReason: reason },
  });
  // Dedup lewat `key` (pola recordCompletion): satu penonaktifan = paling banyak satu notifikasi.
  // Tipe `webhook` sengaja TIDAK difan-out lagi ke webhook (katalog `skipWhen`).
  await prisma.notification.create({
    data: {
      type: "webhook", key: `webhook-disabled:${e.id}:${at.getTime()}`,
      title: `Webhook "${e.name}" dinonaktifkan otomatis — ${reason}`, projectId: null,
    },
  }).catch(() => { /* P2002: sudah ada */ });
  await refreshWebhookCache();
}

/** Satu putaran antrean. Mengembalikan jumlah pengiriman yang benar-benar DICOBA. */
export async function deliverDue(now: Date, deps: SenderDeps = {}): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { createdAt: "asc" },
    take: MAX_IN_FLIGHT * 5,
  });
  if (!due.length) return 0;

  const ids = [...new Set(due.map((d) => d.endpointId))];
  const rows = await prisma.webhookEndpoint.findMany({ where: { id: { in: ids } } }) as unknown as EndpointRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  let tried = 0;
  for (const d of due) {
    if (tried >= MAX_IN_FLIGHT) break;
    const row = byId.get(d.endpointId);
    if (!row || !row.enabled) continue;              // dinonaktifkan selagi mengantre
    if (!takeToken(row.id, row.maxPerMinute, now.getTime())) continue;

    // Klaim atomis: `updateMany` ber-syarat status supaya dua tick yang tumpang tindih tak
    // mengirim baris yang sama dua kali.
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: d.id, status: "pending" }, data: { status: "sending" },
    });
    if (claimed.count === 0) continue;
    tried++;

    const attempt = d.attempt + 1;
    const body = JSON.stringify(d.payload);
    const res = await sendOnce({
      endpoint: normalize(row), deliveryId: d.id, eventId: d.eventId,
      eventType: d.eventType, attempt, body,
    }, deps);

    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: "sent", attempt, httpStatus: res.httpStatus, durationMs: res.durationMs,
          error: null, sentAt: new Date(),
        },
      });
      await prisma.webhookEndpoint.update({
        where: { id: row.id }, data: { failureStreak: 0, lastSuccessAt: new Date() },
      });
      continue;
    }

    const exhausted = res.gone || attempt >= d.maxAttempts;
    await prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: exhausted ? "failed" : "pending",
        attempt, httpStatus: res.httpStatus, durationMs: res.durationMs, error: res.error,
        nextAttemptAt: exhausted ? null : backoffAt(now, attempt),
      },
    });
    if (!exhausted) continue;

    const streak = row.failureStreak + 1;
    await prisma.webhookEndpoint.update({
      where: { id: row.id }, data: { failureStreak: streak, lastFailureAt: new Date() },
    });
    if (res.gone) await disable(row, "penerima menjawab 410 Gone");
    else if (streak >= WEBHOOK_FAIL_LIMIT) await disable(row, `${streak} pengiriman gagal beruntun`);
  }
  return tried;
}

/**
 * Baris `sending` yang tertinggal crash DIULANG — webhook adalah kontrak at-least-once, dan
 * amplopnya membawa id stabil yang membuat penerima bisa idempoten. Sengaja BERLAWANAN dengan
 * TelegramOutbox (ADR-0096), yang memilih `uncertain` karena di sana kembarannya adalah pesan
 * ganda ke manusia.
 */
export async function resetStuckDeliveries(): Promise<number> {
  const { count } = await prisma.webhookDelivery.updateMany({
    where: { status: "sending" }, data: { status: "pending" },
  });
  return count;
}

/** Simpan N terakhir per endpoint. Baris yang masih mengantre TAK PERNAH dipangkas. */
export async function pruneHistory(): Promise<number> {
  let removed = 0;
  const groups = await prisma.webhookDelivery.groupBy({
    by: ["endpointId"], _count: { _all: true },
  });
  for (const g of groups) {
    if (g._count._all <= WEBHOOK_HISTORY_KEEP) continue;
    const keep = await prisma.webhookDelivery.findMany({
      where: { endpointId: g.endpointId }, orderBy: { createdAt: "desc" },
      take: WEBHOOK_HISTORY_KEEP, select: { id: true },
    });
    const { count } = await prisma.webhookDelivery.deleteMany({
      where: {
        endpointId: g.endpointId,
        status: { in: ["sent", "failed", "dropped"] },
        id: { notIn: keep.map((k) => k.id) },
      },
    });
    removed += count;
  }
  return removed;
}

let timer: NodeJS.Timeout | undefined;
let ticks = 0;
let busy = false;

export async function tick(): Promise<void> {
  if (busy) return;                 // satu putaran bisa memakan detik; jangan menumpuk
  busy = true;
  try {
    await deliverDue(new Date());
    if (++ticks % PRUNE_EVERY_TICKS === 0) await pruneHistory();
  } catch (e) { console.error("webhook engine:", e); }
  finally { busy = false; }
}

/** Dipanggil `server.ts` SAJA (app.ts bebas-timer). unref → tak menahan proses. */
export function startWebhookEngine(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  void resetStuckDeliveries()
    .then((n) => { if (n) console.log(`webhook: ${n} pengiriman tertinggal dikembalikan ke antrean`); })
    .catch((e) => console.error("webhook reset:", e));
}
export function stopWebhookEngine(): void { if (timer) clearInterval(timer); timer = undefined; ticks = 0; }
