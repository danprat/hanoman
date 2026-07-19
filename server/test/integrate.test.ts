import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { integrate, integrateBranch } from "../src/services/integrate";
import { makeRepoWithSpecBranch } from "./factory";

// isi file di sebuah ref: bare origin lewat --git-dir, repo biasa lewat -C.
const showBare = (gitDir: string, ref: string, path: string) =>
  execFileSync("git", ["--git-dir", gitDir, "show", `${ref}:${path}`], { encoding: "utf8" });
const showRepo = (repoDir: string, ref: string, path: string) =>
  execFileSync("git", ["-C", repoDir, "show", `${ref}:${path}`], { encoding: "utf8" });

describe("integrate — guards", () => {
  it("source branch tak ada → 409", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = await integrate(repoDir, "SPEC-404", "merge", "origin:main");
    expect(r).toMatchObject({ status: "error", code: 409 });
  });
  it("target tak dikenal → 400", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    expect(await integrate(repoDir, "SPEC-1", "merge", "origin:nope")).toMatchObject({ status: "error", code: 400 });
    expect(await integrate(repoDir, "SPEC-1", "merge", "garbage")).toMatchObject({ status: "error", code: 400 });
  });
});

describe("integrateBranch — branch eksplisit (sesi PRD)", () => {
  it("merge branch non-spec ke origin:main → clean, worktree merge-<mergeId> bersih", async () => {
    // factory membuat branch hanoman/spec-1; kita perlakukan namanya sebagai branch generik
    // dengan mergeId khas sesi (prd-demo) → worktree integrasi = merge-prd-demo.
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = await integrateBranch(
      repoDir, { branch: "hanoman/spec-1", mergeId: "prd-demo" }, "merge", "origin:main");
    expect(r.status).toBe("clean");
    expect(existsSync(`${repoDir}/.worktrees/merge-prd-demo`)).toBe(false);
  });
  it("branch tak ada → 409", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = await integrateBranch(
      repoDir, { branch: "prd/nope", mergeId: "prd-nope" }, "merge", "origin:main");
    expect(r).toMatchObject({ status: "error", code: 409 });
  });
});

describe("integrate — merge clean", () => {
  it("→ origin: push kerja ke origin/<target>, worktree bersih", async () => {
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-1");
    const r = await integrate(repoDir, "SPEC-1", "merge", "origin:main");
    expect(r.status).toBe("clean");
    expect(showBare(origin, "main", "work.txt")).toBe("work\n");
    expect(existsSync(`${repoDir}/.worktrees/merge-spec-1`)).toBe(false);
  });
  it("→ lokal (branch tak ter-checkout): branch maju ke commit merge", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", { localBranches: ["staging"] });
    const r = await integrate(repoDir, "SPEC-1", "merge", "local:staging");
    expect(r.status).toBe("clean");
    expect(showRepo(repoDir, "staging", "work.txt")).toBe("work\n");
  });
  it("→ lokal checked-out (main), tree bersih: fast-forward, main maju ke commit merge", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = await integrate(repoDir, "SPEC-1", "merge", "local:main");
    expect(r.status).toBe("clean");
    expect(showRepo(repoDir, "main", "work.txt")).toBe("work\n");
  });
  it("→ lokal checked-out, working tree kotor bertabrakan → 409", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    // merge akan menambah work.txt; file untracked bernama sama memblokir fast-forward.
    writeFileSync(join(repoDir, "work.txt"), "uncommitted\n");
    expect(await integrate(repoDir, "SPEC-1", "merge", "local:main")).toMatchObject({ status: "error", code: 409 });
  });
});

describe("integrate — merge conflict", () => {
  it("konflik → tinggalkan worktree konflik + finalize instruction", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" },
      work: { "f.txt": "branch-edit\n" },
      mainAdvance: { "f.txt": "main-edit\n" }, // main & branch mengubah f.txt → konflik
    });
    const r = await integrate(repoDir, "SPEC-1", "merge", "origin:main");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(existsSync(r.worktree)).toBe(true);
      expect(r.finalize).toContain("git push origin HEAD:refs/heads/main");
    }
  });
  it("konflik → lokal checked-out: finalize pakai merge --ff-only, bukan branch -f", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
    });
    const r = await integrate(repoDir, "SPEC-1", "merge", "local:main");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.finalize).toContain("merge --ff-only");
      expect(r.finalize).not.toContain("git branch -f");
    }
  });
});

describe("integrate — rebase", () => {
  it("clean: replay kerja spec di atas target, force-push ke branch spec", async () => {
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" },
      work: { "work.txt": "work\n" },
      mainAdvance: { "m.txt": "main-only\n" }, // maju tanpa menyentuh work.txt → rebase bersih
    });
    const r = await integrate(repoDir, "SPEC-1", "rebase", "origin:main");
    expect(r.status).toBe("clean");
    // branch spec di origin kini memuat m.txt (dari main) DAN work.txt (kerja di-replay)
    expect(showBare(origin, "hanoman/spec-1", "m.txt")).toBe("main-only\n");
    expect(showBare(origin, "hanoman/spec-1", "work.txt")).toBe("work\n");
  });
  it("conflict → worktree konflik + instruksi force-push", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
    });
    const r = await integrate(repoDir, "SPEC-1", "rebase", "origin:main");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.finalize).toContain("--force-with-lease");
  });
});
