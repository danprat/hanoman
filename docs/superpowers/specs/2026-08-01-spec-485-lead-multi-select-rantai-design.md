# SPEC-485 — Lead Decision: opsi multi-select & keputusan berantai sampai submit

Status: design · 2026-08-01 · ADR baru: **0102**

## 1. Masalah

Permukaan keputusan hanoman-lead (`POST /api/lead/decisions` → `decide()` → jejak `LeadDecision`)
punya dua batas yang tak pernah dinyatakan, dan keduanya jatuh ke **bentuk kode**, bukan ke
keputusan desain.

### 1.1 Pilihan selalu TUNGGAL

`zLeadVerdict.choice` adalah satu `string`, `resolveChoice()` mengembalikan satu `LeadChoice | null`,
dan kolomnya sepasang skalar (`choice`, `choiceIndex`). Tak ada tempat menaruh pilihan kedua.
Peminta yang opsinya **tidak saling eksklusif** hanya punya dua jalan keluar, dan keduanya buruk:
menuang jawabannya ke prosa `decision` (tak terbaca mesin — persis yang ADR-0098 hapus untuk kasus
tunggal), atau memanggil `POST /lead/decisions` berkali-kali (satu proses `claude -p` per panggilan,
dan gerbang SPEC-479 berkapasitas 2 menanggungnya).

### 1.2 Dialog `multiSelect` claude membuat lead MACET — terukur

Ini bukan dugaan. Diukur in-vivo pada claude **2.1.220** (tmux 120×40, `AskUserQuestion` satu
pertanyaan `multiSelect: true`, tiga opsi):

```
←  ☐ Paket  ✔ Submit  →

Paket mana yang dipakai?

❯ 1. [ ] alpha
  paket alpha
  2. [ ] beta
  ...
  4. [ ] Type something
     Submit
────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
```

Perbedaannya dengan dialog single-select (SPEC-452/474) ada **empat**, dan tiap satunya sendirian
sudah cukup merusak jalur yang ada:

1. **Setiap label diawali kotak centang.** `ROW` di `tui-dialog.ts` menangkap label mentah, jadi
   `options` yang disodorkan ke lead berbunyi `"[ ] alpha"`, `"[ ] beta"` — dan baris kolom bebas
   terbaca `"[ ] Type something"`, yang **tidak** cocok dengan `PLACEHOLDER`. Akibatnya
   `freeIndex === null`, `notes === false`, dan `sendToPane` jatuh ke jalur terakhir: prosa +
   `Enter`.
2. **Digit MEN-TOGGLE, bukan memilih-lalu-mengirim.** Dari sumber widget di biner:
   `if (/^[0-9]$/.test(x)) { b(r[N].value); return; }` dengan `b = toggleValue`. Terukur: menekan
   `2` mengubah `2. [ ] beta` → `2. [✔] beta`, dialog tetap terbuka.
3. **Ada tombol `Submit` TANPA nomor** (`Next` bila pertanyaannya belum yang terakhir —
   `submitButtonText: LHr===VZe.length-1?"Submit":"Next"`). Karena tombol itu ada,
   `Enter` di baris opsi **tidak** men-submit; ia men-toggle baris yang tersorot. Jalur lama karena
   itu men-toggle **opsi 1**, lalu berhenti: layar tak pernah maju, marker tak pernah dikosongkan,
   `MAX_CHAIN_STEPS` habis, `failures` naik.
4. **Kolom bebas hanya bisa dicapai dengan NAVIGASI.** Menekan nomornya men-toggle `__other__`
   dengan teks kosong, bukan memindahkan fokus. Fokus pindah dengan panah — dan panah pun
   **satu keystroke per `send-keys`**: terukur, `send-keys Down Down Down Down` dalam satu
   pemanggilan hanya memindahkan fokus **satu** baris (kelas jebakan burst ADR-0085).

Terukur pula bahwa jalur benarnya ada dan tuntas: toggle `2`, toggle `3`, `Down` ×2 ke baris
kolom bebas (footer bertambah `ctrl+g to edit in Vim` — penanda fokus yang bisa dibaca), ketik
prosa (`4. [✔] catatan lead`), `Down` sekali lagi ke `❯    Submit`, `Enter` → layar rekap
SPEC-474 (`Ready to submit your answers?` · `❯ 1. Submit answers`), dan model di seberang menerima
**`beta, gamma, catatan lead`**.

### 1.3 Tak ada RANTAI

Tiap `POST /lead/decisions` berdiri sendiri. Pertanyaan lanjutan berarti panggilan baru dengan
konteks yang harus diulang peminta; satu-satunya kesinambungan adalah 10 keputusan terakhir
se-project yang disematkan `leadPrompt` tanpa membedakan mana yang satu urusan. Tak ada objek yang
bisa ditanya "alur ini sudah sampai mana", "apa saja yang sudah dipilih", atau "sudah di-submit
belum" — jadi juga tak ada tempat untuk menegakkan "pertanyaan lanjutan hanya boleh masuk ke alur
yang masih aktif".

## 2. Keputusan yang sudah diambil operator

| Percabangan | Putusan |
|---|---|
| Siapa yang menjawab tiap langkah | **Lead menjawab (sinkron), operator menimpa.** Sifat sinkron `POST /lead/decisions` tak berubah; ADR-0091 utuh. |
| Kapan baris alur dibuat | **Selalu.** Setiap keputusan punya `LeadFlow`; alur yang tak berantai ditutup seketika. |
| Multi-select di pane tmux | **Ya — toggle lewat keystroke**, bukan cuma prosa. |

## 3. Desain

Empat lapis, dan urutannya mengikat karena tiap lapis memakai lapis di atasnya.

### 3.1 Kosakata (shared, murni)

`shared/src/lead.ts`:

```ts
export const zLeadSelect = z.object({
  mode: z.enum(["single", "multi"]).default("single"),
  min: z.number().int().min(0).max(20).default(0),
  max: z.number().int().min(1).max(20).nullable().default(null),
});
export type LeadSelect = z.infer<typeof zLeadSelect>;

/** Batas yang benar-benar berlaku, diturunkan dari spec + jumlah opsi. `single` selalu 0..1. */
export function normalizeSelect(sel: LeadSelect, optionCount: number): { mode; min; max };

/** Cermin jamak `resolveChoice`, fail-closed per item; duplikat & yang tak dikenal dibuang. */
export function resolveChoices(raw: string[], options: string[]): { choices: LeadChoice[]; rejected: string[] };

/** Apakah jumlah pilihan memenuhi min/max? Alasan penolakan yang bisa dibaca manusia. */
export function checkChoiceCount(n: number, b: {min; max}): string | null;
```

- `resolveChoice` **tidak disentuh** — `resolveChoices` memanggilnya per item. Satu definisi
  pencocokan; menyalinnya adalah kelas bug SPEC-431/448/475.
- `LeadDelivery.choices: LeadChoice[]` menggantikan `choice` sebagai sumber; `choice` tetap ada
  (= `choices[0] ?? null`) supaya pembaca lama tak pecah.
- `leadReplyText` merangkai `Pilih: A; C. <reason>` untuk banyak pilihan — label **verbatim**,
  alasan yang sama dengan SPEC-452.
- `optionActionHint` **hanya** dipakai saat pilihannya tepat satu. Menurunkan tindakan dari
  gabungan beberapa opsi adalah tebakan, dan SPEC-480 sudah membayar ongkos tebakan yang
  kelihatan benar.
- `zLeadVerdict` mendapat `choices: string[]` (default `[]`), tetap `string` (bukan enum) dengan
  alasan yang sama seperti `choice`/`action`: pilihan karangan harus BISA MASUK agar
  ditolak-dan-dicatat. Bila `choices` kosong tapi `choice` terisi → dibaca sebagai satu pilihan
  (kompatibilitas mundur penuh untuk keluaran agen lama).

### 3.2 Alur sebagai entitas (`LeadFlow`) — server

**Skema** (migration tulis tangan, LOCAL-only, ikut `PG_ORDER`, tanpa FK — pola `LeadDecision`):

```prisma
model LeadFlow {
  id        String   @id @default(cuid())
  projectId String
  specId    String?
  sessionId String?
  gate      String                              // pintu yang membuka rantai
  status    String   @default("menunggu")       // menunggu | sebagian | selesai | dibatalkan
  title     String                              // pertanyaan pertama, terpangkas
  steps     Int      @default(0)
  closeReason String?                           // kenapa ditutup (submit / operator / kedaluwarsa)
  openedAt  DateTime @default(now())
  closedAt  DateTime?
  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([projectId, createdAt])
  @@index([status])
}
```

`LeadDecision` bertambah **empat kolom aditif nullable** — baris lama sah apa adanya:
`flowId String?`, `step Int?`, `choices Json?` (daftar `{index,option}`), `select Json?`
(spec select sebagaimana dikirim, supaya jejaknya bisa dibaca ulang tanpa peminta).

**Bentuk jawaban selalu daftar di penyimpanan** (batasan #2): setiap baris baru yang punya menu
menulis `choices`; `choice`/`choiceIndex` tetap diisi dari `choices[0]` sebagai turunan.
`toDecisionView` memancarkan `choices` dan **menurunkannya dari `choice`/`choiceIndex` untuk baris
lama** — itulah yang membuat riwayat pra-migrasi tetap terbaca (batasan #1).

**Daur hidup** (semuanya di `decide()`, choke point tunggal ADR-0091 G6):

1. `resolveFlow(req)` — `flowId` ada → muat; **tertutup → lempar `LeadFlowClosedError`**
   (batasan #4). Tak ada → buat baris baru (`menunggu`, `expiresAt = now + lead.flowTtlMin`).
2. Keputusan disusun seperti biasa; barisnya menyimpan `flowId` + `step`.
3. Sesudah baris ditulis: `chain` diminta → `sebagian` bila ada langkah `berlaku`, selain itu
   tetap `menunggu`. `chain` tak diminta → **`selesai` seketika** (`closeReason: "tunggal"`).
4. `POST /lead/flows/:id/submit` → `selesai`. `POST /lead/flows/:id/cancel` → `dibatalkan`.
5. **Penyapu kedaluwarsa** menutup alur terbuka yang lewat `expiresAt` (`dibatalkan`,
   `closeReason: "kedaluwarsa"`) + satu notifikasi. Ia menumpang tick engine lead yang **sudah
   ada** — ADR-0024 melarang scheduler/timer baru.

Knob baru `lead.flowTtlMin` (default **60**) hidup di kolom `Json` `Setting.lead` → **tanpa
migration** untuk knob-nya.

**Konteks terbawa** (outcome #2): `leadPrompt` mendapat blok `Rantai keputusan ini` berisi langkah
sebelumnya — pertanyaan, opsi yang tersedia, apa yang dipilih. Sengaja terpisah dari
`priorDecisions` (10 terakhir se-project): yang satu urusan tak boleh tenggelam di antara yang
kebetulan berdekatan waktunya.

**Kontrak HTTP:**

| Endpoint | Perubahan |
|---|---|
| `POST /lead/decisions` | `+select`, `+chain: boolean`, `+flowId`. Balasan `+choices`, `+flowId`, `+flowStatus`. `flowId` tertutup → **409**. |
| `GET /lead/flows` | Baru. Saring `projectId`/`status`, urut terbaru. |
| `POST /lead/flows/:id/submit` | Baru. Sudah tertutup → 409. |
| `POST /lead/flows/:id/cancel` | Baru. Idem. |
| `GET /lead/decisions` | `+flowId` sebagai filter (langkah satu rantai, urut naik). |
| `POST /lead/decisions/:id/override` | `+choices: string[]` — jawaban operator berbentuk data, bukan cuma prosa. |

Capability tetap turunan prefix `lead` **menurut method** — tak ada peta baru (kelas bug SPEC-405
sudah ditutup; test yang ada menjaganya).

**Validasi di server, bukan hanya UI** (batasan #5), dua lapis dan keduanya wajib:

- **Saat menerima permintaan** — `min ≤ max`, `max ≤ options.length`, `mode: "multi"` menuntut
  `options` tak kosong → `400`. Menolak bentuk yang mustahil dipenuhi di pintu masuk lebih murah
  daripada melahirkan baris `gagal`.
- **Saat menilai putusan lead** — pilihan di luar daftar dibuang + `DITOLAK:` di `reason`
  + `weighty`; jumlah di luar `min`/`max` **membatalkan seluruh pilihan** (bukan memangkasnya:
  memilih 3 dari maksimum 2 adalah pertanda lead salah membaca soal, dan memilih dua di antaranya
  secara sewenang-wenang persis tebakan yang SPEC-480 hapus) + `DITOLAK:` + `weighty`.
  `kind` **tidak** ditulis ulang — mengganti `kind` merusak idempotensi denyut (SPEC-432).

### 3.3 Dialog `multiSelect` di pane (`tui-dialog.ts` + `pty.ts`)

**Pembacaan** — `readChoiceDialog` mengupas kotak centang:

```ts
const CHECK = /^\[([ xX✔✓])\]\s*(.*)$/;   // "[ ] alpha" | "[✔] beta"
```

Baris yang cocok memberi `{ checked, label }`; dialog ber-`multi: true` bila **ada** baris
berkotak. Sesudah dikupas, `PLACEHOLDER` kembali mengenali `Type something` → `freeIndex` benar,
dan `options` bersih dari ornamen (memperbaiki cacat 1.2.1 sekalian).

Baris tombol kirim dibaca terpisah: `/^\s*([❯>›])?\s{2,}(Submit|Next)\s*$/` → `{ present, focused }`.
Baris **bernomor** `N. Submit answers` milik layar rekap SPEC-474 tak ikut tertangkap karena pola
ini menuntut baris tanpa nomor.

**`dialogKey` untuk layar multi membuang penanda `☐/☒` tab strip.** Ini wajib: mencentang satu
opsi sudah membalik tab yang sedang tampil menjadi `☒` (terukur) tanpa satu pun pertanyaan
berpindah — kunci yang ikut berubah akan membaca layar yang MACET sebagai layar yang maju, cacat
yang sama persis yang SPEC-474 tutup untuk label kolom bebas, lewat pintu baru. Untuk layar multi
kuncinya `q|multi|<header tab>|<judul>`; kemajuan terbaca dari judul yang berganti, dari layar
rekap, atau dari layar yang berhenti jadi dialog. Fail-closed: judul yang sama terbaca "belum
maju".

**Penulisan** — `answerMultiSelectDialog(io, plan, chunkMs)`:

1. Untuk tiap opsi yang harus dicentang tapi belum: kirim nomornya sebagai `send-keys` **satu
   karakter**, jeda, lalu **baca ulang dan buktikan kotaknya benar-benar berubah**. Gagal → `false`.
   Idempoten: yang sudah tercentang dilewati, yang tercentang tapi tak dipilih di-toggle balik.
2. Bila ada prosa: navigasi ke baris kolom bebas dengan `Down` **satu keystroke per pemanggilan**
   (terukur: burst panah = satu perpindahan), berbatas `rows.length + 2` percobaan, dibuktikan
   lewat posisi `❯`. Lalu prosa ber-`goalChunks` + `freeTextFilled` seperti SPEC-452.
3. Navigasi ke tombol kirim sampai `❯` ada di barisnya, lalu `Enter`. **Bukan** `Enter` di baris
   opsi: di sana ia men-toggle.
4. Setiap langkah fail-closed. Gagal di mana pun → `false` → sesi jatuh ke perilaku pra-ADR-0091
   (menunggu manusia), bukan ke tombol yang ditekan asal.

**`sendToPane` menerima pilihan sebagai data**: `sendToPane(id, text, chunkMs, choices: string[])`.
Label dipetakan ke nomor baris lewat `resolveChoices` terhadap `screen.options` — daftar yang
berasal dari layar yang sama, jadi kecocokannya persis. Dua pemanggil ikut sembuh sekaligus: pintu
deteksi lead (`delivery.choices`) **dan** pintu override operator, yang sejak spec ini bisa
mengirim centang manusia langsung ke pane.

Dialog **tanpa** kotak centang tak berubah satu byte pun: jalur SPEC-452/474 persis seperti
sebelumnya.

### 3.4 Dashboard (`LeadScreen`)

- `DecisionRow`: badge `opsi 2/3` menjadi `2 dari 3 opsi` saat jamak, dengan daftar label terpilih
  dirender di bawah jawaban. `?? []` dipertahankan di semua field baru — dashboard bisa lebih baru
  daripada server yang dilayaninya (paket npm global, ADR-0087).
- **Timpa** berhenti jadi kotak teks telanjang: bila barisnya punya `options`, operator melihat
  **radio** (single) atau **checkbox** (multi) — kontrol DS, bukan input mentah — plus kolom
  catatan opsional. Yang dikirim `{ answer, choices }`.
- Kartu baru **"Rantai keputusan"**: daftar `LeadFlow` dengan lencana status
  (`menunggu`/`sebagian`/`selesai`/`dibatalkan`), jumlah langkah, umur; dibuka → langkahnya
  (pertanyaan → opsi → yang dipilih) urut naik. Tombol **Submit** & **Batalkan** untuk alur yang
  masih terbuka.
- DS mendapat `Radio` (cermin `Checkbox` yang sudah ada) + `role`/`aria-checked` supaya keduanya
  bisa ditanya lewat peran, bukan lewat teks.

## 4. Yang sengaja TIDAK dikerjakan

- **`LeadFlow` tidak masuk `WEBHOOK_ENTITIES`.** Katalog itu selektif (`SchedulerQueueItem` —
  model keadaan-proses yang paling mirip — juga di luar), dan transisi alur sudah terbaca dari
  peristiwa `lead_decision` + `GET /lead/flows`. Menambahnya menambah permukaan dokumentasi
  in-app yang tak diminta brief.
- **MCP hanya dapat tambahan aditif** pada `hanoman_lead_ask` (`multi`/`minChoices`/`maxChoices`).
  Protokol berantai butuh beberapa panggilan berurutan + submit; membukanya lewat MCP tanpa
  pintu submit hanya melahirkan alur menggantung yang menunggu penyapu TTL.
- **`rebase` tetap di luar `LEAD_ACTIONS`** — allowlist itu konstanta (AC-31).
- **Alur tak pernah menunggu manusia.** `POST /lead/decisions` tetap sinkron; operator tetap
  pembatal, bukan gerbang (ADR-0091).

## 5. Rencana uji

| Lapis | Bukti |
|---|---|
| shared | `resolveChoices` (nomor · label · duplikat · di luar daftar · ambigu → dibuang), `normalizeSelect`, `checkChoiceCount`, `leadReplyText` jamak, `optionActionHint` diam saat pilihan >1 |
| tui-dialog | fixture pane **hasil tangkapan nyata** dialog multiSelect: label terkupas, `freeIndex` ketemu, `multi` true, tombol `Submit`/`Next` terbaca, `dialogKey` **tidak** berubah saat kotak dicentang, toggle terbukti/gagal, urutan keystroke (satu karakter, satu panah per pemanggilan) |
| decide | pilihan jamak tersimpan sebagai daftar; jumlah di luar min/max ditolak seluruhnya + weighty; `kind` tak ditulis ulang; alur dibuat & ditutup; `flowId` tertutup ditolak |
| routes | 400 bentuk select mustahil · 409 alur tertutup · submit/cancel · override ber-`choices` |
| trail | baris lama (hanya `choice`) tetap memancarkan `choices` satu elemen |
| sweeper | alur kedaluwarsa jadi `dibatalkan` + notifikasi, alur tertutup tak disentuh |
| UI | radio saat single, checkbox saat multi, kirim label terpilih; kartu rantai merender status |
| smoke | boot server + curl: ask multi → flow → ask lanjutan → submit → 409 saat menambah langkah ke alur tertutup |

## 6. Docs SoT yang tersentuh

`internal/docs/adr/0102-*.md` (baru) · `internal/docs/README.md` · `internal/docs/adr/README.md` ·
`internal/docs/architecture/data-model.md` · `internal/docs/architecture/api-contract.md` ·
`internal/skills/hanoman/SKILL.md`.
