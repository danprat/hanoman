# Frontend implementation

- React + TypeScript (Vite). Komponen dari Hanoman Design System.
- Layout: sidebar 248px + topbar 56px; konten maks 1200px (Docs full-width).
- Bagian: Overview, Projects (list + pagination + cari), Backlog (filter project + tab + aksi per spec + detail spec via modal: judul, stage bar, objective, field brief/QA), Runs (list + detail: pipeline, worktree, kendali, terminal), Docs (tree + preview markdown/kode + edit), Triggers, Settings (model per step).
- Realtime: konsumsi SSE `/runs/:id/log` untuk log & status; optimistic UI untuk kontrol.
- Markdown render: pustaka marked; file non-.md dirender sebagai blok kode.
- State ringan lewat React; persist preferensi (edit docs, settings) ke server (dan localStorage sebagai draft).

## Live run view (SPEC-008)
`RunsScreen` berlangganan `GET /runs/:id/log` (SSE) untuk run running/paused via
`subscribeRun`; event live (`log`/`phase`/`status`/`cost`/`file`) digabung lewat reducer
murni `reduceRunEvent`. Panel kontrol menggerakkan `POST /runs/:id/command` (teks bebas →
steer) dan `/control` (pause/resume/stop). Durasi dihitung `(finishedAt ?? now) − createdAt`
(ADR-0007), tick tiap detik selama run berjalan.
