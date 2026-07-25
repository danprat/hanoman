# Audit SPEC-330 — write asal-HUB tak masuk change-feed (backlog hub tak turun ke local)

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** critical
**Keluhan:** "sync prod local ke server ada issue tidak sync"
**Ekspektasi:** backlog yang lahir di hub (dashboard publik) turun ke instance local, dan sebaliknya.

## Ringkasan (doc-of-record)

Akar masalah **tunggal & terverifikasi di DB prod**: route/service yang menulis record asal-lokal
memanggil `enqueueOutbox()` **langsung** — mekanisme antrean push yang **khusus peran CLIENT**. Di
instance **HUB** tak ada sync client yang men-drain outbox, sehingga write asal-hub menumpuk di
`SyncOutbox` yatim, tetap `version 0` **tanpa baris `SyncLog`**, dan karena `pull` hanya membaca
`SyncLog`, record itu **tak pernah terlihat client** sampai reboot hub berikutnya menjalankan
`backfillFeed()` (ADR-0067). Helper role-aware `notifySynced()` (SPEC-268 · ADR-0066) sudah ada dan
sudah benar; 14 call site lama belum dimigrasikan ke sana. Diff kecil, tanpa perubahan skema/ADR —
dokumen ini menjadi doc-of-record perbaikan (Spec & Plan di-skip).

## Bukti lapangan (hub prod vs local prod, 2026-07-25)

| Bukti | Nilai |
| --- | --- |
| Spec di hub tapi tak ada di local | 14 — `SPEC-274` + `SPEC-317`…`SPEC-329` |
| Spec hanya ada di local | 0 |
| `SyncState.cursor` local | `17159` = `max(SyncLog.seq)` hub → client **merasa** sudah sinkron |
| Baris `SyncOutbox` yatim di hub | 25 (project 3, spec 14, vps 8); tertua 2026-07-15 |
| Spec `version = 0` tanpa baris feed di hub | 13 — tepat `SPEC-317`…`SPEC-329` |
| Boot terakhir `hanoman.service` | 2026-07-23 12:00 UTC — **semua** 13 spec lahir setelah itu |

`SyncOutbox` hub berisi tepat `SPEC-317`…`SPEC-329` + `SPEC-268`, dengan `createdAt` yang cocok
milidetik-per-milidetik dengan `Spec.updatedAt`-nya. Itu sidik jari langsung penyebabnya.

## Mekanisme

- `notifySynced(entity, id)` (`server/src/services/sync-notify.ts`) sadar-peran:
  ada `SYNC_SERVER_URL` → `enqueueOutbox` (client, di-push oleh `syncOnce`); kosong → `publishLocal`
  (hub, append `SyncLog` + naikkan version + siar WS).
- `pull` (`server/src/services/sync.ts`) membaca **hanya** `SyncLog`. Record tanpa baris feed
  tak ada bagi client, berapa pun isi tabel bisnisnya.
- Di hub, `applySyncConfig()` menghentikan sync client (tak ada hub tujuan) → `listOutbox()` tak
  pernah dibaca. Baris outbox di hub adalah write yang **hilang tanpa suara**.

## Fix

Ganti `enqueueOutbox()` → `notifySynced()` pada 14 call site write asal-lokal:

- `server/src/routes/specs.ts` — `POST /specs`, `POST /specs/batch`, `PATCH /specs/:id`
- `server/src/routes/projects.ts` — 6 site (create + patch + knob)
- `server/src/routes/vps.ts` — 2 site · `server/src/services/vps-audit.ts` — 2 site (audit, health)
- `server/src/services/session-result.ts` — `recordSessionResult`

`services/rename-project.ts` **tetap** `enqueueOutbox("projectRename", …)`: `projectRename` bukan
entitas `SYNCED` (pseudo-entity operasi rename, ADR-0064) sehingga `notifySynced` akan no-op.
Propagasi rename asal-hub karenanya masih gap terbuka — lihat Sisa gap.

Penyembuhan state lama: restart hub → `applyConfigOnBoot()` menjalankan `backfillFeed()` yang
mempublish tiap row `SYNCED` yang belum terwakili di feed pada version terkininya (idempoten).

## Test

`server/test/sync-hub-origin-writes.test.ts` — 7 test: tiap jalur write asal-hub wajib menghasilkan
baris feed + `version > 0` + `SyncOutbox` kosong, plus satu test yang menjaga perilaku CLIENT
(antre di outbox, feed kosong) agar tak ikut berubah. Gagal 6/7 sebelum fix.

`outbox.test.ts`, `vps-sync.test.ts`, `session-result.test.ts` menegaskan peran client secara
eksplisit (`setConfig("SYNC_SERVER_URL", …)`) — sebelumnya lolos hanya karena call site-nya belum
sadar-peran.

Smoke nyata: instance hub → `POST /projects` + `POST /specs` → `GET /api/sync/pull?since=0`
(Bearer device token) mengembalikan kedua record di `v1`; `SyncOutbox` kosong.

## Sisa gap (di luar lingkup fix ini)

1. **`updatedAt` bukan jam LWW yang andal.** Ia ikut whitelist dan menyeberang (SPEC-270), tapi
   `@updatedAt` Prisma me-restamp di sisi penerima setiap sync write. Terlihat di lapangan:
   `version` dan `stage` **identik** untuk semua 162 spec yang ada di dua sisi — hanya `updatedAt`
   yang beda. Tak ada kehilangan data, tapi default modal rekonsil (ADR-0067) berdiri di atas
   jam yang goyah.
2. **Delete tak pernah disync.** `DELETE /specs/:id` tak memanggil apa pun dan protokol tak punya
   tombstone, jadi hapus di satu node tak pernah merambat. Ini kasus `SPEC-274` (ada baris feed
   lama seq 9012, tak ada di outbox hub) — divergensi permanen. Butuh ADR sendiri.
3. **Rename project asal-hub** tak merambat (lihat Fix).
4. **`backfillFeed()` hanya jalan saat boot.** Ia jaring penyelamat, bukan pengganti pemicu yang
   benar; setelah fix ini tak ada lagi yang perlu dijaringnya, tapi tak ada alarm bila `SyncOutbox`
   di hub kembali terisi.
