import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

// SPEC-197 · async + timeout: `integrate` dipanggil di request path (POST /specs/:id/integrate).
// spawnSync memblok seluruh event loop, dan fetch/push tanpa timeout menggantung tak terbatas bila
// origin lambat / minta auth. 60s cukup untuk fetch+merge+push repo normal; melewati itu = gagalkan.
const exec = promisify(execFile);
const GIT = { timeout: 60_000, maxBuffer: 1 << 24, encoding: "utf8" as const };
const sh = (cwd: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> =>
  exec("git", args, { cwd, ...GIT }).then(
    (r) => ({ status: 0, stdout: r.stdout, stderr: r.stderr }),
    (e: { code?: number; stdout?: string; stderr?: string }) =>
      ({ status: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }));
const ok = async (cwd: string, args: string[]) => (await sh(cwd, args)).status === 0;
const out = async (cwd: string, args: string[]) => (await sh(cwd, args)).stdout.trim();
const refExists = (repoDir: string, ref: string) => ok(repoDir, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);

// Path worktree yang meng-checkout refs/heads/<branch>, atau null bila tak ter-checkout di mana pun.
// Parsing `git worktree list --porcelain`: blok "worktree <path>" ... "branch refs/heads/<name>".
async function worktreeForBranch(repoDir: string, branch: string): Promise<string | null> {
  let path: string | null = null;
  for (const line of (await out(repoDir, ["worktree", "list", "--porcelain"])).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

// origin/hanoman/<id> lebih dulu (hasil push run), fallback branch lokal. Null = belum ada.
async function resolveSource(repoDir: string, specId: string): Promise<string | null> {
  const b = sourceBranch(specId);
  if (await refExists(repoDir, `refs/remotes/origin/${b}`)) return `refs/remotes/origin/${b}`;
  if (await refExists(repoDir, `refs/heads/${b}`)) return `refs/heads/${b}`;
  return null;
}

// "local:<b>" → refs/heads/<b> (finalisasi branch -f) · "origin:<b>" → refs/remotes/origin/<b> (push).
async function resolveTarget(repoDir: string, target: string):
  Promise<{ ref: string; dest: "local" | "origin"; name: string } | null> {
  const m = /^(local|origin):(.+)$/.exec(target);
  if (!m) return null;
  const dest = m[1] as "local" | "origin";
  const name = m[2]!;
  const ref = dest === "local" ? `refs/heads/${name}` : `refs/remotes/origin/${name}`;
  return (await refExists(repoDir, ref)) ? { ref, dest, name } : null;
}

// Rebut kembali .worktrees/merge-<id> yang tertinggal (pola realGit.addWorktree).
async function reclaim(repoDir: string, wt: string) {
  await sh(repoDir, ["worktree", "remove", "--force", wt]);
  await sh(repoDir, ["worktree", "prune"]);
  rmSync(wt, { recursive: true, force: true });
}

type Finalize =
  | { kind: "branch-f"; branch: string; checkout: string | null }
  | { kind: "push"; branch: string }
  | { kind: "force-push"; branch: string };

export async function integrate(repoDir: string, specId: string, op: IntegrateOp, target: string): Promise<IntegrateResult> {
  const source = await resolveSource(repoDir, specId);
  if (!source) return { status: "error", code: 409, error: "branch spec belum ada — jalankan/selesaikan sesi backlog dulu" };
  const tgt = await resolveTarget(repoDir, target);
  if (!tgt) return { status: "error", code: 400, error: `target "${target}" tidak dikenal` };

  await sh(repoDir, ["fetch", "origin"]); // best-effort; abaikan gagal/offline (timeout 60s)

  const wt = join(repoDir, ".worktrees", `merge-${sanitize(specId)}`);
  await reclaim(repoDir, wt);

  // base worktree: merge → tip target; rebase → tip source. Resolve ke SHA (hindari flag-injection).
  const baseRef = op === "merge" ? tgt.ref : source;
  const baseSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  if (!(await ok(repoDir, ["worktree", "add", "--detach", "-q", wt, baseSha])))
    return { status: "error", code: 500, error: "gagal membuat worktree integrasi" };

  // merge: mainkan source ke atas target. rebase: mainkan source ke atas target-tip.
  const applyRef = op === "merge" ? source : tgt.ref;
  const cmd = op === "merge" ? ["merge", "--no-edit", applyRef] : ["rebase", applyRef];
  const run = await sh(wt, cmd);

  // Rencana finalisasi: merge→lokal branch -f; merge→origin push; rebase selalu force-push branch spec.
  const finalize: Finalize = op === "rebase"
    ? { kind: "force-push", branch: sourceBranch(specId) }
    : tgt.dest === "local"
      ? { kind: "branch-f", branch: tgt.name, checkout: await worktreeForBranch(repoDir, tgt.name) }
      : { kind: "push", branch: tgt.name };

  if (run.status === 0) {
    const fin = await runFinalize(wt, repoDir, finalize);
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return fin.ok ? { status: "clean", detail: fin.detail } : { status: "error", code: 409, error: fin.error };
  }
  // conflict → tinggalkan worktree; route spawn sesi claude
  return {
    status: "conflict", worktree: wt, op, source,
    target: `${tgt.dest}:${tgt.name}`, finalize: finalizeInstruction(op, finalize),
  };
}

async function runFinalize(wt: string, repoDir: string, f: Finalize):
  Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  if (f.kind === "branch-f") {
    const head = await out(wt, ["rev-parse", "HEAD"]);
    // Tak di-checkout: git izinkan branch -f langsung update refs/heads/<b>.
    if (f.checkout === null)
      return (await ok(repoDir, ["branch", "-f", f.branch, head]))
        ? { ok: true, detail: `lokal ${f.branch} → ${head.slice(0, 7)}` }
        : { ok: false, error: `gagal memperbarui branch "${f.branch}"` };
    // Di-checkout: fast-forward DI worktree pemiliknya → ref+index+working tree konsisten. Edit
    // uncommitted yang tak bertabrakan tetap aman (git membatalkan ff bila akan menimpanya).
    return (await ok(f.checkout, ["merge", "--ff-only", head]))
      ? { ok: true, detail: `lokal ${f.branch} (ff) → ${head.slice(0, 7)}` }
      : { ok: false, error: `working tree "${f.branch}" ada perubahan belum tersimpan atau bukan fast-forward — commit/stash lalu ulangi, atau pilih target origin` };
  }
  const args = f.kind === "force-push"
    ? ["push", "--force-with-lease", "origin", `HEAD:refs/heads/${f.branch}`]
    : ["push", "origin", `HEAD:refs/heads/${f.branch}`];
  return (await ok(wt, args))
    ? { ok: true, detail: `push origin ${f.branch}` }
    : { ok: false, error: `push origin ${f.branch} ditolak — target maju di origin, fetch dulu` };
}

// Perintah persis untuk sesi claude jalankan SESUDAH resolve konflik.
function finalizeInstruction(op: IntegrateOp, f: Finalize): string {
  const push = f.kind === "force-push"
    ? `git push --force-with-lease origin HEAD:refs/heads/${f.branch}`
    : f.kind === "push"
      ? `git push origin HEAD:refs/heads/${f.branch}`
      // branch lokal di-checkout: mendarat lewat fast-forward di worktree pemiliknya.
      // `$(git rev-parse HEAD)` dievaluasi di worktree merge (commit resolusi), `-C` menuju checkout.
      : f.checkout !== null
        ? `git -C ${f.checkout} merge --ff-only $(git rev-parse HEAD)`
        : `git branch -f ${f.branch} HEAD`;
  return op === "merge"
    ? `Sesudah resolve konflik: \`git add -A && git commit --no-edit\`, lalu \`${push}\`.`
    : `Sesudah resolve tiap konflik: \`git add -A && git rebase --continue\` (ulangi sampai selesai), lalu \`${push}\`.`;
}
