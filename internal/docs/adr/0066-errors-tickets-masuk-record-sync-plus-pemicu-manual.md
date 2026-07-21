# ADR-0066 — Errors & tickets masuk record-sync (publish asal-hub) + pemicu sync manual

**Status:** accepted · **Tanggal:** 2026-07-21 · **Spec:** SPEC-268
**Terkait:** [ADR-0045](0045-skema-sync-synclog-version-stamp.md) (**diperluas** — version-stamp +
change-feed), [ADR-0043](0043-sync-arsitektur-hub-client-server-to-server.md) (peran hub/client,
isi file lewat git), [ADR-0046](0046-kanal-ws-sync-terpisah.md) (siar changefeed),
[ADR-0060](0060-error-monitoring-ingest-ber-dsn.md) (ErrorGroup asal-DSN),
[ADR-0062](0062-help-center-tiket-publik-triase.md) (Ticket asal-Help publik),
[ADR-0028](0028-auth-sesi-opaque-di-db.md) (gate cookie `/api`)

## Konteks

Objektif SPEC-268: tombol **Sync** di Backlog, Errors, dan Triase agar operator memicu sinkron
client↔hub sekali klik, dua arah, sehingga ketiganya konsisten. Tiga fakta mengikat desain:

1. **Hanya `Spec` (backlog) yang tersync.** `SYNCED = [project, spec, vps, sessionResult]`.
   `ErrorGroup` (ADR-0060) & `Ticket` (ADR-0062) sengaja **server-local, tanpa kolom `version`**.
   Menyertakannya = **ubah skema** (butuh migration + ADR ini).
2. **Feed hanya memuat push dari client.** `SyncLog` di-*append* **hanya** oleh `applyPush`
   (`POST /sync/push`, device-token) — yaitu saat **client push ke hub**. Write **lokal-asal di
   hub tidak pernah masuk feed.** Padahal **errors & tickets lahir di hub** (DSN publik
   `/api/ingest/<id>` & form Help publik `/help/<id>`). Maka `SYNCED` + `enqueueOutbox` saja
   **tak cukup** mengalirkannya hub→client — hub harus **mem-publish** write lokalnya ke feed.
3. **Tak ada pemicu sync manual.** Sync hanya otomatis (tick + WS) di `startSyncClient`.

## Keputusan

### 1. Dua kolom `version` (migration additive)

- `ErrorGroup.version Int @default(0)`, `Ticket.version Int @default(0)` — pola version-stamp
  ADR-0045. `ErrorEvent` & `TicketAttachment` **tetap tak disync**: event mentah dipangkas retensi;
  lampiran = file biner di `HANOMAN_UPLOAD_DIR` (isi file lewat git/di luar record-sync, ADR-0043).
  Yang menyeberang hanya **agregat grup** & **metadata tiket**.

### 2. `SYNCED` += `errorGroup`, `ticket` — whitelist field selektif

- `errorGroup`: `projectId, fingerprint, type, message, sampleStack, environment, status, count,
  firstSeenAt, lastSeenAt, specId`.
- `ticket`: `projectId, number, category, title, detail, reporterEmail, status, accessKeyHash,
  specId, createdAt`. `accessKeyHash` **wajib** disertakan (kolom `required @unique` tanpa default →
  dibutuhkan `create` saat upsert); aman karena ia hash sha256 dari kunci acak 256-bit — kunci
  plaintext **tak pernah** menyeberang, tabrakan unik antar-id mustahil.

### 3. Primitif `publishLocal(entity, id)` — write asal-lokal masuk change-feed

Baca snapshot → naikkan `version` baris → append satu baris `SyncLog` (version baru, data snapshot)
→ panggil `onAccepted` (siar WS, ADR-0046). Membuat write **lokal-asal** menjadi bagian feed yang
di-*pull* client. Ini **komplemen** `applyPush` (yang menangani write asal-client-push).

### 4. Helper role-aware `notifySynced(entity, id)` (best-effort)

- **client** (`SYNC_SERVER_URL` ada) → `enqueueOutbox(entity, id)` — push ke hub (perilaku lama).
- **hub** (`SYNC_SERVER_URL` kosong) → `publishLocal(entity, id)` — masuk feed sendiri → client pull.

**Strictly additive**: di client identik perilaku lama; di hub kini ikut menyiar. Menggantikan
`enqueueOutbox(...)` pada jalur spec (escalate/accept, live-specs advance) **dan** dipasang di
jalur error/ticket. Situs: `error-ingest` (grup **baru** saja), `errors` escalate/resolve, `help`
create-ticket, `tickets` accept/reject, `spec` escalate/accept + `live-specs` advance.

### 5. Pemicu manual `POST /api/sync/now`

Cookie-authed (di `routes/sync.ts`, **tanpa** `requireDeviceToken`): panggil `syncNow()`
(`sync-client.ts` — bangun transport dari config efektif; `syncOnce` pull-before-push) →
`{ ok, pulled, pushed, conflicts }`, atau `{ ok:false, reason:"not-configured" }` bila bukan client.
`/sync` **non-delegatable** ke agent (agent→403) — endpoint ini aksi manusia, tetap terjaga. Tombol
di UI hanya muncul di instance **client** (`config.sync.running`); di hub sync manual tak bermakna
(data masuk otomatis).

## Alasan

- Menutup **gap arah**: model sync ADR-0043/0045 dirancang client→hub-centric; errors/tickets
  lahir di hub → butuh publish asal-hub. `publishLocal` melengkapinya tanpa mengubah kontrak wire.
- `notifySynced` menyatukan keputusan arah di satu tempat, sehingga jalur backlog **asal-hub** juga
  ikut menyiar (bukan hanya asal-client) — konsisten dengan objektif "backlog sync dua arah".
- Pemicu manual memberi operator kendali + umpan balik (pulled/pushed/conflicts) di atas sync
  otomatis; memanfaatkan `syncOnce` yang sudah idempoten (pull-before-push, ADR-0045).

## Konsekuensi

- `count`/`lastSeenAt` grup error di client mencerminkan nilai saat perubahan **berarti** terakhir
  (pembuatan / status), **bukan** hitungan live per-event — disengaja agar feed tak membengkak &
  tak menstarve push status. Info triase (keberadaan/type/message/env/status/tautan spec) tetap
  sync. Hitungan live penuh tetap di hub.
- `SyncLog` tumbuh append-only (prunable belakangan, ADR-0045) — kini +errorGroup/ticket.
- Konflik optimistic-concurrency antar-instance dibiarkan di outbox untuk pull-rebase manusia
  (semantik ADR-0045); untuk errors/tickets jarang (hub penulis dominan).
- Topologi didukung: errors/tickets **lahir di satu instance** (hub, tempat DSN/Help publik
  menunjuk). Dua pembuat independen atas natural-key sama (`(projectId,fingerprint)` /
  `(projectId,number)`) di luar scope — konsisten cara DSN/Help URL menunjuk satu instance.
- Skema: dua kolom `version` additive (default aman). Migration hand-written + `migrate deploy`
  per DB (termasuk `hanoman_test`), `prisma generate`.

## Alternatif yang ditolak

- **Tombol saja tanpa `version`/publish** — tak memenuhi objektif; errors/tickets tetap tak
  menyeberang (feed kosong untuk keduanya). Ditolak.
- **Publish per-event count** (bump version tiap ingest) — feed membengkak & menstarve push status
  client (version churn). Ditolak; publish hanya pada perubahan berarti.
- **Sync lampiran/ErrorEvent** — biner/volume tinggi, di luar record-sync (ADR-0043). Ditolak.
- **Endpoint manual device-token** — sync manual = aksi UI manusia same-origin; cukup gate cookie
  existing. Ditolak.

## Acceptance (EARS)

- **AC-1** — WHEN operator menekan tombol Sync di Backlog/Errors/Triase pada instance client,
  THE server SHALL menjalankan satu siklus `syncOnce` & mengembalikan `{pulled, pushed, conflicts}`.
- **AC-2** — IF instance bukan client (hub), THEN `POST /sync/now` SHALL mengembalikan
  `{ ok:false, reason:"not-configured" }` & tombol tak ditampilkan.
- **AC-3** — WHEN grup error **baru** dibuat atau statusnya berubah (escalate/resolve) di hub,
  THE server SHALL meng-*append* baris `SyncLog` sehingga client dapat mem-*pull*-nya.
- **AC-4** — WHEN tiket dibuat / accept / reject di hub, THE server SHALL meng-*append* baris
  `SyncLog` metadata tiket (tanpa isi lampiran biner).
- **AC-5** — THE snapshot sync `ticket` SHALL menyertakan `accessKeyHash` (kunci plaintext tak
  pernah menyeberang) & TIDAK menyertakan isi/lampiran file.
- **AC-6** — THE push errorGroup/ticket asal-client SHALL memakai optimistic-concurrency
  version-stamp (ADR-0045); stale → konflik, server tak ditimpa.
