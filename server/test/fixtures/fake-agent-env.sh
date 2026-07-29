#!/bin/sh
# SPEC-337 · berdiri sebagai agen (claude/codex) di test PTY dan MEMBUKTIKAN env sesi sampai ke
# prosesnya: argv + kunci/URL audit dicetak ke layar pane. Tetap hidup meng-echo stdin, sama
# seperti fake-claude.sh (pane mati seketika akan lomba dengan pembacaan capture-pane).
echo "args: $*"
echo "HANOMAN_AUDIT_KEY=$HANOMAN_AUDIT_KEY"
echo "HANOMAN_AUDIT_URL=$HANOMAN_AUDIT_URL"
# SPEC-376 · env scope verifikasi. Env sesi dipasang sebagai PREFIX shell di depan argv, jadi
# ia tak pernah muncul di `echo "$*"` — satu-satunya cara membuktikannya adalah membacanya dari
# dalam proses, seperti ini.
echo "HANOMAN_BASE_SHA=$HANOMAN_BASE_SHA"
echo "HANOMAN_VERIFY_SCOPE=$HANOMAN_VERIFY_SCOPE"
exec cat
