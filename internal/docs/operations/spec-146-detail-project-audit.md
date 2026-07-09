# SPEC-146 — audit: belum ada detail project

Fase **Audit** dari alur QA (audit → spec → plan → execute). Dokumen ini menetapkan kondisi
kode saat ini dan batas perbaikannya. **Tidak ada perubahan kode di fase ini.**

- Sumber: backlog qa · prioritas tinggi · severity `major`
- Hilir: [spec SPEC-146](spec-146-detail-project-spec.md)
- Gejala yang dilaporkan: klik project tidak membuka detail project; detail project
  seharusnya bisa diedit dan mengarahkan ke docs, runs, backlog.

## Kondisi saat ini

Klik pada baris project **sudah punya handler** — bukan dead click. `ProjectRow`
(`src/src/screens/ProjectsScreen.tsx:69-110`) memasang `onClick` di seluruh baris (`:76`)
dan menampilkan afordansi `chevron-right` (`:106`), memberi kesan "ada halaman di
baliknya". Tapi handler-nya, `openProject` (`src/src/App.tsx:339`):

```ts
function openProject(p: ProjectVM) { setProjectId(p.id); setSection("docs"); }
```

langsung melompat ke section **Docs** (Source of Truth), bukan ke halaman detail.
`OverviewScreen` memakai handler yang sama untuk baris "perlu perhatian" dan "on
convention" (`OverviewScreen.tsx:147,163`). Jadi "belum ada detail project" akurat: satu
klik hari ini hanya membuka satu dari tiga hal yang diminta expected (docs), tanpa edit
dan tanpa tautan eksplisit ke runs/backlog.

## Tiga hal yang hilang

1. **Halaman/komponen detail project.** Tidak ada `ProjectDetail*` di manapun di
   `src/src/` (grep kosong repo-wide). Satu-satunya konsep "detail" yang ada adalah modal
   detail spec di Backlog (`BacklogScreen.tsx:169` state `detailId`) dan panel detail run
   di `RunsScreen.tsx` — keduanya bukan tentang project.

2. **Edit project.** Tidak ada di satu pun lapisan stack:
   - `shared/src/entities.ts:7-14` (`zProject`) mendefinisikan field yang kelihatan bisa
     diedit (`name`, `desc`, `kind`, `repoDir`, `repoUrl`), tapi `shared/src/dto.ts:5-7`
     hanya punya `zCreateProject` — tidak ada `zUpdateProject`/`zPatchProject` (bandingkan
     `zPatchSpec` di `dto.ts:14`, yang sudah jadi pola PATCH untuk entity lain).
   - `server/src/routes/projects.ts` hanya `GET /projects` (`:8`), `GET /projects/:id`
     (`:12-16` — ada, tapi **tidak pernah dipanggil frontend**: `api.getProject`
     di `src/src/api/client.ts:12` nol caller di repo), `POST /projects` (`:17-31`),
     `DELETE /projects/:id` (`:32-40`), `GET /projects/:id/branches` (`:43-48`). Tidak ada
     `PUT`/`PATCH`.
   - Satu-satunya aksi project di header Docs (`App.tsx:516-519`) adalah dropdown
     ganti-project dan tombol **"Hapus project"** — tidak ada form edit.

3. **Tautan ke docs/runs/backlog dari satu tempat.** Docs sudah project-scoped lewat
   state `projectId` bersama (`App.tsx:280,522`), tapi Runs dan Backlog tidak:
   - `BacklogScreen.tsx:167` punya filter project, tapi **state lokal komponen**
     (`useState("all")`) dipakai di predikat filter (`:171-172`) — tidak bisa di-preset
     dari luar (mis. dari klik project).
   - `RunsScreen.tsx` **sama sekali tidak punya** filter/prop project — grep
     `projectId`/`projectFilter` nol match. `run.project` cuma dirender sebagai label,
     bukan filter.
   - Tidak ada router (`react-router` nol dependency di `src/package.json`); navigasi
     murni `section` state (`App.tsx:275`) lewat rantai `if/else` (`:462-536`). Tidak ada
     representasi URL/query-param untuk project id, jadi tidak ada deep-link hari ini ke
     "runs milik project X" atau "backlog milik project X".

## Kenapa ini bukan tambal satu-dua berkas

Memenuhi expected ("klik project → detail, bisa edit, bisa ke docs/runs/backlog")
menyentuh permukaan yang lebih luas dari satu predikat yang lupa (bandingkan SPEC-142):

- **Kontrak API baru.** Edit project butuh endpoint `PATCH`/`PUT /projects/:id` + skema
  `zUpdateProject`, perubahan `internal/docs/architecture/api-contract.md`, dan keputusan
  desain: `id` diturunkan dari `name` saat create (`projects.ts:21`), jadi mengedit `name`
  punya pertanyaan sendiri — apakah `id` ikut berubah, atau `name` lepas dari `id`.
- **Retrofit dua screen.** `RunsScreen` tidak punya mekanisme project-scoping sama
  sekali — ini bukan "sambungkan prop yang sudah ada", tapi membangun filter yang belum
  ada. `BacklogScreen` punya filter tapi perlu diangkat dari state lokal ke prop
  terkontrol.
- **Keputusan navigasi.** Tidak ada router; perlu diputuskan apakah project detail jadi
  section baru (konsisten dengan pola `section` yang ada) atau pola lain, dan bagaimana
  "mengarahkan ke docs/runs/backlog" diwujudkan.
- **Komponen baru.** Tidak ada kerangka detail-page untuk project di design system yang
  bisa dipakai apa adanya; layoutnya perlu dirancang.

Kontrak API, dua screen yang perlu diretrofit, dan keputusan navigasi/layout ini melewati
ambang "satu-dua berkas, tanpa keputusan desain, tanpa menyentuh skema/API" yang jadi
syarat jalur cepat (ADR-0020).

## Rekomendasi untuk fase Spec

1. Skema `zUpdateProject` (`shared/src/dto.ts`) + `PATCH /projects/:id`
   (`server/src/routes/projects.ts`), dengan keputusan eksplisit soal `id` vs `name`.
2. Section baru untuk detail project (pola sama seperti section lain di `App.tsx`),
   diarahkan dari `openProject` (`App.tsx:339`) menggantikan lompatan langsung ke `docs`.
3. Angkat filter project `BacklogScreen` (`:167-172`) jadi prop terkontrol; tambahkan
   filter project di `RunsScreen` (belum ada sama sekali) — keduanya perlu bisa di-preset
   dari detail project.
4. Update `internal/docs/frontend/frontend-implementation.md:5` (daftar section) dan
   `internal/docs/architecture/api-contract.md` untuk endpoint baru.
5. Test: filter murni (Backlog/Runs by project) diuji unit; endpoint PATCH diuji
   integrasi ringan (pola sama seperti test `POST`/`DELETE /projects` yang sudah ada).

## Verifikasi

Ditemukan lewat pembacaan kode statis (ditandai `file:baris` yang dikutip), tanpa
menjalankan server atau memicu run — konsisten dengan batas fase Audit (lihat SPEC-142,
bagian Verifikasi). `grep` dipakai untuk memastikan ketiadaan (`ProjectDetail`,
filter project di `RunsScreen`, `zUpdateProject`, `react-router`) di seluruh `src/src`,
`server/src`, `shared/src`, dan `internal/docs` — nol match pada setiap istilah tersebut.

## Rujukan

- ADR-0020 — [fase perencanaan QA dipangkas oleh keputusan audit](../adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md):
  syarat jalur cepat yang audit ini tidak penuhi.
- [frontend-implementation](../frontend/frontend-implementation.md): daftar section
  saat ini — tidak menyebut detail atau edit project.
- [spec-142 — audit](spec-142-runs-status-auto-update-audit.md): preseden bentuk dokumen
  audit untuk alur QA.
