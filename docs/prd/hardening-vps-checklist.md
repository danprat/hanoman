# PRD — Hardening VPS Checklist (hanoman)

> Status: Draft untuk review · Penulis: PM/PO Nafanesia (dipandu hanoman-prd) · Tanggal: 2026-07-17
> Branch: `prd/hardening-vps-checklist` · Rujukan checklist eksternal: https://bzn2026.lovable.app/

## Ringkasan

hanoman sudah punya fitur hardening VPS dasar: tombol **Harden** menjalankan 5 langkah idempoten (firewall, fail2ban, auto security update, sshd, NTP) dan **Audit** yang melaporkan ±9 pemeriksaan pass/fail/warn. Semuanya lewat skrip deterministik SSH+sudo (`server/scripts/vps/harden.sh`, `audit.sh`; ADR-0025), bukan sesi Claude.

PRD ini memperluas kemampuan itu menjadi **kerangka kepatuhan (compliance) berbasis checklist** yang menutup seluruh **232 item / 16 seksi** dari checklist rujukan, sehingga setiap VPS internal Nafanesia dapat **dikontrol dan dimonitor dengan mudah dari hanoman**. Inti perubahan:

1. **Katalog item** — 232 item didefinisikan sebagai sumber kebenaran versioned di git; setiap item punya **mode** `AUTO` (audit + remediasi otomatis), `AUDIT` (audit otomatis, remediasi manual), atau `INFO` (checkbox attestasi manual + panduan).
2. **Audit engine + skor kepatuhan** — hanoman mengukur status tiap item applicable per-VPS dan menghitung skor per-seksi & total.
3. **Checklist UI** — ops melihat seluruh item, status, skor, menandai item Not-Applicable (N/A), dan meng-attest item manual.
4. **Remediasi selektif** — ops memilih item `AUTO`, melihat **preview dry-run** perubahan, lalu menerapkannya; item berisiko-lockout/merusak tetap `AUDIT`-only.
5. **Monitoring drift tanpa cron** — re-audit dipicu manual/saat membuka layar VPS (patuh ADR-0024); regresi terhadap snapshot sebelumnya memunculkan Notification.

North-star: rata-rata **skor kepatuhan fleet naik ke ≥90%** item applicable.

Implementasi bertahap: **Fase 1** fondasi (katalog + audit + skor + checklist UI), **Fase 2** remediasi selektif AUTO, **Fase 3** drift/notifikasi proaktif + item app-layer kondisional.

## Masalah & konteks

**Masalah.** Hardening VPS Nafanesia hari ini hanya menyentuh sebagian kecil permukaan keamanan (5 langkah apply, ±9 audit). Sisanya — kernel sysctl, manajemen user, IDS/IPS, integritas berkas, logging, backup/DR, DDoS, keamanan web/DB/SSL, dan praktik rutin — dikerjakan **ad-hoc lewat SSH manual** atau tidak dikerjakan sama sekali. Akibatnya:

- Tak ada gambaran menyeluruh "seberapa keras" sebuah VPS; tak ada skor/baseline yang bisa dipantau.
- Drift konfigurasi (mis. seseorang mengubah `sshd_config`, mematikan firewall) tidak terdeteksi.
- Hardening lanjutan bergantung pada ingatan tiap orang, tidak konsisten antar-VPS, dan tidak tercatat.

**Konteks arsitektur hanoman yang membatasi solusi:**

- Pekerjaan hardening berjalan sebagai **skrip deterministik** via SSH+sudo (`ssh <host> 'sudo -n bash -s' < script.sh`), **bukan** sesi Claude (ADR-0025). Skrip idempoten & anti-lockout wajib dipertahankan.
- Console VPS berjalan via SSH+tmux lokal (ADR-0042).
- hanoman **sengaja tanpa** message queue, worker terpisah, **scheduler/cron**, maupun webhook (ADR-0024). Realtime = WebSocket untuk PTY + **HTTP polling** untuk sisanya. Monitoring karenanya dipicu manual/on-view, bukan latar belakang.
- State disimpan di Postgres (Prisma). Perubahan skema butuh **migration + ADR** (konvensi repo).
- `internal/docs/**` adalah Source of Truth by convention; doc yang tersentuh diperbarui dalam commit yang sama.
- Distro yang didukung skrip saat ini: keluarga **debian/ubuntu** dan **rhel/centos/rocky/alma/opencloudos**.

**Konteks fleet.** VPS milik Nafanesia sendiri (mis. produksi hanoman di `103.59.161.119` menjalankan Caddy + Postgres dalam Docker — **bukan** aaPanel/Nginx/MySQL). Karena itu banyak item app-layer pada checklist rujukan (aaPanel, Web server, Database) akan berstatus **Not-Applicable** pada sebagian besar host, dan kerangka harus menangani N/A dengan benar agar skor tidak terdistorsi.

## Persona / pengguna

- **Ops/Dev Nafanesia (persona utama).** Anggota tim kecil (mis. akun `nafanesia`, `dena05meidina`, `amardito37`, `dev@tumbuh.ai`) yang mendaftarkan VPS, menjalankan audit/hardening, memantau skor, menandai N/A, dan meng-attest item manual. Butuh: gambaran cepat, kontrol per-item yang aman, dan jejak siapa mengubah apa. Tidak semua adalah pakar keamanan — panduan per item penting.
- **PM/PO / pemilik keamanan (persona sekunder).** Ingin memantau skor kepatuhan fleet naik dari waktu ke waktu, melihat item yang tertinggal, dan memastikan drift ditangani. Tidak menjalankan perintah shell.

Bukan persona (di luar cakupan): klien eksternal, auditor pihak ketiga, pengguna publik. Tidak ada kebutuhan laporan kepatuhan formal untuk pihak luar pada versi ini.

## Goals & non-goals

### Goals

1. Mendefinisikan **katalog kanonik 232 item / 16 seksi** di git, tiap item bermode `AUTO`/`AUDIT`/`INFO` dengan metadata lengkap (severity, cara audit, panduan remediasi, kondisi applicability).
2. **Mengaudit** status setiap item applicable per-VPS lewat skrip deterministik, dan **menghitung skor kepatuhan** per-seksi & total.
3. Menyediakan **checklist UI** yang menampilkan seluruh item + status + skor, dengan kemampuan **menandai N/A** dan **meng-attest** item manual (`INFO`) beserta jejak pelaku.
4. Memungkinkan **remediasi selektif** item `AUTO`: ops memilih item, melihat **preview dry-run** perubahan, lalu menerapkan; idempoten & anti-lockout.
5. **Mendeteksi drift**: membandingkan hasil audit terbaru dengan snapshot sebelumnya; regresi memicu Notification.
6. Menaikkan **skor kepatuhan fleet** menuju ≥90% item applicable, terukur di dashboard.
7. Mempertahankan seluruh guardrail arsitektur: skrip deterministik (ADR-0025), tanpa cron (ADR-0024), multi-distro, idempoten, anti-lockout.

### Non-goals

1. **Tanpa scheduler/cron** untuk audit latar belakang di versi ini (patuh ADR-0024). Audit dipicu manual/on-view.
2. **Tanpa rollback otomatis** konfigurasi pada v1. Keamanan dijaga lewat pengecualian item berisiko dari set `AUTO` + preview dry-run.
3. **Tanpa laporan/ekspor kepatuhan** untuk pihak ketiga (fleet internal saja).
4. **Tanpa multi-tenant/RBAC per-klien.** Semua ops Nafanesia punya akses setara seperti sekarang.
5. **Tanpa dukungan distro/OS baru** di luar keluarga debian & rhel/opencloudos yang sudah didukung.
6. **Tidak menjalankan hardening lewat sesi Claude.** Semua audit/apply tetap skrip deterministik.
7. **Tidak** mengubah port SSH, membuat user, atau tindakan lain yang berisiko lockout secara otomatis — item semacam ini tetap `AUDIT`/`INFO` (remediasi manual berpanduan).

## Scope (in / out)

### In scope

- **Katalog kanonik** 232 item / 16 seksi di git (mis. `server/src/vps/catalog.ts` atau setara), dengan skema metadata per item.
- **Model state per-VPS** di DB untuk menyimpan status item, snapshot audit, attestasi, dan tanda N/A (butuh migration + ADR).
- **Perluasan `audit.sh`** agar mengemit baris `CHECK <itemId> <pass|fail|warn|na> <detail>` untuk item ber-probe, dan **perluasan `vps-audit.ts`** untuk memetakan ke katalog + menghitung skor.
- **Perluasan `harden.sh`** (atau skrip apply selektif) untuk item `AUTO` tambahan lintas seksi core, dengan **mode preview/dry-run**.
- **Checklist UI** di `VpsScreen.tsx` (atau layar baru): daftar per-seksi, status, skor, filter, aksi attest/N/A, seleksi item AUTO + preview + apply.
- **Deteksi drift** via diff snapshot + **Notification** saat regresi.
- **Applicability**: mekanisme menandai item N/A (manual v1; auto-deteksi stack sebagai open question) sehingga dikeluarkan dari denominator skor.
- Endpoint API terkait (audit, apply-preview, apply, attest, mark-N/A, ambil skor/checklist).
- Pembaruan `internal/docs/**` yang tersentuh + ADR baru untuk model DB & (bila perlu) keputusan desain.

### Out of scope

- Cron/scheduler, worker, message queue, webhook (tetap dicabut).
- Rollback otomatis, snapshot-restore konfigurasi.
- Laporan/ekspor untuk pihak ketiga; PDF; tanda tangan digital.
- Multi-tenant, RBAC granular, kepemilikan per-klien.
- Distro di luar debian & rhel/opencloudos.
- Remediasi otomatis item berisiko-lockout (ganti port SSH, buat/hapus user, matikan service kritis) — tetap manual berpanduan.
- Integrasi vendor eksternal (SIEM, scanner berbayar) — dapat jadi PRD terpisah.

## User stories

1. **Sebagai ops**, saya mendaftarkan sebuah VPS lalu menjalankan audit, agar saya melihat skor kepatuhan awal dan item mana yang gagal.
2. **Sebagai ops**, saya melihat checklist per-seksi (SSH, Firewall, Kernel, …) dengan status tiap item, agar saya tahu prioritas perbaikan berdasarkan severity.
3. **Sebagai ops**, saya memilih beberapa item `AUTO` dan melihat **preview** perubahan yang akan diterapkan, agar saya yakin tak ada efek lockout sebelum menekan Apply.
4. **Sebagai ops**, saya menerapkan item `AUTO` terpilih, agar konfigurasi keras diterapkan tanpa harus SSH manual, dan hasilnya langsung tercermin di audit ulang.
5. **Sebagai ops**, saya meng-attest item `INFO` (mis. "backup harian terverifikasi") dengan catatan, agar item manual ikut terhitung dalam skor dan tercatat siapa yang meng-attest.
6. **Sebagai ops**, saya menandai item yang tidak relevan (mis. item aaPanel di host tanpa aaPanel) sebagai **N/A**, agar skor tidak terdistorsi oleh item yang memang tak berlaku.
7. **Sebagai ops**, ketika saya membuka layar VPS, hanoman otomatis re-audit dan menandai item yang **drift** (berubah dari pass jadi fail sejak snapshot terakhir), agar regresi cepat terlihat.
8. **Sebagai PM/PO**, saya melihat skor kepatuhan tiap VPS dan tren fleet, agar saya tahu apakah target ≥90% tercapai.
9. **Sebagai ops**, saya menjalankan re-audit kapan pun lewat tombol, agar status selalu dapat disegarkan sesuai kondisi terkini.

## Acceptance criteria (gaya EARS)

### Katalog & metadata

- **AC-1 (ubiquitous).** Sistem HARUS memuat katalog kanonik berisi seluruh 232 item terkelompok dalam 16 seksi, di mana setiap item memiliki: `id` unik & stabil, `section`, `title`, `description`, `mode` ∈ {`AUTO`,`AUDIT`,`INFO`}, `severity`, panduan remediasi, dan kondisi applicability.
- **AC-2 (ubiquitous).** Katalog HARUS menjadi sumber kebenaran di git; perubahan katalog HARUS lewat commit (bukan diedit runtime lewat DB).
- **AC-3 (unwanted).** Bila sebuah `itemId` pada hasil audit tidak dikenal di katalog, sistem HARUS mengabaikannya dengan aman dan mencatat peringatan, TIDAK boleh crash.

### Audit & skor

- **AC-4 (event-driven).** Ketika ops memicu audit sebuah VPS, sistem HARUS menjalankan skrip audit deterministik via SSH+sudo dan memetakan tiap baris `CHECK <itemId> <status>` ke item katalog.
- **AC-5 (event-driven).** Ketika audit selesai, sistem HARUS menyimpan snapshot hasil (status per item + timestamp + host state ringkas) sebagai state per-VPS di DB.
- **AC-6 (ubiquitous).** Sistem HARUS menghitung skor per-seksi dan skor total sebagai `(jumlah item pass + item attested) / (jumlah item applicable)`, di mana item N/A **dikeluarkan** dari pembilang dan penyebut.
- **AC-7 (unwanted).** Bila sebuah item tidak dapat diaudit (mis. `sshd -T` tak terbaca / bukan root), sistem HARUS menandainya `fail`/`unknown` dengan detail sebab, TIDAK boleh menganggapnya `pass`.
- **AC-8 (state-driven).** Selama sebuah VPS berada di distro yang tidak didukung, sistem HARUS menandai audit gagal dini dengan pesan jelas dan TIDAK menjalankan probe lain yang tak bermakna.

### Checklist UI & applicability

- **AC-9 (event-driven).** Ketika ops membuka layar sebuah VPS, sistem HARUS menampilkan checklist per-seksi dengan status tiap item, skor per-seksi, dan skor total.
- **AC-10 (event-driven).** Ketika ops menandai sebuah item sebagai N/A dengan alasan, sistem HARUS mengeluarkan item itu dari perhitungan skor dan mencatat pelaku serta alasannya.
- **AC-11 (event-driven).** Ketika ops meng-attest sebuah item `INFO`, sistem HARUS mencatat status attested beserta identitas pelaku, timestamp, dan catatan opsional, lalu menghitungnya sebagai terpenuhi dalam skor.
- **AC-12 (optional feature).** Di mana filter tersedia, sistem HARUS dapat memfilter checklist berdasarkan seksi, mode, status, dan severity.

### Remediasi selektif (AUTO)

- **AC-13 (event-driven).** Ketika ops memilih satu atau lebih item `AUTO` dan meminta preview, sistem HARUS menampilkan **dry-run** perubahan yang akan diterapkan **tanpa** mengubah VPS.
- **AC-14 (event-driven).** Ketika ops mengonfirmasi apply atas item `AUTO` terpilih, sistem HARUS menjalankan remediasi idempoten via skrip deterministik dan melaporkan hasil per langkah (`STEP <item> <ok|fail> <detail>`).
- **AC-15 (unwanted).** Bila sebuah langkah sshd akan diterapkan, sistem HARUS memvalidasi konfigurasi (`sshd -t`) sebelum reload dan HARUS membatalkan perubahan bila validasi gagal (anti-lockout dipertahankan).
- **AC-16 (ubiquitous).** Item yang berpotensi memutus akses atau merusak layanan (mis. ganti port SSH, buat/hapus user, matikan service kritis) HARUS berada di mode `AUDIT`/`INFO`, TIDAK boleh dapat di-apply otomatis.
- **AC-17 (event-driven).** Ketika apply selesai, sistem HARUS memicu (atau menawarkan) re-audit sehingga status item yang baru diterapkan tercermin.

### Monitoring & drift

- **AC-18 (event-driven).** Ketika ops membuka layar VPS atau menekan Re-audit, sistem HARUS menjalankan audit terbaru tanpa bergantung pada cron/scheduler.
- **AC-19 (event-driven).** Ketika audit baru selesai dan sebuah item yang sebelumnya `pass` kini `fail`, sistem HARUS menandainya sebagai **drift** dan membuat Notification.
- **AC-20 (ubiquitous).** Sistem TIDAK boleh menambahkan scheduler/cron latar belakang untuk audit pada versi ini (patuh ADR-0024).

### Guardrail & keamanan operasi

- **AC-21 (ubiquitous).** Seluruh audit dan apply HARUS dijalankan sebagai skrip deterministik via SSH+sudo, BUKAN sesi Claude.
- **AC-22 (ubiquitous).** Seluruh skrip apply HARUS idempoten: menjalankan dua kali menghasilkan state akhir sama tanpa efek samping berbahaya.
- **AC-23 (ubiquitous).** Sistem HARUS mendukung keluarga distro debian/ubuntu dan rhel/centos/rocky/alma/opencloudos untuk item yang punya probe/remediasi.
- **AC-24 (state-driven).** Selama sebuah perubahan skema DB diperlukan, perubahan itu HARUS disertai migration + ADR sebelum digunakan.

## Metrik sukses

**North-star**

- **Rata-rata skor kepatuhan fleet** naik dari baseline (skor saat audit pertama pasca-rilis) menuju **≥90%** item applicable dalam ~3–6 bulan.

**Metrik sekunder**

- **Coverage**: % VPS Nafanesia yang terdaftar di hanoman dan memiliki audit segar (mis. <7 hari).
- **Otomasi**: jumlah item `AUTO` yang diterapkan lewat hanoman (proxy berkurangnya hardening lewat SSH manual).
- **Drift**: jumlah drift terdeteksi per periode dan waktu dari terdeteksi → kembali `pass`.
- **Kelengkapan katalog**: % dari 232 item yang punya probe/panduan terisi (bukan placeholder).

**Guardrail metrics (tidak boleh memburuk)**

- **Nol insiden lockout** akibat apply otomatis.
- Idempotensi terjaga: apply berulang tidak menghasilkan perubahan tak terduga.

## Roadmap / fase implementasi

- **Fase 1 — Fondasi.** Katalog 232 item, model state per-VPS (migration + ADR), perluasan audit engine untuk seksi core, scoring per-seksi & total, checklist UI (status + skor + attest manual + tanda N/A). Memberi visibilitas & skor lebih dulu (mendukung north-star).
- **Fase 2 — Remediasi selektif.** Perluasan set `AUTO` lintas seksi core, seleksi item, preview dry-run, apply idempoten, re-audit pasca-apply.
- **Fase 3 — Monitoring proaktif & app-layer.** Deteksi drift + Notification yang lebih kaya, dan item app-layer kondisional (aaPanel, Web server, Database, SSL/TLS) dengan deteksi applicability.

## Open questions

1. **Bobot severity pada skor** — v1 memakai bobot setara per item; apakah perlu skor tertimbang berdasarkan severity (critical > high > …)? Perlu keputusan sebelum Fase 1 tuntas.
2. **Auto-deteksi applicability** — untuk item app-layer (aaPanel/Nginx/Apache/MySQL/PostgreSQL/SSL), bagaimana hanoman otomatis memutuskan applicable vs N/A (deteksi paket/port terpasang)? v1 memakai penandaan manual; heuristik deteksi jadi kandidat Fase 3.
3. **Penjadwalan proaktif** — apakah suatu saat perlu re-audit latar belakang berkala? Bila ya, butuh ADR baru yang mencabut sebagian ADR-0024; saat ini eksplisit di luar cakupan.
4. **Kepemilikan & kadensi review probe** — siapa menulis dan meninjau probe/remediasi untuk 232 item, dan seberapa sering katalog ditinjau ulang mengikuti perubahan checklist rujukan?
5. **Kebijakan kedaluwarsa attestasi & N/A** — apakah attestasi manual (`INFO`) dan tanda N/A perlu masa berlaku / re-attest berkala agar tidak "basi" dan menyesatkan skor?
6. **Rollback untuk AUTO berisiko** — bila kelak ingin mengotomasi item yang lebih berisiko, apakah perlu mekanisme snapshot-restore konfigurasi (di luar v1)?
7. **Granularitas skor fleet** — bagaimana menampilkan tren fleet (rata-rata sederhana vs tertimbang jumlah item vs per-severity) di dashboard PM?
8. **Sumber teks item** — apakah teks/urutan 232 item diambil verbatim dari checklist rujukan (yang dapat berubah) atau di-fork sebagai salinan kanonik hanoman; bagaimana sinkronisasinya bila rujukan diperbarui?
