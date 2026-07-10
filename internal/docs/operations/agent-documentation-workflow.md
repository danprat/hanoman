# Agent documentation workflow

Kontrak operasional untuk hanoman + Claude Code.

- Docs di `internal/docs/**` adalah **Source of Truth**.
- Sebelum plan execute: **Update the index. Link every doc.**
- **Fitur:** spec → plan → execute. **QA:** audit → **keputusan** → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped` (SPEC-145, ADR-0020).
- Prompt run memetakan fase → skill superpowers (SPEC-166): Brainstorm→brainstorming,
  Audit→systematic-debugging, Plan→writing-plans, Execute→executing-plans + TDD +
  verification-before-completion. Objective/Spec adalah keluaran brainstorming.
- **From-scratch:** brainstorm → kunci objective → `hanoman scaffold` seluruh doc index.
- **Existing:** `hanoman reverse --dir <path>` untuk menyusun docs dari codebase.
- Guardrail Source of Truth dicabut (SPEC-160, ADR-0023) — lihat bagian di bawah.
- Setiap run di worktree terpisah; commit + push ke `branchTo`, perbarui docs yang tersentuh.

## Guardrail (SPEC-002, dicabut SPEC-160/ADR-0023)
`internal/docs/**` tetap Source of Truth secara **konvensi**: diperbarui dalam commit yang sama,
ter-link di index. Tapi tak ada lagi yang **menegakkannya** secara mekanis — Stop hook (`hanoman
hook stop`), gate Execute (`hanoman docs verify`), dan switch dashboard "Source of Truth" semuanya
dicabut. `hanoman docs scan` tetap ada sebagai laporan coverage read-only (tak memblokir apa pun).

## Runner (SPEC-003)
Runner men-spawn binary `claude` langsung — Agent SDK sudah dicabut (ADR-0010). Satu backlog
dijalankan **satu proses** di `.worktrees/<run-id>`, dengan fase sebagai giliran di dalam sesi itu
(ADR-0015). Fase Execute tidak lagi lewat gate docs — dicabut SPEC-160/ADR-0023.
Run di-steer/pause/stop lewat dashboard, lalu commit + push ke `branchTo`. Pesan steer menjadi
giliran tambahan yang dikuras di antara fase. Lihat ADR-0002 (isolasi) dan ADR-0003 (model per step).

## Worker credentials (SPEC-007)
Worker boot memverifikasi kredensial Claude yang dipakai binary `claude`. Ada env credential
(`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / flag cloud) →
boot + log nama var-nya (bukan nilainya). Tanpa env credential: headless (non-TTY) →
tolak boot (exit 1); interaktif (TTY) → warning lalu boot (andalkan keychain). Bypass
darurat: `HANOMAN_SKIP_CRED_CHECK=1`. Lihat `.env.example`.

## GitHub App + webhooks (SPEC-006)
Trigger `commit` lewat GitHub App: push terverifikasi (HMAC atas raw body, `401`
bila gagal) → `fireTrigger` → run. Repo privat di-clone on demand dan di-push ke
`branchTo` pakai installation token (di-mint on demand, tak pernah disimpan). Run
start/done/fail dilaporkan balik sebagai commit status (`pending`/`success`/`failure`);
run tanpa `commitSha` tak melaporkan apa pun. Lihat ADR-0006.
