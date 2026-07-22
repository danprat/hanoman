# Source-checker Backlog (SPEC-295) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Register a `backlog` source-checker in the scheduler foundation that enqueues every not-yet-started `Spec` (`baseSha === null`) from opt-in projects, ordered by priority, idempotently.

**Architecture:** New thin module `services/scheduler/sources/backlog.ts` exposes `checkBacklog()` (query opt-in ∧ `baseSha:null` specs → sort `tinggi→sedang→rendah` → `enqueue(source:"backlog")`) and `registerBacklogSource()` (calls the foundation's `registerSchedulerSource`). `server.ts` calls `registerBacklogSource()` once before `startScheduler()`. Idempotency is inherited from `enqueue`'s upsert on `specId @unique` — no extra dedup logic. Launch/drain/flow already live in the SPEC-294 governor and are untouched.

**Tech Stack:** Node + TypeScript (strict), Fastify, Prisma (Postgres), Vitest.

## Global Constraints

- **No schema change, no migration, no new ADR, no new endpoint.** Purely additive on the frozen SPEC-294/ADR-0072 contract.
- **Queue item `source` = checker id `"backlog"`** (per schema comment "asal checker"), NOT `spec.source`. Launch-time `flow` derives from `spec.source` inside the existing governor.
- **`app.ts` stays timer-free AND registration-free.** Source registration happens only in `server.ts`; tests populate the registry themselves via `registerSchedulerSource`.
- **Tests run `vitest run --no-file-parallelism`** against an isolated `_test` DB. Use a dedicated base DB to avoid sibling-truncation (`DATABASE_URL=.../hanoman295 → hanoman295_test`).
- **Docs touched in the same commit as code** (AGENTS.md): `stack.md`, `api-contract.md`, `data-model.md`.
- Priority rank map: `{ tinggi:0, sedang:1, rendah:2 }` (identical to `queue.ts`).

---

### Task 1: Backlog checker + registration (+ docs)

**Files:**
- Create: `server/src/services/scheduler/sources/backlog.ts`
- Test: `server/test/scheduler-source-backlog.test.ts`
- Modify (docs, same commit): `internal/docs/architecture/stack.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/architecture/data-model.md`

**Interfaces:**
- Consumes (from SPEC-294 foundation): `registerSchedulerSource({ id, check })` from `../registry`; `enqueue({ specId, projectId, source, priority })` from `../queue`; `prisma` from `../../../db`.
- Produces (for Task 2): `checkBacklog(): Promise<void>` and `registerBacklogSource(): void`.

- [x] **Step 1: Write the failing tests**

Create `server/test/scheduler-source-backlog.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { checkBacklog, registerBacklogSource } from "../src/services/scheduler/sources/backlog";
import { listQueue, queued } from "../src/services/scheduler/queue";
import { listSources, clearSources } from "../src/services/scheduler/registry";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const mkProject = (id: string, schedulerOptIn: boolean) =>
  prisma.project.create({ data: { id, name: id, desc: "", kind: "existing", schedulerOptIn } });
const mkSpec = (id: string, projectId: string, priority: string, baseSha: string | null = null) =>
  prisma.spec.create({ data: {
    id, projectId, title: id, source: "brief", stage: "brainstorming",
    priority, author: "test", objective: "o", baseSha,
  } });

describe("backlog source-checker", () => {
  it("enqueues baseSha=null specs only from opt-in projects", async () => {
    await mkProject("opt", true);
    await mkProject("noopt", false);
    await mkSpec("SPEC-A", "opt", "sedang");
    await mkSpec("SPEC-B", "noopt", "tinggi");   // non-opt-in → must be untouched
    await checkBacklog();
    const q = await listQueue();
    expect(q.map((x) => x.specId)).toEqual(["SPEC-A"]);
    expect(q[0]!.source).toBe("backlog");        // queue item source = checker id
    expect(q[0]!.priority).toBe("sedang");
    expect(q[0]!.status).toBe("queued");
  });

  it("orders candidates tinggi→sedang→rendah", async () => {
    await mkProject("opt", true);
    await mkSpec("SPEC-lo", "opt", "rendah");
    await mkSpec("SPEC-hi", "opt", "tinggi");
    await mkSpec("SPEC-md", "opt", "sedang");
    await checkBacklog();
    expect((await queued()).map((x) => x.specId)).toEqual(["SPEC-hi", "SPEC-md", "SPEC-lo"]);
  });

  it("skips specs already started (baseSha set)", async () => {
    await mkProject("opt", true);
    await mkSpec("SPEC-started", "opt", "tinggi", "abc123");
    await mkSpec("SPEC-fresh", "opt", "sedang");
    await checkBacklog();
    expect((await listQueue()).map((x) => x.specId)).toEqual(["SPEC-fresh"]);
  });

  it("is idempotent: double check → one row per spec; a launched item is not resurrected", async () => {
    await mkProject("opt", true);
    await mkSpec("SPEC-A", "opt", "tinggi");
    await checkBacklog();
    await checkBacklog();
    expect((await listQueue()).length).toBe(1);
    const row = (await listQueue())[0]!;
    await prisma.schedulerQueueItem.update({ where: { id: row.id }, data: { status: "launched", sessionId: "s1" } });
    await checkBacklog();                          // spec still baseSha=null, but item exists
    const after = await listQueue();
    expect(after.length).toBe(1);
    expect(after[0]!.status).toBe("launched");     // upsert update:{} → not reset to queued
  });

  it("registerBacklogSource registers a source with id 'backlog'", () => {
    registerBacklogSource();
    expect(listSources().map((s) => s.id)).toContain("backlog");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd server && env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman295' pnpm exec vitest run test/scheduler-source-backlog.test.ts`
Expected: FAIL — `Cannot find module '../src/services/scheduler/sources/backlog'`.
(First: create the `_test` DB and migrate — see Step 2a.)

- [x] **Step 2a: Ensure the isolated test DB exists & is migrated (one-time)**

```bash
PGPASSWORD=hanoman psql -h localhost -U hanoman -d postgres -c "CREATE DATABASE hanoman295_test;" 2>/dev/null || true
cd server && DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman295_test' pnpm exec prisma migrate deploy
```
(The vitest config derives `hanoman295_test` from `DATABASE_URL=.../hanoman295`. `prisma generate` should already be present from the foundation; if `prisma.schedulerQueueItem` is undefined, run `cd server && pnpm exec prisma generate`.)

- [x] **Step 3: Write the implementation**

Create `server/src/services/scheduler/sources/backlog.ts`:

```ts
import { prisma } from "../../../db";
import { registerSchedulerSource } from "../registry";
import { enqueue } from "../queue";

// SPEC-295 · daun #1 scheduler otonom (di atas fondasi SPEC-294/ADR-0072). Checker "backlog":
// enqueue semua Spec belum-mulai (baseSha=null) dari project schedulerOptIn, urut prioritas
// tinggi→sedang→rendah. Idempotensi ditanggung enqueue (upsert specId @unique) — checker tetap
// thin, tak perlu dedup manual. PRD §Source — Backlog + User Story #1.
const RANK: Record<string, number> = { tinggi: 0, sedang: 1, rendah: 2 };

export async function checkBacklog(): Promise<void> {
  // Relasi-filter schedulerOptIn:true → project non-opt-in tak pernah ikut ter-query (tak tersentuh).
  // baseSha:null = "belum-mulai" (kondisi turunan; startSpecSession menulis baseSha saat launch).
  const specs = await prisma.spec.findMany({
    where: { baseSha: null, project: { schedulerOptIn: true } },
  });
  // Urut prioritas sebelum enqueue (AC); tiebreak id agar deterministik. Himpunan kecil → sort di memori.
  specs.sort((a, b) =>
    (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of specs) {
    await enqueue({ specId: s.id, projectId: s.projectId, source: "backlog", priority: s.priority });
  }
}

export function registerBacklogSource(): void {
  registerSchedulerSource({ id: "backlog", check: checkBacklog });
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd server && env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman295' pnpm exec vitest run test/scheduler-source-backlog.test.ts`
Expected: PASS — 5 tests.

- [x] **Step 5: Update touched docs (same commit)**

In `internal/docs/architecture/api-contract.md`, in the `## Scheduler` prose block, after the sentence mentioning `registerSchedulerSource`, add:

```
> **Source-checker konkret pertama (SPEC-295):** `backlog` — saat cadence backlog jatuh-tempo, meng-enqueue
> semua `Spec` belum-mulai (`baseSha===null`) dari project `schedulerOptIn` urut prioritas `tinggi→sedang→rendah`
> (queue item `source:"backlog"`, idempoten via `specId @unique`). Project non-opt-in tak tersentuh.
> Terdaftar di `server.ts` sebelum `startScheduler()`.
```

In `internal/docs/architecture/data-model.md`, in the `## SchedulerQueueItem` section, append to the bullet list:

```
- **Diisi oleh checker `backlog` (SPEC-295):** spec `baseSha=null` dari project `schedulerOptIn`, urut prioritas.
```

In `internal/docs/architecture/stack.md`, on the scheduler pipeline line (`source enable+cadence → antrean durable → drain di bawah cap · SPEC-294/ADR-0072`), append `; checker backlog konkret SPEC-295`.

- [x] **Step 6: Commit**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-295
git add server/src/services/scheduler/sources/backlog.ts server/test/scheduler-source-backlog.test.ts internal/docs/architecture/stack.md internal/docs/architecture/api-contract.md internal/docs/architecture/data-model.md
git commit -m "feat(spec-295): backlog source-checker enqueues not-started specs by priority

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire registration at boot

**Files:**
- Modify: `server/src/server.ts` (import + call before `startScheduler()`)

**Interfaces:**
- Consumes: `registerBacklogSource()` from Task 1.
- Produces: at process boot the registry contains the `backlog` source, so the engine's first tick can run it. (No unit test — `app.ts` is registration-free by design; covered by Task 3 smoke.)

- [x] **Step 1: Add the import**

In `server/src/server.ts`, next to the existing scheduler import (`import { startScheduler } from "./services/scheduler/engine";`), add:

```ts
import { registerBacklogSource } from "./services/scheduler/sources/backlog";
```

- [x] **Step 2: Call registration before startScheduler**

In `server/src/server.ts`, change the line inside the `app.listen(...).then(...)` block from:

```ts
  startScheduler(); // SPEC-294 · ADR-0072 · engine scheduler in-process (timer .unref, app.ts bebas-timer)
```

to:

```ts
  registerBacklogSource(); // SPEC-295 · daftarkan checker backlog sebelum engine tick pertama
  startScheduler(); // SPEC-294 · ADR-0072 · engine scheduler in-process (timer .unref, app.ts bebas-timer)
```

- [x] **Step 3: Typecheck / build to verify it compiles**

Run: `cd server && pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Step 4: Run the full scheduler test suite (no regressions)**

Run: `cd server && env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman295' pnpm exec vitest run --no-file-parallelism test/scheduler-source-backlog.test.ts test/scheduler-engine.test.ts test/scheduler-queue.service.test.ts test/scheduler-governor.test.ts test/scheduler.route.test.ts test/scheduler-registry.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-295
git add server/src/server.ts
git commit -m "feat(spec-295): register backlog source at boot before scheduler start

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Live curl smoke (real endpoint proof)

**Files:**
- Create (scratchpad, not committed): `<scratchpad>/smoke-295.sh`

**Interfaces:**
- Consumes: booted server against a throwaway migrated DB; the real `server.ts` boot wiring (Task 2).
- Produces: evidence that `GET /api/scheduler/state` shows the queue populated by the backlog checker with opt-in specs ordered by priority, and the non-opt-in spec absent.

- [x] **Step 1: Write the smoke script**

Write `<scratchpad>/smoke-295.sh` (uses a dedicated DB `hanoman295_smoke`, a free port `8795`, and an isolated tmux socket so it can never touch a real session). The Setting row is seeded with the scheduler **enabled + paused + backlog on** so the boot-pass tick enqueues but never launches a real `claude` session:

```bash
#!/usr/bin/env bash
set -uo pipefail
DB=hanoman295_smoke
URL="postgresql://hanoman:hanoman@localhost:5432/$DB"
PORT=8795
WT=/Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-295
CK=$(mktemp)

cleanup() { [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; PGPASSWORD=hanoman psql -h localhost -U hanoman -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; rm -f "$CK"; }
trap cleanup EXIT

PGPASSWORD=hanoman psql -h localhost -U hanoman -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
PGPASSWORD=hanoman psql -h localhost -U hanoman -d postgres -c "CREATE DATABASE $DB;" >/dev/null
( cd "$WT/server" && DATABASE_URL="$URL" pnpm exec prisma migrate deploy ) >/dev/null

PGPASSWORD=hanoman psql -h localhost -U hanoman -d "$DB" >/dev/null <<'SQL'
INSERT INTO "Project"(id,name,"desc",kind,"schedulerOptIn") VALUES
  ('opt','Opt','','existing',true), ('noopt','NoOpt','','existing',false);
INSERT INTO "Spec"(id,"projectId",title,source,stage,priority,author,objective) VALUES
  ('SPEC-A','opt','A','brief','brainstorming','sedang','me','o'),
  ('SPEC-B','opt','B','brief','brainstorming','tinggi','me','o'),
  ('SPEC-C','noopt','C','brief','brainstorming','tinggi','me','o');
INSERT INTO "Setting"(id,data) VALUES (1,
  '{"model":"claude-opus-4-8","effort":"xhigh","autoDefault":false,"autoScaffold":false,"notifyFail":false,"notifyDone":true,"notifySound":"short","notifyDecision":true,"notifyDecisionSound":"alert","agentAccessEnabled":false,"scheduler":{"enabled":true,"paused":true,"maxConcurrent":2,"autonomy":"butuh-keputusan","sources":{"backlog":{"enabled":true,"everyMin":15},"errors":{"enabled":false,"everyMin":15,"minCount":5},"triase":{"enabled":false,"everyMin":30}}}}'::jsonb);
SQL

( cd "$WT/server" && DATABASE_URL="$URL" PORT=$PORT HOST=127.0.0.1 \
    HANOMAN_TMUX_SOCKET=hanoman-smoke295 HANOMAN_UPDATE_FETCH=0 \
    pnpm exec tsx src/server.ts ) >/tmp/smoke295.log 2>&1 &
SRV=$!

# wait for listen
for i in $(seq 1 40); do curl -sf "localhost:$PORT/api/auth/status" >/dev/null 2>&1 && break; sleep 0.5; done
# first user + cookie
curl -sS -c "$CK" -X POST "localhost:$PORT/api/auth/setup" -H 'content-type: application/json' \
  -d '{"email":"a@a.co","password":"password123"}' >/dev/null
# wait for the boot-pass tick to enqueue (paused → no launch)
for i in $(seq 1 30); do
  N=$(curl -sS -b "$CK" "localhost:$PORT/api/scheduler/state" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["queue"]))' 2>/dev/null || echo 0)
  [ "$N" -ge 2 ] && break; sleep 0.5
done

echo "=== /api/scheduler/state queue ==="
curl -sS -b "$CK" "localhost:$PORT/api/scheduler/state" \
  | python3 -c 'import sys,json; q=json.load(sys.stdin)["queue"]; print(json.dumps([{k:r[k] for k in ("specId","source","priority","status")} for r in q], indent=2))'
```

- [x] **Step 2: Run the smoke and verify the queue**

Run: `bash <scratchpad>/smoke-295.sh`
Expected output: a queue array containing exactly `SPEC-B` (priority `tinggi`) and `SPEC-A` (priority `sedang`), both `source:"backlog"`, `status:"queued"`; `SPEC-C` (the non-opt-in project's spec) **absent**. This proves: opt-in gating, priority ordering, `source="backlog"`, and that the real `server.ts` boot registered + ran the checker.

- [x] **Step 3: Record evidence & mark plan complete**

Paste the observed `state.queue` output into the execution notes. No commit for this task (script lives in scratchpad).

---

## Self-Review

**1. Spec coverage:**
- "Checker terdaftar di registry fondasi" → Task 1 `registerBacklogSource` + Task 2 boot wiring + Task 1 test #5. ✓
- "enqueue semua Spec baseSha null dari project schedulerOptIn" → Task 1 `checkBacklog` query + test #1. ✓
- "terurut prioritas" → Task 1 sort + test #2. ✓
- "project non-opt-in tak tersentuh" → relation-filter + test #1 (SPEC-B/SPEC-C absent) + smoke. ✓
- "idempoten (tak dobel-enqueue antre/hidup)" → `enqueue` upsert + baseSha guard + test #3/#4. ✓
- "dibuktikan unit test + curl endpoint di local" → Task 1 tests + Task 3 smoke. ✓

**2. Placeholder scan:** none — all steps contain concrete code/commands.

**3. Type consistency:** `checkBacklog(): Promise<void>` and `registerBacklogSource(): void` are consistent across Task 1 (definition), Task 1 test (import), and Task 2 (import). Queue `source` value `"backlog"` consistent with schema comment and `GET /state` grouping.
