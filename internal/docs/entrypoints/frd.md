# Functional requirements — hanoman

Perilaku per fitur (gaya EARS; lihat `requirements/acceptance-criteria-ears-standard.md`).

## Runs
- WHEN sebuah spec di-execute, THE SYSTEM SHALL membuat git worktree terisolasi untuk run itu.
- WHILE run berjalan (full-auto), THE SYSTEM SHALL tetap menerima steer/pause/stop dari manusia.
- Docs acuan yang stale tidak lagi memblokir plan/execute (guardrail Source of Truth dicabut, SPEC-160/ADR-0023) — `internal/docs/**` tetap konvensi, coverage-nya tetap dilaporkan (`docs scan`).

## Backlog
- WHEN brief/finding dibuat, THE SYSTEM SHALL memasukkannya sebagai spec pada tahap awal lifecycle.
- WHERE spec pada tahap tertentu, THE SYSTEM SHALL menawarkan aksi yang sesuai (kunci objective / tulis spec / plan / execute).
- WHERE spec sudah `done`, THE SYSTEM SHALL menawarkan aksi rebase/merge branch hasilnya ke target pilihan (branch lokal atau origin) dari backlog & terminal (SPEC-175).
- WHEN operator memicu rebase/merge, THE SYSTEM SHALL menjalankannya di worktree terisolasi tanpa menyentuh working tree utama, dan IF timbul konflik, THEN THE SYSTEM SHALL membuka sesi claude di worktree itu untuk menyelesaikannya.
- IF target merge lokal sedang di-checkout, THEN THE SYSTEM SHALL gagal aman (menolak, sarankan target origin) alih-alih memaksa update ref.

## Triggers
- WHEN trigger commit cocok dengan push ke branch dipantau, THE SYSTEM SHALL menjalankan target (plan+execute / audit).
- WHILE trigger nonaktif, THE SYSTEM SHALL tidak menjadwalkan run darinya.
