import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { renderDocPdf, inlineText } from "../src/services/doc-export";

const META = { eyebrow: "hanoman · SPEC-361", path: "docs/x.md" };

// Membaca teks yang BENAR-BENAR tergambar di PDF: inflate tiap content stream lalu decode
// literal heksa `<...>` milik operator TJ. Tanpa ini, test hanya bisa memastikan berkasnya
// PDF — bukan bahwa isinya benar (mojibake pdfkit tak melempar error, jadi lolos senyap).
function pdfText(buf: Buffer): string {
  const chunks: string[] = [];
  let i = 0;
  for (;;) {
    const s = buf.indexOf("stream", i);
    if (s < 0) break;
    let p = s + 6;
    if (buf[p] === 13) p++;
    if (buf[p] === 10) p++;
    const e = buf.indexOf("endstream", p);
    if (e < 0) break;
    try { chunks.push(zlib.inflateSync(buf.subarray(p, e)).toString("latin1")); } catch { /* bukan stream terkompresi */ }
    i = e + 9;
  }
  return [...chunks.join("\n").matchAll(/<([0-9a-f]+)>/g)]
    .map((m) => Buffer.from(m[1]!, "hex").toString("latin1")).join("");
}

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
    const buf = await renderDocPdf("alur: spec → plan 🎉 selesai", "x.md", META);
    const text = pdfText(buf);
    // Tanpa toWinAnsi, pdfkit menggambar "alur: spec ! plan Ø<ß selesai" — TANPA melempar
    // error (sudah diukur langsung ke pdfkit). Kedua asersi di bawah itu yang menangkapnya.
    expect(text).toContain("alur: spec -> plan  selesai");
    expect(text).not.toContain("Ø<ß");
  });

  it("menulis kop halaman & footer bernomor", async () => {
    const text = pdfText(await renderDocPdf("# Judul\n\nisi.", "rencana.md", META));
    expect(text).toContain("HANOMAN");        // eyebrow di kop
    expect(text).toContain("rencana.md");     // nama dokumen
    expect(text).toContain("docs/x.md");      // path (kop + footer)
    expect(text).toContain("hal.");           // footer bernomor
    expect(text).toContain("1/1");
  });

  it("men-decode entitas HTML sampai ke teks yang tergambar", async () => {
    const text = pdfText(await renderDocPdf("worktree sesi hidup > repoDir", "x.md", META));
    expect(text).toContain("worktree sesi hidup > repoDir");
    expect(text).not.toContain("&gt;");
  });
});
