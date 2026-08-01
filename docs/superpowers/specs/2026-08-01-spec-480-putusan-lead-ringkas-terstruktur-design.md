# SPEC-480 — Putusan hanoman-lead ringkas & terstruktur

**Tanggal:** 2026-08-01 · **Sumber:** brief · **Prioritas:** tinggi
**ADR baru:** ADR-0098 (mengamandemen ADR-0091 AC-1/AC-22) · **Migration:** ya (aditif, empat kolom)

## Masalah

`leadPrompt` meminta satu blok ```json yang seluruh isinya prosa: `decision` (satu kalimat, tak
dibatasi), `reason` (bebas), `reply` (bebas). Tak ada satu pun field yang menjawab **"opsi mana"**,
padahal `DecideRequest.options` sudah dipakai empat pemanggil:

| Pemanggil | Opsi yang dikirim | Cara ia membaca putusan hari ini |
| --- | --- | --- |
| `detect.ts` (dialog `AskUserQuestion`, SPEC-452) | label opsi dialog | mengetik prosa `reply` ke kolom jawaban bebas — model di seberang yang menafsirkan |
| `pulse.ts` `followUpFinished` (SPEC-451) | `integrate-main — …` / `stop-session — …` / `none — …` | berharap `verdict.action` kebetulan cocok |
| `pulse.ts` `followUpUnfinished` | `resume-session — …` / `restart-session — …` / `none — …` | idem |
| `pulse.ts` `detectCollisions` | `hold-work — …` / `none — …` | idem |
| `pulse.ts` `orderReadyWork` | daftar id backlog | `row.answer.split(/[,\s]+/)` — **regex atas prosa** |

Dua akibat yang terukur di kode, bukan dugaan:

1. **Pilihan tak pernah menyeberang sebagai data.** Label opsi denyut sengaja diawali nama tindakan
   (`"integrate-main — merge branch sesi ini ke main"`) — itu satu-satunya jembatan antara "opsi yang
   dipilih" dan "tindakan yang dijalankan", dan jembatan itu hanya berupa **harapan** bahwa lead
   mengisi `action` konsisten dengan opsi yang ia sebut dalam prosa. Bila lead memilih opsi 1 di
   prosa tapi membiarkan `action: "none"` (nilai default `zLeadVerdict`), `apply.ts` tak menjalankan
   apa pun dan barisnya tetap `berlaku` — putusan yang tampak sah, tak berefek, dan tak terbaca
   sebagai kesalahan oleh siapa pun.
2. **Tak ada yang membatasi panjang.** `reason` & `reply` bebas; `reply` masuk ke pane lewat
   `goalChunks` (potongan 500 char) sehingga prosa panjang berarti puluhan `send-keys` berjeda,
   dan `decide()` menunggu agen menulis semuanya di dalam anggaran `timeoutSec` yang sama yang
   SPEC-432 buktikan sebagai pembatas nyata (306 s → 101 s begitu agen tahu jamnya berdetak).

Sisi ketiga datang dari brief: prompt hari ini melarang lead mengatakan konteksnya kurang
("Jangan pernah menjawab \"tidak tahu\"", ADR-0091 AC-22). Larangan itu benar sebagai obat mandek,
tapi ia tak membedakan **ragu** (jawabannya ada, buktinya tipis → `confidence: "ragu"`, sudah
tertangani) dari **buta** (pertanyaannya tak bisa dijawab tanpa fakta yang memang tak ada di repo).
Untuk yang kedua, memaksa memilih menghasilkan tebakan berbaju keputusan.

## Keputusan

### 1. Verdict lead bertambah dua field

`shared/src/lead.ts` · `zLeadVerdict`:

```ts
choice:  z.string().default(""),                       // nomor ATAU label opsi yang dipilih
missing: z.array(z.string().max(200)).max(10).default([]),  // apa yang kurang, bila memang kurang
```

`choice` sengaja **`string`, bukan enum/number** — alasan yang sama persis dengan `action`
(ADR-0091): pilihan di luar daftar harus bisa **MASUK** supaya server menolaknya secara sadar dan
mencatatnya. Kalau zod yang menyaring di sini, "lead mengarang opsi kelima" hanya akan tampak
sebagai keluaran rusak, dan justru peristiwa yang paling layak dilaporkan itu yang hilang dari jejak.

### 2. `resolveChoice(raw, options)` — satu resolver murni, fail-closed

Di `shared/src/lead.ts` (dipakai server, UI, dan test dari satu sumber). Mengembalikan
`{ index, option }` 1-basis atau `null`. Bentuk yang diterima, berurutan:

1. **Nomor** — `"2"`, `"2."`, `"#2"`, `"opsi 2"`, `"option 2"` → indeks 1-basis; di luar rentang → `null`.
2. **Teks persis** setelah normalisasi (trim, lipat spasi, case-insensitive).
3. **Kepala label** — potongan sebelum `—`/`-`/`:` pertama (opsi denyut berbentuk
   `"integrate-main — …"`), harus **unik**.
4. **Awalan** (`startsWith`) yang **unik**.

Lebih dari satu kandidat pada langkah 3/4 → `null`. **Ambigu = tak terpilih**: SPEC-452 sudah
membayar harga dari pencocokan yang "kelihatan benar" (jawaban lead memilih Node 20 padahal ia
memutuskan Node 22, jejaknya tetap `berlaku`).

### 3. Pilihan di luar daftar ditolak, dicatat, dan dinotifikasi — bukan digagalkan

Cermin gerbang `action`: baris jejak **tetap lahir** dengan prosa lead apa adanya, `choice` disimpan
`null`, `reason` mendapat satu paragraf `DITOLAK: pilihan "…" tidak ada di daftar opsi yang dikirim
peminta (SPEC-480)`, dan barisnya jadi `weighty` → operator dinotifikasi.

`kind` **tidak** ditulis ulang jadi `refusal` (beda dari gerbang `action`). SPEC-432 mengukur apa
yang terjadi saat `decide()` mengganti `kind`: gerbang idempotensi denyut yang berkunci `kind`
menanyakan hal yang sama tiap denyut selamanya. Penolakan pilihan sudah cukup terbaca dari
`choice = null` + catatan di `reason`.

### 4. Tindakan boleh diturunkan dari pilihan — hanya saat lead diam, tak pernah saat ia bertentangan

`optionActionHint(option)`: token pertama label (sebelum spasi/`—`) yang ada di `LEAD_ACTIONS` →
`LeadAction`, selain itu `null`. Lalu di `decide()`, **hanya bila peminta mengirim opsi dan pilihan
lead terselesaikan**:

| `verdict.action` | hint dari opsi terpilih | hasil |
| --- | --- | --- |
| `"none"` (default) | `integrate-main` | **diadopsi** → `action = "integrate-main"` |
| `"none"` | tak ada hint | tetap `none` |
| `"stop-session"` | `stop-session` | tetap (sepakat) |
| `"stop-session"` | `integrate-main` | **konflik** → `action = "none"` + catatan di `reason` + `weighty` |

Adopsi hanya menutup lubang "lead memilih opsi tindakan lalu lupa mengisi `action`" — label itu
dirakit **pemanggil**, bukan lead, jadi hint-nya bukan tebakan. Pertentangan tak pernah ditebak:
`none` + notifikasi. Allowlist `LEAD_ACTIONS` dan seluruh gerbang `apply.ts`
(`requireGreenBeforeIntegrate`, `planDone`) tetap berlaku sesudahnya — ADR-0091 AC-31/32 utuh.

### 5. Ringkas ditegakkan di prompt, dipagari saat pengiriman

Dua batas sebagai konstanta bersama: `LEAD_DECISION_MAX = 240`, `LEAD_REASON_MAX = 480` (±1 dan ±3
kalimat). Prompt menyebut keduanya dengan angka, plus larangan eksplisit: tanpa ringkasan ulang
konteks, tanpa latar belakang, tanpa alternatif yang tak diminta.

`clampProse(s, max)` (murni): potong di **batas kalimat** terakhir yang muat, kalau tak ada di batas
**kata**, tambahkan `…`. Diterapkan **saat pengiriman saja**:

- `LeadAnswer` (`POST /lead/decisions`) → `decision`/`reason` terpangkas;
- teks yang diketik ke pane → terpangkas;
- **baris `LeadDecision` menyimpan keluaran lead UTUH** — brief menuntut jejak tetap penuh, dan
  jejak adalah tempat orang mencari kenapa sebuah putusan diambil.

Catatan `DITOLAK:`/konflik ditempelkan **sesudah** pemangkasan, jadi ia tak pernah ikut terpotong.

Mekanismenya lewat saluran samping yang sudah ada: `lastReply: Map<id,string>` + `takeReply()`
diperlebar jadi `lastDelivery: Map<id, LeadDelivery>` + `takeDelivery()` — satu tempat yang tahu
bentuk "putusan sebagaimana dikirim", dipakai route (pintu #1) dan `detect.ts` (pintu #2).

### 6. Teks balasan dirakit deterministik, bukan dipungut dari prosa

`leadReplyText(d: LeadDelivery)` (murni), berurutan:

1. `missing` terisi → `Belum bisa kuputuskan. Yang kurang: <a>; <b>.`
2. pilihan terselesaikan → `Pilih: <label opsi verbatim>. <reason terpangkas>`
3. selain itu → `reply || decision`, terpangkas.

Bentuk (2) langsung menjawab kelemahan SPEC-452: kolom jawaban bebas dialog `AskUserQuestion` adalah
kolom teks, dan menyebut label opsi **verbatim** adalah cara paling tak ambigu memberitahu model di
seberang mana yang dipilih. Rantai dialog SPEC-474 (`runChain`, submit, `dialogKey`) tak disentuh.

### 7. Jalur "konteks kurang" (`missing`) — pintu sempit yang berujung pada operator

`missing` terisi ⇒ `confidence` **dipaksa** `ragu` ⇒ `isWeightyDecision` ⇒ notifikasi operator.
`choice` boleh `null` di jalur ini, dan `decision` **tetap wajib** (`.min(1)`) — pemanggil lama yang
hanya membaca teks tetap menerima kalimat yang bermakna ("Belum bisa diputuskan sampai … diketahui"),
itulah kompatibilitas mundurnya.

Prompt membingkainya sempit: `missing` bukan untuk "buktinya tipis" (itu `confidence: "ragu"`, yang
sudah ada) melainkan untuk fakta konkret yang **tak ada di repo maupun konteks** — dan isinya wajib
berupa hal yang bisa disediakan seseorang, bukan keluhan.

### 8. Skema: empat kolom aditif di `LeadDecision`

```prisma
choice      String?   // label opsi terpilih, verbatim; null = tak ada opsi / pilihan ditolak
choiceIndex Int?      // 1-basis, sepasang dengan `choice`
options     Json?     // daftar opsi yang DIKIRIM peminta — jejak jadi bisa diaudit sendiri
missing     Json?     // string[] — apa yang kurang bila lead menyatakan konteksnya tak cukup
```

Migration **tulis tangan** (worktree tetangga membuat `migrate dev` me-reset DB saat ada drift):
empat `ALTER TABLE … ADD COLUMN`, semuanya **nullable tanpa default** — aditif murni, tak ada tabel
diredefinisi, baris lama sah apa adanya. `LeadDecision` LOCAL-only (tak disync) → tak ada `FIELDS`
sync yang berubah; ia sudah ada di `PG_ORDER`, kolom baru tak mengubah urutan tabel.

Kenapa `options` ikut disimpan: tanpa itu jejak tak bisa dibaca ulang. `question` tersimpan, opsinya
tidak — jadi "lead memilih opsi 2" hari ini tak bisa diverifikasi enam jam kemudian, dan UI tak bisa
menulis "opsi 2 dari 3".

### 9. Permukaan wire & UI

- `zLeadAnswer` (balasan pintu #1) `+= { choice: {index, option} | null, missing: string[] }`.
- `zLeadDecisionView` (jejak) `+= { choice, choiceIndex, options, missing }`.
- `LeadScreen` · `DecisionRow`: badge `opsi 2/3` + label opsi terpilih saat ada; badge `kurang
  konteks` + daftar `missing` saat terisi.

## Yang sengaja TIDAK dilakukan

- **`orderReadyWork` tidak diberi field urutan terstruktur.** Pertanyaannya bukan "pilih satu"
  melainkan "urutkan N"; memaksakannya ke `choice` akan berarti "yang mana duluan" dan menyisakan
  parsing prosa untuk sisanya. Ia tetap mengirim `options` (menu kandidat) dan tetap membaca urutan
  dari `answer`; `choice`-nya bermakna "yang paling dulu" dan tak dipakai. Urutan terstruktur layak
  jadi spec sendiri.
- **`zLeadVerdict` tidak diberi batas panjang zod.** Keluaran yang sedikit meleset akan jadi `gagal`
  total, melawan prinsip "longgar pada bagian yang tak mengubah keamanan, ketat pada `action`".
- **`kind`/`LEAD_ACTIONS`/`apply.ts` tidak disentuh.** Allowlist tetap konstanta modul.

## Test (TDD, per unit)

| Berkas | Yang dibuktikan |
| --- | --- |
| `shared/src/lead.test.ts` | `resolveChoice` (nomor, teks persis, kepala label, awalan unik, ambigu → null, di luar rentang → null); `clampProse` (batas kalimat, batas kata, di bawah batas tak disentuh); `optionActionHint`; default `choice`/`missing` di `zLeadVerdict` |
| `server/test/lead-decide.test.ts` | pilihan sah → `choice`/`choiceIndex`/`options` tersimpan; di luar daftar → `choice` null + `DITOLAK` di `reason` + `weighty`, `kind` **tetap**; `missing` → `confidence` jadi `ragu` + weighty; adopsi action saat `none`; konflik action → `none` + weighty; **jejak menyimpan prosa penuh sementara `takeDelivery` terpangkas** |
| `server/test/lead-routes.test.ts` | 201 `LeadAnswer` memuat `choice`/`missing` & prosa terpangkas |
| `server/test/lead-prompt.test.ts` | prompt menyebut `choice`, `missing`, kedua angka batas, dan tetap menomori opsi |
| `server/test/lead-detect.test.ts` | teks yang diketik ke pane = `leadReplyText` (menyebut label opsi verbatim), rantai SPEC-474 tak berubah |
| `src/test/lead-screen.test.tsx` | badge `opsi n/m` + badge `kurang konteks` |

## Docs yang tersentuh

`internal/docs/adr/0098-*.md` (baru) · `internal/docs/README.md` · `internal/docs/adr/README.md` ·
`internal/docs/architecture/data-model.md` · `internal/docs/architecture/api-contract.md` ·
`internal/skills/hanoman/SKILL.md`.
