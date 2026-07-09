# Terminal Claude Code di UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuka sesi `claude --dangerously-skip-permissions` interaktif dari UI hanoman, beberapa sesi sekaligus, tanpa terminal.

**Architecture:** `node-pty` men-spawn claude di TTY sungguhan di dalam proses server API; byte-nya dialirkan lewat WebSocket ke `xterm.js` di browser. PTY dan scrollback hidup di server, jadi browser boleh reconnect kapan saja. Tidak ada queue, tidak ada worker, tidak ada runner.

**Tech Stack:** Fastify 4, `@fastify/websocket@^10`, `node-pty@^1.1.0`, React 18, `@xterm/xterm@^6`, `@xterm/addon-fit@^0.11`, vitest.

Spec: `docs/superpowers/specs/2026-07-09-terminal-claude-di-ui-design.md`

## Global Constraints

- TypeScript strict. `tsconfig.base.json` menyalakan `noUncheckedIndexedAccess` dan `verbatimModuleSyntax` — indeks array bertipe `T | undefined`, dan `import type` wajib untuk import yang hanya tipe.
- `@fastify/websocket` **harus** versi `^10`. Versi 11 mensyaratkan Fastify 5; repo ini di Fastify 4.
- Signature handler WebSocket pada v10 adalah `(socket: WebSocket, request: FastifyRequest)` — bukan `(connection, req)` gaya v8. Sudah diverifikasi terhadap `types/index.d.ts` v10.0.1.
- Test server berjalan sekuensial (`fileParallelism: false`) terhadap database `_test` yang terpisah. Jangan pernah menunjuk ke `DATABASE_URL` yang asli.
- Binary claude di-resolve lewat `process.env.HANOMAN_CLAUDE_BIN ?? "claude"` — variabel yang sudah dipakai `runner/src/claude-cli.ts`. Test menukar binary lewat variabel ini, bukan lewat spawner yang disuntik.
- Bahasa pesan ke pengguna: Indonesia, mengikuti route yang sudah ada.
- Setiap task meng-update `internal/docs` yang tersentuh **dalam commit yang sama** (aturan `CLAUDE.md`).

## Temuan yang sudah diverifikasi (jangan diulang)

Dijalankan sungguhan pada Node v24.11.1 / darwin-arm64 / pnpm 11.10.0 saat plan ini ditulis:

1. `node-pty@1.1.0` **tidak** perlu dikompilasi di darwin-arm64 — tarball-nya membawa prebuild `prebuilds/darwin-arm64/{pty.node,spawn-helper}`. Xcode CLT tidak dibutuhkan.
2. Namun `spawn-helper` di-publish dengan mode `0644`. Tanpa exec bit, setiap `spawn()` gagal dengan `Error: posix_spawnp failed.` Ini terjadi di npm maupun pnpm — mode itu tersimpan di dalam tarball.
3. `chmod +x` pada `spawn-helper` **cukup** agar runtime-nya jalan.
4. Sesudah chmod: `spawn` → `onData` → `onExit(0)`, `write()` (echo balik lewat line discipline), `resize()`, dan `kill()` semuanya berfungsi.

Dikoreksi saat eksekusi Task 1:

5. `allowBuilds: { node-pty: true }` di `pnpm-workspace.yaml` **wajib**, bukan opsional. Tanpa itu pnpm memblokir script node-pty dan setiap `pnpm exec` di repo ini mati dengan `ERR_PNPM_IGNORED_BUILDS`. Nilai `true` benar di kedua OS: `scripts/prebuild.js` keluar 0 di darwin (prebuild ada, tidak ada yang dibangun) dan keluar 1 di Linux, jatuh ke `node-gyp rebuild`.
6. `pnpm install` melewati `postinstall` proyek workspace bila tree sudah up-to-date, jadi chmod-nya tidak bisa diandalkan sendirian. `createSession` karena itu menerjemahkan `posix_spawnp failed` menjadi pesan yang menyebut perintah obatnya.
7. **`/bin/cat` bukan pengganti binary claude yang sah.** `createSession` selalu menambahkan `--dangerously-skip-permissions`, dan cat mati seketika dengan "illegal option". Test memakai `server/test/fixtures/fake-claude.sh`, yang mencetak argv-nya lalu `exec cat` — sekaligus membuktikan flag-nya sungguh diteruskan. `/bin/echo` tetap sah untuk test exit.

## Temuan keamanan yang mengubah spec

Spec berasumsi "server bind ke localhost". Itu **salah**. `server/src/server.ts:4` saat ini:

```ts
app.listen({ port, host: "0.0.0.0" })
```

Mengekspos PTY tak terautentikasi di `0.0.0.0` berarti menyerahkan shell ke siapa pun di jaringan yang sama. Task 2 memperbaiki bind ini menjadi `127.0.0.1` secara default, dengan override lewat `HOST`. Ini juga menutup `/api/fs/browse` yang sudah lebih dulu mengekspos seluruh filesystem.

## File structure

| File | Tanggung jawab |
|---|---|
| `server/src/services/pty.ts` (baru) | Siklus hidup sesi PTY: spawn, scrollback, broadcast, kill. Tidak tahu apa-apa soal HTTP maupun Prisma. |
| `server/test/pty.test.ts` (baru) | Unit test service di atas, memakai PTY asli dengan `/bin/echo` dan fixture di bawah. |
| `server/test/fixtures/fake-claude.sh` (baru) | Berdiri sebagai `claude` di test: cetak argv, lalu `exec cat`. |
| `server/src/routes/terminal.ts` (baru) | REST + WebSocket di atas service. Tahu Prisma (resolve `repoDir`), tidak tahu `node-pty`. |
| `server/test/terminal.route.test.ts` (baru) | Integration test lewat `app.listen({port:0})` + klien `ws`. |
| `server/src/app.ts` | Register plugin websocket + route terminal + hook `onClose`. |
| `server/src/server.ts` | Bind `127.0.0.1` secara default. |
| `server/package.json` | Dependency baru, `postinstall` chmod, esbuild externals. |
| `shared/src/dto.ts`, `shared/src/api.ts` | Skema `zTerminalSession` + path. |
| `src/src/api/client.ts` | Tiga method REST + tipe `TerminalSession`. |
| `src/src/screens/TerminalScreen.tsx` (baru) | Tab strip + viewport xterm. |
| `src/src/ds/shell.tsx`, `src/src/App.tsx` | Nav item + wiring screen. |
| `src/vite.config.ts` | Proxy `/api` harus meneruskan upgrade WebSocket. |

---

### Task 1: PTY session service

Service ini murni: tidak menyentuh Prisma dan tidak menyentuh Fastify, sehingga bisa diuji tanpa HTTP.

**Files:**
- Modify: `server/package.json` (dependency + postinstall)
- Create: `server/src/services/pty.ts`
- Test: `server/test/pty.test.ts`
- Modify: `internal/docs/architecture/stack.md`

**Interfaces:**
- Consumes: tidak ada.
- Produces:
  - `type Frame = { t: "data"; d: string } | { t: "exit"; code: number }`
  - `type Client = { send(msg: string): void; close(): void }`
  - `type Session = { id, projectId, cwd, pty, scrollback, exited, exitCode?, clients }`
  - `type SessionInfo = { id: string; projectId: string; cwd: string; exited: boolean }`
  - `createSession(projectId: string, cwd: string): Session`
  - `getSession(id: string): Session | undefined`
  - `listSessions(): SessionInfo[]`
  - `killSession(id: string): boolean`
  - `killAll(): void`
  - `attach(s: Session, c: Client): void`
  - `detach(s: Session, c: Client): void`
  - `writeTo(s: Session, d: string): void`
  - `resize(s: Session, cols: number, rows: number): void`

- [x] **Step 1: Pasang dependency dan perbaiki exec bit `spawn-helper`**

```bash
pnpm --filter ./server add node-pty@^1.1.0
pnpm --filter ./server add -D ws@^8.18.0
```

`ws` dipakai **hanya** sebagai klien di test Task 2; ia sudah membawa type declaration-nya sendiri, jadi `@types/ws` tidak perlu.

Lalu tambahkan `postinstall` ke `server/package.json` (letakkan tepat sebelum `"dev"`):

```json
"postinstall": "chmod +x node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true",
```

Ini bukan kehati-hatian yang mengada-ada. node-pty mem-publish `spawn-helper` dengan mode `0644`; tanpa exec bit setiap spawn mati dengan `posix_spawnp failed`. `|| true` menjaga perintah tetap lolos di Linux, di mana `prebuilds/` tidak punya direktori yang cocok dan node-pty dikompilasi dari source. Dengan pnpm, `node_modules/node-pty` adalah symlink ke store global, jadi chmod ini mengubah file di store — idempoten dan tidak berbahaya.

`pnpm add` akan mengeluh `ERR_PNPM_IGNORED_BUILDS` dan menaruh baris placeholder di `pnpm-workspace.yaml`. Sampai baris itu diisi, **setiap** perintah pnpm di repo ini gagal. Isi:

```yaml
  # Di darwin scripts/prebuild.js keluar 0 (prebuild ada) dan tidak ada yang dibangun.
  # Di linux tidak ada prebuild, jadi ia jatuh ke node-gyp rebuild. `true` benar di keduanya.
  node-pty: true
```

Lalu `pnpm install`, dan jalankan chmod-nya sekali karena `pnpm add` sudah terlanjur berjalan tanpa hook itu:

```bash
pnpm --filter ./server run postinstall
```

- [x] **Step 2: Tulis test yang gagal**

Buat `server/test/pty.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createSession, getSession, listSessions, killSession, killAll, attach, writeTo } from "../src/services/pty";

// Klien palsu yang merekam frame — cukup untuk menguji kontrak broadcast.
function fakeClient() {
  const frames: { t: string; d?: string; code?: number }[] = [];
  let closed = false;
  return {
    frames, wasClosed: () => closed,
    send: (m: string) => { frames.push(JSON.parse(m)); },
    close: () => { closed = true; },
  };
}
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const lastFrame = (c: ReturnType<typeof fakeClient>) => c.frames[c.frames.length - 1];
const allData = (c: ReturnType<typeof fakeClient>) =>
  c.frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join("");

afterEach(() => { killAll(); });

describe("pty service", () => {
  it("spawns the claude binary with --dangerously-skip-permissions and reports its exit", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    const c = fakeClient();
    attach(s, c);
    await waitFor(() => lastFrame(c)?.t === "exit");
    expect(allData(c)).toContain("--dangerously-skip-permissions");
    expect(lastFrame(c)).toEqual({ t: "exit", code: 0 });
    expect(c.wasClosed()).toBe(true);
  });

  it("replays scrollback to a client that attaches after the process already exited", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => s.exited);
    const late = fakeClient();
    attach(s, late);
    expect(allData(late)).toContain("--dangerously-skip-permissions");
    expect(lastFrame(late)).toEqual({ t: "exit", code: 0 });
  });

  it("forwards stdin to a live process and keeps it listed", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p2", process.cwd());
    const c = fakeClient();
    attach(s, c);
    writeTo(s, "halo\n");
    await waitFor(() => allData(c).includes("halo"));
    expect(listSessions()).toEqual([{ id: s.id, projectId: "p2", cwd: process.cwd(), exited: false }]);
    expect(getSession(s.id)).toBe(s);
  });

  it("killSession stops the process and forgets the session; a second kill is false", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p3", process.cwd());
    expect(killSession(s.id)).toBe(true);
    expect(listSessions()).toEqual([]);
    expect(getSession(s.id)).toBeUndefined();
    expect(killSession(s.id)).toBe(false);
  });
});
```

- [x] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/pty.test.ts`
Expected: FAIL — `Failed to resolve import "../src/services/pty"`.

- [x] **Step 4: Tulis implementasi minimal**

Buat `server/src/services/pty.ts`:

```ts
import { spawn, type IPty } from "node-pty";
import { randomUUID } from "node:crypto";

// Cukup untuk mengembalikan satu layar penuh plus riwayat, tanpa menahan memori tak
// terbatas untuk sesi yang menyala berhari-hari.
const MAX_SCROLLBACK = 256 * 1024;

export type Frame = { t: "data"; d: string } | { t: "exit"; code: number };
// Sengaja bukan `WebSocket`: service ini tidak boleh tahu soal transport, dan test
// menyuntikkan perekam frame biasa.
export type Client = { send(msg: string): void; close(): void };

export type Session = {
  id: string; projectId: string; cwd: string; pty: IPty;
  scrollback: string; exited: boolean; exitCode?: number; clients: Set<Client>;
};
export type SessionInfo = { id: string; projectId: string; cwd: string; exited: boolean };

const sessions = new Map<string, Session>();

// Variabel yang sama yang dipakai runner/src/claude-cli.ts.
const claudeBin = () => process.env.HANOMAN_CLAUDE_BIN ?? "claude";

function broadcast(s: Session, f: Frame): void {
  const msg = JSON.stringify(f);
  for (const c of s.clients) c.send(msg);
}

// node-pty mem-publish prebuilds/*/spawn-helper dengan mode 0644. Tanpa exec bit setiap
// fork mati dengan "posix_spawnp failed", pesan yang tidak menyebut node-pty sama sekali.
// `postinstall` di package.json memperbaikinya, tapi pnpm melewati script itu saat tree
// sudah up-to-date — jadi terjemahkan errornya alih-alih membiarkan orang menebak.
function spawnPty(cwd: string): IPty {
  try {
    return spawn(claudeBin(), ["--dangerously-skip-permissions"], {
      cwd, name: "xterm-256color", cols: 80, rows: 24,
      env: process.env as Record<string, string>,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes("posix_spawnp")) throw e;
    throw new Error(
      `${msg} — spawn-helper node-pty kemungkinan kehilangan exec bit. ` +
      `Jalankan: pnpm --filter ./server run postinstall`,
    );
  }
}

export function createSession(projectId: string, cwd: string): Session {
  const pty = spawnPty(cwd);
  const s: Session = {
    id: randomUUID().slice(0, 8), projectId, cwd, pty,
    scrollback: "", exited: false, clients: new Set(),
  };
  pty.onData((d) => {
    s.scrollback = (s.scrollback + d).slice(-MAX_SCROLLBACK);
    broadcast(s, { t: "data", d });
  });
  // Sesi TIDAK dihapus dari map di sini: output terakhir sebuah run yang mati harus
  // masih bisa dibaca sampai pengguna menutup tabnya sendiri.
  pty.onExit(({ exitCode }) => {
    s.exited = true;
    s.exitCode = exitCode;
    broadcast(s, { t: "exit", code: exitCode });
    for (const c of s.clients) c.close();
    s.clients.clear();
  });
  sessions.set(s.id, s);
  return s;
}

export const getSession = (id: string): Session | undefined => sessions.get(id);

export const listSessions = (): SessionInfo[] =>
  [...sessions.values()].map(({ id, projectId, cwd, exited }) => ({ id, projectId, cwd, exited }));

export function killSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  if (!s.exited) s.pty.kill();
  sessions.delete(id);
  return true;
}

export function killAll(): void {
  for (const id of [...sessions.keys()]) killSession(id);
}

// Scrollback lebih dulu, baru live — inilah yang membuat reconnect terlihat mulus.
export function attach(s: Session, c: Client): void {
  s.clients.add(c);
  if (s.scrollback) c.send(JSON.stringify({ t: "data", d: s.scrollback } satisfies Frame));
  if (s.exited) {
    c.send(JSON.stringify({ t: "exit", code: s.exitCode ?? 0 } satisfies Frame));
    s.clients.delete(c);
    c.close();
  }
}

export const detach = (s: Session, c: Client): void => { s.clients.delete(c); };

export function writeTo(s: Session, d: string): void { if (!s.exited) s.pty.write(d); }

export function resize(s: Session, cols: number, rows: number): void {
  if (!s.exited) s.pty.resize(cols, rows);
}
```

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/pty.test.ts`
Expected: PASS, 4 test.

Kalau muncul `Error: posix_spawnp failed.`, Step 1 chmod-nya tidak jalan. Ulangi:
`pnpm --filter ./server exec chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`

- [x] **Step 6: Typecheck**

Run: `pnpm --filter ./server typecheck`
Expected: keluar tanpa error.

- [x] **Step 7: Update stack.md**

Tambahkan dua baris ke tabel di `internal/docs/architecture/stack.md`, tepat setelah baris `Scheduler`:

```markdown
| Terminal (server) | node-pty | sesi `claude` interaktif butuh TTY sungguhan |
| Terminal (web) | xterm.js | render TUI Claude Code apa adanya |
```

- [x] **Step 8: Commit**

```bash
git add server/package.json server/src/services/pty.ts server/test/pty.test.ts internal/docs/architecture/stack.md pnpm-lock.yaml
git commit -m "feat(server): service sesi PTY untuk claude interaktif"
```

---

### Task 2: REST + WebSocket, dan bind ke localhost

**Files:**
- Modify: `shared/src/dto.ts`, `shared/src/api.ts`
- Create: `server/src/routes/terminal.ts`
- Modify: `server/src/app.ts`, `server/src/server.ts`, `server/package.json` (esbuild externals)
- Test: `server/test/terminal.route.test.ts`
- Create: `internal/docs/adr/0014-pty-terminal-di-proses-api.md`
- Modify: `internal/docs/architecture/api-contract.md`

**Interfaces:**
- Consumes: seluruh export Task 1.
- Produces:
  - `zTerminalSession = z.object({ project: z.string() })` dari `@hanoman/shared`
  - `paths.terminalSessions: string`
  - `paths.terminalSession(id: string): string`
  - `paths.terminalWs(id: string): string`
  - `GET /api/terminal/sessions` → `SessionInfo[]`
  - `POST /api/terminal/sessions` `{project}` → `201 {id}` · `404` · `400`
  - `DELETE /api/terminal/sessions/:id` → `204` · `404`
  - `GET /api/terminal/sessions/:id/ws` → WebSocket, tutup `4004` bila sesi tak ada

- [ ] **Step 1: Pasang `@fastify/websocket`**

```bash
pnpm --filter ./server add @fastify/websocket@^10
```

Versi ini wajib. `^11` menarik `fastify-plugin@^5` dan menolak Fastify 4.

- [ ] **Step 2: Tulis test yang gagal**

Buat `server/test/terminal.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { resetDb, makeProject } from "./factory";

// Lihat pty.test.ts: /bin/cat mati karena --dangerously-skip-permissions ilegal baginya.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

const app = buildApp();
let origin = "";
let repoDir = "";

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};

type Frame = { t: string; d?: string; code?: number };
function connect(id: string) {
  const ws = new WebSocket(`ws://${origin}/api/terminal/sessions/${id}/ws`);
  const frames: Frame[] = [];
  ws.on("message", (raw: Buffer) => { frames.push(JSON.parse(raw.toString())); });
  const opened = new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  const data = () => frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join("");
  return { ws, frames, opened, data };
}
const createSession = async () => {
  const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "p1" } });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};

beforeAll(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "hanoman-term-"));
  await resetDb();
  await makeProject({ id: "p1", repoDir });
  await makeProject({ id: "p2", name: "p2", repoDir: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); });

describe("terminal routes", () => {
  it("streams pty output and the exit code over the websocket", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("--dangerously-skip-permissions");
    expect(c.frames.find((f) => f.t === "exit")).toEqual({ t: "exit", code: 0 });
    c.ws.close();
  });

  it("forwards stdin, and replays scrollback to a reconnecting client", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const first = connect(id);
    await first.opened;
    first.ws.send(JSON.stringify({ t: "in", d: "halo\n" }));
    await waitFor(() => first.data().includes("halo"));
    first.ws.close();

    const second = connect(id);
    await second.opened;
    await waitFor(() => second.data().includes("halo"));
    second.ws.close();
  });

  it("accepts a resize without killing the session", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    c.ws.send(JSON.stringify({ t: "resize", cols: 120, rows: 40 }));
    c.ws.send(JSON.stringify({ t: "in", d: "masih hidup\n" }));
    await waitFor(() => c.data().includes("masih hidup"));
    expect(c.frames.some((f) => f.t === "exit")).toBe(false);
    c.ws.close();
  });

  it("lists sessions, and DELETE removes one exactly once", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const list = await app.inject({ url: "/api/terminal/sessions" });
    expect(list.json().map((s: { id: string }) => s.id)).toContain(id);

    const del = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
    expect(del.statusCode).toBe(204);
    const again = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
    expect(again.statusCode).toBe(404);

    const after = await app.inject({ url: "/api/terminal/sessions" });
    expect(after.json().map((s: { id: string }) => s.id)).not.toContain(id);
  });

  it("404s an unknown project and 400s a project with no repoDir", async () => {
    const missing = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "nope" } });
    expect(missing.statusCode).toBe(404);
    const noDir = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "p2" } });
    expect(noDir.statusCode).toBe(400);
  });

  it("closes the socket for an unknown session id", async () => {
    const c = connect("tidakada");
    c.opened.catch(() => {}); // socket ini memang ditutup; jangan biarkan rejection-nya menganggur
    const code = await new Promise<number>((res) => c.ws.on("close", (n: number) => res(n)));
    expect(code).toBe(4004);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/terminal.route.test.ts`
Expected: FAIL — semua `POST /api/terminal/sessions` mengembalikan 404 karena route-nya belum ada.

- [ ] **Step 4: Tambahkan skema dan path ke `shared`**

Di akhir `shared/src/dto.ts`, setelah `zCommand`:

```ts
export const zTerminalSession = z.object({ project: z.string() });
```

Di `shared/src/api.ts`, di dalam objek `paths`, setelah baris `fsBrowse`:

```ts
  terminalSessions: `${API}/terminal/sessions`,
  terminalSession: (id: string) => `${API}/terminal/sessions/${id}`,
  terminalWs: (id: string) => `${API}/terminal/sessions/${id}/ws`,
```

- [ ] **Step 5: Tulis route**

Buat `server/src/routes/terminal.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { zTerminalSession } from "@hanoman/shared";
import {
  createSession, getSession, listSessions, killSession,
  attach, detach, writeTo, resize, type Client,
} from "../services/pty";

// Sebuah PTY di atas WebSocket adalah remote code execution secara desain — identik
// dengan menyerahkan shell. hanoman tidak punya autentikasi; satu-satunya yang berdiri
// di antara endpoint ini dan jaringan adalah server.ts yang bind ke 127.0.0.1.
// Bila HOST pernah diubah ke 0.0.0.0, endpoint inilah yang pertama harus digembok.
export default async function (app: FastifyInstance) {
  app.get("/terminal/sessions", async () => listSessions());

  app.post("/terminal/sessions", async (req, reply) => {
    const parsed = zTerminalSession.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!project.repoDir) return reply.code(400).send({ error: `project "${project.id}" belum punya repoDir` });
    const s = createSession(project.id, project.repoDir);
    return reply.code(201).send({ id: s.id });
  });

  app.delete("/terminal/sessions/:id", async (req, reply) => {
    const ok = killSession((req.params as { id: string }).id);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
  });

  app.get("/terminal/sessions/:id/ws", { websocket: true }, (socket, req) => {
    const s = getSession((req.params as { id: string }).id);
    if (!s) return socket.close(4004, "not found");
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    attach(s, client);
    socket.on("message", (raw: Buffer) => {
      let m: { t?: string; d?: string; cols?: number; rows?: number };
      // ponytail: frame rusak dibuang diam-diam — pengirimnya UI kita sendiri.
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "in" && typeof m.d === "string") writeTo(s, m.d);
      else if (m.t === "resize" && m.cols && m.rows) resize(s, m.cols, m.rows);
    });
    socket.on("close", () => detach(s, client));
  });
}
```

- [ ] **Step 6: Register plugin, route, dan hook shutdown**

Di `server/src/app.ts`, tambahkan import:

```ts
import websocket from "@fastify/websocket";
import terminal from "./routes/terminal";
import { killAll } from "./services/pty";
```

Tepat sebelum `app.register(async (api) => {`, tambahkan:

```ts
  // fastify-plugin'd, jadi dekoratornya menurun ke scope /api di bawah.
  app.register(websocket);
  // Sebuah PTY yatim akan menahan proses tetap hidup setelah server ditutup.
  app.addHook("onClose", async () => { killAll(); });
```

Di dalam callback `app.register(async (api) => {…})`, setelah `await api.register(fs);`:

```ts
    await api.register(terminal);
```

- [ ] **Step 7: Bind ke localhost**

Ganti `server/src/server.ts` seluruhnya:

```ts
import { buildApp } from "./app";
const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
// Localhost secara default. hanoman tidak punya auth, dan /api/terminal menyerahkan
// PTY sungguhan — bind ke 0.0.0.0 berarti membagikan shell ke seluruh jaringan.
// Override lewat HOST hanya bila ada lapisan autentikasi di depannya.
const host = process.env.HOST ?? "127.0.0.1";
app.listen({ port, host }).then(() => console.log(`hanoman api ${host}:${port}`));
```

- [ ] **Step 8: Tambahkan esbuild externals**

Di `server/package.json`, tambahkan dua flag ke akhir script `build`:

```
--external:node-pty --external:@fastify/websocket
```

`node-pty` membawa binary `.node`; esbuild tidak bisa mem-bundle-nya. Tanpa flag ini `pnpm build` gagal.

- [ ] **Step 9: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/terminal.route.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 10: Typecheck, build, dan seluruh suite server**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
pnpm --filter ./server build
pnpm --filter ./server test
```

Expected: ketiganya lulus. Kalau `build` mengeluh soal `pty.node`, Step 8 terlewat.

Catatan: `server/test/queue-durability.test.ts` sudah gagal sebelum plan ini — itu bukan regresi dari task ini.

- [ ] **Step 11: Uji API-nya secara nyata di local (wajib per CLAUDE.md)**

Boot server dan pukul endpoint-nya sungguhan, bukan cuma lewat vitest:

```bash
pnpm --filter ./server dev &
sleep 3
curl -s localhost:8787/api/terminal/sessions
# → []
curl -s -X POST localhost:8787/api/terminal/sessions \
  -H 'content-type: application/json' -d '{"project":"nope"}' -i | head -1
# → HTTP/1.1 404 Not Found
```

Untuk membuktikan jalur PTY end-to-end, pakai project sungguhan yang punya `repoDir` (ambil satu id dari `curl -s localhost:8787/api/projects`), lalu:

```bash
curl -s -X POST localhost:8787/api/terminal/sessions \
  -H 'content-type: application/json' -d '{"project":"<ID>"}'
# → {"id":"xxxxxxxx"}
npx -y wscat -c "ws://localhost:8787/api/terminal/sessions/<id>/ws"
```

Harus muncul splash Claude Code. Ketik sesuatu, lihat balasannya, lalu Ctrl-C dan `DELETE` sesinya. Kalau claude tidak ada di PATH, sesi langsung mengirim `exit` — itu benar, dan memang begitulah UI akan menampilkannya.

Hentikan server dev sebelum lanjut.

- [ ] **Step 12: Tulis ADR-0014**

Buat `internal/docs/adr/0014-pty-terminal-di-proses-api.md`:

```markdown
# ADR-0014 — Sesi Claude Code interaktif lewat PTY di proses API

**Status:** accepted · 2026-07-09

## Konteks
Runner menjalankan claude non-interaktif (`-p --output-format stream-json`) untuk run
terjadwal. Tidak ada cara memakai Claude Code secara interaktif pada sebuah project
tanpa membuka terminal dan `cd` sendiri, padahal hanoman sudah tahu `repoDir` tiap project.

## Keputusan
`node-pty` men-spawn `claude --dangerously-skip-permissions` di TTY sungguhan, di dalam
**proses server API**, bukan worker. Byte PTY dialirkan apa adanya ke `xterm.js` lewat
WebSocket di `/api/terminal/sessions/:id/ws`. Sesi disimpan in-memory; scrollback 256 KB
terakhir di-replay saat klien reconnect. Restart server menghapus semua sesi.

Sesi berjalan di `Project.repoDir` — working tree utama. Larangan "jangan jalankan run di
working tree utama" berlaku untuk run yang di-orchestrate hanoman, bukan untuk pekerjaan
manual yang dipicu manusia, yang setara dengan membuka terminal sendiri.

## Konsekuensi
- Endpoint ini adalah remote code execution secara desain. `server.ts` karena itu bind ke
  `127.0.0.1` secara default; `HOST=0.0.0.0` sekarang menjadi keputusan sadar, dan menuntut
  autentikasi di depannya lebih dulu.
- PTY hidup di proses API, jadi API tidak lagi stateless. Menjalankan dua instance API di
  belakang load balancer akan memecah sesi. Belum jadi masalah: hanoman single-process.
- `node-pty` mem-publish `spawn-helper` tanpa exec bit; `postinstall` di `server/package.json`
  memperbaikinya. Di Linux node-pty dikompilasi dari source dan butuh `node-pty: true`
  di `allowBuilds` pada `pnpm-workspace.yaml`.

## Ditolak
- **`script -q /dev/null claude`** untuk menghindari native module: flag berbeda antar OS,
  dan tanpa SIGWINCH resize tidak sampai ke claude sehingga TUI-nya rusak.
- **`ttyd` di dalam iframe**: nol kode server, tapi menambah daemon dan port kedua, dan
  sesinya tak terlihat oleh API hanoman.
```

- [ ] **Step 13: Update api-contract.md**

Tambahkan di akhir `internal/docs/architecture/api-contract.md`:

```markdown
## Terminal
```
GET    /terminal/sessions            # [{ id, projectId, cwd, exited }]
POST   /terminal/sessions  {project} # 201 { id } · 404 project · 400 tanpa repoDir
DELETE /terminal/sessions/:id        # 204 · 404
GET    /terminal/sessions/:id/ws     # WebSocket; close 4004 bila sesi tak ada
#   server→klien: { t:"data", d } · { t:"exit", code }
#   klien→server: { t:"in", d } · { t:"resize", cols, rows }
#   PTY menjalankan `claude --dangerously-skip-permissions` di Project.repoDir.
#   RCE by design — lihat ADR-0014. Server bind 127.0.0.1 secara default.
```
```

- [ ] **Step 14: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts server/src/routes/terminal.ts \
  server/src/app.ts server/src/server.ts server/package.json \
  server/test/terminal.route.test.ts \
  internal/docs/adr/0014-pty-terminal-di-proses-api.md \
  internal/docs/architecture/api-contract.md pnpm-lock.yaml
git commit -m "feat(server): endpoint terminal PTY + bind localhost by default"
```

---

### Task 3: Screen Terminal di UI

**Files:**
- Modify: `src/package.json`, `src/vite.config.ts`
- Modify: `src/src/api/client.ts`
- Create: `src/src/screens/TerminalScreen.tsx`
- Modify: `src/src/ds/shell.tsx`, `src/src/App.tsx`
- Test: `src/test/terminal-screen.test.tsx`
- Modify: `internal/docs/frontend/frontend-implementation.md`

**Interfaces:**
- Consumes: `paths.terminalSessions`, `paths.terminalSession(id)`, `paths.terminalWs(id)` dari Task 2.
- Produces:
  - `type TerminalSession = { id: string; projectId: string; cwd: string; exited: boolean }`
  - `api.listTerminals(): Promise<TerminalSession[]>`
  - `api.createTerminal(project: string): Promise<{ id: string }>`
  - `api.deleteTerminal(id: string): Promise<void>`
  - `<TerminalScreen projects={ProjectVM[]} />`

- [ ] **Step 1: Pasang xterm**

```bash
pnpm --filter ./src add @xterm/xterm@^6 @xterm/addon-fit@^0.11
```

- [ ] **Step 2: Loloskan upgrade WebSocket lewat proxy Vite**

Di `src/vite.config.ts`, ganti baris `server`:

```ts
  // ws:true wajib — tanpa itu proxy menjawab upgrade /api/terminal/... dengan 404 HTTP.
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
```

- [ ] **Step 3: Tulis test yang gagal**

Buat `src/test/terminal-screen.test.tsx`. Test ini sengaja menghindari me-mount `xterm`
(butuh canvas, yang tidak ada di jsdom); yang diuji adalah tab strip dan empty state.

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TerminalScreen } from "../src/screens/TerminalScreen";

vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid="pane">{sessionId}</div>,
}));
const listTerminals = vi.fn();
const createTerminal = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    deleteTerminal: vi.fn(),
  },
}));

const projects = [{ id: "p1", name: "hanoman" }];

beforeEach(() => { listTerminals.mockReset(); createTerminal.mockReset(); });

describe("TerminalScreen", () => {
  it("shows an empty state when there are no sessions", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByText("Belum ada sesi terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("pane")).toBeNull();
  });

  it("renders one tab per session and mounts a pane for the active one", async () => {
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111");
  });

  it("marks an exited session so it is visibly dead", async () => {
    listTerminals.mockResolvedValue([{ id: "cccc3333", projectId: "p1", cwd: "/repo", exited: true }]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByText(/berakhir/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Jalankan test, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/screens/TerminalScreen"`.

- [ ] **Step 5: Tambahkan method API**

Di `src/src/api/client.ts`, tambahkan tipe setelah `ApiError`:

```ts
export type TerminalSession = { id: string; projectId: string; cwd: string; exited: boolean };
```

dan tiga method di dalam objek `api`, setelah `browseFs`:

```ts
  listTerminals: () => j<TerminalSession[]>(paths.terminalSessions),
  createTerminal: (project: string) => j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project }) }),
  deleteTerminal: (id: string) => j<void>(paths.terminalSession(id), { method: "DELETE" }),
```

- [ ] **Step 6: Tulis `TerminalPane`**

Buat `src/src/screens/TerminalPane.tsx`. Dipisah dari screen supaya test bisa mem-mock-nya
tanpa menyeret `xterm` masuk ke jsdom.

```tsx
import React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { paths } from "@hanoman/shared";

export function TerminalPane({ sessionId, onExit }: { sessionId: string; onExit: (code: number) => void }) {
  const host = React.useRef<HTMLDivElement>(null);
  // onExit boleh berubah tiap render; menaruhnya di ref menjaga effect ini
  // hanya bergantung pada sessionId — remount = sesi yang benar-benar berbeda.
  const exitRef = React.useRef(onExit);
  exitRef.current = onExit;

  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const token = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
    const term = new Terminal({
      fontFamily: token("--font-mono", "monospace"),
      fontSize: 13, cursorBlink: true,
      theme: { background: token("--term-bg", "#1c1810"), foreground: token("--term-fg", "#e9e0cd") },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${scheme}//${location.host}${paths.terminalWs(sessionId)}`);
    const send = (m: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

    ws.onopen = () => { term.focus(); send({ t: "resize", cols: term.cols, rows: term.rows }); };
    ws.onmessage = (ev) => {
      const f = JSON.parse(ev.data as string) as { t: string; d?: string; code?: number };
      if (f.t === "data") term.write(f.d ?? "");
      else if (f.t === "exit") {
        term.write(`\r\n\x1b[33m— sesi berakhir (exit ${f.code}) —\x1b[0m\r\n`);
        exitRef.current(f.code ?? 0);
      }
    };
    const typed = term.onData((d) => send({ t: "in", d }));
    const ro = new ResizeObserver(() => {
      fit.fit();
      send({ t: "resize", cols: term.cols, rows: term.rows });
    });
    ro.observe(el);

    return () => { ro.disconnect(); typed.dispose(); ws.close(); term.dispose(); };
  }, [sessionId]);

  return <div ref={host} style={{ height: "100%", width: "100%", background: "var(--term-bg)", padding: 8, borderRadius: "var(--radius-sm)" }} />;
}
```

- [ ] **Step 7: Tulis `TerminalScreen`**

Buat `src/src/screens/TerminalScreen.tsx`:

```tsx
import React from "react";
import { Button, Select, StateBlock } from "../ds";
import { api, type TerminalSession } from "../api/client";
import { TerminalPane } from "./TerminalPane";

export function TerminalScreen({ projects }: { projects: { id: string; name: string }[] }) {
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [project, setProject] = React.useState(projects[0]?.id ?? "");

  React.useEffect(() => {
    api.listTerminals().then((list) => {
      setSessions(list);
      setActive((cur) => cur ?? list[0]?.id ?? null);
    }).catch(() => setSessions([]));
  }, []);

  async function open() {
    if (!project) return;
    const { id } = await api.createTerminal(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    setActive(id);
  }

  async function close(id: string) {
    await api.deleteTerminal(id).catch(() => {});
    setSessions((s) => {
      const next = s.filter((x) => x.id !== id);
      setActive((cur) => (cur === id ? next[0]?.id ?? null : cur));
      return next;
    });
  }

  const markExited = React.useCallback((id: string) => {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, exited: true } : x)));
  }, []);

  const current = sessions.find((s) => s.id === active) ?? null;
  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100vh - 180px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div role="tablist" style={{ display: "flex", gap: 6, flex: 1, minWidth: 0, overflowX: "auto" }}>
          {sessions.map((s) => (
            <div key={s.id} role="tab" aria-selected={s.id === active} onClick={() => setActive(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer",
                borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: 12,
                background: s.id === active ? "var(--brass-100)" : "var(--bone-200)",
                color: s.exited ? "var(--text-muted)" : "var(--text-body)",
                border: "1px solid var(--border-hair)",
              }}>
              <span>{nameOf(s.projectId)} · {s.id.slice(0, 6)}</span>
              {s.exited && <span style={{ color: "var(--status-warn)" }}>berakhir</span>}
              <span aria-label={`Tutup sesi ${s.id}`} onClick={(e) => { e.stopPropagation(); void close(s.id); }}
                style={{ color: "var(--text-subtle)" }}>×</span>
            </div>
          ))}
        </div>
        <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" onClick={() => void open()}>Sesi baru</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {current
          // key: pindah tab harus me-remount pane, bukan mendaur-ulang WebSocket lama.
          ? <TerminalPane key={current.id} sessionId={current.id} onExit={() => markExited(current.id)} />
          : <StateBlock kind="empty" icon="terminal" title="Belum ada sesi terminal"
              hint="Pilih project lalu buka sesi — hanoman menjalankan claude --dangerously-skip-permissions di direktori project itu."
              action={() => void open()} actionLabel="Sesi baru" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx`
Expected: PASS, 3 test.

- [ ] **Step 9: Tambahkan nav item**

Di `src/src/ds/shell.tsx`, sisipkan ke `HN_NAV` tepat sesudah entri `runs`:

```ts
  { key: "terminal", label: "Terminal", icon: "terminal" },
```

- [ ] **Step 10: Wiring di App.tsx**

Import di `src/src/App.tsx`, setelah import `RunsScreen`:

```ts
import { TerminalScreen } from "./screens/TerminalScreen";
```

Tambahkan cabang tepat sesudah blok `else if (section === "runs") { … }`:

```tsx
  } else if (section === "terminal") {
    screen = (
      <Shell active="terminal" title="Terminal" breadcrumb="Claude Code · sesi interaktif" onNavigate={setSection} wide>
        {gate(projectsView.length === 0
          ? <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="Terminal butuh project dengan repoDir untuk dijalankan."
              action={() => setModal("project")} actionLabel="Project baru" />
          : <TerminalScreen projects={projectsView} />)}
      </Shell>
    );
```

- [ ] **Step 11: Tidak ada yang perlu dilakukan untuk ikon**

`src/src/ds/icon.tsx:8` meng-PascalCase-kan `name` lalu mencarinya di `icons` milik `lucide-react`, dengan `icons.Circle` sebagai fallback. `"terminal"` → `Terminal`, yang ada di lucide. Tidak ada pemetaan yang perlu ditambahkan. Langkah ini disebut agar tidak ada yang menghabiskan waktu mencarinya.

- [ ] **Step 12: Typecheck dan seluruh suite frontend**

```bash
pnpm --filter ./src typecheck
pnpm --filter ./src test
```

Expected: keduanya lulus.

- [ ] **Step 13: Uji nyata di browser (wajib per CLAUDE.md)**

```bash
pnpm dev
```

Buka `http://localhost:5173`, klik **Terminal**, pilih project, klik **Sesi baru**. Yang harus terlihat:

1. Splash Claude Code muncul di dalam panel gelap.
2. Mengetik prompt lalu Enter membuat claude menjawab.
3. Buka sesi kedua pada project yang sama — kedua tab hidup berdampingan.
4. Pindah ke tab pertama: scrollback-nya kembali utuh, tidak kosong.
5. Reload halaman: kedua sesi masih ada, isinya di-replay.
6. Ubah ukuran window: layout claude ikut menyesuaikan (ini yang membuktikan `resize` sampai).
7. Ctrl-C lalu `/exit`: tab menunjukkan `berakhir`, dan `×` menutupnya.

Kalau WebSocket-nya 404, `ws: true` di Step 2 terlewat. Perbaiki dan ulangi sebelum lanjut.

- [ ] **Step 14: Update dokumentasi frontend**

Di `internal/docs/frontend/frontend-implementation.md`, tambahkan Terminal ke daftar screen, dengan kalimat: sesi PTY hidup di server, hanya tab aktif yang memegang WebSocket, dan berpindah tab me-replay scrollback dari server, bukan dari state browser.

- [ ] **Step 15: Commit**

```bash
git add src/package.json src/vite.config.ts src/src/api/client.ts \
  src/src/screens/TerminalScreen.tsx src/src/screens/TerminalPane.tsx \
  src/src/ds/shell.tsx src/src/App.tsx src/test/terminal-screen.test.tsx \
  internal/docs/frontend/frontend-implementation.md pnpm-lock.yaml
git commit -m "feat(web): screen Terminal dengan sesi Claude Code interaktif"
```

---

## Verifikasi akhir

```bash
pnpm typecheck
pnpm test
pnpm build
```

`server/test/queue-durability.test.ts` sudah gagal sebelum pekerjaan ini dimulai; kegagalannya bukan regresi. Semua yang lain harus hijau.
