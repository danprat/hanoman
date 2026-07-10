import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp();
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("vps routes (SPEC-164)", () => {
  it("CRUD: create default port 22 → list → patch → delete", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "web-1", host: "203.0.113.10", user: "deploy" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().port).toBe(22);
    expect(res.json().hardened).toBe(false);
    const id = res.json().id as string;
    expect((await app.inject({ url: "/api/vps" })).json().length).toBe(1);
    const patch = await app.inject({ method: "PATCH", url: `/api/vps/${id}`, payload: { name: "web-1b" } });
    expect(patch.json().name).toBe("web-1b");
    expect(patch.json().port).toBe(22); // patch parsial tak mengubah field lain
    expect((await app.inject({ method: "DELETE", url: `/api/vps/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/vps/${id}` })).statusCode).toBe(404);
  });
  it("menolak host dengan metakarakter shell (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "x", host: "h; rm -rf /", user: "deploy" } });
    expect(res.statusCode).toBe(400);
  });
  it("audit menyimpan hasil + hardened true saat semua kritis pass", async () => {
    const v = await makeVps({ name: "a1", host: "198.51.100.1" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardened).toBe(true);
    expect(res.json().audit.length).toBeGreaterThanOrEqual(7);
    const row = await prisma.vps.findUnique({ where: { id: v.id } });
    expect(row!.hardened).toBe(true);
    expect(row!.lastAuditAt).not.toBeNull();
  });
  it("check kritis fail → hardened false", async () => {
    process.env.FAKE_SSH_MODE = "audit-fail";
    const v = await makeVps({ name: "a2", host: "198.51.100.2" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    expect(res.json().hardened).toBe(false);
  });
  it("vps unreachable → 502 dengan output ssh, bukan 500", async () => {
    process.env.FAKE_SSH_MODE = "unreachable";
    const v = await makeVps({ name: "a3", host: "198.51.100.3" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    expect(res.statusCode).toBe(502);
    expect(res.json().out).toContain("Connection refused");
  });
  it("audit vps tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/vps/hantu/audit" })).statusCode).toBe(404);
  });
});

describe("harden (SPEC-164)", () => {
  it("harden: transcript + verifikasi + audit ulang → hardened true", async () => {
    const v = await makeVps({ name: "h1", host: "198.51.100.11" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/harden` });
    expect(res.statusCode).toBe(200);
    expect(res.json().transcript).toContain("STEP ssh ok");
    expect(res.json().hardened).toBe(true);
    const row = await prisma.vps.findUnique({ where: { id: v.id } });
    expect(row!.hardened).toBe(true); // audit ulang otomatis tersimpan
  });
  it("ssh putus saat harden → 502, DB tak berubah", async () => {
    process.env.FAKE_SSH_MODE = "unreachable";
    const v = await makeVps({ name: "h2", host: "198.51.100.12" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/harden` });
    expect(res.statusCode).toBe(502);
    expect((await prisma.vps.findUnique({ where: { id: v.id } }))!.hardened).toBe(false);
  });
  it("verifikasi koneksi pasca-harden gagal → 502 dengan transcript", async () => {
    process.env.FAKE_SSH_MODE = "verify-fail";
    const v = await makeVps({ name: "h3", host: "198.51.100.13" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/harden` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("verifikasi");
    expect(res.json().transcript).toContain("STEP ssh ok"); // apply sempat jalan — transcript tetap dilaporkan
  });
  it("harden vps tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/vps/hantu/harden" })).statusCode).toBe(404);
  });
});
