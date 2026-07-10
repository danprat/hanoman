# SPEC-171 — objective (All File & File Changed)

**Status:** objective dikunci 2026-07-11 · prioritas tinggi
**Design/spec:** [`docs/superpowers/specs/2026-07-11-hanoman-all-file-changed-spec-171-design.md`]

## Objective

Dashboard hanoman menampilkan **seluruh file project** dan **file yang berubah** untuk sebuah
backlog item, agar hasil kerja agen bisa di-review sebelum di-merge. UI referensi VSCode: explorer
file di kiri, viewer diff/source di kanan.

## Konteks

Backlog item (`Spec`) dijalankan di worktree `<repoDir>/.worktrees/<specid>` (`--detach` di
`branchFrom`, commit ke `hanoman/<specid>`). Sampai kini tak ada jendela ke file yang disentuh sesi
selain terminal mentah — `SpecDetail` hanya menampilkan objective + brief. Reviewer tak bisa melihat
"apa yang berubah" tanpa membuka worktree di editor lain.

## Outcome yang dikunci

- Layar Review full-width, dibuka dari backlog item.
- **All files** = daftar file worktree (tracked + untracked-tak-ignored via `git ls-files`), patuh
  `.gitignore` — bukan `readdir` mentah yang menuruni `node_modules`.
- **File changed** = diff worktree terhadap fork point (`git merge-base <branchFrom‖main> HEAD`):
  committed-on-top + uncommitted + untracked, dengan `+add −del` dan status `A/M/D`.
- Klik file → diff unified atau source penuh (tab), dipotong 256 KB.
- Sumber = worktree; diturunkan dari git tiap request, tak disimpan.

## Batasan

- Tanpa perubahan skema, tanpa migration, tanpa gate baru → tanpa ADR.
- Worktree hilang (sesi sudah di-DELETE) di luar cakupan — dijawab 409 + state kosong; fallback branch
  menyusul.
- Bukan editor: read-only. Tanpa poll realtime — muat sekali + tombol muat ulang.

## Endpoint

- `GET /specs/:id/review` → `{ base, files, changed }`
- `GET /specs/:id/review/*path` → `{ path, status, binary, truncated, diff, content }`
