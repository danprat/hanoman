# ADR-0044 — Identitas mesin lewat device token per-device (hash-at-rest, revocable)

Status: diterima · SPEC-213 · 2026-07-14

## Konteks
Auth hari ini hanya cookie sesi same-origin (ADR-0028). Sync server-to-server (ADR-0043)
butuh autentikasi mesin-ke-mesin dari internet publik. Cookie tak cocok untuk klien non-browser.

## Keputusan
Model `DeviceToken { id, userId, name, tokenHash, createdAt, lastSeenAt?, revokedAt? }`.
- Token plaintext (base64url 32B) hanya ditampilkan **sekali** saat diterbitkan; DB simpan
  `sha256(token)` (`tokenHash`), tak pernah plaintext.
- Terikat ke `user` → record dari client diatribusi ke user itu (AC-4).
- Semua user setara boleh menerbitkan (konsisten no-RBAC hari ini; OQ-2).
- Auth surface sync: `Authorization: Bearer <token>` (REST) / `?token=` pada upgrade WS.
- Revoke = set `revokedAt`; `verifyDeviceToken` menolak token revoked (AC-3), device lain tak
  terpengaruh.

## Alasan
- Cermin pola `Session` (ADR-0028): id = hash, plaintext hanya di klien. Bocornya DB tak
  membocorkan token yang bisa dipakai.
- Per-device → kehilangan satu device = revoke satu token, tak mengganggu yang lain.

## Konsekuensi
- Endpoint kelola token (`/api/device-tokens`) tetap cookie-authed (dashboard user).
- TLS via reverse proxy (ADR-0028) wajib untuk melindungi token di transit.
