# SPEC-145 — Objective (QA after audit: keputusan sebelum spec)

**Fase:** Brainstorm → Objective (dikunci) · 2026-07-09
**Jenis:** fitur — alur QA berhenti menjadi pipeline statis; Audit memilih jalur hilirnya sendiri
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Turunan:** brainstorm → [`docs/superpowers/specs/2026-07-09-hanoman-qa-after-audit-spec-145-brainstorm.md`].

## Masalah

Alur QA adalah pipeline **statis empat fase** (`runner/src/phases.ts:4`):

```ts
qa: ["Audit", "Spec", "Plan", "Execute"],
```

Setiap run QA membayar Spec dan Plan, termasuk untuk temuan yang perbaikannya satu baris.
Tidak ada titik keputusan di antara Audit dan Spec. SPEC-142 adalah contohnya sendiri: audit-nya
menutup dengan "satu predikat bersama … dalam satu diff kecil", lalu tetap menjalankan dua fase
perencanaan penuh untuk menuliskannya.

Tiga fakta di kode hari ini yang menentukan bentuk perbaikannya:

1. **Semua tuas pemangkas fase dievaluasi sebelum run mulai.** `input.only`
   (`runner/src/run.ts:20`) memilih **tepat satu** fase, bukan sub-pipeline, dan di-serialisasi ke
   payload job; `phasesForFlow` (`server/src/queue.ts:16-19`) menyemai `run.phases` saat
   `enqueueRun`. Pada detik keduanya dibaca, Audit belum berjalan — belum ada yang bisa diputuskan.

2. **Runner buta terhadap isi jawaban agen.** `takeTurn` (`runner/src/turns.ts:10-27`)
   mengembalikan `{ sessionId, subtype, tokensIn, tokensOut, costUsd }`. Teks fase mengalir ke
   `onEvent` sebagai baris log (`runner/src/phase.ts:33`) dan tidak pernah kembali ke `runOne`.

3. **Jalur cepat tidak melewati guardrail.** Gerbang Execute (`runner/src/run.ts:65-76`) tetap
   memanggil `deps.verify(worktree)` → `hanoman docs verify --block-if-stale`. Yang dilewati adalah
   dua giliran claude, bukan Source of Truth.

## Objective (dikunci)

**Sesudah fase Audit, run QA mengambil satu keputusan sebelum melanjutkan.** Temuan kecil,
terlokalisasi, dan tanpa keputusan desain → **langsung Execute**; fase Spec dan Plan dilewati dan
tercatat sebagai dilewati. Temuan kompleks → **Spec → Plan → Execute**, persis seperti hari ini.

Keputusan itu dibuat oleh sesi yang baru saja melakukan audit, diambil **sekali per run**, dan
**gagal ke jalur penuh** bila apa pun tentangnya tidak jelas — tanpa menambah dependency runtime,
tanpa melemahkan gerbang Source of Truth, dan tanpa menyentuh alur `feature` maupun `scaffold`.

## Kriteria sukses (tingkat fase)

- **Tuas keputusan hidup di dalam `runOne`** — bukan di `only`, bukan di `phasesForFlow`. Keduanya
  dibaca sebelum Audit ada, sehingga keduanya secara struktural tidak dapat menampung keputusan ini.

- **Keputusan menyeberang lewat artefak, bukan lewat teks** — fase Audit pada flow `qa` menulis satu
  berkas JSON di root worktree; `runOne` membacanya sesudah Audit `done`, lalu **menghapusnya**
  (repo project target tidak ikut kotor). Bentuknya satu bit + alasan:

  ```json
  { "path": "execute", "reason": "satu predikat di App.tsx:303 kehilangan status queued" }
  ```

  `reason` masuk ke log run sebagai catatan mengapa Spec dilewati.

  **Bukan sentinel di teks jawaban.** Fase Audit membaca kode dan log; sebuah baris berisi sentinel
  di dalam berkas yang ia kutip dapat ikut tercetak. Keputusan untuk melewati perencanaan tidak boleh
  punya jalur injeksi.

  **Bukan pula field `confidence` terpisah.** Brief menyebut confidence, tetapi keluarannya tetap satu
  bit: `path: "execute"` dengan confidence rendah hanya bisa berarti "jangan execute" — dua knob untuk
  satu keluaran, dengan ambang yang tak seorang pun bisa kalibrasi. Confidence hidup di **instruksi
  prompt** ("pilih `execute` hanya bila perbaikannya kecil, terlokalisasi, dan tidak menuntut keputusan
  desain; saat ragu, pilih `spec`"), dan buktinya adalah `reason` yang tercatat.

- **Berkas hilang, rusak, atau tak terbaca → jalur penuh (`spec`).** Ini menyimpang dari
  [ADR-0009](../adr/0009-guardrail-crash-fails-loud.md) **dengan sengaja**: yang gagal di sini bukan
  guardrail, melainkan sebuah optimasi. Kehilangan optimasi berarti mengerjakan Spec dan Plan yang
  mungkin tak perlu — mahal, tapi benar. Gagal keras akan menjatuhkan run QA yang sehat karena satu
  berkas JSON tak tertulis.

- **Fase yang dilewati bernama `skipped`, bukan `done`** — `run.phases` sudah disemai empat baris
  `pending` saat enqueue, jauh sebelum keputusan ada; keempatnya tetap ada di baris Run. Menandai Spec
  dan Plan `done` akan berbohong: `PHASE_DONE_STAGE` (`server/src/runner/events-io.ts:10-16`) memetakan
  `Plan → planned`, sehingga backlog item mengaku punya plan yang tak pernah ditulis. Membuang barisnya
  juga bukan pilihan: `persistEvent` memetakan fase **di tempat** (`events-io.ts:56`).

- **`skipped` didefinisikan di kedua tempat enum itu hidup** — dan ini butir yang paling mudah
  terlewat. State fase punya **dua definisi independen**:
  - `PhaseState` — `runner/src/types.ts:31` (`"pending" | "active" | "done" | "failed"`)
  - `zPhase` — `shared/src/entities.ts:30` (`z.enum(["done","active","failed","pending"])`)

  Menambah `skipped` hanya di satu sisi membuat `Run["phases"][n].state` tak menerima nilai yang
  runner benar-benar pancarkan. (`zRun` hari ini di-*infer* menjadi tipe, tak pernah di-`parse` pada
  request mana pun, sehingga kelalaian ini gagal pada waktu kompilasi — bukan runtime.)

- **`computeProgress` mengeluarkan `skipped` dari penyebut** — `server/src/runner/events-io.ts:20-23`
  hari ini menghitung `done / total`. Tanpa perubahan ini setiap run jalur cepat yang **berhasil**
  melapor 50% dan tampak macet: mekanismenya bekerja, dashboard-nya berbohong.

- **Keputusan bertahan melewati resume, tanpa kolom baru** — worker menyusun `donePhases` dari
  `run.phases` saat resume (`server/src/worker.ts:60-64`). Fase ber-state `skipped` ikut dihitung di
  sana, sehingga run yang di-resume (ADR-0017) mengulang keputusan yang sama tanpa menyimpan apa pun di
  tempat baru — dan justru itulah yang membuat artefak boleh dihapus segera sesudah dibaca.

- **`PhasePipeline` mengenali `skipped`** — `src/src/screens/RunsScreen.tsx:21-46` hanya mengenal empat
  state; apa pun di luar `done`/`active`/`failed` jatuh ke gaya `pending`. Fase yang dilewati harus
  terbaca berbeda dari fase yang belum dijalankan.

- **Stage backlog boleh melompat** — `mirrorStage` maju-saja (`events-io.ts:25-32`), jadi
  `objective → executing` sah; `spec-ready` dan `planned` tak pernah disinggahi. Itu jujur: fase itu
  memang tak dijalankan. Hanya berlaku untuk run QA yang punya `specId`; run QA dari `fireTrigger`
  (`server/src/fire-trigger.ts:41-45`) tak punya spec untuk dicerminkan.

- **Test menyusul logika** — `computeProgress` dengan `skipped`, pembacaan artefak (ada / hilang /
  rusak), dan pemangkasan fase di `runOne` semuanya murni atau ber-dep injeksi. Unit test di
  `runner/test/run.test.ts` dan `server/test/events-io.test.ts`, bukan harness baru.

- **Docs & keputusan tercatat** — `internal/docs` yang tersentuh diperbarui + ter-link di index;
  perubahan didasari ADR baru.

## Batas scope

- **Termasuk:** artefak keputusan + instruksi di `phasePrompt` untuk `qa`/`Audit`; pembacaan artefak
  dan pemangkasan fase di `runOne`; state `skipped` di `PhaseState` **dan** `zPhase`; penyebut
  `computeProgress`; `donePhases` resume ikut menghitung `skipped`; rendering `skipped` di
  `PhasePipeline`; ADR — dan hanya itu.

- **Tidak termasuk:** keputusan **per-temuan** (satu run = satu keputusan); tombol override manusia di
  dashboard; alur `feature` dan `scaffold`; `path: "none"` (lihat *Keputusan yang dikunci dengan
  default* butir 1); kill switch di `Setting` (butir 2).

## Perangkap yang tercatat

- **`PlanSteps` bukan fase run.** `RunsScreen.tsx:65-71` menghitung `doneN` atas `run.plan` — langkah
  plan, bukan `run.phases`. Ia **tidak** tersentuh pekerjaan ini. Fase Brainstorm keliru
  memasukkannya ke scope; dikoreksi di sini.

- **Fase Audit wajib menulis doc.** Jalur cepat sah hanya karena dokumen audit menjadi *doc-of-record*
  untuk perbaikan kecil: saat Execute mengubah `src/`, `freshnessViolation` (`cli/src/verify.ts:32`)
  melihat perubahan doc di commit yang sama. Audit yang tak menulis apa pun akan diblokir Stop hook di
  ujung run — dan pada jalur cepat tak ada dokumen spec yang menyelamatkannya.

- **Commit kosong (laten, di luar scope).** `commitAndPush` (`runner/src/git.ts:46`) menjalankan
  `git commit -m` tanpa `--allow-empty`; run yang tak mengubah apa pun melempar. Hari ini tertutup
  karena fase Audit selalu menulis doc. Setiap usulan `path: "none"` menabrak ini lebih dulu.

## Prinsip yang dipegang

- **Keputusan otonom, default konservatif.** Satu bit, dan bit yang tak terbaca selalu berarti "jalur
  penuh". Optimasi yang gagal harus berdegradasi menjadi perilaku hari ini, bukan menjadi kegagalan.

- **Melewati giliran, bukan melewati gerbang.** `deps.verify` tetap menjaga Execute. Jalur cepat tidak
  mencabut satu pun pengawasan manusia yang ada hari ini — alur QA sudah sepenuhnya otonom dari Audit
  sampai push (ADR-0015: satu backlog, satu sesi).

- **Catat yang dilewati, jangan sembunyikan.** `skipped` adalah state pertama kelas, bukan ketiadaan.
  Ia yang membuat progress jujur, resume deterministik, dan dashboard terbaca.

- **Perbaiki di titik semua pembaca melihatnya.** State fase punya dua definisi; keduanya bergerak
  bersama atau tidak sama sekali.

- **Tanpa dependency runtime baru.** `existsSync` sudah diimpor `runner/src/run.ts`; sisanya
  `readFileSync` + `JSON.parse`.

## Keputusan yang dikunci dengan default

Fase Brainstorm menutup dengan lima pertanyaan yang tidak dapat dijawab dari dalam run headless.
Kelimanya dikunci di sini dengan **default yang direkomendasikan**, dicatat terbuka agar dapat dibalik
lewat amandemen sebelum fase Execute — bukan diperlakukan seolah sudah dikonfirmasi manusia:

1. **`path: "none"` (audit tak menemukan apa pun)** → **tidak masuk.** Mekanismenya memang gratis, tapi
   ia menabrak commit kosong (`git.ts:46`) yang perbaikannya bukan milik backlog item ini. Objective ini
   memilih **antara** memperbaiki sekarang dan merencanakan dulu; "tidak ada yang perlu diperbaiki"
   adalah pertanyaan ketiga. Backlog item terpisah.

2. **Kill switch `qaFastTrack` di `Setting`** → **tidak masuk.** Godaannya kuat (JSON, tanpa migration),
   tapi tuas itu melindungi dari sesuatu yang tidak ada: jalur cepat tidak mencabut gerbang `verify`
   dan tidak mencabut review manusia, karena alur QA hari ini sudah berjalan dari Audit sampai push
   tanpa manusia di tengahnya. Konsekuensi terburuk sebuah keputusan `execute` yang salah adalah commit
   kecil yang buruk di `branchTo` — persis yang bisa dihasilkan jalur Spec → Plan → Execute hari ini.
   Tambahkan bila ada buktinya, bukan sebelum.

3. **Temuan campuran (satu sepele, satu kompleks)** → **satu keputusan per run, kompleks menang.**
   Instruksi prompt sudah memuat "saat ragu, pilih `spec`", dan audit yang menemukan keduanya sedang
   ragu menurut definisi. Memecah per-temuan menuntut model temuan yang tak dimiliki alur QA hari ini
   (audit menghasilkan satu dokumen, bukan daftar terstruktur).

4. **ADR** → **ya, ditulis.** Ini menggeser **apa itu pipeline** — dari konstanta per-flow menjadi
   sesuatu yang agen persempit sendiri di tengah run. Nomor dialokasikan pada fase Spec/Execute setelah
   dienumerasi lintas branch dan worktree: `0018` sudah diklaim **dua kali** pada branch berbeda
   (`0018-coverage-nilai-turunan.md`, `0018-branch-adalah-properti-backlog-item.md`), mengikuti preseden
   pengalokasian di [SPEC-141](spec-141-overview-coverage-realtime-objective.md).

5. **Run satu fase (`hanoman qa --only Audit`)** → **instruksi tetap dipancarkan.** Runner membaca dan
   menghapus artefaknya; tanpa fase hilir, pemangkasannya no-op. Mengkondisikan prompt pada `only`
   menambah cabang untuk menghemat satu berkas sementara.

> Chiranjivi — objective bertahan lebih lama dari satu run. Spec dan plan turunannya tunduk pada
> pernyataan ini.
