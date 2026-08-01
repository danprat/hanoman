# Audit SPEC-479 — hanoman-lead gagal mengambil putusan saat banyak sesi minta decision bersamaan

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** critical · **Tanggal:** 2026-08-01
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> "Saat sesi banyak dan semuanya berantai memanggil claude, hanoman-lead gagal mengambil putusan.
> Permintaan putusan tidak terjawab dan sesi-sesi yang menunggu ikut macet. Semakin banyak sesi
> berjalan, semakin sering gagal."
>
> Diharapkan: "Setiap permintaan putusan tetap terlayani meski datang bersamaan: antre bila perlu,
> dijawab satu per satu, dengan **batas konkurensi dan retry yang jelas**. Tidak ada permintaan yang
> hilang, dan sesi pemanggil selalu mendapat balasan (putusan atau kegagalan eksplisit yang bisa
> dicoba ulang), **bukan menggantung tanpa batas**."

## Ringkasan temuan

**Di seluruh subsistem lead tidak ada satu pun batas konkurensi.** Bukan batasnya salah setel — ia
tidak ada. `grep -rn "semaphore\|concurren\|maxParallel\|p-limit\|mutex"` di `server/src` menemukan
`maxConcurrent` hanya milik governor scheduler (ADR-0072) dan nol milik lead.

Yang ada sebagai gantinya adalah **dua kelakuan berlawanan yang sama-sama tak dikehendaki**, keduanya
kebetulan, keduanya lahir dari bentuk kode dan bukan dari keputusan desain:

| Pintu | Perilaku hari ini | Akibat saat N sesi bersamaan |
|---|---|---|
| #2 deteksi otomatis (`detect.ts`) | `for (const s of sessions) { await … }` — **serial mutlak** | sesi ke-k menunggu (k−1) keputusan penuh; head-of-line blocking |
| #1 kontrak `POST /lead/decisions` | tak ada pengereman apa pun | N permintaan → **N proses `claude -p` sekaligus** |
| #3 denyut proaktif (`pulse.ts`) | serial di dalam, tapi berjalan **berbarengan** dengan #2 | menambah beban tanpa masuk hitungan siapa pun |

Pintu #2 terlalu serial sampai melaparkan; pintu #1 terlalu paralel sampai menenggelamkan. Keduanya
lalu bertemu di cacat ketiga: **batas waktu yang disebabkan beban dicatat sebagai kegagalan
permanen**, dan sesi yang terkena tak pernah dicoba lagi walau bebannya sudah hilang. Itulah kalimat
"semakin banyak sesi berjalan, semakin sering gagal" secara harfiah — ketiganya menguat seiring N.

Tak ada yang perlu diamandemen: **ADR-0091 ditegakkan**, bukan diubah. AC-4 sudah menuntut
"permintaan yang tak terjawab dalam batas waktu" punya ujung, dan M1 sudah menuntut median ≤ 2 menit.
Yang tak pernah ada adalah alat untuk menepatinya saat peminta lebih dari satu.

## A · Pintu deteksi melayani sesi secara serial, tanpa batas waktu total

`scanAndAnswer` (`detect.ts:136`) mengiterasi sesi dengan `for (const s of sessions)` dan `await`
di dalamnya. Tak ada fan-out, tak ada deadline per sesi, tak ada penggiliran.

Terukur (deps disuntik, `decide` diganti penunda 200 ms, N = 6):

```
{ "N": 6, "THINK_MS": 200, "answered": 6,
  "maxInFlight": 1,          ← serial mutlak
  "elapsedMs": 1240,         ← jumlah, bukan maksimum (ideal: 200)
  "tungguGiliran": [ s0:0, s1:204, s2:407, s3:614, s4:832, s5:1035 ] }
```

Tangga liniernya sempurna: sesi ke-k menunggu (k−1) × T sebelum permintaannya bahkan **dimulai**.
Head-of-line-nya terukur terpisah — satu keputusan 1000 ms di depan membuat dua keputusan 20 ms di
belakangnya baru selesai pada 1028 ms dan 1053 ms:

```
selesai pada ms: [["lambat",1003],["cepat1",1028],["cepat2",1053]]
```

Skala produksinya bukan milidetik. Dari 18 baris `LeadDecision` di DB hidup operator:
**jarak minimum antar keputusan 49,2 detik dan tak satu pun pasangan tumpang tindih** — jejak nyata
yang bentuknya persis serial. Ledakan empat keputusan `spec-456` berjarak 49,2 / 55,4 / 57,4 detik;
`spec-453 → spec-454` 150,4 detik; `spec-454 → spec-455` 61,4 detik.

Anggaran resminya jauh lebih besar dari itu. Dengan `timeoutSec` = **600** (default sejak SPEC-432)
dan `MAX_CHAIN_STEPS` = **6** (SPEC-474), satu sesi berantai boleh memakai
6 × (600 + 20 × 300 ms) = **3 636 detik ≈ 60,6 menit** sendirian — dan selama itu:

- penjaga `busyDetect` (`engine.ts:21`) membuat **setiap** tick 5 detik pulang tanpa membuka pintu
  deteksi. Pintu satu-satunya yang menjawab sesi mandek diam selama satu jam;
- daftar sesinya adalah **snapshot** yang diambil sekali di awal loop (`deps.live()`, `detect.ts:133`).
  Sesi yang mulai menunggu di tengah jam itu tak terlihat sama sekali sampai loop selesai;
- urutannya **deterministik**, bukan acak: `liveDecisions()` → `listPanes()` → `tmux list-panes -a`,
  yang keluarannya terurut stabil. Sesi yang kebetulan di ekor daftar selalu di ekor. Ini bukan
  antrean yang lambat, ini kelaparan yang bisa direproduksi.

Konsekuensinya terhadap sasaran ADR-0091 sendiri: **M1 menuntut median tunggu ≤ 2 menit.** Pada
keputusan tercepat yang pernah terukur (49 dtk) median itu sudah pecah di sekitar N = 5 penunggu;
pada anggaran penuh (600 dtk) ia pecah di **N = 2**.

## B · Pintu kontrak eksplisit tak punya pengereman sama sekali

`POST /lead/decisions` (`routes/lead.ts:77`) memanggil `decide()` langsung. Fastify melayani
permintaan secara konkuren, jadi tak ada yang menahan permintaan ke-dua sampai ke-N. Terukur, `think`
disuntik penghitung:

```
{ "N": 12, "maxInFlight": 12 }
```

Dua belas permintaan bersamaan melahirkan **dua belas** proses agen sekaligus. Setiap proses adalah
`claude -p --model claude-opus-5 --effort xhigh` — bukan panggilan HTTP tipis melainkan runtime Node
penuh. Mesin operator tempat keluhan ini lahir: **RAM 8 GB, 8 core**, sudah menjalankan sesi `claude`
interaktif per backlog di tmux. Dua belas agen penasihat di atas itu tidak melambat dengan anggun; ia
membuat setiap `think()` melewati `timeoutSec` bersama-sama.

Pintu #3 memperburuknya secara diam-diam: `tick()` menjalankan `scanAndAnswer` dan `pulse` di dalam
`Promise.all(jobs)` yang sama (`engine.ts:87`) dengan penjaga re-entrancy **terpisah** — pemisahan
yang memang benar dan disengaja SPEC-432, tapi artinya kedua pintu bisa memanggil agen berbarengan
dan tak ada yang menghitung jumlahnya.

## C · Batas waktu akibat beban dicatat sebagai kegagalan permanen

Pagar kegagalan beruntun SPEC-472 (`failures` / `failCapped`, `detect.ts:45`) dirancang untuk sebab
yang **tak hilang dengan mengulang** — kunci API ditolak, kuota habis, biner tak terpasang. Alasannya
tertulis di kode: *"mencoba lagi tiap denyut hanya membakar kuota."*

Batas waktu akibat beban adalah kebalikannya: ia **hanya** ada selama bebannya ada. Tapi keduanya
sampai ke `detect.ts` dalam bentuk yang identik — satu baris `status = "gagal"`. Terukur:

```
sesudah 3 denyut bermuatan:      failureCount = 3, percobaan = 3
sesudah beban hilang, 10 denyut: percobaan baru = 0
```

`failCapped` adalah **keadaan menyerap**: sesudah cap, tak ada percobaan lagi; tanpa percobaan tak
ada keberhasilan; tanpa keberhasilan `failures.delete()` tak pernah dipanggil. Satu-satunya jalan
keluar adalah `resetSession` (operator menimpa dengan tangan) atau `sweep` (sesinya mati). Sepuluh
denyut sesudah mesin lega menghasilkan **nol** percobaan baru.

Dan ambangnya `maxAutoAnswers` = **3**. Tiga lonjakan beban — persis yang terjadi saat banyak sesi
sampai ke titik keputusan berbarengan — cukup untuk menutup lead bagi sesi itu **selamanya**. Sesi
tersebut lalu duduk dengan marker keputusan terisi, tak terbedakan dari sesi yang menunggu manusia,
sampai operator menyadarinya.

## D · Hipotesis yang TERBANTAH (dicatat supaya tak "diperbaiki" orang berikutnya)

`lead.timeoutSec` default **600 dtk** sementara Node 24 menyetel `server.requestTimeout` default
**300 000 ms**. Dugaannya: koneksi peminta dibunuh di tengah jalan, keputusan lahir tapi tak pernah
sampai. **Salah.** Diukur pada app yang benar-benar dibangun (`buildApp()` → `app.server`):

```
{"requestTimeout":0,"headersTimeout":60000}
```

Fastify mematikan `requestTimeout` (0 = tanpa batas). Server **tidak pernah** memutus peminta, dan
`headersTimeout` hanya menggerbangi header. Artinya "menggantung tanpa batas" di keluhan bukan datang
dari sisi HTTP melainkan dari sisi deteksi (temuan A) — dan artinya juga, begitu antrean dipasang,
menunggu di antrean **tak akan pernah** dihentikan siapa pun kecuali oleh batas yang kita pasang
sendiri. Deadline penerimaan karena itu wajib, bukan hiasan.

## E · Pengamat: pembacaan tmux memblokir event loop (penguat, di luar scope perbaikan ini)

`tmux()` (`pty.ts:125`) memakai `execFileSync` — **sinkron**, jadi setiap panggilan membekukan event
loop server. Terukur di mesin ini: **6,28 ms per panggilan**. Satu putaran deteksi memanggilnya
minimal 1 + 3N kali (`live` + per sesi: `exited`→`list-panes`, `agentOf`→`list-panes`,
`pane`→`capture-pane`), lalu `waitScreenChange` menambah sampai 20 tangkapan per langkah rantai.

Ini nyata dan ikut menjelaskan "sesi-sesi yang menunggu ikut macet" (HTTP & aliran WS terminal ikut
tersendat), tapi ia **bukan** akar masalahnya: suku dominannya adalah keputusan 49–600 detik yang
diletakkan berderet. Dicatat di sini karena ia membatasi bentuk perbaikan — fan-out pintu deteksi
harus **berbatas**, sebab N rantai yang men-*poll* `capturePane` serentak menukar satu masalah dengan
masalah lain.

## Akar masalah

> Subsistem lead memperlakukan "berapa banyak putusan boleh disusun sekaligus" sebagai sesuatu yang
> tak perlu dinyatakan. Karena tak dinyatakan, jawabannya jatuh ke bentuk kode masing-masing pintu:
> **1** di pintu deteksi (kebetulan `for`+`await`) dan **tak hingga** di pintu kontrak (kebetulan
> Fastify konkuren). Keduanya salah, dan tak ada tempat untuk membetulkannya karena tak ada satu pun
> objek yang memegang jawaban itu.

Ketiga pintu sudah melewati **satu otak** (`decide()`, ADR-0091 G6) — jadi choke point-nya sudah ada
dan sudah tunggal. Yang belum ada adalah gerbang di atasnya.

## Perbaikan (Spec & Plan `skipped` — tanpa ADR, skema, migration, atau endpoint baru)

ADR-0091 **ditegakkan**; ADR-0024 (tanpa message queue/worker/cron eksternal) dan ADR-0039 (tanpa
kanal WS baru) tetap utuh — gerbangnya in-process, cermin governor scheduler.

1. **`services/lead/gate.ts` (baru)** — gerbang penerimaan **FIFO** berkapasitas `lead.maxConcurrent`.
   FIFO, bukan "siapa cepat": urutan kedatangan adalah satu-satunya hal yang mencegah kelaparan yang
   diukur temuan A. Menunggu slot lebih lama dari `lead.queueWaitSec` → `LeadBusyError`, yaitu
   **penolakan eksplisit yang bisa dicoba ulang**, bukan gantung (temuan D).
2. **`decide.ts`** — satu-satunya pemanggil `think()` dibungkus gerbang itu. Satu definisi, tiga
   pintu; menaruhnya di tiap pintu adalah kelas bug SPEC-431/448/475 yang sudah tiga kali dibayar.
3. **`detect.ts`** — loop serial diganti fan-out **berbatas** `maxConcurrent` (batas yang sama, dua
   guna: agen serentak dan rantai yang mem-*poll* tmux serentak — temuan E). `LeadBusyError`
   **bukan** kegagalan lead: ia tak menambah `failures`, tak menulis baris jejak, dan sesinya tetap
   memenuhi syarat pada denyut berikutnya (temuan C).
4. **`pulse.ts`** — sama: busy → lewati, coba lagi denyut berikutnya.
5. **`routes/lead.ts`** — busy → **503** + `Retry-After`, badan galat yang menyebutkan bahwa ia layak
   diulang. Bukan 504 (yang berarti lead sudah mencoba dan kehabisan waktu) dan bukan 409 (yang
   berarti lead memang tak aktif).
6. **`shared/src/entities.ts`** — `zLead.maxConcurrent` (default **2**) & `zLead.queueWaitSec`
   (default **120**). Kolom `Setting.data` bertipe `Json` → **tanpa migration**, cermin seluruh knob
   lead sejak ADR-0091. Default 2 dipilih dari mesin tempat keluhan lahir (8 GB / 8 core yang sudah
   menanggung sesi pekerja), bukan dari angka bulat.
7. **`shared/src/dto.ts` + `LeadScreen`** — `LeadStatusView.gate` (in-flight & panjang antrean) dan
   lencana **"antre"** di samping "menunggu"/"sedang diputuskan". Batas konkurensi yang tak terlihat
   operator akan terbaca lagi sebagai "lead diam" — persis salah baca yang melahirkan tiket ini.

## Temuan sampingan saat verifikasi — DB test BUKAN per checkout

Ditemukan saat menjalankan set `--changed`, dan dicatat karena ia mengoreksi instruksi yang dibaca
setiap sesi (`AGENTS.md`, `CLAUDE.md`). Set yang sama memberi **99 gagal → 2 gagal → 0 gagal**
(266/266 berkas, 2211/2211 test) semata-mata sebagai fungsi isolasi basis data, tanpa satu pun
perubahan kode di antaranya.

Klaim yang berlaku sejak SPEC-398 berbunyi `<db>.test.db` "per checkout … aman dari worktree
tetangga". **Ia tak benar di lingkungan sesi hanoman.** Berkasnya diturunkan dari **`HANOMAN_HOME`**,
bukan dari checkout — `runner/src/paths.ts` `resolveDbUrl` jatuh ke
`file:${join(resolveHome(env), "hanoman.db")}` — dan setiap sesi mewarisi `HANOMAN_HOME` yang sama,
sehingga seluruh worktree memakai satu `~/.hanoman/hanoman.test.db`. Lalu
`server/test/global-setup.ts:15` **menghapus** berkas itu (`rmSync`, beserta `-journal/-wal/-shm`)
di awal **tiap** run. Run tetangga karena itu menghapus DB di tengah run yang sedang berjalan.

Bukti langsung: log run memuat `SQLite database hanoman.test.db created at
file:/Users/…/.hanoman/hanoman.test.db` **di tengah** eksekusi, gejalanya seragam (**404** massal di
`terminal.route`/`ide.route`/`specs.route` + galat runtime Prisma), dan setiap suite yang gagal
**lulus penuh saat dijalankan sendirian**. Dengan `TEST_DATABASE_URL` menunjuk berkas privat,
set penuh hijau.

Penawarnya satu baris: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"`. Suite yang gagal ramai
dengan 404/P2022 hampir selalu ini, bukan regresi — dan menghabiskan waktu sesi untuk mengejarnya
sebagai regresi adalah biaya yang sudah dibayar di sini.

## Bukan bagian perbaikan ini

- **`execFileSync` di `pty.ts` (temuan E)** tak disentuh. Mengasinkronkannya menyentuh setiap
  pemakai tmux di server (terminal, scheduler, governor, VPS) demi 6 ms per panggilan, sementara
  suku dominannya ratusan detik. Fan-out yang berbatas sudah menahannya agar tak memburuk.
- **`liveCount()` governor** tak disentuh, alasan yang sama seperti SPEC-451.
- **Penjaga `busyDetect` (`engine.ts`) tak disentuh — residu yang sadar dibiarkan.** Ia masih
  menutup pintu deteksi selama satu putaran berjalan, jadi sesi yang mulai menunggu di tengah
  putaran baru terlihat pada putaran berikutnya. Yang berubah adalah **skalanya**: putaran tak lagi
  berupa jumlah seluruh keputusan berderet (6 sesi × 60,6 menit terburuk) melainkan
  ⌈N / `maxConcurrent`⌉ batch — pada ongkos terukur (±60 dtk/keputusan, 6 sesi, kapasitas 2) sekitar
  **3 menit**, bukan puluhan menit. Menghapus residunya menuntut putaran deteksi membaca sesi secara
  **hidup** alih-alih dari snapshot, dan itu mengubah pacing yang mendasari `maxAutoAnswers`
  (satu rantai per sesi per putaran, ADR-0091 AC-11 · SPEC-474) sekaligus semantik re-entrancy yang
  sengaja dipisah SPEC-432 — perubahan desain, bukan tambalan QA. Ia pantas dapat spec sendiri.
- **Retry otomatis di sisi peminta** tak ditambahkan. Kontraknya menyerahkan itu ke peminta (503 +
  `Retry-After`); memasang retry di server berarti menahan koneksi lebih lama, yaitu justru
  "menggantung" yang diminta keluhan untuk dihapus.
