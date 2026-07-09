# ADR-0019 — SHA disimpan, diff diturunkan

**Status:** accepted · **Date:** 2026-07-09 · **Spec:** SPEC-144

## Context

`Run.files` dan event `kind: "file"` sudah terpasang sejak SPEC-008 — tipe di
`runner/src/types.ts`, kolom `Run.files Json`, cabang di `persistEvent`, panel `FileDiff` di
`RunsScreen` — dan tak pernah punya produsen. `runOne` tidak pernah memancarkan `kind: "file"`;
dicari di seluruh repo, dua kemunculan string itu keduanya deklarasi tipe. `Run.files` selamanya
`[]`, dan verb terminal `files`/`diff` selalu menjawab *"belum ada file berubah"* — kalimat yang
salah, bukan kalimat yang kosong.

Menghidupkan kabel yang sudah terpasang juga akan salah: `persistEvent` menulis `files`
**append-only**, jadi file yang disunting dua kali muncul dua baris, dan file yang disunting lalu
dikembalikan terdaftar selamanya. Ia hanya mencatat `+n −m`, tak pernah bisa menyajikan preview
isi source seperti yang diminta brief.

Fakta git yang membentuk keputusan, diverifikasi terhadap repo ini pada 2026-07-09:

- Worktree run lahir *detached* pada satu commit — `git worktree add --detach <path>
  <resolveCommit(branchFrom)>`.
- Run yang sukses memanggil `commitAndPush` lalu `removeWorktree` — worktree-nya lenyap.
- `commitAndPush` tidak pernah membuat branch lokal saat `origin` ada; ia hanya `git push origin
  HEAD:refs/heads/<branchTo>`. Repo ini punya `origin` nyata, dan `git for-each-ref` hanya
  menyisakan `main` + `origin/{HEAD,main}` — nol ref `hanoman/run-*` — padahal `git log` memuat
  merge dari branch-branch itu. Branch run dihapus setelah di-merge.

Konsekuensinya: **setelah run sukses, tidak ada worktree dan tidak ada branch.** Sebuah diff yang
dihitung belakangan terhadap `branchFrom...branchTo` menunjuk ref yang sudah tidak ada.

## Decision

Simpan **penunjuk**, turunkan **isinya**. Dua kolom nullable baru pada `Run`: `baseSha` (commit
tempat worktree di-detach, ditulis `addWorktree`) dan `headSha` (commit setelah `commitAndPush`
berhasil). Isi diff — daftar file, commit, dan preview source — **tidak pernah disimpan**;
`server/src/services/run-changes.ts` menghitungnya dari git tiap request:

- Selagi worktree run masih ada (`queued`…`running`, `paused`, `failed`, `stopped`): dibaca dari
  worktree, `base..HEAD`. File baru masih untracked, dan `git diff --numstat <base>` polos
  *melewatkannya tanpa error* — regresi paling mahal di seluruh desain ini. Enumerasi memakai
  index sementara (`git rev-parse --git-path index`, disalin, `GIT_INDEX_FILE=<temp> git add -A
  -N`), bukan `git add -A`: yang terakhir menghash isi dan menulis satu blob ke `.git/objects`
  untuk setiap file berubah, pada setiap `GET`.
- Setelah worktree hilang (`done`): dibaca dari object database repo, `baseSha..headSha`.

Bifurkasinya bersih karena `runOne` memanggil `commitAndPush` → `removeWorktree` → `status: done`
berurutan tanpa `try`, dan run gagal/berhenti `return` sebelum baris itu — sehingga **worktree ada
⟺ `headSha` belum ada**. `GET /runs/:id/changes` dan `GET /runs/:id/changes/*path` menyajikan
ringkasan lalu preview per file, mengikuti preseden `GET /projects/:id/docs`. Daftar file yang
mengisi panel adalah satu-satunya gerbang path — `*path` di luar daftar itu tidak pernah dibaca
dari disk. Kolom `Run.files` dibuang bersama `kind: "file"` di `RunEvent`, cabangnya di
`persistEvent`, dan tipenya di klien.

## Consequences

- Empat spawn git per ringkasan (`rev-parse`, `add -N`, dua `diff`) plus satu `git log`, dipanggil
  async (`execFile`, bukan `spawnSync` — mengikuti `services/scan.ts`) tiap poll 5 detik selama
  panel run aktif terbuka.
- Berkas biner tak dapat di-review dari dashboard; rename tampil sebagai `D` + `A` (`--no-renames`,
  agar path tetap stabil sebagai gerbang).
- `git add -A -N` menulis tepat satu object — blob kosong `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`
  — ke object database repo pengguna, sekali lalu idempoten.
- `headSha` yang objeknya tak lagi terjangkau (branch dihapus sebelum di-merge, lalu `git gc`)
  dijawab `409` yang menyebut sha-nya, bukan daftar kosong yang terbaca seperti "hanoman tidak
  mengubah apa pun".
- Menajamkan batas [ADR-0011](0011-docs-realtime-filesystem.md) dan
  [ADR-0018](0018-coverage-nilai-turunan.md): nilai turunan tidak disimpan, tetapi penunjuk ke
  sebuah momen yang **tak dapat direkonstruksi** — worktree dan branch-nya bisa lenyap — harus
  disimpan. `coverage` dapat dihitung ulang dari disk kapan pun; sebuah commit SHA tidak, begitu
  worktree dan branch-nya hilang.

## Alternatif yang ditolak

- **Mengisi `Run.files` lewat event.** Salinan DB yang append-only, dan tak pernah bisa
  menyajikan preview source.
- **Menyimpan seluruh patch di kolom Json.** `GET /runs` akan menyeret megabyte tiap poll pada run
  yang menyentuh banyak file.
- **`git add -A` di index sementara** (usulan awal fase Spec). Menulis satu blob per file berubah
  ke object database repo pengguna pada setiap `GET` — efek samping yang tidak dapat diterima
  untuk endpoint yang di-poll. Diganti `git add -A -N` setelah diverifikasi menghasilkan
  `--numstat`/`--name-status` yang identik.
