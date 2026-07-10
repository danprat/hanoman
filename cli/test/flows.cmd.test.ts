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
// SPEC-143: branch sumber worktree dapat dipilih dari CLI. Flag-nya `--branch-from`,
// berpasangan dengan `--branch-to` yang sudah ada. `--from` TIDAK dipakai: AGENTS.md
// memberinya arti lain (`hanoman scaffold --from objective`).
const captureBranch = () => {
  const seen: string[] = [];
  const deps = {
    openSession: fakeSession,
    git: { addWorktree: (_r: string, _p: string, b: string) => { seen.push(b); },
      removeWorktree() {}, commitAndPush() {}, switchBase() {} },
  } as any;
  return { seen, deps };
};
const ctx = (root: string) => ({ cwd: root, env: {}, stdout: () => {}, stderr: () => {} });

describe("hanoman spec --branch-from", () => {
  it("passes the branch through to the worktree", async () => {
    const { root } = await makeRepo({ index: "\n" });
    const { seen, deps } = captureBranch();
    await (await import("../src/commands/spec")).runSpec(["SPEC-1", "--branch-from", "release/v2"], ctx(root), deps);
    expect(seen[0]).toBe("release/v2");
  });
  it("defaults to main when omitted", async () => {
    const { root } = await makeRepo({ index: "\n" });
    const { seen, deps } = captureBranch();
    await (await import("../src/commands/spec")).runSpec(["SPEC-1"], ctx(root), deps);
    expect(seen[0]).toBe("main");
  });
  // `--from objective` milik scaffold (AGENTS.md). Ia tak boleh dibaca sebagai nama branch.
  it("leaves --from alone for scaffold", async () => {
    const { root } = await makeRepo({ index: "\n" });
    const { seen, deps } = captureBranch();
    await (await import("../src/commands/scaffold")).runScaffold(["--from", "objective"], ctx(root), deps);
    expect(seen[0]).toBe("main");
  });
});

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
