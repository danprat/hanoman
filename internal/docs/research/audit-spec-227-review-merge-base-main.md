# Audit SPEC-227 — Review diff 500 `Not a valid object name main`

Status: audit · SPEC-227 · sumber qa · prioritas tinggi · severity major · 2026-07-19
Metode: `superpowers:systematic-debugging` (root cause dulu, baru fix).

## Keluhan (verbatim)
> `GET http://127.0.0.1:8788/api/specs/SPEC-226/review` (di local prod device)
> ```json
> { "statusCode": 500, "code": "128", "error": "Internal Server Error",
>   "message": "Command failed: git merge-base --end-of-options main HEAD\nfatal: Not a valid object name main\n" }
> ```
> Langkah: Buka Terminal → pilih Terminal → klik review.
> Expected: "saya dapat melihat diff dan melakukan review".

## Temuan inti (root cause)
`mergeBase` di `server/src/services/spec-review.ts:52` men-hardcode fallback `branchFrom || "main"`:

```ts
const { stdout } = await exec("git", ["merge-base", "--end-of-options", branchFrom || "main", "HEAD"], { cwd: wt, ...GIT });
```

Untuk backlog dengan `branchFrom` = `null` (default project, SPEC-143) fallback jatuh ke string
literal `"main"`. Bila repo target **tidak punya branch bernama `main`** (default `master`/`develop`,
atau repo hasil clone/sync yang branch defaultnya lain), `git merge-base main HEAD` keluar dengan
status **128** dan `fatal: Not a valid object name main` — persis keluhan, dan Fastify membungkusnya
jadi 500 (`code: "128"`).

Jalur review worktree-hidup adalah **satu-satunya** yang masih memakai literal `"main"`. Jalur
pembuatan worktree sudah **belajar pelajaran ini** di SPEC-197 (`server/src/routes/terminal.ts:79-88`):
- fallback pakai `"HEAD"`, **bukan** `"main"` — komentar eksplisit "repo target belum tentu punya
  branch bernama main (default bisa master/develop)";
- commit fork hasil `addWorktree` **dipersist** ke `spec.baseSha` (SPEC-176/ADR-0030) — inilah titik
  fork sesi yang tepat, yang **selalu resolve** (baru saja dibuat), tak peduli nama branch default.

Review tinggal memakai `spec.baseSha` itu, tapi tak pernah di-update sejak SPEC-197 → tetap `"main"`.

## Reproduksi (git murni, tanpa server/DB)
Repo default branch `master`, worktree detached, tanpa `main`:
```
git init -b master; commit base; git worktree add --detach .wt master
git -C .wt merge-base --end-of-options main HEAD   → exit 128, "fatal: Not a valid object name main"   ← keluhan
git -C .wt merge-base --end-of-options <baseSha> HEAD → exit 0, mengembalikan fork sha                  ← fix
```

## Keputusan pasca-audit
Temuan **berconfidence tinggi**, akar masalah **jelas & sempit**, perbaikan **diff kecil & terlokalisasi**
(satu service + dua pemanggil route). Karena itu **Spec & Plan di-`skipped`** (ADR-0020/0040) dan
langsung Execute; dokumen ini jadi doc-of-record perbaikannya.

Tidak ada perubahan kontrak API (endpoint & bentuk response sama; kini 200 di tempat yang dulu 500),
tidak ada perubahan data-model, tidak ada migration. Bukan titik keputusan manusia.

## Perbaikan
`mergeBase` tak lagi hardcode `"main"`. Basis diff dipilih dari kandidat berprioritas, dan **hanya
yang benar-benar resolve** yang dipakai (probe `rev-parse --verify`), dengan `HEAD` sebagai jaring
pengaman terakhir agar review **tak pernah 500**:

1. `spec.baseSha` — commit detach worktree (SPEC-176/ADR-0030). Titik fork sesi yang tepat, selalu
   resolve. `merge-base(baseSha, HEAD)` = `baseSha` pada kasus normal (HEAD keturunan baseSha),
   tetap benar bila HEAD sempat divergen.
2. `branchFrom` — bila diset eksplisit tapi baseSha entah kenapa kosong (worktree pra-persist).
3. `main` → `master` — default repo umum (kompat mundur: repo dev yang punya `main` tetap identik).
4. `HEAD` — jaring pengaman; `merge-base(HEAD, HEAD)` = HEAD → diff = perubahan tak-commit, bukan 500.

`spec.baseSha` di-thread dari route (`server/src/routes/specs.ts`) ke `specReview`/`reviewFile`.
`--end-of-options` dipertahankan (SPEC-197: basis dari DB bisa berbentuk `-`).

## Referensi
- `server/src/services/spec-review.ts` (`mergeBase`, `specReview`, `reviewFile`) — situs perbaikan
- `server/src/routes/terminal.ts:79-88` — referensi pola SPEC-197 (fallback HEAD + persist baseSha)
- `server/src/routes/specs.ts:215-240` — route `/specs/:id/review[/*]`, sumber `spec.baseSha`
- [ADR-0030 — `Spec` menyimpan baseSha/headSha](../adr/0030-spec-menyimpan-base-head-sha.md)
- [ADR-0019 — SHA disimpan, diff diturunkan](../adr/0019-sha-disimpan-diff-diturunkan.md)
