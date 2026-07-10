# SPEC-177 — objective (Review Collapse & File Changed tree)

**Status:** objective dikunci 2026-07-11 · prioritas tinggi · sumber qa
**Design/spec:** [`docs/superpowers/specs/2026-07-11-review-collapse-tree-spec-177-design.md`]

## Objective

Layar Review (SPEC-171) punya dua kekurangan UX:

1. **Folder tree "Files" mount dalam keadaan sebagian expanded.** Saat pertama membuka review,
   folder top-level sudah terbuka. Diharapkan **semua folder collapsed** saat pertama dibuka.
2. **Section "Changed" hanya flat list** — path penuh tanpa visual folder induk. Reviewer minta
   **dua visual** untuk file changed yang bisa di-toggle.

## Outcome yang dikunci

- Buka Review pertama kali → **semua folder collapsed** (Files tree dan Changed tree).
- Section "Changed" punya toggle **List | Tree**:
  1. **List** (existing) — flat, path penuh, tanpa folder induk.
  2. **Tree** — file changed diperlihatkan di bawah rantai folder induknya (parent…parent).
- Tree Changed tetap membawa metadata per file: status `A/M/D` + `+add −del`.
- Default toggle = **List** (behavior lama dipertahankan). Klik "Tree" → tampil tree,
  auto-expand supaya rantai induk file changed langsung terlihat.

## Batasan

- Read-only, tanpa perubahan skema, tanpa migration, tanpa gate baru → **tanpa ADR**.
- Murni frontend (`src/src/screens/ReviewScreen.tsx`) — endpoint SPEC-171 tak berubah.
- Reuse `buildFileTree` + `TreeRow` yang sudah ada; tak ada komponen tree baru.
