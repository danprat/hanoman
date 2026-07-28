/* doc-export (SPEC-361 · ADR-0078) — unduh dokumen sebagai .md mentah atau .pdf.
   Dipakai empat endpoint dokumen lewat query `?download=`. PDF dirender dari token
   `marked` (parser yang SAMA dengan preview frontend) ke pdfkit. */
import PDFDocument from "pdfkit";
import { marked, type Tokens } from "marked";
import type { FastifyReply } from "fastify";

// PDF standard-14 font hanya meng-encode WinAnsi. Glyph di luar itu tidak melempar error —
// ia tercetak sebagai mojibake senyap (`→` jadi `!'`, emoji jadi `Ø<ß‰`). Jadi setiap teks
// WAJIB lewat sini dulu. Karakter yang SUDAH ada di WinAnsi (— • · “ ” … é) dibiarkan utuh.
const TRANSLIT: Record<string, string> = {
  "→": "->", "⟶": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇐": "<=", "⇔": "<=>",
  "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "∞": "inf",
  "✓": "v", "✔": "v", "✅": "v", "✗": "x", "✘": "x", "❌": "x", "⚠": "!", "⚡": "!",
  "☐": "[ ]", "☑": "[x]", "☒": "[x]", "▸": ">", "▾": "v", "▪": "-", "▫": "-",
  "─": "-", "━": "-", "│": "|", "┃": "|", "└": "+", "├": "+", "┌": "+", "┐": "+", "┘": "+",
  "⌘": "Cmd", "⌥": "Alt", "⇧": "Shift", "␣": " ",
};
// Rentang 0x80–0x9F WinAnsi memetakan codepoint Unicode > 0xFF; ini daftar lengkapnya.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));
// Emoji, dingbat, simbol lain-lain, dan variation selector: dibuang, bukan jadi "?" —
// "?" berderet lebih mengganggu daripada absen.
function isDropped(cp: number): boolean {
  return (cp >= 0x1f000 && cp <= 0x1ffff)   // emoji & pictograph
    || (cp >= 0x2600 && cp <= 0x27bf)       // misc symbols + dingbats
    || (cp >= 0xfe00 && cp <= 0xfe0f)       // variation selectors
    || cp === 0x200d;                       // zero-width joiner
}
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

// Nama berkas unduhan: <prefix>-<basename tanpa ekstensi>.<ext>, disanitasi agar aman di
// header content-disposition maupun di filesystem mana pun.
export function downloadFilename(prefix: string, path: string, ext: "md" | "pdf"): string {
  const base = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  const slug = [prefix, base].filter(Boolean).join("-")
    .replace(/[^\w.-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  return `${slug || "dokumen"}.${ext}`;
}

// ---------------------------------------------------------------------------
// Renderer PDF: token `marked` -> pdfkit.
// ---------------------------------------------------------------------------

// Warna diambil dari token design system (src/src/ds/tokens/colors.css) agar PDF terbaca
// sebagai dokumen hanoman, bukan keluaran generik.
const INK = "#3a3125", STRONG = "#17130c", MUTED = "#6f6250";
const BRASS = "#b8863b", HAIR = "#d6ccb9", PANEL = "#f6f1e7", LINK = "#3f6a70";
const BRASS_TEXT = "#7a5417";  // brass-700 — `kode` inline, cukup kontras untuk dibaca di cetak

const BODY = 10.5, CODE = 8.6, LEAD = 3;
const H_SIZE: Record<number, number> = { 1: 19, 2: 14.5, 3: 12.5, 4: 11, 5: 10.5, 6: 10.5 };

export type DocPdfMeta = { eyebrow: string; path: string };
type Doc = PDFKit.PDFDocument;
type Node = { type?: string; tokens?: Node[]; text?: string; href?: string; depth?: number };

// Segmen inline sudah rata (flattened) jadi teks + gaya, karena pdfkit menggambar per-run.
type Run = { text: string; bold?: boolean; italic?: boolean; mono?: boolean; strike?: boolean; link?: string };

function fontOf(r: Run): string {
  if (r.mono) return r.bold ? "Courier-Bold" : "Courier";
  if (r.bold && r.italic) return "Helvetica-BoldOblique";
  if (r.bold) return "Helvetica-Bold";
  if (r.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

// `marked` menyerahkan teks masih ter-escape HTML; kalau dibiarkan, `a > b` tercetak `a &gt; b`.
const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};
function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
}
// Soft line break di dalam paragraf = spasi (marked dipakai dengan `breaks:false`, sama seperti
// preview). Hanya token `br` eksplisit yang boleh memutus baris.
export const inlineText = (s: string) => decodeEntities(s).replace(/\s*\n\s*/g, " ");

// marked memberi token inline bersarang; ratakan jadi daftar Run dengan gaya terwarisi.
function flatten(tokens: Node[] | undefined, base: Run = { text: "" }): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong": out.push(...flatten(t.tokens, { ...base, bold: true })); break;
      case "em": out.push(...flatten(t.tokens, { ...base, italic: true })); break;
      case "del": out.push(...flatten(t.tokens, { ...base, strike: true })); break;
      case "codespan": out.push({ ...base, text: inlineText(t.text ?? ""), mono: true }); break;
      case "link": out.push(...flatten(t.tokens, { ...base, link: t.href })); break;
      case "br": out.push({ ...base, text: "\n" }); break;
      case "image": out.push({ ...base, text: `[gambar: ${t.href ?? ""}]`, italic: true }); break;
      case "escape":
      case "text":
        if (t.tokens?.length) out.push(...flatten(t.tokens, base));
        else out.push({ ...base, text: inlineText(t.text ?? "") });
        break;
      default: out.push({ ...base, text: inlineText(t.text ?? "") });
    }
  }
  return out;
}

// Satu paragraf = deretan Run digambar berurutan; `continued` menjaga mereka satu aliran.
// CATATAN: JANGAN pakai opsi `baseline` di sini. Ia memang meratakan garis dasar Courier vs
// Helvetica, tapi merusak pembukuan `doc.y` (garis `rule()` meleset) dan membuat underline
// tautan meluber sampai margin kanan. Float kecil teks mono lebih murah daripada itu.
function drawRuns(doc: Doc, runs: Run[], size: number, color: string, opts: PDFKit.Mixins.TextOptions = {}) {
  const items = runs.filter((r) => r.text !== "");
  if (!items.length) { doc.moveDown(0.4); return; }
  items.forEach((r, i) => {
    doc.font(fontOf(r)).fontSize(r.mono ? size * 0.92 : size)
      .fillColor(r.link ? LINK : r.mono ? BRASS_TEXT : color)
      .text(toWinAnsi(r.text), {
        continued: i < items.length - 1, lineGap: LEAD,
        // Flag WAJIB eksplisit boolean/null: pdfkit mewariskan opsi di sepanjang rantai
        // `continued`, jadi `strike: undefined` membiarkan coretan run sebelumnya menular
        // ke seluruh sisa paragraf.
        strike: !!r.strike, underline: !!r.link, link: r.link ?? null,
        ...opts,
      });
  });
}

function rule(doc: Doc, color = HAIR, gap = 6) {
  const y = doc.y + gap / 2;
  doc.save().strokeColor(color).lineWidth(0.6)
    .moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke().restore();
  doc.y = y + gap;
}

function drawCode(doc: Doc, text: string) {
  const left = doc.page.margins.left, right = doc.page.width - doc.page.margins.right;
  const body = toWinAnsi(text.replace(/\n+$/, ""));
  doc.font("Courier").fontSize(CODE);
  const h = doc.heightOfString(body, { width: right - left - 16, lineGap: 1.5 }) + 12;
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.save().rect(left, doc.y, right - left, h).fill(PANEL).restore();
  doc.fillColor(INK).text(body, left + 8, doc.y + 6, { width: right - left - 16, lineGap: 1.5 });
  doc.x = left;
  doc.moveDown(0.5);
}

function drawList(doc: Doc, list: Tokens.List, depth: number) {
  const indent = 14 * depth;
  let n = Number(list.start || 1);
  for (const item of list.items) {
    const marker = list.ordered ? `${n++}.`
      : item.task ? (item.checked ? "[x]" : "[ ]")
      : depth > 0 ? "-" : "•";
    const top = doc.y;
    doc.font("Helvetica").fontSize(BODY).fillColor(MUTED)
      .text(toWinAnsi(marker), doc.page.margins.left + indent, top, { width: 24, lineBreak: false });
    doc.y = top;
    const x = doc.page.margins.left + indent + 24;
    const w = doc.page.width - doc.page.margins.right - x;
    // Token blok di dalam list-item (paragraf) digambar bergeser ke kanan bullet;
    // list bersarang ditangani rekursi di bawah.
    const inline = (item.tokens ?? []).filter((t) => (t as Node).type !== "list");
    doc.x = x;
    drawRuns(doc, flatten(inline.flatMap((t) => (t as Node).tokens ?? [t as Node])), BODY, INK, { width: w });
    doc.x = doc.page.margins.left;
    for (const t of item.tokens ?? []) {
      if ((t as Node).type === "list") drawList(doc, t as unknown as Tokens.List, depth + 1);
    }
  }
  doc.moveDown(0.3);
}

type Cell = { tokens?: Node[]; text?: string };
function drawTable(doc: Doc, t: Tokens.Table) {
  const left = doc.page.margins.left, right = doc.page.width - doc.page.margins.right;
  const cols = t.header.length || 1;
  const w = (right - left) / cols;
  const row = (cells: Cell[], bold: boolean) => {
    const texts = cells.map((c) => toWinAnsi(flatten(c.tokens).map((r) => r.text).join("") || c.text || ""));
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.2).fillColor(bold ? STRONG : INK);
    const h = Math.max(...texts.map((s) => doc.heightOfString(s, { width: w - 10 })), 0) + 7;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y0 = doc.y;
    texts.forEach((s, i) => doc.text(s, left + i * w + 5, y0 + 3, { width: w - 10 }));
    doc.x = left; doc.y = y0 + h;
    rule(doc, HAIR, 2);
  };
  rule(doc, HAIR, 2);
  row(t.header as unknown as Cell[], true);
  for (const r of t.rows) row(r as unknown as Cell[], false);
  doc.moveDown(0.3);
}

function drawTokens(doc: Doc, tokens: Node[]) {
  for (const t of tokens) {
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
        const inner = (t.tokens ?? []).flatMap((b) => b.tokens ?? [b]);
        drawRuns(doc, flatten(inner).map((r) => ({ ...r, italic: true })), BODY, MUTED,
          { width: doc.page.width - doc.page.margins.right - doc.page.margins.left - 12 });
        doc.x = doc.page.margins.left;
        doc.save().strokeColor(BRASS).lineWidth(2)
          .moveTo(doc.page.margins.left + 2, y0).lineTo(doc.page.margins.left + 2, doc.y).stroke().restore();
        doc.moveDown(0.45);
        break;
      }
      case "table": drawTable(doc, t as unknown as Tokens.Table); break;
      case "hr": rule(doc, HAIR, 10); break;
      case "space": doc.moveDown(0.3); break;
      case "html":
      case "text":
        drawRuns(doc, t.tokens?.length ? flatten(t.tokens) : [{ text: t.text ?? "" }], BODY, INK);
        doc.moveDown(0.3);
        break;
      default: if (t.text) { drawRuns(doc, [{ text: t.text }], BODY, INK); doc.moveDown(0.3); }
    }
  }
}

/** Render satu dokumen jadi PDF. `name` menentukan md vs blok kode (cermin `hnDocHtml` frontend). */
export function renderDocPdf(text: string, name: string, meta: DocPdfMeta): Promise<Buffer> {
  const src = /\.md$/i.test(name) ? (text || "") : "```\n" + (text || "") + "\n```";
  const doc: Doc = new PDFDocument({
    size: "A4", bufferPages: true,
    margins: { top: 64, bottom: 60, left: 58, right: 58 },
    info: { Title: meta.path, Creator: "hanoman", Producer: "hanoman" },
  });
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

  drawTokens(doc, marked.lexer(src) as unknown as Node[]);

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
  doc.flushPages();
  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// Jembatan HTTP: dipakai keempat endpoint dokumen.
// ---------------------------------------------------------------------------

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
  reply.header("content-disposition", `attachment; filename="${downloadFilename(a.prefix, a.name, fmt)}"`);
  if (fmt === "md") {
    reply.header("content-type", "text/markdown; charset=utf-8");
    return reply.send(a.content);
  }
  reply.header("content-type", "application/pdf");
  return reply.send(await renderDocPdf(a.content, a.name, { eyebrow: a.eyebrow, path: a.path }));
}
