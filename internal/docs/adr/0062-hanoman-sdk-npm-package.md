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

- Direktori `sdk/` bukan lagi kumpulan snippet, melainkan package. Sumber tunggal SDK kini `sdk/src/**` (core.ts + index.ts + browser-global.ts); helper copy-paste lama `sdk/node|browser/*` **digantikan** olehnya (dihapus untuk hindari duplikat basi). `pnpm -r typecheck`/`pnpm test` mencakup `sdk` (workspace + vitest.workspace).
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
