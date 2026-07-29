# ADR-0084 — Sesi backlog dilanjutkan, bukan diulang dari nol

**Status:** aktif (SPEC-394). **Memulihkan substansi [ADR-0017](0017-run-terputus-melanjutkan-sesinya.md)**
di arsitektur sesi interaktif [ADR-0024](0024-sesi-interaktif-menggantikan-run.md) — ADR-0017 tetap
`superseded` sebagai mekanisme (run headless sudah tak ada), tetapi alasannya berlaku kembali.
Melengkapi ADR-0015 (satu backlog satu sesi), ADR-0002 (isolasi worktree), ADR-0030 (`baseSha`
sebagai pangkal rentang review), ADR-0019 (`headSha` disimpan, diff diturunkan).
**TIDAK menyentuh** ADR-0037 (tak ada guardrail yang dihidupkan) maupun ADR-0074 (netral-agen).

## Konteks

`startSpecSession()` — jalur peluncuran tunggal sesi backlog (SPEC-294; dipakai
`POST /terminal/sessions` **dan** governor scheduler) — hanya mengenal **dua** keadaan: "pane tmux
ada" → re-attach, dan "pane tidak ada" → sesi baru. Keadaan ketiga, **melanjutkan**, tidak pernah
ada. Padahal artefak sesi setengah jalan hampir selalu bertahan: worktree `.worktrees/<id>`, commit
di `hanoman/<id>`, dan berkas fase `.worktrees/.phases/<id>` yang hidup **di luar** worktree dan
bersifat append-only.

Tiga cacat berlapis, semuanya terukur di
[audit SPEC-394](../research/audit-spec-394-lanjutkan-sesi-backlog.md):

1. **Pane MATI lolos gerbang re-attach.** tmux dijalankan `remain-on-exit on` supaya layar terakhir
   sebuah sesi tetap terbaca, jadi `getSession(id)` mengembalikan pane mati juga. Sementara UI
   menghitung "sedang berjalan" dengan benar (`!s.exited`), sehingga tombol **"Lanjutkan"** muncul
   persis saat pane-nya mati — dan menekannya mengembalikan id pane mati itu. Tombolnya diam.
2. **Jalan keluar satu-satunya menghancurkan pekerjaannya.** Menutup sesi mati itu
   (`DELETE /terminal/sessions/:id`) menghapus worktree-nya.
3. **Peluncuran berikutnya selalu diperlakukan sebagai kelahiran pertama.** `realGit.addWorktree`
   merebut path dengan `worktree remove --force` + `rmSync` (benar sebagai *reclaim*, fatal sebagai
   "lanjutkan"), basisnya `spec.branchFrom ?? HEAD` alih-alih tip branch sesi, `baseSha` ditimpa &
   `headSha` di-null-kan, dan `isContinue = spec.stage === "done"` membuat stage `objective` /
   `spec-ready` / `planned` / `executing` — **definisi "setengah jalan"** — jatuh ke `startPrompt`
   dari fase pertama. Prompt peluncuran kedua terbukti **byte-identik** dengan yang pertama.

Ada akibat keempat yang membuatnya lebih dari sekadar boros: setiap prompt sesi backlog berakhir
dengan `git push origin HEAD:refs/heads/hanoman/<id>`. Worktree yang dibangun ulang dari `branchFrom`
bukan keturunan tip yang sudah di-push, jadi push itu **ditolak non-fast-forward** — diuji langsung
terhadap git. Sesi ulangan itu bahkan tak bisa menyimpan hasil ulangannya.

ADR-0017 sudah memutuskan paket ini untuk arsitektur run lama, dengan alasan non-fast-forward yang
sama, dan mencatat syaratnya: *"Melewati fase hanya sah bila artefaknya masih ada — dan artefak fase
Plan hidup di worktree, bukan di percakapan."* Ia di-*superseded* ADR-0024 atas premis yang tertulis
di kepalanya: *"sebuah sesi tmux tak pernah 'terputus': ia hidup melewati restart API."* Premis itu
**terlalu kuat** — sesi tmux memang selamat dari restart API, tapi tidak dari mesin yang di-restart,
agen yang keluar sendiri, atau operator yang menutup sesinya. Yang tercabut adalah perilakunya;
keadaan yang membuatnya perlu tidak pernah hilang.

## Keputusan

**Sebuah peluncuran sesi backlog punya tiga keadaan, bukan dua.**

1. **live** — pane tmux ada **dan** `!exited` → re-attach (ADR-0015). Tak menyentuh worktree,
   `baseSha`, maupun berkas fase. Respons `{ id, reused: true }`.
2. **resume** — `spec.stage ≠ "done"` **dan** `spec.baseSha` ada **dan** artefaknya masih ada →
   lanjutkan. Respons `{ id, resumed: true }`.
3. **fresh** — selain itu → persis perilaku sebelum SPEC-394. Respons `{ id }`.

**Pane mati bukan sesi.** Ia dibunuh lebih dulu — `killSession` menutup baris `SessionHistory` dan
menyimpan transkrip pane (ADR-0079) — lalu sesi dilahirkan ulang. Gerbang ini dipasang di **titik
cekik `createSession()`**, bukan hanya di `startSpecSession`, sehingga ia menutup juga jalur yang tak
punya gerbang sendiri: sesi konflik `merge-<spec>` (`routes/specs.ts`) dan `finishGraphOp`
(`routes/ide.ts`), serta konsol VPS `vpsc-<id>` (`routes/vps.ts`). Kelima route sesi **project-level**
(reverse · scaffold · prd · breakdown · cross-audit) punya gerbang `getSession` sendiri di depan
`createSession`, jadi masing-masing ikut disempitkan ke `!exited`. `attach()` pada pane mati **tetap
sah** — itu justru cara membaca layar terakhir sesi yang sudah selesai.

**Sesi project-level: worktree yang masih sah tidak dibangun ulang.** Kelima route itu memanggil
`realGit.addWorktree` **setelah** gerbangnya, jadi memperbaiki gerbangnya sendirian akan menukar
gejala "tombol diam" (yang tak merusak apa pun) dengan **kehilangan dokumen yang belum di-commit** —
regresi yang lebih buruk daripada bugnya. Karena itu keduanya satu paket: helper `ensureWorktree()`
melewati `addWorktree` bila `worktreeAlive(wt)`, dan prompt flow itu diberi satu kalimat
`RESUMED_WORKTREE_NOTE` bahwa worktree-nya tak kosong. Flow dokumen **tidak** memakai `resumePrompt`
(lihat Ditolak).

**Dua bentuk resume**, dipilih dari apa yang benar-benar selamat:

| Bentuk | Syarat | Worktree |
| --- | --- | --- |
| worktree utuh | `worktreeAlive(.worktrees/<id>)` | dipakai **apa adanya**, tak disentuh |
| dibangun ulang | tidak, tapi tip branch sesi resolve | `--detach` di tip itu |

Prioritas basis saat harus dibangun ulang: **`origin/hanoman/<id>` → `hanoman/<id>` →
`Spec.headSha`**. `origin/…` didahulukan karena itulah ref yang push berikutnya harus fast-forward.
`headSha` (ADR-0019/SPEC-176) menjadi jaring terakhir untuk commit yang tak sempat di-push; ia
di-resolve **lunak** karena objeknya bisa sudah tak terjangkau.

**`baseSha` dan `headSha` tidak pernah ditulis ulang saat resume.** Rentang review (ADR-0030) harus
tetap mengukur basis asli → HEAD sekarang, yakni seluruh pekerjaan yang terakumulasi lintas sesi.
`baseSha` yang null berarti spec ini belum pernah punya worktree — apa pun isi disk bukan miliknya,
jadi bukan resume.

**Prompt lanjutan sadar fase.** `resumePrompt()` memakai kerangka `startPrompt` (protokol fase,
otonomi, klausa scope ADR-0080, peta skill, push, blok backlog) ditambah satu blok RESUME yang
menyebut baris fase yang **sudah tercatat**, fase berikutnya, dan bentuk worktree-nya. Klausa
keputusan pasca-Audit (ADR-0040) **tidak diulang** setelah `Audit` tercatat: keputusannya sudah
mewujud sebagai baris `Spec skipped`/`Spec done`, dan mengulanginya mengundang agen membatalkannya.

**Server tidak pernah menulis ke `$HANOMAN_PHASE_FILE`** — ia hanya membacanya. Berkas itu tetap
milik agen (append-only), jadi tak ada state ganda yang bisa berselisih.

**`stage = "done"` tetap jalur SPEC-172** (`continuePrompt`, worktree dari `branchFrom`): kerjanya
umumnya sudah ter-merge ke sana, jadi tip branch sesi justru sudah usang.

**Permukaan git bertambah dua operasi murni-baca**, `worktreeAlive(path)` dan `revParse(repo, rev)`.
`addWorktree` **tidak diubah** — semantik "rebut path lalu buat" tetap benar untuk jalur fresh dan
semua flow lain; yang berubah adalah *kapan* ia dipanggil.

## Konsekuensi

- (+) Menekan "Lanjutkan" akhirnya melanjutkan. Kerja belum-commit tidak lagi hilang, dan commit
  yang sudah ada ikut ter-checkout.
- (+) Push di akhir sesi lanjutan fast-forward, karena worktree-nya lahir dari tip yang sama.
- (+) Berlaku juga untuk **governor scheduler** (jalur peluncuran sama): retry otomatis berhenti
  menghancurkan pekerjaan.
- (+) `resumed` di respons membuat toast bisa menyebut yang sebenarnya terjadi — keluhan aslinya
  adalah soal persepsi.
- (−) Worktree kini bisa hidup lebih panjang; ia hanya lenyap saat sesi **ditutup** (SPEC-362).
  Operator yang benar-benar ingin mulai dari nol harus menutup sesinya dulu.
- (−) Resume mempercayai artefak di disk. Karena itu "masih sah?" dijawab **git**
  (`rev-parse --is-inside-work-tree` + toplevel = path itu sendiri), bukan `existsSync`: direktori
  telanjang di dalam repo pun "ada", dan worktree yang gitdir-nya dipangkas menyisakan direktori.
- (+) Tombol yang dulu diam kini bekerja di **semua** permukaan: Start backlog, Console VPS, sesi
  penyelesai konflik, "Mulai lagi" dari riwayat, dan kelima flow project-level.
- (−) Satu jalur (worktree utuh) kini melewati `addWorktree`, dan sesi project-level melewatinya
  lewat `ensureWorktree`. Konsekuensinya disengaja: itu membuat baris yang bisa menghapus worktree
  tetap sedikit dan mudah diaudit — tapi berarti "mulai benar-benar dari nol" untuk flow dokumen
  kini menuntut operator menutup sesinya dulu (yang memang menghapus worktree, SPEC-362).
- (0) Tanpa perubahan skema, migration, atau endpoint baru. `resumed` aditif.

## Ditolak

- **`claude --resume <sessionId>`** (menyambung percakapan agen, seperti ADR-0017 dulu). Di sesi
  interaktif percakapan hidup di TUI agen, bukan di kontrak hanoman, dan ADR-0074 menuntut perilaku
  netral-agen — codex tak punya padanan terverifikasi. Kontinuitas di sini murni dari artefak di
  disk, persis syarat yang ditulis ADR-0017.
- **Server menulis sendiri baris fase** yang "sudah jelas selesai". Itu melahirkan state kedua yang
  bisa berselisih dengan berkas milik agen, dan berkas fase adalah satu-satunya laporan kemajuan
  yang jujur karena agen sendiri yang menulisnya.
- **Parameter `reuse` pada `addWorktree`** (bentuk ADR-0017). Pemanggil sudah tahu path-nya;
  menaruh keputusan di pemanggil membuat helper penghapus worktree tetap punya satu semantik.
- **`resumePrompt` sadar-fase untuk sesi project-level** (reverse/prd/scaffold/breakdown/cross-audit).
  Cacat pane-mati kembarnya **sudah diperbaiki** di sini (lihat Keputusan) berikut penjaga
  worktree-nya, tetapi prompt lanjutan yang menyebut "fase yang sudah tercatat" tidak: deliverable
  flow itu **dokumen**, bukan plan berkotak, dan fasenya (`Scan`/`Docs teknis`/`Wawancara`, `PRD`,
  `Breakdown`) tak punya artefak per-fase yang bisa diperiksa seperti `- [ ]` di plan. Yang diberikan
  hanyalah satu kalimat bahwa worktree-nya tak kosong. Prompt lanjutan yang benar untuk flow dokumen
  adalah pertanyaan desain tersendiri.
