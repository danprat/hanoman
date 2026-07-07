# Data model

Entitas inti (Postgres via Prisma).

## Project
- `id` (slug), `name`, `desc`, `kind` ("from-scratch" | "existing"), `repoDir`/`repoUrl`
- `docStatus` ("ok" | "drift" | "broken"), `coverage` (0–100)
- `createdAt`

## Spec (backlog item)
- `id` (SPEC-n), `projectId`, `title`, `source` ("brief" | "qa")
- `stage` ("brainstorming" | "objective" | "spec-ready" | "planned" | "executing" | "done")
- `priority` ("tinggi" | "sedang" | "rendah"), `author`, `objective`
- payload brief (context/outcome/constraints) atau qa (severity/steps/expected/actual/env)

## Run
- `id` (RUN-n), `projectId`, `specId?`, `kind` ("feature" | "qa" | "scaffold")
- `status` ("queued" | "running" | "paused" | "stopped" | "failed" | "done")
- `trigger` ("commit"|"schedule"|"manual"|"interval"), `triggerDetail`
- `phases[]` ({ name, state }), `plan[]`, `files[]` (diff), `log[]`
- `worktree`, `branchFrom`, `branchTo`, `model` per step, `tokensIn/out`, `cost`, `progress`

## Trigger
- `id`, `projectId`, `type`, `detail`, `target` ("plan + execute" | "audit" | "scaffold docs"), `enabled`

## DocIndex (Source of Truth)
- `projectId`, `category`, `files[]`, `linked` (ter-index), `root` (repo-root file)
- coverage = kategori linked / total.

## Settings (per workspace)
- `steps`: { brainstorm|spec|plan|execute|audit: { model, effort } } (default opus/x-high)
- `autoDefault`, `blockStale`, `requireLinks`, `autoScaffold`, `maxConcurrent`, `dailyBudget`, `notifyFail`

## Kunci: docs sebagai gerbang
Sebelum `Run` boleh masuk fase execute, DocIndex project harus lolos verifikasi (tidak stale, semua doc acuan ter-link). Lihat ADR 0001.
