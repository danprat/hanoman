import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean);
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return cookieOf(r);
}

describe("/agent-tokens routes (cookie-only)", () => {
  it("requires cookie session", async () => {
    expect((await app.inject({ method: "GET", url: "/api/agent-tokens" })).statusCode).toBe(401);
  });

  it("capabilities catalog lists 18 entries", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/api/agent-tokens/capabilities", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    // Angka ini sengaja HARDCODE, bukan `CAPABILITIES.length` — route mengembalikan katalog itu apa
    // adanya, jadi menurunkannya membuat assertion ini tautologi. Ia tripwire: tiap capability baru
    // memperlebar permukaan `/api` yang boleh didelegasikan ke agent token (ADR-0065), dan itu harus
    // disadari seorang manusia. SPEC-409 menambahkan `lead:read`/`lead:write` (ADR-0091) tanpa
    // menyetel ulang angkanya → 18 sejak itu selalu merah. Naikkan HANYA bersama penambahan yang
    // memang disengaja.
    expect(r.json().capabilities).toHaveLength(20);
    expect(r.json().capabilities[0]).toMatchObject({ id: expect.any(String), domain: expect.any(String), access: expect.any(String) });
  });

  it("create → plaintext once; list hides secrets; patch; revoke", async () => {
    const cookie = await login();
    let r = await app.inject({ method: "POST", url: "/api/agent-tokens", headers: { cookie }, payload: { name: "ci", capabilities: ["projects:read"] } });
    expect(r.statusCode).toBe(201);
    expect(r.json().token).toMatch(/^hnm_agt_/);
    const id = r.json().id;

    r = await app.inject({ method: "GET", url: "/api/agent-tokens", headers: { cookie } });
    expect(r.json().items).toHaveLength(1);
    expect(JSON.stringify(r.json())).not.toContain("tokenHash");
    expect(r.json().items[0]).not.toHaveProperty("token");

    r = await app.inject({ method: "PATCH", url: `/api/agent-tokens/${id}`, headers: { cookie }, payload: { enabled: false, capabilities: ["projects:read", "docs:read"] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ enabled: false, capabilities: ["projects:read", "docs:read"] });

    expect((await app.inject({ method: "DELETE", url: `/api/agent-tokens/${id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/agent-tokens/nope`, headers: { cookie } })).statusCode).toBe(404);
  });

  it("rejects unknown capability (400) and empty name (400)", async () => {
    const cookie = await login();
    expect((await app.inject({ method: "POST", url: "/api/agent-tokens", headers: { cookie }, payload: { name: "x", capabilities: ["ghost:read"] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/agent-tokens", headers: { cookie }, payload: { name: "", capabilities: [] } })).statusCode).toBe(400);
  });
});
