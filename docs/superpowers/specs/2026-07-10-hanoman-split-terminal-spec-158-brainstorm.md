# SPEC-158 — Split Terminal

**Status:** brainstorm — objective belum dikunci
**Date:** 2026-07-10
**Fase:** Brainstorm (feature: Brainstorm → Objective → Spec → Plan → Execute)
**Sumber:** brief · prioritas tinggi

## Objective (kandidat, belum dikunci)

Screen Terminal menampilkan **beberapa sesi Claude Code sekaligus dalam satu grid**,
bukan satu sesi aktif di balik tab. Pengguna membelah tampilan menjadi kolom (kiri↔kanan)
dan baris (atas↔bawah), menambah kolom dan baris sebanyak yang ia mau, dan tiap sel grid
menjalankan satu terminal claude yang hidup. Semua claude terlihat berdampingan tanpa
berpindah tab.

## Kondisi sekarang

Screen Terminal (`src/src/screens/TerminalScreen.tsx`) sudah bisa membuka **banyak** sesi —
tapi merendernya satu per satu. Strip tab di atas; hanya tab aktif yang di-mount jadi
`<TerminalPane>`; berpindah tab me-remount pane dan membuka WebSocket baru (SPEC-012/013).
Jadi "beberapa claude sekaligus" hari ini berarti mengklik bolak-balik antar tab.

Yang sudah terpasang dan tidak perlu diubah:

| Bagian | Fakta | Konsekuensi untuk fitur ini |
|---|---|---|
| PTY server-side (`server/src/services/pty.ts`) | Tiap sesi memegang `clients: Set` dan broadcast; `resize(id, …)` per-sesi. | N sesi + N klien serentak sudah didukung. |
| `<TerminalPane sessionId>` (`TerminalPane.tsx`) | Buka WS sendiri, `ResizeObserver`+`FitAddon` mengukur diri ke containernya. | Di-mount di sel grid berukuran apa pun, ia menyesuaikan sendiri — dipakai ulang **apa adanya**. |
| Route `/terminal/sessions` (`server/src/routes/terminal.ts`) | GET list · POST create (project/run) · DELETE · GET `/ws`. | Membuka/menutup sel = `create`/`kill` sesi yang sudah ada. |

## Wawasan inti: ini murni perubahan layout frontend

Split terminal **tidak menyentuh** server, kontrak API, maupun skema database. Buktinya:

- Tiap sel grid adalah **satu sesi berbeda** → satu WebSocket berbeda. Server sudah
  melayani banyak sesi serentak; tak ada asumsi "satu klien" untuk dipatahkan.
- `<TerminalPane>` sudah mengukur diri ke containernya lewat `ResizeObserver`. Menaruh
  empat pane dalam grid 2×2 = empat pane yang masing-masing `fit()` ke selnya. Tak ada
  kode terminal baru.
- Layout (berapa kolom/baris, sesi mana di sel mana) adalah **state UI**, bukan data
  bisnis. Sesi PTY sudah in-memory dan mati saat server restart (keputusan SPEC-012);
  menyimpan layout ke DB akan mengawetkan tata letak sesi yang sudah tak ada.

Artinya seluruh pekerjaan hidup di `TerminalScreen.tsx`: ubah "satu pane aktif" menjadi
"grid pane", tambah kontrol +kolom / +baris, dan pemetaan sel→sesi.

## Opsi — model layout

**A. Grid seragam `rows × cols` — rekomendasi.**
State: `rows`, `cols`, dan `cells: (sessionId | null)[]` mengalir baris-mayor
(kiri→kanan, lalu atas→bawah — persis frasa objective). Render satu CSS Grid
(`grid-template-columns: repeat(cols, 1fr)` / `rows`). Kontrol: tombol **+ Kolom** dan
**+ Baris**. Paling dekat dengan "menambahkan banyak kolom dan baris", nol library, dan
CSS Grid yang membelah ruang — bukan JavaScript.

**B. Split rekursif ala tmux/iTerm (divider bisa di-drag, nesting arbitrer).**
Tiap pane bisa dibelah lagi horizontal/vertikal tanpa batas, dengan divider yang
diseret untuk mengubah rasio. Lebih kuat, tapi menuntut struktur pohon + logika drag +
kemungkinan library (`react-mosaic`/`allotment`). Objective menyebut "kolom dan baris",
bukan "belah pane ini lagi" — kekuatan ini melampaui yang diminta.

**C. Satu tumpukan flex (hanya kolom **atau** hanya baris).**
Paling malas, tapi gagal memenuhi "kiri kanan **lalu** atas bawah" — objective secara
eksplisit meminta dua sumbu.

→ **A.** Grid seragam memenuhi kata demi kata objective dengan CSS murni. Divider yang
bisa di-drag (dari B) dicatat sebagai penambahan masa depan, bukan v1.

## Opsi — apa isi tiap sel

**1. Tiap sel punya pemilih sesi: pilih sesi yang sudah hidup **atau** buka baru — rekomendasi.**
`GET /terminal/sessions` sudah mengembalikan seluruh sesi hidup. Sel kosong menampilkan
`Select` sesi + tombol "Sesi baru" (project picker yang sudah ada). Ini menjawab
"tanpa harus buat session baru" pada context brief: sesi yang sudah jalan bisa **ditarik**
ke dalam grid, bukan wajib dibuat ulang.

**2. Tiap sel selalu spawn sesi baru.** Lebih sederhana, tapi mengabaikan sesi yang sudah
berjalan dan bertabrakan dengan context brief.

→ **1.** Satu sesi tampil di **paling banyak satu sel** (mencegah dua pane satu sesi saling
menimpa ukuran PTY — lihat "Resize" di bawah). Strip tab lama menjadi baris kontrol grid:
sesi yang belum ditaruh di sel duduk di "tray" untuk ditarik masuk.

## Opsi — persistensi layout

**localStorage — rekomendasi.** Simpan `{rows, cols, cells}` per reload browser. ~5 baris,
nol backend. Berguna karena sesi PTY **selamat** dari reload browser (server tetap hidup) —
jadi mengembalikan grid ke sesi yang sama itu nyata bermanfaat.

- **Ephemeral (state React saja)** — dapat diterima untuk v1; grid reset saat reload.
- **DB** — **ditolak.** Sesi mati saat server restart (SPEC-012); mengawetkan layout ke DB
  hanya mengawetkan pointer ke sesi yang sudah tiada. Juga = migration + ADR untuk state UI.

## Resize & WebSocket (batas yang perlu dijaga)

Tiap pane memanggil `resize(id, cols, rows)` untuk **sesinya sendiri**; karena satu sesi =
satu sel, tak ada dua pane yang mem-`resize` PTY yang sama, jadi tak ada ukuran yang
berkedip. Aturan "satu sesi ≤ satu sel" (opsi isi-sel #1) menjaga invarian ini.

Grid 3×3 = sembilan WebSocket hidup serentak. Sudah didukung server, tapi ini realita baru:
sebelumnya selalu satu WS aktif. Tidak ada batas keras yang diusulkan untuk v1; bila perlu,
batas jumlah sel adalah penambahan sepele nanti.

## Ruang lingkup

**Termasuk:** ubah `TerminalScreen.tsx` dari satu-pane-aktif menjadi CSS Grid pane;
kontrol + Kolom / + Baris; pemetaan sel→sesi + pemilih sesi per sel; tutup pane (kill/lepas
sesi); persistensi layout di localStorage; tema/spacing mengikuti design system.

**Tidak termasuk:** perubahan `server/**` apa pun (route, service PTY, skema); divider yang
bisa di-drag & nesting rekursif (model B); split lintas-project dalam satu sesi (tetap
satu sesi = satu project = satu PTY); persistensi sesi ke DB; batas jumlah pane.

## Pertanyaan terbuka — perlu jawaban manusia sebelum objective dikunci

1. **Nasib strip tab lama.** Grid menggantikan tab sepenuhnya, atau tab tetap ada sebagai
   "tray" sesi yang belum ditaruh di grid? Usulan: jadikan tray (opsi isi-sel #1).
2. **Grid seragam vs divider yang bisa di-drag.** Objective berbunyi "kolom dan baris" →
   usulan v1 grid seragam (model A), drag-resize ditunda. Konfirmasi bahwa rasio seragam
   cukup untuk rilis pertama.
3. **Sel kosong.** Setelah + Kolom/+ Baris, sel baru mulai kosong (menunggu dipilih sesi)
   atau langsung spawn sesi baru? Usulan: mulai kosong dengan pemilih — hemat proses claude.

## Catatan fase

Fase Brainstorm tidak menyentuh `internal/docs/**`, jadi tak ada perubahan pada index
Source of Truth (`internal/docs/README.md`) — mengikuti preseden brainstorm SPEC-143/144/145
di folder ini. Artefak yang masuk index adalah `internal/docs/operations/spec-158-*-objective.md`,
dan itu keluaran fase **Objective** berikutnya, bukan fase ini.
