import { spawnSync } from "node:child_process";

// Cermin listRepoDocs di services/scan.ts: spawn git, [] saat gagal, tidak pernah melempar.
// Hanya refs/heads — branch remote sengaja di luar scope (SPEC-143). Daftar ini memasok
// dropdown DAN menjaga gerbang validasi, jadi tak ada validator terpisah yang bisa ikut basi.
export function listRepoBranches(repoDir: string | null): string[] {
  if (!repoDir) return [];
  const r = spawnSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd: repoDir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
}
