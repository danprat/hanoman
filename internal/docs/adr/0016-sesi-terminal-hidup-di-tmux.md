# ADR-0016 — Sesi terminal hidup di tmux, bukan di proses API

**Status:** accepted · 2026-07-09 · memperbarui [ADR-0014](0014-pty-terminal-di-proses-api.md)

## Konteks
ADR-0014 menyimpan PTY di dalam proses API. Konsekuensinya: **restart server menghapus
semua sesi**. Di dev, `tsx watch` me-restart API tiap kali file server disentuh — jadi
justru saat hanoman dipakai untuk mengubah hanoman, sesi claude yang sedang bekerja mati.
Sesi run (`claude --resume`, ADR-0015) yang mati di tengah jalan meninggalkan pekerjaan
setengah jadi di worktree-nya.

Refresh browser sendiri sebenarnya sudah selamat — daftar sesi datang dari API. Yang tidak
selamat adalah proses claude-nya, terhadap siklus hidup proses API.

## Keputusan
`claude` berjalan di dalam **tmux server**, di socket milik hanoman sendiri
(`tmux -L hanoman -f /dev/null`). Proses API hanya memegang **klien** `tmux attach-session`
di atas node-pty; byte-nya tetap mengalir apa adanya ke `xterm.js` lewat WebSocket.

- **tmux server adalah satu-satunya penyimpan state sesi.** Tidak ada map in-memory yang
  perlu dihidrasi ulang: `listSessions()` membaca `tmux list-panes -a`. Metadata
  (`projectId`, `runId`, `cwd`) disimpan sebagai user option `@hanoman_*` pada sesinya.
- **Menutup API melepas klien, tidak membunuh sesi** (`detachAll()`, bukan `killAll()`).
- **`remain-on-exit on`** menahan pane yang prosesnya sudah mati, jadi output terakhir sesi
  yang gagal masih bisa dibaca sampai pengguna menutup tabnya — perilaku ADR-0014, sekarang
  gratis dari tmux. Kode keluar aslinya dibaca dari `#{pane_dead_status}`.
- **Sesi run itu tunggal.** Namanya deterministik (`hanoman-run-<runId>`), jadi membuka
  tabnya lagi menyambung ke `claude --resume` yang sudah jalan, bukan menyalakan yang kedua
  di atas file sesi yang sama.
- **Prefix tmux dimatikan** dan status bar disembunyikan: tmux di sini adalah detail
  implementasi, bukan tmux yang dipakai pengguna. `C-b` harus sampai ke claude.
- **Mouse mode dinyalakan** (`mouse on`, SPEC-209): tmux mengaktifkan mouse-reporting di
  terminal klien, jadi wheel di `xterm.js` diteruskan ke tmux dan masuk copy-mode —
  pengguna bisa scroll atas/bawah menyusuri riwayat pane, yang selama ini terperangkap di
  tmux tanpa jalan keluar (lihat konsekuensi di bawah). `history-limit` dinaikkan ke 50000
  baris agar run panjang tak terpotong.

## Konsekuensi
- **tmux jadi prasyarat runtime** (`brew install tmux`). Bila hilang, `createSession`
  melempar pesan yang menyebut obatnya, bukan `ENOENT` telanjang.
- Socket terpisah (`-L hanoman`) menjaga `list-sessions`/`kill-server` hanoman tidak pernah
  melihat — apalagi membunuh — sesi tmux milik pengguna. Test memakai socket sendiri lewat
  `HANOMAN_TMUX_SOCKET`.
- tmux menyatukan sisa argv-nya jadi satu string lalu menyerahkannya ke shell. JSON
  `--settings` (ADR-0010) karena itu dikutip sendiri sebelum diserahkan; tanpa itu ia pecah
  di setiap spasi dan claude mati sebelum lahir.
- **Prompt awal lewat berkas, bukan inline di argv** (SPEC-223). Karena tmux menyatukan argv
  jadi SATU command dan membatasi panjangnya (~16KB), prompt besar menembusnya → `new-session`
  mati dengan `command too long` (dilaporkan sebagai `tmux set-option gagal` sebab set-option
  adalah args[0] invokasi gabungan). Ini menabrak scaffold/reverse yang memuat STANDAR DOCS
  (~7KB) begitu ide/objective ikut panjang. Prompt karena itu ditulis ke berkas (tmpdir) dan
  diserahkan lewat `"$(cat <file>)"`; shell meng-expand-nya saat sesi lahir, jadi command tmux
  tetap pendek sementara claude tetap menerima prompt penuh via ARG_MAX (≫16KB). Isi berkas tak
  dipindai ulang shell (hasil command-substitution dikutip ganda) → aman dari injeksi.
- **Kematian pane di-poll**, bukan di-hook: satu `tmux list-panes` per 500ms untuk semua
  sesi yang sedang ditonton. Klien tmux tetap hidup ketika pane-nya mati, jadi `pty.onExit`
  bukan sinyal akhir sesi. Naikkan ke hook `pane-died` + `wait-for` kalau terminal yang
  terbuka bersamaan pernah sampai puluhan.
- Sesi yang selamat dari restart API mewarisi environment **tmux server**, yaitu env proses
  yang pertama menyalakannya. Mengubah `.env` menuntut `tmux -L hanoman kill-server`.
- Riwayat di atas layar tidak ikut pindah saat browser refresh: klien baru digambar ulang
  oleh tmux sebatas layar yang terlihat. Scrollback in-memory hanya melayani klien kedua
  pada attachment yang sama. **Riwayat itu tetap ada di scrollback pane tmux** — sejak
  SPEC-209 `mouse on` membuatnya bisa di-scroll dari browser (wheel → copy-mode), bukan
  cuma lewat `capture-pane` saat pane mati.
- ADR-0014 tetap berlaku untuk sisanya: endpoint ini RCE secara desain, `server.ts` bind ke
  `127.0.0.1`, dan `node-pty` masih butuh exec bit di `spawn-helper`.

## Ditolak
- **Menyimpan session id di localStorage** supaya refresh menyambung ulang: mengobati gejala
  yang salah. Refresh sudah selamat; yang mati adalah claude, oleh restart API.
- **`dtach`/`abduco`**: lebih kecil dari tmux, tapi satu dependensi lagi yang harus dipasang
  orang, tanpa `capture-pane`, user option, dan `remain-on-exit` yang di sini justru terpakai.
- **Menjalankan claude sebagai daemon lepas (`detached: true`)**: proses selamat, tapi TTY-nya
  tidak — tanpa TTY, TUI claude tidak bisa disambung ulang oleh siapa pun.
