// SPEC-249 · ADR-0060 · fingerprint grouping deterministik. Fungsi murni (unit-test tanpa DB).
// Varian dari error yang sama (id/angka/path berbeda) jatuh ke satu grup.
import { createHash } from "node:crypto";

// Ganti token volatil dengan placeholder agar pesan yang "sama bentuk" jadi identik.
export function normalizeMessage(msg: string): string {
  return (msg || "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/"[^"]*"|'[^']*'/g, "<str>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

// SPEC-276 · Temuan B audit SPEC-275 · buang segmen content-hash pada basename bundle:
// "index-4f3a2b.js" → "index.js" (grup stabil lintas deploy). Hanya token ≥6 char yang
// MENGANDUNG digit yang di-strip → nama biasa ("d3-scale", "chart-v2") tetap utuh.
export function normalizeBundleName(name: string): string {
  return name.replace(/([-.])(?=[a-z0-9_]*\d)[a-z0-9_]{6,}(\.[a-z0-9]+)$/i, "$2");
}

// basename dari path/URL: buang query/fragment lalu segmen setelah "/" atau "\".
function baseOf(s: string): string {
  const clean = (s.split(/[?#]/)[0] ?? "");
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || clean;
}

// Frame teratas → "at fn (basename)". Path berkurung & URL anonim sama-sama direduksi ke basename
// (bukan URL/path penuh) lalu dinormalisasi hash → tak volatile antar-deploy.
export function topFrame(stack?: string): string {
  if (!stack) return "";
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    return line
      .replace(/:\d+:\d+/g, "")                                              // buang :line:col
      .replace(/\(([^)]*)\)/g, (_m, inner) => `(${normalizeBundleName(baseOf(inner))})`)  // (path) → (basename)
      .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s()]+/gi, (m) => normalizeBundleName(baseOf(m)))  // URL/path anonim → basename
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

type FpFrame = { function?: string; filename?: string; in_app?: boolean };
// Dari frame terstruktur: pakai frame in_app teratas (fallback frame pertama). Basename ternormalisasi
// hash → identitas grup stabil lintas deploy meski bundle ber-content-hash.
function topFrameFromFrames(frames: FpFrame[]): string {
  const f = frames.find((x) => x.in_app) ?? frames[0];
  if (!f) return "";
  return `at ${f.function ?? "?"} (${normalizeBundleName(baseOf(f.filename ?? ""))})`;
}

export function fingerprint(type: string, message: string, stack?: string, frames?: FpFrame[]): string {
  const top = frames && frames.length ? topFrameFromFrames(frames) : topFrame(stack);
  const basis = `${type}\n${normalizeMessage(message)}\n${top}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
