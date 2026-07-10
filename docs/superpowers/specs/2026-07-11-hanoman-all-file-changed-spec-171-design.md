# SPEC-171 — All File & File Changed (review layar backlog)

**Status:** design · disetujui 2026-07-11
**Date:** 2026-07-11
**Objective:** [`internal/docs/operations/spec-171-all-file-changed-objective.md`]

## Objective

Layar review full-width menampilkan **seluruh file project** (explorer ala VSCode) dan
**file yang berubah** untuk sebuah backlog item — supaya hasil kerja hanoman bisa di-review
sebelum di-merge. Sumbernya worktree backlog item; diturunkan dari git tiap request, tak disimpan.

## Why

Backlog item (`Spec`) dijalankan sebagai sesi `claude` di worktree `<repoDir>/.worktrees/<specid>`,
`--detach` di `branchFrom` (default `main`), commit ke `hanoman/<specid>`. Dashboard tak punya cara
melihat file yang disentuh sesi itu: `SpecDetail` cuma menampilkan objective + brief, dan satu-satunya
jendela ke pekerjaan adalah terminal mentah. SPEC-144 pernah mendesain "run changes preview" tapi tak
pernah dibangun (konsep Runs berubah jadi Backlog) — primitif git-nya masih relevan dan dipakai ulang
di sini.

## Decisions (locked)

| Keputusan | Pilihan |
|---|---|
| Sumber review | Worktree `<repoDir>/.worktrees/<specid>` — committed-on-top + uncommitted + untracked |
| Basis diff | `git merge-base <branchFrom‖main> HEAD` di worktree — fork point, **tanpa simpan SHA, tanpa migration** |
| All files | `git ls-files -z` ∪ `git ls-files --others --exclude-standard -z` — patuh `.gitignore` |
| Enumerasi changed | Index sementara + `git add -A -N`, `--numstat -z` ⊕ `--name-status -z` (dari SPEC-144) |
| Preview | `diff` unified **dan** `content` penuh, dipotong 256 KB + `truncated` |
| Gerbang path | `*path` wajib ada di (all ∪ changed); di luar → 404 (tutup path traversal) |
| Muat data | Sekali saat layar dibuka + tombol "Muat ulang" — **bukan** poll realtime |
| Skema | Tak ada perubahan skema, tak ada gate baru → **tak butuh ADR** |
| Mount UI | Layar Review full-width (Shell `wide`), dibuka dari tombol Review di backlog |

## Architecture

### 1. Service — `server/src/services/spec-review.ts`

`execFile` di-promisify, `maxBuffer: 1 << 24` (preseden `services/scan.ts:16`).

```ts
export type ChangedFile = { path: string; add: number; del: number; status: "A"|"M"|"D"; binary: boolean };
export type SpecReview  = { base: string; files: string[]; changed: ChangedFile[] };
export type ReviewFile  = { path: string; status: "A"|"M"|"D"|null; binary: boolean;
                            truncated: boolean; diff: string|null; content: string|null };
```

**Worktree lokasi** — deterministik dari spec, id-nya seperti di `pty.ts` (`idFor`):
`worktreeDir(repoDir, specId) = <repoDir>/.worktrees/<specId.toLowerCase().replace(/[^a-z0-9_-]/g,"_")>`.
Worktree tak ada → pemanggil menjawab 409 (bukan daftar kosong yang menipu).

**Basis** — `git merge-base <branchFrom‖main> HEAD` di dalam worktree. Fork point tahan terhadap
`branchFrom` yang bergerak setelah worktree lahir (`git diff main` polos akan salah menandai commit baru
`main` sebagai penghapusan). `branchFrom` diambil dari `spec.branchFrom`; null → `main`.

**All files** — `git ls-files -z` (tracked) ∪ `git ls-files --others --exclude-standard -z` (untracked
tak-ignored), **minus `git ls-files --deleted -z`** (file yang dihapus dari working tree masih tercatat
di index, jadi `ls-files` polos tetap menyebutnya — ia tampil di panel Changed, bukan di pohon file,
persis explorer VSCode). `.gitignore` repo memuat `.worktrees`, `node_modules`, `dist` → tak menuruni
worktree bersarang maupun dependency. Digabung, di-dedup, di-sort.

**Changed** — pakai ulang mekanik SPEC-144 §3, cabang "worktree" saja:

```ts
async function withTempIndex<T>(wt: string, fn: (env) => Promise<T>): Promise<T> {
  const gitIndex = (await exec("git", ["rev-parse", "--git-path", "index"], { cwd: wt })).stdout.trim();
  const tmp = join(await mkdtemp(join(tmpdir(), "hanoman-idx-")), "index");
  await copyFile(gitIndex, tmp);
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  try { await exec("git", ["add", "-A", "-N"], { cwd: wt, env }); return await fn(env); }
  finally { await rm(dirname(tmp), { recursive: true, force: true }); }
}
```

Di dalamnya: `git diff --numstat -z --no-renames <base>` (add/del/binary) digabung
`git diff --name-status -z --no-renames <base>` (A/M/D) **per path**.
- `-z` wajib — tanpa itu git mengutip path berspasi. `--numstat -z`: `add \t del \t path \0`;
  `--name-status -z`: `status \0 path \0`.
- `--no-renames` — rename tampil `D`+`A`, path stabil.
- `binary` dikenali dari `-`/`-` pada `--numstat`; dicek **sebelum** `Number()` (kalau tidak → `+NaN −NaN`).
- `add`/`del` (numstat) tak bisa bedakan A dari M; `status` datang dari `--name-status`.

**Per-file** `reviewFile(repoDir, spec, path)`:
1. Hitung `files ∪ changed`; `path` tak di dalamnya → **404**. Satu-satunya validasi path — menutup
   traversal (`../../etc/passwd`) sekaligus menegakkan "hanya file worktree ini".
2. `binary` → `{ binary: true, diff: null, content: null }`.
3. `diff` = `git diff <base> -- <path>` di dalam `withTempIndex` (kosong `""` bila file tak berubah).
4. `content` = status `D` → `null`; selain itu baca `<worktree>/<path>` dari disk.
5. `diff` & `content` masing-masing dipotong 256 KB; `truncated: true` bila salah satu terpotong.

### 2. Routes — perluas `server/src/routes/specs.ts`

| Route | Perilaku |
|---|---|
| `GET /specs/:id/review` | `{ base, files, changed }` |
| `GET /specs/:id/review/*` | `{ path, status, binary, truncated, diff, content }` |

Wildcard `*` mengikuti `GET /projects/:id/docs/*` (`routes/docs.ts:8`) persis.

| Kondisi | Jawaban |
|---|---|
| spec tak ada | `404 { error: "not found" }` |
| project tanpa `repoDir` | `409 { error: "project belum punya repoDir" }` |
| worktree tak ada | `409 { error: "worktree tidak ada — jalankan/lanjutkan sesi backlog dulu" }` |
| `*path` di luar (all ∪ changed) | `404 { error: "not found" }` |

### 3. Web — `api/client.ts`

```
paths.specReview     = (id) => `${API}/specs/${id}/review`
paths.specReviewFile = (id, path) => `${API}/specs/${id}/review/${path}`
api.specReview(id)          -> SpecReview
api.specReviewFile(id, path) -> ReviewFile
```

### 4. Web — `screens/ReviewScreen.tsx` (Shell `wide`, ala VSCode)

- **Sidebar** (~300px, sticky): dua seksi.
  - **CHANGED** — list SCM datar: huruf status `A`/`M`/`D` berwarna (leaf/brass/clay), `+add −del`,
    klik memilih file. Header memuat jumlah.
  - **FILES** — tree explorer penuh. Pakai ulang `buildTree`/`collapse` dari `DocsWorkspace`,
    digeneralisasi untuk daftar path file biasa (bukan `DocCat`). Folder bisa expand/collapse; file
    diklik memilih.
- **Kanan** (`Card`): header (path + badge status) + tab **Diff | Source**.
  - **Diff** — diwarnai per awalan baris: `+` (leaf/hijau), `−` (clay/merah), `@@` (brass). File tak
    berubah → StateBlock "tidak ada perubahan pada file ini".
  - **Source** — `content` apa adanya di `--surface-code` + `--font-mono`.
  - `binary` → StateBlock "berkas biner"; `truncated` → catatan kaki eksplisit; `D` → StateBlock
    "file dihapus" (tab Source, karena `content: null`).
- **Default select** — file changed pertama (fokus review); fallback file pertama bila tak ada changed.
- **Muat ulang** — tombol yang mem-fetch ulang `GET /specs/:id/review` (seperti DocsWorkspace). Review
  itu tindakan sengaja; tak ada poll 5 detik.
- **State** — loading/empty/error via `StateBlock`. Worktree hilang (409) → StateBlock "belum ada
  worktree untuk di-review" dengan hint menjalankan sesi.

### 5. Wiring — `App.tsx` + `BacklogScreen.tsx`

- `App.tsx`: tambah `section: "review"` + state `reviewSpecId`. `openReview(spec)` set keduanya.
  Screen `review` merender `<Shell active="backlog" wide breadcrumb="backlog · SPEC-n">` berisi
  `<ReviewScreen specId={reviewSpecId} .../>`. Breadcrumb/tombol kembali → `setSection("backlog")`.
  Tanpa nav tab baru — kontekstual seperti `project`/`docs`.
- `BacklogScreen.tsx`: tombol **Review** (icon `git-compare` / `files`) di `SpecActions`
  (kartu/baris/board) dan di `SpecDetail`, memanggil `onOpenReview(spec)`. Tersedia untuk semua stage
  (review berguna kapan pun worktree ada), bukan hanya `done`.

## Out of scope (penyederhanaan sadar)

- **Worktree hilang** (sesi di-DELETE) → 409 + state kosong jelas. Fallback ke branch `hanoman/<specid>`
  dari object database (jalur "done" SPEC-144) menyusul. `// ponytail: worktree-only; branch fallback nanti`.
- **Simpan baseSha** (migration SPEC-144) — `merge-base` menurunkannya live.
- Edit file dari review; diff antar-spec; preview biner; poll realtime.

## Risiko yang diterima

- Enam-tujuh spawn git per pembukaan layar (`merge-base`, 2× `ls-files`, `rev-parse index`, `add -N`,
  2× `diff`) + satu per file dibuka. Semua async, `git diff` ≈ 20 ms; plafon yang dinamai, dipicu hanya
  saat layar review dibuka, bukan poll.
- Blob kosong `e69de29…` ditulis sekali ke object database oleh `add -A -N` (sudah ada di hampir semua repo).
- Rename tampil `D`+`A`; berkas biner tak dapat di-review. Diterima.

## Testing

- **`spec-review` (repo temp + worktree)** — untracked baru muncul di `changed` dengan hitungan nyata;
  file terhapus → `D` + `content: null`; biner → `binary: true` tanpa diff; tracked termodifikasi →
  `+n −m`; `all files` memuat tracked + untracked-tak-ignored dan **melewati** file yang di-`.gitignore`;
  path berspasi utuh (`-z`).
- **Index tak tercemar** — `git status --porcelain` identik sebelum/sesudah; loose object bertambah ≤1.
- **Gerbang path** — `review/<file di luar daftar>` → 404; `review/../../etc/passwd` → 404.
- **Pemotongan** — `content` > 256 KB → dipotong + `truncated: true`.
- **Kode status** — worktree hilang → 409; spec tak ada → 404; project tanpa repoDir → 409.
- **`ReviewScreen`** — render list changed + tree files; ganti tab Diff/Source; StateBlock untuk
  loading/empty/biner/dihapus.
- **Smoke lokal nyata** (CLAUDE.md) — boot server, `curl GET /api/specs/SPEC-171/review` di worktree ini,
  lalu `curl GET /api/specs/SPEC-171/review/server/src/routes/fs.ts`, konfirmasi `files`, `changed`,
  `diff`, `content` nyata.
