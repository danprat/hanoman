import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { makeRepoWithBranches, makeRepoWithWorktree } from "./factory";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("route branches/specs hormati LocalBinding (SPEC-217 AC-6)", () => {
  it("GET /branches memakai path binding meski Project.repoDir null", async () => {
    const repo = makeRepoWithBranches("main", "feat-x");
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.localBinding.create({ data: { projectId: "p1", repoDir: repo } });
    const r = await app.inject({ method: "GET", url: "/api/projects/p1/branches" });
    expect(r.json().branches).toContain("feat-x");   // bukan [] karena binding diabaikan
  });

  it("GET /specs/:id/review memakai worktree di path binding (bukan 409 'belum punya repoDir')", async () => {
    const repo = makeRepoWithWorktree("SPEC-9", { "a.txt": "base\n" }, { "a.txt": "changed\n" });
    await prisma.project.create({ data: { id: "p2", name: "p2", desc: "d", kind: "existing", repoDir: null } });
    await prisma.localBinding.create({ data: { projectId: "p2", repoDir: repo } });
    await prisma.spec.create({ data: { id: "SPEC-9", projectId: "p2", title: "t", source: "brief", stage: "done", priority: "sedang", author: "x", objective: "" } });
    const r = await app.inject({ method: "GET", url: "/api/specs/SPEC-9/review" });
    expect(r.statusCode).toBe(200);   // sebelum fix: 409 "project belum punya repoDir"
  });
});
