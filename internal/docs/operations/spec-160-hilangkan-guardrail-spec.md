# SPEC-160 — Spec: hilangkan guardrail Source of Truth

**Fase:** Spec (dikunci) · 2026-07-10
**Jenis:** QA — alur audit → keputusan → **spec** → plan → execute
**Source of Truth:** `internal/docs/**` — dokumen ini subordinat terhadapnya.
**Hulu:** [audit SPEC-160](spec-160-hilangkan-guardrail-audit.md) · keputusan manusia **remove-mechanism**
(via `.hanoman-ask.json`).
**Turunan:** plan → [`docs/superpowers/plans/2026-07-10-hanoman-hilangkan-guardrail-spec-160.md`](../../../docs/superpowers/plans/2026-07-10-hanoman-hilangkan-guardrail-spec-160.md).

> **Keputusan jalur (ADR-0020).** Audit menulis `.hanoman-decision.json` = `spec`: perbaikan
> menyentuh CLI/server/runner/shared/UI di banyak berkas, membalik ADR-0001, dan menuntut ADR baru
> + update `CLAUDE.md`. Tidak memenuhi syarat jalur `execute`.

## Masalah

Guardrail **Source of Truth** memaksa setiap run melewati `hanoman docs verify` sebelum fase
Execute, dan menahan setiap sesi `claude` lewat Stop hook. Pemohon (severity `major`): hanoman
tidak perlu ikut campur dengan hooks tambahan — *"cukup gunakan hooks yang ada pada project nya
dan pastikan tidak ada lagi guardrail yang jadi block apalagi ke failed"*. Manusia memilih
**menghapus mekanismenya**, bukan sekadar mematikan default (audit menawarkan empat opsi).

Guardrail itu punya **empat titik penegak** yang semuanya harus dicabut agar tidak ada lagi
blokir/kegagalan berbasis docs:

1. **Gate Execute** — `runner/src/run.ts:158-169` memanggil `deps.verify(worktree)` sebelum fase
   `Execute`; hasil `blocked`/`error` menjatuhkan run ke `status: "failed"` (`plan diblok · …`
   atau `guardrail tool error · …`). **Inilah yang menggagalkan run.**
2. **Subprocess `docs verify`** — `server/src/runner/deps.ts` (`verifyViaCli` → `spawnSync node
   … docs verify --block-if-stale --json`), plus klasifikasi crash (ADR-0009) dan plumbing
   switch dashboard lewat env (`guardEnv`, `depsWithGuard`).
3. **Stop hook** — `.claude/settings.json` mendaftarkan `hanoman hook stop`
   (`cli/src/commands/hook-stop.ts`), yang membalas `{"decision":"block"}` agar sesi agen tak
   boleh berhenti selama docs "stale".
4. **Verify in-process CLI** — `cli/src/commands/_deps.ts` (`hanoman execute` lokal) memanggil
   `collectViolations` langsung.

Semuanya bermuara ke `collectViolations` (`cli/src/verify.ts`), yang **menggabungkan dua hal
berbeda**: perhitungan `coverage`/`cats` (dipakai laporan read-only) dan array `violations`
(guardrail). Hanya `violations` yang dicabut.

## Objective (dikunci)

**Hapus mekanisme guardrail Source of Truth** — gate Execute, subprocess `docs verify`, Stop
hook, verify in-process, switch dashboard, dan konfigurasinya — sehingga **tidak ada run yang
bisa diblok atau digagalkan karena keadaan docs**, dan hanoman tidak menyuntik hook `Stop`
tambahan ke sesi mana pun. Docs `internal/docs/**` tetap ada sebagai **konvensi**, bukan gerbang
yang ditegakkan mesin.

## Keputusan desain yang dikunci

### 1. Batas: guardrail = yang **memblokir/menggagalkan**. Read-only tetap hidup.

Yang **dicabut** (memblokir/menggagalkan berbasis docs): gate Execute, `docs verify`, Stop hook,
verify in-process, switch `blockStale`/`requireLinks`, config knob, plumbing env.

Yang **dipertahankan** (tidak memblokir apa pun — di luar makna "guardrail"):

- **Tampilan coverage/docStatus dashboard** — `server/src/services/scan.ts` (`scanRepoDocs`)
  menghitungnya sendiri lewat `@hanoman/shared` (`coverageOf`, `linkedSetFrom`), **tanpa**
  menyentuh `collectViolations`. Tak tersentuh. Coverage adalah nilai turunan (ADR-0018), bukan
  gerbang.
- **`hanoman docs scan`** — laporan coverage + per-kategori, selalu `exit 0`. Bukan guardrail
  (help-nya sendiri membedakan: `docs verify … run the SoT guardrail` vs `docs scan … coverage
  + per-category report`). Dipertahankan; sumbernya (`collectViolations`) dipangkas jadi
  coverage-only.
- **`hanoman docs index` / `docs link`** — perkakas integritas index, read/fix. Tak tersentuh.

### 2. Guardrail deny tool-call (`runner/src/safety.ts`) **di luar scope** — tetap ada.

`deniesDangerous`/`GUARD_DENY_REASON` (PreToolUse hook: menolak `rm -rf`, `git push … main`,
`git worktree add`) berbagi kata "guardrail" tapi **bukan** Source of Truth. Opsi yang dipilih
manusia hanya menyebut "gate docs-verify". Menurut ADR-0010 ini **satu-satunya gerbang izin
yang tersisa** untuk run headless (`--dangerously-skip-permissions`). Mencabutnya = run tanpa
gerbang izin sama sekali. **Tidak disentuh.** `resolveCliEntry`/`guardCommand`
(`server/src/runner/deps.ts`) yang menyusun perintah hook PreToolUse **wajib dipertahankan**.

### 3. Tidak ada perubahan skema database.

`Setting` disimpan sebagai **JSON** (`model Setting { id Int; data Json }`,
`server/prisma/schema.prisma:85`), bukan kolom. Menghapus `blockStale`/`requireLinks` dari
`zSetting` **tidak** menyentuh skema → **tanpa migration**. Baris `Setting` lama yang masih
menyimpan kedua kunci itu di JSON tetap sah: `zSetting.safeParse` (default zod) membuang kunci
tak dikenal; body PUT tanpa kedua kunci itu juga sah. Selaras CLAUDE.md ("jangan ubah skema
tanpa migration + ADR") — tak ada kolom yang berubah.

### 4. Perubahan kontrak API `/settings` minor, ditanggung ADR baru.

`GET`/`PUT /settings` kehilangan dua field boolean (`blockStale`, `requireLinks`). Satu-satunya
klien adalah dashboard sendiri, diubah dalam commit yang sama. ADR baru (butir 5) mencatatnya;
tak perlu ask terpisah — keputusan `remove-mechanism` sudah mencakupnya.

### 5. ADR baru men-supersede ADR-0001; `CLAUDE.md` diperbarui.

CLAUDE.md menuntut ADR untuk perubahan sekelas ini, dan larangan eksplisitnya
(*"Jangan bypass Stop hook / guardrail Source of Truth"*) **bertentangan langsung** dengan
objective ini. Fase Execute **wajib**:

- Menulis **ADR-0023** (nomor tentatif — **enumerasi ulang** atas `refs/*` **dan** direktori
  `.worktrees/*` saat Execute, preseden ADR-0020) berjudul kira-kira *"Guardrail Source of Truth
  dicabut"*, yang: menyatakan `Status: diterima · supersedes ADR-0001`; mencatat bahwa ADR-0009
  (crash fails loud) dan konsekuensi gate di ADR-0008/0020/0022 menjadi **historis**; dan
  mencantumkan keputusan manusia sebagai pemicunya.
- Menandai `internal/docs/adr/0001-docs-as-source-of-truth.md` **Status: superseded oleh
  ADR-0023**.
- Mengganti klausa `CLAUDE.md` root dari larangan bypass menjadi pernyataan bahwa guardrail SoT
  telah dicabut (docs = konvensi, bukan gate). Klausa "Jangan ubah skema tanpa migration + ADR"
  dan "Jangan jalankan run di working tree utama" **tetap**.

ADR ditulis di Execute (bukan di sini) mengikuti preseden ADR-0020 — nomornya baru pasti setelah
enumerasi ulang, dan doc-of-record menyertai commit kode.

## Kriteria penerimaan (EARS)

- WHEN sebuah run mencapai fase `Execute`, THE SYSTEM SHALL langsung menjalankan fase itu **tanpa**
  verifikasi Source of Truth apa pun, dan SHALL NOT menjatuhkan run ke `failed` karena docs
  stale, coverage, atau doc tak ter-link.
- WHEN docs acuan sebuah run **stale atau tak ter-link** saat Execute, THE SYSTEM SHALL tetap
  menyelesaikan run seperti biasa (tidak ada `plan diblok`).
- WHEN sesi `claude` yang di-spawn mengakhiri giliran, THE SYSTEM SHALL NOT memblokirnya lewat
  Stop hook milik hanoman.
- WHEN `hanoman docs verify` atau `hanoman hook stop` dipanggil, THE SYSTEM SHALL menjawab
  *unknown command* (`exit 1`) — perintahnya tidak ada lagi.
- THE SYSTEM SHALL tetap menghitung dan menampilkan coverage/docStatus project di dashboard, dan
  `hanoman docs scan` SHALL tetap melaporkan coverage (`exit 0`).
- THE SYSTEM SHALL tetap menolak `rm -rf`, `git push … main`, dan `git worktree add` lewat
  PreToolUse hook (`safety.ts`) — tak berubah.
- WHEN operator membuka Settings, THE SYSTEM SHALL tidak lagi menampilkan switch "Blok plan saat
  docs stale" maupun "Wajib link setiap doc".
- IF body `PUT /settings` tidak memuat `blockStale`/`requireLinks`, THEN THE SYSTEM SHALL
  menerimanya (`200`) — dan baris `Setting` lama yang masih memuatnya SHALL tetap terbaca.

## Perubahan yang diminta

**Runner (gate) — inti:**

1. **`runner/src/run.ts`** — hapus field `verify` dari tipe `RunDeps` (`:10`) dan **seluruh blok
   gate Execute** (`:158-169`). Cabang `if (phase === "Execute")` lenyap; Execute lanjut ke
   `runPhase` seperti fase lain.

**Server:**

2. **`server/src/runner/deps.ts`** — hapus `VerifyResult`, `classifyVerify`, `retryOnCrash`,
   tipe `Guard`, `guardEnv`, `verifyViaCli`, `depsWithGuard`, dan field `verify` dari `prodDeps`.
   **Pertahankan** `repoRootFrom`, `resolveCliEntry`, `guardCommand`, dan `prodDeps`
   (`openSession` + `git`) — dipakai hook PreToolUse (Keputusan 2). Buang import yang jadi mati
   (`spawnSync`); simpan yang masih dipakai `resolveCliEntry` (`existsSync`, `dirname`, `join`).
3. **`server/src/worker.ts`** — `runProcessor` default `deps` kembali ke `prodDeps`
   (`const d = deps ?? prodDeps`); hapus import `depsWithGuard` dan `getSetting` (dipakai hanya
   untuk guard; `maxConcurrent` dan lainnya tetap). Hapus komentar "Guardrail Source of Truth
   dijalankan sebagai subprocess…".
4. **`server/src/services/settings.ts`** — hapus `blockStale`, `requireLinks` dari
   `DEFAULT_SETTING`.

**CLI:**

5. **`cli/src/commands/docs-verify.ts`** — **hapus berkas**.
6. **`cli/src/commands/hook-stop.ts`** — **hapus berkas**.
7. **`cli/src/commands/_deps.ts`** — hapus field `verify` dan import `collectViolations`.
   `RunDeps` tak lagi punya `verify` (butir 1).
8. **`cli/src/router.ts`** — hapus dispatch `docs verify` (`:31`) dan `hook stop` (`:35`); hapus
   dua baris HELP (`:14` docs verify, `:18` hook stop). **Pertahankan** `docs scan`, `docs
   index`, `docs link`, `hook pretooluse`.
9. **`cli/src/verify.ts`** — pangkas jadi coverage-only. `collectViolations` → `scanCoverage(cwd):
   { coverage, cats }`: buang array `violations`, pemakaian `loadConfig`-knob (`cfg.requireLinks`
   dst.), import `changedPaths`/`freshnessViolation`, dan fungsi `formatText`/`formatJson`
   (keduanya khusus verify). Pertahankan cabang "tak ada docsDir → coverage 100". Cabang "index
   hilang → throw" (fail-loud, khusus guardrail ADR-0009) **diganti** menjadi laporan jujur
   (index kosong → semua unlinked → coverage 0), karena `docs scan` bukan gerbang.
10. **`cli/src/commands/docs-scan.ts`** — sesuaikan import ke `scanCoverage`; sisanya (`r.cats`,
    `r.coverage`) tetap.
11. **`cli/src/config.ts`** — `loadConfig` menyisakan hanya pembacaan `docsDir` dari
    `hanoman.config.json`; hapus logika override env (`bool`/`int`/`HANOMAN_*`) dan parameter
    `env`.
12. **`cli/src/git.ts`** — `changedPaths` + `freshnessViolation` menjadi mati (hanya `verify.ts`
    pemakainya). **Hapus berkas** setelah butir 9. (Verifikasi tak ada import `./git` lain di
    `cli/src`.)

**Shared:**

13. **`shared/src/config.ts`** — `zHanomanConfig` menyisakan `docsDir` saja; hapus `requireLinks`,
    `blockStale`, `coverageThreshold`. (`docsDir` tetap dipakai `resolveRepo` dan
    `server/services/scan.ts`.)
14. **`shared/src/entities.ts`** — `zSetting` (`:61-69`) hapus `blockStale`, `requireLinks`.

**Frontend:**

15. **`src/src/screens/SettingsScreen.tsx`** — hapus Card `eyebrow="guardrails"` title "Source of
    Truth" (`:115-128`); pindahkan toggle **Auto-scaffold** (`autoScaffold`, bukan guardrail) ke
    Card "Umum" (`:81-86`). Hapus `blockStale`/`requireLinks` dari `S_DEFAULTS` (`:32`). Betulkan
    desc `notifyFail` (`:143`) — buang "plan diblok atau", sisakan "execute gagal".

**Config:**

16. **`.claude/settings.json`** — **hapus berkas** (isinya hanya Stop hook; PreToolUse hook
    disuntik inline lewat `--settings` di `runner/src/claude-cli.ts`, bukan dari berkas ini).

## Test

**Hapus** (perintah/fungsi lenyap):
- `cli/test/docs-verify.cmd.test.ts`
- `cli/test/hook-stop.cmd.test.ts`
- `server/test/verify-classify.test.ts`

**Tulis ulang / pangkas:**
- `cli/test/verify.test.ts` → uji `scanCoverage`: coverage 100 saat semua ter-link, coverage < 100
  saat ada unlinked, dan "tak ada docsDir → coverage 100". Buang kasus `violations`/`freshness`/
  `coverage-threshold`/`throw index`.
- `cli/test/config.test.ts` → buang kasus override env; sisakan (bila ada) default `docsDir`.
- `runner/test/run.test.ts` → hapus dua kasus gate (`:99` blocked, `:106` crash) dan asersi
  "Execute lewat gate / `verify` dipanggil sekali" (`:287-294`); `fakeDeps` (`:33-41`) buang
  field `verify`.

**Tambah** (gagal bila guardrail kembali):
- `runner/test/run.test.ts` — kasus: run yang docs-nya "stale/unlinked" **tetap** menyelesaikan
  Execute tanpa event `failed`/`plan diblok` (menegaskan gate benar-benar tiada).
- `cli/test/router.test.ts` (atau berkas router yang ada) — `hanoman docs verify` dan `hanoman
  hook stop` → `exit 1` unknown command; `hanoman docs scan` masih `exit 0`.
- `server/test` (settings route/round-trip) — `PUT /settings` tanpa `blockStale`/`requireLinks`
  → `200`; muat baris lama yang masih memuatnya → terbaca tanpa error.

**Pertahankan tanpa ubah:**
- `runner/test/claude-cli.test.ts` — "registers the guardrail hook" menguji **PreToolUse**
  (`safety.ts`), di luar scope.
- `server/test/runs-queue-integration.test.ts` — komentar "ADR-0012: no spend guardrail" tak
  berhubungan.

## Batas scope

- **Termasuk:** enam belas butir "Perubahan yang diminta" + test di atas + docs Execute di bawah.
- **Tidak termasuk:**
  - **PreToolUse deny (`safety.ts`).** Keputusan 2 — gerbang izin terakhir run headless.
  - **Tampilan coverage/docStatus & `docs scan`.** Keputusan 1 — read-only, bukan gerbang.
  - **Perintah `docs index`/`docs link`.** Perkakas integritas, tak memblokir run.
  - **Skema database.** Keputusan 3 — `Setting` adalah JSON, tak ada migration.
  - **Menghapus `hanoman.config.json` sepenuhnya / hardcode `docsDir`.** `docsDir` masih dibaca
    `resolveRepo` dan `server/services/scan.ts`; menyisakan satu field konfigurasi lebih murah
    daripada memindahkan pembacaannya.

## Perangkap yang tercatat

- **`collectViolations` menggabungkan coverage (display) dan violations (guardrail).** Memangkasnya
  keliru bisa mematikan coverage dashboard. Aman karena dashboard memakai `scanRepoDocs` yang
  terpisah (Keputusan 1); yang dipangkas hanya bagian `violations`.
- **`resolveCliEntry`/`guardCommand` tampak bagian guardrail SoT, padahal menyusun perintah hook
  PreToolUse.** Menghapusnya mematikan gerbang `safety.ts`. Dipertahankan (butir 2).
- **Baris `Setting` lama menyimpan `blockStale`/`requireLinks` di JSON.** Bukan bug: zod membuang
  kunci tak dikenal; ditegaskan test round-trip.
- **`.claude/settings.json` bukan tempat hook PreToolUse.** Menghapus berkas ini hanya mencabut
  Stop hook; deny berbahaya tetap jalan (inline `--settings`).
- **Nomor ADR bisa bentrok dengan worktree lain.** Enumerasi ulang saat Execute (ADR-0020).

## Docs yang menyusul (fase Execute)

Menyertai commit kode, bukan commit spec ini (mendokumentasikan mekanisme yang sudah dicabut akan
membuat Source of Truth berbohong — dan tanpa gate, satu-satunya penjaga konsistensi docs kini
adalah disiplin, jadi justru harus rapi):

- **ADR-0023** (baru, nomor tentatif) — "Guardrail Source of Truth dicabut", supersedes ADR-0001
  (Keputusan 5).
- `internal/docs/adr/0001-docs-as-source-of-truth.md` — `Status: superseded oleh ADR-0023`.
- `CLAUDE.md` (root) — ganti klausa larangan bypass; simpan larangan skema & working-tree utama.
- `internal/docs/operations/agent-documentation-workflow.md` — hapus penegakan di bagian
  "## Guardrail (SPEC-002)"; docs jadi konvensi. Betulkan baris "Stop hook memblokir…" dan
  "Fase Execute lewat gate `hanoman docs verify`".
- `internal/docs/architecture/api-contract.md` — body `/settings` tanpa `blockStale`/`requireLinks`.
- `internal/docs/architecture/stack.md`, `data-model.md`, `entrypoints/prd.md`,
  `requirements/prd.md` — hapus/ubah kalimat yang menyebut guardrail SoT sebagai gate.
- `internal/docs/README.md` — link ADR-0023 dan spec ini.

## Prinsip yang dipegang

- **Guardrail = yang memblokir/menggagalkan; laporan bukan gerbang.** Coverage tetap terlihat,
  tak ada yang berhenti karenanya.
- **Cabut mekanisme, bukan cuma default.** Manusia menolak "matikan default" — perintah, hook,
  gate, dan switch-nya benar-benar hilang, bukan disembunyikan.
- **Dua "guardrail" tak sama.** Deny tool-call berbahaya tetap; hanya penegak Source of Truth
  yang dicabut.
- **Doc-of-record menyertai kode.** ADR yang membalik ADR-0001 dan `CLAUDE.md` yang bertentangan
  diperbaiki di commit yang sama — bukan ditinggal kontradiktif.
- **Tes yang gagal kalau guardrail kembali** — Execute yang lolos meski docs "stale", perintah
  yang jadi unknown.

> Chiranjivi — spec bertahan lebih lama dari satu run. Plan turunannya tunduk pada pernyataan ini.
