import type { Trigger } from "@hanoman/shared";
import { prisma } from "./db";
import { enqueueRun } from "./queue";
import { nextRunId } from "./services/id";
import { stepModels } from "./services/settings";

// A spec is "ready" for a feature run once its plan exists but hasn't executed.
const READY = ["spec-ready", "planned"];
const FLOW: Record<string, "feature" | "qa" | "scaffold"> = {
  "plan + execute": "feature", "audit": "qa", "qa audit": "qa", "scaffold docs": "scaffold",
};

// Map a trigger's target to run(s) and enqueue them. `feature` fans out one run
// per ready spec (skips when none); `qa`/`scaffold` enqueue one project-level run.
// Shared entry point reused by SPEC-006 (webhooks).
export async function fireTrigger(
  trigger: Trigger,
  ctx: { branch?: string; sha?: string } = {},
): Promise<{ enqueued: string[]; skipped?: string }> {
  const flow = FLOW[trigger.target];
  if (!flow) return { enqueued: [], skipped: `unknown target ${trigger.target}` };
  const project = await prisma.project.findUniqueOrThrow({ where: { id: trigger.projectId } });
  const base = { repoDir: project.repoDir ?? "", branchFrom: ctx.branch ?? "main", projectId: trigger.projectId };
  const steps = await stepModels();
  const enqueued: string[] = [];

  if (flow === "feature") {
    const specs = await prisma.spec.findMany({ where: { projectId: trigger.projectId, stage: { in: READY } } });
    if (!specs.length) return { enqueued, skipped: "no ready spec" };
    for (const s of specs) {
      const runId = await nextRunId();
      const r = await enqueueRun({ runId, ...base, branchTo: `hanoman/${runId.toLowerCase()}`, flow, specId: s.id, steps });
      if (r.enqueued) enqueued.push(runId);
    }
  } else {
    const runId = await nextRunId();
    const r = await enqueueRun({ runId, ...base, branchTo: `hanoman/${runId.toLowerCase()}`, flow, steps });
    if (r.enqueued) enqueued.push(runId);
  }
  return { enqueued };
}
