# PRD — Help Center per Project (link publik keluhan → backlog)

> Status: Draft untuk review. Author: PM/PO (nafanesia). Disusun dari brief "Help Center per Project" + brainstorm.
> Deliverable ini adalah **dokumen PRD**, bukan spesifikasi teknis/rencana implementasi. Keputusan implementasi mengikuti PRD ini lewat SPEC/ADR tersendiri.

## Ringkasan

Tiap project yang dijalankan di hanoman butuh cara sederhana bagi **pengguna akhir/pelanggannya** untuk melaporkan keluhan atau kendala — tanpa harus tahu apa pun tentang hanoman, backlog, atau tim internal. PRD ini menambahkan **Help Center per project**: sebuah **link publik yang siap disebar** (mis. `/help/<projectId>`) berisi **form lapor keluhan** dan **halaman cek status tiket**. Setiap keluhan masuk sebagai **tiket** ke **antrean triase** di dashboard hanoman, tempat tim internal memutuskan mana yang **naik jadi backlog** (`Spec`) dan mana yang **ditolak/ditutup**.

Bentuknya mengikuti pola yang sudah terbukti di hanoman untuk error monitoring (SPEC-249): endpoint **publik ber-scope-project** sebagai pengecualian sah terhadap auth-gate `/api`, plus jembatan sekali-tindak ke backlog existing (`audit → plan → execute`). Bedanya, sumber di sini adalah **manusia** (pelanggan mengisi form), bukan mesin (SDK mengirim error). Karena itu Help Center menambahkan tiga hal yang tak ada di error monitoring: **halaman publik yang ramah non-teknis**, **antrean triase** agar backlog tidak kebanjiran keluhan mentah/spam, dan **status tiket yang bisa dicek pelapor** (dipetakan otomatis dari keadaan internal, tanpa jargon).

Cakupan versi pertama sengaja dipersempit ke **jalur end-to-end yang tipis tapi utuh**: aktifkan link → user lapor (dengan lampiran gambar) → tiket masuk triase → notifikasi tim → terima jadi `Spec` atau tolak → pelapor cek status. Fitur berat ala help desk komersial (knowledge base/FAQ, live chat, SLA/eskalasi otomatis, balasan dua-arah via email, akun pelanggan) berada **di luar scope** versi ini.

Cakupan: **satu workspace** (`nafanesia`), sejalan dengan prinsip MVP hanoman (multi-tenant pasca-MVP).

## Masalah & konteks

### Masalah
1. **Tidak ada pintu masuk keluhan untuk pengguna akhir.** hanoman hari ini adalah alat internal — backlog (`Spec`) hanya lahir dari operator, audit, atau error monitoring. Pengguna/pelanggan sebuah project **tidak punya cara** melaporkan keluhan; mereka harus lewat kanal ad-hoc (chat pribadi, email tim, DM) yang tak tercatat dan mudah hilang.
2. **Keluhan tidak tersambung ke pekerjaan.** Bahkan saat keluhan sampai ke tim, mengubahnya jadi item yang dikerjakan adalah langkah manual: menyalin isi, menulis ulang konteks, membuat backlog dari nol. Konteks (siapa pelapor, kategori, screenshot) sering hilang di jalan.
3. **Backlog rawan kebanjiran bila keluhan langsung masuk.** Jika setiap keluhan publik langsung menjadi `Spec`, backlog akan bercampur dengan duplikat, salah-alamat, dan spam. Tim butuh **penyaring** ("filter mana yang harus dikerjakan dan yang tidak perlu") **sebelum** sesuatu menjadi pekerjaan.
4. **Pelapor buta terhadap tindak lanjut.** Setelah melapor, pengguna tidak tahu apakah keluhannya diterima, sedang dikerjakan, atau ditolak. Ketiadaan umpan balik menurunkan kepercayaan dan memicu laporan berulang untuk hal yang sama.
5. **Tidak ada isolasi per project.** Satu link/kanal untuk semua project mencampur keluhan lintas produk; tim sulit tahu keluhan itu milik project mana dan siapa yang harus menanganinya.

### Konteks arsitektur hanoman (fakta yang mengikat desain)
- **"Backlog item" = model `Spec`.** Backlog di hanoman adalah baris `Spec` (punya `stage`, `source`, `priority`, `payload`, `baseSha/headSha`). Alur QA/finding sudah ada: `audit → keputusan → (spec → plan)? → execute`; temuan kecil bisa langsung execute. Promosi tiket harus **menyambung ke jalur ini**, bukan membuat mekanisme backlog baru. (ADR-0020/0040)
- **Tiket adalah entitas baru, bukan `Spec`.** Keluhan mentah bukan backlog; ia hidup di **antrean triase** sebagai model baru (**`Ticket`**, plus penyimpanan lampiran). Menambah model **wajib lewat migration + ADR** dan tak boleh mengubah skema tanpa itu. Backlog hanya terisi saat tiket **dipromosikan**.
- **Auth menggerbangi seluruh `/api`** (ADR-0028): 401 tanpa sesi login. Publik hanya `GET /health`, `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`. **Halaman Help Center, endpoint submit keluhan, cek status, dan upload lampiran harus menjadi pengecualian sah** (dipanggil pengguna akhir tanpa sesi login) → butuh **ADR baru** (pola ADR-0060 untuk ingest error): akses publik diotorisasi oleh **status Help Center project = aktif** (untuk submit) dan **kode/link tiket opaque** (untuk cek status), bukan cookie sesi.
- **`Project.id` (slug) kekal; `repoDir` opsional & per-mesin.** Link Help Center ditautkan ke `Project` lewat slug yang stabil (`/help/<projectId>`), bukan path lokal. Aktivasi = flag opt-in per project (pola on/off ingest SPEC-249).
- **Realtime = WebSocket hanya untuk terminal PTY; sisanya HTTP polling** (ADR-0039). Inbox triase & badge mengikuti pola yang sama: **polling**, bukan menambah kanal WebSocket baru.
- **Notifikasi = model `Notification`** yang sudah ada (mis. notif backlog selesai ADR-0033, grup error baru SPEC-249). Notifikasi tiket baru memakai kanal yang sama.
- **Status publik diturunkan, bukan disimpan ganda.** Status yang dilihat pelapor **dipetakan otomatis** dari keadaan tiket + `stage` `Spec` tertaut (selaras semangat ADR-0018/0019: nilai turunan lebih baik daripada state kembar yang bisa basi).
- **Kapabilitas baru sebagai dependensi.** Help Center memperkenalkan dua hal yang belum ada di hanoman: **penyimpanan berkas** (lampiran gambar dari upload publik) dan **pengiriman email transaksional** (mengirim link status ke pelapor). Keduanya adalah dependensi/keputusan yang dirinci di **Open questions**; v1 tidak menggantungkan alur inti pada email (link status ditampilkan di layar setelah kirim).

### Kenapa sekarang
hanoman sudah menjadi pusat backlog & sesi untuk banyak project di bawah satu operator. Error monitoring (SPEC-249) menutup jalur **mesin → backlog**. Help Center menutup jalur **manusia → backlog**: mengubah keluhan pengguna akhir yang selama ini tersebar dan tak tercatat menjadi antrean yang tertriase rapi, dengan backlog yang tetap bersih. Karena polanya (endpoint publik ber-scope-project + jembatan ke `Spec`) sudah terbukti, biaya menambah kanal manusia ini rendah dan nilainya langsung: tim berhenti kehilangan keluhan, dan pengguna akhir akhirnya punya pintu resmi.

## Persona / pengguna

| Persona | Deskripsi | Kebutuhan utama |
|---|---|---|
| **Pelapor / pengguna akhir** | Pelanggan atau pengguna sebuah project yang punya keluhan/kendala. Non-teknis, tanpa akun hanoman. | Cara cepat & jelas melaporkan masalah (dengan screenshot), tanpa login, lalu bisa memantau apakah keluhannya ditindaklanjuti. |
| **Operator / triager (nafanesia)** | Tim internal yang memantau banyak project di hanoman & mengelola backlog. | Melihat keluhan masuk per project di satu inbox, menilai cepat, lalu **terima → backlog** atau **tolak** tanpa menyalin manual — menjaga backlog hanya berisi yang layak dikerjakan. |
| **Developer project** | Yang mengerjakan `Spec` hasil promosi. | `Spec` yang cukup konteks (isi keluhan + kategori + lampiran + tautan balik ke tiket) untuk langsung masuk plan/execute. |
| **hanoman (Help Center + dashboard)** *(aktor sistem)* | Penyaji halaman publik, penerima keluhan, penyimpan tiket & lampiran, penampil antrean triase, jembatan ke backlog, dan penyaji status. | Menyajikan halaman publik ber-scope-project, menerima submit yang tervalidasi & tahan-spam, menyimpan tiket + lampiran, memberi notifikasi tim, mempromosikan tiket ke `Spec` dua-arah, dan menurunkan status untuk pelapor. |

## Goals & non-goals

### Goals
1. **Link publik keluhan per project yang siap disebar.** Tiap project dapat mengaktifkan halaman Help Center di URL stabil (`/help/<projectId>`) yang memuat form lapor keluhan, dapat diakses tanpa login.
2. **Keluhan tertriase sebelum jadi backlog.** Setiap keluhan masuk sebagai **tiket** ke antrean triase; backlog (`Spec`) hanya terisi saat tim internal **memutuskan menerima** — menjaga backlog bersih dari keluhan mentah, duplikat, dan spam.
3. **Jembatan sekali-tindak tiket → backlog.** Dari triase, satu tindakan mempromosikan tiket menjadi `Spec` (source keluhan/help) untuk project itu, **prefilled** dari isi keluhan + kategori + lampiran + tautan balik ke tiket, lalu masuk alur backlog existing.
4. **Umpan balik status ke pelapor tanpa jargon.** Pelapor mendapat nomor + link tiket berkode dan dapat mengecek status publik yang **dipetakan otomatis** dari keadaan tiket/`Spec` (Sedang ditinjau → Diterima → Sedang dikerjakan → Selesai / Ditutup).
5. **Sinyal proaktif untuk tim.** Notifikasi in-app saat tiket baru masuk, plus badge hitung "belum ditinjau" di inbox triase, agar keluhan tidak lama tak terlihat.
6. **Konteks lengkap dalam laporan.** Form menangkap kategori, judul, detail, email pelapor, dan **lampiran gambar** (screenshot) sehingga tim menilai tanpa bolak-balik menanyakan ulang.
7. **Aman & terkendali per project.** Link opt-in per project, dapat dinonaktifkan; data tiket terisolasi per project; endpoint publik menolak akses ke project yang Help Center-nya nonaktif.

### Non-goals (versi pertama)
1. **Bukan knowledge base / FAQ / self-service.** Tidak ada artikel bantuan, pencarian, atau editor konten. Hanya intake + status.
2. **Bukan live chat / komunikasi dua-arah.** Tidak ada balas-membalas dengan pelapor di dalam sistem; email pelapor adalah kontak, bukan kanal percakapan bawaan v1.
3. **Bukan akun/portal pelanggan.** Pelapor tak perlu (dan tak bisa) login; tak ada daftar "tiket saya" lintas laporan.
4. **Bukan SLA / eskalasi otomatis / prioritas by-rule.** Prioritas ditentukan tim saat triase, bukan mesin. Tidak ada timer/janji waktu.
5. **Bukan mesin anti-spam berat.** v1 hanya rate-limit + honeypot ringan; tanpa CAPTCHA eksternal, verifikasi email, atau moderasi otomatis. Spam disaring saat triase.
6. **Bukan verifikasi email.** Email wajib diisi tapi tidak diverifikasi di v1; link status ditampilkan di layar setelah kirim.
7. **Bukan dedup/merge tiket otomatis.** Duplikat ditangani manual saat triase; tidak ada penggabungan otomatis di v1.
8. **Bukan multi-workspace/RBAC.** Satu workspace `nafanesia`; semua operator setara (sejalan `scope-principles.md`).
9. **Bukan analitik lanjutan.** Tidak ada dashboard tren/laporan volume keluhan jangka panjang di versi ini.

## Scope (in / out)

### In scope
- **Aktivasi per project**: toggle "Aktifkan Help Center" di detail/Settings project; saat aktif memunculkan **link publik stabil** (`/help/<projectId>`) yang bisa disalin & disebar; dapat dinonaktifkan.
- **Halaman Help Center publik** (tanpa login), memuat: identitas project (nama + branding minimal), **form lapor keluhan**, dan akses **cek status tiket**.
- **Form lapor keluhan** dengan field: **kategori** (set tetap: Bug / Permintaan fitur / Pertanyaan / Lainnya), **judul**, **detail**, **email pelapor (wajib)**, dan **lampiran gambar** (mis. maks 3 berkas, ≤5MB/berkas; batas final di Open questions).
- **Endpoint publik** (pengecualian sah auth-gate, ditetapkan ADR baru): submit keluhan, upload lampiran, dan cek status tiket — diotorisasi oleh status Help Center aktif (submit/upload) dan kode/link tiket opaque (cek status).
- **Model penyimpanan baru** (butuh migration + ADR): **`Ticket`** per project (kategori, judul, detail, email pelapor, status triase, kode akses opaque, tautan `Spec`, timestamp) + **lampiran** (referensi berkas gambar).
- **Antrean triase (inbox)** di dashboard: daftar tiket lintas & per project, badge "belum ditinjau", detail tiket (isi + lampiran + metadata), dengan aksi **Terima → buat `Spec`** dan **Tolak → tutup tiket**.
- **Promosi tiket → `Spec`** (source keluhan/help) prefilled + **tautan dua arah** tiket↔`Spec` + penanda "dipromosikan" (mencegah dobel). Prioritas ditetapkan tim saat triase.
- **Status publik terpetakan otomatis** dari keadaan tiket + `stage` `Spec` tertaut; ditampilkan ke pelapor di halaman cek status.
- **Notifikasi in-app** (model `Notification` existing) saat tiket baru masuk.
- **Proteksi minimal**: rate-limit submit per IP & per project + honeypot ringan.
- **Konfirmasi pasca-kirim**: menampilkan **nomor tiket + link status berkode** di layar; pengiriman email link status bersifat **best-effort/dependensi** (Open questions), bukan gerbang alur.

### Out of scope
- Knowledge base/FAQ, live chat/komunikasi dua-arah, akun/portal pelanggan, SLA/eskalasi otomatis, CAPTCHA/verifikasi email/moderasi otomatis, dedup/merge otomatis, multi-workspace/RBAC, analitik lanjutan (lihat Non-goals).
- Perubahan pada mekanisme eksekusi sesi/worktree/tmux — fitur ini murni lapisan publik + data + UI triase + jembatan backlog.
- Auto-promote/auto-execute keluhan tanpa keputusan manusia — promosi ke backlog **selalu** keputusan tim (manusia terakhir yang memutuskan).
- Balasan/komentar bolak-balik dengan pelapor di dalam tiket (v1 hanya status satu-arah).

## User stories

1. **Sebagai operator**, saat aku mengaktifkan Help Center sebuah project, aku ingin mendapat **link publik yang bisa kusalin & sebar**, supaya pengguna project itu punya pintu resmi untuk melapor.
2. **Sebagai operator**, aku ingin bisa **menonaktifkan** Help Center sebuah project, supaya project yang belum siap tidak terekspos menerima keluhan.
3. **Sebagai pelapor**, aku ingin membuka link Help Center sebuah project dan **mengisi form keluhan** (kategori, judul, detail, email, screenshot) tanpa login, supaya melapor terasa cepat dan tidak berbelit.
4. **Sebagai pelapor**, setelah mengirim aku ingin mendapat **nomor + link tiket**, supaya nanti aku bisa mengecek apakah keluhanku ditindaklanjuti.
5. **Sebagai pelapor**, aku ingin membuka link tiketku dan melihat **status yang mudah dimengerti** (mis. "Sedang ditinjau", "Sedang dikerjakan", "Selesai", "Ditutup"), tanpa istilah teknis internal.
6. **Sebagai operator**, aku ingin **notifikasi in-app + badge** saat ada keluhan baru, supaya tak perlu terus memantau inbox.
7. **Sebagai operator (triager)**, aku ingin membuka **inbox triase** dan melihat daftar tiket per project beserta isinya (detail + lampiran), supaya aku bisa menilai cepat mana yang layak dikerjakan.
8. **Sebagai operator (triager)**, aku ingin **menerima** sebuah tiket dan langsung mendapat **`Spec` prefilled** (isi keluhan + kategori + lampiran + tautan balik ke tiket) yang masuk alur backlog existing, supaya aku tak menyalin konteks manual.
9. **Sebagai operator (triager)**, aku ingin **menolak/menutup** tiket yang tidak perlu, supaya backlog tetap hanya berisi yang benar-benar dikerjakan.
10. **Sebagai operator**, aku ingin tiket yang sudah dipromosikan **ditandai & tertaut ke `Spec`-nya**, supaya aku tak membuat backlog dobel untuk keluhan yang sama.
11. **Sebagai developer**, saat aku mengambil `Spec` hasil promosi, aku ingin konteks keluhan aslinya (isi + lampiran + kategori) ada di situ, supaya aku bisa langsung plan/execute tanpa menanya ulang.
12. **Sebagai operator**, aku ingin form publik **tahan spam wajar** (rate-limit + honeypot), supaya satu orang/bot tidak membanjiri antrean triase.

## Acceptance criteria (gaya EARS)

### Aktivasi & link per project
- THE SYSTEM SHALL menyediakan kontrol **opt-in per project** untuk mengaktifkan/menonaktifkan Help Center dari antarmuka project di hanoman.
- WHEN Help Center sebuah project **diaktifkan**, THE SYSTEM SHALL menyediakan **link publik stabil** yang terikat pada `Project.id` (slug), yang dapat disalin dan disebar.
- WHILE Help Center sebuah project **nonaktif**, THE SYSTEM SHALL tidak menyajikan halaman publik project itu dan **menolak** submit keluhan untuknya.
- WHEN operator **menonaktifkan** Help Center, THE SYSTEM SHALL menghentikan penerimaan keluhan baru untuk project itu tanpa menghapus tiket yang sudah ada.

### Halaman publik & submit keluhan
- THE SYSTEM SHALL menyajikan **halaman Help Center publik tanpa login** yang memuat identitas project (nama + branding minimal), form lapor keluhan, dan akses cek status tiket.
- THE SYSTEM SHALL menerima submit keluhan berisi **kategori, judul, detail, email pelapor, dan lampiran gambar opsional**, dan menyimpannya sebagai **tiket** milik project terkait.
- IF submit **tidak menyertakan field wajib** (kategori/judul/detail/email), THEN THE SYSTEM SHALL menolak submit dengan pesan yang jelas dan tidak membuat tiket.
- WHERE pelapor menyertakan **lampiran gambar**, THE SYSTEM SHALL memvalidasi tipe & ukuran berkas (batas final di Open questions), menerima yang valid, dan menolak yang tidak valid tanpa menggagalkan seluruh submit yang sisanya sah.
- WHEN sebuah tiket berhasil dibuat, THE SYSTEM SHALL menampilkan **nomor tiket + link status berkode** kepada pelapor.
- THE SYSTEM SHALL memperlakukan endpoint publik (halaman, submit, upload, cek status) sebagai **pengecualian sah** terhadap auth-gate `/api`, ditetapkan lewat **ADR baru**.

### Proteksi (minimal)
- IF laju submit dari satu **IP** atau untuk satu **project** melampaui batas, THEN THE SYSTEM SHALL membatasi/menolak kelebihannya tanpa memengaruhi project lain.
- WHERE submit mengisi **field honeypot**, THE SYSTEM SHALL memperlakukannya sebagai bot dan menolak diam-diam tanpa membuat tiket.
- THE SYSTEM SHALL **tidak memverifikasi** email pelapor di v1; email disimpan sebagai kontak apa adanya.

### Antrean triase & notifikasi
- WHEN sebuah **tiket baru** masuk, THE SYSTEM SHALL membuat **Notification in-app** untuk tim dan menaikkan **badge "belum ditinjau"** pada inbox triase.
- THE SYSTEM SHALL menampilkan **inbox triase** berisi daftar tiket, lintas project dan tersaring per project, beserta kategori, judul, email pelapor, waktu masuk, dan status triase.
- WHEN operator membuka **detail tiket**, THE SYSTEM SHALL menampilkan isi keluhan penuh (kategori, judul, detail), **lampiran gambar**, email pelapor, dan tautan `Spec` bila sudah dipromosikan.
- THE SYSTEM SHALL memperbarui inbox triase & badge lewat **HTTP polling** (mengikuti pola dashboard existing), bukan kanal WebSocket baru.

### Promosi & penolakan (jembatan ke backlog)
- WHEN operator **menerima** sebuah tiket, THE SYSTEM SHALL membuat satu **`Spec`** (source keluhan/help) untuk project tiket itu, **prefilled** dari kategori + judul + detail + lampiran + tautan balik ke tiket, dan memasukkannya ke **alur backlog existing** (audit → plan → execute) tanpa mekanisme khusus.
- WHEN sebuah `Spec` dibuat dari promosi, THE SYSTEM SHALL menandai tiket sebagai **dipromosikan** dan menyimpan **tautan dua arah** antara tiket dan `Spec`.
- IF sebuah tiket **sudah dipromosikan**, THEN THE SYSTEM SHALL menandainya jelas dan menautkan ke `Spec` yang ada (mencegah pembuatan backlog dobel tanpa konfirmasi eksplisit).
- WHEN operator **menolak** sebuah tiket, THE SYSTEM SHALL menutup tiket tanpa membuat `Spec` dan tanpa memengaruhi backlog.
- THE SYSTEM SHALL menetapkan **prioritas** `Spec` hasil promosi berdasarkan keputusan tim saat triase (bukan aturan otomatis).

### Cek status (pelapor)
- WHEN pelapor membuka **link/kode tiket** yang valid, THE SYSTEM SHALL menampilkan **status publik** tiket itu.
- THE SYSTEM SHALL menurunkan status publik **secara otomatis** dari keadaan tiket + `stage` `Spec` tertaut, dengan pemetaan minimal: tiket baru/belum ditriase → "Sedang ditinjau"; ditolak → "Ditutup"; `Spec` dibuat → "Diterima"; `Spec` dalam plan/execute → "Sedang dikerjakan"; `Spec` selesai/merged → "Selesai".
- THE SYSTEM SHALL **tidak** menampilkan istilah/stage teknis internal, isi backlog lain, atau data project lain kepada pelapor.
- IF kode/link tiket **tidak valid atau tidak dikenal**, THEN THE SYSTEM SHALL menolak akses tanpa membocorkan keberadaan tiket atau project lain.

### Keamanan & data
- THE SYSTEM SHALL menjaga **isolasi data antar-project**: submit/akses lewat satu Help Center project tak pernah bisa membaca/menulis tiket project lain.
- THE SYSTEM SHALL menjadikan **kode/link tiket bersifat opaque & sulit ditebak**, sehingga status hanya dapat diakses oleh pemegang link (bentuk & kekuatan final di Open questions).
- THE SYSTEM SHALL menyimpan model tiket & lampiran baru **melalui migration + ADR** (tanpa mengubah skema di luar itu).
- WHILE penyimpanan tiket/lampiran mendekati batas retensi, THE SYSTEM SHALL memangkasnya sesuai kebijakan retensi (angka final di Open questions) sambil mempertahankan tiket yang tertaut `Spec` aktif.

## Metrik sukses

1. **Adopsi kanal.** Jumlah project yang **mengaktifkan** Help Center dan jumlah keluhan yang masuk lewat link (indikator kanal dipakai, bukan kanal ad-hoc).
2. **Backlog tetap bersih.** Rasio tiket **diterima → `Spec`** vs **ditolak/ditutup** — memastikan triase benar-benar menyaring, dan backlog hanya berisi yang layak (target: proporsi promosi sehat, bukan 100% masuk).
3. **Konversi keluhan → pekerjaan.** Persentase tiket yang **dipromosikan** lewat tombol (indikator jembatan dipakai, bukan copy-paste manual).
4. **Kualitas promosi.** Persentase `Spec` hasil promosi yang **cukup konteks untuk langsung plan/execute** tanpa tim menambah info manual signifikan.
5. **Waktu tanggap triase.** Selisih median antara tiket masuk dan **keputusan triase pertama** (terima/tolak). Target: dari "tak menentu" ke **jam/hari kerja**, bukan mengendap.
6. **Transparansi ke pelapor.** Proporsi pelapor yang **membuka halaman status** setidaknya sekali (proksi bahwa umpan balik status berguna), dan penurunan laporan berulang untuk keluhan yang sama.
7. **Kesehatan endpoint publik.** Endpoint submit tetap sehat di bawah beban (rate-limit bekerja; tak ada project/IP yang membanjiri; spam yang lolos tetap terkelola saat triase).

## Open questions

1. **Penyimpanan lampiran.** Di mana berkas gambar disimpan (filesystem lokal per-mesin vs objek storage), bagaimana disajikan aman ke inbox triase, dan bagaimana bertahan saat `repoDir` berpindah mesin? hanoman belum punya kapabilitas penyimpanan berkas — ini kapabilitas baru yang perlu ditetapkan (kemungkinan ADR).
2. **Batas lampiran final.** Jumlah maksimum berkas per tiket (usul: 3), ukuran per berkas (usul: ≤5MB), tipe yang diizinkan (usul: gambar umum: png/jpg/webp), dan perlakuan saat melebihi (tolak berkas vs tolak submit).
3. **Email transaksional.** Apakah v1 mengirim email berisi link status ke pelapor, lewat infra apa (SMTP/relay), dan apa yang terjadi bila pengiriman gagal? Alur inti tidak menggantunginya (link tampil di layar), tapi keputusan infra email berdampak juga ke fitur lain (mis. notifikasi). Perlu ditetapkan.
4. **Bentuk & keamanan kode link tiket.** Format nomor tiket vs token akses (usul: nomor pendek human-readable + kunci opaque terpisah di link), panjang/entropi kunci, dan apakah kunci dapat di-rotate/kedaluwarsa.
5. **Retensi tiket & lampiran.** Berapa lama tiket ditutup/ditolak dan lampirannya disimpan; apakah tiket yang tertaut `Spec` aktif dikecualikan dari purge; kebijakan hapus lampiran setelah promosi.
6. **Kustomisasi kategori.** Set kategori v1 tetap (Bug / Permintaan fitur / Pertanyaan / Lainnya) — apakah perlu dapat dikustomisasi per project pasca-MVP, dan bagaimana kategori memetakan ke `priority`/`source` `Spec`.
7. **Angka rate-limit.** Batas submit per IP dan per project (per menit/jam) serta perilaku saat terlampaui (tolak dengan pesan vs throttle diam-diam).
8. **Redaksi PII.** Isi keluhan dari publik bisa memuat data sensitif (email pihak lain, nomor, tangkapan layar berisi kredensial). Apakah perlu peringatan di form, redaksi, atau kebijakan penanganan — di sisi form, server, atau keduanya?
9. **Duplikat & spam yang lolos.** Karena tanpa dedup otomatis, bagaimana tim menandai/menggabungkan duplikat saat triase, dan apakah perlu aksi "tandai spam" massal bila ada lonjakan?
10. **Branding & bahasa halaman publik.** Sejauh mana halaman publik dapat menampilkan nama/logo/warna project, dan apakah perlu dukungan lebih dari satu bahasa untuk pelapor.
11. **Status "ditolak" ke pelapor.** Apakah penolakan menampilkan alasan singkat ke pelapor atau hanya "Ditutup"; dan apakah pelapor bisa mengirim ulang setelah ditolak.
12. **Regresi/pembukaan kembali.** Bila keluhan yang sudah "Selesai" dilaporkan lagi (masalah kambuh), apakah tiket lama dibuka kembali atau selalu tiket baru; aturan status untuk kasus ini.
