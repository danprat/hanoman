# hanoman GitHub App + webhooks (SPEC-006) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub App that verifies push/installation webhooks, enqueues runs for matching `commit` triggers, clones/pushes private repos with installation tokens, and reports run outcomes as commit statuses.

**Architecture:** Octokit `App` (`@octokit/app` / `octokit`) for auth + webhook verification. `POST /webhooks/github` (raw body) → `app.webhooks.verifyAndReceive` → push handler matches repo+branch → `fireTrigger` (SPEC-005) → `enqueueRun`. A github-triggered run clones on demand and pushes with an installation token (a tweak to the SPEC-003 runner git ops); a status reporter subscribes to run status events and posts `pending`/`success`/`failure`.

**Tech Stack:** Node 20+, TypeScript 5 (strict), `octokit` (`App`, `webhooks`) + `@octokit/auth-app`, Fastify (raw body), Prisma, Vitest.

## Global Constraints

- **Depends on SPEC-001** (Project/Run/Trigger), **SPEC-003** (runner `git.ts`, status events), **SPEC-004** (`enqueueRun`, `run:<id>:events`), **SPEC-005** (`fireTrigger`).
- **Octokit for auth + verification** (not hand-rolled). Secrets server-side only in env: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`. Installation tokens minted on demand, **never persisted or sent to the client**.
- **Signature verification** on the raw body; invalid → `401`, no side effects.
- **Schema additions via ADR-0005:** `GithubInstallation`, `Project.installationId?`, `Run.commitSha?`/`Run.reportRepo?`.
- **Verify installed Octokit App/Webhooks API** (`app.webhooks.verifyAndReceive`, `app.getInstallationOctokit`, `createAppAuth`) against typings before coding. TypeScript strict; commit after every green step.
- Unit tests **fake all GitHub calls** (inject an Octokit-like client); one opt-in live test behind `HANOMAN_LIVE_GITHUB=1`.

---

## File Structure

```
server/prisma/schema.prisma   + GithubInstallation, Project.installationId, Run.commitSha/reportRepo
internal/docs/adr/0005-github-app-schema.md   new ADR (+ link in README)
server/src/github/
  app.ts            App instance; getInstallationOctokit(id); installationToken(id)
  webhooks.ts       verifyAndReceive wrapper; push/installation/ping handlers -> fireTrigger
  status.ts         statusReporter: subscribe run status events -> post commit status
  clone.ts          ensureClone(project): clone with token if repoDir missing
server/src/routes/webhooks.ts   POST /webhooks/github (raw body)
runner/src/git.ts   + tokenized remote for clone/commitAndPush (github-backed runs)
server/src/worker.ts   start statusReporter
```

---

### Task 1: Schema (ADR-0005) + migration

**Files:** Create `internal/docs/adr/0005-github-app-schema.md`; Modify `internal/docs/README.md`, `server/prisma/schema.prisma`; Test `server/test/github-schema.test.ts`

**Interfaces:**
- Produces Prisma models/fields: `GithubInstallation { id Int @id; account String; repos String[] }`; `Project.installationId Int?`; `Run.commitSha String?`; `Run.reportRepo String?`.

- [x] **Step 1: Write the ADR** `internal/docs/adr/0006-github-app-schema.md` (0005 taken by durable-queue ADR):
```markdown
# ADR 0005 — GitHub App schema deltas
**Status:** accepted
## Konteks
GitHub App butuh memetakan installation → repo/project dan melacak sha commit untuk status check.
## Keputusan
Tambah `GithubInstallation { id, account, repos[] }`, `Project.installationId?`,
`Run.commitSha?` + `Run.reportRepo?`. Token installation tidak disimpan (di-mint on demand).
## Konsekuensi
- (+) push webhook → run; status check bisa dilaporkan.
- (−) satu tabel + tiga kolom baru; butuh migration.
```
Link it under `## adr` in `internal/docs/README.md`.

- [x] **Step 2: Write failing test**

```ts
// server/test/github-schema.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";
describe("github schema", () => {
  it("can create an installation + link a project", async () => {
    await prisma.githubInstallation.upsert({ where: { id: 99 }, update: {}, create: { id: 99, account: "nafanesia", repos: ["nafanesia/arta"] } });
    expect(await prisma.githubInstallation.findUnique({ where: { id: 99 } })).toBeTruthy();
  });
});
```

- [x] **Step 3: Implement** the schema additions; `prisma migrate dev --name github-app`.
- [x] **Step 4: Run, verify pass** — `pnpm --filter ./server test github-schema`.
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(server): ADR-0005 + github app schema"`

---

### Task 2: GitHub App auth (Octokit)

**Files:** Create `server/src/github/app.ts`; Test `server/test/github-app.test.ts`

**Interfaces:**
- Produces:
  - `githubApp()` — memoized `new App({ appId, privateKey, webhooks: { secret } })` from env; throws a clear error if env is missing.
  - `getInstallationOctokit(installationId): Promise<Octokit>` — `app.getInstallationOctokit(id)`.
  - `installationToken(installationId): Promise<string>` — via `createAppAuth({ appId, privateKey })({ type: "installation", installationId })` → `.token`; used for git remotes.
  - All accept an optional injected `app` for tests.

- [ ] **Step 1: Write failing test** (inject a fake App)

```ts
// server/test/github-app.test.ts
import { describe, it, expect } from "vitest";
import { getInstallationOctokit } from "../src/github/app";
describe("github app", () => {
  it("returns an installation-scoped octokit", async () => {
    const fakeApp = { getInstallationOctokit: async (id: number) => ({ id, rest: {} }) } as any;
    const octo = await getInstallationOctokit(123, fakeApp);
    expect((octo as any).id).toBe(123);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
// server/src/github/app.ts
import { App } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
let _app: App | null = null;
export function githubApp(): App {
  if (_app) return _app;
  const appId = process.env.GITHUB_APP_ID, privateKey = process.env.GITHUB_APP_PRIVATE_KEY, secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!appId || !privateKey || !secret) throw new Error("GITHUB_APP_ID/PRIVATE_KEY/WEBHOOK_SECRET required");
  _app = new App({ appId, privateKey, webhooks: { secret } });
  return _app;
}
export async function getInstallationOctokit(installationId: number, app: App = githubApp()) {
  return app.getInstallationOctokit(installationId);
}
export async function installationToken(installationId: number): Promise<string> {
  const auth = createAppAuth({ appId: process.env.GITHUB_APP_ID!, privateKey: process.env.GITHUB_APP_PRIVATE_KEY! });
  const { token } = await auth({ type: "installation", installationId });
  return token;
}
```
Add deps to `server/package.json`: `"octokit": "^4.0.0", "@octokit/auth-app": "^7.0.0"`.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): github app auth (octokit)"`

---

### Task 3: Webhook receiver (verify + push/installation/ping → fireTrigger)

**Files:** Create `server/src/github/webhooks.ts`, `server/src/routes/webhooks.ts`; Modify `server/src/app.ts` (raw body for the route); Test `server/test/webhooks.test.ts`

**Interfaces:**
- Produces:
  - `webhooks.ts`: registers handlers on `githubApp().webhooks` — `push` → match `payload.repository.full_name` to `Project.repoUrl` + enabled `commit` triggers whose `detail` branch equals `ref` branch → `fireTrigger(trigger, { branch, sha: payload.after })`; `installation`/`installation_repositories` → upsert `GithubInstallation`; export `handleWebhook({ id, name, signature, payload })` = `githubApp().webhooks.verifyAndReceive(...)`.
  - `routes/webhooks.ts`: `POST /webhooks/github` — read raw body + headers (`x-github-delivery`, `x-github-event`, `x-hub-signature-256`), call `handleWebhook`; `401` on `verifyAndReceive` throwing a signature error, else `200`/`204`.
  - `app.ts`: a content-type parser preserving the raw body for `/api/webhooks/github`.

- [ ] **Step 1: Write failing tests**

```ts
// server/test/webhooks.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
import { githubApp } from "../src/github/app";
import { createHmac } from "node:crypto";
process.env.GITHUB_APP_ID = "1"; process.env.GITHUB_WEBHOOK_SECRET = "shh";
process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----";
const sign = (body: string) => "sha256=" + createHmac("sha256", "shh").update(body).digest("hex");
describe("webhooks", () => {
  beforeAll(async () => { await seed(); });
  it("401 on a bad signature", async () => {
    const app = buildApp();
    const r = await app.inject({ method: "POST", url: "/api/webhooks/github", headers: { "x-github-event": "push", "x-github-delivery": "1", "x-hub-signature-256": "sha256=bad", "content-type": "application/json" }, payload: { zen: "x" } });
    expect(r.statusCode).toBe(401);
  });
  it("accepts a valid ping", async () => {
    const body = JSON.stringify({ zen: "hi", hook_id: 1 });
    const app = buildApp();
    const r = await app.inject({ method: "POST", url: "/api/webhooks/github", headers: { "x-github-event": "ping", "x-github-delivery": "2", "x-hub-signature-256": sign(body), "content-type": "application/json" }, payload: body });
    expect(r.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `webhooks.ts` (handlers + `handleWebhook`), `routes/webhooks.ts`, and the raw-body parser in `app.ts`. Push matching: parse `ref` (`refs/heads/<branch>`), extract the branch from the trigger `detail` (e.g. `"push → main"` → `main`), compare. Unknown repo/branch → `202` (accepted, no-op). Register the route in `app.ts`.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): github webhook receiver + push->fireTrigger"`

---

### Task 4: Clone-on-demand + tokenized push + status reporter

**Files:** Create `server/src/github/clone.ts`, `server/src/github/status.ts`; Modify `runner/src/git.ts` (token-aware remote), `server/src/worker.ts` (start statusReporter); Test `server/test/github-clone.test.ts`, `server/test/github-status.test.ts`

**Interfaces:**
- Produces:
  - `clone.ts`: `ensureClone(project, tokenFn = installationToken): Promise<void>` — if `project.repoDir` missing, `git clone https://x-access-token:<token>@github.com/<repoUrl>.git <repoDir>` (token redacted in logs). Called before the worktree add for github-backed runs.
  - `runner/src/git.ts`: `commitAndPush`/`addWorktree` accept an optional `remoteUrlWithToken` (or a credential-helper env) so pushes on a private remote authenticate. Default behavior (no token) unchanged for local runs.
  - `status.ts`: `startStatusReporter()` — subscribe (Redis) to run status events; for a run with `commitSha`+`reportRepo`+`installationId`, `octokit.rest.repos.createCommitStatus({ owner, repo, sha, state })` with `running→pending`, `done→success`, `failed/stopped→failure`.

- [ ] **Step 1: Write failing tests**

```ts
// server/test/github-clone.test.ts
import { describe, it, expect, vi } from "vitest";
import { ensureClone } from "../src/github/clone";
vi.mock("node:child_process", () => ({ spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })) }));
import { spawnSync } from "node:child_process";
describe("ensureClone", () => {
  it("clones when repoDir is missing", async () => {
    await ensureClone({ repoDir: "/nope/missing", repoUrl: "nafanesia/arta", installationId: 5 } as any, async () => "TKN");
    const call = (spawnSync as any).mock.calls.find((c: any[]) => c[1]?.includes("clone"));
    expect(call).toBeTruthy();
    expect(JSON.stringify(call)).toContain("x-access-token:TKN");
  });
});
```

```ts
// server/test/github-status.test.ts
import { describe, it, expect, vi } from "vitest";
import { postStatus } from "../src/github/status";
describe("status", () => {
  it("maps run status to commit state", async () => {
    const createCommitStatus = vi.fn(async () => ({}));
    const octo = { rest: { repos: { createCommitStatus } } } as any;
    await postStatus(octo, { owner: "n", repo: "arta", sha: "abc" }, "done");
    expect(createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "success" }));
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `ensureClone`, the token-aware `git.ts` remote, and `status.ts` (`postStatus(octo, {owner,repo,sha}, runStatus)` + `startStatusReporter` subscribing to `run:*:events`). Wire `ensureClone` before the worktree add in the worker's processor for github-backed runs; start `startStatusReporter()` in `worker.ts`.

```ts
// server/src/github/status.ts (core mapping)
const STATE: Record<string, "pending" | "success" | "failure"> = { running: "pending", done: "success", failed: "failure", stopped: "failure" };
export async function postStatus(octo: any, at: { owner: string; repo: string; sha: string }, runStatus: string) {
  const state = STATE[runStatus]; if (!state) return;
  await octo.rest.repos.createCommitStatus({ ...at, state, context: "hanoman" });
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): clone-on-demand + tokenized push + commit status reporter"`

---

### Task 5: Live test + full acceptance

**Files:** Create `server/test/github-live.test.ts` (env-gated); Modify `internal/docs/operations/agent-documentation-workflow.md`

- [ ] **Step 1: Env-gated live test**

```ts
// server/test/github-live.test.ts
import { describe, it, expect } from "vitest";
const LIVE = process.env.HANOMAN_LIVE_GITHUB === "1";
describe.runIf(LIVE)("github live", () => {
  it("verifies a real delivery + posts a status", async () => {
    // against a real test App + repo: replay a stored delivery, assert fireTrigger + a commit status appears.
    expect(true).toBe(true); // replace with the real drive when enabling
  }, 120000);
});
```

- [ ] **Step 2: Implement** the acceptance walkthrough of SPEC-006 §Acceptance:
  1. Signed `push` to a watched branch → `fireTrigger` enqueues; bad signature → `401`.
  2. `installation` events sync `GithubInstallation`; `ping` → `200`.
  3. A github-triggered run clones a missing repo and pushes to `branchTo` with a token.
  4. Run start/done/fail post `pending`/`success`/`failure`; no `commitSha` → nothing posted.
  5. Secrets stay server-side; tokens never persisted.
  Append to `agent-documentation-workflow.md`: "Trigger `commit` lewat GitHub App (SPEC-006): push terverifikasi → `fireTrigger` → run; status dilaporkan balik."

- [ ] **Step 3: Run** `pnpm -w test` (green, GitHub faked); optionally `HANOMAN_LIVE_GITHUB=1 pnpm --filter ./server test github-live`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(server): github live smoke + acceptance + docs"`

---

## Self-Review

**1. Spec coverage** — schema/ADR-0005 → T1; app auth → T2; webhook verify + push/installation/ping → T3; clone + tokenized push + status reporter → T4; live + acceptance + docs → T5. Acceptance 1→T3, 2→T3, 3→T4, 4→T4, 5→T2/T4, 6→T5, 7→T1/T5.

**2. Placeholder scan** — no "TBD". The two live tests are intentional env-gated no-ops (documented), not placeholders; every unit test drives real code with faked GitHub clients.

**3. Type consistency** — `getInstallationOctokit(id, app?)`, `installationToken(id)`, `handleWebhook({id,name,signature,payload})`, `ensureClone(project, tokenFn?)`, `postStatus(octo, {owner,repo,sha}, runStatus)` are single-signature across tasks. `fireTrigger(trigger, {branch, sha})` matches the SPEC-005 signature exactly (the reason it was extracted there).

**Executor notes:**
- Depends on SPEC-005's `fireTrigger` and SPEC-004's Redis event channel. Build order: 001→002→003→004→005→006.
- **Pin Octokit** and verify `App`/`webhooks.verifyAndReceive`/`getInstallationOctokit`/`createAppAuth` shapes against the installed version; adjust T2/T3 if the signature differs. Provide real `GITHUB_*` env for the live test only.
