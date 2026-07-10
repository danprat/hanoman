# SPEC-170 — Viewer Dokumen Audit/Spec/Plan · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tombol "lihat dokumen" + dialog preview Markdown untuk membaca audit/objective/spec/plan/brainstorm sebuah backlog item, di Backlog dan Terminal.

**Architecture:** Viewer read-only di atas primitif yang sudah ada. Server menemukan berkas per backlog item dengan men-scan direktori (`listRepoDocs`) lalu memfilter nama file yang memuat `spec-N` (boundary-safe) dan mengklasifikasi jenisnya. Direktori dipilih *freshest-wins*: worktree sesi tmux hidup untuk spec itu, kalau tidak repoDir project. Isi berkas dibaca lewat `readDocFile` (guard `.md` + dalam-dir sudah ada). Frontend memakai `Modal` + `marked` (`MarkdownView`) yang sudah ada.

**Tech Stack:** TypeScript (strict), Fastify (server), React 18 + Vite (frontend), Prisma (baca-saja di sini), vitest. Dependency: `marked@^12` (sudah terpasang). **Nol dependency baru, nol perubahan skema, nol migration.**

## Global Constraints

- **TypeScript strict** di semua paket. `pnpm -r typecheck` harus hijau.
- **Tanpa dependency runtime baru, tanpa perubahan skema Prisma, tanpa migration.**
- **Tanpa ADR** (viewer read-only, tak ubah skema/kontrak).
- **Docs SoT diperbarui di commit yang sama** saat berkas kode tersentuh (CLAUDE.md).
- **Boundary spec-id:** cocokkan `(^|[^a-z0-9])<id-lowercase>([^0-9]|$)` — `spec-17` tak boleh menyerempet `spec-170` (pola dari `stage-artifacts.ts:29`).
- **Menjalankan test server:** shell sesi bisa menunjuk prod (memory). Selalu:
  `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test`. Butuh Postgres (docker) + DB `hanoman_test` sudah ter-migrate (tak ada skema baru di sini, jadi DB test yang lama cukup).
- **Verifikasi nyata wajib** sebelum klaim selesai (CLAUDE.md): boot server + curl endpoint + smoke UI, bukan cuma unit test.
- **Jangan jalankan run di working tree utama.** Semua kerja di worktree ini (`.worktrees/spec-170`, detached HEAD — disengaja).

---

### Task 1: Server — service `spec-docs.ts`

Menemukan + mengklasifikasi dokumen sebuah backlog item, dengan sumber freshest-wins. Seam `sessions` (default `listSessions()`) membuat cabang "sesi hidup" bisa diuji deterministik tanpa tmux.

**Files:**
- Create: `server/src/services/spec-docs.ts`
- Test: `server/test/spec-docs.test.ts`

**Interfaces:**
- Consumes: `listRepoDocs(dir): Promise<string[]>` (`services/scan.ts:16`), `listSessions(): SessionInfo[]` (`services/pty.ts:96`), `prisma` (`db.ts`).
- Produces:
  - `type DocKind = "audit" | "spec" | "plan" | "objective" | "brainstorm" | "other"`
  - `type SpecDoc = { kind: DocKind; path: string; name: string }`
  - `kindOf(path: string): DocKind`
  - `resolveDir(specId: string, sessions?: ReturnType<typeof listSessions>): Promise<string | null>`
  - `listSpecDocs(specId: string, sessions?: ReturnType<typeof listSessions>): Promise<SpecDoc[]>`

- [x] **Step 1: Write the failing test**

```ts
// server/test/spec-docs.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, makeProject, makeSpec, makeTempRepo } from "./factory";
import { kindOf, listSpecDocs, resolveDir } from "../src/services/spec-docs";

const repo = makeTempRepo({
  "internal/docs/operations/spec-170-x-audit.md": "# audit",
  "internal/docs/operations/spec-170-x-objective.md": "# obj",
  "docs/superpowers/specs/2026-07-11-x-spec-170-design.md": "# spec",
  "docs/superpowers/specs/2026-07-11-x-spec-170-brainstorm.md": "# brain",
  "docs/superpowers/plans/2026-07-11-x-spec-170.md": "# plan",
  "docs/superpowers/specs/2026-07-11-y-spec-17-design.md": "# neighbor",
  "notes/spec-170-note.txt": "not md",
  "internal/docs/README.md": "root",
});

beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1", repoDir: repo });
  await makeSpec({ id: "SPEC-170", projectId: "p1", stage: "done" });
  await makeSpec({ id: "SPEC-17", projectId: "p1", stage: "done" });
});

describe("kindOf", () => {
  it("classifies by suffix and dir", () => {
    expect(kindOf("internal/docs/operations/spec-170-x-audit.md")).toBe("audit");
    expect(kindOf("internal/docs/operations/spec-170-x-objective.md")).toBe("objective");
    expect(kindOf("docs/superpowers/specs/a-spec-170-brainstorm.md")).toBe("brainstorm");
    expect(kindOf("docs/superpowers/specs/a-spec-170-design.md")).toBe("spec");
    expect(kindOf("internal/docs/operations/spec-168-x-spec.md")).toBe("spec");
    expect(kindOf("docs/superpowers/plans/a-spec-170.md")).toBe("plan");
    expect(kindOf("README.md")).toBe("other");
  });
});

describe("listSpecDocs", () => {
  it("finds all md for the spec in kind-order, boundary-safe, md-only", async () => {
    const docs = await listSpecDocs("SPEC-170", []); // no live session -> repoDir
    expect(docs.map((d) => d.kind)).toEqual(["audit", "spec", "plan", "objective", "brainstorm"]);
    expect(docs.every((d) => d.path.toLowerCase().includes("spec-170"))).toBe(true);
    expect(docs.some((d) => d.path.endsWith(".txt"))).toBe(false);
  });
  it("does not bleed into spec-17", async () => {
    const docs = await listSpecDocs("SPEC-17", []);
    expect(docs.map((d) => d.path)).toEqual(["docs/superpowers/specs/2026-07-11-y-spec-17-design.md"]);
  });
});

describe("resolveDir", () => {
  const sess = (over: Record<string, unknown>) =>
    ({ id: "spec-170", projectId: "p1", specId: "SPEC-170", flow: "feature", cwd: "/live/wt", exited: false, ...over });
  it("prefers a live session cwd over repoDir", async () => {
    expect(await resolveDir("SPEC-170", [sess({})])).toBe("/live/wt");
  });
  it("ignores exited sessions, falls back to repoDir", async () => {
    expect(await resolveDir("SPEC-170", [sess({ exited: true })])).toBe(repo);
  });
  it("null when spec unknown and no session", async () => {
    expect(await resolveDir("SPEC-999", [])).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test spec-docs`
Expected: FAIL — `Cannot find module '../src/services/spec-docs'`.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/spec-docs.ts
import { prisma } from "../db";
import { listRepoDocs } from "./scan";
import { listSessions } from "./pty";

export type DocKind = "audit" | "spec" | "plan" | "objective" | "brainstorm" | "other";
export type SpecDoc = { kind: DocKind; path: string; name: string };

// Urutan tampil: pimpin dengan tiga yang disebut backlog item, lalu pendukung.
const ORDER: DocKind[] = ["audit", "spec", "plan", "objective", "brainstorm", "other"];

// Klasifikasi berbasis suffix + dir: "spec" hidup di dua tempat
// (operations/*-spec.md dan superpowers/specs/*-design.md). Cek brainstorm & objective
// SEBELUM aturan dir specs, supaya keduanya tak tertelan jadi "spec".
export function kindOf(path: string): DocKind {
  const p = path.toLowerCase();
  if (p.endsWith("-audit.md")) return "audit";
  if (p.endsWith("-objective.md")) return "objective";
  if (p.endsWith("-brainstorm.md")) return "brainstorm";
  if (p.endsWith("-design.md") || p.endsWith("-spec.md") || p.startsWith("docs/superpowers/specs/")) return "spec";
  if (p.startsWith("docs/superpowers/plans/") || p.endsWith("-plan.md")) return "plan";
  return "other";
}

// cwd sesi HIDUP untuk spec ini kalau ada; kalau tidak, repoDir project. Sesi hidup =
// worktree run: memuat dokumen in-progress yang belum di-merge (freshest-wins, SPEC-170).
export async function resolveDir(
  specId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<string | null> {
  const live = sessions.find((s) => s.specId === specId && !s.exited && s.cwd);
  if (live) return live.cwd;
  const spec = await prisma.spec.findUnique({
    where: { id: specId }, select: { project: { select: { repoDir: true } } },
  });
  return spec?.project.repoDir ?? null;
}

export async function listSpecDocs(
  specId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<SpecDoc[]> {
  const dir = await resolveDir(specId, sessions);
  if (!dir) return [];
  const id = specId.toLowerCase();
  const re = new RegExp(`(^|[^a-z0-9])${id}([^0-9]|$)`);
  const docs = (await listRepoDocs(dir))
    .filter((f) => re.test(f.toLowerCase()))
    .map((f) => ({ kind: kindOf(f), path: f, name: f.slice(f.lastIndexOf("/") + 1) }));
  return docs.sort((a, b) =>
    ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.path.localeCompare(b.path));
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test spec-docs`
Expected: PASS (semua `it` di file itu hijau).

- [x] **Step 5: Commit**

```bash
git add server/src/services/spec-docs.ts server/test/spec-docs.test.ts
git commit -m "feat(server): spec-docs — temukan & klasifikasi dokumen per backlog item (SPEC-170)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Server — endpoint `GET /specs/:id/docs` + `GET /specs/:id/docs/*`

**Files:**
- Modify: `server/src/routes/specs.ts` (tambah 2 route + 2 import)
- Test: `server/test/spec-docs.route.test.ts`

**Interfaces:**
- Consumes: `listSpecDocs`, `resolveDir` (Task 1), `readDocFile(dir, rel): string | null` (`services/scan.ts:84`).
- Produces (HTTP): `GET /api/specs/:id/docs` → `{ files: SpecDoc[] }`; `GET /api/specs/:id/docs/*` → `{ path, content }` atau 404.

- [x] **Step 1: Write the failing test**

```ts
// server/test/spec-docs.route.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeTempRepo } from "./factory";

const app = buildApp();
const repo = makeTempRepo({
  "internal/docs/operations/spec-170-x-audit.md": "# audit\n\nbody",
  "docs/superpowers/specs/2026-07-11-x-spec-170-design.md": "# design",
  "docs/superpowers/plans/2026-07-11-x-spec-170.md": "# plan",
  "internal/docs/README.md": "root",
});
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1", repoDir: repo });
  await makeSpec({ id: "SPEC-170", projectId: "p1", stage: "done" });
  await makeSpec({ id: "SPEC-171", projectId: "p1", stage: "brainstorming" });
});

describe("GET /specs/:id/docs", () => {
  it("lists the item's docs by kind", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-170/docs" });
    expect(res.statusCode).toBe(200);
    expect(res.json().files.map((f: any) => f.kind)).toEqual(["audit", "spec", "plan"]);
  });
  it("returns file content", async () => {
    const res = await app.inject({
      url: "/api/specs/SPEC-170/docs/internal/docs/operations/spec-170-x-audit.md" });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain("# audit");
  });
  it("404 for a non-md / traversal path", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-170/docs/notes.txt" });
    expect(res.statusCode).toBe(404);
  });
  it("empty list for a spec with no docs", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-171/docs" });
    expect(res.json().files).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test spec-docs.route`
Expected: FAIL — 404/`files` undefined (route belum ada).

- [x] **Step 3: Add the imports**

Di puncak `server/src/routes/specs.ts`, setelah baris import yang ada, tambah:

```ts
import { listSpecDocs, resolveDir } from "../services/spec-docs";
import { readDocFile } from "../services/scan";
```

- [x] **Step 4: Add the routes**

Di dalam `export default async function (app)`, sebelum `app.delete("/specs/:id", ...)` (baris ~98), sisipkan:

```ts
  // SPEC-170 · dokumen sebuah backlog item (audit/objective/spec/plan/brainstorm).
  // Sumber freshest-wins ada di resolveDir: worktree sesi hidup > repoDir.
  app.get("/specs/:id/docs", async (req) =>
    ({ files: await listSpecDocs((req.params as { id: string }).id) }));

  app.get("/specs/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const dir = await resolveDir(id);
    const content = dir ? readDocFile(dir, path) : null; // readDocFile menolak non-.md -> null
    return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
  });
```

- [x] **Step 5: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test spec-docs.route`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/specs.ts server/test/spec-docs.route.test.ts
git commit -m "feat(server): GET /specs/:id/docs + /docs/* — daftar & isi dokumen backlog item (SPEC-170)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Shared paths + API client

**Files:**
- Modify: `shared/src/api.ts` (2 path)
- Modify: `src/src/api/client.ts` (2 method + 2 tipe)
- Test: `src/test/api-client.test.ts` (tambah 1 `it`)

**Interfaces:**
- Consumes: `paths` dari `@hanoman/shared`, `j<T>` (`client.ts:10`).
- Produces:
  - `paths.specDocs(id)`, `paths.specDocFile(id, path)`
  - `type DocKind`, `type SpecDoc` (di client)
  - `api.getSpecDocs(id): Promise<{ files: SpecDoc[] }>`
  - `api.getSpecDocFile(id, path): Promise<{ path: string; content: string }>`

- [ ] **Step 1: Write the failing test**

Tambahkan di `src/test/api-client.test.ts` (file sudah meng-import `paths`, `api`, `vi`):

```ts
it("getSpecDocs & getSpecDocFile menuju path dokumen spec", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ files: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  await api.getSpecDocs("SPEC-170");
  expect(fetchMock).toHaveBeenCalledWith(paths.specDocs("SPEC-170"), expect.anything());
  await api.getSpecDocFile("SPEC-170", "docs/superpowers/plans/x.md");
  expect(fetchMock).toHaveBeenCalledWith(paths.specDocFile("SPEC-170", "docs/superpowers/plans/x.md"), expect.anything());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./src test api-client`
Expected: FAIL — `api.getSpecDocs is not a function` / `paths.specDocs is not a function`.

- [ ] **Step 3: Add shared paths**

Di `shared/src/api.ts`, di dalam objek `paths`, setelah baris `spec: (id) => ...` (baris 7):

```ts
  specDocs: (id: string) => `${API}/specs/${id}/docs`,
  specDocFile: (id: string, path: string) => `${API}/specs/${id}/docs/${path}`,
```

- [ ] **Step 4: Add client types + methods**

Di `src/src/api/client.ts`, dekat definisi tipe lain (mis. setelah `TerminalSession`):

```ts
export type DocKind = "audit" | "spec" | "plan" | "objective" | "brainstorm" | "other";
export type SpecDoc = { kind: DocKind; path: string; name: string };
```

Di dalam objek `api`, tambah dua method (mis. setelah `getDoc`):

```ts
  getSpecDocs: (id: string) => j<{ files: SpecDoc[] }>(paths.specDocs(id)),
  getSpecDocFile: (id: string, path: string) => j<{ path: string; content: string }>(paths.specDocFile(id, path)),
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter ./src test api-client && pnpm -r typecheck`
Expected: PASS + typecheck hijau.

- [ ] **Step 6: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/test/api-client.test.ts
git commit -m "feat(web): api.getSpecDocs / getSpecDocFile + shared paths (SPEC-170)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — angkat `MarkdownView` jadi primitif `ds/markdown`

Refactor tanpa perubahan perilaku: hilangkan duplikasi supaya `SpecDocsModal` (Task 5) dan `DocsWorkspace` berbagi satu renderer.

**Files:**
- Create: `src/src/ds/markdown.tsx`
- Modify: `src/src/ds/index.ts` (ekspor)
- Modify: `src/src/screens/DocsWorkspace.tsx` (hapus helper lokal, import dari `../ds`)

**Interfaces:**
- Produces: `MarkdownView({ text, name })`, `hnDocHtml(text, name): string` (diekspor dari `../ds`).
- Consumes: `marked` (`^12`, terpasang), kelas CSS `.hn-md` (`src/src/app.css:13`).

- [ ] **Step 1: Create `src/src/ds/markdown.tsx`**

```tsx
import React from "react";
import { marked } from "marked";

function hnRender(md: string) {
  try { return marked.parse(md || "", { gfm: true, breaks: false }) as string; }
  catch { return "<pre>" + String(md || "").replace(/[&<>]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as any)[c])) + "</pre>"; }
}
function hnLang(name: string) {
  return /\.json$/.test(name) ? "json" : /\.toml$/.test(name) ? "toml"
    : /\.ya?ml$/.test(name) ? "yaml" : /\.(ts|tsx|js)$/.test(name) ? "ts" : "";
}
export function hnDocHtml(text: string, name: string) {
  const md = /\.md$/.test(name) ? (text || "") : ("```" + hnLang(name) + "\n" + (text || "") + "\n```");
  return hnRender(md);
}
export function MarkdownView({ text, name }: { text: string; name: string }) {
  return <div className="hn-md" dangerouslySetInnerHTML={{ __html: hnDocHtml(text, name) }} />;
}
```

- [ ] **Step 2: Export from the barrel**

Di `src/src/ds/index.ts`, tambah baris:

```ts
export { MarkdownView, hnDocHtml } from "./markdown";
```

- [ ] **Step 3: Point `DocsWorkspace` at the shared renderer**

Di `src/src/screens/DocsWorkspace.tsx`:
- Hapus fungsi lokal `hnRender` (baris 11-14), `hnLang` (15-18), `hnDocHtml` (19-22), dan komponen `MarkdownView` (108-110).
- Hapus `import { marked } from "marked";` (baris 5) — tak lagi dipakai langsung.
- Tambah `MarkdownView` ke import `../ds` yang sudah ada (baris 6):
  `import { Card, StatusPill, Badge, Button, ProgressBar, Icon, StateBlock, MarkdownView } from "../ds";`

Pemakaian `<MarkdownView text=... name=... />` di baris 263 & 282 tetap tak berubah.

- [ ] **Step 4: Typecheck + existing docs test still green**

Run: `pnpm -r typecheck && pnpm --filter ./src test docs-tree`
Expected: typecheck hijau; `docs-tree` (uji `buildTree`/`firstDoc` di DocsWorkspace) tetap PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/ds/markdown.tsx src/src/ds/index.ts src/src/screens/DocsWorkspace.tsx
git commit -m "refactor(web): angkat MarkdownView ke ds/markdown, hapus duplikasi (SPEC-170)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — komponen `SpecDocsModal`

**Files:**
- Create: `src/src/screens/SpecDocsModal.tsx`
- Test: `src/test/spec-docs-modal.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `StateBlock`, `Icon`, `MarkdownView` (dari `../ds`); `api.getSpecDocs`, `api.getSpecDocFile`, tipe `SpecDoc` (Task 3).
- Produces: `SpecDocsModal({ specId, onClose })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/test/spec-docs-modal.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SpecDocsModal } from "../src/screens/SpecDocsModal";

const getSpecDocs = vi.fn();
const getSpecDocFile = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    getSpecDocs: (...a: unknown[]) => getSpecDocs(...a),
    getSpecDocFile: (...a: unknown[]) => getSpecDocFile(...a),
  },
}));

beforeEach(() => { getSpecDocs.mockReset(); getSpecDocFile.mockReset(); });

describe("SpecDocsModal", () => {
  it("mengelompokkan file per jenis & me-render markdown file terpilih", async () => {
    getSpecDocs.mockResolvedValue({ files: [
      { kind: "audit", path: "internal/docs/operations/spec-170-x-audit.md", name: "spec-170-x-audit.md" },
      { kind: "plan", path: "docs/superpowers/plans/x-spec-170.md", name: "x-spec-170.md" },
    ]});
    getSpecDocFile.mockResolvedValue({ path: "internal/docs/operations/spec-170-x-audit.md", content: "# Judul Audit" });
    render(<SpecDocsModal specId="SPEC-170" onClose={() => {}} />);
    expect(await screen.findByText("Audit")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    // file pertama auto-terpilih -> isinya di-render sebagai <h1> markdown
    await waitFor(() => expect(screen.getByText("Judul Audit")).toBeInTheDocument());
  });

  it("empty state saat item belum punya dokumen", async () => {
    getSpecDocs.mockResolvedValue({ files: [] });
    render(<SpecDocsModal specId="SPEC-999" onClose={() => {}} />);
    expect(await screen.findByText("Belum ada dokumen untuk item ini")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./src test spec-docs-modal`
Expected: FAIL — `Cannot find module '../src/screens/SpecDocsModal'`.

- [ ] **Step 3: Write the component**

```tsx
// src/src/screens/SpecDocsModal.tsx
import React from "react";
import { Modal, StateBlock, Icon, MarkdownView } from "../ds";
import { api, type SpecDoc } from "../api/client";

const KIND_LABEL: Record<string, string> = {
  audit: "Audit", spec: "Spec", plan: "Plan",
  objective: "Objective", brainstorm: "Brainstorm", other: "Lainnya",
};

export function SpecDocsModal({ specId, onClose }: { specId: string; onClose: () => void }) {
  const [files, setFiles] = React.useState<SpecDoc[] | null>(null);
  const [ixError, setIxError] = React.useState(false);
  const [sel, setSel] = React.useState("");
  // null = fetch gagal (bukan "kosong"), agar error per-berkas bisa dibedakan.
  const [cache, setCache] = React.useState<Record<string, string | null>>({});

  React.useEffect(() => {
    let alive = true;
    setFiles(null); setIxError(false); setSel(""); setCache({});
    api.getSpecDocs(specId).then((r) => {
      if (!alive) return;
      setFiles(r.files);
      if (r.files[0]) setSel(r.files[0].path);
    }).catch(() => { if (alive) setIxError(true); });
    return () => { alive = false; };
  }, [specId]);

  React.useEffect(() => {
    if (!sel || sel in cache) return;
    let alive = true;
    api.getSpecDocFile(specId, sel)
      .then((d) => { if (alive) setCache((c) => ({ ...c, [sel]: d.content })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [sel]: null })); });
    return () => { alive = false; };
  }, [sel, specId, cache]);

  const loading = files === null && !ixError;
  const docLoading = !!sel && !(sel in cache);
  const docFailed = sel ? cache[sel] === null : false;

  // Server sudah mengurutkan per ORDER kind; kelompokkan run yang berurutan.
  const groups: { kind: string; items: SpecDoc[] }[] = [];
  for (const f of files ?? []) {
    const g = groups[groups.length - 1];
    if (g && g.kind === f.kind) g.items.push(f);
    else groups.push({ kind: f.kind, items: [f] });
  }

  return (
    <Modal open title="Dokumen backlog item" eyebrow={specId} icon="file-text" onClose={onClose} width={900}>
      {ixError ? <StateBlock kind="error" title="Gagal memuat daftar dokumen" hint={specId} />
        : loading ? <StateBlock kind="loading" title="Memuat dokumen…" hint={specId} />
        : !files!.length ? <StateBlock kind="empty" icon="file-text" title="Belum ada dokumen untuk item ini"
            hint="Jalankan item ini agar agent menulis audit/spec/plan." />
        : (
          <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16, height: "62vh" }}>
            <div style={{ overflow: "auto", borderRight: "1px solid var(--border-hair)", paddingRight: 8 }}>
              {groups.map((grp) => (
                <div key={grp.kind} style={{ marginBottom: 10 }}>
                  <div className="hn-eyebrow" style={{ padding: "4px 6px", color: "var(--text-subtle)" }}>
                    {KIND_LABEL[grp.kind] ?? grp.kind}
                  </div>
                  {grp.items.map((f) => {
                    const on = f.path === sel;
                    return (
                      <button key={f.path} onClick={() => setSel(f.path)} style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
                        borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", textAlign: "left",
                        background: on ? "var(--brass-100)" : "transparent",
                      }}>
                        <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
                        <span style={{
                          fontFamily: "var(--font-mono)", fontSize: 11.5,
                          color: on ? "var(--brass-700)" : "var(--text-body)", fontWeight: on ? 600 : 400,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{f.name}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ overflow: "auto", padding: "0 8px 16px" }}>
              {docLoading ? <StateBlock kind="loading" title="Memuat…" hint={sel} />
                : docFailed ? <StateBlock kind="error" title="Gagal memuat berkas" hint={sel} />
                : <MarkdownView text={cache[sel] ?? ""} name={sel} />}
            </div>
          </div>
        )}
    </Modal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./src test spec-docs-modal`
Expected: PASS (kedua `it`).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/SpecDocsModal.tsx src/test/spec-docs-modal.test.tsx
git commit -m "feat(web): SpecDocsModal — dialog preview dokumen backlog item (SPEC-170)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Frontend — pasang tombol di Backlog (`SpecActions`) + Terminal (`Cell`)

Satu edit di `SpecActions` muncul di ketiga view Backlog (card/row/board). Satu edit di header `Cell` untuk Terminal. Modal disimpan lokal per komponen — tak perlu prop-drilling.

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (`SpecActions`, ~154-173)
- Modify: `src/src/screens/TerminalScreen.tsx` (`Cell`, ~280-308)

**Interfaces:**
- Consumes: `SpecDocsModal` (Task 5), `IconButton`/`Icon` (ds).

- [ ] **Step 1: Backlog — import + tombol di `SpecActions`**

Di `src/src/screens/BacklogScreen.tsx`:
- Pastikan `import React from "react";` ada di puncak (untuk `React.useState`). Kalau belum, tambahkan.
- Tambahkan import: `import { SpecDocsModal } from "./SpecDocsModal";`
- Ganti isi `SpecActions` (baris 154-173) menjadi:

```tsx
function SpecActions({ spec, onStart, onDelete, onOpenRun, running }:
  { spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; running?: boolean }) {
  const [docs, setDocs] = React.useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {spec.stage !== "done" && running && (
        <Button size="sm" variant="secondary" leftIcon="terminal" onClick={() => onOpenRun && onOpenRun(spec)}>
          Buka sesi
        </Button>
      )}
      {spec.stage !== "done" && !running && (
        <Button size="sm" variant="primary" leftIcon="play" onClick={() => onStart && onStart(spec)}>
          {spec.stage === "brainstorming" ? "Mulai" : "Lanjutkan"}
        </Button>
      )}
      {spec.stage === "done" && <Badge tone="ok" size="sm" icon="check-circle-2">selesai</Badge>}
      <IconButton size="sm" variant="ghost" icon="file-text" label="Lihat dokumen" onClick={() => setDocs(true)} />
      {onDelete && <IconButton size="sm" variant="ghost" icon="trash-2" label="Hapus spec" onClick={() => onDelete(spec)} />}
      {docs && <SpecDocsModal specId={spec.id} onClose={() => setDocs(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Terminal — import + tombol di header `Cell`**

Di `src/src/screens/TerminalScreen.tsx`:
- Pastikan `Icon` ada di import `../ds`. Kalau belum, tambahkan ke daftar import ds.
- Tambahkan import: `import { SpecDocsModal } from "./SpecDocsModal";`
- Di `Cell` (baris 280+), tambah state: setelah `const [phases, setPhases] = React.useState<Phase[] | null>(null);` sisipkan
  `const [docs, setDocs] = React.useState(false);`
- Di header (di antara `<span>{label}…</span>` dan `<span onClick={onDetach}>lepas</span>`, baris ~295-296), sisipkan:

```tsx
        {session.specId && (
          <span onClick={() => setDocs(true)} title="Lihat dokumen (audit/spec/plan)"
            style={{ cursor: "pointer", color: "var(--text-subtle)", display: "inline-flex", alignItems: "center" }}>
            <Icon name="file-text" size={12} />
          </span>
        )}
```

- Sebelum penutup fragment `</>` (setelah `<div>…<TerminalPane/></div>`, baris ~305), sisipkan:

```tsx
      {docs && session.specId && <SpecDocsModal specId={session.specId} onClose={() => setDocs(false)} />}
```

- [ ] **Step 3: Typecheck + existing screen tests still green**

Run: `pnpm -r typecheck && pnpm --filter ./src test terminal-screen backlog-board`
Expected: typecheck hijau; `terminal-screen` & `backlog-board` tetap PASS (tombol baru tak memecah komposisi grid/board — modal hanya mount saat diklik).

> Catatan: `terminal-screen.test.tsx` me-mock `../src/api/client`. Bila render sebuah `Cell` menyentuh `SpecDocsModal` (hanya saat diklik — tidak di test itu), mock tak perlu diubah. Kalau ada test yang gagal karena import `SpecDocsModal` menarik `api`, tambahkan `getSpecDocs`/`getSpecDocFile` ke objek mock-nya.

- [ ] **Step 4: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/src/screens/TerminalScreen.tsx
git commit -m "feat(web): tombol 'lihat dokumen' di Backlog & Terminal (SPEC-170)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Verifikasi nyata + docs SoT + push

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md` (catat komponen baru)

- [ ] **Step 1: Full test + typecheck**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test
pnpm --filter ./src test
pnpm -r typecheck
```
Expected: semua PASS/hijau. Kalau ada yang merah, perbaiki dulu sebelum lanjut (systematic-debugging).

- [ ] **Step 2: Boot server + curl endpoint (verifikasi nyata, wajib)**

```bash
pnpm --filter ./server build
node server/dist/server.js &   # atau: pnpm dev:api
# Pakai backlog item yang punya dokumen di repo, mis. SPEC-145 (audit+objective+spec+plan).
curl -s localhost:8787/api/specs/SPEC-145/docs | head -c 800
# ambil satu path dari daftar di atas, lalu:
curl -s "localhost:8787/api/specs/SPEC-145/docs/internal/docs/operations/spec-145-qa-after-audit-objective.md" | head -c 400
```
Expected: daftar `files` memuat jenis `audit`/`spec`/`plan`/`objective`; endpoint isi mengembalikan `{ path, content }` berisi Markdown. (Port default server = 8787; sesuaikan bila berbeda. Jangan tabrakan dengan dev server lain — memory: port 8787 bisa dipakai sesi dev lain; pakai port lain kalau bentrok.)

- [ ] **Step 3: Smoke UI**

Buka dashboard (`pnpm dev:web`), Backlog: klik ikon "lihat dokumen" pada sebuah item → dialog muncul, kiri berisi daftar dikelompok per jenis, kanan me-render Markdown. Terminal: pada sel sesi yang punya `specId`, klik ikon dokumen → dialog sama muncul dan (untuk sesi hidup) membaca worktree. Item tanpa dokumen → empty state.

- [ ] **Step 4: Update docs SoT**

Di `internal/docs/frontend/frontend-implementation.md`, tambahkan pada bagian komponen/screen yang sesuai:

```md
- `ds/markdown` (`MarkdownView`, `hnDocHtml`): renderer Markdown bersama (marked + `.hn-md`),
  dipakai `DocsWorkspace` dan `SpecDocsModal`.
- `SpecDocsModal` (`screens/SpecDocsModal.tsx`): dialog preview dokumen sebuah backlog item
  (audit/objective/spec/plan/brainstorm). Data dari `GET /specs/:id/docs` (+ `/docs/*`), sumber
  freshest-wins (worktree sesi hidup > repoDir). Tombol pemicu di `SpecActions` (Backlog) &
  header `Cell` (Terminal).
```

- [ ] **Step 5: Commit docs + final phase**

```bash
git add internal/docs/frontend/frontend-implementation.md
git commit -m "docs(spec-170): catat SpecDocsModal + ds/markdown di frontend-implementation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
echo "Execute done" >> "$HANOMAN_PHASE_FILE"
```

- [ ] **Step 6: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-170
```
Expected: branch `hanoman/spec-170` terdorong ke origin untuk di-review + merge manusia.

---

## Self-Review

**1. Spec coverage** (tiap bagian design → task):
- Konsep "dokumen backlog item" + boundary + freshest-wins → Task 1 (`listSpecDocs`/`resolveDir`).
- Klasifikasi jenis (suffix+dir) → Task 1 (`kindOf`).
- Endpoint daftar + isi → Task 2.
- Shared paths + client → Task 3.
- Angkat `MarkdownView` → Task 4.
- `SpecDocsModal` (preview, empty/loading/error) → Task 5.
- Tombol Backlog + Terminal → Task 6.
- Test unit+route+client+render + verifikasi nyata + docs SoT → tersebar + Task 7.
- Tanpa ADR/migration/dependency → dijaga Global Constraints. ✓ Tak ada bagian design tanpa task.

**2. Placeholder scan:** tak ada TBD/TODO; tiap step kode menampilkan kode lengkap, tiap step run menampilkan perintah + expected. ✓

**3. Type consistency:** `DocKind`/`SpecDoc` identik di server (Task 1) & client (Task 3). `kindOf`/`resolveDir`/`listSpecDocs` dipakai konsisten di Task 2. `api.getSpecDocs` mengembalikan `{ files: SpecDoc[] }` — dikonsumsi `SpecDocsModal` (Task 5) & diuji Task 3. `MarkdownView({text,name})` sama di Task 4 (definisi) & Task 5 (pakai). Urutan kind ORDER `[audit,spec,plan,objective,brainstorm,other]` konsisten antara service (Task 1) & label modal (Task 5). ✓
