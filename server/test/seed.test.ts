import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db";
import { seed } from "../prisma/seed";
describe("seed", () => {
  beforeAll(async () => { await seed(); });
  it("loads the 6 demo projects", async () => { expect(await prisma.project.count()).toBe(6); });
  it("loads the 6 backlog specs", async () => { expect(await prisma.spec.count()).toBe(6); });
  it("loads the 5 runs", async () => { expect(await prisma.run.count()).toBe(5); });
  it("arta has coverage 94", async () => {
    const a = await prisma.project.findUnique({ where: { id: "arta" } }); expect(a?.coverage).toBe(94); });
  it("seeds loka-pos doc categories from docTree", async () => {
    expect(await prisma.docFile.count({ where: { projectId: "loka-pos" } })).toBeGreaterThan(0); });
});
