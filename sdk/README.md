# hanoman-sdk — error monitoring untuk project apa pun (SPEC-249/254 · ADR-0060/0063)

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
  "frames": [                        // opsional — SDK JS mengisinya otomatis (SPEC-276)
    { "function": "handleClick", "filename": "index-4f3a2b.js", "lineno": 1, "colno": 88421, "in_app": true }
  ],
  "environment": "production",       // opsional (default "unknown")
  "release": "1.2.3",                // opsional (WAJIB bila mau symbolication — lihat §6)
  "context": { "url": "/checkout" }  // opsional
}
```

`POST <DSN>` (atau `POST /api/ingest/<slug>` dengan header `x-hanoman-dsn: <key>`). Balasan: `202 { ok, groupId, new }`. Batas: pesan ≤ 2 KB, stack ≤ 16 KB, body ≤ 64 KB; rate-limit per project. **Catatan privasi:** payload disimpan apa adanya (redaksi PII pasca-MVP) — jangan kirim rahasia/PII di `message`/`context`. SDK JS otomatis mem-parse `stack` → `frames[]` (dengan `in_app`) dan meng-unwrap rantai `error.cause`.

## 6. Source-map — stack jelas untuk build minified (SPEC-276 · ADR-0070)

Build produksi (Vite/webpack: minified + content-hash) membuat stack menunjuk `index-4f3a2b.js:1:88421`, bukan `.ts/.tsx` sumber. Agar hanoman men-**symbolicate**-nya (de-minify ke posisi sumber + cuplikan baris + penanda `in_app`, seperti Sentry), **upload source-map per `release`**:

1. Set `release` yang **sama** di `init({ release })` dan saat upload (kunci pencocokan).
2. Build dengan source-map aktif (Vite: `build.sourcemap: true` → menghasilkan `dist/assets/*.js.map`).
3. Upload tiap `.map` (auth pakai DSN key yang sama):

```bash
# curl per artifact (map = isi berkas .map)
curl -X POST "https://hanoman.example/api/ingest/my-project/sourcemaps?key=hnm_ing_..." \
  -H "content-type: application/json" \
  -d "{\"release\":\"1.2.3\",\"artifacts\":[{\"filename\":\"index-4f3a2b.js\",\"map\":$(jq -Rs . < dist/assets/index-4f3a2b.js.map)}]}"
```

```js
// atau Node kecil (upload semua .map di dist/assets sekaligus)
import { readFileSync, readdirSync } from "node:fs";
const dir = "dist/assets", release = process.env.RELEASE;
const artifacts = readdirSync(dir).filter(f => f.endsWith(".js.map")).map(f => ({
  filename: f.replace(/\.map$/, ""),                 // basename artifact hasil-build (tanpa .map)
  map: readFileSync(`${dir}/${f}`, "utf8"),
}));
await fetch(`${process.env.HANOMAN_DSN_BASE}/sourcemaps?key=${process.env.HANOMAN_INGEST_KEY}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ release, artifacts }),
});
```

- `filename` = **basename artifact hasil-build** yang dipetakan map (mis. `index-4f3a2b.js`), bukan nama `.map`-nya.
- Balasan `202 { ok, stored }`. Batas total body 30 MB. Byte map disimpan server-local (tak disync); retensi menyimpan N release terbaru.
- Symbolication berjalan **lazy saat kamu membuka grup** di area Errors — jadi urutan upload map & datangnya error tidak kritis (upload saat deploy sudah cukup). Map belum ada → stack tampil apa adanya (raw), tak error.

**Backend Node/TS:** jika app menjalankan `dist` JS terkompilasi, jalankan dengan `node --enable-source-maps` agar `error.stack` sudah menunjuk `.ts` sumber (fidelity gratis, tanpa upload apa pun).

## Grouping & eskalasi

Error identik (tipe + pesan ternormalisasi + frame teratas) digabung jadi satu grup dengan hitungan, first/last-seen. **SPEC-276:** frame teratas dinormalisasi dari content-hash bundle (`index-4f3a2b.js`→`index.js`) sehingga error browser yang sama **tak pecah jadi grup baru tiap deploy**. Di area **Errors** hanoman, buka grup → frame tersimbolikasi (bila map ter-upload) + **Eskalasi ke backlog** membuat `Spec` (QA) prefilled dari pesan + stack + tautan balik ke grup, lalu masuk alur backlog (audit → plan → execute).

## Rilis (maintainer hanoman)

Package dibangun dari `sdk/src/**` (source di repo hanoman). Untuk merilis versi baru:

```bash
cd sdk
# 1. naikkan "version" di package.json (semver)
pnpm build                 # emit dist/ (ESM, CJS, types, global IIFE)
npm publish --dry-run      # verifikasi isi tarball (dist + README + LICENSE)
npm publish --otp=123456   # akun ber-2FA WAJIB kirim OTP authenticator (6 digit);
                           # atau pakai granular access token "bypass 2FA" via CI.
npm view hanoman-sdk version
```

> **2FA**: registry npm menolak publish tanpa OTP bila akun mengaktifkan two-factor (`403 … Two-factor
> authentication … required`). Jalankan `npm publish --otp=<kode>` interaktif, atau set token granular.

Snippet copy-paste lama tetap tersedia sebagai source di `sdk/src/`.
