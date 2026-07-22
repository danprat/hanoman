# SPEC-295 — Source-checker Backlog: auto-enqueue spec belum-mulai urut prioritas

> Status: design (2026-07-22). Daun #1 dari breakdown PRD scheduler otonom, di atas fondasi SPEC-294/ADR-0072.
> Sumber: `docs/prd/scheduler-auto-start-backlog-batch-errors-and-pick-triase.md` §Source — Backlog + User Story #1.

## Objective

Checker `backlog` terdaftar di registry fondasi (`registerSchedulerSource`). Saat cadence backlog jalan,
checker meng-**enqueue** semua `Spec` **belum-mulai** (`baseSha === null`) dari project `schedulerOptIn`,
**terurut prioritas** `tinggi → sedang → rendah`. Project **non-opt-in tak pernah tersentuh**. **Idempoten**:
tak pernah dobel-enqueue spec yang sudah antre atau yang sesinya sudah hidup. Dibuktikan **unit test** +
**curl** endpoint `GET /api/scheduler/state` di local.

## Konteks & batas (yang sudah ada dari SPEC-294)

Fondasi (ADR-0072) sudah menerbitkan kontrak yang leaf ini gantung aditif di atasnya — **tak boleh diubah**:

- **Registry** (`services/scheduler/registry.ts`): `registerSchedulerSource({ id, check })`, `listSources()`,
  jam cadence (`isDue`/`setLastRun`). Engine memanggil `check()` tiap tick saat source `enabled` & jatuh-tempo.
- **Antrean** (`services/scheduler/queue.ts`): `enqueue({ specId, projectId, source, priority })` — **upsert
  pada `specId @unique`, `update: {}`** → idempoten, tak me-resurrect item yang sudah diproses. `queued()`
  mengurutkan `tinggi→sedang→rendah` lalu FIFO (`enqueuedAt`).
- **Governor** (`services/scheduler/governor.ts` + `engine.ts prodDeps.launch`): men-drain antrean di bawah
  cap, meluncurkan lewat `startSpecSession`, `flow` diturunkan `flowForSource(spec.source)` **server-side**.
- **Skema**: `SchedulerQueueItem` (kolom `source` = **asal checker** `backlog|errors|triase`, bukan
  `spec.source`), `Project.schedulerOptIn` (default false), blok `Setting.scheduler` (default mati).
- **Endpoint**: `GET/PUT /api/scheduler/config`, `GET /api/scheduler/state` (menampilkan `queue`).

Leaf ini **hanya** menambah checker `backlog` + registrasinya saat boot. **Bukan** bagian leaf ini: jalur
launch/drain/flow (sudah di governor), skema (tak berubah), endpoint baru (tak ada), ADR/migration (tak perlu).

## Arsitektur

### Komponen baru: `server/src/services/scheduler/sources/backlog.ts`

Satu unit fokus, dua fungsi murni terhadap kontrak fondasi:

```
checkBacklog(): Promise<void>
  1. specs = prisma.spec.findMany({ where: { baseSha: null, project: { schedulerOptIn: true } } })
  2. urutkan tinggi→sedang→rendah (RANK map identik queue.ts), tiebreak deterministik by id
  3. untuk tiap spec: enqueue({ specId: spec.id, projectId: spec.projectId,
                                source: "backlog", priority: spec.priority })

registerBacklogSource(): void
  registerSchedulerSource({ id: "backlog", check: checkBacklog })
```

- **Seleksi**: relasi-filter `project: { schedulerOptIn: true }` menjamin project non-opt-in **tak pernah**
  ikut ter-query → tak tersentuh. `baseSha: null` = "belum-mulai" (kondisi turunan, PRD; sekali sesi
  diluncurkan `startSpecSession` menulis `baseSha` → spec keluar dari himpunan ini).
- **Urutan**: RANK `{ tinggi:0, sedang:1, rendah:2 }` (cermin `queue.ts`), tiebreak `id` agar deterministik
  di test. Enqueue berurutan → `enqueuedAt` naik searah prioritas, konsisten dengan sort `queued()` saat drain.
- **Tak ada dedup manual**: idempotensi dijamin `enqueue` (upsert `specId @unique`). Checker tetap thin.

### Wiring boot: `server/src/server.ts`

`registerBacklogSource()` dipanggil **sekali** tepat sebelum `startScheduler()`. `app.ts` tetap **bebas-timer
& bebas-registrasi** (ADR-0072: registry diisi dari `server.ts`; test mengisi registry sendiri).

## Idempotensi (invarian utama)

| Kondisi | Mengapa tak dobel-enqueue / dobel-jalan |
|---|---|
| Spec sudah **antre** (`queued`) | `enqueue` upsert `update:{}` → baris tetap satu (`specId @unique`). |
| Spec sesinya **hidup** (`launched`) | (a) `startSpecSession` sudah menulis `baseSha≠null` → keluar dari query; (b) baris antrean `launched` di-upsert `update:{}` → tak resurrect. |
| Spec sudah **done/failed** di antrean | Upsert `update:{}` → tak me-reset ke `queued` (no auto-retry, PRD non-goal). |
| `check()` dipanggil dua kali satu tick / lintas-tick | Semua di atas berlaku → jumlah baris per spec = 1. |

## Data flow

```
engine.tick (enabled & backlog due)
  └─ checkBacklog()
       └─ query (opt-in ∧ baseSha=null) → sort prioritas → enqueue(source="backlog")  [SchedulerQueueItem]
governor.drain (cap, tak-Pause)   ← sudah ada (SPEC-294), di luar scope leaf ini
  └─ queued() → startSpecSession(flow = flowForSource(spec.source))
GET /api/scheduler/state → { queue: SchedulerQueueItem[] }   ← surface curl
```

## Error handling

- Query gagal (DB kedip) → exception naik ke `engine.tick`, yang sudah membungkus tiap `check()` dalam
  `try/catch` ("satu source gagal tak menghentikan sisanya"). Tak perlu penanganan tambahan di checker.
- Enqueue gagal untuk satu spec → naik & dibungkus tick yang sama; sisa tick aman. (Himpunan kecil; kegagalan
  parsial jarang. Tak ada retry — konsisten PRD non-goal.)

## Testing

**Unit** (`server/test/scheduler-source-backlog.test.ts`, pola `scheduler-engine.test.ts`):
1. Memilih hanya spec `baseSha=null` dari project opt-in; project non-opt-in **tak** menghasilkan item.
2. Mengurutkan `tinggi→sedang→rendah` (assert urutan `queued()` / `enqueuedAt`).
3. Melewati spec dengan `baseSha≠null` (sudah mulai).
4. Idempoten: `checkBacklog()` dua kali → satu baris per spec; item `launched` tak diangkat ulang.
5. `registerBacklogSource()` mendaftarkan source id `"backlog"` di registry.

**Curl smoke** (boot server ke DB throwaway ter-migrate, bukan `hanoman_test`):
- Seed: project A `schedulerOptIn=true` + 2 spec `baseSha=null` (prioritas beda); project B non-opt-in + 1 spec.
- `PUT /api/scheduler/config { enabled:true, paused:true, sources.backlog.enabled:true }` (Pause ⇒ tak ada
  drain/launch nyata; hanya enqueue teruji).
- Boot-pass engine menjalankan `checkBacklog`.
- `GET /api/scheduler/state` → `queue` berisi 2 spec project A urut prioritas; spec project B **absen**.

## Docs tersentuh (commit sama)

- `internal/docs/architecture/stack.md` — baris pipeline scheduler: tandai checker `backlog` konkret (SPEC-295).
- `internal/docs/architecture/api-contract.md` §Scheduler — catat `backlog` = checker pertama terdaftar.
- `internal/docs/architecture/data-model.md` §SchedulerQueueItem — catat source `backlog` kini diisi checker.

Tak ada doc/ADR/migration baru → index `README.md` tak berubah (doc-doc di atas sudah ter-link).
