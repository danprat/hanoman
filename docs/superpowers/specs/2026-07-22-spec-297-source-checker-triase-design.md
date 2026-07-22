# SPEC-297 — Source-checker Triase (pick): tiket bug/fitur → accept → enqueue

> Status: design (2026-07-22). Daun #3 dari breakdown PRD scheduler otonom, di atas fondasi SPEC-294/ADR-0072.
> Sumber: `docs/prd/scheduler-auto-start-backlog-batch-errors-and-pick-triase.md` §Source — Triase + User Story #3.
> Cermin penuh pola daun #2 SPEC-296 (`sources/errors.ts` + ekstraksi `error-escalate.ts`).

## Objective

Checker `triase` terdaftar di registry fondasi (`registerSchedulerSource`). Saat cadence triase jalan,
untuk **tiap `Ticket` eligible** checker memanggil **logika accept** (membuat `Spec` dengan pemetaan
kategori→source SPEC-291 + tautan dua arah tiket) lalu meng-**enqueue** peluncuran sesinya. Hanya tiket
**status `new`** berkategori **`bug` atau `fitur`** dari **project opt-in** yang tersaring; kategori
**`pertanyaan`/`lainnya` tak pernah auto-accept** (tetap manual). **Idempoten**: tiket yang sudah
`accepted`/`rejected` atau sudah ber-`specId` dilewati. **Banyak** tiket terproses satu window; jumlah sesi
yang benar-benar jalan dibatasi **hanya oleh cap** governor (checker tak punya limit sendiri, satu tiket =
satu backlog). Dibuktikan **unit test** + **curl** di local.

## Konteks & batas (yang sudah ada)

Fondasi (ADR-0072) menerbitkan kontrak yang leaf ini gantung aditif di atasnya — **tak boleh diubah**:

- **Registry** (`services/scheduler/registry.ts`): `registerSchedulerSource({ id, check })`, jam cadence.
  Engine memanggil `check()` tiap tick saat source `enabled` & jatuh-tempo.
- **Antrean** (`services/scheduler/queue.ts`): `enqueue({ specId, projectId, source, priority })` — **upsert
  pada `specId @unique`, `update: {}`** → idempoten. `queued()` urut `tinggi→sedang→rendah` lalu FIFO.
- **Governor** (`governor.ts` + `engine.ts prodDeps.launch`): men-drain antrean **di bawah cap**
  (`maxConcurrent`), meluncurkan lewat `startSpecSession`, `flow` diturunkan `flowForSource(spec.source)`.
- **Skema**: `SchedulerQueueItem` (`source` = **asal checker** `backlog|errors|triase`), `Project.schedulerOptIn`,
  blok `Setting.scheduler` (termasuk `sources.triase.{enabled, everyMin(=30)}`, default mati). **Config knob
  `triase` sudah ada sejak fondasi SPEC-294** — tak ada perubahan skema/setting untuk leaf ini.
- **Jalur accept lama** (`routes/tickets.ts` `POST /tickets/:id/accept`): membuat `Spec` dengan
  `source = SOURCE_BY_CATEGORY[category]` (SPEC-291: bug→`qa`, fitur→`brief`, pertanyaan→`audit`,
  lainnya→`brief`), payload mengikuti bentuk source (qa-shaped `actual` vs brief-shaped `context`),
  direktif lampiran SPEC-286 di `detail`, TOCTOU retry P2002 (≤3), lalu
  `ticket.update({ status:"accepted", specId })` + `notifySynced` ×2. Kontrak HTTP-nya diuji
  `tickets.route.test.ts` (201 `{spec}` baru / 200 `{alreadyPromoted,spec}` / 404).

**Definisi "eligible triase"** dikunci dari PRD §Source — Triase (FRD): `Ticket` status `new`, kategori
`bug` atau `fitur`, dari project opt-in. Kategori `pertanyaan`/`lainnya` sengaja di luar himpunan (Non-goal:
"Bukan auto-triase untuk kategori pertanyaan/lainnya — tetap manual").

## Arsitektur

### 1. Ekstraksi jalur accept → `server/src/services/ticket-accept.ts` (refactor, bukan fitur baru)

Agar checker **benar-benar memakai ulang** jalur accept (bukan menduplikasinya), inti accept dipindah dari
handler route ke satu fungsi service. Route mendelegasikan; checker memanggil fungsi yang sama. Cermin
penuh preseden SPEC-296 yang mengekstrak `escalateErrorGroup` dari `routes/errors.ts` → `error-escalate.ts`.
Helper `attachmentInstruction` (SPEC-286) dan peta `SOURCE_BY_CATEGORY` (SPEC-291) ikut pindah ke service.

```
acceptTicket(ticket & { attachments }, { author, priority }): Promise<{ spec: Spec; created: boolean }>
  - ticket.specId sudah ada → { spec: <linked>, created: false }   (idempoten; tak buat kedua)
  - else: source = SOURCE_BY_CATEGORY[ticket.category] ?? "brief"
          detail = <isi tiket + kategori + pelapor + backlink> + attachmentInstruction(ticket, attachments)
          payload = source==="qa" ? qa-shaped(actual=detail) : brief-shaped(context=detail)
          buat Spec (title, source, prioritas=priority, author `Help · <author>`, TOCTOU retry P2002),
          ticket.update({ status:"accepted", specId }), notifySynced("spec"), notifySynced("ticket")
          → { spec, created: true }
```

`routes/tickets.ts` `POST /tickets/:id/accept` menjadi tipis: lookup ticket+attachments (404) →
`priority = body.priority ?? "sedang"`, `author = req.user?.email ?? "system"` → `acceptTicket(t,
{ author, priority })` → `created ? 201 {spec} : 200 {alreadyPromoted:true, spec}`. **Perilaku HTTP tak
berubah** (test route lama tetap hijau) — tanpa perubahan skema/kontrak API.

### 2. Komponen baru: `server/src/services/scheduler/sources/triase.ts`

Satu unit fokus, dua fungsi terhadap kontrak fondasi + jalur accept terekstrak:

```
checkTriase(): Promise<void>
  1. tickets = prisma.ticket.findMany({
         where: { status: "new", category: { in: ["bug", "fitur"] },
                  specId: null, project: { schedulerOptIn: true } },
         include: { attachments: true } })
  2. untuk tiap ticket (satu tiket = satu backlog):
        try {
          const { spec } = await acceptTicket(ticket, { author: "scheduler", priority: "sedang" })
          await enqueue({ specId: spec.id, projectId: spec.projectId,
                          source: "triase", priority: spec.priority })
        } catch { /* satu tiket gagal (mis. project tak ter-bind) tak menghentikan sisanya */ }

registerTriaseSource(): void
  registerSchedulerSource({ id: "triase", check: checkTriase })
```

- **Seleksi**: relasi-filter `project: { schedulerOptIn: true }` → project non-opt-in **tak pernah**
  ter-query. `status:"new"` ∧ `specId:null` menyaring tiket `accepted`/`rejected`/ber-specId **di query**
  → idempotensi gratis (tiket keluar dari himpunan begitu accept mem-flip `status:"accepted"`+`specId`).
  `category: { in: ["bug","fitur"] }` = gerbang actionable: `pertanyaan`/`lainnya` **tak pernah** ter-query
  → **tak pernah auto-accept** (tetap manual, sesuai Non-goal).
- **Prioritas scheduler-triase** = `"sedang"` (mencerminkan default body `POST /tickets/:id/accept`; tak
  ada operator memilih prioritas). Enqueue memakai `spec.priority` → drain memprioritaskannya.
- **Cap-only batching**: loop memproses **semua** tiket eligible tanpa limit sendiri; berapa yang benar-benar
  jalan ditahan governor `drain` (cap `maxConcurrent`). Tiket yang belum di-drain tetap di antrean.
- **Per-tiket try/catch**: accept memanggil `resolveRepoDir`/`nextSpecId` yang bisa throw bila project
  belum ter-bind; membungkus per-tiket menjaga tiket lain tetap terproses (tiket gagal tetap `status:"new"`
  → dicoba lagi tick berikutnya, tanpa korupsi state).

### 3. Wiring boot: `server/src/server.ts`

`registerTriaseSource()` dipanggil **sekali** tepat setelah `registerErrorsSource()` dan sebelum
`startScheduler()`. `app.ts` tetap **bebas-timer & bebas-registrasi** (test mengisi registry sendiri).

## Idempotensi (invarian utama)

| Kondisi tiket | Mengapa tak dobel-accept / dobel-jalan |
|---|---|
| Sudah `accepted` (specId set) | Query `status:"new"` ∧ `specId:null` → tak ikut. |
| Sudah `rejected` | Query `status:"new"` → tak ikut. |
| Kategori `pertanyaan`/`lainnya` | Query `category: { in:["bug","fitur"] }` → tak ikut (tetap manual). |
| Baru di-accept window ini | Accept mem-flip `status:"accepted"`+`specId` → tick berikutnya tak match. |
| `checkTriase()` dua kali satu tick/lintas-tick | Di atas berlaku + `enqueue` upsert `specId @unique` → 1 baris antrean per spec. |
| Sesi spec sudah hidup (di-Start manual) | Governor `isLive` menandai `launched` tanpa spawn kedua (di luar scope leaf). |

## Data flow

```
engine.tick (enabled & triase due)
  └─ checkTriase()
       ├─ query (opt-in ∧ new ∧ category∈{bug,fitur} ∧ specId=null)
       └─ per tiket: acceptTicket → Spec(source per kategori) + link  →  enqueue(source="triase")  [SchedulerQueueItem]
governor.drain (cap, tak-Pause)   ← sudah ada (SPEC-294), di luar scope leaf
  └─ queued() → startSpecSession(flow = flowForSource(spec.source))
GET /api/scheduler/state → { queue: SchedulerQueueItem[] }   ← surface curl
```

## Error handling

- Query gagal (DB kedip) → exception naik ke `engine.tick` yang membungkus tiap `check()` (`try/catch`).
- Accept satu tiket gagal (project tak ter-bind) → **per-tiket try/catch** di `checkTriase`; tiket lain lanjut.
  Tiket gagal tetap `status:"new"` → dicoba lagi tick berikutnya. Tanpa retry paksa (konsisten PRD non-goal).

## Testing

**Unit** (`server/test/scheduler-source-triase.test.ts`, pola `scheduler-source-errors.test.ts`):
1. Meng-accept + enqueue hanya tiket eligible (new ∧ kategori bug/fitur ∧ opt-in); item antrean
   `source:"triase"`, `priority:"sedang"`, `status:"queued"`; tiket jadi `accepted` + `specId` terisi.
2. Pemetaan kategori→source (SPEC-291): tiket `bug` → Spec `source:"qa"`; tiket `fitur` → Spec `source:"brief"`.
3. Menyaring kategori non-actionable: tiket `pertanyaan`/`lainnya` **tak pernah** di-accept (tetap `new`).
4. Melewati project non-opt-in.
5. Idempoten tiket: tiket `status:"accepted"`/ber-specId/`rejected` **tak** disentuh; `checkTriase()` dua
   kali → tiap tiket accepted sekali, satu baris antrean per spec.
6. Banyak tiket satu window: N tiket eligible → N accepted + N baris antrean (tanpa limit checker).
7. `registerTriaseSource()` mendaftarkan source id `"triase"`.

**Regresi**: `tickets.route.test.ts` (kontrak HTTP accept: 201/200 alreadyPromoted/404 + payload per kategori)
tetap hijau setelah ekstraksi.

**Curl smoke** (boot server ke DB throwaway ter-migrate, bukan `hanoman_test`):
- Seed: project A `schedulerOptIn=true` + tiket eligible (`new`, kategori `bug` & `fitur`) + tiket
  non-eligible (`pertanyaan`, `lainnya`, dan satu `accepted`); project B non-opt-in + tiket `new` bug.
- `PUT /api/scheduler/config { enabled:true, paused:true, sources.triase.enabled:true }` (Pause ⇒ enqueue
  teruji tanpa drain/launch nyata).
- Boot-pass engine menjalankan `checkTriase`.
- `GET /api/scheduler/state` → `queue` berisi tiket eligible project A (source `triase`, priority `sedang`);
  tiket `pertanyaan`/`lainnya`/`accepted` & project B **absen**. `GET /api/tickets/:id` tiket eligible →
  `status:"accepted"` + `specId`.

## Docs tersentuh (commit sama)

- `internal/docs/architecture/stack.md` — baris pipeline scheduler: tandai checker `triase` konkret (SPEC-297).
- `internal/docs/architecture/api-contract.md` §Scheduler — catat `triase` = checker ketiga; accept kini
  service `ticket-accept.ts` (dipakai route + scheduler), kontrak HTTP tak berubah. §Help Center — catat
  accept core diekstrak.
- `internal/docs/architecture/data-model.md` §SchedulerQueueItem — catat source `triase` kini diisi checker.

Tak ada doc/ADR/migration baru → index `README.md` tak berubah (doc-doc di atas sudah ter-link).
