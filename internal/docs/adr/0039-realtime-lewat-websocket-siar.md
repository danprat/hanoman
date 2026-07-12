# ADR-0039 — Data real-time dashboard lewat satu WebSocket siar, bukan polling klien

**Status:** aktif (SPEC-199). Menggeneralisasi pola siar `services/pty.ts` (ADR-0016).

## Konteks

Dashboard memantau data real-time lewat 5 poll `setInterval` di klien (board 3 s, daftar sesi
8 s, notifikasi 10 s, limits 60 s, VPS 30 s). Tiap tab browser × tiap poll = beban berulang;
yang paling sering adalah board `GET /specs` + `GET /terminal/sessions` tiap 3 detik. Tak ada
Redis/BullMQ/SSE/react-query di repo — satu-satunya WebSocket dipakai hanya untuk PTY terminal
per-sesi.

Sumber data real-time (pane tmux, berkas fase, marker keputusan) adalah **state eksternal
tanpa hook in-process** — tak ada mutasi yang bisa memancarkan event. Server sudah men-*poll*
mereka (loop 500 ms di `pty.ts`). Bus event murni tetap harus polling untuk sumber-sumber ini,
jadi ia menambah kcompleksitas tanpa menghapus poll.

## Keputusan

**Pindahkan polling dari klien ke server, fan-out lewat satu WebSocket siar global**
(`GET /api/events/ws`, hub `services/events.ts`). Satu loop server menggantikan N-klien × poll:

- Satu `Set<Client>` + satu loop interval ref-counted (hidup hanya saat ada klien), meniru
  `startPoll`/`broadcast` di `pty.ts`.
- Cadence per-grup + dedup signature: frame lahir hanya saat data berubah.
- Snapshot penuh dikirim saat connect/reconnect → state klien re-sync tanpa fetch terpisah.
- Kelima poll klien dihapus; consumer `subscribe` ke satu koneksi singleton (`api/events.ts`).
- Endpoint HTTP GET tetap ada untuk initial paint; hanya `setInterval` yang dicabut.

Ini generalisasi pola `pty.ts` yang sudah terbukti, **bukan** bus event / pub-sub baru.

## Konsekuensi

- **Update didorong, bukan ditarik**: board update saat sesi mulai tanpa perlu sesi sudah aktif;
  latensi real-time turun dari ≤3 s ke ≤1 s dengan beban server lebih kecil (satu loop, bukan
  N tab × 5 poll).
- **Channel kedua** di samping WebSocket PTY terminal — tujuan berbeda (feed dashboard global vs
  stdio PTY per-sesi), sengaja tak digabung.
- **Auth gratis**: upgrade WS lewat gate `onRequest` `/api` (cookie same-origin), sama seperti
  terminal WS.
- **Plafon**: hub tick 1 s selama ada klien walau tak ada sesi (`tmux list-panes` kosong murah).
  Bila beban jadi masalah, gate loop ke session-liveness. Sumber tetap poll-only — kalau kelak
  ada hook mutasi in-process, grup terkait bisa jadi event-driven tanpa mengubah kontrak WS.
