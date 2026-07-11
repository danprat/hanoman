# Update README (SPEC-191) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** README.md yang jujur menggambarkan kondisi project existing + visual (diagram Mermaid + screenshot prod nyata) agar developer awam paham hanoman dalam < 1 menit.

**Architecture:** Rewrite README.md manual berdasar SoT (`internal/docs/architecture/stack.md`, `entrypoints/blueprint.md`). Diagram inline sebagai blok ```mermaid``` (render native GitHub). Screenshot di-capture dari prod live user (`http://127.0.0.1:8788/`) via Chrome headless + CDP, disimpan di `docs/assets/screenshots/`.

**Tech Stack:** Markdown, Mermaid (GitHub-native), Chrome headless + CDP (WebSocket bawaan Node, nol dependensi baru).

## Global Constraints
- Bahasa Indonesia (konsisten dgn seluruh project). Kode/perintah apa adanya.
- Klaim teknis WAJIB cocok SoT: **tanpa** Redis/queue/BullMQ/cron/webhook GitHub/`hanoman plan|execute` (semua dicabut ADR-0024).
- Nol dependensi npm baru. Tidak menyentuh `.prototype/**` (basi, out of scope).
- Screenshot dari data prod nyata → pindai secret/token yang tak sengaja kelihatan sebelum commit.
- Update `internal/docs`/index yang tersentuh dalam commit yang sama (konvensi CLAUDE.md).

---

### Task 1: Capture screenshot dari prod live

**Files:**
- Create: `docs/assets/screenshots/overview.png`, `backlog.png`, `terminal.png`, `docs-sot.png`
- Create (sementara, boleh dibuang): `scratchpad/shoot.mjs` (driver CDP)

**Interfaces:**
- Consumes: prod berjalan di `http://127.0.0.1:8788/`; DB prod `hanoman_prod` (docker `hanoman-db-1`).
- Produces: 4 PNG di `docs/assets/screenshots/` yang direferensi Task 2.

- [x] **Step 1: Cek reuse** — cari smoke/CDP script yang sudah ada (`git ls-files | grep -iE 'smoke|cdp|screenshot|puppeteer'`). Kalau ada yang bisa dipakai, pakai itu; kalau tidak, tulis `scratchpad/shoot.mjs`.
- [x] **Step 2: Mint sesi capture** — ambil `userId` dari prod: `docker exec hanoman-db-1 psql -U hanoman -d hanoman_prod -tAc 'select id from "User" limit 1'`. Cek kolom `Session` di `server/prisma/schema.prisma`. Generate token `randomBytes(32).base64url`, `id = sha256(token) hex`, insert baris `Session(id,userId,expiresAt=now()+1h)`.
- [x] **Step 3: Launch Chrome headless** — `--headless=new --remote-debugging-port=9222 --hide-scrollbars --window-size=1440,900`. Konek CDP via WebSocket; `Network.setCookie` name=`hn_session` value=token domain=`127.0.0.1` path=`/`; navigate `http://127.0.0.1:8788/`; tunggu app render (poll `#root` punya anak / teks "Overview").
- [x] **Step 4: Navigate + capture per layar** — app tak punya URL routing (state `section` in-app); klik item sidebar by-text via `Runtime.evaluate`. Untuk tiap {Overview, Backlog, Terminal, Docs·SoT}: klik nav, tunggu ~800ms, `Page.captureScreenshot` → tulis PNG.
- [x] **Step 5: Cleanup** — hapus baris `Session` yang di-mint (`delete from "Session" where id='<sha>'`), kill Chrome.
- [x] **Step 6: Verifikasi** — `file docs/assets/screenshots/*.png` (PNG valid, > 10KB), lalu **buka tiap PNG (Read)** dan pastikan: layar benar, ada data nyata, TAK ada secret/token kelihatan. Kalau capture gagal (auth/secure-cookie), fallback: minta user paste cookie `hn_session` atau kirim screenshot manual.
- [x] **Step 7: Commit** — `git add docs/assets/screenshots/*.png && git commit` (jangan commit `scratchpad/`).

### Task 2: Rewrite README.md

**Files:**
- Modify: `README.md` (tulis ulang penuh)

**Interfaces:**
- Consumes: PNG dari Task 1; fakta dari `internal/docs/architecture/stack.md` & `entrypoints/blueprint.md`.

- [x] **Step 1: Susun README** dengan struktur: judul+logo(`src/public/favicon.svg`)+tagline+hero(`overview.png`) → "Apa itu hanoman?" (2–3 kalimat) → diagram ```mermaid``` alur (human brief/QA → hanoman brainstorm→…→execute → sesi Claude di git worktree → docs SoT + dashboard) → galeri fitur (backlog/terminal/docs-sot + caption) → konsep inti (docs SoT by convention, human-in-control, worktree isolation, 1 backlog = 1 sesi) → quick start (prasyarat: Docker, Node ≥20, pnpm, tmux, `claude` login; `pnpm install`; `pnpm dev`; setup akun first-run) → struktur repo (shared/ server/ src/ runner/ cli/ internal/docs/ + link SoT index) → handoff Claude Code.
- [x] **Step 2: Verifikasi akurasi** — `grep -inE 'redis|bullmq|queue|cron|webhook|hanoman (plan|execute)' README.md` harus **kosong**. Path gambar cocok file yang ada. Mermaid fence tertutup benar.
- [x] **Step 3: Verifikasi link/render** — cek tiap link relatif menunjuk file yang ada (`internal/docs/README.md`, `AGENTS.md`, `CLAUDE.md`, screenshot). Render Mermaid mental-check sintaks (`graph TD` node/edge valid).
- [x] **Step 4: Commit** — `git add README.md`.

### Task 3: Sinkronisasi docs + verifikasi akhir

**Files:**
- Modify (jika perlu): `docs/superpowers/plans/2026-07-11-update-readme-spec-191.md` (centang), `internal/docs/**` bila ada doc yang klaimnya ikut berubah (kemungkinan tidak — README bukan bagian SoT index).

- [x] **Step 1:** Cek apakah ada doc di `internal/docs` yang menyebut/menggambarkan isi README lama yang kini berubah; kalau ada, selaraskan. (Kemungkinan besar tak ada — README di root, bukan di index SoT.)
- [x] **Step 2:** Centang semua `- [x]` di plan ini → `- [x]`.
- [x] **Step 3:** Verifikasi akhir end-to-end: README terbaca runtut, gambar tampil, klaim benar. Commit penutup.
