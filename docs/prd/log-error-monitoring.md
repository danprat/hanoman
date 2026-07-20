# PRD — Log Error Monitoring (Sentry ringan terintegrasi hanoman)

> Status: Draft untuk review. Author: PM/PO (nafanesia). Disusun dari brief "Log Error monitoring" + brainstorm.
> Deliverable ini adalah **dokumen PRD**, bukan spesifikasi teknis/rencana implementasi. Keputusan implementasi mengikuti PRD ini lewat SPEC/ADR tersendiri.

## Ringkasan

Saat ini tiap project nafanesia menyimpan log-nya sendiri. Ketika ada error, tidak ada satu tempat untuk melihatnya — issue harus ditelusuri manual di masing-masing project, dan tidak ada jalur mulus dari "ada error" ke "dikerjakan". PRD ini menjadikan **hanoman berperilaku seperti Sentry ringan**: satu tempat untuk **menangkap error dari project apa pun** yang didaftarkan, mengelompokkannya, dan **mengeskalasikannya sekali klik menjadi backlog (`Spec`)** yang sudah punya alur kerja (audit → plan → execute).

Bentuknya mengikuti pola Sentry: tiap project memasang **SDK/snippet ringan** yang mengirim error (POST JSON) ke **endpoint ingest** hanoman menggunakan **DSN/ingest-key unik per project**. hanoman **mengelompokkan** kejadian identik menjadi satu **grup error** (dengan hitungan, first-seen, last-seen), menampilkannya di **area Error** di dashboard, memunculkan **notifikasi in-app saat grup baru muncul**, dan menyediakan tombol **"Eskalasi ke backlog"** yang membuat `Spec` (source QA/finding) terisi otomatis dari pesan + stack trace + tautan balik ke grup.

Cakupan versi pertama sengaja dipersempit ke **jalur end-to-end yang tipis tapi utuh**: ingest → group → lihat → notifikasi → eskalasi. Target stack pertama adalah **backend Node/TypeScript** dan **frontend React/browser** (stack inti nafanesia); payload berupa JSON generik sehingga bahasa lain bisa menyusul tanpa mengubah server. Fitur berat ala Sentry (tracing/APM, session replay, symbolication source-map, alert eksternal) berada **di luar scope** versi ini.

Cakupan: **satu workspace** (`nafanesia`), sejalan dengan prinsip MVP hanoman (multi-tenant pasca-MVP).

## Masalah & konteks

### Masalah
1. **Error tersebar & tak terlihat.** Tiap project punya log sendiri; tidak ada pandangan agregat. Untuk tahu "ada error apa hari ini di project X" harus SSH/buka log manual per project.
2. **Tracking manual, lambat, mudah terlewat.** Karena tidak ada sinyal proaktif, error baru bisa berjam-jam/berhari-hari tak terdeteksi sampai ada yang kebetulan melihat log atau ada laporan dari pengguna.
3. **Tidak ada jembatan dari error ke pekerjaan.** Bahkan saat error ditemukan, memindahkannya menjadi item yang dikerjakan adalah langkah manual: menyalin pesan, menulis ulang konteks, membuat backlog item dari nol. Konteks (stack trace, frekuensi) sering hilang di jalan.
4. **Sulit menilai prioritas.** Tanpa pengelompokan & hitungan, satu error yang terjadi 5.000 kali terlihat sama seperti error sekali-jalan; error dev/lokal bercampur dengan production.

### Konteks arsitektur hanoman (fakta yang mengikat desain)
- **"Backlog item" = model `Spec`.** Backlog di hanoman adalah baris `Spec` (punya `stage`, `source`, `payload`, `baseSha/headSha`). Alur QA/finding sudah ada: `audit → keputusan → (spec → plan)? → execute`; temuan kecil bisa langsung execute. Eskalasi error harus **menyambung ke jalur ini**, bukan membuat mekanisme backlog baru. (ADR-0020/0040)
- **Tujuh model Prisma:** `Project`, `Spec`, `Setting`, `Notification`, `User`, `Session`, `Vps`. Menambah kemampuan error monitoring berarti **menambah model baru** (grup + kejadian error) — yang **wajib lewat migration + ADR** dan tak boleh mengubah skema tanpa itu.
- **Auth menggerbangi seluruh `/api`** (ADR-0028): 401 tanpa sesi login. Publik hanya `GET /health`, `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`. **Endpoint ingest error harus menjadi pengecualian sah** (dipanggil project eksternal tanpa sesi login) → butuh **ADR baru** yang menetapkan otentikasi berbasis **DSN/ingest-key per project**, bukan cookie sesi.
- **Realtime = WebSocket hanya untuk terminal PTY; sisanya HTTP polling** (ADR-0039 untuk siaran dashboard). Area Error mengikuti pola yang sama: **polling**, bukan menambah kanal WebSocket baru.
- **Notifikasi = model `Notification`** yang sudah ada (mis. notif backlog selesai, ADR-0033). Notifikasi error baru memakai kanal yang sama.
- **`Project.id` (slug) kekal; `repoDir` opsional & per-mesin.** DSN ditautkan ke `Project` lewat slug yang stabil, bukan path lokal.
- **Guardrail perintah berbahaya sudah dicabut (ADR-0037); isolasi = worktree.** Fitur ini tidak menyentuh eksekusi sesi; ia lapisan data + UI + jembatan ke backlog.

### Kenapa sekarang
Nafanesia menjalankan makin banyak project di bawah satu operator (objektif MVP hanoman: satu operator memantau banyak project). Tanpa tempat terpusat untuk menangkap error dan mengubahnya jadi backlog, operator kehilangan sinyal paling penting — **apa yang rusak di production** — dan jarak dari "rusak" ke "diperbaiki" tetap penuh gesekan manual. hanoman sudah menjadi pusat backlog & sesi; menempatkan error di hulu backlog adalah kelanjutan alami.

## Persona / pengguna

| Persona | Deskripsi | Kebutuhan utama |
|---|---|---|
| **Operator / PM-PO (nafanesia)** | Satu orang yang memantau banyak project di hanoman & mengelola backlog. | Melihat error semua project di satu tempat, tahu saat ada yang baru, dan mengubah error jadi backlog tanpa menyalin manual. |
| **Developer project** | Yang memasang SDK/snippet di project-nya & memperbaiki bug. | Pemasangan sekali & ringan; error terkirim otomatis dengan stack trace utuh; grup error jadi Spec yang cukup konteks untuk langsung dikerjakan. |
| **Project yang dipantau** *(aktor sistem)* | Backend Node/TS atau app React/browser yang mengirim error. | Cara sederhana & aman mengirim error (DSN), tanpa membebani runtime & tanpa memblok saat hanoman down. |
| **hanoman (ingest + dashboard)** *(aktor sistem)* | Penerima, pengelompok, penyimpan, penampil error, dan jembatan ke backlog. | Menerima kiriman ber-DSN, dedup jadi grup, simpan hemat, tampilkan, beri notifikasi, buat Spec prefilled. |

## Goals & non-goals

### Goals
1. **Tangkap error dari project apa pun yang didaftarkan.** Endpoint ingest menerima error terstruktur (JSON) dari project mana pun via DSN per-project; target SDK/snippet resmi pertama: **Node/TS** & **React/browser**.
2. **Satu pandangan error terpusat.** Area Error di dashboard menampilkan grup error lintas project & per-project, dengan hitungan, first-seen, last-seen, dan filter environment.
3. **Grouping otomatis ala Sentry.** Kejadian identik digabung ke satu grup lewat fingerprint (tipe + pesan ternormalisasi + frame stack teratas) sehingga daftar tetap terbaca & tiap grup layak dinilai.
4. **Sinyal proaktif tanpa banjir.** Notifikasi in-app saat **grup error baru** pertama kali muncul; default hanya untuk environment production.
5. **Jembatan sekali klik ke backlog.** Dari detail grup, satu klik membuat `Spec` (source QA/finding) untuk project itu, **prefilled** dari pesan + stack + tautan balik ke grup, lalu masuk alur backlog existing (audit → plan → execute). Grup ditandai "escalated" + tertaut ke Spec agar tak dobel.
6. **Aman & terkendali.** DSN unik per project, dapat di-rotate/revoke dari Settings project; endpoint ingest menolak request tanpa DSN valid; data project tetap terisolasi antar-DSN.

### Non-goals (versi pertama)
1. **Bukan APM/tracing/performance monitoring.** Hanya error/exception, bukan latency span, throughput, atau profiling.
2. **Bukan session replay** atau perekaman interaksi pengguna.
3. **Bukan symbolication/source-map** untuk minified stack browser (stack dikirim apa adanya; source-map pasca-MVP).
4. **Bukan alert eksternal** (email/Slack/webhook) & **bukan deteksi lonjakan** — hanya notifikasi in-app untuk grup baru.
5. **Bukan grouping override manual** (merge/split grup oleh operator). Auto-grouping saja; override menyusul bila auto meleset terlalu sering.
6. **Bukan SDK mobile** (React Native/Flutter) — pasca-MVP.
7. **Bukan multi-workspace/RBAC.** Satu workspace `nafanesia`, semua operator setara (sejalan `scope-principles.md`).
8. **Bukan mesin analitik/dashboard metrik lanjutan** (grafik tren jangka panjang, breakdown by-tag kompleks) di versi ini.

## Scope (in / out)

### In scope
- **Endpoint ingest** JSON publik, otentikasi via **DSN/ingest-key per project** (pengecualian sah terhadap auth-gate `/api`, ditetapkan ADR baru).
- **DSN per project**: pembuatan, tampilan, rotate, revoke — dari Settings/detail project di hanoman.
- **SDK/snippet resmi**: (a) helper Node/TS yang memasang handler `uncaughtException` + `unhandledRejection` dan capture manual; (b) snippet browser yang memasang `window.onerror` + `unhandledrejection` (dengan CORS yang benar). Keduanya mengirim payload berisi: tipe error, pesan, stack, environment, timestamp, dan metadata ringkas (mis. release/versi opsional, url/route opsional).
- **Model penyimpanan baru** (butuh migration + ADR): grup error per project (fingerprint, count, first/last seen, status, environment terakhir, tautan Spec) + kejadian error mentah (stack, environment, timestamp, metadata).
- **Grouping otomatis** via fingerprint deterministik.
- **Area Error di dashboard**: daftar grup (lintas & per project), filter environment, urut by last-seen/count, detail grup (stack sampel, tren kejadian sederhana, riwayat first/last seen).
- **Notifikasi in-app** untuk grup baru (default environment production).
- **Eskalasi 1-klik → `Spec`** prefilled + tautan dua arah grup↔Spec + penanda "escalated".
- **Retensi & rate-limit** ingest (angka final di Open questions) agar penyimpanan & endpoint tidak banjir.

### Out of scope
- Tracing/APM, session replay, symbolication, alert eksternal, deteksi lonjakan, grouping override manual, SDK mobile, multi-workspace/RBAC, mesin analitik lanjutan (lihat Non-goals).
- Perubahan pada mekanisme eksekusi sesi/worktree/tmux — fitur ini murni lapisan data + UI + jembatan backlog.
- Auto-fix/auto-execute error tanpa keputusan manusia — eskalasi selalu keputusan operator (manusia terakhir yang memutuskan).

## User stories

1. **Sebagai operator**, saat aku mendaftarkan project ke error monitoring, aku ingin mendapat **DSN/ingest-key** yang bisa kupasang di project itu, supaya errornya mulai terkirim ke hanoman.
2. **Sebagai developer**, aku ingin **memasang SDK/snippet sekali** (Node atau browser) lalu error runtime terkirim otomatis dengan stack trace utuh, tanpa aku harus menulis kode kirim per-error.
3. **Sebagai operator**, aku ingin melihat **daftar grup error** lintas project dengan hitungan & waktu terakhir, supaya aku tahu apa yang paling sering/baru rusak.
4. **Sebagai operator**, aku ingin **menyaring error per environment** (mis. hanya production), supaya noise dari dev/lokal tidak mengaburkan yang penting.
5. **Sebagai operator**, aku ingin **notifikasi in-app saat grup error baru muncul** (production), supaya aku tahu ada masalah baru tanpa harus terus memantau dashboard.
6. **Sebagai operator**, saat aku buka **detail grup**, aku ingin melihat pesan, stack trace sampel, environment, first/last seen, dan hitungan, supaya aku bisa menilai apakah layak ditindak.
7. **Sebagai operator**, aku ingin **satu klik mengeskalasi grup ke backlog** dan mendapat `Spec` yang sudah terisi judul + deskripsi (pesan + stack + tautan balik ke grup), supaya aku tak perlu menyalin konteks manual.
8. **Sebagai operator**, aku ingin grup yang sudah dieskalasi **ditandai & tertaut ke Spec-nya**, supaya aku tak membuat backlog dobel untuk error yang sama.
9. **Sebagai operator**, aku ingin bisa **rotate/revoke DSN** sebuah project, supaya bila kunci bocor aku bisa mematikannya tanpa membongkar project lain.
10. **Sebagai operator**, aku ingin ingest **tahan banjir** (rate-limit + retensi), supaya satu project yang error terus-menerus tidak menghabiskan penyimpanan atau membuat daftar tak terpakai.

## Acceptance criteria (gaya EARS)

### Ingest & DSN
- WHEN sebuah project mengirim POST error ke endpoint ingest dengan **DSN valid**, THE SYSTEM SHALL menerima payload, mengaitkannya ke project pemilik DSN, dan menyimpannya sebagai kejadian error.
- IF request ingest **tidak menyertakan DSN valid** (hilang/salah/revoked), THEN THE SYSTEM SHALL menolak request dengan status error tanpa membocorkan project mana pun.
- THE SYSTEM SHALL menyediakan **DSN unik per project** yang dapat dilihat, di-**rotate**, dan di-**revoke** dari antarmuka project di hanoman.
- WHEN operator me-**rotate** atau me-**revoke** DSN sebuah project, THE SYSTEM SHALL menolak ingest berikutnya yang memakai DSN lama.
- THE SYSTEM SHALL menerima payload ingest **berformat JSON generik** (tipe, pesan, stack, environment, timestamp, metadata) sehingga sumber bahasa apa pun dapat mengirim tanpa perubahan server.
- WHERE request ingest berasal dari **browser**, THE SYSTEM SHALL merespons header CORS yang mengizinkan pengiriman lintas-origin dari project klien.
- IF laju ingest sebuah DSN **melampaui batas** (rate-limit), THEN THE SYSTEM SHALL membatasi/menolak kelebihannya tanpa memengaruhi ingest project lain.

### Grouping
- WHEN sebuah kejadian error diterima, THE SYSTEM SHALL menghitung **fingerprint** dari tipe + pesan ternormalisasi + frame stack teratas, lalu memasukkannya ke **grup** yang sesuai (membuat grup baru bila belum ada).
- WHEN kejadian masuk ke grup yang **sudah ada**, THE SYSTEM SHALL menaikkan **count** grup dan memperbarui **last-seen**, tanpa membuat baris grup baru.
- THE SYSTEM SHALL menyimpan **first-seen**, **last-seen**, **count**, dan **environment** pada tiap grup.

### Tampilan & filter
- THE SYSTEM SHALL menampilkan **area Error** yang memuat daftar grup error, lintas project dan tersaring per project.
- THE SYSTEM SHALL menampilkan tiap grup dengan pesan, count, first-seen, last-seen, environment, dan status (mis. baru/escalated).
- WHERE operator memilih filter **environment**, THE SYSTEM SHALL hanya menampilkan grup yang cocok dengan environment terpilih.
- WHEN operator membuka **detail grup**, THE SYSTEM SHALL menampilkan stack trace sampel, environment, riwayat first/last seen, dan hitungan kejadian.
- THE SYSTEM SHALL memperbarui data area Error lewat **HTTP polling** (mengikuti pola dashboard existing), bukan kanal WebSocket baru.

### Notifikasi
- WHEN sebuah **grup error baru** pertama kali muncul untuk environment **production**, THE SYSTEM SHALL membuat **Notification in-app** di hanoman.
- WHILE grup sudah pernah ada (bukan baru), THE SYSTEM SHALL **tidak** membuat notifikasi baru untuk tiap kejadian tambahan pada grup itu.
- WHERE environment kejadian **bukan production**, THE SYSTEM SHALL secara default **tidak** membuat notifikasi grup baru.

### Eskalasi ke backlog
- WHEN operator menekan **"Eskalasi ke backlog"** pada sebuah grup, THE SYSTEM SHALL membuat satu **`Spec`** (source QA/finding) untuk project grup itu, dengan judul & deskripsi **prefilled** dari pesan + stack trace + tautan balik ke grup.
- WHEN sebuah `Spec` dibuat dari eskalasi, THE SYSTEM SHALL menandai grup sebagai **escalated** dan menyimpan **tautan dua arah** antara grup dan `Spec`.
- IF sebuah grup **sudah pernah dieskalasi**, THEN THE SYSTEM SHALL menandainya jelas dan menautkan ke `Spec` yang ada (mencegah pembuatan backlog dobel tanpa konfirmasi eksplisit).
- THE SYSTEM SHALL memastikan `Spec` hasil eskalasi masuk **alur backlog existing** (audit → plan → execute) tanpa mekanisme khusus.

### Keamanan & data
- THE SYSTEM SHALL memperlakukan endpoint ingest sebagai **pengecualian sah** terhadap auth-gate `/api`, diotorisasi **hanya** oleh DSN valid (ditetapkan lewat ADR baru).
- THE SYSTEM SHALL menjaga **isolasi data antar-project**: satu DSN tak pernah bisa membaca/menulis error project lain.
- THE SYSTEM SHALL menyimpan model error baru **melalui migration + ADR** (tanpa mengubah skema di luar itu).
- WHILE penyimpanan mendekati batas retensi, THE SYSTEM SHALL **memangkas kejadian mentah** sesuai kebijakan retensi (angka final di Open questions) sambil mempertahankan ringkasan grup.

## Metrik sukses

1. **Cakupan pemantauan.** Jumlah project nafanesia yang **aktif mengirim error** ke hanoman (target: seluruh project production dalam N minggu setelah rilis).
2. **Waktu deteksi (time-to-awareness).** Selisih median antara error production pertama sebuah grup baru dan saat operator melihatnya (via notifikasi). Target: turun drastis dari "manual/berjam-jam" ke **menit**.
3. **Konversi error → backlog.** Persentase grup error production yang layak-tindak yang **dieskalasi jadi `Spec`** lewat tombol 1-klik (indikator jembatan benar-benar dipakai, bukan copy-paste manual).
4. **Kualitas eskalasi.** Persentase `Spec` hasil eskalasi yang **cukup konteks untuk langsung masuk plan/execute** tanpa operator harus menambah info manual signifikan.
5. **Kebersihan sinyal.** Rasio notifikasi yang **ditindaklanjuti** vs diabaikan (proksi apakah "grup baru + default production" menekan noise dengan benar).
6. **Kesehatan ingest.** Endpoint ingest tetap sehat di bawah beban (rate-limit bekerja; tak ada project yang membanjiri; penyimpanan stabil dalam batas retensi).

## Open questions

1. **Angka retensi & volume.** Berapa lama kejadian mentah disimpan (usul: ~30 hari) dan berapa cap sampel per grup (usul: N kejadian terakhir)? Grup diasumsikan tak kedaluwarsa — perlu dikonfirmasi.
2. **Rate-limit ingest.** Batas per DSN (per menit/jam) dan perilaku saat terlampaui (drop diam-diam vs respons throttle) — perlu angka final.
3. **Redaksi PII.** Apakah payload perlu mekanisme redaksi/scrub data sensitif (mis. token, email, body request) sebelum disimpan? Di sisi SDK, server, atau keduanya?
4. **Format & rotasi DSN.** Bentuk DSN (opaque token vs URL bergaya Sentry), cara distribusi ke project, dan apakah rotate menyediakan masa tumpang-tindih (grace) agar deploy tak langsung putus.
5. **Source-map browser.** Stack minified dari React/browser sulit dibaca — apakah symbolication (upload source-map) dibutuhkan cukup awal, atau tetap pasca-MVP?
6. **Dedup notifikasi & re-open.** Bila grup yang sudah "resolved/escalated" muncul lagi (regresi), apakah memicu notifikasi baru / membuka kembali grup? Aturan status grup (baru → escalated → resolved → regressed?) perlu ditetapkan.
7. **Batas payload.** Ukuran maksimum payload/stack yang diterima, dan perlakuan saat payload melebihi (truncate vs tolak).
8. **Metadata release/versi.** Sejauh mana field release/versi & konteks (route/url, user id anonim) menjadi bagian standar payload v1 vs opsional.
