# SPEC-298 — Autonomy sesi scheduler + penanganan akhir sesi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesi yang diluncurkan scheduler berjalan dengan klausa autonomy sesuai toggle `Setting.scheduler.autonomy` (full-control tembus fase sampai `done`; butuh-keputusan berhenti di titik keputusan → marker SPEC-184 → `Notification decision`, slot tetap terpakai); pada akhir sesi, rekonsiliasi menghasilkan ringkasan/diff + `Notification done` pada `done` (tanpa auto-merge) dan `Notification fail` (tipe baru) pada gagal/limit (tanpa retry).

**Architecture:** Tambah varian klausa `full-control` di `runner/src/prompt.ts` + selektor per-mode, thread `autonomy` opsional lewat `startSpecSession`→governor (`deps.launch(item, cfg.autonomy)`). Tambah nilai enum `Notification.type "fail"` + `recordFailure`. Unit rekonsiliasi baru `services/scheduler/reconcile.ts` (deps di-inject) dipanggil `engine.tick` bersama `scanDecisions()` sebelum `drain`: per item antrean `launched` → `done` (notif done + `SessionResult` ringkasan + markDone, tanpa merge) / pane mati sebelum done → `failed` (notif fail + markFailed(note), tanpa retry) / masih hidup < done → biarkan (tahan slot).

**Tech Stack:** Node + TypeScript (strict), Fastify, Prisma (Postgres), Vitest. Fondasi scheduler SPEC-294/ADR-0072 (registry/queue/governor/engine/config); toggle `scheduler.autonomy` + kolom `SchedulerQueueItem.note`/`status` **sudah ada** sejak fondasi.

## Global Constraints

- TypeScript strict; ikuti pola file yang ada (`scheduler/governor.ts`, `scheduler/engine.ts`, `notifications.ts`, `session-result.ts`, `runner/src/prompt.ts`).
- **Tanpa** perubahan skema, migration, ADR baru, atau endpoint baru — murni aditif pada kontrak fondasi. `Notification.type` = kolom `String` (enum di zod `@hanoman/shared`), jadi `+"fail"` **bukan** migration (cermin SPEC-249 `+error`, SPEC-253 `+ticket`).
- `SchedulerQueueItem.source` = asal checker; `status ∈ {queued,launched,done,failed}`; `note` = alasan gagal (diisi leaf ini).
- Autonomy `full-control` = tembus sampai `done` tanpa berhenti bertanya; `butuh-keputusan` = berhenti di keputusan (klausa lama). **Sesi manual tak tersentuh** (param `autonomy` opsional, default = klausa lama).
- **Tak pernah auto-merge** (branch/worktree dibiarkan untuk merge manual ADR-0031); **tak pernah retry** sesi gagal (PRD non-goal).
- Idempotensi: notif `key:done:<specId>`/`fail:<specId>`; `SessionResult` done dedup via `findFirst(newStage="done")`; item antrean pindah dari `launched` sekali → tick berikut skip.
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama** (konvensi SoT).
- Test WAJIB `cd server && npx vitest run --no-file-parallelism` (server) / `cd runner && npx vitest run` (runner) / `cd shared && npx vitest run` (shared). Shell env bisa menunjuk prod → override `DATABASE_URL` per perintah; DB base khusus `hanoman298` → vitest derive `hanoman298_test`. Buat + `migrate deploy` `hanoman298_test` sebelum test server pertama.
- Commit message diakhiri `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 0: Siapkan DB test terisolasi

Cegah truncation oleh sesi sibling: pakai base `hanoman298` (→ `hanoman298_test`).

**Files:** (tak ada perubahan kode)

- [ ] **Step 1: Buat + migrate `hanoman298_test`**

Run:
```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c "CREATE DATABASE hanoman298_test;" 2>/dev/null; \
cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298_test' npx prisma migrate deploy
```
Expected: "All migrations have been applied" (atau "No pending migrations bila sudah ada").

- [ ] **Step 2: Sanity — prisma client ter-generate untuk worktree ini**

Run: `cd server && npx prisma generate`
Expected: "Generated Prisma Client".

---

### Task 1: `Notification.type "fail"` + `recordFailure`

Nilai enum baru + fungsi penerbit notif gagal (idempoten `key`), cermin `recordCompletion`.

**Files:**
- Modify: `shared/src/entities.ts` (baris `zNotification.type` enum)
- Modify: `server/src/services/notifications.ts` (tambah `recordFailure`)
- Modify: `internal/docs/architecture/data-model.md` (§Notification `type` `+ fail`)
- Test: `server/test/notifications.test.ts` (tambah blok `recordFailure`)

**Interfaces:**
- Produces: `recordFailure(specId: string, title: string, projectId: string | null, reason: string): Promise<void>` — buat 1 baris `Notification { type:"fail", key:"fail:<specId>", specId, sessionId:<idFor>, title:"Gagal: <title> — <reason>", projectId }`; idempoten (P2002 di-swallow).

- [ ] **Step 1: Tambah `"fail"` ke enum `zNotification.type`**

Di `shared/src/entities.ts`, ubah baris `type`:
```ts
  type: z.enum(["done", "decision", "error", "ticket", "fail"]).default("done"),   // SPEC-249 +error; SPEC-253 +ticket; SPEC-298 +fail (sesi scheduler gagal/limit)
```

- [ ] **Step 2: Rebuild shared (server mengimpor dari dist)**

Run: `cd shared && npx tsc -p .`
Expected: exit 0, tanpa error.

- [ ] **Step 3: Tulis test gagal `recordFailure`**

Tambahkan ke `server/test/notifications.test.ts` (setelah blok `recordCompletion`), dan tambahkan `recordFailure` ke import baris 8:
```ts
describe("recordFailure", () => {
  beforeEach(async () => { await resetDb(); });

  it("membuat notif type fail dengan sessionId turunan + alasan di judul", async () => {
    await recordFailure("SPEC-9", "Judul spec", "p1", "sesi berakhir sebelum mencapai done (gagal/limit)");
    const row = await prisma.notification.findFirstOrThrow({ where: { specId: "SPEC-9" } });
    expect(row.type).toBe("fail");
    expect(row.sessionId).toBe("spec-9");
    expect(row.title).toContain("Judul spec");
    expect(row.title.toLowerCase()).toContain("gagal");
  });

  it("idempoten via key: dua panggilan spec sama → satu baris", async () => {
    await recordFailure("SPEC-10", "t", "p1", "r");
    await recordFailure("SPEC-10", "t", "p1", "r");
    expect(await prisma.notification.count({ where: { specId: "SPEC-10" } })).toBe(1);
  });
});
```
Ubah import baris 8:
```ts
import { recordCompletion, recordFailure, scanDecisions, __resetAwaiting } from "../src/services/notifications";
```

- [ ] **Step 4: Jalankan test — verifikasi gagal**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298' npx vitest run --no-file-parallelism notifications.test.ts`
Expected: FAIL — `recordFailure is not a function` / import error.

- [ ] **Step 5: Implementasi `recordFailure`**

Di `server/src/services/notifications.ts`, setelah `recordCompletion` (sekitar baris 32):
```ts
// SPEC-298 · notif saat sesi scheduler gagal / kena limit (rekonsiliasi akhir sesi). Dedup
// `key:fail:<specId>` idempoten (insert kedua kena P2002, diabaikan). sessionId turunan =
// idFor(specId) → aksi "Buka" bisa memutar ulang pane mati (log gagal). TANPA retry (PRD non-goal).
export async function recordFailure(specId: string, title: string, projectId: string | null, reason: string): Promise<void> {
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: { type: "fail", key: `fail:${specId}`, specId, sessionId, title: `Gagal: ${title} — ${reason}`, projectId },
  }).catch(() => { /* P2002: sudah ada */ });
}
```

- [ ] **Step 6: Jalankan test — verifikasi lolos**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298' npx vitest run --no-file-parallelism notifications.test.ts`
Expected: PASS (semua blok, termasuk `recordFailure`).

- [ ] **Step 7: Perbarui doc data-model §Notification**

Di `internal/docs/architecture/data-model.md`, temukan baris yang mendaftar `type` Notification (mencari "done|decision|error|ticket" atau bagian Notification) dan tambahkan `fail`:
> `type` ∈ `done|decision|error|ticket|fail` — `fail` (SPEC-298) = sesi scheduler gagal/limit (rekonsiliasi akhir sesi), dedup `key:fail:<specId>`, tanpa retry.

(Bila belum ada enumerasi eksplisit `type`, tambahkan satu kalimat di paragraf Notification.)

- [ ] **Step 8: Commit**

```bash
git add shared/src/entities.ts shared/dist server/src/services/notifications.ts server/test/notifications.test.ts internal/docs/architecture/data-model.md
git commit -m "$(printf 'feat(spec-298): Notification type fail + recordFailure\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Klausa autonomy per mode + threading ke sesi scheduler

Varian klausa `full-control` + selektor; thread `autonomy` opsional `startSpecSession`→governor. Sesi manual tak berubah (default = klausa lama).

**Files:**
- Modify: `runner/src/types.ts` (tambah `type Autonomy`)
- Modify: `runner/src/prompt.ts` (`AUTONOMY_CLAUSE_FULL` + `autonomyClause` + param di `startPrompt`/`continuePrompt`)
- Modify: `server/src/services/session-launch.ts` (opts `autonomy`, teruskan)
- Modify: `server/src/services/scheduler/governor.ts` (`launch` arity + `deps.launch(item, cfg.autonomy)`)
- Modify: `server/src/services/scheduler/engine.ts` (`prodDeps.launch` teruskan autonomy)
- Modify: `internal/docs/architecture/stack.md` + `data-model.md` (§Setting autonomy dikonsumsi)
- Test: `runner/test/prompt.test.ts` (blok autonomy per-mode)

**Interfaces:**
- Consumes: `Flow`, `SpecBrief` (runner/types).
- Produces:
  - `type Autonomy = "full-control" | "butuh-keputusan"` (runner/types).
  - `autonomyClause(mode?: Autonomy): string` (runner/prompt) — `full-control`→`AUTONOMY_CLAUSE_FULL`, else `AUTONOMY_CLAUSE`.
  - `startPrompt(flow, spec, branchTo, autonomy?: Autonomy)`, `continuePrompt(flow, spec, branchTo, autonomy?: Autonomy)`.
  - `startSpecSession(spec, { flow; model?; effort?; autonomy?: Autonomy })`.
  - `GovernorDeps.launch: (item, autonomy?: string) => Promise<string>`.

- [ ] **Step 1: Tulis test gagal — klausa per-mode**

Tambahkan ke `runner/test/prompt.test.ts` (di dalam file, describe baru), dan tambahkan `Autonomy` ke import bila mengetes `autonomyClause` (opsional — test di bawah lewat `startPrompt`):
```ts
// SPEC-298 · klausa autonomy per mode untuk sesi scheduler.
describe("autonomy per mode (SPEC-298)", () => {
  it("full-control: putuskan sendiri, tanpa pengawas, tembus sampai done — bukan klausa tanya", () => {
    const p = startPrompt("feature", spec, "b", "full-control");
    expect(p).toContain("TANPA pengawas");
    expect(p).toContain("JANGAN berhenti");
    expect(p).not.toContain("tanyakan di terminal");
  });
  it("butuh-keputusan: klausa lama (berhenti untuk keputusan manusia, tanya di terminal)", () => {
    const p = startPrompt("feature", spec, "b", "butuh-keputusan");
    expect(p).toContain("tanpa berhenti di batas antar-fase");
    expect(p).toContain("tanyakan di terminal");
    expect(p).not.toContain("TANPA pengawas");
  });
  it("default (manual, tanpa arg): identik klausa lama", () => {
    expect(startPrompt("feature", spec, "b")).toContain("tanyakan di terminal");
    expect(startPrompt("feature", spec, "b")).not.toContain("TANPA pengawas");
  });
  it("continuePrompt menghormati mode full-control", () => {
    const p = continuePrompt("feature", spec, "b", "full-control");
    expect(p).toContain("TANPA pengawas");
  });
});
```

- [ ] **Step 2: Jalankan test — verifikasi gagal**

Run: `cd runner && npx vitest run prompt.test.ts`
Expected: FAIL — `full-control` clause text belum ada / param diabaikan.

- [ ] **Step 3: Tambah `type Autonomy` di `runner/src/types.ts`**

Setelah baris `export type Flow = …`:
```ts
// SPEC-298 · mode autonomy sesi scheduler (Setting.scheduler.autonomy). full-control = putuskan
// sendiri & tembus sampai done; butuh-keputusan = berhenti di titik keputusan (klausa lama).
export type Autonomy = "full-control" | "butuh-keputusan";
```

- [ ] **Step 4: Tambah klausa + selektor di `runner/src/prompt.ts`**

Ubah import baris 1 agar memuat `Autonomy`:
```ts
import type { Flow, SpecBrief, ProjectBrief, PrdBrief, BreakdownPrd, Autonomy } from "./types";
```
Setelah konstanta `AUTONOMY_CLAUSE` (sekitar baris 29), tambahkan:
```ts
// SPEC-298 · varian full-control untuk sesi scheduler tak-berpengawas: agen memutuskan sendiri
// di SETIAP percabangan (termasuk data model/kontrak API/scope) dan menembus sampai `done` tanpa
// pernah berhenti bertanya (tak ada manusia di terminal yang menjawab). Keputusan dicatat di
// commit/PR untuk di-review pasca-fakta; merge tetap manual (ADR-0031). Lawan dari AUTONOMY_CLAUSE
// (butuh-keputusan) yang menyuruh berhenti & bertanya di terminal.
const AUTONOMY_CLAUSE_FULL =
  "Kamu berjalan TANPA pengawas — tak ada manusia yang menonton terminal ini untuk menjawab. "
  + "Putuskan sendiri di SETIAP percabangan (termasuk yang mengubah bentuk kerja: data model, "
  + "kontrak API, scope) berdasarkan Source of Truth dan penilaian terbaikmu; JANGAN berhenti "
  + "bertanya. Tembus seluruh pipeline sampai stage `done`, lalu commit & push. Jangan menunggu "
  + "review/persetujuan siapa pun — catat asumsi & keputusan penting di pesan commit agar bisa "
  + "di-review pasca-fakta. Merge ke branch utama tetap dilakukan manusia, bukan kamu.";

// SPEC-298 · pilih klausa per mode. undefined (peluncuran manual) → klausa tanya (lama):
// sesi manual berpengawas, manusia menonton & boleh menjawab.
const autonomyClause = (mode?: Autonomy): string =>
  mode === "full-control" ? AUTONOMY_CLAUSE_FULL : AUTONOMY_CLAUSE;
```

- [ ] **Step 5: Terima param `autonomy` di `startPrompt` & `continuePrompt`**

Ubah tanda tangan + baris yang memakai `AUTONOMY_CLAUSE`:
```ts
export function startPrompt(flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy): string {
```
Ganti elemen array `AUTONOMY_CLAUSE,` (di `startPrompt`) menjadi `autonomyClause(autonomy),`.
```ts
export function continuePrompt(flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy): string {
```
Ganti elemen array `AUTONOMY_CLAUSE,` (di `continuePrompt`) menjadi `autonomyClause(autonomy),`.
(Jangan sentuh pemakaian `AUTONOMY_CLAUSE` di `startBreakdownPrompt` — breakdown tetap klausa lama.)

- [ ] **Step 6: Jalankan test — verifikasi lolos**

Run: `cd runner && npx vitest run prompt.test.ts`
Expected: PASS (blok autonomy baru + semua test prompt lama tetap hijau — default param menjaga perilaku lama).

- [ ] **Step 7: Rebuild runner (server mengimpor dari dist)**

Run: `cd runner && npx tsc -p .`
Expected: exit 0.

- [ ] **Step 8: Thread `autonomy` di `session-launch.ts`**

Di `server/src/services/session-launch.ts`, ubah opts + import:
```ts
import { realGit, startPrompt, continuePrompt, type Flow, type Autonomy } from "@hanoman/runner";
```
```ts
export async function startSpecSession(
  spec: Spec, opts: { flow: Flow; model?: string; effort?: string; autonomy?: Autonomy },
): Promise<StartSpecResult> {
```
Di pemanggilan `createSession` (`prompt:` isContinue ternary), teruskan `opts.autonomy`:
```ts
    prompt: isContinue
      ? continuePrompt(opts.flow, brief, `hanoman/${id}`, opts.autonomy)
      : startPrompt(opts.flow, brief, `hanoman/${id}`, opts.autonomy),
```

- [ ] **Step 9: Perluas `GovernorDeps.launch` + teruskan `cfg.autonomy`**

Di `server/src/services/scheduler/governor.ts`, ubah tipe `launch`:
```ts
  launch: (item: SchedulerQueueItem, autonomy?: string) => Promise<string>;   // spawn sesi → sessionId; throw = gagal
```
Di `drain`, ubah pemanggilan launch:
```ts
        const sessionId = await deps.launch(item, cfg.autonomy);
```

- [ ] **Step 10: `prodDeps.launch` teruskan autonomy di `engine.ts`**

Di `server/src/services/scheduler/engine.ts`, ubah `prodDeps.launch`:
```ts
  launch: async (item, autonomy) => {
    const spec = await prisma.spec.findUnique({ where: { id: item.specId } });
    if (!spec) throw new Error(`spec ${item.specId} tak ada`);
    const r = await startSpecSession(spec, { flow: flowForSource(spec.source), autonomy: autonomy as Autonomy | undefined });
    return r.id;
  },
```
Tambahkan import `type Autonomy`:
```ts
import { flowForSource } from "@hanoman/shared";
import type { Autonomy } from "@hanoman/runner";
```

- [ ] **Step 11: Jalankan test server terdampak — governor/engine/session-launch tetap hijau**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298' npx vitest run --no-file-parallelism scheduler-governor.test.ts scheduler-engine.test.ts session-launch.test.ts`
Expected: PASS (mock `launch` arity lama mengabaikan arg autonomy ekstra; param opsional).

- [ ] **Step 12: Perbarui doc stack + data-model (autonomy dikonsumsi)**

Di `internal/docs/architecture/data-model.md` §Setting, ganti "`autonomy` (`full-control|butuh-keputusan`, dikonsumsi daun akhir-sesi)" menjadi menyatakan sudah dikonsumsi (SPEC-298): full-control → sesi tembus sampai `done` tanpa berhenti bertanya; butuh-keputusan → berhenti di keputusan (marker SPEC-184 → notif decision), diterapkan via klausa prompt saat governor meluncurkan sesi.
Di `internal/docs/architecture/stack.md`, pada baris pipeline scheduler, tambahkan penanda daun #5 autonomy per-mode (klausa prompt full-control vs butuh-keputusan diterapkan saat governor launch).

- [ ] **Step 13: Commit**

```bash
git add runner/src/types.ts runner/src/prompt.ts runner/dist runner/test/prompt.test.ts server/src/services/session-launch.ts server/src/services/scheduler/governor.ts server/src/services/scheduler/engine.ts internal/docs/architecture/stack.md internal/docs/architecture/data-model.md
git commit -m "$(printf 'feat(spec-298): klausa autonomy per mode + threading ke sesi scheduler\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Rekonsiliasi akhir sesi + wiring engine.tick

Unit rekonsiliasi (deps di-inject) yang menandai item antrean `done`/`failed` + menerbitkan ringkasan & notif; dipanggil `engine.tick` bersama `scanDecisions()` sebelum `drain`.

**Files:**
- Create: `server/src/services/scheduler/reconcile.ts`
- Modify: `server/src/services/scheduler/engine.ts` (panggil `reconcile` + `scanDecisions` di `tick`)
- Modify: `internal/docs/architecture/data-model.md` (§SchedulerQueueItem: `note`/`status` diisi rekonsiliasi) + `api-contract.md` (§Scheduler/§Notifikasi)
- Test: `server/test/scheduler-reconcile.test.ts` (baru), `server/test/scheduler-engine.test.ts` (tick memanggil reconcile+scanDecisions)

**Interfaces:**
- Consumes: `queue.listQueue`, `queue.markDone`, `queue.markFailed`; `notifications.recordCompletion`, `notifications.recordFailure`; `session-result.recordSessionResult`; `stage-machine.STAGES`; `sync-notify.notifySynced`; `session-phases.stageForRun`/`readPhases`, `session-phases.phaseFilePath`; `pty.getSession`; `runner.realGit.headSha`.
- Produces:
  - `type ReconcilePane = { exited: boolean; flow?: Flow; phaseFile?: string; cwd: string } | undefined`
  - `type ReconcileDeps = { pane: (sessionId: string) => ReconcilePane; deriveStage: (phaseFile: string, flow: Flow, cwd: string, specId: string) => Stage | null; headSha: (worktree: string) => string | null }`
  - `reconcile(deps: ReconcileDeps): Promise<void>`
  - `reconcileProdDeps: ReconcileDeps`

- [ ] **Step 1: Tulis test gagal — rekonsiliasi**

Buat `server/test/scheduler-reconcile.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueue, markLaunched, queueItemForSpec } from "../src/services/scheduler/queue";
import { reconcile, type ReconcileDeps, type ReconcilePane } from "../src/services/scheduler/reconcile";
import type { Stage } from "@hanoman/shared";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.sessionResult.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

// Seed satu Project + Spec + item antrean status launched (sessionId di-set).
async function seedLaunched(specId: string, stage: Stage) {
  await prisma.project.upsert({ where: { id: "p1" }, update: {}, create: { id: "p1", name: "P1", desc: "", kind: "existing" } });
  await prisma.spec.create({ data: { id: specId, projectId: "p1", title: `T ${specId}`, source: "brief", stage, author: "a", priority: "sedang", objective: "", baseSha: "base0" } });
  await enqueue({ specId, projectId: "p1", source: "backlog", priority: "sedang" });
  const item = await queueItemForSpec(specId);
  await markLaunched(item!.id, specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_"));
}

const deps = (over: Partial<ReconcileDeps> = {}): ReconcileDeps => ({
  pane: () => ({ exited: false, flow: "feature", phaseFile: "/tmp/pf", cwd: "/tmp/wt" }) as ReconcilePane,
  deriveStage: () => "executing" as Stage,
  headSha: () => "head0",
  ...over,
});

describe("reconcile", () => {
  it("done: markDone + notif done + satu SessionResult(done); tick kedua tak dobel", async () => {
    await seedLaunched("SPEC-100", "executing");
    const d = deps({ deriveStage: () => "done" as Stage });
    await reconcile(d);
    await reconcile(d);   // item sudah done → tak diproses lagi
    expect((await queueItemForSpec("SPEC-100"))!.status).toBe("done");
    expect(await prisma.notification.count({ where: { specId: "SPEC-100", type: "done" } })).toBe(1);
    const results = await prisma.sessionResult.findMany({ where: { specId: "SPEC-100", newStage: "done" } });
    expect(results).toHaveLength(1);
    expect(results[0]!.commitSha).toBe("head0");
    expect(results[0]!.branch).toBe("hanoman/spec-100");
  });

  it("done mem-persist spec.stage=done (independen pengawas)", async () => {
    await seedLaunched("SPEC-101", "executing");
    await reconcile(deps({ deriveStage: () => "done" as Stage }));
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-101" } }))!.stage).toBe("done");
  });

  it("pane mati sebelum done: markFailed(note) + notif fail; tanpa SessionResult; tanpa retry", async () => {
    await seedLaunched("SPEC-102", "executing");
    await reconcile(deps({ pane: () => ({ exited: true, flow: "feature", phaseFile: "/tmp/pf", cwd: "/tmp/wt" }), deriveStage: () => "executing" as Stage }));
    const item = await queueItemForSpec("SPEC-102");
    expect(item!.status).toBe("failed");
    expect(item!.note).toBeTruthy();
    expect(await prisma.notification.count({ where: { specId: "SPEC-102", type: "fail" } })).toBe(1);
    expect(await prisma.sessionResult.count({ where: { specId: "SPEC-102" } })).toBe(0);
  });

  it("pane hidup & stage < done: tetap launched, tanpa notif", async () => {
    await seedLaunched("SPEC-103", "executing");
    await reconcile(deps({ deriveStage: () => "executing" as Stage }));
    expect((await queueItemForSpec("SPEC-103"))!.status).toBe("launched");
    expect(await prisma.notification.count({ where: { specId: "SPEC-103" } })).toBe(0);
  });

  it("pane gone (undefined) & stage < done: failed", async () => {
    await seedLaunched("SPEC-104", "executing");
    await reconcile(deps({ pane: () => undefined }));
    expect((await queueItemForSpec("SPEC-104"))!.status).toBe("failed");
    expect(await prisma.notification.count({ where: { specId: "SPEC-104", type: "fail" } })).toBe(1);
  });

  it("dedup ringkasan: SessionResult(done) sudah ada → tak buat kedua", async () => {
    await seedLaunched("SPEC-105", "executing");
    await prisma.sessionResult.create({ data: { id: "pre-105", projectId: "p1", specId: "SPEC-105", newStage: "done", status: "done" } });
    await reconcile(deps({ deriveStage: () => "done" as Stage }));
    expect(await prisma.sessionResult.count({ where: { specId: "SPEC-105", newStage: "done" } })).toBe(1);
  });
});
```

- [ ] **Step 2: Jalankan test — verifikasi gagal**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298' npx vitest run --no-file-parallelism scheduler-reconcile.test.ts`
Expected: FAIL — modul `reconcile` belum ada.

- [ ] **Step 3: Implementasi `server/src/services/scheduler/reconcile.ts`**

```ts
import { prisma } from "../../db";
import type { Stage } from "@hanoman/shared";
import { realGit, type Flow } from "@hanoman/runner";
import { listQueue, markDone, markFailed } from "./queue";
import { recordCompletion, recordFailure } from "../notifications";
import { recordSessionResult } from "../session-result";
import { STAGES } from "../stage-machine";
import { notifySynced } from "../sync-notify";
import { getSession } from "../pty";
import { readPhases, stageForRun } from "../session-phases";

// SPEC-298 · ADR-0072 (daun #5) · rekonsiliasi akhir sesi scheduler. Dipanggil engine.tick
// (loop selalu-hidup) — satu-satunya jalur andal untuk sesi tak-berpengawas: advanceStage butuh
// terminal attach, liveSpecs butuh klien events. Deps di-inject (teruji tanpa tmux/git/fs), pola
// GovernorDeps. TANPA auto-merge (branch dibiarkan, ADR-0031) & TANPA retry (PRD non-goal).
export type ReconcilePane = { exited: boolean; flow?: Flow; phaseFile?: string; cwd: string } | undefined;
export type ReconcileDeps = {
  pane: (sessionId: string) => ReconcilePane;                                   // getSession projeksi
  deriveStage: (phaseFile: string, flow: Flow, cwd: string, specId: string) => Stage | null; // stageForRun(readPhases…)
  headSha: (worktree: string) => string | null;                                // realGit.headSha best-effort
};

const FAIL_REASON = "sesi berakhir sebelum mencapai done (gagal/limit)";

export async function reconcile(deps: ReconcileDeps): Promise<void> {
  for (const item of await listQueue("launched")) {
    try {
      const spec = await prisma.spec.findUnique({ where: { id: item.specId } });
      if (!spec) { await markFailed(item.id, "spec hilang"); continue; }
      const p = deps.pane(item.sessionId ?? "");

      // Stage LIVE diturunkan langsung dari berkas fase (independen pengawas). Persist maju via CAS.
      let stage = spec.stage as Stage;
      if (p?.flow && p.phaseFile) {
        const d = deps.deriveStage(p.phaseFile, p.flow, p.cwd, item.specId);
        if (d && STAGES.indexOf(d) > STAGES.indexOf(stage)) {
          const { count } = await prisma.spec.updateMany({ where: { id: item.specId, stage }, data: { stage: d } });
          if (count > 0) await notifySynced("spec", item.specId).catch(() => {});
          stage = d;
        }
      }

      if (stage === "done") {
        await recordCompletion(item.specId, spec.title, spec.projectId);        // notif done (idempoten key)
        // Ringkasan/diff review: SessionResult (diff turunan baseSha..headSha). Dedup vs advanceStage.
        const existing = await prisma.sessionResult.findFirst({ where: { specId: item.specId, newStage: "done" } });
        if (!existing) {
          await recordSessionResult({
            projectId: spec.projectId, specId: item.specId, newStage: "done",
            commitSha: p?.cwd ? deps.headSha(p.cwd) : null,
            branch: `hanoman/${item.sessionId}`, status: "done",
          }).catch(() => {});
        }
        await markDone(item.id);                                                 // TAK auto-merge: branch dibiarkan
      } else if (!p || p.exited) {
        // Pane mati/gone sebelum done = gagal/limit. Tandai + notif fail. TANPA retry.
        await recordFailure(item.specId, spec.title, spec.projectId, FAIL_REASON);
        await markFailed(item.id, FAIL_REASON);
      }
      // else: pane hidup & stage < done → masih kerja / menunggu keputusan → biarkan launched (tahan slot).
    } catch { /* satu item gagal rekonsil tak menghentikan sisanya */ }
  }
}

// Deps produksi: pane dari tmux (getSession), stage dari berkas fase, headSha dari git (best-effort).
export const reconcileProdDeps: ReconcileDeps = {
  pane: (sessionId) => {
    const s = getSession(sessionId);
    return s ? { exited: s.exited, flow: s.flow, phaseFile: s.phaseFile, cwd: s.cwd } : undefined;
  },
  deriveStage: (phaseFile, flow, cwd, specId) => stageForRun(readPhases(phaseFile, flow), cwd, specId),
  headSha: (wt) => { try { return realGit.headSha(wt); } catch { return null; } },
};
```

- [ ] **Step 4: Jalankan test — verifikasi lolos**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298' npx vitest run --no-file-parallelism scheduler-reconcile.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Tulis test gagal — engine.tick memanggil reconcile + scanDecisions**

Tambahkan ke `server/test/scheduler-engine.test.ts` (describe baru). `tick` akan menerima 2 deps opsional baru (reconcile fn + scanDecisions fn) agar teruji tanpa tmux:
```ts
describe("engine.tick akhir sesi (SPEC-298)", () => {
  it("memanggil reconcile + scanDecisions tiap tick sebelum drain (kecuali master off)", async () => {
    await setScheduler(cfg({ enabled: true, paused: false, maxConcurrent: 5 }));
    let reconciled = 0, scanned = 0;
    await tick(1_000_000, noLaunch, { reconcile: async () => { reconciled++; }, scanDecisions: async () => { scanned++; } });
    expect(reconciled).toBe(1);
    expect(scanned).toBe(1);
  });
  it("Pause tetap menjalankan reconcile + scanDecisions (hanya drain yang diblok)", async () => {
    await setScheduler(cfg({ enabled: true, paused: true, maxConcurrent: 5 }));
    await enqueue({ specId: "SPEC-P", projectId: "p1", source: "backlog", priority: "tinggi" });
    let reconciled = 0, launches = 0;
    await tick(1_000_000, { ...noLaunch, launch: async () => { launches++; return "s"; } },
      { reconcile: async () => { reconciled++; }, scanDecisions: async () => {} });
    expect(reconciled).toBe(1);   // rekonsil jalan
    expect(launches).toBe(0);     // drain diblok Pause
  });
  it("master enabled=false → tick idle (reconcile tak dipanggil)", async () => {
    await setScheduler(cfg({ enabled: false }));
    let reconciled = 0;
    await tick(1_000_000, noLaunch, { reconcile: async () => { reconciled++; }, scanDecisions: async () => {} });
    expect(reconciled).toBe(0);
  });
});
```

- [ ] **Step 6: Jalankan test — verifikasi gagal**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298' npx vitest run --no-file-parallelism scheduler-engine.test.ts`
Expected: FAIL — `tick` belum menerima param ke-3 / tak memanggil reconcile.

- [ ] **Step 7: Wire `reconcile` + `scanDecisions` ke `engine.tick`**

Di `server/src/services/scheduler/engine.ts`, tambah import:
```ts
import { reconcile as reconcileImpl, reconcileProdDeps } from "./reconcile";
import { scanDecisions } from "../notifications";
```
Ubah tanda tangan + badan `tick` (param ke-3 opsional untuk test seam):
```ts
type EndOfSession = { reconcile: () => Promise<void>; scanDecisions: () => Promise<void> };
const prodEnd: EndOfSession = {
  reconcile: () => reconcileImpl(reconcileProdDeps),
  scanDecisions: () => scanDecisions(),
};

export async function tick(now: number, deps: GovernorDeps, end: EndOfSession = prodEnd): Promise<void> {
  const cfg = await getScheduler();
  if (!cfg.enabled) return;                       // master off → idle penuh (tak reconcile)
  for (const src of listSources()) {
    const sc = (cfg.sources as Record<string, { enabled: boolean; everyMin: number }>)[src.id];
    if (sc?.enabled && isDue(src.id, sc.everyMin, now)) {
      setLastRun(src.id, now);
      try { await src.check(); } catch { /* satu source gagal tak menghentikan sisanya */ }
    }
  }
  // SPEC-298 · akhir sesi: rekonsil item launched (done/failed) + terbitkan notif decision untuk
  // sesi menunggu keputusan — SEBELUM drain, agar slot yang dibebaskan sesi selesai/gagal terisi
  // ≤1 tick (ADR-0072). Jalan meski Pause (Pause hanya memblok peluncuran BARU).
  try { await end.reconcile(); } catch { /* rekonsil gagal tak menghentikan tick */ }
  try { await end.scanDecisions(); } catch { /* notif decision best-effort */ }
  if (cfg.paused) return;                          // rem darurat: tak ada drain → tak ada peluncuran baru
  await drain(cfg, deps);
}
```
Pastikan `startScheduler`'s `tick(Date.now(), deps)` tetap valid (param `end` default `prodEnd`).

- [ ] **Step 8: Jalankan test — verifikasi lolos**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298' npx vitest run --no-file-parallelism scheduler-engine.test.ts scheduler-reconcile.test.ts`
Expected: PASS (engine gating lama + akhir-sesi baru + reconcile).

- [ ] **Step 9: Perbarui doc data-model §SchedulerQueueItem + api-contract**

Di `internal/docs/architecture/data-model.md` §SchedulerQueueItem, ubah "`note?` (alasan gagal — diisi daun #5)" → "diisi rekonsiliasi akhir sesi SPEC-298 saat sesi gagal/limit". Tambah kalimat: rekonsiliasi (`services/scheduler/reconcile.ts`, dipanggil `engine.tick`) menandai item `launched` → `done` (notif done + `SessionResult` ringkasan, tanpa auto-merge) / `failed` (notif fail + `note`, tanpa retry) / biarkan (menunggu keputusan → notif decision, tahan slot).
Di `internal/docs/architecture/api-contract.md` §Scheduler tambahkan: akhir sesi scheduler (SPEC-298) menerbitkan `Notification` `done`/`fail`/`decision` + `SessionResult`; diff review diturunkan `GET /specs/:id/review` (baseSha..headSha); merge tetap manual (git graph, ADR-0031). §Notifikasi: `type` `+ fail`.

- [ ] **Step 10: Commit**

```bash
git add server/src/services/scheduler/reconcile.ts server/src/services/scheduler/engine.ts server/test/scheduler-reconcile.test.ts server/test/scheduler-engine.test.ts internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md
git commit -m "$(printf 'feat(spec-298): rekonsiliasi akhir sesi scheduler (done→ringkasan+notif done, gagal→notif fail) + wiring tick\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Verifikasi penuh — full suite + curl smoke

Bukti nyata sesuai objective (unit test + curl di local). Boot server ke DB throwaway ter-migrate (bukan `hanoman_test`).

**Files:** (tak ada perubahan kode; fix bila ada regresi)

- [ ] **Step 1: Full suite shared + runner + server**

Run:
```bash
cd shared && npx vitest run
cd ../runner && npx vitest run
cd ../server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298' npx vitest run --no-file-parallelism
```
Expected: semua PASS (server termasuk `scheduler-*`, `notifications*`, `session-launch`). Bila ada yang merah → fix sampai hijau sebelum lanjut.

- [ ] **Step 2: Build server (esbuild) — pastikan artefak bersih**

Run: `cd server && npm run build`
Expected: exit 0.

- [ ] **Step 3: Boot server ke DB smoke throwaway**

Buat + migrate `hanoman298_smoke`, boot server bind 127.0.0.1 port bebas (mis. 8798), simpan cookie login (`POST /auth/setup`). (Ikuti pola smoke SPEC-297: header `Cookie` eksplisit; enable scheduler via `PUT /api/scheduler/config`, bukan SQL.) Detail perintah:
```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c "CREATE DATABASE hanoman298_smoke;" 2>/dev/null
cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298_smoke' npx prisma migrate deploy
env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman298_smoke' HOST=127.0.0.1 PORT=8798 node dist/server.js &
# tunggu boot, POST /auth/setup, simpan cookie
```

- [ ] **Step 4: Smoke — kasus DONE (ringkasan + notif done, tanpa merge)**

Seed via SQL (set `updatedAt=now()` untuk kolom `@updatedAt`): Project opt-in + Spec (`baseSha` non-null, `stage=executing`) + `SchedulerQueueItem status=launched sessionId=<idFor>`; siapkan berkas fase `<repoDir>/.worktrees/.phases/<id>` berisi seluruh fase feature `done` + plan tanpa `- [ ]` di worktree (atau spec source audit → `Laporan done` supaya `planComplete` true tanpa worktree). Enable scheduler `full-control` via `PUT /api/scheduler/config`. Tunggu ≥1 tick (10s) atau panggil boot-pass.
Verifikasi:
- `GET /api/scheduler/state` → item `status:"done"`.
- `GET /api/notifications` → memuat `type:"done"` untuk spec itu.
- `GET /api/session-results?projectId=<p>` → baris `newStage:"done"`, `branch:"hanoman/<id>"`.
- Branch/worktree TIDAK ter-merge (tak ada operasi merge dilakukan; verifikasi `git branch` unchanged).

- [ ] **Step 5: Smoke — kasus FAIL (notif fail, tanpa retry)**

Seed Spec kedua + `SchedulerQueueItem launched`; pane sesi **mati** sebelum done (mis. tak ada sesi tmux hidup untuk sessionId itu → `getSession` undefined → cabang fail) dengan `spec.stage` < done. Tunggu ≥1 tick.
Verifikasi:
- `GET /api/scheduler/state` → item `status:"failed"` + `note` terisi.
- `GET /api/notifications` → memuat `type:"fail"`.
- Tunggu 1 tick lagi → item TETAP `failed` (tanpa retry / relaunch).

- [ ] **Step 6: Teardown smoke**

Hentikan server, drop `hanoman298_smoke`.
```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c "DROP DATABASE hanoman298_smoke;" 2>/dev/null
```

- [ ] **Step 7: Centang seluruh checklist plan + commit dokumentasi selesai**

Setelah semua kotak `- [x]`, commit penanda selesai bila ada perubahan doc plan.
```bash
git add docs/superpowers/plans/2026-07-22-scheduler-autonomy-end-of-session-spec-298.md
git commit -m "$(printf 'docs(spec-298): tandai seluruh task plan selesai (Execute)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (coverage vs spec)

- **Klausa autonomy per mode** → Task 2 (full-control clause + selektor + threading). ✓
- **butuh-keputusan: stop + marker SPEC-184 + Notification decision + slot tetap** → klausa lama (Task 2) + `scanDecisions` di tick (Task 3) + `reconcile` biarkan `launched` (pane hidup = tahan slot via governor `liveCount`). ✓
- **done: ringkasan/diff + Notification done, tanpa auto-merge** → Task 3 reconcile (recordCompletion + SessionResult, markDone tanpa merge; diff turunan `spec-review`). ✓
- **gagal/limit: Notification fail (tipe baru) tanpa retry** → Task 1 (`fail` type + recordFailure) + Task 3 (cabang fail markFailed, tanpa relaunch). ✓
- **Mengaktifkan autoDefault dorman + AUTONOMY_CLAUSE per mode** → Task 2 (full-control mengaktifkan perilaku full-auto untuk sesi scheduler; selektor klausa). ✓
- **Bukti unit test + curl** → Task 1/2/3 unit + Task 4 curl smoke (done & fail). ✓
- **Tanpa skema/migration/ADR/endpoint baru** → semua aditif; `type "fail"` = enum String; `note`/`autonomy` sudah ada. ✓
