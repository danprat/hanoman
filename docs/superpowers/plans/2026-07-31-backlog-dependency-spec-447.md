# Backlog yang saling dependency — Implementation Plan (SPEC-447)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sebuah backlog item bisa menyatakan bahwa ia bergantung pada backlog lain, dan hanoman menolak meluncurkan sesinya sampai setiap dependency **selesai (`stage=done`) dan commit-nya sudah ada di branch basis** item itu.

**Architecture:** Kolom `Spec.dependsOn` (Json array id) menyimpan relasinya. Satu resolver murni (`server/src/services/spec-deps.ts`) menurunkan daftar pemblokir dari DB + git (`git merge-base --is-ancestor`, dimemoisasi 15 detik). Dua gerbang menegakkannya: `startSpecSession` (titik cekik semua peluncuran sesi backlog, bisa di-`force`) dan `governor.drain` (otomasi, **tanpa** jalan paksa; baris antrean tetap `queued`). Nilai turunan `blockedBy` ikut `liveSpecs()` supaya HTTP `GET /specs` dan siar WS `specs` tak pernah drift.

**Tech Stack:** TypeScript strict · Fastify · Prisma 6 + SQLite · zod (`@hanoman/shared`) · React 18 + Vite · vitest · Testing Library.

## Global Constraints

- **Bahasa komentar & pesan UI: Indonesia.** Nama simbol/field tetap Inggris (`dependsOn`, `blockedBy`, `missing|unfinished|unmerged`) mengikuti konvensi repo.
- **Docs Source of Truth diperbarui dalam commit yang sama** dan ter-link di `internal/docs/README.md` (ADR baru wajib ditaut **juga** di `internal/docs/adr/README.md` — SPEC-386).
- **Nomor ADR baru = `0093`** (terakhir dipakai: 0092; sudah dienumerasi lintas branch + `git worktree list` pada 2026-07-31).
- **Skema berubah → migration tulis tangan + `migrate deploy`**, jangan `migrate dev` (me-reset saat ada drift worktree tetangga).
- **Perintah test dijalankan dari root worktree** `/Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-447` dengan biner lokal, bukan lewat `pnpm` (proxy rtk memakannya):
  `env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism <path…>`
  `--no-file-parallelism` **wajib** setiap kali set-nya menyentuh `server/test/**` (test server berbagi satu berkas DB).
- **Jangan** menjalankan suite penuh, `pnpm -r typecheck`, atau build penuh. Typecheck per paket: `env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit` (idem `shared`, `runner`, `src`).
- **Jangan `pkill -f`/`killall`** — matikan per-PID (SPEC-402).
- Setiap task diakhiri commit dengan trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

**Baru**
| Path | Tanggung jawab |
|---|---|
| `server/src/services/spec-deps.ts` | satu-satunya sumber kebenaran "apa yang memblokir item ini": pembacaan kolom Json, predikat murni, memo git, validasi tulis, label note |
| `server/prisma/migrations/20260731210000_spec_depends_on/migration.sql` | kolom `dependsOn` |
| `server/test/spec-deps.test.ts` | matriks predikat + validasi + memo |
| `server/test/live-specs-blocked.test.ts` | dekorasi `blockedBy` + jaminan nol-git saat tak dipakai |
| `internal/docs/adr/0093-dependency-antar-backlog.md` | ADR |
| `src/test/backlog-dependency.test.tsx` | picker, badge, force |

**Diubah**
| Path | Perubahan |
|---|---|
| `runner/src/types.ts`, `runner/src/git.ts` | `GitOps.isAncestor` |
| `server/prisma/schema.prisma` | `Spec.dependsOn Json?` |
| `server/src/services/sync.ts` | `FIELDS.spec += "dependsOn"` |
| `server/src/services/live-specs.ts` | dekorasi `dependsOn`/`blockedBy` |
| `server/src/services/session-launch.ts` | `LaunchError kind "blocked"` + gerbang + `opts.force` |
| `server/src/services/scheduler/queue.ts` | `noteQueued` |
| `server/src/services/scheduler/governor.ts` | `GovernorDeps.blockers` + gerbang |
| `server/src/services/scheduler/engine.ts` | `prodDeps.blockers` |
| `server/src/services/lead/pulse.ts` | saring item terblokir dari `ready` |
| `server/src/routes/specs.ts` | validasi POST/PATCH + cleanup DELETE |
| `server/src/routes/terminal.ts` | `force` + 409 `blocked` |
| `shared/src/entities.ts` | `zSpecBlocker`, `zSpec.dependsOn/blockedBy` |
| `shared/src/dto.ts` | `dependsOn` di create/patch, `force` di `zTerminalSession` |
| `src/src/api/client.ts` | tipe `patchSpec`/`createSpec`/`startSession` |
| `src/src/App.tsx` | `SpecForm.dependsOn`, picker, `createSpec`, `editDeps`, `StartSessionModal` force |
| `src/src/screens/BacklogScreen.tsx` | badge Terblokir + baris dependency di detail |
| `internal/docs/README.md`, `internal/docs/adr/README.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`, `internal/skills/hanoman/SKILL.md` | docs |
| `server/test/scheduler-governor.test.ts`, `server/test/scheduler-engine.test.ts` | tambah `blockers` di 9 literal `GovernorDeps` |

---

### Task 1: `realGit.isAncestor` — pertanyaan "sudah ter-merge?" ke git

**Files:**
- Modify: `runner/src/types.ts` (interface `GitOps`, akhir blok)
- Modify: `runner/src/git.ts` (objek `realGit`, sesudah `revParse`)
- Test: `runner/test/git.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `GitOps.isAncestor(repo: string, sha: string, ref: string): boolean` — `true` bila `sha` adalah leluhur (atau sama dengan) commit yang ditunjuk `ref`. **Tak pernah melempar**; ref tak resolve / repo tak terbaca / exit selain 0|1 → `false`.

- [x] **Step 1: Write the failing test**

Tambahkan di akhir `runner/test/git.test.ts` (di luar `describe` yang sudah ada):

```ts
// SPEC-447 · "sudah ter-merge?" adalah pertanyaan ke git, bukan kolom DB (ADR-0019).
describe("realGit.isAncestor", () => {
  const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
  function repoWithBranch(): { dir: string; baseSha: string; featSha: string } {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-anc-"));
    g(dir, "init", "-q");
    g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "a.txt"), "1"); g(dir, "add", "-A"); g(dir, "commit", "-qm", "base");
    g(dir, "branch", "-M", "main");
    const baseSha = g(dir, "rev-parse", "HEAD").stdout.trim();
    g(dir, "checkout", "-q", "-b", "feat");
    writeFileSync(join(dir, "b.txt"), "2"); g(dir, "add", "-A"); g(dir, "commit", "-qm", "feat");
    const featSha = g(dir, "rev-parse", "HEAD").stdout.trim();
    g(dir, "checkout", "-q", "main");
    return { dir, baseSha, featSha };
  }

  it("false selama commit branch belum ter-merge, true sesudahnya", () => {
    const { dir, featSha } = repoWithBranch();
    expect(realGit.isAncestor(dir, featSha, "main")).toBe(false);
    g(dir, "merge", "-q", "--no-ff", "-m", "merge feat", "feat");
    expect(realGit.isAncestor(dir, featSha, "main")).toBe(true);
  });

  it("commit dianggap leluhur dirinya sendiri", () => {
    const { dir, baseSha } = repoWithBranch();
    expect(realGit.isAncestor(dir, baseSha, "main")).toBe(true);
  });

  // Fail-closed: "tak bisa dipastikan" tak boleh terbaca sebagai "aman".
  it("false (tanpa melempar) untuk ref/sha yang tak resolve dan repo yang tak ada", () => {
    const { dir, featSha } = repoWithBranch();
    expect(realGit.isAncestor(dir, featSha, "tak-ada-branch")).toBe(false);
    expect(realGit.isAncestor(dir, "0".repeat(40), "main")).toBe(false);
    expect(realGit.isAncestor(join(dir, "bukan-repo"), featSha, "main")).toBe(false);
  });
});
```

Pastikan import yang dipakai test ini sudah ada di kepala berkas (`spawnSync` dari `node:child_process`, `mkdtempSync`/`writeFileSync` dari `node:fs`, `join` dari `node:path`, `tmpdir` dari `node:os`, `realGit` dari `../src/git`). Tambahkan yang belum ada.

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run runner/test/git.test.ts
```
Expected: FAIL — `realGit.isAncestor is not a function`.

- [x] **Step 3: Write minimal implementation**

`runner/src/types.ts` — tambahkan di dalam `interface GitOps`, tepat sesudah `revParse`:

```ts
  /** SPEC-447 · apakah `sha` sudah ada di dalam `ref` (dependency backlog sudah ter-merge)?
   *  Murni-baca, TAK PERNAH melempar: ref/sha tak resolve, repo tak terbaca, atau exit di luar
   *  0|1 → `false`. Fail-closed disengaja — "tak bisa dipastikan" bukan "aman". */
  isAncestor(repo: string, sha: string, ref: string): boolean;
```

`runner/src/git.ts` — tambahkan di dalam objek `realGit`, sesudah `revParse` (jangan lupa koma):

```ts
  // SPEC-447 · `git merge-base --is-ancestor A B` = exit 0 (ya) / 1 (tidak) / lainnya (error).
  // `--end-of-options` menjaga ADR-0032: sha & ref datang dari DB/kolom, jangan sampai terbaca
  // sebagai flag. Ref yang tak resolve membuat git exit 128 → dibaca sebagai "belum".
  isAncestor: (repo, sha, ref) => {
    const r = spawnSync("git", ["merge-base", "--is-ancestor", "--end-of-options", sha, ref],
      { cwd: repo, encoding: "utf8" });
    return r.status === 0;
  },
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run runner/test/git.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p runner --noEmit
```
Expected: seluruh berkas PASS, typecheck bersih.

- [x] **Step 5: Commit**

```bash
git add runner/src/types.ts runner/src/git.ts runner/test/git.test.ts
git commit -m "feat(runner): realGit.isAncestor untuk menjawab 'sudah ter-merge?' (SPEC-447)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Kolom `Spec.dependsOn` + migration + sync

**Files:**
- Modify: `server/prisma/schema.prisma:28-51` (model `Spec`)
- Create: `server/prisma/migrations/20260731210000_spec_depends_on/migration.sql`
- Modify: `server/src/services/sync.ts:34` (`FIELDS.spec`)
- Test: `server/test/spec-deps.test.ts` (dibuat di sini, diisi lagi di Task 3)

**Interfaces:**
- Consumes: —
- Produces: kolom `Spec.dependsOn` (Prisma `Json?`), tersedia di seluruh `prisma.spec.*`; `FIELDS.spec` memuat `"dependsOn"`.

- [x] **Step 1: Write the failing test**

Buat `server/test/spec-deps.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("Spec.dependsOn (SPEC-447)", () => {
  it("kolom menyimpan array id dan dibaca kembali apa adanya", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "a", source: "brief", stage: "done", priority: "sedang", author: "a", objective: "" } });
    await prisma.spec.create({ data: { id: "SPEC-2", projectId: "p1", title: "b", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "", dependsOn: ["SPEC-1"] } });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-2" } });
    expect(row!.dependsOn).toEqual(["SPEC-1"]);
  });

  // Tanpa baris ini, spec asal-hub kehilangan dependency-nya di tiap client — dan client akan
  // meluncurkan pekerjaan yang di hub terblokir.
  it("dependsOn ikut menyeberang sync (FIELDS.spec)", async () => {
    const { __FIELDS_FOR_TEST } = await import("../src/services/sync");
    expect(__FIELDS_FOR_TEST.spec).toContain("dependsOn");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/spec-deps.test.ts
```
Expected: FAIL — `Unknown argument 'dependsOn'` dan `__FIELDS_FOR_TEST` tak diekspor.

- [x] **Step 3: Write minimal implementation**

`server/prisma/schema.prisma` — di dalam `model Spec`, sesudah `startedAt`:

```prisma
  // SPEC-447 · ADR-0093 · id spec lain yang harus SELESAI & commit-nya sudah ada di branch basis
  // sebelum item ini boleh diluncurkan. Array JSON of string; null/[] = tak bergantung apa pun.
  // Sengaja kolom, bukan tabel join: SQLite melarang scalar list, `Json` sudah dipakai `payload`,
  // dan kolom ikut FIELDS.spec sync apa adanya. Integritas ditegakkan di boundary route +
  // pembersihan saat spec dihapus, bukan FK.
  dependsOn  Json?
```

Buat `server/prisma/migrations/20260731210000_spec_depends_on/migration.sql`:

```sql
-- SPEC-447 · ADR-0093 · dependency antar-backlog.
--
-- ADITIF & nullable tanpa default → `ADD COLUMN` polos sudah cukup. Beda dari migration SPEC-408
-- yang harus meredefinisi tabel: yang dilarang SQLite adalah `ADD COLUMN … DEFAULT <non-konstan>`,
-- bukan `ADD COLUMN` itu sendiri. Baris lama tetap NULL, dan pembaca menerjemahkan NULL → [].
ALTER TABLE "Spec" ADD COLUMN "dependsOn" JSONB;
```

Terapkan:

```bash
cd server && DATABASE_URL="file:$HOME/.hanoman/hanoman.db" ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma generate && cd ..
```

`server/src/services/sync.ts` — pada `FIELDS.spec` (baris 34) tambahkan `"dependsOn"` **sebelum** `"createdAt"`, dan perbarui komentar di atasnya:

```ts
  // SPEC-408 · ADR-0090 · createdAt/startedAt ikut menyeberang — sejajar baseSha/headSha. Tanpa
  // ini spec asal-hub mendapat createdAt lokal palsu di tiap client (kolom NOT NULL ber-default).
  // SPEC-447 · ADR-0093 · dependsOn ikut juga: tanpa itu client tak tahu urutannya dan akan
  // meluncurkan pekerjaan yang di hub terblokir. Bukan DATE_FIELDS — nilainya array string.
  spec: ["projectId", "title", "source", "stage", "priority", "author", "objective", "payload", "branchFrom", "baseSha", "headSha", "dependsOn", "createdAt", "startedAt", "updatedAt"],
```

Dan di akhir berkas `server/src/services/sync.ts` tambahkan ekspor test-only:

```ts
// SPEC-447 · whitelist field adalah KONTRAK (spec kehilangan kolom saat menyeberang = bug senyap).
// Diekspor agar test bisa menegakkannya tanpa menebak dari perilaku end-to-end.
export const __FIELDS_FOR_TEST = FIELDS;
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/spec-deps.test.ts
```
Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/src/services/sync.ts server/test/spec-deps.test.ts
git commit -m "feat(db): kolom Spec.dependsOn + ikut sync (SPEC-447)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Resolver `spec-deps.ts` — predikat murni + memo git + validasi

**Files:**
- Create: `server/src/services/spec-deps.ts`
- Test: `server/test/spec-deps.test.ts` (lanjutkan berkas Task 2)

**Interfaces:**
- Consumes: `realGit.isAncestor` (Task 1), kolom `dependsOn` (Task 2).
- Produces:
  - `type BlockReason = "missing" | "unfinished" | "unmerged"`
  - `type SpecBlocker = { id: string; reason: BlockReason }`
  - `dependsOnOf(spec: { dependsOn?: unknown }): string[]`
  - `blockersFor(spec: { branchFrom: string | null; dependsOn?: unknown }, deps: Map<string, {id: string; stage: string; headSha: string | null}>, isMerged: (sha: string, baseRef: string) => boolean): SpecBlocker[]`
  - `reaches(edges: Map<string, string[]>, from: string[], target: string): boolean`
  - `blockedNote(bl: SpecBlocker[]): string`
  - `mergedInto(repoDir: string, sha: string, baseRef: string): boolean` (memo 15 s) + `__clearMergeCache()`
  - `blockersForSpec(spec: { id: string; projectId: string; branchFrom: string | null; dependsOn?: unknown }, repoDir: string | null): Promise<SpecBlocker[]>`
  - `decorateBlocked<T>(specs: T[]): Promise<(T & { dependsOn: string[]; blockedBy: SpecBlocker[] })[]>`
  - `validateDependsOn(specId: string | null, projectId: string, ids: string[]): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }>`

- [x] **Step 1: Write the failing test**

Tambahkan ke `server/test/spec-deps.test.ts` (di bawah blok yang sudah ada):

```ts
import {
  dependsOnOf, blockersFor, reaches, blockedNote, mergedInto, __clearMergeCache,
  blockersForSpec, validateDependsOn, type SpecBlocker,
} from "../src/services/spec-deps";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dep = (id: string, stage: string, headSha: string | null = null) => [id, { id, stage, headSha }] as const;
const mapOf = (...rows: ReturnType<typeof dep>[]) => new Map(rows.map((r) => [r[0], r[1]]));

describe("dependsOnOf · pembacaan defensif kolom Json", () => {
  it("null / bukan array / elemen bukan string → []", () => {
    expect(dependsOnOf({ dependsOn: null })).toEqual([]);
    expect(dependsOnOf({})).toEqual([]);
    expect(dependsOnOf({ dependsOn: "SPEC-1" })).toEqual([]);
    expect(dependsOnOf({ dependsOn: { a: 1 } })).toEqual([]);
    expect(dependsOnOf({ dependsOn: [1, null, "SPEC-1", ""] })).toEqual(["SPEC-1"]);
  });
  it("duplikat dibuang, urutan dipertahankan", () => {
    expect(dependsOnOf({ dependsOn: ["SPEC-2", "SPEC-1", "SPEC-2"] })).toEqual(["SPEC-2", "SPEC-1"]);
  });
});

describe("blockersFor · matriks kesiapan dependency", () => {
  const spec = { branchFrom: "main", dependsOn: ["SPEC-1"] };
  const never = () => false;
  const always = () => true;

  it("tanpa dependency → tak pernah menyentuh isMerged", () => {
    let calls = 0;
    expect(blockersFor({ branchFrom: null, dependsOn: [] }, mapOf(), () => { calls++; return true; })).toEqual([]);
    expect(calls).toBe(0);
  });
  it("dependency tak ada di DB → missing", () => {
    expect(blockersFor(spec, mapOf(), always)).toEqual([{ id: "SPEC-1", reason: "missing" }]);
  });
  it("dependency belum done → unfinished", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "executing", "abc")), always))
      .toEqual([{ id: "SPEC-1", reason: "unfinished" }]);
  });
  // Pelajaran SPEC-431: headSha null = hanoman tak pernah membuatkan worktree, BUKAN belum selesai.
  it("done tanpa headSha → siap (tak ada commit yang bisa di-merge)", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "done", null)), never)).toEqual([]);
  });
  it("done + headSha belum ada di basis → unmerged", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "done", "abc")), never))
      .toEqual([{ id: "SPEC-1", reason: "unmerged" }]);
  });
  it("done + headSha sudah ada di basis → siap", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "done", "abc")), always)).toEqual([]);
  });
  // Basis = ref yang akan dipakai addWorktree; tanpa branchFrom itu "HEAD".
  it("basis yang diuji = branchFrom, jatuh ke HEAD saat null", () => {
    const seen: string[] = [];
    blockersFor({ branchFrom: "rilis", dependsOn: ["SPEC-1"] }, mapOf(dep("SPEC-1", "done", "abc")),
      (_s, base) => { seen.push(base); return true; });
    blockersFor({ branchFrom: null, dependsOn: ["SPEC-1"] }, mapOf(dep("SPEC-1", "done", "abc")),
      (_s, base) => { seen.push(base); return true; });
    expect(seen).toEqual(["rilis", "HEAD"]);
  });
  it("beberapa dependency dilaporkan semua, urut seperti ditulis", () => {
    const out = blockersFor({ branchFrom: "main", dependsOn: ["SPEC-9", "SPEC-1"] },
      mapOf(dep("SPEC-1", "brainstorming")), never);
    expect(out).toEqual<SpecBlocker[]>([
      { id: "SPEC-9", reason: "missing" }, { id: "SPEC-1", reason: "unfinished" },
    ]);
  });
});

describe("reaches · deteksi siklus", () => {
  it("true bila target terjangkau dari salah satu titik awal", () => {
    const e = new Map([["B", ["C"]], ["C", ["A"]]]);
    expect(reaches(e, ["B"], "A")).toBe(true);
  });
  it("false bila tak terjangkau, dan tak menggantung pada graf bersiklus", () => {
    const e = new Map([["B", ["C"]], ["C", ["B"]]]);
    expect(reaches(e, ["B"], "A")).toBe(false);
  });
});

describe("blockedNote", () => {
  it("menyebut id dan alasannya", () => {
    expect(blockedNote([{ id: "SPEC-1", reason: "unmerged" }, { id: "SPEC-2", reason: "unfinished" }]))
      .toBe("menunggu SPEC-1 (belum ter-merge), SPEC-2 (belum selesai)");
  });
});

describe("mergedInto · memo 15 detik di atas git", () => {
  function repoMerged(): { dir: string; featSha: string } {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-mi-"));
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    writeFileSync(join(dir, "a"), "1"); g("add", "-A"); g("commit", "-qm", "base"); g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feat");
    writeFileSync(join(dir, "b"), "2"); g("add", "-A"); g("commit", "-qm", "feat");
    const featSha = g("rev-parse", "HEAD").stdout.trim();
    g("checkout", "-q", "main");
    return { dir, featSha };
  }
  it("membaca git, lalu memoisasi jawabannya", () => {
    __clearMergeCache();
    const { dir, featSha } = repoMerged();
    expect(mergedInto(dir, featSha, "main")).toBe(false);
    spawnSync("git", ["merge", "-q", "--no-ff", "-m", "m", "feat"], { cwd: dir });
    expect(mergedInto(dir, featSha, "main")).toBe(false);   // masih jawaban ter-memo
    __clearMergeCache();
    expect(mergedInto(dir, featSha, "main")).toBe(true);
  });
});

describe("blockersForSpec · glue DB", () => {
  it("membaca stage & headSha dependency dari DB", async () => {
    await prisma.project.create({ data: { id: "pd", name: "PD", desc: "", kind: "existing" } });
    await prisma.spec.create({ data: { id: "SPEC-D1", projectId: "pd", title: "a", source: "brief", stage: "planned", priority: "sedang", author: "a", objective: "" } });
    const b = await prisma.spec.create({ data: { id: "SPEC-D2", projectId: "pd", title: "b", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "", dependsOn: ["SPEC-D1"] } });
    expect(await blockersForSpec(b, null)).toEqual([{ id: "SPEC-D1", reason: "unfinished" }]);
  });
  it("tanpa dependency → [] tanpa query dependency", async () => {
    await prisma.project.create({ data: { id: "pe", name: "PE", desc: "", kind: "existing" } });
    const s = await prisma.spec.create({ data: { id: "SPEC-E1", projectId: "pe", title: "a", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "" } });
    expect(await blockersForSpec(s, null)).toEqual([]);
  });
});

describe("validateDependsOn", () => {
  beforeEach(async () => {
    await prisma.project.create({ data: { id: "pv", name: "PV", desc: "", kind: "existing" } });
    await prisma.project.create({ data: { id: "pw", name: "PW", desc: "", kind: "existing" } });
    for (const [id, projectId] of [["SPEC-V1", "pv"], ["SPEC-V2", "pv"], ["SPEC-W1", "pw"]] as const)
      await prisma.spec.create({ data: { id, projectId, title: id, source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "" } });
  });
  it("menerima id yang ada di project yang sama, dedup terjaga", async () => {
    expect(await validateDependsOn("SPEC-V2", "pv", ["SPEC-V1", "SPEC-V1"]))
      .toEqual({ ok: true, ids: ["SPEC-V1"] });
  });
  it("menolak id yang tak ada", async () => {
    const r = await validateDependsOn("SPEC-V2", "pv", ["SPEC-ZZ"]);
    expect(r.ok).toBe(false);
  });
  it("menolak dependency lintas project", async () => {
    const r = await validateDependsOn("SPEC-V2", "pv", ["SPEC-W1"]);
    expect(r.ok).toBe(false);
  });
  it("menolak referensi ke diri sendiri", async () => {
    const r = await validateDependsOn("SPEC-V2", "pv", ["SPEC-V2"]);
    expect(r.ok).toBe(false);
  });
  it("menolak siklus", async () => {
    await prisma.spec.update({ where: { id: "SPEC-V1" }, data: { dependsOn: ["SPEC-V2"] } });
    const r = await validateDependsOn("SPEC-V2", "pv", ["SPEC-V1"]);
    expect(r.ok).toBe(false);
  });
  it("spec baru (specId null) tak bisa membentuk siklus", async () => {
    expect(await validateDependsOn(null, "pv", ["SPEC-V1"])).toEqual({ ok: true, ids: ["SPEC-V1"] });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/spec-deps.test.ts
```
Expected: FAIL — `Failed to resolve import "../src/services/spec-deps"`.

- [x] **Step 3: Write minimal implementation**

Buat `server/src/services/spec-deps.ts`:

```ts
import { prisma } from "../db";
import { realGit } from "@hanoman/runner";
import { resolveRepoDir } from "./local-binding";

// SPEC-447 · ADR-0093 · satu-satunya sumber kebenaran "apa yang memblokir backlog item ini".
// Dipakai TIGA pembaca: gerbang peluncuran (session-launch), gerbang otomasi (governor + denyut
// lead), dan permukaan baca (liveSpecs). Menyalin predikatnya ke pemakai adalah kelas bug yang
// sudah pernah terjadi di repo ini (SPEC-431: `baseSha IS NULL` disalin ke dua tempat).

export type BlockReason = "missing" | "unfinished" | "unmerged";
export type SpecBlocker = { id: string; reason: BlockReason };

type DepRow = { id: string; stage: string; headSha: string | null };
type SpecLike = { branchFrom: string | null; dependsOn?: unknown };

const REASON_LABEL: Record<BlockReason, string> = {
  missing: "tak ditemukan", unfinished: "belum selesai", unmerged: "belum ter-merge",
};

/** Kolom `Json` bisa berisi apa saja — ia menyeberang lewat sync dari client versi lain. Baca
 *  defensif: bukan array / elemen bukan string → dibuang, duplikat dibuang, urutan dipertahankan. */
export function dependsOnOf(spec: { dependsOn?: unknown }): string[] {
  const v = spec.dependsOn;
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && x !== "" && !out.includes(x)) out.push(x);
  return out;
}

/** MURNI: seluruh matriks keputusan tanpa DB/git, jadi ia teruji tanpa harness.
 *  `isMerged(headSha, baseRef)` = "apakah commit itu sudah ada di basis si dependent". */
export function blockersFor(
  spec: SpecLike, deps: Map<string, DepRow>,
  isMerged: (headSha: string, baseRef: string) => boolean,
): SpecBlocker[] {
  const ids = dependsOnOf(spec);
  if (ids.length === 0) return [];
  // Basis = ref yang akan dipakai `realGit.addWorktree` saat sesi ini lahir (session-launch.ts).
  // Pertanyaannya memang itu: "apakah worktree yang akan saya buat memuat pekerjaan dependency?"
  const base = spec.branchFrom ?? "HEAD";
  const out: SpecBlocker[] = [];
  for (const id of ids) {
    const d = deps.get(id);
    if (!d) { out.push({ id, reason: "missing" }); continue; }
    if (d.stage !== "done") { out.push({ id, reason: "unfinished" }); continue; }
    // headSha null = hanoman tak pernah membuatkan worktree untuknya (selesai manual / pra-ADR-0030
    // / dikerjakan di checkout lain, SPEC-431) → tak ada commit yang bisa di-merge → siap.
    if (d.headSha && !isMerged(d.headSha, base)) out.push({ id, reason: "unmerged" });
  }
  return out;
}

/** Kalimat yang dibaca operator (note antrean scheduler + pesan 409). */
export function blockedNote(bl: SpecBlocker[]): string {
  return `menunggu ${bl.map((b) => `${b.id} (${REASON_LABEL[b.reason]})`).join(", ")}`;
}

/** MURNI: apakah `target` terjangkau dari salah satu simpul `from`? Dipakai deteksi siklus —
 *  menambahkan `from` sebagai dependency `target` membentuk siklus persis saat ini true.
 *  Tahan graf yang SUDAH bersiklus (`seen`), karena data lama bisa saja tak konsisten. */
export function reaches(edges: Map<string, string[]>, from: string[], target: string): boolean {
  const seen = new Set<string>();
  const stack = [...from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of edges.get(cur) ?? []) stack.push(n);
  }
  return false;
}

// Merged-ness hanya berubah saat ada integrate/push, sementara pembacanya adalah loop siar 1 detik
// (events.ts). Memo pendek menahan biaya subprocess tanpa membuat jawabannya terasa basi.
const TTL_MS = 15_000;
const mergeCache = new Map<string, { at: number; v: boolean }>();
export function __clearMergeCache(): void { mergeCache.clear(); }

export function mergedInto(repoDir: string, sha: string, baseRef: string): boolean {
  const key = `${repoDir} ${sha} ${baseRef}`;
  const hit = mergeCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.v;
  let v = false;
  try { v = realGit.isAncestor(repoDir, sha, baseRef); } catch { v = false; }
  mergeCache.set(key, { at: now, v });
  return v;
}

const merger = (repoDir: string | null) =>
  // repoDir null (project belum di-bind) → tak ada yang bisa ditanya → fail-closed.
  (sha: string, base: string) => (repoDir ? mergedInto(repoDir, sha, base) : false);

/** Blocker satu spec. Keluar lebih awal (nol query, nol git) saat item tak punya dependency —
 *  itulah yang membuat fitur ini berbiaya NOL untuk backlog yang tak memakainya. */
export async function blockersForSpec(
  spec: SpecLike & { projectId: string }, repoDir: string | null,
): Promise<SpecBlocker[]> {
  const ids = dependsOnOf(spec);
  if (ids.length === 0) return [];
  const rows = await prisma.spec.findMany({
    where: { id: { in: ids } }, select: { id: true, stage: true, headSha: true },
  });
  return blockersFor(spec, new Map(rows.map((r) => [r.id, r])), merger(repoDir));
}

/** Versi batch untuk permukaan baca: satu query dependency untuk seluruh halaman, satu
 *  `resolveRepoDir` per project. Menormalkan `dependsOn` ke array supaya klien tak pernah
 *  melihat `null`. */
export async function decorateBlocked<T extends SpecLike & { projectId: string }>(
  specs: T[],
): Promise<(T & { dependsOn: string[]; blockedBy: SpecBlocker[] })[]> {
  const ids = [...new Set(specs.flatMap(dependsOnOf))];
  if (ids.length === 0) return specs.map((s) => ({ ...s, dependsOn: [], blockedBy: [] }));
  const rows = await prisma.spec.findMany({
    where: { id: { in: ids } }, select: { id: true, stage: true, headSha: true },
  });
  const deps = new Map(rows.map((r) => [r.id, r]));
  const repos = new Map<string, string | null>();
  const out: (T & { dependsOn: string[]; blockedBy: SpecBlocker[] })[] = [];
  for (const s of specs) {
    const own = dependsOnOf(s);
    if (own.length === 0) { out.push({ ...s, dependsOn: [], blockedBy: [] }); continue; }
    if (!repos.has(s.projectId)) repos.set(s.projectId, await resolveRepoDir(s.projectId));
    out.push({ ...s, dependsOn: own, blockedBy: blockersFor(s, deps, merger(repos.get(s.projectId)!)) });
  }
  return out;
}

export type DepValidation = { ok: true; ids: string[] } | { ok: false; error: string };

/** Gerbang tulis. `specId` null = spec baru (belum punya in-edge, jadi mustahil bersiklus). */
export async function validateDependsOn(
  specId: string | null, projectId: string, raw: string[],
): Promise<DepValidation> {
  const ids = dependsOnOf({ dependsOn: raw });
  if (ids.length === 0) return { ok: true, ids: [] };
  if (specId && ids.includes(specId))
    return { ok: false, error: "backlog tak bisa bergantung pada dirinya sendiri" };
  const rows = await prisma.spec.findMany({
    where: { id: { in: ids } }, select: { id: true, projectId: true },
  });
  const found = new Map(rows.map((r) => [r.id, r.projectId]));
  const missing = ids.filter((i) => !found.has(i));
  if (missing.length) return { ok: false, error: `backlog tak ditemukan: ${missing.join(", ")}` };
  // Lintas project menuntut merge lintas repo — ditolak tegas, bukan didiamkan (non-goal ADR-0093).
  const foreign = ids.filter((i) => found.get(i) !== projectId);
  if (foreign.length)
    return { ok: false, error: `dependency harus di project yang sama: ${foreign.join(", ")}` };
  if (specId) {
    const all = await prisma.spec.findMany({
      where: { projectId }, select: { id: true, dependsOn: true },
    });
    const edges = new Map(all.map((r) => [r.id, dependsOnOf(r)]));
    edges.set(specId, ids);   // graf SESUDAH perubahan
    if (reaches(edges, ids, specId))
      return { ok: false, error: "dependency membentuk siklus" };
  }
  return { ok: true, ids };
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/spec-deps.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit
```
Expected: semua PASS; typecheck bersih.

- [x] **Step 5: Commit**

```bash
git add server/src/services/spec-deps.ts server/test/spec-deps.test.ts
git commit -m "feat(server): resolver dependency backlog (predikat murni + memo git + validasi)

SPEC-447. Satu sumber kebenaran untuk 'apa yang memblokir item ini', dipakai
gerbang peluncuran, gerbang otomasi, dan permukaan baca.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Gerbang peluncuran di `startSpecSession` (+ `force`)

**Files:**
- Modify: `server/src/services/session-launch.ts` (kelas `LaunchError`, tipe `opts`, badan fungsi sesudah cek pane)
- Test: `server/test/session-launch.test.ts` (tambah `describe` baru di akhir)

**Interfaces:**
- Consumes: `blockersForSpec`, `blockedNote`, `SpecBlocker` (Task 3).
- Produces: `LaunchError` bertambah `kind: "blocked"` dan properti `blockers: SpecBlocker[]` (default `[]`); `startSpecSession(spec, opts)` menerima `opts.force?: boolean`.

- [x] **Step 1: Write the failing test**

Tambahkan di akhir `server/test/session-launch.test.ts`, **di dalam** `describe("session-launch", …)` yang sudah ada (tepat sebelum kurung penutupnya) — `seedRepo` sudah tersedia di scope itu:

```ts
  // SPEC-447 · ADR-0093 · titik cekik peluncuran adalah tempat gerbang dependency berdiri:
  // route manual DAN governor scheduler sama-sama lewat sini.
  describe("gerbang dependency (SPEC-447)", () => {
    it("menolak meluncurkan selagi dependency belum selesai — worktree tak pernah dibuat", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await seedRepo("SPEC-447A");                        // dependency, stage planned
      const b = await seedRepo("SPEC-447B");
      await prisma.spec.update({ where: { id: "SPEC-447B" }, data: { dependsOn: ["SPEC-447A"] } });
      const spec = (await prisma.spec.findUnique({ where: { id: "SPEC-447B" } }))!;
      await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "blocked" });
      const row = (await prisma.spec.findUnique({ where: { id: "SPEC-447B" } }))!;
      expect(row.baseSha).toBeNull();                     // tak menyentuh worktree/stempel
      expect(row.startedAt).toBeNull();
      expect(b.id).toBe("SPEC-447B");
    });

    it("membawa daftar pemblokir di error, bukan hanya pesan", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await seedRepo("SPEC-447C");
      await seedRepo("SPEC-447D");
      await prisma.spec.update({ where: { id: "SPEC-447D" }, data: { dependsOn: ["SPEC-447C"] } });
      const spec = (await prisma.spec.findUnique({ where: { id: "SPEC-447D" } }))!;
      const err = await startSpecSession(spec, { flow: "feature" }).catch((e) => e as LaunchError);
      expect((err as LaunchError).blockers).toEqual([{ id: "SPEC-447C", reason: "unfinished" }]);
    });

    it("force melewati gerbang — manusia yang terakhir memutuskan", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await seedRepo("SPEC-447E");
      await seedRepo("SPEC-447F");
      await prisma.spec.update({ where: { id: "SPEC-447F" }, data: { dependsOn: ["SPEC-447E"] } });
      const spec = (await prisma.spec.findUnique({ where: { id: "SPEC-447F" } }))!;
      const r = await startSpecSession(spec, { flow: "feature", force: true });
      expect(r.id).toBe("spec-447f");
      killSession(r.id);
    });

    it("dependency done tanpa headSha tak memblokir apa pun", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await seedRepo("SPEC-447G");
      await prisma.spec.update({ where: { id: "SPEC-447G" }, data: { stage: "done" } });
      await seedRepo("SPEC-447H");
      await prisma.spec.update({ where: { id: "SPEC-447H" }, data: { dependsOn: ["SPEC-447G"] } });
      const spec = (await prisma.spec.findUnique({ where: { id: "SPEC-447H" } }))!;
      const r = await startSpecSession(spec, { flow: "feature" });
      expect(r.id).toBe("spec-447h");
      killSession(r.id);
    });
  });
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/session-launch.test.ts
```
Expected: FAIL — sesi terblokir tetap lahir (`kind: "blocked"` tak pernah dilempar) dan `force` tak dikenal tipe.

- [x] **Step 3: Write minimal implementation**

`server/src/services/session-launch.ts`:

1. Tambahkan import di bawah import service yang sudah ada:

```ts
import { blockersForSpec, blockedNote, type SpecBlocker } from "./spec-deps";
```

2. Ganti kelas `LaunchError`:

```ts
export class LaunchError extends Error {
  // SPEC-447 · `blockers` hanya terisi untuk kind "blocked"; route memetakannya ke body 409.
  constructor(message: string, readonly kind: "needs-bind" | "worktree" | "blocked",
              readonly blockers: SpecBlocker[] = []) { super(message); }
}
```

3. Tambahkan `force` ke tipe `opts` (sesudah `verifyScope`):

```ts
    // SPEC-447 · ADR-0093 · lewati gerbang dependency. HANYA jalur manusia yang memasoknya
    // (POST /terminal/sessions); governor & denyut lead TAK PERNAH memaksa.
    force?: boolean;
```

4. Sisipkan gerbang tepat **sesudah** baris re-attach dan **sebelum** `if (pane) killSession(id)`:

```ts
  const pane = getSession(id);
  if (pane && !pane.exited) return { id: pane.id, reused: true };
  // SPEC-447 · ADR-0093 · gerbang dependency. Berdiri SESUDAH cek pane hidup (re-attach ke sesi
  // yang sedang berjalan tak boleh ikut ditolak — menyembunyikan pekerjaan yang justru perlu
  // dilihat operator) dan SEBELUM `killSession`/worktree, supaya penolakan tak meninggalkan efek.
  if (!opts.force) {
    const blockers = await blockersForSpec(spec, repoDir);
    if (blockers.length)
      throw new LaunchError(`${spec.id} ${blockedNote(blockers)}`, "blocked", blockers);
  }
  if (pane) killSession(id);
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/session-launch.test.ts server/test/session-resume.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit
```
Expected: semua PASS (termasuk test resume lama — gerbang tak boleh mengubahnya).

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-launch.ts server/test/session-launch.test.ts
git commit -m "feat(server): gerbang dependency di titik cekik peluncuran sesi backlog

SPEC-447. Berdiri sesudah re-attach & sebelum worktree; force hanya untuk jalur manusia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Gerbang kedua di governor + `noteQueued`

**Files:**
- Modify: `server/src/services/scheduler/queue.ts` (tambah `noteQueued`)
- Modify: `server/src/services/scheduler/governor.ts` (`GovernorDeps.blockers` + gerbang)
- Modify: `server/src/services/scheduler/engine.ts` (`prodDeps.blockers`)
- Modify: `server/test/scheduler-governor.test.ts`, `server/test/scheduler-engine.test.ts` (9 literal `GovernorDeps`)
- Test: `server/test/scheduler-governor.test.ts`

**Interfaces:**
- Consumes: `blockersForSpec`, `blockedNote`, `SpecBlocker` (Task 3).
- Produces: `noteQueued(id: string, note: string): Promise<void>` (menulis hanya bila `note` berubah); `GovernorDeps.blockers: (specId: string) => Promise<SpecBlocker[]>` (**wajib**).

- [x] **Step 1: Write the failing test**

Tambahkan di akhir `describe("governor.drain", …)` pada `server/test/scheduler-governor.test.ts`:

```ts
  // SPEC-447 · ADR-0093 · gerbang KEDUA — pola SPEC-431. Checker yang benar tak cukup sendirian:
  // baris `queued` bisa sudah ada sebelum dependency-nya ditulis, dan sebuah dependency bisa
  // berbalik jadi belum-siap selagi item mengantre (stage dikembalikan mundur, ADR-0027).
  it("melewati item terblokir tanpa memakai slot, barisnya tetap queued", async () => {
    await enqueue({ specId: "SPEC-blk", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-free", projectId: "p1", source: "backlog", priority: "sedang" });
    const launched: string[] = [];
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null, isDone: async () => false,
      blockers: async (specId) =>
        (specId === "SPEC-blk" ? [{ id: "SPEC-dep", reason: "unmerged" as const }] : []),
      launch: async (item) => { launched.push(item.specId); return "s_free"; },
    };
    await drain(cfg({ maxConcurrent: 1 }), deps);           // cap 1: slot HARUS jatuh ke SPEC-free
    expect(launched).toEqual(["SPEC-free"]);
    const blk = (await queueItemForSpec("SPEC-blk"))!;
    expect(blk.status).toBe("queued");                      // bukan failed — pemblokirnya akan selesai
    expect(blk.note).toBe("menunggu SPEC-dep (belum ter-merge)");
    expect(blk.sessionId).toBeNull();
  });

  it("tak menulis ulang note yang sama (tick 10 detik bukan 8.640 write/hari)", async () => {
    await enqueue({ specId: "SPEC-blk2", projectId: "p1", source: "backlog", priority: "tinggi" });
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null, isDone: async () => false,
      blockers: async () => [{ id: "SPEC-dep", reason: "unfinished" as const }],
      launch: async () => "s",
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    const first = (await queueItemForSpec("SPEC-blk2"))!.updatedAt;
    await new Promise((r) => setTimeout(r, 20));
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect((await queueItemForSpec("SPEC-blk2"))!.updatedAt.getTime()).toBe(first.getTime());
  });
```

Tambahkan `blockers: async () => [],` ke **setiap** literal `GovernorDeps` lama di kedua berkas test (9 tempat: `scheduler-governor.test.ts` baris ±15, 24, 33-38, 52-57, 70-75, 84-86; `scheduler-engine.test.ts` baris ±14, 53, 61). Tanpa itu berkas tak akan ter-typecheck.

> Catatan: `SchedulerQueueItem` punya `updatedAt`? Bila kolomnya tidak ada, ganti asersi test kedua menjadi: mata-matai jumlah `prisma.schedulerQueueItem.update` dengan membungkusnya —
> lebih sederhana: ubah note dependency di antara dua `drain` dan pastikan note ikut berubah, lalu
> jalankan `drain` ketiga dengan blocker yang sama dan pastikan note tetap. Jalankan
> `grep -n "model SchedulerQueueItem" -A 15 server/prisma/schema.prisma` lebih dulu dan sesuaikan.

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/scheduler-governor.test.ts
```
Expected: FAIL — `deps.blockers is not a function` / item terblokir tetap diluncurkan.

- [x] **Step 3: Write minimal implementation**

`server/src/services/scheduler/queue.ts` — tambahkan sesudah `markDone`:

```ts
// SPEC-447 · ADR-0093 · alasan sebuah baris DIAM di antrean, tanpa mengubah statusnya. Ditulis
// HANYA saat berubah: governor berdenyut tiap 10 detik, dan menulis note identik tiap tick
// berarti ~8.640 write/hari untuk informasi yang sama.
export async function noteQueued(id: string, note: string): Promise<void> {
  const row = await prisma.schedulerQueueItem.findUnique({ where: { id }, select: { note: true } });
  if (row?.note === note) return;
  await prisma.schedulerQueueItem.update({ where: { id }, data: { note } });
}
```

`server/src/services/scheduler/governor.ts`:

```ts
import { queued, markLaunched, markFailed, markDone, noteQueued } from "./queue";
import { blockedNote, type SpecBlocker } from "../spec-deps";
```

Tambahkan ke `GovernorDeps` (sesudah `isDone`):

```ts
  // SPEC-447 · ADR-0093 · dependency yang belum selesai/ter-merge. WAJIB (bukan opsional): satu-
  // satunya pembangun produksi adalah `prodDeps`, jadi tipe wajib = jaminan kompilasi bahwa
  // gerbangnya tak pernah lupa dipasang. Otomasi tak punya `force`.
  blockers: (specId: string) => Promise<SpecBlocker[]>;
```

Sisipkan gerbang tepat sesudah gerbang `isDone`:

```ts
      if (await deps.isDone(item.specId)) { await markDone(item.id, ALREADY_DONE_NOTE); continue; }
      // SPEC-447 · item yang dependency-nya belum selesai & ter-merge DILEWATI — barisnya tetap
      // `queued` (pemblokirnya akan selesai, dan `enqueue` yang `upsert(update:{})` tak bisa
      // menghidupkan kembali baris yang sudah ditutup), slot TIDAK terpakai, dan drain lanjut ke
      // item berikutnya sehingga satu item terblokir tak menyumbat antrean.
      const blocked = await deps.blockers(item.specId);
      if (blocked.length) { await noteQueued(item.id, blockedNote(blocked)); continue; }
```

`server/src/services/scheduler/engine.ts` — tambahkan import & isi `prodDeps.blockers` sesudah `isDone`:

```ts
import { blockersForSpec } from "../spec-deps";
import { resolveRepoDir } from "../local-binding";
```

```ts
  // SPEC-447 · dibaca ULANG dari DB tepat sebelum launch, seperti `isDone`: `dependsOn` bisa
  // ditulis operator selagi item mengantre, dan merged-ness bergerak sendiri saat ada integrate.
  blockers: async (specId) => {
    const spec = await prisma.spec.findUnique({ where: { id: specId } });
    if (!spec) return [];                       // spec hilang → biar `launch` yang melempar
    return blockersForSpec(spec, await resolveRepoDir(spec.projectId));
  },
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/scheduler-governor.test.ts server/test/scheduler-engine.test.ts server/test/scheduler-queue.service.test.ts server/test/scheduler-reconcile.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/scheduler server/test/scheduler-governor.test.ts server/test/scheduler-engine.test.ts
git commit -m "feat(scheduler): governor melewati backlog yang dependency-nya belum siap

SPEC-447. Gerbang kedua (pola SPEC-431): baris tetap queued + note alasan, slot tak terpakai.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Kontrak zod — `dependsOn` & `force`

**Files:**
- Modify: `shared/src/entities.ts:36-47` (`zSpec`)
- Modify: `shared/src/dto.ts:53-80` (`zCreateSpec`, `zPatchSpec`), `shared/src/dto.ts:295-…` (varian `spec` di `zTerminalSession`)
- Test: `shared/src/spec-deps-contract.test.ts` (baru)

**Interfaces:**
- Consumes: —
- Produces: `zSpecBlocker`, `SpecBlockerDTO`; `Spec.dependsOn: string[]`, `Spec.blockedBy: SpecBlocker[]`; `zCreateSpec`/`zPatchSpec` menerima `dependsOn?: string[]`; varian `{spec}` `zTerminalSession` menerima `force?: boolean`.

- [x] **Step 1: Write the failing test**

Buat `shared/src/spec-deps-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zSpec } from "./entities";
import { zCreateSpec, zPatchSpec, zTerminalSession } from "./dto";

describe("kontrak dependency backlog (SPEC-447)", () => {
  const base = {
    id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "o", payload: null, branchFrom: null,
    baseSha: null, createdAt: "2026-07-31T00:00:00.000Z", startedAt: null,
  };
  it("zSpec memberi default [] untuk dependsOn & blockedBy", () => {
    const s = zSpec.parse(base);
    expect(s.dependsOn).toEqual([]);
    expect(s.blockedBy).toEqual([]);
  });
  it("zSpec menerima blockedBy bertipe alasan yang dikenal saja", () => {
    expect(zSpec.parse({ ...base, blockedBy: [{ id: "SPEC-2", reason: "unmerged" }] }).blockedBy)
      .toEqual([{ id: "SPEC-2", reason: "unmerged" }]);
    expect(zSpec.safeParse({ ...base, blockedBy: [{ id: "SPEC-2", reason: "apa-saja" }] }).success)
      .toBe(false);
  });
  it("zCreateSpec menerima dependsOn opsional", () => {
    const r = zCreateSpec.safeParse({
      project: "p1", source: "brief", title: "t", priority: "sedang",
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" },
      dependsOn: ["SPEC-9"],
    });
    expect(r.success && r.data.dependsOn).toEqual(["SPEC-9"]);
  });
  it("zPatchSpec menerima dependsOn (termasuk pengosongan)", () => {
    expect(zPatchSpec.parse({ dependsOn: [] }).dependsOn).toEqual([]);
  });
  it("zTerminalSession varian spec menerima force", () => {
    const r = zTerminalSession.safeParse({ spec: "SPEC-1", flow: "feature", force: true });
    expect(r.success && "force" in r.data && r.data.force).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run shared/src/spec-deps-contract.test.ts
```
Expected: FAIL — `dependsOn`/`blockedBy` undefined, `force` dibuang.

- [x] **Step 3: Write minimal implementation**

`shared/src/entities.ts` — tepat sebelum `export const zSpec`:

```ts
// SPEC-447 · ADR-0093 · alasan sebuah backlog item tertahan. `missing` = dependency-nya tak ada
// (mis. terhapus di mesin lain sebelum sync menyusul); `unfinished` = stage belum `done`;
// `unmerged` = sudah `done` tapi commit-nya belum ada di branch basis item ini.
export const zSpecBlocker = z.object({
  id: z.string(), reason: z.enum(["missing", "unfinished", "unmerged"]),
});
export type SpecBlocker = z.infer<typeof zSpecBlocker>;
```

Di dalam objek `zSpec`, sesudah `startedAt`:

```ts
  // SPEC-447 · ADR-0093 · id backlog yang harus selesai & ter-merge lebih dulu. Server selalu
  // menormalkannya ke array (kolom DB-nya `Json?`), `.default([])` menjaga respons lama.
  dependsOn: z.array(z.string()).default([]),
  // Turunan (bukan kolom): dihitung `liveSpecs` dari stage dependency + git. Klien tak pernah
  // mengirimkannya — `.default([])` supaya bentuk lama tetap parse.
  blockedBy: z.array(zSpecBlocker).default([]),
```

`shared/src/dto.ts` — pada `zCreateSpec`, di dalam `z.object({…})` sebelum `)` penutup:

```ts
  branchFrom: z.string().min(1).optional(),
  dependsOn: z.array(z.string()).optional() })   // SPEC-447 · ADR-0093 · divalidasi server (ada / satu project / non-siklus)
```

Pada `zPatchSpec`, tambahkan:

```ts
  // SPEC-447 · ADR-0093 · SENGAJA di luar gerbang `editingContent` (SPEC-186): gerbang itu
  // melindungi konten yang sudah jadi dasar kerja sesi berjalan, sedangkan dependsOn hanya
  // menggerbangi peluncuran BERIKUTNYA. `[]` = kosongkan.
  dependsOn: z.array(z.string()).optional(),
```

Pada varian `{spec}` di `zTerminalSession`, tambahkan field:

```ts
    // SPEC-447 · ADR-0093 · lewati gerbang dependency. Hanya jalur manusia; UI hanya
    // mengirimkannya sesudah operator melihat daftar pemblokirnya.
    force: z.boolean().optional(),
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run shared/src/spec-deps-contract.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p shared --noEmit
```
Expected: 5 passed; typecheck bersih.

- [x] **Step 5: Commit**

```bash
git add shared/src/entities.ts shared/src/dto.ts shared/src/spec-deps-contract.test.ts
git commit -m "feat(shared): kontrak dependsOn/blockedBy + force di zod (SPEC-447)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `liveSpecs` menghias `blockedBy` (HTTP & WS satu sumber)

**Files:**
- Modify: `server/src/services/live-specs.ts`
- Test: `server/test/live-specs-blocked.test.ts` (baru)

**Interfaces:**
- Consumes: `decorateBlocked` (Task 3).
- Produces: `liveSpecs()` mengembalikan baris ber-`dependsOn: string[]` + `blockedBy: SpecBlocker[]`.

- [x] **Step 1: Write the failing test**

Buat `server/test/live-specs-blocked.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { liveSpecs } from "../src/services/live-specs";
import { __clearMergeCache } from "../src/services/spec-deps";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(async () => { await clean(); __clearMergeCache(); });
afterAll(clean);

const spec = (id: string, over: Record<string, unknown> = {}) => prisma.spec.create({
  data: { id, projectId: "pl", title: id, source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "", ...over },
});

// SPEC-447 · `liveSpecs` dipakai GET /specs DAN grup siar WS `specs`. Menghias hanya salah satunya
// membuat badge berkedip tiap frame WS tiba — persis alasan SPEC-199 menyatukan keduanya.
describe("liveSpecs · blockedBy (SPEC-447)", () => {
  beforeEach(() => prisma.project.create({ data: { id: "pl", name: "PL", desc: "", kind: "existing" } }));

  it("spec tanpa dependency mendapat dependsOn [] dan blockedBy []", async () => {
    await spec("SPEC-L1");
    const [row] = await liveSpecs({ project: "pl" });
    expect(row).toMatchObject({ id: "SPEC-L1", dependsOn: [], blockedBy: [] });
  });

  it("dependency belum selesai muncul sebagai blockedBy unfinished", async () => {
    await spec("SPEC-L1");
    await spec("SPEC-L2", { dependsOn: ["SPEC-L1"] });
    const rows = await liveSpecs({ project: "pl" });
    const l2 = rows.find((r) => r.id === "SPEC-L2")!;
    expect(l2.dependsOn).toEqual(["SPEC-L1"]);
    expect(l2.blockedBy).toEqual([{ id: "SPEC-L1", reason: "unfinished" }]);
  });

  it("dependency yang tak ada → missing (bukan diam-diam lolos)", async () => {
    await spec("SPEC-L3", { dependsOn: ["SPEC-HILANG"] });
    const rows = await liveSpecs({ project: "pl" });
    expect(rows[0]!.blockedBy).toEqual([{ id: "SPEC-HILANG", reason: "missing" }]);
  });

  it("dependency done tanpa headSha tidak memblokir", async () => {
    await spec("SPEC-L4", { stage: "done" });
    await spec("SPEC-L5", { dependsOn: ["SPEC-L4"] });
    const rows = await liveSpecs({ project: "pl" });
    expect(rows.find((r) => r.id === "SPEC-L5")!.blockedBy).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/live-specs-blocked.test.ts
```
Expected: FAIL — `dependsOn`/`blockedBy` tidak ada di hasil.

- [x] **Step 3: Write minimal implementation**

`server/src/services/live-specs.ts` — tambahkan import:

```ts
import { decorateBlocked } from "./spec-deps";
```

Ubah dua titik keluar fungsi `liveSpecs`:

```ts
  const live = sessionPhasesBySpec();
  // SPEC-447 · ADR-0093 · dependency dihias DI SINI supaya GET /specs dan grup siar WS `specs`
  // membaca nilai yang sama (SPEC-199). Nol biaya untuk backlog yang tak memakai dependency:
  // decorateBlocked keluar lebih awal saat tak ada satu pun `dependsOn`.
  if (live.size === 0) return decorateBlocked(specs);
```

dan baris terakhir:

```ts
  await Promise.all(doneNow.map((d) => recordCompletion(d.specId, d.title, d.projectId)));
  return decorateBlocked(out);
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/live-specs-blocked.test.ts server/test/events.test.ts server/test/notifications.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/live-specs.ts server/test/live-specs-blocked.test.ts
git commit -m "feat(server): blockedBy ikut liveSpecs (HTTP & WS satu sumber) — SPEC-447

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Route `/specs` — validasi tulis + cleanup saat hapus

**Files:**
- Modify: `server/src/routes/specs.ts` (`POST /specs`, `PATCH /specs/:id`, `DELETE /specs/:id`)
- Test: `server/test/specs.route.test.ts` (tambah `describe` di akhir)

**Interfaces:**
- Consumes: `validateDependsOn`, `dependsOnOf` (Task 3), `zCreateSpec`/`zPatchSpec` (Task 6).
- Produces: `POST /specs` & `PATCH /specs/:id` menolak `dependsOn` tak sah dengan **400** `{ error: string }`; `DELETE /specs/:id` mencabut id itu dari `dependsOn` seluruh spec di project yang sama.

- [x] **Step 1: Write the failing test**

Tambahkan di akhir `server/test/specs.route.test.ts` (gunakan helper `app`/`inject` yang sudah dipakai berkas itu — samakan gayanya dengan `describe` yang sudah ada di sana):

```ts
// SPEC-447 · ADR-0093 · integritas dependency ditegakkan di boundary, bukan FK.
describe("POST/PATCH/DELETE /specs · dependsOn (SPEC-447)", () => {
  it("membuat spec dengan dependsOn yang sah", async () => {
    const dep = await mkSpec("p1");                             // helper berkas ini
    const r = await post("/specs", {
      project: "p1", source: "brief", title: "B", priority: "sedang",
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" },
      dependsOn: [dep.id],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().dependsOn).toEqual([dep.id]);
  });

  it("menolak dependency yang tak ada (400, bukan pelanggaran FK)", async () => {
    const r = await post("/specs", {
      project: "p1", source: "brief", title: "B", priority: "sedang",
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" },
      dependsOn: ["SPEC-TIDAK-ADA"],
    });
    expect(r.statusCode).toBe(400);
    expect(String(r.json().error)).toContain("tak ditemukan");
  });

  it("menolak siklus di PATCH", async () => {
    const a = await mkSpec("p1"); const b = await mkSpec("p1");
    expect((await patch(`/specs/${b.id}`, { dependsOn: [a.id] })).statusCode).toBe(200);
    const r = await patch(`/specs/${a.id}`, { dependsOn: [b.id] });
    expect(r.statusCode).toBe(400);
    expect(String(r.json().error)).toContain("siklus");
  });

  // Gerbang SPEC-186 melindungi KONTEN; dependency menggerbangi peluncuran berikutnya, jadi ia
  // harus tetap bisa diperbaiki sesudah item dimulai — kalau tidak, item yang terlanjur terblokir
  // salah tulis hanya bisa dibebaskan dengan menghapusnya.
  it("dependsOn tetap bisa diubah sesudah item dimulai", async () => {
    const dep = await mkSpec("p1");
    const s = await mkSpec("p1");
    await prisma.spec.update({ where: { id: s.id }, data: { stage: "executing", baseSha: "abc" } });
    const r = await patch(`/specs/${s.id}`, { dependsOn: [dep.id] });
    expect(r.statusCode).toBe(200);
    expect(r.json().dependsOn).toEqual([dep.id]);
  });

  it("menghapus spec mencabutnya dari dependsOn dependent-nya", async () => {
    const dep = await mkSpec("p1");
    const s = await mkSpec("p1");
    await patch(`/specs/${s.id}`, { dependsOn: [dep.id] });
    expect((await del(`/specs/${dep.id}`)).statusCode).toBe(204);
    const row = await prisma.spec.findUnique({ where: { id: s.id } });
    expect(row!.dependsOn).toEqual([]);
  });
});
```

> Sebelum menulis, buka `server/test/specs.route.test.ts` dan pakai helper request yang **sudah ada**
> di sana (nama `post`/`patch`/`del`/`mkSpec` di atas adalah placeholder gaya). Jangan membuat
> harness baru — samakan dengan `describe` tetangga.

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/specs.route.test.ts
```
Expected: FAIL — `dependsOn` tak tersimpan, siklus lolos, cleanup tak terjadi.

- [x] **Step 3: Write minimal implementation**

`server/src/routes/specs.ts` — import:

```ts
import { validateDependsOn, dependsOnOf } from "../services/spec-deps";
```

**POST `/specs`** — sesudah validasi `branchFrom`, sebelum `deriveSpecFields`:

```ts
    // SPEC-447 · ADR-0093 · integritas dependency ditegakkan DI SINI (tak ada FK untuk kolom Json):
    // id harus ada, satu project, bukan diri sendiri. Siklus mustahil untuk spec baru (belum ada
    // yang bisa menunjuk ke sana), jadi specId dikirim null.
    const dep = await validateDependsOn(null, b.project, b.dependsOn ?? []);
    if (!dep.ok) return reply.code(400).send({ error: dep.error });
```

Tambahkan ke `data` pada `prisma.spec.create`:

```ts
            branchFrom: b.branchFrom ?? null,
            dependsOn: dep.ids,
```

**PATCH `/specs/:id`** — tambahkan `dependsOn` ke destrukturisasi:

```ts
    const { branchFrom, stage, confirmDelete, title, priority: newPriority, payload, dependsOn } = parsed.data;
```

Sesudah blok validasi `branchFrom` (dan **di luar** gerbang `editingContent`):

```ts
    // SPEC-447 · ADR-0093 · SENGAJA tak ikut gerbang `editingContent`: dependency menggerbangi
    // peluncuran BERIKUTNYA, bukan konten yang sedang dikerjakan sesi hidup.
    let depIds: string[] | undefined;
    if (dependsOn !== undefined) {
      const d = await validateDependsOn(spec.id, spec.projectId, dependsOn);
      if (!d.ok) return reply.code(400).send({ error: d.error });
      depIds = d.ids;
    }
```

Tambahkan ke tipe & isi `data`:

```ts
    const data: { branchFrom?: string | null; stage?: string; title?: string; priority?: string; objective?: string; payload?: any; dependsOn?: string[] } = {};
    if (branchFrom !== undefined) data.branchFrom = branchFrom;
    if (depIds !== undefined) data.dependsOn = depIds;
```

**DELETE `/specs/:id`** — ganti seluruh handler:

```ts
  app.delete("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // SPEC-447 · ADR-0093 · baca projectId SEBELUM menghapus: kolom `dependsOn` tak punya FK, jadi
    // tanpa pembersihan ini menghapus satu item mengunci dependent-nya SELAMANYA dengan alasan
    // `missing` yang tak bisa diperbaiki dari UI.
    const gone = await prisma.spec.findUnique({ where: { id }, select: { projectId: true } });
    await prisma.spec.delete({ where: { id } }).catch(() => { });
    if (gone) {
      const rows = await prisma.spec.findMany({
        where: { projectId: gone.projectId }, select: { id: true, dependsOn: true },
      });
      for (const r of rows) {
        const ids = dependsOnOf(r);
        if (!ids.includes(id)) continue;
        await prisma.spec.update({ where: { id: r.id }, data: { dependsOn: ids.filter((x) => x !== id) } });
        await notifySynced("spec", r.id);   // SPEC-213/330 · perubahan ini nyata, harus menyeberang
      }
    }
    return reply.code(204).send();
  });
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/specs.route.test.ts server/test/specs-batch.route.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/specs.ts server/test/specs.route.test.ts
git commit -m "feat(api): validasi dependsOn di POST/PATCH + cleanup saat spec dihapus

SPEC-447. Kolom Json tak punya FK, jadi integritasnya ditegakkan di boundary.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Route `/terminal/sessions` — 409 `blocked` + `force`

**Files:**
- Modify: `server/src/routes/terminal.ts:80-100`
- Test: `server/test/terminal.route.test.ts` (tambah `describe` di akhir)

**Interfaces:**
- Consumes: `LaunchError kind "blocked"` + `blockers` (Task 4), `force` di `zTerminalSession` (Task 6).
- Produces: `POST /terminal/sessions {spec}` → **409** `{ error, blocked: true, blockers }` saat terblokir; `{ …, force: true }` → 201.

- [x] **Step 1: Write the failing test**

Tambahkan di akhir `server/test/terminal.route.test.ts`, memakai helper app/inject yang sudah ada di berkas itu:

```ts
// SPEC-447 · ADR-0093 · kontrak HTTP gerbang dependency.
describe("POST /terminal/sessions · dependency (SPEC-447)", () => {
  it("409 + daftar pemblokir saat dependency belum siap", async () => {
    // seed: project ber-repoDir + dua spec, yang kedua bergantung ke yang pertama (stage planned)
    const r = await post("/terminal/sessions", { spec: "SPEC-T2", flow: "feature" });
    expect(r.statusCode).toBe(409);
    expect(r.json().blocked).toBe(true);
    expect(r.json().blockers).toEqual([{ id: "SPEC-T1", reason: "unfinished" }]);
  });

  it("force:true melewati gerbang dan sesi lahir", async () => {
    const r = await post("/terminal/sessions", { spec: "SPEC-T2", flow: "feature", force: true });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBe("spec-t2");
  });
});
```

> Ikuti pola seeding yang sudah dipakai `terminal.route.test.ts` untuk spec-flow (project ber-`repoDir`
> hasil `makeRepoWithBranches`, `HANOMAN_CLAUDE_BIN=/bin/echo`, dan `killSession` di akhir).

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/terminal.route.test.ts
```
Expected: FAIL — 201 padahal seharusnya 409.

- [x] **Step 3: Write minimal implementation**

`server/src/routes/terminal.ts` — di dalam cabang `if ("spec" in parsed.data)`:

```ts
        const r = await startSpecSession(spec, {
          flow: parsed.data.flow, model: parsed.data.model, effort: parsed.data.effort,
          goal: parsed.data.goal, goalCondition: parsed.data.goalCondition,   // SPEC-332 · ADR-0073
          agent: parsed.data.agent,                                           // SPEC-338 · ADR-0074
          verifyScope: parsed.data.verifyScope,                               // SPEC-376 · ADR-0080
          force: parsed.data.force,                                           // SPEC-447 · ADR-0093
        });
```

dan pada pemetaan error:

```ts
        if (e instanceof LaunchError) {
          // Parity status: needs-bind → 400 {needsBind}, worktree gagal → 422.
          // SPEC-447 · ADR-0093 · dependency belum siap → 409 + daftar pemblokirnya, supaya UI
          // bisa menyebut SIAPA yang ditunggu dan menawarkan "Mulai tetap" (force).
          if (e.kind === "blocked")
            return reply.code(409).send({ error: e.message, blocked: true, blockers: e.blockers });
          return e.kind === "needs-bind"
            ? reply.code(400).send({ error: e.message, needsBind: true })
            : reply.code(422).send({ error: e.message });
        }
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/terminal.route.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts
git commit -m "feat(api): 409 blocked + force di POST /terminal/sessions (SPEC-447)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: hanoman-lead tak menata pekerjaan yang terblokir

**Files:**
- Modify: `server/src/services/lead/pulse.ts:250-268` (`orderProject`)
- Test: `server/test/lead-pulse.test.ts` (tambah kasus di `describe` `orderProject` yang sudah ada)

**Interfaces:**
- Consumes: `blockersForSpec` (Task 3).
- Produces: `orderProject` hanya menghitung/menata backlog yang **tidak** terblokir.

- [x] **Step 1: Write the failing test**

Tambahkan ke `server/test/lead-pulse.test.ts` di dalam blok yang menguji `orderProject`:

```ts
  // SPEC-447 · ADR-0093 · gerbang aktionabilitas SPEC-432 diperluas: item yang dependency-nya
  // belum siap TAK BISA diluncurkan governor, jadi menatanya membakar giliran agen untuk nol hasil.
  it("tak memanggil agen bila sisa pekerjaan siap-kerja < 2 sesudah item terblokir disaring", async () => {
    await seedProject({ schedulerOptIn: true, leadOptIn: true });      // helper berkas ini
    await seedSpec("SPEC-P1");
    await seedSpec("SPEC-P2", { dependsOn: ["SPEC-P1"] });             // terblokir oleh P1
    let calls = 0;
    await pulseOnce({ ...deps, decide: async (...a) => { calls++; return deps.decide(...a); } });
    expect(calls).toBe(0);
  });
```

> Sesuaikan nama helper (`seedProject`/`seedSpec`/`pulseOnce`/`deps`) dengan yang **sudah ada** di
> `server/test/lead-pulse.test.ts`. Jangan membuat harness baru.

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-pulse.test.ts
```
Expected: FAIL — agen tetap dipanggil (2 item terbaca siap-kerja).

- [x] **Step 3: Write minimal implementation**

`server/src/services/lead/pulse.ts` — import:

```ts
import { blockersForSpec } from "../spec-deps";
import { resolveRepoDir } from "../local-binding";
```

Ganti pembacaan `ready` di `orderProject` (tambah dua kolom yang dibutuhkan resolver) dan saring:

```ts
  const readyRaw = await prisma.spec.findMany({
    where: { ...UNSTARTED_SPEC_WHERE, projectId },
    select: { id: true, projectId: true, title: true, priority: true, objective: true,
      branchFrom: true, dependsOn: true },
    orderBy: { id: "asc" },
  });
  // SPEC-447 · ADR-0093 · item terblokir takkan diluncurkan governor, jadi menatanya adalah
  // no-op yang tetap membakar satu giliran agen — gerbang aktionabilitas SPEC-432 huruf (B).
  const repoDir = await resolveRepoDir(projectId);
  const ready: typeof readyRaw = [];
  for (const r of readyRaw) if ((await blockersForSpec(r, repoDir)).length === 0) ready.push(r);
  if (ready.length < 2) return 0;
```

Perbarui juga komentar blok JSDoc di atas `orderProject`: syarat ke-2 kini berbunyi "minimal dua backlog siap-kerja **yang tidak terblokir dependency** dan belum punya baris antrean".

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-pulse.test.ts
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/lead/pulse.ts server/test/lead-pulse.test.ts
git commit -m "fix(lead): denyut tak menata backlog yang dependency-nya belum siap (SPEC-447)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: UI — picker dependency di modal backlog baru

**Files:**
- Modify: `src/src/api/client.ts:129,138-140` (tipe `createSpec`/`patchSpec`)
- Modify: `src/src/App.tsx:36-39` (`SpecForm`), `:203-…` (`NewSpecModal`), `:932-951` (`createSpec`), `:1148` (call site)
- Test: `src/test/backlog-dependency.test.tsx` (baru)

**Interfaces:**
- Consumes: `Spec.dependsOn` (Task 6).
- Produces: `NewSpecModal` menerima prop `specs?: Spec[]` dan `SpecForm.dependsOn: string[]`; `api.patchSpec` menerima `dependsOn?: string[]`.

- [x] **Step 1: Write the failing test**

Buat `src/test/backlog-dependency.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })) },
  ApiError: class extends Error {},
}));

import { NewSpecModal } from "../src/App";

const projects = [{ id: "p1", name: "P1" }] as any;
const specs: any[] = [
  { id: "SPEC-1", projectId: "p1", title: "Fondasi", source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "", payload: null, branchFrom: null, baseSha: null,
    createdAt: "2026-07-31T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [] },
  { id: "SPEC-2", projectId: "p2", title: "Project lain", source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "", payload: null, branchFrom: null, baseSha: null,
    createdAt: "2026-07-31T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [] },
];
beforeEach(() => vi.clearAllMocks());

// SPEC-447 · ADR-0093 · dependency adalah properti ITEM, bukan properti bentuk payload — jadi
// picker-nya hidup di luar cabang brief/qa/audit/goal.
describe("NewSpecModal · picker dependency (SPEC-447)", () => {
  it("hanya menawarkan backlog dari project yang dipilih", async () => {
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1"
      onCreate={() => {}} specs={specs} />);
    await waitFor(() => expect(screen.getByLabelText("Bergantung pada SPEC-1")).toBeTruthy());
    expect(screen.queryByLabelText("Bergantung pada SPEC-2")).toBeNull();
  });

  it("mengirim dependsOn yang dicentang", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1"
      onCreate={onCreate} specs={specs} />);
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Turunan" } });
    fireEvent.click(screen.getByLabelText("Bergantung pada SPEC-1"));
    fireEvent.click(screen.getByText("Buat brief → brainstorm"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dependsOn: ["SPEC-1"] })));
  });

  it("tanpa centang, dependsOn kosong", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1"
      onCreate={onCreate} specs={specs} />);
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Bebas" } });
    fireEvent.click(screen.getByText("Buat brief → brainstorm"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dependsOn: [] })));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/backlog-dependency.test.tsx
```
Expected: FAIL — `Bergantung pada SPEC-1` tak ditemukan.

- [x] **Step 3: Write minimal implementation**

`src/src/App.tsx`:

1. `SpecForm` — tambahkan field:

```ts
type SpecForm = { kind: string; project: string; title: string; context: string; outcome: string; constraints: string;
  priority: string; severity: string; steps: string; expected: string; actual: string; env: string; branchFrom: string; fromAudit: string;
  // SPEC-407 · ADR-0089 · backlog goal: goal yang dikejar + bukti berhentinya.
  goal: string; done: string;
  // SPEC-447 · ADR-0093 · backlog yang harus selesai & ter-merge sebelum item ini boleh jalan.
  dependsOn: string[] };
```

2. `NewSpecModal` — tambahkan prop `specs`:

```ts
  { open: boolean; onClose: () => void; projects: ProjectVM[]; defaultProject: string; onCreate: (f: SpecForm) => void;
    prefill?: SpecPrefill;
    // SPEC-447 · ADR-0093 · kandidat dependency. Diambil dari state backlog App (set penuh dari
    // siar WS) — sengaja TANPA fetch baru: daftar yang sama sudah ada di memori.
    specs?: Spec[] }
```

3. `blank` — tambahkan `dependsOn: []`.

4. Di dalam badan komponen, sesudah `const isGoal = …`:

```ts
  // Dependency adalah properti item, bukan properti bentuk payload → di luar cabang kind.
  const depCandidates = (specs ?? []).filter((s) => s.projectId === f.project);
  const toggleDep = (id: string) => setF((s) => ({
    ...s, dependsOn: s.dependsOn.includes(id) ? s.dependsOn.filter((x) => x !== id) : [...s.dependsOn, id],
  }));
```

5. Tambahkan `Field` tepat sesudah `Field label="Branch"` (dan **sebelum** `Field label="Judul"`), impor `Checkbox` dari `./ds` bila belum:

```tsx
      {/* SPEC-447 · ADR-0093 · sesi item ini tak akan lahir sebelum semua yang dicentang
          selesai DAN commit-nya ada di branch basis. Otomasi memblokirnya keras; Start manual
          masih bisa dipaksa lewat konfirmasi. */}
      <Field label="Bergantung pada"
        hint="Backlog yang harus selesai & ter-merge lebih dulu. Kosongkan bila item ini berdiri sendiri.">
        {depCandidates.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-subtle)" }}>
            Belum ada backlog lain di project ini.
          </div>
        ) : (
          <div style={{ maxHeight: 132, overflowY: "auto", display: "flex", flexDirection: "column",
            gap: 6, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 8 }}>
            {depCandidates.map((s) => (
              <Checkbox key={s.id} aria-label={`Bergantung pada ${s.id}`}
                checked={f.dependsOn.includes(s.id)} onChange={() => toggleDep(s.id)}
                label={`${s.id} · ${s.title}`} />
            ))}
          </div>
        )}
      </Field>
```

6. `createSpec(f)` — teruskan ke API:

```ts
      const created = await api.createSpec({ project: f.project, source: f.kind, title: f.title.trim(),
        priority: f.priority, payload, branchFrom: f.branchFrom || undefined,
        // SPEC-447 · ADR-0093 · dikirim hanya bila ada isinya; server yang memvalidasi.
        ...(f.dependsOn.length ? { dependsOn: f.dependsOn } : {}) });
```

7. Call site `<NewSpecModal …>` (baris ±1148) — tambahkan `specs={backlog}`.

`src/src/api/client.ts` — perluas tipe `patchSpec`:

```ts
  patchSpec: (id: string, b: { branchFrom?: string | null; stage?: string; confirmDelete?: boolean;
    title?: string; priority?: string; payload?: unknown;
    dependsOn?: string[] }) =>   // SPEC-447 · ADR-0093
    j<Spec | RevertPending>(paths.spec(id), { method: "PATCH", ...body(b) }),
```

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/backlog-dependency.test.tsx src/test/backlog-goal.test.tsx
env -u NODE_ENV ./node_modules/.bin/tsc -p src --noEmit
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/App.tsx src/src/api/client.ts src/test/backlog-dependency.test.tsx
git commit -m "feat(web): picker dependency di modal backlog baru (SPEC-447)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: UI — badge Terblokir + baris dependency di detail backlog

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (helper label, `SpecCard`, `SpecRow`, `BoardCard`, `SpecDetail`, prop `BacklogScreen`)
- Modify: `src/src/App.tsx` (handler `editDeps` + teruskan ke `BacklogScreen`)
- Test: `src/test/backlog-dependency.test.tsx` (lanjutkan)

**Interfaces:**
- Consumes: `Spec.blockedBy`/`dependsOn` (Task 6), `api.patchSpec({ dependsOn })` (Task 11).
- Produces: `BacklogScreen` menerima `onEditDeps?: (s: Spec, ids: string[]) => void`; ekspor `blockLabel(reason: string): string`.

- [x] **Step 1: Write the failing test**

Tambahkan ke `src/test/backlog-dependency.test.tsx`:

```tsx
import { BacklogScreen } from "../src/screens/BacklogScreen";

const blocked: any = {
  id: "SPEC-9", projectId: "p1", title: "Turunan", source: "brief", stage: "brainstorming",
  priority: "sedang", author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null,
  createdAt: "2026-07-31T00:00:00.000Z", startedAt: null,
  dependsOn: ["SPEC-1"], blockedBy: [{ id: "SPEC-1", reason: "unmerged" }],
};
const free: any = { ...blocked, id: "SPEC-8", dependsOn: [], blockedBy: [] };

describe("BacklogScreen · badge Terblokir (SPEC-447)", () => {
  it("menandai item yang dependency-nya belum siap", async () => {
    render(<BacklogScreen backlog={[blocked]} projects={projects} projectFilter="all"
      onProjectFilter={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Terblokir").length).toBeGreaterThan(0));
  });
  it("item tanpa dependency tak diberi badge", async () => {
    render(<BacklogScreen backlog={[free]} projects={projects} projectFilter="all"
      onProjectFilter={() => {}} />);
    await waitFor(() => expect(screen.getByText("Turunan")).toBeTruthy());
    expect(screen.queryByText("Terblokir")).toBeNull();
  });
  it("detail menyebut siapa yang ditunggu dan alasannya", async () => {
    render(<BacklogScreen backlog={[blocked]} projects={projects} projectFilter="all"
      onProjectFilter={() => {}} />);
    fireEvent.click(await screen.findByText("Turunan"));
    expect(await screen.findByText(/SPEC-1/)).toBeTruthy();
    expect(screen.getAllByText(/belum ter-merge/).length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/backlog-dependency.test.tsx
```
Expected: FAIL — teks `Terblokir` tak ada.

- [x] **Step 3: Write minimal implementation**

`src/src/screens/BacklogScreen.tsx`:

1. Dekat konstanta atas (sesudah `sourceMeta`):

```tsx
// SPEC-447 · ADR-0093 · alasan sebuah item tertahan. Label hidup di UI (server mengirim slug),
// pola yang sama dengan B_PRIO/SOURCE_META.
export const blockLabel = (reason: string): string =>
  reason === "missing" ? "tak ditemukan" : reason === "unmerged" ? "belum ter-merge" : "belum selesai";

function BlockedBadge({ spec }: { spec: Spec }) {
  const bl = spec.blockedBy ?? [];
  if (!bl.length) return null;
  return (
    <Badge tone="warn" size="sm" icon="lock"
      title={bl.map((b) => `${b.id} — ${blockLabel(b.reason)}`).join(" · ")}>Terblokir</Badge>
  );
}
```

2. `SpecCard` — sisipkan `<BlockedBadge spec={spec} />` tepat sesudah badge `branchFrom` di baris meta.
3. `SpecRow` — sisipkan `<BlockedBadge spec={spec} />` tepat sebelum badge prioritas.
4. `BoardCard` — sisipkan di baris meta kartunya (sesudah badge source).
5. `SpecDetail` — tambahkan prop:

```ts
    // SPEC-447 · ADR-0093 · dependency bisa diperbaiki kapan saja (termasuk sesudah item dimulai):
    // gerbangnya soal peluncuran BERIKUTNYA, bukan konten yang sedang dikerjakan.
    onEditDeps?: (s: Spec, ids: string[]) => void;
    allSpecs?: Spec[];
```

dan blok tampil/edit sesudah blok "Branch worktree":

```tsx
      {/* SPEC-447 · ADR-0093 · siapa yang ditunggu item ini, dan kenapa. */}
      <div style={{ marginBottom: 14 }}>
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Bergantung pada</div>
        {(spec.dependsOn ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>— berdiri sendiri</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(spec.dependsOn ?? []).map((id) => {
              const b = (spec.blockedBy ?? []).find((x) => x.id === id);
              return (
                <div key={id} style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{id}</span>{" "}
                  {b ? <Badge tone="warn" size="sm">{blockLabel(b.reason)}</Badge>
                     : <Badge tone="ok" size="sm" icon="check">selesai &amp; ter-merge</Badge>}
                </div>
              );
            })}
          </div>
        )}
        {onEditDeps && (allSpecs ?? []).some((s) => s.projectId === spec.projectId && s.id !== spec.id) && (
          <div style={{ maxHeight: 132, overflowY: "auto", display: "flex", flexDirection: "column",
            gap: 6, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
            padding: 8, marginTop: 8 }}>
            {(allSpecs ?? []).filter((s) => s.projectId === spec.projectId && s.id !== spec.id).map((s) => {
              const on = (spec.dependsOn ?? []).includes(s.id);
              return (
                <Checkbox key={s.id} aria-label={`Bergantung pada ${s.id}`} checked={on}
                  label={`${s.id} · ${s.title}`}
                  onChange={() => onEditDeps(spec, on
                    ? (spec.dependsOn ?? []).filter((x) => x !== s.id)
                    : [...(spec.dependsOn ?? []), s.id])} />
              );
            })}
          </div>
        )}
      </div>
```

6. `BacklogScreen` — terima `onEditDeps` di props dan teruskan ke `<SpecDetail … onEditDeps={onEditDeps} allSpecs={backlog} />`.
7. Impor `Checkbox` dari `../ds` bila belum ada.

`src/src/App.tsx` — handler baru sesudah `editSpec`:

```ts
  // SPEC-447 · ADR-0093 · dependency bisa diubah kapan saja; 400 = validasi server (id asing,
  // lintas project, siklus).
  async function editDeps(spec: Spec, dependsOn: string[]) {
    try {
      const updated = await api.patchSpec(spec.id, { dependsOn });
      if ("pending" in updated) return;
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " · dependency diperbarui", "ok", "lock");
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 400 ? "Dependency ditolak server" : "Gagal menyimpan dependency";
      showToast(msg, "warn", "x-circle");
    }
  }
```

dan tambahkan `onEditDeps={editDeps}` pada `<BacklogScreen … />`.

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/backlog-dependency.test.tsx src/test/backlog-board.test.tsx src/test/backlog-goal.test.tsx
env -u NODE_ENV ./node_modules/.bin/tsc -p src --noEmit
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/src/App.tsx src/test/backlog-dependency.test.tsx
git commit -m "feat(web): badge Terblokir + baris dependency di detail backlog (SPEC-447)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: UI — `StartSessionModal` "Mulai tetap" (force)

**Files:**
- Modify: `src/src/api/client.ts:239-244` (`startSession`)
- Modify: `src/src/App.tsx:50-200` (`StartSessionModal`)
- Test: `src/test/backlog-dependency.test.tsx` (lanjutkan)

**Interfaces:**
- Consumes: `Spec.blockedBy` (Task 6), 409 `blocked` (Task 9).
- Produces: `api.startSession` menerima `force?: boolean`; modal mengirim `force: true` **hanya** bila `spec.blockedBy` tak kosong.

- [x] **Step 1: Write the failing test**

Tambahkan ke `src/test/backlog-dependency.test.tsx` — perluas mock `api` di kepala berkas agar memuat `getSettings`, `getCodexVersion`, `startSession`:

```tsx
// (ganti blok vi.mock di kepala berkas dengan yang ini)
const startSession = vi.fn(async () => ({ id: "spec-9" }));
vi.mock("../src/api/client", () => ({
  api: {
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    getSettings: vi.fn(async () => ({
      model: "claude-opus-5", effort: "xhigh", agent: "claude",
      goal: { enabled: false, condition: "" }, verifyScope: "changed",
    })),
    getCodexVersion: vi.fn(async () => ({ version: null })),
    startSession: (...a: unknown[]) => startSession(...(a as [])),
  },
  ApiError: class extends Error {},
}));
```

```tsx
import { StartSessionModal } from "../src/App";

describe("StartSessionModal · dependency (SPEC-447)", () => {
  it("item terblokir: tombol jadi 'Mulai tetap' dan mengirim force", async () => {
    render(<StartSessionModal open spec={blocked} onClose={() => {}} onStarted={() => {}} />);
    const btn = await screen.findByText("Mulai tetap");
    fireEvent.click(btn);
    await waitFor(() => expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-9", force: true })));
  });

  it("item bebas: tombol tetap 'Mulai' dan force tak pernah terkirim", async () => {
    render(<StartSessionModal open spec={free} onClose={() => {}} onStarted={() => {}} />);
    fireEvent.click(await screen.findByText("Mulai"));
    await waitFor(() => expect(startSession).toHaveBeenCalled());
    expect(startSession.mock.calls[0]![0]).not.toHaveProperty("force");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/backlog-dependency.test.tsx
```
Expected: FAIL — teks `Mulai tetap` tak ada.

- [x] **Step 3: Write minimal implementation**

`src/src/api/client.ts`:

```ts
  startSession: (b: { spec: string; flow: Flow; model?: string; effort?: string; goal?: boolean; goalCondition?: string;
    agent?: Agent;                    // SPEC-338 · ADR-0074 · mesin sesi; kosong → Setting.agent
    verifyScope?: VerifyScope;        // SPEC-376 · ADR-0080 · scope verifikasi; kosong → Setting.verifyScope
    force?: boolean }) =>             // SPEC-447 · ADR-0093 · lewati gerbang dependency (jalur manusia)
```

`src/src/App.tsx` — di `StartSessionModal`, sesudah `const goalLocked = flow === "goal";`:

```ts
  // SPEC-447 · ADR-0093 · gerbang dependency ada di SERVER; ini cerminannya supaya operator tahu
  // apa yang ia paksa sebelum menekannya. `force` tak pernah terkirim bila daftar ini kosong.
  const blockers = s.blockedBy ?? [];
  const isBlocked = blockers.length > 0;
```

Di `start()`:

```ts
      const { id, resumed } = await api.startSession({
        spec: s.id, flow, model, effort, agent,
        goal: goalOn, goalCondition: goalOn && goalCond.trim() ? goalCond.trim() : undefined,
        verifyScope,
        ...(isBlocked ? { force: true } : {}),
      });
```

Banner tepat di bawah kalimat pembuka modal:

```tsx
      {isBlocked && (
        <div data-testid="dep-blocked-note" style={{
          fontSize: 12.5, lineHeight: 1.55, marginBottom: 12, padding: "9px 11px",
          borderRadius: 8, background: "var(--warn-bg, #fdf6e3)", color: "var(--text-strong)",
        }}>
          Backlog ini menunggu{" "}
          {blockers.map((b) => `${b.id} (${b.reason === "missing" ? "tak ditemukan"
            : b.reason === "unmerged" ? "belum ter-merge" : "belum selesai"})`).join(", ")}.
          Sesi bisa tetap dimulai, tapi worktree-nya lahir dari basis yang belum memuat pekerjaan itu.
        </div>
      )}
```

Footer:

```tsx
        <Button leftIcon="play" disabled={busy} variant={isBlocked ? "danger" : "primary"} onClick={start}>
          {isBlocked ? "Mulai tetap" : "Mulai"}
        </Button>
```

> Bila DS `Button` tak punya variant `danger`, pakai `variant="secondary"` — periksa
> `src/src/ds/components/forms.tsx` dan gunakan varian yang memang ada. Label tombol yang membedakan.

- [x] **Step 4: Run test to verify it passes**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/backlog-dependency.test.tsx src/test/codex-version-note.test.tsx
env -u NODE_ENV ./node_modules/.bin/tsc -p src --noEmit
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/App.tsx src/src/api/client.ts src/test/backlog-dependency.test.tsx
git commit -m "feat(web): 'Mulai tetap' + banner pemblokir di StartSessionModal (SPEC-447)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Docs Source of Truth + ADR-0093

**Files:**
- Create: `internal/docs/adr/0093-dependency-antar-backlog.md`
- Modify: `internal/docs/README.md` (blok `## adr`, satu baris di atas 0092)
- Modify: `internal/docs/adr/README.md` (narasi ADR baru)
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/skills/hanoman/SKILL.md` (bagian "Aturan Sesi & Eksekusi")

**Interfaces:**
- Consumes: seluruh perilaku Task 1-13.
- Produces: docs tersentuh diperbarui + ter-link (DoD repo).

- [x] **Step 1: Tulis ADR-0093**

Buat `internal/docs/adr/0093-dependency-antar-backlog.md` dengan format yang sama dengan `0090`/`0091` (baca salah satunya lebih dulu untuk menyalin strukturnya: judul, Status, Konteks, Keputusan, Konsekuensi, Alternatif ditolak). Isi wajib:

- **Status:** Accepted · 2026-07-31 · SPEC-447.
- **Konteks:** tiga jalur peluncuran memperlakukan backlog sebagai independen; `POST /specs/batch` (SPEC-273) bahkan menuliskan asumsi itu; worktree lahir `--detach` dari `branchFrom`, jadi dependent yang lahir sebelum dependency ter-merge **secara fisik** tak memuat pekerjaannya.
- **Keputusan:** kolom `Spec.dependsOn Json?`; siap = `stage=done` **∧** commit ada di basis (turunan git `merge-base --is-ancestor`, memo 15 s); dua gerbang (`startSpecSession` + governor); `force` hanya untuk jalur manusia; `blockedBy` nilai turunan di `liveSpecs`.
- **Konsekuensi:** `dependsOn` menyeberang sync; `dependsOn` sengaja di luar gerbang edit SPEC-186; `DELETE /specs/:id` membersihkan dependent; item terblokir tetap `queued` (bukan `failed`) dan tak memakan slot; lead menyaringnya sebelum membeli giliran agen.
- **Alternatif ditolak:** tabel join `SpecDependency` (entitas sync + PG_ORDER + permukaan API baru untuk manfaat yang tak terpakai — satu tingkat, tanpa metadata edge); menyimpan di `payload` (merusak ikatan source ↔ bentuk payload tiga-arah); `stage=done` saja (mengabaikan bunyi objective "dan di-merge", dan tepat meninggalkan bug basis-salah); blokir keras tanpa `force` (menjebak operator saat dependency salah tulis / merge dilakukan di tempat lain).
- **Gotcha yang wajib tercatat:** (1) `headSha` null pada dependency `done` **bukan** "belum selesai" (SPEC-431) — ia berarti hanoman tak pernah membuatkan worktree, jadi tak ada yang bisa di-merge; (2) fail-closed saat git tak bisa menjawab; (3) `dependsOn` **wajib** ada di `FIELDS.spec`, kalau tidak client kehilangan urutan dan meluncurkan pekerjaan yang di hub terblokir — kelas bug yang sama dengan `createdAt` di SPEC-408; (4) `GovernorDeps.blockers` sengaja **wajib**, bukan opsional, supaya gerbangnya tak bisa lupa dipasang.

- [x] **Step 2: Tautkan di kedua index**

`internal/docs/README.md` — sisipkan sebagai baris **pertama** blok `## adr`:

```markdown
- [0093 — Dependency antar-backlog: kolom `dependsOn` + gerbang "selesai & ter-merge" di dua titik](adr/0093-dependency-antar-backlog.md)
```

`internal/docs/adr/README.md` — tambahkan narasinya mengikuti gaya entri 0091/0092 di sana (apa yang diperluas/dipersempit + gotcha).

- [x] **Step 3: Perbarui doc arsitektur & skill**

`internal/docs/architecture/data-model.md` — pada bagian model `Spec`, tambahkan baris kolom `dependsOn` beserta aturan integritas boundary (ada / satu project / bukan diri sendiri / non-siklus), catatan bahwa ia ikut sync, dan bahwa penghapusan spec membersihkan dependent.

`internal/docs/architecture/api-contract.md` — tambahkan:
- `Spec` bertambah `dependsOn: string[]` dan `blockedBy: {id, reason}[]` (turunan, read-only);
- `POST /specs` & `PATCH /specs/:id` menerima `dependsOn`, menolak **400** dengan alasan;
- `POST /terminal/sessions` varian `{spec}` menerima `force`, dan membalas **409** `{ error, blocked: true, blockers }`.

`internal/skills/hanoman/SKILL.md` — tambahkan butir baru di "Aturan Sesi & Eksekusi", sesudah butir SPEC-431:

```markdown
- **Backlog boleh saling bergantung** (SPEC-447/ADR-0093): `Spec.dependsOn` (kolom `Json?`, array id
  spec **satu project**) menahan peluncuran sampai tiap dependency `stage = done` **DAN** commit-nya
  (`headSha`) sudah ada di branch basis si dependent (`branchFrom ?? "HEAD"`) — merged adalah
  **nilai turunan** git (`merge-base --is-ancestor`, memo 15 dtk), bukan kolom (ADR-0019). Satu
  resolver `services/spec-deps.ts` dipakai TIGA pembaca (gerbang `startSpecSession`, gerbang
  governor, dekorasi `liveSpecs`) — menyalin predikatnya adalah kelas bug SPEC-431. **Empat gotcha:**
  dependency `done` ber-`headSha` null **siap** (hanoman tak pernah membuatkan worktree untuknya —
  membacanya sebagai "belum" mengunci backlog lama selamanya); git yang tak bisa menjawab dibaca
  **belum merged** (fail-closed); `"dependsOn"` **wajib** di `FIELDS.spec` atau client kehilangan
  urutannya dan meluncurkan pekerjaan yang di hub terblokir; dan `GovernorDeps.blockers` sengaja
  **wajib** (bukan opsional) supaya gerbang otomasi tak bisa lupa dipasang. Item terblokir tetap
  `queued` + `note` (bukan `failed` — pemblokirnya akan selesai, dan `enqueue` ber-`update:{}` tak
  bisa menghidupkan baris yang sudah ditutup) dan **tak memakan slot**. `force` **hanya** untuk
  jalur manusia (`POST /terminal/sessions`, 409 tanpa itu); otomasi tak punya jalan paksa.
  `dependsOn` sengaja **di luar** gerbang edit SPEC-186 — ia menggerbangi peluncuran berikutnya,
  bukan konten sesi berjalan.
```

- [x] **Step 4: Verifikasi integritas index**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism server/test/docs.test.ts server/test/coverage.test.ts
```
Expected: PASS (doc baru ter-link, tak ada entri yatim).

- [x] **Step 5: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(spec-447): ADR-0093 dependency antar-backlog + data-model, api-contract, SKILL

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Verifikasi akhir — test tersentuh, typecheck, smoke endpoint

**Files:** tak ada perubahan kode kecuali perbaikan yang muncul dari verifikasi.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism \
  runner/test/git.test.ts \
  shared/src/spec-deps-contract.test.ts \
  server/test/spec-deps.test.ts \
  server/test/live-specs-blocked.test.ts \
  server/test/session-launch.test.ts \
  server/test/session-resume.test.ts \
  server/test/scheduler-governor.test.ts \
  server/test/scheduler-engine.test.ts \
  server/test/scheduler-queue.service.test.ts \
  server/test/scheduler-source-backlog.test.ts \
  server/test/lead-pulse.test.ts \
  server/test/specs.route.test.ts \
  server/test/terminal.route.test.ts \
  server/test/sync.service.test.ts \
  server/test/events.test.ts \
  src/test/backlog-dependency.test.tsx \
  src/test/backlog-board.test.tsx \
  src/test/backlog-goal.test.tsx
```
Expected: seluruhnya PASS. **Jangan menerima "no test files" sebagai bukti** — pastikan jumlah test yang berjalan masuk akal (>150). `sync-ws.test.ts` diketahui non-deterministik (SPEC-376) — bila ia muncul merah, jalankan ulang terisolasi sebelum menyalahkan perubahan ini.

- [ ] **Step 2: Typecheck paket yang tersentuh (satu per satu, bukan `-r`)**

```bash
env -u NODE_ENV ./node_modules/.bin/tsc -p runner --noEmit
env -u NODE_ENV ./node_modules/.bin/tsc -p shared --noEmit
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit
env -u NODE_ENV ./node_modules/.bin/tsc -p src --noEmit
```
Expected: nol keluaran.

- [ ] **Step 3: Smoke endpoint nyata (task ini menyentuh endpoint)**

Boot server di DB & port khusus supaya tak menabrak sesi tetangga, lalu curl jalur yang berubah:

```bash
export SMOKE_HOME="$(mktemp -d)"
HANOMAN_HOME="$SMOKE_HOME" PORT=8799 node --import tsx server/src/server.ts &
SMOKE_PID=$!
sleep 4
# 1) buat project + dua spec, yang kedua bergantung ke yang pertama
# 2) POST /api/terminal/sessions {spec: <kedua>} → HARUS 409 dengan blockers
# 3) POST /api/terminal/sessions {spec: <kedua>, force: true} → 201
# 4) GET /api/specs → spec kedua punya blockedBy terisi
# 5) DELETE spec pertama → GET /api/specs menunjukkan dependsOn spec kedua kosong
kill $SMOKE_PID
```

Tulis langkah 1-5 sebagai perintah `curl` nyata (auth: jalankan `POST /api/auth/setup` lebih dulu dan simpan cookie dengan `curl -c/-b`). Catat status code yang benar-benar keluar; **jangan** melaporkan hijau tanpa keluarannya.

- [ ] **Step 4: Pastikan diff bersih & centang seluruh plan**

```bash
git status --porcelain
grep -c '^- \[ \]' docs/superpowers/plans/2026-07-31-backlog-dependency-spec-447.md
```
Expected: `git status` bersih; hitungan `- [ ]` = 0.

- [ ] **Step 5: Commit & push**

```bash
git add -A
git commit -m "chore(spec-447): verifikasi akhir dependency antar-backlog

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin HEAD:refs/heads/hanoman/spec-447
```

---

## Self-Review

**Spec coverage.** §3 data model → Task 2 · §4 resolver → Task 3 (dan `isAncestor`-nya Task 1) ·
§5.1 gerbang peluncuran → Task 4 · §5.2 governor → Task 5 · §5.3 lead → Task 10 · §5.4 route 409 →
Task 9 · §6 permukaan baca (`liveSpecs` + zod) → Task 6 & 7 · §7 UI → Task 11, 12, 13 · §8 aturan
edit → Task 8 (PATCH di luar `editingContent`) · §9 testing → tersebar + Task 15 · §10 docs →
Task 14. Validasi tulis + cleanup DELETE (§3 aturan integritas) → Task 8. Tidak ada requirement spec
yang tak punya task.

**Type consistency.** `SpecBlocker`/`BlockReason` dinamai identik di server (`spec-deps.ts`) dan
shared (`entities.ts`); `dependsOnOf`, `blockersFor`, `blockersForSpec`, `decorateBlocked`,
`validateDependsOn`, `reaches`, `blockedNote`, `mergedInto`, `__clearMergeCache`, `noteQueued`,
`isAncestor`, `blockLabel` dipakai dengan nama & tanda tangan yang sama di setiap task yang
mengonsumsinya. `LaunchError` punya tiga `kind` dan properti `blockers` di Task 4, dan route Task 9
membacanya persis begitu.

**Catatan yang sengaja dibiarkan sebagai instruksi, bukan kode:** tiga tempat (Task 5 asersi
`updatedAt`, Task 8 helper request `specs.route.test.ts`, Task 10 helper `lead-pulse.test.ts`)
menyuruh implementer membuka berkas test tetangga dan memakai harness yang sudah ada di sana.
Itu bukan placeholder — perilaku dan asersinya sudah ditentukan penuh; yang diserahkan hanya nama
helper lokal, karena menebaknya justru akan melahirkan harness kedua di berkas yang sama.
