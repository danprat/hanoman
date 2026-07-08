# Legible Run Failures (SPEC-010) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a run's failure legible — distinguish a crashed docs-verify guardrail from a real policy block (and self-heal a transient crash with one retry), and record `phases`/`progress` so the dashboard shows where a run is and where it died.

**Architecture:** Two independent, schema-free fixes at existing choke points. Fix A hardens the server↔CLI guardrail wrapper `verifyViaCli` (`server/src/runner/deps.ts`) into a 3-way classifier + one-retry, and widens the runner's `verify` dependency with an `error?` channel that `run.ts` logs distinctly. Fix B seeds `Run.phases` from `PIPELINES[flow]` at enqueue (`server/src/queue.ts`) and computes `Run.progress` in `persistEvent` (`server/src/runner/events-io.ts`). Both are covered by pure unit helpers (no process spawn, no Redis) plus one DB test and one real-local check.

**Tech Stack:** TypeScript (strict), Node, Prisma/Postgres, BullMQ/Redis, Vitest. pnpm monorepo: packages `@hanoman/runner` (runner), server, shared, cli.

## Global Constraints

- TypeScript strict; a test for every orchestration change (verbatim from `CLAUDE.md`).
- **No schema change, no migration, no ADR-for-schema** — `Run.phases` (Json) and `Run.progress` (Int) already exist; the `verify` result type is internal.
- `@hanoman/runner` must not import from `server` (dependency direction is server → runner). The runner's `verify` type declares its own shape; the server's return value satisfies it structurally.
- Fix A's retry is **tool-level** (re-spawns the verify subprocess inside `verifyViaCli`); it is NOT a BullMQ `attempts` change — `runsQueue.add(..., { attempts: 1 })` stays as-is (ADR-0005 untouched).
- Guardrail fails **closed**: a crashed verify never lets Execute proceed (no fail-open).
- After each task: tick this plan's checklist boxes AND run the real local check for the touched surface (`CLAUDE.md`). Before any enqueue-based local check, confirm **no dev worker is live** (`ps` / Redis) — a shared-Redis enqueue executes a REAL background run.
- Do not commit unless the human asks; each task's "Commit" step is staged for them to run/approve.

---

### Task 1: Fix A — guardrail tool crash is distinct from a policy block, with one retry

**Files:**
- Modify: `server/src/runner/deps.ts` (rewrite `verifyViaCli`; add `classifyVerify`, `retryOnCrash`, `VerifyResult`)
- Modify: `runner/src/run.ts:5-8` (widen `RunDeps.verify` type) and `runner/src/run.ts:22-30` (Execute-gate branch on `error`)
- Test: `server/test/verify-classify.test.ts` (new — pure classifier + retry)
- Test: `runner/test/run.test.ts` (add the tool-error run case)

**Interfaces:**
- Produces: `type VerifyResult = { blocked: boolean; reason?: string; error?: string }`; `classifyVerify(r: { status: number | null; stdout: string; stderr: string }): VerifyResult`; `retryOnCrash(run: () => VerifyResult): VerifyResult`; `verifyViaCli(cwd: string): VerifyResult`.
- Consumes (in `run.ts`): `deps.verify(worktree)` now returns the widened shape; the Execute gate reads `v.error` then `v.blocked`.

- [x] **Step 1: Write the failing pure-classifier + retry tests**

Create `server/test/verify-classify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyVerify, retryOnCrash } from "../src/runner/deps";

describe("classifyVerify (SPEC-010, pure)", () => {
  it("exit 0 -> not blocked", () =>
    expect(classifyVerify({ status: 0, stdout: '{"ok":true,"violations":[]}', stderr: "" }))
      .toEqual({ blocked: false }));

  it("exit != 0 with valid violations JSON -> blocked with joined reasons", () =>
    expect(classifyVerify({ status: 1, stdout: '{"ok":false,"violations":[{"reason":"a"},{"reason":"b"}]}', stderr: "" }))
      .toEqual({ blocked: true, reason: "a; b" }));

  it("exit != 0 with non-JSON stdout -> tool crash (error set, still blocked)", () => {
    const r = classifyVerify({ status: 1, stdout: "Cannot find module\n", stderr: "stack trace here" });
    expect(r.blocked).toBe(true);
    expect(r.error).toBe("stack trace here");
    expect(r.reason).toBeUndefined();
  });

  it("crash with empty stderr falls back to stdout then exit code", () => {
    expect(classifyVerify({ status: 7, stdout: "", stderr: "" }).error).toBe("exit 7");
  });
});

describe("retryOnCrash (SPEC-010, pure)", () => {
  it("returns first result when it is not a crash (runs once)", () => {
    let n = 0;
    const out = retryOnCrash(() => { n++; return { blocked: false }; });
    expect(out).toEqual({ blocked: false });
    expect(n).toBe(1);
  });

  it("retries once and returns the second result when the first is a crash", () => {
    const results = [{ blocked: true, error: "boom" }, { blocked: false }];
    let n = 0;
    const out = retryOnCrash(() => results[n++]!);
    expect(out).toEqual({ blocked: false });
    expect(n).toBe(2);
  });

  it("returns the crash when both attempts crash", () => {
    let n = 0;
    const out = retryOnCrash(() => { n++; return { blocked: true, error: "still broken" }; });
    expect(out).toEqual({ blocked: true, error: "still broken" });
    expect(n).toBe(2);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hanoman/server test verify-classify`
Expected: FAIL — `classifyVerify`/`retryOnCrash` are not exported from `deps.ts`.

- [x] **Step 3: Rewrite `verifyViaCli` in `server/src/runner/deps.ts`**

Replace the current `verifyViaCli` (lines 5-10) with:

```ts
export type VerifyResult = { blocked: boolean; reason?: string; error?: string };

// docs-verify.ts ALWAYS writes JSON to stdout before returning its exit code, so a
// non-zero exit whose stdout is not JSON can only mean the tool crashed — never a
// legitimate stale-docs report. Keep the three cases apart.
export function classifyVerify(r: { status: number | null; stdout: string; stderr: string }): VerifyResult {
  if (r.status === 0) return { blocked: false };
  try {
    const j = JSON.parse(r.stdout);
    return { blocked: true, reason: (j.violations ?? []).map((v: any) => v.reason).join("; ") };
  } catch {
    return { blocked: true, error: (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 500) };
  }
}

// A crashed guardrail tool is often transient (RUN-8801: verify threw once, docs were
// fine). Re-run the verify subprocess exactly once on a crash. This is tool-level retry,
// NOT a BullMQ attempts bump (ADR-0005 stands).
export function retryOnCrash(run: () => VerifyResult): VerifyResult {
  const first = run();
  return first.error !== undefined ? run() : first;
}

export function verifyViaCli(cwd: string): VerifyResult {
  const run = () => classifyVerify(
    spawnSync("node", [`${process.cwd()}/cli/dist/hanoman.js`, "docs", "verify", "--block-if-stale", "--json"], { cwd, encoding: "utf8" }),
  );
  return retryOnCrash(run);
}
```

(`spawnSync` import at `deps.ts:1` stays.)

> **Root-cause addendum (discovered during execution):** the original crash was **not**
> transient. `verifyViaCli` built the CLI path from `process.cwd()`, but the dev worker runs
> from `server/` (`pnpm --filter ./server worker`), so `cwd/cli/dist/hanoman.js` pointed at
> the non-existent `server/cli/dist/hanoman.js` → deterministic module-not-found crash every
> time Execute was reached under `pnpm dev`. Retry alone cannot fix a deterministic path
> error. So `deps.ts` also adds a cwd-independent resolver: `repoRootFrom(startDir)` walks up
> to the committed `pnpm-workspace.yaml`, and `resolveCliEntry(startDir = process.cwd())`
> returns `<root>/cli/dist/hanoman.js`. `verifyViaCli` calls `resolveCliEntry()` instead of
> `${process.cwd()}/cli/dist/hanoman.js`. Covered by 3 tests in `verify-classify.test.ts`
> (`resolveCliEntry` from a nested `server/` dir, from the root, and the workspace-marker
> anchor). This is the primary fix; the retry + `error` legibility remain as defense-in-depth
> for genuinely transient crashes.

- [x] **Step 4: Run the pure tests to verify they pass**

Run: `pnpm --filter @hanoman/server test verify-classify`
Expected: PASS (7 assertions across the two describes).

- [x] **Step 5: Widen the runner's `verify` type and branch the Execute gate**

In `runner/src/run.ts`, change the `RunDeps` interface (line 6) from:

```ts
  queryFn: QueryFn; git: GitOps; verify: (cwd: string) => { blocked: boolean; reason?: string };
```

to:

```ts
  queryFn: QueryFn; git: GitOps; verify: (cwd: string) => { blocked: boolean; reason?: string; error?: string };
```

Then replace the Execute-gate block (lines 22-30) with:

```ts
    if (phase === "Execute") {
      const v = deps.verify(worktree);
      if (v.error !== undefined) {
        onEvent({ kind: "log", line: { t: "✗", s: `guardrail tool error · ${v.error}` } });
        onEvent({ kind: "phase", name: phase, state: "failed" });
        onEvent({ kind: "status", status: "failed" });
        return { status: "failed", costUsd, tokensIn, tokensOut };
      }
      if (v.blocked) {
        onEvent({ kind: "log", line: { t: "✗", s: `plan diblok · ${v.reason ?? "docs stale (Source of Truth)"}` } });
        onEvent({ kind: "phase", name: phase, state: "failed" });
        onEvent({ kind: "status", status: "failed" });
        return { status: "failed", costUsd, tokensIn, tokensOut };
      }
    }
```

- [x] **Step 6: Add the failing run-level test for the tool-error path**

In `runner/test/run.test.ts`, add inside `describe("runOne", ...)`:

```ts
  it("fails at execute with a tool-error log when the guardrail crashes", async () => {
    const d = fakeDeps({ verify: () => ({ blocked: true, error: "boom" }) }); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("failed");
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(events.some((e) => e.kind === "log" && e.line.s === "guardrail tool error · boom")).toBe(true);
    // NOT reported as a docs-stale policy block
    expect(events.some((e) => e.kind === "log" && e.line.s.includes("plan diblok"))).toBe(false);
  });
```

- [x] **Step 7: Run the runner tests to verify pass (new case + unchanged cases)**

Run: `pnpm --filter @hanoman/runner test run`
Expected: PASS — new tool-error case passes; the existing "blocks at execute when docs are stale" case (reason path) still passes.

- [x] **Step 8: Typecheck both packages**

Run: `pnpm -r typecheck` (or `pnpm --filter @hanoman/runner --filter @hanoman/server exec tsc --noEmit`)
Expected: no errors — the widened `verify` type flows through `prodDeps` and the DI test harness.

- [x] **Step 9: Real local check — verifyViaCli distinguishes crash from clean**

Build the CLI if stale, then exercise both branches without a full run:

```bash
pnpm --filter @hanoman/cli build
# clean case (repo root docs are ok): expect { blocked: false }
node -e "const {verifyViaCli}=require('./server/dist/runner/deps.js'); console.log(verifyViaCli(process.cwd()))"
# crash case: point cwd at a dir with no valid repo/docs so collectViolations throws
node -e "const {verifyViaCli}=require('./server/dist/runner/deps.js'); console.log(verifyViaCli('/tmp'))"
```

Expected: first prints `{ blocked: false }`; second prints `{ blocked: true, error: '<stderr>' }` (error populated, NOT a docs-stale reason). If `server/dist` is stale, run `pnpm --filter @hanoman/server build` first.

- [ ] **Step 10: Commit**

```bash
git add server/src/runner/deps.ts runner/src/run.ts server/test/verify-classify.test.ts runner/test/run.test.ts
git commit -m "fix(runner): guardrail tool crash is distinct from a policy block, retried once (SPEC-010)"
```

---

### Task 2: Fix B — seed phases at enqueue and compute progress on each phase event

**Files:**
- Modify: `server/src/queue.ts` (add `phasesForFlow`; seed `phases` in `enqueueRun` create)
- Modify: `server/src/runner/events-io.ts` (add `computeProgress`; set `progress` in the phase branch)
- Test: `server/test/queue.test.ts` (add `phasesForFlow` pure test)
- Test: `server/test/events-io.test.ts` (add `computeProgress` pure test + a persistEvent phase→progress DB test)

**Interfaces:**
- Produces: `phasesForFlow(flow: Flow, only?: string): { name: string; state: "pending" }[]` (from `queue.ts`); `computeProgress(phases: { state: string }[]): number` (from `events-io.ts`).
- Consumes: `PIPELINES` and `Flow` from `@hanoman/runner`; `persistEvent`'s phase branch reads the seeded/updated `phases` array.

- [x] **Step 1: Write the failing `phasesForFlow` test**

In `server/test/queue.test.ts`, add:

```ts
import { phasesForFlow } from "../src/queue";

describe("phasesForFlow (SPEC-010, pure)", () => {
  it("seeds the full feature pipeline as pending", () => {
    expect(phasesForFlow("feature")).toEqual([
      { name: "Brainstorm", state: "pending" }, { name: "Objective", state: "pending" },
      { name: "Spec", state: "pending" }, { name: "Plan", state: "pending" },
      { name: "Execute", state: "pending" },
    ]);
  });
  it("seeds only the single phase for an only-run", () => {
    expect(phasesForFlow("feature", "Spec")).toEqual([{ name: "Spec", state: "pending" }]);
  });
});
```

(Add `describe`/`it`/`expect` to the existing vitest import if not already present.)

- [x] **Step 2: Write the failing `computeProgress` test**

In `server/test/events-io.test.ts`, add `computeProgress` to the import from `../src/runner/events-io`, then:

```ts
describe("computeProgress (SPEC-010, pure)", () => {
  const P = (states: string[]) => states.map((state, i) => ({ name: `P${i}`, state }));
  it("is 0 for an empty array", () => expect(computeProgress([])).toBe(0));
  it("counts only done phases", () =>
    expect(computeProgress(P(["done", "done", "done", "done", "active"]))).toBe(80));
  it("is 100 when every phase is done", () =>
    expect(computeProgress(P(["done", "done"]))).toBe(100));
  it("does not count a failed phase as done", () =>
    expect(computeProgress(P(["done", "done", "done", "done", "failed"]))).toBe(80));
});
```

- [x] **Step 3: Run both pure tests to verify they fail**

Run: `pnpm --filter @hanoman/server test queue events-io`
Expected: FAIL — `phasesForFlow` and `computeProgress` not exported.

- [x] **Step 4: Implement `phasesForFlow` and seed it in `enqueueRun`**

In `server/src/queue.ts`, extend the runner import (line 2) and add the helper + use it:

```ts
import type { RunInput, Flow } from "@hanoman/runner";
import { PIPELINES } from "@hanoman/runner";
```

```ts
// Seed the phases the run will actually execute (respecting single-phase `only` runs),
// all "pending". persistEvent then flips each to active/done/failed in place.
export function phasesForFlow(flow: Flow, only?: string): { name: string; state: "pending" }[] {
  const names = only ? [only] : PIPELINES[flow];
  return names.map((name) => ({ name, state: "pending" }));
}
```

In the `create` object, replace `phases: [],` (line 34) with:

```ts
      phases: phasesForFlow(input.flow, input.only), plan: [], files: [], log: [],
```

- [x] **Step 5: Implement `computeProgress` and write it in the phase branch**

In `server/src/runner/events-io.ts`, add near the top-level exports:

```ts
// Run progress = fraction of phases marked done. Failed/active/pending don't count,
// so a run that dies at the last phase reads e.g. 80%, not 0% or 100%.
export function computeProgress(phases: { state: string }[]): number {
  if (!phases.length) return 0;
  return Math.round((phases.filter((p) => p.state === "done").length / phases.length) * 100);
}
```

Replace the phase branch (lines 47-50) update with:

```ts
  } else if (e.kind === "phase") {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    const phases = (run.phases as any[]).map((p) => (p.name === e.name ? { ...p, state: e.state } : p));
    await prisma.run.update({ where: { id: runId }, data: { phases, progress: computeProgress(phases) } });
  }
```

- [x] **Step 6: Add the persistEvent phase→progress DB test**

In `server/test/events-io.test.ts`, add a new `describe` (the `makeRun` factory already seeds 4 `done` + `Execute active`):

```ts
describe("persistEvent progress (SPEC-010, db)", () => {
  beforeEach(async () => { await resetDb(); await makeProject(); });

  it("sets progress to 100 when the final phase completes", async () => {
    await makeRun({ id: "RUN-P1", projectId: "p1", status: "running" });
    await persistEvent("RUN-P1", { kind: "phase", name: "Execute", state: "done" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-P1" } });
    expect(run.progress).toBe(100);
  });

  it("leaves progress at the done-fraction when a phase fails (RUN-8801 shape)", async () => {
    await makeRun({ id: "RUN-P2", projectId: "p1", status: "running" });
    await persistEvent("RUN-P2", { kind: "phase", name: "Execute", state: "failed" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-P2" } });
    expect(run.progress).toBe(80); // 4 of 5 phases done
  });
});
```

- [x] **Step 7: Run the Fix-B tests to verify they pass**

Run: `pnpm --filter @hanoman/server test queue events-io`
Expected: PASS — pure `phasesForFlow`/`computeProgress` and both DB progress cases. (Requires the `hanoman_test` DB per the server vitest config; do not point tests at the real `hanoman` DB.)

- [x] **Step 8: Typecheck the server package**

Run: `pnpm --filter @hanoman/server exec tsc --noEmit`
Expected: no errors — `Flow`/`PIPELINES` import resolves; the seeded `phases` satisfies the Prisma Json field.

- [x] **Step 9: Real local check — a seeded run reports phases and progress**

Confirm no dev worker is live first (a shared-Redis enqueue would run for real):

```bash
ps aux | grep -iE "worker|pnpm dev|server/dist" | grep -v grep   # expect: nothing relevant
```

Then verify the seed shape without enqueuing to BullMQ — drive `persistEvent` against `hanoman_test` and read back, or run the events-io DB tests from Step 7 which already prove the DB path. Additionally confirm the enqueue seed by unit output:

```bash
node -e "const {phasesForFlow}=require('./server/dist/queue.js'); console.log(JSON.stringify(phasesForFlow('feature')))"
```

Expected: prints the five pending phases. (Full boot+`POST /runs`+`curl /runs` e2e is done in Task 3, gated on no live worker.)

- [ ] **Step 10: Commit**

```bash
git add server/src/queue.ts server/src/runner/events-io.ts server/test/queue.test.ts server/test/events-io.test.ts
git commit -m "fix(server): record run phases + progress so a run's position is visible (SPEC-010)"
```

---

### Task 3: Docs, index, and end-to-end local verification

**Files:**
- Modify: an operations/runner doc under `internal/docs/**` that describes the Execute gate / run state (identify with the grep in Step 1)
- Modify: `internal/docs/README.md` (index line for SPEC-010)
- Create (optional, light): `internal/docs/adr/0009-guardrail-crash-fails-loud.md`
- Tick: this plan's checklist boxes

**Interfaces:**
- Consumes: the behavior shipped in Tasks 1–2 (tool-error reason, phase/progress tracking).
- Produces: Source-of-Truth docs so `docs verify` coverage stays clean (the guardrail must pass on this very change).

- [x] **Step 1: Find the doc that owns run failure / Execute-gate semantics**

Run: `grep -rniE "Execute|verify|Source of Truth|guardrail|phases|progress" internal/docs --include=*.md -l | head`
Expected: a short list; pick the operations/runner doc (e.g. under `internal/docs/operations/**` or `internal/docs/architecture/**`) that already describes the runner pipeline and its Execute gate.

- [x] **Step 2: Add the run-failure-legibility note to that doc**

Add a subsection stating, in the doc's existing language:
- A run's Execute phase is gated by the Source-of-Truth `docs verify`. Three outcomes: clean → proceed; genuinely stale → `plan diblok · <violations>`; **verify tool crash → retried once, then `guardrail tool error · <stderr>` and fail-closed** (never fail-open).
- `Run.phases` is seeded from the flow pipeline at enqueue and each phase flips pending→active→done/failed; `Run.progress` = done-fraction. A failed run shows where it stopped (e.g. 80% · Execute).

- [x] **Step 3: Write the light ADR (optional but recommended)**

Create `internal/docs/adr/0009-guardrail-crash-fails-loud.md` (match the 0007/0008 format — Context / Decision / Consequences):

```markdown
# ADR-0009 — a crashed guardrail tool fails loud, not silent

## Context
`verifyViaCli` shelled out to `docs verify` and treated ANY non-zero exit as "docs stale"
(RUN-8801: verify crashed transiently; docs were fine; the run failed with an opaque reason).

## Decision
Distinguish a policy block (valid JSON with violations) from a tool crash (non-JSON stdout).
A crash is retried once inside the wrapper; if it still crashes the run fails **closed** with
`guardrail tool error · <stderr>`. The retry is tool-level, not a BullMQ `attempts` bump —
ADR-0005 ("attempts: 1, no auto-retry") stands.

## Consequences
Guardrail failures are diagnosable and no longer masquerade as stale docs. A guardrail that
cannot run never lets Execute proceed. No schema change. A future run-level retry policy
(SPEC-141) can consume the honest `error` signal but does not depend on this.
```

- [x] **Step 4: Add the SPEC-010 index line**

In `internal/docs/README.md`, add a line linking the SPEC-010 design in the same style the file uses for other specs (design doc lives at `docs/superpowers/specs/2026-07-08-hanoman-legible-run-failures-spec-010-design.md`). If ADR-0009 was created, add it to the ADR list too.

- [x] **Step 5: Verify the Source-of-Truth guardrail passes on this change**

Run: `pnpm --filter @hanoman/cli build && node "$(pwd)/cli/dist/hanoman.js" docs verify --block-if-stale --json`
Expected: `{"ok":true,"coverage":100,"violations":[]}` exit 0 — the doc + ADR keep coverage clean (impl changed under `server/`+`runner/`, docs updated in the same change).

- [x] **Step 6: Full test sweep**

Run: `pnpm -r test`
Expected: PASS across runner + server (the `queue-durability` concurrency test may flake on a 5s timeout on this machine — a known non-regression; re-run once if it is the only failure).

- [x] **Step 7: End-to-end local check (gated on no live worker)**

Confirm no dev worker is running, then boot the server and drive one run through the fake-`queryFn` path (or the existing `runs-queue-integration` harness) and read it back:

```bash
ps aux | grep -iE "worker|pnpm dev|server/dist/worker" | grep -v grep   # expect: nothing
pnpm --filter @hanoman/server build && node server/dist/server.js &     # boot API on :8787
# in another shell, using the test-safe harness or a manual POST with a fake queryFn worker:
curl -s localhost:8787/runs | head
```

Expected: a run created after this change shows a non-empty `phases` array and a `progress` that advances phase-by-phase; a forced verify crash yields `guardrail tool error · …` rather than `plan diblok · docs stale`. Stop the booted server afterward.

- [ ] **Step 8: Commit**

```bash
git add internal/docs
git commit -m "docs: run failure legibility + phase/progress tracking, ADR-0009 (SPEC-010)"
```

---

## Self-Review

**Spec coverage:**
- Fix A (crash vs block, retry once, fail-closed, stderr captured, tool-level retry ≠ ADR-0005) → Task 1 (Steps 3, 5) + tests (Steps 1, 6).
- Fix B (seed phases from `PIPELINES[flow]` respecting `only`, compute progress) → Task 2 (Steps 4, 5) + tests (Steps 1, 2, 6).
- No schema change / no migration → enforced by Global Constraints; no Prisma/migration task exists by design.
- Testing: unit (`classifyVerify`, `retryOnCrash`, `phasesForFlow`, `computeProgress`), DI run test, DB persistEvent test, real-local checks → Tasks 1–3.
- Docs same-commit + optional ADR + index + guardrail-still-passes → Task 3.
- Rollout forward-only / no backfill → Global Constraints + spec; no backfill task by design.
- Relationship to SPEC-141 → ADR-0009 Consequences (Task 3 Step 3).

**Placeholder scan:** No TBD/TODO; every code step shows full code; the only "identify the file" step (Task 3 Step 1) supplies the exact grep to locate it (the target doc name is environment-specific and must not be guessed).

**Type consistency:** `VerifyResult { blocked; reason?; error? }` is produced in `deps.ts` (Task 1 Step 3) and consumed structurally by the widened `RunDeps.verify` (Task 1 Step 5) and `run.ts` gate (reads `v.error` then `v.blocked`). `phasesForFlow` returns `{name; state:"pending"}[]` (Task 2 Step 4), consumed by the Prisma `phases` seed and later flipped by `persistEvent`. `computeProgress(phases: {state:string}[])` (Task 2 Step 5) matches its pure test and DB test usage. Names are identical across tasks.
