# ADR-0093 — Dependency antar-backlog: kolom `dependsOn` + gerbang "selesai & ter-merge" di dua titik

- Status: Accepted
- Tanggal: 2026-07-31
- SPEC: SPEC-447 (backlog yang saling dependency)
- Terkait: **mempersempit [0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md)** — satu
  gerbang lagi di governor, sejajar gerbang SPEC-431; **mengikuti**
  [0019](0019-sha-disimpan-diff-diturunkan.md) (merged-ness diturunkan dari git, tak disimpan) dan
  [0018](0018-coverage-nilai-turunan.md) (`blockedBy` nilai turunan, tanpa kolom); **menyentuh**
  [0045](0045-skema-sync-synclog-version-stamp.md) (satu kolom masuk whitelist field) dan
  [0002](0002-git-worktree-isolation.md) (justru isolasi worktree yang membuat urutan ini penting);
  **tidak menyentuh** [0037](0037-cabut-guardrail-safety.md) — ini pagar data di permukaan API
  hanoman sendiri, bukan hook deny di sesi agen; **tidak mencabut** apa pun.

## Konteks

Backlog hanoman tak pernah punya konsep urutan wajib. Tiga jalur peluncuran memperlakukan setiap
item sebagai independen:

| Jalur | Predikat sebelum ADR ini | Akibat |
|---|---|---|
| `sources/backlog.ts` (checker scheduler) | `UNSTARTED_SPEC_WHERE` | seluruh backlog siap-kerja masuk antrean sekaligus |
| `governor.drain()` | prioritas → FIFO, sampai `maxConcurrent` | N item jalan **paralel**; urutan antrean bukan gerbang |
| `POST /terminal/sessions` (Start manual) | — | operator bisa memulai item yang basisnya belum ada |

`lead/pulse.ts::orderProject` (ADR-0091) memang menata **urutan** antrean, tapi urutan bukan
gerbang: governor menguras sampai cap, jadi item ke-2 dan ke-3 lahir sebelum item ke-1 selesai.
ADR-0069 (breakdown PRD → backlog paralel) bahkan menuliskan asumsi lamanya secara eksplisit —
"backlog hasil breakdown **by-construction independen** → jalan paralel". Yang tak pernah ada adalah
cara menyatakan bahwa dua item **tidak** independen.

Konsekuensinya bukan sekadar urutan yang berantakan. Sesi lahir di worktree `--detach` dari
`branchFrom` (ADR-0002). Kalau B bergantung pada A dan A belum ter-merge ke `branchFrom`, worktree B
**secara fisik tak memuat pekerjaan A** — agen B membangun di atas basis yang salah, dan konflik
integrasi baru muncul berjam-jam kemudian. Karena itu objective-nya berbunyi "selesai **dan di
merge**", bukan sekadar "selesai".

## Keputusan

**1. Relasi disimpan sebagai kolom `Spec.dependsOn` (`Json?`, array id spec), bukan tabel join.**
SQLite melarang scalar list, tapi `Json` sudah dipakai `payload`, dan kolom ikut whitelist sync yang
sudah ada tanpa entitas/`PG_ORDER` baru. Yang hilang adalah FK; itu dibayar di dua tempat: validasi
di boundary route, dan pembersihan saat spec dihapus (Keputusan 5).

**2. "Siap" = `stage = "done"` DAN commit-nya sudah ada di branch basis si dependent.** Merged-ness
adalah **nilai turunan git**, bukan kolom: `realGit.isAncestor(repoDir, dep.headSha, base)` →
`git merge-base --is-ancestor`, dengan `base = spec.branchFrom ?? "HEAD"` — **ref yang sama persis**
yang akan dipakai `realGit.addWorktree` saat sesinya lahir. Ini mengikuti ADR-0019: SHA disimpan,
hubungan antar-SHA dihitung. Konsekuensi yang diinginkan: merge yang dilakukan operator di luar
hanoman (langsung di terminal, di mesin lain, lewat PR) tetap terbaca — tak ada kolom "sudah
di-merge" yang bisa basi.

**3. Satu resolver, tiga pembaca.** `server/src/services/spec-deps.ts` memegang seluruh matriks
keputusan sebagai fungsi **murni** (`blockersFor`), dengan glue DB/git tipis di atasnya. Ia dipakai
gerbang peluncuran, gerbang otomasi, dan permukaan baca. Menyalin predikatnya ke pemakai adalah
kelas bug yang sudah terjadi di repo ini — SPEC-431: `baseSha IS NULL` disalin ke dua tempat lalu
salah dengan cara yang sama persis di keduanya.

**4. Dua gerbang, satu jalan paksa.**
- `startSpecSession` (titik cekik SEMUA peluncuran sesi backlog) melempar `LaunchError` ber-`kind:
  "blocked"` + daftar `blockers`, kecuali `opts.force`. Ia berdiri **sesudah** cek pane hidup —
  re-attach ke sesi yang sedang berjalan tak boleh ikut ditolak, itu menyembunyikan pekerjaan yang
  justru perlu dilihat operator — dan **sebelum** `killSession`/worktree, supaya penolakan tak
  meninggalkan efek apa pun.
- `governor.drain` punya gerbang **kedua**, pola SPEC-431: `GovernorDeps.blockers` (wajib, bukan
  opsional). Item terblokir **dilewati**; barisnya tetap `queued` dengan `note` alasan, slot **tidak**
  terpakai, dan drain lanjut ke item berikutnya. Bukan `failed`: pemblokirnya akan selesai, dan
  `enqueue` yang `upsert(update:{})` tak bisa menghidupkan kembali baris yang sudah ditutup.
- `force` **hanya** ada di jalur manusia (`POST /terminal/sessions` → 409 tanpa itu). Otomasi —
  governor dan denyut lead — tak punya jalan paksa. Ini pembacaan yang tepat dari "manusia terakhir
  yang memutuskan": operator boleh melewatinya sesudah melihat daftar pemblokirnya; robot tidak.

**5. Integritas ditegakkan di boundary, plus pembersihan saat hapus.** `POST /specs` &
`PATCH /specs/:id` menolak **400** untuk id yang tak ada, lintas project, referensi ke diri sendiri,
dan siklus (reachability atas graf project SESUDAH perubahan). `DELETE /specs/:id` **mencabut** id
itu dari `dependsOn` seluruh dependent-nya. Tanpa langkah terakhir, menghapus satu item mengunci
dependent-nya selamanya dengan alasan `missing` yang tak bisa diperbaiki dari UI.

**6. `dependsOn` sengaja DI LUAR gerbang edit SPEC-186** (`stage = brainstorming ∧ baseSha = null`).
Gerbang itu melindungi konten yang sudah jadi dasar kerja sesi berjalan; `dependsOn` hanya
menggerbangi **peluncuran berikutnya**. Menguncinya berarti item yang terlanjur terblokir karena
salah tulis hanya bisa dibebaskan dengan menghapusnya.

**7. `blockedBy` adalah nilai turunan yang dihias di `liveSpecs()`**, bukan kolom — dan dihias di
sana justru karena `liveSpecs` dipakai **GET `/specs` DAN grup siar WS `specs`** (SPEC-199).
Menghias hanya salah satunya membuat badge berkedip tiap frame WS tiba.

## Konsekuensi

- **Berbiaya nol saat tak dipakai.** Resolver keluar lebih awal untuk spec ber-`dependsOn` kosong,
  jadi backlog yang tak memakai dependency tak pernah memanggil git maupun query tambahan.
- Jawaban `isAncestor` dimemoisasi 15 detik per `(repoDir, sha, ref)`: merged-ness hanya berubah saat
  ada integrate/push, sementara pembacanya adalah loop siar 1 detik.
- Denyut lead menyaring item terblokir sebelum menghitung himpunan siap-kerja — perluasan gerbang
  aktionabilitas SPEC-432: menata pekerjaan yang takkan pernah diluncurkan governor membakar satu
  giliran agen untuk nol hasil.
- Dependency **lintas project ditolak** (menuntut merge lintas repo). Blocking **transitif** tak
  perlu diwujudkan: A→B→C, `B` tak mungkin `done` sebelum `C`, jadi satu tingkat sudah cukup dan
  resolver bebas rekursi.
- Tak ada mekanisme "auto-launch saat pemblokir selesai": governor menguras tiap 10 detik dan
  barisnya tetap `queued`, jadi ia lahir sendiri pada tick berikutnya.
- `POST /specs/batch` (ADR-0069) tak berubah — hasil breakdown tetap independen by construction;
  operator bisa menambahkan dependency sesudahnya lewat PATCH.

## Gotcha yang wajib diingat

1. **Dependency `done` ber-`headSha` null adalah SIAP, bukan "belum".** `headSha`/`baseSha` null
   berarti hanoman tak pernah membuatkan worktree untuk item itu — selesai sebelum ADR-0030,
   ditandai selesai manual, atau dikerjakan di checkout lain (terukur di SPEC-431: 27 `Spec` `done`
   ber-`baseSha` null di DB produksi). Membacanya sebagai "belum ter-merge" akan mengunci backlog
   lama **selamanya**, karena tak ada commit yang bisa dijadikan bukti.
2. **Fail-closed saat git tak bisa menjawab.** Ref tak resolve, repo tak terbaca, project belum
   di-bind → dibaca **belum merged**. "Tak bisa dipastikan" tak boleh terbaca sebagai "aman"; dan
   keadaannya tetap terlihat karena alasannya ikut ke UI sebagai `unmerged`.
3. **`"dependsOn"` WAJIB ada di `FIELDS.spec`** (`services/sync.ts`). Tanpa itu client kehilangan
   urutannya dan akan meluncurkan pekerjaan yang di hub terblokir — kelas bug yang sama persis
   dengan `createdAt` di ADR-0090, dan sama senyapnya (`upsert` yang tak menyebut kolom tetap
   berhasil).
4. **`GovernorDeps.blockers` sengaja WAJIB, bukan opsional.** Satu-satunya pembangun produksi adalah
   `prodDeps`, jadi tipe wajib = jaminan kompilasi bahwa gerbangnya tak bisa lupa dipasang. Dep
   opsional yang diam-diam mengembalikan "tidak terblokir" adalah pola fail-open yang sudah pernah
   menggigit repo ini.
5. **Kolom `Json` menyeberang lewat sync dari client versi lain**, jadi ia dibaca defensif
   (`dependsOnOf`): bukan array / elemen bukan string → dibuang; duplikat dibuang; urutan dijaga.
6. **`Checkbox` design system bukan `<input type=checkbox>`** — `onClick` hidup di `<span>` di dalam
   `<label>`, jadi test yang mengklik label-nya "lulus" tanpa terjadi apa-apa (pelajaran SPEC-299/360;
   terulang saat menulis test picker ini dan tertangkap hanya karena asersinya memeriksa payload).

## Alternatif yang ditolak

- **Tabel join `SpecDependency`.** FK sungguhan dan query balik murah, tapi harganya entitas sync
  baru + `PG_ORDER` + migration tulis tangan + permukaan API tambahan — untuk manfaat yang tak
  terpakai: relasinya satu tingkat, tanpa metadata edge, dan selalu dibaca per-spec.
- **Menyelipkan ke `Spec.payload`.** Tanpa migration sama sekali, tapi merusak ikatan source ↔ bentuk
  payload tiga-arah (brief/qa/goal) yang dijaga `superRefine`, dan dependency jadi tak terbaca query.
- **`stage = done` saja, tanpa cek merge.** Nol pemanggilan git, tapi mengabaikan separuh bunyi
  objective dan tepat meninggalkan bug yang paling mahal: worktree dependent lahir dari basis yang
  belum memuat pekerjaan dependency-nya.
- **Blokir keras untuk semua jalur, tanpa `force`.** Paling tegas, tapi menjebak operator saat
  dependency salah tulis atau merge dilakukan di tempat yang tak terbaca git lokal.
