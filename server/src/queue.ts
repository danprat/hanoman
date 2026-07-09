import { Queue } from "bullmq";
import { isAbsolute } from "node:path";
import type { RunInput, Flow } from "@hanoman/runner";
import { PIPELINES } from "@hanoman/runner";
import { bullConnection } from "./redis";
import { fmtEstCost } from "@hanoman/shared";
import { prisma } from "./db";

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

// Upsert a `queued` Run row and add the job (no auto-retry: attempts 1). Cost is an
// estimate under OAuth auth, so it gates nothing — see ADR-0012.
//
// One run = one worktree. `resume`/`retry` re-enqueue the SAME runId, and nothing
// stopped a second job from being added while the first was still in flight: two
// runProcessors, two runOne, and addWorktree force-removes + recreates the shared
// `.worktrees/<id>` path — the second job wipes the first job's tree mid-run.
export async function enqueueRun(input: RunInput): Promise<{ enqueued: boolean; reason?: string }> {
  const projectId = input.projectId
    ?? (input.specId ? (await prisma.spec.findUniqueOrThrow({ where: { id: input.specId } })).projectId : undefined);
  if (!projectId) return { enqueued: false, reason: "projectId or specId required" };
  // The worktree is `${repoDir}/.worktrees/<id>`. A missing or relative repoDir resolves
  // against whichever process enqueued — the api (cwd = repo root) and the worker
  // (cwd = server/) disagree, so one run could own two worktrees in two places. Refusing
  // here is why the callers can pass `repoDir ?? ""` instead of a cwd-shaped guess.
  if (!isAbsolute(input.repoDir))
    return { enqueued: false, reason: `project ${projectId} butuh repoDir absolut` };
  const live = await prisma.run.findUnique({ where: { id: input.runId }, select: { status: true } });
  if (live && (live.status === "queued" || live.status === "running"))
    return { enqueued: false, reason: `run ${input.runId} masih ${live.status}` };
  await prisma.run.upsert({
    where: { id: input.runId },
    update: { status: "queued" },
    create: {
      id: input.runId, projectId, specId: input.specId ?? null,
      kind: input.flow, status: "queued", trigger: "manual", triggerDetail: "",
      commitSha: input.commitSha ?? null, reportRepo: input.reportRepo ?? null,
      phases: phasesForFlow(input.flow, input.only), plan: [], files: [], log: [],
      worktree: `.worktrees/${input.runId.toLowerCase()}`, branchFrom: input.branchFrom, branchTo: input.branchTo,
      model: "", tokensIn: "—", tokensOut: "—", cost: fmtEstCost(0), progress: 0,
    },
  });
  // jobId = runId makes a duplicate add a no-op, closing the race between the status
  // check above and this line. remove() first because removeOnFail keeps a failed job's
  // id occupied (a retry must be able to re-add it); it throws on an *active* job, which
  // is precisely when the add should stay a no-op.
  await runsQueue.remove(input.runId).catch(() => {});
  await runsQueue.add(input.runId, input, { jobId: input.runId, attempts: 1, removeOnComplete: true, removeOnFail: false });
  return { enqueued: true };
}
