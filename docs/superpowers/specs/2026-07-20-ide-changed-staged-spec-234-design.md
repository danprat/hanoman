# SPEC-234 · File changed & staged di IDE Explorer

**Status:** design · prioritas tinggi · sumber brief
**Tanggal:** 2026-07-20

## Objective

Di IDE Explorer, operator butuh melihat **file yang berubah** dan **file yang staged**
pada branch yang sedang di-checkout, supaya perbedaannya kelihatan. Saat ini Explorer hanya
menampilkan pohon semua file — tak ada section changed/staged, jadi operator tak bisa melihat
apa yang berubah tanpa buka terminal `git status`/`git diff`.

Outcome: dua section — **Staged** dan **Changed** — masing-masing dengan **list view** dan
**tree view**, dan klik file menampilkan **diff**-nya.

Constraint (dari brief): **gunakan component yang sudah ada.**

## Konteks & keputusan

hanoman punya dua tempat yang sudah menampilkan "file berubah + tree + diff":

- `ReviewScreen` (SPEC-171/177/189): section **Changed** (SCM) dengan toggle **List | Tree**,
  pohon **Files**, dan viewer **Diff | Source**. Datanya worktree backlog item
  (`GET /specs/:id/review`), diff atas merge-base.
- `IdeScreen` (SPEC-182): Explorer (pohon file + editor highlight.js) & Git Graph, bekerja pada
  **working tree utama** (`Project.repoDir`).

Yang hilang: IDE Explorer tak menurunkan **status working tree** (staged vs unstaged). Fitur ini
menutup celah itu dengan **reuse** mesin yang sudah ada, bukan menulis ulang.

### Keputusan scope (dikonfirmasi)

Klik file di section Staged/Changed → pane kanan menampilkan **diff read-only** (toggle Diff |
Source), reuse `DiffView`. Alternatif "buka di editor biasa" ditolak karena tak menunjukkan baris
yang berubah — bertentangan dengan outcome "melihat perbedaannya".

### Kenapa tanpa ADR / migration

- Tak ada perubahan skema (tujuh model tetap; tak ada kolom baru — status diturunkan dari git tiap
  request, cermin ADR-0018/0011).
- Dua endpoint **read-only** baru, konsisten dengan endpoint IDE lain (ADR-0034: IDE bekerja pada
  working tree utama). Tak ada keputusan arsitektur baru yang bertentangan dengan ADR mana pun.

## Arsitektur

### Data model (git, diturunkan — tak dipersist)

Dua "changeset" working tree, dihitung dari git pada tiap request:

- **Staged** = `git diff --cached` (index vs HEAD). Untracked TAK muncul (belum di-index).
- **Changed (unstaged)** = working tree vs index, memakai pola **temp-index** yang sudah dipakai
  `specReview` (`withTempIndex` → `git add -A -N` di salinan index sementara, index asli tak
  tersentuh). Efeknya: file tracked yang dimodifikasi tampil `M`/`D`, file **untracked** tampil
  `A` dengan hitungan `+add`/`−del` nyata — persis pola SPEC-144.

Keduanya `ChangedFile[]` (`{ path, add, del, status: "A"|"M"|"D", binary }`) — tipe yang sudah ada,
jadi `buildFileTree`/`TreeRow`/`ST_COLOR` langsung jalan tanpa perubahan.

Split staged/unstaged itu benar sesuai model VSCode: file yang staged **dan** dimodifikasi lagi di
worktree muncul di **kedua** section.

### Server

Service `server/src/services/git-ide.ts` — dua fungsi baru:

```
workingStatus(repoDir): Promise<{ branch: string; staged: ChangedFile[]; unstaged: ChangedFile[] }>
workingFileDiff(repoDir, path, staged: boolean): Promise<ReviewFile | null>
```

- `workingStatus`: `staged = changedFiles(repoDir, ["--cached"])`;
  `unstaged = withTempIndex(repoDir, env => changedFiles(repoDir, [], env))`;
  `branch = currentBranch(repoDir)`. repoDir null/tak ada → `{ branch:"", staged:[], unstaged:[] }`.
- `workingFileDiff`: guard path (`repoAbsPath`). staged → `git diff --cached -- <path>`,
  content = `git show :<path>` (isi index). unstaged → `withTempIndex` + `git diff -- <path>`
  (untracked jadi diff new-file), content = baca disk. status D → content null. Bentuk = `ReviewFile`.

Reuse: ekspor `changedFiles` & `withTempIndex` dari `spec-review.ts` (sekarang module-private).

Route `server/src/routes/ide.ts` — dua endpoint baru (pola sama endpoint IDE lain, `repoOf` guard):

```
GET /projects/:id/status                 # { branch, staged[], unstaged[] } · 404 project tak ada
GET /projects/:id/file-diff?path=&staged= # ReviewFile · 400 path buruk · 404 file tak berubah/tak ada
```

Read-only → **tak** digerbang sesi aktif (seperti `GET /tree`, `GET /file`).

### Shared & client

- `shared/src/api.ts`: `ideStatus(id)`, `ideFileDiff(id, path, staged)`.
- `src/src/api/client.ts`: tipe `WorkingStatus = { branch; staged: ChangedFile[]; unstaged: ChangedFile[] }`;
  method `ideStatus(id)`, `ideFileDiff(id, path, staged)` → `ReviewFile`.

### Frontend (reuse + ekstraksi shared)

**Ekstraksi shared (menghapus duplikasi):**

1. `DiffView` dipindah dari `ReviewScreen.tsx` → modul shared (`screens/diff-view.tsx`),
   dipakai `ReviewScreen` **dan** `IdeScreen`.
2. `ChangedSection` baru di `screens/file-tree.tsx`: render header (`label · count` + toggle
   **List | Tree**) + body (list flat atau `buildFileTree`+`TreeRow` dengan `meta`+`defaultOpen`).
   Dipakai `ReviewScreen` (Changed) **dan** `IdeScreen` (Staged + Changed). Row list diekstrak
   jadi `ChangedRow`.

**`IdeScreen` Explorer:**

- State baru: `status: WorkingStatus | null`, `stagedView`/`changedView` (`"list"|"tree"`),
  dan `selKind: "file" | "staged" | "unstaged"` menyertai `selected`.
- Pane kiri (urutan ala ReviewScreen): **Staged** section → **Changed** section → **Files** tree
  (yang sudah ada). Header SCM menampilkan branch aktif (`status.branch`).
- Pane kanan:
  - `selKind === "file"` → viewer/editor highlight.js yang sudah ada (tak berubah).
  - `selKind === "staged"|"unstaged"` → fetch `ideFileDiff` → render `DiffView` + toggle
    Diff | Source (reuse). Edit disabled di mode diff.
- Reload: `reload()` memuat ulang tree **dan** status; dipanggil on-mount, setelah git op
  (checkout/merge), dan lewat tombol "Muat ulang". Status independen dari dropdown `ref`.

## Error handling

- Project tanpa repoDir → status `{ branch:"", staged:[], unstaged:[] }`; section tampil kosong
  ("Tak ada file berubah"), tak error.
- Repo tanpa commit (HEAD unborn) → `git diff --cached` diff atas empty tree (semua staged `A`),
  branch `""`. Tak crash.
- `file-diff` path buruk → 400; file tak ada di changeset → 404 (gerbang path cermin `reviewFile`).
- File biner → `ReviewFile { binary:true, diff:null }`; DiffView tampilkan placeholder "berkas biner".

## Testing

- `server/test/git-ide.test.ts`: `workingStatus` (stage 1 file, modif 1 file tracked, tambah 1
  untracked → assert `staged` berisi yang di-`git add`, `unstaged` berisi modif + untracked-as-A);
  `workingFileDiff` staged vs unstaged mengembalikan diff yang benar; untracked diff = new-file;
  status D content null; path buruk throw.
- `server/test/ide.route.test.ts`: `GET /status` bentuk & 404; `GET /file-diff` 200/400/404.
- `src/test/ide-screen.test.tsx`: section Staged & Changed ter-render dari `ideStatus` mock;
  toggle List|Tree; klik file staged → pane kanan panggil `ideFileDiff` & render diff.
- `src/test/review-view.test.tsx` (bila ada) tetap hijau setelah `DiffView`/`ChangedSection`
  diekstrak (regression reuse).

## Docs tersentuh (commit yang sama)

- `internal/docs/frontend/frontend-implementation.md` — section "IDE Visual (SPEC-182)": tambah
  Staged/Changed + reuse ChangedSection/DiffView.
- `internal/docs/architecture/api-contract.md` — section "IDE Visual": dua endpoint baru.
- `internal/docs/README.md` — index tetap sinkron (link doc yang tersentuh sudah ada).

## Non-goals (YAGNI)

- Aksi stage/unstage/discard dari UI (write). Fitur ini **read-only** — hanya melihat.
- Live push status via WebSocket. Refresh manual + reload setelah git op cukup (cermin ReviewScreen).
- Status untuk `ref` non-working-tree. Staged/unstaged inheren milik working tree.
