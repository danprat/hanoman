# hanoman CLI + docs-as-SoT guardrail (SPEC-002) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dependency-light `hanoman` CLI and the deterministic docs-as-Source-of-Truth guardrail (`docs verify` + index hygiene commands + a Stop-hook adapter), replacing the partial Python hook with a single source of guardrail truth.

**Architecture:** A new `cli/` workspace package (bin `hanoman`) built on Node's `util.parseArgs` — no CLI framework. It is a filesystem + git tool: it reads a repo's real `internal/docs/**` and the index `internal/docs/README.md`, checks link integrity / freshness / coverage, and exits non-zero (or emits a Stop-hook block decision) when the guardrail is violated. Pure doc-coverage math (`coverageOf`) is shared with SPEC-001's server. No DB, no server, no LLM.

**Tech Stack:** Node 20+ (`util.parseArgs`, `node:child_process`, `node:fs`), TypeScript 5 (strict), zod (config schema), Vitest.

## Global Constraints

- **Source of Truth:** `internal/docs/**`; the guardrail enforces ADR-0001 (block plan→execute when referenced docs stale/unlinked). (AGENTS.md, ADR-0001)
- **TypeScript strict.** (CLAUDE.md)
- **Single source of guardrail truth:** all block logic lives in the CLI; the Stop hook delegates to `hanoman hook stop`. `ensure-docs-updated.py` is deleted. (SPEC-002 design)
- **Freshness signal reused verbatim** from `ensure-docs-updated.py`: `src/` changed with no doc change, where doc prefixes = `internal/docs/`, `internal/skills/`, `AGENTS.md`, `CLAUDE.md`, `README.md`. Impl prefix = `src/` only.
- **No new dependencies** beyond zod (already in `shared/`). CLI router is hand-rolled.
- **Config defaults:** `docsDir=internal/docs`, `requireLinks=true`, `blockStale=true`, `coverageThreshold=100`. Flags override config; config overrides defaults.
- **Copy** for reasons is mixed-language, matching the existing hook.
- **Every touched `internal/docs` doc** updated + linked in `internal/docs/README.md` in the same change. (AGENTS.md)
- **Depends on SPEC-001** being merged (workspace, `shared/`, `coverageOf`). Commit after every green step.

---

## File Structure

```
cli/
  package.json            bin "hanoman" -> dist/hanoman.js; deps @hanoman/shared
  tsconfig.json
  src/
    hanoman.ts            #!/usr/bin/env node entry: builds Ctx, calls run(), exits
    router.ts             run(argv, ctx): dispatch to commands; --help/--version
    config.ts             loadConfig(repoRoot): merge hanoman.config.json + defaults
    repo.ts               resolveRepo(cwd): { root, docsDir, indexPath }
    docs-model.ts         parseIndex, walkDocs, catStatus
    git.ts                changedPaths(root) — port of the Python freshness signal
    verify.ts             collectViolations(repo, cfg), formatText, formatJson
    commands/
      docs-verify.ts
      docs-scan.ts
      docs-index.ts       --check / --fix
      docs-link.ts
      hook-stop.ts
  test/
    _fixture.ts           makeRepo() temp-dir helper (git init + docs tree)
    *.test.ts

shared/src/coverage.ts    MOVED here from server (pure coverageOf/docStatusFor)
shared/src/config.ts      zHanomanConfig
shared/src/index.ts       re-export coverage + config
server/src/services/coverage.ts   becomes a re-export from @hanoman/shared

.claude/settings.json     Stop hook -> `node cli/dist/hanoman.js hook stop`
.claude/hooks/ensure-docs-updated.py   DELETED
internal/docs/operations/agent-documentation-workflow.md   note the CLI is the guardrail
```

Each command file owns one command; shared logic (`docs-model`, `git`, `verify`) is separate and unit-tested directly.

---

### Task 1: `cli/` scaffold + move `coverageOf` to shared + config

**Files:**
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/src/hanoman.ts`, `cli/src/router.ts`, `cli/src/config.ts`, `cli/src/repo.ts`
- Create: `shared/src/coverage.ts`, `shared/src/config.ts`
- Modify: `shared/src/index.ts` (re-export), `server/src/services/coverage.ts` (re-export from shared), `pnpm-workspace.yaml` (add `cli`)
- Test: `cli/test/config.test.ts`, `shared/test/coverage.test.ts`

**Interfaces:**
- Produces:
  - `zHanomanConfig` / `type HanomanConfig` (shared) with the four fields + defaults.
  - `coverageOf`, `docStatusFor` (shared), unchanged signatures from SPEC-001.
  - `loadConfig(repoRoot: string): HanomanConfig` (cli) — reads `hanoman.config.json` if present, else defaults.
  - `resolveRepo(cwd: string): { root: string; docsDir: string; indexPath: string }` (cli).
  - `run(argv: string[], ctx: Ctx): Promise<number>` (cli) with `--version`/`--help` handled; unknown command → prints help, returns 1.
  - `interface Ctx { cwd: string; env: Record<string,string|undefined>; stdout(s:string):void; stderr(s:string):void; readStdin?():Promise<string>; }`

- [x] **Step 1: Write failing tests**

```ts
// shared/test/coverage.test.ts  (moved — same assertions as SPEC-001)
import { describe, it, expect } from "vitest";
import { coverageOf, docStatusFor } from "../src/index";
describe("coverage (shared)", () => {
  it("half linked -> 50", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"b",linked:false}])).toBe(50));
  it("status thresholds", () => {
    expect(docStatusFor(94)).toBe("ok"); expect(docStatusFor(75)).toBe("drift"); expect(docStatusFor(38)).toBe("broken"); });
});
```

```ts
// cli/test/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";
import { makeRepo } from "./_fixture";
describe("config", () => {
  it("returns defaults when no config file", async () => {
    const { root } = await makeRepo({});
    expect(loadConfig(root)).toEqual({ docsDir: "internal/docs", requireLinks: true, blockStale: true, coverageThreshold: 100 });
  });
  it("merges overrides from hanoman.config.json", async () => {
    const { root } = await makeRepo({ files: { "hanoman.config.json": JSON.stringify({ coverageThreshold: 80 }) } });
    expect(loadConfig(root).coverageThreshold).toBe(80);
  });
});
```

(`makeRepo` is created in Task 2's `_fixture.ts`; for Task 1 add a minimal inline version in `_fixture.ts` now — see Step 3.)

- [x] **Step 2: Run, verify fail** — `pnpm --filter ./cli test config` → FAIL (module missing).

- [x] **Step 3: Implement**

`pnpm-workspace.yaml` → add `"cli"` to packages.

`cli/package.json`:
```json
{
  "name": "@hanoman/cli", "type": "module", "version": "0.0.0",
  "bin": { "hanoman": "dist/hanoman.js" },
  "scripts": { "build": "tsc", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@hanoman/shared": "workspace:*", "zod": "^3.23.0" },
  "devDependencies": { "vitest": "^2.0.0", "tsx": "^4.16.0", "typescript": "^5.5.0" }
}
```

`cli/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "include": ["src","test"], "compilerOptions": { "outDir": "dist", "module": "NodeNext", "moduleResolution": "NodeNext" } }`

`shared/src/coverage.ts` — move the two functions from `server/src/services/coverage.ts` verbatim:
```ts
export function coverageOf(docs: { category: string; linked: boolean }[]): number {
  const byCat = new Map<string, boolean>();
  for (const d of docs) byCat.set(d.category, (byCat.get(d.category) ?? true) && d.linked);
  if (byCat.size === 0) return 0;
  const linked = [...byCat.values()].filter(Boolean).length;
  return Math.round((linked / byCat.size) * 100);
}
export function docStatusFor(pct: number): "ok" | "drift" | "broken" {
  return pct >= 90 ? "ok" : pct >= 60 ? "drift" : "broken";
}
```

`shared/src/config.ts`:
```ts
import { z } from "zod";
export const zHanomanConfig = z.object({
  docsDir: z.string().default("internal/docs"),
  requireLinks: z.boolean().default(true),
  blockStale: z.boolean().default(true),
  coverageThreshold: z.number().int().min(0).max(100).default(100),
});
export type HanomanConfig = z.infer<typeof zHanomanConfig>;
```

`shared/src/index.ts` — add `export * from "./coverage";` and `export * from "./config";`.

`server/src/services/coverage.ts` — replace body with:
```ts
export { coverageOf, docStatusFor } from "@hanoman/shared";
```

`cli/src/config.ts`:
```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zHanomanConfig, type HanomanConfig } from "@hanoman/shared";
export function loadConfig(repoRoot: string): HanomanConfig {
  const p = join(repoRoot, "hanoman.config.json");
  const raw = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  return zHanomanConfig.parse(raw);
}
```

`cli/src/repo.ts`:
```ts
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadConfig } from "./config";
export function resolveRepo(cwd: string) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  const root = r.status === 0 ? r.stdout.trim() : cwd;
  const { docsDir } = loadConfig(root);
  return { root, docsDir, indexPath: join(root, docsDir, "README.md") };
}
```

`cli/src/router.ts`:
```ts
export interface Ctx {
  cwd: string; env: Record<string, string | undefined>;
  stdout(s: string): void; stderr(s: string): void; readStdin?(): Promise<string>;
}
const VERSION = "0.2.0";
const HELP = `hanoman <command>

  docs verify [--block-if-stale] [--json]   run the SoT guardrail
  docs scan [--json]                        coverage + per-category report
  docs index --check | --fix                index integrity
  docs link <path> [--category c]           add a doc to the index
  hook stop                                 Claude Code Stop-hook adapter
  --version | --help`;
export async function run(argv: string[], ctx: Ctx): Promise<number> {
  if (argv.includes("--version")) { ctx.stdout(VERSION + "\n"); return 0; }
  if (argv.length === 0 || argv.includes("--help")) { ctx.stdout(HELP + "\n"); return 0; }
  const [group, sub, ...rest] = argv;
  // command imports wired in later tasks:
  if (group === "docs" && sub === "verify") return (await import("./commands/docs-verify")).default(rest, ctx);
  if (group === "docs" && sub === "scan")   return (await import("./commands/docs-scan")).default(rest, ctx);
  if (group === "docs" && sub === "index")  return (await import("./commands/docs-index")).default(rest, ctx);
  if (group === "docs" && sub === "link")   return (await import("./commands/docs-link")).default(rest, ctx);
  if (group === "hook" && sub === "stop")   return (await import("./commands/hook-stop")).default(rest, ctx);
  ctx.stderr(`unknown command: ${argv.join(" ")}\n\n${HELP}\n`);
  return 1;
}
```
(The dynamic imports let earlier tasks compile before the command files exist — create empty `export default async () => 0;` stubs for the five command files now so `router.ts` type-checks; each is filled in its task.)

`cli/src/hanoman.ts`:
```ts
#!/usr/bin/env node
import { run } from "./router";
const readStdin = () => new Promise<string>((res) => {
  let d = ""; process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => res(d));
  if (process.stdin.isTTY) res("");
});
run(process.argv.slice(2), {
  cwd: process.cwd(), env: process.env,
  stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), readStdin,
}).then((code) => process.exit(code));
```

- [x] **Step 4: Run, verify pass** — `pnpm --filter ./shared test coverage && pnpm --filter ./cli test config && pnpm -r typecheck` → PASS.
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): scaffold + shared coverage/config"`

---

### Task 2: Docs model (index parse, file walk, category status)

**Files:**
- Create: `cli/src/docs-model.ts`, `cli/test/_fixture.ts` (full version), `cli/test/docs-model.test.ts`

**Interfaces:**
- Consumes: `resolveRepo`, `coverageOf`.
- Produces:
  - `parseIndex(indexPath: string): Set<string>` — posix relative doc paths linked from the index (relative to `docsDir`), excluding external/URL/anchor links.
  - `walkDocs(docsRoot: string): string[]` — posix relative file paths under `docsDir`, excluding `README.md` and dotfiles (`.DS_Store` etc.).
  - `catStatus(files: string[], linked: Set<string>): { category: string; linked: boolean; files: string[]; unlinkedFiles: string[] }[]` — grouped by first path segment.
  - `makeRepo(opts: { files?: Record<string,string>; docs?: Record<string,string>; index?: string; git?: boolean }): Promise<{ root: string }>` (fixture) — creates a temp dir, optional `git init`, writes `internal/docs/<path>` for each `docs` entry, an index `internal/docs/README.md`, and arbitrary `files`.

- [x] **Step 1: Write failing tests**

```ts
// cli/test/docs-model.test.ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseIndex, walkDocs, catStatus } from "../src/docs-model";
import { makeRepo } from "./_fixture";
describe("docs model", () => {
  it("parses linked relative paths from the index", async () => {
    const { root } = await makeRepo({
      index: "# index\n- [stack](architecture/stack.md)\n- [prd](requirements/prd.md)\n- [site](https://x.io)\n",
      docs: { "architecture/stack.md": "# stack", "requirements/prd.md": "# prd" } });
    const linked = parseIndex(join(root, "internal/docs/README.md"));
    expect(linked.has("architecture/stack.md")).toBe(true);
    expect([...linked].some((p) => p.startsWith("http"))).toBe(false);
  });
  it("walks docs excluding README and dotfiles", async () => {
    const { root } = await makeRepo({ index: "# i\n",
      docs: { "architecture/stack.md": "x", "product/blueprint.md": "y" } });
    const files = walkDocs(join(root, "internal/docs"));
    expect(files.sort()).toEqual(["architecture/stack.md", "product/blueprint.md"]);
    expect(files).not.toContain("README.md");
  });
  it("marks a category unlinked when a file is missing from the index", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    const files = walkDocs(join(root, "internal/docs"));
    const cats = catStatus(files, parseIndex(join(root, "internal/docs/README.md")));
    const arch = cats.find((c) => c.category === "architecture")!;
    expect(arch.linked).toBe(false); expect(arch.unlinkedFiles).toEqual(["architecture/nfr.md"]);
  });
});
```

- [x] **Step 2: Run, verify fail.**

- [x] **Step 3: Implement**

`cli/test/_fixture.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
export async function makeRepo(opts: {
  files?: Record<string, string>; docs?: Record<string, string>; index?: string; git?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "hanoman-"));
  const write = (rel: string, content: string) => {
    const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
  };
  write("internal/docs/README.md", opts.index ?? "# index\n");
  for (const [p, c] of Object.entries(opts.docs ?? {})) write(join("internal/docs", p), c);
  for (const [p, c] of Object.entries(opts.files ?? {})) write(p, c);
  if (opts.git !== false) {
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["config", "user.email", "t@t"], { cwd: root });
    spawnSync("git", ["config", "user.name", "t"], { cwd: root });
  }
  return { root };
}
```

`cli/src/docs-model.ts`:
```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const LINK_RE = /\]\(([^)]+)\)/g;
export function parseIndex(indexPath: string): Set<string> {
  const md = readFileSync(indexPath, "utf8");
  const out = new Set<string>();
  for (const m of md.matchAll(LINK_RE)) {
    let t = m[1]!.trim();
    if (!t || t.startsWith("http://") || t.startsWith("https://") || t.startsWith("#") || t.startsWith("mailto:")) continue;
    t = t.split("#")[0]!.replace(/^\.\//, "");
    out.add(t.split("\\").join("/"));
  }
  return out;
}
export function walkDocs(docsRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name !== "README.md") out.push(relative(docsRoot, abs).split("\\").join("/"));
    }
  };
  walk(docsRoot);
  return out;
}
export function catStatus(files: string[], linked: Set<string>) {
  const by = new Map<string, { category: string; linked: boolean; files: string[]; unlinkedFiles: string[] }>();
  for (const f of files) {
    const category = f.split("/")[0]!;
    const c = by.get(category) ?? { category, linked: true, files: [], unlinkedFiles: [] };
    c.files.push(f);
    if (!linked.has(f)) { c.linked = false; c.unlinkedFiles.push(f); }
    by.set(category, c);
  }
  return [...by.values()];
}
```

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): filesystem docs model + fixtures"`

---

### Task 3: Git freshness signal

**Files:** Create `cli/src/git.ts`, `cli/test/git.test.ts`

**Interfaces:**
- Produces:
  - `changedPaths(root: string): string[]` — `git status --short --untracked-files=all` normalized to plain repo-relative paths (handles rename `->`), `[]` if not a git repo.
  - `freshnessViolation(paths: string[]): boolean` — true iff any path startsWith `src/` and none startsWith a doc prefix. Doc prefixes exactly: `internal/docs/`, `internal/skills/`, `AGENTS.md`, `CLAUDE.md`, `README.md`.

- [x] **Step 1: Write failing tests**

```ts
// cli/test/git.test.ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { changedPaths, freshnessViolation } from "../src/git";
import { makeRepo } from "./_fixture";
const add = (root: string, rel: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), "x");
};
describe("git freshness", () => {
  it("lists changed paths", async () => {
    const { root } = await makeRepo({}); add(root, "src/a.ts");
    expect(changedPaths(root)).toContain("src/a.ts");
  });
  it("flags src change without docs", () =>
    expect(freshnessViolation(["src/a.ts", "src/b.ts"])).toBe(true));
  it("clears when a doc also changed", () =>
    expect(freshnessViolation(["src/a.ts", "internal/docs/architecture/stack.md"])).toBe(false));
  it("no src change -> no violation", () =>
    expect(freshnessViolation(["README.md"])).toBe(false));
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// cli/src/git.ts
import { spawnSync } from "node:child_process";
const DOC_PREFIXES = ["internal/docs/", "internal/skills/", "AGENTS.md", "CLAUDE.md", "README.md"];
const IMPL_PREFIXES = ["src/"];
export function changedPaths(root: string): string[] {
  const r = spawnSync("git", ["status", "--short", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    let p = line.length > 3 ? line.slice(3) : line;
    if (p.includes(" -> ")) p = p.split(" -> ")[1]!;
    return p;
  });
}
export function freshnessViolation(paths: string[]): boolean {
  const impl = paths.some((p) => IMPL_PREFIXES.some((x) => p.startsWith(x)));
  const docs = paths.some((p) => DOC_PREFIXES.some((x) => p.startsWith(x)));
  return impl && !docs;
}
```

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): git freshness signal (ported from python hook)"`

---

### Task 4: Verify core (collect violations + formatting)

**Files:** Create `cli/src/verify.ts`, `cli/test/verify.test.ts`

**Interfaces:**
- Consumes: `resolveRepo`, `loadConfig`, `parseIndex`, `walkDocs`, `catStatus`, `coverageOf`, `changedPaths`, `freshnessViolation`.
- Produces:
  - `type Violation = { kind: "unlinked" | "freshness" | "coverage"; reason: string }`
  - `collectViolations(root: string): { coverage: number; cats: ReturnType<typeof catStatus>; violations: Violation[] }` — applies config flags.
  - `formatText(result): string`, `formatJson(result): string`.

- [x] **Step 1: Write failing tests**

```ts
// cli/test/verify.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { collectViolations } from "../src/verify";
import { makeRepo } from "./_fixture";
describe("collectViolations", () => {
  it("clean repo -> no violations", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    expect(collectViolations(root).violations).toEqual([]);
  });
  it("unlinked doc -> unlinked violation", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    const v = collectViolations(root).violations;
    expect(v.some((x) => x.kind === "unlinked" && x.reason.includes("architecture/nfr.md"))).toBe(true);
  });
  it("src change without docs -> freshness violation", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    mkdirSync(join(root, "src"), { recursive: true }); writeFileSync(join(root, "src/a.ts"), "z");
    expect(collectViolations(root).violations.some((x) => x.kind === "freshness")).toBe(true);
  });
  it("coverage below threshold -> coverage violation", async () => {
    const { root } = await makeRepo({
      files: { "hanoman.config.json": JSON.stringify({ requireLinks: false, coverageThreshold: 100 }) },
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "product/blueprint.md": "y" } }); // product unlinked -> 50%
    expect(collectViolations(root).violations.some((x) => x.kind === "coverage")).toBe(true);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// cli/src/verify.ts
import { join } from "node:path";
import { coverageOf } from "@hanoman/shared";
import { resolveRepo } from "./repo";
import { loadConfig } from "./config";
import { parseIndex, walkDocs, catStatus } from "./docs-model";
import { changedPaths, freshnessViolation } from "./git";
export type Violation = { kind: "unlinked" | "freshness" | "coverage"; reason: string };
export function collectViolations(root: string) {
  const { docsDir, indexPath } = resolveRepo(root);
  const cfg = loadConfig(root);
  const files = walkDocs(join(root, docsDir));
  const linked = parseIndex(indexPath);
  const cats = catStatus(files, linked);
  const coverage = coverageOf(files.map((f) => ({ category: f.split("/")[0]!, linked: linked.has(f) })));
  const violations: Violation[] = [];
  if (cfg.requireLinks) {
    const unlinked = cats.flatMap((c) => c.unlinkedFiles);
    if (unlinked.length) violations.push({ kind: "unlinked", reason: `Doc belum ter-link di index: ${unlinked.join(", ")}` });
  }
  if (cfg.blockStale && freshnessViolation(changedPaths(root)))
    violations.push({ kind: "freshness", reason: "Ada perubahan di src/ tanpa perubahan dokumentasi. Update doc terkait di internal/docs/**." });
  if (cfg.coverageThreshold > 0 && coverage < cfg.coverageThreshold)
    violations.push({ kind: "coverage", reason: `Coverage ${coverage}% di bawah ambang ${cfg.coverageThreshold}%.` });
  return { coverage, cats, violations };
}
export function formatText(r: ReturnType<typeof collectViolations>): string {
  if (!r.violations.length) return `Source of Truth clean · coverage ${r.coverage}%`;
  return `Plan blocked — Source of Truth:\n` + r.violations.map((v) => `  ✗ ${v.reason}`).join("\n");
}
export function formatJson(r: ReturnType<typeof collectViolations>): string {
  return JSON.stringify({ ok: r.violations.length === 0, coverage: r.coverage, violations: r.violations });
}
```

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): verify core (link/freshness/coverage)"`

---

### Task 5: `docs verify` command + wire router entry

**Files:** Create `cli/src/commands/docs-verify.ts` (replace stub); Test `cli/test/docs-verify.cmd.test.ts`

**Interfaces:**
- Consumes: `collectViolations`, `formatText`, `formatJson`, `Ctx`.
- Produces: `default(args: string[], ctx: Ctx): Promise<number>` — flags `--block-if-stale`, `--json`. Prints report. Returns `1` only when `--block-if-stale` and violations exist; else `0`.

- [ ] **Step 1: Write failing tests**

```ts
// cli/test/docs-verify.cmd.test.ts
import { describe, it, expect } from "vitest";
import { run } from "../src/router";
import { makeRepo } from "./_fixture";
const cap = () => { const o: string[] = []; return { out: o, ctx: (root: string) => ({ cwd: root, env: {}, stdout: (s: string) => o.push(s), stderr: (s: string) => o.push(s) }) }; };
describe("docs verify command", () => {
  it("exit 0 on a clean repo", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    const c = cap();
    expect(await run(["docs", "verify", "--block-if-stale"], c.ctx(root))).toBe(0);
  });
  it("exit 1 when blocking on unlinked", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    const c = cap();
    expect(await run(["docs", "verify", "--block-if-stale"], c.ctx(root))).toBe(1);
    expect(c.out.join("")).toContain("nfr.md");
  });
  it("without --block-if-stale reports but exits 0", async () => {
    const { root } = await makeRepo({ index: "\n", docs: { "architecture/nfr.md": "y" } });
    const c = cap();
    expect(await run(["docs", "verify"], c.ctx(root))).toBe(0);
  });
  it("--json emits structured result", async () => {
    const { root } = await makeRepo({ index: "\n", docs: { "architecture/nfr.md": "y" } });
    const c = cap();
    await run(["docs", "verify", "--json"], c.ctx(root));
    expect(JSON.parse(c.out.join("")).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail** (stub returns 0, assertions on output fail).
- [ ] **Step 3: Implement**

```ts
// cli/src/commands/docs-verify.ts
import { parseArgs } from "node:util";
import type { Ctx } from "../router";
import { collectViolations, formatText, formatJson } from "../verify";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({ args, options: {
    "block-if-stale": { type: "boolean" }, json: { type: "boolean" } }, allowPositionals: true });
  const result = collectViolations(ctx.cwd);
  ctx.stdout((values.json ? formatJson(result) : formatText(result)) + "\n");
  return values["block-if-stale"] && result.violations.length ? 1 : 0;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): docs verify command"`

---

### Task 6: `docs scan` command

**Files:** Create `cli/src/commands/docs-scan.ts` (replace stub); Test `cli/test/docs-scan.cmd.test.ts`

**Interfaces:**
- Produces: `default(args, ctx)` — flag `--json`. Prints coverage + per-category linked/unlinked. Always returns 0.

- [ ] **Step 1: Failing test**

```ts
// cli/test/docs-scan.cmd.test.ts
import { describe, it, expect } from "vitest";
import { run } from "../src/router";
import { makeRepo } from "./_fixture";
describe("docs scan", () => {
  it("reports coverage + categories as json", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "product/blueprint.md": "y" } });
    const out: string[] = [];
    const code = await run(["docs", "scan", "--json"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {} });
    const j = JSON.parse(out.join(""));
    expect(code).toBe(0); expect(typeof j.coverage).toBe("number");
    expect(j.categories.find((c: any) => c.category === "product").linked).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
// cli/src/commands/docs-scan.ts
import { parseArgs } from "node:util";
import type { Ctx } from "../router";
import { collectViolations } from "../verify";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, allowPositionals: true });
  const r = collectViolations(ctx.cwd);
  const categories = r.cats.map((c) => ({ category: c.category, linked: c.linked, unlinked: c.unlinkedFiles }));
  if (values.json) ctx.stdout(JSON.stringify({ coverage: r.coverage, categories }) + "\n");
  else ctx.stdout(`coverage ${r.coverage}%\n` + categories.map((c) => `  ${c.linked ? "✓" : "✗"} ${c.category}${c.unlinked.length ? ` (${c.unlinked.join(", ")})` : ""}`).join("\n") + "\n");
  return 0;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): docs scan command"`

---

### Task 7: `docs index --check|--fix` + `docs link`

**Files:** Create `cli/src/commands/docs-index.ts`, `cli/src/commands/docs-link.ts` (replace stubs), `cli/src/index-edit.ts`; Test `cli/test/index-link.cmd.test.ts`

**Interfaces:**
- Produces:
  - `index-edit.ts`: `addLink(indexPath: string, relPath: string, category: string): void` — append `- [<basename>](<relPath>)` under a `## <category>` heading (create the heading if absent), idempotent (no-op if already linked).
  - `docs-index.ts`: `default(args, ctx)` — `--check` returns 1 if any unlinked doc OR any index link doesn't resolve to a file; `--fix` calls `addLink` for every unlinked doc, returns 0.
  - `docs-link.ts`: `default(args, ctx)` — positional `<path>`, `--category` (defaults to first path segment); calls `addLink`; returns 0.

- [ ] **Step 1: Failing tests**

```ts
// cli/test/index-link.cmd.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/router";
import { makeRepo } from "./_fixture";
const io = (root: string, out: string[] = []) => ({ out, ctx: { cwd: root, env: {}, stdout: (s: string) => out.push(s), stderr: (s: string) => out.push(s) } });
describe("index + link", () => {
  it("--check fails on an unlinked doc, --fix then passes", async () => {
    const { root } = await makeRepo({ index: "# index\n\n## architecture\n- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    expect(await run(["docs", "index", "--check"], io(root).ctx)).toBe(1);
    expect(await run(["docs", "index", "--fix"], io(root).ctx)).toBe(0);
    expect(readFileSync(join(root, "internal/docs/README.md"), "utf8")).toContain("architecture/nfr.md");
    expect(await run(["docs", "index", "--check"], io(root).ctx)).toBe(0);
  });
  it("docs link adds a single doc under its category", async () => {
    const { root } = await makeRepo({ index: "# index\n", docs: { "security/security-standard.md": "x" } });
    expect(await run(["docs", "link", "security/security-standard.md"], io(root).ctx)).toBe(0);
    expect(readFileSync(join(root, "internal/docs/README.md"), "utf8")).toContain("security/security-standard.md");
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
// cli/src/index-edit.ts
import { readFileSync, writeFileSync } from "node:fs";
export function addLink(indexPath: string, relPath: string, category: string): void {
  let md = readFileSync(indexPath, "utf8");
  if (md.includes(`(${relPath})`)) return;
  const base = relPath.split("/").pop()!.replace(/\.md$/, "");
  const line = `- [${base}](${relPath})`;
  const head = `## ${category}`;
  if (md.includes(head)) {
    const i = md.indexOf(head) + head.length;
    const nl = md.indexOf("\n", i);
    md = md.slice(0, nl + 1) + line + "\n" + md.slice(nl + 1);
  } else {
    md = md.replace(/\n*$/, "\n") + `\n${head}\n${line}\n`;
  }
  writeFileSync(indexPath, md);
}
```

```ts
// cli/src/commands/docs-index.ts
import { parseArgs } from "node:util";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Ctx } from "../router";
import { resolveRepo } from "../repo";
import { parseIndex, walkDocs, catStatus } from "../docs-model";
import { addLink } from "../index-edit";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({ args, options: { check: { type: "boolean" }, fix: { type: "boolean" } }, allowPositionals: true });
  const { root, docsDir, indexPath } = resolveRepo(ctx.cwd);
  const files = walkDocs(join(root, docsDir));
  const linked = parseIndex(indexPath);
  const unlinked = files.filter((f) => !linked.has(f));
  const dangling = [...linked].filter((p) => !existsSync(join(root, docsDir, p)));
  if (values.fix) {
    for (const f of unlinked) addLink(indexPath, f, f.split("/")[0]!);
    ctx.stdout(`linked ${unlinked.length} doc(s)\n`); return 0;
  }
  if (unlinked.length || dangling.length) {
    ctx.stderr(`index issues — unlinked: ${unlinked.join(", ") || "none"}; dangling: ${dangling.join(", ") || "none"}\n`);
    return 1;
  }
  ctx.stdout("index ok\n"); return 0;
}
```

```ts
// cli/src/commands/docs-link.ts
import { parseArgs } from "node:util";
import type { Ctx } from "../router";
import { resolveRepo } from "../repo";
import { addLink } from "../index-edit";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values, positionals } = parseArgs({ args, options: { category: { type: "string" } }, allowPositionals: true });
  const rel = positionals[0];
  if (!rel) { ctx.stderr("usage: hanoman docs link <path> [--category c]\n"); return 1; }
  const { indexPath } = resolveRepo(ctx.cwd);
  addLink(indexPath, rel, values.category ?? rel.split("/")[0]!);
  ctx.stdout(`linked ${rel}\n`); return 0;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): docs index --check/--fix + docs link"`

---

### Task 8: `hook stop` adapter + rewire settings + retire Python hook

**Files:**
- Create: `cli/src/commands/hook-stop.ts` (replace stub); Test `cli/test/hook-stop.cmd.test.ts`
- Modify: `.claude/settings.json`
- Delete: `.claude/hooks/ensure-docs-updated.py`
- Modify: `internal/docs/operations/agent-documentation-workflow.md` (note the CLI is the guardrail)

**Interfaces:**
- Consumes: `collectViolations`, `Ctx` (with `readStdin`).
- Produces: `default(args, ctx)` — reads hook payload JSON from `ctx.readStdin()`; if `stop_hook_active === true` prints nothing (allow); else runs `collectViolations` on `payload.cwd ?? env.CLAUDE_PROJECT_DIR ?? ctx.cwd`; if violations, prints `{"decision":"block","reason":…}`. Always returns 0.

- [ ] **Step 1: Failing tests**

```ts
// cli/test/hook-stop.cmd.test.ts
import { describe, it, expect } from "vitest";
import { run } from "../src/router";
import { makeRepo } from "./_fixture";
const runHook = async (root: string, payload: object) => {
  const out: string[] = [];
  await run(["hook", "stop"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {},
    readStdin: async () => JSON.stringify(payload) });
  return out.join("");
};
describe("hook stop", () => {
  it("emits a block decision when the repo is dirty (unlinked doc)", async () => {
    const { root } = await makeRepo({ index: "\n", docs: { "architecture/nfr.md": "y" } });
    const j = JSON.parse(await runHook(root, { cwd: root }));
    expect(j.decision).toBe("block"); expect(j.reason).toContain("nfr.md");
  });
  it("allows (no output) on a clean repo", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    expect(await runHook(root, { cwd: root })).toBe("");
  });
  it("allows when stop_hook_active to avoid loops", async () => {
    const { root } = await makeRepo({ index: "\n", docs: { "architecture/nfr.md": "y" } });
    expect(await runHook(root, { cwd: root, stop_hook_active: true })).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement + rewire**

```ts
// cli/src/commands/hook-stop.ts
import type { Ctx } from "../router";
import { collectViolations, formatText } from "../verify";
export default async function (_args: string[], ctx: Ctx): Promise<number> {
  let payload: { stop_hook_active?: boolean; cwd?: string } = {};
  try { payload = JSON.parse((await ctx.readStdin?.()) ?? "{}"); } catch { /* empty */ }
  if (payload.stop_hook_active === true) return 0;
  const root = payload.cwd ?? ctx.env.CLAUDE_PROJECT_DIR ?? ctx.cwd;
  const result = collectViolations(root);
  if (result.violations.length) ctx.stdout(JSON.stringify({ decision: "block", reason: formatText(result) }));
  return 0;
}
```

`.claude/settings.json`:
```json
{
  "hooks": {
    "Stop": [
      { "hooks": [
        { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/cli/dist/hanoman.js\" hook stop" }
      ] }
    ]
  }
}
```

Delete `.claude/hooks/ensure-docs-updated.py`.

Append to `internal/docs/operations/agent-documentation-workflow.md`:
```markdown

## Guardrail (SPEC-002)
Stop hook memanggil `hanoman hook stop` → `hanoman docs verify`. Blok bila: doc belum
ter-link di index, `src/` berubah tanpa perubahan doc, atau coverage di bawah ambang.
Konfigurasi per-repo di `hanoman.config.json`. Lihat ADR-0001.
```
(No new doc file, so no index link needed; if you add one, link it in `internal/docs/README.md`.)

- [ ] **Step 4: Build + full acceptance**

Run: `pnpm --filter ./cli build && pnpm --filter ./cli test` → all green.
Verify SPEC-002 §Acceptance end-to-end in a scratch repo:
```bash
# 1 + link
node cli/dist/hanoman.js docs verify --block-if-stale ; echo "exit=$?"   # 1 with reasons in a dirty repo
node cli/dist/hanoman.js docs link architecture/nfr.md
node cli/dist/hanoman.js docs verify --block-if-stale ; echo "exit=$?"   # 0
# 4: hook adapter
echo '{"cwd":"'"$PWD"'"}' | node cli/dist/hanoman.js hook stop           # {"decision":"block",...} or empty
# 5: settings + no python
test ! -f .claude/hooks/ensure-docs-updated.py && echo "python hook retired"
# 6: scan
node cli/dist/hanoman.js docs scan --json
```

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): hook stop adapter + retire python hook + wire settings"`

---

## Self-Review

**1. Spec coverage** — every SPEC-002 element maps to a task:
- CLI shell + config + shared coverage move → T1. Docs model → T2. Freshness → T3.
- Guardrail decision (link/freshness/coverage) → T4. `docs verify` → T5. `docs scan` → T6.
- `docs index --check/--fix` + `docs link` → T7. `hook stop` + settings rewire + retire Python + doc update → T8.
- Acceptance criteria 1–3 → T5 + T7 (link) + T4; #4 → T8; #5 → T8; #6 → T6; #7 → touched-doc step in T8.

**2. Placeholder scan** — no "TBD/implement later"; the five command files start as `export default async () => 0;` stubs (named in T1) purely so the router type-checks, each replaced in its own task with complete code — not a placeholder deliverable.

**3. Type consistency** — `Ctx`, `run()`, `collectViolations()` (returns `{coverage,cats,violations}`), `Violation.kind` values (`unlinked|freshness|coverage`), `addLink(indexPath,relPath,category)`, `parseIndex→Set<string>`, `walkDocs→string[]`, `catStatus→{category,linked,files,unlinkedFiles}[]` are defined once and used with the same shapes across tasks. `coverageOf` keeps its SPEC-001 signature after the move to `shared/`.

**Note for the executor:** SPEC-002 depends on SPEC-001 being present (workspace, `shared/`, the `coverageOf` file being moved). If executing SPEC-002 before SPEC-001, first scaffold the pnpm workspace + `shared/` package (Task 1–2 of the SPEC-001 plan).
