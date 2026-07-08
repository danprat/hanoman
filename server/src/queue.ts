import { Queue } from "bullmq";
import type { RunInput, Flow } from "@hanoman/runner";
import { PIPELINES } from "@hanoman/runner";
import { bullConnection } from "./redis";
import { prisma } from "./db";
import { dailyBudget } from "./services/settings";

// BullMQ 5 forbids ":" in queue names (it's the internal Redis key separator).
export const RUNS_QUEUE = "hanoman-runs";
export const runsQueue = new Queue(RUNS_QUEUE, { connection: bullConnection });

// Seed the phases the run will actually execute (respecting single-phase `only` runs),
// all "pending". persistEvent then flips each to active/done/failed in place — without a
// seed, its read-modify-write map had nothing to update and phases stayed [] forever.
export function phasesForFlow(flow: Flow, only?: string): { name: string; state: "pending" }[] {
  const names = only ? [only] : PIPELINES[flow];
  return names.map((name) => ({ name, state: "pending" }));
}

// Sum today's run cost ($n strings) for the budget cutoff. createdAt bounds it to
// "today" so yesterday's spend doesn't count against today's dailyBudget.
export async function todaySpendUsd(): Promise<number> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const runs = await prisma.run.findMany({ where: { createdAt: { gte: since } } });
  return runs.reduce((n, r) => n + (parseFloat(String(r.cost).replace(/[^0-9.]/g, "")) || 0), 0);
}

// Budget-gated enqueue: reject new work at/over dailyBudget (a run already
// executing may exceed it — this governs new enqueues only), else upsert a
// `queued` Run row and add the job (no auto-retry: attempts 1).
export async function enqueueRun(input: RunInput): Promise<{ enqueued: boolean; reason?: string }> {
  if (await todaySpendUsd() >= await dailyBudget()) return { enqueued: false, reason: "dailyBudget reached" };
  const projectId = input.projectId
    ?? (input.specId ? (await prisma.spec.findUniqueOrThrow({ where: { id: input.specId } })).projectId : undefined);
  if (!projectId) return { enqueued: false, reason: "projectId or specId required" };
  await prisma.run.upsert({
    where: { id: input.runId },
    update: { status: "queued" },
    create: {
      id: input.runId, projectId, specId: input.specId ?? null,
      kind: input.flow, status: "queued", trigger: "manual", triggerDetail: "",
      commitSha: input.commitSha ?? null, reportRepo: input.reportRepo ?? null,
      phases: phasesForFlow(input.flow, input.only), plan: [], files: [], log: [],
      worktree: `.worktrees/${input.runId.toLowerCase()}`, branchFrom: input.branchFrom, branchTo: input.branchTo,
      model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 0,
    },
  });
  await runsQueue.add(input.runId, input, { attempts: 1, removeOnComplete: true, removeOnFail: false });
  return { enqueued: true };
}
