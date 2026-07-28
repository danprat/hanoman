# Audit SPEC-352 — Help desk tiket tidak masuk & submit berakhir error

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-28
**Metode:** `superpowers:systematic-debugging`

## Keluhan

Submit keluhan lewat `https://hanoman.nafanesia.id/help/crm-tumbuh-ai` "malah error", dan tiketnya
tidak pernah muncul di list triase. Terjadi di instance produksi (hanoman server).

## Bukti yang dikumpulkan

Diambil langsung dari produksi (Caddy tak mencatat akses, Fastify `logger: false`, jadi bukti diambil
dari endpoint, DB, dan browser sungguhan lewat CDP):

| Probe | Hasil |
| --- | --- |
| `GET /api/help/crm-tumbuh-ai` | 200 — project ada, `helpEnabled = true` |
| `GET /api/help/crm-tumbuh-ai/tickets/<kunci-asal>` | 404 (bukan 500) → kolom `shareToken` SPEC-293 **ada**, migration terpasang |
| POST tanpa lampiran | **201** |
| POST lampiran 67 B / 2 MB / 6,5 MB (>batas) | **201** untuk ketiganya |
| Submit dari Chrome sungguhan (form asli) | **201**, tiket #8 |
| Commit VPS vs worktree | sama (`7e68201`); `src/dist` & `server/dist` dibangun 2026-07-27 08:50 — **tak ada build basi** |
| Disk / memori VPS | 20 GB bebas, 6,6 GB available — bukan kehabisan sumber daya |
| `SyncLog` entity `ticket` | 20 baris, tiap tiket terbit ke change-feed — sisi hub sehat |
| `Notification` type `ticket` | **1:1 dengan baris `Ticket`** — tak ada notifikasi yatim |

Baris terakhir adalah kunci: bila submit gagal *setelah* `createTicket`, akan tersisa tiket (dan
notifikasinya) tanpa respons sukses. Tidak ada satu pun. Artinya pada kasus yang dikeluhkan **tiket
tak pernah lahir** — kegagalan terjadi **sebelum** `createTicket`.

Jalur sebelum `createTicket` hanya lima: 404 (`helpEnabled`), 429 (rate-limit), 400 (bukan
multipart), 400 (parse multipart), 400 (validasi zod) — dan satu lagi: **honeypot**.

## Temuan A (primer) — honeypot `hp` menelan submit pelapor asli, lalu klien merender sampah

`server/src/routes/help.ts`:

```ts
if (fields.hp) return reply.code(200).send({ ok: true }); // honeypot: bot → sukses palsu
```

`src/src/public/PublicHelpApp.tsx` mengirim field itu dari sebuah input asli di dalam form:

```tsx
<input tabIndex={-1} autoComplete="off" aria-hidden value={hp} onChange={…} name="hp"
  style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
```

Dua cacat bertumpuk:

1. **Field-nya bisa diisi autofill browser, bukan hanya bot.** Ia input teks nyata di dalam form
   (bukan `type="hidden"`, bukan `display:none`), dan pertahanannya cuma `autocomplete="off"` —
   atribut yang secara luas **diabaikan** browser untuk autofill. Lebih buruk: namanya `hp`, yang
   dalam bahasa Indonesia berarti *nomor handphone*, di atas form berbahasa Indonesia yang tepat di
   atasnya punya field **email**. Memilih email dari dropdown autofill memicu Chrome mengisi seluruh
   field profil yang dikenalinya dalam form yang sama, dan browser juga menawarkan nilai tersimpan
   berdasarkan atribut `name`. Ini kelas bug terdokumentasi: Firefox 94 mengisi field honeypot
   (Mozilla bug 1739992), Craft Express Forms #51 memblokir submit sah karena autofill Chrome, dan
   mitigasi yang dianjurkan justru **berhenti memakai `autocomplete="off"`** dan memakai nilai yang
   dihormati semua browser (`new-password`) plus nama yang tak dikenali heuristik.

2. **Respons sukses palsu berbentuk beda dari sukses asli, dan klien menelannya mentah.** Sukses
   asli `201 {number, key, statusPath}`; honeypot `200 {ok: true}`. `helpApi.submit` hanya menguji
   `r.ok`, lalu `ReportForm` membaca `r.number` dan `r.statusPath` yang tak ada.

### Reproduksi (dijalankan di produksi, tanpa membuat tiket)

Isi form seperti pelapor biasa, lalu isi `input[name=hp]` dengan `0812-3456-7890` — persis yang
dilakukan autofill "nomor HP" — dan submit. Yang tampil di layar:

```
TERKIRIM
Terima kasih — tiket #undefined
Keluhan Anda sudah kami terima. Simpan link berikut untuk memantau statusnya:
https://hanoman.nafanesia.idundefined
```

Server membalas `200`. Tak ada tiket, tak ada notifikasi, tak ada baris feed. Tautan "Buka status"
menuju `https://hanoman.nafanesia.idundefined` — bahkan tanpa garis miring, karena `statusPath`
`undefined` dirangkai langsung ke origin — dan membukanya memberi halaman **"Halaman tidak ditemukan
— Link Help Center tidak valid."**

Itu tepat kedua gejala pada judul backlog: tiket **tidak masuk**, lalu **error**.

3. **Kegagalannya tak teramati sama sekali.** Honeypot menjawab 200 tanpa log, tanpa penghitung,
   tanpa baris DB. Inilah sebabnya lima hari senyap (tiket asli terakhir 2026-07-23 09:34) tak
   meninggalkan satu pun jejak untuk didiagnosis — bukan karena tak ada yang melapor.

## Temuan B (sekunder) — rate-limit menguras bucket project meski IP sudah ditolak

`server/src/services/help-ratelimit.ts`:

```ts
const okIp = take(ipBuckets, ip, ipCap, now);
const okProj = take(projBuckets, projectId, projCap, now);
return okIp && okProj;
```

Kedua `take` **selalu** dijalankan, jadi setiap percobaan yang sudah pasti ditolak karena jatah IP
habis tetap memakan satu token dari bucket **per-project** yang dipakai bersama semua pelapor lain.
Satu IP yang membanjir (bot pemindai halaman publik) menghabiskan 5 token IP-nya, lalu terus
menguras 20 token/menit milik project — sehingga **pelapor sah dari IP lain ikut kena 429**.
Amplifikasi ini juga tak teramati (429 tak dicatat). Sejalan dengan gejala "submit malah error",
walau bukan penyebab utama kasus yang direproduksi.

`error-ingest.ts` yang dicerminkan dokumen ADR-0062 hanya punya satu bucket, jadi bug ini khas
`help-ratelimit.ts`.

## Yang sudah dieliminasi

Migration/skema (kolom `shareToken` ada), build basi, `helpEnabled` terpelanting (hanya diubah
endpoint enable/disable khusus — tak ada jalur PATCH yang bisa mengklobernya), 500 sesudah
`createTicket`, batas ukuran body/`bodyLimit`, parsing multipart, enum kategori, feed sync, filter
list triase, dan regresi kode terbaru (jalur ini tak berubah sejak 2026-07-22).

## Keputusan pasca-Audit

Temuan berconfidence tinggi dengan akar masalah jelas dan perbaikan berdiff kecil: nama & atribut
satu input, satu pemeriksaan bentuk respons di klien, satu short-circuit rate-limit, plus satu baris
observabilitas. Tanpa perubahan data model, migration, kontrak API publik, maupun arsitektur.
**Spec dan Plan dilewati** sesuai ADR-0020/0040; dokumen ini menjadi doc-of-record.

Keputusan ADR-0062 tidak dibalik: honeypot tetap ada dan tetap menjawab sukses palsu. Yang berubah
hanya agar manusia tak lagi bisa tersangkut di dalamnya.

## Perbaikan (defense in depth, empat lapis)

1. **Cegah pelapor sah tersangkut (akar masalah).** Ganti nama field honeypot `hp` → `hc_trap`
   (tak punya makna bagi heuristik autofill mana pun, dan bukan kata Indonesia) serta
   `autoComplete="new-password"` yang dihormati semua browser. `tabIndex={-1}` + `aria-hidden`
   dipertahankan. Server **berhenti** memperlakukan `hp` sebagai honeypot, sehingga tab lama yang
   masih memegang bundle basi pun lolos alih-alih tertelan.
2. **Klien tak pernah merender sukses tanpa isi.** `helpApi.submit` memvalidasi bentuk respons
   (`number` + `statusPath`); bila tak sesuai → error jelas, bukan `#undefined` dan tautan rusak.
3. **Honeypot jadi teramati.** Satu `console.warn` ber-slug + IP saat honeypot menyala, supaya
   false positive berikutnya meninggalkan jejak di journald.
4. **Rate-limit tak bisa diamplifikasi.** Short-circuit `&&` agar IP yang sudah kehabisan jatah tak
   ikut menguras bucket project bersama.

## Verifikasi

Test unit untuk tiap lapis (server: honeypot nama baru, `hp` kini tiket normal, short-circuit
rate-limit; klien: respons tak berbentuk → error, bukan `#undefined`), lalu boot server lokal dan
`curl` endpoint yang tersentuh, ditutup smoke browser CDP terhadap halaman publik.
