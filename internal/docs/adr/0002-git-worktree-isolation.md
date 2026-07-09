# ADR 0002 — Isolasi run dengan git worktree

**Status:** accepted

## Konteks
Beberapa run bisa jalan bersamaan di project sama; mereka tak boleh saling menimpa atau mengotori working tree utama.

## Keputusan
Setiap run mendapat **git worktree** sendiri (`.worktrees/<run>`), **tepat satu, tidak lebih**. Run bisa **pull dari branch mana pun** (`branchFrom`) dan **push ke branch mana pun** (`branchTo`), keduanya dapat diganti dari UI. Setelah selesai, worktree dihapus.

Satu run = satu worktree ditegakkan di tiga titik:
1. **`jobId = runId`** saat `enqueueRun` menambah job BullMQ. Tanpa ini `resume`/`retry` membuat job kedua untuk run yang sama → dua `runOne` → `addWorktree` (yang force-remove + recreate) saling menghapus worktree di tengah jalan.
2. **`enqueueRun` menolak run yang masih `queued`/`running`** (409) dan menolak project tanpa `repoDir` absolut. `${repoDir}/.worktrees/<id>` yang relatif akan resolve terhadap cwd proses yang meng-enqueue — api dan worker jalan dari cwd berbeda, jadi satu run bisa mendarat di dua lokasi.
3. **Guardrail `deniesDangerous` menolak `git worktree add`** dari dalam run. Tiap fase men-spawn `claude` dengan `--setting-sources user,project,local`, jadi skill semacam `using-git-worktrees` ikut ter-load dan agent bisa membuat worktree yang runner tak pernah bersihkan.

## Konsekuensi
- (+) Paralelisme aman; checkout/branch fleksibel per run.
- (−) Butuh manajemen lifecycle worktree (buat/bersihkan) & ruang disk.
- (−) Project tanpa `repoDir` absolut tidak bisa menjalankan run — disengaja, karena alternatifnya adalah worktree di lokasi yang tak terduga.
