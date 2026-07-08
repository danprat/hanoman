import { describe, it, expect, vi } from "vitest";
import { runOne } from "../src/run";
import type { RunDeps, RunInput } from "../src/index";
const steps = Object.fromEntries(["brainstorm", "spec", "plan", "execute", "audit"].map((k) => [k, { model: "claude-opus-4-8", effort: "x-high" }])) as any;
const input = (over: Partial<RunInput> = {}): RunInput => ({ runId: "RUN-1", repoDir: "/repo", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps, ...over });
const okResult = { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.1, usage: { input_tokens: 10, output_tokens: 5 } } as const;
const fakeDeps = (over: Partial<RunDeps> = {}): RunDeps => ({
  queryFn: () => (async function* () { yield okResult; })(),
  git: { addWorktree: vi.fn(), removeWorktree: vi.fn(), commitAndPush: vi.fn(), switchBase: vi.fn() },
  verify: () => ({ blocked: false }), effortToThinking: () => undefined, ...over });
describe("runOne", () => {
  it("runs every feature phase and commits on success", async () => {
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("done");
    expect(d.git.addWorktree).toHaveBeenCalled(); expect(d.git.commitAndPush).toHaveBeenCalled(); expect(d.git.removeWorktree).toHaveBeenCalled();
    const done = events.filter((e) => e.kind === "phase" && e.state === "done").map((e) => e.name);
    expect(done).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
  });
  it("blocks at execute when docs are stale and does NOT commit", async () => {
    const d = fakeDeps({ verify: () => ({ blocked: true, reason: "docs stale" }) }); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("failed");
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(events.some((e) => e.kind === "log" && e.line.s.includes("docs stale"))).toBe(true);
  });
  it("fails at execute with a tool-error log when the guardrail crashes", async () => {
    const d = fakeDeps({ verify: () => ({ blocked: true, error: "boom" }) }); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("failed");
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(events.some((e) => e.kind === "log" && e.line.s === "guardrail tool error · boom")).toBe(true);
    // NOT reported as a docs-stale policy block
    expect(events.some((e) => e.kind === "log" && e.line.s.includes("plan diblok"))).toBe(false);
  });
  it("stops and keeps the worktree when aborted before finishing", async () => {
    const ac = new AbortController();
    const d = fakeDeps({ queryFn: () => (async function* () { ac.abort(); yield okResult; })() });
    const r = await runOne(input(), d, () => {}, { abortController: ac });
    expect(r.status).toBe("stopped");
    expect(d.git.removeWorktree).not.toHaveBeenCalled();
  });
  it("fails on budget error", async () => {
    const d = fakeDeps({ queryFn: () => (async function* () { yield { ...okResult, subtype: "error_max_budget_usd" }; })() });
    const r = await runOne(input(), d, () => {});
    expect(r.status).toBe("failed");
  });
});
