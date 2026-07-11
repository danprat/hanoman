# ADR-0031 — Rebase & merge branch done spec dari dashboard

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-175
**Terkait:** [ADR-0002](0002-git-worktree-isolation.md) (isolasi worktree), [ADR-0016](0016-sesi-terminal-hidup-di-tmux.md) (sesi tmux), [ADR-0018](0018-branch-adalah-properti-backlog-item.md) (branch properti backlog item)

## Context
Sebuah backlog item yang selesai meninggalkan branch hasil kerja `hanoman/<id>` — agen
mem-push HEAD ke `refs/heads/hanoman/<id>` di origin pada akhir run (SPEC-162). Prompt run
menutup dengan *"Manusia yang me-review dan merge branch"*: integrasi ke branch tujuan
selama ini manual di luar dashboard. SPEC-175 memberi aksi itu di UI (backlog & terminal),
dengan syarat hanya untuk item yang sudah `done`.

Dua kendala mengikat desainnya:
1. hanoman **tak pernah** menyentuh working tree utama (ADR-0002; `main` ter-checkout di sana
   dan bisa dibagi sesi lain). Meng-update ref branch yang sedang di-checkout akan merusak
   working tree itu.
2. Integrasi bisa konflik, dan menyelesaikan konflik adalah pekerjaan penilaian — bukan
   sesuatu yang layak digerbang mesin secara diam-diam.

## Decision
**Server menjalankan git-nya langsung; claude hanya dipanggil saat konflik.**
`POST /specs/:id/integrate { op, target }` menjalankan `git merge`/`git rebase` di worktree
isolasi `<repoDir>/.worktrees/merge-<id>` (detached), tak pernah di working tree utama.

- **Source** = branch spec `hanoman/<id>` (resolve `origin/hanoman/<id>` → fallback lokal).
- **Target** dipilih operator, boleh **lokal** (`local:<b>`, `refs/heads`) atau **origin**
  (`origin:<b>`, `refs/remotes/origin`) — tujuannya di tangan operator. `GET
  /projects/:id/branches` diperluas dengan `remotes` untuk memasok pilihan itu.
- **merge**: base tip target, `git merge` branch spec. Bersih → target lokal `git branch -f`
  (git **menolak** bila branch sedang di-checkout → gagal aman, 409, sarankan origin); target
  origin `git push` (non-fast-forward ditolak git → 409, tak ada korupsi).
- **rebase**: replay branch spec di atas tip target, bersih → `git push --force-with-lease`
  ke `hanoman/<id>`. Target lokal/origin hanya memilih tip yang di-rebase-onto; hasil tak
  pernah menulis target.
- **Bersih** → hapus worktree, `{ status:"clean", detail }`. **Konflik** → tinggalkan worktree
  konflik dan spawn sesi claude interaktif di sana (tanpa flow → tak menggerakkan stage);
  UI pindah ke Terminal. Worktree konflik dibersihkan saat sesi ditutup (`DELETE
  /terminal/sessions/:id` kini juga membersihkan sesi tanpa-flow yang cwd-nya di `.worktrees/*`).

## Alternatif ditolak
- **Selalu lewat sesi claude** (termasuk merge bersih): satu jalur, tapi membayar satu giliran
  claude untuk operasi git deterministik yang mayoritas bersih — boros & kurang deterministik.
- **Update `main` lokal saat ter-checkout** (via `update-ref`): melanggar ADR-0002, merusak
  working tree bersama. Gagal-aman + saran origin dipilih; upgrade path bila perlu: update-ref
  hanya bila kita pemilik checkout.

## Consequences
- Merge bersih instan tanpa sesi; konflik selalu punya rumah yang jujur (terminal claude).
- Tanpa perubahan skema: source diturunkan dari konvensi id, target dipilih saat panggil.
- Asumsi origin ada (branch done spec lahir dari push ke origin); bila source ref tak ada → 409.
- Merge ke branch lokal yang ter-checkout tak didukung (gagal aman) — batasan yang diterima.
