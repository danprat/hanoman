# ADR-0026 Reverse docs sebagai sesi interaktif project-level

Status: accepted
Tanggal: 2026-07-10

## Context
Flow `reverse` dijanjikan sejak awal untuk onboarding project existing, tapi tak pernah
punya pemicu: CLI headless-nya dicabut bersama runner lama (ADR-0024), dan cabang
`{ project }` di POST /terminal/sessions hanya melahirkan sesi kosong tanpa prompt.
Acuan standar docs-driven yang dituju adalah termilo (SPEC-166).

## Decision
Reverse berjalan sebagai sesi claude interaktif project-level — tanpa baris Spec — di
worktree `.worktrees/reverse-<project>`, dipicu manusia dari UI. Pipeline lima fase:
Scan → Docs teknis → Wawancara → Konvensi & index → Serah terima. Standar docs yang
diikuti (struktur internal/docs, ADR, EARS, README index, CLAUDE.md/AGENTS.md, Stop hook
ensure-docs-updated untuk repo TARGET) dikodifikasi di `runner/src/reverse-standard.ts`
dan di-inline ke prompt. Commit + push per fase ke branch `reverse-docs`; manusia yang
me-review dan merge. Prompt semua flow kini juga memetakan fase → skill superpowers.

## Rationale
- Wawancara non-teknis butuh dialog manusia — sesi tmux interaktif adalah kanal yang ada.
- Konstanta di runner ter-version bersama kode yang memakainya, tak bergantung setup mesin.
- Tanpa Spec: reverse milik project; memaksakan baris Spec hanya menambah cabang if
  (pola yang sama dengan keputusan VPS bukan Project di SPEC-164).
- Push per fase: worktree bisa lenyap saat sesi ditutup; branch adalah tempat kerja selamat.

## Consequences
- `Spec.stage` tak bergerak untuk sesi reverse — progres hanya lewat berkas fase.
- Repo target mendapat Stop hook docs; repo hanoman sendiri tetap tanpa gate (ADR-0023).
- DELETE sesi reverse membuang worktree-nya, sama seperti sesi backlog item.
