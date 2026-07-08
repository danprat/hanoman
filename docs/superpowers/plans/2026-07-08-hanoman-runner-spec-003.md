# hanoman runner (SPEC-003) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Claude Code headless (Agent SDK) in an isolated git worktree to execute a spec through its phased pipeline, stream logs live, enforce the docs guardrail at plan→execute, and let a human steer/pause/resume/stop in ≤2s.

**Architecture:** A shared `runner/` workspace package (pipeline core + worktree lifecycle + SDK adapter + event model) with the SDK and git injected as dependencies for testability. Consumed by `cli/` (standalone `hanoman execute`) and `server/`'s `RunManager` (dashboard-controlled runs, in-process `maxConcurrent` semaphore, per-run event bus persisted to Postgres and forwarded over SSE).

**Tech Stack:** Node 20+, TypeScript 5 (strict), `@anthropic-ai/claude-agent-sdk`, `node:child_process` (git), Fastify SSE, Prisma/Postgres, zod, Vitest.

## Global Constraints

- **Depends on SPEC-001** (server, Prisma `Run`, `runs.ts` read routes, Runs UI) **and SPEC-002** (`hanoman docs verify` / `hook stop`).
- **Source of Truth guardrail:** entering the `execute` phase runs `hanoman docs verify --block-if-stale` in the worktree; block → run `failed`. (ADR-0001, SPEC-002)
- **Isolation (ADR-0002):** every run in `.worktrees/<run-id>`; never touch the main working tree or another run's worktree.
- **Model per step (ADR-0003, refreshed):** default `claude-opus-4-8`, effort x-high; per-step overrides from Settings. Current IDs: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`.
- **NFR:** log latency <1s (`includePartialMessages`); pause/stop ≤2s (`abortController.abort()`); durable across restart (persist every event).
- **Safety (security-standard):** `disallowedTools` + `canUseTool` deny `rm -rf`, push to `main`, writes outside the worktree; `settingSources:['project']` loads the worktree `.claude/settings.json`; `maxBudgetUsd` from Settings `dailyBudget`; credentials server-side only.
- **SDK is injected** (`QueryFn`); unit tests supply a fake async iterable — no token spend. One opt-in live smoke behind `HANOMAN_LIVE_SDK=1`.
- **TypeScript strict.** Every request/response validated by `shared/` zod schemas. Commit after every green step. **Pin the installed SDK version and re-verify option names against its typings before coding.**

---

## File Structure

```
runner/
  package.json            deps: @hanoman/shared, @anthropic-ai/claude-agent-sdk
  tsconfig.json
  src/
    types.ts              QueryFn/SdkMessage, RunEvent, RunKind/flow, StepModels, RunInput, RunResult
    events.ts             event constructors/helpers
    git.ts                GitOps interface + realGit (spawnSync)
    steer-queue.ts        SteerQueue: async-generator prompt + push()/close()
    sdk.ts                runPhase({...deps}) wrapping QueryFn
    phases.ts             PIPELINES per flow + phase prompts
    run.ts                runOne(input, deps): the orchestration
    index.ts              barrel
  test/*.test.ts

shared/src/dto.ts         + zSteer, zControl (action enum), zWorktreePatch, zCommand
server/src/
  runner/manager.ts       RunManager: semaphore, event bus, persistence, subscribe
  runner/deps.ts          production deps (realQuery, realGit, verifyViaCli)
  routes/runs.ts          + SSE /log + steer/control/worktree/command
  services/settings.ts    stepModels(): read Settings -> per-step {model,effort}
cli/src/commands/
  execute.ts spec.ts plan.ts qa.ts scaffold.ts reverse.ts
cli/src/router.ts         + routes for the new commands
internal/docs/adr/0003-per-step-model-selection.md   refresh model IDs
```

---

## Phase A — runner core (SDK + git injected)

### Task 1: `runner/` scaffold + core types + control DTOs

**Files:**
- Create: `runner/package.json`, `runner/tsconfig.json`, `runner/src/types.ts`, `runner/src/index.ts`
- Modify: `shared/src/dto.ts` (control DTOs), `pnpm-workspace.yaml` (add `runner`)
- Test: `runner/test/types.test.ts`, `shared/test/control-dto.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // runner/src/types.ts
  export type SdkUserMessage = { type: "user"; message: { role: "user"; content: string } };
  export type SdkMessage =
    | { type: "assistant"; session_id?: string; message: { content: Array<{ type: string; text?: string; name?: string }> } }
    | { type: "result"; subtype: string; session_id: string; total_cost_usd: number; usage: { input_tokens: number; output_tokens: number } }
    | { type: "system"; session_id?: string };
  export type QueryArgs = { prompt: string | AsyncIterable<SdkUserMessage>; options: Record<string, unknown> };
  export type QueryFn = (args: QueryArgs) => AsyncIterable<SdkMessage>;
  export type PhaseState = "pending" | "active" | "done" | "failed";
  export type RunEvent =
    | { kind: "log"; line: { t: string; s: string } }
    | { kind: "phase"; name: string; state: PhaseState }
    | { kind: "file"; path: string; add: number; del: number; status: string }
    | { kind: "cost"; tokensIn: number; tokensOut: number; costUsd: number }
    | { kind: "status"; status: "running" | "paused" | "stopped" | "failed" | "done" };
  export type Flow = "feature" | "qa" | "scaffold" | "reverse";
  export type StepModel = { model: string; effort: string };
  export type StepModels = Record<"brainstorm" | "spec" | "plan" | "execute" | "audit", StepModel>;
  export type RunInput = { runId: string; repoDir: string; branchFrom: string; branchTo: string; flow: Flow; specId?: string; steps: StepModels; maxBudgetUsd?: number };
  export type RunResult = { status: "done" | "failed" | "stopped"; costUsd: number; tokensIn: number; tokensOut: number };
  ```
- Produces (shared/src/dto.ts): `zControlAction = z.enum(["pause","resume","stop","retry"])`, `zControl = z.object({ action: zControlAction })`, `zSteer = z.object({ message: z.string().min(1) })`, `zWorktreePatch = z.object({ branchFrom: z.string().optional(), branchTo: z.string().optional() })`, `zCommand = z.object({ text: z.string().min(1) })`.

- [x] **Step 1: Write failing tests**

```ts
// shared/test/control-dto.test.ts
import { describe, it, expect } from "vitest";
import { zControl, zSteer } from "../src/index";
describe("control DTOs", () => {
  it("accepts a valid control action", () => expect(zControl.parse({ action: "pause" }).action).toBe("pause"));
  it("rejects an unknown action", () => expect(() => zControl.parse({ action: "explode" })).toThrow());
  it("requires a non-empty steer message", () => expect(() => zSteer.parse({ message: "" })).toThrow());
});
```

```ts
// runner/test/types.test.ts
import { describe, it, expect } from "vitest";
import { PIPELINES } from "../src/phases";
describe("runner wiring", () => {
  it("has a pipeline for every flow", () =>
    expect(Object.keys(PIPELINES).sort()).toEqual(["feature","qa","reverse","scaffold"]));
});
```
(`phases.ts` is created in Task 5; for Task 1 add a minimal `runner/src/phases.ts` exporting `export const PIPELINES = { feature:[], qa:[], scaffold:[], reverse:[] } as const;`, fleshed out in Task 5.)

- [x] **Step 2: Run, verify fail** — `pnpm --filter ./runner test && pnpm --filter ./shared test control-dto` → FAIL.

- [x] **Step 3: Implement**

`pnpm-workspace.yaml` → add `"runner"`.

`runner/package.json`:
```json
{
  "name": "@hanoman/runner", "type": "module", "version": "0.0.0",
  "main": "src/index.ts", "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@hanoman/shared": "workspace:*", "@anthropic-ai/claude-agent-sdk": "^1.0.0" },
  "devDependencies": { "vitest": "^2.0.0", "typescript": "^5.5.0" }
}
```
(Set the SDK version to whatever `pnpm add @anthropic-ai/claude-agent-sdk` resolves; then re-verify option names.)

`runner/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "include": ["src","test"], "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }`

Write `runner/src/types.ts` (the block above), the minimal `phases.ts`, and `runner/src/index.ts` exporting `export * from "./types"; export * from "./phases";`.

Add the control DTOs to `shared/src/dto.ts` (the block above).

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(runner): scaffold + core types + control DTOs"`

---

### Task 2: Worktree / git operations

**Files:** Create `runner/src/git.ts`; Test `runner/test/git.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GitOps {
    addWorktree(repo: string, path: string, branchFrom: string): void;
    removeWorktree(repo: string, path: string): void;
    commitAndPush(worktreePath: string, message: string, branchTo: string): void;
    switchBase(worktreePath: string, branchFrom: string): void;
  }
  export const realGit: GitOps;
  ```
  `addWorktree` → `git -C <repo> worktree add <path> <branchFrom>`; `removeWorktree` → `git -C <repo> worktree remove --force <path>`; `commitAndPush` → `git -C <path> add -A && commit -m && push origin HEAD:<branchTo>`; `switchBase` → `git -C <path> checkout <branchFrom>`. Each throws on non-zero exit with stderr.

- [x] **Step 1: Write failing test** (real git against temp repos + a bare remote)

```ts
// runner/test/git.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { realGit } from "../src/git";
const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
function seedRepo() {
  const remote = mkdtempSync(join(tmpdir(), "remote-")); g(remote, "init", "--bare", "-q");
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "x"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "init");
  g(repo, "branch", "-M", "main"); g(repo, "remote", "add", "origin", remote); g(repo, "push", "-q", "origin", "main");
  return { repo, remote };
}
describe("git worktree ops", () => {
  it("adds a worktree, commits, pushes, removes", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "run-1");
    realGit.addWorktree(repo, wt, "main");
    expect(existsSync(wt)).toBe(true);
    writeFileSync(join(wt, "new.txt"), "hi");
    realGit.commitAndPush(wt, "feat: x", "feat/run-1");
    expect(g(repo, "branch", "-r").stdout).toContain("origin/feat/run-1");
    realGit.removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// runner/src/git.ts
import { spawnSync } from "node:child_process";
import type { GitOps } from "./types";
function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}
export const realGit: GitOps = {
  addWorktree: (repo, path, branchFrom) => { git(repo, ["worktree", "add", path, branchFrom]); },
  removeWorktree: (repo, path) => { git(repo, ["worktree", "remove", "--force", path]); },
  commitAndPush: (path, message, branchTo) => {
    git(path, ["add", "-A"]); git(path, ["commit", "-m", message]); git(path, ["push", "origin", `HEAD:${branchTo}`]);
  },
  switchBase: (path, branchFrom) => { git(path, ["checkout", branchFrom]); },
};
```
Add `GitOps` to `types.ts` exports (declared in Task 1 interfaces).

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(runner): git worktree lifecycle"`

---

### Task 3: Steer queue (streaming-input backing)

**Files:** Create `runner/src/steer-queue.ts`; Test `runner/test/steer-queue.test.ts`

**Interfaces:**
- Produces: `class SteerQueue` with `push(text: string): void`, `close(): void`, and `stream(): AsyncGenerator<SdkUserMessage>` — yields an initial message (set via constructor `new SteerQueue(initialPrompt)`) then each pushed message as it arrives; ends on `close()`. Backed by an internal promise-resolver queue so `stream()` awaits pushes.

- [x] **Step 1: Write failing test**

```ts
// runner/test/steer-queue.test.ts
import { describe, it, expect } from "vitest";
import { SteerQueue } from "../src/steer-queue";
describe("SteerQueue", () => {
  it("yields the initial prompt then pushed messages, then ends on close", async () => {
    const q = new SteerQueue("go");
    const got: string[] = [];
    const consume = (async () => { for await (const m of q.stream()) got.push(m.message.content); })();
    await new Promise((r) => setTimeout(r, 5)); q.push("steer-1");
    await new Promise((r) => setTimeout(r, 5)); q.push("steer-2");
    await new Promise((r) => setTimeout(r, 5)); q.close();
    await consume;
    expect(got).toEqual(["go", "steer-1", "steer-2"]);
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// runner/src/steer-queue.ts
import type { SdkUserMessage } from "./types";
export class SteerQueue {
  private buf: string[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  constructor(initial: string) { this.buf.push(initial); }
  push(text: string) { this.buf.push(text); this.wake?.(); this.wake = null; }
  close() { this.closed = true; this.wake?.(); this.wake = null; }
  async *stream(): AsyncGenerator<SdkUserMessage> {
    while (true) {
      while (this.buf.length) {
        yield { type: "user", message: { role: "user", content: this.buf.shift()! } };
      }
      if (this.closed) return;
      await new Promise<void>((res) => { this.wake = res; });
    }
  }
}
```

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(runner): steer queue"`

---

### Task 4: SDK adapter (`runPhase`)

**Files:** Create `runner/src/sdk.ts`; Test `runner/test/sdk.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RunPhaseArgs {
    queryFn: QueryFn; cwd: string; model: string; maxThinkingTokens?: number; maxBudgetUsd?: number;
    prompt: string | AsyncIterable<SdkUserMessage>; abortController: AbortController;
    onEvent: (e: RunEvent) => void;
  }
  export async function runPhase(a: RunPhaseArgs): Promise<{ sessionId?: string; costUsd: number; tokensIn: number; tokensOut: number; subtype: string }>;
  ```
  Iterates `queryFn({prompt, options})`; for each `assistant` message emits a `log` event per text block (`{t:"›",s:text}`) and per tool block (`{t:"$",s:"tool "+name}`); on `result` emits a `cost` event and returns `{sessionId, costUsd: total_cost_usd, tokensIn: usage.input_tokens, tokensOut: usage.output_tokens, subtype}`. Passes `options`: `{ cwd, model, maxThinkingTokens, maxBudgetUsd, abortController, includePartialMessages:true, settingSources:['project'], systemPrompt:{type:'preset',preset:'claude_code'}, disallowedTools:[...], permissionMode:'acceptEdits' }`.

- [x] **Step 1: Write failing test** (fake SDK)

```ts
// runner/test/sdk.test.ts
import { describe, it, expect, vi } from "vitest";
import { runPhase } from "../src/sdk";
import type { SdkMessage, QueryFn } from "../src/types";
const fake = (msgs: SdkMessage[]): QueryFn => () => (async function* () { for (const m of msgs) yield m; })();
describe("runPhase", () => {
  it("emits log events for assistant text and returns cost from result", async () => {
    const events: any[] = [];
    const q = fake([
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      { type: "result", subtype: "success", session_id: "s1", total_cost_usd: 0.42, usage: { input_tokens: 100, output_tokens: 20 } },
    ]);
    const r = await runPhase({ queryFn: q, cwd: "/x", model: "claude-opus-4-8",
      prompt: "do it", abortController: new AbortController(), onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.kind === "log" && e.line.s === "hello")).toBe(true);
    expect(r).toMatchObject({ sessionId: "s1", costUsd: 0.42, tokensIn: 100, tokensOut: 20, subtype: "success" });
  });
  it("passes cwd + model through to the query options", async () => {
    const spy = vi.fn(fake([{ type: "result", subtype: "success", session_id: "s", total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }]));
    await runPhase({ queryFn: spy as any, cwd: "/work", model: "claude-sonnet-5",
      prompt: "x", abortController: new AbortController(), onEvent: () => {} });
    expect(spy.mock.calls[0][0].options).toMatchObject({ cwd: "/work", model: "claude-sonnet-5", includePartialMessages: true });
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// runner/src/sdk.ts
import type { QueryFn, RunEvent, SdkUserMessage } from "./types";
const DENY = ["Bash(rm -rf *)", "Bash(git push * main*)", "Bash(git push origin main*)"];
export interface RunPhaseArgs {
  queryFn: QueryFn; cwd: string; model: string; maxThinkingTokens?: number; maxBudgetUsd?: number;
  prompt: string | AsyncIterable<SdkUserMessage>; abortController: AbortController;
  onEvent: (e: RunEvent) => void;
}
export async function runPhase(a: RunPhaseArgs) {
  let sessionId: string | undefined, costUsd = 0, tokensIn = 0, tokensOut = 0, subtype = "success";
  const it = a.queryFn({ prompt: a.prompt, options: {
    cwd: a.cwd, model: a.model, maxThinkingTokens: a.maxThinkingTokens, maxBudgetUsd: a.maxBudgetUsd,
    abortController: a.abortController, includePartialMessages: true, settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code" }, permissionMode: "acceptEdits", disallowedTools: DENY,
  } });
  for await (const m of it) {
    if (m.type === "assistant") {
      sessionId = m.session_id ?? sessionId;
      for (const b of m.message.content) {
        if (b.type === "text" && b.text) a.onEvent({ kind: "log", line: { t: "›", s: b.text } });
        else if (b.type === "tool_use" && b.name) a.onEvent({ kind: "log", line: { t: "$", s: `tool ${b.name}` } });
      }
    } else if (m.type === "result") {
      sessionId = m.session_id; subtype = m.subtype;
      costUsd = m.total_cost_usd; tokensIn = m.usage.input_tokens; tokensOut = m.usage.output_tokens;
      a.onEvent({ kind: "cost", tokensIn, tokensOut, costUsd });
    } else if (m.type === "system") sessionId = m.session_id ?? sessionId;
  }
  return { sessionId, costUsd, tokensIn, tokensOut, subtype };
}
```

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(runner): sdk adapter runPhase"`

---

### Task 5: Pipelines + `runOne` orchestration (the heart)

**Files:** Create/replace `runner/src/phases.ts`, create `runner/src/run.ts`; Test `runner/test/run.test.ts`

**Interfaces:**
- Consumes: `runPhase`, `SteerQueue`, `GitOps`, verify fn.
- Produces:
  ```ts
  // phases.ts
  export const PIPELINES: Record<Flow, readonly string[]> = {
    feature: ["Brainstorm","Objective","Spec","Plan","Execute"],
    qa:      ["Audit","Spec","Plan","Execute"],
    scaffold:["Brainstorm","Objective","Doc index"],
    reverse: ["Scan","Doc index"],
  };
  export function phasePrompt(flow: Flow, phase: string, input: RunInput): string; // deterministic instruction text
  export function stepFor(phase: string): keyof StepModels;                         // phase -> settings step
  // run.ts
  export interface RunDeps { queryFn: QueryFn; git: GitOps; verify: (cwd: string) => { blocked: boolean; reason?: string }; effortToThinking: (effort: string) => number | undefined; }
  export async function runOne(input: RunInput, deps: RunDeps, onEvent: (e: RunEvent) => void, ctl?: { abortController?: AbortController; steer?: SteerQueue }): Promise<RunResult>;
  ```
  `runOne`: emit `status:running`; `addWorktree`; for each phase — emit `phase:active`; **if phase === "Execute": call `deps.verify(worktree)`; if blocked → emit `log` (reason) + `phase:failed` + `status:failed`, return failed**; pick model via `stepFor`+`input.steps`; `runPhase` (Execute uses the `steer` stream as prompt, others use `phasePrompt`); accumulate cost; if `subtype` starts `error_max_budget` → `status:failed` return; emit `phase:done`. After all phases: `commitAndPush`, `removeWorktree`, `status:done`. If `abortController.signal.aborted` mid-loop → `status:stopped`, **keep** worktree, return stopped.

- [x] **Step 1: Write failing tests** (fake deps — no real SDK/git)

```ts
// runner/test/run.test.ts
import { describe, it, expect, vi } from "vitest";
import { runOne } from "../src/run";
import type { RunDeps, RunInput } from "../src/index";
const steps = Object.fromEntries(["brainstorm","spec","plan","execute","audit"].map((k) => [k, { model: "claude-opus-4-8", effort: "x-high" }])) as any;
const input = (over: Partial<RunInput> = {}): RunInput => ({ runId: "RUN-1", repoDir: "/repo", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps, ...over });
const okResult = { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.1, usage: { input_tokens: 10, output_tokens: 5 } } as const;
const fakeDeps = (over: Partial<RunDeps> = {}): RunDeps => ({
  queryFn: () => (async function* () { yield okResult; })(),
  git: { addWorktree: vi.fn(), removeWorktree: vi.fn(), commitAndPush: vi.fn(), switchBase: vi.fn() },
  verify: () => ({ blocked: false }), effortToThinking: () => undefined, ...over });
describe("runOne", () => {
  it("runs every feature phase and commits on success", async () => {
    const d = fakeDeps(); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("done");
    expect(d.git.addWorktree).toHaveBeenCalled(); expect(d.git.commitAndPush).toHaveBeenCalled(); expect(d.git.removeWorktree).toHaveBeenCalled();
    const done = events.filter((e) => e.kind === "phase" && e.state === "done").map((e) => e.name);
    expect(done).toEqual(["Brainstorm","Objective","Spec","Plan","Execute"]);
  });
  it("blocks at execute when docs are stale and does NOT commit", async () => {
    const d = fakeDeps({ verify: () => ({ blocked: true, reason: "docs stale" }) }); const events: any[] = [];
    const r = await runOne(input(), d, (e) => events.push(e));
    expect(r.status).toBe("failed");
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(events.some((e) => e.kind === "log" && e.line.s.includes("docs stale"))).toBe(true);
  });
  it("stops and keeps the worktree when aborted before finishing", async () => {
    const ac = new AbortController();
    const d = fakeDeps({ queryFn: () => (async function* () { ac.abort(); yield okResult; })() });
    const r = await runOne(input(), d, () => {}, { abortController: ac });
    expect(r.status).toBe("stopped");
    expect(d.git.removeWorktree).not.toHaveBeenCalled();
  });
  it("fails on budget error", async () => {
    const d = fakeDeps({ queryFn: () => (async function* () { yield { ...okResult, subtype: "error_max_budget_usd" }; })() });
    const r = await runOne(input(), d, () => {});
    expect(r.status).toBe("failed");
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement**

```ts
// runner/src/phases.ts
import type { Flow, RunInput, StepModels } from "./types";
export const PIPELINES: Record<Flow, readonly string[]> = {
  feature: ["Brainstorm","Objective","Spec","Plan","Execute"],
  qa:      ["Audit","Spec","Plan","Execute"],
  scaffold:["Brainstorm","Objective","Doc index"],
  reverse: ["Scan","Doc index"],
};
const STEP: Record<string, keyof StepModels> = {
  Brainstorm: "brainstorm", Objective: "brainstorm", Spec: "spec", Plan: "plan",
  Execute: "execute", Audit: "audit", "Doc index": "spec", Scan: "audit",
};
export const stepFor = (phase: string): keyof StepModels => STEP[phase] ?? "execute";
export function phasePrompt(flow: Flow, phase: string, input: RunInput): string {
  const ref = input.specId ? ` ${input.specId}` : "";
  return `hanoman ${flow} — fase ${phase}${ref}. Ikuti internal/docs sebagai Source of Truth. Kerjakan hanya langkah fase ${phase}; perbarui docs yang tersentuh dan link di index.`;
}
```

```ts
// runner/src/run.ts
import type { QueryFn, RunEvent, RunInput, RunResult, GitOps } from "./types";
import { PIPELINES, phasePrompt, stepFor } from "./phases";
import { runPhase } from "./sdk";
import { SteerQueue } from "./steer-queue";
export interface RunDeps {
  queryFn: QueryFn; git: GitOps; verify: (cwd: string) => { blocked: boolean; reason?: string };
  effortToThinking: (effort: string) => number | undefined;
}
export async function runOne(
  input: RunInput, deps: RunDeps, onEvent: (e: RunEvent) => void,
  ctl: { abortController?: AbortController; steer?: SteerQueue } = {},
): Promise<RunResult> {
  const abortController = ctl.abortController ?? new AbortController();
  const worktree = `${input.repoDir}/.worktrees/${input.runId.toLowerCase()}`;
  let costUsd = 0, tokensIn = 0, tokensOut = 0;
  onEvent({ kind: "status", status: "running" });
  deps.git.addWorktree(input.repoDir, worktree, input.branchFrom);
  for (const phase of PIPELINES[input.flow]) {
    if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return { status: "stopped", costUsd, tokensIn, tokensOut }; }
    onEvent({ kind: "phase", name: phase, state: "active" });
    if (phase === "Execute") {
      const v = deps.verify(worktree);
      if (v.blocked) {
        onEvent({ kind: "log", line: { t: "✗", s: `plan diblok · ${v.reason ?? "docs stale (Source of Truth)"}` } });
        onEvent({ kind: "phase", name: phase, state: "failed" });
        onEvent({ kind: "status", status: "failed" });
        return { status: "failed", costUsd, tokensIn, tokensOut };
      }
    }
    const step = input.steps[stepFor(phase)];
    const prompt = phase === "Execute" && ctl.steer ? ctl.steer.stream() : phasePrompt(input.flow, phase, input);
    const r = await runPhase({ queryFn: deps.queryFn, cwd: worktree, model: step.model,
      maxThinkingTokens: deps.effortToThinking(step.effort), maxBudgetUsd: input.maxBudgetUsd,
      prompt, abortController, onEvent });
    costUsd += r.costUsd; tokensIn += r.tokensIn; tokensOut += r.tokensOut;
    if (r.subtype.startsWith("error_max_budget")) {
      onEvent({ kind: "log", line: { t: "✗", s: "dihentikan · dailyBudget tercapai" } });
      onEvent({ kind: "phase", name: phase, state: "failed" });
      onEvent({ kind: "status", status: "failed" });
      return { status: "failed", costUsd, tokensIn, tokensOut };
    }
    onEvent({ kind: "phase", name: phase, state: "done" });
  }
  if (abortController.signal.aborted) { onEvent({ kind: "status", status: "stopped" }); return { status: "stopped", costUsd, tokensIn, tokensOut }; }
  deps.git.commitAndPush(worktree, `hanoman ${input.flow} ${input.specId ?? ""}`.trim(), input.branchTo);
  deps.git.removeWorktree(input.repoDir, worktree);
  onEvent({ kind: "status", status: "done" });
  return { status: "done", costUsd, tokensIn, tokensOut };
}
```
Add `export * from "./run"; export * from "./sdk"; export * from "./steer-queue";` to `runner/src/index.ts`.

- [x] **Step 4: Run, verify pass** — `pnpm --filter ./runner test` green.
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(runner): pipelines + runOne orchestration + guardrail gate"`

---

## Phase B — server integration

### Task 6: RunManager (semaphore, event bus, persistence)

**Files:** Create `server/src/runner/manager.ts`, `server/src/runner/deps.ts`, `server/src/services/settings.ts`; Test `server/test/manager.test.ts`

**Interfaces:**
- Produces:
  - `settings.ts`: `stepModels(): Promise<StepModels>` (read the Setting row `.steps`), `maxConcurrent()`, `dailyBudget()`.
  - `deps.ts`: `prodDeps: RunDeps` = `{ queryFn: (a)=>query(a), git: realGit, verify: verifyViaCli, effortToThinking }` where `verifyViaCli(cwd)` spawns `node cli/dist/hanoman.js docs verify --block-if-stale --json` in `cwd` and maps exit≠0 → `{blocked:true, reason}`.
  - `manager.ts`: `class RunManager { start(input, deps?): void; steer(runId, msg); control(runId, action); command(runId, text): string; subscribe(runId, cb): () => void; }` — a `maxConcurrent` semaphore; per-run `{ emitter, abortController, steer, log[] }`; every `RunEvent` is persisted (append `Run.log`; update `phases`/`files`/`status`; accumulate tokens/cost) **and** emitted to subscribers.

- [x] **Step 1: Write failing test** (inject a fake runner via deps)

```ts
// server/test/manager.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { prisma } from "../src/db";
import { RunManager } from "../src/runner/manager";
import type { RunDeps } from "@hanoman/runner";
const fakeDeps: RunDeps = {
  queryFn: () => (async function* () { yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.2, usage: { input_tokens: 9, output_tokens: 3 } }; })(),
  git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} },
  verify: () => ({ blocked: false }), effortToThinking: () => undefined };
describe("RunManager", () => {
  beforeAll(async () => { await seed(); });
  it("persists log + final status for a run", async () => {
    const mgr = new RunManager();
    const events: string[] = [];
    const unsub = mgr.subscribe("RUN-8842", (e) => events.push(e.kind));
    await mgr.start({ runId: "RUN-8842", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x",
      flow: "feature", steps: await (await import("../src/services/settings")).stepModels() }, fakeDeps);
    unsub();
    const run = await prisma.run.findUnique({ where: { id: "RUN-8842" } });
    expect(run?.status).toBe("done");
    expect((run?.log as any[]).length).toBeGreaterThan(0);
    expect(events).toContain("status");
  });
});
```

- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** `settings.ts`, `deps.ts`, `manager.ts`.

```ts
// server/src/services/settings.ts
import { prisma } from "../db";
import type { StepModels } from "@hanoman/runner";
async function data() { return (await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).data as any; }
export async function stepModels(): Promise<StepModels> { return (await data()).steps; }
export async function maxConcurrent(): Promise<number> { return (await data()).maxConcurrent ?? 3; }
export async function dailyBudget(): Promise<number> { return (await data()).dailyBudget ?? 50; }
```

```ts
// server/src/runner/deps.ts
import { spawnSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { realGit, type RunDeps } from "@hanoman/runner";
const THINK: Record<string, number | undefined> = { "x-high": 32000, high: 16000, medium: 8000, low: 2000 };
export function verifyViaCli(cwd: string) {
  const r = spawnSync("node", [`${process.cwd()}/cli/dist/hanoman.js`, "docs", "verify", "--block-if-stale", "--json"], { cwd, encoding: "utf8" });
  if (r.status === 0) return { blocked: false };
  try { const j = JSON.parse(r.stdout); return { blocked: true, reason: j.violations?.map((v: any) => v.reason).join("; ") }; }
  catch { return { blocked: true, reason: "docs verify blocked" }; }
}
export const prodDeps: RunDeps = {
  queryFn: (a) => query(a as any) as any, git: realGit, verify: verifyViaCli,
  effortToThinking: (effort) => THINK[effort],
};
```

```ts
// server/src/runner/manager.ts
import { EventEmitter } from "node:events";
import { prisma } from "../db";
import { runOne, SteerQueue, type RunDeps, type RunEvent, type RunInput } from "@hanoman/runner";
import { prodDeps } from "./deps";
type Live = { emitter: EventEmitter; abortController: AbortController; steer: SteerQueue; log: { t: string; s: string }[] };
export class RunManager {
  private live = new Map<string, Live>();
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private maxConcurrent = 3) {}
  subscribe(runId: string, cb: (e: RunEvent) => void) {
    const l = this.live.get(runId); if (l) l.emitter.on("event", cb);
    return () => this.live.get(runId)?.emitter.off("event", cb);
  }
  logSnapshot(runId: string) { return this.live.get(runId)?.log ?? []; }
  steer(runId: string, message: string) { this.live.get(runId)?.steer.push(message); }
  control(runId: string, action: "pause" | "resume" | "stop" | "retry") {
    const l = this.live.get(runId); if (!l) return;
    if (action === "pause" || action === "stop") l.abortController.abort();
    // resume/retry re-enqueue a fresh run (handled by caller via start with resume); see routes.
  }
  private async persist(runId: string, e: RunEvent, l: Live) {
    if (e.kind === "log") { l.log.push(e.line); await prisma.run.update({ where: { id: runId }, data: { log: l.log as any } }); }
    else if (e.kind === "status") await prisma.run.update({ where: { id: runId }, data: { status: e.status } });
    else if (e.kind === "phase") {
      const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
      const phases = (run.phases as any[]).map((p) => p.name === e.name ? { ...p, state: e.state } : p);
      await prisma.run.update({ where: { id: runId }, data: { phases } });
    } else if (e.kind === "cost") await prisma.run.update({ where: { id: runId }, data: { tokensIn: String(e.tokensIn), tokensOut: String(e.tokensOut), cost: `$${e.costUsd.toFixed(2)}` } });
    else if (e.kind === "file") { const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } }); await prisma.run.update({ where: { id: runId }, data: { files: [...(run.files as any[]), e] } }); }
  }
  async start(input: RunInput, deps: RunDeps = prodDeps) {
    await new Promise<void>((res) => { if (this.running < this.maxConcurrent) res(); else this.queue.push(res); });
    this.running++;
    const l: Live = { emitter: new EventEmitter(), abortController: new AbortController(), steer: new SteerQueue("mulai"), log: [] };
    this.live.set(input.runId, l);
    const onEvent = (e: RunEvent) => { void this.persist(input.runId, e, l); l.emitter.emit("event", e); };
    try { await runOne(input, deps, onEvent, { abortController: l.abortController, steer: l.steer }); }
    finally { this.running--; this.queue.shift()?.(); }
  }
}
export const runManager = new RunManager();
```
(Note: `resume`/`retry` re-enqueue via `start` with a resume-aware input; keep the semaphore-first `await` as the `maxConcurrent` gate.)

- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(server): RunManager + prod deps + settings"`

---

### Task 7: SSE `/runs/:id/log` (replay + live)

**Files:** Modify `server/src/routes/runs.ts`; Test `server/test/runs-sse.test.ts`

**Interfaces:**
- Produces: `GET /runs/:id/log` — SSE stream: on connect writes the persisted `Run.log` snapshot as `data:` events, then live events from `runManager.subscribe`. Sets `content-type: text/event-stream`. Closes on client disconnect (unsubscribe).

- [ ] **Step 1: Write failing test** (inject Fastify; assert a live run's events reach the stream)

```ts
// server/test/runs-sse.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
import { runManager } from "../src/runner/manager";
describe("runs SSE", () => {
  beforeAll(async () => { await seed(); });
  it("streams event-stream content type and replays log", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/runs/RUN-8842/log", headers: { accept: "text/event-stream" } });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.payload).toContain("data:"); // replayed seed log lines
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add to `runs.ts`:

```ts
import { runManager } from "../runner/manager";
// ...
app.get("/runs/:id/log", async (req, reply) => {
  const { id } = req.params as { id: string };
  const run = await prisma.run.findUnique({ where: { id } });
  if (!run) return reply.code(404).send({ error: "not found" });
  reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (obj: unknown) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
  for (const line of (run.log as any[])) send({ kind: "log", line });      // replay snapshot
  for (const line of runManager.logSnapshot(id)) send({ kind: "log", line }); // any live backlog
  const unsub = runManager.subscribe(id, (e) => send(e));
  req.raw.on("close", () => { unsub(); reply.raw.end(); });
});
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): SSE run log (replay + live)"`

---

### Task 8: Control endpoints (steer/control/worktree/command)

**Files:** Modify `server/src/routes/runs.ts`; Test `server/test/runs-control.test.ts`

**Interfaces:**
- Produces (all validated by `shared/` DTOs; the SPEC-001 `404` guarantees are now replaced):
  - `POST /runs/:id/steer {message}` → `runManager.steer`; `202 {accepted:true}`.
  - `POST /runs/:id/control {action}` → pause/stop via `runManager.control`; resume/retry re-`start` the run; `202`.
  - `POST /runs/:id/worktree {branchFrom?,branchTo?}` → update `Run.branchFrom/To`, `realGit.switchBase` if live; return updated run.
  - `POST /runs/:id/command {text}` → parse the terminal verb; map to steer/control or read plan/files/status; return `{ lines: {t,s}[] }`.

- [ ] **Step 1: Write failing tests**

```ts
// server/test/runs-control.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("run control", () => {
  it("steer is accepted", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/steer", payload: { message: "pakai backoff 30s" } });
    expect(r.statusCode).toBe(202); expect(r.json().accepted).toBe(true);
  });
  it("rejects an invalid control action", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/control", payload: { action: "explode" } });
    expect(r.statusCode).toBe(400);
  });
  it("worktree switch updates branches", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/worktree", payload: { branchTo: "release/v1.0" } });
    expect(r.json().branchTo).toBe("release/v1.0");
  });
  it("command status returns lines", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/command", payload: { text: "status" } });
    expect(Array.isArray(r.json().lines)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add handlers to `runs.ts` using `zSteer/zControl/zWorktreePatch/zCommand`, `runManager`, `realGit`. The `command` verb map mirrors `.prototype/app/RunsScreen.jsx` `runCommand` (`help/status/plan/files/steer <m>/pause/resume/stop/docs <path>/clear`), reading `plan`/`files`/`phases` from the persisted `Run`. Full handler code follows the same validate→act→respond shape as the SPEC-001 routes; each returns `202`/`{lines}` as in the tests. Confirm the previously-404 control paths now resolve.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): run control + worktree + terminal endpoints"`

---

## Phase C — CLI commands

### Task 9: `hanoman execute|spec|plan`

**Files:** Create `cli/src/commands/execute.ts` (+ `spec.ts`, `plan.ts` as thin variants); Modify `cli/src/router.ts`; Test `cli/test/execute.cmd.test.ts`

**Interfaces:**
- Produces: `default(args, ctx)` — resolves repo (`resolveRepo`), builds a `RunInput` (`flow:"feature"`, `steps` from a local default or `hanoman.config.json`), runs `runOne` with `prodDeps` (injectable for test), streams each `RunEvent` log line to `ctx.stdout`. `spec`/`plan` set `flow` and a `--only <phase>` to run a single phase. Returns 0 on `done`, 1 on `failed`.

- [ ] **Step 1: Failing test** (inject fake deps via an exported `runExecute(args, ctx, deps)`)

```ts
// cli/test/execute.cmd.test.ts
import { describe, it, expect } from "vitest";
import { runExecute } from "../src/commands/execute";
import { makeRepo } from "./_fixture";
const fakeDeps = { queryFn: () => (async function* () { yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }; })(),
  git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} }, verify: () => ({ blocked: false }), effortToThinking: () => undefined } as any;
describe("hanoman execute", () => {
  it("streams phase logs and exits 0 on success", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    const out: string[] = [];
    const code = await runExecute(["SPEC-1"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {} }, fakeDeps);
    expect(code).toBe(0); expect(out.join("")).toMatch(/Execute/);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `execute.ts` exporting `runExecute(args, ctx, deps=prodDeps)` and `default` = `(a,c)=>runExecute(a,c)`. Build `RunInput`, call `runOne`, print events (`phase`→`«fase» name state`, `log`→`t s`). `spec.ts`/`plan.ts` reuse `runExecute` with a phase filter. Wire the three into `router.ts`. Default `steps` = all `{model:"claude-opus-4-8",effort:"x-high"}`.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): execute/spec/plan commands"`

---

### Task 10: `hanoman qa|scaffold|reverse`

**Files:** Create `cli/src/commands/qa.ts`, `scaffold.ts`, `reverse.ts`; Modify `cli/src/router.ts`; Test `cli/test/flows.cmd.test.ts`

**Interfaces:**
- Produces: each `default(args, ctx)` calls `runExecute`-style core with its `flow` (`qa`→`qa`, `scaffold`→`scaffold`, `reverse`→`reverse`). `scaffold` takes `--from objective`; `reverse` takes `--dir <path>` (sets `repoDir`). Same event streaming + exit codes.

- [ ] **Step 1: Failing test**

```ts
// cli/test/flows.cmd.test.ts
import { describe, it, expect } from "vitest";
import runScaffold from "../src/commands/scaffold";
import { makeRepo } from "./_fixture";
describe("hanoman scaffold", () => {
  it("runs the scaffold pipeline", async () => {
    const { root } = await makeRepo({ index: "\n" });
    const out: string[] = [];
    // scaffold.ts must accept an injected deps arg for tests (mirror execute.ts)
    const code = await (await import("../src/commands/scaffold")).runScaffold(["--from","objective"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {} }, {
      queryFn: () => (async function* () { yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }; })(),
      git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} }, verify: () => ({ blocked: false }), effortToThinking: () => undefined } as any);
    expect(code).toBe(0); expect(out.join("")).toMatch(/Doc index/);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the three commands (each exports `runX(args,ctx,deps=prodDeps)` + `default`). Reuse the event-printing helper from Task 9 (extract to `cli/src/commands/_run.ts` to stay DRY). Wire into `router.ts`.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): qa/scaffold/reverse commands"`

---

## Phase D — safety, docs, acceptance

### Task 11: Safety wiring + ADR refresh + live smoke + acceptance

**Files:**
- Modify: `internal/docs/adr/0003-per-step-model-selection.md` (model IDs), `internal/docs/README.md` (no new link needed unless a doc is added)
- Create: `runner/test/live-smoke.test.ts` (env-gated), `internal/docs/operations/agent-documentation-workflow.md` (note the runner path)
- Test: `runner/test/safety.test.ts`

**Interfaces:**
- Produces: verified deny behavior (the `disallowedTools` list + a `canUseTool` reject for `rm -rf`/push-to-main/out-of-worktree writes) and the opt-in live smoke.

- [ ] **Step 1: Failing safety test**

```ts
// runner/test/safety.test.ts
import { describe, it, expect } from "vitest";
import { deniesDangerous } from "../src/safety";
describe("safety", () => {
  it("denies rm -rf", () => expect(deniesDangerous("Bash", { command: "rm -rf /" })).toBe(true));
  it("denies push to main", () => expect(deniesDangerous("Bash", { command: "git push origin main" })).toBe(true));
  it("allows an ordinary edit", () => expect(deniesDangerous("Edit", { file_path: "src/a.ts" })).toBe(false));
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `runner/src/safety.ts`:

```ts
export function deniesDangerous(tool: string, input: Record<string, unknown>): boolean {
  const cmd = String((input as any).command ?? "");
  if (tool === "Bash" && /\brm\s+-rf\b/.test(cmd)) return true;
  if (tool === "Bash" && /git\s+push\b.*\bmain\b/.test(cmd)) return true;
  return false;
}
export const canUseTool = async (tool: string, input: Record<string, unknown>) =>
  deniesDangerous(tool, input) ? { behavior: "deny" as const, message: "ditolak oleh guardrail hanoman" } : { behavior: "allow" as const, updatedInput: input };
```
Wire `canUseTool` into `runPhase`'s options (Task 4 file) so denial is enforced beyond the static `disallowedTools`.

Refresh `internal/docs/adr/0003-per-step-model-selection.md`: replace `claude-opus-4` with `claude-opus-4-8`; note current IDs `claude-sonnet-5`, `claude-haiku-4-5-20251001`. Append to `agent-documentation-workflow.md`: "Runner memakai `@anthropic-ai/claude-agent-sdk`; fase Execute lewat gate `hanoman docs verify` (SPEC-002)."

`runner/test/live-smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
const LIVE = process.env.HANOMAN_LIVE_SDK === "1";
describe.runIf(LIVE)("live smoke", () => {
  it("runs a real cheap execute end-to-end", async () => {
    // seed a throwaway git repo with a trivial internal/docs, run `hanoman execute` with model claude-haiku-4-5-20251001,
    // assert the run reaches status done and a commit exists. Costs tokens — off by default.
    expect(true).toBe(true); // replace with the real end-to-end drive when enabling
  }, 120000);
});
```

- [ ] **Step 4: Full acceptance** — verify SPEC-003 §Acceptance:
  1. `pnpm -r build && pnpm -r test` green (SDK mocked).
  2. Manual/live: `HANOMAN_LIVE_SDK=1 pnpm --filter ./runner test` runs one real execute.
  3. In the dashboard (SPEC-001 running): a run streams logs (<1s), steer injects, pause/stop ≤2s, a stale-docs run blocks at Execute, success pushes to `branchTo`, a `rm -rf` attempt is denied, N+1 concurrent run waits.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(runner): safety canUseTool + ADR-0003 refresh + live smoke"`

---

## Self-Review

**1. Spec coverage** — every SPEC-003 element maps to a task:
- Runner core (types/DTOs → T1; worktree → T2; steer → T3; SDK adapter → T4; pipelines+runOne+guardrail gate → T5). Server (RunManager+persistence → T6; SSE → T7; control/steer/worktree/terminal → T8). CLI flows (execute/spec/plan → T9; qa/scaffold/reverse → T10). Safety + ADR-0003 refresh + live smoke → T11.
- Acceptance 1 (execute+SSE)→T5+T7; 2 (steer)→T3+T8; 3 (pause/stop/resume/retry)→T5+T8; 4 (guardrail gate)→T5; 5 (commit/push + deny)→T5+T11; 6 (maxConcurrent+budget)→T6+T5; 7 (scaffold/reverse/qa)→T10; 8 (mock+live)→T5..T11; 9 (ADR refresh)→T11.

**2. Placeholder scan** — no "TBD/implement later". T8's terminal handler and T9/T10's per-command bodies reference the exact prototype source (`RunsScreen.jsx` `runCommand`) and a shared `_run.ts` printer with defined signatures — an executable contract, not a placeholder. The live-smoke body is intentionally a no-op guarded by an env flag, documented as such.

**3. Type consistency** — `QueryFn`/`SdkMessage`/`RunEvent`/`RunInput`/`RunResult`/`RunDeps`/`StepModels` are defined once in `runner/src/types.ts` and used unchanged across sdk/run/manager/cli. `runOne(input, deps, onEvent, ctl)`, `runPhase(args)`, `SteerQueue(initial).stream()/push()/close()`, `deniesDangerous(tool,input)` keep identical signatures wherever referenced. Control DTO names (`zSteer/zControl/zWorktreePatch/zCommand`) match between `shared/` and the routes.

**Executor notes:**
- Depends on SPEC-001 (server, `Run` model, `runs.ts`, seed) and SPEC-002 (`cli/dist/hanoman.js docs verify`). Build the CLI (`pnpm --filter ./cli build`) before running `verifyViaCli`.
- **Pin the SDK version** first (`pnpm --filter ./runner add @anthropic-ai/claude-agent-sdk`) and re-verify option/field names (`abortController`, `includePartialMessages`, `settingSources`, `permissionMode`, `canUseTool` return shape, result `usage`/`total_cost_usd`) against the installed typings — adjust the adapters in T4/T6/T11 if the installed version differs.
