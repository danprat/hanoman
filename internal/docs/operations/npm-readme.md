# hanoman

Orchestrator + dashboard workflow docs-driven: ia menyuruh **Claude Code** atau **Codex** membangun
project terhadap dokumentasi sebagai kebenaran, lalu memantau semua sesi dalam satu dashboard.

## Pasang

```bash
npm i -g hanoman
hanoman doctor     # periksa prasyarat
hanoman            # jalan di http://127.0.0.1:8787
```

Buka URL-nya, buat akun pertama, selesai. Datanya di `~/.hanoman/` (SQLite — **tanpa Docker,
tanpa Postgres, tanpa Redis**).

## Prasyarat yang tidak dibawa npm

| Butuh | Untuk apa |
|---|---|
| `git` | tiap sesi jalan di git worktree terisolasi |
| `tmux` | sesi agen hidup di tmux, selamat dari restart server |
| `claude` **atau** `codex` | agen yang mengerjakan backlog |

`hanoman doctor` melaporkan mana yang belum ada, dan keluar dengan kode ≠ 0 bila ada yang wajib.

## Perintah

```
hanoman [start]                    jalankan (migrasi + server + dashboard)
  --port <n> --host <h> --db <file> --no-migrate
hanoman doctor                     periksa prasyarat
hanoman update [--check]           pasang versi terbaru dari npm
hanoman migrate-from-postgres --from <url> [--to <file>] [--dry-run] [--force]
hanoman docs scan | index | link   operasi index Source of Truth
```

## Update

```bash
hanoman update            # npm i -g hanoman@latest
```

Instance yang berjalan perlu di-restart sesudahnya (mis. `systemctl restart hanoman`). Dashboard
menampilkan badge saat versi baru terbit; ia **tidak** memasang apa pun sendiri — sesi agen yang
sedang berjalan tak boleh diputus oleh update yang tak diminta.

## Konfigurasi

| Env | Default | Untuk apa |
|---|---|---|
| `HANOMAN_HOME` | `~/.hanoman` | DB SQLite, key SSH, transkrip sesi |
| `HANOMAN_DATABASE_URL` | — | berkas DB khusus hanoman; hanya URL `file:` (nilai lain **melempar**) |
| `DATABASE_URL` | `file:$HANOMAN_HOME/hanoman.db` | dipakai bila ber-`file:`; nilai lain **diabaikan** dengan peringatan |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | alamat bind |
| `HANOMAN_CLAUDE_BIN` / `HANOMAN_CODEX_BIN` | `claude` / `codex` | biner agen |
| `HANOMAN_TMUX_SOCKET` | `hanoman` | socket tmux terpisah dari milikmu |

## Bind & TLS

Default `127.0.0.1:8787`. hanoman punya auth, tapi cookie sesinya `Secure` — set
`--host 0.0.0.0` **hanya** di belakang reverse proxy yang menerminasi TLS.

## Pindah dari Postgres

Instalasi hanoman lama memakai Postgres. Pindahkan sekali (backup dulu dengan `pg_dump`):

```bash
hanoman migrate-from-postgres --from "postgresql://user:pass@host:5432/hanoman" --dry-run
hanoman migrate-from-postgres --from "postgresql://user:pass@host:5432/hanoman"
```

`--dry-run` hanya menghitung baris per tabel tanpa menulis apa pun. Target yang sudah berisi data
ditolak kecuali `--force`.

> **Punya `DATABASE_URL` untuk project lain?** Tidak masalah — hanoman mengabaikan nilai non-`file:`
> dan tetap memakai `$HANOMAN_HOME/hanoman.db`, sambil mencetak peringatan sekali. Untuk menunjuk
> berkas DB tertentu tanpa menyentuh var itu, pakai `HANOMAN_DATABASE_URL=file:/path/hanoman.db`
> atau `hanoman --db /path/hanoman.db`.

## Kalau `hanoman` gagal menerapkan migrasi

**`P3005 — The database schema is not empty`** berarti berkas DB itu sudah punya tabel tapi tak
punya riwayat migrasi hanoman — biasanya bukan DB hanoman versi ini (sisa prototipe lama, atau
berkas tool lain yang kebetulan bernama sama). hanoman **tidak** mengubah isinya. Pindahkan berkas
itu lalu jalankan ulang, atau tunjuk berkas lain dengan `hanoman --db /path/baru.db`.

## Kalau terminal sesi terbuka tapi kosong

Sesi hanoman hidup di dalam **tmux**; layarnya dialirkan ke browser lewat node-pty. Dua sebab:

- **tmux belum terpasang** — `brew install tmux` (macOS) atau paket distro Anda.
- **`spawn-helper` node-pty tak executable** — node-pty menerbitkan biner pendampingnya dengan mode
  `0644`, jadi `posix_spawnp` gagal dan tak satu byte pun mengalir ke terminal walau sesinya hidup.
  Sejak `0.1.3` `hanoman` memperbaikinya sendiri saat start (sekali per instalasi). Bila instalasi
  global itu milik root dan hanoman dijalankan sebagai pengguna biasa, chmod-nya ditolak — perbaiki
  manual: `sudo chmod +x "$(npm root -g)"/hanoman/node_modules/node-pty/prebuilds/*/spawn-helper`.

## Lisensi

MIT — lihat `LICENSE`.
