# SPEC-173 — Backlog Belum Selesai (Execute butuh plan terceklist)

## Objective
Backlog item tak boleh berstatus `done` selama plan-nya belum terceklist penuh. Kasus
nyata: SPEC-162 punya 4 PR dalam spec + plan; hanoman meng-execute 1 PR lalu meng-claim
`done`, padahal 3 PR (puluhan task `- [ ]`) masih tersisa — human terpaksa menyelesaikan
sisanya manual. Yang diharapkan: `done` hanya sah kalau **setiap** kotak checklist di
`docs/superpowers/plans/**` milik spec itu sudah `- [x]`, dan agen tak berhenti execute
sebelum itu.

Prioritas: tinggi. Severity: major. Sumber: qa.

## Konteks
`Spec.stage` adalah cermin *monotonic-forward* dari fase yang **dilaporkan agen** ke
`$HANOMAN_PHASE_FILE` (ADR-0008, diperkuat ADR-0024). Agen menulis satu baris per transisi,
mis. `echo "Execute done" >> "$HANOMAN_PHASE_FILE"`.

`stageFor()` (`server/src/services/session-phases.ts:50`) memetakan fase → stage. Baris
`Execute done` (atau `skipped`) langsung memetakan ke stage `done`:

```ts
const REACHED = { ..., Execute: "done" };   // session-phases.ts:47-49
```

Dua jalur mem-persist stage itu, keduanya **percaya penuh** pada berkas fase:
- `GET /specs` write-through live (`server/src/routes/specs.ts:23-40`).
- `DELETE /terminal/sessions/:id` → `advanceStage()` (`server/src/routes/terminal.ts:20-26`).

**Akar masalah:** tak ada satu pun titik yang memverifikasi bahwa plan-nya benar-benar
selesai. Agen menulis `Execute done` setelah 1 PR, `stageFor` mengembalikan `done`, dan
backlog di-claim selesai. Prompt (`runner/src/prompt.ts:15-19`) pun tak pernah memberi tahu
agen bahwa Execute **belum** selesai selama masih ada `- [ ]`.

Sumber kebenaran progres yang nyata sudah ada: kotak checklist di file plan. Konvensi repo
(CLAUDE.md): agen mencentang `- [ ]` → `- [x]` tiap task selesai. Itulah sinyal yang
harus digerbang.

## Keputusan
Dua lapis (defense-in-depth), sesuai dua tuntutan objective:

1. **Gerbang (enforcement, server).** Saat stage turunan akan mencapai `done`, verifikasi
   plan spec itu di worktree run-nya. Kalau ada file plan yang cocok spec-id-nya masih
   memuat `- [ ]`, **tahan di `executing`** — jangan biarkan `done`. `executing` sudah stage
   sah dan konsisten dengan pemetaan `Execute active → executing` yang ada.

2. **Pencegahan (prompt).** Untuk flow yang punya fase Plan **dan** Execute (feature, qa),
   prompt memberi tahu agen secara eksplisit: kerjakan SEMUA PR/task sampai tiap kotak
   `- [x]` sebelum menulis `Execute done`; hanoman menahan backlog di `executing` selama
   masih ada `- [ ]`.

### Detail gerbang
- `planComplete(worktree, specId): boolean` — `false` hanya jika ada file di
  `<worktree>/docs/superpowers/plans/` yang cocok segmen spec-id (regex batas kiri
  non-alnum, kanan non-digit — sama seperti `artifactsToRemove`, jadi `spec-16` tak
  menyerempet `spec-167`) dan masih memuat baris `- [ ]`.
- Tak ada file plan yang cocok → `true`. Ini menjaga **fast-path qa** yang melewati Plan
  (`Plan skipped`, tak menghasilkan plan) tetap bisa mencapai `done`, juga worktree tanpa
  docs. Gerbang hanya menahan ketika memang ADA checklist yang belum tuntas.
- Dibaca dari worktree (filesystem), bukan git — mencerminkan keadaan checklist live,
  termasuk yang belum di-commit.
- `stageForRun(phases, worktree, specId)` = `stageFor(phases)`, tapi `done` → `executing`
  bila `!planComplete`. Dipakai kedua jalur persist; `stageFor` yang murni tetap ada
  (dites langsung, tak ber-I/O).

### Jalur worktree
- `advanceStage()`: worktree = `s.cwd` sesi (masih ada; `advanceStage` jalan **sebelum**
  `removeWorktree`).
- `GET /specs`: `sessionPhasesBySpec()` kini juga membawa `cwd` pane, jadi write-through
  bisa menggerbang per spec.

## Yang TIDAK berubah
- Tak ada perubahan skema (`Spec.stage` tetap enum yang sama, `executing` sudah ada).
- `stageFor` tetap murni & forward-only; guard `STAGES.indexOf` di kedua pemanggil utuh.
- Kode & commit Execute tak pernah dihapus otomatis.

## Konsekuensi
- Backlog dengan plan multi-PR tak lagi bisa loncat ke `done` setelah sebagian PR — ia
  bertahan di `executing`, sinyal jelas bagi human bahwa kerja belum tuntas.
- Kalau agen lupa mencentang kotak untuk kerja yang sebenarnya sudah selesai, backlog
  tertahan di `executing`. Itu memang ketat sesuai objective ("jangan sampai done kalau
  belum terceklist") — konvensi centang-per-task jadi wajib, dan prompt menegaskannya.
- Lihat ADR-0029.
