# hanoman worker Claude-credential boot guard (SPEC-007) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The run-executing worker verifies a Claude credential at boot and fails fast (or warns) instead of failing silently at the first run.

**Architecture:** A pure, unit-tested `checkRunnerCredentials(env, isTTY)` decides boot/warn/refuse from env + a TTY flag; the worker entrypoint calls it before starting any BullMQ worker and `process.exit(1)`s on refuse.

**Tech Stack:** Node 20+, TypeScript 5 (strict), Vitest. No new dependencies.

## Global Constraints

- **Depends on SPEC-003** (runner drives `@anthropic-ai/claude-agent-sdk`), **SPEC-004** (worker process `server/src/worker.ts`).
- **Presence check only** — no network/token probe (a probe costs tokens + boot latency).
- **Never log a credential value** — only the variable *names* that are set.
- Accepted credential env vars (any one non-empty after `.trim()` counts): `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`.
- **Escape hatch:** `HANOMAN_SKIP_CRED_CHECK` non-empty bypasses the guard (checked first, always wins).
- TypeScript strict; TDD (failing test first); commit after every green step.

## File Structure

```
server/src/runner/credentials.ts        new — checkRunnerCredentials(env?, isTTY?): CredCheck
server/test/runner-credentials.test.ts  new — unit tests for the pure function
server/src/worker.ts                     modify — call the guard in the entrypoint bootstrap block
internal/docs/operations/agent-documentation-workflow.md  modify — one SPEC-007 note (already linked in README)
```

---

### Task 1: `checkRunnerCredentials` pure function + tests

**Files:**
- Create: `server/src/runner/credentials.ts`
- Test: `server/test/runner-credentials.test.ts`

**Interfaces:**
- Produces: `type CredCheck = { ok: boolean; hasEnvCred: boolean; found: string[]; reason?: string }` and `checkRunnerCredentials(env?: NodeJS.ProcessEnv, isTTY?: boolean): CredCheck`.
  - `ok:false` → refuse boot. `hasEnvCred:false` with `ok:true` → warn-and-boot. `found` = names of set cred vars.

- [x] **Step 1: Write the failing test**

```ts
// server/test/runner-credentials.test.ts
import { describe, it, expect } from "vitest";
import { checkRunnerCredentials } from "../src/runner/credentials";

describe("checkRunnerCredentials", () => {
  it("boots (silent) with an OAuth token env cred", () => {
    const r = checkRunnerCredentials({ CLAUDE_CODE_OAUTH_TOKEN: "tok" }, false);
    expect(r).toMatchObject({ ok: true, hasEnvCred: true });
    expect(r.found).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
  it("boots with an API key env cred", () => {
    expect(checkRunnerCredentials({ ANTHROPIC_API_KEY: "k" }, false)).toMatchObject({ ok: true, hasEnvCred: true });
  });
  it("boots with a cloud-provider flag", () => {
    expect(checkRunnerCredentials({ CLAUDE_CODE_USE_BEDROCK: "1" }, false)).toMatchObject({ ok: true, hasEnvCred: true });
  });
  it("warns (ok) with no env cred but a TTY", () => {
    const r = checkRunnerCredentials({}, true);
    expect(r).toMatchObject({ ok: true, hasEnvCred: false });
    expect(r.reason).toBeTruthy();
  });
  it("refuses with no env cred and no TTY", () => {
    const r = checkRunnerCredentials({}, false);
    expect(r).toMatchObject({ ok: false, hasEnvCred: false });
    expect(r.reason).toBeTruthy();
  });
  it("treats a whitespace-only value as absent", () => {
    expect(checkRunnerCredentials({ ANTHROPIC_API_KEY: "   " }, false).ok).toBe(false);
  });
  it("bypass overrides the refuse path", () => {
    expect(checkRunnerCredentials({ HANOMAN_SKIP_CRED_CHECK: "1" }, false)).toMatchObject({ ok: true, hasEnvCred: false });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./server test runner-credentials`
Expected: FAIL — cannot resolve `../src/runner/credentials`.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/runner/credentials.ts

// Env vars any one of which authenticates the Claude Agent SDK (SPEC-007). Order
// mirrors the SDK's resolution precedence; we only check presence (non-empty).
const ENV_CRED_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

export type CredCheck = { ok: boolean; hasEnvCred: boolean; found: string[]; reason?: string };

// Decide whether the worker may boot given the credentials in `env`. Pure: reads
// nothing beyond its args, so it is fully unit-testable. `ok:false` → refuse;
// `ok:true` + `hasEnvCred:false` → warn-and-boot.
export function checkRunnerCredentials(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): CredCheck {
  if ((env.HANOMAN_SKIP_CRED_CHECK ?? "").trim() !== "")
    return { ok: true, hasEnvCred: false, found: [], reason: "credential check bypassed via HANOMAN_SKIP_CRED_CHECK" };
  const found = ENV_CRED_VARS.filter((v) => (env[v] ?? "").trim() !== "");
  if (found.length) return { ok: true, hasEnvCred: true, found };
  if (isTTY)
    return { ok: true, hasEnvCred: false, found, reason: "no Claude credential in env; relying on keychain login (interactive)" };
  return { ok: false, hasEnvCred: false, found, reason: "no Claude credential in env; a headless worker cannot rely on the keychain" };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./server test runner-credentials`
Expected: PASS (7 tests). Then `pnpm --filter ./server typecheck` → no errors.

- [x] **Step 5: Commit**

```bash
git add server/src/runner/credentials.ts server/test/runner-credentials.test.ts
git commit -m "feat(server): checkRunnerCredentials guard (SPEC-007)"
```

---

### Task 2: Wire the guard into the worker bootstrap + docs

**Files:**
- Modify: `server/src/worker.ts` (entrypoint bootstrap block, near line 52-56)
- Modify: `internal/docs/operations/agent-documentation-workflow.md`

**Interfaces:**
- Consumes: `checkRunnerCredentials(): CredCheck` from Task 1 (`./runner/credentials`).

- [ ] **Step 1: Add the import**

At the top of `server/src/worker.ts`, alongside the other `./...` imports, add:

```ts
import { checkRunnerCredentials } from "./runner/credentials";
```

- [ ] **Step 2: Guard the entrypoint bootstrap block**

In `server/src/worker.ts`, the bootstrap runs only when the file is the process entrypoint. Insert the guard as the first thing inside that `if`, before the `(async () => { ... })()` IIFE. Replace:

```ts
if (entry.endsWith("worker.js") || entry.endsWith("worker.ts")) {
  (async () => {
    const worker = new Worker(RUNS_QUEUE, (job) => runProcessor(job), {
```

with:

```ts
if (entry.endsWith("worker.js") || entry.endsWith("worker.ts")) {
  // Fail fast on a misconfigured deployment: a headless worker with no Claude
  // credential in env would otherwise fail silently at the first run (the SDK
  // stream ends without a result). See SPEC-007.
  const cred = checkRunnerCredentials();
  if (!cred.ok) {
    console.error(`[worker] refusing to boot — ${cred.reason}.`);
    console.error("[worker] set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token` for a subscription), or ANTHROPIC_API_KEY, or a cloud-provider flag — see .env.example. Bypass with HANOMAN_SKIP_CRED_CHECK=1.");
    process.exit(1);
  }
  if (cred.hasEnvCred) console.log(`[worker] Claude credential: ${cred.found.join(", ")}`);
  else console.warn(`[worker] ${cred.reason}. Prefer CLAUDE_CODE_OAUTH_TOKEN for headless runs.`);
  (async () => {
    const worker = new Worker(RUNS_QUEUE, (job) => runProcessor(job), {
```

(The IIFE body and its closing `})();` are unchanged.)

- [ ] **Step 3: Verify the existing suite still passes + typecheck**

Run: `pnpm --filter ./server test && pnpm --filter ./server typecheck`
Expected: all green (worker.test.ts imports `runProcessor` without hitting the entrypoint block, so the guard doesn't run under tests).

- [ ] **Step 4: Real local check — refuse path (headless, no cred)**

`.env` provides `CLAUDE_CODE_OAUTH_TOKEN`, and `env.ts` only sets a var when it's `undefined`. Passing `CLAUDE_CODE_OAUTH_TOKEN=` (defined-but-empty) blocks that override; redirecting stdout to a file makes `process.stdout.isTTY` false (headless).

Run from `server/`:
```bash
CLAUDE_CODE_OAUTH_TOKEN= pnpm exec tsx src/worker.ts > /tmp/hanoman-worker-refuse.log 2>&1; echo "exit=$?"
```
Expected: `exit=1`, and `/tmp/hanoman-worker-refuse.log` contains `refusing to boot — no Claude credential in env` plus the how-to-fix line. (Redis/Postgres are never touched — the guard exits first.)

- [ ] **Step 5: Real local check — boot path (cred present)**

Run from `server/` (uses the real `CLAUDE_CODE_OAUTH_TOKEN` from `.env`; background it, grep the log, then kill — Redis + Postgres must be up):
```bash
pnpm exec tsx src/worker.ts > /tmp/hanoman-worker-boot.log 2>&1 &
WPID=$!; sleep 4; grep -E "Claude credential:|worker up" /tmp/hanoman-worker-boot.log; kill $WPID 2>/dev/null
```
Expected: log shows `[worker] Claude credential: CLAUDE_CODE_OAUTH_TOKEN` and `worker up · queue hanoman-runs`. No credential *value* appears in the log.

- [ ] **Step 6: Bypass check**

Run from `server/`:
```bash
CLAUDE_CODE_OAUTH_TOKEN= HANOMAN_SKIP_CRED_CHECK=1 pnpm exec tsx src/worker.ts > /tmp/hanoman-worker-bypass.log 2>&1 &
WPID=$!; sleep 4; grep -E "bypassed|worker up" /tmp/hanoman-worker-bypass.log; kill $WPID 2>/dev/null
```
Expected: log shows the `bypassed via HANOMAN_SKIP_CRED_CHECK` warning and `worker up` (booted despite no cred).

- [ ] **Step 7: Docs — note the guard**

In `internal/docs/operations/agent-documentation-workflow.md`, append a short section (the file is already linked in `internal/docs/README.md`, so no README change):

```markdown
## Worker credentials (SPEC-007)
Worker boot memverifikasi kredensial Claude (Agent SDK). Ada env credential
(`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / flag cloud) →
boot + log nama var-nya (bukan nilainya). Tanpa env credential: headless (non-TTY) →
tolak boot (exit 1); interaktif (TTY) → warning lalu boot (andalkan keychain). Bypass
darurat: `HANOMAN_SKIP_CRED_CHECK=1`. Lihat `.env.example`.
```

- [ ] **Step 8: Commit**

```bash
git add server/src/worker.ts internal/docs/operations/agent-documentation-workflow.md
git commit -m "feat(server): worker Claude-credential boot guard + docs (SPEC-007)"
```

---

## Self-Review

**1. Spec coverage** — DoD/acceptance mapping: env cred → boot+log (T1 logic, T2 wiring, verified T2 S5); no-env+non-TTY → refuse exit 1 (T1, verified T2 S4); no-env+TTY → warn+boot (T1); `HANOMAN_SKIP_CRED_CHECK` bypass (T1, verified T2 S6); pure + unit-tested incl. whitespace-absent + bypass-over-refuse (T1); no value logged / no probe (T1 logic — only `found` names, no network; T2 S5 asserts no value in log); docs linked (T2 S7, file already in README). All acceptance items covered.

**2. Placeholder scan** — no TBD/TODO; every code + command step is complete and runnable.

**3. Type consistency** — `CredCheck { ok, hasEnvCred, found, reason? }` and `checkRunnerCredentials(env?, isTTY?)` are used identically in Task 1 (definition + tests) and Task 2 (`cred.ok` / `cred.hasEnvCred` / `cred.found` / `cred.reason`). `ENV_CRED_VARS` is internal to `credentials.ts` and not referenced elsewhere.

**Executor notes:** Task 2's real-local checks need Redis + Postgres up (they are, per the project's docker setup) only for the boot/bypass paths; the refuse path exits before touching them. `env.ts` loads root `.env`, so `CLAUDE_CODE_OAUTH_TOKEN=` on the command line (defined-but-empty) is what forces the no-cred path despite `.env`.
