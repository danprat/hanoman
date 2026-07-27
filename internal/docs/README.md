# internal/docs — Source of Truth index

Ini **index Source of Truth** hanoman. Setiap dokumen sebaiknya ter-link dari sini — konvensi, bukan lagi
gerbang mekanis (guardrail dicabut, ADR-0023). Kategori mengikuti vocabulary tetap.

## entrypoints
- [blueprint](entrypoints/blueprint.md) — gambaran satu halaman
- [brd](entrypoints/brd.md) · [prd](entrypoints/prd.md) · [frd](entrypoints/frd.md) · [rd](entrypoints/rd.md)

## product
- [blueprint](product/blueprint.md) · [scope-principles](product/scope-principles.md) · [onboarding](product/onboarding.md)

## business
- [brd](business/brd.md) · [pricing-rationale](business/pricing-rationale.md)

## requirements
- [prd](requirements/prd.md) · [frd](requirements/frd.md) · [rd](requirements/rd.md) · [acceptance-criteria (EARS)](requirements/acceptance-criteria-ears-standard.md)

## research
- [market-sizing](research/market-sizing.md) · [competitor-analysis](research/competitor-analysis.md) · [moat](research/moat.md)
- [audit SPEC-217 — path project optional](research/audit-spec-217-path-project-optional.md) — binding per-client SPEC-213 hanya setengah tersambung (spawn/IDE saja), tanpa UI & tak editable
- [audit SPEC-223 — scaffold project baru gagal (2 bug)](research/audit-spec-223-scaffold-repo-missing.md) — (1) `spawnSync git ENOENT` = cwd/repoDir hilang → `initRepo` idempoten sebelum `addWorktree`; (2) `tmux … command too long` = prompt besar inline di command tmux → prompt lewat berkas + `"$(cat)"` (ADR-0016)
- [audit SPEC-227 — review diff 500 `Not a valid object name main`](research/audit-spec-227-review-merge-base-main.md) — review worktree hidup hardcode fallback `main`; repo default `master`/`develop` → `git merge-base main HEAD` exit 128. Basis diff pakai `spec.baseSha` (fork tersimpan, SPEC-197/ADR-0030) lalu default repo yang benar-benar resolve, tak pernah literal "main"
- [audit SPEC-229 — merge via git graph selalu gagal (buntu tanpa sesi claude)](research/audit-spec-229-merge-git-graph-selalu-gagal.md) — jalur git graph (`runGitOp`) tak pernah warisi ADR-0031: konflik merusak working tree utama & "Force" gagal senyap, gerbang sesi aktif balas 409 di tiap merge. Fix: deterministik dulu, konflik/409 → sesi claude di worktree isolasi (pola integrate)
- [audit SPEC-230 — PRD jalan tanpa aksi lanjutan (review, merge/rebase)](research/audit-spec-230-prd-review-merge.md) — sesi PRD project-level tak punya `specId`; review+integrate terkopel `Spec` (frontend & server) → sel PRD polos. Fix: jalur review+integrate ber-skop sesi (branch `prd/<slug>` disimpan di sesi), tanpa perubahan skema (ADR-0054)
- [audit SPEC-242 — Setting model & effort sesi audit tak ada di UI](research/audit-spec-242-setting-model-sesi-audit.md) — `FLOW_PHASES` di `SettingsScreen.tsx` (cerminan runner `PIPELINES`) tak ikut menambah flow `audit` (ADR-0057); server/runner sudah dukung `phaseModelsForFlow("audit")`, hanya UI yang drift. Fix: tambah baris `audit → [Audit, Laporan]`
- [audit SPEC-244 — kontinuitas branch PRD→brief & audit→Finding QA + picker origin](research/audit-spec-244-branch-continuity-take-to-backlog.md) — take/promote tak set `branchFrom`; modal & whitelist server lokal-only, `resolveCommit` tak fallback `origin/`; `prd/<slug>` & `hanoman/<audit-id>` hidup hanya di origin. Fix: prefill branch + remote first-class + fallback `origin/<rev>` + klausa prompt skip-audit untuk qa-lanjutan-audit (ADR-0059)
- [audit SPEC-245 — interaksi git graph tak realtime](research/audit-spec-245-git-graph-realtime.md) — `GitGraph.tsx` hanya `load()` saat mount/opsi/aksi sinkron sendiri; tanpa polling, perubahan async (sesi claude commit, konflik diselesaikan di Terminal, commit terminal) tak tampil sampai refresh manual. Fix: silent live-refresh poll `load(true)` tiap 4 dtk (`!document.hidden`), tanpa perubahan skema/API/server
- [audit SPEC-258 — DSN sudah di-generate lalu "hilang" setelah refresh](research/audit-spec-258-dsn-hilang-setelah-refresh.md) — server BENAR (`toProjectView.monitoringEnabled` + test route hijau); akar di frontend: state `projects` App hanya dimuat saat login (WS cuma dorong specs/sessions), `DsnCard` init `useState(p.monitoringEnabled)` sekali → mutasi DSN lokal tak dirambatkan, re-mount baca prop basi `false`. Fix: `onProjectChanged`→`api.getProject`→`setProjects` (cermin `updateProject`), kena `HelpCenterCard` sekalian
- [audit SPEC-255 — edit id project (rename slug) berpengaruh DSN/Help Center/sync](research/audit-spec-255-edit-id-project.md) — `Project.id` invariant kekal (SPEC-146) di 3 lapis (skema PK+FK, `PATCH` tak sentuh id, UI tanpa input); slug meng-embed DSN (`/api/ingest/<id>`) & Help URL (`/help/<id>`) + jadi `recordId` sync. Rename butuh `ON UPDATE CASCADE` + update 4 ref longgar + `LocalBinding` + operasi rename lintas node sync (hub publik menyajikan DSN/Help). Fix penuh: ADR-0064 → migration + service transaksi + endpoint + sync rename + UI konfirmasi
- [audit SPEC-265 — belum ada dokumentasi resmi integrasi AI agent + tak ada link di UI](research/audit-spec-265-agent-integration-docs.md) — fitur agent capability (SPEC-257/ADR-0065) sudah lengkap server+UI, tapi tak ada panduan berhadapan-agen (padanan `sdk/README.md`) & panel "Akses AI Agent" tak menaut dokumentasi. Fix (Spec/Plan skipped): buat `docs/agent-integration.md` + link "Dokumentasi integrasi" di `SettingsScreen.tsx` + taut di index & api-contract
- [audit SPEC-267 — status backlog local & server tidak sync](research/audit-spec-267-status-backlog-sync.md) — kemajuan stage otomatis (write-through `liveSpecs`) tak pernah `enqueueOutbox` → cara dominan status backlog berubah tak pernah ter-push ke hub; PATCH mundur sudah antre, tapi advance maju tidak. Fix (Spec/Plan skipped, tanpa ADR): enqueue `outbox("spec", id)` pada CAS write-through yang benar-benar menulis (`count > 0`) — mendorong stage ke hub sekaligus melindungi dari clobber pull basi (pull-before-push)
- [audit SPEC-330 — write asal-HUB tak masuk change-feed (backlog hub tak turun ke local)](research/audit-spec-330-sync-hub-origin-writes.md) — `routes/specs|projects|vps` + `vps-audit` + `session-result` memanggil `enqueueOutbox()` langsung (mekanisme khusus-CLIENT); di hub tak ada drainer → write asal-hub menumpuk di `SyncOutbox` yatim, tetap `version 0` **tanpa baris `SyncLog`**, dan `pull` (yang hanya baca feed) tak pernah melihatnya sampai reboot menjalankan `backfillFeed` (ADR-0067). Bukti prod: 25 baris outbox yatim, 13 spec v0 tanpa feed (`SPEC-317`…`329`), cursor client sudah di kepala feed. Fix (Spec/Plan skipped, tanpa ADR/skema): 14 call site → helper sadar-peran `notifySynced()` (SPEC-268/ADR-0066) + restart hub untuk backfill. Sisa gap: `updatedAt` bukan jam LWW andal (di-restamp `@updatedAt` penerima), delete tak punya tombstone (kasus `SPEC-274`), rename asal-hub tak merambat
- [audit SPEC-341 — Start sesi backlog me-redirect ke Terminal](research/audit-spec-341-start-backlog-redirect-terminal.md) — callback sukses tunggal `StartSessionModal` di `App.tsx` memanggil `setSection("terminal")`, sehingga Start dari grid/list/board/detail selalu meninggalkan Backlog. Fix (Spec/Plan skipped, tanpa ADR/API): hapus side effect navigasi; sesi tetap mulai, modal tertutup, toast tampil, dan Terminal tetap bisa dibuka lewat aksi eksplisit
- [audit SPEC-271 — unlink backlog dari triase (Errors & Help Desk)](research/audit-spec-271-unlink-backlog-triase.md) — eskalasi/accept membuat tautan dua arah satu-kali-jalan tanpa kebalikan: begitu `specId` terisi, UI ganti tombol jadi Badge statis → tak bisa unlink maupun eskalasi ulang. Fix (Spec/Plan skipped, tanpa ADR): endpoint `POST /errors|tickets/:id/unlink` (reset `status:"new"`, `specId:null`, non-destruktif — Spec tetap) + tombol Unlink di detail Errors/Triase; setelah lepas, eskalasi/terima muncul lagi. Nomor doc 271 karena SPEC-270 sudah terklaim (design sync)
- [audit SPEC-262 — agent capability: apakah termasuk PRD/Errors/Help Desk?](research/audit-spec-262-agent-capability-prd-errors-helpdesk.md) — ketiganya SUDAH tercakup: PRD di domain `docs` (`prds`→docs), Errors & Help Desk-triase di `support` (`errors`/`tickets`→support); metadata `label`/`desc` katalog memang menyebutnya. Akar keluhan: grid UI `SettingsScreen.tsx:420` hanya merender slug domain (`docs`, `support`) tanpa label/desc → tak ketemu saat dicari "prd/errors/help desk". Help Center publik `/api/help` sengaja bypass gate (customer-facing). **Resolved SPEC-264** (frontend-only, tanpa ADR): tambah `CAPABILITY_DOMAINS` (label+desc per-domain, `docs→"Docs & PRD"`, `support→"Errors & Help Desk"`) + grid render label/subteks alih-alih slug; PRD/Errors/Help Desk kini terbaca
- [audit SPEC-275 — stack trace error tak cerminkan source code (parity source-map ala Sentry)](research/audit-spec-275-stack-trace-source-map-parity.md) — pipeline error monitoring (SPEC-249/ADR-0060) menyimpan & menampilkan stack **mentah** di tiap lapis (SDK→ingest→`sampleStack`→`<pre>`); untuk bundle browser prod = minified+content-hash → tak terpetakan ke `.tsx`. **Temuan A** (primer): tak ada symbolication/source-map — **sengaja di-defer** (PRD Non-goals :58, Open Q#5 :151; ADR-0060 :54) → **cukup jawaban**, bila mau parity buka **fitur baru** (butuh ADR: frame parser + artifact source-map ber-`release` + resolver). **Temuan B** (sekunder, bug asli): `topFrame` memuat basename bundle ber-hash → **grup pecah tiap deploy** (count/first-seen reset, notif re-fire) → **naikkan jadi Finding QA** (perbaikan kecil di `fingerprint`, jalur cepat QA)
- [audit SPEC-286 — eskalasi triase ke backlog tidak mengecek attachment](research/audit-spec-286-eskalasi-triase-attachment.md) — accept tiket (`tickets.ts`) merujuk lampiran sebagai hitungan pasif `Lampiran: N berkas` (cuma `_count`); payload mengalir ke prompt agen via `startPrompt`→`Detail:`, jadi agen tak pernah disuruh (dan tak bisa) membuka screenshot pelapor. Fix (Spec/Plan skipped, tanpa ADR): `include attachments` + `payload.context` jadi DIREKTIF `PERIKSA` berisi nama+mime+path upload (agen `Read` langsung, sesi lokal) + cadangan API; tanpa lampiran → `Tanpa lampiran` (hapus noise `0 berkas`). Errors tak terdampak (grup error tak berlampiran)
- [audit SPEC-289 — teks di terminal tidak bisa di-copy](research/audit-spec-289-terminal-copy.md) — `TerminalPane` membuka `@xterm/xterm` tapi tak pernah mewiring salin; xterm merender seleksinya sendiri (canvas) → Cmd/Ctrl+C browser tak menyalin apa pun (docs xterm: `getSelection()` untuk copy "outside of xterm.js"). Fix (Spec/Plan skipped, tanpa ADR): helper murni `clipboardIntent` (Cmd atau Ctrl+Shift = salin/tempel; Ctrl polos dilewatkan agar Ctrl+C tetap SIGINT) + `attachCustomKeyEventHandler` → `navigator.clipboard.writeText(getSelection())`/`readText()`; kedua jenis sesi (Claude & Terminal biasa) pakai pane sama jadi keduanya terperbaiki
- [audit SPEC-293 — link ticket triase (buka/copy link backlog + link publik status; status turunan backlog)](research/audit-spec-293-link-ticket-triase.md) — detail triase cuma badge statis `→ specId` tanpa aksi/status; SPA tak punya routing & kunci tiket hash-at-rest. Fix (Spec→Plan→Execute, ADR-0071): deep-link hash `#spec=<id>` (App mount → backlog+SpecDetail) + `publicStatus` pindah ke `shared` (badge status turunan stage backlog) + kolom `Ticket.shareToken` (opaque bagikan) → route publik terima shareToken → `GET /tickets/:id` kembalikan `publicStatusUrl`; tombol buka/salin di Triase (+ paritas backlog-link di Errors)
- [audit SPEC-291 — miss eskalasi triase → backlog: semua type jadi "feature"](research/audit-spec-291-eskalasi-triase-per-type.md) — `tickets.ts` `accept` hardcode `source: "help"` tanpa melihat `t.category` → `flowForSource("help")`→`feature` & `SOURCE_META` fallback ke "feature brief", jadi setiap tiket jadi feature brief. Errors escalate sudah benar (`qa`). Fix (Spec/Plan skipped, tanpa ADR/migration): peta `category→source` — bug→`qa` (finding QA), fitur→`brief` (feature brief), pertanyaan→`audit`, lainnya→`brief`; payload mengikuti bentuk source (qa-shaped `actual` vs brief-shaped `context`), direktif lampiran SPEC-286 tetap utuh

## architecture
- [stack](architecture/stack.md) · [data-model](architecture/data-model.md) · [api-contract](architecture/api-contract.md) · [nfr](architecture/nfr.md)
- [vps-compliance](architecture/vps-compliance.md) — kerangka kepatuhan checklist 232 item (SPEC-220 · ADR-0050)

## integrasi (untuk project yang memakai hanoman)
- [SDK error monitoring — npm `hanoman-sdk`](../../sdk/README.md) — cara project lain mengirim error ke hanoman: `npm i hanoman-sdk` → `init({ dsn })` + `captureError()` (Node/browser) atau POST JSON generik langsung → grouping & eskalasi ke backlog (SPEC-249/254 · ADR-0060/0063)
- [Integrasi AI agent — agent token + capability](../../docs/agent-integration.md) — panduan berhadapan-agen: nyalakan akses di Settings → buat token `hnm_agt_…` → `Authorization: Bearer` ke seluruh `/api`, digerbang capability per-domain; ditaut dari panel "Akses AI Agent" di UI (SPEC-257/265 · ADR-0065)

## adr
> Nomor unik & imutable. ADR usang tidak dihapus — ditandai statusnya di bawah dan di header masing-masing.
- [0076 — Eskalasi audit dinamis: manifest rekomendasi di dokumen audit + tiga pintu (QA · brief · PRD)](adr/0076-eskalasi-audit-dinamis-manifest-rekomendasi.md) — **memperluas 0057** (audit-only kini punya tiga tindak lanjut, bukan satu), memakai pola **0069** (prosa + blok json kanonik), terkait 0075/0059/0041/0018/0011 (SPEC-340): fase Laporan menulis blok ```json `{escalation:{target:"none|qa|brief|prd",reason,alternatives,prefill}}` di dokumen audit → `parseEscalation` defensif + `GET /api/specs/:id/escalation` menyajikannya sebagai **nilai turunan** (freshest-wins, tanpa kolom DB); `SpecDetail` (source `audit` **dan** `cross-audit`) menyorot target rekomendasi + alasannya tapi tetap menyediakan ketiganya (manusia terakhir memutuskan); kontinuitas: brief lanjutan audit memakai `fromAudit` **tanpa** fase `skipped` (beda sadar dari qa — audit memuat temuan, bukan bentuk solusi), sesi PRD menerima `branchFrom` (worktree dari branch audit) **dan** `fromAudit` (isi dokumen audit disematkan ke prompt). Tanpa migration
- [0075 — Audit lintas project: relasi `ProjectLink` + flow `cross-audit` + kunci log ber-scope sesi](adr/0075-audit-lintas-project-projectlink-kunci-sesi.md) — **memperluas 0057** (audit-only kini punya varian lintas project), terkait 0002/0015/0016/0060/0028/0064, sengaja **tidak** memakai 0065 (SPEC-337): model `ProjectLink` berarah (`kind`+`note`, cascade FK, LOCAL-only) menjadikan relasi integrasi pengetahuan tetap hanoman; flow `cross-audit` dua pintu (backlog berdokumen + sesi lepas tanya-jawab) dengan worktree tunggal di project utama & checkout tetangga read-only; kunci `hnm_xa_…` hidup di tmux option (mati bersama pane, tak pernah keluar lewat API) menggerbangi `GET /api/audit/logs` — timeline `ErrorEvent` semua project ter-scope, tercampur & terurut waktu
- [0074 — Codex sebagai mesin sesi: `Agent` per sesi, hook lewat `-c`, mode goal deterministik](adr/0074-codex-sebagai-mesin-sesi.md) — **memperluas 0024/0061/0073**, terkait 0002/0016/0029/0037 (SPEC-338): `Setting.agent` + `Setting.codex` (tanpa migration), `agent` opsional di `POST /terminal/sessions`, `@hanoman_agent` di tmux, argv per agen di `runner/src/agent-cli.ts`; codex tak punya event `Notification` (marker keputusan pakai `Stop`+`UserPromptSubmit`) dan **mendiamkan hook `type="prompt"`** → mode goal jadi gate sh deterministik (phase file + checkbox plan, exit 2 = continuation) berpagar 25 penolakan; `ensureCodexTrust` membuka gerbang trust direktori (satu entri per project, worktree mewarisi root); indikator limit codex = badge & endpoint TERPISAH (`GET /api/limits/codex` + grup siar `codexLimits`), dibaca dari snapshot `rate_limits` di rollout sesi codex — nol jaringan, nol sentuhan token; label window diturunkan dari `window_minutes` karena `primary` bisa 5-jam ATAU mingguan
- [0073 — Mode goal sesi backlog: Stop hook bertipe `prompt` saat sesi lahir + keystroke `/goal`](adr/0073-mode-goal-stop-hook-per-sesi.md) — **memperkuat 0035** (otonomi lintas-fase jadi mekanisme, bukan imbauan prompt), cermin runtime bagi 0029 (gate plan terceklist), pola 0061 (knob → argv saat lahir), **TIDAK membalik 0037** (SPEC-332): `guardSettings` menyisipkan `hooks.Stop=[{type:"prompt",prompt:<kondisi>}]` ke `--settings` (jaminan, deterministik) + `armGoalInTui` mengetik `/goal` ke pane (visibilitas TUI, best-effort — keduanya tak saling hapus karena `/goal` hanya membaca session hooks registry); kondisi default = DoD hanoman yang menuntut **bukti segar** di transkrip (evaluator hook tanpa tool & transkrip dipotong); knob `Setting.goal` + `goal`/`goalCondition` di `POST /terminal/sessions`, presedens override→template→default; cakupan sesi backlog, default mati, tanpa migration
- [0072 — Fondasi scheduler otonom: engine in-process, antrean durable, cap concurrency](adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md) — **membalik sebagian 0024**, memperluas 0015/0016/0025/0049, terkait 0045 (SPEC-294): engine sweep in-process (server.ts, timer `.unref`), tabel `SchedulerQueueItem` (LOCAL-only, `specId @unique` idempoten), governor cap=`maxConcurrent` dari `pty.listSessions`, Pause; knob `Setting.scheduler` + `Project.schedulerOptIn` (default mati); kontrak `registerSchedulerSource`/`enqueue` + `GET/PUT /api/scheduler/config` & `GET /api/scheduler/state`
- [0071 — Link ticket triase: deep-link backlog (hash SPA) + token bagikan status publik](adr/0071-link-ticket-triase-deeplink-sharetoken.md) — **memperluas 0062**, terkait 0018/0019/0044/0066 (SPEC-293): deep-link `#spec=<id>` sekali-mount (bukan router umum), `publicStatus` di `shared`, kolom `Ticket.shareToken` (opaque) → route publik terima kunci pelapor ATAU shareToken; `GET /tickets/:id` kembalikan `publicStatusUrl`
- [0070 — Symbolication source-map server-side (parity Sentry)](adr/0070-symbolication-source-map-server-side.md) — **melengkapi 0060** (source-map browser yang di-defer post-MVP kini diimplementasikan), terkait 0063/0024/0062/0066 (SPEC-276): frame terstruktur SDK + upload `.map` per `release` (`POST /api/ingest/:slug/sourcemaps`) + symbolication lazy display-time (`@jridgewell/trace-mapping`, context lines, `in_app`) + fix Temuan B fingerprint content-hash
- [0069 — Breakdown PRD → backlog paralel-independen (sesi breakdown + manifest + materialize)](adr/0069-breakdown-prd-ke-backlog-paralel.md) — **memperluas 0041**, terkait 0015/0002/0032/0059 (SPEC-273): flow `breakdown` menulis `docs/prd/<slug>.breakdown.md` (prosa + blok json kanonik); `GET /projects/:id/breakdown` + `POST /specs/batch` materialize N spec independen; tanpa perubahan skema
- [0068 — Lampiran tiket masuk record-sync (metadata di feed, byte lazy-fetch)](adr/0068-lampiran-tiket-masuk-record-sync.md) — **mencabut sebagian 0066**, memperluas 0045, terkait 0043/0067/0062 (SPEC-272): entitas `ticketAttachment` di `SYNCED` (metadata) + endpoint biner hub `GET /api/sync/attachments/:storageKey` (device-token) + `readUploadOrFetch` fetch-through+cache di client; arah hub→local
- [0067 — Sync self-healing: backfill feed + rekonsil konflik manual (LWW-default)](adr/0067-sync-lww-reconciliation-manual.md) — **memperluas 0045**, terkait 0043/0046/0066/0008 (SPEC-270): `updatedAt @updatedAt` jam LWW, tabel `SyncConflict` + modal side-by-side, `backfillFeed` boot hub
- [0066 — Errors & tickets masuk record-sync (publish asal-hub) + pemicu sync manual](adr/0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md) — **memperluas 0045**, terkait 0043/0046/0060/0062 (SPEC-268)
- [0065 — AI agent capability: agent token + capability scope per-domain gating `/api`](adr/0065-ai-agent-capability-agent-token.md) — **memperluas 0028**, cermin 0044, terkait 0037 (SPEC-257)
- [0064 — `Project.id` renameable lewat operasi rename khusus (cascade + merambat sync)](adr/0064-project-id-renameable.md) — **mencabut sebagian SPEC-146**, memperluas 0045/0046/0060/0062 (SPEC-255)
- [0063 — hanoman-sdk sebagai npm package publik (extensible, errors dulu)](adr/0063-hanoman-sdk-npm-package.md) — **memperluas 0060** (SPEC-254)
- [0062 — Help Center: model tiket + endpoint publik ber-scope-project + jembatan triase→backlog](adr/0062-help-center-tiket-publik-triase.md) — **memperluas 0060/0028/0033/0039** (SPEC-253)
- [0061 — Model & effort per sesi (picker saat Start), mencabut matrix per-fase](adr/0061-model-effort-per-sesi-picker-start.md) — **mengamandemen 0058** (SPEC-252)
- [0060 — Error monitoring: model baru + ingest ber-DSN sebagai pengecualian auth](adr/0060-error-monitoring-ingest-ber-dsn.md) — **memperluas 0028/0033/0039/0040** (SPEC-249)
- [0059 — Kontinuitas branch take-to-backlog (PRD→brief, audit→QA) + skip-audit qa lanjutan audit](adr/0059-kontinuitas-branch-take-to-backlog-dan-skip-audit.md) — **memperluas 0032/0040/0041/0057** (SPEC-244)
- [0058 — Model & effort per fase, lewat `/model`+`/effort` in-session](adr/0058-model-effort-per-fase.md) — **mengamandemen 0024, sebagian menghidupkan 0003** (SPEC-238) — *mekanisme per-fase dicabut oleh 0061*
- [0057 — Audit-only sebagai source + flow (dokumen, tanpa perbaikan)](adr/0057-audit-only-source-flow.md) — SPEC-237
- [0056 — Terminal biasa = shell mentah di repoDir project (bukan claude)](adr/0056-terminal-shell-non-claude.md) — SPEC-236, pola ADR-0042
- [0055 — Git graph parity: taksonomi operasi + eksekusi berlapis](adr/0055-git-graph-parity-op-taxonomy.md) — **memperluas 0034/0053** (SPEC-233)
- [0054 — Review + integrate ber-skop sesi untuk sesi project-level (PRD)](adr/0054-review-integrate-ber-skop-sesi-untuk-prd.md) — **memperluas 0041**
- [0053 — Merge via git graph: deterministik di worktree isolasi, konflik → sesi claude (pola integrate)](adr/0053-git-graph-merge-worktree-isolasi-sesi-claude.md)
- [0052 — Scaffold flow: project from-scratch dari ide → SoT penuh (git-init + startScaffoldPrompt)](adr/0052-scaffold-flow-from-ide.md)
- [0051 — Kepatuhan VPS Fase 3: drift derived + Notification agregat, applicability app-layer advisory](adr/0051-vps-fase3-drift-applicability.md)
- [0050 — Kepatuhan VPS: katalog 232 item di git + model state + scoring + remediasi dry-run](adr/0050-vps-compliance-katalog-scoring.md)
- [0049 — Config runtime: store + registry (knob sync di Settings)](adr/0049-config-runtime-store-registry.md)
- [0048 — Auto-update: deteksi versi read-only, tanpa self-mutation](adr/0048-auto-update-deteksi-read-only.md)
- [0047 — Ringkasan hasil sesi = SessionResult append-only, whitelist, purge manual](adr/0047-activity-log-session-result.md)
- [0046 — Kanal WebSocket sync terpisah, token-authed pada upgrade](adr/0046-kanal-ws-sync-terpisah.md)
- [0045 — Sync record via SyncLog change-feed + version-stamp optimistic concurrency](adr/0045-skema-sync-synclog-version-stamp.md)
- [0044 — Identitas mesin lewat device token per-device (hash-at-rest, revocable)](adr/0044-device-token-machine-identity.md)
- [0043 — Sync server↔client = server-to-server, peran ditentukan konfigurasi](adr/0043-sync-arsitektur-hub-client-server-to-server.md)
- [0042 — Open Console = ssh mentah di tmux hanoman lokal, bukan tmux remote](adr/0042-vps-console-ssh-tmux-lokal.md)
- [0041 — PRD adalah dokumen + flow project-level, bukan entitas DB](adr/0041-prd-sebagai-dokumen-flow-project-level.md)
- [0040 — Jalur cepat qa dielicit lewat prompt, diputuskan agen](adr/0040-jalur-cepat-qa-dielicit-prompt.md) — **supersedes mekanisme 0020**
- [0039 — Data real-time dashboard lewat satu WebSocket siar, bukan polling klien](adr/0039-realtime-lewat-websocket-siar.md)
- [0038 — Paginasi/filter daftar di response layer, overlay atas set penuh](adr/0038-paginasi-di-response-layer.md)
- [0037 — Cabut guardrail deny perintah (PreToolUse) sepenuhnya](adr/0037-cabut-guardrail-safety.md)
- [0034 — IDE Visual boleh memutasi working tree, digerbang sesi + force](adr/0034-ide-mutasi-working-tree-utama.md)
- [0036 — Notifikasi human decision dari hook Claude](adr/0036-notifikasi-human-decision.md)
- [0035 — Sesi menembus batas fase tanpa berhenti kecuali butuh keputusan manusia](adr/0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md)
- [0033 — Notifikasi saat backlog selesai](adr/0033-notifikasi-backlog-selesai.md)
- [0032 — Branch adalah properti backlog item](adr/0032-branch-adalah-properti-backlog-item.md)
- [0031 — Rebase & merge branch done spec dari dashboard](adr/0031-rebase-merge-backlog.md)
- [0030 — `Spec` menyimpan baseSha/headSha; review done men-diff darinya](adr/0030-spec-menyimpan-base-head-sha.md)
- [0029 — `Execute done` hanya sah bila plan terceklist penuh](adr/0029-execute-done-butuh-plan-terceklist.md)
- [0028 — Auth: sesi opaque revocable di DB, bind 127.0.0.1 + reverse proxy TLS](adr/0028-auth-sesi-opaque-di-db.md)
- [0027 — Stage boleh mundur atas perintah human eksplisit](adr/0027-revert-stage-backward-only.md)
- [0026 — Reverse docs sebagai sesi interaktif project-level](adr/0026-reverse-docs-sesi-interaktif-project-level.md)
- [0025 — Modul VPS: tabel sendiri, script deterministik, tanpa queue](adr/0025-modul-vps-script-deterministik.md)
- [0024 — Sesi Claude Code interaktif menggantikan run](adr/0024-sesi-interaktif-menggantikan-run.md) — **supersedes 0005/0012/0017/0022, sebagian 0010, melemahkan 0008**
- [0023 — Guardrail Source of Truth dicabut](adr/0023-guardrail-sot-dicabut.md) — **supersedes 0001**
- [0022 — Agen bertanya, run berstatus `awaiting`](adr/0022-pertanyaan-agen-berstatus-awaiting.md) — *superseded by 0024*
- [0021 — Nomor SPEC diklaim docs, bukan hanya database](adr/0021-nomor-spec-diklaim-docs-bukan-hanya-database.md)
- [0020 — Fase perencanaan QA dipangkas oleh keputusan audit](adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md) — *mekanisme superseded by 0040*
- [0019 — SHA disimpan, diff diturunkan](adr/0019-sha-disimpan-diff-diturunkan.md)
- [0018 — Coverage diturunkan saat dibaca, bukan disimpan](adr/0018-coverage-nilai-turunan.md)
- [0017 — Run terputus melanjutkan sesinya](adr/0017-run-terputus-melanjutkan-sesinya.md) — *superseded by 0024*
- [0016 — Sesi terminal hidup di tmux](adr/0016-sesi-terminal-hidup-di-tmux.md)
- [0015 — Satu backlog, satu sesi Claude](adr/0015-one-session-per-backlog.md)
- [0014 — Sesi interaktif lewat PTY di proses API](adr/0014-pty-terminal-di-proses-api.md)
- [0013 — SoT coverage scoped to docsDir](adr/0013-sot-coverage-scoped-to-docsdir.md)
- [0012 — Biaya adalah estimasi, bukan guardrail](adr/0012-cost-is-an-estimate-not-a-guardrail.md) — *superseded by 0024*
- [0011 — Docs adalah filesystem nyata, bukan salinan DB](adr/0011-docs-realtime-filesystem.md)
- [0010 — Runner spawn `claude` CLI langsung, bukan Agent SDK](adr/0010-runner-spawns-claude-cli.md) — *sebagian superseded by 0024 (gate PreToolUse tetap)*
- [0009 — Guardrail yang crash gagal keras](adr/0009-guardrail-crash-fails-loud.md) — *historis per 0023*
- [0008 — Spec stage mirrors a real run](adr/0008-stage-mirrors-run.md) — *diamandemen 0024/0027/0029*
- [0007 — Run.finishedAt untuk durasi nyata](adr/0007-run-finished-at.md) — *de-facto obsolete (0024)*
- [0006 — GitHub App schema](adr/0006-github-app-schema.md) — *de-facto obsolete (0024)*
- [0005 — Antrian durable (BullMQ/Redis) + worker](adr/0005-durable-queue-and-worker.md) — *superseded by 0024*
- [0004 — Foundation schema deltas](adr/0004-foundation-schema-deltas.md)
- [0003 — Pemilihan model per step](adr/0003-per-step-model-selection.md) — *de-facto obsolete (0024)*
- [0002 — Isolasi run dengan git worktree](adr/0002-git-worktree-isolation.md)
- [0001 — Docs sebagai Source of Truth](adr/0001-docs-as-source-of-truth.md) — *superseded by 0023*

## operations
- [roadmap](operations/roadmap.md) · [gtm](operations/gtm.md) · [agent-documentation-workflow](operations/agent-documentation-workflow.md)
- [production](operations/production.md) — menjalankan instance prod di samping dev (database + port terpisah)
- [deploy-vps](operations/deploy-vps.md) — deploy single-host ke VPS publik di belakang reverse proxy TLS

## security
- [security-standard](security/security-standard.md)

## design-system
- [design-system](design-system/design-system.md)

## frontend
- [frontend-implementation](frontend/frontend-implementation.md)

> Chiranjivi — docs bertahan lebih lama dari satu commit atau sesi. Jaga index ini tetap sinkron.
