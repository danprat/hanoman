# ADR-0009 — a crashed guardrail tool fails loud, not silent

**Status:** accepted · 2026-07-08 · SPEC-010

## Context
`verifyViaCli` shelled out to `hanoman docs verify` and treated **any** non-zero exit as
"docs stale", discarding `stderr`. RUN-8801 failed opaquely this way: the run did real work
through Plan, then the Execute gate reported `plan diblok · docs verify blocked` while the docs
were actually clean (coverage 100%). The verify subprocess had *crashed*, not reported stale
docs. Root cause: the CLI path was built from `process.cwd()` (`${cwd}/cli/dist/hanoman.js`),
but the dev worker runs from `server/` (`pnpm --filter ./server worker`), so the path pointed
at the non-existent `server/cli/dist/hanoman.js` → a deterministic module-not-found crash.
`@hanoman/cli` is not a dependency of `server`, so node resolution couldn't find it either.

## Decision
Distinguish three outcomes of `docs verify`, not two:
- exit 0 → clean, proceed;
- exit ≠ 0 with valid JSON → genuine policy block, `plan diblok · <violations>`;
- exit ≠ 0 with non-JSON stdout → the tool **crashed**, retried once, then (if still crashing)
  `guardrail tool error · <stderr>` and the run fails **closed**.

The CLI path is resolved independent of `cwd`: walk up to the committed `pnpm-workspace.yaml`
and join `cli/dist/hanoman.js` (`resolveCliEntry`). The one retry is **tool-level** (re-spawns
the verify subprocess); it is not a BullMQ `attempts` bump, so ADR-0005 (`attempts: 1`, no
run-level auto-retry) stands.

## Consequences
- Guardrail failures are diagnosable and no longer masquerade as stale docs; the real `stderr`
  reaches the run log.
- The guardrail works regardless of the worker's launch cwd (`server/` under `pnpm dev`, repo
  root under `node dist/worker.js`) and regardless of src-vs-bundled-dist.
- A guardrail that cannot run never lets Execute proceed (fail-closed, never fail-open).
- No schema change. A future run-level retry policy (SPEC-141) can consume the honest `error`
  signal but does not depend on this ADR.
