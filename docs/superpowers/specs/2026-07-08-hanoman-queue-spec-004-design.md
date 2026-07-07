# SPEC-004 — hanoman queue (BullMQ/Redis, durable dispatch)

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-001 (server, Postgres, Run model), SPEC-003 (runner core `runOne`,
RunManager, SSE + control endpoints)

## Place in the sequence

Fourth of the fully-real sequence. SPEC-004 makes run dispatch **durable and
external**: a BullMQ queue on Redis, consumed by a dedicated worker process, with run
events and control commands crossing processes over Redis pub/sub. It **replaces**
SPEC-003's in-process `maxConcurrent` semaphore and in-memory event emitter — dispatch
becomes the queue, transport becomes Redis — so the scheduler (SPEC-005) and webhooks
(SPEC-006) get a clean enqueue seam and runs survive a restart (NFR durability).

## Context

SPEC-003 dispatches runs through an in-process semaphore and streams events through an
in-memory `EventEmitter` in the API process. That works single-process but isn't
durable (a restart loses queued/running state) and gives the scheduler/webhooks no
persistent enqueue target. The SoT (`stack.md`) specifies **BullMQ + Redis** for queue
and concurrency; NFR requires runs to survive restart, concurrency to honor
`maxConcurrent`, and new enqueues to stop when `dailyBudget` is reached.

## Goal

Enqueue runs onto a durable BullMQ queue; a separate worker process executes them at
`maxConcurrent` concurrency; live logs and control (steer/pause/stop) cross processes
over Redis pub/sub; new enqueues are refused once today's spend hits `dailyBudget`.

Definition of done:
- Starting a run enqueues a job; a separate worker process picks it up and runs it.
- Logs stream to the dashboard via Redis→SSE; steer/pause/stop reach the worker ≤2s.
- Queued/running state survives an API or worker restart.
- Enqueue is rejected once today's cost ≥ `dailyBudget`.
- Tests green. Touched `internal/docs` updated + linked.

## Approaches considered

- **Worker placement (decided in brainstorm):** in-process worker vs. **separate worker
  process + Redis pub/sub**. **Decision: separate worker process.** Isolates run load
  from the API and is the durable, scalable shape; the cross-process event/control
  transport is Redis pub/sub.
- **Event transport:** BullMQ `QueueEvents`/`job.updateProgress` vs. **dedicated Redis
  pub/sub channels per run**. **Decision: dedicated channels** (`run:<id>:events`,
  `run:<id>:control`) — arbitrary log-line streaming and bidirectional control are
  cleaner than overloading job progress.
- **Worker packaging:** new `worker/` package vs. **a second entrypoint in `server/`
  (`server/src/worker.ts`)**. **Decision: second entrypoint** — reuses `prisma`,
  `settings`, and the `runner/` core; no new package.

## Scope

### In scope
- Redis added to `docker-compose.yml`; a shared connection module (`server/src/redis.ts`)
  exposing a BullMQ-configured connection + separate pub/sub clients.
- `server/src/queue.ts` — the `hanoman:runs` `Queue`; `enqueueRun(input)` with the
  `dailyBudget` cutoff.
- `server/src/worker.ts` — a standalone process: BullMQ `Worker('hanoman:runs',
  processor, { concurrency: maxConcurrent })`; processor runs `runOne`, persists each
  event to Postgres, publishes to `run:<id>:events`, and subscribes to
  `run:<id>:control` to apply steer/pause/stop.
- API refactor: SSE `/runs/:id/log` reads the Postgres snapshot then subscribes to
  `run:<id>:events`; control endpoints publish to `run:<id>:control`; the run-start path
  calls `enqueueRun`. Remove `RunManager`'s semaphore + in-memory emitter.
- Stall recovery: a stalled job (worker died mid-run) marks the run `failed`.
- `package.json` script `worker` (`node server/dist/worker.js`); `dev` runs api + worker.

### Out of scope (later specs / v1.1)
Cron scheduler → SPEC-005; GitHub webhooks → SPEC-006 (both call `enqueueRun`).
Automatic retry policy and per-project cost reporting → roadmap v1.1.

## Components

**`server/src/redis.ts`**
- `bullConnection` (ioredis options with `maxRetriesPerRequest: null`), `publisher()` and
  `subscriber()` factories for pub/sub (separate connections, since a subscribed client
  can't issue other commands).

**`server/src/queue.ts`**
- `runsQueue = new Queue("hanoman:runs", { connection })`.
- `todaySpendUsd(): Promise<number>` — sum of `Run.cost` for runs created today.
- `enqueueRun(input: RunInput): Promise<{ enqueued: boolean; reason?: string }>` — if
  `todaySpendUsd() >= dailyBudget` → `{ enqueued:false, reason:"dailyBudget reached" }`;
  else create/patch the `Run` row (status `queued`) and `runsQueue.add(input.runId,
  input, { attempts: 1, removeOnComplete: true })`.

**`server/src/worker.ts`** (separate process)
- `new Worker("hanoman:runs", processor, { connection, concurrency: await maxConcurrent(),
  stalledInterval, maxStalledCount: 1 })`.
- `processor(job)`: build a control subscription (`subscriber().subscribe(
  run:<id>:control)`) wired to an `AbortController` + `SteerQueue`; call `runOne(input,
  prodDeps, onEvent, { abortController, steer })` where `onEvent` persists to Postgres
  **and** `publisher().publish(run:<id>:events, JSON.stringify(event))`.
- `worker.on("failed"|"stalled", …)` → mark the run `failed`.

**API refactor (`server/src/routes/runs.ts`, `runner/manager.ts`)**
- `GET /runs/:id/log`: write persisted `Run.log`, then `subscriber().subscribe(
  run:<id>:events)` → relay each message as an SSE `data:`; unsubscribe on client close.
- `POST /runs/:id/steer` → `publisher().publish(run:<id>:control, {type:"steer",message})`.
- `POST /runs/:id/control` → publish `{type:action}`; resume/retry re-`enqueueRun`.
- Run-start → `enqueueRun`; `409` when the budget cutoff rejects.
- `RunManager` shrinks to (or is replaced by) these enqueue/publish helpers; the
  in-memory semaphore/emitter are deleted.

## Control & event protocol (Redis pub/sub)

- `run:<id>:events` — JSON `RunEvent` (the SPEC-003 union: log/phase/file/cost/status).
  Worker publishes; API relays to SSE.
- `run:<id>:control` — JSON `{ type: "steer"|"pause"|"stop", message? }`. API publishes;
  worker applies: `steer`→`SteerQueue.push`, `pause`/`stop`→`abortController.abort()`
  (≤2s, NFR). `resume`/`retry` are handled API-side by a fresh `enqueueRun`.

## Durability & concurrency

- Jobs live in Redis → survive an API restart (still queued) and worker restart (BullMQ
  re-delivers waiting jobs). NFR durability of run *state* is also backed by Postgres
  (every event persisted).
- `concurrency: maxConcurrent` on the `Worker`; excess jobs wait in Redis (NFR).
- **Stall recovery:** if the worker dies mid-run, BullMQ marks the job stalled;
  `maxStalledCount: 1` → the run is marked **`failed`** (not auto-restarted, since
  resuming a half-finished LLM run is unsafe/costly). A human retries.

## Budget cutoff

`enqueueRun` computes `todaySpendUsd()` (sum of `Run.cost` for today) and, when
`>= dailyBudget`, refuses with `{ enqueued:false, reason }` → the run-start route
returns `409`. A run already executing may exceed the budget; the rule (NFR) governs
*new* enqueues only.

## Testing (TDD, per CLAUDE.md)

BullMQ against a real Redis (docker) — or `ioredis-mock` where a real Redis is
unavailable; the SDK stays mocked via `runner` deps.
- **Enqueue→execute:** `enqueueRun` adds a job; a test worker with fake deps runs it;
  the `Run` row reaches `done`.
- **Budget cutoff:** with today's spend ≥ `dailyBudget`, `enqueueRun` returns
  `{enqueued:false}` and the route returns `409`.
- **Concurrency:** with `maxConcurrent=1`, a second job waits until the first finishes.
- **Event transport:** a published `run:<id>:events` message is received by a subscriber
  (the SSE path).
- **Control transport:** a `run:<id>:control` `steer`/`stop` message reaches the worker's
  `SteerQueue`/`abortController`.
- **Stall recovery:** a simulated stalled job marks the run `failed`.
- **Durability:** a job added, then a fresh `Worker` instance created, still processes it.

## Acceptance criteria

1. Starting a run enqueues a BullMQ job; a separate `node server/dist/worker.js` process
   picks it up and executes it via `runOne`.
2. Logs stream to `GET /runs/:id/log` via `run:<id>:events`; `steer`/`pause`/`stop` sent
   to `POST /runs/:id/{steer,control}` reach the worker and take effect ≤2s.
3. Killing and restarting the worker re-processes still-queued jobs; a job mid-run at
   crash is marked `failed` (stall recovery), not silently lost.
4. With today's cost ≥ `dailyBudget`, a new run-start returns `409 {reason}`; below it,
   enqueue succeeds.
5. `Worker` concurrency equals `maxConcurrent`; an N+1th run waits in Redis.
6. `docker-compose up` starts Postgres + Redis; `pnpm dev` runs api + worker; `pnpm -w
   test` green.
7. Touched `internal/docs` updated and linked in `internal/docs/README.md`.

## Follow-up

SPEC-005 (scheduler) registers cron/interval triggers as BullMQ repeatable jobs that
call `enqueueRun`. SPEC-006 (webhooks) calls `enqueueRun` on a verified GitHub commit.
Retry policy + cost reporting are roadmap v1.1.
