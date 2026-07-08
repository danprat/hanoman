# SPEC-008 — hanoman de-mock sweep

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-001 (foundation/UI skeleton), SPEC-003 (runner), SPEC-004 (queue/worker/SSE)

## Place in the sequence

Second operability item after SPEC-007. The v1.0 sequence (001–006) wired the real
orchestration end-to-end — Claude Agent SDK, git worktrees, Postgres, Redis/BullMQ,
GitHub App. An audit of the whole tree found the core is genuinely real; what remains are
three residual mock/placeholder surfaces the earlier specs deferred or left behind. This
spec removes all of them in one sweep so every surface a user sees or drives reflects real
state.

## Context

Audit findings (2026-07-08), by kind:

1. **Fabricated terminal responses** — `server/src/routes/runs.ts` `runCommand()` + the
   `POST /runs/:id/command` route. Read/display verbs (`status`, `plan`, `files`, `help`,
   `clear`) already read real persisted `Run` data. But three paths lie:
   - **free text (`default`)** returns a fabricated Claude reply
     (`` `claude: "${text}" diterima — memproses dalam konteks run` ``) and has **no
     effect** — the text never reaches the run.
   - **`resume`** returns `"dilanjutkan oleh manusia"` but does **not** re-enqueue the run.
     The dedicated `POST /runs/:id/control` endpoint *does* re-enqueue correctly; the
     terminal path is a canned mirror that skips the effect.
   - **`docs <path>`** returns `"membuka internal/docs/…"` and opens nothing.

2. **Unwired live run view** — `src/src/screens/RunsScreen.tsx` is `READ-ONLY` (its own
   header notes controls "arrive with the runner in SPEC-003", which did not happen). It
   renders `run.log` from the **static mount-time snapshot**, never subscribing to the
   backend SSE stream `GET /runs/:id/log` (which already replays the snapshot then relays
   live `log`/`phase`/`status`/`cost`/`file` events). It has no terminal input and no
   steer/pause/resume/stop controls. `duration` is hardcoded `"—"` in `App.tsx`.

3. **Prototype demo data in the repo** — `server/prisma/proto-data.ts` +
   `proto-doc-content.ts` + `seed.ts` hold the prototype's demo dataset (6 fake projects
   `sembada/arta/loka-pos/wanara/candra/gapura`, fake specs/runs/docs). The production seed
   *command* was removed (commit `fda088d`); the files now serve **only** ~20 test files via
   `seed()`. They are the source of the hardcoded prototype ids leaking into `App.tsx`
   (`"loka-pos"`, `"RUN-8842"`).

Everything else audited (services, routes, runner, worker, GitHub integration, `events-io`,
frontend `App.tsx` data flow + `api/client`) is real; `mock`/`fake` mentions elsewhere are
dependency-injection comments for tests, not production mocks.

## Goal

Remove all three residual mock surfaces so:
- The run terminal never fabricates a Claude reply; free text and `resume` produce their
  real effects; `docs` reads a real file.
- `RunsScreen` shows live run state (SSE) and its controls actually drive the run.
- The repo carries no prototype demo dataset; tests build only the data they assert on.

Definition of done:
- **Phase 1** — terminal `default`/`resume`/`docs` produce real effects or truthful
  output; no prototype ids hardcoded in `App.tsx`.
- **Phase 2** — `RunsScreen` subscribes to `/runs/:id/log`, merges live events, exposes
  working steer/pause/resume/stop + free-text input, and shows a real `duration`.
- **Phase 3** — `proto-data.ts`/`proto-doc-content.ts`/`seed.ts` deleted; tests use a typed
  factory + `resetDb()`; the suite is green.
- Touched `internal/docs` updated + linked; ADR-0007 for the `Run.finishedAt` column.

## Approaches considered

- **One spec, three phases** (chosen): the three surfaces share one theme ("no mocks") but
  are independent; each phase is independently checkpoint-able and testable. Phase 1 is a
  small, safe backend change; Phase 2 is a frontend feature over existing endpoints; Phase 3
  is a riskier test-infra refactor. One design doc keeps the sweep coherent; the plan gates
  each phase on green tests.
- **Three separate specs (008/009/010)**: cleaner isolation, but triples the spec/plan
  overhead for a single coherent objective and obscures that they're one sweep. Rejected.
- **Leave Phase 3 as test fixtures**: prototype data in tests is technically legitimate,
  but it leaks prototype ids into production `App.tsx` and reads as demo data. The user
  chose to remove it. Rejected.

## Scope

### Phase 1 — Kill fabricated terminal responses + prototype ids

In scope:
- `server/src/routes/runs.ts`:
  - Extract `applyControl(runId, action)` (the pause/stop/resume/retry logic currently
    inline in `POST /runs/:id/control`) into a shared helper; call it from both `/control`
    **and** the terminal `resume`/`retry` verbs so `resume` really re-enqueues (root-cause
    fix: one place, both callers).
  - Free text (`runCommand` `default` case): stop returning a fabricated Claude line. If the
    run is active (`running`/`paused`), publish the text as a `steer` control message (real
    effect) and return a truthful ack; otherwise return a line stating the run is not active.
  - `docs <path>`: replace the canned `"membuka…"` with a real `readDoc(projectId, path)`
    lookup — return existence + line count (or "not found").
  - Leave `status`/`plan`/`files`/`diff`/`help`/`clear` — they already read real `Run` data.
- `src/src/App.tsx`: `useState("loka-pos")` → `useState("")` and select `projectsView[0]?.id`
  after load; remove `selectedId="RUN-8842"` from `<RunsScreen>` (its `runs[0]` fallback
  already covers it).

### Phase 2 — RunsScreen live + working controls

In scope:
- `shared/src/api.ts`: add `runLog`, `runCommand`, `runControl`, `runSteer` path builders
  (routes already exist).
- `src/src/api/client.ts`: `subscribeRun(id, onEvent): () => void` using **native
  `EventSource`** (no new dependency); plus `runCommand`/`runControl`/`runSteer` POST
  wrappers.
- `src/src/screens/RunsScreen.tsx`: on selecting a non-terminal run, open the SSE stream,
  merge live events into local run state (`log` append, `phase`/`status`/`cost` update,
  `file` append), and close on terminal status or unmount. Add a terminal input (→
  `POST /command`) and steer/pause/resume/stop controls (→ the matching endpoints).
- `duration`: add nullable **`Run.finishedAt DateTime?`** (migration + ADR-0007); set it in
  `server/src/runner/events-io.ts` `persistEvent` when status becomes terminal
  (`done`/`failed`/`stopped`). Compute `duration` client-side as `(finishedAt ?? now) −
  createdAt`, ticking live for running runs. Expose `finishedAt` through the run DTO/type.

### Phase 3 — Remove prototype dataset

In scope:
- Delete `server/prisma/proto-data.ts`, `server/prisma/proto-doc-content.ts`,
  `server/prisma/seed.ts`.
- Add `server/test/factory.ts`: `resetDb()` (the existing deleteMany transaction) + typed
  builders `makeProject`/`makeSpec`/`makeRun`/`makeTrigger`/`makeDocFile`/`makeSetting`,
  each defaulting every required column so a test overrides only what it asserts on.
- Migrate every test currently importing `seed` (~20 files): replace `seed()` with
  `resetDb()` + the factory data that test needs, and replace hardcoded prototype-id
  assertions (`loka-pos`, `arta`, `SPEC-142`, `RUN-8842`, etc.) with the ids the factory
  creates. One test at a time, green before moving on.

### Out of scope
- `paths.fsBrowse` / any `/fs/browse` surface — appears unused, but it is not a mock; a
  separate cleanup if wanted.
- Runner pipeline, guardrails, Source-of-Truth verify — already real.
- Any new run-timing beyond `finishedAt` (e.g. per-phase timings).
- Auth/permissions on the control endpoints — unchanged from SPEC-003/004.

## Behavior

### Phase 1 — terminal command routing

```
POST /runs/:id/command  { text }
  parse verb
   ├─ status|plan|files|diff|help|clear  → render from persisted Run (unchanged, real)
   ├─ steer <msg>                        → applyControl-adjacent: publish {steer, msg}, truthful ack
   ├─ pause | stop                       → publish control {pause|stop}, truthful ack
   ├─ resume | retry                     → applyControl(id, action) → re-enqueue (409 if budget)
   ├─ docs <path>                        → readDoc(projectId, path) → "✓ <path> · N baris" | "✗ tidak ditemukan"
   └─ <free text>                        → run active ? publish {steer, text} + ack : "run tidak aktif"
```

`applyControl(runId, action)` (shared by `/control` and the terminal) encapsulates:
pause/stop → publish control + set status; resume/retry → re-enqueue via `enqueueRun`
(returns a 409-able `{enqueued:false, reason}`).

### Phase 2 — live run view

```
RunsScreen select(run)
  run terminal?  → render persisted snapshot only (no stream)
  run active?    → EventSource(paths.runLog(id))
                     onmessage → reduce event into local run copy:
                       log   → append line
                       phase → set phase state
                       status→ set status (terminal → close stream)
                       cost  → set tokensIn/out + cost
                       file  → append file row
  controls → POST /command | /control | /steer ; input box → POST /command
  duration → (run.finishedAt ?? Date.now()) − run.createdAt, re-rendered on a 1s tick while running
```

### Phase 3 — test data

```
each test:
  beforeAll/beforeEach → await resetDb()
                         await makeProject({ id: "p1", ... })   // only what the test needs
                         await makeRun({ id: "r1", projectId: "p1", status: "running", ... })
  assertions reference the ids the test created — no prototype ids
```

## Testing (TDD, per CLAUDE.md)

- **Phase 1** (`server/test/runs.route.test.ts` / a focused `runs-command` test): `resume`
  via `/command` re-enqueues (assert a queued job / 202, and 409 when budget-blocked); free
  text on an active run publishes a `steer` control message (assert via a subscribed test
  client) and returns a non-fabricated ack; free text on an inactive run returns the
  "not active" line; `docs <existing>` returns line count, `docs <missing>` returns not-found.
  `App.tsx` change verified by the app booting with an empty DB and defaulting to the first
  project without referencing `loka-pos`.
- **Phase 2**: unit-test the event-merge reducer (each event kind → expected state) and
  `subscribeRun` (native `EventSource`, mocked in jsdom or via a thin seam); a live smoke
  test that a running run's new log lines appear over SSE. `finishedAt` set on terminal
  status verified in `events-io` tests.
- **Phase 3**: the migrated suite is the test — every file green after switching to the
  factory. `factory.ts` builders type-check against the Prisma create inputs.
- **Real local check per phase** (per CLAUDE.md): boot the server (`pnpm dev` /
  `node server/dist/server.js`) and `curl` the touched endpoints — Phase 1: `POST /command`
  with `resume` and free text; Phase 2: open `/runs/:id/log` and observe live frames while a
  run executes; Phase 3: `pnpm --filter ./server test` fully green with no `seed` import left.

## Acceptance criteria

1. The run terminal never emits a fabricated Claude reply; free text on an active run is
   delivered to the run as a steer and acknowledged truthfully; on an inactive run it says so.
2. Terminal `resume`/`retry` re-enqueue the run through the same path as `POST /control`
   (including the 409-on-budget behavior); `applyControl` is the single shared implementation.
3. Terminal `docs <path>` reflects the real file (existence + size), never a canned "opening" line.
4. `src/src/App.tsx` contains no hardcoded prototype ids (`loka-pos`, `RUN-8842`); the
   default project derives from loaded data.
5. `RunsScreen` subscribes to `/runs/:id/log` for active runs and updates log, phases,
   status, cost, and files live; the stream closes on terminal status/unmount.
6. Terminal input and steer/pause/resume/stop controls in `RunsScreen` drive the real
   endpoints and reflect the resulting state.
7. `Run.finishedAt` exists (migration + ADR-0007), is set on terminal status, and
   `RunsScreen` shows a real `duration` (live for running, fixed for finished).
8. `proto-data.ts`, `proto-doc-content.ts`, and `seed.ts` are deleted; no test imports
   `seed`; tests build data via `server/test/factory.ts`.
9. `pnpm --filter ./server test` and the frontend/`shared` typecheck are green.
10. Touched `internal/docs` updated and linked in `internal/docs/README.md`; ADR-0007 added.

## Risks

- **Phase 3 is the highest-risk** — ~20 test files hardcode prototype-id assertions.
  Mitigate by migrating one file at a time, keeping the suite green between files, and
  landing Phase 3 as its own commit series so it can be reverted independently of Phases 1–2.
- **SSE in tests** — `EventSource` isn't native to jsdom; test the reducer purely and gate
  the transport behind `subscribeRun` so the DOM dependency is thin.
- **Schema change** — `finishedAt` is additive and nullable (safe migration); ADR-0007
  records it per the "no schema change without migration + ADR" rule.
