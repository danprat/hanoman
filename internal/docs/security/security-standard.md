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
    npm `hanoman-sdk` / snippet browser) — batasnya adalah rotate/revoke + rate-limit, bukan kerahasiaan.
  - **PII**: payload disimpan **apa adanya** (scrub PII pasca-MVP, Open question PRD) — SDK `hanoman-sdk`
    diingatkan tak mengirim rahasia/PII di `message`/`context`.
- **Help Center publik (SPEC-253, [ADR-0062](../adr/0062-help-center-tiket-publik-triase.md))**:
  `/api/help/*` adalah **pengecualian sah** gate `/api` — dipanggil pengguna akhir tanpa sesi login.
  Gate cookie di-bypass untuk prefix `/api/help` (cermin `/api/ingest`); route mengotorisasi sendiri.
  - **Otorisasi non-cookie**: submit/info oleh `Project.helpEnabled` (nonaktif/project asing → **404
    generik**, tak enumerasi); cek status oleh **kunci opaque tiket** `hnm_tkt_<hex>`, disimpan
    **hash-at-rest** `sha256(key)` (**@unique**, `accessKeyHash` **TAK PERNAH** ke client/log), lookup
    by hash + diverifikasi milik slug (404 tanpa membocorkan keberadaan tiket/project lain). Plaintext
    kunci hanya ditampilkan **sekali** di layar setelah submit.
  - **Isolasi antar-project**: query tiket/lampiran selalu ber-scope `projectId`; satu Help Center tak
    pernah membaca/menulis tiket project lain.
  - **Lampiran**: berkas di `HANOMAN_UPLOAD_DIR` (server-local, **di luar repoDir, tak disync**), nama
    opaque `uuid+ext` (bukan input user → tanpa path traversal), disajikan **hanya ber-auth**
    (`GET /api/tickets/:id/attachments/:attId` di belakang gate); halaman status publik tak menampilkannya
    balik. Batas: ≤3 berkas, ≤5MB, mime gambar; invalid di-skip (submit sisanya tetap jadi).
  - **Ketahanan**: rate-limit token-bucket in-memory **per IP & per project** (429) + **honeypot** (`hp`
    terisi → 200 palsu, tak buat tiket) + caps field. **Bukan** anti-spam berat (tanpa CAPTCHA/verifikasi
    email) — spam disaring saat triase (Non-goal PRD). PII isi/lampiran disimpan apa adanya (scrub pasca-MVP).
- **Kunci audit lintas project (SPEC-337, [ADR-0075](../adr/0075-audit-lintas-project-projectlink-kunci-sesi.md))**:
  prefix `/api/audit/*` adalah **pengecualian sah** gate `/api` — dipanggil **sesi `claude` milik hanoman
  sendiri** (bukan agen eksternal) yang tak punya cookie. Gate di-bypass **hanya bila** header
  `X-Hanoman-Audit-Key` cocok dengan sesi tmux **hidup**; selain itu jatuh ke jalur auth normal → 401.
  - **Kunci seumur sesi, tanpa tabel kredensial**: `hnm_xa_<hex>` hidup sebagai tmux option
    (`@hanoman_audit_key`) bersama scope-nya (`@hanoman_audit_projects`), diteruskan ke proses sesi lewat
    env. Karena tmux = sumber kebenaran sesi (ADR-0016), kunci selamat dari restart API dan **mati bersama
    pane** — tak ada revoke yang bisa terlupa. **TAK PERNAH** keluar lewat API (`SessionInfo`/`GET
    /terminal/sessions` tak memuatnya).
  - **Read-only & ber-scope**: hanya `ErrorGroup`/`ErrorEvent` project di scope sesi (project utama +
    tetangga `ProjectLink` satu hop). Project di luar scope → **403**; grup di luar scope → **404**
    (keberadaannya tak dibocorkan). Tak ada jalur tulis, tak ada domain lain.
  - **Model ancaman**: kunci terlihat oleh siapa pun yang bisa `tmux -L hanoman` sebagai user itu —
    kepercayaan yang **sama** dengan bisa menjalankan `claude` di mesin itu (ADR-0037). Tak ada batas baru
    yang ditembus. Sesi cross-audit juga **membaca** checkout project tetangga; batas **tulis** tetap
    worktree (ADR-0002) dan flow-nya audit-only (dilarang menulis kode, ADR-0057).
- **Agent token — akses AI agent (SPEC-257, [ADR-0065](../adr/0065-ai-agent-capability-agent-token.md))**:
  **jalur auth kedua** ke seluruh `/api` di samping cookie sesi. Agen eksternal mengirim
  `Authorization: Bearer <token>` (upgrade WebSocket: `?agent_token=`); gate `onRequest` yang sama
  memverifikasi lalu menegakkan **capability**. Cookie sesi tetap = **akses penuh** (tak ada RBAC).
  - **Master switch**: `Setting.agentAccessEnabled` (default **false**). Off → semua agent token ditolak
    **401**, apa pun `enabled`/capability-nya. Human menyalakannya di Settings.
  - **Token hash-at-rest**: `AgentToken.tokenHash = sha256(token)` + `timingSafeEqual` (pola `DeviceToken`).
    Plaintext (`hnm_agt_<hex>`) hanya ditampilkan **sekali** saat create; `tokenHash` **tak pernah** ke
    client/log (`AgentTokenView` hanya `tokenPrefix`). Revocable instan (`revokedAt`) + disable per-token
    (`enabled`). `lastUsedAt` = audit ringan.
  - **Capability per-domain read/write** (`"<domain>:<access>"`, write⊇read; 9 domain, katalog di
    `@hanoman/shared`). Route→capability dipetakan `services/agent-capabilities.ts`; agen tanpa capability
    → **403** `{ need }`. Read-only global (`/limits`,`/update`,`/events`,`/fs`) → token ber-capability apa pun.
  - **Tak-boleh-didelegasikan** (agent token → **403** apa pun capability): `/auth/*` (kelola user),
    `/agent-tokens*` (**anti privilege-escalation** — agen tak mencetak/menaikkan token), `/device-tokens*`,
    `/sync*`. Kelola token & master switch = **cookie-only**. Route tak dikenal peta → default cookie-only.
  - **Bukan perluasan permukaan eksekusi**: `sessions:write` = RCE (spawn `claude --dangerously-skip-permissions`)
    & `vps:write` = remote exec tetap dibatasi **isolasi worktree** (ADR-0037) — agent token hanya membuka
    pintu API yang sama lewat auth berbeda, bukan menambah kemampuan baru.
