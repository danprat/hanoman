# Non-functional requirements

- **Realtime terminal** — latensi frame terminal ke UI < 1 dtk (WebSocket PTY).
- **Interupsi** — instruksi ke sesi (steer / ctrl-c / tutup) diterapkan ≤ 2 dtk lewat tmux.
- **Isolasi** — sebuah sesi tak pernah mengganggu working tree utama atau sesi lain; tiap backlog di
  worktree terpisah (ADR-0002).
- **Durabilitas** — state (project/spec/setting/notification/user/session/vps) bertahan restart via
  Postgres; sesi terminal yang berjalan bertahan restart API karena hidup di tmux (ADR-0016); docs
  dibaca live dari disk, tak ada salinan yang bisa basi.
- **Keamanan** — server bind `127.0.0.1` di belakang reverse proxy TLS; guardrail PreToolUse
  (`deniesDangerous`) dipasang di setiap sesi meski `--dangerously-skip-permissions` aktif.
