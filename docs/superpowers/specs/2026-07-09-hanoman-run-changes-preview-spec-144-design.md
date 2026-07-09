# SPEC-144 — Runs menampilkan changes yang dibuat hanoman

**Status:** design · objective dikunci 2026-07-09
**Date:** 2026-07-09
**Objective:** [`internal/docs/operations/spec-144-run-changes-preview-objective.md`]
**Brainstorm:** [`docs/superpowers/specs/2026-07-09-hanoman-run-changes-preview-spec-144-brainstorm.md`]

## Objective

Layar Runs menampilkan seluruh perubahan yang dibuat hanoman pada run itu — daftar file,
commit-commitnya, dan preview isi source-nya — realtime selagi run berjalan dan tetap terbaca
setelah run selesai. Hanya perubahan milik run tersebut.

## Why

Panel "File berubah" sudah terpasang dan tak pernah punya produsen. `kind: "file"` dideklarasikan
di `runner/src/types.ts:35` dan `src/src/api/client.ts:58`, dipersistensikan di
`server/src/runner/events-io.ts:63`, dirender `FileDiff` (`RunsScreen.tsx:96`), dibaca verb terminal
`files`/`diff` (`routes/runs.ts:44`) — dan **tidak pernah dipancarkan** `runOne`. `Run.files`
selamanya `[]`.

## Decisions (locked)

| Keputusan | Pilihan |
|---|---|
| Penyimpanan | `Run.baseSha String?` + `Run.headSha String?` — penunjuk, bukan isi |
| Isi diff | Diturunkan dari git tiap request; tidak pernah disimpan |
| `Run.files` | **Dibuang** bersama `kind: "file"` — ia salinan yang dapat dihitung ulang |
| Enumerasi | Index sementara + `git add -A -N` (lihat *Amandemen 1*) |
| Sumber saat run hidup | Worktree (`base..HEAD` + perubahan belum di-commit) |
| Sumber saat run `done` | Object database (`baseSha..headSha`) |
| Gerbang path | `*path` wajib ada di daftar `GET /runs/:id/changes` |
| Preview | `diff` unified **dan** `content` penuh, dipotong 256 KB + `truncated` |
| Realtime | Poll `GET /runs/:id/changes` tiap 5 dtk selama panel run aktif terbuka |
| Skema | Migration Prisma + ADR baru (nomor dialokasikan saat Execute) |

## Amandemen terhadap objective (temuan fase Spec)

### Amandemen 1 — `git add -A` menulis object pada setiap GET

Objective mengunci enumerasi lewat `GIT_INDEX_FILE=<temp> git add -A` + `git diff --cached --numstat <base>`.
Perintah itu **benar hasilnya, salah efek sampingnya**: `git add` menghash isi file dan menulis blob
ke `.git/objects`. Sebuah endpoint `GET` yang di-poll akan menumbuhkan object database repo pengguna.
Diukur di repo temp — 3 file berubah, 3 object baru.

Gantinya **`git add -A -N`** (*intent-to-add*): ia mencatat niat tanpa menghash isi, lalu
`git diff --numstat <base>` (working tree, **bukan** `--cached`) tetap memuat file untracked dengan
hitungan baris yang benar. Diverifikasi berdampingan — `--numstat` dan `--name-status` menghasilkan
keluaran **identik** dengan varian `add -A`:

```
-   -   b.bin          A  b.bin
0   1   gone.txt       D  gone.txt
1   0   keep.txt       M  keep.txt
1   0   new file.md    A  new file.md
```

Biayanya tepat **satu** object: blob kosong `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`, ditulis sekali
lalu idempoten — tiga pass berturut-turut menahan jumlah object di angka yang sama. Index worktree yang
hidup tetap tak tersentuh (diverifikasi lewat `git status --porcelain` sebelum/sesudah).

Sisa kriteria "File baru wajib terlihat" tetap berlaku utuh, termasuk keharusan
`git rev-parse --git-path index` — pada worktree tertaut `.git` adalah **file**, dan index-nya duduk di
`<gitdir>/worktrees/<name>/index`.

### Amandemen 2 — `services/scan.ts` justru presedennya

Objective menulis: *"`services/scan.ts` dan `services/branches.ts` bukan preseden yang boleh diikuti
di sini."* Untuk `scan.ts` itu **keliru**. `listRepoDocs` (`server/src/services/scan.ts:16`) sudah
memakai `execFile` yang di-promisify dengan `maxBuffer: 1 << 24`, dan komentarnya menyebutkan alasan
yang persis sama:

> `execFile`, not `spawnSync`: GET /projects scans once per project, and a blocking fork would stall
> the whole server.

`scan.ts` adalah preseden yang **harus** diikuti — termasuk `maxBuffer: 1 << 24`-nya. Hanya
`services/branches.ts` (masih `spawnSync`) yang bukan.

## Architecture

### 1. Data model

```prisma
model Run {
  // …
  commitSha String?   // (tak berubah) commit PEMICU dari webhook — bukan milik run
  baseSha   String?   // commit tempat worktree di-detach
  headSha   String?   // commit setelah commitAndPush berhasil
  // files  Json      ← DIBUANG
}
```

Migration `run_base_head_sha_drop_files`: dua `ADD COLUMN … TEXT` nullable + satu `DROP COLUMN "files"`.
Tanpa backfill — baris `Run` lama menjadi `baseSha: null`, dan endpoint menjawabnya dengan hasil kosong
yang jujur, bukan 500.

`shared/src/entities.ts` — `zRun` kehilangan `files`, bertambah
`baseSha: z.string().nullable()`, `headSha: z.string().nullable()`.
`server/src/queue.ts:48` berhenti men-seed `files: []`.

### 2. Menangkap kedua SHA

`GitOps` berubah tipe; keduanya sudah menghitung SHA-nya, hanya belum menyerahkannya:

```ts
// runner/src/types.ts
addWorktree(repo, path, branchFrom, reuse?): string | undefined;  // baseSha; undefined saat reuse
commitAndPush(worktreePath, message, branchTo, remoteUrl?): string;  // headSha
```

```ts
// runner/src/git.ts
addWorktree: (repo, path, branchFrom, reuse) => {
  if (reuse && existsSync(…)) return undefined;   // resume: baseSha sudah ada di baris Run
  // …reclaim seperti sekarang…
  const base = resolveCommit(repo, branchFrom);   // sudah dipanggil hari ini, tinggal disimpan
  git(repo, ["worktree", "add", "--detach", path, base]);
  return base;
},
commitAndPush: (path, message, branchTo, remoteUrl) => {
  // …persis seperti sekarang…
  return git(path, ["rev-parse", "HEAD"]).trim();
},
```

`reuse` mengembalikan `undefined`, **bukan** `resolveCommit(repo, branchFrom)` lagi: pada run yang
di-`resume`, `branchFrom` mungkin sudah bergerak, dan basis yang benar adalah basis semula.

`runOne` memancarkan satu event baru:

```ts
| { kind: "commit"; base?: string; head?: string }
```

— `{ base }` setelah `addWorktree` (hanya bila ia mengembalikan SHA), `{ head }` setelah
`commitAndPush`, sebelum `removeWorktree`. `persistEvent` menulis `baseSha` **hanya bila masih null**,
sehingga `resume` tak pernah menimpanya.

#### Invarian yang membuat desainnya bekerja

`runOne` memanggil `commitAndPush` → `removeWorktree` → `status: done`, semuanya berurutan tanpa
`try` (`run.ts:111-113`); run gagal/berhenti `return` sebelum baris 111. Maka:

> **worktree ada ⟺ `headSha` belum ada.**

Diverifikasi terhadap DB dan disk nyata hari ini: `RUN-8801..8803` berstatus `done` dan worktree-nya
sudah tidak ada di `.worktrees/`; `RUN-8804` masih `running` dan worktree-nya ada. Tidak ada kondisi
di mana keduanya hilang bersamaan kecuali worktree dipangkas dari luar — kasus yang ditangani sebagai
error eksplisit, bukan daftar kosong.

### 3. Service — `server/src/services/run-changes.ts`

```ts
export type ChangedFile = { path: string; add: number; del: number; status: "A"|"M"|"D"; binary: boolean };
export type RunChanges  = { base: string|null; head: string|null;
                            commits: { sha: string; subject: string }[]; files: ChangedFile[] };
```

`execFile` di-promisify, `maxBuffer: 1 << 24` — mengikuti `scan.ts` (*Amandemen 2*).

**Dua sumber, satu bentuk keluaran.** Selisih di antara keduanya hanya `cwd`, argumen revisi, dan
perlu-tidaknya index sementara:

| | run hidup (worktree ada) | run `done` (worktree hilang) |
|---|---|---|
| cwd | `<repoDir>/<run.worktree>` | `repoDir` |
| index | salinan sementara + `git add -A -N` | — |
| numstat | `git diff --numstat -z --no-renames <base>` | `… <base> <head>` |
| name-status | `git diff --name-status -z --no-renames <base>` | `… <base> <head>` |
| commits | `git log --format=… <base>..HEAD` | `… <base>..<head>` |

- **`-z`** wajib: tanpa itu git mengutip path yang memuat spasi. Format `--numstat -z` adalah
  `add \t del \t path \0`; `--name-status -z` adalah `status \0 path \0` (diverifikasi).
- **`--no-renames`**: rename akan mengubah bentuk record menjadi tiga field dan memecahkan whitelist
  path. Rename tampil sebagai `D` + `A` — lebih verbose, tetapi path-nya stabil.
- **`binary`** dikenali dari `-`/`-` pada `--numstat`. Parser wajib mengecek ini **sebelum** `Number()`;
  tanpa itu panel menampilkan `+NaN −NaN`.
- **`add`/`del` dan `status` datang dari dua perintah** — `--numstat` tak dapat membedakan `A` dari `M`
  (keduanya bisa berdel `0`). Digabung per path.

**Index sementara** — satu helper, dipakai ulang oleh ringkasan dan preview:

```ts
async function withTempIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const { stdout } = await exec("git", ["rev-parse", "--git-path", "index"], { cwd: wt });
  const tmp = join(await mkdtemp(join(tmpdir(), "hanoman-idx-")), "index");
  await copyFile(stdout.trim(), tmp);
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  try { await exec("git", ["add", "-A", "-N"], { cwd: wt, env }); return await fn(env); }
  finally { await rm(dirname(tmp), { recursive: true, force: true }); }
}
```

`.gitignore` repo memuat `.worktrees`, `node_modules`, `dist` — jadi `add -A -N` tidak pernah menuruni
worktree bersarang maupun dependency.

### 4. Preview satu file

`runChangeFile(run, repoDir, path)`:

1. Hitung `runChanges(...)`, cari `path` di dalam `files`. **Tidak ketemu → 404.** Ini satu-satunya
   validasi path yang ada, dan ia menutup path traversal sekaligus menegakkan *"hanya perubahan pada
   run tersebut"*. Tak ada `resolve()`-dan-bandingkan-prefix terpisah yang bisa ikut basi.
2. `binary` → `{ binary: true, diff: null, content: null }`.
3. `diff` — hidup: `git diff <base> -- <path>` di dalam `withTempIndex`; `done`: `git diff <base> <head> -- <path>`.
4. `content` — status `D` → `null`; hidup: baca `<worktree>/<path>` dari disk; `done`:
   `git show <head>:<path>`.
5. `diff` dan `content` masing-masing dipotong di **256 KB**; `truncated: true` bila salah satu
   terpotong. Memotong tanpa penanda tidak pernah boleh — pembaca akan mengira file berakhir di situ.

### 5. API

| Route | Perilaku |
|---|---|
| `GET /runs/:id/changes` | `{ base, head, commits, files }` |
| `GET /runs/:id/changes/*` | `{ path, status, binary, truncated, diff, content }` |

```
paths.runChanges     = (id) => `${API}/runs/${id}/changes`
paths.runChangeFile  = (id, path) => `${API}/runs/${id}/changes/${path}`
```

Wildcard `*` mengikuti `GET /projects/:id/docs/*` (`routes/docs.ts:8`) persis.

Kode status — **setiap kondisi dijawab, tak ada yang jatuh ke daftar kosong yang menipu**:

| Kondisi | Jawaban |
|---|---|
| run tak ada | `404 { error: "not found" }` |
| `baseSha` null (queued, atau baris pra-migration) | `200 { base: null, head: null, commits: [], files: [] }` |
| project tanpa `repoDir` | `409 { error: "project tanpa repoDir" }` |
| worktree hilang **dan** `headSha` null | `409 { error: "worktree run sudah tidak ada dan run tidak pernah commit" }` |
| `headSha` ada tapi objek tak terjangkau (`git cat-file -e <sha>^{commit}` gagal) | `409 { error: "commit tak terjangkau: <sha>" }` |
| `*path` di luar daftar changes | `404 { error: "not found" }` |

Baris keempat bukan hipotesis: worktree sebuah run **dapat** dipangkas dari luar selagi run berjalan.
Daftar kosong di sana terbaca sebagai *"hanoman tidak mengubah apa pun"*.

### 6. Satu sumber untuk semua pembaca

Verb terminal `files` dan `diff` (`routes/runs.ts:44`) berhenti membaca `run.files` dan memanggil
`runChanges` yang sama. `runCommand` sudah `async`, jadi tak ada perubahan bentuk. Menambal `FileDiff`
saja meninggalkan terminal run tetap menjawab *"belum ada file berubah"* pada run yang menyentuh 30 file.

### 7. Web

- `api/client.ts` — `runChanges(id)`, `runChangeFile(id, path)`. `RunLiveEvent` kehilangan
  `kind: "file"`; `reduceRunEvent` (`screens/run-reduce.ts`) kehilangan cabangnya.
- `RunsScreen.tsx`
  - `FileDiff` menerima `RunChanges`, bukan `run.files`. Baris file dapat diklik.
  - Panel preview: tab **Diff** | **Source**. `diff` diwarnai per baris awalan `+`/`−`/`@@`; `content`
    tampil apa adanya. Keduanya di `--surface-code` dengan `--font-mono`, mengikuti `LogView`.
    `binary` → `StateBlock` "berkas biner"; `truncated` → catatan kaki eksplisit.
  - Kartu **Commits**: `sha` pendek + subject.
  - `hasWork` (`:240`) dipecah: `PlanSteps` hanya bila `plan.length > 0`; kartu changes berdiri sendiri.
    Tanpa ini, setiap run akan menampilkan kartu "Plan · 0 langkah".
  - Realtime: `useEffect` mem-fetch changes saat run terpilih berubah, lalu `setInterval` 5 dtk selama
    `isRunActive(run.status)`. Satu mekanisme, bukan dua.
    `// ponytail: poll 5 dtk; pindah ke event bila panel run aktif jadi mahal.`

Poll-nya sengaja **tidak** digantung pada event SSE `log`: satu fase menghasilkan puluhan baris log per
menit, dan tiap baris akan memicu empat spawn git.

## Out of scope

- **`Run.plan` dan `PlanSteps`** — sama-sama mati, utang brief lain. Di sini hanya gate `hasWork`
  yang dipecah.
- **Commit `hanoman <flow> <specId>` tidak ada di history.** `git log --all --grep` tidak menemukan
  satu pun, padahal `RUN-8801..8803` berstatus `done` (yang mensyaratkan `commitAndPush` sukses) dan
  worktree-nya sudah dihapus. Branch run pun sudah tidak ada: `git for-each-ref` hanya menyisakan
  `main` + `origin/{HEAD,main}`. Penjelasan yang konsisten: commit itu dibuat dan **di-push ke origin**,
  lalu ref lokalnya dibersihkan, sementara merge ke `main` mengambil tip yang lebih awal. Ini tidak
  memengaruhi SPEC-144 — `headSha` diambil dari `git rev-parse HEAD` **sesudah** `commitAndPush`, dan
  invarian *worktree ada ⟺ headSha belum ada* tetap berdiri. Tercatat karena ia mengganggu siapa pun
  yang mencoba menemukan kembali pekerjaan sebuah run lewat pesan commit-nya.
- **`git commit` melempar saat tak ada yang di-staging.** Diverifikasi: exit 1. `commitAndPush` tidak
  menjaganya. Bila suatu run menyerahkan worktree yang seluruhnya sudah ter-commit oleh agen, ia gagal
  **setelah** semua fase `done` — bentuk yang sama dengan bug push yang sudah diperbaiki di `4af01dd`.
  SPEC-144 tidak memperbaikinya dan tidak bergantung padanya: run seperti itu berakhir `failed` dengan
  worktree utuh, sehingga jalur "run hidup" tetap menyajikan seluruh changes-nya.
- Mengedit file dari panel changes; diff antar-run; menahan worktree agar tidak dihapus; branch remote.

## Risiko yang diterima

- **Empat spawn git per ringkasan** (`rev-parse`, `add -N`, dua `diff`) plus satu `git log`, tiap 5
  detik selama panel run aktif terbuka. Pada repo ini `git diff` ≈ 20 ms dan semuanya async, jadi event
  loop tidak berhenti — tetapi ini plafon yang dinamai, bukan yang diabaikan.
- **Berkas biner tak dapat di-review** dari dashboard. Diterima (keputusan terkunci #2).
- **Rename tampil sebagai `D` + `A`.** Diterima demi path yang stabil.
- **Blob kosong** `e69de29…` ditulis sekali ke object database repo pengguna oleh `add -A -N`. Ia sudah
  ada di hampir setiap repo git.

## Testing

- **`run-changes` (repo temp)** — file baru untracked muncul dengan hitungan baris nyata (ini regresi
  yang paling mungkin: `git diff --numstat <base>` polos **melewatkannya**, tanpa error); file terhapus
  → `D` + `content: null`; berkas biner → `binary: true`, tanpa `diff`; file tracked termodifikasi →
  `+n −m`; path berspasi utuh berkat `-z`.
- **Index & object database tak tercemar** — `git status --porcelain` identik sebelum/sesudah; jumlah
  loose object bertambah paling banyak satu (blob kosong) dan **tidak bertambah lagi** pada pemanggilan
  kedua dan ketiga.
- **Jalur `done`** — repo temp dengan `base` + `head` commit dan tanpa worktree: diff dibaca dari object
  database.
- **Gerbang path** — `changes/<file di luar daftar>` → 404; `changes/../../etc/passwd` → 404.
- **Pemotongan** — `content` > 256 KB → dipotong + `truncated: true`.
- **Kode status** — `baseSha` null → 200 kosong; `headSha` tak terjangkau → 409; worktree hilang tanpa
  `headSha` → 409.
- **`GitOps` palsu** di `runner/test/run.test.ts` menyesuaikan tipe kembalian baru; `runOne` memancarkan
  `{ kind: "commit", base }` lalu `{ kind: "commit", head }` dalam urutan itu, dan **tidak** memancarkan
  `base` saat `reuse`.
- **`persistEvent`** — `baseSha` tidak pernah ditimpa bila sudah terisi.
- **Terminal** — verb `diff` pada run dengan changes nyata merender barisnya, bukan "belum ada file berubah".
- **Smoke lokal nyata** (CLAUDE.md) — boot server, `curl GET /api/runs/RUN-8804/changes`, lalu
  `curl GET /api/runs/RUN-8804/changes/internal/docs/README.md`, konfirmasi `diff` + `content` nyata.

## Open questions

**Terjawab di fase ini:**

- `git add -A` di index sementara → **dibatalkan**, menulis blob per file berubah pada setiap GET.
  Diganti `git add -A -N`. Objective diamandemen (*Amandemen 1*).
- `scan.ts` preseden atau bukan → **preseden**, dan objective keliru menyebut sebaliknya
  (*Amandemen 2*).
- Bagaimana `A` dibedakan dari `M` → `--name-status`, digabung dengan `--numstat` per path.
- Rename → `--no-renames`.

**Masih menunggu manusia** (dikunci dengan default, dapat dibalik sebelum Execute):

- Interval poll 5 detik untuk "realtime". Konsekuensi yang diterima: perubahan tampil hingga 5 detik
  setelah terjadi, dan panel yang terbuka membakar empat spawn git tiap interval.
- Preview mengembalikan `diff` **dan** `content` sekaligus; UI memilih tab.
- Berkas biner tidak dapat di-review; batas potong 256 KB.
