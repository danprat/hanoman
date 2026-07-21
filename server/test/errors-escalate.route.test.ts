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

let groupId = "";
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
  const g = await prisma.errorGroup.create({ data: {
    projectId: "p1", fingerprint: "f1", type: "TypeError",
    message: "Cannot read properties of undefined", sampleStack: "TypeError\n    at handler (/srv/x.js:42:10)",
    environment: "production", count: 7,
  } });
  groupId = g.id;
});
afterAll(clean);

describe("POST /api/errors/:id/escalate", () => {
  it("creates a QA Spec prefilled from the group and links both ways", async () => {
    const r = await app.inject({ method: "POST", url: `/api/errors/${groupId}/escalate` });
    expect(r.statusCode).toBe(201);
    const spec = r.json().spec;
    expect(spec.source).toBe("qa");
    expect(spec.title).toContain("TypeError");
    expect(spec.payload.fromErrorGroup).toBe(groupId);
    expect(spec.payload.actual).toContain("Cannot read properties of undefined");
    // group marked escalated + linked
    const g = await prisma.errorGroup.findUnique({ where: { id: groupId } });
    expect(g!.status).toBe("escalated");
    expect(g!.specId).toBe(spec.id);
  });

  it("is idempotent: a second escalate returns the existing spec without a new one", async () => {
    const first = (await app.inject({ method: "POST", url: `/api/errors/${groupId}/escalate` })).json().spec;
    const second = await app.inject({ method: "POST", url: `/api/errors/${groupId}/escalate` });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ alreadyEscalated: true });
    expect(second.json().spec.id).toBe(first.id);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("404 for unknown group", async () => {
    expect((await app.inject({ method: "POST", url: "/api/errors/nope/escalate" })).statusCode).toBe(404);
  });
});

describe("POST /api/errors/:id/unlink", () => {
  it("resets specId + status back to new, keeping the Spec (non-destructive)", async () => {
    const spec = (await app.inject({ method: "POST", url: `/api/errors/${groupId}/escalate` })).json().spec;
    const r = await app.inject({ method: "POST", url: `/api/errors/${groupId}/unlink` });
    expect(r.statusCode).toBe(200);
    expect(r.json().specId).toBeNull();
    expect(r.json().status).toBe("new");
    const g = await prisma.errorGroup.findUnique({ where: { id: groupId } });
    expect(g!.specId).toBeNull();
    expect(g!.status).toBe("new");
    // Spec dibiarkan (bisa dihapus manual)
    expect(await prisma.spec.findUnique({ where: { id: spec.id } })).not.toBeNull();
  });

  it("lets the group be escalated again into a fresh Spec after unlink", async () => {
    const first = (await app.inject({ method: "POST", url: `/api/errors/${groupId}/escalate` })).json().spec;
    await app.inject({ method: "POST", url: `/api/errors/${groupId}/unlink` });
    const again = await app.inject({ method: "POST", url: `/api/errors/${groupId}/escalate` });
    expect(again.statusCode).toBe(201);
    expect(again.json().spec.id).not.toBe(first.id);
    expect(await prisma.spec.count()).toBe(2);
  });

  it("is idempotent when already unlinked", async () => {
    const r = await app.inject({ method: "POST", url: `/api/errors/${groupId}/unlink` });
    expect(r.statusCode).toBe(200);
    expect(r.json().specId).toBeNull();
  });

  it("404 for unknown group", async () => {
    expect((await app.inject({ method: "POST", url: "/api/errors/nope/unlink" })).statusCode).toBe(404);
  });
});

describe("PATCH /api/errors/:id", () => {
  it("updates status to resolved", async () => {
    const r = await app.inject({ method: "PATCH", url: `/api/errors/${groupId}`, payload: { status: "resolved" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("resolved");
    const g = await prisma.errorGroup.findUnique({ where: { id: groupId } });
    expect(g!.status).toBe("resolved");
  });

  it("rejects an invalid status", async () => {
    expect((await app.inject({ method: "PATCH", url: `/api/errors/${groupId}`, payload: { status: "bogus" } })).statusCode).toBe(400);
  });
});
