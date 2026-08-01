---
name: hanoman
description: >-
  Pakai saat mengerjakan project hanoman: orchestrator + dashboard workflow
  docs-driven untuk nafanesia.id — perencanaan produk, arsitektur (Fastify +
  SQLite/Prisma + node-pty/tmux + git worktree), distribusi paket npm global
  (`hanoman start|doctor|update|migrate-from-postgres`), sesi Claude Code
  interaktif, fase spec/plan/execute, backlog & PRD, terminal realtime, modul
  VPS/sync, auth, keamanan, design system, docs Source of Truth, atau operasi
  agent di dalam repo hanoman.
---

# hanoman

## Ikhtisar

hanoman adalah **orchestrator workflow docs-driven** untuk nafanesia.id: ia menyuruh **Claude Code** membangun project terhadap dokumentasi sebagai kebenaran, lalu memantau semua sesi dalam satu dashboard yang tenang. Manusia menuang ide / menulis brief / memfilekan QA finding → hanoman brainstorm sampai **MVP objective** terkunci → **scaffold** doc index (from-scratch) atau **reverse-engineer** docs dari codebase (existing). Brief & finding menjadi **spec** di backlog; spec di-**plan** lalu di-**execute** oleh Claude Code sebagai **sesi interaktif** di **git worktree terisolasi** per backlog. Pakai skill ini untuk menjaga keputusan produk, arsitektur, sesi, keamanan, dan docs tetap selaras dengan `internal/docs/**`.

## Bacaan Awal

Saat memulai kerja hanoman, baca hanya doc yang dibutuhkan task:

- Index Source of Truth: `internal/docs/README.md`
- Blueprint satu halaman: `internal/docs/entrypoints/blueprint.md`
- Entrypoints: `internal/docs/entrypoints/{brd,prd,frd,rd}.md`
- Product: `internal/docs/product/blueprint.md` · `scope-principles.md` · `onboarding.md`
- Requirements detail: `internal/docs/requirements/{prd,frd,rd}.md`
- Standar acceptance (EARS): `internal/docs/requirements/acceptance-criteria-ears-standard.md`
- Tech stack: `internal/docs/architecture/stack.md`
- Data model (tujuh model): `internal/docs/architecture/data-model.md`
- Kontrak API: `internal/docs/architecture/api-contract.md`
- NFR: `internal/docs/architecture/nfr.md`
- Kontrak agent: `internal/docs/operations/agent-documentation-workflow.md`
- Standar keamanan: `internal/docs/security/security-standard.md`
- Design system (editorial, bone paper, brass accent): `internal/docs/design-system/design-system.md`
- Implementasi frontend: `internal/docs/frontend/frontend-implementation.md`
- Roadmap & GTM: `internal/docs/operations/{roadmap,gtm}.md`
- Deploy: `internal/docs/operations/deploy-vps.md` (single-host VPS, npm + systemd) · `production.md` (prod di samping dev) · `npm-readme.md` (README yang terbit bersama paket npm)
- ADR (nomor unik & imutable): daftar lengkap di `internal/docs/README.md`, narasinya di `internal/docs/adr/README.md`; yang paling sering diacu — 0086 (SQLite satu-satunya provider) & 0087 (distribusi npm global), 0024 (sesi interaktif menggantikan run), 0023 (guardrail SoT dicabut), 0037 (guardrail safety dicabut), 0002 (isolasi worktree), 0015 (satu backlog satu sesi), 0016 (sesi tmux), 0028 (auth sesi opaque), 0011/0018 (docs & coverage live/derived), 0035 (sesi tembus batas fase), 0041 (PRD sebagai dokumen), 0043–0048 (sync/device-token/auto-update).
- Kontrak agent repo: `AGENTS.md` · `CLAUDE.md` (root repo).

## Sub-Skill

Pakai skill lebih sempit saat task cocok:

- `hanoman-devops` (`internal/skills/hanoman-devops/SKILL.md`) — deploy & operasikan aplikasi hanoman di server: instalasi paket npm global + systemd, VPS single-host di belakang reverse proxy TLS, prod di samping dev lewat `HANOMAN_HOME`, migrasi sekali-jalan dari Postgres, `hanoman update` (SPEC-398), rollout sync hub/client (SPEC-213), dan verifikasi/troubleshoot.

## Aturan Produk

- Bentuk produk: **instrument panel yang tenang**. Overview sebagai beranda; tiap area (Projects/PRD/Backlog/Terminal/Docs/VPS/Settings) satu klik dari sidebar; Terminal adalah pusat gravitasi saat sesuatu berjalan.
- **Manusia terakhir yang memutuskan.** Otomasi penuh boleh, tapi selalu bisa diinterupsi/di-steer.
  **Kecuali project yang meng-opt-in hanoman-lead** (SPEC-409/ADR-0091): di sana prinsipnya jadi
  **"manusia terakhir yang bisa membatalkan"** — lead memutuskan lalu melapor. Opt-in per project,
  default mati; selama `Setting.lead.enabled` mati prinsip lama berlaku di seluruh workspace.
- **Satu workspace dulu** (nafanesia.id). Multi-tenant adalah pasca-MVP.
- Objektif MVP: satu operator menjalankan & memantau Claude Code di banyak project sekaligus, dengan docs sebagai Source of Truth, tanpa kehilangan kendali atas sesi berjalan.
- Empat lakon (temperamen produk): **Anoman Duta** (kepercayaan dibuktikan spec & docs), **Anoman Obong** (sesi menyelesaikan tugas & lapor balik), **Gunung Dronagiri** (ragu → dokumentasikan semuanya), **Chiranjivi** (docs abadi melampaui commit).
- PRD (SPEC-210) duduk di hulu Backlog: brief + brainstorm → dokumen PRD sebelum fitur dipecah ke spec + plan.

## Aturan Arsitektur

- Dashboard: **React + TypeScript + Vite**. Server: **Node.js + TypeScript (Fastify)**. DB: **SQLite via Prisma 6** — satu berkas di `$HANOMAN_HOME` (default `~/.hanoman/hanoman.db`), **tanpa Docker/Postgres/Redis** (SPEC-398/ADR-0086). Lokasi data ditentukan tiga fungsi murni di `runner/src/paths.ts` (`resolveHome`/`resolveDbUrl`/`dbFilePath`), dipakai server **dan** CLI; `DATABASE_URL` non-`file:` **melempar** dan menunjuk `hanoman migrate-from-postgres`.
- **Distribusi = paket npm global** (SPEC-398/ADR-0087): `npm i -g hanoman` → `hanoman`. `hanoman` telanjang = `start` (migrate deploy → **spawn** `node dist/server.js` sebagai proses anak dengan `NODE_ENV=production`); `doctor` melaporkan prasyarat non-npm (node ≥ 20 · git · tmux · `claude`/`codex` · izin tulis home · aset web) dengan exit code; `update [--check]` membandingkan semver vs registry npm lalu menjalankan `npm i -g hanoman@latest`; `migrate-from-postgres` memindahkan instance lama. `resolveLayout()` mengenali **dua** layout (paket npm vs checkout repo), aset dashboard dipilih `pickWebDir()`. Deteksi update tetap **read-only** di server (ADR-0048 utuh) — yang memasang adalah CLI, karena server yang me-`npm i` dirinya sendiri lalu keluar akan memutus sesi tmux. Staging rilis `dist-npm/` dirakit `hanoman __pack` (`pnpm release`); **`npm publish` tindakan manusia**.
- **Update sekali klik, tapi server tetap tak memasang apa pun** (SPEC-405/ADR-0088, mengamandemen
  ADR-0048 & membalik satu alternatif yang ditolak ADR-0087): `POST /api/update/apply` hanya membuat
  proses server **keluar dengan `UPDATE_RESTART_EXIT = 75`**; yang menjalankan `npm i -g hanoman@latest`
  → `prisma generate` → `migrate deploy` → spawn lagi adalah **CLI parent `hanoman start`**, yang sejak
  ADR-0087 memang sudah men-spawn server sebagai proses ANAK. **Supervised-only**: digerbangi
  `process.env.HANOMAN_SUPERVISOR === "1"` yang HANYA disuntik `serverEnv()` di
  `cli/src/commands/start.ts` dan diekspor sebagai `UpdateStatus.canApply` — **dibaca dari
  `process.env` langsung, bukan `effectiveBool()`**, karena helper itu membaca cache config DB lebih
  dulu sehingga siapa pun yang bisa menulis config bisa mengaku disupervisi. Endpoint punya **dua
  langkah**: tanpa `confirm` ia dry-run `409 confirm-required` + jumlah sesi hidup yang dihitung saat
  itu juga (jumlah itu sengaja **tidak** masuk `UpdateStatus` — grup siar `update` di-recompute tiap
  300 tick); sesi hidup **tak memblokir** apa pun di server. Premis "restart memutus sesi tmux"
  **tidak akurat**: `pty.ts` memakai `tmux new-session -d`, tmux daemon terpisah — yang putus hanya
  jembatan `tmux attach` + WebSocket, dan klien sudah reconnect ber-backoff (ADR-0016). **Install
  gagal tak fatal** (respawn versi lama + cetak alasan), **migrasi gagal fatal**, jatah
  `MAX_UPDATE_RESTARTS = 5` dengan alasan dicetak saat habis. **Dua gotcha wajib:** `prisma generate`
  dijalankan **tanpa cek dulu** karena `@prisma/client` sudah ter-cache di proses supervisor sejak
  boot (`ensurePrismaClient` akan menjawab "siap" memakai modul LAMA — kelas jebakan `existsSync` di
  ADR-0087); dan `capabilityForRoute` dulu memetakan prefix status (`update`/`limits`/`events`/`fs`/
  `health`) ke `GLOBAL_READ` **tanpa melihat method**, jadi menambah endpoint tulis di bawahnya
  berarti setiap agent token bisa me-restart instance — kini `GLOBAL_READ` hanya untuk method baca.
- Realtime: **WebSocket hanya untuk terminal PTY**; sisanya **HTTP polling** (projects, backlog, notifications, limits, vps). Jaga UI responsif — log sesi streaming, jangan blok main thread.
- Terminal server: **node-pty + tmux** (socket `-L hanoman`, `remain-on-exit on`); terminal web: **xterm.js** merender TUI Claude Code apa adanya. tmux menahan sesi hidup lintas restart API (ADR-0016).
- **Tidak ada** message queue, Redis, worker terpisah, scheduler cron, maupun webhook GitHub — semua dicabut saat pindah ke sesi interaktif (ADR-0024). Kerja latar semuanya `setInterval` in-process yang di-`start` dari `server.ts` (`app.ts` bebas-timer): monitor VPS (health 5 mnt, audit 24 jam), engine scheduler (ADR-0072), dan denyut hanoman-lead (ADR-0091).
- Server **bind `127.0.0.1:8787`** di belakang reverse proxy TLS; `HOST=0.0.0.0` hanya bila ada TLS di depan.
- `runner/src/*` adalah **library**, bukan proses: `git.ts` (worktree), `prompt.ts` (prompt + `PIPELINES` fase), `reverse-standard.ts`, `settings.ts`. Tak ada lagi invokasi `claude` headless; flow CLI lama (execute/spec/plan/qa) sudah dicabut (ADR-0024).
- **Bersihkan branch tak terpakai** (SPEC-360/ADR-0077): daftar branch ter-merge = **nilai turunan git**
  (`GET /projects/:id/branches/unused`, `git branch --merged`, base `?base=→main→master→branch aktif`,
  ref origin dibanding `origin/<base>` — jangan hardcode `"main"`). Lima kunci proteksi per-branch
  (`current`/`base`/`worktree`/`spec-open`/`session`) **ditegakkan ulang** di `POST …/branches/delete`
  (yang menurunkan ulang daftarnya sendiri), jadi klien tak bisa menyelundupkan branch lewat body;
  scope (`local`/`remote`/`both`) menyempit per branch. Eksekusi tetap lewat `runGitOp` `delete-branch`
  (SPEC-206) — satu jalur, **tanpa `-D`/force**. Kunci `session` terpisah dari `worktree` karena sesi
  lahir `--detach` (ADR-0002) sehingga tak muncul di `git worktree list`. **Tiga gotcha git terukur:**
  `git branch --merged --format` memancarkan baris `(no branch)` di worktree detached; `origin/HEAD`
  dipendekkan git jadi bare `origin` (cermin `services/branches.ts`); dan `--end-of-options` **tak
  berlaku** untuk argumen `--merged` → base wajib di-resolve ke SHA lebih dulu. Ini pagar keselamatan
  data untuk satu endpoint bulk, **bukan** guardrail eksekusi — ADR-0037 tetap utuh.
- **Stempel waktu backlog** (SPEC-408/ADR-0090): `Spec` punya `createdAt` (NOT NULL, `@default(now())`,
  **tak pernah ditulis route**) dan `startedAt` (nullable). `startedAt` ditulis di **titik cekik yang
  sama dengan `baseSha`** (`session-launch.ts`, cabang `if (!resume)`) → maknanya **mulai pertama**,
  bukan sentuhan terakhir; jalur melanjutkan (ADR-0084) sengaja tak menimpanya. `updatedAt` **bukan**
  proksi keduanya — mesin sync mem-bump `version` (`publishLocal`/`backfillFeed`) dan overlay
  stage-live menulis kemajuan tiap `GET /specs` dibaca, jadi ia bergerak tanpa ada manusia. Arah
  keputusannya **berlawanan dengan ADR-0018/0019** dan itu disengaja: aturannya bukan "selalu
  turunkan" melainkan *bisakah dihitung ulang dari sumber lain* — coverage bisa, diff bisa, waktu
  lahir sebuah baris tidak. `GET /specs` menerima `dateField=created|started` + `from`/`to`
  (`YYYY-MM-DD`, **inklusif**, boleh sendirian), disaring di layer response bersama filter lain
  (ADR-0038 utuh) lewat helper murni `services/date-range.ts`; `dateField=started` **membuang** item
  ber-`startedAt` null. **Tiga gotcha:** SQLite melarang `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` →
  migration wajib redefinisi tabel (dan klausa `SELECT`-nya satu-satunya tempat backfill dari
  `updatedAt` bisa terjadi sekali jalan); `new Date("2026-07-31")` = tengah malam **UTC** sehingga
  batas `to` polos membuang hampir seluruh hari itu di WIB → parsing komponen-per-komponen di zona
  lokal + uji-balik terhadap input (`2026-02-30` → null, bukan 2 Maret); dan kedua kolom **wajib**
  ada di `FIELDS.spec` + `DATE_FIELDS.spec` — `upsert` yang tak menyebut kolom ber-default **tetap
  berhasil**, jadi tanpa itu spec asal-hub mendapat `createdAt` lokal palsu di tiap client tanpa
  satu pun error.
- Docs SoT & coverage dipindai **live dari path efektif** tiap request (ADR-0011/0018), bukan tabel DB.
- Verifikasi doc terkini via Context7 sebelum mengubah keputusan platform/framework.

## Aturan Sesi & Eksekusi

- Mesin eksekusi nyata = **`server/src/services/pty.ts`**: `createSession()` men-spawn agen (`<prompt>` + flag agen) di window tmux; node-pty `tmux attach` menjembatani ke WebSocket, poll 500 ms mengawasi exit + perubahan phase-file lalu broadcast frame. **tmux adalah satu-satunya sumber kebenaran pekerjaan berjalan — tidak ada baris `Run` di DB.**
- **Dua agen** (SPEC-338/ADR-0074): `Agent = "claude" | "codex"`. `Setting.agent` = default global untuk SEMUA sesi yang men-spawn agen (backlog, reverse, prd, scaffold, breakdown, terminal-agen, konflik-integrasi); sesi backlog bisa override lewat `agent` di `POST /terminal/sessions`. Argv dirakit `runner/src/agent-cli.ts` (`agentFlags()`, murni & bertest), agen sesi disimpan di tmux `@hanoman_agent`. Padanan flag: `--model`→`-m`, `--effort`→`-c model_reasoning_effort`, `--dangerously-skip-permissions`→`--dangerously-bypass-approvals-and-sandbox`, `--settings`→`-c hooks.<Event>=<toml>` (+`--dangerously-bypass-hook-trust`, wajib — tanpa itu TUI mentok di "Hooks need review"). Model codex di `Setting.codex`; `HANOMAN_CODEX_BIN` cermin `HANOMAN_CLAUDE_BIN`. **Tanpa migration** (`Setting` kolom `Json`). Tiga perbedaan sadar: codex **tak punya event `Notification`** (marker keputusan pakai `Stop`+`UserPromptSubmit` → marker juga menyala saat sesi selesai wajar); codex **mendiamkan hook `type:"prompt"`** (mode goal jadi gate sh deterministik: phase file lengkap + plan tanpa `- [ ]`, exit 2 = continuation prompt), berpagar `GOAL_MAX_BLOCKS=25`. **`armGoalInTui` tak lagi khusus claude** sejak SPEC-397/ADR-0085 — lihat butir mode goal di bawah. **Gotcha wajib:** codex menolak jalan di direktori belum-dipercaya dan `-c projects."…".trust_level` TAK membukanya — `services/codex-trust.ts` menulis satu entri `[projects."<repoDir>"]` per project (worktree mewarisi trust root). Limit langganan punya DUA sumber terpisah: `services/limits.ts` (claude, panggilan API live 30 dtk) dan `services/codex-limits.ts` (codex, SNAPSHOT `rate_limits` dari rollout `$CODEX_HOME/sessions/**` — nol jaringan, nol sentuhan token; >12 jam → `stale`). Dua badge & dua grup siar (`limits` + `codexLimits`), sengaja tak digabung karena kesegarannya beda. Gotcha: label window WAJIB dari `window_minutes` (`primary` bisa 5-jam ATAU mingguan), `resets_at` codex = epoch DETIK.
- **Sesi penyelesai konflik ikut `Setting.agent`** (SPEC-377, tanpa ADR — memulihkan ADR-0074 di dua call
  site yang terlewat): rebase/merge jalan deterministik di worktree isolasi; yang **konflik** menyerahkan
  worktree itu ke sesi agen, dan sesi itu lahir dari **`sessionAgentDefaults()`**, bukan `sessionModel()`.
  `sessionModel()` **sengaja khusus claude** — ia tak pernah melihat `Setting.agent`/`Setting.codex` — jadi
  memakainya di titik kelahiran sesi berarti `createSession` jatuh ke `opts.agent ?? "claude"` dan sesi
  lahir claude ber-model default apa pun isi Settings. Terukur: `{agent:"codex", codex:{model:"gpt-5.6-terra"}}`
  tetap melahirkan `--model claude-opus-5 --effort xhigh --dangerously-skip-permissions`. Berlaku untuk
  **ketiga** pintu konflik — `POST /specs/:id/integrate` (backlog), `finishGraphOp` di `routes/ide.ts`
  (git graph merge·rebase·pull·drop, satu titik menutup keempatnya), dan `POST /terminal/sessions/:id/integrate`
  (PRD, sudah benar sejak SPEC-338). Wajib disertai **`ensureCodexTrust(repoDir)`** saat agennya codex:
  tanpa itu sesi mentok di layar trust tanpa manusia di pane. Tak ada override per-request — pilihan agen
  hidup di Settings (kartu "Agen sesi" memang sudah menjanjikan "worktree, fase, stage, review, **integrate**").
  Aturan umumnya: **setiap titik kelahiran sesi baru wajib lewat `sessionAgentDefaults()`** — kecuali tiga
  pintu konflik yang kini lewat `conflictSessionDefaults()` (di bawah); `sessionModel()` tersisa hanya untuk
  `POST /vps/:id/session` dan menunggu dipensiunkan.
- **Sesi konflik boleh punya default sendiri** (SPEC-383/ADR-0081): blok `Setting.conflict`
  `{enabled,agent,model,effort}` (kolom `Json` → **tanpa migration**, tanpa endpoint baru) dibaca
  `conflictSessionDefaults()` dan dipakai **ketiga** pintu konflik (backlog `POST /specs/:id/integrate`,
  `finishGraphOp` di `routes/ide.ts`, PRD `POST /terminal/sessions/:id/integrate`). **OPT-IN**: selama
  `enabled` mati helper itu **mendelegasikan penuh** ke `sessionAgentDefaults()` — perilaku SPEC-377 tanpa
  selisih satu argv pun. Alasan pemisahannya: menyelesaikan konflik itu sempit, tak berfase, tak berplan,
  dan sering beruntun — tak perlu effort sesi Execute. **Satu triple, bukan blok per-agen** seperti `Setting`
  akar: menukar `agent` menukar model/effort sekalian (cermin `pickAgent` di `StartSessionModal`), effort
  codex dikoersi `coerceCodexEffort` di helper. **Gotcha wajib:** `ensureCodexTrust` HARUS diturunkan dari
  agen **hasil helper**, bukan `Setting.agent` — dengan blok ini keduanya bisa berbeda, dan membaca yang
  salah mengulang bug SPEC-377 (sesi codex mentok di layar trust) dalam bentuk baru. Tetap **tak ada**
  override per-request; pilihan hidup di Settings. UI: kartu "Konflik rebase & merge" di tab Model sesi;
  saat mati kartunya **menampilkan nilai warisan** supaya tak ada pertanyaan "lalu konflik pakai apa".
  Tab itu sekalian ditata ulang **bersumbu agen** (dua blok berjudul "Claude Code"/"Codex CLI" + badge
  `dipakai sesi baru`): sebelumnya blok claude cuma berbunyi "Model"/"Effort" — nama agennya hanya di
  `aria-label` — sementara judul "default global" tetap terpampang meski agen aktifnya codex. Katalog claude
  di Settings kini dibaca dari `MODELS`/`EFFORTS` (`@hanoman/shared`), sumber yang sama dengan picker Start.
- **Katalog codex per model** (SPEC-339): effort adalah properti MODEL, bukan properti CLI. `CODEX_MODELS` (shared) membawa `efforts`/`fallback`/`minClient` per entri; `CODEX_EFFORTS` tinggal gabungan, **bukan** sumber pilihan UI — picker WAJIB `codexEfforts(model)`. Isi katalog: `gpt-5.6-sol` (default global) & `gpt-5.6-terra` = ultra/max/xhigh/high/medium/low, `gpt-5.6-luna` = **tanpa ultra**, `gpt-5.5` = tanpa max & ultra. Koersi effort dilakukan di **`createSession`** (titik cekik tunggal — jalur ber-`AgentToken` pun lewat sana), dan model pensiun (`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`) diremap ke `gpt-5.5` saat `getSetting()` membaca; sengaja bukan ke 5.6 agar setelan lama tak pindah ke model yang CLI-nya belum sanggup. **Gotcha wajib:** trio 5.6 butuh codex CLI **≥ 0.144.0** dan manifest model disaring server **berdasarkan versi klien** (cache `~/.codex/models_cache.json`) — CLI lama tak akan pernah melihat model itu, dan `max` bahkan belum ada di enum effort 0.142.5. `GET /api/codex/version` memberi catatan lunak di Settings & picker Start, **tanpa** memblokir Start. Rujukan otoritatif katalog = `codex debug models`, bukan ingatan.
- **Riwayat sesi** (SPEC-362/ADR-0079): tmux tetap sumber kebenaran sesi **hidup**, tapi setiap sesi kini
  meninggalkan baris `SessionHistory` (LOCAL-only, tak disync) yang **lahir bersama sesinya** (sesi berjalan
  pun tercatat, `endedAt: null`) dan ditutup saat `killSession`. `pty.ts` tetap **nol dependensi DB** — ia
  hanya menembakkan `registerSessionHooks({onBirth,onDeath})` dari **dua titik cekik**
  `createSession`/`killSession`; jangan menambahkan pencatatan di call site (ada 12, dan flow baru akan
  menambah lagi). `onBirth` **tak** menembak saat re-attach. Transkrip di-`capture-pane` **tanpa `-e`**
  SEBELUM pane dibunuh (sesudah itu scrollback lenyap), disimpan sebagai berkas di `HANOMAN_TRANSCRIPT_DIR`
  (`services/transcript-store.ts`) dengan cap 1 MiB **menyimpan ekor**; DB hanya pointer. **PK baris = uuid,
  BUKAN `sessionId`**: id sesi spec deterministik dan berulang tiap reopen — PK `sessionId` akan menimpa
  riwayat lama. `GET/DELETE /api/terminal/history*` sengaja di bawah prefix `/terminal` agar mewarisi
  capability `sessions`; `skip`/`take` DB sah di sana (tak ada overlay live seperti `GET /specs`, ADR-0038).
  UI = modal di Terminal (grid tak berubah ukuran) + "Mulai lagi" ber-`restartableKind`.
- **Penghapusan worktree saat sesi ditutup digerbangi `ownsWorktree`** (`services/session-worktree.ts`,
  SPEC-362): `DELETE /terminal/sessions/:id` hanya memanggil `realGit.removeWorktree` bila cwd sesi
  benar-benar berada DI DALAM `<repoDir>/.worktrees/`. Jangan pernah memutuskannya dari substring
  `"/.worktrees/"` pada cwd — itu menguji **bentuk path**, bukan **hubungan cwd↔repoDir**, dan begitu
  sebuah project di-bind ke checkout di bawah `.worktrees/` (persis saat hanoman didogfood di
  worktree-nya sendiri) terminal biasa ber-`cwd === repoDir` ikut lolos dan checkout project itu
  sendiri terhapus. `realGit.removeWorktree` juga **melempar** bila diminta menghapus repo itu sendiri:
  `git worktree remove` di dalamnya gagal-diam (`tryGit`), jadi `rmSync` terakhir tetap jalan meski
  git menolak.
- **`pkill -f` satu sesi membunuh agen sesi LAIN** (SPEC-402, tanpa ADR — QA): prompt sesi
  diserahkan sebagai **argumen positional** agen (`claude "$(cat <promptfile>)"`, SPEC-223 — dan itu
  tak bisa dihindari: `claude`/`codex` tak punya opsi prompt-dari-berkas, stdin dipakai TUI), jadi
  **seluruh prompt hidup di ARGV** proses agen. Karena klausa scope verifikasi (ADR-0080) memuat
  `vitest` (5×), `tsc`, `node server/dist/server.js`, setiap sesi ber-`verifyScope=changed` **cocok**
  dengan `pkill -f vitest` / `pkill -f tsc`. BSD `pkill` **mengecualikan leluhurnya sendiri**
  (`man pkill`: "-a … by default the current pgrep or pkill process and all of its ancestors are
  excluded"), jadi pola itu berperilaku sebagai "bunuh semua sesi lain, sisakan sesi saya" — dan
  itulah "intermitten"-nya: yang mati selalu sesi tetangga. Terukur 29 Jul: `pkill -f "tsc" ;
  pkill -f "vitest"` di sesi `spec-389` pukul 15:36:04.4Z → pane `spec-319` & `spec-390` mati
  **status 143** pukul 15:36:08 & 15:36:10, sementara `spec-389` sendiri selamat. Mitigasinya
  **klausa kontrak** di `runner/src/verify-scope.ts` (bunuh per-PID/port, atau sempitkan pola ke path
  worktree sendiri), bukan hook deny — ADR-0037 tetap utuh.
- **Pane mati ≠ pekerjaan selesai** (SPEC-402): `SessionInfo.exitCode` (`#{pane_dead_status}`, hanya
  saat `exited`) mengalir ke `SessionDTO`/klien, dan pane berkode ≠ 0 diberi pil **"Gagal · exit
  <n>"** (`--status-err-tint`), bukan pil hijau "Selesai". `markExited` **menyimpan** kode dari frame
  `exit` (dulu dibuang), jadi sesi yang mati di depan mata operator langsung terbaca gagal; nilai
  yang sama datang lagi dari daftar sesi sehingga labelnya selamat dari refresh. Sesudah itu tombol
  "Lanjutkan" (ADR-0084) baru punya makna — sebelumnya sesi terputus tampak tuntas.
- **Pekerjaan selesai ≠ pane mati** (SPEC-433, tanpa ADR — QA; belahan KEDUA dari konflasi di atas):
  sel Terminal dulu menggerbangi SELURUH statusnya pada `session.exited` (⇐ `#{pane_dead}`),
  padahal agen adalah **TUI interaktif** — sesudah menulis baris fase terakhir + push ia kembali ke
  prompt-nya dan pane hidup terus sampai operator menekan Tutup. Jadi pada jalur sukses `pane_dead`
  **tak pernah** jadi `1` dan pil hijau "Selesai" **secara struktural tak bisa muncul**; satu-satunya
  yang pernah menampilkannya adalah sesi yang mati exit 0 (di-`/exit` manual). Terukur 31 Jul dari
  keadaan hidup: `spec-431`/`spec-432` berkas fasenya lengkap (`Audit done`/`Spec skipped`/`Plan
  skipped`/`Execute done`), commit-nya mendarat, `Spec.stage = done` di DB — tapi `dead=0` dan
  `capture-pane` menunjukkan TUI menganggur di `❯`. Server sudah tahu jawabannya (`stageForRun`,
  dipakai `liveSpecs`); yang menyeberang ke Terminal hanya **daftar nama fase** yang dirender
  `PhaseStrip`, tanpa verdict. Fix: **`sessionComplete(phases, worktree, specId?)`** =
  `phasesComplete` (semua fase `done`|`skipped`, daftar kosong → **false**) **DAN** `planComplete`
  untuk sesi ber-spec, ikut frame WS yang sudah mengalir → `{t:"phase", phases, complete}`, dikirim
  dari **dua** titik (`pollPhases` + `attach`, jadi pil selamat dari refresh/pindah sel). Sengaja
  **bukan** `stageForRun(...) === "done"`: peta `REACHED` berkunci nama fase dan tak mengenal fase
  flow dokumen (`PRD`, `Serah terima`, `Breakdown`) — sesi itu akan selamanya terbaca belum selesai.
  **Tiga jebakan mengikat:** (1) kunci dedup `pollPhases`/`attach` **wajib memuat `complete`** —
  ia berubah tanpa satu baris fase pun berubah saat kotak `- [ ]` terakhir dicentang, dan dedup
  berkunci `phases` saja menelan frame itu (bentuk yang sama dengan dedup lengket `events.ts`
  SPEC-402); (2) gerbang plan ADR-0029 **wajib** ikut — tanpa itu "tak pernah hijau" cuma bertukar
  jadi **"hijau palsu"**; (3) `complete` **menang atas `awaiting`** (SPEC-196) karena marker
  keputusan **codex menyala saat sesi selesai wajar** (tak ada event `Notification` → dipasang di
  `Stop`+`UserPromptSubmit`, ADR-0074) — membiarkan `awaiting` menang mengulang bug ini untuk
  separuh agen. Urutan pil: `exited` → `complete` → `awaiting`. Badan pane **tidak** diredupkan saat
  `complete` (prosesnya masih hidup & bisa diketik); peredupan tetap milik `exited` (SPEC-188).
  `exited` sendiri **tak disentuh** — ia tetap menggerbangi re-attach (ADR-0084), "Lanjutkan",
  `startable`, `liveDecisions`, dan penutupan `SessionHistory`, yang memang bertanya soal proses.
- **Kegagalan `tmux` BUKAN "tak ada sesi"** (SPEC-402): `listPanes()` mengembalikan `[]` hanya untuk
  `no server running`/`error connecting to` (`TmuxError.noServer`); kegagalan lain **dilempar**.
  Dulu `catch { return []; }` menelan semuanya, dan loop poll 500 ms membacanya sebagai "semua sesi
  dibunuh dari luar" → `end(id, 0)` = **"— sesi berakhir (exit 0) —"** untuk SETIAP terminal yang
  terbuka, pada agen yang masih bekerja. Dua pemberat: dedup siaran `services/events.ts` tak pernah
  mengirim ulang kebenaran (`exited:false`) sehingga pil palsu itu **lengket**, dan `getSession()`
  yang bersumber sama menggerbangi kelahiran sesi — `undefined` palsu membuat `startSpecSession`
  memanggil `realGit.addWorktree` yang merebut path dengan `remove --force` + `rmSync` **atas
  worktree sesi yang sedang berjalan**. Loop poll melewatkan tick yang gagal, `events.ts` melewatkan
  siaran grup (mekanisme lama), `server.ts` melewatkan `reconcileHistory` (daftar kosong palsu akan
  menutup baris riwayat sesi yang masih hidup). Satu pengecualian sadar: `sessionPhasesBySpec()`
  tetap **lunak** (peta kosong) karena overlay stage forward-only.
- **Satu backlog = satu sesi** (ADR-0015): id sesi diturunkan deterministik dari id spec — menekan Start dua kali = **re-attach**, bukan spawn kedua.
- **Sesi backlog DILANJUTKAN, bukan diulang** (SPEC-394/ADR-0084, memulihkan substansi ADR-0017 yang
  ikut tercabut bersama ADR-0024 atas premis "sesi tmux tak pernah terputus" — benar untuk restart
  API, **salah** untuk mesin restart / agen keluar / operator menutup sesi): `startSpecSession` punya
  **tiga** keadaan, bukan dua. **live** = pane tmux hidup → re-attach. **resume** = `stage ≠ done` +
  `baseSha` ada + artefak masih ada → lanjutkan (`201 { id, resumed: true }`). **fresh** = selain itu.
  **Pane MATI bukan sesi** — `remain-on-exit on` menahannya hanya agar layar terakhirnya terbaca, dan
  mengembalikannya sebagai sesi membuat tombol "Lanjutkan" **diam** (UI sudah menghitung `!exited`,
  jadi tombol itu muncul persis saat pane mati); ia dibunuh dulu (menutup `SessionHistory` + simpan
  transkrip, ADR-0079) lalu sesi dilahirkan ulang. Dua bentuk resume: worktree `.worktrees/<id>` yang
  masih sah dipakai **apa adanya** — satu-satunya jalur yang TIDAK memanggil `addWorktree`, karena
  helper itu selalu merebut path dengan `remove --force` + `rmSync` — atau, bila worktree hilang,
  dibangun ulang `--detach` di tip **`origin/hanoman/<id>` → `hanoman/<id>` → `Spec.headSha`**.
  Urutan itu mengikat: `origin/…` adalah ref yang `git push` di akhir sesi harus fast-forward, dan
  worktree yang lahir dari `branchFrom` membuat push itu **ditolak non-fast-forward** (terukur —
  sesi ulangan bahkan tak bisa menyimpan hasil ulangannya). `baseSha` & `headSha` **tak pernah
  ditulis ulang saat resume** (rentang review ADR-0030 tetap dari basis asli); `baseSha` null =
  belum pernah punya worktree = bukan resume. Prompt-nya `resumePrompt` yang menyebut baris fase
  yang sudah tercatat + fase berikutnya + bentuk worktree-nya, dan **tak mengulang** klausa keputusan
  pasca-Audit (ADR-0040) begitu `Audit` tercatat — keputusannya sudah mewujud sebagai baris fase.
  Server **tak pernah menulis** ke `$HANOMAN_PHASE_FILE` (tetap milik agen, append-only). Ia hidup
  di luar worktree, jadi ia **selamat** dari penghapusan worktree — itulah kenapa server bisa
  menyebutkannya dan agen tidak bisa menurunkannya sendiri. `stage = done` tetap jalur SPEC-172
  (`continuePrompt`, worktree dari `branchFrom`) — kerjanya umumnya sudah ter-merge. `worktreeAlive`
  bertanya ke **git** (`rev-parse --is-inside-work-tree` + toplevel = path itu sendiri), bukan
  `existsSync`: direktori telanjang di dalam repo pun "ada". Berlaku juga untuk governor scheduler
  (jalur peluncuran sama).
- **Gerbang pane-mati hidup di titik cekik `createSession`** (SPEC-394/ADR-0084), bukan hanya di
  `startSpecSession` — jadi ia menutup sekaligus jalur yang **tak punya gerbang sendiri**: sesi
  konflik `merge-<spec>` (`routes/specs.ts`) & `finishGraphOp` (`routes/ide.ts`), dan konsol VPS
  `vpsc-<id>` (`routes/vps.ts`). Keempat route **project-level** (reverse · scaffold · prd ·
  breakdown) punya gerbang `getSession` sendiri di depan `createSession`, jadi
  masing-masing ikut disempitkan ke `!exited`. **`attach()` pada pane mati TETAP sah** — itu justru
  cara membaca layar terakhir sesi yang sudah selesai; jangan ikut dipagari. **Pasangan wajib untuk
  flow project-level:** kelimanya memanggil `realGit.addWorktree` **setelah** gerbangnya, jadi
  memperbaiki gerbangnya SENDIRIAN menukar gejala "tombol diam" (tak merusak apa pun) dengan
  **kehilangan dokumen yang belum di-commit** — regresi yang lebih buruk daripada bugnya. Helper
  `ensureWorktree()` di `routes/terminal.ts` melewati `addWorktree` bila `worktreeAlive(wt)`, dan
  prompt-nya diberi satu kalimat `RESUMED_WORKTREE_NOTE`. Flow dokumen sengaja **tidak** memakai
  `resumePrompt`: deliverable-nya dokumen, dan fasenya tak punya artefak berkotak seperti `- [ ]`
  di plan. Konsekuensi yang diterima sadar: "mulai benar-benar dari nol" untuk flow dokumen kini
  menuntut operator menutup sesinya dulu (Tutup memang menghapus worktree, SPEC-362).
- Sesi berjalan di worktree sendiri di `<repoDir>/.worktrees/<id>`, dibuat `--detach` dari `branchFrom` (default `main`); `baseSha` dicatat untuk rentang review (ADR-0030). Jenis sesi: **spec-flow** (feature/qa/audit), **reverse** (project-level), **prd**, **plain terminal** (claude di repoDir; atau shell mentah non-claude via `{shell:true}`, SPEC-236/ADR-0056), **integrate-conflict** (merge-<id>), **vps**. Flow **audit** (SPEC-237/ADR-0057) = audit-only: pipeline `Audit → Laporan`, hanya dokumen SoT (`research/audit-<id>-<slug>.md`), tanpa Execute; bisa dinaikkan jadi Finding QA.
- **Fase bukan proses melainkan giliran** dalam satu sesi: `runner/src/prompt.ts` `PIPELINES` mendefinisikan nama fase per flow; prompt menyuruh agen `echo "<Fase> done" >> $HANOMAN_PHASE_FILE`. Server membaca file append-only itu (`services/session-phases.ts`) untuk menurunkan fase aktif → `Stage`. Konteks terbawa antar fase karena semuanya satu sesi.
- **Kontrak otonomi** (ADR-0035): agen menembus batas antar-fase tanpa berhenti — checkpoint "review" milik skill superpowers **bukan** titik berhenti — dan hanya berhenti untuk bertanya di terminal saat butuh keputusan manusia sejati. Waspada: subagent async bisa bikin agen `end_turn` dan runner mengira fase selesai (fase jadi dangkal).
- **Eskalasi audit dinamis** (SPEC-340/ADR-0076, memperluas ADR-0057): audit punya
  **tiga** pintu tindak lanjut — Finding QA · Feature brief · PRD — bukan lagi hanya QA. Rekomendasi
  hanoman **terbaca mesin**: fase Laporan menulis satu blok ```json kanonik
  `{escalation:{target:"none|qa|brief|prd",reason,alternatives,prefill}}` di dokumen audit (pola
  manifest breakdown ADR-0069), di-parse `services/audit-escalation.ts` (defensif — rusak/absen →
  `null`) dan disajikan `GET /api/specs/:id/escalation` sebagai **nilai turunan** freshest-wins
  (ADR-0018) — **tak ada kolom DB, tanpa migration**. UI menyorot target rekomendasi (primary +
  badge) tapi ketiga tombol selalu tersedia: manusia terakhir yang memutuskan. Kontinuitas: brief
  lanjutan audit memakai `payload.fromAudit` (kini juga diterima `zBriefPayload`) + `branchFrom`
  `hanoman/<audit-id>`, tapi **TIDAK** melewati fase mana pun — beda sadar dari qa (ADR-0059), karena
  dokumen audit memuat temuan, bukan bentuk solusi. Sesi PRD menerima `branchFrom` **dan** `fromAudit`
  di `POST /terminal/sessions` (worktree lahir dari branch audit + isi dokumen audit disematkan ke
  `startPrdPrompt`); tanpa keduanya perilaku PRD lama utuh.
- **Model & effort per SESI** (SPEC-252/ADR-0061, mengamandemen ADR-0058): dipilih saat **Start** backlog lewat picker `StartSessionModal` (default = setelan global `model`/`effort`, `claude-opus-5` / `xhigh`), dikirim sebagai body opsional `model`/`effort` di `POST /terminal/sessions`, jadi argv `--model`/`--effort` saat sesi lahir → **andal penuh** (tak bergantung agen). Sesi tetap **satu proses, satu model seumur hidup**. Matrix per-fase lama (`phaseModels`, ADR-0058) **dicabut**: tak andal karena bergantung agen mengetik `/model`+`/effort` di batas fase, padahal agen menembus batas fase tanpa berhenti. Manusia tetap bisa `/model` manual di terminal. `steps` headless (ADR-0003) tetap usang.
- **Mode goal per sesi backlog** (SPEC-332/ADR-0073): sesi bisa lahir membawa gate `Stop` — `guardSettings` menyisipkan `hooks.Stop=[{type:"prompt",prompt:<kondisi>}]` ke `--settings` (mesin yang sama dipasang `/goal` Claude Code, tapi deterministik saat sesi lahir), plus keystroke `/goal` best-effort ke pane untuk visibilitas TUI. Kondisi default = DoD hanoman (semua fase tercatat di phase file, plan tak menyisakan `- [ ]`, push sukses) dan menuntut **bukti segar** karena evaluator hook `prompt` tak punya tool dan hanya membaca transkrip (yang bisa terpotong). Knob `Setting.goal` (default mati) + override `goal`/`goalCondition` saat Start; sesi scheduler mengikuti default global. **Bukan** guardrail deny — ADR-0037 tetap berlaku; interrupt manusia (`Esc`) bukan event Stop, jadi kendali tetap ada.
- **Mode goal codex memakai goal NATIVE codex** (SPEC-397/ADR-0085, mengamandemen ADR-0074 butir (b)):
  `armGoalInTui` **tak lagi khusus claude** — codex-cli **0.146.0** punya mode goal native
  (`codex features list` → `goals stable true`; `thread_goals` di `$CODEX_HOME/goals_1.sqlite`;
  status line `Pursuing goal` · `Goal achieved` · `Goal unmet`) dan codex **melanjutkan sendiri
  sesudah turn berakhir** sampai objektif tercapai. Premis ADR-0074 ("tak ada padanan terverifikasi")
  benar di 0.142.5, salah di 0.146.0. Gate sh **tetap terpasang** (masih menembak di 0.146): ia
  satu-satunya yang benar-benar **membaca** berkas fase & kotak `- [ ]` (cermin ADR-0029), sementara
  goal native menilai dengan prosa — jadi kondisi prosa bebas kini benar-benar dievaluasi di codex,
  batasan ADR-0074 itu dicabut. Harga yang diterima sadar: satu percobaan berhenti dievaluasi **dua
  kali**, keduanya berpagar (`GOAL_MAX_BLOCKS=25` / akunting budget codex). **Gotcha wajib:** TUI
  codex mengubah masukan yang datang dalam **satu burst ≥ 1024 karakter** jadi
  `[Pasted Content N chars]`, dan begitu itu terjadi slash-dispatch **tak jalan** — `/goal` terkirim
  sebagai **pesan chat biasa tanpa error, tanpa goal**. Deteksinya **per-burst PTY, bukan
  per-invokasi `send-keys`** (terukur: 4×500 char TANPA jeda → `[Pasted Content 1500 chars]`), jadi
  memotong keystroke tanpa jeda tak menyelesaikan apa pun → `goalChunks()` (runner, murni) mengirim
  potongan **500** ber-jeda 50 ms, dipakai **kedua** agen karena jebakan yang sama laten di claude
  (`GOAL_MAX` mengizinkan 4000 karakter). **Jebakan test:** verifikasi lama
  `paneText.includes("/goal")` **lulus palsu** persis untuk degradasi paste itu — pane memang memuat
  `/goal …`, sebagai pesan chat — jadi codex diverifikasi lewat penanda runtime goal-nya sendiri dan
  arming yang gagal boleh dikirim ulang (maks 3); verifikasi claude sengaja **tak disentuh**.
  Tanpa skema/migration/endpoint/knob baru.
- **Backlog goal — sesi dua fase tanpa perencanaan** (SPEC-407/ADR-0089, memperluas ADR-0073):
  source **`goal`** → flow **`goal`** = `PIPELINES.goal = ["Goal", "Verifikasi"]`. Sampai spec ini
  mode goal cuma **knob di atas pipeline `feature`**, jadi sesi "goal" tetap menulis design doc +
  plan berkotak sebelum menyentuh pekerjaannya. Kini prompt-nya builder terpisah
  **`startGoalPrompt`** (mengeja `Goal` / `Selesai bila` / `Batasan` dari payload; tanpa instruksi
  fase perencanaan, tanpa keputusan pasca-Audit, tanpa skill Brainstorm/Plan — fase `Goal` sengaja
  **tanpa skill**, hanya `Verifikasi` → `verification-before-completion`). Stage: `Goal` **aktif
  maupun tercatat** → `executing`, `Verifikasi` → `done` (nama fase wajib unik lintas `PIPELINES`
  — `REACHED` berkunci nama). Payload **bentuk ketiga** `zGoalPayload {goal, done, constraints,
  priority}`; `superRefine` `zCreateSpec` kini **tiga-arah** (`qa` ↔ `severity`, `goal` ↔ `goal`,
  selain itu brief) dan `Spec.objective` diturunkan dari `payload.goal`. **Mode goal dipaksa
  menyala** untuk flow ini (`opts.goal:false` diabaikan) dan **template global
  `Setting.goal.condition` DILEWATI** — ia generik untuk semua sesi sedangkan item goal membawa
  kondisinya sendiri; override per-sesi tetap paling tinggi. **Dua gotcha wajib:** (1) gerbang
  klausa scope verifikasi pindah dari "pipeline punya fase `Execute`" ke predikat
  **`writesCode(flow)`** — sesi goal menulis kode meski tanpa fase `Execute`, dan melewatkannya
  membuatnya jatuh ke DoD repo target alias suite penuh (lubang yang ditutup ADR-0080); (2)
  `resumeClause` hanya menyebut plan `docs/superpowers/plans/**` untuk pipeline ber-fase `Plan` —
  menyuruh sesi goal mencari plan justru mengundangnya membuat satu. Dua pintu masuk: tab **Goal**
  di modal backlog baru, dan tombol **"Take ke backlog"** di preview PRD yang kini **pemilih**
  (brief / goal, keduanya ber-`branchFrom = prd/<slug>`). Tanpa migration, tanpa endpoint baru;
  ADR-0029 (gerbang plan) & ADR-0037 tetap utuh.
- **hanoman-lead — agen pemimpin di atas agen** (SPEC-409/ADR-0091, **mengamandemen ADR-0035**):
  mekanisme "sesi menunggu keputusan" sudah lengkap sejak SPEC-184/196; yang tak pernah ada adalah
  **yang menjawabnya selain manusia**. Lead adalah **agen** yang dipanggil sekali-jalan non-interaktif
  (`claude -p`/`codex exec`, `services/lead/brain.ts`) dengan keluaran satu blok ```json — **bukan**
  menghidupkan run headless ADR-0024 (yang dicabut itu MENGERJAKAN pekerjaan bertahap; lead cuma
  penasihat berumur pendek yang tak menyentuh worktree sesi manapun). **Tiga pintu, satu otak**
  (`services/lead/decide.ts`, urutan wajib bukti → putusan → saring rujukan → gerbang tindakan →
  **TULIS JEJAK** → notifikasi): kontrak eksplisit `POST /api/lead/decisions` (agen internal &
  eksternal ber-`AgentToken`, capability domain **`lead`** dipetakan MENURUT METHOD — kelas bug
  SPEC-405), deteksi otomatis (baca pane ber-marker → ketik jawabannya lewat `pty.sendToPane`), dan
  denyut proaktif `setInterval` in-process (urutan kerja diserahkan ke antrean+governor ADR-0072,
  bukan antrean kedua; tabrakan area kerja dari diff worktree; tindak lanjut sesi ber-`exitCode ≠ 0`
  atau plan bersisa `- [ ]`). **Batas kerasnya di permukaan tindakan LEAD** (`LEAD_ACTIONS` =
  allowlist tertutup, konstanta modul **bukan konfigurasi**), ditegakkan **di server** — **ADR-0037
  tetap utuh**, sesi pekerja tak diberi hook deny apa pun. Konsekuensi mengikat: **"ulangi dari nol"
  mustahil bagi lead** (butuh menghapus worktree = terkunci), dan `stop-session` memanggil
  `killSession()` LANGSUNG — bukan `DELETE /terminal/sessions/:id` yang memang menghapus worktree
  (SPEC-362). Jejaknya model **`LeadDecision`** (migration tulis tangan, LOCAL-only, ikut `PG_ORDER`;
  `trail.ts` sengaja **tak punya fungsi hapus**) + `Setting.lead` (kolom `Json` → tanpa migration) +
  `Project.leadOptIn` (cermin `schedulerOptIn`). Jejak & status lewat **HTTP polling** — tanpa kanal
  WS baru (ADR-0039 utuh). **Semua default MATI.** **Enam gotcha:** penghitung jawaban otomatis TAK
  BOLEH di-reset saat marker kosong (marker memang kosong sesaat sesudah lead mengetik — hook
  `UserPromptSubmit` menjalankan `: >` — jadi reset di sana membuat pagar AC-11 tak pernah tercapai);
  idempotensi denyut lewat **jejak** bukan `Set` memori (pane mati bertahan berhari-hari, `Set`
  kosong justru sesudah restart); `zLeadVerdict.action` sengaja `string` bukan enum supaya "deploy"
  bisa MASUK lalu ditolak-dan-dicatat, bukan lenyap sebagai keluaran rusak; jawaban ke pane dipotong
  `goalChunks` (burst ≥1024 char → `[Pasted Content]` SENYAP, ADR-0085); rujukan disaring terhadap
  repo (path absolut & `..` ditolak); dan marker sesi **codex** menyala juga saat selesai wajar
  (ADR-0074) → `services/lead/pane.ts` bias ke DIAM.
- **Backlog yang SELESAI juga butuh diputuskan — pintu keberhasilan** (SPEC-451, tanpa ADR — QA;
  ADR-0091 **ditegakkan**, ADR-0037 & ADR-0072 utuh): denyut lead punya pintu untuk kegagalan
  (`followUpFinished`: exit ≠ 0 atau plan bersisa `- [ ]`) dan **tak punya pintu untuk
  keberhasilan**. Gerbangnya `s.exited`, dan SPEC-433 sudah membuktikan pane sesi sukses **tak
  pernah mati** — jadi keberhasilan bukan keadaan yang jarang diputuskan melainkan yang **secara
  struktural tak bisa** diputuskan; gerbang kedua (`!bad && !unfinished → continue`) membuangnya
  sekali lagi. Akibatnya `integrate-main` & `stop-session` — dua tindakan yang **sudah lengkap** di
  `apply.ts` sejak ADR-0091, berikut gerbang bukti objektif `requireGreenBeforeIntegrate` — tak
  pernah ditawarkan **satu pun dari lima call site `decide()`**: mesin tanpa pengemudi. Harganya
  slot governor: `liveCount()` (`scheduler/engine.ts`) menghitung **pane hidup**, jadi
  `maxConcurrent` sesi tuntas mengunci antrean selamanya — `reconcile` menutup baris antreannya
  dengan benar tapi ia tak membaca tmux. Terukur dari keadaan hidup 2026-08-01: SPEC-450
  `stage=done`, fase 5/5, plan **0** kotak, pane `dead=0` di `❯` — **4 jam 24 menit** memegang satu
  dari 6 slot, nol keputusan, **32 baris antrean `queued`**. Fix: **`sessionFinished(id)`** diekspor
  `pty.ts` sebagai **satu** definisi bersama frame `phase` (`paneComplete`) — menyalinnya adalah
  kelas bug SPEC-431/448 — dan **tidak** dijadikan field `SessionInfo` (governor memanggil
  `listSessions()` tiap 10 dtk; verdict itu akan membayar `readdir`+`readFile` sepanjang hidup tiap
  sesi, bukan di ekornya); pintu keempat **`followUpComplete`** digerbangi **`finished`, BUKAN
  `exited`**, **saling eksklusif** dengan pintu kegagalan secara konstruksi (`finished` ⇒
  `planComplete` ⇒ `!unfinished`, plus tolak `exitCode ≠ 0`) sehingga tak ada sesi yang membeli dua
  giliran agen untuk satu keadaan, dengan awalan idempotensi sendiri (`Backlog … sudah selesai di
  sesi …`, **bukan** `kind` — SPEC-432) dan **tanpa** gerbang `Setting.scheduler` (beda dari
  `orderReadyWork`: mengintegrasikan hasil yang sudah selesai berharga walau antrean tak dikuras);
  dan `integrateMain` **melepas panenya** pada hasil `clean` lewat `killSession` LANGSUNG (worktree
  utuh, AC-32a → rentang review ADR-0030 & tombol "Lanjutkan" ADR-0084 selamat), digerbangi
  **`planDone`, bukan `requireGreenBeforeIntegrate`** — knob itu menjawab "boleh diintegrasikan?",
  gerbang ini "boleh panenya dilepas?". **Dua penolakan sadar:** `rebase` tak ditambahkan ke
  `LEAD_ACTIONS` (allowlist itu konstanta, AC-31; merge yang paling mudah dibatalkan — persis
  kriteria yang diperintahkan prompt lead sendiri), dan **`liveCount()` tak disentuh** — menyaring
  pane selesai dari cap menukar antrean mandek dengan **pane menumpuk tanpa batas** dan menutup
  terminal tanpa keputusan siapa pun; yang benar adalah menutup panenya. Konsekuensi: selama
  `Setting.lead.enabled` mati (default) perilakunya **tak berubah** — operator yang menutup sesinya.
- **`services/lead/brain.ts` adalah titik spawn agen KEDUA — satu-satunya di luar `pty.ts`**
  (SPEC-448, tanpa ADR — QA; ADR-0091 ditegakkan, ADR-0037 utuh). Konsekuensinya mengikat: **setiap
  pelajaran spawn yang sudah dibayar di `pty.ts` harus dibayar ulang di sini**, dan sampai spec ini
  tak ada satu pun test yang menjalankannya (`lead-decide.test.ts` menyuntik `think` sebagai stub).
  Dua kegagalan lahir di celah itu, keduanya membuat lead **tak pernah** memutuskan. **(A) `execFile`
  tak pernah menutup stdin anak** — Node **tak meneruskan opsi `stdio`** untuk `execFile` (hanya
  `cwd`/`env`/`uid`/`shell`/`signal` yang sampai ke `spawn`), jadi pipa selalu lahir dan menyetel
  `stdio:["ignore",…]` di sana diam-diam tak berefek; satu-satunya jalan `child.stdin?.end()` lewat
  handle yang dikembalikan. `claude -p` membaca stdin sebagai sumber prompt alternatif dan menunggu
  **3 detik penuh**. Terukur (claude 2.1.220, prompt & anggaran 6 dtk sama, satu variabel): pipa
  terbuka → 6551 ms **dibunuh, stdout KOSONG**; ditutup → 3554 ms **jawaban benar**. Peringatannya
  mendarat di **stderr** — sumber yang sama yang dipakai `think()` menyusun pesan galat — sehingga
  sebab sebenarnya terdorong ke baris kedua dan gejalanya terbaca salah. Prompt lead memang lewat
  **argv** (`leadArgv`), bukan stdin, sama seperti sesi pekerja (SPEC-223). **(B) gerbang root claude
  tak menyeberang**: `rootBypassEnv` (`IS_SANDBOX=1`, SPEC-403) hidup di `pty.ts` saja — kedua commit
  lahir di worktree paralel di hari yang sama (`e5c73ac` **bukan** leluhur `a16465e`) — dan `brain.ts`
  men-spawn tanpa opsi `env` sama sekali. Claude `exit(1)` **sebelum satu token diproses**
  (`getuid()===0 && IS_SANDBOX!=="1" && !CLAUDE_CODE_BUBBLEWRAP`); tiga default resmi menjamin ini
  kena 100% di produksi — `deploy-vps.md` `User=root`, agen default `claude`, dan sesi pekerja
  **selamat** lewat `pty.ts` sehingga tak ada gejala lain yang menunjuk ke root. `leadEnv()`
  **mengimpor** `rootBypassEnv`, tak menyalinnya: dua definisi yang tak sepakat justru penyebabnya.
  Hanya untuk **claude** — codex 0.146.0 tak punya gerbang root maupun rujukan `IS_SANDBOX`. **Jebakan
  fixture:** `fake-claude.sh` diakhiri `exec cat` karena ia mensimulasikan TUI di pane; memakainya
  untuk agen one-shot membuat tiap test `think()` selalu "kehabisan waktu" — hijau & merah tak
  terbedakan. Agen lead butuh fixture yang **keluar sendiri** (`fake-lead-agent.sh`).
- **Menjawab dialog `AskUserQuestion` bukan mengetik prosa** (SPEC-452, tanpa ADR — QA; ADR-0091
  ditegakkan, ADR-0037 utuh): `sendToPane` selama ini mengasumsikan pane **selalu** kolom teks.
  Untuk dialog pilihan claude asumsi itu salah — layarnya **widget daftar** Ink, dan handler-nya
  membandingkan `input` **UTUH** dengan nomor baris, jadi burst apa pun yang lebih dari **satu
  karakter** ditelan tanpa jejak dan `Enter` memilih baris yang sedang **disorot** (baris 1).
  Akibatnya keputusan lead **tak pernah menyeberang**: yang terpilih selalu opsi pertama, apa pun
  isinya. Terukur pada claude 2.1.220: prosa 55 karakter → layar tak berubah, `Enter` → baris 1;
  jawaban yang eksplisit menyebut nomornya (`"Pilih opsi 2 (Node 22) karena …"`) tetap memilih
  **Node 20** — kebalikannya, dan jejaknya tetap berstatus `berlaku`. `goalChunks` (ADR-0085)
  **tak menolong**: potongan 500 karakter tetap bukan satu karakter — `send-keys -l "2"` telanjang
  memilih **seketika** (tanpa `Enter`), menempel pada teks lain nol efek. **Deteksinya tak pernah
  rusak**: dialog memancarkan `Notification` `notification_type: permission_prompt` lewat pengait
  idle 6 dtk dan marker SPEC-184 terisi. Jalan keluarnya milik claude sendiri: setiap
  `AskUserQuestion` punya **kolom jawaban bebas** (`Type something.`) di nomor `jumlah_opsi + 1`,
  dan baris terakhir `Chat about this` di `jumlah_opsi + 2`. Urutan yang benar & terverifikasi:
  nomor kolom bebas sebagai `send-keys` **tersendiri berisi tepat satu karakter** → prosa (tetap
  ber-`goalChunks`, kolom bebas adalah kolom teks) → **`Enter` HANYA setelah teksnya terbukti
  mendarat**; nomor opsi biasa memilih seketika, nomor kolom bebas cuma memindahkan fokus.
  Mekanismenya di `services/tui-dialog.ts` (baca murni, tulis lewat `PaneIO` yang disuntikkan) dan
  **fail-closed** di setiap ragu — bukan dialog → jalur lama persis seperti sebelumnya, dan dialog
  **tanpa** kolom bebas (trust, prompt izin) sengaja tak disentuh karena di sana `Enter` = baris 1
  = "ya". **Dua gotcha mengikat:** (1) verifikasi sebelum `Enter` itu wajib — menekannya
  "kalau-kalau berhasil" mengulang bug ini lewat jalur baru; (2) marker keputusan **tak ikut
  kosong** sesudah dialog dijawab (menjawab dialog bukan `UserPromptSubmit`, terukur 8 byte sebelum
  & sesudah), jadi `detect.ts` mengosongkannya sendiri sesudah jawaban mendarat — tanpa itu denyut
  berikutnya membakar giliran agen lalu mengetik prosa ke kolom chat yang sudah normal, **pesan
  liar** ke sesi yang sedang bekerja, sampai `maxAutoAnswers`. Opsi dialog sekalian disodorkan ke
  `leadPrompt.options` — field yang ada sejak ADR-0091 dan tak pernah diisi pintu deteksi. Pintu
  override operator (`POST /lead/decisions/:id/override`) ikut sembuh lewat `sendToPane` yang sama.
- **Lead yang gagal WAJIB mengatakan kenapa, dan wajib punya ujung** (SPEC-472, tanpa ADR — QA;
  ADR-0091 ditegakkan, ADR-0037 utuh). Dua aturan yang lahir dari satu kejadian: `claude -p` milik
  lead ditolak **401** karena `think()` meneruskan seluruh `process.env` server, dan di sana ada
  **`ANTHROPIC_API_KEY`** yang disuntik `services/config-apply.ts` dari `RuntimeConfig` — kunci API
  eksplisit **mengalahkan** `CLAUDE_CODE_OAUTH_TOKEN`, jadi satu nilai salah di Settings mematikan
  seluruh lead. Ia **tak terlihat di `/proc/<pid>/environ`** (itu env saat exec, bukan `process.env`
  yang sudah dimutasi runtime): bandingkan jumlah var, atau `strace -v -e trace=execve`. Sesi
  interaktif **tak** ikut kena karena lahir lewat **tmux**, yang env-nya membeku saat daemon lahir —
  jadi `inheritEnv: true` di `config-registry.ts` hari ini hanya sampai ke anak yang di-`spawn`
  LANGSUNG oleh proses server. **(A) Alasan gagal.** `leadFailureReason()` (murni, di `brain.ts`)
  membaca **KEDUA stream** (stderr dulu, lalu stdout), menyebut exit code/sinyal, dan menyimpan
  **ekor** keluaran (cermin cap transkrip ADR-0079). Tiga jebakan yang membuat
  `(stderr || err.message).slice(0, 500)` gagal total: agen CLI **tak sepakat soal stream** — dengan
  env ramping penolakan kunci mendarat di **stdout** (`stderr === ""`), dengan env server penuh
  nasihat yang paling berguna ("ANTHROPIC_API_KEY … takes precedence · Unset it") justru di
  **stderr** dan vonisnya tetap di stdout, jadi mana yang terbuang **bergantung env**;
  `err.message` `execFile` berbentuk `Command failed: <bin> <argv…>` yang argumen terakhirnya adalah
  **prompt lead ±10 KB**, jadi ia tak boleh dipotong melainkan **tak boleh dipakai** (galat `spawn …
  ENOENT` berbentuk lain dan tetap berguna); dan pesan galat hidup di **ekor**, jadi memotong kepala
  membuang persis yang dicari. Gejalanya: 152 baris jejak `gagal` beruntun, semuanya **552 char**,
  semuanya identik, dan `journalctl` bisu karena `decide()` memang menjadikannya baris jejak, bukan
  `console.error`. **(B) Ujung.** `detect.ts` punya penghitung **kedua** (`failures`, ambang
  `maxAutoAnswers` yang sama) karena pagar AC-11 mengukur jawaban yang BERHASIL diberikan dan karena
  itu tak pernah bergerak untuk sesi yang keputusannya selalu gagal — `engine.ts` `TICK_MS = 5_000`
  lalu men-spawn agen lead baru selamanya (terukur 152 percobaan / ±13 menit atas tiga sesi, kuota
  langganan yang sama dengan sesi pekerja). Gerbangnya **sebelum** `decide()` — yang mahal adalah
  panggilannya. `null` dari `decide()` (lead dijeda di tengah panggilan) **bukan** kegagalan dan tak
  dihitung; keberhasilan mengosongkan rantainya ("beruntun"), begitu pula `resetSession`/`sweep`.
- **Dialog `AskUserQuestion` BERANTAI harus dituntaskan sampai submit** (SPEC-474, tanpa ADR —
  brief; ADR-0091 ditegakkan, SPEC-452 diperluas): satu tool call boleh memuat **1–4 pertanyaan**,
  dan menjawab satu pertanyaan **hanya memajukan** dialognya. Terukur in-vivo (claude 2.1.220):
  layar berantai memuat **tab strip** `←  ☐ Warna  ☐ Ukuran  ✔ Submit  →` (`☒` = sudah dijawab) dan
  footer `Tab/Arrow keys to navigate`; sesudah pertanyaan terakhir muncul **layar rekap** —
  `Review your answers` · `Ready to submit your answers?` · `❯ 1. Submit answers` / `2. Cancel` —
  yang **tak punya baris footer chord sama sekali**, jadi parser SPEC-452 (berpangkal pada
  `enter to select|confirm`) **tak pernah melihatnya**. Di layar itu prosa **ditelan** (layar
  byte-identik) dan **satu digit** memilih seketika. Cacat yang diperbaiki bukan "jawaban salah"
  melainkan **hang senyap**: `detect.ts` menjawab pertanyaan pertama lalu mengosongkan marker,
  padahal hook `Notification` mengisi marker **SEKALI per dialog** dan **tak pernah menembak lagi**
  (terukur **0 B selama 120 dtk** dengan dialog masih terbuka) → sisa rantai tak terlihat pintu
  mana pun (`if (!filled) continue` bahkan tak meninggalkan baris skip), pane hidup terus, satu
  slot governor terkunci (kelas SPEC-451). **Empat aturan mengikat:** (1) rantai dituntaskan dalam
  **satu putaran deteksi** — menunggu denyut berikutnya mustahil karena markernya takkan terisi
  lagi; (2) **satu rantai = satu jawaban otomatis** terhadap `maxAutoAnswers` (default 3) —
  menghitung per pertanyaan membuat dialog 4 pertanyaan **mustahil selesai**; (3) **submit tak
  pernah memanggil agen** (`deps.submit` → `submitPaneDialog`, keystroke satu karakter lalu
  **membuktikan** layar rekapnya pergi) — menekan tombol yang tak butuh pertimbangan tak boleh
  membakar giliran; (4) rantai yang **putus di tengah** membiarkan marker **tetap terisi** +
  menaikkan `failures`, jadi sesinya tetap terbaca menunggu oleh operator. Anti-loop lewat
  **identitas layar** (`dialogKey` = tab strip + **judul** pertanyaan) — bukan label baris:
  label kolom-bebas berubah begitu prosa lead mendarat, sehingga kunci berbasis label membaca
  layar yang MACET sebagai layar yang maju. Batasnya `MAX_CHAIN_STEPS = 6`, **konstanta modul**
  (cermin `LEAD_ACTIONS`). **Varian ketiga yang wajib diingat:** `AskUserQuestion` yang opsinya
  ber-**`preview`** dirender widget lain — **tak ada baris `Type something.`**, `Chat about this`
  tanpa nomor, catatan lewat tombol **`n`**, dan panel pratinjau duduk di **kolom yang sama**
  dengan baris opsi (label mentahnya menyeret ornamen kotak → `cleanLabel`). Sebelum spec ini ia
  lolos sebagai "dialog tanpa kolom bebas" → jalur lama → `Enter` memilih **opsi 1** secara senyap.
  Jalur benarnya `answerNotesDialog` (`n` → prosa ber-`goalChunks` → `Enter` **hanya** sesudah
  `notesFilled`); layar rekap menampilkan `(notes only)` tapi prosanya sampai ke model **verbatim**.
  Dialog **tanpa tab strip** (trust, prompt izin) tetap tak disentuh: di sana `Enter` = baris 1 =
  "ya". Pintu override operator (`POST /lead/decisions/:id/override`) ikut sembuh lewat
  `sendToPane` yang sama, dan sengaja **tak** mengosongkan marker → sisa rantai dilanjutkan lead.
- **Lead punya BATAS KONKURENSI, dan batas itu harus dinyatakan** (SPEC-479, tanpa ADR — QA;
  ADR-0091 ditegakkan, ADR-0024 & ADR-0039 utuh): sebelum spec ini **tak ada satu pun** batas
  konkurensi di subsistem lead — bukan salah setel, ia tak ada. Karena tak dinyatakan, jawabannya
  jatuh ke **bentuk kode masing-masing pintu**, dan hasilnya dua kelakuan berlawanan yang sama-sama
  kebetulan: pintu deteksi `for (const s of sessions) { await … }` → **serial mutlak** (terukur
  `maxInFlight = 1`, tangga tunggu **0/204/407/614/832/1035 ms** untuk 6 sesi; head-of-line: dua
  keputusan 20 ms selesai di 1028 & 1053 ms di belakang satu keputusan 1000 ms), sementara
  `POST /lead/decisions` tanpa pengereman apa pun → **12 permintaan bersamaan = 12 proses
  `claude -p --effort xhigh`** (terukur) di mesin 8 GB / 8 core yang sudah menanggung sesi pekerja.
  Jejak nyata membenarkan bentuk serialnya: **jarak minimum 49,2 dtk, nol pasangan tumpang tindih**
  di 18 baris `LeadDecision`. Dengan `timeoutSec` 600 × `MAX_CHAIN_STEPS` 6 satu sesi berantai boleh
  memegang pintu deteksi **60,6 menit** sendirian sementara `busyDetect` memulangkan tiap tick 5 dtk,
  snapshot sesinya diambil **sekali** di awal loop, dan urutan `tmux list-panes -a` **stabil** →
  ekor daftar selalu di ekor: **kelaparan yang bisa direproduksi**, bukan antrean lambat. M1 (median
  ≤ 2 mnt) pecah di **N=5** pada keputusan tercepat terukur dan **N=2** pada anggaran penuh.
  Perbaikannya satu gerbang penerimaan **FIFO** (`services/lead/gate.ts`, kapasitas
  `lead.maxConcurrent` default **2**, deadline `lead.queueWaitSec` default **120** — keduanya di
  kolom `Json`, tanpa migration) dipasang di choke point yang **sudah tunggal**, `decide()`; FIFO
  bukan gaya melainkan syarat, sebab gerbang "siapa cepat" di atas urutan tmux yang stabil
  melaparkan ekor daftar persis seperti loop yang digantikannya. **Tiga aturan mengikat:**
  (1) **penuh ≠ gagal** — `LeadBusyError` tak menulis baris jejak dan tak menambah `failures`
  (pagar SPEC-472 dibuat untuk sebab yang **tak hilang dengan mengulang**; penuh hilang begitu slot
  bebas, dan menghitungnya membuat tiga lonjakan beban menutup sesi itu **selamanya** karena
  `failCapped` adalah keadaan **menyerap** — terukur **0 percobaan baru dalam 10 denyut** sesudah
  bebannya hilang); (2) pintu kontrak menjawab **503 + `Retry-After` + `retryable:true`**, sengaja
  bukan 409 (lead mati) maupun 504 (sudah mencoba) — keduanya menyuruh peminta menyerah;
  (3) fan-out pintu deteksi tetap **berbatas** oleh angka yang sama, sebab satu rantai mem-*poll*
  `capturePane` sampai 20×/langkah dan `tmux()` memakai `execFileSync` yang membekukan event loop
  **6,28 ms/panggilan** — fan-out tanpa batas menukar kelaparan dengan server tersendat. Hipotesis
  yang **terbantah** & jangan "diperbaiki": `timeoutSec` 600 > `requestTimeout` Node 300 dtk tidak
  memutus peminta — **Fastify menyetelnya 0** (terukur dari `buildApp()`), jadi satu-satunya batas
  tunggu adalah yang kita pasang sendiri. Residu yang **sadar dibiarkan**: `busyDetect` masih
  menutup pintu deteksi selama satu putaran berjalan, jadi penunggu baru menunggu putaran
  berikutnya (kini hitungan menit, bukan puluhan menit) — mengubahnya menyentuh semantik
  re-entrancy `engine.ts` (SPEC-432) dan pantas dapat spec sendiri.
- **Scope verifikasi per sesi** (SPEC-376/ADR-0080): `verifyScope` (`changed` default | `full`) —
  knob `Setting.verifyScope` (kolom `Json`, **tanpa migration**) + override saat Start. Sesi
  `changed` menguji **berkas yang berubah saja**: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"`
  atau `vitest related`, typecheck **per paket** (bukan `pnpm -r typecheck`), lint per berkas, dan
  build penuh / boot-server+curl hanya bila memang relevan. Alasannya sumber daya: beberapa sesi
  berjalan bersamaan di satu mesin (di repo ini satu suite penuh = 258 berkas test + 6 proses `tsc`).
  Akarnya **lubang di kontrak prompt** — `runner/src/prompt.ts` tak pernah menyebut scope verifikasi,
  jadi agen jatuh ke DoD repo target. Mewujud lewat **klausa prompt** (hanya flow ber-fase `Execute`
  — flow dokumen tak punya test) + **env** `HANOMAN_BASE_SHA`/`HANOMAN_VERIFY_SCOPE`; `baseSha`
  wajib lewat env karena worktree lahir `--detach` (tak ada `main`, `HEAD~1` salah). **Bukan**
  guardrail deny — ADR-0037 tetap utuh, dan agen boleh memperluas scope untuk perubahan berdampak
  luas asal menyebut alasannya. **Empat gotcha:** `--changed` menyalakan `passWithNoTests` sehingga
  nol test **terlihat hijau**; `--changed` di tingkat root WAJIB disertai **`--no-file-parallelism`**
  bila set-nya menyentuh test server — run root tak menghormati `fileParallelism: false` milik project
  server dan test server berbagi **satu berkas DB** (`<db>.test.db` per checkout sejak ADR-0086 —
  aman dari worktree tetangga, tapi tetap satu berkas untuk semua berkas test di paket itu), terukur
  di SPEC-397 set yang SAMA memberi **181 gagal
  palsu** paralel vs **736 lulus** serial, dengan bentuk kegagalan yang menyesatkan seperti regresi
  sync; env sesi dipasang sebagai **prefix shell** di depan argv sehingga
  tak pernah tercetak `/bin/echo` — buktinya harus dibaca dari DALAM proses (`fake-agent-env.sh`);
  dan untuk perubahan di modul INTI `--changed` memang mendekati suite penuh (terukur di SPEC-376
  sendiri: menyentuh `shared/src/{enums,entities,dto}.ts` → 217 berkas / 1589 test / 177 dtk) —
  itu blast radius yang sebenarnya, penghematan datang dari perubahan berdaun. `sync-ws.test.ts`
  terbukti **non-deterministik** (gagal 2× di run campur-project, lulus sendirian, lulus bersama
  tetangga server, lulus saat set yang sama diulang) — jalankan ulang terisolasi DAN ulangi
  set yang sama sebelum menyalahkan perubahanmu.
- **"Belum mulai" ≠ `baseSha IS NULL`** (SPEC-431, tanpa ADR — QA, mempersempit ADR-0072): checker
  `backlog` (SPEC-295) dan denyut lead (SPEC-409) memilih pekerjaan lewat **satu** predikat bersama
  `UNSTARTED_SPEC_WHERE` (`services/scheduler/queue.ts`) = **`baseSha: null` DAN `stage: not "done"`**.
  `baseSha` sendirian menjawab pertanyaan yang **berbeda** — "pernahkah hanoman membuatkan worktree
  untuk item ini" — dan kolomnya baru ada sejak ADR-0030, jadi item yang tuntas tanpa pernah diluncurkan
  hanoman (selesai pra-ADR-0030, ditandai selesai manual lewat `PATCH /specs/:id {stage}`, atau
  dikerjakan di checkout lain) permanen tak terbedakan dari item yang belum pernah disentuh. Terukur di
  DB produksi: **27 `Spec` `done` ber-`baseSha` null → 27 dari 29 baris antrean → 6 sesi tmux sungguhan
  lahir di atas pekerjaan yang sudah selesai**. `startedAt` (SPEC-408) **bukan** penggantinya: ia ditulis
  di titik cekik yang SAMA dengan `baseSha`, jadi null untuk 27 item yang sama — menukar proksi dengan
  proksi tak memperbaiki apa pun; `stage` adalah satu-satunya pernyataan tentang pekerjaannya sendiri.
  Yang membuat bug ini mahal: `startSpecSession` menghitung `isContinue = stage === "done"`, jadi item
  `done` justru masuk jalur reopen SPEC-172 — worktree + branch baru dan `baseSha`/`headSha`/`startedAt`
  **ditulis ulang** (stempel ADR-0090 milik item lama jadi bohong). **Gerbang kedua wajib di governor**
  (`isDone` dep, tepat sebelum `launch`): memperbaiki checker saja meninggalkan baris `queued` basi yang
  tetap akan meluncur, dan tak menutup balapan "operator menyelesaikan item selagi ia mengantre"; item
  itu **ditutup `done` + `note`** (bukan dihapus — `enqueue` ber-`update:{}` tak boleh menghidupkannya
  lagi) tanpa memakan slot. Gerbangnya sengaja **bukan** di `startSpecSession`: reopen manual item `done`
  memang fitur, yang dilarang cuma otomasi memasukinya sendiri.
- **Backlog boleh saling bergantung** (SPEC-447/ADR-0093): `Spec.dependsOn` (kolom `Json?`, array id
  spec **satu project**) menahan peluncuran sampai tiap dependency `stage = done` **DAN** commit-nya
  (`headSha`) sudah ada di branch basis si dependent (`branchFrom ?? "HEAD"`) — merged adalah **nilai
  turunan** git (`merge-base --is-ancestor`, memo 15 dtk), bukan kolom (ADR-0019). Yang membuatnya
  penting bukan urutan melainkan ADR-0002: sesi lahir `--detach` dari `branchFrom`, jadi dependent
  yang lahir lebih dulu **secara fisik tak memuat** pekerjaan dependency-nya. Satu resolver
  `services/spec-deps.ts` dipakai TIGA pembaca (gerbang `startSpecSession`, gerbang governor,
  dekorasi `liveSpecs` → `blockedBy`) — menyalin predikatnya adalah kelas bug SPEC-431. **Empat
  gotcha:** dependency yang **tak punya jejak kerja sama sekali** adalah **SIAP** — dan sejak SPEC-475
  "jejak kerja" berarti `headSha` **?? tip branch sesinya** (`hanoman/<sessionIdForSpec(id)>`, ADR-0032),
  bukan kolom `headSha` sendirian: kolom itu kosong pada **~76 %** item `done` ber-worktree, sehingga
  membacanya begitu saja membuat alasan `unmerged` **tak pernah menyala sekali pun** (0 dari 56 baris
  antrean di DB hidup) dan rantai backlog diluncurkan **6 detik** sesudah dependency-nya `done`, ±8,5
  jam sebelum merge-nya; git yang tak bisa menjawab dibaca
  **belum merged** (fail-closed); `"dependsOn"` **wajib** di `FIELDS.spec` atau client kehilangan
  urutannya dan meluncurkan pekerjaan yang di hub terblokir; dan `GovernorDeps.blockers` sengaja
  **wajib** (bukan opsional) supaya gerbang otomasi tak bisa lupa dipasang. Item terblokir tetap
  `queued` + `note` (bukan `failed` — pemblokirnya akan selesai, dan `enqueue` ber-`update:{}` tak
  bisa menghidupkan baris yang sudah ditutup) dan **tak memakan slot**; denyut lead menyaringnya
  sebelum membeli giliran agen (gerbang aktionabilitas SPEC-432). `force` **hanya** untuk jalur
  manusia (`POST /terminal/sessions`, 409 tanpa itu); otomasi tak punya jalan paksa. `dependsOn`
  sengaja **di luar** gerbang edit SPEC-186 — ia menggerbangi peluncuran berikutnya, bukan konten
  sesi berjalan; dan `DELETE /specs/:id` mencabutnya dari dependent agar tak ada yang terkunci
  `missing` selamanya.
- **`Spec.headSha` punya SATU penulis dan TIGA jalur yang memicunya** (SPEC-475,
  `services/spec-head.ts` → `recordHeadSha()`): `DELETE /terminal/sessions/:id`,
  `scheduler/reconcile.ts`, dan overlay stage-live `live-specs.ts`. Setiap jalur yang mempersist
  `stage = "done"` **wajib** memanggilnya — bukan opsional, dan jangan pernah menyalin isinya.
  Sampai SPEC-475 hanya jalur DELETE yang menulis kolom itu, sementara penyelesaian **otonom** tak
  pernah melewatinya (pane sesi sukses tak mati sendiri, SPEC-433; `integrate-main` lead melepas pane
  lewat `killSession` LANGSUNG demi worktree utuh, SPEC-451; item yang di-Start manual tak punya baris
  antrean sehingga `reconcile` tak menyentuhnya) → **159 dari 210** item `done` ber-worktree kosong
  ujungnya, gerbang dependency ADR-0093 kehilangan buktinya, dan rentang review ADR-0030 jatuh ke
  fallback worktree. Ini pengulangan **ketiga** pola SPEC-431/448 "satu definisi, N call site", dengan
  satu perbedaan yang membuatnya lebih licin: yang berbeda antar-jalur bukan **predikat** melainkan
  **efek samping** — dan efek samping tak punya tipe yang bisa memaksanya konsisten seperti
  `GovernorDeps.blockers`. `null` **tak pernah** ditulis: HEAD yang tak terbaca (worktree lenyap, repo
  rusak) tak boleh MENGHAPUS ujung yang sudah tercatat — itu menukar "belum ter-merge" jadi "siap"
  persis di titik paling berbahaya.
- **Custom agent — persona global & per project** (SPEC-450/ADR-**0094**): entitas `CustomAgent`
  (migration tulis tangan, **ikut sync**) dengan `projectId` null = **global**, terisi = milik satu
  project; agen project **menimpa** global bernama sama (dan agen project yang **dimatikan**
  menyembunyikan global itu — begitulah cara mematikan agen global di satu project). `id`
  **deterministik** `"<projectId|global>:<name>"` dan `name` **immutable**: baris ini menyeberang
  changefeed yang **tak punya operasi hapus**, jadi id acak membuat dua mesin melahirkan dua baris
  yang lalu bertemu di satu objek JSON **berkunci nama** dan salah satunya hilang tanpa jejak.
  **Nol berkas ditulis ke worktree.** Sesi **claude** lahir dengan `--agents "$(cat <file>)"`
  (mekanisme native — custom agent jadi **subagent sungguhan**; JSON di berkas tmpdir karena tmux
  membatasi SATU command ±16 KB, kelas kegagalan SPEC-223); sesi **codex** menerima blok **roster**
  yang ditempel ke akhir prompt sesi dan mengadopsi peran **inline** (tak ada proses kedua → risiko
  loop di codex **struktural nol**). Keduanya dirakit di titik cekik **`createSession`** lewat
  `registerCustomAgentSource` (cermin `registerSessionHooks`) dengan cache **sinkron** — Prisma
  async, `createSession` tidak — yang di-invalidasi tiap mutasi route & sync; gagal baca → daftar
  kosong. Sesi ber-`opts.command` (shell mentah) tak menerima apa pun. **Anti-loop tiga lapis, dua
  pertama yang menjamin:** graf mention wajib **asiklik** (409 + jalur siklusnya), lalu `Task`
  **diturunkan dari `mentions`** sehingga agen daun **tak punya alat** memanggil siapa pun (dan
  `Task` yang diketik operator DICABUT), lalu anggaran hop `MENTION_MAX_HOPS = 3` di prosa —
  `DEFAULT_AGENT_TOOLS`/`MENTION_MAX_HOPS` **konstanta modul, bukan konfigurasi** (pola
  `LEAD_ACTIONS`). **Tujuh gotcha:** (1) ketiga permukaan **gagal-senyap** sehingga verifikasi
  berbasis exit code **lulus palsu** — `--agents` ber-JSON rusak keluar exit 0 dengan NOL agen,
  nama tool tak dikenal dibuang tanpa pesan (`Glob`/`Grep`/`TodoWrite` terukur hilang), dan codex
  menerima kunci `-c` tak dikenal tanpa keluhan; verifikasi harus **menanyai agen apa yang
  benar-benar ia miliki** (kelas jebakan `paneText.includes("/goal")`, ADR-0085); (2) memeriksa graf
  **global saja tidak cukup** — validasi wajib jalan atas global **dan setiap project**; (3)
  `@@unique([projectId,name])` **tidak** mencegah dua agen global bernama sama (NULL saling berbeda
  di indeks unik SQLite) — yang mencegahnya PK deterministik; (4) `--agents` **tak boleh** ikut
  `.map(sq)` seperti flag lain atau claude menerima literal `$(cat …)` sebagai definisi agen; (5)
  membiarkan `tools` kosong juga tak boleh — agen tanpa `tools` mewarisi SEMUA tool termasuk `Task`
  dan lapis 2 lenyap; (6) nama tool yang dibuang senyap **aman** karena membuang hanya mengurangi
  kemampuan; (7) `"customAgent"` wajib ikut `PG_ORDER` + seluruh kolomnya di `FIELDS.customAgent`.
  Domain capability **baru `agents`**, dipetakan **menurut method** (kelas bug SPEC-405). **Bukan**
  titik spawn agen baru — `services/lead/brain.ts` tetap satu-satunya di luar `pty.ts` (SPEC-448).
- **Telegram = kanal ke session operator tmux, BUKAN runtime agen kedua** (SPEC-476/ADR-0096): satu
  private chat/user allowlisted → satu id session `tg-<hash>` durable; natural text, command, dan
  callback di-steer ke pane yang sama, action produk hanya lewat `/api` ber-AgentToken/capability/
  correlation/audit. Gateway = satu long-poll `getUpdates` in-process dari `server.ts`, tanpa webhook,
  worker, Redis, tool bus, shell executor, atau spawn per pesan. Offset+dedupe+binding+outbox+memory+
  confirmation+audit adalah model SQLite LOCAL-only. **Crash policy mengikat:** state batas
  `received→dispatching` / `pending→sending` menjadi `uncertain` dan TIDAK diretry otomatis — update
  yang sama tak pernah masuk pane dua kali. Bot token hanya env gateway dan tak pernah masuk session;
  AgentToken masuk env session, bukan prompt. Reply Telegram HANYA dari amplop eksplisit tersanitasi,
  **jangan pernah** dari raw PTY/capture-pane (teks tanpa ANSI pun dapat memuat reasoning/command echo/
  secret). Aksi sulit dibatalkan membutuhkan confirmation inline single-use sebagai kondisi tambahan
  token gateway; capability/pagar route existing tetap menang. Personality memakai `CustomAgent`,
  memory+summary dikurasi session yang sama, dan claude/codex mewarisi `sessionAgentDefaults()`.
- Stage bergerak **maju** hanya lewat fase yang dilaporkan sesi; **mundur** hanya lewat aksi human eksplisit `PATCH /specs/:id { stage }` (backward-only, ADR-0027). `executing` **tertahan** (tak jadi `done`) selama plan `docs/superpowers/plans/**` masih punya `- [ ]` (ADR-0029).
- Biaya bersifat **estimasi dan tidak menggerakkan apa pun** (ADR-0012): tak ada `dailyBudget`/budget flag. Indikator limit dibaca dari OAuth usage API Anthropic (`services/limits.ts`), bukan parsing output terminal.
- **Jangan pernah menjalankan run/sesi di working tree utama** — selalu worktree terpisah. Jangan menyentuh worktree sesi lain.

## Aturan Keamanan

- Auth (ADR-0028): login email/password menggerbangi **seluruh `/api`** (gate `onRequest`, 401 tanpa sesi, termasuk upgrade WebSocket `/api/terminal`). Publik hanya `GET /health`, `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`.
- **Agent token — akses AI agent** (SPEC-257/ADR-0065): jalur auth **kedua** ke `/api` untuk AI agent eksternal (`Authorization: Bearer` / `?agent_token=` di WS), ditegakkan **capability per-domain read/write** (write⊇read; katalog `@hanoman/shared`). `AgentToken` server-local (hash-at-rest, cermin DeviceToken); master switch `Setting.agentAccessEnabled` (default off) menolak semua. Tak-boleh-didelegasikan (agent → 403): `/auth`, `/agent-tokens`, `/device-tokens`, `/sync`. Cookie = akses penuh (tak ada RBAC). Bukan perluasan permukaan eksekusi — `sessions:write` RCE tetap dibatasi isolasi worktree.
- Password: `crypto.scrypt` (stdlib) + salt acak + `timingSafeEqual`; tak pernah dikembalikan ke client. Sesi: token opaque 256-bit di cookie `httpOnly`; DB menyimpan `sha256(token)`, revocable. Login di-throttle per IP; error selalu generic.
- Tanpa RBAC — semua user setara; `DELETE /auth/users/:id` menolak menghapus user terakhir. Bootstrap: `POST /auth/setup` membuat akun pertama lalu tertutup (409). Lakukan `setup` segera pada deploy pertama.
- **Guardrail perintah berbahaya DICABUT sepenuhnya** (SPEC-197, ADR-0037): sesi jalan `--dangerously-skip-permissions` tanpa hook deny apa pun — agen dipercaya penuh, setara developer yang menjalankan `claude` di mesinnya sendiri. `runner/src/safety.ts` sudah dihapus. **Jangan hidupkan kembali tanpa ADR baru.**
- **Isolasi worktree adalah satu-satunya batas keamanan yang tersisa** (ADR-0037): sesi di `.worktrees/<id>`, tak ada akses ke working tree utama.
- Kredensial Claude (Keychain macOS / `~/.claude/.credentials.json` / env `CLAUDE_CODE_OAUTH_TOKEN`|`ANTHROPIC_API_KEY`) dan private key VPS (`Vps.keyPath`, file di server) **tak pernah ke client maupun DB**.

## Aturan Data & Skema

- **Tujuh model inti** (SQLite via Prisma 6, ADR-0086): `Project`, `Spec`, `Setting`, `Notification`, `User`, `Session`, `Vps`. Tidak ada `Run` maupun `Trigger` — di-drop saat pindah ke sesi interaktif (ADR-0024). Model pendukung mencakup `DeviceToken`, **`AgentToken`** (kredensial AI agent + capability, SPEC-257/ADR-0065, server-local), `SessionResult`, sync (`SyncLog`/`SyncOutbox`/`SyncState`/`LocalBinding`/`RuntimeConfig`), Help Center (`Ticket`/`TicketAttachment`), VPS compliance (`VpsAuditSnapshot`/`VpsItemState`), dan **`CustomAgent`** (katalog persona agen global & per project, SPEC-450/ADR-0094 — **disync**). **Error monitoring (`ErrorGroup`/`ErrorEvent`/`SourceMapArtifact`) dan `ProjectLink` sudah dicabut** — SPEC-384/ADR-0092, pemantauan pindah ke Uptrace.
- Enum stage/source/priority disimpan sebagai **`String` + divalidasi zod** di `@hanoman/shared` (`enums.ts`), bukan enum Prisma.
- `Project.id` (slug) **kekal**, tak ada endpoint rename; `repoDir` OPSIONAL & tak disync. **`LocalBinding`** (`projectId → repoDir`, per-mesin, LOCAL-ONLY) meng-override path; `resolveRepoDir = binding ?? Project.repoDir` dipakai **seluruh** jalur baca (spawn/IDE/coverage/branches/specs/docs).
- `docStatus`/`coverage`/**Docs**/**PRD** **bukan kolom & tidak dipersist** — docs live dari disk via `git ls-files`, coverage diturunkan tiap `toProjectView` (ADR-0018), PRD = dokumen `docs/prd/<slug>.md` (ADR-0041). Tabel `DocFile` sudah di-drop (ADR-0011).
- **Jangan ubah skema tanpa migration + ADR.** Menambah model: hand-write `migration.sql` + `migrate deploy` (bukan `migrate dev` yang me-reset). Jalankan `prisma generate` sesudah merge yang membawa model baru. **DB test tak perlu disiapkan manual** sejak ADR-0086 — `server/test/global-setup.ts` menghapus `<db>.test.db` lalu `migrate deploy` tiap run. Model baru **wajib** ikut `PG_ORDER` di `cli/src/commands/migrate-pg.ts`; test DMMF akan merah kalau lupa.
- **Fitur yang tak didukung SQLite dan karena itu tak boleh masuk skema:** scalar list (`String[]` non-relasi), tipe native `@db.*`, `Decimal`, `Bytes`, `mode: "insensitive"` pada filter (`LIKE` SQLite sudah case-insensitive ASCII). Skema juga **tak memakai `@map`** sama sekali — properti itu yang membuat tool migrasi Postgres bisa memakai baris `SELECT *` langsung sebagai data `createMany`; jangan merusaknya.
- DB dijaga kosong untuk pemakaian nyata (tanpa demo seed). Test memakai berkas `<db>.test.db`, bukan `DATABASE_URL` dev — vitest **menolak jalan** bila keduanya sama.

## Aturan Dokumentasi & Alur

- **SoT sebagai konvensi** (ADR-0023, supersedes ADR-0001): `internal/docs/**` tetap Source of Truth — diperbarui dalam **commit yang sama** & ter-link di index (`internal/docs/README.md`). Tapi guardrail/Stop hook/gate Execute yang menegakkannya **dicabut** (SPEC-160). `hanoman docs scan` tetap ada sebagai laporan coverage read-only. **Jangan menambahkan gate kembali tanpa ADR baru.**
- **Nomor SPEC & ADR unik & imutable**; ADR usang tidak dihapus — ditandai statusnya. Sibling worktree bisa mereservasi nomor yang sama — **enumerasi lintas semua branch** sebelum mengklaim nomor (ADR-0021).
- **Dokumen audit berumur, ADR tidak** (SPEC-386/ADR-0083): laporan
  `internal/docs/research/audit-<spec>-<slug>.md` hidup sampai eskalasinya diputuskan (ADR-0076) dan
  spec turunannya tuntas, lalu **dihapus berikut entri indexnya**. Tiga syarat: temuannya sudah punya
  **jejak permanen** (ADR, baris di doc SoT, atau kode ter-commit); **rujukan masuk ikut dibereskan** —
  doc permanen kerap menaut dokumen auditnya, dan melewatkannya meninggalkan link mati di doc yang
  justru dimaksudkan abadi (di SPEC-386 ada empat: ADR-0062/0064/0081 + `frontend-implementation.md`);
  dan index **tidak** menyimpan abstrak audit. **Struktur index sejak SPEC-386:**
  `internal/docs/README.md` memuat **satu baris per ADR** (nomor · judul · penanda status), sedangkan
  **narasi** tiap keputusan hidup di sub-index `internal/docs/adr/README.md` — ADR baru wajib ditaut di
  **keduanya**. Reachability aman karena coverage memakai BFS graf link (`linkedSetFrom`), bukan daftar
  datar, jadi doc yang hanya ter-link lewat sub-index tetap terhitung `linked`. Alasan pemisahan: index
  dibaca **setiap** sesi agen; sebelum SPEC-386 94% isinya (46,6 KB) adalah changelog ADR + abstrak
  audit, sekarang ±9 KB.
- **Alur fitur:** spec → plan → execute. **Alur QA:** audit → keputusan → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped`; keputusan dielicit lewat prompt & diambil agen (ADR-0020/0040). **Alur audit-only** (SPEC-237/ADR-0057): audit → laporan (dokumen), berhenti; tanpa perbaikan, promotable ke Finding QA.
- Prompt sesi memetakan fase → skill superpowers: Brainstorm→brainstorming, Audit→systematic-debugging, Plan→writing-plans, Execute→executing-plans + TDD + verification-before-completion.
- Ikuti design system di `internal/docs/design-system/**` (editorial, bone paper, brass accent).
- **Unduh dokumen** (SPEC-361/ADR-0078): setiap pratinjau Markdown (`SpecDocsModal` — dipakai Backlog **dan** Terminal, PRD, Docs SoT, IDE) punya tombol `.md` & `.pdf`. Mekanismenya query `?download=md|pdf` pada endpoint dokumen yang **sudah ada** — jangan bikin endpoint ekspor baru; nilai lain/absen mengembalikan JSON lama utuh. PDF dirender `server/src/services/doc-export.ts` (`marked.lexer` → `pdfkit`, standard-14 font, `--external:pdfkit` di esbuild). **Gotcha wajib:** pdfkit **tidak melempar** untuk glyph di luar WinAnsi — ia mencetak mojibake senyap (`→` jadi `!'`, emoji jadi `Ø<ß‰`), jadi semua teks harus lewat `toWinAnsi()`; dan pdfkit **mewariskan opsi** di sepanjang rantai `continued`, jadi flag seperti `strike` wajib eksplisit boolean atau satu `~~coret~~` mencoret sisa paragraf.
- **Pratinjau dokumen tak menggulir ke samping & setinggi ruang yang ada** (SPEC-363, tanpa ADR — memperbaiki SPEC-361/ADR-0078): `.hn-md` memasang `overflow-wrap: anywhere` (**bukan** `break-word` — hanya `anywhere` yang mengecilkan *min-content*, dan min-content itulah yang membuat rantai inline `code` tanpa spasi & tabel lebar mendorong container), `table-layout: fixed`, dan `pre` ber-`white-space: pre-wrap`. Terukur atas **353 `.md` nyata**: 33 dokumen menggulir horizontal → 0, 187 dokumen ber-`pre` → 0 (harga +12,5% tinggi konten). Tinggi pane diturunkan dari viewport lewat rantai flex (`Modal fillHeight` opt-in + `flex: 1 1 0` di root layar Docs/IDE), bukan `62vh`/`620` tetap. **Dua gotcha wajib.** (1) `flex-basis` di item terluar **harus `0`**, bukan `auto`: pembungkus `<main>` memakai `min-height: 100%` (SPEC-351), jadi basis `auto` membuat item memakai tinggi ISI-nya dan justru menumbuhkan halaman — terukur pane 6000 px + halaman ikut menggulir; `LIST_SCREEN_STYLE` (basis `auto`) karena itu **tak** bisa dipakai apa adanya di sini. (2) di pdfkit, `doc.text(str, x, y, { width })` **menyalakan pembungkus baris yang memanggil `addPage()` sendiri — walau `lineBreak: false`**; karena renderer menaruh teks di koordinat eksplisit sambil membukukan `doc.y` sendiri, setiap pemakaian `width` di posisi eksplisit melahirkan halaman kosong (footer bernomor → satu halaman kosong PER halaman, dan nomornya ikut tercetak di halaman kosong itu; penanda butir daftar → `doc.y = top` jadi koordinat halaman basi, 5 dari 12 halaman PRD kosong — rantai DUA mata, dan matriks 2×2 membuktikan memutus salah satu saja sudah cukup). Blok kode digambar **bersegmen** — satu `rect` latar per halaman — dan hanya pindah halaman bila bloknya memang muat di halaman kosong (dulu satu `rect` 2126,6 pt menabrak footer). Hasil: `api-contract.md` 42→18 halaman, PRD hardening-vps 12→7 tanpa halaman kosong.
- **Kartu yang berisi pane bergulir wajib `<Card fill>`, bukan `style`** (SPEC-393, tanpa ADR —
  memperbaiki SPEC-363): `Card` **selalu** menyisipkan satu pembungkus `<div>` di sekitar
  `children`, dan pembungkus itu `display: block` kecuali prop **`fill`** dipasang — `fill` yang
  menyetel `display:flex`+`flexDirection:column`+`flex:1 1 auto`+`minHeight:0` pada **dua-duanya**
  (div terluar *dan* pembungkus anak). SPEC-363 memasang rantainya lewat `style`, yang hanya
  mengenai div terluar, jadi pembungkus anak memutus rantai: `flex`/`minHeight` di pane jadi
  **inert**, pane tumbuh setinggi isinya, dan karena `Card` ber-`overflow: hidden` isinya
  **terpotong tanpa scroller mana pun** — Docs & IDE Explorer tak bisa digulir sama sekali.
  Terukur di Chrome (viewport 1512×813, `<main>` 757 px): pane 11 830 px di dalam kartu 701 px →
  **11 184 px hilang**, dan `clientHeight === scrollHeight` di pane membuktikan ia tak pernah
  menggulir melainkan hanya tumbuh. **Jebakan test:** kontrak style SPEC-363 memeriksa PANE-nya
  (`flex: 1 1 auto`, `overflow: auto`, tanpa px/vh) dan itu tetap benar sepanjang bug — yang salah
  induknya. Karena itu `src/test/scroll-chain.test.tsx` **menaiki rantai leluhur** pane dan
  menuntut tiap mata rantai meneruskan tinggi (`display` flex/grid + `minHeight: 0`); jsdom tak
  melayout, jadi hanya kontrak itu yang bisa dijaga di test. Kontrol kerjanya sejak 2026-07-10:
  `ProjectsScreen.tsx` `<Card padding={0} fill>`; `DocPreviewModal` aman karena rantainya
  `Modal fillHeight` → `modal-body`, tanpa `Card`. **Sweep dua lapis** (54 `Card` dienumerasi →
  9 kandidat → 4 tanpa `fill`, lalu detektor gejala "terpotong & tak terjangkau" di Chrome)
  menemukan korban keempat yang **tak dikeluhkan**: modal berkas Git Graph (kartu ber-`maxHeight:
  86vh`), 11 162 px hilang. `ReviewScreen`/`BranchesPanel` aman **justru karena** pane-nya masih
  ber-`maxHeight` tetap — pane berbatas sendiri tak bergantung pada rantai. **Gotcha kedua:**
  `fill` juga menyetel `flex: 1 1 auto`, jadi di modal yang dipusatkan overlay flex ber-arah
  **baris** ia melebarkan panel (terukur 900 → 1464 px) — kembalikan `flex: "0 1 auto"` lewat
  `style` (di-spread sesudah `fill`); kartu grid item (Docs/IDE) tak kena.
- **Aksi preview `.md` di IDE & Review** (SPEC-385, tanpa ADR — memperluas ADR-0078 + preseden
  SPEC-240/363): empat permukaan yang dulu menampilkan `.md` sebagai `<pre>` mentah kini punya aksi
  preview — pane **diff** Explorer, modal berkas **Git Graph**, dan **Review** (backlog *dan* sesi
  PRD) — sementara IDE mode file mendapat ruang baca lebar di samping toggle inline SPEC-240 yang
  **tetap ada**. Satu komponen DS `ds/DocPreviewModal.tsx` (`Modal fillHeight` + `MarkdownView` +
  `DocDownload` opsional) yang **tak menyentuh api client**; gerbang seragam `isMarkdownPath(path)`
  (predikat pindah dari const lokal `IdeScreen` ke `ds/markdown.tsx`) **dan** non-biner **dan**
  `content !== null`. **Git Graph memakai TAB `preview`, bukan modal** — permukaannya sudah modal,
  jadi modal bertumpuk membuat Escape ambigu. Tombol IDE berlabel **"Preview lebar"** karena toggle
  SPEC-240 sudah memakai kata "Preview". Parity unduh ADR-0078 diwujudkan dengan menempelkan
  `?download=md|pdf` ke **lima endpoint yang sudah ada** (`/specs/:id/review/*`,
  `/terminal/sessions/:id/review/*`, `/projects/:id/file-diff`, `/projects/:id/commit/:sha/file`,
  `/projects/:id/compare/file`) lewat `sendReviewDownload` — **tanpa endpoint/skema/migration/ADR
  baru**; yang dikirim `ReviewFile.content` (isi **sesudah** perubahan, sama dengan yang dirender),
  dan biner atau `content === null` → **404** (bukan PDF kosong yang menyesatkan). `shared/src/api.ts`
  sengaja **tak** disentuh — `paths.download()` sudah generik, dan menyentuh modul inti meledakkan
  blast radius `vitest --changed` (ADR-0080).
- **Setiap task execute selesai:** centang checklist di file plan (`docs/superpowers/plans/**`, `- [ ]` → `- [x]`), lalu jalankan **test yang tersentuh perubahan itu** (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` atau sebut path test-nya). Bila task menyentuh endpoint, **test API-nya secara nyata di local** sekali di akhir — boot server (`pnpm dev` atau `node server/dist/server.js`) dan curl endpoint yang tersentuh, jangan hanya andalkan unit test. Fix sampai hijau sebelum lanjut.
- TypeScript strict; test untuk setiap logika orchestrasi (trigger, queue, worktree, guardrail). Sesi menjalankan test **yang tersentuh perubahannya** dan typecheck **paket yang tersentuh** (`pnpm --filter ./server typecheck`) — bukan suite penuh, bukan `pnpm -r typecheck` (SPEC-376/ADR-0080). Suite penuh (`vitest run --no-file-parallelism`) adalah langkah **manusia** sebelum merge. Hindari env prod bocor (`env -u NODE_ENV -u DATABASE_URL`).
- Definition of done: test yang tersentuh hijau · docs tersentuh diperbarui + ter-link · diff bersih di worktree, siap push ke target branch.
