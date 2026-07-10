# Frontend implementation

- React + TypeScript (Vite). Komponen dari Hanoman Design System.
- Layout: sidebar 248px + topbar 56px; konten maks 1200px (Docs full-width).
- Bagian: Overview, Projects (list + pagination + cari + hapus project per baris) → **detail project** (identitas, coverage, edit `name`/`desc` lewat `PATCH /projects/:id`, dan tiga pintu: docs, runs, backlog). `id` tak pernah dapat diubah — ia kunci asing spec/run/trigger (SPEC-146). Hapus project ada di detail dan di header Docs — konfirmasi dulu, ditolak bila ada run aktif; rename tidak ditolak, karena `id` tak bergerak, Backlog (filter project + tab + tiga mode tampilan grid/list/board + aksi per spec + detail spec via modal: judul, stage bar, objective, field brief/QA), Runs (filter project + list + detail: pipeline, worktree, kendali, terminal), Terminal (sesi Claude Code interaktif), Docs (tree realtime semua `.md` di repo via `GET /docs`, dikelompokkan per direktori; kategori di luar `docsDir` masuk grup **Lainnya (tidak dinilai)** tanpa status linked — hanya kategori berskor yang masuk coverage, lihat ADR-0013; tombol **Muat ulang** membaca ulang tree, **Hapus** menghapus file asli, path ditampilkan repo-relative tanpa prefix `internal/docs`), Triggers (toggle + hapus per baris, konfirmasi dulu), Settings (model per step).
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

## Tinggi & scrolling: rantai flex, bukan angka ajaib
`#root` dikunci `100vh; overflow: hidden`, jadi tinggi yang tersedia sudah pasti sejak akar.
Layar berdaftar tidak boleh menggulir seluruh halaman — filter bar dan Pager harus tetap
terlihat — jadi yang menggulir hanyalah area barisnya.

`LIST_SCROLL_STYLE` dulu `maxHeight: calc(100vh - 340px)`. `340` adalah tebakan tinggi
topbar + chrome card + pager, dan tebakan itu salah di tiap layar dengan takaran berbeda:
layar dengan filter bar lebih tinggi menyisakan lubang kosong di bawah, yang lebih pendek
memotong daftarnya. Angka itu juga tak punya cara untuk tetap sinkron saat chrome berubah.

Sekarang tingginya diturunkan rantai flex, tanpa angka:

| style | dipakai di | arti |
|---|---|---|
| `LIST_SCREEN_STYLE` | root layar | kolom flex, `flex:1 1 auto`, `min-height:0` |
| `FIXED_ROW_STYLE` | filter bar, header, legend, `Pager` | `flex:0 0 auto` — tak ikut menyusut |
| `LIST_SCROLL_STYLE` | area baris | `flex:1 1 auto`, `min-height:0`, `overflow-y:auto` |

`min-height: 0` itu kuncinya: tanpa ia, flex item menolak lebih pendek dari min-content-nya,
jadi daftar panjang mendorong Pager keluar layar alih-alih menggulir. `FIXED_ROW_STYLE` juga
bukan hiasan — default flex item adalah `flex-shrink: 1`, jadi header dan kartu **ikut
gepeng** kalau tidak dikunci.

Shell menyediakan ujung atas rantainya: pembungkus konten di `<main>` kini `min-height: 100%`
+ `box-sizing: border-box` + kolom flex. `min-height` (bukan `height`) supaya layar non-daftar
— Overview, Docs, Settings — tetap tumbuh melewati viewport dan digulir `<main>` seperti dulu;
dengan `height`, anak-anaknya jadi flex item bertinggi tetap dan ikut menyusut. `border-box`
wajib, kalau tidak padding menambah tinggi di atas 100% dan melahirkan scrollbar kedua.

`Card` punya prop `fill` untuk kartu yang membungkus header + daftar + Pager
(Projects, Runs, Triggers): ia meneruskan rantai flex ke pembungkus anaknya. Tanpa `fill`,
`Card` berperilaku persis seperti sebelumnya. `RunsScreen` ikut berubah dari
`align-items: start` ke `stretch` — kedua kolomnya kini menggulir sendiri-sendiri.

## Backlog: tiga mode tampilan, dan board yang tidak boleh berbohong
`BacklogScreen` merender satu daftar spec dalam tiga bentuk — **grid** (default, kartu penuh
dengan stage bar), **list** (satu baris per spec), dan **board** (kanban). Grid dan list
dipaginasi lewat `usePaged`; board tidak, karena kolom yang terpotong halaman bukan board.

Ketiganya memakai rantai flex di atas. Board sedikit berbeda: barisnya menggulir **mendatar**
(`overflow-x:auto`, `overflow-y:hidden`) dan tiap **kolom** menggulir tegak sendiri, jadi judul
kolom tak pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. Kartu board
`flex: 0 0 auto` — tanpa itu kartu menyusut mengisi kolom alih-alih kolomnya menggulir.

Kolomnya: `Backlog · Brainstorm · Objective · Spec · Plan · Execute · Success · Failed`.
Hanya enam kolom tengah yang benar-benar `Spec.stage`. Tiga sisanya **turunan**, bukan field:

- **Backlog** — spec yang belum pernah punya run sama sekali. Spec yang stage-nya sudah maju
  tapi run-nya dihapus tetap tinggal di kolom stage-nya, tidak diklaim balik ke sini.
- **Success** — `stage === "done"`.
- **Failed** — run **terakhir** spec itu `failed`/`stopped`. Ini tidak bisa dibaca dari spec:
  `mirrorStage` monotonic-forward (ADR-0008), jadi run yang gagal meninggalkan spec diam di
  stage terakhir yang sempat tercapai. Karena itu `App` menurunkan `lastRunStatus`
  (`Map<specId, status run terakhir>`) dari array `runs` — `GET /runs` sudah `desc by id`,
  jadi kecocokan pertama per `specId` adalah yang terbaru.

Konsekuensinya untuk drag: **enam kolom stage tidak bisa menerima maupun melepas kartu**
(`draggable={false}`). `Spec.stage` milik runner (ADR-0008); UI yang menulisnya akan membuat
`executing`/`done` bisa dicapai tanpa run yang lewat guardrail Source of Truth — persis yang
ADR itu tutup. Hanya ada **satu** drop yang sah, dan ia bermuara ke `POST /runs`, bukan ke
`PATCH /specs`:

    Backlog ──drag──► Brainstorm   = mulai run

Kenapa cuma Brainstorm, padahal lima kolom kerja semuanya "mulai run"? Karena kontrak sebuah
kanban adalah **kartu mendarat di kolom tempat ia dijatuhkan**. Run selalu mulai dari awal
pipeline, jadi spec yang baru dijalankan berakhir di stage `brainstorming`. Menerima drop di
Execute berarti kartunya melompat empat kolom ke kiri sesaat setelah dilepas — UI menjanjikan
yang tak ia tepati. Menerimanya di kolom yang benar berarti server harus bisa memulai run dari
fase tertentu; itu belum ada, dan butuh ADR sendiri.

Spec gagal **tidak** diseret. Retry-nya lewat tombol di kartu, karena kartunya akan kembali ke
kolom stage-nya (mis. Plan), bukan ke kolom tempat ia dijatuhkan.

Aturannya dua fungsi murni terekspor, `specColumn()` dan `canDrop()`, diuji di
`src/test/backlog-board.test.tsx` — termasuk render test jsdom yang men-drag kartu sungguhan,
karena `from`/`to` yang tertukar lolos dari unit test aturannya sendiri.

Drag pakai HTML5 drag-and-drop native, tanpa dependency — dan ia mati total di keyboard maupun
layar sentuh. Karena itu **setiap kartu di ketiga mode, termasuk `BoardCard`, membawa
`SpecActions`** (Mulai / Buka run / Jalankan lagi). Drag adalah jalan pintas, bukan jalan satu-satunya.

Memulai run **tidak** memindahkan layar ke Runs — dulu `startRun` memanggil `setSection("runs")`,
yang membuang filter dan mode tampilan operator setiap kali satu spec dijalankan, dan mustahil
dipakai bersama board (menyeret satu kartu langsung melempar keluar dari board-nya). Yang menandai
run sudah jalan adalah kartunya sendiri: `setRuns(await api.listRuns())` menyegarkan `activeRunSpecs`,
tombolnya berubah jadi **Buka run**, dan toast menyebut `runId`-nya. Hanya **Buka run** yang
menavigasi.

## Terminal (sesi Claude Code interaktif)
`TerminalScreen` menampilkan sesi dalam **grid `rows × cols`** (CSS Grid): `+ Kolom` menambah
kolom (kiri↔kanan), `+ Baris` menambah baris (atas↔bawah); tiap kolom dan baris punya `×` di gutter
untuk menutupnya (grid tak boleh menyusut di bawah 1×1). Menutup kolom/baris **tidak** mematikan
sesi — selnya lenyap dan sesinya jatuh ke tray, karena itu tak ada konfirmasi. Tiap sel me-mount satu `TerminalPane`
yang membuka WebSocket ke `/api/terminal/sessions/:id/ws`; sel kosong menampilkan picker sesi yang
belum tertempat, dan sesi yang belum di grid duduk di **tray**. Satu sesi menempati **paling banyak
satu sel** (menjaga resize tmux tak berkedip). Dua aksi per sel: **Lepas** (unbind, sesi tetap
hidup) dan **Tutup/`×`** (kill lewat `DELETE`).

Grid-grid itu dikelompokkan ke **grup** bernama yang dipindah lewat tabbar (`+` menambah, `✎`
mengganti nama, `×` menghapus; grup terakhir tak bisa dihapus). Tiap grup memegang `Layout`-nya
sendiri, dan satu sesi menempati paling banyak satu sel **di satu grup** — tray karena itu global,
berisi sesi yang tak punya sel di grup mana pun. Grup non-aktif tidak dirender, jadi pindah tab
menutup lalu membuka ulang WebSocket sesi di grup tujuan; scrollback dipegang tmux, bukan buffer
xterm. State `{groups, active}` disimpan di `localStorage` (`hanoman.terminal.workspace`) dan
memigrasikan key lama `hanoman.terminal.layout` menjadi satu grup "Utama" saat pertama dibaca.
Logika grup murni ada di `screens/terminal-workspace.ts` (SPEC-161).

Layout (`{rows,cols,cells}`) tiap grup disimpan di
`localStorage` dan **direkonsiliasi** ke `listSessions()` saat mount — sesi hidup di tmux dan
selamat dari restart server (ADR-0016), jadi sel yang sesinya masih hidup tersambung ulang dan sel
yang sesinya sudah di-kill dikosongkan. Logika grid murni ada di `screens/terminal-layout.ts`
(teruji tanpa DOM). Ini bukan chat buatan sendiri — yang dirender adalah TUI Claude Code asli, byte
demi byte. Terminal di `RunsScreen` adalah hal yang berbeda: interpreter perintah
(`status`/`plan`/`steer`) untuk run terjadwal, bukan TTY. Nol perubahan server: route dan `pty.ts`
dipakai apa adanya (SPEC-158).

Proxy dev Vite harus memakai `ws: true`, kalau tidak upgrade WebSocket dijawab 404.

## Live run view (SPEC-008)
`RunsScreen` berlangganan `GET /runs/:id/log` (SSE) untuk run running/paused via
`subscribeRun`; event live (`log`/`phase`/`status`/`cost`/`file`) digabung lewat reducer
murni `reduceRunEvent`. Panel kontrol menggerakkan `POST /runs/:id/command` (teks bebas →
steer) dan `/control` (pause/resume/stop/retry). Durasi dihitung `(finishedAt ?? now) − createdAt`
(ADR-0007), tick tiap detik selama run berjalan.

Run `failed` merender `RunRetry` alih-alih `RunControls`: satu tombol yang memanggil
`/control` action `retry` — re-enqueue runId yang sama, melanjutkan sesi claude yang sama
via `sessionId` tersimpan (ADR-0017), bukan input steer + pause/stop (tidak ada proses hidup
untuk run yang sudah terminal). SPEC-149.

`StatusPill` (`ds/components/feedback.tsx`) memetakan **setiap** status `Run` di data-model
(`queued | running | paused | stopped | failed | done`). Status yang tidak ada di peta jatuh
ke fallback `idle` ("Idle", abu-abu) — jadi `paused` dan `stopped` sempat tampil sebagai
"Idle" meski `paused` punya tombol Resume dan poll `isRunActive` menganggapnya aktif. Setiap
status baru di `Run.status` wajib ditambah ke peta ini, kalau tidak pill-nya diam-diam bohong.

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

Favicon adalah **aset statis**, bukan komponen: `src/public/favicon.svg` (SPEC-147). Vite root
adalah `src/`, jadi `publicDir` default-nya `src/public/` — dev menyajikannya di `/favicon.svg`,
`vite build` menyalinnya ke `src/dist/`, dan di produksi `fastifyStatic` (`server/src/app.ts:51-52`)
menyajikannya dari root. Server tidak tahu-menahu. Bentuknya mengikuti `IconTile` design system —
mark `buntut` putih di atas tile `--brass-500` ber-radius 24% — tapi hex-nya ditulis **literal**,
karena dokumen `.svg` yang dimuat sebagai favicon tak mewarisi CSS custom property halaman. Atribut
`d`-nya di-**bake** sekali dari `taperedSpiralPath()` (`src/src/ds/marks.tsx`), yang menghitung
spiralnya saat runtime dan tak pernah menyimpannya sebagai string; berkas `.svg` itu tidak diedit
tangan. Tak ada `favicon.ico`: Safari 26+ sudah mendukung favicon SVG, dan bila suatu saat browser
lawas perlu didukung, `.ico` cukup dijatuhkan ke `src/public/` **tanpa perubahan markup** — browser
me-request `/favicon.ico` dari root dengan sendirinya.
