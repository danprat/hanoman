#!/bin/sh
# Berdiri sebagai `codex` di test PTY (SPEC-397 · ADR-0085). Seperti fake-claude.sh ia mencetak
# argv-nya lalu meng-echo stdin, TAPI ia juga memancarkan penanda runtime goal codex begitu
# menerima baris `/goal …` — persis yang dilakukan codex sungguhan (`• Goal active  Objective: …`
# di transcript + `Pursuing goal (Ns)` di status line).
#
# Kenapa bukan `exec cat`: yang diuji justru bahwa hanoman TIDAK menganggap sesi ter-arm hanya
# karena pane memuat teks `/goal`. fake-claude.sh tetap dipakai sebagai kontrol negatif.
echo "args: $*"
while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    */goal*) printf 'Goal active  Objective: diterima\nPursuing goal (1s)\n' ;;
  esac
done
