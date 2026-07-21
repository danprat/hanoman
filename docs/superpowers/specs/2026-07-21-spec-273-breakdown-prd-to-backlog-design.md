# SPEC-273 · Breakdown PRD → backlog (paralel-independen)

**Tanggal:** 2026-07-21
**ADR terkait:** ADR-0069 (baru) · memperluas ADR-0041 (PRD sebagai dokumen) · terkait ADR-0015 (satu backlog satu sesi) · ADR-0002 (isolasi worktree) · ADR-0032 (branch properti backlog) · ADR-0059 (kontinuitas branch take-to-backlog)
**Status:** Design disetujui (mekanisme dipilih user), menunggu rencana implementasi

## Masalah

Alur "Take ke backlog" saat ini membuat **tepat satu** `Spec` dari sebuah PRD (`PrdScreen` → `App.takeToBacklog` → `createSpec`, prefill satu title/context/outcome). Untuk PRD yang **kompleks**, satu backlog tak cukup: pekerjaannya terlalu besar untuk dituntaskan dalam satu sesi, sehingga sebagian isi PRD tak pernah dikerjakan.

Yang dibutuhkan: **memecah 1 PRD kompleks menjadi N backlog yang lebih kecil, terukur, dan _parallel-safe_ (tanpa saling dependency)** sehingga semua isi PRD tercakup dan bisa dikerjakan bersamaan.

## Observasi kunci

- **Paralelisme eksekusi sudah beres.** hanoman menjalankan **satu backlog = satu sesi di worktree terisolasi** (ADR-0002/0015). Begitu N spec independen ada, mereka sudah jalan paralel tanpa konflik. Jadi fitur ini **bukan** soal menjalankan paralel — melainkan soal **dekomposisi**: 1 PRD → N spec independen.
- **Dekomposisi butuh kecerdasan**, dan di hanoman semua kerja cerdas berjalan sebagai **sesi `claude` interaktif** — tak ada jalur headless/SDK (ADR-0010/0024). Maka dekomposisi harus lahir dari sesi, bukan panggilan LLM sisi server.
- **Tanpa perubahan skema.** Backlog hasil breakdown adalah baris `Spec` biasa; `POST /specs` sudah ada, id via `nextSpecId` (max+1, TOCTOU-guarded). Provenance PRD dicantumkan di teks Konteks (mengikuti konvensi take-to-backlog yang ada), bukan kolom baru.

## Mekanisme yang dipilih

**Sesi breakdown → manifest doc → materialize batch (human-reviewed).** Tiga tahap:

### Tahap 1 — Sesi breakdown (flow baru `breakdown`)

Sesi `claude` project-level, dimulai dari sebuah PRD terpilih (mirip flow `prd`/`scaffold`). **Isi PRD disematkan langsung ke prompt** (server membaca PRD freshest-wins lalu embed) — ini melepaskan breakdown dari status merge PRD (tak perlu PRD sudah ter-merge ke default branch).

Sesi mendekomposisi PRD menjadi N backlog yang:
- **kecil & terukur** — tiap item satu unit kerja yang bisa dituntaskan satu sesi;
- **non-overlapping** — cakupan tak tumpang tindih;
- **tanpa cross-dependency** — bisa dikerjakan bersamaan, urutan bebas;
- **menutup seluruh PRD** — gabungan semua item mencakup semua scope in-PRD.

Keluaran = **manifest** `docs/prd/<slug>.breakdown.md` (slug diturunkan dari path PRD), berisi:
- **prosa human-readable** — ringkasan, daftar backlog + rasional parallel-safety per item;
- **satu blok ```json kanonik** (kontrak mesin): `{ "items": [ { "title", "context", "outcome", "priority" }, ... ] }`.

Pipeline: `["Analisis", "Breakdown"]`. **Autonomous** (bukan interaktif seperti brainstorm PRD) — ini tugas analisis, jadi memakai AUTONOMY_CLAUSE. Worktree isolasi dari `HEAD`, push ke `breakdown/<slug>`; manusia me-review lalu merge (pola prd/reverse). Bila remote origin absen, lewati push & catat di terminal (jangan gagal diam).

### Tahap 2 — Parse + expose (server)

Service baru `project-breakdowns.ts` mem-parse manifest **freshest-wins** (cwd sesi breakdown hidup untuk project ini > repoDir), meniru `project-prds.ts::resolveDir`. Ambil blok ```json pertama dalam `.breakdown.md`, zod-validasi jadi `BreakdownItem[]`.

Endpoint: `GET /api/projects/:id/breakdown?prd=<path>` → `{ items: BreakdownItem[], live: boolean }`. Manifest belum ada / json rusak → `{ items: [], live }` (bukan 500).

### Tahap 3 — Materialize batch (human-reviewed)

`PrdScreen` (pane preview PRD) menampilkan usulan backlog: tiap baris punya **toggle include**, **title yang bisa diedit**, preview context/outcome, dan **priority**; plus **picker branchFrom** (default = default project). Tombol **"Buat N backlog"** → `POST /api/specs/batch`.

`POST /api/specs/batch` body `{ project, items: [{title, context, outcome, priority}], branchFrom?, prdPath? }` → membuat N spec berurutan (reuse `nextSpecId` + retry P2002), tiap spec `source:"brief"`, Konteks di-prefix `Dari PRD (breakdown): <prdPath>` (provenance, tanpa kolom baru), lalu `enqueueOutbox("spec", id)` per item (sinkron ke hub, pola POST /specs). Respons `{ created: Spec[] }`.

> **Human terakhir memutuskan** (aturan produk): usulan breakdown TIDAK auto-jadi backlog — manusia meninjau/menyunting/menyeleksi dulu, baru materialize.

## Jaminan parallel-safety

Terjamin **by construction**, bukan runtime:
1. Prompt breakdown mewajibkan cakupan non-overlapping + eksplisit "tanpa cross-dependency", dengan rasional per item di prosa manifest agar bisa disanity-check manusia.
2. Semua N spec di-branch dari **basis yang sama** (default project branch, atau pilihan human), jadi tiap sesi lahir di worktree terpisah dari titik yang sama — tak ada shared state antar mereka (ADR-0002/0015 menanggung sisanya).

## Perubahan API

| Endpoint | Perubahan |
|---|---|
| `POST /api/terminal/sessions` | + varian union `{ project, flow: "breakdown", prdPath }` |
| `GET /api/projects/:id/breakdown?prd=<path>` | baru — parse manifest, `{ items, live }` |
| `POST /api/specs/batch` | baru — buat N spec dari items, provenance PRD di Konteks |

## Perubahan shared

- `zFlow` += `"breakdown"`; runner `Flow` += `"breakdown"`.
- `zBreakdownItem = { title, context, outcome, priority }`; `zBreakdownDoc = { items, live }`.
- `zBatchCreateSpec = { project, items: zBreakdownItem[], branchFrom?, prdPath? }`.
- union `zTerminalSession` += varian breakdown.

## Perubahan runner

- `PIPELINES.breakdown = ["Analisis", "Breakdown"]`.
- `startBreakdownPrompt(project, prd, branchTo)` — prompt: baca PRD (tersemat), dekomposisi ke N backlog independen/parallel-safe/kecil/menutup-seluruh-PRD; tulis `docs/prd/<slug>.breakdown.md` (prosa + satu blok ```json kanonik dengan kontrak persis); commit; push `breakdown/<slug>`; AUTONOMY_CLAUSE.

## Perubahan server

- `routes/terminal.ts` — cabang `flow === "breakdown"`: baca isi PRD (freshest-wins `readPrd`), slug dari `prdPath`, worktree dari `HEAD`, sesi flow `breakdown` branch `breakdown/<slug>`, prompt `startBreakdownPrompt`. 400 bila prdPath kosong/PRD tak terbaca.
- `services/project-breakdowns.ts` — `readBreakdown(projectId, prdPath)` freshest-wins + parse blok json + zod.
- `routes/docs.ts` (atau `projects.ts`) — `GET /projects/:id/breakdown`.
- `routes/specs.ts` — `POST /specs/batch` (loop `nextSpecId` retry; items kosong → 400; branch tak dikenal → 400; project tak ada → 404).

## Perubahan frontend

- `api/client.ts` — `startBreakdown(project, prdPath)`, `getBreakdown(project, prdPath)`, `createSpecsBatch(body)`.
- `screens/PrdScreen.tsx` — pane preview: tombol **"Breakdown ke backlog"**. Muat manifest untuk PRD terpilih; ada item → panel review "Usulan backlog (N)" (toggle/edit/priority + branchFrom picker + "Buat N backlog" → batch). Belum ada manifest → tombol "Mulai sesi breakdown" (start sesi). "Take ke backlog" (single) tetap ada untuk PRD sederhana.
- `App.tsx` — `startBreakdown`, `materializeBreakdown` (toast + pindah ke Backlog).

## Data model

**Tanpa migration.** Breakdown = dokumen (`docs/prd/<slug>.breakdown.md`) + baris `Spec` biasa. Additive & aman untuk VPS live.

## Rencana test (TDD)

- **runner**: `startBreakdownPrompt` memuat isi PRD, instruksi dekomposisi (independen/parallel-safe/menutup PRD), path manifest, kontrak ```json, push branch; `PIPELINES.breakdown`.
- **shared**: zod `zBreakdownItem` / `zBatchCreateSpec` (valid + reject).
- **server**: `project-breakdowns` parse (json fence valid; fence hilang → []; item invalid → tolak/skip); `GET /breakdown`; `POST /specs/batch` (buat N, id berurutan, provenance Konteks, branch invalid → 400, items kosong → 400, project tak ada → 404); cabang terminal breakdown (slug dari prdPath, 400 pada prd buruk) — **tanpa** benar-benar spawn claude.
- **Live curl lokal** (wajib per CLAUDE.md): boot server, `POST /specs/batch` + `GET /breakdown` terhadap manifest fixture di repo temp; **tidak** memicu sesi breakdown nyata (spawn claude) di test.

## Docs tersentuh (commit yang sama)

- ADR-0069 baru + link di `internal/docs/README.md`.
- `internal/docs/architecture/api-contract.md` — 3 endpoint.
- `internal/docs/architecture/data-model.md` — catatan breakdown = doc + specs, tanpa skema.
- `internal/docs/entrypoints/prd.md` (atau `requirements/prd.md`) — sebut breakdown di hulu backlog.
- Skill project bila menyentuh daftar flow.

## Non-goals

- Tak menjalankan/menjadwalkan N backlog otomatis — user menekan Start seperti biasa (paralelisme sudah ada).
- Tak ada kolom/tabel provenance PRD (pakai teks Konteks).
- Tak mengubah "Take ke backlog" single (tetap ada untuk PRD sederhana).
- Tak ada dependency graph antar-backlog (kontrak justru: NOL dependency).
