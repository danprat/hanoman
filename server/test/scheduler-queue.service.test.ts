import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueue, listQueue, queued, markLaunched, markFailed, queueItemForSpec } from "../src/services/scheduler/queue";

const clean = () => prisma.schedulerQueueItem.deleteMany();
beforeEach(clean); afterAll(clean);

describe("scheduler queue", () => {
  it("enqueue is idempotent on specId (no duplicate rows)", async () => {
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "sedang" });
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "sedang" });
    expect((await listQueue()).length).toBe(1);
  });
  it("is durable: rows persist and re-read from DB", async () => {
    await enqueue({ specId: "SPEC-2", projectId: "p1", source: "errors", priority: "tinggi" });
    const again = await prisma.schedulerQueueItem.findUnique({ where: { specId: "SPEC-2" } });
    expect(again!.status).toBe("queued");
  });
  it("queued() orders by priority tinggi→sedang→rendah then FIFO", async () => {
    await enqueue({ specId: "SPEC-lo", projectId: "p1", source: "backlog", priority: "rendah" });
    await enqueue({ specId: "SPEC-hi", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-md", projectId: "p1", source: "backlog", priority: "sedang" });
    expect((await queued()).map((q) => q.specId)).toEqual(["SPEC-hi", "SPEC-md", "SPEC-lo"]);
  });
  it("markLaunched / markFailed move the item out of queued()", async () => {
    await enqueue({ specId: "SPEC-3", projectId: "p1", source: "triase", priority: "sedang" });
    const it0 = (await listQueue())[0]!;
    await markLaunched(it0.id, "spec_3");
    expect((await queued()).length).toBe(0);
    expect((await queueItemForSpec("SPEC-3"))!.status).toBe("launched");
    expect((await queueItemForSpec("SPEC-3"))!.sessionId).toBe("spec_3");
    // failed juga keluar dari queued()
    await enqueue({ specId: "SPEC-4", projectId: "p1", source: "backlog", priority: "sedang" });
    const it1 = (await listQueue()).find((x) => x.specId === "SPEC-4")!;
    await markFailed(it1.id, "needs-bind");
    expect((await queueItemForSpec("SPEC-4"))!.status).toBe("failed");
    expect((await queueItemForSpec("SPEC-4"))!.note).toBe("needs-bind");
  });
});
