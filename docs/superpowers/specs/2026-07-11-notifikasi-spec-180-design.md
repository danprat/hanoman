# Notifikasi backlog selesai (SPEC-180) — Design

**Status:** approved · **Date:** 2026-07-11 · **Spec:** SPEC-180
**Prioritas:** tinggi · **Sumber:** brief

## Objective

Awareness saat sebuah backlog **selesai dikerjakan** (mencapai stage `done`) masih minim —
tak ada toast, tak ada daftar notifikasi, tak ada sound. Akibatnya penyelesaian backlog
sering terlewat. Outcome yang diminta:

1. Notifikasi muncul saat backlog selesai dikerjakan.
2. Notifikasi masuk ke **daftar notifikasi** (riwayat).
3. **Toast** muncul saat backlog selesai.
4. Ada **sound** notifikasi.
5. Notifikasi bisa **diaktifkan / dinonaktifkan** di setting.
6. Sound bisa dipilih **variatif**: durasi short, medium, long.

## Konteks arsitektur (yang sudah ada)

- `Spec.stage` (`brainstorming → … → executing → done`) adalah cermin fase yang di-*derive*
  dari berkas fase agen; `done` di-persist di **dua** titik:
  - write-through `GET /specs` (`server/src/routes/specs.ts:43`) — saat sesi masih hidup,
  - `advanceStage()` saat `DELETE /terminal/sessions/:id` (`server/src/routes/terminal.ts:29`).
  Keduanya forward-only (guard `STAGES.indexOf(next) <= STAGES.indexOf(current)`), gerbang
  plan-terceklist SPEC-173 sudah menahan `done` semu.
- Realtime hanya WebSocket PTY terminal; stage **tidak** di-push. Board segar karena App
  polling `listSpecs` tiap 3s **saat ada sesi aktif** (`src/src/App.tsx:312`).
- Toast sudah ada: `useToast`/`Toast` (`src/src/ds/kit.tsx`) — satu toast ephemeral,
  auto-dismiss 2.6s, dipakai lewat `onToast(msg, tone, icon)`.
- Settings via API `GET/PUT /settings`; baris `Setting` adalah **Json blob** (`schema.prisma:35`)
  → menambah field **tak butuh migration**. `notifyFail` adalah toggle **mati** (tersimpan,
  tak ada konsumer) — dibiarkan, di luar scope (soal sesi *gagal*).
- Topbar `Shell` (`src/src/ds/shell.tsx:94`) punya baris flex — tempat lonceng. `Shell`
  di-instansiasi per-section (~9 call-site di App).

## Keputusan desain (disetujui)

Daftar notifikasi **di-persist di server** (tabel + migration + ADR), lonceng+dropdown di
topbar, sound dari **file audio** yang di-bundle.

### 1. Skema — model `Notification` (migration + ADR-0030)

```prisma
model Notification {
  id        String    @id @default(cuid())
  specId    String    @unique   // 1 notif per backlog selesai
  title     String              // snapshot judul spec saat selesai
  projectId String?
  createdAt DateTime  @default(now())
  readAt    DateTime?           // null = belum dibaca
}
```

`specId @unique` membuat pembuatan notifikasi **idempoten**: poll write-through 3s dan dua
jalur persist yang balapan hanya menghasilkan satu baris — insert kedua kena `P2002` dan
diabaikan.

**Ceiling (didokumentasikan `// ponytail:`):** backlog yang di-*reopen* (SPEC-167/172) lalu
selesai lagi **tidak** menotifikasi ulang, karena baris untuk `specId` itu sudah ada.
Upgrade bila perlu: drop `@unique` + guard transisi via `updateMany({where:{stage≠done}}).count === 1`.

**Read-state global** (satu `readAt` per notif, bukan per-user): workspace single-team,
menghindari tabel join per-user. Ceiling didokumentasikan.

### 2. Pembuatan notifikasi (server)

`server/src/services/notifications.ts`:

```ts
recordCompletion(specId: string, title: string, projectId: string | null): Promise<void>
// prisma.notification.create(...).catch(() => {})   // P2002 = sudah ada, no-op
```

Dipanggil dari **kedua** titik persist, **hanya saat** stage baru `=== "done"`. Guard
forward-only yang ada menjamin stage lama `< done`, jadi tiap pemanggilan = transisi masuk
`done` yang sesungguhnya:

- `advanceStage()` (`terminal.ts`): `select` diperluas ke `{ stage, title, projectId }`;
  sesudah `spec.update`, bila `next === "done"` → `recordCompletion`.
- write-through (`specs.ts`): untuk tiap entry `advanced` dengan `next === "done"`
  (punya `s.title`, `s.projectId` di scope) → `recordCompletion`.

### 3. Endpoint (server, di belakang auth, `routes/notifications.ts`)

- `GET /notifications` → `{ items: Notification[]; unread: number }` — ≤50 terbaru,
  `orderBy createdAt desc`.
- `POST /notifications/read` → `updateMany({ where:{ readAt:null }, data:{ readAt: now }})`.
- `DELETE /notifications` → `deleteMany({})` (clear).

Didaftarkan di `server/src/app.ts` dalam scope terautentikasi, sama seperti `specs`/`settings`.

### 4. Frontend

- **`NotificationsProvider` (React context)** di root App: fetch `GET /notifications` saat
  mount + **poll sendiri tiap 10s** — selalu, tak bergantung sesi aktif, agar lonceng tetap
  segar setelah sesi ditutup (jalur `advanceStage` menghentikan poll 3s yang ada). Simpan
  `baseline` = `createdAt` terbesar saat mount (tanpa toast). Tiap poll, notifikasi lebih baru
  dari `baseline` **dan** `notifyDone` aktif → **toast** (`showToast`) + **sound** sesuai
  `notifySound`; `baseline` maju. Ini mencegah spam saat reload.
- **`NotificationBell`** di-render di dalam topbar `Shell` (konsumsi context — **nol prop
  threading** ke call-site App): tombol lonceng + badge unread; klik → dropdown daftar
  (judul + "selesai · Xm lalu" + dot unread) + tombol "Tandai semua dibaca" (`POST read`,
  juga otomatis saat dropdown dibuka) + "Bersihkan" (`DELETE`).
- **Sound:** 3 file WAV di `src/public/sounds/` (`notify-short.wav`, `notify-medium.wav`,
  `notify-long.wav`) dibangkitkan sekali oleh `scripts/gen-notify-sounds.mjs` (deterministik,
  in-repo — memenuhi pilihan "file audio bundled" tanpa mengunduh aset). `playNotifySound(kind)`
  = `new Audio(url).play()` (di-catch; autoplay bisa diblokir sebelum interaksi user).

### 5. Settings (tanpa migration — `Setting` = Json blob)

Tambah ke `zSetting` (`shared/src/entities.ts`), `DEFAULT_SETTING` (`server`), `S_DEFAULTS`
(`SettingsScreen`):

- `notifyDone: boolean` — default `true`. Master enable notifikasi backlog selesai
  (toast + sound; daftar tetap terisi server-side terlepas dari flag).
- `notifySound: "off" | "short" | "medium" | "long"` — default `"short"`. `"off"` = senyap
  tapi toast+daftar tetap jalan.

UI di section **"Sesi"** (sudah ikon `bell`): toggle "Notifikasi backlog selesai",
`Select` sound, tombol **Preview** yang memutar sound terpilih. `notifyFail` dibiarkan.

## Sengaja TIDAK dibangun (YAGNI)

- Push saat tab tertutup / service worker / Web Push. Scope = awareness in-app.
- Read-state & preferensi per-user. Workspace single-team; global cukup.
- Channel WebSocket baru untuk stage. Poll 10s memadai.
- Sintesis Web Audio. User memilih file audio bundled.

## Testing

- **Server:** `recordCompletion` idempoten (dua panggilan → satu baris); `advanceStage` /
  write-through membuat notif tepat saat transisi ke `done` (bukan pada advance lain); rute
  `GET/POST read/DELETE` (unread count, mark-all, clear); auth-gated.
- **Frontend:** `NotificationsProvider` toast+sound pada notif baru, seed baseline tanpa toast
  saat mount, gating `notifyDone`; `NotificationBell` badge unread + dropdown + mark-read;
  Settings baru (`notifyDone`, `notifySound`) round-trip lewat PUT.
- **Smoke API nyata:** boot server (DB terisolasi), transisi sebuah spec ke `done`, assert
  `GET /notifications` memuat 1 item unread; `POST read` → unread 0; `DELETE` → kosong.

## Dokumen SoT tersentuh (commit sama)

- `internal/docs/adr/0030-notifikasi-backlog-selesai.md` (baru — model `Notification`).
- `internal/docs/architecture/**` — catat subsistem notifikasi + endpoint.
- `internal/docs/frontend/frontend-implementation.md` — lonceng, provider, settings.
- `internal/docs/README.md` — index ADR-0030.
- Tanpa token/warna baru → `design-system/**` tak berubah.
