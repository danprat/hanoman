// SPEC-249 · ADR-0060 · pemrosesan ingest error: caps → rate-limit → upsert grup → event → retensi
// → notif grup produksi baru. Server-local, single-process (patuh "tanpa queue/Redis", ADR-0024).
import { prisma } from "../db";
import { fingerprint } from "./error-fingerprint";
import { recordNewErrorGroup } from "./notifications";
import { notifySynced } from "./sync-notify";
import { effectiveInt } from "../config";
import type { IngestPayload } from "@hanoman/shared";

const MSG_CAP = 2_000;
const STACK_CAP = 16_000;
const EVENTS_PER_GROUP = () => effectiveInt("HANOMAN_ERROR_EVENTS_PER_GROUP") ?? 50;
const RETENTION_DAYS = () => effectiveInt("HANOMAN_ERROR_RETENTION_DAYS") ?? 30;
const RATE_PER_MIN = () => effectiveInt("HANOMAN_INGEST_RATE_PER_MIN") ?? 120;

// Token-bucket in-memory per project. Single-process — refill kontinu, tak menyimpan riwayat.
const buckets = new Map<string, { tokens: number; ts: number }>();
export function rateLimitOk(projectId: string, now = Date.now()): boolean {
  const cap = RATE_PER_MIN();
  const refillPerMs = cap / 60_000;
  const b = buckets.get(projectId) ?? { tokens: cap, ts: now };
  b.tokens = Math.min(cap, b.tokens + (now - b.ts) * refillPerMs);
  b.ts = now;
  buckets.set(projectId, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
export function __resetBuckets(): void { buckets.clear(); } // test-only

export async function ingestError(
  projectId: string, projectName: string, payload: IngestPayload,
): Promise<{ groupId: string; new: boolean }> {
  const type = payload.type.slice(0, 500);
  const message = payload.message.slice(0, MSG_CAP);
  const stack = payload.stack ? payload.stack.slice(0, STACK_CAP) : null;
  const environment = (payload.environment || "unknown").slice(0, 120);
  const frames = payload.frames;   // SPEC-276 · frame terstruktur (opsional)
  const fp = fingerprint(type, message, stack ?? undefined, frames);
  const key = { projectId_fingerprint: { projectId, fingerprint: fp } };

  let groupId: string;
  let isNew = false;
  const existing = await prisma.errorGroup.findUnique({ where: key });
  if (existing) {
    await prisma.errorGroup.update({
      where: { id: existing.id },
      data: { count: { increment: 1 }, lastSeenAt: new Date(), environment, updatedAt: new Date(), release: payload.release ?? undefined },
    });
    groupId = existing.id;
  } else {
    try {
      const g = await prisma.errorGroup.create({
        data: {
          projectId, fingerprint: fp, type, message, sampleStack: stack, environment, count: 1,
          sampleFrames: (frames ?? undefined) as object | undefined,   // SPEC-276 · frame sample (disymbolikasi saat display)
          release: payload.release ?? null,                            // SPEC-276 · korelasi build
        },
      });
      groupId = g.id;
      isNew = true;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      // Balapan: dua ingest grup baru sama. Grup sudah dibuat oleh yang lain (+ sudah notif jika
      // perlu). Event kita tetap kejadian tambahan → increment, tapi BUKAN "baru" dari sisi kita.
      const g = await prisma.errorGroup.update({
        where: key, data: { count: { increment: 1 }, lastSeenAt: new Date(), environment, updatedAt: new Date() },
      });
      groupId = g.id;
    }
  }

  if (isNew && environment === "production")
    await recordNewErrorGroup(groupId, projectId, projectName, type, message);

  await prisma.errorEvent.create({
    data: {
      groupId, projectId, type, message, stack, environment,
      frames: (frames ?? undefined) as object | undefined,   // SPEC-276 · frame terstruktur mentah
      release: payload.release ?? null,
      context: (payload.context ?? undefined) as object | undefined,
    },
  });
  await pruneGroup(groupId);
  // SPEC-268 · ADR-0066 · grup BARU → change-feed (bukan tiap increment count, hindari churn/bloat).
  if (isNew) await notifySynced("errorGroup", groupId);
  return { groupId, new: isNew };
}

// Retensi opportunistic-on-write: buang event lebih tua dari retensi + sisakan cap terakhir.
// Ringkasan grup (count/first/last) tetap. Tanpa scheduler global (kerja latar minimal).
async function pruneGroup(groupId: string): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS() * 86_400_000);
  await prisma.errorEvent.deleteMany({ where: { groupId, receivedAt: { lt: cutoff } } });
  const cap = EVENTS_PER_GROUP();
  const keep = await prisma.errorEvent.findMany({
    where: { groupId }, orderBy: { receivedAt: "desc" }, take: cap, select: { id: true },
  });
  if (keep.length >= cap)
    await prisma.errorEvent.deleteMany({ where: { groupId, id: { notIn: keep.map((k) => k.id) } } });
}
