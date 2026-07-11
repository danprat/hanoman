# SPEC-189 · Rapihkan IDE — Design

**Tanggal:** 2026-07-11
**Prioritas:** tinggi
**Sumber:** brief

## Konteks

IDE (`IdeScreen`, SPEC-182 · ADR-0034) saat ini masih mentah dibanding tampilan
VS Code. Dua bagian yang berantakan:

1. **Explorer** merender daftar file sebagai **flat list** path penuh
   (`FileTree`, `IdeScreen.tsx:18-37`) — tanpa grouping folder, tanpa collapse.
2. **Git Graph** menggambar lane sebagai garis vertikal per-baris saja
   (`RowSvg`, `GitGraph.tsx:13-24`); percabangan & merge **tidak tersambung**
   secara visual (garis melayang), jadi graf terlihat longgar.

## Objective

Merapihkan tampilan IDE mendekati VS Code:

- **Explorer**: kelompokkan file per folder (tree) dengan folder **default
  collapse**, persis pola yang sudah ada di **Review**.
- **Git Graph**: perbaiki UI baris + buat graf lebih rapih — commit tersambung
  ke parent-nya lintas lane dengan kurva, kolom author/tanggal rata.

Non-goal (YAGNI): file-type icons per ekstensi, indent-guides, compact single-
child folder chains, expand/collapse-all, auto-reveal file ter-select yang
tersembunyi. Ditunda; ditambah kalau memang diminta.

## Arsitektur & Perubahan

### 1. Explorer — folder grouping (reuse Review)

Review sudah punya algoritma & komponen tree yang generik:
`buildFileTree(paths): FileNode[]` + `TreeRow` (`ReviewScreen.tsx:8-71`).
`TreeRow` sudah punya `meta` **opsional** (status/counts khusus review) dan
prop `defaultOpen` (default `false` = collapsed). Input keduanya cuma
`string[]` path — persis yang `api.ideTree` kembalikan.

**Rencana:** ekstrak `FileNode`, `buildFileTree`, `TreeRow`, `ST_COLOR` ke
modul bersama `src/src/screens/file-tree.tsx`. `ReviewScreen` meng-import dari
situ (perilaku identik — test review yang ada menjaganya). `IdeScreen` mengganti
`FileTree` dengan `buildFileTree(files)` + `TreeRow` tanpa `meta`, `defaultOpen`
dibiarkan `false` → folder tertutup saat pertama dibuka.

Kenapa ekstrak (bukan import silang `IdeScreen` → `ReviewScreen`): menghindari
dependensi mundur antar-screen; satu sumber kebenaran untuk UI tree. Ekstraksi
murni mekanis — kode dipindah, bukan ditulis ulang.

**Batas hati-hati:** JANGAN menambah auto-expand "ancestor of selected" ke
`TreeRow` bersama — test Review SPEC-177 mengunci bahwa Files tree tetap
collapsed walau file pertama (`src/a.ts`) ter-select; auto-expand akan membuka
`src/` dan memunculkan `b.ts`, menggagalkan test.

### 2. Git Graph — edge routing (kurva penyambung)

Masalah inti: `RowSvg` cuma menggambar garis vertikal lane + garis pendek dari
commit ke bawah. Tidak ada diagonal/kurva yang menyambungkan commit ke lane
parent-nya, jadi merge & branch tampak putus.

**Model edge (pure, di `git-graph.ts`, diuji unit):** untuk tiap baris hitung
daftar segmen dari state lane **atas** (`top` = `lanes` baris sebelumnya) dan
**bawah** (`bottom` = `lanes` baris ini) + commit & parent-nya:

- **Incoming** (setengah atas): `cIn = top.indexOf(commit.sha)`; jika ada,
  segmen `cIn → commit.lane`. Biasanya vertikal (commit menempati lane yang
  memesannya).
- **Outgoing** (setengah bawah): untuk tiap parent `p`, `tl = bottom.indexOf(p)`;
  segmen `commit.lane → tl`. Parent pertama biasanya vertikal; parent lain
  (branch baru / merge ke lane existing) jadi diagonal.
- **Through** (penuh atas→bawah): lane `j` di `top` dengan sha ≠ commit.sha yang
  berlanjut di `bottom` pada `k`; segmen `j → k`. Karena `computeLanes` hanya
  memangkas null di ekor, pass-through umumnya `j == k` → garis lurus.

`computeLanes` **tidak berubah** (test-nya menjaga `.lane`/`.width`). Fungsi baru
`rowEdges(rows): Edge[][]` mengembalikan satu `Edge[]` per baris.
`Edge = { fromLane, toLane, half: "top"|"bottom"|"full", colorLane }` — dalam
ruang **indeks lane**; view memetakan ke piksel & menggambar cubic-bezier
S-curve. Warna mengikuti `colorLane` agar tiap lane konsisten sepanjang jalur.

Kasus merge-ke-lane-existing terbukti benar: lane parke-2 dapat garis `through`
lurus **plus** edge `outgoing` diagonal dari dot commit → lane tersebut di bawah
(cabang menyatu dari samping). Kasus branch-baru: hanya edge `outgoing`; jadi
`through` di baris berikutnya.

### 3. Git Graph — UI baris

- Kolom rata: `author` lebar tetap (ellipsis), `at` lebar tetap → tak ragged.
- Hover background pada baris (kini hanya baris terpilih yang ber-bg).
- Tanggal relatif ringkas ("2h", "3d") lewat helper kecil, fallback tanggal.
- Ref chip & HEAD indikator dipertahankan (chip current-branch sudah menonjol).

## Data flow

Tidak ada perubahan data model / kontrak API. `api.ideTree` (→ `string[]`) dan
`api.ideGraph` (→ `{ commits: GraphCommit[], current }`) sudah menyediakan semua
bahan. Perubahan murni rendering client-side.

## Error handling

State loading/error/empty Explorer & Graph tetap (`StateBlock`). Tak ada jalur
error baru.

## Testing

- **`git-graph.test.ts`**: pertahankan test `computeLanes` lama; tambah test
  `rowEdges` — linear (semua `through`/vertikal, `fromLane==toLane`), branch
  (parent-2 dapat `outgoing` diagonal ke lane baru), merge (lane existing dapat
  `through` + `outgoing` diagonal).
- **`git-graph-view.test.tsx`**: tetap hijau — struktur baris (subject, ref
  chip, klik detail, context-menu) dipertahankan; hanya internal SVG berubah.
- **`ide-screen.test.tsx`**: `README.md` (leaf root) tetap tampil & klik memuat
  isi; `src/a.ts` kini di bawah folder `src/` collapsed (test tak meng-assert-nya).
  Tambah test: folder `src/` tampil, `a.ts` tersembunyi sampai folder di-expand.
- **`review-screen.test.tsx`**: tetap hijau setelah ekstraksi (import dari modul
  bersama, perilaku identik).

## Docs tersentuh (commit yang sama)

- `internal/docs/frontend/frontend-implementation.md`:
  - Bagian **IDE Visual (SPEC-182)**: "pohon file datar" → tree folder collapse;
    catatan graf → edge routing kurva.
  - Catatan **ReviewScreen**: `buildFileTree`/`TreeRow` kini di modul bersama
    `screens/file-tree.tsx`.
