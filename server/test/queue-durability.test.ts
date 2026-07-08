import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Worker } from "bullmq";
import { seed } from "../prisma/seed";
import { prisma } from "../src/db";
import { markFailed } from "../src/worker";
import { runsQueue, RUNS_QUEUE } from "../src/queue";
import { bullConnection } from "../src/redis";

describe("stall recovery", () => {
  beforeAll(async () => { await seed(); });
  it("marks a run failed on stall", async () => {
    await markFailed("RUN-8830"); // seeded as "queued"
    expect((await prisma.run.findUnique({ where: { id: "RUN-8830" } }))?.status).toBe("failed");
  });
});

describe("concurrency", () => {
  afterAll(async () => { await runsQueue.obliterate({ force: true }); await runsQueue.close(); });
  it("honors concurrency 1 — the second job starts only after the first finishes", async () => {
    await runsQueue.obliterate({ force: true });
    let active = 0, maxActive = 0, done = 0;
    const worker = new Worker(RUNS_QUEUE, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 80));
      active--; done++;
    }, { connection: bullConnection, concurrency: 1 });
    await runsQueue.add("c1", {}, { removeOnComplete: true });
    await runsQueue.add("c2", {}, { removeOnComplete: true });
    await new Promise<void>((res) => {
      const t = setInterval(() => { if (done >= 2) { clearInterval(t); res(); } }, 20);
    });
    await worker.close();
    expect(maxActive).toBe(1); // never two in flight at once
  });
});
