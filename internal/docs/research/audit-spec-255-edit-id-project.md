# audit SPEC-255 — Edit id project (rename slug): berpengaruh ke DSN, Help Center, dan sync ke server

**Status:** accepted · **Tanggal:** 2026-07-21 · **Sumber:** qa · **Prioritas:** tinggi
**Keputusan:** luas & berisiko — menyentuh **invariant data-model** (`Project.id` kekal), **skema/migration** (FK), **protokol sync** (rename lintas node), plus DSN/Help Center publik dan UI → **Spec → Plan → Execute penuh** (ADR-0064). Bukan diff kecil, bukan sekadar bug: fitur baru yang membalik keputusan lama.

## Keluhan

> Dapat melakukan edit id project sehingga berpengaruh DSN dan Help Center, untuk mempermudah
> pergantian jika ada perubahan id. Beri konfirmasi bahwa ini akan berpengaruh ke semua hal
> yang terkait project, serta akan berpengaruh sync ke server dan server harus berganti juga.

## Investigasi (systematic-debugging)

### Fase 1 — akar masalah

**Tidak ada bug — ketidakmampuan meng-edit `Project.id` adalah invariant yang disengaja.**
`Project.id` adalah **slug + primary key** tanpa `@default`, didokumentasikan **kekal / tak ada endpoint
rename** (`internal/docs/architecture/data-model.md`, AGENTS.md §Data). Tiga lapis menegakkannya:

1. **Skema** (`server/prisma/schema.prisma:11`): `id String @id`. Ia jadi **target FK `onDelete: Cascade`**
   untuk `Spec.projectId` (:44), `ErrorGroup.projectId` (:229), `Ticket.projectId` (:268). **DIVERIFIKASI LIVE
   (Fase 3):** FK-FK ini **sudah `ON UPDATE CASCADE`** — Prisma memancarkannya sebagai bawaan untuk relasi
   `onDelete: Cascade` (lihat semua `migration.sql`: `ON DELETE CASCADE ON UPDATE CASCADE`). Bukti transaksi
   rolled-back: `UPDATE "Project" SET id='ztest2'` → `Spec.projectId` otomatis jadi `ztest2`. **Jadi tak perlu
   migration FK** — hipotesis awal ("hanya ON DELETE") KELIRU, dikoreksi di sini. Selain FK, ada **referensi
   longgar tanpa FK** yang menyimpan `projectId` sebagai
   String biasa: `Notification.projectId` (:62), `SessionResult.projectId` (:155), `ErrorEvent.projectId`
   (:240, denormal), `TicketAttachment.projectId` (:279, denormal), dan `LocalBinding.projectId` (:185,
   `@id`, LOCAL-only). Semua ini **tak ikut cascade apa pun** — harus di-update manual.
2. **API** (`server/src/routes/projects.ts:58-68`): `PATCH /projects/:id` **sengaja tak menyentuh `id`**
   ("Rename tak menyentuh `id`"). `zUpdateProject` (`shared/src/dto.ts:29-34`) hanya `name/desc/gitRemote/repoDir`.
3. **UI** (`src/src/App.tsx:361`): `EditProjectModal` — komentar eksplisit "`id` tak ikut: ia kunci asing
   spec/run/trigger (SPEC-146)"; tak ada input id.

Jadi "akar masalah" = keputusan desain lama (SPEC-146), bukan defect. Mengaktifkan rename = fitur baru yang
harus menembus tiga lapis itu **plus** artefak turunan yang meng-embed slug.

### Fase 2 — blast radius (apa yang ikut berubah saat id berganti)

**DSN (SPEC-249/ADR-0060).** `dsnUrl(slug,key,base)` = `${base}/api/ingest/${slug}?key=${key}`
(`server/src/services/ingest-key.ts:22`). Slug **adalah** `projectId`. DSN **diturunkan saat baca**, tak
disimpan — jadi begitu id berganti, DSN baru otomatis benar. Tapi: (a) kode project eksternal masih memakai
DSN lama → harus di-update manual (tak bisa kita sentuh); (b) `ingestKeyHash` tetap valid (tak berubah).
Ingest endpoint melookup `params.slug` → project by `id` (`server/src/routes/ingest.ts`), jadi path lama 404
setelah rename. **→ konfirmasi wajib menampilkan DSN baru.**

**Help Center (SPEC-253/ADR-0062).** URL publik `${base}/help/${id}` (`projects.ts:123`, `shared/src/api.ts:111-114`).
Juga diturunkan dari id saat baca → otomatis benar setelah rename, tapi tautan lama yang beredar **rusak**.
Tiket lama tetap terhubung via `Ticket.projectId` (ikut ter-rename). **→ konfirmasi wajib menampilkan URL baru.**

**Sync server↔client (SPEC-213/ADR-0043/0045/0046) — bagian tersulit.** Sync ber-`recordId` = `Project.id`.
`FIELDS.project = ["name","desc","kind","stack","gitRemote"]` (`server/src/services/sync.ts:23`) — `id`
**bukan field, ia kunci record**. `applyPush`/`upsertLocal` **upsert by id** (`sync.ts:79,110`). Konsekuensi:
push project ber-`newId` → **INSERT project baru** di hub, `oldId` **yatim** (berikut Spec/Error/Ticket-nya di
hub). `syncOnce` (`sync-client.ts:49-59`) drain outbox by `snapshot(entity,recordId)`; entri outbox `oldId`
→ snapshot null → cleared; entri `newId` → insert. **Tak ada operasi rename maupun delete di protokol.** Inilah
"server harus berganti juga" yang belum terpenuhi: hub publik (hanoman.nafanesia.id) yang **menyajikan DSN
ingest & Help Center** tak akan pernah ganti id-nya. Rename harus **merambat sebagai operasi rename** ke hub,
lalu **disiarkan** (changefeed `SyncLog`) agar semua node konvergen.

**Sesi berjalan.** Sesi tmux ber-id turunan dari `Spec.id` (bukan `Project.id`), tapi `Session`/pty menyimpan
`projectId` untuk atribusi & guard DELETE (`projects.ts:74`). Rename saat ada sesi aktif meninggalkan `projectId`
in-memory basi. **→ tolak rename bila ada sesi aktif (cermin guard DELETE `projects.ts:74-75`).**

**LocalBinding (LOCAL-only).** `projectId @id` → override path per-mesin. Harus ikut pindah key, else path
override lenyap. Tak disync (benar — path lokal).

### Ringkas: yang harus di-update saat rename `oldId → newId`
| Tabel | Relasi | Cara update |
|---|---|---|
| `Project.id` | PK | root of rename (`UPDATE Project.id`) |
| `Spec.projectId` | FK cascade | **otomatis** (FK sudah `ON UPDATE CASCADE`) |
| `ErrorGroup.projectId` | FK cascade | **otomatis** (FK sudah `ON UPDATE CASCADE`) |
| `Ticket.projectId` | FK cascade | **otomatis** (FK sudah `ON UPDATE CASCADE`) |
| `Notification.projectId` | longgar | manual UPDATE |
| `SessionResult.projectId` | longgar | manual UPDATE |
| `ErrorEvent.projectId` | denormal | manual UPDATE |
| `TicketAttachment.projectId` | denormal | manual UPDATE |
| `LocalBinding.projectId` | `@id` local | manual (delete+create key) |
| DSN, Help URL | derived | otomatis; surface nilai baru |
| Sync hub + node lain | protokol | operasi rename + changefeed |

### Fase 3 — hipotesis desain (diverifikasi di Plan/Execute)

1. **Migration: TIDAK PERLU.** FK `Spec/ErrorGroup/Ticket → Project` **sudah `ON UPDATE CASCADE`** (diverifikasi
   live). `UPDATE Project.id` cascade otomatis. Skema Prisma tak berubah → tak ada `migration.sql`. (Ini
   mengoreksi hipotesis awal Fase 1.)
2. **Service `renameProject(oldId,newId)`** dalam satu `$transaction`: validasi `newId` slug sah & belum dipakai;
   `UPDATE Project.id` (cascade otomatis ke 3 FK); UPDATE 4 referensi longgar + pindah `LocalBinding`; guard sesi aktif.
3. **Endpoint** `POST /projects/:id/rename { newId }` → balikkan `{ id, dsnUrl?, helpUrl?, affected }`.
   Terpisah dari `PATCH` (bukan field biasa; punya efek samping besar & guard sendiri).
4. **Sync rename op**: encode rename di entitas `project` lewat penanda `renamedFrom` pada `data` push; `applyPush`
   men-*rename in place* (bukan insert baru) saat `renamedFrom` ada & row lama ada; tulis `SyncLog` rename →
   siar ke node lain; `applyRemote`/`upsertLocal` melakukan rename yang sama. Whitelist `FIELDS` tak berubah.
5. **UI**: input "ID project" di `EditProjectModal` + dialog konfirmasi yang menyebut dampak (DSN, Help Center,
   sync ke server) sebelum submit; tampilkan DSN/URL baru pada sukses.

## Rekomendasi

Kerjakan penuh via **ADR-0064** (mencabut sebagian invariant "id kekal" SPEC-146: id kini **renameable lewat
operasi rename khusus yang cascade + merambat sync**, bukan mutable field biasa). Spec → Plan → Execute; TDD di
tiap lapis (migration, service transaksi, endpoint, sync rename, UI). Uji nyata: boot server + curl rename +
verifikasi DSN/Help/sync.

## Tautan
- Data model: [data-model](../architecture/data-model.md) · Kontrak API: [api-contract](../architecture/api-contract.md)
- ADR: [0064 — Project.id renameable](../adr/0064-project-id-renameable.md)
- Terkait: SPEC-249/ADR-0060 (DSN), SPEC-253/ADR-0062 (Help Center), SPEC-213/ADR-0045-0046 (sync)
