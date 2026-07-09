# Frontend implementation

- React + TypeScript (Vite). Komponen dari Hanoman Design System.
- Layout: sidebar 248px + topbar 56px; konten maks 1200px (Docs full-width).
- Bagian: Overview, Projects (list + pagination + cari + hapus project per baris) → **detail project** (identitas, coverage, edit `name`/`desc` lewat `PATCH /projects/:id`, dan tiga pintu: docs, runs, backlog). `id` tak pernah dapat diubah — ia kunci asing spec/run/trigger (SPEC-146). Hapus project ada di detail dan di header Docs — konfirmasi dulu, ditolak bila ada run aktif; rename tidak ditolak, karena `id` tak bergerak, Backlog (filter project + tab + aksi per spec + detail spec via modal: judul, stage bar, objective, field brief/QA), Runs (filter project + list + detail: pipeline, worktree, kendali, terminal), Terminal (sesi Claude Code interaktif), Docs (tree realtime semua `.md` di repo via `GET /docs`, dikelompokkan per direktori; kategori di luar `docsDir` masuk grup **Lainnya (tidak dinilai)** tanpa status linked — hanya kategori berskor yang masuk coverage, lihat ADR-0013; tombol **Muat ulang** membaca ulang tree, **Hapus** menghapus file asli, path ditampilkan repo-relative tanpa prefix `internal/docs`), Triggers (toggle + hapus per baris, konfirmasi dulu), Settings (model per step).
- Filter project di Backlog dan Runs dibaca dari satu state `projectFilter` milik `App`, bukan
  state lokal tiap layar (SPEC-146) — detail project memakainya untuk membuka kedua layar dalam
  keadaan sudah tersaring.
- Realtime: konsumsi SSE `/runs/:id/log` untuk log & status; optimistic UI untuk kontrol.
- Biaya ditampilkan sebagai **estimasi** (`~$0.03`), bukan tagihan, dan tidak menggerakkan
  apa pun (ADR-0012): run memakai auth OAuth subscription, jadi `total_cost_usd` dari claude
  adalah jumlah yang *akan* dibayar pengguna API key. Format dan parse-nya dipusatkan di
  `fmtEstCost`/`parseEstCost` (`@hanoman/shared`). Settings tidak lagi punya field anggaran
  harian; kartu "Run" hanya berisi konkuren maks dan notifikasi gagal.
- Markdown render: pustaka marked; file non-.md dirender sebagai blok kode.
- State ringan lewat React; persist preferensi (edit docs, settings) ke server (dan localStorage sebagai draft).
- **Loading / empty / error** dirender lewat satu komponen `StateBlock` (`ds/components/state.tsx`),
  jadi ketiganya tidak pernah terlihat sama. Fetch awal (`projects+specs+runs+triggers`) digerbangkan
  sekali di `App` untuk semua section kecuali Settings, yang memuat datanya sendiri. Error state selalu
  membawa aksi retry; empty state membawa call-to-action ke aksi yang relevan. Settings **tidak** lagi
  jatuh ke nilai default saat GET gagal — toggle berikutnya akan mem-PUT default itu menimpa server.

## Terminal (sesi Claude Code interaktif)
`TerminalScreen` menampilkan satu tab per sesi PTY; `TerminalPane` me-mount `xterm.js` dan
membuka WebSocket ke `/api/terminal/sessions/:id/ws`. Sesi hidup di **server**, bukan di
browser: hanya tab aktif yang memegang WebSocket, dan berpindah tab me-remount pane sehingga
server memutar ulang scrollback-nya. Tidak ada state terminal yang disimpan di frontend, jadi
reload halaman memulihkan semua sesi apa adanya. Ini bukan chat buatan sendiri — yang dirender
adalah TUI Claude Code asli, byte demi byte. Terminal di `RunsScreen` adalah hal yang berbeda:
interpreter perintah (`status`/`plan`/`steer`) untuk run terjadwal, bukan TTY.

Proxy dev Vite harus memakai `ws: true`, kalau tidak upgrade WebSocket dijawab 404.

## Live run view (SPEC-008)
`RunsScreen` berlangganan `GET /runs/:id/log` (SSE) untuk run running/paused via
`subscribeRun`; event live (`log`/`phase`/`status`/`cost`/`file`) digabung lewat reducer
murni `reduceRunEvent`. Panel kontrol menggerakkan `POST /runs/:id/command` (teks bebas →
steer) dan `/control` (pause/resume/stop). Durasi dihitung `(finishedAt ?? now) − createdAt`
(ADR-0007), tick tiap detik selama run berjalan.

Daftar run **tidak** berlangganan SSE — SSE hanya mengisi overlay panel detail lewat
`reduceRunEvent`, tak pernah menyentuh array `runs`. Yang menyegarkan daftar adalah poll
3 dtk di `App` (`listSpecs` + `listRuns`) selama ada run **aktif**, dan "aktif" berarti
`isRunActive(status)` — satu predikat di `@hanoman/shared` yang mencakup `queued`,
`running`, dan `paused` (SPEC-142). `queued` wajib ikut: setiap run lahir `queued`, jadi
gate yang melewatkannya membuat daftar membeku sampai refresh manual. Predikat yang sama
menentukan kartu backlog menampilkan **Buka run** alih-alih **Mulai**, baris run
menyembunyikan aksi hapus, dan baris project menampilkan label fase. Predikat "punya
proses hidup" (`running | paused`, untuk steer/pause/stop) sengaja berbeda dan tetap inline.

Overlay `live` di `RunsScreen` di-seed ulang saat **id atau status** run berubah, bukan id
saja. Poll membawa status baru dari DB, tapi overlay itu snapshot sekali per run: dengan
`[picked?.id]` saja, panel detail tertinggal di `queued` sementara baris daftar sudah
`running`. Redis pub/sub tak punya replay, jadi event `status: running` yang terbit sebelum
langganan SSE dibuka hilang selamanya — status berikutnya baru tiba saat run selesai. DB
adalah sumber kebenaran status; SSE hanya mempercepatnya.

`PhasePipeline` mengenal lima state fase. `skipped` (SPEC-145) adalah fase yang run **putuskan**
untuk tidak dijalankan — alur `qa` yang audit-nya memilih perbaikan langsung menandai Spec dan
Plan begitu. Ia dirender terisi `--bone-400` dengan ikon `minus` dan label redup, sengaja berbeda
dari `pending` (lingkaran kosong, "belum jalan"), dan konektor sesudahnya berwarna `--leaf-500`
karena alur memang lewat sana. `progress` mengeluarkan fase `skipped` dari penyebutnya, sehingga
run jalur cepat yang sukses tetap 100%.
