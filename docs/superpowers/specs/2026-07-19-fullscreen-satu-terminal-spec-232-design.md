# SPEC-232 — Fullscreen 1 terminal (modal per-sesi)

Prioritas: **tinggi** · Sumber: brief · Alur: fitur (spec → plan → execute)

## Objective

Operator bisa memfokuskan **satu terminal yang dituju** ke tampilan besar tanpa harus
menutup sel lain atau memaksimalkan seluruh grid. Aksi **fullscreen per-sel** membuka
terminal itu dalam sebuah **modal** yang menutupi layar, lalu ditutup kembali ke posisi
selnya semula.

## Konteks

`TerminalScreen` (`src/src/screens/TerminalScreen.tsx`) merender sesi dalam **grid sel**;
tiap `Cell` memasang satu `TerminalPane` yang membuka **satu WebSocket** ke tmux. Sudah ada
tombol **"Layar penuh"** di toolbar (state `maxed`, SPEC-163) — tapi itu memaksimalkan
**seluruh grid** (overlay `position:fixed; z-index:100`), **bukan** satu terminal. Belum ada
cara mengklik satu terminal untuk melihatnya sendiri secara penuh. Itulah yang ditambah di sini.

Dua batasan teknis yang membentuk desain:

1. **Satu sesi = paling banyak satu attach.** Dua `TerminalPane` untuk sesi yang sama membuat
   tmux menyusut ke klien terkecil (window size = min semua klien) → terminal berkedip /
   ukuran salah. Karena itu saat satu terminal difullscreen-kan, pane di **selnya harus
   dilepas** dulu; hanya pane di modal yang memegang WS.
2. **Escape milik terminal.** Escape adalah tombol tersibuk di TUI Claude Code (interupsi/batal).
   DS `Modal` mengikat Escape→close secara default; untuk terminal, itu harus dimatikan —
   konsisten dengan alasan tombol maximize-grid sengaja tak meng-bind Escape.

## Desain

Fitur ini **murni frontend** + satu prop opsional di DS `Modal`. Tanpa perubahan server,
kontrak API, maupun data model. Tanpa ADR (bukan keputusan arsitektural; sejajar SPEC-163).

### 1. DS `Modal` — prop `closeOnEscape`

`ds/kit.tsx`: tambah `closeOnEscape?: boolean` (default `true`, backward-compatible).
Effect pengikat Escape hanya jalan bila `closeOnEscape` true. Prop ini reusable untuk modal
mana pun yang memuat editor/terminal yang butuh Escape.

### 2. `TerminalScreen` — state fullscreen

- `const [fullId, setFullId] = useState<string | null>(null)` — id sesi yang sedang penuh;
  **tak dipersist** (sama seperti `maxed`, SPEC-163).
- Effect pembersih: bila `fullId` tak lagi menunjuk sesi yang ada di daftar `sessions`
  (di-kill / hilang lewat frame WS), reset `fullId` ke `null`.

### 3. `Cell` — pemicu + supresi pane

- Prop baru `onFullscreen: () => void` dan `fullscreen: boolean`.
- Header sel dapat satu ikon `fullscreen` (lucide, size 12) `aria-label="Layar penuh sesi <id>"`,
  ditaruh sebelum aksi *lepas*. Klik → `onFullscreen()`.
- Saat `fullscreen === true`: badan sel merender **placeholder** ("Terbuka di layar penuh")
  **bukan** `TerminalPane`. Ini menjaga invariant satu-attach — pane hidup hanya di modal.

### 4. `FullscreenTerminal` — modal per-sesi

Komponen baru di `TerminalScreen.tsx`, dirender oleh `TerminalScreen` saat
`fullId && byId(fullId)`:

- Membungkus DS `Modal` dengan `closeOnEscape={false}`, `icon="terminal"`,
  `title` = label sesi (project · specId · id pendek), lebar besar (clamp `maxWidth:100%`).
- Isi: `<div>` bertinggi eksplisit (mis. `72vh`) berisi `<TerminalPane key={fullId} …>` agar
  `FitAddon` punya ruang mengisi.
- `onClose` (tombol `×` / klik backdrop) → `setFullId(null)`. Menutup modal memasang ulang
  pane di sel (reconnect WS murah; scrollback dipegang tmux — sama seperti pindah grup).

### Alur data

```
klik ikon fullscreen di Cell  → onFullscreen() → setFullId(session.id)
  ├─ Cell(fullId===id): pane dilepas, tampil placeholder
  └─ TerminalScreen: render <FullscreenTerminal sessionId=fullId> (pane hidup di modal)
klik × / backdrop             → setFullId(null) → pane kembali ke Cell (reconnect)
sesi hilang (frame WS)        → effect: fullId tak valid → setFullId(null)
```

## Alternatif yang dipertimbangkan & ditolak

- **React portal memindah pane cell→modal tanpa remount** (menjaga WS tetap hidup): lebih
  rumit (ref/portal, modal kondisional) demi menghindari reconnect yang sebenarnya murah dan
  sudah menjadi pola aplikasi (pindah grup menutup+membuka ulang WS). Ditolak demi kesederhanaan.
- **Membangun overlay khusus (bukan DS Modal)**: spec meminta bentuk "modal"; DS Modal memberi
  backdrop redup, klik-luar, dan tombol tutup gratis + konsisten desain. Reuse + satu prop
  (`closeOnEscape`) lebih kecil dan reusable.
- **Membiarkan dua attach** (tak melepas pane sel): menyusutkan window tmux ke ukuran sel kecil
  → fullscreen tapi konten mungil. Ditolak (melanggar invariant satu-attach).

## Testing

- **DS Modal** (`src/test/ds.test.tsx`): `closeOnEscape={false}` → Escape tak memanggil
  `onClose`; default → Escape memanggil `onClose`.
- **TerminalScreen** (`src/test/terminal-screen.test.tsx`):
  - Header sel punya kontrol "Layar penuh sesi <id>"; klik membuka modal berisi pane sesi itu.
  - Saat modal terbuka, tetap **tepat satu** `data-testid="pane"` (pane pindah sel→modal).
  - Tombol tutup modal (`×`) menutupnya; pane kembali ke sel.
  - Escape **tidak** menutup modal fullscreen (Escape milik terminal).

## Definition of done

- Test hijau (`vitest run`).
- `internal/docs/frontend/frontend-implementation.md` diperbarui (bagian Terminal) + tetap
  ter-link di `internal/docs/README.md`.
- Diff bersih di worktree, siap push ke `hanoman/spec-232`.
