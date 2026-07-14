import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp();
const clean = async () => {
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) =>
  (r.headers["set-cookie"] as string).split(";")[0];

async function login() {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return cookieOf(r);
}

describe("device-tokens routes", () => {
  it("401 without cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/device-tokens" })).statusCode).toBe(401);
  });
  it("issue returns token once; list hides token; revoke sets revokedAt", async () => {
    const cookie = await login();
    const created = await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie }, payload: { name: "laptop" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "laptop" });
    expect(created.json().token).toBeTruthy();
    const id = created.json().id;

    const list = await app.inject({ method: "GET", url: "/api/device-tokens", headers: { cookie } });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).not.toHaveProperty("token");
    expect(list.json()[0]).not.toHaveProperty("tokenHash");
    expect(list.json()[0].revokedAt).toBeNull();

    const del = await app.inject({ method: "DELETE", url: `/api/device-tokens/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/api/device-tokens", headers: { cookie } });
    expect(after.json()[0].revokedAt).not.toBeNull();
  });
  it("delete unknown → 404", async () => {
    const cookie = await login();
    expect((await app.inject({ method: "DELETE", url: "/api/device-tokens/nope", headers: { cookie } })).statusCode).toBe(404);
  });
});
