# API contract

REST + SSE. Semua di bawah `/api`.

> **Auth (SPEC-169, ADR-0028):** semua endpoint butuh sesi valid (cookie `hn_session`) — gate
> `onRequest` membalas **401** tanpa sesi. Publik tanpa sesi hanya: `GET /health`,
> `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`.

## Auth
```
GET  /auth/status         -> { needsSetup: bool, user: {id,email,createdAt}|null }   # publik
POST /auth/setup          { email, password }   # HANYA saat 0 user; set cookie; 409 bila sudah ada; 400 body cacat
POST /auth/login          { email, password }   # set cookie; 401 generic; 429 throttled; 400 body cacat
POST /auth/logout         # 204; hapus sesi + clear cookie
GET  /auth/users          -> UserView[]                          # sesi
POST /auth/users          { email, password }   -> UserView      # invite (set password langsung); 409 email dipakai
DELETE /auth/users/:id    # 204; 400 bila user terakhir
POST /auth/change-password { currentPassword, newPassword }  # 200 + cookie baru (cabut sesi lain); 400 password lama salah
#   UserView = { id, email, createdAt } — tak pernah membawa passwordHash. password min 8 saat setup/invite/ganti.
```

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
PATCH /specs/:id          { branchFrom?: string|null, stage?, confirmDelete? }   -> Spec
#   branchFrom null = kembali ke default project (main); menentukan basis run BERIKUTNYA;
#   run yang sudah jalan diubah lewat PATCH /runs/:id/worktree. Lihat ADR-0018.
#   stage = revert backward-only atas perintah human (SPEC-167/ADR-0027): 422 bila maju/sama,
#   400 bila stage tak dikenal. Bila mundur menghapus artefak docs & confirmDelete≠true →
#   200 { pending:true, stage, wouldDelete:string[] } (dry-run, tak mengubah apa pun);
#   confirmDelete:true → hapus artefak + set stage. Agen tetap forward-only (ADR-0008/0024).
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
POST   /terminal/sessions  {project, flow?} # 201 { id } · 404 project · 400 tanpa repoDir
#   flow "reverse" (SPEC-166, ADR-0026): sesi project-level di worktree .worktrees/reverse-<project>
#   dengan prompt standar docs; 422 bila repoDir kosong atau worktree gagal dibuat
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
POST   /vps  {name,host,user,port?,keyPath?,password?}  # 201 · 400 host/user cacat
                                     # password (SPEC-165) = bootstrap key sekali pakai:
                                     # dipasang ke authorized_keys, diverifikasi key-only,
                                     # lalu dibuang. Gagal → 502 dan TIDAK ada baris lahir.
PATCH  /vps/:id                      # parsial · 200 · 400 body cacat · 404
                                     # `password` = bootstrap ulang → 502 bila gagal
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
> `setInterval` di `server.ts`. Endpoint ini eksekusi remote — sejak SPEC-169 tergerbang sesi auth
> (seperti seluruh `/api`), dan tetap direkomendasikan bind `127.0.0.1` di belakang reverse proxy TLS.
>
> Password tak pernah disimpan, di-log, atau dikembalikan; ia diserahkan ke ssh lewat
> SSH_ASKPASS (bukan argv) dan hidup beberapa detik di env proses anak (ADR-0025, SPEC-165).

## Webhook
```
POST /webhooks/github     # commit trigger -> enqueue
```
