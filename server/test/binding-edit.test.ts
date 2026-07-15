import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resolveRepoDir } from "../src/services/local-binding";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.localBinding.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);
const mkProj = () => prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });

describe("edit path project (SPEC-217 AC-3/4/5/8)", () => {
  it("PATCH /projects/:id repoDir memperbarui Project.repoDir", async () => {
    await mkProj();
    const r = await app.inject({ method: "PATCH", url: "/api/projects/p1", payload: { repoDir: "/srv/x" } });
    expect(r.statusCode).toBe(200);
    expect((await prisma.project.findUnique({ where: { id: "p1" } }))!.repoDir).toBe("/srv/x");
  });

  it("ProjectView.binding memuat nilai LocalBinding", async () => {
    await mkProj();
    await app.inject({ method: "PUT", url: "/api/projects/p1/binding", payload: { repoDir: "/tmp/b" } });
    const view = await app.inject({ method: "GET", url: "/api/projects/p1" });
    expect(view.json()).toMatchObject({ binding: "/tmp/b" });
  });

  it("DELETE binding mengosongkan override → resolve jatuh ke Project.repoDir", async () => {
    await prisma.project.create({ data: { id: "p2", name: "p2", desc: "d", kind: "existing", repoDir: "/srv/def" } });
    await app.inject({ method: "PUT", url: "/api/projects/p2/binding", payload: { repoDir: "/tmp/b" } });
    expect(await resolveRepoDir("p2")).toBe("/tmp/b");
    const del = await app.inject({ method: "DELETE", url: "/api/projects/p2/binding" });
    expect(del.statusCode).toBe(204);
    expect(await resolveRepoDir("p2")).toBe("/srv/def");
  });
});
