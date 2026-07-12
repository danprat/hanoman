import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { GitOps } from "./types";
function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}
const tryGit = (cwd: string, args: string[]) => { spawnSync("git", args, { cwd, encoding: "utf8" }); };
// Nama branch boleh berbentuk flag — `refs/heads/--force` adalah refname yang sah — dan git membaca
// opsi di posisi mana pun. `git worktree add --detach <path> --force` tidak menolaknya: ia menelan
// `--force` sebagai opsi dan diam-diam memakai HEAD, membangun worktree di pohon yang salah tanpa
// satu pun error. Resolusikan ke commit SHA dulu; heksadesimal tak pernah jadi opsi. Urutan mengikat:
// `--verify` harus mendahului `--end-of-options` (diverifikasi terhadap git 2.50.1). Melempar dengan
// stderr git yang menyebut revisinya bila tidak resolve (ADR-0009), dan tetap menjaga DWIM sehingga
// branch remote-tracking masih resolve.
const resolveCommit = (repo: string, rev: string) =>
  git(repo, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).trim();

export const realGit: GitOps = {
  // --detach: checkout commit milik branchFrom dalam detached HEAD, sehingga sebuah sesi bisa
  // bercabang dari `main` bahkan saat `main` sedang ter-checkout di working tree utama (git
  // menolak meng-checkout branch yang sudah dipakai). Agen sendiri yang mem-push HEAD ke
  // branchTo saat pekerjaannya selesai (SPEC-162).
  addWorktree: (repo, path, branchFrom) => {
    // Rebut kembali .worktrees/<id> yang tertinggal dari sesi yang mati atau dibunuh: id sebuah
    // backlog item bisa dipakai ulang, dan "already exists" tak boleh memblokirnya. Worktree yang
    // masih terdaftar → remove+prune; direktori telanjang → rm -rf.
    tryGit(repo, ["worktree", "remove", "--force", path]);
    tryGit(repo, ["worktree", "prune"]);
    rmSync(isAbsolute(path) ? path : resolve(repo, path), { recursive: true, force: true });
    const base = resolveCommit(repo, branchFrom);
    git(repo, ["worktree", "add", "--detach", path, base]);
    return base;
  },
  // Best-effort (cermin addWorktree reclaim): worktree bisa sudah dipangkas/dihapus di tengah run
  // (mis. sesi sibling menyelesaikan kerja yang sama). `git worktree remove` telanjang akan throw
  // `fatal: not a working tree` → membuat DELETE /terminal/sessions balas 500. remove+prune+rm
  // semuanya toleran, jadi penutupan sesi selalu 204 dan registrasi worktree tak stale (SPEC-197).
  removeWorktree: (repo, path) => {
    tryGit(repo, ["worktree", "remove", "--force", path]);
    tryGit(repo, ["worktree", "prune"]);
    rmSync(isAbsolute(path) ? path : resolve(repo, path), { recursive: true, force: true });
  },
  // Dibaca di worktree sesi (bukan repo utama) tepat sebelum removeWorktree: HEAD-nya =
  // ujung range diff review sesudah item selesai (SPEC-176, ADR-0030).
  headSha: (worktree) => git(worktree, ["rev-parse", "HEAD"]).trim(),
};
