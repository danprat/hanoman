# ADR-0034 — IDE Visual boleh memutasi working tree `repoDir`, digerbang sesi + force

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-182

## Context
IDE Visual (SPEC-182) menampilkan file explorer + git graph interaktif. User meminta **switch
branch sungguhan** dan **aksi graf** (merge/cherry-pick/revert/checkout) dari dashboard. Semua
bekerja pada `project.repoDir` — checkout **working tree utama** yang dibagi sesi Claude Code lain
(CLAUDE.md/AGENTS.md: "jangan jalankan run di working tree utama"). `git checkout`/`merge` di sana
bisa membuang perubahan tak ter-commit sesi hidup atau memindah HEAD di bawah kaki proses `claude`.

## Decision
IDE **boleh** memutasi `repoDir`, tetapi tiap mutasi (`checkout` + seluruh `POST /projects/:id/git`)
digerbang:
1. **Sesi aktif** — bila ada sesi terminal/run terikat project (`listSessions().filter(projectId
   === id && !exited)`, guard identik `DELETE /projects`) → **409**, kecuali body `{force:true}`.
2. **Tree bersih** — git sendiri menolak checkout/merge yang menimpa; stderr diteruskan apa adanya
   sebagai **409** (bukan `--force` diam-diam).
3. **`force:true`** — melewati gerbang #1 dan menambah `-f`/`-D`. Opt-in per aksi di UI dengan
   peringatan; tak pernah default.

`PUT /projects/:id/file` (simpan file) **tak** digerbang — menulis file bukan operasi git & tak
memindah HEAD. Konflik merge/cherry-pick/revert dikembalikan 409 + pesan, tree ditinggal konflik
untuk diselesaikan lewat Terminal (konsisten `POST /specs/:id/integrate`).

## Consequences
- **Tanpa migration / tanpa skema baru** — `repoDir` sudah ada di `Project`. Endpoint read
  (`tree`/`file`/`graph`/`commit`) diturunkan dari git tiap request, tak disimpan (cermin
  `scanRepoDocs`, ADR-0018).
- **Risiko sisa saat force**: user yang memaksa saat sesi hidup bisa mengganggu sesi itu — diterima
  sebagai keputusan sadar user, dibatasi ke escape eksplisit.
- Read di ref (`?ref=`) memungkinkan **melihat** branch origin tanpa checkout — jalur aman default;
  checkout sungguhan hanya saat user menekan tombolnya.
- **Pengecualian outward-facing (SPEC-193):** `merge` dengan `deleteBranch` menghapus branch yang
  di-merge — lokal (`git branch -D`) lalu **origin** (`git push origin --delete`) bila remote-tracking-nya
  ada. Ini mutasi IDE yang menyentuh remote (bukan sekadar working tree utama); tetap
  digerbang sesi-aktif + `force` yang sama, dan hanya berjalan setelah merge sukses. Push penghapusan
  ke origin hanya untuk branch yang barusan di-merge, opt-in per aksi menu — tak pernah default.
- **Hapus branch mandiri (SPEC-206):** `delete-branch` diperluas dengan `local?`(default true)/`remote?`
  — bisa menghapus branch **origin** langsung dari klik-kanan (`git push origin --delete`), tanpa harus
  lewat merge. `local:false + remote` menghapus origin saja (untuk ref `origin/<b>` yang branch lokalnya
  sudah tak ada). Prinsipnya sama dengan di atas: outward-facing tapi opt-in per aksi menu, digerbang
  sesi-aktif + `force` yang sama, dan hanya menyentuh origin (bukan remote lain). Gagal satu langkah →
  409 (langkah sebelumnya sudah terjadi; graph reload menampilkan keadaan sebenarnya).
