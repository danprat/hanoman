# SPEC-159 — audit: urutan panel run detail (changed files & commit menutupi terminal)

Fase **Audit** dari alur QA (audit → keputusan → (spec → plan)? → execute, SPEC-145/ADR-0020).
Dokumen ini menetapkan akar masalah dan batas perbaikannya. **Tidak ada perubahan kode di fase
ini.**

> **Catatan (fase Execute).** Dieksekusi persis sesuai rekomendasi di bawah, tanpa deviasi:
> `ChangesCard` dan `CommitList` (`src/src/screens/RunsScreen.tsx`) dapat toggle
> collapse/expand (default collapsed) memakai pola chevron dari `DocTreeCat`
> (`DocsWorkspace.tsx`), dan `RunDetail` merender `<LogView>` sebelum blok `changes`, dengan
> `CommitList` sebelum `ChangesCard` di dalamnya — urutan akhir terminal logs → commit → file
> changed. Diverifikasi typecheck + test suite frontend penuh + dua test baru; detail dan alasan
> tidak menjalankan `pnpm dev` bersama server dev yang berjalan di checkout utama ada di bagian
> Verifikasi.

- Sumber: backlog qa · prioritas tinggi · severity `major`
- Gejala dilaporkan: panel "File berubah" dan "Commit" di detail run selalu tampil penuh
  (tanpa expand/collapse) dan dirender **sebelum** panel terminal logs, jadi run dengan banyak
  file berubah/commit mendorong terminal logs jauh ke bawah — menutupinya. Expected: File
  berubah dan Commit punya expand/collapse dengan default **collapse**, dan urutan panel jadi
  **terminal logs → commit → file changed**.

## Akar masalah

Seluruhnya di `RunDetail` (`src/src/screens/RunsScreen.tsx:401-450`), yang merender panel-panel
detail run sebagai deretan blok JSX statis:

1. **Tidak ada mekanisme collapse sama sekali.** `ChangesCard` (`:123-154`, panel "File berubah")
   dan `CommitList` (`:156-174`, panel "Commit") masing-masing me-render body-nya
   (`changes.files.map` / `commits.map`) tanpa syarat — tidak ada state `open`/`collapsed`, tidak
   ada header yang bisa diklik. Run dengan puluhan file berubah mencetak puluhan baris penuh,
   apa pun tinggi viewport.

   Pola collapse **sudah ada** di codebase ini dan tinggal dipakai ulang: `DocTreeCat`
   (`src/src/screens/DocsWorkspace.tsx:62-84`) — `useState(false)` (default tertutup), header
   `<button>` yang men-toggle `open`, ikon `chevron-right`/`chevron-down` dari `Icon` yang sama
   yang sudah diimpor di `RunsScreen.tsx:6`. Tidak ada komponen atau library baru yang perlu
   ditambahkan.

2. **Urutan render salah.** Di `RunDetail`, grid "File berubah" + "Commit" (`:432-440`, dengan
   `ChangesCard` di `:435` sebelum `CommitList` di `:436`) dirender **sebelum**
   `<LogView run={run} />` (`:441`, panel terminal). Karena (1) kedua panel di atasnya selalu
   penuh tanpa batas tinggi, urutan ini yang secara langsung mendorong terminal ke bawah lipatan
   pada run dengan banyak perubahan — persis gejala "menutupi terminal" yang dilaporkan.

Kedua akar masalah ada di file dan komponen yang sama; tidak ada lapisan lain (server, DTO,
`useRunChanges`, `api.runChanges`) yang terlibat — `RunChanges`/`RunCommit` sudah membawa semua
data yang dibutuhkan, ini murni soal bagaimana `RunDetail` menyusun dan merender panelnya.

## Kenapa ini jalur `execute` (bukan `spec`)

Sesuai syarat jalur cepat (SPEC-145/ADR-0020): terlokalisasi, tanpa keputusan desain, tanpa
menyentuh skema/kontrak API.

- **Satu berkas.** Seluruh perbaikan ada di `src/src/screens/RunsScreen.tsx`: tambah state
  collapse ke `ChangesCard`/`CommitList`, dan susun ulang urutan blok di `RunDetail`.
- **Tanpa keputusan desain.** Pola toggle collapse (chevron + `useState` boolean, default
  tertutup) sudah dipakai persis untuk kebutuhan yang sama di `DocsWorkspace.tsx` — tinggal
  diterapkan ke dua `Card` yang sudah ada, bukan komponen atau pattern baru.
- **Tanpa menyentuh skema/DB/kontrak API.** `RunChanges`, `RunCommit`, `api.runChanges`, dan
  `useRunChanges` tidak berubah — ini murni tata letak/state lokal komponen React.
- **Bisa diselesaikan tanpa spec/plan.** Cakupannya persis dua hal yang diminta expected:
  collapse/expand default-collapse pada dua panel, dan reorder tiga blok. Tidak ada pertanyaan
  terbuka.

## Rekomendasi untuk fase Execute

1. Tambah state collapse lokal (`React.useState(false)` — default **collapsed**) ke
   `ChangesCard` (`:123-154`) dan `CommitList` (`:156-174`), mengikuti pola `DocTreeCat`
   (`DocsWorkspace.tsx:62-84`): header (`:128` / `:160`) jadi elemen yang bisa diklik dengan ikon
   `chevron-right`/`chevron-down`, dan body (`.map` di `:137-150` / `:164-170`) hanya dirender
   saat `open`.
2. Di `RunDetail` (`:401-450`), pindahkan `<LogView run={run} />` (`:441`) ke atas — dirender
   tepat sebelum blok `{changes && (...)}` (`:432`), bukan sesudahnya.
3. Di dalam blok `changes` yang sama, tukar urutan `ChangesCard`/`CommitList` (`:435-436`) jadi
   `CommitList` lebih dulu, lalu `ChangesCard` — menghasilkan urutan akhir **terminal logs →
   commit → file changed** persis seperti expected.
4. `FilePreviewPane` (dipicu `onPick` dari `ChangesCard`) tidak perlu dipindah — tetap jadi kolom
   kedua grid yang sama, mengikuti `ChangesCard` yang kini di posisi ketiga.
5. Cakupan mengikuti gejala yang dilaporkan: `RunAsk`/`RunControls`/`RunRetry` (`:444-447`) tidak
   disebut di expected dan tidak perlu dipindah — tetap di posisi akhir.
6. Verifikasi manual: buka run dengan file berubah + commit di `/runs`, pastikan urutan
   top-to-bottom Terminal → Commit → File changed, dan kedua panel Commit/File changed mulai
   dalam keadaan collapsed lalu bisa di-expand tanpa mendorong terminal.

## Verifikasi

Akar masalah dipastikan lewat pembacaan kode statis (`file:baris` dikutip di atas) — struktur
render `RunDetail` dan body kedua komponen panel eksplisit, tidak ada state collapse yang
tersembunyi di tempat lain. Tidak ada reproduksi runtime pada fase Audit: memverifikasi visual
menutupi-tidaknya terminal butuh run nyata dengan banyak file berubah, efek samping yang bukan
milik fase Audit (lihat SPEC-149 audit, bagian Verifikasi, untuk preseden batas yang sama — sesi
yang menjalankan fase ini kemungkinan besar adalah run hanoman itu sendiri).

**Fase Execute:** `pnpm --filter ./src typecheck` bersih. Test suite frontend penuh
(`cd src && vitest run`) hijau, 18/18 file · 72/72 test — termasuk dua test baru di
`src/test/run-order.test.tsx` yang me-render `RunsScreen` dengan `RunChanges` sungguhan (commit +
file berubah lewat `api.runChanges` yang di-mock, bukan langsung memock `ChangesCard`/
`CommitList`), menegaskan posisi DOM "claude code" (header terminal) mendahului "Commit ·" yang
mendahului "File berubah ·", dan bahwa isi kedua panel tidak ada di DOM sampai headernya diklik.
Tidak menjalankan `pnpm dev` melawan server dev bersama yang sedang hidup (worker/API di checkout
utama, DB/Redis dipakai bersama semua worktree) untuk verifikasi visual manual — perubahan ini
murni tata letak/state React lokal tanpa panggilan API baru, jadi tidak ada risiko yang butuh
diverifikasi lewat proses live; membuka server dev bersama berisiko memicu run nyata dari dalam
run yang sedang berjalan (lihat SPEC-149 audit, bagian Verifikasi, untuk insiden yang preseden ini
hindari). Server-side (`pnpm test` di `server/`) tidak dijalankan ulang untuk perubahan ini:
seluruhnya di `src/` dan tidak menyentuh `server/**`.

## Rujukan

- ADR-0020 — [fase perencanaan QA dipangkas oleh keputusan audit](../adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md):
  syarat jalur cepat yang audit ini penuhi.
- [spec-144 — objective (Runs menampilkan changes yang dibuat hanoman)](spec-144-run-changes-preview-objective.md):
  asal `ChangesCard`/`CommitList`/`FilePreviewPane`.
- [spec-149 — audit (run failed tidak bisa di-retry)](spec-149-retry-runs-audit.md):
  preseden bentuk dokumen audit + batas verifikasi statis untuk alur QA di layar yang sama
  (`RunsScreen.tsx`).
- [agent-documentation-workflow](agent-documentation-workflow.md): alur QA audit → spec → plan →
  execute.
