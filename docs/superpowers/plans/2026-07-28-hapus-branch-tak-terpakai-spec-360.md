# SPEC-360 — Hapus Branch Tak Terpakai — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator bisa melihat branch yang sudah ter-merge ke branch utamanya dan menghapusnya — satu tombol per baris atau bulk — mencakup local & origin, tanpa pernah bisa menghapus branch yang masih dipakai.

**Architecture:** Satu service murni (`server/src/services/branch-cleanup.ts`) menurunkan daftar branch ter-merge langsung dari git tiap request (ADR-0018 — tanpa kolom DB, tanpa cache) dan mengeksekusi penghapusan lewat `runGitOp` yang sudah ada. Dua route tipis di `ide.ts` memasok sinyal non-git (Spec belum `done`, sesi tmux aktif) sebagai himpunan nama branch. Satu komponen frontend baru (`BranchesPanel.tsx`) jadi tab ketiga di IDE Visual.

**Tech Stack:** Node + TypeScript (Fastify), Prisma/Postgres (read-only di sini), React + TypeScript (Vite), vitest + @testing-library/react, git CLI lewat `execFile` async.

## Global Constraints

- TypeScript **strict**. Tak ada `any` baru di kode produksi.
- Test repo dijalankan `vitest run --no-file-parallelism`; env prod jangan bocor → `env -u NODE_ENV -u DATABASE_URL`.
- **Tanpa perubahan skema, tanpa migration.** Semua nilai turunan dari git (ADR-0018/0011).
- Refname yang berasal dari data **tak pernah** diserahkan mentah sebagai argumen git. Base di-resolve ke **SHA** dulu (heksadesimal tak pernah terbaca sebagai flag — pola `resolveCommit` di `runner/src/git.ts`, ADR-0032); nama branch yang tersisa lewat `--end-of-options`.
- **Tak pernah** hardcode `"main"` sebagai base: repo bisa ber-default `master`/`develop` (pelajaran SPEC-227).
- **Tak pernah** memakai `git branch -D` / force di jalur ini. Hanya branch ter-merge yang boleh dihapus, jadi `-d` polos selalu cukup.
- Prosa UI & pesan error berbahasa **Indonesia**.
- Komponen UI hanya dari `../ds` (`Card`, `Button`, `Badge`, `Select`, `Checkbox`, `StateBlock`, `ConfirmDialog`) — editorial, bone paper, brass accent. Tanpa CSS baru.
- Docs yang tersentuh diperbarui **dalam commit yang sama** & ter-link di `internal/docs/README.md`.
- Nomor ADR yang diklaim: **0077** (maksimum terpakai lintas semua branch local+origin = 0076, sudah dienumerasi).

### Tiga gotcha git yang SUDAH diverifikasi di repo ini — jangan diverifikasi ulang, langsung tangani

Ketiganya diukur dengan menjalankan perintahnya, bukan diasumsikan:

1. **`git branch --merged <sha> --format='%(refname:short)'` memancarkan baris `(no branch)`** saat dijalankan di worktree **detached HEAD**. Sesi hanoman SELALU detached (ADR-0002), jadi ini bukan kasus pinggiran — tanpa filter, panel menampilkan "branch" bernama `(no branch)`.
2. **`origin/HEAD` dipendekkan git menjadi bare `origin`**, bukan `origin/HEAD`. Muncul di `git branch -r --format` MAUPUN `for-each-ref refs/remotes/origin`. `services/branches.ts` yang sudah ada memang menyaring keduanya — tiru itu.
3. **`--end-of-options` TIDAK bisa dipakai untuk argumen `--merged`.** `git branch --merged --end-of-options main --format=…` membuat git menelan `--end-of-options` sebagai nilai `--merged` dan memperlakukan `--format` sebagai argumen posisi. Karena itu base **wajib** di-resolve ke SHA lebih dulu, lalu SHA itu yang diberikan ke `--merged`.

Satu helper `shortName()` menangani gotcha 1 & 2 di satu tempat.

## File Structure

| File | Tanggung jawab |
|---|---|
| `server/src/services/branch-cleanup.ts` **(baru)** | Penemuan branch ter-merge + eksekusi hapus batch. Murni: sinyal non-git masuk sebagai parameter. |
| `server/test/branch-cleanup.test.ts` **(baru)** | Unit test service terhadap repo git nyata di tmp. |
| `server/src/routes/ide.ts` **(ubah)** | Dua route tipis; menyusun `openSpecBranches` & `sessionBranches` lalu delegasi. |
| `server/test/ide.route.test.ts` **(ubah)** | Test route: 404, bentuk respons, kunci dari Spec, validasi body. |
| `server/test/agent-capabilities.test.ts` **(ubah)** | Mengunci pemetaan capability kedua route baru. |
| `shared/src/api.ts` **(ubah)** | Dua path baru. |
| `src/src/api/client.ts` **(ubah)** | Tipe DTO + dua metode api + `LOCK_LABEL`. |
| `src/src/screens/BranchesPanel.tsx` **(baru)** | Tabel + bulk + konfirmasi. Komponen sendiri — `GitGraph.tsx` sudah 43 KB. |
| `src/test/branches-panel.test.tsx` **(baru)** | Test komponen. |
| `src/src/screens/IdeScreen.tsx` **(ubah)** | Tab ketiga "Branches". |
| `src/test/ide-screen.test.tsx` **(ubah)** | Test tab. |
| `internal/docs/adr/0077-*.md` **(baru)**, `internal/docs/README.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/skills/hanoman/SKILL.md` **(ubah)** | Source of Truth. |

---

### Task 1: Service — penemuan branch ter-merge (`listUnusedBranches`)

**Files:**
- Create: `server/src/services/branch-cleanup.ts`
- Test: `server/test/branch-cleanup.test.ts`

**Interfaces:**
- Consumes: `makeRepoWithSpecBranch`, `makeRepoWithBranches` dari `server/test/factory.ts`.
- Produces:
  ```ts
  export type BranchLock = "current" | "base" | "worktree" | "spec-open" | "session";
  export type BranchScope = "local" | "remote" | "both";
  export type UnusedBranch = {
    name: string; local: boolean; remote: boolean;
    lastCommit: { sha: string; at: string; subject: string } | null;
    locks: BranchLock[];
  };
  export type UnusedReport = { base: string; baseRemote: string | null; current: string; branches: UnusedBranch[] };
  export type LockInputs = { openSpecBranches: Set<string>; sessionBranches: Set<string> };
  export function listUnusedBranches(repoDir: string | null, opts: { base?: string } & LockInputs): Promise<UnusedReport>;
  export const LOCK_REASON: Record<BranchLock, string>;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/branch-cleanup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeRepoWithSpecBranch, makeRepoWithBranches } from "./factory";
import { listUnusedBranches, LOCK_REASON } from "../src/services/branch-cleanup";

const NONE = { openSpecBranches: new Set<string>(), sessionBranches: new Set<string>() };
const g = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

// Repo dgn origin + branch hanoman/<id> yang SUDAH di-merge ke main (local & origin).
function mergedRepo(specId: string): string {
  const { repoDir } = makeRepoWithSpecBranch(specId);
  g(repoDir, "merge", "--no-ff", "--no-edit", `hanoman/${specId}`);
  g(repoDir, "push", "-q", "origin", "main");
  return repoDir;
}

describe("listUnusedBranches", () => {
  it("branch ter-merge muncul dengan local+remote true", async () => {
    const r = await listUnusedBranches(mergedRepo("s1"), NONE);
    expect(r.base).toBe("main");
    expect(r.baseRemote).toBe("origin/main");
    expect(r.current).toBe("main");
    const b = r.branches.find((x) => x.name === "hanoman/s1");
    expect(b).toBeTruthy();
    expect(b!.local).toBe(true);
    expect(b!.remote).toBe(true);
    expect(b!.locks).toEqual([]);
    expect(b!.lastCommit?.subject).toBe("feat(s1): work");
  });

  it("branch BELUM ter-merge tidak muncul sama sekali", async () => {
    const { repoDir } = makeRepoWithSpecBranch("s2"); // tak di-merge
    const r = await listUnusedBranches(repoDir, NONE);
    expect(r.branches.some((x) => x.name === "hanoman/s2")).toBe(false);
  });

  it("base & current ikut tampil tapi terkunci", async () => {
    const r = await listUnusedBranches(mergedRepo("s3"), NONE);
    const main = r.branches.find((x) => x.name === "main")!;
    expect(main.locks).toContain("base");
    expect(main.locks).toContain("current");
  });

  // GOTCHA 2 · git memendekkan origin/HEAD jadi bare "origin"
  it("origin/HEAD maupun bare origin tak pernah jadi baris", async () => {
    const dir = mergedRepo("s4");
    g(dir, "remote", "set-head", "origin", "main"); // membuat refs/remotes/origin/HEAD
    const r = await listUnusedBranches(dir, NONE);
    expect(r.branches.some((x) => x.name === "origin")).toBe(false);
    expect(r.branches.some((x) => x.name === "HEAD")).toBe(false);
    expect(r.branches.some((x) => x.name === "origin/HEAD")).toBe(false);
  });

  // GOTCHA 1 · di worktree detached, git branch --merged memancarkan baris "(no branch)"
  it("detached HEAD tak memunculkan baris hantu \"(no branch)\"", async () => {
    const dir = mergedRepo("s5");
    g(dir, "checkout", "-q", "--detach", "HEAD");
    const r = await listUnusedBranches(dir, NONE);
    expect(r.current).toBe("HEAD");
    expect(r.branches.some((x) => x.name === "(no branch)")).toBe(false);
    expect(r.branches.some((x) => x.name === "")).toBe(false);
    expect(r.branches.some((x) => x.name === "hanoman/s5")).toBe(true); // tetap terdeteksi
  });

  it("base non-main: repo ber-default master tetap resolve", async () => {
    const dir = makeRepoWithBranches("dev");
    g(dir, "branch", "-M", "master");
    const r = await listUnusedBranches(dir, NONE);
    expect(r.base).toBe("master");
    expect(r.baseRemote).toBeNull(); // repo tanpa remote
    expect(r.branches.some((x) => x.name === "dev")).toBe(true); // commit sama → ter-merge
  });

  it("base eksplisit dipakai bila resolve", async () => {
    const r = await listUnusedBranches(makeRepoWithBranches("dev"), { ...NONE, base: "dev" });
    expect(r.base).toBe("dev");
  });

  it("base eksplisit yang tak resolve jatuh ke fallback", async () => {
    const r = await listUnusedBranches(makeRepoWithBranches("dev"), { ...NONE, base: "ghost" });
    expect(r.base).toBe("main");
  });

  it("kunci worktree: branch ter-checkout di worktree lain", async () => {
    const dir = mergedRepo("s6");
    mkdirSync(join(dir, ".worktrees"), { recursive: true });
    g(dir, "worktree", "add", join(dir, ".worktrees", "wt"), "hanoman/s6");
    const r = await listUnusedBranches(dir, NONE);
    expect(r.branches.find((x) => x.name === "hanoman/s6")!.locks).toContain("worktree");
  });

  it("kunci spec-open & session dari parameter", async () => {
    const dir = mergedRepo("s7");
    const a = await listUnusedBranches(dir, { ...NONE, openSpecBranches: new Set(["hanoman/s7"]) });
    expect(a.branches.find((x) => x.name === "hanoman/s7")!.locks).toContain("spec-open");
    const b = await listUnusedBranches(dir, { ...NONE, sessionBranches: new Set(["hanoman/s7"]) });
    expect(b.branches.find((x) => x.name === "hanoman/s7")!.locks).toContain("session");
  });

  it("repoDir null / bukan repo → laporan kosong, tak melempar", async () => {
    expect(await listUnusedBranches(null, NONE)).toEqual({ base: "", baseRemote: null, current: "", branches: [] });
    const r = await listUnusedBranches("/tmp/hanoman-tidak-ada-repo-360", NONE);
    expect(r.branches).toEqual([]);
  });

  it("LOCK_REASON punya prosa Indonesia untuk tiap kunci", () => {
    for (const k of ["current", "base", "worktree", "spec-open", "session"] as const) {
      expect(LOCK_REASON[k]).toMatch(/\S/);
    }
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-360
env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism server/test/branch-cleanup.test.ts
```
Expected: FAIL — `Cannot find module '../src/services/branch-cleanup'`.

- [ ] **Step 3: Implementasi `listUnusedBranches`**

Buat `server/src/services/branch-cleanup.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// SPEC-360 · ADR-0077 · penemuan & pembersihan branch yang sudah ter-merge ke branch utamanya.
// Nilai turunan penuh dari git tiap request (ADR-0018/0011): tak ada kolom DB, tak ada cache.
// Murni: sinyal non-git (Spec belum done, sesi tmux aktif) masuk sebagai HIMPUNAN nama branch,
// bukan import — supaya modul ini bisa dites tanpa DB maupun tmux.
const exec = promisify(execFile);
const GIT = { timeout: 60_000, maxBuffer: 1 << 24, encoding: "utf8" as const };

export type BranchLock = "current" | "base" | "worktree" | "spec-open" | "session";
export type BranchScope = "local" | "remote" | "both";

// Prosa alasan; dipakai pesan error jalur write DAN (versi ringkasnya) badge UI.
export const LOCK_REASON: Record<BranchLock, string> = {
  current: "branch aktif (HEAD)",
  base: "branch base",
  worktree: "dipakai worktree lain",
  "spec-open": "backlog-nya belum selesai",
  session: "sesi aktif memakainya",
};

export type UnusedBranch = {
  name: string;
  local: boolean;
  remote: boolean;
  lastCommit: { sha: string; at: string; subject: string } | null;
  locks: BranchLock[];
};
export type UnusedReport = { base: string; baseRemote: string | null; current: string; branches: UnusedBranch[] };
export type LockInputs = { openSpecBranches: Set<string>; sessionBranches: Set<string> };

const EMPTY: UnusedReport = { base: "", baseRemote: null, current: "", branches: [] };

// Cermin refs() di services/branches.ts: gagal → string kosong, TAK PERNAH melempar.
// Route ini read-only; repo rusak/tanpa commit tak boleh jadi 500.
async function out(repoDir: string, args: string[]): Promise<string> {
  try { return (await exec("git", args, { cwd: repoDir, ...GIT })).stdout; } catch { return ""; }
}
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

// Normalisasi satu baris refname:short → nama branch, atau "" bila harus dibuang.
// Dua hal yang WAJIB dibuang, keduanya sudah diverifikasi terhadap git di repo ini:
//   · "(no branch)" — dipancarkan `git branch --merged` saat dijalankan di worktree DETACHED.
//     Sesi hanoman selalu detached (ADR-0002), jadi ini jalur normal, bukan kasus pinggiran.
//   · "origin" — git memendekkan refs/remotes/origin/HEAD jadi bare "origin", BUKAN "origin/HEAD".
//     services/branches.ts sudah menyaring keduanya; jangan sampai modul ini lupa.
function shortName(ref: string): string {
  if (!ref || ref === "(no branch)" || ref === "HEAD" || ref === "origin" || ref === "origin/HEAD") return "";
  const name = ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  return name === "HEAD" ? "" : name;
}

// SPEC-197/ADR-0032 · resolve ke SHA, bukan meneruskan nama mentah: heksadesimal tak pernah
// terbaca sebagai flag. Ini juga SATU-SATUNYA cara aman memberi base ke `--merged`, karena
// `--end-of-options` tak bisa dipakai di sana (git akan menelannya sebagai nilai `--merged`).
async function revSha(repoDir: string, rev: string): Promise<string> {
  return (await out(repoDir, ["rev-parse", "--verify", "-q", "--end-of-options", `${rev}^{commit}`])).trim();
}

// SPEC-227 · JANGAN hardcode "main": repo bisa ber-default master/develop. Urutan: base yang
// diminta → main → master → branch aktif → "HEAD" (repo detached/tanpa branch).
async function resolveBase(repoDir: string, want: string | undefined, current: string): Promise<string> {
  for (const c of [want, "main", "master"]) if (c && await revSha(repoDir, c)) return c;
  return current && current !== "HEAD" ? current : "HEAD";
}

// Branch yang ter-checkout di worktree lain. Sesi hanoman lahir --detach (ADR-0002) jadi seringnya
// TAK ada baris `branch` sama sekali — itulah alasan kunci `session` tetap perlu, terpisah dari ini.
async function worktreeBranches(repoDir: string): Promise<Set<string>> {
  const s = new Set<string>();
  for (const l of lines(await out(repoDir, ["worktree", "list", "--porcelain"])))
    if (l.startsWith("branch refs/heads/")) s.add(l.slice("branch refs/heads/".length));
  return s;
}

// U+001F unit separator: tak pernah muncul di subject commit, jadi aman jadi pemisah field.
// WAJIB ditulis sebagai ESCAPE, bukan karakter mentah: 0x1F tak terlihat di editor dan
// mudah hilang saat disalin. Dan jangan pernah "" (string kosong) -- split("") memecah per-karakter.
const SEP = "\u001f";
type CommitMeta = { sha: string; at: string; subject: string };
async function lastCommits(repoDir: string): Promise<Map<string, CommitMeta>> {
  const fmt = ["%(refname:short)", "%(objectname)", "%(committerdate:iso-strict)", "%(contents:subject)"].join(SEP);
  const m = new Map<string, CommitMeta>();
  for (const l of lines(await out(repoDir, ["for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes/origin"]))) {
    const [ref, sha, at, ...rest] = l.split(SEP);
    const name = shortName(ref ?? "");
    if (!name || !sha) continue;
    if (!m.has(name)) m.set(name, { sha, at: at ?? "", subject: rest.join(SEP) });
  }
  return m;
}

export async function listUnusedBranches(
  repoDir: string | null,
  opts: { base?: string } & LockInputs,
): Promise<UnusedReport> {
  if (!repoDir) return EMPTY;
  const current = (await out(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (!current) return EMPTY; // bukan repo git / belum punya commit
  const base = await resolveBase(repoDir, opts.base, current);
  const baseSha = await revSha(repoDir, base);
  if (!baseSha) return { ...EMPTY, current };
  // Untuk ref origin, "branch utama"-nya adalah origin/<base> — main lokal bisa tertinggal.
  const baseRemote = (await revSha(repoDir, `origin/${base}`)) ? `origin/${base}` : null;
  const baseRemoteSha = baseRemote ? await revSha(repoDir, baseRemote) : baseSha;

  const [localMerged, remoteMerged, wt, meta] = await Promise.all([
    out(repoDir, ["branch", "--merged", baseSha, "--format=%(refname:short)"]),
    out(repoDir, ["branch", "-r", "--merged", baseRemoteSha, "--format=%(refname:short)"]),
    worktreeBranches(repoDir),
    lastCommits(repoDir),
  ]);

  const locals = new Set(lines(localMerged).map(shortName).filter(Boolean));
  const remotes = new Set(
    lines(remoteMerged).filter((r) => r.startsWith("origin/")).map(shortName).filter(Boolean));

  const names = [...new Set([...locals, ...remotes])].sort();
  const branches = names.map<UnusedBranch>((name) => {
    const locks: BranchLock[] = [];
    if (name === current) locks.push("current");
    if (name === base) locks.push("base");
    if (wt.has(name)) locks.push("worktree");
    if (opts.openSpecBranches.has(name)) locks.push("spec-open");
    if (opts.sessionBranches.has(name)) locks.push("session");
    return { name, local: locals.has(name), remote: remotes.has(name), lastCommit: meta.get(name) ?? null, locks };
  });
  return { base, baseRemote, current, branches };
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism server/test/branch-cleanup.test.ts
```
Expected: PASS — 12 test hijau.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/branch-cleanup.ts server/test/branch-cleanup.test.ts
git commit -m "feat(spec-360): penemuan branch ter-merge + lima kunci proteksi"
```

---

### Task 2: Service — eksekusi hapus batch (`deleteBranches`)

**Files:**
- Modify: `server/src/services/branch-cleanup.ts`
- Test: `server/test/branch-cleanup.test.ts` (tambah `describe` baru)

**Interfaces:**
- Consumes: `listUnusedBranches`, `LOCK_REASON`, `UnusedBranch`, `BranchScope`, `LockInputs` dari Task 1; `runGitOp` dari `./git-ide`.
- Produces:
  ```ts
  export type DeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; error?: string };
  export function deleteBranches(
    repoDir: string, names: string[],
    opts: { scope: BranchScope; base?: string } & LockInputs,
  ): Promise<{ base: string; results: DeleteResult[] }>;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Ubah baris import service di `server/test/branch-cleanup.test.ts` menjadi:

```ts
import { listUnusedBranches, deleteBranches, LOCK_REASON } from "../src/services/branch-cleanup";
```

Tambahkan di akhir file:

```ts
const branchList = (dir: string) =>
  g(dir, "branch", "--format=%(refname:short)").split("\n").map((s) => s.trim()).filter(Boolean);
const originList = (dir: string) =>
  g(dir, "branch", "-r", "--format=%(refname:short)").split("\n").map((s) => s.trim()).filter(Boolean);

describe("deleteBranches", () => {
  it("scope both menghapus local DAN origin", async () => {
    const dir = mergedRepo("d1");
    const r = await deleteBranches(dir, ["hanoman/d1"], { scope: "both", ...NONE });
    expect(r.results).toEqual([{ name: "hanoman/d1", ok: true, scope: "both" }]);
    expect(branchList(dir)).not.toContain("hanoman/d1");
    expect(originList(dir)).not.toContain("origin/hanoman/d1");
  });

  it("scope local menyisakan ref origin", async () => {
    const dir = mergedRepo("d2");
    const r = await deleteBranches(dir, ["hanoman/d2"], { scope: "local", ...NONE });
    expect(r.results[0]).toMatchObject({ ok: true, scope: "local" });
    expect(branchList(dir)).not.toContain("hanoman/d2");
    expect(originList(dir)).toContain("origin/hanoman/d2");
  });

  it("scope remote menyisakan branch local", async () => {
    const dir = mergedRepo("d3");
    const r = await deleteBranches(dir, ["hanoman/d3"], { scope: "remote", ...NONE });
    expect(r.results[0]).toMatchObject({ ok: true, scope: "remote" });
    expect(branchList(dir)).toContain("hanoman/d3");
    expect(originList(dir)).not.toContain("origin/hanoman/d3");
  });

  it("branch terkunci ditolak dengan alasan, git tak dipanggil", async () => {
    const dir = mergedRepo("d4");
    const r = await deleteBranches(dir, ["hanoman/d4"], {
      scope: "both", openSpecBranches: new Set(["hanoman/d4"]), sessionBranches: new Set() });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toContain(LOCK_REASON["spec-open"]);
    expect(branchList(dir)).toContain("hanoman/d4"); // masih ada
  });

  it("base & current tak bisa dihapus", async () => {
    const dir = mergedRepo("d5");
    const r = await deleteBranches(dir, ["main"], { scope: "both", ...NONE });
    expect(r.results[0]!.ok).toBe(false);
    expect(branchList(dir)).toContain("main");
  });

  it("nama di luar daftar ter-merge ditolak (tak bisa diselundupkan lewat body)", async () => {
    const { repoDir } = makeRepoWithSpecBranch("d6"); // hanoman/d6 BELUM ter-merge
    const r = await deleteBranches(repoDir, ["hanoman/d6"], { scope: "both", ...NONE });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toContain("ter-merge");
    expect(branchList(repoDir)).toContain("hanoman/d6");
  });

  it("scope menyempit per branch: minta both pada branch tanpa origin → local saja", async () => {
    const dir = mergedRepo("d7");
    g(dir, "branch", "lokal-saja"); // di commit main → ter-merge, tanpa ref origin
    const r = await deleteBranches(dir, ["lokal-saja"], { scope: "both", ...NONE });
    expect(r.results[0]).toMatchObject({ ok: true, scope: "local" });
    expect(branchList(dir)).not.toContain("lokal-saja");
  });

  it("minta remote pada branch tanpa origin → scope none, git tak dipanggil", async () => {
    const dir = mergedRepo("d8");
    g(dir, "branch", "lokal2");
    const r = await deleteBranches(dir, ["lokal2"], { scope: "remote", ...NONE });
    expect(r.results[0]).toMatchObject({ ok: false, scope: "none" });
    expect(branchList(dir)).toContain("lokal2");
  });

  it("satu gagal tak menjatuhkan sisanya", async () => {
    const dir = mergedRepo("d9");
    g(dir, "branch", "ikut");
    const r = await deleteBranches(dir, ["main", "ikut"], { scope: "local", ...NONE });
    expect(r.results.find((x) => x.name === "main")!.ok).toBe(false);
    expect(r.results.find((x) => x.name === "ikut")!.ok).toBe(true);
    expect(branchList(dir)).not.toContain("ikut");
  });

  it("names kosong → results kosong, base tetap dilaporkan", async () => {
    const r = await deleteBranches(mergedRepo("d10"), [], { scope: "both", ...NONE });
    expect(r.results).toEqual([]);
    expect(r.base).toBe("main");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism server/test/branch-cleanup.test.ts
```
Expected: FAIL — `deleteBranches is not a function`.

- [ ] **Step 3: Implementasi `deleteBranches`**

Tambahkan `import { runGitOp } from "./git-ide";` di blok import atas `branch-cleanup.ts`, lalu tambahkan di akhir file:

```ts
export type DeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; error?: string };

// Scope efektif = irisan yang DIMINTA dengan ref yang benar-benar ADA pada branch itu.
function effectiveScope(want: BranchScope, b: UnusedBranch): BranchScope | "none" {
  const local = b.local && want !== "remote";
  const remote = b.remote && want !== "local";
  if (local && remote) return "both";
  if (local) return "local";
  if (remote) return "remote";
  return "none";
}

// SPEC-360 · ADR-0077 · hapus batch. Menurunkan daftar ter-merge lebih dulu, lalu MEMVALIDASI ULANG
// tiap nama terhadap daftar itu: klien tak bisa menyelundupkan branch sembarang lewat body, dan
// kunci proteksi ditegakkan di jalur tulis (bukan sekadar petunjuk UI). Eksekusi didelegasikan ke
// runGitOp `delete-branch` (SPEC-206) — satu-satunya jalur hapus branch di codebase, jadi tak ada
// implementasi kedua yang bisa drift. Force TAK PERNAH dipakai: semua kandidat sudah ter-merge.
export async function deleteBranches(
  repoDir: string,
  names: string[],
  opts: { scope: BranchScope; base?: string } & LockInputs,
): Promise<{ base: string; results: DeleteResult[] }> {
  const report = await listUnusedBranches(repoDir, opts);
  const byName = new Map(report.branches.map((b) => [b.name, b]));
  const results: DeleteResult[] = [];
  for (const name of names) {
    const b = byName.get(name);
    if (!b) {
      results.push({ name, ok: false, scope: "none",
        error: `branch tak ditemukan di daftar ter-merge ke ${report.base}` });
      continue;
    }
    if (b.locks.length) {
      results.push({ name, ok: false, scope: "none",
        error: `terkunci: ${b.locks.map((l) => LOCK_REASON[l]).join(", ")}` });
      continue;
    }
    const scope = effectiveScope(opts.scope, b);
    if (scope === "none") {
      results.push({ name, ok: false, scope: "none",
        error: opts.scope === "remote" ? "branch tak punya ref origin" : "branch tak punya ref lokal" });
      continue;
    }
    const r = await runGitOp(repoDir, {
      op: "delete-branch", name, local: scope !== "remote", remote: scope !== "local" });
    results.push(r.ok ? { name, ok: true, scope } : { name, ok: false, scope, error: r.stderr || "hapus branch gagal" });
  }
  return { base: report.base, results };
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism server/test/branch-cleanup.test.ts
```
Expected: PASS — 22 test hijau (12 dari Task 1 + 10 baru).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/branch-cleanup.ts server/test/branch-cleanup.test.ts
git commit -m "feat(spec-360): hapus branch batch — validasi ulang kunci + scope menyempit per branch"
```

---

### Task 3: Route — `GET .../branches/unused` + `POST .../branches/delete`

**Files:**
- Modify: `shared/src/api.ts` (tepat di bawah baris `branches:`)
- Modify: `server/src/routes/ide.ts`
- Test: `server/test/ide.route.test.ts`
- Test: `server/test/agent-capabilities.test.ts`

**Interfaces:**
- Consumes: `listUnusedBranches`, `deleteBranches`, `BranchScope` (Task 1–2); `sourceBranch` dari `../services/integrate`; `listSessions` & `prisma` (keduanya sudah di-import di `ide.ts`).
- Produces: `paths.branchesUnused(id, base?)`, `paths.branchesDelete(id)` di `@hanoman/shared`.

- [ ] **Step 1: Tulis test route yang gagal**

Di `server/test/ide.route.test.ts`, tambahkan `makeSpec` ke daftar impor dari `./factory`, lalu tambahkan helper di dekat `ffRepo()`:

```ts
// SPEC-360 · repo dgn hanoman/<id> SUDAH ter-merge ke main (local + origin).
function mergedRepo(specId: string): string {
  const { repoDir } = makeRepoWithSpecBranch(specId);
  const gg = (...a: string[]) => spawnSync("git", a, { cwd: repoDir, encoding: "utf8" });
  gg("merge", "--no-ff", "--no-edit", `hanoman/${specId}`);
  gg("push", "-q", "origin", "main");
  return repoDir;
}
```

Di `beforeAll`, setelah project lain:

```ts
  await makeProject({ id: "cleanrepo", repoDir: mergedRepo("clean") });
  await makeProject({ id: "lockrepo", repoDir: mergedRepo("locked") });
  await makeSpec({ id: "locked", projectId: "lockrepo", stage: "executing" }); // → hanoman/locked terkunci
```

Lalu `describe` baru di akhir file:

```ts
describe("branch cleanup (SPEC-360)", () => {
  it("GET /branches/unused: project tak ada → 404", async () => {
    const r = await app.inject({ url: "/api/projects/ghost/branches/unused" });
    expect(r.statusCode).toBe(404);
  });

  it("GET /branches/unused: branch ter-merge tampil, base & current terkunci", async () => {
    const r = await app.inject({ url: "/api/projects/cleanrepo/branches/unused" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.base).toBe("main");
    expect(j.baseRemote).toBe("origin/main");
    expect(j.current).toBe("main");
    const b = j.branches.find((x: { name: string }) => x.name === "hanoman/clean");
    expect(b).toMatchObject({ local: true, remote: true, locks: [] });
    expect(j.branches.find((x: { name: string }) => x.name === "main").locks).toContain("base");
  });

  it("GET /branches/unused: Spec belum done mengunci branch-nya", async () => {
    const r = await app.inject({ url: "/api/projects/lockrepo/branches/unused" });
    const b = r.json().branches.find((x: { name: string }) => x.name === "hanoman/locked");
    expect(b.locks).toContain("spec-open");
  });

  it("GET /branches/unused: project tanpa repoDir → laporan kosong", async () => {
    const r = await app.inject({ url: "/api/projects/nodir/branches/unused" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ base: "", baseRemote: null, current: "", branches: [] });
  });

  it("POST /branches/delete: names wajib", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/cleanrepo/branches/delete", payload: {} });
    expect(r.statusCode).toBe(400);
  });

  it("POST /branches/delete: scope tak sah → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/cleanrepo/branches/delete",
      payload: { names: ["hanoman/clean"], scope: "semua" } });
    expect(r.statusCode).toBe(400);
  });

  it("POST /branches/delete: project tanpa repoDir → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/nodir/branches/delete",
      payload: { names: ["x"] } });
    expect(r.statusCode).toBe(400);
  });

  it("POST /branches/delete: branch terkunci → results ok:false, branch selamat", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/lockrepo/branches/delete",
      payload: { names: ["hanoman/locked"], scope: "both" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().results[0]).toMatchObject({ name: "hanoman/locked", ok: false });
    const after = await app.inject({ url: "/api/projects/lockrepo/branches/unused" });
    expect(after.json().branches.some((x: { name: string }) => x.name === "hanoman/locked")).toBe(true);
  });

  it("POST /branches/delete: hapus local+origin benar-benar terjadi", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/cleanrepo/branches/delete",
      payload: { names: ["hanoman/clean"], scope: "both" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().results[0]).toMatchObject({ name: "hanoman/clean", ok: true, scope: "both" });
    const after = await app.inject({ url: "/api/projects/cleanrepo/branches/unused" });
    expect(after.json().branches.some((x: { name: string }) => x.name === "hanoman/clean")).toBe(false);
  });
});
```

Di `server/test/agent-capabilities.test.ts` tambahkan (ikuti gaya `it` yang sudah ada di file itu):

```ts
  // SPEC-360 · `branches` SENGAJA bukan anggota IDE_SUBS: GET /projects/:id/branches yang lama
  // sudah memetakan ke projects:read, dan memasukkannya ke IDE_SUBS akan diam-diam mengubahnya.
  it("branch cleanup memetakan ke domain projects, bukan ide", () => {
    expect(capabilityForRoute("GET", "/api/projects/p1/branches/unused")).toBe("projects:read");
    expect(capabilityForRoute("POST", "/api/projects/p1/branches/delete")).toBe("projects:write");
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism server/test/ide.route.test.ts server/test/agent-capabilities.test.ts
```
Expected: FAIL — `GET /branches/unused` balas 404 dari Fastify (route belum terdaftar).

- [ ] **Step 3a: Tambah path di `shared/src/api.ts`**

Tepat di bawah baris `branches: (id: string) => ...`:

```ts
  // SPEC-360 · ADR-0077 · branch ter-merge (nilai turunan git) + hapus batch local/origin.
  branchesUnused: (id: string, base?: string) =>
    `${API}/projects/${id}/branches/unused${base ? `?base=${encodeURIComponent(base)}` : ""}`,
  branchesDelete: (id: string) => `${API}/projects/${id}/branches/delete`,
```

- [ ] **Step 3b: Tambah dua route di `server/src/routes/ide.ts`**

Tambahkan satu baris import baru:

```ts
import { listUnusedBranches, deleteBranches, type BranchScope } from "../services/branch-cleanup";
```

`sourceBranch` datang dari `../services/integrate` yang **sudah** di-import di berkas ini —
tambahkan ke daftar yang ada, jangan buat baris import kedua dari modul yang sama:

```ts
import { mergeIntoCurrent, rebaseOntoCurrent, pullIntoCurrent, dropCommit, sourceBranch, type GraphMergeResult } from "../services/integrate";
```

Tambahkan helper tepat di bawah `const activeSessions = ...`:

```ts
// SPEC-360 · ADR-0077 · sinyal NON-git yang mengunci sebuah branch dari penghapusan. Dikumpulkan
// di route (yang boleh menyentuh DB & tmux) lalu diserahkan ke service sebagai himpunan nama
// branch — service tetap murni & bisa dites tanpa DB maupun tmux.
async function lockInputs(id: string) {
  const open = await prisma.spec.findMany({
    where: { projectId: id, stage: { not: "done" } }, select: { id: true } });
  // Sesi backlog lahir TANPA opts.branch (session-launch.ts) → SessionInfo.branch undefined;
  // nama branch-nya diturunkan dari id sesi yang deterministik dari id spec (ADR-0015).
  // Sesi PRD/breakdown memang membawa `branch`. Keduanya harus terlindungi.
  const sessions = listSessions()
    .filter((s) => s.projectId === id && !s.exited)
    .map((s) => s.branch || (s.specId ? `hanoman/${s.id}` : ""))
    .filter(Boolean);
  return {
    openSpecBranches: new Set(open.map((s) => sourceBranch(s.id))),
    sessionBranches: new Set(sessions),
  };
}
```

Tambahkan dua route setelah route `/git/drop`, sebelum penutup `}` fungsi plugin:

```ts
  // SPEC-360 · ADR-0077 · daftar branch yang sudah ter-merge ke base + alasan kunci per branch.
  // Read murni turunan git (ADR-0018) — tak digerbang sesi aktif.
  app.get("/projects/:id/branches/unused", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { base } = req.query as { base?: string };
    return listUnusedBranches(repoDir, { base, ...(await lockInputs(id)) });
  });

  // SPEC-360 · ADR-0077 · hapus batch. TAK memakai gerbang sesi-aktif global (touchesTree):
  // delete-branch adalah op ref-only (ADR-0055) dan pagarnya sudah per-branch & lebih tepat.
  // Selalu 200 bila body sah — kegagalan hidup di baris `results`, bukan di status HTTP.
  app.post("/projects/:id/branches/delete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { names?: unknown; scope?: unknown; base?: unknown };
    if (!Array.isArray(b?.names) || b.names.some((n) => typeof n !== "string" || !n))
      return reply.code(400).send({ error: "names wajib berisi nama branch" });
    if (b.scope !== undefined && b.scope !== "local" && b.scope !== "remote" && b.scope !== "both")
      return reply.code(400).send({ error: "scope harus local, remote, atau both" });
    return deleteBranches(repoDir, b.names as string[], {
      scope: (b.scope as BranchScope | undefined) ?? "both",
      base: typeof b.base === "string" && b.base ? b.base : undefined,
      ...(await lockInputs(id)),
    });
  });
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism server/test/ide.route.test.ts server/test/agent-capabilities.test.ts server/test/branch-cleanup.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/api.ts server/src/routes/ide.ts server/test/ide.route.test.ts server/test/agent-capabilities.test.ts
git commit -m "feat(spec-360): route GET /branches/unused + POST /branches/delete"
```

---

### Task 4: Klien API — tipe DTO + dua metode

**Files:**
- Modify: `src/src/api/client.ts`
- Create: `src/test/branch-cleanup-client.test.ts`

**Interfaces:**
- Consumes: `paths.branchesUnused`, `paths.branchesDelete` (Task 3).
- Produces:
  ```ts
  export type BranchLock = "current" | "base" | "worktree" | "spec-open" | "session";
  export type BranchScope = "local" | "remote" | "both";
  export type UnusedBranch = { name: string; local: boolean; remote: boolean;
    lastCommit: { sha: string; at: string; subject: string } | null; locks: BranchLock[] };
  export type UnusedReport = { base: string; baseRemote: string | null; current: string; branches: UnusedBranch[] };
  export type BranchDeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; error?: string };
  export const LOCK_LABEL: Record<BranchLock, string>;
  api.branchesUnused(id: string, base?: string): Promise<UnusedReport>;
  api.deleteBranches(id: string, b: { names: string[]; scope?: BranchScope; base?: string }):
    Promise<{ base: string; results: BranchDeleteResult[] }>;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/branch-cleanup-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { api, LOCK_LABEL } from "../src/api/client";

// j() di client.ts: fetch → cek res.ok → res.json(). Mock cukup memenuhi tiga hal itu.
const mockFetch = (data: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, status: 200, json: async () => data,
  } as unknown as Response);

afterEach(() => vi.restoreAllMocks());

describe("api branch cleanup (SPEC-360)", () => {
  it("branchesUnused memanggil path yang benar", async () => {
    const f = mockFetch({ base: "main", baseRemote: "origin/main", current: "main", branches: [] });
    await api.branchesUnused("p1");
    expect(String(f.mock.calls[0]![0])).toContain("/api/projects/p1/branches/unused");
  });

  it("branchesUnused meneruskan base sebagai query", async () => {
    const f = mockFetch({ base: "dev", baseRemote: null, current: "main", branches: [] });
    await api.branchesUnused("p1", "dev");
    expect(String(f.mock.calls[0]![0])).toContain("base=dev");
  });

  it("deleteBranches POST dengan names & scope", async () => {
    const f = mockFetch({ base: "main", results: [] });
    await api.deleteBranches("p1", { names: ["hanoman/x"], scope: "local" });
    expect(String(f.mock.calls[0]![0])).toContain("/api/projects/p1/branches/delete");
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ names: ["hanoman/x"], scope: "local" });
  });

  it("LOCK_LABEL punya prosa untuk tiap kunci", () => {
    for (const k of ["current", "base", "worktree", "spec-open", "session"] as const) {
      expect(LOCK_LABEL[k]).toMatch(/\S/);
    }
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV npx vitest run --no-file-parallelism src/test/branch-cleanup-client.test.ts
```
Expected: FAIL — `api.branchesUnused is not a function`.

- [ ] **Step 3: Implementasi di `src/src/api/client.ts`**

Tambahkan tipe di dekat `export type GitOpResult` (blok tipe git yang sudah ada):

```ts
// SPEC-360 · ADR-0077 · branch ter-merge & hapus batch. Cermin server/src/services/branch-cleanup.ts.
export type BranchLock = "current" | "base" | "worktree" | "spec-open" | "session";
export type BranchScope = "local" | "remote" | "both";
export type UnusedBranch = {
  name: string; local: boolean; remote: boolean;
  lastCommit: { sha: string; at: string; subject: string } | null;
  locks: BranchLock[];
};
export type UnusedReport = { base: string; baseRemote: string | null; current: string; branches: UnusedBranch[] };
export type BranchDeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; error?: string };

// Label badge kunci di UI — versi ringkas LOCK_REASON server (badge sempit, prosa panjang di error).
export const LOCK_LABEL: Record<BranchLock, string> = {
  current: "branch aktif",
  base: "base",
  worktree: "dipakai worktree",
  "spec-open": "backlog belum selesai",
  session: "sesi aktif",
};
```

Tambahkan dua metode di objek `api`, tepat setelah `ideGitDrop`:

```ts
  // SPEC-360 · ADR-0077 · daftar branch ter-merge + hapus batch (local/origin).
  branchesUnused: (id: string, base?: string) => j<UnusedReport>(paths.branchesUnused(id, base)),
  deleteBranches: (id: string, b: { names: string[]; scope?: BranchScope; base?: string }) =>
    j<{ base: string; results: BranchDeleteResult[] }>(paths.branchesDelete(id), { method: "POST", ...body(b) }),
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV npx vitest run --no-file-parallelism src/test/branch-cleanup-client.test.ts
```
Expected: PASS — 4 test hijau.

- [ ] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/test/branch-cleanup-client.test.ts
git commit -m "feat(spec-360): klien api branchesUnused + deleteBranches"
```

---

### Task 5: Komponen `BranchesPanel`

**Files:**
- Create: `src/src/screens/BranchesPanel.tsx`
- Create: `src/test/branches-panel.test.tsx`

**Interfaces:**
- Consumes: `api.branchesUnused`, `api.deleteBranches`, `api.listBranches`, `LOCK_LABEL`, tipe `UnusedBranch`/`UnusedReport`/`BranchScope`/`BranchDeleteResult` (Task 4); `Card`, `Button`, `Badge`, `Select`, `Checkbox`, `StateBlock`, `ConfirmDialog` dari `../ds`.
- Produces: `export function BranchesPanel({ projectId }: { projectId: string })`

**Dua jebakan test yang sudah diperiksa di kode DS — tangani sejak awal:**
1. `Checkbox` **bukan** `<input type="checkbox">`; ia `<label>` + `<span>` yang menangani klik sendiri. `getByRole("checkbox")` dan `getByLabelText` **tak akan menemukannya** (pelajaran SPEC-299). Props sisa di-spread ke `<label>`, jadi pakai `data-testid`. `Select` men-spread props sisa ke `<select>` di dalamnya ✓, `Button` ke `<button>` ✓.
2. Tombol hapus per baris berlabel "Hapus" — **sama** dengan `confirmLabel` default `ConfirmDialog`. Query `getByRole("button", { name: /hapus/i })` akan ambigu. Karena itu dialog memakai `confirmLabel="Ya, hapus"`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/branches-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BranchesPanel } from "../src/screens/BranchesPanel";
import { api, type UnusedReport } from "../src/api/client";

const report = (over: Partial<UnusedReport> = {}): UnusedReport => ({
  base: "main", baseRemote: "origin/main", current: "main",
  branches: [
    { name: "main", local: true, remote: true, lastCommit: { sha: "aaa1111", at: "2026-07-20T10:00:00Z", subject: "init" }, locks: ["current", "base"] },
    { name: "hanoman/spec-1", local: true, remote: true, lastCommit: { sha: "bbb2222", at: "2026-07-21T10:00:00Z", subject: "feat: satu" }, locks: [] },
    { name: "hanoman/spec-2", local: true, remote: false, lastCommit: { sha: "ccc3333", at: "2026-07-22T10:00:00Z", subject: "feat: dua" }, locks: [] },
    { name: "hanoman/spec-3", local: true, remote: true, lastCommit: null, locks: ["session"] },
  ],
  ...over,
});
const confirm = async () => fireEvent.click(await screen.findByRole("button", { name: /ya, hapus/i }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "branchesUnused").mockResolvedValue(report());
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main", "dev"], remotes: ["main"] });
});

describe("BranchesPanel", () => {
  it("menampilkan tiap branch ter-merge", async () => {
    render(<BranchesPanel projectId="p1" />);
    expect(await screen.findByText("hanoman/spec-1")).toBeInTheDocument();
    expect(screen.getByText("hanoman/spec-2")).toBeInTheDocument();
  });

  it("baris terkunci menampilkan alasannya & tak bisa dipilih", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-3");
    expect(screen.getByText(/sesi aktif/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pick-hanoman/spec-3"));
    expect(screen.getByTestId("bulk-delete")).toBeDisabled();
  });

  it("pilih semua hanya mencentang yang boleh dihapus", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.click(screen.getByTestId("pick-all"));
    // spec-1 & spec-2 saja — bukan main (base+current) maupun spec-3 (session)
    expect(screen.getByTestId("bulk-delete")).toHaveTextContent("2");
  });

  it("tombol hapus per baris memanggil api dengan satu nama", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main", results: [{ name: "hanoman/spec-1", ok: true, scope: "both" }] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.click(screen.getByTestId("row-delete-hanoman/spec-1"));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", { names: ["hanoman/spec-1"], scope: "both" }));
  });

  it("bulk mengirim semua nama terpilih dalam SATU panggilan", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main",
      results: [{ name: "hanoman/spec-1", ok: true, scope: "both" }, { name: "hanoman/spec-2", ok: true, scope: "local" }] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.click(screen.getByTestId("pick-all"));
    fireEvent.click(screen.getByTestId("bulk-delete"));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del.mock.calls[0]![1]).toEqual({ names: ["hanoman/spec-1", "hanoman/spec-2"], scope: "both" });
  });

  it("scope diteruskan ke api", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({ base: "main", results: [] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.change(screen.getByTestId("scope"), { target: { value: "local" } });
    fireEvent.click(screen.getByTestId("pick-hanoman/spec-1"));
    fireEvent.click(screen.getByTestId("bulk-delete"));
    await confirm();
    await waitFor(() => expect(del.mock.calls[0]![1]).toMatchObject({ scope: "local" }));
  });

  it("ganti base memuat ulang laporan", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.change(screen.getByTestId("base"), { target: { value: "dev" } });
    await waitFor(() => expect(api.branchesUnused).toHaveBeenCalledWith("p1", "dev"));
  });

  it("hasil gagal ditampilkan apa adanya", async () => {
    vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main",
      results: [{ name: "hanoman/spec-1", ok: false, scope: "none", error: "terkunci: sesi aktif memakainya" }] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.click(screen.getByTestId("row-delete-hanoman/spec-1"));
    await confirm();
    expect(await screen.findByText(/terkunci: sesi aktif memakainya/)).toBeInTheDocument();
  });

  it("tanpa branch ter-merge → state kosong", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({ branches: [] }));
    render(<BranchesPanel projectId="p1" />);
    expect(await screen.findByText(/tak ada branch ter-merge/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV npx vitest run --no-file-parallelism src/test/branches-panel.test.tsx
```
Expected: FAIL — `Failed to resolve import "../src/screens/BranchesPanel"`.

- [ ] **Step 3: Implementasi `src/src/screens/BranchesPanel.tsx`**

```tsx
/* SPEC-360 · ADR-0077 — panel branch tak terpakai: branch yang sudah ter-merge ke base, dengan
   satu tombol hapus per baris + bulk, mencakup local & origin. Komponen sendiri (bukan tambahan
   ke GitGraph.tsx yang sudah 43 KB). Seluruh data turunan git dari server — tak ada state persist. */
import React from "react";
import { Card, Button, Badge, Select, Checkbox, StateBlock, ConfirmDialog } from "../ds";
import { api, LOCK_LABEL, type UnusedBranch, type UnusedReport, type BranchScope, type BranchDeleteResult } from "../api/client";

const SCOPES: { value: BranchScope; label: string }[] = [
  { value: "both", label: "local + origin" },
  { value: "local", label: "local saja" },
  { value: "remote", label: "origin saja" },
];

const rel = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}j`;
  if (s < 2592000) return `${Math.floor(s / 86400)}h`;
  return new Date(iso).toLocaleDateString();
};

const deletable = (b: UnusedBranch) => b.locks.length === 0;

export function BranchesPanel({ projectId }: { projectId: string }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [report, setReport] = React.useState<UnusedReport | null>(null);
  const [bases, setBases] = React.useState<string[]>([]);
  const [base, setBase] = React.useState("");
  const [scope, setScope] = React.useState<BranchScope>("both");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<BranchDeleteResult[] | null>(null);

  const load = React.useCallback(() => {
    setState("loading");
    api.branchesUnused(projectId, base || undefined)
      .then((r) => { setReport(r); setPicked(new Set()); setState("ready"); })
      .catch(() => setState("error"));
  }, [projectId, base]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    api.listBranches(projectId)
      .then((r) => setBases([...new Set([...r.branches, ...r.remotes])].sort()))
      .catch(() => setBases([]));
  }, [projectId]);

  const branches = report?.branches ?? [];
  const free = React.useMemo(() => branches.filter(deletable).map((b) => b.name), [branches]);
  const allPicked = free.length > 0 && free.every((n) => picked.has(n));

  const toggle = (name: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const toggleAll = () => setPicked(allPicked ? new Set<string>() : new Set(free));

  // Urutan mengikuti daftar server supaya `names` deterministik (dan enak di-assert).
  const pickedNames = branches.filter((b) => picked.has(b.name)).map((b) => b.name);

  const run = () => {
    const names = pending;
    if (!names) return;
    setBusy(true);
    api.deleteBranches(projectId, { names, scope })
      .then((r) => { setResults(r.results); setPending(null); load(); })
      .catch((e: Error) => {
        setResults(names.map((n) => ({ name: n, ok: false, scope: "none" as const, error: e.message })));
        setPending(null);
      })
      .finally(() => setBusy(false));
  };

  const failed = (results ?? []).filter((r) => !r.ok);
  const okCount = (results ?? []).length - failed.length;
  const scopeLabel = SCOPES.find((s) => s.value === scope)!.label;

  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
        <span className="hn-eyebrow" style={{ flex: 1 }}>
          branch ter-merge{report?.base ? ` ke ${report.base}` : ""}
        </span>
        <Select size="sm" data-testid="base" value={base} onChange={(e) => setBase(e.target.value)}
          options={[{ value: "", label: `base otomatis${report?.base ? ` (${report.base})` : ""}` },
            ...bases.map((b) => ({ value: b, label: b }))]} />
        <Select size="sm" data-testid="scope" value={scope}
          onChange={(e) => setScope(e.target.value as BranchScope)} options={SCOPES} />
        <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={load}>Muat ulang</Button>
        <Button size="sm" variant="primary" leftIcon="trash-2" data-testid="bulk-delete"
          disabled={pickedNames.length === 0} onClick={() => setPending(pickedNames)}>
          Hapus terpilih ({pickedNames.length})
        </Button>
      </div>

      {results && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)", fontSize: 12.5 }}>
          <div style={{ color: "var(--text-strong)" }}>{okCount} terhapus · {failed.length} gagal</div>
          {failed.map((f) => (
            <div key={f.name} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {f.name} — {f.error ?? "gagal"}
            </div>
          ))}
        </div>
      )}

      {state === "loading" ? <StateBlock kind="loading" title="Memuat branch…" />
        : state === "error" ? <StateBlock kind="error" title="Gagal memuat branch" action={load} />
        : branches.length === 0 ? <StateBlock kind="empty" icon="git-branch" title="Tak ada branch ter-merge"
            hint="Branch muncul di sini setelah ter-merge ke base." />
        : (
          <div style={{ maxHeight: 620, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
              borderBottom: "1px solid var(--border-hair)" }}>
              <Checkbox data-testid="pick-all" checked={allPicked} onChange={toggleAll}
                disabled={free.length === 0} label={`Pilih semua yang boleh (${free.length})`} />
            </div>
            {branches.map((b) => (
              <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                borderBottom: "1px solid var(--border-hair)" }}>
                <Checkbox data-testid={`pick-${b.name}`} checked={picked.has(b.name)}
                  disabled={!deletable(b)} onChange={() => toggle(b.name)} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", flex: 1 }}>
                  {b.name}
                </span>
                <Badge size="sm" tone="brass">{b.local && b.remote ? "local + origin" : b.local ? "local" : "origin"}</Badge>
                {b.locks.map((l) => <Badge key={l} size="sm" tone="warn">{LOCK_LABEL[l]}</Badge>)}
                <span style={{ fontSize: 11.5, color: "var(--text-subtle)", minWidth: 200, textAlign: "right" }}>
                  {b.lastCommit ? `${b.lastCommit.subject} · ${rel(b.lastCommit.at)}` : "—"}
                </span>
                <Button size="sm" variant="ghost" leftIcon="trash-2" data-testid={`row-delete-${b.name}`}
                  disabled={!deletable(b)} onClick={() => setPending([b.name])}>Hapus</Button>
              </div>
            ))}
          </div>
        )}

      {/* confirmLabel BUKAN "Hapus": tombol per baris sudah memakai label itu → query test ambigu. */}
      <ConfirmDialog
        open={pending !== null} busy={busy} eyebrow="branch" title="Hapus branch?"
        confirmLabel="Ya, hapus"
        message={pending ? `${pending.length} branch akan dihapus (${scopeLabel}). Tindakan ini tak bisa dibatalkan.` : ""}
        onConfirm={run} onCancel={() => setPending(null)} />
    </Card>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV npx vitest run --no-file-parallelism src/test/branches-panel.test.tsx
```
Expected: PASS — 9 test hijau.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/BranchesPanel.tsx src/test/branches-panel.test.tsx
git commit -m "feat(spec-360): panel Branches — tabel ter-merge, hapus per baris + bulk"
```

---

### Task 6: Tab "Branches" di IDE Visual

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx` (baris `Tabs` ~216; blok render `tab === "explorer" ? … : …` ~220-318)
- Modify: `src/test/ide-screen.test.tsx`

**Interfaces:**
- Consumes: `BranchesPanel` (Task 5).
- Produces: tab value `"branches"` di `IdeScreen`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan `describe` baru di akhir `src/test/ide-screen.test.tsx`:

```tsx
describe("IdeScreen tab Branches (SPEC-360)", () => {
  it("tab Branches merender panel branch ter-merge", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue({
      base: "main", baseRemote: "origin/main", current: "main",
      branches: [{ name: "hanoman/spec-9", local: true, remote: true, lastCommit: null, locks: [] }],
    });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /branches/i }));
    expect(await screen.findByText("hanoman/spec-9")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV npx vitest run --no-file-parallelism src/test/ide-screen.test.tsx
```
Expected: FAIL — tak ada tombol/tab bernama "Branches".

- [ ] **Step 3: Ubah `IdeScreen.tsx`**

Tambahkan impor di dekat `import { GitGraph } from "./GitGraph";`:

```tsx
import { BranchesPanel } from "./BranchesPanel";
```

Ganti baris `Tabs`:

```tsx
        <Tabs tabs={[{ value: "explorer", label: "Explorer" }, { value: "graph", label: "Git Graph" },
          { value: "branches", label: "Branches" }]} value={tab} onChange={setTab} />
```

Ganti penutup blok render — yang sekarang `) : (` + `<GitGraph … />` + `)}` — menjadi:

```tsx
      ) : tab === "graph" ? (
        <GitGraph projectId={projectId} onRunGit={runGit} onMerge={mergeGraph}
          onRebase={(onto) => graphIsolated("rebase", onto)} onPull={(src) => graphIsolated("pull", src)} onDrop={(sha) => graphIsolated("drop", sha)}
          onOpenFile={(p, ref) => { setViewRef(ref); selectFile(p); setTab("explorer"); }} />
      ) : (
        /* SPEC-360 · ADR-0077 · bersihkan branch yang sudah ter-merge ke branch utamanya. */
        <BranchesPanel projectId={projectId} />
      )}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV npx vitest run --no-file-parallelism src/test/ide-screen.test.tsx src/test/branches-panel.test.tsx
```
Expected: PASS — seluruh test IdeScreen lama tetap hijau + tab baru hijau.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/IdeScreen.tsx src/test/ide-screen.test.tsx
git commit -m "feat(spec-360): tab Branches di IDE Visual"
```

---

### Task 7: Docs Source of Truth (ADR-0077 + kontrak + index + skill)

**Files:**
- Create: `internal/docs/adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md`
- Modify: `internal/docs/README.md` (bagian `## adr`, jadi baris pertama daftar)
- Modify: `internal/docs/architecture/api-contract.md` (blok `### Git graph parity`)
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian IDE Visual)
- Modify: `internal/skills/hanoman/SKILL.md` (bagian "Aturan Arsitektur")

**Interfaces:**
- Consumes: perilaku final Task 1–6. Tak ada kode.

- [ ] **Step 1: Tulis ADR-0077**

Buat `internal/docs/adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md`:

```markdown
# ADR-0077 — Hapus branch tak terpakai: daftar ter-merge turunan + pagar proteksi per-branch

- **Status:** Accepted (SPEC-360)
- **Memperluas:** ADR-0055 (taksonomi operasi git berlapis)
- **Terkait:** ADR-0018/0011 (nilai turunan, bukan kolom DB) · ADR-0002 (isolasi worktree, sesi detach) · ADR-0032 (branch adalah properti backlog item) · ADR-0037 (guardrail dicabut) · ADR-0065 (capability agent)

## Konteks

`POST /projects/:id/git { op:"delete-branch" }` sudah ada sejak SPEC-206 dan bisa menghapus branch
local, origin, atau keduanya. Yang tak ada: cara **menemukan** branch mana yang sudah selesai masa
pakainya, dan cara menghapus **banyak sekaligus**. Repo hanoman sendiri menumpuk puluhan branch
`hanoman/spec-*` yang sudah masuk `main` dan tak pernah dibersihkan; satu-satunya jalan adalah
klik-kanan pill branch di Git Graph, satu per satu, dua kali (local lalu origin).

Sekaligus ada lubang keselamatan: `delete-branch` polos meneruskan apa pun ke git. `git branch -d`
menolak branch yang ter-checkout, tapi **tidak** tahu bahwa `origin/hanoman/spec-360` sedang jadi
target sesi tmux yang berjalan — sesi hanoman lahir `--detach` (ADR-0002), jadi tak ada ref lokal
yang bisa dilihat git sampai agen mem-push.

## Keputusan

**1. Daftar branch tak terpakai adalah nilai turunan, bukan kolom.**
`GET /projects/:id/branches/unused` menurunkan daftarnya langsung dari git tiap request
(`git branch --merged`), sejalan ADR-0018/0011. Tanpa tabel, tanpa cache, tanpa migration.
Kriterianya **murni git: ter-merge ke base** — bukan umur, bukan stage backlog. `base` ditentukan
`opts.base → main → master → branch aktif`; **tak pernah** hardcode `"main"` (pelajaran SPEC-227).
Untuk ref origin, base pembandingnya `origin/<base>` — "branch utama"-nya sebuah ref origin adalah
`origin/main`, bukan `main` lokal yang bisa tertinggal.

**2. Lima kunci proteksi per-branch, ditegakkan di jalur tulis.**
`current` · `base` · `worktree` (ter-checkout di worktree lain) · `spec-open` (Spec-nya belum
`done`) · `session` (sesi tmux aktif memakainya). Kunci `session` **wajib** terpisah dari
`worktree` justru karena sesi lahir detached: `git worktree list` tak menyebut branch apa pun
untuk sesi yang sedang berjalan.

`POST /projects/:id/branches/delete` menurunkan ulang daftar yang sama sebelum menghapus, lalu
memvalidasi tiap nama terhadapnya. Akibatnya tiga invarian gratis: hanya branch ter-merge yang
bisa dihapus (nama sembarang di body ditolak); kunci bukan sekadar petunjuk UI; dan scope
menyempit per branch (minta `both` pada branch tanpa ref origin → jalankan `local` saja).

**3. Ini pagar keselamatan data, BUKAN guardrail eksekusi.**
ADR-0037 mencabut guardrail perintah dan tetap berlaku: agen boleh menjalankan `git branch -D` apa
pun lewat terminal, dan context-menu Git Graph tetap menyediakan hapus paksa. Yang dipagari di sini
hanyalah **satu endpoint bulk** yang dirancang untuk diklik cepat pada banyak baris sekaligus — di
sanalah kesalahan tak bisa dibatalkan menjadi murah. Pagar ini tidak mengurangi kewenangan siapa
pun; ia hanya menolak melakukan hal berbahaya **atas nama** operator dalam satu klik. Karena itu
pula tak ada `--force`: bila sesuatu belum ter-merge, ia bukan urusan endpoint ini.

**4. Gerbang sesi-aktif global sengaja TIDAK dipakai.**
Hapus branch adalah op ref-only (ADR-0055), jadi ia lolos `touchesTree`. Menggantinya dengan kunci
per-branch justru lebih tepat: yang dilindungi adalah branch yang benar-benar dipakai, bukan
seluruh project setiap kali ada sesi apa pun berjalan.

**5. Eksekusi didelegasikan ke `runGitOp`, bukan implementasi kedua.**
Layer batch hanya menemukan, memvalidasi, dan mempersempit scope; penghapusannya tetap lewat
`delete-branch` SPEC-206. Satu jalur hapus branch di seluruh codebase.

**6. Capability agent tetap di domain `projects`.**
`branches` sengaja bukan anggota `IDE_SUBS`: `GET /projects/:id/branches` yang lama sudah memetakan
ke `projects:read`, dan memindahkannya akan diam-diam mengubah capability endpoint yang sudah
dipakai. Dikunci satu test agar jadi keputusan, bukan kebetulan.

## Konsekuensi

- Tak ada perubahan skema, tak ada migration. Semua turunan.
- Branch yang di-**squash**-merge lewat PR GitHub **tidak** terdeteksi (`--merged` bekerja pada
  ancestry, bukan patch-id). hanoman melakukan merge sungguhan lewat `integrateBranch`/
  `mergeIntoCurrent`, jadi jalur internalnya tertangkap. Deteksi patch-id (`git cherry`) bisa
  menyusul di spec terpisah bila dibutuhkan.
- Bila `main` lokal tertinggal dari `origin/main`, daftar local menyusut (konservatif —
  menyembunyikan, bukan salah menghapus). Operator menekan **Fetch** di toolbar IDE lalu memuat ulang.
- `base` yang bisa dipilih membuat fitur ini berguna di repo ber-default `master`/`develop` dan untuk
  membersihkan branch fitur yang ter-merge ke branch rilis, bukan hanya `main`.
- Dua bentuk keluaran git yang wajib disaring dan mudah terlewat (keduanya terverifikasi, bukan
  dugaan): `git branch --merged --format` memancarkan baris `(no branch)` di worktree **detached**
  (yaitu setiap sesi hanoman), dan git memendekkan `origin/HEAD` menjadi bare `origin`.
```

- [ ] **Step 2: Tautkan ADR di index**

Di `internal/docs/README.md`, sisipkan sebagai baris **pertama** daftar di bawah `## adr`
(tepat sebelum baris `- [0076 — …`):

```markdown
- [0077 — Hapus branch tak terpakai: daftar ter-merge turunan + pagar proteksi per-branch](adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md) — **memperluas 0055**, terkait 0018/0011/0002/0032/0037/0065 (SPEC-360): `GET /projects/:id/branches/unused` menurunkan daftar branch ter-merge langsung dari git (`git branch --merged`, base `?base=→main→master→branch aktif`, ref origin dibanding `origin/<base>`) — tanpa kolom DB, tanpa migration; lima kunci proteksi per-branch (`current`/`base`/`worktree`/`spec-open`/`session` — `session` terpisah karena sesi lahir `--detach` sehingga tak muncul di `git worktree list`) **ditegakkan ulang di jalur tulis** `POST /projects/:id/branches/delete`, sehingga hanya branch ter-merge & tak terkunci yang bisa dihapus dan scope menyempit per branch; eksekusi tetap lewat `runGitOp` `delete-branch` (SPEC-206) tanpa `--force`. Pagar ini **keselamatan data untuk satu endpoint bulk**, bukan guardrail eksekusi — ADR-0037 utuh. Dua keluaran git yang wajib disaring: baris `(no branch)` di worktree detached, dan `origin/HEAD` yang dipendekkan jadi bare `origin`
```

- [ ] **Step 3: Perbarui kontrak API**

Di `internal/docs/architecture/api-contract.md`, di dalam blok kode `### Git graph parity`,
tambahkan tepat sebelum baris `# Isolasi (merge/rebase/pull/drop): …`:

```
# Bersihkan branch tak terpakai (SPEC-360 · ADR-0077) — nilai turunan git, tanpa kolom DB
GET  /projects/:id/branches/unused?base=   # { base, baseRemote, current, branches:[{name,local,remote,lastCommit:{sha,at,subject}|null,locks[]}] }
#   Isi daftar = HANYA branch ter-merge ke base (git branch --merged); ref origin dibanding origin/<base>.
#   base: ?base= → main → master → branch aktif → "HEAD". TAK PERNAH hardcode "main" (SPEC-227).
#   base di-resolve ke SHA sebelum diberikan ke --merged: `--end-of-options` TAK bisa dipakai di sana
#   (git menelannya sebagai nilai --merged). Hex tak pernah terbaca sebagai flag (ADR-0032).
#   locks ∈ current|base|worktree|spec-open|session — kosong = boleh dihapus. base & current ikut tampil (terkunci).
#   `session` terpisah dari `worktree` karena sesi lahir --detach (ADR-0002) → tak muncul di `git worktree list`.
#   Disaring: baris `(no branch)` (muncul saat dijalankan di worktree detached) & `origin/HEAD` (git memendekkannya jadi bare `origin`).
#   404 project tak ada; tanpa repoDir/bukan repo → { base:"", baseRemote:null, current:"", branches:[] }.
POST /projects/:id/branches/delete  { names:string[], scope?, base? }   # { base, results:[{name,ok,scope,error?}] }
#   scope ∈ local|remote|both (default both); menyempit per branch mengikuti ref yang benar-benar ada.
#   Menurunkan ulang daftar unused lalu memvalidasi tiap nama: di luar daftar / terkunci → baris ok:false.
#   Selalu 200 bila body sah — kegagalan hidup di baris results, bukan status HTTP. TAK PERNAH pakai -D/force.
#   TAK digerbang sesi aktif global (op ref-only, ADR-0055); pagarnya per-branch. 400 names/scope cacat, tanpa repoDir.
#   Capability agent: keduanya di domain `projects` (projects:read/write), BUKAN `ide` — cermin GET /branches lama.
```

- [ ] **Step 4: Perbarui docs frontend & skill project**

Di `internal/docs/frontend/frontend-implementation.md`, pada bagian yang menjelaskan IDE Visual,
tambahkan:

```markdown
**Tab Branches** (SPEC-360 · ADR-0077) — tab ketiga IDE Visual di samping Explorer & Git Graph.
`BranchesPanel.tsx` (komponen sendiri; `GitGraph.tsx` sudah terlalu besar untuk ditumpangi)
menampilkan branch yang sudah ter-merge ke base: checkbox bulk, badge `local`/`origin`, commit
terakhir, badge alasan untuk baris terkunci, satu tombol Hapus per baris, serta selector base &
scope (`local + origin` default). Baris terkunci tak bisa dicentang maupun dihapus. Konfirmasi
lewat `ConfirmDialog`; hasil dilaporkan per baris (`N terhapus · M gagal`) sehingga kegagalan
sebagian terlihat apa adanya. Dua catatan uji: `Checkbox` design system bukan
`<input type=checkbox>` (label + span), jadi test memakai `data-testid`, bukan
`getByRole("checkbox")`; dan `confirmLabel` dialog sengaja "Ya, hapus" karena tombol per baris
sudah memakai label "Hapus".
```

Di `internal/skills/hanoman/SKILL.md`, bagian **Aturan Arsitektur**, tambahkan satu butir:

```markdown
- **Bersihkan branch tak terpakai** (SPEC-360/ADR-0077): daftar branch ter-merge = **nilai turunan git**
  (`GET /projects/:id/branches/unused`, `git branch --merged`, base `?base=→main→master→branch aktif`,
  ref origin dibanding `origin/<base>` — jangan hardcode `"main"`; base di-resolve ke SHA dulu karena
  `--end-of-options` tak berlaku untuk argumen `--merged`). Lima kunci proteksi per-branch
  (`current`/`base`/`worktree`/`spec-open`/`session`) **ditegakkan ulang** di `POST …/branches/delete`,
  jadi klien tak bisa menyelundupkan branch lewat body; scope (`local`/`remote`/`both`) menyempit per
  branch. Eksekusi tetap lewat `runGitOp` `delete-branch` (SPEC-206) — satu jalur, **tanpa `-D`/force**.
  Kunci `session` terpisah dari `worktree` karena sesi lahir `--detach` (ADR-0002). **Gotcha keluaran git:**
  `git branch --merged --format` memancarkan baris `(no branch)` di worktree detached, dan `origin/HEAD`
  dipendekkan git jadi bare `origin` — saring keduanya (cermin `services/branches.ts`). Ini pagar
  keselamatan data untuk satu endpoint bulk, **bukan** guardrail eksekusi — ADR-0037 tetap utuh.
```

- [ ] **Step 5: Verifikasi index & commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(spec-360): ADR-0077 + kontrak branches/unused & branches/delete + skill/frontend"
```

---

### Task 8: Verifikasi menyeluruh — suite penuh + smoke API nyata

**Files:** tak ada perubahan kode kecuali perbaikan yang ditemukan verifikasi.

**Interfaces:**
- Consumes: seluruh Task 1–7.
- Produces: bukti hijau (output test + output curl) sebelum menulis `Execute done`.

- [ ] **Step 1: Jalankan seluruh suite repo**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-360
env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism
```
Expected: seluruh test hijau. **Bila ada yang merah, perbaiki dulu — jangan lanjut.**
Bila `@prisma/client` tak resolve: `pnpm install` lalu
`npx prisma generate --schema server/prisma/schema.prisma` di worktree ini dulu.

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p server --noEmit && npx tsc -p src --noEmit && npx tsc -p shared --noEmit
```
Expected: exit 0, tanpa output.
**PENTING:** selalu `--noEmit`. Tanpa itu `tsc -p` menaburkan `.js`/`.d.ts` di `src/` & `test/`
dan mengotori diff (pelajaran SPEC-296/298).

- [ ] **Step 3: Siapkan DB & repo fixture untuk smoke**

DB khusus — **jangan** `hanoman_test` (sesi sibling bisa men-truncate di tengah smoke):

```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman360;' || true
export SMOKE_DB='postgresql://hanoman:hanoman@127.0.0.1:5433/hanoman360'
DATABASE_URL="$SMOKE_DB" npx prisma migrate deploy --schema server/prisma/schema.prisma
```

Repo fixture: satu branch ter-merge, satu belum:

```bash
export SMOKE=/private/tmp/claude-501/spec-360-smoke
rm -rf "$SMOKE" && mkdir -p "$SMOKE/origin" "$SMOKE/repo"
git init -q --bare -b main "$SMOKE/origin"
git init -q -b main "$SMOKE/repo"
git -C "$SMOKE/repo" config user.email t@t && git -C "$SMOKE/repo" config user.name t
git -C "$SMOKE/repo" remote add origin "$SMOKE/origin"
echo base > "$SMOKE/repo/file.txt"
git -C "$SMOKE/repo" add -A && git -C "$SMOKE/repo" commit -qm base
git -C "$SMOKE/repo" checkout -q -b hanoman/spec-999
echo work > "$SMOKE/repo/work.txt"
git -C "$SMOKE/repo" add -A && git -C "$SMOKE/repo" commit -qm work
git -C "$SMOKE/repo" checkout -q main
git -C "$SMOKE/repo" merge --no-ff --no-edit -q hanoman/spec-999
git -C "$SMOKE/repo" push -q origin main hanoman/spec-999
git -C "$SMOKE/repo" branch belum-merge          # ter-merge (di HEAD), local saja
git -C "$SMOKE/repo" branch sisa                  # akan dimajukan → TIDAK ter-merge
git -C "$SMOKE/repo" checkout -q sisa
git -C "$SMOKE/repo" commit -q --allow-empty -m "sisa maju"
git -C "$SMOKE/repo" checkout -q main
```

- [ ] **Step 4: Boot server, login, curl `unused`**

Port **9360** (jangan 8787 — ada sesi dev lain di sana dengan kode & DB berbeda).
Server prod **selalu** tergerbang auth (`buildApp()` default `requireAuth: true`, tak ada env
pematah), jadi smoke wajib `POST /api/auth/setup` lalu memakai cookie-nya:

```bash
npm --prefix server run build
DATABASE_URL="$SMOKE_DB" PORT=9360 node server/dist/server.js > /tmp/spec360-server.log 2>&1 &
sleep 3
JAR=/tmp/spec360-cookies.txt && rm -f "$JAR"
curl -s -c "$JAR" -X POST localhost:9360/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"smoke@local","password":"smoke-password-360"}'
CURL="curl -s -b $JAR -H content-type:application/json"
$CURL -X POST localhost:9360/api/projects \
  -d "{\"id\":\"smoke360\",\"name\":\"smoke\",\"kind\":\"existing\",\"repoDir\":\"$SMOKE/repo\"}"
echo; echo "--- unused ---"
$CURL "localhost:9360/api/projects/smoke360/branches/unused" | python3 -m json.tool
```

Expected pada output `unused`:
- `base` = `"main"`, `baseRemote` = `"origin/main"`, `current` = `"main"`
- baris `hanoman/spec-999` dengan `local:true, remote:true, locks:[]`
- baris `belum-merge` dengan `local:true, remote:false`
- baris `main` dengan `locks` memuat `"base"` **dan** `"current"`
- **tak ada** baris `sisa` (belum ter-merge), `origin`, maupun `(no branch)`

- [ ] **Step 5: Curl hapus — kasus tertolak lalu kasus berhasil**

```bash
echo "--- tolak: base/current ---"
$CURL -X POST localhost:9360/api/projects/smoke360/branches/delete \
  -d '{"names":["main"],"scope":"both"}' | python3 -m json.tool
echo "--- tolak: belum ter-merge ---"
$CURL -X POST localhost:9360/api/projects/smoke360/branches/delete \
  -d '{"names":["sisa"],"scope":"both"}' | python3 -m json.tool
echo "--- tolak: body cacat (harap 400) ---"
curl -s -b "$JAR" -o /dev/null -w '%{http_code}\n' -X POST \
  localhost:9360/api/projects/smoke360/branches/delete \
  -H 'content-type: application/json' -d '{"names":["x"],"scope":"semua"}'
echo "--- berhasil: bulk local+origin ---"
$CURL -X POST localhost:9360/api/projects/smoke360/branches/delete \
  -d '{"names":["hanoman/spec-999","belum-merge"],"scope":"both"}' | python3 -m json.tool
echo "--- verifikasi di git ---"
git -C "$SMOKE/repo" branch --format='%(refname:short)'
git -C "$SMOKE/repo" branch -r --format='%(refname:short)'
```

Expected:
- `main` → `ok:false` (terkunci base/current); `sisa` → `ok:false` ("tak ditemukan di daftar ter-merge")
- body cacat → `400`
- bulk → dua baris `ok:true` (`hanoman/spec-999` scope `both`, `belum-merge` scope menyempit ke `local`)
- `hanoman/spec-999` hilang dari **kedua** daftar git; `belum-merge` hilang dari daftar lokal
- `main` & `sisa` masih ada

- [ ] **Step 6: Bereskan smoke & pastikan diff bersih**

```bash
pkill -f 'server/dist/server.js' || true
rm -rf "$SMOKE" /tmp/spec360-cookies.txt /tmp/spec360-server.log
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'DROP DATABASE hanoman360;' || true
git status --short   # WAJIB bersih — tak boleh ada .js/.d.ts hasil tsc atau dist ter-stage
```

- [ ] **Step 7: Centang seluruh checklist plan, commit, push**

Pastikan setiap `- [ ]` di berkas plan ini sudah jadi `- [x]` (hanoman menahan backlog di
`executing` selama masih ada kotak kosong — ADR-0029), lalu:

```bash
git add docs/superpowers/plans/2026-07-28-hapus-branch-tak-terpakai-spec-360.md
git commit -m "chore(spec-360): centang plan — seluruh task selesai & terverifikasi"
git push origin HEAD:refs/heads/hanoman/spec-360
```
