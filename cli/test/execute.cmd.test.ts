import { describe, it, expect } from "vitest";
import { runExecute } from "../src/commands/execute";
import { makeRepo } from "./_fixture";
const fakeDeps = { queryFn: () => (async function* () { yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }; })(),
  git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} }, verify: () => ({ blocked: false }), effortToThinking: () => undefined } as any;
describe("hanoman execute", () => {
  it("streams phase logs and exits 0 on success", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    const out: string[] = [];
    const code = await runExecute(["SPEC-1"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {} }, fakeDeps);
    expect(code).toBe(0); expect(out.join("")).toMatch(/Execute/);
  });
});
