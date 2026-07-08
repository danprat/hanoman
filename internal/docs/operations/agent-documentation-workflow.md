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
