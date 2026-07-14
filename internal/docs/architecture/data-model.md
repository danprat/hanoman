# Data model

Entitas inti (Postgres via Prisma). **Tujuh model**: Project, Spec, Setting, Notification, User,
Session, Vps. Tidak ada model `Run` maupun `Trigger` — keduanya di-drop saat pindah ke sesi
interaktif (ADR-0024; migrasi `drop_run_trigger_github`). Enum stage/source/priority disimpan sebagai
`String` dan divalidasi zod di `@hanoman/shared` (`enums.ts`), bukan enum Prisma.

## Project
- `id` (slug) — **kekal**. Kunci asing `Spec` (`onDelete: Cascade`); tidak ada endpoint rename.
- `name`, `desc` — label tampilan; dapat diubah lewat `PATCH /projects/:id` (SPEC-146) dan boleh
  menyimpang dari `id`. Tak ada jalur git/worktree/filesystem yang membacanya.
- `kind` ("from-scratch" | "existing"), `repoDir?` (absolut; sumber worktree & docs), `stack` (default "")
- `createdAt`
- `docStatus` ("ok" | "drift" | "broken") + `coverage` (0–100) **bukan kolom** — diturunkan dari disk tiap `toProjectView` (ADR-0018).

## Spec (backlog item)
- `id` (SPEC-n), `projectId`, `title`, `source` ("brief" | "qa")
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
- `model` (default `claude-opus-4-8`) + `effort` (default `xhigh`) — **satu** model/effort per sesi,
  dipakai sebagai argv saat sesi lahir; manusia tetap bisa `/model` di dalam terminal. `steps` (model
  per fase), `maxConcurrent`, dan `askTimeoutMin` **hilang** bersama runner headless (ADR-0024) — tak
  ada `dailyBudget`.
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
- `id` (cuid), `type` (`done|decision`, default `done`).
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

## Docs (Source of Truth) — TIDAK dipersist
Docs bukan entitas DB. Tabel `DocFile` sudah di-drop (ADR-0011). Docs dibaca **live dari
`Project.repoDir`**: korpus = semua `**/*.md` via `git ls-files`, dikelompokkan per direktori,
`linked` = reachable dari root index (`internal/docs/README.md`) lewat graf link Markdown.
- coverage = % direktori (berskor, di bawah `docsDir`) yang seluruh Markdown-nya reachable dari index.
  **Tidak dipersist**: `toProjectView` menghitungnya dari `Project.repoDir` setiap kali project dibaca (ADR-0018).

## PRD (SPEC-210 · [ADR-0041](../adr/0041-prd-sebagai-dokumen-flow-project-level.md))
PRD **bukan entitas DB** — ia dokumen `docs/prd/<slug>.md` di repo project (konsisten ADR-0011).
Dibuat oleh **flow sesi `prd`** (project-level, tanpa `Spec`; pipeline `Brainstorm → PRD`), meniru
`reverse`: worktree isolasi, brainstorm interaktif, push ke branch `prd/<slug>`, manusia merge.
List/preview **freshest-wins** (worktree sesi `prd` hidup > `repoDir`). "Take ke backlog" membuat
`Spec` (source `brief`) ter-prefill dari PRD, `payload.prd` menaut path PRD. Set flow sesi kini:
`feature | qa | scaffold | reverse | prd`.

## Docs sebagai konvensi, bukan lagi gerbang
Fase Execute **tidak** lagi diverifikasi terhadap DocIndex sebelum jalan — guardrail Source of
Truth dicabut (SPEC-160/ADR-0023, supersedes ADR-0001). `internal/docs/**` tetap Source of Truth
secara konvensi; coverage/DocIndex tetap dihitung dan ditampilkan (di atas), hanya tidak lagi
memblokir apa pun.
