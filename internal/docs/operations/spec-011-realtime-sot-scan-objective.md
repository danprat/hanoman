# SPEC-011 — Objective (realtime Source-of-Truth scan)

**Fase:** Objective (dikunci) · 2026-07-09
**Jenis:** fitur — menggantikan penyimpanan docs `DocFile` (DB-backed) dengan scan filesystem realtime
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Turunan:** design → [`docs/superpowers/specs/2026-07-09-hanoman-realtime-sot-scan-spec-011-design.md`], plan → [`docs/superpowers/plans/2026-07-09-hanoman-realtime-sot-scan.md`].

## Masalah

Fitur docs 100% **DB-backed**. `DocFile` (Postgres) menyimpan `path/content/linked/category`;
`POST /scan` membaca tabel itu, `GET/PUT /docs` membaca/menulisnya. Sejak demo seed dihapus (DB
dijaga kosong untuk pemakaian nyata) **tabelnya kosong → scan melaporkan 0%, docs workspace blank**.
Fitur ini mati di pemakaian nyata. Sementara itu scanner file nyata sudah ada di CLI
(`walkDocs` + `parseIndex` + `catStatus`), tapi hanya menyusuri `internal/docs/**` saat guardrail run.

## Objective (dikunci)

**Buat view Source-of-Truth hanoman mencerminkan proyek nyata di disk secara realtime, mencakup
setiap dokumen Markdown di repo** — bukan hanya `internal/docs/**`, dan bukan salinan Postgres.
Pengguna membrowse, meng-edit, dan menghapus **file yang sebenarnya** dari dashboard, dan hanoman
menghitung **SoT Coverage** dari file-file live itu — tanpa menambah dependency runtime dan tanpa
menyentuh metrik guardrail run maupun isolasi worktree.

## Kriteria sukses (tingkat fase)

- **Realtime dari disk** — `GET /docs` menyusuri + menilai `Project.repoDir` langsung tiap request;
  korpus = setiap `**/*.md` lewat `git ls-files --cached --others --exclude-standard` (`.gitignore`
  dihormati, `node_modules/.worktrees/dist` terlewati gratis). `repoDir` null / bukan git → tree
  kosong, coverage 0, tanpa crash.
- **SoT Coverage dari link graph nyata** — coverage = % kategori (path direktori tiap doc) yang
  **transitif reachable** dari root index (`internal/docs/README.md` bila ada, else repo `README.md`;
  tanpa `indexPath` config baru), dihitung metrik **murni** `linkedSetFrom` di `@hanoman/shared`.
  `coverageOf` + `docStatusFor` dipakai ulang **tanpa diubah** sehingga tree kategori dan ambang status
  tidak bergeser. Tanpa index → semua unlinked, 0%.
- **Edit & hapus file nyata** — `PUT /docs/*` menulis file asli; `DELETE /docs/*` `fs.rm` file asli;
  guard path menjaga operasi tetap di dalam `repoDir` dan hanya `.md` (menolak traversal `../` dan
  sentuhan `.git`).
- **`DocFile` dibuang** — model + relasi `Project.docs` dihapus lewat migration Prisma + ADR-0011;
  `services/docs.ts` jadi fs-backed; test menunjuk project ke temp git repo berisi `.md` nyata,
  bukan insert baris `DocFile`.
- **Web mencerminkan file nyata** — tombol **Scan** per-project + **Hapus** di Docs workspace; label
  `internal/docs` hardcoded dibuang, path ditampilkan repo-relative.
- **Docs & keputusan tercatat** — `internal/docs` yang tersentuh diperbarui + ter-link di index;
  penghapusan skema `DocFile` didasari migration + ADR-0011.

## Batas scope

- **Termasuk:** korpus Markdown seluruh repo, coverage via link graph transitif, edit/hapus realtime
  di disk, pembuangan `DocFile`, tombol Scan + Hapus di web — dan hanya itu.
- **Tidak termasuk:** file watcher / SSE push untuk docs (polling `scan` + live `GET` sudah cukup);
  memigrasikan guardrail run CLI (`collectViolations`) ke `linkedSetFrom` (bisa diadopsi belakangan,
  perubahan terpisah — guardrail tetap di `internal/docs`); membuat dokumen baru dari UI (edit/hapus
  yang ada saja); dokumen non-Markdown (json/toml/yaml/code).

## Prinsip yang dipegang

- **Docs adalah filesystem** — buang `DocFile`, jangan disinkronkan; tak ada layer sync.
- **Metrik murni di shared** — tanpa `node:*` di barrel `shared/src/index.ts` (web mem-bundle-nya via
  Vite; import `node:fs` di sana merusak build). Server & CLI masing-masing memasok adapter fs ~10 baris.
- **Reuse tanpa gerak** — `coverageOf` + `docStatusFor` dipakai ulang apa adanya agar UI tree kategori
  dan ambang status tetap.
- **Reversibel & didasari keputusan** — perubahan skema (drop `DocFile`) lewat migration + ADR-0011.
- **Tanpa dependency runtime baru** — korpus lewat `git ls-files` bawaan, edit/hapus lewat `node:fs`.

> Chiranjivi — objective bertahan lebih lama dari satu run. Spec dan plan turunannya tunduk pada
> pernyataan ini.
