# SPEC-176 — desain: SHA start/end disimpan, review done men-diff darinya

**Sumber:** qa · **Prioritas:** tinggi · **Audit:** [operations/spec-176-review-file-changed-audit](../../../internal/docs/operations/spec-176-review-file-changed-audit.md)
· **ADR:** ADR-0030 (baru) memulihkan [ADR-0019](../../../internal/docs/adr/0019-sha-disimpan-diff-diturunkan.md) untuk era sesi.

## Objective

Backlog `done` harus tetap bisa di-review file-changed-nya. Diff memakai **SHA commit start
+ end** yang disimpan saat sesi berjalan — bukan nama branch, bukan grep pesan commit.

## Keputusan desain

Simpan **penunjuk**, turunkan **isi** (ADR-0019). Dua kolom nullable baru pada `Spec`:

- `baseSha` — commit tempat worktree sesi di-detach (`addWorktree` sudah menghitungnya).
- `headSha` — commit HEAD worktree tepat sebelum worktree dihapus di akhir sesi.

`base..head` di-diff dua-titik: karena `headSha` adalah tip worktree detached (= `baseSha` +
hanya commit sesi ini), range itu **persis** perubahan sesi tersebut — tak pernah over-report
history terjalin.

### Titik tangkap (sesi = "run" di era interaktif)

| Kapan | Di mana | Aksi |
|---|---|---|
| Sesi backlog dibuat | `terminal.ts` `POST /terminal/sessions` (`"spec" in body`) | `baseSha = realGit.addWorktree(...)` → `prisma.spec.update({ baseSha })` |
| Sesi backlog ditutup | `terminal.ts` `DELETE /terminal/sessions/:id` sebelum `removeWorktree` | `headSha = realGit.headSha(s.cwd)` → `prisma.spec.update({ headSha })` |

Keduanya **overwrite** tiap sesi: base = detach point sesi ini, head = tip sesi ini. Untuk
kasus umum satu-run, itu diff penuh backlog. Untuk reopen (SPEC-172), itu increment sesi
terakhir — jujur dan bersih, bukan campuran spec lain.

`realGit.headSha(cwd)` ditambahkan ke antarmuka `GitOps` (mirror `addWorktree` yang balikin
baseSha), supaya panggilan git tetap terkumpul di `runner/src/git.ts` dan terpakai apa adanya
oleh route (test terminal memakai git nyata).

### Resolusi review (done)

`resolveReview()` di `specs.ts`, saat worktree lenyap, urut prefer:

1. `spec.baseSha` **dan** `spec.headSha` ada **dan** dua-duanya masih terjangkau di object
   database (`shaResolvable`) → `specReviewRange(repoDir, baseSha, headSha)`.
2. Selain itu → fallback `specCommitRange` (grep) — kompat untuk spec lama tanpa SHA tersimpan.
3. Selain itu → `null` → 409.

`shaResolvable(repoDir, sha)` = `git cat-file -e <sha>^{commit}` (satu spawn, catch→false).
Menjaga: SHA yang objeknya sudah di-`git gc` (branch run dibuang sebelum di-merge) tak
menjatuhkan route ke 500 — ia lewat ke fallback/409, sesuai konsekuensi ADR-0019.

Bentuk respons `SpecReview = { base, files, changed }` **tidak berubah** → frontend
`ReviewScreen` tak tersentuh.

## Non-goals

- Tak menyimpan isi diff (tetap diturunkan tiap request).
- Tak mengubah live-review (worktree ada) — tetap `specReview` atas merge-base.
- Tak menyentuh frontend, shared, atau endpoint `/runs/*` yang sudah usang.

## Risiko & mitigasi

- **Shared dev DB drift:** kolom nullable additive — client lama tetap jalan (P2022 tak
  terpicu). Aman untuk worktree sibling.
- **Objek head ter-GC sebelum merge:** dijaga `shaResolvable` → fallback/409, bukan crash.

## Verifikasi (rencana test)

- `spec-review.test.ts`: `shaResolvable` true untuk commit ada / false untuk sha karangan.
- `terminal.route.test.ts`: setelah `start`, `spec.baseSha` terisi; setelah `DELETE`,
  `spec.headSha` terisi (git nyata → keduanya = init commit saat sesi tak commit apa-apa).
- `specs.route.test.ts` (bila ada): done-review pakai `baseSha/headSha` tersimpan (bukan grep),
  dan spec tanpa SHA jatuh ke grep.
- Boot server nyata + curl `GET /specs/:id/review` untuk spec ber-SHA.
