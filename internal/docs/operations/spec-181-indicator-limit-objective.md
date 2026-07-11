# SPEC-181 — objective (Indicator Limit)

**Status:** objective dikunci 2026-07-11 · prioritas tinggi
**Design/spec:** [`docs/superpowers/specs/2026-07-11-indicator-limit-spec-181-design.md`]

## Objective

Dashboard hanoman menampilkan **limit Claude realtime** — seluruh window limit langganan — agar
user bisa melihat dan memastikan backlog masih aman untuk terus di-running. Sampai kini tidak ada
indikator limit sama sekali; user baru sadar limit habis ketika sesi claude berhenti di tengah run.

## Konteks

hanoman tak lagi menjalankan claude headless (SPEC-162 / ADR-0024). Claude jalan interaktif di
tmux dan hanya byte terminal mentah yang direlay — tak ada usage/limit yang diparse atau disimpan.
Sumber limit yang realistis adalah endpoint OAuth yang sama yang dipakai `/usage` Claude Code
(`GET https://api.anthropic.com/api/oauth/usage`), diautentikasi token dari
`~/.claude/.credentials.json` di host yang sama dengan server.

## Outcome yang dikunci

- **Semua window limit** ditampilkan: sesi 5-jam, mingguan keseluruhan, mingguan Opus — tiap
  window dengan persentase terpakai + waktu reset.
- **Dua tempat render, satu data path:** badge ringkas selalu-tampil di top bar (klik → detail)
  **dan** kartu rinci di halaman Overview.
- **Realtime** via polling `GET /api/limits` tiap 60s (bukan channel push baru).
- **Jujur soal keterbatasan:** `ok` saat token fresh (umumnya saat backlog jalan), `stale` saat
  token expired (tampilkan nilai terakhir + umur), `unavailable` saat kredensial tak terbaca.
- Warna badge dari `severity` yang diberikan API (`normal`/`warning`/`critical`) window paling
  kritis — bukan ambang hardcode.

## Batasan

- Tanpa perubahan skema, tanpa migration, tanpa gate baru → tanpa ADR.
- Tanpa self-refresh token (refresh token rotating; refresh sendiri bisa me-logout sesi claude) —
  hanya membaca token hidup Claude Code (Keychain di macOS, berkas `.credentials.json` di Linux/prod).
- Tanpa `spend`/kredit-usage, tanpa persist histori/grafik tren — hanya limit saat ini.

## Endpoint

- `GET /api/limits` (auth-gated) → `{ windows: LimitWindow[], fetchedAt, status }`
  - `LimitWindow = { key, label, usedPct, resetsAt, severity, isActive }`
  - `severity = "normal" | "warning" | "critical"` · `status = "ok" | "stale" | "unavailable"`
