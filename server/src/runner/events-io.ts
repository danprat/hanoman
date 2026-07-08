import type Redis from "ioredis";
import type { RunEvent } from "@hanoman/runner";
import { prisma } from "../db";

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
}

// Fan an event out to SSE subscribers across processes via Redis pub/sub.
export function publishEvent(pub: Redis, runId: string, e: RunEvent): void {
  void pub.publish(`run:${runId}:events`, JSON.stringify(e));
}
