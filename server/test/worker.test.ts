import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb, makeProject, makeRun, makeSetting, makeSpec } from "./factory";
import { prisma } from "../src/db";
import { runProcessor } from "../src/worker";
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

  it("fails the run when its backlog item no longer exists", async () => {
    await makeRun({ id: "RUN-3", specId: "SPEC-gone", status: "running" });
    const steps = await (await import("../src/services/settings")).stepModels();
    await expect(runProcessor({ data: { runId: "RUN-3", specId: "SPEC-gone", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, fakeDeps)).rejects.toThrow();
  });
});
