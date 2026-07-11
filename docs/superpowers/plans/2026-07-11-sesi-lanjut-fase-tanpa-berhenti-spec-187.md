# SPEC-187 — Sesi lanjut fase tanpa berhenti kecuali keputusan · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt awal sesi spec-flow menyuruh agen menembus batas antar-fase tanpa berhenti; berhenti hanya saat butuh keputusan manusia.

**Architecture:** Tambah satu klausa otonomi (`AUTONOMY_CLAUSE`) di `runner/src/prompt.ts`, di-share `startPrompt` + `continuePrompt`. `startProjectPrompt` (reverse) sengaja tak memakainya — fase Wawancara-nya interaktif. Skill superpowers adalah plugin eksternal; prompt adalah tuas hanoman satu-satunya. (ADR-0035, root cause di ADR-0024.)

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- TypeScript strict.
- Teks prompt bahasa Indonesia, mengikuti gaya `prompt.ts` yang ada.
- Docs SoT yang tersentuh (ADR-0035, README index, stack.md) diperbarui dalam commit yang sama — sudah dilakukan di fase Spec.
- `startProjectPrompt` TIDAK boleh membawa klausa ini.

---

### Task 1: Klausa otonomi di prompt spec-flow

**Files:**
- Modify: `runner/src/prompt.ts`
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `startPrompt`, `continuePrompt`, `startProjectPrompt` (tanda tangan tak berubah).
- Produces: konstanta modul `AUTONOMY_CLAUSE: string`; string keluaran `startPrompt`/`continuePrompt` kini memuatnya.

- [x] **Step 1: Tulis test yang gagal**

Tambah ke `describe("startPrompt")`:

```ts
it("feature/qa: menyuruh terus lanjut antar-fase, berhenti hanya untuk keputusan manusia", () => {
  for (const flow of ["feature", "qa"] as const) {
    const p = startPrompt(flow, spec, "b");
    expect(p).toContain("tanpa berhenti di batas antar-fase");
    expect(p).toContain("keputusan manusia");
  }
});
```

Tambah ke `describe("continuePrompt")`:

```ts
it("membawa klausa otonomi (berhenti hanya untuk keputusan manusia)", () => {
  expect(continuePrompt("feature", spec, branch)).toContain("tanpa berhenti di batas antar-fase");
});
```

Tambah ke `describe("startProjectPrompt")`:

```ts
it("reverse: TIDAK membawa klausa otonomi — Wawancara memang interaktif", () => {
  expect(startProjectPrompt("reverse", project, "reverse-docs")).not.toContain("tanpa berhenti di batas antar-fase");
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./runner exec vitest run test/prompt.test.ts`
Expected: FAIL — dua assertion `toContain` gagal (klausa belum ada).

- [x] **Step 3: Implementasi minimal**

Di `runner/src/prompt.ts`, tambah konstanta setelah `PIPELINES`:

```ts
// SPEC-187 · ADR-0035 — sesi spec-flow menembus batas fase tanpa berhenti. Skill superpowers
// punya checkpoint review; di sesi tak-berpenunggu itu bukan titik berhenti. Berhenti hanya untuk
// keputusan manusia sejati, yang agen surface sebagai pertanyaan di terminalnya (ADR-0024).
const AUTONOMY_CLAUSE =
  "Jalankan seluruh pipeline sampai tuntas tanpa berhenti di batas antar-fase. Checkpoint "
  + "\"review\"/\"approval\"/\"need review\" milik skill superpowers BUKAN titik berhenti di sini — "
  + "lanjut saja ke fase berikutnya. Berhenti HANYA saat butuh keputusan manusia sejati (percabangan "
  + "yang mengubah bentuk kerja: data model, kontrak API, scope); saat itu tanyakan di terminal ini "
  + "dan tunggu jawabannya. Selain itu, terus lanjut.";
```

Di `startPrompt`, sisipkan `AUTONOMY_CLAUSE` di array setelah `phaseInstruction(...)`, sebelum `skillInstruction(...)`:

```ts
    phaseInstruction(PIPELINES[flow]),
    AUTONOMY_CLAUSE,
    skillInstruction(PIPELINES[flow]),
```

Di `continuePrompt`, sisipkan `AUTONOMY_CLAUSE` setelah elemen "JANGAN mengulang fase awal…", sebelum `skillInstruction(["Execute"])`:

```ts
    `JANGAN mengulang fase awal — spec & plan sudah ada. Lanjut di fase Execute: baca plan `
      + `di docs/superpowers/plans/** untuk backlog item ini, periksa task yang sudah \`[x]\` `
      + `dan selesaikan yang masih \`[ ]\`. Verifikasi nyata sebelum klaim selesai.`,
    AUTONOMY_CLAUSE,
    skillInstruction(["Execute"]),
```

`startProjectPrompt` tidak disentuh.

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./runner exec vitest run test/prompt.test.ts`
Expected: PASS (semua, termasuk yang lama).

- [x] **Step 5: Verifikasi nyata — cetak prompt asli**

Run: bangun `runner`, panggil `startPrompt("qa", …)` dan `startProjectPrompt("reverse", …)`, grep klausanya ada di qa & absen di reverse.
Expected: qa memuat "tanpa berhenti di batas antar-fase"; reverse tidak.

- [x] **Step 6: Commit** (di akhir sesi, bersama docs SoT ADR-0035 / README / stack.md)

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts internal/docs docs/superpowers/plans
git commit -m "feat(prompt): sesi spec-flow lanjut antar-fase tanpa berhenti kecuali keputusan (SPEC-187)"
```

---

## Self-Review

- **Spec coverage:** ADR-0035 keputusan → Task 1 memasang klausa di `startPrompt`+`continuePrompt`, mengecualikan `startProjectPrompt`. ✓
- **Placeholder scan:** tak ada TBD/TODO; semua kode nyata. ✓
- **Type consistency:** tak ada tipe/tanda tangan baru; `AUTONOMY_CLAUSE: string` konsisten. ✓
