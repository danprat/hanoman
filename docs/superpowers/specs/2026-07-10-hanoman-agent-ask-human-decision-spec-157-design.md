# Design — SPEC-157: Agen bertanya, manusia memutuskan (`awaiting`)

**Tanggal:** 2026-07-10
**Jenis:** fitur baru — SPEC-157
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Butuh:** migration (`Run.pendingAsk`) + ADR-0022.

## Masalah

Sebuah run adalah proses `claude -p` tanpa penunggu. Ketika agen menemui percabangan desain yang
tidak bisa ia putuskan sendiri, ia **tidak punya saluran untuk bertanya** — jadi ia menebak.

Bukti, RUN-90012 (`hanoman_prod`), fase Brainstorm:

> **Pertanyaan 1 — Di brief tertulis "treatment yang butuh lebih dari 2 orang". "Orang" di sini siapa?**
> A. Pasien · B. Operator/dokter · C. Pembayar · D. Sesi/kunjungan
> *"Frasa 'dengan claim promo-nya masing-masing' membuat saya condong ke A, tapi ini menentukan
> seluruh bentuk data model — jadi saya tidak mau menebak."*

Tidak ada jawaban yang pernah tiba. Run tetap jalan, mengunci Objective, menulis Spec dan Plan, lalu
mengimplementasikan tujuh task. Ringkasan Execute-nya sendiri mengaku:

> *"Yang belum terjawab tetap sama seperti dicatat di spec: kalau yang sebenarnya diminta pemohon
> adalah pemecahan invoice **per pembayar** (bukan per tindakan), fitur ini tidak menjawabnya."*

Satu fase Execute penuh diarahkan ke keputusan desain yang tak pernah diambil manusia.

**Yang BUKAN masalahnya.** Kelima run `failed` di `hanoman_prod` (RUN-90008…90012) tidak gagal karena
menunggu keputusan. Semuanya mati di guardrail pra-Execute (`runner/src/run.ts:70-80`) dengan
`plan diblok · Doc belum ter-link di index …; Coverage 85% di bawah ambang 100%` — padahal
`Setting.data` berisi `requireLinks: false`. Penyebabnya `prodDeps.verify = verifyViaCli` dipanggil
`deps.verify(worktree)` tanpa argumen `guard`, sehingga subprocess jatuh ke default bawaannya. Sudah
diperbaiki `caff8d3` (`2026-07-10 02:26`, `depsWithGuard`); kelima run selesai `2026-07-09 23:22–23:51`,
tiga jam sebelumnya. Dokumen ini **tidak** menyentuh jalur itu.

## Keputusan

**Satu, agen menulis pertanyaannya ke berkas.** Preseden persis sudah ada: `.hanoman-decision.json`
(`runner/src/phases.ts:13`), artefak yang ditulis agen di root worktree dan dibaca `runOne`.

`ASK_FILE = ".hanoman-ask.json"`:

```json
{
  "question": "\"Orang\" di sini siapa?",
  "options": [
    { "value": "pasien",   "label": "Pasien",          "detail": "Satu item katalog dibeli untuk >1 pasien." },
    { "value": "pembayar", "label": "Pembayar",        "detail": "Tagihan dipecah ke >1 penanggung." }
  ],
  "default": "pasien"
}
```

`readAsk(worktree)` **fail-safe by construction**, meniru `readDecision`. Berkas absen, JSON rusak,
bukan objek, `question` kosong, `options` < 2, atau `default` tidak termasuk salah satu
`options[].value` → kembalikan `null`, run lanjut **persis seperti hari ini**. Tidak pernah melempar.
Berkas yang cacat tidak boleh bisa menyandera run.

`readAsk` **mengonsumsi** berkasnya (unlink saat dibaca): satu tulis = satu pertanyaan. `ASK_FILE`
tetap ikut `rmSync` tanpa syarat pra-commit bersama `DECISION_FILE` — `git add -A` men-stage berkas
ber-titik di root, dan artefak yang tertinggal akan mendarat di `branchTo` milik repo project.

**Dua, status baru `awaiting`, bukan `paused`.**

`paused` di hanoman berarti **proses `claude` sudah mati**: `applyControl` (`routes/runs.ts:82-84`)
mem-`publishControl` `pause` → worker mem-`abort()` → sesi ditutup, dan run dilanjutkan nanti dari
`sessionId`. `awaiting` berarti kebalikannya: **proses masih hidup**, stdin terbuka, `runOne` diblokir
di sebuah promise.

Menyatukan keduanya rusak secara konkret. `enqueueRun` hanya menolak `queued|running`
(`server/src/queue.ts:38-40`); tombol Resume pada run yang sedang menunggu akan lolos gate itu.
`runsQueue.add` memang no-op karena `jobId` yang sama masih aktif — jadi tidak ada dua sesi claude —
tetapi `prisma.run.upsert` di `queue.ts:41-43` **tetap menulis `status: "queued"`** pada run yang
prosesnya hidup dan terblokir. Status berbohong dan tombol jawaban lenyap.

`Run.status` bertipe `text`, bukan enum Postgres, jadi `awaiting` cuma satu baris di `zRunStatus`.
Yang ikut berubah, semuanya karena alasan yang sama — "run ini masih hidup":

| Tempat | Perubahan |
|---|---|
| `shared/src/enums.ts:4` | `zRunStatus` + `"awaiting"` |
| `shared/src/enums.ts:19` | `isRunActive` + `awaiting` (gate poll, pesan "run tidak aktif") |
| `server/src/queue.ts:39` | dedupe enqueue + `awaiting` → Resume ditolak, bukan diam-diam merusak |
| `server/src/routes/runs.ts:108` | 409 `DELETE` + `awaiting` → run hidup tak bisa dihapus |
| `server/src/routes/runs.ts:236` | `active` + `awaiting` → verb terminal `pause`/`stop`/`status` tetap jalan |
| `server/src/worker.ts:35` | `reconcileRuns` + `awaiting` → run yatim (worker mati saat menunggu) ditandai `failed` |

`server/src/github/status.ts` **tidak berubah**: `STATE` memetakan status yang dikenal saja, dan
`awaiting` — seperti `paused` — tidak ada di sana, jadi `postStatus` sudah diam dengan sendirinya.

**Tiga, jawaban lewat transport yang sudah ada.** Tidak ada kanal baru. `publishControl(id, {type:
"answer", value})` ke `run:<id>:control`. Handler `sub.on("message")` di `worker.ts:87-93` bertambah
satu cabang. `answer` sengaja **bukan** `steer`: `value` divalidasi terhadap `options` di route, dan
pesan steer nyasar tidak boleh tak sengaja menjawab pertanyaan desain.

Karena itu jawaban punya antriannya sendiri. `SteerQueue` bertambah `next(): Promise<string>` di
samping `push`/`drain`, lalu `worker.ts` membuat **dua instans**: `steer` (lama) dan `answers` (baru,
diisi cabang `answer`). `runOne` menunggu di `ctl.answers.next()`.

Antrian, bukan sekadar resolver promise: kalau jawaban ter-publish di celah antara `readAsk` dan awal
`await`, resolver telanjang akan kehilangannya dan run menggantung sampai timeout. Buffer menutup
balapan itu — jadi memakai ulang `SteerQueue` di sini benar, bukan cuma hemat.

**Teks yang disuntikkan ke sesi.** Jawaban menjadi satu giliran biasa lewat `takeTurn`, isinya
eksplisit agar agen tahu itu keputusan manusia, bukan gema promptnya sendiri:

```
Jawaban manusia atas pertanyaanmu: ${label} (${value})[ — ${detail}]
```

Saat timeout, kata "manusia" diganti: `Tidak ada jawaban dalam ${n}m — memakai pilihanmu sendiri: …`.
Agen tidak boleh mengira tebakannya sudah dikonfirmasi.

**Empat, timeout jatuh ke pilihan agen sendiri.** `askTimeoutMin` di `Setting.data` (jsonb — tanpa
migration), default `30`. Nilai `0` berarti **tidak pernah menunggu**: `default` langsung diterapkan,
untuk batch tak berpenunggu.

Ini menerima kembali tebakan yang hendak dihapus fitur ini, jadi tebakannya wajib **terlihat**. Saat
timeout, run menulis baris log bertanda `✗`:
`pertanyaan tak terjawab ${askTimeoutMin}m — memakai pilihan agen: ${label}`. Run yang menebak tidak
boleh tampak identik dengan run yang kamu putuskan.

## Alur

Di `runOne` (`runner/src/run.ts`), **setelah** `runPhase()` kembali dan **sebelum** kuras steer —
fase belum ditandai `done` selama masih ada yang ditanyakan.

```
runPhase(phase) ──▶ readAsk(worktree)
                      │ null ──▶ (seperti hari ini)
                      ▼ ask
                    onEvent {kind:"ask", ask}          → Run.pendingAsk = ask
                    onEvent {kind:"status","awaiting"}
                    await race( answers.next() , timeout(askTimeoutMin) , abort )
                      │ abort   ──▶ status "stopped"  (lewat catch yang sudah ada)
                      │ timeout ──▶ value = ask.default, log "✗ …memakai pilihan agen…"
                      ▼ answer
                    onEvent {kind:"ask", ask:null}     → Run.pendingAsk = null
                    onEvent {kind:"status","running"}
                    takeTurn(session, answerText)      → stdin sesi yang sama
                    ── ulangi readAsk (agen boleh bertanya lagi) ──
```

`RunEvent` (`runner/src/types.ts`) bertambah `{ kind: "ask", ask: Ask | null }`; `persistEvent`
(`server/src/runner/events-io.ts`) menuliskannya ke `Run.pendingAsk` dan mem-publish-nya seperti event
lain, sehingga SSE mendorong tombolnya ke UI tanpa polling.

Perulangannya **dibatasi 5 pertanyaan per fase**. Agen bingung yang bertanya tanpa henti membakar
token; batas itu murah dan menutup satu-satunya loop tak berhingga di jalur ini. Melewati batas →
`default` diterapkan dan dicatat.

Menunggu tidak memblokir event loop, jadi renewal lock BullMQ tetap jalan dan `worker.on("stalled")`
(→ `markFailed`) tidak terpicu.

**Yang tidak selamat dari restart worker.** `SteerQueue` ada di memori. Worker mati saat sebuah run
`awaiting` → `reconcileRuns` menandainya `failed`, sama seperti run `running` yang yatim hari ini.
Tidak diperbaiki di sini; `pendingAsk` tetap tersimpan sehingga Retry (yang me-resume `sessionId`
lewat ADR-0017) memulai kembali dari fase yang sama.

## Prompt

`phasePrompt` (`runner/src/phases.ts:54`) menambahkan instruksi `ASK` **tanpa syarat**, di setiap fase
dan setiap flow — percabangan desain bisa muncul di mana saja, termasuk di tengah Execute. Isinya:
kalau sebuah keputusan menentukan bentuk data model, kontrak API, atau ruang lingkup, dan kamu tidak
yakin, **jangan menebak** — tulis `ASK_FILE` (bentuk di atas, `default` wajib berisi kecondonganmu
sendiri) lalu akhiri giliranmu.

## Skema

`Run.pendingAsk Json?` — nullable, aditif. Migration + **ADR-0022**.

Postgres dev dipakai bersama semua worktree, jadi kolom ini akan muncul untuk sibling branch begitu
migration jalan. Nullable-aditif adalah bentuk yang aman untuk itu: branch lama tetap membaca dan
menulis baris `Run` tanpa tahu kolomnya ada.

`GET /runs/:id` mengembalikan barisnya apa adanya, jadi `pendingAsk` ikut tanpa perubahan route.

## Route

`POST /runs/:id/answer` · body `{ value: string }` (`zAnswer` di `shared/src/dto.ts`).

- run bukan `awaiting`, atau `pendingAsk` null → **409**
- `value` bukan salah satu `pendingAsk.options[].value` → **400**

Validasi terhadap `options` adalah batas kepercayaan: klien tidak boleh menyuntik jawaban sembarang
ke stdin agen lewat route ini.

**Teks bebas tidak menjawab.** Pesan `steer` masuk antrian steer dan baru dikuras *setelah* fase
berjalan selesai — padahal fase itu justru sedang diblokir menunggu jawaban. Kalau kotak steer
dibiarkan terlihat saat `awaiting`, mengetik jawaban ke sana tampak berhasil tetapi run tetap diam
sampai timeout. Karena itu saat `awaiting` kotak steer **disembunyikan**; yang tersisa hanya tombol,
plus Pause/Stop. Tidak ada opsi yang cocok → Stop, perbaiki brief, Retry.

## Frontend

`RunsScreen` menampilkan `pendingAsk.question` dan satu tombol per `options[]` (label + `detail`
sebagai teks penjelas) saat `status === "awaiting"`, memanggil `api.runAnswer(id, value)`.
`StatusPill` (`ds/components/feedback.tsx:90`) mendapat varian `awaiting`.

`RunControls` hari ini muncul untuk `running|paused`; `awaiting` ikut, tetapi **kotak steer dan tombol
Resume disembunyikan** — tak ada yang perlu di-resume (prosesnya hidup), dan teks bebas tidak menjawab
(lihat Route). Pause dan Stop tetap ada; keduanya mem-`abort`, dan wait kalah balapan → `stopped`.

## Uji

Orkestrasi wajib berpengujian (CLAUDE.md).

| Berkas | Kasus |
|---|---|
| `runner` `readAsk` | absen · JSON rusak · `options` < 2 · `default` di luar `options` · valid → berkas terhapus |
| `runner` `runOne` | ask → `awaiting` → jawab → `takeTurn` dipanggil dengan jawaban → fase `done` |
| `runner` `runOne` | timeout → `default` diterapkan + baris log `✗` |
| `runner` `runOne` | abort saat menunggu → `stopped`, **bukan** `failed` |
| `runner` `runOne` | 5 ask beruntun dalam satu fase → yang ke-6 memakai `default` |
| `runner` `runOne` | `ASK_FILE` terhapus sebelum `commitAndPush` |
| `runner` `SteerQueue` | `next()` setelah `push()` (jawaban mendahului wait) langsung selesai — bukan menggantung |
| `server` `worker` | pesan `{type:"answer"}` menyelesaikan promise; `steer` nyasar tidak |
| `server` route | non-`awaiting` → 409 · `value` asing → 400 · valid → publish |

Ditambah verifikasi API nyata di local sesudah tiap task (CLAUDE.md): boot server, `curl` `POST
/runs/:id/answer`.

## Di luar lingkup

- **Tombol override guardrail.** Pemicunya agen-bertanya, dan tombol "lanjut saja" pada blokir
  Source of Truth adalah persis bypass yang dilarang `CLAUDE.md`.
- **Jawaban multi-pilih.** Satu pertanyaan, satu nilai.
- **Notifikasi khusus ask.** `notifyFail` dibiarkan apa adanya.
- **Ketahanan `awaiting` terhadap restart worker.** Setara dengan run `running` hari ini.
