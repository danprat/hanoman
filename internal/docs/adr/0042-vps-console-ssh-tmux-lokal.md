# ADR-0042 — Open Console = ssh mentah di tmux hanoman lokal (bukan tmux remote)

Status: diterima · SPEC-211 · 2026-07-14

## Konteks
Modul VPS butuh "Open Console": buka shell ssh ke server. Dua bentuk mungkin —
(a) `ssh user@host` di-host tmux hanoman lokal, atau (b) `ssh -t … tmux new -A` yang
menyerahkan sesi ke tmux DI remote VPS.

## Keputusan
Pakai (a). `POST /vps/:id/console` men-spawn `ssh -t -p … [-i key] user@host` lewat
`createSession({ command })` — cabang di `pty.ts` yang melewati argv claude sepenuhnya
(tanpa `--dangerously-skip-permissions`/`--settings`). Sesi hidup di pane tmux hanoman
(ADR-0016), reattach lewat WS terminal yang sama. id sesi deterministik `vpsc-<id>` —
tekan Console dua kali menyambung, bukan menumpuk sesi ssh.

## Alasan
- Reuse penuh infra sesi (attach/scrollback/WS/kill) — nyaris nol kode baru.
- Tanpa dependency `tmux` terpasang di VPS (opsi b gagal di VPS minimal).
- Konsisten dengan "Sesi Claude" (`/vps/:id/session`) yang sudah ada.
- Persistensi cukup: sesi selamat dari refresh browser & restart API.

## Konsekuensi
- Bila koneksi ssh putus (jaringan), shell remote mati — tak ada tmux remote yang
  menahannya. Bila kelak butuh, tambah opsi `tmux new -A` di sisi remote (perlu tmux di VPS).
- Console = shell root/sudo mentah lewat key server; trust boundary sama dengan
  `/vps/:id/session` & `/harden` (bind 127.0.0.1, tanpa auth per-route).

## Test connection
Bagian yang sama (SPEC-211): `POST /vps/:id/test` = `sshExec(v,"true")`, cek key-only
berhasil sekarang; transien, tak menyentuh DB. `200 { ok, out }` — gagal koneksi bukan
error HTTP supaya UI bisa menampilkan transcript ssh.
