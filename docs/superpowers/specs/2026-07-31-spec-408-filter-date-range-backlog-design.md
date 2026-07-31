# SPEC-408 · Filter date range di backlog — design

**Tanggal:** 2026-07-31
**Sumber:** brief · prioritas tinggi
**Objective:** terdapat filter date range di backlog
**Konteks brief:** "untuk mengetahui backlog dibuat dan dikerjakan per kapannya diperlukan tambahan
filter date range memudahkan filtering"

---

## 1 · Temuan yang menentukan bentuk kerja

`Spec` (backlog item) **tidak menyimpan tanggal pembuatan**. Kolomnya hanya:

```
id · projectId · title · source · stage · priority · author · objective · payload
branchFrom · baseSha · headSha · version · updatedAt
```

(`server/prisma/schema.prisma:51-67`)

Konsekuensinya, "backlog dibuat kapan" **belum pernah ada datanya** — bukan sekadar belum
ditampilkan. Dan "dikerjakan kapan" pun hanya ada sebagai kondisi **boolean turunan**
(`baseSha !== null` = pernah punya worktree, dipakai scheduler `sources/backlog.ts:15`), tanpa
stempel waktu.

`updatedAt` **bukan** pengganti yang jujur untuk keduanya: ia ikut bergerak setiap kali `version`
di-bump mesin sync (`publishLocal`, `backfillFeed` di `services/sync.ts`) dan setiap kali overlay
stage-live menulis kemajuan (`liveSpecs`). Item yang tak pernah disentuh manusia bisa tampak baru
saja diperbarui.

**Keputusan (dikonfirmasi operator):** tambah **dua kolom** dalam satu migration aditif —
`createdAt` dan `startedAt`.

## 2 · Data model

```prisma
model Spec {
  ...
  createdAt DateTime  @default(now())   // SPEC-408 · kapan item difilekan
  startedAt DateTime?                   // SPEC-408 · kapan sesi PERTAMA lahir; null = belum pernah
  updatedAt DateTime  @updatedAt
}
```

- **`createdAt`** — `@default(now())`, NOT NULL. Ditulis DB, tak pernah oleh route.
- **`startedAt`** — nullable. Ditulis **di satu titik yang sama dengan `baseSha`**:
  `services/session-launch.ts:144`, di dalam cabang `if (!resume)`. Titik itu sudah merupakan
  definisi "pekerjaan dimulai" (ADR-0030) dan jalur **resume** (ADR-0084) sengaja tidak menimpanya
  — melanjutkan sesi bukan "mulai lagi", persis seperti `baseSha` yang juga tidak ditulis ulang.
  Konsekuensi yang diterima sadar: `startedAt` = **mulai pertama**, bukan sentuhan terakhir.

### Backfill baris lama

Migration SQLite untuk kolom ber-`DEFAULT CURRENT_TIMESTAMP` **wajib** lewat redefinisi tabel —
SQLite melarang `ALTER TABLE … ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` (default non-konstan).
Redefinisi itu justru memberi tempat untuk backfill yang jujur:

| kolom | backfill baris lama | alasan |
|---|---|---|
| `createdAt` | `updatedAt` | satu-satunya jejak waktu yang ada; batas ATAS dari waktu pembuatan sebenarnya |
| `startedAt` | `updatedAt` bila `baseSha IS NOT NULL`, else `NULL` | `baseSha` adalah penanda "pernah dikerjakan" yang sudah dipakai sistem |

Backfill ini **aproksimasi, dan itu dinyatakan terbuka** di ADR: untuk baris lama kedua stempel
sama dengan `updatedAt`. Alternatif "isi dengan waktu migration dijalankan" ditolak — itu membuat
seluruh backlog lama tampak dibuat hari ini, yang lebih menyesatkan daripada terlalu-baru-sedikit.

### Sync (ADR-0045/0067)

Keduanya masuk `FIELDS.spec` **dan** `DATE_FIELDS.spec` di `services/sync.ts` — sejajar dengan
`baseSha`/`headSha` yang memang menyeberang. Tanpa itu, spec yang lahir di hub akan mendapat
`createdAt = now()` di tiap client (kolom NOT NULL ber-default) alias tanggal palsu per mesin.
`coerce()` hanya menyalin field yang **hadir** di payload, jadi push dari client versi lama tak
menimpa apa pun.

## 3 · Kontrak API

```
GET /specs?…&dateField=created|started&from=YYYY-MM-DD&to=YYYY-MM-DD
```

- `dateField` default `created`. Nilai tak dikenal diperlakukan `created`.
- `from`/`to` **inklusif**, format tanggal polos `YYYY-MM-DD` (bentuk yang dipancarkan
  `<input type="date">`). Salah satu boleh sendirian (batas terbuka).
- **Gotcha zona waktu yang wajib ditutup:** `new Date("2026-07-31")` = tengah malam **UTC**, bukan
  lokal. Dipakai apa adanya sebagai batas `to`, ia membuang hampir seluruh hari 31 Juli untuk
  operator di WIB. Jadi parsing dilakukan **komponen per komponen di zona lokal server**:
  `from` → `00:00:00.000` hari itu, `to` → `23:59:59.999` hari itu.
- String yang tak cocok pola (`/^\d{4}-\d{2}-\d{2}$/`) **diabaikan** (filter tidak aktif) — bukan
  400. Konsisten dengan `stage`/`priority`/`startable` yang juga lenient di `filterSpecs`.
- `dateField=started` + rentang aktif → item ber-`startedAt = null` **tersaring keluar** (belum
  pernah dikerjakan tak punya tanggal untuk dicocokkan).

Filter hidup di `filterSpecs()` (`routes/specs.ts`) — **setelah** overlay stage-live, sebelum
`paginate()`, persis seperti filter yang sudah ada (ADR-0038). `total` di envelope karena itu ikut
menyusut, dan Pager tetap konsisten.

`zSpec` (`shared/src/entities.ts`) menumbuhkan dua field: `createdAt: z.string()` dan
`startedAt: z.string().nullable()` — pola yang sama dengan `zProject.createdAt`.

## 4 · UI

Baris penyaring `BacklogScreen` (yang sudah memuat search · project · stage · prioritas) mendapat
**tiga kontrol**:

```
[Cari backlog…] [Semua project ▾] [Semua stage ▾] [Semua prioritas ▾]
[Dibuat ▾] [ 2026-07-01 ] → [ 2026-07-31 ]
```

- `Select` "Dibuat / Dikerjakan" (`aria-label="Filter tanggal berdasarkan"`).
- Dua `Input type="date"` (`aria-label="Tanggal dari"` / `"Tanggal sampai"`). DS `Input`
  meneruskan `...rest` ke `<input>`, jadi `type="date"` bekerja **tanpa mengubah design system**.
- State view-local (pola SPEC-178), ikut `setPage(1)` saat berubah, ikut debounce? **tidak** —
  `<input type="date">` memancarkan `change` hanya saat tanggal utuh dipilih, tidak per-ketikan.
- Tombol **"Reset filter"** di `StateBlock` kosong-karena-filter ikut mengosongkan ketiganya —
  kalau tidak, operator yang menyaring ke rentang kosong akan menekan Reset dan tetap melihat
  layar kosong.
- Selector tak ikut di-reset ke "Dibuat"? **Ikut** — Reset berarti kembali ke keadaan awal penuh.

Board view memakai fetch yang sama (tanpa `page`/`limit`), jadi filter tanggal berlaku di ketiga
mode tampilan tanpa kerja tambahan.

## 5 · Yang TIDAK dikerjakan (YAGNI)

- Preset cepat ("7 hari terakhir", "bulan ini") — ditolak operator, tambah state berlapis.
- Dua rentang terpisah (dibuat DAN dikerjakan aktif bersamaan) — ditolak operator; baris filter
  sudah padat.
- Kolom tanggal di kartu/baris backlog, sorting berdasarkan tanggal, atau rentang di layar lain
  (Overview, Errors, Tickets) — di luar objective.
- Index DB atas `createdAt`/`startedAt` — filter dieksekusi **di memori** setelah overlay
  (ADR-0038), jadi index tak akan pernah dipakai.

## 6 · Test

| lapis | berkas | yang dijaga |
|---|---|---|
| server | `server/test/specs.route.test.ts` | `from`/`to` inklusif di kedua batas; `dateField=started` membuang `startedAt=null`; tanggal ngawur diabaikan; `total` envelope ikut menyusut |
| server | `server/test/specs.route.test.ts` | `startedAt` ditulis saat sesi pertama lahir dan **tidak** ditimpa saat resume |
| server | `server/test/sync*.test.ts` | `createdAt`/`startedAt` menyeberang push/pull (round-trip snapshot) |
| web | `src/test/backlog-date-filter.test.tsx` (baru) | tiga kontrol terkirim ke `api.listSpecs`; Reset filter mengosongkannya |
| shared | typecheck | `zSpec` bertambah dua field |

## 7 · ADR

**ADR-0090 — Stempel waktu backlog: `Spec.createdAt` & `startedAt` sebagai kolom, bukan turunan.**
Keputusan yang direkam: (a) waktu pembuatan **tidak bisa** diturunkan dari data yang ada, jadi ia
kolom; (b) "dikerjakan" ditulis di titik cekik yang sama dengan `baseSha` dan bermakna **mulai
pertama**, bukan sentuhan terakhir; (c) `updatedAt` sengaja **tidak** dipakai sebagai proksi karena
mesin sync menggerakkannya; (d) baris lama di-backfill dari `updatedAt`, aproksimasi yang dinyatakan
terbuka; (e) filter tetap di layer response (ADR-0038 utuh), tanpa index baru.
