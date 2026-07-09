# SPEC-146 — Spec: detail project

**Fase:** Spec (dikunci) · 2026-07-10
**Jenis:** QA — alur audit → **spec** → plan → execute
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Hulu:** [audit SPEC-146](spec-146-detail-project-audit.md).
**Turunan:** plan → [`docs/superpowers/plans/2026-07-10-hanoman-detail-project-spec-146.md`](../../../docs/superpowers/plans/2026-07-10-hanoman-detail-project-spec-146.md).

## Masalah

Baris project sudah terlihat seperti tautan — seluruh baris punya `onClick`
(`src/src/screens/ProjectsScreen.tsx:76`) dan afordansi `chevron-right` (`:106`) — tetapi
handler-nya melompat ke Docs, bukan ke halaman detail:

```ts
// src/src/App.tsx:339
function openProject(p: ProjectVM) { setProjectId(p.id); setSection("docs"); }
```

Satu klik hari ini memenuhi satu dari tiga yang diminta (docs), tanpa edit dan tanpa jalan ke
runs/backlog. Tidak ada komponen detail project di manapun, tidak ada endpoint atau skema untuk
mengedit project, dan `RunsScreen` sama sekali tidak punya mekanisme filter project. Akar
lengkapnya di dokumen audit.

## Objective (dikunci)

**Klik project membuka layar detail project**, yang menampilkan identitasnya, mengizinkan
**edit** field yang tidak menggerakkan run, dan menjadi titik tolak ke **docs, runs, dan
backlog** project itu — tanpa menambah router, tanpa mengubah skema database, dan tanpa
menyentuh `id` yang menjadi kunci asing seluruh entitas lain.

## Keputusan desain yang dikunci

### 1. `id` kekal; `name` adalah label bebas

`id` diturunkan sekali dari `name` saat create (`server/src/routes/projects.ts:21`) dan menjadi
kunci asing `Spec`/`Run`/`Trigger` (`onDelete: Cascade`). `id` **tidak pernah** dapat diubah;
tidak ada endpoint rename dan spec ini tidak menambahkannya.

`name` hari ini selalu sama dengan `id` — route create menuliskan `name: id` (`projects.ts:26`).
Sesudah spec ini `name` boleh menyimpang, dan itu aman: seluruh pemakaian `name` di repo bersifat
tampilan semata — `ProjectsScreen.tsx:90`, `OverviewScreen.tsx:55,87,127`, `TerminalScreen.tsx:39,62`,
opsi `Select` di `App.tsx:71,140,518`, breadcrumb `App.tsx:514`, dan filter cari `App.tsx:336`.
`toProjectView` (`server/src/services/project-view.ts`) meneruskannya apa adanya. Tak satu pun
jalur git, worktree, atau filesystem membaca `name`.

**Tanpa ADR.** CLAUDE.md menuntut ADR untuk perubahan skema; tidak ada kolom yang berubah —
`name` dan `desc` sudah ada. Ini mengikuti preseden [spec SPEC-142](spec-142-runs-status-auto-update-spec.md),
yang menolak ADR atas dasar yang sama. Konsekuensinya dicatat di `data-model.md` pada fase Execute.

### 2. Yang boleh diedit: `name` dan `desc` — hanya itu

| Field | Editable | Alasan |
| --- | --- | --- |
| `name` | ya | label tampilan; tak dibaca mesin |
| `desc` | ya | label tampilan; tak dibaca mesin |
| `id` | tidak | kunci asing Spec/Run/Trigger |
| `kind` | tidak | menentukan onboarding (`scaffold` vs `reverse`) yang sudah terjadi; membaliknya pasca-create tak berarti |
| `repoDir` | tidak | tempat setiap worktree run, scan docs, dan sesi terminal hidup (`project-view.ts`, `routes/runs.ts:120`, `routes/terminal.ts:35`); memindahkannya sementara spec/run lama menunjuk repo lama adalah keputusan integritas data, bukan field form |
| `repoUrl`, `stack` | tidak | ditulis `scaffold`/`reverse` (ADR-0004), bukan oleh manusia |

### 3. Navigasi tetap `section`, bukan router

Tidak ada `react-router` di `src/package.json`; navigasi adalah rantai `if/else` atas satu state
`section` (`App.tsx:275,462-536`). Menambah router untuk satu layar berarti memindahkan seluruh
navigasi ke arsitektur baru demi satu tiket. Detail project menjadi **section baru `"project"`**,
dengan `Shell active="projects"` supaya sidebar tetap menyorot Projects — `Shell.active` hanya
sebuah string yang dibandingkan dengan key nav (`ds/shell.tsx:9-18,68-71`), jadi ini tidak menuntut
item sidebar baru. Konsekuensinya: detail project tidak punya URL sendiri, persis seperti tujuh
section lain hari ini.

### 4. Filter project dimiliki `App`, bukan tiap layar

`BacklogScreen` sudah punya filter project, tapi state-nya lokal (`useState("all")`,
`BacklogScreen.tsx:167`) sehingga tak bisa di-preset dari luar. `RunsScreen` tidak punya sama
sekali (`:374-375`). Keduanya menerima pasangan prop terkontrol `projectFilter` /
`onProjectFilter` dari satu state di `App`, default `"all"`.

State ini **terpisah** dari `projectId` (`App.tsx:280`). `projectId` berarti "project yang sedang
dibuka Docs/detail"; `projectFilter` berarti "daftar sedang dipersempit". Menyatukannya membuat
klik sidebar **Runs** diam-diam menyaring ke project terakhir yang dibuka Docs.

## Kriteria penerimaan (EARS)

- WHEN operator mengklik baris project di Projects atau Overview, THE SYSTEM SHALL membuka layar
  detail project itu — bukan Docs.
- THE SYSTEM SHALL menampilkan pada detail project: `name`, `desc`, `kind`, `repoDir`,
  `docStatus` + `coverage`, jumlah backlog terbuka, dan status run terakhir.
- WHEN operator menyimpan form edit pada detail project, THE SYSTEM SHALL mengirim
  `PATCH /projects/:id` dan menampilkan `name`/`desc` baru tanpa reload halaman.
- THE SYSTEM SHALL mempertahankan `id` project tidak berubah pada setiap `PATCH`.
- IF `name` pada body `PATCH` adalah string kosong, THEN THE SYSTEM SHALL menjawab `400` dan tidak
  mengubah apa pun.
- IF `id` pada `PATCH /projects/:id` tidak dikenal, THEN THE SYSTEM SHALL menjawab `404`.
- WHILE sebuah project memiliki run berstatus `queued`, `running`, atau `paused`, THE SYSTEM SHALL
  tetap menerima `PATCH` atasnya — berbeda dari `DELETE` yang menjawab `409` (`projects.ts:35-36`).
- WHEN operator menekan **Docs**, **Runs**, atau **Backlog** pada detail project, THE SYSTEM SHALL
  membuka section itu dengan cakupan project tersebut.
- WHILE filter project aktif pada Runs atau Backlog, THE SYSTEM SHALL menampilkan hanya run/spec
  milik project itu dan tetap menyediakan opsi **Semua project**.
- WHEN project yang sedang dibuka detailnya dihapus, THE SYSTEM SHALL kembali ke daftar Projects
  dan mengembalikan filter project ke **Semua project**.

## Perubahan yang diminta

1. **`shared/src/dto.ts`** — `zUpdateProject = z.object({ name: z.string().min(1).optional(), desc: z.string().optional() })`.
   Bersebelahan dengan `zCreateProject` (`:5-7`) dan `zPatchSpec` (`:14`). Body kosong `{}` sah dan
   berarti no-op; ini menghindari refinement "minimal satu field" yang tak menjaga apa pun.
2. **`server/src/routes/projects.ts`** — `app.patch("/projects/:id", …)`: 404 bila project tak ada,
   `safeParse` → 400, `prisma.project.update`, kembalikan `toProjectView(id)`. Cermin persis
   `app.patch("/specs/:id")` (`server/src/routes/specs.ts:42-44`). Tanpa cek run aktif.
3. **`src/src/api/client.ts`** — `updateProject(id, body)` memakai `paths.project(id)` + `PATCH`,
   pola sama seperti `patchSpec` (`:20-21`). `getProject` (`:12`) yang hari ini nol caller dipakai
   detail project **tidak** — daftar sudah memuat semua field yang dibutuhkan; menambah fetch kedua
   hanya menambah state loading tanpa data baru.
4. **`src/src/screens/ProjectDetailScreen.tsx`** (baru) — ringkasan project + tombol **Edit**, dan
   tiga tautan **Docs · SoT**, **Runs**, **Backlog**. Seluruhnya tersusun dari komponen DS yang
   sudah ada (`Card`, `Badge`, `StatusPill`, `ProgressBar`, `Button`, `Icon`); tidak ada komponen
   design-system baru.
5. **`src/src/App.tsx`** —
   - `openProject` (`:339`) → `setProjectId(p.id); setSection("project")`.
   - cabang `section === "project"` pada rantai (`:462-536`), `Shell active="projects"`.
   - state `projectFilter` (default `"all"`), diteruskan ke Backlog dan Runs.
   - modal edit memakai `Modal`/`Field`/`Input` yang sudah dipakai `NewProjectModal` (`:214-271`).
   - `deleteProject` (`:353-368`): guard `if (section === "docs")` (`:362`) harus juga menangkap
     `section === "project"`, dan mereset `projectFilter` bila menunjuk project yang dihapus.
     Tanpa ini layar detail merender project yang sudah tiada.
6. **`src/src/screens/BacklogScreen.tsx`** — `proj` lokal (`:167`) menjadi prop terkontrol; predikat
   filter (`:171-172`) dan kunci `usePaged` (`:173`) membacanya dari prop.
7. **`src/src/screens/RunsScreen.tsx`** — prop `projectFilter`/`onProjectFilter` + satu `Select`
   di header daftar (`:400-402`), meniru kontrol yang sudah ada di Backlog (`:181-182`). Filter
   diterapkan sebelum `usePaged`, dan `projectFilter` masuk ke kunci pager agar halaman ter-reset.

## Test

- **`server/test/projects.route.test.ts`** (sudah ada) — empat kasus `PATCH`: rename sukses
  (`200`, `name` berubah, **`id` tetap**), `name: ""` → `400`, id tak dikenal → `404`, dan rename
  sah **saat ada run `running`** (kontras dengan `DELETE` yang `409`). Keempatnya gagal hari ini:
  route-nya belum ada.
- **`src/test/project-detail.test.tsx`** (baru) — klik baris project mendarat di layar detail
  (bukan Docs), dan tombol **Runs** membuka Runs yang tersaring ke project itu. Keduanya gagal pada
  kode hari ini.

  Berkas terpisah, bukan titipan di `src/test/app-flows.test.tsx`: satu berkas hanya boleh punya
  satu `vi.mock` per modul, dan berkas itu sudah mengunci `listRuns` ke `[]` — persis alasan
  `run-poll.test.tsx` berdiri sendiri (amandemen fase Plan pada spec SPEC-142).

Tidak ada unit test terpisah untuk `zUpdateProject`: skema deklaratif yang benar lewat inspeksi,
dan kasus `400`/`200` di atas sudah menjalankannya lewat route.

## Batas scope

- **Termasuk:** tujuh butir "Perubahan yang diminta" dan dua berkas test di atas. Hanya itu.
- **Tidak termasuk:**
  - **Router / deep-link URL.** Keputusan 3. Tujuh section lain juga tak punya URL; menambah router
    adalah arsitektur baru untuk satu layar.
  - **Edit `kind`, `repoDir`, `repoUrl`, `stack`.** Keputusan 2 — masing-masing menggerakkan run,
    scan, atau sesi terminal.
  - **Rename `id`.** Kunci asing tiga tabel. Butuh migration + ADR bila suatu saat diinginkan.
  - **`GET /projects/:id` sebagai sumber detail.** Ada (`projects.ts:12-16`), nol caller; daftar
    sudah membawa `ProjectView` lengkap. Dibiarkan apa adanya.
  - **Filter project pada Overview, Triggers, Terminal.** Objective menyebut docs, runs, backlog.

## Perangkap yang tercatat

- **`POST /projects` membuang `name` yang diketik** (`projects.ts:26` menulis `name: id`). Itu
  **konsisten** dengan form hari ini, yang meminta slug — hint `"lowercase, tanpa spasi"`
  (`App.tsx:246`). Jadi bukan bug yang diperbaiki di sini: sesudah spec ini operator dapat memberi
  nama tampilan lewat Edit. Menjadikan `name` menerima teks bebas saat create berarti mengubah makna
  form itu — backlog item terpisah. Dicatat, bukan diperbaiki.
- **`api-contract.md:10` mencantumkan `POST /projects/:id/scan`** yang tidak ada di route, dan
  baris `:66` pada berkas yang sama menyatakan `POST /scan` memang dicabut (ADR-0018). Dokumen itu
  bertentangan dengan dirinya sendiri. Fase Execute menyentuh blok yang sama; koreksinya **bukan**
  milik tiket ini. Dicatat, bukan diperbaiki.
- **`projectFilter` yang menunjuk project terhapus** menghasilkan daftar kosong yang tampak seperti
  bug data. Ditangkap kriteria penerimaan terakhir dan butir 5.

## Docs yang menyusul (fase Execute)

Perubahan berikut menyertai commit yang mengubah `src/` dan `server/`, bukan commit spec ini —
mendokumentasikan endpoint yang belum ada akan membuat Source of Truth berbohong:

- `internal/docs/architecture/api-contract.md` — `PATCH /projects/:id  { name?, desc? }` pada blok
  Projects (`:5-12`).
- `internal/docs/architecture/data-model.md` — `id` (slug) **kekal**; `name` label tampilan yang
  boleh menyimpang dari `id` (`:5-8`).
- `internal/docs/frontend/frontend-implementation.md` — daftar section (`:5`) menambahkan detail
  project (edit + tautan ke docs/runs/backlog) dan filter project di Runs.

## Prinsip yang dipegang

- **Kunci tak pernah bergerak; label bebas bergerak.** `id` memikul tiga kunci asing, `name` tidak
  memikul apa pun selain mata operator.
- **Satu pemilik untuk satu pertanyaan.** "Daftar disaring ke project mana?" dijawab satu state di
  `App`, bukan disalin ke tiap layar — akar yang sama seperti `isRunActive` pada SPEC-142.
- **Jangan tukar satu layar dengan satu arsitektur.** Router, fetch detail terpisah, dan komponen DS
  baru semuanya ditolak karena yang diminta tidak menuntutnya.
- **Edit hanya yang tak menggerakkan run.** Field yang menentukan tempat run hidup bukan field form.
- **Tes yang gagal kalau bug-nya kembali** — bukan tes yang hijau di kedua sisi perbaikan.

> Chiranjivi — spec bertahan lebih lama dari satu run. Plan turunannya tunduk pada pernyataan ini.
