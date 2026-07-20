# ADR-0059 — Kontinuitas branch take-to-backlog (PRD→brief, audit→QA) + skip-audit untuk qa lanjutan audit

**Status:** accepted · **Tanggal:** 2026-07-20 · **Spec:** SPEC-244
**Terkait:** [ADR-0032](0032-branch-adalah-properti-backlog-item.md) (branchFrom = properti Spec),
[ADR-0040](0040-jalur-cepat-qa-dielicit-prompt.md) (jalur cepat qa dielicit prompt),
[ADR-0041](0041-prd-sebagai-dokumen-flow-project-level.md) (PRD dokumen + take-to-backlog),
[ADR-0057](0057-audit-only-source-flow.md) (audit-only + promosi Finding QA),
[ADR-0002](0002-git-worktree-isolation.md) (isolasi worktree)

## Konteks

Audit SPEC-244 (`research/audit-spec-244-branch-continuity-take-to-backlog.md`) menemukan tiga
kebocoran kontinuitas branch:

- **PRD → brief** ("Take ke backlog", ADR-0041) tak meneruskan branch `prd/<slug>` yang dibuat
  sesi PRD → brief baru lahir dari `main`, membuang dokumen PRD.
- **Audit → Finding QA** ("Jadikan Finding QA", ADR-0057) tak meneruskan `hanoman/<audit-id>` dan
  **mengulang fase Audit** dari nol, mengabaikan dokumen audit yang sudah jadi doc-of-record.
- Pembuatan backlog **tak melisten branch origin/remote** — justru `prd/<slug>` & `hanoman/<audit-id>`
  hidup **hanya di origin** (worktree detached lalu push, ADR-0002). Modal, whitelist server, dan
  resolusi SHA semuanya lokal-only, jadi meneruskan branch itu mustahil.

## Keputusan

Kontinuitas branch tetap memakai `Spec.branchFrom` (ADR-0032) — **tanpa skema baru** untuk branch.
Yang ditambal: (1) prefill branch, (2) remote jadi first-class untuk `branchFrom`, (3) sinyal +
klausa prompt skip-audit.

1. **Prefill `branchFrom` di take/promote.** `SpecPrefill` & `PrdPrefill` (frontend) melebar dengan
   `branchFrom?`. `NewSpecModal` menginisialisasi form `branchFrom` dari prefill (bukan selalu `""`).
   - **PRD → brief:** `takeToBacklog` mengisi `branchFrom = "prd/" + slug`, `slug` diturunkan dari
     `prdPath` (`docs/prd/<slug>.md`) — cermin `slugOf` server.
   - **Audit → QA:** `promoteToQa` mengisi `branchFrom = "hanoman/" + audit.id` (= `sourceBranch`).

2. **Remote branch first-class untuk `branchFrom`.** Prinsip ADR-0032 "satu daftar memasok dropdown
   DAN gerbang validasi" dipertahankan, hanya daftarnya diperluas ke `refs/heads ∪ refs/remotes/origin`:
   - **Frontend:** `NewSpecModal` menggabung `r.branches` + `r.remotes` sebagai kandidat `branchFrom`
     (remote yang juga ada lokal di-dedup). `branchOptions` menandai asal remote (mis. `· origin`).
   - **Server:** whitelist `branchUnknown` (`routes/specs.ts`) menerima branch yang ada di lokal
     **atau** remote. Helper `branchFromCandidates(repoDir) = listRepoBranches ∪ listRepoRemoteBranches`
     (`services/branches.ts`), dedup — satu daftar, satu gerbang.
   - **Runner:** `resolveCommit` (`runner/src/git.ts`) mencoba `<rev>` **lalu** `origin/<rev>`
     (cermin `resolveSource` di `services/integrate.ts`). `--verify --end-of-options` tetap; prefix
     `origin/` adalah konstanta, bukan input yang bisa jadi flag → keamanan argumen ADR-0032 utuh.

3. **Skip-audit untuk qa lanjutan audit** (dielicit prompt, diputuskan agen — ADR-0040). Sinyal
   dibawa **eksplisit** lewat payload: `zQaPayload.fromAudit?: string` (opsional, forward-compatible;
   baris lama tetap parse). `promoteToQa` menyetel `fromAudit = audit.id`; `createSpec` menyertakannya
   ke payload qa. `startPrompt` (runner) — bila `flow === "qa"` dan `payload.fromAudit` ada — meng-emit
   klausa `auditContinuationInstruction`:
   > Backlog qa ini **lanjutan dari audit `<fromAudit>`**. Worktree lahir dari branch audit itu, jadi
   > dokumen audit sudah ada di `internal/docs/research/audit-<fromAudit>-*.md`. **JANGAN ulangi fase
   > Audit** — baca dokumen audit itu sebagai temuan, tandai `Audit skipped`, lalu ambil keputusan
   > pasca-Audit (ADR-0040): perbaikan jelas & kecil → langsung Execute (`Spec`/`Plan` `skipped` bila
   > sesuai); selain itu Spec → Plan → Execute penuh.

   Mekanisme `skipped` sudah ada (ADR-0040): `Audit skipped` → `REACHED.Audit = "objective"`
   (`services/session-phases.ts`), stage bergerak normal; tak ada perubahan mesin fase.

## Konsekuensi

- Tak ada migration. Satu field payload opsional (`fromAudit`) + satu field wire opsional
  (`branchFrom` prefill, frontend-only). Aditif, wire-compatible.
- PRD → brief & audit → QA kini **mewarisi branch sumbernya** — kerja sebelumnya tak terbuang; brief
  meneruskan dokumen PRD, qa meneruskan dokumen audit.
- Backlog bisa memilih **branch remote-only** sebagai basis worktree (bukan hanya `main` lokal) —
  memenuhi kebutuhan "melisten origin/remote".
- qa yang dinaikkan dari audit **tak membayar Audit dua kali**; audit asli tetap doc-of-record
  (ADR-0057), dokumen audit terbaca langsung di worktree qa karena kontinuitas branch.
- **Ceiling:** kontinuitas mengandalkan branch sumber **ada di origin** (sudah di-push). Sesi PRD/audit
  yang belum push (belum sampai fase akhir) → branch belum ada → item hasil take/promote jatuh ke
  perilaku lama (default `main`) dan divalidasi apa adanya. Sesuai ceiling ADR-0041.

## Alternatif yang ditolak

- **Menurunkan sinyal skip-audit dari `branchFrom` (`hanoman/*`)** alih-alih payload `fromAudit`.
  Implisit & rapuh: qa bisa ber-`branchFrom` `hanoman/*` untuk alasan lain, dan agen tak tahu
  dokumen audit mana yang harus dibaca. `fromAudit` eksplisit menamai audit id → dokumen tepat.
- **Flow baru `qa-from-audit` (pipeline `Spec → Plan → Execute`).** Melebarkan enum `Flow`,
  `PIPELINES`, matriks `phaseModels`, dan UI Settings untuk keuntungan yang sudah dicapai klausa
  prompt + `Audit skipped`. Melanggar YAGNI; mekanisme ADR-0040 sudah menanganinya.
- **Menyematkan `branchFrom` ke prompt** agar runner tahu asal audit. Dilarang ADR-0032 (branchFrom
  = konfigurasi run, bukan isi prompt — jadi derau tiap fase). Sinyal lewat payload lebih bersih.
- **Menyimpan branch remote sebagai `refs/heads` lokal saat take/promote.** Menambah mutasi git di
  jalur baca; `resolveCommit` fallback `origin/<rev>` cukup dan tak menyentuh state repo.

## Acceptance (EARS)

- **AC-1** — WHEN operator "Take ke backlog" dari sebuah PRD, THE `NewSpecModal` SHALL ter-prefill
  `branchFrom = prd/<slug>` (slug dari path PRD), dan `POST /specs` SHALL menerima branch itu.
- **AC-2** — WHEN operator "Jadikan Finding QA" dari sebuah audit, THE `NewSpecModal` SHALL ter-prefill
  `branchFrom = hanoman/<audit-id>` dan payload `fromAudit = <audit-id>`.
- **AC-3** — THE picker branch pada pembuatan backlog SHALL menampilkan branch **lokal dan origin**,
  dan `POST/PATCH /specs` SHALL menerima `branchFrom` yang hanya ada di origin (tak 400).
- **AC-4** — WHEN worktree dibuat dari `branchFrom` yang hanya ada di origin, THE `resolveCommit`
  SHALL me-resolve via `origin/<rev>` dan worktree SHALL lahir di SHA branch itu.
- **AC-5** — WHEN sesi qa berjalan dengan payload `fromAudit`, THE prompt SHALL menginstruksikan
  lewati fase Audit (`Audit skipped`, baca dokumen audit) lalu keputusan pasca-Audit ADR-0040.
- **AC-6** — THE perilaku take/promote/branch tanpa kontinuitas (branchFrom kosong, qa non-lanjutan)
  SHALL tak berubah (regresi nol): default `main`, flow qa penuh `Audit → Spec → Plan → Execute`.
