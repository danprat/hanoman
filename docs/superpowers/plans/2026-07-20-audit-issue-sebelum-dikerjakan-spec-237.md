# Audit issue sebelum dikerjakan (SPEC-237) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan source+flow backlog `audit` yang hanya menghasilkan dokumen audit (tanpa perbaikan kode), punya aksi terminal identik dengan brief/qa, dan bisa dipromosikan menjadi Finding QA.

**Architecture:** `audit` adalah `Spec.source` baru yang dipetakan ke `flow: "audit"` dengan pipeline `["Audit","Laporan"]` yang berhenti di dokumen SoT. Karena audit adalah Spec biasa (punya `specId`), aksi terminal (preview docs/review/merge/fullscreen) dan endpoint review/integrate warisan gratis. `source`/`flow` = `String` + zod → tanpa migration (ADR-0057).

**Tech Stack:** TypeScript strict, zod (`@hanoman/shared`), Fastify + Prisma (server), React (frontend), Vitest. Runner = library prompt-builder.

## Global Constraints

- `source`/`flow` disimpan sebagai `String` + divalidasi zod — **JANGAN** ubah skema Prisma / tambah migration (data-model.md, ADR-0057).
- ADR baru = **0057** (sibling worktree sudah pakai 0055/0056; enumerasi ADR-0021).
- Dokumen audit SoT = `internal/docs/research/audit-<spec-id>-<slug>.md`, tautkan di `internal/docs/README.md`.
- Test repo dijalankan dengan `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism <path>` (hindari env prod bocor; memory hanoman-shell-env-points-at-prod).
- Perbarui docs SoT yang tersentuh **dalam commit yang sama**.
- Nama fase ditulis apa adanya: `Audit`, `Laporan`. `Laporan` harus unik lintas semua `PIPELINES`.

---

### Task 1: shared — source `audit`, flow `audit`, helper `flowForSource`

**Files:**
- Modify: `shared/src/enums.ts:3`
- Modify: `shared/src/dto.ts:78` (zFlow) + tambah `flowForSource`
- Test: `shared/test/enums.test.ts`, `shared/test/dto.test.ts`

**Interfaces:**
- Produces: `zSpecSource` menerima `"audit"`; `zFlow` menerima `"audit"`; `flowForSource(source: string): FlowName` (`"qa"→"qa"`, `"audit"→"audit"`, selain itu `"feature"`), diekspor dari `@hanoman/shared`.

- [x] **Step 1: Tulis test yang gagal (enums + flowForSource)**

Tambah di `shared/test/enums.test.ts` (setelah blok describe yang ada):
```ts
import { zSpecSource } from "../src/enums";
import { flowForSource } from "../src/dto";

describe("SPEC-237 · source audit", () => {
  it("zSpecSource menerima brief, qa, audit", () => {
    for (const s of ["brief", "qa", "audit"]) expect(zSpecSource.safeParse(s).success).toBe(true);
    expect(zSpecSource.safeParse("hantu").success).toBe(false);
  });
  it("flowForSource memetakan source → flow", () => {
    expect(flowForSource("brief")).toBe("feature");
    expect(flowForSource("qa")).toBe("qa");
    expect(flowForSource("audit")).toBe("audit");
    expect(flowForSource("apapun")).toBe("feature");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run test/enums.test.ts`
Expected: FAIL (`flowForSource` belum ada / `audit` ditolak).

- [x] **Step 3: Implementasi**

`shared/src/enums.ts:3` ganti jadi:
```ts
export const zSpecSource = z.enum(["brief","qa","audit"]);
```

`shared/src/dto.ts:78` ganti `zFlow` + tambah helper tepat di bawahnya:
```ts
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd", "audit"]);
export type FlowName = z.infer<typeof zFlow>;
// SPEC-237 · satu-satunya pemetaan source → flow (client memakainya saat start sesi).
// qa → audit → execute perbaikan; audit → dokumen saja (stop, tanpa Execute).
export function flowForSource(source: string): FlowName {
  return source === "qa" ? "qa" : source === "audit" ? "audit" : "feature";
}
```

- [x] **Step 4: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run test/enums.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/enums.ts shared/src/dto.ts shared/test/enums.test.ts
git commit -m "feat(shared): source+flow audit + flowForSource — SPEC-237"
```

---

### Task 2: runner — Flow `audit`, pipeline, klausa audit-only

**Files:**
- Modify: `runner/src/types.ts:1` (Flow)
- Modify: `runner/src/prompt.ts:4-10` (PIPELINES), `:82-96` (startPrompt), tambah `auditOnlyInstruction`
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `Flow` (Task-lokal), `PIPELINES` (session-phases Task 3 mengindeks `PIPELINES.audit`).
- Produces: `PIPELINES.audit = ["Audit","Laporan"]`; `startPrompt("audit", …)` memuat instruksi "investigasi saja, tulis dokumen audit, jangan perbaiki".

- [x] **Step 1: Tulis test yang gagal**

Tambah di `runner/test/prompt.test.ts` (dalam `describe("startPrompt")` atau describe baru):
```ts
describe("SPEC-237 · flow audit-only", () => {
  it("pipeline audit = Audit → Laporan, tanpa Plan/Execute", () => {
    expect(PIPELINES.audit).toEqual(["Audit", "Laporan"]);
  });
  it("startPrompt audit menginstruksikan dokumen audit tanpa perbaikan kode", () => {
    const p = startPrompt("audit", spec, "hanoman/spec-237");
    expect(p).toContain("Audit");
    expect(p).toContain("Laporan");
    expect(p).not.toContain("Execute");
    expect(p.toLowerCase()).toContain("jangan");           // klausa "JANGAN menulis perbaikan"
    expect(p).toContain("dokumen audit");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run test/prompt.test.ts`
Expected: FAIL (`PIPELINES.audit` undefined).

- [x] **Step 3: Implementasi**

`runner/src/types.ts:1`:
```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit";
```

`runner/src/prompt.ts` — tambah baris pipeline di objek `PIPELINES` (setelah `prd`):
```ts
  prd: ["Brainstorm", "PRD"],
  audit: ["Audit", "Laporan"],
```

`runner/src/prompt.ts` — tambah fungsi tepat setelah `auditDecisionInstruction` (sekitar :80):
```ts
// SPEC-237 · flow audit-only: investigasi + dokumen, TANPA perbaikan kode. Deliverable = dokumen
// audit SoT yang menilai apakah issue terdefinisi baik + rekomendasi (cukup jawaban / naik jadi QA).
const auditOnlyInstruction = (flow: Flow): string =>
  flow !== "audit" ? "" :
    "Ini audit-only: investigasi SAJA, JANGAN menulis perbaikan kode apa pun. Fase Audit "
    + "(systematic-debugging): telusuri akar masalah / log / jawaban dan nilai apakah issue "
    + "terdefinisi dengan baik. Fase Laporan: tulis DOKUMEN AUDIT ke Source of Truth "
    + "`internal/docs/research/audit-<spec-id>-<slug>.md` (ikuti konvensi audit yang ada), tautkan "
    + "di `internal/docs/README.md`, memuat: keluhan/pertanyaan, temuan (dengan bukti/log), apakah "
    + "issue terdefinisi baik, dan REKOMENDASI — 'cukup jawaban, tak perlu perbaikan' ATAU 'perlu "
    + "dinaikkan jadi Finding QA untuk diperbaiki'. Commit dokumen itu lalu push. Tak ada kode fitur.";
```

`runner/src/prompt.ts` — sisipkan ke array `startPrompt` (setelah `auditDecisionInstruction(flow),`):
```ts
    auditDecisionInstruction(flow),
    auditOnlyInstruction(flow),
```

- [x] **Step 4: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run test/prompt.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add runner/src/types.ts runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(runner): flow audit-only (Audit→Laporan, tanpa perbaikan) — SPEC-237"
```

---

### Task 3: server — stage machine `Laporan → done`

**Files:**
- Modify: `server/src/services/session-phases.ts:53-55` (REACHED)
- Test: `server/test/session-phases.test.ts`

**Interfaces:**
- Consumes: `PIPELINES.audit` (Task 2), `REACHED` (map fase→stage).
- Produces: `stageFor` mengembalikan `"done"` saat fase `Laporan` state `done`.

- [x] **Step 1: Tulis test yang gagal**

Tambah di `server/test/session-phases.test.ts` (dalam describe `stageFor`, atau describe baru — pakai bentuk `Phase[]`):
```ts
describe("SPEC-237 · stage audit-only", () => {
  it("Laporan done → stage done", () => {
    const phases: Phase[] = [{ name: "Audit", state: "done" }, { name: "Laporan", state: "done" }];
    expect(stageFor(phases)).toBe("done");
  });
  it("Audit done, Laporan active → belum done (objective)", () => {
    const phases: Phase[] = [{ name: "Audit", state: "done" }, { name: "Laporan", state: "active" }];
    expect(stageFor(phases)).toBe("objective");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/session-phases.test.ts`
Expected: FAIL (`Laporan` tak ada di REACHED → stage `objective`, bukan `done`).

- [x] **Step 3: Implementasi**

`server/src/services/session-phases.ts:53-55` ganti `REACHED`:
```ts
const REACHED: Record<string, Stage> = {
  Objective: "objective", Audit: "objective", Spec: "spec-ready", Plan: "planned",
  Laporan: "done", Execute: "done",
};
```

- [x] **Step 4: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/session-phases.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-phases.ts server/test/session-phases.test.ts
git commit -m "feat(server): fase Laporan → stage done (audit-only) — SPEC-237"
```

---

### Task 4: server — `kindOf` mengenali audit doc SoT (`research/audit-*`)

**Files:**
- Modify: `server/src/services/spec-docs.ts:15-23` (kindOf)
- Test: `server/test/spec-docs.test.ts:23`

**Interfaces:**
- Produces: `kindOf("internal/docs/research/audit-spec-237-x.md") === "audit"`; perilaku lama (`*-audit.md`) tetap.

- [x] **Step 1: Tulis test yang gagal**

Tambah assertion di dalam `describe("kindOf")` (`server/test/spec-docs.test.ts`, setelah baris 31):
```ts
    expect(kindOf("internal/docs/research/audit-spec-237-audit-issue.md")).toBe("audit");
    expect(kindOf("internal/docs/research/audit-spec-230-prd-review-merge.md")).toBe("audit");
```

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/spec-docs.test.ts`
Expected: FAIL (kedua path kini `"other"`).

- [x] **Step 3: Implementasi**

`server/src/services/spec-docs.ts:17` — ganti baris audit jadi mencakup konvensi SoT `research/audit-`:
```ts
  // SPEC-237 · audit SoT bernama `research/audit-<spec>-<slug>.md` (tak berakhiran -audit.md);
  // qa-flow lama & audit-only sama-sama masuk kind "audit".
  if (p.endsWith("-audit.md") || p.includes("/research/audit-")) return "audit";
```

- [x] **Step 4: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/spec-docs.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/spec-docs.ts server/test/spec-docs.test.ts
git commit -m "feat(server): klasifikasi audit doc SoT (research/audit-*) di preview docs — SPEC-237"
```

---

### Task 5: server — `POST /specs` menerima source `audit` + author

**Files:**
- Modify: `server/src/routes/specs.ts` (blok author di `POST /specs`, sekitar :78-95)
- Test: `server/test/specs.route.test.ts` bila ada; jika tidak, tambahkan test ringkas di file route spec terdekat (mis. `server/test/spec-docs.route.test.ts` pola factory) ATAU buat `server/test/specs-audit.route.test.ts`.

**Interfaces:**
- Consumes: `zCreateSpec` (Task 1 sudah menerima `audit` + payload brief), `deriveSpecFields` (audit → cabang brief, tak berubah).
- Produces: `POST /specs {source:"audit", payload:brief}` → 201, `author` berawalan `Audit · `.

- [x] **Step 1: Baca blok author saat ini**

Run: `sed -n '78,96p' server/src/routes/specs.ts`
Catat ekspresi `author` (mis. `const author = isQa ? \`QA · ${email}\` : email;`).

- [x] **Step 2: Tulis test yang gagal**

Buat `server/test/specs-audit.route.test.ts` (pola factory seperti `spec-docs.route.test.ts`):
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp, resetDb, makeProject, authHeaders } from "./factory";

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  app = await buildApp();
});

describe("SPEC-237 · POST /specs source audit", () => {
  it("membuat spec audit dengan payload brief-shaped", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", headers: await authHeaders(),
      payload: { project: "p1", source: "audit", title: "Audit funnel",
        priority: "tinggi", payload: { context: "cek double count", outcome: "jawaban akar masalah", constraints: "", priority: "tinggi" } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.source).toBe("audit");
    expect(body.author).toContain("Audit");
  });
  it("menolak source audit dengan payload qa (severity)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs", headers: await authHeaders(),
      payload: { project: "p1", source: "audit", title: "x", priority: "tinggi",
        payload: { severity: "major", steps: "", expected: "", actual: "", env: "" } },
    });
    expect(res.statusCode).toBe(400);
  });
});
```
> Catatan: samakan import (`buildApp`/`authHeaders`/`makeProject`) dengan yang benar-benar diekspor `server/test/factory.ts`. Bila helper berbeda nama, sesuaikan; bila route spec test yang ada sudah menyediakan pola inject+auth, tumpangi file itu.

- [x] **Step 3: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/specs-audit.route.test.ts`
Expected: FAIL (author belum berawalan Audit; atau perlu penyesuaian helper).

- [x] **Step 4: Implementasi author**

Di `server/src/routes/specs.ts` ganti ekspresi `author` `POST /specs` agar menyertakan audit, mis.:
```ts
    const author = b.source === "qa" ? `QA · ${email}`
      : b.source === "audit" ? `Audit · ${email}` : email;
```
(`isQa` untuk hal lain tetap; hanya `author` yang ditambah cabang audit. `deriveSpecFields` tak diubah — audit sudah jatuh ke cabang brief.)

- [x] **Step 5: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/specs-audit.route.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/specs.ts server/test/specs-audit.route.test.ts
git commit -m "feat(server): POST /specs menerima source audit + author Audit· — SPEC-237"
```

---

### Task 6: frontend — source→flow via `flowForSource` + `Flow` type

**Files:**
- Modify: `src/src/api/client.ts:3` (Flow)
- Modify: `src/src/App.tsx:497`, `src/src/screens/TerminalScreen.tsx:83`

**Interfaces:**
- Consumes: `flowForSource` dari `@hanoman/shared` (Task 1).
- Produces: kedua situs start-sesi memakai `flowForSource(spec.source)`.

- [x] **Step 1: `Flow` type + import helper**

`src/src/api/client.ts:3`:
```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit";
```

- [x] **Step 2: Ganti kedua situs source→flow**

`src/src/App.tsx:497` (di dalam `startSession`):
```ts
      const { id } = await api.startSession({ spec: spec.id, flow: flowForSource(spec.source) });
```
`src/src/screens/TerminalScreen.tsx:83`:
```ts
    const flow: Flow = flowForSource(spec.source);
```
Tambahkan `flowForSource` ke import `@hanoman/shared` di kedua file (mis. `import { flowForSource } from "@hanoman/shared";`).

- [x] **Step 3: Typecheck**

Run: `pnpm --filter @hanoman/web exec tsc --noEmit` (atau perintah typecheck web yang berlaku di repo)
Expected: PASS (tak ada error tipe `Flow`).

- [x] **Step 4: Commit**

```bash
git add src/src/api/client.ts src/src/App.tsx src/src/screens/TerminalScreen.tsx
git commit -m "feat(web): source→flow lewat flowForSource (dukung audit) — SPEC-237"
```

---

### Task 7: frontend — label/badge/filter source (audit)

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (badge `:141,:308,:343?,:419` via helper; filter tabs `:561`)
- Modify: `src/src/screens/TerminalScreen.tsx:309-310` (picker icon/color)
- Modify: `src/src/screens/OverviewScreen.tsx:109-110,:120` (count)
- Test: `src/test/backlog-board.test.tsx`

**Interfaces:**
- Produces: helper `sourceMeta(source)` → `{ label, icon, tone }` dipakai badge; item audit tampil label "Audit"; tab filter punya entri audit.

- [x] **Step 1: Tulis test yang gagal (badge audit)**

Tambah di `src/test/backlog-board.test.tsx` sebuah kasus render spec `source:"audit"` dan assert teks "Audit" muncul (samakan gaya render/query dengan test yang ada di file itu):
```ts
it("SPEC-237 · spec audit menampilkan badge Audit", () => {
  const spec = { id: "SPEC-237", projectId: "p1", title: "Audit funnel", source: "audit",
    stage: "brainstorming", priority: "tinggi", author: "Audit · me", objective: "cek",
    payload: null, branchFrom: null, baseSha: null } as any;
  render(<BacklogScreen backlog={[spec]} projects={[{ id: "p1", name: "P1" } as any]} />);
  expect(screen.getByText("Audit")).toBeTruthy();
});
```
> Sesuaikan props wajib `BacklogScreen` dengan signature nyata (`:507`); bila test file punya factory spec, pakai itu dan set `source:"audit"`.

- [x] **Step 2: Jalankan test — pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web exec vitest run test/backlog-board.test.tsx`
Expected: FAIL (badge masih "feature brief" untuk source tak dikenal).

- [x] **Step 3: Implementasi helper + ganti ternari**

Tambah di atas komponen `BacklogScreen.tsx` (mis. dekat import ikon):
```ts
// SPEC-237 · satu peta source → tampilan (menggantikan ternari qa/brief tersebar).
const SOURCE_META: Record<string, { label: string; icon: string; tone: "err" | "brass" | "info" }> = {
  qa:    { label: "QA finding",   icon: "bug",    tone: "err" },
  audit: { label: "Audit",        icon: "search", tone: "info" },
  brief: { label: "feature brief", icon: "lightbulb", tone: "brass" },
};
const sourceMeta = (s: string) => SOURCE_META[s] ?? SOURCE_META.brief;
```
Ganti tiap `const qa = spec.source === "qa";` + badge `qa ? "QA finding" : "feature brief"` (baris ~141, ~308, ~343, ~419) dengan `const meta = sourceMeta(spec.source);` lalu `<Badge tone={meta.tone} ...>{meta.label}</Badge>` dan `<Icon name={meta.icon} .../>`. Untuk baris yang masih butuh boolean qa (mis. tone khusus), pakai `meta`.
Filter tabs `:561` tambahkan entri:
```ts
            { value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" },
            { value: "qa", label: "Dari QA" }, { value: "audit", label: "Audit" },
```
`TerminalScreen.tsx:309-310` picker → gunakan ikon/warna berbasis source (audit = `search`/warna info): 
```ts
              <Icon name={s.source === "qa" ? "bug" : s.source === "audit" ? "search" : "lightbulb"} size={14}
                color={s.source === "qa" ? "var(--clay-500)" : s.source === "audit" ? "var(--brass-500)" : "var(--brass-500)"} />
```
`OverviewScreen.tsx:109-110,:120` — bila menghitung `briefN`/`qaN`, tambahkan `auditN` (`source === "audit"`) ke ringkasan count (mis. `` `${briefN} brief · ${qaN} QA · ${auditN} audit` ``).

- [x] **Step 4: Jalankan test — pastikan lolos**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web exec vitest run test/backlog-board.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/src/screens/TerminalScreen.tsx src/src/screens/OverviewScreen.tsx src/test/backlog-board.test.tsx
git commit -m "feat(web): label/badge/filter source audit — SPEC-237"
```

---

### Task 8: frontend — `NewSpecModal` tab Audit + payload

**Files:**
- Modify: `src/src/App.tsx:30-129` (SpecForm/NewSpecModal), `:619-633` (createSpec)

**Interfaces:**
- Consumes: `zCreateSpec` audit (Task 1/5).
- Produces: tab source ketiga "Audit"; audit mengirim `source:"audit"` + payload brief-shaped; toast audit.

- [x] **Step 1: Tambah tab + salin copy audit**

Di `NewSpecModal` (`App.tsx`):
- `const isQa = f.kind === "qa";` biarkan; tambah `const isAudit = f.kind === "audit";`.
- Tabs (`:71-74`) tambahkan entri:
```tsx
          { value: "brief", label: "Feature brief", icon: "lightbulb" },
          { value: "qa", label: "QA finding", icon: "bug" },
          { value: "audit", label: "Audit", icon: "search" },
```
- Modal `title`/`icon`/footer copy (`:62-68`): perlakukan audit seperti brief tapi label audit, mis. `title={isQa ? "QA finding baru" : isAudit ? "Audit baru" : "Feature brief baru"}`, ikon `isQa ? "bug" : isAudit ? "search" : "lightbulb"`, tombol submit `isAudit ? "Buat audit → investigasi" : isQa ? "Filekan finding → audit" : "Buat brief → brainstorm"`.
- Teks penjelas (`:76-77`): tambah cabang audit: `isAudit ? "Audit hanya menghasilkan dokumen (audit → laporan). Tak ada perbaikan; bisa dinaikkan jadi Finding QA." : …`.
- Field body: audit memakai cabang brief (`isQa ?  … : …` → gunakan `!isQa` yang sudah mencakup audit). Beri label ber-nuansa audit bila `isAudit`: "Apa yang diaudit / pertanyaan" (context), "Temuan/jawaban yang diharapkan" (outcome). Boleh sederhana: pakai label brief yang ada — tetap fungsional (YAGNI). Minimal ubah label context/outcome bila `isAudit`.

- [x] **Step 2: createSpec — payload audit = brief-shaped, toast**

`App.tsx:619-633`:
```ts
  async function createSpec(f: SpecForm) {
    const isQa = f.kind === "qa";
    const payload = isQa
      ? { severity: f.severity, steps: f.steps, expected: f.expected, actual: f.actual, env: f.env }
      : { context: f.context, outcome: f.outcome, constraints: f.constraints, priority: f.priority };
    try {
      const created = await api.createSpec({ project: f.project, source: f.kind, title: f.title.trim(),
        priority: f.priority, payload, branchFrom: f.branchFrom || undefined });
      setBacklog((b) => [created, ...b]);
      setModal(null); setSpecPrefill(null); setSection("backlog");
      const t = f.kind === "audit" ? " dibuat · audit-only"
        : isQa ? " difilekan · masuk audit" : " dibuat · masuk brainstorm";
      showToast(created.id + t, "ok", f.kind === "audit" ? "search" : isQa ? "bug" : "lightbulb");
    } catch { showToast("Gagal membuat spec", "err", "x-circle"); }
  }
```
(Payload audit otomatis brief-shaped karena `isQa` false → lolos `superRefine`.)

- [x] **Step 3: Typecheck + build web**

Run: `pnpm --filter @hanoman/web exec tsc --noEmit`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/src/App.tsx
git commit -m "feat(web): NewSpecModal tab Audit (payload brief-shaped) — SPEC-237"
```

---

### Task 9: frontend — promosi "Jadikan Finding QA"

**Files:**
- Modify: `src/src/App.tsx` (prefill type + `promoteToQa` + NewSpecModal `blank`)
- Modify: `src/src/screens/BacklogScreen.tsx` (`SpecDetail` tombol, prop `onPromoteToQa`)

**Interfaces:**
- Consumes: NewSpecModal `prefill` (perluas dengan `kind` + field qa).
- Produces: dari item audit, tombol "Jadikan Finding QA" membuka NewSpecModal source `qa` ter-prefill (title + backlink audit di `steps`).

- [x] **Step 1: Perluas prefill NewSpecModal menerima `kind`**

`App.tsx` `NewSpecModal` prop `prefill` (`:36`) tambah field:
```ts
    prefill?: { project?: string; title?: string; context?: string; outcome?: string; prdPath?: string;
      kind?: string; steps?: string; actual?: string; severity?: string } }) {
```
`blank` (`:37-39`):
```ts
  const blank: SpecForm = { kind: prefill?.kind ?? "brief", project: prefill?.project || defaultProject,
    title: prefill?.title ?? "", context: prefill?.context ?? "", outcome: prefill?.outcome ?? "",
    constraints: "", priority: "sedang", severity: prefill?.severity ?? "major",
    steps: prefill?.steps ?? "", expected: "", actual: prefill?.actual ?? "", env: "", branchFrom: "" };
```
(`useEffect` reset `:41-43` sudah `setF({ ...blank, ... })` — ikut membawa `kind` prefill.)

- [x] **Step 2: Handler `promoteToQa` + prop threading**

Di App (dekat `takeToBacklog` `:576`):
```ts
  // SPEC-237 · naikkan audit → Finding QA (audit tetap doc-of-record). Buka NewSpecModal source qa,
  // prefill title + backlink audit; qa akan menjalankan audit→spec→plan→execute (perbaikan dieksekusi).
  function promoteToQa(spec: Spec) {
    setSpecPrefill({ project: spec.projectId, kind: "qa", title: spec.title,
      steps: `Dari audit ${spec.id}: ${spec.objective}`.slice(0, 500),
      actual: spec.objective, severity: "major" });
    setModal("brief");
  }
```
Teruskan `onPromoteToQa={promoteToQa}` ke `BacklogScreen` (di render backlog `:692`).
Perluas tipe `PrdPrefill`/state `specPrefill` agar menerima field baru (samakan dengan prefill NewSpecModal).

- [x] **Step 3: Tombol di SpecDetail (audit)**

`BacklogScreen.tsx` `SpecDetail` (`:80` signature + body `:134-175`): tambah prop `onPromoteToQa?: (s: Spec) => void`; render tombol saat `spec.source === "audit"`:
```tsx
        {spec.source === "audit" && onPromoteToQa && (
          <Button size="sm" variant="secondary" leftIcon="bug" onClick={() => onPromoteToQa(spec)}>
            Jadikan Finding QA
          </Button>
        )}
```
Teruskan prop dari `BacklogScreen` (`:507` signature) ke `<SpecDetail … onPromoteToQa={onPromoteToQa} />` (`:622`).

- [x] **Step 4: Typecheck**

Run: `pnpm --filter @hanoman/web exec tsc --noEmit`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/App.tsx src/src/screens/BacklogScreen.tsx
git commit -m "feat(web): promosi audit → Finding QA (prefill NewSpecModal qa) — SPEC-237"
```

---

### Task 10: docs — ADR-0057 + Source of Truth

**Files:**
- Create: `internal/docs/adr/0057-audit-only-source-flow.md`
- Modify: `internal/docs/architecture/api-contract.md`, `internal/docs/architecture/data-model.md`,
  `internal/docs/operations/agent-documentation-workflow.md`, `internal/docs/README.md`,
  `internal/skills/hanoman/SKILL.md`

- [x] **Step 1: Tulis ADR-0057**

`internal/docs/adr/0057-audit-only-source-flow.md` — Status accepted · 2026-07-20 · SPEC-237. Isi: konteks (qa selalu execute; butuh audit-only), keputusan (source+flow `audit`, pipeline `Audit→Laporan`, dokumen SoT, stage `done` via `Laporan`, tanpa migration, parity terminal gratis, promosi = spec qa baru pola ADR-0041), konsekuensi, alternatif ditolak (project-level seperti PRD; reuse qa + no-execute), acceptance EARS (AC-1..AC-6, lihat design doc). Tautkan ADR-0040/0041/0054/0021/0029.

- [x] **Step 2: Perbarui api-contract.md**

Di bawah `POST /specs` catat `source ∈ brief|qa|audit`; di `/specs/:id/docs` catat audit doc SoT (`research/audit-*`) diklasifikasi `audit`; catat flow set kini `feature|qa|scaffold|reverse|prd|audit` dan pipeline `audit = Audit → Laporan` (dokumen saja, tanpa Execute).

- [x] **Step 3: Perbarui data-model.md**

`Spec.source ("brief" | "qa" | "audit")`; bagian flow: `feature | qa | scaffold | reverse | prd | audit`; tambah kalimat: audit-only menghasilkan dokumen `internal/docs/research/audit-<spec-id>-<slug>.md`, stage `done` lewat fase `Laporan`, tanpa perubahan skema (String enum).

- [x] **Step 4: Perbarui agent-documentation-workflow.md**

Tambah baris alur: **Audit-only:** audit → laporan (dokumen SoT), berhenti; bila perlu perbaikan, dinaikkan jadi Finding QA (qa → audit → spec → plan → execute). Fase Audit→systematic-debugging, Laporan→tulis dokumen.

- [x] **Step 5: Tautkan di README index + SKILL**

`internal/docs/README.md` bagian adr — tambah baris `[0057 — Audit-only …](adr/0057-audit-only-source-flow.md)`.
`internal/skills/hanoman/SKILL.md` — pada aturan sesi/alur, sebut flow `audit` (audit-only, dokumen, promotable ke qa).

- [x] **Step 6: Verifikasi index integritas**

Run: `node -e "0"` *(placeholder tak dipakai)* — sebagai gantinya jalankan pemeriksa coverage dep-free (memory hanoman-verify-coverage-without-server):
Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run` (pastikan tak ada regresi) lalu pastikan setiap doc baru ter-link (grep manual).

- [x] **Step 7: Commit**

```bash
git add internal/docs docs/superpowers
git commit -m "docs: ADR-0057 audit-only source/flow + SoT (api-contract, data-model, workflow, index) — SPEC-237"
```

---

### Task 11: Build penuh + verifikasi API nyata di local

**Files:** none (verifikasi).

- [ ] **Step 1: Build seluruh workspace**

Run: `pnpm -r build` (shared→runner→server→web). Expected: sukses tanpa error TS.

- [ ] **Step 2: Test repo penuh**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism`
Expected: hijau (tak ada regresi; test baru lolos).

- [ ] **Step 3: Boot server terhadap DB throwaway ter-migrate**

Ikuti memory hanoman-live-smoke-dedicated-db (JANGAN pakai hanoman_test/hanoman dev): buat DB throwaway, `prisma migrate deploy` + `prisma generate`, `node server/dist/server.js` (port non-8787). Buat user via `POST /auth/setup`.

- [ ] **Step 4: Curl POST /specs source audit**

```bash
curl -sS -X POST localhost:<port>/api/specs -b cookie.txt -H 'content-type: application/json' \
  -d '{"project":"<p>","source":"audit","title":"Audit funnel","priority":"tinggi","payload":{"context":"cek double count","outcome":"akar masalah","constraints":"","priority":"tinggi"}}' | jq '.id,.source,.author'
```
Expected: `source":"audit"`, `author` berawalan `Audit`.

- [ ] **Step 5: Verifikasi flow prompt (tanpa spawn claude sungguhan)**

Karena `POST /terminal/sessions` men-spawn `claude` sungguhan (memory hanoman-browser-smoke), verifikasi pemetaan flow lewat unit: `startPrompt("audit", …)` sudah teruji (Task 2). Cek `GET /specs?source=audit` mengembalikan item; `GET /specs/:id/docs` berfungsi (kosong sampai sesi menulis doc — OK).

- [ ] **Step 6: Ceklis plan penuh + tandai fase**

Pastikan semua `- [ ]` di plan ini `- [x]`. Lalu `echo "Execute done" >> "$HANOMAN_PHASE_FILE"`.

- [ ] **Step 7: Commit akhir + push**

```bash
git add -A && git commit -m "chore: verifikasi build+test+API audit-only — SPEC-237"
git push origin HEAD:refs/heads/hanoman/spec-237
```

---

## Self-Review

**Spec coverage:** (1) source+flow audit → Task 1,2. (2) audit-only, dokumen tanpa perbaikan → Task 2 (klausa) + Task 3 (stage done via Laporan). (3) preview docs klasifikasi audit → Task 4. (4) parity terminal review/merge/fullscreen → gratis (Spec-backed; ditegaskan di design §5, tanpa perubahan kode). (5) buat via UI → Task 8. (6) label/filter → Task 7. (7) source→flow → Task 6. (8) promosi ke Finding QA → Task 9. (9) docs SoT → Task 10. (10) verifikasi nyata → Task 11.

**Placeholder scan:** semua step berisi kode/aksi nyata. Task 5/7 mencatat "samakan dengan factory/props nyata" — ini instruksi verifikasi tipe, bukan placeholder logika (nama helper factory diverifikasi saat eksekusi).

**Type consistency:** `flowForSource` (Task 1) dipakai konsisten (Task 6); `FlowName`/`Flow` sama union termasuk `audit`; `REACHED.Laporan` (Task 3) sesuai `PIPELINES.audit` fase `Laporan` (Task 2); `SOURCE_META`/`sourceMeta` (Task 7) dipakai badge; `prefill.kind` (Task 9) selaras `SpecForm.kind`.
