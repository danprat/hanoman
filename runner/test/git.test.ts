import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { realGit } from "../src/git";
const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
function seedRepo() {
  const remote = mkdtempSync(join(tmpdir(), "remote-")); g(remote, "init", "--bare", "-q");
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "x"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "init");
  g(repo, "branch", "-M", "main"); g(repo, "remote", "add", "origin", remote); g(repo, "push", "-q", "origin", "main");
  return { repo, remote };
}
describe("git worktree ops", () => {
  it("adds a worktree, commits, pushes, removes", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-1");
    realGit.addWorktree(repo, wt, "main");
    expect(existsSync(wt)).toBe(true);
    writeFileSync(join(wt, "new.txt"), "hi");
    realGit.commitAndPush(wt, "feat: x", "feat/run-1");
    expect(g(repo, "branch", "-r").stdout).toContain("origin/feat/run-1");
    realGit.removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
  });
});
