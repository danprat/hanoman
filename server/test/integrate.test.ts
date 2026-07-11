import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { integrate } from "../src/services/integrate";
import { makeRepoWithSpecBranch } from "./factory";

// isi file di sebuah ref: bare origin lewat --git-dir, repo biasa lewat -C.
const showBare = (gitDir: string, ref: string, path: string) =>
  execFileSync("git", ["--git-dir", gitDir, "show", `${ref}:${path}`], { encoding: "utf8" });
const showRepo = (repoDir: string, ref: string, path: string) =>
  execFileSync("git", ["-C", repoDir, "show", `${ref}:${path}`], { encoding: "utf8" });

describe("integrate — guards", () => {
  it("source branch tak ada → 409", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = integrate(repoDir, "SPEC-404", "merge", "origin:main");
    expect(r).toMatchObject({ status: "error", code: 409 });
  });
  it("target tak dikenal → 400", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    expect(integrate(repoDir, "SPEC-1", "merge", "origin:nope")).toMatchObject({ status: "error", code: 400 });
    expect(integrate(repoDir, "SPEC-1", "merge", "garbage")).toMatchObject({ status: "error", code: 400 });
  });
});

describe("integrate — merge clean", () => {
  it("→ origin: push kerja ke origin/<target>, worktree bersih", () => {
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-1");
    const r = integrate(repoDir, "SPEC-1", "merge", "origin:main");
    expect(r.status).toBe("clean");
    expect(showBare(origin, "main", "work.txt")).toBe("work\n");
    expect(existsSync(`${repoDir}/.worktrees/merge-spec-1`)).toBe(false);
  });
  it("→ lokal (branch tak ter-checkout): branch maju ke commit merge", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", { localBranches: ["staging"] });
    const r = integrate(repoDir, "SPEC-1", "merge", "local:staging");
    expect(r.status).toBe("clean");
    expect(showRepo(repoDir, "staging", "work.txt")).toBe("work\n");
  });
  it("→ lokal branch yang sedang di-checkout (main) → 409 gagal-aman", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    expect(integrate(repoDir, "SPEC-1", "merge", "local:main")).toMatchObject({ status: "error", code: 409 });
  });
});

describe("integrate — merge conflict", () => {
  it("konflik → tinggalkan worktree konflik + finalize instruction", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" },
      work: { "f.txt": "branch-edit\n" },
      mainAdvance: { "f.txt": "main-edit\n" }, // main & branch mengubah f.txt → konflik
    });
    const r = integrate(repoDir, "SPEC-1", "merge", "origin:main");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(existsSync(r.worktree)).toBe(true);
      expect(r.finalize).toContain("git push origin HEAD:refs/heads/main");
    }
  });
});

describe("integrate — rebase", () => {
  it("clean: replay kerja spec di atas target, force-push ke branch spec", () => {
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" },
      work: { "work.txt": "work\n" },
      mainAdvance: { "m.txt": "main-only\n" }, // maju tanpa menyentuh work.txt → rebase bersih
    });
    const r = integrate(repoDir, "SPEC-1", "rebase", "origin:main");
    expect(r.status).toBe("clean");
    // branch spec di origin kini memuat m.txt (dari main) DAN work.txt (kerja di-replay)
    expect(showBare(origin, "hanoman/spec-1", "m.txt")).toBe("main-only\n");
    expect(showBare(origin, "hanoman/spec-1", "work.txt")).toBe("work\n");
  });
  it("conflict → worktree konflik + instruksi force-push", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
    });
    const r = integrate(repoDir, "SPEC-1", "rebase", "origin:main");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.finalize).toContain("--force-with-lease");
  });
});
