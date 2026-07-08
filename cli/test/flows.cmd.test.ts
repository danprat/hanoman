import { describe, it, expect } from "vitest";
import { makeRepo } from "./_fixture";
describe("hanoman scaffold", () => {
  it("runs the scaffold pipeline", async () => {
    const { root } = await makeRepo({ index: "\n" });
    const out: string[] = [];
    const code = await (await import("../src/commands/scaffold")).runScaffold(["--from", "objective"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {} }, {
      queryFn: () => (async function* () { yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }; })(),
      git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} }, verify: () => ({ blocked: false }), effortToThinking: () => undefined } as any);
    expect(code).toBe(0); expect(out.join("")).toMatch(/Doc index/);
  });
});
