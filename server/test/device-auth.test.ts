import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Fastify from "fastify";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { requireDeviceToken } from "../src/services/device-auth";

const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };
beforeEach(clean); afterAll(clean);

function app() {
  const a = Fastify({ logger: false });
  a.get("/who", { preHandler: requireDeviceToken }, async (req) => ({ device: req.device }));
  return a;
}

describe("requireDeviceToken preHandler", () => {
  it("401 without Authorization header", async () => {
    const r = await app().inject({ method: "GET", url: "/who" });
    expect(r.statusCode).toBe(401);
  });
  it("200 + userId with valid Bearer token", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    const r = await app().inject({ method: "GET", url: "/who", headers: { authorization: `Bearer ${t.token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json().device).toMatchObject({ userId: u.id });
  });
  it("401 after revoke / with garbage token", async () => {
    const r = await app().inject({ method: "GET", url: "/who", headers: { authorization: "Bearer nope" } });
    expect(r.statusCode).toBe(401);
  });
});
