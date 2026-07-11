# SPEC-177 — Review Collapse & File Changed tree

**Status:** design · disetujui 2026-07-11
**Date:** 2026-07-11
**Objective:** [`internal/docs/operations/spec-177-review-collapse-tree-objective.md`]

## Objective

Perbaiki dua hal di layar Review (`src/src/screens/ReviewScreen.tsx`):
1. Semua folder **collapsed** saat review pertama dibuka.
2. Tambah **visual tree** untuk section "Changed" (di-toggle dengan flat list existing).

## Why

`TreeRow` mount dengan `useState(depth < 1)` → folder top-level langsung terbuka; reviewer
mengeluh "beberapa folder sudah expande". Section "Changed" cuma flat list path penuh, jadi tak
kelihatan struktur folder dari file yang berubah. Reviewer minta bisa melihat file changed dalam
konteks rantai folder induknya, tanpa membuang tampilan flat yang sudah ada.

## Decisions (locked)

| Keputusan | Pilihan |
|---|---|
| Initial open Files tree | **Semua collapsed** — `TreeRow` default `open = false` |
| Visual Changed | Dua mode, toggle **List \| Tree** di header "Changed · N" |
| Default mode Changed | **List** (existing dipertahankan) |
| Tree Changed source | `buildFileTree(changed.map(c => c.path))` — reuse builder yang ada |
| Leaf tree Changed | Bawa status `A/M/D` + `+add −del`, seperti flat list |
| Auto-expand tree Changed | **Ya** — rantai induk file changed langsung terlihat (`defaultOpen`) |
| Komponen | Reuse `TreeRow`; tambah prop opsional `meta` + `defaultOpen`. Tanpa komponen baru |
| Skema / endpoint | Tak berubah → **tanpa ADR, tanpa migration** |

## Architecture

Perubahan tunggal di `ReviewScreen.tsx`:

### 1. `TreeRow` — prop baru (backward-compatible)

```ts
function TreeRow({ node, selected, onSelect, depth = 0, meta, defaultOpen = false }: {
  node: FileNode; selected: string; onSelect: (p: string) => void; depth?: number;
  meta?: Record<string, ChangedFile>;   // path → metadata; leaf tampil status + +/- kalau ada
  defaultOpen?: boolean;                 // start terbuka (dipakai tree Changed)
})
```

- Folder: `useState(defaultOpen)` menggantikan `useState(depth < 1)`. Files tree tak passing
  `defaultOpen` → **collapsed** (fix bug). Tree Changed passing `defaultOpen` → expanded.
- Leaf: kalau `meta[node.path]` ada → render status color + `+add −del` (sama seperti flat list).
  Kalau tidak → render polos seperti sekarang (Files tree).
- `defaultOpen` diteruskan ke anak folder supaya seluruh sub-tree ikut terbuka.

### 2. Section "Changed" — toggle List | Tree

- State baru: `const [chView, setChView] = React.useState<"list" | "tree">("list")`.
- Dua tombol ikon (`list` / `folder-tree`) di header "Changed · N".
- `list` → render existing (tak berubah).
- `tree` → `buildFileTree(changed.map(c => c.path))`, render `TreeRow` dengan
  `meta = Object.fromEntries(changed.map(c => [c.path, c]))` dan `defaultOpen`.

## Test plan (TDD)

Perluas `src/test/review-screen.test.tsx`:
1. **Files tree collapsed default** — mock `files` bersarang (`src/a.ts`); assert isi folder `src/`
   TIDAK tampil sampai header folder di-klik.
2. **Toggle Changed → Tree menampilkan folder induk** — klik tombol Tree; assert node folder
   (`src/`) muncul di section Changed dan file changed tampil di bawahnya dengan `+add`.
3. Test existing (flat list + tab Source) tetap hijau.

## Non-goals

- Tak menyentuh endpoint / service SPEC-171.
- Tak persist pilihan view (reset ke List tiap buka). Tak ada poll realtime.
