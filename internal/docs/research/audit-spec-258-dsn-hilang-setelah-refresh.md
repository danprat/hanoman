# Audit SPEC-258 — DSN sudah di-generate lalu "hilang" setelah refresh

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major
**Doc-of-record** perbaikan ini (Spec & Plan di-*skip*: temuan berconfidence tinggi, akar
masalah jelas, diff kecil & terisolasi di frontend — keputusan pasca-audit qa, ADR-0020/0040).

## Gejala (laporan user)

> Saat generate token untuk DSN SDK project, selesai generate dapat link-nya. Ketika di-refresh
> malah "belum terbuat" — ambigu. Ekspektasi: setelah generate lalu refresh, statusnya jadi
> **"sudah terintegrasi"** (DSN aktif), bukan kembali ke tombol *Generate*.

## Investigasi (systematic-debugging — Phase 1 Root Cause)

### Sisi server: BENAR (bukan akar masalah)

- `POST /projects/:id/ingest-key` (`server/src/routes/projects.ts:119`) mem-*persist*
  `ingestKeyHash` + `ingestKeyPrefix` ke DB, lalu balas `{ enabled, prefix, key, dsnUrl }`.
- `toProjectView` (`server/src/services/project-view.ts:53`) menurunkan
  `monitoringEnabled: !!p.ingestKeyHash` dari baris `Project` penuh (`GET /projects` memakai
  `findMany` tanpa `select` → kolom hash tersedia).
- **Bukti hijau yang sudah ada:** `server/test/projects-ingest-key.route.test.ts:26-27` meng-*assert*
  `GET /api/projects/p1` mengembalikan `monitoringEnabled: true` **setelah** POST. Jadi status
  yang di-*persist* memang sampai lewat API. Server konsisten.
- Sync (`server/src/services/sync.ts`) sengaja **mengecualikan** `ingestKeyHash/Prefix` dari
  whitelist `FIELDS.project`; `coerce()` hanya menulis field whitelist, jadi `upsertLocal`/`applyPush`
  dari hub **tidak pernah** menghapus hash lokal (Prisma `update` hanya menyentuh field yang diberikan).
  Sync bukan penyebab.

### Sisi frontend: AKAR MASALAH

State sumber-kebenaran project di `src/src/App.tsx` (`projects`) **hanya** dimuat oleh `load()`
saat login (App.tsx:434). Langganan WebSocket (App.tsx:449-452) hanya memutakhirkan `backlog`
(specs) & `sessions` — **tidak pernah** `projects`. Tidak ada refetch project setelah mutasi DSN.

`DsnCard` (`src/src/screens/ProjectDetailScreen.tsx:14`) meng-init state dari prop **sekali** saja:

```ts
const [enabled, setEnabled] = React.useState(p.monitoringEnabled); // init-only
```

Alur bug:
1. User klik *Generate DSN* → `rotate()` → `setEnabled(true)` **lokal** + tampil link. Terlihat aktif. ✓
2. Mutasi ini **tidak dirambatkan** ke state `projects` App → `proj.monitoringEnabled` tetap `false`.
3. Saat `ProjectDetailScreen` **re-mount** (pindah section lalu balik; app **tak punya routing URL**
   sehingga F5 keras justru mendaratkan user di section default), `DsnCard` init ulang
   `useState(p.monitoringEnabled)` dari prop **basi** (`false`) → tampil *"belum ada DSN"* + tombol
   *Generate*. Inilah "hilang setelah refresh" yang ambigu.

State lokal kartu bersifat *ephemeral*; kebenaran yang di-*persist* di server tak pernah ditarik
kembali ke state App sampai `load()` penuh berikutnya.

### Cacat kembar

`HelpCenterCard` (`ProjectDetailScreen.tsx:77`) memakai pola identik
(`useState(p.helpEnabled)`, tanpa rambat ke atas) → laten bug yang sama. Diperbaiki oleh mekanisme
callback yang sama (lihat di bawah).

## Perbaikan (Phase 4 — akar, bukan gejala)

Cermin pola yang sudah ada di `updateProject` (App.tsx:502-504: `api.getProject` → `setProjects`):
rambatkan mutasi in-card ke state sumber-kebenaran App agar status **persist** saat re-mount/refresh.

1. `App.tsx`: tambah `refreshProject(id)` — `api.getProject(id)` lalu `setProjects` (ganti VM basi
   dengan yang segar). Oper sebagai prop `onProjectChanged` ke `ProjectDetailScreen`.
2. `ProjectDetailScreen.tsx`: terima `onProjectChanged?`, teruskan ke `DsnCard` **dan**
   `HelpCenterCard`; panggil `await onProjectChanged?.(p.id)` sesudah generate/rotate/revoke
   (DSN) & enable/disable (Help) yang sukses.

Tidak ada perubahan skema, kontrak API, maupun perilaku server. Diff terbatas di dua file frontend.

## Verifikasi

- Test frontend (TDD) `src/test/project-dsn.test.tsx`: reproduksi gejala — generate lalu *re-mount*
  layar; tanpa perbaikan tetap *Generate DSN* (basi), dengan perbaikan jadi *Rotate/Revoke* + prefix.
- Test server yang sudah ada (`projects-ingest-key.route.test.ts`) tetap hijau — kontrak server tak
  berubah.
