# Breakdown PRD → backlog — Implementation Plan (SPEC-273)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pecah 1 PRD kompleks menjadi N backlog kecil, terukur, dan parallel-safe lewat sesi `breakdown` yang menulis manifest, lalu materialize batch yang di-review manusia.

**Architecture:** Sesi `claude` flow baru `breakdown` membaca PRD (tersemat di prompt) → menulis `docs/prd/<slug>.breakdown.md` (prosa + satu blok ```json kanonik). Server mem-parse manifest freshest-wins dan mengeksposnya; UI menampilkan usulan backlog untuk di-review lalu `POST /specs/batch` membuat N spec independen. Paralelisme eksekusi sudah ditanggung arsitektur (satu backlog = satu sesi di worktree terisolasi). Tanpa perubahan skema.

**Tech Stack:** TypeScript strict · Fastify + Prisma/Postgres · React+Vite · runner library (prompt) · zod (`@hanoman/shared`) · vitest (`vitest run --no-file-parallelism`).

## Global Constraints

- TypeScript strict di semua paket. Test tiap logika orkestrasi.
- **Tanpa migration / perubahan skema** — breakdown = dokumen + baris `Spec` biasa; provenance PRD di teks Konteks.
- Enum priority = `"tinggi" | "sedang" | "rendah"` (`zPriority`). Spec source materialize = `"brief"`.
- Manifest path = sibling PRD: `docs/prd/<slug>.md` → `docs/prd/<slug>.breakdown.md`.
- Kontrak mesin manifest = TEPAT SATU blok ```json: `{ "items": [ { "title", "context", "outcome", "priority" } ] }`.
- Freshest-wins baca doc = cwd sesi hidup untuk project > repoDir (pola `project-prds.ts`).
- Jalankan test: `env -u NODE_ENV -u DATABASE_URL pnpm test` (hindari env prod bocor). Test server bisa di-run per paket.
- Docs tersentuh diperbarui + ter-link di `internal/docs/README.md` **dalam commit yang sama**.
- Commit message diakhiri: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `shared/src/dto.ts` — +`"breakdown"` di `zFlow`; +`zBreakdownItem`/`zBreakdownDoc`/`zBatchCreateSpec`; +varian union `zTerminalSession`.
- `shared/src/api.ts` — +`paths.breakdown(id, prd)`, +`paths.specsBatch`.
- `runner/src/types.ts` — +`"breakdown"` di `Flow`; +tipe `BreakdownPrd`.
- `runner/src/prompt.ts` — +`PIPELINES.breakdown`; +`startBreakdownPrompt`.
- `server/src/services/project-breakdowns.ts` — **baru**: `breakdownPathFor`, `parseBreakdown`, `readBreakdown`.
- `server/src/routes/docs.ts` — +`GET /projects/:id/breakdown`.
- `server/src/routes/specs.ts` — +`POST /specs/batch`.
- `server/src/routes/terminal.ts` — +cabang `flow === "breakdown"`.
- `src/src/api/client.ts` — +`startBreakdown`/`getBreakdown`/`createSpecsBatch`.
- `src/src/screens/PrdScreen.tsx` + `src/src/App.tsx` — UI breakdown + wiring.
- `internal/docs/adr/0069-*.md` + `internal/docs/README.md` + `architecture/api-contract.md` + `architecture/data-model.md` + `entrypoints/prd.md` — docs.

---

### Task 1: Shared — Flow, breakdown types, batch schema, terminal union, paths

**Files:**
- Modify: `shared/src/dto.ts`
- Modify: `shared/src/api.ts`
- Test: `shared/test/dto.test.ts` (buat bila belum ada) atau `shared/test/breakdown.test.ts`

**Interfaces:**
- Produces: `zFlow` (incl `"breakdown"`); `zBreakdownItem = {title:string; context:string; outcome:string; priority:"tinggi"|"sedang"|"rendah"}`; `zBreakdownDoc = {items: BreakdownItem[]; live: boolean}`; `zBatchCreateSpec = {project:string; items: BreakdownItem[]; branchFrom?:string; prdPath?:string}`; `paths.breakdown(id,prd)`; `paths.specsBatch`.

- [ ] **Step 1: Write the failing test** — buat `shared/test/breakdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zFlow, zBreakdownItem, zBatchCreateSpec, paths } from "../src";

describe("SPEC-273 breakdown schemas", () => {
  it("zFlow menerima 'breakdown'", () => {
    expect(zFlow.safeParse("breakdown").success).toBe(true);
  });
  it("zBreakdownItem: default context/outcome/priority", () => {
    const p = zBreakdownItem.parse({ title: "Endpoint upload" });
    expect(p).toEqual({ title: "Endpoint upload", context: "", outcome: "", priority: "sedang" });
  });
  it("zBreakdownItem menolak title kosong", () => {
    expect(zBreakdownItem.safeParse({ title: "" }).success).toBe(false);
  });
  it("zBatchCreateSpec butuh minimal 1 item", () => {
    expect(zBatchCreateSpec.safeParse({ project: "p1", items: [] }).success).toBe(false);
    const ok = zBatchCreateSpec.safeParse({ project: "p1", items: [{ title: "A" }] });
    expect(ok.success).toBe(true);
  });
  it("paths: breakdown meng-encode prd, specsBatch statis", () => {
    expect(paths.breakdown("p1", "docs/prd/x.md")).toBe("/api/projects/p1/breakdown?prd=docs%2Fprd%2Fx.md");
    expect(paths.specsBatch).toBe("/api/specs/batch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared exec vitest run test/breakdown.test.ts`
Expected: FAIL (`zBreakdownItem`/`zBatchCreateSpec`/`paths.breakdown` undefined).

- [ ] **Step 3a: Edit `shared/src/dto.ts`** — tambah `"breakdown"` ke `zFlow`:

```ts
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd", "audit", "breakdown"]);
```

Lalu tepat di bawah blok `zPrdDoc`/`PrdDoc` (sekitar baris 113) tambahkan:

```ts
// SPEC-273 · breakdown PRD → N backlog paralel-independen. Item = brief satu backlog.
export const zBreakdownItem = z.object({
  title: z.string().min(1),
  context: z.string().default(""),
  outcome: z.string().default(""),
  priority: zPriority.default("sedang"),
});
export type BreakdownItem = z.infer<typeof zBreakdownItem>;
// Hasil parse manifest docs/prd/<slug>.breakdown.md (live = dibaca dari worktree sesi breakdown hidup).
export const zBreakdownDoc = z.object({
  items: z.array(zBreakdownItem),
  live: z.boolean(),
});
export type BreakdownDoc = z.infer<typeof zBreakdownDoc>;
// Materialize breakdown → N spec. prdPath dipakai untuk provenance di teks Konteks (tanpa kolom baru).
export const zBatchCreateSpec = z.object({
  project: z.string(),
  items: z.array(zBreakdownItem).min(1),
  branchFrom: z.string().min(1).optional(),
  prdPath: z.string().optional(),
});
export type BatchCreateSpec = z.infer<typeof zBatchCreateSpec>;
```

- [ ] **Step 3b: Edit `shared/src/dto.ts`** — tambah varian breakdown ke `zTerminalSession` (setelah varian prd, baris ~126):

```ts
  // SPEC-273 · sesi breakdown project-level: pecah SATU PRD (prdPath) → manifest N backlog.
  z.object({ project: z.string(), flow: z.literal("breakdown"), prdPath: z.string().min(1) }),
```

- [ ] **Step 3c: Edit `shared/src/api.ts`** — setelah `prdFile` (baris ~26) tambah:

```ts
  // SPEC-273 · manifest breakdown sebuah PRD (freshest-wins) + materialize batch.
  breakdown: (id: string, prd: string) => `${API}/projects/${id}/breakdown?prd=${encodeURIComponent(prd)}`,
  specsBatch: `${API}/specs/batch`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared exec vitest run test/breakdown.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck shared + commit**

Run: `pnpm --filter ./shared typecheck`
```bash
git add shared/src/dto.ts shared/src/api.ts shared/test/breakdown.test.ts
git commit -m "feat(spec-273): shared breakdown schemas + flow + paths

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Runner — PIPELINES.breakdown + startBreakdownPrompt

**Files:**
- Modify: `runner/src/types.ts`
- Modify: `runner/src/prompt.ts`
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `Flow` (incl `"breakdown"`); `ProjectBrief`.
- Produces: `PIPELINES.breakdown = ["Analisis", "Breakdown"]`; `BreakdownPrd = {title:string; path:string; content:string}`; `startBreakdownPrompt(project: ProjectBrief, prd: BreakdownPrd, branchTo: string): string`.

- [ ] **Step 1: Write the failing test** — tambah di `runner/test/prompt.test.ts` (impor `startBreakdownPrompt` di baris import atas):

```ts
// import baris atas: tambah startBreakdownPrompt ke daftar dari "../src/prompt"
describe("startBreakdownPrompt (SPEC-273)", () => {
  const project = { id: "acme", name: "Acme", desc: "", stack: "" };
  const prd = { title: "Jadwal Invoice Berulang", path: "docs/prd/jadwal-invoice.md",
    content: "# Jadwal Invoice Berulang\n\nScope: A, B, C." };
  const p = startBreakdownPrompt(project, prd, "breakdown/jadwal-invoice");

  it("pipeline breakdown = Analisis → Breakdown", () => {
    expect(PIPELINES.breakdown).toEqual(["Analisis", "Breakdown"]);
  });
  it("menyematkan isi PRD dan path manifest", () => {
    expect(p).toContain("Scope: A, B, C.");
    expect(p).toContain("docs/prd/jadwal-invoice.breakdown.md");
  });
  it("mewajibkan backlog non-overlapping tanpa cross-dependency", () => {
    expect(p.toLowerCase()).toContain("non-overlapping");
    expect(p.toLowerCase()).toContain("dependency");
    expect(p).toContain("```json");
  });
  it("push ke branch breakdown + tak menulis kode fitur", () => {
    expect(p).toContain("git push origin HEAD:refs/heads/breakdown/jadwal-invoice");
    expect(p).toContain("JANGAN menulis kode fitur");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner exec vitest run test/prompt.test.ts -t breakdown`
Expected: FAIL (`startBreakdownPrompt`/`PIPELINES.breakdown` undefined).

- [ ] **Step 3a: Edit `runner/src/types.ts`** — perbarui `Flow` dan tambah tipe:

```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown";
```
lalu di bawah `PrdBrief` tambahkan:
```ts
// SPEC-273 · PRD yang dipecah sesi breakdown. content = isi PRD tersemat langsung ke prompt,
// jadi breakdown lepas dari status merge PRD (tak perlu PRD sudah ada di default branch).
export type BreakdownPrd = { title: string; path: string; content: string };
```

- [ ] **Step 3b: Edit `runner/src/prompt.ts`** — impor `BreakdownPrd`, tambah pipeline, dan fungsi prompt.

Ubah baris import atas:
```ts
import type { Flow, SpecBrief, ProjectBrief, PrdBrief, BreakdownPrd } from "./types";
```
Tambah entri di `PIPELINES`:
```ts
  breakdown: ["Analisis", "Breakdown"],
```
Tambah fungsi baru (setelah `startPrdPrompt`):
```ts
// SPEC-273 · sesi breakdown: pecah SATU PRD kompleks → BEBERAPA backlog kecil yang PARALEL-aman
// (tanpa saling bergantung). Project-level (tanpa Spec), meniru startPrdPrompt. Isi PRD disematkan
// (lepas dari status merge). Keluaran HANYA manifest doc — tak menulis kode fitur. Autonomous
// (analisis, bukan brainstorm bergiliran) → memakai AUTONOMY_CLAUSE.
export function startBreakdownPrompt(project: ProjectBrief, prd: BreakdownPrd, branchTo: string): string {
  const slug = branchTo.slice(branchTo.lastIndexOf("/") + 1);
  return [
    `hanoman breakdown. Kamu memecah SATU PRD kompleks menjadi BEBERAPA backlog kecil yang bisa `
      + `dikerjakan PARALEL tanpa saling bergantung. Keluaranmu HANYA dokumen manifest — `
      + `JANGAN menulis kode fitur.`,
    phaseInstruction(PIPELINES.breakdown),
    `- Analisis: baca PRD (di bawah) sampai paham SELURUH scope in-PRD. Petakan pekerjaan menjadi `
      + `unit-unit yang: (a) kecil & terukur — tiap unit tuntas dalam satu sesi; (b) non-overlapping `
      + `— cakupan tak tumpang tindih; (c) TANPA cross-dependency — urutan bebas, bisa jalan bersamaan; `
      + `(d) gabungannya MENUTUP seluruh scope PRD. Bila dua unit terpaksa berurutan, gabung jadi satu.`,
    `- Breakdown: tulis manifest ke \`docs/prd/${slug}.breakdown.md\`. Awali heading `
      + `\`# Breakdown: ${prd.title}\`, lalu prosa: ringkasan + untuk TIAP backlog satu paragraf `
      + `(judul, cakupan, dan SATU kalimat kenapa aman-paralel / tak bergantung yang lain). `
      + `Di AKHIR dokumen sertakan TEPAT SATU blok kode berpagar json berisi kontrak mesin PERSIS `
      + `bentuk ini (tanpa komentar, priority ∈ tinggi|sedang|rendah):\n`
      + "```json\n"
      + `{ "items": [ { "title": "…", "context": "…", "outcome": "…", "priority": "sedang" } ] }\n`
      + "```\n"
      + `\`context\` = bagian PRD yang dicakup; \`outcome\` = kondisi selesai terukur; \`title\` ringkas. `
      + `Minimal 2 item bila PRD memang kompleks; bila PRD ternyata sekecil 1 unit, katakan itu di `
      + `prosa dan tetap tulis 1 item.`,
    AUTONOMY_CLAUSE,
    `Setelah manifest ditulis: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Bila remote `
      + `origin tidak ada, lewati push dan catat itu di terminal — jangan gagal diam-diam. Worktree `
      + `ini detached HEAD — memang disengaja. Manusia me-review manifest lalu materialize backlog darinya.`,
    `Project ${project.id} · ${project.name}\n=== PRD: ${prd.title} (${prd.path}) ===\n${prd.content}`,
  ].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./runner exec vitest run test/prompt.test.ts`
Expected: PASS (semua, termasuk 4 test breakdown baru).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter ./runner typecheck`
```bash
git add runner/src/types.ts runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(spec-273): runner startBreakdownPrompt + PIPELINES.breakdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Server — project-breakdowns service (parse + read freshest-wins)

**Files:**
- Create: `server/src/services/project-breakdowns.ts`
- Test: `server/test/project-breakdowns.test.ts`

**Interfaces:**
- Consumes: `zBreakdownItem`; `resolveRepoDir`; `readDocFile`; `listSessions` (dari `pty`).
- Produces: `breakdownPathFor(prdPath: string): string | null`; `parseBreakdown(md: string): BreakdownItem[]`; `readBreakdown(projectId: string, prdPath: string, sessions?): Promise<{ items: BreakdownItem[]; live: boolean }>`.

- [ ] **Step 1: Write the failing test** — `server/test/project-breakdowns.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { breakdownPathFor, parseBreakdown, readBreakdown } from "../src/services/project-breakdowns";
import { resetDb, makeProject, makeTempRepo } from "./factory";

const MANIFEST = `# Breakdown: Jadwal Invoice

Ringkasan.

\`\`\`json
{ "items": [
  { "title": "Endpoint jadwal", "context": "bagian A", "outcome": "POST /jadwal jalan", "priority": "tinggi" },
  { "title": "UI daftar jadwal", "context": "bagian B", "outcome": "list tampil" }
] }
\`\`\`
`;

describe("breakdownPathFor", () => {
  it("PRD → sibling .breakdown.md", () => {
    expect(breakdownPathFor("docs/prd/jadwal.md")).toBe("docs/prd/jadwal.breakdown.md");
  });
  it("tolak non-PRD & manifest itu sendiri", () => {
    expect(breakdownPathFor("docs/other.md")).toBe(null);
    expect(breakdownPathFor("docs/prd/jadwal.breakdown.md")).toBe(null);
  });
});

describe("parseBreakdown", () => {
  it("ambil blok json, zod tiap item, isi default", () => {
    const items = parseBreakdown(MANIFEST);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Endpoint jadwal", priority: "tinggi" });
    expect(items[1]).toMatchObject({ title: "UI daftar jadwal", priority: "sedang", outcome: "list tampil" });
  });
  it("tanpa blok json → []", () => {
    expect(parseBreakdown("# Breakdown\n\nteks saja")).toEqual([]);
  });
  it("json rusak → []", () => {
    expect(parseBreakdown("```json\n{ items: [ }\n```")).toEqual([]);
  });
  it("item invalid (title kosong) dibuang, valid dipertahankan", () => {
    const md = '```json\n{ "items": [ { "title": "" }, { "title": "ok" } ] }\n```';
    expect(parseBreakdown(md).map((i) => i.title)).toEqual(["ok"]);
  });
});

describe("readBreakdown (freshest-wins repoDir)", () => {
  let dir: string;
  beforeEach(async () => {
    await resetDb();
    dir = makeTempRepo({ "docs/prd/jadwal.breakdown.md": MANIFEST });
    await makeProject({ id: "p1", repoDir: dir });
  });
  it("baca manifest dari repoDir", async () => {
    const r = await readBreakdown("p1", "docs/prd/jadwal.md", []);
    expect(r.items).toHaveLength(2);
    expect(r.live).toBe(false);
  });
  it("prdPath non-PRD → items []", async () => {
    expect((await readBreakdown("p1", "docs/x.md", [])).items).toEqual([]);
  });
  it("manifest belum ada → items []", async () => {
    const d2 = makeTempRepo({ "docs/prd/lain.md": "# lain" });
    await makeProject({ id: "p2", repoDir: d2 });
    expect((await readBreakdown("p2", "docs/prd/lain.md", [])).items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/project-breakdowns.test.ts`
Expected: FAIL (module `project-breakdowns` tak ada).

- [ ] **Step 3: Create `server/src/services/project-breakdowns.ts`:**

```ts
import type { BreakdownItem } from "@hanoman/shared";
import { zBreakdownItem } from "@hanoman/shared";
import { resolveRepoDir } from "./local-binding";
import { readDocFile } from "./scan";
import { listSessions } from "./pty";

// SPEC-273 · manifest breakdown = sibling PRD: docs/prd/<slug>.md → docs/prd/<slug>.breakdown.md.
// PRD = dokumen (ADR-0041); breakdown menempel di sampingnya, dibaca freshest-wins seperti PRD.
const PRD_DIR = "docs/prd/";
const isPrd = (rel: string) => rel.startsWith(PRD_DIR) && rel.endsWith(".md");

export function breakdownPathFor(prdPath: string): string | null {
  if (!isPrd(prdPath) || prdPath.endsWith(".breakdown.md")) return null;
  return prdPath.slice(0, -3) + ".breakdown.md";
}

// Ambil blok ```json PERTAMA, JSON.parse, lalu zod tiap item. Toleran: tanpa blok / json rusak →
// []; item yang tak lolos zod dibuang (bukan gagal keras) — manifest ditulis agen, harus defensif.
export function parseBreakdown(md: string): BreakdownItem[] {
  const m = md.match(/```json\s*([\s\S]*?)```/);
  if (!m) return [];
  let data: unknown;
  try { data = JSON.parse(m[1]!); } catch { return []; }
  const arr = data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
    ? (data as { items: unknown[] }).items : [];
  const out: BreakdownItem[] = [];
  for (const it of arr) {
    const p = zBreakdownItem.safeParse(it);
    if (p.success) out.push(p.data);
  }
  return out;
}

// cwd sesi breakdown HIDUP untuk project ini (worktree, memuat draft belum di-merge) > repoDir.
async function resolveDir(
  projectId: string, sessions: ReturnType<typeof listSessions>,
): Promise<{ dir: string | null; live: boolean }> {
  const live = sessions.find((s) => s.projectId === projectId && s.flow === "breakdown" && !s.exited && s.cwd);
  if (live) return { dir: live.cwd, live: true };
  return { dir: await resolveRepoDir(projectId), live: false };
}

export async function readBreakdown(
  projectId: string, prdPath: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ items: BreakdownItem[]; live: boolean }> {
  const rel = breakdownPathFor(prdPath);
  if (!rel) return { items: [], live: false };
  const { dir, live } = await resolveDir(projectId, sessions);
  if (!dir) return { items: [], live };
  const md = readDocFile(dir, rel);
  return { items: md ? parseBreakdown(md) : [], live };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/project-breakdowns.test.ts`
Expected: PASS (semua).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/project-breakdowns.ts server/test/project-breakdowns.test.ts
git commit -m "feat(spec-273): project-breakdowns service (parse manifest freshest-wins)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Server — GET /projects/:id/breakdown route

**Files:**
- Modify: `server/src/routes/docs.ts`
- Test: `server/test/docs.route.test.ts`

**Interfaces:**
- Consumes: `readBreakdown`.
- Produces: `GET /api/projects/:id/breakdown?prd=<path>` → `{ items: BreakdownItem[]; live: boolean }`.

- [ ] **Step 1: Write the failing test** — tambah di `server/test/docs.route.test.ts` (di dalam file, blok describe baru di bawah). `dir` sudah di-seed di `beforeEach` global; tambah manifest ke seed itu terlebih dulu:

Di `beforeEach` (objek `makeTempRepo`), tambah entri:
```ts
    "docs/prd/x.md": "# x prd",
    "docs/prd/x.breakdown.md": '# Breakdown: x\n\n```json\n{ "items": [ { "title": "satu" }, { "title": "dua" } ] }\n```',
```
Lalu tambah describe:
```ts
describe("SPEC-273 · GET /projects/:id/breakdown", () => {
  it("mengembalikan items dari manifest", async () => {
    const res = await app.inject({ url: "/api/projects/p1/breakdown?prd=docs/prd/x.md" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: any) => i.title)).toEqual(["satu", "dua"]);
    expect(res.json().live).toBe(false);
  });
  it("prd tanpa manifest → items []", async () => {
    const res = await app.inject({ url: "/api/projects/p1/breakdown?prd=docs/prd/none.md" });
    expect(res.json().items).toEqual([]);
  });
  it("tanpa query prd → items []", async () => {
    expect((await app.inject({ url: "/api/projects/p1/breakdown" })).json().items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/docs.route.test.ts -t breakdown`
Expected: FAIL (route 404 / handler belum ada).

- [ ] **Step 3: Edit `server/src/routes/docs.ts`** — impor + route. Ubah baris import:
```ts
import { listPrds, listAllPrds, readPrd } from "../services/project-prds";
import { readBreakdown } from "../services/project-breakdowns";
```
Tambahkan route (setelah handler `GET /projects/:id/prds/*`):
```ts
  // SPEC-273 · manifest breakdown sebuah PRD (freshest-wins). prd absen / tak-PRD / manifest belum
  // ada → { items: [] } (bukan 404): UI memakainya untuk memutuskan "mulai sesi" vs "review usulan".
  app.get("/projects/:id/breakdown", async (req) => {
    const { id } = req.params as { id: string };
    const { prd } = req.query as { prd?: string };
    return readBreakdown(id, prd ?? "");
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/docs.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/docs.ts server/test/docs.route.test.ts
git commit -m "feat(spec-273): GET /projects/:id/breakdown route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Server — POST /specs/batch route

**Files:**
- Modify: `server/src/routes/specs.ts`
- Test: `server/test/specs-batch.route.test.ts`

**Interfaces:**
- Consumes: `zBatchCreateSpec`; `nextSpecId`; `deriveSpecFields`; `branchUnknown`; `enqueueOutbox`; `resolveRepoDir`.
- Produces: `POST /api/specs/batch` body `{ project, items, branchFrom?, prdPath? }` → `201 { created: Spec[] }`; `400` items kosong / branch tak dikenal; `404` project tak ada.

- [ ] **Step 1: Write the failing test** — `server/test/specs-batch.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeRepoWithBranches } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => {
  await resetDb();
  const dir = makeRepoWithBranches("feat/x");
  await makeProject({ id: "p1", repoDir: dir });
});

const post = (body: unknown) =>
  app.inject({ method: "POST", url: "/api/specs/batch", payload: body });

describe("SPEC-273 · POST /specs/batch", () => {
  it("membuat N spec dengan id berurutan + provenance PRD di objective/konteks", async () => {
    const res = await post({ project: "p1", prdPath: "docs/prd/x.md",
      items: [
        { title: "A", context: "ctx-a", outcome: "out-a", priority: "tinggi" },
        { title: "B", context: "ctx-b", outcome: "out-b" },
      ] });
    expect(res.statusCode).toBe(201);
    const created = res.json().created;
    expect(created).toHaveLength(2);
    expect(created[0].source).toBe("brief");
    expect(created[0].title).toBe("A");
    expect(created[0].priority).toBe("tinggi");
    // id unik & berurutan
    const nums = created.map((s: any) => Number(s.id.match(/\d+/)[0]));
    expect(nums[1]).toBe(nums[0] + 1);
    // provenance: prdPath tersimpan di payload.context
    const row = await prisma.spec.findUnique({ where: { id: created[0].id } });
    expect((row!.payload as any).context).toContain("docs/prd/x.md");
    expect((row!.payload as any).context).toContain("ctx-a");
  });
  it("items kosong → 400", async () => {
    expect((await post({ project: "p1", items: [] })).statusCode).toBe(400);
  });
  it("project tak ada → 404", async () => {
    expect((await post({ project: "nope", items: [{ title: "A" }] })).statusCode).toBe(404);
  });
  it("branchFrom tak dikenal → 400", async () => {
    const res = await post({ project: "p1", branchFrom: "ghost", items: [{ title: "A" }] });
    expect(res.statusCode).toBe(400);
  });
  it("branchFrom valid diteruskan ke tiap spec", async () => {
    const res = await post({ project: "p1", branchFrom: "feat/x", items: [{ title: "A" }] });
    expect(res.statusCode).toBe(201);
    expect(res.json().created[0].branchFrom).toBe("feat/x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/specs-batch.route.test.ts`
Expected: FAIL (route 404).

- [ ] **Step 3: Edit `server/src/routes/specs.ts`** — impor `zBatchCreateSpec` di baris import shared:
```ts
import { zCreateSpec, zPatchSpec, zIntegrate, zBatchCreateSpec, type Stage } from "@hanoman/shared";
```
Tambahkan handler tepat setelah blok `app.post("/specs", ...)` (sebelum `app.patch("/specs/:id", ...)`):
```ts
  // SPEC-273 · materialize breakdown: buat N spec independen dari usulan yang di-review manusia.
  // Tiap item = brief satu backlog; provenance PRD dicantumkan di teks Konteks (tanpa kolom baru,
  // pola take-to-backlog). Id berurutan lewat nextSpecId + retry P2002 (TOCTOU), sama seperti POST
  // tunggal. Backlog hasil breakdown by-construction independen → jalan paralel (satu sesi/worktree).
  app.post("/specs/batch", async (req, reply) => {
    const parsed = zBatchCreateSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const project = await prisma.project.findUnique({ where: { id: b.project } });
    if (!project) return reply.code(404).send({ error: `project "${b.project}" tidak ada` });
    const repoDir = await resolveRepoDir(b.project);
    if (b.branchFrom && await branchUnknown(repoDir, b.branchFrom))
      return reply.code(400).send({ error: `branch "${b.branchFrom}" tidak ada di repo project` });
    const author = req.user?.email ?? "system";
    const created: Awaited<ReturnType<typeof prisma.spec.create>>[] = [];
    for (const item of b.items) {
      const context = b.prdPath ? `Dari PRD (breakdown): ${b.prdPath}\n\n${item.context}` : item.context;
      const payload = { context, outcome: item.outcome, constraints: "", priority: item.priority };
      const { priority, objective } = deriveSpecFields("brief", payload, item.priority);
      let spec: Awaited<ReturnType<typeof prisma.spec.create>> | null = null;
      for (let attempt = 0; attempt < 3 && !spec; attempt++) {
        const id = await nextSpecId(repoDir);
        try {
          spec = await prisma.spec.create({
            data: {
              id, projectId: b.project, title: item.title, source: "brief", stage: "brainstorming",
              priority, author, objective, payload, branchFrom: b.branchFrom ?? null,
            },
          });
        } catch (e) {
          if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
          throw e;
        }
      }
      if (spec) { await enqueueOutbox("spec", spec.id); created.push(spec); }
    }
    return reply.code(201).send({ created });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/specs-batch.route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/specs.ts server/test/specs-batch.route.test.ts
git commit -m "feat(spec-273): POST /specs/batch materialize breakdown → N spec

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Server — terminal breakdown session branch

**Files:**
- Modify: `server/src/routes/terminal.ts`
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `startBreakdownPrompt` (runner); `readPrd` (project-prds); `getSession`/`createSession`/`sessionModel`/`realGit`/`phaseFilePath`/`decisionFilePath` (sudah dipakai blok prd).
- Produces: `POST /api/terminal/sessions { project, flow: "breakdown", prdPath }` → sesi `breakdown-<slug>` (branch `breakdown/<slug>`); `400` PRD tak terbaca / slug kosong.

- [ ] **Step 1: Write the failing test** — tambah di `server/test/terminal.route.test.ts` (blok describe baru). Seed PRD di repoDir project. `repoDir`/`p1` sudah ada di setup file (lihat blok prd). Tambahkan:

```ts
describe("terminal routes · sesi breakdown (SPEC-273)", () => {
  const start = (project: string, prdPath?: unknown) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project, flow: "breakdown", ...(prdPath === undefined ? {} : { prdPath }) } });

  it("POST { flow: breakdown, prdPath } → worktree + sesi breakdown-<slug>", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    writeFileSync(join(repoDir, "docs", "prd", "jadwal-invoice.md"),
      "# Jadwal Invoice Berulang\n\nscope");
    const res = await start("p1", "docs/prd/jadwal-invoice.md");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("breakdown-jadwal-invoice");
    expect(existsSync(join(repoDir, ".worktrees", "breakdown-jadwal-invoice"))).toBe(true);
    const s = listSessions().find((x) => x.id === "breakdown-jadwal-invoice")!;
    expect(s.flow).toBe("breakdown");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/breakdown-jadwal-invoice" });
  });

  it("prdPath yang tak terbaca → 400", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    expect((await start("p1", "docs/prd/tidak-ada.md")).statusCode).toBe(400);
  });

  it("prompt sesi breakdown memuat isi PRD + path manifest", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    writeFileSync(join(repoDir, "docs", "prd", "jadwal-invoice.md"),
      "# Jadwal Invoice Berulang\n\nSCOPE-MARKER");
    const res = await start("p1", "docs/prd/jadwal-invoice.md");
    expect(res.statusCode).toBe(201);
    const c = connect("breakdown-jadwal-invoice");
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("docs/prd/jadwal-invoice.breakdown.md");
    expect(c.data()).toContain("SCOPE-MARKER");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/breakdown-jadwal-invoice" });
  });
});
```
> Catatan: pastikan `docs/prd/` ada di `repoDir` sebelum `writeFileSync`. Jika setup belum membuatnya, tambahkan di awal test: `mkdirSync(join(repoDir, "docs", "prd"), { recursive: true });`.

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/terminal.route.test.ts -t breakdown`
Expected: FAIL (flow breakdown belum ditangani → jatuh ke fallback / 201 tapi id salah).

- [ ] **Step 3: Edit `server/src/routes/terminal.ts`** — impor tambahan. Ubah baris import runner:
```ts
import { realGit, startPrompt, continuePrompt, startProjectPrompt, startPrdPrompt, startScaffoldPrompt, startBreakdownPrompt, type Flow } from "@hanoman/runner";
```
Tambah impor `readPrd`:
```ts
import { readPrd } from "../services/project-prds";
```
Tambahkan cabang breakdown **setelah** blok `if (parsed.data.flow === "prd") { ... }` dan sebelum `const s = createSession(project.id, repoDir);`:
```ts
    // SPEC-273 · sesi breakdown project-level: pecah SATU PRD → manifest N backlog paralel-independen.
    // Meniru prd (worktree isolasi dari HEAD, push branch breakdown/<slug>, manusia review→materialize).
    // Isi PRD disematkan ke prompt (freshest-wins), jadi breakdown lepas dari status merge PRD.
    if (parsed.data.flow === "breakdown") {
      const { prdPath } = parsed.data;
      const content = await readPrd(project.id, prdPath); // gate: hanya docs/prd/*.md, freshest-wins
      if (content === null) return reply.code(400).send({ error: "PRD tak terbaca" });
      const base = prdPath.slice(prdPath.lastIndexOf("/") + 1).replace(/\.md$/, "");
      const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      if (!slug) return reply.code(400).send({ error: "path PRD tak valid" });
      const id = `breakdown-${slug}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel(); // SPEC-252 · ADR-0061 · default global (per sesi)
      try {
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const titleM = content.match(/^#\s+(.+)$/m);
      const title = titleM ? titleM[1]!.trim() : slug;
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "breakdown", branch: `breakdown/${slug}`, model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startBreakdownPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          { title, path: prdPath, content }, `breakdown/${slug}`),
      });
      return reply.code(201).send({ id: s.id });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run test/terminal.route.test.ts`
Expected: PASS (termasuk 3 test breakdown).

- [ ] **Step 5: Typecheck server + commit**

Run: `pnpm --filter ./server typecheck`
```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts
git commit -m "feat(spec-273): terminal sesi breakdown (flow breakdown, prompt tersemat PRD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Frontend — api client methods

**Files:**
- Modify: `src/src/api/client.ts`
- Test: `src/test/api-client.test.ts` (atau `src/test/client.test.ts`)

**Interfaces:**
- Consumes: `paths.breakdown`, `paths.specsBatch`, `paths.terminalSessions`; tipe `BreakdownItem`/`BreakdownDoc` dari `@hanoman/shared`.
- Produces: `api.startBreakdown(project, prdPath)`; `api.getBreakdown(project, prdPath)`; `api.createSpecsBatch(body)`.

- [ ] **Step 1: Write the failing test** — tambah case di `src/test/api-client.test.ts` (ikuti pola mock fetch yang ada di file). Jika file memakai `vi.spyOn(global, "fetch")`, tambah:

```ts
it("getBreakdown memanggil endpoint breakdown ber-query prd (SPEC-273)", async () => {
  const spy = vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ items: [], live: false }), { status: 200 }));
  await api.getBreakdown("p1", "docs/prd/x.md");
  expect(spy).toHaveBeenCalledWith("/api/projects/p1/breakdown?prd=docs%2Fprd%2Fx.md", expect.anything());
  spy.mockRestore();
});
it("createSpecsBatch POST ke /api/specs/batch (SPEC-273)", async () => {
  const spy = vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ created: [] }), { status: 201 }));
  await api.createSpecsBatch({ project: "p1", items: [{ title: "A" }] });
  expect(spy).toHaveBeenCalledWith("/api/specs/batch",
    expect.objectContaining({ method: "POST" }));
  spy.mockRestore();
});
```
> Sesuaikan gaya assertion dengan test yang sudah ada di file (mis. bila memakai helper `expectFetch`). Impor `api` sudah ada di file.

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/api-client.test.ts -t SPEC-273`
Expected: FAIL (`api.getBreakdown`/`createSpecsBatch` undefined).

- [ ] **Step 3: Edit `src/src/api/client.ts`** — impor tipe (tambah `BreakdownDoc`, `BreakdownItem` ke daftar impor dari `@hanoman/shared` di baris 1), lalu tambah method setelah `startPrd` (baris ~195):
```ts
  // SPEC-273 · breakdown PRD → N backlog. startBreakdown buka sesi; getBreakdown baca manifest;
  // createSpecsBatch materialize usulan (review manusia) jadi N spec independen.
  startBreakdown: (project: string, prdPath: string) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "breakdown", prdPath }) }),
  getBreakdown: (project: string, prdPath: string) =>
    j<BreakdownDoc>(paths.breakdown(project, prdPath)),
  createSpecsBatch: (b: { project: string; items: BreakdownItem[]; branchFrom?: string; prdPath?: string }) =>
    j<{ created: Spec[] }>(paths.specsBatch, { method: "POST", ...body(b) }),
```
> Jika `BreakdownDoc`/`BreakdownItem` belum ada di daftar impor `@hanoman/shared` di baris 1, tambahkan `type BreakdownDoc, type BreakdownItem`.

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/api-client.test.ts -t SPEC-273`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter ./src typecheck`
```bash
git add src/src/api/client.ts src/test/api-client.test.ts
git commit -m "feat(spec-273): api client startBreakdown/getBreakdown/createSpecsBatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Frontend — PrdScreen breakdown UI + App wiring

**Files:**
- Modify: `src/src/screens/PrdScreen.tsx`
- Modify: `src/src/App.tsx`
- Test: (typecheck + build; verifikasi manual di browser)

**Interfaces:**
- Consumes: `api.startBreakdown`, `api.getBreakdown`, `api.createSpecsBatch`; `BreakdownItem`.
- Produces: tombol "Breakdown ke backlog" + panel review usulan + "Buat N backlog"; handler `App.startBreakdown`, `App.materializeBreakdown`.

- [ ] **Step 1: Edit `src/src/screens/PrdScreen.tsx`** — perluas `PrdPreviewPane` menjadi memuat manifest & menampilkan panel review. Ganti komponen `PrdPreviewPane` (baris 57–87) dengan versi yang menerima dua callback baru dari props screen. Tambah impor `BreakdownItem` dari `../api/client` (re-export) atau `@hanoman/shared`.

Ubah signature `PrdScreen` props (baris 121–126) menjadi juga menerima:
```ts
    onStartBreakdown: (project: string, prdPath: string) => void;
    onMaterialize: (project: string, prdPath: string, items: BreakdownItem[], branchFrom: string | null) => Promise<number>;
```
Ganti `PrdPreviewPane` dengan:
```tsx
function PrdPreviewPane({ prd, projectId, project, onTake, onStartBreakdown, onMaterialize }:
  { prd: PrdDoc; projectId: string; project: ProjectVM | undefined;
    onTake: (p: PrdPrefill) => void;
    onStartBreakdown: (project: string, prdPath: string) => void;
    onMaterialize: (project: string, prdPath: string, items: BreakdownItem[], branchFrom: string | null) => Promise<number>; }) {
  const [content, setContent] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<BreakdownItem[]>([]);
  const [include, setInclude] = React.useState<boolean[]>([]);
  const [branchFrom, setBranchFrom] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setContent(null);
    api.getPrd(projectId, prd.path).then((r) => { if (alive) setContent(r.content); }).catch(() => { if (alive) setContent(""); });
    return () => { alive = false; };
  }, [projectId, prd.path]);

  const loadBreakdown = React.useCallback(() => {
    api.getBreakdown(projectId, prd.path)
      .then((r) => { setItems(r.items); setInclude(r.items.map(() => true)); })
      .catch(() => { setItems([]); setInclude([]); });
  }, [projectId, prd.path]);
  React.useEffect(() => { loadBreakdown(); }, [loadBreakdown]);

  const branchOpts = ["", ...(project?.branches ?? [])];
  const chosen = items.filter((_, i) => include[i]);
  const materialize = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try { await onMaterialize(projectId, prd.path, chosen, branchFrom || null); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div className="hn-eyebrow" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", marginBottom: 4 }}>{prd.path}</div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 18, fontWeight: 700, color: "var(--text-strong)" }}>{prd.title}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Button size="sm" variant="ghost" leftIcon="list-checks"
            onClick={() => onTake({ project: projectId, title: prd.title, context: `Dari PRD: ${prd.path}`, outcome: "", prdPath: prd.path, branchFrom: prdBranchOf(prd.path) })}>
            Take (1)
          </Button>
          <Button size="sm" leftIcon="split"
            onClick={() => onStartBreakdown(projectId, prd.path)}>
            Breakdown ke backlog
          </Button>
        </div>
      </div>

      {items.length > 0 && (
        <div style={{ border: "1px solid var(--brass-200)", borderRadius: "var(--radius-sm)", background: "var(--brass-50)", padding: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, color: "var(--brass-700)" }}>
              Usulan backlog ({chosen.length}/{items.length})
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Select size="sm" aria-label="Branch dasar" value={branchFrom}
                onChange={(e) => setBranchFrom(e.target.value)}
                options={branchOpts.map((b) => ({ value: b, label: b || "default project" }))} />
              <Button size="sm" leftIcon="plus" disabled={!chosen.length || busy} onClick={materialize}>
                {busy ? "Membuat…" : `Buat ${chosen.length} backlog`}
              </Button>
            </div>
          </div>
          {items.map((it, i) => (
            <label key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: i ? "1px solid var(--border-hair)" : "none", cursor: "pointer" }}>
              <input type="checkbox" checked={include[i] ?? false}
                onChange={(e) => setInclude((s) => s.map((v, j) => (j === i ? e.target.checked : v)))} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>{it.title} <Badge tone="brass" size="sm">{it.priority}</Badge></div>
                {it.outcome && <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>{it.outcome}</div>}
              </div>
            </label>
          ))}
        </div>
      )}

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        {content === null ? <StateBlock kind="loading" title="Memuat PRD…" />
          : <MarkdownView text={content} name={prd.name} />}
      </div>
    </div>
  );
}
```
> `it.priority` badge dan `project?.branches` — jika `ProjectVM` tak punya `branches`, pakai `branchOpts = [""]` saja (dropdown hanya "default project"); branch picker tetap opsional. Impor `BreakdownItem`: tambah `import type { BreakdownItem } from "@hanoman/shared";` di atas.

Teruskan props baru di pemakaian `PrdPreviewPane` (baris ~184):
```tsx
            <PrdPreviewPane prd={sel} projectId={selProject} project={projects.find((p) => p.id === selProject)}
              onTake={(pf) => onTakeToBacklog(pf)}
              onStartBreakdown={onStartBreakdown} onMaterialize={onMaterialize} />
```
Dan tambahkan `onStartBreakdown`/`onMaterialize` ke destructuring props `PrdScreen` + tipe-nya.

- [ ] **Step 2: Edit `src/src/App.tsx`** — tambah handler dan teruskan ke `PrdScreen`. Setelah `takeToBacklog` (baris ~668) tambah:
```tsx
  // SPEC-273 · mulai sesi breakdown PRD (menulis manifest usulan backlog).
  async function startBreakdown(project: string, prdPath: string) {
    try {
      const { id } = await api.startBreakdown(project, prdPath);
      setSection("terminal");
      showToast(`Breakdown · sesi ${id} dimulai`, "info", "split");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast("gagal mulai breakdown" + (noRepo ? " · project belum punya repoDir/PRD" : ""), "warn", "x-circle");
    }
  }
  // SPEC-273 · materialize usulan breakdown → N spec independen; balik jumlah dibuat.
  async function materializeBreakdown(project: string, prdPath: string, items: BreakdownItem[], branchFrom: string | null): Promise<number> {
    try {
      const { created } = await api.createSpecsBatch({ project, items, prdPath, branchFrom: branchFrom ?? undefined });
      setBacklog((b) => [...created, ...b]);
      setSection("backlog");
      showToast(`${created.length} backlog dibuat dari breakdown`, "ok", "list-checks");
      return created.length;
    } catch {
      showToast("Gagal membuat backlog dari breakdown", "err", "x-circle");
      return 0;
    }
  }
```
Impor `BreakdownItem`: tambah ke impor `@hanoman/shared` di App.tsx (`import type { BreakdownItem } from "@hanoman/shared";` bila belum). Teruskan ke `PrdScreen` (baris ~840):
```tsx
              onNewPrd={startPrd} onTakeToBacklog={takeToBacklog}
              onStartBreakdown={startBreakdown} onMaterialize={materializeBreakdown}
              dataVersion={dataVersion} />)}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter ./src typecheck && pnpm --filter ./src build`
Expected: exit 0 (tak ada error TS).
> Jika `ProjectVM` tak punya `branches`, sederhanakan `branchOpts` seperti catatan di Step 1.

- [ ] **Step 4: Commit**

```bash
git add src/src/screens/PrdScreen.tsx src/src/App.tsx
git commit -m "feat(spec-273): PrdScreen breakdown UI (start sesi + review + materialize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Docs — ADR-0069 + api-contract + data-model + prd entrypoint + index

**Files:**
- Create: `internal/docs/adr/0069-breakdown-prd-ke-backlog-paralel.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/entrypoints/prd.md`

- [ ] **Step 1: Create `internal/docs/adr/0069-breakdown-prd-ke-backlog-paralel.md`:**

```markdown
# ADR-0069 — Breakdown PRD → backlog paralel-independen (sesi breakdown + manifest + materialize)

Status: accepted (SPEC-273)
Memperluas: ADR-0041 (PRD sebagai dokumen). Terkait: ADR-0015 (satu backlog satu sesi), ADR-0002 (isolasi worktree), ADR-0032 (branch properti backlog), ADR-0059 (kontinuitas branch take-to-backlog).

## Konteks
"Take ke backlog" membuat TEPAT SATU spec dari sebuah PRD. Untuk PRD kompleks, satu backlog tak cukup — sebagian scope PRD tak pernah dikerjakan. Paralelisme eksekusi sudah ada (satu backlog = satu sesi di worktree terisolasi); yang kurang adalah DEKOMPOSISI 1 PRD → N spec independen. Dekomposisi butuh kecerdasan, dan di hanoman semua kerja cerdas berjalan sebagai sesi claude interaktif (tak ada jalur headless — ADR-0010/0024).

## Keputusan
Tambah flow sesi `breakdown` (pipeline `Analisis → Breakdown`), project-level seperti `prd`. Sesi membaca PRD (isinya disematkan ke prompt, lepas dari status merge) dan menulis manifest `docs/prd/<slug>.breakdown.md`: prosa human-readable + TEPAT SATU blok ```json kanonik `{ "items": [ { title, context, outcome, priority } ] }`. Server mem-parse manifest freshest-wins (`project-breakdowns.ts`) dan mengeksposnya di `GET /projects/:id/breakdown?prd=<path>`. Manusia me-review/menyeleksi usulan lalu `POST /specs/batch` membuat N spec (`source:"brief"`), dengan provenance PRD di teks Konteks.

Parallel-safety dijamin by-construction: prompt mewajibkan cakupan non-overlapping + tanpa cross-dependency; semua N spec di-branch dari basis yang sama sehingga jalan paralel di worktree terpisah.

## Konsekuensi
- TANPA perubahan skema: breakdown = dokumen + baris `Spec` biasa. Additive, aman untuk VPS live.
- Manusia terakhir memutuskan (aturan produk): usulan tak auto-jadi backlog.
- "Take ke backlog" single tetap ada untuk PRD sederhana.
- Batas: parallel-safety bergantung kualitas dekomposisi agen; manusia me-review sebagai gerbang.
```

- [ ] **Step 2: Edit `internal/docs/README.md`** — tambah baris di bagian `## adr` (paling atas daftar):
```markdown
- [0069 — Breakdown PRD → backlog paralel-independen (sesi breakdown + manifest + materialize)](adr/0069-breakdown-prd-ke-backlog-paralel.md) — **memperluas 0041**, terkait 0015/0002/0032/0059 (SPEC-273): flow `breakdown` menulis `docs/prd/<slug>.breakdown.md` (prosa + blok json kanonik); `GET /projects/:id/breakdown` + `POST /specs/batch` materialize N spec independen; tanpa perubahan skema
```

- [ ] **Step 3: Edit `internal/docs/architecture/api-contract.md`** — tambah 3 endpoint (di bagian specs & terminal & docs sesuai struktur file; cari heading yang relevan). Sisipkan:
```markdown
### Breakdown PRD → backlog (SPEC-273 · ADR-0069)
- `POST /api/terminal/sessions` — body `{ project, flow: "breakdown", prdPath }` memulai sesi breakdown (worktree `.worktrees/breakdown-<slug>`, branch `breakdown/<slug>`); menulis manifest `docs/prd/<slug>.breakdown.md`.
- `GET /api/projects/:id/breakdown?prd=<path>` → `{ items: BreakdownItem[], live }` — parse blok json manifest (freshest-wins). Manifest belum ada / prd non-PRD → `{ items: [] }`.
- `POST /api/specs/batch` — body `{ project, items: BreakdownItem[], branchFrom?, prdPath? }` → `201 { created: Spec[] }`. Membuat N spec `source:"brief"` independen; provenance PRD di teks Konteks. `400` items kosong / branch tak dikenal; `404` project tak ada.

`BreakdownItem = { title: string; context: string; outcome: string; priority: "tinggi"|"sedang"|"rendah" }`.
```

- [ ] **Step 4: Edit `internal/docs/architecture/data-model.md`** — tambah catatan (di bagian PRD/dokumen atau catatan turunan):
```markdown
- **Breakdown PRD (SPEC-273 · ADR-0069)** — bukan model DB. Manifest = dokumen `docs/prd/<slug>.breakdown.md` (sibling PRD), backlog hasil = baris `Spec` biasa (`source:"brief"`). Provenance PRD dicantumkan di teks Konteks payload, bukan kolom. Tanpa migration.
```

- [ ] **Step 5: Edit `internal/docs/entrypoints/prd.md`** — tambah satu kalimat di hilir alur PRD:
```markdown

## Breakdown (SPEC-273 · ADR-0069)
PRD kompleks tak dipaksa jadi satu backlog. Dari layar PRD, "Breakdown ke backlog" memulai sesi `breakdown` yang menulis manifest usulan backlog paralel-independen (`docs/prd/<slug>.breakdown.md`); manusia me-review lalu materialize jadi N spec yang bisa dijalankan bersamaan.
```

- [ ] **Step 6: Verify docs index integrity + commit**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./cli exec vitest run 2>/dev/null || true` (opsional) lalu cek link manual.
```bash
git add internal/docs/adr/0069-breakdown-prd-ke-backlog-paralel.md internal/docs/README.md internal/docs/architecture/api-contract.md internal/docs/architecture/data-model.md internal/docs/entrypoints/prd.md
git commit -m "docs(spec-273): ADR-0069 breakdown PRD + api-contract/data-model/prd entrypoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Verifikasi menyeluruh + live curl

**Files:** (tidak ada perubahan kode — gerbang verifikasi)

- [ ] **Step 1: Full test suite hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm test`
Expected: semua paket PASS. Bila `hanoman_test` belum di-migrate untuk model baru — tak ada model baru di SPEC-273, jadi tak perlu migrate; kegagalan P2022 berarti drift lain, bukan fitur ini.

- [ ] **Step 2: Typecheck semua paket**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3: Live curl lokal (WAJIB per CLAUDE.md)** — boot server terhadap DB throwaway ter-migrate (bukan `hanoman_test`, hindari sibling truncation — lihat memori). Seed satu project + manifest fixture, lalu:
  1. `GET /api/projects/<id>/breakdown?prd=docs/prd/<slug>.md` → `{ items: [...], live:false }`.
  2. `POST /api/specs/batch { project, items, prdPath }` → `201 { created: [...] }`; verifikasi jumlah spec bertambah lewat `GET /api/specs?project=<id>`.
  3. (Opsional, TIDAK memicu claude nyata) — lewati `POST /terminal/sessions flow=breakdown` di curl agar tak spawn sesi claude; cakupannya sudah oleh test route dengan FAKE_CLAUDE.

Contoh (sesuaikan auth bila `requireAuth`):
```bash
# asumsikan server dev di :8787 dengan project p1 ber-repoDir yang memuat docs/prd/x.breakdown.md
curl -s "http://127.0.0.1:8787/api/projects/p1/breakdown?prd=docs/prd/x.md" | jq
curl -s -XPOST "http://127.0.0.1:8787/api/specs/batch" -H 'content-type: application/json' \
  -d '{"project":"p1","prdPath":"docs/prd/x.md","items":[{"title":"A","context":"a","outcome":"oa","priority":"tinggi"},{"title":"B","context":"b","outcome":"ob"}]}' | jq '.created | length'
curl -s "http://127.0.0.1:8787/api/specs?project=p1" | jq '.items | length'
```
Expected: langkah 1 mengembalikan items; langkah 2 mengembalikan `2`; langkah 3 bertambah 2.

- [ ] **Step 4: Centang semua kotak plan** — pastikan tiap `- [ ]` di plan ini jadi `- [x]`. hanoman menahan backlog di `executing` selama masih ada `- [ ]`.

- [ ] **Step 5: Final commit (bila ada sisa) + siap push**

```bash
git status   # diff bersih
```

---

## Self-Review

**Spec coverage:**
- Sesi breakdown + manifest → Task 2 (prompt) + Task 6 (terminal). ✅
- Parse + expose → Task 3 (service) + Task 4 (route). ✅
- Materialize batch human-reviewed → Task 5 (route) + Task 8 (UI). ✅
- Parallel-safety by-construction → prompt (Task 2) + spec independen batch (Task 5). ✅
- Tanpa perubahan skema → Task 5 memakai `Spec` biasa, provenance di Konteks. ✅
- Perubahan shared/paths → Task 1. ✅
- Docs (ADR-0069 + api-contract + data-model + prd + index) → Task 9. ✅
- Verifikasi nyata (test + curl) → Task 10. ✅

**Placeholder scan:** tak ada TBD/TODO; tiap step memuat kode nyata / perintah + expected. ✅

**Type consistency:** `BreakdownItem {title,context,outcome,priority}` konsisten shared↔runner-tak-perlu↔server↔client; `readBreakdown` balik `{items,live}` = `zBreakdownDoc`; `POST /specs/batch` balik `{created:Spec[]}` = `api.createSpecsBatch`; `flow:"breakdown"` konsisten `zFlow`/runner `Flow`/union terminal. ✅
