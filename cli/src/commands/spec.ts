import type { RunDeps } from "@hanoman/runner";
import type { Ctx } from "../router";
import { runFlow, parseFlowArgs, prodDeps } from "./_run";
// Feature flow, single phase: produce the spec.
export async function runSpec(args: string[], ctx: Ctx, deps: RunDeps = prodDeps): Promise<number> {
  const p = parseFlowArgs(args);
  return runFlow({ flow: "feature", specId: p.specId, only: p.only ?? "Spec", repoDir: p.repoDir, branchTo: p.branchTo }, ctx, deps);
}
export default (args: string[], ctx: Ctx) => runSpec(args, ctx);
