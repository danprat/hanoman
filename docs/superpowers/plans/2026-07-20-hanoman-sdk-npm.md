# hanoman-sdk npm package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terbitkan SDK error hanoman sebagai npm package publik `hanoman-sdk` (isomorphic Node+browser, fire-and-forget) — client murni endpoint ingest ADR-0060, tanpa perubahan server.

**Architecture:** Direktori `sdk/` jadi package sungguhan dalam pnpm workspace. `src/core.ts` = transport+config+captureError; `src/index.ts` = public API (`init`, `captureError`, alias `initHanomanErrors`, default namespace) + auto-handler per runtime; `src/browser-global.ts` = IIFE yang membaca `window.HANOMAN_DSN` (kontrak snippet SPEC-249). Build: esbuild (ESM+CJS+IIFE) + tsc (`.d.ts`). Tanpa dependency runtime; hanya esbuild sebagai devDep build.

**Tech Stack:** TypeScript (strict), esbuild 0.28, tsc, vitest. Registry: npm publik.

## Global Constraints

- **Tanpa perubahan server**: kontrak payload `POST /api/ingest/:slug` = `{ type, message, stack?, environment?, release?, context? }` (ADR-0060) tetap persis; tak ada model/endpoint/migration baru.
- **Fire-and-forget**: `captureError`/`send` tak pernah melempar ke app pemanggil (hanoman down / `fetch` absen / DSN kosong → no-op senyap).
- **Nama package**: `hanoman-sdk` (unscoped), versi awal `0.1.0`, `publishConfig.access = "public"`.
- **Dependency-free runtime**: SDK tak boleh punya `dependencies`. Akses `process`/`window`/`location`/`fetch`/`addEventListener` HANYA lewat cast `globalThis` (jangan andalkan `@types/node` atau DOM lib) supaya package type-check dengan `tsconfig.base.json` apa adanya (target ES2022, moduleResolution Bundler, `verbatimModuleSyntax: true` → pakai `import type` untuk tipe).
- **Backward-compat**: `initHanomanErrors` harus tetap ada sebagai alias `init` (docs SPEC-249).
- **TDD**: tulis test dulu, lihat gagal, implementasi minimal, lihat hijau, commit. Test repo: `env -u NODE_ENV -u DATABASE_URL pnpm test` (hindari env prod bocor) atau per-paket `pnpm --filter hanoman-sdk exec vitest run`.
- **Docs commit yang sama**: `internal/docs/**` yang tersentuh diperbarui + ter-link di `internal/docs/README.md` dalam commit yang sama.

---

### Task 1: Package `hanoman-sdk` — core SDK + tests (TDD)

**Files:**
- Create: `sdk/package.json`
- Create: `sdk/tsconfig.json`
- Create: `sdk/src/core.ts`
- Create: `sdk/src/index.ts`
- Test: `sdk/test/sdk.test.ts`
- Modify: `pnpm-workspace.yaml` (tambah `sdk` ke `packages`)
- Modify: `vitest.workspace.ts` (tambah `"sdk"`)

**Interfaces:**
- Produces (dari `sdk/src/core.ts`):
  - `type InitOpts = { dsn?: string; environment?: string; release?: string }`
  - `function configure(opts: InitOpts): void`
  - `function currentConfig(): InitOpts | null`
  - `function send(body: Record<string, unknown>): void`
  - `function captureError(err: unknown, context?: Record<string, unknown>): void`
- Produces (dari `sdk/src/index.ts`):
  - `function init(opts: InitOpts): void` (memasang auto-handler runtime + `configure`)
  - `const initHanomanErrors = init` (alias)
  - `export { captureError }`, `export type { InitOpts }`
  - `export default { init, captureError, initHanomanErrors }`

- [x] **Step 1: Tambah `sdk` ke workspace & vitest**

`pnpm-workspace.yaml` — ubah baris `packages`:
```yaml
packages: [ "shared", "server", "src", "cli", "runner", "sdk" ]
```

`vitest.workspace.ts` — ubah array terakhir:
```ts
export default ["shared", "server", "src", "runner", "cli", "sdk"];
```

- [x] **Step 2: Tulis `sdk/package.json`** (build script diisi penuh di Task 2; di sini cukup name/type/scripts test+typecheck agar workspace valid)

```json
{
  "name": "hanoman-sdk",
  "version": "0.1.0",
  "description": "Kirim error dari project apa pun ke hanoman (Sentry ringan). Node + browser, fire-and-forget.",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=18" },
  "keywords": ["hanoman", "error-monitoring", "sentry", "observability", "sdk"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./global": "./dist/hanoman.global.js"
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "unpkg": "./dist/hanoman.global.js",
  "jsdelivr": "./dist/hanoman.global.js",
  "sideEffects": false,
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": { "esbuild": "^0.28.0" }
}
```

- [x] **Step 3: Tulis `sdk/tsconfig.json`**

```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "emitDeclarationOnly": true }, "include": ["src", "test"] }
```

- [x] **Step 4: Tulis test yang gagal** — `sdk/test/sdk.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, captureError, initHanomanErrors } from "../src/index";
import hanoman from "../src/index";

type Body = Record<string, unknown>;
function stubFetch() {
  const calls: { url: string; body: Body }[] = [];
  const fn = vi.fn((url: string, opts: { body: string }) => {
    calls.push({ url, body: JSON.parse(opts.body) as Body });
    return Promise.resolve({ ok: true });
  });
  (globalThis as { fetch?: unknown }).fetch = fn as unknown;
  return { calls, fn };
}

describe("hanoman-sdk", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("captureError mem-POST payload sesuai kontrak ADR-0060 ke dsn", () => {
    const { calls } = stubFetch();
    init({ dsn: "https://h.example/api/ingest/p?key=hnm_ing_x", environment: "production", release: "1.2.3" });
    captureError(new TypeError("x is undefined"), { route: "/checkout" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/ingest/p");
    expect(calls[0]!.body).toMatchObject({
      type: "TypeError", message: "x is undefined", environment: "production", release: "1.2.3",
      context: { route: "/checkout" },
    });
    expect(typeof calls[0]!.body.stack).toBe("string");
  });

  it("non-Error → type Error, message = String(err)", () => {
    const { calls } = stubFetch();
    init({ dsn: "https://h.example/api/ingest/p?key=k" });
    captureError("boom");
    expect(calls[0]!.body).toMatchObject({ type: "Error", message: "boom" });
  });

  it("dsn kosong → tak ada POST (no-op)", () => {
    const { fn } = stubFetch();
    init({});
    captureError(new Error("nope"));
    expect(fn).not.toHaveBeenCalled();
  });

  it("fire-and-forget: fetch reject tak melempar", () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(() => Promise.reject(new Error("down"))) as unknown;
    init({ dsn: "https://h.example/api/ingest/p?key=k" });
    expect(() => captureError(new Error("e"))).not.toThrow();
  });

  it("fire-and-forget: fetch throw sinkron tak melempar", () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(() => { throw new Error("sync"); }) as unknown;
    init({ dsn: "https://h.example/api/ingest/p?key=k" });
    expect(() => captureError(new Error("e"))).not.toThrow();
  });

  it("initHanomanErrors alias init; default export punya init+captureError", () => {
    expect(initHanomanErrors).toBe(init);
    expect(typeof hanoman.init).toBe("function");
    expect(typeof hanoman.captureError).toBe("function");
  });
});
```

- [x] **Step 5: Jalankan test — verifikasi GAGAL**

Run: `pnpm --filter hanoman-sdk exec vitest run`
Expected: FAIL — `Cannot find module '../src/index'` (core.ts & index.ts belum ada). Bila esbuild belum terpasang, jalankan `pnpm install` dulu.

- [x] **Step 6: Implementasi `sdk/src/core.ts`**

```ts
// hanoman-sdk core — transport + config + captureError. Isomorphic, fire-and-forget.
// Akses global via cast `globalThis` (tanpa @types/node / DOM lib) → dependency-free.
export type InitOpts = { dsn?: string; environment?: string; release?: string };

type FetchFn = (url: string, init: unknown) => { catch: (cb: () => void) => unknown };

let cfg: InitOpts | null = null;

export function configure(opts: InitOpts): void { cfg = opts; }
export function currentConfig(): InitOpts | null { return cfg; }

export function send(body: Record<string, unknown>): void {
  const c = cfg;
  if (!c || !c.dsn) return; // tak terkonfigurasi → no-op senyap
  try {
    const f = (globalThis as { fetch?: FetchFn }).fetch;
    if (!f) return; // fetch absen (Node < 18 tanpa polyfill) → menyerah diam
    void f(c.dsn, {
      method: "POST",
      keepalive: true, // browser: kirim tetap jalan saat unload; Node: diabaikan
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => { /* telan: hanoman down ≠ app crash */ });
  } catch { /* fetch throw sinkron — abaikan */ }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const c = cfg;
  const e = err as { name?: string; message?: string; stack?: string };
  send({
    type: e?.name || "Error",
    message: e?.message || String(err),
    stack: e?.stack,
    environment: c?.environment,
    release: c?.release,
    context,
  });
}
```

- [x] **Step 7: Implementasi `sdk/src/index.ts`**

```ts
// hanoman-sdk public API. init() memasang auto-handler sesuai runtime, lalu configure().
import { captureError, configure } from "./core";
import type { InitOpts } from "./core";

export type { InitOpts };
export { captureError };

function browserContext(): Record<string, unknown> | undefined {
  const loc = (globalThis as { location?: { href?: string } }).location;
  return loc?.href ? { url: loc.href } : undefined;
}

function installBrowserHandlers(): void {
  const g = globalThis as { addEventListener?: (t: string, cb: (e: unknown) => void) => void };
  if (typeof g.addEventListener !== "function") return;
  g.addEventListener("error", (e: unknown) => {
    const ev = e as { error?: { name?: string; stack?: string }; message?: string };
    const err = ev.error || {};
    captureError({ name: err.name || "Error", message: ev.message || "Error", stack: err.stack }, browserContext());
  });
  g.addEventListener("unhandledrejection", (e: unknown) => {
    const ev = e as { reason?: { name?: string; message?: string; stack?: string } };
    const r = ev.reason || {};
    captureError({ name: r.name || "UnhandledRejection", message: r.message || String(r), stack: r.stack }, browserContext());
  });
}

function installNodeHandlers(): void {
  const p = (globalThis as { process?: { on?: (e: string, cb: (x: unknown) => void) => void } }).process;
  if (!p || typeof p.on !== "function") return;
  p.on("uncaughtException", (e: unknown) => captureError(e));
  p.on("unhandledRejection", (e: unknown) => captureError(e));
}

export function init(opts: InitOpts): void {
  configure(opts);
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") installBrowserHandlers();
  else installNodeHandlers();
}

export const initHanomanErrors = init;

const hanoman = { init, captureError, initHanomanErrors };
export default hanoman;
```

- [x] **Step 8: Jalankan test — verifikasi HIJAU**

Run: `pnpm --filter hanoman-sdk exec vitest run`
Expected: PASS (6 test). Catatan: init dipanggil beberapa kali di Node → `process.on` menambah listener; <10 listener, tak ada warning. Bila muncul MaxListeners warning, abaikan (test tetap hijau).

- [x] **Step 9: Typecheck**

Run: `pnpm --filter hanoman-sdk exec tsc --noEmit`
Expected: 0 error.

- [x] **Step 10: Commit**

```bash
git add sdk/package.json sdk/tsconfig.json sdk/src/core.ts sdk/src/index.ts sdk/test/sdk.test.ts pnpm-workspace.yaml vitest.workspace.ts pnpm-lock.yaml
git commit -m "feat(spec-254): hanoman-sdk core (init/captureError) + tests, workspace wiring"
```

---

### Task 2: Build pipeline — ESM + CJS + types + browser global

**Files:**
- Create: `sdk/src/browser-global.ts`
- Modify: `sdk/package.json` (tambah `scripts.build` + `scripts.prepublishOnly`)

**Interfaces:**
- Consumes: `init` dari `sdk/src/index.ts` (Task 1).
- Produces: artefak `sdk/dist/index.js` (ESM), `sdk/dist/index.cjs` (CJS), `sdk/dist/index.d.ts` (types), `sdk/dist/hanoman.global.js` (IIFE browser). `dist/` gitignored (sudah), diikutkan ke tarball via `files`.

- [x] **Step 1: Implementasi `sdk/src/browser-global.ts`** (IIFE entry, kontrak SPEC-249)

```ts
// Global IIFE: <script src="hanoman.global.js"></script> setelah set window.HANOMAN_DSN.
// window.HANOMAN_DSN = "https://host/api/ingest/<slug>?key=hnm_ing_..."
// window.HANOMAN_OPTS = { environment, release }   (opsional)
import { init } from "./index";

const w = globalThis as { HANOMAN_DSN?: string; HANOMAN_OPTS?: { environment?: string; release?: string } };
if (w.HANOMAN_DSN) {
  init({ dsn: w.HANOMAN_DSN, environment: w.HANOMAN_OPTS?.environment, release: w.HANOMAN_OPTS?.release });
}
```

- [x] **Step 2: Tambah build scripts ke `sdk/package.json`**

Ganti blok `"scripts"` jadi:
```json
  "scripts": {
    "clean": "rm -rf dist",
    "build": "pnpm clean && esbuild src/index.ts --bundle --format=esm --platform=neutral --outfile=dist/index.js && esbuild src/index.ts --bundle --format=cjs --platform=node --outfile=dist/index.cjs && esbuild src/browser-global.ts --bundle --format=iife --minify --outfile=dist/hanoman.global.js && tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "prepublishOnly": "pnpm build"
  },
```
(`tsc` memakai `sdk/tsconfig.json` → `emitDeclarationOnly` ke `dist/`.)

- [x] **Step 3: Jalankan build**

Run: `pnpm --filter hanoman-sdk build`
Expected: sukses; `sdk/dist/` berisi `index.js`, `index.cjs`, `index.d.ts`, `hanoman.global.js`.

- [x] **Step 4: Verifikasi tiap entry termuat (smoke)**

Run:
```bash
node --input-type=module -e "import('./sdk/dist/index.js').then(m=>console.log('esm:', typeof m.init, typeof m.captureError, typeof m.initHanomanErrors))"
node -e "const m=require('./sdk/dist/index.cjs');console.log('cjs:', typeof m.init, typeof m.captureError)"
node -e "const s=require('fs').readFileSync('sdk/dist/hanoman.global.js','utf8');console.log('global bytes:', s.length, 'has HANOMAN_DSN:', s.includes('HANOMAN_DSN'))"
test -f sdk/dist/index.d.ts && echo "types: ok"
```
Expected: `esm: function function function`, `cjs: function function`, `global bytes: <n>` + `has HANOMAN_DSN: true`, `types: ok`.

- [x] **Step 5: Commit**

```bash
git add sdk/src/browser-global.ts sdk/package.json
git commit -m "feat(spec-254): build pipeline (esbuild ESM/CJS/IIFE + tsc types) for hanoman-sdk"
```

---

### Task 3: Docs — README npm-first, LICENSE, SoT updates, ADR-0062

**Files:**
- Rewrite: `sdk/README.md`
- Create: `sdk/LICENSE`
- Create: `internal/docs/adr/0062-hanoman-sdk-npm-package.md`
- Modify: `internal/docs/README.md` (baris integrasi + entri ADR-0062)
- Modify: `internal/docs/architecture/api-contract.md` (catatan npm package)
- Modify: `internal/docs/frontend/frontend-implementation.md` (SDK/snippet → npm `hanoman-sdk`)
- Modify: `internal/docs/security/security-standard.md` (DSN semi-publik di bundle npm)

**Interfaces:** tak ada kode; `sdk/README.md` adalah sumber tunggal panduan web (`GET /api/errors/integration-guide` membaca file ini).

- [x] **Step 1: Rewrite `sdk/README.md`** (npm-first; struktur: intro → install → Node/TS → browser (npm + CDN global) → payload → grouping/eskalasi → rilis). Isi lengkap:

````markdown
# hanoman-sdk — error monitoring untuk project apa pun (SPEC-249/254 · ADR-0060/0062)

Kirim error dari project-mu ke **hanoman** (Sentry ringan). hanoman mengelompokkan error identik jadi grup, menampilkannya di area **Errors**, memberi notifikasi saat grup produksi baru muncul, dan bisa dieskalasikan sekali klik jadi backlog (`Spec`).

> Isomorphic (Node + browser), **fire-and-forget** (hanoman down ≠ app crash), **tanpa dependency**. SDK ini akan tumbuh (logs, monitoring) — untuk sekarang: error capture.

## 1. Dapatkan DSN

Di hanoman: **Projects → (project) → kartu "DSN ingest" → Generate DSN**. DSN berbentuk URL gaya Sentry:

```
https://<host-hanoman>/api/ingest/<project-slug>?key=hnm_ing_xxxxxxxx
```

**Plaintext hanya ditampilkan sekali** — salin & simpan (mis. env `HANOMAN_DSN`). Bocor/hilang → **Rotate** (key lama langsung ditolak; tanpa grace). Nonaktifkan → **Revoke**.

## 2. Install

```bash
npm i hanoman-sdk    # atau: pnpm add hanoman-sdk / yarn add hanoman-sdk
```

## 3. Node / TypeScript

```ts
import { init, captureError } from "hanoman-sdk";

init({
  dsn: process.env.HANOMAN_DSN!,   // URL DSN dari hanoman
  environment: "production",       // hanya "production" yang memicu notifikasi grup baru
  release: "1.2.3",                // opsional
});

// Error tak tertangani (uncaughtException / unhandledRejection) terkirim otomatis.
// Manual:
try { risky(); } catch (e) { captureError(e, { route: "/checkout" }); }
```

- Butuh `fetch` global (Node ≥ 18). `init()` no-op bila `dsn` kosong.
- Kompatibel mundur: `initHanomanErrors` = alias `init` (nama lama tetap jalan).

## 4. Browser

**Via bundler (npm):**
```ts
import { init } from "hanoman-sdk";
init({ dsn: "https://hanoman.example/api/ingest/my-project?key=hnm_ing_...", environment: "production" });
```

**Via `<script>` (tanpa bundler, CDN):**
```html
<script>
  window.HANOMAN_DSN = "https://hanoman.example/api/ingest/my-project?key=hnm_ing_...";
  window.HANOMAN_OPTS = { environment: "production", release: "1.2.3" };
</script>
<script src="https://unpkg.com/hanoman-sdk/dist/hanoman.global.js"></script>
```

Memasang `window.onerror` + `unhandledrejection`; POST via `fetch` `keepalive`. Endpoint ingest membalas header CORS (`Access-Control-Allow-Origin: *`) sehingga pengiriman lintas-origin dari browser diterima.

## 5. Payload (JSON generik)

Bahasa apa pun bisa POST tanpa perubahan server:

```json
{
  "type": "TypeError",              // wajib
  "message": "x is undefined",       // wajib
  "stack": "TypeError...\n  at f()", // opsional (dipakai grouping)
  "environment": "production",       // opsional (default "unknown")
  "release": "1.2.3",                // opsional
  "context": { "url": "/checkout" }  // opsional
}
```

`POST <DSN>` (atau `POST /api/ingest/<slug>` dengan header `x-hanoman-dsn: <key>`). Balasan: `202 { ok, groupId, new }`. Batas: pesan ≤ 2 KB, stack ≤ 16 KB, body ≤ 64 KB; rate-limit per project. **Catatan privasi:** payload disimpan apa adanya (redaksi PII pasca-MVP) — jangan kirim rahasia/PII di `message`/`context`.

## Grouping & eskalasi

Error identik (tipe + pesan ternormalisasi + frame stack teratas) digabung jadi satu grup dengan hitungan, first/last-seen. Di area **Errors** hanoman, buka grup → **Eskalasi ke backlog** membuat `Spec` (QA) prefilled dari pesan + stack + tautan balik ke grup, lalu masuk alur backlog (audit → plan → execute).

## Rilis (maintainer hanoman)

Package dibangun dari `sdk/src/**` (source di repo hanoman). Untuk merilis versi baru:

```bash
cd sdk
# 1. naikkan "version" di package.json (semver)
pnpm build                 # emit dist/ (ESM, CJS, types, global IIFE)
npm publish --dry-run      # verifikasi isi tarball (dist + README + LICENSE)
npm publish                # butuh `npm whoami` terautentikasi; access publik
npm view hanoman-sdk version
```

Snippet copy-paste lama tetap tersedia sebagai source di `sdk/src/`.
````

- [x] **Step 2: Tulis `sdk/LICENSE`** (MIT)

```text
MIT License

Copyright (c) 2026 nafanesia

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [x] **Step 3: Tulis ADR** `internal/docs/adr/0062-hanoman-sdk-npm-package.md`

```markdown
# ADR-0062 — hanoman-sdk sebagai npm package publik (extensible, errors dulu)

**Status:** accepted · **Tanggal:** 2026-07-20 · **Spec:** SPEC-254
**Terkait:** [ADR-0060](0060-error-monitoring-ingest-ber-dsn.md) (ingest ber-DSN — kontrak yang di-consume)

## Konteks

ADR-0060 (SPEC-249) menyediakan endpoint ingest publik `POST /api/ingest/:slug` + dua helper **copy-paste** in-repo (`sdk/node/hanoman-error.ts`, `sdk/browser/hanoman-error.js`). Open question saat itu: publish SDK ke npm (ditunda pasca-MVP). SPEC-254 ("Errors go to public") mengangkatnya: project lain harus bisa memakai SDK **langsung dari npm**, dan SDK dirancang general untuk kapabilitas berikutnya (logs, monitoring).

## Keputusan

1. **Package publik `hanoman-sdk`** (unscoped, `0.1.0`, `publishConfig.access=public`) dari direktori `sdk/` yang kini jadi package pnpm-workspace. Isomorphic Node+browser, **fire-and-forget**, **tanpa dependency runtime**.
2. **Client murni endpoint ADR-0060 — tanpa perubahan server.** Kontrak payload (`type, message, stack?, environment?, release?, context?`), model, dan endpoint tak berubah. SDK hanya mem-POST ke DSN.
3. **Permukaan API fokus error dulu, seam untuk nanti.** Publik: `init()` + `captureError()`; internal `send(payload)` sebagai seam kapabilitas berikutnya (logs/monitoring) **tanpa** menyiratkan itu sudah ada. Alias `initHanomanErrors` menjaga kompat docs SPEC-249.
4. **Tiga entry**: ESM (`dist/index.js`), CJS (`dist/index.cjs`), types (`dist/index.d.ts`), plus IIFE global (`dist/hanoman.global.js`) untuk `<script>`/CDN yang membaca `window.HANOMAN_DSN` (kontrak snippet SPEC-249). Build: esbuild + tsc; `dist/` gitignored, diikutkan tarball via `files`.
5. **Guide web tetap dari `sdk/README.md`** (`GET /api/errors/integration-guide`) — README di-rewrite npm-first, jadi panduan web ikut ter-update tanpa perubahan route.

## Konsekuensi

- Direktori `sdk/` bukan lagi kumpulan snippet, melainkan package. `pnpm -r typecheck`/`pnpm test` mencakupnya (workspace + vitest.workspace).
- Rilis versi baru = bump `version` → `pnpm build` → `npm publish` (runbook di `sdk/README.md`). DSN semi-publik untuk browser (inheren) tetap seperti ADR-0060.
- Kapabilitas logs/monitoring sungguhan (model+endpoint server) tetap **pasca-MVP** — sengaja tak dibangun di sini demi thin path.

## Alternatif yang ditolak

- **Menambah kapabilitas logs server sekarang** (model + endpoint + migration): scope & risiko besar untuk satu workspace MVP; ditolak demi thin path (keputusan brainstorm SPEC-254).
- **`captureMessage`/`log` yang menyamar jadi error**: mengotori grup error; kapabilitas logs sungguhan = scope lain. Ditolak.
- **Package scoped `@hanoman/sdk`**: brief menetapkan nama `hanoman-sdk`. Ditolak.
- **Tetap copy-paste in-repo**: gagal memenuhi "sdk dapat digunakan oleh project" langsung. Ditolak.

## Acceptance (EARS)

- **AC-1** — WHEN project `import { init, captureError } from "hanoman-sdk"` lalu `captureError(e)`, THE SDK SHALL mem-POST payload sesuai kontrak ADR-0060 ke DSN, fire-and-forget.
- **AC-2** — IF hanoman down / `fetch` absen / DSN kosong, THEN `captureError` SHALL tidak melempar ke app.
- **AC-3** — THE package SHALL menyediakan entry ESM, CJS, types, dan build browser global.
- **AC-4** — THE server contract (payload/model/endpoint) SHALL tidak berubah.
```

- [x] **Step 4: Update `internal/docs/README.md`**

Ganti baris integrasi (bagian "integrasi (untuk project yang memakai hanoman)") jadi menyebut npm package:
```markdown
## integrasi (untuk project yang memakai hanoman)
- [SDK error monitoring — npm `hanoman-sdk`](../../sdk/README.md) — cara project lain mengirim error ke hanoman: `npm i hanoman-sdk` → `init({ dsn })` + `captureError()` (Node/browser) atau POST JSON generik langsung → grouping & eskalasi ke backlog (SPEC-249/254 · ADR-0060/0062)
```
Tambah entri ADR di bawah baris ADR-0060 (paling atas daftar adr):
```markdown
- [0062 — hanoman-sdk sebagai npm package publik (extensible, errors dulu)](adr/0062-hanoman-sdk-npm-package.md) — **memperluas 0060** (SPEC-254)
```

- [x] **Step 5: Update `internal/docs/architecture/api-contract.md`**

Di baris ~303-304 (blok catatan error monitoring) ganti frasa `**SDK/snippet** in-repo di `sdk/**`` jadi:
```markdown
> **SDK** = npm package publik `hanoman-sdk` (SPEC-254 · ADR-0062; source di `sdk/**`, Node + browser,
> DSN gaya Sentry). `GET /errors/integration-guide` tetap menyajikan `sdk/README.md` apa adanya.
```
(Sesuaikan wording agar menyatu dengan kalimat sekitarnya; inti: SDK kini npm `hanoman-sdk`, guide masih dari README.)

- [x] **Step 6: Update `internal/docs/frontend/frontend-implementation.md`**

Ganti blok ~380-381:
```markdown
**SDK** = npm package publik **`hanoman-sdk`** (SPEC-254 · ADR-0062; `npm i hanoman-sdk` → `init`/`captureError`,
Node + browser, DSN gaya Sentry, fire-and-forget). Source di `sdk/src/**`; panduan (`sdk/README.md`) disajikan
apa adanya di web via modal `IntegrationGuideModal` (`GET /api/errors/integration-guide`).
```

- [x] **Step 7: Update `internal/docs/security/security-standard.md`**

Di baris ~41-43 (DSN semi-publik), sesuaikan agar menyebut npm bundle:
```markdown
    in-memory per project (429) + retensi opportunistic. DSN browser inheren semi-publik (ship di bundle
    npm `hanoman-sdk` / snippet browser) — itulah alasan hash-at-rest + rotate tanpa grace.
```
(Tetap pertahankan poin **PII** di bawahnya; ganti "SDK/snippet" → "SDK `hanoman-sdk`".)

- [x] **Step 8: Verifikasi konsistensi index & link**

Run: `pnpm --filter @hanoman/cli exec hanoman docs index --check` (atau `node cli/dist/index.js docs index --check` bila sudah ter-build)
Expected: index konsisten (tak ada broken link). Bila CLI tak ter-build, lewati dan verifikasi manual bahwa `internal/docs/README.md` menaut `adr/0062-hanoman-sdk-npm-package.md` dan file itu ada.

- [x] **Step 9: Commit**

```bash
git add sdk/README.md sdk/LICENSE internal/docs/adr/0062-hanoman-sdk-npm-package.md internal/docs/README.md internal/docs/architecture/api-contract.md internal/docs/frontend/frontend-implementation.md internal/docs/security/security-standard.md
git commit -m "docs(spec-254): hanoman-sdk npm-first README + ADR-0062 + SoT updates"
```

---

### Task 4: Verifikasi web guide (endpoint tersentuh) + publish ke npm

**Files:** tak ada (verifikasi + rilis).

**Interfaces:** Consumes README (Task 3) + dist (Task 2).

- [x] **Step 1: Boot server & curl integration-guide (endpoint tersentuh oleh perubahan README)**

Boot server terhadap DB throwaway (jangan `hanoman_test`; lihat memory "Live smoke: dedicated DB"). Contoh minimal — setup DB unik, migrate, build server, jalankan, login, curl:
```bash
# DB unik agar sibling test tak men-truncate
export DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5433/hanoman_sdk254"
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman_sdk254' 2>/dev/null || true
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server build
env -u NODE_ENV PORT=8790 node server/dist/server.js &   # catat PID
sleep 2
# setup akun pertama + login → cookie
curl -s -c /tmp/hnm254.jar -X POST localhost:8790/api/auth/setup -H 'content-type: application/json' -d '{"email":"a@b.co","password":"pw12345678"}' >/dev/null
curl -s -b /tmp/hnm254.jar localhost:8790/api/errors/integration-guide | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('npm-first?', j.text.includes('npm i hanoman-sdk'));})"
kill %1 2>/dev/null || true
```
Expected: `npm-first? true` (README baru tersaji di web). Bila boot ribet, minimal verifikasi route membaca file: konfirmasi `sdk/README.md` memuat `npm i hanoman-sdk` (route hanya `readFile` file itu).

- [x] **Step 2: Full repo test hijau**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm test`
Expected: semua paket hijau (termasuk `sdk`). Perbaiki bila ada regresi sebelum lanjut.

- [x] **Step 3: Build + dry-run publish**

Run:
```bash
pnpm --filter hanoman-sdk build
cd sdk && npm publish --dry-run 2>&1 | tail -20 && cd ..
```
Expected: tarball berisi `dist/**` (index.js, index.cjs, index.d.ts, hanoman.global.js), `README.md`, `LICENSE`, `package.json`. Tak ada `src/` atau `test/` (karena `files` membatasi ke `dist`).

- [x] **Step 4: Publish (kredensial siap)**

Prasyarat: `npm whoami` = `denameidina` (sudah dikonfirmasi), nama `hanoman-sdk` tersedia (404, dikonfirmasi).
Run:
```bash
cd sdk && npm publish && cd ..
npm view hanoman-sdk version
```
Expected: publish sukses; `npm view hanoman-sdk version` → `0.1.0`.

**Fallback** (bila publish gagal karena OTP/2FA/registry/izin): JANGAN paksa. Laporkan error apa adanya; package tetap fully-publishable (dry-run hijau) + runbook di `sdk/README.md`. Operator menjalankan `npm publish` manual. Ini memenuhi AC-5 (publish atau publishable+dilaporkan).

- [x] **Step 5: Commit (bila ada perubahan, mis. version bump) & tandai plan selesai**

```bash
git add -A sdk docs/superpowers/plans
git commit -m "chore(spec-254): publish hanoman-sdk@0.1.0 (or publishable + runbook)" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- AC-1 (import + captureError POST) → Task 1 Step 4 test #1 + core impl.
- AC-2 (fire-and-forget) → Task 1 tests #3,#4,#5.
- AC-3 (ESM/CJS/types/global) → Task 2 build + Step 4 smoke.
- AC-4 (alias initHanomanErrors) → Task 1 test #6.
- AC-5 (publish or publishable+report) → Task 4 Steps 3-4 + fallback.
- AC-6 (web guide npm-first) → Task 3 Step 1 README + Task 4 Step 1 curl.
- AC-7 (server contract unchanged) → Global Constraint + no server files touched anywhere.

**Placeholder scan:** semua step berisi kode/perintah nyata; tak ada TBD/TODO. (Task 3 Steps 5-7 minta "sesuaikan wording" — dapat diterima karena teks target eksplisit diberikan; penyesuaian hanya agar menyatu dgn kalimat sekitar.)

**Type consistency:** `InitOpts`, `init`, `captureError`, `configure`, `send`, `initHanomanErrors` konsisten antara core.ts, index.ts, browser-global.ts, dan test. `hanoman-sdk` nama package konsisten di package.json, workspace, docs, publish.
