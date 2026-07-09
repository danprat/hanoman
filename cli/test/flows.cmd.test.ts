import { describe, it, expect } from "vitest";
import { makeRepo } from "./_fixture";
// Sesi palsu: satu `result` per `send`, seperti binary aslinya (SPEC-013).
const fakeSession = () => {
  const queue: unknown[] = [];
  return {
    send() { queue.push({ type: "result", subtype: "success", session_id: "s", total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }); },
    async next() { return queue.shift() ?? null; },
    close() {}, kill() {},
  };
};
describe("hanoman scaffold", () => {
  it("runs the scaffold pipeline", async () => {
    const { root } = await makeRepo({ index: "\n" });
    const out: string[] = [];
    const code = await (await import("../src/commands/scaffold")).runScaffold(["--from", "objective"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {} }, {
      openSession: fakeSession,
      git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} }, verify: () => ({ blocked: false }) } as any);
    expect(code).toBe(0); expect(out.join("")).toMatch(/Doc index/);
  });
});
