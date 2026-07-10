# Data model

Entitas inti (Postgres via Prisma).

## Project
- `id` (slug) — **kekal**. Kunci asing `Spec`/`Run`/`Trigger`; tidak ada endpoint rename.
- `name`, `desc` — label tampilan; dapat diubah lewat `PATCH /projects/:id` (SPEC-146) dan boleh
  menyimpang dari `id`. Tak ada jalur git/worktree/filesystem yang membacanya.
- `kind` ("from-scratch" | "existing"), `repoDir`/`repoUrl`
- `createdAt`
- `docStatus` ("ok" | "drift" | "broken") + `coverage` (0–100) **bukan kolom** — diturunkan dari disk tiap `toProjectView` (ADR-0018).

## Spec (backlog item)
- `id` (SPEC-n), `projectId`, `title`, `source` ("brief" | "qa")
- `stage` ("brainstorming" | "objective" | "spec-ready" | "planned" | "executing" | "done").
  Bergerak **maju** hanya lewat fase yang dilaporkan agen (ADR-0008/0024), **mundur** hanya
  lewat aksi human eksplisit `PATCH /specs/:id { stage }` (backward-only, SPEC-167/ADR-0027).
  Mundur juga membersihkan artefak docs superpowers ber-spec-id fase di atas target
  (`docs/superpowers/specs/*` & `plans/*`); kode/commit Execute tak pernah dihapus.
- `priority` ("tinggi" | "sedang" | "rendah"), `author`, `objective`
- payload brief (context/outcome/constraints) atau qa (severity/steps/expected/actual/env)
- `branchFrom?` — branch sumber worktree bagi run yang lahir dari item ini. `null` = default project
  (`main`). Divalidasi terhadap `refs/heads` repo project; lihat
  [ADR-0018](../adr/0018-branch-adalah-properti-backlog-item.md).

## Run
- `id` (RUN-n), `projectId`, `specId?`, `kind` ("feature" | "qa" | "scaffold")
- `status` ("queued" | "running" | "awaiting" | "paused" | "stopped" | "failed" | "done").
  `awaiting` ≠ `paused`: `paused` berarti proses claude sudah mati dan sesi dilanjutkan dari
  `sessionId`; `awaiting` berarti prosesnya hidup dan terblokir menunggu keputusan manusia (SPEC-157).
- `trigger` ("commit"|"schedule"|"manual"|"interval"), `triggerDetail`
- `phases[]` ({ name, state: "pending"|"active"|"done"|"failed"|"skipped" }), `plan[]`, `log[]`
- `worktree`, `branchFrom`, `branchTo`, `model` per step, `tokensIn/out`, `cost`, `progress`
- `commitSha?` — commit **pemicu** dari webhook (untuk melapor status GitHub), bukan commit yang
  dihasilkan run itu sendiri.
- `baseSha?`/`headSha?` — commit tempat worktree run di-detach, dan commit tip setelah
  `commitAndPush` berhasil. Penunjuk, bukan isi: diff/daftar-file/commit run diturunkan dari git
  saat `GET /runs/:id/changes` dibaca, tidak pernah dipersist. Lihat [ADR-0019](../adr/0019-sha-disimpan-diff-diturunkan.md).
- `pendingAsk?` — pertanyaan agen yang sedang menunggu jawaban manusia (`{ question, options[], default }`),
  atau NULL. Hanya terisi selama status `awaiting`. Lihat [ADR-0022](../adr/0022-pertanyaan-agen-berstatus-awaiting.md).
- `createdAt`, `finishedAt?` (null selama berjalan; di-set saat status terminal — durasi = `(finishedAt ?? now) − createdAt`, lihat ADR 0007)
- Run dengan `specId` = run untuk satu backlog item. Worker memuat Spec itu dari DB saat run dieksekusi dan menyisipkan `title`/`objective`/`payload` ke prompt **setiap fase** (termasuk Execute) — id saja tidak resolvable dari dalam worktree. Spec-nya hilang → job gagal, bukan jalan tanpa scope.
- `phases[]` di-seed dari pipeline flow saat enqueue (semua `pending`), lalu tiap event membalik state di tempat (`active`/`done`/`failed`/`skipped`); `progress` = persen phase ber-state `done` **di antara phase yang tidak `skipped`** (run yang mati di fase akhir tampil mis. 80%, bukan 0%). `skipped` = fase yang sengaja tidak dijalankan run (alur `qa`, SPEC-145); ia keluar dari penyebut, sehingga run jalur cepat yang sukses tetap 100%. Lihat SPEC-010, SPEC-145.
- Status terminal hanya ditulis oleh worker yang hidup (`persistEvent` saat `status`, atau `markFailed` dari `on("failed")`/`on("stalled")`). Worker mati — atau Redis di-restart — di tengah run: job-nya lenyap dan barisnya tersangkut `running` selamanya. Karena itu `reconcileRuns()` jalan saat worker boot: tiap run `queued`/`running`/`awaiting` yang tidak lagi punya job di queue (`jobId = runId`) ditandai `failed` + `finishedAt`. `paused` sengaja dikecualikan — prosesnya memang sudah mati dan job-nya memang sudah tak ada.

## Trigger
- `id`, `projectId`, `type`, `detail`, `target` ("plan + execute" | "audit" | "scaffold docs"), `enabled`

## Docs (Source of Truth) — TIDAK dipersist
Docs bukan entitas DB. Tabel `DocFile` sudah di-drop (ADR-0011). Docs dibaca **live dari
`Project.repoDir`**: korpus = semua `**/*.md` via `git ls-files`, dikelompokkan per direktori,
`linked` = reachable dari root index (`internal/docs/README.md` → `README.md`) lewat graf link Markdown.
- coverage = % direktori yang seluruh Markdown-nya reachable dari index. **Tidak dipersist**: `toProjectView` menghitungnya dari `Project.repoDir` setiap kali project dibaca (ADR-0018).

## Settings (per workspace)
- `steps`: { brainstorm|spec|plan|execute|audit: { model, effort } } (default opus/x-high)
- `autoDefault`, `autoScaffold`, `maxConcurrent`, `dailyBudget`, `notifyFail`

## Docs sebagai konvensi, bukan lagi gerbang
`Run` tidak lagi diverifikasi terhadap DocIndex sebelum masuk fase execute — guardrail Source of
Truth dicabut (SPEC-160/ADR-0023, supersedes ADR-0001). `internal/docs/**` tetap Source of Truth
secara konvensi; coverage/DocIndex tetap dihitung dan ditampilkan (di bawah), hanya tidak lagi
memblokir run.
