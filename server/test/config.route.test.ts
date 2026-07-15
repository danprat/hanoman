import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { loadConfig } from "../src/config";

const app = buildApp();
const clean = async () => { await prisma.runtimeConfig.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany(); };
beforeEach(async () => { await clean(); await loadConfig(); });
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return cookieOf(r);
}

describe("config routes", () => {
  it("401 tanpa cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/config" })).statusCode).toBe(401);
  });
  it("GET: entri lengkap + sync status; secret termask tanpa value", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.sync).toMatchObject({ running: expect.any(Boolean), connected: expect.any(Boolean) });
    const token = body.entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN");
    expect(token.category).toBe("credential");
    expect(token).not.toHaveProperty("value");
    expect(token.hasValue).toBe(false);
    const bootstrap = body.entries.find((e: any) => e.key === "DATABASE_URL");
    expect(bootstrap.editable).toBe(false);
  });
  it("PUT knob valid → tersimpan + source db", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_TICK_MS", value: "3000" } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ key: "SYNC_TICK_MS", value: "3000", source: "db" });
  });
  it("PUT int invalid → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_TICK_MS", value: "5" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT bootstrap → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "PORT", value: "9000" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT unknown key → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "NOPE", value: "x" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT secret; GET termask; blank pertahankan; DELETE clear", async () => {
    const cookie = await login();
    await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_DEVICE_TOKEN", value: "supersecret9999" } });
    let g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    let tok = g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN");
    expect(tok.hasValue).toBe(true);
    expect(tok.masked).toBe("••••9999");
    expect(tok).not.toHaveProperty("value");
    // blank = pertahankan
    await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_DEVICE_TOKEN", value: "" } });
    g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN").hasValue).toBe(true);
    // DELETE clear
    const del = await app.inject({ method: "DELETE", url: "/api/config/SYNC_DEVICE_TOKEN", headers: { cookie } });
    expect(del.statusCode).toBe(204);
    g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN").hasValue).toBe(false);
  });
});
