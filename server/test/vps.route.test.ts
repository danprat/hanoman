import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";
import { getSession, killAll } from "../src/services/pty";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
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

describe("sesi claude vps (SPEC-164)", () => {
  it("membuka sesi tmux dengan label owner vps:<id>", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const v = await makeVps({ name: "s1", host: "198.51.100.21",
      audit: [{ check: "firewall", status: "fail", detail: "ufw tidak aktif" }], lastAuditAt: new Date() });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/session` });
    expect(res.statusCode).toBe(201);
    const s = getSession(res.json().id);
    expect(s?.projectId).toBe(`vps:${v.id}`);
    killAll();
  });
  it("sesi vps tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/vps/hantu/session" })).statusCode).toBe(404);
  });
});

describe("bootstrap lewat password (SPEC-165)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-route-key-")); process.env.HANOMAN_SSH_KEY_DIR = dir; });
  afterEach(() => { delete process.env.HANOMAN_SSH_KEY_DIR; rmSync(dir, { recursive: true, force: true }); });

  it("POST dengan password → 201, keyPath terisi, password tak dikembalikan", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "bs1", host: "198.51.100.60", user: "root", password: "s3cret" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().keyPath).toBe(join(dir, "id_ed25519"));
    expect(JSON.stringify(res.json())).not.toContain("s3cret");
    expect((await prisma.vps.findUnique({ where: { id: res.json().id } }))!.keyPath).toBe(join(dir, "id_ed25519"));
  });

  it("bootstrap gagal → 502 dan TIDAK ada baris yang lahir", async () => {
    process.env.FAKE_SSH_MODE = "bad-password";
    const before = await prisma.vps.count();
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "bs2", host: "198.51.100.61", user: "root", password: "salah" } });
    expect(res.statusCode).toBe(502);
    expect(res.json().out).toContain("Permission denied");
    expect(await prisma.vps.count()).toBe(before);
  });

  it("POST tanpa password tetap seperti SPEC-164 (tak ada ssh sama sekali)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "bs3", host: "198.51.100.62", user: "deploy" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().keyPath).toBeNull();
  });

  it("PATCH dengan password → bootstrap ulang, keyPath diperbarui", async () => {
    const v = await makeVps({ name: "bs4", host: "198.51.100.63", user: "root", keyPath: null });
    const res = await app.inject({ method: "PATCH", url: `/api/vps/${v.id}`, payload: { password: "s3cret" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().keyPath).toBe(join(dir, "id_ed25519"));
    expect(JSON.stringify(res.json())).not.toContain("s3cret");
  });

  it("PATCH dengan password yang ditolak → 502, baris tak berubah", async () => {
    process.env.FAKE_SSH_MODE = "bad-password";
    const v = await makeVps({ name: "bs5", host: "198.51.100.64", user: "root", keyPath: null });
    const res = await app.inject({ method: "PATCH", url: `/api/vps/${v.id}`, payload: { password: "salah" } });
    expect(res.statusCode).toBe(502);
    expect((await prisma.vps.findUnique({ where: { id: v.id } }))!.keyPath).toBeNull();
  });

  it("PATCH tanpa password tak menyentuh ssh dan tetap parsial", async () => {
    const v = await makeVps({ name: "bs6", host: "198.51.100.65", user: "deploy", port: 2200 });
    const res = await app.inject({ method: "PATCH", url: `/api/vps/${v.id}`, payload: { name: "bs6b" } });
    expect(res.json().name).toBe("bs6b");
    expect(res.json().port).toBe(2200);
  });
});
