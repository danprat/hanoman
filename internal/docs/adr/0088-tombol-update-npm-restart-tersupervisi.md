# ADR-0088 — Tombol update dari dashboard: server keluar, supervisor memasang

- Status: Accepted
- Tanggal: 2026-07-30
- SPEC: SPEC-405
- Terkait: **mengamandemen [0048](0048-auto-update-deteksi-read-only.md)** (memenuhi syarat yang
  ADR itu sendiri tetapkan: "butuh ADR baru + supervisor") dan **membalik satu alternatif yang
  ditolak [0087](0087-distribusi-npm-global-satu-perintah.md)**; bersandar pada
  [0016](0016-sesi-terminal-hidup-di-tmux.md) (tmux menahan sesi lintas restart API); mempersempit
  permukaan [0065](0065-ai-agent-capability-agent-token.md); **tidak menyentuh**
  [0037](0037-cabut-guardrail-safety.md) maupun skema apa pun.

## Konteks

ADR-0048 memutuskan panel update **read-only**: server mendeteksi, tak pernah memasang. ADR-0087
mengulanginya untuk distribusi npm dan menolak `POST /api/update/apply` secara eksplisit sebagai
alternatif, dengan alasan server yang memasang paket di bawah dirinya sendiri "harus mematikan
dirinya untuk memakainya — sementara sesi agen berjalan di tmux".

Dua premis itu sudah berubah, dan keduanya bisa diperiksa di kode:

1. **Supervisornya sudah ada, dibawa ADR-0087 sendiri.** `hanoman start` men-`spawn`
   `node dist/server.js` sebagai proses **anak** lalu `await` exit-nya. ADR-0048 menutup pintunya
   dengan syarat — "butuh ADR baru **+ supervisor (systemd/pm2/wrapper)**" — dan wrapper itu kini
   bagian dari produk.
2. **"Akan memutus sesi tmux" tidak akurat.** `pty.ts` memakai `tmux new-session -d` di socket
   `hanoman`: tmux adalah **daemon**, bukan anak proses server. Itu persis janji ADR-0016. Yang
   putus saat restart hanyalah jembatan `tmux attach` di atas node-pty dan WebSocket-nya, dan
   klien sudah menyambung ulang dengan backoff.

## Keputusan

**`POST /api/update/apply` sah — dan server tetap tidak memasang apa pun.** Server hanya **keluar
dengan kode sentinel `UPDATE_RESTART_EXIT = 75`**. Yang menjalankan `npm i -g hanoman@latest`,
`prisma generate`, `migrate deploy`, lalu men-spawn server lagi adalah CLI parent.

Pembagian ini menjaga ADR-0048 pada intinya: server menyatakan "aku minta diganti"; pemasangnya
proses lain, yang memang hidup justru untuk itu.

1. **Supervised-only.** Endpoint & tombol hanya sah bila `process.env.HANOMAN_SUPERVISOR === "1"`,
   yang **hanya** disuntikkan `serverEnv()` di `cli/src/commands/start.ts`. Diekspor ke klien
   sebagai `UpdateStatus.canApply`. Di `pnpm dev`, bundle server telanjang, atau supervisor pihak
   ketiga yang memanggil `dist/server.js` langsung, panel tetap read-only persis seperti sebelumnya.
   **Dibaca dari `process.env` langsung, bukan `effectiveBool()`** — `effectiveBool` membaca cache
   config DB lebih dulu, jadi memakainya berarti siapa pun yang bisa menulis config bisa mengaku
   disupervisi, dan tombolnya lalu mematikan instance yang tak akan pernah hidup lagi.
2. **Dua langkah, satu endpoint.** Tanpa `confirm` ia **dry-run**: `409 confirm-required` +
   jumlah sesi hidup + `from`/`to`. Dengan `confirm: true` ia `202` lalu keluar. Sesi hidup **tidak
   memblokir** apa pun di server — manusia yang memutuskan (aturan produk hanoman); server hanya
   menyatakan berapa banyak. Jumlah itu **tidak** ditaruh di `UpdateStatus`: grup siar `update`
   di-recompute tiap 300 tick, dan angka basi pada dialog risiko lebih buruk daripada tak ada angka.
   `canApply` sebaliknya konstan seumur proses, jadi ia aman di frame siar.
3. **Urutan supervisor yang mengikat.** Install gagal → **tidak fatal**: alasan dicetak dan versi
   yang ada dijalankan ulang; instance tak pernah mati permanen gara-gara registry down atau izin
   `sudo`. Install sukses → `prisma generate` **tanpa cek dulu**, lalu `migrate deploy`, lalu spawn.
   Migrasi gagal **ditanggapi keras** (keluar 1): menjalankan bundle baru di atas skema lama menukar
   downtime dengan kesalahan data.
4. **Jatah `MAX_UPDATE_RESTARTS = 5`** per proses `hanoman start`. Aksinya dipicu manusia, jadi loop
   tak berujung bukan mode kegagalan otomatis — tapi batasnya murah, dan saat habis alasannya
   **dicetak** (jangan pernah membatasi diam-diam).
5. **Lubang capability ditutup bersamaan.** `capabilityForRoute` memetakan `top === "update"` ke
   `GLOBAL_READ` **tanpa melihat method**, dan `checkAgentCapability` meloloskan `GLOBAL_READ` tanpa
   syarat. Tanpa perbaikan, `POST /update/apply` berarti **setiap agent token — capability apa pun —
   bisa me-restart instance operator**. Kini prefix status (`update`/`limits`/`events`/`fs`/`health`)
   menghasilkan `GLOBAL_READ` hanya untuk method baca; selain itu `COOKIE_ONLY` → 403.

## Gotcha yang dijaga kode, bukan disiplin

- **`prisma generate` dijalankan tanpa cek dulu.** `ensurePrismaClient` memeriksa dengan
  `await import("@prisma/client")`, dan modul itu sudah ter-cache di proses supervisor sejak boot —
  pemeriksaan kedua akan menjawab "siap" memakai modul **lama** sekalipun paketnya baru saja diganti
  di disk. Kelas jebakan yang sama dengan `existsSync` di ADR-0087: cek yang tak bisa membedakan
  berhasil dari gagal.
- **Listener sinyal dilepas tiap putaran.** Loop yang memasang `SIGINT`/`SIGTERM` tanpa `process.off`
  menumpuk listener tiap restart sampai node memperingatkan kebocoran.
- **`confirm` wajib boolean.** `zUpdateApplyBody` menolak `"ya"`/`1` — string non-kosong yang
  terbaca truthy adalah cara paling murah untuk kehilangan langkah konfirmasi tanpa sadar.

## Konsekuensi

- Update jadi satu klik: badge → "Pasang & mulai ulang" → konfirmasi → instance kembali dengan versi
  baru. `hanoman update` di CLI tetap ada dan tak berubah.
- **Proses CLI supervisor tetap kode versi lama** sampai `hanoman` dijalankan ulang manusia. Semua
  fitur produk hidup di server/web/migrasi, jadi ini tak berpengaruh dalam pemakaian normal; yang
  tak ikut ter-update hanyalah supervisor itu sendiri (parse argumen, `resolveLayout`, loop).
  Bila rilis baru memindahkan tata letak paket, parent lama gagal menemukan `layout.server` dan
  **mengatakannya** — bukan gagal senyap. Alternatif "parent men-spawn `hanoman` baru lewat PATH lalu
  memproksikan sinyal" ditolak: ia menumpuk satu proses node per update dan menggandakan jalur
  penanganan sinyal.
- Di bawah systemd, `ExecStart=/usr/bin/env hanoman` berarti supervisornya CLI ini — systemd tak
  pernah melihat exit 75, dan unit yang sudah didokumentasikan tak perlu diubah.
- Tanpa perubahan skema, tanpa migration, tanpa knob `Setting` baru, tanpa menyentuh mesin sesi.

## Alternatif yang ditolak

- **Server memanggil `npm i -g` sendiri lalu keluar.** Menjadikan server pemasang perangkat lunak
  (persis yang ADR-0048 tolak) dan membuat kegagalan install terjadi di proses yang sedang bunuh
  diri — tak ada yang tersisa untuk melaporkannya.
- **Tombol tanpa syarat supervisi.** Di `pnpm dev` atau bundle telanjang ia mematikan instance yang
  tak akan pernah hidup lagi.
- **Blokir tombol selama ada sesi hidup.** Premisnya salah — sesi memang selamat — dan di mesin yang
  menjalankan beberapa sesi sekaligus artinya tombolnya nyaris tak pernah bisa dipakai.
- **`liveSessions` di `UpdateStatus`.** Frame siarnya 300 detik sekali; angka basi pada dialog risiko
  lebih buruk daripada tak ada angka.
