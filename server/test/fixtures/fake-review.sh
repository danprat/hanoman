#!/bin/sh
# SPEC-474 · berdiri sebagai agen yang menampilkan LAYAR REKAP sebuah dialog `AskUserQuestion`
# berantai. Salinan tangkapan `capture-pane` sungguhan dari claude 2.1.220 — termasuk yang paling
# menentukan: layar ini TIDAK punya baris footer chord, jadi parser SPEC-452 (yang berpangkal pada
# footer) tak pernah melihatnya.
#
# Seperti fake-dialog.sh ia SENGAJA hanya meng-echo (`exec cat`): yang diuji adalah apa yang
# benar-benar DIKIRIM hanoman ke pane — satu digit, tanpa prosa dan tanpa Enter.
cat <<'SCREEN'
←  ☒ Warna  ☒ Ukuran  ✔ Submit  →

Review your answers

 ● Pilih warna tema?
   → Merah, karena kontrasnya paling tinggi.

Ready to submit your answers?

❯ 1. Submit answers
  2. Cancel
SCREEN
exec cat
