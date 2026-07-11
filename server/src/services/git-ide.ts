import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";

const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24 } as const;
const MAX = 256 * 1024;

const splitZ = (s: string): string[] => s.split("\0").filter(Boolean);

// Path guard umum (bukan hanya .md seperti scan.docAbsPath). Cermin logikanya: resolve,
// cegah keluar repo, cegah menyentuh .git. Throw → route menerjemahkan ke 400.
export function repoAbsPath(repoDir: string, rel: string): string {
  if (rel.split(/[\\/]/).includes(".git")) throw new Error("tidak boleh menyentuh .git");
  const abs = resolve(repoDir, rel);
  if (abs !== repoDir && !abs.startsWith(repoDir + sep)) throw new Error("path keluar dari repo");
  return abs;
}

// Daftar file: working tree (ref kosong, honor .gitignore) atau snapshot di ref.
export async function listRepoTree(repoDir: string | null, ref = ""): Promise<string[]> {
  if (!repoDir || !existsSync(repoDir)) return [];
  try {
    const { stdout } = ref
      ? await exec("git", ["ls-tree", "-r", "--name-only", "-z", ref], { cwd: repoDir, ...GIT })
      : await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repoDir, ...GIT });
    return [...new Set(splitZ(stdout))].sort();
  } catch { return []; }
}

export type RepoFile = { path: string; content: string | null; binary: boolean; truncated: boolean };

// Isi file: disk (ref kosong) atau `git show <ref>:<path>`. Path buruk → throw (route 400).
// File tak ada → null (route 404). NUL byte → binary (heuristik).
// ponytail: deteksi biner via NUL byte; cukup untuk viewer, upgrade ke gitattributes bila perlu.
export async function readRepoFile(repoDir: string | null, rel: string, ref = ""): Promise<RepoFile | null> {
  if (!repoDir) return null;
  repoAbsPath(repoDir, rel); // throws → route 400
  let raw: string;
  try {
    raw = ref
      ? (await exec("git", ["show", `${ref}:${rel}`], { cwd: repoDir, ...GIT })).stdout
      : await readFile(repoAbsPath(repoDir, rel), "utf8");
  } catch { return null; }
  if (raw.includes("\u0000")) return { path: rel, content: null, binary: true, truncated: false };
  return { path: rel, content: raw.slice(0, MAX), binary: false, truncated: raw.length > MAX };
}
