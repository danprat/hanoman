import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { notifySynced } from "../src/services/sync-notify";
import { listOutbox } from "../src/services/outbox";
import { setConfig, clearConfig } from "../src/config";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.project.deleteMany(); await prisma.runtimeConfig.deleteMany();
};
beforeEach(clean); afterAll(clean);

// SPEC-384 · subjeknya dulu ErrorGroup; sesudah error monitoring dicabut, Ticket adalah record
// asal-hub yang tersisa dengan peran yang persis sama (lahir di hub, merambat ke client).
async function ticket() {
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "", kind: "existing" } });
  await prisma.ticket.create({ data: {
    id: "tk1", projectId: "p1", number: 1, category: "bug", title: "t", detail: "d",
    reporterEmail: "a@b.c", accessKeyHash: "hash-tk1",
  } });
}

describe("notifySynced (SPEC-268 ADR-0066)", () => {
  it("client (SYNC_SERVER_URL ada) → enqueueOutbox", async () => {
    await ticket();
    await setConfig("SYNC_SERVER_URL", "http://hub.example");
    try {
      await notifySynced("ticket", "tk1");
      expect((await listOutbox()).map((o) => o.recordId)).toContain("tk1");
      expect(await prisma.syncLog.count()).toBe(0);
    } finally { await clearConfig("SYNC_SERVER_URL"); }
  });

  it("hub (SYNC_SERVER_URL kosong) → publishLocal (append SyncLog)", async () => {
    await ticket();
    await notifySynced("ticket", "tk1");
    expect(await prisma.syncLog.count()).toBe(1);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });
});
