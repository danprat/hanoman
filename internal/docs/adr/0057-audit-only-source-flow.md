# ADR-0057 — Audit-only sebagai source + flow (dokumen, tanpa perbaikan)

**Status:** accepted · **Tanggal:** 2026-07-20 · **Spec:** SPEC-237
**Terkait:** [ADR-0040](0040-jalur-cepat-qa-dielicit-prompt.md) (jalur cepat qa dielicit prompt),
[ADR-0041](0041-prd-sebagai-dokumen-flow-project-level.md) (PRD dokumen + take-to-backlog),
[ADR-0054](0054-review-integrate-ber-skop-sesi-untuk-prd.md) (review+integrate ber-skop sesi),
[ADR-0029](0029-execute-done-butuh-plan-terceklist.md) (Execute butuh plan terceklist),
[ADR-0021](0021-nomor-spec-diklaim-docs-bukan-hanya-database.md) (nomor diklaim lintas branch)

> **Dibatasi [ADR-0083](0083-retensi-dokumen-audit.md)** (SPEC-386): dokumen audit yang dihasilkan flow
> ini **berumur** — ia boleh dihapus setelah eskalasinya diputuskan dan spec turunannya tuntas, asalkan
> temuannya sudah meninggalkan jejak permanen dan rujukan masuknya ikut dibereskan. Flow, pipeline,
> deliverable, dan jalur promosi ke Finding QA di bawah ini **tak berubah**.

## Konteks

Dua source backlog yang ada keduanya berakhir menulis kode:

- **`brief` → flow `feature`** (`Brainstorm → Objective → Spec → Plan → Execute`) membangun fitur.
- **`qa` → flow `qa`** (`Audit → Spec → Plan → Execute`) mengaudit **lalu mengeksekusi perbaikan**
  (fast-path ADR-0040 tetap berujung di Execute).

Operator kadang butuh backlog yang **hanya mengaudit** — memastikan sebuah issue terdefinisi
dengan baik, menelusuri log, atau sekadar menjawab pertanyaan — **tanpa** perbaikan. Kutipan
brief SPEC-237: *"jika langsung menggunakan Finding QA maka akan langsung dieksekusi. Dimana kadang
itu tidak diperlukan. Kadang saya hanya membutuhkan jawaban saja."* Selain itu selnya di Terminal
harus punya aksi yang **sama seperti brief/qa** (preview docs, review, merge/rebase, fullscreen) —
bukan kelas-dua seperti PRD sebelum ADR-0054.

## Keputusan

Tambahkan **source `audit`** dan **flow `audit`** audit-only. Audit adalah **backlog item nyata**
(`Spec`, `source: "audit"`) — bukan flow project-level seperti PRD.

1. **Enum melebar, tanpa migration.** `source`/`flow` disimpan `String` + divalidasi zod
   (`@hanoman/shared`), bukan enum Prisma — konsisten data-model. `zSpecSource` kini
   `brief|qa|audit`; `zFlow` kini `feature|qa|scaffold|reverse|prd|audit`. Helper tunggal
   `flowForSource(source)` (`shared/src/dto.ts`) memetakan source → flow; dipakai kedua situs
   start-sesi client (menggantikan ternari `source === "qa" ? "qa" : "feature"` tersebar).

2. **Pipeline pendek yang berhenti di dokumen.** `PIPELINES.audit = ["Audit", "Laporan"]`
   (`runner/src/prompt.ts`). Fase **Audit** → skill `systematic-debugging`; fase **Laporan** →
   tulis **dokumen audit** ke SoT `internal/docs/research/audit-<spec-id>-<slug>.md`, tautkan di
   index, commit, push. Klausa prompt `auditOnlyInstruction(flow)` (hanya `flow === "audit"`)
   menegaskan: **investigasi saja, JANGAN menulis perbaikan kode**; deliverable = dokumen audit
   yang menyatakan temuan, apakah issue terdefinisi baik, dan **rekomendasi** ("cukup jawaban" atau
   "naikkan jadi Finding QA").

3. **Stage terminal `done` lewat fase `Laporan`.** `REACHED.Laporan = "done"`
   (`server/src/services/session-phases.ts`). Audit tak punya Plan/Execute → `planComplete` `true`
   → `stageForRun` tak menahan di `executing` (gerbang ADR-0029 tak berlaku, tak ada plan). Nama
   `Laporan` unik lintas semua `PIPELINES`, jadi peta stage global aman.

4. **Parity terminal gratis.** Aksi Cell (preview docs/review/merge/fullscreen) digerbangi
   `session.specId`/`spec`/`branch` — **bukan `spec.source`** (audit SPEC-230). Audit = Spec →
   sesi punya `specId` → seluruh aksi warisan tanpa perubahan gating. Review = diff worktree hidup
   (dokumen audit muncul). Merge = branch `hanoman/<spec-id>`, stage `done` memenuhi gerbang
   `POST /specs/:id/integrate`.

5. **Preview docs mengenali audit SoT.** `kindOf` (`server/src/services/spec-docs.ts`) kini
   mengklasifikasi `*-audit.md` **atau** `…/research/audit-…` sebagai kind `audit` — menyatukan
   audit qa-flow lama dan audit-only di daftar `GET /specs/:id/docs`.

6. **Promosi "naik jadi Finding QA".** Tombol di `SpecDetail` (source audit) membuka `NewSpecModal`
   source `qa` ter-prefill (title + backlink audit di langkah reproduksi) → `POST /specs` biasa.
   Cermin "Take ke backlog" PRD (ADR-0041) — tanpa endpoint baru, tanpa auto-split. Spec qa baru
   menjalankan flow qa penuh (audit → spec → plan → execute); audit asli tetap doc-of-record.

## Konsekuensi

- Tak ada migration / skema baru. Alur baru: **audit → laporan (dokumen), berhenti**; opsional
  dinaikkan jadi Finding QA lewat satu klik.
- Dokumen audit adalah SoT permanen (`internal/docs/research/`) yang di-commit & di-push per
  konvensi — **tanpa ceiling PRD** (ADR-0041): review/merge dari branch `hanoman/<spec-id>` tetap
  jalan setelah sesi ditutup (pola done-spec, `baseSha`/`headSha` tersimpan).
- `author` audit berawalan `Audit ·` (cermin `QA ·`), memudahkan penelusuran asal.
- Payload audit **brief-shaped** (`context/outcome/constraints/priority`) — luwes untuk "audit bisa
  menyangkut apapun"; `zCreateSpec.superRefine` tetap (audit non-qa → payload brief lolos).

## Alternatif yang ditolak

- **Flow project-level seperti PRD** (tanpa `Spec`). Melanggar bentuk yang diminta ("pada backlog")
  dan menuntut membangun ulang jalur review+integrate ber-skop sesi (ADR-0054) yang sudah gratis
  bila audit adalah Spec. Ditolak.
- **Reuse flow `qa` + tandai "no-execute" via keputusan agen.** Rapuh (bergantung agen tak
  meng-Execute), tak terlihat/terfilter di UI, tanpa titik masuk "buat sebagai audit". Audit
  sebagai first-class source jauh lebih jujur. Ditolak.
- **Payload audit khusus** (skema baru). Menambah cabang `superRefine` + union untuk keuntungan
  kecil; brief-shaped sudah cukup dan konsisten. YAGNI. Ditolak.

## Acceptance (EARS)

- **AC-1** — WHEN operator membuat backlog dengan source `audit`, THE server SHALL menyimpannya
  sebagai `Spec` (`source:"audit"`, author `Audit ·`) via `POST /specs`, payload brief-shaped.
- **AC-2** — WHEN operator menjalankan Start pada item audit, THE client SHALL mengirim
  `flow:"audit"` (`flowForSource`) dan sesi SHALL memakai pipeline `Audit → Laporan`.
- **AC-3** — THE prompt sesi audit SHALL menginstruksikan investigasi + dokumen audit **tanpa**
  perbaikan kode, dan tak menyebut fase Execute.
- **AC-4** — WHEN sesi audit menulis `Laporan done`, THE stage backlog SHALL menjadi `done`
  (tak tertahan di `executing`).
- **AC-5** — THE sel Terminal sesi audit SHALL menampilkan preview docs, review, merge/rebase, dan
  fullscreen — identik dengan brief/qa (digerbangi `specId`, bukan source).
- **AC-6** — THE `GET /specs/:id/docs` SHALL mengklasifikasi dokumen audit SoT
  (`research/audit-*` / `*-audit.md`) sebagai kind `audit`.
- **AC-7** — WHEN operator memilih "Jadikan Finding QA" pada item audit, THE UI SHALL membuka
  create-spec source `qa` ter-prefill dari audit; audit asli SHALL tetap ada sebagai doc-of-record.
