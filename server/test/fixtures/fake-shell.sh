#!/bin/sh
# Berdiri sebagai shell biasa di test PTY: cetak marker (agar test membuktikan shell mentah
# dijalankan, bukan claude), lalu tetap hidup meng-echo stdin — cermin fake-claude.sh.
echo "SHELL-BIASA-SIAP"
exec cat
