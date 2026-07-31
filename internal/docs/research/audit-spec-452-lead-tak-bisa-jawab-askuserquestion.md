# Audit SPEC-452 — hanoman-lead tak pernah bisa memutuskan saat claude bertanya lewat `AskUserQuestion`

- **Sumber**: Finding QA SPEC-452 · severity `major` · prioritas `tinggi`
- **Tanggal**: 2026-08-01
- **Status**: akar masalah **terukur in-vivo**, Spec & Plan **dilewati** (ADR-0020/0040) — dokumen ini
  adalah doc-of-record perbaikannya
- **Menyentuh**: `server/src/services/pty.ts` · `server/src/services/lead/{pane,detect}.ts` ·
  `server/src/routes/lead.ts` (lewat `sendToPane`)
- **ADR**: **tanpa ADR baru** — ADR-0091 (hanoman-lead) **ditegakkan**, bukan diamandemen; ADR-0037
  (guardrail dicabut) & ADR-0016 (tmux) utuh

---

## 1. Keluhan

> Lead hanoman tidak pernah bisa melakukan decision ketika claude memberikan pertanyaan
> askQuestion.
> **Diharapkan:** lead hanoman dapat melakukan decision ke pemilihan ask question sesi claude
> seperti cara manusia berinteraksi dengan claude.

## 2. Ringkasan temuan

Pintu deteksi otomatis lead (`services/lead/detect.ts`, ADR-0091 pintu #2) **mendeteksi** dengan
benar dan **memutuskan** dengan benar. Yang rusak adalah langkah terakhir: **cara jawabannya
diketikkan**.

`sendToPane()` menuliskan prosa keputusan lalu menekan `Enter`. Itu benar untuk kolom chat biasa,
dan **salah total** untuk dialog `AskUserQuestion` — dialog itu bukan kolom teks melainkan
**daftar pilihan** milik Ink. Terukur pada claude 2.1.220:

1. **Prosa lead ditelan bulat-bulat.** Ink menerima satu burst `send-keys -l` sebagai **satu**
   nilai `input`; hanya masukan yang panjangnya **persis satu karakter** pernah cocok dengan hotkey
   nomor baris. Prosa 55 karakter → layar **tidak berubah satu piksel pun**.
2. **`Enter` memilih baris yang sedang disorot**, yaitu **baris 1** — opsi pertama, apa pun isinya.
3. Jadi isi keputusan lead **tak pernah** menentukan pilihannya. Yang menentukan adalah urutan opsi
   yang kebetulan dirender claude.
4. Marker keputusan **tidak ikut kosong** sesudahnya (menjawab dialog bukan `UserPromptSubmit`),
   sehingga denyut berikutnya membaca sesi itu masih "menunggu" dan lead mengetik prosanya lagi —
   kali ini ke kolom chat yang sudah normal, sebagai **pesan chat** yang membelokkan sesi kerja.

Keluhan "tidak pernah bisa melakukan decision" karena itu **akurat secara harfiah**: lead memang
menghasilkan keputusan (baris `LeadDecision` berstatus `berlaku` tertulis, notifikasi terbit), tapi
keputusan itu **tak pernah menyeberang** ke sesi. Yang menyeberang cuma satu `Enter`.

---

## 3. Bukti terukur

Repro dijalankan dengan mesin yang sama seperti produksi: sesi `claude` di dalam tmux, hook
`--settings` hasil `guardSettings()` apa adanya (marker `Notification` + pengosong
`UserPromptSubmit`), `--dangerously-skip-permissions`. Hook `Notification` diberi satu `tee`
tambahan supaya payload mentahnya terbaca.

### 3.1 Deteksi BEKERJA — dialog memang menyalakan marker

`AskUserQuestion` memang memancarkan event `Notification`, lewat pengait idle 6 detik yang
dipasang setiap dialog (`COr(message, "permission_prompt")` di biner claude):

```json
{"hook_event_name":"Notification","message":"Claude needs your permission",
 "notification_type":"permission_prompt","session_id":"5a728788-…"}
```

Pola grep hanoman (`idle|permission|waiting for|needs.?input`) mencocoki `permission` → marker
terisi **8 byte**. Diukur berulang: marker `0 byte` pada t=8 dtk, `8 byte` pada t=16 dtk sesudah
dialog muncul, dan tetap 8 byte selama dialog terbuka.

Enumerasi lengkap `notification_type` di biner claude 2.1.220 — `agent_completed`,
`agent_needs_input`, `auth_success`, `computer_use_enter`/`exit`, `elicitation_complete`,
`elicitation_response`, `idle_prompt`, `push_notification`, `worker_permission_prompt`, ditambah
tiga yang dinamis lewat `COr`: `permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog`
— memastikan tak ada jalur deteksi lain yang terlewat. **Deteksi bukan penyebabnya.**

### 3.2 Prosa lead ditelan; `Enter` memilih baris 1

Layar saat dialog terbuka (opsi Merah/Biru):

```
❯ 1. Merah
     Memilih warna merah
  2. Biru
     Memilih warna biru
  3. Type something.
────────────────────────────────────────
  4. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
```

Dikirim **persis seperti `sendToPane`**:

```
tmux send-keys -l "Pilih Merah karena lebih kontras dengan latar bone paper."
```

→ layar **identik**, tak ada satu karakter pun muncul di mana pun. Lalu `Enter`:

```
⏺ User answered Claude's questions:
  ⎿  · Warna mana yang kamu pilih? → Merah
```

`Merah` adalah **baris 1**, bukan hasil membaca kalimat lead.

**Kontrol negatif yang menutup tafsir "mungkin kalimatnya kebetulan dipahami":** dialog kedua
(Node 20 / Node 22), jawaban lead **eksplisit menyebut angka opsinya**:

```
tmux send-keys -l "Pilih opsi 2 (Node 22) karena LTS aktif dan CI sudah memakainya."
```

→ sorot **tetap di baris 1**, layar tak berubah; `Enter` → `Kamu memilih Node 20.` — **kebalikan**
dari yang diputuskan lead. Ini bentuk kegagalan yang paling mahal: bukan "tak ada jawaban",
melainkan **jawaban yang salah dan tampak sah**.

### 3.3 Mengapa ditelan: satu burst = satu `input`

Diuji terpisah pada dialog yang sama:

| Yang dikirim | Hasil |
|---|---|
| `send-keys -l "2"` (satu karakter, keystroke tersendiri) | **langsung memilih** opsi 2 — `→ SQLite`, tanpa `Enter` |
| `send-keys -l "Pilih opsi 2 (Node 22) karena …"` (burst, memuat `2`) | **tak ada efek apa pun** |

Handler dialognya membandingkan `input` **utuh** dengan nomor baris (`yW(key) === String(n)`), dan
Ink menyerahkan seluruh burst sebagai satu nilai. Karena itu memotong prosa dengan `goalChunks`
(500 karakter, ADR-0085) **tidak menolong sama sekali** — potongan 500 karakter tetap bukan satu
karakter. Ini kelas jebakan yang sama dengan `[Pasted Content]` di ADR-0085, hanya arahnya terbalik:
di sana burst terlalu besar diubah bentuknya, di sini burst apa pun yang lebih dari satu karakter
**dibuang**.

### 3.4 Marker tetap terisi sesudah dialog dijawab

Diukur di dua dialog berbeda: marker `8 byte` sebelum `Enter`, **`8 byte` sesudah** jawaban
mendarat dan claude kembali bekerja. Sebabnya struktural — yang mengosongkan marker adalah hook
`UserPromptSubmit` (`: > <marker>`), dan **menjawab dialog bukan submit prompt**. Marker baru
kosong ketika ada prompt sungguhan yang dikirim.

Akibatnya berantai, karena `readPaneQuestion(text, "claude")` **mempercayai marker tanpa syarat**
(untuk claude ia `asking: true` selama layar tak kosong — sengaja, ADR-0091):

1. denyut berikutnya melihat `markerFilled === true`;
2. layar sekarang layar kerja biasa → tetap dibaca sebagai "bertanya";
3. lead memanggil agen lagi (satu giliran agen terbakar), lalu **mengetik prosanya ke kolom chat**;
4. itu **memang** `UserPromptSubmit` → marker akhirnya kosong, tapi harganya satu **pesan chat
   liar** yang membelokkan sesi yang sedang bekerja;
5. berulang sampai `maxAutoAnswers` (AC-11) tercapai, lalu lead menyerah dengan
   "Lead berhenti menjawab sesi ini".

Dari kursi operator, rangkaian itu terbaca persis sebagai judul finding: lead tak pernah benar-benar
memutuskan apa pun di sesi itu.

### 3.5 Struktur dialog (dari biner claude 2.1.220)

Baris dialog dirakit `[...options, freeTextRow, ...chatRow]`:

- `freeTextRow` = `{type:"input", value:"__other__", label:"Other", placeholder:"Type something."}`
  → **selalu di nomor `jumlah_opsi + 1`**; labelnya saat kosong adalah placeholder-nya
  (`"Type something."` single-select, `"Type something"` multiSelect);
- baris terakhir `"Chat about this"` di nomor `jumlah_opsi + 2` (menekan nomornya = `onRespondToClaude`);
- footer chord: `enter → select`, `↑/↓ → navigate`, `ctrl+g → edit in <editor>` (hanya saat kolom
  bebas fokus), `escape → cancel`.

Terukur pada dialog tiga opsi:

```
❯ 1. In-memory
  2. Redis
  3. Tanpa cache
  4. Type something.
────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
```

### 3.6 Jalur yang BENAR — terverifikasi in-vivo

Prompt sistem claude sendiri menyatakan: *"AskUserQuestion always includes a Skip button and a
free-text input box for custom answers"*. Jadi ada jalur yang menerima **jawaban prosa utuh** —
persis "cara manusia berinteraksi dengan claude" yang diminta finding. Urutannya:

```
send-keys -l "4"          # digit baris kolom-bebas, sebagai keystroke TERSENDIRI
(jeda)
send-keys -l "<prosa>"    # sekarang ini kolom teks — burst diterima apa adanya
send-keys Enter
```

Hasil terukur, dialog tiga opsi di atas, prosa 96 karakter:

```
❯ 4. Tanpa cache dulu; SQLite lokal sudah cukup cepat dan cache menambah state
     yang harus di-invalidate.
…
Enter to select · ↑/↓ to navigate · ctrl+g to edit in Vim · Esc to cancel
```

→ `Enter` → claude menerima **jawaban lengkapnya**, bukan salah satu opsi. Diverifikasi juga pada
dialog dua opsi (`Vite, karena repo ini sudah memakainya di web/` → claude membalas
`Kamu memilih Vite (karena repo ini sudah memakainya di web/)`).

Perhatikan perbedaan perilaku digit yang mengikat desain: nomor **opsi biasa** memilih **seketika**
(tanpa `Enter`), sedangkan nomor **baris kolom-bebas** hanya **memindahkan fokus** ke kolom itu.

---

## 4. Akar masalah

**`sendToPane()` mengasumsikan pane selalu berupa kolom teks.** Satu asumsi, tiga akibat:

| # | Cacat | Akibat |
|---|---|---|
| **A** | Prosa dikirim sebagai burst ke widget daftar → **ditelan**; `Enter` memilih baris tersorot | Keputusan lead tak pernah menyeberang; yang terpilih **selalu opsi 1** |
| **B** | Tak ada jalur ke kolom bebas (`Type something.`) meski claude menyediakannya | Tak ada cara menyampaikan jawaban bernuansa — "seperti manusia" mustahil |
| **C** | Marker tak dikosongkan sesudah dialog dijawab | Lead mengulang: giliran agen terbakar + **pesan chat liar** ke sesi yang sedang bekerja, sampai `maxAutoAnswers` |

Kegagalannya **senyap di ketiga lapis**: `tmux send-keys` sukses (exit 0), `sendToPane` mengembalikan
`true`, `detect.ts` mencatat sesi itu di `answered`, dan jejak `LeadDecision` berstatus `berlaku`.
Tak ada satu pun sinyal yang membedakan "jawaban mendarat" dari "prosa dibuang lalu baris 1 dipilih".

Cacat yang sama menimpa **pintu operator** `POST /lead/decisions/:id/override` (`routes/lead.ts:122`)
— jalur "manusia menang" pun kehilangan jawabannya kalau sesi sedang menampilkan dialog.

---

## 5. Perbaikan

Spec & Plan **dilewati**: akar masalahnya tunggal, terukur, dan bentuk perbaikannya **dipaksa oleh
perilaku TUI yang sudah diukur** — tak ada percabangan desain yang perlu dibayar perencanaan. Tanpa
ADR, tanpa perubahan skema/migration, tanpa endpoint baru, tanpa knob baru.

### 5.1 Parser murni `services/tui-dialog.ts` (baru)

`readChoiceDialog(paneText)` → `{ choices: {n,label,free,chat}[], freeIndex, selected } | null`.
Murni & tanpa I/O supaya seluruh perilakunya bisa dikunci test tanpa tmux (pola `lead/pane.ts`).
Aturan pengenalannya diturunkan dari layar yang benar-benar terukur di §3.5, bukan dari ingatan:

- ada **footer navigasi** (`Enter to select` + `to navigate`) — pembeda paling murah antara dialog
  dan kolom chat biasa;
- deret baris bernomor **berurutan mulai 1** yang terakhir di layar (scrollback memuat dialog lama);
- baris kolom-bebas dikenali dari label placeholder-nya (`Type something` / `Other`).

**Fail-closed:** layar yang tak memenuhi ketiganya → `null` → jalur lama persis seperti hari ini.

### 5.2 `sendToPane` sadar dialog (`pty.ts`)

Tidak ada dialog → **perilaku hari ini tak berubah satu byte pun** (kolom chat, sesi codex, konsol
VPS, override operator di kolom chat).

Ada dialog ber-kolom-bebas → jalur §3.6: digit **sebagai `send-keys` tersendiri** (satu karakter,
tak boleh menempel apa pun), jeda, prosa (tetap lewat `goalChunks` — kolom bebas adalah kolom teks
dan jebakan `[Pasted Content]` ADR-0085 tetap berlaku di sana), jeda, **verifikasi**, lalu `Enter`.

**Verifikasi sebelum `Enter` itu wajib, bukan kemewahan.** Kalau teks ternyata tak mendarat di kolom
bebas, `Enter` akan memilih baris yang sedang disorot — persis bug yang sedang diperbaiki. Jadi
pane dibaca ulang dan baris ber-nomor `freeIndex` harus **sudah bukan** placeholder-nya lagi; kalau
masih placeholder, `Enter` **tidak** ditekan dan `sendToPane` mengembalikan `false`. Sesi jatuh ke
perilaku pra-ADR-0091 (menunggu manusia) — hasil yang jujur, bukan pilihan yang salah.

Dialog **tanpa** kolom bebas (dialog trust, prompt izin) sengaja **tak disentuh**: di sana `Enter`
memilih baris 1 yang memang berarti "ya", dan mengubahnya akan menukar bug ini dengan regresi.

### 5.3 Opsi dialog disodorkan ke lead (`lead/{pane,detect}.ts`)

`readPaneQuestion` ikut mengembalikan `choices`; `detect.ts` meneruskannya sebagai `options` ke
`decide()` — field yang **sudah ada** di `DecideRequest`/`leadPrompt` dan selama ini tak pernah diisi
pintu deteksi. Catatannya diperjelas: jawaban akan dimasukkan sebagai **jawaban bebas**, jadi lead
menulis jawaban yang berdiri sendiri (boleh menyebut opsi yang dipilihnya), bukan nomor telanjang.

### 5.4 Marker dikosongkan sesudah jawaban otomatis mendarat

`detect.ts` mengosongkan berkas marker sesudah `send` sukses. Ini menutup rantai §3.4 di sumbernya
dan membuat komentar AC-11 yang sudah ada (*"marker memang kosong sesaat setelah lead mengetik"*)
menjadi **benar untuk dialog juga**, bukan hanya untuk kolom chat. **Penghitung `answers` tidak
disentuh** — yang dikosongkan marker, bukan pagar AC-11.

Berbeda dari berkas fase (yang **tak pernah** ditulis server, ADR-0084), marker keputusan memang
berkas yang ditulis-dan-dikosongkan dari luar agen sejak SPEC-184; mengosongkannya persis berarti
"sesi ini sudah tak menunggu" — dan lead-lah yang baru saja membuatnya begitu.

---

## 6. Konsekuensi & batas

- **Satu pertanyaan per putaran.** `AskUserQuestion` bisa membawa beberapa pertanyaan (`tab to
  switch questions`). Yang dijawab adalah pertanyaan yang **sedang terlihat**; sisanya dijawab
  putaran denyut berikutnya karena marker menyala lagi. Berjalan wajar, dan tetap berpagar
  `maxAutoAnswers`.
- **`multiSelect` tidak dijamin.** Placeholder-nya `"Type something"` (tanpa titik) tetap dikenali,
  tapi mekanik pilih-gandanya (spasi untuk toggle) tak ditiru. Jawaban bebas tetap sampai ke claude.
- **Bergantung pada string UI claude** (`Type something` · footer navigasi). Itu memang sudah sifat
  seluruh permukaan ini (`GOAL_ARMED_MARKERS`, `CODEX_FINISHED`); mitigasinya fail-closed —
  string berubah → parser diam → jalur lama, bukan jawaban salah.
- **codex tak terpengaruh**: layarnya tak punya baris `Type something.`, jadi `readChoiceDialog`
  mengembalikan `null` dan jalurnya identik dengan hari ini.
- **Pintu override operator ikut sembuh** tanpa perubahan di `routes/lead.ts` — ia memakai
  `sendToPane` yang sama.

## 7. Rujukan

- `internal/docs/adr/README.md` — ADR-0091 (hanoman-lead), ADR-0085 (`goalChunks`/`[Pasted Content]`),
  ADR-0074 (dua agen), ADR-0037 (guardrail dicabut), ADR-0016 (tmux)
- `server/src/services/pty.ts` (`sendToPane`, `capturePane`, `markerFilled`)
- `server/src/services/lead/{detect,pane,decide,prompt}.ts`
- `runner/src/settings.ts` (`guardSettings` — marker SPEC-184)
- `internal/docs/research/audit-spec-448-lead-selalu-gagal-stdin-root.md` — kegagalan lead
  sebelumnya di titik spawn; audit ini adalah cacat di titik **penyampaian**
