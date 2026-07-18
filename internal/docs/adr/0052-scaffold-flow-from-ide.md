# ADR-0052 Scaffold flow: project from-scratch dari ide → SoT penuh

Status: accepted
Tanggal: 2026-07-18

## Context
Flow `scaffold` dijanjikan sejak awal untuk onboarding project **from-scratch** — "brainstorm →
kunci objective → sesi scaffold menyusun seluruh doc index" (onboarding, blueprint,
agent-documentation-workflow) — tapi **tak pernah di-wire** (SPEC-222). `scaffold` sudah ada di
`Flow` union dan `PIPELINES` (`Brainstorm → Objective → Doc index`), tetapi tak ada prompt builder,
tak ada cabang route, dan tak ada pemicu UI. Lebih dari itu, project from-scratch dibuat dengan
`repoDir: null`, jadi **tak ada sesi apa pun yang bisa jalan** — setiap flow butuh checkout lokal +
worktree berbasis HEAD. "Ide awal" yang diketik user pun dibuang sebelum ke API, dan setting
`autoScaffold` (default true) tak dibaca siapa pun.

## Decision
Scaffold berjalan sebagai **sesi claude interaktif project-level** — tanpa baris Spec — meniru
`reverse` (ADR-0026) dan `prd` (ADR-0041), tetapi diseed oleh **ide** alih-alih codebase dan
**tanpa fase Scan**:

- **Repo di-`git init` saat project from-scratch dibuat.** `POST /projects` dengan `kind:"from-scratch"`
  + `repoDir` memanggil `realGit.initRepo(repoDir)`: `git init` + satu commit seed bila belum ada HEAD.
  Idempoten. Ini membuat project langsung runnable (scaffold, prd, terminal biasa).
- **Ide disimpan sebagai `Project.desc`** — tanpa kolom baru, tanpa migration. Prompt scaffold menyeed
  brainstorm dari `desc`.
- **`startScaffoldPrompt`** (`runner/src/prompt.ts`) menggerakkan pipeline `Brainstorm → Objective →
  Doc index`: Brainstorm interaktif (satu pertanyaan per giliran, manusia menjawab di terminal),
  Objective mengunci MVP objective, Doc index menulis **seluruh** `internal/docs/**` per STANDAR DOCS
  yang sudah ada (`REVERSE_STANDARD` dipakai ulang — ia sesungguhnya standar docs, bukan khusus reverse).
- Sesi lahir di `.worktrees/scaffold-<project>` off HEAD; commit + push per fase ke branch `scaffold-docs`;
  manusia me-review lalu merge. Tanpa `AUTONOMY_CLAUSE` — brainstorm memang bergiliran dengan manusia.
- **Pemicu ganda**: tombol "Scaffold docs" di layar project from-scratch (cermin "Reverse docs"), plus
  `autoScaffold` dihidupkan — bila on, sesi scaffold auto-start segera setelah project dibuat.

## Rationale
- Simetris dengan reverse/prd: mesin tmux, worktree lifecycle, phase-file, dan STANDAR DOCS dipakai
  ulang apa adanya — cabang baru minimal, bukan subsistem baru.
- git-init saat create (bukan lazy saat scaffold) membuat project from-scratch runnable untuk semua
  flow, dan memberi HEAD yang dibutuhkan `addWorktree`.
- Ide → `desc` menghindari migration; brainstorm interaktif toh memperdalam ide jadi objective.
- Tanpa Spec: scaffold milik project, bukan backlog item (pola sama dengan reverse/prd/VPS).

## Consequences
- `Spec.stage` tak bergerak untuk sesi scaffold — progres hanya lewat berkas fase.
- Repo from-scratch mendapat commit seed awal + (dari Doc index) Stop hook docs untuk repo target itu.
- DELETE sesi scaffold membuang worktree-nya, sama seperti reverse.
- `autoScaffold` kini bermakna: mematikannya menahan auto-start (tombol manual tetap tersedia).
- Modal from-scratch kini mewajibkan folder (scaffold butuh repo on-disk); project idea-only tanpa
  folder bukan jalur yang didukung SPEC-222.

## Sources
- SPEC-222 · `docs/superpowers/specs/2026-07-18-project-from-scratch-scaffold-spec-222-design.md`
- Sejalan ADR-0026 (reverse), ADR-0041 (prd), ADR-0002 (isolasi worktree), ADR-0015 (satu sesi/backlog).
