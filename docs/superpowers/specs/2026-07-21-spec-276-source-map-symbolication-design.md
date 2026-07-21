# SPEC-276 — Symbolication source-map server-side (parity Sentry)

> Lanjutan audit SPEC-275 (`internal/docs/research/audit-spec-275-stack-trace-source-map-parity.md`).
> Operator memilih **full symbolication** (bukan fast-track): isi gap parity ala Sentry penuh.
> ADR: **ADR-0070** (0069 sudah dipakai SPEC-273 breakdown di branch lain). Push `hanoman/spec-276`.

## Masalah

Pipeline error monitoring (SPEC-249/254 · ADR-0060/0063, npm `hanoman-sdk`) menyimpan &
menampilkan stack **mentah** di setiap lapis. Untuk bundle browser produksi (Vite: minified +
content-hash), stack menunjuk `index-4f3a2b.js:1:88421` — nama ter-mangle, posisi menunjuk artifact
hasil-build, bukan `.tsx` sumber. Ini yang **Sentry hindari** lewat symbolication source-map.

Dua temuan audit:
- **Temuan A (primer):** tak ada frame terstruktur / symbolication / source-map / `in_app` /
  context line. Stack = 1 string opaque.
- **Temuan B (sekunder, bug asli):** `topFrame` (`error-fingerprint.ts`) memuat basename bundle
  ber-content-hash → fingerprint beda tiap deploy → **grup pecah tiap rilis** (count/firstSeen reset,
  notif "grup baru" re-fire). Diperbaiki sekalian di sini.

## Tujuan / non-tujuan

**Tujuan**
1. SDK mengirim **frame terstruktur** (`function/filename/lineno/colno/in_app`) + unwrap `error.cause`.
2. Project bisa **upload source-map per `release`** ke hanoman (auth DSN key yang sama).
3. Server **symbolicate** stack minified → posisi `.ts/.tsx` sumber, dengan **context lines**.
4. Dashboard menampilkan **frame list** (fungsi, path sumber, `line:col`, penanda `in_app`,
   cuplikan baris sumber) dengan fallback ke stack mentah.
5. Fix Temuan B (fingerprint stabil lintas deploy).

**Non-tujuan (YAGNI)**
- Tak ada `sentry-cli` penuh; cukup dokumentasi + snippet uploader (curl / Node kecil).
- Tak ada `debug_id`-injection build plugin (kolom `debugId` disediakan opsional untuk masa depan,
  tapi jalur utama = keying `release` + basename artifact — pola Sentry pra-debug-id).
- Symbolication **lazy saat buka detail** (bukan async worker) — patuh "tanpa queue/Redis" (ADR-0024).
- Tak ada re-write retensi global; retensi source-map = prune sederhana per-upload.

## Arsitektur & aliran data

```
[app pakai hanoman-sdk]
  error → SDK parseStack → frames[]+in_app (+cause di-unwrap ke stack) → POST /api/ingest/:slug
  deploy → upload .map per release → POST /api/ingest/:slug/sourcemaps  (byte map di disk, meta di PG)

[hanoman server]
  ingest:  simpan ErrorEvent.frames (raw), ErrorGroup.sampleFrames (raw sample) + release; fingerprint
  display: GET /errors/:id → symbolicate sampleFrames pakai map yang tersedia SAAT INI → sampleFrames view
```

**Kenapa symbolicate saat display, bukan ingest:** menghindari race "error tiba sebelum map ter-upload"
(map di-upload saat deploy; grup dibuka belakangan → map hampir pasti sudah ada) dan menjaga ingest
tetap cepat. Detail di-fetch hanya saat grup dibuka (bukan di-poll), jadi parse map per buka = murah.
Frame mentah tersimpan immutable di event/grup; symbolication murni turunan → tak perlu kolom cache
maupun invalidasi.

### Unit (batas jelas, tiap unit teruji terpisah)

1. **SDK `sdk/src/stack.ts`** — `parseStack(stack)→Frame[]` (format V8 + Firefox/Safari), `inApp(filename)`,
   `framesFromError(err)` (set `in_app`), `withCauses(err)` (rangkai `error.cause` ke stack string).
   Dependency-free, fungsi murni. **Gotcha kolom:** stack V8 melaporkan `line:col` 1-based; source-map
   spec 0-based → resolver kurangi 1 pada kolom.
2. **shared `dto.ts`** — `zStackFrame` (SDK→server), `zIngestPayload` +`frames?`, `zSymbolicatedFrame`
   (server→UI), `zErrorGroupView` +`release?`, `zErrorGroupDetail` +`sampleFrames?`, `zSourceMapUpload`.
3. **schema migration (additive)** — `SourceMapArtifact`, `ErrorEvent.frames Json?`,
   `ErrorGroup.sampleFrames Json?` + `release String?`, back-relation `Project.sourceMaps`.
4. **`server/src/services/sourcemap-store.ts`** — `saveSourceMap` (byte→disk pola `uploads.ts`, meta
   upsert, cap ukuran, retensi keep-N-release), `findSourceMap(projectId, release, generatedBasename)`.
5. **`server/src/services/symbolicate.ts`** — `symbolicateFrames(frames, lookup)` (lookup di-inject →
   teruji tanpa DB) pakai `@jridgewell/trace-mapping`: `originalPositionFor` (kolom−1), `sourceContentFor`
   untuk context lines (pre/line/post).
6. **`error-ingest.ts`** — simpan `frames`/`release`/`sampleFrames`; fingerprint pakai frame bila ada.
7. **`error-fingerprint.ts`** — normalisasi content-hash pada basename (Temuan B) + prefer top `in_app`
   frame bila `frames[]` ada. + test kasus hash.
8. **routes** — `POST /api/ingest/:slug/sourcemaps` (auth DSN key, cap, retensi); `GET /errors` &
   `/errors/:id` kembalikan `release` + `sampleFrames` (symbolicated on the fly).
9. **frontend `ErrorsScreen.tsx`** — frame list (fungsi · path sumber · `L:C` · `in_app` tebal · context
   line) + badge `release`, fallback `<pre>{sampleStack}</pre>`.
10. **docs** — `sdk/README.md` (upload map + `node --enable-source-maps` + wajib `release`),
    `api-contract.md`, `data-model.md`, ADR-0070, index.

## Data model (additive; ADR-0070)

```prisma
model SourceMapArtifact {
  id         String   @id @default(cuid())
  projectId  String
  release    String
  filename   String   // basename artifact hasil-build yang dipetakan map ini (mis. index-4f3a2b.js)
  debugId    String?  // opsional (masa depan); jalur utama = release+filename
  storageKey String   // berkas opaque di HANOMAN_UPLOAD_DIR (uuid.map) — server-local, TAK disync
  size       Int
  createdAt  DateTime @default(now())
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([projectId, release, filename])
  @@index([projectId, release])
}
```
Tambahan kolom: `ErrorEvent.frames Json?`, `ErrorGroup.sampleFrames Json?`, `ErrorGroup.release String?`,
`Project.sourceMaps SourceMapArtifact[]`.

Byte map hidup di `HANOMAN_UPLOAD_DIR` (pola `uploads.ts` — di luar repoDir, **tak** ikut record-sync,
cermin `TicketAttachment` biner). Metadata (`SourceMapArtifact`) **tak** disync juga (server-local,
sama seperti `ErrorEvent`). Grup error yang sudah tersync (ADR-0066) tak berubah kontrak sync-nya;
`sampleFrames`/`release` bersifat additive di record grup — aman (konsumen lama abaikan field baru).

## Kontrak API (additive; ADR-0070)

- `zIngestPayload` +`frames?: zStackFrame[]` (opsional; `stack` string tetap ada → kompatibel mundur).
- **`POST /api/ingest/:slug/sourcemaps?key=…`** — body JSON `{ release, artifacts:[{ filename, map, debugId? }] }`.
  Auth = DSN key (sama seperti ingest). `202 { ok, stored }`. Cap ukuran total. `OPTIONS` untuk CORS.
- `GET /errors` item +`release`. `GET /errors/:id` +`release` +`sampleFrames: zSymbolicatedFrame[]`.

`zSymbolicatedFrame`: `{ function?, filename?, lineno?, colno?, in_app?, source?, sourceLine?,
sourceColumn?, contextLine?, preContext?: string[], postContext?: string[], symbolicated: boolean }`.

## Error handling
- Map absen / gagal parse / frame tak ter-map → frame dikembalikan `symbolicated:false` apa adanya
  (raw frame tetap berguna) — **tak pernah** menggagalkan request detail.
- Upload map: tolak >cap (413), key salah (401), body invalid (400). Fire-and-forget di sisi app tetap.
- Ingest: `frames` invalid → di-drop (payload lain tetap diproses); tak boleh 500 karena frame jelek.

## Testing (TDD)
- SDK: parse V8/Firefox/Safari, `in_app` heuristik, cause-unwrap — unit murni.
- symbolicate: source-map buatan-tangan (sources+sourcesContent+mappings) → assert posisi & context; kolom−1.
- fingerprint: dua basename ber-hash beda → **SAMA** grup (Temuan B), plus kasus lama tetap hijau.
- sourcemap-store: save→find roundtrip + retensi keep-N.
- routes: upload (auth/cap), ingest dengan frames, detail mengembalikan sampleFrames symbolicated.
- Live: boot server, curl upload map + ingest + GET detail → verifikasi symbolicated.

## Keputusan tercatat
- Lib: `@jridgewell/trace-mapping` (pure-JS, dipakai Vite/Rollup) di **server** (SDK tetap dependency-free).
- Symbolication **display-time lazy**, bukan worker (ADR-0024).
- Keying **release + basename artifact** (bukan wajib debug_id).
