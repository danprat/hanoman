# SPEC-185 · Merge ke local (Gagal Merge ke Local)

Sumber: qa · prioritas tinggi · severity major.

## Masalah

Merge sebuah backlog item yang sudah `done` ke branch **lokal** selalu gagal.

Reproduksi (100% di repo nyata):
- Repo nyata hanya punya satu branch lokal: `main`, yang selalu di-checkout di working tree utama.
- `IntegrateDialog` karena itu hanya menawarkan `local:main` sebagai target lokal.
- Memilihnya → `integrate(repoDir, spec, "merge", "local:main")` → merge **bersih** di worktree isolasi → `runFinalize` menjalankan `git branch -f main <head>` → **git menolak** memaksa branch yang sedang di-checkout → dikembalikan `409 "branch main sedang di-checkout — pilih target origin"`.

Root cause: `git branch -f <b>` ditolak git bila `<b>` sedang di-checkout. `main` selalu di-checkout di working tree utama, jadi tiap "merge ke local" gagal. Perilaku ini bahkan sudah "di-test" sebagai `gagal-aman` di `server/test/integrate.test.ts:40-43` — SPEC-185 membalik keputusan itu: merge ke local harus benar-benar tuntas.

## Desain

Perbaikan terpusat di satu titik: jalur `branch-f` (finalisasi merge → target lokal) di `server/src/services/integrate.ts`. Merge origin dan rebase tak tersentuh.

Merge commit di worktree isolasi **selalu descendant** dari tip target (worktree di-base pada tip target lalu me-merge branch spec). Karena itu branch lokal cukup di-**fast-forward** ke situ.

Tiga cabang finalisasi lokal:

1. **Branch lokal TIDAK di-checkout** (mis. `staging`): tetap `git branch -f <b> <head>` — sudah bekerja hari ini. → `clean`.
2. **Branch di-checkout, working tree BERSIH → auto fast-forward.** Temukan worktree pemilik branch via `git worktree list --porcelain`, jalankan `git -C <checkout-wt> merge --ff-only <head>`. Ini memajukan ref + index + working tree secara konsisten, dan mempertahankan perubahan uncommitted yang tak bertabrakan. → `clean`.
3. **Branch di-checkout, working tree KOTOR / bukan fast-forward → `409` actionable.** `git merge --ff-only` gagal aman (git membatalkan tanpa menimpa). Kembalikan pesan jelas: `working tree "<b>" ada perubahan belum tersimpan atau bukan fast-forward — commit/stash lalu ulangi, atau pilih target origin`. User menuntaskan di **terminal-nya sendiri**.

### Kenapa kasus kotor bukan spawn sesi claude

CLAUDE.md melarang menjalankan run di working tree utama (`Jangan jalankan run di working tree utama — selalu worktree terpisah`). Kasus kotor secara mendasar menuntut menyentuh working tree yang di-checkout — dan hanya user yang boleh membereskan perubahan uncommitted miliknya. Jadi "serahkan ke terminal session" diwujudkan sebagai error actionable yang mengarahkan user ke terminal-nya sendiri, bukan `claude -p` di main. (Dikonfirmasi user, 2026-07-11.)

Auto fast-forward (kasus bersih) bukan "run" — hanya satu operasi git aman yang server jalankan; ia hanya menyentuh file yang tak dimodifikasi lokal (ff membatalkan bila akan menimpa edit uncommitted), jadi aman terhadap working tree utama yang di-share.

### Perbaikan konsistensi (root cause yang sama)

Instruksi finalisasi untuk kasus **conflict → target lokal** (`finalizeInstruction`) juga memancarkan `git branch -f <b> HEAD` yang rusak. Perbaiki agar sesi resolusi konflik menuntaskan lewat fast-forward ke worktree checkout: `git -C <checkout> merge --ff-only <sha>` (bila working tree checkout bersih), sehingga merge lokal yang berkonflik pun bisa benar-benar mendarat. Bila worktree pemilik tak ditemukan (branch tak di-checkout) instruksi tetap `git branch -f`.

## Kontrak yang berubah

`POST /specs/:id/integrate`, `op:"merge"`, `target:"local:<b>"`:
- Branch tak di-checkout → `clean` (tak berubah).
- Branch di-checkout + tree bersih → **`clean`** (dulu `409`).
- Branch di-checkout + tree kotor/bukan-ff → `409` pesan actionable (dulu selalu `409`, kini hanya kasus ini).

Tak ada perubahan skema, tak ada endpoint baru, tak ada perubahan frontend (`integrateSpec` sudah menangani `clean`/`conflict`/error).

## Tes

- `server/test/integrate.test.ts`:
  - Ganti "→ lokal branch yang sedang di-checkout (main) → 409" menjadi: **clean + `main` maju ke commit merge** (working tree factory bersih).
  - Tambah: branch di-checkout dengan working tree **kotor bertabrakan** → `409`.
  - Kasus `local:staging` (tak di-checkout) tetap clean.
  - Conflict → local: `finalize` instruction memakai `merge --ff-only`, bukan `git branch -f` (bila branch di-checkout).
- `server/test/specs.route.test.ts`: opsional — pastikan route meneruskan `clean` untuk `local:main`.

## Docs (SoT)

`internal/docs/architecture/api-contract.md` baris 61-62: perbarui deskripsi finalisasi merge→lokal (branch -f untuk tak-checkout, ff-only untuk checkout bersih, 409 untuk kotor/bukan-ff).

## Non-goals

- Tidak menambah UI/opsi baru di `IntegrateDialog`.
- Tidak mengubah alur rebase atau merge→origin.
- Tidak menangani konflik merge→lokal secara otomatis (tetap lewat sesi claude di worktree isolasi, hanya instruksi finalisasi-nya yang diperbaiki).
