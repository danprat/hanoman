# ADR-0060 — Error monitoring: model baru + ingest ber-DSN sebagai pengecualian auth

**Status:** accepted · **Tanggal:** 2026-07-20 · **Spec:** SPEC-249
**Terkait:** [ADR-0028](0028-auth-sesi-opaque-di-db.md) (auth sesi menggerbangi `/api`),
[ADR-0044](0044-device-token-machine-identity.md) (token hash-at-rest, pola verifikasi),
[ADR-0033](0033-notifikasi-backlog-selesai.md) (Notification reuse), [ADR-0040](0040-jalur-cepat-qa-dielicit-prompt.md) (source qa),
[ADR-0039](0039-realtime-lewat-websocket-siar.md) (siar dashboard), [ADR-0021](0021-nomor-spec-diklaim-docs-bukan-hanya-database.md) (nomor lintas branch)

## Konteks

PRD `docs/prd/log-error-monitoring.md` meminta hanoman berperilaku seperti **Sentry ringan**: menangkap error dari project apa pun via **DSN per-project**, mengelompokkannya, menampilkannya, memberi notifikasi grup baru, dan mengeskalasikannya sekali klik jadi backlog. Dua fakta arsitektur mengikat desain:

1. **Auth menggerbangi seluruh `/api`** (ADR-0028): 401 tanpa sesi login. Endpoint ingest dipanggil project eksternal **tanpa** cookie sesi → butuh **pengecualian sah** yang diotorisasi bukan-cookie.
2. **Menambah kemampuan error monitoring = menambah model** (grup + kejadian) yang **wajib lewat migration + ADR** (tak boleh ubah skema tanpa itu).

## Keputusan

### 1. Dua model baru + dua kolom `Project` (migration)

- **`ErrorGroup`** — grup error per project: `fingerprint`, `type`, `message`, `sampleStack?`, `environment`, `status` (`new|escalated|resolved`), `count`, `firstSeenAt`, `lastSeenAt`, `specId?` (tautan eskalasi). Unik `(projectId, fingerprint)`; index `(projectId, lastSeenAt)`; FK `Project` cascade.
- **`ErrorEvent`** — kejadian mentah (dipangkas retensi): `type`, `message`, `stack?`, `environment`, `release?`, `context? (Json)`, `receivedAt`. Index `(groupId, receivedAt)` + `(projectId, receivedAt)`; FK `ErrorGroup` cascade.
- **`Project.ingestKeyHash?`** + **`Project.ingestKeyPrefix?`** — kunci ingest hash-at-rest + hint prefix.

Model error **server-local** (seperti `Notification`): **tanpa** `version`/sync — volume tinggi, satu workspace. `status` disimpan `String` (bukan enum Prisma), divalidasi `zErrorStatus` di `@hanoman/shared` — konsisten data-model.

### 2. Ingest publik ber-DSN sebagai pengecualian sah gate `/api`

`POST /api/ingest/:slug` (+ `OPTIONS` untuk CORS browser) di-**bypass** gate cookie lewat prefix `if (path.startsWith("/api/ingest")) return;` di `app.ts` — **cermin pola `/api/sync`** (ADR-0044/0046 yang meng-enforce device token sendiri). Route melakukan **DSN-auth sendiri**: load `Project` by slug, `timingSafeEqual(sha256(key), ingestKeyHash)`. Key dari `?key=` **atau** header `x-hanoman-dsn`. **DSN gaya Sentry** (URL `…/api/ingest/<slug>?key=<key>`): key semi-publik (browser inheren mengeksposnya), tersimpan **hash-at-rest tunggal** (pola `DeviceToken`) + `prefix` untuk hint UI; plaintext ditampilkan **sekali** saat generate/rotate. Rotate = ganti (**tanpa grace**). Error generik (project salah / DSN salah → sama-sama 401) agar tak mengenumerasi project.

### 3. Grouping deterministik via fingerprint

`fingerprint(type, message, stack)` = `sha256(type + normalizeMessage(message) + topFrame(stack))` (`server/src/services/error-fingerprint.ts`, fungsi murni). `normalizeMessage` meng-collapse token volatil (angka, hex, UUID, string ber-kutip); `topFrame` mengambil frame teratas tanpa `:line:col` & path absolut → varian dari error yang sama jatuh ke satu grup.

### 4. Ketahanan: caps, rate-limit, retensi — tanpa infrastruktur baru

- **Caps**: `message` ≤ 2 KB, `stack` ≤ 16 KB, body > 64 KB → 413. PII **disimpan apa adanya** (scrub → pasca-MVP).
- **Rate-limit**: token-bucket **in-memory** per project (default 120/min, `HANOMAN_INGEST_RATE_PER_MIN`) → 429. Single-process, **patuh "tanpa queue/Redis"** (ADR-0024).
- **Retensi opportunistic-on-write**: tiap ingest memangkas event grup di luar cap terakhir (default 50, `HANOMAN_ERROR_EVENTS_PER_GROUP`) + lebih tua dari retensi (default 30 hari, `HANOMAN_ERROR_RETENTION_DAYS`). **Tanpa `setInterval` global baru** (kerja latar tetap minimal).

### 5. Notifikasi & eskalasi reuse jalur existing

- **Notifikasi**: grup **baru** + `environment==="production"` → `Notification { type:"error", key:"error:<groupId>" }` (dedup idempoten via `key` unik). `type` sudah `String` longgar (`done|decision|drift`) → **tanpa migration kolom**; tersiar otomatis lewat grup `notifications` di `services/events.ts` (ADR-0039).
- **Eskalasi**: `POST /api/errors/:id/escalate` membuat `Spec` (source `qa`) prefilled (message + stack + backlink), set `status=escalated` + `specId`; jejak grup dibawa `zQaPayload.fromErrorGroup` (cermin `fromAudit`, ADR-0059). Idempoten: sudah escalated → kembalikan Spec yang ada. Spec masuk **alur backlog existing** (audit → plan → execute) tanpa mekanisme khusus.

### 6. Realtime = polling untuk area Error

Daftar Error memakai **HTTP polling** (pola silent-poll `GitGraph`), **bukan** kanal WS baru (ADR-0039). Notifikasi tetap lewat WS siar existing.

## Konsekuensi

- Skema tumbuh dari tujuh model inti → **sembilan** (+ErrorGroup, +ErrorEvent); dua kolom `Project` additive. Migration hand-written + `migrate deploy` per DB.
- `ingestKeyHash` **tak pernah** ke client/log; `ProjectView` hanya mengekspos `monitoringEnabled` + `ingestKeyPrefix`.
- DSN semi-publik untuk browser (inheren). Rotate tanpa grace → deploy yang memakai key lama langsung 401 (dokumentasikan di `sdk/README.md`).
- Regresi/re-open grup resolved, scrub PII, source-map browser, dan publish npm SDK **pasca-MVP** (Open questions PRD).

## Alternatif yang ditolak

- **DSN opaque + model `ProjectDsn` (rotate dengan grace)** — lebih future-proof tapi menambah model & kompleksitas overlap untuk keuntungan kecil di satu workspace MVP. Ditolak demi thin path (keputusan brainstorm).
- **Kanal WebSocket khusus error** — melanggar ADR-0039 (sisanya polling). Ditolak.
- **Kirim error via mekanisme backlog baru** — melanggar "menyambung ke jalur backlog existing". Eskalasi reuse `Spec` qa. Ditolak.
- **Enum Prisma untuk `status`** — melanggar konvensi String+zod data-model. Ditolak.

## Acceptance (EARS)

- **AC-1** — WHEN project POST error ke `/api/ingest/:slug` dengan DSN valid, THE server SHALL menyimpan kejadian + memutakhirkan/membuat grup by fingerprint.
- **AC-2** — IF DSN hilang/salah/revoked, THEN THE server SHALL menolak (401 generik) tanpa membocorkan project.
- **AC-3** — THE server SHALL menyediakan generate/rotate/revoke DSN per project (`/api/projects/:id/ingest-key`), plaintext ditampilkan sekali.
- **AC-4** — WHEN grup **baru** muncul untuk `environment` production, THE server SHALL membuat satu `Notification` type `error` (dedup `key`).
- **AC-5** — WHEN operator mengeskalasi grup, THE server SHALL membuat `Spec` qa prefilled + menandai grup escalated + tautan dua arah; eskalasi kedua tak membuat Spec dobel.
- **AC-6** — THE endpoint ingest SHALL dibatasi rate-limit per project + caps payload; kelebihan → 429/413 tanpa memengaruhi project lain.
- **AC-7** — THE query error SHALL selalu ber-scope `projectId` (isolasi antar-project); `ingestKeyHash` tak pernah ke client.
