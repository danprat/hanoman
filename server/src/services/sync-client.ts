import { prisma } from "../db";
import { pull as _pull, snapshot, upsertLocal, isEntity } from "./sync";
import { listOutbox, clearOutbox } from "./outbox";
import { effectiveStr, effectiveInt } from "../config";

// SPEC-213 · ADR-0043 · sisi CLIENT: instance lokal menyinkron (server-to-server) ke hub.
// Disiplin pull-before-push (AC-18): tarik dulu (server-authoritative), lalu push antre lokal.
// Konflik dibiarkan di outbox untuk pull-rebase manusia (AC-13); tak ada write yang korup (AC-19).

export type Transport = (
  method: "GET" | "POST", path: string, body?: unknown,
) => Promise<{ status: number; body: any }>;

// Kursor pull terakhir (SyncState singleton, LOCAL-only).
export async function getCursor(): Promise<string> {
  const s = await prisma.syncState.findUnique({ where: { id: 1 } });
  return s?.cursor ?? "0";
}
export async function setCursor(cursor: string): Promise<void> {
  await prisma.syncState.upsert({ where: { id: 1 }, create: { id: 1, cursor }, update: { cursor } });
}

// Terapkan satu record dari server ke DB lokal (server-authoritative), tanpa menulis feed/outbox.
export async function applyRemote(entity: string, recordId: string, version: number, data: Record<string, unknown>): Promise<void> {
  if (!isEntity(entity)) return;
  await upsertLocal(entity, recordId, version, data);
}

export type SyncStats = { pulled: number; pushed: number; conflicts: number };

// Satu siklus sync: pull (skip record yang punya edit lokal pending agar tak menimpanya),
// lalu drain outbox dengan baseVersion = versi lokal saat ini.
export async function syncOnce(transport: Transport): Promise<SyncStats> {
  let pulled = 0, pushed = 0, conflicts = 0;

  const cursor = await getCursor();
  const outbox = await listOutbox();
  const pending = new Set(outbox.map((o) => `${o.entity}:${o.recordId}`));

  const pullRes = await transport("GET", `/api/sync/pull?since=${cursor}`);
  const records: { entity: string; recordId: string; version: number; data: Record<string, unknown> }[] = pullRes.body?.records ?? [];
  for (const rec of records) {
    if (pending.has(`${rec.entity}:${rec.recordId}`)) continue; // edit lokal pending — jangan clobber
    await applyRemote(rec.entity, rec.recordId, rec.version, rec.data);
    pulled++;
  }
  if (pullRes.body?.cursor) await setCursor(String(pullRes.body.cursor));

  for (const item of outbox) {
    if (!isEntity(item.entity)) { await clearOutbox(item.entity, item.recordId); continue; }
    const snap = await snapshot(item.entity, item.recordId);
    if (!snap) { await clearOutbox(item.entity, item.recordId); continue; } // record hilang lokal
    const res = await transport("POST", "/api/sync/push", {
      records: [{ entity: item.entity, id: item.recordId, baseVersion: snap.version, data: snap.data }],
    });
    const r = res.body?.results?.[0];
    if (r?.ok) { await clearOutbox(item.entity, item.recordId); pushed++; }
    else if (r?.conflict) { conflicts++; } // biarkan di outbox untuk pull-rebase manusia (AC-13)
  }
  return { pulled, pushed, conflicts };
}

// Transport HTTP nyata ke hub remote (server-to-server): Bearer device token.
export function fetchTransport(base: string, token: string): Transport {
  return async (method, path, body) => {
    const res = await fetch(base.replace(/\/$/, "") + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: any = null;
    try { parsed = await res.json(); } catch { /* body kosong */ }
    return { status: res.status, body: parsed };
  };
}

let timer: NodeJS.Timeout | undefined;
let ws: import("ws").WebSocket | undefined;
let started = false;

// SPEC-215 · status sync client aktif (indikator UI di GET /api/config).
export function syncStatus(): { running: boolean; connected: boolean } {
  return { running: started, connected: ws?.readyState === 1 /* OPEN */ };
}

// Jalankan client sync: syncOnce awal + WS siar (apply + drain saat frame) + reconnect backoff +
// tick fallback berkala (drain outbox yang lahir saat offline). Dipanggil dari server.ts bila
// SYNC_SERVER_URL + SYNC_DEVICE_TOKEN di-set.
export async function startSyncClient(base: string, token: string, tickMs?: number): Promise<void> {
  started = true;
  const transport = fetchTransport(base, token);
  const tick = async () => { try { await syncOnce(transport); } catch { /* offline — coba lagi nanti */ } };

  const connectWs = async () => {
    const { WebSocket } = await import("ws");
    const wsUrl = base.replace(/^http/, "ws").replace(/\/$/, "") + `/api/sync/ws?token=${encodeURIComponent(token)}`;
    ws = new WebSocket(wsUrl);
    ws.on("open", () => { void tick(); });
    ws.on("message", async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.t === "sync" && msg.entity && msg.recordId) {
          await applyRemote(msg.entity, msg.recordId, msg.version, msg.data);
          if (msg.seq) await setCursor(String(msg.seq));
        }
      } catch { /* frame rusak — abaikan */ }
    });
    const reconnect = () => { setTimeout(() => { void connectWs(); }, 3000); };
    ws.on("close", reconnect);
    ws.on("error", () => { try { ws?.close(); } catch { /* noop */ } });
  };

  await tick();               // drain awal + pull awal
  void connectWs();           // realtime
  // Fallback tick: drain outbox yang lahir saat WS putus. Prod 15s; smoke/test bisa turunkan.
  const ms = tickMs && tickMs > 0 ? tickMs : 15_000;
  timer = setInterval(() => { void tick(); }, ms);
  timer.unref?.();
}

export function stopSyncClient(): void {
  started = false;
  if (timer) { clearInterval(timer); timer = undefined; }
  try { ws?.close(); } catch { /* noop */ }
  ws = undefined;
}

// SPEC-215 · re-init live saat config sync berubah. Kosong → hanya stop (jadi HUB murni).
export async function applySyncConfig(): Promise<void> {
  stopSyncClient();
  const base = effectiveStr("SYNC_SERVER_URL");
  const token = effectiveStr("SYNC_DEVICE_TOKEN");
  if (base && token) await startSyncClient(base, token, effectiveInt("SYNC_TICK_MS"));
}
