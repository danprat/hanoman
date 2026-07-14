# SPEC-210 — Create PRD (brief + brainstorm → dokumen PRD → backlog)

**Tanggal:** 2026-07-14 · **Prioritas:** tinggi · **Sumber:** brief

## Objective

hanoman bisa jadi tempat PM/PO menulis **brief**, ber-**brainstorm** dengan agen, lalu
menghasilkan **dokumen PRD** yang bisa (a) di-**preview untuk review**, dan (b) di-**take jadi
backlog item**. Ini menambah satu lapis *di hulu* backlog: setiap fitur terdokumentasi sebagai PRD
sebelum dipecah ke spec + plan.

Saat ini backlog item lahir langsung dari `brief`/`qa` — tak ada artefak PRD tingkat
product-management di antara ide dan breakdown.

## Konteks & temuan (kode yang sudah ada)

- **Backlog item = `Spec`** (`server/prisma/schema.prisma`): `source ∈ {brief, qa}`, `payload` JSON,
  lifecycle `brainstorming → … → done`. Dibuat via `POST /specs`. Brainstorm di sini adalah **fase
  di dalam eksekusi** backlog item — bukan artefak lepas.
- **Sesi = `claude` interaktif di git worktree**, digerakkan `flow` + pipeline fase
  (`runner/src/prompt.ts`). Flow yang ada: `feature`, `qa`, `scaffold`, `reverse`.
- **`reverse` = sesi project-level tanpa Spec** (`server/src/routes/terminal.ts` ~L103): worktree
  sendiri, prompt project-level (`startProjectPrompt`), punya fase **interaktif** ("Wawancara":
  satu pertanyaan per giliran ke manusia di terminal), push ke branch, **manusia yang merge**.
  Cleanup DELETE session sudah menangani sesi project-level (tanpa `specId` → tak menggerakkan stage,
  worktree tetap dibersihkan).
- **Docs = filesystem nyata, bukan DB** (ADR-0011). Preview markdown ter-render lewat `MarkdownView`
  (dipakai `SpecDocsModal`, `DocsWorkspace`). `GET /projects/:id/docs` + `/docs/*` baca dari `repoDir`.
  `listSpecDocs` (`spec-docs.ts`) memakai **freshest-wins**: worktree sesi hidup > `repoDir` (SPEC-170).
- **Nav** (`src/src/ds/shell.tsx` `HN_NAV`) top-level: Overview, Projects, Backlog, Terminal, IDE, VPS,
  Docs, Settings.

Kesimpulan: semua mesin yang dibutuhkan **sudah ada**. PRD paling pas dimodelkan sebagai **dokumen**
(bukan entitas DB), diproduksi oleh **flow sesi project-level baru** yang meniru `reverse`, di-preview
lewat `MarkdownView`, dan di-take ke backlog lewat `POST /specs` yang sudah ada.

## Keputusan desain

**PRD adalah dokumen `docs/prd/<slug>.md` di repo project — bukan tabel baru.** Konsisten ADR-0011.
Tak ada perubahan skema, tak ada migration.

### 1. Create PRD — flow sesi project-level `prd`

Flow baru `prd`, project-level (tanpa `Spec`), meniru `reverse`:

- `runner`: `Flow` += `"prd"`; `PIPELINES.prd = ["Brainstorm", "PRD"]`; `PHASE_SKILLS.Brainstorm`
  sudah → `superpowers:brainstorming` (reuse). Prompt baru `startPrdPrompt(project, brief, branchTo)`
  meniru `startProjectPrompt`: **brainstorm interaktif** dengan PM (satu pertanyaan per giliran,
  karena PM menonton terminal), lalu tulis PRD terstruktur ke `docs/prd/<slug>.md`, commit, push ke
  `prd/<slug>`. Brief awal (title/context/outcome/constraints) disisipkan ke prompt.
  Template PRD: Ringkasan · Masalah & konteks · Persona/pengguna · Goals & non-goals · Scope
  (in/out) · User stories · Acceptance criteria (EARS) · Metrik sukses · Open questions.
- `server`: `zFlow` += `"prd"`; `zTerminalSession` union += `{ project, flow: "prd", brief }`
  (`zPrdBrief = { title, context, outcome, constraints? }`). `terminal.ts` cabang `flow === "prd"`
  meniru cabang `reverse`: slug dari `brief.title`, id `prd-<slug>`, worktree `HEAD`, push `prd/<slug>`.
  Reuse `createSession`/`getSession` (start kedua menyambung sesi hidup, ADR-0015).

PRD hidup di branch (durable, di-push ke origin), **manusia yang merge** — model integrasi yang
**sama** dengan reverse-docs & done-spec. Tak ada mesin persistensi baru.

### 2. Preview PRD — freshest-wins, reuse `MarkdownView`

- `server`: service `project-prds.ts` + route:
  - `GET /projects/:id/prds` → `{ items: PrdDoc[] }`, PrdDoc `{ slug, name, path, title, live }`.
    Freshest-wins: gabungan `docs/prd/*.md` di `repoDir` (PRD ter-merge) + worktree sesi `prd-*`
    hidup untuk project ini (PRD in-progress). `title` = heading `#` pertama, fallback slug.
  - `GET /projects/:id/prds/*` → `{ path, content }` baca freshest-wins (worktree hidup > repoDir).
- `frontend`: `PrdScreen.tsx` — filter project, daftar PRD, klik → modal preview `MarkdownView`.

### 3. Take PRD → backlog — reuse `POST /specs`

Tombol **"Take ke backlog"** di preview PRD → buka `NewSpecModal` (yang sudah ada) ter-*prefill*:
`project`, `kind = "brief"`, `title` = judul PRD, `context` = "Dari PRD: `<path>`", plus
`payload.prd = "<path>"` sebagai tautan balik. PM menyunting lalu submit → `Spec` biasa. Satu PRD
bisa jadi >1 backlog item: PM ulang tombolnya. **Tak ada auto-split** PRD (parsing markdown bebas
tak andal — YAGNI).

## Komponen tersentuh

**Runner**
- `runner/src/types.ts` — `Flow` += `"prd"`; tipe `PrdBrief`.
- `runner/src/prompt.ts` — `PIPELINES.prd`; `startPrdPrompt()`.
- `runner/src/index.ts` — export `startPrdPrompt`, `PrdBrief` bila perlu.
- `runner/test/prompt.test.ts` — prompt `prd` memuat fase Brainstorm→PRD, path `docs/prd/`, skill.

**Shared**
- `shared/src/dto.ts` — `zFlow` += `"prd"`; `zPrdBrief`; `zTerminalSession` varian PRD.
- `shared/src/api.ts` — `prds(id)`, `prdFile(id, path)`.

**Server**
- `server/src/services/project-prds.ts` — `listPrds`, `readPrd` (freshest-wins, reuse `resolveDir`-pola).
- `server/src/routes/prds.ts` — dua GET di atas (atau fold ke `docs.ts`).
- `server/src/routes/terminal.ts` — cabang `flow === "prd"`.
- `server/src/server.ts` — register route `prds` (bila file baru).
- `server/test/prds.test.ts` + `server/test/terminal.test.ts` — list/read freshest-wins; POST prd session.

**Frontend**
- `src/src/ds/shell.tsx` — `HN_NAV` += `{ key: "prd", label: "PRD", icon: "scroll-text" }` (sebelum Backlog).
- `src/src/screens/PrdScreen.tsx` — daftar + New PRD modal + preview + Take-ke-backlog.
- `src/src/App.tsx` — section `"prd"`, render `PrdScreen`; `NewSpecModal` terima prop `prefill`.
- `src/src/api/client.ts` — `listPrds`, `getPrd`, `startPrd`.
- `src/test/prd-screen.test.tsx` — render daftar, buka preview, take-ke-backlog prefill.

**Docs (SoT)**
- `internal/docs/adr/0041-prd-sebagai-dokumen-flow-project-level.md` — ADR baru.
- `internal/docs/README.md` — daftarkan ADR-0041.
- `internal/docs/architecture/data-model.md` — daftar flow += `prd`; PRD `docs/prd/` (tak dipersist).
- `internal/docs/architecture/api-contract.md` — endpoint `prds` + flow `prd`.
- `internal/docs/entrypoints/prd.md` · `internal/docs/requirements/prd.md` · `internal/docs/product/blueprint.md`
  — tambah kapabilitas PRD.
- `internal/docs/frontend/frontend-implementation.md` — layar PRD.

## Di luar scope (ponytail)

- **Tak ada tabel `Prd`** / migration / status lifecycle DB — PRD adalah dokumen (ADR-0011).
- **Tak ada auto-merge** branch PRD — manusia merge, seragam dengan reverse/done-spec.
- **Tak ada auto-split** PRD → banyak spec; Take-ke-backlog satu per klik.
- **Ceiling diketahui:** di jendela *sesi ditutup tapi branch belum di-merge*, PRD hanya ada di
  branch/origin (tak di `repoDir`, tak ada worktree hidup) → tak muncul di daftar sampai di-merge.
  Alur nyata (create→preview→take dalam satu sesi hidup, lalu merge) menutupinya. Upgrade path bila
  perlu: daftar juga branch `prd/*` yang belum ter-merge. Ditandai `ponytail:` di service.

## Testing

- Unit: `runner/test/prompt.test.ts` (prompt `prd`), `server/test/prds.test.ts` (list/read
  freshest-wins), `src/test/prd-screen.test.tsx`.
- Nyata (wajib per CLAUDE.md): boot server, `POST /terminal/sessions {flow:"prd"}` → cek sesi lahir
  di worktree; tulis `docs/prd/x.md` di worktree → `GET /projects/:id/prds` memuatnya; `POST /specs`
  dari prefill → backlog item terbentuk. curl tiap endpoint tersentuh.
