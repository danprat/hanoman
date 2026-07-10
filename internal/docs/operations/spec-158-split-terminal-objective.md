# SPEC-158 — Objective (split terminal)

**Fase:** Brainstorm → Objective (dikunci) · 2026-07-10
**Jenis:** fitur — sumber `brief`, prioritas **tinggi**
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Turunan:** brainstorm → [`docs/superpowers/specs/2026-07-10-hanoman-split-terminal-spec-158-brainstorm.md`], design → [`docs/superpowers/specs/2026-07-10-hanoman-split-terminal-spec-158-design.md`], plan → [`docs/superpowers/plans/2026-07-10-hanoman-split-terminal-spec-158.md`].

## Masalah

Screen Terminal (`src/src/screens/TerminalScreen.tsx`) sudah bisa membuka **banyak** sesi
Claude Code — tapi merendernya satu per satu. Strip tab di atas; hanya tab aktif yang
di-mount jadi `<TerminalPane>` (`TerminalScreen.tsx:67-69`); berpindah tab me-remount pane
dan membuka WebSocket baru. "Melihat beberapa claude sekaligus" hari ini berarti mengklik
bolak-balik antar tab — tak pernah berdampingan.

Yang sudah terpasang dan **tidak perlu diubah** untuk memenuhi brief ini:

| Bagian | Fakta | Konsekuensi |
|---|---|---|
| PTY server (`server/src/services/pty.ts`) | Tiap sesi memegang `clients: Set` dan broadcast; `resize(id, …)` per-sesi. | N sesi + N klien serentak sudah didukung; tak ada asumsi "satu klien" untuk dipatahkan. |
| `<TerminalPane sessionId>` (`src/src/screens/TerminalPane.tsx:43-47`) | Buka WS sendiri; `ResizeObserver`+`FitAddon` mengukur diri ke containernya. | Di-mount di sel grid berukuran apa pun, ia `fit()` sendiri — dipakai ulang apa adanya. |
| Route `/terminal/sessions` (`server/src/routes/terminal.ts`) | GET list · POST create (project/run) · DELETE · GET `/ws` dengan `attach` ke `Set`. | Membuka/menutup sel = `create`/`kill` sesi yang sudah ada; tak ada endpoint baru. |

Kesimpulannya: "beberapa claude berdampingan" bukan kemampuan server yang hilang — server
sudah punya semuanya. Yang hilang adalah **tata letak** di frontend: satu-pane-aktif alih-alih
grid.

## Objective (dikunci)

**Screen Terminal menampilkan beberapa sesi Claude Code sekaligus dalam satu grid `rows × cols`,
bukan satu sesi aktif di balik tab.** Pengguna membelah tampilan menjadi kolom (kiri↔kanan) dan
baris (atas↔bawah), menambah kolom dan baris sebanyak yang ia mau, dan tiap sel grid menjalankan
satu terminal claude yang hidup — semuanya terlihat berdampingan tanpa berpindah tab. Sesi yang
sudah berjalan dapat **ditarik ke dalam grid tanpa membuat sesi baru**. Seluruhnya adalah
perubahan **layout frontend** — tanpa menambah dependency runtime, tanpa perubahan
`server/**`, kontrak API, maupun skema database, dan tanpa menyentuh guardrail Source-of-Truth
maupun isolasi worktree (ADR-0002).

## Kriteria sukses (tingkat fase)

- **Grid dua sumbu, baris-mayor.** `TerminalScreen.tsx` berubah dari "satu pane aktif" menjadi
  satu CSS Grid `repeat(cols, 1fr)` × `repeat(rows, 1fr)`. Sel mengalir kiri→kanan lalu
  atas→bawah — persis frasa objective. Membelah ruang dilakukan oleh CSS Grid, bukan JavaScript,
  bukan library.

- **Menambah kolom dan baris.** Kontrol **+ Kolom** dan **+ Baris** menambah sumbu grid. State
  layout: `rows`, `cols`, dan pemetaan `cells: (sessionId | null)[]`.

- **Tiap sel satu sesi; sesi hidup dapat ditarik masuk.** Sel kosong menampilkan pemilih sesi
  yang membaca `GET /terminal/sessions` (seluruh sesi hidup) **atau** membuka sesi baru lewat
  project picker yang sudah ada. Ini menjawab "tanpa harus buat session baru" pada brief: sesi
  yang sudah berjalan ditempatkan ke grid, bukan wajib dibuat ulang.

- **Satu sesi ≤ satu sel.** Satu sesi tampil di paling banyak satu sel. Invarian ini menjaga
  resize: karena satu sesi = satu sel, tak ada dua pane yang mem-`resize(id, …)` PTY yang sama,
  jadi ukuran TTY tak berkedip. Bila sebuah sesi dipindah ke sel lain, sel asalnya dikosongkan.

- **`TerminalPane` dipakai ulang apa adanya.** Tiap sel non-kosong me-mount `<TerminalPane>` yang
  sudah ada; ia membuka WS-nya sendiri dan mengukur diri ke sel lewat `ResizeObserver`+`FitAddon`.
  Tidak ada kode terminal, xterm, atau protokol WebSocket baru.

- **N pane = N WebSocket serentak, sudah didukung.** Grid 3×3 = sembilan WS hidup bersamaan.
  Server melayani banyak klien lewat `clients: Set` (`pty.ts`) — realita baru bagi frontend
  (sebelumnya selalu satu WS aktif), bukan bagi server. **Nol perubahan server.**

- **Menutup pane melepas sesinya.** Menutup sel = kosongkan sel, dan pada sesi non-run panggil
  `DELETE /terminal/sessions/:id` yang sudah ada (kill PTY). Sesi run (`--resume`) tidak
  di-kill sembarangan — konsisten dengan perilaku tab hari ini.

- **Layout bertahan reload browser.** `{rows, cols, cells}` disimpan di `localStorage`. Sesi PTY
  **selamat** dari reload browser (server tetap hidup), sehingga mengembalikan grid ke sesi yang
  sama itu nyata bermanfaat. Reset saat server restart wajar — sesi PTY memang mati saat itu
  (SPEC-012); layout tidak masuk database.

- **Konsisten design system.** Grid, pemilih sesi, dan kontrol mengikuti bone paper + brass
  accent seperti `TerminalPane`/`TerminalScreen` sekarang.

- **Nol skema, nol API, nol ADR.** Fitur ini tidak menyentuh Prisma, tidak menambah/mengubah
  endpoint, tidak menambah dependency. Karena itu **tak ada migration dan tak ada ADR** —
  `CLAUDE.md` mensyaratkan keduanya untuk perubahan skema, dan di sini tidak ada perubahan skema.
  Keputusan ini dicatat eksplisit agar fase Spec/Execute tidak menambahkannya karena kebiasaan.

- **Docs tercatat & ter-link.** Objective ini masuk index Source of Truth
  (`internal/docs/README.md`); brainstorm/design/plan turunannya di `docs/superpowers/**`.

## Batas scope

- **Termasuk:** ubah `src/src/screens/TerminalScreen.tsx` dari satu-pane-aktif menjadi CSS Grid
  pane; kontrol + Kolom / + Baris; state layout `{rows, cols, cells}`; pemilih sesi per sel
  (sesi hidup atau buka baru); tutup pane (lepas + kill sesi non-run); persistensi layout di
  `localStorage` — dan hanya itu.

- **Tidak termasuk:** perubahan `server/**` apa pun (route, service PTY, skema); divider yang
  bisa di-drag dan nesting rekursif ala tmux/iTerm (grid seragam sudah memenuhi "kolom dan
  baris"); drag-reorder pane; satu sesi lintas-project (tetap satu sesi = satu project/run = satu
  PTY); persistensi sesi ke database; batas jumlah pane; autentikasi terminal (utang lama, di
  luar brief ini).

## Prinsip yang dipegang

- **Dipakai ulang, bukan ditulis ulang.** `TerminalPane`, route `/terminal/sessions`, dan service
  PTY dipakai apa adanya. Fitur ini hidup di satu berkas frontend; menyentuh server berarti
  membangun ulang yang sudah ada.

- **Layout adalah state UI, bukan data bisnis.** Berapa kolom/baris dan sesi mana di sel mana
  tidak masuk DB: sesi PTY in-memory mati saat server restart (SPEC-012), jadi mengawetkan tata
  letaknya ke database hanya mengawetkan penunjuk ke sesi yang sudah tiada.

- **Native platform sebelum kode.** CSS Grid membelah ruang; `ResizeObserver` yang sudah ada
  mengukur tiap sel. Tak ada library layout, tak ada logika ukuran manual.

- **Tanpa dependency runtime baru.**

## Keputusan yang dikunci dengan default

Fase Brainstorm menutup dengan tiga pertanyaan yang tak dapat dijawab dari dalam run headless.
Semuanya dikunci di sini dengan **default yang direkomendasikan**, dicatat terbuka agar dapat
dibalik lewat amandemen sebelum fase Execute — bukan diperlakukan seolah sudah dikonfirmasi
manusia. Tak satu pun dari ketiganya menyentuh skema atau kontrak API; semuanya keputusan
tata letak frontend:

1. **Nasib strip tab lama → jadikan "tray".** Tab tidak dihapus; ia menjadi baris sesi hidup yang
   **belum** ditaruh di sel, siap dipilih ke dalam grid. Grid adalah tampilan utama; tray adalah
   sumber sesinya. Konsekuensi yang diterima: sesi bisa hidup tanpa tampil di grid mana pun.

2. **Grid seragam, bukan divider yang bisa di-drag.** Setiap kolom/baris berbagi ruang sama rata
   (`1fr`). Objective berbunyi "kolom dan baris", bukan "belah pane ini lagi dengan rasio bebas";
   drag-resize dan nesting rekursif ditunda sebagai penambahan masa depan, bukan v1.

3. **Sel baru mulai kosong, bukan auto-spawn.** Setelah + Kolom/+ Baris, sel baru menampilkan
   pemilih sesi dan menunggu dipilih — bukan langsung men-spawn proses claude. Ini menghindari
   menyalakan proses claude yang tak diminta hanya karena menambah sel.

> Chiranjivi — objective bertahan lebih lama dari satu run. Spec dan plan turunannya tunduk pada
> pernyataan ini.

## Amandemen — 2026-07-10 (fase Spec)

Fase Spec memverifikasi premis objective ini terhadap kode nyata dan menemukan **dua** yang cacat.
Rincian di [`docs/superpowers/specs/2026-07-10-hanoman-split-terminal-spec-158-design.md`].

1. **"Sesi PTY mati saat server restart (SPEC-012)" — dicabut.** Kriteria sukses *"Layout bertahan
   reload browser"* dan prinsip *"Layout adalah state UI"* menyandarkan diri pada klaim bahwa sesi
   mati saat server restart. Itu tidak lagi benar: [ADR-0016](../adr/0016-sesi-terminal-hidup-di-tmux.md)
   memindah sesi ke dalam tmux, sehingga sesi **selamat** dari restart `pnpm dev`. Konsekuensinya
   **menguatkan**, bukan membalik, keputusan localStorage — layout tersimpan dapat menyambung kembali
   ke sesi yang masih hidup lintas restart. Yang wajib ditambahkan: grid **merekonsiliasi** `cells`
   terhadap `listSessions()` yang hidup saat mount (sel yang sesinya sudah di-kill dikosongkan; sesi
   `exited` tetap terikat dan tampil "berakhir"). Larangan menyimpan layout ke **database** tetap
   berlaku utuh — localStorage, bukan DB.

2. **"Sesi run (`--resume`) tidak di-kill sembarangan — konsisten dengan perilaku tab hari ini" —
   premisnya keliru.** `close()` pada tab hari ini (`TerminalScreen.tsx`) memanggil
   `api.deleteTerminal(id)` → `killSession` untuk sesi run **maupun** bukan; tidak ada pembedaan.
   SPEC-158 tidak boleh diam-diam mengubah semantik kill. Diganti **dua aksi sel yang eksplisit**:
   **Lepas** (unbind — sesi tetap hidup, kembali ke tray; inilah aksi khas menata split) dan
   **Tutup/`×`** (kill lewat `DELETE` — persis perilaku hari ini, untuk sesi apa pun). Kriteria sukses
   *"Menutup pane melepas sesinya"* dibaca ulang sebagai kedua aksi ini.

Sisa objective ini tetap berlaku utuh — termasuk "nol perubahan server/API/skema, nol migration &
nol ADR".
