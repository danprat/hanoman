# SPEC-270 · Sync self-healing + rekonsil konflik manual (modal side-by-side)

- **Tanggal:** 2026-07-21
- **ADR baru:** ADR-0067 (LWW-default reconciliation + backfill feed; asumsi hub tunggal)
- **Status:** design disetujui, siap plan
- **Entitas terdampak:** `Spec` (backlog), `ErrorGroup` (errors), `Ticket` (triase); mekanisme sync umum (semua `SYNCED`)

## Masalah (dari diagnosa nyata lokal-prod ↔ VPS)

Dua cacat struktural pada mesin sync version-stamp (ADR-0045/0066), dikonfirmasi lewat perbandingan langsung DB lokal `hanoman_prod` vs VPS `hanoman_prod` (2026-07-21):

1. **Record `version=0` tak pernah masuk feed → tak bisa di-pull.** `pull()` hanya me-replay tabel `SyncLog`. Di VPS ada **4 `ErrorGroup` + 1 `Ticket` ber-`version=0`** yang **nol baris di `SyncLog`** — dibuat sebelum SPEC-268 di-deploy (sebelum `errorGroup`/`ticket` jadi entitas tersync & sebelum `publishLocal` ada). Cursor lokal `8387` = max seq VPS `8387` (feed sudah fully catch-up), namun record ini tetap tak pernah sampai lokal. **Tidak ada langkah backfill.** → gejala "errors/triase tak ke-sync".

2. **Version-stamp nyimpang → push ditolak sebagai konflik permanen.** `SPEC-195` = `version 1` di lokal, `version 0` di VPS. `applyPush` menolak (`baseVersion 1 ≠ server 0` → `conflict:true`), record nyangkut di outbox. Diperparah dua bug:
   - `syncOnce` melewati record yang punya edit lokal pending saat pull (`sync-client.ts:44`) → record konflik tak pernah bisa di-rebase; **deadlock**.
   - Setelah push `ok`, `syncOnce` tak meng-update versi lokal ke versi balikan hub (`sync-client.ts:72`) → lokal & hub langsung nyimpang di edit berikutnya.

3. **Fase backlog belum tersync dua arah.** Mekanisme advance→feed sudah ada (`live-specs.ts` → `notifySynced`, SPEC-267), tapi tak efektif karena topologi/config (instance lokal belum jadi client → advance-nya masuk feed lokal sendiri, tak ke VPS) + deadlock divergensi di atas.

Prasyarat LWW yang juga cacat: mayoritas model synced pakai `updatedAt DateTime @default(now())` (**bukan** `@updatedAt`) → `updatedAt` tak naik saat edit (mis. `PATCH /errors/:id`, `/tickets/:id` tak menyetel `updatedAt`). LWW butuh cap waktu tepercaya.

## Prinsip solusi

- **Divergensi sepihak** (hanya satu sisi berubah, atau maju/server-authoritative) → **auto-apply** seperti sekarang, tanpa ganggu manusia.
- **Divergensi dua-sisi sejati** (kedua sisi mengedit ke nilai berbeda) → **tidak** dibuang diam-diam, **tidak** nyangkut permanen. Mendarat di **antrean konflik** dan diselesaikan **manusia** lewat modal side-by-side. Default terpilih = sisi ber-`updatedAt` terbaru (LWW sebagai saran, bukan keputusan otomatis).
- **Backfill idempoten** memastikan tiap row SYNCED terwakili di feed.
- Topologi: **tepat satu hub (VPS)**, instance lain = client (ditegaskan di ADR).

## Desain

### Bagian 1 — `updatedAt` jadi jam LWW tepercaya

- Ubah `updatedAt DateTime @default(now())` → `@updatedAt` untuk 6 model synced: `Project`, `Spec`, `Vps`, `SessionResult`, `ErrorGroup`, `Ticket`. Prisma auto-bump tiap `update()`. Kolom tak berubah tipe → **migration + ADR-0067**.
- Layer sync berhenti menimpa `updatedAt: new Date()` saat menerapkan record dari peer (`sync.ts` `applyPush`/`upsertLocal`, baris ~116-117/178-179): **pertahankan `updatedAt` asal** agar jam origin ikut menyeberang. `@updatedAt` hanya untuk write lokal-asli.
- Tambah `updatedAt` ke `FIELDS` (wire + snapshot + feed) dan `DATE_FIELDS` (ISO↔Date) untuk semua entitas.

### Bagian 2 — Deteksi & klasifikasi konflik di `syncOnce` (client-side)

Ganti perilaku skip-pending (deadlock) + reject-abadi dengan klasifikasi:

- **Non-konflik**: hanya satu sisi berubah, atau data identik → auto-apply seperti biasa. Perbaiki bug versi: setelah push `ok`, set versi lokal = versi balikan hub (`sync-client.ts:72`).
- **Konflik sejati**: lokal punya edit pending **dan** datanya beda dari snapshot hub → jangan apply, jangan buang. Tulis satu baris ke tabel baru **`SyncConflict`** (LOCAL-only, sekelas `SyncOutbox`/`SyncState`).

Titik deteksi:
- **Fase pull**: record pulled yang `recordId`-nya ada di outbox → bandingkan data lokal vs pulled. Sama → clear outbox (konvergen). Beda → catat `SyncConflict`.
- **Fase push**: hub menolak (version mismatch) → tarik snapshot hub, bandingkan. Sama → clear outbox. Beda → catat `SyncConflict`. Item outbox ditandai sudah-konflik agar tak retry membabi-buta tiap tick.

Skema `SyncConflict`:
```
model SyncConflict {
  id              String    @id @default(cuid())
  entity          String
  recordId        String
  localData       Json
  localVersion    Int
  localUpdatedAt  DateTime
  serverData      Json
  serverVersion   Int
  serverUpdatedAt DateTime
  detectedAt      DateTime  @default(now())
  resolvedAt      DateTime?
  @@unique([entity, recordId])
}
```

### Bagian 3 — API + modal rekonsil

- `GET /api/sync/conflicts` (cookie-authed, dikecualikan dari gate agent-token seperti `/sync/now`) → daftar konflik pending (`resolvedAt IS NULL`).
- `POST /api/sync/conflicts/:entity/:recordId/resolve` body `{ choice: "local" | "server" }`:
  - `local` → force-push `localData` ke hub memakai `baseVersion = serverVersion` saat ini (diterima; hub restamp version & tulis feed), lalu tandai `resolvedAt` + clear outbox.
  - `server` → adopsi snapshot hub secara lokal via `upsertLocal(serverVersion, serverData)`, tandai `resolvedAt` + clear outbox.
  - Race: jika snapshot hub sudah berubah lagi sejak konflik dicatat, resolve me-refresh snapshot dulu; kalau berubah, konflik diperbarui (bukan resolve buta).
- **Modal `ReconcileModal`** (DS: editorial, bone paper, brass accent — konsisten `ConfirmDialog` SPEC-269):
  - Dipicu dari `SyncButton` (Backlog/Errors/Triase) saat `syncNow` mengembalikan `conflicts>0`, plus badge jumlah konflik pending (poll ringan / dari `/api/config` status).
  - Tiap konflik = satu kartu **side-by-side** (kolom Lokal | Server) menyorot field yang berbeda; label entitas + `recordId` + `updatedAt` tiap sisi.
  - Sisi ber-`updatedAt` terbaru **ter-highlight sebagai default**; tombol **"Pakai Lokal" / "Pakai Server"**. Selesaikan satu per satu; kartu hilang setelah resolve.

### Bagian 4 — Reconciler backfill saat boot hub

- `backfillFeed()` baru di `sync.ts`: untuk tiap entitas SYNCED, cari row yang **belum terwakili di feed** (tak ada `SyncLog` dengan `version` terkini untuk `recordId`-nya — mencakup semua `version=0`), lalu `publishLocal` sekali. Idempoten.
- Dipanggil dari `applyConfigOnBoot()` **hanya bila peran HUB** (`SYNC_SERVER_URL` kosong). Menyembuhkan 4 `ErrorGroup` + 1 `Ticket` v0 di VPS & menutup gap yang sama untuk entitas yang di-`SYNCED`-kan di masa depan.

### Bagian 5 — Sinkron fase backlog dua arah

- Mekanisme advance→feed sudah ada (`live-specs.ts` → `notifySynced`, SPEC-267). Fix: pastikan topologi **VPS = hub tunggal, lokal = client** (operasional; `SYNC_SERVER_URL` + `SYNC_DEVICE_TOKEN` di-set di lokal) sehingga advance ter-push; deadlock hilang lewat Bagian 2.
- Bila `stage` nyimpang dua-sisi ia muncul di modal. **Catatan `stage` forward-only (ADR-0008):** per keputusan, resolusi **per-record** — manusia melihat kedua `stage` di side-by-side dan memilih sadar (tak ada guard otomatis anti-mundur di v1; risiko regresi ditanggung keputusan manusia).

### Bagian 6 — Testing & risiko

**Test:**
- Unit `updatedAt`: edit via route menaikkan `updatedAt`; apply-dari-peer mempertahankan `updatedAt` asal.
- Unit klasifikasi: non-konflik auto-apply; konflik sejati tercatat sekali (idempoten per `(entity,recordId)`); fix versi-setelah-push.
- Unit backfill: `backfillFeed` idempoten & memasukkan row `version=0` ke feed; run kedua tak menduplikasi.
- Unit resolve: `local` → hub menerima & konvergen; `server` → lokal mengadopsi & konvergen; keduanya menandai `resolvedAt` + clear outbox.
- Integrasi: edit paralel lokal+hub pada satu record → muncul tepat 1 konflik → resolve → kedua sisi identik. Skenario `SPEC-195` (lokal v1/vps v0) → backfill mengonvergenkan atau memunculkan konflik yang dapat di-resolve.

**Risiko:**
- **Clock skew** mac vs VPS: default LWW bisa keliru, **termitigasi** karena manusia bisa override di modal; ADR mendokumentasikan asumsi NTP.
- **Topologi dua-hub**: protokol mengasumsikan satu hub; ADR menegaskan aturan, desain menyembuhkan divergensi historis tapi bukan izin menjalankan dua hub permanen.
- **Best-effort**: pencatatan `SyncConflict`/outbox tak boleh menggagalkan write utama (cermin `enqueueOutbox`).

## Di luar cakupan (YAGNI)

- Rekonsil per-field (ditolak: per-record cukup).
- Guard forward-only otomatis untuk `stage` (ditolak untuk v1; manusia memutuskan).
- Auto-resolve tanpa manusia (ditolak: user ingin kendali eksplisit).
- Sinkron isi file dokumen (tetap git 3-way, ADR-0043) & lampiran biner (tetap server-local).

## SoT yang tersentuh (commit bersamaan saat implementasi)

- `internal/docs/adr/0067-*.md` (baru) + tautkan di index ADR & `internal/docs/README.md`.
- `internal/docs/data-model/*` — kolom `updatedAt @updatedAt`, tabel `SyncConflict`.
- `internal/docs/api-contract/*` — `GET /api/sync/conflicts`, `POST /api/sync/conflicts/:entity/:recordId/resolve`.
