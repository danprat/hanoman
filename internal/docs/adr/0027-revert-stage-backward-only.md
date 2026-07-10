# ADR-0027 — Stage boleh mundur atas perintah human eksplisit

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-167
**Mengamandemen:** [ADR-0008](0008-stage-mirrors-run.md) (stage cermin fase, monotonic-forward), [ADR-0024](0024-sesi-interaktif-menggantikan-run.md)

## Context
`Spec.stage` adalah cermin monotonic-forward dari fase yang dilaporkan agen (ADR-0008,
ADR-0024). Satu-satunya penulis, `advanceStage()`, menolak gerak mundur
(`server/src/routes/terminal.ts` — `indexOf(next) <= indexOf(spec.stage)` → return). Tak
ada jalur bagi human untuk mengembalikan item ke fase lebih awal saat ingin mengulang.

## Decision
Human boleh memundurkan `Spec.stage` ke stage lebih awal mana pun lewat
`PATCH /specs/:id { stage }`. Guard backward-only (`indexOf(target) < indexOf(current)`,
selain itu 422) adalah cermin terbalik dari guard forward-only agen — agen tetap
forward-only. Saat mundur, artefak docs superpowers ber-spec-id milik fase di atas target
dibersihkan lewat dry-run + `confirmDelete`: panggilan tanpa `confirmDelete` yang akan
menghapus berkas membalas `{ pending: true, stage, wouldDelete[] }` tanpa mengubah apa pun,
sehingga UI menampilkan daftar berkas lebih dulu; hanya `confirmDelete: true` yang
menghapus dan memindahkan stage. Kode & commit fase Execute **tak pernah** dihapus otomatis.

## Consequences
- Stage bukan lagi murni monotonic: maju hanya lewat agen, mundur hanya lewat human.
- Sesi lama yang ditutup setelah revert wajar memajukan stage lagi (guard forward-only) —
  diterima; revert adalah reset niat, bukan penguncian.
- Penghapusan artefak reuse `deleteDoc` (guard `.md` + dalam-repo), mekanisme yang sama
  dengan `DELETE /projects/:id/docs/*path`. Berkas dihapus dari working tree, tak di-commit
  otomatis — sama seperti endpoint docs itu. Proyek tanpa dir superpowers → no-op.
- Pemetaan fase→artefak bersandar pada konvensi penamaan superpowers by spec-id
  (`docs/superpowers/specs/*` = `spec-ready`, `docs/superpowers/plans/*` = `planned`).
  Hanya dua jenis berkas itu yang dalam cakupan; tak ada tabel audit revert.
