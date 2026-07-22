import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { checkErrors, registerErrorsSource } from "../src/services/scheduler/sources/errors";
import { listQueue } from "../src/services/scheduler/queue";
import { listSources, clearSources } from "../src/services/scheduler/registry";
import { setScheduler, getScheduler } from "../src/services/scheduler/config";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const mkProject = (id: string, schedulerOptIn: boolean) =>
  prisma.project.create({ data: { id, name: id, desc: "", kind: "existing", schedulerOptIn } });
let fpN = 0;
const mkGroup = (over: { projectId: string; environment?: string; status?: string; count?: number }) =>
  prisma.errorGroup.create({ data: {
    projectId: over.projectId, fingerprint: `fp-${fpN++}`, type: "TypeError",
    message: "Cannot read properties of undefined", sampleStack: "TypeError\n    at h (/x.js:1:1)",
    environment: over.environment ?? "production", status: over.status ?? "new", count: over.count ?? 10,
  } });

describe("errors source-checker", () => {
  it("escalates + enqueues only eligible groups (new, production, count>=minCount, opt-in)", async () => {
    await mkProject("opt", true);
    const g = await mkGroup({ projectId: "opt", count: 7 });
    await checkErrors();
    const q = await listQueue();
    expect(q.length).toBe(1);
    expect(q[0]!.source).toBe("errors");
    expect(q[0]!.priority).toBe("tinggi");
    expect(q[0]!.status).toBe("queued");
    const after = await prisma.errorGroup.findUnique({ where: { id: g.id } });
    expect(after!.status).toBe("escalated");
    expect(after!.specId).toBe(q[0]!.specId);
  });

  it("filters by environment: non-production groups are ignored", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", environment: "development", count: 99 });
    await mkGroup({ projectId: "opt", environment: "unknown", count: 99 });
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
  });

  it("filters by count threshold (minCount from settings, default 5)", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", count: 4 });   // below default 5
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
    await mkGroup({ projectId: "opt", count: 5 });   // at threshold
    await checkErrors();
    expect((await listQueue()).length).toBe(1);
  });

  it("honors a custom minCount from Setting.scheduler", async () => {
    await mkProject("opt", true);
    await setScheduler({ ...SCHEDULER_DEFAULTS, sources: {
      ...SCHEDULER_DEFAULTS.sources,
      errors: { ...SCHEDULER_DEFAULTS.sources.errors, minCount: 20 },
    } });
    expect((await getScheduler()).sources.errors.minCount).toBe(20);
    await mkGroup({ projectId: "opt", count: 15 });  // below custom 20
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
  });

  it("skips groups from non-opt-in projects", async () => {
    await mkProject("noopt", false);
    await mkGroup({ projectId: "noopt", count: 99 });
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
  });

  it("is idempotent: escalated/resolved/linked groups are not re-escalated", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", status: "escalated", count: 99 });
    await mkGroup({ projectId: "opt", status: "resolved", count: 99 });
    const linked = await mkGroup({ projectId: "opt", status: "new", count: 99 });
    await prisma.errorGroup.update({ where: { id: linked.id }, data: { specId: "SPEC-EXIST" } });
    await checkErrors();
    expect((await listQueue()).length).toBe(0);
  });

  it("processes many eligible groups in one window (no per-checker cap)", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", count: 10 });
    await mkGroup({ projectId: "opt", count: 20 });
    await mkGroup({ projectId: "opt", count: 30 });
    await checkErrors();
    expect((await listQueue()).length).toBe(3);
    expect(await prisma.errorGroup.count({ where: { status: "escalated" } })).toBe(3);
  });

  it("double check → one queue row per spec, groups escalated once", async () => {
    await mkProject("opt", true);
    await mkGroup({ projectId: "opt", count: 10 });
    await checkErrors();
    await checkErrors();
    expect((await listQueue()).length).toBe(1);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("registerErrorsSource registers a source with id 'errors'", () => {
    registerErrorsSource();
    expect(listSources().map((s) => s.id)).toContain("errors");
  });
});
