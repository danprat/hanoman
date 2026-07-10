# SPEC-160 — Hilangkan Guardrail Source of Truth · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cabut mekanisme guardrail Source of Truth (gate Execute, subprocess `docs verify`, Stop hook, verify in-process, switch dashboard) sehingga tidak ada run yang bisa diblok/digagalkan karena keadaan docs — sementara deny tool-call berbahaya (`safety.ts`) dan tampilan coverage tetap.

**Architecture:** Guardrail punya empat penegak yang bermuara ke `collectViolations` (`cli/src/verify.ts`). Kita hapus keempatnya + array `violations`, dan menyisakan perhitungan `coverage/cats` (read-only) untuk `docs scan`. Tipe `RunDeps.verify` dicabut di `runner`, memaksa perubahan serempak di `server` dan `cli` — karena itu Task 1 menggabung ketiga paket agar workspace tetap ter-typecheck. Dashboard coverage tak tersentuh (sumbernya `server/src/services/scan.ts`, terpisah dari `collectViolations`).

**Tech Stack:** TypeScript (workspace pnpm: `runner`, `server`, `cli`, `shared`, `src`), Zod, Fastify, BullMQ, Vitest, React (Vite).

**Spec:** [`internal/docs/operations/spec-160-hilangkan-guardrail-spec.md`](../../../internal/docs/operations/spec-160-hilangkan-guardrail-spec.md)
**Audit:** [`internal/docs/operations/spec-160-hilangkan-guardrail-audit.md`](../../../internal/docs/operations/spec-160-hilangkan-guardrail-audit.md)
**Keputusan manusia:** `remove-mechanism` (via `.hanoman-ask.json`) — hapus mekanisme, menimpa larangan `CLAUDE.md`, butuh ADR baru.

## Global Constraints

- **Guardrail masih HIDUP untuk run ini sendiri.** Worker yang mengeksekusi plan ini menjalankan kode **pra-penghapusan** (checkout utama, bukan worktree ini). Gate Execute mengecek worktree **sekali di awal fase Execute**; Stop hook (`hanoman hook stop` dari `$CLAUDE_PROJECT_DIR/cli/dist`) mengecek **di akhir tiap giliran fase**. Penghapusan baru berlaku untuk run berikutnya setelah merge + restart worker. **Konsekuensi praktis: jaga `internal/docs/**` 100% ter-link setiap saat** (khususnya ADR-0023 baru **wajib** langsung di-link di `internal/docs/README.md` pada task yang membuatnya), dan **commit tiap task** supaya working tree bersih saat giliran berakhir.
- **`freshnessViolation` hanya memicu untuk `src/`** (`IMPL_PREFIXES = ["src/"]`, `cli/src/git.ts:3`) — hanya paket frontend `src/`, **bukan** `server/`/`runner/`/`cli/`/`shared/`. `DOC_PREFIXES` mencakup `internal/docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md`. Task 3 (satu-satunya yang menyentuh `src/`) me-commit perubahan frontend bersama update doc `internal/docs/**` di commit yang sama — juga aturan `CLAUDE.md`.
- **Tanpa migration, tanpa perubahan skema DB.** `model Setting { id Int; data Json }` — `blockStale`/`requireLinks` hidup di JSON, bukan kolom. Menghapusnya dari `zSetting` tidak menyentuh skema. Baris `Setting` lama tetap terbaca (zod default membuang kunci tak dikenal).
- **Tanpa dependency baru** di `package.json` mana pun.
- **JANGAN sentuh `runner/src/safety.ts`, `cli/src/commands/hook-pretooluse.ts`, `guardCommand`/`resolveCliEntry`.** Itu guardrail deny tool-call (PreToolUse, ADR-0010) — gerbang izin terakhir run headless, **di luar scope**. `resolveCliEntry` tetap dipakai menyusun perintah hook itu.
- **Nomor ADR tentatif `0023`. Enumerasi ulang saat Task 4** atas `refs/heads`+`refs/remotes` **dan** direktori `.worktrees/*` (preseden ADR-0020; worktree detached tak terlihat via `refs/*`). Pakai nomor bebas terkecil.
- **Jangan `git add -A`, jangan `git stash`.** Ada `.hanoman-decision.json`/artefak runner di root worktree (dihapus runner sendiri sebelum `commitAndPush`); jangan pernah men-stage-nya. Stage berkas eksplisit per task.
- **Perintah test:** seluruh workspace `pnpm test`; per paket `pnpm --filter ./<pkg> test` (`runner`/`server`/`cli`/`shared`/`src`); satu berkas `pnpm --filter ./<pkg> exec vitest run <path>`. Typecheck: `pnpm typecheck`. Build CLI (untuk hook dari worktree): `pnpm --filter ./cli build`.
- **Catatan flaky:** `queue-durability` di paket `server` **order-dependent** — gagal terisolasi, hijau di suite penuh. Jalankan `pnpm --filter ./server test` utuh sebelum menyimpulkan regresi.

---

## File Structure

| File | Perubahan | Task |
|---|---|---|
| `runner/src/run.ts:8-11,158-169` | Hapus `verify` dari `RunDeps`; hapus blok gate Execute | 1 |
| `server/src/runner/deps.ts` | Hapus `VerifyResult`/`classifyVerify`/`retryOnCrash`/`Guard`/`guardEnv`/`verifyViaCli`/`depsWithGuard`/`prodDeps.verify`; simpan `resolveCliEntry`/`guardCommand`/`prodDeps` | 1 |
| `server/src/worker.ts:4,9,52-56` | `runProcessor` default `prodDeps`; buang `depsWithGuard`/`getSetting` | 1 |
| `cli/src/commands/_deps.ts` | Buang `verify` + import `collectViolations` | 1 |
| `runner/test/run.test.ts` | `fakeDeps` buang `verify`; hapus 2 kasus gate; ubah kasus fast-path | 1 |
| `cli/test/flows.cmd.test.ts:21` | Buang baris `verify:` | 1 |
| `server/test/verify-classify.test.ts` | **Hapus berkas** | 1 |
| `cli/src/commands/docs-verify.ts` | **Hapus berkas** | 2 |
| `cli/src/commands/hook-stop.ts` | **Hapus berkas** | 2 |
| `cli/src/git.ts` | **Hapus berkas** (mati setelah verify.ts dipangkas) | 2 |
| `.claude/settings.json` | **Hapus berkas** (isinya hanya Stop hook) | 2 |
| `cli/src/verify.ts` | `collectViolations` → `scanCoverage` (coverage-only) | 2 |
| `cli/src/commands/docs-scan.ts:3,6` | Import `scanCoverage` | 2 |
| `cli/src/config.ts` | `loadConfig` docsDir-only; buang override env | 2 |
| `cli/src/router.ts:14,18,31,35` | Buang dispatch+HELP `docs verify` & `hook stop` | 2 |
| `cli/test/docs-verify.cmd.test.ts` | **Hapus berkas** | 2 |
| `cli/test/hook-stop.cmd.test.ts` | **Hapus berkas** | 2 |
| `cli/test/git.test.ts` | **Hapus berkas** | 2 |
| `cli/test/verify.test.ts` | Tulis ulang untuk `scanCoverage` | 2 |
| `cli/test/config.test.ts` | Pangkas ke `docsDir` saja | 2 |
| `cli/test/router.cmd.test.ts` | **Baru** — perintah jadi unknown | 2 |
| `shared/src/config.ts` | `zHanomanConfig` sisakan `docsDir` | 3 |
| `shared/src/entities.ts:64` | `zSetting` buang `blockStale`/`requireLinks` | 3 |
| `server/src/services/settings.ts` | `DEFAULT_SETTING` buang kedua field | 3 |
| `src/src/screens/SettingsScreen.tsx` | Hapus Card "Source of Truth"; pindah `autoScaffold` ke "Umum"; `S_DEFAULTS`; desc `notifyFail` | 3 |
| `server/test/triggers-settings.route.test.ts` | Tambah kasus PUT tanpa field guardrail | 3 |
| `internal/docs/adr/0023-*.md` | **Baru** — supersedes ADR-0001 | 4 |
| `internal/docs/adr/0001-*.md` | Status → superseded | 4 |
| `CLAUDE.md` | Ganti klausa larangan bypass | 4 |
| `internal/docs/operations/agent-documentation-workflow.md` | Hapus penegakan guardrail | 4 |
| `internal/docs/architecture/api-contract.md` | Body `/settings` tanpa 2 field | 4 |
| `internal/docs/architecture/stack.md`, `data-model.md`, `entrypoints/prd.md`, `requirements/prd.md` | Guardrail bukan gate lagi | 4 |
| `internal/docs/README.md` | Link ADR-0023 | 4 |

**Tak tersentuh:** `runner/src/safety.ts`, `cli/src/commands/hook-pretooluse.ts`, `server/src/services/scan.ts` (coverage dashboard), `cli/src/docs-model.ts`, `cli/src/repo.ts`.

**Urutan wajib:** Task 1 → 2 → 3 → 4. Task 1 melepas import `collectViolations` di `_deps.ts` sebelum Task 2 memangkas `verify.ts`; Task 2 melepas referensi knob config sebelum Task 3 mencabutnya dari skema.

---

## Task 1: Cabut gate Execute + plumbing verify

**Files:**
- Modify: `runner/src/run.ts:8-11` (tipe `RunDeps`), `runner/src/run.ts:158-169` (blok gate)
- Modify: `server/src/runner/deps.ts` (tulis ulang)
- Modify: `server/src/worker.ts:4,9,52-57`
- Modify: `cli/src/commands/_deps.ts`
- Modify: `runner/test/run.test.ts:41,98-114,287-296`
- Modify: `cli/test/flows.cmd.test.ts:21`
- Delete: `server/test/verify-classify.test.ts`

**Interfaces:**
- Produces: `RunDeps = { openSession: OpenSession; git: GitOps }` (tanpa `verify`). `prodDeps` (`server/src/runner/deps.ts` dan `cli/src/commands/_deps.ts`) memenuhi bentuk itu. `resolveCliEntry(startDir?): string` dan `guardCommand(): string` **tetap ada** (dipakai hook PreToolUse).

- [x] **Step 1: Ubah tes runner lebih dulu (jadikan gagal/typecheck-error)**

Di `runner/test/run.test.ts`:

Baris 41 — hapus `verify` dari `fakeDeps`. Ganti:
```ts
  verify: () => ({ blocked: false }), ...over });
```
menjadi:
```ts
  ...over });
```

Hapus **dua** kasus gate (baris 98-114): blok `it("blocks at execute when docs are stale …")` dan `it("fails at execute with a tool-error log when the guardrail crashes …")` — hapus seluruh kedua `it(...)`.

Ganti kasus fast-path (baris 287-296) menjadi regresi "tidak ada gerbang":
```ts
  // SPEC-160: tak ada lagi gerbang docs-verify. Fast path tetap membuka tepat satu sesi.
  it("does NOT gate Execute and opens exactly one session on the fast path", async () => {
    const { repoDir } = qaTree('{"path":"execute"}');
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
    const events: any[] = [];
    const r = await runOne(input({ repoDir, flow: "qa" }), fakeDeps({ openSession }), (e) => events.push(e));
    expect(r.status).toBe("done");
    expect(openSession).toHaveBeenCalledTimes(1);
  });
```

- [x] **Step 2: Jalankan tes runner — harus gagal typecheck/kompilasi**

Run: `pnpm --filter ./runner exec vitest run test/run.test.ts`
Expected: FAIL — `run.ts` masih mendeklarasikan `verify` di `RunDeps` dan blok gate; sekarang `fakeDeps` tak lagi memasoknya.

- [x] **Step 3: Cabut `verify` dari `runner/src/run.ts`**

Ganti tipe `RunDeps` (baris 8-11):
```ts
export interface RunDeps {
  openSession: OpenSession; git: GitOps;
  verify: (cwd: string) => { blocked: boolean; reason?: string; error?: string };
}
```
menjadi:
```ts
export interface RunDeps {
  openSession: OpenSession; git: GitOps;
}
```

Hapus seluruh blok gate Execute (baris 158-169):
```ts
        if (phase === "Execute") {
          const v = deps.verify(worktree);
          if (v.error !== undefined || v.blocked) {
            const why = v.error !== undefined
              ? `guardrail tool error · ${v.error}`
              : `plan diblok · ${v.reason ?? "docs stale (Source of Truth)"}`;
            onEvent({ kind: "log", line: { t: "✗", s: why } });
            onEvent({ kind: "phase", name: phase, state: "failed" });
            onEvent({ kind: "status", status: "failed" });
            return failed();
          }
        }

```
(Hapus juga baris kosong sesudahnya sehingga `onEvent({ kind: "phase", name: phase, state: "active" });` langsung diikuti `const r = await runPhase({...})`.)

- [x] **Step 4: Jalankan tes runner — harus lulus**

Run: `pnpm --filter ./runner exec vitest run test/run.test.ts`
Expected: PASS.

- [x] **Step 5: Tulis ulang `server/src/runner/deps.ts`**

Ganti **seluruh** isi berkas dengan:
```ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeClaudeCliSession, realGit, type RunDeps } from "@hanoman/runner";

// resolveCliEntry MASIH dipakai — menyusun perintah hook PreToolUse (deny perintah berbahaya,
// ADR-0010), BUKAN guardrail Source of Truth (dicabut, SPEC-160). Path CLI tak boleh diturunkan
// dari process.cwd() (dev worker jalan dari server/); jangkar ke marker workspace.
function repoRootFrom(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}
export function resolveCliEntry(startDir: string = process.cwd()): string {
  return join(repoRootFrom(startDir), "cli", "dist", "hanoman.js");
}
// Quoted: resolveCliEntry can sit under a path with spaces, and hook commands are shell-run.
export const guardCommand = () => `node "${resolveCliEntry()}" hook pretooluse`;
export const prodDeps: RunDeps = {
  openSession: makeClaudeCliSession({ guardCommand: guardCommand() }),
  git: realGit,
};
```

- [x] **Step 6: Sunting `server/src/worker.ts`**

Baris 4 — ganti import:
```ts
import { depsWithGuard } from "./runner/deps";
```
menjadi:
```ts
import { prodDeps } from "./runner/deps";
```

Baris 9 — buang `getSetting` (dipakai hanya untuk guard; `maxConcurrent` tetap):
```ts
import { getSetting, maxConcurrent } from "./services/settings";
```
menjadi:
```ts
import { maxConcurrent } from "./services/settings";
```

Baris 52-56 — ganti tanda tangan + hapus pembacaan guard:
```ts
export async function runProcessor(job: Job<RunInput>, deps?: RunDeps): Promise<void> {
  // Guardrail Source of Truth dijalankan sebagai subprocess di worktree run, jadi switch-nya
  // harus dibaca di sini — satu-satunya titik yang punya DB — lalu dititipkan ke deps.verify.
  const setting = await getSetting();
  const d = deps ?? depsWithGuard(setting);
  let input = job.data;
```
menjadi:
```ts
export async function runProcessor(job: Job<RunInput>, deps: RunDeps = prodDeps): Promise<void> {
  const d = deps;
  let input = job.data;
```
(`const d = deps;` menjaga pemakaian `d` di `runOne(input, d, …)` tetap valid tanpa memburu barisnya.)

> **Amandemen (fase Execute).** Rencana ini meleset satu hal: `getSetting()` di `worker.ts` **bukan
> cuma** dipakai untuk guard — hasilnya (`setting.askTimeoutMin`) juga dipakai membangun opsi
> `askTimeoutMs` untuk `runOne` (SPEC-157), beberapa baris di bawah pemanggilan yang dihapus di
> sini. Menghapus `getSetting()` mentah-mentah menyisakan `Cannot find name 'setting'` (TS2304).
> Perbaikan: `services/settings.ts` sudah mengekspor `askTimeoutMs(): Promise<number>` justru untuk
> keperluan ini — pakai itu langsung: `import { askTimeoutMs, maxConcurrent } from
> "./services/settings"` dan `askTimeoutMs: await askTimeoutMs()` di pemanggilan `runOne`, tanpa
> variabel `setting` sama sekali. Juga ditemukan satu konsumen `RunDeps` lain di luar file list
> plan: `server/test/worker.test.ts:27` punya `verify: () => ({ blocked: false })` di `fakeDeps`
> literalnya sendiri (terpisah dari `runner/test/run.test.ts`) — baris itu dihapus juga.

- [x] **Step 7: Sunting `cli/src/commands/_deps.ts`**

Ganti **seluruh** isi berkas dengan:
```ts
import { makeClaudeCliSession, realGit, type RunDeps } from "@hanoman/runner";
// PreToolUse guardrail (deny perintah berbahaya) tetap; ia re-enter binary ini lewat `hook
// pretooluse`. Gate Source of Truth dicabut (SPEC-160) — tak ada lagi field `verify`.
export const prodDeps: RunDeps = {
  openSession: makeClaudeCliSession({ guardCommand: `node "${process.argv[1]}" hook pretooluse` }),
  git: realGit,
};
```

- [x] **Step 8: Sunting `cli/test/flows.cmd.test.ts`**

Baris 21 — hapus baris:
```ts
      verify: () => ({ blocked: false }),
```

- [x] **Step 9: Hapus tes yang usang**

Run: `git rm server/test/verify-classify.test.ts`
(Menguji `classifyVerify`/`retryOnCrash`/`guardEnv` yang sudah dihapus.)

- [x] **Step 10: Typecheck + tes paket tersentuh**

Run: `pnpm typecheck`
Expected: PASS (tak ada referensi `verify`/`depsWithGuard`/`classifyVerify` tersisa).

Run: `pnpm --filter ./runner test && pnpm --filter ./cli test && pnpm --filter ./server test`
Expected: PASS (server: jalankan suite penuh — ingat catatan `queue-durability`).

- [x] **Step 11: Commit**

```bash
git add runner/src/run.ts server/src/runner/deps.ts server/src/worker.ts cli/src/commands/_deps.ts runner/test/run.test.ts cli/test/flows.cmd.test.ts
git rm server/test/verify-classify.test.ts
git commit -m "refactor(runner): cabut gate Execute docs-verify (SPEC-160)"
```

---

## Task 2: Hapus perintah `docs verify` + Stop hook; pangkas verify.ts ke coverage-only

**Files:**
- Delete: `cli/src/commands/docs-verify.ts`, `cli/src/commands/hook-stop.ts`, `cli/src/git.ts`, `.claude/settings.json`
- Delete: `cli/test/docs-verify.cmd.test.ts`, `cli/test/hook-stop.cmd.test.ts`, `cli/test/git.test.ts`
- Modify: `cli/src/verify.ts`, `cli/src/commands/docs-scan.ts:3,6`, `cli/src/config.ts`, `cli/src/router.ts`
- Rewrite: `cli/test/verify.test.ts`, `cli/test/config.test.ts`
- Create: `cli/test/router.cmd.test.ts`

**Interfaces:**
- Consumes: `RunDeps` tanpa `verify` (Task 1).
- Produces: `scanCoverage(cwd: string): { coverage: number; cats: Array<{ category: string; linked: boolean; files: string[]; unlinkedFiles: string[] }> }` (`cli/src/verify.ts`). `loadConfig(repoRoot: string): HanomanConfig` (`cli/src/config.ts`, tanpa param `env`). Router tak lagi mengenal `docs verify`/`hook stop`.

- [x] **Step 1: Tulis ulang tes CLI lebih dulu**

Tulis ulang **seluruh** `cli/test/verify.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { scanCoverage } from "../src/verify";
import { makeRepo } from "./_fixture";
describe("scanCoverage (read-only, SPEC-160)", () => {
  it("all docs linked -> coverage 100", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    expect(scanCoverage(root).coverage).toBe(100);
  });
  it("an unlinked doc drops coverage and marks its category unlinked", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "product/blueprint.md": "y" } });
    const r = scanCoverage(root);
    expect(r.coverage).toBeLessThan(100);
    expect(r.cats.find((c) => c.category === "product")!.linked).toBe(false);
  });
  it("counts a doc reachable only through a sub-index", async () => {
    const { root } = await makeRepo({
      index: "- [adr](adr/README.md)\n",
      docs: { "adr/README.md": "- [0001](0001-x.md)\n", "adr/0001-x.md": "x" } });
    expect(scanCoverage(root).coverage).toBe(100);
  });
  it("no docs dir at all -> coverage 100, not a crash", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    rmSync(join(root, "internal/docs"), { recursive: true });
    expect(scanCoverage(root)).toEqual({ coverage: 100, cats: [] });
  });
  it("throws when docs exist but the index is missing", async () => {
    const { root } = await makeRepo({ docs: { "architecture/stack.md": "x" } });
    rmSync(join(root, "internal/docs/README.md"));
    expect(() => scanCoverage(root)).toThrow(/index Source of Truth tidak ada/);
  });
});
```

Tulis ulang **seluruh** `cli/test/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";
import { makeRepo } from "./_fixture";
describe("config", () => {
  it("returns the default docsDir when no config file", async () => {
    const { root } = await makeRepo({});
    expect(loadConfig(root).docsDir).toBe("internal/docs");
  });
  it("reads docsDir from hanoman.config.json", async () => {
    const { root } = await makeRepo({ files: { "hanoman.config.json": JSON.stringify({ docsDir: "docs" }) } });
    expect(loadConfig(root).docsDir).toBe("docs");
  });
});
```

Buat berkas baru `cli/test/router.cmd.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { run } from "../src/router";
const ctx = () => {
  const err: string[] = [];
  return { c: { cwd: process.cwd(), env: {}, stdout: () => {}, stderr: (s: string) => err.push(s) }, err };
};
describe("router — guardrail Source of Truth dicabut (SPEC-160)", () => {
  it("`docs verify` is now an unknown command", async () => {
    const { c, err } = ctx();
    expect(await run(["docs", "verify"], c)).toBe(1);
    expect(err.join("")).toContain("unknown command");
  });
  it("`hook stop` is now an unknown command", async () => {
    const { c, err } = ctx();
    expect(await run(["hook", "stop"], c)).toBe(1);
    expect(err.join("")).toContain("unknown command");
  });
});
```

- [x] **Step 2: Jalankan tes CLI — harus gagal**

Run: `pnpm --filter ./cli exec vitest run test/verify.test.ts test/config.test.ts test/router.cmd.test.ts`
Expected: FAIL — `scanCoverage` belum ada; `loadConfig` masih terima `env`; `docs verify`/`hook stop` masih ter-dispatch.

- [x] **Step 3: Pangkas `cli/src/verify.ts` ke coverage-only**

Ganti **seluruh** isi berkas dengan:
```ts
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { coverageOf, linkedSetFrom } from "@hanoman/shared";
import { resolveRepo } from "./repo";
import { INDEX_NAME, walkDocs, catStatus } from "./docs-model";
// Coverage read-only untuk `docs scan` dan tampilan. BUKAN guardrail: tak memblokir apa pun.
// Gate Source of Truth (array `violations`) dicabut, SPEC-160.
export function scanCoverage(cwd: string) {
  const { root, docsDir, indexPath } = resolveRepo(cwd);
  const docsRoot = join(root, docsDir);
  // Repo target boleh tak punya docs SoT sama sekali (mis. kirimchat-multi) → coverage 100.
  if (!existsSync(docsRoot)) return { coverage: 100, cats: [] };
  // Docs ADA tapi index hilang = setup docs rusak. Fail loud, bukan diam-diam "semua unlinked".
  if (!existsSync(indexPath)) throw new Error(`index Source of Truth tidak ada: ${indexPath}`);
  const corpus = walkDocs(docsRoot);
  const read = (rel: string): string | null => {
    try { return readFileSync(join(docsRoot, rel), "utf8"); } catch { return null; }
  };
  const linked = linkedSetFrom(INDEX_NAME, corpus, read);
  const files = corpus.filter((f) => f !== INDEX_NAME);
  const cats = catStatus(files, linked);
  const coverage = coverageOf(files.map((f) => ({ category: f.split("/")[0]!, linked: linked.has(f) })));
  return { coverage, cats };
}
```
(Menghapus: `loadConfig` import, `changedPaths`/`freshnessViolation` import, tipe `Violation`, array `violations`, `formatText`, `formatJson`. `resolveRepo` sudah mengurus `docsDir` lewat `loadConfig` internal.)

- [x] **Step 4: Sunting `cli/src/commands/docs-scan.ts`**

Baris 3:
```ts
import { collectViolations } from "../verify";
```
menjadi:
```ts
import { scanCoverage } from "../verify";
```
Baris 6:
```ts
  const r = collectViolations(ctx.cwd);
```
menjadi:
```ts
  const r = scanCoverage(ctx.cwd);
```
(Sisanya — `r.cats`, `r.coverage` — tak berubah; bentuk output `{coverage, categories}` identik.)

- [x] **Step 5: Sederhanakan `cli/src/config.ts`**

Ganti **seluruh** isi berkas dengan:
```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zHanomanConfig, type HanomanConfig } from "@hanoman/shared";
// Hanya membaca `docsDir` (dipakai resolveRepo + server/services/scan). Knob guardrail
// (requireLinks/blockStale/coverageThreshold) dan override env dicabut, SPEC-160.
export function loadConfig(repoRoot: string): HanomanConfig {
  const p = join(repoRoot, "hanoman.config.json");
  const raw = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  return zHanomanConfig.parse(raw);
}
```

- [x] **Step 6: Sunting `cli/src/router.ts` — buang perintah guardrail**

Hapus baris HELP 14 dan 18:
```
  docs verify [--block-if-stale] [--json]   run the SoT guardrail
```
```
  hook stop                                 Claude Code Stop-hook adapter
```

Hapus baris dispatch 31 dan 35:
```ts
  if (group === "docs" && sub === "verify") return (await import("./commands/docs-verify")).default(rest, ctx);
```
```ts
  if (group === "hook" && sub === "stop")   return (await import("./commands/hook-stop")).default(rest, ctx);
```
(Sisakan `docs scan`/`index`/`link` dan `hook pretooluse`.)

- [x] **Step 7: Hapus berkas usang**

```bash
git rm cli/src/commands/docs-verify.ts cli/src/commands/hook-stop.ts cli/src/git.ts .claude/settings.json
git rm cli/test/docs-verify.cmd.test.ts cli/test/hook-stop.cmd.test.ts cli/test/git.test.ts
```

- [x] **Step 8: Jalankan tes CLI — harus lulus**

Run: `pnpm --filter ./cli exec vitest run test/verify.test.ts test/config.test.ts test/router.cmd.test.ts test/docs-scan.cmd.test.ts`
Expected: PASS (`docs-scan.cmd.test.ts` tetap hijau — bentuk output tak berubah).

Run: `pnpm --filter ./cli test && pnpm typecheck`
Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add cli/src/verify.ts cli/src/commands/docs-scan.ts cli/src/config.ts cli/src/router.ts cli/test/verify.test.ts cli/test/config.test.ts cli/test/router.cmd.test.ts
git commit -m "refactor(cli): hapus perintah docs verify + Stop hook, sisakan coverage read-only (SPEC-160)"
```

---

## Task 3: Cabut switch guardrail dari Setting + config schema + UI

**Files:**
- Modify: `shared/src/config.ts`, `shared/src/entities.ts:64`
- Modify: `server/src/services/settings.ts` (`DEFAULT_SETTING`)
- Modify: `src/src/screens/SettingsScreen.tsx`
- Modify: `server/test/triggers-settings.route.test.ts`
- Modify: `internal/docs/architecture/api-contract.md` (di commit yang sama — freshness untuk `src/`)

**Interfaces:**
- Consumes: `zHanomanConfig` sisakan `docsDir` (dipakai `cli/src/config.ts`, `server/src/services/scan.ts` — keduanya hanya baca `.docsDir`).
- Produces: `Setting` tanpa `blockStale`/`requireLinks`. `PUT /settings` mengembalikan `parsed.data` (zSetting-stripped), jadi field yang dicabut tak pernah ikut balik.

- [x] **Step 1: Tambah tes route lebih dulu**

Di `server/test/triggers-settings.route.test.ts`, tambahkan kasus di dalam `describe("triggers + settings", …)` (setelah "gets and updates settings"):
```ts
  it("accepts a settings body without the removed guardrail fields (SPEC-160)", async () => {
    const got = (await app.inject({ url: "/api/settings" })).json() as Record<string, unknown>;
    delete got.blockStale; delete got.requireLinks;
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: { ...got, notifyFail: false } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).not.toHaveProperty("blockStale");
    expect(put.json()).not.toHaveProperty("requireLinks");
  });
```

- [x] **Step 2: Jalankan tes — harus gagal**

Run: `pnpm --filter ./server exec vitest run test/triggers-settings.route.test.ts`
Expected: FAIL — `zSetting` masih mewajibkan `blockStale`/`requireLinks`, jadi `put.json()` masih memuatnya (assertion `not.toHaveProperty` gagal).

- [x] **Step 3: Cabut field dari `shared/src/entities.ts`**

Baris 64:
```ts
  autoDefault: z.boolean(), blockStale: z.boolean(), requireLinks: z.boolean(),
```
menjadi:
```ts
  autoDefault: z.boolean(),
```

- [x] **Step 4: Sederhanakan `shared/src/config.ts`**

Ganti **seluruh** isi berkas dengan:
```ts
import { z } from "zod";
// Knob guardrail (requireLinks/blockStale/coverageThreshold) dicabut, SPEC-160. Sisa `docsDir`
// dipakai untuk menemukan direktori docs (resolveRepo, server/services/scan).
export const zHanomanConfig = z.object({
  docsDir: z.string().default("internal/docs"),
});
export type HanomanConfig = z.infer<typeof zHanomanConfig>;
```

- [x] **Step 5: Cabut field dari `DEFAULT_SETTING`**

Di `server/src/services/settings.ts`, ubah:
```ts
  autoDefault: true, blockStale: true, requireLinks: true, autoScaffold: true,
```
menjadi:
```ts
  autoDefault: true, autoScaffold: true,
```

- [x] **Step 6: Sunting `src/src/screens/SettingsScreen.tsx`**

(a) `S_DEFAULTS` (baris 32):
```ts
  autoDefault: true, blockStale: true, requireLinks: true, autoScaffold: true,
```
menjadi:
```ts
  autoDefault: true, autoScaffold: true,
```

(b) Ganti Card "Umum" (baris 81-86) agar memuat juga `autoScaffold`:
```tsx
      <Card eyebrow="general" title="Umum">
        <SettingRow title="Full-auto sebagai default"
          desc="Run baru jalan sendiri sampai selesai. Manusia tetap bisa steer / interupsi kapan pun.">
          <Switch checked={s.autoDefault} onChange={sw("autoDefault", "Full-auto default")} />
        </SettingRow>
        <SettingRow title="Auto-scaffold doc index" last
          desc="Project from-scratch otomatis di-scaffold doc index-nya setelah objective terkunci.">
          <Switch checked={s.autoScaffold} onChange={sw("autoScaffold", "Auto-scaffold")} />
        </SettingRow>
      </Card>
```
(catatan: hapus `last` dari baris `autoDefault` — sekarang `autoScaffold` yang terakhir.)

(c) Hapus **seluruh** Card "Source of Truth" (baris 115-128):
```tsx
      <Card eyebrow="guardrails" title="Source of Truth">
        <SettingRow title="Blok plan saat docs stale"
          desc="Stop hook menahan plan sampai docs acuannya diperbarui. Inti workflow docs-driven.">
          <Switch checked={s.blockStale} onChange={sw("blockStale", "Blok docs stale")} />
        </SettingRow>
        <SettingRow title="Wajib link setiap doc"
          desc="Setiap dokumen di internal/docs harus ter-link dari index sebelum execute.">
          <Switch checked={s.requireLinks} onChange={sw("requireLinks", "Wajib link doc")} />
        </SettingRow>
        <SettingRow title="Auto-scaffold doc index" last
          desc="Project from-scratch otomatis di-scaffold doc index-nya setelah objective terkunci.">
          <Switch checked={s.autoScaffold} onChange={sw("autoScaffold", "Auto-scaffold")} />
        </SettingRow>
      </Card>
```

(d) Perbaiki desc `notifyFail` (baris 143):
```tsx
        <SettingRow title="Notifikasi saat run gagal" last desc="Kirim notifikasi ketika plan diblok atau execute gagal.">
```
menjadi:
```tsx
        <SettingRow title="Notifikasi saat run gagal" last desc="Kirim notifikasi ketika run execute gagal.">
```

- [x] **Step 7: Perbarui doc kontrak API (commit yang sama)**

> **Amandemen (fase Execute).** `internal/docs/architecture/api-contract.md` baris `GET/PUT
> /settings` tak pernah mencantumkan daftar field body — jadi tak ada apa pun untuk dihapus di
> sana. Daftar field `Setting` yang sebenarnya hidup di `internal/docs/architecture/data-model.md:53`
> (`autoDefault, blockStale, requireLinks, autoScaffold, maxConcurrent, dailyBudget, notifyFail`).
> Diperbarui di sana, bukan di `api-contract.md` — tetap memenuhi maksud step ini (freshness untuk
> commit yang menyentuh `src/`) dan tetap dilakukan di Task 4 juga untuk baris "## Kunci: docs
> sebagai gerbang" di berkas yang sama.

- [x] **Step 8: Typecheck + tes**

Run: `pnpm typecheck`
Expected: PASS (tak ada `s.blockStale`/`s.requireLinks`/`cfg.requireLinks` tersisa).

Run: `pnpm --filter ./shared test && pnpm --filter ./server test && pnpm --filter ./src test`
Expected: PASS (server suite penuh; `src` termasuk render Settings).

- [x] **Step 9: Commit**

```bash
git add shared/src/config.ts shared/src/entities.ts server/src/services/settings.ts src/src/screens/SettingsScreen.tsx server/test/triggers-settings.route.test.ts internal/docs/architecture/data-model.md
git commit -m "feat(settings): cabut switch guardrail Source of Truth dari Setting + UI (SPEC-160)"
```
(`data-model.md`, bukan `api-contract.md` — lihat amandemen Step 7.)

---

## Task 4: Doc-of-record — ADR baru, supersede ADR-0001, perbarui CLAUDE.md

**Files:**
- Create: `internal/docs/adr/0023-guardrail-sot-dicabut.md` (nomor via enumerasi)
- Modify: `internal/docs/adr/0001-docs-as-source-of-truth.md`
- Modify: `CLAUDE.md`
- Modify: `internal/docs/operations/agent-documentation-workflow.md`
- Modify: `internal/docs/architecture/stack.md`, `data-model.md`, `entrypoints/prd.md`, `requirements/prd.md`
- Modify: `internal/docs/README.md`

**Interfaces:** Docs-only. Tak ada `src/` → freshness tak relevan. **Wajib** ADR baru ter-link di `README.md` (coverage 100).

- [x] **Step 1: Enumerasi nomor ADR bebas**

```bash
for ref in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do git ls-tree -r --name-only "$ref" 2>/dev/null | grep -oE 'internal/docs/adr/[0-9]+'; done | grep -oE '[0-9]+$' | sort -un | tail -3
for d in ../*/internal/docs/adr; do ls "$d" 2>/dev/null | grep -oE '^[0-9]+'; done | sort -un | tail -3
```
Expected: tertinggi saat ini `0022`. Pakai **nomor bebas terkecil** (`0023` bila belum diklaim worktree lain). Ganti `0023` di langkah berikut bila enumerasi menuntut lain.

- [x] **Step 2: Tulis ADR baru**

Buat `internal/docs/adr/0023-guardrail-sot-dicabut.md`:
```markdown
# ADR-0023 — Guardrail Source of Truth dicabut

**Status:** diterima · 2026-07-10 · SPEC-160 · **supersedes ADR-0001**

## Konteks

ADR-0001 menegakkan `internal/docs/**` sebagai Source of Truth lewat gerbang mekanis: gate
Execute (`deps.verify` di `runner/src/run.ts`) yang menggagalkan run, subprocess `hanoman docs
verify`, dan Stop hook (`hanoman hook stop`) yang menahan giliran agen. Backlog SPEC-160
(severity major) meminta gerbang itu dicabut: *"hanoman tidak perlu ikut campur … cukup gunakan
hooks yang ada pada project nya"*.

Audit menemukan tak ada bug aktif — nol run `failed`, dua bug historis (crash path CLI RUN-8801;
switch dashboard diabaikan subprocess, `caff8d3`) sudah diperbaiki. Empat opsi ditawarkan;
manusia memilih **hapus mekanisme** secara eksplisit, menerima bahwa ini membalik ADR-0001 dan
menimpa larangan `CLAUDE.md`.

## Keputusan

Cabut keempat penegak guardrail Source of Truth: gate Execute, subprocess `docs verify`, Stop
hook (`hanoman hook stop` + `.claude/settings.json`), verify in-process CLI, plus switch dashboard
(`blockStale`/`requireLinks`) dan config knob-nya. `internal/docs/**` **tetap** Source of Truth
secara **konvensi** — didokumentasikan, diperbarui per commit — tetapi **tidak lagi ditegakkan
mesin**.

Yang **dipertahankan**: tampilan coverage/docStatus dashboard (`server/src/services/scan.ts`,
terpisah), perintah `hanoman docs scan`/`index`/`link` (read-only), dan **guardrail deny
tool-call** (`runner/src/safety.ts`: `rm -rf`/`git push … main`/`git worktree add`) — gerbang izin
terakhir run headless (ADR-0010), di luar cakupan tiket ini.

## Konsekuensi

- Tak ada run yang bisa berstatus `failed` karena docs stale/coverage/unlinked. `plan diblok` dan
  `guardrail tool error` (ADR-0009) menjadi jalur mati.
- Konsistensi docs kini bergantung disiplin manusia + agen, bukan gerbang. Fast-path QA (ADR-0020)
  kehilangan justifikasi "gate menjaga Execute" — perencanaan tetap dipangkas oleh keputusan
  audit, hanya tanpa gerbang di ujung.
- `Setting` kehilangan dua field JSON (`blockStale`, `requireLinks`) — tanpa migration (bukan
  kolom). Baris lama tetap terbaca.
- ADR-0001 superseded. ADR-0009 (crash fails loud) historis. `CLAUDE.md` diperbarui: larangan
  bypass diganti pernyataan pencabutan.

## Alternatif yang ditolak

- **Matikan default saja / relax ke opt-in.** Ditolak manusia — diminta cabut mekanisme, bukan
  sembunyikan switch.
- **Cabut juga deny tool-call.** Di luar cakupan; menghapusnya = run headless tanpa gerbang izin.
```

- [x] **Step 3: Tandai ADR-0001 superseded**

Di `internal/docs/adr/0001-docs-as-source-of-truth.md`, ubah baris status:
```markdown
**Status:** accepted
```
menjadi:
```markdown
**Status:** superseded oleh [ADR-0023](0023-guardrail-sot-dicabut.md) (SPEC-160) · guardrail SoT dicabut; docs kini konvensi, bukan gate
```

- [x] **Step 4: Perbarui `CLAUDE.md` (root)**

Di bagian "## Jangan", ganti baris:
```markdown
- Jangan bypass Stop hook / guardrail Source of Truth.
```
menjadi:
```markdown
- Guardrail Source of Truth telah dicabut (SPEC-160, ADR-0023): `internal/docs/**` tetap Source of Truth secara konvensi — perbarui docs yang tersentuh dalam commit yang sama — tetapi tak ada lagi gate/Stop hook yang memblokir. Jangan menambahkannya kembali tanpa ADR baru. (Guardrail deny perintah berbahaya di `runner/src/safety.ts` tetap.)
```
(Klausa "Jangan ubah skema tanpa migration + ADR" dan "Jangan jalankan run di working tree utama" **tetap**.)

- [x] **Step 5: Perbarui `agent-documentation-workflow.md`**

Di `internal/docs/operations/agent-documentation-workflow.md`:
- Hapus baris bullet: `- Stop hook **memblokir** plan bila doc acuan stale.`
- Ganti seluruh bagian `## Guardrail (SPEC-002)` dengan catatan singkat bahwa guardrail SoT dicabut (SPEC-160/ADR-0023): docs = konvensi, tampilan coverage tetap, tak ada gate/Stop hook.
- Di `## Runner (SPEC-003)`, hapus/ubah kalimat `Fase Execute lewat gate hanoman docs verify (SPEC-002) — plan diblok bila docs stale.` dan paragraf crash `docs verify` (ADR-0009) menjadi catatan historis atau hapus.

- [x] **Step 6: Perbarui doc arsitektur yang menyebut guardrail sebagai gate**

Sunting seminimal mungkin, hanya kalimat yang menyatakan guardrail **memblokir/menggagalkan**:
- `internal/docs/architecture/stack.md` — baris yang menyebut guardrail/Stop hook sebagai gate.
- `internal/docs/architecture/data-model.md` — bila menyebut `Setting.blockStale/requireLinks`.
- `internal/docs/entrypoints/prd.md`, `internal/docs/requirements/prd.md` — kalimat guardrail-as-gate → konvensi.

Cari dengan: `grep -rn "guardrail\|Stop hook\|docs verify\|blockStale\|requireLinks" internal/docs/architecture internal/docs/entrypoints internal/docs/requirements` dan sesuaikan setiap kalimat yang mengklaim gerbang aktif.

> **Amandemen (fase Execute).** Grep pertama di Task 4 sebelumnya keliru dipersempit ke `prd.md`
> saja alih-alih seluruh direktori `entrypoints/`. Sapuan ulang atas direktori penuh menemukan dua
> klaim gerbang aktif lain yang tak ada di file list rencana: `internal/docs/entrypoints/frd.md:8`
> (EARS: "SHALL memblokir plan") dan `internal/docs/entrypoints/blueprint.md:3,8,11` (tiga kalimat:
> "Tidak ada plan yang boleh execute melewati doc yang stale", "Stop hook memblokir plan bila docs
> stale", "docs sebagai Source of Truth yang ditegakkan"). Keduanya diperbaiki juga. Satu lagi di
> luar cakupan grep (dir `research/`, bukan `architecture/entrypoints/requirements`) tapi juga
> membuat klaim yang sekarang salah: `internal/docs/research/moat.md:3` menyebut "workflow
> docs-driven yang ditegakkan (Stop hook + index coverage)" sebagai moat bisnis — diperbaiki juga
> karena membiarkan Source of Truth berbohong soal kapabilitas produk lebih buruk daripada
> menyimpang satu baris dari file list. `internal/docs/architecture/stack.md:29` juga punya klaim
> operasional terpisah ("jalankan Stop hook (`hanoman docs verify`)") di luar baris `:42,52` yang
> sudah diperiksa rencana (baris itu tentang guardrail PreToolUse, bukan SoT, dan memang benar
> tak diubah) — diperbaiki.

- [x] **Step 7: Link ADR-0023 di index**

Di `internal/docs/README.md`, di bawah `## adr`, tambahkan di urutan teratas:
```markdown
- [0023 — Guardrail Source of Truth dicabut](adr/0023-guardrail-sot-dicabut.md)
```

- [x] **Step 8: Verifikasi index & coverage**

Run: `node cli/dist/hanoman.js docs scan --json`
Expected: `coverage` 100 (ADR-0023 ter-link; ADR-0001 masih ter-link). Bila `cli/dist` belum ter-build sejak Task 2: `pnpm --filter ./cli build` dulu.

- [x] **Step 9: Commit**

```bash
git add internal/docs/adr/0023-guardrail-sot-dicabut.md internal/docs/adr/0001-docs-as-source-of-truth.md CLAUDE.md internal/docs/operations/agent-documentation-workflow.md internal/docs/architecture/stack.md internal/docs/architecture/data-model.md internal/docs/entrypoints/prd.md internal/docs/requirements/prd.md internal/docs/README.md
git commit -m "docs: ADR-0023 cabut guardrail SoT, supersede ADR-0001, perbarui CLAUDE.md (SPEC-160)"
```

---

## Verifikasi akhir (setelah semua task)

- [x] `pnpm typecheck` — bersih.
- [x] `pnpm test` — hijau (server: catatan `queue-durability` order-dependent).

> **Amandemen (fase Execute).** `pnpm test`/`pnpm typecheck` di worktree ini mewarisi `NODE_ENV=production`
> dari shell — itu membuat React jatuh ke production build di `src` (`act(...) is not supported`)
> dan tiga tes SSE-over-Redis di `server` timeout (Fastify berperilaku beda di mode produksi).
> Tak berhubungan dengan SPEC-160 — dikonfirmasi: berkas yang gagal tak mengimpor apa pun yang
> disentuh diff ini, dan gagal identik di isolasi. Dengan `NODE_ENV=test` eksplisit: **464 test
> lulus, 3 skip** (workspace penuh) — nol gagal. Juga: Prisma client belum pernah di-generate di
> worktree fresh ini (`server/node_modules/.prisma` kosong), sumber galat typecheck Prisma yang
> juga tak berhubungan — diperbaiki dengan `pnpm --filter ./server exec prisma generate` (aman,
> tak menyentuh skema/DB, cuma regenerasi client dari `schema.prisma` yang tak berubah).

- [x] `grep -rn "collectViolations\|verifyViaCli\|depsWithGuard\|classifyVerify\|blockStale\|requireLinks\|docs verify\|hook stop" cli/src server/src runner/src shared/src src/src` — nol hit (kecuali `hook pretooluse`/`safety.ts`).
- [x] Test API nyata (aturan `CLAUDE.md`): boot server dari worktree ini.

> **Amandemen (fase Execute).** Port default `8787` sudah dipakai live dev server (proses lain,
> checkout utama) — boot di situ akan bentrok. Dan `DATABASE_URL` dev nyata dipakai bersama semua
> worktree (memori: shared dev DB) — `PUT /settings` sungguhan akan mengubah baris `Setting`
> tunggal yang dipakai dashboard live. Jadi: boot `tsx src/server.ts` dari worktree ini dengan
> `PORT=8799` dan `DATABASE_URL` diarahkan ke `hanoman_test` (DB terisolasi yang sama dipakai
> vitest, di-reset tiap suite) — tetap proses server sungguhan, HTTP request sungguhan lewat kabel,
> Prisma round-trip sungguhan, bukan `app.inject()`. Hasil:
> - `GET /api/settings` awalnya **masih** mengembalikan `blockStale`/`requireLinks` — baris lama di
>   `hanoman_test` belum pernah di-PUT ulang; `getSetting()` membaca JSON mentah tanpa parse zod
>   (hanya `PUT` yang lewat `zSetting.safeParse`), jadi field lama bertahan sampai PUT berikutnya.
>   Ini **konsisten** dengan yang dicatat spec (baris lama tetap terbaca), bukan bug.
> - `PUT /api/settings` dengan body tanpa `blockStale`/`requireLinks` → `200`.
> - `GET /api/settings` sesudahnya → **field itu hilang**. Bukti nyata gate/skema baru bekerja
>   end-to-end, bukan cuma lolos unit test.
> - `node cli/dist/hanoman.js docs verify` → exit 1, "unknown command: docs verify". `hook stop`
>   sama. `docs scan` → exit 0, coverage 100%.
> Server temp dimatikan (`kill`) sesudahnya; `pnpm --filter ./server test` diulang untuk
> memastikan `hanoman_test` tak tercemar oleh curl manual — tetap 243 lulus.

## Self-Review (dilakukan saat menulis plan)

**Spec coverage:** 16 butir "Perubahan yang diminta" spec → Task 1 (butir 1-4 gate/plumbing), Task 2 (butir 5-12 CLI/hook/config/git), Task 3 (butir 13-15 shared/UI/settings), butir 16 (`.claude/settings.json`) di Task 2. Docs-that-follow spec → Task 4. EARS: "tak gate Execute" → Task 1 Step 1/3 + test; "Stop hook tak blokir / perintah unknown" → Task 2 router test + hapus `.claude/settings.json`; "coverage tetap" → docs-scan.cmd.test.ts hijau + verify final; "safety.ts tetap" → Global Constraints; "PUT tanpa field → 200" → Task 3 test.

**Placeholder scan:** tak ada TBD/etc.; setiap step kode punya blok kode utuh. Task 4 Step 6 memberi perintah `grep` konkret alih-alih "sesuaikan seperlunya" karena kalimat doc bervariasi antar berkas — batasnya eksplisit (hanya kalimat gerbang-aktif).

**Type consistency:** `RunDeps = {openSession, git}` konsisten Task 1 (run.ts/deps.ts/_deps.ts/tests). `scanCoverage(cwd): {coverage, cats}` konsisten Task 2 (verify.ts/docs-scan.ts/test). `zHanomanConfig` → `{docsDir}` konsisten (config.ts/scan.ts). `HanomanConfig` tetap nama tipe.

> Chiranjivi — plan ini turunan dari [spec SPEC-160](../../../internal/docs/operations/spec-160-hilangkan-guardrail-spec.md); saat konflik, spec menang.
