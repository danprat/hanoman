# SPEC-272 · Sync lampiran tiket (hub → local)

**Tanggal:** 2026-07-21
**ADR terkait:** ADR-0068 (baru) · mencabut bagian "lampiran biner tak disync sama sekali" dari ADR-0066
**Status:** Design disetujui, menunggu rencana implementasi

## Masalah

Tiket Help Center dilaporkan di **hub (VPS)** beserta lampiran gambar. Saat instance **local** melakukan sync (pull), metadata tiket ikut menyeberang tetapi lampirannya tidak — baik row `TicketAttachment` maupun file binernya. Di UI triase local, tiket muncul dengan `attachmentCount: 0` (atau tanpa gambar), sehingga pelapor konteks visual hilang.

Ini **bukan bug** melainkan perilaku desain saat ini: `TicketAttachment` sengaja dikecualikan dari mesin sync (ADR-0066, komentar skema baris 289 & whitelist `FIELDS.ticket`). Mesin sync hanya mengangkut data JSON record via `SyncLog`, bukan blob biner. Permintaan: **buat lampiran ikut tersync, arah hub → local**.

## Keputusan arah & transport (hasil brainstorming)

- **Arah:** hub → local saja (lihat lampiran). Tiket + lampiran lahir di hub; local hanya perlu MELIHAT. Dua-arah/local→hub eksplisit **di luar scope**.
- **Transport biner:** metadata sync + **lazy fetch-through**. Row `TicketAttachment` menjadi entity SYNCED (metadata saja). Byte biner ditarik dari hub **hanya saat pertama kali dibuka** di local lewat Bearer device-token, lalu di-cache ke upload dir. Feed tetap ringan dan semangat ADR-0066 (biner tak masuk `SyncLog`) dipertahankan.

## Arsitektur

### 1. Skema + migration (additive)

`TicketAttachment` mendapat dua kolom yang diwajibkan mesin sync (dipakai `snapshot`/`applyPush`/`upsertLocal`):

```prisma
model TicketAttachment {
  // ... kolom lama tetap ...
  version   Int      @default(0)   // version-stamp sync (ADR-0068)
  updatedAt DateTime @updatedAt    // jam LWW (praktis tak relevan — lampiran immutable)
}
```

- Migration **hand-written** + `prisma migrate deploy` per DB (pola drift-safe repo ini; `migrate dev` mereset saat ada drift sibling worktree).
- Additive & aman untuk VPS live (tak menyentuh data lampiran/tiket yang ada).
- Lampiran immutable (dibuat sekali, tak diedit; hapus = cascade dari Ticket), jadi kolom LWW hanya untuk kompatibilitas engine generik.

### 2. `ticketAttachment` sebagai entity SYNCED — `server/src/services/sync.ts`

- `SYNCED += "ticketAttachment"`; tambah entri di `DELEGATE`, `FIELDS`, `DATE_FIELDS`.
- `FIELDS.ticketAttachment = ["ticketId", "projectId", "filename", "mimeType", "size", "storageKey", "createdAt", "updatedAt"]` — **metadata saja, bukan byte**. `storageKey` menyeberang sebagai pointer opaque (uuid+ext), bukan isi file.
- `DATE_FIELDS.ticketAttachment = ["createdAt", "updatedAt"]`.
- `backfillFeed()` (reconciler boot hub) sudah mengiterasi seluruh `SYNCED`, jadi lampiran lama otomatis dipublish ke feed saat hub restart — tak perlu backfill khusus.

### 3. Endpoint biner di hub — `server/src/routes/sync.ts`

```
GET /sync/attachments/:storageKey   preHandler: requireDeviceToken
```

- Server-to-server (Bearer device-token), **bukan** cookie. Berada di bawah prefix `/api/sync` yang sudah dikecualikan dari gate cookie/agent-token di `app.ts`.
- Validasi `storageKey` memang milik satu row `TicketAttachment` (cegah baca file arbitrer di upload dir), lalu stream `readUpload(storageKey)` dengan `content-type` mime-nya.
- 404 bila storageKey tak dikenal atau file tak ada.

### 4. Lazy fetch-through di local — `server/src/services/uploads.ts` + `server/src/routes/tickets.ts`

Fungsi baru di `uploads.ts`:

```
readUploadOrFetch(storageKey, mimeType) -> Buffer
  1. coba readUpload(storageKey)
  2. bila ENOENT DAN SYNC_SERVER_URL + SYNC_DEVICE_TOKEN ter-set:
       GET {SYNC_SERVER_URL}/api/sync/attachments/:storageKey  (Bearer device-token)
       -> tulis buffer ke upload dir (cache) -> kembalikan buffer
  3. bila tetap gagal -> lempar (route jadi 404)
```

- Route serve lampiran `GET /tickets/:id/attachments/:attId` beralih dari `readUpload(a.storageKey)` ke `readUploadOrFetch(a.storageKey, a.mimeType)`.
- Efek: di **hub** tetap baca lokal (SYNC_SERVER_URL kosong → tak ada fetch). Di **local**, byte mengalir dari hub saat lampiran pertama dibuka, lalu ter-cache; pembukaan berikutnya baca dari disk lokal.

### 5. Docs SoT (commit yang sama)

- **ADR-0068** baru: metadata lampiran masuk record-sync + lazy binary fetch-through; catat pencabutan bagian "lampiran tak disync" pada ADR-0066.
- Perbarui: `internal/docs/data-model*` (kolom baru + entity sync), `internal/docs/api-contract*` (endpoint `/sync/attachments/:storageKey` + perilaku serve lampiran local), `internal/docs/architecture/sync*`, dan tautkan di `internal/docs/README.md`.

## Testing

- **Unit — roundtrip metadata:** push/pull `ticketAttachment` via mesin sync; pastikan `storageKey` & metadata sampai ke DB lokal, byte tidak.
- **Unit — fetch-through fallback:** file lokal absen + hub mock mengembalikan byte → `readUploadOrFetch` menarik, menulis cache, mengembalikan buffer; pembukaan kedua baca disk (tak fetch ulang). Tanpa SYNC_SERVER_URL → tetap gagal/404.
- **Unit — guard endpoint hub:** `storageKey` asing → 404; tanpa device-token → 401.
- **Smoke API nyata di local** (wajib CLAUDE.md): boot server, buat tiket + lampiran, verifikasi serve lampiran; simulasikan sisi local (hapus file lokal, set SYNC_SERVER_URL ke hub uji) → lampiran tertarik.

## Di luar scope (YAGNI)

- Sync dua-arah / local → hub (upload balik + resolusi konflik biner).
- Propagasi delete/tombstone lampiran (mesin sync sekarang upsert-only — batasan yang sudah ada, bukan regresi).
- Garbage-collection cache lampiran di local.
- Transformasi/thumbnail/kompresi ulang gambar.

## Berkas tersentuh

1. `server/prisma/schema.prisma` — `version` + `updatedAt` pada `TicketAttachment`.
2. `server/prisma/migrations/<baru>/migration.sql` — hand-written, additive.
3. `server/src/services/sync.ts` — daftar `ticketAttachment` di `SYNCED`/`DELEGATE`/`FIELDS`/`DATE_FIELDS`.
4. `server/src/routes/sync.ts` — `GET /sync/attachments/:storageKey` (device-token).
5. `server/src/services/uploads.ts` — `readUploadOrFetch` + fetch biner dari hub.
6. `server/src/routes/tickets.ts` — pakai `readUploadOrFetch` di route serve lampiran.
7. `internal/docs/adr/0068-*.md` + data-model/api-contract/architecture + `README.md`.
8. Test terkait di `server/src/**`.
