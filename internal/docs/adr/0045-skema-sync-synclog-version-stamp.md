# ADR-0045 — Sync record via SyncLog change-feed + version-stamp optimistic concurrency

Status: diterima · SPEC-213 · 2026-07-14

## Konteks
Sync harus server-authoritative, pull-before-push, tanpa lost update / duplikat (AC-9..15),
dan realtime (AC-16). Butuh model konkret untuk versi, kursor, dan feed perubahan.

## Keputusan
- **Version-stamp**: tiap entitas tersync (`Project`, `Spec`, `Vps`, `SessionResult`) punya
  kolom `version Int @default(0)` + `updatedAt`. Tiap accepted write menaikkan `version`.
- **Optimistic concurrency**: push membawa `baseVersion`. `baseVersion === current` → accept,
  `version = base+1`. Stale → tolak record itu dengan snapshot server (untuk diff/pull-rebase);
  tak ada data server ditimpa (AC-11/12/13).
- **Change-feed** `SyncLog { seq BIGSERIAL, entity, recordId, version, data, deviceId, createdAt }`.
  Tiap accepted write meng-append satu baris. `seq` autoincrement = **kursor global**. Pull =
  `SyncLog WHERE seq > since ORDER BY seq`; kursor balik = seq terbesar. WS siar baris baru.
- **Idempotensi**: id record client-generated (Project/Spec sudah string id; cuid/ulid untuk
  entitas baru). Server upsert by id → push berulang tak duplikat (AC-15, OQ-6).
- Never-sync fields dikupas dari snapshot: `Project.repoDir`, `Vps.keyPath` (AC-7/29).

## Alasan
- Satu feed (SyncLog) melayani pull DAN realtime → kursor & broadcast konsisten by construction.
- Version int sederhana, cukup untuk record-level; git 3-way merge menangani isi file (ADR-0043).

## Konsekuensi
- SyncLog tumbuh append-only; boleh dipangkas belakangan (di luar scope MVP).
- Semua perubahan skema ini butuh migration (additive, default aman).
