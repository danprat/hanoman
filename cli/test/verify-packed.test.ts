import { describe, it, expect } from "vitest";
import { verifyPackedDeps, packageJsonFor, RUNTIME_DEPS } from "../src/release/pack";

// SPEC-403 · `hanoman@0.1.3` terbit TANPA dependency `prisma` dan mati di instalasi baru
// ("`prisma generate` gagal"). Tarball yang di-smoke-test sehat (9 deps); yang dikirim tidak
// (8 deps). Sebabnya terukur & bisa diulang: `npm i -g --prefix <dir> <tarball>` yang dijalankan
// dengan **cwd di `dist-npm`** MENULIS ULANG `dist-npm/package.json` — membuang `prisma` dan
// menaikkan `@prisma/client`. Artinya smoke test itu sendiri yang merusak paket, SESUDAH artefak
// sehat dirakit. `npm publish` lalu mengirim berkas yang sudah tercemar.
//
// Pagarnya harus hidup di `prepublishOnly` (dijalankan npm tepat sebelum publish), bukan di
// `__pack`: mutasinya terjadi SESUDAH pack. Ini juga satu-satunya lapis yang menangkap mutasi dari
// perintah apa pun di masa depan, bukan hanya dari perintah yang kebetulan sudah kita kenali.
describe("verifyPackedDeps", () => {
  const ok = packageJsonFor("1.2.3", Object.fromEntries(RUNTIME_DEPS.map((d) => [d, "^1.0.0"])));

  it("paket hasil rakitan yang utuh → tak ada keluhan", () => {
    expect(verifyPackedDeps(ok)).toEqual([]);
  });

  it("dependency wajib yang hilang disebut NAMANYA", () => {
    const rusak = { ...ok, dependencies: { ...(ok as { dependencies: Record<string, string> }).dependencies } };
    delete rusak.dependencies["prisma"];
    const keluhan = verifyPackedDeps(rusak);
    expect(keluhan).toHaveLength(1);
    expect(keluhan[0]).toContain("prisma");
  });

  // Bentuk kegagalan 0.1.3 PERSIS: satu-satunya yang hilang adalah CLI prisma, dan tanpa itu
  // `ensurePrismaClient` tak punya apa pun untuk dijalankan → paket tak bisa start sama sekali.
  it("mengenali bentuk kegagalan 0.1.3 (8 deps, prisma hilang)", () => {
    const rusak = {
      ...ok,
      dependencies: {
        "@fastify/cookie": "^9.4.0", "@fastify/static": "^7.0.0", "@fastify/websocket": "^10.0.1",
        "@prisma/client": "^6.19.3", fastify: "^4.28.0", "node-pty": "^1.1.0",
        pdfkit: "^0.19.1", pg: "^8.13.1",
      },
    };
    expect(verifyPackedDeps(rusak).join(" ")).toMatch(/prisma/);
  });

  it("package.json tanpa blok dependencies sama sekali → semua dikeluhkan, bukan lolos", () => {
    expect(verifyPackedDeps({ name: "hanoman" })).toHaveLength(RUNTIME_DEPS.length);
  });

  it("dependency EKSTRA tidak dipermasalahkan — pagar ini soal yang HILANG", () => {
    const plus = { ...ok, dependencies: { ...(ok as { dependencies: Record<string, string> }).dependencies, zod: "^3.0.0" } };
    expect(verifyPackedDeps(plus)).toEqual([]);
  });
});

// Tanpa entri ini npm tak pernah memanggil pagar di atas, dan seluruh test di berkas ini jadi
// teater: fungsinya benar, tapi tak ada yang menjalankannya saat publish.
describe("packageJsonFor · gerbang prepublishOnly", () => {
  const pkg = packageJsonFor("1.2.3", { prisma: "^6.19.0" }) as { scripts: Record<string, string> };

  it("memasang prepublishOnly yang menjalankan verifikasi", () => {
    expect(pkg.scripts.prepublishOnly).toBeTruthy();
    expect(pkg.scripts.prepublishOnly).toContain("__verify");
  });

  it("postinstall lama tidak ikut hilang", () => {
    expect(pkg.scripts.postinstall).toContain("prisma generate");
  });
});
