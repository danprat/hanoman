import type { RunDeps } from "@hanoman/runner";
import type { Ctx } from "../router";
import { runFlow, parseFlowArgs, prodDeps } from "./_run";
// `hanoman scaffold --from objective` — scaffold internal/docs from an objective.
export async function runScaffold(args: string[], ctx: Ctx, deps: RunDeps = prodDeps): Promise<number> {
  const p = parseFlowArgs(args);
  return runFlow({ flow: "scaffold", only: p.only, repoDir: p.repoDir, branchTo: p.branchTo }, ctx, deps);
}
export default (args: string[], ctx: Ctx) => runScaffold(args, ctx);
