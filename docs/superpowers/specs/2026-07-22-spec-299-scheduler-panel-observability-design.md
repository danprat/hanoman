# SPEC-299 — Panel Scheduler (observabilitas) + UI setelan & opt-in per project

> Status: done (implemented & committed 2026-07-22, a46cff1). Daun #6 (terakhir) dari breakdown PRD scheduler otonom.
> Sumber: `docs/prd/scheduler-auto-start-backlog-batch-errors-and-pick-triase.md` (§Observabilitas, §Setting,
> §Rem darurat, User Stories #6/#7/#8/#9). Fondasi: SPEC-294/ADR-0072. Daun lain: 295/296/297/298.

## Konteks

Fondasi scheduler (SPEC-294, ADR-0072) sudah menerbitkan **API read-only** yang lengkap tapi **belum
dikonsumsi UI mana pun**:

- `GET /api/scheduler/config` → blok `Scheduler` (enabled, paused, maxConcurrent, autonomy, sources.*).
- `PUT /api/scheduler/config` → ganti blok penuh (validasi `zScheduler`). Pause = `{ ...cfg, paused: true }`.
- `GET /api/scheduler/state` → `{ config, cap, liveCount, sources[], queue[], sessions[] }`:
  - `sources[]` = per source `{ id, enabled, everyMin, minCount?, lastRunAt, nextRunAt }` (observabilitas cadence).
  - `queue[]` = seluruh `SchedulerQueueItem` (status `queued|launched|done|failed`, `note`, `sessionId`, timestamps).
  - `sessions[]` = sesi tmux hidup asal-scheduler (`SessionInfo`: id, projectId, specId, flow, branch, `decision`, exited).

Opt-in per project sudah ada sebagai `Project.schedulerOptIn` (default `false`), di-`PATCH /projects/:id`
(field sudah di `zUpdateProject`, sudah dirambatkan ke `ProjectView.schedulerOptIn` via `project-view.ts`).
Tak masuk whitelist sync → tetap lokal per-instance (ADR-0072 §5).

**Yang hilang:** satu layar tempat operator melihat & mengatur semua ini. SPEC-299 mengisinya —
**murni konsumen**, tanpa perubahan skema/migration/ADR/endpoint baru.

## Keputusan desain

Bentuk produk hanoman = "instrument panel yang tenang" — Scheduler jadi satu screen di sidebar,
memuat datanya sendiri (self-poll, pola `ErrorsScreen`/`VpsScreen`), tak lewat `gate`.

### 1. Layer bersama (shared) — hanya aditif, tanpa perubahan bentuk respons
- `shared/src/api.ts`: tambah path `schedulerConfig = /api/scheduler/config`, `schedulerState = /api/scheduler/state`.
- `shared/src/dto.ts`: tipe view untuk respons `state` (mencerminkan yang sudah dikembalikan route apa adanya):
  - `zSchedulerSourceView` `{ id, enabled, everyMin, minCount?, lastRunAt: string|null, nextRunAt: string|null }`.
  - `zSchedulerSessionView` `{ id, projectId, specId, flow?, branch?, decision, exited }` (subset `SessionInfo`).
  - `zSchedulerState` `{ config: Scheduler, cap, liveCount, sources: [...], queue: SchedulerQueueItemView[], sessions: [...] }`.
  - `SchedulerQueueItemView` sudah ada (SPEC-294).

### 2. Client (`src/src/api/client.ts`)
- `getSchedulerConfig()` → `Scheduler`, `putSchedulerConfig(cfg)` → `Scheduler`, `getSchedulerState()` → `SchedulerStateView`.
- Perluas tipe body `updateProject` dengan `schedulerOptIn?: boolean` (route sudah menerima; hanya tipe klien yang kurang).

### 3. Screen baru `src/src/screens/SchedulerScreen.tsx` (self-poll 5s, `!document.hidden`)
Props: `{ projects: ProjectVM[]; backlog: Spec[]; onProjectChanged: (id)=>Promise; onToast; onGotoTerminal; onGotoBacklog }`.
`backlog` dipakai me-resolve judul spec dari `specId` (queue/sessions hanya bawa `specId`).

Tata letak (satu kolom, Card editorial):
1. **Bar kendali (rem darurat).** Badge status master (Aktif/Stop/Paused) + `cap` + `liveCount`.
   Tombol **Stop** (master `enabled=false`) / **Aktifkan** (`enabled=true`) + tombol **Pause/Lanjutkan**
   (`paused` toggle). Keduanya menulis via `putSchedulerConfig({ ...config, ... })` lalu reload.
2. **Status per source** (backlog/errors/triase): badge enable, cadence (`everyMin`), last-run, next-run,
   `minCount` (errors). Murni dari `state.sources`.
3. **Antrean** (`queue` status `queued`): judul spec, project, source, prioritas, waktu enqueue — urut prioritas lalu FIFO.
4. **Sesi berjalan** (`state.sessions`): judul spec, project, flow, indikator **menunggu keputusan**
   (`decision`), tombol "Buka terminal".
5. **Selesai + ringkasan** (`queue` status `done`, terbaru dulu): judul spec, source, branch `hanoman/<sessionId>`,
   tombol **"Buka review"** (deep-link `#spec=<specId>` → SpecDetail backlog tempat diff/ringkasan hidup).
   Ringkasan/diff otomatis TIDAK dirender ulang di panel — di-link ke Review yang sudah ada (ADR-0031/SPEC-171).
6. **Gagal + alasan** (`queue` status `failed`): judul spec, `note` (alasan, mis. "sesi berakhir sebelum done").

7. **Panel setelan** (Card, form lokal disemai dari `state.config`, tombol **Simpan** → `putSchedulerConfig`):
   master `enabled`, `paused`, `maxConcurrent` (angka ≥1), `autonomy` (select `full-control`/`butuh-keputusan`),
   per-source `enabled`+`everyMin`, errors `minCount`. Semua knob `zScheduler` tertulis.

8. **Opt-in per project** (Card, daftar `projects` + `Switch` per baris): toggle memanggil
   `api.updateProject(id, { schedulerOptIn })` → `onProjectChanged(id)` (pola helpEnabled: mutasi persist ke state App).

### 4. Navigasi & mounting
- `src/src/ds/shell.tsx`: entri nav `{ key: "scheduler", label: "Scheduler", icon: "calendar-clock" }`
  (disisipkan sesudah "triage", sebelum "terminal").
- `src/src/App.tsx`: cabang `section === "scheduler"` me-mount `<SchedulerScreen>` (pola VpsScreen — tak lewat `gate`),
  mengoper `projectsView`, `backlog`, `refreshProject`, `showToast`, `setSection` untuk deep-link/goto.

## Non-goals (SPEC-299)
- Tidak mengubah logika engine/governor/reconcile/checker (daun 294–298) — hanya membaca API-nya.
- Tidak menambah endpoint, skema, migration, atau ADR. `GET /api/scheduler/state` dipakai apa adanya.
- Tidak me-render diff/ringkasan di panel — di-link ke Review (deep-link backlog) yang sudah ada.
- Tidak memindah opt-in ke ProjectDetailScreen; satu tempat kendali di Scheduler screen (operator lihat semua project sekaligus).
- Tidak menyentuh sync (opt-in tetap lokal via whitelist FIELDS SPEC-294).

## Testing
- Unit (frontend, RTL, `env -u NODE_ENV`): render SchedulerScreen dari state palsu → assert tiap section
  (sources/queue/running/done/failed) muncul; toggle Pause/Stop memanggil `putSchedulerConfig` payload benar;
  simpan setelan mengirim blok `zScheduler` lengkap; opt-in memanggil `updateProject`.
- Shared: `zSchedulerState.parse(sampleState)` sukses (kontrak view ⇄ route).
- Curl nyata (local, DB throwaway): `GET /api/scheduler/config|state`, `PUT /api/scheduler/config` (Pause on/off),
  `PATCH /projects/:id { schedulerOptIn:true }` → verifikasi `state`/`ProjectView` berubah.
- Bukti visual: screenshot panel (smoke browser CDP) sesudah seed satu queue item done + satu failed.

## Definition of done
Test hijau (`vitest run --no-file-parallelism`) · endpoint diuji curl nyata · docs tersentuh
(`api-contract.md` bila perlu, index) diperbarui + ter-link · diff bersih, siap push `hanoman/spec-299`.
