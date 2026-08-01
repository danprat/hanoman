#!/bin/sh
# SPEC-472 · berdiri sebagai agen one-shot yang DITOLAK: Claude Code mencetak
# "Invalid API key · Fix external API key" di STDOUT (bukan stderr) lalu exit 1.
# Bentuk itu — keterangan di stdout, stderr kosong, exit non-nol — adalah yang membuat
# alasan gagal lead tak terbaca sebelum spec ini. Terukur in-vivo pada claude 2.1.220.
echo "Invalid API key · Fix external API key"
exit 1
