import { resolve, sep } from "node:path";

// SPEC-362 · predikat yang menggerbangi satu-satunya operasi destruktif saat sesi ditutup
// (`realGit.removeWorktree`): apakah sesi ini benar-benar hidup di worktree yang DIBUAT hanoman
// di bawah repoDir-nya?
//
// Sebelumnya penutupan sesi memutuskannya dari substring `"/.worktrees/"` pada cwd saja. Itu
// menguji BENTUK PATH, bukan HUBUNGAN cwd↔repoDir — dan kedua hal itu berbeda begitu sebuah
// project di-bind ke checkout yang kebetulan berada di bawah `.worktrees/` (persis keadaan saat
// hanoman didogfood di worktree-nya sendiri). Terminal biasa punya `cwd === repoDir`, sehingga ia
// ikut lolos dan `removeWorktree(repoDir, repoDir)` menghapus checkout project itu sendiri.
//
// Perbandingan dilakukan atas path yang sudah dinormalkan (trailing slash & segmen `..`), dan
// direktori `.worktrees` sendiri sengaja dikecualikan — wadahnya menampung worktree sesi LAIN
// plus berkas fase/marker keputusan, jadi ia tak pernah boleh ikut terhapus.
export function ownsWorktree(repoDir: string, cwd: string): boolean {
  const base = resolve(repoDir);
  const dir = resolve(cwd);
  const container = resolve(base, ".worktrees");
  return dir !== base && dir !== container && dir.startsWith(container + sep);
}
