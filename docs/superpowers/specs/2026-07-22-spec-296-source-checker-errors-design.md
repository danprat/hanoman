# SPEC-296 — Source-checker Errors (batch fixing): grup produksi berulang → escalate → enqueue

> Status: design (2026-07-22). Daun #2 dari breakdown PRD scheduler otonom, di atas fondasi SPEC-294/ADR-0072.
> Sumber: `docs/prd/scheduler-auto-start-backlog-batch-errors-and-pick-triase.md` §Source — Errors + User Story #2.
> Sejalan dengan pola daun #1 SPEC-295 (`sources/backlog.ts`).

## Objective

Checker `errors` terdaftar di registry fondasi (`registerSchedulerSource`). Saat cadence errors jalan,
untuk **tiap `ErrorGroup` eligible** checker memanggil **logika escalate** (membuat `Spec` source `qa`
prioritas tinggi + tautan dua arah) lalu meng-**enqueue** peluncuran sesinya. Hanya grup **env produksi**
& `count ≥ ambang` (ambang dari `Setting.scheduler.sources.errors.minCount`) yang tersaring. **Idempoten**:
grup yang sudah `escalated`/`resolved` atau sudah ber-`specId` dilewati. **Banyak** grup terproses satu
window; jumlah sesi yang benar-benar jalan dibatasi **hanya oleh cap** governor (checker tak punya limit
sendiri, satu grup = satu backlog). Dibuktikan **unit test** + **curl** di local.

## Konteks & batas (yang sudah ada)

Fondasi (ADR-0072) menerbitkan kontrak yang leaf ini gantung aditif di atasnya — **tak boleh diubah**:

- **Registry** (`services/scheduler/registry.ts`): `registerSchedulerSource({ id, check })`, jam cadence.
  Engine memanggil `check()` tiap tick saat source `enabled` & jatuh-tempo.
- **Antrean** (`services/scheduler/queue.ts`): `enqueue({ specId, projectId, source, priority })` — **upsert
  pada `specId @unique`, `update: {}`** → idempoten. `queued()` urut `tinggi→sedang→rendah` lalu FIFO.
- **Governor** (`governor.ts` + `engine.ts prodDeps.launch`): men-drain antrean **di bawah cap**
  (`maxConcurrent`), meluncurkan lewat `startSpecSession`, `flow` diturunkan `flowForSource(spec.source)`.
- **Skema**: `SchedulerQueueItem` (`source` = **asal checker** `backlog|errors|triase`), `Project.schedulerOptIn`,
  blok `Setting.scheduler` (termasuk `sources.errors.{enabled, everyMin, minCount(=5)}`, default mati).
- **Jalur escalate lama** (`routes/errors.ts` `POST /errors/:id/escalate`): membuat `Spec` source `qa`
  prioritas `tinggi`, payload prefilled (`fromErrorGroup`, `actual` = type+message+stack+backlink), TOCTOU
  retry P2002 (≤3), lalu `errorGroup.update({ status:"escalated", specId })` + `notifySynced` ×2. Kontrak
  HTTP-nya diuji `errors-escalate.route.test.ts` (201 `{spec}` baru / 200 `{alreadyEscalated,spec}` / 404).

**Definisi "produksi"** dikunci dari `services/error-ingest.ts`: `environment` di-set `(payload.environment
|| "unknown")`, dan jalur notifikasi grup-baru memakai literal `environment === "production"`. Checker
memakai definisi yang sama: `environment: "production"`.

## Arsitektur

### 1. Ekstraksi jalur escalate → `server/src/services/error-escalate.ts` (refactor, bukan fitur baru)

Agar checker **benar-benar memakai ulang** jalur escalate (bukan menduplikasinya), inti escalate dipindah
dari handler route ke satu fungsi service. Route mendelegasikan; checker memanggil fungsi yang sama.
Mengikuti preseden fondasi yang mengekstrak `startSpecSession` dari `terminal.ts` → `session-launch.ts`.

```
escalateErrorGroup(group, { author }): Promise<{ spec: Spec; created: boolean }>
  - group.specId sudah ada → { spec: <linked>, created: false }   (idempoten; tak buat kedua)
  - else: buat Spec (source qa, prioritas tinggi, payload prefilled, TOCTOU retry P2002),
          group.update({ status:"escalated", specId }), notifySynced("spec"), notifySynced("errorGroup")
          → { spec, created: true }
```

`routes/errors.ts` `POST /errors/:id/escalate` menjadi tipis: lookup group (404) → `escalateErrorGroup(g,
{ author })` → `created ? 201 {spec} : 200 {alreadyEscalated:true, spec}`. **Perilaku HTTP tak berubah**
(test route lama tetap hijau) — tanpa perubahan skema/kontrak API.

### 2. Komponen baru: `server/src/services/scheduler/sources/errors.ts`

Satu unit fokus, dua fungsi terhadap kontrak fondasi + jalur escalate terekstrak:

```
checkErrors(): Promise<void>
  1. minCount = (await getScheduler()).sources.errors.minCount
  2. groups = prisma.errorGroup.findMany({ where: {
         status: "new", environment: "production", specId: null,
         count: { gte: minCount }, project: { schedulerOptIn: true } } })
  3. untuk tiap group (satu grup = satu backlog):
        try {
          const { spec } = await escalateErrorGroup(group, { author: "scheduler" })
          await enqueue({ specId: spec.id, projectId: spec.projectId,
                          source: "errors", priority: spec.priority })
        } catch { /* satu grup gagal (mis. project tak ter-bind) tak menghentikan sisanya */ }

registerErrorsSource(): void
  registerSchedulerSource({ id: "errors", check: checkErrors })
```

- **Seleksi**: relasi-filter `project: { schedulerOptIn: true }` → project non-opt-in **tak pernah**
  ter-query. `status:"new"` ∧ `specId:null` menyaring grup `escalated`/`resolved`/ber-specId **di query**
  → idempotensi gratis (grup keluar dari himpunan begitu escalate mem-flip `status:"escalated"`+`specId`).
  `environment:"production"` ∧ `count:{gte:minCount}` = gerbang produksi + ambang.
- **Ambang dari setelan**: `minCount` dibaca dari `Setting.scheduler.sources.errors.minCount` (bukan
  konstanta) — `getScheduler()` mengisi default 5 untuk baris Setting lama.
- **Cap-only batching**: loop memproses **semua** grup eligible tanpa limit sendiri; berapa yang benar-benar
  jalan ditahan governor `drain` (cap `maxConcurrent`). Grup yang belum di-drain tetap di antrean.
- **Priority enqueue** = `spec.priority` (escalate selalu `"tinggi"`) → drain memprioritaskannya.
- **Per-grup try/catch**: escalate memanggil `resolveRepoDir`/`nextSpecId` yang bisa throw bila project
  belum ter-bind; membungkus per-grup menjaga grup lain tetap terproses (grup gagal tetap `status:"new"`
  → dicoba lagi tick berikutnya, tanpa korupsi state).

### 3. Wiring boot: `server/src/server.ts`

`registerErrorsSource()` dipanggil **sekali** tepat setelah `registerBacklogSource()` dan sebelum
`startScheduler()`. `app.ts` tetap **bebas-timer & bebas-registrasi** (test mengisi registry sendiri).

## Idempotensi (invarian utama)

| Kondisi grup | Mengapa tak dobel-escalate / dobel-jalan |
|---|---|
| Sudah `escalated` (specId set) | Query `status:"new"` ∧ `specId:null` → tak ikut. |
| Sudah `resolved` | Query `status:"new"` → tak ikut. |
| Baru di-escalate window ini | Escalate mem-flip `status:"escalated"`+`specId` → tick berikutnya tak match. |
| `checkErrors()` dua kali satu tick/lintas-tick | Di atas berlaku + `enqueue` upsert `specId @unique` → 1 baris antrean per spec. |
| Sesi spec sudah hidup (di-Start manual) | Governor `isLive` menandai `launched` tanpa spawn kedua (di luar scope leaf). |

## Data flow

```
engine.tick (enabled & errors due)
  └─ checkErrors()
       ├─ query (opt-in ∧ new ∧ production ∧ count≥minCount ∧ specId=null)
       └─ per grup: escalateErrorGroup → Spec(qa,tinggi) + link  →  enqueue(source="errors")  [SchedulerQueueItem]
governor.drain (cap, tak-Pause)   ← sudah ada (SPEC-294), di luar scope leaf
  └─ queued() → startSpecSession(flow = flowForSource("qa"))
GET /api/scheduler/state → { queue: SchedulerQueueItem[] }   ← surface curl
```

## Error handling

- Query gagal (DB kedip) → exception naik ke `engine.tick` yang membungkus tiap `check()` (`try/catch`).
- Escalate satu grup gagal (project tak ter-bind) → **per-grup try/catch** di `checkErrors`; grup lain lanjut.
  Grup gagal tetap `status:"new"` → dicoba lagi tick berikutnya. Tanpa retry paksa (konsisten PRD non-goal).

## Testing

**Unit** (`server/test/scheduler-source-errors.test.ts`, pola `scheduler-source-backlog.test.ts`):
1. Meng-escalate + enqueue hanya grup eligible (new ∧ production ∧ count≥minCount ∧ opt-in); item antrean
   `source:"errors"`, `priority:"tinggi"`, `status:"queued"`; grup jadi `escalated` + `specId` terisi.
2. Menyaring `environment`: grup `development`/`unknown` count tinggi **tak** di-escalate.
3. Menyaring ambang: grup `count < minCount` **tak** di-escalate.
4. Melewati project non-opt-in.
5. Idempoten grup: grup `status:"escalated"`/ber-specId/`resolved` **tak** disentuh; `checkErrors()` dua
   kali → tiap grup escalated sekali, satu baris antrean per spec.
6. Banyak grup satu window: 3 grup eligible → 3 escalated + 3 baris antrean (tanpa limit checker).
7. Ambang dari setelan: `Setting.scheduler.sources.errors.minCount` custom → boundary mengikuti setelan.
8. `registerErrorsSource()` mendaftarkan source id `"errors"`.

**Regresi**: `errors-escalate.route.test.ts` (kontrak HTTP escalate) tetap hijau setelah ekstraksi.

**Curl smoke** (boot server ke DB throwaway ter-migrate, bukan `hanoman_test`):
- Seed: project A `schedulerOptIn=true` + grup produksi eligible (count≥5) + grup non-eligible
  (dev / count rendah); project B non-opt-in + grup produksi count tinggi.
- `PUT /api/scheduler/config { enabled:true, paused:true, sources.errors.enabled:true }` (Pause ⇒ enqueue
  teruji tanpa drain/launch nyata).
- Boot-pass engine menjalankan `checkErrors`.
- `GET /api/scheduler/state` → `queue` berisi grup eligible project A (source `errors`, priority `tinggi`);
  grup non-eligible & project B **absen**. `GET /api/errors/:id` grup eligible → `status:"escalated"`.

## Docs tersentuh (commit sama)

- `internal/docs/architecture/stack.md` — baris pipeline scheduler: tandai checker `errors` konkret (SPEC-296).
- `internal/docs/architecture/api-contract.md` §Scheduler — catat `errors` = checker kedua; escalate kini
  service `error-escalate.ts` (dipakai route + scheduler), kontrak HTTP tak berubah.
- `internal/docs/architecture/data-model.md` §SchedulerQueueItem — catat source `errors` kini diisi checker.

Tak ada doc/ADR/migration baru → index `README.md` tak berubah (doc-doc di atas sudah ter-link).
