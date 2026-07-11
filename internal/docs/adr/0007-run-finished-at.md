# ADR-0007 — Run.finishedAt for real run duration

**Status:** de-facto obsolete (SPEC-008) · 2026-07-08 — [ADR-0024](0024-sesi-interaktif-menggantikan-run.md) men-drop model `Run`, jadi `Run.finishedAt` tak ada lagi; durasi kini turunan dari sesi tmux

## Context
`RunsScreen` showed a hardcoded `duration: "—"`. `Run` stored `createdAt` (start) but no
end timestamp, so a finished run's elapsed time could not be computed — only a live
run's elapsed-from-now.

## Decision
Add a nullable `Run.finishedAt DateTime?`. `events-io.persistEvent` sets it to `now()`
when a run reaches a terminal status (`done` / `failed` / `stopped`). Duration is
`(finishedAt ?? now) − createdAt`, computed client-side (live for running runs).

## Consequences
Additive, nullable column — safe forward migration, existing rows read `null` (their
duration renders live-from-`createdAt`, which for already-finished rows is a harmless
over-estimate until the next run). No backfill. `zRun` exposes `createdAt` + `finishedAt`.
