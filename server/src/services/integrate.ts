import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

// SPEC-175 · rebase/merge branch hasil sebuah done spec. Semua git jalan di worktree isolasi
// `.worktrees/merge-<id>`; working tree utama tak pernah disentuh. Bersih → finalisasi + hapus
// worktree; conflict → tinggalkan worktree untuk diselesaikan sesi claude (route yang spawn).
export type IntegrateOp = "merge" | "rebase";
export type IntegrateResult =
  | { status: "clean"; detail: string }
  | { status: "conflict"; worktree: string; op: IntegrateOp; source: string; target: string; finalize: string }
  | { status: "error"; code: number; error: string };

const sanitize = (id: string) => id.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
export const sourceBranch = (specId: string) => `hanoman/${sanitize(specId)}`;

const sh = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
const ok = (cwd: string, args: string[]) => sh(cwd, args).status === 0;
const out = (cwd: string, args: string[]) => sh(cwd, args).stdout.trim();
const refExists = (repoDir: string, ref: string) => ok(repoDir, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);

// origin/hanoman/<id> lebih dulu (hasil push run), fallback branch lokal. Null = belum ada.
function resolveSource(repoDir: string, specId: string): string | null {
  const b = sourceBranch(specId);
  if (refExists(repoDir, `refs/remotes/origin/${b}`)) return `refs/remotes/origin/${b}`;
  if (refExists(repoDir, `refs/heads/${b}`)) return `refs/heads/${b}`;
  return null;
}

// "local:<b>" → refs/heads/<b> (finalisasi branch -f) · "origin:<b>" → refs/remotes/origin/<b> (push).
function resolveTarget(repoDir: string, target: string):
  { ref: string; dest: "local" | "origin"; name: string } | null {
  const m = /^(local|origin):(.+)$/.exec(target);
  if (!m) return null;
  const dest = m[1] as "local" | "origin";
  const name = m[2]!;
  const ref = dest === "local" ? `refs/heads/${name}` : `refs/remotes/origin/${name}`;
  return refExists(repoDir, ref) ? { ref, dest, name } : null;
}

// Rebut kembali .worktrees/merge-<id> yang tertinggal (pola realGit.addWorktree).
function reclaim(repoDir: string, wt: string) {
  sh(repoDir, ["worktree", "remove", "--force", wt]);
  sh(repoDir, ["worktree", "prune"]);
  rmSync(wt, { recursive: true, force: true });
}

type Finalize =
  | { kind: "branch-f"; branch: string }
  | { kind: "push"; branch: string }
  | { kind: "force-push"; branch: string };

export function integrate(repoDir: string, specId: string, op: IntegrateOp, target: string): IntegrateResult {
  const source = resolveSource(repoDir, specId);
  if (!source) return { status: "error", code: 409, error: "branch spec belum ada — jalankan/selesaikan sesi backlog dulu" };
  const tgt = resolveTarget(repoDir, target);
  if (!tgt) return { status: "error", code: 400, error: `target "${target}" tidak dikenal` };

  sh(repoDir, ["fetch", "origin"]); // best-effort; abaikan gagal/offline

  const wt = join(repoDir, ".worktrees", `merge-${sanitize(specId)}`);
  reclaim(repoDir, wt);

  // base worktree: merge → tip target; rebase → tip source. Resolve ke SHA (hindari flag-injection).
  const baseRef = op === "merge" ? tgt.ref : source;
  const baseSha = out(repoDir, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  if (!ok(repoDir, ["worktree", "add", "--detach", "-q", wt, baseSha]))
    return { status: "error", code: 500, error: "gagal membuat worktree integrasi" };

  // merge: mainkan source ke atas target. rebase: mainkan source ke atas target-tip.
  const applyRef = op === "merge" ? source : tgt.ref;
  const cmd = op === "merge" ? ["merge", "--no-edit", applyRef] : ["rebase", applyRef];
  const run = sh(wt, cmd);

  // Rencana finalisasi: merge→lokal branch -f; merge→origin push; rebase selalu force-push branch spec.
  const finalize: Finalize = op === "rebase"
    ? { kind: "force-push", branch: sourceBranch(specId) }
    : tgt.dest === "local"
      ? { kind: "branch-f", branch: tgt.name }
      : { kind: "push", branch: tgt.name };

  if (run.status === 0) {
    const fin = runFinalize(wt, repoDir, finalize);
    sh(repoDir, ["worktree", "remove", "--force", wt]);
    return fin.ok ? { status: "clean", detail: fin.detail } : { status: "error", code: 409, error: fin.error };
  }
  // conflict → tinggalkan worktree; route spawn sesi claude
  return {
    status: "conflict", worktree: wt, op, source,
    target: `${tgt.dest}:${tgt.name}`, finalize: finalizeInstruction(op, finalize),
  };
}

function runFinalize(wt: string, repoDir: string, f: Finalize):
  { ok: true; detail: string } | { ok: false; error: string } {
  if (f.kind === "branch-f") {
    // Update refs/heads/<b> ke HEAD worktree. git menolak bila branch sedang di-checkout → gagal aman.
    const head = out(wt, ["rev-parse", "HEAD"]);
    return ok(repoDir, ["branch", "-f", f.branch, head])
      ? { ok: true, detail: `lokal ${f.branch} → ${head.slice(0, 7)}` }
      : { ok: false, error: `branch "${f.branch}" sedang di-checkout — pilih target origin` };
  }
  const args = f.kind === "force-push"
    ? ["push", "--force-with-lease", "origin", `HEAD:refs/heads/${f.branch}`]
    : ["push", "origin", `HEAD:refs/heads/${f.branch}`];
  return ok(wt, args)
    ? { ok: true, detail: `push origin ${f.branch}` }
    : { ok: false, error: `push origin ${f.branch} ditolak — target maju di origin, fetch dulu` };
}

// Perintah persis untuk sesi claude jalankan SESUDAH resolve konflik.
function finalizeInstruction(op: IntegrateOp, f: Finalize): string {
  const push = f.kind === "force-push"
    ? `git push --force-with-lease origin HEAD:refs/heads/${f.branch}`
    : f.kind === "push"
      ? `git push origin HEAD:refs/heads/${f.branch}`
      : `git branch -f ${f.branch} HEAD`;
  return op === "merge"
    ? `Sesudah resolve konflik: \`git add -A && git commit --no-edit\`, lalu \`${push}\`.`
    : `Sesudah resolve tiap konflik: \`git add -A && git rebase --continue\` (ulangi sampai selesai), lalu \`${push}\`.`;
}
