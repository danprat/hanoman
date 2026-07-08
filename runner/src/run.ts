import type { QueryFn, RunEvent, RunInput, RunResult, GitOps } from "./types";
import { PIPELINES, phasePrompt, stepFor } from "./phases";
import { runPhase } from "./sdk";
import { SteerQueue } from "./steer-queue";
export interface RunDeps {
  queryFn: QueryFn; git: GitOps; verify: (cwd: string) => { blocked: boolean; reason?: string };
  effortToThinking: (effort: string) => number | undefined;
}
export async function runOne(
  input: RunInput, deps: RunDeps, onEvent: (e: RunEvent) => void,
  ctl: { abortController?: AbortController; steer?: SteerQueue } = {},
): Promise<RunResult> {
  const abortController = ctl.abortController ?? new AbortController();
  const worktree = `${input.repoDir}/.worktrees/${input.runId.toLowerCase()}`;
  let costUsd = 0, tokensIn = 0, tokensOut = 0;
  onEvent({ kind: "status", status: "running" });
  deps.git.addWorktree(input.repoDir, worktree, input.branchFrom);
  for (const phase of PIPELINES[input.flow]) {
    if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return { status: "stopped", costUsd, tokensIn, tokensOut }; }
    onEvent({ kind: "phase", name: phase, state: "active" });
    if (phase === "Execute") {
      const v = deps.verify(worktree);
      if (v.blocked) {
        onEvent({ kind: "log", line: { t: "✗", s: `plan diblok · ${v.reason ?? "docs stale (Source of Truth)"}` } });
        onEvent({ kind: "phase", name: phase, state: "failed" });
        onEvent({ kind: "status", status: "failed" });
        return { status: "failed", costUsd, tokensIn, tokensOut };
      }
    }
    const step = input.steps[stepFor(phase)];
    const prompt = phase === "Execute" && ctl.steer ? ctl.steer.stream() : phasePrompt(input.flow, phase, input);
    const r = await runPhase({ queryFn: deps.queryFn, cwd: worktree, model: step.model,
      maxThinkingTokens: deps.effortToThinking(step.effort), maxBudgetUsd: input.maxBudgetUsd,
      prompt, abortController, onEvent });
    costUsd += r.costUsd; tokensIn += r.tokensIn; tokensOut += r.tokensOut;
    if (r.subtype.startsWith("error_max_budget")) {
      onEvent({ kind: "log", line: { t: "✗", s: "dihentikan · dailyBudget tercapai" } });
      onEvent({ kind: "phase", name: phase, state: "failed" });
      onEvent({ kind: "status", status: "failed" });
      return { status: "failed", costUsd, tokensIn, tokensOut };
    }
    onEvent({ kind: "phase", name: phase, state: "done" });
  }
  if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return { status: "stopped", costUsd, tokensIn, tokensOut }; }
  deps.git.commitAndPush(worktree, `hanoman ${input.flow} ${input.specId ?? ""}`.trim(), input.branchTo);
  deps.git.removeWorktree(input.repoDir, worktree);
  onEvent({ kind: "status", status: "done" });
  return { status: "done", costUsd, tokensIn, tokensOut };
}
