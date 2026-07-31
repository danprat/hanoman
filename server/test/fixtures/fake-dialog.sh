#!/bin/sh
# SPEC-452 · berdiri sebagai agen yang sedang menampilkan dialog `AskUserQuestion`. Layarnya
# menyalin tangkapan `capture-pane` sungguhan dari claude 2.1.220: tiga opsi, kolom jawaban bebas
# di nomor 4, "Chat about this" di nomor 5, footer chord di baris terakhir.
#
# Ia SENGAJA hanya meng-echo (`exec cat`), tidak meniru widget-nya: yang diuji di sini adalah
# apa yang benar-benar DIKIRIM hanoman ke pane (nomor barisnya lebih dulu, sebagai keystroke
# tersendiri) dan bahwa `Enter` TIDAK ditekan saat teksnya tak mendarat di kolom bebas.
cat <<'SCREEN'
Mau pakai strategi cache yang mana?

❯ 1. In-memory
  2. Redis
  3. Tanpa cache
  4. Type something.
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
SCREEN
exec cat
