# Create PRD (SPEC-210) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) atau superpowers:subagent-driven-development. Steps pakai checkbox (`- [ ]`).

**Goal:** hanoman bisa membuat dokumen PRD dari brief + brainstorm (flow sesi baru `prd`), mem-preview-nya, dan men-take-nya jadi backlog item.

**Architecture:** PRD adalah dokumen `docs/prd/<slug>.md` di repo project (bukan entitas DB — konsisten ADR-0011). Dibuat oleh flow sesi project-level `prd` yang meniru `reverse` (worktree isolasi, brainstorm interaktif, push ke branch, manusia merge). Di-list/preview freshest-wins (worktree sesi hidup > repoDir) meniru `spec-docs.ts`. Di-take ke backlog lewat `POST /specs` yang sudah ada, via `NewSpecModal` ter-prefill.

**Tech Stack:** TypeScript strict, Fastify, Prisma/Postgres, Zod (`@hanoman/shared`), React (Vite), Vitest.

## Global Constraints

- **Bahasa:** komentar & prosa docs bahasa Indonesia (ikuti file sekitar). Kode/identifier apa adanya.
- **Jangan ubah skema Prisma** — PRD bukan tabel. Tak ada migration.
- **Sesi selalu di worktree**, tak pernah di working tree utama (CLAUDE.md).
- **TDD**: tulis test gagal dulu, implement minimal, hijaukan, commit.
- **Docs SoT** yang tersentuh diperbarui **dalam Task 6** (satu commit docs) — plus link di `internal/docs/README.md`.
- **Test repo**: `env -u NODE_ENV -u DATABASE_URL pnpm --filter <pkg> test` (shell menunjuk prod). Server test: `--no-file-parallelism`.
- Freshest-wins service menerima param `sessions = listSessions()` agar test bisa inject sesi palsu (pola `spec-docs.ts`).

---

### Task 1: Kontrak shared — flow `prd`, brief, terminal session, paths

**Files:**
- Modify: `shared/src/dto.ts` (zFlow, zPrdBrief, zTerminalSession)
- Modify: `shared/src/api.ts` (paths.prds, prdFile)
- Test: `shared/test/dto.test.ts` (buat bila belum ada) atau verifikasi lewat Task 4/5.

**Interfaces:**
- Produces: `zFlow` enum kini memuat `"prd"`. `zPrdBrief = { title: string; context: string; outcome: string; constraints?: string }`. `zTerminalSession` union member baru `{ project: string; flow: "prd"; brief: PrdBrief }`. `paths.prds(id)` → `/api/projects/:id/prds`, `paths.prdFile(id, path)` → `/api/projects/:id/prds/<path>`.

- [ ] **Step 1: Tulis test parse (gagal)**

Buat `shared/test/dto.test.ts` (jika belum ada; kalau ada, tambahkan blok):

```ts
import { describe, it, expect } from "vitest";
import { zTerminalSession, zFlow } from "../src/dto";

describe("zTerminalSession — varian prd", () => {
  it("menerima sesi prd project-level dengan brief", () => {
    const r = zTerminalSession.safeParse({
      project: "p1", flow: "prd",
      brief: { title: "Jadwal invoice", context: "c", outcome: "o" },
    });
    expect(r.success).toBe(true);
  });
  it("menolak prd tanpa brief", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "prd" }).success).toBe(false);
  });
  it("zFlow memuat prd", () => expect(zFlow.safeParse("prd").success).toBe(true));
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared test`
Expected: FAIL (prd belum di enum / brief belum ada).

- [ ] **Step 3: Ubah `shared/src/dto.ts`**

Ganti baris `export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse"]);` jadi:

```ts
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd"]);

// SPEC-210 · brief awal PRD (project-level, tanpa Spec). Dipakai prompt sesi prd.
export const zPrdBrief = z.object({
  title: z.string().min(1),
  context: z.string(),
  outcome: z.string(),
  constraints: z.string().optional(),
});
export type PrdBrief = z.infer<typeof zPrdBrief>;
```

Lalu tambahkan member ke union `zTerminalSession` (letakkan sebelum member `spec`):

```ts
export const zTerminalSession = z.union([
  z.object({ project: z.string(), flow: z.literal("reverse").optional() }),
  // SPEC-210 · sesi prd project-level di worktree sendiri; menghasilkan dokumen PRD.
  z.object({ project: z.string(), flow: z.literal("prd"), brief: zPrdBrief }),
  z.object({ spec: z.string(), flow: zFlow }),
]);
```

- [ ] **Step 4: Ubah `shared/src/api.ts`**

Setelah baris `docFile: (id, path) => ...` tambahkan:

```ts
  // SPEC-210 · dokumen PRD project (freshest-wins: worktree sesi prd hidup > repoDir)
  prds: (id: string) => `${API}/projects/${id}/prds`,
  prdFile: (id: string, path: string) => `${API}/projects/${id}/prds/${path}`,
```

- [ ] **Step 5: Jalankan test, pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts shared/test/dto.test.ts
git commit -m "feat(shared): flow prd + zPrdBrief + terminal session varian + paths (SPEC-210)"
```

---

### Task 2: Runner — flow `prd`, pipeline, `startPrdPrompt`

**Files:**
- Modify: `runner/src/types.ts` (Flow += "prd"; PrdBrief)
- Modify: `runner/src/prompt.ts` (PIPELINES.prd; startPrdPrompt)
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `ProjectBrief` (ada), `PIPELINES`, `phaseInstruction`, `skillInstruction` (ada di prompt.ts).
- Produces: `type PrdBrief = { title: string; context: string; outcome: string; constraints?: string }`. `startPrdPrompt(project: ProjectBrief, brief: PrdBrief, branchTo: string): string`. `PIPELINES.prd = ["Brainstorm", "PRD"]`.

- [ ] **Step 1: Tulis test (gagal)**

Tambah ke `runner/test/prompt.test.ts`:

```ts
import { startPrdPrompt } from "../src/prompt";

describe("startPrdPrompt", () => {
  const project = { id: "acme", name: "Acme", desc: "d", stack: "ts" };
  const brief = { title: "Jadwal Invoice Berulang", context: "PM butuh penjadwalan", outcome: "invoice terjadwal" };
  it("memuat fase Brainstorm lalu PRD, berurutan", () => {
    const p = startPrdPrompt(project, brief, "prd/jadwal-invoice-berulang");
    for (const ph of PIPELINES.prd) expect(p).toContain(ph);
    expect(p.indexOf("Brainstorm")).toBeLessThan(p.indexOf("PRD"));
  });
  it("menyuruh tulis dokumen ke docs/prd/<slug>.md", () => {
    const p = startPrdPrompt(project, brief, "prd/jadwal-invoice-berulang");
    expect(p).toContain("docs/prd/jadwal-invoice-berulang.md");
  });
  it("menyisipkan brief + identitas project", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("Jadwal Invoice Berulang");
    expect(p).toContain("PM butuh penjadwalan");
    expect(p).toContain("acme");
  });
  it("invoke skill brainstorming + push ke branchTo", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("superpowers:brainstorming");
    expect(p).toContain("prd/x");
    expect(p).toContain("git push");
  });
  it("tak menyuruh menulis kode fitur", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("HANYA dokumen PRD");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner test`
Expected: FAIL (`startPrdPrompt` tak ada).

- [ ] **Step 3: `runner/src/types.ts` — tambah flow + tipe**

Ganti baris `Flow`:

```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd";
```

Tambah setelah `ProjectBrief`:

```ts
// SPEC-210 · brief awal PRD (sesi prd project-level). Disisipkan ke prompt.
export type PrdBrief = { title: string; context: string; outcome: string; constraints?: string };
```

- [ ] **Step 4: `runner/src/prompt.ts` — pipeline + prompt**

Tambah entri ke `PIPELINES` (dalam objek `PIPELINES`):

```ts
  prd: ["Brainstorm", "PRD"],
```

Import tipe di atas: ubah baris import jadi
`import type { Flow, SpecBrief, ProjectBrief, PrdBrief } from "./types";`

Tambah fungsi (setelah `startProjectPrompt`):

```ts
// SPEC-210 · sesi prd: PM/PO menyusun SATU dokumen PRD dari brief + brainstorm interaktif.
// Project-level (tanpa Spec), meniru startProjectPrompt. Keluaran HANYA dokumen — tak menulis
// kode fitur. Brainstorm interaktif (satu pertanyaan per giliran; PM menonton terminal),
// lalu tulis PRD terstruktur, commit, push ke branch prd/<slug>; manusia yang merge.
export function startPrdPrompt(project: ProjectBrief, brief: PrdBrief, branchTo: string): string {
  const slug = branchTo.slice(branchTo.lastIndexOf("/") + 1);
  return [
    `hanoman prd. Kamu memandu PM/PO menyusun SATU dokumen PRD untuk project ini dari brief + `
      + `brainstorm. Keluaranmu HANYA dokumen PRD — JANGAN menulis kode fitur.`,
    phaseInstruction(PIPELINES.prd),
    `- Brainstorm: pandu PM secara interaktif. Ajukan SATU pertanyaan per giliran ke manusia di `
      + `terminal ini, tunggu jawabannya, perdalam brief sampai jelas (masalah, pengguna, scope, `
      + `metrik sukses). Jangan mengarang; topik yang PM belum jawab tandai sebagai open question.`,
    `- PRD: tulis dokumen ke \`docs/prd/${slug}.md\`. Awali dengan heading \`# <judul PRD>\`, lalu `
      + `bagian: Ringkasan · Masalah & konteks · Persona/pengguna · Goals & non-goals · Scope `
      + `(in/out) · User stories · Acceptance criteria (gaya EARS) · Metrik sukses · Open questions. `
      + `Isi lengkap dan spesifik dari hasil brainstorm, bukan kerangka kosong.`,
    skillInstruction(PIPELINES.prd),
    `Setelah PRD ditulis: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Bila remote `
      + `origin tak ada, lewati push dan catat di terminal — jangan gagal diam-diam. Worktree ini `
      + `detached HEAD — memang disengaja. Manusia yang me-review lalu merge branch ${branchTo}.`,
    `Project ${project.id} · ${project.name}\nBrief — Judul: ${brief.title}\nKonteks: ${brief.context}\n`
      + `Outcome: ${brief.outcome}${brief.constraints ? `\nBatasan: ${brief.constraints}` : ""}`,
  ].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 5: Jalankan test, pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner test`
Expected: PASS (semua test prompt, termasuk yang lama).

- [ ] **Step 6: Commit**

```bash
git add runner/src/types.ts runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(runner): flow prd + startPrdPrompt (SPEC-210)"
```

---

### Task 3: Server — service `project-prds.ts` (list + read freshest-wins) + route

**Files:**
- Create: `server/src/services/project-prds.ts`
- Modify: `server/src/routes/docs.ts` (tambah 2 endpoint GET prds)
- Test: `server/test/project-prds.test.ts`

**Interfaces:**
- Consumes: `listRepoDocs`, `readDocFile` dari `services/scan`; `listSessions` dari `services/pty`; `prisma`.
- Produces: `type PrdDoc = { slug: string; name: string; path: string; title: string; live: boolean }`. `listPrds(projectId, sessions?): Promise<PrdDoc[]>`. `readPrd(projectId, path, sessions?): Promise<string | null>`. Endpoint `GET /projects/:id/prds` → `{ items: PrdDoc[] }`, `GET /projects/:id/prds/*` → `{ path, content }` | 404.

- [ ] **Step 1: Tulis test (gagal)**

Buat `server/test/project-prds.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makeProject, makeTempRepo } from "./factory";
import { listPrds, readPrd } from "../src/services/project-prds";

let dir: string;
beforeEach(async () => {
  await resetDb();
  dir = makeTempRepo({
    "docs/prd/jadwal-invoice.md": "# Jadwal Invoice\n\nRingkasan…",
    "docs/prd/notifikasi.md": "# Notifikasi Realtime",
    "internal/docs/README.md": "# idx",
  });
  await makeProject({ id: "p1", repoDir: dir });
});

describe("project-prds (repoDir)", () => {
  it("mendaftar semua docs/prd/*.md dengan judul dari heading", async () => {
    const items = await listPrds("p1", []);
    const slugs = items.map((i) => i.slug).sort();
    expect(slugs).toEqual(["jadwal-invoice", "notifikasi"]);
    const inv = items.find((i) => i.slug === "jadwal-invoice")!;
    expect(inv.title).toBe("Jadwal Invoice");
    expect(inv.path).toBe("docs/prd/jadwal-invoice.md");
    expect(inv.live).toBe(false);
  });
  it("membaca isi PRD", async () =>
    expect(await readPrd("p1", "docs/prd/jadwal-invoice.md", [])).toContain("Ringkasan"));
  it("null untuk path di luar docs/prd/", async () =>
    expect(await readPrd("p1", "internal/docs/README.md", [])).toBeNull());
});

describe("project-prds (freshest-wins worktree sesi hidup)", () => {
  it("worktree sesi prd hidup menang atas repoDir", async () => {
    const wt = makeTempRepo({ "docs/prd/draft.md": "# Draft Hidup" });
    const fakeSessions = [{ id: "prd-draft", projectId: "p1", flow: "prd", cwd: wt, exited: false } as any];
    const items = await listPrds("p1", fakeSessions);
    expect(items.find((i) => i.slug === "draft")?.live).toBe(true);
    expect(await readPrd("p1", "docs/prd/draft.md", fakeSessions)).toContain("Draft Hidup");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run project-prds --no-file-parallelism`
Expected: FAIL (module belum ada).

- [ ] **Step 3: Buat `server/src/services/project-prds.ts`**

```ts
import { prisma } from "../db";
import { listRepoDocs, readDocFile } from "./scan";
import { listSessions } from "./pty";

// SPEC-210 · PRD adalah dokumen docs/prd/<slug>.md (bukan entitas DB, ADR-0011). List/baca
// freshest-wins: worktree sesi prd hidup untuk project ini > repoDir (pola spec-docs.ts).
export type PrdDoc = { slug: string; name: string; path: string; title: string; live: boolean };

const PRD_DIR = "docs/prd/";
const isPrd = (rel: string) => rel.startsWith(PRD_DIR) && rel.endsWith(".md");
const slugOf = (rel: string) => rel.slice(PRD_DIR.length, -3);
// Judul = heading `# ...` pertama; fallback slug.
const titleOf = (content: string | null, slug: string) => {
  const m = content?.match(/^#\s+(.+)$/m);
  return m ? m[1]!.trim() : slug;
};

// cwd sesi prd HIDUP untuk project ini (worktree, memuat draft belum di-merge) > repoDir.
// ponytail: PRD yang sesinya sudah ditutup TAPI branch belum di-merge tak muncul (hanya di
// origin/branch). Upgrade path bila perlu: list juga branch prd/*. Alur nyata (create→preview→
// take dalam satu sesi hidup, lalu merge) menutupinya.
async function resolveDir(
  projectId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ dir: string | null; live: boolean }> {
  const live = sessions.find((s) => s.projectId === projectId && s.flow === "prd" && !s.exited && s.cwd);
  if (live) return { dir: live.cwd, live: true };
  const project = await prisma.project.findUnique({
    where: { id: projectId }, select: { repoDir: true },
  });
  return { dir: project?.repoDir ?? null, live: false };
}

export async function listPrds(
  projectId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<PrdDoc[]> {
  const { dir, live } = await resolveDir(projectId, sessions);
  if (!dir) return [];
  return (await listRepoDocs(dir))
    .filter(isPrd)
    .map((rel) => {
      const slug = slugOf(rel);
      return { slug, name: rel.slice(rel.lastIndexOf("/") + 1), path: rel,
        title: titleOf(readDocFile(dir, rel), slug), live };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function readPrd(
  projectId: string, path: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<string | null> {
  if (!isPrd(path)) return null; // gerbang: hanya docs/prd/*.md
  const { dir } = await resolveDir(projectId, sessions);
  return dir ? readDocFile(dir, path) : null; // readDocFile menolak non-.md / path keluar repo
}
```

- [ ] **Step 4: Tambah endpoint ke `server/src/routes/docs.ts`**

Ganti import teratas + tambah 2 route sebelum `}` penutup fungsi:

```ts
import { listPrds, readPrd } from "../services/project-prds";
```

```ts
  // SPEC-210 · daftar & preview dokumen PRD (freshest-wins worktree sesi prd > repoDir).
  app.get("/projects/:id/prds", async (req) =>
    ({ items: await listPrds((req.params as { id: string }).id) }));

  app.get("/projects/:id/prds/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const content = await readPrd(id, path);
    return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
  });
```

- [ ] **Step 5: Jalankan test (service + route), pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run project-prds --no-file-parallelism`
Expected: PASS.

- [ ] **Step 6: Tambah test route ke `server/test/docs.route.test.ts`**

Tambahkan blok (repo `beforeEach` sudah ada `dir`; PRD file perlu ditambahkan — tulis langsung ke dir):

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

describe("prds routes (SPEC-210)", () => {
  it("list + baca PRD dari repoDir", async () => {
    mkdirSync(join(dir, "docs/prd"), { recursive: true });
    writeFileSync(join(dir, "docs/prd/x.md"), "# PRD X\n");
    const list = await app.inject({ url: "/api/projects/p1/prds" });
    expect(list.json().items.map((i: any) => i.slug)).toContain("x");
    const read = await app.inject({ url: "/api/projects/p1/prds/docs/prd/x.md" });
    expect(read.statusCode).toBe(200);
    expect(read.json().content).toContain("PRD X");
  });
  it("404 untuk path bukan docs/prd", async () => {
    expect((await app.inject({ url: "/api/projects/p1/prds/internal/docs/README.md" })).statusCode).toBe(404);
  });
});
```

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run docs.route --no-file-parallelism`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/project-prds.ts server/src/routes/docs.ts server/test/project-prds.test.ts server/test/docs.route.test.ts
git commit -m "feat(server): endpoint daftar & preview PRD freshest-wins (SPEC-210)"
```

---

### Task 4: Server — cabang sesi `flow === "prd"` di terminal.ts

**Files:**
- Modify: `server/src/routes/terminal.ts` (import `startPrdPrompt`; cabang prd)
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `startPrdPrompt` (Task 2), `zTerminalSession` varian prd (Task 1), `realGit.addWorktree`, `createSession`, `getSession`, `phaseFilePath`, `decisionFilePath`, `sessionModel`.
- Produces: `POST /terminal/sessions {project, flow:"prd", brief}` → 201 `{ id }` (id `prd-<slug>`), 404 project, 422 worktree gagal, 400 slug kosong.

- [ ] **Step 1: Tulis test (gagal)**

Tambah ke `server/test/terminal.route.test.ts` (repo `repoDir` sudah git-init + fake-claude di beforeAll; ikuti pola test reverse yang ada):

```ts
it("POST prd → sesi lahir di worktree .worktrees/prd-<slug>", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/terminal/sessions",
    payload: { project: "p1", flow: "prd", brief: { title: "Jadwal Invoice", context: "c", outcome: "o" } },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  expect(id).toBe("prd-jadwal-invoice");
  await waitFor(() => listSessions().some((s) => s.id === id));
  const s = listSessions().find((x) => x.id === id)!;
  expect(s.flow).toBe("prd");
  expect(s.cwd).toContain(".worktrees/prd-jadwal-invoice");
  await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
});

it("POST prd tanpa brief → 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "p1", flow: "prd" } });
  expect(res.statusCode).toBe(400);
});
```

> Catatan: `beforeAll` file ini meng-`killAll()` lalu bikin repoDir baru + `makeProject({id:"p1"})`. Pastikan project `p1` sudah repoDir git valid (ikuti setup yang ada). Fake-claude membuat sesi hidup tanpa `claude` asli.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run terminal.route --no-file-parallelism`
Expected: FAIL (cabang prd belum ada → jatuh ke fallback terminal biasa, id bukan `prd-...`).

- [ ] **Step 3: Ubah `server/src/routes/terminal.ts`**

Tambah import: ubah baris runner import jadi
`import { realGit, startPrompt, continuePrompt, startProjectPrompt, startPrdPrompt, type Flow } from "@hanoman/runner";`

Sisipkan cabang **setelah** blok `if (parsed.data.flow === "reverse") { … }` dan **sebelum** `const s = createSession(project.id, project.repoDir);`:

```ts
    // SPEC-210 · sesi prd project-level: PM menyusun dokumen PRD dari brief + brainstorm.
    // Meniru reverse (worktree isolasi, push ke branch prd/<slug>, manusia merge). Tanpa Spec:
    // DELETE session tak menggerakkan stage (dijaga `if (s.specId)`), worktree tetap dibersihkan.
    if (parsed.data.flow === "prd") {
      const { brief } = parsed.data;
      const slug = brief.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      if (!slug) return reply.code(400).send({ error: "judul PRD kosong" });
      const id = `prd-${slug}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const { model, effort } = await sessionModel();
      try {
        realGit.addWorktree(project.repoDir, `${project.repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${project.repoDir}/.worktrees/${id}`, {
        id, flow: "prd", model, effort,
        phaseFile: phaseFilePath(project.repoDir, id),
        decisionFile: decisionFilePath(project.repoDir, id),
        prompt: startPrdPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          brief, `prd/${slug}`),
      });
      return reply.code(201).send({ id: s.id });
    }
```

- [ ] **Step 4: Jalankan test, pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run terminal.route --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts
git commit -m "feat(server): cabang sesi prd di POST /terminal/sessions (SPEC-210)"
```

---

### Task 5: Frontend — nav PRD, PrdScreen (list + New PRD + preview + take-ke-backlog), wiring

**Files:**
- Modify: `src/src/api/client.ts` (listPrds, getPrd, startPrd; tipe PrdDoc)
- Modify: `src/src/ds/shell.tsx` (HN_NAV += PRD)
- Create: `src/src/screens/PrdScreen.tsx`
- Modify: `src/src/App.tsx` (section "prd"; NewSpecModal prop `prefill`; startPrd handler; render PrdScreen)
- Test: `src/test/prd-screen.test.tsx`

**Interfaces:**
- Consumes: `api.listPrds(projectId)`, `api.getPrd(projectId, path)`, `api.startPrd(project, brief)`, `MarkdownView` dari `../ds`, `NewSpecModal` (App).
- Produces: `PrdDoc = { slug; name; path; title; live }`. `PrdScreen` props `{ projects, projectFilter, onProjectFilter, onNewPrd(project, brief), onTakeToBacklog(prefill) }`. `NewSpecModal` prop opsional `prefill?: { project?; title?; context?; outcome?; prdPath? }`.

- [ ] **Step 1: `src/src/api/client.ts` — metode PRD**

Tambah tipe + metode (dekat `reverseDocs`):

```ts
export type PrdDoc = { slug: string; name: string; path: string; title: string; live: boolean };
```
```ts
  // SPEC-210 · dokumen PRD (freshest-wins). listPrds/getPrd baca, startPrd buka sesi prd.
  listPrds: (project: string) => j<{ items: PrdDoc[] }>(paths.prds(project)),
  getPrd: (project: string, path: string) => j<{ path: string; content: string }>(paths.prdFile(project, path)),
  startPrd: (project: string, brief: { title: string; context: string; outcome: string; constraints?: string }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "prd", brief }) }),
```

- [ ] **Step 2: `src/src/ds/shell.tsx` — nav item**

Sisipkan di `HN_NAV` setelah `backlog` (PRD di hulu backlog):

```ts
  { key: "prd", label: "PRD", icon: "scroll-text" },
```

- [ ] **Step 3: Tulis test (gagal) — `src/test/prd-screen.test.tsx`**

Ikuti pola `src/test/backlog-board.test.tsx` (render + mock `api`). Mock `api.listPrds` → dua PRD; `api.getPrd` → markdown; assert daftar tampil, klik buka preview, tombol "Take ke backlog" memanggil `onTakeToBacklog` dengan prefill (title + prdPath).

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PrdScreen } from "../src/screens/PrdScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", async (orig) => {
  const m = await orig<any>();
  return { ...m, api: { ...m.api,
    listPrds: vi.fn().mockResolvedValue({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false },
    ] }),
    getPrd: vi.fn().mockResolvedValue({ path: "docs/prd/jadwal-invoice.md", content: "# Jadwal Invoice\n\nRingkasan" }),
  } };
});

const projects = [{ id: "p1", name: "P1" } as any];
beforeEach(() => vi.clearAllMocks());

describe("PrdScreen", () => {
  it("mendaftar PRD lalu preview + take ke backlog", async () => {
    const onTake = vi.fn();
    render(<PrdScreen projects={projects} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={onTake} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    fireEvent.click(screen.getByText("Jadwal Invoice"));
    await waitFor(() => expect(screen.getByText(/Ringkasan/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /take ke backlog/i }));
    expect(onTake).toHaveBeenCalledWith(expect.objectContaining({ project: "p1", title: "Jadwal Invoice", prdPath: "docs/prd/jadwal-invoice.md" }));
  });
});
```

- [ ] **Step 4: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web test -- prd-screen`
Expected: FAIL (`PrdScreen` belum ada).

- [ ] **Step 5: Buat `src/src/screens/PrdScreen.tsx`**

```tsx
/* PrdScreen — dokumen PRD per project (SPEC-210). Daftar docs/prd/*.md (freshest-wins),
   preview MarkdownView, buat PRD baru (sesi prd), take PRD → backlog (prefill NewSpecModal). */
import React from "react";
import { Card, Badge, Button, Select, Modal, Field, Input, HnTextarea, StateBlock, MarkdownView, Icon, LIST_SCREEN_STYLE, LIST_SCROLL_STYLE, FIXED_ROW_STYLE } from "../ds";
import { api, type PrdDoc } from "../api/client";
import type { ProjectVM } from "./types";

export type PrdPrefill = { project: string; title: string; context: string; outcome: string; prdPath: string };

function NewPrdModal({ project, onClose, onCreate }:
  { project: string; onClose: () => void; onCreate: (brief: { title: string; context: string; outcome: string; constraints?: string }) => void }) {
  const [f, setF] = React.useState({ title: "", context: "", outcome: "", constraints: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} icon="scroll-text" eyebrow="PM → hanoman" title="PRD baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="messages-square" disabled={!f.title.trim()}
          onClick={() => f.title.trim() && onCreate({ title: f.title.trim(), context: f.context, outcome: f.outcome, constraints: f.constraints || undefined })}>
          Buat brief → brainstorm PRD
        </Button>
      </>}>
      <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 12, lineHeight: 1.5 }}>
        hanoman membuka sesi brainstorm interaktif di terminal, lalu menulis dokumen PRD ke <code>docs/prd/</code>.
      </div>
      <Field label="Judul"><Input value={f.title} onChange={set("title")} placeholder="mis. Jadwal Invoice Berulang" style={{ width: "100%" }} /></Field>
      <Field label="Konteks" hint="Latar belakang & alasan"><HnTextarea value={f.context} onChange={set("context")} rows={3} /></Field>
      <Field label="Hasil yang diharapkan"><HnTextarea value={f.outcome} onChange={set("outcome")} rows={2} /></Field>
      <Field label="Batasan" hint="opsional"><Input value={f.constraints} onChange={set("constraints")} style={{ width: "100%" }} /></Field>
    </Modal>
  );
}

function PrdPreview({ project, prd, onClose, onTake }:
  { project: string; prd: PrdDoc; onClose: () => void; onTake: (p: PrdPrefill) => void }) {
  const [content, setContent] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    api.getPrd(project, prd.path).then((r) => { if (alive) setContent(r.content); }).catch(() => { if (alive) setContent(""); });
    return () => { alive = false; };
  }, [project, prd.path]);
  return (
    <Modal open onClose={onClose} icon="scroll-text" eyebrow={prd.path} title={prd.title}
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Tutup</Button>
        <Button size="sm" leftIcon="list-checks"
          onClick={() => onTake({ project, title: prd.title, context: `Dari PRD: ${prd.path}`, outcome: "", prdPath: prd.path })}>
          Take ke backlog
        </Button>
      </>}>
      {content === null ? <StateBlock kind="loading" title="Memuat PRD…" />
        : <MarkdownView text={content} name={prd.name} />}
    </Modal>
  );
}

export function PrdScreen({ projects, projectFilter, onProjectFilter, onNewPrd, onTakeToBacklog }:
  { projects: ProjectVM[]; projectFilter: string; onProjectFilter: (id: string) => void;
    onNewPrd: (project: string, brief: { title: string; context: string; outcome: string; constraints?: string }) => void;
    onTakeToBacklog: (p: PrdPrefill) => void }) {
  const [items, setItems] = React.useState<PrdDoc[]>([]);
  const [sel, setSel] = React.useState<PrdDoc | null>(null);
  const [creating, setCreating] = React.useState(false);
  const proj = projectFilter === "all" ? (projects[0]?.id ?? "") : projectFilter;
  React.useEffect(() => {
    if (!proj) { setItems([]); return; }
    let alive = true;
    api.listPrds(proj).then((r) => { if (alive) setItems(r.items); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [proj]);
  return (
    <div style={LIST_SCREEN_STYLE}>
      <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <Select size="sm" value={proj} onChange={(e) => onProjectFilter(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" disabled={!proj} onClick={() => setCreating(true)}>PRD baru</Button>
      </div>
      {items.length === 0 ? (
        <StateBlock kind="empty" icon="scroll-text" title="Belum ada PRD"
          hint="Buat PRD dari brief + brainstorm; hanoman menulisnya ke docs/prd/."
          action={proj ? () => setCreating(true) : undefined} actionLabel="PRD baru" />
      ) : (
        <div style={{ ...LIST_SCROLL_STYLE, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {items.map((p) => (
            <Card key={p.path} padding={16}>
              <button onClick={() => setSel(p)} style={{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", width: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Icon name="scroll-text" size={15} color="var(--brass-500)" />
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--text-strong)" }}>{p.title}</span>
                  {p.live && <Badge tone="brass" size="sm">draft hidup</Badge>}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{p.path}</div>
              </button>
            </Card>
          ))}
        </div>
      )}
      {sel && <PrdPreview project={proj} prd={sel} onClose={() => setSel(null)}
        onTake={(pf) => { setSel(null); onTakeToBacklog(pf); }} />}
      {creating && <NewPrdModal project={proj} onClose={() => setCreating(false)}
        onCreate={(brief) => { setCreating(false); onNewPrd(proj, brief); }} />}
    </div>
  );
}
```

> Sebelum menulis, buka `src/src/ds/index` (barrel) dan pastikan `MarkdownView`, `StateBlock` (dengan `kind="loading"`), `LIST_SCREEN_STYLE`, `LIST_SCROLL_STYLE`, `FIXED_ROW_STYLE` benar-benar diekspor; kalau nama beda, sesuaikan. `Icon name="scroll-text"` — verifikasi ikon ada di set DS; kalau tidak, pakai `file-text`.

- [ ] **Step 6: `src/src/App.tsx` — wiring**

(a) Import: `import { PrdScreen, type PrdPrefill } from "./screens/PrdScreen";`

(b) `NewSpecModal` — tambah prop opsional `prefill` dan pakai untuk seed `blank` (mengganti judul/context/outcome + simpan `prdPath` ke payload). Ubah signature + `blank`:

```ts
function NewSpecModal({ open, onClose, projects, defaultProject, onCreate, prefill }:
  { open: boolean; onClose: () => void; projects: ProjectVM[]; defaultProject: string;
    onCreate: (f: SpecForm) => void; prefill?: { project?: string; title?: string; context?: string; outcome?: string; prdPath?: string } }) {
  const blank: SpecForm = { kind: "brief", project: prefill?.project || defaultProject, title: prefill?.title ?? "",
    context: prefill?.context ?? "", outcome: prefill?.outcome ?? "", constraints: "",
    priority: "sedang", severity: "major", steps: "", expected: "", actual: "", env: "", branchFrom: "" };
```

Dan di `React.useEffect(() => { if (open) setF({ ...blank, project: ... }); }, [open, defaultProject])` — tambahkan `prefill` ke deps + pakai `prefill?.project`. Simpan `prdPath` saat submit di `createSpec` (lihat c).

(c) `createSpec` — bila ada `prdPath`, sisipkan ke payload brief. Cari `api.createSpec({ ... payload: {...} })` dan tambahkan `prd: prefillPrdPath` bila ada. Simpan prefill di state:

```ts
const [specPrefill, setSpecPrefill] = React.useState<PrdPrefill | null>(null);
```
Take handler:
```ts
function takeToBacklog(pf: PrdPrefill) { setSpecPrefill(pf); setModal("brief"); }
```
Di `createSpec`, saat kind brief, tambahkan ke payload: `...(specPrefill?.prdPath ? { prd: specPrefill.prdPath } : {})`, lalu `setSpecPrefill(null)` di akhir.

(d) startPrd handler (pola `reverseDocs`):

```ts
async function startPrd(project: string, brief: { title: string; context: string; outcome: string; constraints?: string }) {
  try {
    const { id } = await api.startPrd(project, brief);
    setSection("terminal");
    showToast(`PRD · sesi ${id} dimulai`, "info", "scroll-text");
  } catch (e) {
    const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
    showToast("gagal mulai PRD" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
  }
}
```

(e) Section render — tambahkan blok (mirip `section === "backlog"`):

```tsx
} else if (section === "prd") {
  body = (
    <Shell active="prd" title="PRD" breadcrumb="brief → brainstorm → dokumen" onNavigate={setSection}
      actions={undefined}>
      <PrdScreen projects={projectsView} projectFilter={projectFilter} onProjectFilter={setProjectFilter}
        onNewPrd={startPrd} onTakeToBacklog={takeToBacklog} />
    </Shell>
  );
}
```

(f) `NewSpecModal` render — teruskan prefill: tambahkan `prefill={specPrefill ?? undefined}` ke elemen `<NewSpecModal ... />` dan reset `specPrefill` di `onClose`.

> Ikuti struktur `body`/`section` yang persis ada di App.tsx (apakah pakai `if/else if` yang me-`return`, atau merakit `body`). Sesuaikan agar konsisten — JANGAN mengarang struktur; baca dulu blok section sekitarnya.

- [ ] **Step 7: Jalankan test, pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web test -- prd-screen`
Expected: PASS. Lalu jalankan seluruh suite web: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web test` — pastikan tak ada regресi (App/nav).

- [ ] **Step 8: Typecheck + commit**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm -w exec tsc -b` (atau perintah build repo). Perbaiki error tipe.

```bash
git add src/src/api/client.ts src/src/ds/shell.tsx src/src/screens/PrdScreen.tsx src/src/App.tsx src/test/prd-screen.test.tsx
git commit -m "feat(web): layar PRD — daftar, buat, preview, take ke backlog (SPEC-210)"
```

---

### Task 6: Docs (Source of Truth) + ADR-0041

**Files:**
- Create: `internal/docs/adr/0041-prd-sebagai-dokumen-flow-project-level.md`
- Modify: `internal/docs/README.md` (index ADR-0041)
- Modify: `internal/docs/architecture/data-model.md` (flow list; PRD docs)
- Modify: `internal/docs/architecture/api-contract.md` (endpoint prds + flow prd)
- Modify: `internal/docs/entrypoints/prd.md`, `internal/docs/requirements/prd.md`, `internal/docs/product/blueprint.md` (kapabilitas PRD)
- Modify: `internal/docs/frontend/frontend-implementation.md` (layar PRD)

**Interfaces:** dokumentasi — tak ada kontrak kode.

- [ ] **Step 1: Tulis ADR-0041**

`internal/docs/adr/0041-prd-sebagai-dokumen-flow-project-level.md`:

```markdown
# ADR-0041 — PRD adalah dokumen + flow sesi project-level, bukan entitas DB

**Status:** accepted · **Tanggal:** 2026-07-14 · **SPEC-210**

## Konteks
PM/PO butuh menulis brief, ber-brainstorm, dan menghasilkan PRD sebelum fitur dipecah ke spec + plan.
Sebelumnya backlog item (`Spec`) lahir langsung dari brief/qa — tak ada artefak PRD di hulu.

## Keputusan
PRD dimodelkan sebagai **dokumen** `docs/prd/<slug>.md` di repo project — bukan tabel Prisma.
Konsisten dengan ADR-0011 (docs = filesystem nyata). Dibuat oleh **flow sesi project-level `prd`**
yang meniru `reverse`: worktree isolasi, brainstorm interaktif (satu pertanyaan/giliran), tulis PRD,
commit, push ke branch `prd/<slug>`; **manusia yang merge** (seragam dengan reverse-docs & done-spec).
List/preview **freshest-wins** (worktree sesi prd hidup > repoDir), meniru SPEC-170. "Take ke backlog"
membuat `Spec` (source brief) ter-prefill dari PRD, dengan `payload.prd` menaut balik ke path PRD.

## Konsekuensi
- Tak ada migration/skema baru. Tak ada auto-merge, tak ada auto-split PRD → banyak spec.
- Ceiling: PRD yang sesinya ditutup tapi branch belum di-merge hanya ada di origin/branch (tak muncul
  di daftar sampai merge). Upgrade path: daftar juga branch `prd/*`.
```

- [ ] **Step 2: Index-kan di `internal/docs/README.md`**

Di bagian `## adr`, tambahkan baris paling atas daftar ADR:

```markdown
- [0041 — PRD adalah dokumen + flow project-level, bukan entitas DB](adr/0041-prd-sebagai-dokumen-flow-project-level.md)
```

- [ ] **Step 3: `data-model.md`** — pada bagian flow/Spec `source`, tambah catatan: flow sesi kini `feature | qa | scaffold | reverse | prd`; PRD hidup sebagai `docs/prd/*.md` (tak dipersist, ADR-0011/0041), bukan kolom.

- [ ] **Step 4: `api-contract.md`** — dokumentasikan `GET /projects/:id/prds`, `GET /projects/:id/prds/*`, dan varian `POST /terminal/sessions { project, flow:"prd", brief }`.

- [ ] **Step 5: Kapabilitas produk** — di `entrypoints/prd.md`, `requirements/prd.md`, `product/blueprint.md`: tambahkan kapabilitas "**PRD** — PM/PO menulis brief + brainstorm → dokumen PRD (`docs/prd/`), preview untuk review, take ke backlog." Sisipkan di daftar kapabilitas.

- [ ] **Step 6: `frontend-implementation.md`** — tambah entri layar **PRD** (nav): daftar PRD per project, New PRD (sesi prd), preview MarkdownView, take ke backlog (prefill NewSpecModal).

- [ ] **Step 7: Verifikasi index & coverage**

Run: `env -u NODE_ENV -u DATABASE_URL node --experimental-strip-types shared/src/coverage.ts` bila ada harness; kalau tidak, cukup pastikan setiap file baru ter-link dari `internal/docs/README.md` (grep manual).

- [ ] **Step 8: Commit**

```bash
git add internal/docs
git commit -m "docs(sot): ADR-0041 PRD + api-contract/data-model/kapabilitas/frontend (SPEC-210)"
```

---

### Task 7: Verifikasi end-to-end nyata (wajib CLAUDE.md)

**Files:** tak ada — verifikasi runtime.

- [ ] **Step 1: Boot server terhadap DB throwaway ter-migrate** (jangan hanoman_test — bisa di-truncate sibling; lihat memory live-smoke-dedicated-db). Migrate `deploy` DB smoke, set DATABASE_URL/PORT khusus, jalankan `node server/dist/server.js` (build dulu).
- [ ] **Step 2: Seed satu project ber-repoDir git valid** (project from-scratch atau existing dengan repo).
- [ ] **Step 3:** `curl -XPOST /api/terminal/sessions -d '{"project":"<id>","flow":"prd","brief":{"title":"Smoke PRD","context":"c","outcome":"o"}}'` → 201 `{id:"prd-smoke-prd"}`. Cek `.worktrees/prd-smoke-prd` ada.
- [ ] **Step 4:** Di worktree itu tulis `docs/prd/smoke-prd.md` (`# Smoke PRD`), lalu `curl /api/projects/<id>/prds` → memuat slug `smoke-prd`, `live:true`. `curl /api/projects/<id>/prds/docs/prd/smoke-prd.md` → 200 konten.
- [ ] **Step 5:** `curl -XPOST /api/specs -d '{"project":"<id>","source":"brief","title":"Smoke PRD","priority":"sedang","payload":{"context":"Dari PRD: docs/prd/smoke-prd.md","outcome":"o","prd":"docs/prd/smoke-prd.md"}}'` → 201; `GET /api/specs` memuatnya.
- [ ] **Step 6:** `curl -XDELETE /api/terminal/sessions/prd-smoke-prd` → 204; worktree dibersihkan.
- [ ] **Step 7:** Bila ada error → fix sampai hijau sebelum tulis `Execute done`. Ceklis semua `- [ ]` di plan ini.
