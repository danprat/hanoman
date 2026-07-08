# Agent documentation workflow

Kontrak operasional untuk hanoman + Claude Code.

- Docs di `internal/docs/**` adalah **Source of Truth**.
- Sebelum plan execute: **Update the index. Link every doc.**
- **Fitur:** spec → plan → execute. **QA:** audit → spec → plan → execute.
- **From-scratch:** brainstorm → kunci objective → `hanoman scaffold` seluruh doc index.
- **Existing:** `hanoman reverse --dir <path>` untuk menyusun docs dari codebase.
- Stop hook **memblokir** plan bila doc acuan stale.
- Setiap run di worktree terpisah; commit + push ke `branchTo`, perbarui docs yang tersentuh.

## Guardrail (SPEC-002)
Stop hook memanggil `hanoman hook stop` → `hanoman docs verify`. Blok bila: doc belum
ter-link di index, `src/` berubah tanpa perubahan doc, atau coverage di bawah ambang.
Konfigurasi per-repo di `hanoman.config.json`. Lihat ADR-0001.

## Runner (SPEC-003)
Runner memakai `@anthropic-ai/claude-agent-sdk`; fase Execute lewat gate
`hanoman docs verify` (SPEC-002) — plan diblok bila docs stale. Setiap run di
`.worktrees/<run-id>`, di-steer/pause/stop lewat dashboard, lalu commit + push ke
`branchTo`. Lihat ADR-0002 (isolasi) dan ADR-0003 (model per step).
