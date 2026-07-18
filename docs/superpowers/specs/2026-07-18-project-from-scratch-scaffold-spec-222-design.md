# SPEC-222 · Project from scratch → scaffold SoT docs dari ide

Status: draft
Date: 2026-07-18

## Masalah

Alur onboarding **from-scratch** dijanjikan di seluruh docs — "brainstorm → kunci
objective → sesi **scaffold** menyusun seluruh doc index" (`operations/agent-documentation-workflow.md:11`,
`entrypoints/blueprint.md:8`, `product/onboarding.md:6`) — tetapi **tak pernah di-wire**.
Konkretnya (hasil audit kode):

- `runner/src/prompt.ts:7` mendeklarasikan `scaffold: ["Brainstorm","Objective","Doc index"]`
  di `PIPELINES`, dan `scaffold` ada di `Flow` union (`runner/src/types.ts:1`, `shared/src/dto.ts:78`),
  **tapi tak ada prompt builder** (`startPrompt`/`startProjectPrompt`/`startPrdPrompt` ada; scaffold tidak).
- `server/src/routes/terminal.ts` menangani `spec`, `flow:"reverse"`, `flow:"prd"`, dan terminal biasa
  — **tak pernah `flow:"scaffold"`**; `zTerminalSession` (`shared/src/dto.ts:104-111`) tak punya varian scaffold.
- **Project from-scratch dibuat dengan `repoDir: null`** (`src/src/App.tsx:419`), jadi **tak ada sesi apa
  pun yang bisa jalan** — semua flow butuh `resolveRepoDir` + worktree berbasis HEAD. Belum ada jalur
  kode yang `git init` repo baru untuk project from-scratch. Ini gap struktural terbesar.
- "Ide awal" yang diketik user di modal (`App.tsx:238`, `f.objective`) **dibuang** sebelum ke API
  (`App.tsx:417-421`); `zCreateProject` tak punya field untuknya.
- Setting `autoScaffold` (`shared/src/entities.ts:42`, default true) **tak dibaca siapa pun** — dekoratif.

Akibatnya: buat project from-scratch → diarahkan ke layar Docs dengan toast "mulai brainstorm objective",
tapi **tak ada yang terjadi** dan docs tetap kosong. Objektif SPEC-222: **breakdown ide menjadi SoT
penuh, semua detail tercover.**

## Keputusan (dikonfirmasi manusia)

1. **Repo from-scratch**: user memilih folder saat buat project → hanoman `git init` + commit awal
   (seed) → `repoDir` di-set. Sesi scaffold lalu jalan di `.worktrees/scaffold-<project>` **persis
   seperti reverse**.
2. **Pemicu scaffold**: tombol manual **"Scaffold docs"** di layar project from-scratch (cermin tombol
   "Reverse docs"), **plus** menghidupkan setting `autoScaffold` — bila on (default), sesi scaffold
   auto-start segera setelah project dibuat.
3. **Seed ide → tanpa perubahan skema**: ide disimpan sebagai `Project.desc` (kolom yang sudah ada).
   Prompt scaffold menyeed brainstorm dari `project.desc`. **Tidak ada migration, tidak ada kolom baru.**

## Bentuk desain

Scaffold = **reverse tanpa fase Scan**, diseed oleh ide alih-alih codebase, di atas repo yang baru
di-`git init`. Ia meniru dua flow project-level yang sudah jadi (`reverse` ADR-0026, `prd` ADR-0041):
worktree isolasi, interaktif turn-by-turn (bukan autonomous), push ke branch yang manusia merge.

### 1. Runner — prompt builder + git init

**`runner/src/git.ts` + `runner/src/types.ts`** — tambah `initRepo(dir)` ke `GitOps`/`realGit`:
- `mkdir -p dir`; `git init` bila belum repo; bila belum ada commit (HEAD tak resolve), tulis seed
  (`README.md` berisi nama project) + `git add -A` + `git commit` dengan identitas eksplisit
  (`-c user.name=hanoman -c user.email=hanoman@local`) agar tak gagal di mesin tanpa git identity global.
- **Idempoten**: repo yang sudah punya commit → no-op. Aman dipanggil pada folder existing.

**`runner/src/prompt.ts`** — tambah `startScaffoldPrompt(project: ProjectBrief, branchTo: string)`:
- Fase dari `PIPELINES.scaffold`: **Brainstorm → Objective → Doc index**.
- **Brainstorm** interaktif: SATU pertanyaan per giliran ke manusia di terminal (perdalam ide jadi
  masalah/pengguna/scope/metrik), diseed dari `project.desc`. Jangan mengarang.
- **Objective**: kunci MVP objective, tulis ke docs.
- **Doc index**: tulis **seluruh** `internal/docs/**` per **STANDAR DOCS** (pakai ulang `REVERSE_STANDARD`
  dari `reverse-standard.ts` — taksonomi + format + index + CLAUDE/AGENTS + Stop hook), diturunkan dari
  ide+objective+jawaban wawancara, **bukan** dari Scan kode. Lengkap & spesifik, bukan kerangka.
- **Tanpa `AUTONOMY_CLAUSE`** (seperti reverse/prd): Brainstorm memang berjalan bergiliran dengan manusia.
- Push per fase ke branch `scaffold-docs`; bila origin tak ada, lewati & catat (cermin reverse). Manusia merge.
- Export dari `runner/src/index.ts`.

`REVERSE_STANDARD` dipakai ulang apa adanya (ia sesungguhnya "standar docs", bukan khusus reverse) —
di-import di prompt scaffold. Tak ada file standar baru.

### 2. Server — route + git-init saat create

**`server/src/routes/terminal.ts`** — cabang `flow === "scaffold"` (cermin cabang reverse `:117-138`):
- id deterministik `scaffold-<project>` (Start kedua = re-attach, ADR-0015).
- `addWorktree(repoDir, .../.worktrees/scaffold-<id>, "HEAD")`; gagal → 422.
- `startScaffoldPrompt({id,name,desc,stack}, "scaffold-docs")`.
- Tanpa Spec: `DELETE /terminal/sessions` tak menggerakkan stage (`if (s.specId)` sudah menjaga),
  worktree tetap dibersihkan (cabang `s.flow || cwd.includes("/.worktrees/")` sudah menangani).

**`server/src/routes/projects.ts`** — `POST /projects`: bila `kind === "from-scratch"` **dan** `repoDir`
diisi, panggil `realGit.initRepo(repoDir)` **sebelum** membuat baris. Gagal init → 400 dengan pesan jelas
(project tak dibuat), agar user tahu langsung. `desc` menyimpan ide.

**`shared/src/dto.ts`** — tambah varian ke `zTerminalSession`:
`z.object({ project: z.string(), flow: z.literal("scaffold") })`.

### 3. Client + Frontend

**`src/src/api/client.ts`** — `scaffoldDocs(project) => POST {project, flow:"scaffold"}` (cermin `reverseDocs`).

**`src/src/App.tsx`**:
- `NewProjectModal` (from-scratch): tambah field **Direktori** + `FolderPicker` (seperti existing-local)
  dan jadikan **wajib** (`canSubmit` scratch = `name && dir`, karena scaffold butuh repo on-disk);
  pertahankan "Ide awal". Field "Deskripsi" pendek dihapus dari tab from-scratch — ide (`f.objective`)
  yang menjadi `desc`.
- `createProject`: untuk scratch kirim `repoDir: f.dir`, `desc: f.objective` (fallback `f.desc`). Sesudah sukses,
  bila `settings.autoScaffold` → `api.scaffoldDocs(created.id)` + pindah ke **Terminal**; selain itu pindah
  ke layar **project** (tempat tombol "Scaffold docs" berada).
- Tambah fungsi `scaffoldDocs(p)` (cermin `reverseDocs`).
- Section "project": wire `onScaffold={proj.kind === "from-scratch" && proj.repoDir ? () => scaffoldDocs(proj) : undefined}`.

**`src/src/screens/ProjectDetailScreen.tsx`** — prop opsional `onScaffold?`; render Door
**"Scaffold docs"** (icon `sparkles`, hint "susun Source of Truth dari ide"). Grid kolom = 4 bila salah
satu dari `onReverse`/`onScaffold` ada, else 3 (project selalu hanya salah satu — from-scratch xor existing).

### Unit & batas
- `initRepo` — apa: bikin repo siap-worktree; pakai: `realGit.initRepo(dir)`; depends: git CLI. Idempoten.
- `startScaffoldPrompt` — apa: string prompt sesi scaffold; pakai: dipanggil route; depends: `REVERSE_STANDARD`.
- Cabang route scaffold — apa: spawn sesi project-level; sejajar cabang reverse/prd.
- Semua reuse: `pty.createSession`, phase-file tracking, worktree lifecycle, `REVERSE_STANDARD`.

## Testing (TDD)

- **runner/git**: `initRepo` menghasilkan repo dengan HEAD commit; idempoten pada repo existing;
  `addWorktree(dir,...,"HEAD")` sukses sesudahnya.
- **runner/prompt**: `startScaffoldPrompt` memuat fase `Brainstorm → Objective → Doc index`, menyertakan
  `REVERSE_STANDARD`, push `scaffold-docs`, menyeed dari `project.desc`, TANPA fase Scan, TANPA autonomy clause.
- **shared/dto**: `zTerminalSession` menerima `{project, flow:"scaffold"}`.
- **server/terminal**: `POST /terminal/sessions {project, flow:"scaffold"}` → 201 + worktree; 422 tanpa repoDir.
- **server/projects**: `POST /projects {kind:"from-scratch", repoDir}` → repo ter-init (HEAD ada); non-repoDir → tanpa init.
- **Live**: boot server, `POST /projects` from-scratch dengan dir sementara, cek `.git` + HEAD; `POST
  /terminal/sessions {flow:"scaffold"}` → 201 & worktree `.worktrees/scaffold-<id>` lahir.

## Docs (SoT) diperbarui commit yang sama

- `architecture/api-contract.md`: `flow:"scaffold"` di `POST /terminal/sessions`; git-init `POST /projects` from-scratch.
- `requirements/frd.md` / `entrypoints/frd.md`: klausa EARS scaffold + git-init from-scratch.
- `architecture/data-model.md`: catat `repoDir` from-scratch kini di-`git init`; flow set sudah memuat scaffold.
- `operations/agent-documentation-workflow.md` + `product/onboarding.md`: tandai scaffold **kini terimplementasi**.
- **ADR baru `adr/0052-scaffold-flow-from-ide.md`** (nomor bebas lintas branch: tertinggi 0051): keputusan
  flow scaffold from-scratch = sesi project-level + git-init, seed dari ide, pakai ulang REVERSE_STANDARD.
- `internal/docs/README.md`: link ADR-0052.

## Non-goals (YAGNI)
- Tanpa kolom Project baru / migration (ide → `desc`).
- Tanpa workspace-root terkelola otomatis (user pilih folder eksplisit).
- Tanpa auto-take doc index ke backlog; tanpa mengubah mesin coverage.
