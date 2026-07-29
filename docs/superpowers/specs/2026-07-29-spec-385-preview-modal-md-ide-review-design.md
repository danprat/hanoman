# SPEC-385 — Preview modal `.md` di IDE & Review

Tanggal: 2026-07-29 · Sumber: brief · Prioritas: tinggi
Status: design disetujui, siap plan

## Objective

Dari mana pun sebuah berkas `.md` dibuka di IDE dan Review, ada **satu aksi yang terlihat** untuk
membacanya sebagai dokumen terender di ruang baca lebar — dan dokumen itu bisa dibawa pergi sebagai
`.md`/`.pdf` seperti pratinjau dokumen lain (ADR-0078). Sukses bila: keempat permukaan yang hari ini
menampilkan `.md` sebagai teks mentah punya aksi preview, isi yang diunduh identik dengan yang
dirender, dan tak ada endpoint/skema/ADR baru.

## Masalah

Brief: *"ketika membuka .md atau docs terdapat preview untuk mudah dibaca jika melihat docs di IDE
dan Review."* Objective: *"terdapat action untuk preview docs"*.

Keadaan terukur hari ini (dibaca dari kode, bukan ingatan):

| Permukaan | Berkas `.md` hari ini | Preview? |
| --- | --- | --- |
| IDE · Explorer, mode **file** (`selKind === "file"`) | toggle inline `Preview \| Source`, default preview (SPEC-240) | **ada**, tapi terjepit di pane kanan sebelah tree 300 px |
| IDE · Explorer, mode **diff** (Staged/Changed → tab `source`) | `<pre>` mentah (`IdeScreen.tsx:305`) | **tidak ada** |
| IDE · Git Graph, modal berkas satu commit (tab `source`) | `<pre>` mentah (`GitGraph.tsx:596`) | **tidak ada** |
| Review (`ReviewScreen`, backlog **dan** sesi PRD) → tab `source` | `<pre>` mentah (`ReviewScreen.tsx:97`) | **tidak ada** |

Jadi keluhannya bukan "renderer markdown belum ada" — `MarkdownView` (`ds/markdown.tsx`) sudah
dipakai `DocsWorkspace`, `SpecDocsModal`, dan IDE mode file. Yang belum ada adalah **aksi** untuk
membuka isi `.md` sebagai dokumen terbaca dari permukaan-permukaan berorientasi-diff, plus ruang
baca yang layak (IDE mode file punya preview tapi lebarnya sisa setelah tree).

## Keputusan

Satu komponen bersama + satu aksi konsisten di empat permukaan di atas.

### 1. `DocPreviewModal` (baru, di design system)

`src/src/ds/DocPreviewModal.tsx`, diekspor dari `ds/index.ts` bersebelahan dengan `MarkdownView` dan
`DocDownload` — bukan di `screens/`, karena ia tak tahu apa-apa soal spec/ide/review.

```ts
DocPreviewModal({
  path: string,                                   // judul + penentu bahasa render
  text: string,                                   // isi mentah
  eyebrow?: React.ReactNode,                      // konteks: "SPEC-385", "main", "a1b2c3d @ commit"
  download?: (fmt: "md" | "pdf") => string,        // ADR-0078 · absen = tanpa tombol unduh
  onClose: () => void,
})
```

Isinya `Modal` ber-`fillHeight` (SPEC-363) `width={980}` → `MarkdownView` di dalam kontainer
`flex: 1 1 0; min-height: 0; overflow: auto` ber-`data-testid="doc-preview-scroll"`, persis rantai
yang sudah dibuktikan SPEC-363 (`.hn-md` sudah memasang `overflow-wrap: anywhere`,
`table-layout: fixed`, `pre-wrap` secara global — tak ada CSS baru).

`Escape` menutup (default `Modal`). Nested modal dihindari: Git Graph memakai tab, bukan modal
(lihat §2.3).

### 2. Aksi per permukaan

Gerbang seragam: `.md` (case-insensitive, cermin `isMarkdown` di `IdeScreen`) **dan** tak biner
**dan** isinya bukan `null` (berkas terhapus tak punya isi untuk dibaca).

1. **IDE · Explorer, mode file** — tombol `Preview` (ikon `book-open`) di toolbar, di samping toggle
   `Preview | Source` dan `DocDownload` yang sudah ada. Toggle inline **tetap** (SPEC-240 tak
   dicabut); modal adalah mode baca lebar untuk dokumen panjang. `download` = `ideFileDownloadUrl`
   yang sudah ada.
2. **IDE · Explorer, mode diff** — tombol `Preview` di toolbar di samping toggle `diff | source`.
   Yang di-preview adalah `diff.content` (isi **sesudah** perubahan), bukan diff-nya.
3. **IDE · Git Graph, modal berkas commit** — permukaannya sudah modal, jadi aksinya berupa **tab
   ketiga** `preview` di grup `diff | source` (hanya muncul untuk `.md`), bukan modal di atas modal.
4. **Review** (`ReviewScreen`, dipakai backlog `kind="spec"` **dan** sesi PRD `kind="session"`) —
   tombol `Preview` di toolbar di samping toggle `diff | source`.

Tak ada perubahan pada pane diff itu sendiri: `DiffView` tetap teks monospace baris-per-baris.

### 3. Parity unduh (ADR-0078)

ADR-0078 menyatakan **setiap** pratinjau Markdown punya tombol `.md` & `.pdf`. Empat permukaan baru
di atas karenanya butuh URL unduh. Mekanismenya persis pola ADR-0078 yang sudah ada — **query
`?download=md|pdf` pada endpoint yang sudah ada, tanpa endpoint/skema/migration baru**, memakai
`downloadFormat()` + `sendDocDownload()` di `server/src/services/doc-export.ts`:

| Endpoint | Dipakai oleh |
| --- | --- |
| `GET /api/specs/:id/review/*` | Review (backlog) |
| `GET /api/terminal/sessions/:id/review/*` | Review (sesi PRD) |
| `GET /api/projects/:id/file-diff` | IDE mode diff |
| `GET /api/projects/:id/commit/:sha/file` | Git Graph (satu commit) |
| `GET /api/projects/:id/compare/file` | Git Graph (compare dua commit) |

Semua mengembalikan **isi sesudah perubahan** (`ReviewFile.content`) — sama persis dengan yang
dirender preview, jadi yang diunduh = yang dibaca. Aturan seragam:

- `download` absen / nilai tak dikenal → JSON `ReviewFile` lama, **utuh, tanpa perubahan bentuk**.
- berkas biner atau `content === null` (dihapus) → `404`, sebab tak ada dokumen untuk diunduh.

Sisi klien: lima builder URL satu baris di `src/src/api/client.ts` memakai `paths.download(base, fmt)`
yang sudah generik. **`shared/src/api.ts` tak disentuh** — menyentuhnya akan meledakkan blast radius
`vitest --changed` ke hampir seluruh suite (ADR-0080).

### Yang sengaja TIDAK dilakukan

- **Tidak** mengganti toggle inline SPEC-240 di IDE mode file. Ia sudah dipakai dan default-nya
  preview; menghapusnya = regresi.
- **Tidak** membuat endpoint ekspor baru, kolom DB, migration, atau ADR baru. Ini perluasan
  mekanisme ADR-0078 + preseden SPEC-240/363, bukan keputusan arsitektur baru — sejalan dengan
  SPEC-363 dan SPEC-377 yang juga tanpa ADR.
- **Tidak** merender markdown di dalam `DiffView`. Diff tetap teks.
- **Tidak** memperluas preview ke tipe berkas selain `.md`. `hnDocHtml` memang bisa membungkus
  `.json`/`.ts` sebagai blok kode, tapi judul backlog menyebut `.md` dan pane source sudah
  ber-highlight untuk kode.

## Bentuk perubahan

```
src/src/ds/DocPreviewModal.tsx        (baru)
src/src/ds/index.ts                   (+1 export)
src/src/api/client.ts                 (+5 builder URL unduh)
src/src/screens/IdeScreen.tsx         (2 tombol Preview + state)
src/src/screens/GitGraph.tsx          (tab ketiga `preview` untuk .md)
src/src/screens/ReviewScreen.tsx      (1 tombol Preview + state)
server/src/routes/specs.ts            (?download= di review/*)
server/src/routes/terminal.ts         (?download= di sessions/:id/review/*)
server/src/routes/ide.ts              (?download= di file-diff, commit/:sha/file, compare/file)
```

Docs SoT yang tersentuh (commit yang sama): `internal/docs/architecture/api-contract.md`,
`internal/docs/frontend/frontend-implementation.md`, `internal/skills/hanoman/SKILL.md`,
`internal/docs/README.md` (index).

## Rencana verifikasi

Scope `changed` (ADR-0080) — perubahan berdaun, bukan modul inti:

- Frontend (jsdom): `src/test/ide-screen.test.tsx`, `src/test/review-screen.test.tsx`,
  `src/test/doc-preview-modal.test.tsx` (baru), `src/test/git-graph.test.tsx`.
- Server (route): `server/test/ide.route.test.ts`, `server/test/spec-docs.route.test.ts` /
  `specs.route`, route sesi review.
- Typecheck hanya paket tersentuh: `pnpm --filter ./src typecheck` + `pnpm --filter ./server typecheck`.
- Karena task ini menyentuh endpoint: **satu** smoke nyata di akhir — boot server ke DB sekali-pakai,
  lalu `curl` kelima endpoint dengan dan tanpa `?download=`, memastikan (a) tanpa query bentuk JSON
  lama utuh, (b) `?download=md` mengembalikan `content-disposition` + teks markdown, (c) `?download=pdf`
  mengembalikan `%PDF` yang isinya benar-benar memuat teks dokumen (jebakan SPEC-361: pdfkit gagal
  **senyap**, jadi assert ISI bukan magic bytes).

Jebakan yang sudah diketahui dan dijaga:

- `vitest --changed` menyalakan `passWithNoTests` → nol test **terlihat hijau**; hitung berkas yang
  benar-benar berjalan (SPEC-376).
- Test DS gampang **lulus palsu**: query lewat peran/label yang benar-benar dirender (SPEC-360).
- `env -u NODE_ENV -u DATABASE_URL` saat menjalankan test, dan DB smoke sekali-pakai (bukan
  `hanoman_test`, yang di-truncate sesi tetangga).
