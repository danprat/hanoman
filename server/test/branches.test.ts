import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRepoBranches, listRepoRemoteBranches, branchFromCandidates } from "../src/services/branches";
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
