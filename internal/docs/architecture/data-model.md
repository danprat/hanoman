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
- `createdAt`, `finishedAt?` (null selama berjalan; di-set saat status terminal — durasi = `(finishedAt ?? now) − createdAt`, lihat ADR 0007)
- `phases[]` di-seed dari pipeline flow saat enqueue (semua `pending`), lalu tiap event membalik state di tempat (`active`/`done`/`failed`); `progress` = persen phase ber-state `done` (run yang mati di fase akhir tampil mis. 80%, bukan 0%). Lihat SPEC-010.

## Trigger
- `id`, `projectId`, `type`, `detail`, `target` ("plan + execute" | "audit" | "scaffold docs"), `enabled`

## Docs (Source of Truth) — TIDAK dipersist
Docs bukan entitas DB. Tabel `DocFile` sudah di-drop (ADR-0011). Docs dibaca **live dari
`Project.repoDir`**: korpus = semua `**/*.md` via `git ls-files`, dikelompokkan per direktori,
`linked` = reachable dari root index (`internal/docs/README.md` → `README.md`) lewat graf link Markdown.
- coverage = % direktori yang seluruh Markdown-nya reachable dari index (disimpan sebagai cache di `Project.coverage`, disegarkan oleh `POST /projects/:id/scan`).

## Settings (per workspace)
- `steps`: { brainstorm|spec|plan|execute|audit: { model, effort } } (default opus/x-high)
- `autoDefault`, `blockStale`, `requireLinks`, `autoScaffold`, `maxConcurrent`, `dailyBudget`, `notifyFail`

## Kunci: docs sebagai gerbang
Sebelum `Run` boleh masuk fase execute, DocIndex project harus lolos verifikasi (tidak stale, semua doc acuan ter-link). Lihat ADR 0001.

Gate `docs verify` membedakan tiga hasil: bersih → lanjut; docs benar-benar stale → `plan diblok · <violations>`; **tool verify-nya crash → di-retry sekali, lalu `guardrail tool error · <stderr>` dan fail-closed** (tidak disamarkan jadi "docs stale"). Lihat SPEC-010 / ADR-0009.
