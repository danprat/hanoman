# SPEC-161 — Tutup kolom/baris + grouping sesi lewat tabbar

**Status:** design · disetujui 2026-07-10
**Date:** 2026-07-10
**Melanjutkan:** [`docs/superpowers/specs/2026-07-10-hanoman-split-terminal-spec-158-design.md`]

## Objective

Screen Terminal mendapat dua kemampuan yang hilang:

1. **Menutup kolom dan baris.** Grid hari ini hanya bisa tumbuh (`+ Kolom`, `+ Baris`). Tiap kolom
   dan baris mendapat `×`-nya sendiri, jadi yang dibuang adalah yang ditunjuk — bukan hanya yang
   terakhir.
2. **Grouping sesi lewat tabbar.** Beberapa grup bernama, tiap grup memegang grid-nya sendiri.
   Pengguna berpindah grup lewat tabbar dan mengelompokkan sesi menurut pekerjaan, bukan menurut
   satu grid tunggal yang makin ramai.

Murni layout frontend. Nol perubahan `server/**`, kontrak API, maupun skema — seperti SPEC-158.

## Why

SPEC-158 menaruh `− Kolom` / `− Baris` di *out of scope* dengan alasan eksplisit: *"Menutup/Lepas
sudah mengosongkan sel; menyusutkan dimensi adalah penambahan sepele nanti bila grid terasa
satu-arah."* Grid memang terasa satu-arah. Sekali `+ Kolom` ditekan, kolom itu menetap selamanya.

Grouping menjawab tekanan yang berbeda. Sesi tmux **selamat dari restart server** (ADR-0016), jadi
sesi menumpuk lintas hari. Satu grid `rows × cols` memaksa semuanya berdampingan atau mengantre di
tray. Grup memberi tiap pekerjaan grid-nya sendiri, dan sesi berpindah antar grup tanpa dimatikan.

## Decisions (locked)

| Keputusan | Pilihan |
|---|---|
| Tutup kolom/baris | `×` per kolom (gutter atas) dan per baris (gutter kiri) — bukan `− Kolom`/`− Baris` |
| Grid minimum | `1×1`. `removeRow` saat `rows === 1` dan `removeColumn` saat `cols === 1` → no-op |
| Sesi di sel yang terbuang | Jatuh ke tray, **tetap hidup**. Tanpa dialog konfirmasi |
| Model grup | Grup manual bernama; tiap grup punya `Layout` sendiri |
| Sesi ↔ grup | **Satu rumah**: satu sesi terpasang di ≤ 1 sel, di ≤ 1 grup, lintas seluruh workspace |
| Tray "Belum di grid" | **Global** — sesi yang tak punya sel di grup mana pun |
| Hapus grup | Buang grid-nya; sesi jatuh ke tray, tetap hidup. Grup terakhir tak bisa dihapus |
| Rename grup | Tombol `✎` pada tab aktif (ber-`aria-label`), bukan dobel-klik |
| Persistensi | `localStorage`, key baru. Migrasi otomatis dari key lama |
| Server/API/skema | Tidak disentuh |

**Tanpa konfirmasi saat menutup kolom berisi sesi.** Aksinya tak destruktif — sesi tmux jalan terus
dan langsung muncul di tray, siap ditaruh lagi. Ini konsisten dengan tombol **Lepas** yang sudah ada
dan juga tak meminta konfirmasi. Yang meminta konfirmasi seharusnya `Tutup` (`×` = kill), dan itu
utang lama yang tak dibayar di sini.

## Architecture

Tiga berkas frontend: satu modul murni yang ada (diperluas), satu modul murni baru, dan
`TerminalScreen.tsx`. `TerminalPane.tsx` tidak disentuh.

### 1. `src/src/screens/terminal-layout.ts` — dua fungsi baru, `load`/`save` keluar

Modul ini tetap murni soal **satu** grid dan tak tahu apa pun tentang grup.

```ts
// − Baris: buang baris r. rows === 1 → no-op. Baris-mayor tak bergeser saat rows berubah,
// jadi cukup potong satu slice sepanjang cols.
export function removeRow(l: Layout, r: number): Layout {
  if (l.rows === 1 || r < 0 || r >= l.rows) return l;
  const cells = [...l.cells];
  cells.splice(r * l.cols, l.cols);
  return { ...l, rows: l.rows - 1, cells };
}

// − Kolom: idx = r*cols + c BERGESER saat cols berubah — cells di-rebuild, alasan yang sama
// dengan addColumn. cols === 1 → no-op.
export function removeColumn(l: Layout, c: number): Layout {
  if (l.cols === 1 || c < 0 || c >= l.cols) return l;
  const cols = l.cols - 1;
  const cells: (string | null)[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let cc = 0; cc < l.cols; cc++)
      if (cc !== c) cells.push(l.cells[r * l.cols + cc] ?? null);
  return { rows: l.rows, cols, cells };
}
```

`removeRow` memotong slice dan `removeColumn` me-rebuild, sama seperti `addRow` meng-append dan
`addColumn` me-rebuild. Ini bukan selera gaya: `r*cols + c` bergeser saat `cols` berubah dan tidak
saat `rows` berubah. Keduanya diuji berdampingan justru karena asimetri itu tampak seperti bug.

`load` / `save` **pindah** dari berkas ini ke `terminal-workspace.ts`. Yang dipersist sekarang adalah
workspace, bukan layout tunggal; membiarkan `Layout` menyentuh `localStorage` akan meninggalkan dua
penulis untuk satu key. Setelah pindah, `terminal-layout.ts` nol efek samping.

### 2. `src/src/screens/terminal-workspace.ts` (baru)

```ts
import * as L from "./terminal-layout";

export type Group = { id: string; name: string; layout: L.Layout };
export type Workspace = { groups: Group[]; active: string };

export const emptyWorkspace = (): Workspace => …          // satu grup "Utama", layout 1×1
export const activeGroup = (ws: Workspace): Group => …    // fallback ke groups[0] bila active hilang

export function addGroup(ws: Workspace, name: string): Workspace   // grup baru jadi aktif
export function renameGroup(ws: Workspace, id: string, name: string): Workspace
export function removeGroup(ws: Workspace, id: string): Workspace  // groups.length === 1 → no-op

// Menegakkan "satu rumah": sapu `id` dari layout SEMUA grup, lalu tulis di sel idx grup aktif.
export function placeInActive(ws: Workspace, idx: number, id: string | null): Workspace
export function placeFirstEmptyInActive(ws: Workspace, id: string): Workspace
export function detach(ws: Workspace, id: string): Workspace       // lepas dari grup mana pun ia berada

export function placedIds(ws: Workspace): Set<string>              // sel terisi di semua grup
export function reconcileAll(ws: Workspace, liveIds: Set<string>): Workspace

export const KEY = "hanoman.terminal.workspace";
export function load(): Workspace | null   // migrasi dari KEY lama bila key baru kosong
export function save(ws: Workspace): void
```

**`placeInActive` adalah tempat invarian "satu rumah" ditegakkan.** Ia menyapu `id` dari layout tiap
grup sebelum menuliskannya di grup aktif — bukan hanya dari grup aktif. `L.setCell` sendiri sudah
menegakkan keunikan **di dalam satu** layout; lintas-grup butuh sapuan di lapisan ini. Semua
penempatan (picker sel, tray, sesi baru) harus lewat fungsi ini; memanggil `L.setCell` langsung dari
komponen akan membuat sesi kembar di dua grup.

**Sel yang lenyap tak butuh kode pembersih.** Tray dihitung `sessions − placedIds(ws)`. Menutup kolom,
menutup baris, dan menghapus grup semuanya membuang sel — sesinya otomatis keluar dari `placedIds`
dan muncul di tray. Tak ada satu pun dari ketiganya yang memanggil `api.deleteTerminal`.

**Migrasi.** `load()` membaca `KEY`. Kosong → baca key lama `hanoman.terminal.layout`; ada → bungkus
jadi `{ groups: [{ id, name: "Utama", layout }], active: id }`, tulis ke key baru, `removeItem` key
lama. Grid yang tersimpan hari ini selamat, dan key lama tak ditinggal jadi sampah yang membingungkan
sesi debugging berikutnya. Kedua key kosong → `load()` mengembalikan `null`, dan pemanggil memakai
`load() ?? emptyWorkspace()` — pola yang sama dengan `L.load() ?? L.emptyLayout()` hari ini.

Id grup dibuat dengan `crypto.randomUUID()` — sudah tersedia di target browser dan tak menambah
dependensi.

### 3. `TerminalScreen.tsx`

State `layout: Layout` diganti `ws: Workspace`. `sessions` dan `project` tetap seperti sekarang.
Effect rekonsiliasi memanggil `reconcileAll` alih-alih `reconcile`; effect persist memanggil `save(ws)`.
Penahan `loaded` tetap wajib — alasannya tak berubah (rekonsiliasi dini akan mengosongkan workspace
yang baru dipulihkan dari `localStorage`).

```
[ Backlog ]* [ Debug ✎ × ] [ + ]          ← tabbar
[+ Kolom] [+ Baris]         [project ▾] [Sesi baru]
Belum di grid: [ sesi-e × ] [ sesi-f × ]  ← global, lintas grup

       [×]     [×]
    ┌───────┬───────┐
[×] │ run-1 │       │
    ├───────┼───────┤
[×] │       │ run-2 │
    └───────┴───────┘
```

- **Tabbar** di atas toolbar. Tab = tombol; tab aktif menampilkan `✎` (rename) dan `×` (hapus grup).
  `×` `disabled` saat `groups.length === 1`. `+` menambah grup dengan nama default `Grup N`.
  Rename mengganti label tab dengan `<input>` yang commit saat `Enter`/blur, batal saat `Escape`.
- **Gutter `×`.** Grid yang sudah ada diperlebar satu kolom dan satu baris untuk gutter:
  `gridTemplateColumns: 18px repeat(cols, minmax(0,1fr))`, `gridTemplateRows: 16px repeat(rows, minmax(0,1fr))`.
  Pojok kiri-atas sel kosong. Tiap `×` ber-`aria-label` (`"Tutup kolom 2"`, `"Tutup baris 1"`) dan
  `disabled` saat dimensinya tinggal satu — grid tak boleh menyusut ke nol.
- **Grid** merender `activeGroup(ws).layout`. Grup non-aktif **tidak dirender**, jadi
  `TerminalPane`-nya unmount dan WebSocket-nya ditutup. Pindah tab lalu kembali = attach ulang ke sesi
  tmux yang sama; tak ada state terminal yang hilang, itu urusan tmux (ADR-0016).
- **Tray** tetap seperti sekarang, tapi `unplaced` dihitung dari `placedIds(ws)` (semua grup). Klik chip
  → `placeFirstEmptyInActive`, jadi sesi mendarat di grup yang sedang dilihat.
- **Empty state** kini bergantung pada grup aktif: `rows === 1 && cols === 1 && !cells[0] && sessions.length === 0`.

`key={session.id}` pada `TerminalPane` tetap krusial, alasannya tak berubah dari SPEC-158.

## Konsekuensi yang perlu dijaga

- **Pindah tab me-remount pane.** Grup non-aktif tidak dirender, jadi berpindah grup menutup lalu
  membuka ulang WebSocket sesi di grup tujuan. Itu murah dan benar (tmux memegang scrollback), tapi
  artinya pane menggambar ulang dari `capture-pane`, bukan melanjutkan buffer xterm di memori. Merender
  grup non-aktif dengan `display: none` akan menghindari remount **dengan** harga N sesi ter-attach
  serentak lintas seluruh workspace — persis langit-langit poll 500ms yang ditandai `ponytail:` di
  `pty.ts:167`. Remount adalah pilihan yang benar; ini dicatat supaya tak dianggap regresi.
- **`placedIds` memindai semua grup** tiap render. `O(grup × sel)` dengan puluhan sel — tak berarti.

## Out of scope

- Perubahan `server/**` apa pun.
- Reorder tab (drag), pindah sesi antar grup lewat drag-and-drop, atau menu "pindahkan ke grup…".
  Pindah grup dilakukan lewat tray: lepas di grup A, taruh di grup B. D&D di app ini dibatasi ke
  Brainstorm (commit 6d15c25).
- Konfirmasi untuk `Tutup` (`×` = kill sesi). Utang lama, tak dibayar di sini.
- Persistensi workspace ke database; sinkronisasi lintas browser.
- Divider yang bisa di-drag & nesting rekursif — tetap ditolak sejak SPEC-158.

## Testing

- **`terminal-layout.test.ts` (diperbarui)** — `removeRow` memotong baris yang benar dan tak menggeser
  sel lain; `removeRow` pada `rows === 1` → no-op (identitas referensial, seperti `setCell` di luar
  rentang); `removeColumn` me-rebuild baris-mayor dengan benar (kasus `2×3 → 2×2` buang kolom tengah,
  isi diverifikasi posisinya); `removeColumn` pada `cols === 1` → no-op; index di luar rentang → no-op.
  Test `load`/`save` pindah ke berkas workspace.
- **`terminal-workspace.test.ts` (baru)** — `placeInActive` menaruh sesi yang sedang berada di grup lain
  akan mengosongkan sel lamanya di grup itu (invarian satu-rumah, kasus yang paling mudah salah);
  `removeGroup` pada grup terakhir → no-op; `removeGroup` membuang grid tapi `placedIds` menyusut
  (sesi ke tray); `reconcileAll` mengosongkan sesi mati di **semua** grup; `load()` memigrasikan key
  lama jadi satu grup "Utama" dan menghapus key lama; `load()` tanpa data → `null`.
- **`terminal-screen.test.tsx` (diperbarui)** — klik `×` gutter kolom → pane sesi di kolom itu hilang
  dari grid dan chip-nya muncul di tray, **tanpa** `api.deleteTerminal` terpanggil (assert pada mock);
  klik tab grup lain → grid berganti; `×` tab `disabled` saat hanya satu grup.
- **Smoke lokal nyata (CLAUDE.md).** Fase Execute: boot server + web, buka Terminal, bikin dua grup,
  taruh sesi di masing-masing, tutup satu kolom berisi sesi (chip muncul di tray, terminal masih hidup
  saat ditaruh ulang), rename grup, hapus grup (sesinya ke tray), reload browser (grup, nama, grid,
  sesi kembali). Verifikasi migrasi: tulis key lama `hanoman.terminal.layout` di devtools, reload,
  pastikan muncul sebagai grup "Utama" dan key lama lenyap.

## Open questions

Tidak ada. Empat keputusan yang tadinya terbuka sudah dikunci bersama pengguna: `×` per kolom/baris
(bukan `− Kolom`/`− Baris`), grup manual bernama (bukan otomatis per project), satu-rumah + tray global
(bukan sesi di banyak grup), dan hapus grup → sesi ke tray (bukan di-kill).
