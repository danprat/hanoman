import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { ChangedFile } from "./spec-review";

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

const US = "\x1f"; // unit separator dalam satu baris commit

export type GraphCommit = { sha: string; parents: string[]; author: string; at: string; subject: string; refs: string[] };

async function currentBranch(repoDir: string): Promise<string> {
  return exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir, ...GIT })
    .then((r) => r.stdout.trim()).catch(() => "");
}

// git log --all seluruh ref. `%D` = ref names ("HEAD -> main, origin/main, tag: v1"); buang
// prefix "HEAD -> ". Satu commit = satu baris (subject/refs tanpa newline).
export async function listGraph(repoDir: string | null, limit = 200): Promise<{ commits: GraphCommit[]; current: string }> {
  if (!repoDir || !existsSync(repoDir)) return { commits: [], current: "" };
  try {
    const fmt = ["%H", "%P", "%an", "%aI", "%s", "%D"].join(US);
    const { stdout } = await exec("git",
      ["log", "--all", "--date-order", `--max-count=${limit}`, `--pretty=format:${fmt}`], { cwd: repoDir, ...GIT });
    const commits = stdout.split("\n").filter(Boolean).map((line) => {
      const [sha, parents, author, at, subject, refs] = line.split(US);
      return {
        sha: sha!, parents: parents ? parents.split(" ") : [], author: author ?? "", at: at ?? "",
        subject: subject ?? "",
        refs: (refs ?? "").split(",").map((r) => r.trim().replace(/^HEAD -> /, "").replace(/^tag: /, ""))
          .filter((r) => r && r !== "HEAD"),
      };
    });
    return { commits, current: await currentBranch(repoDir) };
  } catch { return { commits: [], current: "" }; }
}

export type CommitDetail = {
  sha: string; parents: string[]; author: string; at: string; subject: string; body: string; changed: ChangedFile[];
};

// ponytail: parse numstat+name-status cermin spec-review.changedFiles; ~12 baris, tak refactor
// file bertest itu. `git show --format=` menekan header commit, menyisakan diff saja.
async function changedOf(repoDir: string, sha: string): Promise<ChangedFile[]> {
  const [num, name] = await Promise.all([
    exec("git", ["show", "--format=", "--numstat", "-z", "--no-renames", sha], { cwd: repoDir, ...GIT }),
    exec("git", ["show", "--format=", "--name-status", "-z", "--no-renames", sha], { cwd: repoDir, ...GIT }),
  ]);
  const map = new Map<string, ChangedFile>();
  for (const rec of splitZ(num.stdout)) {
    const t1 = rec.indexOf("\t"), t2 = rec.indexOf("\t", t1 + 1);
    const add = rec.slice(0, t1), del = rec.slice(t1 + 1, t2), path = rec.slice(t2 + 1);
    const binary = add === "-" && del === "-";
    map.set(path, { path, add: binary ? 0 : Number(add), del: binary ? 0 : Number(del), status: "M", binary });
  }
  const toks = splitZ(name.stdout);
  for (let i = 0; i + 1 < toks.length; i += 2) {
    const st = toks[i]![0] as "A" | "M" | "D", path = toks[i + 1]!;
    const cf = map.get(path) ?? { path, add: 0, del: 0, status: st, binary: false };
    cf.status = st; map.set(path, cf);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function commitDetail(repoDir: string | null, sha: string): Promise<CommitDetail | null> {
  if (!repoDir) return null;
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return null; // gerbang: hanya sha hex
  try {
    const fmt = ["%H", "%P", "%an", "%aI", "%s", "%b"].join(US);
    const parts = (await exec("git", ["show", "-s", `--pretty=format:${fmt}`, sha], { cwd: repoDir, ...GIT })).stdout.split(US);
    const [h, parents, author, at, subject] = parts;
    return {
      sha: h!, parents: parents ? parents.split(" ") : [], author: author ?? "", at: at ?? "",
      subject: subject ?? "", body: parts.slice(5).join(US), changed: await changedOf(repoDir, sha),
    };
  } catch { return null; }
}
