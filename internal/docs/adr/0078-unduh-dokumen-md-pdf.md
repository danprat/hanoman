# ADR-0078 — Unduh dokumen: query `?download=` di endpoint dokumen + render PDF server-side

**Status:** accepted · **Tanggal:** 2026-07-28 · **Spec:** SPEC-361
**Terkait:** [ADR-0011](0011-docs-realtime-filesystem.md) (**memperluas** — docs = filesystem nyata,
jadi unduhan pun turunan disk, bukan artefak tersimpan), [ADR-0018](0018-coverage-nilai-turunan.md)
(nilai turunan saat dibaca), [ADR-0041](0041-prd-sebagai-dokumen-flow-project-level.md) (PRD sebagai
dokumen), [ADR-0028](0028-auth-sesi-opaque-di-db.md) (gate auth cookie),
[ADR-0057](0057-audit-only-source-flow.md) & [ADR-0076](0076-eskalasi-audit-dinamis-manifest-rekomendasi.md)
(dokumen audit sebagai deliverable)

## Konteks

hanoman menghasilkan dokumen sebagai deliverable nyata: PRD (ADR-0041), spec, plan, dan laporan
audit (ADR-0057/0076), ditambah Source of Truth `internal/docs/**` (ADR-0011). Semuanya bisa
dipratinjau di dashboard — `SpecDocsModal` (Backlog & Terminal), `PrdScreen`, `DocsWorkspace`,
dan viewer `.md` di IDE (SPEC-240).

Tapi pratinjau adalah **jalan buntu**. Untuk membagikan hasil kerja agen ke rekan tim, operator
harus screenshot, salin-tempel, atau menyuruh orang membuka repo. Tidak ada artefak berkas yang
bisa dilampirkan ke chat, email, atau tiket. Dokumen audit yang seharusnya menjadi **evidence**
tidak pernah keluar dari dashboard.

Kebutuhannya dua bentuk sekaligus: `.md` mentah (bisa di-diff, ditempel ke repo lain, dibaca agen)
dan `.pdf` (bisa dibaca siapa pun tanpa tooling, cocok sebagai lampiran resmi).

## Keputusan

### 1. PDF dirender di server, bukan di klien

Tiga opsi ditimbang; semuanya di-spike lebih dulu.

| Opsi | Unduhan sungguhan | Bisa lewat API/`curl` | Biaya |
|---|---|---|---|
| **Server-side + `pdfkit`** ✅ | ya | ya | 1 dep server + renderer bertest |
| Klien, dialog print browser | **tidak** — dialog print | tidak | nol dep |
| Klien, `pdfmake` lazy-import | ya | tidak | bundle frontend +2 MB |

Dipilih **server-side**. Satu klik menghasilkan satu berkas dengan nama deterministik; URL-nya
bisa di-`curl` maupun dipakai integrasi agent token (ADR-0065); dan isinya **persis** apa yang
dipratinjau, karena resolusi *freshest-wins* (worktree sesi hidup > `repoDir`) sudah terjadi di
server. Dialog print ditolak karena bukan unduhan — nama berkas tak terkendali dan tak semua
setup menawarkan "Save as PDF".

### 2. Tanpa endpoint ekspor baru — query menempel di endpoint dokumen yang sudah ada

Empat endpoint sudah menyajikan isi dokumen, masing-masing dengan resolusi path-nya sendiri.
Menambah endpoint ekspor terpisah berarti menduplikasi keempat resolusi itu. Jadi masing-masing
menerima query **opsional** `?download=md|pdf`, mengikuti preseden `GET /projects/:id/archive`
(SPEC-233): `content-disposition: attachment`, badan langsung, tanpa entitas DB.

| Endpoint | Permukaan UI | Prefix nama berkas |
|---|---|---|
| `GET /api/specs/:id/docs/*path` | `SpecDocsModal` (Backlog **dan** Terminal) | `<specId>` |
| `GET /api/projects/:id/prds/*path` | `PrdScreen` | `<projectId>` |
| `GET /api/projects/:id/docs/*path` | `DocsWorkspace` | `<projectId>` |
| `GET /api/projects/:id/file?path=&ref=` | `IdeScreen` Explorer | `<projectId>`(+`-<ref>`) |

Query absen **atau bernilai lain** → respons JSON `{path, content}` persis seperti sebelumnya.
Kompatibilitas mundur adalah bagian dari kontrak, bukan efek samping.

Auth memakai jalur yang sudah ada: `<a download>` mengirim cookie sesi same-origin, jadi gate
`onRequest` (ADR-0028) berlaku apa adanya. **Tak ada pengecualian auth baru** — beda sadar dari
ingest ber-DSN (ADR-0060) dan Help Center publik (ADR-0062).

### 3. Renderer memakai parser yang sama dengan preview

`server/src/services/doc-export.ts` mem-parse dengan `marked.lexer()` — pustaka yang sama yang
dipakai `ds/markdown.tsx` untuk pratinjau — lalu menggambar token ke `pdfkit`. Konsekuensinya
**apa yang tercetak = apa yang tampil**; tak ada dua definisi "dokumen ini terlihat seperti apa"
yang bisa saling drift. Berkas non-`.md` (IDE) dibungkus sebagai satu blok kode, cermin
`hnDocHtml`.

Warna & tipografi diturunkan dari token design system (bone paper, brass accent) agar PDF terbaca
sebagai dokumen hanoman.

### 4. Standard-14 font → glyph di luar WinAnsi ditransliterasi

PDF standard-14 font (Helvetica/Courier) hanya meng-encode **WinAnsi**. Ini bukan detail teoretis:
pdfkit **tidak melempar error** untuk glyph di luar itu — ia mencetak mojibake **senyap**. Terbukti
lewat spike: `→` jadi `!'`, `✓` jadi `'`, `🎉` jadi `Ø<ß‰`.

Karena docs hanoman memakai `→` di mana-mana, setiap teks wajib lewat `toWinAnsi()`: peta
transliterasi untuk glyph yang benar-benar dipakai (`→`→`->`, `⇒`→`=>`, `✓`→`v`, `☑`→`[x]`,
box-drawing → ASCII), emoji dibuang, sisa non-Latin-1 jadi `?`. Karakter yang **sudah** ada di
WinAnsi (`—`, `•`, `·`, `“”`, `…`, `é`) dibiarkan utuh.

Alternatif meng-embed font TTF berliputan luas **ditolak**: menambah ±750 KB aset biner ke repo
demi glyph yang mudah ditransliterasi tanpa kehilangan makna.

## Konsekuensi

- Dependensi server baru: `pdfkit` (+`@types/pdfkit`) dan `marked`. `pdfkit` **wajib**
  `--external:pdfkit` di esbuild — ia membaca berkas metrik `.afm` dari `__dirname` saat runtime,
  jadi tak boleh ikut di-bundle.
- Tanpa perubahan skema, tanpa migration, tanpa penyimpanan PDF. Dokumen tetap nilai turunan dari
  filesystem (ADR-0011/0018); PDF dirender ulang tiap permintaan.
- Deploy VPS tak butuh Chrome/Chromium: renderer murni JavaScript.
- Batasan yang diterima sadar: PDF tak memuat gambar (token `image` dirender sebagai penanda
  teks), dan tabel memakai lebar kolom rata — dokumen hanoman berisi prosa & tabel ringkas,
  bukan layout kompleks.
- `Button` DS kini punya prop `as="a"`. Unduhan **harus** anchor sungguhan, bukan `<button>`
  ber-`onClick`, supaya `content-disposition` server yang menentukan nama berkas.

## Alternatif ditolak

1. **Dialog print browser** (`window.print()` pada iframe ber-CSS `.hn-md`). Tipografi terbaik dan
   nol dependensi, tapi bukan unduhan: butuh dialog, nama berkas ditentukan browser, dan tak
   tersedia di semua setup. Objective meminta *tombol download*.
2. **`pdfmake`/`jsPDF` di klien.** Unduhan sungguhan tanpa menyentuh server, tapi bundle frontend
   membengkak ±2 MB dan PDF tak bisa diambil lewat API/`curl` — menutup jalur agent token dan
   otomasi.
3. **Endpoint ekspor terpisah** (`GET /api/export/...`). Menduplikasi empat resolusi path dokumen
   yang sudah ada, dengan risiko drift *freshest-wins*.
