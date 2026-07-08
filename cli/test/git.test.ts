import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { changedPaths, freshnessViolation } from "../src/git";
import { makeRepo } from "./_fixture";
const add = (root: string, rel: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), "x");
};
describe("git freshness", () => {
  it("lists changed paths", async () => {
    const { root } = await makeRepo({}); add(root, "src/a.ts");
    expect(changedPaths(root)).toContain("src/a.ts");
  });
  it("keeps the full path of a worktree-modified tracked file (leading-space status)", async () => {
    const { root } = await makeRepo({}); add(root, "src/a.ts");
    spawnSync("git", ["add", "-A"], { cwd: root });
    spawnSync("git", ["commit", "-qm", "init"], { cwd: root });
    appendFileSync(join(root, "src/a.ts"), "more");
    expect(changedPaths(root)).toContain("src/a.ts");   // " M src/a.ts" must not become "rc/a.ts"
    expect(freshnessViolation(changedPaths(root))).toBe(true);
  });
  it("flags src change without docs", () =>
    expect(freshnessViolation(["src/a.ts", "src/b.ts"])).toBe(true));
  it("clears when a doc also changed", () =>
    expect(freshnessViolation(["src/a.ts", "internal/docs/architecture/stack.md"])).toBe(false));
  it("no src change -> no violation", () =>
    expect(freshnessViolation(["README.md"])).toBe(false));
});
