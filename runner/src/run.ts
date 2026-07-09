import type { QueryFn, RunEvent, RunInput, RunResult, GitOps, SdkUserMessage } from "./types";
import { PIPELINES, phasePrompt, stepFor } from "./phases";
import { runPhase } from "./phase";
import { SteerQueue } from "./steer-queue";
export interface RunDeps {
  queryFn: QueryFn; git: GitOps; verify: (cwd: string) => { blocked: boolean; reason?: string; error?: string };
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
    if (input.only && phase !== input.only) continue; // spec/plan run a single phase
    if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return { status: "stopped", costUsd, tokensIn, tokensOut }; }
    onEvent({ kind: "phase", name: phase, state: "active" });
    if (phase === "Execute") {
      const v = deps.verify(worktree);
      if (v.error !== undefined) {
        onEvent({ kind: "log", line: { t: "✗", s: `guardrail tool error · ${v.error}` } });
        onEvent({ kind: "phase", name: phase, state: "failed" });
        onEvent({ kind: "status", status: "failed" });
        return { status: "failed", costUsd, tokensIn, tokensOut };
      }
      if (v.blocked) {
        onEvent({ kind: "log", line: { t: "✗", s: `plan diblok · ${v.reason ?? "docs stale (Source of Truth)"}` } });
        onEvent({ kind: "phase", name: phase, state: "failed" });
        onEvent({ kind: "status", status: "failed" });
        return { status: "failed", costUsd, tokensIn, tokensOut };
      }
    }
    const step = input.steps[stepFor(phase)];
    // Execute streams (so steer messages can be injected mid-turn), but its first
    // message must still be the phase prompt — it used to be a bare "mulai", which
    // left the executing turn with no backlog context at all.
    const text = phasePrompt(input.flow, phase, input);
    let prompt: string | AsyncIterable<SdkUserMessage> = text;
    if (phase === "Execute" && ctl.steer) { ctl.steer.push(text); prompt = ctl.steer.stream(); }
    const r = await runPhase({ queryFn: deps.queryFn, cwd: worktree, model: step.model,
      effort: step.effort, prompt, abortController, onEvent });
    costUsd += r.costUsd; tokensIn += r.tokensIn; tokensOut += r.tokensOut;
    // Any error_* subtype (error_during_execution, error_max_turns, …) is a failed phase.
    // Matching only one of them would silently report the rest as `done`.
    if (r.subtype.startsWith("error")) {
      onEvent({ kind: "log", line: { t: "✗", s: `fase ${phase} gagal · ${r.subtype}` } });
      onEvent({ kind: "phase", name: phase, state: "failed" });
      onEvent({ kind: "status", status: "failed" });
      return { status: "failed", costUsd, tokensIn, tokensOut };
    }
    onEvent({ kind: "phase", name: phase, state: "done" });
  }
  if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return { status: "stopped", costUsd, tokensIn, tokensOut }; }
  deps.git.commitAndPush(worktree, `hanoman ${input.flow} ${input.specId ?? ""}`.trim(), input.branchTo, input.remoteUrl);
  deps.git.removeWorktree(input.repoDir, worktree);
  onEvent({ kind: "status", status: "done" });
  return { status: "done", costUsd, tokensIn, tokensOut };
}
