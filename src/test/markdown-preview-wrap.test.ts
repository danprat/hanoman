import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* SPEC-363 · pratinjau dokumen tidak boleh menggulir ke SAMPING.
   jsdom tak punya mesin layout, jadi `scrollWidth` selalu 0 dan overflow tak bisa diukur di
   sini. Angkanya diukur di Chrome headless atas 353 berkas `.md` nyata (lihat
   internal/docs/research/audit-spec-363-preview-docs-menggulir-samping.md):
     · 33 dokumen membuat pane menggulir horizontal  -> 0 sesudah aturan di bawah
     · 187 dokumen punya <pre> yang harus digulir     -> 0 sesudah aturan di bawah
   Yang dijaga test ini adalah aturannya tetap ADA — kalau salah satu deklarasi dicabut,
   kedua angka itu kembali tanpa ada yang gagal. */

const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8");

// Ambil badan satu selector `.hn-md…` (satu blok, bukan seluruh berkas) supaya deklarasi
// tak bisa lolos hanya karena kebetulan ada di selector lain.
function block(selector: string): string {
  const i = css.indexOf(selector + " {");
  if (i < 0) throw new Error(`selector tak ditemukan di app.css: ${selector}`);
  return css.slice(i, css.indexOf("}", i));
}

describe(".hn-md · anti gulir horizontal (SPEC-363)", () => {
  it("memutus rangkaian panjang tanpa spasi di seluruh dokumen", () => {
    // Tersangka utama BUKAN tabel, melainkan rantai inline `code` tanpa spasi
    // (plan SPEC-257:1189 -> hOverflow 1199 px di pane modal 586 px).
    expect(block(".hn-md")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("mencegah tabel lebar mendorong container", () => {
    // `width:100%` saja tak cukup: tabel tak bisa menyusut di bawah min-content-nya
    // (terukur 1122 px). `table-layout: fixed` sekaligus menyamakan pratinjau dengan PDF,
    // yang memang memakai lebar kolom rata (ADR-0078 §3).
    expect(block(".hn-md table")).toMatch(/table-layout:\s*fixed/);
    expect(block(".hn-md th, .hn-md td")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("membungkus baris panjang di blok kode alih-alih menggulirkannya", () => {
    // api-contract.md punya blok kode selebar 3089 px di pane 586 px (5,3x) — tak terbaca
    // tanpa menggulir menyamping.
    const pre = block(".hn-md pre");
    expect(pre).toMatch(/white-space:\s*pre-wrap/);
    expect(pre).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("tetap menyisakan gulir-x sebagai jaring pengaman, bukan sebagai cara membaca", () => {
    // Kalau ada isi yang benar-benar tak bisa dibungkus, ia menggulir DI DALAM kotaknya —
    // bukan mendorong prosa di sekitarnya.
    expect(block(".hn-md pre")).toMatch(/overflow(-x)?:\s*auto/);
  });
});
