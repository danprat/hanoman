// Consumed by the `hanoman hook pretooluse` adapter, which the runner registers as a
// PreToolUse hook. Globs in --disallowed-tools are coarser than these regexes.
export function deniesDangerous(tool: string, input: Record<string, unknown>): boolean {
  const cmd = String((input as { command?: unknown }).command ?? "");
  if (tool === "Bash" && /\brm\s+-rf\b/.test(cmd)) return true;
  if (tool === "Bash" && /git\s+push\b.*\bmain\b/.test(cmd)) return true;
  // One run = one worktree — the one runOne created and removes. An agent that spawns
  // its own (a `using-git-worktrees`-style skill loaded from the user's settings) leaves
  // a tree the runner never cleans up and commits from a path it never pushes.
  if (tool === "Bash" && /git\s+worktree\s+add\b/.test(cmd)) return true;
  return false;
}
export const GUARD_DENY_REASON = "ditolak oleh guardrail hanoman";
