import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOne, MAX_ASKS_PER_PHASE } from "../src/run";
import { SteerQueue } from "../src/steer-queue";
import { DECISION_FILE, ASK_FILE } from "../src/phases";
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
  ...over });

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
    expect(d.git.addWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1", "main", false, undefined);
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
    expect(d.git.addWorktree).toHaveBeenCalledWith(repoDir, `${repoDir}/.worktrees/run-1`, "main", true, undefined);
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
    expect(d.git.addWorktree).toHaveBeenCalledWith(repoDir, `${repoDir}/.worktrees/run-1`, "main", false, undefined);
    expect(doneNames(events)).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
  });

  // Membangun ulang dari `branchFrom` membuang commit yang sudah di-push run ini, dan push
  // berikutnya ditolak non-fast-forward — run jadi mustahil di-retry. Tip milik run itu
  // sendirilah basis yang benar; `branchFrom` hanya dipakai run yang belum pernah push.
  it("membangun ulang worktree yang hilang di atas headSha run", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-resume-")); // tanpa .worktrees/run-1
    const d = fakeDeps();
    await runOne(input({ repoDir, resume: "sess-1", donePhases: DONE, headSha: "head-lama" }), d, () => {});
    expect(d.git.addWorktree).toHaveBeenCalledWith(repoDir, `${repoDir}/.worktrees/run-1`, "main", false, "head-lama");
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

  // SPEC-160: tak ada lagi gerbang docs-verify. Fast path tetap membuka tepat satu sesi.
  it("does NOT gate Execute and opens exactly one session on the fast path", async () => {
    const { repoDir } = qaTree('{"path":"execute"}');
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
    const events: any[] = [];
    const r = await runOne(input({ repoDir, flow: "qa" }), fakeDeps({ openSession }), (e) => events.push(e));
    expect(r.status).toBe("done");
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

describe("runOne · pertanyaan agen (SPEC-157)", () => {
  const ASK = {
    question: '"Orang" di sini siapa?',
    options: [{ value: "pasien", label: "Pasien" }, { value: "pembayar", label: "Pembayar" }],
    default: "pasien",
  };
  // Worktree nyata + berkas ask yang sudah menunggu sebelum fase pertama selesai.
  const askTree = (ask: unknown = ASK) => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-ask-run-"));
    const wt = join(repoDir, ".worktrees", "run-1");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ASK_FILE), JSON.stringify(ask));
    return { repoDir, wt };
  };

  it("memancarkan ask + awaiting, lalu running lagi setelah dijawab", async () => {
    const { repoDir } = askTree();
    const answers = new SteerQueue();
    answers.push("pembayar"); // jawaban sudah di buffer: run tak pernah benar-benar menunggu
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e), { answers });

    expect(r.status).toBe("done");
    const kinds = events.filter((e) => e.kind === "ask" || e.kind === "status").map((e) =>
      e.kind === "ask" ? (e.ask ? "ask" : "ask:null") : `status:${e.status}`);
    expect(kinds).toEqual(["status:running", "ask", "status:awaiting", "ask:null", "status:running", "status:done"]);
  });

  it("menyuntikkan jawaban manusia ke sesi sebagai satu giliran", async () => {
    const { repoDir } = askTree();
    const s = fakeSession();
    const answers = new SteerQueue(); answers.push("pembayar");
    await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps({ openSession: () => s }), () => {}, { answers });

    expect(s.sent).toHaveLength(2); // prompt fase + jawaban
    expect(s.sent[1]).toContain("Jawaban manusia atas pertanyaanmu");
    expect(s.sent[1]).toContain("Pembayar (pembayar)");
  });

  it("menandai fase done hanya setelah pertanyaan habis", async () => {
    const { repoDir } = askTree();
    const answers = new SteerQueue(); answers.push("pasien");
    const events: any[] = [];
    await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e), { answers });

    const seq = events.filter((e) => e.kind === "ask" || (e.kind === "phase" && e.state === "done"));
    expect(seq[0].kind).toBe("ask");
    expect(seq[seq.length - 1]).toEqual({ kind: "phase", name: "Brainstorm", state: "done" });
  });

  it("agen boleh bertanya lagi setelah dijawab", async () => {
    const { repoDir, wt } = askTree();
    const answers = new SteerQueue(); answers.push("pasien"); answers.push("pembayar");
    const s = fakeSession();
    // Giliran jawaban pertama menuliskan ask kedua.
    const openSession = () => ({
      ...s,
      send(t: string) { s.send(t); if (s.sent.length === 2) writeFileSync(join(wt, ASK_FILE), JSON.stringify(ASK)); },
    });
    const events: any[] = [];
    await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps({ openSession: openSession as never }), (e) => events.push(e), { answers });

    expect(events.filter((e) => e.kind === "ask" && e.ask).length).toBe(2);
  });

  // Abort saat menunggu adalah permintaan berhenti, BUKAN kegagalan.
  it("abort saat menunggu → stopped, bukan failed", async () => {
    const { repoDir } = askTree();
    const abortController = new AbortController();
    const answers = new SteerQueue();
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => {
      events.push(e);
      if (e.kind === "status" && e.status === "awaiting") abortController.abort();
    }, { answers, abortController });

    expect(r.status).toBe("stopped");
    expect(events.some((e) => e.kind === "status" && e.status === "failed")).toBe(false);
    // Pertanyaannya TIDAK dibuang — lihat "abort saat menunggu TIDAK membuang pertanyaannya".
    expect(events.filter((e) => e.kind === "ask").at(-1)).toEqual({ kind: "ask", ask: ASK });
  });

  it("ask yang cacat tidak menghentikan apa pun", async () => {
    const { repoDir } = askTree({ question: "q", options: [{ value: "a", label: "A" }], default: "a" });
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e), { answers: new SteerQueue() });
    expect(r.status).toBe("done");
    expect(events.some((e) => e.kind === "ask")).toBe(false);
  });

  it("menghapus artefak ask sebelum commitAndPush", async () => {
    const { repoDir, wt } = askTree();
    const answers = new SteerQueue(); answers.push("pasien");
    let presentAtCommit: boolean | undefined;
    const d = fakeDeps();
    d.git.commitAndPush = vi.fn(() => { presentAtCommit = existsSync(join(wt, ASK_FILE)); return "head99"; });
    await runOne(input({ repoDir, only: "Brainstorm" }), d, () => {}, { answers });

    expect(presentAtCommit).toBe(false);
    expect(existsSync(join(wt, ASK_FILE))).toBe(false);
  });

  it("timeout memakai pilihan agen dan mencatatnya sebagai ✗", async () => {
    const { repoDir } = askTree();
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e),
      { answers: new SteerQueue(), askTimeoutMs: 10 });

    expect(r.status).toBe("done");
    const miss = events.find((e) => e.kind === "log" && e.line.t === "✗");
    expect(miss.line.s).toContain("tak terjawab");
    expect(miss.line.s).toContain("Pasien"); // label default
  });

  it("timeout menyuntikkan teks yang menolak mengaku sudah dikonfirmasi", async () => {
    const { repoDir } = askTree();
    const s = fakeSession();
    await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps({ openSession: () => s }), () => {},
      { answers: new SteerQueue(), askTimeoutMs: 10 });
    expect(s.sent[1]).toContain("memakai pilihanmu sendiri");
    expect(s.sent[1]).not.toContain("Jawaban manusia");
  });

  // askTimeoutMin: 0 → batch tak berpenunggu. Tak pernah `awaiting`, tak pernah menahan slot.
  it("askTimeoutMs 0 langsung memakai default tanpa pernah masuk awaiting", async () => {
    const { repoDir } = askTree();
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => events.push(e),
      { answers: new SteerQueue(), askTimeoutMs: 0 });

    expect(r.status).toBe("done");
    expect(events.some((e) => e.kind === "status" && e.status === "awaiting")).toBe(false);
    expect(events.some((e) => e.kind === "log" && e.line.t === "✗" && e.line.s.includes("tanpa penunggu"))).toBe(true);
  });

  // Bug nyata, ditemukan saat RUN-90012 dijalankan sungguhan. Abort saat awaiting dulu
  // memancarkan `ask:null`, jadi pertanyaannya hilang dari baris Run. Retry me-resume sesi yang
  // konteksnya masih memuat pertanyaan agen sendiri, prompt fase berikutnya terbaca seperti
  // "lanjut saja", dan agen memakai default-nya lalu MELAPORKANNYA sebagai keputusan yang sah.
  it("abort saat menunggu TIDAK membuang pertanyaannya", async () => {
    const { repoDir } = askTree();
    const abortController = new AbortController();
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps(), (e) => {
      events.push(e);
      if (e.kind === "status" && e.status === "awaiting") abortController.abort();
    }, { answers: new SteerQueue(), abortController });

    expect(r.status).toBe("stopped");
    // Pertanyaan tetap tersimpan: `ask:null` tidak boleh pernah dipancarkan di jalur abort.
    expect(events.filter((e) => e.kind === "ask" && e.ask === null)).toEqual([]);
    expect(events.filter((e) => e.kind === "ask" && e.ask).length).toBe(1);
  });

  it("percobaan berikutnya menanyakan ULANG pertanyaan yang terbawa, sebelum giliran fase apa pun", async () => {
    const { repoDir } = askTree();
    rmSync(join(repoDir, ".worktrees", "run-1", ASK_FILE)); // agen tak menulis ulang; ask ada di baris Run
    const s = fakeSession();
    const answers = new SteerQueue(); answers.push("pembayar");
    const events: any[] = [];
    await runOne(input({ repoDir, only: "Brainstorm", resume: "sess-1", donePhases: [], pendingAsk: ASK }),
      fakeDeps({ openSession: () => s }), (e) => events.push(e), { answers });

    const kinds = events.filter((e) => e.kind === "ask" || e.kind === "status").map((e) =>
      e.kind === "ask" ? (e.ask ? "ask" : "ask:null") : `status:${e.status}`);
    expect(kinds.slice(0, 4)).toEqual(["status:running", "ask", "status:awaiting", "ask:null"]);
    // Jawaban mendahului prompt fase: agen menerima keputusannya sebelum diminta bekerja lagi.
    expect(s.sent[0]).toContain("Jawaban manusia atas pertanyaanmu");
    expect(s.sent[0]).toContain("Pembayar");
    expect(s.sent[1]).toContain("fase Brainstorm");
  });

  // Worktree hilang → sesi tak di-resume, konteks pertanyaannya ikut hilang. Ask-nya basi.
  it("membuang ask terbawa kalau worktree-nya sudah tidak ada", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-ask-gone-"));
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm", resume: "sess-1", pendingAsk: ASK }),
      fakeDeps(), (e) => events.push(e), { answers: new SteerQueue() });

    expect(r.status).toBe("done");
    expect(events.some((e) => e.kind === "status" && e.status === "awaiting")).toBe(false);
    expect(events.filter((e) => e.kind === "ask")).toEqual([{ kind: "ask", ask: null }]);
  });

  it("berhenti bertanya setelah 5 pertanyaan dalam satu fase", async () => {
    const { repoDir, wt } = askTree();
    const answers = new SteerQueue();
    for (let i = 0; i < 10; i++) answers.push("pasien");
    const s = fakeSession();
    // Setiap giliran jawaban menuliskan ask baru — agen yang tak pernah berhenti bertanya.
    const openSession = () => ({ ...s, send(t: string) { s.send(t); writeFileSync(join(wt, ASK_FILE), JSON.stringify(ASK)); } });
    const events: any[] = [];
    const r = await runOne(input({ repoDir, only: "Brainstorm" }), fakeDeps({ openSession: openSession as never }), (e) => events.push(e), { answers });

    expect(r.status).toBe("done");
    expect(events.filter((e) => e.kind === "ask" && e.ask).length).toBe(MAX_ASKS_PER_PHASE);
    expect(events.some((e) => e.kind === "log" && e.line.t === "✗" && e.line.s.includes("batas"))).toBe(true);
  });
});
