# Unduh dokumen `.md` / `.pdf` (SPEC-361) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap pratinjau dokumen Markdown di hanoman (Backlog, Terminal, PRD, Docs, IDE) mendapat tombol unduh `.md` mentah dan `.pdf`, sehingga dokumen bisa dibagikan sebagai evidence ke tim.

**Architecture:** Query opsional `?download=md|pdf` ditambahkan ke **empat endpoint dokumen yang sudah ada** (tanpa endpoint baru, tanpa perubahan skema). Service baru `server/src/services/doc-export.ts` mem-parse Markdown dengan `marked.lexer()` — parser yang sama dengan preview — lalu menggambar token ke `pdfkit`. Frontend hanya menambah sepasang `<a download>` yang menunjuk URL itu; tak ada logika render di klien.

**Tech Stack:** Fastify 4 · `pdfkit` 0.19 (standard-14 font, tanpa embed TTF) · `marked` 12 (server & klien) · React 18 + Vite · vitest

## Global Constraints

- Bahasa komentar & prosa: **Indonesia**. Kode & identifier: Inggris, mengikuti gaya file sekitarnya.
- TypeScript strict. Test repo dijalankan `env -u NODE_ENV -u DATABASE_URL pnpm test` (vitest `--no-file-parallelism`).
- Server ESM. Build server = esbuild bundle; **`pdfkit` WAJIB `--external:pdfkit`** (ia membaca berkas metrik `.afm` dari `__dirname` saat runtime).
- Query `?download=` bernilai apa pun selain `md`/`pdf` **diabaikan** → respons JSON lama utuh. Tak boleh ada perubahan perilaku untuk pemanggil lama.
- PDF memakai standard-14 font (WinAnsi). Semua teks WAJIB lewat `toWinAnsi()` sebelum digambar; tanpa itu `→` tercetak `!'` dan emoji jadi `Ø<ß‰` **tanpa error** (terverifikasi lewat spike).
- ADR untuk SPEC ini adalah **0077** (0076 sudah dipakai SPEC-340; nomor sudah dienumerasi lintas semua branch).
- Nomor SPEC & ADR imutable; `internal/docs` diperbarui **dalam commit yang sama** dan ter-link di `internal/docs/README.md`.

---

### Task 1: Dependensi + fondasi `doc-export` (sanitasi WinAnsi + nama berkas)

Dua fungsi murni yang tak menyentuh pdfkit sama sekali, plus pemasangan dependensi. Dipisah dari renderer PDF karena inilah bagian yang paling mudah salah dan paling mahal kalau salah (mojibake senyap), dan seorang reviewer bisa menolaknya independen dari layout PDF.

**Files:**
- Modify: `server/package.json`
- Create: `server/src/services/doc-export.ts`
- Test: `server/test/doc-export.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `toWinAnsi(s: string): string`
  - `downloadFilename(prefix: string, path: string, ext: "md" | "pdf"): string`

- [ ] **Step 1: Pasang dependensi**

```bash
cd server && pnpm add pdfkit@^0.19.1 marked@^12.0.2 && pnpm add -D @types/pdfkit@^0.13.4
```

Lalu tambahkan `--external:pdfkit` pada script `build` di `server/package.json` (sisipkan tepat sesudah `--external:@fastify/cookie`):

```
--external:@fastify/cookie --external:pdfkit
```

Verifikasi: `node -e "import('pdfkit').then(m=>console.log(typeof m.default))"` dijalankan dari `server/` mencetak `function`.

- [ ] **Step 2: Tulis test yang gagal**

Buat `server/test/doc-export.test.ts`:

```ts
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
```

- [ ] **Step 3: Jalankan test — pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-361
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/doc-export.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/services/doc-export"`.

- [ ] **Step 4: Implementasikan `toWinAnsi` + `downloadFilename`**

Buat `server/src/services/doc-export.ts`:

```ts
/* doc-export (SPEC-361 · ADR-0077) — unduh dokumen sebagai .md mentah atau .pdf.
   Dipakai empat endpoint dokumen lewat query `?download=`. PDF dirender dari token
   `marked` (parser yang SAMA dengan preview frontend) ke pdfkit. */

// PDF standard-14 font hanya meng-encode WinAnsi. Glyph di luar itu tidak melempar error —
// ia tercetak sebagai mojibake senyap (`→` jadi `!'`, emoji jadi `Ø<ß‰`). Jadi setiap teks
// WAJIB lewat sini dulu. Karakter yang SUDAH ada di WinAnsi (— • · “ ” … é) dibiarkan utuh.
const TRANSLIT: Record<string, string> = {
  "→": "->", "⟶": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇐": "<=", "⇔": "<=>",
  "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "×": "x", "∞": "inf",
  "✓": "v", "✔": "v", "✅": "v", "✗": "x", "✘": "x", "❌": "x", "⚠": "!", "⚡": "!",
  "☐": "[ ]", "☑": "[x]", "☒": "[x]", "▸": ">", "▾": "v", "▪": "-", "▫": "-",
  "─": "-", "━": "-", "│": "|", "┃": "|", "└": "+", "├": "+", "┌": "+", "┐": "+", "┘": "+",
  "⌘": "Cmd", "⌥": "Alt", "⇧": "Shift", "␣": " ", "→|": "->",
};
export function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of s || "") {
    const t = TRANSLIT[ch];
    if (t !== undefined) { out += t; continue; }
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) { out += ch; continue; }              // Latin-1: aman
    if (WINANSI_EXTRA.has(ch)) { out += ch; continue; }   // 0x80–0x9F WinAnsi (— • · “ ” …)
    if (isDropped(cp)) continue;                          // emoji & simbol: buang
    out += "?";
  }
  return out;
}
// Rentang 0x80–0x9F WinAnsi memetakan codepoint Unicode > 0xFF; ini daftar lengkapnya.
const WINANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));
// Emoji, dingbat, simbol lain-lain, dan variation selector: dibuang, bukan jadi "?" —
// "?" berderet lebih mengganggu daripada absen.
function isDropped(cp: number): boolean {
  return (cp >= 0x1f000 && cp <= 0x1ffff)   // emoji & pictograph
    || (cp >= 0x2600 && cp <= 0x27bf)       // misc symbols + dingbats
    || (cp >= 0xfe00 && cp <= 0xfe0f)       // variation selectors
    || cp === 0x200d;                       // zero-width joiner
}

// Nama berkas unduhan: <prefix>-<basename tanpa ekstensi>.<ext>, disanitasi agar aman di
// header content-disposition maupun di filesystem mana pun.
export function downloadFilename(prefix: string, path: string, ext: "md" | "pdf"): string {
  const base = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  const slug = [prefix, base].filter(Boolean).join("-")
    .replace(/[^\w.-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  return `${slug || "dokumen"}.${ext}`;
}
```

- [ ] **Step 5: Jalankan test — pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/doc-export.test.ts
```

Expected: PASS, 8 test.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/src/services/doc-export.ts server/test/doc-export.test.ts pnpm-lock.yaml
git commit -m "feat(spec-361): fondasi doc-export — sanitasi WinAnsi + nama berkas unduhan"
```

---

### Task 2: Renderer PDF (`marked.lexer` → pdfkit)

**Files:**
- Modify: `server/src/services/doc-export.ts`
- Test: `server/test/doc-export-pdf.test.ts`

**Interfaces:**
- Consumes: `toWinAnsi` (Task 1)
- Produces: `renderDocPdf(text: string, name: string, meta: { eyebrow: string; path: string }): Promise<Buffer>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/doc-export-pdf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDocPdf } from "../src/services/doc-export";

const META = { eyebrow: "hanoman · SPEC-361", path: "docs/x.md" };

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
    // Setiap halaman menghasilkan satu objek /Type /Page.
    const pages = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });

  it("menyanitasi glyph di luar WinAnsi (tak ada mojibake panah)", async () => {
    const buf = await renderDocPdf("alur: spec → plan 🎉", "x.md", META);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/doc-export-pdf.test.ts
```

Expected: FAIL — `renderDocPdf is not a function`.

- [ ] **Step 3: Implementasikan renderer**

Tambahkan ke `server/src/services/doc-export.ts` (di bawah kode Task 1):

```ts
import PDFDocument from "pdfkit";
import { marked, type Tokens, type TokensList } from "marked";

// Warna diambil dari token design system (src/src/ds/tokens/colors.css) agar PDF terbaca
// sebagai dokumen hanoman, bukan keluaran generik.
const INK = "#3a3125", STRONG = "#17130c", MUTED = "#6f6250";
const BRASS = "#b8863b", HAIR = "#d6ccb9", PANEL = "#f6f1e7", LINK = "#3f6a70";

const BODY = 10.5, CODE = 8.6, LEAD = 3;
const H_SIZE: Record<number, number> = { 1: 19, 2: 14.5, 3: 12.5, 4: 11, 5: 10.5, 6: 10.5 };

type Meta = { eyebrow: string; path: string };

// Segmen inline sudah rata (flattened) menjadi teks + gaya, karena pdfkit menggambar per-run.
type Run = { text: string; bold?: boolean; italic?: boolean; mono?: boolean; strike?: boolean; link?: string };

function fontOf(r: Run): string {
  if (r.mono) return r.bold ? "Courier-Bold" : "Courier";
  if (r.bold && r.italic) return "Helvetica-BoldOblique";
  if (r.bold) return "Helvetica-Bold";
  if (r.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

// marked memberi token inline bersarang; ratakan jadi daftar Run dengan gaya terwarisi.
function flatten(tokens: unknown[] | undefined, base: Run = { text: "" }): Run[] {
  const out: Run[] = [];
  for (const raw of tokens ?? []) {
    const t = raw as Tokens.Generic & { tokens?: unknown[]; text?: string; href?: string };
    switch (t.type) {
      case "strong": out.push(...flatten(t.tokens, { ...base, bold: true })); break;
      case "em": out.push(...flatten(t.tokens, { ...base, italic: true })); break;
      case "del": out.push(...flatten(t.tokens, { ...base, strike: true })); break;
      case "codespan": out.push({ ...base, text: t.text ?? "", mono: true }); break;
      case "link": out.push(...flatten(t.tokens, { ...base, link: t.href })); break;
      case "br": out.push({ ...base, text: "\n" }); break;
      case "image": out.push({ ...base, text: `[gambar: ${t.href ?? ""}]`, italic: true }); break;
      case "escape":
      case "text":
        if (t.tokens?.length) out.push(...flatten(t.tokens, base));
        else out.push({ ...base, text: t.text ?? "" });
        break;
      default: out.push({ ...base, text: t.text ?? "" });
    }
  }
  return out;
}

// Satu paragraf = deretan Run digambar berurutan; `continued` menjaga mereka satu aliran.
function drawRuns(doc: PDFKit.PDFDocument, runs: Run[], size: number, color: string, opts: PDFKit.Mixins.TextOptions = {}) {
  const items = runs.filter((r) => r.text !== "");
  if (!items.length) { doc.moveDown(0.4); return; }
  items.forEach((r, i) => {
    doc.font(fontOf(r)).fontSize(r.mono ? Math.min(size, CODE + 1) : size)
      .fillColor(r.link ? LINK : r.mono ? MUTED : color)
      .text(toWinAnsi(r.text), {
        continued: i < items.length - 1, lineGap: LEAD, strike: r.strike,
        underline: !!r.link, link: r.link, ...opts,
      });
  });
}

function rule(doc: PDFKit.PDFDocument, color = HAIR, gap = 6) {
  const y = doc.y + gap / 2;
  doc.save().strokeColor(color).lineWidth(0.6)
    .moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke().restore();
  doc.y = y + gap;
}

function drawCode(doc: PDFKit.PDFDocument, text: string) {
  const left = doc.page.margins.left, right = doc.page.width - doc.page.margins.right;
  const body = toWinAnsi(text.replace(/\n+$/, ""));
  doc.font("Courier").fontSize(CODE);
  const h = doc.heightOfString(body, { width: right - left - 16, lineGap: 1.5 }) + 12;
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.save().rect(left, doc.y, right - left, h).fill(PANEL).restore();
  doc.fillColor(INK).text(body, left + 8, doc.y + 6, { width: right - left - 16, lineGap: 1.5 });
  doc.y += 8;
}

function drawList(doc: PDFKit.PDFDocument, list: Tokens.List, depth: number) {
  const indent = 14 * depth;
  let n = Number(list.start || 1);
  for (const item of list.items) {
    const marker = list.ordered ? `${n++}.`
      : item.task ? (item.checked ? "[x]" : "[ ]")
      : depth > 0 ? "-" : "•";
    doc.font("Helvetica").fontSize(BODY).fillColor(MUTED)
      .text(toWinAnsi(marker), doc.page.margins.left + indent, doc.y, { width: 22, continued: false });
    doc.moveUp();
    const x = doc.page.margins.left + indent + 22;
    const w = doc.page.width - doc.page.margins.right - x;
    // Token blok di dalam list-item (paragraf/list bersarang) dirender ulang dengan margin
    // kiri digeser, supaya bullet bersarang tetap sejajar.
    const inline = (item.tokens ?? []).filter((t) => (t as Tokens.Generic).type !== "list");
    doc.x = x;
    drawRuns(doc, flatten(inline.flatMap((t) => (t as Tokens.Generic & { tokens?: unknown[] }).tokens ?? [t])), BODY, INK, { width: w });
    doc.x = doc.page.margins.left;
    for (const t of item.tokens ?? []) {
      if ((t as Tokens.Generic).type === "list") drawList(doc, t as Tokens.List, depth + 1);
    }
  }
  doc.moveDown(0.3);
}

function drawTable(doc: PDFKit.PDFDocument, t: Tokens.Table) {
  const left = doc.page.margins.left, right = doc.page.width - doc.page.margins.right;
  const cols = t.header.length || 1;
  const w = (right - left) / cols;
  const row = (cells: { tokens?: unknown[]; text?: string }[], bold: boolean) => {
    const texts = cells.map((c) => toWinAnsi(flatten(c.tokens).map((r) => r.text).join("") || c.text || ""));
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.2).fillColor(bold ? STRONG : INK);
    const h = Math.max(...texts.map((s) => doc.heightOfString(s, { width: w - 10 }))) + 7;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y0 = doc.y;
    texts.forEach((s, i) => doc.text(s, left + i * w + 5, y0 + 3, { width: w - 10 }));
    doc.y = y0 + h;
    rule(doc, HAIR, 2);
  };
  rule(doc, HAIR, 2);
  row(t.header as { tokens?: unknown[]; text?: string }[], true);
  for (const r of t.rows) row(r as { tokens?: unknown[]; text?: string }[], false);
  doc.moveDown(0.3);
}

function drawTokens(doc: PDFKit.PDFDocument, tokens: TokensList | unknown[]) {
  for (const raw of tokens as unknown[]) {
    const t = raw as Tokens.Generic & { tokens?: unknown[]; text?: string; depth?: number; lang?: string };
    switch (t.type) {
      case "heading": {
        const d = Math.min(Math.max(t.depth ?? 1, 1), 6);
        doc.moveDown(d <= 2 ? 0.8 : 0.5);
        if (doc.y + 60 > doc.page.height - doc.page.margins.bottom) doc.addPage();
        drawRuns(doc, flatten(t.tokens, { text: "", bold: true }), H_SIZE[d]!, STRONG);
        if (d === 1) rule(doc, BRASS, 8);
        else if (d === 2) rule(doc, HAIR, 6);
        else doc.moveDown(0.15);
        break;
      }
      case "paragraph": drawRuns(doc, flatten(t.tokens), BODY, INK); doc.moveDown(0.45); break;
      case "list": drawList(doc, t as unknown as Tokens.List, 0); break;
      case "code": drawCode(doc, t.text ?? ""); break;
      case "blockquote": {
        const y0 = doc.y;
        doc.x = doc.page.margins.left + 12;
        drawRuns(doc, flatten(t.tokens?.flatMap((b) => (b as Tokens.Generic & { tokens?: unknown[] }).tokens ?? [b])),
          BODY, MUTED, { width: doc.page.width - doc.page.margins.right - doc.page.margins.left - 12, oblique: true } as PDFKit.Mixins.TextOptions);
        doc.x = doc.page.margins.left;
        doc.save().strokeColor(BRASS).lineWidth(2)
          .moveTo(doc.page.margins.left + 2, y0).lineTo(doc.page.margins.left + 2, doc.y).stroke().restore();
        doc.moveDown(0.45);
        break;
      }
      case "table": drawTable(doc, t as unknown as Tokens.Table); break;
      case "hr": rule(doc, HAIR, 10); break;
      case "html": case "text":
        drawRuns(doc, t.tokens?.length ? flatten(t.tokens) : [{ text: t.text ?? "" }], BODY, INK);
        doc.moveDown(0.3);
        break;
      case "space": doc.moveDown(0.3); break;
      default: if (t.text) { drawRuns(doc, [{ text: t.text }], BODY, INK); doc.moveDown(0.3); }
    }
  }
}

/** Render satu dokumen jadi PDF. `name` menentukan md vs blok kode (cermin `hnDocHtml` frontend). */
export function renderDocPdf(text: string, name: string, meta: Meta): Promise<Buffer> {
  const src = /\.md$/i.test(name) ? (text || "")
    : "```" + "\n" + (text || "") + "\n" + "```";
  const doc = new PDFDocument({ size: "A4", margins: { top: 64, bottom: 60, left: 58, right: 58 },
    info: { Title: meta.path, Creator: "hanoman", Producer: "hanoman" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // Kop halaman pertama.
  doc.font("Helvetica-Bold").fontSize(8).fillColor(BRASS)
    .text(toWinAnsi(meta.eyebrow.toUpperCase()), { characterSpacing: 0.8 });
  doc.moveDown(0.25);
  doc.font("Helvetica-Bold").fontSize(17).fillColor(STRONG).text(toWinAnsi(name.split("/").pop() ?? name));
  doc.moveDown(0.15);
  doc.font("Courier").fontSize(8.2).fillColor(MUTED).text(toWinAnsi(meta.path));
  rule(doc, HAIR, 12);
  doc.font("Helvetica").fontSize(BODY).fillColor(INK);

  drawTokens(doc, marked.lexer(src));

  // Footer tiap halaman digambar terakhir: `bufferPages` menahan halaman agar bisa disusuri.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - 42;
    doc.save().strokeColor(HAIR).lineWidth(0.6)
      .moveTo(doc.page.margins.left, y - 8).lineTo(doc.page.width - doc.page.margins.right, y - 8).stroke().restore();
    doc.font("Courier").fontSize(7.4).fillColor(MUTED)
      .text(toWinAnsi(meta.path), doc.page.margins.left, y, { lineBreak: false });
    doc.font("Helvetica").fontSize(7.4).fillColor(MUTED)
      .text(`hal. ${i + 1}/${range.count}`, doc.page.margins.left, y,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
```

**Catatan implementasi:** footer memerlukan `bufferPages: true` pada konstruktor. Tambahkan opsi itu ke `new PDFDocument({ ... })` di atas: `bufferPages: true`.

- [ ] **Step 4: Jalankan test — pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/doc-export-pdf.test.ts
```

Expected: PASS, 6 test. Kalau ada yang melempar, perbaiki renderer — jangan melonggarkan test.

- [ ] **Step 5: Periksa hasilnya dengan mata (bukan hanya magic bytes)**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-361
cat > /tmp/spec361-render.mjs <<'EOF'
import { renderDocPdf } from "./server/src/services/doc-export.ts";
import { readFileSync, writeFileSync } from "node:fs";
const md = readFileSync("docs/superpowers/specs/2026-07-28-spec-361-unduh-dokumen-md-pdf-design.md", "utf8");
writeFileSync("/tmp/spec361.pdf", await renderDocPdf(md, "design.md", { eyebrow: "hanoman · SPEC-361", path: "docs/…/design.md" }));
EOF
node --experimental-strip-types /tmp/spec361-render.mjs && qlmanage -t -s 900 -o /tmp /tmp/spec361.pdf
```

Buka `/tmp/spec361.pdf.png`. Yang harus terlihat: judul + garis brass, tabel bergaris, blok kode berlatar bone, panah tercetak `->` (BUKAN `!'`), footer `hal. 1/N`. Perbaiki layout kalau ada yang tabrakan.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/doc-export.ts server/test/doc-export-pdf.test.ts
git commit -m "feat(spec-361): renderer PDF dokumen — marked.lexer ke pdfkit"
```

---

### Task 3: Helper respons unduhan + query `?download=` di keempat endpoint

**Files:**
- Modify: `server/src/services/doc-export.ts`
- Modify: `server/src/routes/specs.ts:197-203`
- Modify: `server/src/routes/docs.ts:17-22`, `server/src/routes/docs.ts:32-37`
- Modify: `server/src/routes/ide.ts:33-42`
- Test: `server/test/doc-download.route.test.ts`

**Interfaces:**
- Consumes: `renderDocPdf`, `downloadFilename` (Task 1 & 2)
- Produces: `downloadFormat(q: unknown): "md" | "pdf" | null` dan
  `sendDocDownload(reply, fmt, args: { content: string; name: string; prefix: string; eyebrow: string; path: string }): Promise<unknown>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/doc-download.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeTempRepo, makeSpec } from "./factory";

const app = buildApp({ requireAuth: false });
const DOC = "internal/docs/product/prd.md";
let dir: string;

beforeEach(async () => {
  await resetDb();
  dir = makeTempRepo({
    "internal/docs/README.md": "- [prd](product/prd.md)",
    "internal/docs/product/prd.md": "# PRD\n\nAlur: spec → plan.",
    "docs/prd/x.md": "# PRD x",
    "docs/superpowers/plans/rencana.md": "# Rencana\n\n- [ ] satu",
  });
  await makeProject({ id: "p1", repoDir: dir });
  await makeSpec({ id: "SPEC-900", projectId: "p1" });
});

describe("unduh dokumen (?download=)", () => {
  it("docs project: md mentah dengan content-disposition", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${DOC}?download=md` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="p1-prd.md"');
    expect(res.body).toBe("# PRD\n\nAlur: spec → plan.");
  });

  it("docs project: pdf valid", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${DOC}?download=pdf` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="p1-prd.pdf"');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("tanpa query: JSON lama tak berubah", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${DOC}` });
    expect(res.json()).toEqual({ path: DOC, content: "# PRD\n\nAlur: spec → plan." });
  });

  it("query tak dikenal diabaikan (tetap JSON)", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${DOC}?download=docx` });
    expect(res.json().content).toBe("# PRD\n\nAlur: spec → plan.");
  });

  it("dokumen tak ada tetap 404 walau diminta unduh", async () => {
    const res = await app.inject({ url: "/api/projects/p1/docs/internal/docs/tak/ada.md?download=pdf" });
    expect(res.statusCode).toBe(404);
  });

  it("prd: md & pdf", async () => {
    const md = await app.inject({ url: "/api/projects/p1/prds/docs/prd/x.md?download=md" });
    expect(md.headers["content-disposition"]).toBe('attachment; filename="p1-x.md"');
    const pdf = await app.inject({ url: "/api/projects/p1/prds/docs/prd/x.md?download=pdf" });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("dokumen backlog: prefix nama berkas memakai id spec", async () => {
    const md = await app.inject({ url: "/api/specs/SPEC-900/docs/docs/superpowers/plans/rencana.md?download=md" });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-disposition"]).toBe('attachment; filename="SPEC-900-rencana.md"');
    const pdf = await app.inject({ url: "/api/specs/SPEC-900/docs/docs/superpowers/plans/rencana.md?download=pdf" });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("berkas IDE: unduh mentah & pdf", async () => {
    const md = await app.inject({ url: `/api/projects/p1/file?path=${encodeURIComponent(DOC)}&download=md` });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-disposition"]).toBe('attachment; filename="p1-prd.md"');
    const pdf = await app.inject({ url: `/api/projects/p1/file?path=${encodeURIComponent(DOC)}&download=pdf` });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("berkas IDE tanpa query: JSON RepoFile lama", async () => {
    const res = await app.inject({ url: `/api/projects/p1/file?path=${encodeURIComponent(DOC)}` });
    expect(res.json()).toHaveProperty("binary", false);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/doc-download.route.test.ts
```

Expected: FAIL — respons JSON, bukan `text/markdown`.

Kalau `makeSpec` belum ada di `server/test/factory.ts`, pakai helper pembuat spec yang memang ada di sana (buka file itu dan sesuaikan nama fungsinya); jangan menambah helper baru.

- [ ] **Step 3: Tambahkan helper ke `doc-export.ts`**

```ts
import type { FastifyReply } from "fastify";

/** Baca query `?download=`. Nilai lain (termasuk absen) → null → respons JSON lama. */
export function downloadFormat(q: unknown): "md" | "pdf" | null {
  const v = (q as { download?: string } | undefined)?.download;
  return v === "md" || v === "pdf" ? v : null;
}

/** Kirim dokumen sebagai attachment. `name` menentukan md vs blok kode di PDF. */
export async function sendDocDownload(
  reply: FastifyReply, fmt: "md" | "pdf",
  a: { content: string; name: string; prefix: string; eyebrow: string; path: string },
): Promise<unknown> {
  const filename = downloadFilename(a.prefix, a.name, fmt);
  reply.header("content-disposition", `attachment; filename="${filename}"`);
  if (fmt === "md") {
    reply.header("content-type", "text/markdown; charset=utf-8");
    return reply.send(a.content);
  }
  reply.header("content-type", "application/pdf");
  return reply.send(await renderDocPdf(a.content, a.name, { eyebrow: a.eyebrow, path: a.path }));
}
```

- [ ] **Step 4: Pasang di `server/src/routes/specs.ts`**

Tambahkan import di dekat import service lain:

```ts
import { downloadFormat, sendDocDownload } from "../services/doc-export";
```

Ganti badan `app.get("/specs/:id/docs/*", …)` (baris 197–203) menjadi:

```ts
  app.get("/specs/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const dir = await resolveDir(id);
    const content = dir ? readDocFile(dir, path) : null; // readDocFile menolak non-.md -> null
    if (content === null) return reply.code(404).send({ error: "not found" });
    // SPEC-361 · ADR-0077 · unduh .md mentah / .pdf; tanpa query → JSON seperti semula.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendDocDownload(reply, fmt, { content, name: path, prefix: id, eyebrow: `hanoman · ${id}`, path });
    return { path, content };
  });
```

- [ ] **Step 5: Pasang di `server/src/routes/docs.ts`**

Tambahkan import:

```ts
import { downloadFormat, sendDocDownload } from "../services/doc-export";
```

Ganti handler PRD (baris 17–22):

```ts
  app.get("/projects/:id/prds/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const content = await readPrd(id, path);
    if (content === null) return reply.code(404).send({ error: "not found" });
    // SPEC-361 · ADR-0077
    const fmt = downloadFormat(req.query);
    if (fmt) return sendDocDownload(reply, fmt, { content, name: path, prefix: id, eyebrow: `hanoman · ${id} · PRD`, path });
    return { path, content };
  });
```

Ganti handler docs (baris 32–37):

```ts
  app.get("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const content = await readDoc(id, path);
    if (content === null) return reply.code(404).send({ error: "not found" });
    // SPEC-361 · ADR-0077
    const fmt = downloadFormat(req.query);
    if (fmt) return sendDocDownload(reply, fmt, { content, name: path, prefix: id, eyebrow: `hanoman · ${id}`, path });
    return { path, content };
  });
```

- [ ] **Step 6: Pasang di `server/src/routes/ide.ts`**

Tambahkan import:

```ts
import { downloadFormat, sendDocDownload } from "../services/doc-export";
```

Ganti handler `GET /projects/:id/file` (baris 33–42):

```ts
  app.get("/projects/:id/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path, ref } = req.query as { path?: string; ref?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await readRepoFile(repoDir, path, ref ?? "");
      if (f === null) return reply.code(404).send({ error: "not found" });
      // SPEC-361 · ADR-0077 · unduh berkas teks; biner tak punya bentuk .md/.pdf yang berarti.
      const fmt = downloadFormat(req.query);
      if (fmt && !f.binary) {
        const id = (req.params as { id: string }).id;
        const prefix = ref ? `${id}-${ref}` : id;
        return sendDocDownload(reply, fmt, { content: f.content ?? "", name: path, prefix,
          eyebrow: `hanoman · ${id}${ref ? ` · ${ref}` : ""}`, path });
      }
      return f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
```

- [ ] **Step 7: Jalankan test — pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/doc-download.route.test.ts
```

Expected: PASS, 9 test.

- [ ] **Step 8: Pastikan tak ada regresi di rute lama**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/docs.route.test.ts test/ide.route.test.ts test/specs.route.test.ts
```

Expected: semua PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/doc-export.ts server/src/routes/specs.ts server/src/routes/docs.ts server/src/routes/ide.ts server/test/doc-download.route.test.ts
git commit -m "feat(spec-361): query ?download=md|pdf di empat endpoint dokumen"
```

---

### Task 4: `Button as="a"` + komponen `DocDownload` + URL di shared/client

**Files:**
- Modify: `src/src/ds/components/forms.tsx:22-51`
- Create: `src/src/ds/DocDownload.tsx`
- Modify: `src/src/ds/index.ts`
- Modify: `shared/src/api.ts`
- Modify: `src/src/api/client.ts`
- Test: `src/test/doc-download.test.tsx`

**Interfaces:**
- Consumes: query `?download=` (Task 3)
- Produces:
  - `paths.download(base: string, fmt: "md" | "pdf"): string`
  - `<DocDownload href={(fmt: "md" | "pdf") => string} disabled?: boolean />`
  - `<Button as="a" href=… download />`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/doc-download.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "../src/ds";
import { DocDownload } from "../src/ds/DocDownload";
import { paths } from "@hanoman/shared";

describe("Button as=\"a\"", () => {
  it("merender anchor, bukan button", () => {
    render(<Button as="a" href="/x" download>unduh</Button>);
    const el = screen.getByText("unduh").closest("a");
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("href", "/x");
    expect(el).toHaveAttribute("download");
  });
});

describe("paths.download", () => {
  it("menempelkan query ke URL tanpa query", () => {
    expect(paths.download("/api/projects/p1/docs/a/b.md", "pdf"))
      .toBe("/api/projects/p1/docs/a/b.md?download=pdf");
  });
  it("menempelkan query ke URL yang sudah punya query", () => {
    expect(paths.download("/api/projects/p1/file?path=a.md", "md"))
      .toBe("/api/projects/p1/file?path=a.md&download=md");
  });
});

describe("DocDownload", () => {
  it("merender dua anchor unduh dengan href dari href(fmt)", () => {
    render(<DocDownload href={(f) => `/api/x?download=${f}`} />);
    const md = screen.getByRole("link", { name: /unduh \.md/i });
    const pdf = screen.getByRole("link", { name: /unduh \.pdf/i });
    expect(md).toHaveAttribute("href", "/api/x?download=md");
    expect(pdf).toHaveAttribute("href", "/api/x?download=pdf");
  });
  it("tidak merender apa pun saat disabled", () => {
    const { container } = render(<DocDownload href={() => "/x"} disabled />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-361
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/doc-download.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/ds/DocDownload"`.

- [ ] **Step 3: Tambahkan prop `as` ke `Button`**

Di `src/src/ds/components/forms.tsx`, ubah tipe props (baris 22–24) menjadi:

```tsx
type ButtonProps = { children?: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: Size; leftIcon?: string; rightIcon?: string; loading?: boolean; disabled?: boolean; fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  // SPEC-361 · `as="a"` dipakai tombol unduh: unduhan butuh anchor sungguhan (atribut `download`),
  // bukan <button> ber-onClick, supaya nama berkas dari server dihormati.
  as?: "button" | "a";
  style?: React.CSSProperties } & Record<string, any>;
```

Ubah tanda tangan (baris 25–26) menambahkan `as: asTag = "button",` sesudah `type = "button",`, lalu ganti pemanggilan `React.createElement("button", …)` (baris 35) menjadi:

```tsx
  const isAnchor = asTag === "a";
  return React.createElement(isAnchor ? "a" : "button", _extends({
    ...(isAnchor ? { "aria-disabled": isDisabled || undefined } : { type, disabled: isDisabled }),
    onMouseEnter: () => setHover(true),
```

(sisa properti di objek itu tidak berubah; hanya `type`/`disabled` yang jadi kondisional). Tambahkan `textDecoration: "none"` ke objek `style` agar anchor tak tergaris bawah.

- [ ] **Step 4: Buat `src/src/ds/DocDownload.tsx`**

```tsx
/* DocDownload (SPEC-361 · ADR-0077) — sepasang tombol unduh untuk setiap pratinjau dokumen.
   Anchor sungguhan (bukan onClick) supaya `content-disposition` server yang menentukan nama
   berkas; cookie sesi ikut terkirim same-origin, jadi gate auth ADR-0028 berlaku apa adanya. */
import React from "react";
import { Button } from "./components/forms";

export function DocDownload({ href, disabled = false, size = "sm" }:
  { href: (fmt: "md" | "pdf") => string; disabled?: boolean; size?: "sm" | "md" }) {
  if (disabled) return null;
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <Button as="a" href={href("md")} download size={size} variant="ghost"
        leftIcon="download" title="Unduh sumber Markdown" aria-label="Unduh .md">.md</Button>
      <Button as="a" href={href("pdf")} download size={size} variant="ghost"
        leftIcon="file-down" title="Unduh sebagai PDF" aria-label="Unduh .pdf">.pdf</Button>
    </div>
  );
}
```

Tambahkan ke `src/src/ds/index.ts` sesudah baris `export { MarkdownView, hnDocHtml } from "./markdown";`:

```ts
export { DocDownload } from "./DocDownload";
```

- [ ] **Step 5: Tambahkan `paths.download` di `shared/src/api.ts`**

Sisipkan sebelum penutup `} as const;`:

```ts
  // SPEC-361 · ADR-0077 · unduh dokumen: query ditempelkan ke URL endpoint dokumen yang sudah ada.
  download: (base: string, fmt: "md" | "pdf") => `${base}${base.includes("?") ? "&" : "?"}download=${fmt}`,
```

Lalu di `src/src/api/client.ts`, tambahkan sesudah `getSpecDocFile`:

```ts
  // SPEC-361 · ADR-0077 · URL unduh (dipakai <a download>, bukan fetch — server yang menamai berkas).
  specDocDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") => paths.download(paths.specDocFile(id, path), fmt),
  docDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") => paths.download(paths.docFile(id, path), fmt),
  prdDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") => paths.download(paths.prdFile(id, path), fmt),
  ideFileDownloadUrl: (id: string, path: string, ref: string, fmt: "md" | "pdf") => paths.download(paths.ideFile(id, path, ref), fmt),
```

`paths` sudah di-import di baris 1 file itu — pastikan namanya ikut di daftar import.

- [ ] **Step 6: Jalankan test — pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/doc-download.test.tsx
```

Expected: PASS, 5 test.

- [ ] **Step 7: Commit**

```bash
git add src/src/ds/components/forms.tsx src/src/ds/DocDownload.tsx src/src/ds/index.ts shared/src/api.ts src/src/api/client.ts src/test/doc-download.test.tsx
git commit -m "feat(spec-361): DS DocDownload + Button as=\"a\" + URL unduh"
```

---

### Task 5: Pasang tombol di empat layar pratinjau

`SpecDocsModal` dipakai **dua** tempat (Backlog & Terminal), jadi satu pemasangan menutup dua entry point.

**Files:**
- Modify: `src/src/screens/SpecDocsModal.tsx`
- Modify: `src/src/screens/PrdScreen.tsx`
- Modify: `src/src/screens/DocsWorkspace.tsx`
- Modify: `src/src/screens/IdeScreen.tsx`
- Test: `src/test/doc-download-screens.test.tsx`

**Interfaces:**
- Consumes: `DocDownload` + `api.*DownloadUrl` (Task 4)
- Produces: —

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/doc-download-screens.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { paths } from "@hanoman/shared";

const getSpecDocs = vi.fn(), getSpecDocFile = vi.fn(), getDocs = vi.fn(), getDoc = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    getSpecDocs: (...a: unknown[]) => getSpecDocs(...a),
    getSpecDocFile: (...a: unknown[]) => getSpecDocFile(...a),
    getDocs: (...a: unknown[]) => getDocs(...a),
    getDoc: (...a: unknown[]) => getDoc(...a),
    specDocDownloadUrl: (id: string, p: string, f: "md" | "pdf") => paths.download(paths.specDocFile(id, p), f),
    docDownloadUrl: (id: string, p: string, f: "md" | "pdf") => paths.download(paths.docFile(id, p), f),
  },
}));

import { SpecDocsModal } from "../src/screens/SpecDocsModal";
import { DocsWorkspace } from "../src/screens/DocsWorkspace";

beforeEach(() => { [getSpecDocs, getSpecDocFile, getDocs, getDoc].forEach((m) => m.mockReset()); });

describe("tombol unduh pada pratinjau dokumen", () => {
  it("SpecDocsModal menaut dokumen backlog yang sedang dibuka", async () => {
    getSpecDocs.mockResolvedValue({ files: [
      { kind: "plan", path: "docs/superpowers/plans/x.md", name: "x.md" },
    ]});
    getSpecDocFile.mockResolvedValue({ path: "docs/superpowers/plans/x.md", content: "# X" });
    render(<SpecDocsModal specId="SPEC-361" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("link", { name: /unduh \.pdf/i })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /unduh \.md/i }))
      .toHaveAttribute("href", "/api/specs/SPEC-361/docs/docs/superpowers/plans/x.md?download=md");
    expect(screen.getByRole("link", { name: /unduh \.pdf/i }))
      .toHaveAttribute("href", "/api/specs/SPEC-361/docs/docs/superpowers/plans/x.md?download=pdf");
  });

  it("DocsWorkspace menaut dokumen SoT yang terpilih", async () => {
    getDocs.mockResolvedValue({ coverage: 100, tree: [
      { cat: "internal/docs/product", files: ["prd.md"], linked: true, scored: true },
    ]});
    getDoc.mockResolvedValue({ path: "internal/docs/product/prd.md", content: "# prd" });
    render(<DocsWorkspace projectId="p1" projectName="P1" docStatus="ok" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /unduh \.md/i })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /unduh \.md/i }))
      .toHaveAttribute("href", "/api/projects/p1/docs/internal/docs/product/prd.md?download=md");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/doc-download-screens.test.tsx
```

Expected: FAIL — `Unable to find role="link"`.

- [ ] **Step 3: Pasang di `SpecDocsModal.tsx`**

Ubah import baris 5 menjadi:

```tsx
import { Modal, StateBlock, Icon, MarkdownView, DocDownload } from "../ds";
```

Ganti pane kanan (baris 86–90) menjadi:

```tsx
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* SPEC-361 · unduh dokumen yang sedang dibuka sebagai evidence untuk tim */}
              <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: 6, borderBottom: "1px solid var(--border-hair)", marginBottom: 8 }}>
                <DocDownload href={(f) => api.specDocDownloadUrl(specId, sel, f)} disabled={!sel || docLoading || docFailed} />
              </div>
              <div style={{ flex: "1 1 auto", overflow: "auto", padding: "0 8px 16px" }}>
                {docLoading ? <StateBlock kind="loading" title="Memuat…" hint={sel} />
                  : docFailed ? <StateBlock kind="error" title="Gagal memuat berkas" hint={sel} />
                  : <MarkdownView text={cache[sel] ?? ""} name={sel} />}
              </div>
            </div>
```

- [ ] **Step 4: Pasang di `PrdScreen.tsx`**

Tambahkan `DocDownload` ke daftar import dari `"../ds"` (baris 6–9). Lalu di `PrdPreviewPane`, di dalam `<div style={{ display: "flex", gap: 8, flexShrink: 0 }}>` (baris 108), sisipkan sebagai anak **pertama**:

```tsx
          <DocDownload href={(f) => api.prdDownloadUrl(projectId, prd.path, f)} disabled={content === null} />
```

- [ ] **Step 5: Pasang di `DocsWorkspace.tsx`**

Tambahkan `DocDownload` ke import baris 5. Lalu di header kartu preview, ganti blok tombol mode preview (baris 225–230) menjadi:

```tsx
          {mode === "preview" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* SPEC-361 · unduh dokumen SoT sebagai .md / .pdf */}
              <DocDownload href={(f) => api.docDownloadUrl(projectId, selected, f)}
                disabled={!selected || docLoading || docFailed} />
              <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={removeDoc} disabled={!selected}>Hapus</Button>
              <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                disabled={!selected || docLoading || docFailed}>Edit</Button>
            </div>
          ) : (
```

- [ ] **Step 6: Pasang di `IdeScreen.tsx`**

Tambahkan import:

```tsx
import { DocDownload } from "../ds";
```

(gabungkan ke baris 6 yang sudah meng-import dari `"../ds"`).

Di toolbar mode `view` (baris 264–281), sisipkan `DocDownload` tepat sebelum tombol `Edit`, di dalam `<div style={{ display: "flex", alignItems: "center", gap: 8 }}>`:

```tsx
                      {/* SPEC-361 · unduh berkas teks yang sedang dibuka (biner tak ditawari) */}
                      <DocDownload href={(f) => api.ideFileDownloadUrl(projectId, selected, viewRef, f)}
                        disabled={!file || file.binary} />
```

- [ ] **Step 7: Jalankan test — pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/doc-download-screens.test.tsx
```

Expected: PASS, 2 test.

- [ ] **Step 8: Pastikan layar lama tak regresi**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/spec-docs-modal.test.tsx test/ide-screen.test.tsx test/prd-screen.test.tsx test/docs-tree.test.ts
```

Expected: semua PASS. (Kalau ada berkas test yang tak ada dengan nama itu, jalankan seluruh suite `src` saja.)

- [ ] **Step 9: Commit**

```bash
git add src/src/screens/SpecDocsModal.tsx src/src/screens/PrdScreen.tsx src/src/screens/DocsWorkspace.tsx src/src/screens/IdeScreen.tsx src/test/doc-download-screens.test.tsx
git commit -m "feat(spec-361): tombol unduh .md/.pdf di Backlog, Terminal, PRD, Docs, IDE"
```

---

### Task 6: Docs Source of Truth + ADR-0077

**Files:**
- Create: `internal/docs/adr/0077-unduh-dokumen-md-pdf.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: keputusan Task 1–5
- Produces: —

- [ ] **Step 1: Tulis ADR-0077**

Buat `internal/docs/adr/0077-unduh-dokumen-md-pdf.md` dengan status `Accepted`, tanggal 2026-07-28, mengikuti bentuk ADR tetangga (`0076-*.md` sebagai contoh gaya). Isi yang wajib ada:

- **Konteks:** dokumen agen (PRD/spec/plan/audit) hanya terbaca di dalam dashboard; tak ada artefak untuk dibagikan sebagai evidence.
- **Keputusan:** (a) PDF dirender **server-side** dengan `pdfkit`, bukan di klien; (b) tanpa endpoint baru — query `?download=md|pdf` menempel pada empat endpoint dokumen yang sudah ada, mengikuti preseden `GET /projects/:id/archive` (SPEC-233); (c) parser Markdown yang dipakai server **sama** dengan preview (`marked`), sehingga yang tercetak = yang tampil; (d) tanpa perubahan skema, tanpa penyimpanan PDF.
- **Konsekuensi:** dependensi baru `pdfkit` + `marked` di server, `--external:pdfkit` di esbuild; standard-14 font berarti glyph di luar WinAnsi **ditransliterasi** (`→` → `->`) dan emoji dibuang — ini sadar, alternatifnya meng-embed TTF (ditolak: menambah ~750 KB aset di repo); auth memakai cookie same-origin lewat `<a download>`, tanpa pengecualian gate baru.
- **Alternatif ditolak:** dialog print browser (bukan unduhan sungguhan, nama berkas tak terkendali); `pdfmake` di klien (bundle +2 MB, PDF tak bisa diambil lewat API/curl).
- **Terkait:** memperluas 0011/0018 (docs sebagai nilai turunan dari filesystem), 0041 (PRD sebagai dokumen), 0028 (gate auth), 0057/0076 (dokumen audit).

- [ ] **Step 2: Taut ADR di index**

Di `internal/docs/README.md`, bagian `## adr`, sisipkan sebagai baris **pertama** daftar (di atas 0076):

```markdown
- [0077 — Unduh dokumen: query `?download=` di endpoint dokumen + render PDF server-side](adr/0077-unduh-dokumen-md-pdf.md) — memperluas 0011/0018/0041, terkait 0028/0057/0076 (SPEC-361): PRD/spec/plan/audit/docs SoT/berkas IDE bisa diunduh `.md` mentah maupun `.pdf` dari setiap pratinjau; **tanpa endpoint baru** (query menempel di empat endpoint dokumen, preseden `GET /projects/:id/archive`), **tanpa skema/migration**; PDF dirender server-side `marked.lexer` → `pdfkit` memakai parser yang sama dengan preview; standard-14 font → glyph non-WinAnsi ditransliterasi (`→` jadi `->`) & emoji dibuang, sebab mojibake pdfkit **senyap** (tak melempar)
```

- [ ] **Step 3: Dokumentasikan kontrak API**

Di `internal/docs/architecture/api-contract.md`, tambahkan subbagian pada bagian dokumen/docs (cari `GET /projects/:id/docs/*` di file itu dan tulis tepat di dekatnya):

```markdown
### Unduh dokumen (SPEC-361 · ADR-0077)

Empat endpoint dokumen menerima query opsional `?download=md|pdf`:

| Endpoint | Prefix nama berkas |
|---|---|
| `GET /api/specs/:id/docs/*path` | `<specId>` |
| `GET /api/projects/:id/prds/*path` | `<projectId>` |
| `GET /api/projects/:id/docs/*path` | `<projectId>` |
| `GET /api/projects/:id/file?path=&ref=` | `<projectId>` (+`-<ref>` bila ada) |

- `download=md` → `200 text/markdown; charset=utf-8`, badan = sumber Markdown mentah.
- `download=pdf` → `200 application/pdf`, dirender server-side dari token `marked`.
- Keduanya menyetel `content-disposition: attachment; filename="<prefix>-<basename>.<ext>"`.
- Nilai lain atau query absen → respons JSON `{path, content}` **persis seperti sebelumnya**.
- 404 tetap 404. Berkas biner di IDE tak bisa diunduh sebagai PDF.
- Auth tak berubah: cookie sesi same-origin (ADR-0028).
```

- [ ] **Step 4: Catat permukaan frontend**

Di `internal/docs/frontend/frontend-implementation.md`, tambahkan satu paragraf:

```markdown
**Unduh dokumen (SPEC-361 · ADR-0077).** `ds/DocDownload.tsx` merender sepasang anchor `.md` /
`.pdf` dan dipasang di setiap pratinjau Markdown: `SpecDocsModal` (dipakai Backlog **dan**
Terminal), `PrdScreen`, `DocsWorkspace` (mode preview saja — bukan draft editor), dan
`IdeScreen` (berkas non-biner). Anchor sungguhan, bukan `onClick`: `content-disposition` server
yang menentukan nama berkas, dan cookie sesi ikut terkirim same-origin. `Button` menerima prop
`as="a"` untuk keperluan ini.
```

- [ ] **Step 5: Tambahkan aturan di skill project**

Di `internal/skills/hanoman/SKILL.md`, bagian **Aturan Dokumentasi & Alur**, tambahkan butir:

```markdown
- **Unduh dokumen** (SPEC-361/ADR-0077): setiap pratinjau Markdown (Backlog/Terminal `SpecDocsModal`, PRD, Docs SoT, IDE) punya tombol `.md` & `.pdf`. Mekanismenya query `?download=md|pdf` pada endpoint dokumen yang **sudah ada** — jangan bikin endpoint ekspor baru. PDF dirender `server/src/services/doc-export.ts` (`marked.lexer` → `pdfkit`, standard-14 font). **Gotcha wajib:** pdfkit **tidak melempar** untuk glyph di luar WinAnsi — ia mencetak mojibake senyap (`→` jadi `!'`, emoji jadi `Ø<ß‰`), jadi setiap teks harus lewat `toWinAnsi()`.
```

- [ ] **Step 6: Verifikasi integritas index**

```bash
env -u NODE_ENV -u DATABASE_URL node --experimental-strip-types -e "1" >/dev/null 2>&1; grep -c "0077" internal/docs/README.md
```

Expected: `1` atau lebih.

- [ ] **Step 7: Commit**

```bash
git add internal/docs/adr/0077-unduh-dokumen-md-pdf.md internal/docs/README.md internal/docs/architecture/api-contract.md internal/docs/frontend/frontend-implementation.md internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-361): ADR-0077 unduh dokumen .md/.pdf + kontrak API + skill"
```

---

### Task 7: Verifikasi menyeluruh — suite penuh, typecheck, build, smoke nyata

Ini gerbang terakhir. CLAUDE.md mewajibkan endpoint diuji **nyata di local** (boot server + curl), bukan hanya unit test.

**Files:**
- Modify: (hanya perbaikan bila ada yang merah)

**Interfaces:**
- Consumes: Task 1–6
- Produces: —

- [ ] **Step 1: Typecheck seluruh workspace**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-361
env -u NODE_ENV -u DATABASE_URL pnpm typecheck
```

Expected: exit 0. **Jangan** pakai `tsc -p .` tanpa `--noEmit` — itu mengotori `src/` dengan `.js`/`.d.ts`.

- [ ] **Step 2: Suite penuh**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm test
```

Expected: semua PASS. Kalau server test gagal massal dengan `P2022`/`prisma.<model> undefined`, jalankan `pnpm --filter ./server exec prisma generate` dulu — itu efek worktree, bukan perubahan SPEC ini.

- [ ] **Step 3: Build (membuktikan `--external:pdfkit` benar)**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm build && echo BUILD_OK
```

Expected: `BUILD_OK`. Kalau esbuild mengeluh soal `.afm`, berarti `--external:pdfkit` belum terpasang di script build.

- [ ] **Step 4: Siapkan DB smoke khusus (jangan pakai `hanoman_test`)**

DB `hanoman_test` bisa di-truncate sesi lain di tengah smoke. Pakai basis sendiri:

```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman361' 2>/dev/null || true
export SMOKE_DB="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman361?schema=public"
DATABASE_URL="$SMOKE_DB" pnpm --filter ./server exec prisma migrate deploy
```

- [ ] **Step 5: Boot server smoke di port sendiri**

Port 8787 dipakai sesi dev lain. Pakai 8791.

```bash
DATABASE_URL="$SMOKE_DB" PORT=8791 node server/dist/server.js > /tmp/spec361-server.log 2>&1 &
sleep 3 && curl -sf http://127.0.0.1:8791/health && echo " HEALTH_OK"
```

- [ ] **Step 6: Seed project + spec + dokumen, lalu curl keempat endpoint**

```bash
REPO=$(mktemp -d) && git -C "$REPO" init -q
mkdir -p "$REPO/internal/docs/product" "$REPO/docs/prd" "$REPO/docs/superpowers/plans"
printf '# PRD\n\nAlur: spec -> plan.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' > "$REPO/internal/docs/product/prd.md"
printf '# PRD x\n\nPanah asli: spec → plan 🎉\n' > "$REPO/docs/prd/x.md"
printf '# Rencana\n\n- [x] satu\n- [ ] dua\n' > "$REPO/docs/superpowers/plans/rencana.md"
printf -- '- [prd](product/prd.md)\n' > "$REPO/internal/docs/README.md"
git -C "$REPO" add -A && git -C "$REPO" -c user.email=a@b -c user.name=a commit -qm init

docker exec -i hanoman-db-1 psql -U hanoman -d hanoman361 <<SQL
INSERT INTO "Project" (id,name,"repoDir","createdAt","updatedAt") VALUES ('p1','P1','$REPO',now(),now())
  ON CONFLICT (id) DO UPDATE SET "repoDir"=EXCLUDED."repoDir";
INSERT INTO "Spec" (id,"projectId",title,source,stage,priority,objective,"createdAt","updatedAt")
  VALUES ('SPEC-900','p1','Smoke','brief','executing','sedang','smoke',now(),now())
  ON CONFLICT (id) DO NOTHING;
SQL
```

Buat sesi login (gate auth aktif di server nyata):

```bash
curl -s -X POST http://127.0.0.1:8791/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"smoke@x.id","password":"smoke-361-pass"}' -c /tmp/spec361.jar >/dev/null
COOKIE=$(awk '/session/{print $6"="$7}' /tmp/spec361.jar)
```

Uji keempat endpoint × dua format:

```bash
B=http://127.0.0.1:8791/api
for U in \
  "$B/projects/p1/docs/internal/docs/product/prd.md" \
  "$B/projects/p1/prds/docs/prd/x.md" \
  "$B/specs/SPEC-900/docs/docs/superpowers/plans/rencana.md" \
  "$B/projects/p1/file?path=internal/docs/product/prd.md" ; do
  for F in md pdf; do
    SEP=$([ "${U#*\?}" != "$U" ] && echo "&" || echo "?")
    curl -s -D /tmp/h.txt -o /tmp/out.$F -H "Cookie: $COOKIE" "$U$SEP download=$F" >/dev/null 2>&1 || true
    curl -s -D /tmp/h.txt -o /tmp/out.$F -H "Cookie: $COOKIE" "${U}${SEP}download=$F"
    echo "--- $U [$F]"; grep -i 'content-type\|content-disposition' /tmp/h.txt
    head -c 5 /tmp/out.$F | xxd | head -1
  done
done
```

Expected per URL: `md` → `text/markdown`, `pdf` → `application/pdf` + magic `%PDF-`, dan `content-disposition: attachment; filename="…"` di keduanya. Juga verifikasi kompatibilitas mundur:

```bash
curl -s -H "Cookie: $COOKIE" "$B/projects/p1/docs/internal/docs/product/prd.md" | head -c 60; echo
curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: $COOKIE" "$B/projects/p1/docs/internal/docs/tak/ada.md?download=pdf"
```

Expected: baris pertama JSON `{"path":…`; baris kedua `404`.

- [ ] **Step 7: Periksa PDF hasil smoke dengan mata**

```bash
curl -s -H "Cookie: $COOKIE" "$B/projects/p1/prds/docs/prd/x.md?download=pdf" -o /tmp/spec361-smoke.pdf
qlmanage -t -s 900 -o /tmp /tmp/spec361-smoke.pdf >/dev/null 2>&1 && echo /tmp/spec361-smoke.pdf.png
```

Buka gambarnya. Wajib: `→` tercetak `->` (bukan `!'`), emoji hilang bersih (bukan `Ø<ß‰`), judul + garis brass, footer `hal. 1/1`.

- [ ] **Step 8: Bereskan proses smoke**

```bash
pkill -f 'PORT=8791' 2>/dev/null; pkill -f 'node server/dist/server.js' 2>/dev/null; true
git status --short
```

Expected: `git status` bersih (tak ada `.js`/`.d.ts` nyasar, tak ada berkas smoke di worktree).

- [ ] **Step 9: Centang seluruh checklist plan ini & commit penutup**

Pastikan setiap `- [ ]` di berkas plan ini sudah `- [x]` (hanoman menahan backlog di `executing` selama masih ada yang kosong).

```bash
grep -c '^- \[ \]' docs/superpowers/plans/2026-07-28-unduh-dokumen-md-pdf-spec-361.md
```

Expected: `0`.

```bash
git add -u && git commit -m "chore(spec-361): plan terceklist penuh + verifikasi menyeluruh"
git push origin HEAD:refs/heads/hanoman/spec-361
```
