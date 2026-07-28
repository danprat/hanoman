import { describe, it, expect } from "vitest";
import { renderDocPdf, inlineText } from "../src/services/doc-export";

const META = { eyebrow: "hanoman · SPEC-361", path: "docs/x.md" };

// Dua bug nyata yang tertangkap saat memeriksa PDF hasil render dengan mata.
describe("inlineText", () => {
  it("men-decode entitas HTML yang diserahkan marked", () => {
    // Tanpa ini, `worktree > repoDir` tercetak `worktree &gt; repoDir` di PDF.
    expect(inlineText("worktree &gt; repoDir &amp; &lt;x&gt;")).toBe("worktree > repoDir & <x>");
    expect(inlineText("&quot;kutip&quot; &#39;satu&#39;")).toBe('"kutip" \'satu\'');
  });
  it("menjadikan soft line break sebagai spasi, bukan pemutus baris", () => {
    // marked dipakai `breaks:false` (sama seperti preview). `\n` yang lolos ke pdfkit
    // memutus rantai `continued` dan membuat run berikutnya menimpa yang sebelumnya.
    expect(inlineText("tinggi\nADR")).toBe("tinggi ADR");
    expect(inlineText("satu\n   dua")).toBe("satu dua");
  });
  it("membiarkan teks biasa apa adanya", () => {
    expect(inlineText("teks biasa")).toBe("teks biasa");
  });
});

describe("renderDocPdf", () => {
  it("menghasilkan PDF yang valid", async () => {
    const buf = await renderDocPdf("# Judul\n\nSatu paragraf.", "x.md", META);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.subarray(-6).toString().trim()).toBe("%%EOF");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("merender semua jenis token tanpa melempar", async () => {
    const md = [
      "# H1", "## H2", "### H3", "#### H4",
      "Paragraf dengan **tebal**, *miring*, `kode`, ~~coret~~, dan [tautan](https://x.id).",
      "- butir satu", "- butir dua", "  - bersarang", "",
      "1. berurut satu", "2. berurut dua", "",
      "- [ ] belum", "- [x] sudah", "",
      "> kutipan", "", "---", "",
      "```ts", "const x: number = 1;", "```", "",
      "| Kolom A | Kolom B |", "| --- | --- |", "| satu | dua |",
    ].join("\n");
    const buf = await renderDocPdf(md, "x.md", META);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("membungkus berkas non-.md sebagai satu blok kode", async () => {
    const buf = await renderDocPdf("const a = 1;\n", "server/src/x.ts", META);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("tidak melempar pada dokumen kosong", async () => {
    const buf = await renderDocPdf("", "kosong.md", META);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("membuat lebih dari satu halaman untuk dokumen panjang", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `Baris paragraf nomor ${i}.`).join("\n\n");
    const buf = await renderDocPdf(long, "panjang.md", META);
    // Setiap halaman menghasilkan satu objek /Type /Page (bukan /Pages).
    const pages = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });

  it("menyanitasi glyph di luar WinAnsi (tak ada mojibake panah)", async () => {
    const buf = await renderDocPdf("alur: spec → plan 🎉", "x.md", META);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
