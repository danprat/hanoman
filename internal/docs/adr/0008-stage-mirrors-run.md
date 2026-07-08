# ADR-0008 — Spec stage mirrors a real run

**Status:** accepted · 2026-07-08 · SPEC-009

## Context
`Spec.stage` was advanced by `POST /specs/:id/advance` → `advance()`, a linear
counter with no real work behind it. A spec could reach `executing`/`done` while
brainstorming never happened. The real lifecycle already exists inside a Run:
`runner` pipelines run `Brainstorm → Objective → Spec → Plan → Execute` (feature)
as real Claude Code work in a worktree.

## Decision
`Spec.stage` becomes a read-only mirror of its run's phases. Starting work enqueues
one real Run (`POST /runs`, flow from `spec.source`, tied to `specId`). `persistEvent`
maps `phase`/`status` events to the spec's stage, monotonic-forward only. The manual
`advance()` function and `POST /specs/:id/advance` route are removed.

Mapping: `Objective`/`Audit` done → `objective`; `Spec` done → `spec-ready`;
`Plan` done → `planned`; `Execute` active → `executing`; run `done` → `done`.
`Brainstorm` done does not move the stage.

## Consequences
- `executing`/`done` are unreachable without a real run passing the Source-of-Truth
  guardrail (`deps.verify` on Execute). Skipping stages is structurally impossible.
- No schema change (`Spec.stage`, `Run.specId` already exist).
- Simplification: QA specs reuse the 6-stage bar; `Audit` maps to `objective`
  (the bar visually jumps `brainstorming → objective` for QA). Upgrade: per-flow bar.
