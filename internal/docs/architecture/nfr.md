# Non-functional requirements

- **Realtime terminal** — latensi frame terminal ke UI < 1 dtk (WebSocket PTY).
- **Interupsi** — instruksi ke sesi (steer / ctrl-c / tutup) diterapkan ≤ 2 dtk lewat tmux.
- **Isolasi** — sebuah sesi tak pernah mengganggu working tree utama atau sesi lain; tiap backlog di
  worktree terpisah (ADR-0002).
- **Durabilitas** — state (project/spec/setting/notification/user/session/vps) bertahan restart via
  Postgres; sesi terminal yang berjalan bertahan restart API karena hidup di tmux (ADR-0016); docs
  dibaca live dari disk, tak ada salinan yang bisa basi.
- **Sumber daya** — beberapa sesi berjalan bersamaan di satu mesin operator, jadi sesi memverifikasi
  **ber-scope** secara default (`Setting.verifyScope = "changed"`, SPEC-376/ADR-0080): test hanya untuk
  berkas yang berubah, typecheck per paket, lint per berkas, build penuh & boot-server hanya bila
  relevan. Tanpa itu, N sesi melipatgandakan suite penuh (di repo ini: 258 berkas test + 6 proses
  `tsc` per sesi). Suite penuh adalah langkah **manusia** sebelum merge, bukan langkah sesi.
- **Keamanan** — server bind `127.0.0.1` di belakang reverse proxy TLS. Guardrail deny PreToolUse
  sudah **dicabut sepenuhnya** (SPEC-197/ADR-0037): sesi jalan `--dangerously-skip-permissions`
  tanpa hook deny apa pun, dan **isolasi worktree adalah satu-satunya batas keamanan yang tersisa**.
