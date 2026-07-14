# ADR-0041 — PRD adalah dokumen + flow sesi project-level, bukan entitas DB

**Status:** accepted · **Tanggal:** 2026-07-14 · **SPEC-210**

## Konteks
PM/PO butuh menulis brief, ber-brainstorm, dan menghasilkan **PRD** sebelum sebuah fitur dipecah
ke spec + plan. Sebelumnya backlog item (`Spec`) lahir langsung dari `brief`/`qa` — tak ada artefak
PRD tingkat product-management di hulu backlog, sehingga fitur tak selalu terdokumentasi sebelum
di-breakdown.

## Keputusan
PRD dimodelkan sebagai **dokumen** `docs/prd/<slug>.md` di repo project — **bukan tabel Prisma**.
Konsisten dengan [ADR-0011](0011-docs-realtime-filesystem.md) (docs = filesystem nyata, bukan salinan DB).

- **Create:** flow sesi project-level baru `prd` (`runner`: `PIPELINES.prd = ["Brainstorm", "PRD"]`,
  `startPrdPrompt`), meniru `reverse` ([ADR-0026](0026-reverse-docs-sesi-interaktif-project-level.md)):
  worktree isolasi `.worktrees/prd-<slug>`, brainstorm **interaktif** (satu pertanyaan per giliran;
  PM menonton terminal), lalu tulis PRD terstruktur, commit, push ke branch `prd/<slug>`. **Manusia
  yang merge** — seragam dengan reverse-docs & done-spec. Keluaran HANYA dokumen; tak menulis kode.
- **Preview:** `GET /projects/:id/prds` + `/prds/*` membaca **freshest-wins** — worktree sesi `prd`
  hidup untuk project ini menang atas `repoDir` (pola [SPEC-170]). Preview ter-render lewat `MarkdownView`.
- **Take ke backlog:** tombol di preview PRD membuka `NewSpecModal` (kind `brief`) ter-*prefill* dari
  PRD; submit → `Spec` biasa lewat `POST /specs`. Tautan balik ke PRD dibawa **teks Konteks** brief
  ("Dari PRD: <path>"), bukan field payload terpisah — `zBriefPayload` strip key tak dikenal dan tak
  ada yang mengonsumsinya (YAGNI).

## Konsekuensi
- Tak ada migration / skema baru. Tak ada auto-merge branch PRD, tak ada auto-split PRD → banyak spec
  (satu backlog item per klik "Take ke backlog").
- **Ceiling (ponytail):** PRD yang sesinya sudah ditutup **tapi branch belum di-merge** hanya ada di
  origin/branch — tak muncul di daftar (bukan di `repoDir`, tak ada worktree hidup) sampai di-merge.
  Alur nyata (create → preview → take dalam satu sesi hidup, lalu merge) menutupinya. Upgrade path
  bila perlu: daftar juga branch `prd/*` yang belum ter-merge.

[SPEC-170]: ../architecture/data-model.md
