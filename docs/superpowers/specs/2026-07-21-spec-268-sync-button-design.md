# SPEC-268 — Tombol sync data client & server (backlog, errors, triase)

**Tanggal:** 2026-07-21 · **Sumber:** brief (prioritas tinggi) · **Flow:** feature (spec → plan → execute)

## Objective

Tambahkan tombol **Sync** di layar Backlog, Errors, dan Triase agar operator dapat memicu
sinkronisasi data antar instance hanoman (client lokal ↔ hub/server) sekali klik — dua arah
(local→server & server→local) — sehingga backlog, errors, dan triase konsisten di kedua sisi.

## Konteks & temuan (dari kode)

Arsitektur sync (ADR-0043–0046): satu instance = **hub** (tanpa `SYNC_SERVER_URL`) atau
**client** (dengan `SYNC_SERVER_URL` + `SYNC_DEVICE_TOKEN`). Client menyinkron server-to-server ke
hub, disiplin **pull-before-push**. Feed perubahan = `SyncLog` (seq = kursor global); pull membaca
`SyncLog WHERE seq > cursor`, WS menyiarkan baris baru.

Tiga temuan yang menentukan bentuk kerja:

1. **Hanya Backlog (`Spec`) yang benar-benar tersync.** `Project`/`Spec`/`Vps`/`SessionResult`
   ada di daftar `SYNCED` (`server/src/services/sync.ts`). **`ErrorGroup` dan `Ticket`
   TIDAK** — skema menandai keduanya "server-local, tanpa version/sync". Tak ada kolom `version`.

2. **Tak ada pemicu sync manual.** Sync berjalan otomatis (tick 15 dtk + WS realtime) di
   `startSyncClient`. Tak ada endpoint/tombol untuk "sync sekarang".

3. **Feed hanya memuat push dari client.** `SyncLog` di-*append* HANYA oleh `applyPush`
   (dipanggil dari `POST /sync/push`, device-token) — yaitu saat **client push ke hub**.
   **Write lokal di hub tidak pernah masuk feed.** Padahal **errors & tickets lahir di hub**
   (DSN publik `/api/ingest/<id>` & form Help publik `/help/<id>`). Maka menambah keduanya ke
   `SYNCED` + `enqueueOutbox` saja **tidak cukup** untuk mengalirkannya hub→client — hub harus
   **mem-publish** write lokalnya ke feed.

## Keputusan cakupan (dikonfirmasi operator)

**Full: Errors + Triase + tombol.** Errors & Triase dimasukkan ke mekanisme sync record
(kolom `version` + migration + ADR baru), plus tombol Sync di ketiga layar.

## Desain

### 1. Data model (migration + ADR-0066)

- `ErrorGroup`: tambah `version Int @default(0)`.
- `Ticket`: tambah `version Int @default(0)`.
- `ErrorEvent` & `TicketAttachment` **tidak** disync: event mentah dipangkas retensi; lampiran =
  file biner di `HANOMAN_UPLOAD_DIR` (server-local, konsisten ADR-0043 — isi file bukan lewat
  sync API). Yang menyeberang hanya **agregat/metadata** (grup error & metadata tiket).

### 2. Mesin sync (`server/src/services/sync.ts`)

- `SYNCED` += `"errorGroup"`, `"ticket"`; tambah `DELEGATE` + `FIELDS` + `DATE_FIELDS`:
  - `errorGroup`: `projectId, fingerprint, type, message, sampleStack, environment, status,
    count, firstSeenAt, lastSeenAt, specId` (date: `firstSeenAt, lastSeenAt`).
  - `ticket`: `projectId, number, category, title, detail, reporterEmail, status,
    accessKeyHash, specId, createdAt` (date: `createdAt`).
    - `accessKeyHash` **wajib disertakan** — kolomnya `required @unique` tanpa default, jadi upsert
      `create` butuh nilainya. Aman: ia hash sha256 dari kunci acak 256-bit (kunci plaintext tak
      pernah menyeberang); tabrakan unik antar-id mustahil.
- Tambah primitif **`publishLocal(entity, id)`**: baca snapshot → naikkan `version` baris →
  append satu baris `SyncLog` (data = snapshot, version baru) → panggil `onAccepted` (siar WS).
  Ini menjadikan write **lokal-asal** bagian dari change-feed sehingga bisa di-*pull* client.
  (`DELEGATE` ditambah method `update` untuk menaikkan version.)

### 3. Helper role-aware (`server/src/services/sync-notify.ts`, baru)

```ts
notifySynced(entity, id):   // best-effort
  client (SYNC_SERVER_URL ada) → enqueueOutbox(entity, id)   // push ke hub (perilaku lama)
  hub    (SYNC_SERVER_URL kosong) → publishLocal(entity, id) // masuk feed sendiri → client pull
```

Strictly additive: di client identik perilaku lama; di hub kini ikut menyiarkan. Menggantikan
`enqueueOutbox(...)` di jalur spec (escalate/accept) + menambah di jalur error/ticket.

### 4. Situs write yang memanggil `notifySynced`

| Entitas | Situs | Catatan |
|---|---|---|
| errorGroup | `error-ingest.ts` **saat grup baru** | TIDAK pada increment count murni (hindari churn feed) |
| errorGroup | `errors.ts` escalate, patch(resolve) | perubahan status/specId |
| ticket | `help.ts` create (setelah `createTicket`) | tiket baru |
| ticket | `tickets.ts` accept, reject | perubahan status/specId |
| spec | `errors.ts`/`tickets.ts` escalate/accept, `live-specs.ts` advance | ganti `enqueueOutbox`→`notifySynced` agar backlog asal-hub juga menyiar |

**Konsekuensi (didokumentasikan di ADR):** `count`/`lastSeenAt` grup error di client mencerminkan
nilai saat perubahan *berarti* terakhir (pembuatan / status), bukan hitungan live per-event —
disengaja agar feed tidak membengkak & tidak menstarve push status. Info triase (keberadaan, type,
message, env, status, tautan spec) tetap sync. `SyncLog` tumbuh append-only (prunable, ADR-0045).

### 5. Pemicu manual

- `syncNow()` di `sync-client.ts`: bangun transport dari config efektif; `null` bila bukan client;
  else `syncOnce(transport)` → `{pulled, pushed, conflicts}`.
- `POST /api/sync/now` (cookie-authed, di `routes/sync.ts`, **tanpa** `requireDeviceToken`):
  `syncNow()` → `{ ok:true, ...stats }` atau `{ ok:false, reason:"not-configured" }`.
  `/sync` non-delegatable ke agent (agent→403) — endpoint ini aksi manusia, tetap terjaga.

### 6. Frontend

- `api.syncNow()` → `POST /api/sync/now` (client.ts + `paths.syncNow`).
- Hook `useSyncActive()` (module-cached `getConfig().sync.running`) → tombol hanya muncul di
  instance **client** (di hub, sync manual tak berarti — data masuk otomatis dari client).
- Tombol **Sync** di toolbar `BacklogScreen`, `ErrorsScreen`, `TriageScreen`:
  klik → `busy` → `api.syncNow()` → toast (`Sinkron: ↓{pulled} ↑{pushed}` /`· {n} konflik`/
  `bukan client sync`) → reload daftar (`load(true)`).

### 7. SoT (commit yang sama)

- ADR-0066 (baru) — perluas ADR-0045: errorGroup+ticket masuk sync + `publishLocal`/`notifySynced`
  (write asal-hub masuk feed) + pemicu manual `POST /sync/now`.
- `internal/docs/architecture/data-model.md` — ErrorGroup/Ticket kini punya `version` & tersync.
- `internal/docs/architecture/api-contract.md` — `POST /api/sync/now`; ralat catatan
  "errors/tickets server-local (tanpa sync)".
- `internal/docs/README.md` — tautkan ADR-0066.

## Testing

- Unit sync: snapshot/coerce errorGroup & ticket; `applyPush` insert/update+konflik; `publishLocal`
  append SyncLog + bump version + panggil hook.
- Unit notify: client→enqueueOutbox, hub→publishLocal (mock `SYNC_SERVER_URL`).
- Route: ingest grup baru → `notifySynced`; escalate/resolve/accept/reject → SyncLog/outbox terisi.
- Route: `POST /sync/now` → not-configured (hub) & configured (client, mock transport) → stats.
- Frontend: tombol Sync render saat client, panggil `api.syncNow`, toast + reload (test tiap layar).
- Live: boot server + curl `POST /api/sync/now`, `GET /api/sync/pull` memuat baris errorGroup/ticket.

## Non-goals / YAGNI

- Sync isi file lampiran (biner) — di luar model record-sync.
- Sync `ErrorEvent` mentah (dipangkas retensi).
- Sync count error live per-event (lihat konsekuensi §4).
- Menghidupkan tombol di hub (tak ada makna sync manual di hub).
