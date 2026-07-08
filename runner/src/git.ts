import { spawnSync } from "node:child_process";
import type { GitOps } from "./types";
function git(cwd: string, args: string[], redact?: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    const safe = (s: string) => (redact ? (s || "").split(redact).join("***") : s);
    throw new Error(`git ${safe(args.join(" "))} failed: ${safe(r.stderr || r.stdout)}`);
  }
  return r.stdout;
}
export const realGit: GitOps = {
  // --detach: check out branchFrom's commit in a detached HEAD so a run can
  // branch from `main` even while `main` is checked out in the primary tree
  // (git refuses to check out an already-in-use branch). commitAndPush then
  // pushes HEAD:branchTo, creating the target branch from the run's commits.
  addWorktree: (repo, path, branchFrom) => { git(repo, ["worktree", "add", "--detach", path, branchFrom]); },
  removeWorktree: (repo, path) => { git(repo, ["worktree", "remove", "--force", path]); },
  // remoteUrl (with an installation token) authenticates a push to a private
  // github remote; absent, push to `origin` (local runs, behaviour unchanged).
  commitAndPush: (path, message, branchTo, remoteUrl) => {
    git(path, ["add", "-A"]); git(path, ["commit", "-m", message]);
    // full refname: from a detached HEAD git can't infer refs/heads/ for a short dest
    git(path, ["push", remoteUrl ?? "origin", `HEAD:refs/heads/${branchTo}`], remoteUrl);
  },
  switchBase: (path, branchFrom) => { git(path, ["checkout", branchFrom]); },
};
