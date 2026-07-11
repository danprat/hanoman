# internal/docs — Source of Truth index

Ini **index Source of Truth** hanoman. Setiap dokumen harus ter-link dari sini sebelum plan boleh execute. Kategori mengikuti vocabulary tetap.

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
- [0031 — Rebase & merge branch done spec dari dashboard](adr/0031-rebase-merge-backlog.md)
- [0030 — `Spec` menyimpan baseSha/headSha; review done men-diff darinya](adr/0030-spec-menyimpan-base-head-sha.md)
- [0030 — Notifikasi saat backlog selesai dikerjakan](adr/0030-notifikasi-backlog-selesai.md)
- [0029 — `Execute done` hanya sah bila plan terceklist penuh](adr/0029-execute-done-butuh-plan-terceklist.md)
- [0028 — Auth: sesi opaque revocable di DB, bind 127.0.0.1 + reverse proxy TLS](adr/0028-auth-sesi-opaque-di-db.md)
- [0027 — Stage boleh mundur atas perintah human eksplisit](adr/0027-revert-stage-backward-only.md)
- [0026 — Reverse docs sebagai sesi interaktif project-level](adr/0026-reverse-docs-sesi-interaktif-project-level.md)
- [0024 — Sesi Claude Code interaktif menggantikan run](adr/0024-sesi-interaktif-menggantikan-run.md)
- [0023 — Guardrail Source of Truth dicabut](adr/0023-guardrail-sot-dicabut.md)
- [0021 — Nomor SPEC diklaim docs, bukan hanya database](adr/0021-nomor-spec-diklaim-docs-bukan-hanya-database.md)
- [0022 — Agen bertanya, run berstatus `awaiting`](adr/0022-pertanyaan-agen-berstatus-awaiting.md)
- [0020 — Fase perencanaan QA dipangkas oleh keputusan audit](adr/0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md)
- [0019 — SHA disimpan, diff diturunkan](adr/0019-sha-disimpan-diff-diturunkan.md)
- [0018 — Coverage diturunkan saat dibaca, bukan disimpan](adr/0018-coverage-nilai-turunan.md)
- [0018 — Branch adalah properti backlog item](adr/0018-branch-adalah-properti-backlog-item.md)
- [0017 — Run terputus melanjutkan sesinya](adr/0017-run-terputus-melanjutkan-sesinya.md)
- [0016 — Sesi terminal hidup di tmux](adr/0016-sesi-terminal-hidup-di-tmux.md)
- [0015 — Satu backlog, satu sesi Claude](adr/0015-one-session-per-backlog.md)
- [0014 — PTY terminal di proses API](adr/0014-pty-terminal-di-proses-api.md)
- [0013 — SoT coverage scoped to docsDir](adr/0013-sot-coverage-scoped-to-docsdir.md)
- [0012-cost-is-an-estimate-not-a-guardrail](adr/0012-cost-is-an-estimate-not-a-guardrail.md)
- [0010-runner-spawns-claude-cli](adr/0010-runner-spawns-claude-cli.md)
- [0001 — docs as source of truth](adr/0001-docs-as-source-of-truth.md)
- [0002 — git worktree isolation](adr/0002-git-worktree-isolation.md)
- [0003 — per-step model selection](adr/0003-per-step-model-selection.md)
- [0004 — foundation schema deltas](adr/0004-foundation-schema-deltas.md)
- [0005 — durable queue + worker](adr/0005-durable-queue-and-worker.md)
- [0006 — github app schema](adr/0006-github-app-schema.md)
- [0007 — run finishedAt for real duration](adr/0007-run-finished-at.md)
- [0008 — spec stage mirrors a real run](adr/0008-stage-mirrors-run.md)
- [0009 — a crashed guardrail tool fails loud](adr/0009-guardrail-crash-fails-loud.md)
- [0011 — docs are the real filesystem, not a DB copy](adr/0011-docs-realtime-filesystem.md)

## operations
- [roadmap](operations/roadmap.md) · [gtm](operations/gtm.md) · [agent-documentation-workflow](operations/agent-documentation-workflow.md)
- [production](operations/production.md) — menjalankan instance prod di samping dev (db, Redis db index, port, RUN_ID_FLOOR)
- [spec-008 — objective (de-mock sweep)](operations/spec-008-de-mock-objective.md)
- [spec-011 — objective (realtime SoT scan)](operations/spec-011-realtime-sot-scan-objective.md)
- [spec-141 — objective (overview coverage realtime)](operations/spec-141-overview-coverage-realtime-objective.md)
- [spec-142 — audit (status run tidak auto-update dari queued)](operations/spec-142-runs-status-auto-update-audit.md)
- [spec-142 — spec (status run auto-update dari queued)](operations/spec-142-runs-status-auto-update-spec.md)
- [spec-143 — objective (select branch di backlog)](operations/spec-143-select-branch-in-backlog-objective.md)
- [spec-144 — objective (Runs menampilkan changes yang dibuat hanoman)](operations/spec-144-run-changes-preview-objective.md)
- [spec-145 — objective (QA after audit: keputusan sebelum spec)](operations/spec-145-qa-after-audit-objective.md)
- [spec-146 — audit (belum ada detail project)](operations/spec-146-detail-project-audit.md)
- [spec-146 — spec (detail project)](operations/spec-146-detail-project-spec.md)
- [spec-147 — audit (tidak ada favicon)](operations/spec-147-favicon-audit.md)
- [spec-147 — spec (favicon)](operations/spec-147-favicon-spec.md)
- [spec-149 — audit (run failed tidak bisa di-retry)](operations/spec-149-retry-runs-audit.md)
- [spec-158 — objective (split terminal)](operations/spec-158-split-terminal-objective.md)
- [spec-159 — audit (urutan panel run detail menutupi terminal)](operations/spec-159-runs-orders-audit.md)
- [spec-160 — audit (hilangkan guardrail)](operations/spec-160-hilangkan-guardrail-audit.md)
- [spec-160 — spec (hilangkan guardrail Source of Truth)](operations/spec-160-hilangkan-guardrail-spec.md)
- [spec-168 — audit (backlog tidak update saat terminal berganti state)](operations/spec-168-backlog-realtime-audit.md)
- [spec-168 — spec (backlog turunkan stage live saat sesi hidup)](operations/spec-168-backlog-realtime-spec.md)
- [spec-170 — objective (lihat dokumen audit/spec/plan per backlog item)](operations/spec-170-doc-viewer-objective.md)
- [spec-171 — objective (All File & File Changed: review worktree backlog)](operations/spec-171-all-file-changed-objective.md)
- [spec-176 — audit (review backlog `done` kosong file changed-nya)](operations/spec-176-review-file-changed-audit.md)
- [spec-177 — objective (Review collapse default + File Changed tree toggle)](operations/spec-177-review-collapse-tree-objective.md)

## security
- [security-standard](security/security-standard.md)

## design-system
- [design-system](design-system/design-system.md)

## frontend
- [frontend-implementation](frontend/frontend-implementation.md)

> Chiranjivi — docs bertahan lebih lama dari satu commit atau run. Jaga index ini tetap sinkron.
