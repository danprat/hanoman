import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { enqueueOutbox, listOutbox, clearOutbox } from "../src/services/outbox";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.syncOutbox.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("outbox service (SPEC-213 AC-17)", () => {
  it("enqueue → list; unique (entity,recordId) tak duplikat; clear removes", async () => {
    await enqueueOutbox("spec", "SPEC-1");
    await enqueueOutbox("spec", "SPEC-1"); // dedup
    expect((await listOutbox()).filter((o) => o.recordId === "SPEC-1")).toHaveLength(1);
    await clearOutbox("spec", "SPEC-1");
    expect((await listOutbox()).filter((o) => o.recordId === "SPEC-1")).toHaveLength(0);
  });

  it("create project via route enqueues outbox(project)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "op1", kind: "existing" } });
    expect(r.statusCode).toBe(201);
    const out = await listOutbox();
    expect(out.find((o) => o.entity === "project" && o.recordId === "op1")).toBeTruthy();
  });

  it("patch spec via route enqueues outbox(spec)", async () => {
    await prisma.project.create({ data: { id: "op2", name: "op2", desc: "d", kind: "existing" } });
    await prisma.spec.create({ data: { id: "SPEC-7", projectId: "op2", title: "t", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "o" } });
    await app.inject({ method: "PATCH", url: "/api/specs/SPEC-7", payload: { title: "t2" } });
    const out = await listOutbox();
    expect(out.find((o) => o.entity === "spec" && o.recordId === "SPEC-7")).toBeTruthy();
  });
});
