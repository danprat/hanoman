# Tech stack

| Lapis | Pilihan | Alasan |
|---|---|---|
| Dashboard | React + TypeScript + Vite | UI cepat, tim familiar |
| State UI | React state + SSE/WebSocket client | log run realtime |
| Server | Node.js + TypeScript (Fastify) | satu bahasa lintas stack |
| Queue | BullMQ + Redis | jadwal & konkurensi run |
| DB | PostgreSQL (Prisma) | state project/spec/run/trigger/docs |
| Scheduler | cron (node-cron / BullMQ repeatable) | trigger schedule/interval |
| Terminal (server) | node-pty | sesi `claude` interaktif butuh TTY sungguhan |
| Terminal (web) | xterm.js | render TUI Claude Code apa adanya |
| VCS | git + **git worktree** | isolasi run per branch |
| Agent | Claude Code headless (CLI) + hooks | eksekusi spec → plan → execute |
| Webhooks | GitHub App | trigger commit |

## Bentuk sistem
```
Dashboard (React) ──SSE/WS──► Server (Fastify)
                                  ├─ Orchestrator (state machine spec/run)
                                  ├─ Queue (BullMQ/Redis) ─► Runner
                                  │                            └─ git worktree + Claude Code headless
                                  ├─ Scheduler (cron)  ─► enqueue run
                                  ├─ Webhook receiver (GitHub) ─► enqueue run
                                  └─ Postgres (Prisma)
```

## Runner
Untuk tiap run: buat worktree `git worktree add .worktrees/<run> <branchFrom>`, jalankan Claude Code headless dengan model per-step dari Settings, stream log via SSE, commit & push ke `branchTo`, lalu `git worktree remove`. (Stop hook Source of Truth dicabut, SPEC-160/ADR-0023.)

**Satu backlog = satu proses `claude`** di worktree-nya sendiri (ADR-0015). Fase bukan proses
melainkan **giliran** di dalam sesi itu: `runner/src/turns.ts` memasangkan N pesan pengguna dengan
N `result` menurut urutan, dan `/model` + `/effort` menggeser sesi saat step berubah — jadi model
per-step (ADR-0003) tetap berlaku tanpa spawn per fase. Konteks karena itu terbawa antar fase.
`Run.sessionId` menyimpan sesinya, sehingga layar Terminal dapat membukanya kembali dengan
`claude --resume` di dalam worktree run — sesi run itu sendiri, bukan tiruannya.

Runner **spawn binary `claude` langsung** (`runner/src/claude-cli.ts`), bukan Agent SDK — lihat
ADR-0010. Transport `--input-format/--output-format stream-json`; `--setting-sources
user,project,local` supaya run memuat CLAUDE.md, hook, plugin, dan skill yang sama dengan sesi
terminal harian. Effort per step diteruskan lewat `--effort`. Run memakai
`--dangerously-skip-permissions` (tak berpenunggu, tak ada penjawab prompt), sehingga guardrail
perintah berbahaya bersandar sepenuhnya pada **PreToolUse hook** (`hanoman hook pretooluse`,
memanggil `deniesDangerous`) yang didaftarkan lewat `--settings` inline dan merge dengan setting
user; `--disallowed-tools` jadi lapis kedua. Hook tetap jalan di bawah flag itu — yang dilewati
prompt izin, bukan sistem hook. Binary dicari di `PATH`, override `HANOMAN_CLAUDE_BIN`.

Biaya bersifat **estimasi dan tidak menggerakkan apa pun** (ADR-0012): auth run adalah OAuth
subscription (`CLAUDE_CODE_OAUTH_TOKEN`), sehingga `total_cost_usd` adalah jumlah yang akan
dibayar pengguna API key, bukan tagihan. Tidak ada `dailyBudget` dan tidak ada `--max-budget-usd`.
Format/parse dipusatkan di `fmtEstCost`/`parseEstCost` (`@hanoman/shared`). Kendali run yang
tersisa: `maxConcurrent`, pause/stop dari UI, dan guardrail tool di atas.
Setiap `result.subtype` berawalan `error` menggagalkan run — begitu pula `result.is_error`, yang
menandai kegagalan API di tengah giliran (502, 401) yang justru datang bersubtype `success`.
