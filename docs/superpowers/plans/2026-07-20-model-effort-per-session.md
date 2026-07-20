# Model & Effort Per Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti mekanisme model/effort **per fase** (ADR-0058, tak andal karena bergantung agen mengetik `/model` di batas fase) dengan pemilihan model/effort **per sesi** yang dipilih saat Start backlog (andal: argv `--model`/`--effort` saat sesi lahir).

**Architecture:** Sesi tetap satu proses (ADR-0024/0015). Matrix `phaseModels` + injeksi prompt per-fase dicabut. `POST /terminal/sessions` untuk spec-flow menerima `model?`/`effort?` opsional; kosong → fallback setting global. UI Backlog Start menampilkan picker ter-prefill dari global. Detail: ADR-0061.

**Tech Stack:** TypeScript strict · zod (`@hanoman/shared`) · Fastify (server) · React+Vite (`src/`) · vitest + @testing-library/react.

## Global Constraints

- TypeScript strict; jalankan test repo dengan `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism` (hindari env prod bocor).
- Tanpa migration Prisma — `phaseModels` hidup di `Setting.data` (Json); dihapus dari skema **zod** saja. Baris lama yang masih memuatnya WAJIB tetap parse (z.object non-strict membuang key asing).
- Server tetap lenient: `model`/`effort` = `z.string()`. Daftar valid (`MODELS`/`EFFORTS`) hidup di UI, tetap diekspor `@hanoman/shared`.
- Default global fallback: `claude-opus-4-8` / `xhigh`.
- Docs yang tersentuh diperbarui dalam commit yang sama & ter-link di `internal/docs/README.md`.

---

### Task 1: Shared schema — cabut `phaseModels`, tambah `model`/`effort` opsional di zTerminalSession

**Files:**
- Modify: `shared/src/entities.ts` (hapus `zPhaseOverride`/`zPhaseModels`/type-nya + field `phaseModels` di `zSetting`; pertahankan `MODELS`/`EFFORTS`)
- Modify: `shared/src/dto.ts:125` (varian `{ spec, flow }` → `{ spec, flow, model?, effort? }`)
- Test: `shared/test/entities.test.ts`

- [x] **Step 1: Tulis test yang gagal** — ganti blok `describe("zSetting.phaseModels")` (baris ~91–104) dengan:

```ts
  // SPEC-252 · ADR-0061 — model & effort per sesi (matrix per-fase dicabut)
  describe("zSetting tanpa phaseModels", () => {
    const base = { model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true };
    it("zSetting tak lagi punya field phaseModels", () => {
      expect("phaseModels" in zSetting.parse(base)).toBe(false);
    });
    it("baris lama yang masih memuat phaseModels tetap parse (field diabaikan)", () => {
      const s = zSetting.parse({ ...base, phaseModels: { feature: { Brainstorm: { model: "claude-sonnet-5" } } } });
      expect("phaseModels" in s).toBe(false);
      expect(s.model).toBe("claude-opus-4-8");
    });
  });
```

  Dan tambah di blok `zTerminalSession` (cari `describe` DTO di `shared/test/dto.test.ts` bila ada; kalau tidak, tambah di entities.test.ts import `zTerminalSession`):

```ts
  it("zTerminalSession menerima spec+flow+model+effort", () => {
    const r = zTerminalSession.parse({ spec: "SPEC-1", flow: "qa", model: "claude-sonnet-5", effort: "high" });
    expect(r).toMatchObject({ spec: "SPEC-1", flow: "qa", model: "claude-sonnet-5", effort: "high" });
  });
  it("zTerminalSession spec+flow tanpa model/effort tetap valid", () => {
    expect(zTerminalSession.parse({ spec: "SPEC-1", flow: "qa" })).toMatchObject({ spec: "SPEC-1", flow: "qa" });
  });
```

- [x] **Step 2: Jalankan test → GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared vitest run entities`
Expected: FAIL (`phaseModels` masih ada / `zTerminalSession` belum punya model).

- [x] **Step 3: Edit `shared/src/entities.ts`** — hapus baris ~40–49 (`zPhaseOverride`, `zPhaseModels`, `PhaseOverride`, `PhaseModels`). Pertahankan `MODELS`/`EFFORTS` (baris ~51–58). Hapus baris `phaseModels: zPhaseModels.default({}),` dari `zSetting`.

- [x] **Step 4: Edit `shared/src/dto.ts:125`**:

```ts
  z.object({ spec: z.string(), flow: zFlow, model: z.string().optional(), effort: z.string().optional() }),
```

- [x] **Step 5: Jalankan test → LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared vitest run`
Expected: PASS.

- [x] **Step 6: Commit-titik** (commit tunggal di akhir pipeline; tandai step selesai).

---

### Task 2: Runner prompt — cabut mesin per-fase

**Files:**
- Modify: `runner/src/prompt.ts` (hapus `resolvePhaseModels`, type `PhaseModel`, `phaseModelInstruction`; hapus param `perPhase` + pemanggilannya dari `startPrompt`/`startProjectPrompt`/`startPrdPrompt`/`startScaffoldPrompt`)
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Produces: `startPrompt(flow, spec, branchTo)`, `startProjectPrompt(flow, project, branchTo)`, `startPrdPrompt(project, brief, branchTo)`, `startScaffoldPrompt(project, branchTo)` — tanpa arg `perPhase`.

- [x] **Step 1: Tulis/ubah test yang gagal** — di `runner/test/prompt.test.ts`: hapus import `resolvePhaseModels` (baris 2) dan seluruh blok `describe("resolvePhaseModels + prompt per-fase")` (baris ~305–335). Tambah:

```ts
describe("prompt tak lagi memuat instruksi model/effort per-fase (SPEC-252)", () => {
  it("startPrompt tak memuat blok per-fase", () => {
    const p = startPrompt("feature", spec, "b");
    expect(p).not.toContain("Model & effort per fase");
    expect(p).not.toContain("/model claude");
  });
});
```

- [x] **Step 2: Jalankan → GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner vitest run prompt`
Expected: FAIL kompilasi (`resolvePhaseModels` tak ada belum dihapus dari src → sebenarnya test import gagal). Setelah edit src akan lulus.

- [x] **Step 3: Edit `runner/src/prompt.ts`**:
  - Hapus `export type PhaseModel`, `export function resolvePhaseModels(...)` (baris ~13–30).
  - Hapus `const phaseModelInstruction = ...` (baris ~32–45).
  - `startPrompt`: hapus param `perPhase?: PhaseModel[]`, hapus baris `phaseModelInstruction(perPhase),`.
  - `startProjectPrompt`: hapus param `perPhase?`, hapus baris `phaseModelInstruction(perPhase),`.
  - `startPrdPrompt`: hapus param `perPhase?`, hapus baris `phaseModelInstruction(perPhase),`.
  - `startScaffoldPrompt`: hapus param `perPhase?`, hapus baris `phaseModelInstruction(perPhase),`.

- [x] **Step 4: Jalankan → LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner vitest run`
Expected: PASS.

- [x] **Step 5: Commit-titik.**

---

### Task 3: Server settings service — cabut `phaseModelsForFlow`

**Files:**
- Modify: `server/src/services/settings.ts` (hapus `phaseModelsForFlow`, `phaseModels` di `DEFAULT_SETTING`, import tak terpakai)
- Test: `server/test/settings.test.ts`

**Interfaces:**
- Produces: `sessionModel(): Promise<{ model: string; effort: string }>` (tetap), `getSetting()`, `DEFAULT_SETTING` (tanpa `phaseModels`).

- [x] **Step 1: Ubah test** — di `server/test/settings.test.ts`: hapus `phaseModelsForFlow` dari import (baris 4) dan seluruh blok `describe("phaseModelsForFlow")` (baris ~62–79). Tambah/pastikan:

```ts
  it("DEFAULT_SETTING tak punya phaseModels", () => {
    expect("phaseModels" in DEFAULT_SETTING).toBe(false);
  });
```

- [x] **Step 2: Jalankan → GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server vitest run settings`
Expected: FAIL (`phaseModelsForFlow` masih diekspor / DEFAULT masih punya phaseModels).

- [x] **Step 3: Edit `server/src/services/settings.ts`**:
  - Import baris 3: ganti `import { resolvePhaseModels, type PhaseModel, type Flow } from "@hanoman/runner";` → hapus seluruhnya (tak ada lagi yang pakai).
  - `DEFAULT_SETTING`: hapus baris `phaseModels: {},`.
  - Hapus fungsi `phaseModelsForFlow` (baris ~34–42).

- [x] **Step 4: Jalankan → LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server vitest run settings`
Expected: PASS.

- [x] **Step 5: Commit-titik.**

---

### Task 4: Server terminal route — override per-instance + buang plumbing perPhase

**Files:**
- Modify: `server/src/routes/terminal.ts` (import; spec-flow branch; reverse/scaffold/prd branch)
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `sessionModel()` dari Task 3; `startPrompt/startProjectPrompt/startPrdPrompt/startScaffoldPrompt` tanpa `perPhase` dari Task 2; `zTerminalSession` dengan `model?/effort?` dari Task 1.

- [x] **Step 1: Ubah import (baris 9)**: `import { sessionModel } from "../services/settings";` (hapus `phaseModelsForFlow`).

- [x] **Step 2: Spec-flow branch (baris ~76–114)** — ganti blok `phaseModelsForFlow`+`launch` dengan:

```ts
      // SPEC-252 · ADR-0061 · model/effort per SESI: default global, di-override per-instance dari body.
      const flow = parsed.data.flow;
      const g = await sessionModel();
      const model = parsed.data.model ?? g.model;
      const effort = parsed.data.effort ?? g.effort;
      const isContinue = spec.stage === "done";
```

  Lalu pada pemanggilan `createSession(...)`: `model, effort,` (bukan `launch.model/launch.effort`) dan `startPrompt(flow, brief, \`hanoman/${id}\`)` (tanpa `perPhase`). Hapus baris `launch` lama.

- [x] **Step 3: reverse branch (baris ~150–165)** — ganti `const { fallback, perPhase } = await phaseModelsForFlow("reverse"); const launch = ...` dengan `const { model, effort } = await sessionModel();`; pada `createSession` pakai `model, effort`; `startProjectPrompt("reverse", {...}, "reverse-docs")` tanpa `perPhase`.

- [x] **Step 4: scaffold branch (baris ~176–195)** — sama: `const { model, effort } = await sessionModel();`; `createSession` pakai `model, effort`; `startScaffoldPrompt({...}, "scaffold-docs")` tanpa `perPhase`.

- [x] **Step 5: prd branch (baris ~212–227)** — sama: `const { model, effort } = await sessionModel();`; `createSession` pakai `model, effort`; `startPrdPrompt({...}, brief, \`prd/${slug}\`)` tanpa `perPhase`.

- [x] **Step 6: Tulis route test** — di `server/test/terminal.route.test.ts` tambah (pakai fake claude bin bila tersedia; minimal 201 + sesi muncul):

```ts
  it("POST spec-flow dengan model/effort per-instance → 201 dan sesi dibuat", async () => {
    // spec fixture + repoDir sudah disiapkan beforeEach pola createSession()
    const res = await app.inject({ method: "POST", url: "/terminal/sessions",
      payload: { spec: SPEC_ID, flow: "qa", model: "claude-sonnet-5", effort: "high" } });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(listSessions().some((s) => s.id === id)).toBe(true);
  });
```

  (Sesuaikan `SPEC_ID`/`app` dengan helper existing di file. Verifikasi argv `--model` nyata dilakukan di Task 8 via smoke.)

- [x] **Step 7: Jalankan → LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server vitest run terminal`
Expected: PASS.

- [x] **Step 8: Commit-titik.**

---

### Task 5: Frontend — api client + StartSessionModal (picker per sesi)

**Files:**
- Modify: `src/src/api/client.ts:169` (signature `startSession`)
- Modify: `src/src/App.tsx` (state modal + `StartSessionModal` + rewire `startSession`)
- Test: `src/test/start-session-model.test.tsx` (baru)

**Interfaces:**
- Consumes: `api.getSettings()` (default), `MODELS`/`EFFORTS` dari `@hanoman/shared`.
- Produces: `api.startSession({ spec, flow, model?, effort? })`.

- [x] **Step 1: Edit `src/src/api/client.ts`**:

```ts
  startSession: (b: { spec: string; flow: Flow; model?: string; effort?: string }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body(b) }),
```

- [x] **Step 2: Tulis test yang gagal** — `src/test/start-session-model.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), startSession: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));

const spec = { id: "SPEC-9", source: "qa", projectId: "p1" } as any;
beforeEach(() => {
  (api.getSettings as any).mockResolvedValue({ model: "claude-opus-4-8", effort: "xhigh" });
});

describe("StartSessionModal (SPEC-252)", () => {
  it("prefill dari setting global lalu mengirim model/effort terpilih", async () => {
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    // prefill: model global tampil
    await waitFor(() => expect(screen.getByLabelText(/Model/i)).toHaveValue("claude-opus-4-8"));
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: "claude-sonnet-5" } });
    (api.startSession as any).mockResolvedValue({ id: "spec-9" });
    fireEvent.click(screen.getByRole("button", { name: /Mulai/i }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      { spec: "SPEC-9", flow: "qa", model: "claude-sonnet-5", effort: "xhigh" }));
    expect(onStarted).toHaveBeenCalled();
  });
});
```

- [x] **Step 3: Jalankan → GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web vitest run start-session-model` (nama paket web; cek `src/package.json` `name`).
Expected: FAIL (`StartSessionModal` belum diekspor).

- [x] **Step 4: Tambah `StartSessionModal` di `src/src/App.tsx`** (dekat NewSpecModal), diekspor:

```tsx
export function StartSessionModal({ open, spec, onClose, onStarted }:
  { open: boolean; spec: SpecLike | null; onClose: () => void; onStarted: (id: string) => void }) {
  const [model, setModel] = React.useState("claude-opus-4-8");
  const [effort, setEffort] = React.useState("xhigh");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    api.getSettings().then((s) => { setModel(s.model); setEffort(s.effort); }).catch(() => {});
  }, [open]);
  if (!spec) return null;
  const flow = flowForSource(spec.source);
  async function start() {
    if (!spec) return;
    setBusy(true);
    try { const { id } = await api.startSession({ spec: spec.id, flow, model, effort }); onStarted(id); onClose(); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} icon="play" eyebrow={`${spec.id} · ${flow}`} title="Mulai sesi"
      footer={<><Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button leftIcon="play" disabled={busy} onClick={start}>Mulai</Button></>}>
      <Field label="Model"><Select aria-label="Model" value={model}
        options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setModel(e.target.value)} style={{ width: "100%" }} /></Field>
      <Field label="Effort"><Select aria-label="Effort" value={effort}
        options={EFFORTS.map((v) => ({ value: v, label: v }))}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffort(e.target.value)} style={{ width: "100%" }} /></Field>
    </Modal>
  );
}
```

  Tambah `type SpecLike = { id: string; source: string; projectId: string }` (atau reuse `Spec`), import `MODELS, EFFORTS, flowForSource` dari `@hanoman/shared`, dan `Modal, Field, Select, Button` (sudah diimpor).

- [x] **Step 5: Rewire `startSession` di komponen App utama** — ganti `startSession(spec)` (baris ~514) agar membuka modal alih-alih langsung start:

```tsx
  const [startSpec, setStartSpec] = React.useState<Spec | null>(null);
  function startSession(spec: Spec) { setStartSpec(spec); }
```

  Dan render modal di JSX App (dekat modal lain):

```tsx
  <StartSessionModal open={!!startSpec} spec={startSpec} onClose={() => setStartSpec(null)}
    onStarted={(id) => { setSection("terminal"); showToast(`${startSpec?.id} · sesi ${id} dimulai`, "info", "play"); }} />
```

- [x] **Step 6: Jalankan → LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web vitest run start-session-model`
Expected: PASS.

- [x] **Step 7: Commit-titik.**

---

### Task 6: Frontend — buang matrix per-fase dari SettingsScreen

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx`
- Delete: `src/test/phase-models.test.tsx`
- Test: `src/test/settings-no-matrix.test.tsx` (baru, kecil)

- [x] **Step 1: Hapus `src/test/phase-models.test.tsx`** (menguji matrix yang dicabut).

- [x] **Step 2: Tulis test baru** `src/test/settings-no-matrix.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), putSettings: vi.fn(), getConfig: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));
const SETTING = { model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" };
const me = { id: "u1", email: "a@b.c" } as any;
beforeEach(() => { (api.getSettings as any).mockResolvedValue({ ...SETTING }); (api.putSettings as any).mockResolvedValue({ ...SETTING }); });

describe("Settings tanpa matrix per-fase (SPEC-252)", () => {
  it("tab Model menampilkan default global, TANPA matrix per-fase", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Model sesi"));
    expect(await screen.findByText(/Model sesi/i)).toBeInTheDocument();
    expect(screen.queryByText(/Model & effort per fase/i)).not.toBeInTheDocument();
  });
});
```

- [x] **Step 3: Jalankan → GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web vitest run settings-no-matrix`
Expected: FAIL (matrix masih ada).

- [x] **Step 4: Edit `src/src/screens/SettingsScreen.tsx`**:
  - Hapus `FLOW_PHASES` (baris ~24–32), `isOpusLike` (baris ~33).
  - Hapus `phaseModels: {},` dari `S_DEFAULTS`.
  - Di `prefs()` hapus fungsi `setPhase` (baris ~371–380).
  - Di `if (tab === "model")` hapus `<Card eyebrow="per-fase" title="Model & effort per fase">…</Card>` seluruhnya (baris ~421–449). Perbarui teks kartu global: hapus kalimat "Fallback untuk fase yang tak di-set di matrix." → ganti "Default untuk sesi baru; bisa di-override saat Start. Di terminal, /model mengubahnya kapan saja."

- [x] **Step 5: Jalankan → LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web vitest run settings-no-matrix`
Expected: PASS.

- [x] **Step 6: Commit-titik.**

---

### Task 7: Docs SoT sync + index

**Files:**
- Modify: `internal/docs/architecture/api-contract.md` (blok Settings + Terminal POST)
- Modify: `internal/docs/README.md` (link ADR-0061; tandai 0058 amended)
- Modify: `internal/skills/hanoman/SKILL.md` (baris ~74 "Model & effort per fase")
- Modify: `internal/docs/architecture/stack.md`, `internal/docs/architecture/data-model.md`, `internal/docs/frontend/frontend-implementation.md` (rujukan per-fase → per-sesi)
- (ADR-0061 sudah ditulis di fase Spec.)

- [x] **Step 1: api-contract.md** — hapus baris `phaseModels: …` (174–175) di blok `/settings`; pada `POST /terminal/sessions {spec, flow}` tambah `, model?, effort?` + catatan "SPEC-252/ADR-0061: model/effort per sesi (opsional; kosong → global)".

- [x] **Step 2: README.md** — tambah di daftar ADR: `- [0061 — Model & effort per sesi (picker saat Start), mencabut matrix per-fase](adr/0061-model-effort-per-sesi-picker-start.md) — **mengamandemen 0058** (SPEC-252)`. Ubah baris 0058 menjadi `… — **mengamandemen 0024 … · sebagian dicabut oleh 0061**`.

- [x] **Step 3: SKILL.md baris ~74** — ganti paragraf "Model & effort per fase … in-session" menjadi ringkasan per-sesi: sesi lahir dengan model/effort global (default) atau override yang dipilih saat Start (ADR-0061); satu proses satu model seumur hidup; matrix per-fase (ADR-0058) dicabut; manusia tetap bisa `/model` manual.

- [x] **Step 4: stack.md / data-model.md / frontend-implementation.md** — cari string "per fase"/"phaseModels"/"SPEC-238" yang menyiratkan matrix aktif; perbarui ke per-sesi (ADR-0061) atau tandai historis. Jalankan `grep -rn "phaseModels\|per fase\|SPEC-238" internal/docs/architecture internal/docs/frontend` lalu sunting tiap hit agar akurat.

- [x] **Step 5: Verifikasi index utuh** — Run: `env -u NODE_ENV -u DATABASE_URL node --experimental-strip-types shared/src/coverage.ts 2>/dev/null || true` (opsional). Minimal: pastikan ADR-0061 ter-link di README.

- [x] **Step 6: Commit-titik.**

---

### Task 8: Verifikasi penuh (build + test + smoke API nyata)

**Files:** — (tanpa perubahan; gerbang keluar)

- [x] **Step 1: Typecheck + build semua paket**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm -r build` (atau `pnpm -r typecheck` bila ada).
Expected: sukses tanpa error TS (khususnya import `phaseModels`/`resolvePhaseModels`/`phaseModelsForFlow` yang sudah tak ada).

- [x] **Step 2: Test seluruh workspace**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism`
Expected: seluruh test hijau.

- [x] **Step 3: Smoke API nyata — override sampai ke argv** — boot server terhadap DB throwaway ter-migrate; set `HANOMAN_CLAUDE_BIN` ke script yang menuliskan argv-nya ke berkas, lalu:

```bash
# fake claude yang merekam argv
printf '#!/bin/sh\necho "$@" >> /tmp/hanoman-claude-argv\n' > /tmp/fake-claude && chmod +x /tmp/fake-claude
# boot server (DB unik, port bukan 8787) — lihat memory "live-smoke dedicated DB"
# POST /terminal/sessions {spec, flow:"qa", model:"claude-sonnet-5", effort:"high"}
# grep /tmp/hanoman-claude-argv → HARUS memuat: --model claude-sonnet-5 --effort high
# POST tanpa model/effort → HARUS memuat default global --model claude-opus-4-8 --effort xhigh
```

Expected: argv sesi berisi model/effort dari body saat dikirim; global saat tidak.

- [x] **Step 4: Konfirmasi checklist plan penuh `- [x]`, lalu tulis `Execute done` ke `$HANOMAN_PHASE_FILE`.**

- [x] **Step 5: Commit final + push** ke `hanoman/spec-252`.

---

## Self-Review

- **Spec coverage:** AC-1 (picker prefill) → Task 5. AC-2 (override ke argv) → Task 4 + Task 8 smoke. AC-3 (fallback global) → Task 4 + Task 8. AC-4 (prompt tanpa per-fase) → Task 2. AC-5 (baris lama parse) → Task 1. AC-6 (Settings tanpa matrix) → Task 6. ✔
- **Placeholder scan:** tiap step berkode memuat kode nyata; tak ada TODO/TBD. ✔
- **Type consistency:** `sessionModel()` (Task 3) dipakai Task 4; `startSession({spec,flow,model?,effort?})` (Task 5 client) cocok dengan zTerminalSession (Task 1); prompt tanpa `perPhase` (Task 2) dipakai Task 4. ✔
- **Catatan cakupan:** picker hanya di Backlog Start (App). TerminalScreen `pickBacklog` & flow project-level pakai default global — sengaja (ADR-0061 §5). ✔
