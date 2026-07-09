import { makeClaudeCliSession, realGit, type RunDeps } from "@hanoman/runner";
import { collectViolations } from "../verify";
// CLI runs in-process, so the guardrail reuses collectViolations directly
// instead of shelling out to `hanoman docs verify`. The PreToolUse guardrail, by
// contrast, runs inside the spawned claude, so it re-enters this same binary.
export const prodDeps: RunDeps = {
  openSession: makeClaudeCliSession({ guardCommand: `node "${process.argv[1]}" hook pretooluse` }),
  git: realGit,
  verify: (cwd) => {
    const { violations } = collectViolations(cwd);
    return violations.length ? { blocked: true, reason: violations.map((v) => v.reason).join("; ") } : { blocked: false };
  },
};
