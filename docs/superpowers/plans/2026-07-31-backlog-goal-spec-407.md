# Backlog khusus sesi mode goal (SPEC-407) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan jenis backlog baru bersource `goal` yang melahirkan sesi ber-flow `goal` — dua fase (`Goal → Verifikasi`), tanpa Brainstorm/Objective/Spec/Plan, dengan mode goal (Stop hook ADR-0073) selalu menyala dan kondisinya diturunkan dari isi item.

**Architecture:** Source & flow baru di `@hanoman/shared` (enum + payload zod, tanpa migration), pipeline + prompt khusus di `@hanoman/runner`, peta stage & peluncuran sesi di server, dan tiga permukaan UI (modal backlog baru, picker Start, preview PRD). Tak ada endpoint baru, tak ada model Prisma baru.

**Tech Stack:** TypeScript strict · zod · Fastify · Prisma 6 (SQLite) · React 18 + Vite · vitest + @testing-library/react.

## Global Constraints

- **Tanpa migration & tanpa model Prisma baru.** `Spec.source` adalah `String` divalidasi zod; `Spec.payload` bertipe `Json`.
- **Tanpa endpoint baru.** `POST /specs`, `PATCH /specs/:id`, `POST /terminal/sessions` hanya bertambah nilai enum & varian payload.
- **Nama fase baru `Goal` dan `Verifikasi` wajib unik lintas `PIPELINES`** — `REACHED` di `session-phases.ts` memetakan berdasarkan nama fase saja.
- **ADR-0037 tetap utuh**: mode goal adalah Stop hook, bukan hook deny.
- **Verifikasi ber-scope `changed`** (ADR-0080). Set `--changed` di repo ini WAJIB `--no-file-parallelism` bila menyentuh test server (test server berbagi satu berkas DB; SPEC-397 mengukur 181 gagal palsu paralel vs 736 lulus serial).
- **Jangan `pkill -f`/`killall`** (SPEC-402) — bunuh per-PID.
- Prosa UI & komentar kode berbahasa Indonesia, mengikuti gaya berkas sekitarnya.
- Docs yang tersentuh diperbarui **di commit yang sama** dan ter-link di `internal/docs/README.md`.

---

### Task 1: Source, flow, dan payload `goal` di `@hanoman/shared`

**Files:**
- Modify: `shared/src/enums.ts:3` (zSpecSource)
- Modify: `shared/src/entities.ts:20-37` (zGoalPayload + zSpec.payload)
- Modify: `shared/src/dto.ts:59-70` (zCreateSpec), `:76-84` (zPatchSpec), `:140-150` (zFlow + flowForSource)
- Test: `shared/test/enums.test.ts`, `shared/test/entities.test.ts`, `shared/test/dto.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `zGoalPayload` (`{ goal: string; done: string; constraints: string; priority: Priority }`), `zSpecSource` menerima `"goal"`, `zFlow` menerima `"goal"`, `flowForSource("goal") === "goal"`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `shared/test/enums.test.ts` (di dalam `describe` zSpecSource yang sudah ada, atau describe baru bila belum ada):

```ts
it("SPEC-407 · goal adalah source yang sah", () => {
  expect(zSpecSource.safeParse("goal").success).toBe(true);
});
```

Tambahkan di `shared/test/dto.test.ts`:

```ts
import { zFlow, flowForSource, zCreateSpec } from "../src/dto";

describe("SPEC-407 · flow goal", () => {
  it("goal adalah flow yang sah dan dipetakan dari source goal", () => {
    expect(zFlow.safeParse("goal").success).toBe(true);
    expect(flowForSource("goal")).toBe("goal");
    // source lain tak bergeser
    expect(flowForSource("brief")).toBe("feature");
    expect(flowForSource("qa")).toBe("qa");
  });

  it("zCreateSpec mengikat source goal ke payload ber-`goal`", () => {
    const base = { project: "p1", title: "t", priority: "tinggi" as const };
    const goalPayload = { goal: "p95 < 200 ms", done: "benchmark di transkrip", constraints: "", priority: "tinggi" as const };
    const briefPayload = { context: "c", outcome: "o", constraints: "", priority: "tinggi" as const };
    expect(zCreateSpec.safeParse({ ...base, source: "goal", payload: goalPayload }).success).toBe(true);
    // source goal + payload brief → ditolak
    expect(zCreateSpec.safeParse({ ...base, source: "goal", payload: briefPayload }).success).toBe(false);
    // source brief + payload goal → ditolak
    expect(zCreateSpec.safeParse({ ...base, source: "brief", payload: goalPayload }).success).toBe(false);
    // qa tetap terikat severity
    expect(zCreateSpec.safeParse({ ...base, source: "qa", payload: goalPayload }).success).toBe(false);
  });
});
```

Tambahkan di `shared/test/entities.test.ts`:

```ts
import { zGoalPayload, zSpec } from "../src/entities";

it("SPEC-407 · zSpec menerima payload goal apa adanya", () => {
  const payload = { goal: "g", done: "d", constraints: "c", priority: "tinggi" };
  expect(zGoalPayload.safeParse(payload).success).toBe(true);
  const spec = zSpec.parse({
    id: "SPEC-407", projectId: "p1", title: "t", source: "goal", stage: "brainstorming",
    priority: "tinggi", author: "a", objective: "g", payload, branchFrom: null, baseSha: null,
  });
  expect(spec.payload).toEqual(payload);
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/test/enums.test.ts shared/test/dto.test.ts shared/test/entities.test.ts`
Expected: FAIL — `zSpecSource.safeParse("goal")` false, `zGoalPayload` tak ter-ekspor.

- [x] **Step 3: Implementasi**

`shared/src/enums.ts` — ganti baris `zSpecSource`:

```ts
// SPEC-407 · +goal (backlog yang langsung dikejar sesi mode goal, tanpa fase perencanaan)
export const zSpecSource = z.enum(["brief","qa","audit","cross-audit","help","goal"]);
```

`shared/src/entities.ts` — tepat di bawah `zQaPayload`:

```ts
// SPEC-407 · backlog goal: sesi mengejar SATU goal tanpa fase perencanaan. `goal` wajib —
// objective spec diturunkan darinya (deriveSpecFields) dan ia jadi inti kondisi Stop hook
// (ADR-0073). `done` = bukti berhenti yang dituntut; kosong berarti "buktinya goal itu sendiri".
export const zGoalPayload = z.object({
  goal: z.string(), done: z.string(), constraints: z.string(), priority: zPriority });
```

dan ubah `zSpec.payload`:

```ts
  payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]).nullable(),
```

`shared/src/dto.ts` — impor `zGoalPayload` dari `./entities` (lihat baris impor yang sudah membawa `zBriefPayload, zQaPayload`), lalu:

```ts
export const zCreateSpec = z.object({
  project: z.string(), source: zSpecSource, title: z.string().min(1),
  priority: zPriority, payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]),
  branchFrom: z.string().min(1).optional() })
  // SPEC-197 · ikat source ke BENTUK payload — union saja tak menjaganya (objek non-strict),
  // jadi `deriveSpecFields` bisa menurunkan objective/priority dari bentuk yang salah.
  // SPEC-407 · kini tiga-arah: qa ↔ `severity`, goal ↔ `goal`, selain itu → brief.
  .superRefine((o, ctx) => {
    const shape = "severity" in o.payload ? "qa" : "goal" in o.payload ? "goal" : "brief";
    const want = o.source === "qa" ? "qa" : o.source === "goal" ? "goal" : "brief";
    if (shape !== want)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "bentuk payload tak cocok dengan source" });
  });
```

`zPatchSpec.payload`:

```ts
  payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]).optional(),
```

`zFlow` + `flowForSource`:

```ts
// SPEC-407 · +goal · sesi dua fase (Goal → Verifikasi) tanpa fase perencanaan.
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd", "audit", "breakdown", "cross-audit", "goal"]);
...
export function flowForSource(source: string): FlowName {
  return source === "qa" ? "qa"
    : source === "audit" ? "audit"
    : source === "cross-audit" ? "cross-audit"
    : source === "goal" ? "goal"     // SPEC-407
    : "feature";
}
```

Pastikan `zGoalPayload` ikut ter-ekspor dari barrel `shared/src/index.ts` bila barrel itu menyebut ekspor satu per satu (periksa dengan `grep -n "zQaPayload" shared/src/index.ts`; bila `export * from "./entities"` maka tak ada yang perlu ditambah).

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/test/enums.test.ts shared/test/dto.test.ts shared/test/entities.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/enums.ts shared/src/entities.ts shared/src/dto.ts shared/test/enums.test.ts shared/test/dto.test.ts shared/test/entities.test.ts
git commit -m "feat(407): source & flow goal + zGoalPayload di shared (tanpa migration)"
```

---

### Task 2: Pipeline `goal`, pembaca payload, dan prompt sesi goal di `@hanoman/runner`

**Files:**
- Modify: `runner/src/types.ts:1` (Flow)
- Create: `runner/src/goal-spec.ts`
- Modify: `runner/src/prompt.ts:5-16` (PIPELINES), `:75-84` (PHASE_SKILLS), `:180-185` (scopeClause), `:239-262` (resumeClause), `:264-288` (resumePrompt), + `startGoalPrompt` baru
- Modify: `runner/src/index.ts` (ekspor modul baru)
- Test: `runner/test/goal-spec.test.ts` (baru), `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `Flow` (Task 1 tak menyentuhnya; `Flow` di runner adalah union TS terpisah dari `zFlow`).
- Produces:
  - `type GoalBrief = { goal: string; done: string; constraints: string }`
  - `readGoalPayload(payload: unknown): GoalBrief | null`
  - `PIPELINES.goal === ["Goal", "Verifikasi"]`
  - `startGoalPrompt(spec: SpecBrief, branchTo: string, opts?: { autonomy?: Autonomy; verifyScope?: VerifyScope; resume?: ResumeCtx }): string`

- [x] **Step 1: Tulis test yang gagal untuk `readGoalPayload`**

Buat `runner/test/goal-spec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readGoalPayload } from "../src/goal-spec";

describe("readGoalPayload (SPEC-407)", () => {
  it("membaca goal/done/constraints dan memangkas spasi", () => {
    expect(readGoalPayload({ goal: "  p95 < 200 ms ", done: " benchmark ", constraints: " tanpa cache ", priority: "tinggi" }))
      .toEqual({ goal: "p95 < 200 ms", done: "benchmark", constraints: "tanpa cache" });
  });

  it("field opsional yang hilang jadi string kosong", () => {
    expect(readGoalPayload({ goal: "g" })).toEqual({ goal: "g", done: "", constraints: "" });
  });

  // Payload datang dari kolom Json — bentuk apa pun bisa mendarat di sana.
  it("bentuk yang tak sah → null, tanpa melempar", () => {
    expect(readGoalPayload(null)).toBeNull();
    expect(readGoalPayload(undefined)).toBeNull();
    expect(readGoalPayload("goal")).toBeNull();
    expect(readGoalPayload([{ goal: "g" }])).toBeNull();
    expect(readGoalPayload({ context: "c", outcome: "o" })).toBeNull();
    expect(readGoalPayload({ goal: 42 })).toBeNull();
    expect(readGoalPayload({ goal: "   " })).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run runner/test/goal-spec.test.ts`
Expected: FAIL — modul `../src/goal-spec` tak ada.

- [x] **Step 3: Implementasi `runner/src/goal-spec.ts`**

```ts
// SPEC-407 · pembaca payload backlog goal.
//
// Modul TERPISAH dengan sengaja: `goal.ts` sudah mengimpor `prompt.ts` (untuk PIPELINES), jadi
// menaruh reader ini di salah satu dari keduanya melahirkan siklus impor. Ia murni & defensif —
// payload datang dari kolom `Json`, jadi bentuk apa pun bisa mendarat di sana dan tak satu pun
// boleh membuat peluncuran sesi melempar.
export type GoalBrief = { goal: string; done: string; constraints: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** `null` bila payload bukan objek ber-`goal` string non-kosong (mis. payload brief/qa). */
export function readGoalPayload(payload: unknown): GoalBrief | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const goal = str(p.goal);
  if (!goal) return null;
  return { goal, done: str(p.done), constraints: str(p.constraints) };
}
```

Tambahkan di `runner/src/index.ts` (setelah `export * from "./goal";`):

```ts
export * from "./goal-spec";
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run runner/test/goal-spec.test.ts`
Expected: PASS (7 assertion group hijau).

- [x] **Step 5: Tulis test yang gagal untuk pipeline & prompt goal**

Tambahkan di `runner/test/prompt.test.ts` (impor `startGoalPrompt` di baris impor teratas):

```ts
// SPEC-407 · sesi backlog goal: yang dihapus justru KERANGKA-nya. Prompt ini harus mengeja
// goal-nya, dua fasenya, dan pintu keluar yang dibuktikan — tanpa menyeret pipeline perencanaan.
describe("startGoalPrompt", () => {
  const goalSpec = {
    id: "SPEC-407", title: "Backlog goal", source: "goal", priority: "tinggi",
    objective: "p95 < 200 ms",
    payload: { goal: "p95 /api/specs < 200 ms", done: "output benchmark < 200 ms", constraints: "tanpa cache eksternal", priority: "tinggi" },
  };

  it("pipeline goal berisi dua fase", () => {
    expect(PIPELINES.goal).toEqual(["Goal", "Verifikasi"]);
  });

  it("mengeja goal, selesai-bila, batasan, dan dua fasenya", () => {
    const p = startGoalPrompt(goalSpec, "hanoman/spec-407");
    expect(p).toContain("Goal: p95 /api/specs < 200 ms");
    expect(p).toContain("Selesai bila: output benchmark < 200 ms");
    expect(p).toContain("Batasan: tanpa cache eksternal");
    expect(p).toContain("Kerjakan fase berurutan: Goal → Verifikasi.");
    expect(p).toContain("git push origin HEAD:refs/heads/hanoman/spec-407");
    expect(p).toContain("SPEC-407");
  });

  it("tak menyeret pipeline perencanaan maupun skill-nya", () => {
    const p = startGoalPrompt(goalSpec, "b");
    expect(p).not.toContain("Kerjakan fase berurutan: Brainstorm");
    expect(p).not.toContain("superpowers:brainstorming");
    expect(p).not.toContain("superpowers:writing-plans");
    // gerbang plan ADR-0029 hanya untuk pipeline ber-Plan+Execute
    expect(p).not.toContain("docs/superpowers/plans");
    // pintu keluarnya tetap dijaga
    expect(p).toContain("superpowers:verification-before-completion");
  });

  it("membawa klausa scope verifikasi — sesi goal menulis kode meski tanpa fase Execute", () => {
    const p = startGoalPrompt(goalSpec, "b", { verifyScope: "changed" });
    expect(p).toContain("Scope verifikasi: HANYA yang berubah");
    expect(startGoalPrompt(goalSpec, "b")).not.toContain("Scope verifikasi");
  });

  it("payload rusak → jatuh ke objective spec, tanpa melempar", () => {
    const p = startGoalPrompt({ ...goalSpec, payload: { context: "c" } }, "b");
    expect(p).toContain("Goal: p95 < 200 ms");
    expect(p).not.toContain("Selesai bila:");
  });

  it("varian resume menyebut keadaan nyata tanpa menyuruh mencari plan", () => {
    const p = startGoalPrompt(goalSpec, "hanoman/spec-407", {
      resume: { recorded: ["Goal done"], next: "Verifikasi", worktreeKept: true },
    });
    expect(p).toContain("MELANJUTKAN");
    expect(p).toContain("Goal done");
    expect(p).toContain("Lanjutkan dari fase: Verifikasi.");
    expect(p).not.toContain("docs/superpowers/plans");
  });
});
```

- [x] **Step 6: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run runner/test/prompt.test.ts`
Expected: FAIL — `startGoalPrompt` tak ada, `PIPELINES.goal` undefined.

- [x] **Step 7: Implementasi di runner**

`runner/src/types.ts` baris 1:

```ts
// SPEC-407 · +goal · sesi backlog dua fase (Goal → Verifikasi), tanpa fase perencanaan.
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "cross-audit" | "goal";
```

`runner/src/prompt.ts` — impor reader di bagian atas berkas:

```ts
import { readGoalPayload } from "./goal-spec";
```

Tambahkan entri `PIPELINES` (setelah `"cross-audit"`):

```ts
  // SPEC-407 · backlog goal: tak ada fase perencanaan sama sekali. `Goal` = kerjakan,
  // `Verifikasi` = buktikan. Nama keduanya unik lintas PIPELINES — REACHED memetakan per nama.
  goal: ["Goal", "Verifikasi"],
```

Tambahkan skill fase (di `PHASE_SKILLS`, sesudah `Execute`):

```ts
  // SPEC-407 · fase `Goal` sengaja TANPA skill: intinya membebaskan sesi dari proses kaku.
  // Yang tetap dijaga cuma pintu keluarnya.
  Verifikasi: ["superpowers:verification-before-completion"],
```

Ganti `scopeClause`:

```ts
// SPEC-376 · ADR-0080 — klausa scope verifikasi hanya untuk flow yang MENULIS KODE. Flow dokumen
// (audit, cross-audit, prd, breakdown, reverse, scaffold) tak punya test untuk dijalankan.
// SPEC-407 · flow goal menulis kode juga, meski pipeline-nya tak punya fase `Execute` — tanpa
// klausa ini ia jatuh ke DoD repo target dan menjalankan suite penuh.
const writesCode = (flow: Flow): boolean =>
  PIPELINES[flow].includes("Execute") || PIPELINES[flow].includes("Goal");
const scopeClause = (flow: Flow, scope?: VerifyScope): string =>
  scope && writesCode(flow) ? verifyScopeClause(scope) : "";
```

Ubah `resumeClause` agar sadar ada/tidaknya fase Plan (kalimat plan hanya untuk pipeline yang punya):

```ts
const resumeClause = (r: ResumeCtx, branchTo: string, hasPlan = true): string => {
  const fase = r.recorded.length
    ? `Fase yang SUDAH tercatat di $HANOMAN_PHASE_FILE: ${r.recorded.join(" · ")}. `
      + "JANGAN mengulang fase itu dan JANGAN menulis ulang barisnya."
    : "Belum ada fase yang tercatat di $HANOMAN_PHASE_FILE — worktree ini sendiri yang jadi "
      + "alasan melanjutkan.";
  const lanjut = r.next
    ? `Lanjutkan dari fase: ${r.next}.`
    : hasPlan
      ? "Semua fase sudah tercatat. Periksa apakah plan di `docs/superpowers/plans/**` masih "
        + "menyisakan task `- [ ]` dan selesaikan sisanya; bila sudah bersih, tinggal commit & push."
      // SPEC-407 · sesi goal tak punya plan berkotak — menyuruh agen mencarinya justru
      // mengundangnya membuat satu.
      : "Semua fase sudah tercatat. Buktikan sekali lagi goal-nya benar-benar tercapai, lalu "
        + "commit & push.";
  const worktree = r.worktreeKept
    ? "Worktree ini adalah worktree sesi sebelumnya apa adanya — termasuk perubahan yang belum "
      + "di-commit."
    : `Worktree ini DIBANGUN ULANG dari tip branch sesi \`${branchTo}\`: commit sesi sebelumnya `
      + "ada, tetapi perubahan yang belum sempat di-commit TIDAK ada.";
  const baca = hasPlan
    ? "Sebelum menulis apa pun: baca `git log --oneline` dan `git status`, lalu plan di "
      + "`docs/superpowers/plans/**` untuk backlog item ini (`- [x]` sudah selesai, `- [ ]` belum). "
      + "Jangan menulis ulang yang sudah ada."
    : "Sebelum menulis apa pun: baca `git log --oneline` dan `git status` untuk melihat apa yang "
      + "sudah dikerjakan. Jangan menulis ulang yang sudah ada.";
  return ["Sesi ini MELANJUTKAN pekerjaan sesi sebelumnya untuk backlog item yang sama — bukan "
    + "memulai dari nol.", fase, lanjut, worktree, baca].join(" ");
};
```

Di `resumePrompt`, teruskan kehadiran fase Plan:

```ts
    resumeClause(resume, branchTo, PIPELINES[flow].includes("Plan")),
```

Tambahkan `startGoalPrompt` (letakkan sesudah `resumePrompt`):

```ts
// SPEC-407 · sesi backlog GOAL. Sengaja bukan cabang di dalam startPrompt: yang berbeda bukan
// satu-dua kalimat melainkan KERANGKA-nya — tak ada fase perencanaan, tak ada keputusan
// pasca-Audit, tak ada skill Brainstorm/Plan. Yang tersisa: goal-nya, dua fase, dan pintu
// keluar yang harus dibuktikan. Mode goal (ADR-0073) dipasang di sisi server, bukan di prompt.
export function startGoalPrompt(
  spec: SpecBrief, branchTo: string,
  opts: { autonomy?: Autonomy; verifyScope?: VerifyScope; resume?: ResumeCtx } = {},
): string {
  const g = readGoalPayload(spec.payload);
  const detail = [
    `Goal: ${g?.goal ?? spec.objective}`,
    g?.done ? `Selesai bila: ${g.done}` : "",
    g?.constraints ? `Batasan: ${g.constraints}` : "",
  ].filter(Boolean).join("\n");
  return [
    "hanoman goal — sesi ini mengejar SATU goal sampai tercapai. TIDAK ada fase Brainstorm, "
      + "Objective, Spec, maupun Plan: jangan menulis design doc, jangan menulis plan berkotak, "
      + "jangan memecah pekerjaan ini jadi backlog baru. Langsung kerjakan goal-nya. Tetap ikuti "
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di "
      + "index, dalam commit yang sama.",
    opts.resume ? resumeClause(opts.resume, branchTo, false) : "",
    detail,
    phaseInstruction(PIPELINES.goal),
    "Fase Verifikasi bukan formalitas: jalankan perintah yang membuktikan goal-nya tercapai "
      + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output "
      + "bukan bukti.",
    autonomyClause(opts.autonomy),
    scopeClause("goal", opts.verifyScope),
    skillInstruction(PIPELINES.goal),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}`,
  ].filter(Boolean).join("\n\n");
}
```

- [x] **Step 8: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run runner/test/prompt.test.ts runner/test/goal-spec.test.ts`
Expected: PASS — termasuk test lama `resumePrompt`/`startPrompt` yang tak boleh bergeser.

- [x] **Step 9: Commit**

```bash
git add runner/src/types.ts runner/src/goal-spec.ts runner/src/prompt.ts runner/src/index.ts runner/test/goal-spec.test.ts runner/test/prompt.test.ts
git commit -m "feat(407): pipeline goal dua fase + startGoalPrompt + readGoalPayload"
```

---

### Task 3: Kondisi Stop hook diturunkan dari item goal

**Files:**
- Modify: `runner/src/goal.ts:8-48`
- Test: `runner/test/goal.test.ts`

**Interfaces:**
- Consumes: `readGoalPayload` & `GoalBrief` (Task 2), `PIPELINES.goal` (Task 2).
- Produces: `GoalArgs` bertambah field opsional `spec?: { payload?: unknown; objective?: string }`; `defaultGoalCondition` bercabang untuk `flow === "goal"`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `runner/test/goal.test.ts`:

```ts
// SPEC-407 · backlog goal: kondisi berhenti BUKAN DoD generik hanoman melainkan goal item itu
// sendiri — plus dua bukti yang tanpa itu hasilnya tak pernah terlihat (baris fase & push).
describe("kondisi goal untuk flow goal (SPEC-407)", () => {
  const gArgs = {
    flow: "goal" as const, specId: "SPEC-407", branchTo: "hanoman/spec-407",
    spec: {
      payload: { goal: "p95 /api/specs < 200 ms", done: "output benchmark < 200 ms", constraints: "", priority: "tinggi" },
      objective: "p95 /api/specs < 200 ms",
    },
  };

  it("memuat goal, bukti selesai, baris fase, dan push", () => {
    const c = defaultGoalCondition(gArgs);
    expect(c).toContain("SPEC-407");
    expect(c).toContain("p95 /api/specs < 200 ms");
    expect(c).toContain("output benchmark < 200 ms");
    expect(c).toContain("Goal → Verifikasi");
    expect(c).toContain('cat "$HANOMAN_PHASE_FILE"');
    expect(c).toContain("git push origin HEAD:refs/heads/hanoman/spec-407");
    // tak ada gerbang plan: sesi goal tak berplan
    expect(c).not.toContain("docs/superpowers/plans/");
    expect(c.length).toBeLessThanOrEqual(GOAL_MAX);
  });

  it("tanpa `done` → goal itu sendiri yang jadi buktinya", () => {
    const c = defaultGoalCondition({ ...gArgs, spec: { ...gArgs.spec, payload: { goal: "g", done: "", constraints: "", priority: "tinggi" } } });
    expect(c).toContain("g");
    expect(c).not.toContain("undefined");
  });

  it("payload rusak → jatuh ke objective, tanpa melempar", () => {
    const c = defaultGoalCondition({ ...gArgs, spec: { payload: null, objective: "objective cadangan" } });
    expect(c).toContain("objective cadangan");
  });

  it("flow lain tak tersentuh", () => {
    expect(defaultGoalCondition({ flow: "feature", specId: "SPEC-332", branchTo: "b" }))
      .toContain("Brainstorm → Objective → Spec → Plan → Execute");
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run runner/test/goal.test.ts`
Expected: FAIL — `spec` bukan properti `GoalArgs`; kondisi flow goal masih memakai cabang generik.

- [x] **Step 3: Implementasi `runner/src/goal.ts`**

```ts
import type { Flow } from "./types";
import { PIPELINES } from "./prompt";
import { readGoalPayload } from "./goal-spec";

export const GOAL_MAX = 4000;

// SPEC-407 · `spec` hanya dibaca untuk flow "goal": kondisinya diturunkan dari ISI backlog item,
// bukan dari DoD generik. Opsional supaya seluruh pemanggil lama tetap sah.
export type GoalArgs = {
  flow: Flow; specId: string; branchTo: string;
  spec?: { payload?: unknown; objective?: string };
};
```

Tambahkan helper + cabang di `defaultGoalCondition`:

```ts
// SPEC-407 · kondisi sesi goal. Klausa 2 & 3 bukan hiasan: tanpa baris fase, board tak pernah
// melihat item ini selesai (ADR-0008); tanpa push, hasilnya hilang bersama worktree-nya.
function goalFlowCondition(
  specId: string, branchTo: string, spec?: { payload?: unknown; objective?: string },
): string {
  const g = readGoalPayload(spec?.payload);
  const goal = g?.goal || (spec?.objective ?? "").trim() || "(goal tak tercatat di backlog item)";
  const bukti = g?.done || goal;
  return [
    `Sesi goal hanoman ${specId}. GOAL: ${goal}`,
    "Sesi ini hanya boleh berhenti bila transkrip TERBARU memuat bukti langsung semua hal berikut:",
    `1. goal tercapai — ${bukti};`,
    `2. output \`cat "$HANOMAN_PHASE_FILE"\` yang memuat satu baris untuk SETIAP fase `
      + `${PIPELINES.goal.join(" → ")}, masing-masing berakhiran \`done\` atau \`skipped\`;`,
    `3. output \`git push origin HEAD:refs/heads/${branchTo}\` yang SUKSES sesudah commit terakhir.`,
    "Bila salah satu bukti tak ada di transkrip terbaru, kondisi BELUM terpenuhi: jalankan "
      + "perintah verifikasinya, tuntaskan yang masih kurang, lalu lanjutkan — jangan berhenti.",
  ].join("\n");
}

export function defaultGoalCondition({ flow, specId, branchTo, spec }: GoalArgs): string {
  if (flow === "goal") return goalFlowCondition(specId, branchTo, spec);
  // …isi lama tak berubah…
}
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run runner/test/goal.test.ts`
Expected: PASS — termasuk test SPEC-332/397 lama.

- [x] **Step 5: Commit**

```bash
git add runner/src/goal.ts runner/test/goal.test.ts
git commit -m "feat(407): kondisi Stop hook sesi goal diturunkan dari isi backlog item"
```

---

### Task 4: Peta stage untuk fase `Goal` & `Verifikasi`

**Files:**
- Modify: `server/src/services/session-phases.ts:53-70` (REACHED + stageFor)
- Test: `server/test/session-phases.test.ts`

**Interfaces:**
- Consumes: `PIPELINES.goal` (Task 2).
- Produces: `readPhases(file, "goal")` → dua fase; `stageFor` memetakan `Goal` aktif/tercatat → `executing`, `Verifikasi` tercatat → `done`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/session-phases.test.ts`:

```ts
// SPEC-407 · flow goal: dua fase, dan fase KERJA yang sedang berjalan sudah berarti `executing`.
// Tanpa itu sesi goal yang jalan tampak `brainstorming` — persis fase yang dihapus flow ini.
describe("stage flow goal (SPEC-407)", () => {
  const goalStates = () => readPhases(file, "goal" as any).map((p) => `${p.name}:${p.state}`);

  it("berkas kosong → Goal aktif, Verifikasi pending", () => {
    expect(goalStates()).toEqual(["Goal:active", "Verifikasi:pending"]);
  });

  it("Goal aktif → executing (bukan brainstorming)", () => {
    expect(stageFor(readPhases(file, "goal" as any))).toBe("executing");
  });

  it("Goal done → executing; Verifikasi done → done", () => {
    write("Goal done\n");
    expect(stageFor(readPhases(file, "goal" as any))).toBe("executing");
    write("Goal done\nVerifikasi done\n");
    expect(stageFor(readPhases(file, "goal" as any))).toBe("done");
  });

  it("gerbang plan ADR-0029 tetap berlaku bila sesi goal menulis plan berkotak", () => {
    write("Goal done\nVerifikasi done\n");
    const wt = mkdtempSync(join(tmpdir(), "hanoman-goal-wt-"));
    mkdirSync(join(wt, "docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(wt, "docs/superpowers/plans/spec-407.md"), "- [ ] belum\n");
    expect(stageForRun(readPhases(file, "goal" as any), wt, "SPEC-407")).toBe("executing");
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run server/test/session-phases.test.ts --no-file-parallelism`
Expected: FAIL — `PIPELINES.goal` sudah ada (Task 2) tapi `stageFor` mengembalikan `brainstorming`/`null`.

- [x] **Step 3: Implementasi**

`server/src/services/session-phases.ts`:

```ts
const REACHED: Record<string, Stage> = {
  Objective: "objective", Audit: "objective", Spec: "spec-ready", Plan: "planned",
  Laporan: "done", Execute: "done",
  // SPEC-407 · flow goal (Goal → Verifikasi): fase kerja mencapai `executing`, fase verifikasi
  // yang mencapai `done`. Kedua nama unik lintas PIPELINES — peta ini berkunci nama fase saja.
  Goal: "executing", Verifikasi: "done",
};
export function stageFor(phases: Phase[]): Stage | null {
  let best = -1;
  for (const p of phases) {
    // Fase KERJA yang sedang berjalan sudah berarti `executing` — berlaku untuk `Execute`
    // (feature/qa) maupun `Goal` (SPEC-407, flow tanpa fase perencanaan sama sekali).
    if ((p.name === "Execute" || p.name === "Goal") && p.state === "active")
      best = Math.max(best, STAGES.indexOf("executing"));
    if (p.state !== "done" && p.state !== "skipped") continue;
    const s = REACHED[p.name];
    if (s) best = Math.max(best, STAGES.indexOf(s));
  }
  if (phases[0]?.state === "active") best = Math.max(best, STAGES.indexOf("brainstorming"));
  return best < 0 ? null : STAGES[best]!;
}
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run server/test/session-phases.test.ts --no-file-parallelism`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-phases.ts server/test/session-phases.test.ts
git commit -m "feat(407): stage flow goal — Goal → executing, Verifikasi → done"
```

---

### Task 5: Peluncuran sesi goal (prompt goal + mode goal dipaksa)

**Files:**
- Modify: `server/src/services/session-launch.ts:92-99` (resolusi goal), `:127-149` (pemilihan prompt)
- Test: `server/test/session-launch.test.ts`

**Interfaces:**
- Consumes: `startGoalPrompt` (Task 2), `defaultGoalCondition`/`GoalArgs` (Task 3).
- Produces: `startSpecSession(spec, { flow: "goal" })` melahirkan sesi ber-`--settings` (Stop hook) walau `opts.goal === false`, dengan prompt `startGoalPrompt`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/session-launch.test.ts` (memakai helper `seedRepo`, `argvOf`, `setGoal` yang sudah ada di berkas itu; buat spec bersource `goal` dengan payload goal):

```ts
// SPEC-407 · backlog goal SELALU bermode goal — itulah definisi source-nya. Bukti diambil dari
// argv pane tmux, tempat `--settings` (berisi hook Stop) benar-benar ada.
describe("flow goal (SPEC-407)", () => {
  const goalPayload = { goal: "p95 < 200 ms", done: "output benchmark < 200 ms", constraints: "", priority: "tinggi" };

  async function seedGoalSpec(id: string) {
    const spec = await seedRepo(id);
    return prisma.spec.update({ where: { id: spec.id }, data: { source: "goal", payload: goalPayload, objective: goalPayload.goal } });
  }

  it("mode goal menyala walau opts.goal false dan Setting global mati", async () => {
    await setGoal({ enabled: false, condition: "" });
    const spec = await seedGoalSpec("SPEC-407");
    const { id } = await startSpecSession(spec, { flow: "goal", goal: false });
    const argv = await argvOf(id);
    expect(argv).toContain("--settings");
    expect(argv).toContain("p95 < 200 ms");
    killSession(id);
  });

  it("template global TIDAK menimpa goal item", async () => {
    await setGoal({ enabled: true, condition: "TEMPLATE-GLOBAL" });
    const spec = await seedGoalSpec("SPEC-408");
    const { id } = await startSpecSession(spec, { flow: "goal" });
    const argv = await argvOf(id);
    expect(argv).not.toContain("TEMPLATE-GLOBAL");
    expect(argv).toContain("p95 < 200 ms");
    killSession(id);
  });

  it("override per-sesi tetap menang", async () => {
    await setGoal({ enabled: false, condition: "" });
    const spec = await seedGoalSpec("SPEC-409");
    const { id } = await startSpecSession(spec, { flow: "goal", goalCondition: "KONDISI-SESI" });
    expect(await argvOf(id)).toContain("KONDISI-SESI");
    killSession(id);
  });

  it("prompt-nya prompt goal, bukan pipeline perencanaan", async () => {
    const spec = await seedGoalSpec("SPEC-410");
    const { id } = await startSpecSession(spec, { flow: "goal" });
    const argv = await argvOf(id);
    expect(argv).toContain("Kerjakan fase berurutan: Goal → Verifikasi");
    expect(argv).not.toContain("Kerjakan fase berurutan: Brainstorm");
    killSession(id);
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run server/test/session-launch.test.ts --no-file-parallelism`
Expected: FAIL — sesi lahir tanpa `--settings` saat `goal: false`, dan prompt-nya `startPrompt`.

- [x] **Step 3: Implementasi `server/src/services/session-launch.ts`**

Impor `startGoalPrompt` dari `@hanoman/runner`. Ganti blok resolusi goal:

```ts
  // SPEC-332 · ADR-0073 · kondisi goal: override sesi → template global → default DoD bawaan.
  // SPEC-407 · flow goal adalah pengecualiannya: mode goal SELALU menyala (opts.goal tak bisa
  // mematikannya — backlog goal tanpa Stop hook cuma backlog biasa berprompt lain), dan template
  // global DILEWATI karena item membawa kondisinya sendiri; yang lebih spesifik harus menang.
  const goalArgs = {
    flow: opts.flow, specId: spec.id, branchTo,
    spec: { payload: spec.payload ?? undefined, objective: spec.objective },
  };
  const isGoalFlow = opts.flow === "goal";
  const goalOn = isGoalFlow || (opts.goal ?? setting.goal.enabled);
  const goal = goalOn
    ? resolveGoalCondition(goalArgs, opts.goalCondition, isGoalFlow ? null : setting.goal.condition)
    : undefined;
```

Ekstrak pembangunan `ResumeCtx` supaya bisa dipakai dua cabang prompt — tambahkan helper di module scope:

```ts
// SPEC-394 · fase yang sudah tercatat hidup DI LUAR worktree (session-phases.ts) dan tak ikut
// ter-checkout, jadi agen tak punya cara lain mengetahuinya selain diberi tahu di prompt.
function buildResumeCtx(repoDir: string, id: string, flow: Flow, worktreeKept: boolean): ResumeCtx {
  const phases = readPhases(phaseFilePath(repoDir, id), flow);
  return {
    recorded: phases.filter((p) => p.state === "done" || p.state === "skipped")
      .map((p) => `${p.name} ${p.state}`),
    next: phases.find((p) => p.state === "active")?.name,
    worktreeKept,
  };
}
```

lalu ganti blok pemilihan prompt:

```ts
  const resumeCtx = resume ? buildResumeCtx(repoDir, id, opts.flow, resume.worktreeKept) : undefined;
  let prompt: string;
  if (isGoalFlow) {
    // SPEC-407 · satu builder untuk ketiga keadaan: `continuePrompt`/`resumePrompt` bicara plan
    // berkotak & fase perencanaan, dan sesi goal tak punya keduanya.
    prompt = startGoalPrompt(brief, branchTo, { autonomy: opts.autonomy, verifyScope, resume: resumeCtx });
  } else if (isContinue) {
    prompt = continuePrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope);
  } else if (resumeCtx) {
    prompt = resumePrompt(opts.flow, brief, branchTo, resumeCtx, opts.autonomy, verifyScope);
  } else {
    prompt = startPrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope);
  }
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run server/test/session-launch.test.ts server/test/session-resume.test.ts --no-file-parallelism`
Expected: PASS — termasuk test resume SPEC-394 yang tak boleh bergeser.

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-launch.ts server/test/session-launch.test.ts
git commit -m "feat(407): sesi flow goal — prompt goal + mode goal dipaksa, template global dilewati"
```

---

### Task 6: Derivasi objective & author untuk source `goal`

**Files:**
- Modify: `server/src/routes/specs.ts:34-42` (deriveSpecFields), `:96-100` (author)
- Test: `server/test/specs.route.test.ts`

**Interfaces:**
- Consumes: `zCreateSpec` tiga-arah (Task 1).
- Produces: `POST /specs { source: "goal" }` → `objective === payload.goal`, `author` berprefix `Goal · `.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/specs.route.test.ts` (ikuti pola test POST /specs yang sudah ada di berkas itu — `app.inject({ method: "POST", url: "/api/specs", payload: … })`):

```ts
// SPEC-407 · backlog goal: objective ADALAH goal-nya (itulah yang dibaca prompt & kondisi Stop).
it("POST /specs source goal menurunkan objective dari payload.goal", async () => {
  const r = await app.inject({ method: "POST", url: "/api/specs", payload: {
    project: "p1", source: "goal", title: "Turunkan latensi", priority: "tinggi",
    payload: { goal: "p95 /api/specs < 200 ms", done: "benchmark", constraints: "", priority: "tinggi" },
  } });
  expect(r.statusCode).toBe(201);
  const spec = r.json();
  expect(spec.source).toBe("goal");
  expect(spec.objective).toBe("p95 /api/specs < 200 ms");
  expect(spec.author).toMatch(/^Goal · /);
  expect(spec.stage).toBe("brainstorming");
});

it("POST /specs source goal menolak payload brief", async () => {
  const r = await app.inject({ method: "POST", url: "/api/specs", payload: {
    project: "p1", source: "goal", title: "t", priority: "tinggi",
    payload: { context: "c", outcome: "o", constraints: "", priority: "tinggi" },
  } });
  expect(r.statusCode).toBe(400);
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run server/test/specs.route.test.ts --no-file-parallelism`
Expected: FAIL — `objective` kosong dan `author` tanpa prefix.

- [x] **Step 3: Implementasi `server/src/routes/specs.ts`**

```ts
function deriveSpecFields(source: string, payload: any, manualPriority: string) {
  // SPEC-407 · backlog goal: objective ADALAH goal-nya. Prioritas tetap manual — tak ada
  // severity untuk diturunkan, dan operator yang tahu seberapa mendesak goal itu.
  if (source === "goal")
    return {
      priority: manualPriority,
      objective: (payload && typeof payload.goal === "string" && payload.goal.trim())
        || (payload && typeof payload.done === "string" && payload.done.trim())
        || "— goal belum diisi.",
    };
  const isQa = source === "qa";
  // …sisanya tak berubah…
}
```

dan pada blok `author`:

```ts
            author: isQa ? `QA · ${author}`
              : b.source === "audit" ? `Audit · ${author}`
              : b.source === "cross-audit" ? `Audit lintas · ${author}`
              // SPEC-407 · asal item goal terbaca di backlog (cermin `Audit ·`).
              : b.source === "goal" ? `Goal · ${author}`
              : author,
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run server/test/specs.route.test.ts --no-file-parallelism`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/specs.ts server/test/specs.route.test.ts
git commit -m "feat(407): POST/PATCH /specs menurunkan objective & author untuk source goal"
```

---

### Task 7: Modal backlog baru — tab Goal

**Files:**
- Modify: `src/src/App.tsx:36-42` (SpecForm/SpecPrefill), `:185-244` (NewSpecModal), `:901-921` (createSpec)
- Test: `src/test/backlog-goal.test.tsx` (baru)

**Interfaces:**
- Consumes: `zCreateSpec` tiga-arah (Task 1).
- Produces: `NewSpecModal` ter-ekspor dari `src/src/App.tsx`; `SpecForm` bertambah `goal: string; done: string`; `SpecPrefill` bertambah `goal?: string; done?: string`; `api.createSpec` menerima `{ source: "goal", payload: { goal, done, constraints, priority } }`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/backlog-goal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })) },
  ApiError: class extends Error {},
}));

import { NewSpecModal } from "../src/App";

const projects = [{ id: "p1", name: "P1" }] as any;
beforeEach(() => vi.clearAllMocks());

describe("NewSpecModal · tab Goal (SPEC-407)", () => {
  it("mengirim payload goal, bukan payload brief", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Goal"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Turunkan latensi" } });
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "p95 < 200 ms" } });
    fireEvent.change(screen.getByLabelText("Selesai bila"), { target: { value: "benchmark < 200 ms" } });
    fireEvent.click(screen.getByText("Buat goal → sesi goal"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      kind: "goal", title: "Turunkan latensi", goal: "p95 < 200 ms", done: "benchmark < 200 ms",
    })));
  });

  it("goal kosong tak bisa disubmit", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Goal"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "t" } });
    fireEvent.click(screen.getByText("Buat goal → sesi goal"));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("prefill kind goal (dari PRD) membuka tab Goal dengan goal terisi", async () => {
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={() => {}}
      prefill={{ project: "p1", kind: "goal", title: "Jadwal Invoice", goal: "Wujudkan PRD docs/prd/jadwal-invoice.md" }} />);
    await waitFor(() => expect((screen.getByLabelText("Goal") as HTMLTextAreaElement).value)
      .toBe("Wujudkan PRD docs/prd/jadwal-invoice.md"));
  });
});
```

Catatan implementasi untuk `getByLabelText`: `Field` di DS ini merender label sebagai teks, jadi pakai `aria-label` eksplisit pada `Input`/`HnTextarea` goal (`aria-label="Goal"`, `aria-label="Selesai bila"`, `aria-label="Judul"`) — pola yang sama sudah dipakai `StartSessionModal` (`aria-label="Model"`). Bila `Judul` yang sudah ada belum punya `aria-label`, tambahkan.

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run src/test/backlog-goal.test.tsx`
Expected: FAIL — `NewSpecModal` tak ter-ekspor.

- [x] **Step 3: Implementasi `src/src/App.tsx`**

Tipe (baris ~36):

```ts
type SpecForm = { kind: string; project: string; title: string; context: string; outcome: string; constraints: string;
  priority: string; severity: string; steps: string; expected: string; actual: string; env: string;
  branchFrom: string; fromAudit: string;
  // SPEC-407 · backlog goal
  goal: string; done: string };
```

`SpecPrefill` (baris ~41) tambahkan `goal?: string; done?: string;`.

`NewSpecModal`: ubah `function NewSpecModal(` → `export function NewSpecModal(`; `blank` tambahkan `goal: prefill?.goal ?? "", done: prefill?.done ?? ""`; tambahkan `const isGoal = f.kind === "goal";`; tab keempat:

```tsx
          { value: "goal", label: "Goal", icon: "target" },
```

judul/ikon/footer memperhitungkan `isGoal` (ikon `target`, judul "Goal baru", tombol "Buat goal → sesi goal"), kalimat penjelas:

```tsx
: isGoal ? "Sesi goal langsung mengejar goal-nya — tanpa brainstorm, spec, atau plan (fase: Goal → Verifikasi). Sesi lahir dengan mode goal aktif dan menolak berhenti sampai buktinya ada di transkrip."
```

field khusus goal (menggantikan blok brief saat `isGoal`):

```tsx
      {isGoal && (
        <>
          <Field label="Goal" hint="Keadaan yang harus tercapai — ini yang dikejar sesi sampai terbukti">
            <HnTextarea aria-label="Goal" value={f.goal} onChange={set("goal")} rows={3}
              placeholder="mis. p95 GET /api/specs di bawah 200 ms" />
          </Field>
          <Field label="Selesai bila" hint="Bukti yang harus muncul di transkrip; kosongkan bila goal-nya sudah jadi buktinya sendiri">
            <HnTextarea aria-label="Selesai bila" value={f.done} onChange={set("done")} rows={2}
              placeholder="mis. output benchmark menunjukkan < 200 ms" />
          </Field>
          <Field label="Batasan">
            <HnTextarea aria-label="Batasan" value={f.constraints} onChange={set("constraints")} rows={2}
              placeholder="mis. tanpa cache eksternal" />
          </Field>
        </>
      )}
```

`submit` menuntut goal terisi:

```tsx
  const submit = () => {
    if (!f.title.trim()) return;
    if (isGoal && !f.goal.trim()) return;   // SPEC-407 · objective diturunkan dari goal
    onCreate(f);
  };
```

`createSpec` (baris ~901):

```ts
    const isGoal = f.kind === "goal";
    const payload = isQa
      ? { severity: f.severity, steps: f.steps, expected: f.expected, actual: f.actual, env: f.env,
          ...(f.fromAudit ? { fromAudit: f.fromAudit } : {}) }
      // SPEC-407 · backlog goal: bentuk payload-nya sendiri (zGoalPayload) — server mengikat
      // source ↔ bentuk payload, jadi mengirim bentuk brief di sini akan ditolak 400.
      : isGoal
      ? { goal: f.goal.trim(), done: f.done, constraints: f.constraints, priority: f.priority }
      : { context: f.context, outcome: f.outcome, constraints: f.constraints, priority: f.priority,
          ...(f.fromAudit ? { fromAudit: f.fromAudit } : {}) };
```

dan toast:

```ts
      const toastMsg = f.kind === "audit" ? " dibuat · audit-only (dokumen)"
        : isGoal ? " dibuat · sesi goal (Goal → Verifikasi)"
        : isQa ? " difilekan · masuk audit" : " dibuat · masuk brainstorm";
      showToast(created.id + toastMsg, "ok",
        f.kind === "audit" ? "search" : isGoal ? "target" : isQa ? "bug" : "lightbulb");
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run src/test/backlog-goal.test.tsx src/test/app-flows.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/App.tsx src/test/backlog-goal.test.tsx
git commit -m "feat(407): tab Goal di modal backlog baru + payload goal"
```

---

### Task 8: Tampilan backlog untuk source `goal`

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx:29-38` (SOURCE_META), `:73-79` (peta field), `:126-176` (form edit), `:176-182` (pilihan field detail)
- Test: `src/test/backlog-goal.test.tsx` (lanjutan Task 7)

**Interfaces:**
- Consumes: spec bersource `goal` berpayload `{goal, done, constraints, priority}`.
- Produces: badge "Goal" + detail yang menampilkan Goal / Selesai bila / Batasan; form edit inline memakai field yang sama.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/backlog-goal.test.tsx`:

```tsx
import { BacklogScreen } from "../src/screens/BacklogScreen";

const goalSpec: any = {
  id: "SPEC-407", projectId: "p1", title: "Turunkan latensi", source: "goal", stage: "executing",
  priority: "tinggi", author: "Goal · a@b.c", objective: "p95 < 200 ms",
  payload: { goal: "p95 < 200 ms", done: "benchmark < 200 ms", constraints: "tanpa cache", priority: "tinggi" },
  branchFrom: null, baseSha: null,
};

describe("BacklogScreen · item goal (SPEC-407)", () => {
  it("badge Goal muncul dan detail mengeja goal + selesai bila", async () => {
    render(<BacklogScreen specs={[goalSpec]} projects={projects} />);
    expect(await screen.findByText("Goal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Turunkan latensi"));
    await waitFor(() => expect(screen.getByText("Selesai bila")).toBeInTheDocument());
    expect(screen.getByText("benchmark < 200 ms")).toBeInTheDocument();
    expect(screen.getByText("tanpa cache")).toBeInTheDocument();
  });
});
```

Sebelum menulis, periksa prop wajib `BacklogScreen` dengan `grep -n "export function BacklogScreen" -A 20 src/src/screens/BacklogScreen.tsx` dan tiru pemanggilan di `src/test/backlog-board.test.tsx`; lengkapi prop yang wajib.

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run src/test/backlog-goal.test.tsx`
Expected: FAIL — badge berlabel "feature brief" (fallback SOURCE_META) dan field goal tak dirender.

- [x] **Step 3: Implementasi `src/src/screens/BacklogScreen.tsx`**

```ts
  // SPEC-407 · backlog goal: sesi dua fase (Goal → Verifikasi), tanpa fase perencanaan.
  goal:  { label: "Goal",          icon: "target",    tone: "brass", color: "var(--brass-600)" },
```

peta field:

```ts
const GOAL_FIELDS = [
  ["goal", "Goal"], ["done", "Selesai bila"], ["constraints", "Batasan"],
] as const;
```

pemilihan field di `SpecDetail` (menggantikan `const fields = qa ? QA_FIELDS : BRIEF_FIELDS;`):

```ts
  const isGoal = spec.source === "goal";
  const fields = qa ? QA_FIELDS : isGoal ? GOAL_FIELDS : BRIEF_FIELDS;
```

Periksa juga blok form edit inline (`editing`) — bila ia mengiterasi `fields`, tak ada perubahan lain yang perlu; bila ia menyebut `BRIEF_FIELDS`/`QA_FIELDS` langsung, ganti ke `fields`.

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run src/test/backlog-goal.test.tsx src/test/backlog-board.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/test/backlog-goal.test.tsx
git commit -m "feat(407): backlog menampilkan item goal (badge, detail, edit)"
```

---

### Task 9: Picker Start mengunci mode goal untuk item goal

**Files:**
- Modify: `src/src/App.tsx:62-119` (StartSessionModal — effect prefill, `start()`, render Field "Mode goal")
- Test: `src/test/start-session-goal.test.tsx`

**Interfaces:**
- Consumes: `flowForSource` (Task 1).
- Produces: untuk `spec.source === "goal"` picker mengirim `{ flow: "goal", goal: true }` dan `goalCondition: undefined` selama operator tak mengetik kondisi sendiri.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/start-session-goal.test.tsx`:

```tsx
// SPEC-407 · backlog goal selalu bermode goal — switch-nya terkunci, dan template global TIDAK
// boleh ikut terkirim sebagai override (server menurunkan kondisi dari item).
describe("StartSessionModal · spec bersource goal (SPEC-407)", () => {
  const goalSpec: any = { id: "SPEC-407", source: "goal", title: "t", stage: "planned" };

  it("switch terkunci aktif dan kondisi global tak ikut terkirim", async () => {
    render(<StartSessionModal open spec={goalSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByDisplayValue("TEMPLATE-GLOBAL")).toBeNull();
    fireEvent.click(screen.getByRole("switch"));    // klik tak boleh mematikannya
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-407", flow: "goal", goal: true, goalCondition: undefined })));
  });

  it("kondisi yang diketik operator tetap menang", async () => {
    render(<StartSessionModal open spec={goalSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "KONDISI-SESI" } });
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ goalCondition: "KONDISI-SESI" })));
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run src/test/start-session-goal.test.tsx`
Expected: FAIL — kondisi global ikut terkirim, dan switch bisa dimatikan.

- [x] **Step 3: Implementasi `src/src/App.tsx` (StartSessionModal)**

Di dalam effect prefill (`api.getSettings().then(...)`):

```ts
      // SPEC-407 · backlog goal membawa kondisinya sendiri (server menurunkannya dari item) —
      // jangan menimpanya dengan template global lewat override per-sesi, dan jangan biarkan
      // mode goal-nya bisa dimatikan: itulah yang membedakan source ini dari brief.
      const locked = !!spec && flowForSource(spec.source) === "goal";
      setGoalOn(locked || s.goal.enabled);
      setGoalCond(locked ? "" : s.goal.condition);
```

dan tambahkan `spec` ke dependency array effect (`}, [open, spec]);`).

Di badan komponen, sesudah `const flow = flowForSource(s.source);`:

```ts
  const goalLocked = flow === "goal";   // SPEC-407
```

Render Field "Mode goal":

```tsx
      <Field label="Mode goal"
        hint={goalLocked
          ? "Backlog goal selalu berjalan dalam mode goal — sesi menolak berhenti sampai goal item ini terbukti tercapai. Kosongkan kondisi untuk memakai goal item apa adanya."
          : "Sesi menolak berhenti sampai kondisinya terbukti. Kosongkan kondisi untuk memakai bawaan hanoman: semua fase tercatat, plan tak menyisakan task, push sukses."}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: goalOn ? 10 : 0 }}>
          <Switch aria-label="Mode goal" checked={goalOn} disabled={goalLocked}
            onChange={(v: boolean) => { if (!goalLocked) setGoalOn(v); }} />
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {goalLocked ? "aktif · terkunci" : goalOn ? "aktif" : "nonaktif"}
          </span>
        </div>
        {goalOn && <HnTextarea value={goalCond} rows={4} mono
          placeholder={goalLocked ? "Kosong = goal backlog item ini" : "Kosong = kondisi bawaan hanoman"}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGoalCond(e.target.value)} />}
      </Field>
```

`start()` tak perlu diubah — ia sudah mengirim `goal: goalOn` dan `goalCondition` hanya bila terisi.

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run src/test/start-session-goal.test.tsx src/test/start-session-model.test.tsx src/test/start-session-agent.test.tsx src/test/start-session-verify-scope.test.tsx`
Expected: PASS — test mode goal SPEC-332 lama tak boleh bergeser (spec-nya bersource `brief`).

- [x] **Step 5: Commit**

```bash
git add src/src/App.tsx src/test/start-session-goal.test.tsx
git commit -m "feat(407): picker Start mengunci mode goal untuk backlog bersource goal"
```

---

### Task 10: PRD → pilihan "sebagai brief" / "sebagai goal"

**Files:**
- Modify: `src/src/screens/PrdScreen.tsx:17` (PrdPrefill), `:101-120` (aksi preview + modal pemilih)
- Test: `src/test/prd-screen.test.tsx`

**Interfaces:**
- Consumes: `SpecPrefill.kind`/`goal` (Task 7).
- Produces: `PrdPrefill` bertambah `kind?: "brief" | "goal"; goal?: string`; klik "Take ke backlog" membuka pemilih, tiap pilihan memanggil `onTake` dengan `kind` yang sesuai dan `branchFrom = prdBranchOf(path)`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/prd-screen.test.tsx`:

```tsx
// SPEC-407 · satu PRD punya dua jalur ke backlog. Pilihannya eksplisit — keduanya mengubah
// bentuk kerja sesi, bukan sekadar label.
it("Take ke backlog menawarkan brief atau goal", async () => {
  const onTake = vi.fn();
  render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={onTake} />);
  fireEvent.click(await screen.findByText("Jadwal Invoice"));
  fireEvent.click(await screen.findByText("Take ke backlog"));
  fireEvent.click(await screen.findByText("Sebagai goal"));
  await waitFor(() => expect(onTake).toHaveBeenCalledWith(expect.objectContaining({
    kind: "goal", project: "p1", title: "Jadwal Invoice",
    goal: expect.stringContaining("docs/prd/jadwal-invoice.md"),
    branchFrom: "prd/jadwal-invoice",
  })));
});

it("pilihan brief mempertahankan perilaku lama", async () => {
  const onTake = vi.fn();
  render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={onTake} />);
  fireEvent.click(await screen.findByText("Jadwal Invoice"));
  fireEvent.click(await screen.findByText("Take ke backlog"));
  fireEvent.click(await screen.findByText("Sebagai feature brief"));
  await waitFor(() => expect(onTake).toHaveBeenCalledWith(expect.objectContaining({
    kind: "brief", context: "Dari PRD: docs/prd/jadwal-invoice.md", prdPath: "docs/prd/jadwal-invoice.md",
  })));
});
```

Verifikasi nilai `branchFrom` yang benar dengan membaca `prdBranchOf` di `src/src/screens/PrdScreen.tsx` sebelum menulis assertion-nya.

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `pnpm vitest --run src/test/prd-screen.test.tsx`
Expected: FAIL — "Sebagai goal" tak ada; klik "Take ke backlog" langsung memanggil `onTake`.

- [x] **Step 3: Implementasi `src/src/screens/PrdScreen.tsx`**

```ts
// SPEC-407 · `kind` memilih bentuk backlog-nya: brief (brainstorm → … → execute) atau goal
// (sesi dua fase yang langsung mengejar goal). `goal` hanya terisi untuk kind goal.
export type PrdPrefill = {
  project: string; title: string; context: string; outcome: string; prdPath: string; branchFrom: string;
  kind?: "brief" | "goal"; goal?: string;
};
```

Di `PrdPreviewPane`, tambahkan state + ganti tombol:

```tsx
  const [takeOpen, setTakeOpen] = React.useState(false);
  const takeBase = { project: projectId, title: prd.title, prdPath: prd.path, branchFrom: prdBranchOf(prd.path) };
```

```tsx
          <Button size="sm" variant="ghost" leftIcon="list-checks" onClick={() => setTakeOpen(true)}>
            Take ke backlog
          </Button>
```

dan modal pemilih (letakkan di akhir JSX pane, sebelum penutup `</div>` terluar):

```tsx
      {/* SPEC-407 · dua jalur PRD → backlog. Dipisah eksplisit karena keduanya melahirkan sesi
          berbentuk beda: brief menjalankan pipeline perencanaan, goal langsung mengejar goal. */}
      <Modal open={takeOpen} onClose={() => setTakeOpen(false)} icon="list-checks"
        eyebrow="PRD → backlog" title="Take PRD ke backlog"
        footer={<Button variant="ghost" size="sm" onClick={() => setTakeOpen(false)}>Batal</Button>}>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <Button leftIcon="lightbulb" onClick={() => {
              setTakeOpen(false);
              onTake({ ...takeBase, kind: "brief", context: `Dari PRD: ${prd.path}`, outcome: "" });
            }}>Sebagai feature brief</Button>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
              Sesi menjalankan pipeline penuh: brainstorm → objective → spec → plan → execute.
            </div>
          </div>
          <div>
            <Button leftIcon="target" variant="secondary" onClick={() => {
              setTakeOpen(false);
              onTake({ ...takeBase, kind: "goal", context: "", outcome: "",
                goal: `Wujudkan PRD ${prd.path}` });
            }}>Sebagai goal</Button>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
              Sesi dua fase (Goal → Verifikasi) yang langsung mengejar goal-nya, tanpa brainstorm,
              spec, maupun plan. Mode goal selalu aktif.
            </div>
          </div>
        </div>
      </Modal>
```

Impor `Modal` dari `../ds` bila belum diimpor di berkas itu.

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `pnpm vitest --run src/test/prd-screen.test.tsx`
Expected: PASS — termasuk test breakdown SPEC-273 yang tak boleh bergeser.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/PrdScreen.tsx src/test/prd-screen.test.tsx
git commit -m "feat(407): PRD → backlog jadi pilihan (feature brief atau goal)"
```

---

### Task 11: Docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0089-backlog-goal-flow-dua-fase.md`
- Modify: `internal/docs/README.md` (daftar ADR satu baris + kategori adr), `internal/docs/adr/README.md` (narasi), `internal/docs/architecture/api-contract.md` (enum source & flow + payload), `internal/docs/architecture/data-model.md` (bentuk `Spec.payload`), `internal/skills/hanoman/SKILL.md` (butir sesi & eksekusi)

**Interfaces:**
- Consumes: seluruh keputusan Task 1–10.
- Produces: ADR-0089 ter-link di dua index (syarat SPEC-386).

- [x] **Step 1: Pastikan nomor ADR masih bebas**

Run:
```bash
git log --all --oneline --name-only -- 'internal/docs/adr/*' | grep -o 'adr/00[0-9][0-9]' | sort -u | tail -3
ls internal/docs/adr | tail -3
```
Expected: tertinggi `0088`. Bila sudah ada 0089 di branch lain, pakai nomor bebas berikutnya dan sesuaikan seluruh rujukan di plan ini.

- [x] **Step 2: Tulis ADR-0089**

Buat `internal/docs/adr/0089-backlog-goal-flow-dua-fase.md` mengikuti bentuk ADR tetangganya (baca `internal/docs/adr/0085-mode-goal-codex-native.md` sebagai contoh bentuk: judul, Status, Konteks, Keputusan, Konsekuensi, Alternatif ditolak). Isi wajib:
- Konteks: mode goal (ADR-0073) selama ini knob di atas pipeline `feature`, jadi sesi goal tetap menjalankan Brainstorm→Execute.
- Keputusan: source `goal` + flow `goal` = `["Goal","Verifikasi"]`; payload `zGoalPayload`; mode goal dipaksa aktif dengan kondisi dari item (template global dilewati, override per-sesi tetap menang); `Goal` aktif/tercatat → `executing`, `Verifikasi` → `done`; klausa scope verifikasi ikut karena flow goal menulis kode meski tanpa fase `Execute`.
- Konsekuensi: tanpa migration/endpoint baru; gerbang plan ADR-0029 tetap berlaku bila plan ditulis; ADR-0037 utuh (Stop hook, bukan deny); dua pintu masuk (modal backlog & PRD).
- Alternatif ditolak: (a) reuse payload brief — konvensi tersembunyi di kolom Json; (b) sesi goal tanpa fase sama sekali — board buta terhadap sesi berjalan; (c) satu fase saja — pintu keluar tak punya tempat untuk dibuktikan.

- [x] **Step 3: Tautkan di kedua index**

`internal/docs/README.md` — di bagian `## adr`, baris pertama daftar:

```markdown
- [0089 — Backlog goal: source & flow `goal` dua fase, mode goal dipaksa dengan kondisi dari item](adr/0089-backlog-goal-flow-dua-fase.md)
```

`internal/docs/adr/README.md` — tambahkan narasinya di posisi paling atas daftar (ikuti bentuk entri 0088 di berkas itu).

- [x] **Step 4: Perbarui doc arsitektur & skill**

- `internal/docs/architecture/api-contract.md`: pada bagian yang menyebut enum `source` dan `flow` serta bentuk payload `POST /specs`, tambahkan `goal` + bentuk `{goal, done, constraints, priority}` dan catatan bahwa `POST /terminal/sessions` menerima `flow: "goal"`. Temukan tempatnya dengan `grep -n "cross-audit" internal/docs/architecture/api-contract.md`.
- `internal/docs/architecture/data-model.md`: pada penjelasan `Spec.payload`, tambahkan varian ketiga. Temukan dengan `grep -n "payload" internal/docs/architecture/data-model.md`.
- `internal/skills/hanoman/SKILL.md`: tambahkan butir di "Aturan Sesi & Eksekusi" (sesudah butir mode goal SPEC-397) yang merangkum SPEC-407 + ADR-0089, termasuk gotcha "flow goal menulis kode meski tanpa fase Execute → `scopeClause` memakai predikat `writesCode`, bukan kehadiran fase `Execute`" dan "template global goal DILEWATI untuk flow goal".

- [x] **Step 5: Verifikasi integritas index & commit**

Run: `node cli/dist/hanoman.js docs index --check` (bila `cli/dist` belum terbangun, lewati dan cukup pastikan tautan relatifnya benar dengan `ls internal/docs/adr/0089-backlog-goal-flow-dua-fase.md`).

```bash
git add internal/docs internal/skills
git commit -m "docs(407): ADR-0089 + index/sub-index + api-contract/data-model + skill"
```

---

### Task 12: Verifikasi akhir (scope `changed`) + smoke endpoint

**Files:** —

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: bukti hijau untuk berkas yang berubah + bukti nyata `POST /specs` & `POST /terminal/sessions` bekerja untuk source/flow goal.

- [x] **Step 1: Typecheck paket yang tersentuh (satu per satu, jangan `-r`)**

```bash
pnpm --filter ./shared typecheck
pnpm --filter ./runner typecheck
pnpm --filter ./server typecheck
pnpm --filter ./src typecheck
```
Expected: exit 0 semua.

- [x] **Step 2: Jalankan set test yang berubah — WAJIB serial**

```bash
pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: PASS. Jangan menerima "no test files" sebagai bukti (`--changed` menyalakan `passWithNoTests`) — pastikan berkas test SPEC-407 memang ikut berjalan di daftar yang tercetak.

- [x] **Step 3: Smoke endpoint nyata (task ini menyentuh endpoint)**

Boot server di port yang tak dipakai sesi lain, lalu:

```bash
# 1. buat backlog goal
curl -s -X POST localhost:<port>/api/specs -H 'content-type: application/json' \
  -d '{"project":"<p>","source":"goal","title":"Smoke goal","priority":"tinggi",
       "payload":{"goal":"smoke goal tercapai","done":"","constraints":"","priority":"tinggi"}}'
# harapkan 201, objective === "smoke goal tercapai", author berprefix "Goal · "

# 2. payload salah bentuk ditolak
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:<port>/api/specs \
  -H 'content-type: application/json' \
  -d '{"project":"<p>","source":"goal","title":"t","priority":"tinggi",
       "payload":{"context":"c","outcome":"o","constraints":"","priority":"tinggi"}}'
# harapkan 400
```

Matikan server per-PID (`lsof -ti:<port>` → `kill <pid>`), **jangan** `pkill -f`.

- [x] **Step 4: Pastikan diff bersih & seluruh kotak plan ini tercentang**

```bash
git status --porcelain
grep -n -- "- \[ \]" docs/superpowers/plans/2026-07-31-backlog-goal-spec-407.md
```
Expected: `git status` bersih; grep tak menghasilkan baris (`- [ ]` habis).

- [x] **Step 5: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-407
```
