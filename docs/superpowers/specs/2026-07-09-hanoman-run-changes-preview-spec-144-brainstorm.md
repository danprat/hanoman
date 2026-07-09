# SPEC-144 — Runs menampilkan changes yang dibuat hanoman

**Status:** brainstorm — objective belum dikunci
**Date:** 2026-07-09
**Fase:** Brainstorm (feature: Brainstorm → Objective → Spec → Plan → Execute)
**Sumber:** brief · prioritas tinggi

## Objective (kandidat, belum dikunci)

Layar **Runs** menampilkan seluruh perubahan yang dibuat hanoman di run itu — daftar file,
commit-commit-nya, dan **preview isi source**-nya — secara realtime selagi run berjalan,
dan tetap dapat dibaca setelah run selesai. Hanya perubahan milik run tersebut.

## Kondisi sekarang: permukaannya sudah ada, isinya tidak pernah datang

Panel "File berubah" **sudah terpasang di UI** dan tidak pernah menampilkan apa pun. Bukan
karena bug, tapi karena tak ada satu pun produsen datanya. Rantainya lengkap kecuali ujung
pangkalnya:

| Lapis | Berkas | Status |
|---|---|---|
| Tipe event | `runner/src/types.ts:35` — `{ kind: "file"; path; add; del; status }` | ada |
| Tipe event (klien) | `src/src/api/client.ts:58` | ada |
| Persist | `server/src/runner/events-io.ts:63` — `files: [...run.files, e]` | ada |
| Kolom | `Run.files Json` / `Run.plan Json` | ada, di-seed `[]` — `server/src/queue.ts:48` |
| Render | `FileDiff` — `src/src/screens/RunsScreen.tsx:96` | ada |
| Verb terminal | `files` / `diff` — `server/src/routes/runs.ts:44` | ada |
| **Emitter** | `runner/src/run.ts` | **tidak ada** |

`runOne` tidak pernah memancarkan `kind: "file"` — dicari di seluruh repo, satu-satunya
kemunculan string itu adalah dua deklarasi tipe di atas. Jadi `Run.files` selamanya `[]`,
`hasWork` di `RunsScreen.tsx:240` selamanya `false`, panel diff tak pernah ter-mount, dan
`hanoman> diff` di terminal run selalu menjawab *"belum ada file berubah"* — kalimat yang
salah, bukan kalimat yang kosong.

`Run.plan` persis sama: di-seed `[]`, tak punya cabang di `persistEvent`, tak punya penulis.
`PlanSteps` sama matinya.

Ini **sisa mock SPEC-008** (de-mock sweep) yang tidak ikut tersapu.

### Kolom `Run.commitSha` bukan commit milik run

Mudah salah baca. `commitSha` diisi `ctx.sha` dari webhook — commit **pemicu**, bukan commit
**hasil** (`server/src/fire-trigger.ts:26`), dan dipakai hanya untuk melaporkan commit status
ke GitHub (`server/src/github/status.ts:40`). Untuk run manual ia `null`. Tak ada satu pun
kolom yang menyimpan commit yang **dibuat** run.

## Fakta git yang membentuk desain

Empat fakta dari `runner/src/run.ts` + `runner/src/git.ts`, semuanya diverifikasi terhadap
repo ini:

1. **Worktree lahir detached di sebuah commit.** `addWorktree` menjalankan
   `git worktree add --detach <path> <resolveCommit(branchFrom)>` (`git.ts:40`). Commit itu
   adalah basis run — satu-satunya titik nol yang benar.

2. **Run yang sukses menghapus jejaknya.** `run.ts:111-112` memanggil `commitAndPush` lalu
   `removeWorktree`. Worktree-nya lenyap.

3. **Run yang gagal/berhenti justru menyimpannya.** `runOne` `return failed()` / `stopped()`
   sebelum mencapai baris 111. Worktree-nya tetap di disk — dan itu persis run yang paling
   ingin diperiksa isinya.

4. **Branch hasil tidak awet.** `commitAndPush` tidak pernah membuat branch lokal saat
   `origin` ada; ia hanya `git push origin HEAD:refs/heads/<branchTo>` (`git.ts:53`). Repo ini
   punya `origin` yang nyata. Diperiksa hari ini: `git for-each-ref` mengembalikan **tiga** ref
   — `refs/heads/main`, `refs/remotes/origin/HEAD`, `refs/remotes/origin/main`. Nol ref
   `hanoman/run-*`, padahal `git log` memuat `Merge branch 'hanoman/run-8803'`. Branch run
   dihapus setelah di-merge.

Konsekuensinya tajam: **setelah run sukses, tidak ada worktree dan tidak ada branch.** Diff
`branchFrom...branchTo` yang dihitung belakangan akan menunjuk ref yang tidak ada lagi.

## Opsi — dari mana "changes" dibaca

**A. Diturunkan dari git saat dibaca, dengan `baseSha`+`headSha` disimpan di baris Run — rekomendasi.**

Dua kolom nullable baru pada `Run`:
- `baseSha` — ditulis saat `addWorktree` (commit tempat worktree di-detach).
- `headSha` — ditulis setelah `commitAndPush` berhasil.

Lalu isi diff-nya **tidak pernah disimpan**, dihitung dari git tiap request:

| Kondisi run | Sumber | Perintah |
|---|---|---|
| worktree masih ada (`queued`…`running`, `paused`, `failed`, `stopped`) | worktree | `git -C <wt> diff --numstat <baseSha>` + `git status --porcelain` untuk untracked |
| worktree sudah dihapus (`done`) | object database repo | `git -C <repoDir> diff --numstat <baseSha> <headSha>` |

Bifurkasinya bersih justru karena fakta 2 & 3 saling melengkapi: worktree hilang **hanya**
ketika `headSha` sudah ada.

**B. Pancarkan `kind: "file"` selama run, simpan ke `Run.files`.**
Menghidupkan kabel yang sudah terpasang, nol endpoint baru, live lewat SSE yang sudah ada.
Tapi: (i) ia salinan DB dari state filesystem — persis yang dibuang ADR-0011 dan ADR-0018;
(ii) `persistEvent` menulisnya **append-only** (`events-io.ts:65`), jadi file yang disunting
dua kali muncul dua baris dan file yang disunting lalu dikembalikan tetap terdaftar
selamanya; (iii) ia tak pernah bisa menyajikan **preview isi source**, hanya `+n −m`.

**C. Simpan seluruh diff (patch) di baris Run.**
Satu run bisa menyentuh ratusan file. Menaruh patch di kolom Json membuat setiap
`GET /runs` menyeret megabyte yang tak diminta.

→ **A.** Ia satu-satunya yang menjawab "preview seluruh source", dan satu-satunya yang tidak
menyimpan sesuatu yang bisa basi.

### Kenapa SHA boleh disimpan padahal coverage tidak

ADR-0011 dan ADR-0018 membuang salinan DB dari nilai yang **dapat dihitung ulang** dari disk.
`baseSha` dan `headSha` bukan itu. Keduanya fakta identitas yang lahir pada satu momen dan
**tak dapat direkonstruksi setelahnya**: worktree-nya dihapus, branch-nya dihapus, dan pesan
commit `hanoman <flow> <specId>` (`run.ts:111`) tidak memuat `runId` sehingga tidak dapat
dipakai mencari kembali. Yang disimpan adalah *penunjuk*; yang diturunkan adalah *isinya*.

Pembedaan itu juga alasan mengapa `Run.files` dan `Run.plan` layak **dibuang**, bukan diisi:
dua kolom itu memang salinan yang dapat dihitung ulang.

## Opsi — bentuk permukaan API

**1. Sepasang endpoint, mencerminkan docs — rekomendasi.**

```
GET /runs/:id/changes          -> { base, head, commits: [{sha, subject}], files: [{path, add, del, status}] }
GET /runs/:id/changes/*path    -> { path, status, diff, content }
```

Persis preseden `GET /projects/:id/docs` + `GET /projects/:id/docs/*path` — ringkasan dulu,
isi belakangan, dan isi hanya dimuat untuk file yang benar-benar dibuka. `commits` menjawab
kata "commit" di brief: `git log --format=… <base>..<tip>` memperlihatkan commit yang ditulis
agen di dalam worktree, bukan hanya commit penutup dari `commitAndPush`.

**2. Satu endpoint yang mengembalikan seluruh patch.** Sederhana, tapi run besar membuat satu
respons tak berbatas, dan panel harus menunggu semuanya untuk menggambar satu baris nama file.

**3. Tempelkan `files` ke `GET /runs/:id`.** Membuat setiap poll 3 detik memanggil `git diff`.

### Daftar file adalah gerbangnya

`GET /runs/:id/changes/*path` menerima path dari klien. Ia tidak boleh membaca berkas apa pun
yang diminta: **`path` harus ada di dalam daftar yang dikembalikan `GET /runs/:id/changes`.**
Daftar yang mengisi panel adalah daftar yang menjaga gerbang — idiom yang sama dengan
whitelist branch di SPEC-143, dan ia menutup path traversal tanpa validator terpisah yang bisa
ikut basi. Ini sekaligus menegakkan constraint brief: *hanya perubahan pada run tersebut*.

## Perangkap yang tercatat

- **Memperbaiki panel tanpa memperbaiki terminal.** Verb `files` dan `diff`
  (`server/src/routes/runs.ts:44`) membaca `run.files` yang sama. Menambal `FileDiff` saja
  meninggalkan terminal run tetap berbohong. Perbaiki di titik semua pembaca membacanya.

- **`spawnSync` menghentikan event loop.** SPEC-141 sudah mengukur ini: satu scan ≈ 21 ms, dan
  ia *stall seluruh proses*, bukan sekadar latency satu request. `git diff` pada run besar tak
  berbatas. Endpoint ini wajib memakai spawn **async**, dan `services/branches.ts` maupun
  `services/scan.ts` bukan preseden yang boleh diikuti di sini.

- **`hasWork` mematikan panel yang berdampingan.** `RunsScreen.tsx:240` menyalakan `PlanSteps`
  **dan** `FileDiff` dari `plan.length || files.length`. Begitu `files` pindah ke endpoint,
  gate itu harus dipecah, atau `PlanSteps` akan tampil sebagai kartu "Plan · 0 langkah" pada
  setiap run.

- **`--numstat` pada berkas biner** mengeluarkan `-` untuk add/del, bukan angka.

- **Commit yang tak terjangkau.** Run yang gagal *setelah* worktree-nya dihapus manual, atau
  run sukses yang branch-nya dihapus sebelum di-merge, meninggalkan `headSha` yang objeknya
  bisa hilang saat `git gc`. Katakan apa adanya ("commit tak terjangkau"), jangan tampilkan
  daftar kosong yang terbaca seperti "hanoman tidak mengubah apa pun".

## Ruang lingkup

**Termasuk:** kolom `Run.baseSha` + `Run.headSha` + migration + ADR; `GitOps` mengembalikan
kedua SHA itu; event untuk mempersistensikannya; `GET /runs/:id/changes` dan
`GET /runs/:id/changes/*path`; panel changes + preview source di `RunsScreen`; verb `files`/`diff`
terminal dirujukkan ke sumber yang sama; pembuangan kolom `Run.files` beserta `kind: "file"` di
`RunEvent`, `persistEvent`, dan tipe klien.

**Tidak termasuk:** `Run.plan` dan `PlanSteps` — sama-sama mati, tapi milik brief lain;
di sini ia hanya disentuh sejauh memisahkan gate `hasWork`. Mengedit file dari panel changes.
Diff antar-run. Menahan worktree agar tidak dihapus. Komentar/review inline.

## Pertanyaan terbuka — perlu jawaban manusia sebelum objective dikunci

1. **Apakah "preview seluruh source" berarti isi file penuh, atau diff berkonteks penuh?**
   Usulan: kembalikan keduanya dalam satu respons (`diff` unified + `content` file setelah
   perubahan), biarkan UI yang memilih tab. Satu panggilan git tambahan per file yang dibuka.

2. **File yang dihapus dan biner.** `content` untuk file terhapus adalah `null`; untuk biner,
   tolak preview dan tampilkan ukurannya saja. Perlu konfirmasi bahwa itu memadai.

3. **Batas ukuran.** Berapa besar sebuah file boleh sebelum preview-nya dipotong? Usulan:
   potong di 512 KB dengan penanda eksplisit, jangan diam-diam.

4. **ADR untuk dua kolom SHA + pembuangan `Run.files`.** `CLAUDE.md` mensyaratkan
   "migration + ADR" untuk setiap perubahan skema. Usulan: ya — keputusannya bukan "tambah
   kolom", melainkan *SHA disimpan, diff diturunkan*, dan itu menajamkan batas ADR-0011/0018.

## Catatan fase

Fase Brainstorm tidak menyentuh `internal/docs/**`, jadi tidak ada perubahan pada index Source
of Truth (`internal/docs/README.md`). Mengikuti preseden SPEC-143: artefak yang masuk index
adalah `internal/docs/operations/spec-144-*-objective.md`, dan itu keluaran fase **Objective**,
bukan fase ini.
