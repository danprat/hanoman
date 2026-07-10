import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb, makeProject, makeRun, makeSetting, makeSpec } from "./factory";
import { prisma } from "../src/db";
import { publisher } from "../src/redis";
import { runProcessor, reconcileRuns } from "../src/worker";
import type { ClaudeSession, RunDeps, CliMessage } from "@hanoman/runner";

const result = (): CliMessage => ({ type: "result", subtype: "success", session_id: "s",
  total_cost_usd: 0.2, usage: { input_tokens: 9, output_tokens: 3 } });

// Satu `result` per `send`, seperti binary aslinya. `sent` merekam tiap giliran.
function fakeSession(sent: string[] = []): ClaudeSession {
  const queue: CliMessage[] = [];
  return {
    send(t) { sent.push(t); queue.push(result()); },
    async next() { return queue.shift() ?? null; },
    close() { /* empty */ }, kill() { /* empty */ },
  };
}

const fakeDeps: RunDeps = {
  openSession: () => fakeSession(),
  git: { addWorktree: () => "base00", removeWorktree() {}, commitAndPush: () => "head99", switchBase() {} },
  verify: () => ({ blocked: false }),
};

describe("worker processor", () => {
  beforeAll(async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await makeSetting();
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
  });
  it("runs a job and persists final status", async () => {
    const steps = await (await import("../src/services/settings")).stepModels();
    await runProcessor({ data: { runId: "RUN-1", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, fakeDeps);
    expect((await prisma.run.findUnique({ where: { id: "RUN-1" } }))?.status).toBe("done");
  });

  // A run queued for SPEC-n must carry that backlog item's content into every
  // phase prompt. Setiap fase kini sebuah giliran di sesi yang sama; giliran
  // `/model`/`/effort` bukan prompt fase, jadi disaring.
  it("feeds the backlog item into every phase prompt", async () => {
    await makeSpec({ id: "SPEC-9", title: "Ekspor CSV", objective: "user bisa unduh laporan", payload: { outcome: "unduh laporan" } });
    await makeRun({ id: "RUN-2", specId: "SPEC-9", status: "running" });
    const sent: string[] = [];
    const deps: RunDeps = { ...fakeDeps, openSession: () => fakeSession(sent) };
    const steps = await (await import("../src/services/settings")).stepModels();
    await runProcessor({ data: { runId: "RUN-2", specId: "SPEC-9", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, deps);
    const prompts = sent.filter((s) => !s.startsWith("/"));
    expect(prompts).toHaveLength(5); // Brainstorm → Execute
    for (const p of prompts) {
      expect(p).toContain("SPEC-9");
      expect(p).toContain("Ekspor CSV");
      expect(p).toContain("user bisa unduh laporan");
    }
  });

  // ADR-0017. `resume`/`retry` mengantre ulang runId yang sama; sesi claude dan fase yang
  // sudah selesai dibaca worker dari baris Run, bukan dari payload job (payload itu dibuat
  // saat enqueue, sebelum fase terakhir sempat rampung).
  it("continues an interrupted run from its own session, replaying no finished phase", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-w-"));
    mkdirSync(join(repoDir, ".worktrees", "run-4"), { recursive: true }); // artefak fase lalu
    // Default factory: Brainstorm→Plan done, Execute belum.
    await makeRun({ id: "RUN-4", projectId: "p1", status: "queued", sessionId: "sess-lama" });

    const sent: string[] = [];
    let opts: { resume?: string } | undefined;
    const deps: RunDeps = { ...fakeDeps, openSession: (o) => { opts = o; return fakeSession(sent); } };
    const steps = await (await import("../src/services/settings")).stepModels();
    await runProcessor({ data: { runId: "RUN-4", repoDir, branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, deps);

    expect(opts?.resume).toBe("sess-lama");
    const prompts = sent.filter((s) => !s.startsWith("/"));
    expect(prompts).toHaveLength(1);           // hanya Execute, bukan kelima fase
    expect(prompts[0]).toContain("fase Execute");
    expect((await prisma.run.findUnique({ where: { id: "RUN-4" } }))?.status).toBe("done");
  });

  // SPEC-145: run qa jalur cepat yang terputus di Execute tidak boleh menjalankan ulang
  // Spec & Plan yang sudah dipangkas keputusan audit. `donePhases` = selesai ATAU skipped.
  it("resumes a fast-tracked qa run without re-running the pruned phases", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-w-"));
    mkdirSync(join(repoDir, ".worktrees", "run-5"), { recursive: true });
    await makeRun({ id: "RUN-5", projectId: "p1", kind: "qa", status: "queued", sessionId: "sess-qa",
      phases: [
        { name: "Audit", state: "done" }, { name: "Spec", state: "skipped" },
        { name: "Plan", state: "skipped" }, { name: "Execute", state: "active" },
      ] as any });

    const sent: string[] = [];
    const deps: RunDeps = { ...fakeDeps, openSession: () => fakeSession(sent) };
    const steps = await (await import("../src/services/settings")).stepModels();
    await runProcessor({ data: { runId: "RUN-5", repoDir, branchFrom: "main", branchTo: "feat/x", flow: "qa", steps } } as any, deps);

    const prompts = sent.filter((s) => !s.startsWith("/"));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("fase Execute");
    expect((await prisma.run.findUnique({ where: { id: "RUN-5" } }))?.status).toBe("done");
  });

  it("fails the run when its backlog item no longer exists", async () => {
    await makeRun({ id: "RUN-3", specId: "SPEC-gone", status: "running" });
    const steps = await (await import("../src/services/settings")).stepModels();
    await expect(runProcessor({ data: { runId: "RUN-3", specId: "SPEC-gone", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, fakeDeps)).rejects.toThrow();
  });

  // Tip yang pernah di-push run ini hidup di baris Run, bukan di payload job (payload dibuat
  // saat enqueue, sebelum push terjadi). Runner memakainya sebagai basis saat membangun ulang
  // worktree yang hilang, supaya push berikutnya fast-forward.
  it("meneruskan headSha baris Run ke runner", async () => {
    await makeRun({ id: "RUN-6", projectId: "p1", status: "queued", sessionId: "sess-6", headSha: "head-terpush" });
    let base: string | undefined = "belum dipanggil";
    const deps: RunDeps = { ...fakeDeps,
      git: { ...fakeDeps.git, addWorktree: (_r, _p, _b, _reuse, headSha) => { base = headSha; return "base00"; } } };
    const steps = await (await import("../src/services/settings")).stepModels();
    await runProcessor({ data: { runId: "RUN-6", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, deps);
    expect(base).toBe("head-terpush");
  });

  // Satu-satunya penangan lemparan runOne dulu `worker.on("failed") → markFailed`, yang menulis
  // status tanpa alasan. Push yang ditolak, guardrail yang error, worktree yang hilang: semuanya
  // mendarat sebagai run `failed` berlog kosong, dan di UI tombol Retry terlihat tak berfungsi.
  it("mencatat lemparan runOne sebagai baris log sebelum melempar ulang", async () => {
    await makeRun({ id: "RUN-7", projectId: "p1", status: "queued" });
    const deps: RunDeps = { ...fakeDeps,
      git: { ...fakeDeps.git, commitAndPush: () => { throw new Error("git push failed: ! [rejected] (non-fast-forward)"); } } };
    const steps = await (await import("../src/services/settings")).stepModels();
    await expect(runProcessor({ data: { runId: "RUN-7", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, deps)).rejects.toThrow(/non-fast-forward/);

    const log = (await prisma.run.findUniqueOrThrow({ where: { id: "RUN-7" } })).log as { t: string; s: string }[];
    expect(log.at(-1)).toEqual({ t: "✗", s: expect.stringContaining("non-fast-forward") });
  });
});

// Worker mati / Redis di-restart di tengah run: tak ada lagi `on("failed")` yang menulis
// status terminal, dan barisnya tersangkut `running` selamanya. Boot berikutnya yang
// membereskannya.
describe("reconcileRuns", () => {
  beforeAll(async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await makeRun({ id: "RUN-20", projectId: "p1", status: "running" });  // yatim: job hilang
    await makeRun({ id: "RUN-21", projectId: "p1", status: "queued" });   // jobnya masih ada
    await makeRun({ id: "RUN-22", projectId: "p1", status: "done" });     // sudah terminal
  });

  it("fails only the non-terminal runs whose job is gone", async () => {
    const queue = { getJob: async (id: string) => (id === "RUN-21" ? { id } : undefined) };
    expect(await reconcileRuns(queue)).toEqual(["RUN-20"]);

    const rows = Object.fromEntries((await prisma.run.findMany({ select: { id: true, status: true, finishedAt: true } }))
      .map((r) => [r.id, r]));
    expect(rows["RUN-20"]!.status).toBe("failed");
    expect(rows["RUN-20"]!.finishedAt).not.toBeNull();
    expect(rows["RUN-21"]!.status).toBe("queued");  // worker lain masih memegangnya
    expect(rows["RUN-22"]!.status).toBe("done");
  });

  it("is idempotent — a second boot finds nothing left to reconcile", async () => {
    expect(await reconcileRuns({ getJob: async () => undefined })).toEqual(["RUN-21"]);
    expect(await reconcileRuns({ getJob: async () => undefined })).toEqual([]);
  });

  // `awaiting` (SPEC-157) = proses claude hidup, terblokir menunggu jawaban. Worker mati saat
  // itu → tak ada lagi yang bisa menerima jawabannya. Yatim, persis seperti `running`.
  it("menandai run awaiting yatim sebagai failed", async () => {
    await makeRun({ id: "RUN-23", projectId: "p1", status: "awaiting" });
    expect(await reconcileRuns({ getJob: async () => undefined })).toEqual(["RUN-23"]);
    expect((await prisma.run.findUnique({ where: { id: "RUN-23" } }))?.status).toBe("failed");
  });
});

// Jalur nyata: run betulan, worktree betulan berisi ASK_FILE, jawaban betulan lewat Redis.
describe("worker · jawaban atas pertanyaan agen (SPEC-157)", () => {
  const ASK = { question: "q", options: [{ value: "pasien", label: "Pasien" }, { value: "pembayar", label: "Pembayar" }], default: "pasien" };

  // Worktree tempat runOne membaca ASK_FILE: `${repoDir}/.worktrees/${runId.toLowerCase()}`.
  const askRepo = (runId: string) => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-worker-ask-"));
    const wt = join(repoDir, ".worktrees", runId.toLowerCase());
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".hanoman-ask.json"), JSON.stringify(ASK));
    return repoDir;
  };
  const job = (runId: string, repoDir: string, steps: unknown) =>
    ({ data: { runId, repoDir, branchFrom: "main", branchTo: "x", flow: "feature", only: "Brainstorm", steps } }) as never;

  it("pesan answer melanjutkan run dan tidak menyisakan pendingAsk", async () => {
    await resetDb(); await makeProject({ id: "p1" }); await makeSetting({ askTimeoutMin: 30 });
    await makeRun({ id: "RUN-ASK", projectId: "p1", status: "queued" });
    const repoDir = askRepo("RUN-ASK");
    const steps = await (await import("../src/services/settings")).stepModels();

    // Diterbitkan berulang: runProcessor baru subscribe setelah beberapa await, dan pub/sub
    // Redis tidak punya replay. Buffer SteerQueue menyerap yang tiba lebih awal.
    const pub = publisher();
    const beat = setInterval(() => void pub.publish("run:RUN-ASK:control", JSON.stringify({ type: "answer", value: "pembayar" })), 20);
    try { await runProcessor(job("RUN-ASK", repoDir, steps), fakeDeps); }
    finally { clearInterval(beat); await pub.quit(); }

    const row = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-ASK" } });
    expect(row.status).toBe("done");
    expect(row.pendingAsk).toBeNull();
    expect((row.log as { t: string; s: string }[]).some((l) => l.t === "»" && l.s.includes("Pembayar"))).toBe(true);
  });

  // Antrian terpisah: steer menjadi giliran EKSTRA setelah fase, bukan jawaban.
  it("pesan steer tidak menjawab pertanyaan — ia menjadi giliran tersendiri", async () => {
    await resetDb(); await makeProject({ id: "p1" }); await makeSetting({ askTimeoutMin: 30 });
    await makeRun({ id: "RUN-ASK2", projectId: "p1", status: "queued" });
    const repoDir = askRepo("RUN-ASK2");
    const steps = await (await import("../src/services/settings")).stepModels();
    const sent: string[] = [];
    const deps: RunDeps = { ...fakeDeps, openSession: () => fakeSession(sent) };

    // Keduanya di detak yang sama: pub/sub Redis tak punya replay, jadi sekali-terbit sebelum
    // runProcessor sempat subscribe akan hilang begitu saja. `steer` mendahului `answer` tiap
    // detak, sehingga saat blokir ask terbuka, steer-nya sudah pasti mengantre.
    const pub = publisher();
    const beat = setInterval(() => {
      void pub.publish("run:RUN-ASK2:control", JSON.stringify({ type: "steer", message: "halo" }));
      void pub.publish("run:RUN-ASK2:control", JSON.stringify({ type: "answer", value: "pembayar" }));
    }, 20);
    try { await runProcessor(job("RUN-ASK2", repoDir, steps), deps); }
    finally { clearInterval(beat); await pub.quit(); }

    // [0] prompt fase · [1] jawaban — yang membuka blokir · [2..] steer, dikuras setelah fase.
    // Kalau steer ikut menjawab, ia akan mendarat di [1] dan assertion pertama roboh.
    expect(sent[1]).toContain("Jawaban manusia atas pertanyaanmu");
    expect(sent[1]).toContain("Pembayar");
    expect(sent.indexOf("halo")).toBeGreaterThan(1);
    expect(sent.slice(2).every((s) => s === "halo")).toBe(true);
  });
});

// Regresi dari RUN-90012 sungguhan: run yang di-stop saat awaiting lalu di-retry harus
// MENANYAKAN ULANG, bukan membiarkan agen membaca prompt fase sebagai izin melanjutkan.
describe("worker · pertanyaan terbawa dari percobaan sebelumnya (SPEC-157)", () => {
  const ASK = { question: "q", options: [{ value: "pasien", label: "Pasien" }, { value: "pembayar", label: "Pembayar" }], default: "pasien" };

  it("menanyakan ulang pendingAsk sebelum prompt fase, lalu mengosongkannya", async () => {
    await resetDb(); await makeProject({ id: "p1" }); await makeSetting({ askTimeoutMin: 30 });
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-carry-"));
    mkdirSync(join(repoDir, ".worktrees", "run-carry"), { recursive: true }); // worktree ada → sesi di-resume
    await makeRun({ id: "RUN-CARRY", projectId: "p1", status: "queued", sessionId: "sess-lama",
      pendingAsk: ASK as never,
      phases: [{ name: "Brainstorm", state: "active" }, { name: "Objective", state: "done" },
        { name: "Spec", state: "done" }, { name: "Plan", state: "done" }, { name: "Execute", state: "done" }] as never });

    const sent: string[] = [];
    const deps: RunDeps = { ...fakeDeps, openSession: () => fakeSession(sent) };
    const steps = await (await import("../src/services/settings")).stepModels();

    const pub = publisher();
    const beat = setInterval(() => void pub.publish("run:RUN-CARRY:control", JSON.stringify({ type: "answer", value: "pembayar" })), 20);
    try {
      await runProcessor({ data: { runId: "RUN-CARRY", repoDir, branchFrom: "main", branchTo: "x", flow: "feature", steps } } as never, deps);
    } finally { clearInterval(beat); await pub.quit(); }

    const prompts = sent.filter((s) => !s.startsWith("/"));
    expect(prompts[0]).toContain("Jawaban manusia atas pertanyaanmu"); // jawaban MENDAHULUI prompt fase
    expect(prompts[0]).toContain("Pembayar");
    expect(prompts[1]).toContain("fase Brainstorm");

    const row = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-CARRY" } });
    expect(row.pendingAsk).toBeNull();
    expect(row.status).toBe("done");
  });
});
