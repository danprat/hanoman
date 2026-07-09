export type SdkUserMessage = { type: "user"; message: { role: "user"; content: string } };
export type SdkMessage =
  | { type: "assistant"; session_id?: string; message: { content: Array<{ type: string; text?: string; name?: string }> } }
  | { type: "result"; subtype: string; session_id: string; total_cost_usd: number; usage: { input_tokens: number; output_tokens: number } }
  | { type: "system"; session_id?: string };
export type QueryArgs = { prompt: string | AsyncIterable<SdkUserMessage>; options: Record<string, unknown> };
export type QueryFn = (args: QueryArgs) => AsyncIterable<SdkMessage>;
export type PhaseState = "pending" | "active" | "done" | "failed";
export type RunEvent =
  | { kind: "log"; line: { t: string; s: string } }
  | { kind: "phase"; name: string; state: PhaseState }
  | { kind: "file"; path: string; add: number; del: number; status: string }
  | { kind: "cost"; tokensIn: number; tokensOut: number; costUsd: number }
  | { kind: "status"; status: "running" | "paused" | "stopped" | "failed" | "done" };
export type Flow = "feature" | "qa" | "scaffold" | "reverse";
export type StepModel = { model: string; effort: string };
export type StepModels = Record<"brainstorm" | "spec" | "plan" | "execute" | "audit", StepModel>;
// Backlog item the run must implement, loaded from the DB by the worker at run
// time. Without it the phase prompt carried only "SPEC-3" — an id that means
// nothing inside a fresh worktree — so the run had no way to match the backlog.
export type SpecBrief = { id: string; title: string; source: string; priority: string; objective: string; payload?: unknown };
export type RunInput = { runId: string; projectId?: string; repoDir: string; branchFrom: string; branchTo: string; flow: Flow; specId?: string; spec?: SpecBrief; steps: StepModels; only?: string;
  // github-backed runs (SPEC-006): commit to report status on, "owner/repo",
  // installation to auth git ops, and a tokenized push remote (set at run time).
  commitSha?: string; reportRepo?: string; installationId?: number; remoteUrl?: string };
export type RunResult = { status: "done" | "failed" | "stopped"; costUsd: number; tokensIn: number; tokensOut: number };

export interface GitOps {
  addWorktree(repo: string, path: string, branchFrom: string): void;
  removeWorktree(repo: string, path: string): void;
  commitAndPush(worktreePath: string, message: string, branchTo: string, remoteUrl?: string): void;
  switchBase(worktreePath: string, branchFrom: string): void;
}
