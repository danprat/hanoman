#!/bin/sh
# SPEC-474 · berdiri sebagai agen yang menampilkan varian `AskUserQuestion` yang opsinya
# ber-`preview`: hanya opsi yang bernomor, TANPA baris "Type something.", "Chat about this" tanpa
# nomor, dan prosa masuk lewat kolom catatan (tombol `n`) — footer chord-nya yang menyebutkannya.
#
# Sama seperti fake-dialog.sh: hanya meng-echo, karena yang diuji adalah apa yang DIKIRIM hanoman.
cat <<'SCREEN'
←  ☐ Loop  ☐ Nama  ✔ Submit  →

Pakai for atau map?

❯ 1. for
  2. map

                    Notes: press n to add notes

  Chat about this

Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel
SCREEN
exec cat
