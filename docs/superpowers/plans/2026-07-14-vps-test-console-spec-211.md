# VPS Test Connection & Open Console (SPEC-211) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Tambah dua aksi per-VPS — *test connection* (cek ssh key-only) dan *open console* (shell ssh mentah di dalam tmux hanoman).

**Architecture:** Test connection = `sshExec(v,"true")`, transien, tanpa DB. Console = spawn `ssh -t …` lewat `createSession({ command })` — cabang baru di `pty.ts` yang melewati argv claude sepenuhnya; sisa infra sesi (attach/WS/scrollback/kill) dipakai apa adanya. Keputusan lokal-tmux di ADR-0042.

**Tech Stack:** Fastify, Prisma, node-pty + tmux, React/TS (Vite), Vitest.

## Global Constraints

- TypeScript strict. TDD tiap logika.
- Tanpa perubahan skema Prisma, tanpa dependency baru.
- host/user/port sudah divalidasi zod (`HOST_RE`/`USER_RE`/int) di `zCreateVps` — trust boundary; argv console tetap di-`sq()` di `pty.ts`.
- Route baru di bawah bind `127.0.0.1` yang sama dengan `/vps/*` (tanpa auth per-route).
- Update `internal/docs` yang tersentuh dalam commit yang sama.
- Test fixtures: `HANOMAN_SSH_BIN` (fake-ssh.sh), `HANOMAN_CLAUDE_BIN` (fake-claude.sh), `HANOMAN_TMUX_SOCKET`.
- Jalankan test server: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test <file>`.

---

### Task 1: `command` opt di pty.ts — spawn perintah non-claude

**Files:**
- Modify: `server/src/services/pty.ts` (type `CreateOpts`, fungsi `createSession`)
- Test: `server/test/pty.test.ts`

**Interfaces:**
- Produces: `CreateOpts.command?: string[]` — bila diisi, `createSession` menjalankan argv ini (di-`sq()`) alih-alih membangun argv claude; tanpa `--dangerously-skip-permissions`/`--settings`/prompt/model/effort.

- [x] **Step 1: Tulis test yang gagal** — di `server/test/pty.test.ts`, dalam `describe("pty service", …)`:

```ts
it("command opt menjalankan perintah non-claude, tanpa flag claude", async () => {
  const s = createSession("con1", process.cwd(), { command: ["/bin/echo", "halo-console"] });
  await waitFor(() => exited(s.id));
  const c = fakeClient();
  attach(s.id, c);
  expect(allData(c)).toContain("halo-console");
  expect(allData(c)).not.toContain("--dangerously-skip-permissions");
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test pty.test.ts -t "command opt"`
Expected: FAIL (opt `command` belum ada → argv claude tetap terpakai, output memuat `--dangerously-skip-permissions`).

- [x] **Step 3: Implementasi minimal** — di `server/src/services/pty.ts`:

Tambah field di `CreateOpts`:
```ts
export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; prompt?: string; phaseFile?: string;
  decisionFile?: string; model?: string; effort?: string; command?: string[];
};
```

Di `createSession`, ganti blok pembangunan `argv` jadi bercabang:
```ts
  // Console VPS (SPEC-211) memasok argv sendiri (mis. `ssh -t …`): shell mentah, bukan claude.
  // `--dangerously-skip-permissions`/`--settings` hanya relevan untuk claude.
  const parts = opts.command ?? [
    claudeBin(),
    ...(opts.prompt ? [opts.prompt] : []),
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.effort ? ["--effort", opts.effort] : []),
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify(guardSettings(opts.decisionFile)),
  ];
  const argv = parts.map(sq).join(" ");
```

- [x] **Step 4: Jalankan, pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test pty.test.ts`
Expected: PASS (semua test pty, termasuk yang baru).

- [x] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(server): CreateOpts.command — spawn perintah non-claude di tmux (SPEC-211)"
```

---

### Task 2: `consoleArgv` di vps-ssh.ts — bangun argv ssh interaktif

**Files:**
- Modify: `server/src/services/vps-ssh.ts` (export `sshBin`, tambah `consoleArgv`)
- Test: `server/test/vps-ssh.test.ts`

**Interfaces:**
- Consumes: `SshTarget` (sudah ada).
- Produces: `consoleArgv(t: SshTarget): string[]` → `[ssh, "-t", "-p", <port>, "-o","StrictHostKeyChecking=accept-new", (…"-i",keyPath), "<user>@<host>"]`. Binary lewat `sshBin()` supaya test bisa mengarahkannya ke fixture.

- [x] **Step 1: Tulis test yang gagal** — di `server/test/vps-ssh.test.ts`:

```ts
import { consoleArgv } from "../src/services/vps-ssh";

describe("consoleArgv (SPEC-211)", () => {
  it("argv ssh interaktif dengan -t, port, dan user@host", () => {
    const a = consoleArgv({ host: "203.0.113.9", port: 2222, user: "deploy", keyPath: null });
    expect(a).toContain("-t");
    expect(a).toEqual(expect.arrayContaining(["-p", "2222", "deploy@203.0.113.9"]));
    expect(a).not.toContain("-i");
  });
  it("menyisipkan -i keyPath saat ada", () => {
    const a = consoleArgv({ host: "h", port: 22, user: "root", keyPath: "/k/id_ed25519" });
    expect(a).toEqual(expect.arrayContaining(["-i", "/k/id_ed25519"]));
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps-ssh.test.ts -t consoleArgv`
Expected: FAIL ("consoleArgv is not a function" / import undefined).

- [x] **Step 3: Implementasi minimal** — di `server/src/services/vps-ssh.ts`:

Ubah `const sshBin` jadi `export const sshBin`, lalu tambah:
```ts
// SPEC-211 · argv `ssh` interaktif untuk Open Console. `-t` memaksa tty remote; koneksi
// dibungkus tmux hanoman (createSession) supaya reattach dari browser. accept-new sama
// dengan sshExec. host/user/port sudah divalidasi zod; keyPath path milik server.
export function consoleArgv(t: SshTarget): string[] {
  return [
    sshBin(), "-t", "-p", String(t.port),
    "-o", "StrictHostKeyChecking=accept-new",
    ...(t.keyPath ? ["-i", t.keyPath] : []),
    `${t.user}@${t.host}`,
  ];
}
```

- [x] **Step 4: Jalankan, pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps-ssh.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/vps-ssh.ts server/test/vps-ssh.test.ts
git commit -m "feat(server): consoleArgv — argv ssh interaktif untuk Open Console (SPEC-211)"
```

---

### Task 3: Route `/vps/:id/test` + `/vps/:id/console` + paths + client

**Files:**
- Modify: `server/src/routes/vps.ts` (2 route baru, import `consoleArgv`)
- Modify: `shared/src/api.ts` (`vpsTest`, `vpsConsole`)
- Modify: `src/src/api/client.ts` (`testVps`, `vpsConsole`)
- Test: `server/test/vps.route.test.ts`

**Interfaces:**
- Consumes: `sshExec` (ada), `consoleArgv` (Task 2), `createSession` (Task 1), `homedir`.
- Produces:
  - `POST /vps/:id/test` → `200 { ok: boolean, out: string }` · `404`.
  - `POST /vps/:id/console` → `201 { id: string }` · `404`. Sesi id `vpsc-<id>`, `projectId="vps-console:<id>"`.
  - `paths.vpsTest(id)`, `paths.vpsConsole(id)`; `api.testVps(id)`, `api.vpsConsole(id)`.

- [x] **Step 1: Tulis test yang gagal** — di `server/test/vps.route.test.ts`, tambah describe baru (setelah `describe("sesi claude vps …")`):

```ts
describe("test connection & console (SPEC-211)", () => {
  it("test connection sukses → { ok: true }", async () => {
    const v = await makeVps({ name: "t1", host: "198.51.100.31" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/test` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
  it("test connection gagal → { ok: false } dengan transcript, tetap 200", async () => {
    process.env.FAKE_SSH_MODE = "unreachable";
    const v = await makeVps({ name: "t2", host: "198.51.100.32" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/test` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().out).toContain("Connection refused");
  });
  it("test vps tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/vps/hantu/test" })).statusCode).toBe(404);
  });
  it("console membuka sesi tmux label vps-console:<id>", async () => {
    process.env.HANOMAN_SSH_BIN = FAKE_SSH; // console men-spawn `ssh` (fixture tetap hidup baca stdin)
    const v = await makeVps({ name: "c1", host: "198.51.100.33" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/console` });
    expect(res.statusCode).toBe(201);
    const s = getSession(res.json().id);
    expect(s?.projectId).toBe(`vps-console:${v.id}`);
    expect(res.json().id).toBe(`vpsc-${v.id}`);
    killAll();
  });
  it("console vps tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/vps/hantu/console" })).statusCode).toBe(404);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps.route.test.ts -t "SPEC-211"`
Expected: FAIL (route 404 dari Fastify untuk path tak terdaftar → statusCode 404 di semua, assertion `ok`/`id` gagal).

- [x] **Step 3: Implementasi** — di `shared/src/api.ts`, tambah setelah `vpsSession`:
```ts
  vpsTest: (id: string) => `${API}/vps/${id}/test`,
  vpsConsole: (id: string) => `${API}/vps/${id}/console`,
```

Di `server/src/routes/vps.ts` — tambah import: `import { sshExec, consoleArgv } from "../services/vps-ssh";` (gabung dengan import `sshExec` yang ada), lalu tambah dua route sebelum penutup fungsi:
```ts
  // SPEC-211 · test connection — cek ssh key-only berhasil sekarang. Transien, tak sentuh DB.
  app.post("/vps/:id/test", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const r = await sshExec(v, "true", { timeoutMs: 15_000 });
    return { ok: r.code === 0, out: r.out };
  });

  // SPEC-211 · Open Console — shell ssh MENTAH (bukan claude) di dalam tmux hanoman (ADR-0042).
  // id deterministik: tekan Console dua kali menyambung, bukan menumpuk sesi ssh.
  app.post("/vps/:id/console", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const s = createSession(`vps-console:${v.id}`, homedir(), { id: `vpsc-${v.id}`, command: consoleArgv(v) });
    return reply.code(201).send({ id: s.id });
  });
```

Di `src/src/api/client.ts`, tambah setelah `vpsSession`:
```ts
  testVps: (id: string) => j<{ ok: boolean; out: string }>(paths.vpsTest(id), { method: "POST" }),
  vpsConsole: (id: string) => j<{ id: string }>(paths.vpsConsole(id), { method: "POST" }),
```

- [x] **Step 4: Jalankan, pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps.route.test.ts`
Expected: PASS (semua VPS route, termasuk SPEC-211).

- [x] **Step 5: Commit**

```bash
git add server/src/routes/vps.ts shared/src/api.ts src/src/api/client.ts server/test/vps.route.test.ts
git commit -m "feat(server): POST /vps/:id/test & /console — test connection + open console (SPEC-211)"
```

---

### Task 4: UI — tombol Test + Console di VpsScreen

**Files:**
- Modify: `src/src/screens/VpsScreen.tsx`
- Test: `src/test/vps-screen.test.tsx`

**Interfaces:**
- Consumes: `api.testVps`, `api.vpsConsole` (Task 3), `onGotoTerminal`, `onToast`.

- [x] **Step 1: Tulis test yang gagal** — di `src/test/vps-screen.test.tsx`, tambahkan `testVps`/`vpsConsole` ke `vi.hoisted` + mock, dan test render tombol:

Ubah baris hoisted+mock:
```ts
const { updateVps, testVps, vpsConsole } = vi.hoisted(() => ({
  updateVps: vi.fn(), testVps: vi.fn(async () => ({ ok: true, out: "" })), vpsConsole: vi.fn(async () => ({ id: "vpsc-v1" })),
}));
vi.mock("../src/api/client", () => ({
  api: { listVps: vi.fn(async () => [VPS]), updateVps, testVps, vpsConsole },
  ApiError: class extends Error {},
}));
```

Tambah test:
```ts
it("tombol Console memanggil api.vpsConsole lalu pindah ke terminal", async () => {
  const onGotoTerminal = vi.fn();
  render(<VpsScreen onToast={() => {}} onGotoTerminal={onGotoTerminal} />);
  await screen.findByText("web-1");
  fireEvent.click(screen.getByRole("button", { name: /console/i }));
  await vi.waitFor(() => expect(vpsConsole).toHaveBeenCalledWith("v1"));
  await vi.waitFor(() => expect(onGotoTerminal).toHaveBeenCalled());
});
it("tombol Test memanggil api.testVps", async () => {
  render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
  await screen.findByText("web-1");
  fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
  await vi.waitFor(() => expect(testVps).toHaveBeenCalledWith("v1"));
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test vps-screen.test.tsx -t "Console\|Test"`
Expected: FAIL (tombol belum ada → `getByRole` throw).

- [x] **Step 3: Implementasi** — di `src/src/screens/VpsScreen.tsx`, dalam `VpsScreen`, tambah handler setelah `const session = …`:
```ts
  const testConn = (v: VpsView) => run("test", v.id, async () => {
    const r = await api.testVps(v.id);
    if (!r.ok) throw new Error(r.out);
  }, `${v.name} · koneksi ok`);
  const openConsole = (v: VpsView) =>
    run("console", v.id, async () => { await api.vpsConsole(v.id); onGotoTerminal(); }, `${v.name} · console dibuka`);
```

Di baris aksi per-VPS, tambah dua tombol sebelum tombol Audit:
```tsx
              <Button size="sm" variant="ghost" leftIcon="plug-zap" loading={busy === `test:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void testConn(v); }}>Test</Button>
              <Button size="sm" variant="ghost" leftIcon="terminal-square" loading={busy === `console:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void openConsole(v); }}>Console</Button>
```

- [x] **Step 4: Jalankan, pastikan hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test vps-screen.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/VpsScreen.tsx src/test/vps-screen.test.tsx
git commit -m "feat(web): tombol Test connection & Open Console di VpsScreen (SPEC-211)"
```

---

### Task 5: SoT docs + ADR-0042

**Files:**
- Create: `internal/docs/adr/0042-vps-console-ssh-tmux-lokal.md`
- Modify: `internal/docs/README.md` (index adr)
- Modify: `internal/docs/architecture/api-contract.md` (seksi VPS)
- Modify: `internal/docs/requirements/prd.md` (§7 VPS)
- Modify: `internal/docs/frontend/frontend-implementation.md` (baris 5, deskripsi VPS)

- [x] **Step 1: Tulis ADR-0042** — `internal/docs/adr/0042-vps-console-ssh-tmux-lokal.md`:

```markdown
# ADR-0042 — Open Console = ssh mentah di tmux hanoman lokal (bukan tmux remote)

Status: diterima · SPEC-211 · 2026-07-14

## Konteks
Modul VPS butuh "Open Console": buka shell ssh ke server. Dua bentuk mungkin —
(a) `ssh user@host` di-host tmux hanoman lokal, atau (b) `ssh -t … tmux new -A` yang
menyerahkan sesi ke tmux DI remote VPS.

## Keputusan
Pakai (a). `POST /vps/:id/console` men-spawn `ssh -t -p … [-i key] user@host` lewat
`createSession({ command })` — cabang di `pty.ts` yang melewati argv claude sepenuhnya.
Sesi hidup di pane tmux hanoman (ADR-0016), reattach lewat WS terminal yang sama.

## Alasan
- Reuse penuh infra sesi (attach/scrollback/WS/kill) — nyaris nol kode baru.
- Tanpa dependency `tmux` terpasang di VPS (opsi b gagal di VPS minimal).
- Konsisten dengan "Sesi Claude" (`/vps/:id/session`) yang sudah ada.
- Persistensi cukup: sesi selamat dari refresh browser & restart API.

## Konsekuensi
- Bila koneksi ssh putus (jaringan), shell remote mati — tak ada tmux remote yang menahannya.
  Bila kelak butuh, tambah opsi `tmux new -A` di sisi remote (perlu tmux di VPS).
- Console = shell root/sudo mentah lewat key server; trust boundary sama dengan
  `/vps/:id/session` & `/harden` (bind 127.0.0.1, tanpa auth per-route).

## Test connection
Bagian yang sama (SPEC-211): `POST /vps/:id/test` = `sshExec(v,"true")`, cek key-only
berhasil sekarang; transien, tak menyentuh DB.
```

- [x] **Step 2: Tambah baris index adr** — di `internal/docs/README.md`, di bawah `## adr`, sebelum baris `0041`:
```markdown
- [0042 — Open Console = ssh mentah di tmux hanoman lokal, bukan tmux remote](adr/0042-vps-console-ssh-tmux-lokal.md)
```

- [x] **Step 3: Update api-contract** — di `internal/docs/architecture/api-contract.md`, seksi VPS, ganti judul dan tambah dua baris setelah `POST /vps/:id/session`:
```
## VPS (SPEC-164 · ADR-0025 · SPEC-211/ADR-0042)
```
```
POST   /vps/:id/test                 # 200 { ok, out } — ssh `true` key-only, transien · 404
POST   /vps/:id/console              # 201 { id } — shell ssh MENTAH di tmux hanoman (ADR-0042) · 404
```

- [x] **Step 4: Update prd.md** — di `internal/docs/requirements/prd.md`, §7 VPS, tambah baris setelah baris "Buka sesi `claude`…":
```markdown
- Test connection (`ssh true` key-only, transien) & Open Console (shell ssh mentah di tmux hanoman, ADR-0042) per VPS (SPEC-211).
```

- [x] **Step 5: Update frontend-implementation.md** — di baris 5, ganti `VPS (daftar + audit/harden + buka sesi)` jadi `VPS (daftar + audit/harden + Test connection + Open Console shell ssh + buka sesi Claude, SPEC-211)`.

- [x] **Step 6: Verifikasi coverage docs tetap hijau (tanpa boot server)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared test coverage 2>/dev/null || node --experimental-strip-types shared/src/coverage.ts 2>/dev/null || echo "cek manual: semua doc tertaut di index"`
Expected: tak ada doc yatim (ADR-0042 tertaut di README).

- [x] **Step 7: Commit**

```bash
git add internal/docs/adr/0042-vps-console-ssh-tmux-lokal.md internal/docs/README.md internal/docs/architecture/api-contract.md internal/docs/requirements/prd.md internal/docs/frontend/frontend-implementation.md
git commit -m "docs(sot): ADR-0042 Open Console + api-contract/prd/frontend (SPEC-211)"
```

---

### Task 6: Smoke nyata di local (CLAUDE.md)

**Files:** none (verifikasi).

- [x] **Step 1: Boot server terhadap DB throwaway ter-migrate** (bukan hanoman_test — sibling test bisa truncate; lihat memory live-smoke). Buat DB sekali, `migrate deploy`, boot di port non-8787.

- [x] **Step 2: Daftarkan VPS dummy lalu curl `/test` & `/console`:**
```bash
# ganti PORT sesuai boot; VPS dummy tak perlu reachable untuk membuktikan bentuk response
curl -s -XPOST localhost:PORT/api/vps -H 'content-type: application/json' \
  -d '{"name":"smoke","host":"203.0.113.99","user":"deploy"}'   # → { id }
curl -s -XPOST localhost:PORT/api/vps/<id>/test    # → { ok:false, out:"...timed out/refused..." } (host palsu) — bentuk benar
curl -s -XPOST localhost:PORT/api/vps/<id>/console # → { id:"vpsc-<id>" } (butuh tmux di PATH)
curl -s localhost:PORT/api/terminal/sessions | grep vps-console   # sesi console muncul
```
Expected: `/test` balas `{ ok, out }` (ok=false untuk host palsu, itu benar), `/console` balas `{ id: "vpsc-…" }`, sesi muncul di daftar terminal. Bersihkan: hapus VPS + `tmux -L hanoman kill-server` bila perlu.

- [x] **Step 3: Centang semua kotak plan, commit ceklis.**

- [x] **Step 4: Verifikasi seluruh suite hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm -r test`
Expected: PASS (server pakai `--no-file-parallelism` bila diperlukan; lihat memory prisma-generate).

---

## Self-Review

- **Spec coverage:** Test connection → Task 3+4. Open Console → Task 1+2+3+4. ADR/keputusan lokal-tmux → Task 5. Trust boundary → dicatat ADR-0042. Smoke nyata → Task 6. ✅
- **Placeholder scan:** tak ada TBD/TODO; tiap step memuat kode/perintah nyata. ✅
- **Type consistency:** `command?: string[]` (Task 1) dipakai `consoleArgv(): string[]` (Task 2) via route (Task 3); `testVps`/`vpsConsole` konsisten di paths→client→UI. `id` sesi `vpsc-<id>` konsisten route↔test. ✅
