# SPEC-244 Kontinuitas Branch (take-to-backlog) + Skip-Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Take-to-backlog (PRD→brief, audit→Finding QA) meneruskan branch sumbernya; picker backlog melisten branch origin/remote; qa yang dinaikkan dari audit melewati fase Audit.

**Architecture:** `Spec.branchFrom` (ADR-0032) sudah membawa kontinuitas; tambal prefill + jadikan remote first-class untuk `branchFrom` (dropdown, whitelist server, resolusi SHA runner) + klausa prompt skip-audit dielicit via payload `fromAudit` (ADR-0040/0059).

**Tech Stack:** TypeScript strict, React+Vite (frontend), Fastify (server), git spawn (runner), zod (@hanoman/shared), vitest.

## Global Constraints

- TypeScript strict; test orkestrasi wajib. Jalankan test: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism <file>`.
- Keamanan argumen git ADR-0032: `git rev-parse --verify --end-of-options <rev>^{commit}` — urutan flag mengikat; prefix `origin/` harus konstan, bukan input.
- "Satu daftar memasok dropdown DAN gerbang validasi" (ADR-0032) — jangan buat validator terpisah.
- Perbarui docs tersentuh + link index dalam commit yang sama (sudah: ADR-0059 + audit doc di README).
- Regresi nol: branchFrom kosong → default `main`; qa non-lanjutan → flow qa penuh.

---

### Task 1: Runner — `resolveCommit` fallback ke `origin/<rev>`

**Files:**
- Modify: `runner/src/git.ts:18-19`
- Test: `runner/test/git.test.ts`

**Interfaces:**
- Produces: `resolveCommit` (internal) kini resolve branch remote-only; `addWorktree(repo, path, branchFrom)` menerima nama branch yang hanya ada di `refs/remotes/origin/*`.

- [x] **Step 1: Tulis test yang gagal** — tambahkan di `runner/test/git.test.ts` dalam `describe("git worktree ops")`:

```ts
  // SPEC-244 · branch PRD/audit di-push dari worktree detached → hanya refs/remotes/origin/<b>
  // tersisa di mesin. resolveCommit harus fallback ke origin/<rev>.
  it("resolves a branchFrom that exists only on origin", () => {
    const { repo } = seedRepo();
    writeFileSync(join(repo, "f.txt"), "1"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "c");
    const sha = g(repo, "rev-parse", "HEAD").stdout.trim();
    g(repo, "branch", "prd/x"); g(repo, "push", "-q", "origin", "prd/x");
    g(repo, "branch", "-D", "prd/x");                 // lokal hilang; origin/prd/x tetap
    const wt = join(repo, ".worktrees", "spec-origin");
    expect(realGit.addWorktree(repo, wt, "prd/x")).toBe(sha);
    realGit.removeWorktree(repo, wt);
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner/test/git.test.ts -t "only on origin"`
Expected: FAIL — `git rev-parse ... prd/x^{commit}` exit 128 (rev tak ada lokal), `addWorktree` throw.

- [x] **Step 3: Implementasi minimal** — ganti `resolveCommit` di `runner/src/git.ts:18-19`:

```ts
const resolveCommit = (repo: string, rev: string) => {
  const tryRev = (r: string) => {
    const res = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", `${r}^{commit}`], { cwd: repo, encoding: "utf8" });
    return res.status === 0 ? res.stdout.trim() : null;
  };
  // Lokal dulu (DWIM refs/heads), lalu origin/<rev> untuk branch remote-only (worktree PRD/audit
  // di-push detached, ADR-0059). Cermin resolveSource di services/integrate.ts. Prefix `origin/`
  // konstan → tak bisa terbaca sebagai flag; keamanan argumen ADR-0032 utuh. Gagal keras menyebut
  // rev asli (ADR-0009) bila keduanya tak resolve.
  return tryRev(rev) ?? tryRev(`origin/${rev}`) ??
    git(repo, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).trim();
};
```

- [x] **Step 4: Jalankan seluruh test git**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner/test/git.test.ts`
Expected: PASS semua — termasuk `looks like a flag` (lokal `--force` menang) & `names the missing branch` (rev asli disebut).

- [x] **Step 5: Commit**

```bash
git add runner/src/git.ts runner/test/git.test.ts
git commit -m "feat(spec-244): resolveCommit fallback ke origin/<rev> untuk branch remote-only"
```

---

### Task 2: Shared — `zQaPayload.fromAudit` opsional

**Files:**
- Modify: `shared/src/entities.ts:18-20`
- Test: `shared/test/entities.test.ts`

**Interfaces:**
- Produces: `zQaPayload` menerima `fromAudit?: string` (opsional); brief tetap strip key tak dikenal.

- [x] **Step 1: Tulis test yang gagal** — tambahkan di `shared/test/entities.test.ts`:

```ts
  it("zQaPayload menerima fromAudit opsional (SPEC-244)", () => {
    const r = zQaPayload.parse({ severity: "major", steps: "", expected: "", actual: "", env: "", fromAudit: "SPEC-237" });
    expect(r.fromAudit).toBe("SPEC-237");
    const r2 = zQaPayload.parse({ severity: "major", steps: "", expected: "", actual: "", env: "" });
    expect(r2.fromAudit).toBeUndefined();
  });
```

Pastikan `zQaPayload` ter-import di file test (tambah ke import dari `../src/entities` bila belum).

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism shared/test/entities.test.ts -t "fromAudit"`
Expected: FAIL — `r.fromAudit` undefined (key di-strip oleh objek zod default).

- [x] **Step 3: Implementasi** — `shared/src/entities.ts:18-20`:

```ts
export const zQaPayload = z.object({
  severity: z.enum(["critical","major","minor"]), steps: z.string(),
  expected: z.string(), actual: z.string(), env: z.string(),
  fromAudit: z.string().optional() });   // SPEC-244 · qa dinaikkan dari audit → sinyal skip fase Audit (ADR-0059)
```

- [x] **Step 4: Jalankan test**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism shared/test/entities.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/entities.ts shared/test/entities.test.ts
git commit -m "feat(spec-244): zQaPayload.fromAudit opsional (sinyal skip-audit)"
```

---

### Task 3: Server — `branchFromCandidates` (lokal ∪ origin) untuk whitelist branchFrom

**Files:**
- Modify: `server/src/services/branches.ts` (tambah fungsi), `server/src/routes/specs.ts:11,26-27` (import + gerbang)
- Test: `server/test/branches.test.ts`

**Interfaces:**
- Consumes: `listRepoBranches`, `listRepoRemoteBranches` (ada).
- Produces: `branchFromCandidates(repoDir: string | null): Promise<string[]>` = lokal ∪ remote, dedup, sorted. `POST/PATCH /specs` menerima `branchFrom` remote-only.

- [x] **Step 1: Tulis test yang gagal** — tambahkan di `server/test/branches.test.ts`:

```ts
import { listRepoBranches, listRepoRemoteBranches, branchFromCandidates } from "../src/services/branches";
// ...
describe("branchFromCandidates", () => {
  it("menggabung branch lokal dan origin (dedup, sorted) — SPEC-244", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");   // lokal: main, hanoman/spec-1 · origin: main, hanoman/spec-1
    expect(await branchFromCandidates(repoDir)).toEqual(["hanoman/spec-1", "main"]);
  });
  it("menyertakan branch yang HANYA ada di origin", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-9", { localBranches: [] });
    // hapus branch lokal hanoman/spec-9 → tersisa hanya origin/hanoman/spec-9
    spawnSync("git", ["branch", "-D", "hanoman/spec-9"], { cwd: repoDir, encoding: "utf8" });
    const c = await branchFromCandidates(repoDir);
    expect(c).toContain("hanoman/spec-9");
    expect(await listRepoBranches(repoDir)).not.toContain("hanoman/spec-9"); // bukti: remote-only
  });
  it("repoDir null → []", async () => { expect(await branchFromCandidates(null)).toEqual([]); });
});
```

Tambah `import { spawnSync } from "node:child_process";` di test bila belum ada.

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism server/test/branches.test.ts -t "branchFromCandidates"`
Expected: FAIL — `branchFromCandidates` belum di-export.

- [x] **Step 3: Implementasi** — tambahkan di akhir `server/src/services/branches.ts`:

```ts
// SPEC-244 · ADR-0059 — kandidat branchFrom = lokal ∪ origin (dedup). Branch PRD (`prd/<slug>`) dan
// audit (`hanoman/<id>`) di-push dari worktree detached → hanya ada di refs/remotes/origin/*. Satu
// daftar memasok dropdown DAN gerbang validasi branchFrom (prinsip ADR-0032), kini melebar ke remote.
export async function branchFromCandidates(repoDir: string | null): Promise<string[]> {
  const [local, remote] = await Promise.all([listRepoBranches(repoDir), listRepoRemoteBranches(repoDir)]);
  return [...new Set([...local, ...remote])].sort();
}
```

Lalu `server/src/routes/specs.ts` — ganti import baris 11 dan gerbang baris 26-27:

```ts
import { listRepoBranches, branchFromCandidates } from "../services/branches";
```
```ts
const branchUnknown = async (repoDir: string | null, branch: string) =>
  !(await branchFromCandidates(repoDir)).includes(branch);   // SPEC-244 · terima branch origin-only
```

(Biarkan `listRepoBranches` tetap ter-import bila masih dipakai di tempat lain di file; bila tidak, hapus dari import agar tak ada unused — cek dengan `grep -n listRepoBranches server/src/routes/specs.ts`.)

- [x] **Step 4: Jalankan test branches + specs.route**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism server/test/branches.test.ts server/test/specs.route.test.ts`
Expected: PASS semua (termasuk regresi `stores a valid branchFrom` & `rejects an unknown branchFrom` — "hantu" tetap bukan kandidat lokal maupun remote).

- [x] **Step 5: Commit**

```bash
git add server/src/services/branches.ts server/src/routes/specs.ts server/test/branches.test.ts
git commit -m "feat(spec-244): branchFromCandidates lokal∪origin — branchFrom remote-only lolos gerbang"
```

---

### Task 4: Runner prompt — klausa skip-audit untuk qa lanjutan audit

**Files:**
- Modify: `runner/src/prompt.ts` (tambah helper + sisip di `startPrompt`, sekitar baris 129-144)
- Test: `runner/test/prompt.test.ts`

**Interfaces:**
- Consumes: `SpecBrief.payload` (unknown), `Flow`.
- Produces: `startPrompt` untuk `flow==="qa"` dengan `payload.fromAudit` menyertakan klausa lewati Audit + baca dokumen audit.

- [x] **Step 1: Tulis test yang gagal** — tambahkan di `runner/test/prompt.test.ts` dalam `describe("startPrompt")`:

```ts
  it("qa dinaikkan dari audit: lewati fase Audit, baca dokumen audit (SPEC-244)", () => {
    const p = startPrompt("qa", { ...spec, payload: { severity: "major", steps: "", expected: "", actual: "", env: "", fromAudit: "SPEC-237" } }, "hanoman/spec-244");
    expect(p).toContain("LANJUTAN dari audit SPEC-237");
    expect(p).toContain("Audit skipped");
    expect(p).toContain("audit-spec-237-");
  });
  it("qa tanpa fromAudit: TIDAK membawa klausa lanjutan audit", () => {
    expect(startPrompt("qa", spec, "b")).not.toContain("LANJUTAN dari audit");
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner/test/prompt.test.ts -t "dinaikkan dari audit"`
Expected: FAIL — string tak ada.

- [x] **Step 3: Implementasi** — tambahkan helper di `runner/src/prompt.ts` (setelah `auditOnlyInstruction`, ~baris 128):

```ts
// SPEC-244 · ADR-0059 — qa yang DINAIKKAN dari audit (payload.fromAudit) berjalan di branch audit,
// jadi dokumen audit sudah ada di worktree. Lewati fase Audit (jangan investigasi ulang), baca
// dokumen itu, tandai `Audit skipped`, lalu keputusan pasca-Audit ADR-0040.
const auditContinuationInstruction = (flow: Flow, spec: SpecBrief): string => {
  const fromAudit = flow === "qa" && spec.payload && typeof spec.payload === "object"
    ? (spec.payload as { fromAudit?: unknown }).fromAudit : undefined;
  if (typeof fromAudit !== "string" || !fromAudit) return "";
  return `Backlog qa ini LANJUTAN dari audit ${fromAudit}. Worktree ini lahir dari branch audit itu, `
    + `jadi dokumen audit sudah ada di internal/docs/research/audit-${fromAudit.toLowerCase()}-*.md. `
    + "JANGAN mengulang investigasi fase Audit dari nol — baca dokumen audit itu sebagai temuan, "
    + "tandai fase Audit dilewati (`echo \"Audit skipped\" >> \"$HANOMAN_PHASE_FILE\"`), lalu ambil "
    + "keputusan pasca-Audit: perbaikan jelas & kecil → langsung Execute (tandai `Spec skipped` dan "
    + "`Plan skipped` bila sesuai); selain itu Spec → Plan → Execute penuh.";
};
```

Lalu sisipkan pemanggilannya di array `startPrompt` (setelah `auditDecisionInstruction(flow),`):

```ts
    auditDecisionInstruction(flow),
    auditContinuationInstruction(flow, spec),
    auditOnlyInstruction(flow),
```

- [x] **Step 4: Jalankan seluruh test prompt**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner/test/prompt.test.ts`
Expected: PASS semua (regresi: qa biasa & feature tak berubah).

- [x] **Step 5: Commit**

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts
git commit -m "feat(spec-244): klausa prompt skip-audit untuk qa lanjutan audit (fromAudit)"
```

---

### Task 5: Frontend — prefill branchFrom + remotes di picker + wiring take/promote

**Files:**
- Modify: `src/src/screens/branch.ts` (helper `prdBranchOf` + `branchOptions` remote label)
- Modify: `src/src/App.tsx` (`SpecPrefill`/`SpecForm` + branches state + `promoteToQa` + `createSpec`)
- Modify: `src/src/screens/PrdScreen.tsx` (`PrdPrefill.branchFrom` + `onTake`)
- Modify: `src/src/screens/BacklogScreen.tsx` (branches state remote-aware — konsistensi)
- Test: `src/test/branch-options.test.ts` (baru)

**Interfaces:**
- Produces: `prdBranchOf(prdPath): string`; `branchOptions(branches, remoteOnly?)`; `SpecPrefill.branchFrom?`, `SpecPrefill.fromAudit?`; `SpecForm.fromAudit`.

- [x] **Step 1: Tulis test yang gagal** — buat `src/test/branch-options.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { branchOptions, prdBranchOf } from "../src/screens/branch";

describe("prdBranchOf (SPEC-244)", () => {
  it("menurunkan branch prd/<slug> dari path dokumen PRD", () => {
    expect(prdBranchOf("docs/prd/funnel-v2.md")).toBe("prd/funnel-v2");
  });
});
describe("branchOptions remote label (SPEC-244)", () => {
  it("menandai branch yang hanya ada di origin dengan · origin", () => {
    const opts = branchOptions(["main", "prd/x"], new Set(["prd/x"]));
    expect(opts.find((o) => o.value === "prd/x")?.label).toBe("prd/x · origin");
    expect(opts.find((o) => o.value === "main")?.label).toBe("main");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism src/test/branch-options.test.ts`
Expected: FAIL — `prdBranchOf` belum ada; `branchOptions` belum terima argumen kedua.

- [x] **Step 3a: Implementasi `branch.ts`** — ganti isi `src/src/screens/branch.ts`:

```ts
// SPEC-143 · opsi dropdown branch, dipakai form spec baru dan detail backlog.
// "" = kirim null/undefined ke server = default project (main).
// SPEC-244 · remoteOnly menandai branch yang hanya ada di origin (mis. prd/<slug>, hanoman/<audit-id>).
export function branchOptions(branches: string[], remoteOnly?: Set<string>) {
  return [{ value: "", label: branches.length ? "main (default project)" : "project belum punya repo" }]
    .concat(branches.map((b) => ({ value: b, label: remoteOnly?.has(b) ? `${b} · origin` : b })));
}

// SPEC-244 · branch yang dibuat sesi PRD, diturunkan dari path dokumennya (docs/prd/<slug>.md → prd/<slug>).
export const prdBranchOf = (prdPath: string) =>
  `prd/${prdPath.replace(/^docs\/prd\//, "").replace(/\.md$/, "")}`;
```

- [x] **Step 3b: Implementasi `App.tsx`** —

(i) `SpecPrefill` (baris 35-36) tambah dua field:
```ts
type SpecPrefill = { project?: string; title?: string; context?: string; outcome?: string; prdPath?: string;
  kind?: string; steps?: string; actual?: string; severity?: string; branchFrom?: string; fromAudit?: string };
```
(ii) `SpecForm` (baris 31-32) tambah `fromAudit`:
```ts
  priority: string; severity: string; steps: string; expected: string; actual: string; env: string; branchFrom: string; fromAudit: string };
```
(iii) `blank` (baris 43-46): set dari prefill:
```ts
    expected: "", actual: prefill?.actual ?? "", env: "", branchFrom: prefill?.branchFrom ?? "", fromAudit: prefill?.fromAudit ?? "" };
```
(iv) branches effect (baris 51-64): fetch keduanya + remoteOnly:
```ts
  const [branches, setBranches] = React.useState<string[]>([]);
  const [remoteOnly, setRemoteOnly] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (!open || !f.project) { setBranches([]); setRemoteOnly(new Set()); return; }
    let alive = true;
    api.listBranches(f.project)
      .then((r) => {
        if (!alive) return;
        const combined = [...new Set([...r.branches, ...r.remotes])].sort();
        setBranches(combined);
        setRemoteOnly(new Set(r.remotes.filter((b) => !r.branches.includes(b))));
        setF((s) => (s.branchFrom && !combined.includes(s.branchFrom) ? { ...s, branchFrom: "" } : s));
      })
      .catch(() => { if (alive) { setBranches([]); setRemoteOnly(new Set()); } });
    return () => { alive = false; };
  }, [open, f.project]);
```
(v) Select branch (baris 95-96): pakai remoteOnly:
```ts
        <Select value={f.branchFrom} onChange={set("branchFrom")} disabled={!branches.length}
          style={{ width: "100%" }} options={branchOptions(branches, remoteOnly)} />
```
(vi) `promoteToQa` (baris 592-596): tambah branchFrom + fromAudit:
```ts
  function promoteToQa(spec: Spec) {
    setSpecPrefill({ project: spec.projectId, kind: "qa", title: spec.title,
      steps: `Dari audit ${spec.id}: ${spec.objective}`.slice(0, 500), actual: spec.objective, severity: "major",
      branchFrom: `hanoman/${spec.id.toLowerCase()}`, fromAudit: spec.id });   // SPEC-244 · teruskan branch audit + skip fase Audit
    setModal("brief");
  }
```
(vii) `createSpec` qa payload (baris 641-645): sertakan fromAudit:
```ts
    const payload = isQa
      ? { severity: f.severity, steps: f.steps, expected: f.expected, actual: f.actual, env: f.env,
          ...(f.fromAudit ? { fromAudit: f.fromAudit } : {}) }   // SPEC-244 · sinyal skip-audit
      : { context: f.context, outcome: f.outcome, constraints: f.constraints, priority: f.priority };
```

- [x] **Step 3c: Implementasi `PrdScreen.tsx`** —

(i) `PrdPrefill` (baris 14) tambah branchFrom:
```ts
export type PrdPrefill = { project: string; title: string; context: string; outcome: string; prdPath: string; branchFrom: string };
```
(ii) import `prdBranchOf` dari `./branch` (tambah ke import yang ada, mis. `import { ..., prdBranchOf } from "./branch";` — bila belum ada import branch, tambahkan `import { prdBranchOf } from "./branch";`).
(iii) tombol `onTake` (baris 75): sertakan branchFrom:
```ts
          onClick={() => onTake({ project: projectId, title: prd.title, context: `Dari PRD: ${prd.path}`, outcome: "", prdPath: prd.path, branchFrom: prdBranchOf(prd.path) })}>
```

- [x] **Step 3d: Implementasi `BacklogScreen.tsx`** (konsistensi picker edit) — branches effect (baris ~122-129) & Select (~213):
```ts
    api.listBranches(projectId)
      .then((r) => { if (alive) { const combined = [...new Set([...r.branches, ...r.remotes])].sort();
        setBranches(combined); setRemoteOnly(new Set(r.remotes.filter((b) => !r.branches.includes(b)))); } })
      .catch(() => { if (alive) { setBranches([]); setRemoteOnly(new Set()); } });
```
Tambah state `const [remoteOnly, setRemoteOnly] = React.useState<Set<string>>(new Set());` di dekat `const [branches, setBranches]`. Ubah Select `options={branchOptions(branches, remoteOnly)}`.

- [x] **Step 4: Jalankan test frontend tersentuh**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism src/test/branch-options.test.ts src/test/backlog-board.test.tsx src/test/terminal-screen.test.tsx`
Expected: PASS. Lalu `pnpm -w tsc -b` (atau build) bersih — tak ada type error dari field baru.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/branch.ts src/src/App.tsx src/src/screens/PrdScreen.tsx src/src/screens/BacklogScreen.tsx src/test/branch-options.test.ts
git commit -m "feat(spec-244): prefill branchFrom + picker remote-aware + wiring take/promote"
```

---

### Task 6: Verifikasi nyata (boot server + curl) & suite penuh

**Files:** tak ada perubahan kode; verifikasi.

- [x] **Step 1: Build**

Run: `pnpm -w build` (atau `pnpm --filter @hanoman/server build && pnpm --filter @hanoman/shared build`)
Expected: sukses, tanpa type error.

- [x] **Step 2: Suite penuh**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism`
Expected: hijau (atau hanya flaky yang terdokumentasi di memory — `queue-durability` dsb.; ulang bila perlu).

- [x] **Step 3: Boot server + curl endpoint branchFrom remote-only**

Boot server terhadap DB throwaway (lihat memory "Live smoke: dedicated DB"), buat project ber-repoDir yang punya branch origin-only, lalu:
```bash
# whitelist menerima branch remote-only (mis. hanoman/spec-x) → 200/201, bukan 400
curl -s -X POST localhost:<port>/api/specs -H 'content-type: application/json' \
  -b "<cookie>" -d '{"project":"<id>","source":"qa","title":"T","priority":"sedang","branchFrom":"<remote-only-branch>","payload":{"severity":"major","steps":"","expected":"","actual":"","env":"","fromAudit":"SPEC-237"}}'
```
Expected: respons berisi `branchFrom` yang di-set & `payload.fromAudit` tersimpan (bukan error 400 "branch tidak ada").

- [x] **Step 4: Centang plan & commit akhir bila ada sisa**

Pastikan semua `- [x]` di plan ini jadi `- [x]`. Commit perubahan tersisa (mis. plan terceklist).

## Self-Review

1. **Spec coverage (AC ADR-0059):** AC-1 (prefill prd/<slug>) → Task 5 (PrdScreen+prdBranchOf). AC-2 (prefill hanoman/<id>+fromAudit) → Task 5 (promoteToQa). AC-3 (picker+whitelist lokal∪origin) → Task 3 + Task 5. AC-4 (resolveCommit origin) → Task 1. AC-5 (prompt skip-audit) → Task 4 + Task 2. AC-6 (regresi nol) → tercakup di test regresi tiap task. ✔ Semua AC punya task.
2. **Placeholder scan:** tak ada TBD/"handle edge cases"; tiap step kode nyata. ✔
3. **Type consistency:** `branchOptions(branches, remoteOnly?)`, `prdBranchOf`, `fromAudit`, `branchFromCandidates` konsisten lintas task. ✔
