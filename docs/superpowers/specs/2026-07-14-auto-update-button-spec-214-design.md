# SPEC-214 — Auto Update (tombol update saat versi berubah)

> Status: Design disetujui (keputusan scope diambil manusia di terminal, 2026-07-14).
> Sumber: brief SPEC-214 · prioritas tinggi. Author: hanoman (sesi feature).

## Konteks & masalah

hanoman prod adalah satu proses `node server/dist/server.js` (foreground, tanpa supervisor) yang
menyajikan SPA dari `src/dist` sekaligus API (`operations/production.md`). Update hari ini **manual**:
`git pull --ff-only && pnpm build && pnpm prod`. Brief: "jika ada code baru masih harus manual run".
Outcome: **sediakan button update jika perubahan version**.

Tak ada field `version` di `package.json` — **identitas versi = git commit SHA**.

Ada tiga SHA yang relevan:
- **runningBuildSha** — commit tempat server/SPA yang **sedang berjalan** di-build. Ditanam saat build;
  inilah kunci mendeteksi "kode baru sudah ada di disk tapi app masih lama".
- **checkoutSha** — `git rev-parse HEAD` working tree **sekarang** (murah, tanpa jaringan).
- **originSha** — commit terbaru di `origin/<branch>` setelah `git fetch` (butuh jaringan).

## Keputusan (diambil manusia)

1. **Scope tombol = deteksi saja + panduan.** Server **tidak** menjalankan `git pull`/`pnpm build`/
   restart. Ia hanya **mendeteksi** dan **memunculkan** badge Update + popover berisi apa yang baru dan
   **perintah** untuk dijalankan operator (dengan tombol Salin). Ini menghapus seluruh risiko: working
   tree bersama sesi Claude yang hidup tak pernah tersentuh, build tak menimpa dist yang sedang disajikan,
   tak butuh supervisor. (Trade-off: langkah "manual run" tetap ada, tapi kini tak perlu mengingat perintah
   / memeriksa apakah ada versi baru.)
2. **Sinyal "update tersedia" = keduanya.** Badge muncul bila **(a)** `runningBuildSha ≠ checkoutSha`
   (kode di disk lebih baru dari app yang jalan → rebuild & restart) **ATAU** **(b)** `origin` di depan
   checkout (`behind > 0` → pull dulu). Popover membedakan keduanya.

**Konsekuensi arsitektur** (di-ADR-kan, ADR-0043): update detection bersifat **read-only** — hanoman
tak pernah memutasi dirinya sendiri. Menghidupkan self-pull/self-build/self-restart butuh ADR baru.

## Arsitektur

### DTO bersama (`shared/src/dto.ts`)

```ts
export type UpdateReason = "local" | "remote" | "both" | null;
export type UpdateRemoteStatus = "ok" | "unavailable";  // unavailable = tak ada upstream / fetch gagal / bukan repo git

export type UpdateStatus = {
  currentSha: string;         // short SHA build yang jalan (fallback checkoutSha di dev)
  checkoutSha: string;        // short SHA HEAD working tree sekarang
  branch: string | null;      // branch aktif; null bila detached HEAD
  local: { stale: boolean };  // runningBuildSha ≠ checkoutSha → perlu rebuild/restart
  remote: {
    status: UpdateRemoteStatus;
    behind: number;           // jumlah commit origin di depan checkout (0 bila tak ada/unknown)
    fetchedAt: string | null; // ISO fetch sukses terakhir
  };
  updateAvailable: boolean;   // local.stale || remote.behind > 0
  reason: UpdateReason;       // "local" | "remote" | "both" bila updateAvailable, else null
  command: string;            // panduan sesuai reason (lihat di bawah)
  newCommits: { sha: string; subject: string }[];  // commit origin-ahead (dibatasi ~20)
};
```

Tambah varian ke `EventMsg`: `| { t: "update"; update: UpdateStatus }`.

`command` bergantung `reason`:
- `remote`/`both` → `git pull --ff-only && pnpm build && pnpm prod`
- `local` → `pnpm build && pnpm prod` (kode sudah di disk, cukup rebuild + restart)

### Server: `services/update.ts` (cermin `services/limits.ts`)

- **`getUpdateStatus(): Promise<UpdateStatus>`** — dengan cache pendek (mis. 15 dtk) supaya tick murah.
- Git dijalankan via `execFile("git", [...], { cwd: repoRoot })` — pola `services/git-ide.ts`/`scan.ts`.
  `repoRoot` = `git -C process.cwd() rev-parse --show-toplevel` (dihitung sekali).
- **runningBuildSha**: dibaca runtime dari `server/dist/build-info.json` (ditanam saat build, lihat di
  bawah). Bila file tak ada (dev) → fallback = checkoutSha (dev auto-reload; jangan pernah tampilkan
  banner palsu di dev).
- **checkoutSha**: `git rev-parse --short HEAD`.
- **branch**: `git rev-parse --abbrev-ref HEAD` (`HEAD` bila detached → `branch = null`).
- **remote**: `git fetch` **di-cache TTL panjang (~5 mnt)** — bukan tiap tick. Lalu
  `git rev-list --count <checkout>..origin/<branch>` untuk `behind`, dan `git log --oneline -n 20
  <checkout>..origin/<branch>` untuk `newCommits`. Tanpa upstream / detached / fetch gagal / bukan repo
  → `remote.status = "unavailable"`, `behind = 0`.
- **Komposisi murni**: fungsi `composeUpdate({ runningBuildSha, checkoutSha, branch, behind, remoteStatus, fetchedAt, newCommits })`
  → `UpdateStatus`. Dipisah supaya bisa diuji unit tanpa git.
- **Fail safe**: setiap error git → jangan pernah set `updateAvailable = true` secara keliru. Error =
  "tak ada update yang bisa dipastikan".

### Server: broadcast WS (`services/events.ts`)

Tambah satu grup ke daftar broadcast `__tick`:
`{ everyTicks: 300, last: "", build: async () => ({ t: "update", update: await getUpdateStatus() }) }`.
Dedup signature bawaan → hanya menyiar saat status **berubah**. Snapshot awal saat `attach` ikut
mengirim frame `update` (seperti limits) supaya badge terisi tanpa menunggu tick pertama.

### Server: route (`routes/update.ts`, cermin `routes/limits.ts`)

`GET /api/update -> UpdateStatus` — auth-gated otomatis (bukan anggota `PUBLIC`). Untuk paint pertama &
test; realtime tetap lewat WS siar.

### Frontend: `src/api/update.ts` (cermin `src/api/limits.ts`)

Store singleton ref-count di-feed frame WS `t:"update"`; `useUpdate(): UpdateStatus` via
`useSyncExternalStore`. Default state = up-to-date (updateAvailable:false) sampai frame pertama tiba.

### Frontend: `UpdateBadge` di topbar (`ds/shell.tsx`)

- Dirender di topbar **di antara** `NotificationBell` dan `LimitBadge` (pola `LimitBadge`).
- **Hanya muncul saat `updateAvailable`** (saat up-to-date: tak ada noise). Pill brass/accent + ikon
  `arrow-up-circle`, teks ringkas: `Update` (+ `· N commit` bila remote-ahead).
- Klik → popover:
  - Judul sesuai `reason`: "Kode baru di disk — rebuild & restart" (local) / "N commit baru di origin —
    pull untuk update" (remote) / gabungan (both).
  - `command` dalam blok mono + tombol **Salin** (clipboard).
  - Daftar `newCommits` (short sha + subject) bila ada.
  - `currentSha` → `checkoutSha` sebagai baris kecil ("terpasang: abc123 · tersedia: def456").

## Yang di luar scope (ditegaskan)

- Server **tidak** menjalankan `git pull`, `pnpm install/build`, atau restart apa pun.
- Tak ada self-restart / supervisor (systemd/pm2/wrapper) — butuh ADR baru bila kelak diinginkan.
- Tak ada perubahan skema DB, tak ada migration.
- Tak menghidupkan kembali queue/scheduler/webhook (ADR-0024).

## Build stamp (satu mekanisme build-time baru)

Tanam SHA build ke `server/dist/build-info.json` (dist gitignored). Root script `build` di `package.json`
ditambah langkah akhir yang menulis `{ "sha": "<git rev-parse --short HEAD>", "builtAt": "<ISO>" }`.
Implementasi: `scripts/stamp-build.mjs` dipanggil setelah `pnpm --filter ./server build`. Server membacanya
lazily di `services/update.ts`; absen → fallback dev.

## Rencana test

- **shared**: `dto.test.ts` — `UpdateStatus` + varian `EventMsg` "update" ada & berbentuk benar.
- **server (unit)**: `composeUpdate()` — tabel kasus: up-to-date; local-stale saja; remote-behind saja;
  keduanya; remote unavailable; command sesuai reason; `newCommits` diteruskan/dibatasi.
- **server (route)**: `GET /api/update` (build `{requireAuth:false}`) balas 200 + shape valid; error git
  → `updateAvailable:false`, tak melempar.
- **frontend**: `UpdateBadge` — tak render saat `updateAvailable:false`; render + popover + tombol Salin
  saat true (bila harness komponen tersedia; else smoke manual).
- **Smoke nyata (WAJIB, CLAUDE.md)**: boot server, `curl /api/update`; verifikasi bentuk & bahwa
  build-stamp terbaca setelah `pnpm build`.

## Docs SoT yang tersentuh (commit yang sama)

- `internal/docs/architecture/api-contract.md` — `GET /api/update` + grup WS `update` + bentuk `UpdateStatus`.
- `internal/docs/frontend/frontend-implementation.md` — `UpdateBadge` di topbar.
- `internal/docs/operations/production.md` — build-stamp + badge Update sebagai pengganti "cek manual versi".
- `internal/docs/adr/0043-auto-update-deteksi-read-only.md` — ADR: versi = git SHA ter-stamp; update detect-only.
- `internal/docs/README.md` — link ADR-0043.
