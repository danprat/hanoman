import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";
import { healthSweep, auditSweep } from "../src/services/vps-monitor";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("vps monitor (SPEC-164)", () => {
  it("healthSweep mengisi lastSeenAt + health untuk semua vps", async () => {
    const v = await makeVps({ name: "m1", host: "198.51.100.31" });
    await healthSweep();
    const row = await prisma.vps.findUnique({ where: { id: v.id } });
    expect(row!.lastSeenAt).not.toBeNull();
    expect((row!.health as { disk: string }).disk).toBe("42%");
  });
  it("healthSweep: vps unreachable dilewati tanpa melempar, lastSeenAt tetap", async () => {
    await resetDb();
    process.env.FAKE_SSH_MODE = "unreachable";
    const v = await makeVps({ name: "m2", host: "198.51.100.32" });
    await expect(healthSweep()).resolves.toBeUndefined();
    expect((await prisma.vps.findUnique({ where: { id: v.id } }))!.lastSeenAt).toBeNull();
  });
  it("auditSweep melewati vps yang lastAuditAt-nya masih segar", async () => {
    await resetDb();
    const fresh = await makeVps({ name: "m3", host: "198.51.100.33", lastAuditAt: new Date() });
    const stale = await makeVps({ name: "m4", host: "198.51.100.34" });
    await auditSweep();
    expect((await prisma.vps.findUnique({ where: { id: fresh.id } }))!.audit).toBeNull();  // dilewati
    expect((await prisma.vps.findUnique({ where: { id: stale.id } }))!.audit).not.toBeNull(); // diaudit
  });
});
