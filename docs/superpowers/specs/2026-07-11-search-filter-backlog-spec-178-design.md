# SPEC-178 · Search Filter Backlog — Design

**Tanggal:** 2026-07-11
**Sumber:** brief · prioritas tinggi
**Status:** design disetujui

## Objective

Tambahkan filter backlog untuk mempermudah pencarian. Saat ini sulit memfilter
dan mencari item backlog: satu-satunya penyaring adalah tab sumber
(Semua/Brief/QA) dan dropdown project. Tak ada pencarian teks, tak ada filter
stage, tak ada filter prioritas — menemukan satu spec di antara puluhan berarti
memindai mata.

## Outcome

Toolbar backlog mendapat tiga penyaring baru:
1. **Kotak pencarian teks** — live, tanpa submit, cocokkan pada id + judul + objective.
2. **Filter stage** — Brainstorm / Objective / Spec / Plan / Execute / Done.
3. **Filter prioritas** — tinggi / sedang / rendah.

Ketiganya berlaku serentak dengan tab sumber & filter project yang sudah ada,
dan berlaku di ketiga mode tampilan (Grid, List, Board).

## Scope & batasan

- **Frontend saja.** Perubahan terisolasi di `src/src/screens/BacklogScreen.tsx`.
  Tidak menyentuh API, DB, `shared`, runner, atau server. List `backlog` sudah
  utuh di memori dan sudah disaring client-side (`backlog.filter(...)`); ini
  sekadar menambah predikat.
- **Tanpa dependensi baru.** Pakai komponen DS yang ada (`Input` dengan
  `leftIcon="search"`, `Select`).

## Arsitektur

### State

Tiga state lokal baru di `BacklogScreen`:

| State | Default | Kepemilikan |
|-------|---------|-------------|
| `q` (teks pencarian) | `""` | lokal komponen |
| `stageFilter` | `"all"` | lokal komponen |
| `prioFilter` | `"all"` | lokal komponen |

Filter project tetap *lifted* ke App via props `projectFilter`/`onProjectFilter`
(SPEC-146, tak diubah). Search/stage/prioritas cukup view-local — tak ada alasan
mengangkatnya; tak ada layar lain yang membutuhkannya.

### Logika filter

Perpanjang rantai `filtered` yang sudah ada:

```ts
const needle = q.trim().toLowerCase();
const filtered = backlog.filter((s) =>
  (tab === "all"        || s.source    === tab) &&
  (proj === "all"       || s.projectId === proj) &&
  (stageFilter === "all"|| s.stage     === stageFilter) &&
  (prioFilter === "all" || s.priority  === prioFilter) &&
  (needle === "" ||
    (s.id + " " + s.title + " " + s.objective).toLowerCase().includes(needle)));
```

Pencarian: substring case-insensitive pada **id + title + objective** — tiga field
teks utama yang memang tampil di kartu/baris. Tanpa debounce: list kecil dan
seluruhnya client-side, render ulang murah.

### Layout — toolbar 2 baris

Baris toolbar sekarang sudah padat, jadi penyaring dipindah ke baris kedua yang
mengelompokkan semua kontrol "penyempit":

```
Baris 1:  [Semua|Brief|QA]  ·······  [Grid|List|Board]  «N spec»
Baris 2:  [🔍 Cari backlog… (flex:1)]  [Project▾] [Stage▾] [Prioritas▾]
```

- Baris 1: tab sumber (kiri) + toggle view & hitungan spec (kanan) — seperti sekarang,
  minus dropdown project yang turun ke baris 2.
- Baris 2: `Input` search (leftIcon `search`, `flex:1`) diikuti tiga `Select`:
  project, stage, prioritas.

Opsi `Select` stage & prioritas berasal dari konstanta yang sudah ada
(`B_STAGES`, kunci `B_PRIO`), masing-masing didahului opsi `{ value: "all" }`.

### Detail penting

- **Pagination**: kunci `usePaged` menyertakan `q|stageFilter|prioFilter` (selain
  `tab|proj` yang sudah ada) agar halaman reset ke 1 saat filter berubah.
- **Empty-state "Reset filter"**: tombol reset ikut membersihkan `q`,
  `stageFilter`, `prioFilter` — bukan hanya `tab` & `proj`.
- **Board**: tak dipaginasi tapi tetap memakai `filtered` yang sama, jadi search
  otomatis berlaku di board.

## Testing

Perluas pola `src/test/project-filter.test.tsx` (render `BacklogScreen`, assert
teks spec muncul/hilang). Kasus:

1. Ketik di search → hanya spec yang id/judul/objective-nya cocok yang tampil.
2. Filter stage → hanya spec di stage itu.
3. Filter prioritas → hanya spec prioritas itu.
4. Kombinasi search + stage + prioritas → irisan.
5. Search kosong + semua filter "all" → semua spec tampil (regresi tak menyaring).

## Yang sengaja dilewati (YAGNI)

- Debounce input — list lokal & kecil.
- Fuzzy match / ranking — substring cukup untuk backlog puluhan item.
- Highlight kecocokan di hasil.
- Persistensi filter ke URL / localStorage.

Tambahkan bila list membesar signifikan atau diminta eksplisit.
