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

  // A second job for a live run means a second runOne, and addWorktree force-recreates
  // the shared .worktrees/<id> path — one run must never own two worktrees.
  it("refuses to re-enqueue a run that is still queued/running", async () => {
    const r = await enqueueRun(input);                               // RUN-9001 is still "queued"
    expect(r.enqueued).toBe(false);
    expect(r.reason).toMatch(/masih queued/);
    await prisma.run.update({ where: { id: "RUN-9001" }, data: { status: "running" } });
    expect((await enqueueRun(input)).reason).toMatch(/masih running/);
  });

  it("keeps exactly one job per runId, and a retry reuses that id", async () => {
    await prisma.run.update({ where: { id: "RUN-9001" }, data: { status: "failed" } });
    expect((await enqueueRun(input)).enqueued).toBe(true);            // retry: id was freed
    const jobs = await runsQueue.getJobs(["waiting", "delayed", "active", "failed"]);
    expect(jobs.filter((j) => j.id === "RUN-9001")).toHaveLength(1);
  });

  // `${repoDir}/.worktrees/<id>` must not depend on who enqueued: the api and the worker
  // run from different cwds, so a relative/absent repoDir means two worktrees for one run.
  it("refuses a project with no absolute repoDir", async () => {
    for (const repoDir of ["", "relative/path"]) {
      const r = await enqueueRun({ ...input, runId: "RUN-9004", repoDir });
      expect(r.enqueued).toBe(false);
      expect(r.reason).toMatch(/repoDir absolut/);
    }
  });

  it("still refuses a run with no resolvable project", async () => {
    const r = await enqueueRun({ ...input, runId: "RUN-9003", projectId: undefined, specId: undefined });
    expect(r.enqueued).toBe(false);
    expect(r.reason).toMatch(/projectId/);
  });
});
