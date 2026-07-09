import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
const MAX = 1 << 24;                      // maxBuffer — mengikuti services/scan.ts
export const PREVIEW_LIMIT = 256 * 1024;  // preseden scrollback PTY (ADR-0014)

/** Run yang changes-nya tak dapat dibaca sama sekali. Route memetakannya ke 409. */
export class ChangesUnavailable extends Error {}

export type ChangedFile = { path: string; add: number; del: number; status: "A"|"M"|"D"; binary: boolean };
export type RunCommit   = { sha: string; subject: string };
export type RunChanges  = { base: string|null; head: string|null; commits: RunCommit[]; files: ChangedFile[] };
export type FilePreview = { path: string; status: "A"|"M"|"D"; binary: boolean; truncated: boolean;
                            diff: string|null; content: string|null };
export type RunRow = { worktree: string; baseSha: string|null; headSha: string|null };

type Site = { cwd: string; env: NodeJS.ProcessEnv; revs: string[]; range: string; live: boolean };

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  exec("git", args, { cwd, env, maxBuffer: MAX }).then((r) => r.stdout);

// Worktree yang hidup: file baru masih untracked, dan `git diff` polos MELEWATKANNYA tanpa error.
// `git add -A -N` (intent-to-add) di atas salinan index membuatnya terlihat tanpa menghash isi —
// `git add -A` biasa menulis satu blob per file berubah ke .git/objects pada SETIAP request.
// Di worktree tertaut `.git` adalah file, jadi index-nya hanya bisa ditemukan lewat --git-path.
async function withTempIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const real = (await git(wt, ["rev-parse", "--git-path", "index"])).trim();
  const dir = await mkdtemp(join(tmpdir(), "hanoman-idx-"));
  const tmp = join(dir, "index");
  await copyFile(real, tmp);
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  try {
    await git(wt, ["add", "-A", "-N"], env);
    return await fn(env);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function resolveSite(run: RunRow, repoDir: string | null): Promise<Site> {
  if (!repoDir) throw new ChangesUnavailable("project tanpa repoDir");
  const base = run.baseSha!;
  const wt = join(repoDir, run.worktree);
  // Worktree lebih dulu: bila removeWorktree gagal setelah commit, keduanya ada dan
  // pohon di disk adalah kebenaran yang sama dengan baseSha..headSha.
  if (existsSync(wt)) return { cwd: wt, env: process.env, revs: [base], range: `${base}..HEAD`, live: true };
  if (!run.headSha) throw new ChangesUnavailable("worktree run sudah tidak ada dan run tidak pernah commit");
  await git(repoDir, ["cat-file", "-e", `${run.headSha}^{commit}`])
    .catch(() => { throw new ChangesUnavailable(`commit tak terjangkau: ${run.headSha}`); });
  return { cwd: repoDir, env: process.env, revs: [base, run.headSha],
           range: `${base}..${run.headSha}`, live: false };
}

// `--numstat -z` → "add \t del \t path \0"; biner memakai "-" untuk add/del.
// `--name-status -z` → "status \0 path \0" berselang-seling.
// `--no-renames`: rename mengubah bentuk record menjadi tiga field dan memecahkan gerbang path.
function parseNumstat(out: string): Map<string, { add: number; del: number; binary: boolean }> {
  const m = new Map<string, { add: number; del: number; binary: boolean }>();
  for (const rec of out.split("\0")) {
    if (!rec) continue;
    const [a, d, ...rest] = rec.split("\t");
    const path = rest.join("\t");
    const binary = a === "-" || d === "-";
    m.set(path, { add: binary ? 0 : Number(a), del: binary ? 0 : Number(d), binary });
  }
  return m;
}
function parseNameStatus(out: string): Map<string, "A"|"M"|"D"> {
  const parts = out.split("\0").filter(Boolean);
  const m = new Map<string, "A"|"M"|"D">();
  for (let i = 0; i + 1 < parts.length; i += 2) m.set(parts[i + 1]!, parts[i]! as "A"|"M"|"D");
  return m;
}

async function collect(site: Site): Promise<{ commits: RunCommit[]; files: ChangedFile[] }> {
  const diffArgs = (extra: string[]) => ["diff", ...extra, "-z", "--no-renames", ...site.revs];
  const [numstat, nameStatus, log] = await Promise.all([
    git(site.cwd, diffArgs(["--numstat"]), site.env),
    git(site.cwd, diffArgs(["--name-status"]), site.env),
    git(site.cwd, ["log", "--format=%H%x1f%s", site.range], site.env),
  ]);
  const nums = parseNumstat(numstat);
  const stat = parseNameStatus(nameStatus);
  const files: ChangedFile[] = [...nums.entries()]
    .map(([path, n]) => ({ path, add: n.add, del: n.del, binary: n.binary, status: stat.get(path) ?? "M" }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const commits = log.split("\n").filter(Boolean)
    .map((l) => { const [sha, ...s] = l.split("\x1f"); return { sha: sha!, subject: s.join("\x1f") }; });
  return { commits, files };
}

const EMPTY: RunChanges = { base: null, head: null, commits: [], files: [] };

export async function runChanges(run: RunRow, repoDir: string | null): Promise<RunChanges> {
  if (!run.baseSha) return EMPTY;               // queued, atau baris pra-migration
  const site = await resolveSite(run, repoDir);
  const run_ = site.live
    ? await withTempIndex(site.cwd, (env) => collect({ ...site, env }))
    : await collect(site);
  return { base: run.baseSha, head: run.headSha, ...run_ };
}

const cut = (s: string) => (s.length > PREVIEW_LIMIT ? { text: s.slice(0, PREVIEW_LIMIT), cut: true } : { text: s, cut: false });

export async function runChangeFile(run: RunRow, repoDir: string | null, path: string): Promise<FilePreview | null> {
  const changes = await runChanges(run, repoDir);
  const f = changes.files.find((x) => x.path === path);
  if (!f) return null;                          // gerbang: hanya file milik run ini
  if (f.binary) return { path, status: f.status, binary: true, truncated: false, diff: null, content: null };

  const site = await resolveSite(run, repoDir);
  const read = async (env: NodeJS.ProcessEnv): Promise<{ diff: string; content: string | null }> => {
    const diff = await git(site.cwd, ["diff", ...site.revs, "--", path], env);
    if (f.status === "D") return { diff, content: null };
    const content = site.live
      ? await readFile(join(site.cwd, path), "utf8")
      : await git(site.cwd, ["show", `${run.headSha}:${path}`], env);
    return { diff, content };
  };
  const { diff, content } = site.live ? await withTempIndex(site.cwd, read) : await read(site.env);

  const d = cut(diff);
  const c = content === null ? { text: null, cut: false } : cut(content);
  return { path, status: f.status, binary: false, truncated: d.cut || c.cut, diff: d.text, content: c.text };
}
