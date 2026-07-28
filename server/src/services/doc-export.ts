/* doc-export (SPEC-361 · ADR-0077) — unduh dokumen sebagai .md mentah atau .pdf.
   Dipakai empat endpoint dokumen lewat query `?download=`. PDF dirender dari token
   `marked` (parser yang SAMA dengan preview frontend) ke pdfkit. */

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
