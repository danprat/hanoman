# ADR-0103 — Auto-merge saat sesi selesai: kebijakan per project/spec, dieksekusi sweep tanpa call site

**Status:** accepted · **Date:** 2026-08-01 · **Spec:** SPEC-486
**Terkait:** [ADR-0031](0031-rebase-merge-backlog.md) (rebase & merge dari dashboard — diperluas jadi kebijakan),
[ADR-0002](0002-git-worktree-isolation.md) (working tree utama tak pernah disentuh),
[ADR-0030](0030-spec-menyimpan-base-head-sha.md) (`headSha` = ujung kerja),
[ADR-0033](0033-notifikasi-backlog-selesai.md) (notifikasi `done:` — kini juga stempel waktu selesai),
[ADR-0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md) (pola `setInterval` in-process dari `server.ts`),
[ADR-0100](0100-webhook-keluar-peristiwa.md) (efek samping di satu choke point, bukan di call site)

## Context

Backlog item yang selesai meninggalkan branch kerja `hanoman/<spec>` di origin. ADR-0031 memberi
**tombol** untuk menggabungkannya (`POST /specs/:id/integrate`, merge/rebase ke `local:<b>` /
`origin:<b>` di worktree isolasi), tetapi tak pernah memberi **kebijakan**: setiap item harus
digabungkan dengan tangan, satu per satu, dan tak ada tempat di Settings project untuk menyatakan
"kalau selesai, langsung gabungkan ke sana". Operator yang menjalankan belasan backlog paralel
membayar itu berkali-kali.

Dua kendala mengikat desain pemicunya.

**(1) `stage = "done"` dipersist di TIGA jalur** — `services/live-specs.ts` (overlay stage-live,
untuk sesi yang di-Start manual), `services/scheduler/reconcile.ts` (sesi scheduler), dan
`DELETE /terminal/sessions/:id` → `advanceStage` (operator menutup sesi). Menempelkan efek samping
di ketiganya adalah kelas bug yang sudah digigit repo ini **empat kali** (SPEC-431 predikat
`baseSha IS NULL`, SPEC-448 `rootBypassEnv`, SPEC-475 `recordHeadSha`, SPEC-481 emit peristiwa):
efek samping tak punya tipe yang memaksanya konsisten.

**(2) Tak satu pun dari ketiganya aman sebagai pemicu.** Prompt sesi menyuruh agen menulis baris
fase terakhir **lebih dulu**, baru `commit` + `git push`. `liveSpecs` karena itu bisa memindahkan
stage ke `done` beberapa detik sebelum `hanoman/<spec>` ada di origin — auto-merge di sana akan
menggabungkan tip yang basi, atau gagal "branch belum ada" untuk pekerjaan yang sebenarnya baik-baik
saja.

## Decision

### Kebijakan: satu blok `Json?`, dua tempat, satu skema

`Project.autoMerge` (default project) dan `Spec.autoMerge` (override per item). Bentuknya
`Json?` — `null` = tanpa auto-merge di Project, = warisi project di Spec.

```
{ mode: "off" | "default-branch" | "branch", dest: "local" | "origin",
  branch: string | null, deleteBranch: boolean }
```

`shared/src/auto-merge.ts` memegang `zAutoMerge`, `autoMergeOf()` (baca kolom `Json` defensif —
bentuk rusak → `null`, bukan melempar), `resolveAutoMerge(project, spec)` (spec menang → project →
OFF), `autoMergeTargetOf()`, dan `autoMergeSummary()`. Fungsi murni, dipakai server **dan** UI, jadi
tak pernah ada dua definisi "kebijakan yang berlaku".

`dest` + `branch` memakai **kosakata yang sama** dengan `POST /specs/:id/integrate`
(`local:<b>` / `origin:<b>`): satu perbendaharaan untuk dua permukaan, dan dropdown branch memakai
`GET /projects/:id/branches` yang sudah memasok keduanya. Tujuan lokal vs origin adalah pilihan
operator — keputusan sadar saat brainstorm SPEC-486, karena keduanya sah dan konsekuensinya beda
(ref lokal bergerak vs hasil mendarat di remote).

**LOCAL-only**: tidak masuk `FIELDS.project` maupun `FIELDS.spec` di `services/sync.ts`, mengikuti
`repoDir` / `schedulerOptIn` / `leadOptIn`. Nama branch tujuan adalah properti checkout di mesin
ini, dan mesin yang menjalankan sesi adalah mesin yang mendaratkan hasilnya. Keduanya **masuk**
allowlist `WEBHOOK_ENTITIES` (bukan data sensitif; perubahan kebijakan layak terlihat penerima).

Gerbang tulis hidup di **satu** helper `services/auto-merge-gate.ts` yang dipakai kedua route:
tanpa repoDir efektif → **409**; mode `branch` tanpa branch atau dengan branch yang tak ada di
daftar `dest`-nya → **400** (prinsip SPEC-143/ADR-0032: daftar yang memasok dropdown adalah daftar
yang menjaga gerbang); mode `default-branch` tanpa default branch yang bisa diresolve → **400**.
`autoMerge` pada spec **sengaja di luar** gerbang `editingContent` (SPEC-186), sama seperti
`dependsOn` (ADR-0093) — ia menggerbangi apa yang terjadi *sesudah* kerja.

### Eksekusi: sweep periodik, NOL call site

`services/auto-merge.ts` → `sweepAutoMerge()`, di-`setInterval` (60 dtk) dari `server.ts` saja
(`app.ts` bebas-timer, ADR-0072). Ini menjawab kedua kendala sekaligus: tak ada efek samping yang
disalin ke tiga jalur, dan "belum siap" cukup dicoba lagi tick berikutnya.

**Kandidat** — `t0` = `Notification(key = "done:<specId>").createdAt`, baris yang ditulis
`recordCompletion` tepat pada transisi ke `done` di ketiga jalur; ia satu-satunya stempel "kapan
item ini selesai" yang sudah ada dan konsisten, jadi **tanpa tabel baru**. Sebuah spec kandidat
bila: kebijakan efektifnya `mode ≠ "off"`, `stage = "done"`, `t0` ada dan **≤ 24 jam**
(`AUTO_MERGE_WINDOW_MS`), dan belum ada `Notification(key = "automerge:<specId>")`.

**Kesiapan** — sumber `hanoman/<spec>` (origin dulu, lalu lokal) harus ada, dan bila `Spec.headSha`
diketahui ia harus sudah menjadi **leluhur** tip sumber (`merge-base --is-ancestor`) = bukti push
sudah mendarat. Belum siap dan `now − t0 ≤ 15 menit` (`AUTO_MERGE_GRACE_MS`) → lewati diam-diam,
coba lagi. Lewat grace → menyerah **dengan suara**.

**Hasil** — `integrate(repoDir, spec.id, "merge", target)`, jalur ADR-0031 apa adanya. `clean` →
(opsional) hapus branch kerja, lalu notifikasi sukses. `conflict` → **buang worktree
`merge-<spec>`** yang ditinggalkan `integrate`, notifikasi berisi alasan, branch kerja utuh.
`error` → notifikasi memuat pesan galat apa adanya. Ketiganya menulis satu `Notification` bertipe
`automerge` ber-`key` `automerge:<specId>` yang merangkap **laporan** dan **penanda idempotensi
durable** (pola `recordCompletion`; ADR-0091 sudah menetapkan idempotensi lewat jejak DB, bukan
`Set` memori).

Operasi terkunci ke **`merge`**. `rebase` tak pernah dipakai auto-merge — ia selalu force-push
branch sumber (ADR-0031), dan itu dilarang batasan spec. Branch kerja **tak pernah** dihapus
sebelum merge terbukti `clean`; penghapusan sesudahnya adalah knob `deleteBranch`, default mati.

## Alternatif ditolak

- **Hook di tiga jalur persist `done`.** Menyalin efek samping = kelas bug SPEC-431/448/475/481,
  dan tetap tak menyelesaikan balapan `git push` yang terjadi sesudah baris fase terakhir ditulis.
- **Melahirkan sesi agen penyelesai konflik otomatis** (seperti pintu konflik ADR-0031). Membakar
  kuota tanpa diminta, dan bukan yang diminta objective — yang diminta adalah *notifikasi berisi
  alasan* dengan branch kerja utuh. Operator masih bisa menekan Rebase / Merge dan mendapat jalur
  konflik ADR-0031 yang lengkap.
- **Tabel `AutoMergeAttempt` sendiri** untuk penanda. Menambah model = `PG_ORDER` + pertimbangan
  sync + migration, untuk sesuatu yang sudah bisa dipikul `Notification.key` yang memang unik.
- **Menyimpan kebijakan di `Setting` global.** Ia properti sebuah repo, bukan properti workspace;
  branch tujuan satu project tak berarti apa-apa di project lain.
- **Empat kolom skalar** alih-alih satu blok `Json`. Mengizinkan keadaan yang tak masuk akal
  (`mode:"off"` dengan `branch` terisi) tanpa satu pun tipe yang mencegahnya.
- **Retry berkala sesudah merge gagal.** Satu percobaan, lalu operator — konflik adalah pekerjaan
  penilaian (premis ADR-0031), dan mengulanginya tiap menit hanya menghasilkan notifikasi berulang.

## Consequences

- Project lama tak berubah perilaku: kolom lahir `null`, nol backfill, dan sweep tak menyentuh git
  sama sekali selama tak ada yang meng-opt-in.
- Satu baris notifikasi tambahan per backlog selesai **pada project yang meng-opt-in**. Diterima
  sadar: operator yang menyalakan auto-merge justru ingin tahu hasilnya mendarat di mana.

### Gotcha wajib

1. **`recordCompletion` idempoten** (key `done:<specId>`) → spec yang di-reopen lalu selesai lagi
   **tak** di-auto-merge ulang: `t0` tak lahir kedua kali dan penanda `automerge:` sudah ada.
   Cermin persis batasan ADR-0033. Jalur manual tetap terbuka.
2. **Window 24 jam adalah satu-satunya** yang mencegah "menyalakan setting = menggabungkan seluruh
   sejarah project". Jangan dilonggarkan tanpa memasang penanda lain lebih dulu.
3. **Kesiapan diukur dari `headSha ⊆ tip branch`**, bukan dari keberadaan branch saja — tanpa itu
   sweep bisa merge tip yang basi, persis balapan yang jadi alasan sweep ini ada.
4. **`integrate` MENINGGALKAN worktree konflik by design** (ADR-0031 mengharapkan sesi agen lahir
   di sana). Pemanggil yang tak melahirkan sesi WAJIB membuangnya sendiri —
   `discardMergeWorktree()`.
5. **`Prisma.DbNull`, bukan `null` polos**, untuk mengosongkan kolom `Json?` (kelas SPEC-480).
6. **Sweep dipasang dari `server.ts` saja** — `app.ts` bebas-timer, jadi test yang mem-`buildApp`
   tak menghidupkan pekerjaan latar.
7. **Default branch diresolve saat EKSEKUSI**, bukan dibekukan ke setting: repo yang mengganti
   default branch-nya tak boleh diam-diam terus di-merge ke branch lama. Dan jangan hardcode
   `"main"` (SPEC-227/ADR-0077) — `origin/HEAD` → main → master → **null**, karena merge ke branch
   yang salah tak bisa dibatalkan dari dashboard.
