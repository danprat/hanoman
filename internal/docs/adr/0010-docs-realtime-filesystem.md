# ADR-0010 — Docs are the real filesystem, not a DB copy

**Status:** accepted · **Date:** 2026-07-09 · **Spec:** SPEC-011

## Context
`DocFile` (Postgres) held a copy of each doc's path/content/linked. With the demo
seed removed the table was empty, so scan reported 0% and the docs workspace was
blank. The docs feature was disconnected from the real repo.

## Decision
Drop the `DocFile` model. Read, write, delete, and score docs directly from
`Project.repoDir` in realtime. Corpus = every `**/*.md` via `git ls-files`
(.gitignore honored). SoT coverage = % of directories whose Markdown is
transitively reachable from a root index (`internal/docs/README.md` → `README.md`),
computed by the pure `linkedSetFrom` in `@hanoman/shared`.

## Consequences
- The dashboard edits/deletes the actual files; no sync layer.
- `GET /docs` re-scans on each call (fine for typical repos; cache later if slow).
- Projects with no `repoDir` show empty docs / 0% coverage.
- The CLI run-guardrail still scans `internal/docs` only; it can adopt the shared
  metric later (out of scope here).
