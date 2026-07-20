# Terminal tmux non-Claude — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plain tmux shell session (no `claude`) that runs in a selected project's `repoDir`, openable from the Terminal screen.

**Architecture:** Reuse `createSession(projectId, cwd, { command })` — the raw-argv branch (`pty.ts:165`) already used by the VPS console (ADR-0042). A new `zTerminalSession` variant `{project, shell:true}` (no `flow`) routes to a shell branch that spawns `shellBin()` in `repoDir`. No DB/schema change (sessions are tmux-only). Frontend gets a "Terminal biasa" button beside "Sesi baru".

**Tech Stack:** Node + TypeScript (Fastify), zod (`@hanoman/shared`), node-pty + tmux, React + TS (Vite), vitest.

## Global Constraints

- TypeScript strict. Test every orchestration change. Run repo tests with `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism` (avoid prod env leak; per SKILL).
- Session flow set stays `feature | qa | scaffold | reverse | prd`. Shell is **not** a flow.
- cwd of the shell = effective `repoDir` (`resolveRepoDir`), i.e. the project working tree — deliberate (ADR-0056). Never a `.worktrees/` dir.
- Docs touched updated in the same push + linked in `internal/docs/README.md`.
- Shell binary resolution: `HANOMAN_SHELL ?? process.env.SHELL ?? "/bin/bash"`.

---

### Task 1: Wire protocol — `zTerminalSession` shell variant

**Files:**
- Modify: `shared/src/dto.ts:104-114` (`zTerminalSession` union)
- Test: `shared/test/dto.test.ts`

**Interfaces:**
- Produces: `zTerminalSession` now accepts `{ project: string, shell: true }`. Existing `{project}`, `{project,flow:"reverse"}`, `{project,flow:"prd",brief}`, `{project,flow:"scaffold"}`, `{spec,flow}` all still parse unchanged.

- [x] **Step 1: Write the failing test** — append to `shared/test/dto.test.ts` inside the terminal-session describe block (find where `zTerminalSession` is tested; if none exists, add a new `describe`):

```ts
import { zTerminalSession } from "../src/dto";
// ...
describe("zTerminalSession · shell (SPEC-236)", () => {
  it("menerima { project, shell: true } sebagai varian shell", () => {
    const r = zTerminalSession.safeParse({ project: "p1", shell: true });
    expect(r.success).toBe(true);
    expect(r.success && "shell" in r.data && r.data.shell).toBe(true);
  });
  it("{ project } tanpa shell tetap terminal biasa (bukan shell)", () => {
    const r = zTerminalSession.safeParse({ project: "p1" });
    expect(r.success).toBe(true);
    expect(r.success && "shell" in r.data).toBe(false);
  });
  it("{ project, flow: reverse } tak tertelan varian shell", () => {
    const r = zTerminalSession.safeParse({ project: "p1", flow: "reverse" });
    expect(r.success && "flow" in r.data && r.data.flow).toBe("reverse");
  });
  it("shell wajib literal true (shell: false ditolak sebagai varian shell)", () => {
    const r = zTerminalSession.safeParse({ project: "p1", shell: false });
    // shell:false gagal varian shell → jatuh ke varian plain (shell dibuang) → tetap sukses, tapi bukan shell
    expect(r.success).toBe(true);
    expect(r.success && "shell" in r.data).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run test/dto.test.ts -t "SPEC-236"`
Expected: FAIL — `{project,shell:true}` currently parses as the plain variant (shell stripped), so `"shell" in r.data` is false.

- [x] **Step 3: Add the shell variant FIRST in the union** — `shared/src/dto.ts`, replace the `zTerminalSession` definition:

```ts
export const zTerminalSession = z.union([
  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project. Tanpa flow (bukan
  // pipeline claude). DIDAHULUKAN: z.object non-strict membuang key asing, jadi bila varian
  // longgar {project,flow?} lebih dulu, {project,shell:true} akan lolos sbg plain (shell dibuang).
  z.object({ project: z.string(), shell: z.literal(true) }),
  // flow opsional (SPEC-166): "reverse" = sesi project-level di worktree-nya sendiri,
  // menyusun Source of Truth dari kode. Tanpa flow = terminal biasa (claude) di repoDir.
  z.object({ project: z.string(), flow: z.literal("reverse").optional() }),
  // SPEC-210 · sesi prd project-level di worktree sendiri; menghasilkan dokumen PRD dari brief.
  z.object({ project: z.string(), flow: z.literal("prd"), brief: zPrdBrief }),
  // SPEC-222 · scaffold: sesi project-level from-scratch, menyusun SoT dari ide.
  z.object({ project: z.string(), flow: z.literal("scaffold") }),
  z.object({ spec: z.string(), flow: zFlow }),
]);
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run test/dto.test.ts -t "SPEC-236"`
Expected: PASS (4 tests).

- [x] **Step 5: Full shared suite (no regression to existing union tests)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run test/dto.test.ts`
Expected: PASS (all).

- [x] **Step 6: Commit**

```bash
git add shared/src/dto.ts shared/test/dto.test.ts
git commit -m "feat(shared): zTerminalSession menerima varian shell non-claude — SPEC-236"
```

---

### Task 2: Server — `shellBin()` + `POST /terminal/sessions {project, shell:true}` branch

**Files:**
- Modify: `server/src/services/pty.ts` (add `shellBin` near `claudeBin`, ~line 53)
- Modify: `server/src/routes/terminal.ts` (import `shellBin`; shell branch after project-404 guard, ~line 109)
- Create: `server/test/fixtures/fake-shell.sh`
- Test: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `createSession(projectId, cwd, { command })` (pty.ts), `resolveRepoDir(projectId)` (local-binding), `zTerminalSession` shell variant (Task 1).
- Produces: `export const shellBin: () => string` in `pty.ts`. `POST /terminal/sessions {project, shell:true}` → 201 `{id}`; the session has no `flow` and `cwd === repoDir`; 404 unknown project; 400 project without repoDir.

- [x] **Step 1: Create the fake shell fixture**

Create `server/test/fixtures/fake-shell.sh`:

```sh
#!/bin/sh
# Berdiri sebagai shell biasa di test PTY: cetak marker (agar test membuktikan shell mentah
# dijalankan, bukan claude), lalu tetap hidup meng-echo stdin — cermin fake-claude.sh.
echo "SHELL-BIASA-SIAP"
exec cat
```

Then make it executable:

```bash
chmod +x server/test/fixtures/fake-shell.sh
```

- [x] **Step 2: Write the failing test** — append to `server/test/terminal.route.test.ts` a new describe block after the existing `terminal routes` block. Add the fixture path constant near the top-of-file `FAKE_CLAUDE` const if convenient, or inline in the block:

```ts
// SPEC-236 · terminal biasa NON-claude: shell mentah di repoDir project (bukan TUI Claude).
describe("terminal routes · shell non-claude (SPEC-236)", () => {
  const FAKE_SHELL = fileURLToPath(new URL("./fixtures/fake-shell.sh", import.meta.url));
  const startShell = (project: string) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project, shell: true } });

  it("POST { project, shell:true } → 201, sesi tanpa flow di repoDir, menjalankan shell (bukan claude)", async () => {
    process.env.HANOMAN_SHELL = FAKE_SHELL;
    const res = await startShell("p1");
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const s = listSessions().find((x) => x.id === id)!;
    expect(s.flow).toBeUndefined();          // shell bukan flow → mesin stage tak tersentuh
    expect(s.cwd).toBe(repoDir);             // jalan di working tree project, bukan .worktrees
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.data().includes("SHELL-BIASA-SIAP"));
    expect(c.data()).not.toContain("--dangerously-skip-permissions"); // bukan argv claude
    c.ws.close();
    await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
  });

  it("shell untuk project tanpa repoDir → 400 (bukan 422)", async () => {
    const res = await startShell("p2");   // p2.repoDir = null
    expect(res.statusCode).toBe(400);
    expect(res.json().needsBind).toBe(true);
  });

  it("shell untuk project tak dikenal → 404", async () => {
    expect((await startShell("nope")).statusCode).toBe(404);
  });

  it("DELETE sesi shell tidak menghapus/mengganggu working tree project", async () => {
    process.env.HANOMAN_SHELL = FAKE_SHELL;
    const id = (await startShell("p1")).json().id as string;
    expect(existsSync(repoDir)).toBe(true);
    expect((await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` })).statusCode).toBe(204);
    expect(existsSync(repoDir)).toBe(true);           // repoDir utuh
    expect(existsSync(join(repoDir, ".git"))).toBe(true);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/terminal.route.test.ts -t "SPEC-236"`
Expected: FAIL — `{project,shell:true}` currently falls through to the line-203 fallback which spawns claude, so `s.flow` is undefined but data contains claude flags / no "SHELL-BIASA-SIAP", and `shellBin` doesn't exist (compile error) once the route references it.

- [x] **Step 4: Add `shellBin()` to `pty.ts`** — right after the `claudeBin` definition (`server/src/services/pty.ts:53`):

```ts
const claudeBin = () => effectiveStr("HANOMAN_CLAUDE_BIN") ?? "claude";
// SPEC-236 · shell untuk "terminal biasa" non-claude. HANOMAN_SHELL menang (dipakai test),
// lalu $SHELL operator, lalu /bin/bash. Diserahkan ke createSession({command:[shellBin()]}) —
// cabang argv mentah yang sama dipakai Console VPS (ADR-0042).
export const shellBin = (): string => effectiveStr("HANOMAN_SHELL") ?? process.env.SHELL ?? "/bin/bash";
```

- [x] **Step 5: Add the shell branch to the route** — `server/src/routes/terminal.ts`. First extend the pty import (line 14-17) to include `shellBin`:

```ts
import {
  createSession, getSession, listSessions, killSession, sessionPhases,
  attach, detach, writeTo, resize, shellBin, type Client,
} from "../services/pty";
```

Then insert the shell branch immediately after the project-404 guard (currently `terminal.ts:108-109`), **before** the `repoDir` guard that references `parsed.data.flow`:

```ts
    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });

    // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project. Reuse cabang
    // createSession({command}) (ADR-0042/0056). Tanpa flow → tak menggerakkan stage; cwd=repoDir
    // (bukan .worktrees) → DELETE hanya kill pane, tak menyentuh working tree. Ditaruh sebelum
    // guard repoDir lama supaya TS menyempitkan varian shell keluar sebelum `parsed.data.flow`.
    if ("shell" in parsed.data && parsed.data.shell) {
      const repoDir = await resolveRepoDir(project.id);
      if (!repoDir) return reply.code(400)
        .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
      const s = createSession(project.id, repoDir, { command: [shellBin()] });
      return reply.code(201).send({ id: s.id });
    }
```

- [x] **Step 6: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/terminal.route.test.ts -t "SPEC-236"`
Expected: PASS (4 tests).

- [x] **Step 7: Full terminal route + pty suites (no regression)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/terminal.route.test.ts test/pty.test.ts`
Expected: PASS (all).

- [x] **Step 8: Commit**

```bash
git add server/src/services/pty.ts server/src/routes/terminal.ts server/test/terminal.route.test.ts server/test/fixtures/fake-shell.sh
git commit -m "feat(server): POST /terminal/sessions {project,shell:true} spawns plain shell — SPEC-236"
```

---

### Task 3: Frontend — `createShell` client + "Terminal biasa" button

**Files:**
- Modify: `src/src/api/client.ts` (add `createShell` near `createTerminal`, ~line 119)
- Modify: `src/src/screens/TerminalScreen.tsx` (button + `openShell` + empty-state hint)
- Test: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: `POST { project, shell: true }` (Task 2).
- Produces: `api.createShell(project: string): Promise<{ id: string }>`; a "Terminal biasa" button in `TerminalScreen` toolbar that calls it and places the session in the active grid.

- [x] **Step 1: Write the failing test** — add to `src/test/terminal-screen.test.tsx`. First add the mock fn (top, beside `createTerminal`): add `const createShell = vi.fn();` next to the other `vi.fn()` decls, and `createShell: (...a: unknown[]) => createShell(...a),` inside the mocked `api` object; add `createShell.mockReset();` in `beforeEach`. Then add the test inside the `describe("TerminalScreen (grid)"` block:

```ts
  it("tombol 'Terminal biasa' membuka shell non-claude untuk project terpilih (SPEC-236)", async () => {
    listTerminals.mockResolvedValue([]);
    createShell.mockResolvedValue({ id: "shell-abc123" });
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByText("Terminal biasa"));
    await waitFor(() => expect(createShell).toHaveBeenCalledWith("p1"));
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web exec vitest run test/terminal-screen.test.tsx -t "SPEC-236"`
Expected: FAIL — no "Terminal biasa" button / `api.createShell` undefined.

> If the web package name differs, discover it: `node -p "require('./src/package.json').name"` and substitute in the `--filter`.

- [x] **Step 3: Add `createShell` to the API client** — `src/src/api/client.ts`, right after `createTerminal` (line 119):

```ts
  createTerminal: (project: string) => j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project }) }),
  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project (tanpa flow).
  createShell: (project: string) => j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, shell: true }) }),
```

- [x] **Step 4: Add `openShell` + button + hint** — `src/src/screens/TerminalScreen.tsx`.

Add `openShell` right after `openNew` (line 78):

```ts
  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project terpilih. Cermin
  // openNew, tapi memanggil createShell — server men-spawn $SHELL, bukan claude.
  async function openShell() {
    if (!project) return;
    const { id } = await api.createShell(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    setWs((w) => W.placeFirstEmptyInActive(w, id));
  }
```

Add the button in the toolbar, immediately before the "Sesi baru" button (line 161):

```tsx
          <Button size="sm" variant="secondary" leftIcon="terminal"
            title="Buka shell tmux tanpa Claude di project terpilih — jalankan command di project"
            onClick={() => void openShell()}>Terminal biasa</Button>
          <Button size="sm" leftIcon="plus" onClick={() => void openNew()}>Sesi baru</Button>
```

Update the empty-state hint (line 191-192) so it names both options:

```tsx
        <StateBlock kind="empty" icon="terminal" title="Belum ada sesi terminal"
          hint="Pilih project lalu buka sesi — 'Sesi baru' menjalankan claude --dangerously-skip-permissions di direktori project; 'Terminal biasa' membuka shell tmux polos untuk menjalankan command." />
```

- [x] **Step 5: Run test to verify it passes**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web exec vitest run test/terminal-screen.test.tsx -t "SPEC-236"`
Expected: PASS.

- [x] **Step 6: Full terminal-screen suite (no regression)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web exec vitest run test/terminal-screen.test.tsx`
Expected: PASS (all).

- [x] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(web): tombol 'Terminal biasa' membuka shell tmux non-claude — SPEC-236"
```

---

### Task 4: Docs — ADR-0056 + Source of Truth updates

**Files:**
- Create: `internal/docs/adr/0056-terminal-shell-non-claude.md`
- Modify: `internal/docs/README.md` (link ADR-0056)
- Modify: `internal/docs/architecture/api-contract.md` (Terminal section — shell variant)
- Modify: `internal/docs/architecture/stack.md` (session kinds — clarify plain terminal)
- Modify: `internal/skills/hanoman/SKILL.md` (session kinds — clarify plain terminal = shell)
- Modify: `internal/docs/frontend/frontend-implementation.md` (Terminal — "Terminal biasa" button)
- Modify: `internal/docs/architecture/data-model.md` (note shell = flow-less)

- [x] **Step 1: Write ADR-0056** — `internal/docs/adr/0056-terminal-shell-non-claude.md`:

```markdown
# ADR-0056 — Terminal biasa = shell mentah di repoDir project (bukan claude)

Status: diterima · SPEC-236 · 2026-07-20 · mengikuti pola ADR-0042

## Konteks
Operator kadang hanya ingin menjalankan command di sebuah project (mis. `pnpm install`,
`git status`, build) tanpa menyalakan sesi `claude`. "Sesi baru" di Terminal men-spawn
`claude --dangerously-skip-permissions` di repoDir; tak ada opsi shell polos untuk project lokal.
Console VPS (ADR-0042) sudah membuktikan pola shell mentah lewat `createSession({ command })`.

## Keputusan
`POST /terminal/sessions { project, shell: true }` men-spawn `shellBin()`
(`HANOMAN_SHELL ?? $SHELL ?? /bin/bash`) lewat `createSession(project.id, repoDir, { command: [shellBin()] })`
— cabang argv mentah `pty.ts` yang melewati `claude`/`--dangerously-skip-permissions`/`--settings`.
- **cwd = repoDir project (working tree utama), bukan worktree isolasi.** Tujuannya menjalankan
  command di project sungguhan; worktree ephemeral justru salah. Konsisten dengan "Sesi baru"
  (claude di repoDir), IDE Visual (ADR-0034), dan Console VPS (ADR-0042).
- **Tanpa `flow`.** Shell bukan pipeline claude: tak punya fase, tak menggerakkan `Spec.stage`,
  tak punya Spec. `flow` tetap `feature|qa|scaffold|reverse|prd`. Varian wire `{project,shell:true}`
  terpisah dari `flow` dan didahulukan di `zTerminalSession` (union non-strict).
- **Id acak → banyak shell per project diizinkan** (cermin "Sesi baru"), bukan deterministik.

## Alasan
- Nyaris nol kode baru: reuse penuh attach/scrollback/WS/resize/kill/persistensi tmux (ADR-0016).
- Tak ada perubahan skema — sesi terminal tmux-only, tak ada baris DB.
- DELETE aman: cleanup worktree hanya untuk sesi ber-`flow` atau ber-cwd `.worktrees/`; shell
  ber-cwd repoDir → hanya kill pane, working tree utama tak tersentuh.

## Konsekuensi
- RCE by design, sama seperti seluruh endpoint terminal — server bind `127.0.0.1` (ADR-0014).
  Shell justru lebih sempit dari `claude --dangerously-skip-permissions`.
- Aturan "jangan jalankan sesi di working tree utama" (AGENTS.md) tetap berlaku untuk **sesi
  kerja pipeline** (feature/qa) yang membangun ke branch. Sesi ad-hoc yang dikemudikan manusia
  (shell / "Sesi baru") di repoDir bukan sasaran aturan itu — ditegaskan di sini.

## Ditolak
- **`flow: "shell"`**: mencemari mesin stage & tipe `Flow` runner dengan konsep tanpa fase.
- **Worktree isolasi untuk shell**: operator tak akan melihat state project sungguhan.
- **Id deterministik (satu shell/project)**: operator sering butuh >1 shell (server + git).
```

- [x] **Step 2: Link ADR-0056 in the index** — `internal/docs/README.md`, add under `## adr` above the ADR-0054 line:

```markdown
- [0056 — Terminal biasa = shell mentah di repoDir project (bukan claude)](adr/0056-terminal-shell-non-claude.md) — SPEC-236, pola ADR-0042
```

- [x] **Step 3: Document the shell variant in the API contract** — `internal/docs/architecture/api-contract.md`, in the `## Terminal` section, under the `POST /terminal/sessions` lines, add:

```
#   {project, shell:true} (SPEC-236, ADR-0056): terminal biasa NON-claude — shell mentah
#     (HANOMAN_SHELL ?? $SHELL ?? /bin/bash) di repoDir project, tanpa flow (tak menggerakkan stage,
#     tak buat worktree). 201 { id } · 404 project · 400 tanpa repoDir (needsBind).
```

- [x] **Step 4: Clarify "plain terminal" in stack.md** — `internal/docs/architecture/stack.md`, the "Jenis sesi" enumeration (~line 47-48), change `**plain terminal**` to make explicit it can be claude-di-repoDir OR shell mentah:

```
Jenis sesi: **spec-flow** (`feature`/`qa`), **reverse** (project-level), **prd**, **plain
terminal** (claude di repoDir ATAU shell mentah non-claude `{shell:true}`, SPEC-236/ADR-0056),
**integrate-conflict** (`merge-<id>`), **vps**.
```

- [x] **Step 5: Clarify in SKILL.md** — `internal/skills/hanoman/SKILL.md`, the "Jenis sesi" line (~line 71): append to the `**plain terminal**` item: `(claude di repoDir; atau shell mentah non-claude via {shell:true}, SPEC-236/ADR-0056)`.

- [x] **Step 6: Frontend doc** — `internal/docs/frontend/frontend-implementation.md`, in the `## Terminal` section (near the "Ambil backlog" paragraph, ~line 130), add a sentence:

```
Toolbar juga punya **Terminal biasa** (SPEC-236): membuka **shell tmux polos tanpa Claude** di
repoDir project terpilih (`POST {project, shell:true}`) untuk sekadar menjalankan command —
di sebelah **Sesi baru** yang men-spawn `claude`. Sesi shell tak punya flow/spec, tampil seperti
sesi biasa; menutupnya hanya kill pane (cwd = repoDir, bukan worktree).
```

- [x] **Step 7: Data-model note** — `internal/docs/architecture/data-model.md`, in the PRD/flow note (~line 104, the "Set flow sesi kini" line), append: ` Sesi shell (SPEC-236) TANPA flow — bukan pipeline.`

- [x] **Step 8: Verify index integrity + coverage scan (no server boot needed)**

Run: `env -u NODE_ENV -u DATABASE_URL node --experimental-strip-types shared/src/coverage.ts 2>/dev/null || pnpm exec hanoman docs index --check`
Expected: index check passes / ADR-0056 reachable from README. (If `hanoman` CLI unavailable in worktree, confirm the README link line was added and the ADR file exists.)

- [x] **Step 9: Commit**

```bash
git add internal/docs/adr/0056-terminal-shell-non-claude.md internal/docs/README.md internal/docs/architecture/api-contract.md internal/docs/architecture/stack.md internal/docs/architecture/data-model.md internal/docs/frontend/frontend-implementation.md internal/skills/hanoman/SKILL.md
git commit -m "docs: ADR-0056 + SoT untuk terminal shell non-claude — SPEC-236"
```

---

### Task 5: Real local verification (boot server + curl) + full suite

Per CLAUDE.md: prove the endpoint on a live server, not just unit tests.

**Files:** none (verification only).

- [ ] **Step 1: Full repo test suite green**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism`
Expected: PASS (all packages). Fix any regression before continuing.

- [ ] **Step 2: Typecheck + build the server**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server build`
Expected: builds clean (TS strict passes for the new `shellBin` + route branch).

- [ ] **Step 3: Boot a server against a throwaway migrated DB, register a project with a real repoDir, and curl the shell endpoint**

Follow the live-smoke pattern (dedicated DB, not `hanoman_test`; see memory "Live smoke: dedicated DB"). Concretely:
- Prepare a temp git repo dir (`git init -b main && git commit --allow-empty -m init`).
- Boot `node server/dist/server.js` with `HANOMAN_SHELL` pointing to a script that echoes a marker, `requireAuth` off (or create a session), bound to a free port, against a migrated throwaway DB.
- Insert a project row with that repoDir (or `POST /api/projects`).
- `curl -sS -XPOST :PORT/api/terminal/sessions -H 'content-type: application/json' -d '{"project":"<id>","shell":true}'` → expect `201 {"id":"..."}`.
- `curl -sS :PORT/api/terminal/sessions` → the returned session has no `flow` and `cwd` = repoDir.
- Open the session WS briefly (or `tmux -L <socket> capture-pane`) → shows the shell marker, not claude flags.
- `curl -XDELETE :PORT/api/terminal/sessions/<id>` → 204; repoDir still intact.

Expected: 201 on create, session listed with no flow + cwd=repoDir, shell marker present, 204 on delete, repoDir untouched. Record the actual curl output in the session.

- [ ] **Step 4: Tear down** the throwaway server, DB, tmux socket, and temp repo.

- [ ] **Step 5: Final commit (if verification produced any fix)**

```bash
git add -A
git commit -m "test: verifikasi live terminal shell non-claude — SPEC-236"
```

---

## Self-review notes (author)

- **Spec coverage:** dto variant (Task 1) ✓ · shellBin + route branch + cwd=repoDir + no-flow + 400/404 (Task 2) ✓ · frontend button + client (Task 3) ✓ · ADR-0056 + all touched SoT docs + index link (Task 4) ✓ · live curl verification (Task 5, per CLAUDE.md) ✓. Non-goals (no session "kind" tag, no project-detail door, no worktree, no schema change) honored.
- **Type consistency:** `shellBin` (exported from `pty.ts`, imported in `terminal.ts`), `createShell` (client → TerminalScreen), `{project, shell:true}` wire shape consistent across dto/server/client. `resolveRepoDir` already imported in `terminal.ts`.
- **Ordering hazard:** shell variant placed first in `zTerminalSession`; shell branch placed before the `parsed.data.flow` guard — both justified inline.
