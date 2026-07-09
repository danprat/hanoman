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
- [spec-008 — objective (de-mock sweep)](operations/spec-008-de-mock-objective.md)
- [spec-011 — objective (realtime SoT scan)](operations/spec-011-realtime-sot-scan-objective.md)

## security
- [security-standard](security/security-standard.md)

## design-system
- [design-system](design-system/design-system.md)

## frontend
- [frontend-implementation](frontend/frontend-implementation.md)

> Chiranjivi — docs bertahan lebih lama dari satu commit atau run. Jaga index ini tetap sinkron.
