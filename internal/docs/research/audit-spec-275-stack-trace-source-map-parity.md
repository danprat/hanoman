# Audit SPEC-275 — Stack trace error tak mencerminkan source code (parity source-map ala Sentry)

> Audit-only (ADR-0057): dokumen investigasi, **tanpa perbaikan kode**. Nomor doc **275** =
> backlog id; branch push `hanoman/spec-275`. Tak ada tabrakan nomor (`audit-spec-275-*` bebas,
> tertinggi sebelumnya 271). Tak butuh ADR baru (tak ada perubahan skema/kontrak di audit ini).

## Keluhan / pertanyaan (sumber: audit · prioritas tinggi)
- **context:** "catch errors yang sudah bekerja & jalan di system CRM, tapi masalahnya **stack
  trace-nya kemungkinan tidak mencerminkan error yang terjadi pada source code**. Ini
  bertentangan dengan yang dilakukan Sentry. Cek **parity** yang bisa diisi gap-nya sehingga
  error menjadi lebih jelas & mudah di-solve."
- **outcome / constraints:** (kosong)

Terjemahan teknis: fitur error monitoring (SPEC-249/254 · ADR-0060/0063, npm `hanoman-sdk`)
**menerima & mengelompokkan error dengan benar**, tetapi stack yang disimpan & ditampilkan adalah
stack **runtime apa adanya**. Untuk build produksi (terutama bundle browser CRM: minified +
content-hash), stack itu menunjuk ke file/posisi **hasil build**, bukan `.ts/.tsx` sumber — persis
yang Sentry hindari lewat **symbolication source-map**.

## Root cause (Phase 1 — systematic-debugging)

Stack ditangkap, dikirim, disimpan, dan ditampilkan **mentah** di setiap lapis — nol transformasi
ke posisi sumber. Jejak data end-to-end:

| Lapis | Berkas · baris | Perlakuan stack |
|---|---|---|
| Capture SDK | `sdk/src/core.ts:27-38` (`captureError`) | baca `e.stack` apa adanya, kirim verbatim |
| Handler browser | `sdk/src/index.ts:16-26` (`window.onerror`/`unhandledrejection`) | ambil `err.stack` mentah — di prod = **bundle minified** |
| Handler Node | `sdk/src/index.ts:28-33` | `err.stack` mentah — dari `dist` bila app jalan JS terkompilasi |
| Transport | `sdk/src/core.ts:12-25` (`send`) | POST body JSON, **tanpa** proses frame |
| Ingest server | `server/src/services/error-ingest.ts:36` | hanya `stack.slice(0, 16_000)` (cap) — tak diurai |
| Simpan | `ErrorGroup.sampleStack` / `ErrorEvent.stack` (`schema.prisma:253,277`) | `String?` polos |
| Tampil | `ErrorsScreen.tsx:129-138` | `<pre>{g.sampleStack}</pre>` — dump teks mentah |
| Eskalasi | `errors.ts:70` | 12 baris teratas stack mentah ditempel ke `Spec` QA |

Payload wire (`shared/src/dto.ts:265-272`, `zIngestPayload`) hanya punya `type/message/stack/
environment/release/context`. **Tak ada** `frames[]` terstruktur, `debug_id`, `dist`, maupun
mekanisme upload source-map. `release` **ditangkap & disimpan** (`error-ingest.ts:74`,
`eventView` `errors.ts:21`) tetapi **tak pernah dipakai** untuk resolusi apa pun dan bahkan **tak
muncul di ringkasan grup** (`zErrorGroupView` tak memuatnya). Verifikasi grep: pencarian
`source.?map|symbolica|enable-source-maps|debug_?id|in_app|context_line` di `server/src sdk/src
runner/src src/src` → **nihil**.

**Kesimpulan Phase 1:** ini **bukan bug** — pipeline catch→group→display bekerja sesuai desain.
Yang absen adalah **symbolication/source-map**, dan itu **sengaja di-defer**:

- PRD `docs/prd/log-error-monitoring.md:12` — "Fitur berat ala Sentry (… **symbolication
  source-map** …) berada **di luar scope** versi ini."
- PRD `:58` (Non-goals) — "**Bukan symbolication/source-map** untuk minified stack browser
  (stack dikirim apa adanya; source-map **pasca-MVP**)."
- PRD `:151` (Open questions #5) — "**Source-map browser.** Stack minified dari React/browser
  sulit dibaca — apakah symbolication (upload source-map) dibutuhkan cukup awal, atau tetap
  pasca-MVP?"
- ADR-0060 `:54` (Konsekuensi) — "… **source-map browser** … **pasca-MVP** (Open questions PRD)."

Jadi keluhan menunjuk **gap parity yang sudah dikenali & dicatat sebagai post-MVP**, bukan regresi.

## Temuan

### Temuan A (primer) — tak ada pipeline symbolication → stack = posisi hasil-build
Bukti di tabel jejak data di atas. Konsekuensi konkret per target:

- **Browser (CRM)** — build Vite produksi minified: stack tampil seperti
  `at t (index-4f3a2b.js:1:88421)` — nama fungsi ter-mangle, `line:col` menunjuk bundle satu-baris,
  path = artifact ber-hash. **Tak bisa** dipetakan ke `.tsx` sumber tanpa source-map. **Inilah inti
  keluhan.**
- **Backend Node/TS** — bila app menjalankan `dist` JS terkompilasi tanpa `node --enable-source-maps`,
  stack menunjuk `dist/*.js`, bukan `src/*.ts`. hanoman/SDK tak membantu maupun mendokumentasikannya.

Yang Sentry lakukan & hanoman belum (peta parity — Phase 2, pattern analysis):

| Kapabilitas Sentry | Status hanoman | Efek ke "jelas & mudah di-solve" |
|---|---|---|
| Frame terstruktur (`abs_path/function/lineno/colno` per frame) | **absen** — stack 1 string opaque | prasyarat semua fitur di bawah |
| Symbolication server-side via source-map ter-upload (per `release`/`dist`/`debug_id`) | **absen** | **tinggi** — de-minify ke posisi sumber |
| Context lines (cuplikan baris sumber sekitar frame) | **absen** | tinggi — lihat kode tepat di lokasi |
| Flag `in_app` (kode sendiri vs vendor/`node_modules`) | **absen** — semua baris tercampur | sedang — fokus ke frame relevan |
| Asosiasi `release`/`dist` → artifact source-map | `release` **ditangkap tapi tak dipakai/tampil** | sedang — korelasi build |
| Unwrap `error.cause` (rantai penyebab) | **absen** — hanya `name/message/stack` teratas | kecil–sedang — konteks akar |

### Temuan B (sekunder, ditemukan saat investigasi) — fingerprint memuat nama bundle ber-hash → grup pecah tiap deploy
`topFrame` (`error-fingerprint.ts:18-30`) membuang `:line:col` & path→basename, **tetapi basename
bundle browser membawa content-hash** (`index-4f3a2b.js`) yang berubah tiap build. Karena `topFrame`
ikut ke `fingerprint` (`:32-35`), **error browser yang sama menghasilkan fingerprint berbeda tiap
deploy** → grup baru, `count`/`firstSeenAt` reset, dan notifikasi "grup produksi baru"
(`error-ingest.ts:68`) **menyala ulang tiap rilis**. Verifikasi empiris (replika `topFrame`, dua
deploy hash beda):

```
parenthesized  deployA: "at t (index-4f3a2b.js)"  deployB: "at t (index-9z8y7w.js)"  → SAMA grup? false
anonymous      deployA: "at https://…/index-4f3a2b.js"  deployB: "at https://…/index-9z8y7w.js"  → SAMA grup? false
```

Test yang ada (`error-fingerprint.test.ts:17-22`) hanya memakai nama file stabil (`a.js`), sehingga
kasus hash tak tertangkap. Ini defect nyata & **memperparah** keluhan (kontinuitas grup hilang untuk
kasus browser). Bersifat **turunan dari akar yang sama** (stack browser mentah) — dilaporkan terpisah
karena berdiri sendiri sebagai bug grouping.

## Apakah issue terdefinisi baik?
**Ya, terdefinisi baik.** Keluhan tepat & terbukti: untuk CRM (browser prod) stack tersimpan minified
dan tak terpetakan ke sumber; gap parity vs Sentry riil dan bahkan **sudah tercatat** sebagai open
question PRD (#5) + konsekuensi ADR-0060. Perilaku = **working-as-designed** (fitur di-defer), bukan
regresi — kecuali **Temuan B** yang merupakan bug grouping asli.

## Rekomendasi

Terbelah menurut temuan (bukan satu jawaban tunggal):

1. **Temuan A (symbolication/source-map) — CUKUP JAWABAN + kandidat spec fitur baru, BUKAN Finding
   QA bug.** Ini bukan cacat; ini fitur berukuran besar (butuh: frame parser, artifact store
   source-map ber-`release`, resolver symbolication server-side, penanda `in_app`, context lines +
   perubahan payload/skema/kontrak) yang **secara eksplisit di-defer** ke pasca-MVP. Menaikkannya
   sebagai "perbaikan" akan salah-kelas. **Bila** parity ini dianggap perlu sekarang (prioritas
   tinggi), jalurnya = **buka backlog fitur baru** (source → feature, alur spec→plan→execute) yang
   memerlukan **ADR** (ubah data-model + api-contract). *Quick-win murah non-invasif yang bisa
   dipertimbangkan di spec itu:* (a) dokumentasikan `node --enable-source-maps` di `sdk/README.md`
   untuk fidelity backend Node tanpa server berubah; (b) surface `release` di ringkasan grup agar
   korelasi build lebih mudah. Keduanya kecil, tapi **tetap** perubahan → lewat backlog, bukan
   diselundupkan di audit ini.

2. **Temuan B (grup pecah tiap deploy karena hash bundle di fingerprint) — PERLU DINAIKKAN JADI
   FINDING QA untuk diperbaiki.** Ini bug asli, terbukti empiris, ber-blast-radius nyata (grouping &
   notifikasi CRM), dan perbaikannya **kecil & terlokalisasi** di `topFrame`/`fingerprint`
   (mis. normalisasi content-hash pada basename bundle, `index-<hash>.js` → `index.js`) + test kasus
   hash. Kandidat **jalur cepat QA** (temuan kecil → Spec/Plan `skipped`, ADR-0040) — namun keputusan
   naik/tidak & bentuk normalisasi ada di tangan operator.

**Ringkas:** keluhan valid & terdefinisi baik. Symbolication = **jawaban** (defer terdokumentasi;
angkat jadi *fitur* bila mau parity, wajib ADR) — **bukan** perbaikan bug. Yang layak jadi
**Finding QA perbaikan** justru **Temuan B** (fingerprint browser fragmentatif), bug bernilai tinggi
dengan perbaikan murah.

## Verifikasi
- Baca kode: `sdk/src/{core,index,browser-global}.ts`, `server/src/services/error-{ingest,fingerprint}.ts`,
  `server/src/routes/{ingest,errors}.ts`, `src/src/screens/ErrorsScreen.tsx`, `shared/src/dto.ts`,
  `server/prisma/schema.prisma`.
- Grep negatif: tak ada `source-map|symbolica|debug_id|in_app|frames[]` di seluruh `server/src sdk/src
  runner/src src/src`.
- Bukti Temuan B: replika `topFrame` atas stack bundle ber-hash → fingerprint beda antar-deploy (di
  atas).
- Silang-referensi doc: PRD `docs/prd/log-error-monitoring.md` (Non-goals :58, Open Q#5 :151),
  ADR-0060 :54 — semua menegaskan source-map = pasca-MVP.
