---
name: hanoman-devops
description: >-
  Pakai saat men-deploy atau mengoperasikan aplikasi hanoman di server:
  instalasi paket npm global (`npm i -g hanoman`) + systemd, VPS single-host di
  belakang reverse proxy TLS, prod di samping dev lewat `HANOMAN_HOME`,
  Caddy/nginx, DB SQLite embedded + `prisma migrate deploy`, migrasi sekali-jalan
  dari Postgres (`hanoman migrate-from-postgres`), `hanoman update` (SPEC-398),
  rollout sync hub/client (SPEC-213), migrasi data ke VPS live, serta verifikasi
  & troubleshoot boot/DB/terminal. Sub-skill dari skill `hanoman`.
---

# hanoman-devops

## Ikhtisar

Skill operasional untuk **mengirim & menjalankan aplikasi hanoman di server** — bukan fitur modul VPS (yang mengelola VPS lain), tapi men-deploy hanoman itu sendiri. Sejak SPEC-398 hanoman adalah **paket npm global** dengan **DB SQLite embedded**: tak ada Docker, tak ada Postgres, tak ada clone repo di server ([ADR-0086](../../docs/adr/0086-sqlite-satu-satunya-provider.md) · [ADR-0087](../../docs/adr/0087-distribusi-npm-global-satu-perintah.md)). Dua pola hidup berdampingan:

- **VPS single-host** — satu instance publik di VPS Linux di belakang reverse proxy TLS. Runbook: `internal/docs/operations/deploy-vps.md`.
- **Prod di samping dev** — dua instance di satu mesin, dipisah `HANOMAN_HOME` + port. Runbook: `internal/docs/operations/production.md`.

Selalu ikuti runbook di `internal/docs/operations/**` sebagai Source of Truth; skill ini merangkum urutan, gotcha, dan aturan keselamatan.

## Instance Live — JANGAN dirusak

hanoman sudah **live di VPS** di `https://hanoman.<domain>` sebagai **hub multi-user** dengan **akun teammate nyata** + Session login mereka. Detail host, IP, akun, dan token **tidak** ada di repo (publik/open-source) — mereka hidup di berkas env (gitignored / `/etc/hanoman.env` mode 600) di VPS dan di catatan ops privat.

- **Cutover Postgres → SQLite adalah operasi sekali-jalan yang membawa SEMUA data**, termasuk `User`/`Session`/`DeviceToken`: `pg_dump` dulu → `hanoman migrate-from-postgres --from "$OLD_PG_URL" --dry-run` → tanpa `--dry-run` → verifikasi lewat login dashboard → **baru** matikan Postgres lama. Sebelum verifikasi, Postgres lama adalah satu-satunya salinan hidup selain dump.
- **Migrasi data lokal → VPS harus ADITIF.** Jangan pernah menyalin berkas DB lokal menimpa berkas DB VPS — itu menghapus User/Session teammate. Copy **tabel konten saja** (Project→Spec FK-order, Vps), sisakan `User`/`Session`/`DeviceToken`. Ambil salinan `$HANOMAN_HOME/hanoman.db` di VPS dulu (rollback) — dengan SQLite, backup = menyalin satu berkas (sertakan `-wal`/`-shm` bila ada, atau `sqlite3 … ".backup"`).
- **`Project.repoDir` & `Vps.keyPath` adalah path mesin lokal** (mac `/Users/...`) yang tak resolve di VPS — set `repoDir` **NULL** lalu re-bind di VPS; `keyPath` di-set ulang di VPS atau healthcheck VPS gagal.
- VPS aktif bermutasi selama dipakai — re-snapshot tepat sebelum menulis.

## Bacaan Awal

- Deploy VPS single-host: `internal/docs/operations/deploy-vps.md`
- Prod di samping dev: `internal/docs/operations/production.md`
- README paket npm (pasang, prasyarat, konfigurasi, pindah dari Postgres): `internal/docs/operations/npm-readme.md`
- SQLite satu-satunya provider: [ADR-0086](../../docs/adr/0086-sqlite-satu-satunya-provider.md) · distribusi npm global: [ADR-0087](../../docs/adr/0087-distribusi-npm-global-satu-perintah.md) (SPEC-398)
- Auth & bind 127.0.0.1: `internal/docs/security/security-standard.md` · [ADR-0028](../../docs/adr/0028-auth-sesi-opaque-di-db.md)
- Update deteksi read-only: [ADR-0048](../../docs/adr/0048-auto-update-deteksi-read-only.md) (mekanisme diganti SPEC-398, keputusannya utuh)
- Arsitektur sync hub/client: [ADR-0043](../../docs/adr/0043-sync-arsitektur-hub-client-server-to-server.md) (SPEC-213), device token [ADR-0044](../../docs/adr/0044-device-token-machine-identity.md), knob runtime [ADR-0049](../../docs/adr/0049-config-runtime-store-registry.md)
- Sesi di tmux: [ADR-0016](../../docs/adr/0016-sesi-terminal-hidup-di-tmux.md) · PTY = RCE by design [ADR-0014](../../docs/adr/0014-pty-terminal-di-proses-api.md)

## Prinsip

- **Server bind `127.0.0.1`.** `/api/terminal` menyerahkan PTY sungguhan (RCE by design, ADR-0014) — hanya boleh dijangkau lewat proxy TLS + auth SPEC-169. **Jangan `HOST=0.0.0.0`** kecuali ada TLS di depannya. Firewall cukup buka `22/80/443`; port app tetap lokal, dan **tak ada port DB sama sekali** (SQLite in-process).
- **Repo publik → rahasia tak pernah ter-commit.** Host VPS, token, kredensial hanya di berkas env gitignored / `/etc/hanoman.env` (`chmod 600`) di VPS. `.gitignore` mengabaikan semua `.env*` kecuali `*.example`. Pakai placeholder (`<VPS_HOST>`, `hanoman.<domain>`) di dokumen ter-track.
- **Server tak pernah self-mutate** (ADR-0048): ia hanya **mendeteksi** update (badge di topbar), tak pernah memasang/restart sendiri — instance yang me-`npm i` dirinya sendiri lalu keluar akan memutus sesi tmux yang berjalan. `hanoman update` di CLI yang menerapkannya.
- **Auth wajib segera:** jendela 0-user terbuka sampai akun pertama dibuat — selesaikan **Setup** tepat setelah boot pertama.

## Deploy VPS baru (single-host)

Prasyarat VPS: Node ≥ 20 · git · tmux · `build-essential python3` (kompilasi native `node-pty`) · CLI agen (`npm i -g @anthropic-ai/claude-code`). **Docker & pnpm tidak lagi dibutuhkan.**

1. **Pasang:** `npm i -g hanoman` → `hanoman doctor` (exit ≠ 0 bila prasyarat wajib absen: node ≥ 20 · git · tmux · `claude`/`codex` · izin tulis home). Jalankan `doctor` **sebelum** menyalakan systemd.
2. **Migrasi (hanya bila ada instance Postgres lama):** `pg_dump` → `hanoman migrate-from-postgres --from "$OLD_PG_URL" --dry-run` → tanpa `--dry-run`. Lihat gotcha di bawah.
3. **Rahasia:** `/etc/hanoman.env` mode `600` — `HANOMAN_HOME=/srv/hanoman-prod`, `PORT=8788`, `HOST=127.0.0.1`, `NODE_ENV=production`, `HANOMAN_TMUX_SOCKET=hanoman-prod`, dan token agen eksplisit (`CLAUDE_CODE_OAUTH_TOKEN` — VPS tak punya Keychain; hasilkan via `claude setup-token` di mesin interaktif). `DATABASE_URL` **tak perlu diisi**: default `$HANOMAN_HOME/hanoman.db`.
4. **systemd:** unit `hanoman.service` (`Type=simple`, `Restart=on-failure`, `EnvironmentFile=/etc/hanoman.env`, `ExecStart=/usr/bin/env hanoman`). Tak ada `Requires=docker.service`, tak ada `WorkingDirectory` — `hanoman` menemukan skema/migrasi/aset dari direktori paketnya sendiri, dan menerapkan `migrate deploy` setiap start. `systemctl daemon-reload && systemctl enable --now hanoman`.
5. **Reverse proxy + TLS:** block Caddy `hanoman.<domain> { reverse_proxy 127.0.0.1:8788 }` (auto-HTTPS; meneruskan upgrade WebSocket `/api/terminal` otomatis) + header HSTS/nosniff. Pastikan A record `hanoman.<domain>` → IP VPS **sebelum** reload agar ACME HTTP-01 lolos. `caddy validate` → `systemctl reload caddy`.
6. **Verifikasi:** `curl -fsS https://hanoman.<domain>/api/health` → `{"ok":true}`; `/api/auth/status` → `{"needsSetup":true}` saat 0 user. Buka dashboard, selesaikan **Setup** (atau login dengan akun lama bila baru saja bermigrasi — `needsSetup:true` sesudah migrasi berarti tabel `User` kosong, jadi migrasinya belum benar-benar jalan).

## Prod di samping dev (satu mesin)

Dua instance, dipisah **`HANOMAN_HOME` + port** — bukan lagi dua database: `~/.hanoman` (dev, `:8787`) vs `/srv/hanoman-prod` (prod, `:8788`). Prod: `HANOMAN_HOME=/srv/hanoman-prod hanoman --port 8788`. Prod dari checkout (`pnpm prod` = `migrate deploy` → `generate` → `build` → `node server/dist/server.js`) masih didukung tapi bukan jalur default. Bahaya berbagi:

- **`pnpm build` saat prod-dari-checkout jalan** menimpa `server/dist/*` & `src/dist/*` yang sedang disajikan — matikan instance lama dulu. Instalasi npm tak punya masalah ini.
- **`HANOMAN_HOME` sama = berkas DB sama.** Pisahkan `HANOMAN_HOME` (atau `--db`) **dan** `HANOMAN_TMUX_SOCKET`.
- **`repoDir` sama** → sesi prod meng-commit ke repo yang sedang diedit; isolasi cuma per-worktree. Nomor SPEC diklaim dari nama berkas docs → waspada tabrakan (ADR-0021).

## Update (SPEC-398 / ADR-0048)

Badge "Update" muncul saat versi di **registry npm** lebih baru dari versi yang jalan — perbandingan **semver**, bukan SHA git (`pnpm build` menanam `version` root ke `dist/build-info.json`; fetch ter-gate `HANOMAN_UPDATE_FETCH`, registry bisa diarahkan `HANOMAN_NPM_REGISTRY`, TTL 5 mnt, gagal → `unavailable` tanpa melempar). Terapkan:

```sh
hanoman update              # npm i -g hanoman@latest  (`--check` hanya melaporkan)
systemctl restart hanoman
```

Migrasi diterapkan otomatis saat start, jadi tak ada langkah `migrate deploy` terpisah. `migrate deploy` idempotent; akun & Session tak tersentuh. Restart aman untuk sesi agen — mereka hidup di tmux server sendiri (ADR-0016) dan selamat dari restart proses API; yang perlu re-attach hanya klien WebSocket.

## Rollout sync hub/client (SPEC-213 / ADR-0043)

Peran ditentukan **env**, bukan binari berbeda — prod single-host tanpa `SYNC_SERVER_URL` = **hub murni** (perilaku lama, tanpa perubahan). Kolom/tabel baru semua additive → cukup `migrate deploy` (dijalankan `hanoman start` sendiri).

| var | efek |
|---|---|
| *(tak diset)* | **Hub** — menerima push, melayani `/api/sync/pull`, siar `/api/sync/ws`. |
| `SYNC_SERVER_URL=https://hub.example` | **Client** — sinkron server-to-server ke hub. |
| `SYNC_DEVICE_TOKEN=<token>` | Bearer auth sync/WS. Wajib bila `SYNC_SERVER_URL` diset. |
| `SYNC_TICK_MS` | Opsional; interval drain outbox (default 15000). |

Ketiga knob juga bisa diatur runtime dari **Settings → Konfigurasi** (override DB menang; simpan device token dari client → sync live tanpa restart — SPEC-215/ADR-0049). Pairing: di hub `POST /api/device-tokens` (token ditampilkan **sekali**) → di client set env → client pull-before-push. Bind project ke checkout lokal (`PUT /api/projects/:id/binding` atau `POST /api/projects/:id/clone`) sebelum menjalankan sesi — `repoDir`/binding **tak pernah** disync. Cabut device = `DELETE /api/device-tokens/:id` (device lain tak terpengaruh).

## Verifikasi & Troubleshoot

- Health: `curl -fsS https://hanoman.<domain>/api/health` → `{"ok":true}`. Isi DB (opsional, `sqlite3` bukan prasyarat): `sqlite3 /srv/hanoman-prod/hanoman.db 'select count(*) from "Spec"'`.
- Log service: `systemctl status hanoman` · `journalctl -u hanoman -f`.
- **`@prisma/client did not initialize yet` di instalasi npm** = `postinstall` (`prisma generate`) dilewati — `--ignore-scripts`, sebagian CI, sebagian setup npm global. `hanoman start` mendeteksi & menggenerate sendiri (`ensurePrismaClient`); bila itu pun gagal, jalankan `prisma generate --schema <pkg>/prisma/schema.prisma` manual atau pasang ulang tanpa `--ignore-scripts`. Gejala khasnya **menyesatkan**: migrasi **berhasil**, server mati seketika sesudahnya.
- **`DATABASE_URL harus URL SQLite file:` saat boot** = env masih menunjuk Postgres. Itu **disengaja** (ADR-0086) — jangan diakali dengan menghapus pemeriksaannya; kosongkan var itu (default `$HANOMAN_HOME/hanoman.db`) atau selesaikan migrasinya.
- **`migrate-from-postgres` melempar sebelum menyentuh apa pun** = `DATABASE_URL` masih Postgres → kosongkan, atau sebut target eksplisit `--to /srv/hanoman-prod/hanoman.db`.
- **Terminal/IDE 500** kerap = migrasi belum diterapkan ke berkas DB yang benar. Periksa berkas mana yang dipakai: `hanoman doctor` mencetak path DB yang di-resolve — path relatif di `DATABASE_URL` di-resolve **relatif ke direktori `schema.prisma`**, bukan cwd, jadi "tabel hilang" biasanya berarti dua berkas berbeda.
- **DB terkunci / `SQLITE_BUSY`** = dua proses menulis ke satu berkas. Pisahkan `HANOMAN_HOME` per instance.

## Jangan

- Jangan `HOST=0.0.0.0` tanpa TLS + auth di depannya (ADR-0028).
- Jangan menaruh host/IP/token/kredensial di file ter-track (repo publik) — hanya berkas env gitignored di VPS.
- Jangan full-overwrite DB VPS live (termasuk menimpa berkas `hanoman.db`) — migrasi data **aditif** saja, sisakan User/Session/DeviceToken.
- Jangan matikan/hapus Postgres lama sebelum hasil `migrate-from-postgres` **diverifikasi** lewat login dashboard.
- Jangan menjalankan `migrate-from-postgres` tanpa `pg_dump` lebih dulu, dan jangan lewati `--dry-run`.
- Jangan menganggap server akan update sendiri — ia deteksi saja (ADR-0048); operator yang menjalankan `hanoman update` + restart.
