import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { renameProjectCore } from "../src/services/rename-project";

const clean = async () => {
  await prisma.syncOutbox.deleteMany();
  await prisma.errorEvent.deleteMany(); await prisma.errorGroup.deleteMany();
  await prisma.ticketAttachment.deleteMany(); await prisma.ticket.deleteMany();
  await prisma.sessionResult.deleteMany(); await prisma.notification.deleteMany();
  await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function seed(id: string) {
  await prisma.project.create({ data: { id, name: id, desc: "d", kind: "existing" } });
  await prisma.spec.create({ data: { id: `${id}-S1`, projectId: id, title: "t", source: "brief", stage: "planned", priority: "sedang", author: "a@b.co", objective: "o" } });
  await prisma.notification.create({ data: { title: "n", projectId: id } });
  await prisma.sessionResult.create({ data: { id: `${id}-R1`, projectId: id, status: "done" } });
  await prisma.localBinding.create({ data: { projectId: id, repoDir: "/local/only" } });
  const g = await prisma.errorGroup.create({ data: { projectId: id, fingerprint: "fp", type: "E", message: "m", environment: "prod" } });
  await prisma.errorEvent.create({ data: { groupId: g.id, projectId: id, type: "E", message: "m", environment: "prod" } });
  const t = await prisma.ticket.create({ data: { projectId: id, number: 1, category: "bug", title: "t", detail: "d", reporterEmail: "r@b.co", accessKeyHash: `${id}-hash` } });
  await prisma.ticketAttachment.create({ data: { ticketId: t.id, projectId: id, filename: "f.png", mimeType: "image/png", size: 1, storageKey: "k" } });
}

describe("renameProjectCore (SPEC-255)", () => {
  it("memindahkan id + semua referensi (FK cascade + longgar + binding)", async () => {
    await seed("old");
    const affected = await prisma.$transaction((tx) => renameProjectCore(tx, "old", "new"));

    expect(await prisma.project.findUnique({ where: { id: "old" } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "new" } })).not.toBeNull();
    // FK cascade otomatis
    expect(await prisma.spec.findFirst({ where: { projectId: "new" } })).not.toBeNull();
    expect(await prisma.errorGroup.findFirst({ where: { projectId: "new" } })).not.toBeNull();
    expect(await prisma.ticket.findFirst({ where: { projectId: "new" } })).not.toBeNull();
    // ref longgar manual
    expect(await prisma.notification.count({ where: { projectId: "new" } })).toBe(1);
    expect(await prisma.sessionResult.count({ where: { projectId: "new" } })).toBe(1);
    expect(await prisma.errorEvent.count({ where: { projectId: "new" } })).toBe(1);
    expect(await prisma.ticketAttachment.count({ where: { projectId: "new" } })).toBe(1);
    // tak ada sisa di id lama
    expect(await prisma.notification.count({ where: { projectId: "old" } })).toBe(0);
    expect(await prisma.errorEvent.count({ where: { projectId: "old" } })).toBe(0);
    // LocalBinding pindah key
    expect(await prisma.localBinding.findUnique({ where: { projectId: "old" } })).toBeNull();
    expect((await prisma.localBinding.findUnique({ where: { projectId: "new" } }))?.repoDir).toBe("/local/only");
    expect(affected).toMatchObject({ spec: 1, notification: 1, sessionResult: 1, errorEvent: 1, ticketAttachment: 1, localBinding: 1 });
  });
});
