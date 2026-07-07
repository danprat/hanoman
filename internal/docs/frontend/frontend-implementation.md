# Frontend implementation

- React + TypeScript (Vite). Komponen dari Hanoman Design System.
- Layout: sidebar 248px + topbar 56px; konten maks 1200px (Docs full-width).
- Bagian: Overview, Projects (list + pagination + cari), Backlog (filter project + tab + aksi per spec), Runs (list + detail: pipeline, worktree, kendali, terminal), Docs (tree + preview markdown/kode + edit), Triggers, Settings (model per step).
- Realtime: konsumsi SSE `/runs/:id/log` untuk log & status; optimistic UI untuk kontrol.
- Markdown render: pustaka marked; file non-.md dirender sebagai blok kode.
- State ringan lewat React; persist preferensi (edit docs, settings) ke server (dan localStorage sebagai draft).
