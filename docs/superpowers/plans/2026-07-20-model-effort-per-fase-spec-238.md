# Setting model & effort per fase (SPEC-238) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator dapat menyetel model & effort per fase (semua flow) di Settings; default tetap opus/xhigh; sesi lahir dengan config fase pertama dan mengganti model/effort antar-fase via `/model`+`/effort` in-session.

**Architecture:** Perluas `zSetting` dengan `phaseModels` (map `flow → phase → {model?,effort?}`). Runner `resolvePhaseModels` menurunkan launch (fase-1) + tabel per-fase; prompt menyuntik instruksi `/model`+`/effort` HANYA bila ada variasi. Route flow membaca Settings, spawn dengan launch config, dan menyerahkan tabel ke prompt. Frontend menambah matrix per-fase + pilihan Fable/max/ultracode.

**Tech Stack:** TypeScript strict, zod (`@hanoman/shared`), Fastify (server), React (frontend), vitest, Prisma (Setting = Json blob, tanpa migration).

## Global Constraints

- Default global tetap `model: "claude-opus-4-8"`, `effort: "xhigh"` (fallback bila sel kosong).
- `model`/`effort` tetap `z.string()` (lenient) — JANGAN enum ketat (forward-compatible; baris lama tak boleh gagal parse).
- Sesi tetap **satu proses `claude`** — TIDAK ada respawn per fase (ADR-0058/0024/0015).
- Prompt sesi yang **seragam** (tanpa override) TIDAK boleh berubah (regresi nol pada test prompt lama).
- Tanpa perubahan skema Prisma — `phaseModels` hidup di `Setting.data` (Json).
- Test repo: `env -u NODE_ENV -u DATABASE_URL pnpm test` atau `vitest run --no-file-parallelism` per paket.
- Tambah model id `claude-fable-5`; tambah effort `max` dan `ultracode`.
- Merge-conflict/integrate/vps session (tanpa fase) tetap pakai `sessionModel()` global — JANGAN diubah.

---

### Task 1: shared — `zSetting.phaseModels` + `MODELS`/`EFFORTS`

**Files:**
- Modify: `shared/src/entities.ts` (dekat `zSetting`, sekitar baris 35-49)
- Test: `shared/test/entities.test.ts`

**Interfaces:**
- Produces: `zPhaseOverride`, `zPhaseModels`, tipe `PhaseOverride`/`PhaseModels`; `zSetting.phaseModels` (default `{}`); const `MODELS: readonly {id,label}[]`, `EFFORTS: readonly string[]`. Semua ter-export via barrel `shared/src/index.ts` (`export * from "./entities"` sudah ada).

- [x] **Step 1: Write the failing test**

Tambahkan di `shared/test/entities.test.ts` (cari `describe` yang menguji `zSetting`; bila belum ada, buat blok baru). Import `zSetting, MODELS, EFFORTS` dari `../src/entities`.

```ts
describe("zSetting.phaseModels (SPEC-238)", () => {
  const base = { autoDefault: true, autoScaffold: true, notifyFail: true };
  it("phaseModels hilang → default {}", () => {
    expect(zSetting.parse(base).phaseModels).toEqual({});
  });
  it("menyimpan override per flow/phase", () => {
    const s = zSetting.parse({ ...base, phaseModels: { feature: { Brainstorm: { model: "claude-sonnet-5", effort: "high" } } } });
    expect(s.phaseModels.feature.Brainstorm).toEqual({ model: "claude-sonnet-5", effort: "high" });
  });
  it("override boleh sebagian (hanya model, atau hanya effort)", () => {
    const s = zSetting.parse({ ...base, phaseModels: { qa: { Execute: { effort: "max" } } } });
    expect(s.phaseModels.qa.Execute).toEqual({ effort: "max" });
  });
  it("MODELS memuat Fable; EFFORTS memuat max & ultracode", () => {
    expect(MODELS.map((m) => m.id)).toContain("claude-fable-5");
    expect(EFFORTS).toContain("max");
    expect(EFFORTS).toContain("ultracode");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd shared && npx vitest run test/entities.test.ts -t "phaseModels"`
Expected: FAIL — `phaseModels` undefined / `MODELS` is not exported.

- [x] **Step 3: Write minimal implementation**

Di `shared/src/entities.ts`, tepat sebelum `export const zSetting = z.object({`:

```ts
// SPEC-238 · ADR-0058 — override model/effort per fase. Field kosong → fallback ke {model,effort}
// global. Tetap z.string() (bukan enum ketat): forward-compatible, baris lama tak pernah gagal parse.
export const zPhaseOverride = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
});
// keyed by flow name → phase name → override. Longgar (record) karena nama fase beda per flow.
export const zPhaseModels = z.record(z.string(), z.record(z.string(), zPhaseOverride));
export type PhaseOverride = z.infer<typeof zPhaseOverride>;
export type PhaseModels = z.infer<typeof zPhaseModels>;

// SPEC-238 · daftar pilihan valid untuk UI (server tetap lenient z.string()). +Fable, +max, +ultracode.
export const MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
] as const;
export const EFFORTS = ["xhigh", "high", "medium", "low", "max", "ultracode"] as const;
```

Lalu di dalam `zSetting = z.object({ ... })` tambahkan field (setelah `effort`):

```ts
  phaseModels: zPhaseModels.default({}),                                  // SPEC-238 · ADR-0058
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd shared && npx vitest run test/entities.test.ts`
Expected: PASS (semua, termasuk test lama).

- [x] **Step 5: Commit**

```bash
git add shared/src/entities.ts shared/test/entities.test.ts
git commit -m "feat(shared): zSetting.phaseModels + MODELS/EFFORTS (Fable/max/ultracode) — SPEC-238"
```

---

### Task 2: runner — `resolvePhaseModels` + injeksi prompt per-fase

**Files:**
- Modify: `runner/src/prompt.ts`
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `PIPELINES` (sudah ada, `runner/src/prompt.ts:4`), tipe `Flow` (`runner/src/types.ts`).
- Produces: `type PhaseModel = { phase: string; model: string; effort: string }`; `resolvePhaseModels(flow, overrides, fallback) → { launch: {model,effort}; perPhase: PhaseModel[] }`; parameter opsional ke-4 `perPhase?: PhaseModel[]` pada `startPrompt`, `startProjectPrompt`, `startPrdPrompt`, `startScaffoldPrompt` (BUKAN `continuePrompt`). Ter-export via barrel `runner/src/index.ts` (`export * from "./prompt"` sudah ada).

- [x] **Step 1: Write the failing test**

Di `runner/test/prompt.test.ts`, tambah `resolvePhaseModels` ke import baris 2, lalu blok baru:

```ts
describe("resolvePhaseModels + prompt per-fase (SPEC-238)", () => {
  const fb = { model: "claude-opus-4-8", effort: "xhigh" };
  it("launch = fallback bila fase pertama tak punya override; sel kosong fallback", () => {
    const r = resolvePhaseModels("feature", { Spec: { model: "claude-sonnet-5" } }, fb);
    expect(r.launch).toEqual({ model: "claude-opus-4-8", effort: "xhigh" });
    const specRow = r.perPhase.find((p) => p.phase === "Spec")!;
    expect(specRow.model).toBe("claude-sonnet-5");
    expect(specRow.effort).toBe("xhigh"); // effort kosong → fallback
  });
  it("launch memakai override fase pertama bila ada", () => {
    const r = resolvePhaseModels("feature", { Brainstorm: { model: "claude-sonnet-5", effort: "high" } }, fb);
    expect(r.launch).toEqual({ model: "claude-sonnet-5", effort: "high" });
  });
  it("prompt seragam (tanpa override) TAK memuat blok per-fase", () => {
    const { perPhase } = resolvePhaseModels("feature", {}, fb);
    const p = startPrompt("feature", spec, "b", perPhase);
    expect(p).not.toContain("Model & effort per fase");
    expect(p).not.toContain("/model claude");
  });
  it("prompt dengan variasi memuat baris /model + /effort tiap fase", () => {
    const { perPhase } = resolvePhaseModels("feature", { Execute: { effort: "max" } }, fb);
    const p = startPrompt("feature", spec, "b", perPhase);
    expect(p).toContain("Model & effort per fase");
    expect(p).toContain("/effort max");
    expect(p).toContain("/model claude-opus-4-8");
  });
  it("startPrompt tanpa arg perPhase tak berubah (backward-compatible)", () => {
    const p = startPrompt("feature", spec, "b");
    expect(p).not.toContain("Model & effort per fase");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd runner && npx vitest run test/prompt.test.ts -t "per-fase"`
Expected: FAIL — `resolvePhaseModels` is not exported / `startPrompt` takes 3 args.

- [x] **Step 3: Write minimal implementation**

Di `runner/src/prompt.ts`, setelah definisi `PIPELINES` (baris ~10), tambah:

```ts
// SPEC-238 · ADR-0058 — model/effort per fase. launch = config fase pertama (argv --model/--effort
// saat sesi lahir); perPhase = tiap fase + nilai efektif (override ?? fallback global).
export type PhaseModel = { phase: string; model: string; effort: string };
export function resolvePhaseModels(
  flow: Flow,
  overrides: Record<string, { model?: string; effort?: string }> | undefined,
  fallback: { model: string; effort: string },
): { launch: { model: string; effort: string }; perPhase: PhaseModel[] } {
  const perPhase = PIPELINES[flow].map((phase) => ({
    phase,
    model: overrides?.[phase]?.model ?? fallback.model,
    effort: overrides?.[phase]?.effort ?? fallback.effort,
  }));
  const launch = perPhase.length ? { model: perPhase[0].model, effort: perPhase[0].effort } : { ...fallback };
  return { launch, perPhase };
}

// Instruksi hanya di-emit bila ADA VARIASI (≥1 fase beda dari fase pertama). Seragam → "" (prompt
// tak berubah). Ganti model aman terhadap konteks; `/effort` best-effort di Opus/Fable (ADR-0058).
const phaseModelInstruction = (perPhase?: PhaseModel[]): string => {
  if (!perPhase || perPhase.length === 0) return "";
  const varied = perPhase.some((p) => p.model !== perPhase[0].model || p.effort !== perPhase[0].effort);
  if (!varied) return "";
  const rows = perPhase.map((p) => `- ${p.phase} → \`/model ${p.model}\` · \`/effort ${p.effort}\``);
  return "Model & effort per fase (SPEC-238): di AWAL tiap fase, sebelum mengerjakannya, set model & "
    + "effort dengan mengetik di terminalmu — `/model <id>` lalu `/effort <level>` — sesuai tabel di bawah. "
    + "Mengganti model TIDAK menghapus konteks (riwayat percakapan tetap terbawa). Bila `/effort` "
    + "dilaporkan \"Not applied\" (wajar di Opus/Fable), abaikan dan lanjutkan — effort mengikuti nilai "
    + "saat sesi lahir. Fase pertama sudah lahir dengan model & effort yang benar.\n" + rows.join("\n");
};
```

Ubah `startPrompt` (baris ~82) — tambah param & sisipkan instruksi:

```ts
export function startPrompt(flow: Flow, spec: SpecBrief, branchTo: string, perPhase?: PhaseModel[]): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
      + `dan link-nya di index, dalam commit yang sama.`,
    phaseInstruction(PIPELINES[flow]),
    phaseModelInstruction(perPhase),
    auditDecisionInstruction(flow),
    AUTONOMY_CLAUSE,
    skillInstruction(PIPELINES[flow]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
```

Lakukan hal yang sama (tambah param `perPhase?: PhaseModel[]` dan sisipkan `phaseModelInstruction(perPhase)` tepat setelah baris `phaseInstruction(...)`) pada: `startProjectPrompt` (baris ~138), `startPrdPrompt` (baris ~158), `startScaffoldPrompt` (baris ~199). JANGAN ubah `continuePrompt` (fase tunggal Execute — tak perlu tabel).

- [x] **Step 4: Run test to verify it passes**

Run: `cd runner && npx vitest run test/prompt.test.ts`
Expected: PASS (blok baru + semua test prompt lama tetap hijau).

- [x] **Step 5: Commit**

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(runner): resolvePhaseModels + prompt per-fase /model+/effort — SPEC-238"
```

---

### Task 3: server — DEFAULT_SETTING + wiring route flow

**Files:**
- Modify: `server/src/services/settings.ts`
- Modify: `server/src/routes/terminal.ts` (4 cabang flow: spec-flow ~76, reverse ~125, scaffold ~150, prd ~185)
- Test: `server/test/settings.test.ts`

**Interfaces:**
- Consumes: `resolvePhaseModels`, `PhaseModel`, `Flow` dari `@hanoman/runner`; `getSetting` (sudah ada).
- Produces: `DEFAULT_SETTING.phaseModels = {}`; helper `phaseModelsForFlow(flow) → { fallback:{model,effort}; perPhase: PhaseModel[] }`.

- [x] **Step 1: Write the failing test**

Di `server/test/settings.test.ts` tambahkan (import `phaseModelsForFlow` dari `../src/services/settings`):

```ts
describe("phaseModelsForFlow (SPEC-238)", () => {
  it("DEFAULT_SETTING punya phaseModels {}", () => {
    expect(DEFAULT_SETTING.phaseModels).toEqual({});
  });
  it("tanpa override → semua fase pakai default global; launch = fallback", async () => {
    await prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING } } });
    const { fallback, perPhase } = await phaseModelsForFlow("feature");
    expect(fallback).toEqual({ model: "claude-opus-4-8", effort: "xhigh" });
    expect(perPhase.every((p) => p.model === "claude-opus-4-8" && p.effort === "xhigh")).toBe(true);
  });
  it("override per fase terbawa; sel kosong fallback ke global", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      ...DEFAULT_SETTING, phaseModels: { feature: { Execute: { model: "claude-opus-4-8", effort: "max" } } },
    } } });
    const { perPhase } = await phaseModelsForFlow("feature");
    const exec = perPhase.find((p) => p.phase === "Execute")!;
    expect(exec.effort).toBe("max");
    const brain = perPhase.find((p) => p.phase === "Brainstorm")!;
    expect(brain.effort).toBe("xhigh");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/settings.test.ts -t "phaseModelsForFlow"`
Expected: FAIL — `phaseModelsForFlow` tidak ada / `DEFAULT_SETTING.phaseModels` undefined.

- [x] **Step 3: Write minimal implementation**

Di `server/src/services/settings.ts`:

```ts
import { prisma } from "../db";
import { zSetting, type Setting } from "@hanoman/shared";
import { resolvePhaseModels, type PhaseModel, type Flow } from "@hanoman/runner";
```

Tambah `phaseModels: {}` ke `DEFAULT_SETTING`:

```ts
export const DEFAULT_SETTING: Setting = {
  ...STEP,
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
  phaseModels: {},
};
```

Tambah helper di bawah `sessionModel()`:

```ts
/** SPEC-238 · ADR-0058 · tabel model/effort per fase + fallback global untuk sebuah flow. */
export async function phaseModelsForFlow(flow: Flow): Promise<{
  fallback: { model: string; effort: string }; perPhase: PhaseModel[];
}> {
  const s = await getSetting();
  const fallback = { model: s.model, effort: s.effort };
  const { perPhase } = resolvePhaseModels(flow, s.phaseModels?.[flow], fallback);
  return { fallback, perPhase };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/settings.test.ts`
Expected: PASS.

- [x] **Step 5: Wire the spec-flow branch (terminal.ts ~76-104)**

Import di atas file (`terminal.ts` baris ~9): ganti/lengkapi menjadi
`import { sessionModel, phaseModelsForFlow } from "../services/settings";`

Ganti blok `const { model, effort } = await sessionModel();` … `const mkPrompt = …` … `createSession(...)` pada cabang spec-flow menjadi:

```ts
const flow = parsed.data.flow;
const { fallback, perPhase } = await phaseModelsForFlow(flow);
const isContinue = spec.stage === "done";
// continue → hanya fase Execute; launch = config Execute. start → launch = fase pertama.
const launch = isContinue
  ? (perPhase.find((p) => p.phase === "Execute") ?? perPhase[perPhase.length - 1] ?? { phase: "Execute", ...fallback })
  : (perPhase[0] ?? { phase: "", ...fallback });
// ...(blok addWorktree + prisma.spec.update tetap seperti semula)...
const brief = {
  id: spec.id, title: spec.title, source: spec.source,
  priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
};
const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
  specId: spec.id, flow, model: launch.model, effort: launch.effort,
  phaseFile: phaseFilePath(repoDir, id),
  decisionFile: decisionFilePath(repoDir, id),
  prompt: isContinue
    ? continuePrompt(flow, brief, `hanoman/${id}`)
    : startPrompt(flow, brief, `hanoman/${id}`, perPhase),
});
return reply.code(201).send({ id: s.id });
```

(Pertahankan urutan asli: hitung `launch` sebelum `addWorktree`; `addWorktree`/`prisma.spec.update` tak berubah.)

- [x] **Step 6: Wire reverse / scaffold / prd branches**

Untuk masing-masing cabang, ganti `const { model, effort } = await sessionModel();` dengan pola launch=perPhase[0] dan serahkan `perPhase` ke prompt builder:

reverse (~125):
```ts
const { fallback, perPhase } = await phaseModelsForFlow("reverse");
const launch = perPhase[0] ?? { phase: "", ...fallback };
// ...addWorktree tetap...
const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
  id, flow: "reverse", model: launch.model, effort: launch.effort,
  phaseFile: phaseFilePath(repoDir, id), decisionFile: decisionFilePath(repoDir, id),
  prompt: startProjectPrompt("reverse", { id: project.id, name: project.name, desc: project.desc, stack: project.stack }, "reverse-docs", perPhase),
});
```

scaffold (~150): sama, `phaseModelsForFlow("scaffold")`, `startScaffoldPrompt({...}, "scaffold-docs", perPhase)`.

prd (~185): `phaseModelsForFlow("prd")`, launch=perPhase[0], `startPrdPrompt({...}, brief, `prd/${slug}`, perPhase)`.

(JANGAN ubah cabang integrate-conflict ~258 maupun `createSession(project.id, repoDir)` plain terminal ~203 — keduanya tanpa fase.)

- [x] **Step 7: Run full server + runner + shared test**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism`
Then: `cd ../runner && npx vitest run` and `cd ../shared && npx vitest run`
Expected: PASS semuanya (termasuk `pty.test.ts`, `terminal.route.test.ts` yang tak berubah perilaku default).

- [x] **Step 8: Commit**

```bash
git add server/src/services/settings.ts server/src/routes/terminal.ts server/test/settings.test.ts
git commit -m "feat(server): phaseModelsForFlow + wire per-fase model/effort ke sesi flow — SPEC-238"
```

---

### Task 4: frontend — pilihan Fable/max/ultracode + matrix per-fase

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx`
- Test: `src/test/config-panel.test.tsx` (atau file baru `src/test/phase-models.test.tsx`)

**Interfaces:**
- Consumes: `Setting.phaseModels` (dari `@hanoman/shared`), `Select` (DS), `api.putSettings`.
- Produces: UI matrix per-fase di tab `model`; `save({ phaseModels })` mem-PUT blob penuh.

- [x] **Step 1: Write the failing test**

Cek pola render test yang ada di `src/test/config-panel.test.tsx` (mock `api.getSettings`/`api.putSettings`, render `SettingsScreen`, klik tab "Model sesi"). Tambah test yang mengecek matrix per-fase muncul dan pilihan baru ada. Contoh (sesuaikan helper render/mocks yang sudah dipakai file itu):

```ts
it("tab Model menampilkan matrix per-fase + pilihan Fable/max/ultracode (SPEC-238)", async () => {
  // render SettingsScreen dgn settings default (phaseModels {}), buka tab "Model sesi"
  // (ikuti pola mock+klik tab yang sudah ada di file ini)
  expect(await screen.findByText(/Model & effort per fase/i)).toBeTruthy();
  expect(screen.getByText("Brainstorm")).toBeTruthy();
  expect(screen.getByText("Execute")).toBeTruthy();
  // opsi baru tersedia di salah satu Select model/effort
  expect(screen.getAllByText(/Fable 5/).length).toBeGreaterThan(0);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run test/config-panel.test.tsx -t "per-fase"` (atau path file test barumu)
Expected: FAIL — teks "Model & effort per fase" / "Fable 5" belum ada.

- [x] **Step 3: Write minimal implementation**

Di `src/src/screens/SettingsScreen.tsx`:

Tambah Fable ke `S_MODELS` (baris 12-16):
```ts
const S_MODELS = [
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "claude-fable-5", label: "Fable 5" },      // SPEC-238
];
```

Tambah max & ultracode ke `S_EFFORT` (baris 18-21):
```ts
const S_EFFORT = [
  { value: "xhigh", label: "x-high" }, { value: "high", label: "high" },
  { value: "medium", label: "medium" }, { value: "low", label: "low" },
  { value: "max", label: "max" }, { value: "ultracode", label: "ultracode" }, // SPEC-238
];
```

Tambah `phaseModels: {}` ke `S_DEFAULTS` (baris 32-37):
```ts
const S_DEFAULTS: Setting = {
  model: "claude-opus-4-8", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
  phaseModels: {},
};
```

Tambah konstanta fase per flow (dekat `S_MODELS`, cerminan `PIPELINES` runner — beri komentar keep-in-sync):
```ts
// Cerminan runner PIPELINES (keep in sync). Matrix model/effort per fase (SPEC-238).
const FLOW_PHASES: { flow: string; label: string; phases: string[] }[] = [
  { flow: "feature", label: "Feature", phases: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"] },
  { flow: "qa", label: "QA / Audit", phases: ["Audit", "Spec", "Plan", "Execute"] },
  { flow: "reverse", label: "Reverse docs", phases: ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"] },
  { flow: "prd", label: "PRD", phases: ["Brainstorm", "PRD"] },
  { flow: "scaffold", label: "Scaffold", phases: ["Brainstorm", "Objective", "Doc index"] },
];
const isOpusLike = (m: string) => m === "claude-opus-4-8" || m === "claude-fable-5";
```

Di dalam `prefs()` (dekat `save`), tambah helper untuk set nilai per-fase (di atas `if (tab === "model")`):
```ts
const setPhase = (flow: string, phase: string, field: "model" | "effort", value: string) => {
  const pm: Record<string, Record<string, { model?: string; effort?: string }>> =
    JSON.parse(JSON.stringify(s.phaseModels ?? {}));
  const cell = { ...(pm[flow]?.[phase] ?? {}) };
  if (value === "") delete cell[field]; else cell[field] = value;      // "" = kembali ke default global
  if (!Object.keys(cell).length) { if (pm[flow]) delete pm[flow][phase]; }
  else { pm[flow] = { ...(pm[flow] ?? {}), [phase]: cell }; }
  if (pm[flow] && !Object.keys(pm[flow]).length) delete pm[flow];
  save({ phaseModels: pm }, `${flow}/${phase} → ${field} ${value || "default"}`);
};
```

Perluas blok `if (tab === "model")` (baris 380-396): pertahankan Card default global yang ada, lalu SETELAH `</Card>` default global, tambah Card matrix. Bungkus keduanya dengan fragment `<>…</>`. Opsi `Select` diberi opsi kosong "(default)" (value `""`).

```tsx
    if (tab === "model") return (
      <>
        <Card eyebrow="model" title="Model sesi — default global">
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Fallback untuk fase yang tak di-set di matrix. Di terminal, <code>/model</code> mengubahnya kapan saja.
          </div>
          <SettingRow title="Model">
            <Select size="sm" value={s.model} options={S_MODELS} style={{ width: 190 }}
              onChange={(e) => save({ model: e.target.value }, "Model → " + e.target.value)} />
          </SettingRow>
          <SettingRow title="Effort" last desc="Anggaran berpikir per giliran.">
            <Select size="sm" value={s.effort} options={S_EFFORT} style={{ width: 130 }}
              onChange={(e) => save({ effort: e.target.value }, "Effort → " + e.target.value)} />
          </SettingRow>
        </Card>
        <Card eyebrow="per-fase" title="Model & effort per fase">
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Tiap fase bisa pakai model & effort sendiri. Kosong = ikut default global. Sesi lahir dengan
            config fase pertama; ganti model aman-konteks. <b>Catatan:</b> <code>/effort</code> best-effort
            di Opus/Fable saat di tengah sesi (ditandai ⚠).
          </div>
          {FLOW_PHASES.map(({ flow, label, phases }) => (
            <div key={flow} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-subtle)", margin: "6px 0" }}>{label}</div>
              {phases.map((phase, i) => {
                const cell = s.phaseModels?.[flow]?.[phase] ?? {};
                const effOpus = isOpusLike(cell.model ?? s.model) && i > 0;
                return (
                  <SettingRow key={phase} title={phase} last={i === phases.length - 1}
                    desc={effOpus ? "⚠ effort best-effort (Opus/Fable di tengah sesi)" : undefined}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Select size="sm" value={cell.model ?? ""} style={{ width: 150 }}
                        options={[{ value: "", label: "(default)" }, ...S_MODELS]}
                        onChange={(e) => setPhase(flow, phase, "model", e.target.value)} />
                      <Select size="sm" value={cell.effort ?? ""} style={{ width: 120 }}
                        options={[{ value: "", label: "(default)" }, ...S_EFFORT]}
                        onChange={(e) => setPhase(flow, phase, "effort", e.target.value)} />
                    </div>
                  </SettingRow>
                );
              })}
            </div>
          ))}
        </Card>
      </>
    );
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run test/config-panel.test.tsx` (atau file test barumu)
Expected: PASS.

- [x] **Step 5: Typecheck + build frontend**

Run: `pnpm -w build` (atau `cd src && npx tsc --noEmit` jika ada script terpisah)
Expected: tanpa error TS. `Setting` kini mewajibkan `phaseModels` — pastikan `S_DEFAULTS` sudah memuatnya.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/SettingsScreen.tsx src/test/
git commit -m "feat(web): matrix model+effort per fase di Settings + Fable/max/ultracode — SPEC-238"
```

---

### Task 5: Verifikasi nyata di local (boot + curl) + full suite

**Files:** tidak ada (verifikasi).

- [x] **Step 1: Build semua paket**

Run: `pnpm -w build`
Expected: shared → runner → server → web semua sukses.

- [x] **Step 2: Full test suite bersih (tanpa env prod bocor)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm test` (atau `vitest run --no-file-parallelism` per paket)
Expected: hijau semua.

- [x] **Step 3: Boot server + curl round-trip /settings**

Boot server terhadap DB throwaway (jangan pakai hanoman_test yang bisa di-truncate sesi lain — lihat memory live-smoke). Lalu:

```bash
# GET awal
curl -s localhost:8787/api/settings | jq '.model,.effort,.phaseModels'
# PUT dengan override per-fase
curl -s -X PUT localhost:8787/api/settings -H 'content-type: application/json' \
  -d '{"model":"claude-opus-4-8","effort":"xhigh","autoDefault":true,"autoScaffold":true,"notifyFail":true,"notifyDone":true,"notifySound":"short","notifyDecision":true,"notifyDecisionSound":"alert","phaseModels":{"feature":{"Brainstorm":{"model":"claude-sonnet-5","effort":"high"},"Execute":{"effort":"max"}}}}' | jq '.phaseModels'
# GET lagi — pastikan phaseModels persist
curl -s localhost:8787/api/settings | jq '.phaseModels.feature'
```
Expected: `phaseModels.feature.Brainstorm = {model:"claude-sonnet-5",effort:"high"}`, `Execute = {effort:"max"}` — persist utuh.

- [x] **Step 4: Verifikasi launch model fase-1 (unit sudah menutup; catat di sini)**

Karena spawn sesi nyata = proses `claude` interaktif, verifikasi logika launch lewat unit `phaseModelsForFlow`/`resolvePhaseModels` (Task 2/3) dianggap cukup untuk argv; auth-gated `POST /terminal/sessions` tak di-curl agar tak men-spawn claude sungguhan (lihat memory browser-smoke). Centang setelah Step 2 hijau.

- [x] **Step 5: Update checklist plan & pastikan docs SoT ter-link**

Pastikan semua `- [x]` di plan ini `- [x]`, dan cek `internal/docs/README.md` memuat ADR-0058 (sudah ditulis di fase Spec). Bila ada sisa, perbaiki dulu.

- [x] **Step 6: Commit akhir (bila ada perubahan verifikasi)**

```bash
git add -A docs/superpowers/plans/
git commit -m "chore: verifikasi lokal SPEC-238 — /settings phaseModels round-trip + suite hijau"
```
