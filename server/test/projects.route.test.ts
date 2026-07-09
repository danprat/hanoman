import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec, makeRun, makeTempRepo, makeRepoWithBranches } from "./factory";
const app = buildApp();
beforeAll(async () => { await resetDb(); await makeProject({ id: "p1" }); });
describe("projects routes", () => {

  it("lists project views", async () => {
    const res = await app.inject({ url: "/api/projects" });
    expect(res.statusCode).toBe(200); expect(res.json().length).toBe(1);
    expect(res.json()[0]).toHaveProperty("backlog");
  });
  it("creates a from-scratch project", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/projects",
      payload: { name: "kirana", kind: "from-scratch", desc: "marketplace" }
    });
    expect(res.statusCode).toBe(201); expect(res.json().id).toBe("kirana");
  });
  it("409s on a duplicate project id (not 500)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/projects",
      payload: { name: "kirana", kind: "from-scratch", desc: "again" }
    }); // created above
    expect(res.statusCode).toBe(409);
  });
  // SPEC-141: dua-duanya baca yang sama dari disk, tanpa POST /scan sama sekali.
  it("a newly created project already shows real coverage — no scan (SPEC-141)", async () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
    });
    const res = await app.inject({
      method: "POST", url: "/api/projects",
      payload: { name: "auto-scan", kind: "existing", repoDir: dir }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().coverage).toBe(100);
    expect(res.json().docStatus).toBe("ok");
  });

  // Arah sebaliknya: nilai tersimpan yang optimistis tidak boleh menang atas disk.
  it("disk beats the stored value when docs go unlinked (SPEC-141)", async () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
      "internal/docs/loose/orphan.md": "# orphan",   // tak ter-link -> nyatanya 50%
    });
    await makeProject({ id: "p-cov", repoDir: dir });
    const res = await app.inject({ url: "/api/projects/p-cov" });
    expect(res.json().coverage).toBe(50);
    expect(res.json().docStatus).toBe("broken");
  });

  // Project from-scratch: tak ada repoDir untuk di-scan. Harus 0/broken, bukan crash.
  it("a project without repoDir reports 0 / broken, no crash (SPEC-141)", async () => {
    const res = await app.inject({ url: "/api/projects/p1" });   // p1 di beforeAll, repoDir null
    expect(res.statusCode).toBe(200);
    expect(res.json().coverage).toBe(0);
    expect(res.json().docStatus).toBe("broken");
  });

  it("POST /scan is gone (SPEC-141)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/scan" });
    expect(res.statusCode).toBe(404);
  });
  it("rejects invalid create body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { kind: "x" } });
    expect(res.statusCode).toBe(400);
  });
  it("404s deleting an unknown project", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/projects/nope" });
    expect(res.statusCode).toBe(404);
  });
  it("409s deleting a project with an active run", async () => {
    await makeRun({ id: "RUN-active", projectId: "p1", status: "running" });
    const res = await app.inject({ method: "DELETE", url: "/api/projects/p1" });
    expect(res.statusCode).toBe(409);
    await prisma.run.delete({ where: { id: "RUN-active" } });
  });
  it("deletes a project and cascades its specs", async () => {
    await makeSpec({ id: "SPEC-del", projectId: "p1" });
    const res = await app.inject({ method: "DELETE", url: "/api/projects/p1" });
    expect(res.statusCode).toBe(204);
    expect(await prisma.project.findUnique({ where: { id: "p1" } })).toBeNull();
    expect(await prisma.spec.count({ where: { id: "SPEC-del" } })).toBe(0);
  });
  // SPEC-143: daftar branch memasok dropdown backlog dan whitelist validasi.
  it("GET /projects/:id/branches lists the repo's branches", async () => {
    await makeProject({ id: "pb", repoDir: makeRepoWithBranches("dev") });
    const res = await app.inject({ url: "/api/projects/pb/branches" });
    expect(res.statusCode).toBe(200);
    expect(res.json().branches).toContain("main");
  });
  it("GET /projects/:id/branches: no repoDir → []", async () => {
    await makeProject({ id: "pn", repoDir: null });
    const res = await app.inject({ url: "/api/projects/pn/branches" });
    expect(res.statusCode).toBe(200);
    expect(res.json().branches).toEqual([]);
  });
  it("GET /projects/:id/branches: unknown project → 404", async () => {
    const res = await app.inject({ url: "/api/projects/hantu/branches" });
    expect(res.statusCode).toBe(404);
  });
});
