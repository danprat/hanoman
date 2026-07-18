# Agent documentation workflow

Kontrak operasional untuk hanoman + Claude Code.

- Docs di `internal/docs/**` adalah **Source of Truth**.
- Sebelum plan execute: **Update the index. Link every doc.**
- **Fitur:** spec → plan → execute. **QA:** audit → **keputusan** → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped`; keputusan dielicit lewat prompt & diambil agen (SPEC-145/ADR-0020, mekanisme SPEC-204/ADR-0040).
- Prompt sesi memetakan fase → skill superpowers (SPEC-166): Brainstorm→brainstorming,
  Audit→systematic-debugging, Plan→writing-plans, Execute→executing-plans + TDD +
  verification-before-completion. Objective/Spec adalah keluaran brainstorming.
- **From-scratch:** pilih folder → hanoman `git init` repo → sesi **scaffold** interaktif: brainstorm
  (satu pertanyaan/giliran) → kunci objective → menyusun seluruh doc index dari ide, pakai STANDAR DOCS
  yang sama dengan reverse (SPEC-222, ADR-0052). Tombol "Scaffold docs" di layar project + `autoScaffold`
  (auto-start setelah buat project); hasil di branch `scaffold-docs`, manusia merge.
- **Existing:** tombol **Reverse docs** di layar project — sesi interaktif menyusun docs dari codebase (SPEC-166, ADR-0026): Scan → Docs teknis → Wawancara → Konvensi & index → Serah terima, hasil di branch `reverse-docs`.
- Guardrail Source of Truth dicabut (SPEC-160, ADR-0023) — lihat bagian di bawah.
- Setiap sesi di worktree terpisah; commit di worktree, lalu integrasi (rebase/merge) ke target dipicu manual dari dashboard (SPEC-175/ADR-0031); perbarui docs yang tersentuh dalam commit yang sama.

## Guardrail (SPEC-002, dicabut SPEC-160/ADR-0023)
`internal/docs/**` tetap Source of Truth secara **konvensi**: diperbarui dalam commit yang sama,
ter-link di index. Tapi tak ada lagi yang **menegakkannya** secara mekanis — Stop hook (`hanoman
hook stop`), gate Execute (`hanoman docs verify`), dan switch dashboard "Source of Truth" semuanya
dicabut. `hanoman docs scan` tetap ada sebagai laporan coverage read-only (tak memblokir apa pun).

## Eksekusi (sesi interaktif)
Eksekusi adalah **sesi `claude` interaktif di tmux** (`server/src/services/pty.ts`), bukan runner
headless — Agent SDK dicabut (ADR-0010), spawn headless per-run dicabut (ADR-0024). Satu backlog =
**satu sesi** di `<repoDir>/.worktrees/<spec-id>` (ADR-0015), dengan fase sebagai giliran di dalam sesi
itu (`echo "<Fase> done" >> $HANOMAN_PHASE_FILE`). Fase Execute tidak lagi lewat gate docs — dicabut
SPEC-160/ADR-0023. Sesi di-steer/interupsi lewat terminal dashboard; commit terjadi di worktree, dan
integrasi ke branch lain dipicu manual (SPEC-175). Lihat ADR-0002 (isolasi) dan ADR-0016 (sesi tmux).

## Kredensial Claude
Sesi memakai auth Claude Code yang sama dengan sesi harian: `claude` membaca token dari Keychain macOS
atau `~/.claude/.credentials.json`, dengan alternatif env `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`
(lihat `.env.example`). Tak ada lagi verifikasi kredensial saat boot worker — tak ada worker. Indikator
limit membaca token OAuth yang sama untuk memanggil usage API (`services/limits.ts`, ADR-0024).
