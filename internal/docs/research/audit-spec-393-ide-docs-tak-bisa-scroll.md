# Audit SPEC-393 — IDE Explorer & Docs tidak bisa digulir ke bawah

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-29
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> saat ini ide explorer dan docs serta source nya tidak bisa scrolling ke bawah

Tiga permukaan yang disebut: pohon berkas **IDE Explorer**, pane dokumen **Docs · Source of
Truth**, dan pane **source** berkas di IDE. Ketiganya menampilkan bagian atas isinya lalu berhenti
— tak ada scrollbar, roda mouse tak menggerakkan apa pun, dan sisa dokumen tak bisa dicapai.

## Akar masalah

`Card` (`ds/components/surfaces.tsx`) **selalu** membungkus `children`-nya dalam satu `<div>`
tambahan yang hanya membawa `padding`. Div itu `display: block` kecuali prop **`fill`** dipasang —
`fill`-lah yang membuat kartu ikut rantai flex, dengan menyetel `display:flex; flexDirection:column;
flex:1 1 auto; minHeight:0` pada **dua-duanya**: div terluar *dan* pembungkus anak.

SPEC-363 memindahkan tinggi pane Docs/IDE dari angka tetap (`maxHeight: 620`) ke rantai flex, tapi
memasang rantai itu lewat `style` pada **div terluar** `Card` saja:

```tsx
<Card padding={0} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
```

Pembungkus anak di tengah tetap `display: block`, sehingga `flex: 1 1 auto; minHeight: 0` pada pane
menjadi **inert** (induknya bukan flex container). Pane tumbuh setinggi isinya, pembungkus ikut
tumbuh, dan `Card` — yang tingginya sudah pasti dari grid dan ber-`overflow: hidden` — **memotong**
sisanya. Karena tak ada satu pun leluhur yang bisa menggulir, isi di bawah batas kartu digambar
tapi tak terjangkau.

Tiga call site, semuanya dari SPEC-363:

| Berkas | Baris | Pane yang terdampak |
| --- | --- | --- |
| `src/src/screens/DocsWorkspace.tsx` | 225 | pane dokumen Docs (preview **dan** editor) |
| `src/src/screens/IdeScreen.tsx` | 249 | pohon berkas Explorer + Staged/Changed |
| `src/src/screens/IdeScreen.tsx` | 273 | pane berkas: preview `.md`, **source**, diff |

Kartu di luar SPEC-363 tak terdampak: yang butuh rantai flex sudah memakai `fill` sejak
2026-07-10 (`1f19021`) — contoh kerjanya `ProjectsScreen.tsx:120` `<Card padding={0} fill>`.
`DocPreviewModal` (SPEC-385) juga aman: rantainya `Modal fillHeight` → `modal-body`, tanpa `Card`.

## Pengukuran

DOM diambil dari **komponen React aslinya** (bukan replika: `DocsWorkspace`/`IdeScreen` dirender
lalu `container.innerHTML` di-dump), dipasang di kerangka `ds/shell.tsx` yang sama persis dengan
CSS asli, lalu diukur di Chrome headless pada viewport 1512×813 (`<main>` = 757 px).

Rantai leluhur pane Docs, dari pane ke atas:

| # | Elemen | `display` | `flex` | `overflow` | tinggi | `scrollHeight` |
| --- | --- | --- | --- | --- | ---: | ---: |
| 0 | pane `doc-preview-scroll` | block | `1 1 auto` | auto | 11 830 | 11 830 |
| 1 | **pembungkus anak `Card`** | **block** | `0 1 auto` | visible | 11 885 | 11 885 |
| 2 | div terluar `Card` | flex | `0 1 auto` | **hidden** | **701** | 11 885 |
| 3 | root grid layar | grid | `1 1 0` | visible | 701 | 701 |

Baris #1 adalah mata rantai yang putus: `display: block`. Akibatnya pane (#0) `client === scroll`
— ia tak pernah menggulir, ia hanya tumbuh. Kartu (#2) tingginya benar (701 px) tapi isinya
11 885 px, jadi **11 184 px dipotong** `overflow: hidden`.

Angka lain yang terukur:

- Pane dokumen Docs berakhir di y = 11 966 px sementara `<main>` berakhir di y = 813 px.
- Pane berkas IDE: 11 820 px, tak menggulir, terpotong sama persis.
- Pohon berkas IDE Explorer (200 berkas): 5 776 px, tak menggulir, terpotong.
- `<main>` sendiri `scrollHeight === clientHeight === 757` → halaman pun tak punya apa-apa untuk
  digulir. Tidak ada scroller di mana pun pada rantai itu — cocok dengan keluhan.
- **Kontrol negatif:** kolom kiri Docs (bukan di dalam `Card`, grid item ber-`overflow: auto`)
  terukur `h = 701`, `scrollHeight = 701` — rantainya utuh dan akan menggulir saat isinya lebih
  tinggi. Jadi yang rusak memang khusus rantai yang melewati `Card`, bukan kerangka Shell.

## Mengapa test SPEC-363 tetap hijau

`src/test/preview-fill-height.test.tsx` menguji **kontrak style** pane (`flex: 1 1 auto`,
`overflow: auto`, tak ada tinggi px/vh) di jsdom, dan jsdom tak melayout. Ketiga assertion itu
masih benar hari ini — pane memang punya style yang tepat; yang salah adalah **induknya**, yang
tak pernah diperiksa. Karena itu test regresi yang ditambahkan menaiki rantai leluhur pane dan
menuntut setiap mata rantai meneruskan tinggi (`display` flex/grid + `minHeight: 0`), bukan
sekadar memeriksa pane-nya sendiri.

## Keputusan pasca-Audit

Temuan berconfidence tinggi (terukur, akar tunggal, kontrol negatif), dan perbaikannya mengganti
tiga pembukaan `Card` dengan prop `fill` yang sudah ada — tanpa perubahan API, data model,
migration, endpoint, atau arsitektur. **Spec dan Plan dilewati** sesuai ADR-0020/0040; dokumen ini
menjadi doc-of-record.

## Perbaikan

`<Card padding={0} style={{ display:"flex", flexDirection:"column", minHeight:0 }}>` →
`<Card padding={0} fill>` di tiga call site di atas. `fill` menyetel properti yang sama pada div
terluar **dan** pembungkus anak, jadi tak ada perubahan visual selain isinya kini bisa digulir.
Pane pohon berkas Explorer diberi `data-testid="ide-tree-scroll"` supaya rantainya bisa diuji.

**Sesudah perbaikan**, diukur ulang di Chrome dengan berkas, kerangka, dan viewport yang sama:

| Pane | Sebelum · `clientHeight` / `scrollHeight` / bisa digulir | Sesudah |
| --- | --- | --- |
| Docs · dokumen | 11 830 / 11 830 / **tidak** | 644 / 11 830 / **ya** |
| IDE · berkas (preview, source, diff) | 11 820 / 11 820 / **tidak** | 593 / 11 820 / **ya** |
| IDE · pohon Explorer | 5 776 / 5 776 / **tidak** | 593 / 5 776 / **ya** |

Sebelumnya `clientHeight === scrollHeight` di ketiganya — pane tak punya apa pun untuk digulir
karena ia justru tumbuh setinggi isinya. Sesudahnya tingginya dibatasi induk dan `scrollHeight`
tetap penuh, jadi sisa dokumen dicapai dengan menggulir pane itu sendiri.

Rantai leluhur pane Docs sesudah perbaikan (bandingkan dengan tabel di atas):

| # | Elemen | `display` | `overflow` | tinggi | `scrollHeight` |
| --- | --- | --- | --- | ---: | ---: |
| 0 | pane `doc-preview-scroll` | block | auto | 644 | 11 830 |
| 1 | pembungkus anak `Card` (`fill`) | **flex** | visible | 699 | 699 |
| 2 | div terluar `Card` | flex | hidden | 701 | **699** |
| 3 | root grid layar | grid | visible | 701 | 701 |

Kartu (#2) kini `scrollHeight` (699) ≤ tingginya (701): **tak ada lagi yang dipotong**
`overflow: hidden` — dulu 11 885 px isi di dalam kartu 701 px. `<main>` tetap 757 px dengan
`scrollHeight` 757 → halaman tidak ikut tumbuh; yang bergulir hanya pane di dalam kartunya,
persis perilaku yang dimaksud SPEC-363.
