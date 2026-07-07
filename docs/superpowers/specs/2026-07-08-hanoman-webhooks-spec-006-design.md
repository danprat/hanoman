# SPEC-006 — hanoman GitHub App + commit webhooks

**Date:** 2026-07-08
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (this spec is subordinate to it)
**Depends on:** SPEC-001 (Project/Run/Trigger models, routes), SPEC-003 (runner git
ops), SPEC-004 (`enqueueRun`), SPEC-005 (`fireTrigger` target→runs mapping)

## Place in the sequence

Sixth and last of the fully-real sequence. SPEC-006 makes `commit` triggers real via a
GitHub App: verified push events enqueue runs, repos are cloned on demand with
installation tokens, the runner pushes results back authenticated, and run outcomes are
reported as GitHub commit statuses.

## Context

`stack.md` specifies a GitHub App; `security-standard.md` requires webhook signature
verification and server-side-only credentials; `api-contract.md` defines
`POST /webhooks/github`. The runner (ADR-0002) operates on a local `repoDir` and pushes
to `branchTo`. SPEC-004 provides durable enqueue; SPEC-005 provides `fireTrigger`
(target→runs). SPEC-006 wires GitHub in.

## Goal

A GitHub App whose webhook receiver verifies and handles `push`/`installation` events,
enqueues runs for matching `commit` triggers, clones/pushes private repos with
installation tokens, and reports run status back to GitHub.

Definition of done:
- A signed `push` to a watched branch enqueues the right run(s); a bad signature is
  rejected `401`.
- A github-triggered run clones the repo if missing, executes, and pushes to `branchTo`
  authenticated.
- Run start/done/fail post `pending`/`success`/`failure` commit statuses.
- Installation↔repo mapping is tracked from `installation` events.
- Tests green (GitHub calls faked); one opt-in live test passes when enabled.
- Touched `internal/docs` updated + linked; ADR-0005 added.

## Approaches considered

- **Auth/verification:** hand-rolled App JWT + HMAC vs. **Octokit**
  (`@octokit/app`, `@octokit/auth-app`, `@octokit/webhooks`). **Decision: Octokit** —
  GitHub App auth and signature verification are security-sensitive and well-solved;
  don't reinvent.
- **Integration depth (decided in brainstorm):** receive+verify only vs. **full GitHub
  App** (installation tokens, clone-on-demand, tokenized push, status checks).
  **Decision: full GitHub App.**

## Scope

### In scope
- `server/src/github/app.ts` — Octokit App: app JWT → cached installation tokens
  (`installationToken(installationId)`), an `octokitFor(installationId)` client.
- `server/src/github/webhooks.ts` — Octokit Webhooks verify (`X-Hub-Signature-256`) +
  handlers for `push`, `installation`, `installation_repositories`, `ping`.
- `server/src/routes/webhooks.ts` — `POST /webhooks/github` (raw-body enabled) → the
  webhook handler; `401` on bad signature.
- Push→runs: match `repository.full_name` + branch → project + enabled `commit`
  triggers → `fireTrigger(trigger, { branch, sha })` (the shared mapping extracted from
  SPEC-005). `branchFrom` = pushed branch; `branchTo` from trigger (default
  `hanoman/<run-id>`).
- `ensureClone(project)` — clone with `https://x-access-token:<token>@github.com/<full>`
  if `repoDir` is missing, before the worktree is added.
- Tokenized push: inject an ephemeral installation token into the runner's clone/push
  for github-backed runs (a credential-helper / tokenized-remote tweak to SPEC-003
  `git.ts`).
- Status checks: a subscriber on run **status** events posts commit statuses (`pending`
  on start, `success`/`failure` on end) for runs with a `commitSha`.
- Schema (ADR-0005): `GithubInstallation`, `Project.installationId?`,
  `Run.commitSha?` + `Run.reportRepo?`.
- Secrets: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` in env
  (server-side only; installation tokens minted on demand, never persisted).

### Out of scope (v1.1+)
OAuth user login, PR creation/review comments, GitHub Checks API (rich annotations),
multi-tenant installations UI. Basic commit *statuses* only.

## Flow

```
GitHub push ──► POST /webhooks/github
                 │ Octokit verifies X-Hub-Signature-256 (raw body)  ─ bad ─► 401
                 ▼
             push handler: repo full_name + ref branch + head sha
                 │ match Project(repoUrl) + enabled commit triggers (branch match)
                 ▼
             fireTrigger(trigger, {branch, sha})  ─► enqueueRun (SPEC-004/005)
                 ▼  (worker, SPEC-003/004)
             ensureClone(project) ─► runOne (worktree) ─► commitAndPush (tokenized)
                 ▼  status events
             statusReporter ─► POST /repos/:o/:r/statuses/:sha (pending→success/failure)
```

## Auth details

- App JWT: RS256 over `{iss: appId}`, 10-min expiry, from the PEM key (Octokit handles).
- Installation token: `POST /app/installations/:id/access_tokens`, cached in-memory with
  a TTL margin (< 1h), minted on demand. Never written to the DB or sent to the client.
- Repo→installation: from `installation`/`installation_repositories` events, upsert
  `GithubInstallation`; a `Project` links via `installationId`.

## Signature verification

Octokit Webhooks `verifyAndReceive({ id, name, signature, payload })` with the raw body.
Fastify must expose the raw body for this route (a `preValidation`/`addContentTypeParser`
that keeps `request.rawBody`). Invalid signature → `401`, no side effects.

## Status checks

A `statusReporter` subscribes to run status events (via the SPEC-004 `run:<id>:events`
channel). For a run with `commitSha` + `reportRepo`: on `running` → `pending`; on `done`
→ `success`; on `failed`/`stopped` → `failure`. Uses `octokitFor(installationId)`.

## Testing (TDD, per CLAUDE.md)

GitHub calls are faked (injected Octokit-like clients); signature signing uses Octokit's
own helper.
- **Signature:** a correctly-signed payload is accepted; a tampered body → `401`.
- **Push match:** a `push` to a watched branch with an enabled `commit` trigger calls
  `fireTrigger` with `{branch, sha}`; a non-watched branch or disabled trigger enqueues
  nothing; unknown repo → ignored `202`.
- **Installation events** upsert `GithubInstallation`; `ping` → `200`.
- **ensureClone** clones only when `repoDir` is missing (fake git).
- **Tokenized push** injects the token into the remote (assert the URL/credential-helper
  invocation, token redacted in logs).
- **statusReporter** posts `pending`/`success`/`failure` on the matching status events
  (fake Octokit), and does nothing for runs without a `commitSha`.
- **Opt-in live test** (`HANOMAN_LIVE_GITHUB=1`): against a real test App + repo; skipped
  by default.

## Acceptance criteria

1. A signed `push` to a watched branch enqueues the target's run(s) via `fireTrigger`; a
   bad `X-Hub-Signature-256` → `401` with no side effects.
2. `installation`/`installation_repositories` events keep `GithubInstallation` in sync;
   `ping` → `200`.
3. A github-triggered run clones the repo when `repoDir` is missing and pushes results
   to `branchTo` authenticated with an installation token.
4. Run start/done/fail post `pending`/`success`/`failure` commit statuses to the head
   `sha`; runs without a `commitSha` post nothing.
5. Secrets stay server-side; installation tokens are minted on demand and never
   persisted or sent to the client.
6. Tests green (GitHub faked); the live test passes when `HANOMAN_LIVE_GITHUB=1`.
7. ADR-0005 added; touched `internal/docs` linked in `internal/docs/README.md`.

## Sequence complete

With SPEC-006, all four trigger types are real (manual, schedule, interval, commit) and
the whole hanoman v1.0 is wired end-to-end: docs-as-SoT dashboard (001) · CLI + guardrail
(002) · runner (003) · durable queue (004) · scheduler (005) · GitHub App (006). Retry
policy, Slack notifications, and cost reporting remain roadmap v1.1.
