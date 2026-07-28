import { describe, it, expect } from "vitest";
import { toWinAnsi, downloadFilename } from "../src/services/doc-export";

describe("toWinAnsi", () => {
  it("mentransliterasi panah & operator yang dipakai docs hanoman", () => {
    expect(toWinAnsi("spec → plan → execute")).toBe("spec -> plan -> execute");
    expect(toWinAnsi("a ← b ⇒ c")).toBe("a <- b => c");
    expect(toWinAnsi("x ≥ 1 ≤ 9 ≠ 0")).toBe("x >= 1 <= 9 != 0");
  });
  it("mentransliterasi tanda centang & kotak checklist", () => {
    expect(toWinAnsi("✓ ✔ ✗ ❌")).toBe("v v x x");
    expect(toWinAnsi("☐ ☑")).toBe("[ ] [x]");
  });
  it("membuang emoji tanpa menyisakan mojibake", () => {
    expect(toWinAnsi("rilis 🎉 selesai")).toBe("rilis  selesai");
    expect(toWinAnsi("🚀🔥")).toBe("");
  });
  it("membiarkan karakter WinAnsi apa adanya", () => {
    const s = "em—dash • titik · “kutip” … dokumén Café";
    expect(toWinAnsi(s)).toBe(s);
  });
  it("mengganti sisa non-Latin-1 dengan tanda tanya", () => {
    expect(toWinAnsi("漢字")).toBe("??");
  });
});

describe("downloadFilename", () => {
  it("menggabungkan prefix + basename tanpa ekstensi + ekstensi baru", () => {
    expect(downloadFilename("SPEC-361", "docs/superpowers/plans/x/plan.md", "pdf"))
      .toBe("SPEC-361-plan.pdf");
    expect(downloadFilename("proyek", "internal/docs/product/prd.md", "md"))
      .toBe("proyek-prd.md");
  });
  it("mensanitasi karakter yang tak aman untuk nama berkas", () => {
    expect(downloadFilename("a b/c", 'we"ird name.md', "md")).toBe("a-b-c-we-ird-name.md");
  });
  it("tidak pernah menghasilkan nama kosong", () => {
    expect(downloadFilename("", "", "pdf")).toBe("dokumen.pdf");
  });
});
