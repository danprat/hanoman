# Flow QA Finding (jalur cepat pasca-Audit) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt flow `qa` menyuruh agen memutuskan, sesudah Audit, apakah temuan berconfidence tinggi & langsung dikerjakan — bila ya, LEWATI Spec & Plan (tandai `skipped`) menuju Execute.

**Architecture:** Perubahan hanya di prompt. Mesin jalur cepat (`skipped` → stage `planned`, keluar dari penyebut progress, `planComplete` fast-path) sudah ada & teruji di `server/src/services/session-phases.ts` + `server/test/session-phases.test.ts`. Kita cuma menambah klausa instruksi khusus `qa` ke `startPrompt` lewat helper `auditDecisionInstruction(flow)`, meniru pola `skillInstruction` (kembalikan `""` bila tak berlaku).

**Tech Stack:** TypeScript (runner package), vitest.

## Global Constraints

- TypeScript strict.
- Prosa docs bahasa Indonesia; kode/identifier apa adanya.
- Tak ada perubahan skema, kontrak API, atau dependensi baru.
- Confidence tetap penilaian satu-bit tingkat-prompt (ADR-0020), disurface sebagai `skipped`.
- Update docs yang tersentuh + link index dalam commit yang sama.
- ADR baru = **0040** (max lintas worktree = 0039).

---

### Task 1: Klausa keputusan Audit di prompt flow `qa`

**Files:**
- Modify: `runner/src/prompt.ts` (tambah helper `auditDecisionInstruction`, sisipkan ke `startPrompt`)
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `Flow`, `PIPELINES` (sudah ada); pola `skillInstruction(phases) → string`.
- Produces: `auditDecisionInstruction(flow: Flow): string` — non-`""` hanya untuk `flow === "qa"`. Disisipkan ke array `startPrompt` (di-`filter(Boolean)`), jadi `""` otomatis hilang untuk flow lain.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `runner/test/prompt.test.ts` di dalam `describe("startPrompt", …)` (setelah test qa systematic-debugging, sekitar baris 51):

```typescript
  // SPEC-204 · ADR-0040: pasca-Audit, temuan berconfidence tinggi & langsung → lewati Spec+Plan.
  it("qa: menginstruksikan jalur cepat — lewati Spec & Plan bila temuan langsung dikerjakan", () => {
    const p = startPrompt("qa", spec, "b");
    expect(p).toContain("confidence");
    expect(p).toContain("Spec skipped");
    expect(p).toContain("Plan skipped");
    // keputusan berpangkal pada hasil Audit
    expect(p.indexOf("Audit")).toBeLessThan(p.indexOf("Spec skipped"));
  });

  it("feature: TIDAK membawa klausa jalur cepat Audit (khusus qa)", () => {
    const p = startPrompt("feature", spec, "b");
    expect(p).not.toContain("Spec skipped");
    expect(p).not.toContain("Plan skipped");
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd runner && npx vitest run test/prompt.test.ts -t "jalur cepat"`
Expected: FAIL — prompt `qa` belum memuat "Spec skipped".

- [x] **Step 3: Implementasi helper + sisipkan ke startPrompt**

Di `runner/src/prompt.ts`, tambahkan helper setelah `skillInstruction` (sekitar baris 65):

```typescript
// SPEC-204 · ADR-0040 — jalur cepat qa: sesudah Audit, temuan berconfidence tinggi yang
// perbaikannya langsung (diff kecil, akar masalah jelas) melewati Spec+Plan. Keputusan
// diambil AGEN, disurface sebagai `skipped` di phase file (bukan artefak runner — ADR-0020
// disuperseded). Confidence hidup di sini, satu-bit; buktinya `reason` audit di log run.
const auditDecisionInstruction = (flow: Flow): string =>
  flow !== "qa" ? "" :
    "Keputusan pasca-Audit (qa): bila temuan berconfidence tinggi dan perbaikannya bisa "
    + "dikerjakan langsung (diff kecil, akar masalah jelas), LEWATI Spec dan Plan — tandai "
    + "keduanya `skipped` (`echo \"Spec skipped\" >> \"$HANOMAN_PHASE_FILE\"` lalu "
    + "`echo \"Plan skipped\" >> \"$HANOMAN_PHASE_FILE\"`) dan langsung ke Execute; dokumen "
    + "audit menjadi doc-of-record perbaikan itu. Bila temuan luas, berisiko, atau ambigu, "
    + "jalankan Spec → Plan → Execute penuh. Keputusan ini milikmu berdasarkan hasil Audit, "
    + "bukan default — jangan bayar perencanaan yang tak perlu untuk perbaikan sepele.";
```

Lalu sisipkan ke array `startPrompt` (setelah `phaseInstruction(PIPELINES[flow])`, sebelum `AUTONOMY_CLAUSE`):

```typescript
  return [
    `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
      + `dan link-nya di index, dalam commit yang sama.`,
    phaseInstruction(PIPELINES[flow]),
    auditDecisionInstruction(flow),
    AUTONOMY_CLAUSE,
    skillInstruction(PIPELINES[flow]),
    ...
```

- [x] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd runner && npx vitest run test/prompt.test.ts`
Expected: PASS — semua test prompt (lama + baru) hijau. (Cek juga `startProjectPrompt`/reverse tak menyebut "Spec skipped".)

- [x] **Step 5: Commit**

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(qa): jalur cepat pasca-Audit lewati Spec+Plan bila temuan langsung (SPEC-204)"
```

---

### Task 2: Docs — ADR-0040, catatan ADR-0020, workflow, index

**Files:**
- Create: `internal/docs/adr/0040-jalur-cepat-qa-dielicit-prompt.md`
- Modify: `internal/docs/adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md` (catatan status)
- Modify: `internal/docs/operations/agent-documentation-workflow.md` (segarkan ref ADR)
- Modify: `internal/docs/README.md` (daftarkan 0040)

- [x] **Step 1: Tulis ADR-0040**

Buat `internal/docs/adr/0040-jalur-cepat-qa-dielicit-prompt.md`:

```markdown
# ADR-0040 — Jalur cepat qa dielicit lewat prompt, diputuskan agen

**Status:** diterima · 2026-07-13 · SPEC-204 · **supersedes mekanisme ADR-0020**

## Konteks

ADR-0020 memutuskan kebijakan: sesudah Audit, temuan kecil melewati Spec+Plan. Mekanismenya
saat itu `runOne` membaca artefak `.hanoman-decision.json`. Model itu **sudah dicabut** —
sesi kini `claude -p` yang menggerakkan dirinya sendiri (ADR-0024/0035), tak ada `runOne`
maupun artefak yang dibaca. Akibatnya prompt `qa` hanya menyuruh "kerjakan fase berurutan"
dan tiap temuan membayar full Spec+Plan (SPEC-204: "masih full flow spec, plans").

## Keputusan

Keputusan jalur cepat **dielicit lewat prompt** dan **diambil agen**, disurface sebagai
`Spec skipped` / `Plan skipped` di `$HANOMAN_PHASE_FILE` — kanal yang sama dengan transisi
fase lain. Klausa `auditDecisionInstruction(flow)` hanya untuk `qa`: bila temuan berconfidence
tinggi & perbaikannya langsung, lewati Spec+Plan; selain itu jalankan penuh.

Confidence tetap **satu-bit tingkat-prompt** (seperti ADR-0020); buktinya `reason` audit.

## Konsekuensi

- Kebijakan ADR-0020 tetap; hanya **mekanismenya** yang berpindah dari artefak-runner ke
  phase-file `skipped`. Mesin `skipped` (stage `planned`, keluar dari penyebut progress,
  `planComplete` fast-path) sudah ada di `session-phases.ts` — tak berubah.
- Aman-injeksi: phase file hidup di luar worktree (`.worktrees/.phases/`, `.gitignore`), jadi
  `git add -A` agen tak bisa menyentuhnya — memenuhi keberatan ADR-0020 atas "sentinel di teks Audit".
- Gerbang tak ikut dilewati: `stageForRun`/`planComplete` tetap menahan Execute (ADR-0029).

## Alternatif yang ditolak

- **Menghidupkan kembali artefak `.hanoman-decision.json` + gerbang runner.** Menambah I/O &
  gerbang untuk keputusan yang sudah bisa disurface lewat kanal phase-file yang ada. YAGNI.
- **Skor confidence numerik.** Keputusan efektif satu-bit (lewati / tidak); angka tak menambah kerja.
```

- [x] **Step 2: Tambah catatan status di ADR-0020**

Di `internal/docs/adr/0020-…md`, ubah baris **Status** menjadi:

```markdown
**Status:** diterima · 2026-07-09 · SPEC-145 · **mekanisme disuperseded oleh ADR-0040** (kebijakan tetap)
```

- [x] **Step 3: Segarkan referensi ADR di workflow doc**

Di `internal/docs/operations/agent-documentation-workflow.md`, baris QA — ubah akhir referensi:

Dari:
```markdown
- **Fitur:** spec → plan → execute. **QA:** audit → **keputusan** → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped` (SPEC-145, ADR-0020).
```
Menjadi:
```markdown
- **Fitur:** spec → plan → execute. **QA:** audit → **keputusan** → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped`; keputusan dielicit lewat prompt & diambil agen (SPEC-145/ADR-0020, mekanisme SPEC-204/ADR-0040).
```

- [x] **Step 4: Daftarkan ADR-0040 di index README**

Di `internal/docs/README.md`, di bawah `## adr`, tambahkan sebagai entri paling atas (di atas 0039):

```markdown
- [0040 — Jalur cepat qa dielicit lewat prompt, diputuskan agen](adr/0040-jalur-cepat-qa-dielicit-prompt.md) — **supersedes mekanisme 0020**
```

Dan tandai entri 0020 dengan supersede-mekanisme:
```markdown
- [0020 — Fase perencanaan QA dipangkas oleh keputusan audit](adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md) — *mekanisme superseded by 0040*
```

- [x] **Step 5: Verifikasi coverage docs (dep-free, tanpa server)**

Run: `cd shared && npx tsx -e "import('./src/coverage.ts').then(m => console.log('coverage module loads'))"` — atau lewati bila tak ada skrip; yang penting tiap file docs baru ter-link di index.
Manual: pastikan `0040-jalur-cepat-qa-dielicit-prompt.md` muncul di `internal/docs/README.md`.

- [x] **Step 6: Commit**

```bash
git add internal/docs/adr/0040-jalur-cepat-qa-dielicit-prompt.md internal/docs/adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md internal/docs/operations/agent-documentation-workflow.md internal/docs/README.md
git commit -m "docs(qa): ADR-0040 jalur cepat qa dielicit prompt, supersede mekanisme ADR-0020 (SPEC-204)"
```

---

## Self-Review

- **Spec coverage:** Objective (lewati Spec+Plan bila confidence tinggi) → Task 1 klausa prompt. Docs tersentuh (ADR-0020, workflow, index) + ADR-0040 → Task 2. ✔
- **Placeholder scan:** tak ada TBD/TODO; semua langkah punya kode/teks nyata. ✔
- **Type consistency:** `auditDecisionInstruction(flow: Flow): string` konsisten dipakai di `startPrompt`. ✔
- **Tak ada test baru untuk mesin `skipped`:** sudah dijamin `session-phases.test.ts` yang ada — tak diduplikasi (DRY). ✔
