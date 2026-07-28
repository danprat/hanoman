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

// SPEC-363 · pembukuan halaman. `pdfText` menggabungkan semua halaman, jadi ia tak bisa
// membedakan "isi ada di halaman 1" dari "isi ada di halaman tambahan yang kosong". Tiap
// halaman pdfkit punya tepat satu content stream, dan hanya halaman yang punya operator
// `Tf` — semua halaman punya, karena footer selalu digambar.
function pdfPageStreams(buf: Buffer): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const s = buf.indexOf("stream", i);
    if (s < 0) break;
    let p = s + 6;
    if (buf[p] === 13) p++;
    if (buf[p] === 10) p++;
    const e = buf.indexOf("endstream", p);
    if (e < 0) break;
    try {
      const t = zlib.inflateSync(buf.subarray(p, e)).toString("latin1");
      if (t.includes("Tf")) out.push(t);
    } catch { /* bukan stream terkompresi */ }
    i = e + 9;
  }
  return out;
}
const decode = (stream: string) => [...stream.matchAll(/<([0-9a-f]+)>/g)]
  .map((m) => Buffer.from(m[1]!, "hex").toString("latin1")).join("");
const pdfPageTexts = (buf: Buffer) => pdfPageStreams(buf).map(decode);
// Operator `x y w h re` memakai koordinat pdfkit (top-down) karena page stream dibuka
// dengan `1 0 0 -1 0 <height> cm`.
const pdfPageRects = (buf: Buffer) => pdfPageStreams(buf).map((t) =>
  [...t.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g)].map((m) => ({ y: +m[2]!, h: +m[4]! })));

const A4_H = 841.89, BOTTOM = 60;
const codeBlock = (n: number) => "```\n" + Array.from({ length: n }, (_, i) => `baris kode nomor ${i}`).join("\n") + "\n```\n";

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

// SPEC-363 · "download .pdf jadi harus scrolling juga". Diaudit: PDF berhalaman jauh lebih
// banyak daripada yang isinya butuhkan — separuhnya kosong — dan blok kode besar meninggalkan
// pias kosong lalu latarnya menabrak footer.
describe("renderDocPdf · pembukuan halaman (SPEC-363)", () => {
  it("dokumen sependek satu paragraf hanya menghasilkan satu halaman", async () => {
    // Sebelum: footer ber-`width`+`align:"right"` menjalankan pembungkus baris pdfkit, yang
    // memeriksa batas bawah halaman lalu `addPage()` — jadi SETIAP halaman melahirkan satu
    // halaman kosong di belakangnya.
    const buf = await renderDocPdf("Satu paragraf saja.", "x.md", META);
    expect(pdfPageTexts(buf).length).toBe(1);
  });

  it("nomor halaman tercetak di halaman itu sendiri", async () => {
    // Sebelum: `addPage()` terjadi DI TENGAH panggilan teks nomor halaman, jadi "hal. 1/1"
    // mendarat di halaman kosong berikutnya dan halaman 1 tak bernomor sama sekali.
    const pages = pdfPageTexts(await renderDocPdf("Satu paragraf saja.", "x.md", META));
    expect(pages[0]).toContain("hal. 1/1");
  });

  it("menomori setiap halaman dokumen banyak halaman", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `Baris paragraf nomor ${i}.`).join("\n\n");
    const pages = pdfPageTexts(await renderDocPdf(long, "panjang.md", META));
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((p, i) => expect(p).toContain(`hal. ${i + 1}/${pages.length}`));
  });

  it("tidak menyisakan halaman kosong tanpa isi", async () => {
    const md = "Paragraf penanda.\n\n" + codeBlock(200);
    const pages = pdfPageTexts(await renderDocPdf(md, "x.md", META));
    // Halaman yang isinya cuma footer = halaman kosong yang tetap harus digulir.
    const kosong = pages.filter((p) => !/baris kode nomor|Paragraf penanda/.test(p));
    expect(kosong).toEqual([]);
  });

  it("tidak memindahkan blok kode ke halaman baru kalau blok itu tak akan muat di mana pun", async () => {
    // Sebelum: `doc.y + h > batas` selalu benar untuk blok yang lebih tinggi dari satu
    // halaman penuh, jadi pdfkit pindah halaman lalu bloknya TETAP tak muat — halaman
    // sebelumnya tertinggal kosong 35–55%.
    const md = "Paragraf penanda.\n\n" + codeBlock(200);
    const pages = pdfPageTexts(await renderDocPdf(md, "x.md", META));
    expect(pages[0]).toContain("Paragraf penanda.");
    expect(pages[0]).toContain("baris kode nomor 0");
  });

  it("tetap memindahkan blok kode yang MUAT di halaman berikutnya", async () => {
    // Kebalikan dari test di atas: blok kecil yang tak lagi muat di sisa halaman tetap
    // dipindahkan utuh, bukan dipotong dua.
    const md = Array.from({ length: 40 }, (_, i) => `Paragraf pengisi nomor ${i}.`).join("\n\n")
      + "\n\n" + codeBlock(12);
    const pages = pdfPageTexts(await renderDocPdf(md, "x.md", META));
    const mulai = pages.findIndex((p) => p.includes("baris kode nomor 0"));
    expect(mulai).toBeGreaterThanOrEqual(0);
    expect(pages[mulai]).toContain("baris kode nomor 11");
  });

  it("daftar panjang tidak melahirkan halaman kosong", async () => {
    // Akar yang sama dengan footer: penanda butir digambar di posisi EKSPLISIT sekaligus
    // ber-`width`, dan `width` menyalakan pembungkus baris pdfkit -> `addPage()` di tepi
    // bawah halaman. Sesudahnya `doc.y = top` memasang koordinat halaman LAMA di halaman
    // BARU, jadi butir berikutnya memicu pindah lagi — halaman kosong berselang-seling.
    // Terlihat nyata di docs/prd/hardening-vps-checklist.md: 5 dari 12 halaman kosong.
    const md = Array.from({ length: 120 }, (_, i) => `- butir daftar nomor ${i}`).join("\n");
    const pages = pdfPageTexts(await renderDocPdf(md, "x.md", META));
    const kosong = pages.filter((p) => !/butir daftar nomor/.test(p));
    expect(kosong).toEqual([]);
  });

  it("dokumen campuran (heading + daftar + tabel + kode) tak punya halaman kosong", async () => {
    // Bentuk dokumen hanoman yang sebenarnya; menjaga agar tak ada jalur gambar lain yang
    // menyelipkan halaman kosong.
    const md = Array.from({ length: 8 }, (_, s) => [
      `## Bagian ${s}`,
      Array.from({ length: 14 }, (_, i) => `- butir ${s}.${i} dengan penjelasan secukupnya`).join("\n"),
      "", "| Kolom A | Kolom B |", "| --- | --- |",
      ...Array.from({ length: 6 }, (_, i) => `| sel ${s}.${i} | nilai ${s}.${i} |`),
      "", codeBlock(18),
      "> kutipan penutup bagian.",
    ].join("\n")).join("\n\n");
    const pages = pdfPageTexts(await renderDocPdf(md, "x.md", META));
    const kosong = pages.filter((p) => !/butir |sel |baris kode nomor|Bagian |kutipan/.test(p));
    expect(kosong).toEqual([]);
  });

  it("latar blok kode tak pernah melewati batas bawah halaman", async () => {
    // Sebelum: `rect(left, y, w, h)` dengan `h` setinggi SELURUH blok — terukur 2126,6 pt di
    // halaman 841,89 pt — jadi latar krem dan teksnya menimpa garis & teks footer.
    const md = "Paragraf penanda.\n\n" + codeBlock(200);
    const rects = pdfPageRects(await renderDocPdf(md, "x.md", META));
    for (const page of rects) {
      for (const r of page) expect(r.y + r.h).toBeLessThanOrEqual(A4_H - BOTTOM + 0.5);
    }
  });
});
