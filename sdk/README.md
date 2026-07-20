# hanoman error SDK/snippet (SPEC-249 · ADR-0060)

Kirim error dari project apa pun ke **hanoman** (Sentry ringan). hanoman mengelompokkan error identik jadi grup, menampilkannya di area **Errors**, memberi notifikasi saat grup produksi baru muncul, dan bisa dieskalasikan sekali klik jadi backlog (`Spec`).

> Helper ini **in-repo & copy-paste** — belum dipublish ke npm (pasca-MVP). Salin file yang kamu butuh ke project-mu.

## 1. Dapatkan DSN

Di hanoman: **Projects → (project) → kartu "DSN ingest" → Generate DSN**. DSN berbentuk URL gaya Sentry:

```
https://<host-hanoman>/api/ingest/<project-slug>?key=hnm_ing_xxxxxxxx
```

**Plaintext hanya ditampilkan sekali** — salin & simpan (mis. env `HANOMAN_DSN`). Bocor/hilang → **Rotate** (key lama langsung ditolak; tanpa grace). Nonaktifkan → **Revoke**.

## 2. Node/TS (`sdk/node/hanoman-error.ts`)

```ts
import { initHanomanErrors, captureError } from "./hanoman-error";

initHanomanErrors({
  dsn: process.env.HANOMAN_DSN!,   // URL DSN dari hanoman
  environment: "production",       // hanya "production" yang memicu notifikasi grup baru
  release: "1.2.3",                // opsional
});

// Error tak tertangani (uncaughtException / unhandledRejection) terkirim otomatis.
// Manual:
try { risky(); } catch (e) { captureError(e, { route: "/checkout" }); }
```

- **Fire-and-forget**: hanoman down / lambat **tidak** menjatuhkan app (kegagalan ditelan).
- Butuh `fetch` global (Node ≥ 18).

## 3. Browser (`sdk/browser/hanoman-error.js`)

```html
<script>
  window.HANOMAN_DSN = "https://hanoman.example/api/ingest/my-project?key=hnm_ing_...";
  window.HANOMAN_OPTS = { environment: "production", release: "1.2.3" };
</script>
<script src="/hanoman-error.js"></script>
```

Memasang `window.onerror` + `unhandledrejection`; POST via `fetch` `keepalive`. Endpoint ingest membalas header CORS (`Access-Control-Allow-Origin: *`) sehingga pengiriman lintas-origin dari browser diterima.

## 4. Payload (JSON generik)

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
