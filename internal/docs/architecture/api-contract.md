# API contract

REST + **WebSocket (terminal + events)** + HTTP GET (initial load). Semua di bawah `/api`. Tidak
ada SSE, tidak ada `/runs`, `/triggers`, maupun `/webhooks` — dicabut bersama runner headless
(ADR-0024). Data real-time dashboard (backlog/sesi/notifikasi/limits/vps) **didorong** lewat satu
WebSocket siar `GET /events/ws` (SPEC-199, ADR-0039) — bukan lagi polling. Terminal PTY punya
WebSocket per-sesi tersendiri. Endpoint HTTP GET tiap sumber tetap ada untuk paint pertama.

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
GET  /projects?q=&page=&limit=      # -> { items: ProjectView[], total, page, pageSize } (SPEC-198)
#   q menyaring name+desc+stack; tanpa page/limit → seluruh item. coverage/docStatus tetap live-scan tiap panggil.
POST /projects            { name, kind, repoDir?, desc }
GET  /projects/:id
PATCH /projects/:id       { name?, desc? }   # 200 view; 400 name kosong; 404 tak ada.
#   `id` tak pernah berubah (kunci asing spec) — tak ada endpoint rename.
GET  /projects/:id/branches  -> { branches: string[], remotes: string[] }   # branches=refs/heads, remotes=refs/remotes/origin (tanpa prefix origin/, tanpa HEAD); [] bila tanpa repo. 404 project tak ada. remotes memasok target rebase/merge (SPEC-175).
DELETE /projects/:id      # 409 bila ada sesi tmux aktif milik project; cascade ke spec.
#   Worktree on-disk di <repoDir>/.worktrees/ tidak ikut dibersihkan.
```

> Coverage/docStatus di-scan **live** tiap `GET /projects` (ADR-0018) — tak ada cache, tak ada `POST /scan`.

## Backlog / specs
```
GET  /specs?project=&source=&q=&stage=&priority=&startable=&page=&limit=
#   -> { items: Spec[], total, page, pageSize }. SELALU envelope (SPEC-198).
#   Overlay stage-live dari phase-file + write-through CAS + notifikasi `done` jalan atas SET PENUH
#   (scope project/source). Search/filter (q atas id+title+objective, stage, priority, startable=live≠done)
#   & paginasi diterapkan DI MEMORI SETELAH overlay — filter stage cocok ke stage LIVE, bukan DB.
#   Tanpa page/limit → seluruh item terfilter (page 1, pageSize=total). Lihat ADR-0038.
POST /specs               { project, source, ...payload, branchFrom? }  -> SPEC-n
#   404 bila project tak dikenal; 400 bila branchFrom tak ada di refs/heads repo project.
PATCH /specs/:id          { branchFrom?: string|null, stage?, confirmDelete? }   -> Spec
#   branchFrom null = kembali ke default project (main); menentukan basis sesi BERIKUTNYA. Lihat ADR-0032.
#   stage = revert backward-only atas perintah human (SPEC-167/ADR-0027): 422 bila maju/sama,
#   400 bila stage tak dikenal. Bila mundur menghapus artefak docs & confirmDelete≠true →
#   200 { pending:true, stage, wouldDelete:string[] } (dry-run, tak mengubah apa pun);
#   confirmDelete:true → hapus artefak + set stage. Sesi tetap forward-only (ADR-0008/0024).
DELETE /specs/:id
GET  /specs/:id/docs                   # daftar dokumen superpowers backlog ini (audit/spec/plan/objective/brainstorm) — SPEC-170
GET  /specs/:id/docs/*path             # isi satu dokumen superpowers (raw)
GET  /specs/:id/review                 # { base, files:string[], changed:{path,add,del,status,binary}[] }  (SPEC-171)
#   worktree hidup <repoDir>/.worktrees/<specid> → diff working tree, base = merge-base(branchFrom‖main, HEAD).
#   worktree lenyap (done) → diff baseSha..headSha tersimpan (SPEC-176, ADR-0030), fallback grep (spec-N) utk spec lama.
#   files = git ls-files (tracked ∪ untracked-tak-ignored, minus --deleted). 409 bila tak ada sumber apa pun.
GET  /specs/:id/review/*path           # { path, status, binary, truncated, diff, content }  isi 1 file (256 KB)
#   404 bila path di luar (files ∪ changed) — sekaligus gerbang path traversal.
POST /specs/:id/integrate     { op:"merge"|"rebase", target:"local:<b>"|"origin:<b>" }  (SPEC-175 · ADR-0031)
#   Rebase/merge branch hasil done spec `hanoman/<id>`. Hanya stage `done` (else 409). Server jalankan git
#   di worktree isolasi <repoDir>/.worktrees/merge-<id>, TAK menyentuh working tree utama.
#   merge → target: base tip target, `git merge` branch spec; bersih → target lokal: `git branch -f` bila branch
#     tak di-checkout, else fast-forward `git merge --ff-only` di worktree pemiliknya (409 bila working tree
#     kotor/bukan-ff — commit/stash lalu ulangi atau pilih origin); target origin `git push` (409 non-ff). rebase → replay branch
#     spec di atas target, bersih → `git push --force-with-lease` ke hanoman/<id>.
#   Bersih → 200 { status:"clean", detail }. Conflict → 200 { status:"conflict", sessionId } — sesi claude di
#     worktree konflik itu menyelesaikannya (dibuka di Terminal). 400 op/target invalid; 409 non-done/source hilang.
```

## Docs (project SoT)
```
GET    /projects/:id/docs               # index + coverage + tree kategori, live-scanned dari repoDir
GET    /projects/:id/docs/*path         # isi file .md asli (raw, dari disk)
PUT    /projects/:id/docs/*path         { content }   # tulis file .md asli; 400 kalau path keluar repo / bukan .md
DELETE /projects/:id/docs/*path         # hapus file .md asli di disk; 204 sukses, 404 tak ada, 400 guard
```

> Docs dibaca/ditulis **live dari `Project.repoDir`** (tanpa salinan DB — ADR-0011). Korpus **browse** =
> semua `**/*.md` via `git ls-files`. `GET /docs` re-scan tiap panggilan, begitu pula `GET /projects`
> yang menurunkan `coverage`/`docStatus` per project (ADR-0018 — tak ada cache).
> Korpus **skor** = hanya file di bawah `docsDir` (default `internal/docs`) dikurangi index root;
> kategori di luarnya bertanda `scored: false`. SoT coverage = % kategori berskor yang seluruh
> Markdown-nya **transitif reachable** dari `docsDir/README.md` (ADR-0013).

## IDE Visual (SPEC-182 · ADR-0034)
```
GET    /projects/:id/tree?ref=          # { ref, files:string[] }  ref kosong=working tree (ls-files), isi=ls-tree <ref>; 404 project tak ada
GET    /projects/:id/file?path=&ref=    # { path, content, binary, truncated }  disk / git show <ref>:<path>; 400 path keluar repo/.git; 404 file tak ada
PUT    /projects/:id/file               { path, content }   # tulis file ke working tree; 400 guard path. TAK digerbang sesi.
GET    /projects/:id/graph?limit=200    # { commits:{sha,parents,author,at,subject,refs}[], current }  git log --all --date-order
GET    /projects/:id/commit/:sha        # { sha,parents,author,at,subject,body, changed:{path,add,del,status,binary}[] }  404 sha bukan hex / tak ada
POST   /projects/:id/git                { op, ...args, force? }   # { ok, stdout, stderr, current }
#   op ∈ checkout|branch|merge|cherry-pick|revert|delete-branch. 400 op/field cacat; 400 tanpa repoDir.
#   merge menerima ff opsional (SPEC-193): absen=default git (ff bila bisa); "no-ff"=selalu merge commit; "ff-only"=ff saja (409 bila tak bisa). ff lain → 400.
#   merge menerima deleteBranch opsional (SPEC-193): setelah merge sukses, hapus branch itu lokal (-D) lalu origin bila remote-tracking-nya ada (git push origin --delete). "" → 400. Gagal salah satu langkah → 409 (merge tetap terjadi).
#   409 bila ada sesi aktif project (force melewatinya) ATAU git exit≠0 (stderr diteruskan). force → -f/-D.
```

> Semua bekerja pada **`Project.repoDir` (working tree utama)** — read diturunkan dari git tiap request
> (tanpa cache, cermin ADR-0018). Mutasi git digerbang sesi-aktif + tree-bersih dengan escape `force`
> (ADR-0034). Read-di-`ref` memungkinkan **melihat** branch local/origin tanpa checkout.

## Settings / notifications / limits
```
GET/PUT  /settings                      # Setting blob (zSetting): model, effort, autoDefault, autoScaffold,
#                                         notifyFail, notifyDone (bool), notifySound — SPEC-180. Tanpa dailyBudget/maxConcurrent.
GET      /notifications                 # { items:Notification[] (≤50 terbaru dulu), unread:int }  (SPEC-180)
#   Notification dibuat server-side saat backlog masuk `done` (advanceStage + write-through GET /specs).
POST     /notifications/read            # 204; tandai semua unread jadi terbaca
DELETE   /notifications                 # 204; clear semua
GET      /limits                        # { …usage } dari OAuth usage API Anthropic (cache 30s, stale/unavailable fallback) — SPEC-181/ADR-0024
GET      /fs/browse?path=               # directory picker sisi server (untuk memilih repoDir project)
GET      /health                        # publik; liveness
```

## Terminal
```
GET    /terminal/sessions            # [{ id, projectId, cwd, exited }]
POST   /terminal/sessions  {project, flow?} # 201 { id } · 404 project · 400 tanpa repoDir
#   {spec, flow} (SPEC-162): sesi backlog item di worktree .worktrees/<spec>, prompt pipeline penuh
#   SPEC-172: bila Spec.stage === "done", sesi baru dibuka dengan prompt LANJUTAN (fase Execute
#     saja, continuePrompt) alih-alih pipeline penuh — reopen backlog yang keburu selesai.
#   flow "reverse" (SPEC-166, ADR-0026): sesi project-level di worktree .worktrees/reverse-<project>
#   dengan prompt standar docs; 422 bila repoDir kosong atau worktree gagal dibuat
GET    /terminal/sessions/:id/phases # fase yang sudah dilaporkan sesi (dari $HANOMAN_PHASE_FILE) → stage live
DELETE /terminal/sessions/:id        # 204 · 404; menutup sesi: majukan stage, simpan headSha, removeWorktree
GET    /terminal/sessions/:id/ws     # WebSocket; close 4004 bila sesi tak ada
#   server->klien: { t:"data", d } · { t:"phase", … } · { t:"exit", code }
#   klien->server: { t:"in", d } · { t:"resize", cols, rows }
```

> PTY menjalankan `claude --dangerously-skip-permissions` di worktree/`repoDir`, di dalam **tmux**
> (socket `-L hanoman`) sehingga sesi hidup melewati restart API (ADR-0016); scrollback 256 KB terakhir
> di-replay saat klien reconnect. RCE by design — server bind `127.0.0.1` secara default, lihat ADR-0014.

## Events (SPEC-199 · ADR-0039)
```
GET    /events/ws                    # WebSocket siar dashboard (global). Auth = gate /api (cookie).
#   server->klien (per-grup, saat berubah; snapshot penuh saat connect):
#     { t:"specs", specs } · { t:"sessions", sessions } · { t:"notifications", items, unread }
#     { t:"limits", limits } · { t:"vps", vps }
#   klien->server: — (read-only feed; frame masuk diabaikan)
```

> Satu loop server (cadence per-grup, dedup signature) menggantikan N-klien × poll. Endpoint HTTP
> GET tiap sumber tetap ada untuk paint pertama.

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
POST   /vps/:id/session              # 201 { id } — sesi claude tmux berkonteks VPS (cwd $HOME) · 404
```

> Audit/healthcheck/harden = script bash deterministik (`server/scripts/vps/*.sh`) dikirim
> lewat `ssh … 'sudo -n bash -s'`. `hardened` = semua check kritis `pass` pada audit terakhir.
> Harden TIDAK PERNAH terjadwal; healthcheck (5 mnt) dan audit (24 jam) berjalan lewat
> `setInterval` di `server.ts`. Endpoint ini eksekusi remote — tergerbang sesi auth (seperti seluruh
> `/api`), dan tetap direkomendasikan bind `127.0.0.1` di belakang reverse proxy TLS.
>
> Password tak pernah disimpan, di-log, atau dikembalikan; ia diserahkan ke ssh lewat
> SSH_ASKPASS (bukan argv) dan hidup beberapa detik di env proses anak (ADR-0025, SPEC-165).
