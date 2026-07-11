# Merge optional fast-forward (SPEC-193) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beri user pilihan perilaku fast-forward saat merge dari Terminal / IDE git graph.

**Architecture:** Field opsional `ff` (`"no-ff" | "ff-only"`) pada op merge, dialirkan menu graf → api client → `POST /projects/:id/git` → `gitArgs`. Absen = default git sekarang (backward compatible).

**Tech Stack:** TypeScript, Node child_process (git), React, vitest.

## Global Constraints
- TypeScript strict; test untuk logika orchestrasi git.
- Update `internal/docs` yang tersentuh dalam commit yang sama.
- Field `ff` absen HARUS = perilaku lama (`git merge --no-edit <ref>`) — nol regresi.

---

### Task 1: Backend — opsi `ff` di op merge git-ide

**Files:**
- Modify: `server/src/services/git-ide.ts` (GitOp merge type ~133, `gitArgs` ~160, `validateGitOp` ~148)
- Test: `server/test/git-ide.test.ts`
- Docs: `internal/docs/architecture/api-contract.md` (blok `POST /projects/:id/git` ~91-93)

**Interfaces:**
- Produces: `GitOp` merge = `{ op: "merge"; ref: string; ff?: "no-ff" | "ff-only" }`.
  `gitArgs`: absen→`["merge","--no-edit",ref]`, `no-ff`→`[...,"--no-ff",ref]`, `ff-only`→`[...,"--ff-only",ref]`.
  `validateGitOp`: merge dgn `ff` selain `"no-ff"`/`"ff-only"` → string error; absen → null.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/git-ide.test.ts` (butuh helper `makeRepoWithBranches` + import `runGitOp`, `validateGitOp` yang sudah ada; tambah repo divergen inline):

```ts
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const parentsOf = (dir: string): string[] =>
  spawnSync("git", ["rev-list", "--parents", "-n1", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim().split(" ");

// main & dev di base yang sama, lalu dev MAJU 1 commit → dev bisa di-fast-forward ke main.
// HEAD ditinggal di main (tertinggal 1 commit di belakang dev).
function makeFfRepo(): string {
  const dir = makeRepoWithBranches("dev"); // main & dev di commit base yang sama
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("checkout", "-q", "dev"); writeFileSync(`${dir}/on-dev.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev ahead");
  g("checkout", "-q", "main");
  return dir; // HEAD=main; merge dev BISA fast-forward
}

// main & dev sama-sama maju 1 commit dari base (file beda) → divergen, tak bisa fast-forward.
function makeDivergentRepo(): string {
  const dir = makeRepoWithBranches("dev");
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  writeFileSync(`${dir}/on-main.txt`, "m"); g("add", "-A"); g("commit", "-qm", "main advance");
  g("checkout", "-q", "dev"); writeFileSync(`${dir}/on-dev.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev advance");
  g("checkout", "-q", "main");
  return dir; // HEAD=main, merge dev tak bisa fast-forward
}

it("runGitOp merge --no-ff selalu buat merge commit (walau bisa ff)", async () => {
  const dir = makeFfRepo();
  const r = await runGitOp(dir, { op: "merge", ref: "dev", ff: "no-ff" });
  expect(r.ok).toBe(true);
  expect(parentsOf(dir).length).toBe(3); // commit + 2 parent = merge commit
});

it("runGitOp merge --ff-only gagal saat divergen (bukan throw)", async () => {
  const r = await runGitOp(makeDivergentRepo(), { op: "merge", ref: "dev", ff: "ff-only" });
  expect(r.ok).toBe(false);
  expect(r.stderr).toMatch(/not possible to fast-forward|fast-forward/i);
});

it("runGitOp merge tanpa ff = default (fast-forward: HEAD pindah tanpa merge commit)", async () => {
  const dir = makeFfRepo();
  const r = await runGitOp(dir, { op: "merge", ref: "dev" });
  expect(r.ok).toBe(true);
  expect(parentsOf(dir).length).toBe(2); // ff ke commit dev (1 parent) → commit + 1 parent
});

it("validateGitOp menolak ff tak dikenal, terima no-ff/ff-only/absen", () => {
  expect(validateGitOp({ op: "merge", ref: "x", ff: "bogus" })).toBeTruthy();
  expect(validateGitOp({ op: "merge", ref: "x", ff: "no-ff" })).toBeNull();
  expect(validateGitOp({ op: "merge", ref: "x", ff: "ff-only" })).toBeNull();
  expect(validateGitOp({ op: "merge", ref: "x" })).toBeNull();
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/git-ide.test.ts`
Expected: FAIL — `ff` bukan field valid di tipe / `--no-ff` tak muncul / validateGitOp lolos `ff:"bogus"`.

- [x] **Step 3: Implementasi minimal di `git-ide.ts`**

Tipe (`GitOp` merge):
```ts
  | { op: "merge"; ref: string; ff?: "no-ff" | "ff-only" }
```
`gitArgs` case merge:
```ts
    case "merge": return ["merge", "--no-edit", ...(op.ff ? [`--${op.ff}`] : []), op.ref];
```
`validateGitOp` case merge (ganti baris `case "merge": return need("ref");`):
```ts
    case "merge": {
      const e = need("ref"); if (e) return e;
      if (o.ff !== undefined && o.ff !== "no-ff" && o.ff !== "ff-only") return "ff harus no-ff atau ff-only";
      return null;
    }
```

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/git-ide.test.ts`
Expected: PASS semua, termasuk test lama.

- [x] **Step 5: Update docs (commit yang sama)**

Di `internal/docs/architecture/api-contract.md`, blok `POST /projects/:id/git`, tambah satu baris menjelaskan opsi merge `ff`:
```
#   merge menerima ff opsional: absen=default git (ff bila bisa); "no-ff"=selalu merge commit; "ff-only"=ff saja (409 bila tak bisa).
```

- [x] **Step 6: Commit**

```bash
git add server/src/services/git-ide.ts server/test/git-ide.test.ts internal/docs/architecture/api-contract.md
git commit -m "feat(git-ide): opsi fast-forward pada merge terminal (SPEC-193)"
```

---

### Task 2: Frontend — pilihan ff di menu git graph

**Files:**
- Modify: `src/src/api/client.ts` (GitOp merge ~27)
- Modify: `src/src/screens/GitGraph.tsx` (menu items ~139)

**Interfaces:**
- Consumes: op merge dgn `ff` dari Task 1 (dilewatkan apa adanya oleh route).
- Produces: tiga item menu yang mengirim `{op:"merge",ref}`, `{...,ff:"no-ff"}`, `{...,ff:"ff-only"}`.

- [ ] **Step 1: Selaraskan tipe client**

`src/src/api/client.ts` — ganti baris merge:
```ts
  | { op: "merge"; ref: string; ff?: "no-ff" | "ff-only"; force?: boolean }
```

- [ ] **Step 2: Ganti item menu tunggal jadi tiga pilihan**

`src/src/screens/GitGraph.tsx` — ganti baris `{ label: "Merge ke branch ini", ... }`:
```tsx
        { label: "Merge (fast-forward bila bisa)", run: () => act({ op: "merge", ref: menu.c.sha }) },
        { label: "Merge tanpa fast-forward", run: () => act({ op: "merge", ref: menu.c.sha, ff: "no-ff" }) },
        { label: "Merge fast-forward saja", run: () => act({ op: "merge", ref: menu.c.sha, ff: "ff-only" }) },
```

- [ ] **Step 3: Typecheck + build frontend**

Run: `cd src && pnpm tsc --noEmit` (atau `pnpm build`)
Expected: nol error tipe.

- [ ] **Step 4: Commit**

```bash
git add src/src/api/client.ts src/src/screens/GitGraph.tsx
git commit -m "feat(ide): pilihan fast-forward di menu merge git graph (SPEC-193)"
```

---

### Task 3: Verifikasi end-to-end nyata (bukan hanya unit test)

- [ ] **Step 1: Boot server + curl endpoint git dengan opsi ff**

Ikuti pola smoke repo ini (DB throwaway, port bukan 8787). Buat project ber-`repoDir` yang punya branch bisa/ tak-bisa ff, lalu:
```bash
# --no-ff pada branch yang bisa ff → harus tetap ok + jadi merge commit
curl -s -XPOST localhost:<port>/projects/<id>/git -H 'content-type: application/json' \
  -d '{"op":"merge","ref":"<branch>","ff":"no-ff","force":true}'
# --ff-only pada branch divergen → harus 409 dengan stderr fast-forward
curl -s -XPOST localhost:<port>/projects/<id>/git -H 'content-type: application/json' \
  -d '{"op":"merge","ref":"<branch>","ff":"ff-only","force":true}'
# ff tak dikenal → 400
curl -s -XPOST localhost:<port>/projects/<id>/git -H 'content-type: application/json' \
  -d '{"op":"merge","ref":"<branch>","ff":"bogus","force":true}'
```
Expected: no-ff→200 merge commit; ff-only divergen→409; bogus→400.

- [ ] **Step 2: Jalankan suite server penuh (regresi)**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm test`
Expected: hijau (tak ada test lama yang patah).
