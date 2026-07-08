import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb, makeProject, makeSetting } from "./factory";
import { prisma } from "../src/db";
import { enqueueRun, todaySpendUsd, runsQueue } from "../src/queue";
import type { RunInput } from "@hanoman/runner";

const input: RunInput = {
  runId: "RUN-9001", projectId: "p1", repoDir: "/tmp/x",
  branchFrom: "main", branchTo: "feat/x", flow: "feature", steps: {} as any,
};

describe("queue", () => {
  beforeAll(async () => { await resetDb(); await makeProject({ id: "p1" }); await makeSetting(); });
  // These tests add real jobs to Redis; obliterate so a running worker (or the
  // next test run) doesn't later consume orphaned jobs whose rows were reset.
  afterAll(async () => { await runsQueue.obliterate({ force: true }); await runsQueue.close(); });

  it("enqueues below budget", async () => {
    expect(await todaySpendUsd()).toBeLessThan(50); // fresh DB: no spend
    const r = await enqueueRun(input);
    expect(r.enqueued).toBe(true);
    expect((await prisma.run.findUnique({ where: { id: "RUN-9001" } }))?.status).toBe("queued");
  });

  it("rejects when today's spend >= dailyBudget", async () => {
    const s = await prisma.setting.findUniqueOrThrow({ where: { id: 1 } });
    await prisma.setting.update({ where: { id: 1 }, data: { data: { ...(s.data as any), dailyBudget: 0 } } });
    const r = await enqueueRun({ ...input, runId: "RUN-9002" });
    expect(r.enqueued).toBe(false);
    expect(r.reason).toMatch(/budget/i);
  });
});
