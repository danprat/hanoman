# Product requirements — hanoman (ringkas)

Lihat `requirements/prd.md` untuk detail terukur. Ini gambaran produk.

## Persona
- **Operator/Founder (Rangga)** — memantau & mengarahkan semua project.
- **PM/PO** — menulis brief, ber-brainstorm untuk menghasilkan PRD, memfilekan QA finding.
- **Kontributor** — menulis brief, memfilekan QA finding.

## Kapabilitas utama
1. **Overview** — ringkasan seluruh workspace (KPI, perlu-perhatian, sesi live, coverage, backlog, aktivitas, indikator limit).
2. **Projects** — daftar project (from-scratch / existing) dengan coverage docs, backlog, sesi aktif → detail project.
3. **PRD** — PM/PO menulis brief + brainstorm interaktif → dokumen PRD (`docs/prd/`), preview untuk review, take ke backlog (SPEC-210, ADR-0041). PRD kompleks: **Breakdown ke backlog** memulai sesi `breakdown` yang menulis manifest usulan backlog paralel-independen (`docs/prd/<slug>.breakdown.md`); manusia me-review lalu materialize jadi N spec yang jalan bersamaan (SPEC-273, ADR-0069).
4. **Backlog** — spec dari brief/QA pada lifecycle brainstorm → objective → spec → plan → execute → done; review worktree & rebase/merge branch `done`.
5. **Terminal** — sesi Claude Code interaktif multi-pane di tmux: stage live, steer/interupsi, git worktree per backlog.
6. **Docs · SoT** — index internal/docs, preview markdown ter-render, edit/hapus file, reverse-docs dari codebase.
7. **VPS** — daftar & harden server, buka sesi `claude` berkonteks VPS.
8. **Settings** — model & effort sesi, notifikasi, akun & users, onboarding/status Telegram.
9. **Telegram** — satu private chat allowlisted menuju satu session operator tmux persisten; natural
   text/command mengendalikan capability Hanoman lewat API ber-AgentToken, dengan memory/personality,
   audit, confirmation inline, dan reply tanpa raw PTY (SPEC-476/ADR-0096).

## Di luar scope MVP
- Kolaborasi realtime multi-user, RBAC granular.
