import { makeClaudeCliSession, realGit, type RunDeps } from "@hanoman/runner";
// PreToolUse guardrail (deny perintah berbahaya) tetap; ia re-enter binary ini lewat `hook
// pretooluse`. Gate Source of Truth dicabut (SPEC-160) — tak ada lagi field `verify`.
export const prodDeps: RunDeps = {
  openSession: makeClaudeCliSession({ guardCommand: `node "${process.argv[1]}" hook pretooluse` }),
  git: realGit,
};
