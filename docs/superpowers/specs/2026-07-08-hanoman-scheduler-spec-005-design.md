# SPEC-005 — hanoman scheduler (cron/interval triggers)

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-001 (Trigger/Spec models, trigger routes), SPEC-003 (run flows),
SPEC-004 (`enqueueRun`, Redis, worker process)

## Place in the sequence

Fifth of the fully-real sequence. SPEC-005 makes `schedule` and `interval` triggers
real: BullMQ repeatable jobs that fire on a cron/interval and call SPEC-004's
`enqueueRun`. It is a thin dispatcher — all execution belongs to SPEC-003/004.
`manual` triggers are the dashboard start button; `commit` triggers are SPEC-006.

## Context

The Trigger model (`data-model.md`) has `type` (`commit|schedule|manual|interval`),
`detail`, `target` (`plan + execute|audit|qa audit|scaffold docs`), `enabled`.
`stack.md` specifies cron via BullMQ repeatable jobs. SPEC-004 built the durable queue
+ a worker process; SPEC-005 adds a scheduling layer that enqueues runs on time.

## Goal

Enabled `schedule`/`interval` triggers fire on their cadence and enqueue the right
run(s); enabling/disabling/deleting a trigger registers/removes its schedule; schedules
survive restart and reconcile from the DB on boot.

Definition of done:
- Creating an enabled `schedule` trigger registers a repeatable job that, on fire,
  enqueues runs per its target; toggling it off removes the schedule.
- Fire semantics: `plan + execute` → one `feature` run per ready spec; `audit`/`qa
  audit` → one `qa` run; `scaffold docs` → one `scaffold` run.
- Invalid cron/duration is rejected at trigger creation.
- On worker boot, schedules reconcile to the DB (add missing, remove orphans).
- Tests green. Touched `internal/docs` updated + linked.

## Approaches considered

- **Schedule format (decided):** reuse `Trigger.detail` with type-specific meaning +
  validation vs. add structured `cron`/`everyMs` columns. **Decision: reuse `detail`**
  — `schedule` → a cron expression, `interval` → a duration string; no schema change,
  just validation. (An ADR would be needed for new columns; unnecessary here.)
- **Scheduler placement (decided):** a **second `Worker` in the SPEC-004 worker
  process** vs. a new process. **Decision: second Worker in the existing worker
  process** — reuses the Redis connection, `prisma`, and `enqueueRun`.

## Scope

### In scope
- `detail` validation by type: `schedule` = cron (5/6-field), `interval` = duration
  (`"6h"`, `"30m"`, `"90s"`). Added to the shared trigger DTO + SPEC-001's
  `POST /triggers` route; the trigger modal placeholder updates to a cron example.
- `server/src/schedules.ts` — the `hanoman:schedules` `Queue`; `syncTrigger(trigger)`
  (upsert/remove a job scheduler), `removeSchedule(triggerId)`, `reconcile()` (DB → 
  schedulers).
- Scheduler `Worker` in `server/src/worker.ts` — on fire, resolve the trigger + target
  → `enqueueRun(...)` per the mapping below.
- Hook trigger create/toggle/delete (SPEC-001 `routes/triggers.ts`) to call
  `syncTrigger`/`removeSchedule`.
- Boot reconciliation in the worker.

### Out of scope (later / v1.1)
`commit` triggers → SPEC-006. `manual` → the dashboard button (SPEC-001/003). Retry
policy + cost reporting → v1.1.

## Fire semantics (target → runs)

On a scheduler fire, look up the trigger (skip if `!enabled` or deleted) and its
project, then:

| `target` | Runs enqueued |
|---|---|
| `plan + execute` | flow `feature`, **one run per ready spec** (stage `spec-ready` or `planned`) in the project. None ready → log "skipped — no ready spec", enqueue nothing. |
| `audit` / `qa audit` | flow `qa`, one project-level run. |
| `scaffold docs` | flow `scaffold`, one project-level run. |

A `feature` run resumes SPEC-003's pipeline from the spec's current stage (a
`spec-ready` spec runs Plan→Execute); `RunInput` carries a `fromStage` derived from the
spec stage (a small, additive field). Each `enqueueRun` independently passes/ fails the
`dailyBudget` cutoff (SPEC-004), so a fan-out of many ready specs is naturally capped.

## Schedule registration (BullMQ Job Scheduler)

- `schedule` → `queue.upsertJobScheduler(triggerId, { pattern: cron }, { name:"fire",
  data:{ triggerId } })`.
- `interval` → `queue.upsertJobScheduler(triggerId, { every: durationMs }, { … })`.
- Disable/delete → `queue.removeJobScheduler(triggerId)`.
- `reconcile()` on boot: for every enabled `schedule`/`interval` trigger `upsert`; list
  existing schedulers and `remove` any whose trigger is gone or disabled.

> Implementation note: pin the installed BullMQ version and verify the Job Scheduler
> API (`upsertJobScheduler`/`removeJobScheduler` vs. the older `repeat` option) against
> its typings before coding.

## Validation

- cron: parse with a cron validator (e.g. `cron-parser`); reject invalid at
  `POST /triggers` (`400`).
- duration: `^\d+(s|m|h|d)$` → ms; reject otherwise (`400`).
- `commit`/`manual` triggers: `detail` free-text, no schedule registered.

## Testing (TDD, per CLAUDE.md)

Against real Redis / `ioredis-mock`; `enqueueRun` spied.
- Creating an enabled `schedule` trigger calls `upsertJobScheduler`; toggling off calls
  `removeJobScheduler`.
- A fired job with `target: "plan + execute"` enqueues one run per ready spec (and none
  when there are no ready specs, logging "skipped").
- `audit` and `scaffold docs` fires enqueue exactly one run each.
- Invalid cron / bad duration → `POST /triggers` returns `400`.
- `reconcile()` upserts enabled schedules and removes orphans/disabled.
- A `commit`/`manual` trigger registers no scheduler.

## Acceptance criteria

1. An enabled `schedule` trigger registers a repeatable job; on fire it enqueues runs
   per its target; a disabled trigger has no schedule.
2. `plan + execute` fans out one `feature` run per ready spec; `audit`/`scaffold docs`
   enqueue one run each; no ready specs → skipped, nothing enqueued.
3. Invalid cron or duration is rejected at trigger creation (`400`).
4. After a worker restart, schedules reconcile to the DB (missing added, orphans
   removed) and continue firing.
5. `commit` and `manual` triggers register no schedule.
6. Tests green. Touched `internal/docs` updated and linked in `internal/docs/README.md`.

## Follow-up

SPEC-006 (webhooks) handles `commit` triggers: a verified GitHub push calls
`enqueueRun` for the project's matching commit trigger.
