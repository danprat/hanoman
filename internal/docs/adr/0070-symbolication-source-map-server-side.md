# ADR-0070 — Symbolication source-map server-side (parity Sentry)

**Status:** accepted · **Tanggal:** 2026-07-21 · **Spec:** SPEC-276
**Terkait:** [ADR-0060](0060-error-monitoring-ingest-ber-dsn.md) (**melengkapi** — source-map browser
yang di-defer post-MVP kini diimplementasikan), [ADR-0063](0063-hanoman-sdk-npm-package.md)
(`hanoman-sdk`), [ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (tanpa queue/Redis — symbolication
lazy, bukan worker), [ADR-0062](0062-help-center-tiket-publik-triase.md) (pola penyimpanan byte di
`HANOMAN_UPLOAD_DIR`), [ADR-0066](0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md)
(grup error record-sync — field baru additive, byte/map tak disync)

## Konteks

Audit SPEC-275 (`research/audit-spec-275-stack-trace-source-map-parity.md`) menegaskan: pipeline error
monitoring menyimpan & menampilkan stack **mentah**. Untuk bundle browser produksi (Vite: minified +
content-hash) stack menunjuk artifact hasil-build (`index-4f3a2b.js:1:88421`), bukan `.tsx` sumber —
sulit dibaca/di-solve. Sentry menutup gap ini dengan **symbolication source-map**. ADR-0060 sengaja
men-defer source-map browser ke post-MVP (PRD Non-goals, Open Q#5). Operator memutuskan mengangkatnya
sekarang → **full symbolication**.

Audit juga menemukan **bug asli** (Temuan B): `topFrame` di `error-fingerprint.ts` memuat basename
bundle ber-content-hash → fingerprint beda tiap deploy → grup pecah tiap rilis. Diperbaiki sekalian.

## Keputusan

Frame terstruktur end-to-end + upload source-map per `release` + symbolication server-side lazy saat
buka detail grup, dengan context lines dan penanda `in_app`.

### 1. Frame terstruktur (SDK → server)
- SDK mengurai `error.stack` → `frames[]` (`function/filename/lineno/colno/in_app`), mengirimnya
  **bersama** `stack` string (opsional → kompatibel mundur). `error.cause` di-unwrap dan dirangkai ke
  belakang stack string ("Caused by: …") — nol biaya skema/kontrak. SDK tetap **dependency-free**.
- `zIngestPayload += frames?: zStackFrame[]`. Frame invalid di-drop diam-diam (tak menggagalkan ingest).

### 2. Upload & simpan source-map
- **`POST /api/ingest/:slug/sourcemaps?key=…`** — auth = **DSN ingest key** yang sama (bukan cookie;
  di prefix `/api/ingest` yang bypass gate). Body `{ release, artifacts:[{ filename, map, debugId? }] }`.
- Byte `.map` disimpan di `HANOMAN_UPLOAD_DIR` (pola `uploads.ts`: server-local, di luar repoDir,
  **tak** ikut record-sync — cermin `TicketAttachment` biner & `ErrorEvent`). Metadata di model baru
  **`SourceMapArtifact`** (`@@unique([projectId, release, filename])`), **tak** disync.
- **Keying utama = `release` + basename artifact** (pola Sentry pra-debug-id). `debugId` disediakan
  opsional untuk masa depan. Retensi: prune keep-N-release terbaru per project saat upload.

### 3. Symbolication lazy (display-time)
- `symbolicate.ts` pakai **`@jridgewell/trace-mapping`** (pure-JS, dipakai Vite/Rollup) di server.
  `GET /errors/:id` memetakan `ErrorGroup.sampleFrames` (raw) → posisi sumber via map yang tersedia
  **saat itu**, plus context lines (`sourceContentFor`). Frame mentah tersimpan immutable; hasil
  symbolication murni turunan → **tak ada kolom cache / invalidasi**.
- **Gotcha kolom:** stack V8 melaporkan `line:col` 1-based; source-map spec 0-based → resolver
  mengurangi 1 pada kolom sebelum `originalPositionFor`.
- **Kenapa display-time, bukan worker/ingest:** menghindari race "error tiba sebelum map ter-upload"
  (map di-upload saat deploy, grup dibuka belakangan) & menjaga ingest cepat; patuh ADR-0024 (tanpa
  queue). Detail hanya di-fetch saat grup dibuka (tak di-poll) → parse map per buka = murah.

### 4. Fix Temuan B (fingerprint stabil lintas deploy)
- `topFrame` menormalkan content-hash pada basename (`index-4f3a2b.js` → `index.js`); bila `frames[]`
  ada, fingerprint memakai top frame `in_app` (filename ternormalisasi + fungsi, tanpa `line:col`).

## Konsekuensi

- **Data model additive** (aman VPS live, migrate deploy): model `SourceMapArtifact`; kolom
  `ErrorEvent.frames`, `ErrorGroup.sampleFrames` + `release`; back-relation `Project.sourceMaps`.
  Grup error yang tersync (ADR-0066) tak berubah kontrak — field baru diabaikan konsumen lama.
- **Dependency server baru:** `@jridgewell/trace-mapping`. SDK tetap tanpa dependency.
- **Parity tercapai untuk browser & Node**: stack minified → `.ts/.tsx` + context line + `in_app`;
  Temuan B tuntas (grup tak lagi pecah tiap deploy).
- **Batasan (di luar scope):** tak ada build-plugin injeksi `debug_id`, tak ada uploader CLI penuh
  (cukup snippet curl/Node di README), symbolication tak dipersist (dihitung ulang tiap buka detail),
  local→hub sync source-map tak ada (server-local by design). Byte/map & metadata artifact tak disync.
- **Keamanan:** upload auth DSN key + cap ukuran; `storageKey` opaque (uuid) tak pernah dari input
  user → tanpa path traversal; map tak diekspos publik (hanya dipakai server saat symbolicate).
