# SPEC-254 — hanoman-sdk: error SDK jadi npm package publik

**Tanggal:** 2026-07-20 · **Prioritas:** tinggi · **Sumber:** brief
**Membangun di atas:** SPEC-249 / [ADR-0060](../../../internal/docs/adr/0060-error-monitoring-ingest-ber-dsn.md)
**ADR baru:** ADR-0062 (hanoman-sdk sebagai npm package publik, extensible, errors dulu)

## Objective

Project lain bisa memakai SDK hanoman **langsung dari npm** (`npm i hanoman-sdk`), bukan lagi
copy-paste file in-repo. SDK dirancang **general/extensible** — sekarang hanya kapabilitas
error-capture (yang sudah ada di SPEC-249), tapi seams-nya siap untuk logs/monitoring nanti.
Docs & panduan hanoman diperbarui; panduan yang tampil di web (`GET /api/errors/integration-guide`)
ikut ter-update karena bersumber dari `sdk/README.md` yang sama.

## Scope (keputusan brainstorm)

- **Kemas** helper error-capture yang ada (`sdk/node/hanoman-error.ts`, `sdk/browser/hanoman-error.js`)
  jadi satu npm package **`hanoman-sdk`** yang isomorphic (Node + browser).
- **Tanpa perubahan server**: kontrak payload `POST /api/ingest/:slug` tetap persis
  (`{ type, message, stack?, environment?, release?, context? }`), model & endpoint tak berubah.
  SDK adalah **client murni** untuk endpoint ingest yang sudah ada.
- **API extensible** tapi permukaan publik fokus ke error dulu: `init()` + `captureError()`,
  plus alias mundur-kompatibel `initHanomanErrors` (nama SPEC-249). Seam internal `send(payload)`
  disiapkan untuk kapabilitas berikutnya (logs/monitoring) **tanpa** menyiratkan itu sudah ada.
- **Publish ke npm publik** sebagai `hanoman-sdk@0.1.0` (nama tersedia; akun `denameidina` sudah login).
- **Docs**: rewrite `sdk/README.md` (install npm sebagai jalur utama, copy-paste sebagai fallback),
  update `internal/docs` yang tersentuh + index, tambah ADR-0062.

## Non-Goals (YAGNI)

- **Tidak** menambah kapabilitas logs/monitoring sisi server (tak ada model/endpoint/migration baru).
- **Tidak** menambah `captureMessage`/`log` yang menyamar jadi error (akan mengotori grup error;
  itu kapabilitas logs sungguhan = scope lain).
- **Tidak** source-map, sampling, batching, offline queue, retry — pasca-MVP.
- **Tidak** mengubah UI selain memastikan panduan web tetap benar (README = satu-satunya sumber).

## Arsitektur package

Direktori `sdk/` berubah dari kumpulan snippet copy-paste jadi **package sungguhan** dalam pnpm workspace.

```
sdk/
  package.json          # name: hanoman-sdk, version 0.1.0, exports map, files, publishConfig, scripts
  tsconfig.json         # extends ../tsconfig.base.json, emit declaration
  src/
    core.ts             # transport + config + captureError (isomorphic, fire-and-forget)
    index.ts            # public API: init, captureError, initHanomanErrors (alias), types, default namespace
    browser-global.ts   # IIFE: baca window.HANOMAN_DSN/HANOMAN_OPTS → init (kontrak snippet SPEC-249)
  test/
    sdk.test.ts         # vitest: payload benar, fire-and-forget menelan error, extract name/message/stack, alias
  dist/                 # hasil build (gitignored), diikutkan saat publish via files
  README.md             # panduan (npm-first) — juga disajikan di web
  LICENSE
```

### API publik (extensible, errors dulu)

```ts
import { init, captureError } from "hanoman-sdk";

init({ dsn: process.env.HANOMAN_DSN!, environment: "production", release: "1.2.3" });
// init() memasang auto-handler sesuai runtime:
//   Node   → process.on("uncaughtException"|"unhandledRejection")
//   Browser→ window "error" | "unhandledrejection"
try { risky(); } catch (e) { captureError(e, { route: "/checkout" }); }
```

- **Backward-compat**: `initHanomanErrors` di-ekspor sebagai alias `init` (docs SPEC-249 tetap jalan).
- **Default export** `hanoman` = objek namespaced `{ init, captureError }` untuk pemakaian `import hanoman from "hanoman-sdk"`.
- **Isomorphic**: deteksi runtime (`typeof process`/`typeof window`) untuk memilih auto-handler; `fetch` global
  (Node ≥ 18 & browser modern). Semua **fire-and-forget** — kegagalan/absennya `fetch` ditelan, app tak jatuh.

### Entry points & build

Build dep ringan: **esbuild** (sudah di lockfile via vite) untuk bundle + **tsc** untuk `.d.ts`.

- `dist/index.js` — ESM (`--format=esm --platform=neutral`) → `exports["."].import`
- `dist/index.cjs` — CJS (`--format=cjs --platform=node`) → `exports["."].require`
- `dist/index.d.ts` — types (`tsc --emitDeclarationOnly`)
- `dist/hanoman.global.js` — IIFE terminify (browser `<script src>` / CDN unpkg/jsdelivr) → `exports["./global"]`, `unpkg`, `jsdelivr`

`package.json` inti:
```jsonc
{
  "name": "hanoman-sdk", "version": "0.1.0", "type": "module",
  "description": "Kirim error dari project apa pun ke hanoman (Sentry ringan). Node + browser, fire-and-forget.",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./global": "./dist/hanoman.global.js"
  },
  "main": "./dist/index.cjs", "module": "./dist/index.js", "types": "./dist/index.d.ts",
  "unpkg": "./dist/hanoman.global.js", "jsdelivr": "./dist/hanoman.global.js",
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "license": "MIT", "engines": { "node": ">=18" },
  "keywords": ["hanoman", "error-monitoring", "sentry", "observability", "sdk"],
  "publishConfig": { "access": "public" },
  "scripts": { "build": "...", "typecheck": "tsc --noEmit", "test": "vitest run", "prepublishOnly": "pnpm build" }
}
```

### Integrasi workspace

- Tambah `sdk` ke `pnpm-workspace.yaml` `packages` dan ke `vitest.workspace.ts`.
- `pnpm -r typecheck` & `pnpm test` ikut mencakup sdk. Build sdk **tidak** digabung ke root `build`
  (app tak butuh sdk); sdk punya build sendiri, dijalankan `prepublishOnly` saat publish.
- `dist/` masuk `.gitignore` (artefak build), tapi diikutkan ke tarball npm via `files`.

## Data flow

Tak berubah dari SPEC-249: `captureError(e)` → `send(payload)` → `POST <dsn>` (fire-and-forget) →
server ingest → fingerprint → `ErrorGroup`/`ErrorEvent` → area Errors + notifikasi + eskalasi.

## Error handling

- Semua jalur kirim `try/catch` + `.catch()` no-op (fire-and-forget). Absennya `fetch`, DSN kosong,
  atau hanoman down **tak pernah** melempar ke app pemanggil.
- `init()` tanpa `dsn` → no-op senyap (tak throw), auto-handler tetap dipasang tapi `send` short-circuit.

## Testing (TDD)

`vitest` (jsdom tak wajib; test pakai stub `globalThis.fetch`):
1. `captureError(new TypeError("x"))` mem-POST body `{ type:"TypeError", message:"x", stack, environment, release }` ke `dsn`.
2. `context` diteruskan apa adanya.
3. `fetch` reject / throw sinkron → `captureError` **tidak** melempar (fire-and-forget).
4. Extract dari non-Error (`captureError("boom")`) → `{ type:"Error", message:"boom" }`.
5. Tanpa `init()` (cfg null) → `captureError` no-op, tak POST.
6. Alias `initHanomanErrors === init`; default export punya `init`+`captureError`.

## Publish

Kredensial siap (`npm whoami` = `denameidina`), nama `hanoman-sdk` tersedia (404). Langkah:
`pnpm build` → `npm publish --dry-run` (verifikasi isi tarball) → `npm publish` → `npm view hanoman-sdk`.
Runbook + langkah rilis versi berikutnya ditulis di `sdk/README.md` bagian "Rilis".

## Docs (commit yang sama)

- `sdk/README.md` — **rewrite** npm-first (install, `init`/`captureError`, browser via npm + CDN global,
  payload generik, bagian "Rilis"). Tetap juga sumber panduan web.
- `internal/docs/architecture/api-contract.md` — catatan: SDK kini npm `hanoman-sdk`, integration-guide masih dari `sdk/README.md`.
- `internal/docs/frontend/frontend-implementation.md` — update baris "SDK/snippet ... copy-paste" → npm package `hanoman-sdk` (+ file lama tetap sebagai source).
- `internal/docs/security/security-standard.md` — DSN semi-publik di bundle npm/browser (catatan tak berubah maknanya, sebut package).
- `internal/docs/adr/0062-hanoman-sdk-npm-package.md` — ADR baru.
- `internal/docs/README.md` — update baris integrasi + tambah ADR-0062 ke daftar.

## ADR-0062 (ringkas)

**Keputusan:** SDK error hanoman diterbitkan sebagai npm package publik `hanoman-sdk` (isomorphic Node+browser,
fire-and-forget), sebagai client murni endpoint ingest ADR-0060 — **tanpa** perubahan server. Permukaan API
fokus error dulu (`init`/`captureError`) dengan seam internal untuk kapabilitas berikutnya (logs/monitoring),
menggantikan pola copy-paste in-repo. **Konsekuensi:** file `sdk/node|browser/*` lama dipertahankan sebagai
source yang di-bundle; guide web tetap dari `sdk/README.md`. **Alternatif ditolak:** (a) menambah kapabilitas
logs server sekarang (scope+migration besar, ditolak demi thin path); (b) `captureMessage` yang menyamar jadi
error (mengotori grup); (c) package scoped `@hanoman/sdk` (brief menetapkan nama `hanoman-sdk`).

## Acceptance (EARS)

- **AC-1** — WHEN project meng-`import { init, captureError } from "hanoman-sdk"` lalu `captureError(e)`,
  THE SDK SHALL mem-POST payload sesuai kontrak ADR-0060 ke DSN, fire-and-forget.
- **AC-2** — IF hanoman down / `fetch` absen / DSN kosong, THEN `captureError` SHALL tidak melempar ke app.
- **AC-3** — THE package SHALL punya entry ESM, CJS, types, dan build browser global (`<script>`/CDN).
- **AC-4** — THE alias `initHanomanErrors` SHALL setara `init` (mundur-kompatibel dgn docs SPEC-249).
- **AC-5** — THE package `hanoman-sdk@0.1.0` SHALL ter-publish ke npm publik (atau, bila publish gagal
  karena kredensial/registry, package SHALL tetap fully-publishable + runbook & dilaporkan).
- **AC-6** — THE panduan web (`GET /api/errors/integration-guide`) SHALL menampilkan README npm-first
  (karena bersumber dari `sdk/README.md` yang sama).
- **AC-7** — THE server contract (payload/model/endpoint) SHALL tidak berubah.
