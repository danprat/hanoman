# Design — Log Error Monitoring (Sentry ringan) · SPEC-249

> Turunan dari PRD `docs/prd/log-error-monitoring.md`. Dokumen ini adalah **spec teknis** (arsitektur + kontrak) yang menerjemahkan PRD ke implementasi. Keputusan mengikat dari brainstorm dicatat di bagian **Keputusan terkunci**.

## Objective (terkunci)

Jadikan hanoman **Sentry ringan satu-workspace**: satu tempat untuk **menangkap error dari project apa pun** yang didaftarkan (via DSN per-project), **mengelompokkannya** jadi grup, **menampilkannya** di area Error, **memberi notifikasi in-app** saat grup produksi baru muncul, dan **mengeskalasikannya sekali klik** menjadi `Spec` (source qa) yang masuk alur backlog existing. Versi pertama = **jalur end-to-end tipis tapi utuh**: ingest → group → lihat → notifikasi → eskalasi, plus DSN mgmt, rate-limit, retensi, dan SDK/snippet Node+browser in-repo. Fitur berat ala Sentry (APM/tracing, session replay, symbolication, alert eksternal, grouping override, regresi/re-open, SDK mobile, multi-workspace) **di luar scope v1**.

## Keputusan terkunci (dari brainstorm)

1. **Format DSN** — URL gaya Sentry: `POST /api/ingest/:slug?key=<key>` (key juga boleh via header `x-hanoman-dsn`). Key disimpan **hash-at-rest tunggal** di `Project.ingestKeyHash` (+ `ingestKeyPrefix` untuk hint tampilan). Rotate = ganti (tanpa grace). Plaintext ditampilkan **sekali** saat generate/rotate (pola `DeviceToken`).
2. **Siklus status grup** — `new → escalated → resolved`. Notifikasi **hanya** saat grup **baru** (environment production). Regresi/re-open grup resolved → **pasca-MVP**.
3. **Scope SDK v1** — helper Node/TS + snippet browser **in-repo** (`sdk/**`) + docs pemasangan. Publish npm → pasca-MVP.
4. **Redaksi PII** — v1 **simpan apa adanya** + truncate/caps ukuran. Scrub PII → pasca-MVP (Open question PRD).

## Fakta arsitektur yang mengikat (dari SoT)

- **Auth gate** (`server/src/app.ts`): hook `onRequest` menggerbangi seluruh `/api`; ada `PUBLIC` set (match `METHOD /path` eksak) dan bypass prefix `if (path.startsWith("/api/sync")) return;`. Endpoint ingest mengikuti pola **bypass prefix** `startsWith("/api/ingest")` lalu **DSN-auth sendiri** di route → butuh **ADR baru**.
- **Notification.type** = `String` longgar (sudah `done|decision|drift`). Tipe baru `error` **tak butuh migration kolom**; dedup lewat `key = "error:<groupId>"` (`@unique`, insert kedua kena P2002, diabaikan). Notif tersiar otomatis lewat grup `notifications` di `services/events.ts` (recompute 3 dtk). Klien perlu mengenali `type: "error"`.
- **Spec creation** (`routes/specs.ts`): eskalasi membuat `Spec` source `qa`, memakai `deriveSpecFields` + `nextSpecId` (retry P2002). `zQaPayload` sudah punya preseden field jejak opsional (`fromAudit`) → tambah `fromErrorGroup`.
- **Migrasi**: hand-write `migration.sql` + `migrate deploy` per DB (dev `hanoman` + test `hanoman_test`), `prisma generate` sesudahnya. Jangan `migrate dev` (reset saat drift worktree).
- **Realtime**: daftar Error pakai **HTTP polling** (pola silent-poll `GitGraph.tsx`), bukan kanal WS baru. Notifikasi lewat WS existing.
- **Frontend**: tak ada router — nav = `section` string di `App.tsx` + `HN_NAV` di `ds/shell.tsx`. Detail via master-detail state (pola `review`). Show-once secret + copy = pola `DeviceTokensPanel`. Warna via token DS (`--status-err`, `--brass-*`, `--bone-*`).

## Data model (migration + ADR)

Dua model baru + dua kolom `Project`. Model error **server-local** (seperti `Notification`) — **tanpa** `version`/sync (volume tinggi, satu workspace).

### `Project` (kolom baru, additive)
- `ingestKeyHash String?` — `sha256(key)` hex; `null` = monitoring belum diaktifkan.
- `ingestKeyPrefix String?` — ~12 char awal key (mis. `hnm_ing_a1b2`) untuk hint UI. Bukan rahasia.
- **Tak pernah ke client**: `ProjectView` mengekspos `monitoringEnabled: boolean` + `ingestKeyPrefix` (hint), **tidak** `ingestKeyHash`.

### `ErrorGroup`
```
id           String   @id @default(cuid())
projectId    String                       // FK Project onDelete Cascade
fingerprint  String
type         String                        // nama/tipe error (representatif)
message      String                        // pesan sampel (representatif)
sampleStack  String?                       // stack sampel (representatif)
environment  String                        // environment last-seen
status       String   @default("new")      // new | escalated | resolved
count        Int      @default(0)
firstSeenAt  DateTime @default(now())
lastSeenAt   DateTime @default(now())
specId       String?                       // tautan ke Spec hasil eskalasi
createdAt    DateTime @default(now())
updatedAt    DateTime @default(now())
@@unique([projectId, fingerprint])
@@index([projectId, lastSeenAt])
```

### `ErrorEvent` (kejadian mentah, dipangkas retensi)
```
id           String   @id @default(cuid())
groupId      String                        // FK ErrorGroup onDelete Cascade
projectId    String                        // denormal — isolasi & query per-project murah
type         String
message      String
stack        String?
environment  String
release      String?                        // opsional
context      Json?                          // opsional (url/route/dll)
receivedAt   DateTime @default(now())
@@index([groupId, receivedAt])
@@index([projectId, receivedAt])
```

## Kontrak API

### Publik (DSN-authed, bypass gate cookie)
- `POST /api/ingest/:slug` — body JSON `{ type, message, stack?, environment?, release?, context? }`. Auth: `?key=` **atau** header `x-hanoman-dsn`. Resolusi: load `Project` by slug → `timingSafeEqual(sha256(key), ingestKeyHash)`. **Respon:** `202 { ok, groupId, new }` · `400` payload invalid · `401/403` DSN hilang/salah/revoked (generik, tak bocorkan project) · `404` slug tak ada (generik jadi 401 agar tak enumerasi) · `413` payload > cap keras · `429` rate-limit.
- **CORS**: balas `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: content-type,x-hanoman-dsn`, tangani `OPTIONS` preflight (browser).

### Authed (di belakang gate)
- `GET /api/errors` — daftar grup. Query `project? environment? status? q? page? limit?`; urut `lastSeenAt desc`; paginasi `paginate`.
- `GET /api/errors/:id` — detail grup + N kejadian sampel terakhir.
- `POST /api/errors/:id/escalate` — buat `Spec` (qa) prefilled + set `status=escalated` + `specId`; **idempoten**: sudah escalated → `{ specId, alreadyEscalated: true }`.
- `PATCH /api/errors/:id` — `{ status }` (mis. `resolved`).
- `POST /api/projects/:id/ingest-key` — generate/rotate → `{ key, dsnUrl, prefix }` (plaintext **sekali**).
- `DELETE /api/projects/:id/ingest-key` — revoke (kosongkan hash → monitoring off).
- `GET /api/projects/:id/ingest-key` — `{ enabled, prefix }` (tanpa plaintext).

### Wire (shared/src)
- `dto.ts`: `zErrorGroupView`, `zErrorEventView`, `zIngestKeyView`. `enums.ts`/`entities.ts`: `zErrorStatus`, tambah `error` ke `zNotification.type`, tambah `fromErrorGroup?` ke `zQaPayload`.
- `api.ts` `paths`: `ingest(slug)`, `errors`, `error(id)`, `errorEscalate(id)`, `projectIngestKey(id)`.
- `client.ts`: `listErrors`, `getError`, `escalateError`, `patchError`, `rotateIngestKey`, `revokeIngestKey`, `getIngestKey`.

## Grouping (deterministik, dep-free)

Modul `server/src/services/error-fingerprint.ts` — fungsi murni (unit-test tanpa DB):
- `normalizeMessage(msg)` — ganti token volatil dgn placeholder: digit-run → `<n>`, hex/`0x…`/UUID → `<hex>`/`<uuid>`, string ber-kutip → `<str>`, alamat memori/timestamp → placeholder.
- `topFrame(stack)` — frame teratas: `fn @ file` tanpa `:line:col` & tanpa prefix path absolut.
- `fingerprint(type, message, stack)` = `sha256(type + "\n" + normalizeMessage(message) + "\n" + topFrame(stack))` hex (32 char).

## Pemrosesan ingest (service `error-ingest.ts`)

1. **Validasi + caps**: zod; truncate `message` ≤ 2 KB, `stack` ≤ 16 KB; body > 64 KB → `413`.
2. **Rate-limit**: token-bucket **in-memory** per project (`Map<projectId, bucket>`, mis. 120/min, burst 40). Lewat → `429`. Single-process (patuh "tanpa queue/Redis"). Test bisa turunkan batas via config.
3. **Fingerprint** dari payload.
4. **Upsert grup** `(projectId, fingerprint)`:
   - Tak ada → **create** (`status=new`, `count=1`, first/last=now). Jika `environment==="production"` → catat **Notification** `error` (`key="error:<groupId>"`). `new=true`.
   - Ada → `count++`, `lastSeenAt=now`, `environment=payload.env`, `updatedAt=now`. **Tanpa** notif. `new=false`.
5. **Insert `ErrorEvent`**.
6. **Retensi (opportunistic on-write, tanpa scheduler baru)**: untuk grup itu, hapus event di luar **cap N terakhir** (mis. 50) **dan** yang lebih tua dari **retensi** (mis. 30 hari). Ringkasan grup (count/first/last) tetap. Tak menambah `setInterval` global (patuh "kerja latar minimal").

## Notifikasi

Grup **baru** + `environment==="production"` → `Notification { type:"error", key:"error:<groupId>", projectId, title }` (mis. `"Error baru di <project>: <type>: <message>"`). Tersiar lewat grup `notifications` WS existing. Klien: extend `toastFor` + `NotificationBell` (icon `triangle-alert`, tone `--status-err`) + `notifTarget` → route ke area Errors. Grup lama = tak ada notif tambahan (AC PRD).

## Eskalasi ke backlog

`POST /api/errors/:id/escalate`:
- `group.specId` sudah ada → `{ specId, alreadyEscalated:true }` (cegah dobel).
- Bangun `qa` payload prefill: `severity:"major"`, `steps` = "Otomatis dari Error monitoring", `expected` = "tidak ada error", `actual` = `message` + top stack, `env` = environment, `fromErrorGroup = group.id`. `title` = `"<type>: <message ringkas>"`.
- Buat `Spec` (source qa) lewat jalur sama `routes/specs` (`deriveSpecFields` + `nextSpecId` retry). Objective/actual memuat back-link teks "Dari Error monitoring: grup <id> (<count>×, <env>)".
- Set `group.status="escalated"`, `group.specId=spec.id`. Return spec.
- Spec masuk **alur backlog existing** (audit → plan → execute) tanpa mekanisme khusus.

## Frontend

- **Nav**: `ds/shell.tsx` `HN_NAV` + `App.tsx` `section === "errors"` branch (pola VPS: self-fetch, tanpa `gate`).
- **`ErrorsScreen.tsx`**: self-fetch + **silent poll** (pola `GitGraph`, `!document.hidden`). Daftar grup (`Card`+`Badge` count+`StatusPill` status + env + last-seen). Filter environment + project + paginasi.
- **Detail grup**: master-detail via section/selection (pola `review`); tampil message, sample stack, env, first/last seen, count; tombol **"Eskalasi ke backlog"** → `api.escalateError` → arah ke backlog; bila sudah escalated tampil "→ SPEC-N".
- **DSN mgmt** (ProjectDetail/`EditProjectModal`): kartu prefix + tombol **Generate/Rotate** (show-once URL + copy, pola `DeviceTokensPanel`) + **Revoke**.
- **Notif**: `zNotification.type` + `toastFor` + `NotificationBell` + `notifTarget`.

## SDK/snippet (in-repo)

- `sdk/node/hanoman-error.ts` — `initHanomanErrors({ dsn, environment, release })` pasang `process.on("uncaughtException")` + `unhandledRejection` + `captureError(err, ctx?)`. POST fire-and-forget, telan kegagalan (hanoman down ≠ app crash).
- `sdk/browser/hanoman-error.js` — snippet `window.onerror` + `unhandledrejection`, `fetch(..., { keepalive:true })`.
- `sdk/README.md` — cara pasang Node & browser (DSN, environment, release).

## Keamanan & data

- Ingest = **pengecualian sah** gate `/api`, diotorisasi **hanya** DSN (ADR baru). Error generik — tak bocorkan project.
- **Isolasi antar-project**: query error selalu ber-scope `projectId`; DSN satu project tak pernah menyentuh error project lain.
- Model error via **migration + ADR**. Caps payload + rate-limit + retensi (angka di atas; tunable via config).
- `ingestKeyHash` **tak pernah** ke client/log.

## Rencana docs SoT tersentuh (commit sama)

- **ADR baru** (nomor bebas berikutnya, enumerasi lintas branch dulu) — Error monitoring: model baru + ingest ber-DSN sebagai pengecualian auth.
- `architecture/data-model.md` — ErrorGroup, ErrorEvent, kolom ingest key (narasi "tujuh model" → sembilan).
- `architecture/api-contract.md` — ingest + errors + ingest-key.
- `security/security-standard.md` — pengecualian DSN + rate-limit + caps.
- `frontend/frontend-implementation.md` — area Errors.
- `README.md` — link ADR baru (+ `sdk/README.md` bila relevan).

## Rencana verifikasi

Tiap task: `vitest run --no-file-parallelism` hijau (`env -u NODE_ENV -u DATABASE_URL`, base DB unik untuk hindari truncate sibling) **plus** boot server lokal + `curl` endpoint tersentuh (ingest real POST, escalate real, DSN rotate). Plan `docs/superpowers/plans/**` semua `- [x]` sebelum `Execute done`.

## Out of scope (v1)

Tracing/APM, session replay, symbolication source-map, alert eksternal (email/Slack/webhook), deteksi lonjakan, grouping override manual (merge/split), **regresi/re-open** grup resolved, scrub PII, SDK mobile, multi-workspace/RBAC, mesin analitik lanjutan, publish npm SDK.
