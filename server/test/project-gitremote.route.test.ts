import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

// Gate lewat: uji perilaku data, bukan auth.
const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("project tanpa path + gitRemote (SPEC-213 AC-5)", () => {
  it("create project tanpa repoDir, dengan gitRemote → 201 + view", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/projects",
      payload: { name: "hub-only", kind: "existing", gitRemote: "https://github.com/x/y.git" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ repoDir: null, gitRemote: "https://github.com/x/y.git" });
  });
  it("project murni-metadata tampil di list tanpa error", async () => {
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "hub-only", kind: "existing", gitRemote: "https://github.com/x/y.git" } });
    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(list.statusCode).toBe(200);
    const items = list.json().items;
    expect(items.find((p: { id: string }) => p.id === "hub-only")).toMatchObject({ gitRemote: "https://github.com/x/y.git", repoDir: null });
  });
});
