# Review Backlog Done — File Changed via SHA Tersimpan (SPEC-176) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backlog `done` menampilkan file-changed dari SHA start/end yang disimpan saat sesi berjalan, bukan grep pesan commit.

**Architecture:** Pulihkan ADR-0019 di era sesi (ADR-0030): kolom nullable `baseSha`/`headSha` pada `Spec`, ditulis saat `POST`/`DELETE /terminal/sessions`. `resolveReview` prefer SHA tersimpan (bila terjangkau) → `specReviewRange`; fallback grep untuk spec lama. Isi diff tetap diturunkan tiap request.

**Tech Stack:** TypeScript strict, Prisma (Postgres), Fastify, Vitest, git CLI via `execFile`/`spawnSync`.

## Global Constraints

- TypeScript strict; test untuk tiap logika orchestrasi.
- Skema hanya berubah lewat migration + ADR (ADR-0030 sudah ditulis).
- Kolom baru **nullable** (additive) — shared dev DB dipakai worktree sibling.
- Bentuk respons `SpecReview = { base, files, changed }` **tidak boleh berubah** (frontend tak disentuh).
- Commit **sekali di akhir** lalu push `HEAD:refs/heads/hanoman/spec-176` (instruksi harness), bukan per-task.
- Test repo server: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- <file> --no-file-parallelism` (hindari drift env prod; hindari paralelisme file, memory).

---

### Task 1: Skema `Spec.baseSha`/`headSha` + migration

**Files:**
- Modify: `server/prisma/schema.prisma:21-33` (model `Spec`)
- Create: `server/prisma/migrations/20260711120000_add_spec_base_head_sha/migration.sql`

**Interfaces:**
- Produces: kolom `Spec.baseSha: String?`, `Spec.headSha: String?` — dipakai Task 4 (tulis) & Task 5 (baca).

- [x] **Step 1: Tambah kolom ke schema.prisma**

Di `model Spec`, setelah `branchFrom String? ...`, tambah:

```prisma
  baseSha    String? // SPEC-176 · ADR-0030 · commit detach worktree sesi (dari addWorktree)
  headSha    String? // SPEC-176 · ADR-0030 · commit HEAD worktree di akhir sesi
```

- [x] **Step 2: Tulis migration SQL**

`server/prisma/migrations/20260711120000_add_spec_base_head_sha/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Spec" ADD COLUMN "baseSha" TEXT,
ADD COLUMN "headSha" TEXT;
```

- [x] **Step 3: Terapkan ke DB dev + test, generate client**

```bash
cd server
env -u NODE_ENV -u DATABASE_URL DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman" npx prisma migrate deploy
env -u NODE_ENV -u DATABASE_URL DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_test" npx prisma migrate deploy
env -u NODE_ENV -u DATABASE_URL npx prisma generate
```
Expected: "1 migration ... applied" (tiap DB) + "Generated Prisma Client". (URL sesuaikan `.env` bila beda.)

- [x] **Step 4: Verifikasi kolom ada**

```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman_test -c '\d "Spec"' | grep -E "baseSha|headSha"
```
Expected: dua baris `baseSha | text` dan `headSha | text`.

---

### Task 2: Helper `shaResolvable` di spec-review.ts (TDD)

**Files:**
- Modify: `server/src/services/spec-review.ts` (tambah export `shaResolvable`)
- Test: `server/test/spec-review.test.ts`

**Interfaces:**
- Produces: `shaResolvable(repoDir: string, sha: string): Promise<boolean>` — dipakai Task 5.

- [x] **Step 1: Tulis test yang gagal**

Di `server/test/spec-review.test.ts`, dalam `describe("review done spec ...")`, tambah:

```ts
it("shaResolvable: true untuk commit ada, false untuk sha karangan", async () => {
  const dir = hrepo();
  const r = (await specCommitRange(dir, HID))!;
  expect(await shaResolvable(dir, r.head)).toBe(true);
  expect(await shaResolvable(dir, "0".repeat(40))).toBe(false);
});
```
Tambahkan `shaResolvable` ke import baris 3.

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- spec-review --no-file-parallelism`
Expected: FAIL — `shaResolvable is not a function` / import error.

- [x] **Step 3: Implementasi minimal**

Di `spec-review.ts`, tambah export (dekat `changedFiles`):

```ts
// SPEC-176 · SHA masih ada di object database? `cat-file -e` exit 0 = ada. Menjaga
// review done tak crash bila objek head sudah di-`git gc` (branch dibuang sebelum merge).
export async function shaResolvable(repoDir: string, sha: string): Promise<boolean> {
  return exec("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoDir, ...GIT })
    .then(() => true).catch(() => false);
}
```

- [x] **Step 4: Jalankan, pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- spec-review --no-file-parallelism`
Expected: PASS semua.

---

### Task 3: `realGit.headSha(cwd)` + antarmuka GitOps (TDD)

**Files:**
- Modify: `runner/src/types.ts:15-19` (interface `GitOps`)
- Modify: `runner/src/git.ts` (implementasi `headSha`)
- Test: `runner/test/git.test.ts`

**Interfaces:**
- Produces: `GitOps.headSha(worktree: string): string` — `git rev-parse HEAD` di worktree. Dipakai Task 4.

- [x] **Step 1: Tulis test yang gagal**

Di `runner/test/git.test.ts`, tambah (pola mengikuti test `addWorktree` yang ada):

```ts
it("headSha mengembalikan HEAD worktree", () => {
  const repo = makeRepo();                       // helper existing di file ini
  const wt = join(repo, ".worktrees", "w1");
  const base = realGit.addWorktree(repo, wt, "main");
  expect(realGit.headSha(wt)).toBe(base);        // worktree detached di base, belum commit
});
```
> Sesuaikan nama helper repo (`makeRepo`) dengan yang sudah ada di `git.test.ts`.

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test -- git`
Expected: FAIL — `realGit.headSha is not a function`.

- [x] **Step 3: Tambah ke interface GitOps**

`runner/src/types.ts`, dalam `interface GitOps`:

```ts
  /** HEAD worktree sekarang — dibaca sebelum removeWorktree untuk simpan headSha (SPEC-176). */
  headSha(worktree: string): string;
```

- [x] **Step 4: Implementasi di realGit**

`runner/src/git.ts`, dalam objek `realGit` (dekat `removeWorktree`):

```ts
  headSha: (worktree) => git(worktree, ["rev-parse", "HEAD"]).trim(),
```

- [x] **Step 5: Jalankan, pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test -- git`
Expected: PASS.

---

### Task 4: Persist baseSha (create) + headSha (delete) di terminal.ts (TDD)

**Files:**
- Modify: `server/src/routes/terminal.ts:58` (create) & `:118-137` (delete)
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `realGit.headSha` (Task 3), kolom `Spec.baseSha/headSha` (Task 1).

- [x] **Step 1: Tulis test yang gagal**

Di `terminal.route.test.ts`, dalam `describe("terminal routes · sesi backlog")`, tambah:

```ts
it("menyimpan baseSha saat start dan headSha saat DELETE", async () => {
  process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
  await makeSpec({ id: "SPEC-930", projectId: "p1", stage: "planned" });
  await start("SPEC-930");
  const afterStart = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-930" } });
  expect(afterStart.baseSha).toMatch(/^[0-9a-f]{40}$/);
  expect(afterStart.headSha).toBeNull();
  await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-930" });
  const afterDel = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-930" } });
  expect(afterDel.headSha).toMatch(/^[0-9a-f]{40}$/);
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- terminal.route --no-file-parallelism`
Expected: FAIL — `baseSha` null (belum dipersist).

- [x] **Step 3: Persist baseSha di create**

`terminal.ts`, ganti baris 58 (`realGit.addWorktree(...)`) menjadi:

```ts
      const baseSha = realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, spec.branchFrom ?? "main");
      await prisma.spec.update({ where: { id: spec.id }, data: { baseSha } });
```

- [x] **Step 4: Persist headSha di delete**

`terminal.ts`, dalam handler DELETE, blok `if (project?.repoDir)`, ganti:

```ts
        if (s.specId) await advanceStage(s.specId, project.repoDir, id, s.flow, s.cwd);
```
menjadi:

```ts
        if (s.specId) {
          await advanceStage(s.specId, project.repoDir, id, s.flow, s.cwd);
          // Bacaan terakhir sebelum worktree lenyap: HEAD sesi = ujung range review (SPEC-176).
          try {
            const headSha = realGit.headSha(s.cwd);
            await prisma.spec.update({ where: { id: s.specId }, data: { headSha } });
          } catch { /* HEAD tak resolve — jangan blok penutupan sesi */ }
        }
```

- [x] **Step 5: Jalankan, pastikan lolos (dan test lama tetap hijau)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- terminal.route --no-file-parallelism`
Expected: PASS semua (termasuk test DELETE/stage lama).

---

### Task 5: `resolveReview` prefer SHA tersimpan di specs.ts (TDD)

**Files:**
- Modify: `server/src/routes/specs.ts:129-157`
- Test: `server/test/specs.route.test.ts`

**Interfaces:**
- Consumes: `shaResolvable` (Task 2), `specReviewRange`/`reviewFileRange` (existing), kolom SHA (Task 1).

- [x] **Step 1: Tulis test yang gagal**

Di `specs.route.test.ts` `beforeAll`, tambah repo+spec ber-SHA tersimpan yang pesannya TIDAK ber-`(spec-N)` (buktikan grep dilewati). Import `execFileSync` dari `node:child_process` di atas.

```ts
  // SPEC-176 · done via SHA tersimpan; pesan commit sengaja tanpa (spec-N) → grep pasti kosong.
  const shaRepo = makeRepoWithSpecCommits(
    { "keep.txt": "satu\n" },
    [{ msg: "ubah keep tanpa penanda", changes: { "keep.txt": "satu\ndua\n" } }]);
  const shaBase = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: shaRepo, encoding: "utf8" }).trim();
  const shaHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: shaRepo, encoding: "utf8" }).trim();
  await makeProject({ id: "psha", repoDir: shaRepo });
  await makeSpec({ id: "SPEC-960", projectId: "psha", stage: "done", baseSha: shaBase, headSha: shaHead });
```

Lalu di `describe("GET /specs/:id/review")` tambah:

```ts
it("done via baseSha/headSha tersimpan — meski pesan commit tanpa (spec-N)", async () => {
  const res = await app.inject({ url: "/api/specs/SPEC-960/review" });
  expect(res.statusCode).toBe(200);
  expect(res.json().changed.map((c: any) => c.path)).toEqual(["keep.txt"]);
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- specs.route --no-file-parallelism`
Expected: FAIL — 409 (grep null, SHA belum diprefer).

- [x] **Step 3: Ubah resolveReview + import**

`specs.ts` baris 5, tambah `shaResolvable` ke import dari `../services/spec-review`.

Ganti `resolveReview` (baris 131-135) menjadi berbasis objek spec:

```ts
  // wt hidup > SHA tersimpan (ADR-0030) > grep pesan commit (kompat spec lama). Null = 409.
  const resolveReview = async (repoDir: string, spec: { id: string; baseSha: string | null; headSha: string | null }) => {
    if (existsSync(worktreeDir(repoDir, spec.id))) return { wt: true as const };
    if (spec.baseSha && spec.headSha
        && await shaResolvable(repoDir, spec.baseSha) && await shaResolvable(repoDir, spec.headSha))
      return { wt: false as const, base: spec.baseSha, head: spec.headSha };
    const r = await specCommitRange(repoDir, spec.id);
    return r ? { wt: false as const, ...r } : null;
  };
```

Di kedua route (`/review` dan `/review/*`), ganti `resolveReview(spec.project.repoDir, id)` → `resolveReview(spec.project.repoDir, spec)`.

- [x] **Step 4: Jalankan, pastikan lolos (grep-fallback SPEC-901 tetap hijau)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- specs.route --no-file-parallelism`
Expected: PASS semua (SPEC-960 stored-SHA, SPEC-901 grep-fallback, SPEC-172 409).

---

### Task 6: Update api-contract + verifikasi nyata + commit/push

**Files:**
- Modify: `internal/docs/architecture/api-contract.md:48-51`

- [x] **Step 1: Update dok endpoint review**

Ganti komentar done-review (baris ~49-50) agar menyebut SHA tersimpan:

```
GET  /specs/:id/review        # { base, files:string[], changed:{path,add,del,status,binary}[] }  (SPEC-171)
#   worktree ada → diff working tree atas merge-base(branchFrom‖main). worktree lenyap (done) →
#   diff baseSha..headSha tersimpan (SPEC-176, ADR-0030); fallback grep (spec-N) utk spec lama. 409 bila tak ada sumber.
```

- [x] **Step 2: Suite penuh server + runner hijau**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner test
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- --no-file-parallelism
```
Expected: semua PASS.

- [x] **Step 3: Verifikasi API nyata (bukan hanya unit test)**

Boot server terhadap DB throwaway ter-migrate (memory: jangan pakai hanoman_test/port 8787 dev), seed 1 project + 1 spec `done` dengan `baseSha`/`headSha` commit nyata, lalu `curl GET /api/specs/:id/review` → cek `changed` berisi file yang benar; `curl .../review/<path>` → cek `diff`/`content`. Skrip verifikasi ditaruh di scratchpad. Fixing sampai hijau bila ada issue.

- [x] **Step 4: Centang semua kotak plan ini, lalu commit + push**

```bash
git add -A
git commit -m "fix(server): review backlog done pakai baseSha/headSha tersimpan (SPEC-176)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin HEAD:refs/heads/hanoman/spec-176
```

## Self-Review

- **Spec coverage:** SHA start+end tersimpan (Task 1,4) ✓; diff pakai SHA bukan branch/grep (Task 5) ✓; kompat spec lama (Task 5 fallback) ✓; frontend tak berubah (respons sama) ✓; migration+ADR (Task 1, ADR-0030) ✓.
- **Placeholder scan:** semua step ber-kode konkret ✓.
- **Type consistency:** `headSha(worktree)`, `shaResolvable(repoDir, sha)`, `baseSha/headSha` konsisten antar Task 1→5 ✓.
