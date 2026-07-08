import type { RunDeps } from "@hanoman/runner";
import type { Ctx } from "../router";
import { runFlow, parseFlowArgs, prodDeps } from "./_run";
// `hanoman reverse --dir <path>` — reverse-engineer docs from existing code.
export async function runReverse(args: string[], ctx: Ctx, deps: RunDeps = prodDeps): Promise<number> {
  const p = parseFlowArgs(args);
  return runFlow({ flow: "reverse", only: p.only, repoDir: p.repoDir, branchTo: p.branchTo }, ctx, deps);
}
export default (args: string[], ctx: Ctx) => runReverse(args, ctx);
