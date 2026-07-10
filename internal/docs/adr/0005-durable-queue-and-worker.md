# ADR 0005 — Antrian durable (BullMQ/Redis) + proses worker terpisah

**Status:** superseded oleh [ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (SPEC-162) — antrean dan worker dicabut bersama runner headless

## Konteks
SPEC-003 men-dispatch run lewat semaphore in-process + `EventEmitter` di `RunManager`.
Ini hilang saat proses restart (run antre lenyap), tidak bisa diskalakan lintas proses,
dan menyatukan API dengan eksekusi run. SPEC-004 menuntut dispatch yang **durable** dan
**eksternal**, plus cutoff enqueue di `dailyBudget`.

## Keputusan
- Dispatch memakai **BullMQ 5 di Redis 7**. Queue `hanoman-runs` diproduksi
  `server/src/queue.ts`; dikonsumsi proses **worker terpisah** (`server/src/worker.ts`,
  `node server/dist/worker.js`).
  - Nama queue tanpa `:` — BullMQ 5 memakai `:` sebagai separator key Redis dan
    menolak nama ber-`:` (rencana awal `hanoman:runs` → `hanoman-runs`).
  - ioredis untuk BullMQ pakai `maxRetriesPerRequest: null`. Pub/sub memakai koneksi
    **terpisah** (client yang subscribe tidak bisa mengirim command lain).
- Event run & kontrol menyeberang proses lewat **Redis pub/sub**: worker persist event
  ke Postgres dan publish ke `run:<id>:events`; kontrol (`steer`/`pause`/`stop`)
  dipublish API ke `run:<id>:control` dan disubscribe worker.
- **Cutoff budget di enqueue:** `todaySpendUsd() >= dailyBudget` → tolak enqueue baru.
  Run yang sudah jalan boleh melampauinya (governs new enqueues only).
- **Tanpa auto-retry:** job `attempts: 1`. Stall → run `failed` (`maxStalledCount: 1`).
- Semaphore + `EventEmitter` SPEC-003 dihapus.

## Delta skema
- `Run.createdAt DateTime @default(now())` — dibutuhkan `todaySpendUsd()` untuk membatasi
  penjumlahan biaya ke run **hari ini** (bukan akumulasi seumur hidup). Migration:
  `20260708021344_run_created_at`.
- `RunInput.projectId?: string` (tipe runner) — supaya `enqueueRun` menautkan Run ke
  project tanpa hardcode; jika kosong, di-resolve dari `specId`.

## Konsekuensi
- (+) Run durable lintas restart; konkurensi diatur `Worker { concurrency }`; API tak
  memblok eksekusi.
- (+) Budget ditegakkan sebelum kerja dimulai.
- (−) Butuh Redis sebagai dependensi infra baru + satu proses worker (`pnpm dev` jalankan
  api + worker).
