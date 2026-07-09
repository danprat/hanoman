import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOne } from "../src/run";
import { SteerQueue } from "../src/steer-queue";
import { DECISION_FILE } from "../src/phases";
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

  // pause/stop mem-abort di TENGAH giliran, bukan di antara fase: `claude` mati, `next()`
  // mengembalikan null, `takeTurn` melempar. Lemparan yang lolos keluar membuat job BullMQ
  // gagal dan markFailed menandai run `failed` — padahal penggunanya yang menekan stop.
  it("stops, tidak melempar, saat abort mendarat di tengah giliran", async () => {
    const ac = new AbortController();
    // Sesi yang dibunuh oleh abort: `send` mengabort dan tak pernah mengantre `result`,
    // jadi `next()` mengembalikan null persis seperti proses claude yang mati.
    const killedSession = (): ClaudeSession => ({
      send() { ac.abort(); }, async next() { return null; }, close() { /* empty */ }, kill() { /* empty */ },
    });
    const d = fakeDeps({ openSession: killedSession });
    const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e), { abortController: ac });
    expect(r.status).toBe("stopped");
    expect(events.at(-1)).toEqual({ kind: "status", status: "stopped" });
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(d.git.removeWorktree).not.toHaveBeenCalled();
  });

  // Yang bukan abort tetap harus melempar — kalau tidak, sesi claude yang mati sendiri
  // (crash, auth ditolak) akan diam-diam dilaporkan sebagai "stopped" atas permintaan.
  it("melempar saat sesi mati tanpa abort", async () => {
    const deadSession = (): ClaudeSession => ({
      send() { /* empty */ }, async next() { return null; }, close() { /* empty */ }, kill() { /* empty */ },
    });
    await expect(runOne(input(), fakeDeps({ openSession: deadSession }), () => {}))
      .rejects.toThrow(/sesi claude berakhir sebelum `result` tiba/);
  });

  // Matching one error_* subtype would silently report every other one as `done`.
  it.each(["error_during_execution", "error_max_turns", "error_max_budget_usd"])(
    "fails the run on result subtype %s", async (subtype) => {
      const d = fakeDeps({ openSession: () => fakeSession(() => okResult({ subtype })) });
      const r = await runOne(input(), d, () => {});
      expect(r.status).toBe("failed");
      expect(d.git.commitAndPush).not.toHaveBeenCalled();
    });

  // REGRESI (RUN-8804/8805): 502/401 di tengah giliran datang sebagai `success` + `is_error`.
  // Membaca `subtype` saja menandai fase yang tak pernah jalan sebagai `done`, lalu run melaju
  // ke commit — dan `progress: 100` membuat retry MELEWATI setiap fase.
  it("fails the run on an API error carrying a success subtype", async () => {
    const d = fakeDeps({ openSession: () => fakeSession(() => okResult({ is_error: true, api_error_status: 502 })) });
    const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("failed");
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(events.some((e) => e.kind === "phase" && e.state === "done")).toBe(false);
    expect(events.some((e) => e.kind === "log" && e.line.s === "fase Brainstorm gagal · API 502")).toBe(true);
  });

  // is_error tanpa kode HTTP (mis. "server disconnected") tetap gagal; alasannya jatuh ke subtype.
  it("fails the run on is_error with no api_error_status", async () => {
    const d = fakeDeps({ openSession: () => fakeSession(() => okResult({ is_error: true })) });
    const r = await runOne(input(), d, () => {});
    expect(r.status).toBe("failed");
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

// SPEC-145: alur qa memutuskan jalur hilirnya sendiri sesudah Audit.
describe("runOne · keputusan pasca-Audit (qa)", () => {
  const qaTree = (decision?: string) => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-qa-"));
    const wt = join(repoDir, ".worktrees", "run-1");
    mkdirSync(wt, { recursive: true });
    if (decision !== undefined) writeFileSync(join(wt, DECISION_FILE), decision);
    return { repoDir, wt };
  };
  const phaseStates = (events: any[], state: string) =>
    events.filter((e) => e.kind === "phase" && e.state === state).map((e) => e.name);

  it("skips Spec and Plan when the audit decides to execute", async () => {
    const { repoDir } = qaTree('{"path":"execute","reason":"satu predikat"}');
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input({ repoDir, flow: "qa" }), d, (e) => events.push(e));

    expect(r.status).toBe("done");
    expect(phaseStates(events, "done")).toEqual(["Audit", "Execute"]);
    expect(phaseStates(events, "skipped")).toEqual(["Spec", "Plan"]);
    expect(events.some((e) => e.kind === "log" && e.line.s.includes("satu predikat"))).toBe(true);
  });

  it("runs every qa phase when no decision artifact was written", async () => {
    const { repoDir } = qaTree();
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input({ repoDir, flow: "qa" }), d, (e) => events.push(e));

    expect(r.status).toBe("done");
    expect(phaseStates(events, "done")).toEqual(["Audit", "Spec", "Plan", "Execute"]);
    expect(phaseStates(events, "skipped")).toEqual([]);
  });

  // Melewati GILIRAN, bukan melewati GERBANG. Execute tetap lewat docs-verify.
  it("still gates Execute and still opens exactly one session on the fast path", async () => {
    const { repoDir } = qaTree('{"path":"execute"}');
    const verify = vi.fn(() => ({ blocked: false }));
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
    await runOne(input({ repoDir, flow: "qa" }), fakeDeps({ verify, openSession }), () => {});

    expect(verify).toHaveBeenCalledTimes(1);
    expect(openSession).toHaveBeenCalledTimes(1);
  });

  // `git add -A` men-stage berkas ber-titik di root: artefak yang tertinggal akan ter-commit
  // ke branchTo milik repo project. Unlink WAJIB sudah terjadi saat commitAndPush dipanggil.
  it("removes the decision artifact before commitAndPush", async () => {
    const { repoDir, wt } = qaTree('{"path":"execute"}');
    let presentAtCommit: boolean | undefined;
    const d = fakeDeps();
    d.git.commitAndPush = vi.fn(() => { presentAtCommit = existsSync(join(wt, DECISION_FILE)); return "head99"; });
    await runOne(input({ repoDir, flow: "qa" }), d, () => {});

    expect(presentAtCommit).toBe(false);
    expect(existsSync(join(wt, DECISION_FILE))).toBe(false);
  });

  // Artefak yatim dari percobaan yang mati SESUDAH `phase done` ter-persist tapi SEBELUM
  // pembacaan: Audit tak dijalankan lagi, jadi tak ada yang membacanya. Unlink tetap wajib.
  it("removes an orphaned artifact even when the full path runs", async () => {
    const { repoDir, wt } = qaTree('{"path":"spec"}');
    await runOne(input({ repoDir, flow: "qa" }), fakeDeps(), () => {});
    expect(existsSync(join(wt, DECISION_FILE))).toBe(false);
  });
});
