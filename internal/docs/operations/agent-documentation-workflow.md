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

Guardrail berjangkar ke **repo root**, bukan cwd. `collectViolations` memakai root hasil
`git rev-parse --show-toplevel` untuk seluruh akses filesystem, jadi `hanoman docs verify`
dan `hook stop` tetap benar walau dipanggil dari subdir. `hook stop` sendiri membaca
`CLAUDE_PROJECT_DIR` lebih dulu — `cwd` di payload ikut `cd` di sesi dan bisa keluar dari repo.

## Runner (SPEC-003)
Runner memakai `@anthropic-ai/claude-agent-sdk`; fase Execute lewat gate
`hanoman docs verify` (SPEC-002) — plan diblok bila docs stale. Setiap run di
`.worktrees/<run-id>`, di-steer/pause/stop lewat dashboard, lalu commit + push ke
`branchTo`. Lihat ADR-0002 (isolasi) dan ADR-0003 (model per step).

Bila proses `docs verify` **crash** (bukan lapor stale) — mis. path CLI salah karena cwd,
atau baca doc gagal — hasilnya di-retry sekali; kalau tetap crash, run gagal **fail-closed**
dengan `guardrail tool error · <stderr>` (bukan disamarkan "docs stale"). Path CLI di-resolve
dari root workspace (`pnpm-workspace.yaml`), bukan dari `process.cwd()`. Lihat SPEC-010 / ADR-0009.

## Worker credentials (SPEC-007)
Worker boot memverifikasi kredensial Claude (Agent SDK). Ada env credential
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
