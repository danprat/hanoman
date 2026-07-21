# Data model

Entitas inti (Postgres via Prisma). **Tujuh model inti**: Project, Spec, Setting, Notification, User,
Session, Vps — plus model pendukung (VpsAuditSnapshot/VpsItemState, DeviceToken, SessionResult, SyncLog,
LocalBinding, SyncOutbox, SyncState, RuntimeConfig), **model error monitoring** (`ErrorGroup`,
`ErrorEvent`, SPEC-249/[ADR-0060](../adr/0060-error-monitoring-ingest-ber-dsn.md)) dan **model Help
Center** (`Ticket`, `TicketAttachment`, SPEC-253/[ADR-0062](../adr/0062-help-center-tiket-publik-triase.md)).
Tidak ada model `Run` maupun `Trigger` — keduanya di-drop saat pindah ke sesi interaktif (ADR-0024; migrasi
`drop_run_trigger_github`). Enum stage/source/priority/error-status/ticket-status/ticket-category disimpan
sebagai `String` dan divalidasi zod di `@hanoman/shared` (`enums.ts`), bukan enum Prisma.

## Project
- `id` (slug) — **renameable lewat operasi khusus** `POST /projects/:id/rename { newId }` (SPEC-255/ADR-0064,
  mencabut sebagian invariant "kekal" SPEC-146). Kunci asing `Spec`/`ErrorGroup`/`Ticket` **sudah**
  `ON UPDATE CASCADE` **dan** `ON DELETE CASCADE` (bawaan Prisma → cascade otomatis, tanpa migration); referensi
  longgar (`Notification/SessionResult/ErrorEvent/TicketAttachment`) + `LocalBinding` di-update manual dalam
  transaksi rename. Id **tetap tak tersentuh** oleh
  `PATCH`/`zUpdateProject`. Rename merambat ke hub sync (penanda `renamedFrom`) → DSN `/api/ingest/<id>` &
  URL Help `/help/<id>` (derived) ikut berganti. Guard: 409 bila id baru terpakai / ada sesi aktif.
- `name`, `desc` — label tampilan; dapat diubah lewat `PATCH /projects/:id` (SPEC-146) dan boleh
  menyimpang dari `id`. Tak ada jalur git/worktree/filesystem yang membacanya.
- `kind` ("from-scratch" | "existing"), `repoDir?` (absolut, OPSIONAL; path default/server, editable via
  `PATCH /projects/:id` — SPEC-217; **tak disync**), `stack` (default "")
- Untuk `kind: "from-scratch"` dengan `repoDir` diisi, `POST /projects` meng-`git init` direktori itu
  (+ commit awal) agar langsung runnable oleh sesi scaffold (SPEC-222/ADR-0052).
- **`LocalBinding`** (`projectId → repoDir`, per-mesin, **LOCAL-ONLY tak disync**): override path. `resolveRepoDir`
  = `binding ?? Project.repoDir` (null-safe), dipakai SELURUH jalur baca (spawn/IDE/coverage/branches/specs/docs).
  Editable via `PUT /projects/:id/binding`, dikosongkan via `DELETE` (SPEC-213/217).
- `createdAt`
- `ingestKeyHash?`/`ingestKeyPrefix?` (SPEC-249 · [ADR-0060](../adr/0060-error-monitoring-ingest-ber-dsn.md)) —
  kunci ingest error hash-at-rest (`sha256(key)`) + hint prefix untuk UI. `null` = monitoring off.
  **`ingestKeyHash` TAK PERNAH ke client/log**; `toProjectView` hanya mengekspos `monitoringEnabled`
  (`!!ingestKeyHash`) + `ingestKeyPrefix`.
- `helpEnabled` (Boolean, default false · SPEC-253 · [ADR-0062](../adr/0062-help-center-tiket-publik-triase.md)) —
  flag opt-in Help Center publik. Link publik `/help/<id>` menerima keluhan HANYA bila aktif. Additive;
  diekspos di `toProjectView` sebagai `helpEnabled`.
- `docStatus` ("ok" | "drift" | "broken") + `coverage` (0–100) **bukan kolom** — diturunkan dari disk tiap `toProjectView` (ADR-0018).

## Spec (backlog item)
- `id` (SPEC-n), `projectId`, `title`, `source` ("brief" | "qa" | "audit" | "help")
  - **`help`** (SPEC-253/[ADR-0062](../adr/0062-help-center-tiket-publik-triase.md)): backlog hasil
    promosi tiket Help Center. `flowForSource("help") = "feature"` (pipeline penuh), payload brief-shaped
    (context berisi keluhan + kategori + pelapor + backlink tiket). Author `Help ·`. Tanpa migration
    (source = String + zod, bukan enum Prisma).
  - **`audit`** (SPEC-237/[ADR-0057](../adr/0057-audit-only-source-flow.md)): audit-only. Flow `audit`
    (pipeline `Audit → Laporan`) hanya menghasilkan **dokumen audit** `internal/docs/research/audit-<spec-id>-<slug>.md`
    — TANPA perbaikan kode. Stage `done` dicapai lewat fase `Laporan` (`REACHED.Laporan="done"`); tak ada
    Plan/Execute, jadi gerbang ADR-0029 tak berlaku. Payload brief-shaped; author berawalan `Audit ·`. Bisa
    dinaikkan jadi Finding QA (source `qa`) lewat "Take ke backlog" (cermin PRD, ADR-0041). Tanpa migration
    (source/flow = String + zod, bukan enum Prisma).
- `stage` ("brainstorming" | "objective" | "spec-ready" | "planned" | "executing" | "done").
  Bergerak **maju** hanya lewat fase yang dilaporkan sesi (ADR-0008/0024), **mundur** hanya
  lewat aksi human eksplisit `PATCH /specs/:id { stage }` (backward-only, SPEC-167/ADR-0027).
  Mundur juga membersihkan artefak docs superpowers ber-spec-id fase di atas target
  (`docs/superpowers/specs/*` & `plans/*`); kode/commit Execute tak pernah dihapus.
  `executing` **tertahan** (tak jadi `done`) selama plan `docs/superpowers/plans/**` masih punya
  `- [ ]` (SPEC-173/ADR-0029, `planComplete`).
- `priority` ("tinggi" | "sedang" | "rendah"), `author`, `objective`
- `payload` (Json?) — brief (context/outcome/constraints) atau qa (severity/steps/expected/actual/env)
- `branchFrom?` — branch sumber worktree bagi sesi yang lahir dari item ini. `null` = default project
  (`main`). Divalidasi terhadap `refs/heads` repo project; lihat
  [ADR-0032](../adr/0032-branch-adalah-properti-backlog-item.md).
- `baseSha?`/`headSha?` — commit tempat worktree sesi di-detach, dan commit HEAD worktree di akhir sesi
  (sebelum `removeWorktree`). Penunjuk, bukan isi: diff/daftar-file review diturunkan dari git saat
  `GET /specs/:id/review` dibaca, tidak pernah dipersist. Lihat [ADR-0019](../adr/0019-sha-disimpan-diff-diturunkan.md) dan [ADR-0030](../adr/0030-spec-menyimpan-base-head-sha.md).

## Setting (per workspace)
Singleton `id = 1`, kolom `data` (Json) berbentuk `zSetting`:
- `model` (default `claude-opus-4-8`) + `effort` (default `xhigh`) — **default global** untuk sesi baru,
  dipakai sebagai argv saat sesi lahir. Sejak [ADR-0061](../adr/0061-model-effort-per-sesi-picker-start.md)
  (SPEC-252) model/effort dipilih **per SESI** saat Start (picker `StartSessionModal` → body opsional
  `model`/`effort` di `POST /terminal/sessions`); kosong → default global ini. Manusia tetap bisa
  `/model` di dalam terminal. `maxConcurrent` dan `askTimeoutMin` **hilang** bersama runner headless
  (ADR-0024) — tak ada `dailyBudget`.
- `phaseModels` **dicabut** (SPEC-252, [ADR-0061](../adr/0061-model-effort-per-sesi-picker-start.md),
  mengamandemen [ADR-0058](../adr/0058-model-effort-per-fase.md)): matrix model/effort **per fase** tak
  andal — ia bergantung agen mengetik `/model`+`/effort` di batas fase, padahal agen menembus batas fase
  tanpa berhenti. Model/effort kini **per sesi** (satu proses, satu model seumur hidup). Field dihapus
  dari skema `zSetting`; baris `Setting` lama yang masih memuatnya tetap parse (key asing diabaikan).
  Model/effort tetap `z.string()` (lenient); daftar pilihan valid (`MODELS`/`EFFORTS`, memuat
  `claude-fable-5` · `max` · `ultracode`) hidup di `@hanoman/shared` untuk picker Start.
- `autoDefault`, `autoScaffold`, `notifyFail`
- `notifyDone` (SPEC-180, default true) — toast+sound saat backlog selesai
- `notifySound` (SPEC-180, default `short`) — `off` atau salah satu nada; durasi/varian bunyi notifikasi

## User / Session (auth — SPEC-169, [ADR-0028](../adr/0028-auth-sesi-opaque-di-db.md))
- **User**: `id` (cuid), `email` (unique), `passwordHash` (`scrypt` "saltHex:hashHex"), `createdAt`.
  Tanpa RBAC — tak ada kolom role; semua user setara. `passwordHash` tak pernah keluar ke client
  (`UserView` = `{ id, email, createdAt }`).
- **Session**: `id` = **`sha256(token)`** (token opaque 256-bit hidup hanya di cookie `httpOnly`),
  `userId`, `createdAt`, `expiresAt`. `onDelete: Cascade` dari User. Revocable: logout menghapus
  baris; ganti password menghapus semua sesi user; hapus user meng-cascade sesinya. Sesi kedaluwarsa
  (`expiresAt < now`) diperlakukan tak valid dan dibersihkan saat di-lookup.

## Notification (SPEC-180/184, [ADR-0033](../adr/0033-notifikasi-backlog-selesai.md), [ADR-0036](../adr/0036-notifikasi-human-decision.md))
Dua tipe: `done` (backlog masuk `done`, dibuat di `advanceStage()` & write-through `GET /specs`)
dan `decision` (sesi Claude menunggu keputusan manusia, dibuat `scanDecisions()` di `GET /notifications`).
- `id` (cuid), `type` (`done|decision|drift|error|ticket`, default `done`; `error` SPEC-249, `ticket`
  SPEC-253 — grup error produksi baru / keluhan Help Center baru. Longgar String → tanpa migration kolom).
- `key` **@unique** nullable — dedup selesai `"done:<specId>"` (insert kedua kena P2002, diabaikan);
  `null` untuk decision (di-dedup di sisi scan via `Set` episode; NULL berulang diizinkan Postgres).
- `specId` (nullable — sesi reverse tak punya spec), `sessionId` (target redirect terminal),
  `title` (snapshot), `projectId` (opsional), `createdAt`.
- `readAt` (nullable) — `null` = belum dibaca. Read-state **global** (bukan per-user).
- Rute: `GET /notifications` (memicu `scanDecisions()`, lalu `{ items ≤50 terbaru dulu, unread }`),
  `POST /notifications/read` (tandai semua), `DELETE /notifications` (clear).

## Vps (SPEC-164, [ADR-0025](../adr/0025-modul-vps-script-deterministik.md))
VPS yang dikelola hanoman. `keyPath` menunjuk berkas private key **di mesin server** — isinya tak pernah
ada di database.
- `id` (cuid), `name`, `host`, `port` (default 22), `user`, `keyPath?`, `createdAt`
- `lastSeenAt?` (healthcheck sukses terakhir), `health?` (Json `{ uptime, disk, mem, load }`)
- `lastAuditAt?`, `audit?` (Json `VpsCheck[]` — `[{ check, status, detail }]`)
- `hardened` (default false) — derived: semua check kritis pass pada audit terakhir

### VpsAuditSnapshot / VpsItemState (SPEC-220 · [ADR-0050](../adr/0050-vps-compliance-katalog-scoring.md))
Kerangka kepatuhan checklist 232 item (katalog di git, lihat [vps-compliance.md](vps-compliance.md)).
- **`VpsAuditSnapshot`** — hasil satu audit kepatuhan (**append-only**, sumber diff drift):
  `id`, `vpsId`→Vps (cascade), `createdAt`, `results` (Json `{ [itemId]: { status, detail } }`),
  `scoreTotal` (Float 0..100), `scoreBySection` (Json `{ [section]: number }`),
  `detected?` (Json `{ [section]: { present, detail } }` — deteksi stack app-layer advisory, SPEC-221).
  Index `(vpsId, createdAt)`.
- **`VpsItemState`** — keputusan human durable per item: `na`/`naReason` (keluar denominator skor),
  `attested`/`attestNote` (item `INFO`), `actorEmail` (jejak pelaku dari sesi auth), `updatedAt`.
  Unik `(vpsId, itemId)`, `vpsId`→Vps (cascade).

## ErrorGroup / ErrorEvent (SPEC-249 · [ADR-0060](../adr/0060-error-monitoring-ingest-ber-dsn.md))
Error monitoring (Sentry ringan). **Server-local** — seperti `Notification`, **tanpa** `version`/sync
(volume tinggi, satu workspace). Enum `status` = `String` + zod (`zErrorStatus`), bukan enum Prisma.
- **`ErrorGroup`** — grup error per project (dedup by fingerprint):
  `id`, `projectId`→Project (cascade), `fingerprint`, `type`, `message`, `sampleStack?`, `environment`
  (last-seen), `status` (`new`|`escalated`|`resolved`, default `new`), `count`, `firstSeenAt`,
  `lastSeenAt`, `specId?` (tautan Spec hasil eskalasi), `createdAt`, `updatedAt`.
  Unik `(projectId, fingerprint)`; index `(projectId, lastSeenAt)`. Fingerprint deterministik dari
  tipe + pesan ternormalisasi + frame stack teratas (`services/error-fingerprint.ts`).
- **`ErrorEvent`** — kejadian error mentah, **dipangkas retensi** (cap terakhir per grup + umur,
  opportunistic-on-write, tanpa scheduler baru): `id`, `groupId`→ErrorGroup (cascade), `projectId`
  (denormal, isolasi & query murah), `type`, `message`, `stack?`, `environment`, `release?`,
  `context? (Json)`, `receivedAt`. Index `(groupId, receivedAt)` + `(projectId, receivedAt)`.
- Ingest publik `POST /api/ingest/:slug` diotorisasi **DSN** (`Project.ingestKeyHash`) — pengecualian
  sah gate `/api` (ADR-0060). Grup produksi **baru** → `Notification` type `error`. Eskalasi →
  `Spec` source qa (`fromErrorGroup`). Rate-limit token-bucket in-memory + caps payload.

## Ticket / TicketAttachment (SPEC-253 · [ADR-0062](../adr/0062-help-center-tiket-publik-triase.md))
Help Center: keluhan pengguna akhir → antrean triase → promosi ke backlog. **Server-local** — seperti
`ErrorGroup`, **tanpa** `version`/sync (volume rendah, satu workspace); tautan ke `Spec` (tersync)
satu-arah soft-link. `status`/`category` = `String` + zod (`zTicketStatus`/`zTicketCategory`), bukan enum Prisma.
- **`Ticket`** — tiket keluhan per project: `id` (cuid), `projectId`→Project (cascade), `number` (nomor
  pendek human-readable per project), `category` (`bug|fitur|pertanyaan|lainnya`), `title`, `detail`,
  `reporterEmail`, `status` (`new`|`accepted`|`rejected`, default `new`), `accessKeyHash` (**@unique**,
  `sha256(kunci opaque)` untuk cek status — plaintext hanya sekali; **TAK PERNAH ke client/log**),
  `specId?` (tautan Spec hasil promosi), `createdAt`, `updatedAt`. Unik `(projectId, number)`; index
  `(projectId, createdAt)`. Nomor dihitung `max+1` per project (retry P2002, cermin `nextSpecId`).
- **`TicketAttachment`** — lampiran gambar: `id`, `ticketId`→Ticket (cascade), `projectId` (denormal,
  isolasi), `filename` (display), `mimeType`, `size`, `storageKey` (nama opaque `uuid+ext` di
  `HANOMAN_UPLOAD_DIR` — server-local, **di luar repoDir, tak disync**), `createdAt`. Index `(ticketId)`.
- Submit publik `POST /api/help/:slug/tickets` (multipart) diotorisasi **`Project.helpEnabled`**; cek status
  `GET /api/help/:slug/tickets/:key` diotorisasi **kunci opaque** — pengecualian sah gate `/api` (ADR-0062).
  Tiket baru → `Notification` type `ticket`. Promosi (`POST /tickets/:id/accept`) → `Spec` source `help`
  (payload brief-shaped + backlink). Status publik **diturunkan** (`publicStatus`) dari status tiket +
  `stage` Spec. Rate-limit token-bucket in-memory (per IP & per project) + honeypot + retensi opportunistic.

## Docs (Source of Truth) — TIDAK dipersist
Docs bukan entitas DB. Tabel `DocFile` sudah di-drop (ADR-0011). Docs dibaca **live dari path
efektif** (`resolveRepoDir` = binding per-mesin ?? `Project.repoDir` — SPEC-217): korpus = semua
`**/*.md` via `git ls-files`, dikelompokkan per direktori, `linked` = reachable dari root index
(`internal/docs/README.md`) lewat graf link Markdown.
- coverage = % direktori (berskor, di bawah `docsDir`) yang seluruh Markdown-nya reachable dari index.
  **Tidak dipersist**: `toProjectView` menghitungnya dari path efektif setiap kali project dibaca (ADR-0018).

## PRD (SPEC-210 · [ADR-0041](../adr/0041-prd-sebagai-dokumen-flow-project-level.md))
PRD **bukan entitas DB** — ia dokumen `docs/prd/<slug>.md` di repo project (konsisten ADR-0011).
Dibuat oleh **flow sesi `prd`** (project-level, tanpa `Spec`; pipeline `Brainstorm → PRD`), meniru
`reverse`: worktree isolasi, brainstorm interaktif, push ke branch `prd/<slug>`, manusia merge.
List/preview **freshest-wins** (worktree sesi `prd` hidup > `repoDir`). "Take ke backlog" membuat
`Spec` (source `brief`) ter-prefill dari PRD; tautan balik dibawa teks Konteks brief ("Dari PRD: <path>"),
bukan field payload (zBriefPayload strip key tak dikenal). Set flow sesi kini:
`feature | qa | scaffold | reverse | prd | audit` (audit = SPEC-237/ADR-0057). Sesi shell "terminal
biasa" (SPEC-236/ADR-0056) **tanpa flow** — bukan pipeline, tak menggerakkan stage; ditandai wire
`{project, shell:true}`.

## Docs sebagai konvensi, bukan lagi gerbang
Fase Execute **tidak** lagi diverifikasi terhadap DocIndex sebelum jalan — guardrail Source of
Truth dicabut (SPEC-160/ADR-0023, supersedes ADR-0001). `internal/docs/**` tetap Source of Truth
secara konvensi; coverage/DocIndex tetap dihitung dan ditampilkan (di atas), hanya tidak lagi
memblokir apa pun.
