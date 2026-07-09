import type { RunDeps } from "@hanoman/runner";
import type { Ctx } from "../router";
import { runFlow, parseFlowArgs, prodDeps } from "./_run";
export async function runExecute(args: string[], ctx: Ctx, deps: RunDeps = prodDeps): Promise<number> {
  const p = parseFlowArgs(args);
  return runFlow({ flow: "feature", specId: p.specId, only: p.only, repoDir: p.repoDir, branchTo: p.branchTo, branchFrom: p.branchFrom }, ctx, deps);
}
export default (args: string[], ctx: Ctx) => runExecute(args, ctx);
