# Auto-merge ke branch tujuan saat sesi selesai — Implementation Plan (SPEC-486)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project (dengan override per-spec) bisa menyatakan "kalau backlog item selesai, gabungkan branch kerjanya ke branch tujuan" — dieksekusi orchestrator, gagal dengan suara, branch kerja utuh.

**Architecture:** Kebijakan disimpan sebagai satu blok `Json?` di `Project.autoMerge` dan `Spec.autoMerge` (null = warisi/off), dibaca resolver murni di `@hanoman/shared`. Eksekusinya **satu sweep periodik** (`services/auto-merge.ts`, `setInterval` dari `server.ts`) — nol call site, sehingga tak mengulang kelas bug "satu definisi, N call site" (SPEC-431/448/475) dan tak balapan dengan `git push` agen yang terjadi SESUDAH baris fase terakhir ditulis. Merge-nya memakai `integrate()` ADR-0031 apa adanya. Penanda idempotensi + laporan adalah satu baris `Notification` ber-`key` unik.

**Tech Stack:** TypeScript strict · Prisma 6 / SQLite · Fastify · zod · React + Vite · vitest.

## Global Constraints

- Default **tanpa auto-merge**: `Project.autoMerge = null` ⇒ perilaku project lama tak berubah satu langkah git pun.
- Operasi terkunci ke **`merge`**. `rebase` tak pernah dipakai auto-merge (ia selalu force-push branch sumber, ADR-0031).
- **Tidak pernah** menghapus branch kerja sebelum merge terbukti `clean`. Penghapusan sesudahnya adalah knob `deleteBranch`, default `false`.
- Project tanpa repoDir efektif (`resolveRepoDir` = binding lokal ?? `Project.repoDir`) tak boleh menyalakan auto-merge: UI disabled + penjelasan, server **409**.
- Kolom baru **LOCAL-only**: tidak masuk `FIELDS.project` / `FIELDS.spec` di `server/src/services/sync.ts`.
- Nama branch tujuan **tak pernah** di-hardcode `"main"` (SPEC-227/ADR-0077); default branch diresolve saat eksekusi.
- Bahasa komentar & pesan pengguna: Indonesia, mengikuti gaya berkas sekitarnya.
- Nomor ADR yang diklaim spec ini: **0103** (0101 = SPEC-484, 0102 = SPEC-485). Verifikasi ulang lintas worktree & branch tepat sebelum push.
- Test dijalankan dengan `TEST_DATABASE_URL` sendiri + `--no-file-parallelism` (lihat Task 10).

---

### Task 1: Kebijakan auto-merge sebagai data murni (`shared`)

**Files:**
- Create: `shared/src/auto-merge.ts`
- Create: `shared/src/auto-merge.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `AUTO_MERGE_MODES`, `type AutoMergeMode = "off" | "default-branch" | "branch"`
  - `zAutoMerge` (zod object), `type AutoMerge = { mode: AutoMergeMode; dest: "local" | "origin"; branch: string | null; deleteBranch: boolean }`
  - `AUTO_MERGE_OFF: AutoMerge`
  - `autoMergeOf(raw: unknown): AutoMerge | null`
  - `resolveAutoMerge(projectRaw: unknown, specRaw: unknown): AutoMerge`
  - `autoMergeTargetOf(p: AutoMerge, defaultBranch: string | null): string | null`
  - `autoMergeSummary(p: AutoMerge): string`

- [x] **Step 1: Write the failing test**

Create `shared/src/auto-merge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  zAutoMerge, autoMergeOf, resolveAutoMerge, autoMergeTargetOf, autoMergeSummary, AUTO_MERGE_OFF,
} from "./auto-merge";

describe("zAutoMerge", () => {
  it("mengisi default untuk kunci yang hilang", () => {
    expect(zAutoMerge.parse({})).toEqual({ mode: "off", dest: "local", branch: null, deleteBranch: false });
  });
  it("menolak mode karangan", () => {
    expect(zAutoMerge.safeParse({ mode: "squash" }).success).toBe(false);
  });
});

describe("autoMergeOf — kolom Json dibaca defensif", () => {
  it("null/undefined → null (tak ada kebijakan)", () => {
    expect(autoMergeOf(null)).toBeNull();
    expect(autoMergeOf(undefined)).toBeNull();
  });
  it("bentuk rusak → null, bukan melempar", () => {
    expect(autoMergeOf({ mode: 7 })).toBeNull();
    expect(autoMergeOf("main")).toBeNull();
  });
  it("bentuk sah dikembalikan lengkap dengan default", () => {
    expect(autoMergeOf({ mode: "branch", branch: "develop" }))
      .toEqual({ mode: "branch", dest: "local", branch: "develop", deleteBranch: false });
  });
});

describe("resolveAutoMerge — spec menang, lalu project, lalu OFF", () => {
  const proj = { mode: "default-branch", dest: "origin", branch: null, deleteBranch: false };
  it("spec null → warisi project", () => {
    expect(resolveAutoMerge(proj, null)).toEqual(proj);
  });
  it("spec terisi → menang atas project", () => {
    expect(resolveAutoMerge(proj, { mode: "branch", dest: "local", branch: "rilis" }))
      .toEqual({ mode: "branch", dest: "local", branch: "rilis", deleteBranch: false });
  });
  it("spec bisa MEMATIKAN auto-merge di satu item saja", () => {
    expect(resolveAutoMerge(proj, { mode: "off" }).mode).toBe("off");
  });
  it("keduanya kosong → OFF", () => {
    expect(resolveAutoMerge(null, null)).toEqual(AUTO_MERGE_OFF);
  });
  it("project rusak diperlakukan seperti tak ada kebijakan", () => {
    expect(resolveAutoMerge({ mode: "squash" }, null)).toEqual(AUTO_MERGE_OFF);
  });
});

describe("autoMergeTargetOf — kosakata target sama dengan POST /specs/:id/integrate", () => {
  it("mode off → null (tak ada yang dieksekusi)", () => {
    expect(autoMergeTargetOf(AUTO_MERGE_OFF, "main")).toBeNull();
  });
  it("mode branch memakai branch pilihan operator + dest-nya", () => {
    expect(autoMergeTargetOf({ mode: "branch", dest: "origin", branch: "develop", deleteBranch: false }, "main"))
      .toBe("origin:develop");
  });
  it("mode default-branch memakai default branch yang diresolve saat eksekusi", () => {
    expect(autoMergeTargetOf({ mode: "default-branch", dest: "local", branch: null, deleteBranch: false }, "master"))
      .toBe("local:master");
  });
  it("default branch tak terbaca → null, bukan menebak main", () => {
    expect(autoMergeTargetOf({ mode: "default-branch", dest: "local", branch: null, deleteBranch: false }, null))
      .toBeNull();
  });
  it("mode branch tanpa branch → null", () => {
    expect(autoMergeTargetOf({ mode: "branch", dest: "local", branch: null, deleteBranch: false }, "main"))
      .toBeNull();
  });
});

describe("autoMergeSummary", () => {
  it("menyebut tujuan yang bisa dibaca manusia", () => {
    expect(autoMergeSummary(AUTO_MERGE_OFF)).toBe("tanpa auto-merge");
    expect(autoMergeSummary({ mode: "default-branch", dest: "origin", branch: null, deleteBranch: false }))
      .toBe("auto-merge ke default branch repo (origin)");
    expect(autoMergeSummary({ mode: "branch", dest: "local", branch: "develop", deleteBranch: true }))
      .toBe("auto-merge ke develop (lokal) · hapus branch kerja");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest --run shared/src/auto-merge.test.ts`
Expected: FAIL — `Failed to resolve import "./auto-merge"`.

- [x] **Step 3: Write minimal implementation**

Create `shared/src/auto-merge.ts`:

```ts
import { z } from "zod";

// SPEC-486 · ADR-0103 · kebijakan "apa yang terjadi sesudah backlog item selesai".
//
// Satu blok, dua tempat: `Project.autoMerge` (default project) dan `Spec.autoMerge` (override
// per item; null = warisi project). Bentuknya `Json?` di DB — preseden `Setting.conflict`
// (ADR-0081) & `Spec.dependsOn` (ADR-0093) — karena ia dibaca sebagai SATU kesatuan dan tak
// pernah difilter/di-`orderBy`. Empat kolom skalar akan mengizinkan keadaan yang tak masuk akal
// (`mode:"off"` dengan `branch` terisi) tanpa satu pun tipe yang mencegahnya.
//
// `dest` + `branch` sengaja memakai kosakata yang SAMA dengan `POST /specs/:id/integrate`
// (`local:<b>` / `origin:<b>`, ADR-0031): satu perbendaharaan untuk dua permukaan, dan dropdown
// branch di UI memakai `GET /projects/:id/branches` yang sudah memasok keduanya.
export const AUTO_MERGE_MODES = ["off", "default-branch", "branch"] as const;
export type AutoMergeMode = (typeof AUTO_MERGE_MODES)[number];

export const zAutoMerge = z.object({
  mode: z.enum(AUTO_MERGE_MODES).default("off"),
  // Tujuan: `local` = perbarui ref/fast-forward di checkout ini; `origin` = push.
  dest: z.enum(["local", "origin"]).default("local"),
  // Hanya bermakna saat mode = "branch". Untuk "default-branch" ia diresolve SAAT EKSEKUSI.
  branch: z.string().min(1).nullable().default(null),
  // Hapus `hanoman/<spec>` (lokal + origin) — HANYA sesudah merge terbukti bersih.
  deleteBranch: z.boolean().default(false),
});
export type AutoMerge = z.infer<typeof zAutoMerge>;

export const AUTO_MERGE_OFF: AutoMerge = { mode: "off", dest: "local", branch: null, deleteBranch: false };

/** Kolom `Json` bisa berisi apa saja (ditulis versi lain, disunting tangan). Bentuk rusak → null
 *  = "tak ada kebijakan", bukan melempar: sweep tak boleh mati karena satu baris cacat. */
export function autoMergeOf(raw: unknown): AutoMerge | null {
  if (raw === null || raw === undefined) return null;
  const p = zAutoMerge.safeParse(raw);
  return p.success ? p.data : null;
}

/** Kebijakan yang BERLAKU untuk sebuah backlog item. Satu definisi, dipakai server (sweep +
 *  gerbang route) dan UI (badge "ikut project" vs "override item ini"). */
export function resolveAutoMerge(projectRaw: unknown, specRaw: unknown): AutoMerge {
  return autoMergeOf(specRaw) ?? autoMergeOf(projectRaw) ?? AUTO_MERGE_OFF;
}

/** Target untuk `integrate()`. `null` = tak ada tujuan yang bisa dipakai (jangan eksekusi). */
export function autoMergeTargetOf(p: AutoMerge, defaultBranch: string | null): string | null {
  if (p.mode === "off") return null;
  const name = p.mode === "branch" ? p.branch : defaultBranch;
  return name ? `${p.dest}:${name}` : null;
}

const DEST_LABEL: Record<AutoMerge["dest"], string> = { local: "lokal", origin: "origin" };

/** Ringkasan sebaris untuk UI — dipakai kartu project DAN baris "ikut project" di backlog. */
export function autoMergeSummary(p: AutoMerge): string {
  if (p.mode === "off") return "tanpa auto-merge";
  const where = p.mode === "default-branch"
    ? `default branch repo (${DEST_LABEL[p.dest]})`
    : `${p.branch ?? "—"} (${DEST_LABEL[p.dest]})`;
  return `auto-merge ke ${where}${p.deleteBranch ? " · hapus branch kerja" : ""}`;
}
```

Modify `shared/src/index.ts` — tambahkan satu baris sesudah `export * from "./mcp";`:

```ts
export * from "./auto-merge";
```

- [x] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest --run shared/src/auto-merge.test.ts`
Expected: PASS — 17 test.

- [x] **Step 5: Commit**

```bash
git add shared/src/auto-merge.ts shared/src/auto-merge.test.ts shared/src/index.ts
git commit -m "feat(486): kebijakan auto-merge sebagai data murni di shared"
```

---

### Task 2: Kolom `autoMerge` di `Project` & `Spec`

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Project`, model `Spec`)
- Create: `server/prisma/migrations/20260801230000_auto_merge/migration.sql`
- Modify: `shared/src/webhook.ts` (allowlist field `spec` & `project`)
- Create: `server/test/auto-merge-schema.test.ts`

**Interfaces:**
- Consumes: —
- Produces: kolom `Project.autoMerge` & `Spec.autoMerge` bertipe `Json?` di klien Prisma.

- [x] **Step 1: Write the failing test**

Create `server/test/auto-merge-schema.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { __FIELDS_FOR_TEST } from "../src/services/sync";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("kolom autoMerge (SPEC-486 · ADR-0103)", () => {
  it("Project.autoMerge menyimpan blok kebijakan dan membacanya kembali", async () => {
    await prisma.project.create({
      data: {
        id: "p1", name: "P1", desc: "", kind: "existing",
        autoMerge: { mode: "branch", dest: "origin", branch: "develop", deleteBranch: false },
      },
    });
    const row = await prisma.project.findUnique({ where: { id: "p1" } });
    expect(row!.autoMerge).toEqual({ mode: "branch", dest: "origin", branch: "develop", deleteBranch: false });
  });

  it("baris lama tetap null — nol backfill, perilaku project lama utuh", async () => {
    await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
    const row = await prisma.project.findUnique({ where: { id: "p2" } });
    expect(row!.autoMerge).toBeNull();
  });

  it("Spec.autoMerge menyimpan override per item", async () => {
    await prisma.project.create({ data: { id: "p3", name: "P3", desc: "", kind: "existing" } });
    await prisma.spec.create({
      data: {
        id: "SPEC-1", projectId: "p3", title: "a", source: "brief", stage: "done",
        priority: "sedang", author: "a", objective: "", autoMerge: { mode: "off" },
      },
    });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-1" } });
    expect(row!.autoMerge).toEqual({ mode: "off" });
  });

  // Kebijakan auto-merge adalah kebijakan EKSEKUSI mesin ini: nama branch tujuan properti
  // checkout lokal, dan mesin yang menjalankan sesi adalah mesin yang mendaratkan hasilnya.
  // Cermin repoDir / schedulerOptIn / leadOptIn.
  it("TIDAK ikut menyeberang sync (LOCAL-only)", () => {
    expect(__FIELDS_FOR_TEST.project).not.toContain("autoMerge");
    expect(__FIELDS_FOR_TEST.spec).not.toContain("autoMerge");
    expect(__FIELDS_FOR_TEST.spec).toContain("dependsOn");   // kontrol negatif
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/auto-merge-schema.test.ts`
Expected: FAIL — `Unknown argument 'autoMerge'`.

- [x] **Step 3: Write minimal implementation**

Modify `server/prisma/schema.prisma`, di model `Project` sesudah baris `leadOptIn`:

```prisma
  // SPEC-486 · ADR-0103 · kebijakan auto-merge saat backlog item selesai (LOCAL — tak masuk
  // FIELDS sync, cermin repoDir/schedulerOptIn). null = tanpa auto-merge (default, nol backfill).
  autoMerge      Json?
```

Di model `Spec`, sesudah baris `dependsOn  Json?`:

```prisma
  // SPEC-486 · ADR-0103 · override kebijakan auto-merge untuk item ini. null = warisi project.
  // `Json?` dengan alasan yang sama seperti dependsOn: blok dibaca utuh, tak pernah difilter.
  autoMerge  Json?
```

Create `server/prisma/migrations/20260801230000_auto_merge/migration.sql`:

```sql
-- SPEC-486 · ADR-0103 · kebijakan auto-merge saat sesi selesai.
--
-- ADITIF & nullable tanpa default → `ADD COLUMN` polos (pola migration SPEC-447). Yang dilarang
-- SQLite adalah `ADD COLUMN … DEFAULT <non-konstan>`, bukan `ADD COLUMN` itu sendiri. Baris lama
-- tetap NULL, dan NULL berarti "tanpa auto-merge" di Project / "warisi project" di Spec —
-- jadi tak ada backfill, dan project lama tak berubah perilaku satu langkah git pun.
ALTER TABLE "Project" ADD COLUMN "autoMerge" JSONB;
ALTER TABLE "Spec" ADD COLUMN "autoMerge" JSONB;
```

Modify `shared/src/webhook.ts` — pada entri katalog `spec`, tambahkan `"autoMerge"` di akhir daftar `fields`, dan pada entri `project` tambahkan `"autoMerge"` sesudah `"leadOptIn"`. Tambahkan juga `autoMerge: null` di kedua objek `sample` (di `spec` letakkan sesudah `dependsOn: null`, di `project` sesudah `leadOptIn: false`), supaya contoh amplop tetap mencerminkan bentuk sebenarnya.

Terapkan skema ke DB dev + klien:

```bash
cd server && npx prisma generate && npx prisma migrate deploy
```

(Jangan `migrate dev` — worktree tetangga bisa membuat drift dan `migrate dev` akan me-reset DB bersama.)

- [x] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/auto-merge-schema.test.ts server/test/webhook-catalog-dmmf.test.ts`
Expected: PASS — kedua berkas hijau (DMMF membuktikan nama kolom di katalog webhook memang ada di skema).

- [x] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260801230000_auto_merge shared/src/webhook.ts server/test/auto-merge-schema.test.ts
git commit -m "feat(486): kolom autoMerge di Project & Spec (migration + katalog webhook)"
```

---

### Task 3: `defaultBranch(repoDir)`

**Files:**
- Modify: `server/src/services/branches.ts`
- Modify: `server/test/branches.test.ts`

**Interfaces:**
- Consumes: `listRepoBranches`, `listRepoRemoteBranches` (sudah ada di berkas yang sama)
- Produces: `defaultBranch(repoDir: string | null): Promise<string | null>`

- [x] **Step 1: Write the failing test**

Tambahkan ke `server/test/branches.test.ts` (import `defaultBranch` dari `../src/services/branches`, dan `mkdtempSync`/`spawnSync` bila belum ada di berkas itu):

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultBranch } from "../src/services/branches";

function repoWith(branches: string[], head: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hnm-defbranch-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir });
  git("init", "-q", "-b", head);
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("commit", "-q", "--allow-empty", "-m", "init");
  for (const b of branches) if (b !== head) git("branch", b);
  return dir;
}

describe("defaultBranch (SPEC-486)", () => {
  it("memakai main bila ada", async () => {
    expect(await defaultBranch(repoWith(["main", "develop"], "main"))).toBe("main");
  });

  // SPEC-227/ADR-0077 · repo bisa ber-default master/develop. Jangan pernah hardcode "main".
  it("jatuh ke master saat tak ada main", async () => {
    expect(await defaultBranch(repoWith(["master", "fitur"], "master"))).toBe("master");
  });

  it("null bila tak ada main maupun master (bukan menebak)", async () => {
    expect(await defaultBranch(repoWith(["develop"], "develop"))).toBeNull();
  });

  it("null untuk repoDir null / bukan repo git", async () => {
    expect(await defaultBranch(null)).toBeNull();
    expect(await defaultBranch(mkdtempSync(join(tmpdir(), "hnm-kosong-")))).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/branches.test.ts`
Expected: FAIL — `defaultBranch is not a function` / import tak ditemukan.

- [x] **Step 3: Write minimal implementation**

Tambahkan di akhir `server/src/services/branches.ts`:

```ts
// SPEC-486 · ADR-0103 · "default branch repo" untuk mode auto-merge `default-branch`. Diresolve
// SAAT EKSEKUSI, bukan dibekukan ke dalam setting: repo yang mengganti default branch-nya tak
// boleh diam-diam terus di-merge ke branch lama.
//
// Urutan: `origin/HEAD` (jawaban otoritatif remote) → main → master → null. SPEC-227/ADR-0077 —
// JANGAN hardcode "main"; dan `null` (bukan tebakan) adalah jawaban yang benar saat repo tak
// punya keduanya, karena merge ke branch yang salah tak bisa dibatalkan dari dashboard.
export async function defaultBranch(repoDir: string | null): Promise<string | null> {
  if (!repoDir) return null;
  try {
    const { stdout } = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { cwd: repoDir, ...GIT });
    // `--short` memberi "origin/main"; git memendekkan ref itu sendiri jadi bare "origin" di
    // tempat lain (services/branch-cleanup.ts) — di sini bentuknya selalu berprefix.
    const name = stdout.trim().replace(/^origin\//, "");
    if (name && name !== "HEAD") return name;
  } catch { /* origin/HEAD tak ada: repo tanpa remote, atau `remote set-head` belum pernah jalan */ }
  const all = new Set([...(await listRepoBranches(repoDir)), ...(await listRepoRemoteBranches(repoDir))]);
  for (const c of ["main", "master"]) if (all.has(c)) return c;
  return null;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/branches.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/branches.ts server/test/branches.test.ts
git commit -m "feat(486): defaultBranch(repoDir) — origin/HEAD → main → master → null"
```

---

### Task 4: Gerbang tulis — `PATCH /projects/:id`, `PATCH /specs/:id`, `GET …/branches`

**Files:**
- Modify: `shared/src/dto.ts` (`zUpdateProject`, `zPatchSpec`, `zProjectView`)
- Modify: `server/src/services/project-view.ts`
- Modify: `server/src/routes/projects.ts`
- Modify: `server/src/routes/specs.ts`
- Create: `server/src/services/auto-merge-gate.ts`
- Create: `server/test/auto-merge.route.test.ts`

**Interfaces:**
- Consumes: `zAutoMerge`, `autoMergeOf` (Task 1); `defaultBranch`, `listRepoBranches`, `listRepoRemoteBranches` (Task 3)
- Produces: `checkAutoMerge(repoDir: string | null, raw: unknown): Promise<{ ok: true } | { ok: false; code: 400 | 409; error: string }>`

- [x] **Step 1: Write the failing test**

Create `server/test/auto-merge.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hnm-am-route-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  git("commit", "-q", "--allow-empty", "-m", "init");
  git("branch", "develop");
  return dir;
}
const patchProject = (id: string, autoMerge: unknown) =>
  app.inject({ method: "PATCH", url: `/api/projects/${id}`, payload: { autoMerge } });

describe("gerbang tulis kebijakan auto-merge (SPEC-486)", () => {
  it("409 bila project belum punya repoDir efektif", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    const r = await patchProject("p1", { mode: "default-branch", dest: "local" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/checkout lokal/);
  });

  it("mematikan auto-merge SELALU boleh, walau tanpa repoDir", async () => {
    await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
    const r = await patchProject("p2", { mode: "off" });
    expect(r.statusCode).toBe(200);
  });

  it("400 bila mode branch tanpa branch", async () => {
    await prisma.project.create({ data: { id: "p3", name: "P3", desc: "", kind: "existing", repoDir: repo() } });
    const r = await patchProject("p3", { mode: "branch", dest: "local", branch: null });
    expect(r.statusCode).toBe(400);
  });

  // SPEC-143/ADR-0032 · daftar yang memasok dropdown adalah daftar yang menjaga gerbang.
  it("400 bila branch tak ada di repo untuk dest yang dipilih", async () => {
    await prisma.project.create({ data: { id: "p4", name: "P4", desc: "", kind: "existing", repoDir: repo() } });
    const r = await patchProject("p4", { mode: "branch", dest: "local", branch: "karangan" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/karangan/);
  });

  it("menerima branch lokal yang nyata dan mengembalikannya di ProjectView", async () => {
    await prisma.project.create({ data: { id: "p5", name: "P5", desc: "", kind: "existing", repoDir: repo() } });
    const r = await patchProject("p5", { mode: "branch", dest: "local", branch: "develop", deleteBranch: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().autoMerge).toEqual({ mode: "branch", dest: "local", branch: "develop", deleteBranch: true });
  });

  it("null mengosongkan kebijakan project", async () => {
    await prisma.project.create({
      data: { id: "p6", name: "P6", desc: "", kind: "existing", repoDir: repo(),
        autoMerge: { mode: "default-branch", dest: "local", branch: null, deleteBranch: false } },
    });
    const r = await patchProject("p6", null);
    expect(r.statusCode).toBe(200);
    expect(r.json().autoMerge).toBeNull();
  });

  it("GET /projects/:id/branches memberi defaultBranch", async () => {
    await prisma.project.create({ data: { id: "p7", name: "P7", desc: "", kind: "existing", repoDir: repo() } });
    const r = await app.inject({ method: "GET", url: "/api/projects/p7/branches" });
    expect(r.json().defaultBranch).toBe("main");
  });
});

describe("override per-spec (SPEC-486)", () => {
  const spec = async (repoDir: string) => {
    await prisma.project.create({ data: { id: "px", name: "PX", desc: "", kind: "existing", repoDir } });
    await prisma.spec.create({
      data: { id: "SPEC-9", projectId: "px", title: "a", source: "brief", stage: "executing",
        priority: "sedang", author: "a", objective: "", baseSha: "abc" },
    });
  };

  // Cermin dependsOn (ADR-0093): kebijakan ini menggerbangi apa yang terjadi SESUDAH kerja,
  // bukan konten yang sedang dikerjakan sesi hidup — jadi ia di luar gerbang `editingContent`.
  it("boleh diubah walau item sudah dimulai", async () => {
    await spec(repo());
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-9",
      payload: { autoMerge: { mode: "branch", dest: "local", branch: "develop" } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().autoMerge).toEqual({ mode: "branch", dest: "local", branch: "develop", deleteBranch: false });
  });

  it("400 untuk branch karangan", async () => {
    await spec(repo());
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-9",
      payload: { autoMerge: { mode: "branch", dest: "local", branch: "karangan" } },
    });
    expect(r.statusCode).toBe(400);
  });

  it("null mengembalikan item ke warisan project", async () => {
    await spec(repo());
    await app.inject({ method: "PATCH", url: "/api/specs/SPEC-9",
      payload: { autoMerge: { mode: "off" } } });
    const r = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-9", payload: { autoMerge: null } });
    expect(r.statusCode).toBe(200);
    expect(r.json().autoMerge).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/auto-merge.route.test.ts`
Expected: FAIL — `autoMerge` dibuang zod (non-strict) sehingga respons tak memuatnya; test 409/400 gagal karena status 200.

- [x] **Step 3: Write minimal implementation**

Create `server/src/services/auto-merge-gate.ts`:

```ts
import { autoMergeOf, type AutoMerge } from "@hanoman/shared";
import { listRepoBranches, listRepoRemoteBranches, defaultBranch } from "./branches";

// SPEC-486 · ADR-0103 · gerbang tulis kebijakan auto-merge. SATU definisi untuk dua route
// (`PATCH /projects/:id` & `PATCH /specs/:id`) — dua salinan akan berbeda persis di kasus yang
// jarang diuji, kelas bug SPEC-431/475.
//
// Prinsip SPEC-143/ADR-0032 ditegakkan: daftar yang memasok dropdown adalah daftar yang menjaga
// gerbang. Branch karangan ditolak DI SINI, bukan berjam-jam kemudian saat sweep mencoba merge.
export type GateResult = { ok: true } | { ok: false; code: 400 | 409; error: string };

export async function checkAutoMerge(repoDir: string | null, raw: unknown): Promise<GateResult> {
  if (raw === null || raw === undefined) return { ok: true };   // mengosongkan selalu boleh
  const p = autoMergeOf(raw);
  if (!p) return { ok: false, code: 400, error: "bentuk kebijakan auto-merge tak sah" };
  // Mematikan auto-merge tak butuh repo sama sekali — jangan kunci pintu keluar.
  if (p.mode === "off") return { ok: true };
  if (!repoDir)
    return { ok: false, code: 409, error: "project belum di-bind ke checkout lokal — atur repoDir dulu sebelum menyalakan auto-merge" };
  if (p.mode === "default-branch") {
    return (await defaultBranch(repoDir))
      ? { ok: true }
      : { ok: false, code: 400, error: "default branch repo tak bisa diresolve (tak ada origin/HEAD, main, maupun master) — pilih branch tujuan secara eksplisit" };
  }
  if (!p.branch) return { ok: false, code: 400, error: "mode \"branch\" butuh branch tujuan" };
  const known = p.dest === "origin" ? await listRepoRemoteBranches(repoDir) : await listRepoBranches(repoDir);
  return known.includes(p.branch)
    ? { ok: true }
    : { ok: false, code: 400, error: `branch "${p.branch}" tidak ada di ${p.dest === "origin" ? "origin" : "repo lokal"} project` };
}

export type { AutoMerge };
```

Modify `shared/src/dto.ts`:

1. Tambahkan import di baris import zod/entities yang sudah ada — `zAutoMerge` diimpor dari `./auto-merge`:

```ts
import { zAutoMerge } from "./auto-merge";
```

2. Di `zUpdateProject`, sesudah baris `leadOptIn`:

```ts
  // SPEC-486 · ADR-0103 · kebijakan auto-merge project (null = kosongkan → tanpa auto-merge).
  // Divalidasi server terhadap repo (checkAutoMerge): repoDir wajib ada, branch wajib nyata.
  autoMerge: zAutoMerge.nullable().optional(),
```

3. Di `zPatchSpec`, sesudah blok `dependsOn`:

```ts
  // SPEC-486 · ADR-0103 · override per item; `null` mengembalikannya ke warisan project.
  // SENGAJA di luar gerbang `editingContent` (SPEC-186), sama seperti dependsOn: ia menggerbangi
  // apa yang terjadi SESUDAH kerja, bukan konten yang sedang dikerjakan sesi hidup.
  autoMerge: zAutoMerge.nullable().optional(),
```

4. Di `zProjectView`, sesudah `leadOptIn`:

```ts
  autoMerge: zAutoMerge.nullable().default(null),   // SPEC-486 · ADR-0103 · null = tanpa auto-merge
```

Modify `server/src/services/project-view.ts` — tambahkan di objek balikan `toProjectView`, sesudah `leadOptIn`:

```ts
    // SPEC-486 · ADR-0103 · kebijakan auto-merge (lokal per-instance, cermin schedulerOptIn).
    autoMerge: autoMergeOf((p as { autoMerge?: unknown }).autoMerge),
```

…dengan import `import { autoMergeOf } from "@hanoman/shared";` (gabungkan ke import `@hanoman/shared` yang sudah ada bila memungkinkan — berkas ini saat ini hanya mengimpor `type ProjectView`, jadi jadikan dua baris: `import type { ProjectView } from "@hanoman/shared";` tetap, tambahkan `import { autoMergeOf } from "@hanoman/shared";`).

Modify `server/src/routes/projects.ts`:

1. Import:

```ts
import { listRepoBranches, listRepoRemoteBranches, defaultBranch } from "../services/branches";
import { checkAutoMerge } from "../services/auto-merge-gate";
```

2. Di handler `app.patch("/projects/:id")`, sesudah cek 404 dan sebelum `prisma.project.update`:

```ts
    // SPEC-486 · ADR-0103 · kebijakan divalidasi terhadap repo EFEKTIF (binding ?? repoDir).
    if ("autoMerge" in parsed.data) {
      const gate = await checkAutoMerge(await resolveRepoDir(id), parsed.data.autoMerge);
      if (!gate.ok) return reply.code(gate.code).send({ error: gate.error });
    }
```

3. Di handler `GET /projects/:id/branches`, ganti baris `return {...}` menjadi:

```ts
    // SPEC-486 · defaultBranch memasok label opsi "default branch repo" di kartu auto-merge.
    return {
      branches: await listRepoBranches(repoDir),
      remotes: await listRepoRemoteBranches(repoDir),
      defaultBranch: await defaultBranch(repoDir),
    };
```

Modify `server/src/routes/specs.ts`:

1. Import: `import { checkAutoMerge } from "../services/auto-merge-gate";`

2. Di handler `app.patch("/specs/:id")`, ubah destrukturisasi menjadi:

```ts
    const { branchFrom, stage, confirmDelete, title, priority: newPriority, payload, dependsOn, autoMerge } = parsed.data;
```

3. Sesudah blok validasi `dependsOn`, tambahkan:

```ts
    // SPEC-486 · ADR-0103 · cermin dependsOn: di luar gerbang `editingContent`, divalidasi
    // terhadap repo efektif project item ini.
    if ("autoMerge" in parsed.data) {
      const gate = await checkAutoMerge(await resolveRepoDir(spec.projectId), autoMerge);
      if (!gate.ok) return reply.code(gate.code).send({ error: gate.error });
    }
```

4. Perluas tipe `data` dan penulisannya:

```ts
    const data: { branchFrom?: string | null; stage?: string; title?: string; priority?: string; objective?: string; payload?: any; dependsOn?: string[]; autoMerge?: any } = {};
```

dan sesudah baris `if (depIds !== undefined) data.dependsOn = depIds;`:

```ts
    // Prisma `Json?` menolak `null` polos — `Prisma.DbNull` yang mengosongkan kolom (SPEC-480).
    if ("autoMerge" in parsed.data) data.autoMerge = autoMerge === null ? Prisma.DbNull : autoMerge;
```

…dengan `import { Prisma } from "@prisma/client";` ditambahkan di kepala berkas.

Terapkan pola `Prisma.DbNull` yang sama di `routes/projects.ts`: sebelum `prisma.project.update`, ganti `data: parsed.data` menjadi:

```ts
    const data: Record<string, unknown> = { ...parsed.data };
    if ("autoMerge" in data && data.autoMerge === null) data.autoMerge = Prisma.DbNull;
    const updated = await prisma.project.update({ where: { id }, data });
```

…dengan `import { Prisma } from "@prisma/client";` di kepala berkas.

Modify `src/src/api/client.ts` (kontrak klien ikut di task ini supaya tak ada drift tipe):

```ts
  listBranches: (id: string) => j<{ branches: string[]; remotes: string[]; defaultBranch?: string | null }>(paths.branches(id)),
```

dan pada `updateProject` tambahkan `autoMerge?: AutoMerge | null;` ke tipe body, serta pada `patchSpec` tambahkan `autoMerge?: AutoMerge | null;` — dengan `AutoMerge` diimpor dari `@hanoman/shared` di kepala berkas.

- [x] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/auto-merge.route.test.ts server/test/branches.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/dto.ts server/src/services/auto-merge-gate.ts server/src/services/project-view.ts server/src/routes/projects.ts server/src/routes/specs.ts src/src/api/client.ts server/test/auto-merge.route.test.ts
git commit -m "feat(486): gerbang tulis kebijakan auto-merge di route project & spec"
```

---

### Task 5: Sweep auto-merge — inti eksekusi

**Files:**
- Modify: `server/src/services/integrate.ts` (ekspor dua helper yang sudah ada)
- Modify: `server/src/services/notifications.ts` (`recordAutoMerge`)
- Create: `server/src/services/auto-merge.ts`
- Create: `server/test/auto-merge.service.test.ts`

**Interfaces:**
- Consumes: `resolveAutoMerge`, `autoMergeTargetOf` (Task 1); `defaultBranch` (Task 3); `integrate`, `sourceBranch` (`services/integrate.ts`); `resolveRepoDir`
- Produces:
  - `AUTO_MERGE_WINDOW_MS`, `AUTO_MERGE_GRACE_MS`
  - `type AutoMergeDeps`
  - `prodAutoMergeDeps: AutoMergeDeps`
  - `sweepAutoMerge(deps?: AutoMergeDeps, now?: Date): Promise<number>` — jumlah spec yang **diselesaikan** (ditandai) pada putaran itu
  - `discardMergeWorktree(repoDir, wt)` & `deleteMergedBranch(repoDir, branch)` diekspor dari `integrate.ts`
  - `recordAutoMerge(specId, projectId, title)` di `notifications.ts`

- [x] **Step 1: Write the failing test**

Create `server/test/auto-merge.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import { sweepAutoMerge, AUTO_MERGE_GRACE_MS, AUTO_MERGE_WINDOW_MS, type AutoMergeDeps } from "../src/services/auto-merge";
import type { IntegrateResult } from "../src/services/integrate";

const clean = async () => {
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const NOW = new Date("2026-08-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const POLICY = { mode: "default-branch", dest: "local", branch: null, deleteBranch: false };

async function seed(opts: {
  projectPolicy?: unknown; specPolicy?: unknown; headSha?: string | null; doneAt?: Date;
} = {}) {
  await prisma.project.create({
    data: { id: "p", name: "P", desc: "", kind: "existing", repoDir: "/repo",
      ...(opts.projectPolicy !== undefined ? { autoMerge: opts.projectPolicy as object } : {}) },
  });
  await prisma.spec.create({
    data: { id: "SPEC-1", projectId: "p", title: "Fitur", source: "brief", stage: "done",
      priority: "sedang", author: "a", objective: "", headSha: opts.headSha ?? "aaa",
      ...(opts.specPolicy !== undefined ? { autoMerge: opts.specPolicy as object } : {}) },
  });
  await prisma.notification.create({
    data: { type: "done", key: "done:SPEC-1", specId: "SPEC-1", projectId: "p",
      title: "Fitur", createdAt: opts.doneAt ?? ago(60_000) },
  });
}

function deps(over: Partial<AutoMergeDeps> = {}): AutoMergeDeps {
  return {
    repoDir: async () => "/repo",
    defaultBranch: async () => "main",
    sourceTip: async () => "tip1",
    contains: async () => true,
    integrate: (async () => ({ status: "clean", detail: "lokal main → tip1" })) as AutoMergeDeps["integrate"],
    discardWorktree: async () => { },
    deleteBranch: async () => { },
    ...over,
  };
}
const marker = () => prisma.notification.findUnique({ where: { key: "automerge:SPEC-1" } });

describe("sweepAutoMerge — gerbang kandidat", () => {
  it("tanpa kebijakan: nol panggilan integrate, nol penanda (perilaku lama utuh)", async () => {
    await seed();
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
    expect(await marker()).toBeNull();
  });

  it("spec bisa MEMATIKAN kebijakan project untuk dirinya sendiri", async () => {
    await seed({ projectPolicy: POLICY, specPolicy: { mode: "off" } });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
  });

  it("spec bisa MENYALAKAN auto-merge di project tanpa kebijakan", async () => {
    await seed({ specPolicy: { mode: "branch", dest: "origin", branch: "rilis" } });
    const integrate = vi.fn(async () => ({ status: "clean", detail: "push origin rilis" } as IntegrateResult));
    await sweepAutoMerge(deps({ integrate: integrate as never }), NOW);
    expect(integrate).toHaveBeenCalledWith("/repo", "SPEC-1", "merge", "origin:rilis");
  });

  // Menyalakan setting TIDAK boleh menggabungkan seluruh sejarah project.
  it("spec yang selesai lebih dari 24 jam lalu bukan kandidat sama sekali", async () => {
    await seed({ projectPolicy: POLICY, doneAt: ago(AUTO_MERGE_WINDOW_MS + 60_000) });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
    expect(await marker()).toBeNull();
  });

  it("stage yang belum done bukan kandidat", async () => {
    await seed({ projectPolicy: POLICY });
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { stage: "executing" } });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
  });

  it("penanda mencegah percobaan kedua (idempoten lintas restart)", async () => {
    await seed({ projectPolicy: POLICY });
    await sweepAutoMerge(deps(), NOW);
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
  });
});

describe("sweepAutoMerge — kesiapan branch", () => {
  it("branch belum ada & masih dalam grace → diam, tak menandai, dicoba lagi nanti", async () => {
    await seed({ projectPolicy: POLICY, doneAt: ago(60_000) });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ sourceTip: async () => null, integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
    expect(await marker()).toBeNull();
  });

  it("headSha belum jadi leluhur tip (push belum mendarat) → tunggu", async () => {
    await seed({ projectPolicy: POLICY, doneAt: ago(60_000) });
    const integrate = vi.fn();
    await sweepAutoMerge(deps({ contains: async () => false, integrate: integrate as never }), NOW);
    expect(integrate).not.toHaveBeenCalled();
  });

  it("lewat grace tanpa branch → MENYERAH DENGAN SUARA (notifikasi + penanda)", async () => {
    await seed({ projectPolicy: POLICY, doneAt: ago(AUTO_MERGE_GRACE_MS + 60_000) });
    expect(await sweepAutoMerge(deps({ sourceTip: async () => null }), NOW)).toBe(1);
    const n = await marker();
    expect(n!.type).toBe("automerge");
    expect(n!.title).toMatch(/belum ter-push/);
  });

  it("headSha null → branch apa adanya sudah cukup", async () => {
    await seed({ projectPolicy: POLICY, headSha: null });
    const integrate = vi.fn(async () => ({ status: "clean", detail: "ok" } as IntegrateResult));
    await sweepAutoMerge(deps({ contains: async () => false, integrate: integrate as never }), NOW);
    expect(integrate).toHaveBeenCalled();
  });
});

describe("sweepAutoMerge — hasil", () => {
  it("clean → notifikasi sukses menyebut tujuan", async () => {
    await seed({ projectPolicy: POLICY });
    expect(await sweepAutoMerge(deps(), NOW)).toBe(1);
    const n = await marker();
    expect(n!.title).toMatch(/SPEC-1/);
    expect(n!.title).toMatch(/local:main/);
    expect(n!.specId).toBe("SPEC-1");
  });

  it("clean + deleteBranch mati → branch kerja TIDAK dihapus", async () => {
    await seed({ projectPolicy: POLICY });
    const deleteBranch = vi.fn();
    await sweepAutoMerge(deps({ deleteBranch }), NOW);
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it("clean + deleteBranch nyala → branch kerja dihapus SESUDAH merge bersih", async () => {
    await seed({ projectPolicy: { ...POLICY, deleteBranch: true } });
    const deleteBranch = vi.fn();
    await sweepAutoMerge(deps({ deleteBranch }), NOW);
    expect(deleteBranch).toHaveBeenCalledWith("/repo", "hanoman/spec-1");
  });

  it("conflict → worktree merge dibersihkan, branch kerja TIDAK dihapus, notifikasi berisi alasan", async () => {
    await seed({ projectPolicy: { ...POLICY, deleteBranch: true } });
    const discardWorktree = vi.fn();
    const deleteBranch = vi.fn();
    const integrate = (async () => ({
      status: "conflict", worktree: "/repo/.worktrees/merge-spec-1", op: "merge",
      source: "refs/remotes/origin/hanoman/spec-1", target: "local:main", finalize: "…",
    })) as AutoMergeDeps["integrate"];
    expect(await sweepAutoMerge(deps({ integrate, discardWorktree, deleteBranch }), NOW)).toBe(1);
    expect(discardWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/merge-spec-1");
    expect(deleteBranch).not.toHaveBeenCalled();
    const n = await marker();
    expect(n!.title).toMatch(/konflik/i);
    expect(n!.title).toMatch(/branch kerja/i);
  });

  it("error → notifikasi memuat pesan galat apa adanya", async () => {
    await seed({ projectPolicy: POLICY });
    const integrate = (async () => ({
      status: "error", code: 409, error: "push origin main ditolak — target maju di origin, fetch dulu",
    })) as AutoMergeDeps["integrate"];
    await sweepAutoMerge(deps({ integrate }), NOW);
    expect((await marker())!.title).toMatch(/target maju di origin/);
  });

  it("project tanpa repoDir → dilewati dengan suara, tanpa menyentuh git", async () => {
    await seed({ projectPolicy: POLICY });
    const integrate = vi.fn();
    await sweepAutoMerge(deps({ repoDir: async () => null, integrate: integrate as never }), NOW);
    expect(integrate).not.toHaveBeenCalled();
    expect((await marker())!.title).toMatch(/checkout lokal/);
  });

  it("default branch tak terbaca → dilewati dengan suara, bukan menebak main", async () => {
    await seed({ projectPolicy: POLICY });
    const integrate = vi.fn();
    await sweepAutoMerge(deps({ defaultBranch: async () => null, integrate: integrate as never }), NOW);
    expect(integrate).not.toHaveBeenCalled();
    expect((await marker())!.title).toMatch(/default branch/i);
  });

  it("satu spec yang meledak tak menghentikan sisanya", async () => {
    await seed({ projectPolicy: POLICY });
    await prisma.spec.create({
      data: { id: "SPEC-2", projectId: "p", title: "Kedua", source: "brief", stage: "done",
        priority: "sedang", author: "a", objective: "", headSha: "bbb" },
    });
    await prisma.notification.create({
      data: { type: "done", key: "done:SPEC-2", specId: "SPEC-2", projectId: "p",
        title: "Kedua", createdAt: ago(60_000) },
    });
    const integrate = (async (_r: string, specId: string) => {
      if (specId === "SPEC-1") throw new Error("git meledak");
      return { status: "clean", detail: "ok" };
    }) as AutoMergeDeps["integrate"];
    await sweepAutoMerge(deps({ integrate }), NOW);
    expect(await prisma.notification.findUnique({ where: { key: "automerge:SPEC-2" } })).not.toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/auto-merge.service.test.ts`
Expected: FAIL — `Failed to resolve import "../src/services/auto-merge"`.

- [x] **Step 3: Write minimal implementation**

Modify `server/src/services/integrate.ts` — ubah dua fungsi privat jadi ekspor bernama (isi tak berubah), dan beri komentar alasannya:

```ts
// SPEC-486 · ADR-0103 · dipakai juga sweep auto-merge untuk MEMBUANG worktree konflik yang
// tertinggal: auto-merge sengaja TIDAK melahirkan sesi agen (kontrak ADR-0031 mengharapkannya,
// tapi membakar kuota tanpa diminta bukan yang diminta operator), jadi ia harus membereskannya.
export async function discardMergeWorktree(repoDir: string, wt: string): Promise<void> {
  await reclaim(repoDir, wt);
}
```

…dan ubah `async function deleteMergedBranch(` menjadi `export async function deleteMergedBranch(`, dengan tambahan pada komentarnya:

```ts
// SPEC-486 · pemanggil KEDUA: sweep auto-merge, hanya sesudah `status === "clean"` (batasan
// "tidak boleh menghapus branch kerja sebelum merge sukses").
```

Modify `server/src/services/notifications.ts` — tambahkan sesudah `recordFailure`:

```ts
// SPEC-486 · ADR-0103 · hasil auto-merge sebuah backlog item. Baris ini merangkap DUA peran:
// laporan ke operator DAN penanda idempotensi durable — `key` unik membuat sweep berikutnya
// (dan sweep sesudah restart) tak pernah mencoba item yang sama dua kali. Pola yang sama dipakai
// `recordCompletion`; ADR-0091 sudah menetapkan idempotensi lewat jejak DB, bukan `Set` memori.
export async function recordAutoMerge(
  specId: string, projectId: string | null, title: string,
): Promise<void> {
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: { type: "automerge", key: `automerge:${specId}`, specId, sessionId, title, projectId },
  }).catch(() => { /* P2002: sudah ada — sweep lain sudah menyelesaikannya */ });
}
```

Create `server/src/services/auto-merge.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAutoMerge, autoMergeTargetOf } from "@hanoman/shared";
import { prisma } from "../db";
import { integrate, sourceBranch, discardMergeWorktree, deleteMergedBranch } from "./integrate";
import { resolveRepoDir } from "./local-binding";
import { defaultBranch } from "./branches";
import { recordAutoMerge } from "./notifications";

// SPEC-486 · ADR-0103 · EKSEKUTOR kebijakan auto-merge.
//
// Kenapa sweep dan bukan hook di titik `done`: `stage = "done"` dipersist di TIGA jalur
// (`live-specs.ts`, `scheduler/reconcile.ts`, `DELETE /terminal/sessions/:id`), dan menempelkan
// efek samping di ketiganya adalah kelas bug yang sudah digigit repo ini empat kali
// (SPEC-431/448/475/481) — efek samping tak punya tipe yang memaksanya konsisten. Lebih dari itu,
// tak satu pun dari ketiganya AMAN sebagai pemicu: prompt sesi menyuruh agen menulis baris fase
// terakhir LEBIH DULU, baru `commit` + `git push`. `liveSpecs` karena itu bisa memindahkan stage
// ke `done` beberapa detik sebelum `hanoman/<spec>` ada di origin.
//
// Sweep menyelesaikan keduanya sekaligus: nol call site, dan "belum siap" cukup dicoba lagi.

/** Selesai lebih lama dari ini = sejarah. Pagar yang membuat MENYALAKAN setting tak pernah
 *  menggabungkan seluruh backlog lama sebuah project. */
export const AUTO_MERGE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Sesudah ini, branch kerja yang tak kunjung muncul dilaporkan — bukan ditunggu diam-diam. */
export const AUTO_MERGE_GRACE_MS = 15 * 60 * 1000;
const TICK_MS = 60_000;

export type AutoMergeDeps = {
  repoDir: (projectId: string) => Promise<string | null>;
  defaultBranch: (repoDir: string) => Promise<string | null>;
  /** Tip `hanoman/<spec>`: origin lebih dulu (hasil push), lalu lokal. null = branch belum ada. */
  sourceTip: (repoDir: string, branch: string) => Promise<string | null>;
  /** `sha` sudah menjadi leluhur `tip`? = bukti push sesi sudah mendarat. */
  contains: (repoDir: string, tip: string, sha: string) => Promise<boolean>;
  integrate: typeof integrate;
  discardWorktree: (repoDir: string, wt: string) => Promise<void>;
  deleteBranch: (repoDir: string, branch: string) => Promise<void>;
};

const exec = promisify(execFile);
const GIT = { timeout: 30_000, maxBuffer: 1 << 24, encoding: "utf8" as const };
const gitOut = async (cwd: string, args: string[]): Promise<string | null> => {
  try { return (await exec("git", args, { cwd, ...GIT })).stdout.trim(); } catch { return null; }
};

export const prodAutoMergeDeps: AutoMergeDeps = {
  repoDir: resolveRepoDir,
  defaultBranch,
  // Tanpa `fetch`: `git push` dari worktree repo yang sama memperbarui remote-tracking ref
  // di repo itu juga, jadi origin/<branch> sudah mutakhir tepat setelah sesi mem-push.
  sourceTip: async (repoDir, branch) =>
    (await gitOut(repoDir, ["rev-parse", "--verify", "-q", "--end-of-options", `refs/remotes/origin/${branch}^{commit}`]))
    ?? (await gitOut(repoDir, ["rev-parse", "--verify", "-q", "--end-of-options", `refs/heads/${branch}^{commit}`])),
  // `merge-base --is-ancestor` keluar 0/1 tanpa output → "" saat benar, null saat salah/galat.
  contains: async (repoDir, tip, sha) =>
    (await gitOut(repoDir, ["merge-base", "--is-ancestor", "--end-of-options", sha, tip])) !== null,
  integrate,
  discardWorktree: discardMergeWorktree,
  deleteBranch: deleteMergedBranch,
};

type Candidate = { specId: string; projectId: string; doneAt: Date };

/** Kandidat mentah = notifikasi `done:` dalam window yang BELUM punya penanda `automerge:`.
 *  Baris `done:` ditulis `recordCompletion` tepat pada transisi ke `done` di ketiga jalur, jadi
 *  ia satu-satunya stempel "kapan item ini selesai" yang sudah ada dan konsisten. */
async function candidates(now: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - AUTO_MERGE_WINDOW_MS);
  const done = await prisma.notification.findMany({
    where: { type: "done", createdAt: { gte: since }, specId: { not: null } },
    select: { specId: true, projectId: true, createdAt: true },
  });
  if (!done.length) return [];
  const keys = done.map((d) => `automerge:${d.specId}`);
  const marked = new Set(
    (await prisma.notification.findMany({ where: { key: { in: keys } }, select: { key: true } }))
      .map((n) => n.key!),
  );
  return done
    .filter((d) => !marked.has(`automerge:${d.specId}`))
    .map((d) => ({ specId: d.specId!, projectId: d.projectId ?? "", doneAt: d.createdAt }));
}

/** Satu putaran. Mengembalikan jumlah item yang DISELESAIKAN (ditandai) pada putaran ini —
 *  item yang sengaja ditunggu tidak dihitung. */
export async function sweepAutoMerge(
  deps: AutoMergeDeps = prodAutoMergeDeps, now: Date = new Date(),
): Promise<number> {
  const list = await candidates(now);
  if (!list.length) return 0;
  let settled = 0;
  for (const c of list) {
    try { if (await settleOne(c, deps, now)) settled++; }
    catch (e) { console.error(`auto-merge ${c.specId}:`, e); }   // satu item gagal ≠ sisanya batal
  }
  return settled;
}

async function settleOne(c: Candidate, deps: AutoMergeDeps, now: Date): Promise<boolean> {
  const spec = await prisma.spec.findUnique({ where: { id: c.specId } });
  if (!spec || spec.stage !== "done") return false;
  const project = await prisma.project.findUnique({ where: { id: spec.projectId } });
  if (!project) return false;

  const policy = resolveAutoMerge(
    (project as { autoMerge?: unknown }).autoMerge, (spec as { autoMerge?: unknown }).autoMerge);
  if (policy.mode === "off") return false;   // tak ada kebijakan → tak ada jejak, tak ada penanda

  const report = (t: string) => recordAutoMerge(spec.id, spec.projectId, t).then(() => true);

  const repoDir = await deps.repoDir(spec.projectId);
  if (!repoDir)
    return report(`Auto-merge ${spec.id} dilewati — project belum di-bind ke checkout lokal`);

  const target = autoMergeTargetOf(
    policy, policy.mode === "default-branch" ? await deps.defaultBranch(repoDir) : null);
  if (!target)
    return report(`Auto-merge ${spec.id} dilewati — default branch repo tak bisa diresolve; pilih branch tujuan di Settings project`);

  // Kesiapan: branch kerja ADA, dan (bila ujung kerjanya diketahui) push-nya sudah mendarat.
  const branch = sourceBranch(spec.id);
  const tip = await deps.sourceTip(repoDir, branch);
  const ready = tip !== null && (spec.headSha === null || await deps.contains(repoDir, tip, spec.headSha));
  if (!ready) {
    if (now.getTime() - c.doneAt.getTime() <= AUTO_MERGE_GRACE_MS) return false;   // tunggu, coba lagi
    return report(`Auto-merge ${spec.id} dilewati — branch kerja \`${branch}\` belum ter-push ke origin`);
  }

  const res = await deps.integrate(repoDir, spec.id, "merge", target);
  if (res.status === "clean") {
    // Hapus branch kerja HANYA sesudah merge terbukti bersih (batasan spec). Best-effort:
    // kegagalan hapus tak me-rollback merge yang sudah mendarat.
    if (policy.deleteBranch) await deps.deleteBranch(repoDir, branch).catch(() => { });
    return report(`Auto-merge ${spec.id} → ${target} bersih (${res.detail})`);
  }
  if (res.status === "conflict") {
    // ADR-0031 meninggalkan worktree konflik untuk sesi agen; auto-merge tak melahirkan sesi,
    // jadi ia membereskannya sendiri. Branch kerja TIDAK tersentuh — operator bisa menekan
    // Rebase/Merge di dashboard dan mendapat jalur konflik ADR-0031 yang lengkap.
    await deps.discardWorktree(repoDir, res.worktree).catch(() => { });
    return report(`Auto-merge ${spec.id} → ${target} GAGAL: konflik — branch kerja \`${branch}\` utuh, selesaikan lewat Rebase / Merge di backlog`);
  }
  return report(`Auto-merge ${spec.id} → ${target} GAGAL: ${res.error}`);
}

let timer: NodeJS.Timeout | undefined;
let busy = false;

export async function tick(): Promise<void> {
  if (busy) return;   // satu putaran bisa memakan detik (fetch + merge); jangan menumpuk
  busy = true;
  try { await sweepAutoMerge(); }
  catch (e) { console.error("auto-merge sweep:", e); }
  finally { busy = false; }
}

/** Dipanggil `server.ts` SAJA (app.ts bebas-timer). unref → tak menahan proses. */
export function startAutoMerge(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}
export function stopAutoMerge(): void { if (timer) clearInterval(timer); timer = undefined; }
```

- [x] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/auto-merge.service.test.ts`
Expected: PASS — 18 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/auto-merge.ts server/src/services/integrate.ts server/src/services/notifications.ts server/test/auto-merge.service.test.ts
git commit -m "feat(486): sweep auto-merge — kandidat, kesiapan branch, hasil ber-notifikasi"
```

---

### Task 6: Pasang sweep di `server.ts`

**Files:**
- Modify: `server/src/server.ts`
- Create: `server/test/auto-merge-timer.test.ts`

**Interfaces:**
- Consumes: `startAutoMerge`, `stopAutoMerge`, `tick` (Task 5)
- Produces: —

- [x] **Step 1: Write the failing test**

Create `server/test/auto-merge-timer.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startAutoMerge, stopAutoMerge } from "../src/services/auto-merge";

afterEach(() => stopAutoMerge());

describe("timer sweep auto-merge (SPEC-486)", () => {
  it("startAutoMerge idempoten — dua panggilan satu timer", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startAutoMerge();
    startAutoMerge();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  // app.ts bebas-timer (kontrak SPEC-294/ADR-0072): test yang mem-build app tak boleh
  // menghidupkan pekerjaan latar.
  it("dipasang dari server.ts, bukan app.ts", () => {
    const root = join(__dirname, "..", "src");
    expect(readFileSync(join(root, "server.ts"), "utf8")).toContain("startAutoMerge");
    expect(readFileSync(join(root, "app.ts"), "utf8")).not.toContain("startAutoMerge");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/auto-merge-timer.test.ts`
Expected: FAIL — `server.ts` tak memuat `startAutoMerge`.

- [x] **Step 3: Write minimal implementation**

Modify `server/src/server.ts`:

1. Import sesudah `import { startWebhookEngine } …`:

```ts
import { startAutoMerge } from "./services/auto-merge";
```

2. Sesudah `startWebhookEngine();` di akhir blok `listen().then(…)`:

```ts
  // SPEC-486 · ADR-0103 · sweep auto-merge (in-process, cermin scheduler). Idle penuh saat tak
  // ada backlog selesai dalam 24 jam terakhir: biayanya satu query ringan tiap menit, dan nol
  // sentuhan git selama tak ada project/spec yang meng-opt-in.
  startAutoMerge();
```

- [x] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/auto-merge-timer.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/server.ts server/test/auto-merge-timer.test.ts
git commit -m "feat(486): jalankan sweep auto-merge dari server.ts"
```

---

### Task 7: Kartu "Auto-merge saat sesi selesai" di Settings project

**Files:**
- Create: `src/src/screens/AutoMergeCard.tsx`
- Create: `src/src/screens/AutoMergeCard.test.tsx`
- Modify: `src/src/screens/ProjectDetailScreen.tsx`

**Interfaces:**
- Consumes: `AutoMerge`, `AUTO_MERGE_OFF`, `autoMergeSummary` (Task 1); `api.listBranches`, `api.updateProject` (Task 4)
- Produces: `<AutoMergeCard p={ProjectVM} onToast={…} onProjectChanged={…} />`

- [x] **Step 1: Write the failing test**

Create `src/src/screens/AutoMergeCard.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoMergeCard } from "./AutoMergeCard";
import type { ProjectVM } from "./types";

const base = {
  id: "hanoman", name: "hanoman", desc: "", kind: "existing", repoDir: "/repo", binding: null,
  gitRemote: null, stack: "", docStatus: "ok", coverage: 100, createdAt: "2026-08-01T00:00:00.000Z",
  backlog: 0, topStage: "spec", session: { status: "idle", phase: null, flow: null },
  activity: "idle", commit: "—", helpEnabled: false, schedulerOptIn: false, leadOptIn: false,
  autoMerge: null,
} as unknown as ProjectVM;

const json = (v: unknown, statusCode = 200) =>
  Promise.resolve({ ok: statusCode < 400, status: statusCode, json: async () => v } as Response);

function mockFetch(patch: (b: unknown) => Promise<Response> = () => json({ ...base })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes("/branches")) return json({ branches: ["main", "develop"], remotes: ["main"], defaultBranch: "main" });
    if (init?.method === "PATCH") return patch(JSON.parse(String(init.body)));
    return json({});
  });
}
afterEach(() => vi.restoreAllMocks());

describe("AutoMergeCard", () => {
  it("default: tanpa auto-merge", async () => {
    mockFetch();
    render(<AutoMergeCard p={base} onToast={() => { }} />);
    expect(await screen.findByText(/tanpa auto-merge/i)).toBeTruthy();
  });

  it("tanpa repoDir efektif kontrolnya mati dan alasannya tertulis", async () => {
    mockFetch();
    render(<AutoMergeCard p={{ ...base, repoDir: null, binding: null }} onToast={() => { }} />);
    expect(await screen.findByText(/belum di-bind ke checkout lokal/i)).toBeTruthy();
    expect((screen.getByLabelText("Mode auto-merge") as HTMLSelectElement).disabled).toBe(true);
  });

  it("menyimpan mode default-branch dengan dest pilihan operator", async () => {
    const sent: unknown[] = [];
    mockFetch((b) => { sent.push(b); return json({ ...base, autoMerge: b }); });
    render(<AutoMergeCard p={base} onToast={() => { }} />);
    fireEvent.change(await screen.findByLabelText("Mode auto-merge"), { target: { value: "default-branch" } });
    fireEvent.change(screen.getByLabelText("Tujuan"), { target: { value: "origin" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ autoMerge: { mode: "default-branch", dest: "origin", branch: null, deleteBranch: false } });
  });

  it("mode branch memakai daftar branch repo dan mengirim branch terpilih", async () => {
    const sent: unknown[] = [];
    mockFetch((b) => { sent.push(b); return json({ ...base, autoMerge: b }); });
    render(<AutoMergeCard p={base} onToast={() => { }} />);
    fireEvent.change(await screen.findByLabelText("Mode auto-merge"), { target: { value: "branch" } });
    fireEvent.change(await screen.findByLabelText("Branch tujuan"), { target: { value: "develop" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ autoMerge: { mode: "branch", dest: "local", branch: "develop", deleteBranch: false } });
  });

  it("galat server ditampilkan apa adanya lewat toast", async () => {
    const toasts: string[] = [];
    mockFetch(() => json({ error: "project belum di-bind ke checkout lokal" }, 409));
    render(<AutoMergeCard p={base} onToast={(m) => toasts.push(m)} />);
    fireEvent.change(await screen.findByLabelText("Mode auto-merge"), { target: { value: "default-branch" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(toasts.join(" ")).toMatch(/gagal/i));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest --run src/src/screens/AutoMergeCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./AutoMergeCard"`.

- [x] **Step 3: Write minimal implementation**

Create `src/src/screens/AutoMergeCard.tsx`:

```tsx
import React from "react";
import { Card, Badge, Button, Select, Checkbox } from "../ds";
import { AUTO_MERGE_OFF, autoMergeSummary, type AutoMerge } from "@hanoman/shared";
import { api } from "../api/client";
import type { ProjectVM } from "./types";

// SPEC-486 · ADR-0103 · permukaan kebijakan auto-merge per project. Duduk di Settings project
// (layar yang sama dengan Help Center & Custom agent), bukan di Settings global: kebijakan ini
// milik satu repo, dan branch tujuannya cuma bermakna di sana.
const MODE_OPTS = [
  { value: "off", label: "Tanpa auto-merge (default)" },
  { value: "default-branch", label: "Auto-merge ke default branch repo" },
  { value: "branch", label: "Auto-merge ke branch tujuan…" },
];
const DEST_OPTS = [
  { value: "local", label: "Branch lokal (perbarui ref di checkout ini)" },
  { value: "origin", label: "Origin (push ke remote)" },
];

export function AutoMergeCard({ p, onToast, onProjectChanged }: {
  p: ProjectVM;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onProjectChanged?: (id: string) => void | Promise<void>;
}) {
  const stored = (p as { autoMerge?: AutoMerge | null }).autoMerge ?? null;
  const [form, setForm] = React.useState<AutoMerge>(stored ?? AUTO_MERGE_OFF);
  const [branches, setBranches] = React.useState<{ local: string[]; origin: string[]; def: string | null }>(
    { local: [], origin: [], def: null });
  const [busy, setBusy] = React.useState(false);
  // Path EFEKTIF: binding per-mesin menang atas Project.repoDir (SPEC-217).
  const repoDir = p.binding ?? p.repoDir ?? null;

  React.useEffect(() => { setForm(stored ?? AUTO_MERGE_OFF); }, [stored]);
  React.useEffect(() => {
    let alive = true;
    api.listBranches(p.id)
      .then((r) => { if (alive) setBranches({ local: r.branches, origin: r.remotes, def: r.defaultBranch ?? null }); })
      .catch(() => { if (alive) setBranches({ local: [], origin: [], def: null }); });
    return () => { alive = false; };
  }, [p.id]);

  const pick = branches[form.dest === "origin" ? "origin" : "local"];
  const set = <K extends keyof AutoMerge>(k: K) => (v: AutoMerge[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      // mode "off" dikirim sebagai null: satu bentuk "tak ada kebijakan" di DB, bukan dua.
      await api.updateProject(p.id, { autoMerge: form.mode === "off" ? null : form });
      onToast("Kebijakan auto-merge disimpan", "ok", "git-merge");
      await onProjectChanged?.(p.id);
    } catch (e) {
      onToast(`Gagal menyimpan: ${(e as Error).message}`, "err", "x-circle");
    } finally { setBusy(false); }
  }

  return (
    <Card eyebrow="integrasi" title="Auto-merge saat sesi selesai"
      actions={<Button size="sm" leftIcon="check" disabled={busy || !repoDir} onClick={save}>Simpan</Button>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Saat sebuah backlog item mencapai <b>Selesai</b>, hanoman menggabungkan branch kerjanya
        (<code>hanoman/&lt;spec&gt;</code>) ke branch tujuan. Merge saja — tak pernah rebase, tak pernah
        force-push. Konflik tidak menghapus apa pun: branch kerja tetap utuh dan kamu dapat notifikasi
        berisi alasannya. Item bisa menimpa setelan ini satu per satu dari Backlog.
      </div>
      {!repoDir && (
        <div style={{ fontSize: 12.5, color: "var(--status-warn, var(--text-muted))", marginBottom: 12 }}>
          Project ini belum di-bind ke checkout lokal — atur <b>repoDir</b> dulu (Edit project) sebelum
          menyalakan auto-merge.
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <Badge tone={stored && stored.mode !== "off" ? "ok" : "neutral"} size="sm">
          {autoMergeSummary(stored ?? AUTO_MERGE_OFF)}
        </Badge>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Mode</div>
          <Select size="sm" aria-label="Mode auto-merge" value={form.mode} disabled={!repoDir}
            onChange={(e) => set("mode")(e.target.value as AutoMerge["mode"])} options={MODE_OPTS} />
        </div>
        {form.mode !== "off" && (
          <div>
            <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Tujuan</div>
            <Select size="sm" aria-label="Tujuan" value={form.dest} disabled={!repoDir}
              onChange={(e) => set("dest")(e.target.value as AutoMerge["dest"])} options={DEST_OPTS} />
          </div>
        )}
        {form.mode === "default-branch" && (
          <div style={{ fontSize: 12.5, color: "var(--text-subtle)" }}>
            Default branch repo saat ini: <b>{branches.def ?? "— tak terbaca"}</b>. Diresolve ulang tiap
            kali auto-merge berjalan, jadi mengganti default branch repo tak menyisakan setelan basi.
          </div>
        )}
        {form.mode === "branch" && (
          <div>
            <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Branch tujuan</div>
            <Select size="sm" aria-label="Branch tujuan" value={form.branch ?? ""} disabled={!repoDir || !pick.length}
              onChange={(e) => set("branch")(e.target.value || null)}
              options={[{ value: "", label: "Pilih branch…" }, ...pick.map((b) => ({ value: b, label: b }))]} />
          </div>
        )}
        {form.mode !== "off" && (
          <Checkbox aria-label="Hapus branch kerja setelah merge sukses" checked={form.deleteBranch}
            label="Hapus branch kerja setelah merge sukses"
            onChange={() => set("deleteBranch")(!form.deleteBranch)} />
        )}
      </div>
    </Card>
  );
}
```

Modify `src/src/screens/ProjectDetailScreen.tsx`:

1. Import: `import { AutoMergeCard } from "./AutoMergeCard";`
2. Sisipkan sesudah `<HelpCenterCard … />`:

```tsx
      {/* SPEC-486 · ADR-0103 · kebijakan auto-merge per project (override per item di Backlog). */}
      <AutoMergeCard p={p} onToast={onToast} onProjectChanged={onProjectChanged} />
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest --run src/src/screens/AutoMergeCard.test.tsx`
Expected: PASS — 5 test.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/AutoMergeCard.tsx src/src/screens/AutoMergeCard.test.tsx src/src/screens/ProjectDetailScreen.tsx
git commit -m "feat(486): kartu auto-merge di Settings project"
```

---

### Task 8: Override auto-merge per backlog item

**Files:**
- Modify: `shared/src/entities.ts` (`zSpec`)
- Modify: `src/src/screens/BacklogScreen.tsx`
- Modify: `src/src/App.tsx`
- Create: `src/src/screens/BacklogAutoMerge.test.tsx`

**Interfaces:**
- Consumes: `AutoMerge`, `AUTO_MERGE_OFF`, `autoMergeSummary`, `resolveAutoMerge` (Task 1); `api.patchSpec` (Task 4)
- Produces: prop `onEditAutoMerge?: (s: Spec, v: AutoMerge | null) => void` pada `BacklogScreen` & `SpecDetail`

- [x] **Step 1: Write the failing test**

Create `src/src/screens/BacklogAutoMerge.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BacklogScreen } from "./BacklogScreen";
import type { Spec } from "@hanoman/shared";

const spec = {
  id: "SPEC-1", projectId: "hanoman", title: "Fitur", source: "brief", stage: "executing",
  priority: "sedang", author: "a", objective: "obj",
  payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" },
  branchFrom: null, baseSha: "abc", createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
  dependsOn: [], blockedBy: [], autoMerge: null,
} as unknown as Spec;

const project = {
  id: "hanoman", name: "hanoman", desc: "", kind: "existing", repoDir: "/repo", binding: null,
  gitRemote: null, stack: "", docStatus: "ok", coverage: 100, createdAt: "2026-08-01T00:00:00.000Z",
  backlog: 1, topStage: "spec", session: { status: "idle", phase: null, flow: null },
  activity: "idle", commit: "—", helpEnabled: false, schedulerOptIn: false, leadOptIn: false,
  autoMerge: { mode: "default-branch", dest: "local", branch: null, deleteBranch: false },
} as never;

afterEach(() => vi.restoreAllMocks());
const mockFetch = () => vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
  Promise.resolve({
    ok: true, status: 200,
    json: async () => (String(input).includes("/branches")
      ? { branches: ["main", "develop"], remotes: ["main"], defaultBranch: "main" }
      : {}),
  } as Response));

function open() {
  fireEvent.click(screen.getByText("Fitur"));
}

describe("override auto-merge per backlog item (SPEC-486)", () => {
  it("default menampilkan warisan project apa adanya", async () => {
    mockFetch();
    render(<BacklogScreen backlog={[spec]} projects={[project]} onEditAutoMerge={() => { }} />);
    open();
    expect(await screen.findByText(/ikut project/i)).toBeTruthy();
    expect(screen.getByText(/default branch repo/i)).toBeTruthy();
  });

  it("memilih \"tanpa auto-merge\" mengirim override off", async () => {
    mockFetch();
    const calls: unknown[] = [];
    render(<BacklogScreen backlog={[spec]} projects={[project]}
      onEditAutoMerge={(s, v) => calls.push([s.id, v])} />);
    open();
    fireEvent.change(await screen.findByLabelText("Auto-merge item ini"), { target: { value: "off" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(["SPEC-1", { mode: "off", dest: "local", branch: null, deleteBranch: false }]);
  });

  it("kembali ke \"ikut project\" mengirim null", async () => {
    mockFetch();
    const calls: unknown[] = [];
    render(<BacklogScreen backlog={[{ ...spec, autoMerge: { mode: "off", dest: "local", branch: null, deleteBranch: false } } as never]}
      projects={[project]} onEditAutoMerge={(s, v) => calls.push([s.id, v])} />);
    open();
    fireEvent.change(await screen.findByLabelText("Auto-merge item ini"), { target: { value: "inherit" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(["SPEC-1", null]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest --run src/src/screens/BacklogAutoMerge.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Auto-merge item ini`.

- [x] **Step 3: Write minimal implementation**

Modify `shared/src/entities.ts` — di `zSpec`, sesudah `blockedBy`:

```ts
  // SPEC-486 · ADR-0103 · override kebijakan auto-merge item ini; null = warisi project.
  // `.nullable().default(null)` menjaga respons/klien versi lama tetap parse.
  autoMerge: zAutoMerge.nullable().default(null),
```

…dengan `import { zAutoMerge } from "./auto-merge";` di kepala berkas.

Modify `src/src/screens/BacklogScreen.tsx`:

1. Import: tambahkan `AUTO_MERGE_OFF, autoMergeSummary, resolveAutoMerge, type AutoMerge` ke import `@hanoman/shared` yang sudah ada (atau tambahkan baris import baru).

2. Tambahkan prop pada `SpecDetail` (tanda tangan baris 123 & bloknya di baris 125–140):

```ts
    onEditAutoMerge?: (s: Spec, v: AutoMerge | null) => void;
    projectPolicy?: unknown;   // Project.autoMerge — untuk label "ikut project (…)"
```

3. Sisipkan blok berikut di dalam `SpecDetail`, tepat sesudah blok "Bergantung pada" (sesudah `</div>` yang menutupnya, sebelum `{editing ? (`):

```tsx
      {/* SPEC-486 · ADR-0103 · override kebijakan auto-merge untuk item ini. Pilihan pertama
          menyebut kebijakan project apa adanya supaya tak pernah ada pertanyaan "lalu ini pakai apa". */}
      {onEditAutoMerge && (
        <div style={{ marginBottom: 14 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Auto-merge saat selesai</div>
          <Select size="sm" aria-label="Auto-merge item ini"
            value={spec.autoMerge ? spec.autoMerge.mode : "inherit"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "inherit") return onEditAutoMerge(spec, null);
              if (v === "off") return onEditAutoMerge(spec, { ...AUTO_MERGE_OFF });
              onEditAutoMerge(spec, {
                ...(spec.autoMerge ?? AUTO_MERGE_OFF),
                mode: v as AutoMerge["mode"],
                branch: v === "branch" ? (spec.autoMerge?.branch ?? branches[0] ?? null) : null,
              });
            }}
            options={[
              { value: "inherit", label: `Ikut project (${autoMergeSummary(resolveAutoMerge(projectPolicy, null))})` },
              { value: "off", label: "Tanpa auto-merge untuk item ini" },
              { value: "default-branch", label: "Auto-merge ke default branch repo" },
              { value: "branch", label: "Auto-merge ke branch tujuan…" },
            ]} />
          {spec.autoMerge?.mode === "branch" && (
            <div style={{ marginTop: 6 }}>
              <Select size="sm" aria-label="Branch tujuan item ini" value={spec.autoMerge.branch ?? ""}
                onChange={(e) => onEditAutoMerge(spec, { ...spec.autoMerge!, branch: e.target.value || null })}
                options={[{ value: "", label: "Pilih branch…" },
                  ...branches.map((b) => ({ value: b, label: b }))]} />
            </div>
          )}
        </div>
      )}
```

4. Pada tanda tangan `BacklogScreen` (baris 652) tambahkan `onEditAutoMerge` ke daftar props dan tipenya:

```ts
    onEditAutoMerge?: (s: Spec, v: AutoMerge | null) => void;
```

5. Pada pemakaian `<SpecDetail … />` (baris ~806) teruskan:

```tsx
        onEditAutoMerge={onEditAutoMerge}
        projectPolicy={(projects.find((x) => x.id === detail?.projectId) as { autoMerge?: unknown } | undefined)?.autoMerge}
```

(Sesuaikan nama variabel `detail` dengan nama state spec terpilih yang sudah dipakai di berkas itu.)

Modify `src/src/App.tsx` — tambahkan handler di sebelah `editDeps` (cari `const editDeps =`) dan teruskan ke `<BacklogScreen>` di baris ~1094:

```tsx
  // SPEC-486 · ADR-0103 · override kebijakan auto-merge item. null = kembali ikut project.
  const editAutoMerge = async (s: Spec, v: AutoMerge | null) => {
    try { await api.patchSpec(s.id, { autoMerge: v }); await refreshBacklog(); }
    catch (e) { showToast(`Gagal menyimpan auto-merge: ${(e as Error).message}`, "err", "x-circle"); }
  };
```

```tsx
          onEditAutoMerge={editAutoMerge}
```

(Gunakan nama fungsi refresh & toast yang sudah dipakai `editDeps` di berkas itu — jangan memperkenalkan yang baru. Impor `type AutoMerge` dari `@hanoman/shared`.)

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest --run src/src/screens/BacklogAutoMerge.test.tsx`
Expected: PASS — 3 test.

- [x] **Step 5: Commit**

```bash
git add shared/src/entities.ts src/src/screens/BacklogScreen.tsx src/src/screens/BacklogAutoMerge.test.tsx src/src/App.tsx
git commit -m "feat(486): override auto-merge per backlog item"
```

---

### Task 9: Docs Source of Truth + ADR-0103

**Files:**
- Create: `internal/docs/adr/0103-auto-merge-saat-sesi-selesai.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: seluruh keputusan Task 1–8
- Produces: dokumentasi SoT yang tertaut di index

- [x] **Step 1: Verifikasi nomor ADR masih bebas**

Jalankan — nomor 0103 harus tak muncul di mana pun:

```bash
ls internal/docs/adr | sed -n 's/^\(01[0-9][0-9]\).*/\1/p' | sort -u | tail -5
for w in $(git worktree list --porcelain | sed -n 's/^worktree //p'); do ls "$w/internal/docs/adr" 2>/dev/null; done | sed -n 's/^\(01[0-9][0-9]\).*/\1/p' | sort -u | tail -5
for b in $(git branch -a --format='%(refname:short)'); do git ls-tree --name-only "$b" internal/docs/adr/ 2>/dev/null; done | sed -n 's#.*/\(01[0-9][0-9]\).*#\1#p' | sort -u | tail -5
```

Expected: `0103` TIDAK muncul. Bila muncul, naikkan ke nomor bebas berikutnya dan pakai nomor itu di seluruh berkas task ini.

- [x] **Step 2: Tulis ADR**

Create `internal/docs/adr/0103-auto-merge-saat-sesi-selesai.md` dengan struktur ADR repo ini (Status/Date/Spec/Terkait · Context · Decision · Alternatif ditolak · Consequences). Isi wajib:

- **Context** — hasil kerja berhenti di `hanoman/<spec>`; ADR-0031 memberi tombol manual tapi bukan kebijakan; tiga jalur persist `done`; `git push` terjadi SESUDAH baris fase terakhir.
- **Decision** — blok `Json?` `autoMerge` di `Project` & `Spec` (null = off / warisi), kosakata target `local:`/`origin:` sama dengan ADR-0031, sweep periodik `services/auto-merge.ts` dengan **nol call site**, penanda + laporan = satu `Notification` ber-`key` `automerge:<specId>`, window 24 jam & grace 15 menit, `merge` saja (tanpa rebase/force-push), `deleteBranch` opt-in hanya sesudah `clean`, konflik → worktree merge dibuang + notifikasi + branch utuh, LOCAL-only (tak disync).
- **Alternatif ditolak** — (a) hook di tiga jalur persist `done` (kelas bug SPEC-431/448/475 + balapan push); (b) melahirkan sesi agen penyelesai konflik otomatis (membakar kuota tanpa diminta, dan bukan yang diminta objective); (c) tabel `AutoMergeAttempt` sendiri (PG_ORDER + sync + migration untuk penanda yang sudah bisa dipikul `Notification.key`); (d) menyimpan kebijakan di `Setting` global (bukan properti project); (e) empat kolom skalar (mengizinkan keadaan tak masuk akal tanpa tipe yang mencegahnya).
- **Consequences** + **gotcha wajib**:
  1. `recordCompletion` idempoten → spec yang di-reopen lalu selesai lagi **tak** di-auto-merge ulang (cermin batasan ADR-0033); jalur manual tetap terbuka.
  2. Window 24 jam adalah satu-satunya yang mencegah "menyalakan setting = menggabungkan seluruh sejarah project" — jangan dilonggarkan tanpa penanda lain.
  3. Kesiapan diukur dari `headSha ⊆ tip branch`, bukan dari keberadaan branch saja — tanpa itu sweep bisa merge tip yang basi.
  4. `integrate` **meninggalkan** worktree konflik by design (ADR-0031); pemanggil yang tak melahirkan sesi WAJIB membuangnya sendiri.
  5. `Prisma.DbNull` (bukan `null` polos) untuk mengosongkan kolom `Json?`.
  6. Sweep dipasang dari `server.ts` saja — `app.ts` bebas-timer (ADR-0072).

- [x] **Step 3: Tautkan & perbarui doc yang tersentuh**

`internal/docs/README.md` — tambahkan baris paling atas di daftar `## adr`:

```markdown
- [0103 — Auto-merge saat sesi selesai: kebijakan per project/spec, dieksekusi sweep tanpa call site](adr/0103-auto-merge-saat-sesi-selesai.md)
```

`internal/docs/adr/README.md` — tambahkan entri naratif 0103 mengikuti gaya entri 0100–0102 (apa yang diperluas/ditegakkan + gotcha).

`internal/docs/architecture/data-model.md` — tambahkan `Project.autoMerge` & `Spec.autoMerge` (`Json?`, LOCAL-only, null = off/warisi) di tabel kolom masing-masing model.

`internal/docs/architecture/api-contract.md` — perbarui `PATCH /projects/:id` (+`autoMerge`, 409/400), `PATCH /specs/:id` (+`autoMerge`, di luar gerbang `editingContent`), `GET /projects/:id/branches` (+`defaultBranch`), dan notifikasi tipe `automerge`.

`internal/skills/hanoman/SKILL.md` — tambahkan butir "Auto-merge saat sesi selesai (SPEC-486/ADR-0103)" di bagian Aturan Arsitektur, memuat inti keputusan + enam gotcha di atas.

- [x] **Step 4: Verifikasi integritas index**

Run: `node cli/dist/index.js docs index --check 2>/dev/null || npx tsx cli/src/index.ts docs index --check`
Expected: tak ada berkas yatim yang baru; bila CLI belum ter-build, cukup pastikan tautan `0103` muncul di **kedua** README (`internal/docs/README.md` dan `internal/docs/adr/README.md`) — jebakan SPEC-386.

- [x] **Step 5: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(486): ADR-0103 auto-merge saat sesi selesai + docs SoT tersentuh"
```

---

### Task 10: Verifikasi akhir & smoke endpoint

**Files:**
- Modify: (perbaikan apa pun yang ditemukan)

**Interfaces:**
- Consumes: seluruh task sebelumnya
- Produces: bukti hijau

- [x] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
./node_modules/.bin/vitest --run --no-file-parallelism \
  shared/src/auto-merge.test.ts \
  server/test/auto-merge-schema.test.ts \
  server/test/auto-merge.route.test.ts \
  server/test/auto-merge.service.test.ts \
  server/test/auto-merge-timer.test.ts \
  server/test/branches.test.ts \
  server/test/webhook-catalog-dmmf.test.ts \
  server/test/sync-exclusions.test.ts \
  server/test/spec-deps.test.ts
```

Expected: seluruh berkas PASS, dan jumlah test **> 0** di tiap berkas (`--changed` menyalakan `passWithNoTests`; "no test files" BUKAN bukti).

- [x] **Step 2: Jalankan test web yang tersentuh**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run \
  src/src/screens/AutoMergeCard.test.tsx \
  src/src/screens/BacklogAutoMerge.test.tsx
```

Expected: PASS. (`NODE_ENV=production` di env sesi membuat RTL `act` gagal massal — SPEC-293.)

- [x] **Step 3: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: exit 0 ketiganya. (Bukan `pnpm -r typecheck` — itu menyalakan satu tsc per paket sekaligus di mesin yang sedang menjalankan sesi lain.)

- [x] **Step 4: Smoke endpoint nyata**

Task ini menyentuh endpoint (`PATCH /projects/:id`, `PATCH /specs/:id`, `GET /projects/:id/branches`), jadi sekali di akhir:

```bash
SMOKE_HOME="$(mktemp -d)"
export HANOMAN_HOME="$SMOKE_HOME"
export DATABASE_URL="file:$SMOKE_HOME/hanoman.db"     # DATABASE_URL MENANG atas HANOMAN_HOME
(cd server && npx prisma migrate deploy)
PORT=8799 node --import tsx server/src/server.ts &
sleep 4
# repo uji
SMOKE_REPO="$(mktemp -d)"; git -C "$SMOKE_REPO" init -q -b main
git -C "$SMOKE_REPO" config user.email t@t; git -C "$SMOKE_REPO" config user.name t
git -C "$SMOKE_REPO" commit -q --allow-empty -m init; git -C "$SMOKE_REPO" branch develop
curl -s -XPOST localhost:8799/api/projects -H 'content-type: application/json' \
  -d "{\"name\":\"smoke\",\"kind\":\"existing\",\"repoDir\":\"$SMOKE_REPO\"}"
curl -s localhost:8799/api/projects/smoke/branches                       # → defaultBranch: "main"
curl -s -XPATCH localhost:8799/api/projects/smoke -H 'content-type: application/json' \
  -d '{"autoMerge":{"mode":"branch","dest":"local","branch":"karangan"}}' -w ' [%{http_code}]\n'   # → 400
curl -s -XPATCH localhost:8799/api/projects/smoke -H 'content-type: application/json' \
  -d '{"autoMerge":{"mode":"branch","dest":"local","branch":"develop"}}' -w ' [%{http_code}]\n'    # → 200
curl -s localhost:8799/api/projects/smoke                                 # → autoMerge tersimpan
```

Expected: `defaultBranch: "main"`; branch karangan **400**; branch nyata **200** dan terbaca kembali di `GET /projects/smoke`.
Bereskan: cari PID-nya (`lsof -ti:8799`) lalu `kill <pid>` — **jangan** `pkill -f node` (mematikan agen sesi tetangga, SPEC-402).

- [x] **Step 5: Centang plan, commit, push**

```bash
git add -u && git commit -m "chore(486): verifikasi akhir — test tersentuh, typecheck, smoke endpoint"
git push origin HEAD:refs/heads/hanoman/spec-486
```

---

## Self-Review

**Spec coverage:** kebijakan tiga mode (Task 1, 7) · level project + override per-spec (Task 2, 4, 7, 8) · tersimpan lewat API (Task 4) · dieksekusi orchestrator saat `done` (Task 5, 6) · notifikasi berisi alasan saat gagal & branch kerja utuh (Task 5) · default tanpa auto-merge (Task 1, 2) · daftar branch dari repo project + gerbangnya (Task 4) · repoDir/gitRemote kosong → dinonaktifkan dengan penjelasan (Task 4, 7) · tanpa force-push (Task 5: op terkunci `merge`) · tak menghapus branch sebelum sukses (Task 5) · knob hapus-setelah-sukses hasil keputusan operator (Task 1, 5, 7) · docs SoT + index (Task 9).

**Placeholder scan:** tak ada TBD/TODO; setiap step yang mengubah kode memuat kodenya. Satu-satunya instruksi "sesuaikan nama variabel" ada di Task 8 langkah 3/4 (App.tsx & BacklogScreen), karena nama state refresh/toast di berkas itu ditentukan kode yang sudah ada — pelaksana membacanya di tempat.

**Type consistency:** `AutoMerge`/`autoMergeOf`/`resolveAutoMerge`/`autoMergeTargetOf`/`autoMergeSummary`/`AUTO_MERGE_OFF` dipakai dengan nama & tanda tangan yang sama di Task 1, 4, 5, 7, 8. `AutoMergeDeps` di Task 5 cocok dengan `deps()` di test-nya. `checkAutoMerge` mengembalikan `{ok:true} | {ok:false; code; error}` dan dipakai persis begitu di kedua route. `discardMergeWorktree`/`deleteMergedBranch` diekspor Task 5 dan dipakai sebagai `discardWorktree`/`deleteBranch` di `prodAutoMergeDeps` — nama field deps sengaja berbeda dari nama fungsi, dan konsisten di test.

---

## Catatan pelaksanaan (deviasi dari rencana)

Semua 10 task selesai. Empat hal berbeda dari yang tertulis di atas, semuanya dicatat di sini
alih-alih diam-diam:

1. **Task 4 menambah satu berkas test yang tak direncanakan.** `server/test/projects.route.test.ts`
   mengunci bentuk respons `GET /projects/:id/branches` dengan `toEqual` yang ketat, jadi
   menambahkan `defaultBranch` membuatnya merah. Diperbaiki dengan memasukkan field baru ke
   ekspektasi (commit `test(486): amplop /branches kini memuat defaultBranch`). Ini **tak
   tertangkap** oleh scope test yang direncanakan — ia baru muncul saat scope diperluas ke seluruh
   suite server yang menyentuh spec/project/sync/webhook (60 berkas, 623 test).

2. **`zSpec` yang bertambah field memaksa fixture lama.** `autoMerge` masuk ke tipe **output** zod
   sebagai wajib (sama seperti `dependsOn`/`blockedBy` sebelumnya), jadi tiga fixture di
   `src/test/terminal-screen.test.tsx` harus menyebutkannya. Ketahuan dari `tsc --noEmit`, bukan
   dari test.

3. **Dua bug di test yang ditulis lebih dulu** — keduanya diperbaiki di test, bukan dengan
   melonggarkan kode produksi: `vi.fn()` polos mengembalikan `undefined` sehingga melanggar kontrak
   `Promise<void>` milik `AutoMergeDeps`, dan helper `seed()` memakai `opts.headSha ?? "aaa"` yang
   **menelan** `headSha: null` — justru kasus yang sedang diuji. Di sisi web, assertion
   `findByText(/tanpa auto-merge/i)` cocok GANDA (badge + label `<option>`) → dipersempit ke
   pencocokan persis, dan mock `GET /specs` harus mengembalikan amplop paginasi utuh (`{}` polos
   membuat `data.items` undefined → seluruh pohon crash sebagai `undefined.map`).

4. **Smoke (Task 10 langkah 4) lebih jauh dari yang direncanakan.** `tsx` tak ter-hoist ke root
   (`./server/node_modules/.bin/tsx`), dan server menuntut cookie sesi (`POST /api/auth/setup`).
   Selain gerbang route, sweep-nya sendiri dijalankan **end-to-end di atas git sungguhan** — itu
   tak ada di rencana dan seharusnya ada:
   - merge bersih → `develop` maju, `fitur.txt` mendarat, notifikasi `automerge:SPEC-141` bersih;
   - sweep kedua → **0 diselesaikan** (penanda idempotensi bekerja);
   - konflik nyata → `develop` **tak bergerak**, branch kerja `hanoman/spec-142` **utuh walau
     `deleteBranch=true`**, `.worktrees/` bersih (worktree konflik dibuang), notifikasi menyebut
     alasannya;
   - merge bersih + `deleteBranch=true` → `hanoman/spec-143` terhapus, `lain.txt` mendarat.
