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
GET/POST /triggers ; POST /triggers/:id/toggle
GET/PUT  /settings
GET  /projects/:id/docs                 # index + tree
GET  /projects/:id/docs/*path           # isi file (raw)
PUT  /projects/:id/docs/*path           { content }   # edit + simpan
```

## Webhook
```
POST /webhooks/github     # commit trigger -> enqueue
```
