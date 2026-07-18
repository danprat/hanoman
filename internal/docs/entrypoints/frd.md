# Functional requirements — hanoman

Perilaku per fitur (gaya EARS; lihat `requirements/acceptance-criteria-ears-standard.md`).

## Sesi (eksekusi)
- WHEN sebuah backlog item dijalankan, THE SYSTEM SHALL membuka sesi `claude` interaktif di git worktree terisolasi (`.worktrees/<spec>`).
- WHILE sebuah sesi berjalan, THE SYSTEM SHALL tetap menerima steer/interupsi dari manusia lewat terminal.
- Docs acuan yang stale tidak lagi memblokir plan/execute (guardrail Source of Truth dicabut, SPEC-160/ADR-0023) — `internal/docs/**` tetap konvensi, coverage-nya tetap dilaporkan (`docs scan`).

## Projects · from-scratch (scaffold — SPEC-222/ADR-0052)
- WHEN project `from-scratch` dibuat dengan direktori dipilih, THE SYSTEM SHALL `git init` direktori itu
  dan membuat satu commit seed bila belum ada HEAD, lalu menyimpan `repoDir`. IF `git init`/commit gagal,
  THEN THE SYSTEM SHALL menolak pembuatan (400) tanpa meninggalkan baris project.
- WHERE project `from-scratch` sudah punya `repoDir`, THE SYSTEM SHALL menawarkan aksi **Scaffold docs**
  yang membuka sesi `flow:"scaffold"` project-level di worktree `.worktrees/scaffold-<project>`.
- WHEN sesi scaffold berjalan, THE SYSTEM SHALL memandu fase Brainstorm → Objective → Doc index secara
  interaktif (satu pertanyaan per giliran, dijawab di Terminal), menyeed dari ide project (`desc`), lalu
  menulis seluruh `internal/docs/**` per STANDAR DOCS dan push ke branch `scaffold-docs`.
- WHILE setting `autoScaffold` bernilai true, THE SYSTEM SHALL memulai sesi scaffold otomatis segera
  setelah project `from-scratch` dibuat; IF false, THEN sesi hanya dimulai lewat tombol Scaffold docs.
- IF project `from-scratch` belum punya checkout lokal (`repoDir` kosong), THEN THE SYSTEM SHALL menolak
  membuka sesi scaffold (422 `needsBind`) alih-alih spawn tanpa worktree.

## Backlog
- WHEN brief/finding dibuat, THE SYSTEM SHALL memasukkannya sebagai spec pada tahap awal lifecycle.
- WHILE sebuah backlog item masih di stage awal (`brainstorming`) dan belum pernah dijalankan (belum ada worktree sesi), THE SYSTEM SHALL mengizinkan edit judul, prioritas, dan detail brief/QA-nya; objective diturunkan ulang dari detail. IF item sudah dimulai atau stage-nya maju, THEN THE SYSTEM SHALL menolak edit konten (SPEC-186).
- WHERE spec pada tahap tertentu, THE SYSTEM SHALL menawarkan aksi yang sesuai (kunci objective / tulis spec / plan / execute).
- WHERE spec sudah `done`, THE SYSTEM SHALL menawarkan aksi rebase/merge branch hasilnya ke target pilihan (branch lokal atau origin) dari backlog & terminal (SPEC-175).
- WHEN operator memicu rebase/merge, THE SYSTEM SHALL menjalankannya di worktree terisolasi tanpa menyentuh working tree utama, dan IF timbul konflik, THEN THE SYSTEM SHALL membuka sesi claude di worktree itu untuk menyelesaikannya.
- IF target merge lokal sedang di-checkout, THEN THE SYSTEM SHALL gagal aman (menolak, sarankan target origin) alih-alih memaksa update ref.
