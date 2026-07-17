import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("checklist kepatuhan (SPEC-220)", () => {
  it("audit menyimpan snapshot + mengembalikan skor (AC-5)", async () => {
    const v = await makeVps({ name: "cl1", host: "198.51.100.71" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().scoreTotal).toBe("number");
    expect(res.json().scoreBySection).toBeTruthy();
    const snaps = await prisma.vpsAuditSnapshot.findMany({ where: { vpsId: v.id } });
    expect(snaps.length).toBe(1);
    // fixture emit fw-b1/ids-b1/ker-b1/ssh-b3 pass → seksi tsb > 0
    expect(res.json().scoreBySection.firewall).toBeGreaterThan(0);
  });

  it("GET checklist mengembalikan 232 item / 16 seksi + skor (AC-9)", async () => {
    const v = await makeVps({ name: "cl2", host: "198.51.100.72" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    const res = await app.inject({ url: `/api/vps/${v.id}/checklist` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sections.length).toBe(16);
    const total = body.sections.reduce((a: number, s: { items: unknown[] }) => a + s.items.length, 0);
    expect(total).toBe(232);
    expect(body.scoreTotal).toBeGreaterThanOrEqual(0);
    const fw = body.sections.find((s: { id: string }) => s.id === "firewall");
    expect(fw.items.find((i: { id: string }) => i.id === "fw-b1").status).toBe("pass");
  });

  it("checklist tersedia sebelum audit pertama (semua unknown, skor rendah)", async () => {
    const v = await makeVps({ name: "cl3", host: "198.51.100.73" });
    const res = await app.inject({ url: `/api/vps/${v.id}/checklist` });
    expect(res.statusCode).toBe(200);
    expect(res.json().lastAuditAt).toBeNull();
    expect(res.json().sections.length).toBe(16);
  });

  it("checklist vps tak dikenal → 404", async () => {
    expect((await app.inject({ url: "/api/vps/hantu/checklist" })).statusCode).toBe(404);
  });

  it("audit kedua yang meregres → drift[] + item drifted true (SPEC-221 AC-19)", async () => {
    const v = await makeVps({ name: "dr1", host: "198.51.100.221" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });     // ssh-b3 pass
    process.env.FAKE_SSH_MODE = "audit-fail";                                 // ssh-b3 fail
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    expect(res.json().drift.some((d: { itemId: string }) => d.itemId === "ssh-b3")).toBe(true);
    const cl = (await app.inject({ url: `/api/vps/${v.id}/checklist` })).json();
    const item = cl.sections.flatMap((s: { items: { id: string; drifted: boolean }[] }) => s.items)
      .find((i: { id: string }) => i.id === "ssh-b3");
    expect(item.drifted).toBe(true);
  });

  it("seksi app-layer dgn stack absent → suggestion applicable false (SPEC-221)", async () => {
    const v = await makeVps({ name: "dr2", host: "198.51.100.222" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    const cl = (await app.inject({ url: `/api/vps/${v.id}/checklist` })).json();
    // fixture: STACK webserver absent, database present
    const ws = cl.sections.find((s: { id: string }) => s.id === "webserver");
    const db = cl.sections.find((s: { id: string }) => s.id === "database");
    expect(ws.suggestion.applicable).toBe(false);
    expect(db.suggestion.applicable).toBe(true);
  });
});
