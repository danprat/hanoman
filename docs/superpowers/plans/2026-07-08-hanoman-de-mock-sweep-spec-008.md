# hanoman de-mock sweep (SPEC-008) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the three residual mock surfaces found in the audit — fabricated run-terminal responses, the unwired live run view, and the prototype demo dataset — so every surface reflects real state.

**Architecture:** Phase 1 makes the run terminal produce real effects (shared `applyControl` helper; free text → steer; `docs` → real read). Phase 2 wires `RunsScreen` to the existing SSE stream with a pure event-merge reducer, real controls, and a real duration backed by a new nullable `Run.finishedAt`. Phase 3 deletes `proto-data`/`seed` and moves tests onto a typed factory.

**Tech Stack:** Node 20+, TypeScript 5 (strict), Fastify, Prisma/Postgres, BullMQ/Redis, React 18 + Vite, Vitest (jsdom for `src`). No new runtime dependencies.

## Global Constraints

- **TypeScript strict; TDD** (failing test first); commit after every green step.
- **No new dependencies** — live SSE uses the browser-native `EventSource`.
- **No schema change without migration + ADR** — the only schema change is the additive, nullable `Run.finishedAt` (ADR-0007).
- **Never bypass the Stop hook / Source-of-Truth guardrail; runs never execute in the main tree** (unchanged; this plan touches none of it).
- **Update touched `internal/docs` in the same commit**; link new docs in `internal/docs/README.md`.
- **Real local check per task**, not just unit tests: boot the server (`pnpm dev` or `node server/dist/server.js`) / frontend and exercise the touched surface.
- Test commands: server `pnpm --filter ./server test`; frontend `pnpm --filter ./src test`; shared typecheck `pnpm --filter ./shared typecheck`; all typecheck `pnpm -r typecheck`. Root `pnpm test` runs vitest with `--no-file-parallelism` (tests share one DB — see Task 1).

## Task ordering rationale

Tasks are sequenced by dependency, not by spec-phase number. **Task 1 builds the test factory first** because every new test in Phases 1–2 uses it (writing throwaway `seed()`-based tests we then rewrite is waste). The bulk migration of the 19 existing `seed()` tests and the deletion of `proto-data`/`seed` land last (Task 7), once nothing new depends on them. Each task is tagged with its SPEC-008 phase.

## File Structure

```
server/test/factory.ts                       new  — resetDb() + typed row builders (Task 1)
server/src/routes/runs.ts                     mod  — applyControl helper; real /command routing (Task 2)
server/test/runs-command.test.ts             new  — terminal effect tests (Task 2)
src/src/App.tsx                               mod  — drop hardcoded prototype ids (Task 3)
src/test/app-default-project.test.tsx        new  — default project derives from data (Task 3)
server/prisma/schema.prisma                   mod  — Run.finishedAt (Task 4)
server/prisma/migrations/<ts>_run_finished_at new  — migration (Task 4)
internal/docs/adr/0007-run-finished-at.md     new  — ADR (Task 4)
shared/src/entities.ts                        mod  — zRun += createdAt, finishedAt (Task 4)
server/src/runner/events-io.ts                mod  — set finishedAt on terminal status (Task 4)
server/test/events-io.test.ts                new  — finishedAt persistence (Task 4)
shared/src/api.ts                             mod  — runLog/runCommand/runControl/runSteer paths (Task 5)
src/src/api/client.ts                         mod  — subscribeRun + POST wrappers + RunLiveEvent (Task 5)
src/test/api-client.test.ts                  new  — subscribeRun + wrappers (Task 5)
src/src/screens/RunsScreen.tsx                mod  — reducer, live SSE, controls, live duration (Task 6)
src/src/screens/run-reduce.ts                 new  — pure reduceRunEvent + fmtDuration (Task 6)
src/src/screens/types.ts                      mod  — RunVM drops `duration` (Task 6)
src/test/run-reduce.test.ts                  new  — reducer + duration unit tests (Task 6)
server/test/*.ts (19 files)                    mod  — seed() → resetDb() + factory (Task 7)
server/prisma/proto-data.ts                   del  (Task 7)
server/prisma/proto-doc-content.ts            del  (Task 7)
server/prisma/seed.ts                         del  (Task 7)
server/test/seed.test.ts                      del  (Task 7)
internal/docs/frontend/frontend-implementation.md  mod — live run view note (Task 6/8)
internal/docs/README.md                       mod  — link ADR-0007 (Task 4/8)
```

---

## Phase 3 infra (built first)

### Task 1 — Test data factory (Phase 3)

Replaces the prototype `seed()` as the test data source. Built first so every later task's tests use it.

**Files:**
- Create: `server/test/factory.ts`

**Interfaces:**
- Produces:
  - `resetDb(): Promise<void>` — truncates all tables (same order as the old `seed`).
  - `makeProject(over?: Partial<Prisma.ProjectCreateManyInput>): Promise<Project>`
  - `makeSpec(over?: Partial<Prisma.SpecCreateManyInput>): Promise<Spec>` (requires `projectId` via `over` or default `"p1"`)
  - `makeRun(over?: Partial<Prisma.RunCreateManyInput>): Promise<Run>` (requires `projectId`)
  - `makeTrigger(over?: Partial<Prisma.TriggerCreateManyInput>): Promise<Trigger>`
  - `makeDocFile(over?: Partial<Prisma.DocFileCreateManyInput>): Promise<DocFile>`
  - `makeSetting(over?: Partial<Setting>): Promise<void>` — upserts the id=1 Setting row.
  - Each builder inserts one row (defaulting every required column) and returns the created record. Callers override only what they assert on.

- [ ] **Step 1: Write the factory**

```ts
// server/test/factory.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { DEFAULT_SETTING } from "../src/services/settings";
import type { Setting } from "@hanoman/shared";

// Truncate every table in FK-safe order (mirrors the deleted seed()).
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.docFile.deleteMany(), prisma.trigger.deleteMany(), prisma.run.deleteMany(),
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
  ]);
}

export function makeProject(over: Partial<Prisma.ProjectCreateManyInput> = {}) {
  return prisma.project.create({ data: {
    id: "p1", name: "p1", desc: "test project", kind: "existing",
    stack: "", docStatus: "ok", coverage: 100, ...over } });
}

export function makeSpec(over: Partial<Prisma.SpecCreateManyInput> = {}) {
  return prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "test spec", source: "brief",
    stage: "planned", author: "Rangga", priority: "sedang", objective: "", ...over } });
}

export function makeRun(over: Partial<Prisma.RunCreateManyInput> = {}) {
  return prisma.run.create({ data: {
    id: "RUN-1", projectId: "p1", specId: null, kind: "feature", status: "running",
    trigger: "commit", triggerDetail: "push → main",
    phases: [
      { name: "Brainstorm", state: "done" }, { name: "Objective", state: "done" },
      { name: "Spec", state: "done" }, { name: "Plan", state: "done" },
      { name: "Execute", state: "active" },
    ] as unknown as Prisma.InputJsonValue,
    plan: [] as unknown as Prisma.InputJsonValue,
    files: [] as unknown as Prisma.InputJsonValue,
    log: [] as unknown as Prisma.InputJsonValue,
    worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
    model: "claude-opus-4-8", tokensIn: "0", tokensOut: "0", cost: "$0.00", progress: 0,
    ...over } });
}

export function makeTrigger(over: Partial<Prisma.TriggerCreateManyInput> = {}) {
  return prisma.trigger.create({ data: {
    id: "t1", projectId: "p1", type: "commit", detail: "push → main",
    target: "plan + execute", enabled: true, ...over } });
}

export function makeDocFile(over: Partial<Prisma.DocFileCreateManyInput> = {}) {
  return prisma.docFile.create({ data: {
    projectId: "p1", path: "product/prd.md", category: "product",
    content: "# prd", linked: true, root: false, ...over } });
}

export function makeSetting(over: Partial<Setting> = {}) {
  const data = { ...DEFAULT_SETTING, ...over } as unknown as Prisma.InputJsonValue;
  return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
}
```

- [ ] **Step 2: Typecheck the factory**

Run: `pnpm --filter ./server typecheck`
Expected: no errors (the builders type-check against Prisma create inputs; `DEFAULT_SETTING` is exported from `src/services/settings.ts`).

- [ ] **Step 3: Smoke it against the DB**

Ensure Postgres is up (`docker compose up -d --wait` from repo root). Then a throwaway check from `server/`:

```bash
pnpm exec tsx -e "import { resetDb, makeProject, makeRun } from './test/factory'; (async () => { await resetDb(); const p = await makeProject(); const r = await makeRun({ projectId: p.id }); console.log('ok', p.id, r.id, r.status); process.exit(0); })().catch(e => { console.error(e); process.exit(1); })"
```
Expected: prints `ok p1 RUN-1 running`. (This validates FK order + JSON casts before any test relies on it.)

- [ ] **Step 4: Commit**

```bash
git add server/test/factory.ts
git commit -m "test(server): typed data factory to replace proto seed (SPEC-008)"
```

---

## Phase 1 — Kill fabricated terminal responses + prototype ids

### Task 2 — Real run-terminal routing (Phase 1)

Make `POST /runs/:id/command` produce real effects: `resume`/`retry` re-enqueue through the same path as `/control`; free text on an active run is steered into the run; `docs <path>` reads the real file. No fabricated Claude reply.

**Files:**
- Modify: `server/src/routes/runs.ts`
- Test: `server/test/runs-command.test.ts`

**Interfaces:**
- Consumes: `resetDb`, `makeProject`, `makeRun` (Task 1); `enqueueRun`, `stepModels`, `publishControl`, `subscriber` (existing in this module).
- Produces: `applyControl(run, action): Promise<{ ok: true } | { ok: false; reason: string }>` (module-internal; shared by `/control` and `/command`). `runCommand` becomes `async` and takes `(run, text, active)`.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/runs-command.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun, makeDocFile, makeSetting } from "./factory";

const app = buildApp();
const cmd = (id: string, text: string) =>
  app.inject({ method: "POST", url: `/api/runs/${id}/command`, payload: { text } });

describe("run terminal command routing (SPEC-008)", () => {
  beforeEach(async () => {
    await resetDb();
    await makeSetting();                                  // dailyBudget etc. for enqueue
    await makeProject({ id: "p1", repoDir: process.cwd() });
  });

  it("resume re-enqueues (no fabricated line)", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "paused" });
    const res = await cmd("RUN-1", "resume");
    const lines = res.json().lines as { t: string; s: string }[];
    // truthful: re-enqueued, not the old canned "dilanjutkan oleh manusia"
    expect(lines.some((l) => /enqueue/i.test(l.s))).toBe(true);
    expect(lines.some((l) => l.s === "dilanjutkan oleh manusia")).toBe(false);
  });

  it("free text on an active run is steered, not answered by a fake Claude", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
    const res = await cmd("RUN-1", "tolong pakai queue yang ada");
    const lines = res.json().lines as { t: string; s: string }[];
    expect(lines.some((l) => /diteruskan ke run/i.test(l.s))).toBe(true);
    expect(lines.some((l) => /^claude: /.test(l.s))).toBe(false);   // no fabricated reply
  });

  it("free text on an inactive run says the run is not active", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "done" });
    const res = await cmd("RUN-1", "apa kabar");
    const lines = res.json().lines as { t: string; s: string }[];
    expect(lines.some((l) => /tidak aktif/i.test(l.s))).toBe(true);
  });

  it("docs <path> reflects a real file", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
    await makeDocFile({ projectId: "p1", path: "product/prd.md", content: "a\nb\nc" });
    const hit = (await cmd("RUN-1", "docs product/prd.md")).json().lines as { t: string; s: string }[];
    expect(hit.some((l) => l.t === "✓" && /product\/prd\.md/.test(l.s))).toBe(true);
    const miss = (await cmd("RUN-1", "docs nope/x.md")).json().lines as { t: string; s: string }[];
    expect(miss.some((l) => l.t === "✗")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./server test runs-command`
Expected: FAIL — current `runCommand` returns the canned `resume`/`default`/`docs` lines; `resume` doesn't re-enqueue.

- [ ] **Step 3: Add the `readDoc` import and `applyControl` helper**

At the top of `server/src/routes/runs.ts`, add to the imports:

```ts
import { readDoc } from "../services/docs";
```

Immediately above `export default async function (app: FastifyInstance) {`, add the shared helper:

```ts
// Shared control effect for POST /control and the terminal resume/retry verb.
// pause/stop abort the live turn + set status; resume/retry re-enqueue the same
// run (budget-gated → { ok:false, reason } maps to 409 / a terminal line).
async function applyControl(
  run: { id: string; projectId: string; branchFrom: string; branchTo: string; kind: string; specId: string | null },
  action: "pause" | "resume" | "stop" | "retry",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (action === "pause" || action === "stop") {
    await publishControl(run.id, { type: action });
    await prisma.run.update({ where: { id: run.id }, data: { status: action === "pause" ? "paused" : "stopped" } });
    return { ok: true };
  }
  const project = await prisma.project.findUnique({ where: { id: run.projectId } });
  const r = await enqueueRun({ runId: run.id, projectId: run.projectId, repoDir: project?.repoDir ?? process.cwd(),
    branchFrom: run.branchFrom, branchTo: run.branchTo, flow: run.kind as Flow, specId: run.specId ?? undefined, steps: await stepModels() });
  return r.enqueued ? { ok: true } : { ok: false, reason: r.reason };
}
```

- [ ] **Step 4: Make `runCommand` async, real for `resume`/`docs`/free text**

Replace the whole `runCommand` function (currently starting `function runCommand(run: {...}, text: string): Line[] {`) with:

```ts
const KNOWN = new Set(["help","status","plan","files","diff","steer","pause","resume","stop","docs","clear"]);
// Terminal interpreter. Read/display verbs render persisted Run data; effectful
// verbs (steer/pause/stop/resume/retry) have already run in the route — here we
// render the truthful outcome. `active` = run is running|paused.
async function runCommand(
  run: { id: string; projectId: string; status: string; kind: string; progress: number; phases: unknown; plan: unknown; files: unknown },
  text: string, active: boolean,
): Promise<Line[]> {
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();
  const arg = parts.slice(1).join(" ");
  if (cmd === "clear") return [];
  switch (cmd) {
    case "help": return [{ t: " ", s: TERM_HELP }];
    case "status": {
      const ph = ((run.phases as { name: string; state: string }[]).find((p) => p.state === "active") ?? {}).name ?? "—";
      return [{ t: "›", s: `${run.id} · ${run.status} · ${run.kind} · fase ${ph} · ${run.progress || 0}%` }];
    }
    case "plan": {
      const plan = run.plan as { label: string; state: string }[];
      return plan.length ? plan.map((s) => ({ t: s.state === "done" ? "✓" : s.state === "active" ? "›" : " ", s: s.label })) : [{ t: " ", s: "belum ada plan untuk run ini" }];
    }
    case "files": case "diff": {
      const files = run.files as { path: string; add: number; del: number; status: string }[];
      return files.length ? files.map((f) => ({ t: f.status === "added" ? "✓" : "›", s: `${f.path}  +${f.add} −${f.del}` })) : [{ t: " ", s: "belum ada file berubah" }];
    }
    case "steer": return arg ? [{ t: "»", s: "steer · " + arg }, { t: "›", s: "diterima — arahan disisipkan ke langkah berikutnya" }] : [{ t: " ", s: "pakai: steer <pesan>" }];
    case "pause": return [{ t: " ", s: "— dijeda oleh manusia —" }];
    case "resume": return [{ t: "›", s: "dilanjutkan — run di-enqueue ulang" }];
    case "stop": return [{ t: "✗", s: "dihentikan oleh manusia" }];
    case "docs": {
      if (!arg) return [{ t: " ", s: "pakai: docs <path>" }];
      const content = await readDoc(run.projectId, arg);
      return content === null
        ? [{ t: "✗", s: `internal/docs/${arg} tidak ditemukan` }]
        : [{ t: "✓", s: `internal/docs/${arg} · ${content.split("\n").length} baris` }];
    }
    default:
      return active
        ? [{ t: "»", s: text.trim() }, { t: "›", s: "diteruskan ke run sebagai arahan" }]
        : [{ t: " ", s: "run tidak aktif — tidak ada yang menerima arahan" }];
  }
}
```

(Note: the old `default` case that fabricated `` `claude: "${text}" diterima …` `` is gone.)

- [ ] **Step 5: Refactor `/control` onto `applyControl`**

Replace the body of `app.post("/runs/:id/control", …)` after the `if (!run) …` guard (the `const { action } = parsed.data;` block through the final `return`) with:

```ts
    const res = await applyControl(run, parsed.data.action);
    if (res.ok) {
      if (parsed.data.action === "pause" || parsed.data.action === "stop") return reply.code(202).send({ accepted: true });
      return reply.code(202).send({ accepted: true });
    }
    return reply.code(409).send({ reason: res.reason });
```

(Behavior identical to today; the effect now lives in `applyControl`. The two 202 branches can be collapsed to one `return reply.code(202).send({ accepted: true });` — kept explicit here for clarity; collapse if you prefer.)

- [ ] **Step 6: Rewrite the `/command` route to run effects then render**

Replace the whole `app.post("/runs/:id/command", …)` handler with:

```ts
  app.post("/runs/:id/command", async (req, reply) => {
    const parsed = zCommand.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid command" });
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    const text = parsed.data.text.trim();
    const parts = text.split(/\s+/);
    const cmd = (parts[0] ?? "").toLowerCase();
    const arg = parts.slice(1).join(" ");
    const active = run.status === "running" || run.status === "paused";
    // Effectful verbs run before rendering; resume/retry can be budget-rejected.
    if (cmd === "steer" && arg) await publishControl(id, { type: "steer", message: arg });
    else if (cmd === "pause" || cmd === "stop") await applyControl(run, cmd);
    else if (cmd === "resume" || cmd === "retry") {
      const r = await applyControl(run, cmd);
      if (!r.ok) return { lines: [{ t: "✗", s: `tidak bisa ${cmd} · ${r.reason}` }] };
    } else if (!KNOWN.has(cmd) && active) {
      await publishControl(id, { type: "steer", message: text });   // free text → steer the run
    }
    return { lines: await runCommand(run, text, active) };
  });
```

- [ ] **Step 7: Run the new + existing route tests + typecheck**

Run: `pnpm --filter ./server test runs-command runs.route && pnpm --filter ./server typecheck`
Expected: `runs-command` PASS (4 tests); `runs.route` still PASS; no type errors. (`runs.route.test.ts` still uses `seed()` here — migrated in Task 7.)

- [ ] **Step 8: Real local check — curl the terminal**

Boot Postgres+Redis+server, seed one running run, and curl (from repo root, server on :3000 via `pnpm --filter ./server dev`):

```bash
# in another shell, once a running RUN-xxxx exists (create via the UI or a factory script):
curl -s -XPOST localhost:3000/api/runs/RUN-1/command -H 'content-type: application/json' -d '{"text":"resume"}'
curl -s -XPOST localhost:3000/api/runs/RUN-1/command -H 'content-type: application/json' -d '{"text":"pakai queue yang ada"}'
curl -s -XPOST localhost:3000/api/runs/RUN-1/command -H 'content-type: application/json' -d '{"text":"docs product/prd.md"}'
```
Expected: `resume` → line mentioning re-enqueue (or a `409`-style "tidak bisa" line if budget-blocked); free text → `» …` + `diteruskan ke run`; never a `claude: "…"` line; `docs` → `✓ … · N baris` or `✗ … tidak ditemukan`.

- [ ] **Step 9: Commit**

```bash
git add server/src/routes/runs.ts server/test/runs-command.test.ts
git commit -m "feat(server): real run-terminal routing — resume re-enqueues, free text steers, docs reads (SPEC-008)"
```

---

### Task 3 — Drop hardcoded prototype ids in App.tsx (Phase 1)

**Files:**
- Modify: `src/src/App.tsx`
- Test: `src/test/app-default-project.test.tsx`

**Interfaces:**
- Consumes: `api.listProjects/listSpecs/listRuns/listTriggers` (existing).

- [ ] **Step 1: Write the failing test**

```tsx
// src/test/app-default-project.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";
import { api } from "../src/api/client";

beforeEach(() => {
  vi.spyOn(api, "listProjects").mockResolvedValue([
    { id: "kirana", name: "kirana", desc: "d", kind: "existing", repoDir: null, repoUrl: null,
      stack: "", docStatus: "ok", coverage: 100, createdAt: "2026-07-08T00:00:00.000Z",
      backlog: 0, topStage: "spec", run: { status: "idle", phase: null, kind: null },
      activity: "idle", commit: "x" } as any,
  ]);
  vi.spyOn(api, "listSpecs").mockResolvedValue([]);
  vi.spyOn(api, "listRuns").mockResolvedValue([]);
  vi.spyOn(api, "listTriggers").mockResolvedValue([]);
});

describe("App default project (SPEC-008)", () => {
  it("defaults to the first loaded project, not the prototype 'loka-pos'", async () => {
    render(<App />);
    // The Docs section header shows the selected project's name; open it via nav.
    await waitFor(() => expect(screen.getAllByText(/kirana/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/loka-pos/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./src test app-default-project`
Expected: FAIL — initial `projectId` is `"loka-pos"`, so `proj` may resolve oddly and the prototype id is referenced.

- [ ] **Step 3: Remove the hardcoded ids**

In `src/src/App.tsx`:

- Change the project-id state initializer:

```ts
  const [projectId, setProjectId] = React.useState("");
```

- In the mount `useEffect`, after `setProjects(p)`, default the selection to the first project when none is chosen. Replace:

```ts
      .then(([p, s, r, t]) => { setProjects(p); setBacklog(s); setRuns(r); setTriggers(t); })
```
with:
```ts
      .then(([p, s, r, t]) => {
        setProjects(p); setBacklog(s); setRuns(r); setTriggers(t);
        setProjectId((cur) => cur || p[0]?.id || "");
      })
```

- In the `runs` section, drop the prototype run id. Replace:

```tsx
        <RunsScreen runs={runsView} selectedId="RUN-8842" pageSize={4} />
```
with:
```tsx
        <RunsScreen runs={runsView} pageSize={4} />
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter ./src test app-default-project && pnpm --filter ./src typecheck`
Expected: PASS; no type errors (`selectedId` is already optional on `RunsScreen`).

- [ ] **Step 5: Commit**

```bash
git add src/src/App.tsx src/test/app-default-project.test.tsx
git commit -m "fix(web): derive default project from data, drop prototype ids (SPEC-008)"
```

---

## Phase 2 — RunsScreen live + working controls

### Task 4 — `Run.finishedAt` column + ADR + DTO + persistence (Phase 2)

Backs a real `duration` and lets the reducer know when a run ended.

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `internal/docs/adr/0007-run-finished-at.md`
- Modify: `internal/docs/README.md` (link the ADR)
- Modify: `shared/src/entities.ts`
- Modify: `server/src/runner/events-io.ts`
- Test: `server/test/events-io.test.ts`

**Interfaces:**
- Consumes: `resetDb`, `makeProject`, `makeRun` (Task 1); `persistEvent` (existing).
- Produces: `Run.finishedAt: DateTime?` column; `zRun` gains `createdAt: z.string()` + `finishedAt: z.string().nullable()`.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/events-io.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { persistEvent } from "../src/runner/events-io";
import { resetDb, makeProject, makeRun } from "./factory";

describe("persistEvent finishedAt (SPEC-008)", () => {
  beforeEach(async () => { await resetDb(); await makeProject(); await makeRun({ id: "RUN-1", projectId: "p1", status: "running" }); });

  it("sets finishedAt on a terminal status", async () => {
    await persistEvent("RUN-1", { kind: "status", status: "done" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.status).toBe("done");
    expect(run.finishedAt).not.toBeNull();
  });

  it("leaves finishedAt null on a non-terminal status", async () => {
    await persistEvent("RUN-1", { kind: "status", status: "running" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.finishedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./server test events-io`
Expected: FAIL — `finishedAt` doesn't exist on `Run` (Prisma type error / unknown column).

- [ ] **Step 3: Add the column + migrate**

In `server/prisma/schema.prisma`, inside `model Run`, add after `createdAt`:

```prisma
  finishedAt    DateTime?
```

Create the migration (Postgres must be up):

```bash
cd server && pnpm exec prisma migrate dev --name run_finished_at
```
Expected: a new folder under `server/prisma/migrations/` with `ALTER TABLE "Run" ADD COLUMN "finishedAt" TIMESTAMP;` and the Prisma client regenerated.

- [ ] **Step 4: Set `finishedAt` in `persistEvent`**

In `server/src/runner/events-io.ts`, the `status` branch currently reads:

```ts
  } else if (e.kind === "status") {
    await prisma.run.update({ where: { id: runId }, data: { status: e.status } });
```
Replace it with:
```ts
  } else if (e.kind === "status") {
    const done = e.status === "done" || e.status === "failed" || e.status === "stopped";
    await prisma.run.update({ where: { id: runId }, data: { status: e.status, ...(done ? { finishedAt: new Date() } : {}) } });
```

- [ ] **Step 5: Expose the fields on the Run DTO**

In `shared/src/entities.ts`, in `zRun` (the `z.object({ … })`), add after `cost: z.string(), progress: z.number(),`:

```ts
  createdAt: z.string(), finishedAt: z.string().nullable(),
```

(The routes already return these from Prisma; this makes them part of the `Run` type the frontend consumes.)

- [ ] **Step 6: Write ADR-0007 and link it**

Create `internal/docs/adr/0007-run-finished-at.md`:

```markdown
# ADR-0007 — Run.finishedAt for real run duration

**Status:** accepted (SPEC-008) · 2026-07-08

## Context
`RunsScreen` showed a hardcoded `duration: "—"`. `Run` stored `createdAt` (start) but no
end timestamp, so a finished run's elapsed time could not be computed — only a live
run's elapsed-from-now.

## Decision
Add a nullable `Run.finishedAt DateTime?`. `events-io.persistEvent` sets it to `now()`
when a run reaches a terminal status (`done` / `failed` / `stopped`). Duration is
`(finishedAt ?? now) − createdAt`, computed client-side (live for running runs).

## Consequences
Additive, nullable column — safe forward migration, existing rows read `null` (their
duration renders live-from-`createdAt`, which for already-finished rows is a harmless
over-estimate until the next run). No backfill. `zRun` exposes `createdAt` + `finishedAt`.
```

In `internal/docs/README.md`, add a link to `adr/0007-run-finished-at.md` alongside the other ADR links (match the existing list format).

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter ./server test events-io && pnpm -r typecheck`
Expected: `events-io` PASS (2 tests); all packages typecheck (shared `zRun` change compiles; frontend still builds).

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations shared/src/entities.ts server/src/runner/events-io.ts server/test/events-io.test.ts internal/docs/adr/0007-run-finished-at.md internal/docs/README.md
git commit -m "feat(server): Run.finishedAt for real duration + ADR-0007 (SPEC-008)"
```

---

### Task 5 — API client: `subscribeRun` + control wrappers + paths (Phase 2)

**Files:**
- Modify: `shared/src/api.ts`
- Modify: `src/src/api/client.ts`
- Test: `src/test/api-client.test.ts`

**Interfaces:**
- Produces:
  - `paths.runLog(id)`, `paths.runCommand(id)`, `paths.runControl(id)`, `paths.runSteer(id)`.
  - `export type RunLiveEvent = { kind:"log"; line:{t:string;s:string} } | { kind:"status"; status:string } | { kind:"phase"; name:string; state:string } | { kind:"cost"; tokensIn:number; tokensOut:number; costUsd:number } | { kind:"file"; path:string; add:number; del:number; status:string }`
  - `subscribeRun(id: string, onEvent: (e: RunLiveEvent) => void): () => void` — opens an `EventSource`, returns an unsubscribe.
  - `api.runCommand(id, text)`, `api.runControl(id, action)`, `api.runSteer(id, message)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/api-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { paths } from "@hanoman/shared";
import { subscribeRun, api } from "../src/api/client";

class FakeES {
  static last: FakeES;
  url: string; onmessage: ((e: { data: string }) => void) | null = null; closed = false;
  constructor(url: string) { this.url = url; FakeES.last = this; }
  close() { this.closed = true; }
}

beforeEach(() => { (globalThis as any).EventSource = FakeES as any; });

describe("api client live + control (SPEC-008)", () => {
  it("subscribeRun opens the SSE URL and forwards parsed events", () => {
    const seen: any[] = [];
    const off = subscribeRun("RUN-1", (e) => seen.push(e));
    expect(FakeES.last.url).toBe(paths.runLog("RUN-1"));
    FakeES.last.onmessage!({ data: JSON.stringify({ kind: "status", status: "done" }) });
    expect(seen).toEqual([{ kind: "status", status: "done" }]);
    off();
    expect(FakeES.last.closed).toBe(true);
  });

  it("runControl posts the action to the control path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } }));
    await api.runControl("RUN-1", "pause");
    expect(fetchMock).toHaveBeenCalledWith(paths.runControl("RUN-1"), expect.objectContaining({ method: "POST" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./src test api-client`
Expected: FAIL — `subscribeRun`, `api.runControl`, and the new `paths.*` don't exist.

- [ ] **Step 3: Add the paths**

In `shared/src/api.ts`, inside the `paths` object after `run: (id) => …`, add:

```ts
  runLog: (id: string) => `${API}/runs/${id}/log`,
  runCommand: (id: string) => `${API}/runs/${id}/command`,
  runControl: (id: string) => `${API}/runs/${id}/control`,
  runSteer: (id: string) => `${API}/runs/${id}/steer`,
```

- [ ] **Step 4: Add the client pieces**

In `src/src/api/client.ts`, add the event type + subscribe helper + wrappers. After the existing `api` object, add:

```ts
export type RunLiveEvent =
  | { kind: "log"; line: { t: string; s: string } }
  | { kind: "status"; status: string }
  | { kind: "phase"; name: string; state: string }
  | { kind: "cost"; tokensIn: number; tokensOut: number; costUsd: number }
  | { kind: "file"; path: string; add: number; del: number; status: string };

// Live run stream over SSE (backend: GET /runs/:id/log). Returns an unsubscribe.
export function subscribeRun(id: string, onEvent: (e: RunLiveEvent) => void): () => void {
  const es = new EventSource(paths.runLog(id));
  es.onmessage = (ev) => { try { onEvent(JSON.parse(ev.data)); } catch { /* skip malformed frame */ } };
  return () => es.close();
}
```

Add these three methods inside the `api` object (e.g. after `getRun`):

```ts
  runCommand: (id: string, text: string) =>
    j<{ lines: { t: string; s: string }[] }>(paths.runCommand(id), { method: "POST", ...body({ text }) }),
  runControl: (id: string, action: "pause" | "resume" | "stop" | "retry") =>
    j<{ accepted: boolean }>(paths.runControl(id), { method: "POST", ...body({ action }) }),
  runSteer: (id: string, message: string) =>
    j<{ accepted: boolean }>(paths.runSteer(id), { method: "POST", ...body({ message }) }),
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter ./src test api-client && pnpm --filter ./src typecheck && pnpm --filter ./shared typecheck`
Expected: PASS (2 tests); no type errors.

- [ ] **Step 6: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/test/api-client.test.ts
git commit -m "feat(web): subscribeRun SSE + run control wrappers (SPEC-008)"
```

---

### Task 6 — RunsScreen: live stream, controls, real duration (Phase 2)

**Files:**
- Create: `src/src/screens/run-reduce.ts`
- Modify: `src/src/screens/RunsScreen.tsx`
- Modify: `src/src/screens/types.ts`
- Modify: `src/src/App.tsx` (stop setting `duration`)
- Test: `src/test/run-reduce.test.ts`

**Interfaces:**
- Consumes: `RunLiveEvent`, `subscribeRun`, `api.runCommand/runControl` (Task 5); `Run.createdAt/finishedAt` (Task 4).
- Produces: `reduceRunEvent(run: RunVM, e: RunLiveEvent): RunVM`; `fmtDuration(ms: number): string`; `runDurationMs(run: { createdAt: string; finishedAt: string | null }, now: number): number`.

- [ ] **Step 1: Write the failing test (pure reducer + duration)**

```ts
// src/test/run-reduce.test.ts
import { describe, it, expect } from "vitest";
import { reduceRunEvent, fmtDuration, runDurationMs } from "../src/screens/run-reduce";
import type { RunVM } from "../src/screens/types";

const base = {
  id: "RUN-1", projectId: "p1", specId: null, kind: "feature", status: "running",
  trigger: "commit", triggerDetail: "push → main",
  phases: [{ name: "Execute", state: "active" }], plan: [], files: [], log: [],
  worktree: "w", branchFrom: "main", branchTo: "b", model: "m",
  tokensIn: "0", tokensOut: "0", cost: "$0.00", progress: 0,
  createdAt: "2026-07-08T00:00:00.000Z", finishedAt: null,
  project: "p1", spec: null, title: "t", phase: "Execute",
} as unknown as RunVM;

describe("reduceRunEvent (SPEC-008)", () => {
  it("appends a log line", () => {
    const r = reduceRunEvent(base, { kind: "log", line: { t: "›", s: "hi" } });
    expect((r.log as any[]).at(-1)).toEqual({ t: "›", s: "hi" });
  });
  it("updates a phase state", () => {
    const r = reduceRunEvent(base, { kind: "phase", name: "Execute", state: "done" });
    expect((r.phases as any[]).find((p) => p.name === "Execute").state).toBe("done");
  });
  it("sets status", () => {
    expect(reduceRunEvent(base, { kind: "status", status: "done" }).status).toBe("done");
  });
  it("maps cost to display strings", () => {
    const r = reduceRunEvent(base, { kind: "cost", tokensIn: 10, tokensOut: 20, costUsd: 1.5 });
    expect(r.tokensIn).toBe("10"); expect(r.tokensOut).toBe("20"); expect(r.cost).toBe("$1.50");
  });
});

describe("duration (SPEC-008)", () => {
  it("uses finishedAt when present", () => {
    const ms = runDurationMs({ createdAt: "2026-07-08T00:00:00.000Z", finishedAt: "2026-07-08T00:01:30.000Z" }, Date.parse("2026-07-08T05:00:00Z"));
    expect(fmtDuration(ms)).toBe("1m 30d");
  });
  it("uses now while running", () => {
    const ms = runDurationMs({ createdAt: "2026-07-08T00:00:00.000Z", finishedAt: null }, Date.parse("2026-07-08T00:00:05Z"));
    expect(fmtDuration(ms)).toBe("5d");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./src test run-reduce`
Expected: FAIL — `../src/screens/run-reduce` doesn't exist.

- [ ] **Step 3: Write the pure reducer + duration helpers**

```ts
// src/src/screens/run-reduce.ts
import type { RunLiveEvent } from "../api/client";
import type { RunVM } from "./types";

// Merge one live SSE event into a run view-model (pure; unit-tested).
export function reduceRunEvent(run: RunVM, e: RunLiveEvent): RunVM {
  switch (e.kind) {
    case "log":   return { ...run, log: [...(run.log as any[]), e.line] };
    case "status":return { ...run, status: e.status as RunVM["status"] };
    case "phase": return { ...run, phases: (run.phases as any[]).map((p) => p.name === e.name ? { ...p, state: e.state } : p) };
    case "cost":  return { ...run, tokensIn: String(e.tokensIn), tokensOut: String(e.tokensOut), cost: `$${e.costUsd.toFixed(2)}` };
    case "file":  return { ...run, files: [...(run.files as any[]), { path: e.path, add: e.add, del: e.del, status: e.status }] };
    default:      return run;
  }
}

export function runDurationMs(run: { createdAt: string; finishedAt: string | null }, now: number): number {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return Math.max(0, end - Date.parse(run.createdAt));
}

// j=jam, m=menit, d=detik
export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h ? `${h}j ${m % 60}m` : m ? `${m}m ${s % 60}d` : `${s}d`;
}
```

- [ ] **Step 4: Run reducer test to verify it passes**

Run: `pnpm --filter ./src test run-reduce`
Expected: PASS (6 tests).

- [ ] **Step 5: Drop `duration` from `RunVM` and stop setting it in App**

In `src/src/screens/types.ts`, change the `RunVM` type — remove `; duration: string`:

```ts
export type RunVM = Run & { project: string; spec: string | null; title: string; phase: string | null };
```

In `src/src/App.tsx`, in the `runsView` `useMemo`, remove `duration: "—"` from the returned object:

```ts
      return { ...r, project: r.projectId, spec: r.specId, title, phase: activePhase };
```

- [ ] **Step 6: Wire live streaming, controls, and duration into RunsScreen**

In `src/src/screens/RunsScreen.tsx`:

- Add imports at the top (after the existing imports):

```tsx
import { subscribeRun, api } from "../api/client";
import { reduceRunEvent, runDurationMs, fmtDuration } from "./run-reduce";
```

- Replace the `RunsScreen` component (the exported function at the bottom) with a version that keeps a live copy of the selected run and subscribes while it's active:

```tsx
export function RunsScreen({ runs, selectedId, pageSize = 4 }:
  { runs: RunVM[]; selectedId?: string; pageSize?: number }) {
  const [selId, setSelId] = React.useState(selectedId || (runs[0] && runs[0].id));
  const pg = usePaged(runs, pageSize, "runs");
  const picked = runs.find((r) => r.id === selId) || runs[0];
  // Live overlay: seed from the picked run, merge SSE events while it's active.
  const [live, setLive] = React.useState<RunVM | undefined>(picked);
  React.useEffect(() => { setLive(picked); }, [picked?.id]);
  React.useEffect(() => {
    if (!picked) return;
    if (picked.status !== "running" && picked.status !== "paused") return;
    const off = subscribeRun(picked.id, (e) => setLive((cur) => cur ? reduceRunEvent(cur, e) : cur));
    return off;
  }, [picked?.id, picked?.status]);
  const active = live ?? picked;
  if (!active) return <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-muted)" }}>Belum ada run.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
      <Card padding={0}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">Activity · {runs.length} runs</span>
        </div>
        {pg.pageItems.map((r) => <RunListRow key={r.id} run={r} active={r.id === active.id} onClick={() => setSelId(r.id)} />)}
        <Pager {...pg} onPage={pg.setPage} unit="run" />
      </Card>
      <RunDetail run={active} />
    </div>
  );
}
```

- In `RunDetail`, compute a live duration and add a control bar. Replace the `Durasi` metric cell:

```tsx
          <MetricCell label="Durasi">{useLiveDuration(run)}</MetricCell>
```

and add this hook above `RunDetail` (ticks once a second while the run is active):

```tsx
function useLiveDuration(run: RunVM): string {
  const running = run.status === "running" || run.status === "paused";
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return fmtDuration(runDurationMs(run, running ? now : Date.now()));
}
```

- Add a control bar inside `RunDetail`, right after `<LogView run={run} />`, shown only for active runs:

```tsx
      {(run.status === "running" || run.status === "paused") && <RunControls run={run} />}
```

and define `RunControls` above `RunDetail`:

```tsx
function RunControls({ run }: { run: RunVM }) {
  const [text, setText] = React.useState("");
  const send = async () => { const t = text.trim(); if (!t) return; setText(""); await api.runCommand(run.id, t); };
  const ctl = (action: "pause" | "resume" | "stop") => () => { void api.runControl(run.id, action); };
  return (
    <Card padding={14}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder="ketik perintah / arahan untuk run… (steer, pause, resume, stop, docs <path>)"
          style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, padding: "8px 10px",
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)", background: "var(--surface-code)", color: "var(--term-fg)" }} />
        <button onClick={() => void send()} style={{ fontSize: 12 }}>Kirim</button>
        {run.status === "paused"
          ? <button onClick={ctl("resume")} style={{ fontSize: 12 }}>Resume</button>
          : <button onClick={ctl("pause")} style={{ fontSize: 12 }}>Pause</button>}
        <button onClick={ctl("stop")} style={{ fontSize: 12 }}>Stop</button>
      </div>
    </Card>
  );
}
```

(Use the design-system `Button` from `../ds` instead of raw `<button>` if it's already imported in this file; keep styling consistent with the editorial/brass system.)

- Update the header comment block at the top of the file (currently says "READ-ONLY for SPEC-001") to note the live wiring landed in SPEC-008.

- [ ] **Step 7: Run all frontend tests + typecheck**

Run: `pnpm --filter ./src test && pnpm --filter ./src typecheck`
Expected: PASS (reducer, api-client, app-default-project, and any existing frontend tests); no type errors.

- [ ] **Step 8: Real local check — live run in the browser**

Boot the full stack (`pnpm dev` from repo root — brings up Docker, API, worker, web). Start a run from the UI, open the Runs screen, and confirm: log lines stream in without reload; phase pipeline advances; tokens/cost update; the Durasi counter ticks; typing a message + Enter reaches the run (worker log shows a steer); Pause/Resume/Stop change status. Screenshot or note the observed live update.

- [ ] **Step 9: Commit**

```bash
git add src/src/screens/run-reduce.ts src/src/screens/RunsScreen.tsx src/src/screens/types.ts src/src/App.tsx src/test/run-reduce.test.ts
git commit -m "feat(web): live run stream + controls + real duration in RunsScreen (SPEC-008)"
```

---

## Phase 3 — Remove the prototype dataset

### Task 7 — Migrate tests to the factory; delete proto-data/seed (Phase 3)

Mechanical but per-file: each test currently calls `seed()` and asserts against prototype ids. Switch each to `resetDb()` + the minimal factory rows it references, then delete the prototype files. **One file at a time, green before the next.**

**Files:**
- Modify (migrate off `seed`): all 19 files listed below.
- Delete: `server/prisma/proto-data.ts`, `server/prisma/proto-doc-content.ts`, `server/prisma/seed.ts`, `server/test/seed.test.ts`.

**Interfaces:**
- Consumes: `resetDb`, `make*` (Task 1).

**Per-file migration procedure (apply to each):**
1. Replace `import { seed } from "../prisma/seed";` with `import { resetDb, makeProject, makeRun, … } from "./factory";` (import only the builders that file needs).
2. Replace `await seed();` in `beforeAll`/`beforeEach` with `await resetDb();` followed by the specific `make*` calls creating the rows this file asserts on.
3. Read the file's current assertions and replace every prototype id (`loka-pos`, `arta`, `sembada`, `wanara`, `candra`, `gapura`, `SPEC-1xx`, `RUN-8842`, `t1`–`t6`) and every count that depended on the seed's fixed dataset (e.g. `toBe(5)` runs, `toBe(6)` projects) with the ids/counts this file now creates. Prefer `beforeEach` + a fresh minimal set per test to keep counts obvious.
4. Run that one file green before moving on.

- [ ] **Step 1: Worked example — migrate `runs.route.test.ts`**

Replace the top of `server/test/runs.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun } from "./factory";
const app = buildApp();
beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
});
describe("runs routes", () => {
  it("lists runs", async () => expect((await app.inject({ url: "/api/runs" })).json().length).toBe(1));
  it("gets a run with phases", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1" });
    expect(res.json().phases.length).toBeGreaterThan(0);
  });
  it("404 for missing run", async () =>
    expect((await app.inject({ url: "/api/runs/RUN-0000" })).statusCode).toBe(404));
  it.each(["steer","control","worktree","command"])("run-%s control path resolves (SPEC-003)", async (a) => {
    expect((await app.inject({ method: "POST", url: `/api/runs/RUN-1/${a}`, payload: {} })).statusCode).not.toBe(404);
  });
  it("SSE log endpoint streams event-stream (SPEC-003)", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1/log", headers: { accept: "text/event-stream" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
  });
});
```

Run: `pnpm --filter ./server test runs.route` → PASS. Then `git commit -m "test(server): migrate runs.route off proto seed (SPEC-008)"`.

- [ ] **Step 2: Migrate the remaining files (one commit per file or a small batch)**

Apply the procedure to each; run that file green before the next:

- [ ] `server/test/docs.route.test.ts` — needs a project + docFiles (its `beforeAll` seeds docs; recreate the specific `path`/`category`/`linked` rows it asserts on).
- [ ] `server/test/docs.test.ts` — project + docFiles for `docIndex`/`readDoc`/`writeDoc`.
- [ ] `server/test/fire-trigger.test.ts` — project + spec(s) at `spec-ready`/`planned` + trigger + `makeSetting()`.
- [ ] `server/test/id.test.ts` — a few specs/runs so `nextSpecId`/`nextRunId` compute the next id; assert against the ids you create (respect the `SPEC-140+`/`RUN-8800+` floors in `services/id.ts`).
- [ ] `server/test/project-view.test.ts` — project + specs + runs; assert the derived view off created rows.
- [ ] `server/test/projects.route.test.ts` — project(s); adjust list counts.
- [ ] `server/test/queue-durability.test.ts` — project + `makeSetting()` + run(s) as the enqueue path needs.
- [ ] `server/test/queue.test.ts` — project + `makeSetting()` (budget) + run.
- [ ] `server/test/runs-control.test.ts` — project + run in a controllable state + `makeSetting()`.
- [ ] `server/test/runs-queue-integration.test.ts` — project + `makeSetting()` + run.
- [ ] `server/test/runs-sse.test.ts` — project + run; keep the SSE assertions.
- [ ] `server/test/schedules.test.ts` — project + trigger(s) (schedule/interval detail valid).
- [ ] `server/test/specs.route.test.ts` — project; adjust spec list/create assertions.
- [ ] `server/test/trigger-validate.test.ts` — project; create triggers with the details it validates.
- [ ] `server/test/triggers-settings.route.test.ts` — project + `makeSetting()`; adjust trigger + settings assertions.
- [ ] `server/test/webhooks.test.ts` — project with `repoUrl` matching the webhook payload + commit trigger; recreate the installation/trigger rows it maps.
- [ ] `server/test/worker.test.ts` — project + `makeSetting()` + run for `runProcessor`.

- [ ] **Step 3: Delete the prototype files + seed test**

Once no test imports `seed`:

```bash
git rm server/prisma/proto-data.ts server/prisma/proto-doc-content.ts server/prisma/seed.ts server/test/seed.test.ts
```

- [ ] **Step 4: Verify nothing references the deleted files**

Run: `grep -rn "prisma/seed\|proto-data\|proto-doc-content" server --include="*.ts"`
Expected: no matches.

- [ ] **Step 5: Full server suite green**

Run: `pnpm --filter ./server test && pnpm --filter ./server typecheck`
Expected: all green; no `seed`/`proto-*` import errors.

- [ ] **Step 6: Commit**

```bash
git add server/test
git rm server/prisma/proto-data.ts server/prisma/proto-doc-content.ts server/prisma/seed.ts server/test/seed.test.ts
git commit -m "test(server): drop prototype seed dataset; tests build via factory (SPEC-008)"
```

---

### Task 8 — Docs sweep + final green (Phases 1–3)

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Verify: `internal/docs/README.md` (ADR-0007 linked in Task 4)

- [ ] **Step 1: Note the live run view in the frontend doc**

In `internal/docs/frontend/frontend-implementation.md`, add a short section:

```markdown
## Live run view (SPEC-008)
`RunsScreen` subscribes to `GET /runs/:id/log` (SSE) for running/paused runs via
`subscribeRun`; live `log`/`phase`/`status`/`cost`/`file` events merge through the pure
`reduceRunEvent`. The control bar drives `POST /runs/:id/command` (free text → steer) and
`/control` (pause/resume/stop). Duration is `(finishedAt ?? now) − createdAt` (ADR-0007),
ticking live while running.
```

- [ ] **Step 2: Full repo green + typecheck**

Run: `pnpm -r typecheck && pnpm test`
Expected: all packages typecheck; the whole vitest suite (server + frontend) passes with no `seed`/`proto-*` references and no fabricated-terminal or prototype-id assertions.

- [ ] **Step 3: Real end-to-end check**

Boot `pnpm dev`, create a project + start a run, and confirm the full de-mocked flow: terminal `resume`/free-text/`docs` behave truthfully (Task 2), the Runs screen streams live with working controls and a ticking duration (Task 6), and a fresh DB has no prototype projects (Task 3 + 7).

- [ ] **Step 4: Commit**

```bash
git add internal/docs/frontend/frontend-implementation.md
git commit -m "docs: live run view + de-mock sweep notes (SPEC-008)"
```

---

## Self-Review

**1. Spec coverage** — DoD/acceptance → task mapping:
- AC1 (no fabricated reply; free text → steer; inactive → says so) → Task 2 (Steps 4/6, tests).
- AC2 (`resume`/`retry` re-enqueue via shared `applyControl`, 409 on budget) → Task 2 (Steps 3/6, test).
- AC3 (`docs` reads real file) → Task 2 (Step 4, test).
- AC4 (no prototype ids in `App.tsx`) → Task 3.
- AC5 (RunsScreen live: log/phase/status/cost/file; closes on terminal) → Task 5 (`subscribeRun`) + Task 6 (`reduceRunEvent`, effect wiring).
- AC6 (controls drive real endpoints) → Task 6 (`RunControls`) + Task 5 (wrappers).
- AC7 (`finishedAt` + migration + ADR + real duration) → Task 4 + Task 6 (`runDurationMs`/`fmtDuration`/`useLiveDuration`).
- AC8 (delete proto-data/seed; factory) → Task 1 (factory) + Task 7 (migrate + delete).
- AC9 (suites + typecheck green) → Task 7 Step 5, Task 8 Step 2.
- AC10 (docs + ADR-0007 linked) → Task 4 (ADR + README) + Task 8 (frontend doc).

**2. Placeholder scan** — no TBD/TODO. The only non-verbatim work is Task 7 Step 2, which is intentionally per-file (each test's assertions differ); it carries a full worked example (Step 1), an explicit procedure, and an enumerated checklist of all 19 files with each file's data needs — not a "similar to Task N" hand-wave.

**3. Type consistency** — `applyControl(run, action)` returns `{ ok: true } | { ok: false; reason }` and is used identically in `/control` and `/command`. `runCommand(run, text, active): Promise<Line[]>` is async at both its definition and its one call site. `RunLiveEvent` is defined once (Task 5, `api/client.ts`) and consumed by `subscribeRun`, `reduceRunEvent`, and the tests with the same variants. `runDurationMs(run, now)` / `fmtDuration(ms)` signatures match across Task 6 definition, test, and `useLiveDuration`. `RunVM` loses `duration` in Task 6 (types.ts) and every setter (`App.tsx`) and reader (`RunDetail`) is updated in the same task. `zRun` gains `createdAt`/`finishedAt` (Task 4) which `RunVM` (= `Run & …`) then carries for the duration helpers.

**Executor notes:** Tests share one Postgres DB, so the suite runs with `--no-file-parallelism` (root `pnpm test`) and each migrated file should `resetDb()` in `beforeEach` (not just `beforeAll`) when its tests mutate rows, to stay isolated. Task 4's migration and Task 7's deletions need Postgres up (`docker compose up -d --wait`). `subscribeRun` uses the browser-native `EventSource`; it is exercised in tests via a fake global (Task 5), and the reducer is tested purely (Task 6) — no jsdom `EventSource` dependency.
