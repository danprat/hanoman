# Audit SPEC-382 — Sync triase hub → local tak membawa lampiran

## Keluhan (sumber: qa, prioritas tinggi, severity major)
- **actual:** "sync triase dari server ke local attachment nya tidak terbawa"
- **expected:** "sync triase dari server ke local membawa attachment · serta ketika di eskalasi ke
  backlog attachment harus di cek supaya context nya jelas"

Konteks: SPEC-272/ADR-0068 sudah memutuskan lampiran **harus** menyeberang (metadata lewat feed,
byte lazy-fetch) dan SPEC-286 sudah menyuntik direktif `PERIKSA lampiran` saat eskalasi. Keluhan ini
berarti **dua keputusan itu tak terwujud di jalan nyata** — bukan permintaan fitur baru.

## Root cause (Phase 1–3 — systematic-debugging)

### Temuan A — feed hub memancarkan ANAK sebelum INDUK → FK ditolak di client

`server/src/routes/help.ts` `POST /help/:slug/tickets` menulis ke change-feed dengan urutan terbalik:

```
for (const f of files) { … await notifySynced("ticketAttachment", att.id); }   // ANAK dulu (seq N)
await notifySynced("ticket", ticket.id);                                       // INDUK belakangan (seq N+1)
```

Di sisi client `syncOnce` menerapkan record **urut seq**, jadi `ticketAttachment` tiba lebih dulu.
`upsertLocal` menabrak FK `TicketAttachment.ticketId → Ticket.id` (schema: `onDelete: Cascade`),
karena tiketnya belum ada lokal. **Terbukti** (test RED, `server/test/sync-ticket-attachment.test.ts`):

```
Foreign key constraint violated: `TicketAttachment_ticketId_fkey (index)`
 ❯ Module.upsertLocal src/services/sync.ts:207
 ❯ applyRemote src/services/sync-client.ts:28
 ❯ Module.syncOnce src/services/sync-client.ts:64
```
dan urutan feed nyata dari route help: `expected 1 to be less than 0` (lampiran di indeks 0, tiket 1).

Test SPEC-272 yang ada (`sync.service.test.ts`) lolos karena **men-push tiket lebih dulu, lampiran
kemudian** — urutan yang tak pernah dihasilkan produksi. Itulah kenapa regresi ini lolos.

### Temuan B — kegagalan apply menghilangkan record (bukan menundanya)

Akibat temuan A berbeda per jalur, dan **keduanya buruk**:

- **Jalur WS** (`startSyncClient`): `applyRemote` yang melempar ditelan `catch { /* frame rusak */ }`.
  Frame lampiran hilang, lalu frame tiket berikutnya menjalankan `setCursor(seq_tiket)` — kursor
  **melompati** seq lampiran. Record itu **hilang selamanya**: pull berikutnya mulai dari seq yang
  lebih tinggi. Ini persis gejala yang dilaporkan (tiket masuk, lampiran tidak).
  Catatan: `ws.on("message", async …)` tak diserialisasi, jadi dua frame ini balapan — kadang tiket
  menang dan lampiran ikut masuk. Itu menjelaskan sifat bug yang kadang-kadang.
- **Jalur pull** (`tick()` awal / fallback 15 dtk): exception merambat keluar `syncOnce`,
  `setCursor` **tak pernah** dijalankan, dan `tick` menelannya sebagai "offline". Client
  **mandek total** di kursor itu — bukan cuma lampiran, seluruh sync berhenti.

Akarnya satu: **mesin sync tak punya kontrak untuk record yang belum bisa diterapkan.** Ia hanya
tahu "berhasil" atau "meledak", padahal feed berisi record berelasi yang bisa tiba di luar urutan
kausal.

### Temuan C — direktif eskalasi menunjuk berkas yang belum tentu ada

`services/ticket-accept.ts` `attachmentInstruction()` menyuruh agen membaca
`join(uploadDir(), a.storageKey)`. Di instance **client**, byte hanya mendarat di disk ketika
seseorang membuka lampiran di UI triase (fetch-through `readUploadOrFetch`, ADR-0068). Eskalasi
tanpa membuka gambar — termasuk **auto-accept scheduler source-checker triase** (SPEC-297, tanpa
manusia sama sekali) — melahirkan spec yang menyuruh agen membaca path yang tak ada. Prompt itu
sendiri mengakuinya ("Bila berkas tak ada di path itu…"), jadi agen kehilangan konteks visual
persis seperti sebelum SPEC-286.

## Keputusan pasca-audit
Akar jelas, terbukti dengan test yang gagal, perbaikannya berdaun (satu urutan write, satu kontrak
apply, satu materialisasi byte). **Spec & Plan di-skip** (jalur cepat qa, ADR-0040) — dokumen ini
jadi doc-of-record.

## Perbaikan

1. **Urutan feed (akar A)** — `routes/help.ts`: `notifySynced("ticket", …)` dipindah **sebelum**
   loop lampiran. Induk selalu mendahului anak di feed.
2. **Kontrak apply (akar B)** — `services/sync-client.ts`:
   - `syncOnce` menerapkan tiap record secara defensif; yang gagal **ditunda** dan dicoba ulang
     berulang **selama masih ada kemajuan** (induk yang menyusul di batch yang sama membuka anaknya).
   - Sisa yang tetap gagal = yatim sejati (induk sudah dihapus di hub; feed append-only tanpa
     tombstone) → **dilewati dengan `console.warn`**, bukan menahan kursor. Menahannya berarti
     livelock: batch yang sama ditarik ulang selamanya. Yang penting: satu record bermasalah tak
     lagi menghentikan siklus.
   - Jalur WS lewat satu pintu `applyFeedFrame()`: frame gagal menyalakan `feedHole` dan
     mengembalikan `false`; selama menyala **tak ada** frame yang boleh memajukan kursor, dan
     client langsung menjadwalkan `tick()` sehingga pull menambal lubangnya.
3. **Byte hadir saat eskalasi (akar C)** — `services/ticket-accept.ts`: sebelum menyusun direktif,
   `materializeAttachments()` menarik byte lewat `readUploadOrFetch` (best-effort, cache ke upload
   dir). Lampiran yang berhasil dimaterialisasi disebut dengan path yang **nyata ada**; yang gagal
   ditandai eksplisit agar agen tahu harus lewat API, bukan menebak.
4. **Pemulihan data lama** — record yang terlanjur dilompati kursor ada di belakang kursor dan tak
   akan pernah tertarik lagi. `POST /api/sync/now` menerima `{ full: true }` → kursor kembali ke `0`
   lalu feed di-drain halaman demi halaman (pull idempoten, server-authoritative). Tombol "Tarik
   ulang" di sebelah Sync.

Tanpa perubahan skema, tanpa migration. Kontrak apply + re-pull penuh dicatat di **ADR-0082**
(mengamandemen ADR-0045/0068).

## Catatan operasional
Perbaikan ini ada di **kedua sisi**: urutan feed hidup di hub (VPS), kontrak apply di client.
Hub yang belum di-update tetap memancarkan urutan lama — client ber-fix #2 tetap aman (menunda
lalu berhasil di percobaan kedua), tapi deploy hub tetap perlu agar urutannya benar sejak sumber.

## Verifikasi

**Test (TDD, RED dulu)** — `server/test/sync-ticket-attachment.test.ts` (7 test) +
`src/test/sync-button.test.tsx`. RED yang terbukti sebelum perbaikan: urutan feed route help
(`expected 1 to be less than 0` — lampiran di indeks 0, tiket di 1), `Foreign key constraint
violated: TicketAttachment_ticketId_fkey` dari `upsertLocal ← applyRemote ← syncOnce`, dan accept di
client yang tak pernah menyentuh hub. Yang dijaga: induk-sebelum-anak di feed · batch urutan terbalik
tetap masuk seluruhnya · record yatim tak menghentikan siklus & kursor tetap maju · frame WS gagal
menahan kursor lalu ditambal pull · `syncNow({full})` memulihkan baris yang dilompati · route
`POST /sync/now { full:true }` · tombol "Tarik ulang".
Scope berubah (ADR-0080): server **61 berkas / 479 test** hijau, frontend **67 berkas / 350 test**
hijau (`vitest --run --changed`), typecheck `server` + `src` bersih.

**Smoke nyata dua instance** (hub `:8891` DB+upload sendiri ↔ client `:8892` DB+upload sendiri,
device-token, `SYNC_TICK_MS=3000`; keduanya dibongkar setelah selesai):
1. Submit tiket + **2 lampiran PNG** ke Help Center publik hub → feed hub urut
   `4 ticket · 5 ticketAttachment · 6 ticketAttachment` (induk dulu).
2. Client menerima **tiket DAN kedua baris lampiran** (`attachmentCount = 2`, `shot1.png`/`shot2.png`),
   kursor maju ke 6 — inilah yang sebelumnya tak pernah terjadi.
3. **Accept di client** (upload dir client masih kosong) → byte kedua lampiran tertarik dari hub ke
   disk client, dan direktif memuat path yang **nyata ada**; isi berkas identik dengan yang diunggah
   pelapor (`SATU-BUKTI-LAYAR`/`DUA-BUKTI-LAYAR`). `GET /tickets/:id/attachments/:attId` → `200 image/png`.
4. **Pemulihan data lama:** lampiran dihapus dari DB client (meniru baris yang terlanjur dilompati) →
   `POST /sync/now {}` → `pulled 0`, tetap hilang; `POST /sync/now {"full":true}` → `pulled 8`,
   kedua lampiran kembali.
5. **Hub versi lama:** baris feed disisipkan terbalik (`9 ticketAttachment`, `10 ticket`) → client
   tetap menerapkan **keduanya** dan kursor maju ke 10. Log kedua server bersih (nol error/warning).
