import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { checkTriase, registerTriaseSource } from "../src/services/scheduler/sources/triase";
import { listQueue } from "../src/services/scheduler/queue";
import { listSources, clearSources } from "../src/services/scheduler/registry";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.ticketAttachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const mkProject = (id: string, schedulerOptIn: boolean) =>
  prisma.project.create({ data: { id, name: id, desc: "", kind: "existing", schedulerOptIn } });
let n = 0;
const mkTicket = (over: { projectId: string; category?: string; status?: string; specId?: string | null }) =>
  prisma.ticket.create({ data: {
    projectId: over.projectId, number: ++n, category: over.category ?? "bug",
    title: "keluhan", detail: "detail keluhan", reporterEmail: "r@e.co",
    status: over.status ?? "new", accessKeyHash: `k-${n}`, specId: over.specId ?? null,
  } });

describe("triase source-checker", () => {
  it("accepts + enqueues only eligible tickets (new, bug/fitur, opt-in)", async () => {
    await mkProject("opt", true);
    const t = await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    const q = await listQueue();
    expect(q.length).toBe(1);
    expect(q[0]!.source).toBe("triase");
    expect(q[0]!.priority).toBe("sedang");
    expect(q[0]!.status).toBe("queued");
    const after = await prisma.ticket.findUnique({ where: { id: t.id } });
    expect(after!.status).toBe("accepted");
    expect(after!.specId).toBe(q[0]!.specId);
  });

  it("maps category→source (SPEC-291): bug→qa, fitur→brief", async () => {
    await mkProject("opt", true);
    const bug = await mkTicket({ projectId: "opt", category: "bug" });
    const fitur = await mkTicket({ projectId: "opt", category: "fitur" });
    await checkTriase();
    const sBug = await prisma.spec.findUnique({ where: { id: (await prisma.ticket.findUnique({ where: { id: bug.id } }))!.specId! } });
    const sFitur = await prisma.spec.findUnique({ where: { id: (await prisma.ticket.findUnique({ where: { id: fitur.id } }))!.specId! } });
    expect(sBug!.source).toBe("qa");
    expect(sFitur!.source).toBe("brief");
  });

  it("never auto-accepts pertanyaan/lainnya categories", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "pertanyaan" });
    await mkTicket({ projectId: "opt", category: "lainnya" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
    expect(await prisma.spec.count()).toBe(0);
    expect(await prisma.ticket.count({ where: { status: "new" } })).toBe(2);
  });

  it("skips tickets from non-opt-in projects", async () => {
    await mkProject("noopt", false);
    await mkTicket({ projectId: "noopt", category: "bug" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
  });

  it("is idempotent: accepted/rejected/linked tickets are not re-accepted", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug", status: "accepted", specId: "SPEC-EXIST" });
    await mkTicket({ projectId: "opt", category: "bug", status: "rejected" });
    await mkTicket({ projectId: "opt", category: "bug", status: "new", specId: "SPEC-LINK" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
  });

  it("processes many eligible tickets in one window (no per-checker cap)", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug" });
    await mkTicket({ projectId: "opt", category: "fitur" });
    await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    expect((await listQueue()).length).toBe(3);
    expect(await prisma.ticket.count({ where: { status: "accepted" } })).toBe(3);
  });

  it("double check → one queue row per spec, tickets accepted once", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    await checkTriase();
    expect((await listQueue()).length).toBe(1);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("registerTriaseSource registers a source with id 'triase'", () => {
    registerTriaseSource();
    expect(listSources().map((s) => s.id)).toContain("triase");
  });
});
