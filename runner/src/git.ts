import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { GitOps } from "./types";
function git(cwd: string, args: string[], redact?: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    const safe = (s: string) => (redact ? (s || "").split(redact).join("***") : s);
    throw new Error(`git ${safe(args.join(" "))} failed: ${safe(r.stderr || r.stdout)}`);
  }
  return r.stdout;
}
const tryGit = (cwd: string, args: string[]) => { spawnSync("git", args, { cwd, encoding: "utf8" }); };
export const realGit: GitOps = {
  // --detach: check out branchFrom's commit in a detached HEAD so a run can
  // branch from `main` even while `main` is checked out in the primary tree
  // (git refuses to check out an already-in-use branch). commitAndPush then
  // pushes HEAD:branchTo, creating the target branch from the run's commits.
  addWorktree: (repo, path, branchFrom, reuse) => {
    // Melanjutkan run: worktree-nya justru yang dicari — di dalamnya ada spec dan plan
    // yang ditulis fase-fase sebelumnya. Menghapusnya membuat Execute kehilangan plan-nya.
    if (reuse && existsSync(isAbsolute(path) ? path : resolve(repo, path))) return;
    // Reclaim a leftover .worktrees/<id> from a prior failed/killed run so a
    // re-run (ids can be reused — nextRunId is max-based) isn't blocked by
    // "already exists". Registered worktree → remove+prune; bare dir → rm -rf.
    tryGit(repo, ["worktree", "remove", "--force", path]);
    tryGit(repo, ["worktree", "prune"]);
    rmSync(isAbsolute(path) ? path : resolve(repo, path), { recursive: true, force: true });
    git(repo, ["worktree", "add", "--detach", path, branchFrom]);
  },
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
