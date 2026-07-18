# Project from-scratch → scaffold SoT docs (SPEC-222) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the stubbed `scaffold` flow so a from-scratch project turns an idea into a full `internal/docs/**` Source of Truth, mirroring the existing `reverse`/`prd` flows.

**Architecture:** Scaffold = reverse without the Scan phase, seeded by the idea (`Project.desc`) instead of a codebase, on a repo that hanoman `git init`s at project creation. New git op `initRepo`, new prompt builder `startScaffoldPrompt` (reusing `REVERSE_STANDARD`), a `flow:"scaffold"` route branch, and UI (folder field + "Scaffold docs" button + `autoScaffold` auto-start).

**Tech Stack:** TypeScript (strict), Node + Fastify (server), Vite + React (frontend), Prisma/Postgres, vitest (`vitest run --no-file-parallelism`), zod (`@hanoman/shared`), runner library (`@hanoman/runner`).

## Global Constraints

- No schema change / no migration — the idea is stored in the existing `Project.desc` column.
- TypeScript strict; every orchestration unit (git op, prompt, route) gets a test.
- Update touched `internal/docs/**` in the SAME commit as the code, linked in `internal/docs/README.md`.
- Session flows are project-level for scaffold (no `Spec`); mirror `reverse` (ADR-0026) / `prd` (ADR-0041).
- Branch pushed by the scaffold session: `scaffold-docs`. Worktree: `.worktrees/scaffold-<project>`.
- Run tests with prod env stripped: `env -u NODE_ENV -u DATABASE_URL pnpm test` (or per-package vitest).
- The `internal/docs/**` design of record is already committed (ADR-0052, FRD EARS). This plan only adds
  `api-contract.md` + `data-model.md` edits (behavior mirrors that lands with code).

---

### Task 1: `initRepo` git op (runner)

Makes a from-scratch directory a git repo with a HEAD commit, so `addWorktree(..., "HEAD")` works. Idempotent.

**Files:**
- Modify: `runner/src/types.ts` (add `initRepo` to `GitOps`)
- Modify: `runner/src/git.ts` (implement `realGit.initRepo`)
- Test: `runner/test/git.test.ts`

**Interfaces:**
- Produces: `realGit.initRepo(dir: string): void` — `git init -b main` if `dir` isn't a repo; one
  `--allow-empty` commit (identity `hanoman <hanoman@local>`) if no HEAD; creates `dir` if missing; idempotent.

- [x] **Step 1: Write the failing tests**

Append to `runner/test/git.test.ts` inside the top-level (new `describe`):

```ts
import { mkdtempSync as mkdtemp2 } from "node:fs"; // (already imported as mkdtempSync — reuse it)

describe("git initRepo", () => {
  it("membuat repo dengan satu HEAD commit di direktori kosong", () => {
    const dir = mkdtempSync(join(tmpdir(), "init-"));
    realGit.initRepo(dir);
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(g(dir, "rev-parse", "HEAD").status).toBe(0);          // HEAD resolves
    // repo siap-worktree: addWorktree off HEAD tak throw
    const wt = join(dir, ".worktrees", "scaffold-x");
    expect(() => realGit.addWorktree(dir, wt, "HEAD")).not.toThrow();
    realGit.removeWorktree(dir, wt);
  });

  it("membuat direktori bila belum ada", () => {
    const parent = mkdtempSync(join(tmpdir(), "init-parent-"));
    const dir = join(parent, "nested", "proj");
    realGit.initRepo(dir);
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });

  it("idempoten: repo yang sudah punya commit tak berubah HEAD-nya", () => {
    const { repo } = seedRepo();
    const before = g(repo, "rev-parse", "HEAD").stdout.trim();
    realGit.initRepo(repo);
    expect(g(repo, "rev-parse", "HEAD").stdout.trim()).toBe(before); // no new commit
  });
});
```

(`seedRepo`, `g`, `join`, `tmpdir`, `mkdtempSync`, `existsSync` are already imported/defined in this file.)

- [x] **Step 2: Run tests to verify they fail**

Run: `cd runner && npx vitest run test/git.test.ts -t "initRepo"`
Expected: FAIL — `realGit.initRepo is not a function` / type error.

- [x] **Step 3: Add `initRepo` to the `GitOps` interface**

In `runner/src/types.ts`, inside `interface GitOps`, add after `headSha`:

```ts
  /** Menyiapkan repo siap-worktree untuk project from-scratch: git init + satu commit
   *  bila belum ada HEAD. Idempoten; membuat direktori bila belum ada (SPEC-222). */
  initRepo(dir: string): void;
```

- [x] **Step 4: Implement `realGit.initRepo`**

In `runner/src/git.ts`, update the `node:fs`/`node:path` imports and add the method.

Change line 2 (`import { rmSync } from "node:fs";`) to:
```ts
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
```
Change line 3 (`import { isAbsolute, resolve } from "node:path";`) to:
```ts
import { isAbsolute, resolve, join } from "node:path";
```
(`writeFileSync` is imported for symmetry/possible seed use; `join` is used below.)

Add to the `realGit` object, after `headSha`:
```ts
  // SPEC-222 · project from-scratch lahir tanpa repo; scaffold butuh worktree berbasis HEAD.
  // git init (bila belum repo) + satu commit --allow-empty (bila belum ada HEAD), identitas
  // eksplisit agar tak gagal di mesin tanpa git identity global. Idempoten: repo dengan commit
  // dibiarkan apa adanya.
  initRepo: (dir) => {
    mkdirSync(dir, { recursive: true });
    const isRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8" });
    if (isRepo.status !== 0) git(dir, ["init", "-q", "-b", "main"]);
    const hasHead = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: dir, encoding: "utf8" });
    if (hasHead.status !== 0)
      git(dir, ["-c", "user.email=hanoman@local", "-c", "user.name=hanoman",
        "commit", "-qm", "init: hanoman scaffold", "--allow-empty"]);
  },
```

- [x] **Step 5: Run tests to verify they pass**

Run: `cd runner && npx vitest run test/git.test.ts`
Expected: PASS (all git tests, including the 3 new ones).

- [x] **Step 6: Commit**

```bash
git add runner/src/types.ts runner/src/git.ts runner/test/git.test.ts
git commit -m "feat(runner): initRepo git op — git-init from-scratch repo, worktree-ready (SPEC-222)"
```

---

### Task 2: `startScaffoldPrompt` builder (runner)

The scaffold session prompt: interactive Brainstorm → Objective → Doc index, seeded by the idea, writing the full SoT via `REVERSE_STANDARD`. No Scan, no autonomy clause.

**Files:**
- Modify: `runner/src/prompt.ts` (add `SCAFFOLD_PHASE_GUIDE` + `startScaffoldPrompt`)
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `ProjectBrief` (`{ id, name, desc, stack }`) from `runner/src/types.ts`; `REVERSE_STANDARD`; `PIPELINES.scaffold`.
- Produces: `startScaffoldPrompt(project: ProjectBrief, branchTo: string): string`. Exported via `runner/src/index.ts` `export *`.

- [x] **Step 1: Write the failing tests**

Append to `runner/test/prompt.test.ts`. First add `startScaffoldPrompt` to the import on line 2:
```ts
import { PIPELINES, startPrompt, startProjectPrompt, continuePrompt, startPrdPrompt, startScaffoldPrompt } from "../src/prompt";
```
Then add this describe block at the end of the file:
```ts
// SPEC-222 · sesi scaffold project-level: dari ide → seluruh doc index. Reverse tanpa Scan.
describe("startScaffoldPrompt", () => {
  const project = { id: "kirana", name: "Kirana", desc: "marketplace jasa lokal", stack: "" };

  it("memuat fase Brainstorm → Objective → Doc index berurutan + instruksi phase file", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(PIPELINES.scaffold).toEqual(["Brainstorm", "Objective", "Doc index"]);
    for (const ph of PIPELINES.scaffold) expect(p).toContain(ph);
    expect(p.indexOf("Brainstorm")).toBeLessThan(p.indexOf("Doc index"));
    expect(p).toContain("$HANOMAN_PHASE_FILE");
  });

  it("membawa STANDAR DOCS lengkap (kategori, ADR, EARS, index, hook)", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    for (const t of ["STANDAR DOCS", "internal/docs/", "ADR-NNNN", "Event-driven",
      "ensure-docs-updated.py", "Reading Order"]) expect(p).toContain(t);
  });

  it("brainstorm interaktif satu pertanyaan per giliran, diseed dari ide, dilarang mengarang", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).toContain("SATU pertanyaan");
    expect(p).toContain("Jangan mengarang");
    expect(p).toContain("marketplace jasa lokal"); // ide (desc) ikut menyeed
  });

  it("TANPA fase Scan (bukan reverse) dan TANPA klausa otonomi", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).not.toContain("Scan");
    expect(p).not.toContain("tanpa berhenti di batas antar-fase");
  });

  it("commit+push per fase ke branch scaffold-docs dengan fallback tanpa origin, tanpa 'undefined'", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).toContain("refs/heads/scaffold-docs");
    expect(p).toContain("origin tidak ada");
    expect(p).toContain("Kirana");
    expect(p).not.toContain("undefined");
  });

  it("tanpa klausa penyelesaian plan (tak ada fase Plan+Execute)", () => {
    expect(startScaffoldPrompt(project, "scaffold-docs")).not.toContain("Execute BELUM selesai");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd runner && npx vitest run test/prompt.test.ts -t "startScaffoldPrompt"`
Expected: FAIL — `startScaffoldPrompt is not exported` / not a function.

- [x] **Step 3: Add `SCAFFOLD_PHASE_GUIDE` + `startScaffoldPrompt`**

In `runner/src/prompt.ts`, after the `startPrdPrompt` function (end of file), add:

```ts
// SPEC-222 · panduan per fase scaffold (project-level, from-scratch). Reverse tanpa Scan:
// tak ada kode untuk dipindai, jadi Brainstorm interaktif menggali ide jadi objective, lalu
// Doc index menulis seluruh internal/docs/** dari ide+objective+jawaban. Brainstorm memang
// bergiliran dengan manusia — karena itu SATU pertanyaan per giliran, tanpa AUTONOMY_CLAUSE.
const SCAFFOLD_PHASE_GUIDE = [
  "- Brainstorm: perdalam IDE project (di bawah) jadi masalah, pengguna, scope, dan metrik sukses. "
    + "Ajukan SATU pertanyaan per giliran ke manusia di terminal ini, tunggu jawabannya. Jangan "
    + "mengarang; topik yang belum dijawab tandai sebagai open question.",
  "- Objective: kunci SATU MVP objective yang terukur dari hasil brainstorm, tulis ringkas di docs.",
  "- Doc index: tulis SELURUH internal/docs/** dari ide+objective+jawaban, mengikuti STANDAR DOCS "
    + "di bawah — entrypoints, product, business, requirements (+EARS dari perilaku yang diinginkan), "
    + "research, architecture (stack/data-model/api-contract/nfr), adr awal (Status accepted), "
    + "design-system/frontend bila ada UI, operations, security, plus README index bernomor + "
    + "CLAUDE.md + AGENTS.md + Stop hook. Lengkap dan spesifik terhadap ide ini, BUKAN kerangka.",
].join("\n");

// SPEC-222 · sesi scaffold: dari ide → Source of Truth penuh untuk project from-scratch. Meniru
// startProjectPrompt (reverse) tetapi diseed oleh ide (project.desc), tanpa fase Scan. Tanpa
// AUTONOMY_CLAUSE: Brainstorm interaktif, manusia menjawab di terminal (seperti Wawancara reverse).
export function startScaffoldPrompt(project: ProjectBrief, branchTo: string): string {
  return [
    `hanoman scaffold. Susun Source of Truth LENGKAP untuk project from-scratch ini di internal/docs/** `
      + `DARI IDE-nya, mengikuti STANDAR DOCS di bagian bawah prompt ini. Belum ada kode — docs dulu.`,
    phaseInstruction(PIPELINES.scaffold),
    SCAFFOLD_PHASE_GUIDE,
    `Setiap fase selesai: commit hasilnya, lalu \`git push origin HEAD:refs/heads/${branchTo}\` — `
      + `push per fase, supaya pekerjaan tak hilang bila worktree lenyap. Bila remote origin tidak ada, `
      + `lewati push dan catat itu di laporan akhir — jangan gagal diam-diam. Worktree ini `
      + `detached HEAD — memang disengaja. Manusia yang me-review dan merge branch ${branchTo}.`,
    skillInstruction(PIPELINES.scaffold),
    `Project ${project.id} · ${project.name}\nIde awal: ${project.desc || "—"}\nStack: ${project.stack || "—"}`,
    `=== STANDAR DOCS ===\n${REVERSE_STANDARD}`,
  ].filter(Boolean).join("\n\n");
}
```

Note: `skillInstruction(PIPELINES.scaffold)` maps the `Brainstorm` phase → `superpowers:brainstorming`
(from `PHASE_SKILLS`), matching the phase→skill contract. `phaseInstruction` won't add the plan-gate
clause because scaffold has no `Plan`+`Execute` phases. `REVERSE_STANDARD` is already imported at the
top of this file (line 2).

- [x] **Step 4: Run tests to verify they pass**

Run: `cd runner && npx vitest run test/prompt.test.ts`
Expected: PASS (all prompt tests, incl. the 6 new ones).

- [x] **Step 5: Commit**

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(runner): startScaffoldPrompt — ide → SoT penuh (reverse tanpa Scan) (SPEC-222)"
```

---

### Task 3: `zTerminalSession` scaffold variant (shared)

Lets `POST /terminal/sessions {project, flow:"scaffold"}` validate.

**Files:**
- Modify: `shared/src/dto.ts` (add scaffold member to `zTerminalSession`)
- Test: `shared/test/dto.test.ts`

**Interfaces:**
- Produces: `zTerminalSession` now accepts `{ project: string, flow: "scaffold" }`.

- [x] **Step 1: Write the failing tests**

Append to `shared/test/dto.test.ts` a new describe:
```ts
// SPEC-222 · sesi scaffold project-level (from-scratch), tanpa brief — diseed dari Project.desc.
describe("zTerminalSession — varian scaffold", () => {
  it("menerima sesi scaffold project-level", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "scaffold" }).success).toBe(true);
  });
  it("zFlow memuat scaffold", () => expect(zFlow.safeParse("scaffold").success).toBe(true));
  it("varian reverse & prd tetap valid", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "reverse" }).success).toBe(true);
    expect(zTerminalSession.safeParse({ project: "p1", flow: "prd",
      brief: { title: "x", context: "c", outcome: "o" } }).success).toBe(true);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd shared && npx vitest run test/dto.test.ts -t "varian scaffold"`
Expected: FAIL — `{project, flow:"scaffold"}` currently doesn't match any union member (`success` false).

- [x] **Step 3: Add the scaffold union member**

In `shared/src/dto.ts`, in `zTerminalSession` (the `z.union([...])`), add a member BEFORE the `spec` member:
```ts
  // SPEC-222 · scaffold: sesi project-level from-scratch, menyusun SoT dari ide. Tanpa brief
  // (diseed dari Project.desc), tanpa Spec — cermin reverse.
  z.object({ project: z.string(), flow: z.literal("scaffold") }),
```
So the union reads: reverse-or-plain member, prd member, scaffold member, spec member.

- [x] **Step 4: Run tests to verify they pass**

Run: `cd shared && npx vitest run test/dto.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/dto.ts shared/test/dto.test.ts
git commit -m "feat(shared): zTerminalSession accepts flow:scaffold (SPEC-222)"
```

---

### Task 4: `flow:"scaffold"` route branch (server)

Spawns the project-level scaffold session, mirroring the reverse branch.

**Files:**
- Modify: `server/src/routes/terminal.ts` (import + scaffold branch)
- Modify: `internal/docs/architecture/api-contract.md` (document `flow:"scaffold"`)
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `startScaffoldPrompt` (Task 2), `resolveRepoDir`, `realGit.addWorktree`, `createSession`, `sessionModel`.
- Produces: `POST /terminal/sessions {project, flow:"scaffold"}` → 201 `{id:"scaffold-<project>"}`, worktree `.worktrees/scaffold-<project>`; 422 if no repoDir; second POST re-attaches.

- [x] **Step 1: Write the failing tests**

Append to `server/test/terminal.route.test.ts` a new describe (after the prd describe, ~line 395):
```ts
// SPEC-222: scaffold menyusun Source of Truth dari ide — sesi project-level di worktree-nya.
describe("terminal routes · sesi scaffold", () => {
  const start = (project: string) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project, flow: "scaffold" } });

  it("POST { project, flow: scaffold } membuat worktree + sesi ber-id deterministik", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const res = await start("p1");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("scaffold-p1");
    expect(existsSync(join(repoDir, ".worktrees", "scaffold-p1"))).toBe(true);
    const s = listSessions().find((x) => x.id === "scaffold-p1")!;
    expect(s.flow).toBe("scaffold");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" });
  });

  it("POST kedua menyambung ke sesi yang sama (ADR-0015)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const a = await start("p1");
    const b = await start("p1");
    expect(a.json().id).toBe(b.json().id);
    expect(listSessions().filter((s) => s.id === "scaffold-p1")).toHaveLength(1);
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" });
  });

  it("project tanpa repoDir + flow → 422 (bukan 400)", async () => {
    expect((await start("p2")).statusCode).toBe(422);
  });

  it("GET phases memakai pipeline scaffold", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    appendFileSync(phaseFilePath(repoDir, "scaffold-p1"), "Brainstorm done\n");
    const res = await app.inject({ url: "/api/terminal/sessions/scaffold-p1/phases" });
    expect(res.json().flow).toBe("scaffold");
    expect(res.json().phases[0]).toEqual({ name: "Brainstorm", state: "done" });
    expect(res.json().phases[1]).toEqual({ name: "Objective", state: "active" });
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" });
  });

  it("DELETE membuang worktree sesi scaffold — meski tanpa spec", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" })).statusCode).toBe(204);
    expect(existsSync(join(repoDir, ".worktrees", "scaffold-p1"))).toBe(false);
  });

  it("prompt sesi scaffold memuat STANDAR DOCS", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await start("p1");
    expect(res.statusCode).toBe(201);
    const c = connect("scaffold-p1");
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("STANDAR DOCS");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" });
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/terminal.route.test.ts -t "sesi scaffold"`
Expected: FAIL — no scaffold branch, so `{project, flow:"scaffold"}` falls through to the plain-terminal
path (id ≠ "scaffold-p1", flow undefined).

- [x] **Step 3: Add the scaffold route branch**

In `server/src/routes/terminal.ts`:

Update the import on line 4 to add `startScaffoldPrompt`:
```ts
import { realGit, startPrompt, continuePrompt, startProjectPrompt, startPrdPrompt, startScaffoldPrompt, type Flow } from "@hanoman/runner";
```

Add this branch AFTER the `reverse` branch (after its closing `}` at ~line 138) and BEFORE the `prd` branch:
```ts
    // SPEC-222 · sesi scaffold project-level: dari ide → Source of Truth penuh. Id deterministik
    // dari project (Start kedua menyambung, ADR-0015). Cermin reverse; diseed dari project.desc.
    if (parsed.data.flow === "scaffold") {
      const id = `scaffold-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel();
      try {
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "scaffold", model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startScaffoldPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          "scaffold-docs"),
      });
      return reply.code(201).send({ id: s.id });
    }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/terminal.route.test.ts`
Expected: PASS (all terminal route tests, incl. the 6 new scaffold ones).

- [x] **Step 5: Document the route in the API contract**

In `internal/docs/architecture/api-contract.md`, in the `## Terminal` block under `POST /terminal/sessions`,
add after the `flow "reverse"` line (~line 155):
```
#   flow "scaffold" (SPEC-222, ADR-0052): sesi project-level di worktree .worktrees/scaffold-<project>,
#     menyusun SoT penuh dari ide (Project.desc); 422 bila repoDir kosong / worktree gagal
```

- [x] **Step 6: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts internal/docs/architecture/api-contract.md
git commit -m "feat(server): flow:scaffold route branch — project-level SoT-from-idea session (SPEC-222)"
```

---

### Task 5: git-init on `POST /projects` for from-scratch (server)

Makes a from-scratch project runnable by initializing its repo at creation.

**Files:**
- Modify: `server/src/routes/projects.ts` (import `realGit`; init before create)
- Modify: `internal/docs/architecture/api-contract.md` (note git-init) + `internal/docs/architecture/data-model.md`
- Test: `server/test/projects.route.test.ts`

**Interfaces:**
- Consumes: `realGit.initRepo` (Task 1).
- Produces: `POST /projects {kind:"from-scratch", repoDir}` → 201 with the dir now a git repo (HEAD resolves);
  400 if `initRepo` throws (no row created). `kind:"existing"` and from-scratch WITHOUT repoDir are unchanged.

- [x] **Step 1: Write the failing tests**

Append to `server/test/projects.route.test.ts` inside `describe("projects routes")`. First extend the top imports:
```ts
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
```
Then add:
```ts
// SPEC-222 · from-scratch dengan direktori → hanoman git-init repo (siap scaffold).
it("git-inits a from-scratch project's chosen directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scratch-"));
  const res = await app.inject({
    method: "POST", url: "/api/projects",
    payload: { name: "kirana-init", kind: "from-scratch", desc: "marketplace", repoDir: dir },
  });
  expect(res.statusCode).toBe(201);
  expect(existsSync(join(dir, ".git"))).toBe(true);
  expect(spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir }).status).toBe(0); // HEAD resolves
});

it("does not git-init when from-scratch has no repoDir", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/projects",
    payload: { name: "kirana-nodir", kind: "from-scratch", desc: "idea only" },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().repoDir ?? null).toBeNull();
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/projects.route.test.ts -t "git-init"`
Expected: FAIL — the chosen dir has no `.git` (route doesn't init yet).

- [x] **Step 3: Init the repo in the create route**

In `server/src/routes/projects.ts`:

Add import after line 8 (`import { listSessions } from "../services/pty";`):
```ts
import { realGit } from "@hanoman/runner";
```
In the `POST /projects` handler, after the duplicate-id 409 check and BEFORE `prisma.project.create`, add:
```ts
    // SPEC-222 · project from-scratch butuh repo on-disk agar sesi scaffold bisa lahir (worktree
    // berbasis HEAD). git-init di sini membuatnya langsung runnable. Gagal init → 400, jangan
    // tinggalkan baris project setengah jadi. kind existing / tanpa repoDir tak tersentuh.
    if (b.kind === "from-scratch" && b.repoDir) {
      try { realGit.initRepo(b.repoDir); }
      catch (e) { return reply.code(400).send({ error: `gagal git-init "${b.repoDir}": ${(e as Error).message}` }); }
    }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/projects.route.test.ts`
Expected: PASS (all projects route tests, incl. the 2 new ones).

- [x] **Step 5: Document git-init behavior**

In `internal/docs/architecture/api-contract.md`, `## Projects` block, extend the `POST /projects` line (~line 30):
```
POST /projects            { name, kind, repoDir?, desc, gitRemote? }   # repoDir OPSIONAL (SPEC-217)
#   SPEC-222 · kind "from-scratch" + repoDir → hanoman `git init` + commit awal (siap scaffold); gagal init → 400
```
In `internal/docs/architecture/data-model.md`, in the `## Project` section, append to the `kind`/`repoDir` bullet (~line 12-13):
```
  Untuk `kind: "from-scratch"` dengan `repoDir` diisi, `POST /projects` meng-`git init` direktori itu
  (+ commit awal) agar langsung runnable oleh sesi scaffold (SPEC-222/ADR-0052).
```

- [x] **Step 6: Commit**

```bash
git add server/src/routes/projects.ts server/test/projects.route.test.ts internal/docs/architecture/api-contract.md internal/docs/architecture/data-model.md
git commit -m "feat(server): git-init from-scratch project repo at creation (SPEC-222)"
```

---

### Task 6: Frontend — client method, modal folder field, trigger + button

Wires the idea + folder into creation, the auto-scaffold trigger, and the manual "Scaffold docs" door.

**Files:**
- Modify: `src/src/api/client.ts` (add `scaffoldDocs`)
- Modify: `src/src/App.tsx` (`NewProjectModal` folder field; `createProject`; `scaffoldDocs` fn; `onScaffold` wiring)
- Modify: `src/src/screens/ProjectDetailScreen.tsx` (`onScaffold` prop + Door)

**Interfaces:**
- Consumes: `POST /terminal/sessions {project, flow:"scaffold"}` (Task 4); `api.getSettings()` (`autoScaffold`).
- Produces: `api.scaffoldDocs(project: string) => Promise<{id:string}>`; a "Scaffold docs" Door shown when
  `kind === "from-scratch" && repoDir`.

- [x] **Step 1: Add the client method**

In `src/src/api/client.ts`, after `reverseDocs` (~line 120), add:
```ts
  // SPEC-222 · scaffold: sesi project-level menyusun Source of Truth dari ide (from-scratch).
  scaffoldDocs: (project: string) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "scaffold" }) }),
```

- [x] **Step 2: Add the folder field to the from-scratch modal**

In `src/src/App.tsx`, `NewProjectModal`:

Update `canSubmit` for scratch (line ~200) to require a directory:
```ts
  const canSubmit = scratch ? (!!f.name.trim() && !!f.dir.trim())
    : clone ? (!!f.gitRemote.trim() && !!f.dir.trim())
    : (!!f.name.trim() || !!f.dir.trim());
```
Replace the from-scratch fields block (lines ~229-240, the `{scratch ? ( ... ) : (` first branch) with:
```tsx
      {scratch ? (
        <>
          <Field label="Nama project" hint="lowercase, tanpa spasi">
            <Input value={f.name} onChange={set("name")} placeholder="mis. kirana" style={{ width: "100%" }} />
          </Field>
          <Field label="Direktori" hint="folder tempat repo baru di-init (mesin ini)">
            <div style={{ display: "flex", gap: 8 }}>
              <Input value={f.dir} onChange={set("dir")} leftIcon="folder" mono placeholder="/path/ke/project-baru" style={{ flex: 1 }} />
              <Button size="sm" variant="secondary" leftIcon="folder-open" onClick={() => setPicker(true)}>Pilih folder</Button>
            </div>
          </Field>
          <FolderPicker open={picker} onClose={() => setPicker(false)}
            start={f.dir} onPick={(p) => setF((s) => ({ ...s, dir: p }))} />
          <Field label="Ide awal" hint="bahan brainstorm objective → jadi deskripsi & seed scaffold">
            <HnTextarea value={f.objective} onChange={set("objective")} rows={2} placeholder="Tuang ide di sini…" />
          </Field>
        </>
      ) : (
```
(Leave the existing-codebase `) : ( ... )}` branch and the trailing `</Modal>` untouched. The `picker`
state and `FolderPicker` component are already used by the existing branch.)

- [x] **Step 3: Send repoDir + idea, and auto-scaffold after create**

In `src/src/App.tsx`, `createProject` (line ~409), replace the create-call payload and the success tail.

Replace the `api.createProject({...})` object (lines ~417-421) with:
```ts
      created = await api.createProject({
        name, kind: f.kind, desc: scratch ? (f.objective.trim() || f.desc.trim()) : f.desc.trim(),
        repoDir: scratch ? f.dir.trim() : (clone ? undefined : f.dir),
        gitRemote: clone ? f.gitRemote.trim() : undefined,
      });
```
Replace the success tail (lines ~437-439) with:
```ts
    setProjects((list) => [created!, ...list]);
    setModal(null);
    // SPEC-222 · from-scratch: auto-start scaffold bila autoScaffold on (default), lalu ke Terminal;
    // selain itu ke layar project tempat tombol "Scaffold docs" berada.
    if (scratch) {
      let auto = true;
      try { auto = (await api.getSettings()).autoScaffold; } catch { /* default on */ }
      if (auto) {
        try {
          const { id } = await api.scaffoldDocs(created.id);
          setProjectId(created.id); setSection("terminal");
          showToast(`Project ${created.id} dibuat · scaffold docs · sesi ${id} dimulai`, "ok", "sparkles");
          return;
        } catch { /* jatuh ke layar project di bawah */ }
      }
      setProjectId(created.id); setSection("project");
      showToast(`Project ${created.id} dibuat · tekan "Scaffold docs" untuk menyusun SoT`, "ok", "box");
      return;
    }
    setProjectId(created.id); setSection("docs");
    showToast("Project " + created.id + " dibuat · reverse-engineer docs", "ok", "box");
```

- [x] **Step 4: Add the `scaffoldDocs` action + wire the Door**

In `src/src/App.tsx`, after the `reverseDocs` function (~line 502), add:
```ts
  // SPEC-222 · Scaffold docs: sesi interaktif menyusun Source of Truth dari ide (from-scratch).
  async function scaffoldDocs(p: ProjectVM) {
    try {
      const { id } = await api.scaffoldDocs(p.id);
      setSection("terminal");
      showToast(p.id + " · scaffold docs · sesi " + id + " dimulai", "info", "sparkles");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast(p.id + " · gagal mulai scaffold" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
    }
  }
```
In the `section === "project"` block, add `onScaffold` next to `onReverse` (line ~619):
```tsx
              onReverse={proj.kind === "existing" && proj.repoDir ? () => reverseDocs(proj) : undefined}
              onScaffold={proj.kind === "from-scratch" && proj.repoDir ? () => scaffoldDocs(proj) : undefined}
```

- [x] **Step 5: Add the Door to ProjectDetailScreen**

In `src/src/screens/ProjectDetailScreen.tsx`:

Extend the prop list (lines 37-39) to include `onScaffold`:
```tsx
export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoTerminal, onGotoBacklog, onDelete, onReverse, onScaffold }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoTerminal: () => void;
    onGotoBacklog: () => void; onDelete: () => void; onReverse?: () => void; onScaffold?: () => void }) {
```
Update the doors grid (line 76) to count either optional door:
```tsx
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${onReverse || onScaffold ? 4 : 3}, 1fr)`, gap: 12 }}>
```
Add the scaffold Door after the reverse Door (line 80):
```tsx
        {onScaffold && <Door icon="sparkles" title="Scaffold docs" hint="susun Source of Truth dari ide" onClick={onScaffold} />}
```

- [x] **Step 6: Typecheck the frontend**

Run: `pnpm -C src exec tsc --noEmit` (or `pnpm build` from repo root if `src` has no standalone tsc script).
Expected: no type errors.

- [x] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/App.tsx src/src/screens/ProjectDetailScreen.tsx
git commit -m "feat(web): from-scratch folder field, Scaffold docs button + autoScaffold auto-start (SPEC-222)"
```

---

### Task 7: Full test sweep + live verification

**Files:** none (verification only). Uses superpowers:verification-before-completion.

- [x] **Step 1: Run the full suite**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm test`
Expected: all green. If `hanoman_test` throws P2022, run its `prisma migrate deploy` first (no schema
change here, so this should not occur).

- [x] **Step 2: Live-boot the server against a throwaway migrated DB and drive the flow**

Boot the server (dedicated DB, not `hanoman_test`), then:
```bash
# create a from-scratch project pointing at a fresh empty dir
SCRATCH=$(mktemp -d)
curl -s -X POST localhost:<port>/api/projects -H 'content-type: application/json' \
  -d "{\"name\":\"smoke-kirana\",\"kind\":\"from-scratch\",\"desc\":\"marketplace jasa lokal\",\"repoDir\":\"$SCRATCH\"}" | jq .
test -d "$SCRATCH/.git" && git -C "$SCRATCH" rev-parse HEAD   # repo initialized, HEAD resolves
# start the scaffold session
curl -s -X POST localhost:<port>/api/terminal/sessions -H 'content-type: application/json' \
  -d '{"project":"smoke-kirana","flow":"scaffold"}' | jq .
test -d "$SCRATCH/.worktrees/scaffold-smoke-kirana" && echo "worktree OK"
```
Expected: project 201 + `.git` present + HEAD resolves; session 201 + worktree present. Use the auth
cookie / `requireAuth:false` harness as other live smokes do. Clean up: DELETE the session, `rm -rf $SCRATCH`.

- [x] **Step 3: Check every plan box is `- [x]`**

Verify this file has no remaining `- [ ]`. Then the run may write `Execute done`.

- [x] **Step 4: Final commit if anything was fixed during verification**

```bash
git add -A && git commit -m "test(spec-222): full suite green + live scaffold smoke verified"
```
(Only if fixes were needed — otherwise skip.)

---

## Self-Review

**Spec coverage:**
- Gap "scaffold pipeline stubbed, no prompt builder" → Task 2. ✓
- Gap "no route branch / no wire variant" → Task 3 (dto) + Task 4 (route). ✓
- Gap "from-scratch has no repo, no session can run" → Task 1 (`initRepo`) + Task 5 (init at create). ✓
- Gap "idea dropped at creation" → Task 6 (send `desc = idea`). ✓ (no schema change — matches decision)
- Gap "no client method / no UI trigger" → Task 6 (client `scaffoldDocs`, modal, button). ✓
- Gap "`autoScaffold` unwired" → Task 6 Step 3 (auto-start reads `getSettings().autoScaffold`). ✓
- Decision "pick folder at creation → git init" → Task 5 + Task 6 modal folder field (required). ✓
- Decision "manual button + wire autoScaffold" → Task 6 button + auto-start. ✓
- Docs updated in same commit as code → api-contract (Tasks 4,5), data-model (Task 5); ADR/FRD already committed. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✓

**Type consistency:** `initRepo(dir)` (Tasks 1,5), `startScaffoldPrompt(project, branchTo)` (Tasks 2,4),
`scaffoldDocs(project)` client (Task 6), `onScaffold?` prop (Task 6). Names/signatures match across tasks. ✓
