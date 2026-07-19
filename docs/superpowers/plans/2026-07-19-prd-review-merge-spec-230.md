# PRD Review + Merge/Rebase (SPEC-230) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beri sesi PRD project-level tombol **review** (diff worktree) dan **rebase/merge** (branch `prd/<slug>`) di Terminal, seragam dengan sesi brief/qa — tanpa perubahan skema.

**Architecture:** Review+integrate digeneralisasi dari Spec-only ke **ber-skop sesi**. Branch integrasi disimpan pada sesi (`@hanoman_branch` tmux → `SessionDTO.branch`). `services/integrate.ts` menerima `{ branch, mergeId }` eksplisit; dua endpoint baru `GET /terminal/sessions/:id/review` dan `POST /terminal/sessions/:id/integrate` bekerja pada worktree/branch sesi. Frontend menggeneralisasi `ReviewScreen` (`kind`) & `IntegrateDialog` (`ownBranch`), lalu `Cell` menampilkan aksi untuk sesi dengan `branch`. Doc-of-record: ADR-0054.

**Tech Stack:** Node.js + TypeScript (Fastify), Prisma/Postgres (tak berubah), tmux/node-pty, React + TypeScript (Vite), zod, vitest.

## Global Constraints

- **Tanpa perubahan skema Prisma** — PRD bukan entitas DB (ADR-0041/0011). Review dari worktree hidup, integrate dari branch.
- **TypeScript strict.** Test tiap logika orchestrasi (worktree/integrate/review).
- **`SessionDTO.branch` aditif & opsional** — wire tetap kompatibel.
- **Zero regresi** pada jalur review/integrate Spec (brief/qa).
- Test repo: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism` (hindari env prod bocor; DB test `hanoman_test`).
- Docs tersentuh diperbarui dalam commit yang sama & ter-link di `internal/docs/README.md`.
- Branch sesi PRD = `prd/<slug>`; id sesi = `prd-<slug>`; worktree = `<repoDir>/.worktrees/prd-<slug>`.

---

### Task 1: Generalisasi `integrate.ts` ke `{ branch, mergeId }`

**Files:**
- Modify: `server/src/services/integrate.ts`
- Modify: `server/src/routes/specs.ts:178` (pemanggil tetap sama; verifikasi lulus)
- Test: `server/test/integrate.test.ts` (tambah kasus branch kustom)

**Interfaces:**
- Produces: `integrateBranch(repoDir: string, src: { branch: string; mergeId: string }, op: "merge"|"rebase", target: string): Promise<IntegrateResult>` — dipakai Task 4.
- Produces: `integrate(repoDir, specId, op, target)` tetap ada (wrapper), `sourceBranch(specId)` tetap diekspor.

- [x] **Step 1: Tulis test yang gagal** — integrate lewat branch eksplisit (bukan `hanoman/<id>`).

Tambah di `server/test/integrate.test.ts` (setelah `describe("integrate — guards"`):

```ts
import { integrate, integrateBranch } from "../src/services/integrate";
// ... (import makeRepoWithSpecBranch sudah ada)

describe("integrateBranch — branch eksplisit (sesi PRD)", () => {
  it("merge branch non-spec ke origin:main → clean", async () => {
    // factory membuat branch hanoman/spec-1; kita perlakukan namanya sebagai branch generik.
    const { repoDir, origin } = makeRepoWithSpecBranch("SPEC-1");
    const r = await integrateBranch(
      repoDir, { branch: "hanoman/spec-1", mergeId: "prd-demo" }, "merge", "origin:main");
    expect(r.status).toBe("clean");
    expect(existsSync(`${repoDir}/.worktrees/merge-prd-demo`)).toBe(false);
  });
  it("branch tak ada → 409", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = await integrateBranch(
      repoDir, { branch: "prd/nope", mergeId: "prd-nope" }, "merge", "origin:main");
    expect(r).toMatchObject({ status: "error", code: 409 });
  });
});
```

- [x] **Step 2: Jalankan test → gagal** (fungsi belum ada).

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism integrate.test.ts`
Expected: FAIL — `integrateBranch is not a function`.

- [x] **Step 3: Refactor `integrate.ts`.**

Ubah `resolveSource` menerima **branch** (bukan specId):

```ts
// origin/<branch> lebih dulu (hasil push), fallback branch lokal. Null = belum ada.
async function resolveSource(repoDir: string, branch: string): Promise<string | null> {
  if (await refExists(repoDir, `refs/remotes/origin/${branch}`)) return `refs/remotes/origin/${branch}`;
  if (await refExists(repoDir, `refs/heads/${branch}`)) return `refs/heads/${branch}`;
  return null;
}
```

Ganti `export async function integrate(...)` dengan inti generik + wrapper tipis:

```ts
export type IntegrateSource = { branch: string; mergeId: string };

// SPEC-230 · integrasi generik atas sebuah branch. Spec memakai wrapper `integrate` di bawah;
// sesi project-level (PRD) memanggil ini langsung dengan branch `prd/<slug>` + mergeId = id sesi.
export async function integrateBranch(
  repoDir: string, src: IntegrateSource, op: IntegrateOp, target: string,
): Promise<IntegrateResult> {
  const source = await resolveSource(repoDir, src.branch);
  if (!source) return { status: "error", code: 409, error: "branch belum ada — jalankan/selesaikan sesi dulu" };
  const tgt = await resolveTarget(repoDir, target);
  if (!tgt) return { status: "error", code: 400, error: `target "${target}" tidak dikenal` };

  await sh(repoDir, ["fetch", "origin"]); // best-effort; abaikan gagal/offline (timeout 60s)

  const wt = join(repoDir, ".worktrees", `merge-${sanitize(src.mergeId)}`);
  await reclaim(repoDir, wt);

  const baseRef = op === "merge" ? tgt.ref : source;
  const baseSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  if (!(await ok(repoDir, ["worktree", "add", "--detach", "-q", wt, baseSha])))
    return { status: "error", code: 500, error: "gagal membuat worktree integrasi" };

  const applyRef = op === "merge" ? source : tgt.ref;
  const cmd = op === "merge" ? ["merge", "--no-edit", applyRef] : ["rebase", applyRef];
  const run = await sh(wt, cmd);

  const finalize: Finalize = op === "rebase"
    ? { kind: "force-push", branch: src.branch }
    : tgt.dest === "local"
      ? { kind: "branch-f", branch: tgt.name, checkout: await worktreeForBranch(repoDir, tgt.name) }
      : { kind: "push", branch: tgt.name };

  if (run.status === 0) {
    const fin = await runFinalize(wt, repoDir, finalize);
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return fin.ok ? { status: "clean", detail: fin.detail } : { status: "error", code: 409, error: fin.error };
  }
  return {
    status: "conflict", worktree: wt, op, source,
    target: `${tgt.dest}:${tgt.name}`, finalize: finalizeInstruction(op, finalize),
  };
}

// SPEC-175 · wrapper Spec: branch = hanoman/<specid>, mergeId = specid.
export async function integrate(
  repoDir: string, specId: string, op: IntegrateOp, target: string,
): Promise<IntegrateResult> {
  return integrateBranch(repoDir, { branch: sourceBranch(specId), mergeId: specId }, op, target);
}
```

Catatan: hapus body lama `integrate` yang memakai `resolveSource(repoDir, specId)` & `sourceBranch(specId)` di finalize — kini di `integrateBranch`. `sourceBranch`, `sanitize`, `reclaim`, `resolveTarget`, `worktreeForBranch`, `runFinalize`, `finalizeInstruction`, `Finalize` tetap.

- [x] **Step 4: Jalankan test integrate → hijau** (termasuk kasus Spec lama).

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism integrate.test.ts`
Expected: PASS semua (kasus `integrate(repoDir, "SPEC-1", ...)` lama tetap lulus lewat wrapper).

- [x] **Step 5: Commit.**

```bash
git add server/src/services/integrate.ts server/test/integrate.test.ts
git commit -m "refactor(server): integrate generik atas branch (integrateBranch) — SPEC-230"
```

---

### Task 2: Simpan branch pada sesi (pty) + `SessionDTO.branch`

**Files:**
- Modify: `server/src/services/pty.ts` (FMT, `SessionInfo`, `listPanes`, `CreateOpts`, `createSession`, `listSessions`)
- Modify: `shared/src/dto.ts` (`SessionDTO`)
- Test: `server/test/terminal.route.test.ts` (sesi dengan branch terlihat di list)

**Interfaces:**
- Produces: `SessionInfo.branch?: string`; `CreateOpts.branch?: string`; `SessionDTO.branch?: string`.
- Consumes: `createSession(projectId, cwd, { ..., branch })` men-set `@hanoman_branch`.

- [x] **Step 1: Tulis test yang gagal** — createSession dengan branch → muncul di listSessions.

Tambah di `server/test/terminal.route.test.ts` dalam `describe("terminal routes", …)`:

```ts
it("createSession menyimpan branch dan mengembalikannya di listSessions", () => {
  const wt = join(repoDir, ".worktrees", "prd-branchtest");
  execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "HEAD"], { cwd: repoDir });
  const s = createSessionSvc("p1", wt, { id: "prd-branchtest", flow: "prd", branch: "prd/branchtest" });
  const found = listSessions().find((x) => x.id === s.id);
  expect(found?.branch).toBe("prd/branchtest");
  killSession("prd-branchtest");
});
```

- [x] **Step 2: Jalankan test → gagal.**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism terminal.route.test.ts -t "menyimpan branch"`
Expected: FAIL — `found?.branch` `undefined` (dan TS error `branch` bukan properti `CreateOpts`).

- [x] **Step 3: pty.ts — tambahkan branch di FMT, tipe, dan createSession.**

FMT (tambah field terakhir):

```ts
const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}", "#{@hanoman_branch}",
].join("\t");
```

`listPanes` destructure + Pane (tambah `branch`):

```ts
const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch] = line.split("\t");
// ...
return [{
  id: n.slice(PREFIX.length), projectId: projectId ?? "", specId: specId || undefined,
  flow: (flow || undefined) as Flow | undefined, phaseFile: phaseFile || undefined,
  cwd: cwd ?? "", exited, code: Number(code) || 0,
  decisionFile: decisionFile || undefined,
  branch: branch || undefined,
  decision: !exited && !!decisionFile && markerFilled(decisionFile),
}];
```

`SessionInfo` tipe:

```ts
export type SessionInfo = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  branch?: string; decision: boolean;
};
```

`listSessions`:

```ts
export const listSessions = (): SessionInfo[] =>
  listPanes().map(({ id, projectId, specId, flow, cwd, exited, branch, decision }) => ({
    id, projectId, specId, flow, cwd, exited, branch, decision,
  }));
```

`CreateOpts`:

```ts
export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; branch?: string; prompt?: string; phaseFile?: string;
  decisionFile?: string; model?: string; effort?: string; command?: string[];
};
```

`createSession` — set opsi tmux (sesudah baris `if (opts.flow) tmux(... "@hanoman_flow" ...)`):

```ts
if (opts.flow) tmux("set-option", "-t", name(id), "@hanoman_flow", opts.flow);
if (opts.branch) tmux("set-option", "-t", name(id), "@hanoman_branch", opts.branch);
```

Dan return-nya:

```ts
return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, branch: opts.branch, exited: false, decision: false };
```

- [x] **Step 4: shared/dto.ts — SessionDTO.branch.**

```ts
export type SessionDTO = {
  id: string; projectId: string; specId?: string; flow?: string; cwd: string;
  branch?: string; exited: boolean; decision: boolean;
};
```

- [x] **Step 5: Jalankan test → hijau.**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism terminal.route.test.ts -t "menyimpan branch"`
Expected: PASS.

- [x] **Step 6: Commit.**

```bash
git add server/src/services/pty.ts shared/src/dto.ts server/test/terminal.route.test.ts
git commit -m "feat(server): simpan branch integrasi pada sesi (@hanoman_branch) — SPEC-230"
```

---

### Task 3: Endpoint review ber-skop sesi

**Files:**
- Modify: `shared/src/api.ts` (paths `sessionReview`, `sessionReviewFile`)
- Modify: `server/src/routes/terminal.ts` (import + 2 route + set branch prd)
- Modify: `src/src/api/client.ts` (`sessionReview`, `sessionReviewFile`)
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `specReview(repoDir, id, null, null)` & `reviewFile(repoDir, id, null, null, path)` dari `services/spec-review` (id sesi = kunci worktree).
- Produces: `GET /api/terminal/sessions/:id/review` → `SpecReview`; `/review/*` → `ReviewFile|404`.

- [x] **Step 1: shared/src/api.ts — tambah paths** (setelah `terminalPhases`):

```ts
  terminalPhases: (id: string) => `${API}/terminal/sessions/${id}/phases`,
  sessionReview: (id: string) => `${API}/terminal/sessions/${id}/review`,
  sessionReviewFile: (id: string, path: string) => `${API}/terminal/sessions/${id}/review/${path}`,
  sessionIntegrate: (id: string) => `${API}/terminal/sessions/${id}/integrate`,
```

(`sessionIntegrate` dipakai Task 4 — dideklarasi sekali di sini.)

- [x] **Step 2: Tulis test yang gagal** — review sesi PRD hidup mengembalikan diff dokumen.

Tambah `describe` baru di `server/test/terminal.route.test.ts`:

```ts
describe("terminal routes · sesi PRD review + integrate", () => {
  // buat sesi prd langsung lewat service (hindari spawn claude sungguhan)
  const mkPrd = (slug: string) => {
    const id = `prd-${slug}`;
    const wt = join(repoDir, ".worktrees", id);
    execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "HEAD"], { cwd: repoDir });
    writeFileSync(join(wt, `docs-prd-${slug}.md`), `# PRD ${slug}\n`);
    createSessionSvc("p1", wt, { id, flow: "prd", branch: `prd/${slug}`, command: ["/bin/sleep", "30"] });
    return id;
  };

  it("GET /:id/review mengembalikan diff worktree sesi PRD", async () => {
    const id = mkPrd("rev");
    const res = await app.inject({ url: `/api/terminal/sessions/${id}/review` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changed.some((c: any) => c.path === "docs-prd-rev.md")).toBe(true);
    killSession(id);
  });

  it("GET /:id/review setelah sesi ditutup (worktree lenyap) → 409", async () => {
    const id = mkPrd("gone");
    killSession(id);
    execFileSync("git", ["worktree", "remove", "--force", join(repoDir, ".worktrees", id)], { cwd: repoDir });
    const res = await app.inject({ url: `/api/terminal/sessions/${id}/review` });
    expect(res.statusCode).toBe(409);
  });
});
```

- [x] **Step 3: Jalankan test → gapal** (404, route belum ada).

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism terminal.route.test.ts -t "review"`
Expected: FAIL — statusCode 404, bukan 200/409.

- [x] **Step 4: terminal.ts — import + set branch prd + route review.**

Import (baris atas):

```ts
import { existsSync } from "node:fs";
import { specReview, reviewFile } from "../services/spec-review";
import { integrateBranch } from "../services/integrate";
import { zIntegrate } from "@hanoman/shared";
```

Set branch di cabang prd (di dalam blok `if (parsed.data.flow === "prd")`, pada opts createSession):

```ts
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "prd", branch: `prd/${slug}`, model, effort,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startPrdPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          brief, `prd/${slug}`),
      });
```

Route review (setelah `app.get("/terminal/sessions/:id/phases", …)`):

```ts
  // SPEC-230 · review diff worktree hidup sebuah sesi project-level (PRD). Kunci worktree = id
  // sesi (worktreeDir(repoDir, id) === s.cwd). Tanpa baseSha/branchFrom → mergeBase jatuh ke
  // default repo/HEAD (SPEC-227). Worktree lenyap (sesi ditutup) → 409, bukan 500.
  const sessionWorktree = async (id: string) => {
    const s = getSession(id);
    if (!s) return { err: 404 as const };
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return { err: 409 as const, msg: "project belum punya repoDir" };
    if (!s.cwd.includes("/.worktrees/") || !existsSync(s.cwd))
      return { err: 409 as const, msg: "belum ada worktree untuk di-review — jalankan/lanjutkan sesi dulu" };
    return { s, repoDir };
  };
  app.get("/terminal/sessions/:id/review", async (req, reply) => {
    const r = await sessionWorktree((req.params as { id: string }).id);
    if ("err" in r) return reply.code(r.err).send({ error: r.msg ?? "not found" });
    return specReview(r.repoDir, r.s.id, null, null);
  });
  app.get("/terminal/sessions/:id/review/*", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const r = await sessionWorktree(id);
    if ("err" in r) return reply.code(r.err).send({ error: r.msg ?? "not found" });
    const rf = await reviewFile(r.repoDir, r.s.id, null, null, path);
    return rf === null ? reply.code(404).send({ error: "not found" }) : rf;
  });
```

- [x] **Step 5: src/src/api/client.ts — tambah fungsi.**

Setelah `deleteTerminal`:

```ts
  // SPEC-230 · review + integrate ber-skop sesi (sesi project-level PRD, tanpa Spec).
  sessionReview: (id: string) => j<SpecReview>(paths.sessionReview(id)),
  sessionReviewFile: (id: string, path: string) => j<ReviewFile>(paths.sessionReviewFile(id, path)),
  sessionIntegrate: (id: string, op: "merge" | "rebase", target: string) =>
    j<{ status: "clean"; detail: string } | { status: "conflict"; sessionId: string }>(
      paths.sessionIntegrate(id), { method: "POST", ...body({ op, target }) }),
```

- [x] **Step 6: Jalankan test review → hijau.**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism terminal.route.test.ts -t "review"`
Expected: PASS (200 dengan `docs-prd-rev.md` di changed; 409 sesudah worktree lenyap).

- [x] **Step 7: Commit.**

```bash
git add shared/src/api.ts server/src/routes/terminal.ts src/src/api/client.ts server/test/terminal.route.test.ts
git commit -m "feat(server): review ber-skop sesi + branch prd/<slug> pada sesi PRD — SPEC-230"
```

---

### Task 4: Endpoint integrate ber-skop sesi

**Files:**
- Modify: `server/src/routes/terminal.ts` (route integrate)
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `integrateBranch(repoDir, { branch: s.branch, mergeId: s.id }, op, target)` (Task 1), `zIntegrate` (import Task 3), `sessionModel`, `createSession`.
- Produces: `POST /api/terminal/sessions/:id/integrate` → `{status:"clean",detail}` | `{status:"conflict",sessionId}` | error.

- [x] **Step 1: Tulis test yang gagal** — integrate clean sesi PRD ke origin:main + branch tak ada → 409.

Tambah di `describe("terminal routes · sesi PRD review + integrate", …)`. Prasyarat: repoDir butuh sebuah origin + branch `prd/<slug>` yang di-push. Buat helper lokal yang menyiapkan origin bare + push branch prd:

```ts
  it("POST /:id/integrate branch belum ada → 409", async () => {
    const id = mkPrd("noremote");
    const res = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${id}/integrate`,
      payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(409);
    killSession(id);
  });

  it("POST /:id/integrate op/target invalid → 400", async () => {
    const id = mkPrd("badreq");
    const res = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${id}/integrate`,
      payload: { op: "nope", target: "x" } });
    expect(res.statusCode).toBe(400);
    killSession(id);
  });
```

(Catatan: jalur "clean" penuh diverifikasi unit di `integrate.test.ts` Task 1 — di sini cukup guard 400/409 pada rute, karena menyiapkan origin push di test rute berat & sudah tercakup.)

- [x] **Step 2: Jalankan test → gagal** (404, route belum ada).

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism terminal.route.test.ts -t "integrate"`
Expected: FAIL — statusCode 404.

- [x] **Step 3: terminal.ts — route integrate.**

Setelah route `/review/*`:

```ts
  // SPEC-230 · rebase/merge branch sesi project-level (PRD: prd/<slug>). Bersih → langsung;
  // konflik → spawn sesi claude di worktree merge-<id> (tanpa flow → tak menggerakkan stage).
  app.post("/terminal/sessions/:id/integrate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zIntegrate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "op/target invalid" });
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });
    if (!s.branch) return reply.code(409).send({ error: "sesi ini tak punya branch untuk di-integrasi" });
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await integrateBranch(repoDir, { branch: s.branch, mergeId: s.id }, parsed.data.op, parsed.data.target);
    if (r.status === "error") return reply.code(r.code).send({ error: r.error });
    if (r.status === "clean") return { status: "clean", detail: r.detail };
    const { model, effort } = await sessionModel();
    const prompt = [
      `hanoman · selesaikan konflik ${r.op} branch \`${s.branch}\` ${r.op === "merge" ? "ke" : "di atas"} \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah operasi ${r.op} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      `Sesi PRD ${s.id}.`,
    ].join("\n\n");
    const cs = createSession(s.projectId, r.worktree, {
      id: `merge-${id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`,
      model, effort, prompt,
    });
    return { status: "conflict", sessionId: cs.id };
  });
```

- [x] **Step 4: Jalankan test integrate → hijau.**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism terminal.route.test.ts -t "integrate"`
Expected: PASS (409 branch belum ada; 400 payload invalid).

- [x] **Step 5: Commit.**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts
git commit -m "feat(server): integrate ber-skop sesi PRD (POST /terminal/sessions/:id/integrate) — SPEC-230"
```

---

### Task 5: `ReviewScreen` menerima `kind` (spec | session)

**Files:**
- Modify: `src/src/screens/ReviewScreen.tsx`

**Interfaces:**
- Produces: `<ReviewScreen specId kind?="spec"|"session" title onBack />` — dipakai App (Task 7).

- [x] **Step 1: Tambah prop `kind` + pilih API.**

Ubah tanda tangan + dua `useEffect`:

```tsx
export function ReviewScreen({ specId, title, onBack, kind = "spec" }:
  { specId: string; title: string; onBack: () => void; kind?: "spec" | "session" }) {
  // ... state tak berubah ...
  const fetchReview = kind === "session" ? api.sessionReview : api.specReview;
  const fetchFile = kind === "session" ? api.sessionReviewFile : api.specReviewFile;
```

Ganti pemanggilan di dua effect:
- `api.specReview(specId)` → `fetchReview(specId)`
- `api.specReviewFile(specId, selected)` → `fetchFile(specId, selected)`

(`title` sudah diterima; tak ada perubahan lain. Dependency array effect biarkan `[specId, tries]` & `[specId, selected]` — `kind` stabil per-mount.)

- [x] **Step 2: Verifikasi build FE.**

Run: `pnpm --filter @hanoman/web build` (atau `pnpm --filter web build` sesuai nama paket)
Expected: sukses, tanpa TS error.

- [x] **Step 3: Commit.**

```bash
git add src/src/screens/ReviewScreen.tsx
git commit -m "feat(web): ReviewScreen menerima kind spec|session — SPEC-230"
```

---

### Task 6: `IntegrateDialog` menerima `ownBranch` (bukan `Spec`)

**Files:**
- Modify: `src/src/screens/IntegrateDialog.tsx`
- Modify: `src/src/screens/BacklogScreen.tsx:240-241` (pemanggil)

**Interfaces:**
- Produces: `<IntegrateDialog projectId ownBranch eyebrow onClose onIntegrate />` — dipakai BacklogScreen & Cell (Task 7).

- [x] **Step 1: Generalisasi IntegrateDialog.**

```tsx
import React from "react";
import { Modal, Select, Button } from "../ds";
import { api } from "../api/client";

// SPEC-175/SPEC-230 · dialog target rebase/merge. Dipakai backlog (branch spec `hanoman/<id>`)
// & terminal (branch sesi, mis. PRD `prd/<slug>`). Branch sendiri (ownBranch) dikecualikan.
export function IntegrateDialog({ projectId, ownBranch, eyebrow, onClose, onIntegrate }: {
  projectId: string; ownBranch: string; eyebrow: string;
  onClose: () => void; onIntegrate: (op: "merge" | "rebase", target: string) => void | Promise<void>;
}) {
  const [targets, setTargets] = React.useState<{ local: string[]; origin: string[] }>({ local: [], origin: [] });
  const [target, setTarget] = React.useState("");
  const own = ownBranch;
  React.useEffect(() => {
    let alive = true;
    api.listBranches(projectId)
      .then((r) => { if (alive) setTargets({ local: r.branches.filter((b) => b !== own), origin: r.remotes.filter((b) => b !== own) }); })
      .catch(() => { if (alive) setTargets({ local: [], origin: [] }); });
    return () => { alive = false; };
  }, [projectId, own]);

  const options = [
    { value: "", label: "Pilih target…" },
    ...targets.local.map((b) => ({ value: `local:${b}`, label: `${b} (lokal)` })),
    ...targets.origin.map((b) => ({ value: `origin:${b}`, label: `origin/${b}` })),
  ];
  const go = (op: "merge" | "rebase") => { if (target) void onIntegrate(op, target); };

  return (
    <Modal open title="Rebase / Merge" eyebrow={`${eyebrow} · ${own}`} icon="git-merge" onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Rebase menata ulang branch di atas target (force-push balik ke branch itu). Merge
        menggabungkan branch ke target. Bila ada konflik, sesi claude membereskannya di Terminal.
      </div>
      <div style={{ marginBottom: 16 }}>
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Target</div>
        <Select size="sm" aria-label="Target" value={target} disabled={options.length === 1}
          onChange={(e) => setTarget(e.target.value)} options={options} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button size="sm" variant="secondary" leftIcon="git-branch" disabled={!target} onClick={() => go("rebase")}>Rebase</Button>
        <Button size="sm" variant="primary" leftIcon="git-merge" disabled={!target} onClick={() => go("merge")}>Merge</Button>
      </div>
    </Modal>
  );
}
```

- [x] **Step 2: Perbarui pemanggil BacklogScreen** (baris ~240):

```tsx
        {showIntegrate && onIntegrate && (
          <IntegrateDialog projectId={spec.projectId}
            ownBranch={`hanoman/${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`}
            eyebrow={spec.id}
            onClose={() => setShowIntegrate(false)}
            onIntegrate={(op, target) => { setShowIntegrate(false); onIntegrate(spec, op, target); }} />
        )}
```

- [x] **Step 3: Verifikasi build FE.**

Run: `pnpm --filter @hanoman/web build`
Expected: sukses (TerminalScreen masih memakai IntegrateDialog lama → akan diperbaiki Task 7; bila build gagal di TerminalScreen, lanjut Task 7 lalu build ulang di akhir Task 7).

- [x] **Step 4: Commit.**

```bash
git add src/src/screens/IntegrateDialog.tsx src/src/screens/BacklogScreen.tsx
git commit -m "feat(web): IntegrateDialog generik (ownBranch) — SPEC-230"
```

---

### Task 7: Cell PRD menampilkan review + merge; wiring App

**Files:**
- Modify: `src/src/api/client.ts` (`TerminalSession.branch`)
- Modify: `src/src/App.tsx` (state review + `integrateSession` + `openSessionReview` + props)
- Modify: `src/src/screens/TerminalScreen.tsx` (`Cell` + props)

**Interfaces:**
- Consumes: `api.sessionReview/sessionReviewFile/sessionIntegrate` (Task 3), `<ReviewScreen kind>` (Task 5), `<IntegrateDialog ownBranch>` (Task 6).

- [x] **Step 1: client.ts — TerminalSession.branch.**

```ts
export type TerminalSession = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  branch?: string; decision?: boolean;
};
```

- [x] **Step 2: App.tsx — state review berkind + handler sesi.**

Ganti `const [reviewSpecId, setReviewSpecId] = React.useState("");` dengan:

```tsx
  const [review, setReview] = React.useState<{ id: string; kind: "spec" | "session"; title: string } | null>(null);
```

Ganti `openReview` + tambah `openSessionReview`:

```tsx
  // SPEC-171/230 · buka layar review (spec: worktree backlog item; session: worktree sesi PRD).
  function openReview(s: Spec) { setReview({ id: s.id, kind: "spec", title: s.title }); setSection("review"); }
  function openReviewSpecId(id: string) {
    const t = backlog.find((s) => s.id === id)?.title ?? id;
    setReview({ id, kind: "spec", title: t }); setSection("review");
  }
  function openSessionReview(id: string, title: string) {
    setReview({ id, kind: "session", title }); setSection("review");
  }
```

Tambah `integrateSession` (dekat `integrateSpec`):

```tsx
  // SPEC-230 · rebase/merge branch sesi project-level (PRD). Cermin integrateSpec: konflik → Terminal.
  async function integrateSession(session: TerminalSession, op: "merge" | "rebase", target: string) {
    try {
      const r = await api.sessionIntegrate(session.id, op, target);
      if (r.status === "conflict") {
        setSection("terminal");
        showToast(`${session.id} · konflik ${op} — selesaikan di Terminal`, "warn", "git-merge");
      } else {
        showToast(`${session.id} · ${op} berhasil · ${r.detail}`, "ok", "git-merge");
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      showToast(`${session.id} · gagal ${op}` + (code === 409 ? " · branch/target?" : ""), "err", "x-circle");
    }
  }
```

Impor `TerminalSession` di App (cek baris import client): tambahkan ke `import { api, ApiError, type ... } from "./api/client"` bila belum ada `TerminalSession`.

Perbarui section review (baris ~732):

```tsx
  } else if (section === "review") {
    // SPEC-171/230 · review worktree (backlog item ATAU sesi PRD).
    screen = (
      <Shell active="backlog" title="Review" wide onNavigate={setSection}
        breadcrumb={review ? (review.kind === "spec" ? "backlog · " : "terminal · ") + review.id : "review"}
        actions={<Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={() => setSection(review?.kind === "session" ? "terminal" : "backlog")}>Kembali</Button>}>
        {gate(review
          ? <ReviewScreen specId={review.id} kind={review.kind} title={review.title}
              onBack={() => setSection(review.kind === "session" ? "terminal" : "backlog")} />
          : <StateBlock kind="empty" icon="git-compare" title="Pilih item untuk di-review"
              hint="Buka Review dari Backlog atau dari sel sesi di Terminal." action={() => setSection("backlog")} actionLabel="Ke Backlog" />)}
      </Shell>
    );
```

Perbarui props TerminalScreen (baris ~692-695):

```tsx
          : <TerminalScreen projects={projectsView} backlog={backlog} focusSession={focusSession}
              onOpenReview={openReviewSpecId}
              onOpenSessionReview={openSessionReview}
              titleOf={(id) => backlog.find((s) => s.id === id)?.title}
              onIntegrate={integrateSpec} onIntegrateSession={integrateSession}
              specOf={(id) => backlog.find((s) => s.id === id)} />
```

- [x] **Step 3: TerminalScreen.tsx — props + Cell.**

Tambah prop di `TerminalScreen({ … })` signature + tipe:

```tsx
export function TerminalScreen({ projects, backlog = [], focusSession, onOpenReview, onOpenSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf }: {
  projects: { id: string; name: string }[]; backlog?: Spec[]; focusSession?: string | null;
  onOpenReview?: (specId: string) => void;
  onOpenSessionReview?: (sessionId: string, title: string) => void;
  titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: Spec, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => Spec | undefined;
}) {
```

Teruskan ke `<Cell … />` (baris ~207-209):

```tsx
                      ? <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)}
                          onDetach={() => detach(s.id)} onExit={() => markExited(s.id)} onReview={onOpenReview}
                          onSessionReview={onOpenSessionReview}
                          titleOf={titleOf} onIntegrate={onIntegrate} onIntegrateSession={onIntegrateSession} specOf={specOf} />
```

`Cell` signature + body — tambah props, state sesi-integrate, dan render aksi untuk sesi ber-branch:

```tsx
function Cell({ session, nameOf, onClose, onDetach, onExit, onReview, onSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; onDetach: () => void; onExit: (code: number) => void;
  onReview?: (specId: string) => void;
  onSessionReview?: (sessionId: string, title: string) => void;
  titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: Spec, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => Spec | undefined;
}) {
  const [phases, setPhases] = React.useState<Phase[] | null>(null);
  const [docs, setDocs] = React.useState(false);
  const [integrate, setIntegrate] = React.useState(false);
  const [sessIntegrate, setSessIntegrate] = React.useState(false);
  const spec = session.specId ? specOf?.(session.specId) : undefined;
  const proj = nameOf(session.projectId);
  const title = session.specId ? titleOf?.(session.specId) : undefined;
  const label = session.specId ? `${proj} · ${session.specId}${title ? ` · ${title}` : ""}` : proj;
  // SPEC-230 · sesi project-level ber-branch (PRD) tanpa Spec: review+integrate ber-skop sesi.
  const branchSession = !session.specId && !!session.branch;
  const awaiting = !session.exited && !!session.decision;
  return (
    <>
      <div style={{ /* header tak berubah */ }}>
        {/* … label, StatusPill … */}
        {session.specId && ( /* docs button tak berubah */ )}
        {session.specId && onReview && ( /* spec review icon tak berubah */ )}
        {branchSession && onSessionReview && (
          <span onClick={() => onSessionReview(session.id, label)} title="Review perubahan (diff worktree sesi)"
            style={{ cursor: "pointer", color: "var(--text-subtle)", display: "inline-flex", alignItems: "center" }}>
            <Icon name="git-compare" size={12} />
          </span>
        )}
        {spec && onIntegrate && ( /* spec integrate icon tak berubah, buka setIntegrate(true) */ )}
        {branchSession && onIntegrateSession && (
          <span onClick={() => setSessIntegrate(true)} title="Rebase / Merge branch sesi"
            style={{ cursor: "pointer", color: "var(--text-subtle)", display: "inline-flex", alignItems: "center" }}>
            <Icon name="git-merge" size={12} />
          </span>
        )}
        {/* … lepas, × … */}
      </div>
      {/* … body PhaseStrip + TerminalPane tak berubah … */}
      {docs && session.specId && <SpecDocsModal specId={session.specId} onClose={() => setDocs(false)} />}
      {integrate && spec && onIntegrate && (
        <IntegrateDialog projectId={spec.projectId}
          ownBranch={`hanoman/${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`} eyebrow={spec.id}
          onClose={() => setIntegrate(false)}
          onIntegrate={(op, target) => { setIntegrate(false); onIntegrate(spec, op, target); }} />
      )}
      {sessIntegrate && branchSession && onIntegrateSession && (
        <IntegrateDialog projectId={session.projectId} ownBranch={session.branch!} eyebrow={session.id.slice(0, 16)}
          onClose={() => setSessIntegrate(false)}
          onIntegrate={(op, target) => { setSessIntegrate(false); onIntegrateSession(session, op, target); }} />
      )}
    </>
  );
}
```

(Bagian `/* tak berubah */` = pertahankan markup Cell yang sudah ada persis; hanya sisipkan blok `branchSession` + state `sessIntegrate` + dialog kedua.)

- [x] **Step 4: Build FE + typecheck.**

Run: `pnpm --filter @hanoman/web build`
Expected: sukses tanpa TS error (semua pemanggil IntegrateDialog kini pakai `projectId/ownBranch/eyebrow`).

- [x] **Step 5: Jalankan test FE (bila ada) + server penuh.**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism`
Expected: seluruh suite server PASS.

- [x] **Step 6: Commit.**

```bash
git add src/src/api/client.ts src/src/App.tsx src/src/screens/TerminalScreen.tsx
git commit -m "feat(web): sel sesi PRD menampilkan review + rebase/merge — SPEC-230"
```

---

### Task 8: Docs api-contract + smoke lokal + verifikasi akhir

**Files:**
- Modify: `internal/docs/architecture/api-contract.md` (3 endpoint + `SessionDTO.branch`)
- Verify: README index sudah menautkan ADR-0054 & audit doc (dilakukan di fase Spec)

- [x] **Step 1: Dokumentasikan endpoint baru di `api-contract.md`.**

Tambahkan (di seksi terminal/sessions) entri untuk:
- `GET /api/terminal/sessions/:id/review` (+`/review/*`) — diff worktree sesi project-level (PRD); 409 bila worktree lenyap.
- `POST /api/terminal/sessions/:id/integrate { op, target }` — rebase/merge branch sesi (`prd/<slug>`); clean/conflict/error seperti `/specs/:id/integrate`.
- `SessionDTO.branch?: string` — branch integrasi sesi (diisi untuk flow `prd`).
(Ikuti gaya baris tabel/daftar yang sudah ada di file itu; ambil format dari entri `/specs/:id/integrate` & `/specs/:id/review` yang sudah tercatat.)

- [x] **Step 2: Smoke lokal — boot server + curl (WAJIB, bukan cuma unit test).**

Ikuti pola memory `hanoman-live-smoke-dedicated-db` / `hanoman-worktree-needs-install-and-generate`:
```bash
# DB throwaway termigrasi + build server; JANGAN pakai hanoman_test (di-truncate suite lain) & port 8787 (dev lain).
# 1) pnpm install + prisma generate di worktree bila belum
# 2) migrate deploy ke DB smoke khusus, set DATABASE_URL ke situ
# 3) node server/dist/server.js di port bebas (mis. 8799)
# 4) buat project ber-repoDir, POST /api/terminal/sessions {project, flow:"prd", brief:{title:"Smoke PRD",…}}
# 5) GET /api/terminal/sessions/<id>/review → 200 dengan SpecReview (docs/prd/*.md di changed)
# 6) POST /api/terminal/sessions/<id>/integrate {op:"merge",target:"origin:main"} → 409 (branch belum di-push) ATAU clean bila di-push
# 7) GET /api/terminal/sessions → item punya field `branch: "prd/smoke-prd"`
```
Expected: review 200 + `branch` muncul di list; integrate mengembalikan JSON terstruktur (bukan 500). Fix sampai hijau bila ada issue.

- [x] **Step 3: Verifikasi coverage docs (dep-free, tanpa boot).**

Run: `pnpm --filter @hanoman/shared build` lalu jalankan pemindai coverage seperti biasa; pastikan ADR-0054 + audit doc ter-link (memory `hanoman-verify-coverage-without-server`).
Expected: index konsisten.

- [x] **Step 4: Suite penuh + centang plan.**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm -r test -- --no-file-parallelism` (atau minimal server + shared)
Expected: hijau. Centang semua `- [x]` plan → `- [x]`.

- [x] **Step 5: Commit docs + plan.**

```bash
git add internal/docs/architecture/api-contract.md docs/superpowers/plans/2026-07-19-prd-review-merge-spec-230.md
git commit -m "docs: kontrak endpoint review/integrate ber-skop sesi + centang plan SPEC-230"
```

---

## Self-Review

**Spec coverage (ADR-0054 AC):**
- AC-1 (tombol review+merge di sel PRD) → Task 7.
- AC-2 (GET review worktree PRD) → Task 3.
- AC-3 (merge/rebase clean) → Task 1 (unit) + Task 4 (rute) + Task 7 (UI).
- AC-4 (konflik → spawn sesi) → Task 4.
- AC-5 (branch belum ada → 409) → Task 1 + Task 4.
- AC-6 (worktree lenyap → 409) → Task 3.
- AC-7 (regresi nol spec) → wrapper `integrate` (Task 1) + jalur Cell spec tak berubah (Task 7); suite penuh (Task 8).

**Placeholder scan:** Bagian `/* tak berubah */` di Task 7 merujuk markup Cell eksisting yang sudah dikutip lengkap di fase audit — bukan TODO; sisipkan blok baru saja. Smoke (Task 8 Step 2) mengikuti memory ops yang sudah ada.

**Type consistency:** `integrateBranch(repoDir, {branch, mergeId}, op, target)` konsisten Task 1↔4. `SessionDTO.branch`/`SessionInfo.branch`/`TerminalSession.branch` selaras Task 2↔7. `ReviewScreen kind` (Task 5) dipakai App (Task 7). `IntegrateDialog {projectId, ownBranch, eyebrow}` (Task 6) dipakai BacklogScreen (Task 6) & Cell (Task 7). `api.sessionReview/sessionReviewFile/sessionIntegrate` + `paths.*` dideklarasi Task 3, dipakai Task 3/4/7.
