import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hnm-am-route-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  git("commit", "-q", "--allow-empty", "-m", "init");
  git("branch", "develop");
  return dir;
}
const patchProject = (id: string, autoMerge: unknown) =>
  app.inject({ method: "PATCH", url: `/api/projects/${id}`, payload: { autoMerge } });

describe("gerbang tulis kebijakan auto-merge (SPEC-486)", () => {
  it("409 bila project belum punya repoDir efektif", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    const r = await patchProject("p1", { mode: "default-branch", dest: "local" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/checkout lokal/);
  });

  it("mematikan auto-merge SELALU boleh, walau tanpa repoDir", async () => {
    await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
    const r = await patchProject("p2", { mode: "off" });
    expect(r.statusCode).toBe(200);
  });

  it("400 bila mode branch tanpa branch", async () => {
    await prisma.project.create({ data: { id: "p3", name: "P3", desc: "", kind: "existing", repoDir: repo() } });
    const r = await patchProject("p3", { mode: "branch", dest: "local", branch: null });
    expect(r.statusCode).toBe(400);
  });

  // SPEC-143/ADR-0032 · daftar yang memasok dropdown adalah daftar yang menjaga gerbang.
  it("400 bila branch tak ada di repo untuk dest yang dipilih", async () => {
    await prisma.project.create({ data: { id: "p4", name: "P4", desc: "", kind: "existing", repoDir: repo() } });
    const r = await patchProject("p4", { mode: "branch", dest: "local", branch: "karangan" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/karangan/);
  });

  it("menerima branch lokal yang nyata dan mengembalikannya di ProjectView", async () => {
    await prisma.project.create({ data: { id: "p5", name: "P5", desc: "", kind: "existing", repoDir: repo() } });
    const r = await patchProject("p5", { mode: "branch", dest: "local", branch: "develop", deleteBranch: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().autoMerge).toEqual({ mode: "branch", dest: "local", branch: "develop", deleteBranch: true });
  });

  it("null mengosongkan kebijakan project", async () => {
    await prisma.project.create({
      data: { id: "p6", name: "P6", desc: "", kind: "existing", repoDir: repo(),
        autoMerge: { mode: "default-branch", dest: "local", branch: null, deleteBranch: false } },
    });
    const r = await patchProject("p6", null);
    expect(r.statusCode).toBe(200);
    expect(r.json().autoMerge).toBeNull();
  });

  it("GET /projects/:id/branches memberi defaultBranch", async () => {
    await prisma.project.create({ data: { id: "p7", name: "P7", desc: "", kind: "existing", repoDir: repo() } });
    const r = await app.inject({ method: "GET", url: "/api/projects/p7/branches" });
    expect(r.json().defaultBranch).toBe("main");
  });
});

describe("override per-spec (SPEC-486)", () => {
  const spec = async (repoDir: string) => {
    await prisma.project.create({ data: { id: "px", name: "PX", desc: "", kind: "existing", repoDir } });
    await prisma.spec.create({
      data: { id: "SPEC-9", projectId: "px", title: "a", source: "brief", stage: "executing",
        priority: "sedang", author: "a", objective: "", baseSha: "abc" },
    });
  };

  // Cermin dependsOn (ADR-0093): kebijakan ini menggerbangi apa yang terjadi SESUDAH kerja,
  // bukan konten yang sedang dikerjakan sesi hidup — jadi ia di luar gerbang `editingContent`.
  it("boleh diubah walau item sudah dimulai", async () => {
    await spec(repo());
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-9",
      payload: { autoMerge: { mode: "branch", dest: "local", branch: "develop" } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().autoMerge).toEqual({ mode: "branch", dest: "local", branch: "develop", deleteBranch: false });
  });

  it("400 untuk branch karangan", async () => {
    await spec(repo());
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-9",
      payload: { autoMerge: { mode: "branch", dest: "local", branch: "karangan" } },
    });
    expect(r.statusCode).toBe(400);
  });

  it("null mengembalikan item ke warisan project", async () => {
    await spec(repo());
    await app.inject({ method: "PATCH", url: "/api/specs/SPEC-9",
      payload: { autoMerge: { mode: "off" } } });
    const r = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-9", payload: { autoMerge: null } });
    expect(r.statusCode).toBe(200);
    expect(r.json().autoMerge).toBeNull();
  });
});
