# Product blueprint — hanoman

Bentuk produk: **instrument panel yang tenang**. Overview sebagai beranda; tiap area (Projects/PRD/Backlog/Terminal/Docs/VPS/Settings) satu klik dari sidebar. Terminal adalah pusat gravitasi saat sesuatu berjalan. PRD (SPEC-210) duduk di hulu Backlog: PM/PO menulis brief + brainstorm → dokumen PRD sebelum fitur dipecah ke spec + plan. Telegram (SPEC-476/ADR-0096) adalah kanal opsional ke session operator tmux yang sama — bukan permukaan runtime/agent kedua.

## Pilar
1. **Kepercayaan lewat docs** — SoT sebagai konvensi: ditampilkan & bisa diedit, tak lagi digerbang mesin (ADR-0023).
2. **Kendali manusia** — steer/interupsi kapan pun, bahkan full-auto.
3. **Isolasi** — tiap sesi di worktree sendiri, aman paralel.
