# Sync Self-Healing + Rekonsil Konflik Manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Bikin sync antar-instance hanoman self-healing — tiap row masuk feed (backfill), divergensi sepihak auto-apply, divergensi dua-sisi mendarat di antrean konflik yang diselesaikan manusia lewat modal side-by-side (default LWW pada `updatedAt`).

**Architecture:** Tambah kolom `updatedAt`-tepercaya (`@updatedAt`) yang ikut menyeberang sebagai jam LWW. `syncOnce` (client) mengklasifikasi tiap divergensi: non-konflik → auto-apply; konflik sejati → tulis ke tabel `SyncConflict` (LOCAL-only). Endpoint cookie-authed + modal React menyelesaikan konflik per-record. Reconciler `backfillFeed()` saat boot hub mem-`publishLocal` row yang belum ter-feed.

**Tech Stack:** Node+TS (Fastify), Prisma/Postgres, React+TS (Vite), vitest.

## Global Constraints

- TypeScript strict; test tiap logika orkestrasi sync.
- Jangan ubah skema tanpa migration + ADR (ADR-0067 di task terakhir).
- Migration = tulis tangan `migration.sql` + `migrate deploy` per DB (dev `hanoman`, test `hanoman_test`) — `migrate dev` bisa reset karena drift antar-worktree.
- Jalankan test dengan guard env sesi prod: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test`.
- Entitas SYNCED = `["project","spec","vps","sessionResult","errorGroup","ticket"]` (`server/src/services/sync.ts:8`).
- Best-effort: pencatatan konflik/outbox tak boleh menggagalkan write utama.
- DS: editorial, bone paper, brass accent; modal di atas `Modal` (`src/src/ds/kit`), pola seperti `ConfirmDialog` (SPEC-269).
- Nomor: SPEC-270, ADR-0067.

---

### Task 1: Migration & schema — tabel `SyncConflict` + `updatedAt @updatedAt`

**Files:**
- Modify: `server/prisma/schema.prisma` (6 model `updatedAt`; tambah model `SyncConflict`)
- Create: `server/prisma/migrations/2026072102_spec270_sync_conflict/migration.sql`

**Interfaces:**
- Produces: model Prisma `SyncConflict` (delegate `prisma.syncConflict`); perilaku `@updatedAt` pada `Project/Spec/Vps/SessionResult/ErrorGroup/Ticket`.

- [x] **Step 1: Ubah `updatedAt` 6 model synced ke `@updatedAt`**

Di `server/prisma/schema.prisma`, ganti pada model `Project`, `Spec`, `Vps`, `SessionResult`, `ErrorGroup`, `Ticket` baris:
`updatedAt DateTime @default(now())` → `updatedAt DateTime @updatedAt`
(Jangan sentuh `updatedAt` pada model LOCAL-only `RuntimeConfig` yang sudah `@updatedAt`, dan jangan sentuh `createdAt`.)

- [x] **Step 2: Tambah model `SyncConflict` (LOCAL-only)**

Tambahkan setelah model `SyncState` di `schema.prisma`:

```prisma
// SPEC-270 · ADR-0067 · LOCAL-ONLY: antrean konflik dua-sisi menunggu keputusan manusia (modal).
model SyncConflict {
  id              String    @id @default(cuid())
  entity          String
  recordId        String
  localData       Json
  localVersion    Int
  localUpdatedAt  DateTime
  serverData      Json
  serverVersion   Int
  serverUpdatedAt DateTime
  detectedAt      DateTime  @default(now())
  resolvedAt      DateTime?

  @@unique([entity, recordId])
}
```

- [x] **Step 3: Tulis migration.sql**

Buat `server/prisma/migrations/2026072102_spec270_sync_conflict/migration.sql`:

```sql
-- SPEC-270 · ADR-0067 · antrean konflik rekonsil (LOCAL-only) + updatedAt @updatedAt
CREATE TABLE "SyncConflict" (
  "id" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "localData" JSONB NOT NULL,
  "localVersion" INTEGER NOT NULL,
  "localUpdatedAt" TIMESTAMP(3) NOT NULL,
  "serverData" JSONB NOT NULL,
  "serverVersion" INTEGER NOT NULL,
  "serverUpdatedAt" TIMESTAMP(3) NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncConflict_entity_recordId_key" ON "SyncConflict"("entity", "recordId");

-- @updatedAt = perilaku klien Prisma; lepas DEFAULT DB agar tak drift dari schema.
ALTER TABLE "Project"       ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Spec"          ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Vps"           ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "SessionResult" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ErrorGroup"    ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Ticket"        ALTER COLUMN "updatedAt" DROP DEFAULT;
```

- [x] **Step 4: Terapkan migration ke DB dev + test, generate client**

Run:
```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman'      pnpm --filter ./server exec prisma migrate deploy
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman_test' pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server exec prisma generate
```
Expected: kedua `migrate deploy` melaporkan migration `2026072102_spec270_sync_conflict` applied; `generate` sukses.
(Password DB: pakai nilai asli dari `.env` bila beda dari `hanoman`.)

- [x] **Step 5: Verifikasi tabel & delegate ada**

Run:
```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman_test -c '\d "SyncConflict"'
node -e 'const{PrismaClient}=require("./server/node_modules/@prisma/client");new PrismaClient().syncConflict.count().then(n=>{console.log("syncConflict ok",n);process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})'
```
Expected: deskripsi tabel tampil; script cetak `syncConflict ok 0`.

- [x] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/2026072102_spec270_sync_conflict
git commit -m "feat(spec-270): tabel SyncConflict + updatedAt @updatedAt (migration, ADR-0067)"
```

---

### Task 2: `updatedAt` ikut menyeberang + terjaga saat apply

**Files:**
- Modify: `server/src/services/sync.ts` (`FIELDS`, `DATE_FIELDS`, `applyPush`, `upsertLocal`)
- Test: `server/test/sync.service.test.ts`

**Interfaces:**
- Consumes: `SYNCED`, `snapshot()`, `applyPush()`, `upsertLocal()` (sudah ada).
- Produces: `snapshot()` kini menyertakan `updatedAt` (ISO string) di `data`; `applyPush`/`upsertLocal` menulis `updatedAt` dari `data` (bukan `new Date()`) bila ada.

- [x] **Step 1: Tulis test gagal — snapshot menyertakan updatedAt & apply menjaga asal**

Tambah di `server/test/sync.service.test.ts` (ikuti gaya import/clean file itu):

```ts
it("SPEC-270: snapshot menyertakan updatedAt & applyPush menjaga updatedAt asal", async () => {
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
  const origin = new Date("2020-01-02T03:04:05.000Z");
  const snap = { projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang",
    author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null, headSha: null,
    updatedAt: origin.toISOString() };
  const r = await applyPush("spec", "SPEC-1", 0, snap);
  expect(r.ok).toBe(true);
  const row = await prisma.spec.findUnique({ where: { id: "SPEC-1" } });
  expect(row!.updatedAt.toISOString()).toBe(origin.toISOString());
  const s = await snapshot("spec", "SPEC-1");
  expect(s!.data.updatedAt).toBe(origin.toISOString());
});
```

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- sync.service`
Expected: FAIL (`updatedAt` bukan origin; `s.data.updatedAt` undefined).

- [x] **Step 3: Tambah `updatedAt` ke FIELDS & DATE_FIELDS**

Di `server/src/services/sync.ts`, dalam `const FIELDS`, tambahkan `"updatedAt"` di akhir array tiap entitas (`project`, `spec`, `vps`, `sessionResult`, `errorGroup`, `ticket`). Dalam `const DATE_FIELDS`, tambahkan `"updatedAt"` ke tiap array (mis. `project: ["updatedAt"]`, `spec: ["updatedAt"]`, `vps: ["lastSeenAt","lastAuditAt","updatedAt"]`, `sessionResult: ["createdAt","updatedAt"]`, `errorGroup: ["firstSeenAt","lastSeenAt","updatedAt"]`, `ticket: ["createdAt","updatedAt"]`).

- [x] **Step 4: Jaga updatedAt asal saat apply**

Di `applyPush` (upsert sekitar baris 114-118) dan `upsertLocal` (upsert sekitar baris 176-180), `writeData` kini sudah memuat `updatedAt` (dari coerce). Ubah agar TIDAK menimpanya: ganti `updatedAt: new Date()` pada `create`/`update` menjadi memakai nilai dari writeData bila ada, else now:

Di `applyPush`:
```ts
  const writeData = coerce(entity, data);
  const stamp = (writeData.updatedAt as Date | undefined) ?? new Date();
  await DELEGATE[entity].upsert({
    where: { id },
    create: { id, ...writeData, version: newVersion, updatedAt: stamp },
    update: { ...writeData, version: newVersion, updatedAt: stamp },
  });
```
Di `upsertLocal` (blok upsert non-rename di akhir):
```ts
  const writeData = coerce(entity, data);
  const stamp = (writeData.updatedAt as Date | undefined) ?? new Date();
  await DELEGATE[entity].upsert({
    where: { id },
    create: { id, ...writeData, version, updatedAt: stamp },
    update: { ...writeData, version, updatedAt: stamp },
  });
```
(Blok rename `project` di kedua fungsi biarkan pakai `new Date()` — rename struktural, bukan LWW.)

- [x] **Step 5: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- sync.service`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/services/sync.ts server/test/sync.service.test.ts
git commit -m "feat(spec-270): updatedAt ikut wire & terjaga saat apply (jam LWW)"
```

---

### Task 3: `backfillFeed()` + panggil saat boot hub

**Files:**
- Modify: `server/src/services/sync.ts` (fungsi baru `backfillFeed`)
- Modify: `server/src/services/config-apply.ts` (`applyConfigOnBoot` panggil backfill bila hub)
- Test: `server/test/sync.service.test.ts`

**Interfaces:**
- Consumes: `SYNCED`, `DELEGATE`, `snapshot`, `publishLocal`, `prisma.syncLog`.
- Produces: `export async function backfillFeed(): Promise<number>` — jumlah row yang di-publish.

- [x] **Step 1: Tulis test gagal — row tanpa feed dipublish sekali (idempoten)**

Tambah di `server/test/sync.service.test.ts`:

```ts
it("SPEC-270: backfillFeed mempublish row yang belum ter-feed, idempoten", async () => {
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
  // errorGroup v0 tanpa feed (cermin row pra-SPEC-268)
  await prisma.errorGroup.create({ data: { id: "g1", projectId: "p1", fingerprint: "fp", type: "E",
    message: "m", environment: "prod" } });
  const n1 = await backfillFeed();
  expect(n1).toBeGreaterThanOrEqual(1);
  const feed1 = (await pull("0")).records.filter((r) => r.recordId === "g1");
  expect(feed1).toHaveLength(1);
  const n2 = await backfillFeed();               // run kedua: tak ada yang baru
  const feed2 = (await pull("0")).records.filter((r) => r.recordId === "g1");
  expect(feed2).toHaveLength(1);                 // tak menduplikasi
  expect(n2).toBe(0);
});
```
Tambahkan `backfillFeed` ke import dari `../src/services/sync`.

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- sync.service`
Expected: FAIL (`backfillFeed` belum ada).

- [x] **Step 3: Implementasi `backfillFeed`**

Tambahkan di `server/src/services/sync.ts` (setelah `publishLocal`):

```ts
// SPEC-270 · ADR-0067 · reconciler boot HUB: publish tiap row SYNCED yang belum terwakili di
// feed pada version terkininya (mencakup semua version=0 pra-entitas-tersync). Idempoten:
// row yang sudah punya SyncLog untuk version-nya dilewati. Kembalikan jumlah yang dipublish.
export async function backfillFeed(): Promise<number> {
  let published = 0;
  for (const entity of SYNCED) {
    const rows = (await (DELEGATE[entity] as unknown as {
      findMany: (a: { select: { id: true; version: true } }) => Promise<{ id: string; version: number }[]>;
    }).findMany({ select: { id: true, version: true } }));
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
```

- [x] **Step 4: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- sync.service`
Expected: PASS.

- [x] **Step 5: Panggil backfill saat boot bila peran HUB**

Di `server/src/services/config-apply.ts`, dalam `applyConfigOnBoot`, setelah `await applySyncConfig();` tambahkan:

```ts
  // SPEC-270 · ADR-0067 · reconciler feed hanya bila peran HUB (tak ada SYNC_SERVER_URL).
  const { effectiveStr } = await import("../config");
  if (!effectiveStr("SYNC_SERVER_URL")) {
    const { backfillFeed } = await import("./sync");
    try { const n = await backfillFeed(); if (n) console.log(`sync backfill: ${n} record ke feed`); }
    catch (e) { console.error("sync backfill gagal:", e); }
  }
```

- [x] **Step 6: Commit**

```bash
git add server/src/services/sync.ts server/src/services/config-apply.ts server/test/sync.service.test.ts
git commit -m "feat(spec-270): backfillFeed idempoten + panggil saat boot hub"
```

---

### Task 4: Service store konflik (`conflicts.ts`)

**Files:**
- Create: `server/src/services/conflicts.ts`
- Test: `server/test/conflicts.service.test.ts`

**Interfaces:**
- Consumes: `prisma.syncConflict`, `snapshot`, `upsertLocal` (dari `./sync`), `clearOutbox` (dari `./outbox`).
- Produces:
  - `recordConflict(entity: string, recordId: string, local: {version:number;data:Record<string,unknown>}, server: {version:number;data:Record<string,unknown>}): Promise<void>`
  - `listConflicts(): Promise<ConflictView[]>` di mana `ConflictView = { entity:string; recordId:string; localData:unknown; localVersion:number; localUpdatedAt:string; serverData:unknown; serverVersion:number; serverUpdatedAt:string; detectedAt:string }`
  - `resolveConflict(entity: string, recordId: string, choice: "local"|"server", push: (records: unknown[]) => Promise<{results:{ok?:boolean;version?:number;conflict?:boolean}[]}> ): Promise<{ ok: true } | { ok: false; reason: "not-found" | "still-conflict" }>`

- [x] **Step 1: Tulis test gagal — record, list, resolve(server), resolve(local)**

Buat `server/test/conflicts.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueueOutbox, listOutbox } from "../src/services/outbox";
import { recordConflict, listConflicts, resolveConflict } from "../src/services/conflicts";

const clean = async () => {
  await prisma.syncConflict.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const L = { version: 2, data: { title: "lokal", updatedAt: "2020-01-02T00:00:00.000Z" } };
const S = { version: 3, data: { title: "server", updatedAt: "2020-01-01T00:00:00.000Z" } };

describe("conflicts service (SPEC-270)", () => {
  it("record + list mengembalikan konflik pending", async () => {
    await recordConflict("spec", "SPEC-1", L, S);
    const list = await listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ entity: "spec", recordId: "SPEC-1", localVersion: 2, serverVersion: 3 });
  });

  it("record idempoten per (entity,recordId) — update snapshot, bukan duplikat", async () => {
    await recordConflict("spec", "SPEC-1", L, S);
    await recordConflict("spec", "SPEC-1", { ...L, version: 4 }, S);
    const list = await listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0].localVersion).toBe(4);
  });

  it("resolve(server) mengadopsi data server ke lokal & menuntaskan", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "lokal", source: "brief",
      stage: "planned", priority: "sedang", author: "a", objective: "o", version: 2 } });
    await enqueueOutbox("spec", "SPEC-1");
    await recordConflict("spec", "SPEC-1", { version: 2, data: fullSpec("lokal") },
      { version: 3, data: fullSpec("server") });
    const push = async () => ({ results: [{ ok: true, version: 4 }] });
    const r = await resolveConflict("spec", "SPEC-1", "server", push);
    expect(r.ok).toBe(true);
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.title).toBe("server");
    expect(await listConflicts()).toHaveLength(0);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("resolve(local) force-push data lokal ke hub & menuntaskan", async () => {
    await recordConflict("spec", "SPEC-1", { version: 2, data: fullSpec("lokal") },
      { version: 3, data: fullSpec("server") });
    let pushed: any = null;
    const push = async (records: unknown[]) => { pushed = records; return { results: [{ ok: true, version: 4 }] }; };
    const r = await resolveConflict("spec", "SPEC-1", "local", push);
    expect(r.ok).toBe(true);
    expect(pushed[0]).toMatchObject({ entity: "spec", id: "SPEC-1", baseVersion: 3 }); // baseVersion = versi server
    expect(await listConflicts()).toHaveLength(0);
  });
});

function fullSpec(title: string) {
  return { projectId: "p1", title, source: "brief", stage: "planned", priority: "sedang", author: "a",
    objective: "o", payload: null, branchFrom: null, baseSha: null, headSha: null,
    updatedAt: "2020-01-02T00:00:00.000Z" };
}
```

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- conflicts.service`
Expected: FAIL (`../src/services/conflicts` belum ada).

- [x] **Step 3: Implementasi `conflicts.ts`**

Buat `server/src/services/conflicts.ts`:

```ts
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
```

- [x] **Step 4: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- conflicts.service`
Expected: PASS (4 test).

- [x] **Step 5: Commit**

```bash
git add server/src/services/conflicts.ts server/test/conflicts.service.test.ts
git commit -m "feat(spec-270): service store konflik (record/list/resolve)"
```

---

### Task 5: Klasifikasi konflik di `syncOnce` + fix versi setelah push

**Files:**
- Modify: `server/src/services/sync-client.ts` (`syncOnce`)
- Test: `server/test/sync-client.test.ts`

**Interfaces:**
- Consumes: `recordConflict` (Task 4), `snapshot`, `pull`, `upsertLocal`, `listOutbox`, `clearOutbox`.
- Produces: `SyncStats` tetap `{ pulled, pushed, conflicts }`; `conflicts` kini = jumlah baris `SyncConflict` yang dicatat siklus ini.

- [x] **Step 1: Tulis test gagal — konflik dua-sisi dicatat & versi lokal naik setelah push**

Tambah di `server/test/sync-client.test.ts`:

```ts
it("SPEC-270: edit dua-sisi → SyncConflict dicatat, tak clobber", async () => {
  const transport = await realTransport();
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
  // hub sudah punya SPEC-1 versi 1 (via push awal orang lain)
  await syncOnceSeedHub(transport, "SPEC-1", "judul-hub");
  // lokal punya SPEC-1 versi beda + edit pending berbeda isi
  await prisma.spec.create({ data: { id: "SPEC-1", ...specData({ title: "judul-lokal" }), version: 1,
    updatedAt: new Date("2020-01-02T00:00:00.000Z") } });
  await enqueueOutbox("spec", "SPEC-1");
  // hub memajukan versi (advance) supaya version mismatch
  await advanceHub(transport, "SPEC-1", "judul-hub2");

  const res = await syncOnce(transport);
  expect(res.conflicts).toBe(1);
  expect(await prisma.syncConflict.count({ where: { resolvedAt: null } })).toBe(1);
  // lokal tak ter-clobber ke data hub (menunggu keputusan manusia)
  expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.title).toBe("judul-lokal");
});

it("SPEC-270: push sukses menaikkan versi lokal = versi hub", async () => {
  const transport = await realTransport();
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
  await prisma.spec.create({ data: { id: "SPEC-9", ...specData(), version: 0 } });
  await enqueueOutbox("spec", "SPEC-9");
  await syncOnce(transport);
  expect((await prisma.spec.findUnique({ where: { id: "SPEC-9" } }))!.version).toBe(1);
});
```

Tambahkan helper di file test (setelah `realTransport`):
```ts
async function syncOnceSeedHub(t: Transport, id: string, title: string) {
  await t("POST", "/api/sync/push", { records: [{ entity: "spec", id, baseVersion: 0,
    data: { ...specData({ title }), updatedAt: "2020-01-01T00:00:00.000Z" } }] });
}
async function advanceHub(t: Transport, id: string, title: string) {
  const cur = (await t("GET", `/api/sync/pull?since=0`)).body.records.find((r: any) => r.recordId === id);
  await t("POST", "/api/sync/push", { records: [{ entity: "spec", id, baseVersion: cur.version,
    data: { ...specData({ title }), updatedAt: "2020-01-03T00:00:00.000Z" } }] });
}
```
Impor `recordConflict` tak perlu di test; impor `prisma.syncConflict` sudah lewat `prisma`. Tambah `prisma.syncConflict.deleteMany()` di `clean()` file ini.

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- sync-client`
Expected: FAIL (konflik tak tercatat / versi lokal tak naik).

- [x] **Step 3: Ganti logika pull-skip & push di `syncOnce`**

Di `server/src/services/sync-client.ts`:

Tambah import:
```ts
import { recordConflict } from "./conflicts";
```

Pertahankan deklarasi lama di atas fungsi (`let pulled = 0, pushed = 0, conflicts = 0;`) — jangan buat deklarasi `conflicts` kedua. Ganti loop pull (baris ~43-47) agar konflik-sadar:
```ts
  for (const rec of records) {
    if (!isEntity(rec.entity)) continue;
    if (pending.has(`${rec.entity}:${rec.recordId}`)) {
      // ada edit lokal pending — klasifikasi: data sama → biarkan (push nanti), beda → konflik.
      const local = await snapshot(rec.entity as Entity, rec.recordId);
      if (local && JSON.stringify(local.data) !== JSON.stringify(rec.data)) {
        await recordConflict(rec.entity, rec.recordId,
          { version: local.version, data: local.data },
          { version: rec.version, data: rec.data });
        conflicts++;
      }
      continue; // jangan clobber; keputusan via modal (server) atau push (lokal)
    }
    await applyRemote(rec.entity, rec.recordId, rec.version, rec.data);
    pulled++;
  }
```
Tambah import tipe `Entity` dari `./sync` (`import { pull as _pull, snapshot, upsertLocal, isEntity, type Entity } from "./sync";`).

Ganti hasil push (baris ~68-73) agar update versi lokal & catat konflik:
```ts
    const res = await transport("POST", "/api/sync/push", {
      records: [{ entity: item.entity, id: item.recordId, baseVersion: snap.version, data: snap.data }],
    });
    const r = res.body?.results?.[0];
    if (r?.ok) {
      // SPEC-270 · naikkan versi lokal = versi hub agar tak nyimpang di edit berikutnya.
      if (typeof r.version === "number") {
        await (prisma as any)[item.entity].update({ where: { id: item.recordId }, data: { version: r.version } })
          .catch(() => {});
      }
      await clearOutbox(item.entity, item.recordId); pushed++;
    } else if (r?.conflict) {
      // SPEC-270 · hub menolak → catat konflik dua-sisi bila datanya beda; else konvergen.
      const server = r.server as { version: number; data: Record<string, unknown> } | null;
      if (server && JSON.stringify(server.data) !== JSON.stringify(snap.data)) {
        await recordConflict(item.entity, item.recordId,
          { version: snap.version, data: snap.data }, { version: server.version, data: server.data });
        conflicts++;
      } else if (server) {
        await applyRemote(item.entity, item.recordId, server.version, server.data);
        await clearOutbox(item.entity, item.recordId);
      }
    }
```
Return tetap `{ pulled, pushed, conflicts }` seperti semula (deklarasi tunggal di atas fungsi tetap dipakai).

Catatan: `applyPush` di hub sudah mengembalikan `server: snapshot` saat konflik (`sync.ts:110`) — struktur `{ version, data }` cocok.

- [x] **Step 4: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- sync-client`
Expected: PASS (termasuk test lama file ini).

- [x] **Step 5: Commit**

```bash
git add server/src/services/sync-client.ts server/test/sync-client.test.ts
git commit -m "feat(spec-270): syncOnce catat konflik dua-sisi + fix versi lokal setelah push"
```

---

### Task 6: Endpoint konflik + shared paths/types + client api

**Files:**
- Modify: `server/src/routes/sync.ts` (2 route baru)
- Modify: `server/src/app.ts` (pastikan path konflik dikecualikan dari gate agent-token, cermin `/sync/now`)
- Modify: `shared/src/api.ts` (paths + tipe `SyncConflictView`)
- Modify: `src/src/api/client.ts` (`listConflicts`, `resolveConflict`)
- Test: `server/test/sync.route.test.ts`

**Interfaces:**
- Consumes: `listConflicts`, `resolveConflict` (Task 4), `fetchTransport` + `effectiveStr` (untuk push saat resolve `local`).
- Produces:
  - `GET /api/sync/conflicts` → `{ conflicts: SyncConflictView[] }`
  - `POST /api/sync/conflicts/:entity/:recordId/resolve` body `{ choice }` → `{ ok: true } | { ok: false, reason }`
  - `SyncConflictView` (shared) sama bentuk `ConflictView`.
  - `paths.syncConflicts`, `paths.syncConflictResolve(entity, recordId)`.

- [x] **Step 1: Tulis test gagal — list kosong & resolve not-found**

Tambah di `server/test/sync.route.test.ts` (ikuti pola auth cookie file itu; kalau file pakai device-token, tambahkan test cookie sesuai helper yang ada — gunakan helper login yang sudah dipakai route cookie lain di repo):

```ts
it("SPEC-270: GET /api/sync/conflicts kosong saat tak ada konflik", async () => {
  const res = await app.inject({ method: "GET", url: "/api/sync/conflicts", headers: authCookie });
  expect(res.statusCode).toBe(200);
  expect(res.json().conflicts).toEqual([]);
});
it("SPEC-270: resolve entitas tak dikenal → 404/not-found", async () => {
  const res = await app.inject({ method: "POST", url: "/api/sync/conflicts/nope/x/resolve",
    headers: authCookie, payload: { choice: "server" } });
  expect(res.json().ok).toBe(false);
});
```
(`authCookie` = cara file ini mengautentikasi request cookie; reuse yang sudah ada. Jika belum ada, tiru helper login dari `server/test/*.route.test.ts` lain.)

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- sync.route`
Expected: FAIL (route belum ada / 404 rute).

- [x] **Step 3: Tambah route di `server/src/routes/sync.ts`**

Tambah import di atas:
```ts
import { listConflicts, resolveConflict } from "../services/conflicts";
import { fetchTransport } from "../services/sync-client";
import { effectiveStr } from "../config";
```
Dalam `export default async function (app)`, setelah route `/sync/now`:
```ts
  // SPEC-270 · ADR-0067 · antrean konflik rekonsil (cookie-authed; dikecualikan dari gate agent-token).
  app.get("/sync/conflicts", async () => ({ conflicts: await listConflicts() }));

  const zResolve = z.object({ choice: z.enum(["local", "server"]) });
  app.post("/sync/conflicts/:entity/:recordId/resolve", async (req, reply) => {
    const { entity, recordId } = req.params as { entity: string; recordId: string };
    const p = zResolve.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ ok: false, reason: "bad-choice" });
    const base = effectiveStr("SYNC_SERVER_URL"); const token = effectiveStr("SYNC_DEVICE_TOKEN");
    const push = async (records: unknown[]) => {
      if (!base || !token) return { results: [{ ok: false as const }] };
      const t = fetchTransport(base, token);
      const res = await t("POST", "/api/sync/push", { records });
      return res.body as { results: { ok?: boolean; version?: number; conflict?: boolean }[] };
    };
    const r = await resolveConflict(entity, recordId, p.data.choice, push);
    return r;
  });
```

- [x] **Step 4: Kecualikan path konflik dari gate agent-token**

Di `server/src/app.ts`, temukan pengecualian untuk `/sync/now` (memory: path `/sync` di-bypass gate, tapi `/sync/now` dikecualikan dari bypass supaya cookie-only). Terapkan aturan sama untuk `/sync/conflicts` dan `/sync/conflicts/.../resolve`: keduanya harus cookie-only (bukan bypass device-token, bukan agent-token). Cari string `"/sync/now"` di `app.ts` dan tambahkan pola `/sync/conflicts` di daftar yang sama.

Run untuk menemukan lokasi:
```bash
grep -n "sync/now\|/sync" server/src/app.ts
```
Terapkan pengecualian identik untuk prefix `/api/sync/conflicts`.

- [x] **Step 5: Shared paths + tipe**

Di `shared/src/api.ts`, dekat `syncNow`:
```ts
  // SPEC-270 · ADR-0067 · antrean konflik rekonsil
  syncConflicts: `${API}/sync/conflicts`,
  syncConflictResolve: (entity: string, recordId: string) =>
    `${API}/sync/conflicts/${encodeURIComponent(entity)}/${encodeURIComponent(recordId)}/resolve`,
```
Tambah tipe (dekat `ConfigResponse`):
```ts
export type SyncConflictView = {
  entity: string; recordId: string;
  localData: unknown; localVersion: number; localUpdatedAt: string;
  serverData: unknown; serverVersion: number; serverUpdatedAt: string; detectedAt: string;
};
```

- [x] **Step 6: Client api**

Di `src/src/api/client.ts`, setelah `syncNow`:
```ts
  // SPEC-270 · ADR-0067 · rekonsil konflik
  listConflicts: () => j<{ conflicts: SyncConflictView[] }>(paths.syncConflicts),
  resolveConflict: (entity: string, recordId: string, choice: "local" | "server") =>
    j<{ ok: boolean; reason?: string }>(paths.syncConflictResolve(entity, recordId), { method: "POST", ...body({ choice }) }),
```
Tambah `SyncConflictView` ke import `@hanoman/shared` di baris 1.

- [x] **Step 7: Jalankan test + typecheck**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- sync.route
pnpm --filter ./shared build && pnpm -r exec tsc --noEmit
```
Expected: test PASS; tsc tanpa error.

- [x] **Step 8: Commit**

```bash
git add server/src/routes/sync.ts server/src/app.ts shared/src/api.ts src/src/api/client.ts server/test/sync.route.test.ts
git commit -m "feat(spec-270): endpoint /sync/conflicts + resolve (cookie-authed) + client api"
```

---

### Task 7: `ReconcileModal` + pemicu di `SyncButton`

**Files:**
- Create: `src/src/screens/ReconcileModal.tsx`
- Modify: `src/src/screens/SyncButton.tsx` (buka modal saat `conflicts>0` / badge)
- Test: `src/test/reconcile-modal.test.tsx`

**Interfaces:**
- Consumes: `api.listConflicts`, `api.resolveConflict`, `SyncConflictView`, DS `Modal`/`Button`.
- Produces: komponen `ReconcileModal({ open, onClose, onResolved })`.

- [x] **Step 1: Tulis test gagal — render side-by-side + default sisi updatedAt terbaru**

Buat `src/test/reconcile-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ReconcileModal } from "../src/screens/ReconcileModal";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({ api: { listConflicts: vi.fn(), resolveConflict: vi.fn() } }));

const conflict = {
  entity: "spec", recordId: "SPEC-1",
  localData: { title: "judul lokal", stage: "review" }, localVersion: 2, localUpdatedAt: "2020-01-02T00:00:00.000Z",
  serverData: { title: "judul server", stage: "planned" }, serverVersion: 3, serverUpdatedAt: "2020-01-01T00:00:00.000Z",
  detectedAt: "2020-01-02T00:00:00.000Z",
};

beforeEach(() => { (api.listConflicts as any).mockResolvedValue({ conflicts: [conflict] });
  (api.resolveConflict as any).mockResolvedValue({ ok: true }); });

describe("ReconcileModal (SPEC-270)", () => {
  it("menampilkan kedua sisi & menandai sisi updatedAt terbaru sebagai default", async () => {
    render(<ReconcileModal open onClose={() => {}} onResolved={() => {}} />);
    await waitFor(() => expect(screen.getByText("judul lokal")).toBeTruthy());
    expect(screen.getByText("judul server")).toBeTruthy();
    // lokal updatedAt lebih baru → badge default di sisi lokal
    expect(screen.getByTestId("default-side").textContent).toContain("Lokal");
  });

  it("klik Pakai Server memanggil resolveConflict(server)", async () => {
    const onResolved = vi.fn();
    render(<ReconcileModal open onClose={() => {}} onResolved={onResolved} />);
    await waitFor(() => screen.getByText("judul lokal"));
    fireEvent.click(screen.getByRole("button", { name: /Pakai Server/i }));
    await waitFor(() => expect(api.resolveConflict).toHaveBeenCalledWith("spec", "SPEC-1", "server"));
  });
});
```

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `pnpm --filter ./src test -- reconcile-modal` (atau perintah test frontend repo: cek `package.json` `src`)
Expected: FAIL (komponen belum ada).

- [x] **Step 3: Implementasi `ReconcileModal.tsx`**

Buat `src/src/screens/ReconcileModal.tsx`:

```tsx
/* ReconcileModal — SPEC-270 · ADR-0067. Daftar konflik sync dua-sisi; tiap kartu side-by-side
   (Lokal | Server), sisi updatedAt terbaru jadi default; user pilih "Pakai Lokal / Pakai Server". */
import React from "react";
import { Modal } from "../ds/kit";
import { Button } from "../ds";
import { api } from "../api/client";
import type { SyncConflictView } from "@hanoman/shared";

function newerSide(c: SyncConflictView): "local" | "server" {
  return new Date(c.localUpdatedAt) >= new Date(c.serverUpdatedAt) ? "local" : "server";
}
function fmt(v: unknown): string { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }

export function ReconcileModal({ open, onClose, onResolved }:
  { open: boolean; onClose: () => void; onResolved: () => void }) {
  const [items, setItems] = React.useState<SyncConflictView[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    try { setItems((await api.listConflicts()).conflicts); } catch { setItems([]); }
  }, []);
  React.useEffect(() => { if (open) void load(); }, [open, load]);

  async function resolve(c: SyncConflictView, choice: "local" | "server") {
    setBusy(`${c.entity}:${c.recordId}`);
    try { await api.resolveConflict(c.entity, c.recordId, choice); await load(); onResolved(); }
    finally { setBusy(null); }
  }

  return (
    <Modal open={open} title="Rekonsil konflik sync" eyebrow="SPEC-270" icon="git-merge" width={720} onClose={onClose}>
      {items.length === 0 && <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>Tak ada konflik. Semua sinkron.</div>}
      {items.map((c) => {
        const dflt = newerSide(c);
        const id = `${c.entity}:${c.recordId}`;
        return (
          <div key={id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              {c.entity} · {c.recordId} · <span data-testid="default-side">default: {dflt === "local" ? "Lokal" : "Server"} (updatedAt terbaru)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Side label="Lokal" data={c.localData} at={c.localUpdatedAt} ver={c.localVersion} active={dflt === "local"} />
              <Side label="Server" data={c.serverData} at={c.serverUpdatedAt} ver={c.serverVersion} active={dflt === "server"} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
              <Button size="sm" variant={dflt === "local" ? "primary" : "secondary"} disabled={busy === id}
                onClick={() => resolve(c, "local")}>Pakai Lokal</Button>
              <Button size="sm" variant={dflt === "server" ? "primary" : "secondary"} disabled={busy === id}
                onClick={() => resolve(c, "server")}>Pakai Server</Button>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

function Side({ label, data, at, ver, active }:
  { label: string; data: unknown; at: string; ver: number; active: boolean }) {
  return (
    <div style={{ border: active ? "1px solid var(--brass)" : "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label} · v{ver}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{new Date(at).toLocaleString()}</div>
      <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", margin: 0, maxHeight: 200, overflow: "auto" }}>{fmt(data)}</pre>
    </div>
  );
}
```
(Sesuaikan import `Modal`/`Button` dengan lokasi asli — cek `src/src/ds/index` untuk export; `ConfirmDialog` mengimpor `{ Modal } from "./kit"` dan `{ Button } from "./components/forms"`.)

- [x] **Step 4: Picu modal dari `SyncButton`**

Modifikasi `src/src/screens/SyncButton.tsx`: tambah state `showModal`, buka saat hasil `syncNow` punya `conflicts>0`, dan render `<ReconcileModal>`:

```tsx
import { ReconcileModal } from "./ReconcileModal";
// ...di dalam SyncButton:
const [showModal, setShowModal] = React.useState(false);
// dalam run(), setelah menghitung toast:
if (r.ok && r.conflicts) setShowModal(true);
// pada return, bungkus:
return (<>
  <Button size="sm" variant="secondary" leftIcon="rotate-ccw" onClick={run} disabled={busy}>
    {busy ? "Menyinkron…" : "Sync"}
  </Button>
  <ReconcileModal open={showModal} onClose={() => setShowModal(false)} onResolved={onDone} />
</>);
```

- [x] **Step 5: Jalankan test — pastikan lolos**

Run: `pnpm --filter ./src test -- reconcile-modal`
Expected: PASS (2 test).

- [x] **Step 6: Commit**

```bash
git add src/src/screens/ReconcileModal.tsx src/src/screens/SyncButton.tsx src/test/reconcile-modal.test.tsx
git commit -m "feat(spec-270): ReconcileModal side-by-side + picu dari SyncButton"
```

---

### Task 8: ADR-0067 + update SoT (data-model, api-contract) + smoke API nyata

**Files:**
- Create: `internal/docs/adr/0067-sync-lww-reconciliation.md`
- Modify: `internal/docs/README.md` (tautkan ADR-0067)
- Modify: `internal/docs/data-model/*` (kolom `updatedAt @updatedAt`, tabel `SyncConflict`)
- Modify: `internal/docs/api-contract/*` (`/sync/conflicts`, resolve)

- [x] **Step 1: Tulis ADR-0067**

Buat `internal/docs/adr/0067-sync-lww-reconciliation.md` mengikuti format ADR repo (lihat `0066-*.md`). Isi keputusan: (a) `updatedAt @updatedAt` jadi jam LWW yang ikut wire & terjaga saat apply; (b) divergensi dua-sisi → antrean `SyncConflict` + resolusi manusia per-record (default LWW), bukan auto-overwrite; (c) `backfillFeed()` idempoten saat boot hub; (d) asumsi **tepat satu hub (VPS)**, clock NTP; (e) konsekuensi: `stage` forward-only bisa diregres manual lewat modal (diterima v1).

- [x] **Step 2: Update data-model & api-contract SoT**

Tambahkan di doc data-model: model `SyncConflict` (LOCAL-only) + catatan `updatedAt` kini `@updatedAt` pada 6 model synced dan ikut disync sebagai jam LWW. Di api-contract: `GET /api/sync/conflicts` dan `POST /api/sync/conflicts/:entity/:recordId/resolve` (cookie-authed). Tautkan ADR-0067 di `internal/docs/README.md`.

- [x] **Step 3: Verifikasi coverage SoT (dep-free)**

Run: `node --experimental-strip-types shared/src/coverage.ts` (atau perintah coverage yang dipakai repo; lihat memory "verify coverage without server"). Expected: tak ada file baru yang tak tertaut.

- [x] **Step 4: Smoke API nyata — boot server + curl siklus konflik**

Boot server prod-lokal lalu uji endpoint baru (DB throwaway termigrate, jangan hanoman_test):
```bash
# terminal terpisah: boot server (pnpm dev / node server/dist/server.js)
curl -s -b cookie.txt localhost:8787/api/sync/conflicts | jq .
# harus {"conflicts":[]} awalnya; buat 1 konflik lewat skenario dua-sisi lalu cek muncul
curl -s -b cookie.txt -X POST localhost:8787/api/sync/conflicts/spec/SPEC-1/resolve -H 'content-type: application/json' -d '{"choice":"server"}' | jq .
```
Expected: list mengembalikan konflik; resolve `{ok:true}`; konflik hilang dari list berikutnya.

- [x] **Step 5: Jalankan seluruh test server + centang plan**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test`
Expected: semua hijau. Centang semua `- [x]` yang selesai di plan ini.

- [x] **Step 6: Commit**

```bash
git add internal/docs docs/superpowers/plans/2026-07-21-sync-lww-reconciliation.md
git commit -m "docs(spec-270): ADR-0067 + data-model/api-contract SoT + plan tercentang"
```

---

## Catatan operasional (bukan kode — untuk rollout)

- Agar fase backlog benar-benar sinkron dua arah, instance **lokal** harus dikonfigurasi sebagai **client** (`SYNC_SERVER_URL` + `SYNC_DEVICE_TOKEN` di-set, via UI config atau `.env.production`), dan **VPS = hub tunggal** (SYNC_SERVER_URL kosong). Tanpa ini, advance stage lokal tak pernah menyeberang (akar "belum tersync" saat ini).
- Setelah deploy ADR-0067 ke VPS, `backfillFeed` boot akan memasukkan 4 `ErrorGroup` + 1 `Ticket` v0 ke feed → lokal menariknya pada sync berikutnya.
