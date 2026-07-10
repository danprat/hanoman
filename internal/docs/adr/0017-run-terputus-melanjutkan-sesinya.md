# ADR-0017 — Run yang terputus melanjutkan sesinya, bukan mengulang dari awal

**Status:** accepted · 2026-07-09 · melengkapi [ADR-0015](0015-one-session-per-backlog.md)

## Konteks
`Run.sessionId` sudah dicatat sejak ADR-0015, tapi di seluruh `runner/` tidak ada satu pun
kata `resume`: kolom itu hanya dibaca layar Terminal. Akibatnya `resume`/`retry` — yang
meng-enqueue ulang **runId yang sama** — membuka percakapan claude yang benar-benar baru dan
menjalankan pipeline dari fase pertama lagi. Brainstorm, Objective, Spec, dan Plan diulang
dengan konteks kosong, padahal hasilnya masih tercatat di `Run.phases` sebagai `done`.

Ini yang dirasakan pengguna sebagai "sesinya hilang" ketika run brief/QA terputus — bukan
matinya proses. Percakapannya sendiri tidak pernah hilang: ia ada di disk, dan itulah yang
dipakai Terminal untuk `claude --resume`.

## Keputusan
Worker membaca baris `Run` saat job dijalankan dan meneruskan dua hal ke runner:
`resume` (= `Run.sessionId`) dan `donePhases` (= fase ber-state `done`). `runOne` lalu:

1. menyambung percakapan lewat `claude --resume <sessionId>`, **tanpa** `--fork-session`
   sehingga `session_id`-nya tidak berubah dan `Run.sessionId` tetap sah;
2. melewati fase yang sudah `done`;
3. **memakai ulang worktree** run itu, alih-alih menghapusnya paksa seperti biasanya.

Ketiganya satu paket. Melewati fase hanya sah bila artefaknya masih ada — dan artefak fase
Plan hidup di worktree, bukan di percakapan.

Keduanya dibaca dari baris `Run`, bukan dari payload job: payload dibuat saat enqueue,
sebelum fase terakhir sempat rampung. `enqueueRun` meng-upsert hanya `status`, jadi
`phases` dan `sessionId` selamat melintasi re-enqueue.

## Konsekuensi
- **Worktree yang hilang membatalkan seluruh keputusan ini.** Dipangkas, atau dihapus run
  yang sukses, `runOne` kembali ke jalur lama: sesi baru, semua fase diulang. Sesi yang
  ingat "plan sudah kutulis" di atas worktree kosong akan meng-Execute rencana yang tidak
  ada — jauh lebih buruk daripada mengulang. Karena itu `existsSync(worktree)` adalah
  syarat, bukan optimasi.
- **Yang diulang adalah fasenya, bukan basisnya.** Worktree yang dibangun ulang berbasis
  `Run.headSha` (ADR-0019) — tip yang pernah di-push run itu — dan hanya jatuh ke
  `branchFrom` bila run belum pernah push atau objeknya sudah di-gc. Membangun ulang dari
  `branchFrom` membuang commit yang sudah mendarat di `branchTo`: `commitAndPush` berikutnya
  lalu menabrak tip remote yang bukan lagi leluhurnya, ditolak non-fast-forward, dan run itu
  **mustahil di-retry selamanya**. Karena `push` tak meninggalkan ref lokal dan
  `removeWorktree` memangkas reflog-nya, `Run.headSha` adalah satu-satunya jejak tip itu.
- **Run yang semua fasenya `done` tidak membuka sesi claude sama sekali.** Itu run yang mati
  di `commitAndPush` (mis. repo tanpa remote); yang tersisa hanya push. Membuka sesi di sana
  hanya membakar token untuk tidak mengerjakan apa pun.
- `GitOps.addWorktree` bertambah parameter `reuse`. Default-nya `false` — perilaku
  menghapus-paksa yang lama tetap jadi jalur biasa untuk run baru.
- Run baru tidak berubah sedikit pun: `sessionId` masih null → sesi baru, semua fase jalan.
- Biaya (`total_cost_usd`) dilaporkan claude secara kumulatif per sesi. Sesi yang disambung
  meneruskan akumulasi itu, jadi biaya run tidak ter-reset saat dilanjutkan.

## Ditolak
- **Menghidupkan proses `claude -p` di dalam tmux** seperti layar Terminal (ADR-0016), agar
  run selamat dari restart worker. Runner bicara lewat pipe `stream-json`, bukan TTY: pane
  tmux adalah layar dengan scrollback terbatas yang harus di-poll, bukan transport. Satu-satunya
  cara memakainya adalah me-redirect stdout ke file dan stdin dari fifo — dan pada titik itu
  tmux tidak memberi apa pun di atas `spawn(detached: true)`. Proses yang selamat pun belum
  cukup: loop fase, akumulasi biaya, dan antrean steer hidup di dalam worker, jadi
  menyambungnya kembali menuntut protokol run yang bisa dilanjutkan. Sesi yang tersambung
  ulang sudah memberi hasil yang dicari dengan sepersepuluh permukaannya.
- **`--fork-session`**: membuat sesi baru dari yang lama. `Run.sessionId` lalu menunjuk ke
  sesi yang bukan lagi milik run itu, dan tombol resume di Terminal membuka yang salah.
