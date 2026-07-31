import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.syncOutbox.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("POST /api/projects/:id/rename (SPEC-255)", () => {
  it("200 + id baru + helpUrl saat helpEnabled", async () => {
    await prisma.project.create({ data: { id: "old", name: "old", desc: "d", kind: "existing", helpEnabled: true } });
    const res = await app.inject({ method: "POST", url: "/api/projects/old/rename", payload: { newId: "new-x" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("new-x");
    expect(body.helpUrl).toContain("/help/new-x");
    expect(body.affected).toBeTruthy();
    expect(await prisma.project.findUnique({ where: { id: "new-x" } })).not.toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "old" } })).toBeNull();
  });

  it("409 saat newId dipakai; 404 saat project tak ada; 400 saat slug jelek", async () => {
    await prisma.project.create({ data: { id: "a", name: "a", desc: "d", kind: "existing" } });
    await prisma.project.create({ data: { id: "b", name: "b", desc: "d", kind: "existing" } });
    expect((await app.inject({ method: "POST", url: "/api/projects/a/rename", payload: { newId: "b" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/projects/ghost/rename", payload: { newId: "z" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/projects/a/rename", payload: { newId: "Bad" } })).statusCode).toBe(400);
  });
});
