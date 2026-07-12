import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRepoBranches, listRepoRemoteBranches } from "../src/services/branches";
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
