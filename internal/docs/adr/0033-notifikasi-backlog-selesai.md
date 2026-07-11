# ADR-0033 — Notifikasi saat backlog selesai dikerjakan

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-180

## Context
Awareness saat sebuah backlog **selesai** (mencapai stage `done`) minim: tak ada toast, tak ada
daftar notifikasi, tak ada sound. Penyelesaian backlog sering terlewat. `Spec.stage → done`
di-*derive* dari berkas fase dan di-persist di **dua** titik: write-through `GET /specs`
(`server/src/routes/specs.ts`) saat sesi hidup, dan `advanceStage()` saat
`DELETE /terminal/sessions/:id` (`server/src/routes/terminal.ts`). Realtime hanya WebSocket PTY —
stage tak pernah di-push; frontend menyegarkan board dengan polling `listSpecs` tiap 3s.

## Decision
Notifikasi **dibuat server-side** tepat saat transisi masuk `done`. Model baru `Notification`:

```prisma
model Notification {
  id        String    @id @default(cuid())
  specId    String    @unique
  title     String
  projectId String?
  createdAt DateTime  @default(now())
  readAt    DateTime?
}
```

`specId @unique` membuat pembuatan **idempoten**: poll write-through 3s dan dua jalur persist yang
balapan hanya menyisakan satu baris — insert kedua kena `P2002` dan diabaikan. Helper
`recordCompletion(specId, title, projectId)` dipanggil dari kedua titik persist, **hanya saat**
stage baru `=== "done"` (guard forward-only yang ada menjamin stage lama `< done`).

Rute (di belakang gate auth SPEC-169): `GET /notifications` → `{ items (≤50, terbaru dulu), unread }`;
`POST /notifications/read` → tandai semua terbaca; `DELETE /notifications` → clear.

Frontend: `NotificationsProvider` memoll `GET /notifications` tiap 10s (independen dari sesi aktif,
agar lonceng segar setelah sesi tutup), memunculkan **toast** + memutar **sound** untuk notifikasi
yang baru sejak mount (baseline `createdAt`), digerbang setting. `NotificationBell` di topbar `Shell`
menampilkan badge unread + dropdown. Sound = 3 file WAV bundled (`short`/`medium`/`long`,
dibangkitkan `scripts/gen-notify-sounds.mjs`). Setting `notifyDone` (enable) + `notifySound`
(`off|short|medium|long`) menumpang blob `Setting` (JSON) — **tanpa migration**.

## Consequences
- **Butuh migration** (tabel baru): `20260711140000_add_notification`. Aditif; tak menyentuh tabel
  lain. Diterapkan via `migrate deploy` (bukan `migrate dev`) karena DB dev/test dibagi antar-worktree
  dan `migrate dev` akan memicu reset atas drift sibling.
- **Read-state global** (satu `readAt` per baris, bukan per-user): workspace single-team; menghindari
  tabel join per-user. Bila kelak butuh per-user, tambah baris read-state ber-`userId`.
- **Reopen tak menotifikasi ulang**: backlog yang di-*reopen* (SPEC-167/172) lalu selesai lagi tak
  membuat notifikasi baru karena baris `specId` sudah ada. Upgrade: drop `@unique` + guard transisi
  via `updateMany({ where: { stage: { not: "done" } } }).count === 1`.
- **Tanpa push saat tab tertutup**: scope = awareness in-app (toast/daftar/sound). Web Push / service
  worker sengaja tak dibangun (YAGNI).
- Autoplay sound bisa diblokir browser sebelum interaksi user. **SPEC-192**: satu elemen `Audio`
  dipakai ulang dan di-*unlock* (prime muted) pada gestur user pertama, sehingga notifikasi dari
  poll timer berbunyi setelah user berinteraksi minimal sekali (tombol Preview tetap memicu langsung).
