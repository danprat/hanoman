# Spec Stage as a Live Mirror of a Real Run (SPEC-009) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a backlog spec's `stage` a read-only mirror of a real Run's phases, so a spec advances only when actual Claude Code work happens — killing the cosmetic "advance" button that let specs jump to `executing` with nothing done.

**Architecture:** Starting work on a spec enqueues one real Run (existing `POST /runs`, `flow` from `spec.source`, tied to `specId`). As the runner emits real `phase`/`status` events, `persistEvent` — the single choke point every run event flows through — advances the linked spec's stage (monotonic forward). The fake `advance()` stage-machine, its route, and its UI button are removed.

**Tech Stack:** Node + TypeScript (Fastify, Prisma/Postgres, BullMQ/Redis) server; React + TS (Vite) web; Vitest. Monorepo packages: `server`, `runner`, `shared`, `src` (web).

## Global Constraints

- TypeScript strict everywhere. Orchestration logic (the stage mirror) MUST have tests.
- **No schema change** in this spec — `Spec.stage` and `Run.specId` already exist. (If that ever changes: migration + ADR, per CLAUDE.md.)
- Update touched `internal/docs/**` **in the same commit** as the code (Source of Truth rule).
- Do not bypass the Source-of-Truth guardrail (`deps.verify` on Execute) — this plan relies on it, never disables it.
- Never run a run in the main working tree — unchanged; the runner already uses `.worktrees/`.
- **Stage mirror mapping** (the contract, copied verbatim into Task 1):
  | Run event | Spec stage becomes |
  |---|---|
  | `phase Objective done` (feature) / `phase Audit done` (qa) | `objective` |
  | `phase Spec done` | `spec-ready` |
  | `phase Plan done` | `planned` |
  | `phase Execute active` | `executing` |
  | `status done` | `done` |
  | `phase Brainstorm done` | *(no change — still `brainstorming`)* |
  Advance is **monotonic forward only**: an event whose target stage is at or before the current stage is ignored. Events on a run with `specId === null` are ignored.

---

## File Structure

| File | Change | Responsibility after change |
|---|---|---|
| `server/src/runner/events-io.ts` | Modify | Persist run events **and** mirror `phase`/`status` events onto the linked spec's stage |
| `server/test/events-io.test.ts` | Modify | Cover finishedAt (existing) + stage mirroring (new) |
| `server/src/routes/specs.ts` | Modify | CRUD only — `/advance` route removed |
| `server/src/services/stage-machine.ts` | Modify | `STAGES` + `nextStage` ordering primitives only — `advance()`/`TOAST` removed |
| `server/src/app.ts` | Modify | Comment fix (drop stale "advance" mention) |
| `server/test/stage-machine.test.ts` | Modify | Test ordering only — `advance` assertions removed |
| `server/test/specs.route.test.ts` | Modify | CRUD tests only — advance tests removed |
| `shared/src/api.ts` | Modify | Path map — `advance` entry removed |
| `shared/src/dto.ts` | Modify | `zAdvanceResult` removed (unused) |
| `src/src/api/client.ts` | Modify | `advanceSpec` → `startRun` |
| `src/src/App.tsx` | Modify | `startRun` handler, active-run set, live poll; `advanceSpec`/`ADV_TOAST` removed |
| `src/src/screens/BacklogScreen.tsx` | Modify | Card action = Mulai / Buka run / done badge |
| `src/test/app-flows.test.tsx` | Modify | Mock `startRun` instead of `advanceSpec` |
| `src/test/api-client.test.ts` | Modify | Add `startRun` client test |
| `internal/docs/architecture/api-contract.md` | Modify | Remove `/advance`; note stage is run-driven |
| `internal/docs/adr/0008-stage-mirrors-run.md` | Create | ADR for the mechanism + endpoint removal |

---

## Task 1: Stage mirror in `persistEvent`

The core. A pure `mirrorStage()` plus a small DB helper wired into `persistEvent`. No Redis needed — tests hit Postgres via the factory.

**Files:**
- Modify: `server/src/runner/events-io.ts`
- Test: `server/test/events-io.test.ts`

**Interfaces:**
- Consumes: `STAGES` from `server/src/services/stage-machine.ts`; `Stage` from `@hanoman/shared`; `RunEvent` from `@hanoman/runner`; `prisma` from `../db`; factory helpers `resetDb, makeProject, makeSpec, makeRun`.
- Produces: `export function mirrorStage(current: Stage, e: RunEvent): Stage | null`. `persistEvent(runId, e)` gains the side effect of advancing the linked spec on `phase`/`status` events.

- [x] **Step 1: Write the failing tests** — append to `server/test/events-io.test.ts`:

```ts
import { makeSpec } from "./factory";
import { mirrorStage } from "../src/runner/events-io";

describe("mirrorStage (SPEC-009, pure)", () => {
  it("maps Objective done -> objective", () =>
    expect(mirrorStage("brainstorming", { kind: "phase", name: "Objective", state: "done" })).toBe("objective"));
  it("maps Audit done -> objective (qa)", () =>
    expect(mirrorStage("brainstorming", { kind: "phase", name: "Audit", state: "done" })).toBe("objective"));
  it("maps Spec done -> spec-ready", () =>
    expect(mirrorStage("objective", { kind: "phase", name: "Spec", state: "done" })).toBe("spec-ready"));
  it("maps Plan done -> planned", () =>
    expect(mirrorStage("spec-ready", { kind: "phase", name: "Plan", state: "done" })).toBe("planned"));
  it("maps Execute active -> executing", () =>
    expect(mirrorStage("planned", { kind: "phase", name: "Execute", state: "active" })).toBe("executing"));
  it("maps status done -> done", () =>
    expect(mirrorStage("executing", { kind: "status", status: "done" })).toBe("done"));
  it("does not move on Brainstorm done", () =>
    expect(mirrorStage("brainstorming", { kind: "phase", name: "Brainstorm", state: "done" })).toBeNull());
  it("never moves backward", () =>
    expect(mirrorStage("planned", { kind: "phase", name: "Objective", state: "done" })).toBeNull());
  it("ignores non-terminal status", () =>
    expect(mirrorStage("planned", { kind: "status", status: "running" })).toBeNull());
});

describe("persistEvent stage mirror (SPEC-009, db)", () => {
  beforeEach(async () => {
    await resetDb(); await makeProject();
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "brainstorming" });
  });

  it("advances the linked spec on a phase-done event", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", specId: "SPEC-1", status: "running" });
    await persistEvent("RUN-1", { kind: "phase", name: "Objective", state: "done" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-1" } });
    expect(spec.stage).toBe("objective");
  });

  it("marks the spec done on a terminal status", async () => {
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "executing" });
    await makeRun({ id: "RUN-2", projectId: "p1", specId: "SPEC-2", status: "running" });
    await persistEvent("RUN-2", { kind: "status", status: "done" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-2" } });
    expect(spec.stage).toBe("done");
  });

  it("leaves specs untouched for a run with no specId", async () => {
    await makeRun({ id: "RUN-3", projectId: "p1", specId: null, status: "running" });
    await persistEvent("RUN-3", { kind: "phase", name: "Objective", state: "done" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-1" } });
    expect(spec.stage).toBe("brainstorming");
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hanoman/server test events-io`
Expected: FAIL — `mirrorStage is not a function` (not exported yet).

- [x] **Step 3: Implement `mirrorStage` + wiring** in `server/src/runner/events-io.ts`.

Add imports at the top (after the existing imports):

```ts
import { STAGES } from "../services/stage-machine";
import type { Stage } from "@hanoman/shared";
```

Add, above `persistEvent`:

```ts
// A spec's stage is a read-only mirror of its run's phases (SPEC-009): each real
// phase/status event maps to the stage the spec should now sit in. Forward only —
// a re-run or a late/out-of-order event can never pull a spec backward.
const PHASE_DONE_STAGE: Record<string, Stage> = {
  Objective: "objective",   // feature: objective locked
  Audit: "objective",       // qa: audit ≈ objective locked
  Spec: "spec-ready",
  Plan: "planned",
  // Brainstorm done → no bump; the spec stays "brainstorming" until Objective locks.
};

export function mirrorStage(current: Stage, e: RunEvent): Stage | null {
  let target: Stage | null = null;
  if (e.kind === "phase" && e.state === "done") target = PHASE_DONE_STAGE[e.name] ?? null;
  else if (e.kind === "phase" && e.state === "active" && e.name === "Execute") target = "executing";
  else if (e.kind === "status" && e.status === "done") target = "done";
  if (!target) return null;
  return STAGES.indexOf(target) > STAGES.indexOf(current) ? target : null;
}

// Advance the run's linked spec if this event moves it forward. No-op when the run
// has no specId. Callers are serialized per run (worker chains persists), so no race.
async function mirrorSpecStage(runId: string, e: RunEvent): Promise<void> {
  const run = await prisma.run.findUnique({ where: { id: runId }, select: { specId: true } });
  if (!run?.specId) return;
  const spec = await prisma.spec.findUnique({ where: { id: run.specId }, select: { stage: true } });
  if (!spec) return;
  const next = mirrorStage(spec.stage as Stage, e);
  if (next) await prisma.spec.update({ where: { id: run.specId }, data: { stage: next } });
}
```

Then, at the **end** of `persistEvent` (after the existing `if/else if` chain, before the function closes), add:

```ts
  if (e.kind === "phase" || e.kind === "status") await mirrorSpecStage(runId, e);
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hanoman/server test events-io`
Expected: PASS — all `mirrorStage` + `persistEvent stage mirror` cases green, existing finishedAt cases still green.

- [x] **Step 5: Commit**

```bash
git add server/src/runner/events-io.ts server/test/events-io.test.ts
git commit -m "feat(server): spec stage mirrors real run phases (SPEC-009)"
```

---

## Task 2: Frontend — start a real run, drop the fake advance

The backlog card's single button becomes **Mulai** (start a run) / **Buka run** (open the live terminal) / **done badge**. The stage bar is unchanged — it moves because `Spec.stage` in the DB now really changes; the board polls while any run is active.

**Files:**
- Modify: `src/src/api/client.ts`, `shared/src/api.ts`, `src/src/App.tsx`, `src/src/screens/BacklogScreen.tsx`
- Test: `src/test/api-client.test.ts`, `src/test/app-flows.test.tsx`

**Interfaces:**
- Consumes: existing `POST /runs` (`paths.runs`), which returns `202 { runId }` or `409 { reason }` (daily budget). `Run.specId`, `Run.status` on the runs list already loaded in `App`.
- Produces: `api.startRun({ project, flow, specId }): Promise<{ runId: string }>`. `BacklogScreen` prop shape: `onStart(spec)`, `activeRunSpecs: Set<string>`, `onOpenRun(spec)`, `onDelete(spec)` (no more `onAdvance`).

- [x] **Step 1: Write the failing api-client test** — replace the `advanceSpec`-era gap in `src/test/api-client.test.ts` by adding this test inside the existing `describe`:

```ts
  it("startRun posts flow + specId to the runs path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ runId: "RUN-9" }), { status: 202, headers: { "content-type": "application/json" } }));
    const res = await api.startRun({ project: "p1", flow: "feature", specId: "SPEC-1" });
    expect(res.runId).toBe("RUN-9");
    expect(fetchMock).toHaveBeenCalledWith(paths.runs, expect.objectContaining({ method: "POST" }));
  });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test api-client` (if the web package name differs, use `pnpm --dir src test api-client`)
Expected: FAIL — `api.startRun is not a function`.

- [x] **Step 3: Remove `paths.advance`** in `shared/src/api.ts` — delete this line:

```ts
  advance: (id: string) => `${API}/specs/${id}/advance`,
```

- [x] **Step 4: Swap `advanceSpec` → `startRun`** in `src/src/api/client.ts` — delete:

```ts
  advanceSpec: (id: string) => j<{ id: string; stage: string }>(paths.advance(id), { method: "POST" }),
```

and add (next to the other run methods):

```ts
  startRun: (b: { project: string; flow: "feature" | "qa"; specId: string }) =>
    j<{ runId: string }>(paths.runs, { method: "POST", ...body(b) }),
```

- [x] **Step 5: Run the api-client test to verify it passes**

Run: `pnpm --filter web test api-client`
Expected: PASS.

- [x] **Step 6: Rewire `App.tsx`.** Delete the whole `advanceSpec` function (currently lines ~315–323) and the trailing `ADV_TOAST` map + `advToast` function (bottom of file). Add the `startRun` handler where `advanceSpec` was:

```ts
  async function startRun(spec: Spec) {
    try {
      const { runId } = await api.startRun({
        project: spec.projectId,
        flow: spec.source === "qa" ? "qa" : "feature",
        specId: spec.id,
      });
      setRuns(await api.listRuns());
      showToast(spec.id + " · run " + runId + " dimulai", "info", "play");
      setSection("runs");
    } catch (e) {
      const budget = e instanceof ApiError && e.status === 409;
      showToast(spec.id + " · gagal mulai run" + (budget ? " · budget harian tercapai" : ""), "warn", "x-circle");
    }
  }
```

Add the active-run set and the live poll (place with the other `useMemo`s / effects, after the initial-load effect):

```ts
  const activeRunSpecs = React.useMemo(
    () => new Set(runs.filter((r) => r.specId && (r.status === "running" || r.status === "paused"))
      .map((r) => r.specId as string)),
    [runs]);

  // Stage bar is a live mirror: while any run is active, re-poll specs+runs so the
  // board reflects real phase progress. Stops when nothing is running.
  const anyRunActive = runs.some((r) => r.status === "running" || r.status === "paused");
  React.useEffect(() => {
    if (!anyRunActive) return;
    const t = setInterval(() => {
      Promise.all([api.listSpecs(), api.listRuns()])
        .then(([s, r]) => { setBacklog(s); setRuns(r); })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [anyRunActive]);
```

Update the `BacklogScreen` usage (in the `section === "backlog"` block) — replace `onAdvance={advanceSpec}` with the new props:

```tsx
        <BacklogScreen backlog={backlog} projects={projectsView} pageSize={4}
          onStart={startRun} activeRunSpecs={activeRunSpecs}
          onDelete={deleteSpec} onOpenRun={() => setSection("runs")} />
```

- [x] **Step 7: Rewire `BacklogScreen.tsx`.** Delete the `B_ACTION` map (lines ~8–15). Change `SpecCard`'s props and action block. Replace the `SpecCard` signature + the `const act = B_ACTION[spec.stage];` line and the action `<Button>`/badge block with:

```tsx
function SpecCard({ spec, onStart, onDelete, onOpenRun, running }:
  { spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; running?: boolean }) {
  const qa = spec.source === "qa";
  const prio = B_PRIO[spec.priority] || B_PRIO.sedang!;
```

Then, inside the footer actions `<div>` (the block that currently renders `{act && (...)}` and the done badge), replace with:

```tsx
            {spec.stage !== "done" && running && (
              <Button size="sm" variant="secondary" leftIcon="activity" onClick={() => onOpenRun && onOpenRun(spec)}>
                Buka run
              </Button>
            )}
            {spec.stage !== "done" && !running && (
              <Button size="sm" variant="primary" leftIcon="play" onClick={() => onStart && onStart(spec)}>
                {spec.stage === "brainstorming" ? "Mulai" : "Jalankan lagi"}
              </Button>
            )}
            {spec.stage === "done" && <Badge tone="ok" size="sm" icon="check-circle-2">selesai</Badge>}
            {onDelete && <IconButton size="sm" variant="ghost" icon="trash-2" label="Hapus spec" onClick={() => onDelete(spec)} />}
```

Update the `BacklogScreen` component signature + the `SpecCard` render call:

```tsx
export function BacklogScreen({ backlog, projects, pageSize = 4, onStart, activeRunSpecs, onDelete, onOpenRun }:
  { backlog: Spec[]; projects: ProjectVM[]; pageSize?: number;
    onStart?: (s: Spec) => void; activeRunSpecs?: Set<string>;
    onDelete?: (s: Spec) => void; onOpenRun?: (s: Spec) => void }) {
```

and the map:

```tsx
            {pg.pageItems.map((s) => <SpecCard key={s.id} spec={s} onStart={onStart}
              running={activeRunSpecs?.has(s.id)} onDelete={onDelete} onOpenRun={onOpenRun} />)}
```

- [x] **Step 8: Update `app-flows.test.tsx` mock** — in `src/test/app-flows.test.tsx`, change the mocked `api` object: replace `advanceSpec: vi.fn(),` with `startRun: vi.fn(), deleteSpec: vi.fn(),`.

- [x] **Step 9: Run the web tests to verify they pass**

Run: `pnpm --filter web test`
Expected: PASS — api-client, app-flows, and the rest green; no `advanceSpec`/`paths.advance` references remain.

- [x] **Step 10: Typecheck the web + shared packages**

Run: `pnpm --filter web build` (or the repo's `pnpm -r typecheck` if defined)
Expected: no TS errors (confirms nothing else referenced `advanceSpec`/`paths.advance`).

- [x] **Step 11: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/src/App.tsx src/src/screens/BacklogScreen.tsx src/test/api-client.test.ts src/test/app-flows.test.tsx
git commit -m "feat(web): backlog starts a real run; stage bar mirrors it (SPEC-009)"
```

---

## Task 3: Backend cleanup + docs

Remove the dead fake-advance surface now that nothing calls it, and update the Source of Truth in the same commit.

**Files:**
- Modify: `server/src/routes/specs.ts`, `server/src/services/stage-machine.ts`, `server/src/app.ts`, `shared/src/dto.ts`
- Modify: `server/test/specs.route.test.ts`, `server/test/stage-machine.test.ts`
- Modify: `internal/docs/architecture/api-contract.md`
- Create: `internal/docs/adr/0008-stage-mirrors-run.md`

**Interfaces:**
- Consumes: nothing new. `STAGES` + `nextStage` remain exported from `stage-machine.ts` (`STAGES` is still used by `project-view.ts`).
- Produces: `stage-machine.ts` no longer exports `advance`; `/specs/:id/advance` no longer exists; `zAdvanceResult` removed from `shared`.

- [x] **Step 1: Prune the obsolete tests first.** In `server/test/stage-machine.test.ts`, remove the import of `advance` and the two `advance(...)` assertions, leaving ordering tests. The file becomes:

```ts
import { describe, it, expect } from "vitest";
import { STAGES, nextStage } from "../src/services/stage-machine";
describe("stage machine", () => {
  it("orders the six stages", () =>
    expect(STAGES).toEqual(["brainstorming","objective","spec-ready","planned","executing","done"]));
  it("advances brainstorming -> objective", () => expect(nextStage("brainstorming")).toBe("objective"));
  it("returns null at terminal done", () => expect(nextStage("done")).toBeNull());
});
```

In `server/test/specs.route.test.ts`, delete the two advance tests (`"advances a spec"` and `"409 advancing a done spec"`). Keep filter/create/delete.

- [x] **Step 2: Run those tests to verify they still pass (and no longer reference advance)**

Run: `pnpm --filter @hanoman/server test stage-machine specs.route`
Expected: PASS — the remaining assertions are green; nothing imports `advance`.

- [x] **Step 3: Remove `advance()` + `TOAST`** from `server/src/services/stage-machine.ts`. The file becomes:

```ts
import type { Stage } from "@hanoman/shared";
export const STAGES = ["brainstorming","objective","spec-ready","planned","executing","done"] as const;
export function nextStage(current: Stage): Stage | null {
  const i = STAGES.indexOf(current);
  return i < 0 || i >= STAGES.length - 1 ? null : STAGES[i + 1]!;
}
```

- [x] **Step 4: Remove the advance route** from `server/src/routes/specs.ts` — delete the `import { advance } from "../services/stage-machine";` line and the entire `app.post("/specs/:id/advance", ...)` handler (leaving GET/POST-create/DELETE).

- [x] **Step 5: Fix the stale comment** in `server/src/app.ts` — change the body-less-POST comment (line ~16) from `// Body-less POSTs (scan / advance / toggle) may still carry a JSON` to `// Body-less POSTs (scan / toggle) may still carry a JSON`.

- [x] **Step 6: Remove `zAdvanceResult`** from `shared/src/dto.ts` — delete the line `export const zAdvanceResult = z.object({ id: z.string(), stage: zStage });`.

- [x] **Step 7: Update `internal/docs/architecture/api-contract.md`** — replace the line:

```
POST /specs/:id/advance   # kunci objective / tulis spec / plan / execute
```

with:

```
# (dihapus) stage tak lagi dinaikkan manual — POST /runs { specId } memulai run,
# dan Spec.stage dicerminkan dari fase run nyata (lihat ADR-0008).
```

- [x] **Step 8: Write ADR-0008** — create `internal/docs/adr/0008-stage-mirrors-run.md`:

```markdown
# ADR-0008 — Spec stage mirrors a real run

**Status:** accepted · 2026-07-08 · SPEC-009

## Context
`Spec.stage` was advanced by `POST /specs/:id/advance` → `advance()`, a linear
counter with no real work behind it. A spec could reach `executing`/`done` while
brainstorming never happened. The real lifecycle already exists inside a Run:
`runner` pipelines run `Brainstorm → Objective → Spec → Plan → Execute` (feature)
as real Claude Code work in a worktree.

## Decision
`Spec.stage` becomes a read-only mirror of its run's phases. Starting work enqueues
one real Run (`POST /runs`, flow from `spec.source`, tied to `specId`). `persistEvent`
maps `phase`/`status` events to the spec's stage, monotonic-forward only. The manual
`advance()` function and `POST /specs/:id/advance` route are removed.

Mapping: `Objective`/`Audit` done → `objective`; `Spec` done → `spec-ready`;
`Plan` done → `planned`; `Execute` active → `executing`; run `done` → `done`.
`Brainstorm` done does not move the stage.

## Consequences
- `executing`/`done` are unreachable without a real run passing the Source-of-Truth
  guardrail (`deps.verify` on Execute). Skipping stages is structurally impossible.
- No schema change (`Spec.stage`, `Run.specId` already exist).
- Simplification: QA specs reuse the 6-stage bar; `Audit` maps to `objective`
  (the bar visually jumps `brainstorming → objective` for QA). Upgrade: per-flow bar.
```

- [x] **Step 9: Run the full server suite**

Run: `pnpm --filter @hanoman/server test`
Expected: PASS — no test references the removed `advance`/route; events-io mirroring green.

- [x] **Step 10: Commit**

```bash
git add server/src/routes/specs.ts server/src/services/stage-machine.ts server/src/app.ts shared/src/dto.ts server/test/specs.route.test.ts server/test/stage-machine.test.ts internal/docs/architecture/api-contract.md internal/docs/adr/0008-stage-mirrors-run.md
git commit -m "refactor(server): remove fake advance; docs + ADR-0008 (SPEC-009)"
```

---

## Task 4: Real local verification (required by CLAUDE.md)

Prove it end-to-end against a booted server, not just unit tests.

> ⚠️ **Caution (see project memory):** if a dev **worker** is running with Claude credentials, `POST /runs` executes a REAL, billable background run. For verification, either (a) run with **no worker** — the enqueue still returns `202` and the run sits queued, then delete it; or (b) knowingly run one real cheap run. The deterministic proof of stage-mirroring is Task 1's integration test; the curl below proves the enqueue + linkage.

- [x] **Step 1: Full test suite**

Run: `pnpm -r test` (or `pnpm test` at root)
Expected: all packages PASS.

- [x] **Step 2: Boot the server** (build + run, or `pnpm dev`)

Run: `pnpm --filter @hanoman/server build && node server/dist/server.js`
Expected: server listening; no credential/boot errors for the API process.

- [x] **Step 3: Seed a project + a brainstorming spec via the API**

```bash
BASE=http://localhost:3000/api   # adjust port to your env
PID=$(curl -s -X POST $BASE/projects -H 'content-type: application/json' \
  -d '{"name":"verify009","kind":"existing","repoDir":"'"$PWD"'","desc":"spec-009 check"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
SID=$(curl -s -X POST $BASE/specs -H 'content-type: application/json' \
  -d '{"project":"'"$PID"'","source":"brief","title":"verify stage mirror","priority":"sedang","payload":{"context":"c","outcome":"o","constraints":"","priority":"sedang"}}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo "project=$PID spec=$SID"
```

Expected: a `SPEC-n` id printed; `GET $BASE/specs?project=$PID` shows it at `stage:"brainstorming"`.

- [x] **Step 4: Confirm the fake advance endpoint is gone**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/specs/$SID/advance
```

Expected: `404` (route removed).

- [x] **Step 5: Start a run for the spec and confirm linkage**

```bash
curl -s -X POST $BASE/runs -H 'content-type: application/json' \
  -d '{"project":"'"$PID"'","flow":"feature","specId":"'"$SID"'"}'
curl -s "$BASE/runs?project=$PID" | node -pe 'JSON.parse(require("fs").readFileSync(0)).map(r=>({id:r.id,kind:r.kind,specId:r.specId,status:r.status}))'
```

Expected: first call returns `202 {"runId":"RUN-n"}` (or `409 {"reason":...}` if the daily budget is already spent — also a valid, real result). The runs list shows a run with `kind:"feature"`, `specId:"<SID>"`.

- [x] **Step 6: (If a worker + credentials are up) confirm the stage moved**

```bash
curl -s "$BASE/specs?project=$PID" | node -pe 'JSON.parse(require("fs").readFileSync(0)).map(s=>({id:s.id,stage:s.stage}))'
```

Expected (worker running a real run): the spec's `stage` advances past `brainstorming` as phases complete (`objective` → `spec-ready` → …). Without a worker: stage stays `brainstorming` and the run stays `queued` — mirroring is already proven deterministically by Task 1. Clean up the queued test run/project afterward if desired.

- [x] **Step 7: Tick the plan + spec checklists, then final commit if any doc ticks changed**

Mark completed steps `- [x]` in this plan file. Commit only if the file changed:

```bash
git add docs/superpowers/plans/2026-07-08-hanoman-stage-live-mirror-spec-009.md
git commit -m "docs: tick SPEC-009 plan checklist"
```

---

## Self-Review

**Spec coverage:**
- §1 stage mirroring (mapping table, monotonic-forward, specId guard) → Task 1. ✅
- §2 start run from backlog (Mulai / Buka run / done; flow from source; poll live) → Task 2. ✅
- §3 removals (advance()/route/zAdvanceResult/api.advanceSpec/App handler/paths.advance) → Tasks 2–3. ✅
- §4 guardrail alignment (nothing bypassed; Execute still `deps.verify`) → inherent; asserted in ADR-0008 (Task 3). ✅
- §5 tests (unit mirrorStage, integration persistEvent, real API curl) → Tasks 1 + 4. ✅
- §simplification (QA reuses 6-stage bar, Audit→objective) → encoded in `PHASE_DONE_STAGE` (Task 1) + ADR (Task 3). ✅
- Docs-in-same-commit → api-contract + ADR-0008 in Task 3. ✅

**Placeholder scan:** none — every code/test/curl step shows full content.

**Type consistency:** `mirrorStage(current: Stage, e: RunEvent): Stage | null` used identically in Task 1 test and impl. `startRun({ project, flow, specId })` identical in client (Task 2 Step 4), api-client test (Step 1), and App handler (Step 6). `BacklogScreen` props (`onStart`, `activeRunSpecs`, `onOpenRun`, `onDelete`) consistent across App usage (Step 6), component signature and render (Step 7). `STAGES`/`nextStage` kept and imported where used (`project-view.ts`, `events-io.ts`).
