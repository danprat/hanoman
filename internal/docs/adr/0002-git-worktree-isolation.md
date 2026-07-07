# ADR 0002 — Isolasi run dengan git worktree

**Status:** accepted

## Konteks
Beberapa run bisa jalan bersamaan di project sama; mereka tak boleh saling menimpa atau mengotori working tree utama.

## Keputusan
Setiap run mendapat **git worktree** sendiri (`.worktrees/<run>`). Run bisa **pull dari branch mana pun** (`branchFrom`) dan **push ke branch mana pun** (`branchTo`), keduanya dapat diganti dari UI. Setelah selesai, worktree dihapus.

## Konsekuensi
- (+) Paralelisme aman; checkout/branch fleksibel per run.
- (−) Butuh manajemen lifecycle worktree (buat/bersihkan) & ruang disk.
