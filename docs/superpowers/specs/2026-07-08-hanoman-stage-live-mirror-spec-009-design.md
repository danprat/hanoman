# SPEC-009 — spec stage as a live mirror of a real run

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-003 (runner/phases), SPEC-004 (queue/worker/SSE), SPEC-008 (de-mock sweep)

## Problem

The backlog board lets a spec's `stage` be advanced with no real work behind it. Clicking
the per-stage button (`Kunci objective → Tulis spec → Buat plan → Execute`) calls
`POST /specs/:id/advance`, which calls `advance()` in `server/src/services/stage-machine.ts`
— a **pure linear counter** that bumps `Spec.stage` to the next index and returns. Nothing
is brainstormed, no spec is written, no plan is created, no run is enqueued. Even the
"Execute" step only navigates the UI to the Runs tab (`src/src/App.tsx` `advanceSpec`); it
does not start a run. A spec can therefore reach `executing`/`done` while brainstorming
never happened.

## Key insight

The real pipeline the board pretends to walk **already exists inside a Run**.
`runner/src/phases.ts`:

```
feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"]
qa:      ["Audit", "Spec", "Plan", "Execute"]
```

A single `feature` Run already executes each phase as real Claude Code headless work in a
git worktree, with a per-phase model, git commit + docs sync, the `deps.verify`
Source-of-Truth guardrail (blocks Execute on stale docs), budget gating, and
steer/pause/resume. The `Spec.stage` lifecycle
(`brainstorming → objective → spec-ready → planned → executing → done`) is a **cosmetic
duplicate** of those phases that was never wired to a run.

So this is not "build an orchestrator" — it is "connect two things that already exist":
make `Spec.stage` a **read-only mirror** of the phases of a real run tied to that spec.

## Approach (chosen: autonomous run, stage mirrors live)

Starting work on a spec enqueues **one** real Run (`flow` derived from `spec.source`),
tied to `specId`. The run walks its full pipeline unattended. As the runner emits real
`phase` / `status` events, `persistEvent` advances the spec's stage. Human control is via
the existing run terminal (pause/steer/stop). The fake `advance()` path is removed.

Rejected alternatives:
- **Checkpoint per phase** (auto-pause + approve-to-continue) — more control than needed;
  pause/steer already available on demand.
- **One run per stage button** (`only:<phase>` single-phase runs) — heaviest: a
  worktree+commit per phase, artefacts threaded across runs via branch. Most new plumbing.

## Design

### 1. Stage mirroring — `server/src/runner/events-io.ts`

`persistEvent(runId, e)` is the single choke point every run event flows through and the
`Run` row already carries `specId`. Add a pure helper and call it on `phase`/`status`
events when the run has a `specId`:

```ts
// phase name (on state "done") → the stage the spec should now sit in
const PHASE_DONE_STAGE: Record<string, Stage> = {
  Objective: "objective",   // feature: objective locked
  Audit:     "objective",   // qa: audit ≈ objective locked (see simplification)
  Spec:      "spec-ready",
  Plan:      "planned",
  // Brainstorm done → no bump (still "brainstorming" until Objective locks)
};

// returns the next stage, or null if no change / would move backward
function mirrorStage(current: Stage, e: RunEvent): Stage | null {
  let target: Stage | null = null;
  if (e.kind === "phase" && e.state === "done") target = PHASE_DONE_STAGE[e.name] ?? null;
  else if (e.kind === "phase" && e.state === "active" && e.name === "Execute") target = "executing";
  else if (e.kind === "status" && e.status === "done") target = "done";
  if (!target) return null;
  // monotonic forward only — a re-run or late/out-of-order event can't pull it back
  return STAGES.indexOf(target) > STAGES.indexOf(current) ? target : null;
}
```

Wiring in `persistEvent`: on a `phase` or `status` event, look up the run's `specId`
(the run row is already fetched for `phase`; add one lookup for `status`). If present,
load the spec, compute `mirrorStage(spec.stage, e)`, and update `spec.stage` when non-null.
`STAGES` moves from `stage-machine.ts` into (or is imported by) this module.

### 2. Starting the run — `BacklogScreen.tsx` + `App.tsx`

The per-stage `B_ACTION` map collapses to three card states:

- stage `brainstorming` **and** no active run for the spec → **"Mulai"** →
  `POST /runs` (existing endpoint) with `{ project: spec.projectId, specId: spec.id,
  flow: spec.source === "qa" ? "qa" : "feature", branchFrom: <default>, branchTo:
  hanoman/<runId> }`.
- a run is active (`running`/`paused`) for the spec → **"Buka run"** → open the run
  terminal (existing RunsScreen); control lives there.
- stage `done` → the existing "selesai" badge.

"Active run for the spec" is derived from the runs list already loaded in `App.tsx`
(`run.specId === spec.id && (status running|paused)`).

The `StageBar` component is unchanged — it now moves because `Spec.stage` in the DB
actually changes. The board refreshes by **polling `/specs` on a short interval while any
visible spec has an active run** (and on tab focus). No new SSE channel.

### 3. Removals (root-cause, not patch)

- `advance()` in `server/src/services/stage-machine.ts` — delete. Keep `STAGES` /
  `nextStage` (order + the monotonic-forward guard); relocate/import as needed.
- `POST /specs/:id/advance` route (`server/src/routes/specs.ts`) — delete.
- `api.advanceSpec` (`src/src/api/client.ts`), `advanceSpec()` + `advToast` wiring
  (`src/src/App.tsx`) — delete.
- `zAdvanceResult` (`shared/src/dto.ts`) — delete if unused after the above.

### 4. Guardrail alignment (CLAUDE.md)

Nothing is bypassed. Execute is still gated by `deps.verify` (Source-of-Truth). Because
`stage` is now only a mirror, `executing`/`done` are **unreachable** unless a real run
passed that guardrail. This enforces the requirement directly rather than adding a new gate.

## Data model

No schema change. `Spec.stage` and `Run.specId` already exist. `Spec.stage` simply stops
being writable via the advance route and becomes writable only by `persistEvent`.

## Testing

- **Unit** — `mirrorStage()` pure function: `Objective done → objective`;
  `Spec done` from `brainstorming → spec-ready` (forward jump allowed);
  `Execute active → executing`; `status done → done`; a backward/out-of-order event →
  `null` (no change).
- **Integration** — feed a run's phase/status events through `persistEvent` for a run with
  a `specId` and assert the `Spec` row's `stage` advances; a run with `specId = null`
  leaves all specs untouched.
- **Real API (required by CLAUDE.md)** — boot the server, `POST /runs` with a `specId`,
  drive the run via the existing fake-queryFn harness, then `curl /specs` and confirm the
  spec's `stage` reflects the phases reached.

## Deliberate simplification (`ponytail:`)

QA specs reuse the same 6-stage bar; `Audit` maps to `objective`, so the bar visually
jumps `brainstorming → objective` for QA (there is no "audit" stage). Acceptable while the
board is mostly briefs. Upgrade path: a per-flow stage bar if QA specs become common.

## Docs to update in the same commit

`internal/docs/**` surface describing the backlog lifecycle / stage transitions (Source of
Truth), plus an ADR if the removal of the advance endpoint is worth recording.
