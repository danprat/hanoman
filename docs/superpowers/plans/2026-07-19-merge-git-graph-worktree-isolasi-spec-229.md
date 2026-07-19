# Merge via git graph — deterministik di worktree isolasi + sesi claude (SPEC-229)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) atau superpowers:subagent-driven-development untuk mengeksekusi plan ini task-demi-task. Step pakai checkbox (`- [ ]`).

**Goal:** Merge lewat git graph IDE tak lagi buntu: deterministik dulu di worktree isolasi, bersih → fast-forward branch current di working tree utama, konflik → spawn sesi claude di worktree itu. Working tree utama tak pernah dirusak. Mendukung source lokal maupun origin.

**Architecture:** Tambah `mergeIntoCurrent` di `server/src/services/integrate.ts` yang **reuse helper integrate** (`reclaim`, `worktreeForBranch`, `runFinalize`, `finalizeInstruction`) — mirror `POST /specs/:id/integrate` tapi source arbitrer & target = branch current. Endpoint baru `POST /projects/:id/git/merge` (mirror route integrate: clean → 200, conflict → spawn sesi claude + `{status:"conflict", sessionId}`). Frontend git graph memindahkan aksi merge ke jalur baru; conflict → pindah ke Terminal (pola `integrateSpec` di App.tsx). Op git lain tetap lewat `runGitOp` (tak diubah).

**Tech Stack:** Node + TypeScript (Fastify), Prisma tak tersentuh, `execFile` git async, React + TS (Vitest + Testing Library). Referensi keputusan: [ADR-0053](../../../internal/docs/adr/0053-git-graph-merge-worktree-isolasi-sesi-claude.md), doc-of-record [audit SPEC-229](../../../internal/docs/research/audit-spec-229-merge-git-graph-selalu-gagal.md).

## Global Constraints

- TypeScript strict. Semua git lewat `execFile` async + `--end-of-options` sebelum ref/name dari data (cegah flag-injection, SPEC-197).
- Working tree utama **tak pernah** ditinggal rusak (ADR-0002). Merge deterministik jalan di `.worktrees/merge-<branch>` detached; hanya fast-forward-aman yang menyentuh branch current di owner tree.
- Test repo: `env -u NODE_ENV -u DATABASE_URL pnpm -C server test` & `pnpm -C src test` dgn `vitest run --no-file-parallelism`. DB test `hanoman_test`.
- Scope = **merge saja**. checkout/branch/cherry-pick/revert/delete-branch tetap lewat `runGitOp` (ADR-0034), tak diubah.
- Docs tersentuh diperbarui + ter-link (`internal/docs/README.md`) dalam commit yang sama (sudah dilakukan di fase Spec: ADR-0053 + audit doc + index).

---

### Task 1: Service `mergeIntoCurrent` (worktree isolasi + finalize)

**Files:**
- Modify: `server/src/services/integrate.ts` (tambah tipe `GraphMergeResult`, helper `resolveGraphSource`/`deleteMergedBranch`, fungsi `mergeIntoCurrent`)
- Test: `server/test/integrate.test.ts` (tambah blok `describe("mergeIntoCurrent …")`)

**Interfaces:**
- Consumes (private di integrate.ts, sudah ada): `sh`, `ok`, `out`, `refExists`, `reclaim`, `worktreeForBranch`, `runFinalize`, `finalizeInstruction`, `sanitize`, tipe `Finalize`, `join`.
- Produces:
  - `export type GraphMergeResult = { status:"clean"; detail:string } | { status:"conflict"; worktree:string; source:string; target:string; finalize:string } | { status:"error"; code:number; error:string }`
  - `export async function mergeIntoCurrent(repoDir: string, source: string, opts?: { ff?: "no-ff"|"ff-only"; deleteBranch?: string }): Promise<GraphMergeResult>`

- [x] **Step 1: Tulis test yang gagal** — tambahkan di akhir `server/test/integrate.test.ts`:

```ts
import { mergeIntoCurrent } from "../src/services/integrate";
import { execFileSync as efs } from "node:child_process";
const cur = (dir: string) => efs("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
const fileAt = (dir: string, ref: string, path: string) => efs("git", ["-C", dir, "show", `${ref}:${path}`], { encoding: "utf8" });

describe("mergeIntoCurrent — git graph (SPEC-229)", () => {
  it("clean: merge branch spec (source lokal) ke main current → main maju di working tree utama", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1"); // current = main; branch hanoman/spec-1 punya work.txt
    const r = await mergeIntoCurrent(repoDir, "hanoman/spec-1");
    expect(r.status).toBe("clean");
    expect(cur(repoDir)).toBe("main");
    expect(fileAt(repoDir, "main", "work.txt")).toBe("work\n");
    expect(existsSync(`${repoDir}/.worktrees/merge-main`)).toBe(false);
  });
  it("clean: source origin/<b> didukung (merge remote branch)", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = await mergeIntoCurrent(repoDir, "origin/hanoman/spec-1");
    expect(r.status).toBe("clean");
    expect(fileAt(repoDir, "main", "work.txt")).toBe("work\n");
  });
  it("conflict: tinggalkan worktree + finalize, working tree utama TAK rusak", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", {
      base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
    });
    const r = await mergeIntoCurrent(repoDir, "hanoman/spec-1");
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(existsSync(r.worktree)).toBe(true);
      expect(r.target).toBe("local:main");
      expect(r.finalize).toContain("merge --ff-only"); // main ter-checkout → ff di owner
    }
    // working tree utama bersih (tak mid-merge)
    expect(efs("git", ["-C", repoDir, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
  });
  it("HEAD detached → error 409", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    efs("git", ["-C", repoDir, "checkout", "-q", "--detach"]);
    expect(await mergeIntoCurrent(repoDir, "hanoman/spec-1")).toMatchObject({ status: "error", code: 409 });
  });
  it("source tak dikenal → error 400", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    expect(await mergeIntoCurrent(repoDir, "ghost-branch")).toMatchObject({ status: "error", code: 400 });
  });
  it("ff-only divergen → error 409 (bukan conflict, worktree dibersihkan)", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1", { mainAdvance: { "m.txt": "m\n" } }); // divergen non-konflik
    const r = await mergeIntoCurrent(repoDir, "hanoman/spec-1", { ff: "ff-only" });
    expect(r).toMatchObject({ status: "error", code: 409 });
    expect(existsSync(`${repoDir}/.worktrees/merge-main`)).toBe(false);
  });
  it("deleteBranch: branch dihapus (local + origin) setelah merge bersih", async () => {
    const { repoDir } = makeRepoWithSpecBranch("SPEC-1");
    const r = await mergeIntoCurrent(repoDir, "hanoman/spec-1", { deleteBranch: "hanoman/spec-1" });
    expect(r.status).toBe("clean");
    expect(efs("git", ["-C", repoDir, "branch", "--list", "hanoman/spec-1"], { encoding: "utf8" }).trim()).toBe("");
    expect(efs("git", ["-C", repoDir, "ls-remote", "origin", "hanoman/spec-1"], { encoding: "utf8" }).trim()).toBe("");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/integrate.test.ts -t "git graph"`
Expected: FAIL — `mergeIntoCurrent is not a function` / import error.

- [x] **Step 3: Implementasi minimal** — tambahkan di akhir `server/src/services/integrate.ts` (setelah `finalizeInstruction`):

```ts
// SPEC-229 · merge via git graph (ADR-0053). Source arbitrer (branch, origin/<b>, atau sha) → branch
// CURRENT working tree utama, dijalankan di worktree isolasi (pola integrate). Bersih → ff branch
// current di owner tree; konflik → tinggalkan worktree untuk sesi claude. Working tree utama tak
// pernah dirusak. Reuse helper integrate; tak menyentuh `integrate()` yang sudah teruji.
export type GraphMergeResult =
  | { status: "clean"; detail: string }
  | { status: "conflict"; worktree: string; source: string; target: string; finalize: string }
  | { status: "error"; code: number; error: string };

// Coba source apa adanya (sha/ref penuh), lalu refs/heads/<s>, lalu refs/remotes/origin/<s>.
async function resolveGraphSource(repoDir: string, source: string): Promise<string | null> {
  for (const cand of [source, `refs/heads/${source}`, `refs/remotes/origin/${source}`])
    if (await refExists(repoDir, cand)) return cand;
  return null;
}

// Hapus branch yang baru di-merge (best-effort): local -D lalu origin --delete bila ada. Merge sudah
// landed; kegagalan hapus TIDAK me-rollback (beda dari afterMergeDelete git-ide yang gagal-keras).
async function deleteMergedBranch(repoDir: string, branch: string): Promise<void> {
  await sh(repoDir, ["branch", "-D", "--end-of-options", branch]);
  if (await refExists(repoDir, `refs/remotes/origin/${branch}`))
    await sh(repoDir, ["push", "origin", "--delete", "--end-of-options", branch]);
}

export async function mergeIntoCurrent(
  repoDir: string, source: string, opts: { ff?: "no-ff" | "ff-only"; deleteBranch?: string } = {},
): Promise<GraphMergeResult> {
  const current = await out(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!current || current === "HEAD")
    return { status: "error", code: 409, error: "HEAD detached — checkout sebuah branch dulu sebelum merge" };
  const src = await resolveGraphSource(repoDir, source);
  if (!src) return { status: "error", code: 400, error: `source "${source}" tak dikenal` };

  await sh(repoDir, ["fetch", "origin"]); // best-effort; abaikan gagal/offline (timeout 60s)

  const wt = join(repoDir, ".worktrees", `merge-${sanitize(current)}`);
  await reclaim(repoDir, wt);

  // base worktree = tip branch current; source → sha (cegah flag-injection, SPEC-197).
  const baseSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `refs/heads/${current}^{commit}`]);
  if (!(await ok(repoDir, ["worktree", "add", "--detach", "-q", wt, baseSha])))
    return { status: "error", code: 500, error: "gagal membuat worktree merge" };
  const srcSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `${src}^{commit}`]);

  const cmd = ["merge", "--no-edit", ...(opts.ff ? [`--${opts.ff}`] : []), "--end-of-options", srcSha];
  const run = await sh(wt, cmd);

  // Finalisasi = ff branch current di owner (working tree utama). worktreeForBranch(current) = repoDir.
  const finalize: Finalize = { kind: "branch-f", branch: current, checkout: await worktreeForBranch(repoDir, current) };

  if (run.status === 0) {
    const fin = await runFinalize(wt, repoDir, finalize);
    if (fin.ok && opts.deleteBranch) await deleteMergedBranch(repoDir, opts.deleteBranch);
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return fin.ok ? { status: "clean", detail: fin.detail } : { status: "error", code: 409, error: fin.error };
  }

  // non-zero: konflik NYATA (ada file unmerged) vs penolakan bersih (mis. --ff-only divergen).
  const conflicted = (await out(wt, ["ls-files", "--unmerged"])).length > 0;
  if (!conflicted) {
    await sh(wt, ["merge", "--abort"]);                       // no-op bila tak ada state merge
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return { status: "error", code: 409, error: run.stderr.trim() || "merge gagal — tak bisa fast-forward?" };
  }
  // konflik → tinggalkan worktree; route spawn sesi claude
  return { status: "conflict", worktree: wt, source: src, target: `local:${current}`, finalize: finalizeInstruction("merge", finalize) };
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/integrate.test.ts`
Expected: PASS (blok baru + blok integrate lama tetap hijau).

- [x] **Step 5: Commit**

```bash
git add server/src/services/integrate.ts server/test/integrate.test.ts
git commit -m "feat(integrate): mergeIntoCurrent — merge git graph di worktree isolasi (SPEC-229)"
```

---

### Task 2: Route `POST /projects/:id/git/merge` (deterministik → sesi claude)

**Files:**
- Modify: `server/src/routes/ide.ts` (import `mergeIntoCurrent`, `createSession`, `sessionModel`, `basename`; tambah route)
- Test: `server/test/ide.route.test.ts` (tambah kasus merge git graph)

**Interfaces:**
- Consumes: `mergeIntoCurrent` (Task 1); `createSession(projectId, cwd, { id, model, effort, prompt })` (pty.ts); `sessionModel()` → `{ model, effort }` (settings.ts).
- Produces: `POST /projects/:id/git/merge` body `{ source: string; ff?: "no-ff"|"ff-only"; deleteBranch?: string }` → `200 { status:"clean", detail }` | `200 { status:"conflict", sessionId }` | `400`/`404`/`409 { error }`.

- [x] **Step 1: Tulis test yang gagal** — tambahkan di `server/test/ide.route.test.ts` di dalam `describe("ide routes", …)`:

```ts
it("POST /git/merge clean: merge branch spec ke current → 200 {status:clean} (SPEC-229)", async () => {
  await makeProject({ id: "gm1", repoDir: makeRepoWithSpecBranch("gm").repoDir }); // current main + hanoman/gm
  const r = await app.inject({ method: "POST", url: "/api/projects/gm1/git/merge", payload: { source: "hanoman/gm" } });
  expect(r.statusCode).toBe(200);
  expect(r.json().status).toBe("clean");
});
it("POST /git/merge conflict: spawn sesi claude → 200 {status:conflict, sessionId} (SPEC-229)", async () => {
  process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
  await makeProject({ id: "gm2", repoDir: makeRepoWithSpecBranch("gm", {
    base: { "f.txt": "b\n" }, work: { "f.txt": "w\n" }, mainAdvance: { "f.txt": "m\n" } }).repoDir });
  const r = await app.inject({ method: "POST", url: "/api/projects/gm2/git/merge", payload: { source: "hanoman/gm" } });
  expect(r.statusCode).toBe(200);
  expect(r.json().status).toBe("conflict");
  expect(typeof r.json().sessionId).toBe("string");
  killAll();
});
it("POST /git/merge source kosong → 400; project tanpa repoDir → 400 (SPEC-229)", async () => {
  expect((await app.inject({ method: "POST", url: "/api/projects/gm1/git/merge", payload: {} })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: "/api/projects/nodir/git/merge", payload: { source: "main" } })).statusCode).toBe(400);
});
```

(Tambahkan `makeProject({ id: "gm1"/"gm2" })` di `beforeAll` bila lebih rapi; membuat inline di test juga sah karena `makeProject` idempoten per-id unik.)

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/ide.route.test.ts -t "git/merge"`
Expected: FAIL — 404 (route belum ada).

- [x] **Step 3: Implementasi** — di `server/src/routes/ide.ts`:

Ubah import (baris 1-7) menjadi menambah:
```ts
import { basename } from "node:path";
import { createSession } from "../services/pty";
import { sessionModel } from "../services/settings";
import { mergeIntoCurrent } from "../services/integrate";
```
(`listSessions` sudah di-import; pertahankan.)

Tambahkan route di dalam `export default async function (app)`, setelah handler `POST /projects/:id/git`:
```ts
  // SPEC-229 · merge via git graph (ADR-0053): deterministik di worktree isolasi (working tree utama
  // tak pernah dirusak), konflik → spawn sesi claude di worktree itu. Tanpa gerbang sesi aktif —
  // isolasi + ff-aman menggantikan alasan 409 lama. Bentuk response mirror POST /specs/:id/integrate.
  app.post("/projects/:id/git/merge", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { source?: unknown; ff?: unknown; deleteBranch?: unknown };
    if (typeof b?.source !== "string" || !b.source) return reply.code(400).send({ error: "source wajib" });
    if (b.ff !== undefined && b.ff !== "no-ff" && b.ff !== "ff-only") return reply.code(400).send({ error: "ff harus no-ff atau ff-only" });
    if (b.deleteBranch !== undefined && !(typeof b.deleteBranch === "string" && b.deleteBranch)) return reply.code(400).send({ error: "deleteBranch harus string tak kosong" });
    const r = await mergeIntoCurrent(repoDir, b.source, {
      ff: b.ff as "no-ff" | "ff-only" | undefined, deleteBranch: b.deleteBranch as string | undefined });
    if (r.status === "error") return reply.code(r.code).send({ error: r.error });
    if (r.status === "clean") return { status: "clean", detail: r.detail };
    // conflict → sesi claude interaktif di worktree yang tertinggal (never touch main working tree).
    const { model, effort } = await sessionModel();
    const prompt = [
      `hanoman · selesaikan konflik merge \`${r.source}\` ke \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah merge dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      `Merge via git graph project ${id}.`,
    ].join("\n\n");
    const s = createSession(id, r.worktree, { id: basename(r.worktree), model, effort, prompt });
    return { status: "conflict", sessionId: s.id };
  });
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run test/ide.route.test.ts`
Expected: PASS (kasus baru + semua kasus ide lama hijau).

- [x] **Step 5: Commit**

```bash
git add server/src/routes/ide.ts server/test/ide.route.test.ts
git commit -m "feat(ide): route POST /projects/:id/git/merge — deterministik + sesi claude (SPEC-229)"
```

---

### Task 3: Contract shared + client + frontend git graph

**Files:**
- Modify: `shared/src/api.ts` (tambah path `ideGitMerge`)
- Modify: `src/src/api/client.ts` (tipe `GraphMergeResult` + method `ideGitMerge`)
- Modify: `src/src/screens/GitGraph.tsx` (prop `onMerge`; aksi merge di `menuItems`/`act` pindah ke `onMerge`)
- Modify: `src/src/screens/IdeScreen.tsx` (handler `mergeGraph`; props `onToast`/`onGotoTerminal`; teruskan `onMerge` ke `GitGraph`)
- Modify: `src/src/App.tsx` (teruskan `onToast`/`onGotoTerminal` ke `IdeScreen`)
- Test: `src/test/ide-screen.test.tsx` (merge via graph → conflict pindah terminal; error → toast)

**Interfaces:**
- Consumes: route Task 2.
- Produces:
  - shared: `paths.ideGitMerge(id) => \`${API}/projects/${id}/git/merge\``
  - client: `export type GraphMergeResult = { status:"clean"; detail:string } | { status:"conflict"; sessionId:string }` dan `api.ideGitMerge(id, { source, ff?, deleteBranch? }): Promise<GraphMergeResult>`
  - GitGraph prop baru: `onMerge: (source: string, opts?: { ff?: "no-ff"|"ff-only"; deleteBranch?: string }) => Promise<void>`
  - IdeScreen props baru (opsional): `onToast?: (msg: string, tone: "ok"|"warn"|"err"|"info", icon?: string) => void; onGotoTerminal?: (sessionId?: string) => void`

- [x] **Step 1: shared path** — di `shared/src/api.ts` setelah baris `ideGit:` (baris 31) tambah:
```ts
  ideGitMerge: (id: string) => `${API}/projects/${id}/git/merge`, // SPEC-229 · merge git graph isolasi
```

- [x] **Step 2: client method + tipe** — di `src/src/api/client.ts`, dekat `ideGit` (baris ~110) tambah:
```ts
  // SPEC-229 · merge via git graph: deterministik di worktree isolasi; conflict → sesi claude.
  ideGitMerge: (id: string, b: { source: string; ff?: "no-ff" | "ff-only"; deleteBranch?: string }) =>
    j<GraphMergeResult>(paths.ideGitMerge(id), { method: "POST", ...body(b) }),
```
dan dekat `GitOpResult` (baris ~35) tambah tipe:
```ts
export type GraphMergeResult = { status: "clean"; detail: string } | { status: "conflict"; sessionId: string };
```

- [x] **Step 3: GitGraph `onMerge`** — di `src/src/screens/GitGraph.tsx`:

Ubah signature `menuItems` agar terima callback merge terpisah:
```ts
function menuItems(c: GraphCommit, current: string, act: (op: GitOp) => void,
  merge: (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => void): MenuItem[] {
```
Ganti tiga item merge commit + item "Merge <branch> lalu hapus" agar pakai `merge(...)`:
```ts
    { label: "Merge (fast-forward bila bisa)", run: () => merge(c.sha) },
    { label: "Merge tanpa fast-forward", run: () => merge(c.sha, { ff: "no-ff" }) },
    { label: "Merge fast-forward saja", run: () => merge(c.sha, { ff: "ff-only" }) },
```
dan blok `locals.filter((r) => r !== current).map(...)`:
```ts
    ...locals.filter((r) => r !== current).map((r) => ({
      label: `Merge ${r} lalu hapus (local${origins.includes(r) ? " + origin" : ""})`,
      run: () => merge(r, { deleteBranch: r }),
    })),
```
Tambah prop `onMerge` ke komponen `GitGraph`:
```ts
export function GitGraph({ projectId, onRunGit, onMerge, onOpenFile }:
  { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>;
    onMerge: (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => Promise<void>;
    onOpenFile: (path: string, ref: string) => void }) {
```
Tambah handler `mergeAct` di sebelah `act`:
```ts
  async function mergeAct(source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) {
    setMenu(null); await onMerge(source, opts).then(load).catch(() => {});
  }
```
dan pada render menu teruskan `mergeAct`:
```ts
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.c, current, act, mergeAct)} />}
```

- [x] **Step 4: IdeScreen `mergeGraph` + wiring** — di `src/src/screens/IdeScreen.tsx`:

Ubah signature komponen (baris 40-41):
```ts
export function IdeScreen({ projects, projectId, onProject, onToast, onGotoTerminal }:
  { projects: ProjectVM[]; projectId: string; onProject: (id: string) => void;
    onToast?: (msg: string, tone: "ok" | "warn" | "err" | "info", icon?: string) => void;
    onGotoTerminal?: (sessionId?: string) => void }) {
```
Tambah handler dekat `runGit` (baris ~76):
```ts
  async function mergeGraph(source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) {
    try {
      const r = await api.ideGitMerge(projectId, { source, ...opts });
      if (r.status === "conflict") { onGotoTerminal?.(r.sessionId); onToast?.("konflik merge — selesaikan di Terminal", "warn", "git-merge"); }
      else { setViewRef(""); reloadTree(); onToast?.(`merge berhasil · ${r.detail}`, "ok", "git-merge"); }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.("gagal merge" + (code === 409 ? " · cek branch/target" : ""), "err", "x-circle");
      throw e; // GitGraph.mergeAct menelan (sudah ditoast); mencegah reload graph yang salah
    }
  }
```
Teruskan ke `GitGraph` (baris ~169):
```ts
        <GitGraph projectId={projectId} onRunGit={runGit} onMerge={mergeGraph}
          onOpenFile={(p, ref) => { setViewRef(ref); setSelected(p); setTab("explorer"); }} />
```

- [x] **Step 5: App wiring** — di `src/src/App.tsx` render IdeScreen (baris ~705):
```tsx
          : <IdeScreen projects={projectsView} projectId={proj ? proj.id : projectsView[0]!.id}
              onProject={(id) => setProjectId(id)} onToast={showToast}
              onGotoTerminal={(sid) => { if (sid) setFocusSession(sid); setSection("terminal"); }} />)}
```

- [x] **Step 6: Tulis test frontend** — tambahkan di `src/test/ide-screen.test.tsx` (blok baru):
```ts
describe("IdeScreen merge git graph (SPEC-229)", () => {
  beforeEach(() => {
    vi.spyOn(api, "ideGraph").mockResolvedValue({ current: "main", commits: [
      { sha: "aaaaaaa", parents: [], author: "t", at: new Date(0).toISOString(), subject: "c1", refs: ["origin/feat"] },
    ] } as any);
  });
  it("konflik merge → onGotoTerminal(sessionId) + toast", async () => {
    const onGoto = vi.fn(); const onToast = vi.fn();
    vi.spyOn(api, "ideGitMerge").mockResolvedValue({ status: "conflict", sessionId: "merge-main" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onToast={onToast} onGotoTerminal={onGoto} />);
    fireEvent.click(await screen.findByRole("tab", { name: /git graph/i }));
    fireEvent.contextMenu(await screen.findByText("c1"));
    fireEvent.click(await screen.findByText(/Merge \(fast-forward bila bisa\)/i));
    await waitFor(() => expect(api.ideGitMerge).toHaveBeenCalledWith("p1", { source: "aaaaaaa" }));
    await waitFor(() => expect(onGoto).toHaveBeenCalledWith("merge-main"));
  });
  it("merge bersih → toast ok, tanpa navigasi", async () => {
    const onGoto = vi.fn(); const onToast = vi.fn();
    vi.spyOn(api, "ideGitMerge").mockResolvedValue({ status: "clean", detail: "lokal main (ff) → abcdef0" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onToast={onToast} onGotoTerminal={onGoto} />);
    fireEvent.click(await screen.findByRole("tab", { name: /git graph/i }));
    fireEvent.contextMenu(await screen.findByText("c1"));
    fireEvent.click(await screen.findByText(/Merge \(fast-forward bila bisa\)/i));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("merge berhasil"), "ok", "git-merge"));
    expect(onGoto).not.toHaveBeenCalled();
  });
});
```
(Sesuaikan role/nama tab bila `Tabs` merender bukan `role="tab"` — cek komponen `Tabs` di `../src/ds`; bila perlu pakai `screen.getByText("Git Graph")`.)

- [x] **Step 7: Jalankan test frontend + typecheck**

Run: `cd src && npx vitest run test/ide-screen.test.tsx` lalu `pnpm -C src build` (atau `tsc -p src --noEmit`) dan `pnpm -C shared build`.
Expected: PASS + typecheck bersih.

- [x] **Step 8: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/src/screens/GitGraph.tsx src/src/screens/IdeScreen.tsx src/src/App.tsx src/test/ide-screen.test.tsx
git commit -m "feat(git-graph): merge via jalur isolasi + sesi claude, dukung origin (SPEC-229)"
```

---

### Task 4: Verifikasi penuh (suite hijau + smoke API nyata)

**Files:** tak ada perubahan kode; hanya verifikasi. Bila ada yang merah → kembali ke Task terkait (systematic-debugging), jangan lanjut.

- [x] **Step 1: Suite server hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm -C server test -- --no-file-parallelism`
Expected: semua PASS (fokus `integrate.test.ts`, `ide.route.test.ts`, `git-ide.test.ts` tetap hijau — `runGitOp` tak diubah).

- [x] **Step 2: Suite frontend + shared hijau + build**

Run: `pnpm -C shared build && pnpm -C src test -- --no-file-parallelism && pnpm -C src build`
Expected: PASS + build bersih (kontrak path/tipe sinkron).

- [x] **Step 3: Smoke API nyata (boot server + curl)** — pakai DB throwaway ter-migrate (JANGAN hanoman_test; sibling test bisa truncate). Boot server di port bebas, buat project → repo dgn branch spec, panggil endpoint:

```bash
# repo uji dengan origin + branch hanoman/smoke (pola makeRepoWithSpecBranch), current=main
# lalu: curl -sS -XPOST localhost:<port>/api/projects/<id>/git/merge -d '{"source":"hanoman/smoke"}' -H 'content-type: application/json'
# clean → {"status":"clean","detail":"lokal main (ff) → …"}; ulangi dengan repo konflik → {"status":"conflict","sessionId":"merge-main"}
```
Verifikasi: (a) clean → `git -C <repo> show main:work.txt` = work; working tree utama bersih. (b) conflict → response `status:conflict` + `.worktrees/merge-main` ADA + working tree utama `git status --porcelain` KOSONG (tak rusak). (c) source `origin/hanoman/smoke` juga clean.

- [x] **Step 4: Ceklis plan penuh** — pastikan semua `- [ ]` di file ini jadi `- [x]`. (hanoman menahan backlog `executing` selama masih ada `- [ ]`.)

- [x] **Step 5: Commit final (bila ada perubahan doc/plan)**

```bash
git add -A
git commit -m "test(spec-229): verifikasi merge git graph — suite hijau + smoke API"
```

## Self-Review

- **Spec coverage:** "merge via git graph" → Task 3 repoint menu. "jika ada issue atau 409 maka buka sesi claude" → Task 2 conflict spawn; gerbang sesi lama tak berlaku (endpoint terpisah tanpa gate). "prioritas tetap deterministic" → Task 1 git merge di worktree dulu, claude hanya saat konflik. "harus bisa merge local branch dan remote branch" → `resolveGraphSource` (heads + origin) + test origin (Task 1 Step 1, Task 4 Step 3c). Working tree utama tak rusak → Task 1 conflict test `status --porcelain` kosong. ADR-0053 & audit doc → sudah di fase Spec.
- **Placeholder scan:** tak ada TBD/TODO; setiap step berisi kode nyata.
- **Type consistency:** `GraphMergeResult` server (`{status:conflict, worktree, source, target, finalize}`) vs client (`{status:conflict, sessionId}`) sengaja beda — route memetakan worktree→sessionId. `mergeIntoCurrent(repoDir, source, {ff, deleteBranch})` konsisten dari Task 1→2. `onMerge(source, opts)` konsisten GitGraph↔IdeScreen. `paths.ideGitMerge` dipakai client. `basename(r.worktree)` = `merge-<current>` sebagai session id deterministik (re-Start re-attach).
