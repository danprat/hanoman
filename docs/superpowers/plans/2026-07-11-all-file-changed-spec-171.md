# All File & File Changed (SPEC-171) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Layar review full-width menampilkan seluruh file project + file yang berubah untuk sebuah backlog item, di-derive dari worktree-nya via git.

**Architecture:** Service `spec-review.ts` menurunkan basis (`git merge-base`), daftar semua file (`git ls-files`), dan daftar changed (`git diff --numstat/--name-status` di atas index sementara `add -A -N`) dari worktree `<repoDir>/.worktrees/<specid>`. Dua endpoint `GET /specs/:id/review` + `/review/*` menyajikannya. `ReviewScreen.tsx` (ala VSCode: sidebar changed + tree, viewer Diff|Source) di-mount sebagai `section: "review"` yang dibuka dari tombol Review di backlog.

**Tech Stack:** Node + Fastify + Prisma (server), React + TS + Vite (web), git CLI via `execFile`, vitest.

## Global Constraints

- TypeScript strict di semua paket.
- Server git: `execFile` di-promisify, `maxBuffer: 1 << 24` (preseden `services/scan.ts`). Tak pernah `spawnSync` di jalur request.
- Diff/content dipotong **256 KB** (`256 * 1024`) + tandai `truncated`.
- `-z` di semua `git diff`/`git ls-files`; `--no-renames` di semua `git diff` changed.
- Gerbang path satu-satunya: `*path` wajib ada di (`files` ∪ `changed`) → di luar itu 404. Tak ada `resolve()`-prefix terpisah.
- Tanpa perubahan skema, tanpa migration, tanpa ADR baru.
- Update `internal/docs` yang tersentuh dalam commit yang sama (SoT).
- Normalisasi id worktree = `specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")` (identik `pty.ts` `idFor`).

---

### Task 1: Service `spec-review.ts`

**Files:**
- Create: `server/src/services/spec-review.ts`
- Create: `server/test/spec-review.test.ts`
- Modify: `server/test/factory.ts` (tambah `makeRepoWithWorktree`)

**Interfaces:**
- Produces:
  - `worktreeDir(repoDir: string, specId: string): string`
  - `specReview(repoDir: string, specId: string, branchFrom: string | null): Promise<SpecReview>`
  - `reviewFile(repoDir: string, specId: string, branchFrom: string | null, path: string): Promise<ReviewFile | null>` (null = path tak dikenal → route 404)
  - `type ChangedFile = { path: string; add: number; del: number; status: "A"|"M"|"D"; binary: boolean }`
  - `type SpecReview = { base: string; files: string[]; changed: ChangedFile[] }`
  - `type ReviewFile = { path: string; status: "A"|"M"|"D"|null; binary: boolean; truncated: boolean; diff: string | null; content: string | null }`

- [x] **Step 1: Tambah helper worktree ke `server/test/factory.ts`**

Sisipkan setelah `makeRepoWithBranches` (butuh `join`, `writeFileSync`, `mkdirSync`, `rmSync`, `spawnSync`, `dirname` — `rmSync` belum diimpor, tambahkan ke import `node:fs`):

```ts
// Repo dengan satu commit `main` (base) + worktree `.worktrees/<id>` detached di main,
// lalu `changes` diterapkan di worktree TANPA commit (persis keadaan sesi yang bekerja).
// value null = hapus file yang ada di base. Mengembalikan repoDir.
export function makeRepoWithWorktree(specId: string, base: Record<string, string>, changes: Record<string, string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
  const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
  g(dir, "init", "-q"); g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
  for (const [rel, content] of Object.entries(base)) {
    const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
  }
  g(dir, "add", "-A"); g(dir, "commit", "-qm", "base"); g(dir, "branch", "-M", "main");
  const id = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const wt = join(dir, ".worktrees", id);
  g(dir, "worktree", "add", "--detach", "-q", wt, "main");
  for (const [rel, content] of Object.entries(changes)) {
    const abs = join(wt, rel);
    if (content === null) { rmSync(abs, { force: true }); continue; }
    mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
  }
  return dir;
}
```

- [x] **Step 2: Tulis test yang gagal (`server/test/spec-review.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { specReview, reviewFile } from "../src/services/spec-review";
import { makeRepoWithWorktree } from "./factory";

const SID = "SPEC-900";
function repo() {
  return makeRepoWithWorktree(SID,
    { "keep.txt": "satu\n", "gone.txt": "buang\n" },
    { "keep.txt": "satu\ndua\n", "gone.txt": null, "new file.md": "baru\n", "b.bin": "a\u0000b" });  // NUL byte -> git deteksi biner
}

describe("specReview", () => {
  it("all files = tracked ∪ untracked-tak-ignored, sorted", async () => {
    const r = await specReview(repo(), SID, null);
    expect(r.files).toEqual(["b.bin", "keep.txt", "new file.md"]); // gone.txt terhapus
  });
  it("changed: modified +1/-0, deleted D, added A, path berspasi utuh", async () => {
    const r = await specReview(repo(), SID, null);
    const by = Object.fromEntries(r.changed.map((c) => [c.path, c]));
    expect(by["keep.txt"]).toMatchObject({ status: "M", add: 1, del: 0, binary: false });
    expect(by["gone.txt"]).toMatchObject({ status: "D" });
    expect(by["new file.md"]).toMatchObject({ status: "A", binary: false });
    expect(by["b.bin"]).toMatchObject({ status: "A", binary: true });
  });
  it("index repo tak tercemar (status --porcelain identik)", async () => {
    const dir = repo();
    const { execFileSync } = await import("node:child_process");
    const wt = `${dir}/.worktrees/spec-900`;
    const before = execFileSync("git", ["status", "--porcelain"], { cwd: wt, encoding: "utf8" });
    await specReview(dir, SID, null);
    const after = execFileSync("git", ["status", "--porcelain"], { cwd: wt, encoding: "utf8" });
    expect(after).toBe(before);
  });
});

describe("reviewFile", () => {
  it("file di luar daftar → null (gerbang path)", async () => {
    expect(await reviewFile(repo(), SID, null, "../../etc/passwd")).toBeNull();
  });
  it("file changed: diff + content dari disk", async () => {
    const rf = await reviewFile(repo(), SID, null, "keep.txt");
    expect(rf!.status).toBe("M");
    expect(rf!.diff).toContain("+dua");
    expect(rf!.content).toBe("satu\ndua\n");
  });
  it("file dihapus → content null", async () => {
    const rf = await reviewFile(repo(), SID, null, "gone.txt");
    expect(rf!.status).toBe("D");
    expect(rf!.content).toBeNull();
  });
  it("file biner → binary true, tanpa diff/content", async () => {
    const rf = await reviewFile(repo(), SID, null, "b.bin");
    expect(rf).toMatchObject({ binary: true, diff: null, content: null });
  });
  it("file tak berubah tapi ada di project → content, diff kosong", async () => {
    // keep.txt di base tapi tak diubah? pakai file base yang tetap: tambahkan skenario
    const dir = makeRepoWithWorktree(SID, { "stay.txt": "tetap\n" }, {});
    const rf = await reviewFile(dir, SID, null, "stay.txt");
    expect(rf!.status).toBeNull();
    expect(rf!.diff).toBe("");
    expect(rf!.content).toBe("tetap\n");
  });
});
```

- [x] **Step 3: Jalankan test, pastikan gagal**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run test/spec-review.test.ts`
Expected: FAIL — `Cannot find module '../src/services/spec-review'`.

- [x] **Step 4: Implementasi `server/src/services/spec-review.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24 } as const;
const MAX = 256 * 1024;

export type ChangedFile = { path: string; add: number; del: number; status: "A" | "M" | "D"; binary: boolean };
export type SpecReview = { base: string; files: string[]; changed: ChangedFile[] };
export type ReviewFile = {
  path: string; status: "A" | "M" | "D" | null; binary: boolean;
  truncated: boolean; diff: string | null; content: string | null;
};

// ponytail: normalisasi id sama dengan pty.ts idFor & terminal.ts; ekstrak kalau muncul consumer keempat.
export const worktreeDir = (repoDir: string, specId: string): string =>
  join(repoDir, ".worktrees", specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_"));

// `git add -A -N` (intent-to-add) di salinan index sementara: file untracked masuk hitungan
// diff TANPA menghash isi ke object database. Index worktree hidup tak tersentuh (SPEC-144 Amandemen 1).
async function withTempIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const idx = (await exec("git", ["rev-parse", "--git-path", "index"], { cwd: wt, ...GIT })).stdout.trim();
  const dir = await mkdtemp(join(tmpdir(), "hanoman-idx-"));
  const tmp = join(dir, "index");
  await copyFile(resolve(wt, idx), tmp);
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  try { await exec("git", ["add", "-A", "-N"], { cwd: wt, env, ...GIT }); return await fn(env); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const splitZ = (s: string): string[] => s.split("\0").filter(Boolean);

async function mergeBase(wt: string, branchFrom: string | null): Promise<string> {
  const { stdout } = await exec("git", ["merge-base", branchFrom || "main", "HEAD"], { cwd: wt, ...GIT });
  return stdout.trim();
}

async function allFiles(wt: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    exec("git", ["ls-files", "-z"], { cwd: wt, ...GIT }),
    exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: wt, ...GIT }),
  ]);
  return [...new Set([...splitZ(tracked.stdout), ...splitZ(untracked.stdout)])].sort();
}

async function changedFiles(wt: string, base: string, env: NodeJS.ProcessEnv): Promise<ChangedFile[]> {
  const [num, name] = await Promise.all([
    exec("git", ["diff", "--numstat", "-z", "--no-renames", base], { cwd: wt, env, ...GIT }),
    exec("git", ["diff", "--name-status", "-z", "--no-renames", base], { cwd: wt, env, ...GIT }),
  ]);
  const map = new Map<string, ChangedFile>();
  // --numstat -z: `add \t del \t path` \0. Binary = `-`/`-` — cek SEBELUM Number() (kalau tidak: NaN).
  for (const rec of splitZ(num.stdout)) {
    const tab = rec.indexOf("\t"), tab2 = rec.indexOf("\t", tab + 1);
    const add = rec.slice(0, tab), del = rec.slice(tab + 1, tab2), path = rec.slice(tab2 + 1);
    const binary = add === "-" && del === "-";
    map.set(path, { path, add: binary ? 0 : Number(add), del: binary ? 0 : Number(del), status: "M", binary });
  }
  // --name-status -z: `status` \0 `path` \0. status[0] = A|M|D (--no-renames → tak ada R/C).
  const toks = splitZ(name.stdout);
  for (let i = 0; i + 1 < toks.length; i += 2) {
    const st = toks[i]![0] as "A" | "M" | "D";
    const path = toks[i + 1]!;
    const cf = map.get(path) ?? { path, add: 0, del: 0, status: st, binary: false };
    cf.status = st;
    map.set(path, cf);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function specReview(repoDir: string, specId: string, branchFrom: string | null): Promise<SpecReview> {
  const wt = worktreeDir(repoDir, specId);
  const base = await mergeBase(wt, branchFrom);
  const files = await allFiles(wt);
  const changed = await withTempIndex(wt, (env) => changedFiles(wt, base, env));
  return { base, files, changed };
}

export async function reviewFile(
  repoDir: string, specId: string, branchFrom: string | null, path: string,
): Promise<ReviewFile | null> {
  const wt = worktreeDir(repoDir, specId);
  const { base, files, changed } = await specReview(repoDir, specId, branchFrom);
  const cf = changed.find((c) => c.path === path);
  if (!cf && !files.includes(path)) return null; // gerbang path → route 404
  if (cf?.binary) return { path, status: cf.status, binary: true, truncated: false, diff: null, content: null };
  const status = cf?.status ?? null;
  const diffRaw = await withTempIndex(wt, async (env) =>
    (await exec("git", ["diff", base, "--", path], { cwd: wt, env, ...GIT })).stdout);
  let contentRaw: string | null = null;
  if (status !== "D") { try { contentRaw = await readFile(join(wt, path), "utf8"); } catch { contentRaw = null; } }
  return {
    path, status, binary: false,
    truncated: diffRaw.length > MAX || (contentRaw?.length ?? 0) > MAX,
    diff: diffRaw.slice(0, MAX),
    content: contentRaw === null ? null : contentRaw.slice(0, MAX),
  };
}
```

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run test/spec-review.test.ts`
Expected: PASS (semua). Kalau `b.bin` tak terdeteksi biner, pastikan isinya memuat byte NUL (`\0`).

- [x] **Step 6: Commit**

```bash
git add server/src/services/spec-review.ts server/test/spec-review.test.ts server/test/factory.ts
git commit -m "feat(server): service spec-review — all files + changed dari worktree (SPEC-171)"
```

---

### Task 2: Endpoints + shared paths + api client

**Files:**
- Modify: `server/src/routes/specs.ts` (dua route baru + import)
- Modify: `shared/src/api.ts` (dua path)
- Modify: `src/src/api/client.ts` (tipe + dua method)
- Modify: `server/test/specs.route.test.ts` (test route)

**Interfaces:**
- Consumes: `specReview`, `reviewFile`, `worktreeDir` (Task 1).
- Produces:
  - `GET /specs/:id/review` → `SpecReview`
  - `GET /specs/:id/review/*` → `ReviewFile` (404 bila null)
  - `paths.specReview(id)`, `paths.specReviewFile(id, path)`
  - `api.specReview(id)`, `api.specReviewFile(id, path)`

- [x] **Step 1: Tulis test route yang gagal (tambah ke `server/test/specs.route.test.ts`)**

Tambahkan `makeRepoWithWorktree` ke import factory di baris atas file, lalu di `beforeAll` seed satu spec dengan worktree, dan tambahkan `describe`:

```ts
// di beforeAll, setelah seed yang ada:
const wtRepo = makeRepoWithWorktree("SPEC-171",
  { "keep.txt": "a\n" }, { "keep.txt": "a\nb\n", "new.txt": "baru\n" });
await makeProject({ id: "pr", repoDir: wtRepo });
await makeSpec({ id: "SPEC-171", projectId: "pr", stage: "executing", branchFrom: null });
await makeSpec({ id: "SPEC-172", projectId: "pr", stage: "executing" }); // tanpa worktree

// describe baru:
describe("GET /specs/:id/review (SPEC-171)", () => {
  it("mengembalikan base, files, changed", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-171/review" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.files).toContain("new.txt");
    expect(b.changed.map((c: any) => c.path).sort()).toEqual(["keep.txt", "new.txt"]);
  });
  it("worktree tak ada → 409", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-172/review" });
    expect(res.statusCode).toBe(409);
  });
  it("spec tak ada → 404", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-999/review" });
    expect(res.statusCode).toBe(404);
  });
  it("file changed → diff + content", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-171/review/keep.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff).toContain("+b");
    expect(res.json().content).toBe("a\nb\n");
  });
  it("path di luar daftar → 404", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-171/review/does/not/exist.ts" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run test/specs.route.test.ts`
Expected: FAIL — 404 (route belum ada) pada kasus review pertama.

- [x] **Step 3: Tambah dua route ke `server/src/routes/specs.ts`**

Tambah import di atas file:

```ts
import { existsSync } from "node:fs";
import { specReview, reviewFile, worktreeDir } from "../services/spec-review";
```

Sisipkan dua route ini di dalam `export default async function (app)`, sebelum `app.delete("/specs/:id" ...)`:

```ts
  // SPEC-171 · review worktree backlog item: all files + file changed, diturunkan dari git.
  async function specWithProject(id: string) {
    return prisma.spec.findUnique({ where: { id }, include: { project: true } });
  }
  app.get("/specs/:id/review", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await specWithProject(id);
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (!spec.project.repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    if (!existsSync(worktreeDir(spec.project.repoDir, id)))
      return reply.code(409).send({ error: "worktree tidak ada — jalankan/lanjutkan sesi backlog dulu" });
    return specReview(spec.project.repoDir, id, spec.branchFrom);
  });
  app.get("/specs/:id/review/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const spec = await specWithProject(id);
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (!spec.project.repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    if (!existsSync(worktreeDir(spec.project.repoDir, id)))
      return reply.code(409).send({ error: "worktree tidak ada" });
    const rf = await reviewFile(spec.project.repoDir, id, spec.branchFrom, path);
    return rf === null ? reply.code(404).send({ error: "not found" }) : rf;
  });
```

- [x] **Step 4: Jalankan test route, pastikan lulus**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm exec vitest run test/specs.route.test.ts`
Expected: PASS.

- [x] **Step 5: Tambah paths ke `shared/src/api.ts`**

Di dalam objek `paths`, setelah `spec: (id) => ...`:

```ts
  specReview: (id: string) => `${API}/specs/${id}/review`,
  specReviewFile: (id: string, path: string) => `${API}/specs/${id}/review/${path}`,
```

- [x] **Step 6: Tambah tipe + method ke `src/src/api/client.ts`**

Tambah tipe (setelah `RevertPending`):

```ts
export type ChangedFile = { path: string; add: number; del: number; status: "A" | "M" | "D"; binary: boolean };
export type SpecReview = { base: string; files: string[]; changed: ChangedFile[] };
export type ReviewFile = {
  path: string; status: "A" | "M" | "D" | null; binary: boolean;
  truncated: boolean; diff: string | null; content: string | null;
};
```

Tambah method (di objek `api`, dekat `patchSpec`):

```ts
  specReview: (id: string) => j<SpecReview>(paths.specReview(id)),
  specReviewFile: (id: string, path: string) => j<ReviewFile>(paths.specReviewFile(id, path)),
```

- [x] **Step 7: Build shared + typecheck, commit**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-171 && pnpm --filter @hanoman/shared build && pnpm -r exec tsc --noEmit`
Expected: no type errors.

```bash
git add server/src/routes/specs.ts shared/src/api.ts src/src/api/client.ts server/test/specs.route.test.ts
git commit -m "feat(server): endpoint GET /specs/:id/review(/*) + api client (SPEC-171)"
```

---

### Task 3: `ReviewScreen.tsx`

**Files:**
- Create: `src/src/screens/ReviewScreen.tsx`
- Create: `src/test/review-screen.test.tsx`

**Interfaces:**
- Consumes: `api.specReview`, `api.specReviewFile`, `SpecReview`, `ReviewFile`, `ChangedFile` (Task 2); ds `Card, Badge, Button, Icon, StateBlock, Tabs`.
- Produces: `export function ReviewScreen({ specId, title, onBack }: { specId: string; title: string; onBack: () => void })`.

- [x] **Step 1: Tulis test komponen yang gagal (`src/test/review-screen.test.tsx`)**

Mirror `src/test/project-detail.test.tsx` untuk pola mock `api`. Contoh:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ReviewScreen } from "../src/screens/ReviewScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({ api: { specReview: vi.fn(), specReviewFile: vi.fn() } }));

beforeEach(() => {
  (api.specReview as any).mockResolvedValue({
    base: "abc", files: ["src/a.ts", "src/b.ts"],
    changed: [{ path: "src/a.ts", add: 3, del: 1, status: "M", binary: false }],
  });
  (api.specReviewFile as any).mockResolvedValue({
    path: "src/a.ts", status: "M", binary: false, truncated: false,
    diff: "@@ -1 +1 @@\n-old\n+new", content: "new content",
  });
});

describe("ReviewScreen", () => {
  it("menampilkan changed list + memilih file changed pertama", async () => {
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeInTheDocument());
    expect(await screen.findByText(/\+new/)).toBeInTheDocument(); // baris diff hijau
  });
  it("tab Source menampilkan content", async () => {
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={() => {}} />);
    await screen.findByText(/\+new/);
    fireEvent.click(screen.getByText("Source"));
    expect(await screen.findByText("new content")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && pnpm exec vitest run test/review-screen.test.tsx`
Expected: FAIL — `Cannot find module '../src/screens/ReviewScreen'`.

- [x] **Step 3: Implementasi `src/src/screens/ReviewScreen.tsx`**

```tsx
/* ReviewScreen (SPEC-171) — review file worktree backlog item ala VSCode:
   sidebar CHANGED (SCM) + FILES (tree), viewer Diff|Source. */
import React from "react";
import { Card, Badge, Button, Icon, StateBlock } from "../ds";
import { api, type SpecReview, type ReviewFile, type ChangedFile } from "../api/client";

type FileNode = { name: string; path: string; kids: FileNode[]; leaf: boolean };
function buildFileTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: "", path: "", kids: [], leaf: false };
  for (const p of paths) {
    let cur = root;
    const segs = p.split("/");
    segs.forEach((seg, i) => {
      const leaf = i === segs.length - 1;
      const path = cur.path ? cur.path + "/" + seg : seg;
      let next = cur.kids.find((k) => k.name === seg && k.leaf === leaf);
      if (!next) { next = { name: seg, path, kids: [], leaf }; cur.kids.push(next); }
      cur = next;
    });
  }
  const sort = (n: FileNode) => {
    n.kids.sort((a, b) => (a.leaf === b.leaf ? a.name.localeCompare(b.name) : a.leaf ? 1 : -1));
    n.kids.forEach(sort);
  };
  sort(root);
  return root.kids;
}

const ST_COLOR: Record<string, string> = { A: "var(--leaf-600)", M: "var(--brass-600)", D: "var(--clay-500)" };

function TreeRow({ node, selected, onSelect, depth = 0 }:
  { node: FileNode; selected: string; onSelect: (p: string) => void; depth?: number }) {
  const [open, setOpen] = React.useState(depth < 1);
  if (node.leaf) {
    const on = node.path === selected;
    return (
      <button onClick={() => onSelect(node.path)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 8px", paddingLeft: 22 + depth * 12, border: "none", cursor: "pointer",
        textAlign: "left", background: on ? "var(--brass-100)" : "transparent",
      }}>
        <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12,
          color: on ? "var(--brass-700)" : "var(--text-body)", fontWeight: on ? 600 : 400 }}>{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 6px", paddingLeft: 6 + depth * 12, border: "none",
        background: "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color="var(--brass-500)" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", fontWeight: 500 }}>{node.name}/</span>
      </button>
      {open && node.kids.map((k) => <TreeRow key={k.path} node={k} selected={selected} onSelect={onSelect} depth={depth + 1} />)}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  if (!diff) return <StateBlock kind="empty" icon="check" title="Tidak ada perubahan pada file ini" hint="File ini bagian dari project tapi tak diubah backlog ini." />;
  return (
    <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6 }}>
      {diff.split("\n").map((line, i) => {
        const plus = line.startsWith("+") && !line.startsWith("+++");
        const minus = line.startsWith("-") && !line.startsWith("---");
        const hunk = line.startsWith("@@");
        const color = plus ? "var(--leaf-700)" : minus ? "var(--clay-600)" : hunk ? "var(--brass-700)" : "var(--text-body)";
        const bg = plus ? "color-mix(in srgb, var(--leaf-500) 10%, transparent)"
          : minus ? "color-mix(in srgb, var(--clay-500) 10%, transparent)" : "transparent";
        return <div key={i} style={{ color, background: bg, padding: "0 12px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line || " "}</div>;
      })}
    </pre>
  );
}

export function ReviewScreen({ specId, title, onBack }: { specId: string; title: string; onBack: () => void }) {
  const [review, setReview] = React.useState<SpecReview | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "empty">("loading");
  const [errMsg, setErrMsg] = React.useState("");
  const [selected, setSelected] = React.useState("");
  const [file, setFile] = React.useState<ReviewFile | null>(null);
  const [tab, setTab] = React.useState<"diff" | "source">("diff");
  const [tries, setTries] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setState("loading");
    api.specReview(specId).then((r) => {
      if (!alive) return;
      setReview(r); setState("ready");
      setSelected(r.changed[0]?.path ?? r.files[0] ?? "");
    }).catch((e) => {
      if (!alive) return;
      // 409 (worktree/repoDir) → empty jelas, bukan error merah.
      if (e?.status === 409) { setState("empty"); setErrMsg(String(e?.message ?? "")); }
      else setState("error");
    });
    return () => { alive = false; };
  }, [specId, tries]);

  React.useEffect(() => {
    if (!selected) { setFile(null); return; }
    let alive = true;
    setFile(null);
    api.specReviewFile(specId, selected)
      .then((f) => { if (alive) setFile(f); })
      .catch(() => { if (alive) setFile(null); });
    return () => { alive = false; };
  }, [specId, selected]);

  const tree = React.useMemo(() => buildFileTree(review?.files ?? []), [review]);

  if (state === "loading") return <StateBlock kind="loading" title="Memuat review…" hint={specId} />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat review" hint={specId} action={() => setTries((n) => n + 1)} />;
  if (state === "empty") return <StateBlock kind="empty" icon="git-branch" title="Belum ada worktree untuk di-review" hint={errMsg || "Jalankan atau lanjutkan sesi backlog item ini dulu."} action={onBack} actionLabel="Kembali ke backlog" />;

  const changed = review?.changed ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
      <Card padding={0}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">{specId}</span>
          <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={() => setTries((n) => n + 1)}>Muat ulang</Button>
        </div>
        <div style={{ maxHeight: 640, overflow: "auto", padding: "6px 4px" }}>
          <div className="hn-eyebrow" style={{ padding: "6px 8px" }}>Changed · {changed.length}</div>
          {changed.length === 0
            ? <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--text-subtle)" }}>Tak ada file berubah.</div>
            : changed.map((c: ChangedFile) => {
              const on = c.path === selected;
              return (
                <button key={c.path} onClick={() => setSelected(c.path)} style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 10px",
                  border: "none", cursor: "pointer", textAlign: "left",
                  background: on ? "var(--brass-100)" : "transparent",
                }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: ST_COLOR[c.status] }}>{c.status}</span>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 12,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: on ? "var(--brass-700)" : "var(--text-body)" }}>{c.path}</span>
                  {!c.binary && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    <span style={{ color: "var(--leaf-600)" }}>+{c.add}</span>{" "}
                    <span style={{ color: "var(--clay-500)" }}>−{c.del}</span>
                  </span>}
                </button>
              );
            })}
          <div className="hn-eyebrow" style={{ padding: "6px 8px", marginTop: 8, borderTop: "1px solid var(--border-hair)" }}>Files</div>
          {tree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={setSelected} />)}
        </div>
      </Card>

      <Card padding={0}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
          <Icon name="file-text" size={15} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{selected || "—"}</span>
          {file?.status && <Badge tone={file.status === "D" ? "err" : file.status === "A" ? "ok" : "brass"} size="sm">{file.status}</Badge>}
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
            {(["diff", "source"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "4px 12px", border: "none", cursor: "pointer", borderRadius: "var(--radius-pill)",
                fontSize: 12, textTransform: "capitalize",
                background: tab === t ? "var(--surface-card)" : "transparent",
                color: tab === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: tab === t ? 600 : 400,
              }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 640, overflow: "auto", background: "var(--surface-code)" }}>
          {!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file" hint="Pilih file dari changed atau tree." />
            : !file ? <StateBlock kind="loading" title="Memuat file…" hint={selected} />
            : file.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint="Tak dapat di-review dari dashboard." />
            : tab === "diff" ? <div style={{ padding: "10px 0" }}><DiffView diff={file.diff ?? ""} />
                {file.truncated && <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-subtle)" }}>… dipotong pada 256 KB.</div>}</div>
            : file.content === null ? <StateBlock kind="empty" icon="trash-2" title="File dihapus" hint="Tak ada isi untuk ditampilkan." />
            : <pre style={{ margin: 0, padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: 12.5,
                lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-body)" }}>{file.content}</pre>}
        </div>
      </Card>
    </div>
  );
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `cd src && pnpm exec vitest run test/review-screen.test.tsx`
Expected: PASS. (`ApiError` di client punya `.status`; mock menolak dengan objek `{status}` bila menguji cabang 409 — tak diuji di sini.)

- [x] **Step 5: Commit**

```bash
git add src/src/screens/ReviewScreen.tsx src/test/review-screen.test.tsx
git commit -m "feat(web): ReviewScreen — sidebar changed + tree, viewer diff/source (SPEC-171)"
```

---

### Task 4: Wiring — App.tsx section + tombol Review di backlog

**Files:**
- Modify: `src/src/App.tsx` (import, state `reviewSpecId`, handler, `section === "review"`)
- Modify: `src/src/screens/BacklogScreen.tsx` (prop `onOpenReview`, tombol Review di `SpecActions` + `SpecDetail`)

**Interfaces:**
- Consumes: `ReviewScreen` (Task 3).
- Produces: navigasi `section: "review"` dengan `reviewSpecId`; `BacklogScreen` prop `onOpenReview?: (s: Spec) => void`.

- [x] **Step 1: Tambah import + state + handler di `App.tsx`**

Import (dekat baris 16, setelah import screen lain):

```tsx
import { ReviewScreen } from "./screens/ReviewScreen";
```

State (dekat baris 268, setelah `const [projectId, setProjectId] = ...`):

```tsx
const [reviewSpecId, setReviewSpecId] = React.useState("");
```

Handler (dekat handler navigasi lain, mis. sesudah `openProject`):

```tsx
function openReview(s: Spec) { setReviewSpecId(s.id); setSection("review"); }
```

- [x] **Step 2: Tambah cabang `section === "review"` di `App.tsx`**

Sisipkan sebelum `} else if (section === "settings") {`:

```tsx
  } else if (section === "review") {
    const rspec = backlog.find((s) => s.id === reviewSpecId);
    screen = (
      <Shell active="backlog" title="Review" wide onNavigate={setSection}
        breadcrumb={rspec ? "backlog · " + rspec.id : "backlog"}
        actions={<Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={() => setSection("backlog")}>Kembali</Button>}>
        {gate(reviewSpecId
          ? <ReviewScreen specId={reviewSpecId} title={rspec?.title ?? reviewSpecId} onBack={() => setSection("backlog")} />
          : <StateBlock kind="empty" icon="git-compare" title="Pilih backlog item"
              hint="Buka Review dari sebuah item di Backlog." action={() => setSection("backlog")} actionLabel="Ke Backlog" />)}
      </Shell>
    );
```

- [x] **Step 3: Teruskan `onOpenReview` ke `BacklogScreen` di `App.tsx`**

Di render `<BacklogScreen ... />` (dekat baris 483), tambah prop:

```tsx
          onOpenReview={openReview}
```

- [x] **Step 4: Tambah prop + tombol Review di `BacklogScreen.tsx`**

Tambah `onOpenReview` ke tipe & destructure `BacklogScreen`, teruskan ke `SpecCard`/`SpecRow`/`BoardCard` melalui `SpecActions`. Ubah `SpecActions`:

```tsx
function SpecActions({ spec, onStart, onDelete, onOpenRun, onOpenReview, running }:
  { spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void; running?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {onOpenReview && (
        <Button size="sm" variant="ghost" leftIcon="git-compare" onClick={() => onOpenReview(spec)}>Review</Button>
      )}
      {/* …sisa tombol yang sudah ada tak berubah… */}
```

Teruskan `onOpenReview` di setiap pemanggil `SpecActions` (`SpecCard`, `SpecRow`, `BoardCard`) — tambahkan ke tipe props masing-masing dan lewatkan `onOpenReview={onOpenReview}`. Di `BacklogScreen`, tambahkan `onOpenReview` ke tipe props + destructure, dan sebarkan ke `SpecCard`/`SpecRow`/`Board` (yang meneruskan ke `BoardCard`). Tambahkan juga tombol Review di `SpecDetail` header (di sebelah tombol close, opsional): panggil `onOpenReview(spec)`.

Contoh perubahan tanda tangan `BacklogScreen` (tambah satu baris ke props):

```tsx
    onOpenReview, // : (s: Spec) => void
```

dan pada pemanggilan `SpecCard`/`SpecRow` tambah `onOpenReview={onOpenReview}`; pada `<Board ... />` tambah `onOpenReview={onOpenReview}` lalu teruskan ke `BoardCard` → `SpecActions`.

- [x] **Step 5: Typecheck + build web + test flow**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-171 && pnpm -r exec tsc --noEmit && cd src && pnpm exec vitest run`
Expected: no type errors; semua test web PASS.

- [x] **Step 6: Commit**

```bash
git add src/src/App.tsx src/src/screens/BacklogScreen.tsx
git commit -m "feat(web): buka ReviewScreen dari tombol Review di backlog (SPEC-171)"
```

---

### Task 5: Smoke nyata + centang plan + docs

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-all-file-changed-spec-171.md` (centang `- [x]` → `- [x]`)

- [x] **Step 1: Boot server & smoke endpoint di worktree ini**

Backlog item SPEC-171 ada di DB (worktree ini). Boot server (`pnpm dev` atau `node server/dist/server.js`), lalu:

```bash
curl -s localhost:8787/api/specs/SPEC-171/review | head -c 600
curl -s "localhost:8787/api/specs/SPEC-171/review/server/src/routes/fs.ts" | head -c 400
```

Expected: JSON `{ base, files:[...], changed:[...] }` dengan file nyata dari worktree ini; endpoint file → `{ diff, content }`. Jika port 8787 dipakai sesi dev lain, boot di port lain (lihat memori "Worktree butuh install+generate").
Kalau ada issue, fix dulu sampai hijau sebelum lanjut.

- [x] **Step 2: Smoke UI (opsional, CDP)**

Buka dashboard, Backlog → item mana pun → tombol **Review** → konfirmasi sidebar Changed + Files dan viewer Diff/Source tampil.

- [x] **Step 3: Full suite hijau**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-171 && env -u NODE_ENV -u DATABASE_URL pnpm -r test`
Expected: semua PASS (server pakai `--no-file-parallelism` bila diperlukan; lihat memori).

- [x] **Step 4: Centang plan + commit final**

```bash
git add docs/superpowers/plans/2026-07-11-all-file-changed-spec-171.md
git commit -m "docs(spec-171): centang plan — semua task terimplementasi & terverifikasi"
```

---

## Self-Review

**Spec coverage:**
- All files (git ls-files, .gitignore) → Task 1 `allFiles` + Task 3 tree. ✅
- File changed (merge-base diff, A/M/D, +/−, binary) → Task 1 `changedFiles` + Task 3 changed list. ✅
- Preview diff + source, 256 KB truncate → Task 1 `reviewFile` + Task 3 viewer. ✅
- Gerbang path 404 → Task 1 (`reviewFile` null) + Task 2 route. ✅
- Status codes (spec 404, repoDir 409, worktree 409, path 404) → Task 2. ✅
- Mount layar Review full-width dari backlog → Task 4. ✅
- Muat-ulang bukan poll → Task 3 tombol. ✅
- Docs SoT (objective + api-contract + README) → sudah ditulis di fase Spec; api-contract mencerminkan endpoint. ✅

**Placeholder scan:** tak ada TBD/TODO; setiap step berisi kode nyata. ✅

**Type consistency:** `ChangedFile`/`SpecReview`/`ReviewFile` identik di service (Task 1), client (Task 2), screen (Task 3). `worktreeDir`/`specReview`/`reviewFile` konsisten antar Task 1↔2. `onOpenReview: (s: Spec) => void` konsisten Task 4. ✅
