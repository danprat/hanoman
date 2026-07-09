import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb, makeProject, makeSetting } from "./factory";
import { prisma } from "../src/db";
import { enqueueRun, runsQueue, phasesForFlow } from "../src/queue";
import type { RunInput } from "@hanoman/runner";

describe("phasesForFlow (SPEC-010, pure)", () => {
  it("seeds the full feature pipeline as pending", () => {
    expect(phasesForFlow("feature")).toEqual([
      { name: "Brainstorm", state: "pending" }, { name: "Objective", state: "pending" },
      { name: "Spec", state: "pending" }, { name: "Plan", state: "pending" },
      { name: "Execute", state: "pending" },
    ]);
  });
  it("seeds only the single phase for an only-run", () => {
    expect(phasesForFlow("feature", "Spec")).toEqual([{ name: "Spec", state: "pending" }]);
  });
});

const input: RunInput = {
  runId: "RUN-9001", projectId: "p1", repoDir: "/tmp/x",
  branchFrom: "main", branchTo: "feat/x", flow: "feature", steps: {} as any,
};

describe("queue", () => {
  beforeAll(async () => { await resetDb(); await makeProject({ id: "p1" }); await makeSetting(); });
  // These tests add real jobs to Redis; obliterate so a running worker (or the
  // next test run) doesn't later consume orphaned jobs whose rows were reset.
  afterAll(async () => { await runsQueue.obliterate({ force: true }); await runsQueue.close(); });

  it("enqueues and seeds a queued run row", async () => {
    const r = await enqueueRun(input);
    expect(r.enqueued).toBe(true);
    expect((await prisma.run.findUnique({ where: { id: "RUN-9001" } }))?.status).toBe("queued");
  });

  // ADR-0012: cost is an estimate, not a brake. Prior spend must never block an enqueue.
  it("enqueues regardless of prior spend", async () => {
    await prisma.run.update({ where: { id: "RUN-9001" }, data: { cost: "~$9999.00" } });
    const r = await enqueueRun({ ...input, runId: "RUN-9002" });
    expect(r.enqueued).toBe(true);
  });

  it("still refuses a run with no resolvable project", async () => {
    const r = await enqueueRun({ ...input, runId: "RUN-9003", projectId: undefined, specId: undefined });
    expect(r.enqueued).toBe(false);
    expect(r.reason).toMatch(/projectId/);
  });
});
