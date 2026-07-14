# Auto Update (SPEC-214) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Badge "Update tersedia" di topbar dashboard yang muncul saat versi berubah (kode di disk lebih baru dari app yang jalan, atau origin di depan), dengan popover berisi perintah update untuk disalin — server hanya mendeteksi, tak pernah pull/build/restart.

**Architecture:** Server `services/update.ts` menghitung `UpdateStatus` dari git (SHA build ter-stamp vs checkout HEAD vs origin). Didorong ke klien lewat WS siar grup baru `update` (pola ADR-0039), plus `GET /api/update` untuk paint pertama. Frontend `useUpdate()` (pola `useLimits`) memberi makan `UpdateBadge` di topbar. Semua read-only (ADR-0043).

**Tech Stack:** TypeScript strict, Fastify, React 18 (`useSyncExternalStore`), Vitest (jsdom untuk web), git via `execFile`, esbuild (server bundle).

## Global Constraints

- TypeScript strict; test untuk tiap logika (composeUpdate, service, route, events, store, badge). — verbatim CLAUDE.md.
- Update `internal/docs` yang tersentuh **dalam commit yang sama**. — verbatim CLAUDE.md.
- Server **tak pernah** menjalankan `git pull`/`pnpm build`/restart (keputusan manusia SPEC-214). Detect-only.
- Tanpa perubahan skema DB / migration. Tanpa menghidupkan queue/scheduler/webhook (ADR-0024).
- `git fetch` (satu-satunya jaringan) di-gate `HANOMAN_UPDATE_FETCH === "1"`, di-set hanya di `server.ts` (boot nyata) — test import `buildApp` dari `app.ts`, tak pernah fetch.
- Nama tipe/ fungsi lintas task WAJIB konsisten: `UpdateStatus`, `UpdateReason`, `UpdateRemoteStatus`, `UpdateCommit`, `composeUpdate`, `getUpdateStatus`, `_resetUpdateCache`, `useUpdate`, `updateHeadline`, `updateBadgeLabel`, `UpdateBadge`.

## File Structure

- Create `server/src/services/update.ts` — `composeUpdate` (murni) + `getUpdateStatus` (git+cache+fetch) + `_resetUpdateCache`.
- Create `server/src/routes/update.ts` — `GET /api/update`.
- Modify `server/src/app.ts` — register route.
- Modify `server/src/services/events.ts` — grup siar `update`.
- Modify `server/src/server.ts` — set `HANOMAN_UPDATE_FETCH`.
- Create `scripts/stamp-build.mjs`; Modify root `package.json` build script.
- Modify `shared/src/dto.ts` — tipe `UpdateStatus` + varian `EventMsg`.
- Create `src/src/api/update.ts` — store `useUpdate` + helper murni.
- Create `src/src/screens/UpdateIndicator.tsx` — `UpdateBadge`; Modify `src/src/ds/shell.tsx` — render di topbar.
- Tests: `shared/test/update-dto.test.ts`, `server/test/update.test.ts`, `server/test/update.service.test.ts`, `server/test/update.route.test.ts`, `src/test/update.test.ts`, `src/test/update-indicator.test.tsx`; Modify `server/test/events.test.ts`, `server/test/events.route.test.ts`.
- Docs: `internal/docs/architecture/api-contract.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/docs/operations/production.md`, `internal/docs/adr/0043-auto-update-deteksi-read-only.md`, `internal/docs/README.md`.

---

### Task 1: Shared DTO `UpdateStatus` + varian `EventMsg`

**Files:**
- Modify: `shared/src/dto.ts` (setelah blok `LimitsDTO`, dan tambah varian di union `EventMsg`)
- Test: `shared/test/update-dto.test.ts`

**Interfaces:**
- Produces: `UpdateStatus`, `UpdateReason`, `UpdateRemoteStatus`, `UpdateCommit`, dan varian `{ t: "update"; update: UpdateStatus }` pada `EventMsg`.

- [x] **Step 1: Tulis test gagal** — `shared/test/update-dto.test.ts`

```ts
import { describe, it, expect } from "vitest";
import type { UpdateStatus, EventMsg } from "../src/dto";

describe("UpdateStatus DTO", () => {
  it("membentuk status up-to-date yang valid", () => {
    const u: UpdateStatus = {
      currentSha: "abc1234", checkoutSha: "abc1234", branch: "main",
      local: { stale: false }, remote: { status: "ok", behind: 0, fetchedAt: null },
      updateAvailable: false, reason: null, command: "", newCommits: [],
    };
    expect(u.updateAvailable).toBe(false);
    expect(u.reason).toBeNull();
  });
  it("EventMsg menyempit pada t:update", () => {
    const m: EventMsg = { t: "update", update: {
      currentSha: "a", checkoutSha: "b", branch: null,
      local: { stale: true }, remote: { status: "unavailable", behind: 0, fetchedAt: null },
      updateAvailable: true, reason: "local", command: "pnpm build && pnpm prod", newCommits: [],
    } };
    if (m.t === "update") expect(m.update.reason).toBe("local");
    else throw new Error("narrowing gagal");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./shared exec vitest run test/update-dto.test.ts`
Expected: FAIL (tipe `UpdateStatus` belum ada — error kompilasi/import).

- [x] **Step 3: Tambah tipe di `shared/src/dto.ts`** (tepat setelah `export type LimitsDTO = {...};`)

```ts
// SPEC-214 · status auto-update. "version" hanoman = git commit SHA (tak ada field version).
export type UpdateReason = "local" | "remote" | "both" | null;
export type UpdateRemoteStatus = "ok" | "unavailable";  // unavailable = tanpa upstream / fetch gagal / bukan repo git
export type UpdateCommit = { sha: string; subject: string };
export type UpdateStatus = {
  currentSha: string;         // short SHA build yang jalan (fallback checkoutSha bila belum ter-stamp / dev)
  checkoutSha: string;        // short SHA HEAD working tree sekarang
  branch: string | null;      // branch aktif; null bila detached HEAD
  local: { stale: boolean };  // runningBuildSha ≠ checkoutSha → perlu rebuild/restart
  remote: { status: UpdateRemoteStatus; behind: number; fetchedAt: string | null };
  updateAvailable: boolean;   // local.stale || remote.behind > 0
  reason: UpdateReason;
  command: string;            // panduan operator; "" bila up-to-date
  newCommits: UpdateCommit[]; // commit origin-ahead (≤ 20)
};
```

Lalu tambahkan varian ke union `EventMsg` (baris terakhir union, setelah `| { t: "vps"; vps: VpsView[] }`):

```ts
  | { t: "update"; update: UpdateStatus };
```

(Pindahkan `;` penutup lama ke baris `update` bila union sebelumnya diakhiri `;`.)

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./shared exec vitest run test/update-dto.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add shared/src/dto.ts shared/test/update-dto.test.ts
git commit -m "feat(shared): UpdateStatus DTO + varian EventMsg update (SPEC-214)"
```

---

### Task 2: `composeUpdate` — logika murni

**Files:**
- Create: `server/src/services/update.ts` (hanya fungsi murni `composeUpdate` + tipe input dulu)
- Test: `server/test/update.test.ts`

**Interfaces:**
- Consumes: `UpdateStatus`, `UpdateReason`, `UpdateRemoteStatus`, `UpdateCommit` dari `@hanoman/shared`.
- Produces: `export function composeUpdate(x: UpdateInputs): UpdateStatus` dan `export type UpdateInputs`.

- [x] **Step 1: Tulis test gagal** — `server/test/update.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { composeUpdate } from "../src/services/update";

const base = {
  runningBuildSha: "aaaaaaa", checkoutSha: "aaaaaaa", branch: "main",
  remoteStatus: "ok" as const, behind: 0, fetchedAt: "2026-07-14T00:00:00Z", newCommits: [],
};
describe("composeUpdate", () => {
  it("up-to-date → updateAvailable false, reason null, tanpa command", () => {
    const u = composeUpdate(base);
    expect(u.updateAvailable).toBe(false); expect(u.reason).toBeNull(); expect(u.command).toBe("");
  });
  it("build lama dari checkout → local, command build+prod", () => {
    const u = composeUpdate({ ...base, runningBuildSha: "old1234", checkoutSha: "new5678" });
    expect(u.reason).toBe("local"); expect(u.local.stale).toBe(true);
    expect(u.command).toBe("pnpm build && pnpm prod");
  });
  it("origin di depan → remote, command pull, newCommits diteruskan", () => {
    const u = composeUpdate({ ...base, behind: 3, newCommits: [{ sha: "c1", subject: "x" }] });
    expect(u.reason).toBe("remote"); expect(u.remote.behind).toBe(3); expect(u.newCommits).toHaveLength(1);
    expect(u.command).toBe("git pull --ff-only && pnpm build && pnpm prod");
  });
  it("lokal stale + origin ahead → both", () => {
    const u = composeUpdate({ ...base, runningBuildSha: "old", checkoutSha: "new", behind: 2 });
    expect(u.reason).toBe("both");
    expect(u.command).toBe("git pull --ff-only && pnpm build && pnpm prod");
  });
  it("remote unavailable → behind diabaikan, newCommits dibuang", () => {
    const u = composeUpdate({ ...base, remoteStatus: "unavailable", behind: 5, newCommits: [{ sha: "c", subject: "s" }] });
    expect(u.remote.behind).toBe(0); expect(u.updateAvailable).toBe(false); expect(u.newCommits).toEqual([]);
  });
  it("dev tanpa build-info (runningBuildSha null) → tak pernah stale, currentSha = checkout", () => {
    const u = composeUpdate({ ...base, runningBuildSha: null, checkoutSha: "zzz" });
    expect(u.local.stale).toBe(false); expect(u.currentSha).toBe("zzz");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/update.test.ts`
Expected: FAIL ("composeUpdate is not a function" / modul tak ada).

- [x] **Step 3: Buat `server/src/services/update.ts` dengan fungsi murni**

```ts
import type { UpdateStatus, UpdateReason, UpdateRemoteStatus, UpdateCommit } from "@hanoman/shared";

export type UpdateInputs = {
  runningBuildSha: string | null;
  checkoutSha: string;
  branch: string | null;
  remoteStatus: UpdateRemoteStatus;
  behind: number;
  fetchedAt: string | null;
  newCommits: UpdateCommit[];
};

const PULL_CMD = "git pull --ff-only && pnpm build && pnpm prod";
const BUILD_CMD = "pnpm build && pnpm prod";

// Murni & deterministik: seluruh keputusan "update tersedia?" ada di sini, terpisah dari git
// (di-uji unit tanpa proses). runningBuildSha null (dev/belum stamp) → tak pernah stale.
export function composeUpdate(x: UpdateInputs): UpdateStatus {
  const currentSha = x.runningBuildSha ?? x.checkoutSha;
  const localStale = x.runningBuildSha != null && x.runningBuildSha !== x.checkoutSha;
  const behind = x.remoteStatus === "ok" ? Math.max(0, x.behind) : 0;
  const remoteBehind = behind > 0;
  const updateAvailable = localStale || remoteBehind;
  const reason: UpdateReason = !updateAvailable ? null
    : localStale && remoteBehind ? "both" : localStale ? "local" : "remote";
  const command = !updateAvailable ? "" : reason === "local" ? BUILD_CMD : PULL_CMD;
  return {
    currentSha, checkoutSha: x.checkoutSha, branch: x.branch,
    local: { stale: localStale },
    remote: { status: x.remoteStatus, behind, fetchedAt: x.fetchedAt },
    updateAvailable, reason, command,
    newCommits: remoteBehind ? x.newCommits : [],
  };
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/update.test.ts`
Expected: PASS (6 kasus)

- [x] **Step 5: Commit**

```bash
git add server/src/services/update.ts server/test/update.test.ts
git commit -m "feat(server): composeUpdate — logika deteksi update murni (SPEC-214)"
```

---

### Task 3: `getUpdateStatus` — git lokal + fetch ter-gate + cache

**Files:**
- Modify: `server/src/services/update.ts` (tambah git/cache/build-info di bawah `composeUpdate`)
- Test: `server/test/update.service.test.ts`

**Interfaces:**
- Produces: `export async function getUpdateStatus(): Promise<UpdateStatus>` dan `export function _resetUpdateCache(): void`.
- Seam: baca root dari `process.env.HANOMAN_REPO_ROOT ?? process.cwd()`; fetch hanya bila `process.env.HANOMAN_UPDATE_FETCH === "1"`.

- [x] **Step 1: Tulis test gagal** — `server/test/update.service.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUpdateStatus, _resetUpdateCache } from "../src/services/update";

let dir = "";
beforeEach(() => { _resetUpdateCache(); delete process.env.HANOMAN_UPDATE_FETCH; });
afterEach(() => {
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = ""; }
  delete process.env.HANOMAN_REPO_ROOT; _resetUpdateCache();
});

describe("getUpdateStatus", () => {
  it("root bukan repo git → fail-safe: updateAvailable false, tak melempar", async () => {
    dir = mkdtempSync(join(tmpdir(), "hanoman-norepo-"));
    process.env.HANOMAN_REPO_ROOT = dir;
    const u = await getUpdateStatus();
    expect(u.updateAvailable).toBe(false);
    expect(u.remote.status).toBe("unavailable");
  });
  it("repo git tanpa origin → checkoutSha terisi, remote unavailable, tanpa jaringan", async () => {
    dir = mkdtempSync(join(tmpdir(), "hanoman-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
    process.env.HANOMAN_REPO_ROOT = dir;
    const u = await getUpdateStatus();
    expect(u.checkoutSha).toMatch(/^[0-9a-f]{7,}$/);
    expect(u.remote.status).toBe("unavailable");
    expect(u.updateAvailable).toBe(false);
  });
  it("cache 15s: dua panggilan berturut pakai hasil sama", async () => {
    dir = mkdtempSync(join(tmpdir(), "hanoman-cache-"));
    process.env.HANOMAN_REPO_ROOT = dir;
    const a = await getUpdateStatus();
    const b = await getUpdateStatus();
    expect(b).toBe(a);   // referensi identik = cache hit
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/update.service.test.ts`
Expected: FAIL ("getUpdateStatus is not exported").

- [x] **Step 3: Tambah git+cache+build-info ke `server/src/services/update.ts`** (di bawah `composeUpdate`)

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24 } as const;
const RESULT_TTL_MS = 15_000;
const FETCH_TTL_MS = 5 * 60_000;
const COMMIT_CAP = 20;

let cached: { at: number; value: UpdateStatus } | null = null;
let lastFetchAt = 0;

// Seam test: HANOMAN_REPO_ROOT menunjuk repo lain (atau non-repo → fail-safe).
function repoRoot(): string { return process.env.HANOMAN_REPO_ROOT ?? process.cwd(); }

// SHA build yang sedang jalan: server/dist/build-info.json (ditanam scripts/stamp-build.mjs).
// Server di-bundle esbuild → import.meta.url = server/dist/server.js, jadi file bersebelahan.
// Absen (dev / belum di-build) → null → composeUpdate menganggap tak stale.
function runningBuildSha(): string | null {
  try {
    const p = resolve(dirname(fileURLToPath(import.meta.url)), "build-info.json");
    return JSON.parse(readFileSync(p, "utf8"))?.sha ?? null;
  } catch { return null; }
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: root, ...GIT });
  return stdout.trim();
}

// Jaringan HANYA di sini, dan hanya bila opt-in (server.ts menyalakan di boot nyata; test tak pernah).
async function maybeFetch(root: string, branch: string): Promise<void> {
  if (process.env.HANOMAN_UPDATE_FETCH !== "1") return;
  if (Date.now() - lastFetchAt < FETCH_TTL_MS) return;
  lastFetchAt = Date.now();
  try { await exec("git", ["fetch", "origin", branch, "--quiet"], { cwd: root, timeout: 15_000, ...GIT }); }
  catch { /* offline / auth — biarkan; remote pakai ref origin yang ada */ }
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return cached.value;
  const value = await compute();
  cached = { at: Date.now(), value };
  return value;
}

async function compute(): Promise<UpdateStatus> {
  const root = repoRoot();
  let checkoutSha = "", branch: string | null = null;
  try {
    checkoutSha = await git(root, ["rev-parse", "--short", "HEAD"]);
    const b = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    branch = b && b !== "HEAD" ? b : null;
  } catch {
    // bukan repo git / git absen → fail-safe: tak ada update yang bisa dipastikan
    return composeUpdate({ runningBuildSha: null, checkoutSha: "", branch: null,
      remoteStatus: "unavailable", behind: 0, fetchedAt: null, newCommits: [] });
  }
  let remoteStatus: UpdateRemoteStatus = "unavailable";
  let behind = 0; let newCommits: UpdateCommit[] = []; let fetchedAt: string | null = null;
  if (branch) {
    await maybeFetch(root, branch);
    try {
      const ref = `origin/${branch}`;
      await git(root, ["rev-parse", "--verify", "--quiet", ref]);   // throw bila ref tak ada
      remoteStatus = "ok";
      fetchedAt = lastFetchAt ? new Date(lastFetchAt).toISOString() : null;
      behind = Number(await git(root, ["rev-list", "--count", `HEAD..${ref}`])) || 0;
      if (behind > 0) {
        const log = await git(root, ["log", "--format=%h%x09%s", "-n", String(COMMIT_CAP), `HEAD..${ref}`]);
        newCommits = log ? log.split("\n").map((l) => {
          const [sha, ...rest] = l.split("\t"); return { sha, subject: rest.join("\t") };
        }) : [];
      }
    } catch { remoteStatus = "unavailable"; behind = 0; newCommits = []; fetchedAt = null; }
  }
  return composeUpdate({ runningBuildSha: runningBuildSha(), checkoutSha, branch, remoteStatus, behind, fetchedAt, newCommits });
}

export function _resetUpdateCache(): void { cached = null; lastFetchAt = 0; }
```

Catatan: import `UpdateRemoteStatus`/`UpdateCommit` sudah ada dari Task 2 (baris import teratas file). Pastikan keduanya termuat di daftar import `@hanoman/shared`.

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/update.service.test.ts`
Expected: PASS (3 kasus)

- [x] **Step 5: Commit**

```bash
git add server/src/services/update.ts server/test/update.service.test.ts
git commit -m "feat(server): getUpdateStatus — git lokal + fetch ter-gate + cache (SPEC-214)"
```

---

### Task 4: Route `GET /api/update` + api-contract

**Files:**
- Create: `server/src/routes/update.ts`
- Modify: `server/src/app.ts` (import + register)
- Modify: `internal/docs/architecture/api-contract.md`
- Test: `server/test/update.route.test.ts`

**Interfaces:**
- Consumes: `getUpdateStatus`, `_resetUpdateCache` dari `services/update`.
- Produces: `GET /api/update -> UpdateStatus`.

- [x] **Step 1: Tulis test gagal** — `server/test/update.route.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { _resetUpdateCache } from "../src/services/update";

let dir = "";
beforeEach(() => { _resetUpdateCache(); dir = mkdtempSync(join(tmpdir(), "hanoman-upd-")); process.env.HANOMAN_REPO_ROOT = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.HANOMAN_REPO_ROOT; _resetUpdateCache(); });

describe("GET /api/update", () => {
  it("balas 200 + shape valid; fail-safe saat root bukan repo", async () => {
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/update" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({ updateAvailable: false, reason: null });
    expect(b.remote.status).toBe("unavailable");
    expect(Array.isArray(b.newCommits)).toBe(true);
  });
  it("401 tanpa cookie saat requireAuth", async () => {
    const app = buildApp({ requireAuth: true });
    const res = await app.inject({ method: "GET", url: "/api/update" });
    expect(res.statusCode).toBe(401);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/update.route.test.ts`
Expected: FAIL (route 404 → statusCode bukan 200).

- [x] **Step 3a: Buat `server/src/routes/update.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { getUpdateStatus } from "../services/update";

// GET /api/update — status auto-update (SPEC-214). Read-only: server tak pernah pull/build/restart
// (ADR-0043). Auth-gated otomatis (bukan anggota PUBLIC di app.ts). Realtime lewat WS siar grup "update".
export default async function update(app: FastifyInstance) {
  app.get("/update", async () => getUpdateStatus());
}
```

- [x] **Step 3b: Daftarkan di `server/src/app.ts`** — tambah import bersama route lain:

```ts
import update from "./routes/update";
```

dan register setelah `await api.register(limits);`:

```ts
    await api.register(update);
```

- [x] **Step 3c: Update `internal/docs/architecture/api-contract.md`** — tambah blok baru setelah bagian Limits (cari `GET /limits`), sisipkan:

```markdown
## Update (auto-update, SPEC-214)
```
GET  /update   -> UpdateStatus   # status versi; read-only (server TAK pernah pull/build/restart, ADR-0043)
#   UpdateStatus = { currentSha, checkoutSha, branch|null, local:{stale}, remote:{status:"ok"|"unavailable",behind,fetchedAt},
#                    updateAvailable, reason:"local"|"remote"|"both"|null, command, newCommits:{sha,subject}[] }
#   updateAvailable = build ter-stamp ≠ checkout HEAD (local) ATAU origin di depan (remote, setelah git fetch ter-gate).
```
Realtime: grup WS siar `update` (di samping specs/sessions/notifications/limits/vps) — lihat `GET /events/ws`.
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/update.route.test.ts`
Expected: PASS (2 kasus)

- [x] **Step 5: Commit**

```bash
git add server/src/routes/update.ts server/src/app.ts server/test/update.route.test.ts internal/docs/architecture/api-contract.md
git commit -m "feat(server): GET /api/update + api-contract (SPEC-214)"
```

---

### Task 5: Grup WS siar `update` + flag fetch di server.ts

**Files:**
- Modify: `server/src/services/events.ts` (tambah grup)
- Modify: `server/src/server.ts` (set `HANOMAN_UPDATE_FETCH`)
- Modify: `server/test/events.test.ts` (netralkan jaringan + assert grup)
- Modify: `server/test/events.route.test.ts` (netralkan jaringan)

**Interfaces:**
- Consumes: `getUpdateStatus` dari `services/update`.
- Produces: frame `{ t: "update", update: UpdateStatus }` pada attach + tiap 300 tick (dedup signature).

- [x] **Step 1: Perbarui test** — `server/test/events.test.ts`

Di `beforeEach`, setelah baris `process.env.CLAUDE_CONFIG_DIR = mkdtempSync(...)`, tambah:

```ts
  process.env.HANOMAN_REPO_ROOT = process.env.CLAUDE_CONFIG_DIR;  // non-repo → getUpdateStatus fail-safe, tanpa jaringan
  _resetUpdateCache();
```

Tambah import di atas: `import { _resetUpdateCache } from "../src/services/update";`
Di `afterEach`, tambah: `delete process.env.HANOMAN_REPO_ROOT; _resetUpdateCache();`
Di test "mengirim snapshot semua grup ke klien saat attach", tambah assert:

```ts
    expect(groups(c).has("update")).toBe(true);
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./server exec vitest run test/events.test.ts`
Expected: FAIL (`groups(c).has("update")` false — grup belum ada).

- [x] **Step 3a: Tambah grup di `server/src/services/events.ts`**

Import di atas (bersama import service lain): `import { getUpdateStatus } from "./update";`
Tambah entri di akhir array `GROUPS` (setelah baris `limits`):

```ts
  // SPEC-214 · deteksi update jarang berubah; recompute tiap 300 dtk, dedup signature → siar hanya
  // saat status berubah. getUpdateStatus cache 15s + fetch ter-gate (server.ts) → attach tak menahan.
  { everyTicks: 300, last: "", build: async () => ({ t: "update", update: await getUpdateStatus() }) },
```

- [x] **Step 3b: Set flag fetch di `server/src/server.ts`** — tambah setelah baris import (sebelum `const app = buildApp();`):

```ts
// SPEC-214 · aktifkan git fetch untuk deteksi update hanya di boot server nyata. Test meng-import
// buildApp dari app.ts (tak pernah memuat server.ts), jadi test tak pernah menyentuh jaringan.
process.env.HANOMAN_UPDATE_FETCH ??= "1";
```

- [x] **Step 3c: Netralkan jaringan di `server/test/events.route.test.ts`** — di `beforeAll`, setelah baris `process.env.CLAUDE_CONFIG_DIR = mkdtempSync(...)`, tambah:

```ts
  process.env.HANOMAN_REPO_ROOT = process.env.CLAUDE_CONFIG_DIR;  // getUpdateStatus fail-safe, tanpa jaringan
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./server exec vitest run test/events.test.ts test/events.route.test.ts`
Expected: PASS (termasuk assert `has("update")`).

- [x] **Step 5: Commit**

```bash
git add server/src/services/events.ts server/src/server.ts server/test/events.test.ts server/test/events.route.test.ts
git commit -m "feat(server): grup WS siar update + fetch ter-gate di boot (SPEC-214)"
```

---

### Task 6: Build stamp `build-info.json`

**Files:**
- Create: `scripts/stamp-build.mjs`
- Modify: `package.json` (root, script `build`)

**Interfaces:**
- Produces: `server/dist/build-info.json` = `{ sha, builtAt }`, dibaca `runningBuildSha()` di Task 3.

- [x] **Step 1: Buat `scripts/stamp-build.mjs`**

```js
// SPEC-214 · tanam SHA build ke server/dist/build-info.json supaya server tahu commit mana yang
// sedang ia jalankan (deteksi "kode baru di disk tapi app lama"). dist gitignored.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let sha = "unknown";
try { sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
catch { /* di luar repo git → biarkan "unknown" */ }
const out = resolve(root, "server/dist/build-info.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sha, builtAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`stamped build-info.json · ${sha}`);
```

- [x] **Step 2: Ubah script `build` di root `package.json`**

Dari:
```json
    "build": "pnpm --filter ./src build && pnpm --filter ./server build",
```
Menjadi:
```json
    "build": "pnpm --filter ./src build && pnpm --filter ./server build && node scripts/stamp-build.mjs",
```

- [x] **Step 3: Verifikasi nyata (bukan unit test) — jalankan build & cek berkas**

Run: `pnpm build && node -e "console.log(require('fs').readFileSync('server/dist/build-info.json','utf8'))"`
Expected: JSON `{ "sha": "<7-hex>", "builtAt": "<ISO>" }` tercetak; `sha` cocok dengan `git rev-parse --short HEAD`.

- [x] **Step 4: Commit**

```bash
git add scripts/stamp-build.mjs package.json
git commit -m "build: stamp build-info.json dengan SHA saat build (SPEC-214)"
```

---

### Task 7: Frontend store `useUpdate` + helper murni

**Files:**
- Create: `src/src/api/update.ts`
- Test: `src/test/update.test.ts`

**Interfaces:**
- Consumes: `subscribe` dari `./events`; `UpdateStatus` dari `@hanoman/shared`.
- Produces: `useUpdate(): UpdateStatus`, `updateHeadline(u): string`, `updateBadgeLabel(u): string`.

- [x] **Step 1: Tulis test gagal** — `src/test/update.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { updateHeadline, updateBadgeLabel } from "../src/api/update";
import type { UpdateStatus } from "@hanoman/shared";

const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentSha: "a", checkoutSha: "a", branch: "main", local: { stale: false },
  remote: { status: "ok", behind: 0, fetchedAt: null }, updateAvailable: false,
  reason: null, command: "", newCommits: [], ...o,
});

describe("updateHeadline", () => {
  it("up-to-date", () => expect(updateHeadline(mk({}))).toMatch(/terbaru/));
  it("local", () => expect(updateHeadline(mk({ updateAvailable: true, reason: "local", local: { stale: true } }))).toMatch(/rebuild/i));
  it("remote menyebut jumlah commit", () =>
    expect(updateHeadline(mk({ updateAvailable: true, reason: "remote", remote: { status: "ok", behind: 4, fetchedAt: null } }))).toMatch(/4 commit/));
  it("both", () =>
    expect(updateHeadline(mk({ updateAvailable: true, reason: "both", local: { stale: true }, remote: { status: "ok", behind: 2, fetchedAt: null } }))).toMatch(/\+ 2/));
});
describe("updateBadgeLabel", () => {
  it("tanpa remote behind → 'Update'", () => expect(updateBadgeLabel(mk({ updateAvailable: true, reason: "local" }))).toBe("Update"));
  it("dengan remote behind → 'Update · N'", () =>
    expect(updateBadgeLabel(mk({ updateAvailable: true, reason: "remote", remote: { status: "ok", behind: 3, fetchedAt: null } }))).toBe("Update · 3"));
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/update.test.ts`
Expected: FAIL (modul `../src/api/update` tak ada).

- [x] **Step 3: Buat `src/src/api/update.ts`**

```ts
import { useSyncExternalStore } from "react";
import type { UpdateStatus } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";

// SPEC-214 · status auto-update didorong lewat WS siar (grup "update"), pola api/limits.ts.
// Store singleton ref-count: badge topbar berlangganan satu feed. Default = up-to-date sampai
// frame pertama tiba (server kirim snapshot penuh saat connect).
const UP_TO_DATE: UpdateStatus = {
  currentSha: "", checkoutSha: "", branch: null,
  local: { stale: false }, remote: { status: "unavailable", behind: 0, fetchedAt: null },
  updateAvailable: false, reason: null, command: "", newCommits: [],
};
let state: UpdateStatus = UP_TO_DATE;
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => { if (m.t === "update") { state = m.update; for (const s of subs) s(); } });
  }
  return () => { subs.delete(cb); if (subs.size === 0 && unsub) { unsub(); unsub = undefined; } };
}

export function useUpdate(): UpdateStatus { return useSyncExternalStore(subscribe, () => state, () => state); }

// Helper murni (di-uji unit): heading popover + label pill, per reason.
export function updateHeadline(u: UpdateStatus): string {
  if (!u.updateAvailable) return "Versi terpasang sudah terbaru";
  if (u.reason === "both") return `Kode baru di disk + ${u.remote.behind} commit di origin`;
  if (u.reason === "local") return "Kode baru di disk — rebuild & restart untuk menerapkan";
  return `${u.remote.behind} commit baru di origin — pull untuk update`;
}
export function updateBadgeLabel(u: UpdateStatus): string {
  return u.remote.behind > 0 ? `Update · ${u.remote.behind}` : "Update";
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./src exec vitest run test/update.test.ts`
Expected: PASS (6 kasus)

- [x] **Step 5: Commit**

```bash
git add src/src/api/update.ts src/test/update.test.ts
git commit -m "feat(web): store useUpdate + helper headline/label (SPEC-214)"
```

---

### Task 8: `UpdateBadge` di topbar + frontend docs

**Files:**
- Create: `src/src/screens/UpdateIndicator.tsx`
- Modify: `src/src/ds/shell.tsx` (render badge di topbar)
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Test: `src/test/update-indicator.test.tsx`

**Interfaces:**
- Consumes: `useUpdate`, `updateHeadline`, `updateBadgeLabel` dari `../api/update`; `Icon` dari `../ds/icon`.
- Produces: `export function UpdateBadge()`.

- [ ] **Step 1: Tulis test gagal** — `src/test/update-indicator.test.tsx`

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { UpdateStatus } from "@hanoman/shared";

// Badge self-fetch via useUpdate(); pakai nilai tetap agar render deterministik (pola limit-indicator).
let hook: UpdateStatus;
vi.mock("../src/api/update", async (orig) => ({
  ...(await orig<typeof import("../src/api/update")>()),
  useUpdate: () => hook,
}));
import { UpdateBadge } from "../src/screens/UpdateIndicator";

const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentSha: "abc1234", checkoutSha: "def5678", branch: "main", local: { stale: false },
  remote: { status: "ok", behind: 0, fetchedAt: null }, updateAvailable: false,
  reason: null, command: "", newCommits: [], ...o,
});

describe("UpdateBadge", () => {
  it("tak render saat up-to-date", () => {
    hook = mk({});
    const { container } = render(<UpdateBadge />);
    expect(container.firstChild).toBeNull();
  });
  it("render pill + popover + perintah saat remote behind", () => {
    hook = mk({ updateAvailable: true, reason: "remote", remote: { status: "ok", behind: 2, fetchedAt: null },
      command: "git pull --ff-only && pnpm build && pnpm prod",
      newCommits: [{ sha: "c1", subject: "fix A" }, { sha: "c2", subject: "feat B" }] });
    render(<UpdateBadge />);
    const btn = screen.getByTitle("Update tersedia");
    expect(btn.textContent).toContain("Update · 2");
    fireEvent.click(btn);
    expect(screen.getByText(/2 commit baru di origin/)).toBeTruthy();
    expect(screen.getByText(/git pull --ff-only/)).toBeTruthy();
    expect(screen.getByText(/fix A/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter ./src exec vitest run test/update-indicator.test.tsx`
Expected: FAIL (modul `../src/screens/UpdateIndicator` tak ada).

- [ ] **Step 3a: Buat `src/src/screens/UpdateIndicator.tsx`**

```tsx
import React from "react";
import { Icon } from "../ds/icon";
import { useUpdate, updateHeadline, updateBadgeLabel } from "../api/update";

// Badge topbar — muncul HANYA saat updateAvailable (up-to-date: tanpa noise). Klik → popover berisi
// apa yang baru + perintah update (Salin). Server tak mengeksekusi apa pun (SPEC-214, ADR-0043).
export function UpdateBadge() {
  const u = useUpdate();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  if (!u.updateAvailable) return null;
  const copy = () => {
    try { void navigator.clipboard?.writeText(u.command); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard tak tersedia */ }
  };
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} title="Update tersedia"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--brass-300, var(--border-hair))",
          background: "var(--brass-100)", color: "var(--brass-700)", cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 12 }}>
        <Icon name="arrow-up-circle" size={13} color="var(--brass-700)" />
        {updateBadgeLabel(u)}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 320,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))", padding: 14 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Update tersedia</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", marginBottom: 10 }}>{updateHeadline(u)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: u.newCommits.length ? 10 : 8 }}>
            <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bone-100)",
              padding: "6px 8px", borderRadius: "var(--radius-sm)", overflowX: "auto", whiteSpace: "nowrap" }}>{u.command}</code>
            <button onClick={copy} title="Salin perintah"
              style={{ padding: "5px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hair)",
                background: "var(--bone-100)", cursor: "pointer", fontSize: 11 }}>{copied ? "Tersalin" : "Salin"}</button>
          </div>
          {u.newCommits.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              {u.newCommits.map((c) => (
                <div key={c.sha} style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--brass-700)" }}>{c.sha}</span> {c.subject}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>terpasang {u.currentSha || "?"} · tersedia {u.checkoutSha || "?"}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3b: Render di `src/src/ds/shell.tsx`** — tambah import di atas (dekat `import { LimitBadge } ...`):

```ts
import { UpdateBadge } from "../screens/UpdateIndicator";
```

dan render sebelum `<NotificationBell />` di topbar:

```tsx
          <UpdateBadge />
          <NotificationBell />
```

- [ ] **Step 3c: Update `internal/docs/frontend/frontend-implementation.md`** — tambah satu baris di daftar komponen topbar (cari penyebutan `LimitBadge`/topbar), sisipkan:

```markdown
- `UpdateBadge` (`screens/UpdateIndicator.tsx`) — pill topbar "Update", muncul hanya saat `useUpdate().updateAvailable`; popover memuat perintah update + tombol Salin + daftar commit. Read-only (SPEC-214, ADR-0043).
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter ./src exec vitest run test/update-indicator.test.tsx`
Expected: PASS (2 kasus)

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/UpdateIndicator.tsx src/src/ds/shell.tsx src/test/update-indicator.test.tsx internal/docs/frontend/frontend-implementation.md
git commit -m "feat(web): UpdateBadge di topbar + frontend docs (SPEC-214)"
```

---

### Task 9: ADR-0043 + index + operations

**Files:**
- Create: `internal/docs/adr/0043-auto-update-deteksi-read-only.md`
- Modify: `internal/docs/README.md` (link ADR)
- Modify: `internal/docs/operations/production.md` (build-stamp + badge)

- [ ] **Step 1: Buat `internal/docs/adr/0043-auto-update-deteksi-read-only.md`**

```markdown
# ADR-0043 — Auto-update: deteksi versi read-only, tanpa self-mutation

- Status: Diterima (SPEC-214, 2026-07-14)

## Konteks
hanoman prod = satu proses `node server/dist/server.js` (foreground, tanpa supervisor). Update hari
ini manual: `git pull --ff-only && pnpm build && pnpm prod`. Tak ada field `version` — identitas
versi = git commit SHA. Brief SPEC-214: sediakan tombol update saat versi berubah.

## Keputusan
1. **Versi = git SHA.** `runningBuildSha` ditanam saat build ke `server/dist/build-info.json`
   (`scripts/stamp-build.mjs`); server membacanya runtime. Absen (dev) → fallback checkoutSha.
2. **Sinyal update = keduanya.** Badge muncul bila `runningBuildSha ≠ checkoutSha` (kode di disk
   lebih baru dari app yang jalan) ATAU origin di depan checkout (setelah `git fetch` ter-gate).
3. **Read-only.** Server HANYA mendeteksi (`GET /api/update` + grup WS siar `update`) dan menampilkan
   perintah untuk disalin operator. Server **tak pernah** menjalankan `git pull`, `pnpm build`, atau
   restart. Working tree bersama sesi Claude tak pernah tersentuh; build tak menimpa dist yang disajikan.
4. **`git fetch` (satu-satunya jaringan)** di-gate `HANOMAN_UPDATE_FETCH=1`, di-set hanya di
   `server.ts` (boot nyata); throttle 5 menit. Test tak pernah fetch.

## Konsekuensi
- Nol risiko self-mutation; langkah "manual run" tetap ada tapi tanpa mengingat perintah / cek versi.
- Menghidupkan self-pull/self-build/self-restart butuh **ADR baru** + supervisor (systemd/pm2/wrapper).
- Tak ada perubahan skema; tak menghidupkan queue/scheduler/webhook (ADR-0024).
```

- [ ] **Step 2: Link di `internal/docs/README.md`** — di daftar `## adr`, tambah baris paling atas:

```markdown
- [0043 — Auto-update: deteksi versi read-only, tanpa self-mutation](adr/0043-auto-update-deteksi-read-only.md)
```

- [ ] **Step 3: Catat di `internal/docs/operations/production.md`** — tambah bagian di akhir:

```markdown
## Update (SPEC-214)

`pnpm build` menanam `server/dist/build-info.json` (SHA commit). Server membandingkannya dengan
checkout HEAD dan `origin/<branch>` (fetch ter-gate `HANOMAN_UPDATE_FETCH=1`, otomatis di boot),
lalu menampilkan **badge "Update"** di topbar saat ada versi baru — dengan perintah
`git pull --ff-only && pnpm build && pnpm prod` untuk disalin. Deteksi saja: server tak pull/build/
restart sendiri (ADR-0043). Terapkan update dengan menjalankan perintah itu (matikan instance lama dulu).
```

- [ ] **Step 4: Verifikasi link (dep-free coverage check)**

Run: `node --experimental-strip-types shared/src/coverage.ts 2>/dev/null || echo "coverage skrip manual — cek README memuat 0043"`
Expected: tak ada error; `grep -c 0043 internal/docs/README.md` ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add internal/docs/adr/0043-auto-update-deteksi-read-only.md internal/docs/README.md internal/docs/operations/production.md
git commit -m "docs(sot): ADR-0043 auto-update read-only + operations (SPEC-214)"
```

---

### Task 10: Verifikasi menyeluruh + smoke nyata

**Files:** (tak ada perubahan kode; hanya verifikasi + centang checklist plan)

- [ ] **Step 1: Typecheck seluruh workspace**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm -r typecheck`
Expected: 0 error.

- [ ] **Step 2: Seluruh test suite (repo pola no-file-parallelism)**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm test`
Expected: semua hijau; tak ada jaringan tak terduga; tak ada regresi events.

- [ ] **Step 3: Build + verifikasi stamp**

Run: `pnpm build && cat server/dist/build-info.json`
Expected: `{ "sha": "<7-hex>", "builtAt": ... }`, `sha` = `git rev-parse --short HEAD`.

- [ ] **Step 4: Smoke server nyata (DB throwaway; jangan port 8787/8788 & jangan hanoman_test)**

Boot server ter-build di port bebas terhadap DB migrasi throwaway (pola memory "live-smoke dedicated DB"),
lalu:
```bash
curl -s localhost:<port>/api/update | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log(b)})"
```
Expected: JSON `UpdateStatus` valid (200). Karena boot dari `server/dist` ter-stamp: `currentSha` = SHA build. Bila di branch dengan origin + `HANOMAN_UPDATE_FETCH=1`: `remote.status` mungkin `ok`. Fail-safe bila git tak tersedia.

- [ ] **Step 5: Centang semua kotak plan + commit penutup dokumen plan**

Setelah semua `- [ ]` → `- [x]`:
```bash
git add docs/superpowers/plans/2026-07-14-auto-update-button-spec-214.md
git commit -m "docs(plan): ceklis SPEC-214 (Execute selesai + smoke hijau)"
```

---

## Self-Review

**1. Spec coverage** — Design → task:
- Deteksi keduanya (local build≠checkout, origin ahead) → Task 2 (composeUpdate) + Task 3 (getUpdateStatus). ✓
- DTO `UpdateStatus` + `EventMsg` → Task 1. ✓
- `GET /api/update` → Task 4. ✓
- WS siar grup `update` + snapshot attach → Task 5. ✓
- Build-stamp `build-info.json` → Task 6. ✓
- Store `useUpdate` + helper → Task 7. ✓
- `UpdateBadge` topbar + popover + Salin + daftar commit → Task 8. ✓
- Detect-only / tak ada self-mutation / fetch ter-gate → ADR-0043 (Task 9) + gate di Task 3/5. ✓
- Docs tersentuh (api-contract, frontend, operations, ADR, README) → Task 4/8/9 (same-commit). ✓
- Test (shared/server/web) + smoke nyata → Task 1–10. ✓

**2. Placeholder scan** — Tak ada TBD/TODO; tiap step memuat kode/perintah nyata + output harapan. ✓

**3. Type consistency** — `UpdateStatus/UpdateReason/UpdateRemoteStatus/UpdateCommit`, `composeUpdate/getUpdateStatus/_resetUpdateCache`, `useUpdate/updateHeadline/updateBadgeLabel`, `UpdateBadge`, env `HANOMAN_UPDATE_FETCH`/`HANOMAN_REPO_ROOT`, berkas `server/dist/build-info.json` — konsisten lintas Task 1–9. ✓
