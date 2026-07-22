import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { checkBacklog, registerBacklogSource } from "../src/services/scheduler/sources/backlog";
import { listQueue, queued } from "../src/services/scheduler/queue";
import { listSources, clearSources } from "../src/services/scheduler/registry";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const mkProject = (id: string, schedulerOptIn: boolean) =>
  prisma.project.create({ data: { id, name: id, desc: "", kind: "existing", schedulerOptIn } });
const mkSpec = (id: string, projectId: string, priority: string, baseSha: string | null = null) =>
  prisma.spec.create({ data: {
    id, projectId, title: id, source: "brief", stage: "brainstorming",
    priority, author: "test", objective: "o", baseSha,
  } });

describe("backlog source-checker", () => {
  it("enqueues baseSha=null specs only from opt-in projects", async () => {
    await mkProject("opt", true);
    await mkProject("noopt", false);
    await mkSpec("SPEC-A", "opt", "sedang");
    await mkSpec("SPEC-B", "noopt", "tinggi");   // non-opt-in → must be untouched
    await checkBacklog();
    const q = await listQueue();
    expect(q.map((x) => x.specId)).toEqual(["SPEC-A"]);
    expect(q[0]!.source).toBe("backlog");        // queue item source = checker id
    expect(q[0]!.priority).toBe("sedang");
    expect(q[0]!.status).toBe("queued");
  });

  it("orders candidates tinggi→sedang→rendah", async () => {
    await mkProject("opt", true);
    await mkSpec("SPEC-lo", "opt", "rendah");
    await mkSpec("SPEC-hi", "opt", "tinggi");
    await mkSpec("SPEC-md", "opt", "sedang");
    await checkBacklog();
    expect((await queued()).map((x) => x.specId)).toEqual(["SPEC-hi", "SPEC-md", "SPEC-lo"]);
  });

  it("skips specs already started (baseSha set)", async () => {
    await mkProject("opt", true);
    await mkSpec("SPEC-started", "opt", "tinggi", "abc123");
    await mkSpec("SPEC-fresh", "opt", "sedang");
    await checkBacklog();
    expect((await listQueue()).map((x) => x.specId)).toEqual(["SPEC-fresh"]);
  });

  it("is idempotent: double check → one row per spec; a launched item is not resurrected", async () => {
    await mkProject("opt", true);
    await mkSpec("SPEC-A", "opt", "tinggi");
    await checkBacklog();
    await checkBacklog();
    expect((await listQueue()).length).toBe(1);
    const row = (await listQueue())[0]!;
    await prisma.schedulerQueueItem.update({ where: { id: row.id }, data: { status: "launched", sessionId: "s1" } });
    await checkBacklog();                          // spec still baseSha=null, but item exists
    const after = await listQueue();
    expect(after.length).toBe(1);
    expect(after[0]!.status).toBe("launched");     // upsert update:{} → not reset to queued
  });

  it("registerBacklogSource registers a source with id 'backlog'", () => {
    registerBacklogSource();
    expect(listSources().map((s) => s.id)).toContain("backlog");
  });
});
