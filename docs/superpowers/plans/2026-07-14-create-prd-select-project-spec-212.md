# Create PRD — pilih project di dalam modal (SPEC-212) — Audit doc-of-record

> **Jalur cepat QA (CLAUDE.md / prompt qa):** temuan berconfidence tinggi, diff kecil, akar
> masalah jelas → **Spec & Plan di-skip**. Dokumen audit ini adalah doc-of-record perbaikan.
> REQUIRED SUB-SKILL Execute: superpowers:test-driven-development + verification-before-completion.

## Temuan (Audit)

Backlog SPEC-212 (sumber qa, severity major): *"saat create prd dalam modal-nya bisa select
project tanpa harus filter di list terlebih dahulu."*

**Akar masalah — `src/src/screens/PrdScreen.tsx`:**

1. Tombol **PRD baru** dinonaktifkan saat filter project = `"all"` ("Semua project"):
   `disabled={all}` (baris ~146) + tooltip *"Pilih satu project untuk membuat PRD"*.
2. `NewPrdModal` **tak punya pemilih project** — target project di-hardcode dari `activeProject`
   (turunan `projectFilter`), yang bernilai `""` saat filter "all".
3. Akibatnya user **wajib** mengganti dropdown filter dari "Semua project" ke satu project
   dulu, baru tombol aktif. Itulah friksi yang dikeluhkan QA.
4. Empty-state action `action={activeProject ? … : undefined}` (baris ~158) ikut menggate hal
   yang sama.

`App.tsx › startPrd(project, brief)` **sudah** menerima `project` sebagai argumen — jadi tak ada
perubahan kontrak API/data model; cukup frontend memasok project dari dalam modal.

## Perbaikan

- `NewPrdModal` menerima `projects` + `defaultProject`, menampilkan `Select` project di dalam
  modal (field pertama), dan mengembalikan `project` terpilih lewat `onCreate`.
- Buang `disabled={all}` + tooltip pada tombol **PRD baru**; tombol selalu aktif (layar hanya
  dirender saat `projectsView.length > 0`, jadi selalu ada ≥1 project).
- Empty-state action selalu boleh membuka modal.
- `PrdScreen` meneruskan `project` terpilih dari modal ke `onNewPrd(project, brief)` (bukan lagi
  `activeProject`). Default modal = `activeProject` bila ada, else project pertama.
- SoT: perbarui `internal/docs/frontend/frontend-implementation.md` (baris deskripsi "PRD baru
  … nonaktif di mode 'Semua project'") dalam commit yang sama.

## Checklist Execute

- [x] Test (RED): `prd-screen.test.tsx` — modal punya `Select` project; membuat PRD dalam mode
      "Semua project" memanggil `onNewPrd` dengan project terpilih dari modal; tombol "PRD baru"
      tidak lagi disabled saat filter "all". (2 test baru, gagal benar sebelum impl.)
- [x] Impl (GREEN): ubah `NewPrdModal` + `PrdScreen` di `src/src/screens/PrdScreen.tsx`.
- [x] Update SoT `internal/docs/frontend/frontend-implementation.md`.
- [x] Verifikasi nyata: suite `@hanoman/app` hijau (202/202), `tsc --noEmit` bersih, `vite build`
      sukses, dan **CDP browser smoke** (Chromium nyata) `SMOKE PASS`: tombol "PRD baru" aktif di
      mode "Semua project", modal punya dropdown project (Alpha/Beta, default p1), pilih p2 → submit
      → `onNewPrd("p2", …)` tanpa memfilter daftar dulu.
