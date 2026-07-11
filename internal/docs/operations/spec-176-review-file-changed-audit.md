# SPEC-176 — audit: review backlog `done` kosong file changed-nya

**Sumber:** qa · **Prioritas:** tinggi · **Fase:** Audit (superpowers:systematic-debugging)

## Gejala (dilaporkan)

Backlog item yang sudah `done` **tidak memperlihatkan file apa saja yang berubah**.
Harapannya: history file-changed tetap ada meski pekerjaannya sudah di-merge, dan diff-nya
memakai **SHA commit (start + end)**, bukan nama branch.

## Fase 1 — akar masalah

### Bagaimana review bekerja sekarang

`server/src/routes/specs.ts` `resolveReview()` bercabang dua:

1. **Worktree masih ada** (`<repoDir>/.worktrees/<specid>`) → `specReview()` men-diff working
   tree atas `merge-base(branchFrom‖main, HEAD)` — sebuah **nama branch**.
2. **Worktree lenyap** (item selesai) → `specCommitRange()`:
   `git log --all -i -F --grep=(spec-N) --format=%H`, ambil range `oldest^..newest`.

Cabang (2) itu satu-satunya jalan review sebuah backlog `done`, dan ia rapuh:

- **Kosong** saat commit item tak terjangkau `git log --all` yang lokal, atau pesannya tak
  memuat token literal `(spec-N)` (proyek lain yang dikelola hanoman tak wajib pakai konvensi
  itu). `specCommitRange` → `null` → route balas **409** → `ReviewScreen` menampilkan state
  kosong *"Belum ada worktree untuk di-review"*. Inilah "kosong" yang dilaporkan.
- **Over-report** saat history terjalin (spec lain ter-merge di antara `oldest` dan `newest`):
  diff dua-titik `base..head` ikut menyeret file spec lain. Comment `ponytail:` di
  `spec-review.ts:99-100` sudah menamai risiko ini.

Bukti git (repo ini, 2026-07-11): grep untuk `(spec-172)` memang menemukan 6 commit, tapi
kebergantungan pada konvensi pesan + `--all` lokal bersifat kebetulan, bukan jaminan.

### Kenapa penunjuk SHA-nya hilang

`ADR-0019` (SHA disimpan, diff diturunkan, SPEC-144) sudah memutuskan solusi yang persis
diminta ticket: simpan `baseSha` (commit detach worktree) + `headSha` (commit sesudah commit
selesai) pada baris run, lalu **turunkan** diff `baseSha..headSha` dari git tiap request.
Migration `20260709170000_run_base_head_sha` mengimplementasikannya di model `Run`.

`ADR-0024` (sesi interaktif menggantikan run) membuang model `Run` — dan kolom
`baseSha`/`headSha` ikut lenyap bersamanya (`run-changes.ts` juga dihapus). Saat review
dihidupkan ulang di dunia sesi (SPEC-171, `spec-review.ts`), **penyimpanan SHA tak pernah
dipulihkan**; done-review jatuh ke heuristik grep di atas.

Konsekuensi konkret di kode sekarang:
- `schema.prisma` `model Spec` **tak punya** kolom SHA.
- `runner/src/git.ts` `addWorktree()` **menghitung** base commit lalu **mengembalikannya**, tapi
  pemanggil di `server/src/routes/terminal.ts:58` **membuangnya**.
- head commit sesi ada di `s.cwd` (worktree) tepat sebelum `removeWorktree()` di
  `terminal.ts:131`, tapi tak pernah dibaca/disimpan.

## Fase 2 — pola pembanding

Live-review (cabang 1) sudah benar secara isi tapi memakai **branch** (`merge-base main HEAD`)
sebagai basis — begitu `main` bergerak/worktree lenyap, basisnya ikut hilang. ADR-0019 sudah
memformalkan bahwa **penunjuk ke momen yang tak dapat direkonstruksi harus disimpan**; ini
tepat kasus done-review.

## Keputusan audit

Pulihkan ADR-0019 untuk era sesi: **simpan `baseSha` + `headSha` pada `Spec`**, review done
men-diff `baseSha..headSha` (SHA, bukan branch, bukan grep). Grep `specCommitRange` disisakan
sebagai **fallback** untuk spec lama yang belum punya SHA tersimpan — nol regresi. Perlu
migration + ADR baru (ADR-0030) karena mengubah skema.

Fase Spec & Plan **dijalankan** (bukan dipangkas, ADR-0020): perubahan menyentuh skema, runner,
route, dan service — cukup besar untuk butuh desain terceklist.
