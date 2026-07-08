import type Redis from "ioredis";
import type { RunEvent } from "@hanoman/runner";
import type { Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { STAGES } from "../services/stage-machine";

// A spec's stage is a read-only mirror of its run's phases (SPEC-009): each real
// phase/status event maps to the stage the spec should now sit in. Forward only —
// a re-run or a late/out-of-order event can never pull a spec backward.
const PHASE_DONE_STAGE: Record<string, Stage> = {
  Objective: "objective",   // feature: objective locked
  Audit: "objective",       // qa: audit ≈ objective locked
  Spec: "spec-ready",
  Plan: "planned",
  // Brainstorm done → no bump; the spec stays "brainstorming" until Objective locks.
};

export function mirrorStage(current: Stage, e: RunEvent): Stage | null {
  let target: Stage | null = null;
  if (e.kind === "phase" && e.state === "done") target = PHASE_DONE_STAGE[e.name] ?? null;
  else if (e.kind === "phase" && e.state === "active" && e.name === "Execute") target = "executing";
  else if (e.kind === "status" && e.status === "done") target = "done";
  if (!target) return null;
  return STAGES.indexOf(target) > STAGES.indexOf(current) ? target : null;
}

// Advance the run's linked spec if this event moves it forward. No-op when the run
// has no specId. Callers are serialized per run (worker chains persists), so no race.
async function mirrorSpecStage(runId: string, e: RunEvent): Promise<void> {
  const run = await prisma.run.findUnique({ where: { id: runId }, select: { specId: true } });
  if (!run?.specId) return;
  const spec = await prisma.spec.findUnique({ where: { id: run.specId }, select: { stage: true } });
  if (!spec) return;
  const next = mirrorStage(spec.stage as Stage, e);
  if (next) await prisma.spec.update({ where: { id: run.specId }, data: { stage: next } });
}

// Persist a run event to Postgres. Read-modify-write for log/phase/file, so the
// caller must serialize calls per run (the worker chains them) to avoid races.
export async function persistEvent(runId: string, e: RunEvent): Promise<void> {
  if (e.kind === "log") {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    await prisma.run.update({ where: { id: runId }, data: { log: [...(run.log as any[]), e.line] } });
  } else if (e.kind === "status") {
    const done = e.status === "done" || e.status === "failed" || e.status === "stopped";
    await prisma.run.update({ where: { id: runId }, data: { status: e.status, ...(done ? { finishedAt: new Date() } : {}) } });
  } else if (e.kind === "phase") {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    const phases = (run.phases as any[]).map((p) => (p.name === e.name ? { ...p, state: e.state } : p));
    await prisma.run.update({ where: { id: runId }, data: { phases } });
  } else if (e.kind === "cost") {
    await prisma.run.update({ where: { id: runId }, data: { tokensIn: String(e.tokensIn), tokensOut: String(e.tokensOut), cost: `$${e.costUsd.toFixed(2)}` } });
  } else if (e.kind === "file") {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    await prisma.run.update({ where: { id: runId }, data: { files: [...(run.files as any[]), e] } });
  }
  if (e.kind === "phase" || e.kind === "status") await mirrorSpecStage(runId, e);
}

// Fan an event out to SSE subscribers across processes via Redis pub/sub.
export function publishEvent(pub: Redis, runId: string, e: RunEvent): void {
  void pub.publish(`run:${runId}:events`, JSON.stringify(e));
}
