# Product requirements — hanoman (ringkas)

Lihat `requirements/prd.md` untuk detail terukur. Ini gambaran produk.

## Persona
- **Operator/Founder (Rangga)** — memantau & mengarahkan semua project.
- **Kontributor** — menulis brief, memfilekan QA finding.

## Kapabilitas utama
1. **Overview** — ringkasan seluruh workspace (KPI, attention, live run, coverage, backlog, triggers, activity).
2. **Projects** — daftar project (from-scratch / existing) dengan status run, coverage docs, backlog, triggers.
3. **Backlog** — spec dari brief/QA pada lifecycle brainstorm → objective → spec → plan → execute → done.
4. **Runs** — monitor live Claude Code: pipeline fase, diff, token/biaya, terminal interaktif, steer/interupsi, git worktree.
5. **Docs · SoT** — index internal/docs, preview markdown ter-render, edit file.
6. **Triggers** — otomasi: commit / schedule / manual / interval.
7. **Settings** — model per step, konkuren & anggaran.

## Di luar scope MVP
- Kolaborasi realtime multi-user, RBAC granular.
