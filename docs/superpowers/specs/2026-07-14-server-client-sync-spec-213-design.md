# Design — Server & Client Side: Hub Data Pusat + Instance Lokal Sinkron (SPEC-213)

> Sumber: `docs/prd/server-and-client-side.md` (PRD). Scope keputusan pengguna: **seluruh PRD**, didekomposisi jadi fase implementasi berurutan dalam satu plan.
> Deliverable ini = design/spec teknis yang menjawab OQ-1..OQ-8 PRD dan menjadi kontrak untuk plan + execute.

## Ringkasan arsitektur

Satu codebase, dua **peran** yang ditentukan konfigurasi — bukan dua binari:

- **Hub (server):** instance hanoman tanpa `SYNC_SERVER_URL`. Menyimpan seluruh data agregat, menerima push, melayani pull, menyiarkan perubahan via WS sync. Tetap punya SELURUH fitur lama (termasuk spawn Claude Code bila punya checkout lokal sendiri).
- **Client (instance lokal):** instance hanoman dengan `SYNC_SERVER_URL` di-set + memegang **device token**. Instance lokal penuh: browser developer bicara **same-origin ke instance lokalnya sendiri** (cookie seperti hari ini), dan **proses Node lokal** yang menyinkronkan (server-to-server) ke hub.

**Keputusan arsitektur inti (menjawab OQ-4 & OQ-7):** Sync adalah **server-to-server** antara proses Node instance lokal dan hub, diautentikasi **`Authorization: Bearer <device-token>`**. Browser tak pernah bicara lintas-origin — sehingga tak ada masalah CORS/cookie. Base URL hub jadi **setting sisi-server** (`SYNC_SERVER_URL`), bukan konfigurasi frontend.

**Konten dokumen mengalir lewat git (menjawab AC-14):** Isi file PRD/dokumen (git-tracked) TIDAK dikirim lewat sync API. Ia mengalir lewat **git remote** (client push commit → hub pull), memakai **git 3-way merge** yang sudah ada. Sync API hanya mengurus **record**: Project (metadata), Spec, Vps, dan SessionResult. Ini menjaga "record-level optimistic concurrency + git merge, tanpa custom line-merge engine".

## Keputusan atas Open Questions PRD

| OQ | Keputusan | Konsekuensi |
|---|---|---|
| **OQ-1 migrasi** | Additive murni: kolom/model baru dengan default aman; prod single-host sekarang = hub tanpa client. Client opt-in dengan set `SYNC_SERVER_URL` + tempel device token. Backward-compatible; tak ada breaking change. | Rollout dijelaskan di `operations/production.md`. |
| **OQ-2 pairing** | Semua user setara boleh menerbitkan token (konsisten no-RBAC hari ini). Token pertama diterbitkan dari UI hub oleh user login. Ditampilkan **sekali**. | Cukup untuk satu-workspace saling-percaya (PRD non-goal: RBAC). |
| **OQ-3 kanal WS** | **Kanal WS baru terpisah** `/api/sync/ws`, diautentikasi per **device token** pada upgrade (bukan cookie). `/api/events/ws` (ADR-0039) tetap read-only same-origin untuk dashboard lokal. | Otorisasi WS per-token bersih; tak mencampur siar lokal dengan sync antar-mesin. |
| **OQ-4 base URL** | Setting sisi-server `SYNC_SERVER_URL` (REST + WS absolut). Frontend tetap same-origin. | Tak menyentuh CORS/cookie di browser. |
| **OQ-5 ringkasan hasil** | Whitelist final: `specId, projectId, oldStage, newStage, commitSha, branch, prUrl, status, deviceId, author, createdAt`. Notifikasi lokal TIDAK ikut. | Model `SessionResult` (bawah). |
| **OQ-6 identitas record** | ID record **client-generated** (cuid/ulid — Project/Spec sudah string id). Server dedup by primary key (upsert). Push tanpa-id-cocok = insert; id cocok + baseVersion cocok = update. | Menjamin AC-15 (no dup, no lost update). |
| **OQ-7 keamanan transport** | TLS via reverse proxy (ADR-0028). Device token: hash-at-rest, tampil sekali, revocable, `lastSeenAt`. Rate-limit pada endpoint sync. | Aman dari internet publik. |
| **OQ-8 penyimpanan ringkasan** | **Model Prisma baru** `SessionResult` (append-only) + migration + ADR. Bukan perluasan model lama. | Purge manual scoped project/tanggal. |

## Perubahan data model (tiap perubahan skema → migration + ADR)

Model/kolom baru (semua additive, default aman):

1. **`DeviceToken`** (baru): `id, userId, name, tokenHash (unique), createdAt, lastSeenAt?, revokedAt?`. Auth mesin. `user` relation → atribusi author.
2. **`SessionResult`** (baru, append-only): `id, projectId, specId?, oldStage?, newStage?, commitSha?, branch?, prUrl?, status, deviceId, author, createdAt`. Activity log.
3. **`Project.gitRemote`** (kolom baru `String?`): git remote resmi untuk clone di client. `repoDir` tetap ada TAPI **local-only, tak pernah disync** (AC-7).
4. **Version-stamp** entitas tersync: kolom `version Int @default(0)` + `updatedAt DateTime` pada `Project`, `Spec`, `Vps`, `SessionResult`. `version` naik tiap accepted write; `baseVersion` mismatch → 409 stale.
5. **Local-only map `LocalBinding`** (baru, di instance lokal; TIDAK disync): `projectId (pk), repoDir`. Menyimpan `projectId → repoDir` per-device. Karena satu codebase, model ini ada di skema tapi ditandai never-synced (whitelist sync mengecualikannya).

Entitas **tak disync**: `Setting`, `Notification`, `User`, `Session`, `DeviceToken`, `LocalBinding` (AC-30, AC-7).

## Kontrak API baru

- `POST /api/device-tokens` → `{ id, name, token }` (token plaintext **sekali**). `GET /api/device-tokens` → list (tanpa token). `DELETE /api/device-tokens/:id` → revoke (set `revokedAt`).
- `GET /api/sync/pull?since=<cursor>` (Bearer) → `{ cursor, records: {project[], spec[], vps[], sessionResult[]} }` sejak cursor. Server-authoritative.
- `POST /api/sync/push` (Bearer) → body `{ records: [{ entity, id, baseVersion, data }] }`. Tiap record: baseVersion cocok → accept + `version++`; stale → tolak record itu dengan `{ conflict: true, server: <current> }` untuk diff/pull-rebase. Insert (id baru) selalu accept. Idempoten by id.
- `GET /api/sync/ws` (Bearer via query/header pada upgrade) → hub siarkan `{ entity, id, version, data }` tiap accepted write ke client terhubung.
- `POST /api/session-results` (Bearer, dari client) → push ringkasan (whitelist). `GET /api/session-results?projectId=&…` → baca. `DELETE /api/session-results?projectId=&before=` → purge manual.

Auth sync surface: middleware `requireDeviceToken` — hash header token, cari `DeviceToken` non-revoked, set `req.device = { id, userId }`; else 401.

## Dekomposisi fase (urut; tiap fase = grup task di plan)

- **Fase 0 — ADR & migrasi fondasi.** ADR: (0043) arsitektur sync & peran hub/local + server-to-server + base URL; (0044) device token machine identity; (0045) skema sync (DeviceToken, SessionResult, gitRemote, version-stamp, LocalBinding); (0046) kanal WS sync; (0047) activity log & purge. Tulis migration SQL tangan + `migrate deploy` per DB (catatan memori: worktree drift).
- **Fase 1 — Identitas mesin (device token).** Model+migration, service (hash/issue/verify/revoke), routes issue-once/list/revoke, middleware `requireDeviceToken`, UI kelola token. AC-1..AC-4.
- **Fase 2 — Project tanpa path + gitRemote + binding lokal.** Kolom `gitRemote`; longgarkan guard `repoDir` agar hub simpan & list project murni-metadata; `LocalBinding` store + flow bind folder existing / clone dari gitRemote; guard spawn minta bind dulu. AC-5..AC-8.
- **Fase 3 — Sync engine core (version-stamp + pull/push).** Kolom `version/updatedAt`; service delta + cursor; `GET /sync/pull` & `POST /sync/push`; optimistic concurrency + 409 stale + diff; upsert/dedup by id; atribusi author dari device token. AC-9..AC-15.
- **Fase 4 — Realtime + offline.** Kanal `GET /sync/ws` token-authed; hub siar accepted write; client **outbox** (antre write lokal) + kursor last-pull; drain saat reconnect (pull-before-push); tahan WS drop. AC-16..AC-19.
- **Fase 5 — Activity log (ringkasan hasil).** Model `SessionResult`; client push ringkasan saat stage change/commit/PR (whitelist, tanpa PTY/kredensial); simpan append-only; purge manual scoped project/tanggal; UI lihat aktivitas. AC-20..AC-22.
- **Fase 6 — VPS sync + gating key.** Vps ikut entitas tersync (config/audit/health/hardened); jangan pernah sync `keyPath`/isi key; gate aksi SSH pada key ada di mesin lokal + pesan jelas. AC-26..AC-29.
- **Fase 7 — Preferensi lokal & parity.** Pastikan `Setting`/`Notification` dikecualikan sync (AC-30); parity: suite existing hijau di kedua peran, 0 endpoint hilang (AC-23..AC-25).

## Strategi test

- Unit: service sync (delta, version bump, stale reject), device-token (hash/verify/revoke), whitelist ringkasan (assert tak ada field non-whitelist), gating key VPS.
- Integrasi (Fastify inject): device-token routes, `sync/pull|push` (accept, stale 409 + diff, dedup idempoten), session-results (append + purge), guard repoDir/bind.
- Realtime/offline: dua "instance" in-proc (hub + client) — client offline queue → reconnect drain → hub state konsisten, no lost update.
- Parity: seluruh suite lama tetap hijau; snapshot daftar endpoint baseline vs sesudah (0 hilang).
- Per task execute: boot server lokal + curl endpoint tersentuh (CLAUDE.md), bukan hanya unit test.

## Non-goals (dari PRD, ditegaskan)

Bukan multi-tenant/RBAC; bukan sentralisasi eksekusi/kredensial Anthropic; bukan sync transkrip PTY/settings/notifikasi; bukan custom line-merge; tak menghidupkan queue/scheduler/webhook.
