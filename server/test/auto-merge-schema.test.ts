import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { __FIELDS_FOR_TEST } from "../src/services/sync";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("kolom autoMerge (SPEC-486 · ADR-0103)", () => {
  it("Project.autoMerge menyimpan blok kebijakan dan membacanya kembali", async () => {
    await prisma.project.create({
      data: {
        id: "p1", name: "P1", desc: "", kind: "existing",
        autoMerge: { mode: "branch", dest: "origin", branch: "develop", deleteBranch: false },
      },
    });
    const row = await prisma.project.findUnique({ where: { id: "p1" } });
    expect(row!.autoMerge).toEqual({ mode: "branch", dest: "origin", branch: "develop", deleteBranch: false });
  });

  it("baris lama tetap null — nol backfill, perilaku project lama utuh", async () => {
    await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
    const row = await prisma.project.findUnique({ where: { id: "p2" } });
    expect(row!.autoMerge).toBeNull();
  });

  it("Spec.autoMerge menyimpan override per item", async () => {
    await prisma.project.create({ data: { id: "p3", name: "P3", desc: "", kind: "existing" } });
    await prisma.spec.create({
      data: {
        id: "SPEC-1", projectId: "p3", title: "a", source: "brief", stage: "done",
        priority: "sedang", author: "a", objective: "", autoMerge: { mode: "off" },
      },
    });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-1" } });
    expect(row!.autoMerge).toEqual({ mode: "off" });
  });

  // Kebijakan auto-merge adalah kebijakan EKSEKUSI mesin ini: nama branch tujuan properti
  // checkout lokal, dan mesin yang menjalankan sesi adalah mesin yang mendaratkan hasilnya.
  // Cermin repoDir / schedulerOptIn / leadOptIn.
  it("TIDAK ikut menyeberang sync (LOCAL-only)", () => {
    expect(__FIELDS_FOR_TEST.project).not.toContain("autoMerge");
    expect(__FIELDS_FOR_TEST.spec).not.toContain("autoMerge");
    expect(__FIELDS_FOR_TEST.spec).toContain("dependsOn");   // kontrol negatif
  });
});
