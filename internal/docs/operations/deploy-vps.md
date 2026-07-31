# Deploy hanoman ke VPS (single-host, di belakang reverse proxy)

Menjalankan satu instance hanoman publik di sebuah VPS Linux, di belakang reverse proxy
(Caddy/nginx) yang menerminasi TLS. Melengkapi [production.md](production.md) — yang membahas
prod **di samping dev pada satu mesin dev**; dokumen ini membahas VPS terpisah yang
menyajikan hanoman ke internet.

Sejak SPEC-398 hanoman dipasang sebagai **paket npm global** dan DB-nya satu berkas SQLite
([ADR-0086](../adr/0086-sqlite-satu-satunya-provider.md) ·
[ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md)): tidak ada Docker, tidak ada
Postgres, tidak ada clone repo di VPS. Instance yang **sudah hidup** dengan Postgres wajib dimigrasi
sekali — lihat §2.

> **Repo ini publik/open-source.** Jangan pernah menaruh nilai sensitif (host VPS, token,
> kredensial DB) di file ter-track. Rahasia hidup di berkas env di VPS (mode `600`), bukan di commit.
> Placeholder di bawah (`<VPS_HOST>`, `hanoman.<domain>`, dst.) diisi operator di VPS.

## Arsitektur

```
Internet ──TLS──> reverse proxy (Caddy) ──127.0.0.1:8788──> hanoman  (npm -g)
                                                                │
                                                        $HANOMAN_HOME/hanoman.db  (SQLite, in-process)
```

Server bind `127.0.0.1` (ADR-0028): `/api/terminal` menyerahkan PTY sungguhan (RCE by design,
ADR-0014), jadi ia **hanya** boleh dijangkau lewat proxy TLS + auth SPEC-169 — jangan set
`HOST=0.0.0.0`. Firewall cukup buka `22/80/443`; port app tetap lokal. Tak ada port DB sama sekali.

## Prasyarat di VPS

Node ≥ 20 · git · tmux · toolchain build (untuk kompilasi native `node-pty`) · CLI agen
(`claude` dan/atau `codex`). **Docker tidak lagi dibutuhkan.**

```sh
apt-get install -y build-essential python3 git tmux   # node-pty dikompilasi dari source di Linux
npm i -g @anthropic-ai/claude-code                    # `claude` per sesi terminal
```

## 1 · Pasang

```sh
npm i -g hanoman
hanoman doctor            # exit ≠ 0 bila ada prasyarat wajib yang absen
```

`doctor` memeriksa node ≥ 20, `git`, `tmux`, `claude`/`codex` (minimal satu), izin tulis direktori
data, dan keberadaan aset dashboard. Jalankan ini **sebelum** menyalakan systemd — kegagalan
prasyarat yang lewat akan muncul jauh nanti, di dalam pane tmux yang tak dibaca siapa pun.

## 2 · Migrasi dari Postgres (hanya untuk instance yang sudah hidup)

> **Backup dulu, tanpa pengecualian.** DB produksi memuat akun rekan & tiket nyata.

```sh
pg_dump "$OLD_PG_URL" > /root/hanoman-pg-$(date +%F).sql

# 1) lihat-lihat dulu — dry-run tidak menyentuh target sama sekali
hanoman migrate-from-postgres --from "$OLD_PG_URL" --dry-run

# 2) baru pindahkan
hanoman migrate-from-postgres --from "$OLD_PG_URL"
```

Tool ini memindahkan 26 model dalam urutan FK (`createMany` per 200 baris), `--dry-run` hanya
menghitung baris per tabel. Target yang sudah berisi data **ditolak** kecuali `--force` (yang
mengosongkannya dulu dalam urutan terbalik).

Dua bentuk ketidakcocokan sumber ditangani sendiri sejak cutover hub produksi 2026-07-31 — keduanya
dulu menggagalkan migrasi di tengah jalan:

- **Tabel yang tak ada di Postgres dilewati** (`42P01`) dan ditandai `(tak ada di sumber — dilewati)`.
  Model LOCAL-only seperti `SessionHistory` (SPEC-362) memang tak pernah punya tabel di hub, begitu
  pula model yang lahir sesudah instance sumber dibuat. Galat Postgres lain tetap menggagalkan.
- **Kolom `bigint` dikoersi ke `Int`.** Driver `pg` menyerahkan int8 sebagai *string* demi presisi
  64-bit, dan Prisma menolaknya untuk field `Int` (`SyncLog.seq`). Koersi memakai `dataTypeID` hasil
  query, dan **melempar** bila nilainya melewati `Number.MAX_SAFE_INTEGER` alih-alih membulatkan
  diam-diam — kursor sync yang meleset satu digit membuat perangkat melompati baris selamanya.

Ingat bahwa **`--dry-run` tak bisa menangkap ketidakcocokan tipe**: ia tak pernah menulis ke target,
jadi ia lulus untuk data yang nanti ditolak Prisma. Dry-run hijau ≠ migrasi akan mulus.

Migrator **tidak** idempoten saat gagal separuh jalan. Kalau ia berhenti di tengah, hapus berkas
target (`rm -f /srv/hanoman-prod/hanoman.db*`) dan ulangi dari nol — jangan lanjutkan di atasnya.

Dua hal yang mudah menjebak:

- **`DATABASE_URL` di environment masih menunjuk Postgres → perintahnya melempar.** Itu disengaja
  (ADR-0086): ia tak pernah diam-diam jatuh ke default. Kosongkan var itu atau sebut target
  eksplisit dengan `--to /srv/hanoman-prod/hanoman.db`.
- **Postgres lama dimatikan HANYA sesudah migrasi diverifikasi** — login ke dashboard, cek jumlah
  spec/tiket/akun, baru `docker compose down` (atau `systemctl disable --now postgresql`) dan hapus
  volume-nya. Sebelum itu ia adalah satu-satunya salinan hidup selain dump.

## 3 · Konfigurasi (`/etc/hanoman.env`, mode 600)

```sh
umask 077 && install -m 600 /dev/null /etc/hanoman.env
```

```ini
HANOMAN_HOME=/srv/hanoman-prod
PORT=8788
HOST=127.0.0.1
NODE_ENV=production
HANOMAN_TMUX_SOCKET=hanoman-prod
# VPS tak punya Keychain → token eksplisit (jalankan `claude setup-token` di mesin interaktif).
CLAUDE_CODE_OAUTH_TOKEN=<token-oauth>       # atau ANTHROPIC_API_KEY=<key>
```

`DATABASE_URL` **tidak perlu diisi**: tanpa ia, DB adalah `$HANOMAN_HOME/hanoman.db`. Kalau diisi, ia
wajib URL `file:` — nilai `postgresql://` melempar saat boot.

## 4 · systemd (auto-start, selamat reboot)

`/etc/systemd/system/hanoman.service`:

```ini
[Unit]
Description=hanoman orchestrator + dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Environment=HOME=/root
EnvironmentFile=/etc/hanoman.env
ExecStart=/usr/bin/env hanoman
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```sh
systemctl daemon-reload && systemctl enable --now hanoman
systemctl status hanoman ; journalctl -u hanoman -f
```

Tak ada lagi `Requires=docker.service` maupun `WorkingDirectory`: `hanoman` menemukan skema, migrasi,
dan aset dashboard dari dalam direktori paketnya sendiri (`resolveLayout`). Migrasi diterapkan setiap
start, jadi update tak butuh langkah `migrate deploy` terpisah.

`ExecStart=/usr/bin/env hanoman` berarti **supervisornya CLI hanoman itu sendiri**. Tombol
"Pasang & mulai ulang" di dashboard (SPEC-405 · ADR-0088) karena itu bekerja apa adanya di unit ini:
server keluar dengan kode 75, CLI memasang versi baru dari npm lalu men-spawn server lagi — systemd
tak pernah melihat restart itu dan tak perlu diubah. `Restart=on-failure` tetap jadi jaring pengaman
untuk kegagalan yang sebenarnya.

## 5 · Reverse proxy + TLS

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

## 6 · Verifikasi

```sh
curl -fsS https://hanoman.<domain>/api/health          # {"ok":true}
curl -s  https://hanoman.<domain>/api/auth/status      # {"needsSetup":true} saat 0 user
```

Buka `https://hanoman.<domain>`. Instalasi baru: selesaikan layar **Setup** untuk membuat akun
pertama. Instalasi hasil migrasi §2: login dengan akun yang sudah ada — `needsSetup` yang berbalik
`true` sesudah migrasi berarti tabel `User` kosong, jadi migrasinya belum benar-benar jalan.

## Update

```sh
hanoman update              # npm i -g hanoman@latest
systemctl restart hanoman
```

Badge "Update" di topbar muncul saat versi di registry npm lebih baru dari versi yang jalan
(perbandingan semver, bukan SHA git). Server hanya **mendeteksi** — ia tak pernah memasang atau
me-restart dirinya sendiri ([ADR-0048](../adr/0048-auto-update-deteksi-read-only.md)), karena itu
akan memutus sesi tmux yang sedang berjalan. `hanoman update --check` melaporkan tanpa memasang.

Restart aman untuk sesi: sesi agen hidup di tmux server sendiri (ADR-0016) dan selamat dari restart
proses API. Yang perlu diperhatikan hanya klien WebSocket yang harus re-attach.

## Deploy dari checkout (jalur lama)

Masih mungkin — `resolveLayout` mengenali layout repo, jadi `node cli/dist/hanoman.js` di dalam
clone berperilaku sama seperti biner global. Tetapi ia bukan lagi jalur yang didokumentasikan:
`git clone` + `pnpm install` + `pnpm build` menuntut toolchain penuh di VPS demi hasil yang identik
dengan satu `npm i -g`.
