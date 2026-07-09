#!/bin/sh
# Berdiri sebagai `claude` di test PTY: cetak argv-nya (agar test bisa membuktikan
# --dangerously-skip-permissions benar-benar diteruskan), lalu tetap hidup meng-echo
# stdin. /bin/cat tidak bisa dipakai — ia mati seketika karena flag itu ilegal baginya.
echo "args: $*"
exec cat
