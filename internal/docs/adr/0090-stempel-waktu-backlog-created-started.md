# ADR-0090 — Stempel waktu backlog: `Spec.createdAt` & `startedAt` sebagai kolom, bukan turunan

- Status: Accepted
- Tanggal: 2026-07-31
- SPEC: SPEC-408 (filter date range di backlog)
- Terkait: **memperluas [0038](0038-paginasi-di-response-layer.md)** — satu filter lagi di layer
  response yang sama, tak ada yang pindah ke query DB; mencerminkan
  [0030](0030-spec-menyimpan-base-head-sha.md) & [0084](0084-melanjutkan-sesi-backlog.md) (titik
  tulis dan semantik "mulai pertama" diambil persis dari `baseSha`); menyentuh
  [0045](0045-skema-sync-synclog-version-stamp.md) (dua kolom masuk whitelist field) dan
  [0067](0067-sync-lww-reconciliation-manual.md) (`updatedAt` tetap jam LWW, dan justru karena itu
  ia bukan stempel yang dicari); **tidak** menyentuh
  [0018](0018-coverage-nilai-turunan.md) — di sini yang benar justru kebalikannya, lihat Keputusan 1.

## Konteks

Operator meminta filter rentang tanggal di backlog "untuk mengetahui backlog dibuat dan dikerjakan
per kapannya". Permintaan itu tampak seperti pekerjaan UI. Ia bukan: **datanya tidak pernah ada.**

`Spec` — model backlog item — hanya menyimpan `updatedAt`. Tidak ada `createdAt`. Dan "dikerjakan"
sama sekali bukan tanggal: ia kondisi **boolean turunan**, `baseSha !== null`, yang dipakai
scheduler (`services/scheduler/sources/backlog.ts`) untuk memilih item "belum-mulai". Backlog bisa
menjawab *apakah* sebuah item pernah dikerjakan, tak pernah *kapan*.

Satu-satunya kandidat yang sudah ada, `updatedAt`, menggoda karena gratis. Ia juga salah.

## Keputusan

**1. Waktu pembuatan jadi KOLOM, bukan nilai turunan.** `Spec.createdAt`, `DateTime`, NOT NULL,
`@default(now())`. Ditulis DB dan **tak pernah oleh route** — tak ada jalur API yang menerimanya
sebagai input, sehingga "kapan item ini difilekan" adalah fakta yang tak bisa diedit operator.

Ini sengaja **berlawanan arah** dengan ADR-0018 (coverage diturunkan saat dibaca) dan ADR-0019 (SHA
disimpan, diff diturunkan). Aturannya konsisten kalau dibaca lewat pertanyaan yang benar: *apakah
nilainya bisa dihitung ulang dari sumber lain?* Coverage bisa (filesystem), diff bisa (git). Waktu
sebuah baris DB lahir **tidak bisa** — tak ada apa pun di sistem yang menyimpannya. Nilai yang tak
punya sumber turunan harus dipersist, kalau tidak ia hilang selamanya begitu detiknya lewat.

**2. `startedAt` ditulis di titik cekik yang sama dengan `baseSha`, dan berarti MULAI PERTAMA.**
`Spec.startedAt`, `DateTime?`. Satu-satunya penulisnya adalah `services/session-launch.ts`, di
dalam cabang `if (!resume)` yang sudah menulis `baseSha`:

```ts
if (!resume) await prisma.spec.update({
  where: { id: spec.id }, data: { baseSha, headSha: null, startedAt: new Date() },
});
```

Menaruhnya di sana bukan kebetulan hemat. `baseSha` **sudah** merupakan definisi operasional
"pekerjaan dimulai" di seluruh sistem, dan ADR-0084 sudah memutuskan bahwa **melanjutkan sesi
bukan memulai ulang** — karena itu jalur resume sengaja tak menulis ulang `baseSha`. Stempel waktu
yang berbagi titik tulis itu mewarisi keputusan tersebut secara gratis dan tak bisa drift darinya.
Konsekuensi yang diterima sadar: `startedAt` menjawab "kapan item ini **mulai** dikerjakan", bukan
"kapan terakhir disentuh". Untuk pertanyaan yang diajukan operator — "dikerjakan per kapannya" —
itu justru jawaban yang diinginkan; item yang dikerjakan berhari-hari tak boleh berpindah bucket
tanggal setiap kali sesinya dibuka lagi.

`null` berarti belum pernah dikerjakan, dan itu **bukan** nilai yang layak difilter: lihat
Keputusan 5.

**3. `updatedAt` DITOLAK sebagai proksi keduanya.** Ia bergerak tanpa ada manusia yang menyentuh
item:

- mesin sync mem-bump `version` lewat `publishLocal()` dan `backfillFeed()` (ADR-0045/0067) —
  `@updatedAt` ikut bergerak di setiap publish;
- overlay stage-live menulis kemajuan fase lewat CAS di `liveSpecs()` setiap kali `GET /specs`
  dibaca sementara sesinya berjalan.

Artinya sebuah item yang tak pernah dibuka bisa tampak "baru saja diperbarui" hanya karena hub
mem-backfill feed-nya. Filter yang dibangun di atas itu akan berbohong dengan tenang — kelas
kesalahan yang paling mahal, karena tak ada yang gagal, hanya jawabannya yang salah.

**4. Baris lama di-backfill dari `updatedAt` — aproksimasi yang dinyatakan terbuka.** Migration
mengisi `createdAt = updatedAt` untuk seluruh baris yang sudah ada, dan `startedAt = updatedAt`
hanya bila `baseSha IS NOT NULL`. Untuk 253 baris yang ada saat migration dijalankan, kedua stempel
karena itu **identik dengan `updatedAt`** — batas ATAS dari waktu yang sebenarnya, bukan waktu yang
sebenarnya.

Alternatif "isi dengan waktu migration dijalankan" ditolak: ia membuat seluruh backlog historis
tampak dibuat hari ini, yaitu satu-satunya jawaban yang dijamin salah untuk **setiap** baris.
Aproksimasi yang terlalu-baru-sedikit lebih baik daripada kebohongan yang seragam.

**5. `dateField=started` membuang item ber-`startedAt` null.** Item yang belum pernah dikerjakan
tak punya tanggal untuk dicocokkan, jadi ia tidak bisa berada "di dalam" rentang tanggal mana pun.
Meloloskannya akan membuat filter "dikerjakan bulan Juli" mengembalikan item yang tak pernah
dikerjakan sama sekali. Untuk mencari item belum-mulai sudah ada jalannya sendiri (`startable`).

**6. Penyaringan tetap di layer response; tanpa index baru.** `filterSpecs()` di `routes/specs.ts`,
**setelah** overlay stage-live dan sebelum `paginate()` — persis seperti `q`/`stage`/`priority`/
`startable` (ADR-0038 utuh). Karena filter tak pernah menyentuh query planner, index atas
`createdAt`/`startedAt` tak akan pernah dipakai dan tak dibuat. Logika tanggalnya sendiri hidup di
modul murni `services/date-range.ts` (`dayStart`/`dayEnd`/`inDayRange`) — nol dependensi, nol I/O,
diuji tanpa menyentuh Prisma.

**7. Kedua kolom menyeberang record-sync.** Ditambahkan ke `FIELDS.spec` **dan** `DATE_FIELDS.spec`
di `services/sync.ts`, sejajar `baseSha`/`headSha`. Lihat gotcha (iii).

## Gotcha wajib

**(i) SQLite melarang `ALTER TABLE … ADD COLUMN … DEFAULT CURRENT_TIMESTAMP.`** Default non-konstan
tidak sah di `ADD COLUMN`, jadi kolom ber-default waktu **harus** lewat redefinisi tabel
(`CREATE TABLE new_Spec` → `INSERT … SELECT` → `DROP` → `RENAME`). Ini bukan sekadar hambatan: klausa
`SELECT`-nya adalah satu-satunya tempat backfill Keputusan 4 bisa terjadi dalam satu langkah, jadi
migration-nya ditulis tangan alih-alih dibiarkan `migrate dev` yang akan menghasilkan `NULL` polos.

**(ii) `new Date("2026-07-31")` adalah tengah malam UTC, bukan lokal.** Dipakai apa adanya sebagai
batas `to`, ia membuang hampir seluruh hari 31 Juli untuk operator di WIB (UTC+7) — filter yang
"jalan" tapi kehilangan sehari penuh di ujungnya, tanpa error apa pun. Karena operator memilih
tanggal di kalendernya sendiri, `dayStart`/`dayEnd` mem-parse **komponen per komponen** di zona
lokal (`from` → 00:00:00.000, `to` → 23:59:59.999). Konstruktor komponen juga **menggulir** input
di luar jangkauan (`new Date(2026, 12, 1)` → Januari 2027), jadi hasilnya diuji balik terhadap
input: `2026-02-30` menjadi `null` (filter mati), bukan diam-diam 2 Maret.

**(iii) Tanpa `FIELDS.spec`, spec asal-hub mendapat `createdAt` lokal palsu di tiap client.** Kolom
NOT NULL ber-default artinya `upsert` yang tidak menyebutkannya **tetap berhasil** — dengan
`now()` mesin penerima. Tak ada yang gagal; tanggal pembuatan sekadar berbeda di setiap mesin.
Karena itu keduanya masuk `FIELDS.spec` (agar disalin) **dan** `DATE_FIELDS.spec` (agar ISO string
di wire dikonversi balik ke `Date` sebelum ditulis Prisma). `coerce()` hanya menyalin field yang
**hadir** di payload, jadi push dari client versi lama tetap aman: ia tak menimpa apa pun.

## Konsekuensi

- Satu migration aditif (`20260731000000_spec_created_started_at`), tanpa perubahan bentuk data lain.
- `zSpec` bertambah `createdAt: string` & `startedAt: string | null` (ISO di wire); `SpecListParams`
  bertambah `dateField`/`from`/`to`. Object literal ber-tipe `Spec` yang tak lengkap jadi error
  typecheck — disengaja, itulah gunanya kontrak.
- `GET /specs?dateField=created|started&from=&to=` — inklusif, boleh sendirian, string bukan-tanggal
  **diabaikan** (filter mati) alih-alih 400, konsisten dengan filter tetangganya. `total` di
  envelope ikut menyusut karena filternya sebidang dengan yang lain.
- Item pra-migration menampilkan tanggal aproksimasi **selamanya** — tak ada jalan memulihkan yang
  sebenarnya, dan tak akan pernah ada.
- Tak ada endpoint baru, tak ada knob `Setting` baru, tak ada perubahan design system (DS `Input`
  sudah meneruskan `type="date"` ke `<input>`).
