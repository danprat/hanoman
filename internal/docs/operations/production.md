# Menjalankan hanoman production di samping dev

Satu checkout, dua instance. Prod dan dev berbagi kode, `node_modules`, dan repo
project — yang dipisah hanya **state**: database, Redis db index, port, dan
namespace run id.

| | dev | prod |
|---|---|---|
| database | `hanoman` | `hanoman_prod` |
| Redis db | `0` | `3` |
| port | `8787` | `8788` |
| run id | `RUN-8801…` | `RUN-90001…` |
| dashboard | vite dev server (`:5173`) | disajikan proses api dari `src/dist` |

## Sekali di awal

```sh
cp .env.production.example .env.production
```

`.env.production` gitignored. Ia diekspor **sebelum** node boot, dan `env.ts` tidak
pernah menimpa var yang sudah ada — jadi nilainya menang atas `.env`. Kunci yang
tidak disebut di sana tetap jatuh ke `.env`: `CLAUDE_CODE_OAUTH_TOKEN` dan
kredensial GitHub App dipakai bersama. Beri prod token sendiri dengan
menambahkannya ke `.env.production`.

## Menjalankan

```sh
pnpm prod
```

Satu perintah, dari keadaan mati total. Hook `preprod` menjalankan `prod:setup`
lebih dulu — `docker compose up -d --wait` (Postgres), bikin `hanoman_prod` kalau
belum ada, `prisma migrate deploy`, lalu `pnpm build` — baru `prod:api` dan
`prod:worker` naik berbarengan.

Dashboard di <http://127.0.0.1:8788>. Keduanya bind ke `127.0.0.1`; `/api/terminal`
menyerahkan PTY sungguhan, jadi jangan setel `HOST=0.0.0.0` tanpa lapisan auth di
depannya.

## Kenapa `RUN_ID_FLOOR` ada

`nextRunId()` itu max-based **per-database**, dan run id menentukan path worktree:
`<repoDir>/.worktrees/<run-id>`. Dua instance yang berbagi `repoDir` tapi punya DB
sendiri sama-sama mulai dari floor yang sama, mengalokasikan `RUN-8801`, lalu
`addWorktree` yang satu `worktree remove --force` worktree milik yang lain di tengah
run. Guard dedup di `enqueueRun` buta lintas-DB. Floor terpisah membuat id-nya tak
pernah bertemu.

## Kenapa Redis db **wajib** bukan 0

Worker dev mendengarkan `hanoman-runs` di db 0. Nama queue prod sama persis, jadi
tanpa db index terpisah worker dev akan melahap job prod dan menjalankannya sebagai
run-nya sendiri — worktree dan proses `claude` sungguhan. `bullConnection` di
`server/src/redis.ts` sudah membaca db index dari `REDIS_URL`.

## Yang masih berbagi — hati-hati

- **`pnpm build` saat prod jalan** menimpa `server/dist/*` dan `src/dist/*` yang
  sedang disajikan prod. Ini termasuk `pnpm prod` kedua: `preprod` ikut membangun, jadi
  ia me-rebuild di bawah instance yang sudah melayani. Matikan yang lama dulu.
- **`docker compose stop db` mematikan dev juga.** Postgres-nya satu instance, dipakai
  bersama; `hanoman` dan `hanoman_prod` cuma dua database di dalamnya.
- **`repoDir` yang sama** berarti run prod meng-commit ke repo yang sedang Anda edit.
  Isolasinya cuma per-worktree.
- **Redis-nya bukan yang di `docker-compose.yml`.** Ada `redis-server` native yang
  memegang `127.0.0.1:6379`; container `hanoman-redis-1` menempel di wildcard IPv6 dan
  tidak pernah dipakai. Periksa dengan `lsof -nP -iTCP:6379 -sTCP:LISTEN`. Redis native
  itu dipakai bersama aplikasi lain (queue `ai-v2-*`, `erp-*` ada di db 0) — satu lagi
  alasan prod tidak boleh di db 0. Postgres, sebaliknya, memang yang di Docker.

## Memeriksa isolasi

```sh
curl -s localhost:8788/api/health                     # {"ok":true}
redis-cli -n 3 --scan --pattern 'bull:*'              # hanya queue hanoman
docker compose exec -T db psql -U hanoman -d hanoman_prod -tAc 'select count(*) from "Run"'
```
