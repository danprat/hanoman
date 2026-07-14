# ADR-0047 — Ringkasan hasil sesi = SessionResult append-only, whitelist field, purge manual

Status: diterima · SPEC-213 · 2026-07-14

## Konteks
Hub harus mengumpulkan "apa yang terjadi" lintas device: perpindahan stage, commit, PR — tanpa
menyerap transkrip PTY mentah atau kredensial (AC-20/21). PRD OQ-8: model baru atau perluasan?

## Keputusan
Model Prisma baru `SessionResult` (append-only), disinkron sebagai entitas server-authoritative
lewat mekanisme sync biasa (ADR-0045):
`{ id, projectId, specId?, oldStage?, newStage?, commitSha?, branch?, prUrl?, status, deviceId?,
author?, version, createdAt, updatedAt }`.
- **Whitelist ketat**: hanya field di atas ditulis. Input berisi field lain (mis. `transcript`,
  `token`) diabaikan — bukan mesin redaksi, melainkan seleksi field eksplisit (AC-21).
- **Append-only** tanpa auto-expiry. **Purge manual** scoped project dan/atau rentang tanggal
  (`DELETE /api/session-results?projectId=&before=`) (AC-22).

## Alasan
- Model terpisah menjaga log bersih & aman untuk diagregasi; tak mencampur ke Spec/Notification.
- Ikut jalur sync yang sama → otomatis ter-pull device lain, tak butuh transport khusus.

## Konsekuensi
- Membutuhkan migration (tabel baru). Notifikasi lokal TIDAK ikut (per-device, ADR & AC-30).
- Read/purge = cookie-authed (dashboard); push = lewat outbox→/sync/push (device token).
