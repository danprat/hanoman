---
name: hanoman
description: >-
  Pakai saat mengerjakan project hanoman: orchestrator + dashboard workflow
  docs-driven untuk nafanesia.id — perencanaan produk, arsitektur (Fastify +
  Postgres/Prisma + node-pty/tmux + git worktree), sesi Claude Code interaktif,
  fase spec/plan/execute, backlog & PRD, terminal realtime, modul VPS/sync,
  auth, keamanan, design system, docs Source of Truth, atau operasi agent di
  dalam repo hanoman.
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
- Deploy: `internal/docs/operations/deploy-vps.md` (single-host VPS) · `production.md` (prod di samping dev)
- ADR (nomor unik & imutable): daftar lengkap di `internal/docs/README.md`; yang paling sering diacu — 0024 (sesi interaktif menggantikan run), 0023 (guardrail SoT dicabut), 0037 (guardrail safety dicabut), 0002 (isolasi worktree), 0015 (satu backlog satu sesi), 0016 (sesi tmux), 0028 (auth sesi opaque), 0011/0018 (docs & coverage live/derived), 0035 (sesi tembus batas fase), 0041 (PRD sebagai dokumen), 0043–0048 (sync/device-token/auto-update).
- Kontrak agent repo: `AGENTS.md` · `CLAUDE.md` (root repo).

## Sub-Skill

Pakai skill lebih sempit saat task cocok:

- `hanoman-devops` (`internal/skills/hanoman-devops/SKILL.md`) — deploy & operasikan aplikasi hanoman di server: VPS single-host di belakang reverse proxy TLS, prod di samping dev, systemd, Postgres Docker, prisma generate/migrate, update in-place (SPEC-214), rollout sync hub/client (SPEC-213), dan verifikasi/troubleshoot.

## Aturan Produk

- Bentuk produk: **instrument panel yang tenang**. Overview sebagai beranda; tiap area (Projects/PRD/Backlog/Terminal/Docs/VPS/Settings) satu klik dari sidebar; Terminal adalah pusat gravitasi saat sesuatu berjalan.
- **Manusia terakhir yang memutuskan.** Otomasi penuh boleh, tapi selalu bisa diinterupsi/di-steer.
- **Satu workspace dulu** (nafanesia.id). Multi-tenant adalah pasca-MVP.
- Objektif MVP: satu operator menjalankan & memantau Claude Code di banyak project sekaligus, dengan docs sebagai Source of Truth, tanpa kehilangan kendali atas sesi berjalan.
- Empat lakon (temperamen produk): **Anoman Duta** (kepercayaan dibuktikan spec & docs), **Anoman Obong** (sesi menyelesaikan tugas & lapor balik), **Gunung Dronagiri** (ragu → dokumentasikan semuanya), **Chiranjivi** (docs abadi melampaui commit).
- PRD (SPEC-210) duduk di hulu Backlog: brief + brainstorm → dokumen PRD sebelum fitur dipecah ke spec + plan.

## Aturan Arsitektur

- Dashboard: **React + TypeScript + Vite**. Server: **Node.js + TypeScript (Fastify)**. DB: **PostgreSQL via Prisma**.
- Realtime: **WebSocket hanya untuk terminal PTY**; sisanya **HTTP polling** (projects, backlog, notifications, limits, vps). Jaga UI responsif — log sesi streaming, jangan blok main thread.
- Terminal server: **node-pty + tmux** (socket `-L hanoman`, `remain-on-exit on`); terminal web: **xterm.js** merender TUI Claude Code apa adanya. tmux menahan sesi hidup lintas restart API (ADR-0016).
- **Tidak ada** message queue, Redis, worker terpisah, scheduler cron, maupun webhook GitHub — semua dicabut saat pindah ke sesi interaktif (ADR-0024). Satu-satunya kerja latar = dua `setInterval` di `server.ts` untuk monitor VPS (health 5 mnt, audit 24 jam).
- Server **bind `127.0.0.1:8787`** di belakang reverse proxy TLS; `HOST=0.0.0.0` hanya bila ada TLS di depan.
- `runner/src/*` adalah **library**, bukan proses: `git.ts` (worktree), `prompt.ts` (prompt + `PIPELINES` fase), `reverse-standard.ts`, `settings.ts`. Tak ada lagi invokasi `claude` headless; flow CLI lama (execute/spec/plan/qa) sudah dicabut (ADR-0024).
- Docs SoT & coverage dipindai **live dari path efektif** tiap request (ADR-0011/0018), bukan tabel DB.
- Verifikasi doc terkini via Context7 sebelum mengubah keputusan platform/framework.

## Aturan Sesi & Eksekusi

- Mesin eksekusi nyata = **`server/src/services/pty.ts`**: `createSession()` men-spawn agen (`<prompt>` + flag agen) di window tmux; node-pty `tmux attach` menjembatani ke WebSocket, poll 500 ms mengawasi exit + perubahan phase-file lalu broadcast frame. **tmux adalah satu-satunya sumber kebenaran pekerjaan berjalan — tidak ada baris `Run` di DB.**
- **Dua agen** (SPEC-338/ADR-0074): `Agent = "claude" | "codex"`. `Setting.agent` = default global untuk SEMUA sesi yang men-spawn agen (backlog, reverse, prd, scaffold, breakdown, terminal-agen, konflik-integrasi); sesi backlog bisa override lewat `agent` di `POST /terminal/sessions`. Argv dirakit `runner/src/agent-cli.ts` (`agentFlags()`, murni & bertest), agen sesi disimpan di tmux `@hanoman_agent`. Padanan flag: `--model`→`-m`, `--effort`→`-c model_reasoning_effort`, `--dangerously-skip-permissions`→`--dangerously-bypass-approvals-and-sandbox`, `--settings`→`-c hooks.<Event>=<toml>` (+`--dangerously-bypass-hook-trust`, wajib — tanpa itu TUI mentok di "Hooks need review"). Model codex di `Setting.codex`; `HANOMAN_CODEX_BIN` cermin `HANOMAN_CLAUDE_BIN`. **Tanpa migration** (`Setting` kolom `Json`). Tiga perbedaan sadar: codex **tak punya event `Notification`** (marker keputusan pakai `Stop`+`UserPromptSubmit` → marker juga menyala saat sesi selesai wajar); codex **mendiamkan hook `type:"prompt"`** (mode goal jadi gate sh deterministik: phase file lengkap + plan tanpa `- [ ]`, exit 2 = continuation prompt), berpagar `GOAL_MAX_BLOCKS=25`; `armGoalInTui` (`/goal`) tetap khusus claude. **Gotcha wajib:** codex menolak jalan di direktori belum-dipercaya dan `-c projects."…".trust_level` TAK membukanya — `services/codex-trust.ts` menulis satu entri `[projects."<repoDir>"]` per project (worktree mewarisi trust root). Indikator limit (`services/limits.ts`) membaca kuota Anthropic → **khusus claude**.
- **Satu backlog = satu sesi** (ADR-0015): id sesi diturunkan deterministik dari id spec — menekan Start dua kali = **re-attach**, bukan spawn kedua.
- Sesi berjalan di worktree sendiri di `<repoDir>/.worktrees/<id>`, dibuat `--detach` dari `branchFrom` (default `main`); `baseSha` dicatat untuk rentang review (ADR-0030). Jenis sesi: **spec-flow** (feature/qa/audit), **reverse** (project-level), **prd**, **plain terminal** (claude di repoDir; atau shell mentah non-claude via `{shell:true}`, SPEC-236/ADR-0056), **integrate-conflict** (merge-<id>), **vps**. Flow **audit** (SPEC-237/ADR-0057) = audit-only: pipeline `Audit → Laporan`, hanya dokumen SoT (`research/audit-<id>-<slug>.md`), tanpa Execute; bisa dinaikkan jadi Finding QA.
- **Fase bukan proses melainkan giliran** dalam satu sesi: `runner/src/prompt.ts` `PIPELINES` mendefinisikan nama fase per flow; prompt menyuruh agen `echo "<Fase> done" >> $HANOMAN_PHASE_FILE`. Server membaca file append-only itu (`services/session-phases.ts`) untuk menurunkan fase aktif → `Stage`. Konteks terbawa antar fase karena semuanya satu sesi.
- **Kontrak otonomi** (ADR-0035): agen menembus batas antar-fase tanpa berhenti — checkpoint "review" milik skill superpowers **bukan** titik berhenti — dan hanya berhenti untuk bertanya di terminal saat butuh keputusan manusia sejati. Waspada: subagent async bisa bikin agen `end_turn` dan runner mengira fase selesai (fase jadi dangkal).
- **Model & effort per SESI** (SPEC-252/ADR-0061, mengamandemen ADR-0058): dipilih saat **Start** backlog lewat picker `StartSessionModal` (default = setelan global `model`/`effort`, `claude-opus-5` / `xhigh`), dikirim sebagai body opsional `model`/`effort` di `POST /terminal/sessions`, jadi argv `--model`/`--effort` saat sesi lahir → **andal penuh** (tak bergantung agen). Sesi tetap **satu proses, satu model seumur hidup**. Matrix per-fase lama (`phaseModels`, ADR-0058) **dicabut**: tak andal karena bergantung agen mengetik `/model`+`/effort` di batas fase, padahal agen menembus batas fase tanpa berhenti. Manusia tetap bisa `/model` manual di terminal. `steps` headless (ADR-0003) tetap usang.
- **Mode goal per sesi backlog** (SPEC-332/ADR-0073): sesi bisa lahir membawa gate `Stop` — `guardSettings` menyisipkan `hooks.Stop=[{type:"prompt",prompt:<kondisi>}]` ke `--settings` (mesin yang sama dipasang `/goal` Claude Code, tapi deterministik saat sesi lahir), plus keystroke `/goal` best-effort ke pane untuk visibilitas TUI. Kondisi default = DoD hanoman (semua fase tercatat di phase file, plan tak menyisakan `- [ ]`, push sukses) dan menuntut **bukti segar** karena evaluator hook `prompt` tak punya tool dan hanya membaca transkrip (yang bisa terpotong). Knob `Setting.goal` (default mati) + override `goal`/`goalCondition` saat Start; sesi scheduler mengikuti default global. **Bukan** guardrail deny — ADR-0037 tetap berlaku; interrupt manusia (`Esc`) bukan event Stop, jadi kendali tetap ada.
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

- **Tujuh model** (Postgres via Prisma): `Project`, `Spec`, `Setting`, `Notification`, `User`, `Session`, `Vps`. Tidak ada `Run` maupun `Trigger` — di-drop saat pindah ke sesi interaktif (ADR-0024). Model pendukung mencakup `DeviceToken`, **`AgentToken`** (kredensial AI agent + capability, SPEC-257/ADR-0065, server-local), `SessionResult`, sync (`SyncLog`/`SyncOutbox`/`SyncState`/`LocalBinding`/`RuntimeConfig`), error monitoring (`ErrorGroup`/`ErrorEvent`), Help Center (`Ticket`/`TicketAttachment`), VPS compliance (`VpsAuditSnapshot`/`VpsItemState`).
- Enum stage/source/priority disimpan sebagai **`String` + divalidasi zod** di `@hanoman/shared` (`enums.ts`), bukan enum Prisma.
- `Project.id` (slug) **kekal**, tak ada endpoint rename; `repoDir` OPSIONAL & tak disync. **`LocalBinding`** (`projectId → repoDir`, per-mesin, LOCAL-ONLY) meng-override path; `resolveRepoDir = binding ?? Project.repoDir` dipakai **seluruh** jalur baca (spawn/IDE/coverage/branches/specs/docs).
- `docStatus`/`coverage`/**Docs**/**PRD** **bukan kolom & tidak dipersist** — docs live dari disk via `git ls-files`, coverage diturunkan tiap `toProjectView` (ADR-0018), PRD = dokumen `docs/prd/<slug>.md` (ADR-0041). Tabel `DocFile` sudah di-drop (ADR-0011).
- **Jangan ubah skema tanpa migration + ADR.** Menambah model: hand-write `migration.sql` + `migrate deploy` per DB dengan env override (bukan `migrate dev` yang reset saat ada drift worktree). DB test `hanoman_test` butuh `migrate deploy` sendiri; jalankan `prisma generate` sesudah merge yang membawa model baru.
- DB dev berjalan di Docker; DB dijaga kosong untuk pemakaian nyata (tanpa demo seed). Test pakai `hanoman_test`, bukan `hanoman`/`hanoman_prod`.

## Aturan Dokumentasi & Alur

- **SoT sebagai konvensi** (ADR-0023, supersedes ADR-0001): `internal/docs/**` tetap Source of Truth — diperbarui dalam **commit yang sama** & ter-link di index (`internal/docs/README.md`). Tapi guardrail/Stop hook/gate Execute yang menegakkannya **dicabut** (SPEC-160). `hanoman docs scan` tetap ada sebagai laporan coverage read-only. **Jangan menambahkan gate kembali tanpa ADR baru.**
- **Nomor SPEC & ADR unik & imutable**; ADR usang tidak dihapus — ditandai statusnya. Sibling worktree bisa mereservasi nomor yang sama — **enumerasi lintas semua branch** sebelum mengklaim nomor (ADR-0021).
- **Alur fitur:** spec → plan → execute. **Alur QA:** audit → keputusan → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped`; keputusan dielicit lewat prompt & diambil agen (ADR-0020/0040). **Alur audit-only** (SPEC-237/ADR-0057): audit → laporan (dokumen), berhenti; tanpa perbaikan, promotable ke Finding QA.
- Prompt sesi memetakan fase → skill superpowers: Brainstorm→brainstorming, Audit→systematic-debugging, Plan→writing-plans, Execute→executing-plans + TDD + verification-before-completion.
- Ikuti design system di `internal/docs/design-system/**` (editorial, bone paper, brass accent).
- **Setiap task execute selesai:** centang checklist di file plan (`docs/superpowers/plans/**`, `- [ ]` → `- [x]`), lalu **test API-nya secara nyata di local** — boot server (`pnpm dev` atau `node server/dist/server.js`) dan curl endpoint yang tersentuh, jangan hanya andalkan unit test. Fix sampai hijau sebelum lanjut.
- TypeScript strict; test untuk setiap logika orchestrasi (trigger, queue, worktree, guardrail). Jalankan test repo dengan `vitest run --no-file-parallelism`; hindari env prod bocor (`env -u NODE_ENV -u DATABASE_URL pnpm test`).
- Definition of done: test hijau · docs tersentuh diperbarui + ter-link · diff bersih di worktree, siap push ke target branch.
