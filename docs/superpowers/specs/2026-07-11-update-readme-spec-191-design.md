# SPEC-191 · Update README — design

## Objective (MVP)
README.md yang jujur menggambarkan **kondisi project existing** dan membuat developer
awam paham "apa sih hanoman itu" dalam < 1 menit baca. Project ini akan open-source, jadi
README harus: benar (bukan arsitektur basi), visual (diagram + screenshot nyata), dan
mudah dijalankan (quick start yang beneran jalan).

## Masalah dengan README sekarang
README lama masih mendeskripsikan arsitektur yang **dicabut ADR-0024**:
- "queue (BullMQ/Redis)", "scheduler cron", "GitHub webhooks", "runner headless" — tak ada lagi.
- Handoff "`hanoman plan` → `hanoman execute`" — flow CLI itu dicabut; kerja dimulai dari dashboard.
- Tidak ada visual sama sekali.

Kondisi nyata (SoT `architecture/stack.md`, `entrypoints/blueprint.md`):
- Stack: React+Vite dashboard · Fastify server · Postgres (Prisma) · node-pty + **tmux** · xterm.js.
- Docker compose = **Postgres saja** (tanpa Redis).
- Eksekusi = **sesi `claude` interaktif** per backlog di **git worktree** terisolasi; fase
  (brainstorm→objective→spec→plan→execute) adalah *giliran* dalam satu sesi, bukan proses.
- Docs = Source of Truth **secara konvensi** (guardrail dicabut, ADR-0023).
- Auth cookie sesi opaque, bind 127.0.0.1.
- Nav app: Overview · Projects · Backlog · Terminal · IDE · VPS · Docs·SoT · Settings.

## Keputusan visual (dikonfirmasi human)
- **Kombinasi**: 1 diagram Mermaid (render native di GitHub, nol dependensi, tak bisa basi
  seperti raster) + beberapa **screenshot live** dari instance prod milik user di
  `http://127.0.0.1:8788/`.
- Screenshot diambil dari prod nyata (data asli milik user; user mengarahkan pemakaiannya).
  Layar Terminal (sesi claude live) **ikut** di-screenshot dari prod, bukan disimulasikan.

## Bentuk deliverable
1. **README.md** ditulis ulang (bahasa Indonesia, konsisten dgn seluruh project), struktur:
   - Judul + logo (favicon.svg) + tagline + **hero screenshot** (Overview).
   - "Apa itu hanoman?" — 2–3 kalimat bahasa manusia.
   - **Diagram Mermaid** alur: human brief/QA → hanoman (brainstorm→…→execute) → sesi Claude
     Code di git worktree → docs SoT + dashboard memantau.
   - **Galeri fitur** (screenshot + caption): Backlog (stage progress), Terminal (sesi live),
     Docs·SoT.
   - Konsep inti (docs SoT by convention, human-in-control, worktree isolation, satu backlog =
     satu sesi).
   - Quick start yang benar: prasyarat (Docker, Node ≥20, pnpm, tmux, `claude` CLI login) →
     `pnpm install` → `pnpm dev` → setup akun first-run.
   - Struktur repo (shared/ server/ src/ runner/ cli/ internal/docs/) + link ke SoT index.
   - Cara kerja singkat + handoff ke Claude Code (baca `internal/docs/README.md`, `AGENTS.md`,
     `CLAUDE.md`; mulai dari dashboard).
2. **Screenshot** disimpan di `docs/assets/screenshots/*.png`, direferensi README dgn path relatif.
   Set minimal (lazy, fokus cerita): `overview.png`, `backlog.png`, `terminal.png`, `docs-sot.png`.
3. **Diagram** ditulis inline sebagai blok ```mermaid``` di README (bukan file/asset terpisah).

## Cara ambil screenshot (Execute)
Prod kena gate auth (sesi opaque, `sha256(token)` di DB — token mentah hanya di cookie browser).
Untuk capture headless: mint sesi lokal sementara untuk user prod yang ada (insert baris
`Session` dgn token yang kita kontrol), set cookie `hn_session` di Chrome headless via CDP,
capture tiap layar, lalu **hapus** sesi itu. Semua lokal, reversible. Bila cookie `secure`
menghalangi http, fallback: minta user paste cookie / user capture sendiri.
Privacy: data nyata masuk README publik — pindai frame untuk secret/token yang tak sengaja
kelihatan sebelum commit; kalau ragu, tanya user.

## Non-goals (YAGNI)
- Tidak menyegarkan `.prototype/**` (prototype basi, di luar scope).
- Tidak menambah GIF/animasi (screenshot statis cukup; GIF headless mahal & flaky).
- Tidak menerjemahkan README ke Inggris (seluruh project berbahasa Indonesia).
- Tidak menambah tool/asset-pipeline baru untuk gambar.

## Verifikasi
- README render benar (Mermaid + gambar) — cek path gambar ada di repo.
- Klaim teknis README cocok dgn SoT (`stack.md`, `blueprint.md`) — tak ada penyebutan
  Redis/queue/cron/webhook/`hanoman plan|execute`.
- `docs/superpowers` index & `internal/docs` yang tersentuh (jika ada) diperbarui commit yang sama.
