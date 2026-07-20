# SPEC-240 — Preview Docs in IDE

**Tanggal**: 2026-07-20
**Backlog**: SPEC-240 · sumber brief · prioritas tinggi
**Flow**: feature (spec → plan → execute), frontend-only

## Objective

Di **IDE Visual → Explorer**, untuk berkas `.md` tampilkan **preview terender secara default**,
dengan tombol untuk berpindah antara **Preview** (markdown terender) dan **Source** (raw source)
di samping tombol **Edit**. Saat ini pane kanan hanya menampilkan raw source `.md`.

## Konteks & keadaan sekarang

`src/src/screens/IdeScreen.tsx` — tab **Explorer**, pane kanan menampilkan isi file terpilih
(`api.ideFile`). State `mode: "view" | "edit"`:

- `mode === "view"` → `<pre><code class="hljs">` di-highlight highlight.js (bahasa dari ekstensi;
  `.md` → grammar `markdown`). Jadi `.md` tampil sebagai **raw source berwarna**, bukan preview.
- `mode === "edit"` → `<textarea>` mono + tombol Simpan (`api.putIdeFile`).
- Tombol **Edit** di header pane (kanan), disable saat file biner.

Renderer markdown bersama sudah ada: `MarkdownView` / `hnDocHtml` di `src/src/ds/markdown.tsx`
(marked, kelas `.hn-md`) — dipakai `DocsWorkspace` (Docs·SoT) dan `SpecDocsModal`. Style `.hn-md`
global di `src/src/app.css`. Toggle segmented (pill) juga sudah ada di IdeScreen untuk **Diff | Source**.

## Pendekatan

State lokal baru `mdView: "preview" | "source"` (default `"preview"`), hanya relevan saat
`mode === "view"` **dan** file terpilih ber-ekstensi `.md`.

- **Preview** → `<MarkdownView text={file.content} name={selected} />` (marked, `.hn-md`).
- **Source** → `<pre><code class="hljs">` (perilaku view yang sudah ada), tak berubah.
- Toggle **Preview | Source** memakai pola pill yang sama dengan toggle **Diff | Source** yang
  sudah ada di file, dirender **di kiri tombol Edit** — hanya untuk `.md` dalam `mode === "view"`.
- `mdView` di-reset ke `"preview"` setiap file `.md` baru dipilih (pola sama `setDiffTab("diff")`
  yang sudah ada di efek load file) → memenuhi "default preview".
- File **non-`.md`**: tak ada toggle, tetap highlighted source + Edit (perilaku lama utuh).
- **Edit**: tetap mengedit raw source di `<textarea>`; setelah **Simpan** kembali ke view →
  karena default `mdView === "preview"`, hasil edit langsung terlihat terender.

Deteksi `.md`: helper `isMarkdown(path) = /\.md$/i.test(path)`.

### Kenapa bukan alternatif lain

- **Perluas `mode` jadi `"preview" | "source" | "edit"`** — mengubah semantik `mode` yang dipakai
  di beberapa tempat (efek load, Edit/Batal/Simpan); lebih invasif tanpa manfaat tambahan.
- **Auto-preview tanpa toggle Source** — melanggar spec: butuh tombol Source raw eksplisit.

## Perubahan

Frontend saja. **Tanpa** perubahan server/API/skema/data-model.

1. `src/src/screens/IdeScreen.tsx`
   - Tambah `const [mdView, setMdView] = useState<"preview" | "source">("preview")`.
   - Helper `isMarkdown(selected)`.
   - Di efek load file (`selKind === "file"`): reset `setMdView("preview")` bersama `setMode("view")`.
   - Header pane (cabang `!inDiff`, `mode === "view"`): bila `isMarkdown` render toggle
     **Preview | Source** sebelum tombol Edit.
   - Body pane (cabang `!inDiff`, `mode === "view"`): bila `isMarkdown && mdView === "preview"`
     render `<MarkdownView>`; selain itu highlighted source seperti sekarang.
2. `src/test/ide-screen.test.tsx` — test perilaku baru.
3. `internal/docs/frontend/frontend-implementation.md` — perbarui section **IDE Visual (SPEC-182)**
   untuk mencatat preview default `.md` + toggle Preview|Source.

## Acceptance criteria (EARS)

- **WHEN** operator memilih berkas `.md` dari pohon Files di Explorer, **THE** IDE **SHALL**
  menampilkan markdown terender (preview) secara default, bukan raw source.
- **WHEN** berkas `.md` sedang ditampilkan dalam mode view, **THE** IDE **SHALL** menampilkan
  toggle **Preview | Source** di samping tombol Edit.
- **WHEN** operator menekan **Source** pada toggle, **THE** IDE **SHALL** menampilkan raw source
  `.md` (highlighted) alih-alih preview.
- **WHEN** operator memilih berkas **non-`.md`**, **THE** IDE **SHALL** menampilkan raw source
  (highlighted) tanpa toggle Preview|Source (perilaku lama utuh).
- **WHEN** operator menekan **Edit** pada berkas `.md`, **THE** IDE **SHALL** membuka editor raw
  source; **WHEN** menekan **Simpan**, kembali ke view dengan preview terender.

## Test plan

Unit (vitest + @testing-library/react, `src/test/ide-screen.test.tsx`):

- Memilih `.md` → `MarkdownView` (preview) terrender, bukan raw `<code class="hljs">`.
- Toggle **Source** → raw source tampil; toggle balik **Preview** → preview tampil.
- Memilih file non-`.md` (mis. `src/a.ts`) → tak ada toggle Preview|Source; source tampil.
- Edit `.md` → Simpan → kembali ke preview.

Verifikasi nyata: boot server + buka IDE Explorer, klik `README.md` → preview terender; toggle
Source → raw; Edit/Simpan.

## Di luar scope

- Tak menyentuh Git Graph, Staged/Changed diff, maupun endpoint apa pun.
- Tak menambah dependency (marked & highlight.js sudah ada).
- Tak mengubah renderer Docs·SoT / SpecDocsModal.
