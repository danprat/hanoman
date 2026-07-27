import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { parseWhen } from "../src/routes/audit";
import { createSession, killAll } from "../src/services/pty";
import { newAuditKey, AUDIT_KEY_HEADER } from "../src/services/audit-scope";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.projectLink.deleteMany();
  await prisma.project.deleteMany();
};

let key = "";
let webGroupId = "";
let lepasGroupId = "";
const hdr = () => ({ [AUDIT_KEY_HEADER]: key });

beforeEach(async () => {
  killAll();
  await clean();
  await prisma.project.createMany({ data: [
    { id: "web", name: "Web", desc: "", kind: "existing" },
    { id: "api", name: "API", desc: "", kind: "existing" },
    { id: "lepas", name: "Lepas", desc: "", kind: "existing" },
  ] });
  const now = Date.now();
  const g1 = await prisma.errorGroup.create({ data: { projectId: "web", fingerprint: "w1", type: "TypeError", message: "orders gagal dimuat", environment: "production", count: 3, lastSeenAt: new Date(now - 60_000) } });
  const g2 = await prisma.errorGroup.create({ data: { projectId: "api", fingerprint: "a1", type: "TimeoutError", message: "upstream timeout", environment: "production", count: 2, lastSeenAt: new Date(now - 61_000) } });
  const g3 = await prisma.errorGroup.create({ data: { projectId: "lepas", fingerprint: "l1", type: "Error", message: "bukan urusan kita", environment: "production", count: 1, lastSeenAt: new Date(now - 62_000) } });
  webGroupId = g1.id; lepasGroupId = g3.id;
  await prisma.errorEvent.createMany({ data: [
    { groupId: g1.id, projectId: "web", type: "TypeError", message: "orders gagal dimuat", environment: "production", receivedAt: new Date(now - 60_000) },
    { groupId: g2.id, projectId: "api", type: "TimeoutError", message: "upstream timeout", environment: "production", receivedAt: new Date(now - 61_000) },
    { groupId: g2.id, projectId: "api", type: "TimeoutError", message: "upstream timeout", environment: "dev", receivedAt: new Date(now - 62_000) },
    { groupId: g3.id, projectId: "lepas", type: "Error", message: "bukan urusan kita", environment: "production", receivedAt: new Date(now - 30_000) },
    // di luar jendela default 24 jam
    { groupId: g1.id, projectId: "web", type: "TypeError", message: "orders gagal dimuat", environment: "production", receivedAt: new Date(now - 3 * 86_400_000) },
  ] });
  key = newAuditKey();
  const cwd = mkdtempSync(join(tmpdir(), "hanoman-xa-"));
  createSession("web", cwd, { id: "xa-logs", command: ["sleep", "30"], audit: { key, projects: ["web", "api"] } });
});
afterAll(async () => { killAll(); await clean(); });

describe("parseWhen", () => {
  const now = new Date("2026-07-27T12:00:00Z");
  it("menerima durasi relatif", () => {
    expect(parseWhen("24h", now, now)!.toISOString()).toBe("2026-07-26T12:00:00.000Z");
    expect(parseWhen("7d", now, now)!.toISOString()).toBe("2026-07-20T12:00:00.000Z");
    expect(parseWhen("30m", now, now)!.toISOString()).toBe("2026-07-27T11:30:00.000Z");
  });
  it("menerima ISO-8601 dan memakai fallback saat kosong", () => {
    expect(parseWhen("2026-07-01T00:00:00Z", now, now)!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(parseWhen(undefined, now, now)).toBe(now);
  });
  it("null untuk yang tak terparse", () => {
    expect(parseWhen("kemarin", now, now)).toBeNull();
  });
});

describe("GET /api/audit/logs", () => {
  it("mencampur & mengurutkan event semua project ter-scope", async () => {
    const r = await app.inject({ method: "GET", url: "/api/audit/logs", headers: hdr() });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.scope.map((p: { id: string }) => p.id).sort()).toEqual(["api", "web"]);
    const ids = b.timeline.map((e: { projectId: string }) => e.projectId);
    expect(ids).toContain("web");
    expect(ids).toContain("api");
    expect(ids).not.toContain("lepas");        // di luar scope sesi
    const at = b.timeline.map((e: { at: string }) => new Date(e.at).getTime());
    expect([...at].sort((x, y) => y - x)).toEqual(at);   // terurut desc
    expect(b.groups.map((g: { projectId: string }) => g.projectId)).not.toContain("lepas");
  });

  it("memotong di jendela waktu (default 24 jam)", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/audit/logs", headers: hdr() })).json();
    expect(b.timeline).toHaveLength(3);       // event 3 hari lalu tak ikut
    const luas = (await app.inject({ method: "GET", url: "/api/audit/logs?since=7d", headers: hdr() })).json();
    expect(luas.timeline).toHaveLength(4);
  });

  it("memfilter environment dan kata kunci", async () => {
    const dev = (await app.inject({ method: "GET", url: "/api/audit/logs?environment=dev&since=7d", headers: hdr() })).json();
    expect(dev.timeline).toHaveLength(1);
    const q = (await app.inject({ method: "GET", url: "/api/audit/logs?q=timeout", headers: hdr() })).json();
    expect(q.timeline.length).toBeGreaterThan(0);
    expect(q.timeline.every((e: { projectId: string }) => e.projectId === "api")).toBe(true);
  });

  it("menyempitkan ke subset scope lewat ?projects=", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/audit/logs?projects=api", headers: hdr() })).json();
    expect(b.timeline.length).toBeGreaterThan(0);
    expect(b.timeline.every((e: { projectId: string }) => e.projectId === "api")).toBe(true);
  });

  it("403 bila meminta project di luar scope", async () => {
    const r = await app.inject({ method: "GET", url: "/api/audit/logs?projects=lepas", headers: hdr() });
    expect(r.statusCode).toBe(403);
  });

  it("400 bila since tak terparse", async () => {
    const r = await app.inject({ method: "GET", url: "/api/audit/logs?since=kemarin", headers: hdr() });
    expect(r.statusCode).toBe(400);
  });
});

describe("GET /api/audit/logs/:groupId", () => {
  it("mengembalikan detail grup di dalam scope", async () => {
    const r = await app.inject({ method: "GET", url: `/api/audit/logs/${webGroupId}`, headers: hdr() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ projectId: "web", type: "TypeError" });
    expect(Array.isArray(r.json().events)).toBe(true);
  });

  it("404 untuk grup di luar scope", async () => {
    const r = await app.inject({ method: "GET", url: `/api/audit/logs/${lepasGroupId}`, headers: hdr() });
    expect(r.statusCode).toBe(404);
  });
});

describe("gate /api/audit", () => {
  it("401 tanpa kunci audit dan tanpa cookie", async () => {
    const gated = buildApp();   // requireAuth default true
    const r = await gated.inject({ method: "GET", url: "/api/audit/logs" });
    expect(r.statusCode).toBe(401);
  });

  it("401 dengan kunci yang tak dimiliki sesi mana pun", async () => {
    const gated = buildApp();
    const r = await gated.inject({ method: "GET", url: "/api/audit/logs", headers: { [AUDIT_KEY_HEADER]: newAuditKey() } });
    expect(r.statusCode).toBe(401);
  });

  it("lolos gate dengan kunci sesi hidup, tanpa cookie", async () => {
    const gated = buildApp();
    const r = await gated.inject({ method: "GET", url: "/api/audit/logs", headers: hdr() });
    expect(r.statusCode).toBe(200);
  });
});
