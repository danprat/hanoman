# Functional requirements — hanoman

Perilaku per fitur (gaya EARS; lihat `requirements/acceptance-criteria-ears-standard.md`).

## Sesi (eksekusi)
- WHEN sebuah backlog item dijalankan, THE SYSTEM SHALL membuka sesi `claude` interaktif di git worktree terisolasi (`.worktrees/<spec>`).
- WHILE sebuah sesi berjalan, THE SYSTEM SHALL tetap menerima steer/interupsi dari manusia lewat terminal.
- Docs acuan yang stale tidak lagi memblokir plan/execute (guardrail Source of Truth dicabut, SPEC-160/ADR-0023) — `internal/docs/**` tetap konvensi, coverage-nya tetap dilaporkan (`docs scan`).

## Backlog
- WHEN brief/finding dibuat, THE SYSTEM SHALL memasukkannya sebagai spec pada tahap awal lifecycle.
- WHILE sebuah backlog item masih di stage awal (`brainstorming`) dan belum pernah dijalankan (belum ada worktree sesi), THE SYSTEM SHALL mengizinkan edit judul, prioritas, dan detail brief/QA-nya; objective diturunkan ulang dari detail. IF item sudah dimulai atau stage-nya maju, THEN THE SYSTEM SHALL menolak edit konten (SPEC-186).
- WHERE spec pada tahap tertentu, THE SYSTEM SHALL menawarkan aksi yang sesuai (kunci objective / tulis spec / plan / execute).
- WHERE spec sudah `done`, THE SYSTEM SHALL menawarkan aksi rebase/merge branch hasilnya ke target pilihan (branch lokal atau origin) dari backlog & terminal (SPEC-175).
- WHEN operator memicu rebase/merge, THE SYSTEM SHALL menjalankannya di worktree terisolasi tanpa menyentuh working tree utama, dan IF timbul konflik, THEN THE SYSTEM SHALL membuka sesi claude di worktree itu untuk menyelesaikannya.
- IF target merge lokal sedang di-checkout, THEN THE SYSTEM SHALL gagal aman (menolak, sarankan target origin) alih-alih memaksa update ref.
