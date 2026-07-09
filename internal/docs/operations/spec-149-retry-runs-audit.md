# SPEC-149 — audit: run yang `failed` tidak bisa di-retry

Fase **Audit** dari alur QA (audit → keputusan → (spec → plan)? → execute, SPEC-145/ADR-0020).
Dokumen ini menetapkan akar masalah dan batas perbaikannya. **Tidak ada perubahan kode di fase
ini.**

- Sumber: backlog qa · prioritas tinggi · severity `major`
- Gejala dilaporkan: run yang gagal (`failed`) tidak bisa di-retry. Expected: tombol retry pada
  run `failed` yang melanjutkan sesi yang sama, bukan mulai dari nol.

> **Catatan (fase Execute).** Dieksekusi persis sesuai rekomendasi di bawah, tanpa deviasi:
> `RunRetry` (`src/src/screens/RunsScreen.tsx`) merender satu tombol Retry untuk `run.status
> === "failed"`, memanggil `api.runControl(id, "retry")` — action yang sudah lengkap sejak
> sebelum tiket ini. Diverifikasi typecheck + test suite penuh + dua test baru; detail dan
> alasan tidak mengeklik retry sungguhan di server dev bersama ada di bagian Verifikasi.

## Akar masalah

`retry` **sudah** jadi first-class action di seluruh lapisan backend — bukan fitur yang belum
ada, melainkan satu tombol yang tidak pernah dirender:

- `zControlAction` (`shared/src/dto.ts:39`) sudah `z.enum(["pause","resume","stop","retry"])`.
- `applyControl` (`server/src/routes/runs.ts:78-91`) menangani `retry` identik dengan `resume`:
  keduanya memanggil `enqueueRun` dengan **runId yang sama**.
- `runProcessor` (`server/src/worker.ts:58-70`) membaca `Run.sessionId` dan fase yang sudah
  `done`/`skipped` dari baris DB yang sama, lalu meneruskannya sebagai `resume`/`donePhases` ke
  runner — sesi claude yang sama **dilanjutkan**, bukan dibuka ulang (ADR-0017: run terputus
  melanjutkan sesinya). Ini persis "retry untuk melanjukan session" yang diminta expected.
- `enqueueRun` (`server/src/queue.ts:53-58`) memakai `removeOnFail: false` dengan komentar
  eksplisit: *"a retry must be able to re-add it"* — jobId yang sama sengaja dipertahankan agar
  job yang gagal bisa di-retry.
- `api.runControl` (`src/src/api/client.ts:38-39`) sudah bertipe
  `"pause" | "resume" | "stop" | "retry"` dan memanggil `POST /runs/:id/control`.
- Bahkan terminal command-line run sudah menerima verb `retry` (`server/src/routes/runs.ts:240-242`,
  `KNOWN` set di `:23`).

Satu-satunya lubang: **UI tidak pernah memanggil `runControl(id, "retry")` untuk run `failed`.**
`RunDetail` (`src/src/screens/RunsScreen.tsx:369`) hanya merender `RunControls` — satu-satunya
tempat tombol pause/resume/stop hidup — ketika:

```ts
{(run.status === "running" || run.status === "paused") && <RunControls run={run} />}
```

Untuk `run.status === "failed"` predikat ini `false`, jadi **tidak ada blok kontrol sama sekali**
yang dirender — bukan tombol retry yang disabled, bukan pesan error, betul-betul tidak ada
afordansi. Operator yang ingin retry tidak punya apa pun untuk diklik, persis gejala yang
dilaporkan ("tidak bisa di retry"), meski endpoint di baliknya sudah bekerja penuh.

## Kenapa ini jalur `execute` (bukan `spec`)

Sesuai syarat jalur cepat (SPEC-145/ADR-0020): terlokalisasi, tanpa keputusan desain, tanpa
menyentuh skema/kontrak API.

- **Satu berkas.** Perbaikannya murni di `src/src/screens/RunsScreen.tsx`: lebarkan predikat
  render di baris 369 dan tambah satu tombol yang memanggil `ctl("retry")` — pola yang sama
  persis dengan `ctl("resume")`/`ctl("stop")` yang sudah ada di `RunControls` (`:309-322`).
- **Tanpa keputusan desain.** Tombol memakai komponen `Button` yang sama dengan
  pause/resume/stop di file yang sama; tidak ada komponen baru, tidak ada copy/pattern baru
  yang perlu dirancang.
- **Tanpa menyentuh skema/DB/kontrak API.** Action `retry`, endpoint, dan semantik re-enqueue-nya
  sudah ada end-to-end (`zControlAction`, route, worker, queue) — bagian ini justru sudah
  sengaja dibangun untuk kasus ini (lihat komentar `queue.ts:55`).
- **Bisa diselesaikan tanpa spec/plan.** Perbaikannya adalah "render kontrol saat `failed`, dan
  beri satu tombol yang manggil action yang sudah ada" — bukan pertanyaan terbuka.

## Rekomendasi untuk fase Execute

1. Di `src/src/screens/RunsScreen.tsx:369`, lebarkan kondisi render agar blok kontrol juga
   muncul untuk `run.status === "failed"`.
2. Untuk kasus `failed`, render hanya tombol **Retry** (`ctl("retry")` → `api.runControl(id,
   "retry")`) — bukan seluruh `RunControls` (input steer + pause/stop tidak relevan: tidak ada
   proses hidup untuk disteer/dihentikan pada run yang sudah `failed`, konsisten dengan gate
   `running|paused` yang sudah dipakai untuk pertanyaan "punya proses hidup?" di file yang sama,
   lihat SPEC-142 audit).
3. Cakupan mengikuti gejala yang dilaporkan: hanya `failed`. `stopped` (dihentikan manusia) tidak
   disebut di expected dan tidak disentuh di sini.
4. Verifikasi manual: `POST /runs/:id/control {"action":"retry"}` pada run `failed` mengembalikan
   `202` dan status baris berubah ke `queued`; klik tombol baru di UI memicu request yang sama.

## Verifikasi

Akar masalah dipastikan lewat pembacaan kode statis (`file:baris` dikutip di atas) di kelima
lapisan (`dto.ts`, `routes/runs.ts`, `worker.ts`, `queue.ts`, `api/client.ts`, `RunsScreen.tsx`) —
tidak ada satu pun yang hilang selain predikat render. Tidak ada reproduksi runtime pada fase
Audit: memicu run `failed` sungguhan berarti menjalankan agen nyata di background, efek samping
yang bukan milik fase Audit (lihat SPEC-142 audit, bagian Verifikasi, untuk preseden batas yang
sama).

**Fase Execute:** `pnpm --filter ./src typecheck` bersih; `pnpm test` (workspace penuh) hijau,
43/43 — termasuk dua test baru di `src/test/run-retry.test.tsx` yang me-render `RunsScreen`
dengan run `status:"failed"` sungguhan (bukan mock `RunRetry`), klik tombol **Retry**, dan
menegaskan `api.runControl("RUN-1","retry")` terpanggil; test kedua menegaskan run `running`
tidak menampilkan tombol itu. Tidak mengeklik retry sungguhan lewat server dev bersama yang
sedang hidup (worker/API di checkout utama, DB/Redis dipakai bersama semua worktree) — action
`retry` selalu berujung `enqueueRun` nyata, dan sesi yang menjalankan fase ini kemungkinan besar
adalah run hanoman itu sendiri (`cwd` = `.worktrees/run-90005`, detached HEAD, prompt fase persis
`phasePrompt`). Memicu run nyata dari dalam run yang sedang berjalan adalah persis insiden yang
sudah pernah terjadi (queue Redis dev dipakai bersama test/run nyata) — dihindari dengan sengaja,
bukan terlewat.

## Rujukan

- ADR-0020 — [fase perencanaan QA dipangkas oleh keputusan audit](../adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md):
  syarat jalur cepat yang audit ini penuhi.
- ADR-0017 — [run terputus melanjutkan sesinya](../adr/0017-run-terputus-melanjutkan-sesinya.md):
  kenapa `retry` melanjutkan sesi yang sama, bukan mulai baru.
- ADR-0015 — [satu backlog, satu sesi Claude](../adr/0015-one-session-per-backlog.md).
- [spec-142 — audit (status run tidak auto-update)](spec-142-runs-status-auto-update-audit.md):
  preseden bentuk dokumen audit + batas verifikasi statis untuk alur QA.
- [agent-documentation-workflow](agent-documentation-workflow.md): alur QA audit → spec → plan →
  execute.
