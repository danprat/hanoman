#!/bin/sh
# SPEC-337 · berdiri sebagai agen (claude/codex) di test PTY dan MEMBUKTIKAN env sesi sampai ke
# prosesnya: argv + kunci/URL audit dicetak ke layar pane. Tetap hidup meng-echo stdin, sama
# seperti fake-claude.sh (pane mati seketika akan lomba dengan pembacaan capture-pane).
echo "args: $*"
echo "HANOMAN_AUDIT_KEY=$HANOMAN_AUDIT_KEY"
echo "HANOMAN_AUDIT_URL=$HANOMAN_AUDIT_URL"
exec cat
