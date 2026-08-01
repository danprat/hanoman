# Audit SPEC-475 — backlog berantai tetap diluncurkan scheduler sebelum dependency-nya ter-merge

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** critical · **Tanggal:** 2026-08-01
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> "Jika ada backlog yang saling dependency tunggu sampai merge agar ketika start lagi dari scheduler
> sudah menggunakan branch terupdate."
> Diharapkan: "jangan dulu start sesi baru yg scheduler jika backlognya berantai memiliki dependency
> ke backlog yg sedang running sampai lead hanoman/human melakukan merge."

Gerbangnya **sudah ada**: SPEC-447 · ADR-0093 memasang `Spec.dependsOn` + resolver tunggal
`services/spec-deps.ts` + dua gerbang (peluncuran & governor), dan objective-nya sudah berbunyi
"selesai **DAN di-merge**". Audit ini karena itu tidak mencari fitur yang belum ada — ia mencari
kenapa gerbang yang ada tak menahan apa pun.

## Ringkasan temuan

Gerbang ADR-0093 punya **dua** alasan blokir yang berurutan: `unfinished` (`stage ≠ done`) lalu
`unmerged` (commit dependency belum ada di basis). Yang pertama bekerja. **Yang kedua tak pernah
sekali pun menyala di produksi** — bukan karena jarang terpicu, tapi karena buktinya tak pernah ada.

`blockersFor` (`spec-deps.ts:49`) menilai merged-ness dari **`Spec.headSha`** — satu-satunya
petunjuk "commit mana hasil kerja item itu". Kolom itu ditulis di **satu tempat saja**:
`DELETE /terminal/sessions/:id` (`routes/terminal.ts:386-387`), yaitu operator menutup sesi secara
manual. Sementara `stage = "done"` dipersist di **tiga** tempat, dan dua di antaranya — persis dua
yang melayani jalur otonom — tak menulis `headSha` sama sekali:

| # | Jalur persist `stage = done` | Menulis `headSha`? | Kapan menyala |
|---|---|---|---|
| 1 | `routes/terminal.ts` `advanceStage` (DELETE sesi) | **ya** | operator menutup sesi dengan tangan |
| 2 | `scheduler/reconcile.ts:38` | **tidak** | tiap tick, untuk tiap sesi scheduler |
| 3 | `live-specs.ts:42` (GET `/specs` + siar WS) | **tidak** | tiap frame siar, untuk sesi apa pun |

Lalu `session-launch.ts:160` **me-null-kan** `headSha` di tiap kelahiran sesi. Hasilnya keadaan
mantap: begitu sebuah backlog selesai lewat jalur otonom, barisnya berbunyi
`stage = "done" ∧ headSha = NULL` — dan `blockersFor` membaca `headSha` null sebagai **SIAP**
(ADR-0093 gotcha 1). Aturan itu ditulis untuk item yang hanoman **tak pernah** buatkan worktree
(selesai manual / pra-ADR-0030), tapi resolvernya tak pernah membedakan "tak ada worktree" dari
"ada worktree, ujungnya tak tercatat" — padahal barisnya sendiri membawa pembedanya (`baseSha`).

Akibatnya gerbang `unmerged` bukan longgar, melainkan **mati**: dependent diluncurkan pada tick
governor berikutnya sesudah dependency-nya `done`, dari basis yang secara fisik belum memuat
pekerjaan itu — persis kerusakan yang jadi alasan ADR-0093 ditulis.

| # | Cacat | Akibat |
|---|---|---|
| A | `headSha` tak pernah ditulis pada jalur otonom (`reconcile.ts`, `live-specs.ts`) — `reconcile` bahkan **sudah menghitung nilainya** untuk `SessionResult.commitSha` (`reconcile.ts:51`) lalu membuangnya | 159 dari 210 spec `done` ber-worktree (**75,7 %**) tak punya ujung kerja tercatat |
| B | `blockersFor` membaca "tak ada `headSha`" sebagai "siap", tanpa melihat `baseSha` maupun branch sesi yang masih ada | gerbang `unmerged` fail-open — melanggar prinsip fail-closed ADR-0093 gotcha 2 di titik yang justru paling sering terlewati |

## Bukti — gerbang `unmerged` tak pernah menyala

`SchedulerQueueItem` di DB hidup (`~/.hanoman/hanoman.db`), seluruh riwayat 56 baris:

| alasan pada `note` | jumlah |
|---|---|
| `belum ter-merge` (`unmerged`) | **0** |
| `belum selesai` (`unfinished`) | 17 |
| `tak ditemukan` (`missing`) | 0 |

Nol, bukan sedikit. Separuh gerbang yang menjawab bunyi objective SPEC-447 belum pernah dieksekusi
sekali pun sejak fiturnya mendarat.

## Bukti — rantai raciklaba.id, terukur dari keadaan hidup

`raciklaba.id` adalah **satu-satunya** project yang memakai `dependsOn` (17 spec), berbentuk rantai
lurus SPEC-453 → 454 → 455 → … → 470. Dua kesempatan pertama gerbangnya, dua-duanya lolos.

Baris `Spec` (waktu UTC):

| id | stage | dependsOn | baseSha | headSha | started | done (updatedAt) |
|---|---|---|---|---|---|---|
| SPEC-453 | done | — | `3104f4ee` | **NULL** | 00:01:26 | 00:42:17 |
| SPEC-454 | done | `["SPEC-453"]` | **`3104f4ee`** | **NULL** | **00:42:23** | 02:07:31 |
| SPEC-455 | done | `["SPEC-454"]` | `f843999` | `3160e8c` | **02:07:35** | 02:52:21 |
| SPEC-456 | brainstorming | `["SPEC-455"]` | — | — | — | — |

Tiga fakta yang mengunci diagnosis:

1. **Jarak peluncuran 6 detik.** SPEC-453 `done` pukul 00:42:17; SPEC-454 — yang bergantung
   padanya — diluncurkan governor pukul **00:42:23**. Satu tick governor (10 dtk), jauh sebelum
   manusia mana pun bisa merge.
2. **Basisnya identik.** `SPEC-454.baseSha` = `3104f4ee` = `SPEC-453.baseSha`. Worktree dependent
   lahir dari commit yang **sama persis** dengan worktree dependency-nya. Diverifikasi langsung di
   checkout `~/Documents/Nafanesia/raciklaba.id`:

   ```
   git merge-base --is-ancestor hanoman/spec-453 3104f4ee   → 1 (TIDAK)
   ```

   `hanoman/spec-453` berisi **15 commit** yang tak satu pun ada di basis SPEC-454.
3. **Terulang di mata rantai berikutnya.** `SPEC-455.baseSha` = `f843999` (= tip
   `hanoman/spec-453`), sementara dependency-nya SPEC-454 bertip `d3d6af5` (33 commit):

   ```
   git merge-base --is-ancestor hanoman/spec-454 f843999    → 1 (TIDAK)
   ```

Kapan merge sungguhan terjadi? Dari `git log --merges` di repo itu:

| commit | waktu | isi |
|---|---|---|
| `f020cc6` | 2026-08-01 **09:11:25** +07 | merge SPEC-454 |
| `f269d46` | 2026-08-01 **09:53:53** +07 | merge SPEC-455 |

SPEC-454 diluncurkan **07:42 +07** dan SPEC-455 **09:07 +07** (waktu lokal dari stempel UTC di
tabel) — keduanya **selesai** sebelum merge-nya terjadi. Jarak antara peluncuran SPEC-454 dan merge
dependency-nya ke main: **± 8,5 jam**.

Catatan pada `note` antrean, dibaca apa adanya, memperlihatkan gerbang berhenti di setengah jalan:

```
SPEC-454  done    note="menunggu SPEC-453 (belum selesai)"   launched 00:42:23
SPEC-455  done    note="menunggu SPEC-454 (belum selesai)"   launched 02:07:36
SPEC-456  queued  note="menunggu SPEC-455 (belum selesai)"
```

`note` adalah tulisan **terakhir** sebelum peluncuran. Ia berbunyi `belum selesai` — bukan
`belum ter-merge` — untuk kedua item yang terlanjur lahir. Begitu `stage` jadi `done`, gerbang
tak punya alasan kedua untuk menahan.

## Bukti — kenapa `headSha` kosong: tiga jalur, satu penulis

- **SPEC-453 tak punya baris antrean sama sekali** (`select count(*) … where specId='SPEC-453'` →
  `0`) — ia di-Start manual. Jadi `reconcile()` (yang hanya menyapu `listQueue("launched")`) tak
  pernah menyentuhnya; yang mempersist `done`-nya adalah **`live-specs.ts`**, jalur ketiga.
  Itulah sebabnya perbaikan penulis tak cukup di `reconcile` saja.
- **`integrate-main` milik lead melepas pane lewat `killSession` LANGSUNG**, bukan
  `DELETE /terminal/sessions/:id` — sengaja, supaya worktree tetap utuh (SPEC-451, AC-32a). Efek
  sampingnya: satu-satunya penulis `headSha` justru dilewati oleh jalur penyelesaian paling otonom
  yang dimiliki hanoman.
- **Pane sesi sukses tak pernah mati sendiri** (SPEC-433), jadi tak ada mekanisme lain yang
  memicu penutupan sesi.

Distribusi di DB hidup mengukur akibatnya:

| `Spec` `stage = done` | jumlah |
|---|---|
| `baseSha` **SET** (hanoman jelas membuat worktree) & `headSha` **NULL** | **159** |
| `baseSha` SET & `headSha` SET | 51 |
| `baseSha` NULL & `headSha` NULL | 29 |
| `baseSha` NULL & `headSha` SET | 5 |

**75,7 %** item `done` yang worktree-nya dibuat hanoman tak punya ujung kerja tercatat. Fallback
"tak ada `headSha` → siap" karena itu bukan jalur pinggiran untuk data lama — ia **jalur utama**.

## Kontrol negatif

- Rantai yang sama berhenti dengan benar saat alasan pertamanya berlaku: SPEC-456…470 tertahan
  `queued` dengan `note` "menunggu … (belum selesai)" sejak 00:01:30 — resolver, governor, dan
  penulisan `note` semuanya berfungsi. Yang absen persis satu: alasan `unmerged`.
- SPEC-455 **punya** `headSha` (`3160e8c`, sesinya ditutup lewat DELETE) dan tip itu memang sudah
  ter-merge ke main. Karena itu SPEC-456 — dependent-nya — akan terbebaskan dengan benar hari ini.
  Jalur `headSha` terisi bekerja sebagaimana dirancang; masalahnya kolom itu hampir tak pernah terisi.
- Test yang ada **mengunci bug-nya sebagai kontrak**: `server/test/spec-deps.test.ts:68`
  — `it("done tanpa headSha → siap (tak ada commit yang bisa di-merge)")` — pola yang sama persis
  dengan test SPEC-433 yang dulu mengunci "sesi hidup tak boleh menampilkan Selesai".

## Keputusan pasca-audit

**Spec & Plan `skipped` → langsung Execute.** Akar masalahnya tunggal dan terukur, perbaikannya
kecil dan tertutup di dalam resolver + dua jalur persist yang sudah ada. **Tanpa** ADR baru, tanpa
migration, tanpa endpoint/knob baru: ADR-0093 tidak diamandemen melainkan **ditegakkan** — dokumen
ini jadi doc-of-record-nya, sejalan dengan SPEC-448/451/452/472.

Perbaikannya dua lapis, dan keduanya wajib — masing-masing sendirian menukar bug ini dengan bug
kebalikannya:

1. **Penulis (akar).** Satu helper bersama `recordHeadSha()` merekam ujung kerja saat `stage`
   mencapai `done`, dipanggil dari **ketiga** jalur persist. Menyalin logikanya ke tiap pemakai
   adalah kelas bug yang sudah menggigit repo ini dua kali (SPEC-431 `baseSha IS NULL`, SPEC-448
   `rootBypassEnv`), jadi satu definisi, tiga call site. `reconcile` memakai ulang nilai yang sudah
   dihitungnya untuk `SessionResult`.
2. **Pembaca (fail-closed).** `blockersFor` berhenti membaca "tak ada `headSha`" sebagai siap
   begitu saja. Ujung kerja dependency dicari `headSha ?? tip branch sesinya`
   (`hanoman/<sessionIdForSpec(id)>`, deterministik per ADR-0032) — dan hanya bila **keduanya**
   tak ada barulah item dibaca siap. Tanpa lapis ini, perbaikan (1) tetap gagal untuk 159 baris
   yang sudah telanjur kosong, untuk sesi yang worktree-nya lenyap sebelum sempat direkam, dan
   untuk `headSha` yang di-null-kan peluncuran ulang.

Tanpa (2), gerbangnya tetap fail-open untuk data yang sudah ada. Tanpa (1), (2) mengunci rantai
**selamanya** karena bukti yang ditunggunya tak pernah datang.

### Kenapa tip branch, bukan sekadar `baseSha != null`

Pembeda `baseSha` cukup untuk menjawab "hanoman pernah membuat worktree?", tapi jawabannya
"terblokir" tanpa jalan keluar: kalau `headSha` memang takkan pernah terisi untuk baris lama,
dependent-nya mandek permanen dan otomasi tak punya `force` (ADR-0093 keputusan 4). Tip branch
menjawab pertanyaan yang sebenarnya — "adakah commit hasil kerja item itu, dan sudahkah ia ada di
basis saya?" — dan menyembuhkan baris lama dengan benar, bukan dengan kebetulan:

| keadaan dependency | tip ditemukan? | vonis | benar karena |
|---|---|---|---|
| selesai otonom, `headSha` kosong, branch masih ada | ya (branch) | ikut uji merge | itu memang kerjanya |
| lama, branch sudah dihapus **karena ter-merge** (SPEC-360) | tidak | siap | penghapusan branch itu sendiri buktinya |
| `done` manual, hanoman tak pernah bikin worktree | tidak | siap | gotcha 1 ADR-0093 dipertahankan, kini dengan alasan yang tepat |
| worktree lenyap sebelum `headSha` sempat direkam | ya (branch) | ikut uji merge | fail-closed, bukan fail-open |

**Konsekuensi yang diterima:** operator yang me-*merge* dengan **squash** membuat tip branch tak
pernah jadi ancestor basis → dependent terbaca `unmerged` terus. Itu pembacaan yang memang dipilih
ADR-0093 ("tak bisa dipastikan" ≠ "aman"), alasannya terlihat di UI sebagai `blockedBy`, dan jalan
keluarnya sudah ada: `force` di jalur manusia (`POST /terminal/sessions`). `integrate.ts` sendiri
memakai `git merge`, jadi jalur hanoman tak pernah menghasilkan keadaan ini.

## Catatan lintas-temuan

- Ini pengulangan **ketiga** dari pola "satu predikat/efek hidup di satu call site sementara N call
  site melakukan pekerjaan yang sama": SPEC-431 (`baseSha IS NULL` disalin ke dua pemakai),
  SPEC-448 (`rootBypassEnv` hanya di `pty.ts`, tak di `brain.ts`), dan kini `headSha` hanya di
  `terminal.ts` sementara `stage = done` dipersist di tiga tempat. Yang membedakan kasus ini:
  divergensinya bukan pada *predikat*, tapi pada **efek samping** yang menemani transisi — dan efek
  samping tak punya tipe yang bisa memaksanya konsisten.
- `headSha` yang kosong juga memangkas rentang review ADR-0030: `routes/specs.ts:333` menuntut
  `baseSha` **dan** `headSha` sebelum men-diff dari SHA tersimpan, jadi 159 item itu selama ini
  jatuh ke fallback worktree. Perbaikan (1) menyembuhkannya sebagai efek samping; itu bukan
  perluasan scope, melainkan konsekuensi memulihkan satu kolom yang memang seharusnya terisi.
- ADR-0093 gotcha 1 tidak dicabut — ia dipersempit dari "tak ada `headSha`" menjadi "tak ada jejak
  kerja sama sekali". Bunyi aslinya tetap benar untuk kasus yang ia maksud.
