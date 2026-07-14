# SPEC-211 · VPS Test Connection & Open Console — Design

**Backlog:** SPEC-211 · prioritas tinggi · sumber brief
**Objective:** perlu ada *test connection* dan *open console*; open console = buka ssh ke server menggunakan tmux.
**Konteks:** modul VPS saat ini baru punya audit & harden (SPEC-164/165), plus "Sesi Claude" (`POST /vps/:id/session`) yang men-spawn `claude` di dalam tmux hanoman berkonteks VPS.

## Keputusan manusia (terkunci)

"Open console menggunakan tmux" → **tmux hanoman (lokal)** yang meng-host klien `ssh`, bukan tmux di remote VPS. Alasan: reuse penuh infra sesi (ADR-0016), tanpa dependency `tmux` terpasang di VPS, dan konsisten dengan "Sesi Claude". Persistensi = selama koneksi ssh hidup di pane tmux hanoman (selamat dari refresh browser & restart API). Dicatat di ADR-0042.

## Scope

Dua aksi per-VPS baru, keduanya reuse infra yang sudah ada. **Tanpa perubahan skema, tanpa dependency baru.**

### 1. Test Connection
- `POST /vps/:id/test` → `sshExec(v, "true", { timeoutMs: 15000 })` → `{ ok: code===0, out }`.
  - Jalur key-based `BatchMode=yes` yang sama dengan audit/harden. Tak menyentuh DB, tak mengubah state — sekadar "apakah ssh key-only berhasil sekarang".
  - 404 bila VPS tak ada. Selalu 200 dengan `ok` boolean (gagal koneksi ≠ error HTTP; `out` bawa transcript ssh untuk diagnosa).
- UI: tombol **Test** (lucide `plug-zap`) per baris VPS → toast `ok`/`gagal` + potongan `out`.

### 2. Open Console
- `POST /vps/:id/console` → spawn `ssh -t -p <port> [-i <keyPath>] <user>@<host>` sebagai **shell mentah di dalam tmux hanoman**, balas `{ id }`. UI pindah ke layar Terminal (`onGotoTerminal`), persis pola "Sesi Claude".
- Mekanisme: tambah `command?: string[]` ke `CreateOpts` di `server/src/services/pty.ts`. Bila diisi, perintah tmux = `command.map(sq).join(" ")` — **bukan** argv claude; tanpa `--dangerously-skip-permissions`, tanpa `--settings`. Sisanya (`remain-on-exit`, `attach`, streaming WS, scrollback, resize, kill) tak berubah, dipakai apa adanya.
- Id sesi deterministik `vpsc-<id>` → tekan **Console** dua kali menyambung, bukan menumpuk sesi ssh.
- `-t` memaksa alokasi tty remote (walau di dalam tmux ada tty, `-t` menjamin shell interaktif). Saat user `exit`, `remain-on-exit on` menahan pane mati → reattach memutar ulang layar lalu tutup (pola sesi berakhir).
- host/user/port sudah divalidasi zod (`HOST_RE`/`USER_RE`/int) di `zCreateVps` — trust boundary; `keyPath` path milik server. Tiap argv di-`sq()` (single-quote) sebelum diserahkan ke shell tmux.
- UI: tombol **Console** (lucide `terminal-square`), beda dari ikon `terminal` "Sesi Claude".

## Trust boundary

Tak berubah. Kedua route di bawah bind `127.0.0.1` yang sama yang sudah menggerbang `/vps/*` & `/terminal/*` (tanpa auth per-route). Console = shell root/sudo mentah di VPS lewat key server — kuasa yang sama yang sudah diberi `/vps/:id/session` & `/harden`.

## File yang tersentuh

| File | Perubahan |
|---|---|
| `server/src/services/pty.ts` | `CreateOpts.command?: string[]`; cabang cmd bila command diisi |
| `server/src/routes/vps.ts` | `POST /vps/:id/test`, `POST /vps/:id/console` |
| `shared/src/api.ts` | `vpsTest`, `vpsConsole` paths |
| `src/src/api/client.ts` | `testVps`, `vpsConsole` methods |
| `src/src/screens/VpsScreen.tsx` | tombol Test + Console |
| `internal/docs/architecture/api-contract.md` | 2 route baru di seksi VPS |
| `internal/docs/frontend/frontend-implementation.md` | catatan tombol Test/Console |
| `internal/docs/requirements/frd.md` + `prd.md` | seksi VPS: test connection + console |
| `internal/docs/adr/0042-vps-console-ssh-tmux-lokal.md` | ADR baru (keputusan lokal-tmux) |

## Test

- `server/test/vps.route.test.ts` (atau berkas VPS route yang ada): `/test` ok & gagal (fixture `HANOMAN_SSH_BIN`), `/console` balas `{ id }` & bikin sesi tmux (fixture `HANOMAN_CLAUDE_BIN`/`HANOMAN_TMUX_SOCKET`), 404.
- `server/test/pty.test.ts` (bila ada): `command` opt men-spawn perintah non-claude.

## Skipped (YAGNI)

- Persistensi tmux di remote VPS — add bila diminta.
- Label/badge sesi console di daftar Terminal — muncul sebagai sesi biasa sudah cukup.
- Test connection memperbarui pill `reachable` — test = cek transien bertoast, bukan state.
