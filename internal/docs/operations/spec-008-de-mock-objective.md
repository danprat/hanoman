# SPEC-008 — Objective (de-mock sweep)

**Fase:** Objective (dikunci) · 2026-07-08
**Jenis:** operability sweep (item kedua setelah SPEC-007)
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Turunan:** design → [`docs/superpowers/specs/2026-07-08-hanoman-de-mock-sweep-spec-008-design.md`], plan → [`docs/superpowers/plans/2026-07-08-hanoman-de-mock-sweep-spec-008.md`].

## Masalah

Audit seluruh tree (2026-07-08) menemukan core orchestration sudah nyata (Claude Agent
SDK, git worktree, Postgres, Redis/BullMQ, GitHub App). Yang tersisa hanya **tiga
permukaan mock residual** yang ditinggalkan spec-spec awal:

1. **Respons terminal run yang dikarang** — `POST /runs/:id/command` mengembalikan balasan
   Claude palsu untuk free text, `resume` yang tidak benar-benar re-enqueue, dan `docs`
   yang tidak membuka file apa pun.
2. **Live run view yang tidak tersambung** — `RunsScreen` masih read-only: merender snapshot
   log saat mount, tak pernah subscribe ke SSE `GET /runs/:id/log`, tanpa kontrol
   steer/pause/resume/stop, dengan `duration` hardcoded `"—"`.
3. **Dataset prototipe di repo** — `proto-data.ts` / `proto-doc-content.ts` / `seed.ts`
   menyimpan data demo prototipe (6 project palsu, spec/run/docs palsu) dan membocorkan id
   prototipe (`loka-pos`, `RUN-8842`) ke `App.tsx`.

## Objective (dikunci)

**Hapus ketiga permukaan mock residual sehingga setiap permukaan yang dilihat atau
dikendalikan pengguna mencerminkan state nyata** — tanpa menambah dependency runtime dan
tanpa menyentuh guardrail Source-of-Truth atau isolasi worktree.

## Kriteria sukses (tingkat fase)

- **Efek nyata di terminal run** — terminal tidak pernah mengarang balasan Claude; free
  text pada run aktif diteruskan sebagai steer nyata dan di-ack jujur; `resume`/`retry`
  benar-benar re-enqueue lewat jalur bersama dengan `POST /control`; `docs <path>` membaca
  file nyata. Tidak ada id prototipe hardcoded di `App.tsx`.
- **Live run view yang benar** — `RunsScreen` subscribe ke SSE, menggabungkan event
  `log`/`phase`/`status`/`cost`/`file` secara live, mengekspos kontrol yang menggerakkan
  endpoint nyata, dan menampilkan `duration` nyata (live saat berjalan).
- **Repo bersih dari data prototipe** — `proto-data`/`proto-doc-content`/`seed` dihapus;
  test membangun hanya data yang mereka assert lewat factory bertipe + `resetDb()`; suite
  hijau.
- **Docs & keputusan tercatat** — `internal/docs` yang tersentuh diperbarui + ter-link di
  index; perubahan skema `Run.finishedAt` didasari migration + ADR-0007.

## Batas scope

- **Termasuk:** ketiga permukaan di atas dan hanya itu.
- **Tidak termasuk:** `paths.fsBrowse`/`/fs/browse` (tak terpakai tapi bukan mock), pipeline
  runner & guardrail (sudah nyata), timing per-fase di luar `finishedAt`, serta
  auth/permission endpoint kontrol (tak berubah dari SPEC-003/004).

## Prinsip yang dipegang

- No mocks: hapus, bukan menyamarkan — sisa `mock`/`fake` di kode adalah dependency
  injection untuk test, bukan mock produksi, dan dibiarkan.
- Perubahan aditif & reversibel: `Run.finishedAt` nullable (migration aman), Fase 3
  sebagai seri commit tersendiri agar bisa di-revert lepas dari Fase 1–2.
- Tanpa dependency runtime baru: live SSE memakai `EventSource` bawaan browser.

> Chiranjivi — objective bertahan lebih lama dari satu run. Spec dan plan turunannya
> tunduk pada pernyataan ini.
