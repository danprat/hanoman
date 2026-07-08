# hanoman queue (SPEC-004) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make run dispatch durable and external — a BullMQ queue on Redis consumed by a separate worker process, with run events and control crossing processes over Redis pub/sub, and new enqueues cut off at `dailyBudget`.

**Architecture:** `server/src/queue.ts` (the `hanoman:runs` Queue + budget-gated `enqueueRun`), `server/src/worker.ts` (a standalone process: BullMQ `Worker`, concurrency = `maxConcurrent`, running `runOne`, persisting events to Postgres and publishing to `run:<id>:events`, subscribing to `run:<id>:control`), and an API refactor (SSE reads Postgres + subscribes to Redis; control publishes; run-start enqueues). SPEC-003's in-process semaphore + in-memory emitter are removed.

**Tech Stack:** Node 20+, TypeScript 5 (strict), BullMQ 5, ioredis, Prisma/Postgres, Fastify SSE, Vitest (real Redis via docker, or `ioredis-mock`).

## Global Constraints

- **Depends on SPEC-001** (server, `Run`, `settings.ts`) and **SPEC-003** (`runner` core `runOne`, `RunEvent`, `SteerQueue`, `prodDeps`, `runs.ts`).
- **ioredis for BullMQ** must use `maxRetriesPerRequest: null`. Pub/sub uses *separate* connections (a subscribed client can't issue other commands).
- **Budget cutoff at enqueue:** `todaySpendUsd() >= dailyBudget` → reject; a run already executing may exceed it (governs new enqueues only). (NFR)
- **No auto-retry:** jobs `attempts: 1`. **Stall recovery:** a stalled job → run marked `failed` (`maxStalledCount: 1`).
- **Separate worker process** (`node server/dist/worker.js`); `pnpm dev` runs api + worker.
- **Verify installed BullMQ version's Job Scheduler / connection API** against its typings before coding. TypeScript strict; zod-validated bodies. Commit after every green step.

---

## File Structure

```
docker-compose.yml        + redis:7 service
server/src/
  redis.ts                bullConnection + publisher()/subscriber() factories
  queue.ts                runsQueue, todaySpendUsd(), enqueueRun()
  worker.ts               standalone Worker process (runs + control subscription)
  runner/events-io.ts     persistEvent(runId,event) + publishEvent(runId,event)
  routes/runs.ts          refactor: SSE via Redis; control publishes; start -> enqueueRun
  runner/manager.ts       shrink to enqueue/publish helpers (remove semaphore/emitter)
package.json              scripts: worker, dev (api+worker)
```

---

### Task 1: Redis + queue + budget-gated enqueue

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, root `package.json`
- Create: `server/src/redis.ts`, `server/src/queue.ts`
- Test: `server/test/queue.test.ts`

**Interfaces:**
- Produces:
  - `redis.ts`: `bullConnection` (`{ host, port, maxRetriesPerRequest: null }` from `REDIS_URL`/host+port), `publisher(): Redis`, `subscriber(): Redis` (new ioredis connections).
  - `queue.ts`: `runsQueue = new Queue("hanoman:runs", { connection: bullConnection })`; `todaySpendUsd(): Promise<number>` (parse `$n` from `Run.cost` for runs created today); `enqueueRun(input: RunInput): Promise<{ enqueued: boolean; reason?: string }>` — budget check, upsert `Run` row status `queued`, `runsQueue.add(input.runId, input, { attempts: 1, removeOnComplete: true, removeOnFail: false })`.

- [x] **Step 1: Write failing tests**

```ts
// server/test/queue.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { seed } from "../prisma/seed";
import { prisma } from "../src/db";
import { enqueueRun, todaySpendUsd } from "../src/queue";
const input = { runId: "RUN-9001", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature" as const, steps: {} as any };
describe("queue", () => {
  beforeAll(async () => { await seed(); });
  it("enqueues below budget", async () => {
    vi.spyOn({ todaySpendUsd }, "todaySpendUsd"); // spend is low in seed
    const r = await enqueueRun(input);
    expect(r.enqueued).toBe(true);
    expect((await prisma.run.findUnique({ where: { id: "RUN-9001" } }))?.status).toBe("queued");
  });
  it("rejects when today's spend >= dailyBudget", async () => {
    await prisma.setting.update({ where: { id: 1 }, data: { data: { ...(await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).data as any, dailyBudget: 0 } } });
    const r = await enqueueRun({ ...input, runId: "RUN-9002" });
    expect(r.enqueued).toBe(false); expect(r.reason).toMatch(/budget/i);
  });
});
```

- [x] **Step 2: Run, verify fail** — `pnpm --filter ./server test queue` (start redis: `docker-compose up -d redis`).

- [x] **Step 3: Implement**

`docker-compose.yml` → add:
```yaml
  redis:
    image: redis:7
    ports: ["6379:6379"]
```
`.env.example` → `REDIS_URL=redis://localhost:6379`.

`server/src/redis.ts`:
```ts
import Redis from "ioredis";
const url = process.env.REDIS_URL ?? "redis://localhost:6379";
export const bullConnection = { host: new URL(url).hostname, port: Number(new URL(url).port || 6379), maxRetriesPerRequest: null as null };
export const publisher = () => new Redis(url);
export const subscriber = () => new Redis(url);
```

`server/src/queue.ts`:
```ts
import { Queue } from "bullmq";
import type { RunInput } from "@hanoman/runner";
import { bullConnection } from "./redis";
import { prisma } from "./db";
import { dailyBudget } from "./services/settings";
export const runsQueue = new Queue("hanoman:runs", { connection: bullConnection });
export async function todaySpendUsd(): Promise<number> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const runs = await prisma.run.findMany({ where: { /* createdAt filter if column exists; else all */ } });
  return runs.reduce((n, r) => n + (parseFloat(String(r.cost).replace(/[^0-9.]/g, "")) || 0), 0);
}
export async function enqueueRun(input: RunInput): Promise<{ enqueued: boolean; reason?: string }> {
  if (await todaySpendUsd() >= await dailyBudget()) return { enqueued: false, reason: "dailyBudget reached" };
  await prisma.run.upsert({ where: { id: input.runId },
    update: { status: "queued" },
    create: { id: input.runId, projectId: input.specId ? (await prisma.spec.findUniqueOrThrow({ where: { id: input.specId } })).projectId : "arta",
      specId: input.specId ?? null, kind: input.flow === "feature" ? "feature" : input.flow, status: "queued",
      trigger: "manual", triggerDetail: "", phases: [], plan: [], files: [], log: [],
      worktree: `.worktrees/${input.runId.toLowerCase()}`, branchFrom: input.branchFrom, branchTo: input.branchTo,
      model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 0 } });
  await runsQueue.add(input.runId, input, { attempts: 1, removeOnComplete: true, removeOnFail: false });
  return { enqueued: true };
}
```
(Note: if SPEC-001's `Run` lacks `createdAt`, add it in this task's migration and filter `todaySpendUsd` by it; the projectId fallback should come from `input` — add `projectId` to `RunInput` in `runner/src/types.ts` and thread it through. Keep the enqueue row shape aligned with the Prisma schema.)

Add BullMQ + ioredis to `server/package.json` deps: `"bullmq": "^5.12.0", "ioredis": "^5.4.0"`.

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(server): redis + runs queue + budget-gated enqueue"`

---

### Task 2: Event I/O (persist + publish) + worker process

**Files:**
- Create: `server/src/runner/events-io.ts`, `server/src/worker.ts`
- Modify: root `package.json` (scripts)
- Test: `server/test/worker.test.ts`

**Interfaces:**
- Produces:
  - `events-io.ts`: `persistEvent(runId, e: RunEvent): Promise<void>` (the SPEC-003 `RunManager.persist` logic, standalone), `publishEvent(pub, runId, e): void` (`pub.publish(`run:${runId}:events`, JSON.stringify(e))`).
  - `worker.ts`: builds `new Worker("hanoman:runs", processor, { connection: bullConnection, concurrency: await maxConcurrent(), maxStalledCount: 1 })`. `processor(job)` = create `AbortController` + `SteerQueue`; `subscriber().subscribe(`run:${id}:control`)` and on message apply `steer`→`SteerQueue.push`, `pause`/`stop`→`abortController.abort()`; `onEvent = (e) => { persistEvent(id,e); publishEvent(pub,id,e); }`; `await runOne(job.data, prodDeps, onEvent, { abortController, steer })`. `worker.on("failed"|"stalled", (job) => markFailed(job.data.runId))`.

- [x] **Step 1: Write failing test**

```ts
// server/test/worker.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { prisma } from "../src/db";
import { runProcessor } from "../src/worker";
import type { RunDeps } from "@hanoman/runner";
const fakeDeps: RunDeps = {
  queryFn: () => (async function* () { yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.2, usage: { input_tokens: 9, output_tokens: 3 } }; })(),
  git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} },
  verify: () => ({ blocked: false }), effortToThinking: () => undefined };
describe("worker processor", () => {
  beforeAll(async () => { await seed(); });
  it("runs a job and persists final status", async () => {
    await runProcessor({ data: { runId: "RUN-8842", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps: await (await import("../src/services/settings")).stepModels() } } as any, fakeDeps);
    expect((await prisma.run.findUnique({ where: { id: "RUN-8842" } }))?.status).toBe("done");
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** `events-io.ts`, and `worker.ts` exporting a testable `runProcessor(job, deps=prodDeps)` plus the `Worker` bootstrap guarded by `if (process.argv[1]?.endsWith("worker.js"|"worker.ts"))`. Wire control subscription + persist/publish per the interface. `package.json` scripts: `"worker": "node server/dist/worker.js"`, `"dev": "pnpm --parallel --filter ./server --filter ./src dev"` (add a `worker:dev` = `tsx watch server/src/worker.ts` and include it in `dev`).

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(server): worker process + event persist/publish + control sub"`

---

### Task 3: API refactor — SSE via Redis, control publish, start→enqueue

**Files:** Modify `server/src/routes/runs.ts`, `server/src/runner/manager.ts`; Test `server/test/runs-queue-integration.test.ts`

**Interfaces:**
- Produces:
  - `GET /runs/:id/log` (SSE): write persisted `Run.log`, then `const sub = subscriber(); sub.subscribe(`run:${id}:events`); sub.on("message", (_c, m) => write(m));` relay; unsubscribe/quit on client close.
  - `POST /runs/:id/steer` → `publisher().publish(`run:${id}:control`, JSON.stringify({ type: "steer", message }))`; `202`.
  - `POST /runs/:id/control` → publish `{type: action}` for pause/stop; resume/retry call `enqueueRun`; `202` (or `409` if enqueue budget-rejected on resume/retry).
  - Run-start path (dashboard "advance to executing" / a new start route) → `enqueueRun`; `409 {reason}` when rejected.
  - `manager.ts`: delete the semaphore + `EventEmitter`; keep only thin helpers if still referenced.

- [x] **Step 1: Write failing test**

```ts
// server/test/runs-queue-integration.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
import { publisher } from "../src/redis";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("runs SSE via redis", () => {
  it("relays a published event to the SSE stream", async () => {
    // publish after a tick; assert the injected response contains the payload
    const p = app.inject({ method: "GET", url: "/api/runs/RUN-8842/log", headers: { accept: "text/event-stream" } });
    setTimeout(() => publisher().publish("run:RUN-8842:events", JSON.stringify({ kind: "log", line: { t: "›", s: "hello-sse" } })), 50);
    const res = await p;
    expect(res.payload).toContain("hello-sse");
  });
  it("steer publishes and returns 202", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/steer", payload: { message: "go" } });
    expect(r.statusCode).toBe(202);
  });
});
```
(Note: `app.inject` doesn't stream indefinitely; for the SSE assertion, cap the handler to end after the first relayed message in test mode, or use a short server + real socket. Prefer a small helper that closes the stream after N events under `NODE_ENV=test`.)

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** the refactor per the interface; remove the SPEC-003 in-memory emitter/semaphore. Validate control bodies with `zSteer/zControl`.

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(server): SSE via redis + control publish + start via enqueue"`

---

### Task 4: Concurrency, durability, stall recovery + acceptance

**Files:** Modify `server/src/worker.ts` (stall→failed); Test `server/test/queue-durability.test.ts`

**Interfaces:**
- Produces: `markFailed(runId)` on `failed`/`stalled`; concurrency honored by the `Worker` option; durability from Redis persistence.

- [ ] **Step 1: Write failing tests**

```ts
// server/test/queue-durability.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { prisma } from "../src/db";
import { markFailed } from "../src/worker";
describe("stall recovery", () => {
  beforeAll(async () => { await seed(); });
  it("marks a run failed on stall", async () => {
    await markFailed("RUN-8830");
    expect((await prisma.run.findUnique({ where: { id: "RUN-8830" } }))?.status).toBe("failed");
  });
});
```
Add a concurrency test: with `concurrency: 1`, enqueue two jobs whose fake deps block on a resolvable promise; assert the second starts only after the first resolves (use a shared counter). (Real Redis + a real `Worker` instance in the test.)

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `markFailed` + wire `worker.on("failed"|"stalled", ...)`.

- [ ] **Step 4: Full acceptance** — verify SPEC-004 §Acceptance:
  1. `docker-compose up -d` (postgres+redis); `pnpm dev` runs api + worker; start a run → a job is consumed by the worker process.
  2. Logs stream over SSE; `steer`/`pause`/`stop` reach the worker ≤2s.
  3. Kill+restart the worker → queued jobs re-process; a mid-run crash → run `failed`.
  4. `dailyBudget` exceeded → run-start `409`.
  5. `maxConcurrent` respected; `pnpm -w test` green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): stall recovery + queue acceptance green"`

---

## Self-Review

**1. Spec coverage** — Redis+queue+budget cutoff → T1; worker process + event persist/publish + control sub → T2; API refactor (SSE via Redis, control publish, start→enqueue, remove semaphore/emitter) → T3; concurrency/durability/stall → T4. Acceptance 1→T2/T3, 2→T3, 3→T4, 4→T1/T3, 5→T4, 6→T4.

**2. Placeholder scan** — no "TBD". The SSE test note (cap the stream in test mode) is a concrete testing instruction, not a placeholder. The `enqueueRun` create-shape note names exactly what to align (add `projectId` to `RunInput`, `createdAt` to `Run`).

**3. Type consistency** — `RunInput`/`RunEvent`/`RunDeps` reused from `runner`; `enqueueRun(input)→{enqueued,reason}`, `persistEvent`/`publishEvent`, `runProcessor(job,deps)`, `markFailed(runId)` keep one signature across tasks. Redis channel names `run:<id>:events` / `run:<id>:control` are identical on the publish and subscribe sides.

**Executor note:** add `RunInput.projectId` and `Run.createdAt` (a small migration) in Task 1 so `enqueueRun` and `todaySpendUsd` are correct; thread `projectId` from the run-start/scheduler callers.
