import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeRepoWithBranches } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => {
  await resetDb();
  const dir = makeRepoWithBranches("feat/x");
  await makeProject({ id: "p1", repoDir: dir });
});

const post = (body: object) =>
  app.inject({ method: "POST", url: "/api/specs/batch", payload: body });

describe("SPEC-273 · POST /specs/batch", () => {
  it("membuat N spec dengan id berurutan + provenance PRD di konteks", async () => {
    const res = await post({ project: "p1", prdPath: "docs/prd/x.md",
      items: [
        { title: "A", context: "ctx-a", outcome: "out-a", priority: "tinggi" },
        { title: "B", context: "ctx-b", outcome: "out-b" },
      ] });
    expect(res.statusCode).toBe(201);
    const created = res.json().created;
    expect(created).toHaveLength(2);
    expect(created[0].source).toBe("brief");
    expect(created[0].title).toBe("A");
    expect(created[0].priority).toBe("tinggi");
    const nums = created.map((s: any) => Number(s.id.match(/\d+/)[0]));
    expect(nums[1]).toBe(nums[0] + 1);
    const row = await prisma.spec.findUnique({ where: { id: created[0].id } });
    expect((row!.payload as any).context).toContain("docs/prd/x.md");
    expect((row!.payload as any).context).toContain("ctx-a");
  });
  it("items kosong → 400", async () => {
    expect((await post({ project: "p1", items: [] })).statusCode).toBe(400);
  });
  it("project tak ada → 404", async () => {
    expect((await post({ project: "nope", items: [{ title: "A" }] })).statusCode).toBe(404);
  });
  it("branchFrom tak dikenal → 400", async () => {
    const res = await post({ project: "p1", branchFrom: "ghost", items: [{ title: "A" }] });
    expect(res.statusCode).toBe(400);
  });
  it("branchFrom valid diteruskan ke tiap spec", async () => {
    const res = await post({ project: "p1", branchFrom: "feat/x", items: [{ title: "A" }] });
    expect(res.statusCode).toBe(201);
    expect(res.json().created[0].branchFrom).toBe("feat/x");
  });
});
