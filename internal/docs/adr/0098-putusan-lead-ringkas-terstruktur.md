# ADR-0098 — Putusan lead ringkas & terstruktur: `choice` tervalidasi, `missing`, batas panjang saat pengiriman

- Status: Accepted
- Tanggal: 2026-08-01
- SPEC: SPEC-480 (putusan hanoman-lead terlalu panjang — jawab secukupnya, pilih dari opsi bila ada)
- Terkait: **mengamandemen [0091](0091-hanoman-lead-agen-pemimpin.md)** pada dua acceptance
  criteria-nya — **AC-1** (bentuk jawaban terstruktur: kini memuat pilihan, bukan hanya prosa) dan
  **AC-22** (larangan menjawab "tidak tahu": kini punya satu pengecualian bernama, `missing`);
  **memperluas** [0085](0085-mode-goal-codex-native.md) — batas panjang menjaga `goalChunks` tak
  dipakai untuk mengetik esai ke pane; **membangun di atas** SPEC-452/474 (dialog `AskUserQuestion`
  dijawab lewat kolom bebas, rantainya dituntaskan sampai submit) tanpa mengubah satu langkah pun
  dari mekanisme itu; **tidak menyentuh** [0037](0037-cabut-guardrail-safety.md) — allowlist
  `LEAD_ACTIONS` tetap konstanta modul dan sesi pekerja tetap tanpa hook deny; **tidak mencabut**
  apa pun.

## Konteks

`DecideRequest.options` sudah ada sejak ADR-0091 dan sudah dipakai **empat** pemanggil, tapi verdict
lead tak pernah punya field yang menjawab **"opsi yang mana"**:

| Pemanggil | Opsi yang dikirim | Cara ia membaca putusan sebelum ADR ini |
|---|---|---|
| `lead/detect.ts` (dialog `AskUserQuestion`, SPEC-452) | label opsi dialog | mengetik prosa `reply` ke kolom jawaban bebas — model di seberang yang menafsirkan |
| `lead/pulse.ts` `followUpFinished` (SPEC-451) | `integrate-main — …` · `stop-session — …` · `none — …` | berharap `verdict.action` kebetulan cocok |
| `lead/pulse.ts` `followUpUnfinished` | `resume-session — …` · `restart-session — …` · `none — …` | idem |
| `lead/pulse.ts` `detectCollisions` | `hold-work — …` · `none — …` | idem |
| `lead/pulse.ts` `orderReadyWork` | daftar id backlog | `row.answer.split(/[,\s]+/)` — **regex atas prosa** |

Label opsi denyut sengaja diawali nama tindakan. Itu satu-satunya jembatan antara "opsi yang
dipilih" dan "tindakan yang dijalankan" — dan jembatan itu berupa **harapan** bahwa prosa dan field
`action` sepakat. Lead yang memilih opsi 1 dalam kalimatnya tetapi membiarkan `action` pada
default `"none"` menghasilkan baris `berlaku` yang **tak berefek apa pun** dan tak terbaca sebagai
kesalahan oleh siapa pun.

Sisi kedua: tak ada yang membatasi panjang. `reason` & `reply` bebas, `reply` masuk ke pane lewat
`goalChunks` (potongan 500 char berjeda 50 ms, ADR-0085), dan seluruh prosa itu ditulis agen **di
dalam** anggaran `timeoutSec` yang SPEC-432 sudah buktikan sebagai pembatas nyata (306 dtk → 101 dtk
begitu agen tahu jamnya berdetak). Putusan yang bertele-tele karena itu bukan cuma tak enak dibaca —
ia lebih lambat lahir, lebih mahal, dan lebih sering meleset.

Sisi ketiga datang dari brief: prompt melarang lead mengatakan konteksnya kurang (AC-22). Larangan
itu benar sebagai obat mandek, tapi ia tak membedakan **ragu** (jawabannya ada, buktinya tipis →
`confidence: "ragu"`, sudah tertangani sejak ADR-0091) dari **buta** (pertanyaannya tak bisa dijawab
tanpa fakta yang memang tak ada di repo). Untuk yang kedua, memaksa memilih menghasilkan tebakan
berbaju keputusan — dan jejaknya tetap berstatus `berlaku`.

## Keputusan

**1. Verdict bertambah dua field, keduanya LONGGAR saat parsing.**
`choice: string` (nomor atau label) dan `missing: string[]` (maks 10). `choice` sengaja `string`,
bukan enum/number: pilihan di luar daftar harus bisa **MASUK** supaya server menolaknya secara sadar
dan mencatatnya — alasan yang sama persis dengan `action` di ADR-0091. Kalau zod yang menyaring di
sini, "lead mengarang opsi kelima" hanya akan tampak sebagai keluaran rusak, dan justru peristiwa
yang paling layak dilaporkan itu yang hilang dari jejak.

**2. `resolveChoice(raw, options)` — satu resolver murni di `shared/src/lead.ts`, fail-closed.**
Bentuk yang diterima, berurutan: nomor (`"2"`, `"opsi 2"`, `"#2"`); nomor **beserta labelnya**
(hanya bila keduanya sepakat); teks persis setelah normalisasi; kepala label sebelum `—`/`:`
(bentuk opsi denyut); awalan yang **unik**. Lebih dari satu kandidat → `null`. **Ambigu tak pernah
ditebak**: SPEC-452 sudah mengukur ongkos pencocokan yang "kelihatan benar" — lead memutuskan
Node 22, yang terpilih Node 20, dan jejaknya tetap `berlaku`.

**3. Pilihan di luar daftar ditolak, dicatat, dinotifikasi — tapi barisnya tetap lahir.**
Cermin gerbang `action`: prosa lead disimpan apa adanya, `choice` `null`, `reason` mendapat satu
paragraf `DITOLAK: …`, dan barisnya `weighty` → operator diberi tahu. **`kind` TIDAK ditulis ulang**
jadi `refusal` (beda dari gerbang `action`): SPEC-432 mengukur apa yang terjadi saat `decide()`
mengganti `kind` — gerbang idempotensi denyut yang berkunci padanya menanyakan hal yang sama tiap
denyut selamanya.

**4. Tindakan boleh diturunkan dari opsi terpilih — hanya saat lead diam.**
`optionActionHint(option)` membaca token pertama label. Bila `action` masih `"none"` dan hint ada →
**diadopsi** + catatan di `reason`. Bila `action` sudah disebut dan **berbeda** dari hint →
**konflik**: `action` dikembalikan ke `"none"`, catatan `KONFLIK:` ditulis, baris jadi `weighty`.
Adopsi sah karena label opsi dirakit **pemanggil**, bukan lead — hint-nya bukan tebakan atas maksud
agen; untuk label bebas (dialog `AskUserQuestion`) `optionActionHint` mengembalikan `null` dan tak
ada yang diadopsi. Pertentangan tak pernah ditebak.

**5. Ringkas ditegakkan di prompt, dipagari saat PENGIRIMAN.**
`LEAD_DECISION_MAX = 240` & `LEAD_REASON_MAX = 480` disebut prompt **dengan angkanya**, disertai
larangan eksplisit: tanpa ringkasan ulang konteks, tanpa latar belakang, tanpa alternatif yang tak
diminta, tanpa rencana bertahap. `clampProse` memangkas di batas kalimat (lalu batas kata + `…`)
hanya untuk yang **dikirim** — balasan `POST /lead/decisions` dan teks yang diketik ke pane.
**Baris `LeadDecision` menyimpan keluaran lead UTUH**: jejak adalah tempat orang mencari kenapa
sebuah putusan diambil, dan memangkasnya menukar putusan bertele-tele dengan putusan yang tak bisa
diaudit.

**6. `missing` memaksa `ragu`, dan berujung pada operator.**
Terisi ⇒ `confidence` jadi `ragu` apa pun yang ditulis lead (menyatakan konteksnya kurang **dan**
mengaku yakin tak bisa benar bersamaan) ⇒ `isWeightyDecision` ⇒ notifikasi. `decision` **tetap
wajib** (`.min(1)`), dan itulah kompatibilitas mundurnya: pemanggil lama yang hanya membaca teks
tetap menerima kalimat yang bermakna.

**7. Teks balasan dirakit deterministik (`leadReplyText`), bukan dipungut dari prosa.**
Urutannya: `missing` terisi → "Belum bisa kuputuskan. Yang kurang: …"; pilihan terselesaikan →
"Pilih: `<label verbatim>`. `<alasan>`"; selain itu `reply || decision`. Menyebut label opsi
**verbatim** adalah cara paling tak ambigu memberitahu model di seberang mana yang dipilih — kolom
jawaban bebas dialog itu kolom teks (SPEC-452), bukan widget daftar.

**8. Empat kolom aditif di `LeadDecision`, semuanya nullable tanpa default.**
`choice String?` · `choiceIndex Int?` · `options Json?` · `missing Json?`. Migration ditulis tangan
(worktree tetangga membuat `migrate dev` me-reset DB saat ada drift), murni `ADD COLUMN`. `options`
ikut disimpan karena tanpa itu jejak tak bisa dibaca ulang: `question` tersimpan, menunya tidak,
jadi "lead memilih opsi 2" tak bisa diverifikasi enam jam kemudian dan UI tak bisa menulis "opsi 2
dari 3". `LeadDecision` LOCAL-only → tak ada whitelist field sync yang berubah; ia sudah ada di
`PG_ORDER`.

## Konsekuensi

- Peminta mesin membaca `choice` alih-alih menafsirkan prosa — inilah yang membuat balasan pintu #1
  benar-benar terbaca mesin, janji yang sudah tertulis di ADR-0091 tapi belum pernah terpenuhi untuk
  pertanyaan berpilihan.
- Putusan lebih pendek berarti lebih cepat lahir di dalam anggaran `timeoutSec` yang sama — beban
  saat banyak sesi menunggu bersamaan ikut turun.
- Jejak jadi bisa diaudit sendiri: pertanyaan, menunya, dan pilihannya ada di satu baris.
- Larangan "tidak tahu" kini punya satu pengecualian **bernama**, dan pengecualian itu berujung pada
  operator (weighty + notifikasi), bukan pada diam. Mandek yang ingin dihapus ADR-0091 tak kembali:
  yang berubah adalah lead sekarang bisa mengatakan **apa** yang ia butuhkan.
- Balasan `POST /lead/decisions` memuat prosa **terpangkas** sementara `GET /lead/decisions` memuat
  yang penuh. Itu perbedaan yang disengaja dan wajib disebut di kontrak API.

## Alternatif yang ditolak

- **`choice` sebagai enum/number di zod.** Pilihan karangan lenyap sebagai "keluaran rusak" — persis
  peristiwa yang paling layak dilaporkan. Pola ini sudah diputuskan untuk `action` di ADR-0091.
- **Batas panjang sebagai `.max()` di `zLeadVerdict`.** Keluaran yang sedikit meleset jadi `gagal`
  total, melawan prinsip "longgar pada bagian yang tak mengubah keamanan, ketat pada `action`".
- **Memangkas prosa sebelum menulis jejak.** Menukar putusan bertele-tele dengan putusan yang tak
  bisa diaudit; brief ini justru mensyaratkan jejak tetap penuh.
- **`kind: "refusal"` untuk pilihan yang ditolak.** Mengulang bug idempotensi SPEC-432.
- **Field urutan terstruktur untuk `orderReadyWork`.** Pertanyaannya "urutkan N", bukan "pilih satu";
  memaksakannya ke `choice` hanya akan berarti "yang mana duluan" dan menyisakan parsing prosa untuk
  sisanya. Layak jadi spec sendiri.

## Gotcha

1. **`clampProse` melipat spasi, dan itu bukan kosmetik.** Satu baris baru yang lolos ke pane adalah
   `Enter`, dan `Enter` di tengah dialog mengirim jawaban yang baru separuh jadi (kelas SPEC-452).
2. **Catatan `DITOLAK`/`KONFLIK` ditempel SESUDAH pemangkasan.** Kalau tidak, justru bagian yang
   paling perlu dibaca yang terpotong.
3. **Adopsi `action` dari opsi hanya sah karena labelnya milik pemanggil.** Untuk label bebas hint-nya
   `null` dan tak ada yang diadopsi — jangan pernah memperluasnya ke pencocokan isi prosa.
4. **Saluran pengiriman (`takeDelivery`) hidup di memori dan berumur satu ketikan.** Ia bisa meleset;
   yang selalu ada adalah `answer` di baris jejak. Jangan pernah mengetik string kosong ke pane hanya
   karena saluran itu kosong. Di `detect.ts` ia disuntikkan sebagai dep (`delivery`) supaya rantai
   dialog bisa diuji tanpa menjalankan `decide()` — prod tetap satu definisi.
5. **Dashboard bisa lebih baru daripada server yang dilayaninya** (paket npm global, ADR-0087), jadi
   `LeadScreen` membaca `options`/`missing` dengan `?? []`: baris berbentuk lama akan meruntuhkan
   SELURUH panel, bukan cuma badge-nya.
