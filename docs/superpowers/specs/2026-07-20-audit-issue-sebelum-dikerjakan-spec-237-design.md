# Design — Audit issue sebelum dikerjakan (SPEC-237)

**Tanggal:** 2026-07-20 · **Sumber:** brief · **Prioritas:** tinggi · **ADR:** 0057

## Masalah

Operator kadang butuh backlog item yang **hanya mengaudit** — memastikan sebuah issue
terdefinisi dengan baik, menelusuri log, atau sekadar menjawab pertanyaan — **tanpa** langsung
memperbaiki apa pun. Dua source yang ada tak menyediakannya:

- **`brief` → flow `feature`** (`Brainstorm → Objective → Spec → Plan → Execute`): membangun fitur.
- **`qa` → flow `qa`** (`Audit → Spec → Plan → Execute`): mengaudit **lalu mengeksekusi perbaikan**
  (fast-path ADR-0040 tetap berakhir di Execute).

Keduanya menulis kode. Kutipan brief: *"jika langsung menggunakan Finding QA maka akan langsung
dieksekusi. Dimana kadang itu tidak diperlukan. Kadang saya hanya membutuhkan jawaban saja."*

## Objective (MVP)

Operator dapat membuat backlog item **audit** yang:

1. **Hanya menghasilkan dokumen audit** (Source of Truth), **tanpa perbaikan kode**.
2. Punya **aksi terminal yang sama persis dengan brief/qa**: preview docs, review, merge/rebase,
   fullscreen.
3. Bisa **dipromosikan menjadi Finding QA** bila ternyata perlu diperbaiki — audit tetap jadi
   doc-of-record.

## Temuan investigasi (fakta kode)

- **Aksi terminal Cell di-gate oleh `session.specId` / `spec` / `session.branch` — BUKAN
  `spec.source`** (`src/src/screens/TerminalScreen.tsx` `Cell`, ~baris 456–514). Konsekuensi:
  audit sebagai **Spec biasa** (punya `specId`) otomatis mendapat preview-docs (`file-text`),
  review-spec (`git-compare`), merge/rebase-spec (`git-merge`), dan fullscreen **tanpa perubahan
  gating**. Ini menghindari kelas-dua yang menimpa PRD sebelum SPEC-230/ADR-0054.
- **`source` → `flow` dipetakan di client**, bukan server: `spec.source === "qa" ? "qa" : "feature"`
  di `src/src/App.tsx:83`, `:497`, dan `src/src/screens/TerminalScreen.tsx:83`. Server memakai
  `flow` dari body `POST /terminal/sessions` apa adanya → `PIPELINES[flow]`.
- **`source`/`flow` disimpan sebagai `String` + divalidasi zod** (`shared/src/enums.ts`,
  `shared/src/dto.ts`), **bukan enum Prisma** → menambah nilai **tak butuh migration** (data-model.md).
- **`zCreateSpec.superRefine`** (`shared/src/dto.ts:42`) mengikat `source === "qa"` ⇔ payload
  ber-`severity`. `audit` (non-qa) → payload brief-shaped lolos apa adanya.
- **"Preview docs"** = `GET /specs/:id/docs` → `kindOf` (`server/src/services/spec-docs.ts:15`)
  mengklasifikasi berdasar suffix. `*-audit.md` → kind `audit`. Audit SoT hanoman bernama
  `internal/docs/research/audit-spec-NNN-<slug>.md` (tak berakhiran `-audit.md`) → kini `other`.
- **Stage machine** (`server/src/services/session-phases.ts:53` `REACHED`): `Audit → "objective"`,
  `Execute → "done"`. Tak ada fase yang memetakan flow audit-only ke `done`.

## Pendekatan yang dipertimbangkan

**A. Source+flow `audit` Spec-backed (dipilih).** Audit adalah backlog item nyata (`Spec`,
`source: "audit"`) dengan flow `audit` ber-pipeline pendek yang berhenti di dokumen. Karena
Spec-backed, seluruh aksi terminal & review/integrate warisan gratis. Promosi = buat `Spec` qa
baru (pola "Take ke backlog" PRD).

**B. Flow project-level seperti PRD (ditolak).** PRD tak punya `Spec`; SPEC-230/ADR-0054 harus
membangun jalur review+integrate ber-skop sesi khusus supaya selnya tak polos. Brief SPEC-237
eksplisit "pada backlog ada penambahan audit" & "action-nya sama seperti brief lain" → audit **di
backlog**, bukan project-level. Memilih B berarti membangun ulang mekanisme yang sudah gratis di A.

**C. Reuse flow `qa` + tandai "no-execute" via keputusan agen (ditolak).** Menggantung pada agen
yang memutuskan tak meng-Execute; rapuh, tak terlihat di UI, tak bisa difilter, dan tak memberi
titik masuk "buat sebagai audit". Audit sebagai first-class source jauh lebih jujur.

## Desain (pendekatan A)

### 1. Enum baru (tanpa migration)
- `shared/src/enums.ts` — `zSpecSource = z.enum(["brief","qa","audit"])`.
- `shared/src/dto.ts` — `zFlow = z.enum(["feature","qa","scaffold","reverse","prd","audit"])`.
- `runner/src/types.ts` — `Flow = ... | "audit"`.

### 2. Pipeline audit-only
`runner/src/prompt.ts` — `PIPELINES.audit = ["Audit", "Laporan"]`.
- **Audit** → skill `superpowers:systematic-debugging` (sudah terpeta di `PHASE_SKILLS`):
  telusuri akar masalah / log / jawaban; nilai apakah issue terdefinisi baik.
- **Laporan** → tulis **dokumen audit** ke SoT `internal/docs/research/audit-<spec-id>-<slug>.md`,
  tautkan di `internal/docs/README.md`, commit, push ke `hanoman/<spec-id>`.
- Klausa prompt baru `auditOnlyInstruction(flow)` (hanya `flow === "audit"`, cermin
  `auditDecisionInstruction`): *investigasi SAJA; JANGAN menulis perbaikan kode. Deliverable =
  dokumen audit yang menyatakan temuan, apakah issue terdefinisi baik, dan rekomendasi ("cukup
  jawaban — tak perlu perbaikan" / "perlu dinaikkan jadi Finding QA untuk diperbaiki").*
- `phaseInstruction` tak menambah gate plan (audit tanpa Plan/Execute); `startPrompt` + `AUTONOMY_CLAUSE`
  dipakai apa adanya (audit berjalan otonom, bukan interaktif seperti prd/reverse).

### 3. Stage machine → `done`
`server/src/services/session-phases.ts` — tambah `Laporan: "done"` ke `REACHED`. "Laporan done" →
stage `done`. Audit tak punya plan → `planComplete` `true` → `stageForRun` tetap `done` (bukan
tertahan `executing`). Nama `Laporan` unik lintas semua `PIPELINES` (aman terhadap flow lain).

### 4. Klasifikasi audit doc di "preview docs"
`server/src/services/spec-docs.ts` `kindOf` — tambah cabang agar audit SoT dikenali:
`p.endsWith("-audit.md") || p.includes("/research/audit-")` → `"audit"`. Retroaktif mengoreksi
audit qa-flow lama (kini `other` → `audit`). `listSpecDocs` sudah memfilter berdasar spec-id dalam
nama berkas — `audit-spec-237-<slug>.md` memuat "spec-237" → tampil.

### 5. Parity terminal — gratis
Audit = Spec → sesi punya `specId` → `Cell` merender preview-docs/review/merge/fullscreen tanpa
perubahan gating. Review = diff worktree hidup (dokumen audit muncul). Merge = branch
`hanoman/<spec-id>` (stage `done` memenuhi gerbang `POST /specs/:id/integrate`).

### 6. Pemetaan source→flow (client) — de-duplikasi
Tambah helper `flowForSource(source): Flow` di `@hanoman/shared`
(`brief → feature`, `qa → qa`, `audit → audit`) dan pakai di ketiga situs client
(`App.tsx:83,:497`, `TerminalScreen.tsx:83`). Menghapus ternari ganda + mencegah drift.

### 7. Form buat backlog (`NewSpecModal`, `src/src/App.tsx`)
- Tab source ketiga: `{ value: "audit", label: "Audit", icon: "search" }`.
- Audit memakai **payload brief-shaped** (`zBriefPayload`: context/outcome/constraints/priority)
  dengan label ber-nuansa audit: *"Apa yang diaudit / pertanyaan"* (context), *"Temuan/jawaban
  yang diharapkan"* (outcome), *"Batasan"* (constraints), *"Prioritas"*. Cocok dengan "audit bisa
  menyangkut apapun" — lebih luwes dari langkah-repro qa. `superRefine` tak berubah.
- `createSpec` mem-`POST /specs { source: "audit", payload: brief-shaped }`.

### 8. Label source terpusat (cleanup terarah)
Ganti ~6 ternari inline `source === "qa" ? … : …` (badge/ikon/tab-filter/overview/picker) dengan
peta kecil `SOURCE_META: { brief, qa, audit } → { label, icon, tone }` di frontend. Tab filter
Backlog dapat entri `{ value: "audit", label: "Audit" }`.

### 9. Promosi "naik jadi Finding QA"
Tombol **"Jadikan Finding QA"** pada `SpecDetail` backlog untuk item audit (dan/atau di preview
dokumen audit). Membuka `NewSpecModal` source `qa`, prefill: `title` dari audit + backlink
*"Dari audit SPEC-237: internal/docs/research/audit-…md"* pada field qa `steps`. Reuse `POST /specs`
(source qa) — tanpa endpoint baru. Cermin "Take ke backlog" PRD (ADR-0041). Spec qa baru menjalankan
flow qa penuh (audit → spec → plan → execute) → perbaikan dieksekusi. Audit asli tetap doc-of-record.

### 10. Docs (Source of Truth) diperbarui dalam commit yang sama
- **ADR-0057** — audit sebagai source+flow audit-only (link ADR-0040/0041/0054/0021 terkait).
- `architecture/api-contract.md` — `POST /specs` source `audit`; flow set + `/specs/:id/docs`
  klasifikasi audit.
- `architecture/data-model.md` — `Spec.source` enum + flow set + catatan dokumen audit.
- `operations/agent-documentation-workflow.md` — tambah alur **Audit-only:** audit → dokumen (stop).
- `internal/docs/README.md` — tautkan ADR-0057.
- `internal/skills/hanoman/SKILL.md` — sebut flow `audit` di aturan sesi.

## Data flow
```
buat audit  → POST /specs {source:"audit", payload:brief}         → Spec(stage brainstorming)
Start       → client flowForSource("audit")="audit"
            → POST /terminal/sessions {spec, flow:"audit"}         → PIPELINES.audit
sesi        → Audit (systematic-debugging) → Laporan (tulis doc)   → phase-file "Laporan done"
close sesi  → readPhases(audit) + stageForRun → REACHED.Laporan    → Spec.stage = "done"
terminal    → Cell(specId) → preview-docs / review / merge         → (gratis, Spec-backed)
promosi     → "Jadikan Finding QA" → NewSpecModal(qa) prefill       → POST /specs {source:"qa"}
```

## Batas (ceiling)
- Audit-only **tak** menulis kode; bila operator butuh perbaikan, ia mempromosikan ke QA (langkah
  manual sekali klik). Tak ada auto-split audit → banyak finding.
- Dokumen audit adalah SoT permanen (`internal/docs/research/`), berbeda dari ceiling PRD yang
  hilang saat sesi ditutup — audit di-commit & di-push per konvensi SoT, review/merge dari branch
  `hanoman/<spec-id>` tetap jalan setelah sesi ditutup (pola done-spec, `baseSha/headSha` tersimpan).

## Testing
- **shared**: `zSpecSource` memuat `audit`; `zCreateSpec` audit+brief lolos, audit+qa-payload gagal;
  `flowForSource` memetakan tiga source.
- **runner**: `PIPELINES.audit = ["Audit","Laporan"]`; `startPrompt("audit", …)` memuat klausa
  audit-only, tanpa fase Plan/Execute, urutan fase benar.
- **server**: `stageFor` "Laporan done" → `done`; `kindOf("…/research/audit-spec-237-x.md")` = audit;
  `POST /specs {source:"audit"}` 201; `deriveSpecFields` audit → cabang brief.
- **frontend**: backlog board — badge/label/filter audit; create-modal tab audit; promosi membuka
  modal qa ter-prefill.
- **Live**: boot server, `POST /specs` source audit, `POST /terminal/sessions {flow:"audit"}` (atau
  verifikasi prompt tanpa spawn claude sungguhan), `GET /specs/:id/docs`, `GET /specs/:id/review`.

## Berkas tersentuh (rencana)
- shared: `enums.ts`, `dto.ts` (zFlow + `flowForSource`), test.
- runner: `types.ts`, `prompt.ts`, test.
- server: `services/session-phases.ts`, `services/spec-docs.ts`, `routes/specs.ts`
  (`deriveSpecFields`/author audit), test.
- frontend: `App.tsx` (NewSpecModal + source→flow + promosi), `screens/TerminalScreen.tsx`,
  `screens/BacklogScreen.tsx` (SOURCE_META + filter + "Jadikan Finding QA"),
  `screens/OverviewScreen.tsx`, `screens/SpecDocsModal.tsx` (opsional tombol promosi), test.
- docs: `adr/0057-…md`, `architecture/api-contract.md`, `architecture/data-model.md`,
  `operations/agent-documentation-workflow.md`, `README.md`, `internal/skills/hanoman/SKILL.md`.
