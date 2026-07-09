import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOne } from "../src/run";
import { SteerQueue } from "../src/steer-queue";
import type { ClaudeSession, CliOptions, RunDeps, RunInput, CliMessage } from "../src/index";

const steps = Object.fromEntries(["brainstorm", "spec", "plan", "execute", "audit"]
  .map((k) => [k, { model: "claude-opus-4-8", effort: "x-high" }])) as any;
const input = (over: Partial<RunInput> = {}): RunInput => ({ runId: "RUN-1", repoDir: "/repo",
  branchFrom: "main", branchTo: "feat/x", flow: "feature", steps, ...over });
const okResult = (over: Partial<Extract<CliMessage, { type: "result" }>> = {}): CliMessage => ({
  type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.1,
  usage: { input_tokens: 10, output_tokens: 5 }, ...over });

// Sesi palsu: satu `result` per `send`, seperti binary aslinya.
// `closed` lewat getter — Object.assign akan menyalinnya sebagai nilai dan fake-nya berbohong.
function fakeSession(res: () => CliMessage = okResult): ClaudeSession & { sent: string[]; readonly closed: boolean } {
  const sent: string[] = [];
  const queue: CliMessage[] = [];
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
  git: {
    addWorktree: vi.fn().mockReturnValue("base00"),
    removeWorktree: vi.fn(),
    commitAndPush: vi.fn().mockReturnValue("head99"),
    switchBase: vi.fn(),
  },
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
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
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

  it("starts a fresh conversation when the run has no session yet", async () => {
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
    const d = fakeDeps({ openSession });
    await runOne(input(), d, () => {});
    expect(openSession.mock.calls[0]![0].resume).toBeUndefined();
    expect(d.git.addWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1", "main", false);
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

  it("memancarkan base lalu head, dalam urutan itu", async () => {
    const events: any[] = [];
    await runOne(input(), fakeDeps(), (e) => events.push(e));
    const commits = events.filter((e) => e.kind === "commit");
    expect(commits).toEqual([{ kind: "commit", base: "base00" }, { kind: "commit", head: "head99" }]);
  });

  it("tidak memancarkan base saat addWorktree memakai ulang worktree", async () => {
    const d = fakeDeps();
    (d.git.addWorktree as any).mockReturnValue(undefined);
    const events: any[] = [];
    await runOne(input(), d, (e) => events.push(e));
    expect(events.filter((e) => e.kind === "commit" && e.base)).toEqual([]);
    expect(events.filter((e) => e.kind === "commit" && e.head)).toHaveLength(1);
  });
});

// ADR-0017: run yang terputus melanjutkan percakapannya, bukan mengulang dari brainstorm.
describe("runOne · melanjutkan run yang terputus", () => {
  // Worktree yang benar-benar ada di disk: itulah syarat sah "melanjutkan".
  const withWorktree = () => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-resume-"));
    mkdirSync(join(repoDir, ".worktrees", "run-1"), { recursive: true });
    return repoDir;
  };
  const DONE = ["Brainstorm", "Objective", "Spec", "Plan"];
  const doneNames = (events: any[]) =>
    events.filter((e) => e.kind === "phase" && e.state === "done").map((e) => e.name);

  it("resumes the session, reuses the worktree, and skips phases already done", async () => {
    const repoDir = withWorktree();
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
    const d = fakeDeps({ openSession });
    const events: any[] = [];
    const r = await runOne(input({ repoDir, resume: "sess-1", donePhases: DONE }), d, (e) => events.push(e));

    expect(r.status).toBe("done");
    expect(openSession.mock.calls[0]![0].resume).toBe("sess-1");
    // reuse=true → addWorktree TIDAK boleh menghapus pohon yang memuat spec + plan.
    expect(d.git.addWorktree).toHaveBeenCalledWith(repoDir, `${repoDir}/.worktrees/run-1`, "main", true);
    expect(doneNames(events)).toEqual(["Execute"]);
  });

  // Fase yang dilewati mengandalkan artefaknya masih ada. Worktree yang hilang — dipangkas,
  // atau dihapus run yang sukses — karena itu HARUS memaksa jalur dari nol: sesi yang ingat
  // "plan sudah kutulis" di atas worktree kosong akan meng-Execute rencana yang tidak ada.
  it("refuses to resume when the worktree is gone: fresh session, every phase re-run", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-resume-")); // tanpa .worktrees/run-1
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
    const d = fakeDeps({ openSession });
    const events: any[] = [];
    await runOne(input({ repoDir, resume: "sess-1", donePhases: DONE }), d, (e) => events.push(e));

    expect(openSession.mock.calls[0]![0].resume).toBeUndefined();
    expect(d.git.addWorktree).toHaveBeenCalledWith(repoDir, `${repoDir}/.worktrees/run-1`, "main", false);
    expect(doneNames(events)).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
  });

  // Run yang semua fasenya selesai tapi mati di commit/push: yang tersisa hanya push.
  // Membuka sesi claude di sini cuma membakar token untuk tidak mengerjakan apa pun.
  it("opens no claude session at all when every phase is already done", async () => {
    const repoDir = withWorktree();
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
    const d = fakeDeps({ openSession });
    const r = await runOne(input({ repoDir, resume: "sess-1", donePhases: [...DONE, "Execute"] }), d, () => {});

    expect(openSession).not.toHaveBeenCalled();
    expect(r.status).toBe("done");
    expect(d.git.commitAndPush).toHaveBeenCalled();
  });
});
