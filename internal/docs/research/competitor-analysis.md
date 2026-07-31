# Competitor analysis

hanoman tidak berjualan, jadi "kompetitor" di sini berarti **cara lain menyelesaikan pekerjaan yang
sama**: menjalankan agen coding terhadap banyak repo tanpa kehilangan kendali dan tanpa docs jadi usang.

## Pembanding

### 1. Menjalankan `claude` / `codex` CLI manual per repo

Cara paling langsung, dan tetap jadi dasar hanoman sendiri — mesin eksekusinya memang CLI yang sama.

Sudah memberi: kualitas agen penuh, steer interaktif, biaya nol tambahan.
Tidak memberi:
- **Satu tempat memantau.** Sepuluh repo = sepuluh terminal; tak ada jawaban untuk "apa yang sedang
  berjalan dan mana yang macet".
- **Isolasi otomatis.** Agen bekerja di working tree yang sedang dipakai manusia. hanoman menaruh tiap
  backlog di worktree sendiri ([ADR-0002](../adr/0002-git-worktree-isolation.md)).
- **Sesi yang bertahan.** Tutup terminal, sesi hilang. Di hanoman sesi hidup di tmux dan bertahan lintas
  restart API ([ADR-0016](../adr/0016-sesi-terminal-hidup-di-tmux.md)).
- **Backlog yang jadi antrean.** Tak ada jembatan dari "bug dilaporkan" ke "sesi berjalan".

### 2. CI generik (GitHub Actions dan sejenisnya)

Sudah memberi: eksekusi terjadwal, log terpusat, isolasi runner.
Tidak memberi:
- **Interaktivitas.** Job CI tak bisa di-steer di tengah jalan; agen yang butuh keputusan manusia hanya
  bisa gagal atau menebak. Kontrak hanoman kebalikannya — sesi berhenti untuk bertanya
  ([ADR-0035](../adr/0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md)).
- **Kredensial agen yang wajar.** Sesi hanoman memakai auth harian operator di mesinnya sendiri.
- **State pekerjaan.** CI berpikir dalam commit; pekerjaan agen berpikir dalam **fase** (brainstorm →
  objective → spec → plan → execute) yang berlangsung berjam-jam dalam satu sesi.

### 3. Orkestrator agen / "AI dev platform" lain

Sudah memberi: fan-out banyak agen, dashboard, kadang worktree.
Tidak memberi (atau memberi dengan bentuk berbeda):
- **Dokumentasi sebagai kontrak yang terukur.** Kebanyakan memperlakukan docs sebagai keluaran. Di
  hanoman docs adalah masukan yang wajib diperbarui bersama kodenya, dengan coverage yang diturunkan
  langsung dari filesystem ([ADR-0011](../adr/0011-docs-realtime-filesystem.md)/[0018](../adr/0018-coverage-nilai-turunan.md)).
- **Agnostik agen.** hanoman menjalankan claude **maupun** codex dari setelan yang sama
  ([ADR-0074](../adr/0074-codex-sebagai-mesin-sesi.md)); pilihan model & effort hidup per sesi
  ([ADR-0061](../adr/0061-model-effort-per-sesi-picker-start.md)).
- **Self-hosted penuh.** Satu proses + satu Postgres di host sendiri, tanpa layanan pihak ketiga di
  jalur eksekusi.

## Celah yang hanoman isi

1. **Docs-as-SoT yang terukur** — coverage per kategori, index sebagai registry, docs diperbarui dalam
   commit yang sama. Konvensi sejak [ADR-0023](../adr/0023-guardrail-sot-dicabut.md), bukan lagi gerbang
   mekanis: yang dijaga adalah kebiasaan, bukan blokade.
2. **Satu panel lintas project** — backlog, sesi, error, tiket, VPS, dan docs dalam satu instrumen.
3. **Kendali live** — steer, interupsi, dan `/model` manual di dalam sesi yang sedang berjalan.
4. **Isolasi murni worktree** — satu-satunya batas keamanan yang tersisa setelah guardrail perintah
   dicabut ([ADR-0037](../adr/0037-cabut-guardrail-safety.md)).
5. **Jembatan masuk** — Help Center menyuapi backlog: laporan pengguna jadi spec tanpa
   menyalin-tempel manual.

## Yang jujur harus disebut

Tak satu pun poin di atas mustahil ditiru sendiri-sendiri; semuanya adalah rekayasa yang wajar.
Nilainya ada pada **kombinasi yang sudah jadi dan sudah dipakai** — lihat [moat](moat.md).
