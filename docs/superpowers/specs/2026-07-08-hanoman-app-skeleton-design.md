# SPEC-001 — hanoman foundation (real dashboard + server + persistence)

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)

## The spec sequence (context for this spec)

hanoman v1.0 is built as a **dependency-ordered sequence of specs, each fully real —
no no-op endpoints, no stubbed streams.** A subsystem's endpoints simply arrive real
when their spec lands, rather than being faked earlier. The sequence:

| Spec | Scope (all real) | Depends on |
|---|---|---|
| **SPEC-001 Foundation** *(this doc)* | pnpm workspace, Vite+TS dashboard (DS ported), Fastify, Postgres/Prisma, real CRUD for Project/Spec/Trigger/Setting/DocFile + SoT doc edit. | — |
| SPEC-002 CLI + Stop hook | `hanoman spec/plan/execute/scaffold/reverse` + `docs verify --block-if-stale` (ADR-0001). | 001 |
| SPEC-003 Runner + SSE | git worktree + Claude Code headless, real log streaming, run control, terminal. | 001, 002 |
| SPEC-004 Queue | BullMQ + Redis: concurrency + `maxConcurrent`/`dailyBudget` guardrails. | 003 |
| SPEC-005 Scheduler | cron: schedule/interval triggers enqueue real runs. | 004 |
| SPEC-006 Webhooks | GitHub App → commit trigger → enqueue run. | 004 |

Each spec is brainstormed + written on its own. This document is SPEC-001.

## Context

`.prototype/` is a complete, interactive front-end mockup of hanoman — 8 screens
(Overview, Projects, Backlog, Runs, Docs·SoT, Triggers, Settings), a real design
system, but running as static HTML + React-via-CDN with **mock data**
(`.prototype/app/data.js`, `docContent.js`). No backend, no persistence, no Claude
Code.

The SoT (`internal/docs/**`) defines the real target. None of it exists yet — `src/`,
`server/`, `package.json` are absent. This is greenfield. SPEC-001 lays the
foundation the other five specs build on: the real repo, dashboard, server, and
database, serving live persisted data in place of the mock.

## Goal

A pnpm workspace with a Vite+TS dashboard talking to a Fastify + Postgres backend.
All 8 screens are ported and wired to a real API. Every CRUD flow the prototype
fakes becomes persisted. Nothing in this spec is stubbed: the run **executor**
(SPEC-003), CLI/Stop-hook (SPEC-002), queue/scheduler/webhooks (004–006) are simply
not part of SPEC-001's surface — their endpoints and UI actions arrive real in their
own specs.

Definition of done:
- `pnpm install && docker-compose up -d && pnpm dev` boots dashboard + server.
- Every CRUD flow the prototype fakes is now persisted in Postgres.
- Editing a SoT doc in the UI saves and survives a reload.
- Tests green. Touched `internal/docs` updated + linked in its index.

## Approaches considered

The SoT (`stack.md`) fixes **React+Vite + Fastify**, so full-stack frameworks
(Next/Remix/TanStack Start) are off-SoT and rejected. That leaves:

1. **Pure monolith** — Fastify serves both `/api` and the built dashboard. Simplest
   deploy; but shared front/back dev loop and copy-pasted types.
2. **pnpm workspace: `src/` (Vite) + `server/` (Fastify) + `shared/` (zod/types)** —
   in dev, Vite proxies `/api` → Fastify; in prod, Fastify serves the built `src/`
   assets (keeping the monolith's one-process deploy). Clean separation, one
   type-safe source of truth for the API contract.

**Decision: #2.** Matches the README's `src/` + `server/`; shared zod schemas make
`api-contract.md` type-safe on both ends — a dividend on every later spec.

## Scope

### In scope
- pnpm workspace scaffold: `shared/`, `server/`, `src/`, `docker-compose.yml`.
- Prisma schema + Postgres for all `data-model.md` entities, seeded from the
  prototype's `data.js` / `docContent.js`.
- Fastify REST API for the CRUD entities (table below) — all real, all persisted.
- Dashboard ported from `.prototype/app/*.jsx` to TS React, wired to the API.
- Design-system port: token CSS verbatim, 14 components + kit wrappers to typed TS.
- Vitest test suites both sides.

### Out of scope — belongs to a later spec, built real there (never stubbed here)
- Run **execution**, control (steer/pause/resume/stop/retry), interactive terminal,
  and real SSE log streaming → **SPEC-003**. In SPEC-001 the Runs screen displays
  real, persisted run records (read-only); it has no run-control affordances yet.
- Trigger **firing** (a trigger record persists in SPEC-001; nothing executes it
  until the scheduler/webhook specs) → **SPEC-005 / SPEC-006**.
- `hanoman` CLI + `docs verify` Stop hook → **SPEC-002**.
- BullMQ/Redis queue → **SPEC-004**. GitHub webhooks → **SPEC-006**. Auth → later.

## Repo layout

```
package.json            pnpm workspace root
docker-compose.yml      postgres for local dev
shared/                 zod schemas + inferred TS types for every entity + API contract
server/
  prisma/schema.prisma  Project, Spec, Run, Trigger, Setting, DocFile
  prisma/seed.ts        loads prototype data.js + docContent.js
  src/routes/*          fastify route modules (one per entity group)
  src/services/*        coverage calc, spec stage machine, docs service
src/
  ds/tokens/*.css       copied verbatim from .prototype/_ds/.../tokens
  ds/styles.css         copied verbatim (import manifest)
  ds/components/*       14 DS components ported to TS React
  ds/kit/*              Modal, Toast, Field, Textarea, useToast, Shell ported to TS
  screens/*             Overview, Projects, Backlog, Runs, Docs, Triggers, Settings
  api/client.ts         typed fetch client over shared schemas
  App.tsx               nav + state, ported from .prototype/app/App.jsx
internal/docs/          unchanged — still the SoT
```

## Data & persistence (Prisma → Postgres)

One model per `data-model.md` entity. Seeded from `.prototype/app/data.js` +
`docContent.js` so the UI is alive on first `pnpm dev`.

- **Project** — `id` (slug), `name`, `desc`, `kind`, `repoDir?`/`repoUrl?`,
  `docStatus` ("ok"|"drift"|"broken"), `coverage` (0–100), `createdAt`.
- **Spec** — `id` (SPEC-n), `projectId`, `title`, `source` ("brief"|"qa"), `stage`
  ("brainstorming"|"objective"|"spec-ready"|"planned"|"executing"|"done"),
  `priority`, `author`, `objective`, `payload` (jsonb: brief or qa fields).
- **Run** — `id` (RUN-n), `projectId`, `specId?`, `kind`, `status`, `trigger`,
  `triggerDetail`, `phases` (jsonb), `plan` (jsonb), `files` (jsonb), `log` (jsonb),
  `worktree`, `branchFrom`, `branchTo`, `model` (jsonb), `tokensIn/Out`, `cost`,
  `progress`. **Read-only in SPEC-001** — seeded example runs so the screen isn't
  empty; live run creation/streaming/control is SPEC-003.
- **Trigger** — `id`, `projectId`, `type`, `detail`, `target`, `enabled`. CRUD is
  real; firing is SPEC-005/006.
- **Setting** — single workspace row: `steps` (jsonb), `autoDefault`, `blockStale`,
  `requireLinks`, `autoScaffold`, `maxConcurrent`, `dailyBudget`, `notifyFail`.
- **DocFile** — `projectId`, `path`, `category`, `content` (text), `linked` (bool),
  `root` (bool). Coverage = distinct linked categories / total categories.

**Decision (confirmed):** doc content lives in `DocFile` (DB), seeded from
`docContent.js` — `PUT .../docs {content}` needs a writable store and there is no
worktree yet. When SPEC-003 lands, docs move to the worktree's real files and
`DocFile` becomes a cache/index.

## API — all real (per `architecture/api-contract.md`)

REST under `/api`. Every request/response validated against the `shared/` zod
schemas so the contract can't silently drift.

| Endpoint group | SPEC-001 behavior |
|---|---|
| `GET/POST /projects`, `GET /projects/:id`, `POST /projects/:id/scan` | Real, persisted. `scan` recomputes coverage from `DocFile`. |
| `GET/POST /specs`, `POST /specs/:id/advance`, `DELETE /specs/:id` | Real, persisted. `advance` walks the stage machine. |
| `GET/POST /triggers`, `POST /triggers/:id/toggle` | Real, persisted (records only; firing is later). |
| `GET/PUT /settings` | Real, persisted (single workspace row). |
| `GET /projects/:id/docs`, `GET /projects/:id/docs/*path`, `PUT /projects/:id/docs/*path` | Real — index/tree + read + edit-save against `DocFile`. |
| `GET /runs`, `GET /runs/:id` | Real read of persisted (seeded) run records. |
| Run control / SSE / execute · webhooks | **Not part of SPEC-001** — arrive real in SPEC-003 / SPEC-006. No endpoint is registered for them here. |

## Frontend

- Port `.prototype/app/*.jsx` → TS React under `src/`. `App.jsx`'s state and mutating
  flows (`createSpec`, `advanceSpec`, `deleteSpec`, `createTrigger`, `toggleTrigger`,
  `createProject`, `scanAll`) call through `api/client.ts` instead of local mock
  mutations.
- **Design system:** copy `tokens/*.css` + `styles.css` verbatim (pure custom
  properties). Rebuild the 14 DS components (`_ds_bundle.js`) and the kit wrappers
  (Modal/Toast/Field/Textarea/useToast/Shell) as typed TS React from their `.jsx`
  sources — **no CDN React, no Babel-in-browser, no `window` globals.** Lucide +
  `marked` become npm imports.
- Non-`.md` doc files render as code blocks; `.md` via `marked`.
- **Runs screen** renders real persisted run data, read-only — no steer/pause/retry
  affordances yet (they ship real in SPEC-003).
- Layout per SoT: sidebar 248px + topbar 56px, content max 1200px, Docs full-width.

## Testing (TDD, per CLAUDE.md)

Vitest both sides, written test-first.
- **Server:** each route handler; the coverage calculation; the spec **stage
  machine** (`advance` transitions + guards); seed integrity — against a test
  Postgres.
- **Front:** the typed API client; the stage-advance reducer in `App`.
- The stage machine and coverage calc are the real orchestration logic → tightest
  coverage.

## Acceptance criteria

1. Fresh clone → `pnpm install && docker-compose up -d && pnpm dev` serves the
   dashboard and API; seed data visible on all 8 screens.
2. Create a project, a spec (brief + qa), a trigger; advance a spec through its
   stages; toggle a trigger; change a setting — all persist across reload.
3. Open Docs·SoT, edit a doc, save; reload → edit persists; coverage reflects
   linked categories.
4. Runs screen shows real persisted run records; no run-control endpoints exist yet
   (verified: they return 404 until SPEC-003, not a stubbed 202).
5. `pnpm build` produces assets Fastify serves as a single process in prod mode.
6. Tests green. Any touched `internal/docs` doc updated and linked in
   `internal/docs/README.md`.
