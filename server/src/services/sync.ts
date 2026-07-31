import { prisma } from "../db";
import { renameProjectCore } from "./rename-project";

// SPEC-213 · ADR-0045 · mesin sync record: version-stamp optimistic concurrency + change-feed
// SyncLog (seq = kursor global). Isi file dokumen TIDAK lewat sini (git 3-way merge, ADR-0043).

// SPEC-268 · ADR-0066 · errorGroup & ticket masuk record-sync (agregat grup / metadata tiket).
export const SYNCED = ["project", "spec", "vps", "sessionResult", "errorGroup", "ticket", "ticketAttachment"] as const;
export type Entity = (typeof SYNCED)[number];

type Delegate = {
  findUnique: (args: { where: { id: string }; select?: Record<string, boolean> }) => Promise<Record<string, unknown> | null>;
  upsert: (args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};
const DELEGATE: Record<Entity, Delegate> = {
  project: prisma.project as unknown as Delegate,
  spec: prisma.spec as unknown as Delegate,
  vps: prisma.vps as unknown as Delegate,
  sessionResult: prisma.sessionResult as unknown as Delegate,
  errorGroup: prisma.errorGroup as unknown as Delegate,
  ticket: prisma.ticket as unknown as Delegate,
  ticketAttachment: prisma.ticketAttachment as unknown as Delegate,
};

// Whitelist field bisnis per entitas — SENGAJA mengecualikan never-sync (Project.repoDir,
// Vps.keyPath) dan kolom lokal (createdAt server, dst). Hanya field di sini yang menyeberang.
// SPEC-270 · ADR-0067 · `updatedAt` ikut menyeberang sebagai jam LWW (default modal rekonsil).
const FIELDS: Record<Entity, string[]> = {
  project: ["name", "desc", "kind", "stack", "gitRemote", "updatedAt"],
  // SPEC-408 · ADR-0090 · createdAt/startedAt ikut menyeberang — sejajar baseSha/headSha. Tanpa
  // ini spec asal-hub mendapat createdAt lokal palsu di tiap client (kolom NOT NULL ber-default).
  spec: ["projectId", "title", "source", "stage", "priority", "author", "objective", "payload", "branchFrom", "baseSha", "headSha", "createdAt", "startedAt", "updatedAt"],
  vps: ["name", "host", "port", "user", "health", "audit", "hardened", "lastSeenAt", "lastAuditAt", "updatedAt"],
  sessionResult: ["projectId", "specId", "oldStage", "newStage", "commitSha", "branch", "prUrl", "status", "deviceId", "author", "createdAt", "updatedAt"],
  // SPEC-268 · ADR-0066 · agregat grup error (ErrorEvent mentah tak disync).
  errorGroup: ["projectId", "fingerprint", "type", "message", "sampleStack", "environment", "status", "count", "firstSeenAt", "lastSeenAt", "specId", "updatedAt"],
  // SPEC-268 · ADR-0066 · metadata tiket (lampiran biner tak disync). accessKeyHash wajib
  // (kolom required @unique tanpa default); kunci plaintext tak pernah menyeberang.
  ticket: ["projectId", "number", "category", "title", "detail", "reporterEmail", "status", "accessKeyHash", "specId", "createdAt", "updatedAt"],
  // SPEC-272 · ADR-0068 · metadata lampiran (byte tak disync; ditarik lazy dari hub saat dibuka).
  ticketAttachment: ["ticketId", "projectId", "filename", "mimeType", "size", "storageKey", "createdAt", "updatedAt"],
};
// Field yang JSONB-nya string ISO tapi kolomnya DateTime — dikonversi balik saat menulis.
const DATE_FIELDS: Record<Entity, string[]> = {
  project: ["updatedAt"], spec: ["createdAt", "startedAt", "updatedAt"], vps: ["lastSeenAt", "lastAuditAt", "updatedAt"],
  sessionResult: ["createdAt", "updatedAt"],
  errorGroup: ["firstSeenAt", "lastSeenAt", "updatedAt"], ticket: ["createdAt", "updatedAt"],
  ticketAttachment: ["createdAt", "updatedAt"],
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
  // SPEC-270 · pertahankan updatedAt asal (jam LWW) bila dikirim; else stempel now.
  const stamp = (writeData.updatedAt as Date | undefined) ?? new Date();
  await DELEGATE[entity].upsert({
    where: { id },
    create: { id, ...writeData, version: newVersion, updatedAt: stamp },
    update: { ...writeData, version: newVersion, updatedAt: stamp },
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
  // SPEC-398 · ADR-0086 · `SyncLog.seq` kini `Int` (SQLite hanya meng-auto-isi alias rowid ber-tipe
  // deklarasi tepat `INTEGER`). Kursor tetap STRING di wire — jangan ubah bentuk itu.
  const since = Number(sinceCursor || "0");
  const rows = await prisma.syncLog.findMany({
    where: { seq: { gt: since } }, orderBy: { seq: "asc" }, take: limit,
  });
  const cursor = rows.length ? String(rows[rows.length - 1]!.seq) : sinceCursor || "0";
  return {
    cursor,
    records: rows.map((r) => ({ entity: r.entity, recordId: r.recordId, version: r.version, data: r.data })),
  };
}

// SPEC-268 · ADR-0066 · publish write LOKAL-asal ke change-feed (SyncLog) + siar. Melengkapi
// applyPush (yang menangani write asal client-push): membuat write asal-hub (ingest error, tiket
// Help) menjadi bagian feed yang bisa di-pull client. Menaikkan version → optimistic-concurrency
// tetap konsisten. Dipakai lewat notifySynced() (peran hub).
export async function publishLocal(entity: Entity, id: string): Promise<void> {
  const snap = await snapshot(entity, id);
  if (!snap) return;
  const newVersion = snap.version + 1;
  await DELEGATE[entity].update({ where: { id }, data: { version: newVersion } });
  const log = await prisma.syncLog.create({
    data: { entity, recordId: id, version: newVersion, data: (snap.data ?? {}) as object, deviceId: null },
  });
  onAccepted?.({ entity, recordId: id, version: newVersion, data: snap.data ?? {}, seq: String(log.seq) });
}

// SPEC-270 · ADR-0067 · reconciler boot HUB: publish tiap row SYNCED yang belum terwakili di
// feed pada version terkininya (mencakup semua version=0 pra-entitas-tersync). Idempoten:
// row yang sudah punya SyncLog untuk version-nya dilewati. Kembalikan jumlah yang dipublish.
export async function backfillFeed(): Promise<number> {
  let published = 0;
  for (const entity of SYNCED) {
    const rows = await (DELEGATE[entity] as unknown as {
      findMany: (a: { select: { id: true; version: true } }) => Promise<{ id: string; version: number }[]>;
    }).findMany({ select: { id: true, version: true } });
    for (const row of rows) {
      const has = await prisma.syncLog.findFirst({
        where: { entity, recordId: row.id, version: Number(row.version) }, select: { seq: true },
      });
      if (has) continue;
      await publishLocal(entity, row.id);
      published++;
    }
  }
  return published;
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
  // SPEC-270 · pertahankan updatedAt asal (jam LWW) bila dikirim; else stempel now.
  const stamp = (writeData.updatedAt as Date | undefined) ?? new Date();
  await DELEGATE[entity].upsert({
    where: { id },
    create: { id, ...writeData, version, updatedAt: stamp },
    update: { ...writeData, version, updatedAt: stamp },
  });
}

// Hook siar changefeed (di-set oleh sync-hub, Fase 4). Nol dependency di service ini.
export type AcceptedHook = (row: { entity: string; recordId: string; version: number; data: unknown; seq: string }) => void;
let onAccepted: AcceptedHook | undefined;
export function setAcceptedHook(hook: AcceptedHook | undefined): void { onAccepted = hook; }
