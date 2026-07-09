# API contract

REST + SSE. Semua di bawah `/api`.

## Projects
```
GET  /projects
POST /projects            { name, kind, repoDir?, desc }
GET  /projects/:id
POST /projects/:id/scan   # re-scan docs SoT
```

## Backlog / specs
```
GET  /specs?project=&source=
POST /specs               { project, source, ...payload }  -> SPEC-n
# (dihapus) stage tak lagi dinaikkan manual — POST /runs { specId } memulai run,
# dan Spec.stage dicerminkan dari fase run nyata (lihat ADR-0008).
DELETE /specs/:id
```

## Runs
```
GET  /runs
GET  /runs/:id
GET  /runs/:id/log        # SSE stream: replay snapshot lalu relay live log/phase/status/cost/file
POST /runs/:id/steer      { message }
POST /runs/:id/control    { action: "pause"|"resume"|"stop"|"retry" }
POST /runs/:id/worktree   { branchFrom?, branchTo? }
POST /runs/:id/command    { text }   # terminal interaktif: verb baca render Run; resume/retry re-enqueue (jalur /control), free text pada run aktif → steer, docs <path> baca file nyata
```

## Triggers / settings / docs
```
GET/POST /triggers ; POST /triggers/:id/toggle ; DELETE /triggers/:id
#   POST validates detail: schedule=cron, interval=duration ("6h"/"30m"); else 400.
#   create/toggle/delete sync a BullMQ repeatable job (queue hanoman-schedules);
#   worker reconciles DB->schedulers on boot. On fire: fireTrigger -> enqueueRun
#   (plan+execute = one feature run per ready spec; audit/qa=qa; scaffold docs=scaffold).
GET/PUT  /settings
GET    /projects/:id/docs               # index + tree, live-scanned dari repoDir
GET    /projects/:id/docs/*path         # isi file .md asli (raw, dari disk)
PUT    /projects/:id/docs/*path         { content }   # tulis file .md asli; 400 kalau path keluar repo / bukan .md
DELETE /projects/:id/docs/*path         # hapus file .md asli di disk; 204 sukses, 404 tak ada, 400 guard
```

> Docs dibaca/ditulis **live dari `Project.repoDir`** (tanpa salinan DB — ADR-0011). Korpus = semua `**/*.md`
> via `git ls-files`. `GET /docs` re-scan tiap panggilan; `POST /projects/:id/scan` menyegarkan cache
> `Project.coverage`/`docStatus`. SoT coverage = % direktori yang seluruh Markdown-nya reachable dari root index.

## Webhook
```
POST /webhooks/github     # commit trigger -> enqueue
```
