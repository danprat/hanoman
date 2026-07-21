# Audit SPEC-267 — status backlog local & server tidak sync

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** critical
**Keluhan:** "saat ini local dan server status backlognya masih tidak sync"
**Ekspektasi:** status backlog local sync dengan server, ambil data yang paling up-to-date.

## Ringkasan (doc-of-record)

Akar masalah **tunggal & berconfidence tinggi**: kemajuan stage otomatis — cara utama status
backlog berubah selama operasi normal — **tidak pernah mengantre ke sync outbox**, jadi hub
(server) tak pernah tahu stage sudah maju. Diff kecil, fix langsung; Spec & Plan di-skip
(dokumen ini menjadi doc-of-record perbaikan).

## Arsitektur sync (konteks, ADR-0043–0046)

- Instance lokal = **client**, hub (VPS) = **server**. Client sync server-to-server ke hub
  (`server/src/services/sync-client.ts`), disiplin **pull-before-push**.
- Write lokal yang perlu menyeberang **wajib** memanggil `enqueueOutbox(entity, recordId)`
  (`server/src/services/outbox.ts`). `syncOnce` men-drain outbox: snapshot record lokal →
  `POST /api/sync/push` dengan optimistic concurrency (ADR-0045).
- `spec` termasuk entitas SYNCED, dan `stage` **termasuk** field whitelist yang menyeberang
  (`server/src/services/sync.ts:25`). Jadi mekanisme sync-nya benar; yang hilang adalah *pemicu*.

## Akar masalah

Status backlog (`Spec.stage`) berubah lewat **dua** jalur:

1. **Manual mundur** — `PATCH /api/specs/:id` (revert backward-only). Ini **memanggil**
   `enqueueOutbox("spec", id)` (`server/src/routes/specs.ts:145`). ✅ sync.
2. **Maju otomatis** — saat sesi `claude` berjalan, stage diturunkan dari berkas fase sesi dan
   ditulis-melalui (write-through) di `liveSpecs()` (`server/src/services/live-specs.ts:31-33`)
   via `prisma.spec.updateMany(... data:{ stage })`. Jalur ini **TIDAK** memanggil
   `enqueueOutbox`. ❌ **tidak pernah** disync.

Jalur (2) adalah **cara dominan** status backlog berubah (brainstorming → planned → executing →
done mengikuti kemajuan sesi). Karena tak ada entri outbox yang lahir, `syncOnce` tak punya apa
pun untuk di-push → hub tetap memegang stage basi. Hasilnya persis keluhan: **local sudah
`executing`/`done`, server masih `brainstorming`**.

Bonus bug yang ikut terobati: tanpa entri outbox, `pending` set di `syncOnce` (`sync-client.ts:39`)
tak memuat spec itu, sehingga **pull dari hub bisa meng-clobber** stage lokal yang sudah maju
dengan stage basi hub (`sync-client.ts:44`). Mengantre outbox pada saat advance melindungi
lokal dari clobber **dan** mendorong stage ke hub — dua arah sekaligus.

`liveSpecs()` adalah satu-satunya situs write-through stage-maju (dipakai baik `GET /api/specs`
maupun siar WS lewat `services/events.ts`), jadi menambal di sana menutup semua jalur.

## Fix

Di `liveSpecs()`, setelah write-through CAS yang benar-benar mengubah baris
(`updateMany(...).count > 0`), panggil `enqueueOutbox("spec", id)`. Best-effort seperti call-site
lain (tak menggagalkan read utama). Hanya enqueue saat `count > 0` agar revert konkuren yang
membuat CAS no-op tak salah mengantre push maju.

## Verifikasi

- Test unit baru: sesi live (mock `sessionPhasesBySpec`) memajukan stage → `liveSpecs()`
  meninggalkan entri `outbox(spec, id)`. Merah sebelum fix, hijau sesudah.
- Boot server lokal + curl `GET /api/specs` yang memicu advance, cek `SyncOutbox` terisi.

## Keputusan pasca-audit

Confidence tinggi, akar jelas, diff kecil satu fungsi → **Spec skipped, Plan skipped**,
langsung Execute. Tidak ada perubahan skema, kontrak API, atau data model → tak butuh ADR baru
(memenuhi ADR-0043/0045 yang sudah ada; ini menutup pemicu yang terlewat).
