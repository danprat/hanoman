# SPEC-002 — hanoman CLI + docs-as-Source-of-Truth guardrail

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-001 (workspace, `shared/`, `coverageOf`)

## Place in the sequence

Second of the fully-real spec sequence (no stubs). SPEC-002 builds the `hanoman`
CLI shell and the deterministic **docs-as-SoT guardrail**. The LLM-driven commands
(`spec/plan/execute/scaffold/reverse`) are deliberately **not** here — they require
Claude Code, which is spawned by the runner in **SPEC-003**; building them now would
mean stubbing, which the sequence forbids.

## Context

`internal/docs/**` is the Source of Truth; ADR-0001 mandates a Stop hook
(`hanoman docs verify --block-if-stale`) that mechanically blocks the plan→execute
transition when referenced docs are stale or unlinked. Today only a partial hook
exists — `.claude/hooks/ensure-docs-updated.py` — a "you changed `src/` without
touching docs" reminder. It does not do the ADR-0001 link/staleness check. SPEC-002
elevates that heuristic into the real CLI guardrail and makes it the single source of
guardrail truth.

**Reconciliation with SPEC-001:** the CLI is a **filesystem + git tool**, not a DB
client. It runs *inside a project repo* and reads that repo's real `internal/docs/**`
and index `internal/docs/README.md`. That is a different doc store from SPEC-001's
`DocFile` (Postgres); they do not conflict. SPEC-003's runner is where a repo's docs
sync into `DocFile`. SPEC-002 is self-contained: no server, no DB, no LLM.

## Goal

A real, dependency-light `hanoman` CLI providing the docs-as-SoT guardrail and index
hygiene commands, plus a Stop-hook adapter wired into `.claude/settings.json`. Running
`hanoman docs verify --block-if-stale` in a repo passes or blocks deterministically
with clear reasons.

Definition of done:
- `hanoman docs verify --block-if-stale` exits non-zero + prints reasons when the
  repo violates the guardrail; exits 0 when clean.
- The Stop hook routes through `hanoman hook stop`; `ensure-docs-updated.py` retired.
- All commands covered by tests against temp-dir git fixtures. Tests green.
- Touched `internal/docs` updated + linked in its index.

## Approaches considered

- **CLI shell:** hand-rolled router on Node `util.parseArgs` (zero deps) vs. a
  framework (commander/oclif). **Decision: hand-rolled** — for ~6 commands a
  framework is an unneeded dependency.
- **Guardrail placement:** all logic in the TS CLI with the Stop hook delegating to
  `hanoman hook stop` (one source) vs. keeping logic in the Python hook (two
  implementations that drift). **Decision: delegate to the CLI**, retire the Python
  hook — one guard, all callers.

## Scope

### In scope
- New `cli/` workspace package: bin `hanoman`, command router, exit codes,
  `--json`/`--help`/`--version`, repo-root + docs-dir resolution.
- Move pure `coverageOf` / `docStatusFor` from `server/src/services/coverage.ts` to
  `shared/` so server (SPEC-001) and CLI share one implementation.
- Filesystem docs model: parse the index (`README.md`) → linked doc paths; walk
  `internal/docs/**` → actual files; category = first path segment.
- Commands: `docs verify`, `docs scan`, `docs index --check|--fix`, `docs link`,
  `hook stop`.
- `hanoman.config.json` (optional, repo root) with schema + defaults in `shared/`.
- Rewire `.claude/settings.json` Stop hook → `hanoman hook stop`; delete
  `.claude/hooks/ensure-docs-updated.py`.

### Out of scope (→ SPEC-003, built real there)
`spec/plan/execute/scaffold/reverse` (need Claude Code), git worktrees, syncing repo
docs into `DocFile`, the dashboard writing `hanoman.config.json` per project.

## Command surface (all real, deterministic, no LLM)

| Command | Behavior |
|---|---|
| `hanoman docs verify [--block-if-stale] [--json]` | The guardrail. Runs the checks; exits `0` (pass) or `1` (block, only when `--block-if-stale`). Prints reasons; `--json` emits structured result. Without `--block-if-stale`, reports but always exits 0. |
| `hanoman docs scan [--json]` | Read-only: coverage + per-category linked/unlinked report. |
| `hanoman docs index --check` | Verify index integrity: every doc file linked, every link resolves to a file. Non-zero on problems. |
| `hanoman docs index --fix` | Append missing links to `internal/docs/README.md` under the right category heading. |
| `hanoman docs link <path> [--category c]` | Mechanically add one doc to the index. |
| `hanoman hook stop` | Stop-hook adapter: read Claude Code hook JSON on stdin, run verify, emit `{"decision":"block","reason":…}` or empty (allow). Always exits 0 (the block is carried in JSON, per the hook protocol). |
| `hanoman --version` / `--help` | Standard. |

## Guardrail decision (the confirmed staleness model)

`docs verify` collects violations; with `--block-if-stale` any violation → block.
Deterministic, no LLM, gated by config flags:

1. **Unlinked** (when `requireLinks`): a file under `<docsDir>/**` (excluding the
   index `README.md` itself) is not linked from `README.md`. Reason lists the files.
2. **Freshness** (when `blockStale`): the git working tree has changes under `src/`
   but none under the doc prefixes (`internal/docs/`, `internal/skills/`, `AGENTS.md`,
   `CLAUDE.md`, `README.md`) — reused verbatim from `ensure-docs-updated.py`'s signal.
3. **Coverage** (when `coverageThreshold > 0`): linked-categories coverage
   (`coverageOf`) is below `coverageThreshold`.

Reason copy is mixed-language, consistent with the existing hook (e.g. *"Ada
perubahan di src/ tanpa perubahan dokumentasi…"*, *"Doc belum ter-link di index:
<paths>"*, *"Coverage <n>% di bawah ambang <t>%"*).

## Config — `hanoman.config.json` (optional, repo root)

```jsonc
{
  "docsDir": "internal/docs",
  "requireLinks": true,
  "blockStale": true,
  "coverageThreshold": 100
}
```
Schema `zHanomanConfig` lives in `shared/`. Missing file → these defaults. CLI flags
override config; config overrides defaults. Keeps the CLI DB-free and self-contained.

## Stop-hook integration

`.claude/settings.json` Stop hook becomes:
```json
{ "hooks": { "Stop": [ { "hooks": [
  { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/cli/dist/hanoman.js\" hook stop" }
] } ] } }
```
`hanoman hook stop` reads the hook payload (honors `stop_hook_active` to avoid loops,
resolves `cwd`), runs the verify checks with `blockStale` semantics, and prints the
block decision JSON or nothing. `ensure-docs-updated.py` is deleted; its behavior is
now check #2 above. Invoking the built CLI by path avoids PATH assumptions in the hook
environment.

## Testing (TDD, per CLAUDE.md)

Vitest against temp-dir fixtures (`git init` + a fake `internal/docs` tree +
`README.md` index).
- **Doc model:** index parse (extract linked relative paths from markdown links),
  file walk, category grouping.
- **`coverageOf` reuse:** same math as SPEC-001, filesystem-sourced inputs.
- **Each block reason in isolation:** unlinked doc present → blocks; `src/` change
  without doc change → blocks; coverage below threshold → blocks; a clean repo →
  passes (exit 0).
- **`hook stop` adapter:** given a hook-payload JSON on stdin, emits the correct
  `{decision:"block",reason}` / empty; respects `stop_hook_active`.
- **`index --fix`** appends the missing link; **`docs link`** inserts under the
  category. Re-running `index --check` then passes.
- The verify decision is the guardrail (a security/correctness path) → tightest
  coverage; every reason has a test.

## Acceptance criteria

1. In a repo with an unlinked doc, `hanoman docs verify --block-if-stale` exits 1 and
   names the unlinked file; after `hanoman docs link <path>`, it exits 0.
2. With a `src/` change and no doc change, verify blocks with the freshness reason;
   touching a doc clears it.
3. With coverage below `coverageThreshold`, verify blocks with the coverage reason.
4. `hanoman hook stop` fed a Stop payload on stdin emits a `block` decision when (and
   only when) verify would block, and honors `stop_hook_active`.
5. `.claude/settings.json` invokes `hanoman hook stop`; `ensure-docs-updated.py` no
   longer exists.
6. `hanoman docs scan --json` returns coverage + per-category link status.
7. Tests green. Touched `internal/docs` updated and linked in
   `internal/docs/README.md`.

## Follow-up

SPEC-003 (runner) adds the LLM commands (spec/plan/execute/scaffold/reverse), spawns
Claude Code headless in a git worktree, and calls this guardrail at the plan→execute
boundary — the point ADR-0001 protects.
