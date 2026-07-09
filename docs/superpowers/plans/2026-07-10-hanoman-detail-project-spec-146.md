# SPEC-146 — Detail project · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klik project membuka layar detail project yang menampilkan identitasnya, mengizinkan edit `name`/`desc`, dan menjadi titik tolak ke docs, runs, dan backlog project itu.

**Architecture:** Tiga lapisan, tiga task. (1) `PATCH /projects/:id` menerima `name`/`desc` saja — `id` kekal karena memikul kunci asing `Spec`/`Run`/`Trigger`, jadi rename tak butuh gate run aktif seperti `DELETE`. (2) Filter project di Runs dan Backlog diangkat menjadi satu state milik `App` (`projectFilter`), bukan state lokal per layar, supaya detail project bisa mem-preset-nya. (3) Layar detail menjadi **section baru `"project"`** pada rantai `if/else` yang sudah ada — tanpa router, karena tujuh section lain pun tak punya URL sendiri.

**Tech Stack:** TypeScript strict, pnpm workspace, vitest (+ @testing-library/react, jsdom), React + Vite, Fastify, Prisma, zod.

**Spec:** [`internal/docs/operations/spec-146-detail-project-spec.md`](../../../internal/docs/operations/spec-146-detail-project-spec.md)
**Audit:** [`internal/docs/operations/spec-146-detail-project-audit.md`](../../../internal/docs/operations/spec-146-detail-project-audit.md)

## Global Constraints

- **Tanpa dependency runtime baru.** Tidak ada paket baru di `package.json` mana pun. Tidak ada `react-router`.
- **Tanpa perubahan skema, tanpa migration.** `name` dan `desc` sudah menjadi kolom `Project`. Karena tak ada migration, **tidak ada ADR** — `CLAUDE.md` hanya menuntut ADR untuk perubahan skema, dan spec ini menolaknya secara eksplisit. **Jangan membuat ADR baru.** (Nomor `0021` sudah dipakai `refs/heads/main`; worktree ini bercabang sebelum commit itu. Membuat "ADR-0021" di sini akan bentrok.)
- **`id` tidak pernah berubah.** Tidak ada endpoint rename `id`. Setiap task yang menyentuh project harus mempertahankan `id` apa adanya.
- **Guardrail freshness memblokir commit yang menyentuh `src/` tanpa menyentuh doc.** `IMPL_PREFIXES = ["src/"]`, `DOC_PREFIXES = ["internal/docs/", "internal/skills/", "AGENTS.md", "CLAUDE.md", "README.md"]` (`cli/src/git.ts:2-3`, dipakai `freshnessViolation` `:16-19`). Perhatikan: `startsWith("src/")` **tidak** cocok dengan `server/src/…` maupun `shared/src/…` — hanya frontend `src/`. Jadi **Task 2 dan Task 3 wajib menyertakan perubahan `internal/docs/**` di commit yang sama**. `docs/superpowers/**` tidak dihitung sebagai doc.
- **`coverageThreshold` default `100`** (`shared/src/config.ts:6`). **Jangan membuat berkas baru di `internal/docs/**`** — berkas tak ter-link menurunkan coverage dan memblokir plan. Semua doc yang disentuh plan ini sudah ada dan sudah ter-link.
- **Prop filter di `RunsScreen` wajib opsional.** `src/test/run-poll.test.tsx:60` merender `<RunsScreen runs={…} />` langsung tanpa prop filter. Menjadikannya wajib akan menggagalkan tes SPEC-142 yang sudah hijau.
- **Urutan tes di `server/test/projects.route.test.ts` bermakna.** Tes `:82-88` **menghapus `p1`**. Tes `PATCH` yang baru harus membuat project-nya sendiri (`p-patch`), bukan memakai `p1`.
- **Jangan sentuh yang menjawab pertanyaan berbeda:** `DELETE /projects/:id` tetap `409` saat ada run aktif (`server/src/routes/projects.ts:35-36`) — itu tentang cascade, bukan tentang label. `GET /projects/:id` (`:12-16`) tetap nol caller; daftar sudah membawa `ProjectView` lengkap.
- Perintah: satu berkas server `pnpm --filter ./server exec vitest run test/projects.route.test.ts`; satu berkas frontend `pnpm --filter ./src exec vitest run test/<file>`; seluruh workspace `pnpm test`; typecheck `pnpm typecheck`.

---

## File Structure

| File | Tanggung jawab | Task |
|---|---|---|
| `shared/src/dto.ts` | `zUpdateProject` — field project yang boleh diubah manusia | 1 |
| `server/src/routes/projects.ts` | `PATCH /projects/:id` | 1 |
| `server/test/projects.route.test.ts` | Rename tak menyentuh `id`; 400/404; sah saat run aktif | 1 |
| `internal/docs/architecture/api-contract.md` | Endpoint `PATCH` tercatat di kontrak | 1 |
| `internal/docs/architecture/data-model.md` | `id` kekal; `name`/`desc` label yang dapat diubah | 1 |
| `src/src/App.tsx` | State `projectFilter` (pemilik tunggal), reset saat project dihapus | 2 |
| `src/src/screens/BacklogScreen.tsx` | Filter project menjadi prop terkontrol | 2 |
| `src/src/screens/RunsScreen.tsx` | Filter project baru + `Select` di header daftar | 2 |
| `src/test/project-filter.test.tsx` | Kedua layar menyaring ke project terpilih | 2 |
| `src/src/screens/ProjectDetailScreen.tsx` | Layar detail: identitas, Edit, tiga pintu | 3 |
| `src/src/App.tsx` | Section `"project"`, modal edit, `updateProject`, guard hapus | 3 |
| `src/src/api/client.ts` | `updateProject(id, body)` | 3 |
| `src/test/project-detail.test.tsx` | Klik project → detail; tombol Runs → Runs tersaring | 3 |
| `internal/docs/frontend/frontend-implementation.md` | Daftar section: detail project + filter project di Runs | 2, 3 |

Tidak berubah: `server/prisma/**`, `shared/src/entities.ts`, `shared/src/api.ts` (`paths.project(id)` sudah ada), `src/src/screens/run-reduce.ts`, `src/src/ds/**`.

**Kenapa tiga task:** masing-masing punya deliverable yang dapat ditolak reviewer secara terpisah — endpoint yang bekerja tanpa UI (1), filter yang bekerja dari kontrol layar itu sendiri tanpa layar detail (2), dan layar detail yang mengonsumsi keduanya (3). Task 3 bergantung pada 1 dan 2; kerjakan berurutan.

---

## Task 1: `PATCH /projects/:id` — rename tanpa menyentuh `id`

Tidak ada jalan mengubah `name`/`desc` sebuah project di lapisan mana pun hari ini: `shared/src/dto.ts:5-7` hanya punya `zCreateProject`, dan `server/src/routes/projects.ts` hanya `GET`/`POST`/`DELETE`/`GET :id/branches`. Sementara `id` diturunkan sekali dari `name` saat create (`projects.ts:21`) dan menjadi kunci asing `Spec`/`Run`/`Trigger` — jadi yang boleh berubah hanyalah label.

**Files:**
- Modify: `shared/src/dto.ts:5-7` (sisipkan `zUpdateProject` sesudah `zCreateProject`)
- Modify: `server/src/routes/projects.ts:2` (import), `:31` (sisipkan handler sesudah `POST`)
- Modify: `server/test/projects.route.test.ts:105` (sisipkan tes sebelum penutup `});`)
- Modify: `internal/docs/architecture/api-contract.md:9`
- Modify: `internal/docs/architecture/data-model.md:5-8`

**Interfaces:**
- Produces: `zUpdateProject` (zod, `{ name?: string; desc?: string }`) di-export dari `@hanoman/shared`; `PATCH /api/projects/:id` → `200 ProjectView` | `400` | `404`.

- [x] **Step 1: Tulis tes yang gagal**

Sisipkan di `server/test/projects.route.test.ts`, tepat sebelum baris penutup `});` (baris 106). `makeRun` dan `prisma` sudah di-import di berkas itu (`:3-4`).

```ts
  // SPEC-146: yang berubah label, bukan kunci. `p-patch` dibuat sendiri — `p1` sudah
  // dihapus tes "deletes a project and cascades its specs" di atas.
  it("PATCH /projects/:id renames without touching id", async () => {
    await makeProject({ id: "p-patch", name: "p-patch", desc: "lama" });
    const res = await app.inject({
      method: "PATCH", url: "/api/projects/p-patch",
      payload: { name: "Kirana App", desc: "baru" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("p-patch");
    expect(res.json().name).toBe("Kirana App");
    expect(res.json().desc).toBe("baru");
  });
  it("PATCH rejects an empty name with 400 and changes nothing", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/projects/p-patch", payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
    const after = await app.inject({ url: "/api/projects/p-patch" });
    expect(after.json().name).toBe("Kirana App");
  });
  it("PATCH 404s on an unknown project", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/projects/hantu", payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
  // Kontras DELETE (409, projects.ts:35-36): `id` tak bergerak, jadi run aktif tak terusik.
  it("PATCH is allowed while a run is active", async () => {
    await makeRun({ id: "RUN-patch", projectId: "p-patch", status: "running" });
    const res = await app.inject({
      method: "PATCH", url: "/api/projects/p-patch", payload: { name: "Kirana" },
    });
    expect(res.statusCode).toBe(200);
    await prisma.run.delete({ where: { id: "RUN-patch" } });
  });
```

- [x] **Step 2: Jalankan tes, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/projects.route.test.ts`
Expected: FAIL — keempat tes baru. `PATCH` belum terdaftar, jadi Fastify menjawab `404`; tes pertama gagal `expected 404 to be 200`.

- [x] **Step 3: Tambah `zUpdateProject`**

`shared/src/dto.ts`, sisipkan tepat sesudah `zCreateProject` (`:7`):

```ts
// SPEC-146: hanya label tampilan. `id` memikul kunci asing Spec/Run/Trigger; `kind`,
// `repoDir`, `repoUrl`, dan `stack` menentukan tempat run/scan/terminal hidup. Body
// kosong `{}` sah dan berarti no-op — refinement "minimal satu field" tak menjaga apa pun.
export const zUpdateProject = z.object({
  name: z.string().min(1).optional(),
  desc: z.string().optional(),
});
```

- [x] **Step 4: Tambah handler `PATCH`**

`server/src/routes/projects.ts` — ubah baris 2 menjadi:

```ts
import { zCreateProject, zUpdateProject } from "@hanoman/shared";
```

lalu sisipkan handler tepat sesudah blok `app.post("/projects", …)` (sesudah `:31`), sebelum `app.delete`:

```ts
  // Rename tak menyentuh `id`, jadi tak ada gate run aktif seperti DELETE. Cermin
  // app.patch("/specs/:id") (server/src/routes/specs.ts:42).
  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zUpdateProject.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    await prisma.project.update({ where: { id }, data: parsed.data });
    return toProjectView(id);
  });
```

- [x] **Step 5: Jalankan tes, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/projects.route.test.ts`
Expected: PASS — semua tes di berkas itu, termasuk `POST /scan is gone (SPEC-141)` yang tetap `404`.

Run: `pnpm typecheck`
Expected: PASS.

- [x] **Step 6: Perbarui kontrak API**

`internal/docs/architecture/api-contract.md`, sisipkan sesudah baris `POST /projects …` (`:9` adalah `GET  /projects/:id`; sisipkan di bawahnya):

```
PATCH /projects/:id       { name?, desc? }   # 200 view; 400 name kosong; 404 tak ada.
#   `id` tak pernah berubah (kunci asing spec/run/trigger) — tak ada gate run aktif seperti DELETE.
```

- [x] **Step 7: Perbarui data-model**

`internal/docs/architecture/data-model.md`, ganti baris `:6`:

```markdown
- `id` (slug), `name`, `desc`, `kind` ("from-scratch" | "existing"), `repoDir`/`repoUrl`
```

menjadi:

```markdown
- `id` (slug) — **kekal**. Kunci asing `Spec`/`Run`/`Trigger`; tidak ada endpoint rename.
- `name`, `desc` — label tampilan; dapat diubah lewat `PATCH /projects/:id` (SPEC-146) dan boleh
  menyimpang dari `id`. Tak ada jalur git/worktree/filesystem yang membacanya.
- `kind` ("from-scratch" | "existing"), `repoDir`/`repoUrl`
```

- [x] **Step 8: Commit**

```bash
git add shared/src/dto.ts server/src/routes/projects.ts server/test/projects.route.test.ts \
  internal/docs/architecture/api-contract.md internal/docs/architecture/data-model.md
git commit -m "feat(spec-146): PATCH /projects/:id — rename tanpa menyentuh id"
```

---

## Task 2: Filter project dimiliki `App`

`BacklogScreen` punya filter project tapi state-nya lokal (`useState("all")`, `:167`), sehingga tak ada yang dapat mem-preset-nya dari luar. `RunsScreen` tidak punya filter sama sekali. Task 3 butuh keduanya dapat dipreset; task ini memasangnya dan filter itu langsung berguna lewat kontrol layarnya sendiri.

**Files:**
- Modify: `src/src/App.tsx:280` (state), `:353-368` (`deleteProject`), `:490-492` + `:499` (wiring)
- Modify: `src/src/screens/BacklogScreen.tsx:161-167`
- Modify: `src/src/screens/RunsScreen.tsx:5` (import `Select`), `:374-378`, `:393-396`, `:400-402`
- Modify: `internal/docs/frontend/frontend-implementation.md:5`
- Create: `src/test/project-filter.test.tsx`

**Interfaces:**
- Consumes: tidak ada dari Task 1.
- Produces: `App` state `projectFilter: string` (`"all"` atau `project.id`) + setter `setProjectFilter`, dipakai Task 3. Prop pada kedua layar: `projectFilter: string` dan `onProjectFilter: (id: string) => void` — **wajib** di `BacklogScreen`, **opsional** di `RunsScreen` (lihat Global Constraints).

- [x] **Step 1: Tulis tes yang gagal**

Create `src/test/project-filter.test.tsx`. Berkas terpisah karena satu berkas hanya boleh punya satu `vi.mock` per modul, dan `src/test/app-flows.test.tsx` sudah mengunci `listRuns` ke `[]` — preseden `run-poll.test.tsx`.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    runChanges: vi.fn(async () => ({ base: null, head: null, commits: [], files: [] })),
    listBranches: vi.fn(async () => ({ branches: [] })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import { RunsScreen } from "../src/screens/RunsScreen";
import { BacklogScreen } from "../src/screens/BacklogScreen";

const run = (id: string, project: string) => ({
  id, projectId: project, project, specId: null, spec: null, kind: "qa", status: "done",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], files: [], log: [],
  worktree: "", branchFrom: "main", branchTo: "hanoman/" + id.toLowerCase(),
  model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 100,
  createdAt: "2026-07-10T00:00:00.000Z", finishedAt: null, title: id, phase: null,
});
const spec = (id: string, projectId: string) => ({
  id, projectId, title: id, source: "qa", stage: "planned", priority: "tinggi",
  author: "qa", objective: "", payload: null,
});

describe("filter project (SPEC-146)", () => {
  it("RunsScreen hanya menampilkan run milik project terpilih", () => {
    render(<RunsScreen runs={[run("RUN-1", "arta"), run("RUN-2", "kirana")] as never}
      projectFilter="arta" onProjectFilter={() => {}} />);
    expect(screen.getAllByText("RUN-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("RUN-2")).toBeNull();
  });

  it("RunsScreen tanpa filter menampilkan semua run (default 'all')", () => {
    render(<RunsScreen runs={[run("RUN-1", "arta"), run("RUN-2", "kirana")] as never} />);
    expect(screen.getAllByText("RUN-2").length).toBeGreaterThan(0);
  });

  it("BacklogScreen hanya menampilkan spec milik project terpilih", () => {
    render(<BacklogScreen backlog={[spec("SPEC-1", "arta"), spec("SPEC-2", "kirana")] as never}
      projects={[{ id: "arta", name: "arta" }, { id: "kirana", name: "kirana" }] as never}
      projectFilter="arta" onProjectFilter={() => {}} />);
    expect(screen.getAllByText("SPEC-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("SPEC-2")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan tes, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/project-filter.test.tsx`
Expected: FAIL — tes pertama menemukan `RUN-2` (RunsScreen belum menyaring apa pun); tes ketiga gagal typecheck/render karena `BacklogScreen` belum menerima prop `projectFilter`.

- [x] **Step 3: `BacklogScreen` — filter menjadi prop terkontrol**

`src/src/screens/BacklogScreen.tsx`, ganti `:161-167`:

```tsx
export function BacklogScreen({ backlog, projects, pageSize = 4, onStart, activeRunSpecs, onDelete, onOpenRun, onNew, onEditBranch }:
  { backlog: Spec[]; projects: ProjectVM[]; pageSize?: number;
    onStart?: (s: Spec) => void; activeRunSpecs?: Set<string>;
    onDelete?: (s: Spec) => void; onOpenRun?: (s: Spec) => void; onNew?: () => void;
    onEditBranch?: (s: Spec, b: string | null) => void }) {
  const [tab, setTab] = React.useState("all");
  const [proj, setProj] = React.useState("all");
```

menjadi:

```tsx
export function BacklogScreen({ backlog, projects, pageSize = 4, onStart, activeRunSpecs, onDelete, onOpenRun, onNew, onEditBranch, projectFilter, onProjectFilter }:
  { backlog: Spec[]; projects: ProjectVM[]; pageSize?: number;
    onStart?: (s: Spec) => void; activeRunSpecs?: Set<string>;
    onDelete?: (s: Spec) => void; onOpenRun?: (s: Spec) => void; onNew?: () => void;
    onEditBranch?: (s: Spec, b: string | null) => void;
    projectFilter: string; onProjectFilter: (id: string) => void }) {
  const [tab, setTab] = React.useState("all");
  // Filter project dimiliki App (SPEC-146): detail project membuka layar ini sudah tersaring.
  const proj = projectFilter;
  const setProj = onProjectFilter;
```

Sisa badan fungsi (`:171-172` predikat, `:173` kunci `usePaged`, `:181-182` `Select`, `:193` tombol "Reset filter") **tidak berubah** — semuanya sudah membaca `proj`/`setProj`.

- [x] **Step 4: `RunsScreen` — filter baru + `Select`**

`src/src/screens/RunsScreen.tsx`, ganti baris `:5`:

```tsx
import { Card, StatusPill, Icon, usePaged, Pager, Button, IconButton, StateBlock } from "../ds";
```

menjadi:

```tsx
import { Card, StatusPill, Icon, usePaged, Pager, Button, IconButton, StateBlock, Select } from "../ds";
```

Ganti `:374-378`:

```tsx
export function RunsScreen({ runs, selectedId, pageSize = 4, onDelete, onGotoBacklog }:
  { runs: RunVM[]; selectedId?: string; pageSize?: number; onDelete?: (r: RunVM) => void; onGotoBacklog?: () => void }) {
  const [selId, setSelId] = React.useState(selectedId || (runs[0] && runs[0].id));
  const pg = usePaged(runs, pageSize, "runs");
  const picked = runs.find((r) => r.id === selId) || runs[0];
```

menjadi (prop opsional — `run-poll.test.tsx` merender layar ini tanpa keduanya):

```tsx
export function RunsScreen({ runs, selectedId, pageSize = 4, onDelete, onGotoBacklog, projectFilter = "all", onProjectFilter }:
  { runs: RunVM[]; selectedId?: string; pageSize?: number; onDelete?: (r: RunVM) => void;
    onGotoBacklog?: () => void; projectFilter?: string; onProjectFilter?: (id: string) => void }) {
  const shown = projectFilter === "all" ? runs : runs.filter((r) => r.project === projectFilter);
  const [selId, setSelId] = React.useState(selectedId || (runs[0] && runs[0].id));
  const pg = usePaged(shown, pageSize, "runs|" + projectFilter);
  const picked = shown.find((r) => r.id === selId) || shown[0];
```

Ganti `:393-396` (sesudah `const active = live ?? picked;`) — daftar kosong karena filter bukan daftar kosong karena belum ada run:

```tsx
  const active = live ?? picked;
  if (!active) return <StateBlock kind="empty" icon="activity" title="Belum ada run"
    hint="Jalankan spec dari backlog — log Claude Code akan streaming di sini."
    action={onGotoBacklog} actionLabel="Buka backlog" actionIcon="list-checks" />;
```

menjadi:

```tsx
  const active = live ?? picked;
  if (!active && runs.length) return <StateBlock kind="empty" icon="filter"
    title="Tidak ada run untuk project ini"
    hint={`${runs.length} run ada, tapi tak satu pun milik project "${projectFilter}".`}
    action={() => onProjectFilter?.("all")} actionLabel="Semua project" actionIcon="rotate-ccw" />;
  if (!active) return <StateBlock kind="empty" icon="activity" title="Belum ada run"
    hint="Jalankan spec dari backlog — log Claude Code akan streaming di sini."
    action={onGotoBacklog} actionLabel="Buka backlog" actionIcon="list-checks" />;
```

Ganti header daftar `:400-402`:

```tsx
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">Activity · {runs.length} runs</span>
        </div>
```

menjadi:

```tsx
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-hair)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span className="hn-eyebrow">Activity · {shown.length} runs</span>
          <Select size="sm" value={projectFilter} onChange={(e) => onProjectFilter?.(e.target.value)}
            options={[{ value: "all", label: "Semua project" }].concat(
              [...new Set(runs.map((r) => r.project))].map((id) => ({ value: id, label: id })))} />
        </div>
```

Baris `:403` (`pg.pageItems.map(...)`) tidak berubah — `pg` kini bersumber dari `shown`.

- [x] **Step 5: `App` memiliki state-nya**

`src/src/App.tsx`, sisipkan sesudah `:280`:

```tsx
  // Pemilik tunggal "daftar disaring ke project mana?" (SPEC-146). Sengaja terpisah dari
  // `projectId` ("project yang sedang dibuka Docs/detail"): menyatukannya membuat klik
  // sidebar Runs diam-diam menyaring ke project terakhir yang dibuka Docs.
  const [projectFilter, setProjectFilter] = React.useState("all");
```

Di `deleteProject` (`:353-368`), sisipkan sesudah baris `setProjectId((cur) => (cur === p.id ? "" : cur));` (`:361`):

```tsx
      setProjectFilter((cur) => (cur === p.id ? "all" : cur));
```

Wiring Backlog (`:490-492`) — tambahkan dua prop:

```tsx
        {gate(<BacklogScreen backlog={backlog} projects={projectsView} pageSize={4}
          onStart={startRun} activeRunSpecs={activeRunSpecs} onNew={() => setModal("brief")}
          onDelete={deleteSpec} onOpenRun={() => setSection("runs")} onEditBranch={editBranch}
          projectFilter={projectFilter} onProjectFilter={setProjectFilter} />)}
```

Wiring Runs (`:499`):

```tsx
        {gate(<RunsScreen runs={runsView} pageSize={4} onDelete={deleteRun}
          onGotoBacklog={() => setSection("backlog")}
          projectFilter={projectFilter} onProjectFilter={setProjectFilter} />)}
```

- [x] **Step 6: Jalankan tes, pastikan lulus**

Run: `pnpm --filter ./src exec vitest run test/project-filter.test.tsx`
Expected: PASS — tiga tes.

Run: `pnpm --filter ./src test`
Expected: PASS — termasuk `run-poll.test.tsx` (tiga tes SPEC-142) dan `app-flows.test.tsx`.

Run: `pnpm typecheck`
Expected: PASS.

- [x] **Step 7: Perbarui doc frontend (wajib di commit ini — guardrail freshness)**

`internal/docs/frontend/frontend-implementation.md:5`, pada daftar bagian, ganti frasa `Runs (list + detail: pipeline, worktree, kendali, terminal)` menjadi:

```
Runs (filter project + list + detail: pipeline, worktree, kendali, terminal)
```

dan sesudah kalimat pertama pada baris itu, tambahkan:

```
Filter project di Backlog dan Runs dibaca dari satu state `projectFilter` milik `App`, bukan state lokal tiap layar (SPEC-146) — detail project memakainya untuk membuka kedua layar dalam keadaan sudah tersaring.
```

- [x] **Step 8: Commit**

```bash
git add src/src/App.tsx src/src/screens/BacklogScreen.tsx src/src/screens/RunsScreen.tsx \
  src/test/project-filter.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(spec-146): filter project terkontrol di Backlog + Runs"
```

---

## Task 3: Layar detail project

`openProject` (`App.tsx:339`) melompat ke Docs, padahal baris project sudah terlihat seperti tautan (`ProjectsScreen.tsx:76` `onClick`, `:106` chevron). Task ini memberi tujuan yang dijanjikan afordansi itu: identitas project, edit `name`/`desc`, dan tiga pintu ke docs/runs/backlog.

**Files:**
- Create: `src/src/screens/ProjectDetailScreen.tsx`
- Modify: `src/src/api/client.ts:14` (sisipkan `updateProject`)
- Modify: `src/src/App.tsx:18` (import), `:271` (modal edit), `:339` (`openProject`), `:341-368` (`updateProject`, guard hapus), `:469` (cabang section), `:546-549` (render modal)
- Modify: `internal/docs/frontend/frontend-implementation.md:5`
- Create: `src/test/project-detail.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/projects/:id` (Task 1); `projectFilter`/`setProjectFilter` di `App` (Task 2).
- Produces: `api.updateProject(id: string, b: { name?: string; desc?: string }): Promise<ProjectView>`; komponen `ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoRuns, onGotoBacklog, onDelete })`; section `"project"`.

- [x] **Step 1: Tulis tes yang gagal**

Create `src/test/project-detail.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const PROJECT = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: "/repo/arta",
  repoUrl: null, stack: "ts", docStatus: "ok", coverage: 100, createdAt: "2026-07-10T00:00:00.000Z",
  backlog: 1, topStage: "planned", activity: "idle", commit: "belum ada commit",
  run: { status: "idle", phase: null, kind: null },
};
const RUN = {
  id: "RUN-9", projectId: "arta", specId: null, kind: "qa", status: "done",
  trigger: "manual", triggerDetail: "", phases: [], plan: [], files: [], log: [],
  worktree: "", branchFrom: "main", branchTo: "hanoman/run-9", model: "",
  tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 100,
  createdAt: "2026-07-10T00:00:00.000Z", finishedAt: null,
};

vi.mock("../src/api/client", () => ({
  api: {
    listProjects: vi.fn(async () => [PROJECT]),
    listSpecs: vi.fn(async () => []),
    listRuns: vi.fn(async () => [RUN]),
    listTriggers: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    runChanges: vi.fn(async () => ({ base: null, head: null, commits: [], files: [] })),
    updateProject: vi.fn(async (_id: string, b: { name?: string }) => ({ ...PROJECT, ...b })),
  },
  subscribeRun: vi.fn(() => () => {}),
  ApiError: class extends Error {},
}));
import App from "../src/App";

describe("detail project (SPEC-146)", () => {
  it("klik baris project membuka detail project, bukan Docs", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);   // sidebar
    fireEvent.click(screen.getAllByText("arta")[0]!);       // baris project
    // Layar detail punya "Edit project"; layar Docs punya tombol "Muat ulang" (rescan tree,
    // unik untuk DocsWorkspace — "Source of Truth" sendiri juga jadi label pintu di detail).
    expect(await screen.findByText("Edit project")).toBeInTheDocument();
    expect(screen.queryByText("Muat ulang")).toBeNull();
  });

  it("tombol Runs di detail membuka Runs tersaring ke project itu", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click(screen.getAllByText("arta")[0]!);
    fireEvent.click(await screen.findByText("Lihat runs"));
    // RUN-9 dirender dua kali (baris daftar + panel detail) begitu Runs terbuka.
    expect((await screen.findAllByText("RUN-9")).length).toBeGreaterThan(0);
  });
});
```

> **Amandemen (fase Execute):** dua asersi pertama di plan tak bisa bertahan — "Source of Truth"
> juga jadi label pintu di `ProjectDetailScreen` sendiri (bentrok dengan komponen yang ditulis di
> Step 4 task ini), dan `findByText("RUN-9")` gagal karena run muncul dua kali (baris + panel
> detail), pola yang sama seperti `project-filter.test.tsx`. Diganti `"Muat ulang"` (unik
> `DocsWorkspace.tsx:214`) dan `findAllByText`. Kode di atas sudah kode final.

- [x] **Step 2: Jalankan tes, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/project-detail.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Edit project`. Klik baris project hari ini mendarat di Docs.

- [x] **Step 3: Tambah `api.updateProject`**

`src/src/api/client.ts`, sisipkan sesudah `deleteProject` (`:14`):

```ts
  // SPEC-146 · hanya label. `id` tak pernah berubah, jadi respons selalu punya `id` yang sama.
  updateProject: (id: string, b: { name?: string; desc?: string }) =>
    j<ProjectView>(paths.project(id), { method: "PATCH", ...body(b) }),
```

- [x] **Step 4: Buat `ProjectDetailScreen`**

Create `src/src/screens/ProjectDetailScreen.tsx`:

```tsx
/* ProjectDetailScreen — satu project: identitas, edit, dan tiga pintu ke docs/runs/backlog.
   Tak ada fetch sendiri: ProjectVM dari daftar sudah memuat setiap field yang dirender
   (SPEC-146). GET /projects/:id ada, tapi memanggilnya hanya menambah state loading. */
import { Card, Badge, StatusPill, ProgressBar, Button, Icon } from "../ds";
import type { ProjectVM } from "./types";

const COV_TONE = (s: string) => (s === "broken" ? "err" : s === "drift" ? "warn" : "ok");

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="hn-eyebrow">{label}</div>
      <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-body)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function Door({ icon, title, hint, onClick }:
  { icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <Card padding={0}>
      <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", cursor: "pointer" }}>
        <Icon name={icon} size={16} color="var(--text-muted)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{hint}</div>
        </div>
        <Icon name="chevron-right" size={14} color="var(--text-subtle)" />
      </div>
    </Card>
  );
}

export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoRuns, onGotoBacklog, onDelete }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoRuns: () => void;
    onGotoBacklog: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="box" size={15} color="var(--text-muted)" />
              <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600,
                color: "var(--text-strong)" }}>{p.name}</span>
              <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{p.kind}</Badge>
              <StatusPill status={p.run.status} size="sm">{p.run.phase ?? undefined}</StatusPill>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-subtle)", marginTop: 6 }}>{p.desc}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <Button size="sm" variant="secondary" leftIcon="pencil" onClick={onEdit}>Edit project</Button>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={onDelete}>Hapus project</Button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 20 }}>
          <Meta label="ID" value={p.id} mono />
          <Meta label="Repo" value={p.repoDir || "—"} mono />
          <Meta label="Stack" value={p.stack || "—"} />
          <Meta label="Backlog terbuka" value={`${p.backlog} · ${p.topStage}`} />
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Docs · SoT</div>
          <ProgressBar value={p.coverage} showLabel tone={COV_TONE(p.docStatus)} size="sm" />
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Door icon="book-open" title="Source of Truth" hint="baca & sunting docs" onClick={onGotoDocs} />
        <Door icon="activity" title="Lihat runs" hint="run project ini" onClick={onGotoRuns} />
        <Door icon="list-checks" title="Lihat backlog" hint={`${p.backlog} spec terbuka`} onClick={onGotoBacklog} />
      </div>
    </div>
  );
}
```

- [x] **Step 5: Modal edit + `updateProject` di `App`**

`src/src/App.tsx` — tambahkan import sesudah `:12`:

```tsx
import { ProjectDetailScreen } from "./screens/ProjectDetailScreen";
```

Sisipkan komponen modal tepat sesudah `NewProjectModal` berakhir (`:272`, sebelum `export default function App()`):

```tsx
function EditProjectModal({ open, project, onClose, onSave }:
  { open: boolean; project?: ProjectVM; onClose: () => void; onSave: (f: { name: string; desc: string }) => void }) {
  const [f, setF] = React.useState({ name: "", desc: "" });
  React.useEffect(() => { if (open && project) setF({ name: project.name, desc: project.desc }); }, [open, project]);
  const canSubmit = !!f.name.trim();
  return (
    <Modal open={open} onClose={onClose} icon="pencil" eyebrow={project ? project.id : "project"}
      title="Edit project"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" onClick={() => canSubmit && onSave(f)}>Simpan</Button>
      </>}>
      {/* `id` tak ikut: ia kunci asing spec/run/trigger (SPEC-146). */}
      <Field label="Nama project" hint="label tampilan — boleh berbeda dari id">
        <Input value={f.name} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, name: e.target.value }))}
          style={{ width: "100%" }} />
      </Field>
      <Field label="Deskripsi">
        <Input value={f.desc} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, desc: e.target.value }))}
          style={{ width: "100%" }} />
      </Field>
    </Modal>
  );
}
```

> **Amandemen (fase Execute):** `onChange={(e) => …}` tanpa anotasi gagal `tsc --noEmit` —
> `InputProps` (`ds/components/forms.tsx:82`) melebar ke `Record<string, any>`, jadi `e` jatuh ke
> implicit `any` (`noImplicitAny`). `NewProjectModal` (`App.tsx`) sudah punya pola yang sama lewat
> helper `set(k)`; di sini dianotasi langsung `(e: React.ChangeEvent<any>)`. Kode di atas final.

Ganti `openProject` (`:339`):

```tsx
  function openProject(p: ProjectVM) { setProjectId(p.id); setSection("docs"); }
```

menjadi:

```tsx
  function openProject(p: ProjectVM) { setProjectId(p.id); setSection("project"); }

  async function updateProject(f: { name: string; desc: string }) {
    if (!proj) return;
    try {
      const updated = await api.updateProject(proj.id, { name: f.name.trim(), desc: f.desc.trim() });
      setProjects((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      setModal(null);
      showToast("Project " + updated.name + " diperbarui", "ok", "box");
    } catch { showToast("Gagal memperbarui project", "err", "x-circle"); }
  }
```

Di `deleteProject`, ganti `:362`:

```tsx
      if (section === "docs") setSection("projects");
```

menjadi (layar detail tak boleh merender project yang sudah tiada):

```tsx
      if (section === "docs" || section === "project") setSection("projects");
```

- [x] **Step 6: Cabang section `"project"`**

`src/src/App.tsx`, sisipkan cabang tepat sesudah blok `section === "projects"` berakhir (sesudah `:485`), sebelum `} else if (section === "backlog") {`:

```tsx
  } else if (section === "project") {
    screen = (
      <Shell active="projects" title={proj ? proj.name : "Project"}
        breadcrumb={proj ? "projects · " + proj.id : "projects"} onNavigate={setSection}>
        {gate(proj
          ? <ProjectDetailScreen p={proj} onEdit={() => setModal("project-edit")}
              onGotoDocs={() => setSection("docs")}
              onGotoRuns={() => { setProjectFilter(proj.id); setSection("runs"); }}
              onGotoBacklog={() => { setProjectFilter(proj.id); setSection("backlog"); }}
              onDelete={() => deleteProject(proj)} />
          : <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="Mulai dari nol atau tambahkan codebase yang sudah ada."
              action={() => setModal("project")} actionLabel="Project baru" />)}
      </Shell>
    );
```

Render modal — sisipkan sesudah `<NewProjectModal … />` (`:548`):

```tsx
      <EditProjectModal open={modal === "project-edit"} project={proj} onClose={() => setModal(null)} onSave={updateProject} />
```

- [x] **Step 7: Jalankan tes, pastikan lulus**

Run: `pnpm --filter ./src exec vitest run test/project-detail.test.tsx`
Expected: PASS — dua tes.

Run: `pnpm test`
Expected: PASS — seluruh workspace, termasuk `server/test/projects.route.test.ts` (Task 1) dan `src/test/run-poll.test.tsx`.

Run: `pnpm typecheck`
Expected: PASS.

- [x] **Step 8: Perbarui doc frontend (wajib di commit ini — guardrail freshness)**

`internal/docs/frontend/frontend-implementation.md:5`, pada daftar bagian, ganti frasa `Projects (list + pagination + cari + hapus project per baris; tombol hapus juga di header Docs — konfirmasi dulu, ditolak bila ada run aktif)` menjadi:

```
Projects (list + pagination + cari + hapus project per baris) → **detail project** (identitas, coverage, edit `name`/`desc` lewat `PATCH /projects/:id`, dan tiga pintu: docs, runs, backlog). `id` tak pernah dapat diubah — ia kunci asing spec/run/trigger (SPEC-146). Hapus project ada di detail dan di header Docs — konfirmasi dulu, ditolak bila ada run aktif; rename tidak ditolak, karena `id` tak bergerak
```

- [x] **Step 9: Commit**

```bash
git add src/src/screens/ProjectDetailScreen.tsx src/src/App.tsx src/src/api/client.ts \
  src/test/project-detail.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(spec-146): layar detail project — edit + pintu ke docs/runs/backlog"
```

---

## Verifikasi manual (sesudah Task 3)

`CLAUDE.md` menuntut endpoint yang tersentuh diuji nyata di local, bukan hanya lewat unit test.

- [ ] **Step 1: Boot server + dashboard**

```bash
pnpm dev
```

- [ ] **Step 2: `PATCH` lewat curl**

```bash
curl -s -X PATCH localhost:3000/api/projects/<id-project-nyata> \
  -H 'content-type: application/json' -d '{"name":"Nama Baru"}' | head -c 300
```
Expected: `200` dengan `"id"` **tidak berubah** dan `"name":"Nama Baru"`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH localhost:3000/api/projects/<id> \
  -H 'content-type: application/json' -d '{"name":""}'
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH localhost:3000/api/projects/hantu \
  -H 'content-type: application/json' -d '{"name":"x"}'
```
Expected: `400`, lalu `404`.

- [ ] **Step 3: Alur UI**

Klik baris project → detail terbuka. **Edit project** → ubah nama → Simpan → nama berubah di detail dan di daftar Projects tanpa reload. **Lihat runs** → Runs terbuka dengan dropdown project sudah terpilih ke project itu. **Lihat backlog** → sama. **Source of Truth** → Docs project itu.

- [ ] **Step 4: Centang checklist plan ini**

Ubah `- [ ]` menjadi `- [x]` untuk setiap step yang selesai, sesuai `CLAUDE.md`.

---

## Self-review

**Spec coverage.** Sepuluh kriteria EARS di spec, semuanya punya task:
klik → detail (Task 3 Step 6, tes Step 1) · field yang ditampilkan (Task 3 Step 4) ·
simpan → `PATCH` tanpa reload (Task 3 Step 5) · `id` tetap (Task 1 Step 1, tes pertama) ·
`name: ""` → 400 (Task 1 Step 1, tes kedua) · id tak dikenal → 404 (Task 1 Step 1, tes ketiga) ·
`PATCH` sah saat run aktif (Task 1 Step 1, tes keempat) · tiga pintu (Task 3 Step 4+6) ·
filter + opsi "Semua project" (Task 2 Step 3+4) · hapus project → kembali ke Projects + reset filter
(Task 2 Step 5, Task 3 Step 5).

Tujuh butir "Perubahan yang diminta" di spec juga terpetakan: dto (T1 S3), route (T1 S4),
client (T3 S3), `ProjectDetailScreen` (T3 S4), `App` (T3 S5-6 + T2 S5), Backlog (T2 S3),
Runs (T2 S4). Tiga doc "yang menyusul" ada di T1 S6-7 dan T2 S7 / T3 S8.

**Type consistency.** `projectFilter: string` dan `onProjectFilter: (id: string) => void` konsisten
di `App`, `BacklogScreen` (wajib), `RunsScreen` (opsional). `api.updateProject(id, { name?, desc? })
→ ProjectView` cocok dengan `zUpdateProject` dan dengan respons `toProjectView(id)`. `ProjectDetailScreen`
menerima `p: ProjectVM`, tipe yang sudah dipakai `ProjectsScreen`/`OverviewScreen`.

**Catatan yang tidak dikerjakan** (tercatat di spec, sengaja dilewati): `POST /projects` yang menulis
`name: id`; baris `api-contract.md:10` `POST /projects/:id/scan` yang tak ada route-nya (tes
`projects.route.test.ts:64-67` justru menuntutnya `404`). Keduanya backlog item terpisah.
