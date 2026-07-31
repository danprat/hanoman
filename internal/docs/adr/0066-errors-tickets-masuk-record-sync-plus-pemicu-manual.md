# ADR-0066 — Ticket masuk record-sync (publish asal-hub) + pemicu sync manual

**Status:** accepted · **Tanggal:** 2026-07-21 · **Spec:** SPEC-268
**Diamandemen:** [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md) · SPEC-384 · 2026-07-31 —
bagian **`errorGroup`** dicabut bersama error monitoring (`ErrorGroup` tak ada lagi; kind itu keluar
dari `SYNCED`). Keputusan **tiket** dan **pemicu sync manual** di bawah tetap berlaku sepenuhnya, dan
primitif `publishLocal`/`notifySynced` yang lahir di sini adalah fondasi keduanya. Nama berkas
sengaja tidak diganti — ADR lain menautnya.
**Terkait:** [ADR-0045](0045-skema-sync-synclog-version-stamp.md) (**diperluas** — version-stamp +
change-feed), [ADR-0043](0043-sync-arsitektur-hub-client-server-to-server.md) (peran hub/client,
isi file lewat git), [ADR-0046](0046-kanal-ws-sync-terpisah.md) (siar changefeed),
[ADR-0062](0062-help-center-tiket-publik-triase.md) (Ticket asal-Help publik),
[ADR-0028](0028-auth-sesi-opaque-di-db.md) (gate cookie `/api`)

## Konteks

Objektif SPEC-268: tombol **Sync** di Backlog dan Triase agar operator memicu sinkron client↔hub
sekali klik, dua arah, sehingga keduanya konsisten. Dua fakta mengikat desain:

1. **Hanya `Spec` (backlog) yang tersync.** `SYNCED = [project, spec, vps, sessionResult]`.
   `Ticket` (ADR-0062) sengaja **server-local, tanpa kolom `version`**. Menyertakannya = **ubah
   skema** (butuh migration + ADR ini).
2. **Feed hanya memuat push dari client.** `SyncLog` di-*append* **hanya** oleh `applyPush`
   (`POST /sync/push`, device-token) — yaitu saat **client push ke hub**. Write **lokal-asal di
   hub tidak pernah masuk feed.** Padahal **tiket lahir di hub** (form Help publik `/help/<id>`).
   Maka `SYNCED` + `enqueueOutbox` saja **tak cukup** mengalirkannya hub→client — hub harus
   **mem-publish** write lokalnya ke feed.
3. **Tak ada pemicu sync manual.** Sync hanya otomatis (tick + WS) di `startSyncClient`.

## Keputusan

### 1. Kolom `version` pada `Ticket` (migration additive)

- `Ticket.version Int @default(0)` — pola version-stamp ADR-0045. `TicketAttachment` **tetap tak
  disync**: lampiran = file biner di `HANOMAN_UPLOAD_DIR` (isi file lewat git/di luar record-sync,
  ADR-0043). Yang menyeberang hanya **metadata tiket**.

### 2. `SYNCED` += `ticket` — whitelist field selektif

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
jalur ticket. Situs: `help` create-ticket, `tickets` accept/reject, `spec` escalate/accept +
`live-specs` advance.

### 5. Pemicu manual `POST /api/sync/now`

Cookie-authed (di `routes/sync.ts`, **tanpa** `requireDeviceToken`): panggil `syncNow()`
(`sync-client.ts` — bangun transport dari config efektif; `syncOnce` pull-before-push) →
`{ ok, pulled, pushed, conflicts }`, atau `{ ok:false, reason:"not-configured" }` bila bukan client.
`/sync` **non-delegatable** ke agent (agent→403) — endpoint ini aksi manusia, tetap terjaga. Tombol
di UI hanya muncul di instance **client** (`config.sync.running`); di hub sync manual tak bermakna
(data masuk otomatis).

## Alasan

- Menutup **gap arah**: model sync ADR-0043/0045 dirancang client→hub-centric; tiket lahir di hub →
  butuh publish asal-hub. `publishLocal` melengkapinya tanpa mengubah kontrak wire.
- `notifySynced` menyatukan keputusan arah di satu tempat, sehingga jalur backlog **asal-hub** juga
  ikut menyiar (bukan hanya asal-client) — konsisten dengan objektif "backlog sync dua arah".
- Pemicu manual memberi operator kendali + umpan balik (pulled/pushed/conflicts) di atas sync
  otomatis; memanfaatkan `syncOnce` yang sudah idempoten (pull-before-push, ADR-0045).

## Konsekuensi

- `SyncLog` tumbuh append-only (prunable belakangan, ADR-0045) — kini +ticket.
- Konflik optimistic-concurrency antar-instance dibiarkan di outbox untuk pull-rebase manusia
  (semantik ADR-0045); untuk tiket jarang (hub penulis dominan).
- Topologi didukung: tiket **lahir di satu instance** (hub, tempat Help publik menunjuk). Dua
  pembuat independen atas natural-key sama (`(projectId,number)`) di luar scope — konsisten cara
  Help URL menunjuk satu instance.
- Skema: kolom `version` additive (default aman). Migration hand-written + `migrate deploy`
  per DB, `prisma generate`.

## Alternatif yang ditolak

- **Tombol saja tanpa `version`/publish** — tak memenuhi objektif; tiket tetap tak menyeberang
  (feed kosong). Ditolak.
- **Sync lampiran** — biner/volume tinggi, di luar record-sync (ADR-0043). Ditolak.
- **Endpoint manual device-token** — sync manual = aksi UI manusia same-origin; cukup gate cookie
  existing. Ditolak.

## Acceptance (EARS)

- **AC-1** — WHEN operator menekan tombol Sync di Backlog/Triase pada instance client,
  THE server SHALL menjalankan satu siklus `syncOnce` & mengembalikan `{pulled, pushed, conflicts}`.
- **AC-2** — IF instance bukan client (hub), THEN `POST /sync/now` SHALL mengembalikan
  `{ ok:false, reason:"not-configured" }` & tombol tak ditampilkan.
- **AC-3** — WHEN tiket dibuat / accept / reject di hub, THE server SHALL meng-*append* baris
  `SyncLog` metadata tiket (tanpa isi lampiran biner).
- **AC-4** — THE snapshot sync `ticket` SHALL menyertakan `accessKeyHash` (kunci plaintext tak
  pernah menyeberang) & TIDAK menyertakan isi/lampiran file.
- **AC-5** — THE push ticket asal-client SHALL memakai optimistic-concurrency version-stamp
  (ADR-0045); stale → konflik, server tak ditimpa.
