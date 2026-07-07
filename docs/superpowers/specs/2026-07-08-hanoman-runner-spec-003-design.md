# SPEC-003 — hanoman runner (Claude Code headless + worktree + live control)

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-001 (server, Postgres, Run model, SSE endpoint surface, Runs UI),
SPEC-002 (`hanoman` CLI + `docs verify`/`hook stop` guardrail)

## Place in the sequence

Third of the fully-real spec sequence (no stubs). SPEC-003 is the runner — the heart
of hanoman. It replaces SPEC-001's `404` run-control/SSE placeholders with the real
thing: Claude Code headless (via the Agent SDK) executing a spec in a git worktree,
streaming live logs, under full human control. Per the user's decision it is **one
large spec** covering **all** LLM command flows (feature `spec→plan→execute`, QA
`audit→…`, `scaffold`, `reverse`) with live control. The BullMQ queue, cron
scheduler, and GitHub webhooks remain later specs (004–006).

## Verified foundation (Agent SDK)

Confirmed against current `@anthropic-ai/claude-agent-sdk` docs (Context7):
- `query({ prompt, options })` returns an async iterable of messages
  (`assistant`/`result`/`system`), each with `session_id`.
- **Streaming input mode:** pass an **async generator** as `prompt` that yields
  `{ type:"user", message:{ role:"user", content } }` — lets us inject a *steer*
  message into a live run ("queued messages with ability to interrupt").
- Options used: `abortController`, `model`, `fallbackModel`, `maxThinkingTokens`,
  `maxBudgetUsd`, `disallowedTools`, `permissionMode`, `canUseTool`, `resume`,
  `forkSession`, `hooks`, `settingSources:['project']`, `cwd`, `includePartialMessages`,
  `systemPrompt:{type:'preset',preset:'claude_code'}`, `stderr`.
- Result message carries `total_cost_usd`, `usage`, `modelUsage`, `num_turns`,
  `subtype` (`success`|`error_max_budget_usd`|`error_during_execution`|…).

> Implementation note: pin the exact installed SDK version and re-verify option names
> against its typings before coding; treat the list above as the design intent.

## Goal

`hanoman execute SPEC-x` (and the sibling flows) run Claude Code headless in an
isolated git worktree, drive the phased pipeline, stream logs live to the dashboard,
enforce the docs guardrail at plan→execute, and let a human steer / pause / resume /
stop in ≤2s — then commit, push to `branchTo`, and remove the worktree.

Definition of done:
- A real run executes a spec end-to-end in a worktree and streams logs to the Runs
  screen with <1s latency.
- Steer injects a message mid-run; pause/stop take effect ≤2s; resume continues the
  session; retry re-runs from the failed phase.
- The plan→execute guardrail blocks a run when docs are stale (SPEC-002).
- Concurrency respects `maxConcurrent`; per-run spend respects `dailyBudget`.
- Tests green (SDK mocked); one opt-in live smoke passes when enabled.
- Touched `internal/docs` updated + linked; ADR-0003 model IDs refreshed.

## Approaches considered

- **Execution mechanism:** shell out to `claude -p --output-format stream-json` vs. the
  **Agent SDK** (`query()`). **Decision: Agent SDK** — its streaming-input mode is the
  only clean way to inject steer messages mid-run and to `abort`/`resume` for ≤2s
  pause/stop, and its `hooks`/`canUseTool`/`settingSources` give first-class safety.
- **Runner placement:** inside `server/` vs. a **shared `runner/` package**.
  **Decision: shared `runner/` workspace package** consumed by both `cli/` (standalone
  `hanoman execute`) and `server/` (dashboard-managed runs) — one implementation of the
  pipeline, two entry points.
- **Pause semantics:** interrupt the current turn + `resume` later (≤2s) vs. soft pause
  that finishes the turn first. **Decision: interrupt + resume.**

## Scope

### In scope
- New `runner/` workspace package: the pipeline core, worktree lifecycle, SDK adapter,
  event model. Consumed by `cli/` and `server/`.
- CLI commands (real, via runner core): `hanoman execute|spec|plan SPEC-x`,
  `hanoman qa SPEC-x` (audit→…), `hanoman scaffold --from objective`,
  `hanoman reverse --dir <path>`.
- Server `RunManager`: create/track runs, `maxConcurrent` semaphore, per-run event bus.
- Real API (replacing SPEC-001 404s): `GET /runs/:id/log` (SSE), `POST /runs/:id/steer`,
  `POST /runs/:id/control` (pause|resume|stop|retry), `POST /runs/:id/worktree`,
  `POST /runs/:id/command`.
- Safety: deny rules (`rm -rf`, push to `main`) via `disallowedTools` + `canUseTool`
  + the worktree's `.claude/settings.json`; `maxBudgetUsd` from `dailyBudget`.
- Guardrail integration at plan→execute (SPEC-002 `docs verify`).
- ADR-0003 amendment (model IDs) + touched docs.

### Out of scope (later specs, built real there)
BullMQ/Redis queue → SPEC-004; cron scheduler → SPEC-005; GitHub webhooks → SPEC-006.

## Components

**`runner/` package**
- `worktree.ts` — `addWorktree(repo, run, branchFrom)`, `removeWorktree`,
  `commitAndPush(worktree, branchTo)`, branch switch. Wraps `git worktree`/`git`.
- `phases.ts` — the pipeline definitions per run kind (feature/qa/scaffold/reverse):
  ordered phase list + the prompt/role for each phase.
- `sdk.ts` — `runPhase({ cwd, model, effort, promptStream, abortController, onEvent })`
  wrapping `query()`; maps SDK messages → runner events; returns `{ sessionId, cost,
  usage, subtype }`.
- `steer-queue.ts` — an async generator + push API backing streaming-input mode.
- `run.ts` — `runOne(ctx)`: worktree → for each phase: (guardrail gate if entering
  execute) → `runPhase` → persist phase/log/cost → handle abort/steer → commit/push →
  cleanup. Emits events throughout.
- `events.ts` — `RunEvent` union: `log`, `phase`, `file`, `cost`, `status`.

**`server/` additions**
- `runner/manager.ts` — `RunManager`: `start(runInput)`, `steer`, `control`, `command`,
  `subscribe(runId)`; `maxConcurrent` semaphore; per-run `EventEmitter`; persists every
  event to Postgres (`Run.log/phases/files`, tokens/cost/status) and forwards to SSE.
- `routes/runs.ts` — add the control/SSE endpoints (the SPEC-001 `runs.ts` grows;
  reads stay).

**`cli/` additions**
- `commands/execute.ts`, `spec.ts`, `plan.ts`, `qa.ts`, `scaffold.ts`, `reverse.ts` —
  thin wrappers calling `runner` core with `cwd = process.cwd()`, streaming events to
  stdout.

## Run lifecycle (ADR-0002)

1. `git worktree add .worktrees/<run-id> <branchFrom>`.
2. For each phase in the kind's pipeline, `runPhase` with the step's model/effort
   (Settings, ADR-0003). Persist phase state + stream logs.
3. **Entering `execute`:** run `hanoman docs verify --block-if-stale` in the worktree.
   Block → set run `failed` with the "Plan blocked — docs stale" reason (matches the
   prototype's failed callout); stop the pipeline.
4. On success: `git add/commit`, `git push` to `branchTo`, then `git worktree remove`.
5. On stop: abort, status `stopped`, **keep** the worktree (progress saved); retry can
   resume from it.

## Control surface (real; replaces SPEC-001 404 stubs)

| Endpoint | Mechanism |
|---|---|
| `GET /runs/:id/log` (SSE) | subscribe to the run's event bus; replay persisted log then stream live |
| `POST /runs/:id/steer {message}` | push `{type:"user",message:{role:"user",content:message}}` into the run's steer-queue generator |
| `POST /runs/:id/control {action:"pause"}` | `abortController.abort()` current turn; status `paused`; retain `sessionId` |
| `POST /runs/:id/control {action:"resume"}` | `query({ resume: sessionId, … })`; status `running` |
| `POST /runs/:id/control {action:"stop"}` | abort; status `stopped`; keep worktree |
| `POST /runs/:id/control {action:"retry"}` | re-run from the failed phase; re-scan docs first |
| `POST /runs/:id/worktree {branchFrom?,branchTo?}` | switch base/target branch on the worktree |
| `POST /runs/:id/command {text}` | terminal interpreter (`help/status/plan/files/steer <m>/pause/resume/stop/docs <path>/clear`) mapping to the controls above |

All bodies validated against `shared/` zod schemas (extends the SPEC-001 contract).

## Live streaming & persistence

Each `RunEvent` is **persisted** (Postgres: append to `Run.log`, update
`Run.phases/files/status`, accumulate `tokensIn/Out/cost` from `usage`/`total_cost_usd`)
**and** forwarded to SSE subscribers. On SSE connect: send the persisted log snapshot,
then live events. `includePartialMessages` gives token-level updates for <1s latency
(NFR). Log-line shape matches the prototype's `{ t, s }` (glyph + text).

## Safety (security-standard)

- `permissionMode` (e.g. `acceptEdits` for auto, stricter for manual mode),
  `disallowedTools` blocking destructive Bash, and a `canUseTool` callback rejecting
  `rm -rf`, pushes to `main`, and writes outside the worktree.
- `settingSources: ['project']` loads the worktree's `.claude/settings.json` — so the
  SPEC-002 `hanoman hook stop` guardrail and deny rules apply inside the run too.
- `maxBudgetUsd` per run derived from Settings `dailyBudget`; run ends with
  `error_max_budget_usd` if exceeded. Credentials stay server-side, never sent to the
  client.
- `maxConcurrent` semaphore in `RunManager`; excess runs wait (full queueing is
  SPEC-004).

## Testing (TDD, per CLAUDE.md)

Vitest. The SDK is injected (a `queryFn` dependency) so tests supply a **fake async
iterable** of SDK messages:
- **Pipeline:** phase order per kind; phase-state persistence; success → commit/push.
- **Guardrail gate:** entering `execute` with stale docs → run `failed`, pipeline stops
  (spy on `docs verify`).
- **Steer:** a pushed message appears as the next `user` turn to the fake SDK.
- **Pause/stop timing:** `abort()` resolves the run to `paused`/`stopped` within the
  budget; worktree retained.
- **Resume:** `resume: sessionId` passed through.
- **Worktree lifecycle:** against a temp git repo — add/commit/push(to a bare remote)/
  remove.
- **SSE:** replay-then-live; a late subscriber gets the backlog.
- **Budget:** `error_max_budget_usd` → status `failed` with the budget reason.
- **Opt-in live smoke** (`HANOMAN_LIVE_SDK=1`): one real `hanoman execute` against a
  throwaway repo + cheap model; skipped by default (no token spend in CI).

## Acceptance criteria

1. `hanoman execute SPEC-x` (or dashboard trigger) creates a worktree, runs the phased
   pipeline via the SDK, and streams logs to `GET /runs/:id/log` with <1s latency.
2. `POST /runs/:id/steer` injects a message that the run consumes as its next turn.
3. `pause` and `stop` take effect ≤2s; `resume` continues the same session; a stopped
   run keeps its worktree; `retry` re-runs from the failed phase.
4. Entering `execute` with stale/unlinked docs blocks the run (SPEC-002 guardrail) with
   the "docs stale" reason; fixing the index + retry proceeds.
5. On success the run commits and pushes to `branchTo` and removes the worktree; a
   destructive tool call (`rm -rf`, push to `main`) is denied.
6. `maxConcurrent` is respected (an N+1th run waits); a run exceeding `maxBudgetUsd`
   ends with the budget error.
7. `scaffold`, `reverse`, and `qa` flows each run their pipeline and produce their
   output (doc index / reverse-engineered docs / audit→spec).
8. Tests green (SDK mocked); the live smoke passes when `HANOMAN_LIVE_SDK=1`.
9. ADR-0003 refreshed to `claude-opus-4-8`; touched `internal/docs` linked in the index.

## Follow-up

SPEC-004 externalizes `RunManager` scheduling to BullMQ/Redis (durable queue,
`dailyBudget` enqueue cutoff). SPEC-005 fires runs on cron triggers. SPEC-006 fires
runs on GitHub commit webhooks.
