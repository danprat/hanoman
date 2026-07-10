# Mengembalikan State Backlog (SPEC-167) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Human bisa memundurkan `Spec.stage` ke stage lebih awal mana pun (maju/loncat ditolak), sekaligus membersihkan artefak docs superpowers milik fase di atas target — dengan dry-run + konfirmasi UI.

**Architecture:** Perpanjang `PATCH /specs/:id` yang sudah ada (bukan endpoint baru). Guard backward-only adalah cermin terbalik dari guard forward-only di `advanceStage()` (`terminal.ts:24`). Pencocokan artefak (konvensi penamaan superpowers by spec-id) hidup di satu service server; penghapusan reuse `deleteDoc` yang sudah ter-guard. Frontend menambah dropdown revert di modal detail + dialog konfirmasi dua-langkah.

**Tech Stack:** TypeScript strict, Fastify, Prisma/Postgres, Zod (`@hanoman/shared`), React (Vite), Vitest.

## Global Constraints

- **Hanya backward.** `STAGES.indexOf(target) < STAGES.indexOf(current)`; sama/maju → `422`.
- Lifecycle: `["brainstorming","objective","spec-ready","planned","executing","done"]` (`server/src/services/stage-machine.ts:2`).
- **Kode & commit Execute tak pernah dihapus.** Hanya dua jenis docs superpowers ber-spec-id: `docs/superpowers/specs/*` (stage `spec-ready`) dan `docs/superpowers/plans/*` (stage `planned`).
- Aturan hapus: artefak stage `S` di mana `target < S ≤ current`. `done→objective` hapus keduanya; `done→spec-ready` hapus plans saja; `done→planned` hapus tak ada.
- Boundary spec-id: `spec-16` tak boleh menyerempet `spec-167`.
- Best-effort delete: kegagalan hapus satu berkas tak membatalkan perubahan stage.
- TypeScript strict, test tiap logika, update `internal/docs` di commit yang sama.
- Test server: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test` (hindari NODE_ENV/DATABASE_URL prod dari shell — lihat catatan repo). Typecheck: `pnpm typecheck`.

---

## File Structure

- **Create** `server/src/services/stage-artifacts.ts` — `artifactsToRemove()`: pemetaan stage→artefak + pencocokan by spec-id. Satu tanggung jawab, murni-ish (baca DB repoDir + git ls-files).
- **Create** `server/test/stage-artifacts.test.ts` — unit test matcher.
- **Modify** `shared/src/dto.ts:21` — `zPatchSpec` terima `stage?` + `confirmDelete?`, `branchFrom` jadi opsional.
- **Modify** `server/src/routes/specs.ts:42-55` — PATCH handler: guard 422, dry-run, eksekusi hapus.
- **Modify** `server/test/specs.route.test.ts` — test revert.
- **Modify** `src/src/api/client.ts:27-28` — `patchSpec` signature + tipe respons union.
- **Modify** `src/src/screens/BacklogScreen.tsx` — dropdown revert di `SpecDetail` + dialog konfirmasi.
- **Modify** `src/src/App.tsx:388-395` — handler `revertStage`, wiring ke `BacklogScreen`.
- **Modify** `src/test/backlog-board.test.tsx` (atau file baru `src/test/revert-stage.test.tsx`) — test UI revert.
- **Modify** `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`; **Create** ADR baru (nomor diverifikasi lintas branch).

---

## Task 1: Artifact matcher service

**Files:**
- Create: `server/src/services/stage-artifacts.ts`
- Test: `server/test/stage-artifacts.test.ts`

**Interfaces:**
- Consumes: `listRepoDocs(repoDir)` from `../services/scan`, `STAGES` from `../services/stage-machine`, `prisma` from `../db`, `Stage` from `@hanoman/shared`.
- Produces: `artifactsToRemove(projectId: string, specId: string, target: Stage, current: Stage): Promise<string[]>` — daftar path repo-relatif (.md) yang harus dihapus saat revert `current`→`target`.

- [ ] **Step 1: Write the failing test**

Create `server/test/stage-artifacts.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb, makeProject, makeTempRepo } from "./factory";
import { artifactsToRemove } from "../src/services/stage-artifacts";

// Repo dengan artefak superpowers dua spec bertetangga (167 & 16) untuk uji boundary.
const repo = makeTempRepo({
  "docs/superpowers/specs/2026-07-11-x-spec-167-design.md": "s",
  "docs/superpowers/plans/2026-07-11-x-spec-167.md": "p",
  "docs/superpowers/specs/2026-07-11-y-spec-16-design.md": "s16",
  "internal/docs/README.md": "root",
});

beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1", repoDir: repo });
});

describe("artifactsToRemove", () => {
  it("done→objective menghapus artefak spec-ready DAN planned", async () => {
    const out = await artifactsToRemove("p1", "SPEC-167", "objective", "done");
    expect(out.sort()).toEqual([
      "docs/superpowers/plans/2026-07-11-x-spec-167.md",
      "docs/superpowers/specs/2026-07-11-x-spec-167-design.md",
    ]);
  });
  it("done→spec-ready menghapus hanya artefak planned", async () => {
    const out = await artifactsToRemove("p1", "SPEC-167", "spec-ready", "done");
    expect(out).toEqual(["docs/superpowers/plans/2026-07-11-x-spec-167.md"]);
  });
  it("done→planned tak menghapus apa pun (execute/done tanpa artefak berkas)", async () => {
    expect(await artifactsToRemove("p1", "SPEC-167", "planned", "done")).toEqual([]);
  });
  it("spec-16 tak menyerempet spec-167", async () => {
    const out = await artifactsToRemove("p1", "SPEC-16", "objective", "done");
    expect(out).toEqual(["docs/superpowers/specs/2026-07-11-y-spec-16-design.md"]);
  });
  it("project tanpa repoDir → kosong", async () => {
    await makeProject({ id: "p2", repoDir: null });
    expect(await artifactsToRemove("p2", "SPEC-167", "objective", "done")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run stage-artifacts`
Expected: FAIL — `Cannot find module '../src/services/stage-artifacts'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/services/stage-artifacts.ts`:

```ts
import type { Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { listRepoDocs } from "./scan";
import { STAGES } from "./stage-machine";

// Konvensi penamaan superpowers docs by spec-id adalah satu-satunya pemetaan fase→berkas
// yang andal di repo ini. Stage yang tak tercantum tak punya artefak berkas: `objective`
// hidup sebagai kolom DB, dan artefak Execute = kode/commit yang TAK PERNAH dihapus otomatis.
const ARTIFACT_DIR: Partial<Record<Stage, string>> = {
  "spec-ready": "docs/superpowers/specs/",
  planned: "docs/superpowers/plans/",
};

// Berkas yang dihapus saat revert `current`→`target`: artefak tiap stage S dengan
// target < S <= current. Cocok bila path di bawah dir stage itu DAN memuat segmen spec-id
// dengan batas kiri non-alnum & kanan non-digit — `spec-16` tak menyerempet `spec-167`.
export async function artifactsToRemove(
  projectId: string, specId: string, target: Stage, current: Stage,
): Promise<string[]> {
  const ti = STAGES.indexOf(target), ci = STAGES.indexOf(current);
  const dirs = STAGES
    .filter((_, i) => i > ti && i <= ci)
    .map((s) => ARTIFACT_DIR[s])
    .filter((d): d is string => !!d);
  if (!dirs.length) return [];
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { repoDir: true } });
  if (!project?.repoDir) return [];
  const id = specId.toLowerCase();
  const re = new RegExp(`(^|[^a-z0-9])${id}([^0-9]|$)`);
  const files = await listRepoDocs(project.repoDir);
  return files.filter((f) => dirs.some((d) => f.startsWith(d)) && re.test(f.toLowerCase()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run stage-artifacts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/stage-artifacts.ts server/test/stage-artifacts.test.ts
git commit -m "feat(server): matcher artefak fase→docs by spec-id (SPEC-167)"
```

---

## Task 2: PATCH /specs/:id — revert stage backward-only + dry-run + hapus artefak

**Files:**
- Modify: `shared/src/dto.ts:21`
- Modify: `server/src/routes/specs.ts:42-55` (dan imports di atas file)
- Test: `server/test/specs.route.test.ts` (tambah blok revert)

**Interfaces:**
- Consumes: `artifactsToRemove` (Task 1), `STAGES` from `../services/stage-machine`, `deleteDoc` from `../services/docs`, `Stage` from `@hanoman/shared`.
- Produces: `PATCH /specs/:id` menerima `{ branchFrom?, stage?, confirmDelete? }`. Respons: `Spec` (eksekusi/branch), atau `200 { pending: true, stage, wouldDelete: string[] }` (dry-run), `422` (maju/sama), `400` (body/stage cacat), `404` (spec tak ada).

- [ ] **Step 1: Extend the DTO**

Modify `shared/src/dto.ts`. Ganti import enums (baris ~3) untuk memuat `zStage`:

```ts
import { zProjectKind, zSpecSource, zPriority, zStage } from "./enums";
```

Ganti baris 21 (`zPatchSpec`):

```ts
// branchFrom: nullable+optional — `null` mengosongkan (kembali ke default project),
// `undefined` berarti jangan sentuh. stage: revert backward-only (SPEC-167); confirmDelete
// mengizinkan penghapusan artefak setelah dry-run.
export const zPatchSpec = z.object({
  branchFrom: z.string().min(1).nullable().optional(),
  stage: zStage.optional(),
  confirmDelete: z.boolean().optional(),
});
```

- [ ] **Step 2: Write the failing route tests**

Di `server/test/specs.route.test.ts`, ubah `beforeAll` untuk memakai repo ber-artefak dan spec `done`, lalu tambah blok test. Ganti baris 6-13 (`beforeAll`) jadi:

```ts
import { resetDb, makeProject, makeSpec, makeRepoWithBranches, makeTempRepo } from "./factory";
// ...
let artifactRepo: string;
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1", repoDir: makeRepoWithBranches("dev") });
  await makeSpec({ id: "SPEC-140", projectId: "p1", stage: "brainstorming" });
  await makeSpec({ id: "SPEC-137", projectId: "p1", stage: "done" });
  await makeSpec({ id: "SPEC-142", projectId: "p1", stage: "planned" });
  // Project + spec khusus uji revert-dengan-artefak.
  artifactRepo = makeTempRepo({
    "docs/superpowers/specs/2026-07-11-x-spec-200-design.md": "s",
    "docs/superpowers/plans/2026-07-11-x-spec-200.md": "p",
  });
  await makeProject({ id: "p2", repoDir: artifactRepo });
  await makeSpec({ id: "SPEC-200", projectId: "p2", stage: "done" });
});
```

Tambahkan blok test ini di dalam `describe("specs routes", ...)`:

```ts
  // SPEC-167 — revert stage backward-only
  it("reverts stage backward (no artefak) → 200 + stage baru", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-142", payload: { stage: "objective" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe("objective");
  });
  it("rejects a forward/same stage with 422", async () => {
    const up = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { stage: "planned" } });
    expect(up.statusCode).toBe(422);
    const same = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-137", payload: { stage: "done" } });
    expect(same.statusCode).toBe(422);
  });
  it("400s on an unknown stage value", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-137", payload: { stage: "hantu" } });
    expect(res.statusCode).toBe(400);
  });
  it("dry-run: artefak ada tanpa confirmDelete → pending + wouldDelete, tak mengubah apa pun", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-200", payload: { stage: "objective" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().pending).toBe(true);
    expect(res.json().wouldDelete.sort()).toEqual([
      "docs/superpowers/plans/2026-07-11-x-spec-200.md",
      "docs/superpowers/specs/2026-07-11-x-spec-200-design.md",
    ]);
    // stage utuh
    const after = await app.inject({ url: "/api/specs?project=p2" });
    expect(after.json().find((s: any) => s.id === "SPEC-200").stage).toBe("done");
    // berkas utuh
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(artifactRepo, "docs/superpowers/plans/2026-07-11-x-spec-200.md"))).toBe(true);
  });
  it("execute: confirmDelete true → stage berubah + berkas terhapus dari disk", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-200",
      payload: { stage: "objective", confirmDelete: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe("objective");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(artifactRepo, "docs/superpowers/plans/2026-07-11-x-spec-200.md"))).toBe(false);
    expect(existsSync(join(artifactRepo, "docs/superpowers/specs/2026-07-11-x-spec-200-design.md"))).toBe(false);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run specs.route`
Expected: FAIL — revert cases return 200-with-branchFrom-only / tak ada guard 422; `pending` undefined.

- [ ] **Step 4: Implement the route**

Di `server/src/routes/specs.ts`, tambah imports (di bawah import yang ada, baris ~5):

```ts
import type { Stage } from "@hanoman/shared";
import { STAGES } from "../services/stage-machine";
import { artifactsToRemove } from "../services/stage-artifacts";
import { deleteDoc } from "../services/docs";
```

Ganti seluruh handler `app.patch("/specs/:id", ...)` (baris 42-55) dengan:

```ts
  // branchFrom (SPEC-143): basis run berikutnya. stage (SPEC-167): revert backward-only,
  // cermin terbalik dari guard forward-only advanceStage() di terminal.ts. Saat mundur,
  // artefak docs fase di atas target dibersihkan lewat dry-run + confirmDelete.
  app.patch("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPatchSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const spec = await prisma.spec.findUnique({ where: { id } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    const { branchFrom, stage, confirmDelete } = parsed.data;
    if (branchFrom) {
      const project = await prisma.project.findUnique({ where: { id: spec.projectId } });
      if (branchUnknown(project?.repoDir ?? null, branchFrom))
        return reply.code(400).send({ error: `branch "${branchFrom}" tidak ada di repo project` });
    }
    if (stage !== undefined) {
      if (STAGES.indexOf(stage) >= STAGES.indexOf(spec.stage as Stage))
        return reply.code(422).send({ error: "stage hanya boleh dikembalikan mundur" });
      const wouldDelete = await artifactsToRemove(spec.projectId, spec.id, stage, spec.stage as Stage);
      if (wouldDelete.length && confirmDelete !== true)
        return reply.send({ pending: true, stage, wouldDelete });
      for (const rel of wouldDelete) await deleteDoc(spec.projectId, rel).catch(() => {});
    }
    const data: { branchFrom?: string | null; stage?: string } = {};
    if (branchFrom !== undefined) data.branchFrom = branchFrom;
    if (stage !== undefined) data.stage = stage;
    return prisma.spec.update({ where: { id }, data });
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run specs.route`
Expected: PASS (semua, termasuk regresi branchFrom lama). Lalu `pnpm typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/dto.ts server/src/routes/specs.ts server/test/specs.route.test.ts
git commit -m "feat(server): PATCH /specs/:id revert stage backward-only + dry-run hapus artefak (SPEC-167)"
```

---

## Task 3: Frontend — dropdown revert + dialog konfirmasi

**Files:**
- Modify: `src/src/api/client.ts:27-28`
- Modify: `src/src/screens/BacklogScreen.tsx` (`SpecDetail`, sekitar baris 70-109 + props chain)
- Modify: `src/src/App.tsx:388-395` (handler + wiring baris ~470-472)
- Test: `src/test/revert-stage.test.tsx` (baru)

**Interfaces:**
- Consumes: `api.patchSpec` (Task 2 shape), `Stage`/`B_STAGES` lokal.
- Produces: `revertStage(spec, target, confirmDelete?)` di App; prop `onRevertStage` diteruskan `BacklogScreen`→`SpecDetail`.

- [ ] **Step 1: Update the API client**

Di `src/src/api/client.ts`, tambah tipe (dekat `TerminalSession`, ~baris 6):

```ts
export type RevertPending = { pending: true; stage: string; wouldDelete: string[] };
```

Ganti `patchSpec` (baris 27-28):

```ts
  patchSpec: (id: string, b: { branchFrom?: string | null; stage?: string; confirmDelete?: boolean }) =>
    j<Spec | RevertPending>(paths.spec(id), { method: "PATCH", ...body(b) }),
```

- [ ] **Step 2: Write the failing UI test**

Create `src/test/revert-stage.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
// SpecDetail memuat branches lewat api.listBranches di useEffect — mock supaya tak fetch nyata.
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec: Spec = {
  id: "SPEC-167", projectId: "p1", title: "T", source: "brief", stage: "planned",
  priority: "tinggi", author: "Rangga", objective: "obj", payload: {}, branchFrom: null,
} as Spec;

function renderScreen(onRevertStage: any) {
  return render(
    <BacklogScreen backlog={[spec]} projects={[{ id: "p1", name: "p1" } as any]}
      projectFilter="all" onProjectFilter={() => {}} onRevertStage={onRevertStage} />,
  );
}

describe("revert stage", () => {
  it("dropdown revert hanya menawarkan stage lebih awal dari current", async () => {
    renderScreen(vi.fn());
    fireEvent.click(screen.getByText("T"));                // buka detail modal
    const sel = await screen.findByLabelText("Kembalikan stage");
    const opts = [...sel.querySelectorAll("option")].map((o) => o.value).filter(Boolean);
    // current = planned → hanya brainstorming, objective, spec-ready
    expect(opts).toEqual(["brainstorming", "objective", "spec-ready"]);
  });

  it("pilih stage → panggil onRevertStage; jika pending, konfirmasi memanggil lagi dgn confirmDelete", async () => {
    const onRevert = vi.fn()
      .mockResolvedValueOnce({ pending: true, stage: "objective", wouldDelete: ["docs/superpowers/plans/x-spec-167.md"] })
      .mockResolvedValueOnce({ ...spec, stage: "objective" });
    renderScreen(onRevert);
    fireEvent.click(screen.getByText("T"));
    const sel = await screen.findByLabelText("Kembalikan stage");
    fireEvent.change(sel, { target: { value: "objective" } });
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith(spec, "objective", undefined));
    // dialog konfirmasi menampilkan berkas
    expect(await screen.findByText(/x-spec-167\.md/)).toBeTruthy();
    fireEvent.click(screen.getByText("Hapus & kembalikan"));
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith(spec, "objective", true));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run revert-stage`
Expected: FAIL — `onRevertStage` prop belum ada, `findByLabelText("Kembalikan stage")` tak ketemu.

- [ ] **Step 4: Implement SpecDetail revert UI**

Di `src/src/screens/BacklogScreen.tsx`, ubah `SpecDetail` untuk menerima `onRevertStage` dan render dropdown + dialog. Ganti signature (baris 70-71):

```tsx
function SpecDetail({ spec, onClose, onEditBranch, onRevertStage }:
  { spec: Spec | null; onClose: () => void; onEditBranch?: (s: Spec, b: string | null) => void;
    onRevertStage?: (s: Spec, target: string, confirmDelete?: boolean) => Promise<any> }) {
```

Tambah state + handler tepat setelah hook `useEffect` branches (setelah baris 82, sebelum `if (!spec) return null;`):

```tsx
  const [confirm, setConfirm] = React.useState<{ target: string; files: string[] } | null>(null);
  const earlier = spec ? B_STAGES.slice(0, bStageIndex(spec.stage)) : [];
  async function pickStage(target: string) {
    if (!spec || !onRevertStage) return;
    const res = await onRevertStage(spec, target);
    if (res && res.pending) setConfirm({ target, files: res.wouldDelete });
  }
  async function confirmRevert() {
    if (!spec || !onRevertStage || !confirm) return;
    await onRevertStage(spec, confirm.target, true);
    setConfirm(null); onClose();
  }
```

Tambah kontrol revert tepat setelah `<StageBar>` (baris 97). Ganti baris 97 jadi:

```tsx
      <div style={{ marginBottom: 18 }}>
        <StageBar stage={spec.stage} />
        {onRevertStage && earlier.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Kembalikan stage</div>
            <Select size="sm" aria-label="Kembalikan stage" value=""
              onChange={(e) => e.target.value && pickStage(e.target.value)}
              options={[{ value: "", label: "Pilih stage lebih awal…" }]
                .concat(earlier.map((s) => ({ value: s.key, label: "← " + s.label })))} />
          </div>
        )}
      </div>
```

Tambah dialog konfirmasi sebelum `</Modal>` (sebelum baris 107). Sisipkan:

```tsx
      {confirm && (
        <Modal open title="Kembalikan stage & hapus artefak" icon="rotate-ccw"
          eyebrow={spec.id + " → " + confirm.target} onClose={() => setConfirm(null)}>
          <div style={{ fontSize: 13.5, color: "var(--text-strong)", marginBottom: 12 }}>
            {confirm.files.length} berkas docs akan dihapus dari disk (kode & commit tak disentuh):
          </div>
          <ul style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)",
            marginBottom: 16, paddingLeft: 18 }}>
            {confirm.files.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button size="sm" variant="primary" leftIcon="trash-2" onClick={confirmRevert}>Hapus & kembalikan</Button>
          </div>
        </Modal>
      )}
```

Teruskan prop lewat `BacklogScreen`. Di signature `BacklogScreen` (baris 341-346) tambah `onRevertStage`:

```tsx
export function BacklogScreen({ backlog, projects, pageSize = 20, onStart, activeSpecs, onDelete, onOpenRun, onNew, onEditBranch, onRevertStage, projectFilter, onProjectFilter }:
  { backlog: Spec[]; projects: ProjectVM[]; pageSize?: number;
    onStart?: (s: Spec) => void; activeSpecs?: Set<string>;
    onDelete?: (s: Spec) => void; onOpenRun?: (s: Spec) => void; onNew?: () => void;
    onEditBranch?: (s: Spec, b: string | null) => void;
    onRevertStage?: (s: Spec, target: string, confirmDelete?: boolean) => Promise<any>;
    projectFilter: string; onProjectFilter: (id: string) => void }) {
```

Dan di render `<SpecDetail>` (baris 406-407) tambah prop:

```tsx
      <SpecDetail spec={backlog.find((s) => s.id === detailId) || null} onClose={() => setDetailId(null)}
        onEditBranch={onEditBranch} onRevertStage={onRevertStage} />
```

- [ ] **Step 5: Wire the App handler**

Di `src/src/App.tsx`, tambah handler setelah `editBranch` (setelah baris 395):

```tsx
  // SPEC-167 · revert backward-only. Respons `pending` = dry-run: kembalikan ke pemanggil
  // supaya dialog konfirmasi muncul; hanya panggilan confirmDelete yang mengubah state.
  async function revertStage(spec: Spec, target: string, confirmDelete?: boolean) {
    try {
      const res = await api.patchSpec(spec.id, { stage: target, confirmDelete });
      if ("pending" in res) return res;
      setBacklog((b) => b.map((s) => (s.id === res.id ? res : s)));
      showToast(spec.id + " dikembalikan ke " + target, "warn", "rotate-ccw");
      return res;
    } catch { showToast("Gagal mengembalikan stage " + spec.id, "err", "x-circle"); return undefined; }
  }
```

Teruskan ke `BacklogScreen` (baris ~470-472, dekat `onEditBranch={editBranch}`):

```tsx
          onDelete={deleteSpec} onOpenRun={() => setSection("terminal")} onEditBranch={editBranch}
          onRevertStage={revertStage}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run revert-stage`
Expected: PASS (2 tests). Lalu `pnpm typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/screens/BacklogScreen.tsx src/src/App.tsx src/test/revert-stage.test.tsx
git commit -m "feat(web): dropdown revert stage + dialog konfirmasi hapus artefak (SPEC-167)"
```

---

## Task 4: Docs + ADR

**Files:**
- Modify: `internal/docs/architecture/data-model.md:13-20`
- Modify: `internal/docs/architecture/api-contract.md:22-29`
- Create: `internal/docs/adr/00NN-revert-stage-backward-only.md` (nomor diverifikasi lintas branch)

- [ ] **Step 1: Verify next ADR number across all branches**

Run:
```bash
git branch -a
git ls-files internal/docs/adr | sed 's#.*/##' | sort | tail -3
for b in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null; done | sed 's#.*/##' | grep -oE '^[0-9]{4}' | sort -u | tail -3
```
Expected: tertinggi `0026` → pakai `0027`. Kalau branch lain sudah pakai `0027`, ambil berikutnya.

- [ ] **Step 2: Write the ADR**

Create `internal/docs/adr/0027-revert-stage-backward-only.md` (sesuaikan nomor):

```markdown
# ADR-0027 — Stage boleh mundur atas perintah human eksplisit

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-167
**Mengamandemen:** ADR-0008 (stage cermin fase, monotonic-forward), ADR-0024

## Context
`Spec.stage` adalah cermin monotonic-forward dari fase yang dilaporkan agen (ADR-0008,
ADR-0024). Satu-satunya penulis, `advanceStage()`, menolak gerak mundur (`terminal.ts:24`).
Tak ada jalur bagi human untuk mengembalikan item ke fase lebih awal saat ingin mengulang.

## Decision
Human boleh memundurkan `Spec.stage` ke stage lebih awal mana pun lewat
`PATCH /specs/:id { stage }`. Guard backward-only (`indexOf(target) < indexOf(current)`,
else 422) adalah cermin terbalik dari guard forward-only agen — agen tetap forward-only.
Saat mundur, artefak docs superpowers ber-spec-id milik fase di atas target dibersihkan
lewat dry-run + `confirmDelete` (daftar berkas dikonfirmasi human di UI). Kode & commit
Execute tak pernah dihapus otomatis.

## Consequences
- Stage bukan lagi murni monotonic; forward hanya lewat agen, backward hanya lewat human.
- Sesi lama yang ditutup setelah revert wajar memajukan stage lagi (guard forward-only) —
  diterima; revert adalah reset niat, bukan penguncian.
- Penghapusan artefak reuse `deleteDoc` (guard `.md` + dalam-repo), sama seperti
  `DELETE /projects/:id/docs/*path`. Proyek tanpa dir superpowers → no-op.
```

- [ ] **Step 3: Update data-model.md**

Di `internal/docs/architecture/data-model.md`, pada blok `## Spec (backlog item)` (baris 15), setelah baris `stage` tambahkan:

```markdown
- `stage` bergerak **maju** hanya lewat fase yang dilaporkan agen (ADR-0008/0024) dan
  **mundur** hanya lewat aksi human eksplisit `PATCH /specs/:id { stage }` (backward-only,
  SPEC-167/ADR-0027). Mundur juga membersihkan artefak docs superpowers ber-spec-id fase
  di atas target; kode/commit Execute tak pernah dihapus.
```

- [ ] **Step 4: Update api-contract.md**

Di `internal/docs/architecture/api-contract.md`, ganti blok `PATCH /specs/:id` (baris 23-27) jadi:

```markdown
PATCH /specs/:id          { branchFrom?: string|null, stage?, confirmDelete? }   -> Spec
#   branchFrom null = kembali ke default project (main); menentukan basis run BERIKUTNYA.
#   stage = revert backward-only (SPEC-167): 422 bila maju/sama; 400 bila stage tak dikenal.
#   Bila mundur menghapus artefak docs & confirmDelete≠true → 200 { pending:true, stage,
#   wouldDelete:string[] } (dry-run, tak mengubah apa pun). confirmDelete:true → hapus +
#   set stage. Agen tetap forward-only (ADR-0008/0024, diamandemen ADR-0027).
```

- [ ] **Step 5: Verify docs link integrity + typecheck + full suite**

Run:
```bash
pnpm typecheck
env -u NODE_ENV -u DATABASE_URL pnpm test
```
Expected: typecheck PASS; seluruh suite hijau. (Pastikan ADR baru reachable dari index bila index ADR mendaftar per-berkas — cek `internal/docs/adr/README.md` bila ada; tambah tautan di commit yang sama.)

- [ ] **Step 6: Commit**

```bash
git add internal/docs/adr/0027-revert-stage-backward-only.md internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md
git commit -m "docs(spec-167): stage boleh mundur (ADR-0027) + data-model + api-contract"
```

---

## Manual verification (setelah semua task, sebelum tandai selesai)

Boot server nyata & curl endpoint (per CLAUDE.md — jangan hanya andalkan unit test):

```bash
# 1. Boot API di DB dev (bukan prod)
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server dev &
# 2. Ambil satu spec, catat id & stage
curl -s localhost:3000/api/specs | head
# 3. Forward ditolak
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH localhost:3000/api/specs/<ID> \
  -H 'content-type: application/json' -d '{"stage":"done"}'      # → 422
# 4. Backward (tanpa artefak) → 200 + stage baru
curl -s -X PATCH localhost:3000/api/specs/<ID> -H 'content-type: application/json' \
  -d '{"stage":"objective"}'
# 5. Dry-run pada spec ber-artefak → { pending:true, wouldDelete:[...] }, lalu confirmDelete:true
```
Verifikasi di UI: buka backlog, klik judul spec, pilih stage lebih awal; untuk spec ber-artefak dialog konfirmasi muncul dengan daftar berkas; setelah konfirmasi StageBar mundur & berkas hilang dari disk.

---

## Self-Review (penulis plan)

**Spec coverage:** backward-only guard (Task 2) · 422 vs 400 (Task 2 tests) · pemetaan fase→artefak + boundary (Task 1) · dry-run + confirmDelete (Task 2) · kode Execute tak dihapus (ARTIFACT_DIR hanya specs/plans) · UI dropdown earlier-only + dialog (Task 3) · docs + ADR (Task 4). Semua section spec tercakup.

**Placeholder scan:** tak ada TBD/TODO; nomor ADR punya langkah verifikasi eksplisit (Task 4 Step 1) — bukan placeholder.

**Type consistency:** `artifactsToRemove(projectId, specId, target, current)` dipakai identik di Task 1 & Task 2. `patchSpec(id, { branchFrom?, stage?, confirmDelete? })` konsisten Task 2↔3. `onRevertStage(s, target, confirmDelete?)` sama di SpecDetail, BacklogScreen, App. Respons `{ pending, stage, wouldDelete }` sama di server, client `RevertPending`, dan test.
