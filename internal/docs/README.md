# internal/docs — Source of Truth index

Ini **index Source of Truth** hanoman. Setiap dokumen sebaiknya ter-link dari sini — konvensi, bukan lagi
gerbang mekanis (guardrail dicabut, ADR-0023). Kategori mengikuti vocabulary tetap.

## entrypoints
- [blueprint](entrypoints/blueprint.md) — gambaran satu halaman
- [brd](entrypoints/brd.md) · [prd](entrypoints/prd.md) · [frd](entrypoints/frd.md) · [rd](entrypoints/rd.md)

## product
- [blueprint](product/blueprint.md) · [scope-principles](product/scope-principles.md) · [onboarding](product/onboarding.md)

## business
- [brd](business/brd.md) · [pricing-rationale](business/pricing-rationale.md)

## requirements
- [prd](requirements/prd.md) · [frd](requirements/frd.md) · [rd](requirements/rd.md) · [acceptance-criteria (EARS)](requirements/acceptance-criteria-ears-standard.md)

## research
- [market-sizing](research/market-sizing.md) · [competitor-analysis](research/competitor-analysis.md) · [moat](research/moat.md)

## architecture
- [stack](architecture/stack.md) · [data-model](architecture/data-model.md) · [api-contract](architecture/api-contract.md) · [nfr](architecture/nfr.md)

## adr
> Nomor unik & imutable. ADR usang tidak dihapus — ditandai statusnya di bawah dan di header masing-masing.
- [0033 — Notifikasi saat backlog selesai](adr/0033-notifikasi-backlog-selesai.md)
- [0032 — Branch adalah properti backlog item](adr/0032-branch-adalah-properti-backlog-item.md)
- [0031 — Rebase & merge branch done spec dari dashboard](adr/0031-rebase-merge-backlog.md)
- [0030 — `Spec` menyimpan baseSha/headSha; review done men-diff darinya](adr/0030-spec-menyimpan-base-head-sha.md)
- [0029 — `Execute done` hanya sah bila plan terceklist penuh](adr/0029-execute-done-butuh-plan-terceklist.md)
- [0028 — Auth: sesi opaque revocable di DB, bind 127.0.0.1 + reverse proxy TLS](adr/0028-auth-sesi-opaque-di-db.md)
- [0027 — Stage boleh mundur atas perintah human eksplisit](adr/0027-revert-stage-backward-only.md)
- [0026 — Reverse docs sebagai sesi interaktif project-level](adr/0026-reverse-docs-sesi-interaktif-project-level.md)
- [0025 — Modul VPS: tabel sendiri, script deterministik, tanpa queue](adr/0025-modul-vps-script-deterministik.md)
- [0024 — Sesi Claude Code interaktif menggantikan run](adr/0024-sesi-interaktif-menggantikan-run.md) — **supersedes 0005/0012/0017/0022, sebagian 0010, melemahkan 0008**
- [0023 — Guardrail Source of Truth dicabut](adr/0023-guardrail-sot-dicabut.md) — **supersedes 0001**
- [0022 — Agen bertanya, run berstatus `awaiting`](adr/0022-pertanyaan-agen-berstatus-awaiting.md) — *superseded by 0024*
- [0021 — Nomor SPEC diklaim docs, bukan hanya database](adr/0021-nomor-spec-diklaim-docs-bukan-hanya-database.md)
- [0020 — Fase perencanaan QA dipangkas oleh keputusan audit](adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md)
- [0019 — SHA disimpan, diff diturunkan](adr/0019-sha-disimpan-diff-diturunkan.md)
- [0018 — Coverage diturunkan saat dibaca, bukan disimpan](adr/0018-coverage-nilai-turunan.md)
- [0017 — Run terputus melanjutkan sesinya](adr/0017-run-terputus-melanjutkan-sesinya.md) — *superseded by 0024*
- [0016 — Sesi terminal hidup di tmux](adr/0016-sesi-terminal-hidup-di-tmux.md)
- [0015 — Satu backlog, satu sesi Claude](adr/0015-one-session-per-backlog.md)
- [0014 — Sesi interaktif lewat PTY di proses API](adr/0014-pty-terminal-di-proses-api.md)
- [0013 — SoT coverage scoped to docsDir](adr/0013-sot-coverage-scoped-to-docsdir.md)
- [0012 — Biaya adalah estimasi, bukan guardrail](adr/0012-cost-is-an-estimate-not-a-guardrail.md) — *superseded by 0024*
- [0011 — Docs adalah filesystem nyata, bukan salinan DB](adr/0011-docs-realtime-filesystem.md)
- [0010 — Runner spawn `claude` CLI langsung, bukan Agent SDK](adr/0010-runner-spawns-claude-cli.md) — *sebagian superseded by 0024 (gate PreToolUse tetap)*
- [0009 — Guardrail yang crash gagal keras](adr/0009-guardrail-crash-fails-loud.md) — *historis per 0023*
- [0008 — Spec stage mirrors a real run](adr/0008-stage-mirrors-run.md) — *diamandemen 0024/0027/0029*
- [0007 — Run.finishedAt untuk durasi nyata](adr/0007-run-finished-at.md) — *de-facto obsolete (0024)*
- [0006 — GitHub App schema](adr/0006-github-app-schema.md) — *de-facto obsolete (0024)*
- [0005 — Antrian durable (BullMQ/Redis) + worker](adr/0005-durable-queue-and-worker.md) — *superseded by 0024*
- [0004 — Foundation schema deltas](adr/0004-foundation-schema-deltas.md)
- [0003 — Pemilihan model per step](adr/0003-per-step-model-selection.md) — *de-facto obsolete (0024)*
- [0002 — Isolasi run dengan git worktree](adr/0002-git-worktree-isolation.md)
- [0001 — Docs sebagai Source of Truth](adr/0001-docs-as-source-of-truth.md) — *superseded by 0023*

## operations
- [roadmap](operations/roadmap.md) · [gtm](operations/gtm.md) · [agent-documentation-workflow](operations/agent-documentation-workflow.md)
- [production](operations/production.md) — menjalankan instance prod di samping dev (database + port terpisah)

## security
- [security-standard](security/security-standard.md)

## design-system
- [design-system](design-system/design-system.md)

## frontend
- [frontend-implementation](frontend/frontend-implementation.md)

> Chiranjivi — docs bertahan lebih lama dari satu commit atau sesi. Jaga index ini tetap sinkron.
