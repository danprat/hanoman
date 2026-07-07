# Tech stack

| Lapis | Pilihan | Alasan |
|---|---|---|
| Dashboard | React + TypeScript + Vite | UI cepat, tim familiar |
| State UI | React state + SSE/WebSocket client | log run realtime |
| Server | Node.js + TypeScript (Fastify) | satu bahasa lintas stack |
| Queue | BullMQ + Redis | jadwal & konkurensi run |
| DB | PostgreSQL (Prisma) | state project/spec/run/trigger/docs |
| Scheduler | cron (node-cron / BullMQ repeatable) | trigger schedule/interval |
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
Untuk tiap run: buat worktree `git worktree add .worktrees/<run> <branchFrom>`, jalankan Claude Code headless dengan model per-step dari Settings, stream log via SSE, jalankan Stop hook (`hanoman docs verify`), commit & push ke `branchTo`, lalu `git worktree remove`.
