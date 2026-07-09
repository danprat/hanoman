# API contract

REST + SSE. Semua di bawah `/api`.

## Projects
```
GET  /projects
POST /projects            { name, kind, repoDir?, desc }
GET  /projects/:id
DELETE /projects/:id      # 409 bila ada run queued/running/paused; cascade ke spec/run/trigger.
#   Worktree on-disk di server/.worktrees/ tidak ikut dibersihkan.
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
POST /runs                { project, flow, branchFrom, branchTo?, specId? }  # 202 { runId }; 409 bila project tak punya repoDir absolut
DELETE /runs/:id          # 409 bila run masih queued/running/paused
GET  /runs/:id/log        # SSE stream: replay snapshot lalu relay live log/phase/status/cost/file
POST /runs/:id/steer      { message }
POST /runs/:id/control    { action: "pause"|"resume"|"stop"|"retry" }   # resume/retry → 409 bila run masih queued/running (satu run = satu worktree, ADR-0002)
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

> Docs dibaca/ditulis **live dari `Project.repoDir`** (tanpa salinan DB — ADR-0011). Korpus **browse** =
> semua `**/*.md` via `git ls-files`. `GET /docs` re-scan tiap panggilan, begitu pula `GET /projects`
> yang menurunkan `coverage`/`docStatus` per project (ADR-0018 — tak ada cache, tak ada `POST /scan`).
> Korpus **skor** = hanya file di bawah `docsDir` (default `internal/docs`) dikurangi index root;
> kategori di luarnya bertanda `scored: false` dan tidak dinilai. SoT coverage = % kategori berskor
> yang seluruh Markdown-nya **transitif reachable** dari `docsDir/README.md` (ADR-0013).

## Terminal
```
GET    /terminal/sessions            # [{ id, projectId, cwd, exited }]
POST   /terminal/sessions  {project} # 201 { id } · 404 project · 400 tanpa repoDir
DELETE /terminal/sessions/:id        # 204 · 404
GET    /terminal/sessions/:id/ws     # WebSocket; close 4004 bila sesi tak ada
#   server->klien: { t:"data", d } · { t:"exit", code }
#   klien->server: { t:"in", d } · { t:"resize", cols, rows }
```

> PTY menjalankan `claude --dangerously-skip-permissions` di `Project.repoDir`. Sesi hidup di
> proses API (in-memory); scrollback 256 KB terakhir di-replay saat klien reconnect. RCE by
> design — server bind `127.0.0.1` secara default, lihat ADR-0014.

## Webhook
```
POST /webhooks/github     # commit trigger -> enqueue
```
