# ADR-0086 — SQLite satu-satunya provider: DB embedded di `~/.hanoman`, Docker dicabut

- Status: Accepted
- Tanggal: 2026-07-30
- SPEC: SPEC-398 (hanoman production level lewat `npm i -g hanoman`)
- Terkait: **melengkapi [0087](0087-distribusi-npm-global-satu-perintah.md)** (yang tanpa ADR ini tak
  mungkin — paket npm tak bisa membawa Postgres); **menuntaskan pencabutan
  [0005](0005-durable-queue-and-worker.md)** yang sudah kehilangan worker & broker-nya di
  [0024](0024-sesi-interaktif-menggantikan-run.md) tetapi meninggalkan Postgres-nya; **tidak
  menyentuh** [0011](0011-docs-realtime-filesystem.md)/[0018](0018-coverage-nilai-turunan.md)/[0021](0021-nomor-spec-diklaim-docs-bukan-hanya-database.md)
  (docs & coverage tetap dibaca dari filesystem, bukan DB — justru makin konsisten dengan DB berkas).

> ## Amandemen 2026-07-30 — `DATABASE_URL` asing diabaikan, hard-fail pindah ke `HANOMAN_DATABASE_URL`
>
> Butir 5 di bawah memutuskan `DATABASE_URL` non-`file:` **MELEMPAR**. Alasannya sah untuk instance
> hanoman yang di-upgrade di tempat, tetapi **salah untuk instalasi npm global**, dan itu terbukti
> di pemakaian nyata: `hanoman@0.1.0` menolak boot di mesin yang punya
> `DATABASE_URL=postgresql://…` untuk **project lain**, sambil menyuruh operator menjalankan
> `migrate-from-postgres` atas DB yang bukan miliknya.
>
> Akarnya kategori, bukan konfigurasi: `DATABASE_URL` adalah salah satu nama env var paling umum
> yang ada (Rails, Django, Heroku, Prisma), dan `hanoman` dipasang **global** sehingga mewarisi
> shell apa pun. Sebuah CLI global tak boleh mengklaim nama generik itu sebagai konfigurasinya
> sendiri, lalu mati saat menemukan nilai milik orang lain.
>
> **Presedensi baru:** `HANOMAN_DATABASE_URL` → `DATABASE_URL` → `<home>/hanoman.db`.
>
> - **`HANOMAN_DATABASE_URL` non-`file:` tetap MELEMPAR.** Di knob milik hanoman sendiri niatnya
>   eksplisit, jadi di situlah hard-fail butir 5 benar-benar berguna.
> - **`DATABASE_URL` non-`file:` DIABAIKAN** dan hanoman jatuh ke DB default.
>
> **Semangat butir 5 tetap dijaga:** pengabaian itu **tidak senyap**. `dbUrlNotice()` — murni,
> terpisah dari `resolveDbUrl` agar fungsi itu tetap bebas I/O — mengembalikan peringatan yang
> dicetak `hanoman start`, `hanoman doctor`, dan boot server langsung. Peringatannya membawa **kedua**
> jalan keluar: `migrate-from-postgres` bila kau memang punya data Postgres hanoman, dan
> `HANOMAN_DATABASE_URL=file:…` bila kau ingin menunjuk berkas tertentu. Ia mencetak **hanya
> skemanya**, bukan URL-nya, karena URL DB biasanya memuat kredensial.
>
> Pertukaran yang diterima sadar: operator yang meng-upgrade hanoman-on-Postgres di tempat dan
> **melewatkan peringatan** akan melihat instance boot dengan DB kosong, yang tampak seperti
> kehilangan data. Itu dipilih karena asimetri kemungkinan & kerugian: instalasi npm baru yang mati
> total karena `DATABASE_URL` milik project lain **sangat mungkin** terjadi dan membuat produk tak
> bisa dipakai sejak perintah pertama, sedangkan skenario upgrade-in-place hanya berlaku bagi
> instance yang jumlahnya bisa dihitung, datanya **masih utuh di Postgres**, dan jalan pulihnya satu
> perintah. Perbaikan ini terbit di `0.1.1`.

## Konteks

Postgres ada di hanoman karena ADR-0005 membutuhkan antrean durable + worker terpisah. ADR-0024
mencabut keduanya: sejak pindah ke sesi `claude` interaktif, DB hanoman hanya menyimpan **state
aplikasi** — 26 model, tanpa satu pun konsumen yang menuntut fitur Postgres. Yang tersisa adalah
biayanya, dan biaya itu dibayar setiap hari:

- **Docker jadi prasyarat.** `pnpm dev` menjalankan `docker compose up -d --wait` lebih dulu, jadi
  hanoman tak bisa dipasang di mesin tanpa Docker sama sekali.
- **Instalasi berlangkah banyak.** `pnpm install` → `docker compose up` → `prisma migrate deploy`
  → `pnpm build` → `node server/dist/server.js`. Objective SPEC-398 adalah satu perintah.
- **Satu Postgres dipakai bersama semua worktree.** Ini akar dua kelas kegagalan palsu yang sudah
  berumur di repo ini: sesi tetangga men-*truncate* `hanoman_test` di tengah run orang lain, dan
  `hanoman_test` menuntut `migrate deploy` sendiri sehingga lupa melakukannya memberi ~24 test gagal
  `P2022` yang terlihat persis seperti regresi skema.

### Kelayakan diukur, bukan diasumsikan

Sebelum memutuskan, seluruh skema dan `server/src` dipindai untuk fitur yang SQLite tak punya:

| Hambatan potensial | Temuan di repo ini |
|---|---|
| Raw SQL (`$queryRaw`/`$executeRaw`) | **nol** |
| Tipe native `@db.*` | **nol** |
| Scalar list (`String[]`) — tak didukung SQLite | **nol** (semua `X[]` adalah relasi) |
| `Decimal` / `Bytes` | **nol** |
| `@map` / `@@map` | **nol** → nama kolom DB = nama field Prisma |
| `Json` | **14 kolom** → menuntut Prisma **≥ 6.2** (SQLite + `Json`); repo ada di **5.18** |
| `mode: "insensitive"` | **4 pemakaian**, semuanya di `services/session-history.ts` |

Jadi hanya dua hambatan nyata, dan keduanya kecil. Angka `@map` nol punya konsekuensi kedua yang
dipakai ADR ini: baris `SELECT *` dari Postgres langsung cocok sebagai data `createMany` Prisma,
sehingga tool migrasi tak perlu lapisan pemetaan nama kolom.

## Keputusan

**`provider = "sqlite"` adalah satu-satunya provider. Postgres dan Docker dicabut dari jalur
menjalankan hanoman.**

1. **Prisma dinaikkan 5.18 → 6.19.** Bukan 7: Prisma 7 mewajibkan driver adapter, yang berarti
   memasang lapisan baru demi tak satu pun kebutuhan di sini.
2. **Riwayat 32 migrasi Postgres diganti satu init SQLite** (`20260730000000_init_sqlite`).
   Migrasi lama tak bisa di-*replay* di SQLite (tipe & sintaks Postgres), dan mempertahankannya
   berarti menyimpan riwayat yang tak pernah bisa dijalankan. Jalan pindah bagi data lama bukan
   riwayat migrasi, melainkan `hanoman migrate-from-postgres`.
3. **`mode: "insensitive"` dibuang.** SQLite `LIKE` sudah case-insensitive untuk ASCII, jadi
   pencarian riwayat sesi berperilaku sama untuk masukan ASCII. Untuk non-ASCII ia jadi
   case-sensitive — satu-satunya regresi semantik dari cutover ini, diterima sadar karena yang
   dicari adalah judul sesi dan perintah.
4. **Lokasi data dipusatkan di `HANOMAN_HOME` (default `~/.hanoman`).** `DATABASE_URL` yang tak
   diisi berarti `file:<home>/hanoman.db`. Tiga fungsi murni di `runner/src/paths.ts` —
   `resolveHome()`, `resolveDbUrl()`, `dbFilePath()` — jadi satu-satunya penentunya, dipakai server
   **dan** CLI.
5. **`DATABASE_URL` non-`file:` MELEMPAR**, dengan pesan yang menyebut perintah migrasinya. Ia tidak
   diam-diam diabaikan dan tidak diam-diam jatuh ke default: instance lama yang boot dengan
   `postgresql://` di env-nya harus gagal berisik, bukan menyajikan DB kosong yang tampak seperti
   kehilangan data. → **Diamandemen 2026-07-30** (lihat blok di atas): hard-fail pindah ke
   `HANOMAN_DATABASE_URL`; `DATABASE_URL` asing diabaikan **dengan peringatan**, karena CLI global
   mewarisi env var generik milik project lain.
6. **DB test menjadi berkas per checkout**, diturunkan dari `DATABASE_URL` (`<db>.test.db`) dan
   dimigrasi otomatis oleh `server/test/global-setup.ts` (hapus berkas → `migrate deploy`).

### Kenapa `runner/src/paths.ts`, bukan `server/` atau `shared/`

Resolusi ini dibutuhkan tiga pihak: `server/src/db.ts`, `server/vitest.config.ts`, dan CLI
(`hanoman start`, `migrate-from-postgres`). Menaruhnya di `server` memaksa CLI bergantung pada paket
server; menaruhnya di `shared` memaksa `node:os`/`node:path` masuk ke bundle Vite — `shared` ikut
dibundel ke browser. `runner` adalah satu-satunya library node-only yang kedua paket sudah pakai.

### Kenapa `resolveDbUrl` memakai aturan path Prisma, bukan cwd

Prisma me-resolve path relatif di URL `file:` **relatif terhadap direktori `schema.prisma`**, bukan
cwd. Kalau `@prisma/client` runtime dan `prisma` CLI memakai aturan berbeda, keduanya menunjuk dua
berkas berbeda: migrasi jalan di satu berkas, server membaca berkas lain, dan gejalanya adalah tabel
yang "hilang" tanpa satu pun error yang menyebut path. `resolveDbUrl` karena itu menerima `schemaDir`
dan meniru aturan Prisma persis.

## Konsekuensi

- **Nol proses eksternal.** Tak ada Docker, tak ada Postgres, tak ada Redis (yang sudah lama dicabut
  ADR-0024). `docker-compose.yml` dihapus; `pnpm dev` tinggal API + Vite.
- **Dua kelas gagal palsu hilang di akarnya.** Worktree tetangga tak bisa lagi men-*truncate* DB test
  orang lain (berkasnya beda), dan tak ada lagi `migrate deploy` manual untuk DB test yang bisa
  dilupakan. **`--no-file-parallelism` tetap wajib** — berkas test dalam satu paket server masih
  berbagi **satu** berkas DB yang di-seed ulang tiap berkas, jadi ADR-0085 butir itu utuh.
- **Instance lama wajib dimigrasi.** `hanoman migrate-from-postgres --from <url>` memindahkan 26
  model dalam urutan FK, `createMany` berkelompok 200 baris. Ini bukan kenyamanan tambahan: hub
  produksi menyimpan akun rekan & tiket nyata, dan cutover provider tanpa jalan pindah berarti
  membuang data orang.
- **Urutan FK dijaga test, bukan komentar.** `PG_ORDER` diverifikasi terhadap **DMMF Prisma**: tiap
  model muncul tepat sekali, dan tiap model muncul sesudah semua model yang di-refer relasi wajibnya.
  Menambah model tanpa memperbarui urutan → test merah, bukan migrasi yang gagal di tengah pada data
  orang.
- **Concurrency SQLite bukan masalah di sini** dan itu bisa dibuktikan dari bentuk produknya: satu
  proses Fastify, tanpa worker, beban tulis sebesar interaksi manusia + poll 500 ms. Pekerjaan berat
  ada di sesi tmux, dan sesi tidak menyimpan baris `Run` (ADR-0024).
- **`internal/docs` tetap Source of Truth di filesystem.** ADR-0011/0018/0021 tak tersentuh; docs,
  coverage, dan nomor SPEC tetap dibaca dari berkas.

### Gotcha terukur: `require.resolve("prisma")` tidak memberi CLI-nya

`hanoman start` menjalankan `migrate deploy` lewat `node <prisma-cli> …`, jadi ia harus menemukan
entry CLI prisma. Di prisma 6.19 peta `exports` paket itu memetakan `"."` ke `./build/types.js` —
berkas yang **tidak ada** di tarball — sehingga `require.resolve("prisma")` gagal `MODULE_NOT_FOUND`
alih-alih memberi `build/index.js`. Yang di-ekspor resmi adalah subpath `./build/index.js` dan
`./package.json`; `prismaCliPath()` mencoba keduanya supaya perubahan peta exports di versi
berikutnya tak langsung mematikan `hanoman start`.

### Gotcha terukur: dry-run tak boleh menyentuh target sama sekali

`migrate-from-postgres --dry-run` awalnya "tidak menulis" tetapi masih memanggil `count()` pada
target untuk memeriksa apakah ia kosong. Terhadap berkas SQLite yang belum pernah dimigrasi, itu
gagal `The table \`main.Project\` does not exist` — persis pada perintah yang gunanya adalah
melihat-lihat dengan aman. Dry-run adalah pertanyaan tentang **sumber**, bukan tujuan; `migrationSteps()`
menegakkannya sebagai fungsi murni yang mematikan ketiga langkah target sekaligus.

## Alternatif yang ditolak

- **Postgres embedded (`embedded-postgres`).** Membawa binari Postgres per platform, ±100 MB di atas
  paket yang sudah ±100 MB, dan tetap menjalankan proses eksternal berikut lifecycle-nya. Ditolak:
  lebih besar dan lebih rumit daripada masalah yang dipecahkan.
- **Dua provider berdampingan (SQLite untuk instalasi npm, Postgres untuk yang sudah ada).** Prisma
  menuntut satu `provider` per skema, jadi ini berarti dua skema, dua riwayat migrasi, dan setiap
  perubahan skema dikerjakan dua kali selamanya. Ditolak.
- **"Postgres tanpa Docker" (paket Postgres sistem).** Menukar satu prasyarat dengan prasyarat lain
  yang lebih bervariasi per OS: initdb, service manager, user & peran, port. Tidak menyelesaikan
  objective SPEC-398 sama sekali.
- **Mempertahankan 32 migrasi lama dengan menulis padanan SQLite-nya.** 32 berkas yang harus benar
  padahal tak satu pun instalasi baru akan menjalankan lebih dari hasil akhirnya. Ditolak demi satu
  init + tool migrasi data.
- **Menerjemahkan `mode: "insensitive"` menjadi `LOWER(...)` lewat raw SQL.** Memasukkan raw SQL
  pertama ke `server/src` (hari ini nol) demi perilaku non-ASCII pada pencarian judul sesi. Ditolak:
  harganya properti yang menjaga skema ini portabel.
