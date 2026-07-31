# ADR-0092 — Cabut error monitoring, `hanoman-sdk`, dan cross-audit (pemantauan pindah ke Uptrace)

**Status:** accepted · **Tanggal:** 2026-07-31 · **Spec:** SPEC-384
**Mencabut:** ADR-0060 (error monitoring: model + ingest ber-DSN) · ADR-0063 (`hanoman-sdk` sebagai
npm package publik) · ADR-0070 (symbolication source-map server-side) · ADR-0075 (audit lintas
project: `ProjectLink` + kunci log ber-scope sesi). **Berkas keempat ADR itu dihapus**, bukan
ditandai — lihat "Penyimpangan konvensi" di bawah.
**Mengamandemen:** [ADR-0066](0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md) — bagian
`errorGroup` dicabut; keputusan tiket & pemicu sync manual tetap berlaku.
**Terkait:** [ADR-0062](0062-help-center-tiket-publik-triase.md) (Help Center — **tidak** tersentuh,
tapi kehilangan ADR-0060 sebagai preseden yang dirujuknya) ·
[ADR-0064](0064-project-id-renameable.md) (rename id — permukaan DSN yang di-embed-nya hilang) ·
[ADR-0065](0065-ai-agent-capability-agent-token.md) (capability `support:*` bertahan untuk tiket) ·
[ADR-0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md) (source `errors` hilang; `backlog`
& `triase` utuh) · [ADR-0076](0076-eskalasi-audit-dinamis-manifest-rekomendasi.md) (eskalasi audit —
tetap berlaku untuk flow `audit` satu project) ·
[ADR-0087](0087-distribusi-npm-global-satu-perintah.md) (pola paket npm publik yang dipinjam 0063)

## Konteks

Pemantauan error produksi nafanesia.id sudah pindah ke **Uptrace** (terpasang di VPS,
`https://uptrace.nafanesia.id`). Sejak itu jalur error milik hanoman sendiri tak lagi menerima satu
pun kejadian nyata, tetapi tetap hidup penuh di kode, skema, API, dashboard, dan docs:

| Permukaan | Isi |
|---|---|
| Paket npm | `hanoman-sdk` (Node + browser, DSN gaya Sentry) |
| Endpoint publik | `POST /api/ingest/:slug`, `POST /api/ingest/:slug/sourcemaps` |
| Endpoint gate-cookie | `GET/PATCH/DELETE /api/errors*`, `/api/projects/:id/ingest-key` |
| Model DB | `ErrorGroup`, `ErrorEvent`, `SourceMapArtifact` |
| Layar | area Errors, kartu DSN, modal panduan integrasi |
| Scheduler | source `errors` (checker + ambang `minCount`) |

Dua sumber kebenaran untuk hal yang sama adalah ambiguitas: seorang operator yang membuka dashboard
melihat area Errors yang kosong dan tak punya cara tahu apakah itu berarti "tak ada error" atau
"pemantauannya di tempat lain". Yang mati harus dicabut, bukan dibiarkan sebagai kode mati.

## Keputusan

Tiga blok dicabut utuh — SDK, error monitoring, dan cross-audit — beserta tabel, kolom, endpoint,
layar, prompt, dan docs-nya. Tak ada endpoint yang disisakan mengembalikan data kosong; tak ada tabel
yang ditinggal tanpa model.

### Kenapa cross-audit ikut

`GET /api/audit/logs` (SPEC-337) **hanya** membaca `ErrorEvent`/`ErrorGroup`, dan seluruh mekanisme
kunci `hnm_xa_…` — tmux option → `auditSessionScope()` → pengecualian gate di `app.ts` — ada semata
untuk menggerbangi permukaan itu. Tanpa data error, flow `cross-audit` kehilangan justru hal yang
membedakannya dari flow `audit` biasa: "timeline error gabungan lintas project". Yang tersisa
hanyalah membaca kode & docs project tetangga, yang tak butuh model DB (`ProjectLink`), flow
tersendiri, kartu Integrasi, kunci ber-scope, maupun prompt 90 baris.

Menyisakannya berarti menyisakan flow, model, layar, dan prompt yang tak punya sumber data — persis
ambiguitas yang ADR ini cabut. Keputusan diambil manusia secara eksplisit saat SPEC-384 dibrainstorm.

### Penyimpangan konvensi: ADR dihapus, bukan ditandai

`internal/docs/README.md` menyatakan "Nomor unik & imutable. ADR usang tidak dihapus — ditandai
statusnya." ADR-0060/0063/0070/0075 **dihapus berkasnya** atas perintah manusia yang eksplisit, dengan
alasan yang sama dengan pencabutan itu sendiri: dokumen yang menjelaskan cara kerja fitur yang tak ada
lagi adalah ambiguitas, bukan sejarah yang berguna. Nomornya tetap **tidak** dipakai ulang.

**Satu pengecualian yang tidak diikuti:** ADR-0066 memuat **dua** keputusan — `errorGroup` masuk
record-sync *dan* `Ticket` masuk record-sync + pemicu sync manual. Yang kedua masih berlaku sepenuhnya.
Menghapusnya bulat-bulat akan menghilangkan catatan keputusan yang hidup, jadi 0066 **ditulis ulang**
tanpa bagian errors.

## Konsekuensi

- **Data error produksi hilang permanen.** Migration `20260731180000_drop_errors_sdk_crossaudit`
  menjatuhkan `ErrorEvent`, `SourceMapArtifact`, `ErrorGroup`, `ProjectLink`, dan kolom
  `Project.ingestKeyHash`/`ingestKeyPrefix`. VPS adalah hub produksi dengan data nyata; ini
  destruktif dan tak bisa dibatalkan. Diputuskan eksplisit karena sumbernya sudah di Uptrace.
- **Klien sync versi lama** yang masih mendorong record `errorGroup` ditolak `isEntity()` sebagai
  kind tak dikenal — perilaku yang benar, bukan kegagalan.
- **`Spec` bersumber `cross-audit` dinormalkan ke `audit`**, tidak dihapus: backlog item-nya
  pekerjaan nyata dengan branch & dokumen; yang hilang cuma label asalnya.
- **Baris ber-nilai enum yang dicabut dibereskan di migration yang sama** — `Notification` bertipe
  `error` dihapus, jejak feed `errorGroup` dihapus, item antrean scheduler ber-source `errors`
  dihapus. Dibiarkan hidup, baris-baris itu akan menggagalkan pembacaan daftar dengan galat parse
  zod, bukan dengan pesan yang berguna.
- **Capability `support:*` bertahan**, cakupannya menyempit jadi tiket Help Center saja.
- **`hanoman-sdk` masih terbit di npm.** Menghapus `sdk/` dari repo tidak mencabutnya dari registry;
  prosedur pencabutannya (unpublish → deprecate) ada di
  [operations/release-npm.md](../operations/release-npm.md) dan merupakan **tindakan manusia** (akun
  ber-2FA).

## Gotcha yang wajib tercatat

**Byte source-map berbagi direktori dengan lampiran tiket.** `sourcemap-store.ts` menulis ke
`uploadDir()` yang sama dengan `TicketAttachment`, dengan nama opaque `<uuid>.map`. Menghapus
direktorinya untuk "membersihkan source-map" akan ikut menghapus lampiran tiket yang masih hidup.
Pembersihan byte karena itu **harus** memakai daftar `storageKey` yang dibaca dari
`SourceMapArtifact` **sebelum** tabelnya di-drop — sesudah migration, daftar itu tak bisa direkonstruksi
dari apa pun. Migration SQL tak bisa menyentuh filesystem, jadi langkah ini ditulis sebagai runbook di
[operations/production.md](../operations/production.md). Melewatkannya hanya menyisakan byte inert.

**Pengecualian gate yatim tak bisa diamati dari luar.** `setNotFoundHandler` terpasang di app root,
sementara hook `onRequest` gate hidup di scope `/api`; untuk path tanpa route, Fastify menjawab dari
handler root dan hook ber-scope itu tak pernah berjalan. Artinya prefix bypass yang tertinggal di
`app.ts` menghasilkan 404 yang **identik** dengan keadaan yang benar. Penjaga sesungguhnya adalah
ketiadaan route-nya, bukan test terhadap gate — dicatat di `server/test/errors-gone.route.test.ts`.

## Alternatif yang ditolak

- **Menyisakan endpoint yang mengembalikan data kosong.** Kode mati yang tampak hidup; operator tetap
  tak bisa membedakan "tak ada error" dari "pemantauan pindah".
- **Mencabut kode tapi meninggalkan tabelnya.** Skema Prisma dan berkas DB jadi tak cocok; `migrate`
  berikutnya melaporkan drift yang tak ada yang berani sentuh.
- **Mencabut hanya permukaan log cross-audit, menyisakan flow-nya.** Ditimbang dan ditolak manusia:
  flow tanpa sumbu error tak lagi berbeda dari `audit`, jadi yang tersisa adalah duplikat berbiaya
  satu model DB, satu kartu UI, dan satu prompt.
- **Menandai ADR sebagai superseded, bukan menghapusnya.** Konvensi repo, dilanggar atas perintah
  eksplisit — lihat di atas.
