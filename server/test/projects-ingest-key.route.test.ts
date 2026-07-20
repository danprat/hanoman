import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

// SPEC-249 · DSN ingest key per project: generate/rotate/revoke + ProjectView exposure.
const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => { await clean(); await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing" } }); });
afterAll(clean);

describe("ingest key endpoints", () => {
  it("POST generates a key + dsnUrl + prefix once, marks monitoring enabled", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/p1/ingest-key" });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.enabled).toBe(true);
    expect(body.key).toMatch(/^hnm_ing_/);
    expect(body.dsnUrl).toContain("/api/ingest/p1?key=");
    expect(body.prefix).toBe(body.key.slice(0, 16));

    const view = await app.inject({ method: "GET", url: "/api/projects/p1" });
    expect(view.json()).toMatchObject({ monitoringEnabled: true, ingestKeyPrefix: body.prefix });
    // hash never leaked
    expect(JSON.stringify(view.json())).not.toContain("ingestKeyHash");
  });

  it("GET returns enabled + prefix WITHOUT the plaintext key", async () => {
    await app.inject({ method: "POST", url: "/api/projects/p1/ingest-key" });
    const g = await app.inject({ method: "GET", url: "/api/projects/p1/ingest-key" });
    expect(g.statusCode).toBe(200);
    const body = g.json();
    expect(body.enabled).toBe(true);
    expect(body.prefix).toMatch(/^hnm_ing_/);
    expect(body.key).toBeUndefined();
    expect(body.dsnUrl).toBeUndefined();
  });

  it("rotate produces a different key/prefix", async () => {
    const first = (await app.inject({ method: "POST", url: "/api/projects/p1/ingest-key" })).json();
    const second = (await app.inject({ method: "POST", url: "/api/projects/p1/ingest-key" })).json();
    expect(second.key).not.toBe(first.key);
    expect(second.prefix).not.toBe(first.prefix);
  });

  it("DELETE revokes → monitoring disabled", async () => {
    await app.inject({ method: "POST", url: "/api/projects/p1/ingest-key" });
    const d = await app.inject({ method: "DELETE", url: "/api/projects/p1/ingest-key" });
    expect(d.statusCode).toBe(204);
    const g = await app.inject({ method: "GET", url: "/api/projects/p1/ingest-key" });
    expect(g.json()).toMatchObject({ enabled: false, prefix: null });
  });

  it("404 for unknown project", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/nope/ingest-key" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/projects/nope/ingest-key" })).statusCode).toBe(404);
  });
});
