import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { GitOps } from "./types";
function git(cwd: string, args: string[], redact?: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    const safe = (s: string) => (redact ? (s || "").split(redact).join("***") : s);
    throw new Error(`git ${safe(args.join(" "))} failed: ${safe(r.stderr || r.stdout)}`);
  }
  return r.stdout;
}
const tryGit = (cwd: string, args: string[]) => { spawnSync("git", args, { cwd, encoding: "utf8" }); };
const hasRemote = (cwd: string, name: string) =>
  spawnSync("git", ["remote", "get-url", name], { cwd, encoding: "utf8" }).status === 0;
// Nama branch boleh berbentuk flag — `refs/heads/--force` adalah refname yang sah — dan git membaca
// opsi di posisi mana pun. `git worktree add --detach <path> --force` tidak menolaknya: ia menelan
// `--force` sebagai opsi dan diam-diam memakai HEAD, membangun worktree di pohon yang salah tanpa
// satu pun error. Resolusikan ke commit SHA dulu; heksadesimal tak pernah jadi opsi. Urutan mengikat:
// `--verify` harus mendahului `--end-of-options` (diverifikasi terhadap git 2.50.1). Melempar dengan
// stderr git yang menyebut revisinya bila tidak resolve (ADR-0009), dan tetap menjaga DWIM sehingga
// branch remote-tracking milik run github-backed masih resolve.
const resolveCommit = (repo: string, rev: string) =>
  git(repo, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).trim();
export const realGit: GitOps = {
  // --detach: check out branchFrom's commit in a detached HEAD so a run can
  // branch from `main` even while `main` is checked out in the primary tree
  // (git refuses to check out an already-in-use branch). commitAndPush then
  // pushes HEAD:branchTo, creating the target branch from the run's commits.
  addWorktree: (repo, path, branchFrom, reuse) => {
    // Melanjutkan run: worktree-nya justru yang dicari — di dalamnya ada spec dan plan
    // yang ditulis fase-fase sebelumnya. Menghapusnya membuat Execute kehilangan plan-nya.
    // branchFrom mungkin sudah bergerak sejak run pertama lahir — basis yang benar adalah
    // basis semula, yang sudah tersimpan di baris Run (SPEC-144). undefined = "tak berubah".
    if (reuse && existsSync(isAbsolute(path) ? path : resolve(repo, path))) return undefined;
    // Reclaim a leftover .worktrees/<id> from a prior failed/killed run so a
    // re-run (ids can be reused — nextRunId is max-based) isn't blocked by
    // "already exists". Registered worktree → remove+prune; bare dir → rm -rf.
    tryGit(repo, ["worktree", "remove", "--force", path]);
    tryGit(repo, ["worktree", "prune"]);
    rmSync(isAbsolute(path) ? path : resolve(repo, path), { recursive: true, force: true });
    const base = resolveCommit(repo, branchFrom);
    git(repo, ["worktree", "add", "--detach", path, base]);
    return base;
  },
  removeWorktree: (repo, path) => { git(repo, ["worktree", "remove", "--force", path]); },
  // remoteUrl (with an installation token) authenticates a push to a private
  // github remote; absent, push to `origin` (local runs, behaviour unchanged).
  commitAndPush: (path, message, branchTo, remoteUrl) => {
    git(path, ["add", "-A"]);
    // Agen yang sudah commit sendiri meninggalkan pohon bersih, dan `git commit` di atasnya keluar
    // dengan status 1. Dulu itu melempar *setelah* fase terakhir ditandai done, jadi run yang
    // sebenarnya mati karena error API dilaporkan sebagai "nothing to commit" — error aslinya hilang.
    if (git(path, ["status", "--porcelain"]).trim()) git(path, ["commit", "-m", message]);
    // Dibaca sesudah commit bersyarat: kalau agen yang commit, HEAD-nya commit dia (SPEC-144).
    const head = git(path, ["rev-parse", "HEAD"]).trim();
    // Project lokal boleh tak punya `origin`. Push-nya dulu selalu melempar — dan melempar
    // *setelah* fase terakhir sudah ditandai done, jadi run yang pekerjaannya beres tak
    // pernah sampai `status: done`. Yang opsional di sini remote-nya, bukan branch-nya:
    // tanpa remote, kerjanya tetap didaratkan ke branchTo secara lokal.
    if (!remoteUrl && !hasRemote(path, "origin")) { git(path, ["branch", "-f", branchTo, "HEAD"]); return head; }
    // full refname: from a detached HEAD git can't infer refs/heads/ for a short dest
    git(path, ["push", remoteUrl ?? "origin", `HEAD:refs/heads/${branchTo}`], remoteUrl);
    return head;
  },
  switchBase: (path, branchFrom) => { git(path, ["checkout", "--end-of-options", branchFrom]); },
};
