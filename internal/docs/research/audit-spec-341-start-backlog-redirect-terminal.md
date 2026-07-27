# Audit SPEC-341 — Start sesi backlog me-redirect ke Terminal

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-27  
**Metode:** `superpowers:systematic-debugging`

## Keluhan

Setelah operator memulai sesi dari Backlog, dashboard langsung berpindah ke Terminal. Ekspektasinya:
sesi tetap dimulai, modal tertutup, toast sukses tampil, dan operator tetap berada di Backlog.

## Akar masalah

Alur semua tombol Start di Backlog (`grid`, `list`, `board`, dan detail) berakhir di
`App.startSession`, yang membuka `StartSessionModal`. Setelah `POST /terminal/sessions` sukses,
modal memanggil callback `onStarted`. Callback tunggal di `App.tsx` secara eksplisit menjalankan:

```tsx
setSection("terminal");
```

Jadi perpindahan bukan berasal dari server, routing browser, polling sesi, atau komponen Backlog;
ia adalah side effect frontend yang terpusat dan selalu terjadi pada setiap Start sukses.
`onOpenRun` tetap merupakan aksi eksplisit terpisah untuk operator yang memang ingin membuka
Terminal.

## Reproduksi

1. Buka Backlog dan tekan **Mulai** pada item mana pun.
2. Konfirmasi picker sesi.
3. `api.startSession(...)` berhasil dan mengembalikan id sesi.
4. `StartSessionModal.start()` memanggil `onStarted(id)`.
5. Callback `App` menjalankan `setSection("terminal")`, sehingga Backlog hilang dan Terminal tampil.

Jejak kode ini deterministik dan dipakai seluruh bentuk tampilan Backlog.

## Keputusan pasca-Audit

Temuan berconfidence tinggi, akar masalah jelas, dan perbaikannya satu side effect frontend tanpa
perubahan API, data model, migration, atau arsitektur. **Spec dan Plan dilewati** sesuai
ADR-0020/0040; dokumen ini menjadi doc-of-record.

## Perbaikan dan verifikasi

Hapus perpindahan section dari callback sukses Start. Pertahankan pembuatan sesi, penutupan modal,
dan toast sukses. Tambahkan regression test pada level `App`: mulai sesi dari Backlog lalu pastikan
heading Backlog tetap tampil dan Terminal tidak menjadi section aktif. Aksi **Terminal** pada item
tetap membuka Terminal secara eksplisit.

