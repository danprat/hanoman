# SPEC-143 — Select branch di backlog

**Status:** brainstorm — objective belum dikunci
**Date:** 2026-07-09
**Fase:** Brainstorm (feature: Brainstorm → Objective → Spec → Plan → Execute)
**Sumber:** brief · prioritas tinggi

## Objective (kandidat, belum dikunci)

Backlog item — baik `brief` maupun `qa` — memilih **branch mana yang di-copy ke git
worktree** saat run-nya jalan. Branch dipilih waktu item dibuat, dan **masih bisa diubah**
setelah item duduk di backlog.

## Kondisi sekarang

`branchFrom` adalah properti **Run**, bukan properti **Spec**. Backlog item tidak punya
kolom branch sama sekali (`prisma/schema.prisma`, `model Spec`). Akibatnya setiap run
selalu berbasis `main`, dari tiga produsen `branchFrom` yang terpisah:

| Produsen | Baris | Nilai |
|---|---|---|
| `POST /runs` | `shared/src/dto.ts:25` | `z.string().default("main")` |
| Trigger fan-out | `server/src/fire-trigger.ts:25` | `ctx.branch ?? "main"` |
| CLI `hanoman run` | `cli/src/commands/_run.ts:29` | hardcoded `"main"` |

Dashboard tak pernah mengisinya: `startRun()` di `src/src/App.tsx:372` mengirim hanya
`{ project, flow, specId }`, jadi `default("main")` selalu menang. `cli/src/commands/_run.ts:29`
bahkan sudah menandai lubang ini sendiri dengan komentar `ponytail:` ("per-run override
lands with the queue").

Hilirnya satu: `realGit.addWorktree()` (`runner/src/git.ts`) menjalankan
`git worktree add --detach <path> <branchFrom>`.

Dua fakta yang membentuk desain:

1. **`PATCH /runs/:id/worktree` sudah ada** (`server/src/routes/runs.ts:162`) dan sudah
   me-rebase worktree yang hidup lewat `realGit.switchBase()`. Jadi mengganti branch pada
   run yang **sudah jalan** bukan bagian dari pekerjaan ini — tuasnya sudah terpasang.
   Yang belum ada adalah asal-usul branch **sebelum** run pertama lahir.
2. **`/specs` belum punya PATCH sama sekali** (`server/src/routes/specs.ts` hanya
   GET/POST/DELETE). "Bisa diedit saat sudah jadi backlog" menuntut endpoint baru.

## Opsi — di mana branch disimpan

**A. Kolom `Spec.branchFrom String?` — rekomendasi.**
Satu migration, nullable. `null` berarti "pakai default project" (`main`), sehingga semua
baris lama tetap sah dan tak perlu backfill. Branch bisa dibaca `fireTrigger` lewat query
spec yang sudah ada, tanpa parsing JSON.

**B. Titipkan di `payload` JSON.** Nol migration — menggoda, tapi salah tempat.
`specBlock()` di `runner/src/phases.ts` melakukan `JSON.stringify(s.payload)` langsung ke
dalam **prompt setiap fase**. Nama branch akan ikut terbawa sebagai derau di kelima fase,
padahal ia konfigurasi run, bukan isi brief yang ditulis manusia. Selain itu `payload`
divalidasi union `zBriefPayload | zQaPayload`, jadi field-nya harus diduplikasi di dua skema.

**C. Tanya saat tombol "Mulai" ditekan.** Paling malas, tapi gagal memenuhi objective:
brief menuntut branch dipilih **saat item dibuat** dan bisa diedit selama menunggu.

→ **A.** Ia satu-satunya yang menaruh branch di tempat ketiga produsen `branchFrom` bisa
membacanya, dan menjaga prompt fase tetap bersih.

## Opsi — dari mana daftar branch datang

**1. Endpoint baru `GET /projects/:id/branches` — rekomendasi.**
Server duduk di mesin yang sama dengan repo; `GET /fs/browse` (`server/src/routes/fs.ts`)
sudah jadi preseden persis untuk pola ini. Isinya satu perintah:
`git for-each-ref --format='%(refname:short)' refs/heads` di `project.repoDir`.
`repoDir` null (project from-scratch) atau bukan repo git → daftar kosong, `Select`
turun jadi disabled + hint. Tidak melempar.

**2. `Input` teks bebas.** Nol endpoint, tapi "select branch" memang yang diminta, dan
salah ketik baru ketahuan beberapa menit kemudian saat `addWorktree` gagal di dalam run.

**3. Cache daftar branch di baris `Project`.** Basi begitu orang membuat branch.

→ **1**, dan daftar itu sekaligus dipakai sebagai **whitelist validasi** di server.

### Validasi bukan tempat bermalas-malasan

`addWorktree` memanggil `git worktree add --detach <path> <branchFrom>`. Argumennya array
(bukan shell), jadi tak ada injeksi perintah — tapi git membaca opsi di posisi mana pun,
sehingga `branchFrom` bernilai `--force` akan terbaca sebagai **flag**, bukan ref.

Menolak branch yang tidak ada di `refs/heads` repo, di `POST` dan `PATCH /specs`, menutup
lubang itu tanpa menulis validator terpisah — daftar yang mengisi dropdown adalah daftar
yang sama yang menjaga gerbang. Sebagai sabuk kedua, sisipkan `--` sebelum `branchFrom`
di `addWorktree`.

## Temuan lintas-potong: `fireTrigger` akan mengabaikan branch ini

`fire-trigger.ts` menyusun **satu** objek `base` dengan `branchFrom: ctx.branch ?? "main"`,
lalu menyebarnya (`...base`) ke setiap spec dalam fan-out. Kalau branch per-spec tidak
di-override **di dalam loop**, run yang lahir dari trigger jadwal/manual akan diam-diam
tetap memakai `main` walau backlog item-nya sudah memilih branch lain.

Ini bagian yang paling mudah terlewat: memperbaiki hanya jalur `POST /runs` (yang dipakai
tombol "Mulai") membuat tombol bekerja dan trigger bohong.

## Ruang lingkup

**Termasuk:** kolom `Spec.branchFrom` + migration; `GET /projects/:id/branches`;
`branchFrom` di form brief **dan** QA; `PATCH /specs/:id` + `Select` di `SpecDetail`;
`startRun()` meneruskan `spec.branchFrom`; presedens branch di `fireTrigger`.

**Tidak termasuk:** mengedit `branchTo` (sudah ada per-run); branch remote (`origin/*`);
membuat branch baru dari dashboard; mengubah worktree run yang sedang jalan
(`PATCH /runs/:id/worktree` sudah menanganinya).

## Perilaku saat branch hilang

Branch yang dipilih dihapus sebelum run jalan → `addWorktree` melempar → run gagal.
**Biarkan gagal keras**, sejalan ADR-0009, dengan pesan yang menyebut nama branch-nya.
Diam-diam mundur ke `main` berarti menjalankan pekerjaan di atas pohon yang salah.

## Pertanyaan terbuka — perlu jawaban manusia sebelum objective dikunci

1. **Presedens pada trigger `commit`.** Webhook membawa `ctx.branch` = branch yang baru
   menerima commit. Mana yang menang, `ctx.branch` atau `spec.branchFrom`?
   Usulan: `ctx.branch` menang untuk trigger `commit` (kita ingin menguji branch yang
   berubah); `spec.branchFrom` menang untuk `manual`/`schedule`/`interval`. Ini keputusan
   semantik, bukan lemparan koin.
2. **Branch remote.** Cukup `refs/heads` lokal? (Repo ini memang tak punya remote.)
3. **ADR.** `CLAUDE.md` mensyaratkan "migration + ADR" untuk perubahan skema. Satu kolom
   nullable — tetap tulis ADR pendek? Usulan: ya, karena ia mengubah **apa itu backlog
   item**, bukan sekadar menambah kolom.

## Catatan fase

Fase Brainstorm tidak menyentuh `internal/docs/**`, jadi tidak ada perubahan pada index
Source of Truth (`internal/docs/README.md`). Mengikuti preseden 14 design doc sebelumnya
di folder ini — yang tak satu pun ter-link di index SoT — artefak yang masuk index adalah
`internal/docs/operations/spec-143-*-objective.md`, dan itu keluaran fase **Objective**,
bukan fase ini.
