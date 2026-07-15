# Deploy hanoman ke VPS (single-host, di belakang reverse proxy)

Menjalankan satu instance hanoman publik di sebuah VPS Linux, di belakang reverse proxy
(Caddy/nginx) yang menerminasi TLS. Melengkapi [production.md](production.md) — yang membahas
prod **di samping dev pada satu checkout mesin dev**; dokumen ini membahas VPS terpisah yang
menyajikan hanoman ke internet.

> **Repo ini publik/open-source.** Jangan pernah menaruh nilai sensitif (host VPS, token,
> kredensial DB) di file ter-track. Semua rahasia hidup di `.env.production` (gitignored) di VPS.
> `.gitignore` mengabaikan seluruh `.env*` kecuali `*.example`. Placeholder di bawah
> (`<VPS_HOST>`, `hanoman.<domain>`, dst.) diisi operator di mesin/VPS, bukan di commit.

## Arsitektur

```
Internet ──TLS──> reverse proxy (Caddy) ──127.0.0.1:8788──> node server/dist/server.js
                                                                    │
                                                            127.0.0.1:<db-port> ──> Postgres (Docker)
```

Server bind `127.0.0.1` (ADR-0028): `/api/terminal` menyerahkan PTY sungguhan (RCE by design,
ADR-0014), jadi ia **hanya** boleh dijangkau lewat proxy TLS + auth SPEC-169 — jangan set
`HOST=0.0.0.0`. Firewall cukup buka `22/80/443`; port app & DB tetap lokal.

## Prasyarat di VPS

Node ≥ 20 · pnpm (via corepack) · tmux · Docker · git · toolchain build (untuk kompilasi native
`node-pty`) · Claude Code CLI.

```sh
corepack enable && corepack prepare pnpm@9 --activate
apt-get install -y build-essential python3        # node-pty dikompilasi dari source di Linux
npm i -g @anthropic-ai/claude-code                # `claude` headless per sesi terminal
```

## 1 · Kode

```sh
git clone https://github.com/denameidina/hanoman.git /root/hanoman
cd /root/hanoman
pnpm install                                      # membangun node-pty + prisma engines
```

## 2 · Postgres (Docker)

`docker-compose.yml` memetakan `5432:5432`. Bila host sudah memakai `5432` (mis. container
project lain), petakan ke port lain lewat **`docker-compose.override.yml`** (gitignored). Gunakan
tag `!override` — tanpa itu Compose meng-*append* list `ports` dan tetap mencoba `5432`:

```yaml
# docker-compose.override.yml
services:
  db:
    restart: unless-stopped          # hidup lagi setelah reboot VPS
    ports: !override
      - "127.0.0.1:<db-port>:5432"   # mis. 5433 bila 5432 terpakai
```

```sh
docker compose up -d --wait
docker compose exec -T db psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman_prod'
```

## 3 · Konfigurasi rahasia (`.env.production`, gitignored)

```sh
umask 077 && cp .env.production.example .env.production   # lalu isi:
```

```ini
DATABASE_URL=postgresql://hanoman:hanoman@localhost:<db-port>/hanoman_prod
PORT=8788
HOST=127.0.0.1
NODE_ENV=production
HANOMAN_TMUX_SOCKET=hanoman-prod
# VPS tak punya Keychain → token eksplisit (jalankan `claude setup-token` di mesin interaktif).
CLAUDE_CODE_OAUTH_TOKEN=<token-oauth>       # atau ANTHROPIC_API_KEY=<key>
```

`chmod 600 .env.production`. File ini **tak pernah** ter-commit.

## 4 · Generate · migrate · build

```sh
set -a && . ./.env.production && set +a
pnpm --filter ./server exec prisma generate    # WAJIB di clone fresh (lihat catatan)
pnpm --filter ./server exec prisma migrate deploy
pnpm build
```

> **Catatan:** `pnpm prod:setup` melewatkan `prisma generate` karena di mesin dev `node_modules`
> dev/prod di-share (client sudah ter-generate oleh alur dev). Di clone VPS yang fresh, `prisma
> generate` **wajib** dijalankan manual — tanpa itu `@prisma/client` gagal init saat runtime.

## 5 · systemd (auto-start, selamat reboot)

`/etc/systemd/system/hanoman.service` — meng-*source* `.env.production` lalu `exec node`, persis
semantik `pnpm prod:api` tanpa pnpm:

```ini
[Unit]
Description=hanoman orchestrator + dashboard
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
Environment=HOME=/root
WorkingDirectory=/root/hanoman
ExecStart=/bin/bash -lc 'set -a && . /root/hanoman/.env.production && set +a && exec node /root/hanoman/server/dist/server.js'
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```sh
systemctl daemon-reload && systemctl enable --now hanoman
systemctl status hanoman ; journalctl -u hanoman -f
```

## 6 · Reverse proxy + TLS

Contoh block Caddy (auto-HTTPS Let's Encrypt; `reverse_proxy` meneruskan upgrade WebSocket
`/api/terminal` otomatis):

```
hanoman.<domain> {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
	}
	reverse_proxy 127.0.0.1:8788
}
```

Prasyarat cert: A record `hanoman.<domain>` → IP VPS **sebelum** reload, agar tantangan ACME
HTTP-01 lolos. `caddy validate` lalu `systemctl reload caddy`.

## 7 · Verifikasi

```sh
curl -fsS https://hanoman.<domain>/api/health          # {"ok":true}
curl -s  https://hanoman.<domain>/api/auth/status      # {"needsSetup":true} saat 0 user
```

Buka `https://hanoman.<domain>`, selesaikan layar **Setup** untuk membuat akun pertama.

## Update (SPEC-214)

Badge "Update" muncul di topbar saat `origin/<branch>` lebih baru. Terapkan:

```sh
cd /root/hanoman && git pull --ff-only
set -a && . ./.env.production && set +a
pnpm install && pnpm --filter ./server exec prisma migrate deploy && pnpm build
systemctl restart hanoman
```

Server hanya mendeteksi update, tak pernah pull/build/restart sendiri (ADR-0048).
