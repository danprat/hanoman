# ADR-0029 — `Execute done` hanya sah bila plan terceklist penuh

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-173
**Mengamandemen:** [ADR-0008](0008-stage-mirrors-run.md) (stage cermin fase), [ADR-0024](0024-sesi-interaktif-menggantikan-run.md)

## Context
`Spec.stage` adalah cermin monotonic-forward dari fase yang **dilaporkan agen** ke
`$HANOMAN_PHASE_FILE` (ADR-0008, ADR-0024). `stageFor()` memetakan baris `Execute done`
(atau `skipped`) langsung ke stage `done`. Dua jalur mem-persist-nya —
`GET /specs` write-through dan `advanceStage()` saat `DELETE /terminal/sessions/:id` —
keduanya **percaya penuh** pada berkas fase.

Efeknya (SPEC-173): backlog dengan plan multi-PR bisa loncat ke `done` setelah agen
menyelesaikan sebagian saja. SPEC-162 nyata: 4 PR dalam plan, agen execute 1 PR, tulis
`Execute done`, backlog di-claim `done` — 3 PR (puluhan task `- [ ]`) tersisa, human
menyelesaikannya manual. Tak ada verifikasi bahwa plan-nya benar-benar tuntas, padahal
sumber kebenaran progres sudah ada: kotak checklist `- [ ]`/`- [x]` di file plan, yang
konvensinya (CLAUDE.md) dicentang agen tiap task selesai.

## Decision
Stage turunan tak boleh mencapai `done` selama plan spec itu masih punya task belum
dicentang. `planComplete(worktree, specId)` memindai `docs/superpowers/plans/` di worktree
run untuk file yang cocok segmen spec-id (batas kiri non-alnum, kanan non-digit — sama
seperti `artifactsToRemove`); `false` bila ada yang masih memuat `- [ ]`. `stageForRun()`
membungkus `stageFor()`: `done` → `executing` bila `!planComplete`. Kedua jalur persist
memakai `stageForRun`; `stageFor` yang murni tetap ada (dites langsung, tanpa I/O).

Tak ada file plan yang cocok → `planComplete = true`. Ini menjaga fast-path qa yang
melewati Plan (`Plan skipped`, tak menghasilkan plan) tetap bisa mencapai `done`. Plan
dibaca dari filesystem worktree, bukan git — mencerminkan checklist live termasuk yang
belum di-commit.

Lapis kedua (pencegahan): untuk flow ber-fase Plan+Execute, prompt memberi tahu agen agar
menyelesaikan SEMUA PR/task sampai tiap kotak `- [x]` sebelum menulis `Execute done`.

## Consequences
- `done` kini menuntut plan tuntas, bukan sekadar klaim agen. Backlog multi-PR bertahan di
  `executing` sampai setiap `- [ ]` jadi `- [x]` — sinyal jelas kerja belum selesai.
- Tak ada perubahan skema: `executing` sudah stage yang ada; `Spec.stage` tak berubah.
  `stageFor` tetap murni & forward-only; guard `STAGES.indexOf` di kedua pemanggil utuh.
- Ketat by design: agen yang lupa mencentang kotak untuk kerja yang sudah selesai membuat
  backlog tertahan di `executing`. Itu sesuai objective SPEC-173; centang-per-task jadi
  wajib dan prompt menegaskannya.
- `advanceStage()` membaca plan dari `s.cwd` (worktree masih ada sebelum `removeWorktree`);
  `sessionPhasesBySpec()` kini membawa `cwd` pane agar write-through bisa menggerbang.
