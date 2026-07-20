# Parity Git Graph (SPEC-233) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beri git graph hanoman parity penuh dengan ekstensi VS Code Git Graph (mhutchie) — seluruh operasi commit/branch/tag/stash/uncommitted, compare, find, detail-diff, kontrol tampilan, integrasi (PR/issue/remote/archive), dan config namespace — langsung dari dashboard.

**Architecture:** Perluas mesin yang ada, bukan bikin baru. Op mutasi non-konflik lewat `POST /projects/:id/git` (`git-ide.ts` `GitOp`/`gitArgs`/`runGitOp`), digerbang sesi+force untuk yang menyentuh working tree (`touchesTree`). Op rawan-konflik (rebase/pull/drop) lewat worktree isolasi di `integrate.ts` (pola `mergeIntoCurrent`), konflik → sesi claude. Read (status/stashes/compare/search/commit-file) diturunkan live dari git tiap request (ADR-0018). Preferensi tampilan lewat `CONFIG_REGISTRY` (ADR-0049). Reuse `DiffView`/`file-tree.tsx`/`ReviewScreen` untuk render.

**Tech Stack:** Node+TS (Fastify) server · React+TS (Vite) client · `execFile` git · Prisma (tak ada skema baru) · vitest (`--no-file-parallelism`) · fixture `server/test/factory.ts`.

## Global Constraints

- TypeScript strict; test tiap logika orkestrasi git.
- Semua argumen git yang berasal dari data didahului `--end-of-options` (flag-injection guard, SPEC-197).
- Read git diturunkan tiap request — tanpa cache, tanpa kolom/model Prisma baru (ADR-0011/0018). Tanpa migration.
- Mutasi yang menyentuh working tree: gate sesi aktif + escape `force` (ADR-0034). Op rawan-konflik: worktree isolasi + handoff sesi claude (ADR-0053). Tak pernah mutasi working tree utama diam-diam.
- Docs tersentuh diperbarui **dalam commit yang sama** & ter-link di `internal/docs/README.md`. Kontrak di `internal/docs/architecture/api-contract.md`.
- Test: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism` (hindari env prod). Tiap PR juga diuji nyata: boot server + curl endpoint tersentuh.
- Type `GitOp`/`GraphCommit`/`CommitDetail` diduplikasi di `server/src/services/git-ide.ts` DAN `src/src/api/client.ts` — perbarui **kedua** tempat selaras.
- Gaya kode: padat, komentar singkat berbahasa Indonesia sesuai file sekitar.

---

## Task 0 (PR0): Fondasi — ADR-0055 + kerangka kontrak

**Files:**
- Create: `internal/docs/adr/0055-git-graph-parity-op-taxonomy.md`
- Modify: `internal/docs/README.md` (link ADR-0055), `internal/docs/architecture/api-contract.md` (blok IDE Visual: daftar endpoint baru sebagai kontrak yang akan diisi)

**Interfaces:**
- Produces: taksonomi op (ref-only vs tree-touching vs conflict-prone), `touchesTree` contract, keputusan "tanpa skema baru".

- [ ] **Step 1: Tulis ADR-0055** — status accepted, tanggal 2026-07-20. Isi: keputusan full-parity; tiga kelas eksekusi op; endpoint read baru diturunkan live; preferensi via CONFIG_REGISTRY bukan tabel; gravatar default off; interactive-rebase → sesi claude. Konteks: gap vs mhutchie. Konsekuensi: `GitOp` union membengkak; `POST /git` dapat `touchesTree` gate; 3 endpoint isolasi baru mirror `/git/merge`.
- [ ] **Step 2: Link di README index** — tambah baris `- [0055 — Git graph parity: taksonomi op + eksekusi berlapis](adr/0055-git-graph-parity-op-taxonomy.md)` di seksi adr, dan verifikasi nomor belum dipakai sibling (`git branch -a` enumerasi ulang; bila 0055 bentrok, naikkan).
- [ ] **Step 3: Sisipkan kerangka kontrak** di `api-contract.md` blok `## IDE Visual` — tambahkan daftar endpoint baru (status/stashes/remotes/commit-file/compare/search/archive/git-rebase/git-pull/git-drop + op tambahan `POST /git`) dengan catatan "(SPEC-233)". (Detail tiap baris diisi di PR terkait.)
- [ ] **Step 4: Commit** — `git add internal/docs/adr/0055-*.md internal/docs/README.md internal/docs/architecture/api-contract.md && git commit -m "docs(spec-233): ADR-0055 taksonomi op git graph parity + kerangka kontrak"`

---

## Task 1 (PR1): Commit menu — reset + copy hash/subject

**Files:**
- Modify: `server/src/services/git-ide.ts` (union `GitOp`, `gitArgs`, `validateGitOp`, `touchesTree` baru)
- Modify: `server/src/routes/ide.ts` (gate pakai `touchesTree`)
- Modify: `src/src/api/client.ts` (union `GitOp` selaras)
- Modify: `src/src/screens/GitGraph.tsx` (menu item + clipboard)
- Test: `server/test/git-ide.test.ts`, `server/test/ide.route.test.ts` (bila belum ada, buat)

**Interfaces:**
- Produces: `GitOp` += `{ op:"reset"; sha:string; mode:"soft"|"mixed"|"hard" }`; `export function touchesTree(op: GitOp): boolean`.

- [ ] **Step 1: Failing test — reset** di `git-ide.test.ts`:
```ts
describe("git-ide reset (SPEC-233)", () => {
  const headMsg = (dir: string) => spawnSync("git", ["log", "-1", "--format=%s"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  it("reset --soft memindah HEAD, jaga index+worktree", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "kedua", changes: { "a.txt": "2" } }]);
    const root = (await listGraph(dir)).commits[1]!.sha;
    const r = await runGitOp(dir, { op: "reset", sha: root, mode: "soft" });
    expect(r.ok).toBe(true);
    expect(headMsg(dir)).toBe("base");
    expect(readFileSync(`${dir}/a.txt`, "utf8")).toBe("2"); // worktree utuh
  });
  it("reset --hard membuang perubahan worktree", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "kedua", changes: { "a.txt": "2" } }]);
    const root = (await listGraph(dir)).commits[1]!.sha;
    const r = await runGitOp(dir, { op: "reset", sha: root, mode: "hard" });
    expect(r.ok).toBe(true);
    expect(readFileSync(`${dir}/a.txt`, "utf8")).toBe("1"); // kembali ke base
  });
  it("validateGitOp reset butuh sha + mode valid", () => {
    expect(validateGitOp({ op: "reset", sha: "abc123" })).toBeTruthy();
    expect(validateGitOp({ op: "reset", sha: "abc123", mode: "bogus" })).toBeTruthy();
    expect(validateGitOp({ op: "reset", sha: "abc123", mode: "hard" })).toBeNull();
  });
});
```
- [ ] **Step 2: Run → fail** — `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server test -- --no-file-parallelism git-ide`. Expected: FAIL (reset tak dikenal).
- [ ] **Step 3: Implement di `git-ide.ts`** — tambah ke union: `| { op: "reset"; sha: string; mode: "soft" | "mixed" | "hard" }`. `gitArgs`: `case "reset": return ["reset", `--${op.mode}`, "--end-of-options", op.sha];`. `validateGitOp`: `case "reset": { const e = need("sha"); if (e) return e; return op.mode==="soft"||op.mode==="mixed"||op.mode==="hard" ? null : "mode harus soft/mixed/hard"; }`. Tambah `export function touchesTree(op: GitOp): boolean { switch (op.op) { case "tag": case "delete-tag": case "push-tag": case "rename-branch": case "push-branch": case "fetch": case "stash-drop": return false; default: return true; } }` (op yang belum ada di union akan ditambah PR berikutnya; default true aman).
- [ ] **Step 4: Route gate pakai touchesTree** di `ide.ts` `POST /projects/:id/git`: ganti `if (!op.force) {` → `if (!op.force && touchesTree(op)) {` dan import `touchesTree`.
- [ ] **Step 5: Run → pass** — ulangi Step 2 command. Expected: PASS.
- [ ] **Step 6: Client** — di `src/src/api/client.ts` tambah `| { op: "reset"; sha: string; mode: "soft"|"mixed"|"hard"; force?: boolean }` ke `GitOp`. Di `GitGraph.tsx` `menuItems`, tambah item: `{ label: "Reset current → sini (mixed)", run: () => act({ op:"reset", sha:c.sha, mode:"mixed" }) }` plus soft & hard varian; dan clipboard: `{ label: "Copy hash", run: () => navigator.clipboard?.writeText(c.sha) }`, `{ label: "Copy subject", run: () => navigator.clipboard?.writeText(c.subject) }`.
- [ ] **Step 7: Build client + typecheck** — `pnpm --filter @hanoman/web build` (atau `tsc -b`). Expected: sukses.
- [ ] **Step 8: Real API test** — boot server (lihat "Boot & curl" di akhir plan), buat repo fixture project, `curl -XPOST .../projects/<id>/git -d '{"op":"reset","sha":"<root>","mode":"soft","force":true}'` → `{ ok:true, current:... }`.
- [ ] **Step 9: Commit** — `git add server/src/services/git-ide.ts server/src/routes/ide.ts src/src/api/client.ts src/src/screens/GitGraph.tsx server/test/git-ide.test.ts && git commit -m "feat(spec-233): reset commit + copy hash/subject + touchesTree gate (PR1)"`

---

## Task 2 (PR2): Tag — buat / hapus / push / view / copy

**Files:**
- Modify: `server/src/services/git-ide.ts` (op `tag`/`delete-tag`/`push-tag`, run functions, `GraphCommit.tags`), `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx`
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Produces: `GitOp` += `tag {name,message?,at?,push?}` | `delete-tag {name,remote?}` | `push-tag {name}`; `GraphCommit.tags: string[]`.

- [ ] **Step 1: Failing test**:
```ts
describe("git-ide tag (SPEC-233)", () => {
  const tags = (dir: string) => spawnSync("git", ["tag", "--list"], { cwd: dir, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  it("tag lightweight di commit + graph memuat tags terpisah", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const head = (await listGraph(dir)).commits[0]!.sha;
    const r = await runGitOp(dir, { op: "tag", name: "v1", at: head });
    expect(r.ok).toBe(true);
    expect(tags(dir)).toContain("v1");
    const g = await listGraph(dir);
    expect(g.commits[0]!.tags).toContain("v1");
    expect(g.commits[0]!.refs).not.toContain("v1"); // tag tak bocor ke refs branch
  });
  it("tag annotated menyimpan pesan", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const r = await runGitOp(dir, { op: "tag", name: "v2", message: "rilis dua" });
    expect(r.ok).toBe(true);
    expect(spawnSync("git", ["tag", "-n", "--list", "v2"], { cwd: dir, encoding: "utf8" }).stdout).toMatch(/rilis dua/);
  });
  it("delete-tag menghapus tag", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    await runGitOp(dir, { op: "tag", name: "v1" });
    const r = await runGitOp(dir, { op: "delete-tag", name: "v1" });
    expect(r.ok).toBe(true);
    expect(tags(dir)).not.toContain("v1");
  });
  it("validateGitOp tag/delete-tag/push-tag butuh name", () => {
    expect(validateGitOp({ op: "tag" })).toBeTruthy();
    expect(validateGitOp({ op: "tag", name: "v1" })).toBeNull();
    expect(validateGitOp({ op: "delete-tag", name: "v1" })).toBeNull();
    expect(validateGitOp({ op: "push-tag", name: "v1" })).toBeNull();
  });
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** — union tambah tiga op. `gitArgs`: `case "tag": return ["tag", ...(op.message ? ["-a","-m",op.message] : []), "--end-of-options", op.name, ...(op.at ? [op.at] : [])]; case "delete-tag": return ["tag","-d","--end-of-options",op.name]; case "push-tag": return ["push","origin","--end-of-options",op.name];`. `runGitOp`: setelah `tag` sukses, bila `op.push` jalankan `push origin <name>` (pola multi-step spt `afterMergeDelete` — tulis helper `runTagOp` bila perlu untuk `tag+push` & `delete-tag+remote`). `delete-tag` dengan `remote:true` → tambah `push origin --delete <name>`. `validateGitOp`: `case "tag": case "delete-tag": case "push-tag": return need("name");`. `listGraph`: pisahkan tag dari refs — di parser `%D`, entri berprefix `tag: ` masuk `tags`, sisanya `refs`; tambah `tags: string[]` ke `GraphCommit` type & objek.
- [ ] **Step 4: Run → pass**.
- [ ] **Step 5: Client** — `client.ts`: tambah tiga op ke `GitOp` + `tags:string[]` ke `GraphCommit`. `GitGraph.tsx`: (a) menu commit += "Add tag…" (`window.prompt` nama, prompt pesan opsional, checkbox push via confirm) → `act({op:"tag",...})`; (b) render `c.tags` sebagai pill terpisah (ikon tag, warna leaf) di baris; (c) tambah handler klik-kanan pill tag → mini-menu Delete/Push/Copy (fase awal boleh reuse `Menu` dengan target tag).
- [ ] **Step 6: Real API test** — curl `POST /git {op:"tag",name:"v1",message:"x"}` lalu `GET /graph` cek `tags:["v1"]`.
- [ ] **Step 7: Commit** — `feat(spec-233): tag buat/hapus/push + tags terpisah di graph (PR2)`

---

## Task 3 (PR3): Uncommitted changes — status + baris graph + reset-worktree/clean

**Files:**
- Modify: `server/src/services/git-ide.ts` (op `reset-worktree`/`clean`, `repoStatus`), `server/src/routes/ide.ts` (`GET /status`), `shared/src/api.ts` (`ideStatus`), `src/src/api/client.ts` (`repoStatus`, ops), `src/src/screens/GitGraph.tsx` (baris uncommitted)
- Test: `server/test/git-ide.test.ts`, `server/test/ide.route.test.ts`

**Interfaces:**
- Produces: `export async function repoStatus(repoDir): Promise<RepoStatus>` where `RepoStatus = { branch:string; ahead:number; behind:number; staged:string[]; unstaged:string[]; untracked:string[]; clean:boolean }`; `GitOp` += `reset-worktree {mode:"mixed"|"hard"}` | `clean {directories?:boolean; ignored?:boolean}`; endpoint `GET /projects/:id/status`.

- [ ] **Step 1: Failing test (service)**:
```ts
describe("git-ide status + worktree ops (SPEC-233)", () => {
  it("repoStatus melaporkan untracked + unstaged + clean flag", async () => {
    const dir = makeRepoWithBranches(); // README.md ter-commit, main
    writeFileSync(`${dir}/README.md`, "berubah"); writeFileSync(`${dir}/baru.txt`, "x");
    const s = await repoStatus(dir);
    expect(s.branch).toBe("main");
    expect(s.clean).toBe(false);
    expect(s.untracked).toContain("baru.txt");
    expect(s.unstaged).toContain("README.md");
  });
  it("reset-worktree hard mengembalikan file terlacak", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/README.md`, "berubah");
    const r = await runGitOp(dir, { op: "reset-worktree", mode: "hard" });
    expect(r.ok).toBe(true);
    expect(readFileSync(`${dir}/README.md`, "utf8")).toBe("x");
  });
  it("clean membuang untracked", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/sampah.txt`, "x");
    const r = await runGitOp(dir, { op: "clean", directories: true });
    expect(r.ok).toBe(true);
    expect(existsSync(`${dir}/sampah.txt`)).toBe(false);
  });
});
```
(import `existsSync` dari `node:fs`).
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** — `repoStatus`: `git status --porcelain=v1 -z -b`, parse header `## branch...ahead N, behind M`, XY code per entri (`??`=untracked; index-col=staged; worktree-col=unstaged). union tambah dua op; `gitArgs`: `case "reset-worktree": return ["reset", `--${op.mode}`]; case "clean": return ["clean","-f", ...(op.directories?["-d"]:[]), ...(op.ignored?["-x"]:[])];`. `validateGitOp`: `case "reset-worktree": return op.mode==="mixed"||op.mode==="hard"?null:"mode harus mixed/hard"; case "clean": return null;`.
- [ ] **Step 4: Route** — `app.get("/projects/:id/status", ...)` mirror pola `/tree` (repoOf → 404), return `repoStatus(repoDir)` (repoDir null → `{ clean:true, ... }`). Tambah `ideStatus` di `shared/src/api.ts`.
- [ ] **Step 5: Run → pass** (service test + route test inject).
- [ ] **Step 6: Client** — `client.ts`: `repoStatus(id)` + ops. `GitGraph.tsx`: fetch status saat load; bila `!clean`, render baris teratas "● Uncommitted changes" (lingkaran terbuka: `<circle fill="none" stroke=...>`), klik → panggil `onOpenUncommitted()` (host buka diff working tree via ReviewScreen kind baru atau Explorer); menu baris: Reset (mixed/hard) → `act`, Clean untracked → `act`, Stash… (PR4).
- [ ] **Step 7: Real API test** — kotori repo, `GET /status` → `clean:false`; `POST /git {op:"clean",directories:true}` → untracked hilang.
- [ ] **Step 8: Commit** — `feat(spec-233): status + baris uncommitted + reset-worktree/clean (PR3)`

---

## Task 4 (PR4): Stash penuh

**Files:**
- Modify: `server/src/services/git-ide.ts` (`listStashes`, ops stash), `server/src/routes/ide.ts` (`GET /stashes`), `shared/src/api.ts`, `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx`
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Produces: `export async function listStashes(repoDir): Promise<Stash[]>` (`Stash = { ref:string; message:string; at:string }`); `GitOp` += `stash {message?,includeUntracked?}` | `stash-apply {ref,index?}` | `stash-pop {ref,index?}` | `stash-drop {ref}` | `stash-branch {ref,name}`; `GET /projects/:id/stashes`.

- [ ] **Step 1: Failing test** — siklus create→list→apply→drop:
```ts
describe("git-ide stash (SPEC-233)", () => {
  it("stash create menyimpan & bersihkan worktree, list menampilkan, apply mengembalikan", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/README.md`, "wip");
    expect((await runGitOp(dir, { op: "stash", message: "kerjaan" })).ok).toBe(true);
    expect(readFileSync(`${dir}/README.md`, "utf8")).toBe("x"); // worktree bersih
    const list = await listStashes(dir);
    expect(list[0]!.ref).toBe("stash@{0}");
    expect(list[0]!.message).toMatch(/kerjaan/);
    expect((await runGitOp(dir, { op: "stash-apply", ref: "stash@{0}" })).ok).toBe(true);
    expect(readFileSync(`${dir}/README.md`, "utf8")).toBe("wip");
  });
  it("stash-branch membuat branch dari stash", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/README.md`, "wip"); await runGitOp(dir, { op: "stash" });
    const r = await runGitOp(dir, { op: "stash-branch", ref: "stash@{0}", name: "wip-b" });
    expect(r.ok).toBe(true); expect(r.current).toBe("wip-b");
  });
  it("validateGitOp stash-* butuh ref/name sesuai", () => {
    expect(validateGitOp({ op: "stash" })).toBeNull();
    expect(validateGitOp({ op: "stash-apply" })).toBeTruthy();
    expect(validateGitOp({ op: "stash-apply", ref: "stash@{0}" })).toBeNull();
    expect(validateGitOp({ op: "stash-branch", ref: "stash@{0}" })).toBeTruthy();
    expect(validateGitOp({ op: "stash-branch", ref: "stash@{0}", name: "b" })).toBeNull();
  });
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** — `listStashes`: `git stash list --format=%gd\x1f%s\x1f%aI` split. union + `gitArgs`: `stash`→`["stash","push",...(includeUntracked?["-u"]:[]),...(message?["-m",message]:[])]`; `stash-apply`→`["stash","apply",...(index?["--index"]:[]),"--end-of-options",ref]`; `stash-pop`→`["stash","pop",...(index?["--index"]:[]),"--end-of-options",ref]`; `stash-drop`→`["stash","drop","--end-of-options",ref]`; `stash-branch`→`["stash","branch","--end-of-options",name,ref]`. `validateGitOp`: stash→null; apply/pop/drop→`need("ref")`; stash-branch→`need("ref")||need("name")`.
- [ ] **Step 4: Route** — `GET /projects/:id/stashes` → `listStashes`. `shared/src/api.ts` `ideStashes`.
- [ ] **Step 5: Run → pass**.
- [ ] **Step 6: Client** — `client.ts` ops + `ideStashes`. `GitGraph.tsx`: muat stashes; render sebagai baris/badge; menu: Apply/Pop/Drop/Create-branch/Copy-name. "Stash…" dari baris uncommitted (PR3) → `act({op:"stash",message})`.
- [ ] **Step 7: Real API test** — kotori repo, `POST /git {op:"stash"}`, `GET /stashes` → 1 entri, `POST /git {op:"stash-pop",ref:"stash@{0}"}`.
- [ ] **Step 8: Commit** — `feat(spec-233): stash penuh (create/apply/pop/drop/branch) (PR4)`

---

## Task 5 (PR5): Branch ops — rename / push / fetch + menu ref-branch

**Files:**
- Modify: `server/src/services/git-ide.ts` (op `rename-branch`/`push-branch`/`fetch`), `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx` (menu ref-branch)
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Produces: `GitOp` += `rename-branch {from,to}` | `push-branch {name,setUpstream?,force?}` | `fetch {prune?,pruneTags?}`.

- [ ] **Step 1: Failing test**:
```ts
describe("git-ide branch ops (SPEC-233)", () => {
  const branches = (dir: string) => spawnSync("git", ["branch", "--format=%(refname:short)"], { cwd: dir, encoding: "utf8" }).stdout.trim().split("\n");
  it("rename-branch mengganti nama", async () => {
    const dir = makeRepoWithBranches("dev");
    const r = await runGitOp(dir, { op: "rename-branch", from: "dev", to: "develop" });
    expect(r.ok).toBe(true);
    expect(branches(dir)).toContain("develop"); expect(branches(dir)).not.toContain("dev");
  });
  it("push-branch ke origin memperbarui remote", async () => {
    const { repoDir } = makeRepoWithSpecBranch("pb"); // punya origin
    const g = (...a: string[]) => spawnSync("git", a, { cwd: repoDir, encoding: "utf8" });
    g("checkout", "-q", "-b", "extra"); writeFileSync(`${repoDir}/e.txt`, "e"); g("add", "-A"); g("commit", "-qm", "e");
    const r = await runGitOp(repoDir, { op: "push-branch", name: "extra", setUpstream: true });
    expect(r.ok).toBe(true);
    expect(spawnSync("git", ["ls-remote", "origin", "extra"], { cwd: repoDir, encoding: "utf8" }).stdout).toMatch(/extra/);
  });
  it("fetch prune tak melempar", async () => {
    const { repoDir } = makeRepoWithSpecBranch("fp");
    expect((await runGitOp(repoDir, { op: "fetch", prune: true })).ok).toBe(true);
  });
  it("validateGitOp rename/push/fetch", () => {
    expect(validateGitOp({ op: "rename-branch", from: "a" })).toBeTruthy();
    expect(validateGitOp({ op: "rename-branch", from: "a", to: "b" })).toBeNull();
    expect(validateGitOp({ op: "push-branch", name: "x" })).toBeNull();
    expect(validateGitOp({ op: "fetch" })).toBeNull();
  });
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** — union + `gitArgs`: `rename-branch`→`["branch","-m","--end-of-options",op.from,op.to]`; `push-branch`→`["push",...(op.setUpstream?["-u"]:[]),...(op.force?["--force-with-lease"]:[]),"origin","--end-of-options",op.name]`; `fetch`→`["fetch","--all",...(op.prune?["--prune"]:[]),...(op.pruneTags?["--prune-tags"]:[])]`. `validateGitOp`: rename→`need("from")||need("to")`; push-branch→`need("name")`; fetch→null. (Ketiganya `touchesTree=false` — sudah di PR1.)
- [ ] **Step 4: Run → pass**.
- [ ] **Step 5: Client** — `client.ts` ops. `GitGraph.tsx`: buat **menu ref-branch** — bungkus tiap pill branch (`c.refs`) dengan `onContextMenu` yang membuka `Menu` berisi: Checkout, Rename… (`prompt`), Delete (local/remote/both — pindah item dari menu commit ke sini), Merge into current (`merge`), Push…, Copy name. Toolbar `IdeScreen.tsx`: tombol "Fetch" → `runGit({op:"fetch",prune:true})`.
- [ ] **Step 6: Real API test** — `POST /git {op:"rename-branch",from,to}`, `GET /branches` verifikasi.
- [ ] **Step 7: Commit** — `feat(spec-233): rename/push/fetch branch + menu ref-branch (PR5)`

---

## Task 6 (PR6): Rebase / pull / drop — isolasi + konflik→claude

**Files:**
- Modify: `server/src/services/integrate.ts` (`rebaseOntoCurrent`, `pullIntoCurrent`, `dropCommit`)
- Modify: `server/src/routes/ide.ts` (`POST /git/rebase`, `/git/pull`, `/git/drop`)
- Modify: `shared/src/api.ts`, `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx`, `src/src/screens/IdeScreen.tsx`
- Test: `server/test/integrate.test.ts`

**Interfaces:**
- Consumes: pola `mergeIntoCurrent` (`integrate.ts:189`) → `GraphMergeResult = {status:"clean";detail} | {status:"conflict";...worktree,source,target,finalize} | {status:"error";code;error}`.
- Produces: `rebaseOntoCurrent(repoDir, onto): Promise<GraphMergeResult>`, `pullIntoCurrent(repoDir, source, {ff?}): Promise<GraphMergeResult>`, `dropCommit(repoDir, sha): Promise<GraphMergeResult>`. Endpoint balas `{status:"clean",detail}` | `{status:"conflict",sessionId}` mirror `/git/merge`.

- [ ] **Step 1: Failing test**:
```ts
describe("integrate rebase/drop current (SPEC-233)", () => {
  it("rebaseOntoCurrent clean memindah branch ke atas target", async () => {
    // main maju 1 (base.txt), branch dev bercabang dari base lalu maju 1 (dev.txt) → rebase dev onto main bersih
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/dev.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev1");
    g("checkout", "-q", "main"); writeFileSync(`${dir}/base2.txt`, "b"); g("add", "-A"); g("commit", "-qm", "main1");
    g("checkout", "-q", "dev");
    const r = await rebaseOntoCurrent(dir, "main");
    expect(r.status).toBe("clean");
    // dev sekarang berisi base2.txt (dari main) + dev.txt
    expect(existsSync(`${dir}/base2.txt`)).toBe(true);
  });
  it("dropCommit clean menghapus commit dari branch", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, [{ msg: "buang", changes: { "buang.txt": "x" } }, { msg: "simpan", changes: { "simpan.txt": "y" } }]);
    const mid = (await listGraph(dir)).commits[1]!.sha; // "buang"
    const r = await dropCommit(dir, mid);
    expect(r.status).toBe("clean");
    expect(existsSync(`${dir}/buang.txt`)).toBe(false);
    expect(existsSync(`${dir}/simpan.txt`)).toBe(true);
  });
  it("rebase konflik → status conflict + worktree tersisa", async () => {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/README.md`, "dev"); g("add", "-A"); g("commit", "-qm", "dev");
    g("checkout", "-q", "main"); writeFileSync(`${dir}/README.md`, "main"); g("add", "-A"); g("commit", "-qm", "main");
    g("checkout", "-q", "dev");
    const r = await rebaseOntoCurrent(dir, "main");
    expect(r.status).toBe("conflict");
  });
});
```
(import `rebaseOntoCurrent, dropCommit` dari `../src/services/integrate`).
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement `rebaseOntoCurrent`** di `integrate.ts` — mirror `mergeIntoCurrent`: tolak detached HEAD; simpan `current` branch; buat worktree isolasi `.worktrees/rebase-<current>` di tip current; `git rebase --end-of-options <ontoSha>`; deteksi konflik via `git status`/exit; bersih → `runFinalize`-style pindahkan `current` ref: `git -C repoDir branch -f <current> <rebasedSha>` bila `current` tak checked-out-dirty, else ff di owner (reuse logika `runFinalize`/`branch -f`); konflik → sisakan worktree + kembalikan `{status:"conflict",worktree,source,target,finalize}` dgn finalize instruksi push/branch-f. `dropCommit`: `git rebase --onto <sha>^ <sha> <current>` pola serupa. `pullIntoCurrent`: `git fetch origin <source>` lalu merge `FETCH_HEAD`/`origin/<source>` (reuse `mergeIntoCurrent` internal dengan ff opsi). Ekstrak helper bersama `runIsolatedReplay(repoDir, current, buildWt, gitCmd)` bila menekan duplikasi.
- [ ] **Step 4: Run → pass**.
- [ ] **Step 5: Routes** — tiga endpoint mirror `/git/merge` (ide.ts:85): validasi body (`onto`/`source`/`sha` wajib), panggil fungsi, `status:"error"`→code, `clean`→`{status,detail}`, `conflict`→spawn `createSession` di `r.worktree` (prompt "selesaikan konflik rebase/pull/drop …") → `{status:"conflict",sessionId}`. `shared/src/api.ts`: `ideGitRebase`/`ideGitPull`/`ideGitDrop`.
- [ ] **Step 6: Client** — `client.ts` methods + `GraphMergeResult`. `GitGraph.tsx`: menu commit += "Rebase current → sini" (`onRebase(c.sha)`), "Drop commit" (`onDrop(c.sha)`); menu ref-branch += "Rebase current → branch"; menu remote/ref origin += "Pull into current". `IdeScreen.tsx`: handler `rebaseGraph/pullGraph/dropGraph` pola `mergeGraph` (konflik → `onGotoTerminal(sessionId)` + toast).
- [ ] **Step 7: Real API test** — siapkan repo divergen, `POST /git/rebase {onto:"main"}` → `clean` atau `conflict` + sessionId.
- [ ] **Step 8: Commit** — `feat(spec-233): rebase/pull/drop isolasi + handoff sesi claude (PR6)`

---

## Task 7 (PR7): Commit detail — diff per file + tree/flat + view-at-rev + signature + links

**Files:**
- Modify: `server/src/services/git-ide.ts` (`commitFileDiff`, `commitDetail` += `signed`/committer), `server/src/routes/ide.ts` (`GET /commit/:sha/file`), `shared/src/api.ts`, `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx`
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Produces: `export async function commitFileDiff(repoDir, sha, path): Promise<ReviewFile | null>`; `CommitDetail` += `signed:boolean; committer:string; committedAt:string`; `GET /projects/:id/commit/:sha/file?path=`.

- [ ] **Step 1: Failing test**:
```ts
describe("git-ide commit detail diff (SPEC-233)", () => {
  it("commitFileDiff mengembalikan diff satu file vs parent", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "satu\n" }, [{ msg: "ubah", changes: { "a.txt": "dua\n" } }]);
    const head = (await listGraph(dir)).commits[0]!.sha;
    const f = await commitFileDiff(dir, head, "a.txt");
    expect(f!.diff).toMatch(/-satu/); expect(f!.diff).toMatch(/\+dua/);
  });
  it("commitDetail memuat flag signed (false utk unsigned)", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const head = (await listGraph(dir)).commits[0]!.sha;
    expect((await commitDetail(dir, head))!.signed).toBe(false);
  });
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** — `commitFileDiff`: `git show <sha> --format= --no-renames -- <path>` untuk diff + `git show <sha>:<path>` untuk content (reuse guard `repoAbsPath`, truncation 256KB pola `reviewFile`). `commitDetail` fmt tambah `%G?` (signed = bukan "N"), `%cn`/`%cI` (committer). Route `GET /commit/:sha/file` mirror `/specs/:id/review/*path`.
- [ ] **Step 4: Run → pass**.
- [ ] **Step 5: Client** — `client.ts`: `ideCommitFile(id,sha,path)` + field baru `CommitDetail`. `GitGraph.tsx` panel detail: (a) toggle tree/flat (reuse `buildFileTree`/`TreeRow` dari `file-tree.tsx`); (b) klik file → tampil `DiffView` (impor dari `ReviewScreen` — ekstrak `DiffView` ke `file-tree.tsx` atau modul `diff-view.tsx` agar reusable) dengan tab Diff|Source; (c) aksi per-file: Open (existing `onOpenFile`), View-at-revision (`onOpenFile(path, sha)`), Copy abs/rel path (clipboard); (d) badge signature; (e) body: linkify URL (`/https?:\/\/\S+/`) + parent-hash + issue (pattern config PR11).
- [ ] **Step 6: Real API test** — `GET /commit/<sha>/file?path=a.txt` → diff berisi ±.
- [ ] **Step 7: Commit** — `feat(spec-233): commit detail diff/tree/signature/links (PR7)`

---

## Task 8 (PR8): Compare dua commit

**Files:**
- Modify: `server/src/services/git-ide.ts` (`compareCommits`, `compareFile`), `server/src/routes/ide.ts` (`GET /compare`, `/compare/file`), `shared/src/api.ts`, `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx`
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Produces: `compareCommits(repoDir, from, to): Promise<{from,to,changed:ChangedFile[]}>`, `compareFile(repoDir, from, to, path): Promise<ReviewFile|null>`; `GET /projects/:id/compare?from=&to=`, `.../compare/file?from=&to=&path=`.

- [ ] **Step 1: Failing test**:
```ts
describe("git-ide compare (SPEC-233)", () => {
  it("compareCommits mendaftar file yang beda antar dua commit", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "c2", changes: { "b.txt": "2" } }, { msg: "c3", changes: { "c.txt": "3" } }]);
    const cs = (await listGraph(dir)).commits; const from = cs[2]!.sha, to = cs[0]!.sha;
    const r = await compareCommits(dir, from, to);
    expect(r.changed.map((c) => c.path).sort()).toEqual(["b.txt", "c.txt"]);
  });
  it("compareFile mengembalikan diff terarah", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "satu\n" }, [{ msg: "c2", changes: { "a.txt": "dua\n" } }]);
    const cs = (await listGraph(dir)).commits;
    const f = await compareFile(dir, cs[1]!.sha, cs[0]!.sha, "a.txt");
    expect(f!.diff).toMatch(/\+dua/);
  });
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** — `compareCommits`: `git diff --numstat -z --no-renames <from> <to>` + `--name-status` (reuse pola `changedOf`/`changedFiles`, gate sha hex). `compareFile`: `git diff <from> <to> -- <path>` + content `git show <to>:<path>`. Routes mirror commit-file.
- [ ] **Step 4: Run → pass**.
- [ ] **Step 5: Client** — `client.ts`: `ideCompare`, `ideCompareFile`. `GitGraph.tsx`: state `compareFrom`; Ctrl/Cmd-klik commit → set `compareFrom`, klik commit kedua → mode Compare (banner + panel file dari `ideCompare` + `DiffView`), Esc keluar.
- [ ] **Step 6: Real API test** — `GET /compare?from=<a>&to=<b>` → changed list.
- [ ] **Step 7: Commit** — `feat(spec-233): compare dua commit (PR8)`

---

## Task 9 (PR9): Find / search commit

**Files:**
- Modify: `server/src/services/git-ide.ts` (`searchCommits`), `server/src/routes/ide.ts` (`GET /graph/search`), `shared/src/api.ts`, `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx`
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Produces: `searchCommits(repoDir, q, by): Promise<string[]>` (by ∈ `all|message|author|hash`); `GET /projects/:id/graph/search?q=&by=`.

- [ ] **Step 1: Failing test**:
```ts
describe("git-ide search (SPEC-233)", () => {
  it("searchCommits menemukan by message & author", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, [{ msg: "tambah fitur X", changes: { "x": "1" } }, { msg: "perbaiki bug", changes: { "y": "1" } }]);
    expect((await searchCommits(dir, "fitur", "message")).length).toBe(1);
    expect((await searchCommits(dir, "t@t", "author")).length).toBeGreaterThan(0);
  });
  it("searchCommits by hash prefix", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const head = (await listGraph(dir)).commits[0]!.sha;
    expect(await searchCommits(dir, head.slice(0, 6), "hash")).toContain(head);
  });
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** — `searchCommits`: `git log --all --format=%H` + flag per `by`: message→`-i --grep=<q>`; author→`-i --author=<q>`; hash→filter prefix client atau `git rev-parse`; all→gabungan grep+author (union). `--end-of-options` sebelum q tak berlaku (q ke `--grep=`), tapi validasi q non-kosong. Route `GET /graph/search`.
- [ ] **Step 4: Run → pass**.
- [ ] **Step 5: Client** — `client.ts` `ideSearch`. `GitGraph.tsx`: widget Find (Ctrl/Cmd-F membuka input); ketik → cari client-side dulu (subject/author/hash pada `rows`), fallback `ideSearch` untuk histori dalam; hasil di-highlight + tombol next/prev (n/N) auto-scroll ke baris (`ref.scrollIntoView`). Tombol center HEAD (Ctrl/Cmd-H) scroll ke baris `current`.
- [ ] **Step 6: Real API test** — `GET /graph/search?q=fitur&by=message`.
- [ ] **Step 7: Commit** — `feat(spec-233): find/search commit + center HEAD (PR9)`

---

## Task 10 (PR10): Kontrol tampilan graph — filter/toggle/muted/kolom/style

**Files:**
- Modify: `server/src/services/git-ide.ts` (`listGraph` terima opsi filter), `server/src/routes/ide.ts` (query params), `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx`, `src/src/screens/IdeScreen.tsx`
- Test: `server/test/git-ide.test.ts`

**Interfaces:**
- Consumes: `listGraph(repoDir, limit, opts?)` — `opts = { branches?:string[]; showRemote?:boolean; showTags?:boolean }`.
- Produces: filter tercermin di `git log` refs; muted diturunkan client.

- [ ] **Step 1: Failing test**:
```ts
describe("git-ide graph filter (SPEC-233)", () => {
  it("listGraph branches filter membatasi ke ref tertentu", async () => {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/d.txt`, "d"); g("add", "-A"); g("commit", "-qm", "hanya dev"); g("checkout", "-q", "main");
    const only = await listGraph(dir, 200, { branches: ["main"] });
    expect(only.commits.some((c) => c.subject === "hanya dev")).toBe(false);
    const all = await listGraph(dir, 200);
    expect(all.commits.some((c) => c.subject === "hanya dev")).toBe(true);
  });
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** — `listGraph` param `opts`: bila `opts.branches` → `git log --date-order <branches...>` (bukan `--all`); else `--all`; `--exclude=refs/remotes/*` bila `showRemote===false`; `--exclude=refs/tags/*` bila `showTags===false`. Route parse query `branches` (csv), `showRemote`, `showTags` → default lama.
- [ ] **Step 4: Run → pass**.
- [ ] **Step 5: Client** — `GitGraph.tsx`/`IdeScreen.tsx`: dropdown filter branch (all/spesifik/glob), toggle checkbox show remote/tags/stashes/uncommitted, muted commit (redup teks utk merge-commit `parents.length>1` &/atau non-ancestor HEAD dihitung dari graph), tombol center HEAD, kolom Date/Author/Commit show/hide (klik-kanan header) + resizable (drag), graph style rounded↔angular (toggle `edgePath` bezier vs siku). Nilai default dari config (PR12).
- [ ] **Step 6: Real API test** — `GET /graph?branches=main` vs `GET /graph`.
- [ ] **Step 7: Commit** — `feat(spec-233): kontrol tampilan graph (filter/toggle/muted/kolom/style) (PR10)`

---

## Task 11 (PR11): Integrasi — PR link · issue link · remote mgmt · archive

**Files:**
- Create: `server/src/services/git-remotes.ts` (`listRemotes`, CRUD, `prUrl`)
- Modify: `server/src/routes/ide.ts` (`GET/POST/PATCH/DELETE /remotes`, `GET /archive`), `shared/src/api.ts`, `src/src/api/client.ts`, `src/src/screens/GitGraph.tsx`, `src/src/screens/IdeScreen.tsx`
- Test: `server/test/git-remotes.test.ts`

**Interfaces:**
- Produces: `listRemotes(repoDir): Promise<{name,fetch,push}[]>`, `prUrl(remoteUrl, branch, base): string|null` (github/gitlab/bitbucket); `GET /projects/:id/remotes` (+POST/PATCH/DELETE), `GET /projects/:id/archive?ref=&format=`.

- [ ] **Step 1: Failing test** (`git-remotes.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { prUrl, listRemotes } from "../src/services/git-remotes";
import { makeRepoWithSpecBranch } from "./factory";
describe("git-remotes (SPEC-233)", () => {
  it("prUrl github ssh & https", () => {
    expect(prUrl("git@github.com:acme/app.git", "feat", "main")).toBe("https://github.com/acme/app/compare/main...feat?expand=1");
    expect(prUrl("https://github.com/acme/app.git", "feat", "main")).toMatch(/github\.com\/acme\/app\/compare/);
  });
  it("prUrl gitlab & bitbucket & unknown→null", () => {
    expect(prUrl("git@gitlab.com:acme/app.git", "feat", "main")).toMatch(/merge_requests\/new/);
    expect(prUrl("https://bitbucket.org/acme/app.git", "feat", "main")).toMatch(/pull-requests\/new/);
    expect(prUrl("git@example.com:x/y.git", "feat", "main")).toBeNull();
  });
  it("listRemotes membaca origin", async () => {
    const { repoDir } = makeRepoWithSpecBranch("rm");
    expect((await listRemotes(repoDir)).map((r) => r.name)).toContain("origin");
  });
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement `git-remotes.ts`** — `listRemotes`: `git remote -v` parse. `prUrl`: regex host/owner/repo dari url (ssh `git@host:owner/repo.git` & https), map provider → compare/new URL. CRUD: `git remote add/set-url/remove`. Route: remotes CRUD + `GET /archive` → `res.header('content-disposition')` + stream `git archive --format=<zip|tar> <ref>` (spawn, pipe ke reply).
- [ ] **Step 4: Run → pass**.
- [ ] **Step 5: Client** — `client.ts`: `remotes`/`addRemote`/`patchRemote`/`deleteRemote`/`archiveUrl`. `GitGraph.tsx` menu ref-branch: "Create Pull Request" (buka `prUrl` di tab baru — server sertakan `prUrl` per branch berbasis `Project.gitRemote`, atau client hitung dari `remotes`), "Create archive" (`window.open(archiveUrl)`). Body commit: nomor issue → link (pattern config PR12). Widget kelola remote di toolbar `IdeScreen` (list/add/edit/delete/fetch/prune).
- [ ] **Step 6: Real API test** — `GET /remotes` → origin; `GET /archive?ref=main&format=zip` → 200 stream.
- [ ] **Step 7: Commit** — `feat(spec-233): PR link + issue link + remote mgmt + archive (PR11)`

---

## Task 12 (PR12): Config namespace + avatar + emoji/markdown + label styling

**Files:**
- Modify: `shared/src/config-registry.ts` (entri grup gitGraph), `server/src/services/git-ide.ts` (`listGraph` bawa email/committer opsional, hormati `.mailmap`)
- Create: `src/src/screens/git-graph-render.ts` (emoji map, `linkify`, gravatar url, markdown ringan)
- Modify: `src/src/screens/GitGraph.tsx` (konsumsi config + render helper)
- Test: `server/test/config-registry.test.ts`, `src/test/git-graph.test.ts`

**Interfaces:**
- Produces: entri `CONFIG_REGISTRY` grup `gitGraph`; `git-graph-render.ts` exports `emojify(s)`, `linkify(s, issuePattern)`, `gravatarUrl(email)`, `mdInline(s)`.

- [ ] **Step 1: Failing test — config registry** (`config-registry.test.ts`): tegaskan ada entri `gitGraph.style`, `gitGraph.showRemoteBranches`, `gitGraph.fetchAvatars`, dsb. dengan `group:"gitGraph"`, `category` editable, default valid (parse via `parseConfigValue`).
- [ ] **Step 2: Failing test — render** (`src/test/git-graph.test.ts` perluas): `emojify(":rocket: rilis")` → mengandung 🚀; `linkify("lihat #12", "https://gh/acme/app/issues/$1")` → `<a ...issues/12`; `gravatarUrl("t@t")` → `https://www.gravatar.com/avatar/<md5>`.
- [ ] **Step 3: Run → fail** (kedua suite).
- [ ] **Step 4: Implement registry** — tambah entri ke `CONFIG_REGISTRY`: `gitGraph.style` (enum rounded|angular, default rounded), `gitGraph.colours` (string CSV), `gitGraph.date.type` (author|commit), `gitGraph.date.format`, `gitGraph.commits.initialLoad` (number, default 200), `gitGraph.commits.loadMore` (number, 100), `gitGraph.showRemoteBranches` (bool true), `gitGraph.showTags` (bool true), `gitGraph.showStashes` (bool true), `gitGraph.showUncommittedChanges` (bool true), `gitGraph.showUntrackedFiles` (bool true), `gitGraph.mute.mergeCommits` (bool true), `gitGraph.mute.commitsNotOnHead` (bool false), `gitGraph.fetchAvatars` (bool **false**), `gitGraph.referenceLabels.combineLocalAndRemote` (bool false), `gitGraph.enhancedAccessibility` (bool false), `gitGraph.markdown` (bool true), `gitGraph.emoji` (bool true), `gitGraph.issueLinkPattern` (string kosong). Ikuti bentuk `ConfigEntry` yang ada (key/group/label/help/kind/category/apply).
- [ ] **Step 5: Implement render helper** — `git-graph-render.ts`: peta emoji shortcode inti + gitmoji (subset), `emojify`, `linkify` (URL + issue pattern + parent-hash), `gravatarUrl` (md5 hex — implement md5 kecil atau reuse util bila ada), `mdInline` (bold/italic/code inline). `listGraph`: bila avatar aktif, fmt tambah `%ae`; hormati `.mailmap` via `%aN`/`%aE`.
- [ ] **Step 6: Run → pass**.
- [ ] **Step 7: Client konsumsi config** — `GitGraph.tsx`/`IdeScreen.tsx`: muat `/config` (atau prop), pakai `gitGraph.colours`→palette, `style`→edgePath, kolom default, `mute.*`→redup, `initialLoad`/`loadMore`→limit + tombol "Muat lebih", `date.type/format`, `fetchAvatars`→`<img src={gravatarUrl(email)}>`, `emoji`/`markdown`→render subject/body, `referenceLabels.combineLocalAndRemote`→gabung pill.
- [ ] **Step 8: Real API test** — `GET /config` memuat entri `gitGraph.*`; `PUT /config {key:"gitGraph.style",value:"angular"}` → 200.
- [ ] **Step 9: Commit** — `feat(spec-233): config namespace gitGraph + avatar + emoji/markdown (PR12)`

---

## Task 13 (PR13): Finalisasi kontrak + docs + verifikasi menyeluruh

**Files:**
- Modify: `internal/docs/architecture/api-contract.md` (isi lengkap tiap endpoint baru), `internal/docs/README.md` (pastikan link), `internal/docs/frontend/frontend-implementation.md` (catat kapabilitas git graph baru)
- Verify: seluruh suite

- [ ] **Step 1: Lengkapi kontrak** — isi tiap baris endpoint SPEC-233 di `api-contract.md` blok IDE Visual dengan bentuk response, kode error (400/404/409), dan catatan gate/isolasi (persis gaya baris existing). Dokumentasikan juga `POST /projects/:id/git/merge` yang selama ini belum tercatat (temuan inventaris).
- [ ] **Step 2: Perbarui frontend doc** — tambah paragraf kapabilitas git graph parity (menu commit/branch/tag/stash, compare, find, detail-diff, kontrol tampilan, integrasi).
- [ ] **Step 3: Verifikasi penuh** — `env -u NODE_ENV -u DATABASE_URL pnpm test -- --no-file-parallelism` (server + web). Expected: semua hijau. `hanoman docs index --check` bersih.
- [ ] **Step 4: Real smoke menyeluruh** — boot server sekali, curl matriks endpoint baru (status/stashes/remotes/compare/search/commit-file + beberapa `POST /git` op) → verifikasi bentuk & kode.
- [ ] **Step 5: Commit** — `docs(spec-233): lengkapi kontrak API + frontend doc git graph parity (PR13)`

---

## Boot & curl (dipakai tiap "Real API test")

```bash
# DB throwaway ter-migrate (jangan hanoman_test — sibling test bisa truncate mid-smoke)
export SMOKE_DB=hanoman_smoke_233
docker exec hanoman-db-1 psql -U hanoman -d postgres -c "CREATE DATABASE $SMOKE_DB" 2>/dev/null || true
export DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5433/$SMOKE_DB"   # port 5433 (VPS-style) atau 5432 lokal
env -u NODE_ENV pnpm --filter @hanoman/server exec prisma migrate deploy
# build & boot di port bebas (bukan 8787 — ada dev sesi lain)
pnpm --filter @hanoman/server build
PORT=8791 node server/dist/server.js &   # simpan PID; login via /auth/setup lalu cookie
# buat project dgn binding ke repo fixture tmp, lalu curl endpoint IDE per PR
```
Login: `POST /api/auth/setup {email,password}` → simpan cookie → sertakan di curl `-b cookie.txt`. Buat project + `POST /api/projects/:id/binding {repoDir}` menunjuk repo tmp (init + beberapa commit) agar `resolveRepoDir` mengembalikan path. Matikan server + drop DB smoke setelah selesai.

## Self-review (writing-plans)

- **Spec coverage:** Grup 1(reset/copy/drop)=PR1+PR6; 2(branch rename/push/pull/fetch)=PR5+PR6; 3(tag)=PR2; 4(stash)=PR4; 5(uncommitted)=PR3; 6(commit detail)=PR7; 7(compare)=PR8; 8(find)=PR9; 9(kontrol tampilan)=PR10; 10(khas VS Code: avatar/PR/issue/archive/config/signature/emoji/markdown)=PR7(signature)+PR11(PR/issue/archive/remote)+PR12(avatar/config/emoji/markdown). Semua grup tertaut. Kontrak+ADR=PR0+PR13.
- **Placeholder scan:** tak ada TBD; tiap op punya git-args konkret + test.
- **Type consistency:** `GitOp`/`GraphCommit`/`CommitDetail` disebut identik di server+client; `GraphMergeResult` reuse dari `integrate.ts`; `touchesTree` didefinisikan PR1 dipakai konsisten.
