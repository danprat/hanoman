# SPEC-145 — QA after audit: keputusan sebelum spec · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesudah fase Audit, run QA memutuskan sendiri: temuan kecil → langsung Execute (Spec & Plan ditandai `skipped`); temuan kompleks → Spec → Plan → Execute seperti sekarang.

**Architecture:** Pipeline `qa` berhenti menjadi konstanta. Fase Audit menulis satu artefak JSON satu-bit di root worktree; `runOne` membacanya, memangkas `["Spec","Plan"]`, dan memancarkan state fase baru `skipped`. Artefak dihapus tanpa syarat tepat sebelum `commitAndPush`. Keputusan bertahan melewati resume karena `skipped` tersimpan di kolom `Run.phases` yang sudah ada — tanpa kolom baru, tanpa migration, tanpa dependency baru. Gate `deps.verify` di depan Execute **tidak** ikut dilewati.

**Tech Stack:** TypeScript strict, pnpm workspace, vitest, React + Vite, zod, Prisma + Postgres (Docker), BullMQ + Redis.

**Objective:** [`internal/docs/operations/spec-145-qa-after-audit-objective.md`](../../../internal/docs/operations/spec-145-qa-after-audit-objective.md)
**Design:** [`docs/superpowers/specs/2026-07-09-hanoman-qa-after-audit-spec-145-design.md`](../specs/2026-07-09-hanoman-qa-after-audit-spec-145-design.md)
**Brainstorm:** [`docs/superpowers/specs/2026-07-09-hanoman-qa-after-audit-spec-145-brainstorm.md`](../specs/2026-07-09-hanoman-qa-after-audit-spec-145-brainstorm.md)

---

## Global Constraints

- **Bootstrap worktree dulu — diverifikasi, bukan diasumsikan.** Worktree run yang baru hanya punya `runner/node_modules`. Sebelum apa pun:

  ```bash
  pnpm install
  pnpm --filter ./server exec prisma generate   # WAJIB
  pnpm --filter ./cli build                     # dibutuhkan gate `hanoman docs verify`
  ```

  Tanpa `prisma generate`, `pnpm typecheck` gagal dengan `server/test/worker.test.ts(107,13): error TS7006: Parameter 'r' implicitly has an 'any' type`. **Itu bukan bug kode.** `prisma.run.findMany` kehilangan tipenya saat client belum di-generate. Jangan "memperbaiki" `worker.test.ts`.

- **`runner` TIDAK ada di root vitest workspace.** `vitest.workspace.ts` = `["shared","server","src"]`, jadi `pnpm test` **tidak pernah menjalankan test runner**. Test runner dijalankan terpisah: `pnpm --filter ./runner test`. Task 2 dan 3 seluruhnya hidup di sana — menjalankan `pnpm test` saja akan tampak hijau tanpa pernah mengeksekusi satu pun test barumu.

- **Baseline hijau (diukur 2026-07-09, sebelum task manapun):**
  - `pnpm test` → `56 passed | 1 skipped (57) · 249 tests`
  - `pnpm --filter ./runner test` → `8 passed | 1 skipped (9) · 46 tests`
  - `pnpm typecheck` → Done (sesudah `prisma generate`)
  - `node cli/dist/hanoman.js docs verify --block-if-stale --json` → `{"ok":true,"coverage":100,"violations":[]}`

- **Postgres jalan di Docker.** `psql -d hanoman` di unix socket gagal dan tampak seperti DB mati. Pakai `docker exec hanoman-db-1 psql -U hanoman -d hanoman`. Test server memakai DB `hanoman_test`, bukan `hanoman`.

- **Guardrail freshness.** `IMPL_PREFIXES = ["src/"]`, `DOC_PREFIXES = ["internal/docs/", "internal/skills/", "AGENTS.md", "CLAUDE.md", "README.md"]` (`cli/src/git.ts:2-3`). Hanya paket frontend `src/` yang memicunya — `runner/src/**`, `server/src/**`, `shared/src/**` **tidak** (mereka tak diawali `src/`). Karena itu **hanya Task 5** yang wajib menyertakan perubahan `internal/docs/**` di commit yang sama demi freshness. `docs/superpowers/**` **tidak** dihitung sebagai doc.

- **`coverageThreshold` default `100`** (`shared/src/config.ts:6`, tak ada `hanoman.config.json` di repo ini). Setiap berkas baru di `internal/docs/**` **wajib** ter-link di `internal/docs/README.md` **pada edit yang sama**, kalau tidak coverage turun di bawah 100 dan Stop hook memblokir. Ini mengenai ADR di Task 3.

- **Tanpa dependency runtime baru. Tanpa migration. Tanpa kolom baru.** `Run.phases` sudah `Json`.

- **Jangan sentuh:** gate `deps.verify` (`runner/src/run.ts:65-76`), `deniesDangerous`, `phasesForFlow` (`server/src/queue.ts:16-19` tetap menyemai empat baris `pending`), `mirrorStage`/`PHASE_DONE_STAGE`, alur `feature`/`scaffold`/`reverse`, `PlanSteps` (`RunsScreen.tsx:65-71` — ia menghitung `run.plan`, **bukan** `run.phases`).

- **`git commit` gagal (exit 1) bila tak ada yang ter-stage** — `commitAndPush` tak memakai `--allow-empty`. Karena itu `path: "none"` di luar scope; jangan menambahkannya.

- Perintah: satu berkas → `pnpm --filter ./runner exec vitest run test/phases.test.ts`. Per paket → `pnpm --filter ./server test`. Semua → `pnpm test` **dan** `pnpm --filter ./runner test`. Typecheck → `pnpm typecheck`.

---

## File Structure

| File | Tanggung jawab | Task |
|---|---|---|
| `runner/src/types.ts:31` | `PhaseState` += `"skipped"` | 1 |
| `shared/src/entities.ts:30` | `zPhase` += `"skipped"` (definisi kedua, independen) | 1 |
| `server/src/runner/events-io.ts:20-23` | `computeProgress` mengeluarkan `skipped` dari penyebut | 1 |
| `server/test/events-io.test.ts:6-15` | Tes penyebut | 1 |
| `internal/docs/architecture/data-model.md:23,27` | Kosakata state fase + rumus `progress` | 1 |
| `runner/src/phases.ts` | `DECISION_FILE`, `QA_PLANNING`, `readDecision`, sufiks prompt Audit | 2 |
| `runner/test/phases.test.ts` | Tes `readDecision` + sufiks prompt **(berkas baru)** | 2 |
| `runner/src/run.ts` | Himpunan `pruned`, event `skipped`, `rmSync` pra-commit | 3 |
| `runner/test/run.test.ts` | Tes pemangkasan + unlink | 3 |
| `internal/docs/adr/0019-*.md` | ADR **(berkas baru — wajib ter-link)** | 3 |
| `internal/docs/README.md` | Link ADR baru | 3 |
| `internal/docs/operations/agent-documentation-workflow.md:7` | "QA: audit → spec → plan → execute" jadi salah | 3 |
| `server/src/worker.ts:62` | `donePhases` memuat `skipped` | 4 |
| `server/test/worker.test.ts` | Tes resume jalur cepat | 4 |
| `src/src/screens/RunsScreen.tsx:21-46` | Render `skipped` + konektor | 5 |
| `internal/docs/frontend/frontend-implementation.md` | Catat render `skipped` (**wajib**: freshness) | 5 |

Tidak ada berkas sumber baru. Berkas baru hanya: satu test, satu ADR.

---

## Task 1: `skipped` sebagai state fase kelas satu, dan progress yang jujur

Belum ada yang memancarkan `skipped` sesudah task ini — itu disengaja. Task ini hanya menambah kosakata dan membuat aritmetikanya benar, sehingga Task 3 bisa memancarkannya tanpa membuat dashboard berbohong.

`computeProgress` hari ini `done / total`. Bila Spec dan Plan `skipped`, run jalur cepat yang **berhasil** melapor 50% dan tampak macet.

**Files:**
- Modify: `runner/src/types.ts:31`
- Modify: `shared/src/entities.ts:30`
- Modify: `server/src/runner/events-io.ts:19-23`
- Modify: `server/test/events-io.test.ts:6-15`
- Modify: `internal/docs/architecture/data-model.md:23,27`

**Interfaces:**
- Produces: `PhaseState = "pending" | "active" | "done" | "failed" | "skipped"` (di-export `runner/src/types.ts`, ikut barrel `@hanoman/runner`). `RunEvent` varian `phase` otomatis menerima `"skipped"`.
- Produces: `computeProgress(phases: { state: string }[]): number` — tanda tangan tak berubah; penyebutnya berubah.
- Consumes: tidak ada.

---

- [ ] **Step 1: Tulis tes yang gagal**

Sisipkan ke dalam `describe("computeProgress (SPEC-010, pure)")` di `server/test/events-io.test.ts`, tepat sesudah tes `does not count a failed phase as done` (`:13-14`):

```ts
  // SPEC-145: fase yang dipangkas keputusan audit keluar dari PENYEBUT. Tanpa ini, run
  // jalur cepat yang sukses (Audit + Execute done, Spec + Plan skipped) melapor 50%.
  it("excludes skipped phases from the denominator", () =>
    expect(computeProgress(P(["done", "skipped", "skipped", "done"]))).toBe(100));
  it("does not count a skipped phase as done", () =>
    expect(computeProgress(P(["done", "skipped", "skipped", "active"]))).toBe(50));
  it("is 0 when every phase is skipped", () =>
    expect(computeProgress(P(["skipped", "skipped"]))).toBe(0));
```

- [ ] **Step 2: Jalankan tes, pastikan GAGAL**

```bash
pnpm --filter ./server exec vitest run test/events-io.test.ts -t computeProgress
```

Diharapkan: `excludes skipped phases from the denominator` GAGAL dengan `expected 50 to be 100`.

- [ ] **Step 3: Perbaiki penyebutnya**

Ganti `server/src/runner/events-io.ts:19-23` seluruhnya:

```ts
// Run progress = fraction of phases marked done. Failed/active/pending don't count, so a
// run that dies at the last phase reads e.g. 80%, not 0% or 100%. `skipped` (SPEC-145) is
// different in kind: the run DECIDED not to do it, so it leaves the DENOMINATOR entirely —
// counting it caps a successful qa fast-track run at 50%.
export function computeProgress(phases: { state: string }[]): number {
  const counted = phases.filter((p) => p.state !== "skipped");
  if (!counted.length) return 0;
  return Math.round((counted.filter((p) => p.state === "done").length / counted.length) * 100);
}
```

Guard `!counted.length` menggantikan `!phases.length` — array kosong tetap 0.

- [ ] **Step 4: Jalankan tes, pastikan LULUS**

```bash
pnpm --filter ./server exec vitest run test/events-io.test.ts -t computeProgress
```

Diharapkan: 7 tes lulus.

- [ ] **Step 5: Tambahkan `skipped` ke KEDUA definisi enum**

State fase punya dua definisi independen. Melewatkan salah satu gagal saat **kompilasi**, bukan runtime — `zRun` di-infer jadi tipe dan tak pernah di-`parse`.

`runner/src/types.ts:31`:

```ts
// `skipped`: run memutuskan untuk tidak menjalankan fase ini (SPEC-145) — berbeda dari
// `pending` ("belum jalan"). Ia keluar dari penyebut progress dan tidak diulang saat resume.
export type PhaseState = "pending" | "active" | "done" | "failed" | "skipped";
```

`shared/src/entities.ts:30`:

```ts
const zPhase = z.object({ name: z.string(), state: z.enum(["done","active","failed","pending","skipped"]) });
```

- [ ] **Step 6: Typecheck + seluruh suite**

```bash
pnpm typecheck
pnpm test
pnpm --filter ./runner test
```

Diharapkan: semua Done/hijau. `pnpm test` → `249 + 3 = 252` tes.

- [ ] **Step 7: Perbarui `internal/docs/architecture/data-model.md`**

Baris `:23` — tambahkan kosakata state:

```markdown
- `phases[]` ({ name, state: "pending"|"active"|"done"|"failed"|"skipped" }), `plan[]`, `files[]` (diff), `log[]`
```

Baris `:27` — ganti kalimat rumus `progress`:

```markdown
- `phases[]` di-seed dari pipeline flow saat enqueue (semua `pending`), lalu tiap event membalik state di tempat (`active`/`done`/`failed`/`skipped`); `progress` = persen phase ber-state `done` **di antara phase yang tidak `skipped`** (run yang mati di fase akhir tampil mis. 80%, bukan 0%). `skipped` = fase yang sengaja tidak dijalankan run (alur `qa`, SPEC-145); ia keluar dari penyebut, sehingga run jalur cepat yang sukses tetap 100%. Lihat SPEC-010, SPEC-145.
```

- [ ] **Step 8: Commit**

```bash
git add runner/src/types.ts shared/src/entities.ts server/src/runner/events-io.ts \
        server/test/events-io.test.ts internal/docs/architecture/data-model.md
git commit -m "feat(spec-145): state fase \`skipped\` + progress mengeluarkannya dari penyebut"
```

---

## Task 2: `readDecision` — satu bit, default fail-safe

`runner/src/phases.ts` sudah memiliki pipeline dan prompt; ia juga memiliki keputusan. Tanpa berkas sumber baru.

Perhatikan arah default-nya: `readDecision` tidak pernah bertanya "apakah ini rusak?". Ia bertanya "apakah ini secara eksplisit `execute`?". Setiap masukan lain — berkas absen, JSON rusak, `path` tak dikenal, `path: "none"` di masa depan — jatuh ke jalur penuh **secara konstruksi**, bukan lewat daftar kasus gagal yang harus dijaga tetap lengkap.

**Files:**
- Modify: `runner/src/phases.ts` (import `node:fs`, tambah `DECISION_FILE`, `QA_PLANNING`, `Decision`, `readDecision`; sufiks di `phasePrompt`)
- Create: `runner/test/phases.test.ts`

**Interfaces:**
- Produces: `DECISION_FILE = ".hanoman-decision.json"` (string const)
- Produces: `QA_PLANNING = ["Spec", "Plan"] as const`
- Produces: `type Decision = { path: "execute" | "spec"; reason?: string }`
- Produces: `readDecision(worktree: string): Decision` — **tidak pernah melempar**
- Produces: `phasePrompt(flow, phase, input)` — tanda tangan tak berubah; untuk `flow === "qa" && phase === "Audit"` keluarannya kini memuat `DECISION_FILE`.
- Consumes: `PhaseState` dari Task 1 (tidak langsung; hanya lewat `RunEvent` di Task 3).

---

- [ ] **Step 1: Tulis tes yang gagal**

Berkas baru `runner/test/phases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDecision, phasePrompt, DECISION_FILE, QA_PLANNING } from "../src/phases";
import type { RunInput } from "../src/types";

const wt = (content?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-dec-"));
  if (content !== undefined) writeFileSync(join(dir, DECISION_FILE), content);
  return dir;
};
const input = (): RunInput => ({ runId: "RUN-1", repoDir: "/repo", branchFrom: "main",
  branchTo: "feat/x", flow: "qa", steps: {} as any });

describe("readDecision (SPEC-145, fail-safe)", () => {
  it("takes the fast path only on an explicit execute", () =>
    expect(readDecision(wt('{"path":"execute","reason":"satu predikat"}')))
      .toEqual({ path: "execute", reason: "satu predikat" }));

  it("carries no reason when reason is absent or not a string", () =>
    expect(readDecision(wt('{"path":"execute","reason":42}'))).toEqual({ path: "execute" }));

  it("falls back to the full path when the file is absent", () =>
    expect(readDecision(wt())).toEqual({ path: "spec" }));

  it("falls back to the full path on malformed JSON", () =>
    expect(readDecision(wt("{not json"))).toEqual({ path: "spec" }));

  it("falls back to the full path on an explicit spec", () =>
    expect(readDecision(wt('{"path":"spec"}'))).toEqual({ path: "spec" }));

  // `none` belum ada. Kalau suatu saat ditambahkan, ia TIDAK boleh diam-diam mengeksekusi.
  it("falls back to the full path on an unknown path value", () =>
    expect(readDecision(wt('{"path":"none"}'))).toEqual({ path: "spec" }));

  it("falls back to the full path when the json is not an object", () =>
    expect(readDecision(wt('"execute"'))).toEqual({ path: "spec" }));
});

describe("phasePrompt · instruksi keputusan", () => {
  it("asks the qa Audit phase to write the decision file", () => {
    const p = phasePrompt("qa", "Audit", input());
    expect(p).toContain(DECISION_FILE);
    expect(p).toContain('"path":"execute"|"spec"');
  });

  it("asks no other qa phase for a decision", () => {
    for (const phase of [...QA_PLANNING, "Execute"])
      expect(phasePrompt("qa", phase, input())).not.toContain(DECISION_FILE);
  });

  it("asks no feature phase for a decision", () => {
    for (const phase of ["Brainstorm", "Objective", "Spec", "Plan", "Execute"])
      expect(phasePrompt("feature", phase, { ...input(), flow: "feature" })).not.toContain(DECISION_FILE);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan GAGAL**

```bash
pnpm --filter ./runner exec vitest run test/phases.test.ts
```

Diharapkan: gagal saat collect — `"readDecision" is not exported by "src/phases.ts"`.

- [ ] **Step 3: Implementasi minimal**

`runner/src/phases.ts` — tambahkan import di baris 1 dan blok berikut sesudah `PIPELINES`:

```ts
import { readFileSync } from "node:fs";
import type { Flow, RunInput, StepModels } from "./types";

// Artefak keputusan pasca-Audit (SPEC-145). Ditulis agen di root worktree, dibaca `runOne`,
// dan dihapus TANPA SYARAT sebelum commit — `git add -A` men-stage berkas ber-titik di root,
// jadi artefak yang tertinggal akan mendarat di `branchTo` milik repo project.
export const DECISION_FILE = ".hanoman-decision.json";

// Fase perencanaan alur qa. Dinamai, bukan `PIPELINES.qa.slice(1, -1)`: yang dilewati adalah
// "merencanakan", bukan "apa pun yang kebetulan berada di antara Audit dan Execute".
export const QA_PLANNING = ["Spec", "Plan"] as const;

export type Decision = { path: "execute" | "spec"; reason?: string };

// HANYA `path === "execute"` yang memilih jalur cepat. Berkas hilang, JSON rusak, bukan objek,
// `path` tak dikenal (termasuk "none" di masa depan) → jalur penuh. Fail-safe secara konstruksi.
// Tidak pernah melempar: yang gagal di sini sebuah optimasi, bukan guardrail (bandingkan ADR-0009).
export function readDecision(worktree: string): Decision {
  try {
    const j = JSON.parse(readFileSync(`${worktree}/${DECISION_FILE}`, "utf8")) as Record<string, unknown>;
    if (j?.path !== "execute") return { path: "spec" };
    return typeof j.reason === "string" ? { path: "execute", reason: j.reason } : { path: "execute" };
  } catch { return { path: "spec" }; }
}
```

Lalu ganti `phasePrompt` (`:22-27`):

```ts
// Fase Audit alur qa memilih jalur hilirnya sendiri. Instruksinya dipancarkan tanpa syarat —
// `hanoman qa --only Audit` menuliskan artefaknya, tak punya fase hilir untuk dipangkas, dan
// unlink pra-commit tetap membersihkannya. Satu cabang lebih sedikit.
const DECIDE = `\n\nSebelum menutup fase ini, tulis keputusan jalur ke \`${DECISION_FILE}\` di root worktree: `
  + `{"path":"execute"|"spec","reason":"<satu kalimat>"}. `
  + `Pilih "execute" HANYA bila seluruhnya benar: perbaikannya terlokalisasi (satu–dua berkas), `
  + `tidak menuntut keputusan desain, tidak menyentuh skema database maupun kontrak API, dan kamu `
  + `yakin dapat menyelesaikannya tanpa spec dan plan. Saat ragu, pilih "spec".`;

export function phasePrompt(flow: Flow, phase: string, input: RunInput): string {
  const scope = input.specId
    ? `Kerjakan hanya langkah fase ${phase} untuk backlog item di bawah — jangan kerjakan pekerjaan lain.`
    : `Kerjakan hanya langkah fase ${phase}.`;
  const decide = flow === "qa" && phase === "Audit" ? DECIDE : "";
  return `hanoman ${flow} — fase ${phase}. Ikuti internal/docs sebagai Source of Truth. ${scope} Perbarui docs yang tersentuh dan link di index.${specBlock(input)}${decide}`;
}
```

- [ ] **Step 4: Jalankan tes, pastikan LULUS**

```bash
pnpm --filter ./runner exec vitest run test/phases.test.ts
```

Diharapkan: 10 tes lulus.

- [ ] **Step 5: Typecheck + seluruh runner**

```bash
pnpm typecheck
pnpm --filter ./runner test
```

Diharapkan: Done; `46 + 10 = 56` tes runner.

- [ ] **Step 6: Commit**

```bash
git add runner/src/phases.ts runner/test/phases.test.ts
git commit -m "feat(spec-145): readDecision + instruksi keputusan di prompt fase Audit"
```

---

## Task 3: `runOne` memangkas Spec & Plan, dan membersihkan artefaknya

Di sinilah pipeline `qa` berhenti menjadi konstanta — karena itu ADR-nya mendarat di commit yang sama.

**Bentrokan nama:** `run.ts:26` sudah memakai `skipped` untuk "fase yang sudah selesai di percobaan sebelumnya". Himpunan baru bernama **`pruned`**.

**Files:**
- Modify: `runner/src/run.ts:1-6` (import), `:29` (deklarasi `pruned`), `:61-101` (loop), `:111` (pra-commit)
- Modify: `runner/test/run.test.ts`
- Create: `internal/docs/adr/0019-fase-perencanaan-qa-dipangkas-keputusan-audit.md`
- Modify: `internal/docs/README.md` (link ADR — **wajib di edit yang sama**, `coverageThreshold` 100)
- Modify: `internal/docs/operations/agent-documentation-workflow.md:7`

**Interfaces:**
- Consumes: `readDecision`, `DECISION_FILE`, `QA_PLANNING` (Task 2); `PhaseState` (Task 1).
- Produces: `runOne` memancarkan `{ kind: "phase", name, state: "skipped" }` untuk tiap fase di `QA_PLANNING` ketika `flow === "qa"` dan artefaknya `{"path":"execute"}`.

---

- [ ] **Step 1: Klaim nomor ADR — enumerasi ULANG lebih dulu**

Worktree lain mengklaim nomor ADR secara bersamaan; `0018` sudah bertabrakan sendiri karena ini terlewat. Jalankan **sekarang**, bukan mengandalkan nomor di dokumen design:

```bash
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git ls-tree --name-only "$r" internal/docs/adr/ 2>/dev/null
done | sed 's#.*/##' | grep -oE '^[0-9]{4}' | sort -u | tail -3
git worktree list | while read -r p _; do ls "$p/internal/docs/adr/" 2>/dev/null; done \
  | grep -oE '^[0-9]{4}' | sort -u | tail -3
```

Nomor bebas berikutnya = tertinggi + 1. Design mengasumsikan **0019**; bila enumerasi menunjukkan lain, **pakai hasil enumerasi** dan sesuaikan nama berkas di seluruh task ini.

- [ ] **Step 2: Tulis tes yang gagal**

Tambahkan `describe` baru di akhir `runner/test/run.test.ts`. `withWorktree()` di `:131-135` sudah ada tapi lokal ke `describe` lain — salin helper kecil ini:

```ts
// SPEC-145: alur qa memutuskan jalur hilirnya sendiri sesudah Audit.
describe("runOne · keputusan pasca-Audit (qa)", () => {
  const qaTree = (decision?: string) => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-qa-"));
    const wt = join(repoDir, ".worktrees", "run-1");
    mkdirSync(wt, { recursive: true });
    if (decision !== undefined) writeFileSync(join(wt, DECISION_FILE), decision);
    return { repoDir, wt };
  };
  const phaseStates = (events: any[], state: string) =>
    events.filter((e) => e.kind === "phase" && e.state === state).map((e) => e.name);

  it("skips Spec and Plan when the audit decides to execute", async () => {
    const { repoDir } = qaTree('{"path":"execute","reason":"satu predikat"}');
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input({ repoDir, flow: "qa" }), d, (e) => events.push(e));

    expect(r.status).toBe("done");
    expect(phaseStates(events, "done")).toEqual(["Audit", "Execute"]);
    expect(phaseStates(events, "skipped")).toEqual(["Spec", "Plan"]);
    expect(events.some((e) => e.kind === "log" && e.line.s.includes("satu predikat"))).toBe(true);
  });

  it("runs every qa phase when no decision artifact was written", async () => {
    const { repoDir } = qaTree();
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input({ repoDir, flow: "qa" }), d, (e) => events.push(e));

    expect(r.status).toBe("done");
    expect(phaseStates(events, "done")).toEqual(["Audit", "Spec", "Plan", "Execute"]);
    expect(phaseStates(events, "skipped")).toEqual([]);
  });

  // Melewati GILIRAN, bukan melewati GERBANG. Execute tetap lewat docs-verify.
  it("still gates Execute and still opens exactly one session on the fast path", async () => {
    const { repoDir } = qaTree('{"path":"execute"}');
    const verify = vi.fn(() => ({ blocked: false }));
    const openSession = vi.fn((_o: CliOptions) => fakeSession());
    await runOne(input({ repoDir, flow: "qa" }), fakeDeps({ verify, openSession }), () => {});

    expect(verify).toHaveBeenCalledTimes(1);
    expect(openSession).toHaveBeenCalledTimes(1);
  });

  // `git add -A` men-stage berkas ber-titik di root: artefak yang tertinggal akan ter-commit
  // ke branchTo milik repo project. Unlink WAJIB sudah terjadi saat commitAndPush dipanggil.
  it("removes the decision artifact before commitAndPush", async () => {
    const { repoDir, wt } = qaTree('{"path":"execute"}');
    let presentAtCommit: boolean | undefined;
    const d = fakeDeps();
    d.git.commitAndPush = vi.fn(() => { presentAtCommit = existsSync(join(wt, DECISION_FILE)); });
    await runOne(input({ repoDir, flow: "qa" }), d, () => {});

    expect(presentAtCommit).toBe(false);
    expect(existsSync(join(wt, DECISION_FILE))).toBe(false);
  });

  // Artefak yatim dari percobaan yang mati SESUDAH `phase done` ter-persist tapi SEBELUM
  // pembacaan: Audit tak dijalankan lagi, jadi tak ada yang membacanya. Unlink tetap wajib.
  it("removes an orphaned artifact even when the full path runs", async () => {
    const { repoDir, wt } = qaTree('{"path":"spec"}');
    await runOne(input({ repoDir, flow: "qa" }), fakeDeps(), () => {});
    expect(existsSync(join(wt, DECISION_FILE))).toBe(false);
  });
});
```

Perbarui import di kepala `runner/test/run.test.ts:2-4`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DECISION_FILE } from "../src/phases";
```

- [ ] **Step 3: Jalankan tes, pastikan GAGAL**

```bash
pnpm --filter ./runner exec vitest run test/run.test.ts -t "keputusan pasca-Audit"
```

Diharapkan: `skips Spec and Plan…` GAGAL — `done` berisi `["Audit","Spec","Plan","Execute"]`, `skipped` kosong.

- [ ] **Step 4: Implementasi**

`runner/src/run.ts:1-6` — import:

```ts
import { existsSync, rmSync } from "node:fs";
import type { OpenSession, RunEvent, RunInput, RunResult, GitOps, CliMessage } from "./types";
import { PIPELINES, phasePrompt, stepFor, readDecision, DECISION_FILE, QA_PLANNING } from "./phases";
```

Sesudah `const stopped = ...` / `const failed = ...` (`:31-32`), deklarasikan himpunannya:

```ts
  // Fase yang dipangkas keputusan audit (SPEC-145). Namanya BUKAN `skipped`: `:26` sudah
  // memakai nama itu untuk fase yang selesai di percobaan sebelumnya (resume).
  const pruned = new Set<string>();
```

Di kepala loop (`:61-63`), sebelum cek abort:

```ts
      for (const phase of phases) {
        if (pruned.has(phase)) { onEvent({ kind: "phase", name: phase, state: "skipped" }); continue; }
        if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return stopped(); }
        onEvent({ kind: "phase", name: phase, state: "active" });
```

Sesudah `onEvent({ kind: "phase", name: phase, state: "done" })` (`:92`), sebelum drain steer:

```ts
        // Alur qa memilih jalur hilirnya sendiri. Hanya `path: "execute"` yang memangkas;
        // apa pun selainnya (berkas absen, rusak, "spec") membiarkan pipeline utuh.
        if (input.flow === "qa" && phase === "Audit") {
          const d = readDecision(worktree);
          if (d.path === "execute") {
            for (const p of QA_PLANNING) pruned.add(p);
            const why = d.reason ? ` · ${d.reason}` : "";
            onEvent({ kind: "log", line: { t: "›", s: `audit: perbaikan kecil — Spec & Plan dilewati${why}` } });
          }
        }
```

Terakhir, tepat sebelum `deps.git.commitAndPush(...)` (`:111`):

```ts
  // `git add -A` men-stage berkas ber-titik di root. Unlink berdiri sendiri di sini, tanpa
  // syarat, karena ada jalur yang tak pernah membaca artefaknya: run yang mati antara fase
  // Audit menulis berkas dan runner membacanya sudah mem-persist `phase done`, sehingga
  // resume melewati Audit sama sekali. `force`: absen bukan error.
  rmSync(`${worktree}/${DECISION_FILE}`, { force: true });
  deps.git.commitAndPush(worktree, `hanoman ${input.flow} ${input.specId ?? ""}`.trim(), input.branchTo, input.remoteUrl);
```

- [ ] **Step 5: Jalankan tes, pastikan LULUS**

```bash
pnpm --filter ./runner exec vitest run test/run.test.ts
pnpm --filter ./runner test
```

Diharapkan: seluruh `run.test.ts` hijau (tes lama + 5 baru); runner total `61` tes.

- [ ] **Step 6: Tulis ADR (nomor dari Step 1)**

Buat `internal/docs/adr/0019-fase-perencanaan-qa-dipangkas-keputusan-audit.md`:

```markdown
# ADR-0019 — Fase perencanaan alur QA dipangkas oleh keputusan audit

**Status:** diterima · 2026-07-09 · SPEC-145

## Konteks

`PIPELINES.qa = ["Audit", "Spec", "Plan", "Execute"]` adalah konstanta. Setiap run QA membayar
Spec dan Plan, termasuk untuk temuan yang perbaikannya satu baris. SPEC-142 adalah contohnya:
audit-nya menutup dengan "satu diff kecil", lalu tetap menjalankan dua fase perencanaan penuh.

Semua tuas pemangkas fase yang ada dievaluasi **sebelum** run mulai — `input.only` di payload
job, `phasesForFlow` saat `enqueueRun`. Pada detik keduanya dibaca, Audit belum berjalan.

## Keputusan

Sesudah fase Audit, `runOne` membaca artefak `.hanoman-decision.json` yang ditulis agen di root
worktree. `{"path":"execute"}` memangkas `["Spec","Plan"]`, yang dipancarkan sebagai state fase
baru **`skipped`**. Apa pun selainnya menjalankan pipeline penuh.

Keputusan itu **satu bit**, bukan skor kepercayaan: `path: "execute"` dengan confidence rendah
hanya bisa berarti "jangan execute". Confidence hidup di instruksi prompt; buktinya `reason`
yang tercatat di log run.

## Konsekuensi

- Pipeline flow tidak lagi sepenuhnya diketahui saat enqueue. `phasesForFlow` tetap menyemai
  empat baris `pending`; dua di antaranya dapat berakhir `skipped`.
- `skipped` keluar dari penyebut `progress` — bukan dihitung sebagai belum selesai.
- Keputusan bertahan melewati resume tanpa kolom baru: `donePhases` dibaca dari `Run.phases`,
  dan `skipped` ikut terhitung sebagai "jangan jalankan lagi" (ADR-0017).
- **Gerbang tidak ikut dilewati.** `deps.verify` tetap menjaga Execute (ADR-0001). Yang dilewati
  dua giliran claude, bukan Source of Truth. Jalur cepat sah karena dokumen audit menjadi
  doc-of-record bagi perbaikan kecil.
- Artefak dihapus tanpa syarat sebelum `commitAndPush`: `git add -A` men-stage berkas ber-titik
  di root, dan run yang mati sebelum pembacaan tak pernah membersihkannya sendiri.
- Kegagalan membaca artefak **tidak** menggagalkan run (menyimpang dari ADR-0009 dengan sengaja):
  yang gagal sebuah optimasi, bukan guardrail. Degradasinya adalah perilaku hari ini.

## Alternatif yang ditolak

- **Sentinel di teks jawaban Audit.** Fase Audit membaca kode dan log; baris berisi sentinel di
  dalam berkas yang ia kutip dapat ikut tercetak. Keputusan melewati perencanaan tak boleh punya
  jalur injeksi.
- **Gerbang manusia sesudah Audit.** Menolak objective: brief meminta perbaikan berjalan langsung.
- **Menandai fase yang dilewati `done`.** `PHASE_DONE_STAGE` memetakan `Plan → planned`; backlog
  item akan mengaku punya plan yang tak pernah ditulis.
```

- [ ] **Step 7: Link ADR di index — pada edit yang sama**

`internal/docs/README.md`, tambahkan sebagai baris pertama di bawah `## adr`:

```markdown
- [0019 — Fase perencanaan QA dipangkas oleh keputusan audit](adr/0019-fase-perencanaan-qa-dipangkas-keputusan-audit.md)
```

- [ ] **Step 8: Perbaiki alur QA yang kini salah di workflow doc**

`internal/docs/operations/agent-documentation-workflow.md:7` berbunyi `**QA:** audit → spec → plan → execute.` Ganti:

```markdown
- **Fitur:** spec → plan → execute. **QA:** audit → **keputusan** → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped` (SPEC-145, ADR-0019).
```

- [ ] **Step 9: Guardrail + suite**

```bash
node cli/dist/hanoman.js docs verify --block-if-stale --json
pnpm typecheck && pnpm test && pnpm --filter ./runner test
```

Diharapkan: `{"ok":true,"coverage":100,"violations":[]}` exit 0. Coverage **wajib** tetap 100 — kalau turun, ADR belum ter-link (Step 7).

- [ ] **Step 10: Commit**

```bash
git add runner/src/run.ts runner/test/run.test.ts \
        internal/docs/adr/0019-fase-perencanaan-qa-dipangkas-keputusan-audit.md \
        internal/docs/README.md internal/docs/operations/agent-documentation-workflow.md
git commit -m "feat(spec-145): runOne memangkas Spec+Plan atas keputusan audit + ADR-0019"
```

---

## Task 4: Keputusan bertahan melewati resume

`server/src/worker.ts:62` menyusun daftar "jangan jalankan lagi" dari satu state. Run jalur cepat yang terputus di Execute akan, saat di-resume, **menjalankan ulang Spec dan Plan** yang sudah ditandai `skipped` — mengabaikan keputusannya sendiri.

**Files:**
- Modify: `server/src/worker.ts:60-64`
- Modify: `server/test/worker.test.ts`

**Interfaces:**
- Consumes: state `skipped` di `Run.phases` (Task 1 + Task 3).
- Produces: tidak ada simbol baru. `RunInput.donePhases` kini berarti "fase yang tak boleh dijalankan lagi" — selesai **atau** dipangkas.

---

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan ke `describe("worker processor")` di `server/test/worker.test.ts`, sesudah tes `continues an interrupted run…` (`:81`):

```ts
  // SPEC-145: run qa jalur cepat yang terputus di Execute tidak boleh menjalankan ulang
  // Spec & Plan yang sudah dipangkas keputusan audit. `donePhases` = selesai ATAU skipped.
  it("resumes a fast-tracked qa run without re-running the pruned phases", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "hanoman-w-"));
    mkdirSync(join(repoDir, ".worktrees", "run-5"), { recursive: true });
    await makeRun({ id: "RUN-5", projectId: "p1", kind: "qa", status: "queued", sessionId: "sess-qa",
      phases: [
        { name: "Audit", state: "done" }, { name: "Spec", state: "skipped" },
        { name: "Plan", state: "skipped" }, { name: "Execute", state: "active" },
      ] as any });

    const sent: string[] = [];
    const deps: RunDeps = { ...fakeDeps, openSession: () => fakeSession(sent) };
    const steps = await (await import("../src/services/settings")).stepModels();
    await runProcessor({ data: { runId: "RUN-5", repoDir, branchFrom: "main", branchTo: "feat/x", flow: "qa", steps } } as any, deps);

    const prompts = sent.filter((s) => !s.startsWith("/"));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("fase Execute");
    expect((await prisma.run.findUnique({ where: { id: "RUN-5" } }))?.status).toBe("done");
  });
```

- [ ] **Step 2: Jalankan tes, pastikan GAGAL**

```bash
pnpm --filter ./server exec vitest run test/worker.test.ts -t "fast-tracked"
```

Diharapkan: GAGAL — `expected length 3 to be 1` (Spec, Plan, Execute dijalankan ulang).

- [ ] **Step 3: Implementasi**

`server/src/worker.ts:60-64` — ganti baris `const done = ...`:

```ts
  const row = await prisma.run.findUnique({ where: { id }, select: { sessionId: true, phases: true } });
  if (row?.sessionId) {
    // "Jangan jalankan lagi" = selesai ATAU dipangkas keputusan audit (SPEC-145). Melewatkan
    // `skipped` di sini membuat run qa jalur cepat yang di-resume mengingkari keputusannya
    // sendiri dan menjalankan Spec + Plan yang sudah ditandai dilewati.
    const done = (row.phases as { name: string; state: string }[])
      .filter((p) => p.state === "done" || p.state === "skipped").map((p) => p.name);
    input = { ...input, resume: row.sessionId, donePhases: done };
  }
```

- [ ] **Step 4: Jalankan tes, pastikan LULUS**

```bash
pnpm --filter ./server exec vitest run test/worker.test.ts
```

Diharapkan: seluruh `worker.test.ts` hijau.

- [ ] **Step 5: Suite penuh**

```bash
pnpm typecheck && pnpm test && pnpm --filter ./runner test
```

Catatan: bila `queue-durability` gagal saat dijalankan sendirian tapi lulus di suite server penuh, itu **order-dependent yang sudah dikenal** — bukan regresi dari task ini.

- [ ] **Step 6: Commit**

```bash
git add server/src/worker.ts server/test/worker.test.ts
git commit -m "fix(spec-145): resume tidak menjalankan ulang fase yang dipangkas audit"
```

---

## Task 5: `PhasePipeline` membedakan "dilewati" dari "belum jalan"

Hari ini apa pun di luar `done`/`active`/`failed` jatuh ke gaya `pending` (`RunsScreen.tsx:25-27,33-34,41`), sehingga fase yang **dilewati** terlihat identik dengan fase yang **belum jalan**.

Ini satu-satunya task yang menyentuh paket `src/`, jadi **satu-satunya yang memicu guardrail freshness** — commit-nya wajib memuat perubahan `internal/docs/**`.

**Files:**
- Modify: `src/src/screens/RunsScreen.tsx:21-46`
- Modify: `internal/docs/frontend/frontend-implementation.md` (§ Live run view)

**Interfaces:**
- Consumes: `run.phases[].state === "skipped"` dari API (Task 1 + 3). `Phase` lokal (`:16`) bertipe `state: string` → tidak ada perubahan tipe.
- Produces: tidak ada.

Tanpa unit test baru: perubahannya murni pemetaan state → gaya, tanpa cabang logika. Verifikasinya `pnpm --filter ./src test` (suite yang ada tetap hijau), `pnpm typecheck`, dan pemeriksaan nyata di Task 6.

---

- [ ] **Step 1: Render `skipped`**

Ganti badan `PhasePipeline` (`src/src/screens/RunsScreen.tsx:21-53`) — tiga baris yang berubah ditandai:

```tsx
function PhasePipeline({ phases }: { phases: Phase[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
      {phases.map((p, i) => {
        // `skipped` (SPEC-145): fase yang run putuskan untuk tidak dijalankan. Ia HARUS
        // terbaca berbeda dari `pending` ("belum jalan") — bukan lingkaran kosong.
        const skipped = p.state === "skipped";
        const c = p.state === "done" ? "var(--leaf-500)" : p.state === "active" ? "var(--brass-500)"
          : p.state === "failed" ? "var(--clay-500)" : "var(--bone-400)";
        const icon = p.state === "done" ? "check" : p.state === "failed" ? "x" : skipped ? "minus" : null;
        return (
          <React.Fragment key={p.name}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%",
                background: p.state === "pending" ? "transparent" : c,
                border: p.state === "pending" ? "1.5px solid var(--bone-400)" : "none",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                animation: p.state === "active" ? "hn-pulse 1.4s ease-in-out infinite" : "none",
              }}>
                {icon && <Icon name={icon} size={13} stroke={3} color="#fff" />}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5,
                color: p.state === "pending" || skipped ? "var(--text-subtle)" : "var(--text-body)",
                fontWeight: p.state === "active" ? 600 : 400 }}>{p.name}</span>
            </div>
            {i < phases.length - 1 && (
              // Alur memang melewati fase yang `skipped`; hanya saja tak ada pekerjaan di sana.
              <span style={{ flex: 1, minWidth: 18, height: 2, marginTop: -18,
                background: phases[i]!.state === "done" || phases[i]!.state === "skipped"
                  ? "var(--leaf-500)" : "var(--bone-300)" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
```

`Icon` mem-proxy `lucide-react` (`src/src/ds/icon.tsx:8`), jadi `minus` sah tanpa registrasi apa pun.

- [ ] **Step 2: Typecheck + suite frontend**

```bash
pnpm --filter ./src typecheck
pnpm --filter ./src test
```

Diharapkan: Done; suite hijau, tak ada tes yang berubah.

- [ ] **Step 3: Perbarui doc frontend — WAJIB di commit yang sama**

`internal/docs/frontend/frontend-implementation.md`, tambahkan paragraf di akhir § **Live run view (SPEC-008)**:

```markdown
`PhasePipeline` mengenal lima state fase. `skipped` (SPEC-145) adalah fase yang run **putuskan**
untuk tidak dijalankan — alur `qa` yang audit-nya memilih perbaikan langsung menandai Spec dan
Plan begitu. Ia dirender terisi `--bone-400` dengan ikon `minus` dan label redup, sengaja berbeda
dari `pending` (lingkaran kosong, "belum jalan"), dan konektor sesudahnya berwarna `--leaf-500`
karena alur memang lewat sana. `progress` mengeluarkan fase `skipped` dari penyebutnya, sehingga
run jalur cepat yang sukses tetap 100%.
```

- [ ] **Step 4: Guardrail — buktikan freshness terpenuhi**

```bash
node cli/dist/hanoman.js docs verify --block-if-stale --json
```

Diharapkan: `{"ok":true,"coverage":100,"violations":[]}` exit 0.
Bila muncul `Ada perubahan di src/ tanpa perubahan dokumentasi`, Step 3 terlewat.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/RunsScreen.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(spec-145): PhasePipeline membedakan fase skipped dari pending"
```

---

## Task 6: Verifikasi nyata (bukan hanya unit test)

`CLAUDE.md` menuntut endpoint yang tersentuh diuji nyata di local. Yang berubah bentuknya adalah `Run.phases[].state` dan `progress` yang diserve `GET /api/runs`.

**Files:** tidak ada perubahan berkas. Task ini murni verifikasi.

**Interfaces:**
- Consumes: seluruh Task 1–5.

---

- [ ] **Step 1: Bukti round-trip DB → API untuk `skipped`**

Ini yang paling berharga dan paling aman: membuktikan `skipped` bertahan lewat Prisma dan `computeProgress` **tanpa** menyalakan proses `claude`. Tambahkan ke `server/test/events-io.test.ts` di dalam `describe("persistEvent finishedAt (SPEC-008)")`:

```ts
  // SPEC-145: `skipped` bertahan di kolom Json dan progress-nya jujur (2 done, 2 skipped → 100%).
  it("persists a skipped phase and reports 100% when the rest are done", async () => {
    await prisma.run.update({ where: { id: "RUN-1" }, data: { phases: [
      { name: "Audit", state: "done" }, { name: "Spec", state: "pending" },
      { name: "Plan", state: "pending" }, { name: "Execute", state: "done" },
    ] as any } });
    await persistEvent("RUN-1", { kind: "phase", name: "Spec", state: "skipped" });
    await persistEvent("RUN-1", { kind: "phase", name: "Plan", state: "skipped" });

    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect((run.phases as any[]).map((p) => p.state)).toEqual(["done", "skipped", "skipped", "done"]);
    expect(run.progress).toBe(100);
  });
```

```bash
pnpm --filter ./server exec vitest run test/events-io.test.ts
```

Diharapkan: hijau. Ini juga membuktikan `mirrorSpecStage` **tidak** menaikkan stage pada event `skipped` (bukan `phase done`).

- [ ] **Step 2: Boot API dan curl endpoint yang tersentuh**

```bash
docker compose up -d --wait
pnpm --filter ./server build && node server/dist/server.js &
sleep 3
curl -s localhost:8787/api/runs | head -c 400
```

Diharapkan: `200`, JSON array (boleh kosong). Yang dibuktikan: perubahan `zPhase` tidak memecah serialisasi `GET /api/runs`.

Hentikan server sesudahnya (`kill %1`).

- [ ] **Step 3: Verifikasi visual `skipped` di dashboard**

```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c \
  "UPDATE \"Run\" SET phases = '[{\"name\":\"Audit\",\"state\":\"done\"},{\"name\":\"Spec\",\"state\":\"skipped\"},{\"name\":\"Plan\",\"state\":\"skipped\"},{\"name\":\"Execute\",\"state\":\"done\"}]'::jsonb, progress = 100, kind = 'qa' WHERE id = (SELECT id FROM \"Run\" LIMIT 1) RETURNING id;"
```

Buka `pnpm dev:web` → layar **Runs** → baris itu. Diharapkan: Audit dan Execute hijau bercentang; Spec dan Plan **terisi abu dengan ikon minus** dan label redup; konektor hijau menembusnya; progress `100%`.

**Kembalikan barisnya sesudah memeriksa** — DB `hanoman` dipakai bersama seluruh worktree:

```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c \
  "UPDATE \"Run\" SET phases = '[]'::jsonb, progress = 0 WHERE id = '<id yang dikembalikan di atas>';"
```

Kalau tak ada baris `Run` sama sekali, lewati step ini dan andalkan Step 1 — **jangan** membuat run baru lewat `POST /runs`: worker dev yang hidup akan mengeksekusi run `claude` nyata.

- [ ] **Step 4: Jalankan run QA nyata (opsional, berbiaya)**

Satu-satunya bukti end-to-end bahwa agen benar-benar menulis artefaknya. **Biayanya token dan ia men-spawn proses `claude` sungguhan.** Jalankan terhadap project scratch, bukan repo ini:

```bash
node cli/dist/hanoman.js qa --project <scratch> --repo-dir <abs> --only Audit
```

Diharapkan: `.hanoman-decision.json` ditulis di `.worktrees/<run-id>/`, lalu **hilang** sebelum commit. Bila agen tak menulisnya, run tetap lulus lewat jalur penuh — itulah default fail-safe-nya, bukan kegagalan.

- [ ] **Step 5: Gerbang terakhir**

```bash
pnpm typecheck
pnpm test
pnpm --filter ./runner test
node cli/dist/hanoman.js docs verify --block-if-stale --json
```

Diharapkan: semuanya hijau, `{"ok":true,"coverage":100,"violations":[]}` exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/test/events-io.test.ts
git commit -m "test(spec-145): skipped bertahan lewat Prisma dan progress tetap jujur"
```

---

## Self-review

**Cakupan objective → task.** Tuas di `runOne` → T3. Artefak bukan teks → T2 + T3. Default fail-safe → T2 (7 tes). `skipped` bukan `done` → T1 + T3. `skipped` di kedua enum → T1 Step 5. Penyebut `computeProgress` → T1. Bertahan melewati resume → T4. `PhasePipeline` mengenali `skipped` → T5. Stage boleh melompat → T6 Step 1 (event `skipped` bukan `phase done`). Test menyusul logika → T1–T4, T6. Docs + ADR → T1 Step 7, T3 Step 6–8, T5 Step 3.

**Amandemen fase Spec** (unlink tanpa syarat sebelum `commitAndPush`, bukan di sebelah baca) → T3 Step 4, diuji dua kali di T3 Step 2 (`removes the decision artifact before commitAndPush`, `removes an orphaned artifact even when the full path runs`).

**Konsistensi nama.** `DECISION_FILE`, `QA_PLANNING`, `readDecision`, `Decision`, `pruned` dipakai identik di T2, T3, dan test-nya. `pruned` — bukan `skipped` — karena `run.ts:26` sudah memakai nama itu.

**Batas scope yang dijaga.** Tanpa `path: "none"`. Tanpa kill switch `qaFastTrack`. Tanpa keputusan per-temuan. `PlanSteps`, `phasesForFlow`, `mirrorStage`, gate `verify` tak tersentuh.

---

## Eksekusi

Plan ini **belum dieksekusi** — fase Plan hanya menulisnya. Fase Execute berikutnya menjalankan Task 1–6 berurutan, mencentang tiap `- [ ]` seiring selesainya, dan mengulang enumerasi nomor ADR (Task 3 Step 1) sebelum menulis berkas ADR.
