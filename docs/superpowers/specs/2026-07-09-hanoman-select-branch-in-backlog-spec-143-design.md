# SPEC-143 — Select branch di backlog

**Status:** design · objective dikunci 2026-07-09
**Date:** 2026-07-09
**Objective:** [`internal/docs/operations/spec-143-select-branch-in-backlog-objective.md`]
**Brainstorm:** [`docs/superpowers/specs/2026-07-09-hanoman-select-branch-in-backlog-spec-143-brainstorm.md`]

## Objective

Branch sumber worktree menjadi properti **backlog item**. Setiap item — `brief` maupun `qa` —
memilih branch saat dibuat, branch itu tetap dapat diubah selama item duduk di backlog, dan setiap
run yang lahir dari item itu mem-basis worktree-nya pada branch tersebut, lewat produsen
`branchFrom` mana pun ia lahir.

## Why

`branchFrom` hari ini properti **Run**, bukan **Spec**. Empat produsen, semuanya jatuh ke `"main"`:

| Produsen | Baris | Nilai |
|---|---|---|
| `POST /runs` | `shared/src/dto.ts:25` | `z.string().default("main")` |
| Trigger fan-out | `server/src/fire-trigger.ts:25` | `ctx.branch ?? "main"` |
| CLI `runFlow` | `cli/src/commands/_run.ts:29` | hardcoded `"main"` |
| Web `startRun()` | `src/src/App.tsx:372` | tak pernah mengirim `branchFrom` |

`cli/src/commands/_run.ts:41` bahkan sudah mem-parse `--from` dan membuangnya — `FlowArgs` tak punya
field itu. Flag itu berbohong hari ini.

## Decisions (locked)

| Keputusan | Pilihan |
|---|---|
| Penyimpanan | Kolom `Spec.branchFrom String?` — bukan titipan di `payload` |
| Arti `null` | "default project" = `main`; tanpa backfill |
| Sumber daftar branch | `GET /projects/:id/branches` → `git for-each-ref refs/heads` |
| Validasi | Whitelist server-side + resolusi ke SHA (lihat *Keamanan argumen*) |
| Edit setelah masuk backlog | `PATCH /specs/:id` (hanya `branchFrom`) |
| Presedens trigger `commit` | `ctx.branch` menang; `spec.branchFrom` untuk manual/schedule/interval |
| Skema | Migration Prisma + ADR baru (nomor dialokasikan saat Execute) |

## Architecture

### 1. Data model

```prisma
model Spec {
  // …
  payload    Json?
  branchFrom String?   // null = default project (main)
}
```

Migration `add_spec_branch_from`: satu `ALTER TABLE … ADD COLUMN "branchFrom" TEXT`. Nullable,
tanpa default, tanpa backfill — setiap baris `Spec` lama tetap sah dan berperilaku persis seperti
sebelumnya. Perubahan skema didasari **ADR baru** (`CLAUDE.md`); nomornya dihitung lintas branch di
fase Execute agar tidak bertabrakan dengan worktree bersebelahan.

`shared/src/entities.ts` — `zSpec` bertambah `branchFrom: z.string().nullable()`.
`shared/src/dto.ts` — `zCreateSpec` bertambah `branchFrom: z.string().optional()`; `zPatchSpec` baru:
`z.object({ branchFrom: z.string().nullable() })`.

### 2. Sumber daftar branch

Cerminan persis `listRepoDocs` di `server/src/services/scan.ts` — spawn git, `[]` saat gagal:

```ts
// server/src/services/branches.ts
export function listRepoBranches(repoDir: string | null): string[] {
  if (!repoDir) return [];
  const r = spawnSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd: repoDir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
}
```

`repoDir` null (project from-scratch) atau bukan repo git → `[]`. Tidak melempar.

### 3. API

| Route | Perilaku |
|---|---|
| `GET /projects/:id/branches` | **Baru** — `{ branches: string[] }`; 404 bila project tak ada |
| `POST /specs` | Menerima `branchFrom?`; menolak branch di luar repo (400) |
| `PATCH /specs/:id` | **Baru** — `{ branchFrom: string \| null }`; 404 / 400 |

`paths.branches = (id) => `${API}/projects/${id}/branches`` di `shared/src/api.ts`.

`POST /specs` hari ini tidak pernah memuat baris `Project`-nya; validasi branch memaksanya
melakukan `findUnique`. Efek samping yang diterima dan diinginkan: project tak dikenal kini
menghasilkan **404 yang jujur**, bukan pelanggaran foreign-key.

`branchFrom: null` pada `PATCH` mengembalikan item ke default project. Itulah alasan `zPatchSpec`
memakai `.nullable()` dan bukan `.optional()` — "kosongkan" harus dapat dibedakan dari "jangan sentuh".

### 4. Keamanan argumen — whitelist saja tidak cukup

Fase Brainstorm mengusulkan `--` sebagai sabuk kedua. **Itu keliru, dan whitelist-nya sendiri
ternyata bocor.** Diverifikasi terhadap git 2.50.1 di dalam run ini:

- `git check-ref-format 'refs/heads/--force'` → **valid**. Sebuah branch boleh bernama `--force`.
  Maka `for-each-ref` dapat memuntahkan `--force`, nilai itu **lolos whitelist** (ia memang ada di
  repo), lalu `git worktree add --detach <path> --force` membacanya sebagai **flag**.
- `git worktree add` **tidak dapat diuji dari dalam run** — `deniesDangerous` di
  `runner/src/safety.ts` memblokirnya, dan itu benar. Desain apa pun yang bersandar pada cara
  `worktree add` mem-parse `--` akan menjadi klaim yang tak terverifikasi.

Karena itu jangan menawar cara git mem-parse opsi — **hilangkan ambiguitasnya**. Resolusikan
`branchFrom` menjadi commit SHA lebih dulu; string heksadesimal tak pernah bisa terbaca sebagai flag:

```ts
// runner/src/git.ts
// Nama branch boleh berbentuk flag (`refs/heads/--force` adalah refname yang sah) dan git
// membaca opsi di posisi mana pun. Resolusikan ke SHA dulu — heksadesimal bukan opsi.
const resolveCommit = (repo: string, rev: string) =>
  git(repo, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).trim();

addWorktree: (repo, path, branchFrom, reuse) => {
  // …reclaim seperti sekarang…
  git(repo, ["worktree", "add", "--detach", path, resolveCommit(repo, branchFrom)]);
},
switchBase: (path, branchFrom) => { git(path, ["checkout", "--end-of-options", branchFrom]); },
```

Diverifikasi: `git rev-parse --verify --end-of-options -- '--force'` memperlakukan `--force` sebagai
revision (gagal "Needed a single revision"), bukan flag; `git checkout --end-of-options <nama>` sama.
Urutan argumen mengikat — `--verify` **harus** mendahului `--end-of-options`.

Bonus: `resolveCommit` gagal keras dengan stderr git yang menyebut revisinya, sehingga branch yang
dihapus sebelum run jalan menghasilkan pesan yang menamai branch-nya ([ADR-0009](../../../internal/docs/adr/0009-guardrail-crash-fails-loud.md)),
bukan mundur diam-diam ke `main`. `resolveCommit` juga mempertahankan DWIM: branch yang hanya ada
sebagai remote-tracking (run github-backed) tetap resolve, sesuatu yang akan hilang bila kita
menyematkan `refs/heads/` di depan nama branch.

`switchBase` dikeraskan di sini karena ia berbagi file dan akar masalah yang sama — satu baris.
Whitelist untuk `PATCH /runs/:id/worktree` tetap **di luar scope** (lihat *Out of scope*).

### 5. Produsen `branchFrom`

- **`POST /runs`** — `startRun()` mengirim `branchFrom: spec.branchFrom ?? "main"`. `zStartRun` tak berubah.

- **`fireTrigger`** — hari ini menyusun satu `base` dan menyebarnya (`...base`) ke setiap spec.
  Override **di dalam loop**, setelah spread:

  ```ts
  for (const s of specs) {
    const branchFrom = trigger.type === "commit" && ctx.branch ? ctx.branch : (s.branchFrom ?? "main");
    const r = await enqueueRun({ runId, ...base, branchFrom, branchTo: …, flow, specId: s.id, steps });
  }
  ```

  Tanpa ini tombol "Mulai" bekerja sementara run dari trigger diam-diam tetap di `main`.

- **CLI** — flag baru `--branch-from`, berpasangan dengan `--branch-to` yang sudah ada. `FlowArgs`
  bertambah `branchFrom?: string`; `runFlow` memakai `branchFrom: a.branchFrom ?? "main"`; empat
  pemanggil (`spec.ts`, `plan.ts`, `execute.ts`, `qa.ts`) meneruskan `branchFrom: p.branchFrom`.
  Komentar `ponytail:` di `_run.ts:29` dicabut bersama utangnya.

  **`--from` tidak dipakai.** `AGENTS.md` sudah memberinya arti lain (`hanoman scaffold --project P
  --from objective`) dan `cli/test/flows.cmd.test.ts` memanggilnya begitu; memaknainya sebagai branch
  akan membuat scaffold meresolusikan branch bernama `objective`. `scaffold`/`reverse` tidak menerima
  `--branch-from` — flow-nya tidak terikat backlog item. Lihat *Amandemen 2* di objective.

### 6. Web

- `api/client.ts`: `listBranches(id)` dan `patchSpec(id, { branchFrom })`.
- `App.tsx` — `SpecForm` bertambah `branchFrom: ""`. `NewSpecModal` memuat branch saat `f.project`
  berubah; satu `Select` **di luar cabang `isQa`**, sehingga muncul untuk brief **dan** QA.
  Opsi pertama `{ value: "", label: "main (default project)" }`; `createSpec` mengirim
  `branchFrom: f.branchFrom || undefined`.
- `BacklogScreen.tsx` — `SpecDetail` menampilkan branch dan menyediakan `Select` untuk mengubahnya
  (memuat branch lewat `api.listBranches` saat dibuka; screen lain sudah meng-import `api`, jadi ini
  sejalan pola). Perubahan dipanggilkan ke prop `onEditBranch(spec, branch)` — `App` yang memegang
  state `backlog` dan toast, seperti `onStart`/`onDelete`.
- `SpecCard` menampilkan `Badge` branch bila `branchFrom` tidak null — supaya "run ini akan jalan di
  branch apa" terbaca tanpa membuka modal.

`Select` disabled + hint bila daftar branch kosong (project tanpa repo).

## Out of scope

- **Whitelist untuk `PATCH /runs/:id/worktree`.** `zWorktreePatch.branchFrom` tetap teks bebas tak
  tervalidasi. Lubang ini sudah ada sebelum SPEC-143 dan tidak diperlebar olehnya; `switchBase` yang
  dikeraskan menutup sisi flag-injection-nya, tapi bukan sisi "branch tak ada". Perubahan terpisah.
- Mengedit `branchTo` (sudah ada per-run).
- Branch **remote** (`origin/*`) sebagai pilihan — `refs/heads` lokal saja.
- Membuat branch baru dari dashboard.
- `Project.defaultBranch` — `null` = `main` memadai sampai ada project yang menuntut lain.

## Risiko yang diterima

`null` → `main`. Repo yang branch default-nya `master` akan gagal keras di `resolveCommit`. Itu
**persis perilaku hari ini** (`branchFrom` hardcoded `"main"` di keempat produsen), jadi bukan
regresi — dan kini pesannya menyebut nama branch-nya. `Project.defaultBranch` adalah jalan keluarnya
bila ada yang menuntut.

## Testing

- **`listRepoBranches`** — repo temp: branch terurut & unik; `repoDir` bukan repo git → `[]`;
  `null` → `[]`.
- **`resolveCommit`** — repo temp: nama branch normal → SHA; revisi tak ada → melempar dengan pesan
  yang memuat namanya. Fake `GitOps` di `runner/test/run.test.ts` tak tersentuh.
- **Routes** — `GET /projects/:id/branches` (404 untuk project tak dikenal; `[]` untuk `repoDir` null);
  `POST /specs` dengan branch tak dikenal → 400, dengan branch sah → 201 + `branchFrom`;
  `PATCH /specs/:id` → 200, branch tak dikenal → 400, `null` → mengosongkan, id tak dikenal → 404.
- **`fireTrigger`** — trigger `commit` dengan `ctx.branch` menimpa `spec.branchFrom`; trigger
  `schedule` memakai `spec.branchFrom`; spec tanpa branch → `main`.
- **Smoke lokal nyata** (CLAUDE.md) — boot server, `curl` `GET /api/projects/:id/branches`,
  `POST /api/specs` berisi `branchFrom`, lalu `PATCH`, dan konfirmasi baris di Postgres.

## Open questions

**Terjawab di fase ini:**

- Sabuk kedua `--` → **dibatalkan**. Diganti resolusi ke SHA; `worktree add` tak dapat diuji dari
  dalam run, dan whitelist saja bocor untuk branch bernama flag. Objective diamandemen.
- Whitelist cukup? → **tidak**, lihat *Keamanan argumen*.

**Masih menunggu manusia** (dikunci dengan default, dapat dibalik sebelum Execute):

- Presedens `ctx.branch` di atas `spec.branchFrom` untuk trigger `commit`. Konsekuensi yang
  diterima: sebuah backlog item dapat berjalan di branch selain pilihannya bila dipicu commit.
