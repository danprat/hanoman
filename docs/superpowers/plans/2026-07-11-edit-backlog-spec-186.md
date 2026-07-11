# Edit Backlog (SPEC-186) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Izinkan edit judul/prioritas/detail sebuah backlog item selagi masih di backlog dan belum pernah dijalankan.

**Architecture:** `PATCH /specs/:id` diperluas menerima `title`/`priority`/`payload`; ditolak 409 bila item sudah dimulai (`stage !== "brainstorming"` atau `baseSha !== null`). `objective` dihitung ulang dari payload lewat helper `deriveSpecFields` yang di-share dengan `POST`. Klien menghitung predikat editable dari `baseSha` (di-expose di `zSpec`) dan menampilkan form edit inline di `SpecDetail`.

**Tech Stack:** Zod (shared DTO), Fastify + Prisma (server), React + Vitest/Testing-Library (frontend).

## Global Constraints

- TypeScript strict; test untuk setiap logika orchestrasi.
- Jangan ubah skema DB (`baseSha` sudah ada) → tak perlu migration/ADR.
- Update `internal/docs` yang tersentuh dalam commit yang sama.
- "Belum dimulai" = `baseSha === null` (di-set sinkron saat worktree sesi pertama lahir, tak pernah dikosongkan). "State backlog" = `stage === "brainstorming"`.
- Edit hanya: `title`, `priority`, `payload` (brief: context/outcome/constraints/priority; qa: severity/steps/expected/actual/env). `source`/`project`/`id`/`author` tak bisa diedit.

---

### Task 1: Server API — edit konten backlog item yang belum dimulai

**Files:**
- Modify: `shared/src/dto.ts` (zPatchSpec)
- Modify: `shared/src/entities.ts` (zSpec += baseSha)
- Modify: `server/src/routes/specs.ts` (helper `deriveSpecFields` + POST refactor + PATCH content edit)
- Test: `server/test/specs.route.test.ts`
- Docs: `internal/docs/entrypoints/frd.md`

**Interfaces:**
- Produces: `deriveSpecFields(source: string, payload: unknown, manualPriority: string): { priority: string; objective: string }` (module-level di `specs.ts`).
- Produces: `zPatchSpec` menerima `title?`, `priority?`, `payload?` selain `branchFrom?`/`stage?`/`confirmDelete?`.
- Produces: `zSpec` kini punya `baseSha: string | null`.

- [ ] **Step 1: Tulis test yang gagal (edit sukses + tolak yang sudah dimulai)**

Tambahkan di `server/test/specs.route.test.ts`. Pertama, di `beforeAll` tambahkan dua spec brainstorming untuk diedit + satu yang sudah dimulai:

```ts
  // SPEC-186 · edit konten selagi belum dimulai.
  await makeSpec({ id: "SPEC-186A", projectId: "p1", stage: "brainstorming",
    priority: "sedang", objective: "lama", payload: { context: "c0", outcome: "o0", constraints: "", priority: "sedang" } });
  await makeSpec({ id: "SPEC-186B", projectId: "p1", stage: "brainstorming",
    payload: { context: "", outcome: "", constraints: "", priority: "sedang" }, baseSha: "deadbeef" }); // sudah dimulai
```

Lalu blok test baru sebelum `it("deletes a spec"...)`:

```ts
  // SPEC-186 — edit backlog selagi belum dimulai
  it("PATCH edit title/priority/payload → 200, objective dihitung ulang", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-186A",
      payload: { title: "Judul baru", priority: "tinggi",
        payload: { context: "c1", outcome: "hasil baru", constraints: "x", priority: "tinggi" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Judul baru");
    expect(res.json().priority).toBe("tinggi");
    expect(res.json().objective).toBe("hasil baru");     // outcome → objective
    expect(res.json().payload.context).toBe("c1");
  });
  it("PATCH konten pada item yang sudah dimulai (baseSha) → 409", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-186B", payload: { title: "tak boleh" },
    });
    expect(res.statusCode).toBe(409);
  });
  it("PATCH konten pada item stage maju → 409", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-137", payload: { title: "tak boleh" }, // SPEC-137 stage done
    });
    expect(res.statusCode).toBe(409);
  });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/specs.route.test.ts -t "SPEC-186|edit backlog|dimulai" --no-file-parallelism`
Expected: FAIL — edit title tak berlaku (200 tapi title lama / objective lama), dan 409 tak muncul (200/200).

- [ ] **Step 3: Shared — perluas zPatchSpec & expose baseSha**

Di `shared/src/entities.ts`, tambahkan baris terakhir field `zSpec`:

```ts
  branchFrom: z.string().nullable(),                   // SPEC-143 · null = default project (main)
  baseSha: z.string().nullable(),                      // SPEC-186 · null = belum pernah ada sesi (belum dimulai)
});
```

Di `shared/src/dto.ts`, `zPatchSpec` menjadi:

```ts
export const zPatchSpec = z.object({
  branchFrom: z.string().min(1).nullable().optional(),
  stage: zStage.optional(),
  confirmDelete: z.boolean().optional(),
  // SPEC-186 · edit konten selagi item belum dimulai. Ditolak server bila sudah mulai.
  title: z.string().min(1).optional(),
  priority: zPriority.optional(),
  payload: z.union([zBriefPayload, zQaPayload]).optional(),
});
```

(`zBriefPayload`, `zQaPayload`, `zPriority` sudah di-import di `dto.ts`.)

- [ ] **Step 4: Server — helper `deriveSpecFields` + refactor POST + PATCH content edit**

Di `server/src/routes/specs.ts`, tambahkan helper module-level (dekat `branchUnknown`):

```ts
// SPEC-186 · derivasi priority + objective dari source+payload. Satu sumber untuk POST & PATCH:
// qa → priority dari severity, objective dari actual/steps; brief → priority manual, objective dari outcome/context.
function deriveSpecFields(source: string, payload: any, manualPriority: string) {
  const isQa = source === "qa";
  const priority = isQa && payload && "severity" in payload
    ? (payload.severity === "minor" ? "sedang" : "tinggi") : manualPriority;
  const objective = isQa && payload && "actual" in payload
    ? (payload.actual || payload.steps || "— audit untuk menelusuri akar masalah.")
    : (payload && "outcome" in payload ? (payload.outcome || payload.context || "— brainstorm untuk memperjelas objective.") : "");
  return { priority, objective };
}
```

Ganti derivasi inline di handler POST (blok `const priority = ...` + `const objective = ...`) dengan:

```ts
    const { priority, objective } = deriveSpecFields(b.source, b.payload, b.priority);
```

Di handler PATCH, ganti destructuring & blok akhir. Setelah `const spec = await prisma.spec.findUnique(...)` + guard 404, jadikan:

```ts
    const { branchFrom, stage, confirmDelete, title, priority: newPriority, payload } = parsed.data;
    const editingContent = title !== undefined || newPriority !== undefined || payload !== undefined;
    // SPEC-186 · konten hanya boleh diubah selagi item masih di backlog & belum dimulai.
    if (editingContent && (spec.stage !== "brainstorming" || spec.baseSha !== null))
      return reply.code(409).send({ error: "backlog item sudah dimulai — tak bisa diedit" });
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
      for (const rel of wouldDelete) await deleteDoc(spec.projectId, rel).catch(() => { });
    }
    const data: { branchFrom?: string | null; stage?: string; title?: string; priority?: string; objective?: string; payload?: any } = {};
    if (branchFrom !== undefined) data.branchFrom = branchFrom;
    if (stage !== undefined) data.stage = stage;
    if (editingContent) {
      const effPayload = payload ?? spec.payload;
      const { priority, objective } = deriveSpecFields(spec.source, effPayload, newPriority ?? spec.priority);
      if (title !== undefined) data.title = title;
      if (payload !== undefined) data.payload = payload;
      data.priority = priority;
      data.objective = objective;
    }
    return prisma.spec.update({ where: { id }, data });
```

- [ ] **Step 5: Jalankan test, pastikan hijau**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/specs.route.test.ts --no-file-parallelism`
Expected: PASS semua (test lama branchFrom/stage + tiga test SPEC-186 baru).

- [ ] **Step 6: Update Source of Truth (FRD) — bagian Backlog**

Di `internal/docs/entrypoints/frd.md`, di bawah bagian `## Backlog`, tambahkan setelah baris pertama (`WHEN brief/finding dibuat…`):

```markdown
- WHILE sebuah backlog item masih di stage awal (`brainstorming`) dan belum pernah dijalankan (belum ada worktree sesi), THE SYSTEM SHALL mengizinkan edit judul, prioritas, dan detail brief/QA-nya; objective diturunkan ulang dari detail. IF item sudah dimulai atau stage-nya maju, THEN THE SYSTEM SHALL menolak edit konten (SPEC-186).
```

- [ ] **Step 7: Commit**

```bash
git add shared/src/dto.ts shared/src/entities.ts server/src/routes/specs.ts server/test/specs.route.test.ts internal/docs/entrypoints/frd.md
git commit -m "feat(spec-186): PATCH edit konten backlog selagi belum dimulai"
```

---

### Task 2: Frontend — form edit inline di SpecDetail

**Files:**
- Modify: `src/src/api/client.ts` (patchSpec type)
- Modify: `src/src/screens/BacklogScreen.tsx` (SpecDetail edit mode + BacklogScreen prop)
- Modify: `src/src/App.tsx` (editSpec handler + wiring)
- Test: `src/test/backlog-board.test.tsx`

**Interfaces:**
- Consumes: `Spec.baseSha` (dari Task 1).
- Produces: `BacklogScreen` prop `onEditSpec?: (s: Spec, patch: { title?: string; priority?: string; payload?: unknown }) => void`.
- Produces: `api.patchSpec(id, { title?, priority?, payload? , branchFrom?, stage?, confirmDelete? })`.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/backlog-board.test.tsx`, ubah helper `spec()` agar menyertakan `baseSha` (tipe `Spec` kini memuatnya):

```ts
const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null, ...over }) as Spec;
```

Tambahkan blok test:

```ts
describe("Edit backlog (SPEC-186)", () => {
  const editable = spec({ id: "SPEC-5", title: "judul lama", stage: "brainstorming", baseSha: null,
    payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } });

  it("item belum dimulai: klik Edit → ubah judul → Simpan memanggil onEditSpec", async () => {
    const onEditSpec = vi.fn();
    render(<BacklogScreen backlog={[editable]} projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onEditSpec={onEditSpec} />);
    fireEvent.click(screen.getByText("judul lama"));                 // buka detail
    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    const judul = screen.getByLabelText("Judul") as HTMLInputElement;
    fireEvent.change(judul, { target: { value: "judul baru" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    expect(onEditSpec).toHaveBeenCalledOnce();
    expect(onEditSpec.mock.calls[0]![0].id).toBe("SPEC-5");
    expect(onEditSpec.mock.calls[0]![1].title).toBe("judul baru");
  });

  it("item sudah dimulai (baseSha) tak menampilkan tombol Edit", () => {
    const started = spec({ id: "SPEC-6", title: "wip", stage: "brainstorming", baseSha: "abc123" });
    render(<BacklogScreen backlog={[started]} projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onEditSpec={() => {}} />);
    fireEvent.click(screen.getByText("wip"));
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src && npx vitest run test/backlog-board.test.tsx -t "Edit backlog"`
Expected: FAIL — tombol Edit tak ada.

- [ ] **Step 3: api client — perluas tipe patchSpec**

Di `src/src/api/client.ts`, ganti signature `patchSpec`:

```ts
  patchSpec: (id: string, b: { branchFrom?: string | null; stage?: string; confirmDelete?: boolean;
    title?: string; priority?: string; payload?: unknown }) =>
    j<Spec | RevertPending>(paths.spec(id), { method: "PATCH", ...body(b) }),
```

- [ ] **Step 4: BacklogScreen — edit mode di SpecDetail + prop baru**

Di `src/src/screens/BacklogScreen.tsx`:

(a) Import `Field` dan `HnTextarea` dari `../ds` (tambahkan ke daftar import yang sudah ada). Tambahkan opsi enum di dekat `B_PRIO`:

```ts
const PRIO_OPTS = [{ value: "tinggi", label: "Tinggi" }, { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" }];
const SEV_OPTS = [{ value: "critical", label: "Critical" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" }];
```

(b) Tambahkan `onEditSpec` ke props `SpecDetail`:

```ts
    onIntegrate?: (s: Spec, op: "merge" | "rebase", target: string) => void;
    onEditSpec?: (s: Spec, patch: { title?: string; priority?: string; payload?: unknown }) => void;
```

(c) Di dalam `SpecDetail`, sesudah state yang ada (`showIntegrate`), tambahkan state edit:

```ts
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({});
  // SPEC-186 · konten hanya boleh diubah selagi item masih di backlog & belum pernah dimulai.
  const editable = spec?.stage === "brainstorming" && spec?.baseSha == null && !!onEditSpec;
  const startEdit = () => {
    if (!spec) return;
    const pp = (spec.payload || {}) as Record<string, string>;
    setForm({ title: spec.title, priority: spec.priority, ...pp });
    setEditing(true);
  };
  const setField = (k: string) => (e: React.ChangeEvent<any>) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const saveEdit = () => {
    if (!spec || !onEditSpec) return;
    const patch = spec.source === "qa"
      ? { title: form.title, payload: { severity: form.severity, steps: form.steps, expected: form.expected, actual: form.actual, env: form.env } }
      : { title: form.title, priority: form.priority, payload: { context: form.context, outcome: form.outcome, constraints: form.constraints, priority: form.priority } };
    onEditSpec(spec, patch);
    setEditing(false);
  };
```

(Reset `editing` saat modal ditutup: ubah handler `onClose` di `<Modal ...>` menjadi `onClose={() => { setEditing(false); onClose(); }}`.)

(d) Di header modal (baris dengan `Review perubahan`), tambahkan tombol Edit sebelum tombol Review:

```tsx
        {editable && !editing && (
          <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}>Edit</Button>
        )}
```

(e) Ganti blok render Objective + fields (`<DetailRow label="Objective" .../>` … `{fields.map(...DetailRow...)}`) agar bercabang pada `editing`. Sisakan branch Select apa adanya (fitur terpisah). Struktur:

```tsx
      {editing ? (
        <>
          <Field label="Judul"><Input value={form.title ?? ""} onChange={setField("title")} style={{ width: "100%" }} /></Field>
          {!qa && (
            <Field label="Prioritas">
              <Select value={form.priority ?? "sedang"} onChange={setField("priority")} options={PRIO_OPTS} style={{ width: "100%" }} />
            </Field>
          )}
          {fields.map(([k, label]) => (
            <Field key={k} label={label}>
              {k === "severity"
                ? <Select value={form[k] ?? "major"} onChange={setField(k)} options={SEV_OPTS} style={{ width: "100%" }} />
                : <HnTextarea value={form[k] ?? ""} onChange={setField(k)} rows={2} />}
            </Field>
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Batal</Button>
            <Button size="sm" variant="primary" leftIcon="check" onClick={saveEdit}>Simpan</Button>
          </div>
        </>
      ) : (
        <>
          <DetailRow label="Objective" value={spec.objective} />
          {fields.map(([k, label]) => <DetailRow key={k} label={label} value={p[k] ?? ""} />)}
        </>
      )}
```

Catatan: blok "Branch worktree" (Select) tetap di posisinya semula, di luar percabangan `editing`, karena ia fitur terpisah (SPEC-143). Pindahkan hanya Objective + `fields.map` ke dalam percabangan.

(f) Teruskan prop dari `BacklogScreen` ke `SpecDetail`. Tambahkan `onEditSpec` ke daftar parameter `BacklogScreen({ ... })` dan tipenya, lalu pada pemanggilan `<SpecDetail ... onIntegrate={onIntegrate} />` jadi `... onIntegrate={onIntegrate} onEditSpec={onEditSpec} />`.

- [ ] **Step 5: App.tsx — handler editSpec + wiring**

Di `src/src/App.tsx`, tambahkan handler dekat `editBranch`:

```ts
  // SPEC-186 · edit konten backlog selagi belum dimulai. 409 = keburu dimulai sesi lain.
  async function editSpec(spec: Spec, patch: { title?: string; priority?: string; payload?: unknown }) {
    try {
      const updated = await api.patchSpec(spec.id, patch);
      if ("pending" in updated) return;
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " diperbarui", "ok", "check");
    } catch (e) {
      const started = e instanceof ApiError && e.status === 409;
      showToast(started ? spec.id + " sudah dimulai — tak bisa diedit" : "Gagal menyimpan " + spec.id, "warn", "x-circle");
    }
  }
```

Pada elemen `<BacklogScreen ...>`, tambahkan prop `onEditSpec={editSpec}` (di baris yang sama dengan `onEditBranch`/`onRevertStage`/`onIntegrate`).

- [ ] **Step 6: Jalankan test frontend, pastikan hijau**

Run: `cd src && npx vitest run test/backlog-board.test.tsx`
Expected: PASS semua (test lama + dua test SPEC-186).

- [ ] **Step 7: Typecheck**

Run: `cd src && npx tsc --noEmit` dan `cd shared && npx tsc --noEmit` dan `cd server && npx tsc --noEmit`
Expected: 0 error. (Bila ada literal `Spec` lain yang kini kurang `baseSha`, tambahkan `baseSha: null`.)

- [ ] **Step 8: Commit**

```bash
git add src/src/api/client.ts src/src/screens/BacklogScreen.tsx src/src/App.tsx src/test/backlog-board.test.tsx
git commit -m "feat(spec-186): form edit inline backlog di SpecDetail"
```

---

## Self-Review

**Spec coverage:**
- "editable predicate `stage===brainstorming && baseSha===null`" → Task 1 Step 4 (server guard) + Task 2 Step 4c (client `editable`).
- "edit title/priority/payload, recompute objective" → Task 1 Step 3–4 (zPatchSpec + deriveSpecFields).
- "expose baseSha di zSpec" → Task 1 Step 3.
- "409 saat sudah dimulai" → Task 1 Step 1/4.
- "form edit inline, item non-editable read-only" → Task 2 Step 4.
- "FRD Backlog clause" → Task 1 Step 6.

**Placeholder scan:** tak ada TBD/TODO; semua step berisi kode nyata.

**Type consistency:** `deriveSpecFields(source, payload, manualPriority)` dipakai identik di POST & PATCH. `onEditSpec(s, patch)` dengan `patch: { title?, priority?, payload? }` konsisten di client type, BacklogScreen prop, SpecDetail prop, dan App handler. `api.patchSpec` menerima superset field yang sama.
