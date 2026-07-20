# Frontend implementation

- React + TypeScript (Vite). Komponen dari Hanoman Design System.
- Layout: sidebar 248px + topbar 56px; konten maks 1200px (Docs full-width).
- Bagian: Overview, Projects (list + pagination + cari + hapus project per baris) → **detail project** (identitas, coverage, edit `name`/`desc` lewat `PATCH /projects/:id`, dan pintu: Source of Truth, Terminal, Backlog, Reverse docs). `id` tak pernah dapat diubah — ia kunci asing spec (SPEC-146). Hapus project ada di detail dan di header Docs — konfirmasi dulu, ditolak bila ada sesi tmux aktif; rename tidak ditolak, karena `id` tak bergerak. **PRD** (SPEC-210 · ADR-0041 — layar nav sebelum Backlog, **two-pane**: sidebar kiri daftar dokumen PRD yang bisa diklik + pane kanan preview `MarkdownView` inline. Filter project punya opsi **"Semua project"** → `GET /prds` lintas-project (item dikelompokkan per project); satu project terpilih → `GET /projects/:id/prds`; keduanya freshest-wins. **PRD baru** membuka sesi `flow:"prd"` project-level; project target dipilih **di dalam modal** (field `Select` project, default ikut filter aktif atau project pertama saat "Semua project") — tombol selalu aktif, tak perlu memfilter daftar dulu (SPEC-212); **Take ke backlog** membuka `NewSpecModal` ter-prefill dengan tautan PRD di teks Konteks, ke project asal PRD), Backlog (cari teks + filter project/stage/prioritas + tab sumber + tiga mode tampilan grid/list/board + aksi per spec + detail spec via modal: judul, stage bar, objective, field brief/QA), Terminal (sesi Claude Code interaktif di tmux), Docs (tree realtime semua `.md` di repo via `GET /docs`, dikelompokkan per direktori; kategori di luar `docsDir` masuk grup **Lainnya (tidak dinilai)** tanpa status linked — hanya kategori berskor yang masuk coverage, lihat ADR-0013; tombol **Muat ulang** membaca ulang tree, **Hapus** menghapus file asli, path ditampilkan repo-relative tanpa prefix `internal/docs`), VPS (daftar + audit/harden + Test connection + Open Console shell ssh + buka sesi Claude, SPEC-211; **klik baris membuka satu modal** berisi detail VPS — last audit + health disk/mem/load — menyatu dengan checklist kepatuhan 232 item, SPEC-220/221; tak ada lagi side panel terpisah), Settings (model & effort sesi — default global **plus matrix model+effort per fase** per flow, SPEC-238/ADR-0058; notifikasi, akun, users).
- Filter project di Backlog **dan PRD** dibaca dari satu state `projectFilter` milik `App`, bukan state
  lokal tiap layar (SPEC-146) — detail project memakainya untuk membuka Backlog dalam keadaan tersaring.
  Sentinel `"all"` = "Semua project" (PRD → `GET /prds` lintas-project; Backlog → `project` di-omit).
- Realtime: **WebSocket** untuk semua data live — satu WS siar dashboard `/events/ws`
  (backlog/sesi/notifikasi/limits/vps, SPEC-199/ADR-0039) + WS PTY per terminal
  (`/terminal/sessions/:id/ws`, frame `data`/`phase`/`exit`). Klien punya satu koneksi events
  singleton (`api/events.ts`, ref-count) yang di-`subscribe` tiap consumer. HTTP GET hanya untuk
  paint pertama (projects tetap HTTP — bukan data real-time). Tidak ada SSE, tidak ada poll
  `setInterval`. Optimistic UI untuk kontrol lokal.
- Tidak ada layar Runs, biaya, maupun anggaran: run + queue dicabut (ADR-0024). Kuota model dipantau
  lewat **LimitIndicator** (badge topbar + kartu Overview) yang membaca `GET /limits` dari OAuth usage
  API Anthropic (SPEC-181/ADR-0024). Settings tak punya `dailyBudget`/`maxConcurrent`. Label reset tiap
  window = countdown (`reset 5j 30m`); window **weekly** menambah momen absolut reset (tanggal+jam, waktu
  lokal browser, `id-ID`) — mis. `reset 52j 8m · Rab, 15 Jul, 07.00` — karena reset mingguan berhari-hari
  ke depan (SPEC-205).
- Markdown render: pustaka marked; file non-.md dirender sebagai blok kode.
- State ringan lewat React; persist preferensi (edit docs, settings) ke server (dan localStorage sebagai draft).
- **Loading / empty / error** dirender lewat satu komponen `StateBlock` (`ds/components/state.tsx`),
  jadi ketiganya tidak pernah terlihat sama. Fetch awal (`projects+specs`) digerbangkan
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
(Projects, dan daftar berpager lain): ia meneruskan rantai flex ke pembungkus anaknya. Tanpa `fill`,
`Card` berperilaku persis seperti sebelumnya.

## Backlog: tiga mode tampilan, dan board yang tidak boleh berbohong
`BacklogScreen` merender satu daftar spec dalam tiga bentuk — **grid** (default, kartu penuh
dengan stage bar), **list** (satu baris per spec), dan **board** (kanban). Grid dan list
dipaginasi lewat `usePaged`; board tidak, karena kolom yang terpotong halaman bukan board.

Toolbar dua baris (SPEC-178): baris atas tab sumber + toggle view + hitungan; baris bawah
kotak **Cari backlog** (substring case-insensitive pada `id + title + objective`) diikuti
`Select` project, stage, dan prioritas. Semua penyaring digabung serentak ke satu `filtered`
dan berlaku di ketiga view; kuncinya masuk `usePaged` agar halaman reset saat filter berubah.
Search/stage/prioritas view-local; project tetap `App.projectFilter` (SPEC-146).

Ketiganya memakai rantai flex di atas. Board sedikit berbeda: barisnya menggulir **mendatar**
(`overflow-x:auto`, `overflow-y:hidden`) dan tiap **kolom** menggulir tegak sendiri, jadi judul
kolom tak pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. Kartu board
`flex: 0 0 auto` — tanpa itu kartu menyusut mengisi kolom alih-alih kolomnya menggulir.

Kolomnya: `Backlog · Brainstorm · Objective · Spec · Plan · Execute · Success`. Lima kolom tengah
(Brainstorm…Execute) benar-benar `Spec.stage`; **Backlog** dan **Success** turunan, bukan field:

- **Backlog** — spec `brainstorming` yang **belum punya sesi hidup** (`!hasSession`). Begitu sesinya
  mulai, kartunya pindah ke Brainstorm. `hasSession` datang dari `listSessions()` (tmux), bukan status run.
- **Success** — `stage === "done"`.
- Kolom **Failed** dihapus bersama tabel `Run` (ADR-0024): sebuah sesi tak meninggalkan status terminal
  yang bisa dibaca dari spec — `mirrorStage` monotonic-forward (ADR-0008) menahan spec di stage terakhir
  yang tercapai, jadi tak ada yang bisa mengklaim kartu ke "Failed".

Konsekuensinya untuk drag: **kolom stage tidak bisa menerima maupun melepas kartu** (`draggable={false}`).
`Spec.stage` diturunkan dari phase-file sesi (ADR-0008/0024); UI yang menulisnya akan membuat
`executing`/`done` tercapai tanpa sesi yang benar-benar berjalan. Hanya ada **satu** drop yang sah, dan
ia bermuara ke `POST /terminal/sessions`, bukan ke `PATCH /specs`:

    Backlog ──drag──► Brainstorm   = mulai sesi

Kenapa cuma Brainstorm? Karena kontrak kanban adalah **kartu mendarat di kolom tempat ia dijatuhkan**.
Sesi selalu mulai dari awal pipeline, jadi spec yang baru dijalankan berakhir di stage `brainstorming` —
Brainstorm satu-satunya tujuan yang jujur. Menerima drop di Execute berarti kartunya melompat empat
kolom ke kiri sesaat setelah dilepas.

Aturannya dua fungsi murni terekspor, `specColumn(spec, hasSession)` dan `canDrop(from, to)`, diuji di
`src/test/backlog-board.test.tsx` — termasuk render test jsdom yang men-drag kartu sungguhan,
karena `from`/`to` yang tertukar lolos dari unit test aturannya sendiri.

**Reopen sesi untuk spec `done` (SPEC-172).** Kadang hanoman menandai `done` terlalu dini
(mis. spec ber-banyak-PR, baru sebagian beres). `SpecDetail` (modal detail) menampilkan tombol
**"Buka sesi lagi"** saat `spec.stage === "done"`, memanggil `onStart(spec)` — flow start yang
sama (`POST /terminal/sessions`), tapi server memilih prompt **lanjutan** (fase Execute saja)
karena stage-nya `done`. Sengaja **hanya** di detail: `SpecActions` (dipakai grid/list/board)
tak diubah, jadi aksi ini tak muncul di tiga mode tampilan itu. Stage tetap `done`; diuji di
`src/test/reopen-session.test.tsx`.

Drag pakai HTML5 drag-and-drop native, tanpa dependency — dan ia mati total di keyboard maupun
layar sentuh. Karena itu **setiap kartu di ketiga mode, termasuk `BoardCard`, membawa `SpecActions`**
(mulai/lanjutkan sesi, lihat dokumen, review). Drag adalah jalan pintas, bukan jalan satu-satunya.

Memulai sesi **tidak** memindahkan layar — operator tetap di Backlog dengan filter dan mode tampilannya
utuh. Yang menandai sesi sudah jalan adalah kartunya sendiri: `activeSpecs` (diturunkan dari
`listSessions()` tmux) menyegar, tombolnya berubah, dan toast muncul.

## Terminal (sesi Claude Code interaktif)
`TerminalScreen` menampilkan sesi dalam **grid `rows × cols`** (CSS Grid): `+ Kolom` menambah
kolom (kiri↔kanan), `+ Baris` menambah baris (atas↔bawah); tiap kolom dan baris punya `×` di gutter
untuk menutupnya (grid tak boleh menyusut di bawah 1×1). Menutup kolom/baris **tidak** mematikan
sesi — selnya lenyap dan sesinya jatuh ke tray, karena itu tak ada konfirmasi. Tiap sel me-mount satu `TerminalPane`
yang membuka WebSocket ke `/api/terminal/sessions/:id/ws`; sel kosong menampilkan picker sesi yang
belum tertempat, dan sesi yang belum di grid duduk di **tray**. Satu sesi menempati **paling banyak
satu sel** (menjaga resize tmux tak berkedip). Dua aksi per sel: **Lepas** (unbind, sesi tetap
hidup) dan **Tutup/`×`** (kill lewat `DELETE`).

Toolbar juga punya **Ambil backlog** (SPEC-179): tombol yang membuka modal picker berisi
backlog item yang bisa diambil (`stage !== "done"` dan belum punya sesi hidup). Memilih satu
memanggil `POST /terminal/sessions {spec, flow}` — endpoint idempoten yang sama dengan tombol
Mulai/Lanjutkan di halaman Backlog — lalu menaruh sesinya di sel kosong pertama grup aktif.
`flow` dipilih otomatis dari `spec.source` (`qa`/`feature`). Nol perubahan server.

Toolbar juga punya **Terminal biasa** (SPEC-236): membuka **shell tmux polos tanpa Claude** di
repoDir project terpilih (`POST {project, shell:true}`) untuk sekadar menjalankan command —
di sebelah **Sesi baru** yang men-spawn `claude`. Sesi shell tak punya flow/spec, tampil seperti
sesi biasa; menutupnya hanya kill pane (cwd = repoDir, bukan worktree). Lihat ADR-0056.

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
demi byte. Nol perubahan server: route dan `pty.ts` dipakai apa adanya (SPEC-158).

Tombol **Layar penuh** (`maximize-2`) di ujung toolbar memaksimalkan screen: root-nya jadi
`position: fixed; inset: 0; z-index: 100`, menimpa sidebar dan topbar `Shell` — di bawah modal (150)
dan toast (200), supaya dialog konfirmasi tak terkubur. Chrome menyusut jadi satu baris (tabbar dan
toolbar melebur, `GroupTabs` kehilangan garis bawahnya lewat prop `compact`) sehingga grid mendapat
sisa layar. Ini **maximize dalam app**, bukan Fullscreen API: `requestFullscreen()` merebut `Escape`,
dan `Escape` adalah tombol tersibuk di TUI Claude Code. Karena itu pula **tak ada** handler `Escape`
untuk keluar — hanya tombol. Pengguna yang mau seluruh layar device menekan `F11` sendiri. State
`maxed` tidak dipersist (SPEC-163).

Berbeda dari maximize-grid itu, tiap **sel** punya ikon **`fullscreen`** di header-nya (SPEC-232):
mengklik membuka **satu** terminal itu sendiri dalam sebuah **modal** besar (DS `Modal`, prop baru
`closeOnEscape={false}` karena Escape milik TUI Claude Code — keluar via `×`/backdrop saja). Supaya
invariant *satu sesi = satu attach tmux* terjaga, sel yang sedang penuh **melepas** `TerminalPane`-nya
dan menampilkan placeholder "Terbuka di layar penuh"; pane hidup pindah ke modal. Menutup modal
memasang ulang pane di sel (reconnect murah — scrollback dipegang tmux, sama seperti pindah grup).
State `fullId` di `TerminalScreen` tak dipersist; bila sesinya lenyap lewat frame WS siar, modal
tertutup sendiri. Ini **maximize satu terminal**, bukan seluruh grid — dua fitur terpisah.

Sesi yang **berakhir** (`exited`) ditandai kontras di header cell dengan `StatusPill`
hijau **"Selesai"**, dan badan terminalnya diredupkan (`opacity: 0.6`) untuk menandakan
proses sudah beku — menggantikan suffix teks `· berakhir` yang lama (SPEC-188).

Sesi yang **berhenti menunggu keputusan manusia** (marker `.worktrees/.decisions/<id>` terisi,
disurface `listSessions().decision`) ditandai pill amber berdenyut **"Menunggu keputusan"**
(`StatusPill status="awaiting"`). Header cell diberi tint sesuai state — hijau untuk `exited`,
amber untuk menunggu keputusan — supaya pembeda terbaca sekilas, bukan hanya dari pill.
`TerminalScreen` menerima daftar sesi lewat WS siar `/events/ws` (grup `sessions`, SPEC-199) —
bukan lagi poll 8s. Transisi ke/keluar "menunggu keputusan" dan `exited` datang sebagai push;
server men-poll tmux di satu loop dan menyiarkan saat berubah (dedup signature).

Proxy dev Vite harus memakai `ws: true`, kalau tidak upgrade WebSocket dijawab 404 (berlaku untuk
kedua WS: `/terminal/sessions/:id/ws` dan `/events/ws`).

## Melihat dokumen audit/spec/plan (SPEC-170)
Setiap backlog item mengumpulkan dokumen yang ditulis agent sepanjang alur —
audit, objective, spec/design, plan, brainstorm. `SpecDocsModal`
(`screens/SpecDocsModal.tsx`) adalah satu dialog (reuse `Modal`) yang menampilkannya:
kiri daftar berkas dikelompokkan per **jenis**, kanan preview Markdown. Datanya dari
`GET /specs/:id/docs` (daftar `{kind,path,name}`, sudah terurut per jenis oleh server) dan
`GET /specs/:id/docs/*` (isi). Server memilih sumber **freshest-wins** di `resolveDir`:
worktree sesi tmux yang masih hidup untuk spec itu, kalau tidak `repoDir` project — jadi
dokumen bisa di-review **sebelum** branch run di-merge.

Pemicunya dua, keduanya membuka modal ber-`specId` yang sama:
- **Backlog** — ikon `file-text` "Lihat dokumen" di `SpecActions` (`BacklogScreen.tsx`), jadi
  muncul di ketiga mode (grid/list/board) sekaligus.
- **Terminal** — ikon `file-text` di header `Cell` (`TerminalScreen.tsx`), hanya bila sesi punya
  `specId`; karena keyed spec-id, ia otomatis membaca worktree sesi yang sedang berjalan.

Renderer Markdown dipakai bersama: `MarkdownView`/`hnDocHtml` (`ds/markdown.tsx`, marked +
kelas `.hn-md`) — sumber yang sama untuk `SpecDocsModal` dan `DocsWorkspace`.

## Review worktree: collapse & tree Changed (SPEC-171, SPEC-177)
`ReviewScreen` (`screens/ReviewScreen.tsx`) menampilkan file worktree backlog item ala VSCode:
sidebar **Changed** (SCM) + **Files** (tree), viewer Diff|Source, read-only. Dua pohon dibangun
oleh `buildFileTree(paths)` dan dirender `TreeRow` — keduanya kini di modul bersama
`screens/file-tree.tsx` (SPEC-189), dipakai Review **dan** IDE Explorer.

`TreeRow` mount **collapsed** (`useState(defaultOpen)`, default `false`) — buka Review pertama kali
= semua folder tertutup (SPEC-177; sebelumnya `depth < 1` membuat folder top-level ikut terbuka).
Dua prop opsional membuat satu komponen melayani kedua pohon: `defaultOpen` (Changed-tree
mengoper `true` supaya rantai induk file changed langsung terlihat) dan `meta` (map
`path → ChangedFile`; leaf yang ada di map menampilkan status `A/M/D` + `+add −del`, sama seperti
flat list).

Section **Changed** punya toggle **List | Tree** (`chView`, default `list`) di header "Changed · N":
List = flat path penuh (existing), Tree = `buildFileTree(changed.map(c => c.path))` dengan
`meta`+`defaultOpen`. Pilihan tak dipersist. Tak ada perubahan endpoint — murni frontend.

## Stage & progress
Tidak ada layar Runs, SSE, maupun StatusPill status-run — semuanya dicabut bersama tabel `Run`
(ADR-0024). Progres sebuah backlog dibaca dari **`Spec.stage`**, yang server turunkan dari phase-file
sesi (`$HANOMAN_PHASE_FILE` → `services/session-phases.ts`, `services/stage-machine.ts`). Kartu backlog
dan modal detail menampilkan **stage bar** (Brainstorm → … → Done); daftar didorong lewat WS siar
`/events/ws` (grup `specs`, SPEC-199), bukan poll. Sesi hidup dideteksi dari `listSessions()` (tmux) —
saat sesi ditutup, `liveSpecs()` (server, dipakai `GET /specs` DAN hub siar) write-through memajukan
stage dan membuat notifikasi `done`. `executing` tertahan (tak jadi `done`)
selama plan `docs/superpowers/plans/**` masih punya `- [ ]` (SPEC-173/ADR-0029). Fase `skipped`
(alur `qa`, SPEC-145/ADR-0020) keluar dari penyebut progress sehingga jalur cepat yang sukses tetap 100%.

## Favicon (SPEC-147)
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

## Notifikasi backlog selesai (SPEC-180)
Awareness saat backlog mencapai `done`: toast, daftar (lonceng), dan sound. Semua sisi klien
bersandar pada notifikasi yang **dibuat server-side** (`GET /notifications`) — lihat
[ADR-0033](../adr/0033-notifikasi-backlog-selesai.md).

- **`NotificationsProvider`** (`src/src/notifications/NotificationsContext.tsx`) membungkus tree
  ter-autentikasi di `App`. Ia menerima notifikasi lewat WS siar `/events/ws` (grup `notifications`,
  SPEC-199) — bukan lagi poll 10s; server men-`scanDecisions` + query di satu loop lalu menyiarkan.
  Baseline = `createdAt` terbesar saat frame pertama (frame pertama **tidak** men-toast riwayat lama);
  notifikasi lebih baru → `showToast` + `playNotifySound`, digerbang setting `notifyDone`/`notifySound`.
  Helper murni `newSince`/`maxAt` diuji terpisah.
- **Notifikasi OS lintas tab (SPEC-196):** toast in-app hanya terlihat di tab hanoman yang fokus.
  Saat `document.hidden` (user pindah tab) dan izin `Notification` sudah granted, `notifyOS` menembak
  `new Notification(msg, { tag: id })` (Web Notifications API native) untuk `done` **dan** `decision`,
  sehingga notifikasi tetap sampai di level OS. Izin diminta pada gestur user pertama (membonceng
  listener unlock audio). Klik notifikasi OS → `window.focus()` + redirect ke sesi (`onOpen`).
- **`NotificationBell`** (`.../NotificationBell.tsx`) dirender di topbar `Shell` (konsumsi context,
  nol prop-threading ke ~9 call-site `<Shell>`; nilai context default aman untuk test tanpa provider):
  tombol lonceng + badge unread (`--clay-500`), dropdown daftar (`SPEC-x · judul`, "selesai · Xm lalu",
  dot unread). Membuka dropdown = `POST /notifications/read` (unread → 0). Tombol "Bersihkan" =
  `DELETE /notifications`.
- **`UpdateBadge`** (`screens/UpdateIndicator.tsx`) — pill topbar "Update", muncul **hanya** saat
  `useUpdate().updateAvailable` (store WS grup `update`, pola `useLimits`). Klik → popover: heading per
  reason (local/remote/both), perintah update dalam blok mono + tombol **Salin**, daftar commit baru,
  baris `terpasang <sha> · tersedia <sha>`. Read-only: server tak pull/build/restart (SPEC-214, ADR-0048).
- **`AccountMenu`** (`auth/AccountMenu.tsx`) — widget topbar `Shell` paling kanan (SPEC-216): tombol
  avatar (inisial huruf pertama email, lingkaran brass) yang membuka popover berisi email pengguna +
  tombol **Keluar**. Konsumsi `AuthContext` (`auth/AuthContext.tsx`, provider `AuthProvider` di `App`,
  pola sama `NotificationBell`) — **nol prop-threading** ke ~9 call-site `<Shell>`; nilai context default
  aman (`user: null` → tak merender apa-apa) sehingga `<Shell>` tanpa provider (mis. test) tak error.
  **Keluar** memanggil `POST /auth/logout` lalu balik ke Login (`onLoggedOut`); walau jaringan gagal,
  state klien tetap dibersihkan (`catch`+`finally`). Tombol logout **sekunder** tetap ada di
  Settings → Akun.
- **Sound**: WAV bundled di `src/public/sounds/notify-<kind>.wav`, dibangkitkan
  `scripts/gen-notify-sounds.mjs` (deterministik, in-repo). `playNotifySound(kind)` (`.../sound.ts`)
  memakai **satu** elemen `Audio` yang dipakai ulang; `unlockNotifySound()` meng-unlock elemen itu
  (prime muted→play→pause) pada **gestur user pertama** (listener `pointerdown`/`keydown` di
  `NotificationsProvider`), supaya bunyi dari push notifikasi WS tak ditolak autoplay (SPEC-192).
- **Setting** di layar Settings → section "Sesi & notifikasi": toggle **Notifikasi backlog selesai**
  (`notifyDone`), select **Sound** (`notifySound`: Short/Medium/Long/Senyap) + tombol **Preview**.

## IDE Visual (SPEC-182 · ADR-0034)
Nav entri **IDE** (`code-2`) membuka `IdeScreen` (`screens/IdeScreen.tsx`), difilter per project lewat
`Select` di toolbar (pola sama dengan Docs · SoT). Dua tab berbagi toolbar: **Explorer** dan **Git Graph**.

- **Toolbar**: `Select` project + `Select` **ref** (opsi `· working tree ·` + branch local +
  `origin/<b>` dari `api.listBranches`) + tombol **Checkout**. Memilih ref hanya mengubah **sudut
  pandang** (drives `GET /tree`/`/file` lewat `?ref=`) — melihat branch origin **tanpa** checkout.
  Tombol Checkout memanggil `POST /git {op:"checkout"}` yang memindah HEAD working tree sungguhan.
- **Explorer**: grid `300px 1fr`. Kiri, dari atas ke bawah: dua section SCM **Staged** & **Changed**
  lalu **pohon folder Files** (`buildFileTree`+`TreeRow` dari `screens/file-tree.tsx`, `api.ideTree`) —
  folder **default collapse** ala Review (SPEC-189, tanpa `meta`/`defaultOpen` → ikon file biasa,
  tertutup). Kanan pane isi (`api.ideFile`): view source = `<pre><code class="hljs">` di-highlight
  **highlight.js** (bahasa dari ekstensi, fallback `highlightAuto`); edit = `<textarea>` mono + Simpan
  (`api.putIdeFile`). File biner → placeholder.
  - **Preview `.md` (SPEC-240)**: berkas `.md` **default menampilkan markdown terender** — bukan raw
    source — lewat `MarkdownView` (`ds/markdown.tsx`, marked + `.hn-md`, renderer **bersama** Docs·SoT
    & `SpecDocsModal`). Header pane memberi toggle **Preview | Source** di samping **Edit** (pola pill
    yang sama dengan toggle Diff|Source); **Source** menampilkan raw source highlighted seperti biasa.
    State `mdView` (default `"preview"`) di-reset ke preview tiap `.md` baru dipilih; **Edit** tetap
    mengubah raw source, dan sesudah **Simpan** kembali ke preview. File **non-`.md`** tak punya toggle
    (tetap highlighted source + Edit). Helper `isMarkdown(path) = /\.md$/i`. Frontend-only, tanpa endpoint baru.
  - **Staged & Changed (SPEC-234)**: **Staged** = index vs HEAD, **Changed** = working tree vs index +
    untracked; masing-masing toggle **List | Tree** lewat `ChangedSection` shared di `file-tree.tsx`
    (dipakai Review juga). Data `api.ideStatus` (`GET /projects/:id/status`), **independen** dari
    dropdown ref (status inheren milik working tree utama). Klik file → pane kanan **diff** read-only
    (toggle Diff | Source, `DiffView` shared di `screens/diff-view.tsx`) via `api.ideFileDiff`; klik
    file dari pohon Files tetap membuka **editor**. Header kiri menampilkan branch aktif; **Muat ulang**
    & tiap git op (checkout/merge) menyegarkan status. Read-only — tak ada stage/unstage dari UI.
- **Git Graph** (`screens/GitGraph.tsx`): DAG commit dari `api.ideGraph`, lane dihitung **client-side**
  murni oleh `computeLanes` (`screens/git-graph.ts`, nol dep, diuji terpisah). Segmen penyambung
  diturunkan `rowEdges` (in/out/through per-baris) → digambar **cubic-bezier** (SPEC-189) sehingga
  branch & merge tersambung lintas lane, bukan garis melayang. Baris = SVG lane berwarna + chip ref
  (HEAD di-`--brass-500`) + subject + author + tanggal relatif (kolom rata, hover bone). **Klik**
  commit → panel detail (`api.ideCommit`) + daftar file berubah (klik file → buka di Explorer pada sha itu).
  **Klik-kanan** → context-menu: Checkout / Merge ke branch ini / Cherry-pick / Revert / Buat branch
  di sini… / **Hapus branch** — tiap aksi `POST /git`. Hapus sadar local vs origin (SPEC-206,
  `menuItems`): ref `origin/<b>` dikelompokkan dengan branch lokal `<b>`; per branch ditawarkan
  "Hapus `<b>` (local + origin)" / "(local)" / "Hapus origin/`<b>`" sesuai ref yang ada (local tak
  boleh branch aktif; origin selalu boleh). `origin/HEAD` diabaikan.
- **Dialog Paksa**: mutasi yang balas **409** (sesi aktif / tree kotor) memunculkan `ForceDialog`
  dengan pesan git asli + tombol **Paksa** yang mengulang op `force:true` (peringatan: bisa membuang
  perubahan tak ter-commit & mengganggu sesi Claude). Aman-default; force opt-in per aksi.

### Parity ekstensi Git Graph (SPEC-233 · ADR-0055)
Git graph diperluas mendekati ekstensi VS Code **Git Graph** (mhutchie). Semua tetap tunduk gate sesi +
force (op menyentuh working tree) atau worktree isolasi + handoff sesi claude (op rawan konflik):
- **Menu commit**: reset (soft/mixed/hard), **rebase current → sini**, **drop commit**, copy hash/subject,
  **Add tag…** (lightweight/annotated + push). Rebase/drop lewat `POST /git/rebase|drop` (isolasi); konflik → Terminal.
- **Menu branch** (klik-kanan chip ref, `branchMenuItems`): checkout, rename, push, merge/**rebase** ke current,
  hapus (local/origin/both), **Create Pull Request** (`api.idePrUrl` → provider), **Create archive** (`api.ideArchiveUrl`).
  Ref `origin/*` juga: **Pull into current** (`POST /git/pull`).
- **Menu tag** (chip tag terpisah, warna leaf): hapus (local/+origin), push, copy.
- **Baris uncommitted changes** (lingkaran terbuka) dari `api.ideStatus` bila tree kotor → menu: stash,
  reset (mixed/hard), clean untracked. **Strip stash** (`api.ideStashes`): apply/pop/drop/branch-from/copy.
- **Detail commit** diperkaya: badge **signed** (`%G?`), avatar **gravatar** (config `fetchAvatars`, default off),
  toggle **tree/flat**, klik file → **modal diff** (reuse `DiffView` dari `screens/diff-view.tsx`, tab Diff|Source),
  aksi per-file (view-at-rev/open/copy path), body **linkify** URL/issue/parent-hash + **emoji**/**markdown**
  (`screens/git-graph-render.ts`, dep-nol, md5 gravatar internal).
- **Compare dua commit**: Ctrl/Cmd-klik commit kedua → panel + modal diff (`api.ideCompare`/`ideCompareFile`).
- **Find** (⌘F, client-side atas baris ter-muat, fallback `api.ideSearch`) + **center HEAD** (⌘H); hasil di-highlight & di-navigasi.
- **Kontrol tampilan**: filter branch (`?branches=`), toggle remote/tag, redup merge-commit, style rounded↔angular.
  Preferensi dari **CONFIG_REGISTRY grup `gitGraph`** (`api.getConfig`): warna lane, style, tanggal, show/hide, mute,
  fetchAvatars, emoji/markdown, issue-link pattern.
- **Modal Remotes** (`IdeScreen`): list/add/hapus remote (`api.ideRemotes`/`ideAddRemote`/`ideDeleteRemote`); tombol **Fetch** (`--prune`).

## Error monitoring — area Errors + DSN (SPEC-249 · ADR-0060)

Area **Errors** (nav `triangle-alert`, `ds/shell.tsx` `HN_NAV` + cabang `section === "errors"` di `App.tsx`,
pola VPS — screen mandiri, tak lewat `gate`). `screens/ErrorsScreen.tsx`:

- **Self-fetch + silent poll** tiap 5 dtk (pola `GitGraph`: `!document.hidden`, poll senyap tak pernah
  mem-blank data). Realtime lewat **HTTP polling**, bukan kanal WS baru (ADR-0039).
- **Master → detail** (state seleksi lokal, pola `review`): daftar grup (`Badge` status + count, env,
  last-seen relatif) → detail grup (message, `sampleStack` mono scroll, env, first/last seen, count).
- **Filter** environment/project/status (`Select`), warna via token DS (`--status-err`/`--clay-*`/`--bone-*`).
- **Eskalasi**: tombol "Eskalasi ke backlog" → `api.escalateError(id)` → `onEscalated(spec, already)` →
  App `setProjectFilter(spec.projectId)` + `setSection("backlog")` + toast. Grup sudah escalated → tampil
  `→ SPEC-N` (Badge) alih-alih tombol. "Tandai resolved" → `api.patchError(id, "resolved")`.

**DSN mgmt** (`screens/ProjectDetailScreen.tsx` → `DsnCard`): kartu "DSN ingest" — bila aktif tampil prefix
(mono) + **Rotate**/**Revoke**; bila belum **Generate DSN**. Generate/rotate → `api.rotateIngestKey` →
tampilkan `dsnUrl` **sekali** di kotak `--brass-100` + tombol **Salin** (pola `DeviceTokensPanel`). Revoke →
`window.confirm` → `api.revokeIngestKey`. `ProjectDetailScreen` menerima `onToast` dari App.

**Notifikasi error** (reuse jalur existing): `zNotification.type` menerima `error`; `NotificationsContext.toastFor`
→ tone `err` + icon `triangle-alert` + msg = `title`; `NotificationBell` per-tipe (icon/warna clay, label
"error baru", aksi "Lihat error"); `notifTarget` → `{ section: "errors", projectFilter }`. Server hanya
menotifikasi **grup produksi baru** (dedup `key`), tersiar lewat grup `notifications` WS existing.

**SDK** = npm package publik **`hanoman-sdk`** (SPEC-254 · ADR-0063; `npm i hanoman-sdk` → `init`/`captureError`,
Node + browser, DSN gaya Sentry, fire-and-forget). Source di `sdk/src/**`; panduan (`sdk/README.md`) disajikan
apa adanya di web via modal `IntegrationGuideModal` (`GET /api/errors/integration-guide`).
