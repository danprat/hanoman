import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb, makeProject, makeRun, makeSetting, makeSpec } from "./factory";
import { prisma } from "../src/db";
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
  git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} },
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
});
