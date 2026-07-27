import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { linksOf, neighborIds, linkViews, auditScopeOf } from "../src/services/project-links";

const clean = async () => {
  await prisma.projectLink.deleteMany();
  await prisma.project.deleteMany();
};

beforeEach(async () => {
  await clean();
  await prisma.project.createMany({ data: [
    { id: "web", name: "Web", desc: "", kind: "existing" },
    { id: "api", name: "API", desc: "", kind: "existing" },
    { id: "sdk", name: "SDK", desc: "", kind: "existing" },
    { id: "lepas", name: "Lepas", desc: "", kind: "existing" },
  ] });
  await prisma.projectLink.create({ data: { fromProjectId: "web", toProjectId: "api", kind: "api", note: "web memanggil /api/orders" } });
  await prisma.projectLink.create({ data: { fromProjectId: "api", toProjectId: "sdk", kind: "sdk", note: "api memakai hanoman-sdk" } });
});
afterAll(clean);

describe("project-links", () => {
  it("mengambil relasi kedua arah milik satu project", async () => {
    const links = await linksOf("api");
    expect(links).toHaveLength(2);
  });

  it("menurunkan tetangga satu hop dari kedua arah, tanpa dirinya sendiri", async () => {
    expect(neighborIds("api", await linksOf("api")).sort()).toEqual(["sdk", "web"]);
    expect(neighborIds("web", await linksOf("web"))).toEqual(["api"]);
    expect(neighborIds("lepas", await linksOf("lepas"))).toEqual([]);
  });

  it("tidak mengikuti relasi transitif (satu hop saja)", async () => {
    expect(neighborIds("web", await linksOf("web"))).not.toContain("sdk");
  });

  it("memberi arah + nama lawan relatif project yang dilihat", async () => {
    const views = await linkViews("api", await linksOf("api"));
    const masuk = views.find((v) => v.direction === "masuk")!;
    const keluar = views.find((v) => v.direction === "keluar")!;
    expect(masuk.other).toEqual({ id: "web", name: "Web" });
    expect(masuk.kind).toBe("api");
    expect(keluar.other).toEqual({ id: "sdk", name: "SDK" });
    expect(keluar.note).toBe("api memakai hanoman-sdk");
  });

  it("scope audit = project utama lebih dulu, lalu tetangganya", async () => {
    const scope = await auditScopeOf("api");
    expect(scope[0]).toBe("api");
    expect(scope.slice(1).sort()).toEqual(["sdk", "web"]);
    expect(await auditScopeOf("lepas")).toEqual(["lepas"]);
  });

  it("hapus project menghapus relasi yang menyentuhnya (cascade FK)", async () => {
    await prisma.project.delete({ where: { id: "sdk" } });
    expect(await prisma.projectLink.count()).toBe(1);
  });
});
