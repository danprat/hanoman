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
POST /specs/:id/advance   # kunci objective / tulis spec / plan / execute
DELETE /specs/:id
```

## Runs
```
GET  /runs
GET  /runs/:id
GET  /runs/:id/log        # SSE stream (log + status)
POST /runs/:id/steer      { message }
POST /runs/:id/control    { action: "pause"|"resume"|"stop"|"retry" }
POST /runs/:id/worktree   { branchFrom?, branchTo? }
POST /runs/:id/command    { text }   # terminal interaktif
```

## Triggers / settings / docs
```
GET/POST /triggers ; POST /triggers/:id/toggle ; DELETE /triggers/:id
#   POST validates detail: schedule=cron, interval=duration ("6h"/"30m"); else 400.
#   create/toggle/delete sync a BullMQ repeatable job (queue hanoman-schedules);
#   worker reconciles DB->schedulers on boot. On fire: fireTrigger -> enqueueRun
#   (plan+execute = one feature run per ready spec; audit/qa=qa; scaffold docs=scaffold).
GET/PUT  /settings
GET  /projects/:id/docs                 # index + tree
GET  /projects/:id/docs/*path           # isi file (raw)
PUT  /projects/:id/docs/*path           { content }   # edit + simpan
```

## Webhook
```
POST /webhooks/github     # commit trigger -> enqueue
```
