# SPEC-160 — audit: "Hilangkan Guardrail"

Fase **Audit** dari alur QA (audit → keputusan → (spec → plan)? → execute, SPEC-145/ADR-0020).
Dokumen ini menetapkan akar masalah dan batas perbaikannya. **Tidak ada perubahan kode di fase
ini.**

- Sumber: backlog qa · prioritas tinggi · severity `major`
- Permintaan: "hilangkan semua guardrail Source of Truth, hanoman tidak perlu ikut campur
  masalah hooks tambahan. cukup gunakan hooks yang ada pada project nya dan pastikan tidak ada
  lagi guardrail yang jadi block apalagi ke failed." Tidak ada `env`/`steps`/`actual` yang
  dilampirkan — tidak ada run atau reproduksi konkret yang dirujuk.

> **Keputusan manusia (via `.hanoman-ask.json`).** Ditanyakan empat opsi (tutup tanpa perubahan,
> perjelas UX, default off tetap opt-in, atau hapus mekanisme). Manusia memilih **hapus
> mekanisme** — eksplisit menerima bahwa ini membalik ADR-0001/ADR-0022 dan menimpa larangan
> `CLAUDE.md`, dan bahwa itu perlu ADR baru. Cakupan yang disetujui: **gate docs-verify
> (Source of Truth) saja** — `cli/src/verify.ts`, `cli/src/commands/hook-stop.ts`,
> `cli/src/commands/docs-verify.ts`, `server/src/runner/deps.ts`, gate `runner/src/run.ts:158-169`,
> switch `SettingsScreen.tsx`. Opsi yang ditanyakan **tidak** menyebut `runner/src/safety.ts`
> (`deniesDangerous`/`GUARD_DENY_REASON`, penolak `rm -rf`/`git push … main`/`git worktree add`)
> — mekanisme itu tetap di luar cakupan tiket ini; lihat bagian "Dua mekanisme" di bawah untuk
> kenapa itu perlu tetap ada (ADR-0010: satu-satunya gerbang tersisa di run headless). Fase Spec
> wajib menulis ADR baru yang secara eksplisit men-supersede ADR-0001 dan konsekuensi ADR-0022
> yang relevan, dan memperbarui klausa "Jangan bypass Stop hook / guardrail Source of Truth" di
> `CLAUDE.md` root — dokumen yang menabrak tidak boleh dibiarkan kontradiktif.

## Dua mekanisme berbeda berbagi nama "guardrail"

Judul tiket ("Hilangkan Guardrail") lebih luas dari detailnya ("guardrail Source of Truth").
Codebase punya dua mekanisme independen dengan nama itu — penting dipisah karena cakupan
perbaikannya sangat berbeda:

1. **Guardrail Source of Truth** (ADR-0001, SPEC-002) — yang diminta detail tiket. Intinya
   `collectViolations` (`cli/src/verify.ts`), dipakai lewat dua jalur:
   - **Stop hook** Claude Code asli: `.claude/settings.json` mendaftarkan `hanoman hook stop`
     (`cli/src/commands/hook-stop.ts`) yang dipanggil binary `claude` sendiri tiap sesi mencoba
     mengakhiri giliran; balasan `{"decision":"block","reason":...}` membuat model melanjutkan,
     bukan menggagalkan run.
   - **Gate Execute eksplisit**: `runner/src/run.ts:158-169` memanggil `deps.verify(worktree)`
     tepat sebelum fase `Execute` — inilah yang benar-benar menjatuhkan run ke `status: "failed"`
     (`guardrail tool error · …` atau `plan diblok · …`). Di produksi ini `verifyViaCli`
     (`server/src/runner/deps.ts:62-69`), yang shell-out ke `hanoman docs verify --block-if-stale
     --json`.
2. **Guardrail deny tool-call** (`runner/src/safety.ts`, `GUARD_DENY_REASON = "ditolak oleh
   guardrail hanoman"`) — PreToolUse hook yang menolak `rm -rf`, `git push … main`, dan `git
   worktree add` di tool `Bash`. Tidak berhubungan dengan Source of Truth, tidak dikonfigurasi
   per-repo, dan menurut ADR-0010 adalah **satu-satunya gerbang yang tersisa** untuk run tak
   berpenunggu yang jalan dengan `--dangerously-skip-permissions`. Detail tiket tidak menyebut
   mekanisme ini; judulnya ("semua guardrail") bisa dibaca mencakupnya. Audit ini tidak
   merekomendasikan menyentuhnya — menghapusnya berarti run headless tanpa gerbang izin sama
   sekali terhadap `rm -rf`/force-push ke `main`/penghapusan worktree.

## Akar masalah

Premis tiket — "guardrail suka block apalagi ke failed" — **tidak ditemukan sebagai masalah
aktif saat ini**:

- `select status, count(*) from "Run" group by status` → seluruh run di database berstatus
  `done`; **nol** run `failed`.
- Lima run terakhir yang menyebut kata "guardrail" di log-nya (`RUN-8801`–`RUN-8805`) semuanya
  `done`; salah satu baris log bahkan mencatat guardrail menolak `rm -rf` milik agen sendiri lalu
  agen itu melanjutkan tanpanya — "working as intended", bukan kegagalan run.
- Dua bug nyata yang **pernah** membuat guardrail gagal secara tidak jujur sudah diperbaiki
  sebelum tiket ini dibuka:
  - **RUN-8801** (SPEC-010/ADR-0009): path CLI dibangun dari `process.cwd()`, salah saat worker
    jalan dari `server/`, sehingga subprocess verify **crash** dan disalahartikan sebagai "docs
    stale". Diperbaiki dengan `resolveCliEntry` yang berjalan-naik ke `pnpm-workspace.yaml`.
  - **Switch dashboard diabaikan subprocess** (commit `caff8d3`, hari ini): mematikan
    "requireLinks"/"blockStale" di Settings tidak pernah sampai ke subprocess `docs verify`
    (yang tak punya akses DB), jadi guardrail tetap memblokir walau operator sudah
    mematikannya. Diperbaiki dengan `guardEnv`/`HANOMAN_REQUIRE_LINKS` dkk., dibaca per-run di
    `server/src/worker.ts` lewat `getSetting()`.
- Investigasi bug kedua itu persis yang melatari ADR-0022 (SPEC-157, tanggal yang sama): lima
  run `failed` yang memicunya "ternyata gagal karena bug … bukan karena butuh keputusan."

Dengan kedua bug itu sudah tertutup, tidak ada bukti guardrail Source of Truth saat ini
memblokir/menggagalkan run secara keliru.

## Jalur untuk "tidak ikut campur" sudah ada, tanpa hapus kode

Guardrail Source of Truth **sudah** bisa dimatikan per-repo tanpa mengubah satu baris kode:
`hanoman.config.json` di repo target, atau switch "Source of Truth" (`blockStale`,
`requireLinks`) di dashboard Settings (`src/src/screens/SettingsScreen.tsx:115-122`) — mati
pada `requireLinks` otomatis menurunkan `coverageThreshold` ke 0 juga
(`server/src/runner/deps.ts` `guardEnv`, komentar: "membiarkan ambangnya di 100 … hanya menukar
pesan blokirnya, bukan mencabut blokirnya"). Ini sudah memenuhi permintaan literal "cukup
gunakan hooks yang ada pada project nya" untuk repo yang tidak ingin diikutcampuri hanoman —
tanpa mencabut mekanismenya untuk repo lain yang memakainya.

## Kenapa audit ini tidak merekomendasikan jalur `execute`

Permintaan sebenarnya — hapus mekanisme guardrail Source of Truth dari codebase — gagal
**seluruh** syarat jalur cepat (SPEC-145/ADR-0020):

- **Tidak terlokalisasi.** Menyentuh CLI (`cli/src/verify.ts`, `cli/src/commands/hook-stop.ts`,
  `cli/src/commands/docs-verify.ts`, `cli/src/router.ts`), server (`server/src/runner/deps.ts`,
  `server/src/worker.ts`), gate runner (`runner/src/run.ts:158-169`), dan UI dashboard
  (`SettingsScreen.tsx`) — bukan satu-dua berkas.
- **Keputusan desain besar, bukan kecil.** ADR-0001 mendirikan guardrail ini sebagai mekanisme
  inti produk ("satu kebenaran yang ditegakkan secara mekanis"). Mencabutnya adalah membalik
  keputusan arsitektur yang diterima, bukan memperbaiki bug.
- **Sudah pernah dipertimbangkan dan ditolak — hari yang sama.** ADR-0022 (SPEC-157) secara
  eksplisit menolak alternatif "tombol override guardrail Source of Truth" dengan alasan: "persis
  bypass yang dilarang CLAUDE.md."
- **Bertentangan langsung dengan instruksi proyek yang berlaku.** `CLAUDE.md` (root, bagian
  Jangan): *"Jangan bypass Stop hook / guardrail Source of Truth."* Ini bukan preferensi gaya —
  ini instruksi proyek eksplisit yang lebih tinggi otoritasnya daripada satu tiket backlog.

Karena keputusan ini menentukan ruang lingkup produk dan berbenturan dengan kebijakan proyek
yang eksplisit, audit ini **tidak menebak jalurnya**. Pertanyaan ditulis ke `.hanoman-ask.json`
alih-alih `.hanoman-decision.json` — lihat bagian Verifikasi.

## Verifikasi

Root cause dipastikan lewat pembacaan kode statis (`file:baris` dikutip di atas) di seluruh
lapisan guardrail (`cli/src/verify.ts`, `cli/src/commands/hook-stop.ts`,
`server/src/runner/deps.ts`, `server/src/worker.ts`, `runner/src/run.ts`,
`runner/src/safety.ts`, `.claude/settings.json`), dan lewat query langsung ke Postgres dev
(`docker exec hanoman-db-1 psql -U hanoman -d hanoman`) yang menunjukkan nol run `failed` dan
lima run bersinggungan-guardrail yang seluruhnya `done`. Tidak ada reproduksi runtime baru di
fase ini — memicu run nyata untuk "menguji" blokir guardrail berarti menjalankan agen di
background, efek samping di luar fase Audit (preseden sama di SPEC-142 dan SPEC-149).

## Rujukan

- ADR-0001 — [docs sebagai Source of Truth](../adr/0001-docs-as-source-of-truth.md): mekanisme
  yang diminta tiket ini untuk dihapus.
- ADR-0009 — [guardrail crash fails loud](../adr/0009-guardrail-crash-fails-loud.md): bug
  RUN-8801, sudah diperbaiki.
- ADR-0010 — [runner spawns claude cli](../adr/0010-runner-spawns-claude-cli.md): kenapa PreToolUse
  deny (`runner/src/safety.ts`) adalah satu-satunya gerbang tersisa di run headless.
- ADR-0020 — [fase perencanaan QA dipangkas oleh keputusan audit](../adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md):
  syarat jalur cepat yang tiket ini **gagal** penuhi.
- ADR-0022 — [agen bertanya, run berstatus `awaiting`](../adr/0022-pertanyaan-agen-berstatus-awaiting.md):
  menolak eksplisit "tombol override guardrail SoT", hari yang sama, dengan alasan yang sama
  relevannya di sini.
- [agent-documentation-workflow](agent-documentation-workflow.md) — bagian "Guardrail (SPEC-002)":
  switch per-repo yang sudah ada untuk mematikan guardrail tanpa menghapus kode.
- commit `caff8d3` — perbaikan bug switch dashboard diabaikan subprocess verify.
