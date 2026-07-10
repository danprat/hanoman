# ADR-0022 — Agen bertanya, run berstatus `awaiting`

**Status:** diterima · 2026-07-10 · SPEC-157

## Konteks

Sebuah run adalah proses `claude -p` tanpa penunggu. Ketika agen menemui percabangan yang
menentukan bentuk data model atau kontrak API, ia **tidak punya saluran untuk bertanya** — jadi
ia menebak.

RUN-90012 (`hanoman_prod`), fase Brainstorm, bertanya persis empat pilihan atas kata "orang" di
brief ("Pasien · Operator · Pembayar · Sesi"), dan menutup dengan *"ini menentukan seluruh bentuk
data model — jadi saya tidak mau menebak"*. Tak ada jawaban yang pernah tiba. Run tetap mengunci
Objective, menulis Spec dan Plan, lalu mengimplementasikan tujuh task. Ringkasan Execute-nya
mengaku: *"kalau yang sebenarnya diminta pemohon adalah pemecahan invoice per pembayar, fitur ini
tidak menjawabnya"*.

Tebakan itu tidak pernah tampak sebagai kegagalan. Run seperti itu berakhir `done`.

## Keputusan

**Satu, agen menulis pertanyaannya ke berkas.** `.hanoman-ask.json` di root worktree, dibaca
`runOne` di antara giliran. Preseden persis: `.hanoman-decision.json` (ADR-0020). `readAsk`
fail-safe by construction — berkas absen, JSON rusak, opsi < 2, atau `default` di luar menu
mengembalikan `null` dan run berjalan seperti tanpa fitur ini. Berkasnya dikonsumsi saat dibaca:
satu tulis = satu pertanyaan.

**Dua, status baru `awaiting` — bukan `paused`.** `paused` berarti proses `claude` sudah **mati**:
`applyControl` mem-`abort()`, sesi ditutup, dan run dilanjutkan nanti dari `sessionId`.
`awaiting` berarti kebalikannya — proses **hidup**, stdin terbuka, `runOne` terblokir di sebuah
promise. `Run.status` bertipe `text`, jadi status baru tidak menuntut migration.

**Tiga, kolom `Run.pendingAsk Json?`.** Nullable dan aditif. Hanya terisi selama `awaiting`.

**Empat, jawaban lewat transport yang sudah ada.** `publishControl(id, {type:"answer", value})` ke
`run:<id>:control`. `value` divalidasi terhadap `pendingAsk.options` di route — batas kepercayaan:
klien tidak boleh menyuntik teks sembarang ke stdin agen. `answer` sengaja bukan `steer`, dan
punya antriannya sendiri.

## Konsekuensi

- Run `awaiting` menahan satu slot `maxConcurrent` dan satu proses `claude` selama ia menunggu.
- **Pertanyaan yang belum terjawab bertahan melewati akhir run.** Abort saat `awaiting` (pause/stop)
  **tidak** mengosongkan `pendingAsk`, dan percobaan berikutnya menanyakannya **ulang** sebelum
  giliran fase apa pun. Ini bukan kenyamanan, melainkan koreksi: sesi yang di-resume masih memuat
  pertanyaan agen sendiri di konteksnya, sehingga prompt fase yang datang tanpa jawaban terbaca
  olehnya sebagai izin melanjutkan. Diamati langsung pada RUN-90012 — agen memakai default-nya lalu
  melaporkan *"Keputusan scope diselesaikan lewat `.hanoman-ask.json`, bukan tebakan"*. Jaminan
  fitur ini bocor tepat di batas resume. Worktree yang hilang → sesi tak di-resume, konteks
  pertanyaannya ikut hilang, dan ask-nya dibuang sebagai basi.
- UI menampilkan pertanyaan tertunda itu juga pada run `stopped`/`failed` (tombol mati). Kalau
  disembunyikan, satu-satunya jejak bahwa run berhenti demi sebuah keputusan lenyap dari layar.
- Timeout (`askTimeoutMin`, default 30; `0` = jangan pernah menunggu) jatuh ke `default` milik
  agen. Fallback itu **wajib** dicatat sebagai baris log `✗`. Tanpa itu tebakan kembali tak
  terlihat — persis masalah yang dipecahkan ADR ini. Teks yang disuntikkan pun berbeda: agen
  tidak boleh mengira pilihannya sendiri sudah dikonfirmasi manusia.
- Dibatasi 5 pertanyaan per fase. Agen bingung yang bertanya tanpa henti membakar satu giliran
  per pertanyaan; ini satu-satunya loop tak berhingga di jalur tersebut.
- `enqueueRun` menolak run `awaiting`, `DELETE /runs/:id` menolaknya, `isRunActive` mengakuinya,
  dan `reconcileRuns` menandainya `failed` bila worker-nya mati — setara run `running` yatim.
- Menunggu tidak memblokir event loop, jadi lock BullMQ tetap diperbarui dan `on("stalled")`
  tidak terpicu.
- Artefak dihapus tanpa syarat sebelum `commitAndPush`, sama seperti `.hanoman-decision.json`.
- Kotak steer disembunyikan saat `awaiting`: pesan steer baru dikuras **setelah** fase selesai,
  sedangkan fase itu sedang diblokir menunggu. Kotak yang tampak bekerja tapi diam adalah jebakan.

## Alternatif yang ditolak

- **Memakai ulang `paused`.** Menabrak semantiknya ("proses mati"), dan `enqueueRun` hanya menolak
  `queued|running`: tombol Resume akan lolos gate, `add` no-op karena `jobId` sama, tetapi
  `prisma.run.upsert` tetap menulis `status: "queued"` di atas run yang prosesnya hidup dan
  terblokir. Status berbohong dan tombol jawabannya lenyap.
- **Tombol override guardrail Source of Truth.** Kelima run `failed` yang memicu penyelidikan ini
  ternyata gagal karena bug (`verify` mengabaikan `requireLinks: false`; diperbaiki `caff8d3`),
  bukan karena butuh keputusan. Tombol "lanjut saja" pada blokir SoT adalah persis bypass yang
  dilarang `CLAUDE.md`.
- **Mendeteksi pertanyaan dari teks jawaban agen.** Sama rapuhnya dengan sentinel yang ditolak
  ADR-0020: baris berisi pola pertanyaan di dalam berkas yang dikutip agen dapat ikut tercetak.
- **Gerbang manusia otomatis sesudah Audit** (ditolak ADR-0020) tetap ditolak. Yang ditambahkan di
  sini bukan gerbang wajib, melainkan saluran yang **agen** putuskan sendiri kapan dipakai.
- **Menunggu selamanya.** Aman untuk kebenaran, tetapi menyandera slot dan tetap mati saat worker
  restart (`SteerQueue` di memori). Timeout yang terlihat lebih jujur daripada run yang wedged.
