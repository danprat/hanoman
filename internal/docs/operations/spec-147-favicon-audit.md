# SPEC-147 — audit: tidak ada favicon

Fase **Audit** dari alur QA (audit → keputusan → (spec → plan)? → execute, SPEC-145/ADR-0020).
Dokumen ini menetapkan akar masalah dan batas perbaikannya. **Tidak ada perubahan kode di fase
ini.**

- Sumber: backlog qa · prioritas tinggi · severity `major`
- Hilir: [spec SPEC-147](spec-147-favicon-spec.md)
- Gejala dilaporkan: tab browser tidak menampilkan ikon untuk hanoman. Expected: "tambahkan
  favico" (favicon).

> **Koreksi (fase Spec).** Dua klaim di bawah terlalu longgar. (1) Mark "Buntut" tidak hanya
> hidup di `.prototype/` — ia sudah diport ke `src/src/ds/marks.tsx:54-60` dan dirender sidebar
> (`src/src/ds/shell.tsx:29`); path di prototipe justru aproksimasi kasar untuk thumbnail.
> (2) Keputusan desain sebenarnya **sudah terkunci** di seksi "App icon & favicon"
> (`.prototype/Hanoman Brandmark.html:243-254`), dan aplikasi ini bertema tunggal sehingga tak ada
> pertanyaan light/dark. Akar masalah di bawah tetap berlaku utuh. Rinciannya di
> [spec SPEC-147](spec-147-favicon-spec.md).

## Akar masalah

Favicon tidak pernah ditambahkan — bukan regresi, ketiadaan sejak awal.

- `src/index.html:1-12` tidak punya `<link rel="icon">` sama sekali. Vite menyuntik markup
  bawaannya sendiri hanya untuk HMR; ia tidak menyisipkan favicon apa pun bila `index.html`
  tidak memintanya.
- Vite root proyek ini adalah `src/` (`src/vite.config.ts`), sehingga direktori statis yang
  dikenali adalah `src/public/` — direktori itu **tidak ada**. Tidak ada berkas `.ico`/`.svg`/
  `.png` di mana pun di bawah `src/` yang bisa dipasang sebagai favicon.
- Browser lalu jatuh ke perilaku bawaannya: request `GET /favicon.ico` yang dilayani dev
  server/static host sebagai 404, dan tab menampilkan ikon generik/kosong.

Jadi ini bukan bug logika, melainkan satu aset dan satu tag yang belum pernah dibuat.

## Aset yang tersedia untuk fase Spec

Repo sudah punya brand mark yang cocok jadi sumber favicon, tapi belum tersambung ke build
apa pun:

- `.prototype/Hanoman Brandmark.html:39-42` — SVG `viewBox="0 0 100 100"`, arah terpilih
  "Buntut" (ekor melingkar, Anoman Obong), dipakai sebagai thumbnail bundler prototipe saja.
  Warna solid `#b8863b` (dekat token `--brass-500` di `internal/docs/design-system/design-system.md`)
  dengan mark putih.
- Berkas ini murni artefak desain prototipe (`.prototype/`), bukan bagian dari `src/` yang
  di-build — tidak otomatis dipakai runtime mana pun hari ini.

Belum ada keputusan format (`.svg` tunggal vs `.ico` multi-resolusi vs `apple-touch-icon`
tambahan), belum ada keputusan varian warna untuk mode gelap/terang (`--surface-page` bisa
`bone-000` atau `ink-900` tergantung tema — lihat `design-system.md`), dan belum ada keputusan
di mana aset itu ditaruh (`src/public/` perlu dibuat).

## Rekomendasi untuk fase Spec

1. Pilih format aset (disarankan `.svg` sebagai favicon utama + fallback `.ico` untuk browser
   lama) yang diturunkan dari mark "Buntut" di `.prototype/Hanoman Brandmark.html:41`, konsisten
   dengan token warna brass/bone yang sudah dipakai di `internal/docs/design-system/design-system.md`.
2. Buat `src/public/` dan taruh aset di sana; tambah `<link rel="icon" ...>` (dan
   `apple-touch-icon` bila format mendukung) di `src/index.html`.
3. Beri satu pemeriksaan manual — buka `pnpm dev` dan pastikan tab browser menampilkan ikon,
   dan `GET /favicon.ico` (atau path aset yang dipilih) tidak lagi 404. Ini aset statis murni;
   tidak ada logika untuk diuji unit.

## Kenapa ini bukan jalur `execute`

Menuntut keputusan desain (format aset, varian warna untuk light/dark, dari mana mark
diturunkan) yang belum terkunci di `internal/docs/design-system/design-system.md` maupun di
mana pun — bukan sekadar satu-dua baris kode mekanis. Sesuai instruksi keputusan jalur
(SPEC-145/ADR-0020): saat ragu soal keputusan desain, pilih `spec`.

## Verifikasi

Akar masalah dipastikan lewat pembacaan `src/index.html`, `src/vite.config.ts`, dan
enumerasi direktori `src/` — tidak ada `public/` maupun berkas favicon di mana pun. Tidak ada
reproduksi runtime yang diperlukan; ketiadaan berkas terverifikasi secara statis.

## Rujukan

- ADR-0020 — [fase perencanaan QA dipangkas oleh keputusan audit](../adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md)
- SPEC-145 — [QA after audit: keputusan sebelum spec](spec-145-qa-after-audit-objective.md)
- [design-system](../design-system/design-system.md) — token warna brass/bone dipakai brand mark
- [agent-documentation-workflow](agent-documentation-workflow.md) — alur QA audit → spec → plan → execute
