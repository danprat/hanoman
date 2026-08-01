# Telegram Operator Gateway (SPEC-476) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. This session uses superpowers:executing-plans inline because the enclosing session contract requires one continuous, isolated worktree execution.

**Goal:** Add an in-process Telegram gateway that binds every allowed private chat to one durable Hanoman operator session, routes natural language and commands through that same session, and delivers safe, explicit session replies without creating a second agent runtime.

**Architecture:** A long-polling gateway starts after the API and session infrastructure are ready. SQLite stores offsets, idempotency claims, chat/session bindings, curated memory, outbox state, confirmation grants, and audit metadata; message bodies and credentials are never stored. Each chat maps to a deterministic tmux session whose Claude/Codex process receives an API-scoped agent token in its environment, while the server enforces capability, correlation, confirmation, sanitization, and at-most-once fail-closed delivery boundaries.

**Tech Stack:** TypeScript, Fastify, Prisma/SQLite, native `fetch`, tmux PTY sessions, React, TanStack Query, Vitest.

**Source of Truth:** `docs/superpowers/specs/2026-08-01-spec-476-telegram-operator-gateway-design.md`, `internal/docs/adr/0096-telegram-gateway-session-operator-persisten.md`, and the linked architecture/product/requirements/security documents.

---

## Task 1: Shared contracts, setting defaults, capabilities, and session kind

**Files:**

- Create: `shared/src/telegram.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/entities.ts`
- Modify: `shared/src/agent.ts`
- Modify: `shared/src/session-kind.ts`
- Test: `shared/src/telegram.test.ts`
- Test: `shared/test/agent.test.ts`
- Test: `shared/src/session-kind.test.ts`

- [x] **Step 1: Write failing shared-contract tests**

  Cover strict Telegram setting parsing/defaults, the `telegram:read` and `telegram:write` capability identifiers, and the `telegram` session-kind label/non-restartable behavior. Cover DTO schemas for gateway status, chat context, memory, reply submission, audit records, and terminal steer/interrupt input.

- [x] **Step 2: Run the focused tests and confirm the expected failures**

  Run: `pnpm vitest --run shared/src/telegram.test.ts shared/test/agent.test.ts shared/src/session-kind.test.ts`

  Expected: failures for missing schemas, settings, capabilities, and session kind; the command must execute actual test files.

- [x] **Step 3: Implement the minimum shared contracts**

  Export typed Zod schemas and inferred types from `shared/src/telegram.ts`, including:

  ```ts
  TelegramSettings { enabled: boolean; progress: boolean }
  TelegramGatewayStatus { configured; enabled; running; readiness; missingCapabilities; lastUpdateAt?; lastError? }
  TelegramChatContext { chatId; userId; sessionId?; projectId?; backlogId?; agent; model?; personalityId? }
  TelegramReplyInput { chatId; updateId; kind; text; summary?; remember?; confirmation? }
  TelegramMemoryRecord { id; chatId; content; createdAt; updatedAt }
  TelegramAuditRecord { id; chatId?; userId?; updateId?; action; outcome; correlationId?; createdAt }
  TerminalSteerInput { text: string }
  ```

  Add `telegram` to `zSetting`, `telegram:read|write` to the capability catalog, and `telegram` to `SESSION_KINDS` without adding it to `RESTARTABLE_SESSION_KINDS`.

- [x] **Step 4: Re-run focused tests**

  Run the same three test files and require non-zero test counts with all passing.

## Task 2: Durable SQLite schema and migration compatibility

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_telegram_gateway/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts`
- Test: `server/test/telegram-schema.test.ts`
- Test: `cli/test/migrate-pg.test.ts`

- [x] **Step 1: Write failing schema/migration tests**

  Assert Prisma DMMF exposes `TelegramGatewayState`, `TelegramChat`, `TelegramUpdate`, `TelegramMemory`, `TelegramOutbox`, `TelegramConfirmation`, and `TelegramAudit`; assert uniqueness/indexes required for update idempotency, one chat binding, outbox ordering, and confirmation lookup. Extend PostgreSQL migration-order coverage for all seven local-only tables.

- [x] **Step 2: Run focused tests and confirm failure**

  Run: `pnpm vitest --run --no-file-parallelism server/test/telegram-schema.test.ts cli/test/migrate-pg.test.ts`

- [x] **Step 3: Add the seven models and SQL migration**

  Use string IDs and ISO/DateTime timestamps consistent with the existing schema. Store only inbound digest/metadata in `TelegramUpdate`; model explicit states for update claims and outbox claims. Do not add bot token, agent token, inbound body, sync version, or PostgreSQL synchronization fields.

- [x] **Step 4: Add all models to `PG_ORDER`**

  Preserve deterministic dependency-safe ordering even though these rows remain local-only in normal operation.

- [x] **Step 5: Generate Prisma client and re-run focused tests**

  Run: `pnpm --filter ./server exec prisma generate`

  Then re-run the two test files serially and require actual passing tests.

## Task 3: Operator prompt and tmux control primitives

**Files:**

- Create: `runner/src/telegram-operator.ts`
- Modify: `runner/src/index.ts`
- Modify: `server/src/services/pty.ts`
- Modify: `server/src/routes/terminal.ts`
- Test: `runner/src/telegram-operator.test.ts`
- Test: `server/test/terminal-telegram.test.ts`

- [x] **Step 1: Write failing prompt and route tests**

  Verify the prompt states that Telegram is a transport, uses existing Hanoman APIs and Source of Truth, references `HANOMAN_TELEGRAM_AGENT_TOKEN` by name without interpolating its value, includes effective custom-agent personality and curated memory, supports the required commands, requires explicit reply events, and never asks the agent to expose reasoning. Verify `POST /api/terminal/sessions/:id/steer` and `/interrupt` require `sessions:write`, validate input, and call PTY services.

- [x] **Step 2: Run focused tests and confirm expected failures**

  Run: `pnpm vitest --run --no-file-parallelism runner/src/telegram-operator.test.ts server/test/terminal-telegram.test.ts`

- [x] **Step 3: Implement prompt construction and tmux controls**

  Add a pure `buildTelegramOperatorPrompt(input)` function. Extend PTY session classification for deterministic `telegram:<chatId>` project IDs, add a direct per-session `interruptPane(sessionId)` primitive using tmux `send-keys Escape`, and expose steer/interrupt routes without shell interpolation.

- [x] **Step 4: Re-run focused tests**

  Require all prompt and route tests to pass serially.

## Task 4: Telegram Bot API client and protocol safety helpers

**Files:**

- Create: `server/src/services/telegram/client.ts`
- Create: `server/src/services/telegram/protocol.ts`
- Test: `server/test/telegram-client.test.ts`
- Test: `server/test/telegram-protocol.test.ts`

- [x] **Step 1: Write failing fake-transport contract tests**

  Test `getUpdates` with offset, limit, timeout, and private-message/callback parsing; `sendMessage`; `editMessageText`; and `answerCallbackQuery`. Test rejection of malformed/non-text/group/non-allowlisted updates, command normalization, callback token length, ANSI/control removal, credential redaction, and Unicode-safe splitting at Telegram's 4096-character limit.

- [x] **Step 2: Run focused tests and confirm expected failures**

  Run: `pnpm vitest --run --no-file-parallelism server/test/telegram-client.test.ts server/test/telegram-protocol.test.ts`

- [x] **Step 3: Implement dependency-injected client and pure helpers**

  Use native `fetch` behind an injected `TelegramTransport`, validate `{ok,result}` envelopes, never include token in errors, use no parse mode, and expose only the Bot API methods needed by the gateway. Keep validation/sanitization/splitting helpers deterministic and independently testable.

- [x] **Step 4: Re-run focused tests**

  Require fake-contract and protocol tests to pass serially.

## Task 5: Persistence, context, memory, reply, audit, and confirmation API

**Files:**

- Create: `server/src/services/telegram/store.ts`
- Create: `server/src/services/telegram/security.ts`
- Create: `server/src/services/telegram/runtime.ts`
- Create: `server/src/routes/telegram.ts`
- Modify: `server/src/services/agent-capabilities.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/telegram-store.test.ts`
- Test: `server/test/telegram-routes.test.ts`
- Test: `server/test/telegram-confirmation.test.ts`

- [x] **Step 1: Write failing store and route tests**

  Cover transactional offset/update insertion, atomic `received -> dispatching`, stale `dispatching -> uncertain`, atomic `pending -> sending`, stale `sending -> uncertain`, durable chat context, memory inspect/create/forget/reset, audit pagination, status redaction, and explicit reply enqueue. Test that all Telegram routes require `telegram:read|write` as appropriate.

- [x] **Step 2: Write failing destructive-confirmation guard tests**

  Authenticate as the configured Telegram gateway AgentToken and require `X-Hanoman-Telegram-Correlation`; block destructive routes without a matching unexpired approved confirmation; consume approval once; preserve all existing capability/route checks. Verify ordinary user/API requests and non-destructive gateway requests retain existing behavior.

- [x] **Step 3: Run focused tests and confirm expected failures**

  Run: `pnpm vitest --run --no-file-parallelism server/test/telegram-store.test.ts server/test/telegram-routes.test.ts server/test/telegram-confirmation.test.ts`

- [x] **Step 4: Implement store, runtime registry, routes, and guard**

  Keep bot credentials outside all service inputs that reach persistence/logging. Register the `telegram` capability domain. Add app hooks only after authentication so the gateway identity is known, match the documented destructive-action matrix, and emit metadata-only audit outcomes for accept/reject/consume paths.

- [x] **Step 5: Re-run focused tests**

  Require all three server test files to pass serially.

## Task 6: Persistent session routing and gateway state machine

**Files:**

- Create: `server/src/services/telegram/session.ts`
- Create: `server/src/services/telegram/gateway.ts`
- Test: `server/test/telegram-session.test.ts`
- Test: `server/test/telegram-gateway.test.ts`

- [x] **Step 1: Write failing session-routing tests**

  Cover deterministic one-chat/one-session reuse, restoration of live tmux sessions after API restart, clearing only stale bindings, inheritance of `sessionAgentDefaults`, effective custom-agent personality resolution, memory/summary injection, initial update embedded in creation prompt, later updates via `sendToPane`, and Claude/Codex parity.

- [x] **Step 2: Write failing gateway lifecycle/idempotency tests**

  With a fake Telegram client and fake PTY/session dependencies, cover long-poll offset recovery, allowlist/private/text validation, per-user rate limiting, duplicate update suppression, fail-closed uncertain claims after crash, normalized command/natural-message forwarding, interrupt callback routing, confirmation callback approval, explicit progress/final/failure/decision delivery, outbox splitting/order, and graceful stop.

- [x] **Step 3: Run focused tests and confirm expected failures**

  Run: `pnpm vitest --run --no-file-parallelism server/test/telegram-session.test.ts server/test/telegram-gateway.test.ts`

- [x] **Step 4: Implement session coordinator**

  Resolve or create one deterministic operator session per allowed chat. Use existing `PtyManager.createSession`, `sendToPane`, `interruptPane`, `stopSession`, project/backlog/session services, and custom-agent catalog. Pass only the gateway agent-token environment variable to the child and never expose its value in prompt/transcript/audit.

- [x] **Step 5: Implement gateway loop**

  Use bounded long polling and an abortable loop. Claim updates and outbox messages before side effects; never automatically retry an uncertain claim. Advance durable offsets in the same transaction as accepted-update insertion. Route every accepted input to the session coordinator and record metadata-only audit entries.

- [x] **Step 6: Re-run focused tests**

  Require all session and gateway tests to pass serially.

## Task 7: Server lifecycle and Settings/onboarding UI

**Files:**

- Modify: `server/src/server.ts`
- Modify: `shared/src/api.ts`
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/SettingsScreen.tsx`
- Test: `server/test/telegram-lifecycle.test.ts`
- Test: `src/src/screens/SettingsScreen.test.tsx`

- [x] **Step 1: Write failing lifecycle and Settings tests**

  Verify the gateway starts only after listen/migrations/custom agents/session history, remains disabled when config or any required environment variable is absent, stops cleanly with the server, and reports readiness without secrets. Verify a Telegram Settings tab shows enable/progress controls, environment/onboarding checklist, running/error/last-update state, and explicit notice that credentials live outside the database/UI.

- [x] **Step 2: Run focused tests and confirm expected failures**

  Run server test serially:

  `pnpm vitest --run --no-file-parallelism server/test/telegram-lifecycle.test.ts`

  Run web test with production `NODE_ENV` removed:

  `env -u NODE_ENV pnpm vitest --run src/src/screens/SettingsScreen.test.tsx`

- [x] **Step 3: Wire lifecycle, API paths/client, and UI**

  Start a single gateway instance from `server.ts`, publish status through the runtime registry used by `/api/telegram/status`, and register shutdown cleanup. Add typed API paths/client calls and the Settings tab without accepting or rendering secret values.

- [x] **Step 4: Re-run focused lifecycle and UI tests**

  Require both focused commands to execute tests and pass.

## Task 8: End-to-end fake Telegram/operator verification and documentation reconciliation

**Files:**

- Create: `server/test/telegram-e2e.test.ts`
- Modify if implementation differs: `docs/superpowers/specs/2026-08-01-spec-476-telegram-operator-gateway-design.md`
- Modify if implementation differs: `internal/docs/adr/0096-telegram-gateway-session-operator-persisten.md`
- Modify if implementation differs: linked `internal/docs/**` files from the spec phase
- Modify: `docs/superpowers/plans/2026-08-01-telegram-operator-gateway-spec-476.md`

- [x] **Step 1: Write the failing live-contract test**

  Start a real local Fastify instance with temporary SQLite, fake Telegram HTTP server, and fake tmux/Claude/Codex executables. Exercise allowlist rejection, first message/session creation, second message/session reuse, command forwarding, explicit reply delivery, duplicate/replayed update, API restart with live session restoration, memory persistence/reset, confirmation callback, interrupt, and both configured agents.

- [x] **Step 2: Run the focused E2E test and fix only observed gaps**

  Run: `pnpm vitest --run --no-file-parallelism server/test/telegram-e2e.test.ts`

  Require the test to execute and pass. Fix implementation with a new failing assertion first for every discovered behavior gap.

- [x] **Step 3: Reconcile Source of Truth and index integrity**

  Update the spec/ADR/linked docs if implementation details changed, while preserving the accepted constraints. Run:

  `hanoman docs index --check`

  Expected: `index ok`.

- [x] **Step 4: Run changed-scope verification only**

  Determine scope with:

  `git diff --name-only "$HANOMAN_BASE_SHA"...HEAD`

  `git status --porcelain`

  Then run:

  `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`

  Confirm the output lists and executes relevant test files (do not accept “no test files”). Run package-scoped typechecks for touched packages only:

  `pnpm --filter ./shared typecheck`

  `pnpm --filter ./runner typecheck`

  `pnpm --filter ./server typecheck`

  `pnpm --filter ./src typecheck`

  `pnpm --filter ./cli typecheck`

  Run configured lint/format checks only on changed source files, plus `git diff --check`. Do not run a full build or unscoped suite.

- [x] **Step 5: Complete every plan checkbox and phase marker**

  Complete every checkbox in this plan, including this step after its checks have run. Verify no
  unchecked task remains in this SPEC-476 plan, and only then append the exact `Execute done` phase
  marker. Commit and push are post-phase finalization required by the session contract, not
  implementation-plan tasks.
