# CLAUDE.md

Instruksi khusus **Claude Code** untuk membangun hanoman. Melengkapi `AGENTS.md`.

## Konteks
hanoman adalah orchestrator + dashboard. Frontend React+TS (Vite). Server Node+TS: runner yang men-spawn Claude Code headless per run di git worktree, queue (BullMQ/Redis), Postgres untuk state, scheduler cron, GitHub webhooks. Realtime via WebSocket/SSE.

## Kebiasaan
- TypeScript strict. Test untuk setiap logika orchestrasi (trigger, queue, worktree, guardrail).
- Jaga UI responsif: log run streaming, jangan blok main thread.
- Update `internal/docs` yang tersentuh **dalam commit yang sama**.
- Ikuti design system di `internal/docs/design-system/**` (editorial, bone paper, brass accent).
- **Setiap selesai satu task execute:** centang checklist task/step yang selesai di file plan (`docs/superpowers/plans/**`, `- [ ]` → `- [x]`), lalu **test API-nya secara nyata di local** — boot server (`pnpm dev` atau `node server/dist/server.js`) dan curl endpoint yang tersentuh, jangan hanya andalkan unit test. Kalau masih ada issue, fixing dulu sampai hijau sebelum lanjut ke task berikutnya.

## Jangan
- Jangan bypass Stop hook / guardrail Source of Truth.
- Jangan ubah skema tanpa migration + ADR.
- Jangan jalankan run di working tree utama — selalu worktree terpisah.
