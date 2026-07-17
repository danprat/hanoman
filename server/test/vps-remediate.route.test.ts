import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("remediate preview (SPEC-220 AC-13)", () => {
  it("preview → steps would, TIDAK menyentuh DB (tak ada snapshot)", async () => {
    const v = await makeVps({ name: "rp1", host: "198.51.100.91" });
    const before = await prisma.vpsAuditSnapshot.count({ where: { vpsId: v.id } });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/remediate/preview`,
      payload: { items: ["fw-b1", "ker-b1"] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps.every((s: { status: string }) => s.status === "would")).toBe(true);
    expect(await prisma.vpsAuditSnapshot.count({ where: { vpsId: v.id } })).toBe(before);
  });

  it("item non-remediable ditolak → 400 (AC-16)", async () => {
    const v = await makeVps({ name: "rp2", host: "198.51.100.92" });
    // ssh-b2 = AUDIT (non-remediable), ssh-a1 = INFO
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/remediate/preview`,
      payload: { items: ["fw-b1", "ssh-b2"] } });
    expect(res.statusCode).toBe(400);
  });

  it("items kosong → 400", async () => {
    const v = await makeVps({ name: "rp3", host: "198.51.100.93" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/remediate/preview`, payload: { items: [] } });
    expect(res.statusCode).toBe(400);
  });
});

describe("remediate apply (SPEC-220 AC-14/17)", () => {
  it("apply → steps ok + re-audit (snapshot + skor baru)", async () => {
    const v = await makeVps({ name: "ra1", host: "198.51.100.94" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/remediate`,
      payload: { items: ["fw-b1", "ker-b1"] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps.every((s: { status: string }) => s.status === "ok")).toBe(true);
    expect(typeof res.json().scoreTotal).toBe("number");
    // re-audit pasca-apply menyimpan snapshot (AC-17)
    expect(await prisma.vpsAuditSnapshot.count({ where: { vpsId: v.id } })).toBeGreaterThanOrEqual(1);
  });

  it("apply item non-remediable → 400", async () => {
    const v = await makeVps({ name: "ra2", host: "198.51.100.95" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/remediate`, payload: { items: ["ssh-a1"] } });
    expect(res.statusCode).toBe(400);
  });

  it("vps tak dikenal → 404", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps/hantu/remediate", payload: { items: ["fw-b1"] } });
    expect(res.statusCode).toBe(404);
  });
});
