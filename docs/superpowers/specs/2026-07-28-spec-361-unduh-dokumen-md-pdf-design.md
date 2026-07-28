# SPEC-361 — Unduh dokumen preview sebagai `.md` mentah dan `.pdf`

**Tanggal:** 2026-07-28 · **Sumber:** brief · **Prioritas:** tinggi
**ADR:** [0077 — Unduh dokumen: query `?download=` di endpoint dokumen + render PDF server-side](../../../internal/docs/adr/0077-unduh-dokumen-md-pdf.md)

## Objective

Setiap tempat hanoman mempratinjau dokumen Markdown (PRD, spec, plan, audit, objective,
brainstorm, docs Source of Truth, berkas `.md` di IDE) mendapat **dua tombol unduh**: `.md`
mentah dan `.pdf`. Tujuannya membuat dokumen bisa dibagikan ke luar dashboard — menjadi
**evidence untuk tim** tanpa perlu akses ke hanoman atau ke repo.

## Masalah

Dokumen yang ditulis agen (PRD, spec, plan, audit) hanya bisa dibaca **di dalam** dashboard.
Untuk membagikannya ke rekan tim, operator harus screenshot, salin-tempel, atau membuka repo.
Tak ada artefak berkas yang bisa dilampirkan ke chat/email/tiket.

## Keputusan desain

### 1. PDF dirender di server, bukan di klien

Ditimbang tiga opsi:

| Opsi | Unduhan sungguhan | Dep baru | Bisa lewat API/curl | Fidelitas |
|---|---|---|---|---|
| **Server-side + `pdfkit`** ✅ | ya | `pdfkit`, `marked` (server) | ya | teks vektor, standard-14 font |
| Klien, dialog print browser | tidak (dialog print) | — | tidak | terbaik (CSS DS apa adanya) |
| Klien, `pdfmake` lazy-import | ya | `pdfmake` (~2 MB bundle) | tidak | teks vektor, font di-embed |

Dipilih **server-side**: satu klik menghasilkan satu berkas dengan nama deterministik, URL-nya
bisa di-`curl` maupun dipakai integrasi agent token, dan isinya **persis** apa yang dipratinjau
karena resolusi *freshest-wins* (worktree sesi hidup > `repoDir`) sudah terjadi di server.

### 2. Query `?download=` pada endpoint dokumen yang sudah ada — bukan endpoint baru

Empat endpoint sudah menyajikan isi dokumen. Masing-masing menerima query opsional
`?download=md|pdf`; tanpa query, perilaku lama (JSON `{path, content}`) **tidak berubah sama
sekali**. Nilai `download` selain `md`/`pdf` diabaikan (tetap JSON) demi kompatibilitas.

| Endpoint | Permukaan UI | Nama berkas |
|---|---|---|
| `GET /api/specs/:id/docs/*path` | Backlog `SpecDocsModal` **dan** Terminal (komponen sama) | `<specId>-<basename>.<ext>` |
| `GET /api/projects/:id/prds/*path` | `PrdScreen` pane preview | `<projectId>-<basename>.<ext>` |
| `GET /api/projects/:id/docs/*path` | `DocsWorkspace` (Source of Truth) | `<projectId>-<basename>.<ext>` |
| `GET /api/projects/:id/file?path=&ref=` | `IdeScreen` Explorer | `<projectId>[-<ref>]-<basename>.<ext>` |

Mengikuti preseden `GET /projects/:id/archive` (SPEC-233): `content-disposition: attachment`,
stream/buffer langsung, tanpa entitas DB.

Auth memakai jalur yang sudah ada: `<a href download>` mengirim cookie sesi same-origin, jadi
gate `onRequest` (ADR-0028) berlaku apa adanya. Tak ada pengecualian auth baru.

### 3. Renderer PDF: `marked.lexer` → `pdfkit`, standard-14 font

`server/src/services/doc-export.ts` mem-parse Markdown dengan `marked.lexer()` (parser yang
**sama** dengan preview, jadi apa yang tampil = apa yang tercetak) lalu menggambar token ke
`pdfkit`. Berkas non-`.md` (IDE) dibungkus sebagai satu blok kode — cermin `hnDocHtml` di
frontend.

Token yang dirender: `heading` (h1–h6), `paragraph`, `list` (berurut/tidak, bersarang,
checkbox `- [ ]`/`- [x]`), `code`, `blockquote`, `table`, `hr`, `space`, `html` (sebagai teks
mentah). Inline: `strong`, `em`, `codespan`, `link` (anotasi link hidup), `del`, `br`.

Halaman A4, margin 56 pt, kop halaman-1 (eyebrow + judul + path + jam terbit) dan footer tiap
halaman (path kiri, `hal. N` kanan). Warna dari token design system: ink-700 badan, ink-900
judul, brass-500 aksen, ink-200 garis rambut.

### 4. Transliterasi WinAnsi — konsekuensi standard-14 font

Standard-14 font PDF hanya meng-encode **WinAnsi**. Terbukti lewat spike: `→` tercetak `!'`,
`✓` jadi `'`, `🎉` jadi `Ø<ß‰` — **tanpa melempar error**, jadi kerusakan ini senyap.

Karena docs hanoman memakai `→` di mana-mana, renderer wajib menyaring teks lewat
`toWinAnsi()`: peta transliterasi untuk glyph yang benar-benar dipakai (`→`→`->`, `←`→`<-`,
`⇒`→`=>`, `✓`/`✔`→`v`, `✗`/`❌`→`x`, `☐`→`[ ]`, `☑`→`[x]`, `⚠`→`!`, `≥`→`>=`, `≤`→`<=`,
`≠`→`!=`, box-drawing → ASCII), emoji dibuang, sisa non-Latin-1 jadi `?`. Karakter yang sudah
ada di WinAnsi (`—`, `•`, `·`, `“”`, `…`, `é`) dibiarkan utuh — sudah diverifikasi benar.

### 5. Frontend: satu komponen DS, empat pemasangan

`Button` mendapat prop opsional `as="a"` (render `<a>` alih-alih `<button>`; `type`/`disabled`
DOM ditekan, dipakai `aria-disabled`). Di atasnya `ds/DocDownload.tsx` merender sepasang tombol
`.md` + `.pdf` dari satu fungsi `href(fmt)`.

`shared/src/api.ts` mendapat helper URL unduh untuk keempat endpoint agar frontend tak merakit
query-string sendiri.

## Non-goals

- Tak ada penyimpanan/riwayat PDF — dirender on-the-fly, tak ada tabel/kolom baru.
- Tak ada ekspor massal (zip semua dokumen backlog) — sudah ada `GET /projects/:id/archive`.
- Tak ada tema/branding PDF yang bisa dikonfigurasi.
- Tak ada embed font TTF; konsekuensinya transliterasi di §4 (diterima sadar).
- Tak menyentuh `DocsWorkspace` mode edit — tombol unduh hanya di mode preview (isi tersimpan,
  bukan draft).

## Acceptance criteria (EARS)

1. **WHEN** operator membuka pratinjau dokumen di Backlog, Terminal, PRD, Docs, atau IDE,
   **THE SYSTEM SHALL** menampilkan dua tombol unduh berlabel `.md` dan `.pdf` di header pratinjau.
2. **WHEN** tombol `.md` diklik, **THE SYSTEM SHALL** mengunduh berkas `text/markdown` berisi
   sumber Markdown mentah yang identik dengan yang dipratinjau.
3. **WHEN** tombol `.pdf` diklik, **THE SYSTEM SHALL** mengunduh berkas `application/pdf` yang
   valid (magic `%PDF`) berisi dokumen yang sama dalam bentuk terformat.
4. **THE SYSTEM SHALL** menyetel `content-disposition: attachment` dengan nama berkas turunan
   id backlog/project + nama dokumen, sehingga berkas terunduh langsung tanpa dialog print.
5. **WHERE** query `?download=` absen atau bernilai lain, **THE SYSTEM SHALL** mengembalikan
   JSON `{path, content}` persis seperti sebelum SPEC-361.
6. **WHEN** dokumen memuat glyph di luar WinAnsi (mis. `→`, emoji), **THE SYSTEM SHALL**
   mentransliterasi atau membuangnya, dan **SHALL NOT** memancarkan mojibake seperti `!'`.
7. **WHEN** dokumen yang diminta tak ada, **THE SYSTEM SHALL** tetap membalas 404 seperti semula
   — juga saat `?download=` diberikan.
8. **WHERE** berkas IDE bersifat biner, **THE SYSTEM SHALL** tidak menawarkan tombol unduh PDF.

## Rencana test

**Unit (server, murni):**
- `toWinAnsi()` — peta transliterasi, emoji dibuang, Latin-1 utuh.
- `downloadFilename()` — sanitasi, ekstensi, prefix id, ref opsional.
- `renderDocPdf()` — buffer diawali `%PDF`, `%%EOF` di ekor, ukuran wajar; markdown berisi
  semua jenis token tak melempar; non-`.md` dibungkus blok kode.

**Route (server, HTTP nyata):**
- keempat endpoint × {`?download=md`, `?download=pdf`, tanpa query} → content-type,
  content-disposition, dan bentuk body yang benar; 404 tetap 404.

**Frontend (RTL):**
- keempat layar merender anchor `.md`/`.pdf` dengan `href` & atribut `download` yang benar.
- `Button as="a"` merender `<a>`, bukan `<button>`.

**Smoke nyata (wajib, CLAUDE.md):** boot server + `curl` keempat endpoint, verifikasi header
dan magic bytes PDF, lalu render PDF hasilnya jadi gambar untuk pemeriksaan mata.

## Berkas tersentuh

| Berkas | Perubahan |
|---|---|
| `server/package.json` | +`pdfkit`, +`marked`, +`@types/pdfkit`; esbuild `--external:pdfkit` |
| `server/src/services/doc-export.ts` | **baru** — `toWinAnsi`, `downloadFilename`, `renderDocPdf`, `sendDocDownload` |
| `server/src/routes/specs.ts` · `docs.ts` · `ide.ts` | cabang `?download=` |
| `shared/src/api.ts` | helper URL unduh |
| `src/src/ds/components/forms.tsx` | `Button` prop `as` |
| `src/src/ds/DocDownload.tsx` · `ds/index.ts` | **baru** — sepasang tombol unduh |
| `src/src/screens/{SpecDocsModal,PrdScreen,DocsWorkspace,IdeScreen}.tsx` | pasang tombol |
| `src/src/api/client.ts` | fungsi URL unduh |
| `internal/docs/adr/0077-*.md` | **baru** |
| `internal/docs/architecture/api-contract.md` | dokumentasi `?download=` |
| `internal/docs/frontend/frontend-implementation.md` | permukaan unduh |
| `internal/docs/README.md` | taut ADR-0077 |
| `internal/skills/hanoman/SKILL.md` | satu baris aturan |
