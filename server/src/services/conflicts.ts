import { prisma } from "../db";
import { upsertLocal, isEntity } from "./sync";
import { clearOutbox } from "./outbox";

// SPEC-270 · ADR-0067 · store konflik dua-sisi (LOCAL-only) + resolusi manusia.
type Side = { version: number; data: Record<string, unknown> };
export type ConflictView = {
  entity: string; recordId: string;
  localData: unknown; localVersion: number; localUpdatedAt: string;
  serverData: unknown; serverVersion: number; serverUpdatedAt: string; detectedAt: string;
};
type PushFn = (records: unknown[]) => Promise<{ results: { ok?: boolean; version?: number; conflict?: boolean }[] }>;

function stamp(d: Record<string, unknown>): Date {
  const v = d.updatedAt;
  return typeof v === "string" ? new Date(v) : new Date(0);
}

// Catat/segarkan konflik (idempoten per entity+recordId).
export async function recordConflict(entity: string, recordId: string, local: Side, server: Side): Promise<void> {
  const row = {
    entity, recordId,
    localData: local.data as object, localVersion: local.version, localUpdatedAt: stamp(local.data),
    serverData: server.data as object, serverVersion: server.version, serverUpdatedAt: stamp(server.data),
    resolvedAt: null,
  };
  await prisma.syncConflict.upsert({
    where: { entity_recordId: { entity, recordId } },
    create: row, update: { ...row, detectedAt: new Date() },
  });
}

export async function listConflicts(): Promise<ConflictView[]> {
  const rows = await prisma.syncConflict.findMany({ where: { resolvedAt: null }, orderBy: { detectedAt: "asc" } });
  return rows.map((r) => ({
    entity: r.entity, recordId: r.recordId,
    localData: r.localData, localVersion: r.localVersion, localUpdatedAt: r.localUpdatedAt.toISOString(),
    serverData: r.serverData, serverVersion: r.serverVersion, serverUpdatedAt: r.serverUpdatedAt.toISOString(),
    detectedAt: r.detectedAt.toISOString(),
  }));
}

// Selesaikan satu konflik. `local` → force-push data lokal ke hub (baseVersion = versi server yang
// tercatat). `server` → adopsi data server ke DB lokal. `push` disuntik (transport hub) agar teruji.
export async function resolveConflict(
  entity: string, recordId: string, choice: "local" | "server", push: PushFn,
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "still-conflict" }> {
  if (!isEntity(entity)) return { ok: false, reason: "not-found" };
  const c = await prisma.syncConflict.findUnique({ where: { entity_recordId: { entity, recordId } } });
  if (!c || c.resolvedAt) return { ok: false, reason: "not-found" };

  if (choice === "server") {
    await upsertLocal(entity, recordId, c.serverVersion, c.serverData as Record<string, unknown>);
  } else {
    const res = await push([{ entity, id: recordId, baseVersion: c.serverVersion, data: c.localData }]);
    const r = res.results?.[0];
    if (!r?.ok) {
      if (r?.conflict) return { ok: false, reason: "still-conflict" }; // hub bergeser lagi
      return { ok: false, reason: "not-found" };
    }
  }
  await prisma.syncConflict.update({
    where: { entity_recordId: { entity, recordId } }, data: { resolvedAt: new Date() },
  });
  await clearOutbox(entity, recordId);
  return { ok: true };
}
