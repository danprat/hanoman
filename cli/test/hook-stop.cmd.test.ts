import { describe, it, expect } from "vitest";
import { run } from "../src/router";
import { makeRepo } from "./_fixture";
const runHook = async (root: string, payload: object) => {
  const out: string[] = [];
  await run(["hook", "stop"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {},
    readStdin: async () => JSON.stringify(payload) });
  return out.join("");
};
describe("hook stop", () => {
  it("emits a block decision when the repo is dirty (unlinked doc)", async () => {
    const { root } = await makeRepo({ index: "\n", docs: { "architecture/nfr.md": "y" } });
    const j = JSON.parse(await runHook(root, { cwd: root }));
    expect(j.decision).toBe("block"); expect(j.reason).toContain("nfr.md");
  });
  it("allows (no output) on a clean repo", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    expect(await runHook(root, { cwd: root })).toBe("");
  });
  it("allows when stop_hook_active to avoid loops", async () => {
    const { root } = await makeRepo({ index: "\n", docs: { "architecture/nfr.md": "y" } });
    expect(await runHook(root, { cwd: root, stop_hook_active: true })).toBe("");
  });
});
