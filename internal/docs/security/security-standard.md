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
- **Guardrail perintah**: DICABUT sepenuhnya (SPEC-197, [ADR-0037](../adr/0037-cabut-guardrail-safety.md)).
  Sesi jalan `--dangerously-skip-permissions` tanpa hook deny apa pun — agen dipercaya penuh, setara
  developer yang menjalankan `claude` di mesinnya sendiri. Batas kerusakan satu-satunya adalah isolasi worktree.
- **Isolasi**: sesi di worktree terpisah (`.worktrees/<id>`); tak ada akses ke working tree utama.
  Sejak ADR-0037 ini adalah satu-satunya batas keamanan yang tersisa.
- **Ingest error ber-DSN (SPEC-249, [ADR-0060](../adr/0060-error-monitoring-ingest-ber-dsn.md))**:
  `POST /api/ingest/:slug` adalah **pengecualian sah** gate `/api` — dipanggil project eksternal tanpa
  sesi login, diotorisasi **hanya** oleh DSN per-project (cermin pola `/api/sync`). Gate cookie di-bypass
  untuk prefix `/api/ingest`; route memverifikasi DSN sendiri.
  - **DSN hash-at-rest**: `Project.ingestKeyHash = sha256(key)` + `timingSafeEqual` (pola `DeviceToken`);
    plaintext hanya ditampilkan **sekali** saat generate/rotate. `ingestKeyHash` **tak pernah** ke client/log
    (`ProjectView` hanya `monitoringEnabled` + `ingestKeyPrefix`). Rotate = ganti (tanpa grace); revoke = null.
  - **Error generik**: project tak dikenal / DSN salah / revoked sama-sama **401** — tak mengenumerasi project.
  - **Isolasi antar-project**: query error selalu ber-scope `projectId`; satu DSN tak pernah membaca/menulis
    error project lain (AC PRD).
  - **Ketahanan**: caps payload (message ≤ 2 KB, stack ≤ 16 KB, body ≤ 64 KB → 413) + rate-limit token-bucket
    in-memory per project (429) + retensi opportunistic. DSN browser inheren semi-publik (ship di bundle
    klien) — batasnya adalah rotate/revoke + rate-limit, bukan kerahasiaan.
  - **PII**: payload disimpan **apa adanya** (scrub PII pasca-MVP, Open question PRD) — SDK/snippet
    diingatkan tak mengirim rahasia/PII di `message`/`context`.
