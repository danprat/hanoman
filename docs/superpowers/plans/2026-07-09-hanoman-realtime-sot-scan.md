# SPEC-011 Realtime Source-of-Truth Scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the empty DB-backed `DocFile` docs store with realtime filesystem scanning of every Markdown file in `Project.repoDir`, scoring SoT coverage from the live link graph and letting the dashboard edit/delete the real files.

**Architecture:** A pure metric (`linkedSetFrom`) lives in `@hanoman/shared` (no `node:fs`, safe for the web bundle). A server service (`scan.ts`) supplies the fs adapter — `git ls-files` for the corpus, guarded read/write/delete for edits. `services/docs.ts` becomes a thin fs delegate. `DocFile` is dropped (migration + ADR). The web gets a per-project Scan button and a Delete button.

**Tech Stack:** TypeScript (strict, ESM), Fastify, Prisma/Postgres, Vitest, React+Vite, `@hanoman/shared` (raw-TS workspace pkg, barrel `index.ts`).

## Global Constraints

- **TypeScript strict** everywhere. Test every orchestration bit.
- **No `node:*` in the shared barrel** (`shared/src/index.ts` re-exports). The web bundles it via Vite — a `node:fs` import there breaks the build. Pure code only in shared.
- **Freshness guardrail:** a changed path under top-level `src/` (the web app) with **no** changed path under `internal/docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md` blocks the Stop hook. Web tasks (Tasks 6–7) MUST include the `internal/docs` edit in the **same commit**. `server/`, `cli/`, `shared/` paths do NOT trip it.
- **Schema changes need a migration + ADR** (CLAUDE.md). Next ADR = `0010`.
- **After each task:** tick this plan's checkbox, then smoke the real API locally (boot server, curl the touched endpoint) — not just unit tests.
- **Rel paths are posix** (git emits `a/b.md`). Group/split on `/`, not `path.sep`.

---

### Task 1: Pure link-graph metric in `@hanoman/shared`

**Files:**
- Modify: `shared/src/coverage.ts` (add `resolveLink`, `linkedSetFrom`)
- Test: `shared/test/coverage.test.ts`

**Interfaces:**
- Consumes: existing `coverageOf`, `docStatusFor` (same file).
- Produces:
  - `resolveLink(fromRel: string, target: string): string` — resolve a Markdown link target to a repo-relative posix path.
  - `linkedSetFrom(indexRel: string, docs: string[], read: (rel: string) => string | null): Set<string>` — set of `docs` transitively reachable from `indexRel`. `read` is the caller's fs.

- [x] **Step 1: Write failing tests** — append to `shared/test/coverage.test.ts`:

```ts
import { coverageOf, docStatusFor, linkedSetFrom, resolveLink } from "../src/index";

describe("resolveLink", () => {
  it("resolves ./ and ../ against the source file's dir", () => {
    expect(resolveLink("a/b/c.md", "../d.md")).toBe("a/d.md");
    expect(resolveLink("a/b.md", "./e.md")).toBe("a/e.md");
    expect(resolveLink("README.md", "internal/docs/x.md")).toBe("internal/docs/x.md");
  });
});

describe("linkedSetFrom", () => {
  const docs = ["i/README.md", "i/product/prd.md", "i/orphan.md"];
  const read = (rel: string): string | null => (({
    "i/README.md": "- [PRD](product/prd.md)\n- [ext](https://x.com)\n- [anchor](#top)",
    "i/product/prd.md": "# prd",
    "i/orphan.md": "# orphan",
  }) as Record<string, string>)[rel] ?? null;

  it("reaches linked docs, drops orphans and external links", () => {
    const s = linkedSetFrom("i/README.md", docs, read);
    expect(s.has("i/product/prd.md")).toBe(true);
    expect(s.has("i/orphan.md")).toBe(false);
  });

  it("follows links through intermediate docs (transitive)", () => {
    const d = ["i/README.md", "i/a.md", "i/b.md"];
    const r = (rel: string) => (({ "i/README.md": "[a](a.md)", "i/a.md": "[b](b.md)", "i/b.md": "end" }) as Record<string, string>)[rel] ?? null;
    expect(linkedSetFrom("i/README.md", d, r).has("i/b.md")).toBe(true);
  });
});
```

- [x] **Step 2: Run, verify fail**

Run: `pnpm exec vitest run shared/test/coverage.test.ts`
Expected: FAIL — `linkedSetFrom is not a function`.

- [x] **Step 3: Implement** — append to `shared/src/coverage.ts`:

```ts
const LINK_RE = /\]\(([^)]+)\)/g;

function isExternalLink(target: string): boolean {
  return !target || /^(https?:|#|mailto:)/.test(target);
}

// Resolve a Markdown link target found inside `fromRel` to a repo-relative posix path.
export function resolveLink(fromRel: string, target: string): string {
  const clean = target.trim().split("#")[0]!.split("\\").join("/");
  if (!clean) return "";
  const dir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
  const parts = (dir ? dir.split("/") : []).concat(clean.replace(/^\.\//, "").split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

// BFS over the Markdown link graph from `indexRel`. Returns the subset of `docs`
// transitively reachable. `read(rel)` returns file contents or null. Pure — no fs.
export function linkedSetFrom(
  indexRel: string,
  docs: string[],
  read: (rel: string) => string | null,
): Set<string> {
  const inCorpus = new Set(docs);
  const seen = new Set<string>();
  const queue = [indexRel];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const md = read(cur);
    if (md === null) continue;
    for (const m of md.matchAll(LINK_RE)) {
      const target = m[1]!.trim();
      if (isExternalLink(target)) continue;
      const rel = resolveLink(cur, target);
      if (rel && inCorpus.has(rel) && !seen.has(rel)) queue.push(rel);
    }
  }
  return new Set([...seen].filter((p) => inCorpus.has(p)));
}
```

- [x] **Step 4: Run, verify pass**

Run: `pnpm exec vitest run shared/test/coverage.test.ts`
Expected: PASS (all cases).

- [x] **Step 5: Commit**

```bash
git add shared/src/coverage.ts shared/test/coverage.test.ts
git commit -m "feat(shared): linkedSetFrom + resolveLink — pure link-graph reachability (SPEC-011)"
```

---

### Task 2: Server fs scanner service (`scan.ts`) + temp-repo test helper

**Files:**
- Create: `server/src/services/scan.ts`
- Modify: `server/test/factory.ts` (add `makeTempRepo`)
- Test: `server/test/scan.test.ts`

**Interfaces:**
- Consumes: `coverageOf`, `linkedSetFrom` from `@hanoman/shared`.
- Produces (all import from `../src/services/scan`):
  - `type DocCat = { cat: string; files: string[]; linked: boolean; root: boolean }`
  - `scanRepoDocs(repoDir: string | null): { coverage: number; tree: DocCat[] }`
  - `docAbsPath(repoDir: string, rel: string): string` — guarded absolute path; throws on non-`.md`, `.git`, or repo escape.
  - `readDocFile(repoDir, rel): string | null`
  - `writeDocFile(repoDir, rel, content): void`
  - `deleteDocFile(repoDir, rel): boolean`
  - `makeTempRepo(files: Record<string,string>): string` (from factory) — a fresh `git init` dir seeded with files.

- [x] **Step 1: Add the test helper** — append to `server/test/factory.ts`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

// Fresh git repo seeded with { relPath: content }. Files are untracked-but-not-ignored,
// which `git ls-files --others --exclude-standard` lists — no commit needed.
export function makeTempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-doc-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
```

- [x] **Step 2: Write failing tests** — `server/test/scan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scanRepoDocs, readDocFile, writeDocFile, deleteDocFile, docAbsPath } from "../src/services/scan";
import { makeTempRepo } from "./factory";

describe("scanRepoDocs", () => {
  it("coverage = % of directories fully reachable from the index", () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
      "internal/docs/loose/orphan.md": "# orphan",
    });
    const { coverage, tree } = scanRepoDocs(dir);
    const linkedByCat = Object.fromEntries(tree.map((t) => [t.cat, t.linked]));
    // cats: internal/docs (README, reachable), internal/docs/product (prd, reachable),
    // internal/docs/loose (orphan, NOT reachable) -> 2/3 = 67.
    expect(coverage).toBe(67);
    expect(linkedByCat["internal/docs/product"]).toBe(true);
    expect(linkedByCat["internal/docs/loose"]).toBe(false);
  });

  it("null / missing repoDir -> empty", () => {
    expect(scanRepoDocs(null)).toEqual({ coverage: 0, tree: [] });
  });
});

describe("doc fs ops", () => {
  it("write then read back", () => {
    const dir = makeTempRepo({ "internal/docs/README.md": "# r" });
    writeDocFile(dir, "internal/docs/x.md", "# x");
    expect(readDocFile(dir, "internal/docs/x.md")).toBe("# x");
  });

  it("delete removes the file", () => {
    const dir = makeTempRepo({ "a.md": "# a" });
    expect(deleteDocFile(dir, "a.md")).toBe(true);
    expect(readDocFile(dir, "a.md")).toBeNull();
  });

  it("guard rejects traversal, non-md, and .git", () => {
    const dir = makeTempRepo({ "a.md": "# a" });
    expect(() => docAbsPath(dir, "../evil.md")).toThrow();
    expect(() => docAbsPath(dir, "notes.txt")).toThrow();
    expect(() => docAbsPath(dir, ".git/config.md")).toThrow();
  });
});
```

- [x] **Step 3: Run, verify fail**

Run: `pnpm exec vitest run server/test/scan.test.ts`
Expected: FAIL — cannot find `../src/services/scan`.

- [x] **Step 4: Implement** — `server/src/services/scan.ts`:

```ts
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { coverageOf, linkedSetFrom } from "@hanoman/shared";

export type DocCat = { cat: string; files: string[]; linked: boolean; root: boolean };

// All markdown in the repo — tracked or new — with .gitignore honored (skips
// node_modules/.worktrees/dist for free). Posix rel paths.
export function listRepoDocs(repoDir: string): string[] {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
    { cwd: repoDir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
}

// Root index for the link graph: internal/docs/README.md -> repo README.md -> none.
export function resolveIndex(repoDir: string): string {
  for (const c of ["internal/docs/README.md", "README.md"])
    if (existsSync(resolve(repoDir, c))) return c;
  return "";
}

const catOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".");
const nameOf = (rel: string) => (rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel);

// ponytail: naive full re-scan (reads every .md) per call. Add an mtime/HEAD cache
// only if a large repo makes GET /docs slow.
export function scanRepoDocs(repoDir: string | null): { coverage: number; tree: DocCat[] } {
  if (!repoDir || !existsSync(repoDir)) return { coverage: 0, tree: [] };
  const files = listRepoDocs(repoDir);
  const index = resolveIndex(repoDir);
  const read = (rel: string): string | null => {
    try { return readFileSync(resolve(repoDir, rel), "utf8"); } catch { return null; }
  };
  const linked = index ? linkedSetFrom(index, files, read) : new Set<string>();
  const byCat = new Map<string, DocCat>();
  for (const f of files) {
    const cat = catOf(f);
    const c = byCat.get(cat) ?? { cat, files: [], linked: true, root: cat === "." };
    c.files.push(nameOf(f));
    c.linked = c.linked && linked.has(f);
    byCat.set(cat, c);
  }
  const coverage = coverageOf(files.map((f) => ({ category: catOf(f), linked: linked.has(f) })));
  return { coverage, tree: [...byCat.values()] };
}

// Guarded absolute path for a repo-relative doc. `cat + "/" + name` from the tree
// round-trips straight to `rel`, so no prefix juggling.
export function docAbsPath(repoDir: string, rel: string): string {
  if (!rel.endsWith(".md")) throw new Error("hanya file .md yang diizinkan");
  if (rel.split("/").includes(".git")) throw new Error("tidak boleh menyentuh .git");
  const abs = resolve(repoDir, rel);
  if (abs !== repoDir && !abs.startsWith(repoDir + sep)) throw new Error("path keluar dari repo");
  return abs;
}

export function readDocFile(repoDir: string, rel: string): string | null {
  try { return readFileSync(docAbsPath(repoDir, rel), "utf8"); } catch { return null; }
}
export function writeDocFile(repoDir: string, rel: string, content: string): void {
  const abs = docAbsPath(repoDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
export function deleteDocFile(repoDir: string, rel: string): boolean {
  const abs = docAbsPath(repoDir, rel);
  if (!existsSync(abs)) return false;
  rmSync(abs);
  return true;
}
```

- [x] **Step 5: Run, verify pass**

Run: `pnpm exec vitest run server/test/scan.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/services/scan.ts server/test/scan.test.ts server/test/factory.ts
git commit -m "feat(server): fs doc scanner — git ls-files corpus, guarded read/write/delete (SPEC-011)"
```

---

### Task 3: Rewrite `services/docs.ts` fs-backed (add `deleteDoc`)

**Files:**
- Modify: `server/src/services/docs.ts` (full rewrite)
- Test: `server/test/docs.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `scanRepoDocs`, `readDocFile`, `writeDocFile`, `deleteDocFile` (Task 2); `prisma`.
- Produces: `docIndex(id)`, `readDoc(id, path)`, `writeDoc(id, path, content)`, `deleteDoc(id, path): Promise<boolean>` — same names the routes already import, now disk-backed.

- [x] **Step 1: Rewrite the test** — replace `server/test/docs.test.ts` entirely:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makeProject, makeTempRepo } from "./factory";
import { docIndex, readDoc, writeDoc, deleteDoc } from "../src/services/docs";

let dir: string;
beforeEach(async () => {
  await resetDb();
  dir = makeTempRepo({
    "internal/docs/README.md": "- [prd](product/prd.md)",
    "internal/docs/product/prd.md": "# prd",
  });
  await makeProject({ id: "p1", repoDir: dir });
});

describe("docs service (fs-backed)", () => {
  it("builds tree + coverage from disk", async () => {
    const ix = await docIndex("p1");
    expect(ix.tree.length).toBeGreaterThan(0);
    expect(ix.coverage).toBe(100); // both dirs reachable from index
  });
  it("reads a real doc", async () =>
    expect(await readDoc("p1", "internal/docs/product/prd.md")).toBe("# prd"));
  it("writes then reads back", async () => {
    await writeDoc("p1", "internal/docs/product/prd.md", "# edited");
    expect(await readDoc("p1", "internal/docs/product/prd.md")).toBe("# edited");
  });
  it("deletes a doc", async () => {
    expect(await deleteDoc("p1", "internal/docs/product/prd.md")).toBe(true);
    expect(await readDoc("p1", "internal/docs/product/prd.md")).toBeNull();
  });
  it("null for a missing doc", async () =>
    expect(await readDoc("p1", "internal/docs/nope.md")).toBeNull());
});
```

- [x] **Step 2: Run, verify fail**

Run: `pnpm exec vitest run server/test/docs.test.ts`
Expected: FAIL — `deleteDoc` not exported / still DB-backed.

- [x] **Step 3: Rewrite** — replace `server/src/services/docs.ts` entirely:

```ts
import { prisma } from "../db";
import { scanRepoDocs, readDocFile, writeDocFile, deleteDocFile } from "./scan";

async function repoDirOf(projectId: string): Promise<string | null> {
  const p = await prisma.project.findUnique({ where: { id: projectId } });
  return p?.repoDir ?? null;
}

export async function docIndex(projectId: string) {
  return scanRepoDocs(await repoDirOf(projectId));
}
export async function readDoc(projectId: string, path: string): Promise<string | null> {
  const dir = await repoDirOf(projectId);
  return dir ? readDocFile(dir, path) : null;
}
export async function writeDoc(projectId: string, path: string, content: string): Promise<void> {
  const dir = await repoDirOf(projectId);
  if (!dir) throw new Error("project tidak punya repoDir");
  writeDocFile(dir, path, content);
}
export async function deleteDoc(projectId: string, path: string): Promise<boolean> {
  const dir = await repoDirOf(projectId);
  return dir ? deleteDocFile(dir, path) : false;
}
```

- [x] **Step 4: Run, verify pass**

Run: `pnpm exec vitest run server/test/docs.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/docs.ts server/test/docs.test.ts
git commit -m "refactor(server): docs service reads/writes the real repo filesystem (SPEC-011)"
```

---

### Task 4: Routes — `DELETE /docs/*`, PUT guard, scan route test

**Files:**
- Modify: `server/src/routes/docs.ts` (add DELETE, wrap PUT in try/catch)
- Modify: `internal/docs/architecture/api-contract.md` (document DELETE + realtime docs)
- Test: `server/test/docs.route.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `docIndex`, `readDoc`, `writeDoc`, `deleteDoc` (Task 3); `POST /projects/:id/scan` in `routes/projects.ts` is unchanged (its `docIndex` call is now fs-backed).

- [x] **Step 1: Rewrite the route test** — replace `server/test/docs.route.test.ts` entirely:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeTempRepo } from "./factory";

const app = buildApp();
const P = "internal/docs/product/prd.md";
let dir: string;
beforeEach(async () => {
  await resetDb();
  dir = makeTempRepo({
    "internal/docs/README.md": "- [prd](product/prd.md)",
    "internal/docs/product/prd.md": "# prd",
  });
  await makeProject({ id: "p1", repoDir: dir });
});

describe("docs routes (fs-backed)", () => {
  it("index has coverage + tree", async () => {
    const res = await app.inject({ url: "/api/projects/p1/docs" });
    expect(res.json()).toHaveProperty("coverage");
    expect(Array.isArray(res.json().tree)).toBe(true);
  });
  it("reads a doc", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${P}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("# prd");
  });
  it("edits and persists to disk", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/projects/p1/docs/${P}`, payload: { content: "# changed" } });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ url: `/api/projects/p1/docs/${P}` })).json().content).toBe("# changed");
  });
  it("deletes a doc (204 then 404)", async () => {
    expect((await app.inject({ method: "DELETE", url: `/api/projects/p1/docs/${P}` })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/projects/p1/docs/${P}` })).statusCode).toBe(404);
  });
  it("rejects a non-markdown write (400)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/projects/p1/docs/product/notes.txt", payload: { content: "x" } });
    expect(res.statusCode).toBe(400);
  });
  it("POST /scan recomputes coverage from disk", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/scan" });
    expect(res.statusCode).toBe(200);
    expect(res.json().coverage).toBe(100);
  });
});
```

- [x] **Step 2: Run, verify fail**

Run: `pnpm exec vitest run server/test/docs.route.test.ts`
Expected: FAIL — DELETE returns 404 (no route) / non-md write not guarded.

- [x] **Step 3: Implement** — replace `server/src/routes/docs.ts` entirely:

```ts
import type { FastifyInstance } from "fastify";
import { zDocFileContent } from "@hanoman/shared";
import { docIndex, readDoc, writeDoc, deleteDoc } from "../services/docs";

export default async function (app: FastifyInstance) {
  app.get("/projects/:id/docs", async (req) => docIndex((req.params as { id: string }).id));

  app.get("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const content = await readDoc(id, path);
    return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
  });

  app.put("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const parsed = zDocFileContent.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await writeDoc(id, path, parsed.data.content);
      return { path, content: parsed.data.content };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    try {
      const ok = await deleteDoc(id, path);
      return ok ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
```

- [x] **Step 4: Document the endpoint** — in `internal/docs/architecture/api-contract.md`, under the project docs routes, add:

```md
- `DELETE /api/projects/:id/docs/*path` — delete the real Markdown file on disk. 204 on success, 404 if absent, 400 if the path escapes the repo or is not `.md`.
- Docs are read/written **live from `Project.repoDir`** (no DB copy). `GET /docs` re-scans the repo on each call; `POST /scan` refreshes the cached `Project.coverage`/`docStatus`.
```

- [x] **Step 5: Run, verify pass**

Run: `pnpm exec vitest run server/test/docs.route.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/docs.ts server/test/docs.route.test.ts internal/docs/architecture/api-contract.md
git commit -m "feat(server): DELETE /docs + guarded PUT; document realtime docs API (SPEC-011)"
```

---

### Task 5: Drop `DocFile` — schema, migration, ADR, factory cleanup

**Files:**
- Modify: `server/prisma/schema.prisma` (remove `DocFile` model + `Project.docs` relation)
- Create: `server/prisma/migrations/<generated>_drop_docfile/migration.sql` (via Prisma)
- Create: `internal/docs/adr/0010-docs-realtime-filesystem.md`
- Modify: `internal/docs/architecture/data-model.md` (remove DocFile row)
- Modify: `server/test/factory.ts` (drop `makeDocFile` + `docFile.deleteMany`)

**Interfaces:**
- Consumes: nothing new. After Tasks 3–4 the only remaining `prisma.docFile` references are in `factory.ts`.

- [x] **Step 1: Remove from schema** — in `server/prisma/schema.prisma`:
  - delete the whole `model DocFile { … }` block, and
  - delete the line `  docs      DocFile[]` from `model Project`.

- [x] **Step 2: Drop `prisma.docFile` from the factory** — in `server/test/factory.ts`:
  - remove `prisma.docFile.deleteMany(),` from the `resetDb` transaction, and
  - delete the entire `export function makeDocFile(...) { … }`.

- [x] **Step 3: Generate the migration**

Run: `cd server && pnpm prisma migrate dev --name drop_docfile`
Expected: creates `migrations/<ts>_drop_docfile/migration.sql` with `DROP TABLE "DocFile"`, regenerates the client (no more `prisma.docFile`).

- [x] **Step 4: Write the ADR** — `internal/docs/adr/0010-docs-realtime-filesystem.md`:

```md
# ADR-0010 — Docs are the real filesystem, not a DB copy

**Status:** accepted · **Date:** 2026-07-09 · **Spec:** SPEC-011

## Context
`DocFile` (Postgres) held a copy of each doc's path/content/linked. With the demo
seed removed the table was empty, so scan reported 0% and the docs workspace was
blank. The docs feature was disconnected from the real repo.

## Decision
Drop the `DocFile` model. Read, write, delete, and score docs directly from
`Project.repoDir` in realtime. Corpus = every `**/*.md` via `git ls-files`
(.gitignore honored). SoT coverage = % of directories whose Markdown is
transitively reachable from a root index (`internal/docs/README.md` → `README.md`),
computed by the pure `linkedSetFrom` in `@hanoman/shared`.

## Consequences
- The dashboard edits/deletes the actual files; no sync layer.
- `GET /docs` re-scans on each call (fine for typical repos; cache later if slow).
- Projects with no `repoDir` show empty docs / 0% coverage.
- The CLI run-guardrail still scans `internal/docs` only; it can adopt the shared
  metric later (out of scope here).
```

- [x] **Step 5: Update the data model doc** — in `internal/docs/architecture/data-model.md`, remove the `DocFile` entity/row and note: "Docs are not persisted — they are read live from `Project.repoDir` (ADR-0010)."

- [x] **Step 6: Verify the whole server suite is green**

Run: `pnpm exec vitest run --no-file-parallelism server/test`
Expected: PASS (no `prisma.docFile` type errors; docs/scan suites green).

- [x] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/test/factory.ts \
  internal/docs/adr/0010-docs-realtime-filesystem.md internal/docs/architecture/data-model.md
git commit -m "feat(server)!: drop DocFile table; docs live on the filesystem + ADR-0010 (SPEC-011)"
```

---

### Task 6: Web API client — `deleteDoc`

**Files:**
- Modify: `src/src/api/client.ts` (add `deleteDoc`)
- Modify: `internal/docs/frontend/frontend-implementation.md` (note delete capability) — **same commit** (freshness guardrail).
- Test: `src/test/client.test.ts`

**Interfaces:**
- Consumes: `paths.docFile(id, path)` (already exists).
- Produces: `api.deleteDoc(id: string, path: string): Promise<void>`.

- [x] **Step 1: Write the failing test** — append to `src/test/client.test.ts`:

```ts
it("deleteDoc issues DELETE to the doc path", async () => {
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as any;
  await api.deleteDoc("p1", "internal/docs/x.md");
  const [url, init] = (globalThis.fetch as any).mock.calls[0];
  expect(url).toBe("/api/projects/p1/docs/internal/docs/x.md");
  expect(init.method).toBe("DELETE");
});
```

- [x] **Step 2: Run, verify fail**

Run: `pnpm exec vitest run src/test/client.test.ts`
Expected: FAIL — `api.deleteDoc is not a function`.

- [x] **Step 3: Implement** — in `src/src/api/client.ts`, add after `putDoc`:

```ts
  deleteDoc: (id: string, path: string) => j<void>(paths.docFile(id, path), { method: "DELETE" }),
```

- [x] **Step 4: Run, verify pass**

Run: `pnpm exec vitest run src/test/client.test.ts`
Expected: PASS.

- [x] **Step 5: Update the frontend doc** (same commit) — in `internal/docs/frontend/frontend-implementation.md`, in the Docs section, note: "Docs workspace can Scan per project and Delete a document (hits the real file via `DELETE /docs/*`)."

- [x] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/test/client.test.ts internal/docs/frontend/frontend-implementation.md
git commit -m "feat(web): api.deleteDoc client wrapper (SPEC-011)"
```

---

### Task 7: Web — per-project Scan + Delete buttons, drop `internal/docs` hardcoding

**Files:**
- Modify: `src/src/screens/DocsWorkspace.tsx`
- Modify: `src/src/App.tsx:425` (Docs shell breadcrumb — drop the fixed `internal/docs` prefix)
- Modify: `internal/docs/frontend/frontend-implementation.md` — **same commit** (freshness guardrail).

**Interfaces:**
- Consumes: `api.getDocs`, `api.getDoc`, `api.putDoc`, `api.deleteDoc`, `api.scanProject`.
- Note: `selected` is now the **full repo-relative path** (`cat + "/" + file` round-trips to it). Delete the old `displayPath = "internal/docs/" + selected` logic.

- [x] **Step 1: Add Scan + Delete handlers** — in `DocsWorkspace.tsx`, inside the component (after `save()`), add:

```tsx
  const [scanning, setScanning] = React.useState(false);
  async function reloadIndex() {
    const ix = await api.getDocs(projectId);
    const t = ix.tree as DocCat[];
    setTree(t); setCoverage(ix.coverage);
    if (!t.some((n) => `${n.cat}/${n.files[0]}` === selected)) {
      const first = t.find((n) => n.linked) || t[0];
      setSelected(first ? `${first.cat}/${first.files[0]}` : "");
    }
  }
  async function rescan() {
    if (scanning) return;
    setScanning(true);
    try { await api.scanProject(projectId); await reloadIndex(); } finally { setScanning(false); }
  }
  async function removeDoc() {
    if (!selected || !window.confirm(`Hapus ${selected}? File aslinya di disk akan dihapus.`)) return;
    await api.deleteDoc(projectId, selected);
    setCache((c) => { const n = { ...c }; delete n[selected]; return n; });
    await reloadIndex();
  }
```

- [x] **Step 2: Fix the display path** — replace line ~105:

```tsx
  const displayPath = selected;
```

(delete the `node && node.root ? relPath : "internal/docs/" + selected` expression and the now-unused `relPath` line).

- [x] **Step 3: Add the Scan button to the sidebar header** — replace the sidebar card header (`<span className="hn-eyebrow">internal/docs</span>` block, ~line 124):

```tsx
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="hn-eyebrow">docs · {projectName}</span>
            <Button size="sm" variant="ghost" leftIcon={scanning ? "loader" : "radar"} onClick={rescan} disabled={scanning}>
              {scanning ? "…" : "Scan"}
            </Button>
          </div>
```

- [x] **Step 4: Add the Delete button** — in the editor header, next to Edit (preview mode branch, ~line 148):

```tsx
          {mode === "preview" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={removeDoc} disabled={!selected}>Hapus</Button>
              <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit} disabled={!selected}>Edit</Button>
            </div>
          ) : (
```

- [x] **Step 5: Drop the fixed breadcrumb prefix** — in `src/src/App.tsx` line ~425, change the Docs `Shell` breadcrumb:

```tsx
      <Shell active="docs" title="Source of Truth" breadcrumb={proj ? proj.name : "workspace"}
```

- [x] **Step 6: Update the frontend doc** (same commit) — in `internal/docs/frontend/frontend-implementation.md`, Docs section: "Docs = realtime tree of every `.md` in the repo (via `GET /docs`), grouped by directory; per-project **Scan** refreshes coverage, **Hapus** deletes the real file, paths shown repo-relative (no fixed `internal/docs` prefix)."

- [x] **Step 7: Verify web suite + typecheck**

Run: `pnpm exec vitest run src/test && pnpm -r typecheck`
Expected: PASS, no type errors.

- [x] **Step 8: Commit**

```bash
git add src/src/screens/DocsWorkspace.tsx src/src/App.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(web): per-project Scan + Delete in Docs workspace; repo-relative paths (SPEC-011)"
```

---

### Task 8: Real end-to-end smoke (per CLAUDE.md)

**Files:** none (verification only).

- [x] **Step 1: Boot the server** (port `8787`)

Postgres/Redis up first (`docker compose up -d`), then run: `pnpm dev:api` (or `node server/dist/server.js` after `pnpm build`). Ensure a project with a real `repoDir` exists (create via UI or `POST /api/projects`).

> ⚠️ Per memory: a live dev worker + shared Redis means `POST /runs` would fire a REAL background run. Docs endpoints below don't enqueue runs, so they're safe — just don't trigger runs during the smoke.

- [x] **Step 2: Exercise the live docs API**

```bash
PID=<projectId>
curl -s localhost:8787/api/projects/$PID/docs | head -c 400          # tree + coverage from disk
curl -s localhost:8787/api/projects/$PID/docs/internal/docs/README.md | head -c 200
curl -s -XPUT localhost:8787/api/projects/$PID/docs/internal/docs/README.md \
  -H 'content-type: application/json' -d '{"content":"# edited by smoke\n"}'
git -C <repoDir> diff --stat internal/docs/README.md                  # the REAL file changed
curl -s -XPOST localhost:8787/api/projects/$PID/scan | head -c 200    # coverage recomputed
```

- [x] **Step 3: Confirm + restore** — verify the working tree of `<repoDir>` actually changed (proves realtime, not DB), then `git -C <repoDir> checkout internal/docs/README.md` to undo the smoke edit.

- [x] **Step 4: Full test sweep**

Run: `pnpm test` (root: `vitest run --no-file-parallelism` across shared/server/src).
Expected: all packages green.

---

## Notes for the implementer

- Run tasks in order — Task 3 imports Task 2, Task 4 imports Task 3, Task 5 removes the model only after nothing references it.
- `git ls-files --others --exclude-standard` lists untracked-not-ignored files, so `makeTempRepo` needs no commit.
- Package names: server `@hanoman/server`, shared `@hanoman/shared`, web app `@hanoman/app` (dir `src/`), cli `@hanoman/cli`. Tests run from root via one vitest over `["shared","server","src"]` — filter by file path (`pnpm exec vitest run <path>`).
- Server tests hit a real Postgres (`hanoman_test`) and truncate between tests — keep `--no-file-parallelism` when running more than one server file.
- Heads-up: the working tree already carries an unrelated WIP pair (`BacklogScreen.tsx` + `frontend-implementation.md`). Commit or stash it before starting so your task commits stay clean.
