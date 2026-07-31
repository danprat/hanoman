# ADR-0064 — `Project.id` renameable lewat operasi rename khusus (cascade + merambat sync)

**Status:** accepted · **Tanggal:** 2026-07-21 · **Spec:** SPEC-255
**Terkait:** SPEC-146 (id kekal — sebagian **dicabut** di sini) · [ADR-0045](0045-skema-sync-synclog-version-stamp.md)/[0046](0046-kanal-ws-sync-terpisah.md) (sync) · **ADR-0060** (dicabut, [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md)) (DSN) · [ADR-0062](0062-help-center-tiket-publik-triase.md) (Help Center)
**Doc-of-record audit:** audit SPEC-255 — dokumen auditnya dipensiunkan di SPEC-386 ([ADR-0083](0083-retensi-dokumen-audit.md)); **ADR ini** adalah rekaman permanennya.

## Konteks

`Project.id` adalah **slug + primary key** yang selama ini **kekal** (SPEC-146): tak ada endpoint rename,
`PATCH /projects/:id` sengaja tak menyentuh `id`, UI tak punya input id. Alasannya id memikul kunci asing.
Tapi id juga **meng-embed dua permukaan publik**: DSN ingest `/api/ingest/<id>?key=` (ADR-0060) dan URL
Help Center `/help/<id>` (ADR-0062) — keduanya **disajikan oleh hub publik** (hanoman.nafanesia.id). Bila
operator salah menamai project atau id perlu berganti, tak ada jalur resmi; satu-satunya opsi adalah
hapus+buat ulang yang membuang semua Spec/Error/Ticket. SPEC-255 meminta id dapat diedit, dengan konfirmasi
dampak, dan **perambatan ke server sync** ("server harus berganti juga").

Kendala teknis (lihat audit): FK `Spec/ErrorGroup/Ticket → Project` **sudah `ON UPDATE CASCADE`** (bawaan
Prisma untuk `onDelete: Cascade`; diverifikasi live — `UPDATE Project.id` mem-cascade otomatis), jadi **tak
perlu migration**. Sisa kendala: ada 4 referensi longgar tanpa FK (`Notification/SessionResult/ErrorEvent/
TicketAttachment`) + `LocalBinding.projectId` (`@id`, local-only) yang **tak ikut cascade** → UPDATE manual;
dan protokol sync ber-`recordId` upsert-by-id **tak punya operasi rename** — push id baru = INSERT project
baru di hub, id lama yatim.

## Keputusan

1. **Id bukan lagi kekal, tapi bukan pula mutable field biasa.** Rename hanya lewat **operasi rename khusus**
   dengan efek samping eksplisit + guard sendiri — **bukan** field di `PATCH`/`zUpdateProject` (tetap tak
   menyentuh id). Ini **mencabut sebagian invariant SPEC-146** ("tidak ada endpoint rename").

2. **Tanpa migration / tanpa perubahan skema.** FK `Spec/ErrorGroup/Ticket → Project(id)` **sudah
   `ON UPDATE CASCADE`** (bawaan Prisma; diverifikasi live). `UPDATE Project.id` mem-cascade otomatis — tak
   ada `migration.sql`, `schema.prisma` tak berubah. (Konsisten dengan "jangan ubah skema tanpa migration+ADR"
   AGENTS.md: skema memang tak diubah.)

3. **Service `renameProject(oldId, newId)`** dalam satu `prisma.$transaction`:
   - Validasi `newId` = slug sah (`zProjectId`: `^[a-z0-9][a-z0-9-]*$`) & **belum dipakai** (409 bila ada).
   - **Guard sesi aktif** (cermin `DELETE`): tolak bila ada sesi tmux aktif milik project (409).
   - `UPDATE Project.id` (cascade OTOMATIS ke 3 FK) + `UPDATE` manual 4 referensi longgar
     (`Notification/SessionResult/ErrorEvent/TicketAttachment`) + **pindah key `LocalBinding`** (delete+create,
     karena `projectId` adalah `@id`) + naikkan `version` (version-stamp sync).

4. **Endpoint** `POST /projects/:id/rename { newId }` → `200 { id, dsnUrl?, helpUrl?, affected }` di mana
   `affected` = jumlah record tersentuh per tabel (untuk teks konfirmasi & audit). `400` slug invalid,
   `404` project, `409` id terpakai / sesi aktif. Terpisah dari `PATCH` karena efek samping & guard berbeda.

5. **Operasi rename di protokol sync** (perambatan ke hub + siar ke node lain):
   - Klien meng-enqueue outbox `("project", newId)` **dan** menandai rename. Push membawa penanda
     `renamedFrom: oldId` di `data`. `applyPush` untuk entitas `project`: bila `renamedFrom` ada, row `oldId`
     ada, dan `newId` belum ada → **rename in place** (bukan insert baru) lalu lanjut upsert field biasa;
     tulis `SyncLog` rename → siar changefeed. `applyRemote`/`upsertLocal` di node penerima melakukan rename
     yang sama. `FIELDS.project` (whitelist) **tak berubah** — `renamedFrom` adalah penanda kontrol, bukan kolom.
   - Bila hub tak menemukan `oldId` (mis. node fresh yang me-replay dari cursor 0): rename jadi no-op lalu
     upsert biasa membuat row di `newId` → konvergensi tetap terjaga.

6. **DSN & Help Center otomatis benar** (keduanya derived saat baca dari `id`); `ingestKeyHash` tak berubah.
   Endpoint rename **mengembalikan** `dsnUrl`/`helpUrl` baru (bila monitoring/help aktif) agar UI menyuruh
   operator memperbarui kode project & tautan yang beredar. Kode eksternal & tautan lama **tak bisa** kita
   sentuh — itu batas fitur, disurat di konfirmasi.

7. **UI**: input "ID project" di `EditProjectModal` + dialog konfirmasi ber-daftar dampak (DSN, Help Center,
   sync ke server) sebelum submit; sukses menampilkan DSN/URL baru.

## Konsekuensi

- `Project.id` kini dapat berganti secara **transaksional & merambat**; semua referensi (FK + longgar +
  LocalBinding) konsisten. Hub & node lain konvergen ke id baru via changefeed — DSN/Help publik ikut ganti.
- Guard sesi aktif membuat rename tak menabrak `projectId` in-memory sesi berjalan.
- Batas: kode/DSN di project eksternal & tautan Help lama tak auto-update; operator diberitahu di konfirmasi.
- Data-model.md & api-contract.md diperbarui: id "kekal" → "renameable lewat `POST /projects/:id/rename`".

## Alternatif yang ditolak

- **`id` sebagai field biasa di `PATCH`/`zUpdateProject`**: efek samping (cascade, sync rename, guard sesi,
  DSN/Help) terlalu besar untuk field yang bisa ikut no-op body `{}`. Ditolak — perlu operasi eksplisit.
- **Rename via delete-old + create-new (lokal & sync)**: menghapus id lama **meng-cascade** Spec/Error/Ticket
  (kehilangan data) dan sync tak punya operasi delete. Ditolak.
- **Rename lokal saja, tak merambat**: melanggar syarat eksplisit "server harus berganti juga" — hub publik
  yang menyajikan DSN/Help tak akan pernah ganti id. Ditolak.
- **Menambah `ON UPDATE CASCADE` ke semua kolom `projectId`**: 4 di antaranya **tanpa FK** (denormal/longgar)
  — cascade DB tak berlaku; harus UPDATE manual. Tiga FK nyata **sudah** punya `ON UPDATE CASCADE` → tak ada
  migration sama sekali. (Klarifikasi cakupan, bukan penolakan penuh.)
