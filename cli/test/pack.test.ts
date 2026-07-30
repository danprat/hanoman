import { describe, it, expect } from "vitest";
import { packageJsonFor, copyPlan, RUNTIME_DEPS, REQUIRED_ARTIFACTS, PKG_NAME } from "../src/release/pack";

describe("packageJsonFor", () => {
  const pkg = packageJsonFor("1.2.3", { fastify: "^4.28.0", prisma: "^6.19.0" }) as Record<string, any>;

  it("nama & versi & bin", () => {
    expect(pkg.name).toBe(PKG_NAME);
    expect(pkg.version).toBe("1.2.3");
    expect(pkg.bin).toEqual({ hanoman: "bin/hanoman.mjs" });
  });
  it("ESM + engine node ≥20", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toBe(">=20");
  });
  it("BUKAN private — paket ini memang diterbitkan", () => {
    expect(pkg.private).toBeUndefined();
  });
  it("hanya dependency yang disebutkan yang masuk", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["fastify", "prisma"]);
  });
  it("files memuat seluruh artefak runtime", () => {
    for (const f of ["bin", "dist", "web", "prisma"]) expect(pkg.files).toContain(f);
  });
  // Regresi: tanpa ini `npm i -g` sukses tapi server mati seketika dengan
  // "@prisma/client did not initialize yet" — client Prisma adalah kode ter-generate.
  it("postinstall men-generate Prisma client, non-fatal bila script dilewati", () => {
    expect(pkg.scripts.postinstall).toContain("prisma generate");
    expect(pkg.scripts.postinstall).toContain("prisma/schema.prisma");
    expect(pkg.scripts.postinstall).toContain("|| true");
  });
});

describe("copyPlan", () => {
  const plan = copyPlan("/repo");
  const to = plan.map((p) => p.to);

  it("membawa dua bundle, SPA, dan prisma", () => {
    expect(to).toContain("dist/server.js");
    expect(to).toContain("dist/cli.js");
    expect(to).toContain("web");
    expect(to).toContain("prisma/schema.prisma");
    expect(to).toContain("prisma/migrations");
  });
  it("sumbernya di dalam repo yang diberikan", () => {
    for (const p of plan) expect(p.from.startsWith("/repo/")).toBe(true);
  });
  it("SPA & migrations disalin sebagai direktori", () => {
    expect(plan.find((p) => p.to === "web")?.dir).toBe(true);
    expect(plan.find((p) => p.to === "prisma/migrations")?.dir).toBe(true);
  });
  it("tak ada tujuan ganda", () => {
    expect(new Set(to).size).toBe(to.length);
  });
});

describe("RUNTIME_DEPS", () => {
  it("memuat semua external esbuild server + prisma CLI + pg", () => {
    for (const d of ["fastify", "@fastify/static", "@fastify/websocket", "@fastify/cookie",
                     "@prisma/client", "node-pty", "pdfkit", "prisma", "pg"]) {
      expect(RUNTIME_DEPS).toContain(d);
    }
  });
  it("tak memuat paket workspace (semuanya sudah dibundel esbuild)", () => {
    for (const d of RUNTIME_DEPS) expect(d.startsWith("@hanoman/")).toBe(false);
  });
});

describe("REQUIRED_ARTIFACTS", () => {
  it("menuntut entry bin & index dashboard ada", () => {
    expect(REQUIRED_ARTIFACTS).toContain("bin/hanoman.mjs");
    expect(REQUIRED_ARTIFACTS).toContain("web/index.html");
    expect(REQUIRED_ARTIFACTS).toContain("prisma/schema.prisma");
  });
});
