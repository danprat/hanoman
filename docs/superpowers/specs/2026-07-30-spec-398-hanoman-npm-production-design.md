# SPEC-398 — hanoman production level: `npm i -g hanoman`, tanpa Docker

**Tanggal:** 2026-07-30 · **Sumber:** brief · **Prioritas:** tinggi
**ADR:** [0086](../../../internal/docs/adr/0086-sqlite-satu-satunya-provider.md) (SQLite satu-satunya provider) ·
[0087](../../../internal/docs/adr/0087-distribusi-npm-global-satu-perintah.md) (distribusi npm global, satu perintah, update dari registry)

## Masalah

hanoman hari ini hanya bisa dijalankan dari checkout git: `pnpm install` → `docker compose up`
(Postgres) → `prisma migrate deploy` → `pnpm build` → `node server/dist/server.js`. Enam langkah,
satu di antaranya menuntut Docker. Update berarti `git pull && pnpm build && pnpm prod`
(`services/update.ts` `PULL_CMD`), jadi identitas versi = SHA git dan "instance" = working tree.

Objective SPEC-398: **`npm i -g hanoman` → `hanoman` → jalan**, tanpa Docker, dan update yang mudah.

## Keputusan (dielicit dari user saat Brainstorm)

1. **SQLite jadi satu-satunya provider.** Bukan dua provider berdampingan, bukan "Postgres tanpa
   Docker". → ADR-0086.
2. **Update = CLI + deteksi versi dari registry npm.** `hanoman update` menjalankan
   `npm i -g hanoman@latest`; panel dashboard tetap **read-only** (ADR-0048 utuh) — tak ada
   `POST /api/update/apply` yang mematikan dirinya sendiri. → ADR-0087.
3. **Data produksi VPS dibawa ikut.** `hanoman migrate-from-postgres` memindahkan
   `hanoman_prod` (Postgres) ke SQLite; akun rekan & tiket nyata tidak dibuang.

## Kelayakan SQLite — terukur, bukan asumsi

| Hambatan potensial | Temuan di repo ini |
|---|---|
| Raw SQL | **nol** `$queryRaw`/`$executeRaw` di `server/src` |
| Tipe native `@db.*` | **nol** |
| Scalar list (`String[]`) — tak didukung SQLite | **nol** (semua `X[]` adalah relasi) |
| `Decimal` / `Bytes` | **nol** |
| `@map`/`@@map` | **nol** → nama kolom DB = nama field Prisma (dipakai tool migrasi) |
| `Json` | **14 kolom** → butuh Prisma **≥ 6.2** (SQLite+Json); repo di **5.18** |
| `mode: "insensitive"` | **4 pemakaian**, semua di `services/session-history.ts` |

Dua hambatan nyata itulah kerjanya: naikkan Prisma ke **6.19.x** (bukan 7 — Prisma 7 mewajibkan
driver adapter) dan buang `mode: "insensitive"`. SQLite `LIKE` sudah case-insensitive untuk ASCII,
jadi perilaku pencarian riwayat sesi tetap sama untuk input ASCII; itu satu-satunya regresi
semantik dan diterima sadar.

Efek samping yang menguntungkan: DB test menjadi **berkas per checkout**, sehingga dua kelas gagal
palsu yang selama ini menghantui repo (worktree tetangga men-truncate `hanoman_test`; `hanoman_test`
butuh `migrate deploy` sendiri) hilang di akarnya.

## Arsitektur

```
npm i -g hanoman
        │
        ▼
hanoman                      ← bin/hanoman.mjs → dist/cli.js
  ├─ resolveHome()           ~/.hanoman  (HANOMAN_HOME)
  ├─ resolveDbUrl()          file:~/.hanoman/hanoman.db
  ├─ prisma migrate deploy   --schema <pkg>/prisma/schema.prisma
  └─ spawn(node dist/server.js)
                             ├─ Fastify 127.0.0.1:8787
                             ├─ @prisma/client → SQLite (nol proses eksternal)
                             └─ @fastify/static → <pkg>/web  (HANOMAN_WEB_DIR)
```

### Unit yang dibuat (semuanya murni & bertest, dipisah dari I/O)

| Unit | Tanggung jawab | Dipakai |
|---|---|---|
| `server/src/db-url.ts` `resolveDbUrl()` | `DATABASE_URL` → URL `file:` absolut; unset → `<home>/hanoman.db`; `postgresql://` → **melempar** dengan petunjuk `hanoman migrate-from-postgres` | `db.ts`, CLI, vitest config |
| `shared/src/home.ts` `resolveHome()` | `HANOMAN_HOME` ?? `~/.hanoman` | server + CLI |
| `server/src/web-dir.ts` `pickWebDir()` | kandidat pertama yang ada: `HANOMAN_WEB_DIR` → `<dist>/../web` → `<dist>/../../src/dist` | `app.ts` |
| `shared/src/semver.ts` `compareSemver()` | banding semver tanpa dependency | `services/update.ts`, CLI `update` |
| `cli/src/release/manifest.ts` | `packageJsonFor()` + daftar artefak wajib | `scripts/pack-npm.mjs`, test |
| `cli/src/commands/migrate-pg.ts` `PG_ORDER` + `coerceRow()` | urutan FK 26 model + koersi nilai PG→SQLite | `hanoman migrate-from-postgres` |

`resolveDbUrl` memakai **aturan Prisma** untuk path relatif (relatif terhadap direktori
`schema.prisma`, bukan cwd) supaya `@prisma/client` runtime dan `prisma` CLI tak pernah menunjuk
dua berkas berbeda — sumber bug senyap paling mahal di skema ini.

### Perintah CLI

```
hanoman [start]                      boot: migrate deploy → server; --port --host --db --no-migrate
hanoman doctor                       node/git/tmux/agen CLI/izin tulis home/aset web  (exit 1 bila wajib absen)
hanoman update [--check]             banding versi vs registry; jalankan `npm i -g hanoman@latest`
hanoman migrate-from-postgres --from <url> [--to <file>] [--dry-run] [--force]
hanoman docs scan|index|link         (tidak berubah)
hanoman --version | --help
```

`hanoman` tanpa argumen = `hanoman start` (dulu mencetak help). Help tetap di `--help`.

### Paket npm

`scripts/pack-npm.mjs` merakit `dist-npm/` — **staging terpisah**, workspace tak dipublikasikan:

```
dist-npm/
  package.json      name "hanoman", bin, dependencies = 7 external esbuild + prisma + pg
  bin/hanoman.mjs   shebang → import("../dist/cli.js")
  dist/cli.js       dist/server.js  dist/build-info.json
  web/              hasil build SPA (src/dist)
  prisma/           schema.prisma + migrations/**
  README.md
```

Versi = `version` di root `package.json` (sumber tunggal, mulai `0.1.0`), ikut ditanam ke
`build-info.json` oleh `scripts/stamp-build.mjs`. `pnpm release` = build + pack + `npm pack --dry-run`.
**Publish tetap tindakan manusia** — script tidak pernah memanggil `npm publish`.

`prisma` (CLI) ikut jadi dependency runtime supaya `migrate deploy` tersedia di instalasi global;
itu harga ±40 MB yang diterima sadar sebagai ganti mengarang runner migrasi sendiri.

### Deteksi update

`services/update.ts` berhenti membaca git. Bentuk `UpdateStatus` menjadi berbasis semver:

```ts
type UpdateStatus = {
  currentVersion: string;                      // build-info.json → package.json
  latestVersion: string | null;                // registry npm, null bila offline/opt-out
  registry: { status: "ok" | "unavailable"; checkedAt: string | null };
  updateAvailable: boolean;                    // compareSemver(latest, current) > 0
  command: string;                             // "npm i -g hanoman@latest"
};
```

Jaringan tetap **hanya** di satu tempat dan tetap digerbangi knob `HANOMAN_UPDATE_FETCH` yang sudah
ada (test memaksa `0` → nol jaringan), TTL 5 menit, gagal → `unavailable` (fail-safe, tak pernah
melempar). Panel `UpdatePanel` menampilkan versi jalan vs terbaru + perintah untuk disalin.

### Tool migrasi Postgres → SQLite

`hanoman migrate-from-postgres --from postgresql://…` membaca tiap tabel dengan `SELECT *` lewat
`pg`, lalu menulis ke SQLite lewat `@prisma/client` `createMany` berkelompok, **dalam urutan FK**.
Karena skema tak memakai `@map`, baris PG langsung cocok sebagai data Prisma; hanya `Json` &
`DateTime` yang butuh koersi. `--dry-run` mencetak jumlah per tabel tanpa menulis. Target
non-kosong ditolak kecuali `--force` (yang menghapus dalam urutan terbalik lebih dulu).

Invarian yang dijaga test, bukan komentar: `PG_ORDER` diverifikasi terhadap **DMMF Prisma** —
setiap model harus ada tepat sekali, dan setiap model harus muncul **sesudah** semua model yang
di-refer relasi wajibnya. Menambah model baru tanpa memperbarui urutan → test merah.

## Yang TIDAK dikerjakan

- Tidak ada `POST /api/update/apply` / self-mutation (ADR-0048 tetap read-only).
- Tidak ada publish ke npm dari sesi ini.
- Tidak ada dukungan Postgres yang dipertahankan berdampingan; `postgresql://` melempar dengan
  petunjuk migrasi.
- Tidak ada perubahan pada mesin sesi (`pty.ts`), agen, goal mode, sync, atau UI selain panel update.
- `hanoman` tetap butuh `git`, `tmux`, dan CLI agen (`claude`/`codex`) di PATH — itu memang inti
  produknya, dan `hanoman doctor` melaporkannya alih-alih menyembunyikannya.

## Risiko

| Risiko | Mitigasi |
|---|---|
| Prisma 6 membawa breaking change tak terduga | tak ada `Bytes`/full-text/implicit m-n di skema; typecheck + test server yang tersentuh |
| Cutover mematahkan sesi lain yang berbagi Postgres | perubahan hanya di worktree ini; dampak nyata muncul saat merge → runbook di `deploy-vps.md` |
| Data prod VPS hilang | `migrate-from-postgres` + `--dry-run` wajib dulu; runbook menyuruh `pg_dump` sebelum apa pun |
| Paket npm besar (±100 MB terpasang) | disebut apa adanya di README; alternatif embedded-postgres justru lebih besar |
| Nama `hanoman` di npm | diverifikasi 404 (bebas) per 2026-07-30 |
