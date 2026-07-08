import type { RunDeps } from "@hanoman/runner";
import type { Ctx } from "../router";
import { runFlow, parseFlowArgs, prodDeps } from "./_run";
// Feature flow, single phase: produce the plan.
export async function runPlan(args: string[], ctx: Ctx, deps: RunDeps = prodDeps): Promise<number> {
  const p = parseFlowArgs(args);
  return runFlow({ flow: "feature", specId: p.specId, only: p.only ?? "Plan", repoDir: p.repoDir, branchTo: p.branchTo }, ctx, deps);
}
export default (args: string[], ctx: Ctx) => runPlan(args, ctx);
