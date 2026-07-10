# Backlog Belum Selesai (SPEC-173) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backlog item tak boleh mencapai stage `done` selama plan-nya (`docs/superpowers/plans/**`) masih punya task yang belum dicentang.

**Architecture:** Tambah gerbang di derivasi stage: `Execute done` hanya memetakan ke stage `done` bila plan spec-nya terceklist penuh (dibaca dari worktree run), selain itu tertahan di `executing`. Gerbang dipakai kedua jalur persist (`GET /specs` write-through, `advanceStage()` saat DELETE sesi). Lapis kedua: prompt agen menegaskan aturan yang sama.

**Tech Stack:** TypeScript (Node, Fastify), Prisma, Vitest. Semua di paket `server` + `runner`.

## Global Constraints

- TypeScript strict; test untuk tiap logika (ADR-0029, SPEC-173).
- Tanpa perubahan skema — `executing` sudah stage yang ada; `Spec.stage` tak berubah.
- `stageFor()` tetap murni & forward-only; guard `STAGES.indexOf(next) <= STAGES.indexOf(current)` di kedua pemanggil tak boleh dilucuti.
- Pencocokan file plan by spec-id: regex batas kiri non-alnum, kanan non-digit — `(^|[^a-z0-9])${id}([^0-9]|$)`, sama seperti `artifactsToRemove` (`spec-16` tak menyerempet `spec-167`).
- Suite server dijalankan dengan DB test terisolasi: `env -u NODE_ENV DATABASE_URL=…/hanoman pnpm --filter ./server exec vitest run` (shell sesi bisa menunjuk prod; vitest menurunkan `hanoman_test`).

---

### Task 1: `planComplete` + `stageForRun` di session-phases — SELESAI

**Files:**
- Modify: `server/src/services/session-phases.ts`
- Test: `server/test/session-phases.test.ts`

**Interfaces:**
- Consumes: `stageFor(phases)`, `type Phase`, `type Stage` (sudah ada di file).
- Produces:
  - `planComplete(worktree: string, specId: string): boolean` — false hanya jika ada file plan yang cocok spec-id DAN masih memuat kotak belum dicentang.
  - `stageForRun(phases: Phase[], worktree: string, specId: string): Stage | null` — `stageFor`, tapi `done` → `executing` bila `!planComplete`.

- [x] **Step 1: Tulis test yang gagal** — `planComplete` (dir tak ada / no-match → true; plan cocok masih ada kotak kosong → false; semua tercentang → true; `spec-16` tak menyerempet `spec-167`) + `stageForRun` (Execute done + plan belum tuntas → executing; tuntas → done; stage non-done tak terpengaruh).
- [x] **Step 2: Jalankan, pastikan gagal** — `vitest run session-phases` → FAIL: `planComplete`/`stageForRun` belum diekspor.
- [x] **Step 3: Implementasi minimal** — `readdirSync` + regex spec-id + cek kotak kosong per baris di `planComplete`; `stageForRun` bungkus `stageFor`.
- [x] **Step 4: Jalankan, pastikan lulus** — `vitest run session-phases` → 19 PASS (10 test `stageFor` lama tetap hijau).
- [x] **Step 5: Commit** — `feat(server): planComplete + stageForRun — Execute done butuh plan terceklist (SPEC-173)`.

---

### Task 2: Gerbang `advanceStage` saat DELETE sesi — SELESAI

**Files:**
- Modify: `server/src/routes/terminal.ts`
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `stageForRun` (Task 1), `s.cwd` (worktree sesi, dari `getSession`).
- Produces: `advanceStage(specId, repoDir, sessionId, flow, worktree)` kini menggerbang `done`.

- [x] **Step 1: Tulis test yang gagal** — sesi spec + worktree berisi plan `2026-…-x-spec-910.md` (satu tercentang, satu belum), phase file `Execute done`, DELETE → assert `stage === "executing"`; kasus semua tercentang → `"done"`.
- [x] **Step 2: Jalankan, pastikan gagal** — DELETE plan belum tuntas → `done` (bukan `executing`). FAIL.
- [x] **Step 3: Implementasi** — import `stageForRun`, `advanceStage` terima `worktree`, dipanggil dengan `s.cwd`.
- [x] **Step 4: Jalankan, pastikan lulus** — `vitest run terminal.route` → 25 PASS.
- [x] **Step 5: Commit** — `fix(server): advanceStage tahan done saat plan belum terceklist (SPEC-173)`.

---

### Task 3: Gerbang write-through `GET /specs` + `cwd` di `sessionPhasesBySpec` — SELESAI

**Files:**
- Modify: `server/src/services/pty.ts` (`sessionPhasesBySpec`)
- Modify: `server/src/routes/specs.ts` (GET /specs)
- Test: `server/test/terminal.route.test.ts` (describe SPEC-168 live-stage)

**Interfaces:**
- Produces: `sessionPhasesBySpec(): Map<string, { phases: Phase[]; cwd: string }>` (dulu `Map<string, Phase[]>`).
- Consumes: `stageForRun` (Task 1).

- [x] **Step 1: Tulis test yang gagal** — write-through: plan belum tuntas live + `Execute done` → `GET /api/specs` `executing` (persist juga `executing`); semua tercentang → `done`.
- [x] **Step 2: Ubah `sessionPhasesBySpec` bawa cwd** — map value `{ phases, cwd }`.
- [x] **Step 3: Gerbang di GET /specs** — import `stageForRun`, pakai `entry.phases`/`entry.cwd`.
- [x] **Step 4: Jalankan suite, pastikan lulus** — `vitest run terminal.route specs.route` → 43 PASS.
- [x] **Step 5: Commit** — `fix(server): write-through GET /specs pakai gerbang plan terceklist (SPEC-173)`.

---

### Task 4: Prompt agen — jangan tulis `Execute done` sebelum semua kotak tercentang — SELESAI

**Files:**
- Modify: `runner/src/prompt.ts` (`phaseInstruction`)
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `phaseInstruction(phases)` (sudah ada).
- Produces: prompt flow ber-Plan+Execute memuat klausa penyelesaian plan; reverse/scaffold tidak.

- [x] **Step 1: Tulis test yang gagal** — feature/qa memuat "Execute BELUM selesai" + contoh kotak tercentang; reverse tidak.
- [x] **Step 2: Jalankan, pastikan gagal** — `vitest run prompt` → FAIL (klausa belum ada; test reverse sudah hijau).
- [x] **Step 3: Implementasi** — `phaseInstruction` menambah klausa hanya bila `phases` memuat `Plan` DAN `Execute`.
- [x] **Step 4: Jalankan, pastikan lulus** — `vitest run prompt` → 15 PASS.
- [x] **Step 5: Commit** — `feat(runner): prompt tegaskan Execute selesai = semua kotak plan tercentang (SPEC-173)`.

---

### Task 5: Verifikasi penuh + uji API nyata — SELESAI

- [x] **Step 1: Suite penuh dua paket** — runner 29/29, server 185/185 PASS.
- [x] **Step 2: Typecheck** — `tsc --noEmit` server & runner → exit 0.
- [x] **Step 3: Uji API nyata, ujung ke ujung** — boot `buildApp` (HTTP nyata, DB `hanoman_test` terisolasi), `POST /api/terminal/sessions` → 201 (worktree + sesi), plan 3 PR belum tercentang + phase `Execute done` → `GET /api/specs` = `executing`; semua kotak tercentang → `GET /api/specs` = `done`. SMOKE: OK.
- [x] **Step 4: Commit docs** — spec-design, ADR-0029, index, plan.
