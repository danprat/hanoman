# hanoman

**hanoman** — internal workflow orchestrator untuk **nafanesia.id**. Menggerakkan pengembangan **docs-driven**: Claude Code membangun SaaS/project (from-scratch atau existing) dengan dokumentasi sebagai **Source of Truth**, dan memberi tim satu **dashboard** untuk memantau Claude Code di semua project sekaligus.

## Prinsip inti
- **Docs adalah Source of Truth.** Tidak ada plan yang boleh execute melewati docs yang stale.
- **Fitur:** spec → plan → execute. **QA:** audit → spec → plan → execute.
- **Manusia pegang kendali penuh** — bahkan saat full-auto, run bisa di-steer / interupsi.

## Struktur repo
```
src/            aplikasi dashboard (React + TypeScript)
server/         orchestrator + runner + scheduler + webhooks
internal/docs/  SOURCE OF TRUTH — baca ini lebih dulu
.claude/        konfigurasi & hooks Claude Code
.codex/         konfigurasi Codex
```

## Mulai
```bash
pnpm install
pnpm dev        # dashboard + server (dev)
```

## Handoff ke Claude Code
1. Baca `internal/docs/README.md` (index Source of Truth).
2. Ikuti `AGENTS.md` + `CLAUDE.md`.
3. Ambil spec dari backlog → `hanoman plan` → `hanoman execute`.
