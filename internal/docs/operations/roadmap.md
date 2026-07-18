# Roadmap

## Sekarang (shipped)
- **Auth** multi-user — sesi opaque revocable, invite, bind `127.0.0.1` + reverse proxy TLS (ADR-0028).
- **Projects** from-scratch / existing + detail (identitas, coverage, pintu ke docs/terminal/backlog).
- **Backlog** lifecycle brainstorm → objective → spec → plan → execute → done; grid/list/board; review
  worktree ala VSCode; rebase/merge branch `done` ke target lokal/origin (SPEC-175/ADR-0031).
- **Terminal** sesi `claude` interaktif multi-pane di tmux — hidup lintas restart API (ADR-0016),
  ambil backlog, reopen sesi `done`.
- **Docs · SoT** render+edit+hapus markdown, coverage live per project, reverse-docs dari codebase,
  scaffold-docs dari ide untuk project from-scratch (git-init + sesi scaffold, SPEC-222/ADR-0052).
- **VPS** registrasi + audit/harden + sesi berkonteks VPS (SPEC-164/ADR-0025).
- **Notifikasi** backlog selesai (toast/lonceng/sound) + **indikator limit** model dari OAuth usage API.

## Berikutnya (belum terjadwal)
Item terbuka dikelola sebagai backlog di dashboard, bukan di sini. Arah lama "runner headless + webhook
GitHub + scheduler" **dibatalkan** saat pindah ke sesi interaktif (ADR-0024) — jangan dihidupkan tanpa ADR baru.
