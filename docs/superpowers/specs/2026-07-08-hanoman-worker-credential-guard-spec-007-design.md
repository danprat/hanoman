# SPEC-007 — hanoman worker Claude-credential boot guard

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-003 (runner uses `@anthropic-ai/claude-agent-sdk`), SPEC-004 (worker
process `server/src/worker.ts`)

## Place in the sequence

First operability item after the v1.0 sequence (001–006). Small hardening: the runner
authenticates to Claude via the Agent SDK, but nothing verifies a credential exists
until the SDK actually runs a phase. On a headless worker that resolves auth from the
macOS keychain (`claude login`), the first run can fail — and the stream ends **without a
`result`**, i.e. silently — instead of failing fast at boot. This spec adds a boot-time
guard.

## Context

`server/src/worker.ts` is the run-executing process (`node dist/worker.js`). Its
`runProcessor` calls the runner's `runOne`, which drives `@anthropic-ai/claude-agent-sdk`
`query()` with no explicit `apiKey`. The SDK resolves credentials in this precedence
order (verified against the Agent SDK auth docs):

1. Cloud provider — `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` / `CLAUDE_CODE_USE_FOUNDRY`
2. `ANTHROPIC_AUTH_TOKEN` (gateway bearer)
3. `ANTHROPIC_API_KEY` (Console API)
4. `CLAUDE_CODE_OAUTH_TOKEN` (subscription token from `claude setup-token`)
5. Subscription OAuth from `claude login` (macOS keychain / `~/.claude/.credentials.json`)

Observed: with `CLAUDE_CODE_OAUTH_TOKEN` set in `.env`, a real `query()` returns
`result subtype=success`. With no env credential and only the keychain login, a
**background/daemon** worker cannot reliably read the keychain (access can block or fail
when not launched from an interactive login session), and the SDK stream then closes
with no `result` — a silent first-run failure. `.env.example` already documents
`CLAUDE_CODE_OAUTH_TOKEN`; this spec makes a missing credential fail loudly at boot.

## Goal

At worker startup, deterministically verify a Claude credential is configured and either
boot, warn, or refuse — so a misconfigured deployment fails fast with a clear message
instead of silently at the first run.

Definition of done:
- Worker boot with an env credential present → boots, logs which credential var is set
  (name only, never the value).
- Worker boot with **no** env credential, **non-interactive** (no TTY: detached / daemon /
  CI) → refuses to boot (`process.exit(1)`) with an actionable message.
- Worker boot with **no** env credential but **interactive** (TTY present) → warns
  (keychain may work interactively) and boots.
- A pure, unit-tested credential-check function; no network probe.
- Touched `internal/docs` updated + linked.

## Approaches considered

- **Pure function + thin bootstrap wiring** (chosen): a testable
  `checkRunnerCredentials(env, isTTY)` in `server/src/runner/credentials.ts`; the worker
  entrypoint calls it and exits/warns/logs. Unit-testable without booting a worker.
- **Inline in `worker.ts`**: a few lines in the bootstrap block. Less code, but the
  bootstrap only runs as the process entrypoint, so the logic can't be unit-tested.
- **Shared boot module for server + worker**: rejected — the API process (`server.ts`)
  never runs the SDK, so it must not be blocked by a missing Claude credential.

## Scope

### In scope
- `server/src/runner/credentials.ts` — `checkRunnerCredentials(env?, isTTY?): CredCheck`,
  a pure function over env + a TTY flag.
- `server/src/worker.ts` — call the check in the entrypoint bootstrap block (before
  `new Worker(...)`); `exit(1)` / `warn` / `log` per the result.
- Escape hatch: `HANOMAN_SKIP_CRED_CHECK` (non-empty) bypasses the guard entirely and
  boots (logged as a warning so it's visible). Covers auth methods the env-var list can't
  see — e.g. `apiKeyHelper` (a Claude-settings credential script), or a future method —
  so the guard can never be an un-overridable blocker.
- `server/test/runner-credentials.test.ts` — unit tests for the pure function.

### Out of scope
- GitHub App env validation — already fails observably: `githubApp()` throws a clear
  error and the webhook route returns `500` + logs; not silent.
- Live token/network probe — presence only (a probe costs tokens and adds boot latency).
- Surfacing credential status to the dashboard / settings API.
- Guarding the API process (`server.ts`) — it doesn't run the SDK.
- Detecting settings-based `apiKeyHelper`: not visible from env, so it reads as "no env
  cred". A headless deployment relying on it sets `HANOMAN_SKIP_CRED_CHECK` (or an env
  credential); documented, not auto-detected.

## Behavior

```
worker entrypoint (node dist/worker.js)
  └─ checkRunnerCredentials(process.env, !!process.stdout.isTTY)
       ├─ HANOMAN_SKIP_CRED_CHECK non-empty    → { ok:true,  hasEnvCred:false }  → console.warn "credential check bypassed", boot
       ├─ env has a non-empty cred var         → { ok:true,  hasEnvCred:true  }  → log "Claude credential: <VAR>", boot
       ├─ no env cred + TTY (interactive)      → { ok:true,  hasEnvCred:false }  → console.warn (keychain, ok interactive / unreliable headless), boot
       └─ no env cred + no TTY (headless)      → { ok:false }                    → console.error(reason + how-to-fix), process.exit(1)
```

`HANOMAN_SKIP_CRED_CHECK` is checked first so an explicit bypass always wins.

Credential env vars (any one non-empty after trim counts as present):
`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`.

Interface:

```ts
export type CredCheck = { ok: boolean; hasEnvCred: boolean; found: string[]; reason?: string };
export function checkRunnerCredentials(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): CredCheck;
```

Refuse/warn message names the accepted vars and points to the fix: set
`CLAUDE_CODE_OAUTH_TOKEN` (run `claude setup-token` for a subscription), or
`ANTHROPIC_API_KEY`, or a cloud-provider flag; see `.env.example`. **Only variable names
are ever logged — never their values.**

## Testing (TDD, per CLAUDE.md)

Pure-function unit tests (no boot, no network):
- `CLAUDE_CODE_OAUTH_TOKEN` set → `ok:true, hasEnvCred:true`, `found` includes it.
- `ANTHROPIC_API_KEY` set → `ok:true, hasEnvCred:true`.
- empty env + `isTTY:true` → `ok:true, hasEnvCred:false`, `reason` set (warn path).
- empty env + `isTTY:false` → `ok:false, hasEnvCred:false`, `reason` set (refuse path).
- whitespace-only value → treated as absent.
- `HANOMAN_SKIP_CRED_CHECK` set + empty env + `isTTY:false` → `ok:true` (bypass wins over refuse).
- The `exit(1)` / `console` wiring in the worker bootstrap is entrypoint-only and not
  unit-tested (consistent with the existing worker bootstrap, which runs only as
  `node dist/worker.js`).

Real local check (per CLAUDE.md): run the worker entrypoint with an empty credential env
and no TTY → observe exit code 1 + the message; with `CLAUDE_CODE_OAUTH_TOKEN` set →
observe it boots and logs the credential var name.

## Acceptance criteria

1. With any accepted env credential set, the worker boots and logs the credential var
   name (never the value).
2. With no env credential and no TTY (headless), the worker refuses to boot, exits `1`,
   and prints an actionable message naming the accepted vars + `claude setup-token`.
3. With no env credential but a TTY (interactive), the worker warns and boots.
4. `HANOMAN_SKIP_CRED_CHECK` (non-empty) bypasses the guard in any case and boots with a
   visible warning.
5. `checkRunnerCredentials` is pure and unit-tested for all branches, including
   whitespace-only values treated as absent and the bypass overriding the refuse path.
6. No credential value is ever logged; no network probe is made.
7. Tests green; touched `internal/docs` linked in `internal/docs/README.md`.
