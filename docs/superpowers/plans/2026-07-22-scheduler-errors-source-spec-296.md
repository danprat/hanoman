# SPEC-296 — Source-checker Errors (batch fixing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah scheduler source-checker `errors` yang, per grup `ErrorGroup` eligible (new, produksi, count≥ambang, project opt-in, belum ber-specId), memanggil jalur escalate lalu meng-enqueue peluncuran sesinya — dibatasi hanya oleh cap governor.

**Architecture:** Ekstrak inti escalate dari `routes/errors.ts` ke `services/error-escalate.ts` (route mendelegasikan; kontrak HTTP tak berubah) agar checker memakai ulang **jalur yang sama**. Checker baru `services/scheduler/sources/errors.ts` menyaring grup di query (idempotensi gratis), escalate tiap grup, lalu `enqueue({ source:"errors", priority:"tinggi" })`. Registrasi di `server.ts` sebelum `startScheduler()`.

**Tech Stack:** Node + TypeScript (strict), Fastify, Prisma (Postgres), Vitest. Fondasi scheduler SPEC-294/ADR-0072 (registry/queue/governor/engine/config).

## Global Constraints

- TypeScript strict; ikuti pola file scheduler yang ada (`sources/backlog.ts`, `queue.ts`).
- **Tanpa** perubahan skema, migration, ADR baru, atau endpoint baru — murni aditif pada kontrak fondasi + refactor internal.
- `SchedulerQueueItem.source` = **asal checker** (`"errors"`), bukan `spec.source`.
- Enqueue **idempoten** via `specId @unique` (upsert `update:{}`); checker tak dedup manual.
- Definisi "produksi" = literal `environment === "production"` (cermin `services/error-ingest.ts`).
- Ambang = `Setting.scheduler.sources.errors.minCount` (default 5), **bukan** konstanta.
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama** (konvensi SoT).
- Test WAJIB `cd server && npx vitest run --no-file-parallelism` (race DB tanpa flag). Shell env menunjuk prod → override `DATABASE_URL`/`NODE_ENV` per perintah; DB base khusus `hanoman296` (+`_test`).
- Commit message diakhiri `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Ekstrak jalur escalate → `services/error-escalate.ts`

Refactor murni: pindahkan inti escalate ke fungsi service; route mendelegasikan. Perilaku HTTP dijaga oleh test regresi yang sudah ada (`errors-escalate.route.test.ts`).

**Files:**
- Create: `server/src/services/error-escalate.ts`
- Modify: `server/src/routes/errors.ts:70-112` (handler escalate) + hapus import yang jadi tak terpakai
- Test (regresi, sudah ada): `server/test/errors-escalate.route.test.ts`
- Docs: `internal/docs/architecture/api-contract.md` (§Errors/escalate)

**Interfaces:**
- Produces: `escalateErrorGroup(group: ErrorGroup, opts: { author: string }): Promise<{ spec: Spec; created: boolean }>` — `created:false` bila `group.specId` sudah ada (idempoten), else buat Spec qa + link + `notifySynced` ×2.

- [ ] **Step 1: Jalankan test regresi untuk memastikan HIJAU sebelum refactor**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman296' NODE_ENV=test npx vitest run test/errors-escalate.route.test.ts --no-file-parallelism`
Expected: PASS (semua describe escalate/unlink/patch hijau)

- [ ] **Step 2: Buat `server/src/services/error-escalate.ts`**

```ts
import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";
import type { ErrorGroup, Spec } from "@prisma/client";

// SPEC-296 · inti eskalasi grup error → Spec qa, dipisah dari routes/errors.ts agar dipakai ulang
// oleh scheduler source-checker errors (JALUR yang sama, bukan duplikat). Kontrak HTTP route tak
// berubah. Idempoten via group.specId (grup sudah tertaut → kembalikan Spec tanpa membuat kedua).
export async function escalateErrorGroup(
  group: ErrorGroup, opts: { author: string },
): Promise<{ spec: Spec; created: boolean }> {
  if (group.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: group.specId } });
    return { spec: spec!, created: false };
  }
  const short = group.message.length > 80 ? group.message.slice(0, 77) + "…" : group.message;
  const topStack = (group.sampleStack ?? "").split("\n").slice(0, 12).join("\n");
  const backlink = `Dari Error monitoring: grup ${group.id} (${group.count}×, ${group.environment}).`;
  const payload = {
    severity: "major" as const,
    steps: "Otomatis dari Error monitoring — reproduksi dari stack sampel.",
    expected: "Tidak ada error.",
    actual: `${group.type}: ${group.message}\n\n${topStack}\n\n${backlink}`,
    env: group.environment,
    fromErrorGroup: group.id,
  };
  const repoDir = await resolveRepoDir(group.projectId);
  // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin routes/specs.
  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({
        data: {
          id: sid, projectId: group.projectId, title: `${group.type}: ${short}`, source: "qa",
          stage: "brainstorming", priority: "tinggi", author: `QA · ${opts.author}`,
          objective: `${group.type}: ${group.message}. ${backlink}`, payload,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  await prisma.errorGroup.update({ where: { id: group.id }, data: { status: "escalated", specId: spec!.id } });
  await notifySynced("spec", spec!.id);   // SPEC-213/268 · spec ke feed
  await notifySynced("errorGroup", group.id); // SPEC-268 · status grup ke feed
  return { spec: spec!, created: true };
}
```

- [ ] **Step 3: Ganti handler escalate di `server/src/routes/errors.ts` agar mendelegasikan**

Ganti seluruh blok `app.post("/errors/:id/escalate", …)` (baris 69–112) dengan:

```ts
  // SPEC-249/296 · ADR-0060 · eskalasi grup → Spec qa (inti di services/error-escalate.ts,
  // dipakai ulang scheduler). Idempoten via group.specId.
  app.post("/errors/:id/escalate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    const { spec, created } = await escalateErrorGroup(g, { author: req.user?.email ?? "system" });
    return created
      ? reply.code(201).send({ spec })
      : reply.code(200).send({ alreadyEscalated: true, spec });
  });
```

- [ ] **Step 4: Rapikan import `server/src/routes/errors.ts`**

Tambahkan import service; hapus `nextSpecId` & `resolveRepoDir` (kini hanya dipakai di service). `notifySynced` **tetap** (dipakai handler `unlink` & `patch`).

Hapus baris:
```ts
import { nextSpecId } from "../services/id";
import { resolveRepoDir } from "../services/local-binding";
```
Tambah baris (dekat import service lain):
```ts
import { escalateErrorGroup } from "../services/error-escalate";
```

- [ ] **Step 5: Jalankan test regresi + typecheck**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman296' NODE_ENV=test npx vitest run test/errors-escalate.route.test.ts --no-file-parallelism && npx tsc -p . --noEmit`
Expected: PASS (perilaku 201/200/404 tak berubah) + tsc exit 0

- [ ] **Step 6: Catat di `internal/docs/architecture/api-contract.md`**

Di bagian Errors/escalate, tambahkan satu kalimat: inti escalate kini di `services/error-escalate.ts` (`escalateErrorGroup`), dipakai route **dan** scheduler source-checker; kontrak HTTP `POST /errors/:id/escalate` (201/200/404) tak berubah.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/error-escalate.ts server/src/routes/errors.ts internal/docs/architecture/api-contract.md
git commit -m "refactor(spec-296): ekstrak escalate grup error ke services/error-escalate.ts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Source-checker `checkErrors`

Checker baru: query grup eligible → escalate (jalur Task 1) → enqueue. TDD.

**Files:**
- Create: `server/src/services/scheduler/sources/errors.ts`
- Create (test): `server/test/scheduler-source-errors.test.ts`

**Interfaces:**
- Consumes: `escalateErrorGroup` (Task 1); `enqueue` (`queue.ts`); `getScheduler` (`config.ts`); `registerSchedulerSource` (`registry.ts`).
- Produces: `checkErrors(): Promise<void>`; `registerErrorsSource(): void`.

- [ ] **Step 1: Tulis test yang gagal `server/test/scheduler-source-errors.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { checkErrors, registerErrorsSource } from "../src/services/scheduler/sources/errors";
import { listQueue } from "../src/services/scheduler/queue";
import { listSources, clearSources } from "../src/services/scheduler/registry";
import { setScheduler, getScheduler } from "../src/services/scheduler/config";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const mkProject = (id: string, schedulerOptIn: boolean) =>
  prisma.project.create({ data: { id, name: id, desc: "", kind: "existing", schedulerOptIn } });
const mkGroup = (over: Partial<Parameters<typeof prisma.errorGroup.create>[0]["data"]> & { projectId: string }) =>
  prisma.errorGroup.create({ data: {
    projectId: over.projectId, fingerprint: `fp-${Math.random()}`, type: "TypeError",
    message: "Cannot read properties of undefined", sampleStack: "TypeError\n    at h (/x.js:1:1)",
    environment: "production", status: "new", count: 10, ...over,
  } });

describe("errors source-checker", () => {
  it("escalates + enqueues only eligible groups (new, production, count>=minCount, opt-in)", async () => {
    await mkProject("opt", true);
    const g = await mkGroup({ projectId: "opt", count: 7 });
    await checkErrors();
    const q = await listQueue();
    expect(q.length).toBe(1);
    expect(q[0]!.source).toBe("errors");
    expect(q[0]!.priority).toBe("tinggi");
    expect(q[0]!.status).toBe("queued");
    const after = await prisma.errorGroup.findUnique({ where: { id: g.id } });
    expect(after!.status).toBe("escalated");
    expect(after!.specId).toBe(q[0]!.specId);
  });

  it("filters by environment: non-production groups are ignored", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", environment: "development", count: 99 });
    await mkGroup({ projectId: "opt", environment: "unknown", count: 99 });
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
  });

  it("filters by count threshold (minCount from settings, default 5)", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", count: 4 });   // below default 5
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
    await mkGroup({ projectId: "opt", count: 5 });   // at threshold
    await checkErrors();
    expect((await listQueue()).length).toBe(1);
  });

  it("honors a custom minCount from Setting.scheduler", async () => {
    await mkProject("opt", true);
    await setScheduler({ ...SCHEDULER_DEFAULTS, sources: {
      ...SCHEDULER_DEFAULTS.sources,
      errors: { ...SCHEDULER_DEFAULTS.sources.errors, minCount: 20 },
    } });
    expect((await getScheduler()).sources.errors.minCount).toBe(20);
    await mkGroup({ projectId: "opt", count: 15 });  // below custom 20
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
  });

  it("skips groups from non-opt-in projects", async () => {
    await mkProject("noopt", false);
    await mkGroup({ projectId: "noopt", count: 99 });
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
  });

  it("is idempotent: escalated/resolved/linked groups are not re-escalated", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", status: "escalated", count: 99 });
    await mkGroup({ projectId: "opt", status: "resolved", count: 99 });
    const linked = await mkGroup({ projectId: "opt", status: "new", count: 99 });
    await prisma.errorGroup.update({ where: { id: linked.id }, data: { specId: "SPEC-EXIST" } });
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
  });

  it("processes many eligible groups in one window (no per-checker cap)", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", count: 10 });
    await mkGroup({ projectId: "opt", count: 20 });
    await mkGroup({ projectId: "opt", count: 30 });
    await checkErrors();
    expect((await listQueue()).length).toBe(3);
    expect((await prisma.errorGroup.count({ where: { status: "escalated" } }))).toBe(3);
  });

  it("double check → one queue row per spec, groups escalated once", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", count: 10 });
    await checkErrors();
    await checkErrors();
    expect((await listQueue()).length).toBe(1);
    expect((await prisma.spec.count())).toBe(1);
  });

  it("registerErrorsSource registers a source with id 'errors'", () => {
    registerErrorsSource();
    expect(listSources().map((s) => s.id)).toContain("errors");
  });
});
```

- [ ] **Step 2: Jalankan test → pastikan GAGAL (modul belum ada)**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman296' NODE_ENV=test npx vitest run test/scheduler-source-errors.test.ts --no-file-parallelism`
Expected: FAIL — `Cannot find module '.../sources/errors'`

- [ ] **Step 3: Buat `server/src/services/scheduler/sources/errors.ts`**

```ts
import { prisma } from "../../../db";
import { registerSchedulerSource } from "../registry";
import { enqueue } from "../queue";
import { getScheduler } from "../config";
import { escalateErrorGroup } from "../../error-escalate";

// SPEC-296 · daun #2 scheduler otonom (di atas fondasi SPEC-294/ADR-0072, cermin SPEC-295).
// Checker "errors": tiap ErrorGroup eligible (new, produksi, count>=ambang, project opt-in,
// belum ber-specId) → escalate (jalur bersama services/error-escalate.ts) → enqueue peluncuran.
// Idempotensi gratis: filter query menyaring grup escalated/resolved/ber-specId; enqueue upsert
// specId @unique. "Banyak grup satu window" — checker tak punya limit; cap ditegakkan governor.
// PRD §Source — Errors + User Story #2.
export async function checkErrors(): Promise<void> {
  const minCount = (await getScheduler()).sources.errors.minCount;
  const groups = await prisma.errorGroup.findMany({
    where: {
      status: "new",              // escalated/resolved tersaring di query
      environment: "production",  // literal, cermin services/error-ingest.ts
      specId: null,               // grup ber-specId tersaring di query
      count: { gte: minCount },   // ambang dari setelan
      project: { schedulerOptIn: true },  // non-opt-in tak pernah ter-query
    },
  });
  for (const g of groups) {
    try {
      // Jalur escalate yang sama dengan route: Spec qa prioritas tinggi + tautan dua arah.
      const { spec } = await escalateErrorGroup(g, { author: "scheduler" });
      await enqueue({ specId: spec.id, projectId: spec.projectId, source: "errors", priority: spec.priority });
    } catch { /* satu grup gagal (mis. project tak ter-bind) tak menghentikan sisanya */ }
  }
}

export function registerErrorsSource(): void {
  registerSchedulerSource({ id: "errors", check: checkErrors });
}
```

- [ ] **Step 4: Jalankan test → pastikan HIJAU**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman296' NODE_ENV=test npx vitest run test/scheduler-source-errors.test.ts --no-file-parallelism`
Expected: PASS (9 test)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler/sources/errors.ts server/test/scheduler-source-errors.test.ts
git commit -m "feat(spec-296): errors source-checker escalate+enqueue grup produksi eligible

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Registrasi boot + docs arsitektur

Daftarkan checker di `server.ts` (sebelum `startScheduler`), perbarui docs SoT yang tersentuh.

**Files:**
- Modify: `server/src/server.ts:35` (setelah `registerBacklogSource()`)
- Docs: `internal/docs/architecture/stack.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`

**Interfaces:**
- Consumes: `registerErrorsSource` (Task 2).

- [ ] **Step 1: Wire registrasi di `server/src/server.ts`**

Tambah import (dekat baris 5):
```ts
import { registerErrorsSource } from "./services/scheduler/sources/errors";
```
Tambah panggilan tepat setelah `registerBacklogSource();` (baris 35):
```ts
  registerErrorsSource(); // SPEC-296 · daftarkan checker errors sebelum engine tick pertama
```

- [ ] **Step 2: Typecheck server**

Run: `cd server && npx tsc -p . --noEmit`
Expected: exit 0

- [ ] **Step 3: Perbarui `internal/docs/architecture/stack.md`**

Di baris pipeline scheduler (yang menyebut "checker backlog konkret SPEC-295"), tambahkan checker `errors` konkret (SPEC-296): grup produksi berulang → escalate → antrean, satu grup = satu backlog.

- [ ] **Step 4: Perbarui `internal/docs/architecture/data-model.md`**

Di §`SchedulerQueueItem` (deskripsi kolom `source`), catat nilai `errors` kini diisi checker konkret (SPEC-296), sejajar `backlog`.

- [ ] **Step 5: Perbarui `internal/docs/architecture/api-contract.md` §Scheduler**

Catat `errors` = checker kedua terdaftar (setelah `backlog`); grup eligible = new ∧ produksi ∧ count≥`sources.errors.minCount` ∧ opt-in ∧ belum ber-specId; memakai ulang `escalateErrorGroup`.

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts internal/docs/architecture/stack.md internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md
git commit -m "feat(spec-296): register errors source at boot + docs arsitektur

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Verifikasi penuh — full suite + live curl smoke

**Files:** (tak ada perubahan kode; hanya verifikasi)

- [ ] **Step 1: Full server suite + shared + tsc**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman296' NODE_ENV=test npx vitest run --no-file-parallelism`
Expected: PASS (semua, termasuk `errors-escalate.route.test.ts` regresi + `scheduler-source-errors.test.ts` baru)
Run: `cd shared && npx vitest run` + `cd server && npx tsc -p . --noEmit`
Expected: PASS + exit 0

- [ ] **Step 2: Boot server ke DB throwaway ter-migrate, seed via SQL**

Buat DB smoke `hanoman296_smoke`, `prisma migrate deploy`. Seed (INGAT: `"updatedAt"=now()` untuk kolom `@updatedAt`):
- project A `schedulerOptIn=true`: grup produksi eligible (`status='new'`, `environment='production'`, `count=8`), grup non-eligible (`environment='development'`, `count=99`) + (`environment='production'`, `count=2`).
- project B `schedulerOptIn=false`: grup produksi `count=99`.
Boot `node dist/server.js` di PORT≠8787 dengan `DATABASE_URL` → `hanoman296_smoke`.

- [ ] **Step 3: Nyalakan scheduler (Pause) + trigger tick, verifikasi state**

- `PUT /api/scheduler/config` body `{ enabled:true, paused:true, sources:{ errors:{ enabled:true } } }` (Pause ⇒ enqueue teruji tanpa launch nyata; merge dengan default lewat `setScheduler`).
- Tunggu boot-pass tick (atau restart) menjalankan `checkErrors`.
- `GET /api/scheduler/state` → `queue` berisi **1** item (grup eligible project A), `source:"errors"`, `priority:"tinggi"`. Grup non-eligible & project B **absen**.
- `GET /api/errors?project=A` → grup eligible kini `status:"escalated"` + `specId` terisi; grup non-eligible tetap `status:"new"`.

Expected: seleksi & idempotensi cocok dengan design; tak ada item dari project non-opt-in / non-produksi / count rendah.

- [ ] **Step 4: Bersihkan DB smoke + tandai plan**

Drop `hanoman296_smoke`. Centang semua `- [ ]` → `- [x]` di plan ini. Tulis `Execute done` ke `$HANOMAN_PHASE_FILE`.

---

## Self-Review

**Spec coverage** (design → task):
- Escalate reuse (jalur sama) → Task 1 (ekstraksi) + Task 2 (dipakai checker). ✓
- Filter produksi + count≥minCount(setelan) → Task 2 Step 1 test (env + threshold + custom minCount) + Step 3 query. ✓
- Idempoten (escalated/resolved/ber-specId dilewati) → Task 2 test "idempotent" + query `status:"new"`∧`specId:null`. ✓
- Banyak grup satu window, dibatasi hanya cap → Task 2 test "processes many" (checker tanpa limit; cap = governor, di luar leaf). ✓
- Registrasi boot → Task 3. ✓
- Unit test + curl di local → Task 2 (+ regresi Task 1) + Task 4. ✓
- Docs tersentuh commit sama → Task 1 Step 6, Task 3 Steps 3-5. ✓

**Placeholder scan:** tak ada TBD/TODO; tiap step berisi kode/perintah nyata. ✓

**Type consistency:** `escalateErrorGroup(group, { author }) → { spec, created }` konsisten Task 1↔2; `enqueue({ specId, projectId, source, priority })` cocok `queue.ts`; `checkErrors`/`registerErrorsSource` konsisten Task 2↔3. ✓
