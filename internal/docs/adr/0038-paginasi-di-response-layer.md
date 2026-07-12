# ADR-0038 — Paginasi/filter daftar di response layer, overlay atas set penuh

**Status:** aktif (SPEC-198). Menyempurnakan kontrak `GET /specs` (SPEC-168/173/180) & `GET /projects`.

## Konteks

Search/filter/paginasi backlog, Terminal picker, dan projects dulu 100% client-side: `App.tsx`
menarik seluruh dataset dan menyaring/memotong di browser. SPEC-198 memindahkannya ke API dengan
envelope `{ items, total, page, pageSize }`.

Jebakannya ada di `GET /specs`. Endpoint ini bukan list polos: ia (1) memuat **seluruh** spec,
(2) meng-overlay **stage live** dari phase-file sesi tmux, (3) **write-through** memajukan stage di
DB (CAS, forward-only — ADR-0008/SPEC-197), (4) menembakkan **notifikasi `done`** (SPEC-180). Array
penuh yang sama memberi makan hitungan Overview, kolom Board, picker Terminal, dan poll 3 detik yang
membanding `[id,stage]` lintas seluruh spec.

Kalau paginasi didorong ke query DB (`WHERE stage=`, `skip`/`take`), dua hal rusak: filter `stage`
mencocokkan stage DB yang **basi** (bukan stage live), dan overlay + write-through + notifikasi hanya
jalan atas **satu halaman** → spec di luar halaman **diam-diam berhenti maju stage-nya dan berhenti
bernotifikasi `done`**.

## Keputusan

**Paginasi & filter diterapkan di layer response, di memori, SETELAH overlay — bukan di query DB.**
`GET /specs` tetap `findMany` scope `project`/`source` (field stabil, aman), menjalankan overlay +
write-through + notifikasi atas **set penuh** itu, lalu `filterSpecs()` (q, stage, priority, startable
— semua cocok ke stage **live**) dan `paginate()` memotong **respons** saja. Tanpa `page`/`limit` →
seluruh item terfilter (dipakai full-fetch App, board, poll). `GET /projects` serupa: project-view
dihitung penuh (coverage/docStatus live), lalu filter `q` + paginasi di memori.

DB-level `skip`/`take` untuk specs **dilarang** oleh keputusan ini selama overlay masih bergantung
pada set penuh.

## Konsekuensi

- **Fitur tersembunyi selamat:** kemajuan stage + notifikasi `done` tetap jalan untuk semua spec,
  tak peduli halaman mana yang diminta klien. Dijaga test `advances + persists off-page specs even
  when paginated` di `server/test/specs.route.test.ts`.
- **Ceiling (ponytail):** `GET /specs` selalu memuat set penuh scope project ke memori. Backlog
  terbatas (ratusan) → potong-di-memori memadai. Bila jumlah spec meledak, revisit dengan
  materialisasi stage (persist stage live lebih agresif) supaya `stage` bisa jadi filter DB — ADR baru.
- Kontrak semua consumer daftar berubah ke envelope; `.items` dibuka di `App.tsx`, tiap layar daftar
  fetch potongannya sendiri via API.
