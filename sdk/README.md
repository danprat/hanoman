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
