# File changed & staged di IDE Explorer — Implementation Plan (SPEC-234)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Tambah section **Staged** & **Changed** (list + tree view, klik → diff) di IDE Explorer, menurunkan status working tree dari git tiap request.

**Architecture:** Dua endpoint read-only baru (`GET /projects/:id/status`, `GET /projects/:id/file-diff`) menurunkan staged (index vs HEAD) & unstaged (working tree vs index, temp-index untuk untracked) dari git. Frontend meng-ekstrak `DiffView` & `ChangedSection` ke modul shared lalu memakainya di ReviewScreen **dan** IdeScreen. Tanpa perubahan skema/ADR.

**Tech Stack:** Node + TypeScript (Fastify), git via `execFile`, React + TypeScript (Vite), vitest.

## Global Constraints

- **Reuse component yang sudah ada** (brief): `ChangedFile` type, `buildFileTree`/`TreeRow` (`meta`+`defaultOpen`), toggle List|Tree, `DiffView` — jangan tulis ulang, ekstrak & pakai bersama.
- **TypeScript strict.** Test untuk tiap logika (status split, route, UI).
- **Read-only.** Tak ada mutasi git; endpoint status/file-diff **tak** digerbang sesi aktif (cermin `GET /tree`, `GET /file`).
- **Docs tersentuh diperbarui dalam commit yang sama** + ter-link di `internal/docs/README.md`.
- Jalankan test repo: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test` (server) & `pnpm --filter @hanoman/app test` (web) — atau `vitest run --no-file-parallelism` per paket. Jangan biarkan env prod bocor.
- Semua bekerja pada **`Project.repoDir` (working tree utama)**, diturunkan tiap request (tanpa cache, cermin ADR-0018).

## File Structure

- `server/src/services/spec-review.ts` — ekspor `changedFiles` & `withTempIndex` (sekarang private) untuk reuse.
- `server/src/services/git-ide.ts` — tambah `workingStatus` + `workingFileDiff`.
- `server/src/routes/ide.ts` — tambah `GET /status` + `GET /file-diff`.
- `server/test/factory.ts` — tambah `makeRepoWithChanges()`.
- `server/test/git-ide.test.ts`, `server/test/ide.route.test.ts` — test service & route.
- `shared/src/api.ts` — `ideStatus`, `ideFileDiff` paths.
- `src/src/api/client.ts` — `WorkingStatus` type + `ideStatus`/`ideFileDiff` methods.
- `src/src/screens/diff-view.tsx` — **baru**, `DiffView` shared (dipindah dari ReviewScreen).
- `src/src/screens/file-tree.tsx` — tambah `ChangedRow` + `ChangedSection` shared.
- `src/src/screens/ReviewScreen.tsx` — pakai `DiffView` shared + `ChangedSection`.
- `src/src/screens/IdeScreen.tsx` — section Staged/Changed + diff pane.
- `src/test/ide-screen.test.tsx` — test UI baru.
- `internal/docs/frontend/frontend-implementation.md`, `internal/docs/architecture/api-contract.md` — docs.

---

## Task 1: Server — export helpers, factory, `workingStatus`

**Files:**
- Modify: `server/src/services/spec-review.ts` (export `changedFiles`, `withTempIndex`)
- Modify: `server/src/services/git-ide.ts` (add `workingStatus`)
- Modify: `server/test/factory.ts` (add `makeRepoWithChanges`)
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Consumes: `ChangedFile` (already exported from `spec-review.ts`), `currentBranch` (private in `git-ide.ts`), `existsSync` (already imported in `git-ide.ts`).
- Produces:
  - `export async function changedFiles(cwd: string, revs: string[], env?: NodeJS.ProcessEnv): Promise<ChangedFile[]>`
  - `export async function withTempIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T>`
  - `export async function workingStatus(repoDir: string | null): Promise<{ branch: string; staged: ChangedFile[]; unstaged: ChangedFile[] }>`
  - `makeRepoWithChanges(): string` (test factory)

- [x] **Step 1: Export the two helpers from spec-review.ts**

In `server/src/services/spec-review.ts`, add `export` to the two existing function declarations (no body change):

```ts
export async function withTempIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
```

```ts
export async function changedFiles(cwd: string, revs: string[], env?: NodeJS.ProcessEnv): Promise<ChangedFile[]> {
```

- [x] **Step 2: Add the factory helper**

In `server/test/factory.ts`, append after `makeRepoWithSpecCommits`:

```ts
// SPEC-234 · repo dengan satu commit base lalu keadaan working tree bercampur:
//   staged.txt  = tracked, dimodifikasi & `git add` (STAGED, index vs HEAD)
//   tracked.txt = tracked, dimodifikasi TANPA add (CHANGED unstaged, working tree vs index)
//   new.txt     = untracked (CHANGED unstaged, muncul via temp-index intent-to-add)
// HEAD di main. Mengembalikan repoDir.
export function makeRepoWithChanges(): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-chg-"));
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "staged.txt"), "one\n");
  writeFileSync(join(dir, "tracked.txt"), "keep\n");
  g("add", "-A"); g("commit", "-qm", "base");
  writeFileSync(join(dir, "staged.txt"), "one\ntwo\n"); g("add", "staged.txt"); // staged M
  writeFileSync(join(dir, "tracked.txt"), "keep\nmore\n");                       // unstaged M
  writeFileSync(join(dir, "new.txt"), "brand\nnew\n");                            // untracked → A
  return dir;
}
```

- [x] **Step 3: Write the failing test for `workingStatus`**

In `server/test/git-ide.test.ts`, update the import on line 3 to add `workingStatus`, and add `makeRepoWithChanges` to the factory import on line 2:

```ts
import { makeTempRepo, makeRepoWithBranches, makeRepoWithSpecCommits, makeRepoWithSpecBranch, makeRepoWithChanges } from "./factory";
import { listRepoTree, readRepoFile, repoAbsPath, listGraph, commitDetail, writeRepoFile, runGitOp, validateGitOp, workingStatus } from "../src/services/git-ide";
```

Then append this describe block at the end of the file:

```ts
describe("git-ide working status (SPEC-234)", () => {
  it("memisah staged (index vs HEAD) dari unstaged (working tree vs index) + untracked", async () => {
    const s = await workingStatus(makeRepoWithChanges());
    expect(s.branch).toBe("main");
    expect(s.staged.map((c) => c.path)).toEqual(["staged.txt"]);
    expect(s.staged[0]!).toMatchObject({ status: "M", add: 1, del: 0, binary: false });
    // unstaged terurut path: new.txt (untracked→A), tracked.txt (M)
    expect(s.unstaged.map((c) => c.path)).toEqual(["new.txt", "tracked.txt"]);
    expect(s.unstaged.find((c) => c.path === "new.txt")!).toMatchObject({ status: "A", add: 2, del: 0 });
    expect(s.unstaged.find((c) => c.path === "tracked.txt")!).toMatchObject({ status: "M", add: 1, del: 0 });
  });
  it("repoDir null / bukan repo → kosong, tak throw", async () => {
    expect(await workingStatus(null)).toEqual({ branch: "", staged: [], unstaged: [] });
    expect(await workingStatus(makeTempRepo({}) + "/nope")).toEqual({ branch: "", staged: [], unstaged: [] });
  });
  it("working tree bersih → staged & unstaged kosong", async () => {
    expect(await workingStatus(makeRepoWithBranches())).toMatchObject({ branch: "main", staged: [], unstaged: [] });
  });
});
```

- [x] **Step 4: Run the test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/git-ide.test.ts -t "working status"`
Expected: FAIL — `workingStatus is not a function` (not yet implemented).

- [x] **Step 5: Implement `workingStatus` in git-ide.ts**

In `server/src/services/git-ide.ts`, add to the import of `spec-review` (currently `import type { ChangedFile } from "./spec-review";`), splitting into a value import + type import:

```ts
import { changedFiles, withTempIndex, type ChangedFile } from "./spec-review";
```

Then append at the end of the file:

```ts
// SPEC-234 · status working tree utama, diturunkan dari git (tak dipersist). staged = index vs HEAD;
// unstaged = working tree vs index memakai pola temp-index specReview (SPEC-144) → file untracked
// tampil "A" dgn hitungan baris nyata, index asli tak tersentuh. Independen dari ref yang dilihat.
export async function workingStatus(
  repoDir: string | null,
): Promise<{ branch: string; staged: ChangedFile[]; unstaged: ChangedFile[] }> {
  if (!repoDir || !existsSync(repoDir)) return { branch: "", staged: [], unstaged: [] };
  const [branch, staged, unstaged] = await Promise.all([
    currentBranch(repoDir),
    changedFiles(repoDir, ["--cached"]),
    withTempIndex(repoDir, (env) => changedFiles(repoDir, [], env)),
  ]);
  return { branch, staged, unstaged };
}
```

- [x] **Step 6: Run the test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/git-ide.test.ts -t "working status"`
Expected: PASS (3 tests).

- [x] **Step 7: Commit**

```bash
git add server/src/services/spec-review.ts server/src/services/git-ide.ts server/test/factory.ts server/test/git-ide.test.ts
git commit -m "feat(server): workingStatus derives staged/unstaged from working tree — SPEC-234"
```

---

## Task 2: Server — `workingFileDiff`

**Files:**
- Modify: `server/src/services/git-ide.ts` (add `workingFileDiff`)
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Consumes: `changedFiles`, `withTempIndex` (Task 1), `repoAbsPath`, `exec`, `GIT`, `MAX`, `readFile` (all in `git-ide.ts`); `ReviewFile` from `spec-review.ts`.
- Produces: `export async function workingFileDiff(repoDir: string | null, path: string, staged: boolean): Promise<ReviewFile | null>`

- [x] **Step 1: Write the failing test**

In `server/test/git-ide.test.ts`, add `workingFileDiff` to the `git-ide` import, and append:

```ts
describe("git-ide working file-diff (SPEC-234)", () => {
  it("staged: diff index vs HEAD + isi index", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "staged.txt", true);
    expect(f!.status).toBe("M");
    expect(f!.diff).toMatch(/\+two/);
    expect(f!.content).toBe("one\ntwo\n");
  });
  it("unstaged untracked: diff new-file penuh + isi disk", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "new.txt", false);
    expect(f!.status).toBe("A");
    expect(f!.diff).toMatch(/\+brand/);
    expect(f!.diff).toMatch(/\+new/);
    expect(f!.content).toBe("brand\nnew\n");
  });
  it("unstaged tracked: diff working tree vs index", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "tracked.txt", false);
    expect(f!.status).toBe("M");
    expect(f!.diff).toMatch(/\+more/);
  });
  it("file tak dalam changeset → null (gerbang 404)", async () => {
    expect(await workingFileDiff(makeRepoWithChanges(), "staged.txt", false)).toBeNull();
    expect(await workingFileDiff(makeRepoWithChanges(), "ghost.txt", true)).toBeNull();
  });
  it("path keluar repo / .git → throw (gerbang 400)", async () => {
    await expect(workingFileDiff(makeRepoWithChanges(), "../evil", true)).rejects.toThrow();
    await expect(workingFileDiff(makeRepoWithChanges(), ".git/config", false)).rejects.toThrow();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/git-ide.test.ts -t "working file-diff"`
Expected: FAIL — `workingFileDiff is not a function`.

- [x] **Step 3: Implement `workingFileDiff`**

In `server/src/services/git-ide.ts`, change the spec-review import to also bring in `ReviewFile` type:

```ts
import { changedFiles, withTempIndex, type ChangedFile, type ReviewFile } from "./spec-review";
```

Then append after `workingStatus`:

```ts
// SPEC-234 · diff satu file working tree. staged=true → git diff --cached (index vs HEAD), isi = index
// (`git show :path`). staged=false → working tree vs index lewat temp-index (untracked jadi diff
// new-file), isi = disk. status D → content null. Bentuk = ReviewFile (dipakai DiffView bersama).
export async function workingFileDiff(
  repoDir: string | null, path: string, staged: boolean,
): Promise<ReviewFile | null> {
  if (!repoDir || !existsSync(repoDir)) return null;
  repoAbsPath(repoDir, path); // throws → route 400
  const changed = staged
    ? await changedFiles(repoDir, ["--cached"])
    : await withTempIndex(repoDir, (env) => changedFiles(repoDir, [], env));
  const cf = changed.find((c) => c.path === path);
  if (!cf) return null; // file bukan bagian changeset → route 404
  if (cf.binary) return { path, status: cf.status, binary: true, truncated: false, diff: null, content: null };
  const diffRaw = staged
    ? (await exec("git", ["diff", "--cached", "--", path], { cwd: repoDir, ...GIT })).stdout
    : await withTempIndex(repoDir, async (env) =>
        (await exec("git", ["diff", "--", path], { cwd: repoDir, env, ...GIT })).stdout);
  let contentRaw: string | null = null;
  if (cf.status !== "D") {
    try {
      contentRaw = staged
        ? (await exec("git", ["show", `:${path}`], { cwd: repoDir, ...GIT })).stdout
        : await readFile(repoAbsPath(repoDir, path), "utf8");
    } catch { contentRaw = null; }
  }
  return {
    path, status: cf.status, binary: false,
    truncated: diffRaw.length > MAX || (contentRaw?.length ?? 0) > MAX,
    diff: diffRaw.slice(0, MAX),
    content: contentRaw === null ? null : contentRaw.slice(0, MAX),
  };
}
```

Note: `readFile` is already imported in `git-ide.ts` (line 3, `node:fs/promises`).

- [x] **Step 4: Run the test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/git-ide.test.ts -t "working file-diff"`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add server/src/services/git-ide.ts server/test/git-ide.test.ts
git commit -m "feat(server): workingFileDiff returns per-file working-tree diff — SPEC-234"
```

---

## Task 3: Routes + shared paths + client methods

**Files:**
- Modify: `shared/src/api.ts` (add `ideStatus`, `ideFileDiff`)
- Modify: `server/src/routes/ide.ts` (add two GET handlers)
- Modify: `src/src/api/client.ts` (add `WorkingStatus` type + methods)
- Test: `server/test/ide.route.test.ts`

**Interfaces:**
- Consumes: `workingStatus`, `workingFileDiff` (Tasks 1-2); `repoOf` (in `ide.ts`).
- Produces (shared paths): `ideStatus(id: string): string`, `ideFileDiff(id: string, path: string, staged: boolean): string`.
- Produces (client): `type WorkingStatus = { branch: string; staged: ChangedFile[]; unstaged: ChangedFile[] }`; `api.ideStatus(id) => Promise<WorkingStatus>`; `api.ideFileDiff(id, path, staged) => Promise<ReviewFile>`.

- [x] **Step 1: Add shared paths**

In `shared/src/api.ts`, after the `ideGitMerge` line (line 32), add:

```ts
  // SPEC-234 · status working tree (staged/unstaged) + diff satu file working tree
  ideStatus: (id: string) => `${API}/projects/${id}/status`,
  ideFileDiff: (id: string, path: string, staged: boolean) =>
    `${API}/projects/${id}/file-diff?path=${encodeURIComponent(path)}${staged ? "&staged=1" : ""}`,
```

- [x] **Step 2: Write the failing route test**

In `server/test/ide.route.test.ts`, add `makeRepoWithChanges` to the factory import (line 3), register a project in `beforeAll`, and add tests. First, in `beforeAll` add after the `nodir` line:

```ts
  await makeProject({ id: "chg", repoDir: makeRepoWithChanges() });
```

Then add inside the `describe("ide routes", ...)` block:

```ts
  it("GET /status memisah staged & unstaged; project tak ada → 404 (SPEC-234)", async () => {
    const r = await app.inject({ url: "/api/projects/chg/status" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.branch).toBe("main");
    expect(b.staged.map((c: { path: string }) => c.path)).toEqual(["staged.txt"]);
    expect(b.unstaged.map((c: { path: string }) => c.path)).toEqual(["new.txt", "tracked.txt"]);
    expect((await app.inject({ url: "/api/projects/ghost/status" })).statusCode).toBe(404);
  });
  it("GET /status project tanpa repoDir → kosong 200 (SPEC-234)", async () => {
    const r = await app.inject({ url: "/api/projects/nodir/status" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ branch: "", staged: [], unstaged: [] });
  });
  it("GET /file-diff staged/unstaged; path buruk → 400; tak berubah → 404 (SPEC-234)", async () => {
    const st = await app.inject({ url: "/api/projects/chg/file-diff?path=staged.txt&staged=1" });
    expect(st.statusCode).toBe(200);
    expect(st.json().diff).toMatch(/\+two/);
    const un = await app.inject({ url: "/api/projects/chg/file-diff?path=new.txt" });
    expect(un.statusCode).toBe(200);
    expect(un.json().status).toBe("A");
    expect((await app.inject({ url: "/api/projects/chg/file-diff?path=../evil&staged=1" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/projects/chg/file-diff?path=staged.txt" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/projects/chg/file-diff" })).statusCode).toBe(400);
  });
```

- [x] **Step 3: Run the test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/ide.route.test.ts -t "SPEC-234"`
Expected: FAIL — routes return 404 (handlers not registered yet).

- [x] **Step 4: Implement the route handlers**

In `server/src/routes/ide.ts`, add `workingStatus, workingFileDiff` to the `git-ide` import:

```ts
import {
  listRepoTree, readRepoFile, writeRepoFile, listGraph, commitDetail, runGitOp, validateGitOp,
  workingStatus, workingFileDiff, type GitOp,
} from "../services/git-ide";
```

Then add these two handlers inside the `export default async function (app)` body, after the `GET /projects/:id/file` handler:

```ts
  // SPEC-234 · status working tree utama (staged/unstaged). Read-only → TAK digerbang sesi (spt /tree).
  app.get("/projects/:id/status", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return workingStatus(repoDir);
  });

  // SPEC-234 · diff satu file working tree. staged=1 → index vs HEAD, else working tree vs index.
  app.get("/projects/:id/file-diff", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path, staged } = req.query as { path?: string; staged?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await workingFileDiff(repoDir, path, staged === "1" || staged === "true");
      return f === null ? reply.code(404).send({ error: "not found" }) : f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
```

- [x] **Step 5: Add client type + methods**

In `src/src/api/client.ts`, after the `RepoFile` type (line 24) add:

```ts
// SPEC-234 · status working tree utama (staged/unstaged), diturunkan dari git.
export type WorkingStatus = { branch: string; staged: ChangedFile[]; unstaged: ChangedFile[] };
```

And after the `ideGitMerge` method (line ~115) add:

```ts
  // SPEC-234 · status working tree + diff satu file working tree.
  ideStatus: (id: string) => j<WorkingStatus>(paths.ideStatus(id)),
  ideFileDiff: (id: string, path: string, staged: boolean) => j<ReviewFile>(paths.ideFileDiff(id, path, staged)),
```

- [x] **Step 6: Run the route test + typecheck**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/ide.route.test.ts -t "SPEC-234"`
Expected: PASS (3 tests).

Run: `pnpm --filter @hanoman/shared build && pnpm --filter @hanoman/app exec tsc --noEmit`
Expected: no type errors.

- [x] **Step 7: Commit**

```bash
git add shared/src/api.ts server/src/routes/ide.ts src/src/api/client.ts server/test/ide.route.test.ts
git commit -m "feat: GET /status + /file-diff endpoints & client methods — SPEC-234"
```

---

## Task 4: Frontend — extract shared `DiffView` + `ChangedSection`

**Files:**
- Create: `src/src/screens/diff-view.tsx`
- Modify: `src/src/screens/file-tree.tsx` (add `ChangedRow`, `ChangedSection`)
- Modify: `src/src/screens/ReviewScreen.tsx` (use shared components)
- Test: existing `src/test/*review*` suites stay green (regression via reuse)

**Interfaces:**
- Produces:
  - `export function DiffView({ diff }: { diff: string }): JSX.Element` (in `diff-view.tsx`)
  - `export function ChangedRow({ cf, selected, onSelect }: { cf: ChangedFile; selected: string; onSelect: (p: string) => void }): JSX.Element` (in `file-tree.tsx`)
  - `export function ChangedSection({ label, changed, selected, onSelect, view, onView, emptyText? }: { label: string; changed: ChangedFile[]; selected: string; onSelect: (p: string) => void; view: "list" | "tree"; onView: (v: "list" | "tree") => void; emptyText?: string }): JSX.Element` (in `file-tree.tsx`)

- [x] **Step 1: Create the shared `DiffView` module**

Create `src/src/screens/diff-view.tsx`:

```tsx
/* diff-view — render unified diff berwarna (dipakai Review & IDE Explorer, SPEC-234). */
import React from "react";
import { StateBlock } from "../ds";

export function DiffView({ diff }: { diff: string }) {
  if (!diff) return <StateBlock kind="empty" icon="check" title="Tidak ada perubahan pada file ini"
    hint="File ini bagian dari project tapi tak diubah." />;
  return (
    <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6 }}>
      {diff.split("\n").map((line, i) => {
        const plus = line.startsWith("+") && !line.startsWith("+++");
        const minus = line.startsWith("-") && !line.startsWith("---");
        const hunk = line.startsWith("@@");
        const color = plus ? "var(--leaf-600)" : minus ? "var(--clay-600)" : hunk ? "var(--brass-700)" : "var(--text-body)";
        const bg = plus ? "color-mix(in srgb, var(--leaf-500) 10%, transparent)"
          : minus ? "color-mix(in srgb, var(--clay-500) 10%, transparent)" : "transparent";
        return <div key={i} style={{ color, background: bg, padding: "0 12px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line || " "}</div>;
      })}
    </pre>
  );
}
```

- [x] **Step 2: Add `ChangedRow` + `ChangedSection` to file-tree.tsx**

In `src/src/screens/file-tree.tsx`, append at the end of the file:

```tsx
// SPEC-234 · satu baris file changed (status + path + +add/−del) — list view Changed/Staged.
export function ChangedRow({ cf, selected, onSelect }:
  { cf: ChangedFile; selected: string; onSelect: (p: string) => void }) {
  const on = cf.path === selected;
  return (
    <button onClick={() => onSelect(cf.path)} style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 10px",
      border: "none", cursor: "pointer", textAlign: "left",
      background: on ? "var(--brass-100)" : "transparent",
    }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: ST_COLOR[cf.status] }}>{cf.status}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 12,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        color: on ? "var(--brass-700)" : "var(--text-body)" }}>{cf.path}</span>
      {!cf.binary && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        <span style={{ color: "var(--leaf-600)" }}>+{cf.add}</span>{" "}
        <span style={{ color: "var(--clay-500)" }}>−{cf.del}</span>
      </span>}
    </button>
  );
}

// SPEC-234 · section changed files dgn toggle List | Tree — dipakai ReviewScreen (Changed) &
// IdeScreen (Staged + Changed). Tree = buildFileTree + TreeRow (meta+defaultOpen); list = ChangedRow.
export function ChangedSection({ label, changed, selected, onSelect, view, onView, emptyText = "Tak ada file berubah." }:
  { label: string; changed: ChangedFile[]; selected: string; onSelect: (p: string) => void;
    view: "list" | "tree"; onView: (v: "list" | "tree") => void; emptyText?: string }) {
  const tree = React.useMemo(() => buildFileTree(changed.map((c) => c.path)), [changed]);
  const meta = React.useMemo(
    () => Object.fromEntries(changed.map((c) => [c.path, c])) as Record<string, ChangedFile>, [changed]);
  return (
    <>
      <div className="hn-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
        <span style={{ flex: 1 }}>{label} · {changed.length}</span>
        {changed.length > 0 && (["list", "tree"] as const).map((v) => (
          <button key={v} aria-label={`${v === "list" ? "List" : "Tree"} ${label}`} onClick={() => onView(v)}
            style={{ display: "flex", padding: 3, border: "none", cursor: "pointer", borderRadius: 4,
              background: view === v ? "var(--brass-100)" : "transparent" }}>
            <Icon name={v === "list" ? "list" : "folder-tree"} size={14}
              color={view === v ? "var(--brass-700)" : "var(--text-subtle)"} />
          </button>
        ))}
      </div>
      {changed.length === 0
        ? <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--text-subtle)" }}>{emptyText}</div>
        : view === "tree"
        ? tree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={onSelect} meta={meta} defaultOpen />)
        : changed.map((c) => <ChangedRow key={c.path} cf={c} selected={selected} onSelect={onSelect} />)}
    </>
  );
}
```

- [x] **Step 3: Refactor ReviewScreen to use the shared components**

In `src/src/screens/ReviewScreen.tsx`:

(a) Replace the imports on lines 5-6:

```tsx
import { api, type SpecReview, type ReviewFile } from "../api/client";
import { buildFileTree, TreeRow, ChangedSection } from "./file-tree";
import { DiffView } from "./diff-view";
```

(b) Delete the local `DiffView` function (lines 8-24, the whole `function DiffView(...) { ... }`).

(c) Delete the now-unused `changedTree`/`changedMeta` memos (lines 69-71) — `ChangedSection` builds these internally. Keep the `changed` variable (line 68).

(d) Replace the Changed header + list/tree block (lines 86-119, from the `<div className="hn-eyebrow" ...>Changed · N ...</div>` through the end of the `changed.map(...)` ternary) with a single call:

```tsx
          <ChangedSection label="Changed" changed={changed} selected={selected} onSelect={setSelected}
            view={chView} onView={setChView} />
```

Leave the `Files` eyebrow + `tree.map(...)` block (lines 120-121) intact directly below it.

- [x] **Step 4: Run the review regression tests**

Run: `pnpm --filter @hanoman/app exec vitest run src/test/git-graph-view.test.tsx src/test/ide-screen.test.tsx 2>/dev/null; pnpm --filter @hanoman/app exec vitest run --no-file-parallelism`
Expected: PASS — all existing web tests green (ReviewScreen still renders Changed list/tree + diff).

If a `review` test asserts exact DOM that moved into `ChangedSection`, it still matches: `ChangedSection` renders the same `label · count` header, `ChangedRow` (same markup), and `TreeRow`. No behavior change.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/diff-view.tsx src/src/screens/file-tree.tsx src/src/screens/ReviewScreen.tsx
git commit -m "refactor(web): extract shared DiffView + ChangedSection — SPEC-234"
```

---

## Task 5: IdeScreen — Staged/Changed sections + diff pane

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx`
- Test: `src/test/ide-screen.test.tsx`

**Interfaces:**
- Consumes: `api.ideStatus`, `api.ideFileDiff` (Task 3); `ChangedSection` (Task 4); `DiffView` (Task 4); `WorkingStatus`, `ReviewFile` types.

- [x] **Step 1: Write the failing tests**

In `src/test/ide-screen.test.tsx`, add a default `ideStatus` mock to the top `beforeEach` (so existing tests keep working) — after line 12 add:

```ts
  vi.spyOn(api, "ideStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
```

Then add a new describe block at the end:

```tsx
// SPEC-234 · section Staged & Changed dari status working tree, klik → diff.
describe("IdeScreen Staged & Changed", () => {
  it("merender section Staged & Changed dari ideStatus", async () => {
    vi.spyOn(api, "ideStatus").mockResolvedValue({ branch: "main",
      staged: [{ path: "src/app.ts", add: 12, del: 3, status: "M", binary: false }],
      unstaged: [{ path: "CHANGELOG.md", add: 2, del: 1, status: "M", binary: false }] });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();   // staged (bukan di files tree)
    expect(await screen.findByText("CHANGELOG.md")).toBeInTheDocument(); // changed (bukan di files tree)
  });
  it("klik file staged → panggil ideFileDiff(staged=true) & render diff", async () => {
    vi.spyOn(api, "ideStatus").mockResolvedValue({ branch: "main",
      staged: [{ path: "app.ts", add: 1, del: 0, status: "M", binary: false }], unstaged: [] });
    vi.spyOn(api, "ideFileDiff").mockResolvedValue({ path: "app.ts", status: "M", binary: false,
      truncated: false, diff: "@@ -1 +1 @@\n+baris baru", content: "baris baru" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("app.ts"));
    await waitFor(() => expect(api.ideFileDiff).toHaveBeenCalledWith("p1", "app.ts", true));
    expect(await screen.findByText(/baris baru/)).toBeInTheDocument();
  });
  it("toggle Tree pada section Changed memakai folder tree", async () => {
    vi.spyOn(api, "ideStatus").mockResolvedValue({ branch: "main", staged: [],
      unstaged: [{ path: "docs/guide.md", add: 4, del: 0, status: "A", binary: false }] });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Tree Changed/i }));
    expect(await screen.findByText("docs/")).toBeInTheDocument(); // folder node muncul
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hanoman/app exec vitest run src/test/ide-screen.test.tsx -t "Staged & Changed"`
Expected: FAIL — sections/diff not implemented.

- [x] **Step 3: Rewrite IdeScreen.tsx**

Replace the entire contents of `src/src/screens/IdeScreen.tsx` with:

```tsx
/* IdeScreen — IDE Visual (SPEC-182): Explorer (pohon file + editor highlight) & Git Graph,
   satu toolbar (project + branch switcher). SPEC-234: section Staged/Changed + diff pane. */
import React from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import { Card, Button, Select, Icon, StateBlock, Tabs, Badge } from "../ds";
import { api, ApiError, type RepoFile, type ReviewFile, type WorkingStatus, type GitOp } from "../api/client";
import type { ProjectVM } from "./types";
import { GitGraph } from "./GitGraph";
import { buildFileTree, TreeRow, ChangedSection } from "./file-tree";
import { DiffView } from "./diff-view";

const langOf = (p: string): string => {
  const ext = p.slice(p.lastIndexOf(".") + 1);
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "xml", sh: "bash", py: "python", yml: "yaml", yaml: "yaml", sql: "sql" };
  return map[ext] ?? "";
};

// Dialog "Paksa": muncul saat mutasi git balas 409. Mengulang op dengan force:true.
function ForceDialog({ msg, onForce, onCancel }: { msg: string; onForce: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,.35)",
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card padding={20} style={{ maxWidth: 460 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--text-strong)" }}>Operasi ditolak</div>
        <pre style={{ fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "pre-wrap",
          color: "var(--text-muted)", marginBottom: 12 }}>{msg}</pre>
        <div style={{ fontSize: 12.5, color: "var(--clay-600)", marginBottom: 14 }}>
          Paksa bisa membuang perubahan tak ter-commit &amp; mengganggu sesi Claude yang jalan.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
          <Button size="sm" leftIcon="alert-triangle" onClick={onForce}>Paksa</Button>
        </div>
      </Card>
    </div>
  );
}

export function IdeScreen({ projects, projectId, onProject, onToast, onGotoTerminal }:
  { projects: ProjectVM[]; projectId: string; onProject: (id: string) => void;
    onToast?: (msg: string, tone: "ok" | "warn" | "err" | "info", icon?: string) => void;
    onGotoTerminal?: (sessionId?: string) => void }) {
  const [tab, setTab] = React.useState("explorer");
  const [viewRef, setViewRef] = React.useState("");         // branch/ref yang dilihat (kosong = working tree)
  const [branches, setBranches] = React.useState<{ branches: string[]; remotes: string[] }>({ branches: [], remotes: [] });
  const [files, setFiles] = React.useState<string[]>([]);
  const [treeState, setTreeState] = React.useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = React.useState("");
  const [selKind, setSelKind] = React.useState<"file" | "staged" | "unstaged">("file"); // sumber seleksi → viewer vs diff
  const [file, setFile] = React.useState<RepoFile | null>(null);
  const [mode, setMode] = React.useState<"view" | "edit">("view");
  const [draft, setDraft] = React.useState("");
  const [pendingForce, setPendingForce] = React.useState<{ op: GitOp; msg: string } | null>(null);
  // SPEC-234 · status working tree (staged/unstaged) + diff file terpilih.
  const [status, setStatus] = React.useState<WorkingStatus | null>(null);
  const [stagedView, setStagedView] = React.useState<"list" | "tree">("list");
  const [changedView, setChangedView] = React.useState<"list" | "tree">("list");
  const [diff, setDiff] = React.useState<ReviewFile | null>(null);
  const [diffTab, setDiffTab] = React.useState<"diff" | "source">("diff");

  const reloadTree = React.useCallback(() => {
    setTreeState("loading");
    api.ideTree(projectId, viewRef).then((t) => { setFiles(t.files); setTreeState("ready"); })
      .catch(() => setTreeState("error"));
  }, [projectId, viewRef]);
  // Status working tree independen dari ref yang dilihat (staged/unstaged inheren milik working tree).
  const reloadStatus = React.useCallback(() => {
    api.ideStatus(projectId).then(setStatus).catch(() => setStatus(null));
  }, [projectId]);

  React.useEffect(() => { reloadTree(); }, [reloadTree]);
  React.useEffect(() => { reloadStatus(); }, [reloadStatus]);
  React.useEffect(() => { api.listBranches(projectId).then(setBranches).catch(() => {}); }, [projectId]);
  // selKind "file" → isi file (editable, honor viewRef). staged/unstaged → diff read-only.
  React.useEffect(() => {
    if (!selected) { setFile(null); setDiff(null); return; }
    let alive = true;
    if (selKind === "file") {
      setDiff(null);
      api.ideFile(projectId, selected, viewRef).then((f) => { if (alive) { setFile(f); setMode("view"); } })
        .catch(() => { if (alive) setFile(null); });
    } else {
      setFile(null); setDiffTab("diff");
      api.ideFileDiff(projectId, selected, selKind === "staged").then((d) => { if (alive) setDiff(d); })
        .catch(() => { if (alive) setDiff(null); });
    }
    return () => { alive = false; };
  }, [selected, selKind, projectId, viewRef]);

  const selectFile = (p: string) => { setSelKind("file"); setSelected(p); };
  const selectStaged = (p: string) => { setSelKind("staged"); setSelected(p); };
  const selectChanged = (p: string) => { setSelKind("unstaged"); setSelected(p); };

  // Semua ref: local + origin (prefix "origin/") untuk dilihat/checkout.
  const refOptions = [
    { value: "", label: "· working tree ·" },
    ...branches.branches.map((b) => ({ value: b, label: b })),
    ...branches.remotes.map((b) => ({ value: `origin/${b}`, label: `origin/${b}` })),
  ];

  async function runGit(op: GitOp) {
    try {
      const r = await api.ideGit(projectId, op);
      setViewRef(""); reloadTree(); reloadStatus();
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setPendingForce({ op, msg: e.message });
      throw e;
    }
  }
  async function checkout() { if (viewRef) await runGit({ op: "checkout", ref: viewRef }).catch(() => {}); }
  async function mergeGraph(source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) {
    try {
      const r = await api.ideGitMerge(projectId, { source, ...opts });
      if (r.status === "conflict") { onGotoTerminal?.(r.sessionId); onToast?.("konflik merge — selesaikan di Terminal", "warn", "git-merge"); }
      else { setViewRef(""); reloadTree(); reloadStatus(); onToast?.(`merge berhasil · ${r.detail}`, "ok", "git-merge"); }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.("gagal merge" + (code === 409 ? " · cek branch/target" : ""), "err", "x-circle");
      throw e;
    }
  }
  async function confirmForce() {
    if (!pendingForce) return;
    const op = { ...pendingForce.op, force: true } as GitOp;
    setPendingForce(null);
    await api.ideGit(projectId, op).then(() => { setViewRef(""); reloadTree(); reloadStatus(); }).catch(() => {});
  }

  function startEdit() { setDraft(file?.content ?? ""); setMode("edit"); }
  async function save() {
    await api.putIdeFile(projectId, selected, draft);
    setFile((f) => (f ? { ...f, content: draft } : f)); setMode("view");
    reloadStatus(); // menyimpan file mengubah status working tree
  }

  const highlighted = React.useMemo(() => {
    if (!file || file.content === null) return "";
    const lang = langOf(selected);
    try { return lang ? hljs.highlight(file.content, { language: lang }).value : hljs.highlightAuto(file.content).value; }
    catch { return file.content; }
  }, [file, selected]);

  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Select size="sm" value={projectId} onChange={(e) => onProject(e.target.value)}
        options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      <Select size="sm" value={viewRef} onChange={(e) => setViewRef(e.target.value)} options={refOptions} />
      <Button size="sm" variant="secondary" leftIcon="git-branch" onClick={checkout} disabled={!viewRef}>Checkout</Button>
    </div>
  );

  const inDiff = selKind !== "file"; // pane kanan mode diff (dari Staged/Changed)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Tabs tabs={[{ value: "explorer", label: "Explorer" }, { value: "graph", label: "Git Graph" }]} value={tab} onChange={setTab} />
        {toolbar}
      </div>

      {tab === "explorer" ? (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
          <Card padding={0}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
              <span className="hn-eyebrow" style={{ flex: 1 }}>changes{status?.branch ? ` · ${status.branch}` : ""}</span>
              <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={() => { reloadTree(); reloadStatus(); }}>Muat ulang</Button>
            </div>
            <div style={{ padding: 8, maxHeight: 620, overflow: "auto" }}>
              <ChangedSection label="Staged" changed={status?.staged ?? []}
                selected={selKind === "staged" ? selected : ""} onSelect={selectStaged}
                view={stagedView} onView={setStagedView} emptyText="Tak ada file staged." />
              <div style={{ borderTop: "1px solid var(--border-hair)", margin: "6px 0" }} />
              <ChangedSection label="Changed" changed={status?.unstaged ?? []}
                selected={selKind === "unstaged" ? selected : ""} onSelect={selectChanged}
                view={changedView} onView={setChangedView} emptyText="Tak ada file berubah." />
              <div className="hn-eyebrow" style={{ padding: "6px 8px", marginTop: 8, borderTop: "1px solid var(--border-hair)" }}>
                Files · {viewRef || "working tree"}
              </div>
              {treeState === "loading" ? <StateBlock kind="loading" compact title="Memuat file…" />
                : treeState === "error" ? <StateBlock kind="error" compact title="Gagal memuat file" action={reloadTree} />
                : files.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Tak ada file" />
                : buildFileTree(files).map((n) => (
                    <TreeRow key={n.path} node={n} selected={selKind === "file" ? selected : ""} onSelect={selectFile} />
                  ))}
            </div>
          </Card>
          <Card padding={0}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
              <Icon name="file-text" size={15} color="var(--text-muted)" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)" }}>{selected || "—"}</span>
              {!inDiff && file?.truncated && <Badge tone="warn" size="sm">terpotong</Badge>}
              {inDiff && diff?.status && <Badge tone={diff.status === "D" ? "err" : diff.status === "A" ? "ok" : "brass"} size="sm">{diff.status}</Badge>}
              <span style={{ flex: 1 }} />
              {inDiff
                ? <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
                    {(["diff", "source"] as const).map((t) => (
                      <button key={t} onClick={() => setDiffTab(t)} style={{
                        padding: "4px 12px", border: "none", cursor: "pointer", borderRadius: "var(--radius-pill)",
                        fontSize: 12, textTransform: "capitalize",
                        background: diffTab === t ? "var(--surface-card)" : "transparent",
                        color: diffTab === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: diffTab === t ? 600 : 400,
                      }}>{t}</button>
                    ))}
                  </div>
                : mode === "view"
                  ? <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                      disabled={!file || file.binary}>Edit</Button>
                  : <div style={{ display: "flex", gap: 8 }}>
                      <Button size="sm" variant="ghost" onClick={() => setMode("view")}>Batal</Button>
                      <Button size="sm" leftIcon="check" onClick={save}>Simpan</Button>
                    </div>}
            </div>
            <div style={{ maxHeight: 620, overflow: "auto" }}>
              {inDiff
                ? (!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari Staged/Changed" />
                    : diff === null ? <StateBlock kind="loading" title="Memuat…" hint={selected} />
                    : diff.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint={selected} />
                    : diffTab === "diff" ? <div style={{ padding: "10px 0" }}><DiffView diff={diff.diff ?? ""} />
                        {diff.truncated && <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-subtle)" }}>… dipotong pada 256 KB.</div>}</div>
                    : diff.content === null ? <StateBlock kind="empty" icon="trash-2" title="File dihapus" hint="Tak ada isi untuk ditampilkan." />
                    : <pre style={{ margin: 0, padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: 12.5,
                        lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-body)" }}>{diff.content}</pre>)
                : (!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari pohon di kiri" />
                    : file === null ? <StateBlock kind="loading" title="Memuat…" hint={selected} />
                    : file.binary ? <StateBlock kind="empty" icon="file" title="File biner" hint={selected} />
                    : mode === "edit"
                      ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} style={{
                          width: "100%", minHeight: 560, boxSizing: "border-box", resize: "vertical", border: "none",
                          outline: "none", padding: "16px 18px", fontFamily: "var(--font-mono)", fontSize: 12.5,
                          lineHeight: 1.7, color: "var(--text-body)", background: "var(--surface-card)" }} />
                      : <pre style={{ margin: 0, padding: "16px 18px", overflow: "auto" }}>
                          <code className="hljs" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7 }}
                            dangerouslySetInnerHTML={{ __html: highlighted }} />
                        </pre>)}
            </div>
          </Card>
        </div>
      ) : (
        <GitGraph projectId={projectId} onRunGit={runGit} onMerge={mergeGraph}
          onOpenFile={(p, ref) => { setViewRef(ref); selectFile(p); setTab("explorer"); }} />
      )}

      {pendingForce && <ForceDialog msg={pendingForce.msg} onForce={confirmForce} onCancel={() => setPendingForce(null)} />}
    </div>
  );
}
```

- [x] **Step 4: Run the new tests + full web suite**

Run: `pnpm --filter @hanoman/app exec vitest run src/test/ide-screen.test.tsx`
Expected: PASS (existing + 3 new tests).

Run: `pnpm --filter @hanoman/app exec vitest run --no-file-parallelism`
Expected: PASS — whole web suite green.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/IdeScreen.tsx src/test/ide-screen.test.tsx
git commit -m "feat(web): IDE Explorer Staged/Changed sections + diff pane — SPEC-234"
```

---

## Task 6: Docs + full verification & live smoke

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Verify: `internal/docs/README.md` (both docs already linked in index — confirm)

**Interfaces:** none (docs + verification).

- [x] **Step 1: Update frontend-implementation.md**

In `internal/docs/frontend/frontend-implementation.md`, in the "IDE Visual (SPEC-182 · ADR-0034)" section, under the **Explorer** bullet, append:

```md
  - **Staged & Changed (SPEC-234)**: dua section SCM di atas pohon Files — **Staged** (index vs HEAD)
    dan **Changed** (working tree vs index + untracked), masing-masing toggle **List | Tree**
    (`ChangedSection` shared di `file-tree.tsx`, dipakai Review juga). Data `api.ideStatus`
    (`GET /projects/:id/status`), independen dari dropdown ref (status inheren milik working tree).
    Klik file → pane kanan **diff** read-only (toggle Diff | Source, `DiffView` shared di
    `screens/diff-view.tsx`) via `api.ideFileDiff`; klik file dari pohon Files tetap membuka editor.
    Header menampilkan branch aktif; **Muat ulang** & tiap git op menyegarkan status.
```

- [x] **Step 2: Update api-contract.md**

In `internal/docs/architecture/api-contract.md`, in the "IDE Visual (SPEC-182 · ADR-0034)" block, after the `GET /projects/:id/file?...` line, add:

```
GET    /projects/:id/status             # (SPEC-234) { branch, staged:ChangedFile[], unstaged:ChangedFile[] }  staged=index vs HEAD, unstaged=working tree vs index+untracked; read-only, tak digerbang sesi; 404 project tak ada
GET    /projects/:id/file-diff?path=&staged=  # (SPEC-234) ReviewFile diff satu file working tree; staged=1 → index vs HEAD; 400 path buruk/kosong; 404 file tak dalam changeset
```

- [x] **Step 3: Verify docs index links**

Run: `grep -n "frontend-implementation\|api-contract" internal/docs/README.md`
Expected: both already linked (no README edit needed). If either is missing, add the link line under its category.

- [x] **Step 4: Run the FULL test suite (both packages)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism`
Expected: PASS — all server tests green.

Run: `pnpm --filter @hanoman/app exec vitest run --no-file-parallelism`
Expected: PASS — all web tests green.

- [x] **Step 5: Live smoke — boot server & curl the new endpoints**

Boot against a dedicated migrated DB (never `hanoman_test` — a sibling server test run truncates it mid-smoke). Create a temp project pointing at a repo with mixed working-tree changes, then curl:

```bash
# build + boot (adjust DB per hanoman-live-smoke conventions), then:
curl -s "http://127.0.0.1:8787/api/projects/<id>/status" | jq '{branch, staged: [.staged[].path], unstaged: [.unstaged[].path]}'
curl -s "http://127.0.0.1:8787/api/projects/<id>/file-diff?path=<staged-file>&staged=1" | jq '{status, diff: (.diff|.[0:80])}'
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8787/api/projects/<id>/file-diff?path=../evil"   # → 400
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8787/api/projects/ghost/status"                   # → 404
```

Expected: `status` returns `branch` + split staged/unstaged; `file-diff` returns diff; path guard → 400; unknown project → 404.

- [x] **Step 6: Commit docs**

```bash
git add internal/docs/frontend/frontend-implementation.md internal/docs/architecture/api-contract.md docs/superpowers/plans/2026-07-20-ide-changed-staged-spec-234.md docs/superpowers/specs/2026-07-20-ide-changed-staged-spec-234-design.md
git commit -m "docs(spec-234): IDE Explorer staged/changed — frontend + api-contract + plan/spec"
```

---

## Self-Review

- **Spec coverage:** Staged section (Task 1/3/5) · Changed section incl. untracked (Task 1/3/5) · list + tree view per section (Task 4/5, `ChangedSection`) · diff on click (Task 2/3/5, `DiffView`) · reuse existing components (Task 4 extraction; `buildFileTree`/`TreeRow`/`ChangedFile` reused) · current-branch label (Task 5 header) · read-only, no schema/ADR (design). All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; commands have expected output.
- **Type consistency:** `WorkingStatus = { branch; staged: ChangedFile[]; unstaged: ChangedFile[] }` identical in server return, client type, and route. `workingFileDiff` returns `ReviewFile` (existing shape) consumed by `DiffView`. `ChangedSection`/`ChangedRow` signatures identical across ReviewScreen & IdeScreen call sites. `api.ideFileDiff(id, path, staged: boolean)` matches path builder `ideFileDiff(id, path, staged)`.
```
