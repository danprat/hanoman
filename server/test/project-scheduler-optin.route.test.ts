import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(async () => { await clean(); await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } }); });
afterAll(clean);

describe("Project.schedulerOptIn", () => {
  it("defaults to false and shows in the project view", async () => {
    const r = await app.inject({ method: "GET", url: "/api/projects" });
    const p = r.json().items.find((x: any) => x.id === "p1");
    expect(p.schedulerOptIn).toBe(false);
  });
  it("PATCH toggles it on and persists", async () => {
    const r = await app.inject({ method: "PATCH", url: "/api/projects/p1", payload: { schedulerOptIn: true } });
    expect(r.statusCode).toBe(200);
    const row = await prisma.project.findUnique({ where: { id: "p1" } });
    expect(row!.schedulerOptIn).toBe(true);
  });
});
