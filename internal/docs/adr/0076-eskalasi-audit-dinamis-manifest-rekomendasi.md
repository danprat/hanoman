# ADR-0076 — Eskalasi audit dinamis: manifest rekomendasi di dokumen audit + tiga pintu (QA · brief · PRD)

**Status:** accepted · **Tanggal:** 2026-07-27 · **Spec:** SPEC-340
**Terkait:** [ADR-0057](0057-audit-only-source-flow.md) (**memperluas** — audit-only kini punya tiga
tindak lanjut, bukan satu), **ADR-0075** (dicabut, [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md))
(cross-audit ikut), [ADR-0069](0069-breakdown-prd-ke-backlog-paralel.md) (**pola manifest
prosa + blok json kanonik**), [ADR-0059](0059-kontinuitas-branch-take-to-backlog-dan-skip-audit.md)
(kontinuitas branch take-to-backlog), [ADR-0041](0041-prd-sebagai-dokumen-flow-project-level.md)
(PRD sebagai dokumen project-level), [ADR-0018](0018-coverage-nilai-turunan.md) (nilai turunan saat
dibaca), [ADR-0011](0011-docs-realtime-filesystem.md) (docs = filesystem nyata)

## Konteks

Audit-only (ADR-0057) berakhir di dokumen, lalu punya **tepat satu** tindak lanjut: tombol
"Jadikan Finding QA" di `SpecDetail` → `NewSpecModal` source `qa` ter-prefill. Itu benar untuk temuan
berupa bug, tapi hasil audit tidak selalu bug:

- temuan bisa berupa **kebutuhan produk yang belum terdefinisi** — bentuknya PRD (ADR-0041),
  bukan backlog perbaikan;
- temuan bisa berupa **fitur kecil yang sudah jelas bentuknya** — bentuknya feature brief;
- temuan bisa memang **bug/regresi** — Finding QA;
- atau audit memang **cukup menjawab pertanyaan** — tak perlu eskalasi.

Memaksa semuanya lewat `qa` berarti pipeline `Audit → Spec → Plan → Execute` dipakai untuk pekerjaan
yang bentuknya bukan perbaikan.

Masalah kedua lebih halus. Prompt audit **sudah** menyuruh agen menulis "REKOMENDASI — cukup jawaban
ATAU naikkan jadi Finding QA" (ADR-0057 §2), tapi rekomendasi itu **hanya prosa**. Server dan UI tak
bisa membacanya, jadi hanoman tak pernah benar-benar *merekomendasikan* apa pun: manusia harus buka
dokumen, baca, simpulkan sendiri, lalu tekan tombol yang ada. Rekomendasi yang tak terbaca mesin
sama saja dengan tak ada rekomendasi.

`source: "cross-audit"` (ADR-0075) mewarisi kedua masalah itu utuh — pipeline dan deliverable-nya
identik audit-only, dan prompt-nya pun hanya menyebut "naikkan jadi Finding QA".

## Keputusan

### 1. Rekomendasi hidup di dokumen audit sebagai blok `json` kanonik

Fase **Laporan** kini mewajibkan **tepat satu** blok ```json di dokumen audit SoT
(`internal/docs/research/audit-<spec-id>-<slug>.md`):

```json
{ "escalation": { "target": "none|qa|brief|prd", "reason": "…", "alternatives": ["…"],
  "prefill": { "title": "…", "context": "…", "outcome": "…", "constraints": "…",
               "severity": "…", "steps": "…" } } }
```

Ini **pola ADR-0069** apa adanya (manifest breakdown: prosa human-readable + satu blok json kanonik
yang di-parse server), dipinjam ke dokumen audit. Kriteria pemilihan target ikut masuk prompt:
bug/regresi → `qa`; kebutuhan kecil & jelas bentuknya → `brief`; kebutuhan produk besar/ambigu/lintas
modul → `prd`; pertanyaan sudah terjawab → `none`.

**Tanpa kolom DB.** Rekomendasi adalah **nilai turunan** dari dokumen (ADR-0018/0011), dibaca saat
request — bukan state yang disimpan lalu bisa basi. `Spec.escalation` ditolak justru karena itu.

### 2. Parser defensif + endpoint turunan

`server/src/services/audit-escalation.ts` memakai ulang `listSpecDocs(specId)` untuk menemukan
dokumen ber-`kind: "audit"` (**freshest-wins**: cwd sesi hidup > `resolveRepoDir`, SPEC-170),
membacanya, lalu `parseEscalation(md)` — blok ```json pertama, `JSON.parse`, zod. Defensif seperti
`parseBreakdown`: tanpa blok / json rusak / `target` tak dikenal → `null`, **bukan** gagal keras;
manifest ditulis agen, jadi kontraknya harus toleran.

`GET /api/specs/:id/escalation` → `{ escalation, docPath, live }`. Dokumen atau blok tak ada →
**200 + `escalation: null`**: "belum ada rekomendasi" adalah keadaan normal (audit pra-SPEC-340, atau
sesi yang masih berjalan), bukan error.

### 3. Tiga pintu eskalasi, rekomendasi disorot — bukan dipaksakan

`SpecDetail` untuk `source ∈ {audit, cross-audit}` menampilkan **tiga** tombol: Finding QA · Feature
brief · PRD. Target rekomendasi jadi tombol *primary* + badge "direkomendasikan hanoman" + alasannya;
`alternatives` jadi *secondary*; sisanya tetap tampil sebagai *ghost*. `target: "none"` merender
catatan "cukup jawaban" dengan ketiga tombol tetap tersedia.

**Manusia terakhir yang memutuskan** (aturan produk): tak ada auto-eskalasi. Rekomendasi mengurangi
beban baca, bukan mengambil alih keputusan. Audit asli selalu tetap ada sebagai doc-of-record.

### 4. Kontinuitas dokumen audit ke sesi turunan

- **Feature brief** — cermin jalur qa (ADR-0059): `branchFrom: hanoman/<audit-id>` + payload
  `fromAudit`. `auditContinuationInstruction` melebar ke `flow: "feature"` dengan kalimat berbeda:
  dokumen audit = **bahan Brainstorm & Objective**, jangan investigasi ulang. Fase **tidak**
  di-`skipped` — beda sadar dari qa: dokumen audit memuat temuan, bukan bentuk solusi, jadi brainstorm
  fitur tetap punya nilai. Yang dihemat adalah investigasi ulang, bukan perancangan.
- **PRD** — dua mekanisme sekaligus, sengaja:
  1. varian `flow: "prd"` di `zTerminalSession` menerima `branchFrom?` → worktree lahir dari branch
     audit (`resolveCommit` sudah punya fallback `origin/<rev>`, SPEC-244), sehingga jejak git PRD
     bersambung dengan auditnya;
  2. `fromAudit?` → server menyematkan **isi** dokumen audit ke `startPrdPrompt` sebagai blok
     `=== DOKUMEN AUDIT <id> ===` (cermin `startBreakdownPrompt` yang menyematkan isi PRD), sehingga
     prompt self-contained dan tak bergantung agen menebak nama berkas.

  Tanpa kedua field itu, jalur PRD berperilaku persis seperti sebelumnya (worktree dari `HEAD`,
  prompt polos).

## Konsekuensi

- **Tanpa perubahan skema, tanpa migration.** State baru hidup di dokumen SoT dan `Spec.payload`
  (`Json`) yang sudah ada. Additive, aman untuk VPS live.
- Audit menjadi **hulu yang sah bagi PRD**, bukan hanya bagi perbaikan — melengkapi ADR-0041 dari
  sisi masuknya (brief manusia → PRD, kini juga audit → PRD).
- Jalur "Jadikan Finding QA" lama tetap ada dan tak berubah bentuk; ia sekarang salah satu dari tiga.
- `cross-audit` memperoleh ketiga pintu yang sama — drift prompt "hanya Finding QA" ditutup.
- Kualitas rekomendasi bergantung pada agen; gerbang review manusia (tombol, bukan otomatis)
  menutupinya, sama seperti manifest breakdown (ADR-0069).
- Audit yang selesai sebelum SPEC-340 tak punya blok json → UI jatuh ke mode netral (tiga tombol
  tanpa sorotan). Tak ada migrasi dokumen retroaktif.

## Alternatif yang ditolak

- **Kolom `Spec.escalation` (Json) diisi agen lewat endpoint.** Menjadikan rekomendasi state DB yang
  bisa basi terhadap dokumennya, butuh migration + ADR skema, dan menyimpang dari ADR-0018/0011.
  Ditolak.
- **Rekomendasi prosa saja + tiga tombol manual.** Paling murah, tapi tak memenuhi objective SPEC-340:
  hanoman tetap tak merekomendasikan apa pun yang terlihat di UI. Ditolak.
- **Sesi klasifikasi terpisah** yang membaca dokumen audit lalu memutuskan target. Satu sesi tambahan
  untuk keputusan yang sudah dipegang sesi audit — ia baru saja menyelidikinya. Boros. Ditolak.
- **Eskalasi PRD sebagai `Spec` ber-source `prd`.** PRD bukan entitas backlog (ADR-0041); memaksanya
  jadi Spec berarti menggandakan jalur PRD yang sudah ada. Ditolak.
- **Auto-eskalasi saat rekomendasi terbaca.** Melanggar aturan produk "manusia terakhir yang
  memutuskan". Ditolak.
- **Menandai `Brainstorm skipped` pada brief lanjutan audit** (cermin `Audit skipped` di qa).
  Dokumen audit memuat temuan, bukan bentuk solusi — melewati Brainstorm akan melompati perancangan
  fitur, bukan menghemat pengulangan. Ditolak.

## Acceptance (EARS)

- **AC-1** — WHEN sesi audit (`flow` `audit` atau `cross-audit`) menulis dokumen laporan, THE prompt
  SHALL mewajibkan tepat satu blok ```json berisi `escalation.target` ∈ `none|qa|brief|prd` beserta
  `reason` dan `prefill`.
- **AC-2** — WHEN dokumen audit sebuah spec memuat blok escalation yang sah, THE
  `GET /api/specs/:id/escalation` SHALL mengembalikan `{ escalation, docPath, live }` dengan target
  sesuai isi dokumen.
- **AC-3** — WHEN dokumen audit tak ada, tak memuat blok json, atau json-nya rusak/tak sah, THE
  endpoint SHALL membalas 200 dengan `escalation: null`.
- **AC-4** — WHILE sesi audit untuk spec itu masih hidup, THE endpoint SHALL membaca dokumen dari cwd
  sesi tersebut (`live: true`), bukan dari `repoDir`.
- **AC-5** — WHEN operator membuka detail backlog ber-source `audit` atau `cross-audit`, THE UI SHALL
  menampilkan tiga tombol eskalasi dan SHALL menyorot target rekomendasi beserta alasannya bila
  rekomendasi terbaca.
- **AC-6** — WHEN operator memilih "Jadikan Feature brief", THE UI SHALL membuka create-spec kind
  `brief` ter-prefill dengan `branchFrom` = `hanoman/<audit-id>` dan payload memuat `fromAudit`;
  audit asli SHALL tetap ada sebagai doc-of-record.
- **AC-7** — WHEN backlog `brief` memuat `payload.fromAudit`, THE prompt sesi SHALL menyuruh membaca
  dokumen audit itu sebagai bahan Brainstorm/Objective tanpa menandai fase mana pun `skipped`.
- **AC-8** — WHEN operator memilih "Jadikan PRD", THE client SHALL mengirim
  `POST /terminal/sessions {flow:"prd", brief, branchFrom, fromAudit}` dan THE server SHALL membuat
  worktree dari `branchFrom` serta menyematkan isi dokumen audit ke prompt PRD.
- **AC-9** — WHEN `flow:"prd"` dikirim tanpa `branchFrom`/`fromAudit`, THE server SHALL berperilaku
  persis seperti sebelumnya (worktree dari `HEAD`, prompt tanpa blok audit).
- **AC-10** — THE fitur ini SHALL tidak mengubah skema Prisma dan tidak menambah migration.
