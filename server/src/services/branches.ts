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
