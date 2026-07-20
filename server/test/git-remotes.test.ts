import { describe, it, expect } from "vitest";
import { prUrl, listRemotes, addRemote, removeRemote } from "../src/services/git-remotes";
import { makeRepoWithSpecBranch, makeRepoWithBranches } from "./factory";

describe("git-remotes prUrl (SPEC-233)", () => {
  it("github ssh & https", () => {
    expect(prUrl("git@github.com:acme/app.git", "feat", "main")).toBe("https://github.com/acme/app/compare/main...feat?expand=1");
    expect(prUrl("https://github.com/acme/app.git", "feat", "main")).toMatch(/github\.com\/acme\/app\/compare\/main\.\.\.feat/);
  });
  it("gitlab & bitbucket & unknown → null", () => {
    expect(prUrl("git@gitlab.com:acme/app.git", "feat", "main")).toMatch(/merge_requests\/new/);
    expect(prUrl("https://bitbucket.org/acme/app.git", "feat", "main")).toMatch(/pull-requests\/new/);
    expect(prUrl("git@example.com:x/y.git", "feat", "main")).toBeNull();
  });
  it("nested group gitlab", () => {
    expect(prUrl("git@gitlab.com:grp/sub/app.git", "feat", "main")).toMatch(/gitlab\.com\/grp\/sub\/app\/-\/merge_requests\/new/);
  });
});

describe("git-remotes CRUD (SPEC-233)", () => {
  it("listRemotes membaca origin", async () => {
    const { repoDir } = makeRepoWithSpecBranch("rm");
    expect((await listRemotes(repoDir)).map((r) => r.name)).toContain("origin");
  });
  it("addRemote lalu removeRemote", async () => {
    const dir = makeRepoWithBranches();
    expect((await addRemote(dir, "up", "https://example.com/x/y.git")).ok).toBe(true);
    expect((await listRemotes(dir)).map((r) => r.name)).toContain("up");
    expect((await removeRemote(dir, "up")).ok).toBe(true);
    expect((await listRemotes(dir)).map((r) => r.name)).not.toContain("up");
  });
  it("listRemotes repoDir null → []", async () => {
    expect(await listRemotes(null)).toEqual([]);
  });
});
