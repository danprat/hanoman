import type { RunDeps } from "@hanoman/runner";
import type { Ctx } from "../router";
import { runFlow, parseFlowArgs, prodDeps } from "./_run";
export async function runQa(args: string[], ctx: Ctx, deps: RunDeps = prodDeps): Promise<number> {
  const p = parseFlowArgs(args);
  return runFlow({ flow: "qa", specId: p.specId, only: p.only, repoDir: p.repoDir, branchTo: p.branchTo }, ctx, deps);
}
export default (args: string[], ctx: Ctx) => runQa(args, ctx);
