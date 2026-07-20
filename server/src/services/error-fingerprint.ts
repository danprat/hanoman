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

// Frame teratas tanpa :line:col dan tanpa prefix path absolut (basename saja).
export function topFrame(stack?: string): string {
  if (!stack) return "";
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    return line
      .replace(/:\d+:\d+/g, "")                          // buang :line:col
      .replace(/\(([^)]*[/\\])?([^/\\)]+)\)/, "($2)")    // path absolut → basename
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

export function fingerprint(type: string, message: string, stack?: string): string {
  const basis = `${type}\n${normalizeMessage(message)}\n${topFrame(stack)}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
