# ADR-0020 — Fase perencanaan alur QA dipangkas oleh keputusan audit

**Status:** diterima · 2026-07-09 · SPEC-145

## Konteks

`PIPELINES.qa = ["Audit", "Spec", "Plan", "Execute"]` adalah konstanta. Setiap run QA membayar
Spec dan Plan, termasuk untuk temuan yang perbaikannya satu baris. SPEC-142 adalah contohnya:
audit-nya menutup dengan "satu diff kecil", lalu tetap menjalankan dua fase perencanaan penuh.

Semua tuas pemangkas fase yang ada dievaluasi **sebelum** run mulai — `input.only` di payload
job, `phasesForFlow` saat `enqueueRun`. Pada detik keduanya dibaca, Audit belum berjalan.

## Keputusan

Sesudah fase Audit, `runOne` membaca artefak `.hanoman-decision.json` yang ditulis agen di root
worktree. `{"path":"execute"}` memangkas `["Spec","Plan"]`, yang dipancarkan sebagai state fase
baru **`skipped`**. Apa pun selainnya menjalankan pipeline penuh.

Keputusan itu **satu bit**, bukan skor kepercayaan: `path: "execute"` dengan confidence rendah
hanya bisa berarti "jangan execute". Confidence hidup di instruksi prompt; buktinya `reason`
yang tercatat di log run.

## Konsekuensi

- Pipeline flow tidak lagi sepenuhnya diketahui saat enqueue. `phasesForFlow` tetap menyemai
  empat baris `pending`; dua di antaranya dapat berakhir `skipped`.
- `skipped` keluar dari penyebut `progress` — bukan dihitung sebagai belum selesai.
- Keputusan bertahan melewati resume tanpa kolom baru: `donePhases` dibaca dari `Run.phases`,
  dan `skipped` ikut terhitung sebagai "jangan jalankan lagi" (ADR-0017).
- **Gerbang tidak ikut dilewati.** `deps.verify` tetap menjaga Execute (ADR-0001). Yang dilewati
  dua giliran claude, bukan Source of Truth. Jalur cepat sah karena dokumen audit menjadi
  doc-of-record bagi perbaikan kecil.
- Artefak dihapus tanpa syarat sebelum `commitAndPush`: `git add -A` men-stage berkas ber-titik
  di root, dan run yang mati sebelum pembacaan tak pernah membersihkannya sendiri.
- Kegagalan membaca artefak **tidak** menggagalkan run (menyimpang dari ADR-0009 dengan sengaja):
  yang gagal sebuah optimasi, bukan guardrail. Degradasinya adalah perilaku hari ini.

## Alternatif yang ditolak

- **Sentinel di teks jawaban Audit.** Fase Audit membaca kode dan log; baris berisi sentinel di
  dalam berkas yang ia kutip dapat ikut tercetak. Keputusan melewati perencanaan tak boleh punya
  jalur injeksi.
- **Gerbang manusia sesudah Audit.** Menolak objective: brief meminta perbaikan berjalan langsung.
- **Menandai fase yang dilewati `done`.** `PHASE_DONE_STAGE` memetakan `Plan → planned`; backlog
  item akan mengaku punya plan yang tak pernah ditulis.

## Catatan penomoran

Rancangan (fase Spec) mengasumsikan nomor **ADR-0019**. Pada fase Execute, enumerasi ulang atas
`refs/heads`/`refs/remotes` **dan** direktori worktree fisik menemukan `internal/docs/adr/0019-sha-disimpan-diff-diturunkan.md`
sudah ada di `.worktrees/run-8804` (SPEC-144, detached HEAD — tidak terlihat lewat enumerasi
`refs/*` saja). ADR ini karena itu memakai **0020**, bukan 0019.
