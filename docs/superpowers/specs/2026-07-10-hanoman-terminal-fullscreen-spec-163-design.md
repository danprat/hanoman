# SPEC-163 — Layar penuh untuk screen Terminal

**Status:** design · disetujui 2026-07-10
**Date:** 2026-07-10
**Melanjutkan:** [`docs/superpowers/specs/2026-07-10-hanoman-terminal-groups-spec-161-design.md`]

## Objective

Satu tombol di screen Terminal yang memaksimalkan grid ke seluruh viewport: sidebar dan topbar
`Shell` hilang, chrome screen sendiri menyusut jadi satu baris tipis, dan grid mendapat sisa layar
seluruhnya. Di dalam mode itu `+ Kolom`, `+ Baris`, `Sesi baru`, tabbar grup, dan `×` gutter tetap
terjangkau. Murni frontend, satu berkas.

## Why

`TerminalScreen` hidup di dalam `Shell` (sidebar `var(--sidebar-w)` + topbar `var(--topbar-h)`) dan
tingginya dipatok `calc(100vh - 180px)`. Untuk pekerjaan yang butuh membaca TUI Claude Code
berdampingan, ~180px tinggi dan selebar sidebar itu ruang yang hilang. Grid `2×2` di laptop 900px
menyisakan sel setinggi ~282px — cukup, tapi tak lapang.

## Decisions (locked)

| Keputusan | Pilihan |
|---|---|
| Mekanisme | **Maximize dalam app** (`position: fixed; inset: 0`), **bukan** Fullscreen API |
| `Escape` | **Tidak** di-bind. Keluar hanya lewat tombol |
| `z-index` overlay | `100` — di atas konten, di bawah modal (`150`) dan toast (`200`) |
| Chrome saat maximize | Tabbar + toolbar dilebur jadi **satu baris**; tray tetap muncul bila ada sesi bebas |
| Persistensi | **Tidak ada.** State tampilan, bukan tata letak; hilang saat reload |
| Tombol | `IconButton` DS, `maximize-2` ↔ `minimize-2`, di ujung toolbar |
| Berkas | Hanya `TerminalScreen.tsx` (+ test + docs). Nol perubahan server/API/skema |

### Kenapa bukan Fullscreen API

`element.requestFullscreen()` memberi seluruh layar device dan menyembunyikan chrome browser. Ia juga
**merebut `Escape`**: browser memakainya untuk keluar fullscreen, jadi ia tak pernah sampai ke
terminal. `Escape` adalah tombol tersibuk di TUI Claude Code — interrupt, keluar mode, batal.

Penyelamatnya `navigator.keyboard.lock(["Escape"])`. Diverifikasi ada di Chrome 150 pada origin
`localhost` (`isSecureContext: true`) — dan **tidak ada** di Firefox maupun Safari. Menukar dukungan
lintas-browser dan satu API eksperimental demi menghilangkan bilah tab bukan tukar-tambah yang baik.

Pengguna yang benar-benar mau seluruh layar device menekan `F11` sendiri; digabung dengan maximize
ini hasilnya identik, tanpa satu baris kode pun.

### Kenapa `Escape` tidak dipasang

Refleks "overlay ditutup dengan Escape" benar untuk modal dan salah untuk terminal. `onKeyDown`
yang menangkap `Escape` akan mencurinya dari `xterm` persis saat pengguna paling membutuhkannya.
Ditandai komentar `ponytail:` di kode supaya tak "diperbaiki" belakangan.

## Architecture

Satu state boolean, nol modul baru:

```tsx
const [maxed, setMaxed] = React.useState(false);
```

### 1. Container

```tsx
<div style={{
  display: "flex", flexDirection: "column", gap: maxed ? 8 : 12,
  ...(maxed
    ? { position: "fixed", inset: 0, zIndex: 100, background: "var(--surface-page)", padding: 12 }
    : { height: "calc(100vh - 180px)" }),
}}>
```

`inset: 0` menentukan tinggi, jadi `height` tak disetel saat `maxed` — menyetel keduanya akan
bertabrakan. `zIndex: 100` dipilih terhadap nilai yang sudah ada di DS: tooltip `40`
(`ds/components/feedback.tsx:130`), modal `150` dan toast `200` (`ds/kit.tsx:54,29`). Overlay harus di
atas konten halaman tapi **di bawah** modal — kalau tidak, dialog konfirmasi terkubur di belakang
terminal.

### 2. Chrome jadi satu baris

Hari ini tabbar dan toolbar adalah dua anak berurutan. Keduanya dibungkus satu wrapper yang membalik
arah:

```tsx
<div style={{ display: "flex", gap: 8, flexDirection: maxed ? "row" : "column",
              alignItems: maxed ? "center" : "stretch" }}>
  <GroupTabs compact={maxed} … />
  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                ...(maxed && { flex: 1, minWidth: 0 }) }}>
    …+ Kolom, + Baris, spacer flex:1, Select project, Sesi baru, tombol maximize…
  </div>
</div>
```

Toolbar sudah memuat `<div style={{ flex: 1 }} />` sebagai spacer, jadi `Select`, `Sesi baru`, dan
tombol maximize terdorong ke kanan tanpa kode baru. `GroupTabs` menerima satu prop `compact` yang
mematikan `borderBottom` + `paddingBottom`-nya saat baris digabung; tanpa itu ada garis melintang di
tengah baris.

Grid mewarisi sisa tinggi lewat `flex: 1; minHeight: 0` yang sudah ada.

### 3. Tombol

```tsx
<IconButton size="sm" icon={maxed ? "minimize-2" : "maximize-2"}
  label={maxed ? "Keluar layar penuh" : "Layar penuh"}
  aria-pressed={maxed} onClick={() => setMaxed((m) => !m)} />
```

`IconButton` (`ds/components/forms.tsx`) sudah memetakan `label` → `aria-label` + `title`, dan
meneruskan `...rest` sehingga `aria-pressed` sampai ke DOM. Ikon lucide: `maximize-2` → `Maximize2`,
`minimize-2` → `Minimize2` (peta PascalCase di `ds/icon.tsx`).

### 4. Yang tidak perlu disentuh

`TerminalPane` memasang `ResizeObserver` yang memanggil `fit()` lalu mengirim `{t:"resize"}` ke server
(`TerminalPane.tsx:43-47`). Container membesar → xterm menghitung ulang kolom/baris dan tmux ikut
diresize. Nol kode, nol perubahan server.

## Konsekuensi yang perlu dijaga

- **Overlay menutupi `Shell`, bukan melepas `TerminalScreen` darinya.** Screen tetap anak `Shell` di
  pohon React; hanya secara visual ia menimpanya. Nav sidebar jadi tak terjangkau selama `maxed` —
  itu memang tujuannya, dan tombol keluar selalu terlihat di ujung baris chrome.
- **Body di belakang overlay masih bisa di-scroll** dengan roda mouse di beberapa browser. Overlay
  menutupi seluruh viewport jadi tak terlihat; mengunci `body` menambah efek samping global untuk
  masalah yang tak tampak. Dilewati sadar, bukan lupa.
- **`maxed` hilang saat reload.** Disengaja. Menambahkannya ke `Workspace` akan mencampur state
  tampilan dengan tata letak yang dipersist.

## Out of scope

- `requestFullscreen()` + `navigator.keyboard.lock` (alasan di atas).
- Maximize **satu sel** (fokus ke satu terminal, sembunyikan sel lain). Kebutuhan berbeda; grid sudah
  bisa disusutkan jadi 1×1 lewat gutter `×` (SPEC-161).
- Menyembunyikan chrome saat idle / muncul saat hover. Ditolak: kontrol tersembunyi tak terjangkau
  keyboard tanpa menambah shortcut sendiri.
- Shortcut keyboard untuk toggle. Bisa ditambah nanti — tapi bukan `Escape`, dan bukan tanpa
  memeriksa ia tak bentrok dengan keybinding Claude Code.
- Persistensi `maxed`; mengunci scroll `body`; perubahan `Shell`.

## Testing

- **`terminal-screen.test.tsx` (diperbarui)** — `describe("TerminalScreen (layar penuh)")`:
  - klik `Layar penuh` → container root ber-`position: fixed` dan `z-index: 100`; label tombol
    berbalik jadi `Keluar layar penuh`, `aria-pressed="true"`.
  - di dalam mode maximize, `+ Kolom`, `Sesi baru`, tab grup, dan `×` gutter **masih ada**; klik
    `+ Kolom` benar-benar menambah kolom (regresi paling mungkin: chrome dilebur lalu tombolnya
    hilang atau tak terhubung).
  - `fireEvent.keyDown(document, { key: "Escape" })` → **tetap** maximize. Ini test yang menjaga
    keputusan, bukan implementasi.
  - klik `Keluar layar penuh` → kembali ke `position: static`/tanpa `fixed`.
- **Smoke browser nyata (CDP)** — fase Execute: ukur `getBoundingClientRect()` sel grid sebelum dan
  sesudah maximize (harus membesar), pastikan sidebar `<aside>` dan `<header>` tak lagi terlihat
  (tertutup overlay), dan `.xterm` masih ter-mount dengan sesi yang sama (bukan remount).
  Sesi uji memakai tmux `sh`, bukan `claude` — alasan di plan SPEC-161 Task 5.

## Open questions

Tidak ada. Dua keputusan yang tadinya terbuka sudah dikunci bersama pengguna: maximize dalam app
(bukan Fullscreen API) dan chrome satu baris ramping (bukan auto-hide, bukan tiga baris apa adanya).
