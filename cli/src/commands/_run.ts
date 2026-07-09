import { parseArgs } from "node:util";
import { runOne, type RunDeps, type RunEvent, type RunInput, type Flow, type StepModels } from "@hanoman/runner";
import type { Ctx } from "../router";
import { resolveRepo } from "../repo";
import { prodDeps } from "./_deps";

const DEFAULT_STEP = { model: "claude-opus-4-8", effort: "x-high" };
export const defaultSteps = (): StepModels => ({
  brainstorm: { ...DEFAULT_STEP }, spec: { ...DEFAULT_STEP }, plan: { ...DEFAULT_STEP },
  execute: { ...DEFAULT_STEP }, audit: { ...DEFAULT_STEP },
});

export function printEvent(ctx: Ctx, e: RunEvent): void {
  if (e.kind === "log") ctx.stdout(`${e.line.t} ${e.line.s}\n`);
  else if (e.kind === "phase") ctx.stdout(`«fase» ${e.name} · ${e.state}\n`);
  else if (e.kind === "status") ctx.stdout(`— status: ${e.status} —\n`);
  else if (e.kind === "cost") ctx.stdout(`— biaya: $${e.costUsd.toFixed(2)} (${e.tokensIn}/${e.tokensOut} tok) —\n`);
}

export interface FlowArgs { flow: Flow; specId?: string; only?: string; repoDir?: string; branchTo?: string; branchFrom?: string; }
// Shared core for every CLI flow command: build the RunInput, drive runOne,
// stream events to stdout, exit 0 on done / 1 otherwise.
export async function runFlow(a: FlowArgs, ctx: Ctx, deps: RunDeps): Promise<number> {
  const { root } = resolveRepo(ctx.cwd);
  const repoDir = a.repoDir ?? root;
  const input: RunInput = {
    runId: `LOCAL-${a.specId ?? a.flow}`.toUpperCase(),
    repoDir,
    branchFrom: a.branchFrom ?? "main", // SPEC-143 · `--branch-from`; null/absent = default project
    branchTo: a.branchTo ?? `hanoman/${a.flow}`,
    flow: a.flow, specId: a.specId, only: a.only, steps: defaultSteps(),
  };
  const r = await runOne(input, deps, (e) => printEvent(ctx, e));
  if (r.status !== "done") ctx.stderr(`run ${r.status}\n`);
  return r.status === "done" ? 0 : 1;
}

// Parse `<specId> [--only <phase>] [--dir <path>] [--branch-from <b>] [--branch-to <b>]` from a
// command's argv; every flow command shares this shape.
// `--from` bukan branch: AGENTS.md memberinya arti lain (`hanoman scaffold --from objective`).
// Ia diparse dan diteruskan apa adanya; belum ada command yang membacanya (utang terpisah).
export function parseFlowArgs(args: string[]) {
  const { values, positionals } = parseArgs({ args, options: {
    only: { type: "string" }, dir: { type: "string" },
    "branch-to": { type: "string" }, "branch-from": { type: "string" }, from: { type: "string" },
  }, allowPositionals: true });
  return { specId: positionals[0], only: values.only, repoDir: values.dir,
    branchTo: values["branch-to"], branchFrom: values["branch-from"], from: values.from };
}

export { prodDeps };
