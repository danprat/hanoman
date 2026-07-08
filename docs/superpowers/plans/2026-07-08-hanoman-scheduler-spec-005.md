# hanoman scheduler (SPEC-005) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `schedule`/`interval` triggers into BullMQ repeatable jobs that, on fire, enqueue the right run(s) via SPEC-004's `enqueueRun` — with DB↔scheduler reconciliation on boot and on trigger changes.

**Architecture:** A `hanoman:schedules` queue + a second `Worker` in the SPEC-004 worker process. `schedules.ts` owns `syncTrigger`/`removeSchedule`/`reconcile` (via `upsertJobScheduler`/`removeJobScheduler`). On fire, a shared `fireTrigger(trigger, ctx)` maps the target to runs (per ready spec for feature; one run for audit/scaffold) and calls `enqueueRun`.

**Tech Stack:** Node 20+, TypeScript 5 (strict), BullMQ 5 (Job Scheduler), Prisma, `cron-parser` for validation, Vitest (real Redis / `ioredis-mock`).

## Global Constraints

- **Depends on SPEC-001** (Trigger/Spec, `routes/triggers.ts`), **SPEC-003** (run flows / `fromStage`), **SPEC-004** (`enqueueRun`, `bullConnection`, worker process).
- **`detail` semantics:** `schedule` → cron expression; `interval` → duration (`"6h"|"30m"|"90s"`). Validated at `POST /triggers`. `commit`/`manual` → no schedule.
- **Fire mapping:** `plan + execute` → one `feature` run per ready spec (stage `spec-ready`/`planned`); `audit`/`qa audit` → one `qa` run; `scaffold docs` → one `scaffold` run. No ready specs → log "skipped", enqueue nothing.
- **Reconcile** DB→schedulers on boot and on trigger create/toggle/delete.
- **Verify BullMQ Job Scheduler API** (`upsertJobScheduler`/`removeJobScheduler`/`getJobSchedulers`) against the installed version. TypeScript strict; zod-validated bodies. Commit after every green step.

---

## File Structure

```
shared/src/dto.ts          + zTrigger detail refinement (cron/duration by type)
server/src/
  schedule-parse.ts        parseDuration(), isValidCron(), scheduleSpecFor(trigger)
  schedules.ts             schedulesQueue, syncTrigger(), removeSchedule(), reconcile()
  fire-trigger.ts          fireTrigger(trigger) -> enqueueRun(...) per target (shared w/ SPEC-006)
  routes/triggers.ts       validate detail on create; call syncTrigger/removeSchedule
  worker.ts                + schedules Worker + reconcile() on boot
```

---

### Task 1: Schedule parsing + trigger-detail validation

**Files:**
- Create: `server/src/schedule-parse.ts`
- Modify: `shared/src/dto.ts` (or `server/src/routes/triggers.ts`) to validate `detail` by `type`
- Test: `server/test/schedule-parse.test.ts`, `server/test/trigger-validate.test.ts`

**Interfaces:**
- Produces:
  - `parseDuration(s: string): number | null` — `"6h"→21600000`, `"30m"`, `"90s"`, `"1d"`; else `null`.
  - `isValidCron(s: string): boolean` — via `cron-parser`.
  - `scheduleSpecFor(type, detail): { pattern: string } | { every: number } | null` — cron for `schedule`, `{every}` for `interval`, `null` otherwise.
  - Trigger create validation: reject (`400`) a `schedule` with invalid cron or an `interval` with bad duration.

- [x] **Step 1: Write failing tests**

```ts
// server/test/schedule-parse.test.ts
import { describe, it, expect } from "vitest";
import { parseDuration, isValidCron, scheduleSpecFor } from "../src/schedule-parse";
describe("schedule parse", () => {
  it("parses durations", () => { expect(parseDuration("6h")).toBe(21600000); expect(parseDuration("30m")).toBe(1800000); expect(parseDuration("nope")).toBeNull(); });
  it("validates cron", () => { expect(isValidCron("0 2 * * *")).toBe(true); expect(isValidCron("banana")).toBe(false); });
  it("builds a spec by type", () => {
    expect(scheduleSpecFor("schedule", "0 2 * * *")).toEqual({ pattern: "0 2 * * *" });
    expect(scheduleSpecFor("interval", "6h")).toEqual({ every: 21600000 });
    expect(scheduleSpecFor("manual", "x")).toBeNull();
  });
});
```

```ts
// server/test/trigger-validate.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("trigger create validation", () => {
  it("rejects an invalid cron schedule trigger", async () => {
    const r = await app.inject({ method: "POST", url: "/api/triggers", payload: { project: "arta", type: "schedule", detail: "banana", target: "audit" } });
    expect(r.statusCode).toBe(400);
  });
  it("accepts a valid interval trigger", async () => {
    const r = await app.inject({ method: "POST", url: "/api/triggers", payload: { project: "arta", type: "interval", detail: "6h", target: "plan + execute" } });
    expect(r.statusCode).toBe(201);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** `schedule-parse.ts` (add `cron-parser` to `server` deps); add the validation branch to `POST /triggers` (return `400` when `scheduleSpecFor` is required by type but the detail is invalid).

```ts
// server/src/schedule-parse.ts
import parser from "cron-parser";
const UNIT: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
export function parseDuration(s: string): number | null {
  const m = /^(\d+)(s|m|h|d)$/.exec(s.trim()); return m ? Number(m[1]) * UNIT[m[2]!]! : null;
}
export function isValidCron(s: string): boolean { try { parser.parseExpression(s); return true; } catch { return false; } }
export function scheduleSpecFor(type: string, detail: string): { pattern: string } | { every: number } | null {
  if (type === "schedule") return isValidCron(detail) ? { pattern: detail } : null;
  if (type === "interval") { const ms = parseDuration(detail); return ms ? { every: ms } : null; }
  return null;
}
```

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(server): schedule parsing + trigger detail validation"`

---

### Task 2: Schedules queue + sync/remove/reconcile

**Files:** Create `server/src/schedules.ts`; Test `server/test/schedules.test.ts`

**Interfaces:**
- Produces: `schedulesQueue = new Queue("hanoman:schedules", { connection: bullConnection })`;
  `syncTrigger(trigger): Promise<void>` — if enabled + `scheduleSpecFor` non-null → `schedulesQueue.upsertJobScheduler(trigger.id, spec, { name: "fire", data: { triggerId: trigger.id } })`; else `removeSchedule`.
  `removeSchedule(triggerId): Promise<void>` — `schedulesQueue.removeJobScheduler(triggerId)` (ignore if absent).
  `reconcile(): Promise<void>` — upsert all enabled schedule/interval triggers; `getJobSchedulers()` and remove any whose trigger is gone/disabled.

- [x] **Step 1: Write failing test**

```ts
// server/test/schedules.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { seed } from "../prisma/seed";
import * as sch from "../src/schedules";
import { schedulesQueue } from "../src/schedules";
describe("schedules", () => {
  beforeAll(async () => { await seed(); });
  it("upserts a scheduler for an enabled schedule trigger", async () => {
    const spy = vi.spyOn(schedulesQueue, "upsertJobScheduler").mockResolvedValue({} as any);
    await sch.syncTrigger({ id: "t2", type: "schedule", detail: "0 2 * * *", enabled: true } as any);
    expect(spy).toHaveBeenCalledWith("t2", { pattern: "0 2 * * *" }, expect.objectContaining({ name: "fire" }));
  });
  it("removes the scheduler when disabled", async () => {
    const spy = vi.spyOn(schedulesQueue, "removeJobScheduler").mockResolvedValue(true as any);
    await sch.syncTrigger({ id: "t4", type: "schedule", detail: "0 2 * * *", enabled: false } as any);
    expect(spy).toHaveBeenCalledWith("t4");
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** `schedules.ts` per the interface (using `scheduleSpecFor`).

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(server): schedules queue sync/remove/reconcile"`

---

### Task 3: `fireTrigger` + scheduler Worker + wire trigger routes/boot

**Files:** Create `server/src/fire-trigger.ts`; Modify `server/src/worker.ts`, `server/src/routes/triggers.ts`; Test `server/test/fire-trigger.test.ts`

**Interfaces:**
- Produces:
  - `fireTrigger(trigger: Trigger, ctx?: { branch?: string; sha?: string }): Promise<{ enqueued: string[]; skipped?: string }>` — maps target → runs and calls `enqueueRun` (returns the run ids enqueued). Shared with SPEC-006.
  - Scheduler `Worker("hanoman:schedules", async (job) => { const t = await prisma.trigger.findUnique(...); if (t?.enabled) await fireTrigger(t); }, { connection })` in `worker.ts`; `reconcile()` on boot.
  - `routes/triggers.ts`: `POST /triggers` (after create) → `syncTrigger`; `POST /triggers/:id/toggle` → `syncTrigger`; add `DELETE /triggers/:id` → `removeSchedule` (if not already present).

- [ ] **Step 1: Write failing test**

```ts
// server/test/fire-trigger.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { seed } from "../prisma/seed";
import { fireTrigger } from "../src/fire-trigger";
import * as queue from "../src/queue";
describe("fireTrigger", () => {
  beforeAll(async () => { await seed(); });
  it("plan+execute enqueues one feature run per ready spec", async () => {
    const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    // arta has SPEC-142 (planned) + SPEC-138 (executing); ready = planned -> 1 run
    const r = await fireTrigger({ id: "t1", projectId: "arta", type: "commit", detail: "push → main", target: "plan + execute", enabled: true } as any);
    expect(spy).toHaveBeenCalledTimes(r.enqueued.length);
    expect(r.enqueued.length).toBeGreaterThanOrEqual(1);
  });
  it("scaffold docs enqueues exactly one project-level run", async () => {
    const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    await fireTrigger({ id: "t3", projectId: "sembada", type: "manual", detail: "on demand", target: "scaffold docs", enabled: true } as any);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("skips when no ready specs", async () => {
    vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    const r = await fireTrigger({ id: "tz", projectId: "gapura", type: "schedule", detail: "0 2 * * *", target: "plan + execute", enabled: true } as any);
    expect(r.skipped).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
// server/src/fire-trigger.ts
import type { Trigger } from "@hanoman/shared";
import { prisma } from "./db";
import { enqueueRun } from "./queue";
import { nextRunId } from "./services/id";
const READY = ["spec-ready", "planned"];
const FLOW: Record<string, "feature" | "qa" | "scaffold"> = {
  "plan + execute": "feature", "audit": "qa", "qa audit": "qa", "scaffold docs": "scaffold",
};
export async function fireTrigger(trigger: Trigger, ctx: { branch?: string; sha?: string } = {}) {
  const flow = FLOW[trigger.target]; const enqueued: string[] = [];
  const base = { repoDir: (await prisma.project.findUniqueOrThrow({ where: { id: trigger.projectId } })).repoDir ?? "", branchFrom: ctx.branch ?? "main", projectId: trigger.projectId };
  if (flow === "feature") {
    const specs = await prisma.spec.findMany({ where: { projectId: trigger.projectId, stage: { in: READY } } });
    if (!specs.length) return { enqueued, skipped: "no ready spec" };
    for (const s of specs) {
      const runId = await nextRunId();
      const r = await enqueueRun({ runId, ...base, branchTo: `hanoman/${runId.toLowerCase()}`, flow, specId: s.id, steps: await stepModels() } as any);
      if (r.enqueued) enqueued.push(runId);
    }
  } else {
    const runId = await nextRunId();
    const r = await enqueueRun({ runId, ...base, branchTo: `hanoman/${runId.toLowerCase()}`, flow, steps: await stepModels() } as any);
    if (r.enqueued) enqueued.push(runId);
  }
  return { enqueued };
}
import { stepModels } from "./services/settings";
```
Wire the scheduler `Worker` + `reconcile()` into `worker.ts`; call `syncTrigger`/`removeSchedule` from the trigger routes.

- [ ] **Step 4: Run, verify pass** (adjust the ready-spec assertions to the actual seed if counts differ).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): fireTrigger + scheduler worker + trigger route wiring"`

---

## Self-Review

**1. Spec coverage** — detail validation + parsing → T1; schedules queue sync/remove/reconcile → T2; `fireTrigger` mapping + scheduler Worker + route/boot wiring → T3. Acceptance 1→T2/T3, 2→T3, 3→T1, 4→T2 (reconcile) + T3 (boot), 5→T2 (`scheduleSpecFor` null for commit/manual), 6→all.

**2. Placeholder scan** — no "TBD". Seed-count assertions carry a note to adjust to actual seed data.

**3. Type consistency** — `scheduleSpecFor(type,detail)→{pattern}|{every}|null`, `syncTrigger`/`removeSchedule`/`reconcile`, `fireTrigger(trigger,ctx)→{enqueued,skipped?}` are single-signature across tasks. `fireTrigger` is the shared entry SPEC-006 reuses. `enqueueRun` input shape matches SPEC-004 (`projectId`, `specId`, `steps`, `branchFrom/To`).

**Executor note:** `fireTrigger` needs `RunInput.projectId` (added in SPEC-004 Task 1) and `nextRunId` (SPEC-001). Keep the READY stage set (`spec-ready`,`planned`) aligned with the stage machine.
