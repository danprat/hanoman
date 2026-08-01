import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueue, markLaunched, queueItemForSpec } from "../src/services/scheduler/queue";
import { reconcile, type ReconcileDeps, type ReconcilePane } from "../src/services/scheduler/reconcile";
import type { Stage } from "@hanoman/shared";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.sessionResult.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

// Seed satu Project + Spec + item antrean status launched (sessionId di-set).
async function seedLaunched(specId: string, stage: Stage) {
  await prisma.project.upsert({ where: { id: "p1" }, update: {}, create: { id: "p1", name: "P1", desc: "", kind: "existing" } });
  await prisma.spec.create({ data: { id: specId, projectId: "p1", title: `T ${specId}`, source: "brief", stage, author: "a", priority: "sedang", objective: "", baseSha: "base0" } });
  await enqueue({ specId, projectId: "p1", source: "backlog", priority: "sedang" });
  const item = await queueItemForSpec(specId);
  await markLaunched(item!.id, specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_"));
}

const deps = (over: Partial<ReconcileDeps> = {}): ReconcileDeps => ({
  pane: () => ({ exited: false, flow: "feature", phaseFile: "/tmp/pf", cwd: "/tmp/wt" }) as ReconcilePane,
  deriveStage: () => "executing" as Stage,
  headSha: () => "head0",
  ...over,
});

describe("reconcile", () => {
  it("done: markDone + notif done + satu SessionResult(done); tick kedua tak dobel", async () => {
    await seedLaunched("SPEC-100", "executing");
    const d = deps({ deriveStage: () => "done" as Stage });
    await reconcile(d);
    await reconcile(d);   // item sudah done → tak diproses lagi
    expect((await queueItemForSpec("SPEC-100"))!.status).toBe("done");
    expect(await prisma.notification.count({ where: { specId: "SPEC-100", type: "done" } })).toBe(1);
    const results = await prisma.sessionResult.findMany({ where: { specId: "SPEC-100", newStage: "done" } });
    expect(results).toHaveLength(1);
    expect(results[0]!.commitSha).toBe("head0");
    expect(results[0]!.branch).toBe("hanoman/spec-100");
  });

  it("done mem-persist spec.stage=done (independen pengawas)", async () => {
    await seedLaunched("SPEC-101", "executing");
    await reconcile(deps({ deriveStage: () => "done" as Stage }));
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-101" } }))!.stage).toBe("done");
  });

  it("pane mati sebelum done: markFailed(note) + notif fail; tanpa SessionResult; tanpa retry", async () => {
    await seedLaunched("SPEC-102", "executing");
    await reconcile(deps({ pane: () => ({ exited: true, flow: "feature", phaseFile: "/tmp/pf", cwd: "/tmp/wt" }), deriveStage: () => "executing" as Stage }));
    const item = await queueItemForSpec("SPEC-102");
    expect(item!.status).toBe("failed");
    expect(item!.note).toBeTruthy();
    expect(await prisma.notification.count({ where: { specId: "SPEC-102", type: "fail" } })).toBe(1);
    expect(await prisma.sessionResult.count({ where: { specId: "SPEC-102" } })).toBe(0);
  });

  it("pane hidup & stage < done: tetap launched, tanpa notif", async () => {
    await seedLaunched("SPEC-103", "executing");
    await reconcile(deps({ deriveStage: () => "executing" as Stage }));
    expect((await queueItemForSpec("SPEC-103"))!.status).toBe("launched");
    expect(await prisma.notification.count({ where: { specId: "SPEC-103" } })).toBe(0);
  });

  it("pane gone (undefined) & stage < done: failed", async () => {
    await seedLaunched("SPEC-104", "executing");
    await reconcile(deps({ pane: () => undefined }));
    expect((await queueItemForSpec("SPEC-104"))!.status).toBe("failed");
    expect(await prisma.notification.count({ where: { specId: "SPEC-104", type: "fail" } })).toBe(1);
  });

  // SPEC-475 · reconcile adalah satu-satunya jalur andal yang menyelesaikan sesi scheduler, dan
  // sampai audit ini ia menghitung HEAD worktree untuk SessionResult lalu MEMBUANGNYA — sehingga
  // `Spec.headSha` tetap null dan gerbang dependency ADR-0093 kehilangan buktinya.
  it("done merekam ujung kerja ke Spec.headSha, bukan cuma ke SessionResult", async () => {
    await seedLaunched("SPEC-106", "executing");
    await reconcile(deps({ deriveStage: () => "done" as Stage, headSha: () => "tip106" }));
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-106" } }))!.headSha).toBe("tip106");
  });

  it("HEAD tak terbaca saat done → headSha lama tak ditimpa null", async () => {
    await seedLaunched("SPEC-107", "executing");
    await prisma.spec.update({ where: { id: "SPEC-107" }, data: { headSha: "lama107" } });
    await reconcile(deps({ deriveStage: () => "done" as Stage, headSha: () => null }));
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-107" } }))!.headSha).toBe("lama107");
  });

  it("dedup ringkasan: SessionResult(done) sudah ada → tak buat kedua", async () => {
    await seedLaunched("SPEC-105", "executing");
    await prisma.sessionResult.create({ data: { id: "pre-105", projectId: "p1", specId: "SPEC-105", newStage: "done", status: "done" } });
    await reconcile(deps({ deriveStage: () => "done" as Stage }));
    expect(await prisma.sessionResult.count({ where: { specId: "SPEC-105", newStage: "done" } })).toBe(1);
  });
});
