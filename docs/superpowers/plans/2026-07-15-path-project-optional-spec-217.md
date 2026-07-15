# Path project optional, per-client, editable (SPEC-217) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) atau superpowers:subagent-driven-development untuk mengeksekusi task-demi-task. Step pakai kotak centang markdown.

**Goal:** Menuntaskan agar path project **optional**, **per-client** (tiap mesin path sendiri, tak disync), dan **editable** — dengan menyambungkan mekanisme `LocalBinding`/`resolveRepoDir` (SPEC-213) ke SELURUH jalur baca-path + UI.

**Architecture:** Path efektif = `resolveRepoDir(projectId)` = `LocalBinding.repoDir ?? Project.repoDir` (binding lokal menang, null-safe). SPEC-213 sudah menyediakan model + `resolveRepoDir` + API `GET/PUT /binding` + `POST /clone`, tapi hanya spawn (terminal) & IDE yang memakainya. Plan ini mengalihkan sisa jalur baca (coverage, branches, specs, docs, PRD, spec-docs, stage-artifacts) ke `resolveRepoDir`, membuat path bisa diedit (binding via UI + `Project.repoDir` via PATCH), dan melonggarkan create form.

**Tech Stack:** Fastify 4, Prisma 5 (Postgres), vitest (`app.inject`), React+TS (Vite), `@hanoman/shared` (zod + tipe), @testing-library/react.

## Global Constraints

- TypeScript strict; test untuk tiap logika orchestrasi yang tersentuh.
- **TANPA perubahan skema** — `Project.repoDir` sudah `String?`, `LocalBinding` sudah ada. Tak ada migration/ADR baru.
- Additive murni: tak menghapus endpoint/perilaku; jaga kode status lama (parity) di terminal/ide/specs.
- **Jalankan test server** dari root: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test <file>` (shell sesi menunjuk prod — memori). Test web: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test <file>`. Typecheck: `pnpm -r typecheck`.
- Never-sync tetap: `Project.repoDir`, `LocalBinding` — jangan masukkan ke whitelist `sync.ts`.
- Setelah tiap task: centang `- [x]`, **boot server lokal + curl endpoint tersentuh** (jangan hanya unit test), fixing sampai hijau sebelum lanjut. Perbarui `internal/docs` yang tersentuh **dalam commit yang sama**.
- Path efektif `null` → 4xx bersih / daftar kosong, TAK PERNAH 500 (jaga null-safety).

---

## Task 0: Setup worktree (prasyarat, tak ada test)

Worktree `.worktrees/spec-217` belum punya `node_modules`, client Prisma belum di-generate, dan DB `hanoman_test` mungkin belum ter-migrate (memori: worktree butuh install+generate; hanoman_test butuh migrate deploy sendiri).

**Files:** — (tak ada perubahan kode)

- [x] **Step 1:** Dari root worktree: `pnpm install`.
- [x] **Step 2:** `pnpm --filter ./server exec prisma generate`.
- [x] **Step 3:** Migrate test DB: `env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman_test' pnpm --filter ./server exec prisma migrate deploy` (sesuaikan kredensial dari `.env`; port Docker 5432/5433 lihat memori). Verifikasi tabel `LocalBinding` ada.
- [x] **Step 4:** Sanity: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test bindings.route` → hijau (membuktikan DB + client siap). Tak ada commit.

---

## Task 1: Service baca-path jadi binding-aware

Alihkan tiap service yang membaca `Project.repoDir` langsung ke `resolveRepoDir` (binding menang). Ini membuat coverage dashboard, docs, PRD, spec-docs, stage-artifacts menghormati path per-client.

**Files:**
- Modify: `server/src/services/docs.ts:4-7` (`repoDirOf`)
- Modify: `server/src/services/project-prds.ts:28-31` (`resolveDir` fallback)
- Modify: `server/src/services/spec-docs.ts:26-35` (`resolveDir` fallback)
- Modify: `server/src/services/stage-artifacts.ts:26-30`
- Modify: `server/src/services/project-view.ts:33` (coverage scan)
- Test: `server/test/binding-aware.test.ts` (baru)

**Interfaces:**
- Consumes: `resolveRepoDir(projectId: string): Promise<string | null>` dari `server/src/services/local-binding.ts`.
- Produces: perilaku — service di atas memakai path binding bila ada.

- [x] **Step 1: Write the failing test** — `server/test/binding-aware.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { makeTempRepo } from "./factory";
import { docIndex } from "../src/services/docs";
import { toProjectView } from "../src/services/project-view";

const clean = async () => {
  await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("service baca-path menghormati LocalBinding (SPEC-217 AC-6)", () => {
  it("docIndex memindai path binding meski Project.repoDir null", async () => {
    const repo = makeTempRepo({ "internal/docs/adr/0001-x.md": "# x", "internal/docs/README.md": "i" });
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.localBinding.create({ data: { projectId: "p1", repoDir: repo } });
    const idx = await docIndex("p1");
    expect(idx.tree.length).toBeGreaterThan(0);   // path binding terbaca, bukan null → kosong
  });

  it("coverage project-view dihitung dari path binding", async () => {
    const repo = makeTempRepo({ "internal/docs/adr/0001-x.md": "# x", "internal/docs/README.md": "i" });
    const p = await prisma.project.create({ data: { id: "p2", name: "p2", desc: "d", kind: "existing", repoDir: null } });
    await prisma.localBinding.create({ data: { projectId: "p2", repoDir: repo } });
    const view = await toProjectView(p, []);
    expect(view.coverage).toBeGreaterThan(0);     // bukan 0 "broken"
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test binding-aware`
Expected: FAIL (`tree.length` 0 / `coverage` 0 — binding diabaikan).

- [x] **Step 3: Write minimal implementation**

`server/src/services/docs.ts` — ganti `repoDirOf`:
```ts
import { prisma } from "../db";
import { resolveRepoDir } from "./local-binding";
import { scanRepoDocs, readDocFile, writeDocFile, deleteDocFile } from "./scan";

async function repoDirOf(projectId: string): Promise<string | null> {
  return resolveRepoDir(projectId);
}
```
(sisanya `docIndex`/`readDoc`/`writeDoc`/`deleteDoc` tetap; `prisma` import boleh dibuang bila tak lagi dipakai.)

`server/src/services/project-view.ts:33` — ganti sumber scan:
```ts
import { resolveRepoDir } from "./local-binding";
// ...
const { coverage } = await scanRepoDocs(await resolveRepoDir(p.id));
```

`server/src/services/project-prds.ts:28-31` — fallback resolveDir:
```ts
import { resolveRepoDir } from "./local-binding";
// dalam resolveDir, ganti blok findUnique repoDir jadi:
return { dir: await resolveRepoDir(projectId), live: false };
```

`server/src/services/spec-docs.ts:26-35` — fallback resolveDir:
```ts
import { resolveRepoDir } from "./local-binding";
// ganti akhir resolveDir:
const spec = await prisma.spec.findUnique({ where: { id: specId }, select: { projectId: true } });
return spec ? resolveRepoDir(spec.projectId) : null;
```

`server/src/services/stage-artifacts.ts:26-30`:
```ts
import { resolveRepoDir } from "./local-binding";
// ganti dua baris findUnique+guard jadi:
const repoDir = await resolveRepoDir(projectId);
if (!repoDir) return [];
// ...
const files = await listRepoDocs(repoDir);
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test binding-aware`
Expected: PASS. Lalu regresi: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test docs project-view stage-artifacts project-prds spec-docs` → tetap hijau.

- [x] **Step 5: Commit**

```bash
git add server/src/services server/test/binding-aware.test.ts
git commit -m "fix(server): service docs/coverage/prd/spec-docs/stage-artifacts hormati LocalBinding (SPEC-217 AC-6)"
```

---
 Route branches + specs (create/review/integrate) binding-aware

Alihkan jalur route yang membaca `Project.repoDir` langsung ke `resolveRepoDir`, agar dropdown branch, buat spec, review, dan integrate memakai path per-client (bukan 409 palsu / worktree tak ketemu).

**Files:**
- Modify: `server/src/routes/projects.ts:72-77` (branches)
- Modify: `server/src/routes/specs.ts` (create `:73,80`; integrate `:173-174`; review `:215-219,226-230`)
- Test: `server/test/binding-routes.test.ts` (baru)

**Interfaces:**
- Consumes: `resolveRepoDir(projectId)`.
- Produces: branches/specs/review/integrate berbasis path efektif.

- [x] **Step 1: Write the failing test** — `server/test/binding-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { makeRepoWithBranches } from "./factory";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("route branches/specs hormati LocalBinding (SPEC-217 AC-6)", () => {
  it("GET /branches memakai path binding meski Project.repoDir null", async () => {
    const repo = makeRepoWithBranches("main", "feat-x");
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.localBinding.create({ data: { projectId: "p1", repoDir: repo } });
    const r = await app.inject({ method: "GET", url: "/api/projects/p1/branches" });
    expect(r.json().branches).toContain("feat-x");   // bukan [] karena binding diabaikan
  });

  it("GET /specs/:id/review tak 409 'belum punya repoDir' bila ada binding", async () => {
    const repo = makeRepoWithBranches("main");
    await prisma.project.create({ data: { id: "p2", name: "p2", desc: "d", kind: "existing", repoDir: null } });
    await prisma.localBinding.create({ data: { projectId: "p2", repoDir: repo } });
    await prisma.spec.create({ data: { id: "SPEC-9", projectId: "p2", title: "t", source: "brief", stage: "done", priority: "sedang", author: "x", objective: "" } });
    const r = await app.inject({ method: "GET", url: "/api/specs/SPEC-9/review" });
    expect(r.statusCode).not.toBe(409);   // 409 lama = "project belum punya repoDir"; kini lolos gate itu
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test binding-routes`
Expected: FAIL (branches `[]`; review 409 "project belum punya repoDir").

- [x] **Step 3: Write minimal implementation**

`server/src/routes/projects.ts` — import + branches handler:
```ts
import { resolveRepoDir } from "../services/local-binding";
// ...
app.get("/projects/:id/branches", async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return reply.code(404).send({ error: "not found" });
  const repoDir = await resolveRepoDir(id);
  return { branches: await listRepoBranches(repoDir), remotes: await listRepoRemoteBranches(repoDir) };
});
```

`server/src/routes/specs.ts` — import `resolveRepoDir`, lalu:
- create (`:73,80`): ganti `project.repoDir` → `const repoDir = await resolveRepoDir(b.project);` dan pakai `repoDir` di `branchUnknown(repoDir, b.branchFrom)` serta `nextSpecId(repoDir)`.
- integrate (`:173-174`): 
```ts
const repoDir = await resolveRepoDir(spec.projectId);
if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
const r = await integrate(repoDir, spec.id, parsed.data.op, parsed.data.target);
```
- review GET (`:215-219`): 
```ts
const repoDir = await resolveRepoDir(spec.projectId);
if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
const r = await resolveReview(repoDir, spec);
if (!r) return reply.code(409).send({ error: "belum ada worktree atau commit untuk di-review — jalankan/lanjutkan sesi backlog dulu" });
return r.wt ? specReview(repoDir, id, spec.branchFrom) : specReviewRange(repoDir, r.base, r.head);
```
- review file GET (`:226-230`): pola sama — `const repoDir = await resolveRepoDir(spec.projectId);` guard, lalu pakai `repoDir` di `resolveReview`/`reviewFile`/`reviewFileRange`.

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test binding-routes`
Expected: PASS. Regresi: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test specs.route projects.route branches integrate` → hijau (parity kode status lama saat tanpa binding & tanpa repoDir).

- [x] **Step 5: Commit**

```bash
git add server/src/routes server/test/binding-routes.test.ts
git commit -m "fix(server): branches & specs create/review/integrate hormati LocalBinding (SPEC-217 AC-6)"
```

---

## Task 3: ProjectView.binding + clear binding + repoDir editable via PATCH

Surface status override ke UI, izinkan hapus override, dan buat `Project.repoDir` (path default/server) editable.

**Files:**
- Modify: `shared/src/dto.ts:29-33` (`zUpdateProject` + `zProjectView`)
- Modify: `server/src/services/project-view.ts` (sertakan `binding`)
- Modify: `server/src/routes/bindings.ts` (tambah `DELETE /projects/:id/binding`)
- Modify: `server/src/services/local-binding.ts` (tambah `clearBinding`)
- Test: `server/test/binding-edit.test.ts` (baru); tambah kasus di `projects.route.test.ts`

**Interfaces:**
- Produces: `clearBinding(projectId: string): Promise<void>`; `ProjectView.binding: string | null`; `PATCH /projects/:id` menerima `repoDir?: string | null`; `DELETE /projects/:id/binding` → 204.

- [x] **Step 1: Write the failing test** — `server/test/binding-edit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resolveRepoDir } from "../src/services/local-binding";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.localBinding.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);
const mkProj = () => prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });

describe("edit path project (SPEC-217 AC-3/4/5/8)", () => {
  it("PATCH /projects/:id repoDir memperbarui Project.repoDir", async () => {
    await mkProj();
    const r = await app.inject({ method: "PATCH", url: "/api/projects/p1", payload: { repoDir: "/srv/x" } });
    expect(r.statusCode).toBe(200);
    expect((await prisma.project.findUnique({ where: { id: "p1" } }))!.repoDir).toBe("/srv/x");
  });

  it("ProjectView.binding memuat nilai LocalBinding", async () => {
    await mkProj();
    await app.inject({ method: "PUT", url: "/api/projects/p1/binding", payload: { repoDir: "/tmp/b" } });
    const view = await app.inject({ method: "GET", url: "/api/projects/p1" });
    expect(view.json()).toMatchObject({ binding: "/tmp/b" });
  });

  it("DELETE binding mengosongkan override → resolve jatuh ke Project.repoDir", async () => {
    await prisma.project.create({ data: { id: "p2", name: "p2", desc: "d", kind: "existing", repoDir: "/srv/def" } });
    await app.inject({ method: "PUT", url: "/api/projects/p2/binding", payload: { repoDir: "/tmp/b" } });
    expect(await resolveRepoDir("p2")).toBe("/tmp/b");
    const del = await app.inject({ method: "DELETE", url: "/api/projects/p2/binding" });
    expect(del.statusCode).toBe(204);
    expect(await resolveRepoDir("p2")).toBe("/srv/def");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test binding-edit`
Expected: FAIL (PATCH abaikan repoDir; `binding` undefined; DELETE 404 route tak ada).

- [x] **Step 3: Write minimal implementation**

`shared/src/dto.ts` — `zUpdateProject` tambah `repoDir` nullable+optional; `zProjectView` tambah `binding`:
```ts
export const zUpdateProject = z.object({
  name: z.string().min(1).optional(),
  desc: z.string().optional(),
  gitRemote: z.string().optional(),
  repoDir: z.string().nullable().optional(),   // SPEC-217 · path default/server editable (null = kosongkan)
});
// ...
export const zProjectView = zProject.extend({
  binding: z.string().nullable(),              // SPEC-217 · override repoDir per-mesin (null = pakai default)
  backlog: z.number().int(), topStage: z.string(), session: zSessionSummary,
  activity: z.string(), commit: z.string() });
```

`server/src/services/local-binding.ts` — tambah:
```ts
export async function clearBinding(projectId: string): Promise<void> {
  await prisma.localBinding.deleteMany({ where: { projectId } });
}
```

`server/src/services/project-view.ts` — `toProjectView` sertakan `binding`:
```ts
import { getBinding, resolveRepoDir } from "./local-binding";
// ...di dalam toProjectView, sebelum return:
const binding = await getBinding(p.id);
// dalam objek return, tambah: binding,
```

`server/src/routes/bindings.ts` — tambah route DELETE + import `clearBinding`:
```ts
import { getBinding, setBinding, clearBinding } from "../services/local-binding";
// ...
app.delete("/projects/:id/binding", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
  await clearBinding(id);
  return reply.code(204).send();
});
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test binding-edit bindings.route projects.route`
Expected: PASS (semua). Typecheck: `pnpm -r typecheck` (ProjectView baru wajib punya `binding` di tiap konstruksi — hanya `project-view.ts`).

- [x] **Step 5: Commit**

```bash
git add shared/src/dto.ts server/src/services server/src/routes/bindings.ts server/test/binding-edit.test.ts
git commit -m "feat(server): ProjectView.binding + DELETE binding + repoDir editable via PATCH (SPEC-217 AC-3/4/5/8)"
```

---
 Frontend plumbing — paths + client.ts

Sediakan binding API di client + izinkan `updateProject` mengirim `repoDir`.

**Files:**
- Modify: `shared/src/api.ts` (tambah `binding`)
- Modify: `src/src/api/client.ts` (`getBinding`/`putBinding`/`deleteBinding`/`cloneProject`; perluas `updateProject`)
- Test: `src/test/client-binding.test.ts` (baru)

**Interfaces:**
- Consumes: `paths.binding(id)`, endpoint `PUT/GET/DELETE /projects/:id/binding`, `POST /projects/:id/clone`.
- Produces: `api.getBinding(id)`, `api.putBinding(id, repoDir)`, `api.deleteBinding(id)`, `api.updateProject(id, { name?, desc?, gitRemote?, repoDir? })`.

- [x] **Step 1: Write the failing test** — `src/test/client-binding.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../src/api/client";

describe("client binding (SPEC-217)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it("putBinding memanggil PUT /api/projects/:id/binding", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ repoDir: "/tmp/x" }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.putBinding("p1", "/tmp/x");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/binding", expect.objectContaining({ method: "PUT" }));
  });
  it("updateProject bisa mengirim repoDir", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p1" }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.updateProject("p1", { repoDir: "/srv/x" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ repoDir: "/srv/x" });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test client-binding`
Expected: FAIL (`api.putBinding` undefined; `updateProject` type tak izinkan repoDir).

- [x] **Step 3: Write minimal implementation**

`shared/src/api.ts` — di objek `paths` (dekat `branches`):
```ts
  binding: (id: string) => `${API}/projects/${id}/binding`,
  clone: (id: string) => `${API}/projects/${id}/clone`,
```

`src/src/api/client.ts` — perluas `updateProject` + tambah metode:
```ts
  updateProject: (id: string, b: { name?: string; desc?: string; gitRemote?: string; repoDir?: string | null }) =>
    j<ProjectView>(paths.project(id), { method: "PATCH", ...body(b) }),
  // SPEC-217 · path per-mesin (LocalBinding, tak disync)
  getBinding: (id: string) => j<{ repoDir: string | null }>(paths.binding(id)),
  putBinding: (id: string, repoDir: string) =>
    j<{ repoDir: string }>(paths.binding(id), { method: "PUT", ...body({ repoDir }) }),
  deleteBinding: (id: string) => j<void>(paths.binding(id), { method: "DELETE" }),
  cloneProject: (id: string, dir: string) =>
    j<{ repoDir: string }>(paths.clone(id), { method: "POST", ...body({ dir }) }),
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test client-binding`
Expected: PASS. Typecheck: `pnpm -r typecheck`.

- [x] **Step 5: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/test/client-binding.test.ts
git commit -m "feat(web): client binding API + updateProject repoDir (SPEC-217)"
```

---

## Task 5: Frontend UI — create optional + edit path (binding) + detail badge

Buat create form tak wajib path, tambah field path editable di Edit modal yang menulis ke binding per-mesin (+ tombol kosongkan), dan tampilkan path efektif + badge override di detail.

**Files:**
- Modify: `src/src/App.tsx` (`NewProjectModal` canSubmit; `EditProjectModal` field path + save binding; `updateProject` handler)
- Modify: `src/src/screens/ProjectDetailScreen.tsx:62` (Meta "Repo" → path efektif + badge)
- Modify: `src/src/screens/types.ts` bila perlu (ProjectVM sudah = ProjectView, `binding` ikut otomatis)
- Test: `src/test/project-detail.test.tsx` (tambah kasus edit path)

**Interfaces:**
- Consumes: `api.putBinding`, `api.deleteBinding`, `ProjectView.binding`, `ProjectView.repoDir`.

- [x] **Step 1: Write the failing test** — tambah ke `src/test/project-detail.test.tsx` (mock `putBinding`, buka Edit, isi path, simpan → `putBinding` terpanggil). Tambahkan `putBinding: vi.fn(async () => ({ repoDir: "/tmp/x" }))` & `deleteBinding: vi.fn(async () => {})` ke mock `api`, lalu:

```ts
  it("edit project bisa menyetel path per-mesin (binding)", async () => {
    const { api } = await import("../src/api/client");
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click(screen.getAllByText("arta")[0]!);
    fireEvent.click(await screen.findByText("Edit project"));
    const input = await screen.findByPlaceholderText("/path/ke/repo (mesin ini)");
    fireEvent.change(input, { target: { value: "/tmp/x" } });
    fireEvent.click(screen.getByText("Simpan"));
    await act(async () => { await Promise.resolve(); });
    expect((api.putBinding as any)).toHaveBeenCalledWith("arta", "/tmp/x");
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test project-detail`
Expected: FAIL (placeholder path di Edit tak ada; `putBinding` tak terpanggil).

- [x] **Step 3: Write minimal implementation**

`src/src/App.tsx` `NewProjectModal` — path opsional untuk existing:
```ts
  const canSubmit = !!f.name.trim() || (!scratch && !!f.dir.trim());
```
(nama tak wajib untuk existing bila ada dir; tapi minimal salah satu ada. Untuk from-scratch tetap butuh nama.) Perbarui hint Field "Direktori" → tambahkan " · opsional".

`EditProjectModal` — terima `binding`/`repoDir` awal, tambah field path (mesin ini) + tombol kosongkan; ubah `onSave` mengirim `{ name, desc, dir }`:
```ts
function EditProjectModal({ open, project, onClose, onSave }:
  { open: boolean; project?: ProjectVM; onClose: () => void;
    onSave: (f: { name: string; desc: string; dir: string }) => void }) {
  const [f, setF] = React.useState({ name: "", desc: "", dir: "" });
  React.useEffect(() => {
    if (open && project) setF({ name: project.name, desc: project.desc, dir: project.binding ?? "" });
  }, [open, project]);
  const canSubmit = !!f.name.trim();
  // ...di body Modal, setelah Field Deskripsi, tambah:
  // <Field label="Path (mesin ini)" hint="opsional · disimpan lokal, tak disync">
  //   <Input value={f.dir} onChange={(e)=>setF((s)=>({...s, dir: e.target.value}))} leftIcon="folder" mono
  //     placeholder="/path/ke/repo (mesin ini)" style={{ width: "100%" }} />
  // </Field>
}
```

`updateProject` handler (App.tsx:352) — terima `dir`, tulis binding bila berubah:
```ts
async function updateProject(f: { name: string; desc: string; dir: string }) {
  if (!proj) return;
  try {
    const updated = await api.updateProject(proj.id, { name: f.name.trim(), desc: f.desc.trim() });
    const dir = f.dir.trim();
    if (dir !== (proj.binding ?? "")) {
      if (dir) await api.putBinding(proj.id, dir); else await api.deleteBinding(proj.id);
    }
    const fresh = await api.getProject(proj.id);   // ambil view segar (binding + coverage terbarui)
    setProjects((list) => list.map((x) => (x.id === fresh.id ? fresh : x)));
    setModal(null);
    showToast("Project " + fresh.name + " diperbarui", "ok", "box");
  } catch { showToast("Gagal memperbarui project", "err", "x-circle"); }
}
```

`ProjectDetailScreen.tsx:62` — path efektif + badge override:
```tsx
<Meta label="Repo" value={(p.binding ?? p.repoDir) || "—"} mono />
```
(opsional: bila `p.binding` di-set, render `<Badge tone="brass" size="sm">mesin ini</Badge>` di dekat Meta untuk menandai override.)

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test project-detail`
Expected: PASS. Typecheck: `pnpm -r typecheck`. Regresi web: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test`.

- [x] **Step 5: Commit**

```bash
git add src/src/App.tsx src/src/screens/ProjectDetailScreen.tsx src/test/project-detail.test.tsx
git commit -m "feat(web): create path opsional + edit path per-mesin (binding) + badge override (SPEC-217 AC-2/3/8)"
```

---
 Docs + verifikasi end-to-end (live curl)

**Files:**
- Modify: `internal/docs/architecture/api-contract.md` (dokumentasikan `DELETE /projects/:id/binding`, `PATCH repoDir`, `ProjectView.binding`)
- Modify: `internal/docs/architecture/data-model.md` bila menyebut repoDir/LocalBinding (samakan narasi "binding menang di semua jalur baca")
- Modify: `internal/docs/README.md` (bila menambah/menyentuh doc — jaga link index)

- [x] **Step 1:** Perbarui `api-contract.md` + `data-model.md`: path efektif = `resolveRepoDir` dipakai SELURUH jalur baca (bukan lagi hanya spawn/ide); `Project.repoDir` editable via PATCH; `LocalBinding` editable via PUT + hapus via DELETE; keduanya tak disync. Perbaiki komentar `local-binding.ts:19` bila masih menyesatkan ("spawn/scan/ide" kini benar-benar semua).
- [x] **Step 2: Boot server + curl live** (jangan hanya unit test — CLAUDE.md). DB throwaway ter-migrate (bukan hanoman_test — memori live-smoke dedicated DB), boot `node server/dist/server.js` (atau `pnpm --filter ./server dev`) di port bebas. Skenario:
  - `POST /api/projects {name:"opt",kind:"existing"}` (tanpa repoDir) → 201, `repoDir:null`, `binding:null`.
  - `PUT /api/projects/opt/binding {repoDir:"<repo git nyata>"}` → 200.
  - `GET /api/projects/opt` → `binding` terisi, `coverage>0` (binding dipakai).
  - `GET /api/projects/opt/branches` → memuat branch dari path binding.
  - `PATCH /api/projects/opt {repoDir:"/srv/def"}` → 200; `GET` → `repoDir:"/srv/def"`, `binding` tetap menang.
  - `DELETE /api/projects/opt/binding` → 204; `GET` → `binding:null`, path efektif jatuh ke `/srv/def`.
  Simpan transcript curl ke deskripsi commit/PR. Fixing sampai semua sesuai sebelum lanjut.
- [x] **Step 3: Commit**

```bash
git add internal/docs
git commit -m "docs(architecture): path efektif resolveRepoDir di semua jalur baca + binding editable (SPEC-217)"
```

---

## Self-Review (spec coverage)

- AC-1 (optional API) — Task 6 Step 2 curl (regresi SPEC-213). ✓
- AC-2 (optional UI) — Task 5 `canSubmit`. ✓
- AC-3 (edit binding, tak sync) — Task 3 (PUT), Task 4 (client), Task 5 (UI). ✓
- AC-4 (edit default repoDir via PATCH) — Task 3. ✓
- AC-5 (hapus binding → fallback) — Task 3 (DELETE + `clearBinding`). ✓
- AC-6 (binding end-to-end) — Task 1 (services) + Task 2 (routes). ✓
- AC-7 (null → 4xx bersih) — jaga null-safety; parity test Task 1/2 Step 4. ✓
- AC-8 (path efektif tampil) — Task 3 (`binding` di view) + Task 5 (detail badge). ✓
- AC-9 (tak sync path) — tak menyentuh `sync.ts` whitelist; Global Constraint. ✓
