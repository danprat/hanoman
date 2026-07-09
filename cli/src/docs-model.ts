import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const LINK_RE = /\]\(([^)]+)\)/g;
export function parseIndex(indexPath: string): Set<string> {
  const md = readFileSync(indexPath, "utf8");
  const out = new Set<string>();
  for (const m of md.matchAll(LINK_RE)) {
    let t = m[1]!.trim();
    if (!t || t.startsWith("http://") || t.startsWith("https://") || t.startsWith("#") || t.startsWith("mailto:")) continue;
    t = t.split("#")[0]!.replace(/^\.\//, "");
    out.add(t.split("\\").join("/"));
  }
  return out;
}
export const INDEX_NAME = "README.md";
// README ikut korpus: `linkedSetFrom` hanya menelusuri link yang targetnya ada di
// korpus, jadi sub-index (`adr/README.md`) harus ada di sini agar bisa ditelusuri.
// Index root disaring belakangan oleh consumer, bukan di sini.
export function walkDocs(docsRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(relative(docsRoot, abs).split("\\").join("/"));
    }
  };
  walk(docsRoot);
  return out;
}
export function catStatus(files: string[], linked: Set<string>) {
  const by = new Map<string, { category: string; linked: boolean; files: string[]; unlinkedFiles: string[] }>();
  for (const f of files) {
    const category = f.split("/")[0]!;
    const c = by.get(category) ?? { category, linked: true, files: [], unlinkedFiles: [] };
    c.files.push(f);
    if (!linked.has(f)) { c.linked = false; c.unlinkedFiles.push(f); }
    by.set(category, c);
  }
  return [...by.values()];
}
