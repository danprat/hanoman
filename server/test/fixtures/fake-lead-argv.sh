#!/bin/sh
# SPEC-488 · agen lead palsu yang MEREKAM ARGV-nya. Sengaja berbeda dari dua fixture yang sudah ada:
#
#   - `fake-claude.sh` diakhiri `exec cat` karena mensimulasikan TUI di pane tmux. Memakainya untuk
#     agen one-shot membuat setiap panggilan `think()` selalu "kehabisan waktu" — hijau dan merah
#     tak terbedakan (jebakan SPEC-448).
#   - `fake-lead-agent.sh` keluar sendiri, tapi mencetak `args:` ke stdout dan TAK PERNAH
#     mengeluarkan blok ```json. `decide()` karena itu berhenti di parser (`parseLeadVerdict` → null)
#     dan mencatat baris `gagal` sebelum sempat membuktikan apa pun tentang setelan.
#
# Yang ini merekam argv ke berkas LALU mencetak putusan yang SAH, sehingga rantai
# Setting.lead.engine → leadAgentDefaults() → leadArgv() → proses bisa diperiksa dari ujung ke ujung.
#
# Argumen TERAKHIR sengaja tak direkam: itu prompt lead (±10 KB, memuat baris baru) dan
# menuliskannya akan mencemari berkas rekaman yang dibaca per baris.
if [ -n "$HANOMAN_LEAD_ARGV_FILE" ]; then
  n=$#
  i=1
  for a in "$@"; do
    if [ "$i" -lt "$n" ]; then printf '%s\n' "$a" >>"$HANOMAN_LEAD_ARGV_FILE"; fi
    i=$((i + 1))
  done
fi
# Bukti stdin ditutup pemanggil (SPEC-448): tanpa `stdin.end()` di brain.ts, `cat` menggantung
# sampai timeout dan test ini akan gagal karena kehabisan waktu, bukan karena argv-nya salah.
cat >/dev/null
printf '```json\n{"decision":"lanjut","reason":"argv terekam","confidence":"tinggi"}\n```\n'
