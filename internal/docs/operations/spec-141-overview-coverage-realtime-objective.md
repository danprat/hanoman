# SPEC-141 — Objective (overview coverage realtime)

**Fase:** Audit → Objective (dikunci) · 2026-07-09
**Jenis:** QA — bug, severity **major**, sumber `qa`
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Turunan:** spec → [`docs/superpowers/specs/2026-07-09-hanoman-overview-coverage-realtime-spec-141-design.md`], plan → [`docs/superpowers/plans/2026-07-09-hanoman-overview-coverage-realtime.md`].

## Laporan

- **Steps:** saat menambahkan project, scan tidak langsung otomatis pada overview.
- **Actual:** di overview masih harus tekan Scan dulu baru uptodate.
- **Expected:** langsung auto scan docs — docs SoT sudah realtime, tapi overview tidak.

## Temuan audit (bukti reproduksi)

Reproduksi terhadap API live (`127.0.0.1:8787`), project probe menunjuk repo ini
(80 file `.md`, 47 di-skor), lalu dihapus lagi:

| langkah | `GET /projects` (Overview) | `GET /projects/:id/docs` (realtime) |
| --- | --- | --- |
| `POST /projects` (baru) | **0% · broken** | **100%** |
| tambah satu doc tak ter-link | **100% · ok** (basi) | **92%** |
| `POST /projects/:id/scan` | 100% · ok | 100% |

Dua permukaan membaca angka yang sama pada disk yang sama, pada detik yang sama, dan
tidak setuju. Basinya **dua arah**: pesimistis saat project baru (0% pada repo sehat),
dan optimistis setelah docs berubah (menampilkan 100% saat kenyataannya 92%).

## Akar masalah

`Project.coverage` + `Project.docStatus` adalah **kolom Postgres** — salinan cache dari
nilai yang sepenuhnya **diturunkan dari filesystem**:

- ditulis hardcoded `coverage: 0, docStatus: "broken"` saat create — `server/src/routes/projects.ts:27`; create tidak pernah men-scan;
- **satu-satunya** penyegar adalah `POST /projects/:id/scan` — `server/src/routes/projects.ts:43`;
- dibaca di **satu** tempat, `toProjectView()` — `server/src/services/project-view.ts:17` — yang mensuplai Overview *dan* daftar Projects.

Sementara sumber yang sebenarnya, `scanRepoDocs()` — `server/src/services/scan.ts:40` —
dihitung realtime dari disk tiap request dan dipakai `GET /projects/:id/docs`. Jadi satu
angka punya **dua sumber kebenaran**, dan hanya satu yang benar.

Ini **sisa terakhir ADR-0011**. ADR-0011 membuang model `DocFile` dengan alasan "docs
adalah filesystem nyata, bukan salinan DB", tetapi meninggalkan `Project.coverage` dan
`Project.docStatus` — satu-satunya salinan DB dari state docs yang masih tersisa.

Konsekuensinya lebih luas dari yang dilaporkan:

1. Project baru → `0% / broken` sampai Scan ditekan (gejala yang dilaporkan).
2. **Setiap** perubahan docs — termasuk yang ditulis run hanoman sendiri, yang memperbarui
   `internal/docs` tiap run — membuat Overview basi sampai Scan ditekan lagi.
3. `broken` pada repo sehat yang baru ditambahkan adalah **false alarm**; ia menggerakkan
   tile "Docs on-convention" dan tone merah di `OverviewScreen` serta `ProjectsScreen`.

## Objective (dikunci)

**Overview menampilkan SoT coverage nyata dari disk, sama seperti Docs workspace, tanpa
langkah Scan manual.** `coverage` dan `docStatus` berhenti menjadi state tersimpan dan
kembali menjadi nilai turunan yang dihitung dari `repoDir` saat dibaca — tanpa menambah
dependency runtime, tanpa menyentuh guardrail run CLI maupun isolasi worktree, dan tanpa
menggeser metrik coverage itu sendiri.

## Kriteria sukses (tingkat fase)

- **Overview realtime tanpa Scan** — `toProjectView()` menurunkan `coverage` + `docStatus`
  dari `scanRepoDocs(repoDir)`; project yang baru ditambahkan langsung menampilkan angka
  nyata; `repoDir` null / bukan git → 0% tanpa crash.
- **Satu sumber kebenaran** — kolom `Project.coverage` + `Project.docStatus` dibuang lewat
  migration Prisma + [ADR-0018](../adr/0018-coverage-nilai-turunan.md) (mengikuti preseden
  ADR-0011). Tak ada jalur tulis tersisa. Nomor ADR diklaim di fase Spec setelah dienumerasi
  di seluruh branch + 6 worktree (tertinggi saat itu: `0017`).
- **`POST /scan` dan tombol Scan diselaraskan** — begitu view-nya realtime, endpoint dan
  tombol "Scan" / "Scan semua" (`src/src/App.tsx`, `src/src/screens/DocsWorkspace.tsx`)
  kehilangan makna. Dibuang atau disusutkan jadi no-op yang mengembalikan view — dipilih
  di fase Spec.
- **Tidak memblok event loop** — `scanRepoDocs` memakai `spawnSync` + `readFileSync`, jadi
  ia **memblokir** event loop; `GET /projects` memanggil `toProjectView` sekali per project.
  Terukur: satu scan ≈ **21 ms** (80 `.md`, 47 di-skor); `GET /projects` hari ini ≈ **5 ms**.
  Fix wajib menahan biaya ini — cache ber-key `HEAD` + mtime, atau scan non-blocking —
  sebelum N project membuat daftar project menghentikan server. Ini **bukan** sekadar
  latency; ini stall seluruh proses.
- **Test menyusul kolom** — `server/test/factory.ts` dan route test yang menyetel
  `coverage`/`docStatus` diperbarui; suite hijau.
- **Docs & keputusan tercatat** — `internal/docs` yang tersentuh diperbarui + ter-link di
  index; pembuangan kolom didasari migration + ADR.

## Batas scope

- **Termasuk:** menurunkan `coverage`/`docStatus` di `toProjectView`, membuang kedua kolom
  + migration + ADR, menyelaraskan `POST /scan` dan tombol Scan, menahan biaya scan pada
  `GET /projects`, memperbarui test — dan hanya itu.
- **Tidak termasuk:** guardrail run CLI (`cli/src/verify.ts` sudah menghitung dari disk dan
  tak pernah menyentuh DB — dibiarkan); watcher / SSE push untuk coverage (polling `GET`
  sudah cukup, sesuai batas scope SPEC-011); metrik coverage itu sendiri — `coverageOf`,
  `docStatusFor`, `linkedSetFrom` dipakai ulang **tanpa diubah** sehingga ambang status dan
  tree kategori tidak bergeser; Docs workspace (sudah realtime, tak berubah).

## Perangkap yang tercatat

- **Perbaikan satu baris yang salah.** Menambahkan scan di `POST /projects` menyembuhkan
  persis gejala yang dilaporkan dan meninggalkan divergensi pada **setiap** perubahan doc
  sesudahnya — terbukti di tabel di atas: 92% nyata ditampilkan sebagai 100% ok. Akar
  masalahnya adalah kolomnya, bukan `create`-nya. Jangan tambal di call site.
- `docStatusFor` hari ini dipanggil dari `routes/projects.ts`; setelah kolom dibuang,
  satu-satunya pemanggilnya adalah `toProjectView`.

## Prinsip yang dipegang

- **Docs adalah filesystem** — konsisten dengan ADR-0011; nilai turunan tidak disimpan.
- **Deletion over addition** — perbaikannya membuang kolom dan endpoint, bukan menambah
  sync layer di atas dua sumber kebenaran.
- **Reuse tanpa gerak** — `coverageOf` / `docStatusFor` / `linkedSetFrom` apa adanya.
- **Reversibel & didasari keputusan** — perubahan skema lewat migration + ADR.

> Chiranjivi — objective bertahan lebih lama dari satu run. Spec dan plan turunannya tunduk
> pada pernyataan ini.
