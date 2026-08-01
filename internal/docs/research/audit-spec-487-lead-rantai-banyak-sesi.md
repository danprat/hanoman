# Audit SPEC-487 — hanoman-lead gagal menuntaskan decision berantai saat banyak sesi paralel

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** critical · **Tanggal:** 2026-08-01
**Metode:** `superpowers:systematic-debugging` — repro in-vivo (claude 2.1.220, tmux socket
terpisah) + jejak keputusan DB hidup

## Keluhan

> "Lead memperlakukan tiap sesi seolah hanya butuh SATU keputusan. Setelah menjawab dialog pertama,
> ia menganggap urusannya selesai dan berhenti; dialog lanjutan dalam rantai tidak pernah dijawab.
> Akibatnya sesi berhenti menunggu keputusan selamanya dan tidak pernah selesai. Makin parah saat 4
> sesi berjalan bersamaan dan semuanya butuh rantai keputusan. **Kualitas putusannya juga sering
> tidak sesuai konteks backlog.**"

## Ringkasan temuan

Penggerak rantai dialog (`runChain`, SPEC-474/485) **tidak rusak** — ia diukur tuntas pada keempat
bentuk yang dikeluhkan (§E). Yang rusak adalah **apa yang dianggap hanoman sebagai bukti bahwa
sebuah sesi sedang menunggu keputusan.**

Pintu deteksi menilainya dari **marker** — berkas yang ditulis hook `Notification` claude
(SPEC-184). Marker itu **pemberitahuan, bukan keadaan**: ia menyala untuk `idle|permission|waiting
for|needs.?input`, tak pernah kosong dengan sendirinya, dan `readPaneQuestion()` untuk claude
mengembalikan `asking: true` **tanpa satu pun syarat lain** (`lead/pane.ts:71` — cabang
`ASK_SIGNALS` hanya berlaku untuk codex). Layar pane — yang memuat bukti sesungguhnya dan sudah bisa
dibaca hanoman sejak SPEC-452 — tak pernah dipakai sebagai gerbang.

Akibatnya dua arah, dan keduanya terukur di DB hidup:

| | terukur | akibat |
|---|---|---|
| **A · marker menyala, sesi TIDAK bertanya** | **6 dari 22** keputusan pintu deteksi (27 %) diambil untuk sesi yang **gilirannya sedang berjalan** (spinner `✻ Cooked for 40m 4s`, `✻ Baked for 1h 6m 11s`, `✻ Crunched for 1h 31m 43s`) | putusan atas pertanyaan yang tak pernah ada → "tidak sesuai konteks", dan **pesan liar** diketik ke sesi yang sedang bekerja |
| **B · marker padam, sesi MASIH bertanya** | dialog terbuka + marker 0 B → **0 percobaan dalam 20 denyut / 100 dtk** (§B) | sesi menggantung selamanya; satu-satunya kunci pintu itu **sekali pakai per dialog** |
| **C · rantai deteksi bukan `LeadFlow`** | **22 dari 22** baris `step = 1`; **3 alur, ketiganya `tunggal`**, padahal ketiganya satu dialog 3-pertanyaan | `chainSteps` (obat ADR-0102 untuk "konteks hilang di antaranya") **tak pernah sampai** ke pintu yang menggerakkan sesi tmux |
| **D · batas waktu akibat beban masih menyerap** | temuan C SPEC-479 dibereskan hanya untuk `LeadBusyError`; deadline agen tetap `status="gagal"` → `failures++` | 3 lonjakan beban ⇒ `failCapped` ⇒ sesi ditinggalkan **selamanya** (ambang `maxAutoAnswers`, default **3**) |

**A dan B adalah satu cacat yang sama dilihat dari dua sisi**: gerbangnya bertanya pada
pemberitahuan, bukan pada bukti. A membakar jatah `maxAutoAnswers` sesi untuk pertanyaan yang tak
ada; begitu jatah itu habis (default **3**), dialog **berikutnya** — yang sungguhan — tak pernah
dijawab. Itulah "seolah hanya butuh SATU keputusan, lalu berhenti selamanya", dan itulah kenapa ia
memburuk seiring jumlah sesi: makin banyak sesi bergiliran panjang, makin banyak marker basi.

Tak ada yang perlu diamandemen. **ADR-0091 ditegakkan** (AC-9 sudah berbunyi "ragu → jangan ketik
apa pun"; yang tak pernah ada adalah keraguan untuk claude) dan **ADR-0102 ditegakkan** (mesin
rantainya sudah ada, hanya belum dipasang di pintu yang memakainya).

## A · Marker menyala untuk sesi yang tidak bertanya — 6 dari 22, semuanya sedang bekerja

`guardSettings()` (`runner/src/settings.ts:12`) memasang satu hook:

```
Notification → grep -qiE 'idle|permission|waiting for|needs.?input' && echo waiting >> <marker>
UserPromptSubmit → : > <marker>
```

Marker karena itu menjawab **"pernahkah claude memberi tahu sesuatu sejak prompt terakhir"**, bukan
**"apakah claude sedang menunggu jawaban sekarang"**. Ia tak pernah padam sendiri: satu-satunya
penghapus adalah `UserPromptSubmit` dan `clearMarker()` milik lead.

`readPaneQuestion()` menerimanya bulat-bulat untuk claude:

```ts
// lead/pane.ts:65-71
if (agent === "codex") { …CODEX_FINISHED… ; …ASK_SIGNALS… }
return { asking: true, question, reason: "", choices };   // claude: SELALU
```

Komentarnya menyebut alasannya — *"marker lahir dari hook `Notification` yang hanya menembak saat
agen benar-benar meminta masukan"*. Klasifikasi seluruh 22 baris `gate="detected"` di DB hidup
(layar pane tersimpan verbatim di kolom `question`) membantahnya:

| kelas layar saat lead memutuskan | jumlah |
|---|---|
| dialog `AskUserQuestion`/trust (`Enter to select/confirm` di layar) | **16** |
| **giliran agen sedang berjalan** (baris spinner ber-timer) | **6** |
| pertanyaan prosa di kolom chat yang menganggur | **0** |

Keenam baris giliran itu, verbatim:

```
2026-07-31 15:35:15  spec-410   ✻ Sautéed for 38m 55s
2026-08-01 07:43:55  spec-453   ✻ Cooked for 40m 4s
2026-08-01 09:10:14  spec-454   ✻ Baked for 1h 6m 11s
2026-08-01 16:46:12  spec-456   ✻ Crunched for 1h 31m 43s
2026-08-01 17:21:36  spec-457   ✻ Churned for 31m 47s
2026-08-01 18:28:53  spec-459   ✳ Scurrying… (3m 24s · ↓ 12.5k tokens)
```

Claude menulis baris itu dalam dua bentuk, dan keduanya berarti "agen berbicara, tak bertanya":
`… (Ns · ↓ N tokens)` = giliran **sedang berjalan** (satu dari enam — footer-nya bahkan masih
berbunyi `esc to inter…`), dan `for Nm Ns` = giliran yang **baru selesai**, yang tetap tertinggal di
layar (lima sisanya). Pemisahannya dari kelas dialog **sempurna dan tanpa tumpang tindih**: pola
`\bfor \d+[hms]\b` ∨ `(\d+[hms]…·` menyala di **6/6** baris non-dialog dan **0/16** baris dialog.

Isi keenamnya diperiksa satu per satu: semuanya **laporan akhir giliran** — ringkasan berkas yang
disentuh, catatan `NODE_ENV=production` di shell operator, alasan sebuah rute ditunda. **Nol** di
antaranya pertanyaan. Tiga bahkan punya teks operator yang menggantung di kolom prompt
(`deploy ke staging biar QA bisa verifikasi`, `lanjut 2b`). Lima berstatus `berlaku`, artinya
prosanya **benar-benar diketik** ke pane lewat `sendToPane` → jalur kolom chat → `Enter`; salah
satunya menyeberang ke sesi yang sudah bekerja **91 menit** tanpa henti.

Contoh isi putusannya (spec-453, layar berakhir `✻ Cooked for 40m 4s`): *"Terima SPEC-453 sebagai
selesai; minta satu commit …"* — jawaban yang masuk akal untuk pertanyaan yang tak seorang pun
ajukan.

**Direproduksi in-vivo** (§E, repro 4-sesi): sesudah kedua rantai `r1` tuntas dan markernya
dikosongkan lead, hook `Notification` menyalakannya lagi (pengintai: `r1[8B none]` — marker 8 B,
layar bukan dialog), denyut berikutnya memanggil `decide()` dengan `options: []`, dan panenya
berakhir begini:

```
⏺ Pilihan: tema Merah, font Kecil, bahan Doff, kurir Reguler.
❯ Pilih apa saja                                        ← diketik lead
⏺ Pilihan Anda: Merah (warna tema), Kecil (ukuran font), Doff (bahan kertas), Reguler (kurir).
```

Ongkosnya bukan hanya satu pesan salah. Tiap pesan hantu menaikkan `answers` — penghitung AC-11 yang
ambangnya `maxAutoAnswers` (**default 3**) dan yang sengaja **tak pernah** direset kecuali sesinya
mati atau operator campur tangan. Di DB hidup, **6 dari 9 sesi** yang pernah dilayani pintu ini
menerima setidaknya satu pesan hantu; `spec-454` menghabiskan **separuh** jatah defaultnya untuk
satu pesan hantu, `spec-457` **dua pertiga**. Sesudah jatah habis lead berhenti menjawab sesi itu
**untuk selamanya** — termasuk dialog sungguhan berikutnya.

> Mesin ini kebetulan menyimpan `maxAutoAnswers: 10` (bukan default 3) di `Setting.lead`, jadi
> ambangnya belum pernah tersentuh di sini. Pada instalasi bawaan, tiga marker basi sudah cukup.

## B · Marker adalah satu-satunya kunci pintu, dan ia sekali pakai per dialog

Sisi sebaliknya. Gerbang `scanAndAnswer` berbunyi:

```ts
// lead/detect.ts:166
if (!deps.filled(s.decisionFile)) continue;      // tak menunggu apa-apa
```

`continue`, bukan `skip` — sesi itu tak muncul di mana pun, bahkan tidak di `skipped`. Sementara itu
`detect.ts:217-221` sudah mencatat pengukuran SPEC-474: hook `Notification` claude mengisi marker
**sekali per dialog** dan tak pernah menembak lagi (0 B selama 120 dtk dengan dialognya masih
terbuka). Jadi begitu marker sebuah dialog dikosongkan lebih awal — oleh apa pun — dialog itu
menjadi **tak terlihat oleh siapa pun**, padahal ia terpampang di layar dan hanoman sanggup
membacanya (`readDialogScreen`, dipakai `runChain` di baris yang sama).

Diukur langsung (repro §E-3): satu sesi claude, dialog `AskUserQuestion` dua pertanyaan terbuka,
markernya dikosongkan paksa, lalu 20 putaran `scanAndAnswer` (denyut 5 dtk, ±100 dtk):

```
round  1 (+0 dtk)   marker=0B  layar=q|oWarna,oUkuran|Warna tema mana?  → {"answered":[],"skipped":[]}
round 10 (+45 dtk)  marker=0B  layar=q|oWarna,oUkuran|Warna tema mana?  → {"answered":[],"skipped":[]}
round 20 (+95 dtk)  marker=0B  layar=q|oWarna,oUkuran|Warna tema mana?  → {"answered":[],"skipped":[]}
=== decide dipanggil 0× dalam 100 dtk
=== marker akhir 0 B · layar akhir q|oWarna,oUkuran|Warna tema mana?
```

Dua puluh denyut, **nol** percobaan, dan sesinya bahkan tak muncul di `skipped` — dari sudut pandang
lead sesi itu tidak ada. Markernya juga tak pernah terisi lagi dengan sendirinya selama dialog yang
sama terbuka, persis seperti yang diukur SPEC-474. Sesi itu menunggu manusia sampai kiamat.

`runChain` punya dua jalan keluar yang menyatakan "rantai tuntas" tanpa bukti tuntas, dan keduanya
memicu `clearMarker`:

```ts
if (step > 0 && !screen) return { acted, done: true, … };   // detect.ts:273
if (!read.asking)        return … { acted, done: true, … }; // detect.ts:276-280
```

Keduanya membaca **satu** tangkapan layar. `waitScreenChange` pulang begitu `dialogKey` berubah —
termasuk berubah menjadi `"none"` pada satu frame di antara dua pertanyaan. Satu tangkapan yang
mendarat di frame itu cukup untuk menyatakan rantai selesai, mengosongkan marker, dan membuat sisa
rantainya tak terjangkau selamanya. Bandingkan dengan saudaranya sepuluh baris di bawah —
`waitScreenChange` yang gagal menghasilkan `failed`, marker **dipertahankan**, dan sesinya pulih
denyut berikutnya. Satu cabang fail-closed, satu cabang fail-open, di fungsi yang sama.

## C · Rantai pintu deteksi tidak pernah menjadi satu `LeadFlow`

ADR-0102 §"Tak ada rantai" mendiagnosis persis keluhan mutu yang dilaporkan tiket ini:

> "satu-satunya kesinambungan adalah 10 keputusan terakhir se-project yang disematkan `leadPrompt`
> **tanpa membedakan mana yang satu urusan**."

Obatnya — `LeadFlow` + blok `chainSteps` di prompt — dipasang di `decide()`, dan digerakkan oleh
**`chain` / `flowId` yang dikirim peminta**. ADR-nya menyatakannya terang-terangan: *"Yang
menggerakkan rantai adalah agen peminta."* Tapi peminta yang sesungguhnya menggerakkan rantai di
produksi bukan agen mana pun — ia `runChain` di dalam hanoman sendiri, dan ia memanggil `decide()`
begini:

```ts
// detect.ts:314-320 — tanpa `chain`, tanpa `flowId`
row = await deps.decide({ projectId, specId, sessionId, gate: "detected", kind: "answer",
                          question: read.question, options: …, notes }, deps.decideDeps);
```

`decide()` karena itu membuka alur **baru** untuk tiap langkah dan menutupnya sebagai `tunggal`, dan
`const chainRows = req.flowId ? … : []` membuat `chainSteps` **selalu kosong**. Terukur di DB hidup:

```
baris gate='detected'                     : 22
                    … dengan step > 1     :  0
LeadFlow                                  :  3   (semua sesudah boot 0.1.13 20:50)
         … dengan steps > 1               :  0
         … closeReason                    :  tunggal ×3
```

Ketiga alur itu **satu dialog yang sama** — terbukti dari strip tab yang tersimpan di baris
ketiganya: `←  ☒ Unggah QRIS  ☒ ORD-16  ☐ Layar setelan  ✔ Submit  →`. Satu rantai 3 pertanyaan
menjadi 3 alur `tunggal`, dan tiap langkah memutuskan tanpa tahu langkah sebelumnya.

Penggantinya `priorDecisions`: 10 baris `berlaku` terakhir **se-project**, tanpa saringan
spec/sesi. Pada langkah ke-3 rantai spec-460 (21:02:47), **2 dari 10** slot itu milik rantainya
sendiri; delapan sisanya milik SPEC-457/458/459. Dengan 4 sesi paralel di satu project — persis
skenario tiket — jendela 10 baris itu mencakup ±100 detik lintas empat backlog, dan bagian rantai
sendiri menyusut lagi. "Kualitas putusannya tidak sesuai konteks backlog" adalah kalimat yang sama
dengan diagnosis ADR-0102, hanya di pintu yang lain.

## D · Batas waktu akibat beban masih dicatat sebagai kegagalan permanen

Temuan C audit SPEC-479 menyatakan masalahnya lengkap: *"Batas waktu akibat beban … hanya ada
selama bebannya ada. Tapi keduanya sampai ke `detect.ts` dalam bentuk yang identik — satu baris
`status = "gagal"`"*, dan `failCapped` adalah **keadaan menyerap** (0 percobaan baru dalam 10 denyut
sesudah beban hilang). Perbaikannya (butir 3) hanya mengecualikan **`LeadBusyError`** — yaitu kasus
di mana agen **belum sempat dipanggil**. Kasus yang diukur temuan itu — agen dipanggil lalu
di-SIGTERM di detik ke-`timeoutSec` — tetap lewat jalur lama:

```ts
brain.think() timeout → decide() catch → fail(…) → status "gagal"
runChain: if (row.status !== "berlaku") return { failed: true }   // detect.ts:328
scanAndAnswer: if (chain.failed) failures.set(id, +1)             // detect.ts:227
```

Beban adalah justru tempat deadline itu terlampaui, jadi pengecualiannya menutup separuh yang salah.
Diperberat setelan yang berlaku di mesin ini: `Setting.lead.timeoutSec` = **120**, sementara
`zLead.timeoutSec` sudah dinaikkan SPEC-432 ke **600**. Blok `lead` yang pernah tersimpan utuh
membekukan defaultnya — default yang dinaikkan tak pernah sampai ke instalasi yang sudah menyimpan
nilainya. Dan `maxAutoAnswers` memikul **dua** penghitung sekaligus (`answers` dan `failures`), jadi
menaikkannya demi satu berarti melonggarkan yang lain.

## E · Yang TERBUKTI TIDAK rusak (dicatat supaya tak "diperbaiki" orang berikutnya)

Semua di bawah repro in-vivo: sesi `claude` sungguhan (2.1.220) di tmux socket terpisah, pane
**48×32** (lebar pane produksi yang sebenarnya — terukur dari keempat sesi hidup), dilahirkan dengan
`--settings` `guardSettings()` yang sama dengan sesi hanoman, marker sungguhan, `scanAndAnswer` &
`sendToPane` & `submitPaneDialog` yang sungguhan; hanya `decide()` yang distub agar yang diukur
mekanismenya, bukan latensi agen.

1. **Rantai 3 pertanyaan dalam satu `AskUserQuestion` — tuntas.** 3 jawaban dalam 1,9 dtk, ketiganya
   mendarat verbatim, dialog tertutup, marker dikosongkan **satu kali**.
2. **Dua panggilan `AskUserQuestion` terpisah, 2+2 pertanyaan — keempatnya terjawab.** Marker
   **terisi lagi dengan sendirinya** untuk dialog kedua (0 B pada denyut ke-4, terisi pada ke-5):
   hipotesis "hook `Notification` hanya menembak sekali per SESI" **terbantah**.
3. **4 sesi paralel × 2 dialog × 2 pertanyaan, dengan latensi `decide()` 45 dtk dan
   `maxConcurrent = 2` — 16/16 pertanyaan terjawab, 8/8 rantai tuntas, nol sesi menggantung.**
   Waktu tempuh 450 dtk, urutannya persis pola `runPool` (dua sesi dilayani, dua menunggu, lalu
   bertukar). Ia **lambat** — sesi ekor menunggu ±100 dtk per putaran — tapi ia **tidak macet**.
4. **Parser dialog benar di 48 kolom.** `readDialogScreen`/`dialogKey` mengenali dialog trust, dialog
   berantai, dan pergantian antar-pertanyaan (`q||oWarna,oUkuran|…` → `q||xWarna,oUkuran|…`) tanpa
   satu pun salah baca sepanjang seluruh repro.
5. **`options` NULL pada 19 baris jejak lama bukan kegagalan parser** — kolomnya (SPEC-480) dan
   `LeadFlow` (SPEC-485) baru terisi oleh biner yang boot 20:50; ketiga baris sesudahnya terisi
   penuh. Jangan membacanya sebagai bukti dialog tak terbaca.

## Akar masalah

**Pintu deteksi lead menilai "sesi sedang menunggu keputusan" dari sebuah PEMBERITAHUAN, padahal
BUKTINYA ada di layar dan sudah bisa dibaca.**

Marker adalah sinyal yang bagus untuk apa yang ia janjikan — murah, satu `stat`, cukup untuk
membangunkan denyut. Ia bukan keadaan: ia menyala untuk peristiwa yang bukan pertanyaan, ia tetap
menyala lama setelah peristiwanya lewat, dan ia hanya menyala **sekali** untuk peristiwa yang
memang pertanyaan. Menjadikannya satu-satunya gerbang membuat kedua arah salahnya fatal — mengetik
ke sesi yang tak bertanya (A), dan buta terhadap sesi yang bertanya (B).

Ini pengulangan pola SPEC-433 dan SPEC-451 untuk ketiga kalinya: **server sudah tahu jawabannya,
tapi permukaan yang memakainya masih membaca sinyal yang lebih lemah.** Di sana `pane_dead` vs
`sessionFinished()`; di sini marker vs `readDialogScreen()`.

## Perbaikan (Spec & Plan `skipped` — tanpa ADR, skema, migration, endpoint, atau knob baru)

ADR-0091 **ditegakkan** (AC-9 diperluas ke claude: ragu → jangan ketik apa pun), ADR-0102
**ditegakkan** (mesin rantainya dipasang di pintu yang menggerakkan sesi), ADR-0037 · ADR-0024 ·
ADR-0039 utuh.

1. **`lead/pane.ts` — layar menjadi bukti, untuk claude juga.** Baris giliran claude
   (`AGENT_TURN_LINE`) menutup pintu: marker terisi + baris giliran ber-timer di layar ⇒
   `asking: false`, alasan "giliran agen, bukan pertanyaan". Dialog di layar tetap **menang
   mutlak** — ia tak pernah terbuka bersama baris giliran, sementara `capturePane` menyeret 200
   baris riwayat yang bisa memuat sisa giliran lama. Pertanyaan prosa yang gilirannya belum berakhir
   tak punya baris itu, jadi kemampuan menjawabnya tak ikut tercabut. Terukur memisahkan 6/6 dari
   16/16, dan isi keenamnya diperiksa satu per satu: nol pertanyaan.
2. **`lead/detect.ts` — dialog di layar adalah kunci KEDUA pintu.** Sesi ber-marker kosong yang
   panenya menampilkan dialog tetap dilayani. Ini yang membuat setiap rantai yang putus di tengah —
   sebab apa pun — pulih pada denyut berikutnya, alih-alih menggantung selamanya. Fail-closed
   secara konstruksi: `readDialogScreen` menuntut footer chord claude, jadi codex tak pernah lolos
   lewat pintu ini dan AC-9 tetap utuh.
3. **`lead/detect.ts` — "rantai tuntas" harus DIBUKTIKAN.** Kedua cabang `done: true` di `runChain`
   membaca ulang layar beberapa kali sebelum menyatakan selesai; ragu → `done: false`, marker
   dipertahankan, sesi dicoba lagi. Cermin `SUBMIT_TRIES`/`waitScreenChange` yang sudah ada.
4. **`lead/detect.ts` — satu rantai, satu `LeadFlow`.** `runChain` membuka alur di langkah pertama
   (`chain: true`), menyusulinya dengan `flowId` di langkah berikutnya, dan menutupnya (`submit`)
   saat rantainya benar-benar tuntas. Alur diingat per sesi supaya rantai yang tertunda satu denyut
   melanjutkan alur yang sama. `chainSteps` ADR-0102 dengan sendirinya sampai ke prompt.
5. **`lead/detect.ts` — `failCapped` berhenti menjadi keadaan menyerap.** Penghitung kegagalan punya
   masa dingin (konstanta modul, cermin `MAX_CHAIN_STEPS`): kegagalan yang terakhir lebih lama dari
   itu tak lagi dihitung beruntun. Badai SPEC-472 (152 percobaan/13 menit) tetap tertahan — ia
   terjadi dalam hitungan detik — sementara sesi yang korban tiga lonjakan beban tak lagi
   ditinggalkan selamanya.

## Verifikasi sesudah perbaikan (in-vivo, sesi claude sungguhan)

Harness yang sama dengan §E — sesi `claude` 2.1.220 di socket tmux terpisah, pane 48×32, marker
sungguhan lewat `guardSettings()`, modul `scanAndAnswer`/`sendToPane`/`submitPaneDialog` yang
sungguhan — dijalankan atas kode sesudah perbaikan, dua fase berlawanan arah:

```
FASE 1 · dialog AskUserQuestion 2 pertanyaan TERBUKA, marker DIKOSONGKAN paksa
  ›› decide dipanggil, opts: ["Merah","Biru"]
  ›› decide dipanggil, opts: ["Kecil","Besar"]
  F1 round 1: marker=0B layar=none → {"answered":["s1"],"skipped":[]}
  HASIL: decide 2× — rantainya tuntas walau markernya tak pernah terisi lagi
         (sebelum perbaikan: 0 percobaan dalam 20 denyut / 100 dtk)

FASE 2 · giliran selesai (`✻ Cooked for 5s` di layar), marker DIISI paksa `waiting\n`
  F2 round 1..4: {"answered":[],"skipped":[{"reason":"giliran agen, bukan pertanyaan …"}]}
  HASIL: decide 0×, ketikan 0×
         (sebelum perbaikan: satu pesan liar diketik ke sesi itu)
```

Transkrip sesi membuktikan jawabannya mendarat verbatim
(`Warna tema mana? → Pilih opsi pertama`, `Ukuran font mana? → Pilih opsi pertama`), dan sesudahnya
pane kembali ke prompt tanpa satu pun ketikan tambahan.

## Bukan bagian perbaikan ini

- **`listPanes().decision`** (lencana "menunggu keputusan" di dashboard) tetap murni marker.
  Menambahkan `capture-pane` di sana berarti satu tangkapan per pane untuk **setiap** pemanggil
  `listSessions()` — belasan route — demi lencana. Pintu lead menangkapnya sendiri, sekali per
  denyut per sesi hidup.
- **`answers`/`maxAutoAnswers` sebagai satu knob untuk dua penghitung** tak dipisah. Memisahkannya
  menambah knob dan menyentuh AC-11; sesudah §A ditutup, jatah 3 tak lagi terbakar untuk pertanyaan
  yang tak ada. Bila masih kurang, itu keputusan setelan, bukan bug.
- **`timeoutSec` tersimpan membekukan default yang dinaikkan** (120 vs 600) tak disentuh: ia berlaku
  untuk **seluruh** blok setelan hanoman (scheduler, goal, conflict, lead) dan memperbaikinya berarti
  aturan migrasi setelan — pekerjaan tersendiri, bukan tempelan di sini. Dicatat agar tak terus
  didiagnosis ulang sebagai "lead lambat".
- **`busyDetect`** (`engine.ts`) tetap seperti SPEC-479 meninggalkannya.
