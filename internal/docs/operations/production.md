# Menjalankan hanoman production di samping dev

Satu checkout, dua instance. Prod dan dev berbagi kode, `node_modules`, dan repo project — yang
dipisah hanya **state**: database dan port. Tidak ada Redis, worker, maupun namespace run id — antrean
dan runner headless sudah dicabut (ADR-0024); eksekusi kini sesi `claude` interaktif di tmux.

| | dev | prod |
|---|---|---|
| database | `hanoman` | `hanoman_prod` |
| port | `8787` | `8788` |
| dashboard | vite dev server (`:5173`) | disajikan proses api dari `src/dist` |

## Sekali di awal

```sh
cp .env.production.example .env.production
```

`.env.production` gitignored. Ia di-*source* **sebelum** node boot (`set -a && . ./.env.production`),
dan `env.ts` tidak pernah menimpa var yang sudah ada — jadi nilainya menang atas `.env`. Kunci yang
tidak disebut di sana tetap jatuh ke `.env`: mis. `CLAUDE_CODE_OAUTH_TOKEN` dipakai bersama kecuali
prod diberi token sendiri. Setel `PORT=8788` dan `DATABASE_URL` prod di sana.

## Menjalankan

```sh
pnpm prod
```

Satu perintah, dari keadaan mati total. Hook `preprod` menjalankan `prod:setup` lebih dulu —
`docker compose up -d --wait` (Postgres), bikin `hanoman_prod` kalau belum ada (`prod:db`),
`prisma migrate deploy`, lalu `pnpm build` — baru `prod:api` naik: `node server/dist/server.js` yang
menyajikan SPA dari `src/dist` sekaligus API. Tak ada proses worker terpisah.

Dashboard di <http://127.0.0.1:8788>. Server bind `127.0.0.1`; `/api/terminal` menyerahkan PTY
sungguhan (RCE by design, ADR-0014), jadi jangan setel `HOST=0.0.0.0` tanpa reverse proxy TLS + auth
di depannya.

## Yang masih berbagi — hati-hati

- **`pnpm build` saat prod jalan** menimpa `server/dist/*` dan `src/dist/*` yang sedang disajikan prod.
  `preprod` ikut membangun, jadi `pnpm prod` kedua me-rebuild di bawah instance yang sedang melayani —
  matikan yang lama dulu.
- **`docker compose stop db` mematikan dev juga.** Postgres-nya satu instance; `hanoman` dan
  `hanoman_prod` cuma dua database di dalamnya.
- **`repoDir` yang sama** berarti sesi prod meng-commit ke repo yang sedang Anda edit. Isolasinya cuma
  per-worktree. Nomor SPEC diklaim dari nama berkas docs, bukan env, jadi dua instance yang berbagi
  `repoDir` tetap perlu waspada tabrakan nomor — lihat [ADR-0021](../adr/0021-nomor-spec-diklaim-docs-bukan-hanya-database.md).

## Memeriksa isolasi

```sh
curl -s localhost:8788/api/health                                        # {"ok":true}
docker compose exec -T db psql -U hanoman -d hanoman_prod -tAc 'select count(*) from "Spec"'
```

## Rollout hub + client (SPEC-213, ADR-0043)

SPEC-213 menambah peran **hub** dan **client** secara **additif** — prod single-host yang ada
sekarang **tetap jalan tanpa perubahan**: tanpa `SYNC_SERVER_URL` ia adalah **hub murni**
(perilaku lama). Tak ada migrasi wajib selain `prisma migrate deploy` (kolom/tabel baru semua
additive dengan default aman).

Peran ditentukan env, bukan binari berbeda:

| var | efek |
|---|---|
| *(tak diset)* | **Hub**: menerima push, melayani `GET /api/sync/pull`, menyiarkan `GET /api/sync/ws`. |
| `SYNC_SERVER_URL=https://hub.example` | **Client**: instance ini menyinkron (server-to-server) ke hub itu. |
| `SYNC_DEVICE_TOKEN=<token>` | Device token (Bearer) untuk auth sync/WS. Wajib bila `SYNC_SERVER_URL` diset. |
| `SYNC_TICK_MS` | Opsional; interval drain fallback outbox (default 15000). |

> **SPEC-215 (ADR-0049):** ketiga knob di atas kini juga dapat diatur runtime dari dashboard →
> **Settings → Konfigurasi** (override DB menang atas env; menyimpan device token dari client
> menyambungkan sync **live** tanpa restart). Env tetap berlaku sebagai fallback bootstrap.

Langkah pairing device client:

1. Di **hub**, login lalu terbitkan token: `POST /api/device-tokens {"name":"laptop-dev"}` →
   salin `token` (ditampilkan **sekali**).
2. Di **client**, set `SYNC_SERVER_URL` + `SYNC_DEVICE_TOKEN`, boot. Log menampilkan `sync client → <url>`.
3. Client menarik state hub (pull-before-push), lalu mem-push write lokalnya. Bind project ke
   checkout lokal (`PUT /api/projects/:id/binding` atau `POST /api/projects/:id/clone`) sebelum
   menjalankan sesi Claude — `repoDir`/binding **tak pernah** disync (per-mesin).

Kehilangan device = cabut satu token di hub (`DELETE /api/device-tokens/:id`); device lain tak
terpengaruh. TLS via reverse proxy (ADR-0028) wajib untuk melindungi token dari internet publik.

## Update (SPEC-214)

`pnpm build` menanam `server/dist/build-info.json` (SHA commit). Server membandingkannya dengan checkout
HEAD dan `origin/<branch>` (fetch ter-gate `HANOMAN_UPDATE_FETCH=1`, otomatis menyala di boot server),
lalu menampilkan **badge "Update"** di topbar saat ada versi baru — dengan perintah
`git pull --ff-only && pnpm build && pnpm prod` untuk disalin. Deteksi saja: server tak pull/build/
restart sendiri (ADR-0048). Terapkan update dengan menjalankan perintah itu (matikan instance lama dulu).
