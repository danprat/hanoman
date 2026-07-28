import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { ownsWorktree } from "../src/services/session-worktree";

// SPEC-362 · predikat yang menggerbangi satu-satunya operasi destruktif di penutupan sesi
// (`realGit.removeWorktree`). Diuji murni karena kesalahannya menghapus direktori sungguhan.
describe("ownsWorktree (SPEC-362)", () => {
  const repo = "/srv/project";

  it("true hanya untuk worktree DI DALAM <repoDir>/.worktrees/", () => {
    expect(ownsWorktree(repo, join(repo, ".worktrees", "spec-362"))).toBe(true);
    expect(ownsWorktree(repo, join(repo, ".worktrees", "merge-x"))).toBe(true);
  });

  it("false saat cwd = repoDir — terminal biasa tak pernah punya worktree sendiri", () => {
    expect(ownsWorktree(repo, repo)).toBe(false);
  });

  // Inti regresinya: menguji substring "/.worktrees/" pada cwd saja meloloskan kasus ini.
  it("false saat repoDir SENDIRI berada di bawah .worktrees/ milik repo lain", () => {
    const nested = "/srv/hanoman/.worktrees/spec-362";
    expect(ownsWorktree(nested, nested)).toBe(false);
    // …tapi worktree milik checkout bersarang itu tetap sah dihapus.
    expect(ownsWorktree(nested, join(nested, ".worktrees", "spec-1"))).toBe(true);
  });

  it("false untuk direktori .worktrees itu sendiri — wadahnya tak boleh ikut terhapus", () => {
    expect(ownsWorktree(repo, join(repo, ".worktrees"))).toBe(false);
  });

  it("false untuk path di luar repoDir, termasuk prefix yang mirip", () => {
    expect(ownsWorktree(repo, "/srv/lain/.worktrees/spec-1")).toBe(false);
    expect(ownsWorktree(repo, "/srv/project-lain/.worktrees/spec-1")).toBe(false);
    expect(ownsWorktree(repo, "/")).toBe(false);
  });

  it("menormalkan trailing slash dan segmen relatif sebelum membandingkan", () => {
    expect(ownsWorktree(`${repo}/`, join(repo, ".worktrees", "a"))).toBe(true);
    // ".worktrees/a/../.." kembali ke repoDir → tak boleh dianggap worktree.
    expect(ownsWorktree(repo, join(repo, ".worktrees", "a", "..", ".."))).toBe(false);
  });
});
