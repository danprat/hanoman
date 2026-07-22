# Design — SPEC-294 · Fondasi scheduler otonom

> Sumber: PRD `docs/prd/scheduler-auto-start-backlog-batch-errors-and-pick-triase.md`
> + manifest breakdown `…breakdown.md` (backlog #1 dari 6). Backlog fondasi = **satu-satunya
> pembawa migration + ADR**; lima daun (source-checker backlog/errors/triase, autonomy/akhir-sesi,
> panel UI) menggantung pada kontrak yang diterbitkan dokumen ini secara aditif.

## Tujuan (objective)

Substrat yang mengatur **kapan** dan **berapa**, bukan **apa**:

- Engine sweep **in-process** bergaya `vps-monitor.ts` — di-`start` dari `server.ts` saja (timer
  `.unref()`), `app.ts` tetap **bebas-timer**.
- Tabel antrean **durable** (`SchedulerQueueItem`) yang bertahan **lintas-restart** API.
- **Governor concurrency**: cap = jumlah sesi hidup (manual + scheduler) dihitung dari
  `pty.listSessions()`; drain saat slot kosong dalam **≤1 tick** & saat sesi berakhir; tahan item
  saat cap penuh; urut prioritas; **idempoten satu-sesi-per-spec**.
- **Rem darurat Pause** (master switch) menghentikan peluncuran baru dalam **≤1 tick**.
- Skema **Setting** untuk semua knob + kolom `Project.schedulerOptIn` (default mati, pola
  `helpEnabled`) + endpoint **config/state** + kontrak `registerSchedulerSource` / `enqueue`.
- **Migration aditif; semua default mati.**

## Keputusan arsitektur (diringkas; detail di ADR-0072)

Fitur ini **membalik sebagian ADR-0024** (yang mencabut cron/queue/cap). Satu ADR baru —
**ADR-0072** — mencakup: (a) engine in-process, (b) antrean durable (tabel DB hanoman sendiri,
bukan broker eksternal), (c) cap concurrent (penerus `maxConcurrent` yang dulu dicabut), (d) knob
Setting + opt-in per project. Tetap **tanpa** worker/cron/broker eksternal.

### Open questions PRD yang diputuskan di sini

- **Bentuk cadence (Open Q#1):** **interval menit per source** (`everyMin`). HH:MM harian ditunda
  (bisa ditambah aditif kelak). Minimal, cocok pola `vps-monitor`.
- **Model data antrean (Open Q#3):** tabel `SchedulerQueueItem` ber-**`specId @unique`**. Unit
  peluncuran SELALU sebuah `Spec` (backlog sudah Spec; errors→escalate & triase→accept membuat
  Spec lebih dulu), jadi antrean tak menduplikasi `Spec.stage`/overlay sesi live — ia hanya
  menahan *pointer* + status antrean. State live (running/done/failed) diturunkan dari
  `pty.listSessions()` + `Spec.stage` + `Notification`, **bukan** dari kolom antrean.
- **Definisi "produksi" & ambang (Open Q#4):** knob `sources.errors.minCount` (default **5**) +
  filter `environment` — detail seleksi milik daun Errors (backlog #3); fondasi hanya menyimpan
  knob-nya.
- **Prasyarat project belum siap (Open Q#7):** saat drain, bila `resolveRepoDir` gagal → item
  ditandai `failed` + `note`, **tidak** menahan slot (skip). Fondasi tak menerbitkan Notification
  gagal (itu milik daun #5); ia hanya menandai baris.
- **Cakupan sync (Open Q#10):** **lokal per-instance.** `SchedulerQueueItem` LOCAL-ONLY (tak
  disync, cermin `SyncOutbox`/`RuntimeConfig`); `Project.schedulerOptIn` **tak masuk** whitelist
  `FIELDS` sync (cermin `helpEnabled`/`ingestKeyHash`), jadi tetap lokal.

## Data model (migration aditif — `2026072202_spec294_scheduler_foundation`)

### `SchedulerQueueItem` (LOCAL-ONLY, tak disync)

| kolom | tipe | catatan |
|---|---|---|
| `id` | String @id @default(cuid) | |
| `specId` | String **@unique** | unit peluncuran; dedup satu-sesi-per-spec |
| `projectId` | String | isolasi/tampilan (tanpa FK — cermin `SyncOutbox`) |
| `source` | String | `backlog` \| `errors` \| `triase` (asal checker) |
| `priority` | String | `tinggi` \| `sedang` \| `rendah` (urutan drain) |
| `status` | String @default("queued") | `queued` \| `launched` \| `done` \| `failed` |
| `sessionId` | String? | id sesi tmux saat diluncurkan |
| `note` | String? | alasan gagal (diisi daun #5) |
| `enqueuedAt` | DateTime @default(now) | FIFO dalam prioritas sama |
| `launchedAt` | DateTime? | |

`@@index([status])`. Tak ada `version`/`updatedAt` sync → murni operasional lokal.

### `Project.schedulerOptIn`

`Boolean @default(false)` — gerbang kelayakan semua source (pola `helpEnabled`). Aditif; diekspos
di `toProjectView` sebagai `schedulerOptIn`. **Tidak** ditambahkan ke `FIELDS` sync → lokal.

## Skema Setting (`zSetting.scheduler`) — semua default MATI

```ts
scheduler: {
  enabled: boolean = false,          // master subsystem switch (semua idle bila false)
  paused: boolean = false,           // rem darurat: blokir drain (peluncuran) ≤1 tick
  maxConcurrent: number = 2,         // cap sesi hidup (≥1)
  autonomy: "full-control" | "butuh-keputusan" = "butuh-keputusan",  // dikonsumsi daun #5
  sources: {
    backlog: { enabled: false, everyMin: 15 },
    errors:  { enabled: false, everyMin: 15, minCount: 5 },
    triase:  { enabled: false, everyMin: 30 },
  }
}
```

Ditambahkan sebagai `zScheduler.default(SCHEDULER_DEFAULTS)` di `zSetting` → baris `Setting`
lama tanpa blok `scheduler` tetap parse (key hilang diisi default). `DEFAULT_SETTING` (server)
memuat `SCHEDULER_DEFAULTS` juga.

## Engine (`server/src/services/scheduler/`)

Modul kecil ber-tanggung-jawab tunggal, dep di-inject agar teruji tanpa tmux/claude nyata:

- **`config.ts`** — `getScheduler()` / `setScheduler(partial)` (baca-tulis blok `Setting.data.scheduler`,
  merge, tak clobber field Setting lain).
- **`queue.ts`** — `enqueue({specId,projectId,source,priority})` (idempoten via `specId @unique`,
  upsert no-op bila sudah ada), `listQueue(status?)`, `markLaunched(id, sessionId)`,
  `markDone/markFailed(id, note?)`, `queueItemForSpec(specId)`, `schedulerItemForSession(sessionId)`.
- **`registry.ts`** — `registerSchedulerSource({id, check})`, `listSources()`, `clearSources()`
  (test), + jam `lastRun: Map<id, epoch>` in-memory (reset saat boot → boot-pass, cermin vps-monitor).
- **`governor.ts`** — `drain(cfg, deps)`: hitung `slots = cap − deps.liveCount()`; ambil item
  `queued` terurut `[priorityRank, enqueuedAt]`; untuk tiap item selagi `slots > 0`: bila sesi
  spec sudah hidup → `markLaunched` tanpa makan slot (sudah terhitung live); selain itu
  `deps.launch(item)` → `markLaunched`, `slots--`; error launch → `markFailed`. Reentrancy-guard
  `draining`. **Invarian teruji: live tak pernah > cap.**
- **`engine.ts`** — `tick(now, deps)`:
  1. `cfg = getScheduler()`; bila `!cfg.enabled` → return (idle penuh).
  2. untuk tiap source terdaftar: bila `cfg.sources[id].enabled` **dan** due (`now − lastRun ≥
     everyMin·60000`) → `lastRun.set`; `await source.check()` (menghasilkan enqueue).
  3. bila `cfg.paused` → return **(Pause: tak ada drain → tak ada peluncuran baru)**.
  4. `await drain(cfg, deps)`.
  + `startScheduler()` (dipanggil `server.ts`): `setInterval(tick, TICK_MS).unref()` + boot-pass;
  `stopScheduler()` (test).

### Jalur peluncuran (refactor)

`startSpecSession(spec, {flow, model, effort})` di-ekstrak dari `routes/terminal.ts` ke
`services/session-launch.ts`: `resolveRepoDir` → bila sesi live → kembalikan → `addWorktree` +
set `baseSha` → `createSession(startPrompt/continuePrompt)`. **Satu jalur** dipakai POST manual &
governor. Governor menurunkan `flow` **server-side** via `flowForSource(spec.source)` (bukan dari
body HTTP). Error diketik (`needsBind` / worktree gagal) → governor `markFailed`.

### Marker "asal-scheduler" (kontrak daun #5)

Sesi = scheduler-launched ⟺ ada `SchedulerQueueItem` untuk `specId`-nya. Fondasi menerbitkan
`schedulerItemForSession(sessionId)` / `queueItemForSpec(specId)`; daun #5 memilih `AUTONOMY_CLAUSE`
& menandai done/fail lewatnya. Fondasi **tak** mengubah prompt (tetap `startPrompt` existing).

## API (`routes/scheduler.ts`, di belakang gate cookie)

- `GET /api/scheduler/config` → blok `scheduler` Setting.
- `PUT /api/scheduler/config` → `zSchedulerConfig` (partial deep-merge), persist, kembalikan blok
  penuh. **Pause = PUT `{ paused: true }`.**
- `GET /api/scheduler/state` → `{ config, cap, liveCount, sources:[{id,enabled,everyMin,minCount?,
  lastRunAt,nextRunAt}], queue: SchedulerQueueItemView[], sessions: [sesi live ber-item] }`.

Kapabilitas agent-token: `/api/scheduler/*` → domain **`settings`** (`agent-capabilities.ts`).
Register di `app.ts`; opt-in per project lewat `PATCH /projects/:id { schedulerOptIn }` (aditif ke
`zUpdateProject`, di-`enqueueOutbox` seperti field project lain — tapi tak menyeberang karena bukan
whitelist `FIELDS`).

## Testing (TDD)

- **queue**: durable across "restart" (baca ulang dari DB), idempoten `specId @unique`, urutan
  prioritas.
- **governor**: live tak pernah > cap; drain isi slot dalam satu panggilan; idempoten (sesi spec
  sudah hidup tak dobel-launch); item tertahan saat cap penuh; `markFailed` saat launch throw.
- **engine gating (source stub)**: source disabled → `check` tak dipanggil; enabled+due → dipanggil;
  belum due → dilewati; `enabled=false` master → idle; `paused` → checker boleh jalan tapi **drain
  tak meluncurkan** (Pause ≤1 tick).
- **route**: GET default (semua mati) ; PUT set knob & pause; GET state cerminkan antrean+cap.
- **project**: `schedulerOptIn` default false, PATCH toggle, tampil di view, tak masuk sync FIELDS.
- **migration nyata**: boot server + `curl` config/state + PATCH opt-in di local.

## Non-goals (milik daun lain / PRD)

Seleksi source konkret (backlog/errors/triase), autonomy-clause & Notification `fail`/`done`/
`decision`, ringkasan/diff akhir sesi, panel UI + tombol Pause visual, auto-merge/retry — **bukan**
fondasi. Fondasi hanya menerbitkan substrat + kontrak.
