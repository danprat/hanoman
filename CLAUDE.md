# CLAUDE.md

Instruksi khusus **Claude Code** untuk membangun hanoman. Melengkapi `AGENTS.md`.

## Baca Dulu

1. Baca `AGENTS.md`.
2. Baca skill project `internal/skills/hanoman/SKILL.md`.
3. Baca index Source of Truth `internal/docs/README.md`.
4. Baru baca doc SoT yang relevan dengan task setelahnya.

Jangan mulai implementasi dari ingatan atau konteks chat saja saat doc/skill project sudah ada.

## Konteks
hanoman adalah orchestrator + dashboard workflow docs-driven. Frontend React+TS (Vite). Server Node+TS (Fastify): pekerjaan berjalan sebagai **sesi `claude` interaktif** di tmux (`server/src/services/pty.ts`) di **git worktree terisolasi** per backlog, Postgres (Prisma) untuk state (tujuh model: Project/Spec/Setting/Notification/User/Session/Vps). **Tidak ada** message queue/Redis, worker terpisah, scheduler cron, maupun webhook GitHub — semuanya dicabut saat pindah ke sesi interaktif (ADR-0024). Realtime: **WebSocket untuk terminal PTY + HTTP polling** untuk sisanya. Detail di `internal/skills/hanoman/SKILL.md` dan `internal/docs/architecture/stack.md`.

## Kebiasaan
- TypeScript strict. Test untuk setiap logika orchestrasi (trigger, queue, worktree, guardrail).
- Jaga UI responsif: log sesi streaming, jangan blok main thread.
- Update `internal/docs` yang tersentuh **dalam commit yang sama** & tautkan di `internal/docs/README.md`.
- Ikuti design system di `internal/docs/design-system/**` (editorial, bone paper, brass accent).
- **Setiap selesai satu task execute:** centang checklist task/step yang selesai di file plan (`docs/superpowers/plans/**`, `- [ ]` → `- [x]`), lalu **test API-nya secara nyata di local** — boot server (`pnpm dev` atau `node server/dist/server.js`) dan curl endpoint yang tersentuh, jangan hanya andalkan unit test. Kalau masih ada issue, fixing dulu sampai hijau sebelum lanjut ke task berikutnya.

## Jangan
- Guardrail Source of Truth telah dicabut (SPEC-160, ADR-0023): `internal/docs/**` tetap Source of Truth secara konvensi — perbarui docs yang tersentuh dalam commit yang sama — tetapi tak ada lagi gate/Stop hook yang memblokir. Jangan menambahkannya kembali tanpa ADR baru. (Guardrail deny perintah berbahaya di `runner/src/safety.ts` juga telah dicabut — SPEC-197, ADR-0037; agen dipercaya penuh, isolasi murni lewat worktree. Jangan hidupkan kembali tanpa ADR baru.)
- Jangan ubah skema tanpa migration + ADR.
- Jangan jalankan run di working tree utama — selalu worktree terpisah.
