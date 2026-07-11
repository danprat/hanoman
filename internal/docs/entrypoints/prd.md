# Product requirements — hanoman (ringkas)

Lihat `requirements/prd.md` untuk detail terukur. Ini gambaran produk.

## Persona
- **Operator/Founder (Rangga)** — memantau & mengarahkan semua project.
- **Kontributor** — menulis brief, memfilekan QA finding.

## Kapabilitas utama
1. **Overview** — ringkasan seluruh workspace (KPI, perlu-perhatian, sesi live, coverage, backlog, aktivitas, indikator limit).
2. **Projects** — daftar project (from-scratch / existing) dengan coverage docs, backlog, sesi aktif → detail project.
3. **Backlog** — spec dari brief/QA pada lifecycle brainstorm → objective → spec → plan → execute → done; review worktree & rebase/merge branch `done`.
4. **Terminal** — sesi Claude Code interaktif multi-pane di tmux: stage live, steer/interupsi, git worktree per backlog.
5. **Docs · SoT** — index internal/docs, preview markdown ter-render, edit/hapus file, reverse-docs dari codebase.
6. **VPS** — daftar & harden server, buka sesi `claude` berkonteks VPS.
7. **Settings** — model & effort sesi, notifikasi, akun & users.

## Di luar scope MVP
- Kolaborasi realtime multi-user, RBAC granular.
