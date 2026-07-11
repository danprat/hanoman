<div align="center">

<img src="src/public/favicon.svg" width="76" alt="logo hanoman" />

# hanoman

**Satu dashboard untuk menjalankan & memantau Claude Code di banyak project sekaligus — dengan dokumentasi sebagai Source of Truth.**

</div>

<div align="center">
  <img src="docs/assets/screenshots/overview.png" width="900" alt="Dashboard hanoman — Overview" />
</div>

## Apa itu hanoman?

hanoman adalah **orchestrator + dashboard** untuk pengembangan yang digerakkan dokumentasi.
Kamu menuang ide (brief) atau memfilekan bug (QA finding); hanoman menjalankannya sebagai
**sesi [Claude Code](https://claude.com/claude-code) interaktif** yang mengerjakan tiap fase —
brainstorm → objective → spec → plan → execute — di dalam **git worktree terisolasi**, satu
per backlog item. Kamu memantau semua sesi secara realtime dari satu tempat, dan bisa
menyetir atau menginterupsi kapan pun. Dokumentasi project (`internal/docs/**`) adalah
**Source of Truth**: sumber kebenaran yang menjaga tiap langkah tetap jujur.

## Cara kerjanya

```mermaid
flowchart TD
    A["👤 Manusia<br/>ide · brief · QA finding"] --> B["hanoman<br/>dashboard + orchestrator"]
    B --> C["Backlog<br/>spec di antrean"]
    C --> D["Sesi Claude Code interaktif<br/>brainstorm → objective → spec → plan → execute"]
    D -->|"git worktree terisolasi · 1 backlog = 1 sesi"| E["Repo project"]
    D <-->|"baca & jaga sinkron"| F[("docs = Source of Truth")]
    D -. "stream via tmux + xterm.js" .-> B
    B -. "pantau · steer · interupsi" .-> D
```

Kerja **fitur** lewat alur `brainstorm → objective → spec → plan → execute`.
Kerja **QA** lewat alur `audit → spec → plan → execute` (akar masalah dulu, baru perbaikan).
"Fase" bukan proses terpisah — ia **giliran** di dalam satu sesi Claude, jadi konteks terbawa
utuh dari awal sampai selesai.

## Sekilas layar

| Backlog — spec dari brief/QA, progres tiap tahap | Terminal — sesi Claude Code interaktif |
|---|---|
| ![Backlog](docs/assets/screenshots/backlog.png) | ![Terminal](docs/assets/screenshots/terminal.png) |

**Source of Truth** — docs project di-index & dipantau drift-nya:

![Docs Source of Truth](docs/assets/screenshots/docs-sot.png)

## Konsep inti

- **Docs adalah Source of Truth.** `internal/docs/**` diperbarui pada commit yang menyentuhnya —
  kebenaran secara konvensi, dijaga oleh alur kerja, bukan gerbang mekanis.
- **Manusia pegang kendali penuh.** Bahkan saat berjalan otomatis, tiap sesi bisa di-steer,
  dijawab, atau diinterupsi langsung dari Terminal. hanoman berhenti dan bertanya hanya saat
  butuh keputusan manusia yang nyata.
- **Isolasi via git worktree.** Tiap backlog dikerjakan di worktree-nya sendiri
  (`<repo>/.worktrees/<id>`), tak pernah di working tree utama. **Satu backlog = satu sesi.**
- **From-scratch atau existing.** Project baru di-scaffold dari nol; codebase yang sudah ada
  di-*reverse-engineer* docs-nya lebih dulu.

## Mulai

**Prasyarat:** [Docker](https://www.docker.com/) (untuk Postgres) · Node.js ≥ 20 ·
[pnpm](https://pnpm.io/) · [tmux](https://github.com/tmux/tmux) ·
[Claude Code CLI](https://claude.com/claude-code) yang sudah login.

```bash
pnpm install
pnpm dev        # docker compose up (Postgres) → API (:8787) + dashboard (:5173)
```

Lalu buka **http://localhost:5173**, buat akun pada layar setup pertama, dan tambahkan project.

> `pnpm dev` menjalankan `docker compose up -d --wait` dulu, jadi Docker harus hidup.
> Sesi Claude berjalan di dalam **tmux** agar selamat dari restart API
> ([ADR-0016](internal/docs/adr/0016-sesi-terminal-hidup-di-tmux.md)) — pasang dengan `brew install tmux`.
> Sesi memakai kredensial `claude` yang sudah login di terminalmu.

## Struktur repo

```
src/            dashboard (React + TypeScript + Vite, xterm.js)
server/         orchestrator: Fastify · Prisma/Postgres · node-pty + tmux
runner/         library git-worktree + pembangun prompt + guardrail (bukan proses)
cli/            perintah docs (scan/index/link) + hook PreToolUse
shared/         tipe & DTO dipakai bersama server ↔ web
internal/docs/  SOURCE OF TRUTH — baca ini lebih dulu
docs/           spec & plan kerja (superpowers) + aset README
.claude/        konfigurasi & hooks Claude Code
```

Stack: React + Vite · **Fastify** · PostgreSQL (**Prisma**) · **node-pty + tmux** · xterm.js.
Eksekusi adalah sesi `claude` interaktif per backlog di git worktree — tanpa message queue,
worker, cron, maupun webhook (semuanya dicabut di
[ADR-0024](internal/docs/adr/0024-sesi-interaktif-menggantikan-run.md)).

## Handoff ke Claude Code

1. Baca `internal/docs/README.md` — index Source of Truth.
2. Ikuti `AGENTS.md` + `CLAUDE.md`.
3. Ambil spec dari **Backlog** di dashboard → **Buka sesi** → pantau di **Terminal**.

---

<div align="center"><sub>Chiranjivi — docs (Source of Truth) abadi melampaui commit.</sub></div>
