# SPEC-158 — Split Terminal

**Status:** design · objective dikunci 2026-07-10
**Date:** 2026-07-10
**Objective:** [`internal/docs/operations/spec-158-split-terminal-objective.md`]
**Brainstorm:** [`docs/superpowers/specs/2026-07-10-hanoman-split-terminal-spec-158-brainstorm.md`]

## Objective

Screen Terminal menampilkan beberapa sesi Claude Code sekaligus dalam grid `rows × cols`,
bukan satu sesi aktif di balik tab. Pengguna membelah tampilan menjadi kolom (kiri↔kanan) dan
baris (atas↔bawah), menambah kolom dan baris sebanyak yang ia mau, tiap sel satu terminal hidup,
dan sesi yang sudah berjalan dapat ditempatkan ke grid tanpa membuat sesi baru. Murni layout
frontend — nol perubahan `server/**`, kontrak API, maupun skema.

## Why

`TerminalScreen.tsx` hari ini me-mount **satu** `<TerminalPane>` (tab aktif) pada satu waktu
(`TerminalScreen.tsx:67-69`). Server sudah bisa lebih: `pty.ts` memegang satu `Attachment`
per sesi dengan `clients: Set`, dan `resize(id,…)` per-sesi. "Beberapa claude berdampingan"
adalah kemampuan **frontend** yang hilang, bukan server.

## Decisions (locked)

| Keputusan | Pilihan |
|---|---|
| Model layout | Grid seragam `rows × cols` (CSS Grid `1fr`), baris-mayor |
| State layout | `{ rows, cols, cells: (sessionId\|null)[] }`, `cells.length === rows*cols` |
| Persistensi | `localStorage` — bukan DB; direkonsiliasi ke sesi hidup saat mount |
| Isi sel | Sesi hidup dipilih ke sel (picker), atau "Sesi baru"; satu sesi ≤ satu sel |
| Aksi sel | **Lepas** (unbind, sesi tetap hidup) dan **Tutup** (`DELETE`, kill — perilaku tab hari ini) |
| Server/API/skema | Tidak disentuh; `TerminalPane`, route, `pty.ts` dipakai apa adanya |

## Architecture

Seluruh perubahan hidup di **dua berkas frontend**: satu modul logika layout murni (baru) dan
refactor `TerminalScreen.tsx`. `TerminalPane.tsx` tidak disentuh.

### 1. Modul layout murni — `src/src/screens/terminal-layout.ts` (baru)

Logika non-trivial (matematika grid, keunikan sesi, rekonsiliasi) dipisah dari React supaya
dapat diuji tanpa DOM:

```ts
export type Layout = { rows: number; cols: number; cells: (string | null)[] };

export const emptyLayout = (): Layout => ({ rows: 1, cols: 1, cells: [null] });

// + Baris: tambah satu baris di bawah — append `cols` sel kosong. Index baris-mayor tak bergeser.
export const addRow = (l: Layout): Layout =>
  ({ ...l, rows: l.rows + 1, cells: [...l.cells, ...Array(l.cols).fill(null)] });

// + Kolom: index baris-mayor BERGESER (idx = r*cols + c), jadi cells di-rebuild, bukan di-append.
export function addColumn(l: Layout): Layout {
  const cols = l.cols + 1;
  const cells: (string | null)[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push(c < l.cols ? l.cells[r * l.cols + c] : null);
  return { rows: l.rows, cols, cells };
}

// Tempatkan sesi di sel `idx`; kosongkan sel lain yang memegang id yang sama (satu sesi ≤ satu sel).
export function setCell(l: Layout, idx: number, id: string | null): Layout {
  const cells = l.cells.map((c) => (c === id ? null : c));
  cells[idx] = id;
  return { ...l, cells };
}

// Tempatkan di sel kosong pertama; bila penuh, kembalikan layout apa adanya (sesi tinggal di tray).
export function placeFirstEmpty(l: Layout, id: string): Layout {
  const idx = l.cells.indexOf(null);
  return idx === -1 ? l : setCell(l, idx, id);
}

// Sesi yang lenyap dari server (di-kill) dikosongkan dari selnya. Sesi `exited` TETAP terikat —
// ia masih ada di listSessions (pane_dead=1) dan TerminalPane menampilkannya "berakhir".
export const reconcile = (l: Layout, liveIds: Set<string>): Layout =>
  ({ ...l, cells: l.cells.map((c) => (c && liveIds.has(c) ? c : null)) });

export const KEY = "hanoman.terminal.layout";
export const load = (): Layout | null => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
export const save = (l: Layout): void => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* mode privat / kuota */ } };
```

`addColumn` di-rebuild dan `addRow` di-append **bukan** simetri gaya — index baris-mayor
`r*cols + c` bergeser saat `cols` berubah tapi tidak saat `rows` berubah. Menyamakan keduanya
adalah bug yang mengacak isi sel; itu sebabnya keduanya diuji berdampingan.

### 2. `TerminalScreen.tsx` — dari satu-pane-aktif menjadi grid

State: `sessions: TerminalSession[]` (dari `api.listTerminals()`, sudah ada), `layout: Layout`
(`load() ?? emptyLayout()`), dan `project` untuk "Sesi baru" (sudah ada).

- **Rekonsiliasi + persist.** Effect: saat `sessions` berubah → `setLayout(reconcile(layout, liveIds))`.
  Effect kedua: `save(layout)` tiap `layout` berubah. Karena sesi hidup di tmux dan **selamat dari
  restart server** (ADR-0016), layout ter-`load` menyambung kembali ke sesi yang masih hidup —
  `reconcile` hanya membuang sel yang sesinya benar-benar sudah di-kill.
- **Toolbar:** `+ Kolom` → `setLayout(addColumn)`, `+ Baris` → `setLayout(addRow)`; `Select`
  project + `Sesi baru` (buat sesi lalu `placeFirstEmpty`).
- **Tray** (hanya muncul bila ada sesi belum tertempat): chip per sesi yang tak ada di `cells` —
  klik menempatkannya di sel kosong pertama; `×` memanggil `close(id)` (kill). Menggantikan strip
  tab lama (keputusan Objective #1).
- **Grid:** `display: grid; gridTemplateColumns: repeat(cols, 1fr); gridTemplateRows: repeat(rows, 1fr)`,
  `height: calc(100vh - 180px)` seperti sekarang. Tiap sel dirender dari `cells[idx]`:
  - **terikat** → `<TerminalPane key={id} sessionId={id} onExit={…}>` dengan header tipis
    (nama sesi + tombol **Lepas** + `×`).
  - **kosong** → `Select` berisi sesi yang belum tertempat ("Pilih sesi…") → `setCell(idx, id)`.

`key={id}` pada `TerminalPane` tetap krusial: memindah sesi antar sel me-remount pane pada sel
tujuan dan membuka WebSocket-nya di sana, bukan mendaur-ulang instance lama — persis alasan `key`
dipakai pada tab hari ini.

### 3. Aksi sel: Lepas vs Tutup

Dua aksi berbeda, keduanya untuk sesi apa pun (run maupun bukan):

- **Lepas** — `setCell(idx, null)`. Sesi tetap hidup, kembali ke tray. Inilah aksi khas split:
  menata ulang tampilan **tanpa** mematikan claude. WebSocket sel itu ditutup oleh unmount pane;
  `detach` di server melepas klien, attachment tmux jalan terus.
- **Tutup (`×`)** — `close(id)`: `api.deleteTerminal(id)` lalu `setCell(idx, null)`. Ini **persis**
  perilaku `close()` pada tab hari ini (`kill-session` di tmux), tak dibedakan run/non-run.

### 4. Yang dipakai ulang apa adanya

- **`TerminalPane`** — sudah mengukur diri ke containernya lewat `ResizeObserver`+`FitAddon`
  (`TerminalPane.tsx:43-47`). Di-mount di sel grid berukuran apa pun, ia `fit()` dan mengirim
  `{t:"resize"}` sendiri. Nol perubahan.
- **Route & `pty.ts`** — `GET/POST/DELETE /terminal/sessions` + `/ws` cukup. Grid `R×C`
  meng-attach `R*C` sesi **berbeda**, tiap sesi punya satu attachment tmux (`open()` pada klien
  pertama), jadi tiap sesi resize independen — invarian "satu sesi ≤ satu sel" menutup satu-satunya
  kasus di mana dua pane bisa memperebutkan ukuran satu PTY.

## Realita tmux yang perlu dijaga (ADR-0016)

- **N sesi ter-attach serentak itu baru.** Sebelumnya selalu ≤1 pane hidup. Grid 3×3 = 9
  `attach-session` node-pty + 9 entri pada poll 500ms (`pty.ts:167`). Komentar `ponytail:` di sana
  sudah menandai ini: "Ganti dengan hook `pane-died` + `wait-for` kalau terminal yang terbuka
  bersamaan pernah sampai puluhan." Split menjadikan beberapa-sekaligus normal, tapi **tetap di
  bawah ambang itu** untuk pemakaian nyata — jadi bukan bagian dari SPEC-158; dicatat sebagai
  langit-langit, bukan pekerjaan.
- **Sesi selamat dari restart server.** Karena itu `reconcile` terhadap `listSessions()` yang hidup
  wajib — layout tersimpan bisa menunjuk sesi yang masih ada (bagus, disambung ulang) atau yang
  sudah di-kill (sel dikosongkan). Tanpa rekonsiliasi, sel menunjuk id hantu dan pane gagal attach.

## Out of scope

- Perubahan `server/**` apa pun (route, `pty.ts`, skema). Bila poll pernah terasa berat pada
  puluhan pane, itu perbaikan `pty.ts` tersendiri, bukan SPEC-158.
- Divider yang bisa di-drag & nesting rekursif ala tmux/iTerm (grid seragam sudah memenuhi
  "kolom dan baris").
- `− Kolom` / `− Baris` (menyusutkan dimensi grid). Menutup/Lepas sudah mengosongkan sel; menyusutkan
  dimensi adalah penambahan sepele nanti bila grid terasa satu-arah.
- Drag-and-drop antar sel — penempatan lewat picker/tray. (D&D di app ini dibatasi ke Brainstorm,
  commit 6d15c25.)
- Persistensi layout ke database; batas jumlah pane; autentikasi terminal (utang lama).

## Testing

- **`terminal-layout.test.ts` (baru, unit murni)** — `addRow` meng-append `cols` null & tak
  menggeser sel lama; `addColumn` me-rebuild dengan pemetaan `r*cols+c` benar (kasus 2×2→2×3 dengan
  isi diverifikasi posisinya); `setCell` menegakkan keunikan (menaruh id yang sudah ada di sel lain
  mengosongkan sel lama); `placeFirstEmpty` menaruh di lubang pertama dan no-op saat penuh;
  `reconcile` mengosongkan sel yang id-nya lenyap tapi mempertahankan yang masih hidup.
- **`terminal-screen.test.tsx` (diperbarui)** — test "satu tab per sesi" digantikan "satu pane per
  sel terikat": dua sesi ditempatkan → dua `data-testid="pane"` ter-mount bersamaan (hari ini hanya
  satu). Empty state tetap. Mock `TerminalPane` & `api` yang ada dipertahankan; `localStorage`
  di-`clear()` pada `beforeEach`.
- **Smoke lokal nyata (CLAUDE.md)** — boot server + web, buka Terminal, `+ Kolom`/`+ Baris`,
  taruh dua sesi berdampingan, ketik di keduanya, reload browser (grid & sesi kembali), Lepas lalu
  Tutup. Ini fase Spec (desain) — smoke dijalankan di fase Execute setelah kode ada.

## Open questions

**Terjawab di fase ini (memicu amandemen objective):**

- **"Sesi mati saat restart server (SPEC-012)"** — **salah**. ADR-0016 memindah sesi ke tmux; sesi
  selamat dari restart server. Konsekuensi desain: `reconcile` wajib, dan localStorage justru lebih
  bernilai (menyambung ulang ke sesi yang masih hidup). Objective diamandemen (Amandemen 1).
- **"Sesi run tidak di-kill sembarangan — konsisten dengan perilaku tab hari ini"** — premisnya
  **keliru**: `close()` pada tab hari ini memang `DELETE`/kill untuk sesi run maupun bukan. Split
  tidak mengubah semantik kill. Diganti dua aksi eksplisit: **Lepas** (unbind, tetap hidup) dan
  **Tutup** (kill = perilaku hari ini). Objective diamandemen (Amandemen 2).

**Masih menunggu manusia (dikunci dengan default, dapat dibalik sebelum Execute):**

- Grid seragam vs divider yang bisa di-drag → default **seragam** (Objective, keputusan #2).
- Tab lama → **tray** (Objective, keputusan #1); sel baru **mulai kosong** (keputusan #3).
