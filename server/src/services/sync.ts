import { prisma } from "../db";
import { renameProjectCore } from "./rename-project";

// SPEC-213 · ADR-0045 · mesin sync record: version-stamp optimistic concurrency + change-feed
// SyncLog (seq = kursor global). Isi file dokumen TIDAK lewat sini (git 3-way merge, ADR-0043).

export const SYNCED = ["project", "spec", "vps", "sessionResult"] as const;
export type Entity = (typeof SYNCED)[number];

type Delegate = {
  findUnique: (args: { where: { id: string }; select?: Record<string, boolean> }) => Promise<Record<string, unknown> | null>;
  upsert: (args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>;
};
const DELEGATE: Record<Entity, Delegate> = {
  project: prisma.project as unknown as Delegate,
  spec: prisma.spec as unknown as Delegate,
  vps: prisma.vps as unknown as Delegate,
  sessionResult: prisma.sessionResult as unknown as Delegate,
};

// Whitelist field bisnis per entitas — SENGAJA mengecualikan never-sync (Project.repoDir,
// Vps.keyPath) dan kolom lokal (createdAt server, dst). Hanya field di sini yang menyeberang.
const FIELDS: Record<Entity, string[]> = {
  project: ["name", "desc", "kind", "stack", "gitRemote"],
  spec: ["projectId", "title", "source", "stage", "priority", "author", "objective", "payload", "branchFrom", "baseSha", "headSha"],
  vps: ["name", "host", "port", "user", "health", "audit", "hardened", "lastSeenAt", "lastAuditAt"],
  sessionResult: ["projectId", "specId", "oldStage", "newStage", "commitSha", "branch", "prUrl", "status", "deviceId", "author", "createdAt"],
};
// Field yang JSONB-nya string ISO tapi kolomnya DateTime — dikonversi balik saat menulis.
const DATE_FIELDS: Record<Entity, string[]> = {
  project: [], spec: [], vps: ["lastSeenAt", "lastAuditAt"], sessionResult: ["createdAt"],
};

export function isEntity(e: string): e is Entity {
  return (SYNCED as readonly string[]).includes(e);
}

// Objek JSON-bersih: Date → ISO string, null tetap null. Cocok untuk kolom JSONB SyncLog + wire.
function jsonSafe<T>(v: T): unknown {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

// Ambil field whitelist dari `data` klien, konversi field tanggal ISO→Date untuk Prisma.
function coerce(entity: Entity, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[entity]) {
    if (!(f in data)) continue;
    let v = data[f];
    if (DATE_FIELDS[entity].includes(f) && typeof v === "string") v = new Date(v);
    out[f] = v;
  }
  return out;
}

export type Snapshot = { version: number; data: Record<string, unknown> };

export async function snapshot(entity: Entity, id: string): Promise<Snapshot | null> {
  const row = await DELEGATE[entity].findUnique({ where: { id } });
  if (!row) return null;
  const data: Record<string, unknown> = {};
  for (const f of FIELDS[entity]) data[f] = jsonSafe(row[f]);
  return { version: Number(row.version), data };
}

export type PushResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; server: Snapshot | null };

// Terapkan satu push ber-optimistic-concurrency. Insert (id absen) selalu diterima → version 1.
// Update diterima hanya bila baseVersion === version server; else konflik (server tak ditimpa).
export async function applyPush(
  entity: Entity, id: string, baseVersion: number, data: Record<string, unknown>, deviceId?: string,
): Promise<PushResult> {
  // SPEC-255 · ADR-0064 · operasi rename project via penanda kontrol data.renamedFrom (bukan kolom;
  // coerce() mengabaikannya). Rename struktural → lewati optimistic-concurrency biasa.
  if (entity === "project" && typeof data.renamedFrom === "string" && data.renamedFrom && data.renamedFrom !== id) {
    const oldId = data.renamedFrom;
    const already = await DELEGATE.project.findUnique({ where: { id }, select: { version: true } });
    if (already) return { ok: true, version: Number(already.version) }; // sudah diterapkan (idempoten)
    const old = await DELEGATE.project.findUnique({ where: { id: oldId }, select: { version: true } });
    if (old) {
      const newVersion = Number(old.version) + 1;
      await prisma.$transaction(async (tx) => {
        await renameProjectCore(tx, oldId, id);
        const writeData = coerce("project", data);
        await tx.project.update({ where: { id }, data: { ...writeData, version: newVersion, updatedAt: new Date() } });
      });
      const snap = await snapshot("project", id);
      const logData = { ...(snap?.data ?? {}), renamedFrom: oldId }; // penerima ikut rename
      const log = await prisma.syncLog.create({
        data: { entity: "project", recordId: id, version: newVersion, data: logData as object, deviceId: deviceId ?? null },
      });
      onAccepted?.({ entity: "project", recordId: id, version: newVersion, data: logData, seq: String(log.seq) });
      return { ok: true, version: newVersion };
    }
    // oldId tak ada → fall-through ke insert normal di bawah (konvergensi).
  }
  const existing = await DELEGATE[entity].findUnique({ where: { id }, select: { version: true } });
  if (existing && Number(existing.version) !== baseVersion) {
    return { ok: false, conflict: true, server: await snapshot(entity, id) };
  }
  const newVersion = existing ? Number(existing.version) + 1 : 1;
  const writeData = coerce(entity, data);
  await DELEGATE[entity].upsert({
    where: { id },
    create: { id, ...writeData, version: newVersion, updatedAt: new Date() },
    update: { ...writeData, version: newVersion, updatedAt: new Date() },
  });
  const snap = await snapshot(entity, id);
  const log = await prisma.syncLog.create({
    data: { entity, recordId: id, version: newVersion, data: (snap?.data ?? {}) as object, deviceId: deviceId ?? null },
  });
  onAccepted?.({ entity, recordId: id, version: newVersion, data: snap?.data ?? {}, seq: String(log.seq) });
  return { ok: true, version: newVersion };
}

export type PulledRecord = { entity: string; recordId: string; version: number; data: unknown };

export async function pull(sinceCursor: string, limit = 500): Promise<{ cursor: string; records: PulledRecord[] }> {
  const since = BigInt(sinceCursor || "0");
  const rows = await prisma.syncLog.findMany({
    where: { seq: { gt: since } }, orderBy: { seq: "asc" }, take: limit,
  });
  const cursor = rows.length ? String(rows[rows.length - 1]!.seq) : sinceCursor || "0";
  return {
    cursor,
    records: rows.map((r) => ({ entity: r.entity, recordId: r.recordId, version: r.version, data: r.data })),
  };
}

// Terapkan record dari server ke DB LOKAL (server-authoritative): set version/data apa adanya,
// TANPA menulis SyncLog/outbox (bukan write lokal). Dipakai sync-client saat pull/WS (Fase 4).
export async function upsertLocal(entity: Entity, id: string, version: number, data: Record<string, unknown>): Promise<void> {
  // SPEC-255 · ADR-0064 · penerima rename: bila renamedFrom di-set & row lama ada (row baru belum),
  // rename in-place (bukan insert row baru yang meninggalkan yatim). Else upsert biasa.
  if (entity === "project" && typeof data.renamedFrom === "string" && data.renamedFrom && data.renamedFrom !== id) {
    const oldId = data.renamedFrom;
    const exists = await DELEGATE.project.findUnique({ where: { id }, select: { version: true } });
    const old = exists ? null : await DELEGATE.project.findUnique({ where: { id: oldId }, select: { version: true } });
    if (!exists && old) {
      const writeData = coerce("project", data);
      await prisma.$transaction(async (tx) => {
        await renameProjectCore(tx, oldId, id);
        await tx.project.update({ where: { id }, data: { ...writeData, version, updatedAt: new Date() } });
      });
      return;
    }
    // else: fall-through ke upsert biasa (row baru sudah ada, atau tak ada oldId → insert).
  }
  const writeData = coerce(entity, data);
  await DELEGATE[entity].upsert({
    where: { id },
    create: { id, ...writeData, version, updatedAt: new Date() },
    update: { ...writeData, version, updatedAt: new Date() },
  });
}

// Hook siar changefeed (di-set oleh sync-hub, Fase 4). Nol dependency di service ini.
export type AcceptedHook = (row: { entity: string; recordId: string; version: number; data: unknown; seq: string }) => void;
let onAccepted: AcceptedHook | undefined;
export function setAcceptedHook(hook: AcceptedHook | undefined): void { onAccepted = hook; }
