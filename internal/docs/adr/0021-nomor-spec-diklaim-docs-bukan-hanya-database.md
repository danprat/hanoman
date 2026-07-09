# ADR-0021 — Nomor SPEC diklaim oleh docs, bukan hanya oleh database

**Status:** diterima · menggantikan asumsi implisit di [ADR-0001](0001-docs-as-source-of-truth.md)

## Konteks

`nextSpecId()` dulu mencetak `SPEC-${max(id di tabel Spec, 140) + 1}`. Invariannya dianggap
jelas, dan fase Audit sebuah run bahkan pernah menuliskannya sendiri:

> *"SPEC-N is minted once in Postgres and can't collide by construction."*

Kalimat itu benar untuk **satu** database. Ia berhenti benar begitu ada database kedua.

Artefak sebuah run dinamai menurut id yang ia terima di prompt: `internal/docs/operations/
spec-141-overview-coverage-realtime-objective.md`, `spec-142-runs-status-auto-update-spec.md`,
dan seterusnya sampai 145. Nama-nama itu hidup di **repo**, bukan di database. Repo dibagi
oleh setiap instance hanoman yang menunjuk `repoDir` yang sama.

Instance production ([operations/production.md](../operations/production.md)) punya database
sendiri yang kosong. `max` di tabelnya 0, jadi ia mencetak `SPEC-141` — nomor yang sudah
dipegang sebuah dokumen bertopik lain sejak lama. Fase Audit membaca `internal/docs` sebagai
Source of Truth, menemukan "SPEC-141" sudah ada dan membahas *overview coverage realtime*,
lalu bekerja atas dokumen itu alih-alih backlog item di prompt. Prompt-nya sendiri benar —
blok `Backlog item` termuat utuh — tetapi kalah oleh dokumen yang tampak lebih berwenang.

Ini kembaran persis dari tabrakan run id yang dijawab `RUN_ID_FLOOR`: sebuah penghitung
max-based per-database yang menamai sesuatu di disk yang dibagi bersama.

## Keputusan

Nomor SPEC dianggap terpakai bila **salah satu** benar: ada baris `Spec` dengan id itu, atau
ada berkas markdown di repo yang namanya mengandung `spec-<n>`. `nextSpecId(repoDir)`
mengambil lantai dari `listRepoDocs(repoDir)` — helper yang sama yang dipakai pemindai
coverage, jadi `.gitignore` dan berkas yang belum di-`git add` ikut terhitung.

`repoDir` absen (project `from-scratch` yang belum punya repo) → perilaku lama, lantai 140.

## Konsekuensi

- Dua instance dengan database berbeda tidak pernah mencetak nomor yang sama selama keduanya
  menunjuk repo yang sama. Yang menjadi otoritas adalah repo, dan repo hanya satu.
- Nomor bisa melompat. DB kosong + docs sampai 145 → spec berikutnya `SPEC-146`, bukan
  `SPEC-141`. Lompatan adalah harga dari tidak menabrak; nomor SPEC bukan penghitung
  kardinal.
- `POST /specs` kini men-spawn `git ls-files` (±19 ms). Endpoint ini jarang dipanggil.
- Menghapus dokumen `spec-<n>-*.md` **melepas** nomornya kembali. Itu disengaja: docs adalah
  Source of Truth, dan nomor yang tak lagi didokumentasikan tak lagi diklaim. Baris `Spec` di
  database tetap menahan nomornya lewat lantai yang satu lagi.
- Backlog item yang sudah terlanjur dicetak dengan nomor bentrok tidak diperbaiki otomatis.
  Ia harus dibuat ulang; run yang menunjuknya menggantung dan gagal keras di
  `findUniqueOrThrow` — bukan diam-diam berjalan tanpa scope.

## Alternatif yang ditolak

**`SPEC_ID_FLOOR` di env, meniru `RUN_ID_FLOOR`.** Simetris dan satu baris, tapi ia hanya
memindahkan tabrakan ke masa depan: docs terus tumbuh, dan lantainya harus dinaikkan manual
setiap kali nomor dokumen melewatinya. Ia juga tidak menyembuhkan dev, yang hari ini selamat
hanya karena kebetulan database-nyalah yang mencetak 141–145.
