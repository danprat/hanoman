# PRD — Scheduler otonom: auto-start backlog, batch errors, & pick triase

> Status: draft (hasil brainstorm PM/PO, 2026-07-22). Belum diimplementasikan.
> Cakupan dokumen ini **hanya** Product Requirements. Keputusan arsitektur (ADR) & rencana implementasi menyusul terpisah.

## Ringkasan

hanoman hari ini menjalankan setiap pekerjaan (backlog, perbaikan error, tiket triase) sebagai **sesi `claude` interaktif** yang **selalu di-Start manual** oleh operator. Escalate error dan accept tiket sudah membuat backlog, tetapi berhenti di situ — sesi tetap harus diluncurkan tangan. Akibatnya throughput dibatasi kehadiran operator: pekerjaan yang jelas dan berulang tetap antre menunggu klik.

PRD ini mendefinisikan **satu subsistem scheduler otonom** yang, sesuai jadwal & setelan, secara otomatis: (1) memulai backlog yang belum mulai, (2) mengangkat grup error produksi berulang menjadi backlog perbaikan dan menjalankannya ("batch fixing" per grup), dan (3) menerima tiket triase yang layak menjadi backlog dan menjalankannya. Semua peluncuran dibatasi **cap concurrent global + antrean durable** demi kestabilan, dan diatur **mode autonomy** (full control vs butuh keputusan manusia). Hasil selalu berhenti di stage `done` dengan **ringkasan/diff review otomatis** untuk di-review & di-merge manual — scheduler tidak pernah auto-merge.

Outcome yang dituju: **hanoman mengerjakan sendiri pekerjaan backlog/error/triase yang sudah ada tanpa menunggu operator, dan operator dengan mudah me-review hasilnya.**

## Masalah & konteks

**Masalah.** Peluncuran sesi 100% manual. Backlog yang siap kerja menganggur; error produksi yang berulang menunggu di-escalate & di-Start satu per satu; tiket masuk menumpuk di antrean triase. Nilai hanoman sebagai orchestrator otonom tidak tercapai karena selalu ada operator di jalur kritis untuk memulai pekerjaan.

**Konteks teknis saat ini** (kondisi yang PRD ini bangun di atasnya):

- **Backlog = `Spec`.** "Belum mulai" adalah kondisi turunan (`baseSha === null`), bukan status. Siklus hidup lewat `stage` forward-only: `brainstorming → objective → spec-ready → planned → executing → done`. Memulai pekerjaan = `POST /terminal/sessions` yang membuat worktree terisolasi `<repoDir>/.worktrees/<specId>` dan spawn sesi `claude` di tmux. `flow` ditentukan `spec.source`.
- **Errors.** `ErrorGroup` (grouping per fingerprint) + `ErrorEvent`; status `new | escalated | resolved`. `POST /errors/:id/escalate` sudah membuat `Spec` (source `qa`, prioritas tinggi) + tautan dua arah — **tetapi tidak memulai sesi**. **Batch fixing belum ada.**
- **Triase = Help Center `Ticket`.** Status `new | accepted | rejected`; "triase aktif" ≈ tiket `new` (belum ditinjau). `POST /tickets/:id/accept` sudah membuat `Spec` dengan pemetaan kategori→source (SPEC-291: bug→qa, fitur→brief, pertanyaan→audit, lainnya→brief) — **tetapi tidak memulai sesi**.
- **Autonomy.** Semua sesi sudah otonom (`AUTONOMY_CLAUSE`): berjalan menembus fase, berhenti **hanya** saat butuh keputusan manusia nyata (perubahan bentuk kerja: data model, kontrak API, scope), dideteksi lewat marker keputusan (SPEC-184) → `Notification` tipe `decision`. Toggle `autoDefault` ("Full-auto sebagai default") **ada di model & UI tetapi tidak menggerakkan perilaku apa pun** saat ini.
- **Concurrency.** **Tidak ada batas.** `maxConcurrent` sudah dicabut (ADR-0024). Operator bebas Start sebanyak apa pun.
- **Tidak ada scheduler/cron/queue.** ADR-0024 sengaja mencabut cron, worker, dan antrean durable (BullMQ/Redis); pekerjaan retensi dibuat "opportunistic-on-write". Satu-satunya sweep interval yang tersisa adalah `vps-monitor.ts` (health 5 mnt / audit 24 jam), yang tak pernah menyentuh spec/sesi.

**Konsekuensi & tegangan arsitektur.** Fitur ini **membalik sebagian ADR-0024**: menghidupkan kembali (a) scheduler berjalan dalam proses, (b) **antrean durable**, dan (c) **cap concurrent** (`maxConcurrent`), serta (d) mengaktifkan jalur `autoDefault` yang selama ini mati. Ini keputusan produk yang disengaja; ADR baru diperlukan sebelum implementasi (lihat Open questions).

## Persona/pengguna

- **Operator/PM solo (persona utama).** Menjalankan hanoman untuk beberapa project sekaligus (sebagian produksi, sebagian eksperimen). Ingin pekerjaan rutin yang jelas berjalan sendiri semalam/di sela waktu, lalu tinggal me-review & merge di pagi hari. Butuh kontrol yang aman: bisa memilih project mana yang ikut, dan rem darurat.
- **Pengembang reviewer (bisa persona yang sama).** Mengonsumsi hasil sesi scheduler: membaca ringkasan/diff, memutuskan merge, menindaklanjuti sesi yang gagal atau menunggu keputusan.
- **Bukan pengguna:** pelapor tiket / pengirim error (mereka tidak berinteraksi dengan scheduler; mereka hanya sumber input lewat Help Center & SDK error).

## Goals & non-goals

### Goals
1. Menjalankan otomatis **backlog belum-mulai** dari project yang di-opt-in, diurut prioritas, tanpa intervensi manual.
2. Mengangkat & menjalankan otomatis **perbaikan grup error produksi berulang** (per grup = per backlog), memakai ulang jalur escalate yang ada.
3. Menerima & menjalankan otomatis **tiket triase yang actionable** (bug/fitur), memakai ulang jalur accept + pemetaan kategori→source yang ada.
4. Menjaga **kestabilan** lewat cap concurrent global + antrean durable, dengan **rem darurat Pause/Stop**.
5. Memberi **mode autonomy** (full control vs butuh keputusan manusia) untuk sesi yang diluncurkan scheduler.
6. Membuat hasil **mudah di-review**: setiap hasil berhenti di `done` dengan ringkasan/diff otomatis; merge tetap keputusan manusia.
7. Memberi **surface observabilitas** yang menunjukkan apa yang scheduler jadwalkan, jalankan, selesaikan, dan gagalkan.

### Non-goals
- **Bukan** auto-merge ke `main`. Merge tetap manual (jalur ADR-0031).
- **Bukan** menggabungkan banyak grup error menjadi satu backlog, dan **bukan** pengelompokan-akar lintas fingerprint. Batching = "memproses banyak grup per window", satu grup = satu backlog.
- **Bukan** auto-triase untuk kategori `pertanyaan`/`lainnya` — tetap manual.
- **Bukan** mengubah mekanisme deteksi "butuh keputusan" (SPEC-184) — dipakai apa adanya.
- **Bukan** menghidupkan kembali webhook GitHub, worker headless terpisah, atau message queue eksternal (Redis/BullMQ). Engine tetap **in-process** meniru pola `vps-monitor`; "antrean durable" adalah state persist di DB hanoman sendiri, bukan broker eksternal.
- **Bukan** RBAC/penjadwalan multi-user; scheduler adalah setelan tingkat instance + opt-in per project.
- **Bukan** penjadwalan level tugas granular di dalam satu sesi; unit penjadwalan adalah satu sesi per backlog (ADR-0015 tetap berlaku).
- **Bukan** retry otomatis sesi yang gagal (dikecualikan secara sadar demi mencegah pembakaran usage).

## Scope (in/out)

### In scope
- Mesin scheduler in-process dengan **tiga source-checker** (backlog, errors, triase), masing-masing **enable + cadence per source**.
- **Antrean durable** kandidat peluncuran + **governor concurrency** (cap = total sesi hidup manual + scheduler) yang men-drain antrean saat slot kosong.
- **Opt-in per project** (default mati) sebagai gerbang kelayakan semua source.
- **Toggle autonomy global** yang diterapkan ke sesi scheduler.
- **Seleksi source:**
  - Backlog: semua spec belum-mulai (project opt-in), urut prioritas.
  - Errors: grup `new`, env produksi, `count ≥ ambang` (project opt-in) → escalate → jalankan.
  - Triase: tiket `new` kategori `bug`/`fitur` (project opt-in) → accept → jalankan.
- **Penanganan akhir sesi:** ringkasan/diff review otomatis pada `done`; tandai + notifikasi pada gagal; tahan slot + notifikasi pada butuh-keputusan.
- **Rem darurat Pause/Stop global** (master switch).
- **Surface review** (panel Scheduler) + pemakaian ulang `Notification` (done/decision/fail).
- **Setting** untuk semua knob di atas.

### Out of scope
- Auto-merge, pengelompokan-akar error, auto-triase non-actionable, retry otomatis, broker antrean eksternal, RBAC — lihat Non-goals.
- Perubahan mekanika `flow`/`stage`/deteksi keputusan yang sudah ada (dipakai apa adanya).
- Penjadwalan lintas-instance / sinkronisasi scheduler antar-node hub↔client.

## User stories

1. **Auto-start backlog.** Sebagai operator, saya ingin backlog belum-mulai di project yang saya izinkan berjalan sendiri sesuai jadwal (urut prioritas), supaya pekerjaan siap-kerja tidak menganggur menunggu saya klik Start.
2. **Batch fixing errors.** Sebagai operator, saya ingin grup error yang berulang di produksi otomatis diangkat menjadi backlog perbaikan dan dijalankan, supaya regresi produksi ditangani cepat tanpa saya escalate satu per satu.
3. **Pick triase.** Sebagai operator, saya ingin tiket bug/fitur yang masuk otomatis diterima menjadi backlog dan dijalankan, supaya permintaan yang jelas tidak menumpuk di antrean triase.
4. **Kendali autonomy.** Sebagai operator, saya ingin memilih apakah sesi scheduler berjalan penuh sampai selesai atau berhenti meminta keputusan saya di titik berisiko, supaya saya menyeimbangkan kecepatan vs kontrol.
5. **Kestabilan.** Sebagai operator, saya ingin membatasi berapa sesi berjalan bersamaan dan sisanya mengantre, supaya mesin & usage tidak kelebihan beban.
6. **Opt-in aman.** Sebagai operator, saya ingin scheduler hanya menyentuh project yang saya izinkan, supaya project eksperimen/scratch tidak ikut auto-run.
7. **Review mudah.** Sebagai operator, saya ingin setiap hasil berhenti di `done` dengan ringkasan/diff siap-baca dan menunggu merge manual saya, supaya saya cepat menilai lalu memutuskan.
8. **Rem darurat.** Sebagai operator, saya ingin satu tombol untuk menjeda/menghentikan semua peluncuran baru seketika, supaya saya bisa menahan sistem saat ada yang tidak beres.
9. **Observabilitas.** Sebagai operator, saya ingin satu tempat melihat apa yang dijadwalkan, sedang berjalan, selesai, atau gagal beserta alasannya, supaya saya paham perilaku scheduler.

## Acceptance criteria (EARS)

### Mesin & jadwal
- THE SYSTEM SHALL menyediakan mesin scheduler yang berjalan **di dalam proses API** dan dimulai sekali saat boot, tanpa worker/cron/broker eksternal.
- THE SYSTEM SHALL menyimpan, per source (backlog/errors/triase), sebuah **enable** dan **cadence** yang independen.
- WHEN cadence sebuah source terpenuhi DAN source itu enabled, THE SYSTEM SHALL menjalankan pemeriksaan source tersebut (menghasilkan kandidat peluncuran).
- WHILE sebuah source disabled, THE SYSTEM SHALL tidak menghasilkan kandidat apa pun dari source itu.
- THE SYSTEM SHALL memperlakukan project yang **tidak** di-opt-in sebagai tak-eligible untuk semua source.

### Antrean durable & concurrency
- THE SYSTEM SHALL menyimpan kandidat peluncuran dalam **antrean durable** yang bertahan melintasi restart API.
- THE SYSTEM SHALL memelihara **cap** = jumlah maksimum sesi hidup, dihitung dari **gabungan sesi manual + sesi scheduler**.
- WHILE jumlah sesi hidup < cap DAN antrean tidak kosong, THE SYSTEM SHALL menarik item berikutnya dari antrean dan meluncurkan sesinya.
- WHEN sebuah sesi (manual atau scheduler) selesai/berhenti sehingga slot kosong, THE SYSTEM SHALL segera menarik item antrean berikutnya (tanpa menunggu tick cadence berikutnya).
- IF jumlah sesi hidup ≥ cap, THEN THE SYSTEM SHALL menahan item di antrean tanpa meluncurkan sesi baru.
- THE SYSTEM SHALL mempertahankan urutan antrean berdasarkan prioritas (untuk backlog) dan menjaga item error/triase tidak hilang saat cap penuh.
- THE SYSTEM SHALL idempoten: satu backlog/grup error/tiket tidak menghasilkan lebih dari satu sesi berjalan pada satu waktu (memanfaatkan one-session-per-spec).

### Rem darurat (master switch)
- WHEN operator menekan **Pause/Stop** global, THE SYSTEM SHALL menghentikan seluruh peluncuran sesi baru dari scheduler seketika (item tetap di antrean).
- WHILE scheduler dalam keadaan Pause, THE SYSTEM SHALL tidak meluncurkan sesi baru meski cadence terpenuhi atau slot kosong.
- WHEN operator melepas Pause, THE SYSTEM SHALL melanjutkan drain antrean sesuai cap.

### Autonomy
- THE SYSTEM SHALL menyediakan satu **toggle autonomy global** bernilai `full-control` atau `butuh-keputusan` yang berlaku untuk sesi yang diluncurkan scheduler.
- WHERE mode `full-control` aktif, THE SYSTEM SHALL menginstruksikan sesi untuk memutuskan sendiri dan berjalan menembus fase sampai stage `done` tanpa berhenti untuk persetujuan.
- WHERE mode `butuh-keputusan` aktif, WHEN sesi mencapai titik keputusan manusia, THE SYSTEM SHALL menghentikan sesi, menandainya menunggu keputusan, dan menerbitkan `Notification` tipe `decision`.
- WHILE sebuah sesi scheduler menunggu keputusan, THE SYSTEM SHALL tetap menghitung sesi itu sebagai memegang slot concurrent.

### Source — Backlog
- WHEN pemeriksaan backlog berjalan, THE SYSTEM SHALL memilih semua `Spec` **belum-mulai** (`baseSha === null`) dari project opt-in sebagai kandidat.
- THE SYSTEM SHALL mengurutkan kandidat backlog berdasarkan prioritas `tinggi → sedang → rendah` sebelum enqueue.
- WHEN sebuah kandidat backlog diluncurkan, THE SYSTEM SHALL memulai sesinya dengan `flow` yang diturunkan dari `spec.source`, seperti peluncuran manual.

### Source — Errors
- WHEN pemeriksaan errors berjalan, THE SYSTEM SHALL memilih `ErrorGroup` dengan status `new`, environment **produksi**, dan `count ≥ ambang` yang dikonfigurasi, dari project opt-in.
- WHEN sebuah grup error eligible dipilih, THE SYSTEM SHALL memakai jalur **escalate** yang ada untuk membuat `Spec` (source `qa`, prioritas tinggi) lalu enqueue peluncuran sesinya.
- THE SYSTEM SHALL memproses **banyak** grup error eligible dalam satu window (dibatasi hanya oleh cap & antrean), dengan **satu grup = satu backlog**.
- IF sebuah grup error sudah `escalated`/`resolved` atau sudah tertaut ke `Spec`, THEN THE SYSTEM SHALL tidak mengangkatnya lagi.

### Source — Triase
- WHEN pemeriksaan triase berjalan, THE SYSTEM SHALL memilih `Ticket` status `new` berkategori `bug` atau `fitur` dari project opt-in.
- WHEN sebuah tiket eligible dipilih, THE SYSTEM SHALL memakai jalur **accept** yang ada (pemetaan kategori→source SPEC-291) untuk membuat `Spec` lalu enqueue peluncuran sesinya.
- IF sebuah tiket berkategori `pertanyaan` atau `lainnya`, THEN THE SYSTEM SHALL tidak menerimanya secara otomatis (tetap manual).
- IF sebuah tiket sudah `accepted`/`rejected` atau sudah tertaut ke `Spec`, THEN THE SYSTEM SHALL tidak menerimanya lagi.

### Akhir sesi & review
- WHEN sesi scheduler mencapai stage `done`, THE SYSTEM SHALL menghasilkan **ringkasan/diff review** hasilnya dan membiarkan branch/worktree menunggu **merge manual** (jalur ADR-0031).
- THE SYSTEM SHALL **tidak pernah** melakukan auto-merge atas hasil sesi scheduler.
- IF sebuah sesi scheduler gagal atau kena limit, THEN THE SYSTEM SHALL menandainya gagal, menerbitkan `Notification` tipe `fail`, dan **tidak** melakukan retry otomatis.
- WHEN sesi scheduler mencapai `done`, THE SYSTEM SHALL menerbitkan `Notification` tipe `done`.

### Observabilitas
- THE SYSTEM SHALL menyediakan surface (panel Scheduler) yang menampilkan, per source: status enable, waktu run terakhir, dan waktu run berikutnya.
- THE SYSTEM SHALL menampilkan isi antrean durable, sesi scheduler yang sedang berjalan, hasil `done` terbaru beserta ringkasannya, dan daftar sesi yang gagal beserta alasannya.

### Setting
- THE SYSTEM SHALL menyediakan setelan untuk: enable+cadence per source, cap concurrent global, toggle autonomy global, ambang count errors, dan flag opt-in per project (default **mati**).
- THE SYSTEM SHALL mempertahankan default aman: scheduler & semua source **mati** dan tak ada project opt-in sampai operator menyalakannya secara eksplisit.

## Metrik sukses

- **Throughput otonom:** proporsi item (backlog/errors/triase) yang mencapai `done` dari peluncuran scheduler **tanpa intervensi manual** meningkat; target awal ditetapkan setelah baseline (lihat Open questions).
- **Lead time turun:** waktu dari "item eligible muncul" → "sesi selesai/`done`" berkurang signifikan dibanding alur manual.
- **Zero runaway:** tidak pernah ada sesi hidup melebihi cap; tidak ada lonjakan usage tak terkendali; Pause/Stop selalu menghentikan peluncuran baru dalam waktu ≤ 1 tick.
- **Beban keputusan terkelola:** jumlah sesi yang berhenti `decision`/`fail` terlihat & dapat ditindaklanjuti; dalam mode `full-control`, proporsi sesi yang butuh intervensi rendah.
- **Kemudahan review (kualitatif):** operator dapat menilai & memutuskan merge tiap hasil dari ringkasan/diff tanpa membuka sesi penuh, dalam waktu review per hasil yang terasa singkat.
- **Presisi seleksi:** rasio backlog/error/triase yang diluncurkan scheduler yang **layak** (bukan noise/spam/scratch) tinggi; item non-actionable tidak pernah auto-jalan.

## Open questions

1. **Bentuk cadence per source.** Interval (tiap N menit) vs jam harian (HH:MM) vs keduanya per source — perlu dikunci sebelum desain data setting.
2. **ADR baru yang diperlukan** (membalik sebagian ADR-0024): (a) scheduler in-process, (b) antrean durable + skema tabelnya, (c) cap concurrent (penerus `maxConcurrent`), (d) mode `full-control` (mengaktifkan `autoDefault` yang dorman). Berapa ADR & bagaimana relasinya?
3. **Model data antrean durable.** Tabel baru (mis. `SchedulerQueueItem`/`SchedulerJob`) atau perluasan model yang ada? Bagaimana state item (queued/launching/running/done/failed) direpresentasikan tanpa duplikasi dengan `Spec.stage` + overlay sesi live?
4. **Definisi "environment produksi" untuk errors** dan **ambang count default** — apakah env sudah tersedia per `ErrorGroup`/`ErrorEvent`, dan berapa ambang default yang masuk akal?
5. **Produksi & penyimpanan "ringkasan/diff otomatis".** Reuse `SessionResult`, field/entitas baru, atau turunan dari `baseSha/headSha` saat dibaca? Apakah butuh langkah akhir sesi eksplisit?
6. **Interaksi cap dengan sesi manual.** Cap dihitung gabungan manual+scheduler — dikonfirmasi. Apakah sesi manual boleh "menyerobot" hingga membuat scheduler kelaparan slot? Perlu kebijakan fairness?
7. **Prasyarat project belum siap.** Bila project opt-in tapi `repoDir`/binding belum tersedia, apakah item di-skip + notifikasi, atau tetap antre? 
8. **Deduplikasi antrean lintas-tick & lintas-source.** Jaminan bahwa satu item tak masuk antrean dua kali antar tick, dan bahwa item yang menahan slot (menunggu keputusan) tidak diangkat ulang.
9. **Kesehatan antrean saat cap kecil + banyak sesi butuh-keputusan.** Bila banyak sesi menahan slot menunggu keputusan, antrean bisa stall. Apakah perlu indikator/peringatan "antrean tertahan", atau ini diterima sebagai perilaku benar (perhatian manusia = bottleneck)?
10. **Cakupan sync hub↔client.** Apakah setelan scheduler & state antrean ikut mekanisme record-sync (ADR-0045/0066), atau murni lokal per-node? (PRD ini mengasumsikan lokal per-instance.)
11. **Baseline metrik.** Angka baseline throughput/lead time untuk menetapkan target kuantitatif.
