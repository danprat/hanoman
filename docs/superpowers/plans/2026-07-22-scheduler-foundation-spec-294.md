# Fondasi Scheduler (SPEC-294) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, this session) + superpowers:test-driven-development + superpowers:verification-before-completion. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bangun substrat scheduler otonom — engine in-process, antrean durable, governor concurrency, Pause, skema Setting + `Project.schedulerOptIn`, endpoint config/state, dan kontrak `registerSchedulerSource`/`enqueue` untuk lima daun — semua default MATI, migration aditif.

**Architecture:** Engine sweep in-process bergaya `vps-monitor.ts` (di-`start` dari `server.ts`, timer `.unref()`), membaca enable+cadence per source dari `Setting.scheduler`, memanggil checker terdaftar saat jatuh tempo, lalu governor men-drain tabel `SchedulerQueueItem` di bawah `cap = maxConcurrent` (dihitung dari `pty.listSessions()`). Unit peluncuran selalu sebuah `Spec` (`specId @unique` → idempoten satu-sesi-per-spec). Governor & engine memakai dependency injection (`liveCount`/`isLive`/`launch`/`now`) agar teruji tanpa tmux/claude nyata.

**Tech Stack:** TypeScript strict, Fastify, Prisma/Postgres, zod (`@hanoman/shared`), node-pty/tmux (`services/pty.ts`), vitest (`--no-file-parallelism`).

## Global Constraints

- **Semua default MATI** — `scheduler.enabled=false`, `paused=false`, tiap `sources.*.enabled=false`, `Project.schedulerOptIn=false`. Tak ada perubahan perilaku sampai operator opt-in.
- **Migration aditif** — satu tabel baru + satu kolom nullable/default; tak mengubah kolom lama. Hand-write `migration.sql` + `prisma migrate deploy` per DB (dev + test) dengan env override, lalu `prisma generate`. JANGAN `migrate dev` (reset saat drift worktree).
- **`app.ts` bebas-timer** — engine hanya di-`start` dari `server.ts`. Test tak pernah menyalakan loop.
- **Scheduler LOCAL per-instance** — `SchedulerQueueItem` tak disync (cermin `SyncOutbox`); `Project.schedulerOptIn` **tidak** ditambahkan ke `FIELDS` whitelist di `services/sync.ts` → tetap lokal.
- **Jalankan test:** `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- --no-file-parallelism` (hindari env prod bocor). Shared: `pnpm --filter ./shared test`.
- **Nomor:** SPEC-294, ADR-0072 (sudah ditulis). Migration folder `2026072202_spec294_scheduler_foundation`.
- Bahasa komentar/prosa: Indonesia (ikut gaya repo).

---

### Task 1: Migration + Prisma schema (`SchedulerQueueItem` + `Project.schedulerOptIn`)

**Files:**
- Create: `server/prisma/migrations/2026072202_spec294_scheduler_foundation/migration.sql`
- Modify: `server/prisma/schema.prisma` (tambah model + kolom)
- Test: `server/test/scheduler-queue.service.test.ts` (dibuat di Task 5; Task 1 hanya verifikasi client ter-generate)

**Interfaces:**
- Produces: model Prisma `SchedulerQueueItem { id, specId(unique), projectId, source, priority, status(default "queued"), sessionId?, note?, enqueuedAt, launchedAt? }`; kolom `Project.schedulerOptIn Boolean @default(false)`.

- [ ] **Step 1: Tulis migration.sql**

```sql
-- SPEC-294 · ADR-0072 · fondasi scheduler: antrean durable (LOCAL-ONLY, tak disync) + opt-in per project.
-- Aditif: satu tabel baru + satu kolom default. Tak menyentuh kolom lama.

-- Antrean durable kandidat peluncuran. specId UNIQUE = idempoten satu-sesi-per-spec (ADR-0015).
CREATE TABLE "SchedulerQueueItem" (
  "id"          TEXT NOT NULL,
  "specId"      TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "priority"    TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'queued',
  "sessionId"   TEXT,
  "note"        TEXT,
  "enqueuedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "launchedAt"  TIMESTAMP(3),
  CONSTRAINT "SchedulerQueueItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchedulerQueueItem_specId_key" ON "SchedulerQueueItem"("specId");
CREATE INDEX "SchedulerQueueItem_status_idx" ON "SchedulerQueueItem"("status");

-- Opt-in per project (gerbang kelayakan semua source). Pola helpEnabled. Tak masuk FIELDS sync → lokal.
ALTER TABLE "Project" ADD COLUMN "schedulerOptIn" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Tambah model + kolom di `schema.prisma`**

Tambah kolom di `model Project` (setelah `helpEnabled`):
```prisma
  schedulerOptIn Boolean @default(false) // SPEC-294 · opt-in scheduler otonom (LOCAL — tak masuk FIELDS sync)
```
Tambah model baru (di akhir file, dekat SyncOutbox — kelompok LOCAL-ONLY):
```prisma
// SPEC-294 · ADR-0072 · LOCAL-ONLY (tak disync, cermin SyncOutbox): antrean durable kandidat peluncuran
// scheduler. specId @unique = idempoten satu-sesi-per-spec (ADR-0015). Unit peluncuran selalu Spec.
model SchedulerQueueItem {
  id         String    @id @default(cuid())
  specId     String    @unique
  projectId  String
  source     String    // backlog | errors | triase (asal checker)
  priority   String    // tinggi | sedang | rendah (urutan drain)
  status     String    @default("queued") // queued | launched | done | failed
  sessionId  String?
  note       String?   // alasan gagal (diisi daun #5)
  enqueuedAt DateTime  @default(now())
  launchedAt DateTime?

  @@index([status])
}
```

- [ ] **Step 3: Terapkan migration ke DB dev + test lalu generate**

```bash
cd server
# dev
env DATABASE_URL="$(grep -m1 DATABASE_URL .env | cut -d= -f2- | tr -d '"')" npx prisma migrate deploy
# test (turunkan _test dari base; sesuaikan bila vitest pakai base lain — lihat vitest.config/.env.test)
env DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman_test" npx prisma migrate deploy
npx prisma generate
```
Expected: "1 migration applied" (atau "No pending") di masing-masing; generate sukses.

- [ ] **Step 4: Verifikasi client punya model**

Run: `cd server && node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();console.log(typeof p.schedulerQueueItem.findMany)"`
Expected: `function`

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/2026072202_spec294_scheduler_foundation
git commit -m "feat(spec-294): migration SchedulerQueueItem + Project.schedulerOptIn (aditif)"
```

---

### Task 2: Shared — `zScheduler` + `SCHEDULER_DEFAULTS` + `zSetting.scheduler` + DTO

**Files:**
- Modify: `shared/src/entities.ts` (tambah `zScheduler`, `SCHEDULER_DEFAULTS`, kolom `scheduler` di `zSetting`)
- Modify: `shared/src/dto.ts` (tambah `schedulerOptIn` ke `zUpdateProject` + `zProjectView`; `SchedulerQueueItemView`, `SchedulerStateView`)
- Test: `shared/src/scheduler.test.ts`

**Interfaces:**
- Produces: `zScheduler` (zod), `type Scheduler`, `SCHEDULER_DEFAULTS: Scheduler`, `zSetting` kini punya `scheduler: Scheduler`; `zUpdateProject.schedulerOptIn?`, `zProjectView.schedulerOptIn`.

- [ ] **Step 1: Tulis test dulu (`shared/src/scheduler.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { zScheduler, SCHEDULER_DEFAULTS, zSetting } from "./entities";

describe("zScheduler", () => {
  it("all defaults are OFF", () => {
    expect(SCHEDULER_DEFAULTS.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.paused).toBe(false);
    expect(SCHEDULER_DEFAULTS.maxConcurrent).toBe(2);
    expect(SCHEDULER_DEFAULTS.autonomy).toBe("butuh-keputusan");
    expect(SCHEDULER_DEFAULTS.sources.backlog.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.sources.errors.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.sources.errors.minCount).toBe(5);
    expect(SCHEDULER_DEFAULTS.sources.triase.everyMin).toBe(30);
  });
  it("parses {} to full defaults", () => {
    expect(zScheduler.parse({})).toEqual(SCHEDULER_DEFAULTS);
  });
  it("rejects maxConcurrent < 1", () => {
    expect(zScheduler.safeParse({ maxConcurrent: 0 }).success).toBe(false);
  });
});

describe("zSetting.scheduler backward-compat", () => {
  it("an old Setting row without a scheduler block still parses, filling defaults", () => {
    const old = {
      model: "claude-opus-4-8", effort: "xhigh",
      autoDefault: true, autoScaffold: true, notifyFail: true,
      notifyDone: true, notifySound: "short", notifyDecision: true,
      notifyDecisionSound: "alert", agentAccessEnabled: false,
    };
    const parsed = zSetting.parse(old);
    expect(parsed.scheduler).toEqual(SCHEDULER_DEFAULTS);
  });
});
```

- [ ] **Step 2: Jalankan test — gagal**

Run: `pnpm --filter ./shared test -- scheduler`
Expected: FAIL (`zScheduler` tak ada).

- [ ] **Step 3: Implement di `entities.ts`** (tambah sebelum `zSetting`)

```ts
// SPEC-294 · ADR-0072 · knob scheduler otonom. Semua default MATI. Ditambahkan ke zSetting sebagai
// .default({}) → baris Setting lama tanpa blok ini tetap parse (key hilang diisi default).
const zSourceCommon = { enabled: z.boolean().default(false) };
export const zScheduler = z.object({
  enabled: z.boolean().default(false),      // master subsystem switch
  paused: z.boolean().default(false),       // rem darurat (Pause): blokir drain ≤1 tick
  maxConcurrent: z.number().int().min(1).default(2),   // cap sesi hidup
  autonomy: z.enum(["full-control", "butuh-keputusan"]).default("butuh-keputusan"), // dikonsumsi daun #5
  sources: z.object({
    backlog: z.object({ ...zSourceCommon, everyMin: z.number().int().min(1).default(15) }).default({}),
    errors:  z.object({ ...zSourceCommon, everyMin: z.number().int().min(1).default(15), minCount: z.number().int().min(1).default(5) }).default({}),
    triase:  z.object({ ...zSourceCommon, everyMin: z.number().int().min(1).default(30) }).default({}),
  }).default({}),
});
export type Scheduler = z.infer<typeof zScheduler>;
export const SCHEDULER_DEFAULTS: Scheduler = zScheduler.parse({});
```
Lalu tambahkan baris di dalam `zSetting = z.object({ … })` (sebelum `});`):
```ts
  scheduler: zScheduler.default(SCHEDULER_DEFAULTS),                      // SPEC-294 · ADR-0072
```

- [ ] **Step 4: Implement di `dto.ts`**

Tambah `schedulerOptIn` ke `zUpdateProject` (di dalam objeknya):
```ts
  schedulerOptIn: z.boolean().optional(),   // SPEC-294 · opt-in scheduler (lokal, tak disync)
```
Tambah `schedulerOptIn` ke `zProjectView` (setelah `helpEnabled`):
```ts
  helpEnabled: z.boolean().default(false),   // SPEC-253 · Help Center publik aktif
  schedulerOptIn: z.boolean().default(false) });   // SPEC-294 · opt-in scheduler otonom
```
(hapus `});` lama di baris `helpEnabled` dan pindahkan ke baris baru seperti di atas.)
Tambah DTO di akhir `dto.ts`:
```ts
// SPEC-294 · ADR-0072 · baris antrean scheduler untuk panel (daun #6). Tanggal = string ISO.
export const zSchedulerQueueItem = z.object({
  id: z.string(), specId: z.string(), projectId: z.string(),
  source: z.string(), priority: z.string(), status: z.string(),
  sessionId: z.string().nullable(), note: z.string().nullable(),
  enqueuedAt: z.string(), launchedAt: z.string().nullable(),
});
export type SchedulerQueueItemView = z.infer<typeof zSchedulerQueueItem>;
```

- [ ] **Step 5: Jalankan test — hijau**

Run: `pnpm --filter ./shared test -- scheduler`
Expected: PASS. Juga cek build type: `pnpm --filter ./shared build` (atau `tsc --noEmit`) sukses.

- [ ] **Step 6: Commit**

```bash
git add shared/src/entities.ts shared/src/dto.ts shared/src/scheduler.test.ts
git commit -m "feat(spec-294): shared zScheduler + SCHEDULER_DEFAULTS + Setting/Project DTO (default off)"
```

---

### Task 3: `DEFAULT_SETTING` + `project-view` + `projects` PATCH opt-in

**Files:**
- Modify: `server/src/services/settings.ts` (`DEFAULT_SETTING` tambah `scheduler`)
- Modify: `server/src/services/project-view.ts` (ekspos `schedulerOptIn`)
- Modify: `server/src/routes/projects.ts` (PATCH terima `schedulerOptIn`)
- Test: `server/test/project-scheduler-optin.route.test.ts`

**Interfaces:**
- Consumes: `SCHEDULER_DEFAULTS` (Task 2), `zUpdateProject.schedulerOptIn` (Task 2).
- Produces: `ProjectView.schedulerOptIn`; `PATCH /api/projects/:id { schedulerOptIn }` mempersist kolom.

- [ ] **Step 1: Tulis test (`project-scheduler-optin.route.test.ts`)**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(async () => { await clean(); await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } }); });
afterAll(clean);

describe("Project.schedulerOptIn", () => {
  it("defaults to false and shows in the project view", async () => {
    const r = await app.inject({ method: "GET", url: "/api/projects" });
    const p = r.json().items.find((x: any) => x.id === "p1");
    expect(p.schedulerOptIn).toBe(false);
  });
  it("PATCH toggles it on and persists", async () => {
    const r = await app.inject({ method: "PATCH", url: "/api/projects/p1", payload: { schedulerOptIn: true } });
    expect(r.statusCode).toBe(200);
    const row = await prisma.project.findUnique({ where: { id: "p1" } });
    expect(row!.schedulerOptIn).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- project-scheduler-optin`
Expected: FAIL (`schedulerOptIn` undefined di view / tak dipersist).

- [ ] **Step 3: `settings.ts` — `DEFAULT_SETTING`**

Tambah import: `import { zSetting, SCHEDULER_DEFAULTS, type Setting } from "@hanoman/shared";`
Tambah field di `DEFAULT_SETTING`:
```ts
  agentAccessEnabled: false,   // SPEC-257 · akses AI agent off sampai dibuka manusia
  scheduler: SCHEDULER_DEFAULTS,   // SPEC-294 · ADR-0072 · semua knob scheduler default mati
```

- [ ] **Step 4: `project-view.ts` — ekspos kolom**

Di `toProjectView`, tambah setelah `helpEnabled: p.helpEnabled,`:
```ts
    // SPEC-294 · opt-in scheduler otonom (lokal per-instance).
    schedulerOptIn: p.schedulerOptIn,
```

- [ ] **Step 5: `projects.ts` — PATCH terima schedulerOptIn**

Di handler `PATCH /projects/:id`, pastikan `schedulerOptIn` ikut ter-update. Cari objek `data` yang dibangun dari `parsed.data` dan tambahkan (mengikuti pola field lain, mis. setelah baris yang menangani `repoDir`/`gitRemote`):
```ts
      ...(parsed.data.schedulerOptIn !== undefined ? { schedulerOptIn: parsed.data.schedulerOptIn } : {}),
```
(Bila handler memakai `data: parsed.data` langsung ⇒ sudah otomatis; tetap verifikasi lewat test.)

- [ ] **Step 6: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- project-scheduler-optin`
Expected: PASS (2 tes).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/settings.ts server/src/services/project-view.ts server/src/routes/projects.ts server/test/project-scheduler-optin.route.test.ts
git commit -m "feat(spec-294): expose schedulerOptIn in view + PATCH; DEFAULT_SETTING.scheduler"
```

---

### Task 4: `services/scheduler/config.ts` (getScheduler / setScheduler)

**Files:**
- Create: `server/src/services/scheduler/config.ts`
- Test: `server/test/scheduler-config.service.test.ts`

**Interfaces:**
- Consumes: `getSetting` (`services/settings.ts`), `Scheduler`/`zScheduler` (shared).
- Produces: `getScheduler(): Promise<Scheduler>`, `setScheduler(next: Scheduler): Promise<Scheduler>`.

- [ ] **Step 1: Tulis test**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { getScheduler, setScheduler } from "../src/services/scheduler/config";
import { getSetting } from "../src/services/settings";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = () => prisma.setting.deleteMany();
beforeEach(clean); afterAll(clean);

describe("scheduler config service", () => {
  it("returns all-off defaults when no Setting row exists", async () => {
    expect(await getScheduler()).toEqual(SCHEDULER_DEFAULTS);
  });
  it("setScheduler persists without clobbering other Setting fields", async () => {
    const before = await getSetting();
    const next = { ...SCHEDULER_DEFAULTS, enabled: true, maxConcurrent: 3 };
    await setScheduler(next);
    expect((await getScheduler()).enabled).toBe(true);
    expect((await getScheduler()).maxConcurrent).toBe(3);
    const after = await getSetting();
    expect(after.model).toBe(before.model);          // field non-scheduler utuh
    expect(after.notifyDone).toBe(before.notifyDone);
  });
});
```

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-config`
Expected: FAIL (module tak ada).

- [ ] **Step 3: Implement `config.ts`**

```ts
import { prisma } from "../../db";
import type { Prisma } from "@prisma/client";
import type { Scheduler } from "@hanoman/shared";
import { getSetting } from "../settings";

// Blok scheduler hidup di dalam Setting singleton (id=1). getSetting sudah mengisi default
// (zSetting.scheduler = SCHEDULER_DEFAULTS) untuk baris lama.
export async function getScheduler(): Promise<Scheduler> {
  return (await getSetting()).scheduler;
}

// Ganti seluruh blok scheduler; pertahankan field Setting lain (merge di atas getSetting).
export async function setScheduler(next: Scheduler): Promise<Scheduler> {
  const cur = await getSetting();
  const data = { ...cur, scheduler: next } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  return next;
}
```

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler/config.ts server/test/scheduler-config.service.test.ts
git commit -m "feat(spec-294): scheduler config service (get/set, merge-safe)"
```

---

### Task 5: `services/scheduler/queue.ts` (antrean durable)

**Files:**
- Create: `server/src/services/scheduler/queue.ts`
- Test: `server/test/scheduler-queue.service.test.ts`

**Interfaces:**
- Produces: `enqueue({specId,projectId,source,priority})`, `listQueue(status?)`, `queued()` (urut prioritas→FIFO), `markLaunched(id,sessionId)`, `markFailed(id,note?)`, `markDone(id)`, `queueItemForSpec(specId)`, `schedulerItemForSession(sessionId)`.

- [ ] **Step 1: Tulis test**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueue, listQueue, queued, markLaunched, markFailed, queueItemForSpec } from "../src/services/scheduler/queue";

const clean = () => prisma.schedulerQueueItem.deleteMany();
beforeEach(clean); afterAll(clean);

describe("scheduler queue", () => {
  it("enqueue is idempotent on specId (no duplicate rows)", async () => {
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "sedang" });
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "sedang" });
    expect((await listQueue()).length).toBe(1);
  });
  it("is durable: rows persist and re-read from DB", async () => {
    await enqueue({ specId: "SPEC-2", projectId: "p1", source: "errors", priority: "tinggi" });
    const again = await prisma.schedulerQueueItem.findUnique({ where: { specId: "SPEC-2" } });
    expect(again!.status).toBe("queued");
  });
  it("queued() orders by priority tinggi→sedang→rendah then FIFO", async () => {
    await enqueue({ specId: "SPEC-lo", projectId: "p1", source: "backlog", priority: "rendah" });
    await enqueue({ specId: "SPEC-hi", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-md", projectId: "p1", source: "backlog", priority: "sedang" });
    expect((await queued()).map((q) => q.specId)).toEqual(["SPEC-hi", "SPEC-md", "SPEC-lo"]);
  });
  it("markLaunched / markFailed move the item out of queued()", async () => {
    await enqueue({ specId: "SPEC-3", projectId: "p1", source: "triase", priority: "sedang" });
    const it0 = (await listQueue())[0]!;
    await markLaunched(it0.id, "spec_3");
    expect((await queued()).length).toBe(0);
    expect((await queueItemForSpec("SPEC-3"))!.status).toBe("launched");
    expect((await queueItemForSpec("SPEC-3"))!.sessionId).toBe("spec_3");
    // failed juga keluar dari queued()
    await enqueue({ specId: "SPEC-4", projectId: "p1", source: "backlog", priority: "sedang" });
    const it1 = (await listQueue()).find((x) => x.specId === "SPEC-4")!;
    await markFailed(it1.id, "needs-bind");
    expect((await queueItemForSpec("SPEC-4"))!.status).toBe("failed");
    expect((await queueItemForSpec("SPEC-4"))!.note).toBe("needs-bind");
  });
});
```

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-queue`
Expected: FAIL.

- [ ] **Step 3: Implement `queue.ts`**

```ts
import { prisma } from "../../db";
import type { SchedulerQueueItem } from "@prisma/client";

const RANK: Record<string, number> = { tinggi: 0, sedang: 1, rendah: 2 };

export type EnqueueInput = { specId: string; projectId: string; source: string; priority: string };

// Idempoten via specId @unique: bila item sudah ada (queued/launched/done/failed) → no-op (update {}),
// jangan resurrect item yang sudah diproses. Backlog checker menyaring baseSha≠null; errors/triase
// membuat Spec baru tiap kali, jadi re-enqueue hanya kena dalam jendela queued/launched.
export async function enqueue(i: EnqueueInput): Promise<void> {
  await prisma.schedulerQueueItem.upsert({
    where: { specId: i.specId },
    update: {},
    create: { specId: i.specId, projectId: i.projectId, source: i.source, priority: i.priority },
  });
}

export function listQueue(status?: string): Promise<SchedulerQueueItem[]> {
  return prisma.schedulerQueueItem.findMany(status ? { where: { status } } : {});
}

// Item siap-drain, urut prioritas lalu FIFO (enqueuedAt). Sort di memori: himpunan kecil.
export async function queued(): Promise<SchedulerQueueItem[]> {
  const items = await prisma.schedulerQueueItem.findMany({ where: { status: "queued" } });
  return items.sort((a, b) =>
    (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1)
    || a.enqueuedAt.getTime() - b.enqueuedAt.getTime());
}

export async function markLaunched(id: string, sessionId: string): Promise<void> {
  await prisma.schedulerQueueItem.update({ where: { id }, data: { status: "launched", sessionId, launchedAt: new Date() } });
}
export async function markFailed(id: string, note?: string): Promise<void> {
  await prisma.schedulerQueueItem.update({ where: { id }, data: { status: "failed", note: note ?? null } });
}
export async function markDone(id: string): Promise<void> {
  await prisma.schedulerQueueItem.update({ where: { id }, data: { status: "done" } });
}
export function queueItemForSpec(specId: string): Promise<SchedulerQueueItem | null> {
  return prisma.schedulerQueueItem.findUnique({ where: { specId } });
}
export function schedulerItemForSession(sessionId: string): Promise<SchedulerQueueItem | null> {
  return prisma.schedulerQueueItem.findFirst({ where: { sessionId } });
}
```

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-queue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler/queue.ts server/test/scheduler-queue.service.test.ts
git commit -m "feat(spec-294): durable scheduler queue (enqueue idempotent, priority order)"
```

---

### Task 6: `services/scheduler/registry.ts` (source registry + cadence clock)

**Files:**
- Create: `server/src/services/scheduler/registry.ts`
- Test: `server/test/scheduler-registry.test.ts`

**Interfaces:**
- Produces: `registerSchedulerSource({id, check})`, `listSources()`, `clearSources()`, `getLastRun(id)`, `setLastRun(id,t)`, `isDue(id, everyMin, now)`. Type `SchedulerSource = { id: string; check: () => Promise<void> }`.

- [ ] **Step 1: Tulis test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerSchedulerSource, listSources, clearSources, isDue, setLastRun } from "../src/services/scheduler/registry";

beforeEach(clearSources);

describe("scheduler registry", () => {
  it("registers and lists sources", () => {
    registerSchedulerSource({ id: "backlog", check: async () => {} });
    registerSchedulerSource({ id: "errors", check: async () => {} });
    expect(listSources().map((s) => s.id).sort()).toEqual(["backlog", "errors"]);
  });
  it("re-registering the same id replaces (no duplicate)", () => {
    registerSchedulerSource({ id: "backlog", check: async () => {} });
    registerSchedulerSource({ id: "backlog", check: async () => {} });
    expect(listSources().length).toBe(1);
  });
  it("isDue: true when never run, false within window, true after window", () => {
    const now = 1_000_000;
    expect(isDue("s", 15, now)).toBe(true);        // belum pernah
    setLastRun("s", now);
    expect(isDue("s", 15, now + 14 * 60_000)).toBe(false);  // 14 mnt < 15
    expect(isDue("s", 15, now + 15 * 60_000)).toBe(true);   // 15 mnt ≥ 15
  });
});
```

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-registry`
Expected: FAIL.

- [ ] **Step 3: Implement `registry.ts`**

```ts
// SPEC-294 · ADR-0072 · registry source in-memory + jam cadence. Daun (backlog/errors/triase)
// memanggil registerSchedulerSource saat boot (diimport server.ts). lastRun reset saat restart →
// satu boot-pass (cermin vps-monitor). Cadence disimpan di Setting; jam "kapan terakhir" cukup RAM.
export type SchedulerSource = { id: string; check: () => Promise<void> };

const sources = new Map<string, SchedulerSource>();
const lastRun = new Map<string, number>();

export function registerSchedulerSource(s: SchedulerSource): void { sources.set(s.id, s); }
export function listSources(): SchedulerSource[] { return [...sources.values()]; }
export function clearSources(): void { sources.clear(); lastRun.clear(); } // test-only reset

export function getLastRun(id: string): number | undefined { return lastRun.get(id); }
export function setLastRun(id: string, t: number): void { lastRun.set(id, t); }
export function isDue(id: string, everyMin: number, now: number): boolean {
  const last = lastRun.get(id);
  return last === undefined || now - last >= everyMin * 60_000;
}
```

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler/registry.ts server/test/scheduler-registry.test.ts
git commit -m "feat(spec-294): scheduler source registry + cadence clock"
```

---

### Task 7: Ekstrak `startSpecSession` (`services/session-launch.ts`) + refactor `terminal.ts`

**Files:**
- Create: `server/src/services/session-launch.ts`
- Modify: `server/src/services/pty.ts` (export `sessionIdForSpec`)
- Modify: `server/src/routes/terminal.ts` (cabang `"spec" in parsed.data` pakai `startSpecSession`)
- Test: reuse `server/test/*terminal*`/parity — pastikan hijau (tanpa regresi). Tambah `server/test/session-launch.test.ts` untuk error `needs-bind`.

**Interfaces:**
- Consumes: `resolveRepoDir`, `sessionModel`, `realGit`, `createSession`, `getSession`, `phaseFilePath`, `decisionFilePath`, `startPrompt`, `continuePrompt`.
- Produces: `sessionIdForSpec(specId): string`; `startSpecSession(spec, {flow, model?, effort?}): Promise<{id, reused?}>`; `class LaunchError extends Error { kind: "needs-bind" | "worktree" }`.

- [ ] **Step 1: Tulis test (`session-launch.test.ts`)**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { startSpecSession, LaunchError, sessionIdForSpec } from "../src/services/session-launch";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("session-launch", () => {
  it("sessionIdForSpec sanitizes to tmux-safe id", () => {
    expect(sessionIdForSpec("SPEC-12")).toBe("spec-12");
  });
  it("throws LaunchError needs-bind when the project has no local checkout", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } }); // repoDir null
    const spec = await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "" } });
    await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "needs-bind" });
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.baseSha).toBeNull(); // tak menyentuh baseSha
  });
});
```

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- session-launch`
Expected: FAIL (module tak ada).

- [ ] **Step 3: `pty.ts` — export `sessionIdForSpec`**

Ganti `const idFor = (specId?) => …` agar berbagi helper. Tambah tepat di atas `idFor`:
```ts
// SPEC-294 · id sesi deterministik dari spec (tmux menolak `.`/`:`). Dipakai terminal route,
// session-launch, dan governor scheduler — satu definisi, tak ada divergensi.
export const sessionIdForSpec = (specId: string): string =>
  specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
```
lalu ubah `idFor`:
```ts
const idFor = (specId?: string) =>
  specId ? sessionIdForSpec(specId) : randomUUID().slice(0, 8);
```

- [ ] **Step 4: Implement `session-launch.ts`**

```ts
import { prisma } from "../db";
import type { Spec } from "@prisma/client";
import { realGit, startPrompt, continuePrompt, type Flow } from "@hanoman/runner";
import { resolveRepoDir } from "./local-binding";
import { sessionModel } from "./settings";
import { createSession, getSession, sessionIdForSpec } from "./pty";
import { phaseFilePath, decisionFilePath } from "./session-phases";

// Satu jalur peluncuran sesi backlog — dipakai POST /terminal/sessions (manual) & governor scheduler.
// Melempar LaunchError dengan `kind` agar pemanggil memetakan status HTTP / menandai antrean.
export class LaunchError extends Error {
  constructor(message: string, readonly kind: "needs-bind" | "worktree") { super(message); }
}
export type StartSpecResult = { id: string; reused?: boolean };

export async function startSpecSession(
  spec: Spec, opts: { flow: Flow; model?: string; effort?: string },
): Promise<StartSpecResult> {
  const repoDir = await resolveRepoDir(spec.projectId);
  if (!repoDir) throw new LaunchError(`project "${spec.projectId}" belum di-bind ke checkout lokal`, "needs-bind");

  const id = sessionIdForSpec(spec.id);
  // Sesi hidup: JANGAN bangun ulang worktree (ada kerja belum-commit) — re-attach (ADR-0015).
  const live = getSession(id);
  if (live) return { id: live.id, reused: true };

  const g = await sessionModel();
  const model = opts.model ?? g.model;
  const effort = opts.effort ?? g.effort;
  const isContinue = spec.stage === "done";

  let baseSha: string;
  try {
    baseSha = realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, spec.branchFrom ?? "HEAD");
  } catch (e) {
    throw new LaunchError(`gagal membuat worktree: ${(e as Error).message}`, "worktree");
  }
  await prisma.spec.update({ where: { id: spec.id }, data: { baseSha, headSha: null } });

  const brief = {
    id: spec.id, title: spec.title, source: spec.source,
    priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
  };
  const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
    specId: spec.id, flow: opts.flow, model, effort,
    phaseFile: phaseFilePath(repoDir, id),
    decisionFile: decisionFilePath(repoDir, id),
    prompt: isContinue
      ? continuePrompt(opts.flow, brief, `hanoman/${id}`)
      : startPrompt(opts.flow, brief, `hanoman/${id}`),
  });
  return { id: s.id };
}
```

- [ ] **Step 5: Refactor `terminal.ts` cabang spec**

Ganti seluruh blok `if ("spec" in parsed.data) { … }` (baris ~61–115) menjadi:
```ts
    if ("spec" in parsed.data) {
      const spec = await prisma.spec.findUnique({ where: { id: parsed.data.spec } });
      if (!spec) return reply.code(404).send({ error: "spec not found" });
      try {
        const r = await startSpecSession(spec, {
          flow: parsed.data.flow, model: parsed.data.model, effort: parsed.data.effort,
        });
        return reply.code(201).send({ id: r.id });
      } catch (e) {
        if (e instanceof LaunchError) {
          // Parity status: needs-bind → 400 {needsBind}, worktree gagal → 422.
          return e.kind === "needs-bind"
            ? reply.code(400).send({ error: e.message, needsBind: true })
            : reply.code(422).send({ error: e.message });
        }
        throw e;
      }
    }
```
Tambah import di atas: `import { startSpecSession, LaunchError } from "../services/session-launch";`
Hapus import yang jadi tak terpakai di cabang ini bila TS mengeluh (mis. `startPrompt`/`continuePrompt`/`phaseFilePath`/`decisionFilePath` masih dipakai cabang lain — pertahankan; hanya buang yang benar-benar yatim).

- [ ] **Step 6: Jalankan test terkait — hijau tanpa regresi**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- session-launch terminal parity`
Expected: PASS (session-launch baru + suite terminal/parity yang ada tetap hijau).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/session-launch.ts server/src/services/pty.ts server/src/routes/terminal.ts server/test/session-launch.test.ts
git commit -m "refactor(spec-294): extract startSpecSession (shared by manual Start + governor)"
```

---

### Task 8: `services/scheduler/governor.ts` (drain di bawah cap)

**Files:**
- Create: `server/src/services/scheduler/governor.ts`
- Test: `server/test/scheduler-governor.test.ts`

**Interfaces:**
- Consumes: `queued`, `markLaunched`, `markFailed` (Task 5); `Scheduler` (shared); `SchedulerQueueItem` (Prisma).
- Produces: `type GovernorDeps = { liveCount: () => number; isLive: (specId) => string | null; launch: (item) => Promise<string> }`; `drain(cfg: Scheduler, deps: GovernorDeps): Promise<void>`.

- [ ] **Step 1: Tulis test (deps di-inject, antrean DB nyata)**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueue, queueItemForSpec, listQueue } from "../src/services/scheduler/queue";
import { drain, type GovernorDeps } from "../src/services/scheduler/governor";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = () => prisma.schedulerQueueItem.deleteMany();
beforeEach(clean); afterAll(clean);
const cfg = (over = {}) => ({ ...SCHEDULER_DEFAULTS, enabled: true, ...over });

describe("governor.drain", () => {
  it("never launches beyond cap (live count invariant)", async () => {
    for (const p of ["a", "b", "c", "d"]) await enqueue({ specId: `SPEC-${p}`, projectId: "p1", source: "backlog", priority: "sedang" });
    let launched = 0;
    const deps: GovernorDeps = { liveCount: () => launched, isLive: () => null, launch: async () => { launched++; return `s${launched}`; } };
    await drain(cfg({ maxConcurrent: 2 }), deps);
    expect(launched).toBe(2);                                   // cap dihormati
    expect((await listQueue("launched")).length).toBe(2);
    expect((await listQueue("queued")).length).toBe(2);        // sisanya tertahan
  });
  it("does nothing when live already at cap", async () => {
    await enqueue({ specId: "SPEC-x", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    const deps: GovernorDeps = { liveCount: () => 3, isLive: () => null, launch: async () => { launches++; return "s"; } };
    await drain(cfg({ maxConcurrent: 3 }), deps);
    expect(launches).toBe(0);
    expect((await listQueue("queued")).length).toBe(1);
  });
  it("idempotent: a spec already live is marked launched without consuming a slot", async () => {
    await enqueue({ specId: "SPEC-live", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-new", projectId: "p1", source: "backlog", priority: "sedang" });
    let launches = 0;
    const deps: GovernorDeps = {
      liveCount: () => 1,                                        // SPEC-live sudah dihitung live
      isLive: (specId) => (specId === "SPEC-live" ? "spec_live" : null),
      launch: async () => { launches++; return "spec_new"; },
    };
    await drain(cfg({ maxConcurrent: 2 }), deps);
    expect(launches).toBe(1);                                   // hanya SPEC-new benar-benar di-launch
    expect((await queueItemForSpec("SPEC-live"))!.status).toBe("launched");
    expect((await queueItemForSpec("SPEC-live"))!.sessionId).toBe("spec_live");
    expect((await queueItemForSpec("SPEC-new"))!.status).toBe("launched");
  });
  it("marks an item failed when launch throws (no retry, next item still processed)", async () => {
    await enqueue({ specId: "SPEC-bad", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-ok", projectId: "p1", source: "backlog", priority: "sedang" });
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null,
      launch: async (item) => { if (item.specId === "SPEC-bad") throw new Error("needs-bind"); return "s_ok"; },
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect((await queueItemForSpec("SPEC-bad"))!.status).toBe("failed");
    expect((await queueItemForSpec("SPEC-bad"))!.note).toBe("needs-bind");
    expect((await queueItemForSpec("SPEC-ok"))!.status).toBe("launched");
  });
});
```

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-governor`
Expected: FAIL.

- [ ] **Step 3: Implement `governor.ts`**

```ts
import type { Scheduler } from "@hanoman/shared";
import type { SchedulerQueueItem } from "@prisma/client";
import { queued, markLaunched, markFailed } from "./queue";

// Deps di-inject agar teruji tanpa tmux/claude. Produksi mengikatnya ke pty + startSpecSession (engine.ts).
export type GovernorDeps = {
  liveCount: () => number;                          // sesi hidup gabungan manual+scheduler (pty.listSessions)
  isLive: (specId: string) => string | null;       // sessionId hidup untuk spec, atau null
  launch: (item: SchedulerQueueItem) => Promise<string>;  // spawn sesi → sessionId; throw = gagal
};

// Reentrancy guard: satu drain jalan pada satu waktu (tick + trigger sesi-berakhir tak balapan).
let draining = false;

export async function drain(cfg: Scheduler, deps: GovernorDeps): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    let slots = cfg.maxConcurrent - deps.liveCount();
    if (slots <= 0) return;
    for (const item of await queued()) {
      if (slots <= 0) break;
      // Idempoten satu-sesi-per-spec: sesi spec sudah hidup (mis. di-Start manual) → tandai launched
      // tanpa makan slot (sudah terhitung di liveCount) & tanpa spawn kedua.
      const liveId = deps.isLive(item.specId);
      if (liveId) { await markLaunched(item.id, liveId); continue; }
      try {
        const sessionId = await deps.launch(item);
        await markLaunched(item.id, sessionId);
        slots--;
      } catch (e) {
        // Gagal (mis. project belum di-bind) → tandai, TANPA retry (PRD non-goal). Slot tak terpakai.
        await markFailed(item.id, (e as Error).message);
      }
    }
  } finally { draining = false; }
}
```

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-governor`
Expected: PASS (4 tes).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler/governor.ts server/test/scheduler-governor.test.ts
git commit -m "feat(spec-294): concurrency governor drains queue under cap (invariant tested)"
```

---

### Task 9: `services/scheduler/engine.ts` (tick + gating + Pause + start/stop)

**Files:**
- Create: `server/src/services/scheduler/engine.ts`
- Test: `server/test/scheduler-engine.test.ts`

**Interfaces:**
- Consumes: `getScheduler` (Task 4), `listSources`/`isDue`/`setLastRun` (Task 6), `drain`/`GovernorDeps` (Task 8), `listSessions`/`getSession`/`sessionIdForSpec` (pty), `startSpecSession` (Task 7), `flowForSource` (shared).
- Produces: `tick(now: number, deps: GovernorDeps): Promise<void>`; `startScheduler(deps?)`; `stopScheduler()`; `prodDeps: GovernorDeps`.

- [ ] **Step 1: Tulis test dengan stub source (membuktikan gating enable+cadence + Pause)**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { tick } from "../src/services/scheduler/engine";
import { registerSchedulerSource, clearSources } from "../src/services/scheduler/registry";
import { setScheduler } from "../src/services/scheduler/config";
import { enqueue, listQueue } from "../src/services/scheduler/queue";
import { SCHEDULER_DEFAULTS, type Scheduler } from "@hanoman/shared";
import type { GovernorDeps } from "../src/services/scheduler/governor";

const clean = async () => { await prisma.schedulerQueueItem.deleteMany(); await prisma.setting.deleteMany(); };
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const noLaunch: GovernorDeps = { liveCount: () => 0, isLive: () => null, launch: async () => "s" };
const cfg = (over: Partial<Scheduler> = {}): Scheduler => ({ ...SCHEDULER_DEFAULTS, ...over });
const withBacklog = (enabled: boolean, everyMin = 15): Scheduler =>
  cfg({ enabled: true, sources: { ...SCHEDULER_DEFAULTS.sources, backlog: { enabled, everyMin } } });

describe("engine.tick gating", () => {
  it("does not call a disabled source's check", async () => {
    let checks = 0;
    registerSchedulerSource({ id: "backlog", check: async () => { checks++; } });
    await setScheduler(withBacklog(false));
    await tick(1_000_000, noLaunch);
    expect(checks).toBe(0);
  });
  it("calls an enabled source's check when due, and skips it before the window elapses", async () => {
    let checks = 0;
    registerSchedulerSource({ id: "backlog", check: async () => { checks++; } });
    await setScheduler(withBacklog(true, 15));
    const t0 = 1_000_000;
    await tick(t0, noLaunch);                 // belum pernah → due
    expect(checks).toBe(1);
    await tick(t0 + 14 * 60_000, noLaunch);   // 14 mnt < 15 → skip
    expect(checks).toBe(1);
    await tick(t0 + 15 * 60_000, noLaunch);   // 15 mnt → due lagi
    expect(checks).toBe(2);
  });
  it("master enabled=false makes the whole tick idle (no check, no drain)", async () => {
    let checks = 0;
    registerSchedulerSource({ id: "backlog", check: async () => { checks++; } });
    await setScheduler(cfg({ enabled: false, sources: { ...SCHEDULER_DEFAULTS.sources, backlog: { enabled: true, everyMin: 15 } } }));
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    await tick(1_000_000, { ...noLaunch, launch: async () => { launches++; return "s"; } });
    expect(checks).toBe(0);
    expect(launches).toBe(0);
  });
  it("Pause blocks launches within one tick (checkers may run, drain does not)", async () => {
    await setScheduler(cfg({ enabled: true, paused: true, maxConcurrent: 5 }));
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    await tick(1_000_000, { liveCount: () => 0, isLive: () => null, launch: async () => { launches++; return "s"; } });
    expect(launches).toBe(0);                          // Pause → tak ada peluncuran
    expect((await listQueue("queued")).length).toBe(1); // item tetap di antrean
  });
  it("un-paused, the next tick drains the queued item", async () => {
    await setScheduler(cfg({ enabled: true, paused: false, maxConcurrent: 5 }));
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    await tick(1_000_000, { liveCount: () => 0, isLive: () => null, launch: async () => { launches++; return "s1"; } });
    expect(launches).toBe(1);
  });
});
```

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-engine`
Expected: FAIL.

- [ ] **Step 3: Implement `engine.ts`**

```ts
import { prisma } from "../../db";
import { flowForSource } from "@hanoman/shared";
import { getScheduler } from "./config";
import { listSources, isDue, setLastRun } from "./registry";
import { drain, type GovernorDeps } from "./governor";
import { listSessions, getSession, sessionIdForSpec } from "../pty";
import { startSpecSession } from "../session-launch";

// Satu tick: jalankan checker source yang enabled & jatuh-tempo, lalu drain antrean (kecuali Pause).
// now di-parameter agar cadence teruji deterministik.
export async function tick(now: number, deps: GovernorDeps): Promise<void> {
  const cfg = await getScheduler();
  if (!cfg.enabled) return;                       // master off → idle penuh
  for (const src of listSources()) {
    const sc = (cfg.sources as Record<string, { enabled: boolean; everyMin: number }>)[src.id];
    if (sc?.enabled && isDue(src.id, sc.everyMin, now)) {
      setLastRun(src.id, now);
      try { await src.check(); } catch { /* satu source gagal tak menghentikan sisanya */ }
    }
  }
  if (cfg.paused) return;                          // rem darurat: tak ada drain → tak ada peluncuran baru
  await drain(cfg, deps);
}

// Deps produksi: cap dihitung dari sesi tmux hidup; launch lewat jalur bersama startSpecSession.
export const prodDeps: GovernorDeps = {
  liveCount: () => listSessions().filter((s) => !s.exited).length,
  isLive: (specId) => { const s = getSession(sessionIdForSpec(specId)); return s && !s.exited ? s.id : null; },
  launch: async (item) => {
    const spec = await prisma.spec.findUnique({ where: { id: item.specId } });
    if (!spec) throw new Error(`spec ${item.specId} tak ada`);
    const r = await startSpecSession(spec, { flow: flowForSource(spec.source) });
    return r.id;
  },
};

const TICK_MS = 10_000;   // governor tick: cukup halus untuk "drain ≤1 tick" saat slot kosong
let timer: NodeJS.Timeout | undefined;

// Dipanggil server.ts SAJA (app.ts bebas-timer). unref → tak menahan proses; boot-pass segera.
export function startScheduler(deps: GovernorDeps = prodDeps): void {
  if (timer) return;
  timer = setInterval(() => void tick(Date.now(), deps), TICK_MS);
  timer.unref();
  void tick(Date.now(), deps);
}
export function stopScheduler(): void { if (timer) clearInterval(timer); timer = undefined; }
```

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler-engine`
Expected: PASS (5 tes).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler/engine.ts server/test/scheduler-engine.test.ts
git commit -m "feat(spec-294): scheduler engine tick (enable+cadence gating, Pause, start/stop)"
```

---

### Task 10: Route `scheduler.ts` + wire `app.ts` + `agent-capabilities` + `server.ts`

**Files:**
- Create: `server/src/routes/scheduler.ts`
- Modify: `server/src/app.ts` (register route)
- Modify: `server/src/services/agent-capabilities.ts` (map `/api/scheduler` → `settings`)
- Modify: `server/src/server.ts` (`startScheduler()` setelah listen)
- Test: `server/test/scheduler.route.test.ts`

**Interfaces:**
- Consumes: `getScheduler`/`setScheduler` (Task 4), `listQueue` (Task 5), `getLastRun` (Task 6), `listSessions` (pty), `zScheduler` (shared).
- Produces: `GET /api/scheduler/config`, `PUT /api/scheduler/config`, `GET /api/scheduler/state`.

- [ ] **Step 1: Tulis test**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { enqueue } from "../src/services/scheduler/queue";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.schedulerQueueItem.deleteMany(); await prisma.setting.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("scheduler routes", () => {
  it("GET /config returns all-off defaults", async () => {
    const r = await app.inject({ method: "GET", url: "/api/scheduler/config" });
    expect(r.statusCode).toBe(200);
    expect(r.json().enabled).toBe(false);
    expect(r.json().sources.errors.minCount).toBe(5);
  });
  it("PUT /config sets knobs incl. pause, GET reflects them", async () => {
    const body = { enabled: true, paused: true, maxConcurrent: 4, autonomy: "full-control",
      sources: { backlog: { enabled: true, everyMin: 5 }, errors: { enabled: false, everyMin: 15, minCount: 10 }, triase: { enabled: false, everyMin: 30 } } };
    const r = await app.inject({ method: "PUT", url: "/api/scheduler/config", payload: body });
    expect(r.statusCode).toBe(200);
    const g = await app.inject({ method: "GET", url: "/api/scheduler/config" });
    expect(g.json().paused).toBe(true);
    expect(g.json().maxConcurrent).toBe(4);
    expect(g.json().sources.backlog.everyMin).toBe(5);
  });
  it("PUT /config rejects invalid body (maxConcurrent 0)", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/scheduler/config", payload: { ...({}), maxConcurrent: 0 } });
    expect(r.statusCode).toBe(400);
  });
  it("GET /state exposes cap, queue contents, and per-source next/last-run shape", async () => {
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    const r = await app.inject({ method: "GET", url: "/api/scheduler/state" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.cap).toBe(2);
    expect(b.queue.length).toBe(1);
    expect(b.queue[0].specId).toBe("SPEC-1");
    expect(b.sources.map((s: any) => s.id).sort()).toEqual(["backlog", "errors", "triase"]);
  });
});
```

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler.route`
Expected: FAIL (route belum terdaftar).

- [ ] **Step 3: Implement `routes/scheduler.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { zScheduler } from "@hanoman/shared";
import { getScheduler, setScheduler } from "../services/scheduler/config";
import { listQueue } from "../services/scheduler/queue";
import { getLastRun } from "../services/scheduler/registry";
import { listSessions } from "../services/pty";

// SPEC-294 · ADR-0072 · config (knob) + state (antrean/sesi/cadence) scheduler. Di belakang gate cookie.
export default async function (app: FastifyInstance) {
  app.get("/scheduler/config", async () => getScheduler());

  app.put("/scheduler/config", async (req, reply) => {
    const parsed = zScheduler.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return setScheduler(parsed.data);   // ganti blok penuh (pola PUT /settings). Pause = { paused:true }.
  });

  app.get("/scheduler/state", async () => {
    const cfg = await getScheduler();
    const live = listSessions().filter((s) => !s.exited);
    const queue = await listQueue();
    const ids = ["backlog", "errors", "triase"] as const;
    const sources = ids.map((id) => {
      const sc = (cfg.sources as Record<string, { enabled: boolean; everyMin: number; minCount?: number }>)[id];
      const last = getLastRun(id);
      return {
        id, enabled: sc.enabled, everyMin: sc.everyMin,
        minCount: id === "errors" ? sc.minCount : undefined,
        lastRunAt: last ? new Date(last).toISOString() : null,
        nextRunAt: last ? new Date(last + sc.everyMin * 60_000).toISOString() : null,
      };
    });
    // Sesi scheduler = sesi live yang punya item antrean 'launched' (marker asal-scheduler).
    const launchedSpecs = new Set(queue.filter((q) => q.status === "launched").map((q) => q.specId));
    const sessions = live.filter((s) => s.specId && launchedSpecs.has(s.specId));
    return { config: cfg, cap: cfg.maxConcurrent, liveCount: live.length, sources, queue, sessions };
  });
}
```

- [ ] **Step 4: Register di `app.ts`**

Tambah import (dekat import route lain): `import scheduler from "./routes/scheduler";`
Tambah registrasi (setelah `await api.register(tickets);`):
```ts
    await api.register(scheduler);  // SPEC-294 · config/state scheduler (di belakang gate cookie)
```

- [ ] **Step 5: `agent-capabilities.ts` — map domain**

Tambah sebelum `if (top === "settings" || top === "config")`:
```ts
  if (top === "scheduler") return rw("settings");   // SPEC-294 · scheduler = setelan instance
```

- [ ] **Step 6: `server.ts` — start engine**

Tambah import: `import { startScheduler } from "./services/scheduler/engine";`
Di dalam `.then(() => { … })` setelah `startVpsMonitor();`:
```ts
    startScheduler(); // SPEC-294 · ADR-0072 · engine scheduler in-process (timer .unref, app.ts bebas-timer)
```

- [ ] **Step 7: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- scheduler.route`
Expected: PASS (4 tes).

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/scheduler.ts server/src/app.ts server/src/services/agent-capabilities.ts server/src/server.ts server/test/scheduler.route.test.ts
git commit -m "feat(spec-294): /api/scheduler config+state routes; wire engine in server.ts"
```

---

### Task 11: Docs SoT + full suite + real local boot/curl

**Files:**
- Modify: `internal/docs/architecture/data-model.md` (SchedulerQueueItem + Project.schedulerOptIn)
- Modify: `internal/docs/architecture/api-contract.md` (endpoint scheduler)
- Modify: `internal/docs/architecture/stack.md` (engine in-process = timer ketiga di server.ts; koreksi "dua setInterval")
- Modify: `internal/docs/README.md` (link ADR-0072)
- Test: seluruh suite server + shared hijau; boot + curl nyata.

**Interfaces:** — (dokumentasi + verifikasi)

- [ ] **Step 1: Update `data-model.md`** — tambah bagian `SchedulerQueueItem` (LOCAL-ONLY, tak disync, specId @unique idempoten satu-sesi-per-spec) + catat `Project.schedulerOptIn` (default false, pola helpEnabled, tak masuk FIELDS sync) di bagian Project.

- [ ] **Step 2: Update `api-contract.md`** — tambah blok `## Scheduler (SPEC-294 · ADR-0072)`:
```
## Scheduler (SPEC-294 · ADR-0072) — LOCAL per-instance
# GET  /api/scheduler/config -> Scheduler (semua default MATI). PUT /api/scheduler/config { Scheduler } ganti blok penuh (400 invalid); Pause = { paused:true }.
# GET  /api/scheduler/state  -> { config, cap, liveCount, sources:[{id,enabled,everyMin,minCount?,lastRunAt,nextRunAt}], queue:SchedulerQueueItem[], sessions:[live ber-item] }
#   Engine in-process (server.ts, timer .unref; app.ts bebas-timer) — checker per-source enable+cadence → enqueue; governor drain di bawah cap=maxConcurrent (pty.listSessions), Pause blokir drain ≤1 tick.
#   Opt-in per project: PATCH /api/projects/:id { schedulerOptIn } (lokal — tak masuk FIELDS sync). agent-token: domain settings.
```

- [ ] **Step 3: Update `stack.md`** — koreksi kalimat "dua `setInterval` di `server.ts`" menjadi menyertakan engine scheduler (SPEC-294/ADR-0072) sebagai kerja latar ketiga yang di-`start` dari server.ts (tetap in-process, tanpa cron/worker/broker; membalik sebagian ADR-0024).

- [ ] **Step 4: Update `README.md`** — tambah baris ADR:
```
- [0072 — Fondasi scheduler otonom: engine in-process, antrean durable, cap concurrency](adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md) — **membalik sebagian 0024**, memperluas 0015/0016/0025/0049 (SPEC-294)
```

- [ ] **Step 5: Full suite hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared test && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- --no-file-parallelism`
Expected: semua PASS (tak ada regresi). Bila `scheduler_queue`/setting collide dgn suite sibling di `hanoman_test` → jalankan ulang; bila persist, pindah ke base DB khusus (lihat memory) — TAPI utamakan additive migrate ke hanoman_test.

- [ ] **Step 6: Boot server + curl nyata (bukti API)**

```bash
cd server && env DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman_test" NODE_ENV=development node dist/server.js &
# (build dulu bila perlu: pnpm --filter ./server build)
sleep 1
curl -s localhost:8787/api/scheduler/config | head -c 400; echo
curl -s -XPUT localhost:8787/api/scheduler/config -H 'content-type: application/json' \
  -d '{"enabled":true,"paused":false,"maxConcurrent":2,"autonomy":"butuh-keputusan","sources":{"backlog":{"enabled":false,"everyMin":15},"errors":{"enabled":false,"everyMin":15,"minCount":5},"triase":{"enabled":false,"everyMin":30}}}' | head -c 200; echo
curl -s localhost:8787/api/scheduler/state | head -c 400; echo
```
Expected: config JSON (enabled default false lalu true setelah PUT), state JSON dengan `cap`, `queue`, `sources[3]`. (Auth: server.ts gate aktif — bila 401, jalankan curl dengan cookie sesi atau boot via test-harness inject seperti langkah 5. Utamakan langkah 5 sebagai bukti bila boot berpenjaga auth.)

- [ ] **Step 7: Commit docs**

```bash
git add internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md internal/docs/architecture/stack.md internal/docs/README.md
git commit -m "docs(spec-294): scheduler foundation — data-model, api-contract, stack, ADR index"
```

---

## Self-Review (diisi penulis plan)

- **Spec coverage:** engine in-process (Task 9/10 server.ts) ✓; antrean durable lintas-restart (Task 1/5) ✓; cap dari listSessions + drain ≤1 tick + hold + priority + idempoten (Task 8) ✓; Pause ≤1 tick (Task 9) ✓; source-stub gating enable+cadence (Task 9) ✓; endpoint config/PUT/state (Task 10) ✓; migration aditif + semua default mati (Task 1/2/3) ✓; kontrak registerSchedulerSource/enqueue (Task 5/6) ✓; opt-in per project default mati (Task 1/3) ✓; local per-instance/no-sync (Task 1 + tak sentuh FIELDS) ✓.
- **Placeholder scan:** tak ada TBD/"handle edge cases" tanpa kode — tiap step membawa kode/perintah nyata.
- **Type consistency:** `GovernorDeps{liveCount,isLive,launch}` sama di Task 8/9; `sessionIdForSpec` dipakai Task 7/9; `SCHEDULER_DEFAULTS`/`zScheduler` Task 2 dipakai 3/4/8/9/10; `startSpecSession(spec,{flow,...})` Task 7 dipakai 9.
