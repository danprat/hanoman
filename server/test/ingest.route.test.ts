import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { generateIngestKey, hashKey } from "../src/services/ingest-key";
import { __resetBuckets } from "../src/services/error-ingest";

// requireAuth:true membuktikan /api/ingest MEMBYPASS gate cookie & memakai DSN-auth sendiri.
const app = buildApp({ requireAuth: true });
const KEY = "hnm_ing_" + "a".repeat(48);
const clean = async () => {
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "Proj", desc: "d", kind: "existing", ingestKeyHash: hashKey(KEY), ingestKeyPrefix: KEY.slice(0, 16) } });
  __resetBuckets();
});
afterAll(clean);

const body = { type: "TypeError", message: "x is undefined", stack: "Error\n    at f (/a/b.js:1:1)", environment: "production" };

describe("POST /api/ingest/:slug", () => {
  it("accepts a valid DSN and stores the event (202), bypassing the cookie gate", async () => {
    const r = await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: body });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ ok: true, new: true });
    expect(await prisma.errorEvent.count()).toBe(1);
  });

  it("accepts the DSN via x-hanoman-dsn header too", async () => {
    const r = await app.inject({ method: "POST", url: "/api/ingest/p1", headers: { "x-hanoman-dsn": KEY }, payload: body });
    expect(r.statusCode).toBe(202);
  });

  it("rejects wrong key, missing key, and unknown slug with a generic 401", async () => {
    expect((await app.inject({ method: "POST", url: "/api/ingest/p1?key=bad", payload: body })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/ingest/p1", payload: body })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/ingest/nope?key=" + KEY, payload: body })).statusCode).toBe(401);
  });

  it("400 on invalid payload", async () => {
    const r = await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: { message: "no type" } });
    expect(r.statusCode).toBe(400);
  });

  it("OPTIONS preflight returns 204 with CORS headers", async () => {
    const r = await app.inject({ method: "OPTIONS", url: "/api/ingest/p1" });
    expect(r.statusCode).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect(r.headers["access-control-allow-headers"]).toContain("x-hanoman-dsn");
  });

  it("413 when the body exceeds the hard cap", async () => {
    const r = await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: { type: "E", message: "m", stack: "s".repeat(70_000) } });
    expect(r.statusCode).toBe(413);
  });

  it("429 once the per-project rate limit is exceeded", async () => {
    process.env.HANOMAN_INGEST_RATE_PER_MIN = "2";
    __resetBuckets();
    await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: body });
    await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: body });
    const third = await app.inject({ method: "POST", url: "/api/ingest/p1?key=" + KEY, payload: body });
    delete process.env.HANOMAN_INGEST_RATE_PER_MIN;
    expect(third.statusCode).toBe(429);
  });
});
