#!/bin/sh
# SPEC-402 · berdiri sebagai `tmux` yang GAGAL karena sebab lain — bukan "tak ada server".
# Dipakai untuk membuktikan bahwa kegagalan invokasi tmux tidak boleh dibaca sebagai
# "tidak ada sesi sama sekali" (yang menyiarkan `exit 0` ke setiap terminal yang terbuka).
# Pesannya sengaja meniru kegagalan sumber daya, keadaan yang nyata saat mesin penuh proses.
echo "tmux: fork failed: Resource temporarily unavailable" >&2
exit 1
