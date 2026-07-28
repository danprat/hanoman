# API contract

REST + **WebSocket (terminal + events)** + HTTP GET (initial load). Semua di bawah `/api`. Tidak
ada SSE, tidak ada `/runs`, `/triggers`, maupun `/webhooks` — dicabut bersama runner headless
(ADR-0024). Data real-time dashboard (backlog/sesi/notifikasi/limits/vps) **didorong** lewat satu
WebSocket siar `GET /events/ws` (SPEC-199, ADR-0039) — bukan lagi polling. Terminal PTY punya
WebSocket per-sesi tersendiri. Endpoint HTTP GET tiap sumber tetap ada untuk paint pertama.

> **Auth (SPEC-169, ADR-0028):** semua endpoint butuh sesi valid (cookie `hn_session`) — gate
> `onRequest` membalas **401** tanpa sesi. Publik tanpa sesi hanya: `GET /health`,
> `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`.
>
> **Agent token (SPEC-257 · ADR-0065):** jalur auth **kedua** untuk AI agent eksternal —
> `Authorization: Bearer <token>` (upgrade WebSocket: `?agent_token=`) digerbang gate yang sama,
> lalu ditegakkan **capability per-domain read/write** (write⊇read). Cookie sesi = akses penuh (tak
> ada RBAC); agen tanpa capability → **403** `{ need }`; master switch `Setting.agentAccessEnabled` off →
> **401**. Lihat `## Agent tokens` di bawah.

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
POST /projects            { name, kind, repoDir?, desc, gitRemote? }   # repoDir OPSIONAL (SPEC-217)
#   SPEC-222 · kind "from-scratch" + repoDir → hanoman `git init` + commit awal (siap scaffold); gagal init → 400
GET  /projects/:id        # view memuat `repoDir` (default project) + `binding` (override per-mesin | null)
PATCH /projects/:id       { name?, desc?, gitRemote?, repoDir? }   # 200 view; 400 name kosong; 404 tak ada.
#   `id` tak tersentuh oleh PATCH — rename lewat endpoint khusus di bawah (SPEC-255/ADR-0064).
#   SPEC-217 · `repoDir` (path default/server) kini editable; `null` mengosongkan.
POST /projects/:id/rename { newId }   # 200 { id, dsnUrl?, helpUrl?, affected } · rename slug (SPEC-255/ADR-0064).
#   Transaksional: Project.id + cascade FK OTOMATIS (spec/errorGroup/ticket sudah ON UPDATE CASCADE) + update manual ref longgar
#   (notification/sessionResult/errorEvent/ticketAttachment) + pindah LocalBinding + naikkan version. Merambat ke
#   hub sync (penanda renamedFrom) → DSN /api/ingest/<id> & Help /help/<id> ikut ganti. `affected` = jumlah record
#   tersentuh per tabel. 400 slug invalid (^[a-z0-9][a-z0-9-]*$); 404 project; 409 id terpakai / ada sesi aktif.
GET  /projects/:id/branches  -> { branches: string[], remotes: string[] }   # dari path EFEKTIF (resolveRepoDir). [] bila tanpa repo. 404 project tak ada. remotes memasok target rebase/merge (SPEC-175).
DELETE /projects/:id      # 409 bila ada sesi tmux aktif milik project; cascade ke spec.
#   Worktree on-disk di <repoDir>/.worktrees/ tidak ikut dibersihkan.

# SPEC-213/217 · path per-mesin (LocalBinding, LOCAL-ONLY — TAK PERNAH disync). Menang atas Project.repoDir.
GET    /projects/:id/binding  -> { repoDir: string | null }   # nilai override mesin ini
PUT    /projects/:id/binding  { repoDir }   # 200 { repoDir }; set override; 400 kosong; 404 project.
DELETE /projects/:id/binding  # 204 · kosongkan override → path efektif jatuh ke Project.repoDir (SPEC-217). 404 project.
POST   /projects/:id/clone    { dir }   # 201 { repoDir } · git clone gitRemote→dir lalu set binding; 409 tanpa gitRemote / clone gagal.

# SPEC-249 · ADR-0060 · DSN ingest error per project (hash-at-rest; plaintext hanya di POST, sekali).
GET    /projects/:id/ingest-key   -> { enabled, prefix }   # tanpa plaintext. 404 project.
POST   /projects/:id/ingest-key   -> 201 { enabled:true, prefix, key, dsnUrl }   # generate/rotate (ganti key lama; no grace). 404.
DELETE /projects/:id/ingest-key   # 204 · revoke (kosongkan hash → monitoring off). 404.

# SPEC-253 · ADR-0062 · Help Center per project (opt-in). Link publik terikat Project.id (slug).
GET    /projects/:id/help-center  -> { enabled, publicUrl }   # 404 project.
POST   /projects/:id/help-center  -> 200 { enabled:true, publicUrl }   # aktifkan. 404.
DELETE /projects/:id/help-center  # 200-ish 204 · nonaktifkan (tak hapus tiket yang sudah ada). 404.

# SPEC-337 · ADR-0075 · relasi integrasi/dependency antar project (ProjectLink, LOCAL-only).
GET    /projects/:id/links  -> { links: LinkView[] }   # KEDUA arah milik project ini. 404 project.
#   LinkView = { id, fromProjectId, toProjectId, kind, note, direction:"keluar"|"masuk", other:{id,name} }
#   direction relatif :id — "keluar" = :id bergantung pada other; "masuk" = other bergantung pada :id.
POST   /projects/:id/links  { to, kind, note? }  -> 201 LinkView
#   kind ∈ api|sdk|data|event|lainnya (zLinkKind). 400 self-link/kind invalid; 404 project/target;
#   409 pasangan (from,to) sudah ada. note = penjelasan bentuk integrasi, disalin ke prompt audit lintas.
DELETE /projects/:id/links/:linkId  # 204 · 404 bila link tak ada ATAU tak menyentuh :id (kedua arah).
#   Ubah = hapus + tambah (tanpa PATCH). Hapus/rename project merambat via cascade FK, bukan endpoint ini.
```

> **Path efektif** project = `resolveRepoDir(projectId)` = **binding per-mesin ?? `Project.repoDir`** (null-safe).
> Dipakai SELURUH jalur baca — spawn/terminal, IDE, coverage/docStatus, branches, buat/review/integrate spec,
> docs, PRD, spec-docs, stage-artifacts (SPEC-217). `Project.repoDir` & `LocalBinding` sama-sama **tak disync**.
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
POST /specs/batch         { project, items:[BreakdownItem], branchFrom?, prdPath? } -> {created:[Spec]}
#   SPEC-273 · ADR-0069 · materialize breakdown: N spec `source:"brief"` independen (id berurutan via
#   nextSpecId+retry), provenance PRD di teks Konteks. 400 items kosong / branch tak dikenal; 404 project.
#   BreakdownItem = { title, context, outcome, priority:"tinggi"|"sedang"|"rendah" }.
#   source ∈ brief|qa|audit (SPEC-237). audit = audit-only (payload brief-shaped, author `Audit ·`);
#   qa payload ber-severity (superRefine mengikat source↔bentuk payload). audit → flow `audit`
#   (Audit → Laporan, dokumen SoT tanpa Execute; ADR-0057). Client memetakan source→flow via flowForSource.
#   SPEC-340 · ADR-0076 · eskalasi audit → backlog: payload boleh membawa `fromAudit:"SPEC-n"` untuk
#   source `qa` (ADR-0059, lewati fase Audit) MAUPUN `brief` (baca dokumen audit sbg bahan Brainstorm/
#   Objective, tanpa `skipped`). Pasangannya branchFrom `hanoman/<audit-id>` agar dokumen audit ada di worktree.
#   404 bila project tak dikenal; 400 bila branchFrom tak ada di refs/heads repo project.
PATCH /specs/:id          { branchFrom?: string|null, stage?, confirmDelete? }   -> Spec
#   branchFrom null = kembali ke default project (main); menentukan basis sesi BERIKUTNYA. Lihat ADR-0032.
#   stage = revert backward-only atas perintah human (SPEC-167/ADR-0027): 422 bila maju/sama,
#   400 bila stage tak dikenal. Bila mundur menghapus artefak docs & confirmDelete≠true →
#   200 { pending:true, stage, wouldDelete:string[] } (dry-run, tak mengubah apa pun);
#   confirmDelete:true → hapus artefak + set stage. Sesi tetap forward-only (ADR-0008/0024).
DELETE /specs/:id
GET  /specs/:id/docs                   # daftar dokumen superpowers backlog ini (audit/spec/plan/objective/brainstorm) — SPEC-170
#   kind audit = `*-audit.md` ATAU `…/research/audit-…` (SPEC-237/ADR-0057) — dokumen audit SoT ikut tampil sbg audit
GET  /specs/:id/docs/*path             # isi satu dokumen superpowers (raw)
GET  /specs/:id/escalation             # SPEC-340 · ADR-0076 · { escalation, docPath, live } — rekomendasi
#   tindak lanjut audit, DITURUNKAN dari blok ```json di dokumen audit (bukan kolom DB; ADR-0018/0011).
#   escalation = { target:"none"|"qa"|"brief"|"prd", reason, alternatives:[target], prefill:{title,
#   context,outcome,constraints,severity,steps} }. Dokumen dibaca freshest-wins (cwd sesi hidup >
#   repoDir) lewat listSpecDocs kind `audit`; live=true saat dari worktree sesi. Tanpa dokumen / tanpa
#   blok / json rusak / target tak dikenal → 200 { escalation:null } (keadaan normal, bukan error).
#   404 hanya bila spec tak ada.
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
GET    /prds                            # SPEC-210 · { items:[PrdDoc] } daftar PRD LINTAS-project (filter "Semua project")
GET    /projects/:id/prds               # SPEC-210 · { items:[PrdDoc] } dokumen docs/prd/*.md project itu
GET    /projects/:id/prds/*path         # SPEC-210 · isi PRD; 404 bila path bukan docs/prd/*.md
GET    /projects/:id/breakdown?prd=<path> # SPEC-273 · ADR-0069 · { items:[BreakdownItem], live } dari
#   manifest docs/prd/<slug>.breakdown.md (freshest-wins). Manifest belum ada / prd non-PRD → { items:[] }.
#   Manifest bukan PRD → dikecualikan dari daftar/isi PRD di atas.
```

### Unduh dokumen (SPEC-361 · ADR-0078)

Empat endpoint dokumen menerima query **opsional** `?download=md|pdf`. Tak ada endpoint ekspor
terpisah — pola sama dengan `GET /projects/:id/archive` (SPEC-233).

| Endpoint | Prefix nama berkas |
|---|---|
| `GET /specs/:id/docs/*path` | `<specId>` |
| `GET /projects/:id/prds/*path` | `<projectId>` |
| `GET /projects/:id/docs/*path` | `<projectId>` |
| `GET /projects/:id/file?path=&ref=` | `<projectId>` (+`-<ref>` bila melihat ref tertentu) |

- `download=md` → `200 text/markdown; charset=utf-8`, badan = sumber Markdown mentah.
- `download=pdf` → `200 application/pdf`, dirender server-side dari token `marked` (parser yang
  sama dengan preview) lewat `services/doc-export.ts`.
- Keduanya menyetel `content-disposition: attachment; filename="<prefix>-<basename>.<ext>"`.
- Nilai lain **atau query absen** → respons JSON `{path, content}` **persis seperti sebelumnya**.
- 404 tetap 404. Berkas biner di IDE tak ditawari unduhan (`f.binary` → respons JSON biasa).
- Auth tak berubah: cookie sesi same-origin (ADR-0028); UI memakai `<a download>`, bukan `fetch`.

> **PRD (SPEC-210 · ADR-0041):** PRD = dokumen `docs/prd/<slug>.md` (bukan entitas DB). `PrdDoc` =
> `{slug,name,path,title,live,projectId,projectName}` (`projectId`/`projectName` menyertai tiap item agar
> view lintas-project mengelompokkan & membuka PRD ke project asalnya). List/baca **freshest-wins**:
> worktree sesi `prd` hidup untuk project ini > `repoDir` (pola SPEC-170). `GET /prds` mengiterasi semua
> project (project tanpa `repoDir` menyumbang `[]`). Dibuat lewat sesi `flow:"prd"` (lihat Terminal),
> di-take ke backlog lewat `POST /specs` (tautan PRD di teks Konteks brief).

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
GET    /projects/:id/working-status      # (SPEC-234) { branch, staged:ChangedFile[], unstaged:ChangedFile[] }  staged=index vs HEAD, unstaged=working tree vs index+untracked (temp-index); read-only, TAK digerbang sesi; repoDir kosong → {branch:"",staged:[],unstaged:[]}; 404 project tak ada. Path /working-status dibedakan dari /status milik SPEC-233 (repoStatus, baris di bawah) yang beda bentuk respons.
GET    /projects/:id/file-diff?path=&staged=  # (SPEC-234) ReviewFile diff satu file working tree; staged=1 → index vs HEAD, else working tree vs index; 400 path buruk/kosong; 404 file tak dalam changeset
PUT    /projects/:id/file               { path, content }   # tulis file ke working tree; 400 guard path. TAK digerbang sesi.
GET    /projects/:id/graph?limit=200    # { commits:{sha,parents,author,at,subject,refs[],tags[]}[], current }  git log --date-order
#   SPEC-233: tag dipisah dari refs (tags[]). Filter opsional ?branches=a,b (bukan --all) & showRemote=/showTags=false.
#   SPEC-351: limit = HALAMAN, bukan plafon. Tak ada cap server; client menaikkannya kelipatan 200 saat
#   operator menggulir ke kaki daftar. commits.length < limit = history habis (satu-satunya penanda akhir).
GET    /projects/:id/commit/:sha        # { sha,parents,author,at,subject,body,changed[], signed,committer,committedAt,authorEmail }  404 sha bukan hex / tak ada (SPEC-233)
POST   /projects/:id/git                { op, ...args, force? }   # { ok, stdout, stderr, current }
#   op ∈ checkout|branch|merge|cherry-pick|revert|delete-branch (+ SPEC-233 di blok Git graph parity). 400 op/field cacat; 400 tanpa repoDir.
#   merge menerima ff opsional (SPEC-193): absen=default git (ff bila bisa); "no-ff"=selalu merge commit; "ff-only"=ff saja (409 bila tak bisa). ff lain → 400.
#   merge menerima deleteBranch opsional (SPEC-193): setelah merge sukses, hapus branch itu lokal (-D) lalu origin bila remote-tracking-nya ada (git push origin --delete). "" → 400. Gagal salah satu langkah → 409 (merge tetap terjadi).
#   delete-branch menerima local?(default true)/remote? opsional (SPEC-206): local → git branch -d/-D; remote → git push origin --delete. local:false+remote → hapus origin saja (ref origin/<b> tanpa branch lokal). Gagal salah satu langkah → 409 (langkah sebelumnya sudah terjadi).
#   409 bila ada sesi aktif project (force melewatinya) ATAU git exit≠0 (stderr diteruskan). force → -f/-D.
```

> Semua bekerja pada **`Project.repoDir` (working tree utama)** — read diturunkan dari git tiap request
> (tanpa cache, cermin ADR-0018). Mutasi git digerbang sesi-aktif + tree-bersih dengan escape `force`
> (ADR-0034). Read-di-`ref` memungkinkan **melihat** branch local/origin tanpa checkout.

### Git graph parity (SPEC-233 · ADR-0055)
```
# Merge isolasi (SPEC-229/ADR-0053) — bentuk { status:"clean",detail } | { status:"conflict",sessionId }
POST   /projects/:id/git/merge          { source, ff?, deleteBranch? }   # merge → branch current, worktree isolasi
POST   /projects/:id/git/rebase         { onto }                         # rebase branch current → onto (isolasi + claude)
POST   /projects/:id/git/pull           { source, ff? }                  # pull remote branch → current (isolasi + claude)
POST   /projects/:id/git/drop           { sha }                          # buang satu commit dari branch current (isolasi + claude)
# Read live (ADR-0018) — tanpa cache/kolom DB
GET    /projects/:id/status             # { branch, ahead, behind, staged[], unstaged[], untracked[], clean }
GET    /projects/:id/stashes            # [{ ref, message, at }]
GET    /projects/:id/remotes            # [{ name, fetch, push }]
GET    /projects/:id/commit/:sha/file?path=       # { path,status,binary,truncated,diff,content }  diff commit vs parent
GET    /projects/:id/compare?from=&to=            # { from, to, changed:{path,add,del,status,binary}[] }
GET    /projects/:id/compare/file?from=&to=&path= # { path,status,binary,truncated,diff,content }
GET    /projects/:id/graph/search?q=&by=          # { shas:string[] }  by ∈ all|message|author|hash
GET    /projects/:id/archive?ref=&format=         # stream (download) git archive  format ∈ zip|tar; 400 ref tak valid
GET    /projects/:id/pr-url?branch=&base=         # { url:string|null }  URL "Create PR" dari origin (github/gitlab/bitbucket) atau null
POST   /projects/:id/remotes  {name,url} · PATCH /projects/:id/remotes/:name {url} · DELETE /projects/:id/remotes/:name   # → Remote[]; 400 field cacat; 409 git gagal
# Bersihkan branch tak terpakai (SPEC-360 · ADR-0077) — nilai turunan git, tanpa kolom DB
GET  /projects/:id/branches/unused?base=   # { base, baseRemote, current, branches:[{name,local,remote,lastCommit:{sha,at,subject}|null,locks[]}] }
#   Isi daftar = HANYA branch ter-merge ke base (git branch --merged); ref origin dibanding origin/<base>.
#   base: ?base= → main → master → branch aktif → "HEAD". TAK PERNAH hardcode "main" (SPEC-227).
#   base di-resolve ke SHA sebelum diberikan ke --merged: `--end-of-options` TAK bisa dipakai di sana
#   (git menelannya sebagai nilai --merged, lalu --format jadi argumen posisi). Hex tak pernah jadi flag (ADR-0032).
#   locks ∈ current|base|worktree|spec-open|session — kosong = boleh dihapus. base & current ikut tampil (terkunci).
#   `session` terpisah dari `worktree` karena sesi lahir --detach (ADR-0002) → tak muncul di `git worktree list`.
#   Disaring: baris `(no branch)` (dipancarkan saat dijalankan di worktree detached) & `origin/HEAD` (git memendekkannya jadi bare `origin`).
#   404 project tak ada; tanpa repoDir/bukan repo → { base:"", baseRemote:null, current:"", branches:[] }.
POST /projects/:id/branches/delete  { names:string[], scope?, base? }   # { base, results:[{name,ok,scope,error?}] }
#   scope ∈ local|remote|both (default both); menyempit per branch mengikuti ref yang benar-benar ada.
#   Menurunkan ulang daftar unused lalu memvalidasi tiap nama: di luar daftar / terkunci → baris ok:false.
#   Selalu 200 bila body sah — kegagalan hidup di baris results, bukan status HTTP. TAK PERNAH pakai -D/force.
#   TAK digerbang sesi aktif global (op ref-only, ADR-0055); pagarnya per-branch. 400 names/scope cacat, tanpa repoDir.
#   Capability agent: keduanya di domain `projects` (projects:read/write), BUKAN `ide` — cermin GET /branches lama.
# Isolasi (merge/rebase/pull/drop): { status:"clean",detail } | { status:"conflict",sessionId } | 400 body/target · 409 detached/source hilang/working-tree kotor
# Read (status/stashes/remotes/compare/search): 404 project tak ada; commit-file/compare-file: 400 path keluar repo · 404 tak ada
# GET /projects/:id/graph menerima filter opsional: ?branches=a,b&showRemote=&showTags= (default = --all lama)
# POST /projects/:id/git op += reset|reset-worktree|clean|tag|delete-tag|push-tag|stash|stash-apply|
#   stash-pop|stash-drop|stash-branch|rename-branch|push-branch|fetch. Gate sesi hanya untuk op yang
#   menyentuh working tree (touchesTree); tag/rename/push/fetch/stash-drop lolos gate (ADR-0055).
```

## Settings / notifications / limits
```
GET/PUT  /settings                      # Setting blob (zSetting): model, effort, autoDefault, autoScaffold,
#                                         notifyFail, notifyDone (bool), notifySound — SPEC-180. Tanpa dailyBudget/maxConcurrent.
#                                         model/effort = DEFAULT GLOBAL sesi baru (SPEC-252/ADR-0061); per sesi di-override saat Start.
#                                         phaseModels DICABUT (SPEC-252/ADR-0061) — baris lama yang masih memuatnya tetap parse (diabaikan).
#                                         goal { enabled:false, condition:"" } (SPEC-332/ADR-0073) — default global mode goal
#                                           sesi backlog; condition kosong = pakai default DoD bawaan. Blok selalu ADA di response
#                                           (zod .default()), jadi baris Setting lama tetap parse tanpa migration.
#                                         agent: "claude"|"codex" (default "claude") + codex { model:"gpt-5.6-sol",
#                                           effort:"xhigh" } (SPEC-338/ADR-0074) — mesin sesi default + katalog
#                                           model/effort codex. model/effort di akar TETAP milik claude.
#                                           Keduanya .default() → baris lama tetap parse, TANPA migration.
#                                         SPEC-339 · blok codex dinormalkan saat DIBACA: model pensiun
#                                           (gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark) → gpt-5.5, lalu effort
#                                           dikoreksi ke yang didukung model itu (mis. luna+ultra → xhigh).
#                                           Server tetap lenient (z.string()); PUT nilai apa pun diterima,
#                                           tapi yang dibaca kembali sudah pasangan yang sah.
#                                         PUT ganti seluruh blob (full replace).
GET      /codex/version                 # { version: string|null, minRequired: "0.144.0", ok: boolean }  (SPEC-339)
#   Versi codex CLI terpasang (`<HANOMAN_CODEX_BIN> --version`, cache 5 menit). `version: null` =
#   tak terdeteksi (biner tak ada / keluaran tak dikenal) dan itu TIDAK dianggap gagal → `ok: true`.
#   Murni observabilitas untuk catatan lunak di Settings & picker Start; TIDAK pernah memblokir Start
#   (ADR-0037 — agen dipercaya, isolasi lewat worktree).
GET      /limits/codex                  # CodexLimitsDTO { status, windows[], fetchedAt, plan }  (SPEC-338/ADR-0074)
#   Limit langganan CODEX. Sumbernya BUKAN jaringan: codex menulis `rate_limits` (used_percent,
#   window_minutes, resets_at, plan_type, rate_limit_reached_type) ke rollout sesinya di
#   $CODEX_HOME/sessions/<Y>/<M>/<D>/*.jsonl; server membaca ekor rollout terbaru (≤512KB, ≤8 berkas,
#   cache 30s). Tak ada token codex yang disentuh.
#   `windows[]` memakai LimitWindow yang sama dengan /limits. Label diturunkan dari `window_minutes`
#   (300 → "Sesi 5 jam", 10080 → "Mingguan"), TIDAK dari nama kunci: `primary` terbukti bisa berupa
#   window mingguan maupun 5-jam tergantung akun/waktu. `resets_at` codex = epoch DETIK → ISO.
#   `isActive` hanya true untuk window yang disebut `rate_limit_reached_type` (codex tak punya is_active).
#   status: ok = snapshot ≤12 jam; stale = lebih tua (tetap ditampilkan, ditandai); unavailable = belum
#   pernah ada sesi codex yang melaporkan kuota → badge disembunyikan di UI.
#   `fetchedAt` = waktu SNAPSHOT (bukan waktu baca) — beda semantik dari /limits milik claude.
GET      /notifications                 # { items:Notification[] (≤50 terbaru dulu), unread:int }  (SPEC-180)
#   Notification dibuat server-side saat backlog masuk `done` (advanceStage + write-through GET /specs).
#   type ∈ done|decision|drift|error|ticket|fail (fail SPEC-298 = sesi scheduler gagal/limit, rekonsil akhir sesi).
POST     /notifications/read            # 204; tandai semua unread jadi terbaca
DELETE   /notifications                 # 204; clear semua
GET      /limits                        # { …usage } dari OAuth usage API Anthropic (cache 30s, stale/unavailable fallback) — SPEC-181/ADR-0024
GET      /update                        # UpdateStatus — status auto-update; read-only (server TAK pull/build/restart, ADR-0048). SPEC-214
#   UpdateStatus = { currentSha, checkoutSha, branch|null, local:{stale}, remote:{status:"ok"|"unavailable",behind,fetchedAt},
#                    updateAvailable, reason:"local"|"remote"|"both"|null, command, newCommits:{sha,subject}[] }
#   updateAvailable = build ter-stamp ≠ checkout HEAD (local) ATAU origin di depan (remote, setelah git fetch ter-gate HANOMAN_UPDATE_FETCH=1)
GET      /fs/browse?path=               # directory picker sisi server (untuk memilih repoDir project)
GET      /health                        # publik; liveness
```

## Agent tokens (SPEC-257 · ADR-0065)

> Panduan berhadapan-agen (cara AI agent eksternal terhubung, langkah demi langkah + contoh `curl`): [`docs/agent-integration.md`](../../../docs/agent-integration.md) — ditaut juga dari panel "Akses AI Agent" di UI (SPEC-265).

```
# Kelola kredensial AI agent — COOKIE-ONLY (agent token sendiri → 403; anti privilege-escalation).
GET    /agent-tokens/capabilities   -> { capabilities: CapabilityInfo[] }   # katalog 18 (9 domain × read/write) untuk UI
GET    /agent-tokens                 -> { items: AgentTokenView[] }          # tanpa hash/plaintext
POST   /agent-tokens { name, capabilities[] }  -> 201 { ...AgentTokenView, token }   # plaintext hnm_agt_… SEKALI
#   400 nama kosong / capability asing (divalidasi vs CAPABILITY_IDS). createdBy = user pemanggil.
PATCH  /agent-tokens/:id { name?, capabilities?, enabled? }  -> 200 AgentTokenView   # 400 body cacat; 404 tak ada
DELETE /agent-tokens/:id             # 204 · revoke (set revokedAt); 404 tak ada
#   AgentTokenView = { id, name, tokenPrefix, capabilities[], enabled, createdBy|null, createdAt, lastUsedAt|null, revokedAt|null }
```

> **Capability** = `"<domain>:<access>"`, `access ∈ {read,write}`, **write⊇read**. 9 domain: `projects`,
> `backlog`, `sessions` (spawn claude = RCE), `docs`, `ide`, `vps` (remote exec), `settings`, `support`
> (errors+tickets), `notifications`. Peta route→capability di `server/src/services/agent-capabilities.ts`:
> GET/HEAD → `:read`, selainnya → `:write`; sub-path `/projects/:id/{docs,prds}` → `docs`,
> `/projects/:id/{tree,file,git,status,graph,commit,compare,remotes,…}` → `ide`; WS terminal → `sessions:write`.
> **Read-only global** (`/limits`,`/update`,`/events/ws`,`/fs/browse`,`/health`) → token ber-capability apa pun.
> **Tak-boleh-didelegasikan** (agent → 403): `/auth`, `/agent-tokens`, `/device-tokens`, `/sync`; route tak
> dikenal peta → cookie-only. Master switch `Setting.agentAccessEnabled` (PUT /settings) mematikan semua.

> **Sync mesin-ke-mesin** (SPEC-213 · ADR-0043/0045/0046): surface `/api/sync/{pull,push,ws}` diotorisasi
> **device token** (Bearer / `?token=` WS), di-**bypass** gate cookie.
> **Byte lampiran** (SPEC-272 · ADR-0068): `GET /api/sync/attachments/:storageKey` — **device-token**
> (bukan cookie), stream byte biner lampiran (`Content-Type` mime) untuk fetch-through client → `200` |
> `404` (storageKey bukan milik `TicketAttachment`/file hilang) | `401` (tanpa device token). Metadata
> lampiran sendiri menyeberang via feed `pull` (entitas `ticketAttachment`); byte **tidak** masuk feed.
> **KECUALI `POST /api/sync/now`**
> (SPEC-268 · ADR-0066) — pemicu **manual** dari tombol UI (Backlog/Errors/Triase): **cookie-authed**
> (dikecualikan dari bypass di `app.ts`), tetap **non-delegatable** ke agent (`/sync` cookie-only → 403).
> Menjalankan satu siklus `syncOnce` (pull-before-push) → `200 { ok:true, pulled, pushed, conflicts }`;
> instance non-client (hub) → `200 { ok:false, reason:"not-configured" }`. Tombol muncul hanya di client
> (`GET /config`.`sync.running`).

> **Rekonsil konflik** (SPEC-270 · ADR-0067) — **cookie-only** (dikecualikan dari bypass `/api/sync`,
> non-delegatable ke agent):
> - `GET /api/sync/conflicts` → `{ conflicts: SyncConflictView[] }` (divergensi dua-sisi pending;
>   tiap item punya `localData`/`serverData` + `localVersion`/`serverVersion` + `localUpdatedAt`/`serverUpdatedAt`).
> - `POST /api/sync/conflicts/:entity/:recordId/resolve` `{ choice: "local" | "server" }` →
>   `{ ok:true }` | `{ ok:false, reason }`. `local` = force-push data lokal ke hub (`baseVersion=serverVersion`);
>   `server` = adopsi data hub secara lokal. Modal `ReconcileModal` (dipicu saat `conflicts>0`) menyajikan
>   side-by-side; default = sisi `updatedAt` terbaru (LWW). Keputusan per-record.

## Terminal
```
GET    /terminal/sessions            # [{ id, projectId, specId?, flow?, cwd, branch?, exited, decision, agent }]
#   branch? (SPEC-230): branch integrasi sesi project-level (PRD = prd/<slug>) — menyalakan review+merge di sel
#   agent (SPEC-338/ADR-0074): "claude" | "codex" — mesin sesi, dibaca dari opsi tmux @hanoman_agent.
#     Sesi yang lahir sebelum ADR-0074 (tanpa opsi itu) dilaporkan sebagai "claude".
POST   /terminal/sessions  {project, flow?} # 201 { id } · 404 project · 400 tanpa repoDir
#   {project, shell:true} (SPEC-236, ADR-0056): terminal biasa NON-agen — shell mentah
#     (HANOMAN_SHELL ?? $SHELL ?? /bin/bash) di repoDir project, tanpa flow (tak menggerakkan stage,
#     tak buat worktree). 201 { id } · 404 project · 400 tanpa repoDir (needsBind).
#   {spec, flow, model?, effort?, goal?, goalCondition?, agent?} (SPEC-162; model/effort SPEC-252/ADR-0061;
#     goal SPEC-332/ADR-0073; agent SPEC-338/ADR-0074): sesi backlog di worktree .worktrees/<spec>, prompt pipeline penuh.
#     agent?: "claude"|"codex" — override PER SESI; kosong → Setting.agent. Agen menentukan katalog
#       model/effort default (claude → Setting.model/effort, codex → Setting.codex.model/effort) dan
#       bentuk argv: claude `--model/--effort/--settings`, codex `-m / -c model_reasoning_effort / -c hooks.*`.
#       Sesi project-level (reverse/prd/scaffold/breakdown/terminal/konflik) TAK punya override — ikut Setting.agent.
#     model/effort opsional = override PER SESI (kosong → default global);
#     jadi argv --model/--effort saat sesi lahir (andal, tak bergantung agen).
#     goal?: boolean — mode goal PER SESI. undefined → ikut Setting.goal.enabled; false → MATI walau
#       global menyala; true → nyala. goalCondition?: string ≤4000 — kondisi khusus sesi ini.
#       Presedens kondisi: goalCondition → Setting.goal.condition → default DoD bawaan runner
#       (semua fase tercatat di $HANOMAN_PHASE_FILE, plan tak menyisakan `- [ ]`, push sukses).
#       claude: argv --settings membawa hooks.Stop=[{type:"prompt",prompt:<kondisi>}] (sesi menolak
#       berhenti sampai kondisi terbukti di transkrip) + keystroke `/goal` best-effort ke pane.
#       codex (SPEC-338/ADR-0074): codex MENDIAMKAN hook type:"prompt", jadi gate-nya skrip sh
#       DETERMINISTIK sebagai Stop hook `command` — cek phase file lengkap + plan tak menyisakan
#       `- [ ]`; belum terpenuhi → exit 2 (stderr jadi continuation prompt, codex dipaksa lanjut).
#       Kondisi prosa ikut sebagai teks alasan, bukan yang menggerbang. Pagar anti-loop: 25 penolakan.
#     flow ∈ feature|qa|audit|cross-audit (dari source; flowForSource). audit (SPEC-237/ADR-0057) = pipeline
#     Audit → Laporan: investigasi + dokumen SoT (research/audit-<spec>-<slug>.md), TANPA Execute; stage done via Laporan.
#     cross-audit (SPEC-337/ADR-0075) = pipeline & deliverable SAMA, tapi ber-scope project ini + tetangga
#     ProjectLink-nya: prompt memuat path checkout tetangga (read-only) + sesi memegang kunci /api/audit/logs.
#   {project, flow:"cross-audit"} (SPEC-337, ADR-0075): sesi audit lintas LEPAS (tanya-jawab) di worktree
#     .worktrees/xaudit-<project>; TANPA Spec/fase/branch → tak menggerakkan stage. Id deterministik (Start
#     kedua = re-attach). Sama-sama memegang kunci audit. 422 bila repoDir kosong/worktree gagal.
#   SPEC-172: bila Spec.stage === "done", sesi baru dibuka dengan prompt LANJUTAN (fase Execute
#     saja, continuePrompt) alih-alih pipeline penuh — reopen backlog yang keburu selesai.
#   flow "reverse" (SPEC-166, ADR-0026): sesi project-level di worktree .worktrees/reverse-<project>
#   dengan prompt standar docs; 422 bila repoDir kosong atau worktree gagal dibuat
#   flow "scaffold" (SPEC-222, ADR-0052): sesi project-level di worktree .worktrees/scaffold-<project>,
#     menyusun SoT penuh dari ide (Project.desc), pipeline Brainstorm→Objective→Doc index; 422 bila repoDir kosong/worktree gagal
#   {project, flow:"prd", brief, branchFrom?, fromAudit?} (SPEC-210, ADR-0041): sesi project-level di
#     .worktrees/prd-<slug>; brainstorm interaktif → dokumen docs/prd/<slug>.md, push branch prd/<slug>;
#     400 judul kosong, 422 worktree.
#     SPEC-340 · ADR-0076 · eskalasi audit → PRD: branchFrom = branch audit (hanoman/<audit-id>) →
#     worktree lahir dari sana (resolveCommit + fallback origin/<rev>, SPEC-244) alih-alih HEAD;
#     fromAudit = id spec audit → isi dokumen auditnya (freshest-wins) DISEMATKAN ke prompt PRD
#     sebagai blok `=== DOKUMEN AUDIT <id> ===`. Keduanya opsional & independen; tanpa keduanya
#     perilaku lama utuh (worktree dari HEAD, prompt polos). 422 bila branchFrom tak resolve.
#   {project, flow:"breakdown", prdPath} (SPEC-273, ADR-0069): sesi project-level di .worktrees/breakdown-<slug>;
#     baca PRD (tersemat, freshest-wins) → manifest docs/prd/<slug>.breakdown.md, push branch breakdown/<slug>;
#     400 PRD tak terbaca / path tak valid, 422 worktree gagal
GET    /terminal/sessions/:id/phases # fase yang sudah dilaporkan sesi (dari $HANOMAN_PHASE_FILE) → stage live
GET    /terminal/sessions/:id/review        # (SPEC-230, ADR-0054) diff worktree HIDUP sesi project-level (PRD);
#   bentuk = /specs/:id/review; kunci worktree = id sesi; 409 bila worktree lenyap (sesi ditutup) — bukan 500
GET    /terminal/sessions/:id/review/*path  # { path, status, binary, truncated, diff, content } · 404 · 409
POST   /terminal/sessions/:id/integrate  { op:"merge"|"rebase", target:"local:<b>"|"origin:<b>" }
#   (SPEC-230, ADR-0054) rebase/merge branch sesi (PRD prd/<slug>); { status:"clean", detail } |
#   { status:"conflict", sessionId } (spawn sesi claude di worktree merge-<id>) | 400 op/target · 409 branch/sesi tanpa branch
DELETE /terminal/sessions/:id        # 204 · 404; menutup sesi: majukan stage, simpan headSha, removeWorktree
#   removeWorktree HANYA dijalankan bila cwd sesi benar-benar berada DI DALAM <repoDir>/.worktrees/
#   (`ownsWorktree`, services/session-worktree.ts). Bentuk path saja bukan bukti kepemilikan:
#   project yang di-bind ke checkout di bawah .worktrees/ (dogfooding hanoman di worktree sendiri)
#   punya `cwd === repoDir` untuk terminal biasa, dan gerbang lama menghapus checkout itu sendiri.
GET    /terminal/sessions/:id/ws     # WebSocket; close 4004 bila sesi tak ada
#   server->klien: { t:"data", d } · { t:"phase", … } · { t:"exit", code }
#   klien->server: { t:"in", d } · { t:"resize", cols, rows }

# --- riwayat sesi (SPEC-362, ADR-0079) — LOCAL-only, tak disync -------------------------------
GET    /terminal/history?projectId&specId&kind&q&page&limit
#   → { items: SessionHistoryView[], total, page, pageSize } · urut startedAt desc
#   q mencocokkan sessionId/specId/title/branch (insensitive). Tanpa `limit` → seluruh riwayat
#   terfilter dalam satu halaman. `limit` di-clamp 1..200. `endedAt: null` = sesi masih berjalan.
#   skip/take dilakukan di query DB — SAH di sini, tak seperti larangan ADR-0038 untuk GET /specs
#   (riwayat adalah baris mati; tak ada overlay stage live / write-through yang butuh set penuh).
GET    /terminal/history/:id         # SessionHistoryView + { hasTranscript } · 404
GET    /terminal/history/:id/transcript  # { text, bytes } · 404 bila baris/transkrip tak ada
#   Teks POLOS (capture-pane tanpa -e), di-capture sebelum pane dibunuh, cap 1 MiB menyimpan ekor.
DELETE /terminal/history?projectId&before
#   → { purged } · 400 tanpa parameter (purge WAJIB ber-scope) · 400 `before` bukan tanggal valid.
#   Ikut menghapus berkas transkrip milik baris yang dibuang. Cermin DELETE /session-results.
```

> Riwayat sesi sengaja hidup di bawah prefix `/terminal` supaya mewarisi capability `sessions`
> (`capabilityForRoute()`, ADR-0065) tanpa menambah domain baru.

> PTY menjalankan `claude --dangerously-skip-permissions` di worktree/`repoDir`, di dalam **tmux**
> (socket `-L hanoman`) sehingga sesi hidup melewati restart API (ADR-0016); scrollback 256 KB terakhir
> di-replay saat klien reconnect. RCE by design — server bind `127.0.0.1` secara default, lihat ADR-0014.

## Events (SPEC-199 · ADR-0039)
```
GET    /events/ws                    # WebSocket siar dashboard (global). Auth = gate /api (cookie).
#   server->klien (per-grup, saat berubah; snapshot penuh saat connect):
#     { t:"specs", specs } · { t:"sessions", sessions } · { t:"notifications", items, unread }
#     { t:"limits", limits } · { t:"codexLimits", limits } (SPEC-338, tiap 30s, grup TERPISAH dari
#       `limits` karena sumber & semantik kesegarannya beda) · { t:"vps", vps } ·
#       { t:"update", update } (SPEC-214, tiap 300s)
#   klien->server: — (read-only feed; frame masuk diabaikan)
```

> Satu loop server (cadence per-grup, dedup signature) menggantikan N-klien × poll. Endpoint HTTP
> GET tiap sumber tetap ada untuk paint pertama.

## VPS (SPEC-164 · ADR-0025 · SPEC-211/ADR-0042)
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
POST   /vps/:id/audit                # 200 { audit, hardened, scoreTotal, scoreBySection, drift[] } · 404 · 502
                                     # drift (SPEC-221) = item pass→fail/warn sejak snapshot lalu → Notification
POST   /vps/:id/harden               # 200 { transcript, audit, hardened } · 404
                                     # 502 { error, transcript[, verify] } bila ssh gagal
                                     # atau verifikasi koneksi pasca-harden gagal
POST   /vps/:id/session              # 201 { id } — sesi claude tmux berkonteks VPS (cwd $HOME) · 404
POST   /vps/:id/test                  # 200 { ok, out } — ssh `true` key-only, transien · 404
POST   /vps/:id/console               # 201 { id } — shell ssh MENTAH di tmux hanoman (ADR-0042) · 404
# --- Kepatuhan / checklist 232 item (SPEC-220 · ADR-0050) ---
GET    /vps/:id/checklist            # 200 { vpsId, scoreTotal, scoreBySection, lastAuditAt,
                                     #   sections:[{ id,title,icon,score, suggestion?, items:[CatalogItem +
                                     #   status,na,attested,drifted,actorEmail,naReason,attestNote] }] } · 404
                                     # drifted (SPEC-221) = regresi sejak snapshot lalu; suggestion = saran N/A app-layer
POST   /vps/:id/items/:itemId/na     # 200 { ok } {na,reason?} — tandai/lepas N/A + jejak pelaku · 404 itemId asing
POST   /vps/:id/items/:itemId/attest # 200 { ok } {note?} — attest item INFO + jejak pelaku · 404
POST   /vps/:id/items/na-bulk        # 200 { ok, count } {itemIds[],na,reason?} — tandai N/A banyak item · 400 id asing (SPEC-221)
POST   /vps/:id/remediate/preview    # 200 { steps:[{item,status:would,detail}] } {items[]} — dry-run · 404 · 502
POST   /vps/:id/remediate            # 200 { steps, audit, scoreTotal, scoreBySection } {items[]}
                                     #   — apply item AUTO idempoten → verifikasi koneksi → re-audit · 404 · 502
```

> Audit/healthcheck/harden = script bash deterministik (`server/scripts/vps/*.sh`) dikirim
> lewat `ssh … 'sudo -n bash -s'`. `hardened` = semua check kritis `pass` pada audit terakhir.
> Harden TIDAK PERNAH terjadwal; healthcheck (5 mnt) dan audit (24 jam) berjalan lewat
> `setInterval` di `server.ts`. Endpoint ini eksekusi remote — tergerbang sesi auth (seperti seluruh
> `/api`), dan tetap direkomendasikan bind `127.0.0.1` di belakang reverse proxy TLS.
>
> Password tak pernah disimpan, di-log, atau dikembalikan; ia diserahkan ke ssh lewat
> SSH_ASKPASS (bukan argv) dan hidup beberapa detik di env proses anak (ADR-0025, SPEC-165).

## Error monitoring (SPEC-249 · ADR-0060 · SPEC-276 · ADR-0070 symbolication)
```
# Ingest PUBLIK ber-DSN — pengecualian sah gate /api (bypass cookie, otentikasi DSN sendiri).
POST    /api/ingest/:slug?key=<dsn>   { type, message, stack?, frames?, environment?, release?, context? }
#   key via ?key= ATAU header x-hanoman-dsn. 202 { ok, groupId, new }.
#   SPEC-276: frames? = StackFrame[] { function?, filename?, lineno?, colno?, in_app? } (opsional; kompatibel mundur).
#   401 generik (project tak ada / DSN salah / revoked — tak enumerasi project). 400 payload invalid.
#   413 body > 64 KB. 429 rate-limit per project (token-bucket in-memory, default 120/min).
#   message ≤ 2 KB, stack ≤ 16 KB (di-truncate). PII disimpan apa adanya (scrub pasca-MVP).
OPTIONS /api/ingest/:slug   # 204 + CORS (Access-Control-Allow-Origin: * ) untuk snippet browser.

# SPEC-276 · ADR-0070 · upload source-map per release (symbolication). Auth DSN key sama.
POST    /api/ingest/:slug/sourcemaps?key=<dsn>   { release, artifacts:[{ filename, map, debugId? }] }
#   filename = basename artifact hasil-build (mis. index-4f3a2b.js) yang dipetakan map; map = isi .map (JSON string).
#   202 { ok, stored }. 401 key salah. 400 payload invalid. 413 total > 30 MB. bodyLimit 30 MB (bukan 64 KB ingest).
#   Byte map server-local (HANOMAN_UPLOAD_DIR), TAK disync. Retensi: keep-N-release terbaru per project.
OPTIONS /api/ingest/:slug/sourcemaps   # 204 + CORS.

# Area Error — di belakang gate cookie. Query selalu ber-scope projectId (isolasi antar-project).
GET   /errors/integration-guide  -> { text }   # isi mentah sdk/README.md (markdown), utk ditampilkan di web
#   (modal "Panduan integrasi" di area Errors + link kartu DSN). Static route > /errors/:id. 404 bila file hilang.
GET   /errors?project=&environment=&status=&q=&page=&limit=  -> { items: ErrorGroupView[], total, page, pageSize }
#   urut lastSeen desc; q atas type+message; paginasi response-layer (ADR-0038).
GET   /errors/:id            -> ErrorGroupDetail { ...group, release, sampleStack, sampleFrames, events: ErrorEventView[] (≤50) } · 404
#   SPEC-276: sampleFrames = SymbolicatedFrame[]|null — frame sample disymbolikasi LAZY pakai source-map yang
#   tersedia saat ini (posisi .ts/.tsx + contextLine + in_app). Map absen → frame apa adanya (symbolicated:false).
#   ErrorGroupView kini memuat `release` (release terakhir grup, korelasi build).
POST  /errors/:id/escalate   # 201 { spec } — buat Spec qa prefilled (title/actual/fromErrorGroup) + tandai grup
#   escalated + specId (tautan dua arah). Idempoten: sudah escalated → 200 { alreadyEscalated:true, spec }. 404.
#   SPEC-296: inti eskalasi kini di services/error-escalate.ts (escalateErrorGroup) — dipakai route ini DAN
#   scheduler source-checker `errors`; kontrak HTTP (201/200/404) tak berubah.
POST  /errors/:id/unlink     # 200 { id, status:"new", specId:null } — lepas tautan backlog (kebalikan escalate).
#   Non-destruktif: Spec dibiarkan (hapus manual). Reset status→new → bisa dieskalasi lagi (Spec baru). Idempoten. 404. (SPEC-271)
PATCH /errors/:id            { status }   # 200 { id, status } — status ∈ new|escalated|resolved. 400 invalid. 404.
DELETE /errors/:id           # 200 { ok:true } — hapus grup; ErrorEvent cascade (onDelete: Cascade). 404. (SPEC-269)
```

> **Grouping** deterministik: `fingerprint(type, normalizeMessage(message), topFrame(stack))`
> (`server/src/services/error-fingerprint.ts`) → varian dari error yang sama jatuh ke satu grup.
> **Notifikasi** grup PRODUKSI baru → `Notification { type:"error", key:"error:<groupId>" }` (dedup),
> tersiar lewat grup `notifications` WS existing. **Retensi** opportunistic-on-write: cap event per grup
> (default 50) + umur (default 30 hari) — tanpa scheduler global. **SDK** = npm package publik
> `hanoman-sdk` (SPEC-254 · ADR-0063; source `sdk/src/**`, Node + browser, DSN gaya Sentry); `GET
> /errors/integration-guide` tetap menyajikan `sdk/README.md` apa adanya. **Sync (SPEC-268/ADR-0066):**
> agregat `ErrorGroup` kini **tersync** (kolom `version`, entitas `errorGroup` di `SYNCED`; publish
> asal-hub pada grup baru + escalate/resolve); `ErrorEvent` mentah **tetap server-local**. Realtime
> area Error = **HTTP polling** (silent poll, pola GitGraph), bukan kanal WS baru (ADR-0039).

## Audit lintas project (SPEC-337 · ADR-0075)
```
# Dibaca SESI cross-audit (hanoman sendiri, bukan agen eksternal). Pengecualian sah gate /api:
# prefix /api/audit/ lolos TANPA cookie bila header X-Hanoman-Audit-Key cocok dengan sesi tmux HIDUP
# (kunci + daftar project ter-scope hidup di @hanoman_audit_key/@hanoman_audit_projects, ADR-0016).
# Kunci mati bersama pane-nya; TAK PERNAH keluar lewat GET /terminal/sessions. Cookie sesi tetap boleh.
GET /api/audit/logs?since=&until=&environment=&q=&projects=&limit=
#   -> { window:{since,until}, scope:[{id,name}], groups: AuditGroupView[], timeline: AuditEventView[] }
#   timeline = ErrorEvent SEMUA project ter-scope, TERCAMPUR & terurut waktu desc — bukti korelasi lintas project.
#   AuditEventView = { at, projectId, groupId, type, message, environment, release }
#   AuditGroupView = { id, projectId, type, message, environment, release, status, count, firstSeenAt, lastSeenAt, specId }
#   since/until: "24h" | "7d" | ISO-8601 (default since=24h, until=now). q atas type+message. limit ≤1000 (default 200).
#   projects= subset scope (koma). 400 since/until tak terparse; 401 kunci tak dikenal/sesi mati;
#   403 memuat project di luar scope sesi.
GET /api/audit/logs/:groupId
#   -> { ...AuditGroupView, sampleStack, sampleFrames, events: AuditEventDetail[] (≤50) }
#   sampleFrames disymbolikasi lazy (reuse SPEC-276/ADR-0070). events memuat stack + context.
#   404 bila grup tak ada ATAU project-nya di luar scope (keberadaannya pun tak dibocorkan).
```

> Scope sebuah sesi = project utama **+ tetangga `ProjectLink` satu hop kedua arah** (ADR-0075).
> Kunci sampai ke agen lewat **env sesi** (`HANOMAN_AUDIT_KEY`/`HANOMAN_AUDIT_URL`), jadi endpoint ini
> dipakai sama persis oleh sesi **claude maupun codex** (ADR-0074) — tanpa percabangan per agen.
> Kewenangan kunci **read-only** dan hanya atas `ErrorGroup`/`ErrorEvent` project ter-scope — tak ada
> jalur tulis, tak ada akses ke domain lain. Bandingkan dengan agent token (ADR-0065) yang berlingkup
> global & butuh master switch: kunci audit sengaja seumur-sesi dan tak dikelola manusia.

## Help Center (SPEC-253 · ADR-0062)
```
# PUBLIK ber-scope-project — pengecualian sah gate /api (bypass cookie, otorisasi non-cookie sendiri).
# Same-origin (SPA + API satu host) → tanpa CORS/OPTIONS.
GET     /api/help/:slug                  -> { projectName, categories }
#   Info halaman publik. Otorisasi = helpEnabled. 404 generik bila project tak ada / helpEnabled=false.
POST    /api/help/:slug/tickets          # multipart/form-data
#   Field: category, title, detail, email, hc_trap (honeypot) + files[] (≤3 gambar png/jpeg/webp, ≤5MB).
#   Otorisasi = helpEnabled. 201 { number, key, statusPath } (key+link ditampilkan SEKALI di layar).
#   400 field wajib kosong/kategori invalid (tak buat tiket). 404 helpEnabled=false. 429 rate-limit
#   per IP & per project. Honeypot terisi → 200 { ok:true } palsu (tak buat tiket). Berkas invalid di-skip.
#   SPEC-352 · honeypot bernama `hc_trap`, BUKAN lagi `hp` — `hp` (= "handphone") diisi autofill
#   browser untuk pelapor sungguhan; kini `hp` field biasa yang diabaikan (bundle basi tetap jadi
#   tiket). Klien WAJIB memvalidasi bentuk respons: 200 { ok:true } bukan sukses.
GET     /api/help/:slug/tickets/:key     -> { number, category, title, status, createdAt }
#   Cek status publik by kunci opaque; status terpetakan otomatis (publicStatus), tanpa jargon internal.
#   Scoped ke slug (isolasi). 404 bila kunci tak dikenal / bukan milik slug (tak membocorkan).
#   SPEC-293 · `:key` boleh kunci pelapor (accessKeyHash) ATAU shareToken bagikan operator (hnm_shr_…).

# TRIASE — di belakang gate cookie. Query selalu ber-scope projectId (isolasi antar-project).
GET   /tickets?project=&status=&q=&page=&limit=  -> { items: TicketView[], total, page, pageSize, unreviewed }
#   urut createdAt desc; q atas title+reporterEmail; paginasi response-layer (ADR-0038); unreviewed = jumlah status new.
GET   /tickets/:id            -> TicketDetail { ...ticket, detail, attachments:[{id,filename,mimeType,size}], spec, publicStatusUrl } · 404
#   SPEC-293 · spec = backlog tertaut (stage → badge status turunan di detail triase). publicStatusUrl =
#   ${base}/help/<projectId>/status/<shareToken> (link publik dibagikan ke pelapor); shareToken di-generate
#   lazily bila tiket lama belum punya (idempoten, tanpa sync). Deep-link backlog UI = ${origin}#spec=<id> (ADR-0071).
GET   /tickets/:id/attachments/:attId    # stream berkas gambar (Content-Type mimeType) ber-auth · 404 (att bukan milik tiket)
      # SPEC-272 · di CLIENT byte ditarik lazy dari hub (readUploadOrFetch → /sync/attachments) bila absen lokal, lalu di-cache
POST  /tickets/:id/accept  { priority? }  # 201 { spec } — buat Spec source help prefilled + tandai tiket
#   accepted + specId (tautan dua arah). Idempoten: sudah promoted → 200 { alreadyPromoted:true, spec }. 404.
#   SPEC-297: inti accept kini di services/ticket-accept.ts (acceptTicket) — dipakai route ini DAN scheduler
#   source-checker `triase`; kontrak HTTP (201/200/404) & pemetaan kategori→source (SPEC-291) tak berubah.
#   SPEC-286 · payload.context memuat DIREKTIF periksa lampiran: bila tiket berlampiran → daftar nama+mime+path
#   upload (agar agen membaca isinya, biasanya screenshot) + cadangan API attachments; tanpa lampiran → "Tanpa lampiran".
POST  /tickets/:id/unlink                 # 200 { id, status:"new", specId:null } — lepas tautan backlog (kebalikan accept).
#   Non-destruktif: Spec dibiarkan (hapus manual). Reset status→new → bisa diterima lagi (Spec baru). Idempoten. 404. (SPEC-271)
POST  /tickets/:id/reject                 # 200 { id, status:"rejected" } — tutup tanpa Spec · 404
PATCH /tickets/:id  { title?, detail?, category?, status? }  # 200 TicketDetail — edit isi tiket; field opsional,
#   minimal satu (zTicketEditInput). category ∈ bug|fitur|pertanyaan|lainnya, status ∈ new|accepted|rejected.
#   400 body kosong/enum invalid. 404. (SPEC-269)
DELETE /tickets/:id                       # 200 { ok:true } — hapus tiket; TicketAttachment cascade (DB) +
#   file fisik di HANOMAN_UPLOAD_DIR dibersihkan best-effort (deleteUpload). 404. (SPEC-269)
```

> **Status publik** `publicStatus(ticket.status, spec.stage?)`: new→"Sedang ditinjau", rejected→"Ditutup",
> accepted+executing→"Sedang dikerjakan", done→"Selesai", selainnya→"Diterima". **Notifikasi** tiket baru →
> `Notification { type:"ticket", key:"ticket:<id>" }` (dedup), tersiar lewat grup `notifications` WS existing.
> **Sync (SPEC-268/ADR-0066):** **metadata** `Ticket` kini **tersync** (kolom `version`, entitas `ticket`
> di `SYNCED`; publish asal-hub pada create/accept/reject; `accessKeyHash` ikut snapshot, kunci plaintext
> tak menyeberang). **Lampiran** di `HANOMAN_UPLOAD_DIR` (server-local, **tetap tak disync** — file biner),
> disajikan **hanya ber-auth** ke triase —
> halaman status publik tak menampilkannya balik. **Halaman publik** `/help/*` di-mount SPA (routing baru,
> `main.tsx`) tanpa auth; fallback `index.html` existing → nol perubahan server untuk menyajikan halaman.
> Realtime area Triase = **HTTP polling** (pola ErrorsScreen), bukan kanal WS baru (ADR-0039).

## Scheduler (SPEC-294 · ADR-0072) — LOCAL per-instance
```
# Fondasi scheduler otonom (di belakang gate cookie; agent-token → domain `settings`). Semua default MATI.
GET  /api/scheduler/config   -> Scheduler (zScheduler: enabled, paused, maxConcurrent, autonomy, sources.{backlog,errors,triase})
PUT  /api/scheduler/config   { Scheduler }  -> Scheduler   # ganti blok penuh (pola PUT /settings). Pause = { paused:true }. 400 invalid.
GET  /api/scheduler/state    -> { config, cap, liveCount, sources:[{id,enabled,everyMin,minCount?,lastRunAt,nextRunAt}],
#                                  queue: SchedulerQueueItem[], sessions:[sesi live ber-item 'launched'] }
```
> Engine in-process (di-start dari `server.ts`, timer `.unref`; `app.ts` bebas-timer — **membalik sebagian
> ADR-0024**): per source enable+cadence → checker terdaftar (`registerSchedulerSource`) enqueue kandidat;
> governor drain antrean durable (`SchedulerQueueItem`, `specId @unique` idempoten) di bawah
> `cap=maxConcurrent` (dihitung dari `pty.listSessions`), urut prioritas, tahan saat cap penuh; **Pause**
> blokir drain ≤1 tick. Peluncuran lewat `startSpecSession` (jalur bersama Start manual); `flow` diturunkan
> `flowForSource(spec.source)` server-side. **Opt-in per project:** `PATCH /api/projects/:id { schedulerOptIn }`
> (lokal — tak masuk `FIELDS` sync). Semua knob & state **LOCAL per-instance** (tak disync).
>
> **Source-checker konkret pertama (SPEC-295):** `backlog` — saat cadence backlog jatuh-tempo, meng-enqueue
> semua `Spec` belum-mulai (`baseSha===null`) dari project `schedulerOptIn` urut prioritas `tinggi→sedang→rendah`
> (queue item `source:"backlog"`, idempoten via `specId @unique`). Project non-opt-in tak tersentuh.
> Terdaftar di `server.ts` (`registerBacklogSource()`) sebelum `startScheduler()`.
>
> **Source-checker konkret kedua (SPEC-296):** `errors` — saat cadence errors jatuh-tempo, untuk tiap `ErrorGroup`
> eligible (`status:"new"` ∧ `environment:"production"` ∧ `specId=null` ∧ `count ≥ sources.errors.minCount` ∧ project
> `schedulerOptIn`) memakai ulang `escalateErrorGroup` (`services/error-escalate.ts`) → Spec `qa` prioritas `tinggi`,
> lalu enqueue (queue item `source:"errors"`). Idempoten (grup escalated/resolved/ber-specId tersaring di query);
> banyak grup satu window, satu grup = satu backlog (tanpa limit checker — cap ditegakkan governor). Terdaftar di
> `server.ts` (`registerErrorsSource()`) sebelum `startScheduler()`.
>
> **Source-checker konkret ketiga (SPEC-297):** `triase` — saat cadence triase jatuh-tempo, untuk tiap `Ticket`
> eligible (`status:"new"` ∧ `category ∈ {bug,fitur}` ∧ `specId=null` ∧ project `schedulerOptIn`) memakai ulang
> `acceptTicket` (`services/ticket-accept.ts`, pemetaan kategori→source SPEC-291: bug→`qa`, fitur→`brief`) → Spec
> prioritas `sedang`, lalu enqueue (queue item `source:"triase"`). Kategori `pertanyaan`/`lainnya` **tak pernah**
> auto-accept (tetap manual). Idempoten (tiket accepted/rejected/ber-specId tersaring di query); banyak tiket satu
> window, satu tiket = satu backlog. Terdaftar di `server.ts` (`registerTriaseSource()`) sebelum `startScheduler()`.
>
> **Autonomy + akhir sesi (SPEC-298, daun #5):** governor menyuntik **klausa prompt per mode** dari
> `scheduler.autonomy` saat meluncurkan sesi — `full-control` = agen putuskan sendiri & tembus sampai `done`
> tanpa berhenti bertanya; `butuh-keputusan` = berhenti di titik keputusan (marker SPEC-184 → `Notification`
> `decision`, sesi tetap **memegang slot**). `engine.tick` (sebelum drain) menjalankan **rekonsiliasi akhir sesi**
> (`services/scheduler/reconcile.ts`) + `scanDecisions`: item `launched` yang mencapai `done` → `Notification`
> `done` + `SessionResult` ringkasan (diff review diturunkan `GET /api/specs/:id/review`, `baseSha..headSha`),
> **tanpa auto-merge** (merge tetap manual lewat git graph, ADR-0031); sesi mati sebelum `done` (gagal/limit) →
> `Notification` **`fail`** (tipe baru) + `markFailed(note)`, **tanpa retry**. Item `done`/`failed` tampil di
> `GET /api/scheduler/state.queue`; ringkasan di `GET /api/session-results`.
>
> **Panel Scheduler (SPEC-299, daun #6):** screen mandiri `SchedulerScreen.tsx` + nav item `ds/shell.tsx`
> (`key:"scheduler"`), **murni konsumen read-only** — tak menambah endpoint/skema/ADR. Self-poll `GET
> /api/scheduler/state` (5 dtk, pola ErrorsScreen) merender: status per source (enable/last-run/next-run),
> antrean (`status:"queued"`), sesi berjalan (`state.sessions`, indikator `decision`=menunggu keputusan),
> selesai (`status:"done"`, tombol **Buka review** deep-link `#spec=<id>` → diff/ringkasan di Review yang ada),
> gagal (`status:"failed"` + `note` alasan). Panel setelan menulis semua knob via `PUT /api/scheduler/config`
> (enable+cadence per source, cap, autonomy, ambang errors); **rem darurat** Pause (`{paused:true}`) / Stop
> (`{enabled:false}`) via endpoint yang sama; **opt-in per project** (pola helpEnabled) via `PATCH
> /api/projects/:id { schedulerOptIn }`. Judul spec di baris antrean/sesi di-resolve dari daftar backlog klien.
