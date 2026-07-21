import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";

// Gate cookie aktif (default) — surface /api/sync di-bypass gate cookie, di-enforce device token.
const app = buildApp();
const clean = async () => {
  await prisma.syncConflict.deleteMany();
  await prisma.syncLog.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function tokenFor(email = "dev@x.co") {
  const u = await prisma.user.create({ data: { email, passwordHash: "x:y" } });
  const t = await issueDeviceToken(u.id, "laptop");
  return { auth: { authorization: `Bearer ${t.token}` }, user: u };
}
const specRec = (id: string, baseVersion: number, over: Record<string, unknown> = {}) => ({
  entity: "spec", id, baseVersion,
  data: { projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang", author: "", objective: "o", ...over },
});

describe("sync routes /pull /push (SPEC-213)", () => {
  it("401 without Bearer device token (AC-2)", async () => {
    expect((await app.inject({ method: "GET", url: "/api/sync/pull?since=0" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/sync/push", payload: { records: [] } })).statusCode).toBe(401);
  });

  it("push insert then pull returns it; author attributed to token user (AC-4/11)", async () => {
    const { auth, user } = await tokenFor();
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    const push = await app.inject({ method: "POST", url: "/api/sync/push", headers: auth, payload: { records: [specRec("SPEC-1", 0)] } });
    expect(push.statusCode).toBe(200);
    expect(push.json().results[0]).toMatchObject({ id: "SPEC-1", ok: true, version: 1 });
    // author kosong → diisi email user token
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))?.author).toBe(user.email);

    const pull = await app.inject({ method: "GET", url: "/api/sync/pull?since=0", headers: auth });
    expect(pull.json().records.map((r: { recordId: string }) => r.recordId)).toContain("SPEC-1");
  });

  it("stale push returns conflict with server snapshot for diff (AC-13)", async () => {
    const { auth } = await tokenFor();
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await app.inject({ method: "POST", url: "/api/sync/push", headers: auth, payload: { records: [specRec("SPEC-1", 0)] } });
    const stale = await app.inject({ method: "POST", url: "/api/sync/push", headers: auth, payload: { records: [specRec("SPEC-1", 0, { title: "HIJACK" })] } });
    expect(stale.json().results[0]).toMatchObject({ id: "SPEC-1", ok: false, conflict: true });
    expect(stale.json().results[0].server.version).toBe(1);
  });

  // SPEC-268 · ADR-0066 · pemicu manual /sync/now: cookie-gated (bukan device token) → tanpa
  // sesi 401; agent-deny "cookie-only" berlaku (dites di agent-capabilities). Hub → not-configured.
  it("POST /sync/now tanpa sesi → 401 (di-KECUALIKAN dari bypass /api/sync) (SPEC-268)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/sync/now" });
    expect(r.statusCode).toBe(401);
  });

  it("POST /sync/now (auth off) saat bukan client → not-configured (SPEC-268)", async () => {
    await prisma.runtimeConfig.deleteMany();
    const noAuth = buildApp({ requireAuth: false });
    const r = await noAuth.inject({ method: "POST", url: "/api/sync/now" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: false, reason: "not-configured" });
  });
});

// SPEC-270 · ADR-0067 · endpoint antrean konflik rekonsil (cookie-only).
describe("sync routes /conflicts (SPEC-270)", () => {
  it("GET /api/sync/conflicts tanpa sesi → 401 (dikecualikan dari bypass /api/sync)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sync/conflicts" });
    expect(r.statusCode).toBe(401);
  });

  it("GET /api/sync/conflicts kosong saat tak ada konflik", async () => {
    const noAuth = buildApp({ requireAuth: false });
    const res = await noAuth.inject({ method: "GET", url: "/api/sync/conflicts" });
    expect(res.statusCode).toBe(200);
    expect(res.json().conflicts).toEqual([]);
  });

  it("resolve entitas tak dikenal → ok:false", async () => {
    const noAuth = buildApp({ requireAuth: false });
    const res = await noAuth.inject({ method: "POST", url: "/api/sync/conflicts/nope/x/resolve",
      payload: { choice: "server" } });
    expect(res.json().ok).toBe(false);
  });

  it("resolve(server) menuntaskan konflik yang tercatat", async () => {
    const noAuth = buildApp({ requireAuth: false });
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-7", projectId: "p1", title: "lokal", source: "brief",
      stage: "planned", priority: "sedang", author: "a", objective: "o", version: 2 } });
    await prisma.syncConflict.create({ data: { entity: "spec", recordId: "SPEC-7",
      localData: { projectId: "p1", title: "lokal", source: "brief", stage: "planned", priority: "sedang",
        author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null, headSha: null,
        updatedAt: "2020-01-02T00:00:00.000Z" }, localVersion: 2, localUpdatedAt: new Date("2020-01-02T00:00:00.000Z"),
      serverData: { projectId: "p1", title: "server", source: "brief", stage: "planned", priority: "sedang",
        author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null, headSha: null,
        updatedAt: "2020-01-03T00:00:00.000Z" }, serverVersion: 3, serverUpdatedAt: new Date("2020-01-03T00:00:00.000Z") } });
    const res = await noAuth.inject({ method: "POST", url: "/api/sync/conflicts/spec/SPEC-7/resolve",
      payload: { choice: "server" } });
    expect(res.json().ok).toBe(true);
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-7" } }))!.title).toBe("server");
    const list = await noAuth.inject({ method: "GET", url: "/api/sync/conflicts" });
    expect(list.json().conflicts).toEqual([]);
  });
});
