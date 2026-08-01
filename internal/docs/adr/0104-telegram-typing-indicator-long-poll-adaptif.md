# ADR-0104 — Kehadiran gateway Telegram adalah indikator typing, dan long-poll adaptif yang jadi denyutnya

- **Status:** Accepted
- **Tanggal:** 2026-08-02
- **Spec:** SPEC-493
- **Hubungan:** **mengamandemen** [0096](0096-telegram-gateway-session-operator-persisten.md) §5 ·
  **menegakkan** [0024](0024-sesi-interaktif-menggantikan-run.md) ·
  [0097](0097-kredensial-telegram-di-settings-terenkripsi.md) utuh

## Konteks

SPEC-491 memberi gateway sebuah suara: satu baris `TelegramOutbox` ber-kind `gateway-progress` tiap
update berhasil di-dispatch. Itu memperbaiki masalah nyata — chat yang diam total — tapi ongkosnya
terbaca langsung di layar user: pada sesi 2026-08-01, **7 update menghasilkan 7 pesan robot**
terpisah sebelum satu pun jawaban asli keluar. Satu-satunya kendali, `Setting.telegram.progress`,
bersifat semua-atau-tidak-sama-sekali: mematikannya mengembalikan diam total, padahal satu giliran
bisa makan **95 detik**.

Telegram sudah menyediakan bentuk yang tepat untuk "sedang dikerjakan": `sendChatAction` dengan
indikator typing — sesaat, tak meninggalkan jejak di riwayat chat, dan sudah dipahami setiap
pengguna Telegram. Hambatannya arsitektural: status itu **padam ~5 detik** sesudah panggilan
terakhir dan **tak punya API stop-typing**, jadi ia menuntut denyut di bawah 5 detik — sementara
gateway hanoman adalah satu loop sekuensial yang **memblokir 25 detik** di `getUpdates`, dan
ADR-0024 melarang menambah timer/scheduler/worker.

Loop yang sama juga sudah terbukti membuat balasan telat: terukur **10,8 / 11,3 / 11,9 detik**
antara balasan siap dan mulai dikirim, padahal `sendMessage` sendiri 0,4 detik.

## Keputusan

### 1. Kehadiran gateway = indikator typing, bukan pesan teks

Kedua varian teks `gateway-progress` dihapus; kind itu tak lagi dipakai untuk pesan teks apa pun.
Sebagai gantinya `TelegramApiClient.sendChatAction(chatId, action)` dipanggil (a) begitu update
selesai di-dispatch dan (b) sesudah tiap chunk keluar dari `flushOutbox()` — karena pesan masuk
menghapus status typing di sisi Telegram. **Tidak** di-arm ulang sesudah chunk terakhir dari
balasan final: giliran memang sudah selesai, dan cara menghentikan indikator adalah membiarkan
timernya habis.

`Setting.telegram.progress` tetap saklarnya, sekarang mengendalikan typing. Mati = **nol panggilan
`sendChatAction`**, benar-benar senyap.

### 2. `gateway-failure` TETAP pesan teks

Kegagalan harus terbaca. Indikator yang hilang diam-diam tidak bisa membedakan "sudah selesai
dijawab" dari "pesanmu hilang" — dan jalur kegagalan justru satu-satunya tempat user tak punya
sumber informasi lain. Kind ini juga tetap **tak digerbangi** `progress` (SPEC-491).

### 3. Long-poll adaptif adalah denyutnya — tanpa satu pun timer baru

Saat ada `TelegramUpdate` `dispatched` yang belum punya balasan final, timeout `getUpdates` turun
dari 25 detik ke **4 detik**; saat idle kembali ke 25. Tiap iterasi loop lalu menjadi tick alami
untuk refresh typing **sekaligus** `flushOutbox()`.

ADR-0024 dengan demikian **ditegakkan, bukan dilanggar**: yang bertambah adalah satu argumen pada
panggilan yang sudah terjadi tiap iterasi, bukan sumber waktu baru. Efek sampingnya jeda pengiriman
balasan 10–12 detik itu ikut hilang.

**Bukan `timeout: 0`.** Itu berubah jadi busy-poll ke API Telegram dan gampang kena 429.

### 4. Typing adalah kosmetik, jadi ia tak punya jalur untuk merusak apa pun

Seluruh state typing hidup **di memori** dalam satu kelas (`services/telegram/typing.ts`) yang
**tak satu pun method-nya bisa melempar**. Kegagalan `sendChatAction` hanya menyetel cooldown
per-chat: `retry_after` dihormati bila ada, selain itu backoff berlipat dari 5 detik, keduanya
dipagari **1–300 detik**. Ia tak pernah menyentuh state `TelegramUpdate` maupun `TelegramOutbox` —
jalur at-most-once pengiriman balasan (ADR-0096 §4) tetap utuh apa adanya.

### 5. Keaktifan diturunkan dari DB, bukan disimpan sebagai penanda

"Chat mana yang sedang diproses" = ada `TelegramUpdate` ber-`state = "dispatched"` yang belum punya
baris `TelegramOutbox` ber-kind final (`final|decision|failure|confirmation|gateway-failure`;
non-final hanya `progress`). Nol kolom baru, nol migration, dan restart proses memulihkan keadaan
tanpa rekonsiliasi apa pun. `TelegramChat.lastProgressKey` tetap tak dipakai.

## Konsekuensi

- Riwayat chat kini hanya berisi kalimat yang benar-benar ditulis session operator, plus
  pemberitahuan kegagalan. Tak ada lagi kebisingan robot.
- Trafik `getUpdates` naik ~6× **selama ada pekerjaan in-flight** dan tak berubah saat idle. Ini
  harga yang dibayar sadar untuk indikator hidup + balasan yang tak telat 12 detik.
- Indikator bisa berkedip bila satu langkah di dalam loop melebihi ~5 detik. Arm paksa di dua titik
  terpanas (sesudah dispatch, sesudah tiap chunk) menutup jeda terpanjangnya; sisanya kosmetik.
- Operator kehilangan konfirmasi tekstual "pesanmu diterima". Yang menggantikannya bersifat sesaat:
  kalau user melihat chat setelah giliran selesai, tak ada jejak bahwa ia pernah diproses.
  Diterima sadar — itulah persis keluhan yang memicu spec ini.

## Gotcha yang wajib diingat

1. **`retry_after` hidup di BADAN respons 429.** `call()` dulu melempar di `if (!response.ok)`
   **sebelum** `response.json()`, jadi nilai itu tak pernah punya pembaca. Menambah cooldown tanpa
   memperbaiki ini menghasilkan cooldown yang selamanya memakai default — dan test-nya tetap hijau.
2. **Umur menunggu wajib berpagar.** Update yang session operatornya mati mengendap `dispatched`
   selamanya; tanpa `TYPING_MAX_WAIT_MS` (10 menit) gateway mengetik selamanya **dan** mengunci
   long-poll di 4 detik selamanya.
3. **Arm sesudah chunk harus memaksa, refresh tidak.** Telegram menghapus status typing tiap ada
   pesan masuk, jadi arm pasca-chunk yang ikut throttle akan diam persis saat ia paling dibutuhkan.
   Sebaliknya refresh tanpa throttle berubah jadi banjir saat update datang beruntun dan
   `getUpdates` kembali seketika.
4. **Poll adaptif tetap hidup saat `progress` mati.** Flag itu menggerbangi **suara**, bukan
   **latensi**. Operator yang mematikan indikator tak sedang meminta balasannya telat 12 detik.
5. **Kosakata kind duduk di `protocol.ts`, bukan `gateway.ts`.** Pemakainya gateway **dan** store;
   menaruhnya di gateway membuat store meng-import gateway yang sudah meng-import store.
6. **`decision` dan `confirmation` itu final.** Keduanya mengembalikan giliran ke manusia;
   indikator "hanoman sedang mengetik" saat yang ditunggu justru jawaban user adalah kebohongan.

## Alternatif yang ditolak

- **`setInterval` khusus typing.** Melanggar ADR-0024 langsung, dan menambah sumber waktu kedua yang
  harus dihentikan bersama gateway (kelas bug "dua irama, satu flag" SPEC-432).
- **`getUpdates` dengan `timeout: 0` + sleep sendiri.** Busy-poll ke API Telegram, gampang kena 429,
  dan sleep-nya toh sebuah timer.
- **Loop kedua khusus outbox/typing.** Dua pembaca `getUpdates` atas satu bot = Telegram 409
  (ADR-0096 konsekuensi 1); memisahkan hanya outbox berarti dua penulis untuk satu antrean
  at-most-once.
- **Mempertahankan pesan teks di belakang flag ketiga.** Field setting baru untuk memilih
  teks-vs-typing hanya memindahkan keluhannya ke halaman Settings; brief meminta pesannya hilang.
- **Menyimpan status typing sebagai kolom (`TelegramChat.lastProgressKey`).** Butuh migration untuk
  keadaan yang sudah bisa diturunkan penuh dari `TelegramUpdate.state` + `TelegramOutbox.kind`
  (ADR-0018: turunkan bila bisa dihitung ulang).
