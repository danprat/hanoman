import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { coverageOf, linkedSetFrom, zHanomanConfig } from "@hanoman/shared";

export type DocCat = { cat: string; files: string[]; linked: boolean; root: boolean; scored: boolean };

// All markdown in the repo — tracked or new — with .gitignore honored (skips
// node_modules/.worktrees/dist for free). Posix rel paths.
export function listRepoDocs(repoDir: string): string[] {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
    { cwd: repoDir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
}

// ponytail: 3 baris; angkat ke adapter node bersama kalau muncul consumer ketiga.
// Barrel shared harus bebas node:*, jadi loadConfig tak bisa tinggal di sana.
function docsDirOf(repoDir: string): string {
  try {
    const raw = readFileSync(resolve(repoDir, "hanoman.config.json"), "utf8");
    return zHanomanConfig.parse(JSON.parse(raw)).docsDir;
  } catch { return zHanomanConfig.parse({}).docsDir; }
}

// Index SoT = docsDir/README.md. Root README.md repo adalah entrypoint, bukan index.
export function resolveIndex(repoDir: string, docsDir: string): string {
  const rel = `${docsDir}/README.md`;
  return existsSync(resolve(repoDir, rel)) ? rel : "";
}

const catOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".");
const nameOf = (rel: string) => (rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel);

// ponytail: naive full re-scan (reads every .md) per call. Add an mtime/HEAD cache
// only if a large repo makes GET /docs slow.
//
// Dua korpus, sengaja dipisah: `files` untuk dibrowse (semua .md repo), `corpus`
// untuk dinilai (di bawah docsDir). Kategori di luar docsDir -> scored:false.
export function scanRepoDocs(repoDir: string | null): { coverage: number; tree: DocCat[] } {
  if (!repoDir || !existsSync(repoDir)) return { coverage: 0, tree: [] };
  const files = listRepoDocs(repoDir);
  const docsDir = docsDirOf(repoDir);
  const index = resolveIndex(repoDir, docsDir);
  const read = (rel: string): string | null => {
    try { return readFileSync(resolve(repoDir, rel), "utf8"); } catch { return null; }
  };
  // README sub-index ikut korpus BFS; hanya index root yang dikeluarkan dari denominator.
  const corpus = files.filter((f) => f.startsWith(docsDir + "/"));
  const inDocs = new Set(corpus);
  const linked = index ? linkedSetFrom(index, corpus, read) : new Set<string>();
  const byCat = new Map<string, DocCat>();
  for (const f of files) {
    const cat = catOf(f);
    const c = byCat.get(cat) ?? { cat, files: [], linked: true, root: cat === ".", scored: inDocs.has(f) };
    c.files.push(nameOf(f));
    c.linked = c.linked && linked.has(f);
    byCat.set(cat, c);
  }
  const scored = corpus.filter((f) => f !== index);
  const coverage = coverageOf(scored.map((f) => ({ category: catOf(f), linked: linked.has(f) })));
  return { coverage, tree: [...byCat.values()] };
}

// Guarded absolute path for a repo-relative doc. `cat + "/" + name` from the tree
// round-trips straight to `rel`, so no prefix juggling.
export function docAbsPath(repoDir: string, rel: string): string {
  if (!rel.endsWith(".md")) throw new Error("hanya file .md yang diizinkan");
  if (rel.split("/").includes(".git")) throw new Error("tidak boleh menyentuh .git");
  const abs = resolve(repoDir, rel);
  if (abs !== repoDir && !abs.startsWith(repoDir + sep)) throw new Error("path keluar dari repo");
  return abs;
}

export function readDocFile(repoDir: string, rel: string): string | null {
  try { return readFileSync(docAbsPath(repoDir, rel), "utf8"); } catch { return null; }
}
export function writeDocFile(repoDir: string, rel: string, content: string): void {
  const abs = docAbsPath(repoDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
export function deleteDocFile(repoDir: string, rel: string): boolean {
  const abs = docAbsPath(repoDir, rel);
  if (!existsSync(abs)) return false;
  rmSync(abs);
  return true;
}
