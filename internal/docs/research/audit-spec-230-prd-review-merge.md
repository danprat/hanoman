# audit SPEC-230 — PRD create: sesi jalan tanpa aksi lanjutan (review, merge/rebase)

**Status:** accepted · **Tanggal:** 2026-07-19 · **Sumber:** qa · **Prioritas:** tinggi · **Keputusan:** luas → Spec → Plan → Execute penuh (ADR-0054)

## Keluhan

> Saat create PRD dijalankan, hanya membuka terminal tanpa aksi apa pun — tak ada lanjutan.
> Harapannya sama seperti brief/qa: ada tombol **review** dan **merge/rebase**.

Langkah reproduksi: (1) Buat PRD → (2) Buka Terminal. Aktual: sel terminal PRD polos.
Ekspektasi: sel PRD punya tombol review + rebase/merge seperti sesi brief/qa.

## Investigasi (systematic-debugging)

### Fase 1 — akar masalah

Sesi PRD adalah **sesi project-level** (ADR-0041): `flow: "prd"`, id `prd-<slug>`, worktree
`.worktrees/prd-<slug>`, push ke branch `prd/<slug>`. Ia **tak punya `Spec`** dan karenanya
`TerminalSession.specId` = `undefined`.

Di `src/src/screens/TerminalScreen.tsx` komponen `Cell`:

- Tombol **review** (`git-compare`) digerbangi `session.specId && onReview` (baris ~449).
- Tombol **rebase/merge** (`git-merge`) digerbangi `spec && onIntegrate`, dengan
  `spec = session.specId ? specOf(session.specId) : undefined` (baris ~423, ~456).
- Tombol **docs** (`file-text`) juga digerbangi `session.specId` (baris ~443).

Karena sesi PRD tak punya `specId`, **ketiga gerbang bernilai false** → hanya terminal mentah
yang tampil. Ini bukan pengecualian `flow === "prd"` yang eksplisit — melainkan **ketiadaan
`specId`**. Sesi `reverse`/`scaffold` (juga project-level tanpa Spec) bernasib sama.

### Fase 2 — dukungan server juga Spec-only

Bahkan andai tombolnya dirender, server tak punya yang bisa dikerjakan:

- `GET /specs/:id/review` (`server/src/routes/specs.ts:215`) butuh baris `Spec`
  (`baseSha`/`headSha`/`branchFrom`, worktree `.worktrees/<specid>`).
- `POST /specs/:id/integrate` (`server/src/routes/specs.ts:168`) butuh `Spec` dengan
  `stage === "done"` dan bekerja pada branch `sourceBranch(id)` = `hanoman/<specid>`.

PRD tak menyimpan apa pun dari itu: tak ada baris Spec, tak ada SHA yang dipersist, dan kerjanya
mendarat di `prd/<slug>` — bukan `hanoman/<specid>`.

### Fase 3 — niat desain sudah ada, UI-nya belum

ADR-0041 sudah menetapkan: PRD "push ke branch `prd/<slug>`; **manusia yang merge** — seragam
dengan reverse-docs & done-spec." Jadi affordance review+merge memang **diniatkan**, hanya
belum pernah dibangun UI/endpoint-nya untuk sesi tanpa Spec. Fitur setengah jadi, bukan regresi.

## Akar masalah (confidence tinggi)

Review + integrate sepenuhnya **terkopel ke `Spec`** — di frontend (gerbang `specId`) maupun
server (endpoint `/specs/:id/*`). Sesi PRD project-level tak punya Spec, sehingga tak ada jalur
review/merge untuknya. Memperbaikinya menuntut jalur review+integrate **ber-skop sesi** (keyed ke
worktree + branch sesi), bukan sekadar menyalakan tombol di frontend.

## Keputusan

Perbaikan **luas & lintas-lapis** (server + shared + frontend, endpoint & kontrak wire baru) →
jalankan **Spec → Plan → Execute penuh**, bukan jalur cepat. Diformalkan di **ADR-0054**.

Ringkas rencana (detail di ADR-0054 + `docs/superpowers/plans/spec-230-prd-review-merge.md`):

1. **Tanpa perubahan skema** — ADR-0041 menjaga PRD keluar dari DB. Review dari worktree hidup;
   integrate dari branch `prd/<slug>`.
2. **Simpan branch integrasi pada sesi** (`@hanoman_branch` di tmux) → `SessionInfo` →
   `SessionDTO.branch` (wire) → `TerminalSession.branch` (client). Server & UI tak menebak nama
   branch dari id.
3. **Server**: generalisasi `services/integrate.ts` agar menerima `{ branch, mergeId }` eksplisit
   (bukan hanya `specId`); tambah `GET /terminal/sessions/:id/review` (+`/review/*`) dan
   `POST /terminal/sessions/:id/integrate` yang bekerja pada worktree/branch sesi.
4. **Frontend**: generalisasi `ReviewScreen` (spec|session) & `IntegrateDialog` (ownBranch);
   `Cell` menampilkan review+merge untuk sesi PRD (`flow === "prd"`, `session.branch`).

### Batas (ceiling, sadar-diri)

Review sesi PRD berlaku **selama sesi hidup** (worktree ada). Sesudah sesi ditutup, worktree
dibuang & tak ada SHA tersimpan (tanpa Spec) → review 409, hanya branch yang tersisa. Ini
konsisten dengan "ceiling" yang sudah didokumentasikan ADR-0041. **Integrate** tetap jalan kapan
pun branch `prd/<slug>` ada (beroperasi pada ref, bukan worktree). Peningkatan (review berbasis
range `prd/<slug>` pasca-tutup) ditunda — YAGNI untuk keluhan ini.

## Berkas tersentuh (rencana)

- server: `services/integrate.ts`, `routes/terminal.ts`, `services/pty.ts`
- shared: `api.ts` (paths), `dto.ts` (`SessionDTO.branch`)
- frontend: `api/client.ts`, `screens/ReviewScreen.tsx`, `screens/IntegrateDialog.tsx`,
  `screens/TerminalScreen.tsx`, `App.tsx`
- docs: ADR-0054, `architecture/api-contract.md`, README index
