# API contract

REST + SSE. Semua di bawah `/api`.

## Projects
```
GET  /projects
POST /projects            { name, kind, repoDir?, desc }
GET  /projects/:id
PATCH /projects/:id       { name?, desc? }   # 200 view; 400 name kosong; 404 tak ada.
#   `id` tak pernah berubah (kunci asing spec/run/trigger) — tak ada gate run aktif seperti DELETE.
POST /projects/:id/scan   # re-scan docs SoT
GET  /projects/:id/branches  -> { branches: string[] }   # refs/heads repoDir; [] bila tanpa repo. 404 project tak ada.
DELETE /projects/:id      # 409 bila ada run queued/running/paused; cascade ke spec/run/trigger.
#   Worktree on-disk di server/.worktrees/ tidak ikut dibersihkan.
```

## Backlog / specs
```
GET  /specs?project=&source=
POST /specs               { project, source, ...payload, branchFrom? }  -> SPEC-n
#   404 bila project tak dikenal; 400 bila branchFrom tak ada di refs/heads repo project.
PATCH /specs/:id          { branchFrom: string | null }   -> Spec
#   null = kembali ke default project (main). Menentukan basis run BERIKUTNYA; run yang
#   sudah jalan diubah lewat PATCH /runs/:id/worktree. Lihat ADR-0018.
# (dihapus) stage tak lagi dinaikkan manual — POST /runs { specId } memulai run,
# dan Spec.stage dicerminkan dari fase run nyata (lihat ADR-0008).
DELETE /specs/:id
```

## Runs
```
GET  /runs
GET  /runs/:id
POST /runs                { project, flow, branchFrom, branchTo?, specId? }  # 202 { runId }; 409 bila project tak punya repoDir absolut
DELETE /runs/:id          # 409 bila run masih queued/running/awaiting/paused
GET  /runs/:id/log        # SSE stream: replay snapshot lalu relay live log/phase/status/cost/ask
POST /runs/:id/steer      { message }
POST /runs/:id/answer     { value }   # 202; jawab Run.pendingAsk (SPEC-157). 409 bila run bukan `awaiting`
#   atau pendingAsk kosong; 400 bila body cacat atau `value` bukan salah satu pendingAsk.options[].value
#   (batas kepercayaan: hanya pilihan yang ditawarkan agen boleh mendarat di stdin-nya).
POST /runs/:id/control    { action: "pause"|"resume"|"stop"|"retry" }   # resume/retry → 409 bila run masih queued/running/awaiting (satu run = satu worktree, ADR-0002)
POST /runs/:id/worktree   { branchFrom?, branchTo? }
POST /runs/:id/command    { text }   # terminal interaktif: verb baca render Run; files/diff membaca GET /changes; resume/retry re-enqueue (jalur /control), free text pada run aktif → steer, docs <path> baca file nyata
GET  /runs/:id/changes          # { base, head, commits[], files[] } — hanya changes milik run ini
#   200 { base:null, … } bila run belum menyentuh worktree; 409 bila project tanpa repoDir,
#   worktree hilang tanpa commit, atau headSha tak terjangkau.
GET  /runs/:id/changes/*path    # { path, status, binary, truncated, diff, content }
#   404 bila path di luar daftar changes — daftar itu satu-satunya gerbang. content dipotong 256 KB.
```

> Changes diturunkan dari git tiap request — worktree selagi run hidup, `baseSha..headSha` setelah
> selesai — tak ada salinan DB (ADR-0019).

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

## VPS (SPEC-164 · ADR-0025)
```
GET    /vps                          # [{ id, name, host, port, user, keyPath, lastSeenAt,
                                     #    health, lastAuditAt, audit, hardened }]
POST   /vps  {name,host,user,port?,keyPath?}  # 201 · 400 bila host/user tak lolos regex
PATCH  /vps/:id                      # parsial · 200 · 400 body cacat · 404
DELETE /vps/:id                      # 204 · 404 (registrasi saja; server-nya tak disentuh)
POST   /vps/:id/audit                # 200 { audit, hardened } · 404 · 502 { error, out }
POST   /vps/:id/harden               # 200 { transcript, audit, hardened } · 404
                                     # 502 { error, transcript[, verify] } bila ssh gagal
                                     # atau verifikasi koneksi pasca-harden gagal
POST   /vps/:id/session              # 201 { id } — sesi claude tmux berkonteks VPS · 404
```

> Audit/healthcheck/harden = script bash deterministik (`server/scripts/vps/*.sh`) dikirim
> lewat `ssh … 'sudo -n bash -s'`. `hardened` = semua check kritis `pass` pada audit terakhir.
> Harden TIDAK PERNAH terjadwal; healthcheck (5 mnt) dan audit (24 jam) berjalan lewat
> `setInterval` di `server.ts`. Endpoint ini eksekusi remote — postur keamanannya sama dengan
> `/terminal`: tanpa auth, bergantung pada bind `127.0.0.1`.

## Webhook
```
POST /webhooks/github     # commit trigger -> enqueue
```
