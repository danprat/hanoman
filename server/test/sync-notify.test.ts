import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { notifySynced } from "../src/services/sync-notify";
import { listOutbox } from "../src/services/outbox";
import { setConfig, clearConfig } from "../src/config";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.errorEvent.deleteMany(); await prisma.errorGroup.deleteMany();
  await prisma.project.deleteMany(); await prisma.runtimeConfig.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function group() {
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "", kind: "existing" } });
  await prisma.errorGroup.create({ data: { id: "eg1", projectId: "p1", fingerprint: "f", type: "E", message: "m", environment: "production", count: 1 } });
}

describe("notifySynced (SPEC-268 ADR-0066)", () => {
  it("client (SYNC_SERVER_URL ada) → enqueueOutbox", async () => {
    await group();
    await setConfig("SYNC_SERVER_URL", "http://hub.example");
    try {
      await notifySynced("errorGroup", "eg1");
      expect((await listOutbox()).map((o) => o.recordId)).toContain("eg1");
      expect(await prisma.syncLog.count()).toBe(0);
    } finally { await clearConfig("SYNC_SERVER_URL"); }
  });

  it("hub (SYNC_SERVER_URL kosong) → publishLocal (append SyncLog)", async () => {
    await group();
    await notifySynced("errorGroup", "eg1");
    expect(await prisma.syncLog.count()).toBe(1);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });
});
