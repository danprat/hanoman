# Audit SPEC-431 — scheduler mengambil backlog yang sudah selesai dan mengerjakannya lagi

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** critical · **Tanggal:** 2026-07-31
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> "Scheduler backlog ambil yang hanya belum mulai saja — saat ini yang sudah selesai pun di ambil
> backlognya dan dikerjakan di terminal"

## Ringkasan temuan

Checker `backlog` (SPEC-295) memakai **`baseSha IS NULL`** sebagai definisi "belum mulai". Predikat
itu **salah sejak lahir**: `baseSha` baru ada sejak SPEC-176/ADR-0030 dan hanya ditulis di titik
peluncuran sesi (`services/session-launch.ts`), jadi **setiap backlog item yang tuntas tanpa pernah
diluncurkan hanoman** — item lama yang selesai sebelum kolomnya ada, item yang ditandai selesai
manual, item yang dikerjakan di checkout lain — permanen tak terbedakan dari item yang belum
pernah disentuh. Kolom `stage`, satu-satunya kebenaran "sudah selesai", **tak pernah dibaca
checker**.

Akibatnya scheduler memasukkan item `stage = "done"` ke antrean, governor meluncurkannya lewat
`startSpecSession`, dan karena `spec.stage === "done"` sesi itu lahir di jalur **`isContinue`**
(SPEC-172 "reopen") — sesi tmux sungguhan, worktree baru, branch `hanoman/spec-<n>` baru, prompt
"lanjutkan pekerjaan ini". Persis yang dikeluhkan: pekerjaan yang sudah selesai dikerjakan ulang di
terminal.

| # | Cacat | Akibat |
|---|-------|--------|
| A | `checkBacklog` menyaring `baseSha: null` **tanpa melihat `stage`** | item `done` masuk antrean (**akar**) |
| B | `orderProject` (hanoman-lead, denyut) memakai predikat yang **sama persis** | lead ikut mengantrekan item `done`, dan menghabiskan giliran untuk mengurutkannya |
| C | Governor tak punya gerbang terakhir sebelum `launch` | 27 baris antrean basi tetap akan meluncur meski (A) & (B) diperbaiki |

## Bukti — (A) 27 dari 29 baris antrean menunjuk item yang sudah selesai

DB produksi lokal (`~/.hanoman/hanoman.db`), dibaca read-only saat audit ini ditulis. 244 `Spec`,
218 di antaranya `stage = "done"`.

```sql
SELECT stage, (baseSha IS NULL) AS noBase, COUNT(*) FROM Spec GROUP BY 1,2;
```

| stage | `baseSha IS NULL` | jumlah |
|---|---|---|
| brainstorming | ya | 21 |
| brainstorming | tidak | 1 |
| spec-ready | tidak | 1 |
| executing | tidak | 1 |
| **done** | **ya** | **27** |
| done | tidak | 191 |

27 item **selesai** ber-`baseSha` null. Semuanya milik dua project yang `schedulerOptIn = 1`
(20 `hanoman`, 7 `crm-tumbuh-ai`) — jadi semuanya memenuhi filter checker.

Antrean membuktikannya sudah terjadi:

```sql
SELECT q.status, s.stage, COUNT(*) FROM SchedulerQueueItem q JOIN Spec s ON s.id = q.specId
WHERE q.status = 'queued' GROUP BY 1,2;
```

| status antrean | stage spec | jumlah |
|---|---|---|
| queued | **done** | **27** |
| queued | brainstorming | 2 |

Dua puluh tujuh dari dua puluh sembilan baris antrean adalah pekerjaan yang sudah selesai. Hanya
`SPEC-291` dan `SPEC-384` yang benar-benar pekerjaan belum mulai.

## Bukti — enam sesi nyata sudah lahir di atas item yang selesai

Seluruh 35 baris antrean lahir dari **satu sapuan checker** pada
`enqueuedAt = 1785494189375…430` = **2026-07-31T10:36:29Z** (17:36 WIB). Governor langsung men-drain
enam di antaranya:

| spec | stage spec | sesi | `launchedAt` | `endedAt` |
|---|---|---|---|---|
| SPEC-146 Detail Project | done | `spec-146` | 10:36:30Z | 10:40:55Z |
| SPEC-147 Favicon | done | `spec-147` | 10:36:30Z | 10:40:57Z |
| SPEC-148 Automation | done | `spec-148` | 10:36:31Z | 10:41:00Z |
| SPEC-149 Retry Runs | done | `spec-149` | 10:36:32Z | 10:41:03Z |
| SPEC-158 Split Terminal | done | `spec-158` | 10:36:32Z | 10:41:07Z |
| SPEC-159 Runs Orders | done | `spec-159` | 10:38:59Z | 10:41:08Z |

Enam baris `SessionHistory` (ADR-0079) membuktikan sesinya benar-benar hidup ±4,5 menit — bukan
peluncuran yang gagal di depan pintu.

**Bahwa mereka sudah `done` SEBELUM diluncurkan** dibuktikan tiga hal yang saling menguatkan:

1. `createdAt` keenamnya = `1784050361829`, satu batch impor lama — jauh sebelum sapuan hari ini.
2. `Notification` `done:SPEC-146…159` terbit pada `1785494199385` = **10:36:39Z**, *sembilan detik*
   sesudah peluncuran. Itu tick rekonsiliasi pertama (`reconcile.ts`) yang membaca
   `stage === "done"` lalu memanggil `recordCompletion` + `markDone`. Tak ada pipeline qa yang
   tuntas dalam sembilan detik; stage-nya memang sudah `done` saat sesi lahir.
3. `startedAt` keenamnya baru terisi **oleh peluncuran itu** (`1785494190116…`), padahal ADR-0090
   mendefinisikannya sebagai "kapan sesi PERTAMA lahir untuk item ini". Sebelum sapuan itu ia null —
   bukti bahwa item-item ini memang belum pernah punya sesi, sekaligus **kerusakan data
   sampingannya**: enam item yang selesai berbulan-bulan lalu kini mengaku mulai dikerjakan
   2026-07-31.

Satu sesi (`spec-148`) bahkan sempat menerbitkan notifikasi `decision` — sesi itu berhenti bertanya
kepada manusia tentang pekerjaan yang sudah selesai.

## Kenapa `baseSha` bukan proksi "belum mulai"

`baseSha` menjawab pertanyaan **"apakah hanoman pernah membuatkan worktree untuk item ini"**, bukan
**"apakah pekerjaan item ini masih perlu dikerjakan"**. Keduanya berpisah di tiga jalur yang semuanya
nyata di DB produksi:

- **item pra-ADR-0030** — kolomnya belum ada saat item itu dikerjakan (20 item `hanoman` di sini);
- **item yang ditandai selesai manual** lewat `PATCH /specs/:id { stage }`;
- **item yang datang dari hub** (`FIELDS.spec` memang menyeberangkan `baseSha`, jadi null di hub =
  null di klien).

Sebaliknya `stage` adalah pernyataan eksplisit tentang pekerjaan itu sendiri: ia maju hanya lewat
fase yang dilaporkan sesi dan mundur hanya lewat aksi manusia (ADR-0027). `stage = "done"` karena
itu satu-satunya gerbang yang benar untuk "jangan kerjakan lagi".

Perhatikan bahwa **`startedAt` (SPEC-408) tak menyelamatkan apa pun**: ia ditulis di titik cekik yang
sama persis dengan `baseSha`, jadi ia null untuk ke-27 item yang sama. Menukar satu proksi dengan
proksi lain tidak memperbaiki apa-apa.

## Kenapa jalur `done` justru yang paling mahal

`startSpecSession` menghitung `isContinue = spec.stage === "done"` (SPEC-172). Untuk item `done`,
gerbang resume ADR-0084 **dilewati** dan sesi selalu lahir dari `branchFrom` dengan
`continuePrompt` — worktree baru, branch baru, dan `baseSha`/`headSha`/`startedAt` item itu
**ditulis ulang**. Jadi kesalahan checker tidak berhenti di "satu sesi mubazir": ia menghanguskan
kuota, menaruh branch baru di repo, dan merusak stempel waktu ADR-0090 milik item yang sudah
tuntas. Jalur reopen itu sendiri benar dan tetap dipertahankan — ia memang fitur, tapi fitur
**manual**; otomasi tak boleh memasukinya sendiri.

## Perbaikan

Tiga suntingan kecil, semuanya di akar:

1. **`services/scheduler/sources/backlog.ts`** — predikat kandidat jadi `baseSha: null` **dan**
   `stage: { not: "done" }`. Diekspor sebagai satu konstanta bersama (`UNSTARTED_SPEC_WHERE` di
   `scheduler/queue.ts`) supaya definisinya tak bisa menyimpang lagi antar-pemakai.
2. **`services/lead/pulse.ts`** (`orderProject`) — memakai konstanta yang sama; lead berhenti
   mengurutkan dan mengantrekan pekerjaan yang sudah selesai.
3. **`services/scheduler/governor.ts`** — gerbang terakhir tepat sebelum `launch`: dep baru
   `isDone(specId)`; item yang specnya sudah `done` **ditutup** (`markDone` + note) tanpa
   meluncurkan apa pun dan tanpa memakan slot. Ini yang membereskan 27 baris basi yang sudah
   telanjur ada di DB, sekaligus menutup balapan nyata "operator menyelesaikan item itu selagi ia
   mengantre". Sengaja **bukan** di `startSpecSession`: reopen manual item `done` (SPEC-172) harus
   tetap bisa.

Tanpa migration, tanpa endpoint baru, tanpa ADR baru — ADR-0072 tidak berubah arah; predikat
"belum mulai"-nya yang dipertegas, seperti SPEC-402 mempertegas pembacaan tmux tanpa ADR.

Satu baris UI ikut: baris antrean yang ditutup gerbang ini muncul di seksi "Selesai" tanpa
`launchedAt`, dan dulu akan terbaca "selesai —" seolah scheduler yang menyelesaikannya. Ia kini
menampilkan `note`-nya ("sudah selesai sebelum diantre") — kesalahbacaan yang persis searah dengan
bug ini tak boleh ditinggalkan di layar.

## Yang sengaja TIDAK dikerjakan

- **Memulihkan `startedAt`/`baseSha` enam item yang telanjur ditimpa.** Nilai aslinya (null) tak
  bisa dibedakan dari "memang belum pernah mulai" tanpa menebak, dan menulis balik ke null akan
  membuat mereka memenuhi syarat checker lagi di masa lalu. Dicatat di sini sebagai kerusakan yang
  diketahui, bukan disembunyikan.
- **Menghapus branch `hanoman/spec-146…159`** yang lahir dari sesi-sesi itu — itu wewenang
  `POST /projects/:id/branches/delete` (SPEC-360), keputusan operator.
