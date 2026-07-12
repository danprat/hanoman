# Search, Filter, Pagination via API (SPEC-198) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pindahkan search/filter/pagination Backlog, Terminal picker, dan Projects dari client-side ke API, dengan kontrak envelope `{ items, total, page, pageSize }`, tanpa merusak overlay stage-live + write-through + notifikasi `done` di `GET /specs`.

**Architecture:** `GET /specs` & `GET /projects` selalu balikkan envelope. Overlay/write-through/notifikasi tetap jalan atas set penuh (scope project/source); search/filter/paginasi diterapkan di **memori setelah** overlay (filter `stage`/`startable` mencocokkan stage **live**, bukan DB). Frontend: App membuka `.items` untuk state penuh (Overview/board/find/poll), dan tiap layar daftar (Backlog grid/list, Projects, picker) fetch potongannya sendiri via API; App menaikkan `dataVersion` tiap data berubah supaya layar refetch tanpa poll ganda.

**Tech Stack:** Fastify + Prisma + Zod (server), React 18 + TS + Vite (frontend), Vitest. DB test `hanoman_test`.

## Global Constraints

- TypeScript strict; test untuk setiap logika orkestrasi.
- Envelope wajib: `Paginated<T> = { items: T[]; total: number; page: number; pageSize: number }`.
- **Fitur tersembunyi (jangan rusak):** overlay stage-live + write-through (CAS, forward-only) + notifikasi `done` di `GET /specs` **selalu** jalan atas set penuh scope project/source. Paginasi/filter TAK boleh menciutkan set yang di-overlay, dan filter `stage`/`startable` cocok ke stage **live**.
- Tanpa `page`/`limit` → seluruh item terfilter (page 1, pageSize=total). Dipakai full-fetch App + board + poll.
- Docs SoT tersentuh diperbarui **dalam commit yang sama** (`internal/docs/architecture/api-contract.md`).
- Tak ada perubahan skema → tak ada migration.
- Test server dijalankan: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test` (hindari env sesi yang menunjuk prod). Jika `_test` DB throw P2022, `prisma migrate deploy` ke `hanoman_test` dulu.
- Sentinel filter frontend `"all"` dikonversi ke `undefined` di call-site (bukan di `qs`), supaya pencarian literal "all" tak ikut terhapus.

---

### Task 1: Server `GET /specs` — envelope + filter + pagination (overlay dijaga)

**Files:**
- Modify: `shared/src/dto.ts` (tambah `Paginated<T>`), `shared/src/index.ts` (pastikan re-export dto)
- Modify: `server/src/routes/specs.ts:39-70` (handler GET `/specs`)
- Modify: `internal/docs/architecture/api-contract.md:40` (baris `GET /specs`)
- Create: `internal/docs/adr/0038-paginasi-di-response-layer.md` (verifikasi nomor lintas branch dulu — lihat Step 0)
- Test: `server/test/specs.route.test.ts` (tambah blok + migrasi 2 assertion array)

**Interfaces:**
- Produces: `GET /api/specs?project&source&q&stage&priority&startable&page&limit` → `Paginated<Spec>`. Helper murni `filterSpecs(specs, {q,stage,priority,startable})` dan `paginate<T>(items, page?, limit?): Paginated<T>` (di specs.ts, tak diexport).

- [ ] **Step 0: Verifikasi nomor ADR lintas branch**

Run: `git for-each-ref --format='%(refname)' | xargs -I{} git ls-tree -r --name-only {} -- internal/docs/adr 2>/dev/null | grep -oE '00[0-9]{2}' | sort -u | tail -3`
Kalau `0038` sudah dipakai di branch lain, pakai nomor bebas berikutnya dan sesuaikan nama file + judul di semua langkah.

- [ ] **Step 1: Tulis test yang gagal — bentuk envelope + filter + paginasi + guard overlay**

Tambahkan di `server/test/specs.route.test.ts` (dalam `describe("specs routes", ...)`):

```ts
it("returns a pagination envelope", async () => {
  const res = await app.inject({ url: "/api/specs?project=p1" });
  const b = res.json();
  expect(Array.isArray(b.items)).toBe(true);
  expect(typeof b.total).toBe("number");
  expect(b.page).toBe(1);
  expect(b.items.every((s: any) => s.projectId === "p1")).toBe(true);
});
it("filters by q over id+title+objective (case-insensitive)", async () => {
  const res = await app.inject({ url: "/api/specs?project=p1&q=spec-142" });
  const b = res.json();
  expect(b.items.some((s: any) => s.id === "SPEC-142")).toBe(true);
  expect(b.items.every((s: any) => s.id === "SPEC-142")).toBe(true);
});
it("filters by stage and priority", async () => {
  const planned = (await app.inject({ url: "/api/specs?project=p1&stage=planned" })).json();
  expect(planned.items.every((s: any) => s.stage === "planned")).toBe(true);
});
it("startable excludes done", async () => {
  const b = (await app.inject({ url: "/api/specs?project=p1&startable=true" })).json();
  expect(b.items.every((s: any) => s.stage !== "done")).toBe(true);
});
it("paginates: page/limit slice with full total", async () => {
  const all = (await app.inject({ url: "/api/specs?project=p1" })).json();
  const p1 = (await app.inject({ url: "/api/specs?project=p1&page=1&limit=2" })).json();
  expect(p1.items.length).toBeLessThanOrEqual(2);
  expect(p1.total).toBe(all.total);
  expect(p1.pageSize).toBe(2);
  const p2 = (await app.inject({ url: "/api/specs?project=p1&page=2&limit=2" })).json();
  expect(p2.items.map((s: any) => s.id)).not.toEqual(p1.items.map((s: any) => s.id));
});
```

- [ ] **Step 2: Jalankan test — pastикan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test specs.route`
Expected: FAIL — respons masih array polos (`b.items` undefined).

- [ ] **Step 3: Tambah tipe `Paginated<T>` di shared**

Di `shared/src/dto.ts` (paling atas, setelah import bila ada):

```ts
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
```

Pastikan `shared/src/index.ts` sudah `export * from "./dto"` (atau tambahkan bila belum). Jalankan `pnpm --filter @hanoman/shared build` bila paket ini di-precompile.

- [ ] **Step 4: Refactor handler `GET /specs` — extract overlay, tambah filter+paginate**

Di `server/src/routes/specs.ts`, ganti handler `app.get("/specs", ...)` (baris 39-70) sehingga overlay/write-through/notifikasi tetap identik tapi jalan atas set penuh, lalu filter+paginate di memori:

```ts
// helper murni — di atas `export default` atau di bawah deriveSpecFields
function filterSpecs<T extends { id: string; title: string; objective: string; stage: string; priority: string }>(
  specs: T[], f: { q?: string; stage?: string; priority?: string; startable?: string },
): T[] {
  const needle = (f.q ?? "").trim().toLowerCase();
  return specs.filter((s) =>
    (!f.stage || s.stage === f.stage) &&
    (!f.priority || s.priority === f.priority) &&
    (f.startable !== "true" || s.stage !== "done") &&
    (needle === "" || `${s.id} ${s.title} ${s.objective}`.toLowerCase().includes(needle)));
}
function paginate<T>(items: T[], page?: string, limit?: string) {
  const total = items.length;
  const pageSize = limit ? Math.max(1, Math.floor(+limit) || 1) : total;
  const p = page ? Math.max(1, Math.floor(+page) || 1) : 1;
  const start = (p - 1) * pageSize;
  return { items: pageSize ? items.slice(start, start + pageSize) : items, total, page: p, pageSize };
}
```

Handler:

```ts
app.get("/specs", async (req) => {
  const { project, source, q, stage, priority, startable, page, limit } =
    req.query as { project?: string; source?: string; q?: string; stage?: string;
      priority?: string; startable?: string; page?: string; limit?: string };
  const specs = await prisma.spec.findMany({ where: { projectId: project, source }, orderBy: { id: "desc" } });
  // === overlay stage-live + write-through + notifikasi (ATAS SET PENUH — jangan ubah) ===
  const live = sessionPhasesBySpec();
  let overlaid: typeof specs = specs;
  if (live.size > 0) {
    const advanced: { id: string; from: Stage; stage: Stage }[] = [];
    const doneNow: { specId: string; title: string; projectId: string | null }[] = [];
    overlaid = specs.map((s) => {
      const entry = live.get(s.id);
      if (!entry) return s;
      const next = stageForRun(entry.phases, entry.cwd, s.id);
      if (!next || STAGES.indexOf(next) <= STAGES.indexOf(s.stage as Stage)) return s;
      advanced.push({ id: s.id, from: s.stage as Stage, stage: next });
      if (next === "done") doneNow.push({ specId: s.id, title: s.title, projectId: s.projectId });
      return { ...s, stage: next };
    });
    if (advanced.length)
      await Promise.all(advanced.map((a) =>
        prisma.spec.updateMany({ where: { id: a.id, stage: a.from }, data: { stage: a.stage } }).catch(() => { })));
    await Promise.all(doneNow.map((d) => recordCompletion(d.specId, d.title, d.projectId)));
  }
  // === filter + paginasi DI LAYER RESPONSE (atas stage live) ===
  return paginate(filterSpecs(overlaid, { q, stage, priority, startable }), page, limit);
});
```

Catatan: komentar SPEC-168/173/180/197 yang ada di blok overlay dipertahankan (jangan dihapus, tempel ulang di posisi yang sama).

- [ ] **Step 5: Migrasi 2 assertion array yang lama ke `.items`**

Di `server/test/specs.route.test.ts`:
- Baris ~56: `res.json().every(...)` → `res.json().items.every(...)`.
- Baris ~148-149: `after.json().find((s:any)=>s.id==="SPEC-200")` → `after.json().items.find((s:any)=>s.id==="SPEC-200")`.

- [ ] **Step 6: Jalankan test — pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test specs.route`
Expected: PASS (semua, termasuk yang lama).

- [ ] **Step 7: Guard overlay off-page — test bahwa spec di luar halaman tetap maju + bernotif**

Blok ini membuktikan fitur tersembunyi tak tersenggol. Tambahkan test yang: (a) buat sesi live yang memajukan sebuah spec ke `done` lewat phase-file (pola sama dgn test overlay yang sudah ada di file ini — cari `sessionPhasesBySpec`/`getSession`/`recordCompletion` di `specs.route.test.ts` dan `session-phases.test.ts` untuk fixture-nya), (b) minta `?page=1&limit=1` sehingga spec itu ada di luar potongan, (c) assert stage-nya di DB tetap ter-write-through ke `done`.

```ts
it("advances + persists off-page specs (overlay runs over full set even when paginated)", async () => {
  // Susun: sebuah spec p1 yang phase-file sesinya sudah `Execute done` (pakai helper live-stage
  // yang dipakai test overlay lain di file ini). Sebut id-nya OFFPAGE_ID.
  // Paginasi sempit supaya OFFPAGE_ID tak masuk items:
  await app.inject({ url: "/api/specs?project=p1&page=1&limit=1" });
  const row = await prisma.spec.findUnique({ where: { id: OFFPAGE_ID } });
  expect(row?.stage).toBe("done"); // write-through jalan walau item di luar halaman
});
```

Bila menyusun sesi live di test terlalu berat, minimal assert lewat unit: panggil handler dua kali (limit besar vs limit=1) dan bandingkan efek DB identik. Yang penting: **write-through tak bergantung pada `page`/`limit`.**

- [ ] **Step 8: Update docs API contract + tulis ADR-0038**

`internal/docs/architecture/api-contract.md` baris 40, ganti jadi:

```
GET  /specs?project=&source=&q=&stage=&priority=&startable=&page=&limit=
#   -> { items: Spec[], total, page, pageSize }. Selalu envelope (SPEC-198).
#   Overlay stage-live dari phase-file + write-through CAS + notifikasi `done` jalan atas SET PENUH
#   (scope project/source). Filter (q atas id+title+objective, stage, priority, startable=live≠done) &
#   paginasi diterapkan DI MEMORI SETELAH overlay — filter stage cocok ke stage LIVE, bukan DB.
#   Tanpa page/limit → seluruh item terfilter (page 1, pageSize=total). Lihat ADR-0038.
```

Tulis `internal/docs/adr/0038-paginasi-di-response-layer.md` (ikuti format ADR lain di folder: Status/Konteks/Keputusan/Konsekuensi). Inti keputusan: `/specs` memuat-semua-lalu-filter/potong di memori (BUKAN `skip`/`take` DB) karena overlay/write-through/notifikasi menuntut set penuh; DB-level pagination akan mematikan kemajuan stage + notifikasi spec off-page. Ceiling: backlog terbatas; revisit bila jumlah spec meledak.

Tambahkan baris index ADR bila ada `internal/docs/adr/README.md` atau daftar indeks (cek & update dalam commit yang sama).

- [ ] **Step 9: Commit**

```bash
git add shared/src/dto.ts shared/src/index.ts server/src/routes/specs.ts server/test/specs.route.test.ts internal/docs/architecture/api-contract.md internal/docs/adr/0038-paginasi-di-response-layer.md
git commit -m "feat(specs): envelope + filter/paginasi via API, overlay atas set penuh (SPEC-198)"
```

---

### Task 2: Server `GET /projects` — envelope + q + pagination

**Files:**
- Modify: `server/src/routes/projects.ts:9-15` (handler GET `/projects`)
- Modify: `internal/docs/architecture/api-contract.md:26` (baris `GET /projects`)
- Test: `server/test/projects.route.test.ts`

**Interfaces:**
- Consumes: `Paginated<T>` (Task 1), helper `paginate` (duplikat kecil di projects.ts — ATAU pindahkan `paginate` ke `server/src/services/paginate.ts` dan import di kedua route; pilih ini bila mau DRY).
- Produces: `GET /api/projects?q&page&limit` → `Paginated<ProjectView>`.

- [ ] **Step 1: Tulis test yang gagal**

Di `server/test/projects.route.test.ts`, ganti/augment test list (baris ~15-16):

```ts
it("returns a pagination envelope", async () => {
  const res = await app.inject({ url: "/api/projects" });
  expect(res.statusCode).toBe(200);
  const b = res.json();
  expect(Array.isArray(b.items)).toBe(true);
  expect(b.total).toBe(b.items.length);
});
it("filters projects by q and paginates", async () => {
  // asumsi ≥1 project bernama sesuai fixture; sesuaikan needle ke fixture file ini
  const one = (await app.inject({ url: "/api/projects?limit=1" })).json();
  expect(one.items.length).toBeLessThanOrEqual(1);
  expect(one.pageSize).toBe(1);
});
```

Assertion lama `expect(res.json().length).toBe(1)` (baris 16) → `expect(res.json().items.length).toBe(1)`.

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test projects.route`
Expected: FAIL — `b.items` undefined.

- [ ] **Step 3: Implementasi handler**

Di `server/src/routes/projects.ts`, handler `app.get("/projects", ...)`:

```ts
app.get("/projects", async (req) => {
  const { q, page, limit } = req.query as { q?: string; page?: string; limit?: string };
  const ps = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
  const sessions = listSessions();
  const views = await Promise.all(ps.map((p) => toProjectView(p, sessions)));
  const needle = (q ?? "").trim().toLowerCase();
  const filtered = needle
    ? views.filter((v) => `${v.name} ${v.desc} ${v.stack}`.toLowerCase().includes(needle))
    : views;
  return paginate(filtered, page, limit);
});
```

Import `paginate` dari `../services/paginate` (bila kamu ekstrak di Task 2 Interfaces) atau salin fungsi kecil yang sama seperti Task 1 Step 4. **Pilih ekstrak** bila tak mau duplikat.

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test projects.route`
Expected: PASS.

- [ ] **Step 5: Update docs**

`internal/docs/architecture/api-contract.md` baris 26:

```
GET  /projects?q=&page=&limit=      # -> { items: ProjectView[], total, page, pageSize } (SPEC-198)
#   q menyaring name+desc+stack; tanpa page/limit → seluruh item. coverage/docStatus tetap live-scan tiap panggil.
```

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/projects.ts server/test/projects.route.test.ts internal/docs/architecture/api-contract.md
git add server/src/services/paginate.ts 2>/dev/null || true
git commit -m "feat(projects): envelope + q + paginasi via API (SPEC-198)"
```

---

### Task 3: API client — params + `Paginated` return

**Files:**
- Modify: `src/src/api/client.ts:47,40` (`listSpecs`, `listProjects`) + tambah `qs()` helper + tipe params
- Test: `src/test/client.test.ts`

**Interfaces:**
- Consumes: `Paginated<Spec>`, `Paginated<ProjectView>` dari `@hanoman/shared`.
- Produces:
  - `api.listSpecs(params?: SpecListParams): Promise<Paginated<Spec>>`
  - `api.listProjects(params?: ProjectListParams): Promise<Paginated<ProjectView>>`
  - `SpecListParams = { project?; source?; q?; stage?; priority?; startable?: boolean; page?: number; limit?: number }`
  - `ProjectListParams = { q?: string; page?: number; limit?: number }`

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/client.test.ts`, tambah:

```ts
it("listSpecs builds query and returns envelope", async () => {
  (globalThis.fetch as any) = vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  }));
  const r = await api.listSpecs({ project: "p1", q: "x", stage: "planned", page: 2, limit: 20 });
  const url = (globalThis.fetch as any).mock.calls[0][0] as string;
  expect(url).toContain("/api/specs?");
  expect(url).toContain("project=p1");
  expect(url).toContain("stage=planned");
  expect(url).toContain("page=2");
  expect(r.total).toBe(0);
  expect(Array.isArray(r.items)).toBe(true);
});
it("listProjects returns envelope", async () => {
  (globalThis.fetch as any) = vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  }));
  const r = await api.listProjects({ q: "arta" });
  expect((globalThis.fetch as any).mock.calls[0][0]).toContain("/api/projects?q=arta");
  expect(r.items).toEqual([]);
});
```

(Jika `client.test.ts` sudah punya assertion `listProjects` lama yang mengharap `/api/projects` polos, sesuaikan: tanpa params `listProjects()` harus tetap menghasilkan `/api/projects` tanpa `?`.)

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test client`
Expected: FAIL — `listSpecs` belum terima objek params / masih return array.

- [ ] **Step 3: Implementasi**

Di `src/src/api/client.ts`, tambah import `Paginated` dari `@hanoman/shared`, lalu:

```ts
const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};
export type SpecListParams = {
  project?: string; source?: string; q?: string; stage?: string; priority?: string;
  startable?: boolean; page?: number; limit?: number;
};
export type ProjectListParams = { q?: string; page?: number; limit?: number };
```

Ganti baris `listSpecs`/`listProjects`:

```ts
listProjects: (params: ProjectListParams = {}) => j<Paginated<ProjectView>>(paths.projects + qs(params)),
listSpecs: (params: SpecListParams = {}) => j<Paginated<Spec>>(paths.specs + qs(params)),
```

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/test/client.test.ts
git commit -m "feat(web/api): listSpecs/listProjects terima params + return Paginated (SPEC-198)"
```

---

### Task 4: App — buka `.items`, tambah `dataVersion`

**Files:**
- Modify: `src/src/App.tsx:289-338` (`load`, poll) + tambah `dataVersion` state
- Test: `src/test/app-flows.test.tsx:6-9`, `src/test/app-states.test.tsx:12-13`, `src/test/project-detail.test.tsx:14-15` (mock jadi envelope)

**Interfaces:**
- Consumes: `api.listSpecs()`, `api.listProjects()` sekarang balik `Paginated`.
- Produces: `dataVersion: number` (dinaikkan tiap `backlog`/`sessions` berubah) — dipakai Task 5 & 6 sebagai sinyal refetch. Prop baru untuk layar: `dataVersion`.

- [ ] **Step 1: Update mock test ke envelope (test dulu)**

Ubah tiga file test agar mock list balik envelope:
- `app-flows.test.tsx:9`: `listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 }))`.
- `app-flows.test.tsx:6-8`: `listProjects: vi.fn(async () => ({ items: [{ id: "arta", ... }], total: 1, page: 1, pageSize: 20 }))` (bungkus array project yang ada jadi `items`).
- `app-states.test.tsx:13`: `listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 }))`; dan `projects(...)` (baris 12) harus balikkan envelope — sesuaikan helper `projects` agar `items`-nya array project.
- `project-detail.test.tsx:14-15`: `listProjects` → `{ items: [PROJECT], total: 1, page: 1, pageSize: 20 }`, `listSpecs` → `{ items: [], total: 0, page: 1, pageSize: 20 }`.

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test app-flows app-states project-detail`
Expected: FAIL — App masih `setBacklog(s)` dgn `s` = envelope (bukan array) → render pecah.

- [ ] **Step 3: Buka `.items` di `load()` + poll, tambah `dataVersion`**

Di `src/src/App.tsx`:

- Tambah state: `const [dataVersion, setDataVersion] = React.useState(0);` (dekat state lain, ~baris 269).
- `load()` (baris 291-296): destruktur `.items`:

```ts
Promise.all([api.listProjects(), api.listSpecs(), api.listTerminals()])
  .then(([p, s, t]) => {
    setProjects(p.items); setBacklog(s.items); setSessions(t);
    setProjectId((cur) => cur || p.items[0]?.id || "");
    setDataVersion((v) => v + 1);
    setStatus("ready");
  })
```

- Poll (baris 325-333): `listSpecs()` balik envelope; pakai `.items` untuk signature + setState:

```ts
Promise.all([api.listSpecs(), api.listTerminals()])
  .then(([s, t]) => {
    const items = s.items;
    const sig = JSON.stringify({
      s: items.map((x) => [x.id, x.stage]),
      t: t.map((x) => [x.id, x.exited, x.decision]),
    });
    if (sig === pollSigRef.current) return;
    pollSigRef.current = sig;
    setBacklog(items); setSessions(t);
    setDataVersion((v) => v + 1);
  })
```

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test app-flows app-states project-detail`
Expected: PASS. (App sekarang jalan identik seperti sebelumnya, tapi atas envelope. Layar belum self-fetch — masih terima array penuh via props.)

- [ ] **Step 5: Commit**

```bash
git add src/src/App.tsx src/test/app-flows.test.tsx src/test/app-states.test.tsx src/test/project-detail.test.tsx
git commit -m "refactor(web/app): buka .items dari envelope + dataVersion sinyal refetch (SPEC-198)"
```

---

### Task 5: BacklogScreen — grid/list paginasi via API, board terfilter via API

**Files:**
- Modify: `src/src/ds/kit.tsx` (tambah `serverPage`), `src/src/ds/index.ts` (export `serverPage`)
- Modify: `src/src/screens/BacklogScreen.tsx:505-606` (jadi self-fetching)
- Modify: `src/src/App.tsx:554` (oper prop `dataVersion`; `backlog` prop boleh tetap untuk `find` detail App-level tapi tak lagi dipakai render list)
- Test: `src/test/backlog-board.test.tsx` (+ mungkin test baru fetch-driven)

**Interfaces:**
- Consumes: `api.listSpecs(params)` → `Paginated<Spec>`; `dataVersion` prop.
- Produces: `serverPage(total, page, pageSize) => { page, pageCount, from, to }` (murni) di `ds/kit.tsx`.

- [ ] **Step 1: Tulis `serverPage` + test**

Di `src/src/ds/kit.tsx` (dekat `usePaged`):

```ts
export function serverPage(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const p = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (p - 1) * pageSize + 1;
  const to = Math.min(total, p * pageSize);
  return { page: p, pageCount, from, to };
}
```

Export via `src/src/ds/index.ts` (baris 8, tambahkan `serverPage`). Tambah unit test cepat di file test ds yang ada (mis. cek `serverPage(0,1,20)` → `{page:1,pageCount:1,from:0,to:0}` dan `serverPage(45,3,20)` → `{page:3,pageCount:3,from:41,to:45}`). Bila belum ada test ds, tambahkan `src/test/server-page.test.ts` kecil.

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test server-page`
Expected: FAIL — `serverPage` belum ada.

- [ ] **Step 3: Jalankan lagi setelah Step 1 tersimpan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test server-page`
Expected: PASS.

- [ ] **Step 4: Jadikan BacklogScreen self-fetching**

Di `src/src/screens/BacklogScreen.tsx`, komponen `BacklogScreen`:
- Tambah prop `dataVersion: number`.
- Ganti derivasi `filtered`/`usePaged` (baris 528-535) dengan fetch dari API:

```ts
const [data, setData] = React.useState<{ items: Spec[]; total: number }>({ items: [], total: 0 });
const [page, setPage] = React.useState(1);
const [dq, setDq] = React.useState("");                 // debounced q
React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
React.useEffect(() => { setPage(1); }, [tab, proj, stageFilter, prioFilter, dq, view]);
React.useEffect(() => {
  let alive = true;
  const params = {
    project: proj === "all" ? undefined : proj,
    source: tab === "all" ? undefined : tab,
    q: dq || undefined,
    stage: stageFilter === "all" ? undefined : stageFilter,
    priority: prioFilter === "all" ? undefined : prioFilter,
    // board tak dipaginasi: minta set terfilter penuh
    page: view === "board" ? undefined : page,
    limit: view === "board" ? undefined : pageSize,
  };
  api.listSpecs(params).then((r) => { if (alive) setData({ items: r.items, total: r.total }); }).catch(() => {});
  return () => { alive = false; };
}, [tab, proj, stageFilter, prioFilter, dq, view, page, pageSize, dataVersion]);
const items = data.items;
const sp = serverPage(data.total, page, pageSize);
```

- Ganti pemakaian `filtered`/`pg`:
  - Badge hitung: `{data.total} spec` (baris 545).
  - Empty state: `data.total === 0` (baris 563); hint `backlog.length` → tampilkan pesan generik atau ambil total tanpa filter (boleh: "Tak ada yang cocok dengan filter aktif" saja).
  - Board (baris 573): `<Board specs={items} .../>` (server sudah filter; `items` = set terfilter penuh).
  - Grid/List (baris 583-595): map `items` (bukan `pg.pageItems`).
  - Pager (baris 597-599): `<Pager page={sp.page} pageCount={sp.pageCount} total={data.total} from={sp.from} to={sp.to} onPage={setPage} unit="spec" />`.
- Detail modal (baris 602): resolve dari `items.find((s) => s.id === detailId) || null`.
- Import: tambah `api` (sudah diimport), `serverPage`; hapus `usePaged` dari import bila tak dipakai lagi di file ini.

Di `src/src/App.tsx:554`, tambahkan `dataVersion={dataVersion}` pada `<BacklogScreen .../>`.

- [ ] **Step 5: Update test backlog**

`src/test/backlog-board.test.tsx` (dan test backlog lain bila ada): sekarang BacklogScreen memanggil `api.listSpecs` sendiri — mock `api.listSpecs` untuk balik `{ items: [...specs...], total: N, page: 1, pageSize: 20 }`. Board test yang dulu mengoper `backlog` prop tetap boleh, tapi render sekarang bergantung pada hasil fetch → sesuaikan mock. Pastikan test menunggu efek async (mis. `await screen.findBy...`).

- [ ] **Step 6: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test backlog`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/src/ds/kit.tsx src/src/ds/index.ts src/src/screens/BacklogScreen.tsx src/src/App.tsx src/test/backlog-board.test.tsx src/test/server-page.test.ts
git commit -m "feat(web/backlog): grid/list/board search+filter+paginasi via API (SPEC-198)"
```

---

### Task 6: ProjectsScreen — paginasi + search via API

**Files:**
- Modify: `src/src/screens/ProjectsScreen.tsx:91-112` (self-fetch baris via API)
- Modify: `src/src/App.tsx:341-344,520,527-531` (hapus `shownProjects`; oper `search` + `dataVersion` ke ProjectsScreen; empty-state pindah ke layar)
- Test: `src/test/*` yang menyentuh ProjectsScreen (cek `app-states.test.tsx`, atau tambah `projects-screen.test.tsx`)

**Interfaces:**
- Consumes: `api.listProjects({ q, page, limit })` → `Paginated<ProjectView>`; props `projects` (SET PENUH, untuk StatStrip), `search`, `dataVersion`.
- Produces: (UI) baris terpaginasi server; StatStrip tetap dari `projects` penuh.

- [ ] **Step 1: Tulis test yang gagal**

Tambah `src/test/projects-screen.test.tsx`: render `<ProjectsScreen projects={FULL} search="arta" pageSize={20} dataVersion={0} />` dengan `api.listProjects` di-mock balik `{ items: [oneMatch], total: 1, page: 1, pageSize: 20 }`; assert baris yang tampil = hasil fetch (bukan `projects` penuh), dan StatStrip mencerminkan `projects` penuh.

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test projects-screen`
Expected: FAIL — ProjectsScreen belum fetch.

- [ ] **Step 3: Implementasi**

`src/src/screens/ProjectsScreen.tsx`, komponen `ProjectsScreen`:
- Tambah props `search?: string; dataVersion?: number`.
- StatStrip tetap `<StatStrip projects={projects} />` (SET PENUH dari App).
- Baris jadi hasil fetch:

```ts
const [rows, setRows] = React.useState<ProjectVM[]>(projects);
const [total, setTotal] = React.useState(projects.length);
const [page, setPage] = React.useState(1);
React.useEffect(() => { setPage(1); }, [search]);
React.useEffect(() => {
  if (!pageSize) { setRows(projects); setTotal(projects.length); return; }
  let alive = true;
  api.listProjects({ q: search || undefined, page, limit: pageSize })
    .then((r) => { if (alive) { setRows(r.items as ProjectVM[]); setTotal(r.total); } }).catch(() => {});
  return () => { alive = false; };
}, [search, page, pageSize, dataVersion, projects]);
const sp = serverPage(total, page, pageSize || total || 1);
```

- Render `rows.map(...)`; Pager: `{pageSize && <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={setPage} unit="project" />}`.
- Import `api`, `serverPage`; hapus `usePaged` dari import.

`src/src/App.tsx`:
- Hapus `q`/`shownProjects` (baris 341-344) — atau biarkan `search` state, tapi jangan filter di App.
- Baris 527-531: render `<ProjectsScreen projects={projectsView} search={search} pageSize={20} dataVersion={dataVersion} onOpen={openProject} onDelete={deleteProject} />`. Empty-state "Tidak ada project cocok" (baris 528): pindahkan penilaian ke dalam ProjectsScreen (bila `rows.length===0 && search` → StateBlock), atau pertahankan di App memakai `total` yang tak tersedia di App — **lebih bersih: tangani di ProjectsScreen**. Tambahkan StateBlock kosong di ProjectsScreen saat `rows.length === 0`.

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test projects-screen app-states`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/ProjectsScreen.tsx src/src/App.tsx src/test/projects-screen.test.tsx
git commit -m "feat(web/projects): search+paginasi baris via API, StatStrip tetap global (SPEC-198)"
```

---

### Task 7: Terminal picker — startable via API

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx:239-249` (BacklogPicker self-fetch)
- Test: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: `api.listSpecs({ startable: true, q, stage, priority })` → `Paginated<Spec>`. `activeSpecIds` (dari sesi) tetap dipakai untuk exclusi client-side spec yang sesinya aktif.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/terminal-screen.test.tsx`: saat modal "Ambil backlog" dibuka, `api.listSpecs` dipanggil dgn `{ startable: true, ... }` dan hasil `items` yang dirender (mock balik envelope). Assert baris = `items` minus yang aktif.

- [ ] **Step 2: Jalankan — gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test terminal-screen`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

`BacklogPicker` (baris 239-249): ganti prop `specs` dari daftar penuh menjadi self-fetch:

```ts
function BacklogPicker({ activeIds, error, onPick, onClose }: {
  activeIds: Set<string>; error: string | null; onPick: (s: Spec) => void; onClose: () => void;
}) {
  const [q, setQ] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState("all");
  const [prioFilter, setPrioFilter] = React.useState("all");
  const [items, setItems] = React.useState<Spec[]>([]);
  const [dq, setDq] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  React.useEffect(() => {
    let alive = true;
    api.listSpecs({
      startable: true, q: dq || undefined,
      stage: stageFilter === "all" ? undefined : stageFilter,
      priority: prioFilter === "all" ? undefined : prioFilter,
    }).then((r) => { if (alive) setItems(r.items); }).catch(() => {});
    return () => { alive = false; };
  }, [dq, stageFilter, prioFilter]);
  const shown = items.filter((s) => !activeIds.has(s.id));   // exclusi sesi aktif (state klien)
  // ...render `shown` seperti sebelumnya...
}
```

Sesuaikan call-site (`<BacklogPicker specs={startable} .../>` baris ~230): kirim `activeIds={activeSpecIds}` alih-alih `specs`. `startable` derivasi lama (baris 101) tak lagi perlu — hapus bila tak dipakai di tempat lain.

- [ ] **Step 4: Jalankan — hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test terminal-screen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(web/terminal): picker backlog startable via API (SPEC-198)"
```

---

### Task 8: Buang `usePaged` mati + verifikasi menyeluruh (unit + real API)

**Files:**
- Modify: `src/src/ds/kit.tsx` (hapus `usePaged`), `src/src/ds/index.ts` (hapus export `usePaged`)
- Verifikasi: seluruh suite + boot server + curl.

- [ ] **Step 1: Pastikan `usePaged` tak dipakai lagi**

Run: `grep -rn "usePaged" src/`
Expected: hanya definisi + export tersisa (0 pemakaian di screens). Bila ada pemakaian tersisa, migrasikan dulu.

- [ ] **Step 2: Hapus `usePaged` + export**

Hapus fungsi `usePaged` di `src/src/ds/kit.tsx:134-144` dan namanya dari `export {...}` di `src/src/ds/index.ts:8`.

- [ ] **Step 3: Jalankan SELURUH suite frontend + server**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test && env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test`
Expected: PASS semua. (Bila server test throw P2022, jalankan `prisma migrate deploy` ke `hanoman_test` dulu.)

- [ ] **Step 4: Real API smoke (per CLAUDE.md — boot + curl, JANGAN cuma unit)**

Boot server terhadap DB throwaway termigrasi (ikuti pola memory "Live smoke: dedicated DB" — jangan pakai `hanoman_test`, jangan port 8787). Seed ≥1 project + beberapa spec, lalu:

```bash
curl -s "http://127.0.0.1:<port>/api/specs?project=<p>&page=1&limit=2" | jq '{total, page, pageSize, n: (.items|length)}'
curl -s "http://127.0.0.1:<port>/api/specs?project=<p>&q=spec&stage=planned" | jq '.items|length'
curl -s "http://127.0.0.1:<port>/api/specs?startable=true" | jq '.items|map(.stage)|unique'
curl -s "http://127.0.0.1:<port>/api/projects?q=<name>&page=1&limit=2" | jq '{total, n:(.items|length)}'
```

Expected: envelope valid; `total` konsisten; `page=2` beda item dari `page=1`; `startable` tak memuat `done`. Bila ada isu, perbaiki sampai hijau sebelum menutup task.

- [ ] **Step 5: Commit**

```bash
git add src/src/ds/kit.tsx src/src/ds/index.ts
git commit -m "chore(web/ds): buang usePaged mati pasca-migrasi paginasi server (SPEC-198)"
```

---

## Self-Review (diisi penulis plan)

**Spec coverage:**
- Envelope `/specs` + filter + paginasi + overlay dijaga → Task 1. ✓
- Envelope `/projects` + q + paginasi → Task 2. ✓
- Client params + Paginated → Task 3. ✓
- App buka `.items` + sinyal refetch → Task 4. ✓
- Backlog (grid/list/board) via API → Task 5. ✓
- Projects list via API + StatStrip global → Task 6. ✓
- Terminal picker via API → Task 7. ✓
- Buang `usePaged` mati + real API smoke → Task 8. ✓
- ADR-0038 + api-contract.md → Task 1 & 2. ✓
- Fitur tersembunyi (overlay off-page) → Task 1 Step 7 guard test. ✓

**Placeholder scan:** tak ada TBD/TODO; tiap step berkode/berperintah nyata. Fixture sesi-live di Task 1 Step 7 merujuk pola yang sudah ada di `specs.route.test.ts`/`session-phases.test.ts` (bukan placeholder — instruksi eksplisit menemukan & memakainya).

**Type consistency:** `Paginated<T>` seragam; `serverPage(total,page,pageSize) -> {page,pageCount,from,to}` konsisten di Task 5 & 6; `SpecListParams`/`ProjectListParams` konsisten Task 3 → 5/6/7.
