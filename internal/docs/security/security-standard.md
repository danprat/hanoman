# Security standard

- **Auth (SPEC-169, ADR-0028)**: login email/password menggerbangi seluruh `/api` (gate `onRequest`,
  401 tanpa sesi; termasuk upgrade WebSocket `/api/terminal`). Publik hanya `GET /health`,
  `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`.
  - Password: `crypto.scrypt` (stdlib) + salt acak + `timingSafeEqual`. Tak pernah dikembalikan ke client.
  - Sesi: token opaque 256-bit di cookie `httpOnly`; DB menyimpan `sha256(token)`, bukan token mentah.
    Revocable — logout/ganti-password/hapus-user mencabut sesi. Cookie `httpOnly` + `sameSite=strict`
    + `secure` (prod) + `maxAge` 7 hari.
  - Login di-throttle per IP (10 gagal → tunda 60 dtk); error selalu generic ("email atau password salah").
  - Tanpa RBAC (brief): semua user setara; `DELETE /auth/users/:id` menolak menghapus user terakhir.
  - Bootstrap: saat 0 user, `POST /auth/setup` membuat akun pertama, lalu tertutup (409).
- **TLS / deployment**: cookie `Secure` butuh HTTPS. Pola deploy: bind `127.0.0.1` di belakang reverse
  proxy yang menerminasi TLS. Contoh `Caddyfile` (auto Let's Encrypt):
  ```
  hanoman.example.com {
      reverse_proxy 127.0.0.1:8787
  }
  ```
  `HOST=0.0.0.0` hanya bila ada TLS di depannya. Lakukan `setup` segera pada deploy pertama (jendela
  0-user terbuka sampai akun pertama dibuat).
- **Kredensial Claude**: sesi memakai auth Claude Code (Keychain macOS / `~/.claude/.credentials.json` /
  env `CLAUDE_CODE_OAUTH_TOKEN`|`ANTHROPIC_API_KEY`); tak pernah ke client. Private key VPS ada sebagai
  file di server (`Vps.keyPath`), tak pernah di DB.
- **Guardrail perintah**: sesi jalan `--dangerously-skip-permissions`, jadi satu-satunya gerbang adalah
  PreToolUse hook (`runner/src/safety.ts` `deniesDangerous` via `hanoman hook pretooluse`) yang dipasang
  tiap sesi — deny `rm -rf`, deny push ke `main`, deny `git worktree add` liar.
- **Isolasi**: sesi di worktree terpisah; tak ada akses ke luar direktori project.
