import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRepoBranches, listRepoRemoteBranches, branchFromCandidates, defaultBranch } from "../src/services/branches";
import { makeRepoWithBranches, makeRepoWithSpecBranch } from "./factory";

describe("listRepoBranches", () => {
  it("lists local branches, sorted", async () => {
    expect(await listRepoBranches(makeRepoWithBranches("release/v2", "dev")))
      .toEqual(["dev", "main", "release/v2"]);
  });
  it("repoDir null → []", async () => {
    expect(await listRepoBranches(null)).toEqual([]);
  });
  it("not a git repo → [] (never throws)", async () => {
    expect(await listRepoBranches(mkdtempSync(join(tmpdir(), "kosong-")))).toEqual([]);
  });
});

describe("listRepoRemoteBranches", () => {
  it("lists origin branches without the origin/ prefix or HEAD, sorted", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    expect(await listRepoRemoteBranches(repoDir)).toEqual(["hanoman/spec-1", "main"]);
  });
  it("repoDir null / not a repo → []", async () => {
    expect(await listRepoRemoteBranches(null)).toEqual([]);
  });
});

describe("branchFromCandidates (SPEC-244)", () => {
  it("menggabung branch lokal dan origin (dedup, sorted)", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");   // lokal: main, hanoman/spec-1 · origin: main, hanoman/spec-1
    expect(await branchFromCandidates(repoDir)).toEqual(["hanoman/spec-1", "main"]);
  });
  it("menyertakan branch yang HANYA ada di origin", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-9");
    spawnSync("git", ["branch", "-D", "hanoman/spec-9"], { cwd: repoDir, encoding: "utf8" }); // sisakan origin/hanoman/spec-9
    const c = await branchFromCandidates(repoDir);
    expect(c).toContain("hanoman/spec-9");
    expect(await listRepoBranches(repoDir)).not.toContain("hanoman/spec-9"); // bukti: remote-only
  });
  it("repoDir null → []", async () => { expect(await branchFromCandidates(null)).toEqual([]); });
});

function repoWith(branches: string[], head: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hnm-defbranch-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir });
  git("init", "-q", "-b", head);
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("commit", "-q", "--allow-empty", "-m", "init");
  for (const b of branches) if (b !== head) git("branch", b);
  return dir;
}

describe("defaultBranch (SPEC-486)", () => {
  it("memakai main bila ada", async () => {
    expect(await defaultBranch(repoWith(["main", "develop"], "main"))).toBe("main");
  });

  // SPEC-227/ADR-0077 · repo bisa ber-default master/develop. Jangan pernah hardcode "main".
  it("jatuh ke master saat tak ada main", async () => {
    expect(await defaultBranch(repoWith(["master", "fitur"], "master"))).toBe("master");
  });

  it("null bila tak ada main maupun master (bukan menebak)", async () => {
    expect(await defaultBranch(repoWith(["develop"], "develop"))).toBeNull();
  });

  it("null untuk repoDir null / bukan repo git", async () => {
    expect(await defaultBranch(null)).toBeNull();
    expect(await defaultBranch(mkdtempSync(join(tmpdir(), "hnm-kosong-")))).toBeNull();
  });
});
