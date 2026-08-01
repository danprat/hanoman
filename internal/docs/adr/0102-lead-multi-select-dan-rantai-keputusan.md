# ADR-0102 — Pilihan lead jamak & rantai keputusan: `LeadFlow` sebagai alur, jawaban selalu daftar

- Status: Accepted
- Tanggal: 2026-08-01
- SPEC: SPEC-485 (Lead Decision: dukung opsi multi-select dan keputusan berantai dalam satu sesi
  hingga submit)
- Terkait: **memperluas [0098](0098-putusan-lead-ringkas-terstruktur.md)** — `choice` tunggal jadi
  `choices` jamak, dan `resolveChoice` dipakai ulang apa adanya sebagai satuannya; **memperluas**
  SPEC-452/474 (dialog `AskUserQuestion` dijawab lewat kolom bebas, rantainya dituntaskan sampai
  submit) dengan varian **`multiSelect`** yang selama ini membuat lead macet; **menegakkan**
  [0091](0091-hanoman-lead-agen-pemimpin.md) tanpa mengamandemennya — lead tetap yang memutuskan
  dan manusia tetap pembatal, `LEAD_ACTIONS` tetap konstanta; **tidak menyentuh**
  [0037](0037-cabut-guardrail-safety.md), [0024](0024-sesi-interaktif-menggantikan-run.md) (tak ada
  timer/queue baru — penyapu menumpang tick lead yang sudah ada), maupun
  [0039](0039-realtime-lewat-websocket-siar.md) (alur dibaca lewat polling HTTP, tanpa kanal WS
  baru); **tidak mencabut** apa pun.

## Konteks

Permukaan keputusan lead punya dua batas yang tak pernah dinyatakan. Seperti SPEC-479, batas yang
tak dinyatakan tetap punya nilai — dan nilainya adalah **bentuk kode**.

### Pilihan selalu tunggal

`zLeadVerdict.choice` satu `string`, `resolveChoice()` satu `LeadChoice | null`, kolomnya sepasang
skalar. Tak ada tempat untuk pilihan kedua. Peminta yang opsinya tidak saling eksklusif punya dua
jalan keluar dan keduanya membatalkan yang dibangun ADR-0098: menuang jawabannya ke prosa
`decision` (tak terbaca mesin lagi), atau memanggil ulang `POST /lead/decisions` — satu proses
`claude -p` per panggilan, di atas gerbang berkapasitas 2 (SPEC-479).

### Dialog `multiSelect` claude membuat lead macet — terukur

Diukur in-vivo pada **claude 2.1.220**, pane tmux 120×40, satu `AskUserQuestion` `multiSelect: true`
dengan tiga opsi:

```
←  ☐ Paket  ✔ Submit  →
Paket mana yang dipakai?

❯ 1. [ ] alpha
  2. [ ] beta
  3. [ ] gamma
  4. [ ] Type something
     Submit
──────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
```

Empat perbedaan dari dialog single-select, masing-masing cukup untuk merusak jalur SPEC-452/474:

1. **Tiap label diawali kotak centang.** `ROW` menangkap label mentah → `options` yang disodorkan
   ke lead berbunyi `"[ ] alpha"`, dan baris kolom bebas terbaca `"[ ] Type something"` yang
   **tidak** cocok `PLACEHOLDER`. Hasilnya `freeIndex === null`, `notes === false`, dan `sendToPane`
   jatuh ke jalur terakhir: prosa + `Enter`.
2. **Digit MEN-TOGGLE.** Dari widget di biner: `if (/^[0-9]$/.test(x)) { b(r[N].value); return; }`
   dengan `b = toggleValue`. Terukur: `2` mengubah `2. [ ] beta` → `2. [✔] beta`, dialog tetap
   terbuka. Ini kebalikan dari single-select, di mana satu digit **memilih seketika**.
3. **Tombol kirim ada tapi TANPA nomor** — `Submit`, atau **`Next`** bila pertanyaannya belum yang
   terakhir (`submitButtonText: LHr===VZe.length-1?"Submit":"Next"`). Karena tombol itu ada,
   `Enter` di baris opsi **tidak** men-submit; ia men-toggle baris tersorot. Jalur lama karena itu
   men-toggle **opsi 1** lalu berhenti: layar tak maju, marker tak dikosongkan, `MAX_CHAIN_STEPS`
   habis, `failures` naik. Persis gejala "hanya bisa dipilih satu" + hang yang dilaporkan.
4. **Kolom bebas hanya bisa dicapai lewat NAVIGASI.** Menekan nomornya men-toggle `__other__`
   dengan teks kosong, bukan memindahkan fokus. Fokus pindah dengan panah — dan panah pun **satu
   keystroke per `send-keys`**: terukur, `send-keys Down Down Down Down` dalam satu pemanggilan
   memindahkan fokus **satu** baris (kelas jebakan burst ADR-0085, kali ini pada tombol kendali).

Jalur benarnya terukur tuntas: toggle `2`, toggle `3`, `Down`×2 ke kolom bebas (footer bertambah
`ctrl+g to edit in Vim` — penanda fokus yang bisa dibaca), ketik prosa (`4. [✔] catatan lead`),
`Down` sekali lagi ke `❯    Submit`, `Enter` → layar rekap SPEC-474, dan model di seberang menerima
**`beta, gamma, catatan lead`**.

### Tak ada rantai

Tiap permintaan berdiri sendiri. Pertanyaan lanjutan = panggilan baru dengan konteks yang harus
diulang peminta; satu-satunya kesinambungan adalah 10 keputusan terakhir se-project yang disematkan
`leadPrompt` tanpa membedakan mana yang satu urusan. Tak ada objek yang bisa ditanya "alur ini
sampai mana", "apa saja yang sudah dipilih", "sudah di-submit belum" — jadi juga tak ada tempat
untuk menegakkan "pertanyaan lanjutan hanya boleh masuk ke alur yang masih aktif".

## Keputusan

### 1 · Jawaban SELALU daftar di penyimpanan

`LeadDecision` mendapat `choices Json?` (daftar `{index, option}`) dan `select Json?` (spec select
sebagaimana dikirim). `choice`/`choiceIndex` **tetap ada** dan diisi dari `choices[0]` sebagai
turunan — pembaca lama tak pecah. `toDecisionView` memancarkan `choices` untuk semua baris dan
**menurunkannya dari `choice`/`choiceIndex` bagi baris pra-migrasi**: itulah yang membuat riwayat
lama terbaca sesudah perubahan skema.

`resolveChoice` **tidak disentuh**. `resolveChoices` memanggilnya per item lalu membuang duplikat
dan yang tak dikenal. Satu definisi pencocokan — menyalinnya adalah kelas bug SPEC-431/448/475.
`optionActionHint` hanya berlaku saat pilihannya **tepat satu**: menurunkan tindakan dari gabungan
beberapa opsi adalah tebakan, dan ongkos tebakan yang kelihatan benar sudah dibayar SPEC-452.

### 2 · `LeadFlow` — alur sebagai entitas, dan SETIAP keputusan punya satu

Model baru (LOCAL-only, migration tulis tangan, ikut `PG_ORDER`, tanpa FK — pola `LeadDecision`),
berstatus **`menunggu` | `sebagian` | `selesai` | `dibatalkan`**. `LeadDecision` menunjuk ke sana
lewat `flowId` + `step`, keduanya nullable dan aditif.

Alur dibuat di `decide()` — choke point tunggal ketiga pintu (ADR-0091 G6), tempat yang sama yang
sudah memegang gerbang konkurensi SPEC-479. Permintaan **tanpa** `chain` melahirkan alur yang
langsung ditutup (`selesai`, `closeReason: "tunggal"`); permintaan ber-`chain` membiarkannya
terbuka sampai `POST /lead/flows/:id/submit`. `flowId` yang menunjuk alur **tertutup** ditolak
**409** — itulah bentuk teknis dari "tak bisa menyisipkan pertanyaan ke rantai yang sudah
di-submit".

Alur tak pernah menunggu manusia: `POST /lead/decisions` tetap **sinkron**, lead tetap yang
menjawab, operator tetap pembatal (ADR-0091). Yang menggerakkan rantai adalah **agen peminta**.

Konteks langkah sebelumnya (pertanyaan, opsi, yang dipilih) masuk `leadPrompt` sebagai blok
**terpisah** dari `priorDecisions`: yang satu urusan tak boleh tenggelam di antara yang kebetulan
berdekatan waktunya.

### 3 · Alur yang ditinggalkan punya UJUNG

`lead.flowTtlMin` (default **60**, kolom `Json` → tanpa migration untuk knob-nya) memberi tiap alur
`expiresAt`. Penyapu menutup alur terbuka yang lewat batas itu (`dibatalkan`,
`closeReason: "kedaluwarsa"`) + satu notifikasi. Ia **menumpang tick engine lead yang sudah ada** —
ADR-0024 melarang timer/scheduler baru, dan pola ini sama dengan penguras antrean webhook
(ADR-0100) & scheduler (ADR-0072).

### 4 · Dialog `multiSelect` dijawab dengan MENCENTANG, bukan dengan prosa saja

`readChoiceDialog` mengupas kotak centang (`/^\[([ xX✔✓])\]\s*(.*)$/`) sebelum menilai baris, jadi
`PLACEHOLDER` kembali mengenali kolom bebas dan `options` bersih dari ornamen. Dialog ber-`multi`
bila ada baris berkotak; tombol kirim dibaca terpisah lewat pola **tanpa nomor**
(`/^\s*([❯>›])?\s{2,}(Submit|Next)\s*$/`) sehingga baris bernomor `N. Submit answers` milik layar
rekap tak ikut tertangkap.

`answerMultiSelectDialog` menjalankan urutan yang terukur, dan tiap langkahnya **fail-closed**:
toggle per opsi (satu karakter, lalu **dibuktikan** kotaknya berubah) → navigasi ke kolom bebas
(satu panah per pemanggilan, dibuktikan lewat posisi `❯`) → prosa ber-`goalChunks` +
`freeTextFilled` → navigasi ke tombol kirim → `Enter`. Gagal di mana pun berarti `false`, dan sesi
jatuh ke perilaku pra-ADR-0091: menunggu manusia.

`sendToPane` karena itu menerima **pilihan sebagai data** (`choices: string[]`), bukan hanya prosa.
Dua pemanggil sembuh sekaligus: pintu deteksi lead dan pintu override operator — yang sejak ADR ini
mengirim centang manusia langsung ke pane.

### 5 · Validasi di server, dua lapis

- **Saat menerima permintaan**: `min ≤ max`, `max ≤ options.length`, `mode: "multi"` menuntut
  `options` tak kosong → **400**. Menolak bentuk yang mustahil dipenuhi di pintu masuk lebih murah
  daripada melahirkan baris `gagal`.
- **Saat menilai putusan**: pilihan di luar daftar dibuang + `DITOLAK:` + `weighty`; jumlah di luar
  `min`/`max` **membatalkan seluruh pilihan**, bukan memangkasnya. Memilih 3 dari maksimum 2 adalah
  pertanda lead salah membaca soal; mengambil dua di antaranya secara sewenang-wenang persis
  tebakan yang ADR-0098 hapus. `kind` **tidak** ditulis ulang — mengganti `kind` merusak idempotensi
  denyut (SPEC-432).

## Konsekuensi

- Setiap keputusan kini melahirkan **dua** baris (alur + langkah). Itu ongkos yang diterima sadar:
  ia yang membuat "status alur" jadi satu pertanyaan dengan satu jawaban, bukan sesuatu yang harus
  disimpulkan ulang dari kumpulan baris jejak.
- `GET /lead/flows` + `GET /lead/decisions?flowId=` membuat satu rantai bisa dibaca ulang utuh:
  urutan pertanyaan, opsi yang tersedia, dan yang dipilih di tiap langkah.
- Dashboard berhenti menjadikan "Timpa" kotak teks telanjang: bila barisnya punya menu, operator
  melihat **radio** (single) atau **checkbox** (multi).
- Selama `Setting.lead.enabled` mati (default) tak ada perilaku yang berubah.

## Alternatif yang ditolak

- **Alur hanya untuk permintaan berantai (opt-in).** Lebih sedikit baris dan kompatibel mundur
  secara konstruksi, tapi "status alur" jadi ada untuk sebagian keputusan saja — dan permukaan yang
  hanya kadang-kadang punya keadaan adalah permukaan yang selalu harus ditanya dua kali.
- **Alur menunggu manusia mencentang (asinkron).** Membalik ADR-0091 dan menambah permukaan tunggu
  baru di endpoint yang hari ini sinkron.
- **Memangkas pilihan yang melebihi `max`.** Menukar kesalahan yang terlihat dengan kesalahan yang
  tak terlihat.
- **Menjawab dialog `multiSelect` cukup lewat kolom bebas.** Berhasil menyampaikan maksud, tapi
  meninggalkan kotak-kotaknya kosong — dan nilai yang sampai ke model adalah `(catatan)` tanpa satu
  pun opsi resmi terpilih.
- **`LeadFlow` masuk `WEBHOOK_ENTITIES`.** Katalog itu selektif (`SchedulerQueueItem`, model
  keadaan-proses yang paling mirip, juga di luar) dan transisi alur sudah terbaca dari peristiwa
  `lead_decision` + `GET /lead/flows`.

## Gotcha

1. **`dialogKey` untuk layar multi WAJIB membuang penanda `☐/☒` tab strip.** Terukur: mencentang
   satu opsi sudah membalik tab yang sedang tampil menjadi `☒` tanpa satu pun pertanyaan berpindah.
   Kunci yang ikut berubah membaca layar yang **macet** sebagai layar yang **maju** — cacat yang
   sama persis yang SPEC-474 tutup untuk label kolom bebas, lewat pintu baru. Untuk layar multi
   kuncinya `q|multi|<header tab>|<judul>`; kemajuan terbaca dari judul yang berganti, dari layar
   rekap, atau dari layar yang berhenti jadi dialog.
2. **Digit di dialog multi men-toggle, bukan memilih.** Menekan nomor kolom bebas karena itu
   men-centang `__other__` dengan teks kosong alih-alih memindahkan fokus — kebalikan penuh dari
   perilaku yang SPEC-452 ukur dan andalkan.
3. **Panah harus satu keystroke per `send-keys`.** Empat panah dalam satu pemanggilan = satu
   perpindahan (terukur). Jebakan burst ADR-0085 ternyata tak berhenti di teks.
4. **Tombolnya bisa berbunyi `Next`,** bukan `Submit`, saat pertanyaannya belum yang terakhir dalam
   rantai. Pola yang hanya mencari `Submit` akan menganggap dialog berantai tak punya tombol kirim.
5. **`choices` kosong + `choice` terisi = satu pilihan.** Keluaran agen yang masih memakai bentuk
   ADR-0098 harus tetap terpakai; menuntut field baru berarti setiap agen lama mendadak "tak
   memilih apa pun".
6. **Alur baru wajib masuk `PG_ORDER`** (kelas bug ADR-0094 gotcha 7) dan **tanpa kolom `version`**
   — ia LOCAL-only, tak pernah disync.
7. **Alur yang tunggal ditutup SESUDAH barisnya ditulis, apa pun statusnya.** Baris `gagal` di
   dalam alur `selesai` adalah jejak yang jujur; menandai alurnya `dibatalkan` karena satu langkah
   gagal mencampur "operator membatalkan" dengan "lead tak sanggup".
