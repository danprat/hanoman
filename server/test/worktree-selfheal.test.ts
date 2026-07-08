import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { realGit } from "@hanoman/runner";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A run that failed/was killed leaves its .worktrees/<id> behind (removeWorktree
// only runs on success), and run ids can be reused (nextRunId is max-based). So a
// re-run must not be blocked by an existing worktree path — addWorktree self-heals.
describe("realGit.addWorktree reclaims a stale worktree (SPEC-009 follow-up)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
    const g = (c: string) => execSync(`git ${c}`, { cwd: repo, stdio: "pipe" });
    g("init -q -b main"); g("config user.email t@t"); g("config user.name t");
    writeFileSync(join(repo, "f.txt"), "hi");
    g("add -A"); g("commit -q -m init");
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("succeeds even when the worktree path already exists from a prior run", () => {
    const wt = join(repo, ".worktrees", "run-x");
    realGit.addWorktree(repo, wt, "main");        // first run creates it
    expect(existsSync(wt)).toBe(true);
    // a re-run reusing the same id must NOT throw "already exists"
    expect(() => realGit.addWorktree(repo, wt, "main")).not.toThrow();
    expect(existsSync(wt)).toBe(true);
  });

  it("succeeds when only a bare leftover directory exists (no worktree registration)", () => {
    const wt = join(repo, ".worktrees", "run-y");
    execSync(`mkdir -p ${wt}`, { stdio: "pipe" });
    writeFileSync(join(wt, "junk.txt"), "leftover");
    expect(() => realGit.addWorktree(repo, wt, "main")).not.toThrow();
    expect(existsSync(join(wt, ".git"))).toBe(true);   // now a real worktree
  });
});
