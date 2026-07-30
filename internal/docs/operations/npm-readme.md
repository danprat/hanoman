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
| `DATABASE_URL` | `file:$HANOMAN_HOME/hanoman.db` | hanya URL `file:` (SQLite) |
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
