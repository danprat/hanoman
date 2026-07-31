#!/bin/sh
# SPEC-448 · berdiri sebagai agen ONE-SHOT lead (`claude -p` / `codex exec`). Beda sengaja dari
# fake-claude.sh: yang itu `exec cat` selamanya karena mensimulasikan TUI di pane tmux, sementara
# `brain.think()` memakai execFile bertimeout — agen yang tak pernah keluar akan selalu terbaca
# "kehabisan waktu" dan tak ada satu pun test yang bisa membedakan sukses dari gagal.
echo "args: $*"
# Bukti gerbang root claude (rootBypassEnv). Kosong di mesin non-root; "1" saat uid 0.
echo "IS_SANDBOX=${IS_SANDBOX:-}"
# Bukti stdin. Pemanggil tak pernah mengirim apa pun lewat stdin, jadi anak WAJIB melihat EOF
# seketika. Bila pipa stdin dibiarkan menganga (execFile tanpa `stdin.end()`), `cat` di bawah
# menggantung sampai timeout — persis bentuk yang membuat claude sungguhan memperingatkan
# "no stdin data received in 3s".
cat >/dev/null
echo "stdin: EOF"
