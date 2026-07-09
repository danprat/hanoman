# SPEC-143 — Objective (select branch di backlog)

**Fase:** Objective (dikunci) · 2026-07-09
**Jenis:** fitur — branch sumber worktree menjadi properti backlog item, bukan default tersembunyi
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Turunan:** brainstorm → [`docs/superpowers/specs/2026-07-09-hanoman-select-branch-in-backlog-spec-143-brainstorm.md`], design → [`docs/superpowers/specs/2026-07-09-hanoman-select-branch-in-backlog-spec-143-design.md`], plan menyusul.

## Masalah

`branchFrom` adalah properti **Run**, bukan properti **Spec**. Backlog item tidak punya kolom
branch sama sekali. Nilainya lahir di **empat** produsen terpisah yang semuanya jatuh ke `"main"`,
dan tak satu pun bisa dipengaruhi backlog item:

| Produsen | Baris | Nilai |
|---|---|---|
| `POST /runs` | `shared/src/dto.ts:25` | `z.string().default("main")` |
| Trigger fan-out | `server/src/fire-trigger.ts:25` | `ctx.branch ?? "main"` |
| CLI `runFlow` | `cli/src/commands/_run.ts:29` | hardcoded `"main"` |
| Web `startRun()` | `src/src/App.tsx:372` | tak pernah mengirim `branchFrom` |

Akibatnya setiap run selalu mem-basis worktree-nya pada `main`, walau pekerjaannya ditujukan
untuk branch lain. Dua konsekuensi yang sudah tertanam di kode hari ini:

1. **`cli/src/commands/_run.ts:41` mem-parse `--from`, lalu membuangnya.** `parseFlowArgs`
   mengembalikan `from`, tetapi `FlowArgs` tidak punya field itu dan `runFlow` menimpanya dengan
   `branchFrom: "main"`. `hanoman spec SPEC-143 --from release/v2` menerima branch itu dan diam-diam
   berjalan di `main`. Flag yang berbohong lebih buruk daripada flag yang tidak ada.
2. **`_run.ts:29` sudah menandai lubang ini sendiri** dengan komentar `ponytail:` — "per-run override
   lands with the queue (SPEC-004)". Queue mendarat; override-nya tidak pernah.

Tuas untuk run yang **sudah berjalan** justru sudah ada: `PATCH /runs/:id/worktree`
(`server/src/routes/runs.ts:162`) me-rebase worktree hidup lewat `realGit.switchBase()`. Yang tidak
ada adalah asal-usul branch **sebelum** run pertama lahir. `POST /specs` pun belum punya pasangan
`PATCH` sama sekali — `server/src/routes/specs.ts` hanya GET/POST/DELETE.

## Objective (dikunci)

**Jadikan branch sumber sebagai properti backlog item.** Setiap item — `brief` maupun `qa` —
memilih branch yang akan di-copy ke git worktree pada saat item dibuat, dan branch itu **tetap dapat
diubah selama item masih duduk di backlog**. Setiap run yang lahir dari item tersebut mem-basis
worktree-nya pada branch itu, lewat produsen `branchFrom` mana pun ia lahir — tanpa menambah
dependency runtime, tanpa menyentuh guardrail Source-of-Truth maupun isolasi worktree.

## Kriteria sukses (tingkat fase)

- **Branch adalah properti backlog item** — kolom `Spec.branchFrom String?`, nullable. `null` berarti
  "default project" (`main`), sehingga seluruh baris lama tetap sah tanpa backfill. Perubahan skema
  didasari migration Prisma + ADR baru.

- **Branch dipilih dari branch yang nyata ada** — `GET /projects/:id/branches` membaca
  `git for-each-ref --format='%(refname:short)' refs/heads` di `project.repoDir`, mengikuti preseden
  `GET /fs/browse` (server duduk di mesin yang sama dengan repo). `repoDir` null (project
  from-scratch) atau bukan repo git → daftar kosong, `Select` turun jadi disabled + hint. Tidak
  melempar.

- **Daftar yang mengisi dropdown adalah daftar yang menjaga gerbang** — `POST /specs` dan
  `PATCH /specs/:id` menolak branch di luar `refs/heads` repo. Ini sekaligus menutup celah argumen:
  `addWorktree` memanggil `git worktree add --detach <path> <branchFrom>`, dan git membaca opsi di
  posisi mana pun, sehingga nilai seperti `--force` akan terbaca sebagai **flag**, bukan ref.
  Sebagai sabuk kedua, `--` disisipkan sebelum `branchFrom` di `runner/src/git.ts`.

- **Dapat diedit setelah masuk backlog** — `PATCH /specs/:id` (hanya `branchFrom`) + `Select` pada
  `SpecDetail`. Edit hanya menentukan basis run **berikutnya**; run yang sudah berjalan tetap diubah
  lewat `PATCH /runs/:id/worktree` yang sudah ada. Kedua tuas itu tidak saling menimpa.

- **Setiap produsen `branchFrom` menghormatinya** — dan ini butir yang paling mudah terlewat:
  - `POST /runs`: `startRun()` meneruskan `spec.branchFrom`.
  - `fireTrigger`: hari ini menyusun **satu** objek `base` dan menyebarnya (`...base`) ke setiap spec
    dalam fan-out. Branch per-spec di-override **di dalam loop**. Tanpa ini, memperbaiki jalur
    `POST /runs` saja membuat tombol "Mulai" bekerja sementara run dari trigger diam-diam tetap di `main`.
  - CLI: `--from` berhenti berbohong — `FlowArgs.from` diteruskan ke `RunInput.branchFrom`, dan
    komentar `ponytail:` di `_run.ts:29` dicabut bersama utangnya.

- **Presedens branch pada trigger** — `ctx.branch` menang untuk trigger `commit` (yang ingin diuji
  adalah branch yang baru menerima commit); `spec.branchFrom` menang untuk `manual`, `schedule`, dan
  `interval`. Lihat *Keputusan yang dikunci dengan default* di bawah.

- **Branch hilang → gagal keras** — branch yang dipilih dihapus sebelum run jalan membuat
  `addWorktree` melempar dan run gagal, sejalan [ADR-0009](../adr/0009-guardrail-crash-fails-loud.md),
  dengan pesan yang menyebut nama branch-nya. Diam-diam mundur ke `main` berarti menjalankan
  pekerjaan di atas pohon yang salah.

- **Docs & keputusan tercatat** — `internal/docs` yang tersentuh diperbarui + ter-link di index;
  penambahan kolom `Spec.branchFrom` didasari migration + ADR baru.

## Batas scope

- **Termasuk:** kolom `Spec.branchFrom`; `GET /projects/:id/branches`; field branch di form **brief
  dan QA**; `PATCH /specs/:id` + `Select` di `SpecDetail`; `startRun()`; presedens branch di
  `fireTrigger`; `--from` CLI yang selama ini dibuang — dan hanya itu.

- **Tidak termasuk:** mengedit `branchTo` (sudah ada per-run lewat `PATCH /runs/:id/worktree`);
  branch **remote** (`origin/*`) — repo ini tak punya remote, `refs/heads` lokal cukup; membuat
  branch baru dari dashboard; mengubah worktree run yang sedang berjalan; branch default per-project
  (kolom `Project.defaultBranch`) — `null` = `main` sudah memadai sampai ada project yang menuntut lain.

## Prinsip yang dipegang

- **Perbaiki di titik semua produsen membacanya.** Branch adalah properti backlog item, bukan properti
  satu tombol. Menambal hanya jalur yang disebut brief (`POST /runs`) meninggalkan tiga produsen lain
  tetap rusak — dan yang satu (`--from`) sudah berbohong hari ini.

- **Konfigurasi run bukan isi brief.** `branchFrom` tidak dititipkan ke `payload` JSON: `specBlock()`
  di `runner/src/phases.ts` men-`JSON.stringify` payload langsung ke dalam prompt **setiap** fase,
  sehingga nama branch akan jadi derau di kelima fase. Kolom, bukan titipan.

- **Validasi bukan tempat bermalas-malasan.** Daftar branch yang mengisi dropdown dipakai ulang
  sebagai whitelist di server; tidak ada validator terpisah yang bisa ikut basi.

- **Aditif & reversibel.** Kolom nullable, tanpa backfill; setiap baris `Spec` lama tetap sah dan
  berperilaku persis seperti sebelumnya.

- **Tanpa dependency runtime baru.** Daftar branch lewat `git for-each-ref` bawaan, seperti korpus
  docs lewat `git ls-files` di [ADR-0011](../adr/0011-docs-realtime-filesystem.md).

- **Gagal keras, jangan mundur diam-diam.**

## Keputusan yang dikunci dengan default

Fase Brainstorm menutup dengan dua pertanyaan yang tidak dapat dijawab dari dalam run headless.
Keduanya dikunci di sini dengan **default yang direkomendasikan**, dicatat terbuka agar dapat
dibalik lewat amandemen sebelum fase Execute — bukan diperlakukan seolah sudah dikonfirmasi manusia:

1. **Presedens pada trigger `commit`** → `ctx.branch` menang. Webhook membawa branch yang baru
   menerima commit; menjalankan run di branch lain akan menguji pohon yang bukan penyebab pemicu.
   Untuk `manual`/`schedule`/`interval` tidak ada `ctx.branch`, sehingga `spec.branchFrom` menang
   tanpa ambiguitas. Konsekuensi yang diterima: sebuah backlog item dapat berjalan di branch selain
   pilihannya bila dipicu commit.

2. **ADR untuk satu kolom nullable** → ya, tetap ditulis. `CLAUDE.md` mensyaratkan "migration + ADR"
   untuk setiap perubahan skema, dan perubahan ini menggeser **apa itu backlog item** — dari deskripsi
   pekerjaan menjadi deskripsi pekerjaan **beserta basis worktree-nya**. Nomor ADR dialokasikan saat
   fase Execute, setelah menghitung nomor terpakai lintas branch.

> Chiranjivi — objective bertahan lebih lama dari satu run. Spec dan plan turunannya tunduk pada
> pernyataan ini.

## Amandemen — 2026-07-09 (fase Spec)

Kriteria sukses **Daftar yang mengisi dropdown adalah daftar yang menjaga gerbang** di atas menutup
dengan kalimat: "Sebagai sabuk kedua, `--` disisipkan sebelum `branchFrom` di `runner/src/git.ts`."
Kalimat itu **dicabut**, dan premis di belakangnya ternyata cacat. Dua temuan fase Spec:

1. **Whitelist saja bocor.** `git check-ref-format 'refs/heads/--force'` valid — sebuah branch boleh
   bernama `--force`. Branch semacam itu **ada di dalam repo**, sehingga lolos whitelist, lalu terbaca
   git sebagai flag.
2. **Sabuk `--` tak dapat diverifikasi dari dalam run.** `deniesDangerous` (`runner/src/safety.ts`)
   memblokir `git worktree add` di Bash — sebagaimana mestinya — jadi tidak ada cara menguji bagaimana
   `worktree add` mem-parse `--` tanpa membobol guardrail sendiri.

Gantinya: `branchFrom` diresolusikan menjadi **commit SHA** lewat
`git rev-parse --verify --end-of-options "<rev>^{commit}"` sebelum diserahkan ke `worktree add`.
String heksadesimal tak pernah bisa terbaca sebagai opsi, sehingga desainnya tidak lagi bergantung
pada perilaku parsing yang tak teruji. `switchBase` memakai `git checkout --end-of-options`.
Keduanya diverifikasi terhadap git 2.50.1. Rinciannya di
[`docs/superpowers/specs/2026-07-09-hanoman-select-branch-in-backlog-spec-143-design.md`].

Sisa objective ini tetap berlaku utuh.
