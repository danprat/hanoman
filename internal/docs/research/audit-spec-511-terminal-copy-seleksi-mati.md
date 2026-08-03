# Audit SPEC-511 — teks di terminal sesi tidak bisa di-copy

**Sumber:** QA finding SPEC-511 (prioritas tinggi, severity major)
**Gejala dilaporkan:** "Seleksi teks tidak bisa dilakukan / hasil copy kosong, sehingga output log
sesi tidak bisa diambil manual." macOS, dashboard hanoman (React+Vite), pane terminal WebSocket PTY
lewat tmux.
**Keputusan:** Spec & Plan **skipped** — akar tunggal, terukur, diff kecil di satu berkas frontend.
Tanpa ADR, tanpa skema, tanpa migration, tanpa endpoint. **ADR-0016 & SPEC-209 ditegakkan, bukan
diamandemen** (`mouse on` tetap menyala).

## Ringkasan

Bukan seleksi yang gagal disalin — **seleksi tak pernah lahir**. Sejak SPEC-209 (14 Jul 2026)
`pty.ts` menyetel tmux `mouse on` supaya wheel di browser diteruskan ke copy-mode tmux; tmux
membayar itu dengan **menyalakan mouse-reporting di terminal klien**, dan xterm.js **mematikan
`SelectionService`-nya** setiap kali sebuah protokol mouse aktif. Satu-satunya jalan keluar yang
disediakan xterm.js di macOS adalah `altKey && macOptionClickForcesSelection` — opsi yang **default
`false`** dan tak pernah disetel hanoman. Hasilnya di macOS: drag polos tak menyeleksi, Option+drag
juga tak menyeleksi, `term.hasSelection()` selamanya `false`, sehingga `clipboardIntent()` (SPEC-289)
mengembalikan `null` untuk `C` dan Cmd+C diteruskan ke TUI tanpa menyentuh clipboard. Wiring salin
SPEC-289 **benar dan tak pernah bisa jalan**, karena premisnya ("Seleksi mouse jalan, tapi tak ada
jalur menyalinnya", commit `799d683b`, 22 Jul) sudah salah delapan hari sebelum commit itu ditulis.

Linux/Windows tak terkena: di sana `shouldForceSelection` mengembalikan `event.shiftKey` **tanpa
syarat opsi apa pun**, jadi Shift+drag sudah bekerja. Laporan yang menyebut macOS karena itu bukan
kebetulan — ia justru tanda tangan bug-nya.

## Bukti

### 1. tmux `mouse on` memang memancarkan DECSET mouse ke terminal klien

Diukur langsung, bukan dari dokumentasi: sebuah sesi tmux nyata (socket terpisah, `-f /dev/null`
supaya konfigurasi pengguna tak ikut) di-`attach` lewat node-pty, seluruh byte yang keluar direkam,
lalu setiap `ESC [ ? <n> h|l` dihitung. Satu-satunya variabel: `set-option -g mouse`.

| mode | `?1000h` | `?1002h` | `?1006h` | total byte |
|---|---|---|---|---|
| `mouse on` | **2** | **2** | **2** | 816 |
| `mouse off` | 0 | 0 | 0 | 704 |

Dengan `mouse off` yang muncul hanya bentuk **reset** (`?1000l ?1002l ?1003l ?1006l`). Jadi
`mouse on` = X10/normal button tracking + button-event tracking + koordinat SGR, dinyalakan di
terminal klien — persis yang ditulis komentar SPEC-209 di `pty.ts:404-409`.

### 2. xterm.js mematikan seleksi begitu protokol mouse aktif

`@xterm/xterm` 6.0.0, `src/browser/CoreBrowserTerminal.ts:727-739`:

```ts
this._register(this.coreMouseService.onProtocolChange(events => {
  if (events) { this.element!.classList.add('enable-mouse-events'); this._selectionService!.disable(); }
  else        { this.element!.classList.remove('enable-mouse-events'); this._selectionService!.enable(); }
```

`src/browser/services/SelectionService.ts:437-470`:

```ts
public shouldForceSelection(event: MouseEvent): boolean {
  if (Browser.isMac) return event.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection;
  return event.shiftKey;
}
…
public handleMouseDown(event: MouseEvent): void {
  …
  if (!this._enabled) { if (!this.shouldForceSelection(event)) { return; } … }
```

`src/common/services/OptionsService.ts:41` — `macOptionClickForcesSelection: false` (default).
`TerminalPane.tsx` tak pernah menyetelnya.

### 3. Terukur di Chrome sungguhan di macOS

Halaman probe memuat `@xterm/xterm` 6.0.0 apa adanya, menulis 20 baris teks, lalu
**sekuens yang diukur di bukti 1** (`\x1b[?1000h\x1b[?1002h\x1b[?1006h`), lalu men-drag dengan
`mousedown → mousemove → mouseup`. Dua terminal identik kecuali satu opsi.

| konfigurasi | drag polos, **sebelum** mouse-mode | drag polos, **sesudah** mouse-mode | **Option**+drag, sesudah mouse-mode |
|---|---|---|---|
| `TerminalPane` hari ini (default) | ✅ 149 char | ❌ 0 char | ❌ **0 char** |
| + `macOptionClickForcesSelection: true` | ✅ 149 char | ❌ 0 char | ✅ **149 char** |

(`navigator.userAgent` = Macintosh, jadi cabang `Browser.isMac` yang diambil.) Baris pertama adalah
kontrol negatif: mesin seleksi xterm sehat sempurna — yang mematikannya semata-mata mouse-reporting.
Sel yang tebal adalah bug-nya dan perbaikannya, dalam satu variabel.

### 4. Rantai sampai ke gejala "hasil copy kosong"

`term.hasSelection()` → `SelectionService.hasSelection` → selamanya `false`. `TerminalPane.tsx:62`
memanggil `clipboardIntent(e, term.hasSelection())`, dan `terminal-clipboard.ts:16` berbunyi
`if (k === "c") return hasSelection ? "copy" : null`. Jadi Cmd+C **selalu** `null` → handler
`return true` → tombolnya diteruskan ke TUI, clipboard tak pernah disentuh. Jalur native xterm
(`CoreBrowserTerminal.ts:334`, listener `copy` yang mengisi clipboard dari seleksi) juga diam karena
alasan yang sama: tak ada seleksi. **Dua jalur salin, satu penyebab.**

### 5. Mematikan `mouse on` bukan alternatif

Biner `claude` 2.1.220 memuat literal `\x1b[?1000h\x1b[?1006h` — TUI agen **menyalakan
mouse-reporting sendiri**. Dengan tmux `mouse off`, mode milik aplikasi dalam pane tetap diteruskan
ke terminal klien, jadi seleksi tetap mati sementara scroll riwayat SPEC-209 hilang: menukar satu bug
dengan dua. Levernya harus di sisi klien.

## Perbaikan

Satu opsi di titik lahir terminal + satu petunjuk supaya modifiernya bisa ditemukan.

1. **`macOptionClickForcesSelection: true`** di `new Terminal({…})` (`TerminalPane.tsx`). Inilah guna
   opsi itu — typings xterm menyebut contohnya persis kasus ini: *"this allows you to use xterm.js'
   regular selection inside tmux with mouse mode enabled"*. Konsekuensi sadar: di macOS, Option+drag
   berhenti berarti **block/column select** (`shouldColumnSelect`, `SelectionService.ts:592`) —
   pertukaran yang murah, karena hari ini Option+drag tak melakukan apa pun sama sekali. Non-macOS
   tak tersentuh satu cabang pun (`shouldForceSelection` di sana tak membaca opsi ini, dan
   `shouldColumnSelect` menjaga `altKey` lewat penjaga `Browser.isMac`).
2. **Petunjuk di header sel** (`TerminalScreen.tsx`, ikon `clipboard` ber-`title`): modifier yang
   tak terlihat sama saja dengan tak ada. Ini permukaan yang sama tempat semua affordance sel lain
   hidup (`file-text`, `git-compare`, `git-merge`, layar penuh, lepas, ×).

**Sengaja TIDAK dikerjakan:** fallback untuk `navigator.clipboard` yang absen (konteks non-secure,
mis. dashboard dibuka lewat `http://<IP-LAN>:8787`). Ia hazard nyata dan sudah tercatat di
`frontend-implementation.md`, tapi **bukan penyebab temuan ini** (macOS lokal = localhost/https =
secure context), dan satu-satunya fallback yang murah — meneruskan tombolnya ke xterm — akan
mengirim `\x03` untuk `Ctrl+Shift+C` di Linux/Windows, yakni menukar "diam" dengan **SIGINT ke agen
yang sedang bekerja**. Ditinggalkan sebagai temuan terpisah bila pernah benar-benar terjadi.

## Test yang mengikat

`src/test/terminal-pane.test.tsx` (baru) me-mock `@xterm/xterm` lalu me-render `TerminalPane` dan
memeriksa **opsi yang benar-benar sampai ke konstruktor**, bukan sebuah helper murni yang menguji
dirinya sendiri: tanpa `macOptionClickForcesSelection: true` di call site, seleksi mati lagi tanpa
satu test pun berubah warna. Test yang sama mengunci jalur salin/tempel dari sisi handler
(`hasSelection()` benar → clipboard ditulis, tombolnya tak diteruskan) — `terminal-clipboard.test.ts`
sudah menjaga helper-nya dan tetap apa adanya.
