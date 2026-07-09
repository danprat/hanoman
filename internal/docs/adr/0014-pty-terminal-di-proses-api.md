# ADR-0014 — Sesi Claude Code interaktif lewat PTY di proses API

**Status:** accepted · 2026-07-09 · siklus hidup sesinya diperbarui [ADR-0016](0016-sesi-terminal-hidup-di-tmux.md)

## Konteks
Runner menjalankan claude non-interaktif (`-p --output-format stream-json`) untuk run
terjadwal. Tidak ada cara memakai Claude Code secara interaktif pada sebuah project
tanpa membuka terminal dan `cd` sendiri, padahal hanoman sudah tahu `repoDir` tiap project.

## Keputusan
`node-pty` men-spawn `claude --dangerously-skip-permissions` di TTY sungguhan, di dalam
**proses server API**, bukan worker. Byte PTY dialirkan apa adanya ke `xterm.js` lewat
WebSocket di `/api/terminal/sessions/:id/ws`.

> ADR-0016 memindahkan claude ke dalam tmux: node-pty sekarang memegang klien
> `tmux attach-session`, sesi tidak lagi disimpan in-memory, dan **restart server tidak lagi
> menghapus sesi**. Sisa keputusan di bawah tetap berlaku.

Sesi berjalan di `Project.repoDir` — working tree utama. Larangan "jangan jalankan run di
working tree utama" berlaku untuk run yang di-orchestrate hanoman, bukan untuk pekerjaan
manual yang dipicu manusia, yang setara dengan membuka terminal sendiri.

## Konsekuensi
- Endpoint ini adalah remote code execution secara desain. `server.ts` karena itu bind ke
  `127.0.0.1` secara default; `HOST=0.0.0.0` sekarang menjadi keputusan sadar, dan menuntut
  autentikasi di depannya lebih dulu. Perubahan ini sekalian menutup `/api/fs/browse`, yang
  sudah lebih dulu mengekspos seluruh filesystem mesin.
- PTY hidup di proses API, jadi API tidak lagi stateless. Menjalankan dua instance API di
  belakang load balancer akan memecah sesi. Belum jadi masalah: hanoman single-process.
- `node-pty` mem-publish `spawn-helper` tanpa exec bit, dan `install` script-nya diblokir
  pnpm secara default. Karena itu `pnpm-workspace.yaml` memuat `allowBuilds: node-pty: true`,
  dan `server/package.json` memuat `postinstall` yang meng-`chmod +x` helper tersebut.
  `createSession` menerjemahkan `posix_spawnp failed` menjadi pesan yang menyebut obatnya,
  karena `pnpm install` melewati `postinstall` bila tree sudah up-to-date.
- Dua sesi pada `repoDir` yang sama bisa saling menimpa file. Itu sifat membuka dua terminal
  di folder yang sama; tidak dicegah.

## Ditolak
- **`script -q /dev/null claude`** untuk menghindari native module: flag berbeda antar OS,
  dan tanpa SIGWINCH resize tidak sampai ke claude sehingga TUI-nya rusak.
- **`ttyd` di dalam iframe**: nol kode server, tapi menambah daemon dan port kedua, dan
  sesinya tak terlihat oleh API hanoman.
