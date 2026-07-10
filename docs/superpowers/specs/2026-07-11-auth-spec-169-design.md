# SPEC-169 · Auth — email/password, invite langsung, ganti password

**Tanggal:** 2026-07-11 · **Sumber:** brief · **Prioritas:** tinggi
**Constraint brief:** tanpa RBAC, semua role sama.

## Objective

hanoman saat ini **tanpa auth** — `server.ts` sengaja bind ke `127.0.0.1` karena
"membagikan shell ke seluruh jaringan" tanpa auth berbahaya (ia menyerahkan PTY
`claude` sungguhan). SPEC-169 menambah lapisan autentikasi supaya hanoman bisa
di-deploy aman (di belakang reverse proxy TLS di VPS).

Selesai bila seorang manusia dapat:
1. **Login** dengan email + password.
2. **Invite** user lain dengan menetapkan password-nya langsung (tanpa email invitation).
3. **Ganti password** sendiri.

Dan setiap request ke `/api/**` (kecuali endpoint auth publik + health) menolak
pemanggil tanpa sesi valid.

## Keputusan desain (hasil brainstorm)

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Bootstrap user #1 | **Setup layar pertama** | Invite butuh login → ayam-telur. Saat 0 user, login jadi "buat akun pertama". Nol env/CLI/email. |
| Mekanisme sesi | **Token opaque + tabel `Session`** | Bisa dicabut per-sesi; ganti password me-logout perangkat lain; hapus user langsung putus akses. Lebih aman utk VPS publik. |
| Hash password | **`crypto.scrypt` (stdlib)** | Nol dependency; salt acak + `timingSafeEqual`. |
| TLS | **Bind `127.0.0.1` + reverse proxy** | Caddy/nginx terminasi TLS (Caddy = auto-HTTPS). Cookie `Secure` aktif di prod. |
| Scope user | **Invite + daftar + hapus + ganti password** | Menghapus user yang keluar/terkompromi = kontrol keamanan nyata. |

**Tidak ada secret env baru wajib** — token sesi *adalah* rahasianya, DB verifikatornya.

## Data model (Prisma — 2 tabel baru, additive)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String            // scrypt: "<saltHex>:<hashHex>"
  createdAt    DateTime @default(now())
  sessions     Session[]
}

model Session {
  id        String   @id        // sha256(token) — token asli hanya ada di cookie
  userId    String
  createdAt DateTime @default(now())
  expiresAt DateTime
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Migration: `add_auth`. Additive → aman untuk DB dev bersama (query lama tak tersentuh).
DB test butuh `migrate deploy` terpisah (lihat memory hanoman-test-db).

## Server

### `server/src/services/auth.ts`
- `hashPassword(pw)` → `scrypt` async, salt `randomBytes(16)`, format `"saltHex:hashHex"`.
- `verifyPassword(pw, stored)` → derive ulang, `timingSafeEqual`.
- `sessionToken()` → `randomBytes(32).toString("base64url")`; `sessionId(token)` → `sha256(token)` hex.
- `createSession(userId)`, `lookupSession(token)` (tolak yang `expiresAt < now`), `deleteSession(token)`, `deleteUserSessions(userId, exceptToken?)`.
- Konstanta: nama cookie `hn_session`, TTL 7 hari, opsi cookie.
- **Throttle login in-memory**: `Map<ip, {fails, until}>`, mis. 10 gagal → tunda 60s.
  `ponytail: reset saat restart, per-proses — cukup single VPS; ganti ke store bila multi-instance.`

### `server/src/routes/auth.ts`
| Method + path | Auth | Body → Respons |
|---|---|---|
| `GET /api/auth/status` | publik | → `{ needsSetup: boolean, user: UserView \| null }` |
| `POST /api/auth/setup` | publik, **hanya saat 0 user** | `{email,password}` → set cookie, `{user}`; 409 bila sudah ada user |
| `POST /api/auth/login` | publik (throttled) | `{email,password}` → set cookie, `{user}`; 401 generic |
| `POST /api/auth/logout` | sesi | → 204, clear cookie |
| `GET /api/auth/users` | sesi | → `UserView[]` |
| `POST /api/auth/users` | sesi | `{email,password}` (invite) → `UserView`; 409 email dipakai |
| `DELETE /api/auth/users/:id` | sesi | → 204; **tolak hapus user terakhir** (400) |
| `POST /api/auth/change-password` | sesi | `{currentPassword,newPassword}` → set cookie baru; 400 bila lama salah. Hapus semua sesi lain user. |

`UserView = { id, email, createdAt }` (tak pernah membawa `passwordHash`).

### Enforcement — `app.ts`
Satu `onRequest` hook di scope `/api`:
- **Allowlist publik**: `GET /health`, `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`.
- Selain itu: baca cookie `hn_session` → `lookupSession` → set `req.user` → jika tidak ada/expired → **401**.
- Hook ini juga menutup upgrade WebSocket terminal (cookie same-origin ikut terkirim saat upgrade).

Cookie: `httpOnly`, `sameSite: "strict"`, `secure: NODE_ENV === "production"`, `path: "/"`, `maxAge`.
Pakai `@fastify/cookie` (dep resmi, sudah sekeluarga dgn `@fastify/static`/`websocket`) — **tanpa** secret signing (token opaque tak perlu ditandatangani).

## Shared

- `shared/src/api.ts` `paths`: `authStatus`, `authSetup`, `authLogin`, `authLogout`, `authUsers`, `authUser(id)`, `authChangePassword`.
- `shared/src/dto.ts`: `zLogin`, `zSignup` (email+password), `zChangePassword`; tipe `AuthStatus`, `UserView`.
  Validasi: email format, password `min(8)`.

## Frontend (`src/src`)

- `api/client.ts`: `authStatus/login/logout/setup/listUsers/inviteUser/deleteUser/changePassword`.
  `j()`: pada **401**, lempar `ApiError(401)` → App kembali ke layar login. (Cookie ikut otomatis: same-origin.)
- `App.tsx`: on mount `api.authStatus()`.
  - `needsSetup` → **layar Setup** (buat akun pertama).
  - `user == null` → **layar Login**.
  - else → app existing. Simpan `me: UserView` untuk ditampilkan + logout.
- `screens/AuthScreen.tsx` (baru): login + setup dalam satu komponen (bone-paper, komponen `ds`).
- `screens/SettingsScreen.tsx`: panel **Akun** (email, ganti password, logout) + panel **Users** (daftar, invite, hapus). Invite = form email+password → `POST /auth/users`.

## Deployment & docs (Source of Truth — commit yang sama)

- `server.ts`: HOST default tetap `127.0.0.1`; perbarui komentar "tidak punya auth".
- **ADR-0028**: "auth — sesi opaque di DB, bind 127.0.0.1 di belakang reverse proxy TLS".
- `internal/docs/security/security-standard.md`: tambah butir auth (hashing scrypt, sesi opaque revocable, cookie flags, throttle login, TLS via reverse proxy) + contoh Caddyfile.
- `internal/docs/architecture/api-contract.md`: tambah route `/api/auth/**` + catatan gate 401.
- `internal/docs/architecture/data-model.md`: tambah `User`/`Session`.

## Testing

- Unit `services/auth`: hash round-trip, verify salah, session lookup/expiry/cascade delete.
- Integrasi `routes/auth` (boot app, alur nyata):
  `status(needsSetup) → setup → status(user) → login → invite → list → change-password (sesi lama mati) → delete user → logout → 401 pada route terproteksi`.
- Verifikasi nyata: boot server + `curl` alur di atas (bukan hanya unit test).

## Out of scope (YAGNI)

Email invitation nyata · reset-password lupa (butuh email) · RBAC/role · "remember me" · 2FA.
Tambah bila diminta.
