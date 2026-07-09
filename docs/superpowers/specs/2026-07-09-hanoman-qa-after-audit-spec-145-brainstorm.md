# SPEC-145 — QA after audit: keputusan sebelum spec

**Status:** brainstorm — objective belum dikunci
**Date:** 2026-07-09
**Fase:** Brainstorm (feature: Brainstorm → Objective → Spec → Plan → Execute)
**Sumber:** brief · prioritas tinggi

## Objective (kandidat, belum dikunci)

Setelah fase **Audit** pada alur QA, run mengambil **satu keputusan** sebelum melanjutkan:

- temuan kecil, terlokalisasi, tanpa keputusan desain → **langsung Execute**, fase Spec dan
  Plan dilewati;
- temuan kompleks → **Spec → Plan → Execute**, persis seperti hari ini.

## Kondisi sekarang

Alur QA adalah pipeline **statis empat fase** (`runner/src/phases.ts:4`):

```ts
qa: ["Audit", "Spec", "Plan", "Execute"],
```

Setiap run QA membayar Spec dan Plan, termasuk untuk temuan satu baris. Tidak ada titik
keputusan di antara Audit dan Spec.

Satu-satunya pemangkas fase yang ada adalah `input.only` (`runner/src/run.ts:20`):

```ts
const all = PIPELINES[input.flow].filter((p) => !input.only || p === input.only);
```

Ia memilih **tepat satu** fase, bukan sebuah sub-pipeline, dan tak pernah di-set dari server —
`only` tidak ada di `zCreateRun` (`shared/src/dto.ts`) maupun `POST /runs`; hanya CLI
(`cli/src/commands/qa.ts:6`) yang mengisinya.

Tiga fakta yang membentuk desain:

1. **Keputusan lahir di tengah run.** Semua tuas pemangkas fase yang ada dievaluasi
   **sebelum** run mulai: `only` di-serialisasi ke payload job, dan `phasesForFlow`
   (`server/src/queue.ts:16-19`) menyemai `run.phases` saat `enqueueRun`. Pada detik itu
   Audit belum berjalan, jadi belum ada yang bisa diputuskan. Tuas baru **wajib hidup di
   dalam `runOne`**.

2. **Runner buta terhadap isi jawaban agen.** `takeTurn` (`runner/src/turns.ts:10-27`)
   mengembalikan `{ sessionId, subtype, tokensIn, tokensOut, costUsd }`. Teks fase mengalir
   ke `onEvent` sebagai baris log (`runner/src/phase.ts:33`) dan tidak pernah kembali ke
   `runOne`. Jadi keputusan agen harus menyeberang lewat kanal yang **bukan** nilai balik
   giliran.

3. **Jalur cepat tidak melewati guardrail.** Gerbang Execute (`runner/src/run.ts:65-76`)
   memanggil `deps.verify(worktree)` → `hanoman docs verify --block-if-stale`. Yang dilewati
   jalur cepat adalah **dua giliran claude**, bukan Source of Truth. Ini bekerja karena fase
   Audit sudah menulis dokumen audit + link index-nya: saat Execute mengubah `src/`,
   `freshnessViolation` (`cli/src/verify.ts:32`) melihat perubahan doc di commit yang sama.
   **Dokumen audit itulah doc-of-record untuk perbaikan kecil** — bukan dokumen spec yang
   tidak pernah ditulis. Konsekuensinya: jalur cepat hanya sah bila fase Audit benar-benar
   menulis doc. Audit yang tidak menulis apa pun akan diblokir Stop hook di ujung run.

## Opsi — bagaimana runner tahu keputusannya

**A. Artefak keputusan di worktree — rekomendasi.**
Prompt fase Audit (khusus flow `qa`) diakhiri instruksi: tulis satu berkas JSON di root
worktree, mis. `.hanoman-decision.json`. `runOne` membacanya sesudah Audit `done`, lalu
menghapusnya.

```json
{ "path": "execute", "reason": "satu predikat di App.tsx:303 kehilangan status queued" }
```

`runner/src/run.ts` sudah mengimpor `existsSync` dari `node:fs`, jadi biayanya satu
`readFileSync` + `JSON.parse`. Artefak adalah bukti keras, terbaca ulang, dan `reason`-nya
masuk log run sebagai catatan mengapa Spec dilewati. Berkas hilang atau rusak → `"spec"`
(jalur penuh). Gagal ke arah yang aman.

**B. Sentinel di teks jawaban Audit.** Mis. baris terakhir `KEPUTUSAN: execute`.
Nol berkas, tapi menuntut `takeTurn` mengembalikan teks, dan mencocokkan regex pada keluaran
model yang panjang dan bebas. Lebih buruk: fase Audit **membaca kode dan log**; sebuah baris
berisi sentinel di dalam berkas yang ia kutip bisa ikut tercetak. Keputusan untuk melewati
perencanaan tidak boleh punya jalur injeksi, sekecil apa pun.

**C. Gerbang manusia — pause sesudah Audit.** Dashboard menampilkan dua tombol; mesin resume
sudah ada (ADR-0017: `sessionId` + `donePhases`, `server/src/worker.ts:60-64`). Paling aman,
tapi menolak objective-nya: brief meminta run "**langsung** fix tanpa melakukan spec dan
plans". Gerbang manusia mengubah setiap run QA tanpa penjaga menjadi run yang menggantung.

→ **A.**

### Kenapa bukan field `confidence` terpisah

Brief menyebut confidence. Godaannya adalah `{ "path": "execute", "confidence": 0.9 }` dengan
ambang di runner. Tapi keputusan akhirnya tetap **satu bit**: `path: "execute"` dengan
confidence rendah hanya bisa berarti "jangan execute" — dua knob untuk satu keluaran, dan
ambangnya jadi angka yang tak seorang pun bisa kalibrasi.

Confidence hidup di **instruksi prompt** ("pilih `execute` hanya bila perbaikannya kecil,
terlokalisasi, dan tidak menuntut keputusan desain; saat ragu, pilih `spec`"), dan buktinya
adalah `reason` yang tercatat di log. Satu bit, satu default aman.

## Opsi — apa yang terjadi pada fase yang dilewati

`run.phases` sudah disemai empat baris `pending` saat enqueue (`server/src/queue.ts:16-19`),
jauh sebelum keputusan ada. Jadi Spec dan Plan **akan tetap ada** di baris Run; pertanyaannya
mereka berakhir sebagai apa.

**(i) State baru `"skipped"` — rekomendasi.** `PhaseState` (`runner/src/types.ts:31`) tumbuh
satu anggota. `computeProgress` (`server/src/runner/events-io.ts:20-23`) **harus** mengeluarkan
`skipped` dari penyebut — kalau tidak, run jalur cepat yang sukses berakhir di 50%.

**(ii) Tandai `"done"`.** Nol tipe baru, tapi bohong: `PHASE_DONE_STAGE`
(`events-io.ts:10-16`) memetakan `Plan → planned`, sehingga backlog item akan mengaku punya
plan yang tak pernah ditulis.

**(iii) Buang barisnya dari `run.phases`.** `persistEvent` memetakan fase **di tempat**
(`events-io.ts:56`); tanpa baris, tak ada yang bisa di-update. UI juga kehilangan konteks
"kenapa run ini cuma dua fase".

→ **(i)**, dan ia membayar dirinya sendiri: `"skipped"` sekaligus **menyimpan keputusan itu**.
Worker menyusun `donePhases` dari `run.phases` saat resume (`server/src/worker.ts:62`).
Bila fase `skipped` ikut dihitung di sana, run yang di-resume mengulang keputusan yang sama
tanpa satu pun kolom baru — dan artefak `.hanoman-decision.json` boleh dihapus segera sesudah
dibaca, tanpa mengotori repo project target.

## Bentuk perubahan di `runOne`

Loop fase (`runner/src/run.ts:61`) mendapat satu himpunan `skip`. Sesudah fase Audit `done`,
flow `qa` membaca artefak; bila `path === "execute"`, `Spec` dan `Plan` masuk `skip`, satu
baris log menerangkan alasannya, dan iterasi berikutnya memancarkan `{ state: "skipped" }`
alih-alih membuka giliran claude. Tidak ada fase yang dipindah, tidak ada pipeline kedua.

## Ruang lingkup

**Termasuk:** `PhaseState` + `"skipped"`; penyebut `computeProgress`; pembacaan artefak dan
himpunan `skip` di `runOne`; instruksi keputusan di `phasePrompt` untuk `qa`/`Audit`;
`donePhases` resume ikut menghitung `skipped` (`worker.ts:62`); rendering `skipped` di
`PhasePipeline` (`src/src/screens/RunsScreen.tsx:21-46`, hari ini hanya mengenal empat state)
dan hitungan `doneN` (`:66`); ADR.

**Tidak termasuk:** keputusan per-temuan (satu run = satu keputusan); tombol override manusia
di dashboard; mengubah alur `feature`; memperkenalkan `path: "none"` (lihat pertanyaan
terbuka).

## Perilaku saat artefak hilang atau rusak

Jalur penuh (`spec`). Ini menyimpang dari ADR-0009 ("guardrail crash fails loud") **dengan
sengaja**: yang gagal di sini bukan guardrail, melainkan sebuah optimasi. Kehilangan optimasi
berarti mengerjakan Spec dan Plan yang mungkin tak perlu — mahal, tapi benar. Gagal keras di
sini akan menjatuhkan run QA yang sehat karena sebuah berkas JSON tak tertulis.

## Temuan lintas-potong

- **Progress.** Tanpa memperbaiki penyebut `computeProgress`, setiap run jalur cepat yang
  berhasil melapor 50% dan tampak macet. Ini bagian yang paling mudah terlewat: mekanismenya
  bekerja, dashboardnya berbohong.
- **Stage backlog.** `mirrorStage` maju-saja (`events-io.ts:31`), jadi `objective → executing`
  adalah lompatan yang sah; `spec-ready` dan `planned` tak pernah dilewati. Itu jujur — fase
  itu memang tak dijalankan. Hanya berlaku untuk run QA yang punya `specId` (CLI
  `hanoman qa --spec`); run QA dari `fireTrigger` (`server/src/fire-trigger.ts:41-45`) tidak
  punya spec untuk dicerminkan.
- **Commit kosong (laten, bukan bagian pekerjaan ini).** `commitAndPush` (`runner/src/git.ts:46`)
  menjalankan `git commit -m` tanpa `--allow-empty`; run yang tak mengubah apa pun akan
  melempar. Hari ini tertutup karena fase Audit selalu menulis doc. Setiap usulan
  `path: "none"` menabrak ini lebih dulu.

## Pertanyaan terbuka — perlu jawaban manusia sebelum objective dikunci

1. **`path: "none"`.** Audit tidak menemukan apa pun yang perlu diperbaiki. Mekanismenya
   gratis (satu nilai enum lagi), tapi ia menabrak commit kosong di atas. Masuk sekarang,
   atau backlog item terpisah?
2. **Kill switch.** `Setting` disimpan sebagai JSON (`server/src/services/settings.ts`), jadi
   `qaFastTrack: boolean` tidak menuntut migration. Operator butuh tuas untuk mematikan
   keputusan otonom sesudah satu fix buruk — atau gerbang `verify` sudah cukup?
3. **Temuan campuran.** Satu audit menemukan satu isu sepele dan satu isu kompleks. Satu bit
   memaksa jalur penuh untuk keduanya. Cukup, atau perlu run terpisah per temuan?
4. **ADR.** Ini mengubah **apa itu pipeline** — dari konstanta per-flow menjadi sesuatu yang
   agen persempit sendiri di tengah jalan. Usulan: tulis ADR. Nomor bebas berikutnya **0019**,
   tapi `0018` sudah diklaim **dua kali** di branch berbeda
   (`0018-coverage-nilai-turunan.md`, `0018-branch-adalah-properti-backlog-item.md`).
   Enumerasi lintas branch sebelum mengklaim nomor.
5. **Run satu fase.** `hanoman qa --only Audit` menjalankan Audit sendirian. Tetap tulis
   artefak keputusan (dan buang), atau lewati instruksinya?

## Catatan fase

Fase Brainstorm tidak menyentuh `internal/docs/**`, jadi tidak ada perubahan pada index Source
of Truth (`internal/docs/README.md`). Mengikuti preseden SPEC-143 dan 14 design doc sebelumnya
di folder ini — yang tak satu pun ter-link di index SoT — artefak yang masuk index adalah
`internal/docs/operations/spec-145-*-objective.md`, keluaran fase **Objective**, bukan fase ini.
