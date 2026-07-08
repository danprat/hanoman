# SPEC-010 — legible run failures (guardrail crash + phase/progress tracking)

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-002 (CLI docs guardrail), SPEC-003 (runner/phases), SPEC-004 (queue/worker/SSE), SPEC-009 (stage mirror)

## Problem

RUN-8801 (a `feature` run for SPEC-141) failed **opaquely and falsely**. Post-mortem:

1. The run completed Brainstorm → Objective → Spec → Plan (137 log lines, a full agent
   summary). At the **Execute** phase, the Source-of-Truth gate `deps.verify(worktree)`
   (`runner/src/run.ts:23`) shelled out to `node cli/dist/hanoman.js docs verify
   --block-if-stale --json` via `verifyViaCli` (`server/src/runner/deps.ts:5`).
2. That subprocess **crashed** (exited non-zero with no valid JSON on stdout — the verify
   tool threw, it did not report stale docs). `verifyViaCli`'s `catch` swallows *any*
   non-zero exit into `{ blocked: true, reason: "docs verify blocked" }` and **discards
   `stderr`**. `run.ts:24-28` then failed the whole run with `✗ plan diblok · docs verify
   blocked`.
3. Re-running the same `docs verify` in the same leftover worktree returns
   `{"ok":true,"coverage":100,"violations":[]}`, exit 0. The docs were never stale — the
   guardrail tool crashed, and hanoman reported it as a policy block.

**Root cause of the crash (confirmed during implementation):** `verifyViaCli` built the CLI
path from `process.cwd()` — `${process.cwd()}/cli/dist/hanoman.js`. The dev worker runs from
`server/` (`dev:worker` = `pnpm --filter ./server worker` → `tsx watch src/worker.ts`), so
that path resolved to the **non-existent** `server/cli/dist/hanoman.js` → a *deterministic*
module-not-found crash every time Execute is reached under `pnpm dev`. `@hanoman/cli` is not
even a dependency of `server`, so node module resolution wouldn't find it either. This — not a
transient throw — is why RUN-8801 failed; retry alone could not have saved it.

Two distinct defects made this both *happen* and *impossible to read*:

- **A — guardrail tool crash is indistinguishable from a policy block.** `verifyViaCli`
  conflates "docs are legitimately stale" (a decision) with "the verify tool failed to run"
  (a crash), reports both as blocked with a useless generic reason, and throws away the one
  piece of evidence (`stderr`) that would explain it.
- **B — `phases` and `progress` are never recorded.** `queue.ts:34` seeds `phases: []`;
  `persistEvent`'s phase branch (`events-io.ts:47-50`) `.map()`s over that empty array and
  only updates an entry whose `name` already exists — it never appends. `progress` is never
  written anywhere (only the `0` seed at `queue.ts:36`). So **every** run has `phases: []`
  and `progress: 0`, and the dashboard could not show that RUN-8801 died at Execute.

## Key insight

Both defects already have their single choke point in the codebase — this is hardening two
existing seams, not adding machinery.

- The verify tool wrapper `verifyViaCli` is the *only* place a non-zero CLI exit is
  interpreted. The three outcomes it must tell apart are already fully determined by
  `(status, stdout)`: `docs-verify.ts` **always** writes JSON to stdout before returning its
  exit code, so *non-JSON stdout with a non-zero exit can only mean the tool crashed* — never
  a legitimate stale-docs report. The classification is a pure function of the spawn result.
- `persistEvent` is the single serialized writer of run state (SPEC-009 established this).
  Its phase branch was written correctly for a *pre-seeded* phases array; the only bug is
  that `queue.ts` seeds `[]` instead of the pipeline. The phase names are already known at
  enqueue — `input.flow` drives `PIPELINES[flow]` in `runner/src/phases.ts`.

## Approach

Ship two small, independent fixes. Neither changes the schema (`Run.phases`, `Run.progress`
already exist; the `verify` result type is internal to the server↔runner boundary), so there
is no migration.

### Fix A — tool crash ≠ policy block, with one retry

`verifyViaCli` (`server/src/runner/deps.ts`) distinguishes three outcomes and retries a
crash once before giving up:

| spawn result | meaning | wrapper returns |
|---|---|---|
| `status === 0` | docs clean | `{ blocked: false }` |
| `status !== 0` **and** stdout parses as JSON | docs genuinely stale | `{ blocked: true, reason: <violations joined> }` |
| `status !== 0` **and** stdout is not JSON | the verify tool crashed | retry once; if still a crash → `{ blocked: true, error: <stderr, truncated> }` |

- **Resolve the CLI path independent of `cwd` (the primary fix).** Add `repoRootFrom(startDir)`
  that walks up to the committed `pnpm-workspace.yaml`, and `resolveCliEntry(startDir =
  process.cwd())` returning `<root>/cli/dist/hanoman.js`. `verifyViaCli` calls
  `resolveCliEntry()` instead of `${process.cwd()}/cli/dist/hanoman.js`. This is robust to the
  worker's launch cwd (`server/` under `pnpm dev`, repo root under `node dist/worker.js`) and
  to src-vs-bundled-dist (anchoring on `import.meta.url` would differ between the two).
- Extract a pure classifier so the three-way decision is unit-testable without spawning:

  ```ts
  type VerifyResult = { blocked: boolean; reason?: string; error?: string };
  export function classifyVerify(r: { status: number | null; stdout: string; stderr: string }): VerifyResult {
    if (r.status === 0) return { blocked: false };
    try { const j = JSON.parse(r.stdout); return { blocked: true, reason: (j.violations ?? []).map((v: any) => v.reason).join("; ") }; }
    catch { return { blocked: true, error: (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 500) }; }
  }
  ```

- `verifyViaCli` spawns, classifies, and **retries exactly once when the result carries
  `error`** (i.e. a crash), returning the second attempt's classification. The retry is an
  implementation detail of the guardrail-tool wrapper: it re-runs the *verify subprocess*, it
  is **not** a BullMQ `attempts` bump and does **not** re-run the Claude phase — so
  ADR-0005 ("durable queue and worker", `attempts: 1`, no auto-retry) is untouched.

- Widen the `verify` dependency type from `{ blocked: boolean; reason?: string }` to
  `{ blocked: boolean; reason?: string; error?: string }` (`RunDeps.verify` in
  `runner/src/run.ts:6` / `runner/src/types.ts`).

- `run.ts` Execute gate (`run.ts:22-30`) branches on the shape:
  - `v.error` present → `onEvent({ kind: "log", line: { t: "✗", s: \`guardrail tool error · ${v.error}\` } })`
  - else (`v.blocked`) → existing `✗ plan diblok · ${v.reason ?? "docs stale (Source of Truth)"}`

  then the existing `phase failed` + `status failed` + `return`. **Both paths fail-closed** —
  a guardrail that cannot run must never let Execute proceed (no fail-open). The only change
  is that a crash is now *legible*: its reason is the real `stderr`, not "docs stale".

### Fix B — seed phases at enqueue, compute progress on each phase event

- `queue.ts` `enqueueRun`: replace `phases: []` with the phases the run will actually
  execute, all `pending`. Respect single-phase runs (`input.only`, used by spec/plan per
  SPEC-009):

  ```ts
  const names = input.only ? [input.only] : PIPELINES[input.flow];
  // ...
  phases: names.map((name) => ({ name, state: "pending" })),
  ```

  `PIPELINES` is imported from `@hanoman/runner` (already the source of the pipeline in
  `runner/src/phases.ts`).

- `events-io.ts` `persistEvent` phase branch: the existing `.map()` now updates real
  entries. The same `run.update` also writes `progress`, computed from the updated array:

  ```ts
  const phases = (run.phases as any[]).map((p) => (p.name === e.name ? { ...p, state: e.state } : p));
  const done = phases.filter((p) => p.state === "done").length;
  const progress = Math.round((done / phases.length) * 100);
  await prisma.run.update({ where: { id: runId }, data: { phases, progress } });
  ```

  Failed/active phases don't count as done, so RUN-8801 would read **80% · Execute failed**
  (4 of 5 phases done) instead of `0%`. A fully successful run reaches 100% on its last
  phase's `done` event.

## Data model

No change. `Run.phases` (Json), `Run.progress` (Int), and the internal `verify` result type
already exist. No migration, no ADR-for-schema.

## Testing

Per `CLAUDE.md` — unit tests for the orchestration logic **and** a real local API check.

- **Unit**
  - `classifyVerify`: exit 0 → not blocked; exit≠0 + valid violations JSON → blocked with
    joined reasons; exit≠0 + garbage stdout → `error` set (crash). (`server`)
  - `verifyViaCli` retry: first spawn crashes, second returns clean → wrapper returns not
    blocked (proves retry recovers RUN-8801's transient); both crash → `error` set. Drive by
    pointing the wrapper at a stub script / injecting the spawn, so no real CLI is needed.
  - `run.ts` via injected `verify` (existing DI harness, `runner/test/run.test.ts`):
    `verify` → `{ blocked: true, error: "boom" }` fails the run and logs
    `guardrail tool error · boom`; `{ blocked: true, reason: "..." }` still logs `plan diblok`.
  - `computeProgress(phases)` / phase-seeding helper: `phasesForFlow("feature")` has 5
    pending entries; progress after N `done` events = `round(N/total*100)`.
- **Integration** — feed a run's `phase`/`status` events through `persistEvent` for a
  pre-seeded run and assert `phases` states advance and `progress` tracks them.
- **Real API (required by CLAUDE.md)** — boot the server, enqueue a run driven by the
  fake-`queryFn` harness, `curl /runs` and confirm `phases` is populated and `progress`
  advances phase by phase; force a verify crash (stub CLI path that exits non-zero with
  non-JSON) and confirm the run's failure reason is the tool error, not "docs stale".

## Rollout / backfill

Existing rows keep `phases: []` / `progress: 0`; the fix is forward-only (new runs seed
correctly). No backfill — the empty history is cosmetic and RUN-8801 stays as the documented
example. (`ponytail:` no migration to rewrite historical run rows; add one only if the runs
list must render old runs' phases, which it need not.)

## Docs to update in the same commit

`internal/docs/**` surface describing run failure semantics and phase/progress tracking
(Source of Truth) — specifically the operations/runner doc that covers the Execute gate and
run state. ADR **optional and light**: a short note that a crashed guardrail tool fails-closed
but loud and is distinct from a policy block (and that its one retry is tool-level, not the
ADR-0005 run-level `attempts`). No schema ADR — nothing in the schema changes.

## Relationship to SPEC-141

SPEC-141 (retry policy, design stranded in RUN-8801's uncommitted worktree) classifies
*run-level* failures as deterministic vs transient and may auto-spawn retry runs. SPEC-010 is
narrower and orthogonal: it makes a *guardrail-tool crash* legible and self-heals it with one
in-wrapper retry. If SPEC-141 later lands, a still-crashing guardrail (`error` set) is a
natural "transient" input to its classifier — SPEC-010 provides the honest signal SPEC-141
would consume, and neither depends on the other to ship.
