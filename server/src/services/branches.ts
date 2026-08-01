import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24, encoding: "utf8" as const };

// SPEC-197 · execFile async (bukan spawnSync): dipanggil di jalur tulis spec (POST/PATCH /specs)
// dan GET /projects/:id/branches; spawnSync memblok event loop tiap request. Cermin listRepoDocs
// di services/scan.ts: [] saat gagal, tidak pernah melempar.
async function refs(repoDir: string | null, glob: string): Promise<string[]> {
  if (!repoDir) return [];
  try {
    const { stdout } = await exec("git", ["for-each-ref", "--format=%(refname:short)", glob], { cwd: repoDir, ...GIT });
    return [...new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean))];
  } catch { return []; }
}

// Hanya refs/heads — branch remote sengaja di luar scope (SPEC-143). Daftar ini memasok
// dropdown DAN menjaga gerbang validasi, jadi tak ada validator terpisah yang bisa ikut basi.
export async function listRepoBranches(repoDir: string | null): Promise<string[]> {
  return (await refs(repoDir, "refs/heads")).sort();
}

// SPEC-175 · target merge/rebase boleh branch origin. refname:short `refs/remotes/origin/main` =
// `origin/main`; buang symbolic `origin/HEAD`, lucuti prefix `origin/`.
export async function listRepoRemoteBranches(repoDir: string | null): Promise<string[]> {
  return (await refs(repoDir, "refs/remotes/origin"))
    .filter((b) => b !== "origin/HEAD" && b !== "origin")
    .map((b) => b.replace(/^origin\//, ""))
    .sort();
}

// SPEC-244 · ADR-0059 — kandidat branchFrom = lokal ∪ origin (dedup). Branch PRD (`prd/<slug>`) dan
// audit (`hanoman/<id>`) di-push dari worktree detached → hanya ada di refs/remotes/origin/*. Satu
// daftar memasok dropdown DAN gerbang validasi branchFrom (prinsip ADR-0032), kini melebar ke remote.
export async function branchFromCandidates(repoDir: string | null): Promise<string[]> {
  const [local, remote] = await Promise.all([listRepoBranches(repoDir), listRepoRemoteBranches(repoDir)]);
  return [...new Set([...local, ...remote])].sort();
}

// SPEC-486 · ADR-0103 · "default branch repo" untuk mode auto-merge `default-branch`. Diresolve
// SAAT EKSEKUSI, bukan dibekukan ke dalam setting: repo yang mengganti default branch-nya tak
// boleh diam-diam terus di-merge ke branch lama.
//
// Urutan: `origin/HEAD` (jawaban otoritatif remote) → main → master → null. SPEC-227/ADR-0077 —
// JANGAN hardcode "main"; dan `null` (bukan tebakan) adalah jawaban yang benar saat repo tak
// punya keduanya, karena merge ke branch yang salah tak bisa dibatalkan dari dashboard.
export async function defaultBranch(repoDir: string | null): Promise<string | null> {
  if (!repoDir) return null;
  try {
    const { stdout } = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { cwd: repoDir, ...GIT });
    // `--short` memberi "origin/main"; git memendekkan ref itu sendiri jadi bare "origin" di
    // tempat lain (services/branch-cleanup.ts) — di sini bentuknya selalu berprefix.
    const name = stdout.trim().replace(/^origin\//, "");
    if (name && name !== "HEAD") return name;
  } catch { /* origin/HEAD tak ada: repo tanpa remote, atau `remote set-head` belum pernah jalan */ }
  const all = new Set([...(await listRepoBranches(repoDir)), ...(await listRepoRemoteBranches(repoDir))]);
  for (const c of ["main", "master"]) if (all.has(c)) return c;
  return null;
}
