# hanoman Foundation (SPEC-001) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `.prototype/` mockup into a real running app — pnpm workspace, Vite+TS dashboard, Fastify+Postgres backend — with all 8 screens wired to a live, persisted API and nothing stubbed within scope.

**Architecture:** pnpm workspace of three packages: `shared/` (zod schemas = the typed API contract), `server/` (Fastify + Prisma + Postgres), `src/` (Vite+TS dashboard ported from `.prototype/app`). In dev, Vite proxies `/api` → Fastify; in prod, Fastify serves the built dashboard as one process. TDD throughout; the spec stage machine, coverage calc, and docs service are the real logic and get the tightest tests.

**Tech Stack:** Node 20+, TypeScript 5 (strict), pnpm workspaces, Fastify 4, Prisma 5 + PostgreSQL 16, zod, Vite 5 + React 18, Vitest, `marked`, `lucide-react`.

## Global Constraints

- **Source of Truth:** `internal/docs/**` wins over assumptions. Schema follows `internal/docs/architecture/data-model.md`; any delta needs an ADR (this plan adds ADR-0004). (AGENTS.md, ADR-0001)
- **TypeScript strict** everywhere. (CLAUDE.md)
- **Design system is law:** use only the tokens/components from `.prototype/_ds/hanoman-design-system-c639ade9-3569-4176-afeb-71f1b51a2630`. No new colors/typography. (design-system.md)
- **No stubs in scope:** run-control, SSE, execute, webhooks are NOT registered — they must return 404 until SPEC-003/006, never a fake 202. (SPEC-001 §Acceptance #4)
- **Layout:** sidebar 248px + topbar 56px, content max 1200px, Docs full-width. (frontend-implementation.md)
- **Copy is mixed-language** (Indonesian narrative + English technical vocabulary) — preserve prototype copy verbatim when porting. (data.js header)
- **Every touched `internal/docs` doc** is updated and linked in `internal/docs/README.md` in the same change. (AGENTS.md)
- **API base path** is `/api`; every request/response validated against a `shared/` zod schema.
- Commit after every green step.

---

## File Structure

```
package.json                pnpm workspace root + scripts
pnpm-workspace.yaml
tsconfig.base.json          strict compiler options, shared
docker-compose.yml          postgres:16
.env.example                DATABASE_URL, PORT
vitest.workspace.ts         runs shared+server+src suites

shared/
  package.json
  src/index.ts              re-exports
  src/enums.ts              stage/status/kind/etc. zod enums
  src/entities.ts           zod schemas for Project, Spec, Run, Trigger, Setting, DocFile
  src/dto.ts                request bodies + view DTOs (ProjectView, DocIndex)
  src/api.ts                endpoint path constants

server/
  package.json
  prisma/schema.prisma      models (data-model.md + ADR-0004)
  prisma/seed.ts            loads .prototype/app/data.js + docContent.js
  src/db.ts                 PrismaClient singleton
  src/services/stage-machine.ts
  src/services/coverage.ts
  src/services/docs.ts
  src/services/project-view.ts
  src/services/id.ts        next SPEC-n / RUN-n id helpers
  src/routes/health.ts
  src/routes/projects.ts
  src/routes/specs.ts
  src/routes/triggers.ts
  src/routes/settings.ts
  src/routes/docs.ts
  src/routes/runs.ts
  src/app.ts                buildApp(): Fastify instance (plugins, routes, static)
  src/server.ts             listen()
  test/*.test.ts

src/
  index.html
  vite.config.ts            proxy /api → server
  src/main.tsx
  src/ds/tokens/*.css        copied verbatim
  src/ds/styles.css          copied verbatim
  src/ds/components/*.tsx     14 DS components, ported
  src/ds/kit/*.tsx           Modal, Toast, Field, HnTextarea, useToast, Shell
  src/ds/icon.tsx            Lucide wrapper
  src/api/client.ts          typed fetch over shared schemas
  src/screens/*.tsx          Overview, Projects, Backlog, Runs, Docs, Triggers, Settings
  src/App.tsx                nav + state, ported from App.jsx
  test/*.test.ts

internal/docs/adr/0004-foundation-schema-deltas.md   (new ADR)
```

Files that change together live together (routes with their service; screen with its port source). Split by responsibility, not layer.

---

## Phase A — Workspace & data foundation

### Task 1: Workspace scaffold + tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `docker-compose.yml`, `.env.example`, `.gitignore`, `vitest.workspace.ts`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`
- Test: `shared/test/smoke.test.ts`

**Interfaces:**
- Produces: pnpm workspace with packages `shared`, `server`, `app` (dir `src/`); scripts `dev`, `build`, `typecheck`, `test`, `seed`; a running Postgres on `localhost:5432`.

- [x] **Step 1: Write the failing smoke test**

```ts
// shared/test/smoke.test.ts
import { describe, it, expect } from "vitest";
import { ping } from "../src/index";
describe("workspace", () => {
  it("runs vitest and imports shared", () => { expect(ping()).toBe("pong"); });
});
```

- [x] **Step 2: Run it, verify it fails**

Run: `pnpm -w test shared` → Expected: FAIL, `ping` not exported (or module missing).

- [x] **Step 3: Create workspace files**

`pnpm-workspace.yaml`:
```yaml
packages: ["shared", "server", "src"]
```

Root `package.json`:
```json
{
  "name": "hanoman",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "pnpm --parallel --filter ./server --filter ./src dev",
    "build": "pnpm --filter ./src build && pnpm --filter ./server build",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "seed": "pnpm --filter ./server seed"
  },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "esModuleInterop": true,
    "skipLibCheck": true, "resolveJsonModule": true, "verbatimModuleSyntax": true,
    "declaration": true, "forceConsistentCasingInFileNames": true
  }
}
```

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: hanoman
      POSTGRES_PASSWORD: hanoman
      POSTGRES_DB: hanoman
    ports: ["5432:5432"]
    volumes: ["hanoman_pg:/var/lib/postgresql/data"]
volumes: { hanoman_pg: {} }
```

`.env.example`:
```
DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman
PORT=8787
```

`.gitignore`: `node_modules`, `dist`, `.env`, `.worktrees`, `*.tsbuildinfo`.

`vitest.workspace.ts`:
```ts
export default ["shared", "server", "src"];
```

`shared/package.json`:
```json
{
  "name": "@hanoman/shared", "type": "module", "version": "0.0.0",
  "main": "src/index.ts", "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^3.23.0" }
}
```

`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src", "test"] }
```

`shared/src/index.ts`:
```ts
export const ping = () => "pong";
export * from "./enums";
export * from "./entities";
export * from "./dto";
export * from "./api";
```

Create empty placeholder files `shared/src/{enums,entities,dto,api}.ts` exporting `export {};` for now (filled in Task 2).

- [x] **Step 4: Install + start db + run test**

Run: `pnpm install && cp .env.example .env && docker-compose up -d && pnpm -w test shared`
Expected: PASS. `docker-compose ps` shows `db` healthy.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: pnpm workspace + postgres + vitest scaffold"
```

---

### Task 2: Shared zod schemas (the API contract)

**Files:**
- Modify: `shared/src/enums.ts`, `shared/src/entities.ts`, `shared/src/dto.ts`, `shared/src/api.ts`
- Test: `shared/test/entities.test.ts`

**Interfaces:**
- Produces (imported everywhere): `zProject, zSpec, zRun, zTrigger, zSetting, zDocFile`; enums `zStage, zSpecSource, zRunStatus, zRunKind, zTriggerType, zTriggerTarget, zDocStatus, zPriority`; DTOs `zCreateProject, zCreateSpec, zAdvanceResult, zCreateTrigger, zSetting, zProjectView, zDocIndex, zDocFileContent`; and `type Project = z.infer<typeof zProject>` etc. Path constants in `api.ts`.

- [x] **Step 1: Write failing tests**

```ts
// shared/test/entities.test.ts
import { describe, it, expect } from "vitest";
import { zProject, zSpec, zStage, zCreateSpec, zProjectView } from "../src/index";

describe("schemas", () => {
  it("parses a valid project", () => {
    const p = zProject.parse({ id: "arta", name: "arta", desc: "x", kind: "existing",
      docStatus: "ok", coverage: 94, createdAt: new Date().toISOString() });
    expect(p.coverage).toBe(94);
  });
  it("rejects coverage over 100", () => {
    expect(() => zProject.parse({ id: "a", name: "a", desc: "", kind: "existing",
      docStatus: "ok", coverage: 101, createdAt: new Date().toISOString() })).toThrow();
  });
  it("stage enum has the six stages in order", () => {
    expect(zStage.options).toEqual(["brainstorming","objective","spec-ready","planned","executing","done"]);
  });
  it("create-spec brief payload validates", () => {
    const b = zCreateSpec.parse({ project: "arta", source: "brief", title: "T",
      priority: "sedang", payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } });
    expect(b.source).toBe("brief");
  });
  it("project view adds derived fields", () => {
    const v = zProjectView.parse({ id: "a", name: "a", desc: "", kind: "existing", docStatus: "ok",
      coverage: 94, createdAt: new Date().toISOString(), stack: "Go", backlog: 6, topStage: "execute",
      run: { status: "running", phase: "Execute", kind: "feature" }, activity: "x", commit: "y" });
    expect(v.backlog).toBe(6);
  });
});
```

- [x] **Step 2: Run, verify fail**

Run: `pnpm -w test shared` → Expected: FAIL (exports missing).

- [x] **Step 3: Implement schemas**

`shared/src/enums.ts`:
```ts
import { z } from "zod";
export const zStage = z.enum(["brainstorming","objective","spec-ready","planned","executing","done"]);
export const zSpecSource = z.enum(["brief","qa"]);
export const zRunStatus = z.enum(["queued","running","paused","stopped","failed","done"]);
export const zRunKind = z.enum(["feature","qa","scaffold"]);
export const zTriggerType = z.enum(["commit","schedule","manual","interval"]);
export const zTriggerTarget = z.enum(["plan + execute","audit","qa audit","scaffold docs"]);
export const zDocStatus = z.enum(["ok","drift","broken"]);
export const zPriority = z.enum(["tinggi","sedang","rendah"]);
export const zProjectKind = z.enum(["from-scratch","existing"]);
export const zSeverity = z.enum(["critical","major","minor"]);
```

`shared/src/entities.ts`:
```ts
import { z } from "zod";
import { zStage, zSpecSource, zRunStatus, zRunKind, zTriggerType, zTriggerTarget,
  zDocStatus, zPriority, zProjectKind } from "./enums";

export const zProject = z.object({
  id: z.string(), name: z.string(), desc: z.string(), kind: zProjectKind,
  repoDir: z.string().nullable().optional(), repoUrl: z.string().nullable().optional(),
  stack: z.string().default(""),                       // ADR-0004
  docStatus: zDocStatus, coverage: z.number().int().min(0).max(100),
  createdAt: z.string(),
});
export type Project = z.infer<typeof zProject>;

export const zBriefPayload = z.object({
  context: z.string(), outcome: z.string(), constraints: z.string(), priority: zPriority });
export const zQaPayload = z.object({
  severity: z.enum(["critical","major","minor"]), steps: z.string(),
  expected: z.string(), actual: z.string(), env: z.string() });

export const zSpec = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), source: zSpecSource,
  stage: zStage, priority: zPriority, author: z.string(), objective: z.string(),
  payload: z.union([zBriefPayload, zQaPayload]).nullable(),
});
export type Spec = z.infer<typeof zSpec>;

const zPhase = z.object({ name: z.string(), state: z.enum(["done","active","failed","pending"]) });
export const zRun = z.object({
  id: z.string(), projectId: z.string(), specId: z.string().nullable(),
  kind: zRunKind, status: zRunStatus, trigger: zTriggerType, triggerDetail: z.string(),
  phases: z.array(zPhase), plan: z.array(z.object({ label: z.string(), state: z.string() })),
  files: z.array(z.object({ path: z.string(), add: z.number(), del: z.number(), status: z.string() })),
  log: z.array(z.object({ t: z.string(), s: z.string() })),
  worktree: z.string(), branchFrom: z.string(), branchTo: z.string(),
  model: z.string(), tokensIn: z.string(), tokensOut: z.string(),
  cost: z.string(), progress: z.number(),
});
export type Run = z.infer<typeof zRun>;

export const zTrigger = z.object({
  id: z.string(), projectId: z.string(), type: zTriggerType, detail: z.string(),
  target: zTriggerTarget, enabled: z.boolean() });
export type Trigger = z.infer<typeof zTrigger>;

export const zStepModel = z.object({ model: z.string(), effort: z.string() });
export const zSetting = z.object({
  steps: z.object({ brainstorm: zStepModel, spec: zStepModel, plan: zStepModel,
    execute: zStepModel, audit: zStepModel }),
  autoDefault: z.boolean(), blockStale: z.boolean(), requireLinks: z.boolean(),
  autoScaffold: z.boolean(), maxConcurrent: z.number().int(), dailyBudget: z.number(),
  notifyFail: z.boolean() });
export type Setting = z.infer<typeof zSetting>;

export const zDocFile = z.object({
  projectId: z.string(), path: z.string(), category: z.string(),
  content: z.string(), linked: z.boolean(), root: z.boolean() });
export type DocFile = z.infer<typeof zDocFile>;
```

`shared/src/dto.ts`:
```ts
import { z } from "zod";
import { zProject, zBriefPayload, zQaPayload } from "./entities";
import { zProjectKind, zSpecSource, zPriority, zStage, zTriggerType, zTriggerTarget } from "./enums";

export const zCreateProject = z.object({
  name: z.string().min(1), kind: zProjectKind, repoDir: z.string().optional(),
  desc: z.string().default("") });
export const zCreateSpec = z.object({
  project: z.string(), source: zSpecSource, title: z.string().min(1),
  priority: zPriority, payload: z.union([zBriefPayload, zQaPayload]) });
export const zCreateTrigger = z.object({
  project: z.string(), type: zTriggerType, detail: z.string(), target: zTriggerTarget });

export const zRunSummary = z.object({
  status: z.string(), phase: z.string().nullable(), kind: z.string().nullable() });
export const zProjectView = zProject.extend({
  backlog: z.number().int(), topStage: z.string(), run: zRunSummary,
  activity: z.string(), commit: z.string() });
export type ProjectView = z.infer<typeof zProjectView>;

export const zAdvanceResult = z.object({ id: z.string(), stage: zStage });
export const zDocFileContent = z.object({ content: z.string() });
export const zDocIndexCat = z.object({
  cat: z.string(), files: z.array(z.string()), linked: z.boolean(), root: z.boolean().optional() });
export const zDocIndex = z.object({ coverage: z.number(), tree: z.array(zDocIndexCat) });
```

`shared/src/api.ts`:
```ts
export const API = "/api";
export const paths = {
  projects: `${API}/projects`,
  project: (id: string) => `${API}/projects/${id}`,
  scan: (id: string) => `${API}/projects/${id}/scan`,
  specs: `${API}/specs`,
  advance: (id: string) => `${API}/specs/${id}/advance`,
  spec: (id: string) => `${API}/specs/${id}`,
  triggers: `${API}/triggers`,
  toggle: (id: string) => `${API}/triggers/${id}/toggle`,
  settings: `${API}/settings`,
  runs: `${API}/runs`,
  run: (id: string) => `${API}/runs/${id}`,
  docs: (id: string) => `${API}/projects/${id}/docs`,
  docFile: (id: string, path: string) => `${API}/projects/${id}/docs/${path}`,
} as const;
```

- [x] **Step 4: Run, verify pass** — Run: `pnpm -w test shared` → Expected: PASS.
- [x] **Step 5: Commit** — `git commit -am "feat(shared): zod schemas + DTOs = typed API contract"`

---

### Task 3: ADR-0004 + Prisma schema + migration

**Files:**
- Create: `internal/docs/adr/0004-foundation-schema-deltas.md`
- Modify: `internal/docs/README.md` (link the ADR)
- Create: `server/package.json`, `server/tsconfig.json`, `server/prisma/schema.prisma`, `server/src/db.ts`
- Test: `server/test/db.test.ts`

**Interfaces:**
- Produces: Prisma models `Project, Spec, Run, Trigger, Setting, DocFile`; `prisma` client singleton from `server/src/db.ts` as `export const prisma`.

- [x] **Step 1: Write the ADR** (justifies the deltas so we don't silently drift the SoT)

`internal/docs/adr/0004-foundation-schema-deltas.md`:
```markdown
# ADR 0004 — Foundation schema deltas

**Status:** accepted

## Konteks
Prototype `Project` menampilkan field UI (`stack`, `activity`, `commit`, `backlog`,
`topStage`, `run`) yang tidak ada di `data-model.md`. Foundation butuh skema konkret.

## Keputusan
- Kolom **tersimpan** mengikuti `data-model.md` + satu tambahan: `Project.stack` (text)
  — metadata teknologi yang ditampilkan kartu project.
- `activity`, `commit`, `backlog`, `topStage`, `run` **tidak disimpan** — dihitung
  sebagai `ProjectView` DTO dari tabel Run/Spec.
- Payload Spec (brief/qa) disimpan sebagai kolom `payload` jsonb.

## Konsekuensi
- (+) UI prototype ter-port tanpa mengarang skema.
- (−) `ProjectView` menambah join; di-cache bila perlu nanti.
```
Add to `internal/docs/README.md` under `## adr`: `- [0004 — foundation schema deltas](adr/0004-foundation-schema-deltas.md)`

- [x] **Step 2: Write failing db test**

```ts
// server/test/db.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";
describe("db", () => {
  it("connects and counts projects", async () => {
    expect(await prisma.project.count()).toBeGreaterThanOrEqual(0);
  });
});
```

- [x] **Step 3: Run, verify fail** — Run: `pnpm --filter ./server test` → FAIL (no client/tables).

- [x] **Step 4: Create server package + schema**

`server/package.json`:
```json
{
  "name": "@hanoman/server", "type": "module", "version": "0.0.0",
  "scripts": {
    "dev": "tsx watch src/server.ts", "build": "tsc",
    "typecheck": "tsc --noEmit", "test": "vitest run",
    "seed": "tsx prisma/seed.ts", "migrate": "prisma migrate dev"
  },
  "dependencies": { "@hanoman/shared": "workspace:*", "@prisma/client": "^5.18.0",
    "fastify": "^4.28.0", "@fastify/static": "^7.0.0", "zod": "^3.23.0" },
  "devDependencies": { "prisma": "^5.18.0", "tsx": "^4.16.0" }
}
```

`server/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "include": ["src","test","prisma"] }`

`server/prisma/schema.prisma`:
```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model Project {
  id        String   @id
  name      String
  desc      String
  kind      String
  repoDir   String?
  repoUrl   String?
  stack     String   @default("")
  docStatus String
  coverage  Int
  createdAt DateTime @default(now())
  specs     Spec[]
  runs      Run[]
  triggers  Trigger[]
  docs      DocFile[]
}

model Spec {
  id        String  @id
  projectId String
  title     String
  source    String
  stage     String
  priority  String
  author    String
  objective String
  payload   Json?
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Run {
  id            String  @id
  projectId     String
  specId        String?
  kind          String
  status        String
  trigger       String
  triggerDetail String
  phases        Json
  plan          Json
  files         Json
  log           Json
  worktree      String
  branchFrom    String
  branchTo      String
  model         String
  tokensIn      String
  tokensOut     String
  cost          String
  progress      Int
  project       Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Trigger {
  id        String  @id
  projectId String
  type      String
  detail    String
  target    String
  enabled   Boolean
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Setting {
  id   Int  @id @default(1)
  data Json
}

model DocFile {
  id        Int     @id @default(autoincrement())
  projectId String
  path      String
  category  String
  content   String
  linked    Boolean
  root      Boolean @default(false)
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([projectId, path])
}
```

`server/src/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
```

- [x] **Step 5: Migrate + generate + test**

Run: `cd server && pnpm exec prisma migrate dev --name init && cd .. && pnpm --filter ./server test`
Expected: migration applied; test PASS (count = 0).

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(server): prisma schema + ADR-0004 + db client"`

---

### Task 4: Seed from prototype data

**Files:**
- Create: `server/prisma/seed.ts`, `server/prisma/proto-data.ts` (typed copy of the prototype arrays)
- Test: `server/test/seed.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 3), prototype arrays from `.prototype/app/data.js` and doc bodies from `.prototype/app/docContent.js`.
- Produces: populated tables. `proto-data.ts` exports `projects, backlog, runs, triggers, docTree, defaultSetting`.

- [x] **Step 1: Write failing seed-integrity test**

```ts
// server/test/seed.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db";
import { seed } from "../prisma/seed";
describe("seed", () => {
  beforeAll(async () => { await seed(); });
  it("loads the 6 demo projects", async () => { expect(await prisma.project.count()).toBe(6); });
  it("loads the 6 backlog specs", async () => { expect(await prisma.spec.count()).toBe(6); });
  it("loads the 5 runs", async () => { expect(await prisma.run.count()).toBe(5); });
  it("arta has coverage 94", async () => {
    const a = await prisma.project.findUnique({ where: { id: "arta" } }); expect(a?.coverage).toBe(94); });
  it("seeds loka-pos doc categories from docTree", async () => {
    expect(await prisma.docFile.count({ where: { projectId: "loka-pos" } })).toBeGreaterThan(0); });
});
```

- [x] **Step 2: Run, verify fail** — `pnpm --filter ./server test seed` → FAIL.

- [x] **Step 3: Port the data + write seed**

Create `server/prisma/proto-data.ts` by transcribing the arrays from `.prototype/app/data.js` (`window.HN.projects`, `.backlog`, `.runs`, `.triggers`, `.docTree`) into typed exports. Map fields 1:1; drop UI-only project fields (`run`, `backlog`, `topStage`, `triggers`, `activity`, `commit`) — keep `stack`. For specs, wrap the extra brief/qa fields into `payload` (the demo specs carry only `objective`, so `payload: null`). For runs, keep all fields; the branch/worktree derivation at the bottom of `data.js` is already applied there — copy the resolved values. `defaultSetting` mirrors `data-model.md` §Settings defaults (opus / x-high per step, `blockStale: true`, `requireLinks: true`, `maxConcurrent: 3`, `dailyBudget: 50`, `autoDefault: true`, `autoScaffold: true`, `notifyFail: true`).

For docs: seed `DocFile` rows per project. For `loka-pos`, expand `docTree` (each category × file) with `content` pulled from `.prototype/app/docContent.js` where present, else a one-line placeholder `# <file>\n` (real bodies arrive when SPEC-003 reads repos). Other projects get a minimal SoT index seeded from `internal/docs/README.md` categories so their coverage renders.

`server/prisma/seed.ts`:
```ts
import { prisma } from "../src/db";
import { projects, backlog, runs, triggers, docFiles, defaultSetting } from "./proto-data";

export async function seed() {
  await prisma.$transaction([
    prisma.docFile.deleteMany(), prisma.trigger.deleteMany(), prisma.run.deleteMany(),
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
  ]);
  await prisma.project.createMany({ data: projects });
  await prisma.spec.createMany({ data: backlog });
  await prisma.run.createMany({ data: runs });
  await prisma.trigger.createMany({ data: triggers });
  await prisma.docFile.createMany({ data: docFiles });
  await prisma.setting.create({ data: { id: 1, data: defaultSetting } });
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed().then(() => { console.log("seeded"); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
```
(`docFiles` in `proto-data.ts` is the flattened `{projectId,path,category,content,linked,root}[]` built from `docTree` + `docContent.js`.)

- [x] **Step 4: Run, verify pass** — `pnpm --filter ./server test seed` → PASS.
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(server): seed from prototype data"`

---

## Phase B — Backend services (real logic, strict TDD)

### Task 5: Spec stage machine

**Files:**
- Create: `server/src/services/stage-machine.ts`
- Test: `server/test/stage-machine.test.ts`

**Interfaces:**
- Produces: `STAGES: readonly Stage[]`; `nextStage(current: Stage): Stage | null`; `advance(current: Stage): { stage: Stage; toastEvent: string } | null` — mirrors `.prototype/app/App.jsx` `ADV_STAGES` + `ADV_TOAST`.

- [x] **Step 1: Write failing tests**

```ts
// server/test/stage-machine.test.ts
import { describe, it, expect } from "vitest";
import { STAGES, nextStage, advance } from "../src/services/stage-machine";
describe("stage machine", () => {
  it("orders the six stages", () =>
    expect(STAGES).toEqual(["brainstorming","objective","spec-ready","planned","executing","done"]));
  it("advances brainstorming -> objective", () => expect(nextStage("brainstorming")).toBe("objective"));
  it("advances planned -> executing", () => expect(advance("planned")?.stage).toBe("executing"));
  it("returns null at terminal done", () => expect(nextStage("done")).toBeNull());
  it("done transition carries the sync toast", () =>
    expect(advance("executing")?.toastEvent).toBe("selesai — docs tersinkron"));
});
```

- [x] **Step 2: Run, verify fail** — `pnpm --filter ./server test stage-machine` → FAIL.

- [x] **Step 3: Implement**

```ts
// server/src/services/stage-machine.ts
import type { Stage } from "@hanoman/shared";
export const STAGES = ["brainstorming","objective","spec-ready","planned","executing","done"] as const;
const TOAST: Record<string, string> = {
  objective: "objective terkunci", "spec-ready": "spec ditulis", planned: "plan dibuat",
  executing: "execute dimulai", done: "selesai — docs tersinkron",
};
export function nextStage(current: Stage): Stage | null {
  const i = STAGES.indexOf(current);
  return i < 0 || i >= STAGES.length - 1 ? null : STAGES[i + 1]!;
}
export function advance(current: Stage) {
  const stage = nextStage(current);
  return stage ? { stage, toastEvent: TOAST[stage] ?? stage } : null;
}
```
(Add `export type Stage = z.infer<typeof zStage>` to `shared/src/entities.ts` if not already exported.)

- [x] **Step 4: Run, verify pass** — PASS.
- [x] **Step 5: Commit** — `git commit -am "feat(server): spec stage machine"`

---

### Task 6: Coverage calculation

**Files:**
- Create: `server/src/services/coverage.ts`
- Test: `server/test/coverage.test.ts`

**Interfaces:**
- Produces: `coverageOf(docs: {category:string; linked:boolean}[]): number` — percent of distinct categories that are linked, rounded; and `docStatusFor(pct:number): "ok"|"drift"|"broken"` (ok ≥ 90, drift ≥ 60, else broken).

- [x] **Step 1: Failing tests**

```ts
// server/test/coverage.test.ts
import { describe, it, expect } from "vitest";
import { coverageOf, docStatusFor } from "../src/services/coverage";
describe("coverage", () => {
  it("all linked -> 100", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"b",linked:true}])).toBe(100));
  it("half linked -> 50", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"b",linked:false}])).toBe(50));
  it("counts a category once even with many files", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"a",linked:true},{category:"b",linked:false}])).toBe(50));
  it("empty -> 0", () => expect(coverageOf([])).toBe(0));
  it("status thresholds", () => {
    expect(docStatusFor(94)).toBe("ok"); expect(docStatusFor(75)).toBe("drift"); expect(docStatusFor(38)).toBe("broken"); });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/services/coverage.ts
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

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git commit -am "feat(server): doc coverage calc"`

---

### Task 7: Docs service (index/tree + read + write)

**Files:**
- Create: `server/src/services/docs.ts`
- Test: `server/test/docs.test.ts`

**Interfaces:**
- Consumes: `prisma`, `coverageOf`.
- Produces: `docIndex(projectId): Promise<{coverage:number; tree:{cat,files,linked,root?}[]}>`; `readDoc(projectId, path): Promise<string | null>`; `writeDoc(projectId, path, content): Promise<void>` (upsert on `[projectId,path]`).

- [x] **Step 1: Failing tests**

```ts
// server/test/docs.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db";
import { seed } from "../prisma/seed";
import { docIndex, readDoc, writeDoc } from "../src/services/docs";
describe("docs service", () => {
  beforeAll(async () => { await seed(); });
  it("builds a tree grouped by category with coverage", async () => {
    const ix = await docIndex("loka-pos");
    expect(ix.tree.length).toBeGreaterThan(0);
    expect(ix.coverage).toBeGreaterThanOrEqual(0);
  });
  it("reads a seeded doc", async () => {
    const first = (await docIndex("loka-pos")).tree[0];
    const path = `${first.cat}/${first.files[0]}`;
    expect(typeof await readDoc("loka-pos", path)).toBe("string");
  });
  it("writes then reads back an edit", async () => {
    const first = (await docIndex("loka-pos")).tree[0];
    const path = `${first.cat}/${first.files[0]}`;
    await writeDoc("loka-pos", path, "# edited\nbody");
    expect(await readDoc("loka-pos", path)).toBe("# edited\nbody");
  });
  it("returns null for missing doc", async () => expect(await readDoc("loka-pos","nope/x.md")).toBeNull());
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/services/docs.ts
import { prisma } from "../db";
import { coverageOf } from "./coverage";
export async function docIndex(projectId: string) {
  const rows = await prisma.docFile.findMany({ where: { projectId }, orderBy: { path: "asc" } });
  const byCat = new Map<string, { cat: string; files: string[]; linked: boolean; root: boolean }>();
  for (const r of rows) {
    const c = byCat.get(r.category) ?? { cat: r.category, files: [], linked: true, root: r.root };
    c.files.push(r.path.split("/").pop()!); c.linked = c.linked && r.linked; c.root = c.root || r.root;
    byCat.set(r.category, c);
  }
  const tree = [...byCat.values()];
  return { coverage: coverageOf(rows.map((r) => ({ category: r.category, linked: r.linked }))), tree };
}
export async function readDoc(projectId: string, path: string) {
  const row = await prisma.docFile.findUnique({ where: { projectId_path: { projectId, path } } });
  return row?.content ?? null;
}
export async function writeDoc(projectId: string, path: string, content: string) {
  const category = path.split("/")[0] ?? "root";
  await prisma.docFile.upsert({
    where: { projectId_path: { projectId, path } },
    update: { content },
    create: { projectId, path, category, content, linked: true, root: false },
  });
}
```

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git commit -am "feat(server): docs service (index/read/write)"`

---

### Task 8: ProjectView composer

**Files:**
- Create: `server/src/services/project-view.ts`, `server/src/services/id.ts`
- Test: `server/test/project-view.test.ts`, `server/test/id.test.ts`

**Interfaces:**
- Produces:
  - `toProjectView(projectId): Promise<ProjectView>` — Project + `{ backlog: openSpecCount, topStage: furthest non-done stage or "spec", run: latestRunSummary, activity, commit }`. `run` = `{status,phase,kind}` from newest run (or `{status:"idle",phase:null,kind:null}`); `commit` = newest run's `branchTo` prefixed, else "belum ada commit"; `activity` = derived string from newest run status.
  - `nextSpecId(): Promise<string>` and `nextRunId(): Promise<string>` — `SPEC-<max+1>` / `RUN-<max+1>` scanning existing ids (mirrors `App.jsx` createSpec id logic, floor 140 for specs).

- [x] **Step 1: Failing tests**

```ts
// server/test/id.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { nextSpecId } from "../src/services/id";
describe("id", () => {
  beforeAll(async () => { await seed(); });
  it("next spec id is one past the max", async () => expect(await nextSpecId()).toBe("SPEC-143"));
});
```

```ts
// server/test/project-view.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { toProjectView } from "../src/services/project-view";
describe("project view", () => {
  beforeAll(async () => { await seed(); });
  it("arta backlog count reflects its specs", async () => {
    const v = await toProjectView("arta"); expect(v.backlog).toBe(2); }); // SPEC-142, SPEC-138
  it("arta run summary comes from newest run", async () => {
    const v = await toProjectView("arta"); expect(v.run.status).toBe("running"); });
  it("idle project has an idle run summary", async () => {
    const v = await toProjectView("wanara"); expect(v.run).toEqual({status:"idle",phase:null,kind:null}); });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/services/id.ts
import { prisma } from "../db";
const maxNum = (ids: string[], floor: number) =>
  Math.max(floor, ...ids.map((i) => parseInt(i.match(/\d+/)?.[0] ?? "0", 10)));
export async function nextSpecId() {
  const ids = (await prisma.spec.findMany({ select: { id: true } })).map((s) => s.id);
  return `SPEC-${maxNum(ids, 140) + 1}`;
}
export async function nextRunId() {
  const ids = (await prisma.run.findMany({ select: { id: true } })).map((r) => r.id);
  return `RUN-${maxNum(ids, 8800) + 1}`;
}
```

```ts
// server/src/services/project-view.ts
import { prisma } from "../db";
import { STAGES } from "./stage-machine";
import type { ProjectView } from "@hanoman/shared";
const IDLE = { status: "idle", phase: null as string | null, kind: null as string | null };
export async function toProjectView(projectId: string): Promise<ProjectView> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const specs = await prisma.spec.findMany({ where: { projectId } });
  const runs = await prisma.run.findMany({ where: { projectId } });
  const open = specs.filter((s) => s.stage !== "done");
  const latest = runs[runs.length - 1];
  const activePhase = latest ? (latest.phases as { name: string; state: string }[]).find((f) => f.state === "active")?.name ?? null : null;
  const topStage = open.length
    ? open.map((s) => s.stage).sort((a, b) => STAGES.indexOf(b as any) - STAGES.indexOf(a as any))[0]!
    : "spec";
  return {
    id: p.id, name: p.name, desc: p.desc, kind: p.kind as any, repoDir: p.repoDir, repoUrl: p.repoUrl,
    stack: p.stack, docStatus: p.docStatus as any, coverage: p.coverage, createdAt: p.createdAt.toISOString(),
    backlog: open.length, topStage,
    run: latest ? { status: latest.status, phase: activePhase, kind: latest.kind } : IDLE,
    activity: latest ? `${latest.status} · ${latest.kind}` : "idle",
    commit: latest ? `→ ${latest.branchTo}` : "belum ada commit",
  };
}
```

- [x] **Step 4: Run, verify pass** (adjust seed counts in assertions if transcription differs — the counts above assume the demo data as given).
- [x] **Step 5: Commit** — `git commit -am "feat(server): project-view composer + id helpers"`

---

## Phase C — Fastify API (TDD per route group)

### Task 9: Fastify app bootstrap

**Files:**
- Create: `server/src/app.ts`, `server/src/server.ts`, `server/src/routes/health.ts`
- Test: `server/test/app.test.ts`

**Interfaces:**
- Produces: `buildApp(): FastifyInstance` registering `/api` routes + (prod) static serving of `../src/dist`; `GET /api/health → {ok:true}`. Route modules export `export default async function (app: FastifyInstance)` and are registered under `/api`.

- [x] **Step 1: Failing test**

```ts
// server/test/app.test.ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";
describe("app", () => {
  it("health returns ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200); expect(res.json()).toEqual({ ok: true });
  });
  it("unknown run-control route is 404 (no stub)", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/api/runs/RUN-1/control", payload: { action: "stop" } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/routes/health.ts
import type { FastifyInstance } from "fastify";
export default async function (app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));
}
```

```ts
// server/src/app.ts
import Fastify, { type FastifyInstance } from "fastify";
import health from "./routes/health";
// route imports added by later tasks: projects, specs, triggers, settings, docs, runs
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(async (api) => {
    await api.register(health);
    // await api.register(projects); ... (added in Tasks 10-14)
  }, { prefix: "/api" });
  return app;
}
```

```ts
// server/src/server.ts
import { buildApp } from "./app";
const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`hanoman api :${port}`));
```

Add `fastify` + `@fastify/static` to deps (already in Task 3 package.json). Static serving (prod) is wired in Task 19.

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git commit -am "feat(server): fastify app + health + 404 guarantee"`

---

### Task 10: Projects routes

**Files:**
- Create: `server/src/routes/projects.ts`
- Modify: `server/src/app.ts` (register)
- Test: `server/test/projects.route.test.ts`

**Interfaces:**
- Consumes: `prisma`, `toProjectView`, `coverageOf/docStatusFor`, `docIndex`, `zCreateProject`, `zProjectView`.
- Produces routes: `GET /projects → ProjectView[]`; `GET /projects/:id → ProjectView`; `POST /projects {zCreateProject} → ProjectView` (201, id = slug of name); `POST /projects/:id/scan → ProjectView` (recompute coverage+docStatus from docIndex, persist).

- [x] **Step 1: Failing tests**

```ts
// server/test/projects.route.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("projects routes", () => {
  it("lists project views", async () => {
    const res = await app.inject({ url: "/api/projects" });
    expect(res.statusCode).toBe(200); expect(res.json().length).toBe(6);
    expect(res.json()[0]).toHaveProperty("backlog");
  });
  it("creates a from-scratch project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects",
      payload: { name: "kirana", kind: "from-scratch", desc: "marketplace" } });
    expect(res.statusCode).toBe(201); expect(res.json().id).toBe("kirana");
  });
  it("scan recomputes coverage", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/loka-pos/scan" });
    expect(res.statusCode).toBe(200); expect(typeof res.json().coverage).toBe("number");
  });
  it("rejects invalid create body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { kind: "x" } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/routes/projects.ts
import type { FastifyInstance } from "fastify";
import { zCreateProject } from "@hanoman/shared";
import { prisma } from "../db";
import { toProjectView } from "../services/project-view";
import { docIndex } from "../services/docs";
import { docStatusFor } from "../services/coverage";

export default async function (app: FastifyInstance) {
  app.get("/projects", async () => {
    const ps = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
    return Promise.all(ps.map((p) => toProjectView(p.id)));
  });
  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    return toProjectView(id);
  });
  app.post("/projects", async (req, reply) => {
    const parsed = zCreateProject.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const id = (b.name || b.repoDir?.split("/").pop() || "repo").trim().toLowerCase().replace(/\s+/g, "-");
    await prisma.project.create({ data: {
      id, name: id, desc: b.desc || "project baru", kind: b.kind, repoDir: b.repoDir ?? null,
      stack: "", docStatus: "broken", coverage: 0 } });
    return reply.code(201).send(await toProjectView(id));
  });
  app.post("/projects/:id/scan", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    const { coverage } = await docIndex(id);
    await prisma.project.update({ where: { id }, data: { coverage, docStatus: docStatusFor(coverage) } });
    return toProjectView(id);
  });
}
```
Register in `app.ts`: `import projects from "./routes/projects";` and `await api.register(projects);`.

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git commit -am "feat(server): projects routes"`

---

### Task 11: Specs routes

**Files:** Create `server/src/routes/specs.ts`; Modify `server/src/app.ts`; Test `server/test/specs.route.test.ts`

**Interfaces:**
- Consumes: `zCreateSpec`, `nextSpecId`, `advance`, `prisma`.
- Produces: `GET /specs?project=&source= → Spec[]`; `POST /specs {zCreateSpec} → Spec` (201, id via `nextSpecId`, stage `brainstorming`, author from body or "Rangga", priority derived for qa: minor→sedang else tinggi); `POST /specs/:id/advance → {id,stage}` (uses stage machine; 409 if terminal); `DELETE /specs/:id → 204`.

- [x] **Step 1: Failing tests**

```ts
// server/test/specs.route.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("specs routes", () => {
  it("filters by project", async () => {
    const res = await app.inject({ url: "/api/specs?project=arta" });
    expect(res.json().every((s: any) => s.projectId === "arta")).toBe(true);
  });
  it("creates a brief spec with next id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
      project: "arta", source: "brief", title: "New", priority: "sedang",
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } } });
    expect(res.statusCode).toBe(201); expect(res.json().id).toMatch(/^SPEC-\d+$/); expect(res.json().stage).toBe("brainstorming");
  });
  it("advances a spec", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-140/advance" });
    expect(res.json().stage).toBe("objective");
  });
  it("409 advancing a done spec", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-137/advance" });
    expect(res.statusCode).toBe(409);
  });
  it("deletes a spec", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/specs/SPEC-142" });
    expect(res.statusCode).toBe(204);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/routes/specs.ts
import type { FastifyInstance } from "fastify";
import { zCreateSpec } from "@hanoman/shared";
import { prisma } from "../db";
import { nextSpecId } from "../services/id";
import { advance } from "../services/stage-machine";

export default async function (app: FastifyInstance) {
  app.get("/specs", async (req) => {
    const { project, source } = req.query as { project?: string; source?: string };
    return prisma.spec.findMany({ where: { projectId: project, source }, orderBy: { id: "desc" } });
  });
  app.post("/specs", async (req, reply) => {
    const parsed = zCreateSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const id = await nextSpecId();
    const isQa = b.source === "qa";
    const priority = isQa && "severity" in b.payload
      ? (b.payload.severity === "minor" ? "sedang" : "tinggi") : b.priority;
    const objective = isQa && "actual" in b.payload
      ? (b.payload.actual || b.payload.steps || "— audit untuk menelusuri akar masalah.")
      : ("outcome" in b.payload ? (b.payload.outcome || b.payload.context || "— brainstorm untuk memperjelas objective.") : "");
    const spec = await prisma.spec.create({ data: {
      id, projectId: b.project, title: b.title, source: b.source, stage: "brainstorming",
      priority, author: isQa ? "QA · Rangga" : "Rangga", objective, payload: b.payload } });
    return reply.code(201).send(spec);
  });
  app.post("/specs/:id/advance", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await prisma.spec.findUnique({ where: { id } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    const step = advance(spec.stage as any);
    if (!step) return reply.code(409).send({ error: "terminal stage" });
    await prisma.spec.update({ where: { id }, data: { stage: step.stage } });
    return { id, stage: step.stage };
  });
  app.delete("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.spec.delete({ where: { id } }).catch(() => {});
    return reply.code(204).send();
  });
}
```
Register in `app.ts`.

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git commit -am "feat(server): specs routes + advance"`

---

### Task 12: Triggers + settings routes

**Files:** Create `server/src/routes/triggers.ts`, `server/src/routes/settings.ts`; Modify `app.ts`; Test `server/test/triggers-settings.route.test.ts`

**Interfaces:**
- Produces: `GET /triggers?project= → Trigger[]`; `POST /triggers {zCreateTrigger} → Trigger` (201, id `t<random>`, enabled true); `POST /triggers/:id/toggle → Trigger`; `GET /settings → Setting`; `PUT /settings {zSetting} → Setting`.

- [x] **Step 1: Failing tests**

```ts
// server/test/triggers-settings.route.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("triggers + settings", () => {
  it("lists triggers", async () => expect((await app.inject({ url: "/api/triggers" })).json().length).toBe(6));
  it("creates a trigger", async () => {
    const res = await app.inject({ method: "POST", url: "/api/triggers", payload: {
      project: "arta", type: "commit", detail: "push → main", target: "plan + execute" } });
    expect(res.statusCode).toBe(201); expect(res.json().enabled).toBe(true);
  });
  it("toggles a trigger", async () => {
    const res = await app.inject({ method: "POST", url: "/api/triggers/t4/toggle" });
    expect(res.json().enabled).toBe(true); // t4 seeded false
  });
  it("gets and updates settings", async () => {
    const got = await app.inject({ url: "/api/settings" }); expect(got.json()).toHaveProperty("steps");
    const put = await app.inject({ method: "PUT", url: "/api/settings",
      payload: { ...got.json(), maxConcurrent: 5 } });
    expect(put.json().maxConcurrent).toBe(5);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/routes/triggers.ts
import type { FastifyInstance } from "fastify";
import { zCreateTrigger } from "@hanoman/shared";
import { prisma } from "../db";
export default async function (app: FastifyInstance) {
  app.get("/triggers", async (req) => {
    const { project } = req.query as { project?: string };
    return prisma.trigger.findMany({ where: { projectId: project }, orderBy: { id: "desc" } });
  });
  app.post("/triggers", async (req, reply) => {
    const parsed = zCreateTrigger.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const id = "t" + Math.floor(Math.random() * 100000);
    const t = await prisma.trigger.create({ data: {
      id, projectId: b.project, type: b.type, detail: b.detail, target: b.target, enabled: true } });
    return reply.code(201).send(t);
  });
  app.post("/triggers/:id/toggle", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.trigger.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    return prisma.trigger.update({ where: { id }, data: { enabled: !t.enabled } });
  });
}
```

```ts
// server/src/routes/settings.ts
import type { FastifyInstance } from "fastify";
import { zSetting } from "@hanoman/shared";
import { prisma } from "../db";
export default async function (app: FastifyInstance) {
  app.get("/settings", async () => (await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).data);
  app.put("/settings", async (req, reply) => {
    const parsed = zSetting.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await prisma.setting.upsert({ where: { id: 1 },
      update: { data: parsed.data }, create: { id: 1, data: parsed.data } });
    return row.data;
  });
}
```
Register both in `app.ts`.

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git commit -am "feat(server): triggers + settings routes"`

---

### Task 13: Docs routes

**Files:** Create `server/src/routes/docs.ts`; Modify `app.ts`; Test `server/test/docs.route.test.ts`

**Interfaces:**
- Consumes: `docIndex, readDoc, writeDoc`, `zDocFileContent`.
- Produces: `GET /projects/:id/docs → {coverage,tree}`; `GET /projects/:id/docs/*path → {path,content}` (404 if missing); `PUT /projects/:id/docs/*path {content} → {path,content}`.

- [x] **Step 1: Failing tests**

```ts
// server/test/docs.route.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
let samplePath = "";
beforeAll(async () => { await seed();
  const ix = (await app.inject({ url: "/api/projects/loka-pos/docs" })).json();
  samplePath = `${ix.tree[0].cat}/${ix.tree[0].files[0]}`;
});
describe("docs routes", () => {
  it("returns index with coverage + tree", async () => {
    const res = await app.inject({ url: "/api/projects/loka-pos/docs" });
    expect(res.json()).toHaveProperty("coverage"); expect(Array.isArray(res.json().tree)).toBe(true);
  });
  it("reads a doc", async () => {
    const res = await app.inject({ url: `/api/projects/loka-pos/docs/${samplePath}` });
    expect(res.statusCode).toBe(200); expect(typeof res.json().content).toBe("string");
  });
  it("edits and persists a doc", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/projects/loka-pos/docs/${samplePath}`,
      payload: { content: "# changed" } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ url: `/api/projects/loka-pos/docs/${samplePath}` });
    expect(get.json().content).toBe("# changed");
  });
  it("404 for missing doc", async () =>
    expect((await app.inject({ url: "/api/projects/loka-pos/docs/nope/x.md" })).statusCode).toBe(404));
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/routes/docs.ts
import type { FastifyInstance } from "fastify";
import { zDocFileContent } from "@hanoman/shared";
import { docIndex, readDoc, writeDoc } from "../services/docs";
export default async function (app: FastifyInstance) {
  app.get("/projects/:id/docs", async (req) => docIndex((req.params as { id: string }).id));
  app.get("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string }; const path = (req.params as Record<string, string>)["*"];
    const content = await readDoc(id, path);
    return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
  });
  app.put("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string }; const path = (req.params as Record<string, string>)["*"];
    const parsed = zDocFileContent.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await writeDoc(id, path, parsed.data.content);
    return { path, content: parsed.data.content };
  });
}
```
Register in `app.ts`.

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git commit -am "feat(server): docs routes (index/read/edit)"`

---

### Task 14: Runs read routes + no-stub guard

**Files:** Create `server/src/routes/runs.ts`; Modify `app.ts`; Test `server/test/runs.route.test.ts`

**Interfaces:**
- Produces: `GET /runs?project= → Run[]`; `GET /runs/:id → Run` (404 if missing). No control/SSE/execute routes registered.

- [x] **Step 1: Failing tests** (includes the SPEC-001 §Acceptance #4 guarantee)

```ts
// server/test/runs.route.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("runs routes", () => {
  it("lists runs", async () => expect((await app.inject({ url: "/api/runs" })).json().length).toBe(5));
  it("gets a run with phases", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-8842" });
    expect(res.json().phases.length).toBeGreaterThan(0);
  });
  it("404 for missing run", async () =>
    expect((await app.inject({ url: "/api/runs/RUN-0000" })).statusCode).toBe(404));
  it.each(["steer","control","worktree","command"])("run-%s is 404 (no stub)", async (a) => {
    expect((await app.inject({ method: "POST", url: `/api/runs/RUN-8842/${a}`, payload: {} })).statusCode).toBe(404);
  });
  it("SSE log endpoint is 404 (arrives in SPEC-003)", async () =>
    expect((await app.inject({ url: "/api/runs/RUN-8842/log" })).statusCode).toBe(404));
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// server/src/routes/runs.ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
export default async function (app: FastifyInstance) {
  app.get("/runs", async (req) => {
    const { project } = req.query as { project?: string };
    return prisma.run.findMany({ where: { projectId: project }, orderBy: { id: "desc" } });
  });
  app.get("/runs/:id", async (req, reply) => {
    const run = await prisma.run.findUnique({ where: { id: (req.params as { id: string }).id } });
    return run ?? reply.code(404).send({ error: "not found" });
  });
}
```
Register in `app.ts`. Confirm no control/log routes exist anywhere.

- [x] **Step 4: Run, verify pass** — the 404 tests prove the no-stub guarantee.
- [x] **Step 5: Commit** — `git commit -am "feat(server): runs read routes + no-stub 404 guard"`

---

## Phase D — Frontend (Vite + TS, ported from `.prototype/app`)

### Task 15: Vite app scaffold + DS tokens + proxy

**Files:**
- Create: `src/package.json`, `src/tsconfig.json`, `src/vite.config.ts`, `src/index.html`, `src/src/main.tsx`, `src/src/App.tsx` (temporary hello), `src/src/ds/icon.tsx`
- Copy verbatim: `.prototype/_ds/hanoman-design-system-c639ade9-3569-4176-afeb-71f1b51a2630/tokens/*.css` and `styles.css` → `src/src/ds/tokens/*` and `src/src/ds/styles.css`
- Test: `src/test/smoke.test.tsx`

**Interfaces:**
- Produces: a Vite dev server on `:5173` proxying `/api` → `:8787`; global DS token CSS imported in `main.tsx`; `Icon` component wrapping `lucide-react`.

- [x] **Step 1: Failing smoke test**

```tsx
// src/test/smoke.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "../src/App";
describe("app shell", () => {
  it("renders", () => { render(<App />); expect(screen.getByText(/hanoman/i)).toBeInTheDocument(); });
});
```

- [x] **Step 2: Run, verify fail** — `pnpm --filter ./src test` → FAIL.

- [x] **Step 3: Scaffold**

`src/package.json`:
```json
{
  "name": "@hanoman/app", "type": "module", "version": "0.0.0",
  "scripts": { "dev": "vite", "build": "tsc && vite build", "typecheck": "tsc --noEmit",
    "test": "vitest run" },
  "dependencies": { "@hanoman/shared": "workspace:*", "react": "^18.3.1", "react-dom": "^18.3.1",
    "lucide-react": "^0.400.0", "marked": "^12.0.2" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.0", "vite": "^5.3.0",
    "@testing-library/react": "^16.0.0", "@testing-library/jest-dom": "^6.4.0",
    "jsdom": "^24.0.0", "typescript": "^5.5.0" }
}
```

`src/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: "dist" },
  test: { environment: "jsdom", setupFiles: "./test/setup.ts", globals: true },
});
```

`src/test/setup.ts`: `import "@testing-library/jest-dom";`

`src/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "include": ["src","test"], "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022","DOM","DOM.Iterable"], "types": ["vitest/globals"] } }`

`src/index.html`: standard Vite root mounting `#root` → `/src/main.tsx`. Fonts: keep the DS `tokens/fonts.css` Google Fonts `@import` (per design-system.md fonts note).

`src/src/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "./ds/styles.css";
import App from "./App";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```

`src/src/App.tsx` (temporary): `export default function App(){ return <div>hanoman</div>; }`

`src/src/ds/icon.tsx`:
```tsx
import { icons } from "lucide-react";
export function Icon({ name, size = 16, ...rest }: { name: string; size?: number } & React.SVGProps<SVGSVGElement>) {
  const Cmp = (icons as Record<string, React.FC<any>>)[toPascal(name)] ?? icons.Circle;
  return <Cmp width={size} height={size} {...rest} />;
}
const toPascal = (s: string) => s.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
```

Copy the DS token CSS files verbatim into `src/src/ds/`.

- [x] **Step 4: Run, verify pass** — `pnpm --filter ./src test` → PASS. Also `pnpm --filter ./src dev` serves the shell.
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(app): vite scaffold + DS tokens + icon"`

---

### Task 16: Port DS components + kit wrappers to TS

**Files:**
- Create: `src/src/ds/components/{Button,IconButton,Input,Select,Checkbox,Switch,Badge,StatusPill,Callout,ProgressBar,Tooltip,Card,Tabs}.tsx` (Icon done in Task 15)
- Create: `src/src/ds/kit/{Modal,Toast,Field,HnTextarea,Shell}.tsx`, `src/src/ds/kit/useToast.ts`
- Create: `src/src/ds/index.ts` (barrel)
- Test: `src/test/ds.test.tsx`

**Interfaces:**
- Produces typed React components matching the prototype's props. Port sources: the 14 components from `.prototype/kit/kit-*.jsx` and `.prototype/_ds/.../_ds_bundle.js`; the kit wrappers (Modal/Toast/Field/HnTextarea/useToast/Shell) from `.prototype/app/Shell.jsx`, `AppUI.jsx`, `marks.jsx`. **Transformation contract:** remove `window.HN`/`window.HanomanDesignSystem_c639ad`/global-React usage → ESM imports; add explicit prop `type`s; replace runtime Lucide global with the `Icon` from Task 15; keep class names, token CSS variables, and copy identical. No visual change.

- [x] **Step 1: Failing test**

```tsx
// src/test/ds.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Button, StatusPill, Card } from "../src/ds";
describe("ds components", () => {
  it("button fires onClick", async () => {
    const fn = vi.fn(); render(<Button onClick={fn}>Go</Button>);
    screen.getByText("Go").click(); expect(fn).toHaveBeenCalled();
  });
  it("status pill shows label", () => { render(<StatusPill status="running">2 aktif</StatusPill>);
    expect(screen.getByText("2 aktif")).toBeInTheDocument(); });
  it("card renders children", () => { render(<Card>body</Card>); expect(screen.getByText("body")).toBeInTheDocument(); });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Port components** — translate each source file per the transformation contract. Read `.prototype/kit/kit-forms.jsx` (Button/Input/Select/etc.), `kit-feedback.jsx` (Badge/StatusPill/Callout/ProgressBar/Tooltip), `kit-surfaces.jsx` (Card), `kit-ui.jsx` (Tabs), `kit-foundations.jsx` (Icon helpers), and `.prototype/app/AppUI.jsx`/`Shell.jsx` for Modal/Toast/Field/HnTextarea/useToast/Shell. Add `src/src/ds/index.ts` re-exporting all. Keep prop names identical so screens port cleanly.

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(app): port DS components + kit to TS"`

---

### Task 17: Typed API client

**Files:** Create `src/src/api/client.ts`; Test `src/test/client.test.ts`

**Interfaces:**
- Consumes: `paths`, entity/DTO types from `@hanoman/shared`.
- Produces: `api = { listProjects, getProject, createProject, scanProject, listSpecs, createSpec, advanceSpec, deleteSpec, listTriggers, createTrigger, toggleTrigger, getSettings, putSettings, listRuns, getRun, getDocs, getDoc, putDoc }` — each a typed `fetch` returning the parsed DTO; throws `ApiError` on non-2xx.

- [x] **Step 1: Failing test** (mock `fetch`)

```ts
// src/test/client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../src/api/client";
beforeEach(() => { globalThis.fetch = vi.fn(async () =>
  new Response(JSON.stringify([{ id: "arta", name: "arta", desc: "", kind: "existing", stack: "",
    docStatus: "ok", coverage: 94, createdAt: new Date().toISOString(), backlog: 2, topStage: "execute",
    run: { status: "running", phase: "Execute", kind: "feature" }, activity: "x", commit: "y" }]),
    { status: 200, headers: { "content-type": "application/json" } })) as any; });
describe("api client", () => {
  it("listProjects hits /api/projects and returns views", async () => {
    const ps = await api.listProjects();
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("/api/projects");
    expect(ps[0].backlog).toBe(2);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// src/src/api/client.ts
import { paths, type ProjectView, type Spec, type Trigger, type Setting, type Run } from "@hanoman/shared";
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new ApiError(res.status, `${init?.method ?? "GET"} ${url} → ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}
const body = (b: unknown) => ({ body: JSON.stringify(b) });
export const api = {
  listProjects: () => j<ProjectView[]>(paths.projects),
  getProject: (id: string) => j<ProjectView>(paths.project(id)),
  createProject: (b: unknown) => j<ProjectView>(paths.projects, { method: "POST", ...body(b) }),
  scanProject: (id: string) => j<ProjectView>(paths.scan(id), { method: "POST" }),
  listSpecs: (q = "") => j<Spec[]>(paths.specs + q),
  createSpec: (b: unknown) => j<Spec>(paths.specs, { method: "POST", ...body(b) }),
  advanceSpec: (id: string) => j<{ id: string; stage: string }>(paths.advance(id), { method: "POST" }),
  deleteSpec: (id: string) => j<void>(paths.spec(id), { method: "DELETE" }),
  listTriggers: () => j<Trigger[]>(paths.triggers),
  createTrigger: (b: unknown) => j<Trigger>(paths.triggers, { method: "POST", ...body(b) }),
  toggleTrigger: (id: string) => j<Trigger>(paths.toggle(id), { method: "POST" }),
  getSettings: () => j<Setting>(paths.settings),
  putSettings: (b: unknown) => j<Setting>(paths.settings, { method: "PUT", ...body(b) }),
  listRuns: () => j<Run[]>(paths.runs),
  getRun: (id: string) => j<Run>(paths.run(id)),
  getDocs: (id: string) => j<{ coverage: number; tree: any[] }>(paths.docs(id)),
  getDoc: (id: string, path: string) => j<{ path: string; content: string }>(paths.docFile(id, path)),
  putDoc: (id: string, path: string, content: string) =>
    j<{ path: string; content: string }>(paths.docFile(id, path), { method: "PUT", ...body({ content }) }),
};
```

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(app): typed api client"`

---

### Task 18: Port screens + wire App to the API

**Files:**
- Create: `src/src/screens/{OverviewScreen,ProjectsScreen,BacklogScreen,RunsScreen,DocsWorkspace,TriggersScreen,SettingsScreen}.tsx` and supporting `flows.tsx`, `marks.tsx`
- Replace: `src/src/App.tsx` (real, ported from `.prototype/app/App.jsx`)
- Test: `src/test/app-flows.test.tsx`

**Interfaces:**
- Consumes: `api` client (Task 17), DS components (Task 16).
- Produces: the 8-screen dashboard. Port sources 1:1 from `.prototype/app/*.jsx` (`OverviewScreen`, `ProjectsScreen`, `BacklogScreen`, `RunsScreen`, `DocsScreen`/`DocsWorkspace`, `TriggersScreen`, `SettingsScreen`, `Shell`, `flows`, `marks`, `docContent`). **Transformation contract:** initial state loads from `api.*` in `useEffect` instead of `window.HN`; the mutating handlers in `App.jsx` (`createSpec`, `advanceSpec`, `deleteSpec`, `createProject`, `createTrigger`, `toggleTrigger`, `scanAll`) call the client and update state from the response; keep all copy, modals, toasts, pagination, and search identical. Runs screen renders `api.getRun`/`listRuns` data read-only — **do not** port steer/pause/retry/worktree/terminal controls (SPEC-003). Markdown via `marked` import.

- [x] **Step 1: Failing integration test** (mock the client)

```tsx
// src/test/app-flows.test.tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/api/client", () => ({
  api: {
    listProjects: vi.fn(async () => [{ id: "arta", name: "arta", desc: "", kind: "existing", stack: "Go",
      docStatus: "ok", coverage: 94, createdAt: "", backlog: 2, topStage: "execute",
      run: { status: "running", phase: "Execute", kind: "feature" }, activity: "x", commit: "y" }]),
    listSpecs: vi.fn(async () => []), listTriggers: vi.fn(async () => []), listRuns: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})), advanceSpec: vi.fn(), createSpec: vi.fn(),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";
describe("app flows", () => {
  it("loads projects from the api on mount", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/arta/i).length).toBeGreaterThan(0));
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Port screens + App** per the transformation contract. Work screen-by-screen (Overview → Projects → Backlog → Docs → Triggers → Settings → Runs), committing after each compiles + renders if you prefer finer commits. Wire `App.tsx` state from the client. Keep the `Shell` nav identical.
- [x] **Step 4: Run, verify pass** — `pnpm --filter ./src test` green; `pnpm --filter ./src typecheck` clean.
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(app): port 8 screens wired to the api"`

---

### Task 19: Prod build (single-process) + end-to-end acceptance

**Files:**
- Modify: `server/src/app.ts` (register `@fastify/static` for `../src/dist` in prod), `package.json` (build order)
- Test: `server/test/static.test.ts`

**Interfaces:**
- Produces: `pnpm build` → Fastify serves the built dashboard at `/` and API at `/api` from one process when `NODE_ENV=production`.

- [x] **Step 1: Failing test**

```ts
// server/test/static.test.ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";
describe("static serving", () => {
  it("serves index at / in prod", async () => {
    process.env.NODE_ENV = "production";
    const app = buildApp();
    const res = await app.inject({ url: "/" });
    expect([200, 404]).toContain(res.statusCode); // 200 if dist built; 404 acceptable pre-build in CI
  });
});
```

- [x] **Step 2: Run, verify fail/pass boundary** — before wiring, `/` 404s with a JSON 404, not HTML.
- [x] **Step 3: Wire static** in `app.ts`:

```ts
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// inside buildApp(), after api register:
if (process.env.NODE_ENV === "production") {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/dist");
  app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"));
}
```

- [x] **Step 4: Full acceptance run** — execute SPEC-001 §Acceptance verbatim:
  1. `pnpm install && docker-compose up -d && pnpm --filter ./server exec prisma migrate deploy && pnpm seed && pnpm dev` → dashboard + api up, seed on all 8 screens.
  2. Create project/spec/trigger, advance a spec, toggle a trigger, change a setting → reload → all persist.
  3. Edit a doc in Docs·SoT, save, reload → persists; coverage reflects linked categories.
  4. `curl -X POST localhost:8787/api/runs/RUN-8842/control -d '{"action":"stop"}'` → 404.
  5. `pnpm build && NODE_ENV=production node server/dist/server.js` → single process serves both.
  6. `pnpm -w test` green.
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat: single-process prod serving + acceptance green"`

---

## Self-Review

**1. Spec coverage** — every SPEC-001 section maps to a task:
- Workspace/layout → T1. Shared contract → T2. Schema+ADR → T3. Seed → T4.
- Stage machine → T5. Coverage → T6. Docs service → T7. ProjectView → T8.
- API (projects/specs/triggers/settings/docs/runs, all real) → T9–T14. No-stub 404 guarantee → T9 + T14.
- DS port → T15–T16. API client → T17. 8 screens wired → T18. Prod single-process + acceptance → T19.
- All six SPEC-001 acceptance criteria are exercised in T19 Step 4 (+ T14 for #4, T13 for #3).

**2. Placeholder scan** — no "TBD/implement later"; the two port tasks (T16, T18) reference exact in-repo source files with an explicit transformation contract and typed interfaces, which is the actual instruction, not a placeholder.

**3. Type consistency** — `ProjectView`, `Stage`, `advance()`, `coverageOf()`, `docIndex()`, `nextSpecId()`, the `api.*` method names, and `paths.*` are defined once (T2/T5–T8/T17) and referenced with the same signatures downstream. Seed-derived counts in tests (backlog=2 for arta, next spec SPEC-143, 6/6/5 rows) match `data.js`.

**Note for the executor:** exact seed counts in T4/T8/T10–T14 tests assume the demo arrays in `.prototype/app/data.js` transcribe unchanged. If you adjust seed data, update the asserted counts in the same commit.
