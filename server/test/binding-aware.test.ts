import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { makeTempRepo } from "./factory";
import { docIndex } from "../src/services/docs";
import { toProjectView } from "../src/services/project-view";

const clean = async () => {
  await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

// Repo docs ter-link penuh (README menaut prd) → coverage 100 (pola scan.test.ts).
const LINKED_DOCS = {
  "internal/docs/README.md": "- [prd](product/prd.md)",
  "internal/docs/product/prd.md": "# prd",
};

describe("service baca-path menghormati LocalBinding (SPEC-217 AC-6)", () => {
  it("docIndex memindai path binding meski Project.repoDir null", async () => {
    const repo = makeTempRepo(LINKED_DOCS);
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.localBinding.create({ data: { projectId: "p1", repoDir: repo } });
    const idx = await docIndex("p1");
    expect(idx.tree.length).toBeGreaterThan(0);   // path binding terbaca, bukan null → kosong
  });

  it("coverage project-view dihitung dari path binding", async () => {
    const repo = makeTempRepo(LINKED_DOCS);
    const p = await prisma.project.create({ data: { id: "p2", name: "p2", desc: "d", kind: "existing", repoDir: null } });
    await prisma.localBinding.create({ data: { projectId: "p2", repoDir: repo } });
    const view = await toProjectView(p, []);
    expect(view.coverage).toBeGreaterThan(0);     // bukan 0 "broken"
  });
});
