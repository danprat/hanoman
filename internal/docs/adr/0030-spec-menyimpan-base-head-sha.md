# ADR-0030 — `Spec` menyimpan baseSha/headSha; review done men-diff darinya

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-176

## Context

[ADR-0019](0019-sha-disimpan-diff-diturunkan.md) memutuskan: simpan **penunjuk** (`baseSha`,
`headSha`), turunkan **isi** diff dari git tiap request. Ia diimplementasikan sebagai dua kolom
pada model `Run` (migration `20260709170000_run_base_head_sha`).

[ADR-0024](0024-sesi-interaktif-menggantikan-run.md) mengganti run headless dengan sesi Claude
Code interaktif dan **membuang model `Run`** — kolom `baseSha`/`headSha` serta `run-changes.ts`
ikut lenyap. Saat review dihidupkan kembali di dunia sesi (SPEC-171, `spec-review.ts`),
penyimpanan SHA **tak ikut dipulihkan**. Review sebuah backlog `done` (worktree sudah dihapus)
jatuh ke heuristik `specCommitRange`: `git log --all -i -F --grep=(spec-N)`, range
`oldest^..newest`.

Heuristik itu:
- **kosong** bila commit item tak terjangkau `git log --all` lokal atau pesannya tak memuat token
  `(spec-N)` → route 409 → UI "Belum ada worktree untuk di-review". Ini gejala SPEC-176.
- **over-report** bila history terjalin: diff dua-titik `base..head` menyeret file spec lain.

Fakta yang sama seperti ADR-0019 masih berlaku di era sesi: worktree lahir *detached* pada satu
commit (`addWorktree` mengembalikan base SHA-nya), agen `commitAndPush` lalu worktree dihapus di
`DELETE /terminal/sessions/:id`. Setelah item selesai: **tak ada worktree, tak ada branch** —
diff yang dihitung terhadap nama branch menunjuk ref yang tiada.

## Decision

Pulihkan ADR-0019 dengan penunjuk pindah dari `Run` ke `Spec` (satu sesi per backlog item,
ADR-0015 — jadi `Spec` adalah baris alami penampung SHA). Dua kolom nullable baru pada `Spec`:

- `baseSha` — commit tempat worktree sesi di-detach, ditulis saat `POST /terminal/sessions`
  (nilai balik `addWorktree`).
- `headSha` — commit HEAD worktree tepat sebelum `removeWorktree` di `DELETE /terminal/sessions/:id`
  (`realGit.headSha(cwd)`).

Keduanya **overwrite tiap sesi**. Karena `headSha` adalah tip worktree detached (= `baseSha` +
hanya commit sesi itu), `baseSha..headSha` **persis** perubahan sesi tersebut — tak pernah
over-report history terjalin. Untuk reopen (SPEC-172), review menunjuk increment sesi terakhir.

Isi diff — daftar file, status, preview source — **tetap tidak disimpan**; `spec-review.ts`
menghitungnya tiap request lewat `specReviewRange(baseSha, headSha)`. Resolusi review saat
worktree lenyap: prefer `baseSha`/`headSha` tersimpan **bila dua-duanya masih terjangkau di
object database** (`shaResolvable` = `git cat-file -e <sha>^{commit}`); selain itu fallback ke
`specCommitRange` grep (kompat spec lama tanpa SHA); selain itu 409.

## Consequences

- **Nol regresi untuk spec lama**: yang belum punya SHA tersimpan tetap dilayani grep.
- `shaResolvable` menjaga SHA yang objeknya sudah di-`git gc` (branch run dibuang sebelum
  di-merge) tak menjatuhkan route ke 500 — lewat ke fallback/409, sesuai konsekuensi ADR-0019.
- Kolom nullable additive: client lama pada shared dev DB tetap jalan (P2022 tak terpicu).
- Bentuk respons `SpecReview` tak berubah → frontend `ReviewScreen` tak tersentuh.
- Migration + `prisma generate` wajib sebelum server booting (CLAUDE.md: skema butuh migration + ADR).

## Alternatif yang ditolak

- **Tetap dengan grep pesan commit.** Bergantung konvensi pesan (`(spec-N)`) yang tak dijamin
  di proyek lain, dan over-report saat history terjalin — akar SPEC-176.
- **Menyimpan `baseSha` sekali (set-if-null), tak overwrite.** Untuk reopen, head akhirnya ada
  di `main` (sesudah merge) → `base..head` menyeret spec lain yang ter-merge di antaranya.
  Overwrite per sesi menjaga head selalu tip detached = diff bersih.
- **Kolom SHA pada baris `Run` baru.** Tak ada lagi model `Run` (ADR-0024); `Spec` sudah 1:1
  dengan sesinya.
