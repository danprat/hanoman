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

// origin/<branch> lebih dulu (hasil push), fallback branch lokal. Null = belum ada.
async function resolveSource(repoDir: string, branch: string): Promise<string | null> {
  if (await refExists(repoDir, `refs/remotes/origin/${branch}`)) return `refs/remotes/origin/${branch}`;
  if (await refExists(repoDir, `refs/heads/${branch}`)) return `refs/heads/${branch}`;
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

// SPEC-230 · sumber integrasi generik: nama branch + id untuk penamaan worktree merge. Spec
// memakai wrapper `integrate` di bawah; sesi project-level (PRD) memanggil ini langsung dengan
// branch `prd/<slug>` + mergeId = id sesi.
export type IntegrateSource = { branch: string; mergeId: string };

export async function integrateBranch(
  repoDir: string, src: IntegrateSource, op: IntegrateOp, target: string,
): Promise<IntegrateResult> {
  const source = await resolveSource(repoDir, src.branch);
  if (!source) return { status: "error", code: 409, error: "branch belum ada — jalankan/selesaikan sesi dulu" };
  const tgt = await resolveTarget(repoDir, target);
  if (!tgt) return { status: "error", code: 400, error: `target "${target}" tidak dikenal` };

  await sh(repoDir, ["fetch", "origin"]); // best-effort; abaikan gagal/offline (timeout 60s)

  const wt = join(repoDir, ".worktrees", `merge-${sanitize(src.mergeId)}`);
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

  // Rencana finalisasi: merge→lokal branch -f; merge→origin push; rebase selalu force-push branch source.
  const finalize: Finalize = op === "rebase"
    ? { kind: "force-push", branch: src.branch }
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

// SPEC-175 · wrapper Spec: branch = hanoman/<specid>, mergeId = specid (worktree merge-<specid>).
export async function integrate(repoDir: string, specId: string, op: IntegrateOp, target: string): Promise<IntegrateResult> {
  return integrateBranch(repoDir, { branch: sourceBranch(specId), mergeId: specId }, op, target);
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

// SPEC-229 · merge via git graph (ADR-0053). Source arbitrer (branch, origin/<b>, atau sha) → branch
// CURRENT working tree utama, dijalankan di worktree isolasi (pola integrate). Bersih → ff branch
// current di owner tree; konflik → tinggalkan worktree untuk sesi claude. Working tree utama tak
// pernah dirusak. Reuse helper integrate; tak menyentuh `integrate()` yang sudah teruji.
export type GraphMergeResult =
  | { status: "clean"; detail: string }
  | { status: "conflict"; worktree: string; source: string; target: string; finalize: string }
  | { status: "error"; code: number; error: string };

// Coba source apa adanya (sha/ref penuh), lalu refs/heads/<s>, lalu refs/remotes/origin/<s>.
async function resolveGraphSource(repoDir: string, source: string): Promise<string | null> {
  for (const cand of [source, `refs/heads/${source}`, `refs/remotes/origin/${source}`])
    if (await refExists(repoDir, cand)) return cand;
  return null;
}

// Hapus branch yang baru di-merge (best-effort): local -D lalu origin --delete bila ada. Merge sudah
// landed; kegagalan hapus TIDAK me-rollback (beda dari afterMergeDelete git-ide yang gagal-keras).
async function deleteMergedBranch(repoDir: string, branch: string): Promise<void> {
  await sh(repoDir, ["branch", "-D", "--end-of-options", branch]);
  if (await refExists(repoDir, `refs/remotes/origin/${branch}`))
    await sh(repoDir, ["push", "origin", "--delete", "--end-of-options", branch]);
}

export async function mergeIntoCurrent(
  repoDir: string, source: string, opts: { ff?: "no-ff" | "ff-only"; deleteBranch?: string } = {},
): Promise<GraphMergeResult> {
  const current = await out(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!current || current === "HEAD")
    return { status: "error", code: 409, error: "HEAD detached — checkout sebuah branch dulu sebelum merge" };
  const src = await resolveGraphSource(repoDir, source);
  if (!src) return { status: "error", code: 400, error: `source "${source}" tak dikenal` };

  await sh(repoDir, ["fetch", "origin"]); // best-effort; abaikan gagal/offline (timeout 60s)

  const wt = join(repoDir, ".worktrees", `merge-${sanitize(current)}`);
  await reclaim(repoDir, wt);

  // base worktree = tip branch current; source → sha (cegah flag-injection, SPEC-197).
  const baseSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `refs/heads/${current}^{commit}`]);
  if (!(await ok(repoDir, ["worktree", "add", "--detach", "-q", wt, baseSha])))
    return { status: "error", code: 500, error: "gagal membuat worktree merge" };
  const srcSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `${src}^{commit}`]);

  const cmd = ["merge", "--no-edit", ...(opts.ff ? [`--${opts.ff}`] : []), "--end-of-options", srcSha];
  const run = await sh(wt, cmd);

  // Finalisasi = ff branch current di owner (working tree utama). worktreeForBranch(current) = repoDir.
  const finalize: Finalize = { kind: "branch-f", branch: current, checkout: await worktreeForBranch(repoDir, current) };

  if (run.status === 0) {
    const fin = await runFinalize(wt, repoDir, finalize);
    if (fin.ok && opts.deleteBranch) await deleteMergedBranch(repoDir, opts.deleteBranch);
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return fin.ok ? { status: "clean", detail: fin.detail } : { status: "error", code: 409, error: fin.error };
  }

  // non-zero: konflik NYATA (ada file unmerged) vs penolakan bersih (mis. --ff-only divergen).
  const conflicted = (await out(wt, ["ls-files", "--unmerged"])).length > 0;
  if (!conflicted) {
    await sh(wt, ["merge", "--abort"]);                       // no-op bila tak ada state merge
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return { status: "error", code: 409, error: run.stderr.trim() || "merge gagal — tak bisa fast-forward?" };
  }
  // konflik → tinggalkan worktree; route spawn sesi claude
  return { status: "conflict", worktree: wt, source: src, target: `local:${current}`, finalize: finalizeInstruction("merge", finalize) };
}

// SPEC-233 · tak ada perubahan file TERLACAK (staged/unstaged). Rebase/drop mendarat lewat
// `reset --hard` yang menjaga file untracked — jadi untracked (mis. `.worktrees/` isolasi) diabaikan.
async function isCleanTree(dir: string): Promise<boolean> {
  return (await out(dir, ["status", "--porcelain", "--untracked-files=no"])).length === 0;
}

// Mendaratkan history yang ditulis ulang (rebase/drop) ke branch current di working tree utama:
// karena branch ter-checkout, `branch -f` ditolak git → pakai `reset --hard` (aman, tree wajib bersih).
async function landRewrite(repoDir: string, branch: string, head: string):
  Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  if (!(await isCleanTree(repoDir)))
    return { ok: false, error: `working tree "${branch}" ada perubahan belum tersimpan — commit/stash lalu ulangi` };
  return (await ok(repoDir, ["reset", "--hard", "--end-of-options", head]))
    ? { ok: true, detail: `${branch} ditulis ulang → ${head.slice(0, 7)}` }
    : { ok: false, error: `gagal memperbarui branch "${branch}"` };
}

// Instruksi untuk sesi claude sesudah resolve konflik rebase/drop: lanjutkan rebase, lalu daratkan
// hasil ke branch current di working tree utama (`git -C <repoDir> reset --hard`).
function rewriteInstruction(repoDir: string, branch: string): string {
  return `Sesudah resolve tiap konflik: \`git add -A && git rebase --continue\` (ulangi sampai selesai), ` +
    `lalu daratkan ke branch \`${branch}\` di working tree utama (pastikan bersih): ` +
    `\`git -C ${repoDir} reset --hard $(git rev-parse HEAD)\`.`;
}

// SPEC-233 · replay history branch current di worktree isolasi, lalu daratkan. `cmd` = perintah
// rebase yang dijalankan di worktree detached pada tip current. Konflik → tinggalkan worktree (sesi
// claude); bersih → landRewrite. Pola sama seperti mergeIntoCurrent, working tree utama tak dirusak.
async function replayCurrent(repoDir: string, source: string, cmd: string[]): Promise<GraphMergeResult> {
  const current = await out(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!current || current === "HEAD")
    return { status: "error", code: 409, error: "HEAD detached — checkout sebuah branch dulu" };

  const wt = join(repoDir, ".worktrees", `merge-${sanitize(current)}`);
  await reclaim(repoDir, wt);
  const baseSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `refs/heads/${current}^{commit}`]);
  if (!(await ok(repoDir, ["worktree", "add", "--detach", "-q", wt, baseSha])))
    return { status: "error", code: 500, error: "gagal membuat worktree rebase" };

  const run = await sh(wt, cmd);
  if (run.status === 0) {
    const head = await out(wt, ["rev-parse", "HEAD"]);
    const fin = await landRewrite(repoDir, current, head);
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return fin.ok ? { status: "clean", detail: fin.detail } : { status: "error", code: 409, error: fin.error };
  }
  const conflicted = (await out(wt, ["ls-files", "--unmerged"])).length > 0;
  if (!conflicted) {
    await sh(wt, ["rebase", "--abort"]);
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return { status: "error", code: 409, error: run.stderr.trim() || "operasi rebase gagal" };
  }
  return { status: "conflict", worktree: wt, source, target: `local:${current}`, finalize: rewriteInstruction(repoDir, current) };
}

// SPEC-233 · rebase branch current di atas commit/branch `onto` (isolasi + handoff sesi claude).
export async function rebaseOntoCurrent(repoDir: string, onto: string): Promise<GraphMergeResult> {
  const src = await resolveGraphSource(repoDir, onto);
  if (!src) return { status: "error", code: 400, error: `target "${onto}" tak dikenal` };
  const ontoSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `${src}^{commit}`]);
  return replayCurrent(repoDir, src, ["rebase", "--end-of-options", ontoSha]);
}

// SPEC-233 · buang satu commit dari branch current: rebase --onto <sha>^ <sha> (isolasi + handoff).
export async function dropCommit(repoDir: string, sha: string): Promise<GraphMergeResult> {
  if (!(await refExists(repoDir, sha))) return { status: "error", code: 400, error: `commit "${sha}" tak dikenal` };
  const shaSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `${sha}^{commit}`]);
  const parent = await sh(repoDir, ["rev-parse", "--verify", "--end-of-options", `${shaSha}^`]);
  if (parent.status !== 0) return { status: "error", code: 400, error: "tak bisa drop commit root (tanpa parent)" };
  return replayCurrent(repoDir, shaSha, ["rebase", "--onto", parent.stdout.trim(), shaSha]);
}

// SPEC-233 · pull remote branch ke current = fetch + merge origin/<source> (reuse mergeIntoCurrent
// yang sudah fetch di dalamnya). Isolasi + konflik → sesi claude.
export async function pullIntoCurrent(repoDir: string, source: string, opts: { ff?: "no-ff" | "ff-only" } = {}): Promise<GraphMergeResult> {
  const remote = source.startsWith("origin/") ? source : `origin/${source}`;
  return mergeIntoCurrent(repoDir, remote, { ff: opts.ff });
}
