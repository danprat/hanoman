# Audit SPEC-289 — teks di terminal tidak bisa di-copy

**Sumber**: qa · **Prioritas**: tinggi · **Severity**: major
**Status**: Resolved (Spec & Plan skipped — temuan berconfidence tinggi, diff kecil, akar jelas)

## Keluhan
Teks yang diselect di terminal (sesi Claude maupun **Terminal biasa**) tidak bisa disalin.
Ekspektasi: teks yang di-select bisa di-copy.

## Root cause
`src/src/screens/TerminalPane.tsx` membuka `@xterm/xterm` (`new Terminal(...)`) tetapi **tidak
pernah mem-wiring perilaku salin**. xterm.js merender seleksinya **sendiri** (di canvas), bukan
seleksi native browser — jadi Cmd+C / Ctrl+C browser tak menyalin apa pun. Docs xterm eksplisit:
`getSelection()` disediakan *"for implementing copy behavior outside of xterm.js"* — artinya app
yang wajib menyalin manual (`navigator.clipboard.writeText(term.getSelection())`).

Sebelum fix, satu-satunya key handler adalah `term.onData((d) => send(...))` yang meneruskan tiap
input ke PTY. Cmd+C (macOS) tak menghasilkan `onData`, dan Ctrl+C dikirim sebagai `\x03` (SIGINT) —
tak ada satu pun jalur yang menyalin seleksi ke clipboard. Seleksi dengan mouse **berfungsi** (default
`SelectionService` xterm menyala), tapi tak ada cara menyalinnya keluar. Itulah bug-nya.

Kedua jenis sesi (Claude & Terminal biasa) memakai `TerminalPane` yang sama → keduanya terdampak,
konsisten dengan laporan.

## Fix (diff kecil, tanpa perubahan skema, tanpa ADR)
- `src/src/screens/terminal-clipboard.ts` (baru): helper murni `clipboardIntent(event, hasSelection)`
  → `"copy" | "paste" | null`. Combo salin/tempel = **Cmd** (macOS) atau **Ctrl+Shift** (Windows/Linux).
  **Ctrl polos sengaja dilewatkan** agar Ctrl+C tetap SIGINT dan Ctrl+V tetap literal (milik TUI).
  Copy hanya aktif bila ada seleksi. Dipisah sebagai fungsi murni supaya teruji tanpa canvas/jsdom.
- `src/src/screens/TerminalPane.tsx`: `term.attachCustomKeyEventHandler` memanggil `clipboardIntent`;
  `"copy"` → `navigator.clipboard.writeText(term.getSelection())` lalu `return false` (jangan
  teruskan ke PTY); `"paste"` → `navigator.clipboard.readText()` lalu kirim sebagai input; selain itu
  `return true` (biarkan xterm/PTY memproses, termasuk Ctrl+C = SIGINT).
- `src/test/terminal-clipboard.test.ts` (baru): 9 test — Cmd+C dengan/ tanpa seleksi, Ctrl+Shift+C,
  Ctrl+C polos tetap SIGINT, Cmd+V, Ctrl+Shift+V, Ctrl+V polos, abaikan keyup, abaikan tombol lain.

`navigator.clipboard` butuh secure context — app disajikan lewat https (VPS) dan localhost, keduanya
secure context, jadi tersedia.

## Verifikasi
- `terminal-clipboard.test.ts` 9/9 hijau; `terminal-screen.test.tsx` 44/44 tetap hijau.
- `tsc --noEmit` exit 0; `vite build` sukses.
- Perubahan murni frontend (nol endpoint server tersentuh), jadi verifikasi lewat unit test +
  typecheck + build, bukan curl.
