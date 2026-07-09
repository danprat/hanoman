import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRepoBranches } from "../src/services/branches";
import { makeRepoWithBranches } from "./factory";

describe("listRepoBranches", () => {
  it("lists local branches, sorted", () => {
    expect(listRepoBranches(makeRepoWithBranches("release/v2", "dev")))
      .toEqual(["dev", "main", "release/v2"]);
  });
  it("repoDir null → []", () => {
    expect(listRepoBranches(null)).toEqual([]);
  });
  it("not a git repo → [] (never throws)", () => {
    expect(listRepoBranches(mkdtempSync(join(tmpdir(), "kosong-")))).toEqual([]);
  });
});
