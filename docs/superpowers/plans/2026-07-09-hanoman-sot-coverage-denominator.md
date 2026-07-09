# SoT Coverage — Denominator Dipersempit ke `docsDir` · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coverage SoT hanya menghitung dokumen di bawah `docsDir`, dan `linkedSetFrom` (BFS transitif) menjadi satu-satunya penentu linked/unlinked di server maupun CLI.

**Architecture:** Pisahkan **korpus browse** (semua `**/*.md` repo, untuk tree/edit/hapus) dari **korpus skor** (file di bawah `docsDir`, dikurangi index root `docsDir/README.md`). Kategori di luar `docsDir` diberi `scored: false` dan tidak dinilai. `walkDocs` berhenti mengecualikan `README.md` supaya sub-index masuk korpus dan BFS bisa menelusurinya — tanpa ini, transitif tidak pernah benar-benar bekerja.

**Tech Stack:** TypeScript strict, pnpm workspace, vitest, Fastify, React + Vite, zod.

**Spec:** [`docs/superpowers/specs/2026-07-09-hanoman-sot-coverage-denominator-design.md`](../specs/2026-07-09-hanoman-sot-coverage-denominator-design.md)

## Global Constraints

- **Tanpa dependency runtime baru.** Tidak ada paket baru di `package.json` mana pun.
- **Barrel `shared/src/index.ts` bebas `node:*`.** Web mem-bundle-nya lewat Vite; import `node:fs` di sana merusak build. Metrik tetap murni; adapter fs disuplai server & CLI masing-masing.
- **`coverageOf` dan `docStatusFor` tidak boleh diubah.** Unit tetap kategori, ambang tetap 90/60. File `shared/src/coverage.ts` hanya boleh dibaca, tidak diedit.
- **`zHanomanConfig` tidak bertambah field.** `docsDir` default `internal/docs`, `coverageThreshold` default `100` — keduanya tetap.
- **Update `internal/docs` yang tersentuh dalam commit yang sama** (aturan `CLAUDE.md`). Setiap task di bawah sudah menyertakan doc yang relevan di step commit-nya.
- **Index SoT** adalah `docsDir/README.md`. Root `README.md` repo adalah entrypoint, **bukan** index — tidak ada fallback.
- **Failure mode berbeda dan disengaja:** CLI melempar bila index hilang (fails loud, ADR-0009); server mengembalikan `coverage: 0` tanpa crash.
- **Nomor ADR berikutnya adalah 0013** (`0012-cost-is-an-estimate-not-a-guardrail.md` sudah ada).
- Perintah test per paket: `pnpm --filter ./cli test`, `pnpm --filter ./server test`, `pnpm --filter ./src test`. Satu file: `pnpm --filter ./cli exec vitest run test/verify.test.ts`.

---

## File Structure

| File | Tanggung jawab | Task |
|---|---|---|
| `cli/src/docs-model.ts` | `INDEX_NAME`, `walkDocs` (korpus docsDir, kini memuat README), `parseIndex` (link **langsung** satu file — hanya untuk dangling & `--fix`), `catStatus` | 1 |
| `cli/src/verify.ts` | Kumpulkan violation; `linked` dari `linkedSetFrom` | 1 |
| `cli/src/commands/docs-index.ts` | `--check`/`--fix`; `unlinked` dari `linkedSetFrom`, `dangling` dari `parseIndex` | 1 |
| `internal/docs/adr/0013-sot-coverage-scoped-to-docsdir.md` | Catatan keputusan + konsekuensi melonggarnya guardrail | 1 |
| `shared/src/dto.ts` | `zDocIndexCat` + `scored` | 2 |
| `server/src/services/scan.ts` | Baca `docsDir`, scoping denominator, flag `scored`, index tanpa fallback | 2 |
| `src/src/screens/DocsWorkspace.tsx` | `firstDoc`, grup "Lainnya (tidak dinilai)" | 3 |

`shared/src/coverage.ts` dan `server/src/services/docs.ts` **tidak berubah**.

---

## Task 1: CLI menilai `linked` secara transitif

Sub-index (`adr/README.md` → 12 ADR) menjadi sah. Denominator CLI sudah `docsDir` sejak awal, jadi task ini murni soal transitivitas.

**Files:**
- Modify: `cli/src/docs-model.ts:15-27` (`walkDocs`)
- Modify: `cli/src/verify.ts:1-28` (`collectViolations`)
- Modify: `cli/src/commands/docs-index.ts:1-23`
- Create: `internal/docs/adr/0013-sot-coverage-scoped-to-docsdir.md`
- Modify: `internal/docs/README.md:24-25` (link ADR-0013)
- Test: `cli/test/verify.test.ts`, `cli/test/docs-model.test.ts`, `cli/test/index-link.cmd.test.ts`

**Interfaces:**
- Consumes: `linkedSetFrom(indexRel, docs, read)` dari `@hanoman/shared` — sudah ada, tidak diubah. Ia hanya menelusuri link yang targetnya ada di `docs` (`inCorpus.has(rel)`), sehingga sub-index **wajib** ikut di `docs`.
- Produces: `INDEX_NAME = "README.md"` diekspor dari `cli/src/docs-model.ts` (bukan dari `verify.ts` — `docs-index.ts` sebuah command, ia tidak boleh mengimpor guardrail hanya untuk sebuah konstanta). `walkDocs(docsRoot): string[]` kini memuat `README.md` dan setiap sub-`README.md`, path relatif terhadap `docsRoot`, posix. `parseIndex(indexPath): Set<string>` tidak berubah tanda tangannya.

- [ ] **Step 1: Tulis test yang gagal — doc lewat sub-index**

Tambahkan ke `cli/test/verify.test.ts`, di dalam `describe("collectViolations", ...)`:

```ts
  // Index root menunjuk sub-index; sub-index menunjuk doc. Reachability transitif.
  it("counts a doc reachable only through a sub-index", async () => {
    const { root } = await makeRepo({
      index: "- [adr](adr/README.md)\n",
      docs: { "adr/README.md": "- [0001](0001-x.md)\n", "adr/0001-x.md": "x" } });
    const r = collectViolations(root);
    expect(r.violations).toEqual([]);
    expect(r.coverage).toBe(100);
  });

  // `linkedSetFrom` menelan error baca, jadi tanpa guard eksplisit index yang hilang
  // akan diam-diam terbaca "semua doc unlinked" alih-alih crash (ADR-0009). Hari ini
  // `parseIndex` melempar ENOENT, yang tidak cocok dengan pesan ini — test ini merah.
  it("throws when the index is missing instead of reporting everything unlinked", async () => {
    const { root } = await makeRepo({ docs: { "architecture/stack.md": "x" } });
    rmSync(join(root, "internal/docs/README.md"));
    expect(() => collectViolations(root)).toThrow(/index Source of Truth tidak ada/);
  });
```

Tambahkan `rmSync` ke import `node:fs` di baris 2 file itu:

```ts
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./cli exec vitest run test/verify.test.ts`
Expected: 2 FAIL, 5 PASS.
- `"sub-index"` gagal: `parseIndex` hanya memuat `adr/README.md`, sementara `walkDocs` membuang **setiap** file bernama `README.md`, jadi `adr/0001-x.md` terbaca unlinked → violation `unlinked` + coverage 0.
- `"throws when the index is missing"` gagal: yang terlempar `ENOENT`, bukan pesan berbahasa Indonesia yang diminta.

- [ ] **Step 3: `walkDocs` berhenti mengecualikan README**

Ganti `walkDocs` di `cli/src/docs-model.ts` (baris 15-27) dengan:

```ts
export const INDEX_NAME = "README.md";
// README ikut korpus: `linkedSetFrom` hanya menelusuri link yang targetnya ada di
// korpus, jadi sub-index (`adr/README.md`) harus ada di sini agar bisa ditelusuri.
// Index root disaring belakangan oleh consumer, bukan di sini.
export function walkDocs(docsRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(relative(docsRoot, abs).split("\\").join("/"));
    }
  };
  walk(docsRoot);
  return out;
}
```

- [ ] **Step 4: `collectViolations` memakai `linkedSetFrom`**

Ganti seluruh isi `cli/src/verify.ts` baris 1-28 dengan:

```ts
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { coverageOf, linkedSetFrom } from "@hanoman/shared";
import { resolveRepo } from "./repo";
import { loadConfig } from "./config";
import { INDEX_NAME, walkDocs, catStatus } from "./docs-model";
import { changedPaths, freshnessViolation } from "./git";
export type Violation = { kind: "unlinked" | "freshness" | "coverage"; reason: string };
export function collectViolations(cwd: string) {
  // Caller-nya (hook stop, docs verify/scan) mengoper cwd, bukan repo root — dan cwd
  // bisa berpindah ke subdir mana pun. Pakai root hasil git rev-parse dari resolveRepo
  // untuk SEMUA akses filesystem, bukan cuma indexPath.
  const { root, docsDir, indexPath } = resolveRepo(cwd);
  const cfg = loadConfig(root);
  // Index hilang = guardrail tak bisa menilai apa pun. Fail loud, jangan diam-diam
  // melaporkan semua doc unlinked (ADR-0009).
  if (!existsSync(indexPath)) throw new Error(`index Source of Truth tidak ada: ${indexPath}`);
  const docsRoot = join(root, docsDir);
  const corpus = walkDocs(docsRoot);
  const read = (rel: string): string | null => {
    try { return readFileSync(join(docsRoot, rel), "utf8"); } catch { return null; }
  };
  const linked = linkedSetFrom(INDEX_NAME, corpus, read);
  const docs = corpus.filter((f) => f !== INDEX_NAME); // index bukan doc yang dinilai
  const cats = catStatus(docs, linked);
  const coverage = coverageOf(docs.map((f) => ({ category: f.split("/")[0]!, linked: linked.has(f) })));
  const violations: Violation[] = [];
  if (cfg.requireLinks) {
    const unlinked = cats.flatMap((c) => c.unlinkedFiles);
    if (unlinked.length) violations.push({ kind: "unlinked", reason: `Doc belum ter-link di index: ${unlinked.join(", ")}` });
  }
  if (cfg.blockStale && freshnessViolation(changedPaths(root)))
    violations.push({ kind: "freshness", reason: "Ada perubahan di src/ tanpa perubahan dokumentasi. Update doc terkait di internal/docs/**." });
  if (cfg.coverageThreshold > 0 && coverage < cfg.coverageThreshold)
    violations.push({ kind: "coverage", reason: `Coverage ${coverage}% di bawah ambang ${cfg.coverageThreshold}%.` });
  return { coverage, cats, violations };
}
```

`formatText` dan `formatJson` (baris 29-35) tidak berubah — biarkan apa adanya di bawahnya.

- [ ] **Step 5: Jalankan test verify, pastikan lulus**

Run: `pnpm --filter ./cli exec vitest run test/verify.test.ts`
Expected: PASS, 7 test. Test lama tetap hijau: `architecture/nfr.md` yang tak ter-link tetap menghasilkan violation `unlinked`, dan test coverage-threshold tetap 50% (`architecture` linked, `product` tidak).

- [ ] **Step 6: Perbarui test `walkDocs`**

Ganti test `"walks docs excluding README and dotfiles"` di `cli/test/docs-model.test.ts` (baris 14-20) dengan:

```ts
  it("walks docs including sub-indexes, skipping dotfiles", async () => {
    const { root } = await makeRepo({ index: "# i\n",
      docs: { "architecture/stack.md": "x", "adr/README.md": "y" } });
    const files = walkDocs(join(root, "internal/docs"));
    expect(files.sort()).toEqual(["README.md", "adr/README.md", "architecture/stack.md"]);
  });
```

- [ ] **Step 7: Jalankan test docs-model, pastikan lulus**

Run: `pnpm --filter ./cli exec vitest run test/docs-model.test.ts`
Expected: PASS, 3 test. `parseIndex` dan `catStatus` tetap diuji apa adanya — keduanya tidak berubah.

- [ ] **Step 8: Tulis test yang gagal — `--fix` tidak boleh melink ulang doc yang reachable**

Tambahkan ke `cli/test/index-link.cmd.test.ts`, di dalam `describe("index + link", ...)`:

```ts
  it("--fix leaves docs already reachable through a sub-index alone", async () => {
    const { root } = await makeRepo({
      index: "# index\n\n## adr\n- [adr](adr/README.md)\n",
      docs: { "adr/README.md": "- [0001](0001-x.md)\n", "adr/0001-x.md": "x" } });
    expect(await run(["docs", "index", "--check"], io(root).ctx)).toBe(0);
    expect(await run(["docs", "index", "--fix"], io(root).ctx)).toBe(0);
    const md = readFileSync(join(root, "internal/docs/README.md"), "utf8");
    expect(md).not.toContain("(adr/0001-x.md)"); // sudah reachable lewat sub-index
    expect(md).not.toContain("(README.md)");     // index tak pernah melink dirinya
  });
```

- [ ] **Step 9: Jalankan, pastikan gagal**

Run: `pnpm --filter ./cli exec vitest run test/index-link.cmd.test.ts -t "sub-index"`
Expected: FAIL pada `--check` yang mengembalikan 1, karena `unlinked` masih dihitung flat.

- [ ] **Step 10: `docs-index` memakai `linkedSetFrom` untuk `unlinked`**

Ganti seluruh isi `cli/src/commands/docs-index.ts` dengan:

```ts
import { parseArgs } from "node:util";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { linkedSetFrom } from "@hanoman/shared";
import type { Ctx } from "../router";
import { resolveRepo } from "../repo";
import { INDEX_NAME, parseIndex, walkDocs } from "../docs-model";
import { addLink } from "../index-edit";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({ args, options: { check: { type: "boolean" }, fix: { type: "boolean" } }, allowPositionals: true });
  const { root, docsDir, indexPath } = resolveRepo(ctx.cwd);
  const docsRoot = join(root, docsDir);
  const corpus = walkDocs(docsRoot);
  const read = (rel: string): string | null => {
    try { return readFileSync(join(docsRoot, rel), "utf8"); } catch { return null; }
  };
  // `unlinked` transitif: doc yang reachable lewat sub-index tak perlu dilink ulang.
  const linked = linkedSetFrom(INDEX_NAME, corpus, read);
  const unlinked = corpus.filter((f) => f !== INDEX_NAME && !linked.has(f));
  // `dangling` butuh link LANGSUNG dari index root — himpunan transitif tak bisa
  // memberi tahu target mana yang ditulis di file itu. Karena itu parseIndex tetap.
  const dangling = [...parseIndex(indexPath)].filter((p) => !existsSync(join(docsRoot, p)));
  if (values.fix) {
    for (const f of unlinked) addLink(indexPath, f, f.split("/")[0]!);
    ctx.stdout(`linked ${unlinked.length} doc(s)\n`); return 0;
  }
  if (unlinked.length || dangling.length) {
    ctx.stderr(`index issues — unlinked: ${unlinked.join(", ") || "none"}; dangling: ${dangling.join(", ") || "none"}\n`);
    return 1;
  }
  ctx.stdout("index ok\n"); return 0;
}
```

- [ ] **Step 11: Jalankan seluruh test CLI**

Run: `pnpm --filter ./cli test`
Expected: PASS semua. Perhatikan `docs-scan.cmd.test.ts` dan `docs-verify.cmd.test.ts` — keduanya lewat `collectViolations`, jadi harus tetap hijau tanpa diubah.

- [ ] **Step 12: Tulis ADR-0013**

Create `internal/docs/adr/0013-sot-coverage-scoped-to-docsdir.md`:

```markdown
# ADR-0013 — SoT coverage dihitung atas `docsDir`, dengan reachability transitif

**Status:** accepted · 2026-07-09 · menggantikan kalimat coverage di ADR-0001

## Konteks
SPEC-011 mengunci korpus docs sebagai setiap `**/*.md` di repo. `scanRepoDocs` lalu menghitung
coverage sebagai persentase **seluruh** direktori markdown yang ter-link dari index — sehingga
`docs/superpowers/plans`, `docs/superpowers/specs`, readme vendored, dan root `README.md`/`AGENTS.md`
ikut dituntut ter-index. Tak satu pun dari mereka Source of Truth. Repo ini terukur 75% padahal
`internal/docs/**` 100% bersih.

Terpisah dari itu, "linked" punya dua definisi: `cli/src/verify.ts` memakai `parseIndex` (hanya link
langsung dari index root), `server/src/services/scan.ts` memakai `linkedSetFrom` (BFS transitif).
Keduanya kebetulan sepakat hari ini. Begitu ada doc yang di-link lewat sub-index, dashboard hijau
sementara Stop hook memblokir.

## Keputusan
1. Denominator coverage = file di bawah `docsDir` (default `internal/docs`), dikurangi index root
   `docsDir/README.md`. Markdown lain tetap dibrowse dan diedit lewat dashboard, tapi ditandai
   `scored: false` dan tidak dinilai.
2. `linkedSetFrom` (transitif) menjadi satu-satunya penentu linked/unlinked, di server maupun CLI.
   `parseIndex` bertahan hanya untuk mendeteksi dangling link dan menulis `docs index --fix`.
3. `walkDocs` berhenti mengecualikan `README.md`, karena `linkedSetFrom` hanya menelusuri link yang
   targetnya ada di korpus — tanpa ini sub-index tak pernah tertelusuri.

## Konsekuensi
- (+) Coverage mengukur SoT, bukan setiap direktori markdown yang kebetulan ada di repo.
- (+) Dashboard dan Stop hook memakai satu fungsi, jadi angkanya tak bisa berbeda.
- (+) Sub-index sah: 12 ADR cukup dilistkan di `adr/README.md`, bukan di index root selamanya.
- (−) Guardrail melonggar. Sebelumnya tiap doc wajib di-link **langsung** dari index root.
- Tanpa perubahan skema, tanpa migration, tanpa dependency baru.
```

- [ ] **Step 13: Link ADR-0013 di index**

Di `internal/docs/README.md`, tepat di bawah baris `## adr` (baris 24), sisipkan:

```markdown
- [0013 — SoT coverage scoped to docsDir](adr/0013-sot-coverage-scoped-to-docsdir.md)
```

- [ ] **Step 14: Verifikasi guardrail atas repo sendiri**

Run: `pnpm --filter ./cli exec tsx src/hanoman.ts docs scan --json`
Expected: JSON dengan `"coverage":100` dan setiap kategori `"linked":true`. ADR-0013 yang baru harus ikut linked — kalau tidak, Step 13 terlewat.

- [ ] **Step 15: Commit**

```bash
git add cli/src/docs-model.ts cli/src/verify.ts cli/src/commands/docs-index.ts \
        cli/test/verify.test.ts cli/test/docs-model.test.ts cli/test/index-link.cmd.test.ts \
        internal/docs/adr/0013-sot-coverage-scoped-to-docsdir.md internal/docs/README.md
git commit -m "feat(cli): linked ditentukan transitif lewat linkedSetFrom

walkDocs berhenti mengecualikan README agar sub-index masuk korpus dan
bisa ditelusuri BFS. parseIndex menyusut jadi pendeteksi dangling link
dan penulis docs index --fix. Didasari ADR-0013."
```

---

## Task 2: Server menghitung coverage hanya atas `docsDir`

**Files:**
- Modify: `shared/src/dto.ts:35-36` (`zDocIndexCat`)
- Modify: `server/src/services/scan.ts:1-47`
- Modify: `internal/docs/architecture/api-contract.md:51-53`
- Modify: `internal/docs/operations/spec-011-realtime-sot-scan-objective.md` (blok amandemen di akhir)
- Test: `server/test/scan.test.ts`

**Interfaces:**
- Consumes: `zHanomanConfig` dari `@hanoman/shared` (zod murni, sudah diekspor dari barrel — aman untuk Vite). `linkedSetFrom`, `coverageOf` dari `@hanoman/shared`.
- Produces: `DocCat = { cat: string; files: string[]; linked: boolean; root: boolean; scored: boolean }`. `scanRepoDocs(repoDir: string | null): { coverage: number; tree: DocCat[] }` — tanda tangan tidak berubah. `resolveIndex(repoDir: string, docsDir: string): string` — **parameter bertambah**.

- [ ] **Step 1: Tulis test yang gagal**

Ganti test pertama di `server/test/scan.test.ts` (baris 6-19) dan tambahkan tiga test baru, sehingga `describe("scanRepoDocs", ...)` menjadi:

```ts
describe("scanRepoDocs", () => {
  it("coverage counts only categories inside docsDir, minus the index itself", () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
      "internal/docs/loose/orphan.md": "# orphan",
      "docs/plans/p.md": "# plan",
      "README.md": "# repo",
    });
    const { coverage, tree } = scanRepoDocs(dir);
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

  it("follows a sub-index: docs reachable through adr/README.md count as linked", () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [adr](adr/README.md)",
      "internal/docs/adr/README.md": "- [0001](0001-x.md)",
      "internal/docs/adr/0001-x.md": "# x",
    });
    expect(scanRepoDocs(dir).coverage).toBe(100);
  });

  it("repo without docsDir -> coverage 0, tree still lists markdown", () => {
    const dir = makeTempRepo({ "README.md": "# r", "notes/a.md": "# a" });
    const { coverage, tree } = scanRepoDocs(dir);
    expect(coverage).toBe(0);
    expect(tree.map((t) => t.cat).sort()).toEqual([".", "notes"]);
    expect(tree.every((t) => !t.scored)).toBe(true);
  });

  it("honors docsDir from hanoman.config.json", () => {
    const dir = makeTempRepo({
      "hanoman.config.json": JSON.stringify({ docsDir: "spec" }),
      "spec/README.md": "- [a](a.md)",
      "spec/a.md": "# a",
      "internal/docs/x.md": "# x",
    });
    const { coverage, tree } = scanRepoDocs(dir);
    expect(coverage).toBe(100);
    expect(tree.find((t) => t.cat === "internal/docs")!.scored).toBe(false);
  });

  it("null / missing repoDir -> empty", () => {
    expect(scanRepoDocs(null)).toEqual({ coverage: 0, tree: [] });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/scan.test.ts`
Expected: FAIL. Test pertama melaporkan `coverage` 60 (bukan 50) dan `scored` `undefined`; test config melaporkan 0.

- [ ] **Step 3: Tambahkan `scored` ke DTO**

Ganti `shared/src/dto.ts` baris 35-36 dengan:

```ts
export const zDocIndexCat = z.object({
  cat: z.string(), files: z.array(z.string()), linked: z.boolean(),
  scored: z.boolean(), root: z.boolean().optional() });
```

- [ ] **Step 4: Persempit denominator di `scan.ts`**

Ganti `server/src/services/scan.ts` baris 1-47 dengan:

```ts
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { coverageOf, linkedSetFrom, zHanomanConfig } from "@hanoman/shared";

export type DocCat = { cat: string; files: string[]; linked: boolean; root: boolean; scored: boolean };

// All markdown in the repo — tracked or new — with .gitignore honored (skips
// node_modules/.worktrees/dist for free). Posix rel paths.
export function listRepoDocs(repoDir: string): string[] {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
    { cwd: repoDir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
}

// ponytail: 3 baris; angkat ke adapter node bersama kalau muncul consumer ketiga.
// Barrel shared harus bebas node:*, jadi loadConfig tak bisa tinggal di sana.
function docsDirOf(repoDir: string): string {
  try {
    const raw = readFileSync(resolve(repoDir, "hanoman.config.json"), "utf8");
    return zHanomanConfig.parse(JSON.parse(raw)).docsDir;
  } catch { return zHanomanConfig.parse({}).docsDir; }
}

// Index SoT = docsDir/README.md. Root README.md repo adalah entrypoint, bukan index.
export function resolveIndex(repoDir: string, docsDir: string): string {
  const rel = `${docsDir}/README.md`;
  return existsSync(resolve(repoDir, rel)) ? rel : "";
}

const catOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".");
const nameOf = (rel: string) => (rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel);

// ponytail: naive full re-scan (reads every .md) per call. Add an mtime/HEAD cache
// only if a large repo makes GET /docs slow.
//
// Dua korpus, sengaja dipisah: `files` untuk dibrowse (semua .md repo), `corpus`
// untuk dinilai (di bawah docsDir). Kategori di luar docsDir -> scored:false.
export function scanRepoDocs(repoDir: string | null): { coverage: number; tree: DocCat[] } {
  if (!repoDir || !existsSync(repoDir)) return { coverage: 0, tree: [] };
  const files = listRepoDocs(repoDir);
  const docsDir = docsDirOf(repoDir);
  const index = resolveIndex(repoDir, docsDir);
  const read = (rel: string): string | null => {
    try { return readFileSync(resolve(repoDir, rel), "utf8"); } catch { return null; }
  };
  // README sub-index ikut korpus BFS; hanya index root yang dikeluarkan dari denominator.
  const corpus = files.filter((f) => f.startsWith(docsDir + "/"));
  const inDocs = new Set(corpus);
  const linked = index ? linkedSetFrom(index, corpus, read) : new Set<string>();
  const byCat = new Map<string, DocCat>();
  for (const f of files) {
    const cat = catOf(f);
    const c = byCat.get(cat) ?? { cat, files: [], linked: true, root: cat === ".", scored: inDocs.has(f) };
    c.files.push(nameOf(f));
    c.linked = c.linked && linked.has(f);
    byCat.set(cat, c);
  }
  const scored = corpus.filter((f) => f !== index);
  const coverage = coverageOf(scored.map((f) => ({ category: catOf(f), linked: linked.has(f) })));
  return { coverage, tree: [...byCat.values()] };
}
```

Sisa file (`docAbsPath`, `readDocFile`, `writeDocFile`, `deleteDocFile`, baris 49-72) **tidak berubah**.

- [ ] **Step 5: Jalankan test scan, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/scan.test.ts`
Expected: PASS, 8 test (5 di `scanRepoDocs`, 3 di `doc fs ops`).

- [ ] **Step 6: Jalankan seluruh test server**

Run: `pnpm --filter ./server test`
Expected: PASS. Perhatikan `server/test/docs.route.test.ts`, `docs.test.ts`, `coverage.test.ts`, `projects.route.test.ts` — bila salah satunya menegaskan bentuk `tree`, tambahkan `scored` pada ekspektasinya. Jangan mengubah `coverageOf`.

Catatan: memory proyek mencatat `queue-durability` kadang flake pada timeout 5 detik di mesin ini. Itu bukan regresi dari task ini.

- [ ] **Step 7: Cek API nyata (wajib per CLAUDE.md)**

Server mendengarkan di `PORT ?? 8787` (`server/src/server.ts`), dan **semua route berprefiks `/api`** (`app.ts:37`). `POST /api/projects` menurunkan `id` dari `name`, jadi project bernama `hanoman` beralamat di `/api/projects/hanoman`, dan mengembalikan 409 kalau sudah ada — abaikan, lanjutkan.

```bash
pnpm --filter ./server exec tsx src/server.ts & SERVER=$!
for i in $(seq 1 20); do curl -sf localhost:8787/api/health >/dev/null 2>&1 && break; sleep 0.5; done
curl -s -XPOST localhost:8787/api/projects -H 'content-type: application/json' \
  -d "{\"name\":\"hanoman\",\"kind\":\"existing\",\"repoDir\":\"$PWD\"}"
curl -s localhost:8787/api/projects/hanoman/docs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("coverage",j.coverage);console.log("unscored",j.tree.filter(t=>!t.scored).map(t=>t.cat).sort())})'
kill $SERVER
```

Expected: `coverage 100`, dan `unscored` memuat `.`, `.prototype/_ds/…`, `docs/superpowers/plans`, `docs/superpowers/specs`. Jalankan dari root repo — `$PWD` yang dipakai sebagai `repoDir`.

Dua peringatan dari memory proyek: DB sengaja dijaga kosong untuk pemakaian nyata, jadi project `hanoman` di atas memang perlu dibuat sekali; dan meng-enqueue run saat worker dev hidup akan menjalankan run **nyata**. Langkah ini hanya menyentuh `POST /projects` dan `GET /docs`, tidak pernah `/runs` — aman.

- [ ] **Step 8: Perbarui `api-contract.md`**

Ganti baris 51-53 dengan:

```markdown
> Docs dibaca/ditulis **live dari `Project.repoDir`** (tanpa salinan DB — ADR-0011). Korpus **browse** =
> semua `**/*.md` via `git ls-files`. `GET /docs` re-scan tiap panggilan; `POST /projects/:id/scan`
> menyegarkan cache `Project.coverage`/`docStatus`. Korpus **skor** = hanya file di bawah `docsDir`
> (default `internal/docs`) dikurangi index root; kategori di luarnya bertanda `scored: false` dan tidak
> dinilai. SoT coverage = % kategori berskor yang seluruh Markdown-nya **transitif reachable** dari
> `docsDir/README.md` (ADR-0013).
```

- [ ] **Step 9: Catat amandemen di objective SPEC-011**

Tambahkan di akhir `internal/docs/operations/spec-011-realtime-sot-scan-objective.md`, setelah blok kutipan Chiranjivi:

```markdown

## Amandemen — 2026-07-09 (ADR-0013)

Kriteria sukses **SoT Coverage dari link graph nyata** di atas menyebut korpus = setiap `**/*.md` di
repo. Butir itu digantikan: korpus **browse** tetap seluruh repo, tetapi korpus **skor** menyempit ke
`docsDir` dikurangi index root, dan `linkedSetFrom` menjadi satu-satunya penentu linked di server
maupun CLI. Alasan dan konsekuensinya di [ADR-0013](../adr/0013-sot-coverage-scoped-to-docsdir.md).
Sisa objective ini tetap berlaku utuh.
```

- [ ] **Step 10: Commit**

```bash
git add shared/src/dto.ts server/src/services/scan.ts server/test/scan.test.ts \
        internal/docs/architecture/api-contract.md \
        internal/docs/operations/spec-011-realtime-sot-scan-objective.md
git commit -m "feat(server): coverage SoT hanya menghitung docsDir

Korpus browse tetap seluruh repo; korpus skor menyempit ke docsDir minus
index root. Kategori di luarnya bertanda scored:false. Repo ini naik dari
75% palsu ke 100% jujur. ADR-0013; amandemen objective SPEC-011."
```

---

## Task 3: Web memisahkan kategori yang tidak dinilai

**Files:**
- Modify: `src/src/screens/DocsWorkspace.tsx:9` (tipe `DocCat`), `:55-73` (`DocTreeCat`), `:106-206` (preselect + render), `:222-224` (badge)
- Modify: `internal/docs/frontend/frontend-implementation.md:5`
- Test: `src/test/docs-tree.test.ts`

**Interfaces:**
- Consumes: `scored: boolean` pada tiap elemen `tree` dari `GET /docs` (Task 2).
- Produces: `firstDoc(cats: DocCat[]): string` — diekspor dari `DocsWorkspace.tsx`, mengembalikan path repo-relative (`cat + "/" + file`) atau `""`.

- [ ] **Step 1: Tulis test yang gagal untuk `firstDoc`**

Di `src/test/docs-tree.test.ts`, ganti baris 1-4 dengan:

```ts
import { describe, it, expect } from "vitest";
import { buildTree, firstDoc } from "../src/screens/DocsWorkspace";

const cat = (c: string, ...files: string[]) => ({ cat: c, files, linked: true, scored: true });
const other = (c: string, ...files: string[]) => ({ cat: c, files, linked: false, scored: false });
```

lalu tambahkan `describe` baru di akhir file:

```ts
describe("firstDoc", () => {
  it("never preselects a category that is not scored", () => {
    expect(firstDoc([other("docs/superpowers/plans", "p.md"), cat("internal/docs/adr", "0001.md")]))
      .toBe("internal/docs/adr/0001.md");
  });

  it("prefers a linked scored category over an unlinked one", () => {
    const unlinked = { cat: "internal/docs/loose", files: ["orphan.md"], linked: false, scored: true };
    expect(firstDoc([unlinked, cat("internal/docs/adr", "0001.md")])).toBe("internal/docs/adr/0001.md");
  });

  it("falls back to the first category when nothing is scored", () => {
    expect(firstDoc([other(".", "README.md")])).toBe("./README.md");
  });

  it("returns empty string for an empty tree", () => {
    expect(firstDoc([])).toBe("");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/docs-tree.test.ts`
Expected: FAIL — `firstDoc is not a function` (belum diekspor).

- [ ] **Step 3: Tambahkan `scored` ke tipe dan tulis `firstDoc`**

Di `src/src/screens/DocsWorkspace.tsx`, ganti baris 9:

```ts
type DocCat = { cat: string; files: string[]; linked: boolean; scored: boolean; root?: boolean };
```

Lalu sisipkan tepat setelah `buildTree` (setelah baris 53):

```ts
// Preselect: kategori SoT yang ter-link dulu, lalu kategori SoT mana pun. Jangan
// pernah membuka file yang tidak dinilai kalau ada yang dinilai.
export function firstDoc(cats: DocCat[]): string {
  const pick = cats.find((c) => c.scored && c.linked) ?? cats.find((c) => c.scored) ?? cats[0];
  return pick && pick.files[0] ? `${pick.cat}/${pick.files[0]}` : "";
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./src exec vitest run test/docs-tree.test.ts`
Expected: PASS, 7 test.

- [ ] **Step 5: `DocTreeCat` diam untuk kategori tak berskor**

Ganti baris 58 dan 67-72 di `DocTreeCat`. Baris 58 menjadi:

```ts
  const scored = node.cat?.scored ?? true;
  const linked = node.cat?.linked ?? true;
```

Ikon folder (baris 67) menjadi:

```tsx
        <Icon name="folder" size={15} color={!scored ? "var(--text-subtle)" : linked ? "var(--brass-500)" : "var(--clay-500)"} />
```

Chip link/unlink (baris 70-72) menjadi:

```tsx
        {node.cat && scored && (node.cat.linked
          ? <Icon name="link" size={13} color="var(--leaf-600)" />
          : <Icon name="unlink" size={13} color="var(--clay-500)" />)}
```

Warna nama file (baris 89) menjadi:

```tsx
                  color: on ? "var(--brass-700)" : (!scored || linked ? "var(--text-body)" : "var(--text-muted)"),
```

- [ ] **Step 6: Pisahkan tree jadi dua grup**

Ganti baris 145 (`const nested = ...`) dengan:

```ts
  const nested = React.useMemo(() => buildTree(tree.filter((c) => c.scored)), [tree]);
  const unscored = React.useMemo(() => buildTree(tree.filter((c) => !c.scored)), [tree]);
```

Ganti preselect di effect (baris 125-126) dengan:

```ts
      setSelected(firstDoc(t));
```

dan preselect di `reloadIndex` (baris 169-172) dengan:

```ts
    if (!t.some((n) => n.files.some((f) => `${n.cat}/${f}` === selected))) setSelected(firstDoc(t));
```

Perhatikan: versi lama hanya mencocokkan `files[0]`, sehingga memilih ulang setiap kali file kedua sebuah kategori sedang dibuka. Perbaiki sekalian — `some` di atas memeriksa seluruh file.

Ganti baris 206 (`: nested.map(...)`) dengan:

```tsx
              : (<>
                  {nested.map((n) => <DocTreeCat key={n.path} node={n} selected={selected} onSelect={selectFile} />)}
                  {unscored.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-hair)" }}>
                      <div className="hn-eyebrow" style={{ padding: "4px 6px", color: "var(--text-subtle)" }}>Lainnya (tidak dinilai)</div>
                      {unscored.map((n) => <DocTreeCat key={n.path} node={n} selected={selected} onSelect={selectFile} />)}
                    </div>
                  )}
                </>)}
```

Ganti badge header (baris 222-224) dengan:

```tsx
          {node && node.scored && (node.linked
            ? <Badge tone="ok" size="sm" icon="link">indexed</Badge>
            : <Badge tone="err" size="sm" icon="unlink">unlinked</Badge>)}
```

- [ ] **Step 7: Jalankan seluruh test web + typecheck**

Run: `pnpm --filter ./src test && pnpm -r typecheck`
Expected: PASS. `smoke.test.tsx` dan `app-flows.test.tsx` mungkin memakai fixture `tree` tanpa `scored` — tambahkan `scored: true` pada fixture SoT-nya kalau typecheck mengeluh.

- [ ] **Step 8: Perbarui doc frontend**

Di `internal/docs/frontend/frontend-implementation.md` baris 5, ganti frasa dalam kurung untuk bagian Docs menjadi:

```
Docs (tree realtime semua `.md` di repo via `GET /docs`, dikelompokkan per direktori; kategori di luar `docsDir` masuk grup **Lainnya (tidak dinilai)** tanpa status linked — hanya kategori berskor yang masuk coverage, lihat ADR-0013; tombol **Scan** per project menyegarkan coverage, **Hapus** menghapus file asli, path ditampilkan repo-relative tanpa prefix `internal/docs`)
```

- [ ] **Step 9: Commit**

```bash
git add src/src/screens/DocsWorkspace.tsx src/test/docs-tree.test.ts \
        internal/docs/frontend/frontend-implementation.md
git commit -m "feat(web): kategori di luar docsDir masuk grup tidak dinilai

Grup Lainnya tanpa chip linked/unlinked, dan firstDoc tak pernah
memilih kategori tak berskor. ADR-0013."
```

---

## Task 4: Verifikasi menyeluruh

**Files:** tidak ada perubahan kode. Task ini gerbang, bukan deliverable.

- [ ] **Step 1: Seluruh test workspace**

Run: `pnpm test`
Expected: PASS. Satu-satunya kegagalan yang boleh diabaikan adalah flake `queue-durability` pada timeout 5 detik (tercatat di memory proyek, bukan regresi). Ulangi sekali untuk memastikan.

- [ ] **Step 2: Typecheck**

Run: `pnpm -r typecheck`
Expected: keluar 0, tanpa error.

- [ ] **Step 3: Guardrail atas repo sendiri**

Run: `pnpm --filter ./cli exec tsx src/hanoman.ts docs verify --json`
Expected: `{"ok":true,"coverage":100,"violations":[]}`

- [ ] **Step 4: Centang checklist plan ini**

Ubah setiap `- [ ]` yang sudah selesai menjadi `- [x]` di file ini, lalu commit:

```bash
git add docs/superpowers/plans/2026-07-09-hanoman-sot-coverage-denominator.md
git commit -m "docs: tandai plan SoT coverage denominator selesai"
```
