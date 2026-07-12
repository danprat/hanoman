import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec, makeTempRepo, makeRepoWithBranches, makeRepoWithSpecBranch } from "./factory";
import { createSession, killAll } from "../src/services/pty";
import { fileURLToPath } from "node:url";

// /bin/cat mati seketika: --dangerously-skip-permissions ilegal baginya. Lihat pty.test.ts.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); await makeProject({ id: "p1" }); });
describe("projects routes", () => {

  it("lists project views (envelope)", async () => {
    const res = await app.inject({ url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(Array.isArray(b.items)).toBe(true);
    expect(b.total).toBe(b.items.length);
    expect(b.page).toBe(1);
    expect(b.items[0]).toHaveProperty("backlog");
  });
  // SPEC-198 · filter q (name+desc+stack) + paginasi via API.
  it("filters by q and paginates", async () => {
    await makeProject({ id: "zeta-find", name: "zeta-find", repoDir: makeTempRepo({}) });
    await makeProject({ id: "zeta-two", name: "zeta-two", repoDir: makeTempRepo({}) });
    const q = (await app.inject({ url: "/api/projects?q=zeta" })).json();
    expect(q.items.length).toBe(2);
    expect(q.items.every((p: any) => p.id.startsWith("zeta"))).toBe(true);
    const pg = (await app.inject({ url: "/api/projects?q=zeta&page=1&limit=1" })).json();
    expect(pg.items.length).toBe(1);
    expect(pg.total).toBe(2);
    expect(pg.pageSize).toBe(1);
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
  it("409s deleting a project with an active session", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("p1", process.cwd());
    const res = await app.inject({ method: "DELETE", url: "/api/projects/p1" });
    expect(res.statusCode).toBe(409);
    killAll();
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
  it("GET /projects/:id/branches returns local branches and origin remotes (SPEC-175)", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    await makeProject({ id: "pbr", repoDir });
    const res = await app.inject({ url: "/api/projects/pbr/branches" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ branches: ["hanoman/spec-1", "main"], remotes: ["hanoman/spec-1", "main"] });
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

  // SPEC-146: yang berubah label, bukan kunci. `p-patch` dibuat sendiri — `p1` sudah
  // dihapus tes "deletes a project and cascades its specs" di atas.
  it("PATCH /projects/:id renames without touching id", async () => {
    await makeProject({ id: "p-patch", name: "p-patch", desc: "lama" });
    const res = await app.inject({
      method: "PATCH", url: "/api/projects/p-patch",
      payload: { name: "Kirana App", desc: "baru" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("p-patch");
    expect(res.json().name).toBe("Kirana App");
    expect(res.json().desc).toBe("baru");
  });
  it("PATCH rejects an empty name with 400 and changes nothing", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/projects/p-patch", payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
    const after = await app.inject({ url: "/api/projects/p-patch" });
    expect(after.json().name).toBe("Kirana App");
  });
  it("PATCH 404s on an unknown project", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/projects/hantu", payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
  // Kontras DELETE (409): `id` tak bergerak, jadi sesi yang sedang jalan tak terusik.
  it("PATCH is allowed while a session is active", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("p-patch", process.cwd());
    const res = await app.inject({
      method: "PATCH", url: "/api/projects/p-patch", payload: { name: "Kirana" },
    });
    expect(res.statusCode).toBe(200);
    killAll();
  });
});
