# Perbaharui Source of Truth (SPEC-174) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bikin `internal/docs/**` kembali jadi Source of Truth yang akurat & rapi terhadap codebase — buang artefak usang, perbaiki klaim yang salah, sinkronkan index.

**Architecture:** Murni edit dokumentasi. Tidak menyentuh kode. Verifikasi = link-integrity + coverage-scan hijau + grep sanity, bukan unit test. Basis kebenaran: `server/prisma/schema.prisma`, route di `server/src/routes/*`, `server/src/services/pty.ts`, `runner/src/*`, dan ADR terbaru (0023/0024).

**Tech Stack:** Markdown. Verifikasi lewat `grep`, script cek link Node kecil, dan boot server Fastify + `curl GET /api/projects/:id/docs`.

## Global Constraints

- Bahasa dokumen: **Indonesia** (ikuti gaya file sekitar).
- Kebenaran mekanisme (verbatim): server **Fastify**; realtime = **WebSocket khusus terminal + HTTP polling** (BUKAN SSE); **tidak ada** BullMQ/Redis/queue/worker/scheduler/webhook; **tidak ada** model `Run`/`Trigger`; **7 model** Prisma (Project, Spec, Setting, Notification, User, Session, Vps); eksekusi = **sesi `claude` interaktif di tmux** (`server/src/services/pty.ts`, socket `-L hanoman`), fase = **giliran** via `$HANOMAN_PHASE_FILE`; biaya = estimasi, **tidak ada `dailyBudget` aktif**; limit dari OAuth usage API langsung.
- Route nyata (satu-satunya yang boleh muncul di api-contract): `health, auth, projects, specs, docs, terminal, vps, fs, settings, notifications, limits`.
- Jangan sentuh file di luar `internal/docs/**` (kecuali plan/spec superpowers ini). `AGENTS.md`/`CLAUDE.md` root = follow-up, bukan scope.
- `docsDir` = `internal/docs`; index = `internal/docs/README.md`. Coverage = % kategori yang seluruh `.md`-nya reachable dari index. **Jangan sampai ada kategori yang markdown-nya jadi tak reachable** (turunkan coverage).

---

### Task 1: Hapus 25 artefak `operations/spec-*` + perbaiki link inbound

**Files:**
- Delete: semua `internal/docs/operations/spec-*-{objective,audit,spec}.md` (25 file)
- Modify: `internal/docs/adr/0018-branch-adalah-properti-backlog-item.md:4` (link ke `../operations/spec-143-...`)
- Modify: `internal/docs/adr/0018-coverage-nilai-turunan.md:11` (link ke `../operations/spec-141-...`)

**Interfaces:**
- Produces: `operations/` tinggal 4 file hidup (`roadmap`, `gtm`, `production`, `agent-documentation-workflow`). Task 11 (index) mengandalkan ini.

- [x] **Step 1: Konfirmasi daftar file yang dihapus**

Run: `ls internal/docs/operations/spec-*.md | wc -l` → Expected: `25`

- [x] **Step 2: Hapus artefak**

```bash
git rm internal/docs/operations/spec-*.md
```

- [x] **Step 3: Perbaiki 2 link ADR yang menunjuk file terhapus**

Di `adr/0018-branch-adalah-properti-backlog-item.md` baris Konteks: ganti `[SPEC-143 objective](../operations/spec-143-select-branch-in-backlog-objective.md)` → teks polos `SPEC-143` (buang link markdown).
Di `adr/0018-coverage-nilai-turunan.md`: ganti `[SPEC-141](../operations/spec-141-overview-coverage-realtime-objective.md)` → teks polos `SPEC-141`.

- [x] **Step 4: Verifikasi tak ada tautan tersisa ke file terhapus**

Run: `grep -rnE "operations/spec-[0-9]" internal/docs --include='*.md'`
Expected: **kosong** (no output).

- [x] **Step 5: Verifikasi hanya 4 file ops hidup**

Run: `ls internal/docs/operations/` → Expected: `agent-documentation-workflow.md  gtm.md  production.md  roadmap.md`

---

### Task 2: Resolusi tabrakan nomor ADR (renumber → 0032, 0033)

**Files:**
- Rename: `adr/0018-branch-adalah-properti-backlog-item.md` → `adr/0032-branch-adalah-properti-backlog-item.md`
- Rename: `adr/0030-notifikasi-backlog-selesai.md` → `adr/0033-notifikasi-backlog-selesai.md`
- Modify: setiap file yang mereferensi `ADR-0018` (branch) / `ADR-0030` (notifikasi) — a.l. judul di dalam file, `architecture/data-model.md`, `architecture/api-contract.md`, `server/prisma/schema.prisma` **hanya bila menyebut ADR-0018/0030 branch/notif** (schema komentar SPEC-143 tak sebut ADR — cek dulu; jangan ubah kode selain komentar bila perlu).

**Interfaces:**
- Produces: nomor ADR unik 0001–0033 tanpa duplikat. `0018` = coverage-nilai-turunan; `0030` = spec-menyimpan-base-head-sha; `0032` = branch; `0033` = notifikasi.

- [x] **Step 1: Petakan referensi inbound sebelum rename**

Run:
```bash
grep -rnE "ADR[- ]?0018|0018-branch|ADR[- ]?0030|0030-notifikasi" internal/docs server/prisma --include='*.md' --include='*.prisma'
```
Catat tiap hit: mana yang bermakna **branch** (→0032) vs **coverage** (tetap 0018); mana **notifikasi** (→0033) vs **base/head sha** (tetap 0030).

- [x] **Step 2: Rename kedua file**

```bash
git mv internal/docs/adr/0018-branch-adalah-properti-backlog-item.md internal/docs/adr/0032-branch-adalah-properti-backlog-item.md
git mv internal/docs/adr/0030-notifikasi-backlog-selesai.md internal/docs/adr/0033-notifikasi-backlog-selesai.md
```

- [x] **Step 3: Update judul & self-refs di dalam kedua file**

`0032-...`: judul `# ADR-0018 — Branch...` → `# ADR-0032 — Branch...`. `0033-...`: judul `# ADR-0030 — Notifikasi...` → `# ADR-0033 — Notifikasi...`.

- [x] **Step 4: Update referensi inbound (branch→0032, notif→0033)**

Ubah tiap hit dari Step 1 yang bermakna branch/notif. Contoh yang diketahui: `architecture/data-model.md` link `[ADR-0018](../adr/0018-branch-adalah-properti-backlog-item.md)` → `[ADR-0032](../adr/0032-branch-adalah-properti-backlog-item.md)`; `data-model.md` "Notification (SPEC-180, [ADR-0030](...notifikasi...))" → `[ADR-0033](../adr/0033-notifikasi-backlog-selesai.md)`. **Jangan** ubah `ADR-0018` yang bermakna coverage atau `ADR-0030` yang bermakna base/head sha.

- [x] **Step 5: Verifikasi tak ada nama file ADR duplikat & tak ada link ke file lama**

Run:
```bash
ls internal/docs/adr/ | sed -E 's/^([0-9]+).*/\1/' | sort | uniq -d
grep -rnE "0018-branch|0030-notifikasi" internal/docs --include='*.md'
```
Expected: kedua perintah **kosong** (tak ada nomor duplikat, tak ada link ke path lama).

---

### Task 3: Anotasi ADR superseded + link ADR-0025 orphan

**Files:**
- Modify (header status): `adr/0001-*.md`, `adr/0005-*.md`, `adr/0006-*.md`, `adr/0007-*.md`, `adr/0009-*.md`, `adr/0010-*.md`, `adr/0012-*.md`, `adr/0017-*.md`, `adr/0022-*.md`

**Interfaces:**
- Produces: tiap ADR usang punya baris status jelas. Task 11 menandai hal yang sama di index.

- [x] **Step 1: Tambah baris status superseded**

Di baris `**Status:**` tiap file, tambahkan penanda (pertahankan tanggal asli):
- 0001 → `superseded by ADR-0023`
- 0005 → `superseded by ADR-0024`
- 0006 → `de-facto obsolete (ADR-0024 buang webhook GitHub)`
- 0007 → `de-facto obsolete (ADR-0024 drop model Run)`
- 0009 → `historis per ADR-0023`
- 0010 → `partially superseded by ADR-0024 (gate PreToolUse tetap)`
- 0012 → `superseded by ADR-0024`
- 0017 → `superseded by ADR-0024`
- 0022 → `superseded by ADR-0024`

- [x] **Step 2: Verifikasi**

Run: `grep -lE "superseded|de-facto obsolete|historis per ADR" internal/docs/adr/000*.md internal/docs/adr/001*.md internal/docs/adr/002*.md | wc -l`
Expected: `9`

---

### Task 4: Rewrite `architecture/stack.md`

**Files:**
- Modify: `internal/docs/architecture/stack.md` (rewrite penuh)

- [x] **Step 1: Rewrite**

Tabel stack: hapus baris Queue(BullMQ+Redis), Scheduler(cron), Webhooks(GitHub App), dan ubah baris Agent (headless→interaktif). Tambah/pertahankan: React+TS+Vite; realtime = WebSocket (terminal) + HTTP polling; Server Fastify; DB Postgres(Prisma); Terminal node-pty + tmux; web xterm.js; VCS git worktree; Agent = `claude` interaktif via tmux + hooks.
Diagram sistem: ganti kotak Queue/Runner/Scheduler/Webhook dengan: `Dashboard (React) ──WS(terminal)+poll──► Server (Fastify) ├─ PTY/tmux (sesi claude per backlog, worktree) ├─ VPS monitor (setInterval) └─ Postgres (Prisma)`.
Bagian "Runner": ganti jadi "Eksekusi" — `runner/src` = library (git worktree, prompt, safety); eksekusi nyata = `server/src/services/pty.ts` spawn `claude` interaktif di tmux; satu backlog = satu sesi (ADR-0015); fase = giliran via `$HANOMAN_PHASE_FILE`; `--dangerously-skip-permissions` + PreToolUse guard (`runner/src/safety.ts`); biaya estimasi (ADR-0012), tak ada dailyBudget.

- [x] **Step 2: Verifikasi tak ada istilah usang aktif**

Run: `grep -nE "BullMQ|Redis|SSE|Webhook|Scheduler|headless|claude-cli|turns\.ts" internal/docs/architecture/stack.md`
Expected: **kosong** (atau hanya dalam konteks historis eksplisit — idealnya kosong).

---

### Task 5: Rewrite `architecture/data-model.md`

**Files:**
- Modify: `internal/docs/architecture/data-model.md`

**Interfaces:**
- Consumes: schema nyata dari `server/prisma/schema.prisma` (7 model).

- [x] **Step 1: Hapus seksi `Run` dan `Trigger` sepenuhnya**

Buang blok `## Run` (id RUN-n, status, phases[], worker, reconcileRuns, Redis) dan `## Trigger`.

- [x] **Step 2: Selaraskan model tersisa ke schema**

Project: `id, name, desc, kind, repoDir?, stack, createdAt` + `specs[]`; `docStatus`/`coverage` diturunkan (ADR-0018), bukan kolom; buang penyebutan `repoUrl` & FK `Run`/`Trigger` (jadikan `Spec` saja). Spec: sesuai (id SPEC-n, projectId, title, source, stage, priority, author, objective, payload?, branchFrom?, baseSha?, headSha?) — perbaiki referensi ADR (branch→ADR-0032). Setting: buang `dailyBudget` dari daftar kolom aktif (sebut sebagai tak dipakai bila perlu). User/Session/Notification/Vps: pertahankan (sudah benar), perbaiki nomor ADR notifikasi → ADR-0033.

- [x] **Step 3: Verifikasi**

Run: `grep -nE "^## (Run|Trigger)\b|RUN-n|reconcileRuns|repoUrl|dailyBudget" internal/docs/architecture/data-model.md`
Expected: **kosong**. Dan: `grep -cE "^## (Project|Spec|Setting|Notification|User|Session|Vps|Docs)" internal/docs/architecture/data-model.md` ≥ 7.

---

### Task 6: Rewrite `architecture/api-contract.md`

**Files:**
- Modify: `internal/docs/architecture/api-contract.md`

**Interfaces:**
- Consumes: route nyata dari `server/src/routes/*` + `shared/src/api.ts`.

- [x] **Step 1: Hapus blok route mati**

Buang `## Runs` (semua `/runs/*`), `## Triggers`, `## Webhook`. Ganti header "REST + SSE" → "REST + WebSocket (terminal) + polling".

- [x] **Step 2: Tambah/rapikan route nyata yang hilang**

Pastikan terdokumentasi: `GET /limits`; `GET /fs/browse?path=`; `GET /specs/:id/docs` + `/specs/:id/docs/*`; `GET /terminal/sessions/:id/phases`. Perbaiki `DELETE /projects/:id` (409 bila ada **sesi tmux aktif**, bukan "run queued/running"). Pertahankan blok Auth, Projects, Specs(+integrate/review), Docs, Terminal, VPS, Notifications, Settings yang sudah benar.

- [x] **Step 3: Verifikasi**

Run: `grep -nE "/runs|/triggers|/webhooks|SSE|BullMQ" internal/docs/architecture/api-contract.md`
Expected: **kosong**.
Run: `grep -cE "GET|POST|PATCH|DELETE|PUT" internal/docs/architecture/api-contract.md` → ada isi (>20).

---

### Task 7: Rewrite `architecture/nfr.md`

**Files:**
- Modify: `internal/docs/architecture/nfr.md`

- [x] **Step 1: Buang klaim queue/dailyBudget**

Hapus baris `Biaya — hentikan enqueue baru bila dailyBudget` dan `Konkurensi — ... → queued`. Ganti dengan realita: realtime terminal <1 dtk; interupsi via tmux (kirim ke sesi) ≤2 dtk; isolasi worktree per backlog; durabilitas Postgres (state) + tmux (sesi hidup lintas restart API, ADR-0016).

- [x] **Step 2: Verifikasi**

Run: `grep -nE "dailyBudget|enqueue|queued|BullMQ" internal/docs/architecture/nfr.md` → Expected: **kosong**.

---

### Task 8: De-stale `frontend/frontend-implementation.md`

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md`

**Interfaces:**
- Consumes: screen nyata dari `src/src/screens/*`, client `src/src/api/*`.

- [x] **Step 1: Buang konsep Run mati**

Hapus kolom board "Failed", retry `re-enqueue`, SSE `GET /runs/:id/log`, state run `queued|running|paused`. Ganti ke: transport = WebSocket terminal (xterm.js) + HTTP polling; screen nyata (Overview, Projects, ProjectDetail, Backlog dengan stage bar dari phase file, Terminal multi-pane tmux, DocsWorkspace, Review, SpecDocsModal, Settings, Vps, Auth, LimitIndicator); tak ada halaman "Runs" — monitoring lewat Terminal + Backlog stage.

- [x] **Step 2: Verifikasi**

Run: `grep -nE "/runs/:id/log|re-enqueue|queued\|running\|paused|Failed column|SSE" internal/docs/frontend/frontend-implementation.md`
Expected: **kosong** (istilah run-state mati hilang).

---

### Task 9: De-stale dokumen `operations/` hidup

**Files:**
- Modify: `internal/docs/operations/production.md`
- Modify: `internal/docs/operations/roadmap.md`
- Modify: `internal/docs/operations/agent-documentation-workflow.md`

- [x] **Step 1: `production.md`**

Buang stack Redis/worker/`RUN_ID_FLOOR`/db-index-Redis. Gambarkan prod nyata: Postgres (DATABASE_URL), server Fastify bind `127.0.0.1:8787` + reverse proxy TLS (Caddy), tmux dependency, dua interval VPS (health 5 mnt / audit 24 jam), env credential Claude (`CLAUDE_CODE_OAUTH_TOKEN`). Prod berdampingan dev = beda DATABASE_URL + port.

- [x] **Step 2: `roadmap.md`**

Buang baris "v1.0 = runner Claude Code headless nyata, webhook GitHub, scheduler" (arah dibuang). Rapikan jadi status sekarang (sesi interaktif, auth, VPS, review/integrate, notifikasi, limits) + backlog nyata.

- [x] **Step 3: `agent-documentation-workflow.md`**

Buang seksi `## GitHub App + webhooks (SPEC-006)` dan `## Worker credentials` yang menyebut worker/headless; selaraskan `## Runner` → sesi interaktif tmux (bukan `.worktrees/<run-id>` headless + push branchTo otomatis). Pertahankan: fase→skill mapping, from-scratch/reverse, guardrail dicabut.

- [x] **Step 4: Verifikasi**

Run: `grep -rnE "Redis|BullMQ|RUN_ID_FLOOR|webhook|headless|worker" internal/docs/operations/*.md`
Expected: **kosong** atau hanya penyebutan historis eksplisit (idealnya kosong di 3 file ini).

---

### Task 10: Sweep istilah usang di dokumen pendukung

**Files:**
- Modify: `entrypoints/blueprint.md`, `entrypoints/prd.md`, `entrypoints/frd.md`, `entrypoints/brd.md`, `entrypoints/rd.md`
- Modify: `requirements/prd.md`
- Modify: `product/blueprint.md`, `product/scope-principles.md`, `product/onboarding.md`
- Modify: `business/brd.md`, `business/pricing-rationale.md`
- Modify: `security/security-standard.md`

- [x] **Step 1: Buang bahasa "SoT ditegakkan/suci" (kontradiksi ADR-0023)**

`product/blueprint.md` pilar "SoT ditegakkan" → "SoT konvensi (ditampilkan & bisa diedit; tak lagi digerbang mesin, ADR-0023)". `product/scope-principles.md` "SoT suci … execute di atas docs stale ditolak" → konvensi. `entrypoints/brd.md` goal "0 execute pada docs stale" → aspirasi konvensi. `operations/gtm.md` "tak ada execute di atas docs stale" → konvensi. (gtm juga disweep di sini walau di operations/.)

- [x] **Step 2: Buang `dailyBudget`/"anggaran harian" sebagai kontrol aktif**

`requirements/prd.md` §7 (buang "anggaran harian"; sisakan model per step + konkuren + notif). `business/pricing-rationale.md` (biaya = token; kendali = model per step, bukan anggaran harian yang sudah tak ada). `business/brd.md` ("Biaya terkontrol (model per step)"). `security/security-standard.md` bullet terakhir (buang "batas harian mencegah biaya liar").

- [x] **Step 3: Selaraskan "Run"/"Trigger" → sesi/terminal**

`entrypoints/prd.md` kapabilitas "4. Runs" → "Terminal & sesi (monitor sesi claude live: stage, diff, steer via tmux)", "6. Triggers" → buang/ganti (tak ada trigger; sebut auto-start sesi bila relevan). `entrypoints/frd.md` seksi Triggers → buang; seksi Runs → sesi. `entrypoints/blueprint.md` "dipicu oleh trigger (schedule/commit/manual/interval)" + tabel doc "spec/run/trigger" → sesuaikan (sesi interaktif; tabel doc tunjuk data-model tanpa run/trigger). `entrypoints/rd.md` daftar fitur "Runs/Triggers" → sesi/terminal. `requirements/prd.md` §4 Runs → Terminal/sesi, §6 Triggers → buang. `product/onboarding.md` "Hubungkan GitHub (commit-trigger)" & "Set trigger" → alur nyata (tambah project → buka backlog → start sesi).

- [x] **Step 4: Verifikasi**

Run:
```bash
grep -rniE "dailyBudget|anggaran harian|BullMQ|Redis|webhook|commit-trigger" internal/docs/entrypoints internal/docs/requirements internal/docs/product internal/docs/business internal/docs/security
```
Expected: **kosong** (atau hanya konteks jelas-historis). "SoT ditegakkan/suci" sebagai gerbang mekanis tak tersisa.

---

### Task 11: Rebuild `README.md` (index)

**Files:**
- Modify: `internal/docs/README.md`

**Interfaces:**
- Consumes: seluruh perubahan Task 1–10 (delete, rename, status). Ini task index — jalankan setelah semua rename/delete final.

- [x] **Step 1: Hapus 25 baris `spec-*` di seksi operations**

Sisakan: roadmap, gtm, agent-documentation-workflow, production.

- [x] **Step 2: Rapikan daftar ADR**

Urutkan menurun 0033→0001 rapi (tanpa lompatan acak). Tambah **0025** (VPS) yang hilang. Ganti entri lama: 0018-branch → **0032**, 0030-notifikasi → **0033**; sisakan 0018 = coverage, 0030 = base/head sha. Tandai yang superseded (`— superseded by 0023/0024`, `historis`, `de-facto obsolete`) supaya beda dari yang current. Tak ada nomor ganda.

- [x] **Step 3: Sinkronkan seksi lain**

Perbaiki catatan `production` (buang "Redis db index, RUN_ID_FLOOR"). Pastikan semua kategori (entrypoints/product/business/requirements/research/architecture/adr/operations/security/design-system/frontend) tertaut & tiap file di disk tertaut.

- [x] **Step 4: Verifikasi tak ada nomor ADR ganda di index**

Run: `grep -oE "adr/[0-9]{4}" internal/docs/README.md | sort | uniq -d`
Expected: **kosong**.

---

### Task 12: Verifikasi menyeluruh (link + coverage + grep)

**Files:** none (verifikasi).

- [x] **Step 1: Link integrity — semua tautan relatif resolve**

Tulis script Node kecil di scratchpad yang, untuk tiap `.md` di `internal/docs/**`, ekstrak `](...md)` relatif dan pastikan file target ada. Jalankan.
Expected: **0 broken link**.

- [x] **Step 2: Tak ada file `.md` orphan (tak tertaut dari index)**

Bandingkan `git ls-files 'internal/docs/**/*.md'` dengan himpunan file reachable dari `internal/docs/README.md` (ikuti link transitif).
Expected: setiap file reachable (selain README sbagai root) — **0 orphan**.

- [x] **Step 3: Coverage scan hijau (test API nyata di local)**

Boot server terhadap DB throwaway termigrasi (ikuti pola `hanoman-live-smoke-dedicated-db`; **jangan** pakai `hanoman_test` atau port 8787). Daftarkan project `repoDir` = repo ini, lalu:
```bash
curl -s "http://127.0.0.1:<port>/api/projects/<id>/docs" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("coverage",j.coverage);})'
```
Expected: `coverage` = 100 (semua kategori berskor reachable). Bila <100, temukan kategori yang markdown-nya tak reachable dan taut dari index.

- [x] **Step 4: Grep sanity global**

Run: `grep -rniE "BullMQ|Redis|/runs|/triggers|/webhooks|dailyBudget|reconcileRuns|RUN-n" internal/docs --include='*.md'`
Expected: hanya hit di ADR historis (0005/0010/0012/0017/0022/0006/0007) yang memang mencatat mekanisme lama — **tidak ada** klaim sebagai mekanisme aktif di dokumen arsitektur/entrypoint/requirements/product/operations hidup.

- [x] **Step 5: Update checklist plan ini → semua `- [x]`**

Pastikan tiap kotak task 1–12 tercentang sebelum menulis `Execute done` ke `$HANOMAN_PHASE_FILE`.

---

## Self-Review

**Spec coverage:** design A(arch rewrite)→Task 4–7; B(de-stale pendukung)→Task 8,9,10; C(ADR)→Task 2,3; D(fix link)→Task 1; E(index)→Task 11; verifikasi→Task 12. Keputusan scope (hapus spec-*, keep stub)→Task 1 & Task 10. Semua tercakup.

**Placeholder scan:** tiap task punya file eksplisit, string usang konkret yang dibuang, fakta pengganti verbatim di Global Constraints, dan perintah verifikasi. Tak ada "TBD/dll".

**Type consistency:** penomoran ADR konsisten (0018=coverage, 0030=base/head, 0032=branch, 0033=notif) dipakai sama di Task 2, 5, 11. Route list sama di Global Constraints & Task 6.
