import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("Spec.dependsOn (SPEC-447)", () => {
  it("kolom menyimpan array id dan dibaca kembali apa adanya", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "a", source: "brief", stage: "done", priority: "sedang", author: "a", objective: "" } });
    await prisma.spec.create({ data: { id: "SPEC-2", projectId: "p1", title: "b", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "", dependsOn: ["SPEC-1"] } });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-2" } });
    expect(row!.dependsOn).toEqual(["SPEC-1"]);
  });

  // Tanpa baris ini, spec asal-hub kehilangan dependency-nya di tiap client — dan client akan
  // meluncurkan pekerjaan yang di hub terblokir.
  it("dependsOn ikut menyeberang sync (FIELDS.spec)", async () => {
    const { __FIELDS_FOR_TEST } = await import("../src/services/sync");
    expect(__FIELDS_FOR_TEST.spec).toContain("dependsOn");
  });
});
