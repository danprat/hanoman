# Overview Coverage Realtime (SPEC-141) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overview menampilkan SoT coverage nyata dari disk tanpa langkah Scan manual — `coverage` dan `docStatus` berhenti jadi kolom Postgres dan kembali jadi nilai turunan.

**Architecture:** `toProjectView()` — satu-satunya pembaca kedua kolom itu — menurunkannya dari `scanRepoDocs(repoDir)`, fungsi yang sama yang sudah dipakai `GET /docs`. Kolomnya lalu di-drop lewat migration, dan `POST /projects/:id/scan` beserta tombol "Scan semua" ikut dihapus karena tak ada lagi yang bisa disegarkan. Agar N project tidak memblokir event loop, `git ls-files` pindah dari `spawnSync` ke `execFile` async.

**Tech Stack:** TypeScript strict, pnpm workspace, vitest, Fastify, Prisma + Postgres, React + Vite, zod.

**Spec:** [`docs/superpowers/specs/2026-07-09-hanoman-overview-coverage-realtime-spec-141-design.md`](../specs/2026-07-09-hanoman-overview-coverage-realtime-spec-141-design.md)
**Objective:** [`internal/docs/operations/spec-141-overview-coverage-realtime-objective.md`](../../../internal/docs/operations/spec-141-overview-coverage-realtime-objective.md)

## Global Constraints

- **Tanpa dependency runtime baru.** Tidak ada paket baru di `package.json` mana pun. `execFile` dan `promisify` adalah `node:*` bawaan.
- **Barrel `shared/src/index.ts` bebas `node:*`.** Web mem-bundle-nya lewat Vite. `linkedSetFrom` menerima `read` **sinkron** dan tetap pure — karena itu `readFileSync` di `scan.ts` **tidak** diasinkronkan.
- **`shared/src/coverage.ts` tidak boleh diubah.** `coverageOf` unit kategori, `docStatusFor` ambang 90/60 — keduanya tetap. File itu read-only untuk plan ini.
- **DTO `ProjectView` tidak berubah.** `shared/src/entities.ts` tetap mengirim `coverage` + `docStatus` ke web; hanya sumbernya yang pindah. Tipe frontend tak tersentuh.
- **ADR-0018 sudah ada** (`internal/docs/adr/0018-coverage-nilai-turunan.md`, status `proposed`, ditulis di fase Spec dan sudah ter-link di index). Task 4 mengubah statusnya jadi `accepted` bersama migration-nya. **Jangan** membuat ADR bernomor lain.
- **Skema tidak berubah tanpa migration + ADR** (`CLAUDE.md`).
- **Update `internal/docs` yang tersentuh dalam commit yang sama** (`CLAUDE.md`). Setiap task menyertakan doc-nya di step commit.
- **Jangan pernah `POST /runs`** saat worker dev hidup — itu menjalankan run **nyata** (memory proyek). Smoke test di bawah hanya menyentuh `/projects` dan `/docs`.
- **`rm -rf` diblokir guardrail runner** (`runner/src/safety.ts:5`). Pakai `rm` / `rmdir`.
- Perintah test: `pnpm --filter ./server test`, `pnpm --filter ./src test`, `pnpm test` (semua). Satu file: `pnpm --filter ./server exec vitest run test/scan.test.ts`.
- Test memakai DB terpisah: `vitest.config.ts` menurunkan `<db>_test` dari `DATABASE_URL`. Migration baru **wajib** diterapkan ke kedua DB (Task 4 Step 4).

---

## File Structure

| File | Tanggung jawab | Task |
|---|---|---|
| `server/src/services/scan.ts` | `listRepoDocs` async (`execFile`), `scanRepoDocs` async | 1 |
| `server/test/scan.test.ts` | `await scanRepoDocs` | 1 |
| `server/src/services/project-view.ts` | Turunkan `coverage` + `docStatus` dari disk | 2 |
| `server/test/projects.route.test.ts` | Regression SPEC-141 (dua arah) | 2, 3 |
| `server/src/routes/projects.ts` | Hapus handler `scan`; (Task 4) berhenti menulis kolom | 3, 4 |
| `shared/src/api.ts`, `src/src/api/client.ts` | Hapus `paths.scan`, `scanProject` | 3 |
| `src/src/App.tsx` | Hapus `scanAll` + tombol "Scan semua" | 3 |
| `src/src/screens/DocsWorkspace.tsx` | Tombol Scan → muat ulang | 3 |
| `server/src/app.ts`, `server/test/triggers-settings.route.test.ts` | Pindahkan guard empty-JSON-body ke `toggle` | 3 |
| `server/prisma/schema.prisma` + migration | Drop dua kolom | 4 |
| `server/test/factory.ts`, `server/test/github-status-reporter.test.ts` | Berhenti menulis kolom | 4 |
| `internal/docs/adr/0018-coverage-nilai-turunan.md` | `proposed` → `accepted` | 4 |
| `internal/docs/architecture/{data-model,api-contract}.md`, `internal/docs/frontend/frontend-implementation.md` | Berhenti mendeskripsikan cache | 4 |

`server/src/services/docs.ts` **tidak berubah** — `docIndex` sudah `async` dan hanya meneruskan hasil `scanRepoDocs`.

---

## Task 1: `scanRepoDocs` berhenti memblokir event loop

Murni refactor async, tanpa perubahan perilaku. Task ini duluan supaya Task 2 boleh memanggil scan per-project tanpa menghentikan proses.

**Files:**
- Modify: `server/src/services/scan.ts:1-15` (import + `listRepoDocs`), `:35-42` (komentar + tanda tangan `scanRepoDocs`)
- Test: `server/test/scan.test.ts:5-58`

**Interfaces:**
- Produces: `listRepoDocs(repoDir: string): Promise<string[]>` dan `scanRepoDocs(repoDir: string | null): Promise<{ coverage: number; tree: DocCat[] }>` — keduanya kini async. `DocCat` tidak berubah. `listRepoDocs` tidak punya importer lain di luar `scan.ts` (sudah diperiksa), jadi tak ada call site lain yang perlu di-`await`.
- Consumes: tak ada dari task lain.

- [x] **Step 1: Ubah test agar meng-`await` (test jadi merah)**

Ganti seluruh `describe("scanRepoDocs", ...)` di `server/test/scan.test.ts` (baris 5-58) dengan:

```ts
describe("scanRepoDocs", () => {
  it("coverage counts only categories inside docsDir, minus the index itself", async () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
      "internal/docs/loose/orphan.md": "# orphan",
      "docs/plans/p.md": "# plan",
      "README.md": "# repo",
    });
    const { coverage, tree } = await scanRepoDocs(dir);
    // Yang diskor: product/prd.md (reachable) + loose/orphan.md (tidak) -> 1/2 = 50.
    // `internal/docs` sendiri hanya berisi index, yang tak pernah masuk denominator.
    expect(coverage).toBe(50);
    const byCat = Object.fromEntries(tree.map((t) => [t.cat, t]));
    expect(byCat["internal/docs/product"]!.scored).toBe(true);
    expect(byCat["internal/docs/product"]!.linked).toBe(true);
    expect(byCat["internal/docs/loose"]!.linked).toBe(false);
    expect(byCat["docs/plans"]!.scored).toBe(false);
    expect(byCat["."]!.scored).toBe(false);
  });

  it("follows a sub-index: docs reachable through adr/README.md count as linked", async () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [adr](adr/README.md)",
      "internal/docs/adr/README.md": "- [0001](0001-x.md)",
      "internal/docs/adr/0001-x.md": "# x",
    });
    expect((await scanRepoDocs(dir)).coverage).toBe(100);
  });

  it("repo without docsDir -> coverage 0, tree still lists markdown", async () => {
    const dir = makeTempRepo({ "README.md": "# r", "notes/a.md": "# a" });
    const { coverage, tree } = await scanRepoDocs(dir);
    expect(coverage).toBe(0);
    expect(tree.map((t) => t.cat).sort()).toEqual([".", "notes"]);
    expect(tree.every((t) => !t.scored)).toBe(true);
  });

  it("honors docsDir from hanoman.config.json", async () => {
    const dir = makeTempRepo({
      "hanoman.config.json": JSON.stringify({ docsDir: "spec" }),
      "spec/README.md": "- [a](a.md)",
      "spec/a.md": "# a",
      "internal/docs/x.md": "# x",
    });
    const { coverage, tree } = await scanRepoDocs(dir);
    expect(coverage).toBe(100);
    expect(tree.find((t) => t.cat === "internal/docs")!.scored).toBe(false);
  });

  it("null / missing repoDir -> empty", async () => {
    await expect(scanRepoDocs(null)).resolves.toEqual({ coverage: 0, tree: [] });
  });

  it("a directory that is not a git repo -> empty, no throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-nogit-"));
    await expect(scanRepoDocs(dir)).resolves.toEqual({ coverage: 0, tree: [] });
  });
});
```

Tambahkan import yang dibutuhkan test terakhir, tepat di bawah baris 3:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/scan.test.ts`
Expected: FAIL. `scanRepoDocs` masih sinkron, jadi `await`-nya lolos tapi test terakhir gagal — direktori non-git hari ini mengembalikan `{ coverage: 0, tree: [] }` lewat jalur `listRepoDocs` yang `status !== 0`, **kecuali** `existsSync(dir)` true sehingga ia jalan terus; yang jelas merah adalah `resolves.toEqual` pada nilai non-Promise: `expect(...).resolves` melempar `TypeError: ... is not a thenable`.

- [x] **Step 3: `listRepoDocs` async lewat `execFile`**

Ganti `server/src/services/scan.ts` baris 1-15 dengan:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { coverageOf, linkedSetFrom, zHanomanConfig } from "@hanoman/shared";

const exec = promisify(execFile);

export type DocCat = { cat: string; files: string[]; linked: boolean; root: boolean; scored: boolean };

// All markdown in the repo — tracked or new — with .gitignore honored (skips
// node_modules/.worktrees/dist for free). Posix rel paths.
//
// execFile, not spawnSync: GET /projects scans once per project, and a blocking
// fork would stall the whole server. Not a git repo -> reject -> [].
export async function listRepoDocs(repoDir: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
      { cwd: repoDir, maxBuffer: 1 << 24 });   // default 1 MB ~ 10k path
    return [...new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
  } catch { return []; }
}
```

- [x] **Step 4: `scanRepoDocs` async**

Di file yang sama, ganti blok komentar + tanda tangan (baris 35-42 pada file asli) dengan:

```ts
// ponytail: full re-scan tiap panggilan, tanpa cache. Terukur 19 ms — spawn git 18.8 ms,
// baca 48 file 0.8 ms — jadi HANYA spawn-nya yang dibuat async. `readFileSync` tetap sync
// karena `linkedSetFrom` menerima `read` sinkron dan harus tetap pure di @hanoman/shared.
// Tambah cache HEAD/mtime hanya kalau GET /projects melewati ~200 ms.
//
// Dua korpus, sengaja dipisah: `files` untuk dibrowse (semua .md repo), `corpus`
// untuk dinilai (di bawah docsDir). Kategori di luar docsDir -> scored:false.
export async function scanRepoDocs(repoDir: string | null): Promise<{ coverage: number; tree: DocCat[] }> {
  if (!repoDir || !existsSync(repoDir)) return { coverage: 0, tree: [] };
  const files = await listRepoDocs(repoDir);
```

Sisa badan fungsi (dari `const docsDir = docsDirOf(repoDir);` sampai `return { coverage, tree: [...byCat.values()] };`) **tidak berubah**. `docAbsPath`, `readDocFile`, `writeDocFile`, `deleteDocFile` juga tidak berubah.

- [x] **Step 5: Jalankan test scan, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/scan.test.ts`
Expected: PASS, 9 test (6 di `scanRepoDocs`, 3 di `doc fs ops`).

- [x] **Step 6: Jalankan test server, pastikan tak ada call site yang tertinggal**

Run: `pnpm --filter ./server test`
Expected: PASS. `docs.test.ts` dan `docs.route.test.ts` sudah `await docIndex(...)`, dan `docIndex` cuma meneruskan promise — keduanya harus hijau tanpa diubah.

Catatan: `queue-durability > honors concurrency 1` gagal bila dijalankan terisolasi tapi hijau di suite server penuh (memory proyek). Bukan regresi dari task ini.

- [x] **Step 7: Commit**

```bash
git add server/src/services/scan.ts server/test/scan.test.ts
git commit -m "refactor(server): scanRepoDocs async agar tak memblokir event loop

git ls-files pindah dari spawnSync ke execFile — terukur 96% dari biaya
blocking (18.8ms dari 19.6ms). readFileSync tetap sync karena linkedSetFrom
menerima read sinkron dan harus tetap pure di shared. Persiapan SPEC-141."
```

---

## Task 2: `toProjectView` menurunkan coverage dari disk

Di akhir task ini **bug SPEC-141 sudah hilang**. Kolomnya masih ada tapi tak pernah dibaca lagi — sengaja, supaya perbaikan dan drop skema bisa di-review terpisah.

**Files:**
- Modify: `server/src/services/project-view.ts:1-23`
- Test: `server/test/projects.route.test.ts`

**Interfaces:**
- Consumes: `scanRepoDocs(repoDir: string | null): Promise<{ coverage: number; tree: DocCat[] }>` dari Task 1. `docStatusFor(pct: number): "ok" | "drift" | "broken"` dari `../services/coverage` (re-export `@hanoman/shared`, tidak diubah).
- Produces: `toProjectView(projectId: string): Promise<ProjectView>` — tanda tangan tidak berubah; `coverage`/`docStatus` kini turunan.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/projects.route.test.ts`, tepat setelah test `"409s on a duplicate project id (not 500)"` (setelah baris 22):

```ts
  // SPEC-141: dua-duanya baca yang sama dari disk, tanpa POST /scan sama sekali.
  it("a newly created project already shows real coverage — no scan (SPEC-141)", async () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
    });
    const res = await app.inject({ method: "POST", url: "/api/projects",
      payload: { name: "auto-scan", kind: "existing", repoDir: dir } });
    expect(res.statusCode).toBe(201);
    expect(res.json().coverage).toBe(100);
    expect(res.json().docStatus).toBe("ok");
  });

  // Arah sebaliknya: nilai tersimpan yang optimistis tidak boleh menang atas disk.
  it("disk beats the stored value when docs go unlinked (SPEC-141)", async () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
      "internal/docs/loose/orphan.md": "# orphan",   // tak ter-link -> nyatanya 50%
    });
    await makeProject({ id: "p-cov", repoDir: dir });  // factory menyimpan coverage 100 / ok
    const res = await app.inject({ url: "/api/projects/p-cov" });
    expect(res.json().coverage).toBe(50);
    expect(res.json().docStatus).toBe("broken");
  });

  // Project from-scratch: tak ada repoDir untuk di-scan. Harus 0/broken, bukan crash.
  it("a project without repoDir reports 0 / broken, no crash (SPEC-141)", async () => {
    const res = await app.inject({ url: "/api/projects/p1" });   // p1 di beforeAll, repoDir null
    expect(res.statusCode).toBe(200);
    expect(res.json().coverage).toBe(0);
    expect(res.json().docStatus).toBe("broken");
  });
```

Ubah import factory di baris 4 menjadi:

```ts
import { resetDb, makeProject, makeSpec, makeRun, makeTempRepo } from "./factory";
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/projects.route.test.ts -t "SPEC-141"`
Expected: 3 FAIL.
- `"newly created"`: `coverage` `0`, `docStatus` `"broken"` — create menulis nilai hardcoded.
- `"disk beats the stored value"`: `coverage` `100`, `docStatus` `"ok"` — nilai tersimpan factory.
- `"without repoDir"`: `coverage` `100`, `docStatus` `"ok"` — nilai tersimpan factory, lagi.

- [ ] **Step 3: Turunkan di `toProjectView`**

Ganti seluruh isi `server/src/services/project-view.ts` dengan:

```ts
import { prisma } from "../db";
import { STAGES } from "./stage-machine";
import { scanRepoDocs } from "./scan";
import { docStatusFor } from "./coverage";
import type { ProjectView } from "@hanoman/shared";
const IDLE = { status: "idle", phase: null as string | null, kind: null as string | null };
export async function toProjectView(projectId: string): Promise<ProjectView> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const specs = await prisma.spec.findMany({ where: { projectId } });
  const runs = await prisma.run.findMany({ where: { projectId } });
  // Coverage adalah nilai turunan, bukan state tersimpan (ADR-0018). `p` sudah di-fetch,
  // jadi tak ada query tambahan. repoDir null / bukan git repo -> 0 -> "broken", persis
  // nilai yang dulu di-hardcode saat create.
  const { coverage } = await scanRepoDocs(p.repoDir);
  const open = specs.filter((s) => s.stage !== "done");
  const latest = runs[runs.length - 1];
  const activePhase = latest ? (latest.phases as { name: string; state: string }[]).find((f) => f.state === "active")?.name ?? null : null;
  const topStage = open.length
    ? open.map((s) => s.stage).sort((a, b) => STAGES.indexOf(b as any) - STAGES.indexOf(a as any))[0]!
    : "spec";
  return {
    id: p.id, name: p.name, desc: p.desc, kind: p.kind as any, repoDir: p.repoDir, repoUrl: p.repoUrl,
    stack: p.stack, docStatus: docStatusFor(coverage), coverage, createdAt: p.createdAt.toISOString(),
    backlog: open.length, topStage,
    run: latest ? { status: latest.status, phase: activePhase, kind: latest.kind } : IDLE,
    activity: latest ? `${latest.status} · ${latest.kind}` : "idle",
    commit: latest ? `→ ${latest.branchTo}` : "belum ada commit",
  };
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/projects.route.test.ts`
Expected: PASS, 11 test (8 lama + 3 baru). Test `"scan recomputes coverage"` masih hijau — `POST /scan` masih ada dan masih mengembalikan `toProjectView`, hanya saja angkanya kini datang dari disk.

- [ ] **Step 5: Jalankan seluruh test server**

Run: `pnpm --filter ./server test`
Expected: PASS. `makeProject` tanpa `repoDir` → `scanRepoDocs(null)` → `coverage 0` — tak ada test lama yang menegaskan `coverage` pada project tanpa repoDir, jadi tak ada yang perlu diubah.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/project-view.ts server/test/projects.route.test.ts
git commit -m "fix(server): overview membaca coverage dari disk, bukan kolom basi

toProjectView menurunkan coverage+docStatus dari scanRepoDocs(repoDir) —
sumber yang sama dengan GET /docs. Project baru langsung menampilkan angka
nyata tanpa menekan Scan; nilai tersimpan tak bisa lagi menang atas disk.
SPEC-141, ADR-0018."
```

---

## Task 3: Hapus `POST /scan` dan tombol Scan

Endpoint dan tombolnya kini tak menyegarkan apa pun. Yang halus: test `POST /scan` adalah **satu-satunya** test yang mengirim `content-type: application/json` tanpa body, jadi ia menjaga parser di `app.ts:24-29`. Guard itu harus pindah, bukan hilang.

**Files:**
- Modify: `server/src/routes/projects.ts:1-6` (import), `:39-45` (hapus handler)
- Modify: `server/src/app.ts:19`
- Modify: `shared/src/api.ts:5`
- Modify: `src/src/api/client.ts:15`
- Modify: `src/src/App.tsx:262`, `:322-331`, `:445`, `:453-456`
- Modify: `src/src/screens/DocsWorkspace.tsx:181-185`, `:200-203`, `:211-213`
- Test: `server/test/docs.route.test.ts:41-45` (hapus), `server/test/projects.route.test.ts:23-28` (hapus), `server/test/triggers-settings.route.test.ts:19-22` (terima guard)

**Interfaces:**
- Consumes: `toProjectView` (Task 2). `reloadIndex(): Promise<void>` — sudah ada di `DocsWorkspace.tsx`, tidak berubah.
- Produces: tak ada simbol baru. `paths.scan` dan `api.scanProject` **lenyap** — tak boleh dirujuk task mana pun sesudah ini.

- [ ] **Step 1: Pindahkan guard empty-JSON-body ke `toggle` (test dulu)**

Ganti test `"toggles a trigger"` di `server/test/triggers-settings.route.test.ts` (baris 19-22) dengan:

```ts
  // Body-less POST dengan json content-type: mereproduksi FST_ERR_CTP_EMPTY_JSON_BODY.
  // Dulu dijaga test POST /scan, yang dihapus bersama endpoint-nya (SPEC-141).
  it("toggles a trigger (body-less POST with json content-type)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/triggers/t2/toggle",
      headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true); // t2 seeded false
  });
```

- [ ] **Step 2: Jalankan, pastikan lulus (guard-nya memang sudah ada)**

Run: `pnpm --filter ./server exec vitest run test/triggers-settings.route.test.ts`
Expected: PASS. Test ini hijau **sekarang** karena parser di `app.ts` sudah benar — gunanya adalah menahannya tetap benar setelah test `scan` dibuang. Untuk membuktikannya menangkap regresi, komentari sementara baris `if (!body) return done(null, undefined);` di `app.ts:26` → test harus FAIL dengan `FST_ERR_CTP_EMPTY_JSON_BODY`. Kembalikan barisnya.

- [ ] **Step 3: Ganti kedua test `scan` — yang satu dihapus, yang satu jadi penjaga 404**

Hapus dari `server/test/docs.route.test.ts` baris 41-45 (blok `it("POST /scan recomputes coverage from disk", ...)`) — seluruhnya, termasuk baris `it(` dan `});`.

Di `server/test/projects.route.test.ts`, ganti blok `it("scan recomputes coverage (body-less POST with json content-type)", ...)` (baris 23-28) dengan penjaga bahwa endpoint-nya benar-benar tiada:

```ts
  it("POST /scan is gone (SPEC-141)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/scan" });
    expect(res.statusCode).toBe(404);
  });
```

- [ ] **Step 4: Hapus handler `scan` dan perbarui komentar `app.ts`**

Ganti baris 1-6 `server/src/routes/projects.ts` dengan:

```ts
import type { FastifyInstance } from "fastify";
import { zCreateProject } from "@hanoman/shared";
import { prisma } from "../db";
import { toProjectView } from "../services/project-view";
```

Hapus seluruh handler `app.post("/projects/:id/scan", ...)` (baris 39-45), sehingga fungsi berakhir tepat setelah handler `DELETE`.

Di `server/src/app.ts` ganti baris 19:

```ts
  // Body-less POSTs (toggle) may still carry a JSON
```

- [ ] **Step 5: Jalankan test server, pastikan lulus**

Run: `pnpm --filter ./server test`
Expected: PASS, `projects.route.test.ts` tetap 11 test — `"scan recomputes coverage"` berganti jadi `"POST /scan is gone"`. Kalau yang terakhir gagal dengan `200`, handler-nya belum benar-benar terhapus di Step 4.

- [ ] **Step 6: Buang `scan` dari kontrak klien**

Di `shared/src/api.ts`, hapus baris 5 seluruhnya:

```ts
  scan: (id: string) => `${API}/projects/${id}/scan`,
```

Di `src/src/api/client.ts`, hapus baris 15 seluruhnya:

```ts
  scanProject: (id: string) => j<ProjectView>(paths.scan(id), { method: "POST" }),
```

- [ ] **Step 7: Hapus "Scan semua" dari `App.tsx`**

Hapus baris 262:

```ts
  const [scanning, setScanning] = React.useState(false);
```

Hapus seluruh fungsi `scanAll` (baris 322-331), yaitu blok dari `async function scanAll() {` sampai `}` penutupnya.

Ganti baris 445 (header Overview) — buang prop `actions` sepenuhnya:

```tsx
      <Shell active="overview" title="Overview" breadcrumb="nafanesia.id · ringkasan workspace" onNavigate={setSection}>
```

Ganti blok `actions` header Projects (baris 453-456) dengan:

```tsx
        actions={<Button size="sm" leftIcon="plus" onClick={() => setModal("project")}>Project baru</Button>}>
```

- [ ] **Step 8: Tombol Docs workspace jadi muat ulang**

Di `src/src/screens/DocsWorkspace.tsx`, ganti `rescan` (baris 181-185) dengan:

```ts
  // GET /docs sudah realtime; tombolnya cuma memuat ulang, kalau-kalau file berubah
  // dari luar dashboard. Tak ada lagi POST /scan (SPEC-141).
  async function rescan() {
    if (scanning) return;
    setScanning(true);
    try { await reloadIndex(); } finally { setScanning(false); }
  }
```

Ganti label tombol (baris 201-202) dengan:

```tsx
              <Button size="sm" variant="ghost" leftIcon={scanning ? "loader" : "radar"} onClick={rescan} disabled={scanning}>
                {scanning ? "…" : "Muat ulang"}
```

Ganti empty-state (baris 211-213) dengan:

```tsx
              : tree.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Belum ada docs"
                  hint="Belum ada Markdown di repo ini."
                  action={rescan} actionLabel="Muat ulang" actionIcon="radar" />
```

- [ ] **Step 9: Test web + typecheck**

Run: `pnpm --filter ./src test && pnpm -r typecheck`
Expected: PASS, keluar 0. Kalau typecheck mengeluh `Property 'scan' does not exist on type ...` atau `scanProject`, berarti ada call site tersisa — cari dengan `grep -rn "scanProject\|paths.scan" src shared server`.

- [ ] **Step 10: Commit**

```bash
git add server/src/routes/projects.ts server/src/app.ts shared/src/api.ts \
        src/src/api/client.ts src/src/App.tsx src/src/screens/DocsWorkspace.tsx \
        server/test/docs.route.test.ts server/test/projects.route.test.ts \
        server/test/triggers-settings.route.test.ts
git commit -m "refactor: hapus POST /scan dan tombol Scan semua

Endpoint tak menyegarkan apa pun lagi sejak coverage jadi turunan. Tombol
Docs workspace menyusut jadi muat ulang. Guard empty-JSON-body pindah ke
test toggle — dulu POST /scan satu-satunya yang menjaganya. SPEC-141."
```

---

## Task 4: Drop kolom `coverage` + `docStatus`

**Files:**
- Modify: `server/prisma/schema.prisma:20-21`
- Create: `server/prisma/migrations/<timestamp>_drop_project_coverage/migration.sql`
- Modify: `server/src/routes/projects.ts:25-27` (create berhenti menulis kolom)
- Modify: `server/test/factory.ts:34`
- Modify: `server/test/github-status-reporter.test.ts:17`
- Modify: `internal/docs/adr/0018-coverage-nilai-turunan.md:3`
- Modify: `internal/docs/architecture/data-model.md:7`, `:33`
- Modify: `internal/docs/architecture/api-contract.md:10`, `:51-53`
- Modify: `internal/docs/frontend/frontend-implementation.md:5`

**Interfaces:**
- Consumes: `toProjectView` (Task 2) — sudah tidak membaca kolomnya, jadi drop ini aman.
- Produces: `model Project` tanpa `docStatus`/`coverage`. `ProjectView` DTO **tetap** punya keduanya.

- [ ] **Step 1: Berhenti menulis kolom saat create**

Ganti `server/src/routes/projects.ts` baris 25-27 dengan:

```ts
    await prisma.project.create({ data: {
      id, name: id, desc: b.desc || "project baru", kind: b.kind, repoDir: b.repoDir ?? null,
      stack: "" } });
```

- [ ] **Step 2: Berhenti menulis kolom di test factory**

Ganti `server/test/factory.ts` baris 32-34 dengan:

```ts
  return prisma.project.create({ data: {
    id: "p1", name: "p1", desc: "test project", kind: "existing",
    stack: "", ...over } });
```

Di `server/test/github-status-reporter.test.ts` baris 17, buang `docStatus: "ok", coverage: 0,` sehingga menjadi:

```ts
      create: { id: "rpt-proj", name: "rpt", desc: "", kind: "app", installationId: 77 },
```

- [ ] **Step 3: Buang kolom dari skema**

Di `server/prisma/schema.prisma`, hapus dua baris ini dari `model Project` (baris 20-21):

```prisma
  docStatus String
  coverage  Int
```

- [ ] **Step 4: Bikin migration, terapkan ke DB nyata dan DB test**

Run:

```bash
pnpm --filter ./server exec prisma migrate dev --name drop_project_coverage
```

Lalu sisipkan komentar di baris pertama `server/prisma/migrations/<timestamp>_drop_project_coverage/migration.sql` sehingga isinya:

```sql
-- SPEC-141 / ADR-0018: coverage is derived from the filesystem at read time, not stored.
ALTER TABLE "Project" DROP COLUMN "docStatus",
                      DROP COLUMN "coverage";
```

`vitest.config.ts` menurunkan DB test `<db>_test` dari `DATABASE_URL`; ia **tidak** ikut termigrasi oleh perintah di atas. Terapkan juga ke sana:

```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -E 's#/([^/?]+)(\?|$)#/\1_test\2#')" \
  pnpm --filter ./server exec prisma migrate deploy
```

Expected: `All migrations have been successfully applied.` pada keduanya.

Catatan: Postgres berjalan di Docker (memory proyek). Kalau `prisma` tak bisa connect, pastikan `docker compose up -d --wait` sudah jalan; `psql -d hanoman` lewat unix socket memang gagal dan itu bukan tanda DB mati.

- [ ] **Step 5: Jalankan seluruh test server**

Run: `pnpm --filter ./server test`
Expected: PASS. Kalau ada `Unknown argument 'coverage'` dari Prisma, berarti masih ada penulis kolom yang tertinggal — cari dengan `grep -rn "docStatus:\|coverage:" server/src server/test`.

- [ ] **Step 6: ADR-0018 jadi `accepted`**

Di `internal/docs/adr/0018-coverage-nilai-turunan.md`, ganti baris 3 dengan:

```markdown
**Status:** accepted · **Date:** 2026-07-09 · **Spec:** SPEC-141
```

- [ ] **Step 7: `data-model.md` berhenti mendeskripsikan kolom**

Ganti baris 5-8 (blok `## Project`), dari:

```markdown
## Project
- `id` (slug), `name`, `desc`, `kind` ("from-scratch" | "existing"), `repoDir`/`repoUrl`
- `docStatus` ("ok" | "drift" | "broken"), `coverage` (0–100)
- `createdAt`
```

menjadi:

```markdown
## Project
- `id` (slug), `name`, `desc`, `kind` ("from-scratch" | "existing"), `repoDir`/`repoUrl`
- `createdAt`
- `docStatus` ("ok" | "drift" | "broken") + `coverage` (0–100) **bukan kolom** — diturunkan dari disk tiap `toProjectView` (ADR-0018).
```

Ganti baris 33 dengan:

```markdown
- coverage = % direktori yang seluruh Markdown-nya reachable dari index. **Tidak dipersist**: `toProjectView` menghitungnya dari `Project.repoDir` setiap kali project dibaca (ADR-0018).
```

- [ ] **Step 8: `api-contract.md` kehilangan route `scan`**

Hapus baris 10 seluruhnya:

```
POST /projects/:id/scan   # re-scan docs SoT
```

Ganti blok kutipan baris 51-56 dengan:

```markdown
> Docs dibaca/ditulis **live dari `Project.repoDir`** (tanpa salinan DB — ADR-0011). Korpus **browse** =
> semua `**/*.md` via `git ls-files`. `GET /docs` re-scan tiap panggilan, begitu pula `GET /projects`
> yang menurunkan `coverage`/`docStatus` per project (ADR-0018 — tak ada cache, tak ada `POST /scan`).
> Korpus **skor** = hanya file di bawah `docsDir` (default `internal/docs`) dikurangi index root;
> kategori di luarnya bertanda `scored: false` dan tidak dinilai. SoT coverage = % kategori berskor
> yang seluruh Markdown-nya **transitif reachable** dari `docsDir/README.md` (ADR-0013).
```

- [ ] **Step 9: `frontend-implementation.md` berhenti menjanjikan tombol Scan**

Di baris 5, ganti frasa `tombol **Scan** per project menyegarkan coverage, **Hapus** menghapus file asli` dengan:

```
tombol **Muat ulang** membaca ulang tree, **Hapus** menghapus file asli
```

- [ ] **Step 10: Guardrail atas repo sendiri**

Run: `node cli/dist/hanoman.js docs verify --json`
Expected: `{"ok":true,"coverage":100,"violations":[]}`. Kalau `cli/dist` belum ada: `pnpm --filter ./cli build` dulu.

- [ ] **Step 11: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations \
        server/src/routes/projects.ts server/test/factory.ts \
        server/test/github-status-reporter.test.ts \
        internal/docs/adr/0018-coverage-nilai-turunan.md \
        internal/docs/architecture/data-model.md \
        internal/docs/architecture/api-contract.md \
        internal/docs/frontend/frontend-implementation.md
git commit -m "feat(server)!: drop kolom Project.coverage + docStatus

Nilai turunan tidak disimpan (ADR-0018, melanjutkan ADR-0011). Migration
drop_project_coverage; create berhenti menulis nilai hardcoded 0/broken.
Docs SoT menyusul: data-model, api-contract, frontend-implementation."
```

---

## Task 5: Verifikasi menyeluruh

**Files:** tidak ada perubahan kode. Task ini gerbang, bukan deliverable.

- [ ] **Step 1: Seluruh test workspace**

Run: `pnpm test`
Expected: PASS. `queue-durability > honors concurrency 1` bisa gagal bila dijalankan terisolasi, tapi hijau di suite penuh (memory proyek) — bukan regresi dari plan ini.

- [ ] **Step 2: Typecheck**

Run: `pnpm -r typecheck`
Expected: keluar 0, tanpa error.

- [ ] **Step 3: Smoke API nyata (wajib per CLAUDE.md)**

Server mendengarkan di `PORT ?? 8787`, semua route berprefiks `/api`. **Jangan sentuh `/runs`** — worker dev yang hidup akan menjalankan run nyata.

```bash
pnpm --filter ./server exec tsx src/server.ts & SERVER=$!
for i in $(seq 1 20); do curl -sf localhost:8787/api/health >/dev/null 2>&1 && break; sleep 0.5; done

# 1. project baru langsung punya coverage nyata, tanpa scan
curl -s -XPOST localhost:8787/api/projects -H 'content-type: application/json' \
  -d "{\"name\":\"spec141-smoke\",\"kind\":\"existing\",\"repoDir\":\"$PWD\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("create:",j.coverage,j.docStatus)})'

# 2. doc tak ter-link -> angka turun pada pembacaan berikutnya, tetap tanpa scan
mkdir -p internal/docs/scratch141 && printf '# probe\n' > internal/docs/scratch141/probe.md
curl -s localhost:8787/api/projects/spec141-smoke \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("after orphan:",j.coverage,j.docStatus)})'
rm internal/docs/scratch141/probe.md && rmdir internal/docs/scratch141

# 3. endpoint scan sudah tiada
curl -s -o /dev/null -w "scan: %{http_code}\n" -XPOST localhost:8787/api/projects/spec141-smoke/scan

curl -s -o /dev/null -XDELETE localhost:8787/api/projects/spec141-smoke
kill $SERVER
```

Expected:
```
create: 100 ok
after orphan: 92 ok
scan: 404
```
`92` adalah angka repo ini dengan satu kategori tak ter-link tambahan (16 kategori berskor); yang penting ia **turun dari 100 tanpa scan** — itulah bug yang diperbaiki. `docStatus` tetap `ok` karena 92 ≥ 90.

- [ ] **Step 4: Pastikan tak ada sisa `scan` di kode**

Run: `grep -rn "scanProject\|paths\.scan\|projects/:id/scan" src shared server cli --include='*.ts' --include='*.tsx'`
Expected: tanpa hasil (exit 1).

- [ ] **Step 5: Centang checklist plan ini**

Ubah setiap `- [ ]` yang sudah selesai menjadi `- [x]` di file ini, lalu commit:

```bash
git add docs/superpowers/plans/2026-07-09-hanoman-overview-coverage-realtime.md
git commit -m "docs: tandai plan overview coverage realtime selesai"
```
