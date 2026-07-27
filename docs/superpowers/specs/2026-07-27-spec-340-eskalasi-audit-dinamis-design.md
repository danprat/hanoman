# SPEC-340 — Eskalasi audit dinamis: QA · Feature brief · PRD, dengan rekomendasi hanoman

**Tanggal:** 2026-07-27 · **Sumber:** brief · **Prioritas:** tinggi
**ADR:** 0076 (baru) — memperluas ADR-0057 (audit-only), ADR-0059 (kontinuitas branch take-to-backlog),
ADR-0041 (PRD sebagai dokumen), ADR-0069 (manifest berblok-json), ADR-0018 (nilai turunan saat dibaca)

## Masalah

Audit (`source: "audit"`, flow `Audit → Laporan`, ADR-0057) berhenti di satu tindak lanjut:
tombol **"Jadikan Finding QA"** di `SpecDetail`. Padahal hasil audit tidak selalu berupa bug:

- kadang temuannya **kebutuhan produk baru yang belum terdefinisi** → tempatnya **PRD**;
- kadang temuannya **fitur kecil yang jelas bentuknya** → tempatnya **feature brief**;
- kadang memang **bug** → Finding QA (yang sudah ada);
- kadang **cukup jawaban** — tak perlu eskalasi sama sekali.

Memaksa semuanya lewat Finding QA berarti flow `qa` (Audit → Spec → Plan → Execute) dipakai untuk
pekerjaan yang bentuknya bukan perbaikan. Selain itu prompt audit **sudah** menyuruh agen menulis
rekomendasi, tapi rekomendasi itu **hanya prosa** — server dan UI tak bisa membacanya, jadi hanoman
tak pernah benar-benar *merekomendasikan* apa pun; manusia harus membuka dokumen dan menyimpulkan
sendiri.

Hal yang sama berlaku untuk `source: "cross-audit"` (SPEC-337/ADR-0075): pipeline dan
deliverable-nya identik audit-only, dan prompt-nya pun hanya menyebut "naikkan jadi Finding QA".

## Objective

Audit (dan audit lintas project) dapat dieskalasi ke **Finding QA**, **Feature brief**, atau **PRD**
— menyesuaikan bentuk temuannya — dan **hanoman merekomendasikan** target mana yang cocok, terbaca
mesin sehingga UI bisa menyorotnya dan mem-prefill langkah berikutnya. Manusia tetap yang memutuskan
akhir: rekomendasi disorot, bukan dipaksakan.

## Keputusan desain

### 1. Rekomendasi = blok `json` kanonik di dokumen audit

Sesi audit menulis **tepat satu** blok ```json di dokumen audit SoT
(`internal/docs/research/audit-<spec-id>-<slug>.md`), di bagian "Rekomendasi eskalasi":

```json
{
  "escalation": {
    "target": "prd",
    "reason": "Temuan ini kebutuhan produk baru lintas modul, belum terdefinisi.",
    "alternatives": ["brief"],
    "prefill": {
      "title": "Kuota per tenant",
      "context": "…",
      "outcome": "…",
      "constraints": "",
      "severity": "major",
      "steps": ""
    }
  }
}
```

- `target` ∈ `none | qa | brief | prd`. `none` = "cukup jawaban, tak perlu perbaikan".
- `alternatives` = target lain yang masuk akal (boleh kosong).
- `prefill` = bahan isian form target; field qa (`severity`, `steps`) opsional, field brief/PRD
  (`context`, `outcome`, `constraints`) opsional. Semua ber-default string kosong.

Ini pola yang sudah terbukti di hanoman: manifest breakdown (ADR-0069) memakai bentuk identik —
prosa human-readable + satu blok json kanonik yang di-parse server. **Tak ada kolom DB baru**;
rekomendasi adalah **nilai turunan** dari dokumen SoT, sejalan ADR-0018/0011.

Prompt yang berubah:
- `auditOnlyInstruction(flow)` (`runner/src/prompt.ts`) — flow `audit`;
- `startCrossAuditPrompt` cabang berdokumen — flow `cross-audit`.

Keduanya kini menyebut ketiga target beserta kriteria pemilihannya (bug/regresi → `qa`; kebutuhan
kecil & jelas bentuknya → `brief`; kebutuhan produk besar/ambigu/lintas modul → `prd`; pertanyaan
terjawab → `none`) dan mewajibkan blok json di atas.

### 2. Parser + endpoint turunan

`server/src/services/audit-escalation.ts`:

- `parseEscalation(md): AuditEscalation | null` — ambil blok ```json **pertama**, `JSON.parse`,
  validasi zod. Defensif seperti `parseBreakdown`: tanpa blok / json rusak / `target` tak dikenal →
  `null` (bukan gagal keras — manifest ditulis agen).
- `readEscalation(specId, sessions?)` — memakai ulang `listSpecDocs(specId)` untuk menemukan
  dokumen ber-`kind: "audit"` (**freshest-wins**: cwd sesi hidup > `resolveRepoDir`), membacanya
  dengan `readDocFile`, lalu `parseEscalation`. Balik `{ escalation, docPath, live }`.

Endpoint baru: **`GET /api/specs/:id/escalation`** → `{ escalation, docPath, live }`.
Spec tak ada → 404 (cermin route spec lain). Dokumen/blok tak ada → `{ escalation: null, docPath,
live }` — 200, bukan error: "belum ada rekomendasi" adalah keadaan normal (audit lama pra-SPEC-340,
atau sesi audit yang masih berjalan). Domain capability agent token: `specs` (sudah ada).

### 3. Tiga pintu eskalasi di UI

`SpecDetail` (`src/src/screens/BacklogScreen.tsx`) untuk `spec.source ∈ {audit, cross-audit}`:

- memuat `GET /specs/:id/escalation` saat detail dibuka;
- blok **"Tindak lanjut"**:
  - target rekomendasi → tombol **primary** + `Badge` "direkomendasikan hanoman" + teks `reason`;
  - target di `alternatives` → tombol **secondary**;
  - target sisanya → tombol **ghost** (tetap tersedia — manusia terakhir memutuskan);
  - `target: "none"` → catatan "audit menilai cukup jawaban — tak perlu perbaikan", ketiga tombol
    tetap tampil sebagai ghost;
  - rekomendasi tak terbaca → ketiga tombol tampil netral (perilaku hari ini + dua tombol baru).

Tiga aksi:

| Tombol | Aksi |
|---|---|
| Jadikan Finding QA | `NewSpecModal` kind `qa` (jalur ADR-0059 yang sudah ada), prefill diperkaya dari manifest |
| Jadikan Feature brief | `NewSpecModal` kind `brief` + `branchFrom: hanoman/<audit-id>` + payload `fromAudit` |
| Jadikan PRD | `PrdBriefModal` ter-prefill → `POST /terminal/sessions {flow:"prd", brief, branchFrom, fromAudit}` |

`cross-audit` memakai tombol yang sama (hari ini tombol promosi hanya muncul untuk `audit`).

### 4. Kontinuitas dokumen audit ke sesi turunan

**Feature brief.** `auditContinuationInstruction(flow, spec)` (`runner/src/prompt.ts`) hari ini hanya
menyala untuk `flow === "qa"`. Dilebarkan ke `flow === "feature"` dengan kalimat berbeda: dokumen
audit sudah ada di worktree (lahir dari branch audit) → **baca sebagai bahan Brainstorm & Objective,
jangan investigasi ulang dari nol**. Fase **tidak** di-skip — berbeda dari qa: brainstorm fitur tetap
punya nilai (bentuk solusi belum ada di dokumen audit), yang dihemat adalah investigasi ulang.

**PRD.** Dua-duanya, sesuai keputusan brainstorm:

1. **Worktree lahir dari branch audit.** Varian `flow: "prd"` di `zTerminalSession` menerima
   `branchFrom?` dan `fromAudit?` opsional. Route `POST /terminal/sessions` memanggil
   `realGit.addWorktree(repoDir, path, branchFrom ?? "HEAD")` — `resolveCommit` sudah punya fallback
   `origin/<rev>` (SPEC-244), jadi branch audit yang hidup hanya di origin tetap resolve. Tanpa
   `branchFrom` perilaku lama (`HEAD`) utuh.
2. **Isi dokumen audit disematkan ke prompt.** Bila `fromAudit` ada, server membaca dokumen audit
   (freshest-wins, lewat `readEscalation`/`listSpecDocs`) dan meneruskannya ke
   `startPrdPrompt(project, brief, branchTo, audit?)` sebagai blok `=== DOKUMEN AUDIT <id> ===`.
   Cermin `startBreakdownPrompt` yang menyematkan isi PRD. Sesi PRD karenanya tetap bekerja meski
   branch audit belum di-merge, dan agen tak perlu menebak nama berkas.

Keduanya sengaja dipakai bersama: `branchFrom` menjaga jejak git (review/merge dari basis yang sama),
penyematan menjaga prompt tetap self-contained.

### 5. Tanpa perubahan skema

Semua state baru hidup di (a) dokumen SoT dan (b) `Spec.payload` (`Json`) yang sudah ada
(`fromAudit`). Additive, aman untuk VPS live. **Tanpa migration.**

## Komponen & batasnya

| Unit | Tanggung jawab | Bergantung pada |
|---|---|---|
| `shared/src/dto.ts` — `zAuditEscalation` dkk | Kontrak rekomendasi (satu definisi, dipakai server+client+parser) | zod |
| `server/src/services/audit-escalation.ts` | Menemukan dokumen audit + mem-parse blok json; murni & defensif | `spec-docs`, `scan` |
| `GET /api/specs/:id/escalation` | Menyajikan rekomendasi sebagai nilai turunan | service di atas |
| `runner/src/prompt.ts` | Menyuruh agen menulis blok json; kontinuitas brief; PRD ber-audit | — (murni) |
| `POST /terminal/sessions` (`flow:"prd"`) | `branchFrom` + penyematan dokumen audit | `git`, `audit-escalation` |
| `SpecDetail` + `App` | Tiga pintu eskalasi + sorotan rekomendasi | endpoint di atas |

`parseEscalation` dan seluruh perubahan `prompt.ts` adalah fungsi **murni** → diuji tanpa DB/server.

## Acceptance criteria (EARS)

- **AC-1** — WHEN sesi audit (`flow` `audit` atau `cross-audit`) menulis dokumen laporan, THE prompt
  SHALL mewajibkan tepat satu blok ```json berisi `escalation.target` ∈ `none|qa|brief|prd` beserta
  `reason` dan `prefill`.
- **AC-2** — WHEN dokumen audit sebuah spec memuat blok escalation yang sah, THE
  `GET /api/specs/:id/escalation` SHALL mengembalikan `{ escalation, docPath, live }` dengan
  `escalation.target` sesuai isi dokumen.
- **AC-3** — WHEN dokumen audit tak ada, tak memuat blok json, atau json-nya rusak/tak sah, THE
  endpoint SHALL membalas **200** dengan `escalation: null` (bukan 4xx/5xx).
- **AC-4** — WHILE sebuah sesi audit untuk spec itu masih hidup, THE endpoint SHALL membaca dokumen
  dari cwd sesi tersebut (`live: true`), bukan dari `repoDir`.
- **AC-5** — WHEN operator membuka detail backlog ber-source `audit` atau `cross-audit`, THE UI SHALL
  menampilkan tiga tombol eskalasi (Finding QA · Feature brief · PRD) dan SHALL menyorot target
  rekomendasi beserta alasannya bila rekomendasi terbaca.
- **AC-6** — WHEN operator memilih "Jadikan Feature brief", THE UI SHALL membuka create-spec kind
  `brief` ter-prefill dari audit dengan `branchFrom` = `hanoman/<audit-id>` dan payload memuat
  `fromAudit`, dan audit asli SHALL tetap ada sebagai doc-of-record.
- **AC-7** — WHEN sebuah backlog `brief` memuat `payload.fromAudit`, THE prompt sesi SHALL
  menginstruksikan membaca dokumen audit itu sebagai bahan Brainstorm/Objective dan tidak mengulang
  investigasi, TANPA menandai fase mana pun `skipped`.
- **AC-8** — WHEN operator memilih "Jadikan PRD", THE client SHALL mengirim
  `POST /terminal/sessions {flow:"prd", brief, branchFrom, fromAudit}` dan THE server SHALL membuat
  worktree dari `branchFrom` serta menyematkan isi dokumen audit ke prompt PRD.
- **AC-9** — WHEN `flow:"prd"` dikirim **tanpa** `branchFrom`/`fromAudit`, THE server SHALL
  berperilaku persis seperti sebelumnya (worktree dari `HEAD`, prompt tanpa blok audit).
- **AC-10** — THE fitur ini SHALL tidak mengubah skema Prisma dan tidak menambah migration.

## Rencana pengujian

**Unit (murni, tanpa DB):**
- `parseEscalation` — blok sah; tanpa blok; json rusak; `target` asing; `prefill` parsial;
  blok json kedua diabaikan.
- `auditOnlyInstruction` / `startCrossAuditPrompt` memuat kontrak json + ketiga target.
- `auditContinuationInstruction` — `feature` + `fromAudit` menghasilkan klausa tanpa kata `skipped`;
  `qa` + `fromAudit` tetap seperti hari ini; tanpa `fromAudit` → kosong.
- `startPrdPrompt` dengan/ tanpa blok audit.

**Server (route, DB test):**
- `GET /specs/:id/escalation` — 404 spec tak ada; 200 `escalation: null`; 200 dengan rekomendasi;
  freshest-wins dari cwd sesi hidup.
- `POST /terminal/sessions` `flow:"prd"` — `branchFrom` diteruskan ke `addWorktree`; `fromAudit`
  menyematkan isi dokumen; tanpa keduanya → `HEAD` & prompt polos.

**Frontend (RTL):**
- `SpecDetail` source `audit` merender tiga tombol; menyorot target rekomendasi + reason;
  `target:"none"` merender catatan "cukup jawaban"; `cross-audit` memperoleh tombol yang sama;
  source `brief` tetap tanpa tombol eskalasi.

**Smoke nyata (wajib, CLAUDE.md):** boot server di DB khusus + curl
`GET /api/specs/:id/escalation` (dengan dokumen audit ditanam di repoDir) dan
`POST /api/terminal/sessions {flow:"prd", branchFrom, fromAudit}`.

## Alternatif yang ditolak

- **Kolom `Spec.escalation` (Json) diisi agen lewat endpoint.** Menjadikan rekomendasi state DB,
  butuh migration + ADR skema, dan menyimpang dari ADR-0018/0011 (docs = SoT, nilai turunan dibaca
  saat request). Ditolak.
- **Rekomendasi prosa saja + tiga tombol manual.** Paling murah, tapi tak memenuhi objective:
  hanoman tak benar-benar merekomendasikan apa pun yang terlihat di UI. Ditolak.
- **Sesi klasifikasi terpisah** yang membaca dokumen audit lalu memutuskan target. Satu sesi tambahan
  untuk keputusan yang sudah dipegang sesi audit (ia baru saja menyelidikinya). Boros. Ditolak.
- **Eskalasi PRD sebagai `Spec` baru ber-source `prd`.** PRD bukan entitas backlog (ADR-0041);
  memaksanya jadi Spec akan menggandakan jalur PRD yang sudah ada. Ditolak.
- **Auto-eskalasi tanpa konfirmasi manusia** saat rekomendasi terbaca. Melanggar aturan produk
  "manusia terakhir yang memutuskan". Ditolak.

## Batas yang diketahui

- Kualitas rekomendasi bergantung pada agen; gerbang review manusia (tombol, bukan otomatis)
  menutupinya — sama seperti manifest breakdown (ADR-0069).
- Audit yang selesai **sebelum** SPEC-340 tak punya blok json → UI jatuh ke mode netral (tiga tombol
  tanpa sorotan). Tidak ada migrasi dokumen retroaktif; audit bisa dijalankan ulang bila perlu.
- `branchFrom` untuk sesi PRD memakai `resolveCommit` yang sama dengan spec: bila branch audit belum
  ada di lokal **maupun** origin, pembuatan worktree gagal 422 dengan pesan git apa adanya (ADR-0009).
