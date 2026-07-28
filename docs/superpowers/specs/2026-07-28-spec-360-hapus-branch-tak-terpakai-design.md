# SPEC-360 — Hapus branch yang sudah tidak digunakan (satu tombol + bulk, local & origin)

**Tanggal:** 2026-07-28
**Sumber:** brief · prioritas tinggi
**Status:** design (disetujui lewat empat keputusan brainstorm)

## Objective

Operator hanoman bisa **melihat** branch mana yang sudah ter-merge ke branch utamanya
(mis. `hanoman/spec-352` yang sudah masuk `main`) dan **menghapusnya** — satu tombol per
baris, atau bulk untuk banyak branch sekaligus — mencakup **local dan origin**, tanpa
pernah bisa menghapus branch yang masih dipakai.

## Masalah

`POST /projects/:id/git { op:"delete-branch" }` sudah ada sejak SPEC-206: bisa menghapus
local, origin, atau keduanya. Yang tidak ada:

1. **Penemuan.** Tak ada satu pun jalur yang menjawab "branch mana yang sudah ter-merge?".
   Operator harus mengingat sendiri, atau memburu pill branch di Git Graph satu per satu
   lewat klik-kanan. Repo hanoman sendiri punya puluhan branch `hanoman/spec-*` yang sudah
   masuk `main` dan tak pernah dibersihkan.
2. **Bulk.** Aksi hapus hanya per-branch lewat context-menu. Membersihkan 30 branch =
   30 klik-kanan × 2 (local + origin).
3. **Pagar.** `delete-branch` polos meneruskan apa pun ke git. `git branch -d` menolak
   branch yang ter-checkout, tapi **tidak** menolak branch yang jadi target sesi tmux yang
   sedang jalan — sesi hanoman lahir `--detach` (ADR-0002), jadi `hanoman/spec-360` belum
   ada sebagai ref lokal sampai agen mem-push-nya, dan `origin/hanoman/spec-360` yang
   sudah ter-push bisa dihapus di tengah sesi tanpa satu pun peringatan.

## Empat keputusan (brainstorm)

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Tempat UI | Tab ketiga **"Branches"** di IDE Visual (`IdeScreen`), sejajar Explorer & Git Graph |
| 2 | Kriteria "tak terpakai" | Murni git: **ter-merge ke base**; base bisa dipilih, default = branch default repo |
| 3 | Kontrak API | Endpoint baru: `GET …/branches/unused` (read turunan) + `POST …/branches/delete` (bulk) |
| 4 | Pagar aman | Empat kunci: branch aktif & base · ter-checkout di worktree lain · Spec belum `done` · sesi tmux aktif |

## Arsitektur

Tiga unit, batas jelas, masing-masing bisa diuji sendiri.

### 1. `server/src/services/branch-cleanup.ts` (baru) — penemuan & eksekusi

Satu modul, dua fungsi publik. Tak menyentuh DB langsung; sinyal non-git (Spec, sesi)
masuk sebagai **parameter**, bukan import — supaya murni & mudah dites.

```ts
export type BranchLock = "current" | "base" | "worktree" | "spec-open" | "session";
export type BranchScope = "local" | "remote" | "both";
export type UnusedBranch = {
  name: string;            // tanpa prefix origin/
  local: boolean;          // ada di refs/heads DAN ter-merge ke base
  remote: boolean;         // ada di refs/remotes/origin DAN ter-merge ke baseRemote
  lastCommit: { sha: string; at: string; subject: string } | null;
  locks: BranchLock[];     // kosong = boleh dihapus
};
export type UnusedReport = {
  base: string; baseRemote: string | null; current: string; branches: UnusedBranch[];
};
export type DeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; error?: string };

export async function listUnusedBranches(
  repoDir: string | null,
  opts: { base?: string; openSpecBranches: Set<string>; sessionBranches: Set<string> },
): Promise<UnusedReport>;

export async function deleteBranches(
  repoDir: string,
  names: string[],
  opts: { scope: BranchScope; base?: string; openSpecBranches: Set<string>;
          sessionBranches: Set<string> },
): Promise<{ base: string; results: DeleteResult[] }>;
```

**Daftar itu SENDIRI adalah himpunan "tak terpakai"** — hanya branch ter-merge yang masuk.
Tak ada field `merged` (selalu `true`, jadi mubazir). Branch `base` & `current` **ikut
tampil** tapi ber-`locks`, supaya operator melihat alasannya alih-alih bertanya-tanya
mengapa `main` hilang.

**Resolusi base** (`resolveBase`): kandidat `[opts.base, "main", "master"]`, ambil yang
pertama benar-benar resolve; bila tak satu pun → branch aktif; bila detached → `"HEAD"`.
Pola `mergeBase` di `spec-review.ts` (SPEC-227). **Tak pernah** hardcode `"main"`: repo
target bisa `master`/`develop`.

**Penemuan merged**: `git branch --merged <base> --format=%(refname:short)` untuk local dan
`git branch -r --merged <baseRemote>` untuk origin, digabung per nama branch (tanpa prefix
`origin/`). `baseRemote` = `origin/<base>` bila resolve, else `<base>` — untuk ref origin,
"branch utamanya" adalah `origin/main`, bukan `main` lokal yang bisa tertinggal.
`origin/HEAD` selalu dibuang. Metadata commit terakhir dari satu
`git for-each-ref --format` (sha, tanggal ISO, subject) — tak ada N panggilan git per branch.

**Deteksi kunci**:
- `current` — hasil `git rev-parse --abbrev-ref HEAD`.
- `base` — nama base hasil resolusi (dan `origin/<base>`).
- `worktree` — `git worktree list --porcelain` → baris `branch refs/heads/<x>`.
- `spec-open` — nama ada di `openSpecBranches` (dipasok route).
- `session` — nama ada di `sessionBranches` (dipasok route).

**Eksekusi**: `deleteBranches` memanggil `listUnusedBranches` lebih dulu, lalu untuk tiap
nama mendelegasikan ke `runGitOp(repoDir, { op:"delete-branch", name, local, remote })`
yang sudah ada dan sudah bertest (SPEC-206). **Satu jalur hapus branch di seluruh
codebase** — tak ada `git branch -d` kedua yang bisa drift. Force **tidak pernah**
dipakai: hanya branch ter-merge yang sampai ke sini, jadi `-d` polos selalu cukup.

Ini memberi tiga invarian sekaligus, gratis:

1. **Hanya yang ter-merge bisa dihapus.** Nama yang tak muncul di laporan →
   `ok:false, error:"branch tak ditemukan di daftar ter-merge ke <base>"`. Klien tak bisa
   menyelundupkan branch sembarang lewat body.
2. **Kunci ditegakkan di jalur write**, bukan sekadar petunjuk UI. Branch ber-`locks` →
   `ok:false` dengan alasan.
3. **Scope dipersempit per branch.** Diminta `both` tapi branch hanya ada di local →
   jalankan `local` saja. Tak ada ref origin sama sekali & diminta `remote` → `scope:"none"`,
   `ok:false`, tanpa memanggil git.

Satu branch gagal **tidak** membatalkan sisanya — tiap baris punya hasilnya sendiri.
Batch selalu `200`; kegagalan hidup di baris, bukan di status HTTP.

### 2. `server/src/routes/ide.ts` (tambah 2 route) — perekat

```
GET  /projects/:id/branches/unused?base=   → UnusedReport
POST /projects/:id/branches/delete { names:string[], scope?, base? } → { base, results[] }
```

**Capability agent** (ADR-0065): `branches` bukan anggota `IDE_SUBS`, jadi kedua route
jatuh ke cabang `projects` — `projects:read` untuk GET, `projects:write` untuk POST.
Ini **sengaja dibiarkan**: `GET /projects/:id/branches` yang sudah ada memetakan begitu,
dan memasukkan `branches` ke `IDE_SUBS` akan diam-diam mengubah capability endpoint lama.
Dikunci dengan satu test agar pemetaan ini jadi keputusan, bukan kebetulan.

Route menyusun dua himpunan sinyal lalu meneruskannya ke service:

- `openSpecBranches` = `prisma.spec.findMany({ where:{ projectId, stage:{ not:"done" } } })`
  → `hanoman/<sanitize(spec.id)>` (reuse `sourceBranch` dari `integrate.ts` — satu sumber
  kebenaran nama branch spec, jadi tak bisa drift).
- `sessionBranches` = `listSessions()` project ini yang `!exited` → `s.branch` bila ada
  (sesi PRD `prd/<slug>`, breakdown), else `hanoman/<s.id>` bila `s.specId` ada.
  Sesi backlog lahir tanpa `opts.branch`, jadi cabang kedua ini **wajib** — tanpa itu
  `hanoman/spec-360` tak terlindungi saat sesinya jalan.

`POST` **tidak** memakai gerbang sesi-aktif global `touchesTree`: hapus branch adalah op
ref-only (ADR-0055) dan pagarnya sudah per-branch dan lebih tepat. Yang dikunci adalah
branch yang benar-benar dipakai, bukan seluruh project saat ada sesi apa pun.

### 3. `src/src/screens/BranchesPanel.tsx` (baru) + tab di `IdeScreen`

Komponen sendiri, bukan tambahan ke `GitGraph.tsx` (43 KB — sudah terlalu besar).

- Tabel: checkbox · nama branch · badge `local` / `origin` / `local+origin` ·
  commit terakhir (subject + relatif) · badge kunci (bila terkunci) · tombol **Hapus**.
- Header: selector **Base** (dari `api.listBranches`, default = `base` yang dikembalikan
  server) · checkbox "pilih semua yang boleh" · selector scope (`local+origin` default,
  `local saja`, `origin saja`) · tombol **Hapus terpilih (N)**.
- Baris terkunci: checkbox disabled + badge alasan berbahasa Indonesia
  (`branch aktif` / `base` / `dipakai worktree` / `backlog belum selesai` / `sesi aktif`).
- Konfirmasi lewat `ConfirmDialog` yang sudah ada — menyebut jumlah & scope.
- Hasil: ringkasan `N terhapus · M gagal`, baris gagal menampilkan `error` dari server.
- Kosong → `StateBlock` "Tak ada branch ter-merge" (bukan tabel kosong).

Design system: `Card`/`Button`/`Badge`/`Select`/`StateBlock` dari `../ds` — editorial,
bone paper, brass accent, tanpa CSS baru.

## Aliran data

```
IdeScreen(tab=branches)
  └─ BranchesPanel
       ├─ GET  /projects/:id/branches/unused?base=…
       │     route → prisma(Spec stage≠done) + listSessions()  ──┐
       │            └─ listUnusedBranches(repoDir, {base, …}) ←──┘ git branch --merged,
       │                                                          for-each-ref, worktree list
       └─ POST /projects/:id/branches/delete {names, scope}
             route → himpunan kunci yang sama → deleteBranches()
                     └─ per branch: git branch -d  /  git push origin --delete
             → results[] → panel reload + toast ringkasan
```

Semuanya **nilai turunan dari git tiap request** (ADR-0018/0011) — tak ada kolom DB, tak
ada cache, tak ada migration.

## Penanganan error

| Kondisi | Perilaku |
|---|---|
| Project tak ada | 404 (pola `repoOf` yang sudah ada) |
| Project tanpa `repoDir` | `GET` → `{ base:"", baseRemote:null, current:"", branches:[] }`; `POST` → 400 (cermin route git lain) |
| Bukan repo git / git error | Sama seperti di atas — `[]`, tak pernah melempar (cermin `refs()` di `branches.ts`) |
| `base` tak resolve | Fallback berurutan `main` → `master` → branch aktif → `HEAD`; `base` terpakai selalu ikut di respons |
| `names` kosong / bukan array | 400 `names wajib` |
| `scope` bukan local/remote/both | 400 `scope harus local, remote, atau both` |
| Nama tak ada di daftar ter-merge | Baris `ok:false, error:"branch tak ditemukan di daftar ter-merge ke <base>"` |
| Branch terkunci ikut dikirim | Baris `ok:false, error:"<alasan kunci>"` — batch lain tetap jalan |
| Scope diminta tak berlaku untuk branch itu | `scope:"none"`, `ok:false`, git tak dipanggil |
| `git branch -d` / `push --delete` gagal | Baris `ok:false` + stderr git; **tak** eskalasi ke `-D` |
| Repo tanpa remote `origin` | Branch tampil `remote:false`; scope `both` menyempit jadi `local` |

## Testing

**Server — `server/test/branch-cleanup.test.ts`** (repo git nyata di tmp, pola `git-ide.test.ts`):
merged vs belum-merged terpisah benar · branch origin-only terdeteksi · base non-`main`
(repo `master`) resolve · tiap kunci menghasilkan `locks` yang tepat · `deleteBranches`
menolak branch terkunci walau dipaksa di body · satu gagal tak menjatuhkan sisanya ·
scope `local`/`remote`/`both` menjalankan langkah yang benar.

**Server — `server/test/ide.route.test.ts`** (tambah): `GET …/branches/unused` 404 project
tak ada · bentuk respons · `openSpecBranches` mengunci `hanoman/<spec>` dari Spec belum
`done` · `POST` 400 tanpa `names` · bentuk `results`.

**Frontend — `src/test/branches-panel.test.tsx`**: render tabel + badge · baris terkunci
checkbox disabled · "pilih semua" melewati yang terkunci · bulk memanggil API sekali
dengan `names` yang benar · ringkasan hasil gagal/berhasil · state kosong.

TDD: test dulu, merah, baru implementasi (skill `test-driven-development`).

## Docs yang tersentuh (commit yang sama)

- `internal/docs/architecture/api-contract.md` — dua endpoint baru di blok Git graph parity.
- `internal/docs/adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md` — **ADR baru**:
  pagar proteksi per-branch adalah **pagar keselamatan data**, bukan guardrail eksekusi;
  ADR-0037 (guardrail dicabut) tetap utuh. Memperluas ADR-0055 (taksonomi op git),
  terkait ADR-0018/0011 (nilai turunan), ADR-0002 (sesi detach → butuh kunci sesi),
  ADR-0032 (keamanan argumen refname).
- `internal/docs/README.md` — tautan ADR-0077.
- `internal/docs/frontend/frontend-implementation.md` — tab Branches di IDE Visual.
- `internal/skills/hanoman/SKILL.md` — satu klausa di Aturan Arsitektur.

Nomor ADR **0077** diverifikasi lewat enumerasi `internal/docs/adr` di **seluruh** branch
local + origin (ADR-0021; maksimum terpakai = 0076).

## Yang sengaja TIDAK dikerjakan (YAGNI)

- **Deteksi squash-merge** (`git cherry` / patch-id). hanoman melakukan merge sungguhan
  lewat `integrateBranch`/`mergeIntoCurrent`, jadi `--merged` sudah menangkapnya.
  Repo yang di-squash lewat PR GitHub bisa menyusul di spec terpisah.
- **Kriteria "stale by age"** (branch tanpa commit > N hari). `merged` adalah sinyal yang
  aman; umur bukan.
- **Force delete (`-D`)**. Panel ini hanya menghapus yang sudah ter-merge; force tetap
  tersedia di context-menu Git Graph untuk operator yang benar-benar menginginkannya.
- **Auto-hapus setelah merge**. Sudah ada sebagai opsi `deleteBranch` di merge (SPEC-193).
- **Skema/migration apa pun.** Tak ada kolom baru; semuanya turunan.
