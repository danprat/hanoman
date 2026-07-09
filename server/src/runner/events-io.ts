import type Redis from "ioredis";
import type { RunEvent } from "@hanoman/runner";
import { fmtEstCost, type Stage } from "@hanoman/shared";
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

// Run progress = fraction of phases marked done. Failed/active/pending don't count, so a
// run that dies at the last phase reads e.g. 80%, not 0% or 100%.
export function computeProgress(phases: { state: string }[]): number {
  if (!phases.length) return 0;
  return Math.round((phases.filter((p) => p.state === "done").length / phases.length) * 100);
}

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

// Persist a run event to Postgres. Read-modify-write for log/phase/commit, so the
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
    await prisma.run.update({ where: { id: runId }, data: { phases, progress: computeProgress(phases) } });
  } else if (e.kind === "cost") {
    await prisma.run.update({ where: { id: runId }, data: { tokensIn: String(e.tokensIn), tokensOut: String(e.tokensOut), cost: fmtEstCost(e.costUsd) } });
  } else if (e.kind === "session") {
    // Satu sesi per run (SPEC-013). Layar Terminal memakainya untuk `claude --resume`.
    await prisma.run.update({ where: { id: runId }, data: { sessionId: e.sessionId } });
  } else if (e.kind === "commit") {
    // baseSha ditulis sekali. `resume` memanggil addWorktree lagi, dan branchFrom
    // bisa sudah bergerak — basis yang benar adalah basis semula.
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    const data: { baseSha?: string; headSha?: string } = {};
    if (e.base && !run.baseSha) data.baseSha = e.base;
    if (e.head) data.headSha = e.head;
    if (Object.keys(data).length) await prisma.run.update({ where: { id: runId }, data });
  }
  if (e.kind === "phase" || e.kind === "status") await mirrorSpecStage(runId, e);
}

// Fan an event out to SSE subscribers across processes via Redis pub/sub.
export function publishEvent(pub: Redis, runId: string, e: RunEvent): void {
  void pub.publish(`run:${runId}:events`, JSON.stringify(e));
}
