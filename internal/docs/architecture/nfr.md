# Non-functional requirements

- **Realtime log** — latensi log run ke UI < 1 dtk.
- **Interupsi** — pause/stop diterapkan ≤ 2 dtk.
- **Isolasi** — run tidak pernah mengganggu working tree utama atau run lain (worktree terpisah).
- **Durabilitas** — status run & docs bertahan restart (Postgres).
- **Konkurensi** — hormati `maxConcurrent`; kelebihan → queued.
- **Biaya** — hentikan enqueue baru bila `dailyBudget` tercapai.
