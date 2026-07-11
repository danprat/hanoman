# Merge ke local (SPEC-185) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat "merge sebuah done spec ke branch lokal" benar-benar tuntas ketika branch target sedang di-checkout (kasus nyata: `main`), lewat fast-forward di worktree pemiliknya; kembalikan 409 actionable hanya bila working tree kotor/bukan-ff.

**Architecture:** Perbaikan terpusat di jalur `branch-f` (finalisasi merge→lokal) di `server/src/services/integrate.ts`. Merge commit di worktree isolasi selalu descendant tip target, jadi branch lokal cukup di-`merge --ff-only` di worktree pemiliknya. Worktree pemilik ditemukan via `git worktree list --porcelain`. Route, frontend, dan skema tak berubah.

**Tech Stack:** Node + TypeScript (ESM), `node:child_process` spawnSync, vitest, git.

## Global Constraints

- TypeScript strict. Tak ada dependency baru.
- Tak menyentuh alur rebase maupun merge→origin.
- Tak spawn `claude -p` di working tree utama (CLAUDE.md: jangan jalankan run di working tree utama). Kasus kotor → error actionable ke terminal user.
- Tak ubah skema; tak ubah frontend.
- Update `internal/docs/architecture/api-contract.md` dalam commit yang sama.
- Spec: `docs/superpowers/specs/2026-07-11-merge-ke-local-spec-185-design.md`.

---

### Task 1: Auto fast-forward merge ke branch lokal yang sedang di-checkout

**Files:**
- Modify: `server/src/services/integrate.ts` (jalur `branch-f`, tipe `Finalize`, helper baru)
- Test: `server/test/integrate.test.ts` (ganti test 40-43, tambah dua test)

**Interfaces:**
- Consumes: `integrate(repoDir, specId, op, target)` (tanda tangan tetap).
- Produces:
  - `worktreeForBranch(repoDir: string, branch: string): string | null` — path worktree yang meng-checkout `refs/heads/<branch>`, atau `null` bila tak ada.
  - `Finalize` varian `branch-f` kini `{ kind: "branch-f"; branch: string; checkout: string | null }`.
  - `runFinalize(...)` untuk `branch-f`: `checkout === null` → `git branch -f`; selain itu `git -C <checkout> merge --ff-only <head>`; gagal → `{ ok:false, error }` (dipetakan route ke 409).

- [x] **Step 1: Tulis test yang gagal (ganti test 40-43 + tambah dua kasus)**

Di `server/test/integrate.test.ts`, tambah import:

```typescript
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
```

Ganti blok `it("→ lokal branch yang sedang di-checkout (main) → 409 gagal-aman", ...)` (baris 40-43) dengan:

```typescript
  it("→ lokal checked-out (main), tree bersih: fast-forward, main maju ke commit merge", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = integrate(repoDir, "SPEC-1", "merge", "local:main");
    expect(r.status).toBe("clean");
    expect(showRepo(repoDir, "main", "work.txt")).toBe("work\n");
  });
  it("→ lokal checked-out, working tree kotor bertabrakan → 409", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    // merge akan menambah work.txt; file untracked bernama sama memblokir fast-forward.
    writeFileSync(join(repoDir, "work.txt"), "uncommitted\n");
    expect(integrate(repoDir, "SPEC-1", "merge", "local:main")).toMatchObject({ status: "error", code: 409 });
  });
```

(Test `→ lokal (branch tak ter-checkout): branch maju ke commit merge` yang ada — `local:staging` — dibiarkan; ia menjaga jalur `git branch -f` tetap hidup.)

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/integrate.test.ts -t "checked-out"`
Expected: kasus "tree bersih: fast-forward" FAIL (kini masih `status:"error"`, bukan `"clean"`).

- [x] **Step 3: Tambah helper `worktreeForBranch`**

Di `server/src/services/integrate.ts`, tepat setelah `refExists` (baris 20), tambah:

```typescript
// Path worktree yang meng-checkout refs/heads/<branch>, atau null bila tak ter-checkout di mana pun.
// Parsing `git worktree list --porcelain`: blok "worktree <path>" ... "branch refs/heads/<name>".
function worktreeForBranch(repoDir: string, branch: string): string | null {
  let path: string | null = null;
  for (const line of out(repoDir, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}
```

- [x] **Step 4: Perluas tipe `Finalize` (baris 48-51) untuk membawa `checkout`**

```typescript
type Finalize =
  | { kind: "branch-f"; branch: string; checkout: string | null }
  | { kind: "push"; branch: string }
  | { kind: "force-push"; branch: string };
```

- [x] **Step 5: Isi `checkout` saat membangun `finalize` (baris 76-80)**

```typescript
  const finalize: Finalize = op === "rebase"
    ? { kind: "force-push", branch: sourceBranch(specId) }
    : tgt.dest === "local"
      ? { kind: "branch-f", branch: tgt.name, checkout: worktreeForBranch(repoDir, tgt.name) }
      : { kind: "push", branch: tgt.name };
```

- [x] **Step 6: Tulis ulang cabang `branch-f` di `runFinalize` (baris 96-102)**

```typescript
  if (f.kind === "branch-f") {
    const head = out(wt, ["rev-parse", "HEAD"]);
    // Tak di-checkout: git izinkan branch -f langsung.
    if (f.checkout === null)
      return ok(repoDir, ["branch", "-f", f.branch, head])
        ? { ok: true, detail: `lokal ${f.branch} → ${head.slice(0, 7)}` }
        : { ok: false, error: `gagal memperbarui branch "${f.branch}"` };
    // Di-checkout: fast-forward DI worktree pemiliknya → ref+index+tree konsisten, edit uncommitted
    // yang tak bertabrakan tetap aman (git membatalkan bila akan menimpa).
    return ok(f.checkout, ["merge", "--ff-only", head])
      ? { ok: true, detail: `lokal ${f.branch} (ff) → ${head.slice(0, 7)}` }
      : { ok: false, error: `working tree "${f.branch}" ada perubahan belum tersimpan atau bukan fast-forward — commit/stash lalu ulangi, atau pilih target origin` };
  }
```

- [x] **Step 7: Jalankan test, pastikan hijau**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/integrate.test.ts`
Expected: PASS semua (termasuk `local:staging` clean, checked-out clean-ff, dirty→409, conflict origin, rebase).

---

### Task 2: Perbaiki instruksi finalisasi conflict → lokal (pakai merge --ff-only)

**Files:**
- Modify: `server/src/services/integrate.ts` (`finalizeInstruction`)
- Test: `server/test/integrate.test.ts` (tambah satu test)

**Interfaces:**
- Consumes: `Finalize.branch-f.checkout` (dari Task 1).
- Produces: `finalizeInstruction` untuk branch-f menghasilkan, bila `checkout !== null`, perintah `git -C <checkout> merge --ff-only $(git rev-parse HEAD)` (dijalankan sesi claude DARI worktree merge sesudah resolve+commit; `$(...)` di-evaluasi di worktree merge → commit resolusi, `-C <checkout>` mendaratkannya). Bila `checkout === null` tetap `git branch -f <b> HEAD`.

- [x] **Step 1: Tulis test yang gagal**

Di `server/test/integrate.test.ts`, dalam `describe("integrate — merge conflict", ...)`, tambah:

```typescript
  it("konflik → lokal checked-out: finalize pakai merge --ff-only, bukan branch -f", () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
    });
    const r = integrate(repoDir, "SPEC-1", "merge", "local:main");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.finalize).toContain("merge --ff-only");
      expect(r.finalize).not.toContain("git branch -f");
    }
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/integrate.test.ts -t "merge --ff-only"`
Expected: FAIL — `r.finalize` masih memuat `git branch -f main HEAD`.

- [x] **Step 3: Perbaiki `finalizeInstruction` (baris 112-121)**

Ganti pembentukan `push` agar branch-f menghormati `checkout`:

```typescript
function finalizeInstruction(op: IntegrateOp, f: Finalize): string {
  const push = f.kind === "force-push"
    ? `git push --force-with-lease origin HEAD:refs/heads/${f.branch}`
    : f.kind === "push"
      ? `git push origin HEAD:refs/heads/${f.branch}`
      : f.checkout !== null
        ? `git -C ${f.checkout} merge --ff-only $(git rev-parse HEAD)`
        : `git branch -f ${f.branch} HEAD`;
  return op === "merge"
    ? `Sesudah resolve konflik: \`git add -A && git commit --no-edit\`, lalu \`${push}\`.`
    : `Sesudah resolve tiap konflik: \`git add -A && git rebase --continue\` (ulangi sampai selesai), lalu \`${push}\`.`;
}
```

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/integrate.test.ts`
Expected: PASS semua.

---

### Task 3: Perbarui docs SoT + verifikasi menyeluruh (suite + smoke API nyata)

**Files:**
- Modify: `internal/docs/architecture/api-contract.md:61-62`

- [x] **Step 1: Perbarui deskripsi finalisasi merge→lokal**

Ganti baris 61-62 (blok yang diawali `#   merge → target: ...`):

```
#   merge → target: base tip target, `git merge` branch spec; bersih → target lokal: `git branch -f` bila
#     branch tak di-checkout, else fast-forward `git merge --ff-only` di worktree pemiliknya (409 bila working
#     tree kotor/bukan-ff — commit/stash lalu ulangi atau pilih origin). target origin `git push` (409 non-ff).
#     rebase → replay branch
```

(Sisakan baris 63 `#     spec di atas target, ...` apa adanya.)

- [x] **Step 2: Jalankan seluruh suite server terkait integrate**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/integrate.test.ts test/specs.route.test.ts`
Expected: PASS semua.

- [x] **Step 3: Build server**

Run: `cd server && pnpm build` (atau `pnpm -w --filter @hanoman/server build` sesuai konvensi repo)
Expected: sukses tanpa error TS.

- [x] **Step 4: Smoke API nyata — jalankan `integrate()` terbangun lawan git repo asli (main di-checkout)**

Tulis `scratchpad/smoke-185.mjs`:

```javascript
import { integrate } from "../server/dist/services/integrate.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "smoke185-"));
const origin = mkdtempSync(join(tmpdir(), "smoke185-o-"));
const g = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });
g(origin, "init", "-q", "--bare", "-b", "main");
g(dir, "init", "-q", "-b", "main");
g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
g(dir, "remote", "add", "origin", origin);
writeFileSync(join(dir, "file.txt"), "base\n"); g(dir, "add", "-A"); g(dir, "commit", "-qm", "base");
g(dir, "checkout", "-q", "-b", "hanoman/spec-1");
writeFileSync(join(dir, "work.txt"), "work\n"); g(dir, "add", "-A"); g(dir, "commit", "-qm", "feat(SPEC-1): work");
g(dir, "checkout", "-q", "main");                    // main di-checkout, seperti repo nyata
g(dir, "push", "-q", "origin", "main", "hanoman/spec-1");

const r = integrate(dir, "SPEC-1", "merge", "local:main");
console.log("result:", JSON.stringify(r));
const landed = execFileSync("git", ["-C", dir, "show", "main:work.txt"], { encoding: "utf8" });
rmSync(dir, { recursive: true, force: true }); rmSync(origin, { recursive: true, force: true });
if (r.status !== "clean" || landed !== "work\n") { console.error("SMOKE FAIL"); process.exit(1); }
console.log("SMOKE OK — merge ke local:main mendarat, main.work.txt =", JSON.stringify(landed));
```

Run: `node scratchpad/smoke-185.mjs`
Expected: `SMOKE OK` dan `result: {"status":"clean",...}`. (Bila path `dist` beda, sesuaikan import ke lokasi build.)

- [x] **Step 5: Centang seluruh checklist plan ini (`- [ ]` → `- [x]`), lalu commit gabungan**

Semua kotak di plan ini harus `- [x]` sebelum menulis `Execute done`.

```bash
git add server/src/services/integrate.ts server/test/integrate.test.ts internal/docs/architecture/api-contract.md docs/superpowers/specs/2026-07-11-merge-ke-local-spec-185-design.md docs/superpowers/plans/2026-07-11-merge-ke-local-spec-185.md
git commit -m "fix(integrate): merge ke branch lokal yang di-checkout via fast-forward (SPEC-185)"
```

---

## Self-Review

**Spec coverage:**
- Kasus tak-checkout (`git branch -f`) → Task 1 (dipertahankan, test `local:staging`). ✓
- Kasus checked-out bersih → auto ff → Task 1 (test clean-ff + smoke). ✓
- Kasus checked-out kotor/bukan-ff → 409 actionable → Task 1 (test dirty→409). ✓
- Konsistensi conflict→lokal (ff-only, bukan branch -f) → Task 2. ✓
- Docs SoT api-contract → Task 3. ✓
- Tak ada perubahan frontend/skema/rebase/origin → dijaga Global Constraints. ✓

**Placeholder scan:** tak ada TBD/TODO; semua langkah memuat kode/perintah konkret. ✓

**Type consistency:** `worktreeForBranch` (repoDir, branch)→string|null; `Finalize.branch-f.checkout: string|null` dipakai konsisten di `runFinalize` (Task 1) dan `finalizeInstruction` (Task 2). ✓
