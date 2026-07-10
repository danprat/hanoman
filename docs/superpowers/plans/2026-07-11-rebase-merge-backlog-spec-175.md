# Rebase & Merge Backlog (SPEC-175) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beri manusia tombol Rebase & Merge untuk branch hasil sebuah backlog item yang sudah `done`, dengan dialog pilih target (lokal/origin); server jalankan git-nya, dan bila conflict, sesi claude membereskannya di Terminal.

**Architecture:** Endpoint `POST /specs/:id/integrate {op,target}` memanggil service `integrate()` yang menjalankan `git merge`/`git rebase` di worktree isolasi `.worktrees/merge-<id>` (tak pernah menyentuh working tree utama). Bersih → finalisasi (`git branch -f` untuk target lokal / `git push` untuk target origin / `--force-with-lease` untuk rebase) lalu hapus worktree. Conflict → tinggalkan worktree dan spawn sesi claude di sana; UI pindah ke Terminal.

**Tech Stack:** Node+TS (Fastify), Prisma/Postgres, node-pty+tmux, React+TS (Vite), Vitest, git CLI (`spawnSync`/`execFileSync`).

## Global Constraints

- TypeScript strict; test setiap logika orchestrasi git.
- Server **tak pernah** menyentuh/menulis working tree utama (CLAUDE.md; memory "Shared main worktree"). Merge ke branch lokal yang sedang di-checkout harus **gagal aman** (git menolak `branch -f`), bukan memaksa.
- Sesi = `claude` interaktif di worktree lewat tmux (`createSession(projectId, cwd, opts)`), bukan proses langsung.
- Source branch sebuah done spec = `hanoman/<id>` (id di-sanitize `toLowerCase().replace(/[^a-z0-9_-]/g,"_")`), umumnya hadir lokal sebagai `refs/remotes/origin/hanoman/<id>`.
- Hanya spec `stage === "done"`.
- Update `internal/docs` yang tersentuh **di commit yang sama** (Task 7). Tanpa perubahan skema → tanpa migration.
- Test server dijalankan: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test` (memory "Shell menunjuk prod"). Repo test = git nyata di tmpdir; sesi tmux test butuh `killAll()` di `beforeAll`.

## File Structure

- Create `server/src/services/integrate.ts` — mekanik git: `sourceBranch`, `resolveSource`, `resolveTarget`, `integrate`.
- Modify `server/src/services/branches.ts` — tambah `listRepoRemoteBranches`.
- Modify `server/src/routes/projects.ts` — `GET /projects/:id/branches` → `{ branches, remotes }`.
- Modify `server/src/routes/specs.ts` — `POST /specs/:id/integrate`.
- Modify `server/src/routes/terminal.ts` — `DELETE` hapus worktree untuk sesi tanpa-flow yang cwd-nya di `.worktrees/*`.
- Modify `shared/src/dto.ts` — `zIntegrate`.
- Modify `shared/src/api.ts` — `paths.specIntegrate`.
- Modify `src/src/api/client.ts` — `api.integrateSpec`, `listBranches` → `{branches,remotes}`.
- Create `src/src/screens/IntegrateDialog.tsx` — dialog target + tombol Rebase/Merge (dipakai backlog & terminal).
- Modify `src/src/screens/BacklogScreen.tsx` — section Integrasi di `SpecDetail` (done only).
- Modify `src/src/screens/TerminalScreen.tsx` — ikon merge di header `Cell`.
- Modify `src/src/App.tsx` — handler `integrateSpec`, wire ke Backlog & Terminal.
- Create `server/test/integrate.test.ts`; Modify `server/test/factory.ts` (`makeRepoWithSpecBranch`), `server/test/branches.test.ts`, `server/test/projects.route.test.ts`, `server/test/specs.route.test.ts`.
- Modify `src/test/backlog-board.test.tsx`, `src/test/terminal-screen.test.tsx`; Create `src/test/integrate-dialog.test.tsx`.
- Modify `internal/docs/requirements/**`, `internal/docs/entrypoints/**`, `internal/docs/adr/**`, `internal/docs/README.md`.

---

## Task 1: Remote branches (service + route + test factory)

**Files:**
- Create/Modify: `server/test/factory.ts` (add `makeRepoWithSpecBranch`)
- Modify: `server/src/services/branches.ts`
- Modify: `server/src/routes/projects.ts:56-61`
- Test: `server/test/branches.test.ts`, `server/test/projects.route.test.ts`

**Interfaces:**
- Produces: `listRepoRemoteBranches(repoDir: string|null): string[]` (nama tanpa prefix `origin/`, tanpa `HEAD`, sorted). Branches route response `{ branches: string[]; remotes: string[] }`.
- Produces (test): `makeRepoWithSpecBranch(specId, opts): { repoDir: string; origin: string }`.

- [x] **Step 1: Add the test factory helper**

Tambah ke akhir `server/test/factory.ts`:

```ts
// Repo dengan bare origin + branch main (base) + branch hanoman/<id> berisi kerja spec, keduanya
// di-push ke origin (refs/remotes/origin/* terisi). Persis keadaan sebuah done spec: kerja ada di
// origin/hanoman/<id>. Opsi:
//   base        = file di commit base main (default { "file.txt": "base\n" })
//   work        = perubahan di branch hanoman/<id>, satu commit (default { "work.txt": "work\n" })
//   mainAdvance = commit tambahan di main SETELAH bercabang; file yang sama dgn `work` → konflik,
//                 file lain → maju bersih (default: tak ada)
//   localBranches = branch lokal tambahan dari tip main saat itu, TAK di-checkout (uji merge→lokal)
export function makeRepoWithSpecBranch(
  specId: string,
  opts: {
    base?: Record<string, string>;
    work?: Record<string, string | null>;
    mainAdvance?: Record<string, string | null>;
    localBranches?: string[];
  } = {},
): { repoDir: string; origin: string } {
  const base = opts.base ?? { "file.txt": "base\n" };
  const work = opts.work ?? { "work.txt": "work\n" };
  const origin = mkdtempSync(join(tmpdir(), "hanoman-origin-"));
  const repoDir = mkdtempSync(join(tmpdir(), "hanoman-src-"));
  const g = (cwd: string, ...a: string[]) => {
    const r = spawnSync("git", a, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const apply = (dir: string, changes: Record<string, string | null>) => {
    for (const [rel, content] of Object.entries(changes)) {
      const abs = join(dir, rel);
      if (content === null) { rmSync(abs, { force: true }); continue; }
      mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
    }
  };
  g(origin, "init", "-q", "--bare", "-b", "main");
  g(repoDir, "init", "-q", "-b", "main");
  g(repoDir, "config", "user.email", "t@t"); g(repoDir, "config", "user.name", "t");
  g(repoDir, "remote", "add", "origin", origin);
  apply(repoDir, base); g(repoDir, "add", "-A"); g(repoDir, "commit", "-qm", "base");
  const branch = `hanoman/${specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
  g(repoDir, "checkout", "-q", "-b", branch);
  apply(repoDir, work); g(repoDir, "add", "-A"); g(repoDir, "commit", "-qm", `feat(${specId}): work`);
  g(repoDir, "checkout", "-q", "main");
  if (opts.mainAdvance) { apply(repoDir, opts.mainAdvance); g(repoDir, "add", "-A"); g(repoDir, "commit", "-qm", "main advance"); }
  for (const b of opts.localBranches ?? []) g(repoDir, "branch", b);
  g(repoDir, "push", "-q", "origin", "main", branch); // memperbarui refs/remotes/origin/*
  return { repoDir, origin };
}
```

- [x] **Step 2: Write the failing test for `listRepoRemoteBranches`**

Tambah ke `server/test/branches.test.ts`:

```ts
import { listRepoRemoteBranches } from "../src/services/branches";
import { makeRepoWithSpecBranch } from "./factory";

describe("listRepoRemoteBranches", () => {
  it("lists origin branches without the origin/ prefix or HEAD, sorted", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    expect(listRepoRemoteBranches(repoDir)).toEqual(["hanoman/spec-1", "main"]);
  });
  it("repoDir null / not a repo → []", () => {
    expect(listRepoRemoteBranches(null)).toEqual([]);
  });
});
```

- [x] **Step 3: Run to verify failure**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test branches`
Expected: FAIL — `listRepoRemoteBranches is not a function`.

- [x] **Step 4: Implement `listRepoRemoteBranches`**

Tambah ke `server/src/services/branches.ts` (di bawah `listRepoBranches`):

```ts
// SPEC-175 · target merge/rebase boleh branch origin. refname:short `refs/remotes/origin/main` =
// `origin/main`; buang symbolic `origin/HEAD`, lucuti prefix `origin/`. Cermin listRepoBranches:
// spawn git, [] saat gagal, tak pernah melempar.
export function listRepoRemoteBranches(repoDir: string | null): string[] {
  if (!repoDir) return [];
  const r = spawnSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
    { cwd: repoDir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean))]
    .filter((b) => b !== "origin/HEAD" && b !== "origin")
    .map((b) => b.replace(/^origin\//, ""))
    .sort();
}
```

- [x] **Step 5: Run to verify pass**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test branches`
Expected: PASS.

- [x] **Step 6: Add `remotes` to the branches route + failing route test**

Ubah `server/src/routes/projects.ts`:

```ts
import { listRepoBranches, listRepoRemoteBranches } from "../services/branches";
// ...
    return { branches: listRepoBranches(p.repoDir), remotes: listRepoRemoteBranches(p.repoDir) };
```

Tambah test ke `server/test/projects.route.test.ts` (di `describe` branches yang ada, atau baru):

```ts
it("GET /projects/:id/branches returns local branches and origin remotes", async () => {
  const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
  await makeProject({ id: "pbr", repoDir });
  const res = await app.inject({ method: "GET", url: "/api/projects/pbr/branches" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ branches: ["hanoman/spec-1", "main"], remotes: ["hanoman/spec-1", "main"] });
});
```

(Tambah `makeRepoWithSpecBranch` ke import factory di file test itu.)

- [x] **Step 7: Run route test, verify pass**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test projects.route`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add server/test/factory.ts server/src/services/branches.ts server/src/routes/projects.ts server/test/branches.test.ts server/test/projects.route.test.ts
git commit -m "feat(spec-175): list origin branches for merge/rebase targets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `integrate` service — git mechanics

**Files:**
- Create: `server/src/services/integrate.ts`
- Test: `server/test/integrate.test.ts`

**Interfaces:**
- Consumes: `makeRepoWithSpecBranch` (Task 1).
- Produces:
  - `sourceBranch(specId: string): string` → `hanoman/<sanitized>`.
  - `integrate(repoDir: string, specId: string, op: "merge"|"rebase", target: string): IntegrateResult` where
    `IntegrateResult = { status:"clean"; detail:string } | { status:"conflict"; worktree:string; op; source:string; target:string; finalize:string } | { status:"error"; code:number; error:string }`.

- [x] **Step 1: Write failing tests (resolution + merge clean + conflict + guards)**

Create `server/test/integrate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { integrate } from "../src/services/integrate";
import { makeRepoWithSpecBranch } from "./factory";

// isi file di sebuah ref bare origin / repo
const at = (dir: string, ref: string, path: string) =>
  execFileSync("git", ["--git-dir", dir.endsWith(".git") || !existsSync(`${dir}/.git`) ? dir : `${dir}/.git`, "show", `${ref}:${path}`], { encoding: "utf8" });
const headOf = (repoDir: string, ref: string) =>
  execFileSync("git", ["rev-parse", ref], { cwd: repoDir, encoding: "utf8" }).trim();

describe("integrate — guards", () => {
  it("source branch tak ada → 409", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = integrate(repoDir, "SPEC-404", "merge", "origin:main");
    expect(r).toMatchObject({ status: "error", code: 409 });
  });
  it("target tak dikenal → 400", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    expect(integrate(repoDir, "SPEC-1", "merge", "origin:nope")).toMatchObject({ status: "error", code: 400 });
    expect(integrate(repoDir, "SPEC-1", "merge", "garbage")).toMatchObject({ status: "error", code: 400 });
  });
});

describe("integrate — merge clean", () => {
  it("→ origin: push kerja ke origin/<target>, worktree bersih", () => {
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-1");
    const r = integrate(repoDir, "SPEC-1", "merge", "origin:main");
    expect(r.status).toBe("clean");
    expect(at(origin, "main", "work.txt")).toBe("work\n");
    expect(existsSync(`${repoDir}/.worktrees/merge-spec-1`)).toBe(false);
  });
  it("→ lokal (branch tak ter-checkout): branch maju ke commit merge", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", { localBranches: ["staging"] });
    const r = integrate(repoDir, "SPEC-1", "merge", "local:staging");
    expect(r.status).toBe("clean");
    expect(at(repoDir, "staging", "work.txt")).toBe("work\n");
  });
  it("→ lokal branch yang sedang di-checkout (main) → 409 gagal-aman", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    expect(integrate(repoDir, "SPEC-1", "merge", "local:main")).toMatchObject({ status: "error", code: 409 });
  });
});

describe("integrate — merge conflict", () => {
  it("konflik → tinggalkan worktree konflik + finalize instruction", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" },
      work: { "f.txt": "branch-edit\n" },
      mainAdvance: { "f.txt": "main-edit\n" }, // main & branch mengubah f.txt → konflik
    });
    const r = integrate(repoDir, "SPEC-1", "merge", "origin:main");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(existsSync(r.worktree)).toBe(true);
      expect(r.finalize).toContain("git push origin HEAD:refs/heads/main");
    }
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test integrate`
Expected: FAIL — cannot import `integrate`.

- [x] **Step 3: Implement the service**

Create `server/src/services/integrate.ts`:

```ts
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
  const specB = sourceBranch(specId);
  const finalize = op === "rebase"
    ? { kind: "force-push" as const, branch: specB }
    : tgt.dest === "local"
      ? { kind: "branch-f" as const, branch: tgt.name }
      : { kind: "push" as const, branch: tgt.name };

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

type Finalize =
  | { kind: "branch-f"; branch: string }
  | { kind: "push"; branch: string }
  | { kind: "force-push"; branch: string };

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
```

- [x] **Step 4: Run to verify pass**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test integrate`
Expected: PASS (guards, merge clean origin/local, checked-out 409, merge conflict).

- [x] **Step 5: Add rebase tests**

Tambah ke `server/test/integrate.test.ts`:

```ts
describe("integrate — rebase", () => {
  it("clean: replay kerja spec di atas target, force-push ke branch spec", () => {
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" },
      work: { "work.txt": "work\n" },
      mainAdvance: { "m.txt": "main-only\n" }, // maju tanpa menyentuh work.txt → rebase bersih
    });
    const r = integrate(repoDir, "SPEC-1", "rebase", "origin:main");
    expect(r.status).toBe("clean");
    // branch spec di origin kini memuat m.txt (dari main) DAN work.txt (kerja di-replay)
    expect(at(origin, "hanoman/spec-1", "m.txt")).toBe("main-only\n");
    expect(at(origin, "hanoman/spec-1", "work.txt")).toBe("work\n");
  });
  it("conflict → worktree konflik + instruksi force-push", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
    });
    const r = integrate(repoDir, "SPEC-1", "rebase", "origin:main");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.finalize).toContain("--force-with-lease");
  });
});
```

- [x] **Step 6: Run to verify pass** (rebase branch already implemented in Step 3)

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test integrate`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/services/integrate.ts server/test/integrate.test.ts
git commit -m "feat(spec-175): integrate service — merge/rebase spec branch in isolated worktree

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Contract + route (guards + clean path)

**Files:**
- Modify: `shared/src/dto.ts:24` (after `zPatchSpec`), `shared/src/api.ts:7`
- Modify: `server/src/routes/specs.ts`
- Test: `server/test/specs.route.test.ts`

**Interfaces:**
- Consumes: `integrate` (Task 2).
- Produces: `zIntegrate` (`{ op: "merge"|"rebase"; target: string }`), `paths.specIntegrate(id)`, route `POST /specs/:id/integrate` → `{status:"clean",detail}` | `{status:"conflict",sessionId}` | `reply.code(code).send({error})`.

- [x] **Step 1: Add the DTO + path**

`shared/src/dto.ts` (setelah `zPatchSpec`):

```ts
// SPEC-175 · rebase/merge branch hasil done spec. target = "local:<b>" | "origin:<b>".
export const zIntegrate = z.object({
  op: z.enum(["merge", "rebase"]),
  target: z.string().regex(/^(local|origin):.+/),
});
```

`shared/src/api.ts` (dalam `paths`, dekat `specReview`):

```ts
  specIntegrate: (id: string) => `${API}/specs/${id}/integrate`,
```

- [x] **Step 2: Write the failing route tests**

Tambah ke `server/test/specs.route.test.ts` (pakai `buildApp`/`app.inject` sesuai pola file itu; import `makeRepoWithSpecBranch`, `makeProject`, `makeSpec`):

```ts
describe("POST /specs/:id/integrate", () => {
  it("spec non-done → 409", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    await makeProject({ id: "pi1", repoDir });
    await makeSpec({ id: "SPEC-1", projectId: "pi1", stage: "planned" });
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-1/integrate", payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(409);
  });
  it("target invalid (bukan local:/origin:) → 400", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-2");
    await makeProject({ id: "pi2", repoDir });
    await makeSpec({ id: "SPEC-2", projectId: "pi2", stage: "done" });
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-2/integrate", payload: { op: "merge", target: "garbage" } });
    expect(res.statusCode).toBe(400);
  });
  it("merge bersih → 200 {status:clean}, kerja mendarat di origin/main", async () => {
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-3");
    await makeProject({ id: "pi3", repoDir });
    await makeSpec({ id: "SPEC-3", projectId: "pi3", stage: "done" });
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-3/integrate", payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("clean");
    expect(execFileSync("git", ["--git-dir", origin, "show", "main:work.txt"], { encoding: "utf8" })).toBe("work\n");
  });
});
```

(Import `execFileSync` bila belum. Nama project unik per test agar tak bentrok DB.)

- [x] **Step 3: Run to verify failure**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test specs.route`
Expected: FAIL — 404 (route belum ada).

- [x] **Step 4: Implement the route (clean + guards)**

`server/src/routes/specs.ts` — tambah import & route:

```ts
import { zCreateSpec, zPatchSpec, zIntegrate, type Stage } from "@hanoman/shared";
import { integrate, sourceBranch } from "../services/integrate";
// ...
  // SPEC-175 · rebase/merge branch hasil sebuah done spec. Hanya untuk stage `done`. Server jalankan
  // git di worktree isolasi (never touch main working tree); conflict di-serahkan ke sesi claude (Task 4).
  app.post("/specs/:id/integrate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zIntegrate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "op/target invalid" });
    const spec = await prisma.spec.findUnique({ where: { id }, include: { project: true } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (spec.stage !== "done") return reply.code(409).send({ error: "hanya backlog item yang sudah done bisa di-rebase/merge" });
    if (!spec.project.repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = integrate(spec.project.repoDir, spec.id, parsed.data.op, parsed.data.target);
    if (r.status === "error") return reply.code(r.code).send({ error: r.error });
    if (r.status === "clean") return { status: "clean", detail: r.detail };
    // conflict → Task 4 spawn sesi; sementara balas 501 supaya test clean/guard hijau lebih dulu.
    return reply.code(501).send({ error: "conflict handling belum terpasang" });
  });
```

- [x] **Step 5: Run to verify pass**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test specs.route`
Expected: PASS (non-done 409, target 400, merge clean 200).

- [x] **Step 6: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts server/src/routes/specs.ts server/test/specs.route.test.ts
git commit -m "feat(spec-175): POST /specs/:id/integrate — guards + clean path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Conflict → claude session + worktree cleanup

**Files:**
- Modify: `server/src/routes/specs.ts` (replace the 501 stub)
- Modify: `server/src/routes/terminal.ts:118-137` (DELETE cleanup)
- Test: `server/test/specs.route.test.ts` (conflict), `server/test/terminal.route.test.ts` (DELETE cleanup)

**Interfaces:**
- Consumes: `integrate` conflict result (Task 2), `createSession`/`getSession` from `../services/pty`, `sessionModel` from `../services/settings`.
- Produces: route conflict response `{ status:"conflict", sessionId }`; DELETE removes worktree for no-flow sessions whose cwd is under `.worktrees/`.

- [x] **Step 1: Write the failing conflict route test**

Tambah ke `server/test/specs.route.test.ts`. Gunakan fake claude + `killAll()` (lihat `terminal.route.test.ts`):

```ts
import { fileURLToPath } from "node:url";
import { killAll, getSession } from "../src/services/pty";
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

it("merge konflik → 200 {status:conflict, sessionId}, sesi dibuat", async () => {
  killAll();
  process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
  const { repoDir } = makeRepoWithSpecBranch("SPEC-7", {
    base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
  });
  await makeProject({ id: "pi7", repoDir });
  await makeSpec({ id: "SPEC-7", projectId: "pi7", stage: "done" });
  const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-7/integrate", payload: { op: "merge", target: "origin:main" } });
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe("conflict");
  const sid = res.json().sessionId as string;
  expect(getSession(sid)).toBeTruthy();
  killAll();
});
```

- [x] **Step 2: Run to verify failure**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test specs.route`
Expected: FAIL — got 501.

- [x] **Step 3: Replace the 501 stub with session spawn**

`server/src/routes/specs.ts` — tambah import & ganti cabang conflict:

```ts
import { createSession } from "../services/pty";
import { sessionModel } from "../services/settings";
// ... di dalam route, ganti `return reply.code(501)...` dengan:
    const { model, effort } = await sessionModel();
    const prompt = [
      `hanoman · selesaikan konflik ${r.op} branch \`${sourceBranch(spec.id)}\` ${r.op === "merge" ? "ke" : "di atas"} \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah operasi ${r.op} dengan konflik. Resolve konflik pada file yang bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      `Backlog item ${spec.id} — ${spec.title}.`,
    ].join("\n\n");
    const s = createSession(spec.projectId, r.worktree, {
      id: `merge-${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`,
      specId: spec.id, model, effort, prompt,
    });
    return { status: "conflict", sessionId: s.id };
```

- [x] **Step 4: Run to verify pass**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test specs.route`
Expected: PASS.

- [x] **Step 5: Write failing DELETE-cleanup test**

Tambah ke `server/test/terminal.route.test.ts` (repoDir & app sudah disiapkan di file itu). Buat worktree merge secara manual lalu sesi tanpa-flow di sana:

```ts
it("DELETE sesi tanpa-flow di .worktrees/* menghapus worktree-nya", async () => {
  process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
  const wt = join(repoDir, ".worktrees", "merge-cleanup");
  execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "main"], { cwd: repoDir });
  const s = createSessionAt(wt); // helper: createSession(projectId, wt, {id, specId})
  expect(existsSync(wt)).toBe(true);
  const res = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${s.id}` });
  expect(res.statusCode).toBe(204);
  expect(existsSync(wt)).toBe(false);
});
```

Tambah util import di file test (`existsSync`, `join` sudah ada; import `createSession as createSessionSvc` dari `../src/services/pty`) dan helper kecil:

```ts
const createSessionAt = (wt: string) =>
  createSessionSvc("p1", wt, { id: "merge-cleanup", specId: "SPEC-1" });
```

- [x] **Step 6: Run to verify failure**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test terminal.route`
Expected: FAIL — worktree masih ada (DELETE tak menghapusnya).

- [x] **Step 7: Extend the DELETE handler**

`server/src/routes/terminal.ts` — ubah blok DELETE agar sesi tanpa-flow yang cwd-nya di `.worktrees/*` juga dibersihkan worktree-nya:

```ts
  app.delete("/terminal/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });

    // Sesi ber-flow (run/reverse) DAN sesi integrasi (SPEC-175, tanpa flow) sama-sama hidup di
    // worktree-nya sendiri di `.worktrees/*` — keduanya harus dibersihkan. Hanya yang ber-spec-flow
    // menggerakkan stage. Terminal biasa (cwd = repoDir) tak tersentuh.
    const inWorktree = s.cwd.includes("/.worktrees/");
    if (s.flow || inWorktree) {
      const project = await prisma.project.findUnique({ where: { id: s.projectId } });
      if (project?.repoDir) {
        if (s.flow && s.specId) await advanceStage(s.specId, project.repoDir, id, s.flow, s.cwd);
        killSession(id);
        realGit.removeWorktree(project.repoDir, s.cwd);
        return reply.code(204).send();
      }
    }
    killSession(id);
    return reply.code(204).send();
  });
```

- [x] **Step 8: Run to verify pass**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test terminal.route`
Expected: PASS. Also re-run full server suite: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test` → all green.

- [x] **Step 9: Commit**

```bash
git add server/src/routes/specs.ts server/src/routes/terminal.ts server/test/specs.route.test.ts server/test/terminal.route.test.ts
git commit -m "feat(spec-175): spawn claude session on conflict + clean up integrate worktree

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Client + IntegrateDialog component

**Files:**
- Modify: `src/src/api/client.ts`
- Create: `src/src/screens/IntegrateDialog.tsx`
- Test: `src/test/integrate-dialog.test.tsx`

**Interfaces:**
- Produces:
  - `api.integrateSpec(id, op, target): Promise<{status:"clean";detail:string}|{status:"conflict";sessionId:string}>`
  - `api.listBranches(id): Promise<{ branches: string[]; remotes: string[] }>`
  - `<IntegrateDialog spec onClose onIntegrate />` — `onIntegrate(op:"merge"|"rebase", target:string)`.

- [x] **Step 1: Extend the client**

`src/src/api/client.ts`:

```ts
  listBranches: (id: string) => j<{ branches: string[]; remotes: string[] }>(paths.branches(id)),
  // SPEC-175 · rebase/merge branch hasil done spec.
  integrateSpec: (id: string, op: "merge" | "rebase", target: string) =>
    j<{ status: "clean"; detail: string } | { status: "conflict"; sessionId: string }>(
      paths.specIntegrate(id), { method: "POST", ...body({ op, target }) }),
```

- [x] **Step 2: Write the failing dialog test**

Create `src/test/integrate-dialog.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: ["main", "hanoman/spec-1"], remotes: ["main"] })) },
}));
import { IntegrateDialog } from "../src/screens/IntegrateDialog";
import type { Spec } from "../src/screens/types";

const spec = { id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "done",
  priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null } as Spec;

describe("IntegrateDialog", () => {
  it("target-nya mengecualikan branch spec sendiri, dan Merge memanggil onIntegrate", async () => {
    const onIntegrate = vi.fn();
    render(<IntegrateDialog spec={spec} onClose={() => {}} onIntegrate={onIntegrate} />);
    const select = (await screen.findByLabelText("Target")) as HTMLSelectElement;
    // hanya "main" lokal + "main" origin; hanoman/spec-1 (branch spec) tak jadi target
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("local:main");
    expect(values).toContain("origin:main");
    expect(values).not.toContain("origin:hanoman/spec-1");
    fireEvent.change(select, { target: { value: "origin:main" } });
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    await waitFor(() => expect(onIntegrate).toHaveBeenCalledWith("merge", "origin:main"));
  });
});
```

- [x] **Step 3: Run to verify failure**

Run: `pnpm --filter ./src test integrate-dialog`
Expected: FAIL — cannot import `IntegrateDialog`.

- [x] **Step 4: Implement the dialog**

Create `src/src/screens/IntegrateDialog.tsx`:

```tsx
import React from "react";
import { Modal, Select, Button } from "../ds";
import { api } from "../api/client";
import type { Spec } from "./types";

// SPEC-175 · dialog target rebase/merge, dipakai backlog (SpecDetail) & terminal (Cell).
// Target = branch lokal ("local:<b>") atau origin ("origin:<b>"); branch spec sendiri dikecualikan.
export function IntegrateDialog({ spec, onClose, onIntegrate }: {
  spec: Spec; onClose: () => void;
  onIntegrate: (op: "merge" | "rebase", target: string) => void | Promise<void>;
}) {
  const [targets, setTargets] = React.useState<{ local: string[]; origin: string[] }>({ local: [], origin: [] });
  const [target, setTarget] = React.useState("");
  const own = `hanoman/${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
  React.useEffect(() => {
    let alive = true;
    api.listBranches(spec.projectId)
      .then((r) => { if (alive) setTargets({ local: r.branches.filter((b) => b !== own), origin: r.remotes.filter((b) => b !== own) }); })
      .catch(() => { if (alive) setTargets({ local: [], origin: [] }); });
    return () => { alive = false; };
  }, [spec.projectId, own]);

  const options = [
    { value: "", label: "Pilih target…" },
    ...targets.local.map((b) => ({ value: `local:${b}`, label: `${b} (lokal)` })),
    ...targets.origin.map((b) => ({ value: `origin:${b}`, label: `origin/${b}` })),
  ];
  const go = (op: "merge" | "rebase") => { if (target) void onIntegrate(op, target); };

  return (
    <Modal open title="Rebase / Merge" eyebrow={`${spec.id} · ${own}`} icon="git-merge" onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Rebase menata ulang branch spec di atas target (force-push balik ke branch spec). Merge
        menggabungkan branch spec ke target. Bila ada konflik, sesi claude membereskannya di Terminal.
      </div>
      <div style={{ marginBottom: 16 }}>
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Target</div>
        <Select size="sm" aria-label="Target" value={target} disabled={options.length === 1}
          onChange={(e) => setTarget(e.target.value)} options={options} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button size="sm" variant="secondary" leftIcon="git-branch" disabled={!target} onClick={() => go("rebase")}>Rebase</Button>
        <Button size="sm" variant="primary" leftIcon="git-merge" disabled={!target} onClick={() => go("merge")}>Merge</Button>
      </div>
    </Modal>
  );
}
```

- [x] **Step 5: Run to verify pass**

Run: `pnpm --filter ./src test integrate-dialog`
Expected: PASS.

- [x] **Step 6: Fix the existing backlog test's listBranches mock**

`src/test/backlog-board.test.tsx` — mock `listBranches` sekarang mengembalikan `{ branches: [] }`; tambahkan `remotes: []` agar tipe cocok:

```ts
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })) },
```

Run: `pnpm --filter ./src test backlog-board` → PASS.

- [x] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/screens/IntegrateDialog.tsx src/test/integrate-dialog.test.tsx src/test/backlog-board.test.tsx
git commit -m "feat(spec-175): IntegrateDialog + client integrateSpec

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire into Backlog, Terminal, and App

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (SpecDetail; prop `onIntegrate`)
- Modify: `src/src/screens/TerminalScreen.tsx` (Cell icon; prop `onIntegrate`)
- Modify: `src/src/App.tsx` (`integrateSpec` handler + wiring)
- Test: `src/test/backlog-board.test.tsx`, `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: `IntegrateDialog`, `api.integrateSpec` (Task 5).
- Produces: `BacklogScreen` prop `onIntegrate?: (spec, op, target) => void`; `TerminalScreen` prop `onIntegrate?`; App handler `integrateSpec(spec, op, target)`.

- [x] **Step 1: Write the failing BacklogScreen test (Integrasi hanya untuk done)**

Tambah ke `src/test/backlog-board.test.tsx`:

```tsx
import { BacklogScreen } from "../src/screens/BacklogScreen";
// render detail via title click; done spec menampilkan tombol Rebase/Merge dialog trigger
it("SpecDetail spec done menampilkan aksi Integrasi (Rebase & Merge)", async () => {
  render(<BacklogScreen backlog={[spec({ id: "SPEC-9", stage: "done" })]} projects={[{ id: "p", name: "p" }]}
    projectFilter="all" onProjectFilter={() => {}} onIntegrate={() => {}} />);
  fireEvent.click(screen.getByText("t"));               // buka detail
  fireEvent.click(await screen.findByRole("button", { name: /rebase \/ merge|integrasi/i }));
  expect(await screen.findByLabelText("Target")).toBeTruthy();
});
it("SpecDetail spec belum done tak menampilkan Integrasi", () => {
  render(<BacklogScreen backlog={[spec({ id: "SPEC-8", stage: "planned" })]} projects={[{ id: "p", name: "p" }]}
    projectFilter="all" onProjectFilter={() => {}} onIntegrate={() => {}} />);
  fireEvent.click(screen.getByText("t"));
  expect(screen.queryByRole("button", { name: /rebase \/ merge|integrasi/i })).toBeNull();
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter ./src test backlog-board`
Expected: FAIL — no Integrasi trigger.

- [x] **Step 3: Wire IntegrateDialog into SpecDetail**

`src/src/screens/BacklogScreen.tsx`:
1. Import: `import { IntegrateDialog } from "./IntegrateDialog";`
2. Tambah prop `onIntegrate` ke `SpecDetail` signature & ke `BacklogScreen` props, teruskan ke `SpecDetail`.
3. Dalam `SpecDetail`, tambah state `const [integrate, setIntegrate] = React.useState(false);`
4. Di blok `spec.stage === "done" && onStart` (dekat "Buka sesi lagi", ~line 130), tambah tombol pemicu dan dialog:

```tsx
        {spec.stage === "done" && onIntegrate && (
          <div style={{ marginTop: 12 }}>
            <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Integrasi</div>
            <Button size="sm" variant="secondary" leftIcon="git-merge" onClick={() => setIntegrate(true)}>
              Rebase / Merge
            </Button>
          </div>
        )}
        {integrate && (
          <IntegrateDialog spec={spec} onClose={() => setIntegrate(false)}
            onIntegrate={(op, target) => { setIntegrate(false); onIntegrate!(spec, op, target); }} />
        )}
```

5. Teruskan `onIntegrate` di pemakaian `<SpecDetail ... onIntegrate={onIntegrate} />` (~line 504).

- [x] **Step 4: Run to verify pass**

Run: `pnpm --filter ./src test backlog-board`
Expected: PASS.

- [x] **Step 5: Write the failing TerminalScreen test (merge icon for spec session)**

Tambah ke `src/test/terminal-screen.test.tsx` (ikuti pola mock file itu; lihat cara mengatur sessions). Assert ikon merge muncul untuk sesi ber-specId dan memanggil pembuka dialog:

```tsx
it("Cell sesi ber-specId punya aksi merge; sesi tanpa spec tidak", async () => {
  // (setup sessions mock: satu dgn specId 'SPEC-1', satu tanpa) lalu:
  expect(screen.getByTitle(/rebase \/ merge/i)).toBeTruthy();
});
```

(Sesuaikan setup dengan pola mock `api.listTerminals` di file test itu; bila menata sesi rumit, cukup uji unit render `Cell` bila diekspor, atau tambahkan assertion pada judul ikon.)

- [x] **Step 6: Run to verify failure → Implement Terminal Cell action**

`src/src/screens/TerminalScreen.tsx`:
1. Import `IntegrateDialog`, `Spec`.
2. Tambah prop `onIntegrate?: (spec: Spec, op, target) => void` ke `TerminalScreen` & teruskan ke `Cell` (butuh juga cara mengambil `Spec` dari specId — teruskan `specOf?: (id:string)=>Spec|undefined` dari App, sejajar `titleOf`).
3. Di header `Cell`, dekat ikon `git-compare`, tambah pemicu (hanya bila `session.specId && onIntegrate && specOf?.(session.specId)`):

```tsx
        {session.specId && onIntegrate && (
          <span onClick={() => setIntegrate(true)} title="Rebase / Merge branch spec"
            style={{ cursor: "pointer", color: "var(--text-subtle)", display: "inline-flex", alignItems: "center" }}>
            <Icon name="git-merge" size={12} />
          </span>
        )}
```

dan render `IntegrateDialog` dengan `spec = specOf(session.specId)` saat `integrate` true.

- [x] **Step 7: Add the App handler + wiring**

`src/src/App.tsx`:

```tsx
  // SPEC-175 · rebase/merge branch hasil sebuah done spec. Bersih → toast; conflict → pindah ke
  // Terminal tempat sesi claude membereskan konflik (pola startSession).
  async function integrateSpec(spec: Spec, op: "merge" | "rebase", target: string) {
    try {
      const r = await api.integrateSpec(spec.id, op, target);
      if (r.status === "conflict") {
        setSection("terminal");
        showToast(`${spec.id} · konflik ${op} — selesaikan di Terminal`, "warn", "git-merge");
      } else {
        showToast(`${spec.id} · ${op} berhasil · ${r.detail}`, "ok", "git-merge");
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      showToast(`${spec.id} · gagal ${op}` + (code === 409 ? " · cek target/branch" : ""), "err", "x-circle");
    }
  }
```

Teruskan ke screens:
- `<BacklogScreen ... onIntegrate={integrateSpec} />`
- `<TerminalScreen ... onIntegrate={integrateSpec} specOf={(id) => backlog.find((s) => s.id === id)} />`

- [x] **Step 8: Run UI tests + typecheck**

Run: `pnpm --filter ./src test` and `pnpm --filter ./src exec tsc --noEmit`
Expected: PASS / no type errors.

- [x] **Step 9: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/src/screens/TerminalScreen.tsx src/src/App.tsx src/test/backlog-board.test.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(spec-175): wire rebase/merge into backlog detail, terminal cell, and App

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Docs (Source of Truth) + real local smoke

**Files:**
- Modify: `internal/docs/requirements/**` (EARS untuk rebase/merge backlog)
- Modify: `internal/docs/entrypoints/**` (`POST /specs/:id/integrate`, branches `remotes`)
- Create: `internal/docs/adr/ADR-00NN-*.md` (nomor dialokasikan setelah enumerate lintas worktree)
- Modify: `internal/docs/README.md` (index ADR baru)

- [x] **Step 1: Allocate the ADR number (avoid collisions)**

Enumerate lintas SEMUA worktree/branch dulu (memory "ADR/SPEC number collisions"):

Run: `ls internal/docs/adr/ && git for-each-ref --format='%(refname)' | while read r; do git ls-tree -r --name-only "$r" -- internal/docs/adr 2>/dev/null; done | grep -oE 'ADR-[0-9]+' | sort -u | tail`
Pilih nomor > tertinggi yang muncul.

- [x] **Step 2: Write the ADR**

Create `internal/docs/adr/ADR-00NN-rebase-merge-backlog.md` — Status: accepted. Keputusan:
- Server jalankan `git merge`/`git rebase` untuk branch done spec di worktree isolasi; claude hanya untuk conflict.
- Never touch main working tree: merge→lokal via `git branch -f` yang **gagal aman** bila branch ter-checkout; merge→origin & rebase via push (non-ff ditolak, tak ada korupsi).
- Target boleh lokal atau origin (pilihan user). Rebase selalu force-push ke `hanoman/<id>`.
Konsekuensi + alternatif ditolak (selalu-claude).

- [x] **Step 3: Update requirements (EARS) + entrypoints + README index**

- `internal/docs/requirements/**`: tambah EARS mis. *"When operator triggers rebase/merge on a done backlog item, the system SHALL run it in an isolated worktree and, on conflict, open a claude session to resolve it."* + constraint hanya-done + never-touch-main.
- `internal/docs/entrypoints/**`: dokumentasikan `POST /specs/:id/integrate {op,target}` (200 clean/conflict, 400/409) dan field `remotes` pada `GET /projects/:id/branches`.
- `internal/docs/README.md`: daftarkan ADR baru di index bernomor.

- [x] **Step 4: Real local smoke (WAJIB — CLAUDE.md)**

Boot server + curl endpoint nyata terhadap DB throwaway + repo dengan branch `hanoman/*` (memory "Live smoke: dedicated DB", "Worktree butuh install+generate"):

```bash
# worktree ini butuh deps + prisma client dulu
pnpm install && pnpm --filter ./server exec prisma generate
# DB throwaway termigrasi + repo fixture dgn origin & branch hanoman/<id> (pakai skrip singkat),
# lalu boot server ke port bebas (BUKAN 8787) dan:
curl -s localhost:<port>/api/projects/<pid>/branches         # → { branches, remotes }
curl -s -XPOST localhost:<port>/api/specs/<sid>/integrate -H 'content-type: application/json' \
  -d '{"op":"merge","target":"origin:main"}'                 # → {status:"clean",...} atau {status:"conflict",sessionId}
```
Verifikasi: clean → kerja mendarat di origin/target; conflict → sesi muncul di `GET /api/terminal/sessions`. Kalau ada issue, fix sampai hijau sebelum lanjut.

- [x] **Step 5: Full test sweep**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test --no-file-parallelism` dan `pnpm --filter ./src test`
Expected: semua hijau.

- [x] **Step 6: Commit**

```bash
git add internal/docs docs/superpowers/plans/2026-07-11-rebase-merge-backlog-spec-175.md
git commit -m "docs(spec-175): ADR + requirements + entrypoints for rebase/merge backlog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** endpoint+dialog (Task 3/5/6) · target lokal/origin (Task 1/2/5) · conflict→claude (Task 4) · hanya-done (Task 3) · never-touch-main / branch-f safe-fail (Task 2) · docs+ADR (Task 7). ✅
- **Types:** `integrate()` return union dipakai konsisten di route (Task 3/4); `listBranches` `{branches,remotes}` konsisten client↔dialog (Task 1/5); `onIntegrate(spec,op,target)` konsisten Backlog/Terminal/App (Task 6). ✅
- **No placeholders:** setiap step berisi kode nyata; nomor ADR sengaja dialokasikan runtime (Task 7 Step 1) karena rawan bentrok lintas worktree.
