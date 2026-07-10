import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

// SPEC-171 · review worktree backlog item: all files (ls-files) + file changed
// (diff atas merge-base). Diturunkan dari git tiap request, tak disimpan. Mekanik
// diff mengikuti SPEC-144 (index sementara + `git add -A -N` untuk untracked).
//
// execFile di-promisify, maxBuffer 1<<24: preseden services/scan.ts — spawn blocking
// akan menghentikan seluruh event loop server.
const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24 } as const;
const MAX = 256 * 1024;

export type ChangedFile = { path: string; add: number; del: number; status: "A" | "M" | "D"; binary: boolean };
export type SpecReview = { base: string; files: string[]; changed: ChangedFile[] };
export type ReviewFile = {
  path: string; status: "A" | "M" | "D" | null; binary: boolean;
  truncated: boolean; diff: string | null; content: string | null;
};

// ponytail: normalisasi id sama dengan pty.ts idFor & terminal.ts; ekstrak kalau muncul consumer keempat.
export const worktreeDir = (repoDir: string, specId: string): string =>
  join(repoDir, ".worktrees", specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_"));

// `git add -A -N` (intent-to-add) di salinan index sementara: file untracked masuk hitungan
// diff TANPA menghash isi ke object database, dan index worktree hidup tak tersentuh (SPEC-144).
async function withTempIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const idx = (await exec("git", ["rev-parse", "--git-path", "index"], { cwd: wt, ...GIT })).stdout.trim();
  const dir = await mkdtemp(join(tmpdir(), "hanoman-idx-"));
  const tmp = join(dir, "index");
  await copyFile(resolve(wt, idx), tmp);
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  try { await exec("git", ["add", "-A", "-N"], { cwd: wt, env, ...GIT }); return await fn(env); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const splitZ = (s: string): string[] => s.split("\0").filter(Boolean);

async function mergeBase(wt: string, branchFrom: string | null): Promise<string> {
  const { stdout } = await exec("git", ["merge-base", branchFrom || "main", "HEAD"], { cwd: wt, ...GIT });
  return stdout.trim();
}

// File yang ADA di worktree = tracked ∪ untracked-tak-ignored, minus yang dihapus dari
// working tree (masih di index, jadi `ls-files` polos tetap menyebutnya). Cermin explorer
// VSCode: file yang dihapus tampil di panel Changed, bukan di pohon file.
async function allFiles(wt: string): Promise<string[]> {
  const [tracked, untracked, deleted] = await Promise.all([
    exec("git", ["ls-files", "-z"], { cwd: wt, ...GIT }),
    exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: wt, ...GIT }),
    exec("git", ["ls-files", "--deleted", "-z"], { cwd: wt, ...GIT }),
  ]);
  const gone = new Set(splitZ(deleted.stdout));
  return [...new Set([...splitZ(tracked.stdout), ...splitZ(untracked.stdout)])]
    .filter((p) => !gone.has(p)).sort();
}

async function changedFiles(wt: string, base: string, env: NodeJS.ProcessEnv): Promise<ChangedFile[]> {
  const [num, name] = await Promise.all([
    exec("git", ["diff", "--numstat", "-z", "--no-renames", base], { cwd: wt, env, ...GIT }),
    exec("git", ["diff", "--name-status", "-z", "--no-renames", base], { cwd: wt, env, ...GIT }),
  ]);
  const map = new Map<string, ChangedFile>();
  // --numstat -z: `add \t del \t path` \0. Binary = `-`/`-` — cek SEBELUM Number() (kalau tidak: NaN).
  for (const rec of splitZ(num.stdout)) {
    const tab = rec.indexOf("\t"), tab2 = rec.indexOf("\t", tab + 1);
    const add = rec.slice(0, tab), del = rec.slice(tab + 1, tab2), path = rec.slice(tab2 + 1);
    const binary = add === "-" && del === "-";
    map.set(path, { path, add: binary ? 0 : Number(add), del: binary ? 0 : Number(del), status: "M", binary });
  }
  // --name-status -z: `status` \0 `path` \0. status[0] = A|M|D (--no-renames → tak ada R/C).
  const toks = splitZ(name.stdout);
  for (let i = 0; i + 1 < toks.length; i += 2) {
    const st = toks[i]![0] as "A" | "M" | "D";
    const path = toks[i + 1]!;
    const cf = map.get(path) ?? { path, add: 0, del: 0, status: st, binary: false };
    cf.status = st;
    map.set(path, cf);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function specReview(repoDir: string, specId: string, branchFrom: string | null): Promise<SpecReview> {
  const wt = worktreeDir(repoDir, specId);
  const base = await mergeBase(wt, branchFrom);
  const files = await allFiles(wt);
  const changed = await withTempIndex(wt, (env) => changedFiles(wt, base, env));
  return { base, files, changed };
}

export async function reviewFile(
  repoDir: string, specId: string, branchFrom: string | null, path: string,
): Promise<ReviewFile | null> {
  const wt = worktreeDir(repoDir, specId);
  const { base, files, changed } = await specReview(repoDir, specId, branchFrom);
  const cf = changed.find((c) => c.path === path);
  if (!cf && !files.includes(path)) return null; // gerbang path → route 404
  if (cf?.binary) return { path, status: cf.status, binary: true, truncated: false, diff: null, content: null };
  const status = cf?.status ?? null;
  const diffRaw = await withTempIndex(wt, async (env) =>
    (await exec("git", ["diff", base, "--", path], { cwd: wt, env, ...GIT })).stdout);
  let contentRaw: string | null = null;
  if (status !== "D") { try { contentRaw = await readFile(join(wt, path), "utf8"); } catch { contentRaw = null; } }
  return {
    path, status, binary: false,
    truncated: diffRaw.length > MAX || (contentRaw?.length ?? 0) > MAX,
    diff: diffRaw.slice(0, MAX),
    content: contentRaw === null ? null : contentRaw.slice(0, MAX),
  };
}
