# ADR-0040 — Jalur cepat qa dielicit lewat prompt, diputuskan agen

**Status:** diterima · 2026-07-13 · SPEC-204 · **supersedes mekanisme ADR-0020**

## Konteks

ADR-0020 memutuskan kebijakan: sesudah Audit, temuan kecil melewati Spec+Plan. Mekanismenya
saat itu `runOne` membaca artefak `.hanoman-decision.json`. Model itu **sudah dicabut** —
sesi kini `claude -p` yang menggerakkan dirinya sendiri (ADR-0024/0035), tak ada `runOne`
maupun artefak yang dibaca. Akibatnya prompt `qa` hanya menyuruh "kerjakan fase berurutan"
dan tiap temuan membayar full Spec+Plan (SPEC-204: "masih full flow spec, plans").

## Keputusan

Keputusan jalur cepat **dielicit lewat prompt** dan **diambil agen**, disurface sebagai
`Spec skipped` / `Plan skipped` di `$HANOMAN_PHASE_FILE` — kanal yang sama dengan transisi
fase lain. Klausa `auditDecisionInstruction(flow)` (`runner/src/prompt.ts`) hanya untuk `qa`:
bila temuan berconfidence tinggi & perbaikannya langsung, lewati Spec+Plan; selain itu
jalankan penuh.

Confidence tetap **satu-bit tingkat-prompt** (seperti ADR-0020); buktinya `reason` audit.

## Konsekuensi

- Kebijakan ADR-0020 tetap; hanya **mekanismenya** yang berpindah dari artefak-runner ke
  phase-file `skipped`. Mesin `skipped` (stage `planned`, keluar dari penyebut progress,
  `planComplete` fast-path) sudah ada di `server/src/services/session-phases.ts` — tak berubah.
- Aman-injeksi: phase file hidup di luar worktree (`.worktrees/.phases/`, `.gitignore`), jadi
  `git add -A` agen tak bisa menyentuhnya — memenuhi keberatan ADR-0020 atas "sentinel di teks Audit".
- Gerbang tak ikut dilewati: `stageForRun`/`planComplete` tetap menahan Execute (ADR-0029).

## Alternatif yang ditolak

- **Menghidupkan kembali artefak `.hanoman-decision.json` + gerbang runner.** Menambah I/O &
  gerbang untuk keputusan yang sudah bisa disurface lewat kanal phase-file yang ada. YAGNI.
- **Skor confidence numerik.** Keputusan efektif satu-bit (lewati / tidak); angka tak menambah kerja.
