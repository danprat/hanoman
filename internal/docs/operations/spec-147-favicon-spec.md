# SPEC-147 — Spec: favicon

**Fase:** Spec (dikunci) · 2026-07-10
**Jenis:** QA — alur audit → keputusan → **spec** → plan → execute (SPEC-145 / ADR-0020)
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Hulu:** [audit SPEC-147](spec-147-favicon-audit.md).
**Turunan:** plan → [`docs/superpowers/plans/2026-07-10-hanoman-favicon-spec-147.md`](../../../docs/superpowers/plans/2026-07-10-hanoman-favicon-spec-147.md).

## Masalah

`src/index.html` tidak pernah punya `<link rel="icon">`, dan `src/public/` — direktori statis
Vite untuk root `src/` — tidak ada. Tab browser menampilkan ikon generik. Bukan regresi:
favicon memang belum pernah dibuat. Akar lengkapnya di dokumen audit.

## Koreksi terhadap audit

Audit menutup dengan `path: "spec"` atas dasar "belum ada keputusan desain (format aset, varian
warna light/dark, sumber mark)". Pembacaan lebih jauh pada fase ini menemukan **ketiganya sudah
terkunci**, dan audit melewatkannya:

1. **Mark sudah hidup di `src/`, bukan cuma di `.prototype/`.** `src/src/ds/marks.tsx:54-60`
   (`MarkBuntut`) adalah port resmi mark "Buntut" ke aplikasi. Audit hanya menyebut
   `.prototype/Hanoman Brandmark.html:41` — dan path di sana justru **aproksimasi kasar** untuk
   thumbnail bundler, bukan mark sebenarnya.

2. **Desain ikon sudah dispesifikasi.** `.prototype/Hanoman Brandmark.html:243-254` — seksi **05,
   berjudul persis "App icon & favicon"** — mengunci: tail di tengah squircle ber-radius ~24%,
   **putih di atas brass** sebagai ikon primer, ditunjukkan sampai ukuran 16 px. Seksi 03
   (`:207-227`) menamai 16 px sebagai lantai mark, dengan keterangan "favicon / status glyph".

3. **Tidak ada pertanyaan light/dark.** Aplikasi ini bertema tunggal — tak ada
   `prefers-color-scheme`, `data-theme`, maupun toggle di seluruh `src/src`; design-system menyebut
   "satu permukaan gelap: terminal log". Tile brass buram terbaca di atas chrome tab terang maupun
   gelap, jadi tak ada varian untuk diputuskan.

Bit `spec` tetap benar sebagai default konservatif ADR-0020 ("saat ragu, pilih `spec`"), dan spec
ini yang menutup keraguannya. Yang tersisa memang keputusan — tapi kecil, dan dijawab di bawah.

## Objective (dikunci)

**Tab browser menampilkan brand mark hanoman**, di dev maupun build produksi, memakai mark yang
sudah ada di design system — tanpa dependency baru, tanpa langkah build baru, dan tanpa menyentuh
server.

## Keputusan yang dikunci

1. **Bentuk: tile ikon, bukan mark telanjang.** Persis `IconTile`
   (`.prototype/Hanoman Brandmark.html:127-136`), yang juga sudah dirender sidebar hari ini
   (`src/src/ds/shell.tsx:24-30`: mark putih di atas `var(--accent)`):

   | Properti | Nilai | Sumber |
   | --- | --- | --- |
   | viewBox | `0 0 128 128` | grid mark (`marks.tsx:5`) |
   | tile fill | `#b8863b` | `--brass-500` (`tokens/colors.css:27`) |
   | tile radius | `30.72` = `128 × 0.24` | `IconTile` `borderRadius: size * 0.24` |
   | mark fill | `#fff` | `IconTile` "White on brass" |
   | mark scale | `0.58`, translate `26.88` | `IconTile` `Mark size={size * 0.58}`, dipusatkan |

   Hex ditulis literal, bukan `var(--brass-500)`: berkas `.svg` yang dimuat sebagai favicon adalah
   dokumen terpisah dan **tidak mewarisi custom property** dari halaman.

2. **Path di-*bake*, tidak dihitung saat runtime.** `HN_BUNTUT_D` (`marks.tsx:53`) adalah hasil
   `taperedSpiralPath({})` — dievaluasi di browser, tak pernah ada sebagai string literal. Favicon
   adalah berkas statis, jadi nilai fungsi itu dievaluasi **satu kali** dan hasilnya (4.579 karakter,
   `M 74.05 116.63 …`) ditulis ke `.svg`, dengan komentar provenance yang menunjuk balik ke
   `marks.tsx` — mengikuti gaya `marks.tsx:1-2` sendiri, yang mencatat asal port-nya.

   Duplikasi bentuk antara `marks.tsx` (runtime, untuk UI) dan `favicon.svg` (statis) diterima:
   mark adalah konstanta brand. Alternatif yang **ditolak**: plugin Vite yang men-generate favicon
   saat build (arsitektur baru untuk satu aset), dan injeksi `<link>` data-URI dari `main.tsx`
   (tab kosong sampai JS jalan, dan `HN_BUNTUT_D` tak lagi punya satu pembaca yang jelas).

3. **Format: `favicon.svg` saja.** Chrome, Firefox, dan Edge memakainya; **Safari 26+ — versi
   berjalan per Juli 2026 — sudah mendukung favicon SVG**. Aplikasi ini pun sudah menuntut browser
   modern: `tokens/colors.css:104` memakai `color-mix()`.

   **`.ico` tidak masuk.** Merasterisasi SVG menuntut toolchain di luar repo (Node tak punya
   rasterizer; tak ada devDependency gambar hari ini) demi sebuah dashboard localhost. Jalur
   upgrade-nya murah dan tercatat: bila suatu saat Safari lawas perlu didukung, jatuhkan
   `favicon.ico` ke `src/public/` — **tanpa perubahan markup sama sekali**, karena browser me-request
   `/favicon.ico` dari root dengan sendirinya. Tambahkan bila ada buktinya, bukan sebelum.

   Varian `prefers-color-scheme` di dalam SVG juga tidak masuk: tile-nya buram, dan Safari mengabaikan
   media query pada favicon.

4. **Lokasi: `src/public/favicon.svg`** (direktori baru). Vite root adalah `src/` (`pnpm dev` men-spawn
   `vite` dari `src/`, `src/package.json:6`), sehingga `publicDir` default-nya `src/public/`. Dev
   menyajikannya di `/favicon.svg`; `vite build` menyalinnya apa adanya ke `src/dist/`, yang di produksi
   disajikan `fastifyStatic` dari root (`server/src/app.ts:51-52`). **Server tidak disentuh.**

## Kriteria penerimaan (EARS)

- THE SYSTEM SHALL menyajikan sebuah dokumen `image/svg+xml` di `/favicon.svg`, baik di bawah dev
  server Vite maupun di bawah `fastifyStatic` pada build produksi.
- THE SYSTEM SHALL menyatakan favicon itu di `src/index.html` lewat
  `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`.
- THE SYSTEM SHALL menggambar favicon sebagai mark `buntut` putih di atas tile `#b8863b`
  ber-radius 24%, identik dengan `IconTile` design system.
- WHEN operator membuka dashboard di browser yang mendukung favicon SVG, THE SYSTEM SHALL
  menampilkan brand mark pada tab, bukan ikon generik.
- THE SYSTEM SHALL tidak menambah dependency runtime maupun devDependency.

## Test

Satu tes di `src/test/` yang **gagal pada kode hari ini**:

1. `src/index.html` memuat `rel="icon"` dengan `href="/favicon.svg"`.
2. `src/public/favicon.svg` ada, ber-`viewBox="0 0 128 128"`, dan memuat `#b8863b`.

Keduanya pembacaan berkas murni — tak butuh jsdom, tak butuh harness baru.

**Tidak ada** tes yang membandingkan `d` hasil bake dengan `taperedSpiralPath({})`. Tes semacam itu
menyalin ulang implementasinya untuk membuktikan implementasinya, dan akan menyala merah pada
perubahan brand yang memang disengaja. Geometri mark dijaga mata, bukan assert.

**Pemeriksaan nyata (wajib, sesuai CLAUDE.md):** boot `pnpm dev`, lalu
`curl -sI http://localhost:5173/favicon.svg` harus `200` dengan `content-type: image/svg+xml`.
Ini bukan formalitas: SPA fallback (`server/src/app.ts:54`) mengembalikan `index.html` untuk setiap
path non-`/api` yang tak ditemukan, sehingga favicon yang **hilang** akan terjawab `200 text/html`
alih-alih `404` — gagal diam-diam. Periksa `content-type`, bukan cuma status.

## Batas scope

- **Termasuk:** `src/public/favicon.svg` (baru) dan satu baris `<link>` di `src/index.html`; satu tes;
  docs + index. Hanya itu — dua berkas produksi.
- **Tidak termasuk:**
  - **`favicon.ico`, `apple-touch-icon`, PNG, `manifest.webmanifest`, PWA.** Tak satu pun diminta
    tiket ini. Jalur upgrade `.ico` tercatat di Keputusan 3.
  - **Varian dark-mode favicon.** Tak ada tema kedua di aplikasi ini.
  - **Meng-export `HN_BUNTUT_D` atau menyentuh `marks.tsx`/`shell.tsx`.** Favicon membaca desainnya,
    bukan kodenya.
  - **Perubahan server, skema, atau `vite.config.ts`.** `publicDir` sudah default ke tempat yang
    benar. Tak ada migration, jadi tak ada ADR (AGENTS.md menuntut ADR untuk perubahan skema);
    keputusan ini tak menggeser arsitektur apa pun, dan alasannya tercatat di sini.

## Prinsip yang dipegang

- **Desain sudah ada; jangan diputuskan ulang.** Seksi "App icon & favicon" menjawab format, warna,
  radius, dan lantai ukuran. Tugas spec ini menemukannya, bukan menciptakan varian keenam.
- **Aset statis, bukan pipeline.** Favicon adalah berkas. Setiap plugin build yang men-generate-nya
  adalah arsitektur baru untuk sesuatu yang berubah sekali per dekade.
- **Konvensi platform sebagai jalur upgrade.** `.ico` bisa ditambahkan nanti tanpa satu baris markup
  pun, karena browser memintanya sendiri. Itulah yang membuat menundanya aman.
- **Tes yang gagal kalau bug-nya kembali** — dan pemeriksaan `content-type`, karena SPA fallback
  membuat "hilang" menyamar sebagai `200`.

> Chiranjivi — spec bertahan lebih lama dari satu run. Plan turunannya tunduk pada pernyataan ini.
