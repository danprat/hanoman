# SPEC-144 — Objective (Runs menampilkan changes yang dibuat hanoman)

**Fase:** Brainstorm → Objective (dikunci) · 2026-07-09
**Jenis:** fitur — sumber `brief`, prioritas **tinggi**
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Turunan:** brainstorm → [`docs/superpowers/specs/2026-07-09-hanoman-run-changes-preview-spec-144-brainstorm.md`], design → [`docs/superpowers/specs/2026-07-09-hanoman-run-changes-preview-spec-144-design.md`].

## Masalah

Panel "File berubah" **sudah terpasang di UI** dan tidak pernah menampilkan satu baris pun.
Bukan bug — tak ada satu pun produsen datanya. Rantainya lengkap kecuali pangkalnya:

| Lapis | Berkas | Status |
|---|---|---|
| Tipe event (runner) | `runner/src/types.ts:35` — `{ kind: "file"; path; add; del; status }` | ada |
| Tipe event (klien) | `src/src/api/client.ts:58` | ada |
| Persist | `server/src/runner/events-io.ts:63` — `files: [...run.files, e]` | ada |
| Kolom | `Run.files Json`, di-seed `[]` — `server/src/queue.ts:48` | ada |
| Render | `FileDiff` — `src/src/screens/RunsScreen.tsx:96` | ada |
| Verb terminal | `files` / `diff` — `server/src/routes/runs.ts:44` | ada |
| **Emitter** | `runner/src/run.ts` | **tidak pernah ditulis** |

`runOne` tidak pernah memancarkan `kind: "file"`. Dicari di seluruh repo: dua kemunculan
string itu, keduanya deklarasi tipe. Maka `Run.files` selamanya `[]`, `hasWork`
(`RunsScreen.tsx:240`) selamanya `false`, panel diff tak pernah ter-mount, dan `hanoman> diff`
di terminal run selalu menjawab *"belum ada file berubah"* — kalimat yang **salah**, bukan
kalimat yang kosong.

Ini bukan sekadar fitur yang belum ada. [SPEC-008](spec-008-de-mock-objective.md) menutup
dengan kriteria sukses *"`RunsScreen` … menggabungkan event `log`/`phase`/`status`/`cost`/`file`
secara live"*. Kriteria itu **tidak pernah terpenuhi**: sisi konsumennya dibangun, sisi
produsennya tidak. `Run.plan` bernasib identik — di-seed `[]`, tanpa cabang di `persistEvent`,
tanpa penulis, dan `PlanSteps` sama matinya.

### `Run.commitSha` bukan commit milik run

Mudah salah baca. Kolom itu diisi `ctx.sha` dari webhook — commit **pemicu**, bukan commit
**hasil** (`server/src/fire-trigger.ts:26`), dan hanya dipakai melaporkan commit status ke
GitHub (`server/src/github/status.ts:40`). Untuk run manual ia `null`. **Tak ada satu pun
kolom yang menyimpan commit yang dibuat run.**

### Run yang sukses menghapus jejaknya

Empat fakta git, diverifikasi terhadap repo ini pada 2026-07-09:

1. Worktree lahir *detached* pada satu commit — `git worktree add --detach <path> <resolveCommit(branchFrom)>`
   (`runner/src/git.ts:40`). Commit itu basis run, satu-satunya titik nol yang benar.
2. Run sukses memanggil `commitAndPush` lalu `removeWorktree` (`runner/src/run.ts:111-112`).
   Worktree-nya lenyap.
3. Run gagal/berhenti `return` sebelum baris 111. Worktree-nya **tetap di disk** — dan itu
   persis run yang paling ingin diperiksa isinya.
4. `commitAndPush` tidak pernah membuat branch lokal saat `origin` ada; ia hanya
   `git push origin HEAD:refs/heads/<branchTo>` (`git.ts:53`). Repo ini punya `origin` nyata.
   `git for-each-ref` hari ini mengembalikan **tiga** ref — `refs/heads/main`,
   `refs/remotes/origin/HEAD`, `refs/remotes/origin/main` — nol ref `hanoman/run-*`, padahal
   `git log` memuat `Merge branch 'hanoman/run-8803'`. Branch run dihapus setelah di-merge.

Konsekuensinya tajam: **setelah run sukses, tidak ada worktree dan tidak ada branch.** Diff
`branchFrom...branchTo` yang dihitung belakangan menunjuk ref yang sudah tidak ada.

## Objective (dikunci)

**Layar Runs menampilkan seluruh perubahan yang dibuat hanoman pada run itu — daftar file,
commit-commitnya, dan preview isi source-nya — realtime selagi run berjalan, dan tetap
terbaca setelah run selesai.** Hanya perubahan milik run tersebut. Tanpa menambah dependency
runtime, tanpa menyentuh guardrail Source-of-Truth maupun isolasi worktree (ADR-0002).

## Kriteria sukses (tingkat fase)

- **SHA disimpan, diff diturunkan.** Dua kolom nullable baru pada `Run`: `baseSha` (commit
  tempat worktree di-detach) dan `headSha` (commit setelah `commitAndPush` berhasil). Isi
  diff-nya **tidak pernah disimpan** — dihitung dari git tiap request. `GitOps` menyerahkan
  kedua SHA itu ke `runOne`, yang memancarkannya sebagai event; `persistEvent` menulisnya.
  `baseSha` ditulis sekali dan **tidak pernah ditimpa** saat run di-`resume` (`addWorktree`
  early-return pada `reuse`, jadi basisnya tetap basis semula).

- **Dua kondisi run, satu permukaan.** Bifurkasinya bersih justru karena fakta 2 & 3 di atas
  saling melengkapi — worktree hilang **hanya** ketika `headSha` sudah ada:

  | Kondisi | Sumber | Isi |
  |---|---|---|
  | worktree ada (`queued`…`running`, `paused`, `failed`, `stopped`) | worktree | commit agen `base..HEAD` + perubahan yang belum di-commit |
  | worktree dihapus (`done`) | object database repo | `baseSha..headSha` |

- **File baru wajib terlihat.** `git diff --numstat <base>` **melewatkan file untracked** —
  diverifikasi: sebuah `untracked.md` baru tidak muncul sama sekali. Padahal file baru adalah
  keluaran hanoman yang paling lazim (setiap fase menulis doc baru). Enumerasi wajib memakai
  **index sementara**: salin index worktree ke path temporer (`git rev-parse --git-path index`
  — di worktree tertaut index **bukan** `.git/index`, melainkan
  `<gitdir>/worktrees/<name>/index`), lalu `GIT_INDEX_FILE=<temp> git add -A` +
  `git diff --cached --numstat <base>`. Diverifikasi: untracked, deleted, dan biner keluar
  seragam, dan index worktree yang hidup **tidak tersentuh** — sebuah `GET` tidak boleh
  memutasi index run yang sedang berjalan.

- **Commit-commitnya ikut tampil.** `git log --format=… <base>..<tip>` — brief menyebut
  "commit" secara eksplisit, dan agen di dalam worktree memang membuat commit sendiri, bukan
  hanya commit penutup dari `commitAndPush`.

- **Preview seluruh source.** Sepasang endpoint mencerminkan preseden docs
  (`GET /projects/:id/docs` + `…/docs/*path`):

  ```
  GET /runs/:id/changes         -> { base, head, commits: [{sha, subject}], files: [{path, add, del, status}] }
  GET /runs/:id/changes/*path   -> { path, status, binary, truncated, diff, content }
  ```

  Ringkasan dulu, isi belakangan; isi hanya dimuat untuk file yang benar-benar dibuka.

- **Daftar file adalah gerbangnya.** `GET /runs/:id/changes/*path` menerima path dari klien
  dan **hanya** melayani path yang ada di dalam daftar `GET /runs/:id/changes`. Daftar yang
  mengisi panel adalah daftar yang menjaga gerbang — idiom yang sama dengan whitelist branch
  di [SPEC-143](spec-143-select-branch-in-backlog-objective.md), tanpa validator terpisah yang
  bisa ikut basi. Ia sekaligus menutup path traversal **dan** menegakkan constraint brief:
  *hanya perubahan pada run tersebut*.

- **Satu sumber untuk semua pembaca.** Verb terminal `files` dan `diff`
  (`server/src/routes/runs.ts:44`) dirujukkan ke derivasi yang sama. Menambal `FileDiff` saja
  meninggalkan terminal run tetap berbohong.

- **Deletion over addition.** Kolom `Run.files` dibuang bersama `kind: "file"` di `RunEvent`
  (`runner/src/types.ts:35`), cabangnya di `persistEvent` (`events-io.ts:63`), dan tipenya di
  `src/src/api/client.ts:58`. Ia salinan DB dari state filesystem, ditulis **append-only**
  sehingga file yang disunting dua kali muncul dua baris dan file yang disunting lalu
  dikembalikan terdaftar selamanya. Pembuangan kolom didasari migration Prisma + ADR baru.

- **Tidak memblok event loop.** Endpoint ini memanggil git; `git diff` pada run besar tak
  berbatas. [SPEC-141](spec-141-overview-coverage-realtime-objective.md) sudah mengukur bahwa
  `spawnSync` menghentikan **seluruh proses**, bukan sekadar satu request. Endpoint changes
  wajib memakai spawn **async**. `services/scan.ts` dan `services/branches.ts` bukan preseden
  yang boleh diikuti di sini.

- **Gagal keras, jangan mundur diam-diam.** `headSha` yang objeknya tak lagi terjangkau
  (branch dihapus sebelum di-merge, lalu `git gc`) dijawab dengan pesan "commit tak
  terjangkau", sejalan [ADR-0009](../adr/0009-guardrail-crash-fails-loud.md). Daftar kosong
  terbaca seperti *"hanoman tidak mengubah apa pun"* — itu kebohongan yang lebih mahal.

- **Docs & keputusan tercatat** — `internal/docs` yang tersentuh diperbarui + ter-link di
  index; penambahan `Run.baseSha`/`Run.headSha` dan pembuangan `Run.files` didasari migration
  + ADR baru.

## Batas scope

- **Termasuk:** kolom `Run.baseSha` + `Run.headSha`; pembuangan kolom `Run.files` beserta
  `kind: "file"` di `RunEvent`, `persistEvent`, dan tipe klien; migration + ADR;
  `GET /runs/:id/changes` dan `GET /runs/:id/changes/*path`; panel changes + preview source di
  `RunsScreen`; verb `files`/`diff` terminal dirujukkan ke sumber yang sama — dan hanya itu.

- **Tidak termasuk:** `Run.plan` dan `PlanSteps` — sama-sama mati, tapi utang milik brief lain;
  di sini keduanya hanya disentuh sejauh memisahkan gate `hasWork` (`RunsScreen.tsx:240`)
  supaya `PlanSteps` tidak tampil sebagai kartu "Plan · 0 langkah" pada setiap run. Mengedit
  file dari panel changes. Diff antar-run. Menahan worktree agar tidak dihapus (melanggar
  ADR-0002 dan menumpuk disk). Komentar/review inline. Branch remote.

## Perangkap yang tercatat

- **`git diff` yang jujur tapi tidak lengkap.** Perangkap paling mahal di seluruh spec ini:
  `git diff --numstat <base>` mengembalikan `0` untuk setiap file baru, tanpa error. Panel
  akan terlihat *bekerja* sambil menyembunyikan justru keluaran utama hanoman.

- **Index worktree bukan `.git/index`.** Pada worktree tertaut, `.git` adalah **file**.
  Menyalin `.git/index` gagal diam-diam; `git rev-parse --git-path index` adalah satu-satunya
  jalan yang benar.

- **`--numstat` pada berkas biner** mengeluarkan `-` untuk add/del, bukan angka. Parser yang
  memaksa `Number()` menghasilkan `NaN` dan panel menampilkan `+NaN −NaN`.

- **`hasWork` mematikan dua panel sekaligus.** `RunsScreen.tsx:240` menyalakan `PlanSteps`
  **dan** `FileDiff` dari `plan.length || files.length`.

## Prinsip yang dipegang

- **Yang disimpan adalah penunjuk; yang diturunkan adalah isinya.** [ADR-0011](../adr/0011-docs-realtime-filesystem.md)
  dan [ADR-0018](../adr/0018-coverage-nilai-turunan.md) membuang salinan DB dari nilai yang
  **dapat dihitung ulang** dari disk. `baseSha`/`headSha` bukan itu: keduanya fakta identitas
  yang lahir pada satu momen dan **tak dapat direkonstruksi setelahnya** — worktree-nya
  dihapus, branch-nya dihapus, dan pesan commit `hanoman <flow> <specId>` (`run.ts:111`) tidak
  memuat `runId` sehingga tak bisa dipakai mencari kembali. `Run.files` justru *dapat*
  dihitung ulang — karena itu ia dibuang, bukan diisi.

- **Perbaiki di titik semua pembaca membacanya.** Panel, verb terminal, dan SSE membaca satu
  derivasi yang sama.

- **Validasi bukan tempat bermalas-malasan.** Daftar file yang mengisi panel dipakai ulang
  sebagai whitelist path di server.

- **Tanpa dependency runtime baru.** Semua lewat git bawaan, seperti korpus docs lewat
  `git ls-files` (ADR-0011) dan daftar branch lewat `git for-each-ref` (SPEC-143).

- **Gagal keras, jangan mundur diam-diam.**

## Keputusan yang dikunci dengan default

Fase Brainstorm menutup dengan empat pertanyaan yang tak dapat dijawab dari dalam run
headless. Semuanya dikunci di sini dengan **default yang direkomendasikan**, dicatat terbuka
agar dapat dibalik lewat amandemen sebelum fase Execute — bukan diperlakukan seolah sudah
dikonfirmasi manusia:

1. **"Preview seluruh source" = diff *dan* isi file penuh.** `GET /runs/:id/changes/*path`
   mengembalikan `diff` (unified) **dan** `content` (isi file setelah perubahan) dalam satu
   respons; UI yang memilih tab. Brief menuntut "preview seluruh source", bukan hanya hunk
   yang berubah. Biayanya satu panggilan git tambahan per file yang dibuka — dibayar hanya
   saat file itu diklik.

2. **File terhapus dan berkas biner.** File terhapus → `content: null`, `diff` tetap ada.
   Berkas biner (dikenali dari `-`/`-` pada `--numstat`) → `binary: true`, tanpa `diff` dan
   tanpa `content`; panel menampilkan nama dan ukurannya saja. Konsekuensi yang diterima:
   perubahan pada aset biner tidak dapat di-review dari dashboard.

3. **Batas ukuran preview: 256 KB, dengan penanda eksplisit.** `content` yang melampauinya
   dipotong dan `truncated: true` diset. Angkanya mengikuti preseden scrollback PTY (256 KB,
   [ADR-0014](../adr/0014-pty-terminal-di-proses-api.md)) alih-alih menciptakan konstanta
   kedua. Memotong **tanpa** penanda adalah pilihan yang tidak pernah boleh diambil: pembaca
   akan mengira file-nya memang berakhir di situ.

4. **ADR tetap ditulis.** `CLAUDE.md` mensyaratkan "migration + ADR" untuk setiap perubahan
   skema. Keputusan yang direkam bukan "tambah dua kolom", melainkan **SHA disimpan, diff
   diturunkan** — dan itu menajamkan batas ADR-0011/ADR-0018: nilai turunan tidak disimpan,
   tetapi *penunjuk* ke sebuah momen yang tak dapat direkonstruksi harus disimpan. Nomor ADR
   dialokasikan saat fase Execute, setelah menghitung nomor terpakai lintas branch dan
   worktree (ADR-0018 saat ini terpakai **dua kali** — preseden yang tidak boleh diulang).

> Chiranjivi — objective bertahan lebih lama dari satu run. Spec dan plan turunannya tunduk
> pada pernyataan ini.

## Amandemen — 2026-07-09 (fase Spec)

Dua kalimat di atas dicabut. Rincian di
[`docs/superpowers/specs/2026-07-09-hanoman-run-changes-preview-spec-144-design.md`].

1. **`git add -A` di index sementara menulis object pada setiap `GET`.** Kriteria sukses *"File baru
   wajib terlihat"* mengunci `GIT_INDEX_FILE=<temp> git add -A` + `git diff --cached --numstat <base>`.
   Perintah itu benar hasilnya tetapi salah efek sampingnya: `git add` menghash isi file dan menulis
   satu blob ke `.git/objects` untuk **setiap** file berubah, pada setiap panggilan. Diganti
   **`git add -A -N`** (*intent-to-add*) + `git diff --numstat <base>` (working tree, bukan `--cached`).
   Diverifikasi berdampingan: keluaran `--numstat` dan `--name-status` identik, sementara biayanya
   turun menjadi tepat satu object — blob kosong `e69de29…`, ditulis sekali lalu idempoten.
   Keharusan `git rev-parse --git-path index` tetap berlaku utuh.

2. **`services/scan.ts` justru presedennya.** Kriteria sukses *"Tidak memblok event loop"* menutup
   dengan *"`services/scan.ts` dan `services/branches.ts` bukan preseden yang boleh diikuti di sini."*
   Untuk `scan.ts` itu keliru: `listRepoDocs` (`server/src/services/scan.ts:16`) sudah memakai
   `execFile` yang di-promisify dengan `maxBuffer: 1 << 24`, justru dengan alasan yang sama. Ia
   preseden yang **harus** diikuti. Hanya `services/branches.ts` (masih `spawnSync`) yang bukan.

Sisa objective ini tetap berlaku utuh — termasuk larangan `spawnSync` dan kewajiban file baru terlihat.
