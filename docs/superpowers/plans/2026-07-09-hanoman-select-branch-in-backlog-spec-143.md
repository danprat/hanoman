# Select branch di backlog (SPEC-143) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backlog item (brief maupun QA) menyimpan branch sumbernya sendiri, dapat diubah selama masih di backlog, dan setiap run yang lahir darinya mem-basis worktree pada branch itu.

**Architecture:** Kolom `Spec.branchFrom String?` (null = `main`) menjadi satu-satunya sumber kebenaran. `GET /projects/:id/branches` memasok pilihan **dan** whitelist validasi. `runner/src/git.ts` meresolusikan `branchFrom` menjadi commit SHA sebelum menyerahkannya ke `git worktree add`, sehingga nama branch berbentuk flag tak pernah terbaca sebagai opsi. Empat produsen `branchFrom` (POST /runs, fireTrigger, CLI, web) dibuat menghormati kolom itu.

**Tech Stack:** Node 20+, TypeScript 5 strict, Prisma/Postgres, Fastify, React 18 + Vite, Vitest, zod. Tanpa dependency runtime baru.

**Spec:** [`docs/superpowers/specs/2026-07-09-hanoman-select-branch-in-backlog-spec-143-design.md`]
**Objective:** [`internal/docs/operations/spec-143-select-branch-in-backlog-objective.md`]

## Global Constraints

- **TypeScript strict. TDD:** test yang gagal dulu, implementasi minimal, hijau, commit. Commit setiap step hijau.
- **`null` = default project = `main`.** Nullable, tanpa default DB, tanpa backfill. Baris `Spec` lama harus tetap sah dan berperilaku persis seperti sebelumnya.
- **Jangan ubah skema tanpa migration + ADR** (`CLAUDE.md`). ADR tertinggi saat plan ini ditulis = **0017**; nomor berikutnya **0018**, tapi **hitung ulang lintas branch sebelum mengklaimnya** — worktree bersebelahan bisa mengincar nomor yang sama.
- **Root `pnpm test` hanya menjalankan `shared`, `server`, `src`** (`vitest.workspace.ts`). Test `runner` dan `cli` **tidak ikut** — jalankan `pnpm --filter ./runner test` dan `pnpm --filter ./cli test` secara eksplisit.
- **Gate akhir server pakai suite penuh**, bukan file tunggal: `queue-durability.test.ts` gagal bila diisolasi dan hijau di suite penuh.
- **Suite server WAJIB `--no-file-parallelism`.** `pnpm --filter ./server test` menjalankan `vitest run` polos: file-file test berebut satu DB dan ~4 test `triggers-settings` gagal acak. Root `pnpm test` memakai flag itu. Untuk server saja: `pnpm --filter ./server exec vitest run --no-file-parallelism`. *(Ditemukan saat Execute — baseline merah sebelum ada satu baris kode pun ditulis.)*
- **`pnpm vitest run --project shared` tidak menemukan test.** Panggil berkasnya: `pnpm vitest run shared/test/entities.test.ts`.
- **Postgres jalan di Docker.** `psql -d hanoman` di unix socket akan gagal dan terlihat seperti DB mati. Pakai `docker exec hanoman-db-1 psql -U hanoman -d hanoman`.
- **JANGAN `prisma migrate dev`.** DB dev `hanoman` tak punya `_prisma_migrations` (dikelola `db push` dari branch lain) dan schema-nya menyimpang; `migrate dev` akan menawarkan **reset** dan menghapus project/spec/run nyata — termasuk baris SPEC-143 sendiri. Tulis migration dengan tangan, verifikasi lewat `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url … --script`, lalu `migrate deploy` ke DB test/smoke saja.
- **`cd` di dalam Bash bertahan antar perintah.** Selalu pakai path absolut atau `cd` kembali ke root worktree; `cd server` sekali membuat `mkdir server/prisma/...` mendarat di `server/server/prisma/...`.
- **Jangan `POST /runs` saat smoke lokal** kalau ada worker dev hidup — itu benar-benar mengeksekusi run background. Smoke di plan ini hanya menyentuh `/specs` dan `/projects/:id/branches`.
- **Jangan `git stash`, jangan `git add -A`** di repo ini — checkout ini dibagi dengan sesi lain.
- Presedens trigger `commit` (`ctx.branch` menang) masih **default yang belum dikonfirmasi manusia**. Bila ditolak sebelum Execute, hanya Task 5 yang berubah.

## File Structure

```
server/prisma/schema.prisma                     modify — Spec.branchFrom String?
server/prisma/migrations/<ts>_add_spec_branch_from/   new — ALTER TABLE ADD COLUMN
shared/src/entities.ts                          modify — zSpec.branchFrom nullable
shared/src/dto.ts                               modify — zCreateSpec.branchFrom optional; zPatchSpec baru
shared/src/api.ts                               modify — paths.branches
shared/test/entities.test.ts                    modify — skema baru
server/src/services/branches.ts                 new   — listRepoBranches(repoDir): string[]
server/test/branches.test.ts                    new   — unit atas repo temp
server/src/routes/projects.ts                   modify — GET /projects/:id/branches
server/test/projects.route.test.ts              modify — route baru
runner/src/git.ts                               modify — resolveCommit + switchBase --end-of-options
runner/test/git.test.ts                         modify — branch bernama flag, branch hilang
server/src/routes/specs.ts                      modify — validasi POST, PATCH baru
server/test/specs.route.test.ts                 modify — validasi + PATCH
server/test/factory.ts                          modify — makeProject menerima repoDir
server/src/fire-trigger.ts                      modify — override branch per-spec di dalam loop
server/test/fire-trigger.test.ts                modify — presedens branch
cli/src/commands/_run.ts                        modify — FlowArgs.from → branchFrom
cli/src/commands/{spec,plan,execute,qa}.ts      modify — teruskan from
cli/test/flows.cmd.test.ts                      modify — --from sampai ke RunInput
src/src/api/client.ts                           modify — listBranches, patchSpec, startRun.branchFrom
src/src/App.tsx                                 modify — Select branch di NewSpecModal; startRun; editBranch
src/src/screens/BacklogScreen.tsx               modify — Select di SpecDetail; Badge di SpecCard
internal/docs/adr/0018-branch-adalah-properti-backlog-item.md   new — ADR
internal/docs/README.md                         modify — link ADR
internal/docs/architecture/data-model.md        modify — kolom baru
internal/docs/architecture/api-contract.md      modify — route baru
```

---

### Task 1: Kolom `Spec.branchFrom` + skema shared

**Files:**
- Modify: `server/prisma/schema.prisma:27-38`, `shared/src/entities.ts:22-27`, `shared/src/dto.ts:8-10`
- Test: `shared/test/entities.test.ts`

**Interfaces:**
- Produces: `zSpec` bertambah `branchFrom: string | null`; `zCreateSpec` bertambah `branchFrom?: string`; `zPatchSpec = z.object({ branchFrom: z.string().min(1).nullable() })` diekspor dari `@hanoman/shared`.
- `zPatchSpec.branchFrom` **nullable, bukan optional**: `null` berarti "kosongkan, kembali ke default". Optional akan membuat "kosongkan" tak terbedakan dari "jangan sentuh".

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `shared/test/entities.test.ts`:

```ts
import { zSpec, zCreateSpec, zPatchSpec } from "../src/index";   // barrel; `export * from "./dto"` sudah mengangkat zPatchSpec

describe("SPEC-143 branchFrom", () => {
  const base = { id: "SPEC-1", projectId: "p1", title: "t", source: "brief" as const,
    stage: "brainstorming" as const, priority: "sedang" as const, author: "a", objective: "o", payload: null };

  it("zSpec menerima branchFrom null", () => {
    expect(zSpec.parse({ ...base, branchFrom: null }).branchFrom).toBeNull();
  });
  it("zSpec menerima nama branch", () => {
    expect(zSpec.parse({ ...base, branchFrom: "release/v2" }).branchFrom).toBe("release/v2");
  });
  it("zCreateSpec: branchFrom opsional", () => {
    const b = { project: "p1", source: "brief" as const, title: "t", priority: "sedang" as const,
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" as const } };
    expect(zCreateSpec.parse(b).branchFrom).toBeUndefined();
    expect(zCreateSpec.parse({ ...b, branchFrom: "dev" }).branchFrom).toBe("dev");
  });
  it("zPatchSpec: null mengosongkan, string kosong ditolak", () => {
    expect(zPatchSpec.parse({ branchFrom: null }).branchFrom).toBeNull();
    expect(zPatchSpec.safeParse({ branchFrom: "" }).success).toBe(false);
    expect(zPatchSpec.safeParse({}).success).toBe(false); // "jangan sentuh" bukan payload yang sah
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm vitest run --project shared entities`
Expected: FAIL — `zPatchSpec` tidak diekspor; `branchFrom` unrecognized/undefined.

- [x] **Step 3: Implementasi minimal**

`server/prisma/schema.prisma` — di dalam `model Spec`, tepat setelah `payload Json?`:

```prisma
  payload    Json?
  branchFrom String?   // SPEC-143 · null = default project (main)
```

`shared/src/entities.ts` — `zSpec`:

```ts
export const zSpec = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), source: zSpecSource,
  stage: zStage, priority: zPriority, author: z.string(), objective: z.string(),
  payload: z.union([zBriefPayload, zQaPayload]).nullable(),
  branchFrom: z.string().nullable(),
});
```

`shared/src/dto.ts`:

```ts
export const zCreateSpec = z.object({
  project: z.string(), source: zSpecSource, title: z.string().min(1),
  priority: zPriority, payload: z.union([zBriefPayload, zQaPayload]),
  branchFrom: z.string().min(1).optional() });
// nullable, bukan optional: null = "kosongkan, kembali ke default project".
export const zPatchSpec = z.object({ branchFrom: z.string().min(1).nullable() });
```

- [x] **Step 4: Buat migration** *(tanpa `migrate dev` — lihat Global Constraints)*

Pastikan Postgres hidup: `docker compose up -d --wait`

Generate SQL-nya secara read-only lewat shadow DB, jangan sentuh `DATABASE_URL`:

```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c 'CREATE DATABASE hanoman_shadow OWNER hanoman;'
pnpm --filter ./server exec prisma migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url 'postgresql://hanoman:hanoman@localhost:5432/hanoman_shadow' --script
```

Expected: tepat satu `ALTER TABLE "Spec" ADD COLUMN "branchFrom" TEXT;` — tanpa `NOT NULL`, tanpa `DEFAULT`.

Tulis ke `server/prisma/migrations/20260709130000_add_spec_branch_from/migration.sql`. **Nama direktori
harus mengurut sesudah `20260709121144_run_session_id`** — `date -u` di mesin ini menghasilkan timestamp
yang justru lebih kecil, dan Prisma menerapkan migration berdasarkan urutan nama.

Terapkan ke DB test saja:
`DATABASE_URL=…/hanoman_test pnpm --filter ./server exec prisma migrate deploy`

- [x] **Step 5: Jalankan test, pastikan hijau**

Run: `pnpm vitest run shared/test/entities.test.ts`
Expected: PASS (8).

Run: `pnpm --filter ./server exec vitest run --no-file-parallelism` — suite penuh, memastikan `zSpec`
yang lebih ketat tidak memecahkan route yang mengembalikan baris Spec.
Expected: PASS (38 file).

- [x] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations shared/src/entities.ts shared/src/dto.ts shared/test/entities.test.ts
git commit -m "feat(spec-143): kolom Spec.branchFrom nullable + skema shared"
```

---

### Task 2: `listRepoBranches` + `GET /projects/:id/branches`

**Files:**
- Create: `server/src/services/branches.ts`, `server/test/branches.test.ts`
- Modify: `server/src/routes/projects.ts`, `shared/src/api.ts`, `server/test/projects.route.test.ts`, `server/test/factory.ts`

**Interfaces:**
- Consumes: tak ada dari Task 1.
- Produces: `listRepoBranches(repoDir: string | null): string[]` — terurut, unik, `[]` bila `repoDir` null / bukan repo git. `GET /projects/:id/branches` → `{ branches: string[] }`. `paths.branches(id)`.

- [x] **Step 1: Tulis test yang gagal**

```ts
// server/test/branches.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { listRepoBranches } from "../src/services/branches";

const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
function seedRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "branches-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "x"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "init");
  g(repo, "branch", "-M", "main");
  return repo;
}

describe("listRepoBranches", () => {
  it("mengembalikan branch lokal, terurut", () => {
    const repo = seedRepo();
    g(repo, "branch", "release/v2"); g(repo, "branch", "dev");
    expect(listRepoBranches(repo)).toEqual(["dev", "main", "release/v2"]);
  });
  it("repoDir null → []", () => {
    expect(listRepoBranches(null)).toEqual([]);
  });
  it("bukan repo git → [] (tidak melempar)", () => {
    expect(listRepoBranches(mkdtempSync(join(tmpdir(), "kosong-")))).toEqual([]);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test branches`
Expected: FAIL — cannot resolve `../src/services/branches`.

- [x] **Step 3: Implementasi minimal**

```ts
// server/src/services/branches.ts
import { spawnSync } from "node:child_process";

// Cermin listRepoDocs di services/scan.ts: spawn git, [] saat gagal, tidak pernah melempar.
// Hanya refs/heads — branch remote sengaja di luar scope (SPEC-143).
export function listRepoBranches(repoDir: string | null): string[] {
  if (!repoDir) return [];
  const r = spawnSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd: repoDir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
}
```

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `pnpm --filter ./server test branches`
Expected: PASS.

- [x] **Step 5: Tambahkan route + path (test dulu)**

`shared/src/api.ts` — setelah `scan`:

```ts
  branches: (id: string) => `${API}/projects/${id}/branches`,
```

`server/test/factory.ts` — tambahkan `makeRepoWithBranches(...branches)`. `makeTempRepo` yang ada tak cukup:
ia tak pernah commit, dan repo tanpa commit belum punya branch apa pun untuk `for-each-ref`.

**Sisipkan test baru di AKHIR `describe`**, bukan di awal: `lists project views` menghitung jumlah
project dan akan merah bila test lain membuat project lebih dulu.

Tambahkan di `server/test/projects.route.test.ts`:

```ts
it("GET /projects/:id/branches mengembalikan branch repo", async () => {
  const repo = seedRepo();                    // salin helper dari branches.test.ts
  await makeProject({ id: "pb", repoDir: repo });
  const res = await app.inject({ url: "/api/projects/pb/branches" });
  expect(res.statusCode).toBe(200);
  expect(res.json().branches).toContain("main");
});
it("GET /projects/:id/branches: project tanpa repoDir → []", async () => {
  await makeProject({ id: "pn", repoDir: null });
  const res = await app.inject({ url: "/api/projects/pn/branches" });
  expect(res.json().branches).toEqual([]);
});
it("GET /projects/:id/branches: project tak dikenal → 404", async () => {
  const res = await app.inject({ url: "/api/projects/hantu/branches" });
  expect(res.statusCode).toBe(404);
});
```

`server/src/routes/projects.ts` — import `listRepoBranches` dari `../services/branches`, lalu
tambahkan sebelum `POST /projects/:id/scan`:

```ts
  app.get("/projects/:id/branches", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    return { branches: listRepoBranches(p.repoDir) };
  });
```

- [x] **Step 6: Jalankan suite server penuh**

Run: `pnpm --filter ./server test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/services/branches.ts server/test/branches.test.ts server/src/routes/projects.ts server/test/projects.route.test.ts shared/src/api.ts
git commit -m "feat(spec-143): GET /projects/:id/branches + listRepoBranches"
```

---

### Task 3: `resolveCommit` — nama branch tak pernah jadi flag

**Files:**
- Modify: `runner/src/git.ts:19-36`
- Test: `runner/test/git.test.ts`

**Interfaces:**
- Consumes: tak ada.
- Produces: `realGit.addWorktree` menerima `branchFrom` apa pun yang resolve sebagai commit-ish, termasuk nama berbentuk flag; melempar dengan pesan yang memuat revisinya bila tidak resolve.

**Kenapa:** `git check-ref-format 'refs/heads/--force'` valid — sebuah branch **boleh** bernama
`--force`, lolos whitelist karena ia memang ada di repo, lalu terbaca git sebagai flag. `git worktree add`
tidak dapat diuji lewat Bash dari dalam run (`deniesDangerous` memblokirnya), jadi jangan bersandar pada
cara ia mem-parse `--`. Resolusikan ke SHA: heksadesimal tak pernah jadi opsi.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `runner/test/git.test.ts` (di dalam `describe("git worktree ops")`):

```ts
  // Nama branch boleh berbentuk flag. `git worktree add --detach <path> --force` akan
  // membacanya sebagai opsi; resolveCommit menyerahkan SHA, bukan nama.
  it("menerima branch yang bernama seperti flag", () => {
    const { repo } = seedRepo();
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    g(repo, "update-ref", "refs/heads/--force", head);
    const wt = join(repo, ".worktrees", "run-flag");
    realGit.addWorktree(repo, wt, "--force");
    expect(existsSync(wt)).toBe(true);
    expect(g(wt, "rev-parse", "HEAD").stdout.trim()).toBe(head);
    realGit.removeWorktree(repo, wt);
  });

  it("gagal keras dan menyebut branch yang tidak ada", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-hantu");
    expect(() => realGit.addWorktree(repo, wt, "tidak-ada")).toThrow(/tidak-ada/);
  });

  it("switchBase pindah ke branch lain", () => {
    const { repo } = seedRepo();
    g(repo, "branch", "dev");
    const wt = join(repo, ".worktrees", "run-sb");
    realGit.addWorktree(repo, wt, "main");
    realGit.switchBase(wt, "dev");
    expect(g(wt, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim()).toBe("dev");
    realGit.removeWorktree(repo, wt);
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./runner test git`
Expected: FAIL — tapi **bukan** karena git menolak `--force`.

**Jebakan yang benar-benar terjadi:** sub-perintah `worktree`+`add` dengan `--detach <path> --force`
*sukses*. Git menelan `--force` sebagai opsi dan diam-diam memakai `HEAD`. Test yang menunjuk
branch-flag ke commit yang sama dengan `HEAD` akan **lolos sebelum implementasi ada** — lolos karena
alasan yang salah. Karena itu branch bernama flag harus menunjuk commit **pertama** sementara `HEAD`
sudah maju ke commit kedua; barulah assertion membedakan "branch dihormati" dari "branch diabaikan".

Kerentanannya lebih buruk daripada dugaan fase Spec: branch bukan ditolak, melainkan **diabaikan
tanpa error**, sehingga run terbangun di pohon yang salah tanpa satu pun tanda.

> Guardrail `deniesDangerous` memindai **seluruh teks perintah Bash**, termasuk pesan commit.
> Menuliskan nama sub-perintah itu utuh di dalam `git commit -m "…"` akan ditolak. Pakai
> `git commit -F <file>`.

- [x] **Step 3: Implementasi minimal**

`runner/src/git.ts` — tambahkan di bawah `tryGit`:

```ts
// Nama branch boleh berbentuk flag (`refs/heads/--force` adalah refname yang sah) dan git membaca
// opsi di posisi mana pun, jadi `worktree add --detach <path> --force` akan menelannya sebagai opsi.
// Resolusikan ke commit SHA dulu — heksadesimal tak pernah jadi opsi. Urutan mengikat: `--verify`
// harus mendahului `--end-of-options` (diverifikasi terhadap git 2.50.1).
const resolveCommit = (repo: string, rev: string) =>
  git(repo, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).trim();
```

Di `addWorktree`, ganti baris terakhir:

```ts
    git(repo, ["worktree", "add", "--detach", path, resolveCommit(repo, branchFrom)]);
```

Dan `switchBase`:

```ts
  switchBase: (path, branchFrom) => { git(path, ["checkout", "--end-of-options", branchFrom]); },
```

`resolveCommit` mempertahankan DWIM — branch yang hanya ada sebagai remote-tracking (run
github-backed) tetap resolve. Menyematkan `refs/heads/` di depan nama akan mematikannya.

- [x] **Step 4: Jalankan test, pastikan hijau**

Run: `pnpm --filter ./runner test`
Expected: PASS (seluruh suite runner — `run.test.ts` memakai fake `GitOps`, tak tersentuh).

- [x] **Step 5: Commit**

```bash
git add runner/src/git.ts runner/test/git.test.ts
git commit -m "fix(spec-143): resolusikan branchFrom ke SHA agar nama berbentuk flag tak jadi opsi"
```

---

### Task 4: Validasi `POST /specs` + `PATCH /specs/:id`

**Files:**
- Modify: `server/src/routes/specs.ts`
- Test: `server/test/specs.route.test.ts`

**Interfaces:**
- Consumes: `zCreateSpec.branchFrom`, `zPatchSpec` (Task 1); `listRepoBranches` (Task 2).
- Produces: `POST /specs` menyimpan `branchFrom`; `PATCH /specs/:id` mengembalikan baris `Spec` terbaru.

**Catatan:** `POST /specs` hari ini tak pernah memuat baris `Project`-nya. Validasi branch memaksanya
`findUnique`. Efek samping yang **diinginkan**: project tak dikenal kini 404 jujur, bukan pelanggaran
foreign-key. Test lama tetap hijau karena memakai `p1` yang ada.

- [ ] **Step 1: Tulis test yang gagal**

Ubah `beforeAll` di `server/test/specs.route.test.ts` agar `p1` punya repo nyata (salin `seedRepo`
dari `branches.test.ts`, tambahkan `g(repo,"branch","dev")`), lalu `await makeProject({ id: "p1", repoDir: repo })`.
Tambahkan:

```ts
it("POST /specs menyimpan branchFrom yang sah", async () => {
  const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
    project: "p1", source: "brief", title: "B", priority: "sedang", branchFrom: "dev",
    payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } } });
  expect(res.statusCode).toBe(201);
  expect(res.json().branchFrom).toBe("dev");
});
it("POST /specs menolak branch yang tak ada di repo", async () => {
  const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
    project: "p1", source: "brief", title: "B", priority: "sedang", branchFrom: "hantu",
    payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } } });
  expect(res.statusCode).toBe(400);
});
it("POST /specs: project tak dikenal → 404", async () => {
  const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
    project: "hantu", source: "brief", title: "B", priority: "sedang",
    payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } } });
  expect(res.statusCode).toBe(404);
});
it("POST /specs tanpa branchFrom → null", async () => {
  const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
    project: "p1", source: "qa", title: "Q", priority: "tinggi",
    payload: { severity: "major", steps: "s", expected: "e", actual: "a", env: "prod" } } });
  expect(res.json().branchFrom).toBeNull();
});
it("PATCH /specs/:id mengubah branch", async () => {
  const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: "dev" } });
  expect(res.statusCode).toBe(200);
  expect(res.json().branchFrom).toBe("dev");
});
it("PATCH /specs/:id dengan null mengosongkan branch", async () => {
  const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: null } });
  expect(res.json().branchFrom).toBeNull();
});
it("PATCH /specs/:id menolak branch yang tak ada", async () => {
  const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: "hantu" } });
  expect(res.statusCode).toBe(400);
});
it("PATCH /specs/:id pada id tak dikenal → 404", async () => {
  const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-999", payload: { branchFrom: null } });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test specs.route`
Expected: FAIL — `branchFrom` undefined pada 201; `PATCH` → 404 (route belum ada).

- [ ] **Step 3: Implementasi minimal**

`server/src/routes/specs.ts` — import `zPatchSpec` dan `listRepoBranches`; tambahkan helper dan route:

```ts
import { zCreateSpec, zPatchSpec } from "@hanoman/shared";
import { listRepoBranches } from "../services/branches";

// Daftar yang mengisi dropdown adalah daftar yang menjaga gerbang — tak ada validator
// terpisah yang bisa ikut basi. Branch yang tak ada di repo ditolak di sini, bukan
// beberapa menit kemudian saat worktree gagal di dalam run.
const branchUnknown = (repoDir: string | null, branch: string) => !listRepoBranches(repoDir).includes(branch);
```

Di dalam `POST /specs`, tepat setelah `const b = parsed.data;`:

```ts
    const project = await prisma.project.findUnique({ where: { id: b.project } });
    if (!project) return reply.code(404).send({ error: `project "${b.project}" tidak ada` });
    if (b.branchFrom && branchUnknown(project.repoDir, b.branchFrom))
      return reply.code(400).send({ error: `branch "${b.branchFrom}" tidak ada di repo project` });
```

dan pada `prisma.spec.create`, tambahkan ke `data`: `branchFrom: b.branchFrom ?? null`.

Route baru, sebelum `DELETE /specs/:id`:

```ts
  app.patch("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPatchSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const spec = await prisma.spec.findUnique({ where: { id } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    const { branchFrom } = parsed.data;
    if (branchFrom) {
      const project = await prisma.project.findUnique({ where: { id: spec.projectId } });
      if (branchUnknown(project?.repoDir ?? null, branchFrom))
        return reply.code(400).send({ error: `branch "${branchFrom}" tidak ada di repo project` });
    }
    return prisma.spec.update({ where: { id }, data: { branchFrom } });
  });
```

- [ ] **Step 4: Jalankan suite server penuh**

Run: `pnpm --filter ./server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/specs.ts server/test/specs.route.test.ts
git commit -m "feat(spec-143): validasi branchFrom di POST /specs + PATCH /specs/:id"
```

---

### Task 5: `fireTrigger` menghormati branch per-spec

**Files:**
- Modify: `server/src/fire-trigger.ts:25-38`
- Test: `server/test/fire-trigger.test.ts`

**Interfaces:**
- Consumes: `Spec.branchFrom` (Task 1).
- Produces: run yang di-enqueue memakai `ctx.branch` untuk trigger `commit`, `spec.branchFrom ?? "main"` selain itu.

**Kenapa ini butuh perhatian:** `fireTrigger` menyusun **satu** objek `base` berisi `branchFrom` dan
menyebarnya (`...base`) ke setiap spec dalam fan-out. Memperbaiki hanya `POST /runs` membuat tombol
"Mulai" bekerja sementara run dari trigger diam-diam tetap di `main`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
it("trigger commit: ctx.branch menang atas spec.branchFrom", async () => {
  await prisma.spec.update({ where: { id: "SPEC-1" }, data: { branchFrom: "dev" } });
  const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
  await fireTrigger(
    { id: "t1", projectId: "p1", type: "commit", detail: "push", target: "plan + execute", enabled: true } as any,
    { branch: "release/v2" });
  expect(spy.mock.calls[0]![0]).toMatchObject({ branchFrom: "release/v2" });
});
it("trigger schedule: spec.branchFrom menang", async () => {
  await prisma.spec.update({ where: { id: "SPEC-1" }, data: { branchFrom: "dev" } });
  const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
  await fireTrigger(
    { id: "t2", projectId: "p1", type: "schedule", detail: "0 2 * * *", target: "plan + execute", enabled: true } as any);
  expect(spy.mock.calls[0]![0]).toMatchObject({ branchFrom: "dev" });
});
it("spec tanpa branch → main", async () => {
  const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
  await fireTrigger(
    { id: "t3", projectId: "p1", type: "manual", detail: "on demand", target: "plan + execute", enabled: true } as any);
  expect(spy.mock.calls[0]![0]).toMatchObject({ branchFrom: "main" });
});
```

Tambahkan `import { prisma } from "../src/db";` di berkas test.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server test fire-trigger`
Expected: FAIL — dua test pertama melihat `branchFrom: "main"`.

- [ ] **Step 3: Implementasi minimal**

Di dalam blok `if (flow === "feature")`, ganti isi loop:

```ts
    for (const s of specs) {
      const runId = await nextRunId();
      // Trigger commit menguji branch yang baru menerima commit; di luar itu pilihan backlog
      // yang menang. `...base` mengandung branchFrom lama — override HARUS sesudahnya.
      const branchFrom = trigger.type === "commit" && ctx.branch ? ctx.branch : (s.branchFrom ?? "main");
      const r = await enqueueRun({ runId, ...base, branchFrom, branchTo: `hanoman/${runId.toLowerCase()}`, flow, specId: s.id, steps });
      if (r.enqueued) enqueued.push(runId);
    }
```

- [ ] **Step 4: Jalankan suite server penuh**

Run: `pnpm --filter ./server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/fire-trigger.ts server/test/fire-trigger.test.ts
git commit -m "feat(spec-143): fireTrigger memakai branch per-spec, ctx.branch menang pada trigger commit"
```

---

### Task 6: CLI `--from` berhenti berbohong

**Files:**
- Modify: `cli/src/commands/_run.ts:21-31,38-44`, `cli/src/commands/spec.ts:6-7`, `cli/src/commands/plan.ts:6-7`, `cli/src/commands/execute.ts:5-6`, `cli/src/commands/qa.ts:5-6`
- Test: `cli/test/flows.cmd.test.ts`

**Interfaces:**
- Produces: `FlowArgs` bertambah `from?: string`; `runFlow` memakai `branchFrom: a.from ?? "main"`.

**Kenapa:** `parseFlowArgs` sudah mem-parse `--from` dan mengembalikannya, tetapi `FlowArgs` tak punya
field itu, sehingga `runFlow` menimpanya dengan `branchFrom: "main"`. `hanoman spec X --from release/v2`
menerima branch itu dan diam-diam berjalan di `main`.

- [ ] **Step 1: Tulis test yang gagal**

Baca `cli/test/flows.cmd.test.ts` lebih dulu untuk memakai bentuk `deps` palsu yang sudah ada di sana,
lalu tambahkan (sesuaikan nama helper dengan yang ada):

```ts
it("--from sampai ke RunInput.branchFrom", async () => {
  let seen: any;
  const deps = { ...fakeDeps(), git: { ...fakeDeps().git, addWorktree: (_r: string, _p: string, b: string) => { seen = b; } } };
  await runSpec(["SPEC-1", "--from", "release/v2"], ctx(), deps as any);
  expect(seen).toBe("release/v2");
});
it("tanpa --from tetap main", async () => {
  let seen: any;
  const deps = { ...fakeDeps(), git: { ...fakeDeps().git, addWorktree: (_r: string, _p: string, b: string) => { seen = b; } } };
  await runSpec(["SPEC-1"], ctx(), deps as any);
  expect(seen).toBe("main");
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./cli test flows`
Expected: FAIL — test pertama melihat `"main"`.

- [ ] **Step 3: Implementasi minimal**

`cli/src/commands/_run.ts`:

```ts
export interface FlowArgs { flow: Flow; specId?: string; only?: string; repoDir?: string; branchTo?: string; from?: string; }
```

dan di dalam `runFlow`, ganti baris `branchFrom` (buang komentar `ponytail:` — utangnya lunas):

```ts
    branchFrom: a.from ?? "main",
```

Keempat pemanggil menambahkan `from: p.from` ke argumen `runFlow`. Contoh `cli/src/commands/spec.ts`:

```ts
  return runFlow({ flow: "feature", specId: p.specId, only: p.only ?? "Spec", repoDir: p.repoDir, branchTo: p.branchTo, from: p.from }, ctx, deps);
```

Lakukan hal yang sama di `plan.ts` (`only: p.only ?? "Plan"`), `execute.ts` (`only: p.only`), `qa.ts`
(`flow: "qa"`, `only: p.only`).

- [ ] **Step 4: Jalankan test, pastikan hijau**

Run: `pnpm --filter ./cli test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/_run.ts cli/src/commands/spec.ts cli/src/commands/plan.ts cli/src/commands/execute.ts cli/src/commands/qa.ts cli/test/flows.cmd.test.ts
git commit -m "fix(spec-143): --from CLI diteruskan ke branchFrom, bukan dibuang"
```

---

### Task 7: Web — pilih branch saat membuat, ubah saat sudah di backlog

**Files:**
- Modify: `src/src/api/client.ts:17-20`, `src/src/App.tsx:22-23,27,52-56,372-378,395-401`, `src/src/screens/BacklogScreen.tsx:66-88,89-140`

**Interfaces:**
- Consumes: `paths.branches` (Task 2); `PATCH /specs/:id` (Task 4); `Spec.branchFrom` (Task 1).
- Produces: `api.listBranches(id): Promise<{ branches: string[] }>`, `api.patchSpec(id, { branchFrom })`.

- [ ] **Step 1: Perluas api client**

`src/src/api/client.ts`:

```ts
  listBranches: (id: string) => j<{ branches: string[] }>(paths.branches(id)),
  patchSpec: (id: string, b: { branchFrom: string | null }) =>
    j<Spec>(paths.spec(id), { method: "PATCH", ...body(b) }),
  startRun: (b: { project: string; flow: "feature" | "qa"; specId: string; branchFrom?: string }) =>
    j<{ runId: string }>(paths.runs, { method: "POST", ...body(b) }),
```

- [ ] **Step 2: `NewSpecModal` — satu Select untuk brief dan QA**

`src/src/App.tsx`. Tambahkan `branchFrom: string` ke `type SpecForm` dan `branchFrom: ""` ke `blank`.
Di dalam `NewSpecModal`, setelah `const [f, setF] = React.useState<SpecForm>(blank);`:

```tsx
  const [branches, setBranches] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!open || !f.project) { setBranches([]); return; }
    let alive = true;
    api.listBranches(f.project)
      .then((r) => { if (alive) setBranches(r.branches); })
      .catch(() => { if (alive) setBranches([]); });
    return () => { alive = false; };
  }, [open, f.project]);
```

Sisipkan field **di luar** cabang `isQa` — tepat setelah `<Field label="Project">…</Field>` — sehingga
muncul untuk brief maupun QA:

```tsx
      <Field label="Branch" hint="branch yang di-copy ke git worktree saat run">
        <Select value={f.branchFrom} onChange={set("branchFrom")} disabled={!branches.length}
          style={{ width: "100%" }}
          options={[{ value: "", label: branches.length ? "main (default project)" : "project belum punya repo" }]
            .concat(branches.map((b) => ({ value: b, label: b })))} />
      </Field>
```

Dan di `createSpec`, tambahkan ke argumen `api.createSpec`: `branchFrom: f.branchFrom || undefined`.

- [ ] **Step 3: `startRun` meneruskan branch backlog**

`src/src/App.tsx`:

```tsx
      const { runId } = await api.startRun({
        project: spec.projectId,
        flow: spec.source === "qa" ? "qa" : "feature",
        specId: spec.id,
        branchFrom: spec.branchFrom ?? "main",
      });
```

- [ ] **Step 4: `editBranch` di App + prop ke BacklogScreen**

```tsx
  async function editBranch(spec: Spec, branchFrom: string | null) {
    try {
      const updated = await api.patchSpec(spec.id, { branchFrom });
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " · branch " + (branchFrom ?? "main (default)"), "ok", "git-branch");
    } catch { showToast("Gagal mengubah branch " + spec.id, "err", "x-circle"); }
  }
```

Oper `onEditBranch={editBranch}` ke `<BacklogScreen … />`.

- [ ] **Step 5: `BacklogScreen` — Badge di kartu, Select di detail**

Import `api`: `import { api } from "../api/client";`

**Hati-hati rules-of-hooks:** `SpecDetail` sekarang dimulai dengan `if (!spec) return null;`. Hook
**tidak boleh** berada sesudah early-return itu. Taruh hook di paling atas dan pindahkan return:

```tsx
function SpecDetail({ spec, onClose, onEditBranch }:
  { spec: Spec | null; onClose: () => void; onEditBranch?: (s: Spec, b: string | null) => void }) {
  const [branches, setBranches] = React.useState<string[]>([]);
  const projectId = spec?.projectId;
  React.useEffect(() => {
    if (!projectId) { setBranches([]); return; }
    let alive = true;
    api.listBranches(projectId)
      .then((r) => { if (alive) setBranches(r.branches); })
      .catch(() => { if (alive) setBranches([]); });
    return () => { alive = false; };
  }, [projectId]);
  if (!spec) return null;               // <- sesudah semua hook
  const qa = spec.source === "qa";
  …
```

Di dalam `<Modal>`, tepat setelah `<DetailRow label="Objective" … />`:

```tsx
      <div style={{ marginBottom: 14 }}>
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Branch worktree</div>
        <Select size="sm" value={spec.branchFrom ?? ""} disabled={!branches.length}
          onChange={(e) => onEditBranch && onEditBranch(spec, e.target.value || null)}
          options={[{ value: "", label: branches.length ? "main (default project)" : "project belum punya repo" }]
            .concat(branches.map((b) => ({ value: b, label: b })))} />
      </div>
```

Di `SpecCard`, dalam baris badge pertama (sesudah badge `qa ? "QA finding" : "feature brief"`):

```tsx
            {spec.branchFrom && <Badge tone="neutral" size="sm" icon="git-branch">{spec.branchFrom}</Badge>}
```

(`Icon` memetakan `git-branch` → `GitBranch` lucide; sudah diverifikasi ada.)

Teruskan prop: `BacklogScreen` menerima `onEditBranch?: (s: Spec, b: string | null) => void` dan
mengopernya ke `<SpecDetail … onEditBranch={onEditBranch} />`.

- [ ] **Step 6: Typecheck + build web**

Run: `pnpm -r typecheck`
Expected: PASS.

Run: `pnpm --filter ./src build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/App.tsx src/src/screens/BacklogScreen.tsx
git commit -m "feat(spec-143): pilih branch saat membuat spec, ubah dari detail backlog"
```

---

### Task 8: ADR, docs, dan smoke lokal nyata

**Files:**
- Create: `internal/docs/adr/0018-branch-adalah-properti-backlog-item.md`
- Modify: `internal/docs/README.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`

- [ ] **Step 1: Hitung ulang nomor ADR lintas branch**

Run:
```bash
for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
  git ls-tree -r --name-only "$b" -- internal/docs/adr
done | sed -n 's#.*/\([0-9]\{4\}\).*#\1#p' | sort -u | tail -1
```
Expected: `0017` → pakai `0018`. Bila lebih tinggi, naikkan; worktree bersebelahan bisa sudah memesan.

- [ ] **Step 2: Tulis ADR**

`internal/docs/adr/0018-branch-adalah-properti-backlog-item.md` — konteks (empat produsen `branchFrom`
yang semuanya jatuh ke `main`; `--from` CLI yang dibuang), keputusan (kolom `Spec.branchFrom` nullable;
`null` = `main`; whitelist dari `refs/heads`; resolusi ke SHA sebelum `worktree add`; `ctx.branch`
menang pada trigger `commit`), konsekuensi (backlog item bisa berjalan di branch selain pilihannya bila
dipicu commit; repo yang default-nya `master` gagal keras — sama seperti hari ini), alternatif yang
ditolak (titipan `payload`, sebab `specBlock()` men-`JSON.stringify` payload ke prompt setiap fase).

- [ ] **Step 3: Perbarui docs arsitektur + link di index**

- `internal/docs/architecture/data-model.md`: tambahkan `branchFrom String?` pada tabel `Spec`.
- `internal/docs/architecture/api-contract.md`: `GET /projects/:id/branches`, `PATCH /specs/:id`,
  dan `POST /specs` yang kini 404 untuk project tak dikenal.
- `internal/docs/README.md`, bagian `## adr`, baris paling atas:
  `- [0018 — branch adalah properti backlog item](adr/0018-branch-adalah-properti-backlog-item.md)`

- [ ] **Step 4: Guardrail Source of Truth**

Run: `pnpm --filter ./cli build && node cli/dist/hanoman.js docs verify`
Expected: `Source of Truth clean · coverage 100%`. Doc di `internal/docs/**` yang tak ter-link akan
memblokir Stop hook.

- [ ] **Step 5: Suite penuh**

Run: `pnpm test && pnpm --filter ./runner test && pnpm --filter ./cli test && pnpm -r typecheck`
Expected: semua PASS. (`pnpm test` tidak mencakup runner/cli — karena itu keduanya dipanggil terpisah.)

- [ ] **Step 6: Smoke lokal nyata (CLAUDE.md)**

Pastikan Postgres hidup: `docker compose up -d --wait`. Boot API: `pnpm dev:api`.

> **Jangan `POST /runs` di sini.** Bila ada worker dev hidup, itu benar-benar mengeksekusi run
> background di worktree baru.

```bash
# project yang menunjuk repo ini
curl -s localhost:3000/api/projects | python3 -m json.tool | head -20

# 1. daftar branch nyata
curl -s localhost:3000/api/projects/<id>/branches

# 2. project tak dikenal → 404
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/projects/hantu/branches

# 3. buat spec dengan branch sah → 201, branchFrom terisi
curl -s -X POST localhost:3000/api/specs -H 'content-type: application/json' \
  -d '{"project":"<id>","source":"brief","title":"smoke 143","priority":"rendah","branchFrom":"main",
       "payload":{"context":"c","outcome":"o","constraints":"","priority":"rendah"}}'

# 4. branch karangan → 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/specs -H 'content-type: application/json' \
  -d '{"project":"<id>","source":"brief","title":"x","priority":"rendah","branchFrom":"hantu",
       "payload":{"context":"c","outcome":"o","constraints":"","priority":"rendah"}}'

# 5. ubah lalu kosongkan
curl -s -X PATCH localhost:3000/api/specs/<SPEC-id> -H 'content-type: application/json' -d '{"branchFrom":"main"}'
curl -s -X PATCH localhost:3000/api/specs/<SPEC-id> -H 'content-type: application/json' -d '{"branchFrom":null}'

# 6. konfirmasi di Postgres (bukan unix socket — DB jalan di Docker)
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c 'select id, "branchFrom" from "Spec" order by id desc limit 5;'

# 7. bersihkan spec smoke
curl -s -X DELETE localhost:3000/api/specs/<SPEC-id> -o /dev/null -w '%{http_code}\n'
```

Expected: (1) memuat `main`; (2) `404`; (3) `201` dengan `"branchFrom":"main"`; (4) `400`;
(5) `200` lalu `branchFrom: null`; (6) kolom terlihat di Postgres; (7) `204`.

Bila ada yang merah, **perbaiki dulu sampai hijau** sebelum menutup task ini.

- [ ] **Step 7: Commit**

```bash
git add internal/docs/adr/0018-branch-adalah-properti-backlog-item.md internal/docs/README.md internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md
git commit -m "docs(spec-143): ADR-0018 + data-model & api-contract untuk branch backlog"
```

---

## Self-review

**Cakupan spec.** Data model → Task 1. Sumber daftar branch → Task 2. Keamanan argumen → Task 3.
API (`POST` validasi, `PATCH`) → Task 4. Produsen `branchFrom`: `fireTrigger` → Task 5, CLI → Task 6,
`POST /runs`/`startRun` → Task 7 Step 3. Web → Task 7. Migration + ADR + docs + smoke → Task 8.
Perilaku "branch hilang → gagal keras" → Task 3 Step 1 (test `toThrow(/tidak-ada/)`).

**Konsistensi tipe.** `listRepoBranches(repoDir: string | null): string[]` dipakai identik di Task 2
(route) dan Task 4 (validasi). `onEditBranch(spec, branch: string | null)` sama di App (Task 7 Step 4),
`BacklogScreen`, dan `SpecDetail` (Step 5). `zPatchSpec.branchFrom` nullable di Task 1 = `null` yang
dikirim `api.patchSpec` di Task 7.

**Yang sengaja tidak dikerjakan.** Whitelist untuk `PATCH /runs/:id/worktree` (lubang lama, tak diperlebar
SPEC-143 — hanya sisi flag-injection-nya yang tertutup lewat `switchBase` di Task 3). Branch remote.
`Project.defaultBranch`. Menambahkan `runner`/`cli` ke `vitest.workspace.ts` — celah nyata, tapi bukan
milik backlog item ini.
