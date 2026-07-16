---
name: hanoman-devops
description: >-
  Pakai saat men-deploy atau mengoperasikan aplikasi hanoman di server: VPS
  single-host di belakang reverse proxy TLS, prod di samping dev, systemd,
  Caddy/nginx, Postgres di Docker, prisma generate/migrate deploy, build,
  update in-place (SPEC-214), rollout sync hub/client (SPEC-213), migrasi data
  ke VPS live, serta verifikasi & troubleshoot boot/DB/terminal. Sub-skill dari
  skill `hanoman`.
---

# hanoman-devops

## Ikhtisar

Skill operasional untuk **mengirim & menjalankan aplikasi hanoman di server** — bukan fitur modul VPS (yang mengelola VPS lain), tapi men-deploy hanoman itu sendiri. Dua pola hidup berdampingan:

- **VPS single-host** — satu instance publik di VPS Linux di belakang reverse proxy TLS. Runbook: `internal/docs/operations/deploy-vps.md`.
- **Prod di samping dev** — satu checkout, dua instance (beda database + port). Runbook: `internal/docs/operations/production.md`.

Selalu ikuti runbook di `internal/docs/operations/**` sebagai Source of Truth; skill ini merangkum urutan, gotcha, dan aturan keselamatan.

## Instance Live — JANGAN dirusak

hanoman sudah **live di VPS** di `https://hanoman.<domain>` sebagai **hub multi-user** dengan **akun teammate nyata** + Session login mereka. Detail host, IP, akun, dan token **tidak** ada di repo (publik/open-source) — mereka hidup di `.env.production` (gitignored) di VPS dan di catatan ops privat.

- **Migrasi data lokal → VPS harus ADITIF.** Jangan pernah `pg_dump` full lalu restore menimpa — itu menghapus User/Session teammate. Copy **tabel konten saja** (Project→Spec FK-order, Vps), sisakan `User`/`Session`/`DeviceToken`. Selalu ambil backup `pg_dump -Fc` di VPS dulu (rollback).
- **`Project.repoDir` & `Vps.keyPath` adalah path mesin lokal** (mac `/Users/...`) yang tak resolve di VPS — set `repoDir` **NULL** lalu re-bind di VPS; `keyPath` di-set ulang di VPS atau healthcheck VPS gagal.
- VPS aktif bermutasi selama dipakai — re-snapshot tepat sebelum menulis.

## Bacaan Awal

- Deploy VPS single-host: `internal/docs/operations/deploy-vps.md`
- Prod di samping dev: `internal/docs/operations/production.md`
- Auth & bind 127.0.0.1: `internal/docs/security/security-standard.md` · [ADR-0028](../../docs/adr/0028-auth-sesi-opaque-di-db.md)
- Update deteksi read-only: [ADR-0048](../../docs/adr/0048-auto-update-deteksi-read-only.md) (SPEC-214)
- Arsitektur sync hub/client: [ADR-0043](../../docs/adr/0043-sync-arsitektur-hub-client-server-to-server.md) (SPEC-213), device token [ADR-0044](../../docs/adr/0044-device-token-machine-identity.md), knob runtime [ADR-0049](../../docs/adr/0049-config-runtime-store-registry.md)
- Sesi di tmux: [ADR-0016](../../docs/adr/0016-sesi-terminal-hidup-di-tmux.md) · PTY = RCE by design [ADR-0014](../../docs/adr/0014-pty-terminal-di-proses-api.md)

## Prinsip

- **Server bind `127.0.0.1`.** `/api/terminal` menyerahkan PTY sungguhan (RCE by design, ADR-0014) — hanya boleh dijangkau lewat proxy TLS + auth SPEC-169. **Jangan `HOST=0.0.0.0`** kecuali ada TLS di depannya. Firewall cukup buka `22/80/443`; port app & DB tetap lokal.
- **Repo publik → rahasia tak pernah ter-commit.** Host VPS, token, kredensial DB hanya di `.env.production` (gitignored, `chmod 600`) di VPS. `.gitignore` mengabaikan semua `.env*` kecuali `*.example`. Pakai placeholder (`<VPS_HOST>`, `hanoman.<domain>`, `<db-port>`) di dokumen ter-track.
- **Server tak pernah self-mutate** (ADR-0048): ia hanya **mendeteksi** update (badge di topbar), tak pernah pull/build/restart sendiri. Operator yang menerapkannya.
- **Auth wajib segera:** jendela 0-user terbuka sampai akun pertama dibuat — selesaikan **Setup** tepat setelah boot pertama.

## Deploy VPS baru (single-host)

Prasyarat VPS: Node ≥ 20 · pnpm (corepack) · tmux · Docker · git · `build-essential python3` (kompilasi native `node-pty`) · Claude Code CLI (`npm i -g @anthropic-ai/claude-code`).

1. **Kode:** `git clone` origin publik → `/root/hanoman`; `pnpm install`.
2. **Postgres (Docker):** bila host `5432` terpakai, petakan port lain via **`docker-compose.override.yml`** (gitignored) dengan tag **`ports: !override`** (tanpa itu Compose meng-*append* dan tetap bentrok di 5432) + `restart: unless-stopped`. `docker compose up -d --wait`; `CREATE DATABASE hanoman_prod`.
3. **Rahasia:** `umask 077 && cp .env.production.example .env.production`; isi `DATABASE_URL` (port sesuai override), `PORT=8788`, `HOST=127.0.0.1`, `NODE_ENV=production`, `HANOMAN_TMUX_SOCKET=hanoman-prod`, dan token Claude eksplisit (`CLAUDE_CODE_OAUTH_TOKEN` — VPS tak punya Keychain; hasilkan via `claude setup-token` di mesin interaktif). `chmod 600`.
4. **Generate · migrate · build** (source env dulu: `set -a && . ./.env.production && set +a`):
   ```sh
   pnpm --filter ./server exec prisma generate      # WAJIB di clone fresh — lihat gotcha
   pnpm --filter ./server exec prisma migrate deploy
   pnpm build
   ```
5. **systemd:** unit `hanoman.service` (`Type=simple`, `Restart=on-failure`, `ExecStart=/bin/bash -lc 'set -a && . /root/hanoman/.env.production && set +a && exec node /root/hanoman/server/dist/server.js'`, `Requires=docker.service`). `systemctl daemon-reload && systemctl enable --now hanoman`.
6. **Reverse proxy + TLS:** block Caddy `hanoman.<domain> { reverse_proxy 127.0.0.1:8788 }` (auto-HTTPS; meneruskan upgrade WebSocket `/api/terminal` otomatis) + header HSTS/nosniff. Pastikan A record `hanoman.<domain>` → IP VPS **sebelum** reload agar ACME HTTP-01 lolos. `caddy validate` → `systemctl reload caddy`.
7. **Verifikasi:** `curl -fsS https://hanoman.<domain>/api/health` → `{"ok":true}`; `/api/auth/status` → `{"needsSetup":true}` saat 0 user. Buka dashboard, selesaikan **Setup**.

## Prod di samping dev (satu mesin)

Satu checkout, dua instance — yang dipisah hanya **state**: `hanoman` (dev, `:8787`) vs `hanoman_prod` (prod, `:8788`). `pnpm prod` naik dari mati total (hook `preprod` = `docker up` → bikin DB → `migrate deploy` → `build`; lalu `prod:api`). Bahaya berbagi:

- **`pnpm build` saat prod jalan** menimpa `server/dist/*` & `src/dist/*` yang sedang disajikan — matikan instance lama dulu.
- **`docker compose stop db` mematikan dev juga** (satu Postgres, dua database).
- **`repoDir` sama** → sesi prod meng-commit ke repo yang sedang diedit; isolasi cuma per-worktree. Nomor SPEC diklaim dari nama berkas docs → waspada tabrakan (ADR-0021).

## Update in-place (SPEC-214 / ADR-0048)

Badge "Update" muncul saat `origin/<branch>` lebih baru (`pnpm build` menanam SHA di `build-info.json`; fetch ter-gate `HANOMAN_UPDATE_FETCH=1`, otomatis di boot). Terapkan manual (matikan/lalu restart lewat systemd):

```sh
cd /root/hanoman && git pull --ff-only
set -a && . ./.env.production && set +a
pnpm install
pnpm --filter ./server exec prisma generate      # WAJIB LAGI bila pnpm install reinstall node_modules
pnpm --filter ./server exec prisma migrate deploy
pnpm build
systemctl restart hanoman
```

Update murni kode (tanpa migration) aman untuk `hanoman_prod` live: `migrate deploy` idempotent; akun & Session tak tersentuh.

## Rollout sync hub/client (SPEC-213 / ADR-0043)

Peran ditentukan **env**, bukan binari berbeda — prod single-host tanpa `SYNC_SERVER_URL` = **hub murni** (perilaku lama, tanpa perubahan). Kolom/tabel baru semua additive → cukup `migrate deploy`.

| var | efek |
|---|---|
| *(tak diset)* | **Hub** — menerima push, melayani `/api/sync/pull`, siar `/api/sync/ws`. |
| `SYNC_SERVER_URL=https://hub.example` | **Client** — sinkron server-to-server ke hub. |
| `SYNC_DEVICE_TOKEN=<token>` | Bearer auth sync/WS. Wajib bila `SYNC_SERVER_URL` diset. |
| `SYNC_TICK_MS` | Opsional; interval drain outbox (default 15000). |

Ketiga knob juga bisa diatur runtime dari **Settings → Konfigurasi** (override DB menang; simpan device token dari client → sync live tanpa restart — SPEC-215/ADR-0049). Pairing: di hub `POST /api/device-tokens` (token ditampilkan **sekali**) → di client set env → client pull-before-push. Bind project ke checkout lokal (`PUT /api/projects/:id/binding` atau `POST /api/projects/:id/clone`) sebelum menjalankan sesi — `repoDir`/binding **tak pernah** disync. Cabut device = `DELETE /api/device-tokens/:id` (device lain tak terpengaruh).

## Verifikasi & Troubleshoot

- Health: `curl -fsS https://hanoman.<domain>/api/health` → `{"ok":true}`; isolasi prod: `docker compose exec -T db psql -U hanoman -d hanoman_prod -tAc 'select count(*) from "Spec"'`.
- Log service: `systemctl status hanoman` · `journalctl -u hanoman -f`.
- **`@prisma/client` gagal init saat runtime** = `prisma generate` belum jalan setelah clone fresh **atau** setelah `pnpm install` yang me-reinstall node_modules → jalankan `prisma generate` lalu `systemctl restart hanoman`. `pnpm prod:setup` sengaja **tak** menjalankan generate (asumsi node_modules dev/prod di-share di mesin dev).
- **Terminal/IDE 500 atau psql "DB down"**: Postgres di Docker — `psql -d hanoman` di unix socket menyesatkan; pakai `docker compose exec -T db psql -U hanoman -d <db>`. 500 pada IDE/terminal/specs kerap = migrasi binding per-mesin belum diterapkan → `prisma generate` + `migrate deploy` per DB.
- **Bentrok port DB** = `docker-compose.override.yml` tanpa `ports: !override` (Compose meng-append list, tetap coba 5432).

## Jangan

- Jangan `HOST=0.0.0.0` tanpa TLS + auth di depannya (ADR-0028).
- Jangan menaruh host/IP/token/kredensial di file ter-track (repo publik) — hanya `.env.production` gitignored di VPS.
- Jangan full-overwrite DB VPS live — migrasi data **aditif** saja, sisakan User/Session/DeviceToken.
- Jangan skip `prisma generate` di clone fresh / setelah reinstall node_modules.
- Jangan menganggap server akan update sendiri — ia deteksi saja (ADR-0048); operator yang pull/build/restart.
