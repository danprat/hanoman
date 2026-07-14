# Product requirements — hanoman (ringkas)

Lihat `requirements/prd.md` untuk detail terukur. Ini gambaran produk.

## Persona
- **Operator/Founder (Rangga)** — memantau & mengarahkan semua project.
- **PM/PO** — menulis brief, ber-brainstorm untuk menghasilkan PRD, memfilekan QA finding.
- **Kontributor** — menulis brief, memfilekan QA finding.

## Kapabilitas utama
1. **Overview** — ringkasan seluruh workspace (KPI, perlu-perhatian, sesi live, coverage, backlog, aktivitas, indikator limit).
2. **Projects** — daftar project (from-scratch / existing) dengan coverage docs, backlog, sesi aktif → detail project.
3. **PRD** — PM/PO menulis brief + brainstorm interaktif → dokumen PRD (`docs/prd/`), preview untuk review, take ke backlog (SPEC-210, ADR-0041).
4. **Backlog** — spec dari brief/QA pada lifecycle brainstorm → objective → spec → plan → execute → done; review worktree & rebase/merge branch `done`.
5. **Terminal** — sesi Claude Code interaktif multi-pane di tmux: stage live, steer/interupsi, git worktree per backlog.
6. **Docs · SoT** — index internal/docs, preview markdown ter-render, edit/hapus file, reverse-docs dari codebase.
7. **VPS** — daftar & harden server, buka sesi `claude` berkonteks VPS.
8. **Settings** — model & effort sesi, notifikasi, akun & users.

## Di luar scope MVP
- Kolaborasi realtime multi-user, RBAC granular.
