# ADR-0043 — Sync server↔client = server-to-server, peran ditentukan konfigurasi

Status: diterima · SPEC-213 · 2026-07-14
> Catatan: keputusan "base URL & device token = env-only sisi-server" (OQ-4) **sebagian
> digantikan** oleh ADR-0049 (SPEC-215) — knob sync kini dapat diatur runtime via Settings
> (override DB → env → default). Env tetap fallback bootstrap; peran hub/client tak berubah.

## Konteks
hanoman monolit satu-host. PRD "Server & Client Side" ingin satu instance jadi hub data
agregat di VPS dan tiap developer menjalankan instance lokal penuh yang sinkron. Pertanyaan:
di mana sync berjalan (browser lintas-origin vs proses Node), dan bagaimana peran dibedakan.

## Keputusan
Satu codebase, dua **peran** ditentukan env, bukan dua binari:
- **Hub**: instance tanpa `SYNC_SERVER_URL`. Menerima push, melayani pull, siar changefeed.
- **Client**: instance dengan `SYNC_SERVER_URL` + `SYNC_DEVICE_TOKEN`. Browser developer tetap
  bicara **same-origin ke instance lokalnya**; **proses Node lokal** yang menyinkron ke hub
  (server-to-server) via `Authorization: Bearer <device-token>`.
Isi file dokumen (git-tracked) mengalir lewat **git remote** (3-way merge existing), BUKAN
lewat sync API. Sync API hanya mengurus record (Project metadata, Spec, Vps, SessionResult).

## Alasan
- Browser tak pernah lintas-origin → nol masalah CORS/cookie (OQ-4). Auth mesin = token (OQ-7).
- Client = instance penuh (bukan thin client) → seluruh fitur ada di kedua sisi (AC-25).
- git sudah punya 3-way merge → tak perlu custom line-merge engine (AC-14).

## Konsekuensi
- Base URL hub = setting sisi-server (`SYNC_SERVER_URL`), bukan konfigurasi frontend.
- Prod single-host sekarang = hub tanpa client; client opt-in (additive, backward-compatible).
- Sync record ≠ sync isi file: konten PRD tetal butuh git remote yang tercatat di Project.
