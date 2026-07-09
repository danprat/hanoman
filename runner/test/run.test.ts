import { describe, it, expect, vi } from "vitest";
import { runOne } from "../src/run";
import { SteerQueue } from "../src/steer-queue";
import type { ClaudeSession, RunDeps, RunInput, SdkMessage } from "../src/index";

const steps = Object.fromEntries(["brainstorm", "spec", "plan", "execute", "audit"]
  .map((k) => [k, { model: "claude-opus-4-8", effort: "x-high" }])) as any;
const input = (over: Partial<RunInput> = {}): RunInput => ({ runId: "RUN-1", repoDir: "/repo",
  branchFrom: "main", branchTo: "feat/x", flow: "feature", steps, ...over });
const okResult = (over: Partial<Extract<SdkMessage, { type: "result" }>> = {}): SdkMessage => ({
  type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.1,
  usage: { input_tokens: 10, output_tokens: 5 }, ...over });

// Sesi palsu: satu `result` per `send`, seperti binary aslinya.
// `closed` lewat getter — Object.assign akan menyalinnya sebagai nilai dan fake-nya berbohong.
function fakeSession(res: () => SdkMessage = okResult): ClaudeSession & { sent: string[]; readonly closed: boolean } {
  const sent: string[] = [];
  const queue: SdkMessage[] = [];
  let closed = false;
  return {
    sent,
    get closed() { return closed; },
    send(t) { sent.push(t); queue.push(res()); },
    async next() { return queue.shift() ?? null; },
    close() { closed = true; },
    kill() { /* empty */ },
  };
}
const fakeDeps = (over: Partial<RunDeps> = {}): RunDeps => ({
  openSession: () => fakeSession(),
  git: { addWorktree: vi.fn(), removeWorktree: vi.fn(), commitAndPush: vi.fn(), switchBase: vi.fn() },
  verify: () => ({ blocked: false }), ...over });

describe("runOne", () => {
  it("runs every feature phase and commits on success", async () => {
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("done");
    expect(d.git.addWorktree).toHaveBeenCalled(); expect(d.git.commitAndPush).toHaveBeenCalled(); expect(d.git.removeWorktree).toHaveBeenCalled();
    const done = events.filter((e) => e.kind === "phase" && e.state === "done").map((e) => e.name);
    expect(done).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
  });

  // Inti SPEC-013: satu backlog, satu spawn.
  it("opens exactly one claude session for the whole run", async () => {
    const openSession = vi.fn(() => fakeSession());
    await runOne(input(), fakeDeps({ openSession }), () => {});
    expect(openSession).toHaveBeenCalledTimes(1);
  });

  it("closes stdin when the run ends", async () => {
    const s = fakeSession();
    await runOne(input(), fakeDeps({ openSession: () => s }), () => {});
    expect(s.closed).toBe(true);
  });

  it("emits the session id once so the terminal can resume it", async () => {
    const events: any[] = [];
    await runOne(input(), fakeDeps(), (e) => events.push(e));
    expect(events.filter((e) => e.kind === "session")).toEqual([{ kind: "session", sessionId: "s" }]);
  });

  // REGRESI: worker.ts SELALU mengoper steer; cli/_run.ts tidak. Dulu ini menggantung selamanya
  // karena prompt fase Execute berupa AsyncIterable yang menahan stdin tetap terbuka.
  it("finishes the Execute phase when a steer queue is wired in", async () => {
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e), { steer: new SteerQueue() });
    expect(r.status).toBe("done");
    const done = events.filter((e) => e.kind === "phase" && e.state === "done").map((e) => e.name);
    expect(done).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
  }, 5000);

  it("drains steer messages as extra turns between phases", async () => {
    const s = fakeSession();
    const steer = new SteerQueue();
    steer.push("belok kiri");
    await runOne(input({ only: "Execute" }), fakeDeps({ openSession: () => s }), () => {}, { steer });
    expect(s.sent).toEqual([expect.stringContaining("fase Execute"), "belok kiri"]);
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
    const d = fakeDeps({ openSession: () => { ac.abort(); return fakeSession(); } });
    const r = await runOne(input(), d, () => {}, { abortController: ac });
    expect(r.status).toBe("stopped");
    expect(d.git.removeWorktree).not.toHaveBeenCalled();
  });

  // Matching one error_* subtype would silently report every other one as `done`.
  it.each(["error_during_execution", "error_max_turns", "error_max_budget_usd"])(
    "fails the run on result subtype %s", async (subtype) => {
      const d = fakeDeps({ openSession: () => fakeSession(() => okResult({ subtype })) });
      const r = await runOne(input(), d, () => {});
      expect(r.status).toBe("failed");
      expect(d.git.commitAndPush).not.toHaveBeenCalled();
    });
});
