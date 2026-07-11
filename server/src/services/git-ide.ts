import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep, dirname } from "node:path";
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

export async function writeRepoFile(repoDir: string | null, rel: string, content: string): Promise<void> {
  if (!repoDir) throw new Error("project tidak punya repoDir");
  const abs = repoAbsPath(repoDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

export type GitOp =
  | { op: "checkout"; ref: string; force?: boolean }
  | { op: "branch"; name: string; at?: string; checkout?: boolean }
  | { op: "merge"; ref: string; ff?: "no-ff" | "ff-only"; deleteBranch?: string }
  | { op: "cherry-pick"; sha: string }
  | { op: "revert"; sha: string }
  | { op: "delete-branch"; name: string; force?: boolean };

export type GitOpResult = { ok: boolean; stdout: string; stderr: string; current: string };

// Field wajib per-op. force di-cek terpisah di route (gerbang sesi). null = valid.
export function validateGitOp(op: unknown): string | null {
  const o = op as Record<string, unknown>;
  if (!o || typeof o !== "object") return "body wajib";
  const need = (k: string) => (typeof o[k] === "string" && o[k] ? null : `${k} wajib`);
  switch (o.op) {
    case "checkout": return need("ref");
    case "branch": return need("name");
    case "merge": {
      const e = need("ref"); if (e) return e;
      if (o.ff !== undefined && o.ff !== "no-ff" && o.ff !== "ff-only") return "ff harus no-ff atau ff-only";
      if (o.deleteBranch !== undefined && !(typeof o.deleteBranch === "string" && o.deleteBranch)) return "deleteBranch harus string tak kosong";
      return null;
    }
    case "cherry-pick": return need("sha");
    case "revert": return need("sha");
    case "delete-branch": return need("name");
    default: return `op tak dikenal: ${String(o.op)}`;
  }
}

function gitArgs(op: GitOp): string[] {
  switch (op.op) {
    case "checkout": return ["checkout", ...(op.force ? ["-f"] : []), op.ref];
    case "branch": return ["branch", op.name, ...(op.at ? [op.at] : [])];
    case "merge": return ["merge", "--no-edit", ...(op.ff ? [`--${op.ff}`] : []), op.ref];
    case "cherry-pick": return ["cherry-pick", op.sha];
    case "revert": return ["revert", "--no-edit", op.sha];
    case "delete-branch": return ["branch", op.force ? "-D" : "-d", op.name];
  }
}

// Setelah merge sukses: hapus branch yang baru di-merge, lokal (-D, aman karena sudah ter-merge)
// lalu origin bila remote-tracking-nya ada (`git push origin --delete`). Gagal di salah satu langkah
// → ok:false + stderr; merge-nya sendiri tetap terjadi (graph reload menunjukkan keadaan sebenarnya).
async function afterMergeDelete(repoDir: string, branch: string, mergeOut: string, mergeErr: string): Promise<GitOpResult> {
  const out = [mergeOut], err = [mergeErr];
  const step = async (args: string[]) => { const r = await exec("git", args, { cwd: repoDir, ...GIT }); out.push(r.stdout); err.push(r.stderr); };
  try {
    await step(["branch", "-D", branch]);
    const hasOrigin = await exec("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], { cwd: repoDir, ...GIT }).then(() => true).catch(() => false);
    if (hasOrigin) await step(["push", "origin", "--delete", branch]);
    return { ok: true, stdout: out.join("\n").trim(), stderr: err.join("\n").trim(), current: await currentBranch(repoDir) };
  } catch (e) {
    const ee = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: [...out, ee.stdout ?? ""].join("\n").trim(), stderr: [...err, ee.stderr ?? String(e)].join("\n").trim(), current: await currentBranch(repoDir) };
  }
}

// Jalankan satu op git. Exit ≠ 0 → { ok:false, stderr } (route ubah jadi 409), tak throw.
// `branch` dengan checkout:true → buat lalu checkout (dua exec). `merge` dengan deleteBranch →
// merge lalu bersihkan branch lokal+origin (SPEC-193).
export async function runGitOp(repoDir: string, op: GitOp): Promise<GitOpResult> {
  try {
    const { stdout, stderr } = await exec("git", gitArgs(op), { cwd: repoDir, ...GIT });
    if (op.op === "branch" && op.checkout) return runGitOp(repoDir, { op: "checkout", ref: op.name });
    if (op.op === "merge" && op.deleteBranch) return afterMergeDelete(repoDir, op.deleteBranch, stdout, stderr);
    return { ok: true, stdout, stderr, current: await currentBranch(repoDir) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? String(e), current: await currentBranch(repoDir) };
  }
}
