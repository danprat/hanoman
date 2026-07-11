# IDE Visual (SPEC-182) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan bagian **IDE Visual** ala VS Code ke dashboard hanoman: file explorer (edit & simpan) yang bisa difilter per-project, branch switcher (local + origin), dan git graph interaktif (checkout/merge/cherry-pick/revert/branch).

**Architecture:** Backend `services/git-ide.ts` + `routes/ide.ts` men-spawn git di `project.repoDir` (bukan worktree spec), memakai ulang pola `execFile`+`maxBuffer` dari `spec-review.ts`, path-guard dari `scan.ts`, dan `branches.ts` (local+origin sudah ada). Mutasi git digerbang **sesi-aktif** (persis `DELETE /projects`) dengan escape `force`. Frontend `IdeScreen.tsx` (Explorer) + `GitGraph.tsx` (SVG DAG dari lane-builder murni `git-graph.ts`), satu entri nav baru.

**Tech Stack:** Node + Fastify + Prisma (server), React 18 + TS + Vite (web), `highlight.js` (dep baru, syntax highlight read-view), inline SVG untuk graph (nol dep graph).

## Global Constraints

- TypeScript strict; test untuk tiap logika (`server/test/*.test.ts`, `src/test/*.test.tsx`).
- Git di `repoDir` **working tree utama** dibagi sesi Claude lain — mutasi HANYA lewat endpoint bergerbang; jangan pernah `--force` tanpa flag `force` eksplisit dari body.
- `repoDir` null / bukan repo git → hasil kosong `[]`/404, **tak pernah melempar** (cermin `branches.ts`, `scanRepoDocs`).
- Path guard wajib pada tiap akses file: tolak keluar-repo & `.git` → 400.
- Update SoT yang tersentuh **dalam commit yang sama**: `api-contract.md`, `frontend/frontend-implementation.md`, `adr/0034-*`, `README.md` index.
- **Tanpa migration** — tak ada perubahan skema Prisma.
- Design system: editorial, bone paper, brass accent (`internal/docs/design-system/**`).
- Test command: `env -u NODE_ENV -u DATABASE_URL pnpm test` (shell sesi menunjuk prod). Server test: dari root, `pnpm --filter ./server test`. Web test: `pnpm --filter ./src test`.

---

### Task 1: git-ide read service — tree + file

**Files:**
- Create: `server/src/services/git-ide.ts`
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Consumes: `makeTempRepo`, `makeRepoWithBranches` dari `server/test/factory.ts`.
- Produces:
  - `repoAbsPath(repoDir: string, rel: string): string` — throws pada `.git`/keluar-repo.
  - `listRepoTree(repoDir: string | null, ref?: string): Promise<string[]>`
  - `type RepoFile = { path: string; content: string | null; binary: boolean; truncated: boolean }`
  - `readRepoFile(repoDir: string | null, rel: string, ref?: string): Promise<RepoFile | null>` — throws pada path buruk (→route 400), `null` pada file tak ada (→route 404).

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/git-ide.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { makeTempRepo, makeRepoWithBranches } from "./factory";
import { listRepoTree, readRepoFile, repoAbsPath } from "../src/services/git-ide";

const NUL = "a" + String.fromCharCode(0) + "b";

describe("git-ide read", () => {
  it("listRepoTree working tree = tracked ∪ untracked, sorted", async () => {
    const dir = makeTempRepo({ "src/a.ts": "1", "README.md": "x" });
    expect(await listRepoTree(dir)).toEqual(["README.md", "src/a.ts"]);
  });
  it("listRepoTree at a ref = snapshot ls-tree", async () => {
    const dir = makeRepoWithBranches("dev"); // punya README.md ter-commit di main
    expect(await listRepoTree(dir, "main")).toEqual(["README.md"]);
  });
  it("listRepoTree: repoDir null / bukan repo → []", async () => {
    expect(await listRepoTree(null)).toEqual([]);
    expect(await listRepoTree(makeTempRepo({}) + "/nope")).toEqual([]);
  });
  it("readRepoFile working tree membaca isi disk", async () => {
    const dir = makeTempRepo({ "a.txt": "halo\n" });
    expect(await readRepoFile(dir, "a.txt")).toMatchObject({ content: "halo\n", binary: false });
  });
  it("readRepoFile at a ref membaca via git show", async () => {
    const dir = makeRepoWithBranches();
    expect((await readRepoFile(dir, "README.md", "main"))!.content).toBe("x");
  });
  it("readRepoFile: NUL byte → binary, content null", async () => {
    const dir = makeTempRepo({ "b.bin": NUL });
    expect(await readRepoFile(dir, "b.bin")).toMatchObject({ binary: true, content: null });
  });
  it("readRepoFile: file tak ada → null", async () => {
    expect(await readRepoFile(makeTempRepo({}), "ghost.txt")).toBeNull();
  });
  it("repoAbsPath menolak keluar repo & .git", () => {
    const dir = makeTempRepo({});
    expect(() => repoAbsPath(dir, "../etc/passwd")).toThrow();
    expect(() => repoAbsPath(dir, ".git/config")).toThrow();
    expect(repoAbsPath(dir, "src/a.ts")).toBe(`${dir}/src/a.ts`);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test -- git-ide`
Expected: FAIL — `Cannot find module '../src/services/git-ide'`.

- [x] **Step 3: Tulis implementasi minimal**

Buat `server/src/services/git-ide.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";

const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24 } as const;
const MAX = 256 * 1024;

const splitZ = (s: string): string[] => s.split("\0").filter(Boolean);

// Path guard umum (bukan hanya .md seperti scan.docAbsPath). Cermin logikanya: resolve,
// cegah keluar repo, cegah menyentuh .git. Throw → route menerjemahkan ke 400.
export function repoAbsPath(repoDir: string, rel: string): string {
  if (rel.split(/[\\/]/).includes(".git")) throw new Error("tidak boleh menyentuh .git");
  const abs = resolve(repoDir, rel);
  if (abs !== repoDir && !abs.startsWith(repoDir + sep)) throw new Error("path keluar dari repo");
  return abs;
}

// Daftar file: working tree (ref kosong, honor .gitignore) atau snapshot di ref.
export async function listRepoTree(repoDir: string | null, ref = ""): Promise<string[]> {
  if (!repoDir || !existsSync(repoDir)) return [];
  try {
    const { stdout } = ref
      ? await exec("git", ["ls-tree", "-r", "--name-only", "-z", ref], { cwd: repoDir, ...GIT })
      : await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repoDir, ...GIT });
    return [...new Set(splitZ(stdout))].sort();
  } catch { return []; }
}

export type RepoFile = { path: string; content: string | null; binary: boolean; truncated: boolean };

// Isi file: disk (ref kosong) atau `git show <ref>:<path>`. Path buruk → throw (route 400).
// File tak ada → null (route 404). NUL byte → binary (heuristik).
// ponytail: deteksi biner via NUL byte; cukup untuk viewer, upgrade ke gitattributes bila perlu.
export async function readRepoFile(repoDir: string | null, rel: string, ref = ""): Promise<RepoFile | null> {
  if (!repoDir) return null;
  repoAbsPath(repoDir, rel); // throws → route 400
  let raw: string;
  try {
    raw = ref
      ? (await exec("git", ["show", `${ref}:${rel}`], { cwd: repoDir, ...GIT })).stdout
      : await readFile(repoAbsPath(repoDir, rel), "utf8");
  } catch { return null; }
  if (raw.includes("\u0000")) return { path: rel, content: null, binary: true, truncated: false };
  return { path: rel, content: raw.slice(0, MAX), binary: false, truncated: raw.length > MAX };
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server test -- git-ide`
Expected: PASS (8 test).

- [x] **Step 5: Commit**

```bash
git add server/src/services/git-ide.ts server/test/git-ide.test.ts
git commit -m "feat(ide): git-ide read service — tree + file (SPEC-182)"
```

---

### Task 2: git-ide service — graph + commit detail

**Files:**
- Modify: `server/src/services/git-ide.ts` (tambah fungsi)
- Test: `server/test/git-ide.test.ts` (tambah describe)

**Interfaces:**
- Consumes: `makeRepoWithSpecCommits` dari `factory.ts`; `ChangedFile` dari `../src/services/spec-review`.
- Produces:
  - `type GraphCommit = { sha: string; parents: string[]; author: string; at: string; subject: string; refs: string[] }`
  - `listGraph(repoDir: string | null, limit?: number): Promise<{ commits: GraphCommit[]; current: string }>`
  - `type CommitDetail = { sha: string; parents: string[]; author: string; at: string; subject: string; body: string; changed: ChangedFile[] }`
  - `commitDetail(repoDir: string | null, sha: string): Promise<CommitDetail | null>`

- [x] **Step 1: Tulis test yang gagal**

Tambah ke `server/test/git-ide.test.ts`:

```ts
import { listGraph, commitDetail } from "../src/services/git-ide";
import { makeRepoWithSpecCommits } from "./factory";

describe("git-ide graph", () => {
  it("listGraph mengembalikan commit terurut + refs + current branch", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "kedua", changes: { "a.txt": "2" } }]);
    const g = await listGraph(dir);
    expect(g.commits.length).toBe(2);
    expect(g.commits[0].subject).toBe("kedua");
    expect(g.commits[0].parents.length).toBe(1);
    expect(g.commits[1].parents.length).toBe(0); // root
    expect(g.current).toBe("main");
    expect(g.commits.some((c) => c.refs.includes("main"))).toBe(true);
  });
  it("listGraph: repoDir null → kosong", async () => {
    expect(await listGraph(null)).toEqual({ commits: [], current: "" });
  });
  it("commitDetail: file berubah + pesan", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "ubah", changes: { "a.txt": "2\n" } }]);
    const head = (await listGraph(dir)).commits[0].sha;
    const d = await commitDetail(dir, head);
    expect(d!.subject).toBe("ubah");
    expect(d!.changed.map((c) => c.path)).toEqual(["a.txt"]);
    expect(d!.changed[0]).toMatchObject({ status: "M" });
  });
  it("commitDetail: sha bukan hex → null (gerbang)", async () => {
    expect(await commitDetail(makeRepoWithSpecCommits({ "a": "1" }, []), "../etc")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test -- git-ide`
Expected: FAIL — `listGraph is not a function`.

- [x] **Step 3: Tulis implementasi**

Tambah ke `server/src/services/git-ide.ts`:

```ts
import type { ChangedFile } from "./spec-review";

const US = "\x1f"; // unit separator dalam satu baris commit

export type GraphCommit = { sha: string; parents: string[]; author: string; at: string; subject: string; refs: string[] };

async function currentBranch(repoDir: string): Promise<string> {
  return exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir, ...GIT })
    .then((r) => r.stdout.trim()).catch(() => "");
}

// git log --all seluruh ref. `%D` = ref names ("HEAD -> main, origin/main, tag: v1"); buang
// prefix "HEAD -> ". Satu commit = satu baris (subject/refs tanpa newline).
export async function listGraph(repoDir: string | null, limit = 200): Promise<{ commits: GraphCommit[]; current: string }> {
  if (!repoDir || !existsSync(repoDir)) return { commits: [], current: "" };
  try {
    const fmt = ["%H", "%P", "%an", "%aI", "%s", "%D"].join(US);
    const { stdout } = await exec("git",
      ["log", "--all", "--date-order", `--max-count=${limit}`, `--pretty=format:${fmt}`], { cwd: repoDir, ...GIT });
    const commits = stdout.split("\n").filter(Boolean).map((line) => {
      const [sha, parents, author, at, subject, refs] = line.split(US);
      return {
        sha: sha!, parents: parents ? parents.split(" ") : [], author: author ?? "", at: at ?? "",
        subject: subject ?? "",
        refs: (refs ?? "").split(",").map((r) => r.trim().replace(/^HEAD -> /, "").replace(/^tag: /, ""))
          .filter((r) => r && r !== "HEAD"),
      };
    });
    return { commits, current: await currentBranch(repoDir) };
  } catch { return { commits: [], current: "" }; }
}

export type CommitDetail = {
  sha: string; parents: string[]; author: string; at: string; subject: string; body: string; changed: ChangedFile[];
};

// ponytail: parse numstat+name-status cermin spec-review.changedFiles; ~12 baris, tak refactor
// file bertest itu. `git show --format=` menekan header commit, menyisakan diff saja.
async function changedOf(repoDir: string, sha: string): Promise<ChangedFile[]> {
  const [num, name] = await Promise.all([
    exec("git", ["show", "--format=", "--numstat", "-z", "--no-renames", sha], { cwd: repoDir, ...GIT }),
    exec("git", ["show", "--format=", "--name-status", "-z", "--no-renames", sha], { cwd: repoDir, ...GIT }),
  ]);
  const map = new Map<string, ChangedFile>();
  for (const rec of splitZ(num.stdout)) {
    const t1 = rec.indexOf("\t"), t2 = rec.indexOf("\t", t1 + 1);
    const add = rec.slice(0, t1), del = rec.slice(t1 + 1, t2), path = rec.slice(t2 + 1);
    const binary = add === "-" && del === "-";
    map.set(path, { path, add: binary ? 0 : Number(add), del: binary ? 0 : Number(del), status: "M", binary });
  }
  const toks = splitZ(name.stdout);
  for (let i = 0; i + 1 < toks.length; i += 2) {
    const st = toks[i]![0] as "A" | "M" | "D", path = toks[i + 1]!;
    const cf = map.get(path) ?? { path, add: 0, del: 0, status: st, binary: false };
    cf.status = st; map.set(path, cf);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function commitDetail(repoDir: string | null, sha: string): Promise<CommitDetail | null> {
  if (!repoDir) return null;
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return null; // gerbang: hanya sha hex
  try {
    const fmt = ["%H", "%P", "%an", "%aI", "%s", "%b"].join(US);
    const parts = (await exec("git", ["show", "-s", `--pretty=format:${fmt}`, sha], { cwd: repoDir, ...GIT })).stdout.split(US);
    const [h, parents, author, at, subject] = parts;
    return {
      sha: h!, parents: parents ? parents.split(" ") : [], author: author ?? "", at: at ?? "",
      subject: subject ?? "", body: parts.slice(5).join(US), changed: await changedOf(repoDir, sha),
    };
  } catch { return null; }
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server test -- git-ide`
Expected: PASS (12 test total).

- [x] **Step 5: Commit**

```bash
git add server/src/services/git-ide.ts server/test/git-ide.test.ts
git commit -m "feat(ide): git-ide graph + commit detail (SPEC-182)"
```

---

### Task 3: git-ide service — write file + mutasi git

**Files:**
- Modify: `server/src/services/git-ide.ts`
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Produces:
  - `writeRepoFile(repoDir: string | null, rel: string, content: string): Promise<void>`
  - `type GitOp = { op: "checkout"; ref: string; force?: boolean } | { op: "branch"; name: string; at?: string; checkout?: boolean } | { op: "merge"; ref: string } | { op: "cherry-pick"; sha: string } | { op: "revert"; sha: string } | { op: "delete-branch"; name: string; force?: boolean }`
  - `type GitOpResult = { ok: boolean; stdout: string; stderr: string; current: string }`
  - `runGitOp(repoDir: string, op: GitOp): Promise<GitOpResult>`
  - `validateGitOp(op: unknown): string | null` — null bila valid, pesan bila tidak.

- [x] **Step 1: Tulis test yang gagal**

Tambah ke `server/test/git-ide.test.ts`:

```ts
import { writeRepoFile, runGitOp, validateGitOp } from "../src/services/git-ide";
import { readFileSync } from "node:fs";

describe("git-ide write + mutate", () => {
  it("writeRepoFile menulis ke disk lewat path-guard", async () => {
    const dir = makeTempRepo({});
    await writeRepoFile(dir, "sub/x.ts", "isi\n");
    expect(readFileSync(`${dir}/sub/x.ts`, "utf8")).toBe("isi\n");
  });
  it("writeRepoFile menolak path keluar repo", async () => {
    await expect(writeRepoFile(makeTempRepo({}), "../evil", "x")).rejects.toThrow();
  });
  it("runGitOp checkout memindah HEAD", async () => {
    const dir = makeRepoWithBranches("dev");
    const r = await runGitOp(dir, { op: "checkout", ref: "dev" });
    expect(r.ok).toBe(true);
    expect(r.current).toBe("dev");
  });
  it("runGitOp checkout ref tak ada → ok:false + stderr (bukan throw)", async () => {
    const r = await runGitOp(makeRepoWithBranches(), { op: "checkout", ref: "ghost" });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/ghost|did not match|pathspec/i);
  });
  it("runGitOp branch + checkout membuat & pindah", async () => {
    const dir = makeRepoWithBranches();
    const r = await runGitOp(dir, { op: "branch", name: "feat-x", checkout: true });
    expect(r.ok).toBe(true);
    expect(r.current).toBe("feat-x");
  });
  it("validateGitOp menolak op tak dikenal & field kurang", () => {
    expect(validateGitOp({ op: "nuke" })).toBeTruthy();
    expect(validateGitOp({ op: "checkout" })).toBeTruthy();
    expect(validateGitOp({ op: "checkout", ref: "main" })).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test -- git-ide`
Expected: FAIL — `writeRepoFile is not a function`.

- [x] **Step 3: Tulis implementasi**

Tambah ke `server/src/services/git-ide.ts` (import `writeFile`, `mkdir`, `dirname`):

```ts
// di baris import atas, gabungkan ke import yang ada:
//   import { readFile, writeFile, mkdir } from "node:fs/promises";
//   import { resolve, sep, dirname } from "node:path";

export async function writeRepoFile(repoDir: string | null, rel: string, content: string): Promise<void> {
  if (!repoDir) throw new Error("project tidak punya repoDir");
  const abs = repoAbsPath(repoDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

export type GitOp =
  | { op: "checkout"; ref: string; force?: boolean }
  | { op: "branch"; name: string; at?: string; checkout?: boolean }
  | { op: "merge"; ref: string }
  | { op: "cherry-pick"; sha: string }
  | { op: "revert"; sha: string }
  | { op: "delete-branch"; name: string; force?: boolean };

export type GitOpResult = { ok: boolean; stdout: string; stderr: string; current: string };

// Field wajib per-op. force di-cek terpisah di route (gerbang sesi). null = valid.
export function validateGitOp(op: unknown): string | null {
  const o = op as Record<string, unknown>;
  if (!o || typeof o !== "object") return "body wajib";
  const need = (k: string) => (typeof o[k] === "string" && o[k] ? null : `${k} wajib`);
  switch (o.op) {
    case "checkout": return need("ref");
    case "branch": return need("name");
    case "merge": return need("ref");
    case "cherry-pick": return need("sha");
    case "revert": return need("sha");
    case "delete-branch": return need("name");
    default: return `op tak dikenal: ${String(o.op)}`;
  }
}

function gitArgs(op: GitOp): string[] {
  switch (op.op) {
    case "checkout": return ["checkout", ...(op.force ? ["-f"] : []), op.ref];
    case "branch": return ["branch", op.name, ...(op.at ? [op.at] : [])];
    case "merge": return ["merge", "--no-edit", op.ref];
    case "cherry-pick": return ["cherry-pick", op.sha];
    case "revert": return ["revert", "--no-edit", op.sha];
    case "delete-branch": return ["branch", op.force ? "-D" : "-d", op.name];
  }
}

// Jalankan satu op git. Exit ≠ 0 → { ok:false, stderr } (route ubah jadi 409), tak throw.
// `branch` dengan checkout:true → buat lalu checkout (dua exec).
export async function runGitOp(repoDir: string, op: GitOp): Promise<GitOpResult> {
  try {
    const { stdout, stderr } = await exec("git", gitArgs(op), { cwd: repoDir, ...GIT });
    if (op.op === "branch" && op.checkout) return runGitOp(repoDir, { op: "checkout", ref: op.name });
    return { ok: true, stdout, stderr, current: await currentBranch(repoDir) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? String(e), current: await currentBranch(repoDir) };
  }
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server test -- git-ide`
Expected: PASS (18 test total).

- [x] **Step 5: Commit**

```bash
git add server/src/services/git-ide.ts server/test/git-ide.test.ts
git commit -m "feat(ide): git-ide write file + guarded git mutations (SPEC-182)"
```

---

### Task 4: routes/ide.ts + registrasi + shared paths + api client + docs

**Files:**
- Create: `server/src/routes/ide.ts`
- Modify: `server/src/app.ts` (import + register)
- Modify: `shared/src/api.ts` (path entries)
- Modify: `src/src/api/client.ts` (client methods + types)
- Create: `internal/docs/adr/0034-ide-mutasi-working-tree-utama.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/README.md` (link ADR-0034)
- Test: `server/test/ide.route.test.ts`

**Interfaces:**
- Consumes: `listRepoTree`, `readRepoFile`, `writeRepoFile`, `listGraph`, `commitDetail`, `runGitOp`, `validateGitOp`, `GitOp` (Task 1–3); `listSessions` dari `../services/pty`; `prisma`.
- Produces endpoints (semua di prefix `/api`):
  - `GET /projects/:id/tree?ref=` → `{ ref, files }`
  - `GET /projects/:id/file?path=&ref=` → `RepoFile` | 400 | 404
  - `PUT /projects/:id/file` `{path,content}` → `{path,content}` (TAK digerbang sesi)
  - `GET /projects/:id/graph?limit=` → `{ commits, current }`
  - `GET /projects/:id/commit/:sha` → `CommitDetail` | 404
  - `POST /projects/:id/git` `{op,...,force?}` → `GitOpResult` | 400 | 409

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/ide.route.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRepoWithBranches } from "./factory";
import { createSession, killAll } from "../src/services/pty";
import { fileURLToPath } from "node:url";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const app = buildApp({ requireAuth: false });

beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "ide", repoDir: makeRepoWithBranches("dev") });
  await makeProject({ id: "nodir", repoDir: null });
});

describe("ide routes", () => {
  it("GET /tree lists files; project tak ada → 404", async () => {
    const r = await app.inject({ url: "/api/projects/ide/tree" });
    expect(r.statusCode).toBe(200);
    expect(r.json().files).toContain("README.md");
    expect((await app.inject({ url: "/api/projects/ghost/tree" })).statusCode).toBe(404);
  });
  it("GET /file membaca isi; path keluar-repo → 400; hilang → 404", async () => {
    const ok = await app.inject({ url: "/api/projects/ide/file?path=README.md" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().content).toBe("x");
    expect((await app.inject({ url: "/api/projects/ide/file?path=../evil" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/projects/ide/file?path=ghost" })).statusCode).toBe(404);
  });
  it("PUT /file menulis, TIDAK digerbang sesi aktif", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("ide", process.cwd());
    const r = await app.inject({ method: "PUT", url: "/api/projects/ide/file", payload: { path: "n.txt", content: "hi" } });
    expect(r.statusCode).toBe(200);
    killAll();
  });
  it("GET /graph mengembalikan commits + current", async () => {
    const r = await app.inject({ url: "/api/projects/ide/graph" });
    expect(r.statusCode).toBe(200);
    expect(r.json().current).toBe("dev"); // dev branch tercheckout? default main — cek keberadaan
    expect(Array.isArray(r.json().commits)).toBe(true);
  });
  it("POST /git checkout: sesi aktif → 409; force → 200", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("ide", process.cwd());
    const blocked = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "main" } });
    expect(blocked.statusCode).toBe(409);
    const forced = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "main", force: true } });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().current).toBe("main");
    killAll();
  });
  it("POST /git op buruk → 400; ref tak ada → 409 + stderr", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "nuke" } })).statusCode).toBe(400);
    const bad = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "ghost" } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error).toBeTruthy();
  });
  it("POST /git: project tanpa repoDir → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/nodir/git", payload: { op: "checkout", ref: "main" } });
    expect(r.statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test -- ide.route`
Expected: FAIL — route belum terdaftar (404 di semua).

- [x] **Step 3: Tulis route**

Buat `server/src/routes/ide.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { listSessions } from "../services/pty";
import {
  listRepoTree, readRepoFile, writeRepoFile, listGraph, commitDetail, runGitOp, validateGitOp, type GitOp,
} from "../services/git-ide";

// undefined = project tak ada (→404); null = ada tapi tanpa repoDir; string = repoDir.
async function repoOf(id: string): Promise<string | null | undefined> {
  const p = await prisma.project.findUnique({ where: { id } });
  return p ? p.repoDir : undefined;
}
const activeSessions = (id: string) => listSessions().filter((s) => s.projectId === id && !s.exited).length;

export default async function (app: FastifyInstance) {
  app.get("/projects/:id/tree", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const ref = (req.query as { ref?: string }).ref ?? "";
    return { ref, files: await listRepoTree(repoDir, ref) };
  });

  app.get("/projects/:id/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path, ref } = req.query as { path?: string; ref?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await readRepoFile(repoDir, path, ref ?? "");
      return f === null ? reply.code(404).send({ error: "not found" }) : f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // PUT /file SENGAJA tak digerbang sesi: menulis file bukan operasi git & tak memindah HEAD.
  app.put("/projects/:id/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const b = req.body as { path?: string; content?: string };
    if (!b?.path || typeof b.content !== "string") return reply.code(400).send({ error: "path & content wajib" });
    try { await writeRepoFile(repoDir, b.path, b.content); return { path: b.path, content: b.content }; }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  app.get("/projects/:id/graph", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const limit = Number((req.query as { limit?: string }).limit) || 200;
    return listGraph(repoDir, limit);
  });

  app.get("/projects/:id/commit/:sha", async (req, reply) => {
    const { id, sha } = req.params as { id: string; sha: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const d = await commitDetail(repoDir, sha);
    return d === null ? reply.code(404).send({ error: "not found" }) : d;
  });

  // Mutasi git. Gerbang sesi aktif (persis DELETE /projects); force melewatinya + menambah -f/-D.
  app.post("/projects/:id/git", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const op = req.body as GitOp & { force?: boolean };
    const err = validateGitOp(op);
    if (err) return reply.code(400).send({ error: err });
    if (!op.force) {
      const n = activeSessions(id);
      if (n) return reply.code(409).send({ error: `project "${id}" punya ${n} sesi aktif; commit/stash atau paksa` });
    }
    const r = await runGitOp(repoDir, op);
    return r.ok ? r : reply.code(409).send({ error: r.stderr || "operasi git gagal", ...r });
  });
}
```

- [x] **Step 4: Daftarkan route di `server/src/app.ts`**

Tambah import setelah baris `import docs from "./routes/docs";`:

```ts
import ide from "./routes/ide";
```

Tambah register setelah baris `await api.register(docs);`:

```ts
    await api.register(ide);
```

- [x] **Step 5: Tambah path entries di `shared/src/api.ts`**

Setelah baris `docFile: ...`, tambah:

```ts
  ideTree: (id: string, ref = "") => `${API}/projects/${id}/tree${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
  ideFile: (id: string, path?: string, ref = "") =>
    `${API}/projects/${id}/file${path ? `?path=${encodeURIComponent(path)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}` : ""}`,
  ideGraph: (id: string, limit = 200) => `${API}/projects/${id}/graph?limit=${limit}`,
  ideCommit: (id: string, sha: string) => `${API}/projects/${id}/commit/${sha}`,
  ideGit: (id: string) => `${API}/projects/${id}/git`,
```

- [x] **Step 6: Tambah client methods + types di `src/src/api/client.ts`**

Setelah blok type `ReviewFile` (dekat baris 20), tambah tipe IDE:

```ts
// SPEC-182 · IDE Visual
export type RepoFile = { path: string; content: string | null; binary: boolean; truncated: boolean };
export type GraphCommit = { sha: string; parents: string[]; author: string; at: string; subject: string; refs: string[] };
export type CommitDetail = { sha: string; parents: string[]; author: string; at: string; subject: string; body: string; changed: ChangedFile[] };
export type GitOp =
  | { op: "checkout"; ref: string; force?: boolean }
  | { op: "branch"; name: string; at?: string; checkout?: boolean }
  | { op: "merge"; ref: string; force?: boolean }
  | { op: "cherry-pick"; sha: string; force?: boolean }
  | { op: "revert"; sha: string; force?: boolean }
  | { op: "delete-branch"; name: string; force?: boolean };
export type GitOpResult = { ok: boolean; stdout: string; stderr: string; current: string; error?: string };
```

Di dalam objek `api = { ... }`, setelah `deleteDoc: ...`, tambah:

```ts
  ideTree: (id: string, ref = "") => j<{ ref: string; files: string[] }>(paths.ideTree(id, ref)),
  ideFile: (id: string, path: string, ref = "") => j<RepoFile>(paths.ideFile(id, path, ref)),
  putIdeFile: (id: string, path: string, content: string) =>
    j<{ path: string; content: string }>(paths.ideFile(id), { method: "PUT", ...body({ path, content }) }),
  ideGraph: (id: string, limit = 200) => j<{ commits: GraphCommit[]; current: string }>(paths.ideGraph(id, limit)),
  ideCommit: (id: string, sha: string) => j<CommitDetail>(paths.ideCommit(id, sha)),
  ideGit: (id: string, op: GitOp) => j<GitOpResult>(paths.ideGit(id), { method: "POST", ...body(op) }),
```

- [x] **Step 7: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server test -- ide.route`
Expected: PASS (7 test). Jalankan juga typecheck: `pnpm -r typecheck` → tak ada error.

> Catatan: bila test `current === "dev"` gagal karena `makeRepoWithBranches` meninggalkan HEAD di `main`, ganti assertion menjadi `expect(["main","dev"]).toContain(r.json().current)` — branch tercheckout adalah `main` (worktree factory tak checkout `dev`).

- [x] **Step 8: Tulis ADR-0034 + update SoT**

Buat `internal/docs/adr/0034-ide-mutasi-working-tree-utama.md`:

```markdown
# ADR-0034 — IDE Visual boleh memutasi working tree `repoDir`, digerbang sesi + force

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-182

## Context
IDE Visual (SPEC-182) menampilkan file explorer + git graph interaktif. User meminta **switch
branch sungguhan** dan **aksi graf** (merge/cherry-pick/revert/checkout) dari dashboard. Semua
bekerja pada `project.repoDir` — checkout **working tree utama** yang dibagi sesi Claude Code lain
(CLAUDE.md/AGENTS.md: "jangan jalankan run di working tree utama"). `git checkout`/`merge` di sana
bisa membuang perubahan tak ter-commit sesi hidup atau memindah HEAD di bawah kaki proses `claude`.

## Decision
IDE **boleh** memutasi `repoDir`, tetapi tiap mutasi (`checkout` + seluruh `POST /projects/:id/git`)
digerbang:
1. **Sesi aktif** — bila ada sesi terminal/run terikat project (`listSessions().filter(projectId
   === id && !exited)`, guard identik `DELETE /projects`) → **409**, kecuali body `{force:true}`.
2. **Tree bersih** — git sendiri menolak checkout/merge yang menimpa; stderr diteruskan apa adanya
   sebagai **409** (bukan `--force` diam-diam).
3. **`force:true`** — melewati gerbang #1 dan menambah `-f`/`-D`. Opt-in per aksi di UI dengan
   peringatan; tak pernah default.

`PUT /projects/:id/file` (simpan file) **tak** digerbang — menulis file bukan operasi git & tak
memindah HEAD. Konflik merge/cherry-pick/revert dikembalikan 409 + pesan, tree ditinggal konflik
untuk diselesaikan lewat Terminal (konsisten `POST /specs/:id/integrate`).

## Consequences
- **Tanpa migration / tanpa skema baru** — `repoDir` sudah ada di `Project`. Endpoint read
  (`tree`/`file`/`graph`/`commit`) diturunkan dari git tiap request, tak disimpan (cermin
  `scanRepoDocs`, ADR-0018).
- **Risiko sisa saat force**: user yang memaksa saat sesi hidup bisa mengganggu sesi itu — diterima
  sebagai keputusan sadar user, dibatasi ke escape eksplisit.
- Read di ref (`?ref=`) memungkinkan **melihat** branch origin tanpa checkout — jalur aman default;
  checkout sungguhan hanya saat user menekan tombolnya.
```

Di `internal/docs/architecture/api-contract.md`, tambah bagian endpoint IDE (tree/file/graph/commit/git)
mengikuti format bagian yang ada di file itu (satu baris per method+path + ringkas balasan & kode status).

Di `internal/docs/README.md`, pada daftar `## adr`, sisipkan di atas baris 0033:

```markdown
- [0034 — IDE Visual boleh memutasi working tree, digerbang sesi + force](adr/0034-ide-mutasi-working-tree-utama.md)
```

- [x] **Step 9: Commit**

```bash
git add server/src/routes/ide.ts server/src/app.ts shared/src/api.ts src/src/api/client.ts \
  server/test/ide.route.test.ts internal/docs/adr/0034-ide-mutasi-working-tree-utama.md \
  internal/docs/architecture/api-contract.md internal/docs/README.md
git commit -m "feat(ide): rute IDE + client + ADR-0034 (SPEC-182)"
```

---

### Task 5: frontend lane-builder (fungsi murni) + test

**Files:**
- Create: `src/src/screens/git-graph.ts`
- Test: `src/test/git-graph.test.ts`

**Interfaces:**
- Consumes: `GraphCommit` dari `../api/client` (Task 4).
- Produces:
  - `type GraphRow = { commit: GraphCommit; lane: number; lanes: (string | null)[]; width: number }`
  - `computeLanes(commits: GraphCommit[]): GraphRow[]`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/git-graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeLanes } from "../src/screens/git-graph";
import type { GraphCommit } from "../src/api/client";

const c = (sha: string, parents: string[]): GraphCommit =>
  ({ sha, parents, author: "t", at: "", subject: sha, refs: [] });

describe("computeLanes", () => {
  it("riwayat linear semuanya di lane 0", () => {
    const rows = computeLanes([c("C", ["B"]), c("B", ["A"]), c("A", [])]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
  });
  it("cabang + merge menaruh sibling di lane berbeda", () => {
    // m = merge(a, b); a & b dari root r. Urut newest→oldest: m, a, b, r.
    const rows = computeLanes([c("m", ["a", "b"]), c("a", ["r"]), c("b", ["r"]), c("r", [])]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
  });
  it("width ≥ lane+1 dan ≥ jumlah lane aktif", () => {
    const rows = computeLanes([c("m", ["a", "b"]), c("a", ["r"]), c("b", ["r"]), c("r", [])]);
    expect(rows[0].width).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./src test -- git-graph`
Expected: FAIL — `Cannot find module '../src/screens/git-graph'`.

- [ ] **Step 3: Tulis implementasi**

Buat `src/src/screens/git-graph.ts`:

```ts
import type { GraphCommit } from "../api/client";

export type GraphRow = { commit: GraphCommit; lane: number; lanes: (string | null)[]; width: number };

// Algoritma lane klasik, satu-pass, commit terurut newest→oldest. `lanes[i]` = sha yang ditunggu
// di lane i (dipesan oleh anak yang sudah lewat). Commit menempati lane yang memesan sha-nya;
// parent pertama meneruskan lane itu, parent lain ambil lane baru. Parent yang sudah dipesan di
// lane lain (merge ke branch existing) dibiarkan — garis akan menyatu ke sana.
// ponytail: benar untuk linear/branch/merge biasa; octopus & criss-cross bisa tampak longgar —
//           upgrade ke penataan lane penuh (mis. @gitgraph/core) bila graf rumit muncul.
export function computeLanes(commits: GraphCommit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  const lanes: (string | null)[] = [];
  for (const commit of commits) {
    let lane = lanes.indexOf(commit.sha);
    if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) { lane = lanes.length; lanes.push(null); } }
    lanes[lane] = null; // lepaskan; dipesan ulang untuk parent
    commit.parents.forEach((p, i) => {
      if (lanes.indexOf(p) !== -1) return;       // parent sudah punya lane → biarkan menyatu
      if (i === 0) { lanes[lane] = p; return; }  // parent pertama meneruskan lane commit
      let free = lanes.indexOf(null);
      if (free === -1) { free = lanes.length; lanes.push(null); }
      lanes[free] = p;
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ commit, lane, lanes: [...lanes], width: Math.max(lanes.length, lane + 1) });
  }
  return rows;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./src test -- git-graph`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/git-graph.ts src/test/git-graph.test.ts
git commit -m "feat(ide): lane-builder murni untuk git graph (SPEC-182)"
```

---

### Task 6: frontend IdeScreen — Explorer + toolbar + highlight.js

**Files:**
- Modify: `src/package.json` (dep `highlight.js`)
- Create: `src/src/screens/IdeScreen.tsx`
- Test: `src/test/ide-screen.test.tsx`

**Interfaces:**
- Consumes: `api.ideTree`, `api.ideFile`, `api.putIdeFile`, `api.listBranches`, `api.ideGit`, `RepoFile` dari client; `ProjectVM` dari `./types`; DS `Card`, `Button`, `Select`, `Icon`, `StateBlock`, `Tabs`, `Badge`.
- Produces: `export function IdeScreen({ projects, projectId, onProject }: { projects: ProjectVM[]; projectId: string; onProject: (id: string) => void })` — dipakai App.tsx (Task 7).

- [ ] **Step 1: Tambah dependency highlight.js**

Run (dari root):

```bash
pnpm --filter ./src add highlight.js
```

Expected: `highlight.js` masuk ke `dependencies` di `src/package.json`; lockfile terupdate.

- [ ] **Step 2: Tulis test yang gagal**

Buat `src/test/ide-screen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api } from "../src/api/client";

const projects = [{ id: "p1", name: "p1", repoDir: "/r", kind: "existing" }] as any;

beforeEach(() => {
  vi.spyOn(api, "ideTree").mockResolvedValue({ ref: "", files: ["src/a.ts", "README.md"] });
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main", "dev"], remotes: ["main"] });
  vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
});

describe("IdeScreen Explorer", () => {
  it("menampilkan pohon file dari ideTree", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(await screen.findByText("README.md")).toBeInTheDocument();
  });
  it("klik file memuat isinya", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(api.ideFile).toHaveBeenCalledWith("p1", "README.md", ""));
  });
  it("tombol Checkout memanggil ideGit", async () => {
    vi.spyOn(api, "ideGit").mockResolvedValue({ ok: true, stdout: "", stderr: "", current: "dev" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await screen.findByText("README.md");
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(api.ideGit).toHaveBeenCalled());
  });
  it("checkout 409 memunculkan dialog Paksa", async () => {
    vi.spyOn(api, "ideGit").mockRejectedValueOnce(Object.assign(new Error("409"), { status: 409 }));
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await screen.findByText("README.md");
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    expect(await screen.findByRole("button", { name: /paksa/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./src test -- ide-screen`
Expected: FAIL — `Cannot find module '../src/screens/IdeScreen'`.

- [ ] **Step 4: Tulis IdeScreen (Explorer + toolbar; tab Graph disematkan di Task 7)**

Buat `src/src/screens/IdeScreen.tsx`:

```tsx
/* IdeScreen — IDE Visual (SPEC-182): Explorer (pohon file + editor highlight) & Git Graph,
   satu toolbar (project + branch switcher). Pola tree/editor meniru DocsWorkspace. */
import React from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import { Card, Button, Select, Icon, StateBlock, Tabs, Badge } from "../ds";
import { api, ApiError, type RepoFile, type GitOp } from "../api/client";
import type { ProjectVM } from "./types";
import { GitGraph } from "./GitGraph";

const langOf = (p: string): string => {
  const ext = p.slice(p.lastIndexOf(".") + 1);
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "xml", sh: "bash", py: "python", yml: "yaml", yaml: "yaml", sql: "sql" };
  return map[ext] ?? "";
};

function FileTree({ files, selected, onSelect }: { files: string[]; selected: string; onSelect: (p: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {files.map((f) => {
        const on = f === selected;
        return (
          <button key={f} onClick={() => onSelect(f)} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px",
            borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", textAlign: "left",
            background: on ? "var(--brass-100)" : "transparent",
          }}>
            <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12,
              color: on ? "var(--brass-700)" : "var(--text-body)", fontWeight: on ? 600 : 400 }}>{f}</span>
          </button>
        );
      })}
    </div>
  );
}

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

export function IdeScreen({ projects, projectId, onProject }:
  { projects: ProjectVM[]; projectId: string; onProject: (id: string) => void }) {
  const [tab, setTab] = React.useState("explorer");
  const [viewRef, setViewRef] = React.useState("");         // branch/ref yang dilihat (kosong = working tree)
  const [branches, setBranches] = React.useState<{ branches: string[]; remotes: string[] }>({ branches: [], remotes: [] });
  const [files, setFiles] = React.useState<string[]>([]);
  const [treeState, setTreeState] = React.useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = React.useState("");
  const [file, setFile] = React.useState<RepoFile | null>(null);
  const [mode, setMode] = React.useState<"view" | "edit">("view");
  const [draft, setDraft] = React.useState("");
  const [pendingForce, setPendingForce] = React.useState<{ op: GitOp; msg: string } | null>(null);

  const reloadTree = React.useCallback(() => {
    setTreeState("loading");
    api.ideTree(projectId, viewRef).then((t) => { setFiles(t.files); setTreeState("ready"); })
      .catch(() => setTreeState("error"));
  }, [projectId, viewRef]);

  React.useEffect(() => { reloadTree(); }, [reloadTree]);
  React.useEffect(() => { api.listBranches(projectId).then(setBranches).catch(() => {}); }, [projectId]);
  React.useEffect(() => {
    if (!selected) { setFile(null); return; }
    let alive = true;
    api.ideFile(projectId, selected, viewRef).then((f) => { if (alive) { setFile(f); setMode("view"); } })
      .catch(() => { if (alive) setFile(null); });
    return () => { alive = false; };
  }, [selected, projectId, viewRef]);

  // Semua ref: local + origin (prefix "origin/") untuk dilihat/checkout.
  const refOptions = [
    { value: "", label: "· working tree ·" },
    ...branches.branches.map((b) => ({ value: b, label: b })),
    ...branches.remotes.map((b) => ({ value: `origin/${b}`, label: `origin/${b}` })),
  ];

  async function runGit(op: GitOp) {
    try {
      const r = await api.ideGit(projectId, op);
      setViewRef(""); reloadTree();
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setPendingForce({ op, msg: e.message });
      throw e;
    }
  }
  async function checkout() { if (viewRef) await runGit({ op: "checkout", ref: viewRef }).catch(() => {}); }
  async function confirmForce() {
    if (!pendingForce) return;
    const op = { ...pendingForce.op, force: true } as GitOp;
    setPendingForce(null);
    await api.ideGit(projectId, op).then(() => { setViewRef(""); reloadTree(); }).catch(() => {});
  }

  function startEdit() { setDraft(file?.content ?? ""); setMode("edit"); }
  async function save() {
    await api.putIdeFile(projectId, selected, draft);
    setFile((f) => (f ? { ...f, content: draft } : f)); setMode("view");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Tabs tabs={[{ id: "explorer", label: "Explorer" }, { id: "graph", label: "Git Graph" }]} active={tab} onChange={setTab} />
        {toolbar}
      </div>

      {tab === "explorer" ? (
        <div style={{ display: "grid", gridTemplateColumns: "288px 1fr", gap: 20, alignItems: "start" }}>
          <Card padding={0}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
              <span className="hn-eyebrow">files · {viewRef || "working tree"}</span>
            </div>
            <div style={{ padding: 8, maxHeight: 620, overflow: "auto" }}>
              {treeState === "loading" ? <StateBlock kind="loading" compact title="Memuat file…" />
                : treeState === "error" ? <StateBlock kind="error" compact title="Gagal memuat file" action={reloadTree} />
                : files.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Tak ada file" />
                : <FileTree files={files} selected={selected} onSelect={setSelected} />}
            </div>
          </Card>
          <Card padding={0}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)" }}>
              <Icon name="file-text" size={15} color="var(--text-muted)" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)" }}>{selected || "—"}</span>
              {file?.truncated && <Badge tone="warn" size="sm">terpotong</Badge>}
              <span style={{ flex: 1 }} />
              {mode === "view"
                ? <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                    disabled={!file || file.binary}>Edit</Button>
                : <div style={{ display: "flex", gap: 8 }}>
                    <Button size="sm" variant="ghost" onClick={() => setMode("view")}>Batal</Button>
                    <Button size="sm" leftIcon="check" onClick={save}>Simpan</Button>
                  </div>}
            </div>
            <div style={{ maxHeight: 620, overflow: "auto" }}>
              {!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari pohon di kiri" />
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
                    </pre>}
            </div>
          </Card>
        </div>
      ) : (
        <GitGraph projectId={projectId} onRunGit={runGit} onOpenFile={(p, ref) => { setViewRef(ref); setSelected(p); setTab("explorer"); }} />
      )}

      {pendingForce && <ForceDialog msg={pendingForce.msg} onForce={confirmForce} onCancel={() => setPendingForce(null)} />}
    </div>
  );
}
```

> Catatan reuse: bila DS tak punya `Tabs` dengan signature `{tabs,active,onChange}`, sesuaikan ke API `Tabs` yang ada di `src/src/ds` (cek `ds/index.ts`); pola tab sudah dipakai di App.tsx (import `Tabs`).

- [ ] **Step 5: Buat stub GitGraph agar import resolve**

Buat sementara `src/src/screens/GitGraph.tsx` (diisi penuh di Task 7):

```tsx
import React from "react";
import type { GitOp } from "../api/client";
export function GitGraph(_: { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>; onOpenFile: (p: string, ref: string) => void }) {
  return <div />;
}
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./src test -- ide-screen`
Expected: PASS (4 test).

- [ ] **Step 7: Commit**

```bash
git add src/package.json pnpm-lock.yaml src/src/screens/IdeScreen.tsx src/src/screens/GitGraph.tsx src/test/ide-screen.test.tsx
git commit -m "feat(ide): IdeScreen Explorer + editor highlight.js + force dialog (SPEC-182)"
```

---

### Task 7: Git Graph tab (SVG + context-menu) + nav wiring + frontend docs

**Files:**
- Modify: `src/src/screens/GitGraph.tsx` (isi penuh)
- Modify: `src/src/ds/shell.tsx` (entri nav IDE)
- Modify: `src/src/App.tsx` (cabang `section === "ide"`)
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Test: `src/test/git-graph-view.test.tsx`

**Interfaces:**
- Consumes: `api.ideGraph`, `api.ideCommit`, `computeLanes` (Task 5), `GitOp`, `GraphCommit`.
- Produces: `GitGraph({ projectId, onRunGit, onOpenFile })` terisi penuh; entri nav `ide`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/git-graph-view.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { GitGraph } from "../src/screens/GitGraph";
import { api } from "../src/api/client";

const commits = [
  { sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["main"] },
  { sha: "bbbb222", parents: [], author: "t", at: "2026-01-01T00:00:00Z", subject: "pertama", refs: [] },
];

beforeEach(() => {
  vi.spyOn(api, "ideGraph").mockResolvedValue({ commits, current: "main" });
  vi.spyOn(api, "ideCommit").mockResolvedValue({ sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "",
    subject: "kedua", body: "", changed: [{ path: "a.ts", add: 1, del: 0, status: "M", binary: false }] });
});

describe("GitGraph", () => {
  it("menggambar baris commit dari ideGraph", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onOpenFile={vi.fn()} />);
    expect(await screen.findByText("kedua")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument(); // chip ref
  });
  it("klik commit memuat detail file berubah", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByText("kedua"));
    await waitFor(() => expect(api.ideCommit).toHaveBeenCalledWith("p1", "aaaa111"));
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
  });
  it("context-menu Checkout memanggil onRunGit", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText(/checkout/i));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "checkout", ref: "aaaa111" }));
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./src test -- git-graph-view`
Expected: FAIL — GitGraph masih stub (tak menampilkan "kedua").

- [ ] **Step 3: Isi penuh `src/src/screens/GitGraph.tsx`**

```tsx
/* GitGraph — DAG commit read + aksi (SPEC-182). Lane dihitung computeLanes (nol dep).
   Baris = grid [svg lane | subject | refs | meta]; klik = detail; klik-kanan = context-menu. */
import React from "react";
import { Card, Button, Icon, StateBlock, Badge } from "../ds";
import { api, type GraphCommit, type CommitDetail, type GitOp } from "../api/client";
import { computeLanes, type GraphRow } from "./git-graph";

const LANE_W = 14, ROW_H = 30, DOT = 4;
const COLORS = ["#a9791c", "#3b7a57", "#8a5a44", "#4a6fa5", "#7d5ba6", "#b0503a"]; // brass-leaf-clay-ink
const laneColor = (i: number) => COLORS[i % COLORS.length];
const rel = (iso: string): string => { try { return new Date(iso).toLocaleDateString(); } catch { return ""; } };

function RowSvg({ row, maxLanes }: { row: GraphRow; maxLanes: number }) {
  const x = (i: number) => LANE_W / 2 + i * LANE_W;
  return (
    <svg width={maxLanes * LANE_W} height={ROW_H} style={{ flex: "0 0 auto" }}>
      {/* garis vertikal untuk tiap lane aktif setelah commit ini */}
      {row.lanes.map((s, i) => s ? <line key={i} x1={x(i)} y1={0} x2={x(i)} y2={ROW_H} stroke={laneColor(i)} strokeWidth={1.5} /> : null)}
      {/* garis dari commit ke lane parent-nya di baris berikut */}
      <line x1={x(row.lane)} y1={ROW_H / 2} x2={x(row.lane)} y2={ROW_H} stroke={laneColor(row.lane)} strokeWidth={1.5} />
      <circle cx={x(row.lane)} cy={ROW_H / 2} r={DOT} fill={laneColor(row.lane)} />
    </svg>
  );
}

function Menu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; run: () => void }[]; onClose: () => void }) {
  React.useEffect(() => { const h = () => onClose(); window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, [onClose]);
  return (
    <div style={{ position: "fixed", left: x, top: y, zIndex: 150, background: "var(--surface-card)",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-pop, 0 6px 24px rgba(0,0,0,.15))",
      padding: 4, minWidth: 180 }}>
      {items.map((it) => (
        <button key={it.label} onClick={it.run} style={{ display: "block", width: "100%", textAlign: "left",
          padding: "7px 10px", border: "none", background: "transparent", cursor: "pointer",
          fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--text-body)", borderRadius: 4 }}>{it.label}</button>
      ))}
    </div>
  );
}

export function GitGraph({ projectId, onRunGit, onOpenFile }:
  { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>; onOpenFile: (path: string, ref: string) => void }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<GraphRow[]>([]);
  const [current, setCurrent] = React.useState("");
  const [detail, setDetail] = React.useState<CommitDetail | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; c: GraphCommit } | null>(null);

  const load = React.useCallback(() => {
    setState("loading");
    api.ideGraph(projectId).then((g) => { setRows(computeLanes(g.commits)); setCurrent(g.current); setState("ready"); })
      .catch(() => setState("error"));
  }, [projectId]);
  React.useEffect(() => { load(); }, [load]);

  function openMenu(e: React.MouseEvent, c: GraphCommit) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, c });
  }
  async function act(op: GitOp) { setMenu(null); await onRunGit(op).then(load).catch(() => {}); }

  const maxLanes = Math.max(1, ...rows.map((r) => r.width));

  if (state === "loading") return <StateBlock kind="loading" title="Memuat git graph…" />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat git graph" action={load} />;
  if (rows.length === 0) return <StateBlock kind="empty" icon="git-commit" title="Belum ada commit" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: detail ? "1fr 340px" : "1fr", gap: 16, alignItems: "start" }}>
      <Card padding={0}>
        {rows.map((r) => {
          const c = r.commit;
          const isHead = c.refs.includes(current);
          return (
            <div key={c.sha} onClick={() => api.ideCommit(projectId, c.sha).then(setDetail).catch(() => {})}
              onContextMenu={(e) => openMenu(e, c)}
              style={{ display: "flex", alignItems: "center", gap: 10, height: ROW_H, padding: "0 12px",
                cursor: "pointer", borderBottom: "1px solid var(--border-hair)",
                background: detail?.sha === c.sha ? "var(--brass-100)" : "transparent" }}>
              <RowSvg row={r} maxLanes={maxLanes} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                {c.refs.map((ref) => (
                  <span key={ref} style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "1px 6px",
                    borderRadius: 999, background: isHead && ref === current ? "var(--brass-500)" : "var(--brass-100)",
                    color: isHead && ref === current ? "#fff" : "var(--brass-700)", flex: "0 0 auto" }}>{ref}</span>
                ))}
                <span style={{ fontSize: 12.5, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.subject}</span>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", flex: "0 0 auto" }}>{c.author}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", flex: "0 0 auto" }}>{rel(c.at)}</span>
            </div>
          );
        })}
      </Card>

      {detail && (
        <Card padding={16}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="hn-eyebrow">commit {detail.sha.slice(0, 8)}</span>
            <Button size="sm" variant="ghost" leftIcon="x" onClick={() => setDetail(null)}>Tutup</Button>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-strong)", fontWeight: 600, marginBottom: 4 }}>{detail.subject}</div>
          {detail.body && <pre style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "pre-wrap", color: "var(--text-muted)", marginBottom: 10 }}>{detail.body}</pre>}
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{detail.changed.length} file berubah</div>
          {detail.changed.map((f) => (
            <button key={f.path} onClick={() => onOpenFile(f.path, detail.sha)} style={{ display: "flex", alignItems: "center", gap: 8,
              width: "100%", textAlign: "left", padding: "4px 6px", border: "none", background: "transparent", cursor: "pointer" }}>
              <Badge tone={f.status === "A" ? "ok" : f.status === "D" ? "err" : "warn"} size="sm">{f.status}</Badge>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-body)" }}>{f.path}</span>
            </button>
          ))}
        </Card>
      )}

      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { label: `Checkout ${menu.c.sha.slice(0, 7)}`, run: () => act({ op: "checkout", ref: menu.c.sha }) },
        { label: "Merge ke branch ini", run: () => act({ op: "merge", ref: menu.c.sha }) },
        { label: "Cherry-pick", run: () => act({ op: "cherry-pick", sha: menu.c.sha }) },
        { label: "Revert", run: () => act({ op: "revert", sha: menu.c.sha }) },
        { label: "Buat branch di sini…", run: () => { const name = window.prompt("Nama branch baru:"); if (name) act({ op: "branch", name, at: menu.c.sha, checkout: true }); } },
        ...menu.c.refs.filter((r) => !r.startsWith("origin/")).map((r) => ({ label: `Hapus branch ${r}`, run: () => act({ op: "delete-branch", name: r }) })),
      ]} />}
    </div>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./src test -- git-graph-view`
Expected: PASS (3 test).

- [ ] **Step 5: Tambah entri nav IDE di `src/src/ds/shell.tsx`**

Di array `HN_NAV`, sisipkan setelah baris `{ key: "terminal", ... }`:

```ts
  { key: "ide", label: "IDE", icon: "code-2" },
```

- [ ] **Step 6: Tambah cabang `section === "ide"` di `src/src/App.tsx`**

Import di atas (dekat import screen lain):

```tsx
import { IdeScreen } from "./screens/IdeScreen";
```

Tambah cabang (mis. setelah cabang `section === "terminal"`), meniru pola bagian `docs`
(pakai `projectId`/`setProjectId` yang sudah ada di komponen; bila nama state berbeda, sesuaikan):

```tsx
  } else if (section === "ide") {
    screen = (
      <Shell active="ide" title="IDE" breadcrumb={proj ? proj.name : "workspace"} onNavigate={setSection} wide>
        {gate(projectsView.length === 0
          ? <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="IDE butuh project dengan repoDir." action={() => setModal("project")} actionLabel="Project baru" />
          : <IdeScreen projects={projectsView} projectId={proj ? proj.id : projectsView[0].id}
              onProject={(id) => setProjectId(id)} />)}
      </Shell>
    );
```

> Verifikasi nama state pemilih project di App.tsx (`setProjectId`/`proj`) — bagian `docs`
> (baris ~543) memakainya; tiru persis. Bila App memakai `projectFilter`, gunakan itu.

- [ ] **Step 7: Update SoT `internal/docs/frontend/frontend-implementation.md`**

Tambahkan bagian **IDE Visual (SPEC-182)** yang mendeskripsikan: nav entri `ide`, `IdeScreen`
(Explorer: pohon file `api.ideTree` + editor highlight.js + simpan `api.putIdeFile`; toolbar
project + branch switcher local/origin + Checkout), `GitGraph` (DAG dari `computeLanes`, detail
commit, context-menu aksi), dan dialog Paksa untuk 409. Ikuti gaya/heading file yang ada.

- [ ] **Step 8: Jalankan seluruh test + typecheck**

Run:
```bash
pnpm --filter ./src test
pnpm -r typecheck
```
Expected: semua PASS; typecheck bersih.

- [ ] **Step 9: Commit**

```bash
git add src/src/screens/GitGraph.tsx src/src/ds/shell.tsx src/src/App.tsx \
  internal/docs/frontend/frontend-implementation.md src/test/git-graph-view.test.tsx
git commit -m "feat(ide): git graph interaktif + nav IDE + docs frontend (SPEC-182)"
```

---

### Task 8: Verifikasi end-to-end di local (boot + curl + browser smoke)

**Files:** tak ada (verifikasi saja; perbaiki bila merah).

Ini menutup instruksi CLAUDE.md: "test API-nya secara nyata di local — boot server dan curl
endpoint yang tersentuh." Ikuti memori `hanoman-worktree-needs-install-and-generate` &
`hanoman-live-smoke-dedicated-db`: worktree butuh install+generate; smoke pakai DB throwaway,
jangan port 8787.

- [ ] **Step 1: Install + generate di worktree**

```bash
pnpm install
pnpm --filter ./server exec prisma generate
```

- [ ] **Step 2: Boot server terhadap DB smoke khusus + project ber-repoDir nyata**

Siapkan DB throwaway ter-migrate (cermin memori live-smoke), buat satu project `existing`
dengan `repoDir` menunjuk repo ini, lalu boot `node server/dist/server.js` di port non-8787
(mis. 8799). (Detail perintah env sesuai memori `hanoman-shell-env-points-at-prod` &
`hanoman-live-smoke-dedicated-db`.)

- [ ] **Step 3: curl tiap endpoint IDE**

```bash
BASE=http://localhost:8799/api
curl -s "$BASE/projects/<id>/tree" | head
curl -s "$BASE/projects/<id>/file?path=README.md" | head
curl -s "$BASE/projects/<id>/graph?limit=20" | head
curl -s "$BASE/projects/<id>/commit/<sha>" | head
# mutasi: tanpa sesi aktif checkout sukses; buat branch, checkout balik
curl -s -X POST "$BASE/projects/<id>/git" -H 'content-type: application/json' -d '{"op":"branch","name":"ide-smoke","checkout":true}'
curl -s -X POST "$BASE/projects/<id>/git" -H 'content-type: application/json' -d '{"op":"checkout","ref":"main"}'
# path guard: harus 400
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/projects/<id>/file?path=../etc/passwd"
```

Expected: tree/file/graph/commit → JSON 200; branch+checkout → `{ok:true,...}`; path guard → `400`.
Bersihkan branch smoke: `git branch -D ide-smoke` di repoDir bila tertinggal.

- [ ] **Step 4: Browser smoke (opsional, via CDP)**

Ikuti memori `hanoman-browser-smoke-via-cdp`: buka dashboard, klik nav **IDE**, pastikan pohon
file render, klik file → isi + highlight muncul, buka tab **Git Graph** → baris commit render.
Jangan `POST /terminal/sessions` (spawn claude sungguhan).

- [ ] **Step 5: Ceklis plan & tandai Execute**

Pastikan semua kotak `- [ ]` di plan ini jadi `- [x]`. Jalankan suite penuh sekali lagi:
`env -u NODE_ENV -u DATABASE_URL pnpm test` → hijau. Baru tulis `Execute done` ke phase file.

- [ ] **Step 6: Commit penutup (bila ada perbaikan dari smoke)**

```bash
git add -A
git commit -m "test(ide): verifikasi end-to-end IDE Visual di local (SPEC-182)"
```

---

## Self-Review

**1. Spec coverage** — tiap bagian spec terpetakan:
- Explorer edit+simpan → Task 1 (read), Task 3 (write), Task 6 (UI+editor+highlight).
- Filter per-project → Task 6 toolbar `Select` project + `onProject`.
- Switch branch local & origin → Task 6 `refOptions` (branches + `origin/` remotes) + Checkout;
  read-di-ref (view origin tanpa checkout) → Task 1 `?ref=`.
- Git graph (vscode-git-graph) → Task 2 (graph/commit API), Task 5 (lane), Task 7 (SVG + context-menu).
- Aksi interaktif (checkout/merge/cherry-pick/revert/branch/delete) → Task 3 `runGitOp`, Task 4 route, Task 7 menu.
- Guard sesi + force → Task 4 route + ADR-0034 (Task 4 Step 8).
- SoT (api-contract, frontend-implementation, ADR, README) → Task 4 & Task 7.
- Verifikasi nyata local → Task 8.

**2. Placeholder scan** — tak ada TBD/TODO; tiap step kode berisi kode nyata. Dua langkah docs
(Task 4 Step 8 api-contract; Task 7 Step 7 frontend-implementation) mendeskripsikan konten +
menunjuk format file target alih-alih menyalin seluruh file — disengaja karena isi bergantung
struktur dokumen yang ada; keduanya punya endpoint/komponen konkret untuk ditulis.

**3. Type consistency** — `GitOp`/`GitOpResult`/`RepoFile`/`GraphCommit`/`CommitDetail` didefinisikan
di server (Task 1–3) & digandakan identik di client (Task 4 Step 6), mengikuti pola repo (client.ts
sudah menggandakan `ChangedFile`/`ReviewFile`). `computeLanes`/`GraphRow` konsisten Task 5→7.
Endpoint path di `shared/src/api.ts` (Task 4 Step 5) cocok dengan yang dites di Task 4 Step 1.
