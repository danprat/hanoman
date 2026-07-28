# Audit SPEC-351 — Git graph terpotong / tak lengkap saat scroll ke bawah

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major
**Status:** doc-of-record perbaikan (Spec & Plan di-skip — akar jelas, diff kecil, ADR-0040)

## Keluhan

> **Actual:** saat ini git graph nya terpotong.
> **Expected:** git graph dapat scroll ke bawah sampai saya tau history git graph.

## Investigasi

Dua hipotesis bersaing untuk kata "terpotong":

- **(A) Rantai layout memotong kartu** — `#root { height:100vh; overflow:hidden }` →
  `Shell` → `<main flex:1 minHeight:0 overflow:auto>` → pembungkus `minHeight:100%`
  `display:flex` → root `IdeScreen` (flex kolom) → root `GitGraph` (grid,
  `alignItems:"start"`) → `Card` (**`overflow:"hidden"`**). Kartu ber-`overflow:hidden`
  di dalam rantai flex/grid adalah pola klasik pemotongan senyap: minimum otomatisnya
  jadi 0, isinya terpotong tanpa scrollbar.
- **(B) Jendela data dibatasi** — `GitGraph` hanya pernah meminta 200 commit.

### Bukti A — DIBANTAH

Rantai DOM/CSS di atas direplikasi 1:1 (200 baris × `ROW_H` 30px) lalu diukur di
Chrome headless 1400×900:

```
mainClientH 749 · mainScrollH 6092 · scrollTop(bottom) 5343
wrapH 6092 · ideH 6036 · grH 6002 · cardH 6002 · rowsH 6000
lastRow bottom 780 ≤ main bottom 813  →  lastRowVisible: true
```

`main` menggulir penuh dan baris terakhir terjangkau. Tinggi `Card` = tinggi isinya
(6002 ≈ 200×30 + chrome) — tak ada kompresi. Penyebabnya: pembungkus di `<main>`
memakai `min-height:100%` (bukan `height`), jadi `height:auto` tetap tumbuh mengikuti
isi dan free space flex tak pernah negatif. Komentar di `ds/shell.tsx:147` memang
menyengaja ini. **Hipotesis A gugur — tak ada bug layout.**

### Bukti B — TERKONFIRMASI (akar masalah)

`src/src/screens/GitGraph.tsx:243` — satu-satunya pemanggilan data:

```ts
api.ideGraph(projectId, 200, { branches: …, showRemote: …, showTags: … })
```

Angka `200` **hardcode**, tanpa state, tanpa paginasi, tanpa "muat lebih", tanpa
infinite-scroll. `load()` selalu meminta jendela yang sama — baik saat mount, saat
opsi tampilan berubah, maupun tiap tick silent poll 4 dtk (SPEC-245).

Rantainya meneruskan angka itu apa adanya ke `git log --max-count`:

- `src/src/api/client.ts:148` — `ideGraph(id, limit = 200, opts?)`
- `server/src/routes/ide.ts:78` — `const limit = Number(q.limit) || 200`
- `server/src/services/git-ide.ts:115,125` — `listGraph(repoDir, limit)` →
  `git log --date-order --max-count=${limit} … --all`

Server **tidak** membatasi apa pun: `?limit=` bebas. Jadi pemotongan murni keputusan
client.

Ukuran nyata di repo ini:

```
git rev-list --count --all            → 967
git log --date-order --max-count=200 --all | wc -l → 200
baris terakhir jendela 200            → d003782 2026-07-21 feat(spec-257): …
```

**767 dari 967 commit (79% history) tak pernah bisa dilihat.** Yang tampak hanya
~7 hari terakhir. Dan karena daftar berhenti begitu saja — tak ada baris penutup,
hitungan, atau penanda "masih ada lagi" — bagi operator itu tak terbedakan dari
"segitulah seluruh history". Persis keluhannya: scroll ke bawah, lalu terpotong.

## Root cause

`GitGraph` memperlakukan `limit=200` sebagai konstanta seumur hidup komponen, bukan
sebagai **halaman pertama**. Tak ada mekanisme apa pun untuk memperbesar jendela,
dan tak ada sinyal visual bahwa jendela itu ada. Endpoint sudah mendukung `?limit=`
sejak awal — hanya UI yang tak pernah memakainya.

## Perbaikan

Ubah `200` dari konstanta jadi **halaman**, di satu komponen (`GitGraph.tsx`):

1. State `limit` (mulai `PAGE = 200`) masuk dependency `load` → berubah = refetch.
   Silent poll ikut memakai `limit` berjalan, jadi commit yang sudah dimuat tak
   pernah menyusut kembali tiap tick.
2. `hasMore` diturunkan dari hasil fetch: `g.commits.length >= limit`. Swaselaras —
   saat halaman berikutnya balas lebih sedikit dari yang diminta, history habis.
3. **Baris penutup** di kaki daftar: `N commit dimuat` + tombol `Muat 200 lagi` saat
   `hasMore`, atau `seluruh history` saat habis. Ini juga menutup lubang "tak ada
   sinyal truncation".
4. **Auto-load saat tersentuh** — `IntersectionObserver` pada baris penutup memanggil
   `more()` begitu ia masuk viewport, sehingga menggulir ke bawah cukup untuk terus
   memuat (persis bunyi *expected*); tombol tetap ada sebagai jalur manual dan
   fallback lingkungan tanpa `IntersectionObserver` (mis. jsdom).
5. `limit` di-reset ke `PAGE` saat `projectId`/`gopts` berubah — query baru = jendela
   baru, bukan mewarisi kedalaman query sebelumnya.

**Server tidak disentuh.** Pengerasan `Number(q.limit) || 200` sempat direncanakan
dengan dugaan `?limit=-5` bocor jadi `--max-count=-5` lalu git exit≠0 → `catch` →
graph kosong senyap. Test yang ditulis untuk membuktikannya **hijau sejak awal**;
pengukuran langsung menunjukkan dugaan itu salah:

```
git log --max-count=-5 --oneline --all   → 904 baris, exit 0   (negatif = tanpa batas)
git log --max-count=0  --oneline         → 0 baris             (dan 0 falsy → jatuh ke 200)
```

`Number("abc")` juga NaN → falsy → 200. Ketiga masukan buruk sudah berperilaku aman,
jadi tak ada yang perlu diperbaiki. Yang tersisa dari langkah itu cuma satu **penjaga
kontrak** di `server/test/ide.route.test.ts`: sebelum ini tak ada satu pun test yang
memanggil `/graph` dengan `?limit=` non-default, padahal paginasi client kini
bersandar penuh padanya.

Tanpa perubahan skema, tanpa migration, tanpa ADR, tanpa endpoint baru, tanpa
perubahan server: bentuk respons `GET /projects/:id/graph` tak berubah dan `?limit=`
sudah bagian kontrak sejak SPEC-182.

Catatan biaya sadar: poll 4 dtk ikut membesar seiring `limit`, tapi pertumbuhannya
dibatasi niat operator (hanya tumbuh saat ia benar-benar menggulir ke bawah), dan
`git log --max-count` ber-orde milidetik pada 967 commit.

## Verifikasi

- Unit (`src/test/git-graph-view.test.tsx`): halaman pertama meminta `limit` 200 ·
  daftar berhenti dengan baris penutup + tombol saat penuh · klik tombol refetch
  dengan 400 dan merender baris baru · history habis → `seluruh history`, tombol
  hilang · ganti filter branch me-reset jendela ke 200.
- Route (`server/test/ide.route.test.ts`): `?limit=` non-default dihormati.
- Manual (server nyata + curl): `GET /api/projects/:id/graph?limit=…` menghormati limit
  dan bisa melampaui 200 pada repo 967 commit.
