# Audit SPEC-286 — Eskalasi triase ke backlog tidak mengecek attachment

## Keluhan (sumber: qa, prioritas tinggi, severity major)
- **actual:** "saat ini eskalasi feedback dari triase ke backlog tidak ada pengecekan ke
  attachment sehingga ai agent tidak tahu context yang harus dibuat"
- **expected:** "saat eskalasi triase ke backlog harusnya di backlog suruh AI agent untuk
  mengecek attachment-nya juga sehingga context feedback yang diberikan oleh user clear"

## Root cause (Phase 1–2 — systematic-debugging)
Alur data yang ditelusuri:

1. Tiket Help Center (triase) di-**accept** (`server/src/routes/tickets.ts` `POST /tickets/:id/accept`)
   → membuat `Spec` (source `help`). Lampiran hanya dirujuk sebagai **hitungan pasif**:
   `Lampiran: ${nAtt} berkas (lihat tiket di triase).` — dan endpoint cuma meng-`include`
   `_count`, jadi nama/tipe/isi lampiran tak pernah dilihat.
2. `spec.payload` mengalir **apa adanya** ke prompt sesi agen lewat runner
   (`runner/src/prompt.ts` `startPrompt` → `Detail: ${JSON.stringify(spec.payload)}`).
3. Maka agen backlog hasil eskalasi hanya melihat *"N berkas, lihat tiket di triase"* — sebuah
   catatan pasif **tanpa nama berkas, tanpa jalur akses, tanpa direktif untuk benar-benar
   membukanya**. Saat `N = 0` malah jadi noise (`Lampiran: 0 berkas`).

**Akar masalah:** payload eskalasi tak pernah mengubah lampiran jadi instruksi yang bisa
ditindaklanjuti, sehingga agen tak punya alasan maupun cara membuka screenshot pelapor — persis
konteks yang hilang yang dikeluhkan. Fakta pendukung: lampiran **selalu gambar** (`help.ts`
`OK_MIME` = png/jpeg/webp), tersimpan di `uploadDir()/<storageKey>` (`services/uploads.ts`),
dan sesi agen berjalan **lokal di host yang sama** → bisa `Read` berkasnya langsung bila diberi
tahu lokasinya. Jalur eskalasi Errors (`errors.ts`) TIDAK terdampak: grup error tak punya lampiran.

Bukan bug logika — **direktif periksa lampiran memang belum ada**. Confidence tinggi, diff kecil,
akar jelas → **Spec & Plan di-skip** (jalur cepat qa, ADR-0040); dokumen ini jadi doc-of-record.

## Perbaikan (diff kecil, server-only)
`server/src/routes/tickets.ts` `POST /tickets/:id/accept`:
1. `include: { attachments: true }` (ganti `_count`) agar nama/tipe/storageKey tersedia.
2. Helper `attachmentInstruction(t, atts)` membangun `payload.context`:
   - **Berlampiran** → blok DIREKTIF aktif: `LAMPIRAN (N) … PERIKSA setiap lampiran … sebelum
     bekerja; jangan berasumsi dari teks saja`, diikuti daftar `- <filename> (<mime>) →
     <uploadDir>/<storageKey>` (agen baca langsung dengan tool Read), plus cadangan: buka lewat
     triase tiket #N atau `GET /api/tickets/:id/attachments/<id>` (bila sesi jalan di mesin lain).
   - **Tanpa lampiran** → `Tanpa lampiran.` (menghapus noise `0 berkas`).
3. Backlink dipertahankan (`Dari tiket Help Center #N …`), jadi tautan konteks tetap.

Tanpa perubahan skema, tanpa ADR baru (perluasan perilaku eskalasi ADR-0062, tak mengubah kontrak).

## Verifikasi
- **Test** (`server/test/tickets.test.ts`, SPEC-286): accept berlampiran → context memuat
  direktif `PERIKSA` + nama asli + storageKey path + rujukan API; accept tanpa lampiran →
  `Tanpa lampiran` dan tak ada pola `\d+ berkas`. Ditulis RED dulu (gagal atas payload lama),
  lalu GREEN. Suite server penuh: **793 test hijau, 0 regresi**.
- **Boot server lokal + curl nyata** `POST /api/tickets/:id/accept` (requireAuth:false, DB &
  upload dir throwaway): (a) tiket berlampiran mengembalikan context berisi direktif + path
  `uploads/<uuid>.png`; (b) tiket tanpa lampiran mengembalikan `Tanpa lampiran.` — sesuai harapan.
