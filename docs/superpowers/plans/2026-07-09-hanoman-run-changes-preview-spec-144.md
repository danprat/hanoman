# Runs menampilkan changes yang dibuat hanoman (SPEC-144) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layar Runs menampilkan seluruh perubahan yang dibuat hanoman pada run itu — daftar file, commit-commitnya, dan preview isi source-nya — realtime selagi run berjalan dan tetap terbaca setelah run selesai.

**Architecture:** Dua kolom penunjuk baru (`Run.baseSha`, `Run.headSha`) disimpan; isi diff **tidak pernah** disimpan, melainkan diturunkan dari git tiap request oleh `server/src/services/run-changes.ts`. Run yang masih hidup dibaca dari worktree-nya (lewat index sementara + `git add -A -N`, sehingga file baru terlihat); run yang sudah `done` dibaca dari object database (`baseSha..headSha`). Kolom `Run.files` dan event `kind: "file"` — yang tak pernah punya produsen — dibuang setelah pembacanya pindah.

**Tech Stack:** Node 20+, TypeScript 5 strict, Prisma/Postgres, Fastify, React 18 + Vite, Vitest, zod. Tanpa dependency runtime baru; semua lewat git bawaan.

**Spec:** [`docs/superpowers/specs/2026-07-09-hanoman-run-changes-preview-spec-144-design.md`]
**Objective:** [`internal/docs/operations/spec-144-run-changes-preview-objective.md`]

## Global Constraints

- **TypeScript strict. TDD:** test yang gagal dulu, implementasi minimal, hijau, commit. Commit setiap step hijau.
- **`git add -A` DILARANG di jalur baca.** Ia menghash isi dan menulis satu blob ke `.git/objects` untuk **setiap** file berubah, pada setiap `GET`. Pakai **`git add -A -N`** (intent-to-add): keluaran `--numstat`/`--name-status` identik, biayanya tepat satu object (blob kosong `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`) yang idempoten. Lihat *Amandemen 1* di objective.
- **`spawnSync` DILARANG di jalur request.** Pakai `promisify(execFile)` dengan `maxBuffer: 1 << 24`, persis `listRepoDocs` di `server/src/services/scan.ts:16`. Blocking fork menghentikan **seluruh proses**, bukan satu request. `services/branches.ts` (masih `spawnSync`) bukan preseden.
- **Index worktree tertaut BUKAN `.git/index`.** Di worktree tertaut `.git` adalah sebuah *file*. Satu-satunya jalan yang benar: `git rev-parse --git-path index`.
- **`git diff --numstat <base>` melewatkan file untracked** — tanpa error, tanpa baris. File baru adalah keluaran hanoman yang paling lazim. Ini regresi paling mungkin di seluruh plan ini; Task 3 Step 1 mengujinya lebih dulu.
- **Batas preview 256 KB**, satu konstanta `PREVIEW_LIMIT`. Memotong tanpa `truncated: true` tidak pernah boleh.
- **rtk mem-proxy `git` dan menormalkan exit code.** `git commit` tanpa staged changes tampak `exit=0` lewat proxy; nilai sebenarnya `1`. Saat mengasersi exit code atau `git log --grep` dari Bash, panggil `/usr/bin/git`.
- **`deniesDangerous` memblokir perintah Bash yang cocok `git worktree add`** (`runner/src/safety.ts:10`) — termasuk bila frasa itu muncul di dalam `git commit -m "…"`. Buat worktree tertaut **dari kode test** (`spawnSync`), bukan lewat Bash tool; kalau pesan commit harus memuat frasa itu, pakai `git commit -F <file>`.
- **Root `pnpm test` hanya menjalankan `shared`, `server`, `src`** (`vitest.workspace.ts`). Test `runner` dan `cli` **tidak ikut** — jalankan `pnpm --filter ./runner test` secara eksplisit.
- **Suite server WAJIB `--no-file-parallelism`:** `pnpm --filter ./server exec vitest run --no-file-parallelism`. Tanpa flag itu file test berebut satu DB dan ~4 test gagal acak. `queue-durability.test.ts` gagal bila diisolasi dan hijau di suite penuh — gate akhir selalu suite penuh.
- **`pnpm vitest run --project shared` tidak menemukan test.** Panggil berkasnya: `pnpm vitest run shared/test/entities.test.ts`.
- **Postgres jalan di Docker.** `psql -d hanoman` di unix socket gagal dan terlihat seperti DB mati. Pakai `docker exec hanoman-db-1 psql -U hanoman -d hanoman`.
- **JANGAN `prisma migrate dev`.** DB dev `hanoman` tak punya `_prisma_migrations` dan schema-nya menyimpang; `migrate dev` akan menawarkan **reset** dan menghapus project/spec/run nyata. Tulis migration dengan tangan, verifikasi lewat `prisma migrate diff … --script`, lalu `migrate deploy` ke DB test/smoke saja.
- **Nama direktori migration harus mengurut sesudah `20260709160000_drop_project_coverage`.** Prisma menerapkan migration berdasarkan urutan nama, dan `date -u` di mesin ini menghasilkan timestamp yang lebih kecil.
- **ADR berikutnya = `0019`.** `0018` sudah terpakai **dua kali** (`0018-coverage-nilai-turunan.md`, `0018-branch-adalah-properti-backlog-item.md`) — preseden yang tidak boleh diulang. Hitung ulang lintas branch sebelum mengklaim (Task 8 Step 1).
- **`cd` di dalam Bash bertahan antar perintah.** Selalu pakai path absolut atau `cd` kembali ke root worktree.
- **Jangan `git stash`, jangan `git add -A`** di repo ini — checkout ini dibagi dengan sesi lain.
- **Jangan `POST /runs` saat smoke lokal** kalau ada worker dev hidup — itu benar-benar mengeksekusi run background.
- Interval poll 5 detik, preview mengembalikan `diff` **dan** `content`, berkas biner tak dapat di-review: ketiganya **default yang belum dikonfirmasi manusia**. Bila ditolak sebelum Execute, hanya Task 4 dan Task 6 yang berubah.

## File Structure

```
server/prisma/schema.prisma                            modify — Run.baseSha, Run.headSha (T1); DROP files (T7)
server/prisma/migrations/20260709170000_run_base_head_sha/     new — ADD COLUMN ×2
server/prisma/migrations/20260709180000_drop_run_files/        new — DROP COLUMN files
shared/src/entities.ts                                 modify — zRun +baseSha/+headSha (T1); −files (T7)
shared/src/api.ts                                      modify — paths.runChanges, paths.runChangeFile
shared/test/entities.test.ts                           modify — skema Run baru
runner/src/types.ts                                    modify — GitOps return types; RunEvent +commit (T2); −file (T7)
runner/src/git.ts                                      modify — addWorktree/commitAndPush mengembalikan SHA
runner/src/run.ts                                      modify — pancarkan { kind: "commit" }
runner/test/git.test.ts                                modify — SHA yang dikembalikan
runner/test/run.test.ts                                modify — fake GitOps + urutan event
server/src/runner/events-io.ts                         modify — cabang "commit" (T2); buang cabang "file" (T7)
server/test/events-io.test.ts                          modify — baseSha tak pernah ditimpa
server/src/services/run-changes.ts                     new   — runChanges, runChangeFile, ChangesUnavailable
server/test/run-changes.test.ts                        new   — unit atas repo + worktree temp
server/src/routes/runs.ts                              modify — 2 route baru; verb files/diff pindah sumber
server/test/runs-changes.route.test.ts                 new   — route + kode status + gerbang path
server/test/runs-command.test.ts                       modify — verb diff merender changes nyata
server/src/queue.ts                                    modify — berhenti men-seed files: [] (T7)
server/test/factory.ts                                 modify — makeRun tanpa files (T7)
src/src/api/client.ts                                  modify — runChanges/runChangeFile; RunLiveEvent −file
src/src/screens/run-reduce.ts                          modify — buang case "file"
src/test/run-reduce.test.ts                            modify — fixture tanpa files
src/src/screens/RunsScreen.tsx                         modify — panel changes + preview + commits + poll
internal/docs/adr/0019-sha-disimpan-diff-diturunkan.md new   — ADR
internal/docs/README.md                                modify — link ADR
internal/docs/architecture/data-model.md               modify — kolom Run baru, files dibuang
internal/docs/architecture/api-contract.md             modify — 2 route baru
```

---

### Task 1: Kolom `Run.baseSha` + `Run.headSha`

**Files:**
- Modify: `server/prisma/schema.prisma` (`model Run`), `shared/src/entities.ts:31-42`
- Create: `server/prisma/migrations/20260709170000_run_base_head_sha/migration.sql`
- Test: `shared/test/entities.test.ts`

**Interfaces:**
- Produces: `zRun` bertambah `baseSha: string | null`, `headSha: string | null`. Kolom Prisma `baseSha String?`, `headSha String?`.

**Kenapa aditif dulu:** `Run.files` baru dibuang di Task 7, setelah semua pembacanya pindah. Membuang kolom lebih awal membuat `RunsScreen`, `run-reduce`, dan verb terminal gagal typecheck di tengah plan.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `shared/test/entities.test.ts`:

```ts
import { zRun } from "../src/index";

describe("SPEC-144 Run sha", () => {
  const base = {
    id: "RUN-1", projectId: "p1", specId: null, kind: "feature" as const, status: "running" as const,
    trigger: "manual" as const, triggerDetail: "", phases: [], plan: [], files: [], log: [],
    worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
    model: "", tokensIn: "0", tokensOut: "0", cost: "$0.00", progress: 0,
    createdAt: "2026-07-09T00:00:00.000Z", finishedAt: null,
  };
  it("menerima baseSha/headSha null", () => {
    const r = zRun.parse({ ...base, baseSha: null, headSha: null });
    expect(r.baseSha).toBeNull();
    expect(r.headSha).toBeNull();
  });
  it("menerima SHA", () => {
    const r = zRun.parse({ ...base, baseSha: "4e7f6d6", headSha: "db87a19" });
    expect(r.headSha).toBe("db87a19");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm vitest run shared/test/entities.test.ts`
Expected: FAIL — `baseSha` unrecognized / `undefined`.

- [ ] **Step 3: Implementasi minimal**

`server/prisma/schema.prisma` — di dalam `model Run`, tepat setelah `sessionId String?`:

```prisma
  sessionId     String?
  // SPEC-144 · penunjuk, bukan isi. Diff diturunkan; SHA tak dapat direkonstruksi
  // setelah worktree dan branch run dihapus. Lihat ADR-0019.
  baseSha       String?
  headSha       String?
```

`shared/src/entities.ts` — di dalam `zRun`, setelah `worktree: z.string(),`:

```ts
  worktree: z.string(), branchFrom: z.string(), branchTo: z.string(),
  baseSha: z.string().nullable(), headSha: z.string().nullable(),
```

- [ ] **Step 4: Buat migration** *(tanpa `migrate dev` — lihat Global Constraints)*

Pastikan Postgres hidup: `docker compose up -d --wait`

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/run-8804
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c 'CREATE DATABASE hanoman_shadow OWNER hanoman;' || true
pnpm --filter ./server exec prisma migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url 'postgresql://hanoman:hanoman@localhost:5432/hanoman_shadow' --script
```

Expected: tepat dua `ALTER TABLE "Run" ADD COLUMN … TEXT;` — tanpa `NOT NULL`, tanpa `DEFAULT`.

Tulis ke `server/prisma/migrations/20260709170000_run_base_head_sha/migration.sql`:

```sql
-- SPEC-144: penunjuk commit milik run. Nullable, tanpa backfill.
ALTER TABLE "Run" ADD COLUMN "baseSha" TEXT;
ALTER TABLE "Run" ADD COLUMN "headSha" TEXT;
```

Terapkan ke DB test saja:

```bash
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman_test' pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server exec prisma generate
```

- [ ] **Step 5: Jalankan test, pastikan hijau**

Run: `pnpm vitest run shared/test/entities.test.ts`
Expected: PASS.

Run: `pnpm --filter ./server exec vitest run --no-file-parallelism`
Expected: PASS — `zRun` yang lebih ketat tidak memecahkan route yang mengembalikan baris Run.

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260709170000_run_base_head_sha shared/src/entities.ts shared/test/entities.test.ts
git commit -m "feat(spec-144): kolom Run.baseSha + Run.headSha nullable"
```

---

### Task 2: `GitOps` menyerahkan SHA, `runOne` memancarkannya

**Files:**
- Modify: `runner/src/types.ts:32-38,55-61`, `runner/src/git.ts:25-56`, `runner/src/run.ts:35,111-113`, `server/src/runner/events-io.ts:47-68`
- Test: `runner/test/git.test.ts`, `runner/test/run.test.ts`, `server/test/events-io.test.ts`

**Interfaces:**
- Consumes: kolom dari Task 1.
- Produces:
  - `GitOps.addWorktree(repo, path, branchFrom, reuse?): string | undefined` — mengembalikan baseSha; `undefined` bila `reuse` memakai worktree yang sudah ada.
  - `GitOps.commitAndPush(worktreePath, message, branchTo, remoteUrl?): string` — mengembalikan headSha.
  - `RunEvent` bertambah `{ kind: "commit"; base?: string; head?: string }`.
  - `persistEvent` menulis `baseSha` **hanya bila masih null**.

**Kenapa `undefined` saat `reuse`:** pada run yang di-`resume`, `branchFrom` mungkin sudah bergerak. Basis yang benar adalah basis semula, yang sudah tersimpan di baris `Run`. Mengembalikan `resolveCommit(repo, branchFrom)` lagi akan menimpanya dengan commit yang salah.

- [ ] **Step 1: Tulis test yang gagal (runner)**

Tambahkan di `runner/test/git.test.ts`, di dalam `describe("git worktree ops")`:

```ts
  it("addWorktree mengembalikan baseSha, dan undefined saat reuse", () => {
    const { repo } = seedRepo();
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    const wt = join(repo, ".worktrees", "run-sha");
    expect(realGit.addWorktree(repo, wt, "main")).toBe(head);
    expect(realGit.addWorktree(repo, wt, "main", true)).toBeUndefined();  // reuse: pohon sudah ada
    realGit.removeWorktree(repo, wt);
  });

  it("commitAndPush mengembalikan headSha worktree", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-head");
    const base = realGit.addWorktree(repo, wt, "main")!;
    writeFileSync(join(wt, "baru.txt"), "isi\n");
    const head = realGit.commitAndPush(wt, "pesan", "hanoman/run-head");
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(head).not.toBe(base);
    realGit.removeWorktree(repo, wt);
  });
```

Tambahkan `writeFileSync` ke import `node:fs` di berkas itu bila belum ada.

Tambahkan di `runner/test/run.test.ts` — ubah `fakeDeps` lebih dulu, karena `vi.fn()` polos mengembalikan `undefined` dan `runOne` tak akan pernah memancarkan `base`:

```ts
const fakeDeps = (over: Partial<RunDeps> = {}): RunDeps => ({
  openSession: () => fakeSession(),
  git: {
    addWorktree: vi.fn().mockReturnValue("base00"),
    removeWorktree: vi.fn(),
    commitAndPush: vi.fn().mockReturnValue("head99"),
    switchBase: vi.fn(),
  },
  verify: () => ({ blocked: false }), ...over });
```

lalu tambahkan test:

```ts
  it("memancarkan base lalu head, dalam urutan itu", async () => {
    const events: any[] = [];
    await runOne(input(), fakeDeps(), (e) => events.push(e));
    const commits = events.filter((e) => e.kind === "commit");
    expect(commits).toEqual([{ kind: "commit", base: "base00" }, { kind: "commit", head: "head99" }]);
  });

  it("tidak memancarkan base saat addWorktree memakai ulang worktree", async () => {
    const d = fakeDeps();
    (d.git.addWorktree as any).mockReturnValue(undefined);
    const events: any[] = [];
    await runOne(input(), d, (e) => events.push(e));
    expect(events.filter((e) => e.kind === "commit" && e.base)).toEqual([]);
    expect(events.filter((e) => e.kind === "commit" && e.head)).toHaveLength(1);
  });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./runner test`
Expected: FAIL — `addWorktree` mengembalikan `undefined`; tak ada event `kind: "commit"`.

- [ ] **Step 3: Implementasi minimal**

`runner/src/types.ts` — tambahkan varian event (di atas `| { kind: "cost"; … }`):

```ts
  | { kind: "commit"; base?: string; head?: string }
```

dan ubah `GitOps`:

```ts
export interface GitOps {
  /** `reuse`: pakai worktree yang sudah ada apa adanya. Mengembalikan baseSha, atau undefined saat reuse. */
  addWorktree(repo: string, path: string, branchFrom: string, reuse?: boolean): string | undefined;
  removeWorktree(repo: string, path: string): void;
  /** Mengembalikan headSha — commit tip milik run ini. */
  commitAndPush(worktreePath: string, message: string, branchTo: string, remoteUrl?: string): string;
  switchBase(worktreePath: string, branchFrom: string): void;
}
```

`runner/src/git.ts`:

```ts
  addWorktree: (repo, path, branchFrom, reuse) => {
    if (reuse && existsSync(isAbsolute(path) ? path : resolve(repo, path))) return undefined;
    tryGit(repo, ["worktree", "remove", "--force", path]);
    tryGit(repo, ["worktree", "prune"]);
    rmSync(isAbsolute(path) ? path : resolve(repo, path), { recursive: true, force: true });
    const base = resolveCommit(repo, branchFrom);
    git(repo, ["worktree", "add", "--detach", path, base]);
    return base;
  },
```

dan di akhir `commitAndPush`, ganti kedua jalur `return`/akhir fungsi sehingga keduanya mengembalikan SHA:

```ts
  commitAndPush: (path, message, branchTo, remoteUrl) => {
    git(path, ["add", "-A"]); git(path, ["commit", "-m", message]);
    const head = git(path, ["rev-parse", "HEAD"]).trim();
    if (!remoteUrl && !hasRemote(path, "origin")) { git(path, ["branch", "-f", branchTo, "HEAD"]); return head; }
    git(path, ["push", remoteUrl ?? "origin", `HEAD:refs/heads/${branchTo}`], remoteUrl);
    return head;
  },
```

`runner/src/run.ts` — baris 35:

```ts
  const baseSha = deps.git.addWorktree(input.repoDir, worktree, input.branchFrom, resuming);
  if (baseSha) onEvent({ kind: "commit", base: baseSha });
```

dan baris 111-112:

```ts
  const headSha = deps.git.commitAndPush(worktree, `hanoman ${input.flow} ${input.specId ?? ""}`.trim(), input.branchTo, input.remoteUrl);
  onEvent({ kind: "commit", head: headSha });
  deps.git.removeWorktree(input.repoDir, worktree);
```

`head` dipancarkan **sebelum** `removeWorktree`: bila penghapusan gagal, run tetap punya `headSha` dan `runChanges` memilih jalur worktree lebih dulu — keduanya menghasilkan diff yang sama.

- [ ] **Step 4: Tulis test `persistEvent`, lalu implementasinya**

Tambahkan di `server/test/events-io.test.ts`:

```ts
describe("persistEvent commit (SPEC-144)", () => {
  beforeEach(async () => { await resetDb(); await makeProject(); await makeRun({ id: "RUN-1", projectId: "p1" }); });

  it("menulis baseSha lalu headSha", async () => {
    await persistEvent("RUN-1", { kind: "commit", base: "aaa" });
    await persistEvent("RUN-1", { kind: "commit", head: "bbb" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.baseSha).toBe("aaa");
    expect(run.headSha).toBe("bbb");
  });

  // Run yang di-resume tidak boleh kehilangan basis aslinya.
  it("tidak pernah menimpa baseSha yang sudah terisi", async () => {
    await persistEvent("RUN-1", { kind: "commit", base: "aaa" });
    await persistEvent("RUN-1", { kind: "commit", base: "zzz" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.baseSha).toBe("aaa");
  });
});
```

`server/src/runner/events-io.ts` — tambahkan cabang sebelum `} else if (e.kind === "file")`:

```ts
  } else if (e.kind === "commit") {
    // baseSha ditulis sekali. `resume` memanggil addWorktree lagi, dan branchFrom
    // bisa sudah bergerak — basis yang benar adalah basis semula.
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    const data: { baseSha?: string; headSha?: string } = {};
    if (e.base && !run.baseSha) data.baseSha = e.base;
    if (e.head) data.headSha = e.head;
    if (Object.keys(data).length) await prisma.run.update({ where: { id: runId }, data });
```

- [ ] **Step 5: Jalankan test, pastikan hijau**

Run: `pnpm --filter ./runner test`
Expected: PASS.

Run: `pnpm --filter ./server exec vitest run --no-file-parallelism`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add runner/src/types.ts runner/src/git.ts runner/src/run.ts runner/test/git.test.ts runner/test/run.test.ts server/src/runner/events-io.ts server/test/events-io.test.ts
git commit -m "feat(spec-144): GitOps menyerahkan baseSha/headSha, runOne memancarkannya"
```

---

### Task 3: `run-changes.ts` — diff diturunkan dari git

**Files:**
- Create: `server/src/services/run-changes.ts`, `server/test/run-changes.test.ts`

**Interfaces:**
- Consumes: `Run.baseSha`/`Run.headSha` (Task 1).
- Produces:
  ```ts
  export const PREVIEW_LIMIT = 256 * 1024;
  export class ChangesUnavailable extends Error {}
  export type ChangedFile = { path: string; add: number; del: number; status: "A"|"M"|"D"; binary: boolean };
  export type RunCommit   = { sha: string; subject: string };
  export type RunChanges  = { base: string|null; head: string|null; commits: RunCommit[]; files: ChangedFile[] };
  export type FilePreview = { path: string; status: "A"|"M"|"D"; binary: boolean; truncated: boolean;
                              diff: string|null; content: string|null };
  export type RunRow = { worktree: string; baseSha: string|null; headSha: string|null };
  export function runChanges(run: RunRow, repoDir: string|null): Promise<RunChanges>;
  export function runChangeFile(run: RunRow, repoDir: string|null, path: string): Promise<FilePreview|null>;
  ```
  `runChangeFile` mengembalikan `null` bila `path` tidak ada di dalam `runChanges(...).files` — itulah **satu-satunya** gerbang path.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// server/test/run-changes.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runChanges, runChangeFile, ChangesUnavailable, PREVIEW_LIMIT } from "../src/services/run-changes";

const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });

// Repo dengan satu commit basis. `worktree` dibuat dari KODE, bukan Bash tool:
// deniesDangerous memblokir perintah Bash yang cocok /git\s+worktree\s+add/.
function seed(): { repo: string; base: string } {
  const repo = mkdtempSync(join(tmpdir(), "runchanges-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "keep.txt"), "a\nb\nc\n");
  writeFileSync(join(repo, "gone.txt"), "x\n");
  g(repo, "add", "-A"); g(repo, "commit", "-qm", "base"); g(repo, "branch", "-M", "main");
  return { repo, base: g(repo, "rev-parse", "HEAD").stdout.trim() };
}
function addWorktree(repo: string, rel: string, base: string): string {
  const wt = join(repo, rel);
  g(repo, "worktree", "add", "--detach", wt, base);
  return wt;
}
// Hitung loose object (bukan pack) — untuk membuktikan jalur baca tak mencemari repo.
function looseObjects(repo: string): number {
  const root = join(repo, ".git", "objects");
  let n = 0;
  for (const d of readdirSync(root)) {
    if (d === "pack" || d === "info") continue;
    const p = join(root, d);
    if (statSync(p).isDirectory()) n += readdirSync(p).length;
  }
  return n;
}
const row = (worktree: string, baseSha: string | null, headSha: string | null = null) => ({ worktree, baseSha, headSha });

describe("runChanges — run hidup (worktree ada)", () => {
  it("menampilkan file UNTRACKED yang baru dibuat", async () => {
    const { repo, base } = seed();
    addWorktree(repo, ".worktrees/run-1", base);
    writeFileSync(join(repo, ".worktrees/run-1", "baru.md"), "satu\ndua\n");
    const c = await runChanges(row(".worktrees/run-1", base), repo);
    expect(c.files).toContainEqual({ path: "baru.md", add: 2, del: 0, status: "A", binary: false });
  });

  it("menampilkan file tracked yang diubah dan yang dihapus", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-2", base);
    writeFileSync(join(wt, "keep.txt"), "a\nb\nc\nd\n");
    rmSync(join(wt, "gone.txt"));
    const c = await runChanges(row(".worktrees/run-2", base), repo);
    expect(c.files).toContainEqual({ path: "keep.txt", add: 1, del: 0, status: "M", binary: false });
    expect(c.files).toContainEqual({ path: "gone.txt", add: 0, del: 1, status: "D", binary: false });
  });

  it("menandai berkas biner, bukan NaN", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-3", base);
    writeFileSync(join(wt, "b.bin"), Buffer.from([0, 1, 2, 3]));
    const c = await runChanges(row(".worktrees/run-3", base), repo);
    const f = c.files.find((x) => x.path === "b.bin")!;
    expect(f.binary).toBe(true);
    expect(Number.isNaN(f.add)).toBe(false);
  });

  it("path berspasi utuh (-z)", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-4", base);
    writeFileSync(join(wt, "ada spasi.md"), "x\n");
    const c = await runChanges(row(".worktrees/run-4", base), repo);
    expect(c.files.map((f) => f.path)).toContain("ada spasi.md");
  });

  it("memuat commit yang dibuat agen di dalam worktree", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-5", base);
    writeFileSync(join(wt, "a.md"), "x\n");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "commit agen");
    const c = await runChanges(row(".worktrees/run-5", base), repo);
    expect(c.commits.map((x) => x.subject)).toEqual(["commit agen"]);
  });

  it("tidak mengubah index worktree dan tidak mencemari object database", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-6", base);
    writeFileSync(join(wt, "baru.md"), "satu\n");
    const before = g(wt, "status", "--porcelain", "-uall").stdout;

    await runChanges(row(".worktrees/run-6", base), repo);
    const after1 = looseObjects(repo);
    await runChanges(row(".worktrees/run-6", base), repo);
    const after2 = looseObjects(repo);

    expect(g(wt, "status", "--porcelain", "-uall").stdout).toBe(before);
    expect(after2).toBe(after1);            // idempoten: hanya blob kosong, sekali
  });
});

describe("runChanges — run selesai (worktree hilang)", () => {
  it("membaca diff dari object database lewat baseSha..headSha", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-7", base);
    writeFileSync(join(wt, "hasil.md"), "x\ny\n");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "hasil");
    const head = g(wt, "rev-parse", "HEAD").stdout.trim();
    g(repo, "worktree", "remove", "--force", wt);

    const c = await runChanges(row(".worktrees/run-7", base, head), repo);
    expect(c.head).toBe(head);
    expect(c.files).toContainEqual({ path: "hasil.md", add: 2, del: 0, status: "A", binary: false });
    expect(c.commits.map((x) => x.subject)).toEqual(["hasil"]);
  });
});

describe("runChanges — kondisi yang harus dijawab jujur", () => {
  it("baseSha null → hasil kosong, bukan error", async () => {
    const { repo } = seed();
    const c = await runChanges(row(".worktrees/hantu", null), repo);
    expect(c).toEqual({ base: null, head: null, commits: [], files: [] });
  });

  it("project tanpa repoDir → ChangesUnavailable", async () => {
    await expect(runChanges(row(".worktrees/x", "aaa"), null)).rejects.toBeInstanceOf(ChangesUnavailable);
  });

  it("worktree hilang dan tak pernah commit → ChangesUnavailable", async () => {
    const { repo, base } = seed();
    await expect(runChanges(row(".worktrees/hantu", base), repo)).rejects.toBeInstanceOf(ChangesUnavailable);
  });

  it("headSha tak terjangkau → ChangesUnavailable yang menyebut sha-nya", async () => {
    const { repo, base } = seed();
    await expect(runChanges(row(".worktrees/hantu", base, "0".repeat(40)), repo))
      .rejects.toThrow(/0{40}/);
  });
});

describe("runChangeFile — gerbang path dan preview", () => {
  it("mengembalikan diff dan isi penuh file baru", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-8", base);
    writeFileSync(join(wt, "baru.md"), "satu\ndua\n");
    const p = (await runChangeFile(row(".worktrees/run-8", base), repo, "baru.md"))!;
    expect(p.status).toBe("A");
    expect(p.content).toBe("satu\ndua\n");
    expect(p.diff).toContain("+satu");
    expect(p.truncated).toBe(false);
  });

  it("file terhapus → content null, diff tetap ada", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-9", base);
    rmSync(join(wt, "gone.txt"));
    const p = (await runChangeFile(row(".worktrees/run-9", base), repo, "gone.txt"))!;
    expect(p.status).toBe("D");
    expect(p.content).toBeNull();
    expect(p.diff).toContain("-x");
  });

  it("berkas biner → tanpa diff, tanpa content", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-10", base);
    writeFileSync(join(wt, "b.bin"), Buffer.from([0, 1, 2]));
    const p = (await runChangeFile(row(".worktrees/run-10", base), repo, "b.bin"))!;
    expect(p).toMatchObject({ binary: true, diff: null, content: null });
  });

  it("path di luar daftar changes → null (gerbang)", async () => {
    const { repo, base } = seed();
    addWorktree(repo, ".worktrees/run-11", base);
    expect(await runChangeFile(row(".worktrees/run-11", base), repo, "keep.txt")).toBeNull();
    expect(await runChangeFile(row(".worktrees/run-11", base), repo, "../../etc/passwd")).toBeNull();
  });

  it("content di atas 256 KB dipotong dan ditandai", async () => {
    const { repo, base } = seed();
    const wt = addWorktree(repo, ".worktrees/run-12", base);
    writeFileSync(join(wt, "besar.txt"), "a\n".repeat(PREVIEW_LIMIT));   // 2 × PREVIEW_LIMIT byte
    const p = (await runChangeFile(row(".worktrees/run-12", base), repo, "besar.txt"))!;
    expect(p.truncated).toBe(true);
    expect(p.content!.length).toBe(PREVIEW_LIMIT);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run run-changes`
Expected: FAIL — cannot resolve `../src/services/run-changes`.

Test pertama (`file UNTRACKED`) adalah gate yang sesungguhnya: implementasi naif dengan
`git diff --numstat <base>` polos akan **hijau di semua test lain** dan merah hanya di sini.

- [ ] **Step 3: Implementasi minimal**

```ts
// server/src/services/run-changes.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const exec = promisify(execFile);
const MAX = 1 << 24;                      // maxBuffer — mengikuti services/scan.ts
export const PREVIEW_LIMIT = 256 * 1024;  // preseden scrollback PTY (ADR-0014)

/** Run yang changes-nya tak dapat dibaca sama sekali. Route memetakannya ke 409. */
export class ChangesUnavailable extends Error {}

export type ChangedFile = { path: string; add: number; del: number; status: "A"|"M"|"D"; binary: boolean };
export type RunCommit   = { sha: string; subject: string };
export type RunChanges  = { base: string|null; head: string|null; commits: RunCommit[]; files: ChangedFile[] };
export type FilePreview = { path: string; status: "A"|"M"|"D"; binary: boolean; truncated: boolean;
                            diff: string|null; content: string|null };
export type RunRow = { worktree: string; baseSha: string|null; headSha: string|null };

type Site = { cwd: string; env: NodeJS.ProcessEnv; revs: string[]; range: string; live: boolean };

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  exec("git", args, { cwd, env, maxBuffer: MAX }).then((r) => r.stdout);

// Worktree yang hidup: file baru masih untracked, dan `git diff` polos MELEWATKANNYA tanpa error.
// `git add -A -N` (intent-to-add) di atas salinan index membuatnya terlihat tanpa menghash isi —
// `git add -A` biasa menulis satu blob per file berubah ke .git/objects pada SETIAP request.
// Di worktree tertaut `.git` adalah file, jadi index-nya hanya bisa ditemukan lewat --git-path.
async function withTempIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const real = (await git(wt, ["rev-parse", "--git-path", "index"])).trim();
  const dir = await mkdtemp(join(tmpdir(), "hanoman-idx-"));
  const tmp = join(dir, "index");
  await copyFile(real, tmp);
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  try {
    await git(wt, ["add", "-A", "-N"], env);
    return await fn(env);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function resolveSite(run: RunRow, repoDir: string | null): Promise<Site> {
  if (!repoDir) throw new ChangesUnavailable("project tanpa repoDir");
  const base = run.baseSha!;
  const wt = join(repoDir, run.worktree);
  // Worktree lebih dulu: bila removeWorktree gagal setelah commit, keduanya ada dan
  // pohon di disk adalah kebenaran yang sama dengan baseSha..headSha.
  if (existsSync(wt)) return { cwd: wt, env: process.env, revs: [base], range: `${base}..HEAD`, live: true };
  if (!run.headSha) throw new ChangesUnavailable("worktree run sudah tidak ada dan run tidak pernah commit");
  await git(repoDir, ["cat-file", "-e", `${run.headSha}^{commit}`])
    .catch(() => { throw new ChangesUnavailable(`commit tak terjangkau: ${run.headSha}`); });
  return { cwd: repoDir, env: process.env, revs: [base, run.headSha],
           range: `${base}..${run.headSha}`, live: false };
}

// `--numstat -z` → "add \t del \t path \0"; biner memakai "-" untuk add/del.
// `--name-status -z` → "status \0 path \0" berselang-seling.
// `--no-renames`: rename mengubah bentuk record menjadi tiga field dan memecahkan gerbang path.
function parseNumstat(out: string): Map<string, { add: number; del: number; binary: boolean }> {
  const m = new Map<string, { add: number; del: number; binary: boolean }>();
  for (const rec of out.split("\0")) {
    if (!rec) continue;
    const [a, d, ...rest] = rec.split("\t");
    const path = rest.join("\t");
    const binary = a === "-" || d === "-";
    m.set(path, { add: binary ? 0 : Number(a), del: binary ? 0 : Number(d), binary });
  }
  return m;
}
function parseNameStatus(out: string): Map<string, "A"|"M"|"D"> {
  const parts = out.split("\0").filter(Boolean);
  const m = new Map<string, "A"|"M"|"D">();
  for (let i = 0; i + 1 < parts.length; i += 2) m.set(parts[i + 1]!, parts[i]! as "A"|"M"|"D");
  return m;
}

async function collect(site: Site): Promise<{ commits: RunCommit[]; files: ChangedFile[] }> {
  const diffArgs = (extra: string[]) => ["diff", ...extra, "-z", "--no-renames", ...site.revs];
  const [numstat, nameStatus, log] = await Promise.all([
    git(site.cwd, diffArgs(["--numstat"]), site.env),
    git(site.cwd, diffArgs(["--name-status"]), site.env),
    git(site.cwd, ["log", "--format=%H%x1f%s", site.range], site.env),
  ]);
  const nums = parseNumstat(numstat);
  const stat = parseNameStatus(nameStatus);
  const files: ChangedFile[] = [...nums.entries()]
    .map(([path, n]) => ({ path, add: n.add, del: n.del, binary: n.binary, status: stat.get(path) ?? "M" }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const commits = log.split("\n").filter(Boolean)
    .map((l) => { const [sha, ...s] = l.split("\x1f"); return { sha: sha!, subject: s.join("\x1f") }; });
  return { commits, files };
}

const EMPTY: RunChanges = { base: null, head: null, commits: [], files: [] };

export async function runChanges(run: RunRow, repoDir: string | null): Promise<RunChanges> {
  if (!run.baseSha) return EMPTY;               // queued, atau baris pra-migration
  const site = await resolveSite(run, repoDir);
  const run_ = site.live
    ? await withTempIndex(site.cwd, (env) => collect({ ...site, env }))
    : await collect(site);
  return { base: run.baseSha, head: run.headSha, ...run_ };
}

const cut = (s: string) => (s.length > PREVIEW_LIMIT ? { text: s.slice(0, PREVIEW_LIMIT), cut: true } : { text: s, cut: false });

export async function runChangeFile(run: RunRow, repoDir: string | null, path: string): Promise<FilePreview | null> {
  const changes = await runChanges(run, repoDir);
  const f = changes.files.find((x) => x.path === path);
  if (!f) return null;                          // gerbang: hanya file milik run ini
  if (f.binary) return { path, status: f.status, binary: true, truncated: false, diff: null, content: null };

  const site = await resolveSite(run, repoDir);
  const read = async (env: NodeJS.ProcessEnv): Promise<{ diff: string; content: string | null }> => {
    const diff = await git(site.cwd, ["diff", ...site.revs, "--", path], env);
    if (f.status === "D") return { diff, content: null };
    const content = site.live
      ? await readFile(join(site.cwd, path), "utf8")
      : await git(site.cwd, ["show", `${run.headSha}:${path}`], env);
    return { diff, content };
  };
  const { diff, content } = site.live ? await withTempIndex(site.cwd, read) : await read(site.env);

  const d = cut(diff);
  const c = content === null ? { text: null, cut: false } : cut(content);
  return { path, status: f.status, binary: false, truncated: d.cut || c.cut, diff: d.text, content: c.text };
}
```

- [ ] **Step 4: Jalankan test, pastikan hijau**

Run: `pnpm --filter ./server exec vitest run run-changes`
Expected: PASS — 17 test, 4 describe.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/run-changes.ts server/test/run-changes.test.ts
git commit -m "feat(spec-144): run-changes menurunkan diff run dari git"
```

---

### Task 4: `GET /runs/:id/changes` + `GET /runs/:id/changes/*`

**Files:**
- Modify: `server/src/routes/runs.ts` (tambahkan dua route sebelum `POST /runs/:id/steer`), `shared/src/api.ts`
- Create: `server/test/runs-changes.route.test.ts`

**Interfaces:**
- Consumes: `runChanges`, `runChangeFile`, `ChangesUnavailable` (Task 3).
- Produces: `paths.runChanges(id)`, `paths.runChangeFile(id, path)`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// server/test/runs-changes.route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun } from "./factory";

const app = buildApp();
const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });

function seedRepoWithWorktree(): { repo: string; base: string } {
  const repo = mkdtempSync(join(tmpdir(), "changes-route-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "keep.txt"), "a\n");
  g(repo, "add", "-A"); g(repo, "commit", "-qm", "base"); g(repo, "branch", "-M", "main");
  const base = g(repo, "rev-parse", "HEAD").stdout.trim();
  const wt = join(repo, ".worktrees", "run-1");
  g(repo, "worktree", "add", "--detach", wt, base);       // dari kode, bukan Bash tool
  writeFileSync(join(wt, "baru.md"), "satu\ndua\n");
  return { repo, base };
}

describe("GET /runs/:id/changes (SPEC-144)", () => {
  let repo: string, base: string;
  beforeEach(async () => {
    await resetDb();
    ({ repo, base } = seedRepoWithWorktree());
    await makeProject({ id: "p1", repoDir: repo });
  });

  it("mengembalikan file dan commit milik run", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", worktree: ".worktrees/run-1", baseSha: base });
    const res = await app.inject({ url: "/api/runs/RUN-1/changes" });
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toContainEqual({ path: "baru.md", add: 2, del: 0, status: "A", binary: false });
  });

  it("run tak dikenal → 404", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-999/changes" });
    expect(res.statusCode).toBe(404);
  });

  it("baseSha null → 200 kosong", async () => {
    await makeRun({ id: "RUN-2", projectId: "p1", worktree: ".worktrees/run-1", baseSha: null });
    const res = await app.inject({ url: "/api/runs/RUN-2/changes" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ base: null, head: null, commits: [], files: [] });
  });

  it("worktree hilang tanpa headSha → 409", async () => {
    await makeRun({ id: "RUN-3", projectId: "p1", worktree: ".worktrees/hantu", baseSha: base });
    const res = await app.inject({ url: "/api/runs/RUN-3/changes" });
    expect(res.statusCode).toBe(409);
  });

  it("headSha tak terjangkau → 409 yang menyebut sha-nya", async () => {
    await makeRun({ id: "RUN-4", projectId: "p1", worktree: ".worktrees/hantu",
      baseSha: base, headSha: "0".repeat(40) });
    const res = await app.inject({ url: "/api/runs/RUN-4/changes" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("0000000");
  });
});

describe("GET /runs/:id/changes/* (SPEC-144)", () => {
  let repo: string, base: string;
  beforeEach(async () => {
    await resetDb();
    ({ repo, base } = seedRepoWithWorktree());
    await makeProject({ id: "p1", repoDir: repo });
    await makeRun({ id: "RUN-1", projectId: "p1", worktree: ".worktrees/run-1", baseSha: base });
  });

  it("mengembalikan diff dan content", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1/changes/baru.md" });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("satu\ndua\n");
    expect(res.json().diff).toContain("+satu");
  });

  it("file di luar daftar changes → 404", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1/changes/keep.txt" });
    expect(res.statusCode).toBe(404);
  });

  it("path traversal → 404", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1/changes/../../etc/passwd" });
    expect([404, 400]).toContain(res.statusCode);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run runs-changes.route`
Expected: FAIL — 404 untuk semua (route belum ada).

- [ ] **Step 3: Implementasi minimal**

`shared/src/api.ts` — setelah `runSteer`:

```ts
  runChanges: (id: string) => `${API}/runs/${id}/changes`,
  runChangeFile: (id: string, path: string) => `${API}/runs/${id}/changes/${path}`,
```

`server/src/routes/runs.ts` — import:

```ts
import { runChanges, runChangeFile, ChangesUnavailable } from "../services/run-changes";
```

dan tambahkan dua route (sebelum `POST /runs/:id/steer`):

```ts
  // Changes milik run ini saja: worktree selagi hidup, baseSha..headSha setelah selesai.
  // Isi diff tak pernah disimpan — diturunkan dari git tiap request (ADR-0019).
  app.get("/runs/:id/changes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    const project = await prisma.project.findUnique({ where: { id: run.projectId } });
    try { return await runChanges(run, project?.repoDir ?? null); }
    catch (e) {
      if (e instanceof ChangesUnavailable) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  // Preview satu file. Gerbangnya adalah daftar changes itu sendiri — path di luar
  // daftar tak pernah dibaca dari disk, sehingga traversal tertutup tanpa validator terpisah.
  app.get("/runs/:id/changes/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    const project = await prisma.project.findUnique({ where: { id: run.projectId } });
    try {
      const preview = await runChangeFile(run, project?.repoDir ?? null, path);
      return preview ?? reply.code(404).send({ error: "not found" });
    } catch (e) {
      if (e instanceof ChangesUnavailable) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });
```

> Fastify mencocokkan route statis sebelum wildcard, jadi `/runs/:id/changes` tak pernah
> tertelan oleh `/runs/:id/changes/*`.

- [ ] **Step 4: Jalankan suite server penuh**

Run: `pnpm --filter ./server exec vitest run --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/runs.ts server/test/runs-changes.route.test.ts shared/src/api.ts
git commit -m "feat(spec-144): GET /runs/:id/changes + preview per file"
```

---

### Task 5: Verb terminal `files`/`diff` membaca sumber yang sama

**Files:**
- Modify: `server/src/routes/runs.ts:26-64` (`runCommand`)
- Test: `server/test/runs-command.test.ts`

**Interfaces:**
- Consumes: `runChanges` (Task 3).

**Kenapa:** verb `files` dan `diff` membaca `run.files` yang selamanya `[]`, jadi terminal menjawab
*"belum ada file berubah"* pada run yang menyentuh 30 file. Menambal panel saja meninggalkan terminal
tetap berbohong.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/runs-command.test.ts` (pakai `seedRepoWithWorktree` — salin dari
`runs-changes.route.test.ts`):

```ts
  it("verb diff merender file yang benar-benar berubah", async () => {
    const { repo, base } = seedRepoWithWorktree();
    await makeProject({ id: "p2", repoDir: repo });
    await makeRun({ id: "RUN-2", projectId: "p2", worktree: ".worktrees/run-1", baseSha: base });
    const res = await cmd("RUN-2", "diff");
    const lines = res.json().lines as { t: string; s: string }[];
    expect(lines.some((l) => l.s.includes("baru.md"))).toBe(true);
    expect(lines.some((l) => l.s === "belum ada file berubah")).toBe(false);
  });
```

Catatan: `makeProject({ id: "p1", repoDir: process.cwd() })` di `beforeEach` berkas itu tetap; test
baru memakai project `p2` sendiri agar tidak mengganggu test lain.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run runs-command`
Expected: FAIL — "belum ada file berubah".

- [ ] **Step 3: Implementasi minimal**

`server/src/routes/runs.ts`. Ubah signature `runCommand` — ia butuh baris `Run` utuh dan `repoDir`:

```ts
async function runCommand(
  run: { id: string; projectId: string; status: string; kind: string; progress: number;
         phases: unknown; plan: unknown; worktree: string; baseSha: string | null; headSha: string | null },
  repoDir: string | null, text: string, active: boolean,
): Promise<Line[]> {
```

Ganti cabang `files`/`diff`:

```ts
    case "files": case "diff": {
      // Sumber yang sama dengan GET /runs/:id/changes — tak ada salinan kedua yang bisa basi.
      try {
        const { files } = await runChanges(run, repoDir);
        return files.length
          ? files.map((f) => ({ t: f.status === "A" ? "✓" : f.status === "D" ? "✗" : "›",
                                s: `${f.path}  +${f.add} −${f.del}` }))
          : [{ t: " ", s: "belum ada file berubah" }];
      } catch (e) {
        return [{ t: "✗", s: (e as Error).message }];
      }
    }
```

Di `POST /runs/:id/command`, muat project dan teruskan `repoDir`:

```ts
    const project = await prisma.project.findUnique({ where: { id: run.projectId } });
    return { lines: await runCommand(run, project?.repoDir ?? null, text, active) };
```

- [ ] **Step 4: Jalankan suite server penuh**

Run: `pnpm --filter ./server exec vitest run --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/runs.ts server/test/runs-command.test.ts
git commit -m "feat(spec-144): verb files/diff terminal membaca changes nyata"
```

---

### Task 6: Web — panel changes, commits, dan preview source

**Files:**
- Modify: `src/src/api/client.ts:53-58`, `src/src/screens/run-reduce.ts:6-16`, `src/test/run-reduce.test.ts`, `src/src/screens/RunsScreen.tsx:96-123,239-275`

**Interfaces:**
- Consumes: `paths.runChanges`, `paths.runChangeFile` (Task 4).
- Produces: `api.runChanges(id): Promise<RunChanges>`, `api.runChangeFile(id, path): Promise<FilePreview>`.
  Tipe `RunChanges`/`FilePreview` **diketik ulang di client** (sama persis dengan Task 3) — `src` tidak
  meng-import dari `server`.

- [ ] **Step 1: Perluas api client dan buang `kind: "file"`**

`src/src/api/client.ts`:

```ts
export type ChangedFile = { path: string; add: number; del: number; status: "A"|"M"|"D"; binary: boolean };
export type RunCommit   = { sha: string; subject: string };
export type RunChanges  = { base: string|null; head: string|null; commits: RunCommit[]; files: ChangedFile[] };
export type FilePreview = { path: string; status: "A"|"M"|"D"; binary: boolean; truncated: boolean;
                            diff: string|null; content: string|null };
```

Tambahkan ke `api`:

```ts
  runChanges: (id: string) => j<RunChanges>(paths.runChanges(id)),
  runChangeFile: (id: string, path: string) => j<FilePreview>(paths.runChangeFile(id, path)),
```

dan hapus baris terakhir `RunLiveEvent` (`| { kind: "file"; … }`), sehingga union berakhir di `cost`.

- [ ] **Step 2: Buang `case "file"` dari reducer**

`src/src/screens/run-reduce.ts` — hapus baris `case "file": …`. `default: return run;` sudah menangani
event tak dikenal.

`src/test/run-reduce.test.ts` — hapus `files: []` dari fixture (kolomnya menyusul di Task 7; membuangnya
sekarang membuat fixture tetap sah pada kedua sisi migrasi).

- [ ] **Step 3: Jalankan test web**

Run: `pnpm vitest run src/test/run-reduce.test.ts`
Expected: PASS.

- [ ] **Step 4: `RunsScreen` — panel changes, commits, preview**

Ganti `FileDiff` dan sisipkan `CommitList` + `FilePreviewPane`. Tambahkan `useRunChanges`:

```tsx
import { api, type RunChanges, type RunCommit, type FilePreview } from "../api/client";

// Realtime: satu mekanisme, bukan dua. Poll tidak digantung pada event SSE `log` —
// satu fase memuntahkan puluhan baris log per menit, dan tiap baris akan memicu
// empat spawn git di server.
// ponytail: poll 5 dtk; pindah ke event bila panel run aktif jadi mahal.
function useRunChanges(run: RunVM): { changes: RunChanges | null; error: string | null } {
  const [changes, setChanges] = React.useState<RunChanges | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    const load = () => api.runChanges(run.id)
      .then((c) => { if (alive) { setChanges(c); setError(null); } })
      .catch((e) => { if (alive) { setChanges(null); setError(String(e.message ?? e)); } });
    load();
    if (!isRunActive(run.status)) return () => { alive = false; };
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [run.id, run.status]);
  return { changes, error };
}

const STATUS_ICON: Record<string, string> = { A: "file-plus", M: "file-diff", D: "file-minus" };

function ChangesCard({ run, changes, onPick }:
  { run: RunVM; changes: RunChanges; onPick: (p: string) => void }) {
  const totAdd = changes.files.reduce((n, f) => n + f.add, 0);
  const totDel = changes.files.reduce((n, f) => n + f.del, 0);
  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <span className="hn-eyebrow">File berubah · {changes.files.length}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          <span style={{ color: "var(--leaf-600)" }}>+{totAdd}</span>{" "}
          <span style={{ color: "var(--clay-600)" }}>−{totDel}</span>
        </span>
      </div>
      <div style={{ padding: "8px 16px 12px" }}>
        {changes.files.length === 0 && <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>belum ada file berubah</div>}
        {changes.files.map((f) => (
          <div key={f.path} onClick={() => onPick(f.path)}
            style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", cursor: "pointer" }}>
            <Icon name={STATUS_ICON[f.status]!} size={14}
              color={f.status === "A" ? "var(--leaf-600)" : f.status === "D" ? "var(--clay-600)" : "var(--wind-600)"} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
            {f.binary
              ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>biner</span>
              : <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, flex: "0 0 auto" }}>
                  <span style={{ color: "var(--leaf-600)" }}>+{f.add}</span>{" "}
                  <span style={{ color: "var(--clay-600)" }}>−{f.del}</span>
                </span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function CommitList({ commits }: { commits: RunCommit[] }) {
  if (!commits.length) return null;
  return (
    <Card padding={0}>
      <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <span className="hn-eyebrow">Commit · {commits.length}</span>
      </div>
      <div style={{ padding: "8px 16px 12px" }}>
        {commits.map((c) => (
          <div key={c.sha} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0" }}>
            <Icon name="git-commit-horizontal" size={14} color="var(--brass-600)" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>{c.sha.slice(0, 7)}</span>
            <span style={{ fontSize: 13, color: "var(--text-body)" }}>{c.subject}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Preview: Diff | Source. `content` adalah isi file SETELAH perubahan (brief: "preview seluruh source").
function FilePreviewPane({ runId, path, onClose }: { runId: string; path: string; onClose: () => void }) {
  const [tab, setTab] = React.useState<"diff" | "source">("diff");
  const [p, setP] = React.useState<FilePreview | null>(null);
  React.useEffect(() => {
    let alive = true;
    api.runChangeFile(runId, path).then((r) => { if (alive) setP(r); }).catch(() => { if (alive) setP(null); });
    return () => { alive = false; };
  }, [runId, path]);
  const body = tab === "diff" ? p?.diff : p?.content;
  const lineColor = (l: string) =>
    l.startsWith("+") ? "var(--leaf-500)" : l.startsWith("-") ? "var(--clay-500)" :
    l.startsWith("@@") ? "var(--brass-400)" : "var(--term-fg)";
  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{path}</span>
        <Button size="sm" variant={tab === "diff" ? "primary" : "ghost"} onClick={() => setTab("diff")}>Diff</Button>
        <Button size="sm" variant={tab === "source" ? "primary" : "ghost"} onClick={() => setTab("source")}>Source</Button>
        <IconButton size="sm" variant="ghost" icon="x" label="Tutup preview" onClick={onClose} />
      </div>
      {p?.binary
        ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint="tidak dapat di-review dari dashboard" />
        : <div style={{ background: "var(--surface-code)", padding: "12px 14px", maxHeight: 420, overflow: "auto",
            fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.7 }}>
            {(body ?? "").split("\n").map((l, i) => (
              <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word",
                color: tab === "diff" ? lineColor(l) : "var(--term-fg)" }}>{l || " "}</div>
            ))}
          </div>}
      {p?.truncated && (
        <div style={{ padding: "8px 14px", fontSize: 11.5, color: "var(--clay-600)", borderTop: "1px solid var(--border-hair)" }}>
          dipotong di 256 KB — file aslinya lebih panjang
        </div>
      )}
    </Card>
  );
}
```

Di `RunDetail`, ganti blok `hasWork`:

```tsx
function RunDetail({ run }: { run: RunVM }) {
  const duration = useLiveDuration(run);
  const { changes, error } = useRunChanges(run);
  const [picked, setPicked] = React.useState<string | null>(null);
  React.useEffect(() => { setPicked(null); }, [run.id]);
  const plan = run.plan as PlanStep[];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* …Card ringkasan + PhasePipeline + MetricCell, tak berubah… */}
      <WorktreeInfo run={run} />
      {plan.length > 0 && <PlanSteps steps={plan} />}
      {error && <StateBlock kind="error" icon="alert-triangle" title="Changes tidak dapat dibaca" hint={error} />}
      {changes && (
        <div style={{ display: "grid", gridTemplateColumns: picked ? "1fr 1fr" : "1fr", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ChangesCard run={run} changes={changes} onPick={setPicked} />
            <CommitList commits={changes.commits} />
          </div>
          {picked && <FilePreviewPane runId={run.id} path={picked} onClose={() => setPicked(null)} />}
        </div>
      )}
      <LogView run={run} />
      {(run.status === "running" || run.status === "paused") && <RunControls run={run} />}
    </div>
  );
}
```

`hasWork` dihapus. Tanpa pemisahan ini, `PlanSteps` akan tampil sebagai kartu "Plan · 0 langkah" pada
**setiap** run, karena `Run.plan` tak pernah punya penulis.

Hapus `type FileRow` yang sudah tak dipakai. `StateBlock`, `Button`, `IconButton` sudah di-import dari `../ds`.

- [ ] **Step 5: Typecheck + build web**

Run: `pnpm -r typecheck`
Expected: PASS.

Run: `pnpm --filter ./src build`
Expected: PASS.

Run: `pnpm vitest run src/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/run-reduce.ts src/test/run-reduce.test.ts src/src/screens/RunsScreen.tsx
git commit -m "feat(spec-144): panel changes, commit, dan preview source di RunsScreen"
```

---

### Task 7: Buang `Run.files` dan event `kind: "file"`

**Files:**
- Modify: `server/prisma/schema.prisma`, `shared/src/entities.ts:35`, `runner/src/types.ts:35`,
  `server/src/runner/events-io.ts:63-66`, `server/src/queue.ts:48`, `server/test/factory.ts`
- Create: `server/prisma/migrations/20260709180000_drop_run_files/migration.sql`

**Interfaces:**
- Consumes: tidak ada pembaca tersisa — Task 5 memindahkan verb terminal, Task 6 memindahkan web.
- Produces: `RunEvent` tanpa `kind: "file"`; `zRun` tanpa `files`.

**Kenapa dibuang, bukan diisi:** ia salinan DB dari state filesystem yang **dapat dihitung ulang**
(ADR-0011, ADR-0018), ditulis **append-only** — file yang disunting dua kali akan muncul dua baris, dan
file yang disunting lalu dikembalikan terdaftar selamanya. Ia juga tak pernah punya produsen.

- [ ] **Step 1: Buktikan tak ada pembaca tersisa**

Run:
```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/run-8804
/usr/bin/grep -rn 'kind: "file"\|kind === "file"\|run\.files\|\.files as' shared/src server/src src/src runner/src
```
Expected: hanya `runner/src/types.ts:35`, `shared/src/entities.ts:35`, `server/src/runner/events-io.ts`,
`server/src/queue.ts` — semuanya **penulis/deklarasi**, bukan pembaca. Bila ada pembaca lain, pindahkan
dulu; jangan menghapus kolom yang masih dibaca.

*(Pakai `/usr/bin/grep`: rtk mem-proxy grep dan pernah mengembalikan hasil kosong untuk pola yang cocok.)*

- [ ] **Step 2: Hapus deklarasi dan penulis**

`runner/src/types.ts` — hapus baris `| { kind: "file"; path: string; add: number; del: number; status: string }`.

`server/src/runner/events-io.ts` — hapus seluruh cabang `} else if (e.kind === "file") { … }` dan
perbarui komentar di atas `persistEvent`:

```ts
// Persist a run event to Postgres. Read-modify-write for log/phase/commit, so the
// caller must serialize calls per run (the worker chains them) to avoid races.
```

`server/src/queue.ts:48` — buang `files: []`:

```ts
      phases: phasesForFlow(input.flow, input.only), plan: [], log: [],
```

`shared/src/entities.ts` — hapus baris `files: z.array(...)` dari `zRun`.

`server/test/factory.ts` — hapus `files: [] as unknown as Prisma.InputJsonValue,` dari `makeRun`.

`shared/test/entities.test.ts` — hapus `files: []` dari fixture Task 1.

`server/prisma/schema.prisma` — hapus baris `files Json` dari `model Run`.

- [ ] **Step 3: Migration**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/run-8804
pnpm --filter ./server exec prisma migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url 'postgresql://hanoman:hanoman@localhost:5432/hanoman_shadow' --script
```

Expected: tepat satu `ALTER TABLE "Run" DROP COLUMN "files";`

Tulis ke `server/prisma/migrations/20260709180000_drop_run_files/migration.sql`:

```sql
-- SPEC-144: salinan DB dari state filesystem, tanpa produsen, append-only. Diturunkan
-- ulang dari git oleh services/run-changes.ts. Lihat ADR-0019.
ALTER TABLE "Run" DROP COLUMN "files";
```

```bash
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman_test' pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server exec prisma generate
```

- [ ] **Step 4: Suite penuh**

Run: `pnpm --filter ./server exec vitest run --no-file-parallelism`
Expected: PASS.

Run: `pnpm --filter ./runner test && pnpm vitest run shared/test/entities.test.ts && pnpm vitest run src/`
Expected: PASS.

Run: `pnpm -r typecheck`
Expected: PASS — bila ada error `Property 'files' does not exist`, itu pembaca yang terlewat di Step 1.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260709180000_drop_run_files shared/src/entities.ts shared/test/entities.test.ts runner/src/types.ts server/src/runner/events-io.ts server/src/queue.ts server/test/factory.ts
git commit -m "refactor(spec-144)!: buang kolom Run.files dan event kind:file"
```

---

### Task 8: ADR-0019, docs, guardrail, dan smoke lokal nyata

**Files:**
- Create: `internal/docs/adr/0019-sha-disimpan-diff-diturunkan.md`
- Modify: `internal/docs/README.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`

- [ ] **Step 1: Hitung ulang nomor ADR lintas branch**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/run-8804
for b in $(/usr/bin/git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do
  /usr/bin/git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null
done | sed -n 's#.*/\([0-9]\{4\}\).*#\1#p' | sort -u | tail -1
```
Expected: `0018` → pakai `0019`. Bila lebih tinggi, naikkan. `0018` sudah dipakai **dua** doc; jangan
tambah tabrakan ketiga.

- [ ] **Step 2: Tulis ADR**

`internal/docs/adr/0019-sha-disimpan-diff-diturunkan.md`:

- **Konteks:** `Run.files` + `kind: "file"` tak pernah punya produsen (SPEC-008 mengklaim `file` live,
  tapi `runOne` tak pernah memancarkannya). Run sukses memanggil `removeWorktree`, dan `commitAndPush`
  tak membuat branch lokal saat `origin` ada — sehingga setelah run selesai **tak ada worktree dan tak
  ada branch** untuk di-diff. Diverifikasi: `git for-each-ref` hanya menyisakan `main` + `origin/{HEAD,main}`.
- **Keputusan:** simpan **penunjuk** (`baseSha`, `headSha`), turunkan **isinya** (diff, daftar file,
  commit) dari git saat dibaca. Buang `Run.files`.
- **Konsekuensi yang diterima:** empat spawn git per ringkasan, tiap 5 detik selama panel run aktif
  terbuka; berkas biner tak dapat di-review; rename tampil sebagai `D` + `A`; blob kosong `e69de29…`
  ditulis sekali ke object database repo pengguna oleh `git add -A -N`.
- **Batas terhadap ADR-0011/ADR-0018:** nilai turunan tidak disimpan — tetapi penunjuk ke sebuah momen
  yang **tak dapat direkonstruksi** harus disimpan. `coverage` dapat dihitung ulang dari disk; sebuah
  commit SHA tidak, begitu worktree dan branch-nya hilang.
- **Alternatif yang ditolak:** (a) mengisi `Run.files` lewat event — salinan DB yang append-only dan tak
  pernah bisa menyajikan preview source; (b) menyimpan seluruh patch di kolom Json — `GET /runs` akan
  menyeret megabyte tiap poll; (c) `git add -A` di index sementara — menulis satu blob per file berubah
  pada setiap `GET`.

- [ ] **Step 3: Perbarui docs arsitektur + link di index**

`internal/docs/architecture/data-model.md` — pada tabel `Run`: tambahkan `baseSha String?` dan
`headSha String?`; hapus baris `files Json`. Catat bahwa `commitSha` adalah commit **pemicu** webhook,
bukan commit milik run.

`internal/docs/architecture/api-contract.md` — di blok `## Runs`:

```
GET  /runs/:id/changes          # { base, head, commits[], files[] } — hanya changes milik run ini
#   200 { base:null, … } bila run belum menyentuh worktree; 409 bila project tanpa repoDir,
#   worktree hilang tanpa commit, atau headSha tak terjangkau.
GET  /runs/:id/changes/*path    # { path, status, binary, truncated, diff, content }
#   404 bila path di luar daftar changes — daftar itu satu-satunya gerbang. content dipotong 256 KB.
```

dan tambahkan catatan setelah blok: diff **diturunkan dari git tiap request** (worktree selagi run
hidup, `baseSha..headSha` setelah selesai), tak ada salinan DB — ADR-0019.

`internal/docs/README.md`, bagian `## adr`, baris paling atas:

```
- [0019 — SHA disimpan, diff diturunkan](adr/0019-sha-disimpan-diff-diturunkan.md)
```

- [ ] **Step 4: Guardrail Source of Truth**

Run: `pnpm --filter ./cli build && node cli/dist/hanoman.js docs verify`
Expected: `Source of Truth clean · coverage 100%`. Doc di `internal/docs/**` yang tak ter-link akan
memblokir Stop hook.

- [ ] **Step 5: Suite penuh**

Run: `pnpm test && pnpm --filter ./runner test && pnpm --filter ./cli test && pnpm -r typecheck`
Expected: semua PASS. (`pnpm test` tidak mencakup runner/cli — karena itu keduanya dipanggil terpisah.)

- [ ] **Step 6: Smoke lokal nyata (CLAUDE.md)**

**Jangan boot terhadap `DATABASE_URL`.** DB dev `hanoman` dikelola `db push` dari branch lain dan
schema-nya menyimpang. Pakai DB scratch:

```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c 'CREATE DATABASE hanoman_smoke OWNER hanoman;'
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman_smoke' pnpm --filter ./server exec prisma migrate deploy
```

**Pilih port yang benar-benar bebas** dan buktikan servermu yang memilikinya — 8787 dan 8799 sudah
dipakai instance hanoman lain di mesin ini, dan `curl /api/health` akan menjawab `ok` dari server
**orang lain**:

```bash
lsof -nP -iTCP -sTCP:LISTEN
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman_smoke' PORT=8850 \
  pnpm --filter ./server exec tsx src/server.ts &
lsof -nP -iTCP:8850 -sTCP:LISTEN      # pastikan PID-nya milikmu
```

> **Jangan `POST /runs`.** Bila ada worker dev hidup, itu benar-benar mengeksekusi run background.

Alih-alih menjalankan run, tunjuk baris `Run` ke worktree **run ini sendiri**, yang sudah berisi
commit-commit SPEC-144 di atas `main`:

```bash
REPO=/Users/denameidina/Documents/Nafanesia/hanoman
BASE=$(/usr/bin/git -C "$REPO" rev-parse main)

curl -s -XPOST localhost:8850/api/projects -H 'content-type: application/json' \
  -d "{\"name\":\"smoke144\",\"kind\":\"existing\",\"desc\":\"smoke\",\"repoDir\":\"$REPO\"}"

docker exec hanoman-db-1 psql -U hanoman -d hanoman_smoke -c \
  "INSERT INTO \"Run\" (id,\"projectId\",kind,status,trigger,\"triggerDetail\",phases,plan,log,worktree,\"branchFrom\",\"branchTo\",model,\"tokensIn\",\"tokensOut\",cost,progress,\"baseSha\")
   VALUES ('RUN-S1','<id project dari respons di atas>','feature','running','manual','','[]','[]','[]','.worktrees/run-8804','main','hanoman/run-8804','','0','0','\$0.00',0,'$BASE');"
```

Verifikasi (isi kolom **Hasil** dengan keluaran nyata saat mengeksekusi):

| # | Panggilan | Harapan |
|---|---|---|
| 1 | `GET /api/runs/RUN-S1/changes` | `200`; `files[]` memuat `docs/superpowers/plans/2026-07-09-hanoman-run-changes-preview-spec-144.md` dengan `status:"A"` |
| 2 | idem | `commits[]` memuat subject `docs(spec-144): …` |
| 3 | `GET /api/runs/RUN-S1/changes/internal/docs/README.md` | `200`; `diff` memuat `+- [0019` dan `content` memuat seluruh index |
| 4 | `GET /api/runs/RUN-S1/changes/server/src/db.ts` | `404` — file tak berubah di run ini (gerbang) |
| 5 | `GET /api/runs/RUN-S1/changes/../../etc/passwd` | `404`/`400`, **bukan** isi `/etc/passwd` |
| 6 | `GET /api/runs/RUN-999/changes` | `404` |
| 7 | `UPDATE "Run" SET "baseSha"=NULL` lalu ulangi #1 | `200 {"base":null,"head":null,"commits":[],"files":[]}` |
| 8 | `UPDATE "Run" SET worktree='.worktrees/hantu'` lalu ulangi #1 | `409` |
| 9 | `/usr/bin/git -C "$REPO" status --porcelain` sebelum & sesudah | **identik** — jalur baca tak menyentuh worktree |
| 10 | jumlah loose object `$REPO/.git/objects` sebelum & sesudah dua kali #1 | bertambah ≤ 1, lalu **stabil** |
| 11 | `docker exec … psql -U hanoman -d hanoman -c 'select count(*) from "Run"'` | DB nyata **tak tersentuh** |

Bersihkan: hentikan server, `DROP DATABASE hanoman_smoke, hanoman_shadow`.

- [ ] **Step 7: Commit**

```bash
git add internal/docs/adr/0019-sha-disimpan-diff-diturunkan.md internal/docs/README.md internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md
git commit -m "docs(spec-144): ADR-0019 + data-model & api-contract untuk run changes"
```

---

## Self-review

**Cakupan spec.** Data model (`baseSha`/`headSha`) → Task 1. Menangkap kedua SHA (`GitOps`, `runOne`,
`persistEvent`, dan larangan menimpa `baseSha` saat resume) → Task 2. Service `run-changes` dengan dua
sumber, index sementara, `-z`, `--no-renames`, deteksi biner → Task 3. API + kode status + gerbang path
+ pemotongan 256 KB → Task 3 & 4. "Satu sumber untuk semua pembaca" (verb terminal) → Task 5. Web: panel
changes, commits, preview `Diff`|`Source`, pemisahan `hasWork`, poll 5 detik → Task 6. "Deletion over
addition" (`Run.files`, `kind: "file"`) → Task 7. Migration + ADR + docs + guardrail + smoke → Task 8.
Kriteria "File baru wajib terlihat" → Task 3 Step 1, test pertama. Kriteria "Gagal keras, jangan mundur
diam-diam" → Task 3 (`ChangesUnavailable`) + Task 4 (409).

**Konsistensi tipe.** `RunRow = { worktree; baseSha; headSha }` dipakai identik di Task 3 (service),
Task 4 (route mengoper baris `Run` Prisma apa adanya — ia struktural-kompatibel) dan Task 5 (verb
terminal). `ChangedFile.status` adalah `"A"|"M"|"D"` di service (Task 3), di client (Task 6), dan di
`STATUS_ICON`. `addWorktree(...): string | undefined` di Task 2 sama dengan fake `mockReturnValue("base00")`
/ `mockReturnValue(undefined)` di test yang sama. `PREVIEW_LIMIT` satu konstanta, dipakai service (Task 3)
dan diuji (Task 3 Step 1); UI hanya menampilkan `truncated`.

**Urutan yang mengikat.** `Run.files` dibuang **paling akhir** (Task 7), setelah verb terminal (Task 5)
dan web (Task 6) berhenti membacanya. Membuangnya lebih awal memecahkan `pnpm -r typecheck` di tengah
plan, dan tak ada task yang bisa hijau sendirian.

**Yang sengaja tidak dikerjakan.** `Run.plan` + `PlanSteps` (mati, tapi utang brief lain — di sini hanya
gate `hasWork` yang dipecah). `commitAndPush` yang melempar saat tak ada yang di-staging (`git commit`
exit 1) — run seperti itu berakhir `failed` dengan worktree utuh, sehingga jalur "run hidup" tetap
menyajikan seluruh changes-nya. Absennya commit `hanoman <flow> <specId>` dari history lokal. Mengedit
file dari panel changes; diff antar-run; branch remote; menahan worktree agar tidak dihapus.
