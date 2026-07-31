# Moat

Untuk alat internal, "moat" bukan soal menghalangi pesaing — melainkan soal **apa yang mahal dibangun
ulang** dan karena itu layak dijaga.

## Yang bertahan: kombinasinya, bukan satu fiturnya

1. **Docs sebagai kontrak yang terukur.** Coverage diturunkan langsung dari filesystem tiap request
   ([ADR-0011](../adr/0011-docs-realtime-filesystem.md)/[0018](../adr/0018-coverage-nilai-turunan.md)),
   bukan disalin ke tabel — jadi ia tak pernah bisa berbohong tentang keadaan repo. Index berperan
   sebagai registry: doc yang tak ter-link terhitung tak ter-cover.
2. **Isolasi yang menjadi model keamanan.** Sesi berjalan `--dangerously-skip-permissions`; satu-satunya
   batas adalah worktree ([ADR-0037](../adr/0037-cabut-guardrail-safety.md) di atas
   [ADR-0002](../adr/0002-git-worktree-isolation.md)). Sederhana, dan karena sederhana ia dipercaya.
3. **Sesi yang bertahan.** tmux memegang pekerjaan berjalan, bukan baris di database
   ([ADR-0016](../adr/0016-sesi-terminal-hidup-di-tmux.md)) — restart API tak membunuh pekerjaan, dan
   tak ada state ganda yang bisa berselisih.
4. **Fase sebagai giliran, bukan proses.** Satu backlog = satu sesi
   ([ADR-0015](../adr/0015-one-session-per-backlog.md)); fase dilaporkan lewat phase-file append-only.
   Konteks terbawa antar fase karena memang tak pernah berpindah proses.
5. **Jalur masuk yang lengkap.** Help Center menyuapi backlog; audit bisa naik jadi
   QA, brief, atau PRD ([ADR-0076](../adr/0076-eskalasi-audit-dinamis-manifest-rekomendasi.md)). Bagian
   yang paling melelahkan — memindahkan keluhan jadi pekerjaan — sudah otomatis.
6. **Sinkronisasi hub ↔ client yang menyembuhkan diri.** LWW + change-feed + rekonsiliasi manual
   ([ADR-0067](../adr/0067-sync-lww-reconciliation-manual.md),
   [ADR-0082](../adr/0082-kontrak-apply-changefeed-record-tertunda.md)) — mahal dibangun benar, dan
   pelajarannya tertulis.

## Yang bukan moat

Jujur soal ini menjaga doc ini berguna:

- **UI.** Design system-nya khas, tapi bisa ditiru dalam sepekan.
- **Wrapper CLI.** Merakit argv untuk `claude`/`codex` itu pekerjaan sehari.
- **Dashboard terminal.** xterm.js + tmux adalah resep umum.
- **Menjadi yang pertama.** Ruang ini bergerak cepat; keunggulan waktu tidak bertahan.

Yang mahal justru **akumulasi keputusan yang saling mengunci** — 83 ADR yang menjelaskan *kenapa*
bentuknya begini, termasuk yang dicabut. Itu pengetahuan yang tak ikut tersalin saat orang menyalin
fiturnya.

## Konsekuensi praktis

Moat ini terkikis bila docs berhenti diperbarui bersama kodenya, atau bila keputusan berhenti ditulis
sebagai ADR. Karena itu keduanya konvensi wajib, bukan anjuran — lihat
[agent-documentation-workflow](../operations/agent-documentation-workflow.md).
