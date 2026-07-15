# ADR-0049 — Config runtime store + registry (settings ⊇ env non-bootstrap)

Status: Accepted · SPEC-215 · 2026-07-15

## Konteks
Env non-bootstrap (sync URL/token/tick, claude bin/config-dir, ssh, tick events, update-fetch,
repo root, tmux socket, kredensial) hanya dapat diubah lewat env + restart. SPEC-213 OQ-4 menaruh
config sync sebagai env-only. Operator butuh mengaturnya runtime dari dashboard (mis. input device
token sisi client) tanpa restart.

## Keputusan
Resolver terpusat `cfg(key) = override DB → env → default registry`. Registry (di `shared/`) jadi
sumber tunggal metadata. Store `RuntimeConfig` (KV, local-only, TAK PERNAH disync). Bootstrap
(`DATABASE_URL`/`TEST_DATABASE_URL`/`PORT`/`HOST`/`NODE_ENV`) tetap env-only (read-only di UI):
menghindari chicken-egg (store ada di dalam DB) & bind/port butuh restart. Kredensial disimpan
plaintext-at-rest (sejajar env; TLS via reverse-proxy ADR-0028), tak pernah balik plaintext ke
browser (GET termask). Ini SEBAGIAN menggantikan OQ-4; env tetap fallback bootstrap (backward-compatible).

## Konsekuensi
Pembacaan `process.env.*` non-bootstrap yang tersebar dipindah ke `cfg.*`. Kunci sync berlaku live
(re-init sync client); kredensial warisan di-mirror ke `process.env` agar proses claude baru mewarisi.
`RuntimeConfig` per-mesin, tak ikut sync (konsisten AC-30).
