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

## Update (SPEC-214)

`pnpm build` menanam `server/dist/build-info.json` (SHA commit). Server membandingkannya dengan checkout
HEAD dan `origin/<branch>` (fetch ter-gate `HANOMAN_UPDATE_FETCH=1`, otomatis menyala di boot server),
lalu menampilkan **badge "Update"** di topbar saat ada versi baru — dengan perintah
`git pull --ff-only && pnpm build && pnpm prod` untuk disalin. Deteksi saja: server tak pull/build/
restart sendiri (ADR-0043). Terapkan update dengan menjalankan perintah itu (matikan instance lama dulu).
