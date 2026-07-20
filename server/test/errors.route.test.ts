import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeEach(async () => {
  await clean();
  await prisma.project.createMany({ data: [
    { id: "a", name: "A", desc: "", kind: "existing" },
    { id: "b", name: "B", desc: "", kind: "existing" },
  ] });
  // grup a1 (prod, older lastSeen), a2 (dev, newest), b1 (prod)
  const a1 = await prisma.errorGroup.create({ data: { projectId: "a", fingerprint: "f1", type: "TypeError", message: "boom one", environment: "production", count: 5, lastSeenAt: new Date("2026-07-01") } });
  await prisma.errorGroup.create({ data: { projectId: "a", fingerprint: "f2", type: "RangeError", message: "out of range", environment: "dev", count: 2, lastSeenAt: new Date("2026-07-19") } });
  await prisma.errorGroup.create({ data: { projectId: "b", fingerprint: "f3", type: "Error", message: "b broke", environment: "production", count: 1, lastSeenAt: new Date("2026-07-10") } });
  await prisma.errorEvent.createMany({ data: [
    { groupId: a1.id, projectId: "a", type: "TypeError", message: "boom one", stack: "at f", environment: "production", receivedAt: new Date("2026-07-01T01:00:00Z") },
    { groupId: a1.id, projectId: "a", type: "TypeError", message: "boom one", stack: "at f2", environment: "production", receivedAt: new Date("2026-07-01T02:00:00Z") },
  ] });
});
afterAll(clean);

describe("GET /api/errors", () => {
  it("lists all groups sorted by lastSeen desc", async () => {
    const r = await app.inject({ method: "GET", url: "/api/errors" });
    expect(r.statusCode).toBe(200);
    const items = r.json().items;
    expect(items).toHaveLength(3);
    expect(items[0].message).toBe("out of range"); // newest lastSeen
  });

  it("filters by project", async () => {
    const items = (await app.inject({ method: "GET", url: "/api/errors?project=b" })).json().items;
    expect(items).toHaveLength(1);
    expect(items[0].projectId).toBe("b");
  });

  it("filters by environment", async () => {
    const items = (await app.inject({ method: "GET", url: "/api/errors?environment=production" })).json().items;
    expect(items.map((g: { message: string }) => g.message).sort()).toEqual(["b broke", "boom one"]);
  });

  it("filters by q (type or message)", async () => {
    const items = (await app.inject({ method: "GET", url: "/api/errors?q=range" })).json().items;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("RangeError");
  });
});

describe("GET /api/errors/integration-guide", () => {
  it("serves the SDK integration guide markdown (from sdk/README.md)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/errors/integration-guide" });
    expect(r.statusCode).toBe(200);
    const { text } = r.json();
    expect(typeof text).toBe("string");
    expect(text).toContain("DSN");           // panduan menyebut cara dapat DSN
    expect(text.length).toBeGreaterThan(100);
  });

  it("is matched as a static route, not as /errors/:id", async () => {
    // regresi: pastikan tak diperlakukan sebagai id grup (yang akan 404)
    const r = await app.inject({ method: "GET", url: "/api/errors/integration-guide" });
    expect(r.statusCode).not.toBe(404);
  });
});

describe("GET /api/errors/:id", () => {
  it("returns group detail with sample events (newest first)", async () => {
    const g = await prisma.errorGroup.findFirst({ where: { fingerprint: "f1" } });
    const r = await app.inject({ method: "GET", url: "/api/errors/" + g!.id });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.count).toBe(5);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].stack).toBe("at f2"); // newest first
  });

  it("404 for unknown group", async () => {
    expect((await app.inject({ method: "GET", url: "/api/errors/nope" })).statusCode).toBe(404);
  });
});
