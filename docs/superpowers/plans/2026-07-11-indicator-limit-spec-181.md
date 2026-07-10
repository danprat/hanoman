# Indicator Limit (SPEC-181) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Claude subscription limits (5-hour session + weekly + per-model weekly) in realtime on the hanoman dashboard — a badge in the top bar and a card on Overview — so the user can see whether backlog can keep running.

**Architecture:** New `GET /api/limits` reads the live Claude Code OAuth token (macOS Keychain, else `.credentials.json`) and calls Anthropic's `GET /api/oauth/usage` (the same endpoint `/usage` uses), maps its `limits[]` array to a DTO, and caches 30s in-memory. The frontend polls it every 60s via a singleton hook; a `<LimitBadge>` inside `Shell` and a card in `OverviewScreen` render the shared state. No DB, no push channel, no new dependency.

**Tech Stack:** Node + Fastify + TypeScript (server); React + TS + Vite (frontend); vitest + @testing-library/react (tests). Global `fetch` (Node 18+) and `execFileSync` — no new packages.

## Global Constraints

- TypeScript strict. No new dependencies (use global `fetch`, `node:child_process`, `node:fs`, `node:os`, `node:path`).
- No DB / no Prisma migration / no ADR — limit data is ephemeral (fetch-on-demand + in-memory cache).
- Never self-refresh the OAuth token (refresh token is rotating; refreshing would log out the live claude session). Read-only.
- Endpoint auth: `GET /api/limits` is not in `PUBLIC` (`server/src/app.ts`), so it is auto-gated → 401 without a session cookie. Do not add it to `PUBLIC`.
- Indonesian UI labels. Follow the editorial/bone-paper/brass design system; reuse existing DS components (`Card`, `ProgressBar`, `Tooltip`, `Badge`) and status tokens (`--status-ok`, `--status-warn`, `--status-err`).
- Update `internal/docs` touched by the change in the same commit (already written: spec-181 objective + spec + index).
- Confirmed real response shape lives in `server/test/fixtures/usage-200.json` (Task 1). The endpoint `GET https://api.anthropic.com/api/oauth/usage` returns HTTP 200 with a `limits[]` array; each entry is `{ kind, group, percent, severity, resets_at, scope, is_active }`.

---

### Task 1: Backend — `GET /api/limits` (shared DTO + service + route)

**Files:**
- Create: `server/test/fixtures/usage-200.json`
- Modify: `shared/src/dto.ts` (append limit types), `shared/src/api.ts` (add `limits` path)
- Create: `server/src/services/limits.ts`
- Create: `server/src/routes/limits.ts`
- Modify: `server/src/app.ts` (import + register `limits`)
- Test: `server/test/limits.route.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2 & 3 via `@hanoman/shared`):
  - `type LimitSeverity = "normal" | "warning" | "critical"`
  - `type LimitWindow = { key: string; label: string; usedPct: number; resetsAt: string | null; severity: LimitSeverity; isActive: boolean }`
  - `type LimitsStatus = "ok" | "stale" | "unavailable"`
  - `type LimitsDTO = { status: LimitsStatus; windows: LimitWindow[]; fetchedAt: string | null }`
  - `paths.limits` = `"/api/limits"`
- Produces (server-internal): `getLimits(): Promise<LimitsDTO>`, `_resetLimitsCache(): void` in `server/src/services/limits.ts`.

- [x] **Step 1: Add the real-response fixture**

Create `server/test/fixtures/usage-200.json` (captured live from the endpoint, HTTP 200 — no secrets, only usage numbers + reset times). The mapper reads only `.limits`; the legacy top-level fields are included so the test proves they are ignored:

```json
{
  "five_hour": { "utilization": 19.0, "resets_at": "2026-07-11T01:59:59.662254+00:00" },
  "seven_day": { "utilization": 40.0, "resets_at": "2026-07-11T05:59:59.662275+00:00" },
  "seven_day_opus": null,
  "limits": [
    { "kind": "session", "group": "session", "percent": 19, "severity": "normal",
      "resets_at": "2026-07-11T01:59:59.662254+00:00", "scope": null, "is_active": false },
    { "kind": "weekly_all", "group": "weekly", "percent": 40, "severity": "normal",
      "resets_at": "2026-07-11T05:59:59.662275+00:00", "scope": null, "is_active": true },
    { "kind": "weekly_scoped", "group": "weekly", "percent": 23, "severity": "normal",
      "resets_at": "2026-07-11T05:59:59.662585+00:00",
      "scope": { "model": { "id": null, "display_name": "Opus" } }, "is_active": false }
  ]
}
```

- [x] **Step 2: Add shared DTO types + path**

Append to `shared/src/dto.ts`:

```ts
// SPEC-181 · limit langganan Claude realtime
export type LimitSeverity = "normal" | "warning" | "critical";
export type LimitsStatus = "ok" | "stale" | "unavailable";
export type LimitWindow = {
  key: string;               // "session" | "weekly_all" | "weekly_scoped:Opus"
  label: string;             // "Sesi 5 jam" | "Mingguan" | "Mingguan Opus"
  usedPct: number;           // 0..100 (dibulatkan dari `percent`)
  resetsAt: string | null;   // ISO 8601 (`resets_at`) atau null
  severity: LimitSeverity;   // API `severity`; fallback dari usedPct bila hilang
  isActive: boolean;         // API `is_active` — window yang sedang mengikat
};
export type LimitsDTO = {
  status: LimitsStatus;
  windows: LimitWindow[];
  fetchedAt: string | null;  // ISO waktu fetch sukses terakhir; null bila belum pernah
};
```

Confirm `shared/src/index.ts` re-exports `./dto` (it already does for `Spec`, `ProjectView`, etc — verify with `grep dto shared/src/index.ts`; add `export * from "./dto";` only if missing).

In `shared/src/api.ts`, add one line inside the `paths` object (near `settings`):

```ts
  limits: `${API}/limits`,
```

- [x] **Step 3: Write the failing route test**

Create `server/test/limits.route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { buildApp } from "../src/app";
import { _resetLimitsCache } from "../src/services/limits";

const here = dirname(fileURLToPath(import.meta.url));
const usage200 = JSON.parse(readFileSync(join(here, "fixtures/usage-200.json"), "utf8"));

// CLAUDE_CONFIG_DIR set → service pakai jalur berkas (bukan Keychain), deterministik lintas OS.
let dir: string;
function seedCreds(token: string | null) {
  dir = mkdtempSync(join(tmpdir(), "hanoman-creds-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
  if (token !== null)
    writeFileSync(join(dir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: token } }));
}
const okFetch = () =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => usage200 });

beforeEach(() => { _resetLimitsCache(); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); delete process.env.CLAUDE_CONFIG_DIR; vi.unstubAllGlobals(); });

describe("GET /api/limits", () => {
  it("maps limits[] on 200 → status ok", async () => {
    seedCreds("tok-fresh");
    vi.stubGlobal("fetch", okFetch());
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/limits" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.windows).toHaveLength(3);
    const byKey = Object.fromEntries(body.windows.map((w: any) => [w.key, w]));
    expect(byKey["session"].usedPct).toBe(19);
    expect(byKey["weekly_all"].usedPct).toBe(40);
    expect(byKey["weekly_all"].isActive).toBe(true);
    expect(byKey["weekly_scoped:Opus"].usedPct).toBe(23);
    expect(byKey["weekly_scoped:Opus"].label).toContain("Opus");
    expect(byKey["session"].severity).toBe("normal");
  });

  it("401 from Anthropic after a success → status stale with last windows", async () => {
    seedCreds("tok");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => usage200 })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildApp({ requireAuth: false });
    await app.inject({ method: "GET", url: "/api/limits" });   // warm cache (ok)
    _resetLimitsCache.length;                                   // no-op ref
    // force a second live fetch by expiring the TTL cache
    _resetLimitsCache();                                        // clears freshness but keeps... 
    // NOTE: stale relies on in-memory last-success; see Step 4 impl (cache holds last ok dto).
    const res = await app.inject({ method: "GET", url: "/api/limits" });
    const body = res.json();
    expect(body.status).toBe("stale");
    expect(body.windows).toHaveLength(3);
  });

  it("no credentials file → status unavailable, empty windows", async () => {
    seedCreds(null);
    vi.stubGlobal("fetch", okFetch());
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/limits" });
    const body = res.json();
    expect(body.status).toBe("unavailable");
    expect(body.windows).toEqual([]);
    expect(body.fetchedAt).toBeNull();
  });

  it("TTL cache: two calls within 30s hit fetch once", async () => {
    seedCreds("tok");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const app = buildApp({ requireAuth: false });
    await app.inject({ method: "GET", url: "/api/limits" });
    await app.inject({ method: "GET", url: "/api/limits" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requireAuth: 401 without cookie", async () => {
    seedCreds("tok");
    vi.stubGlobal("fetch", okFetch());
    const app = buildApp({ requireAuth: true });
    const res = await app.inject({ method: "GET", url: "/api/limits" });
    expect(res.statusCode).toBe(401);
  });
});
```

> **Note on the `stale` test:** the `stale` path returns the *last successful* DTO with `status: "stale"` when a later fetch fails. Because the 30s TTL would otherwise serve the cached `ok` DTO without re-fetching, the cache must distinguish "last success" (kept for stale fallback) from "fresh within TTL". Implement per Step 4: `getLimits()` re-fetches when the TTL has elapsed but keeps `lastOk` for the stale fallback. In the test, the second `inject` re-fetches (TTL considered elapsed because we only cache the *timestamp* of the last ok; simplest: `_resetLimitsCache()` clears the TTL timestamp but the impl keeps `lastOk` separately — see Step 4). If wiring the two-call timing is awkward, split into a direct unit test of `getLimits()` with `vi.useFakeTimers()` advancing 31s between calls; keep at least one route-level `stale` assertion.

- [x] **Step 4: Run the test — verify it fails**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/limits.route.test.ts`
Expected: FAIL — `Cannot find module '../src/services/limits'` (and `/api/limits` 404).

- [x] **Step 5: Implement the service**

Create `server/src/services/limits.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LimitsDTO, LimitWindow, LimitSeverity } from "@hanoman/shared";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TTL_MS = 30_000;

// `lastOk` bertahan lintas kegagalan untuk fallback `stale`; `freshUntil` menjaga TTL cache.
let lastOk: LimitsDTO | null = null;
let freshUntil = 0;

const LABELS: Record<string, string> = {
  session: "Sesi 5 jam", weekly_all: "Mingguan", weekly_scoped: "Mingguan",
};
const humanize = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const nowIso = () => new Date().toISOString();

function credsFile(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), ".credentials.json");
}

// Keychain dulu (macOS tanpa CLAUDE_CONFIG_DIR eksplisit — di mesin ini berkasnya kedaluwarsa,
// token hidup ada di Keychain), lalu berkas (Linux/prod, atau CLAUDE_CONFIG_DIR di-set = seam test).
function readAccessToken(): string | null {
  if (process.platform === "darwin" && !process.env.CLAUDE_CONFIG_DIR) {
    try {
      const blob = execFileSync(
        "security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const tok = JSON.parse(blob)?.claudeAiOauth?.accessToken;
      if (tok) return tok;
    } catch { /* jatuh ke berkas */ }
  }
  try {
    return JSON.parse(readFileSync(credsFile(), "utf8"))?.claudeAiOauth?.accessToken ?? null;
  } catch { return null; }
}

function normalizeSeverity(s: unknown, pct: number): LimitSeverity {
  if (s === "normal" || s === "warning" || s === "critical") return s;
  return pct >= 90 ? "critical" : pct >= 70 ? "warning" : "normal";
}

type RawLimit = {
  kind?: string; percent?: number; severity?: string; resets_at?: string | null;
  is_active?: boolean; scope?: { model?: { display_name?: string } } | null;
};

function mapWindows(json: unknown): LimitWindow[] {
  const arr = (json as { limits?: unknown } | null)?.limits;
  if (!Array.isArray(arr)) return [];
  return (arr as RawLimit[]).map((l) => {
    const kind = l.kind ?? "unknown";
    const model = l.scope?.model?.display_name;
    const usedPct = Math.round(l.percent ?? 0);
    const base = LABELS[kind] ?? humanize(kind);
    return {
      key: model ? `${kind}:${model}` : kind,
      label: model ? `${base} ${model}` : base,
      usedPct,
      resetsAt: l.resets_at ?? null,
      severity: normalizeSeverity(l.severity, usedPct),
      isActive: !!l.is_active,
    };
  });
}

function fallback(): LimitsDTO {
  return lastOk ? { ...lastOk, status: "stale" }
                : { status: "unavailable", windows: [], fetchedAt: null };
}

async function fetchUsage(): Promise<LimitsDTO> {
  const token = readAccessToken();
  if (!token) return fallback();
  try {
    const res = await fetch(USAGE_URL, {
      headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
    });
    if (!res.ok) return fallback();
    const dto: LimitsDTO = { status: "ok", windows: mapWindows(await res.json()), fetchedAt: nowIso() };
    lastOk = dto;
    return dto;
  } catch { return fallback(); }
}

export async function getLimits(): Promise<LimitsDTO> {
  if (lastOk && Date.now() < freshUntil) return lastOk;
  const dto = await fetchUsage();
  if (dto.status === "ok") freshUntil = Date.now() + TTL_MS;
  return dto;
}

// Untuk test: bersihkan cache & fallback antar kasus.
export function _resetLimitsCache(): void { lastOk = null; freshUntil = 0; }
```

> This impl makes the `stale` test in Step 3 pass cleanly: after one `ok`, `_resetLimitsCache()` is too blunt (it clears `lastOk`). **Adjust the Step-3 `stale` test** to instead expire only the TTL: since tests can't reach `freshUntil`, drive it via fake timers on the exported `getLimits` in a dedicated unit test file `server/test/limits.service.test.ts` (`vi.useFakeTimers(); await getLimits(); fetch→401; vi.advanceTimersByTime(31000); expect((await getLimits()).status).toBe("stale")`). Keep the route test focused on `ok` / `unavailable` / TTL / auth. This split is the clean version — do it.

- [x] **Step 6: Create the route**

Create `server/src/routes/limits.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { getLimits } from "../services/limits";

export default async function limits(app: FastifyInstance) {
  app.get("/limits", async () => getLimits());
}
```

- [x] **Step 7: Register the route in `app.ts`**

In `server/src/app.ts`, add the import next to the other route imports:

```ts
import limits from "./routes/limits";
```

and register it inside the `/api` scope alongside the others:

```ts
    await api.register(limits);
```

- [x] **Step 8: Adjust the stale test into its own service test, then run all**

Move the `stale` case into `server/test/limits.service.test.ts` per the Step-5 note:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getLimits, _resetLimitsCache } from "../src/services/limits";

const here = dirname(fileURLToPath(import.meta.url));
const usage200 = JSON.parse(readFileSync(join(here, "fixtures/usage-200.json"), "utf8"));
let dir: string;

beforeEach(() => {
  _resetLimitsCache();
  dir = mkdtempSync(join(tmpdir(), "hanoman-creds-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
  writeFileSync(join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "tok" } }));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.CLAUDE_CONFIG_DIR; vi.unstubAllGlobals(); vi.useRealTimers(); });

it("after a success, a later 401 yields stale with last windows", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => usage200 })
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  expect((await getLimits()).status).toBe("ok");
  vi.advanceTimersByTime(31_000);                 // expire 30s TTL
  const dto = await getLimits();
  expect(dto.status).toBe("stale");
  expect(dto.windows).toHaveLength(3);
});
```

Remove the `stale` case from `limits.route.test.ts` (leave `ok` / `unavailable` / TTL / auth).

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/limits.route.test.ts test/limits.service.test.ts`
Expected: PASS (all cases).

- [x] **Step 9: Real boot + curl verification**

Boot the server against a throwaway DB (per repo memory — never the dev/test DB for a live smoke), then hit the endpoint. A live claude session (this run) keeps the Keychain token fresh:

```bash
cd server && env -u NODE_ENV -u DATABASE_URL node dist/server.js &   # or: pnpm --filter ./server dev
curl -s localhost:8788/api/limits | python3 -m json.tool             # use a port with no dev session
```

Expected: `status: "ok"` with `windows` for session + weekly (+ scoped). **If field names differ from the fixture, reconcile `mapWindows` now** and re-run Step 8. Kill the server after.

- [x] **Step 10: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts server/src/services/limits.ts server/src/routes/limits.ts server/src/app.ts server/test/limits.route.test.ts server/test/limits.service.test.ts server/test/fixtures/usage-200.json
git commit -m "feat(spec-181): GET /api/limits — Claude subscription limits from OAuth usage endpoint"
```

---

### Task 2: Frontend data layer — client method, pure helpers, singleton poll hook

**Files:**
- Modify: `src/src/api/client.ts` (add `getLimits`)
- Create: `src/src/api/limits.ts` (pure helpers + `useLimits` singleton poller)
- Test: `src/test/limits.test.ts`

**Interfaces:**
- Consumes: `LimitsDTO`, `LimitWindow`, `LimitSeverity` from `@hanoman/shared`; `paths.limits`.
- Produces (consumed by Task 3):
  - `worstWindow(w: LimitWindow[]): LimitWindow | null` — the window with the worst severity, tie-broken by highest `usedPct`.
  - `severityToken(s: LimitSeverity): { fg: string; bg: string }` — DS CSS var names.
  - `useLimits(): LimitsDTO` — React hook; one shared 60s poll across all callers.

- [ ] **Step 1: Add the client method**

In `src/src/api/client.ts`, import `LimitsDTO` in the shared import line and add to the `api` object:

```ts
  getLimits: () => j<LimitsDTO>(paths.limits),
```

- [ ] **Step 2: Write the failing helper test**

Create `src/test/limits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { worstWindow, severityToken } from "../src/api/limits";
import type { LimitWindow } from "@hanoman/shared";

const w = (over: Partial<LimitWindow>): LimitWindow => ({
  key: "k", label: "L", usedPct: 10, resetsAt: null, severity: "normal", isActive: false, ...over,
});

describe("worstWindow", () => {
  it("returns null for empty", () => expect(worstWindow([])).toBeNull());
  it("picks worst severity over higher percent", () => {
    const r = worstWindow([w({ key: "a", usedPct: 95, severity: "normal" }),
                           w({ key: "b", usedPct: 30, severity: "critical" })]);
    expect(r?.key).toBe("b");
  });
  it("tie-breaks equal severity by usedPct", () => {
    const r = worstWindow([w({ key: "a", usedPct: 40, severity: "warning" }),
                           w({ key: "b", usedPct: 80, severity: "warning" })]);
    expect(r?.key).toBe("b");
  });
});

describe("severityToken", () => {
  it("maps severities to status vars", () => {
    expect(severityToken("normal").fg).toContain("--status-ok");
    expect(severityToken("warning").fg).toContain("--status-warn");
    expect(severityToken("critical").fg).toContain("--status-err");
  });
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `cd src && pnpm vitest run test/limits.test.ts`
Expected: FAIL — `Cannot find module '../src/api/limits'`.

- [ ] **Step 4: Implement helpers + hook**

Create `src/src/api/limits.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { LimitsDTO, LimitWindow, LimitSeverity } from "@hanoman/shared";
import { api } from "./client";

const RANK: Record<LimitSeverity, number> = { normal: 0, warning: 1, critical: 2 };

export function worstWindow(windows: LimitWindow[]): LimitWindow | null {
  if (!windows.length) return null;
  return windows.reduce((a, b) => {
    if (RANK[b.severity] !== RANK[a.severity]) return RANK[b.severity] > RANK[a.severity] ? b : a;
    return b.usedPct > a.usedPct ? b : a;
  });
}

export function severityToken(s: LimitSeverity): { fg: string; bg: string } {
  if (s === "critical") return { fg: "var(--status-err)", bg: "var(--status-err-tint)" };
  if (s === "warning") return { fg: "var(--status-warn)", bg: "var(--status-warn-tint)" };
  return { fg: "var(--status-ok)", bg: "var(--status-ok-tint)" };
}

// Poller singleton: satu interval 60s + satu nilai ter-cache di module scope, dibagi semua
// pemakai (ref-count). Selamat dari navigasi; badge (Shell) + kartu (Overview) memakai satu poll.
const POLL_MS = 60_000;
let state: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };
let timer: ReturnType<typeof setInterval> | undefined;
const subs = new Set<() => void>();

async function pull() {
  try { state = await api.getLimits(); }
  catch { /* biarkan nilai terakhir; badge tampil stale/unavailable apa adanya */ }
  for (const s of subs) s();
}
function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) { void pull(); timer = setInterval(() => void pull(), POLL_MS); }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && timer) { clearInterval(timer); timer = undefined; }
  };
}

export function useLimits(): LimitsDTO {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
```

- [ ] **Step 5: Run — verify it passes**

Run: `cd src && pnpm vitest run test/limits.test.ts`
Expected: PASS (all helper cases).

- [ ] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/api/limits.ts src/test/limits.test.ts
git commit -m "feat(spec-181): frontend limits data layer — client, helpers, singleton poll hook"
```

---

### Task 3: Frontend UI — `<LimitBadge>` in Shell + `<LimitWindows>` + Overview card

**Files:**
- Create: `src/src/screens/LimitIndicator.tsx` (`LimitBadge`, `LimitWindows`)
- Modify: `src/src/ds/shell.tsx` (render `<LimitBadge/>` in the top bar)
- Modify: `src/src/screens/OverviewScreen.tsx` (add a limits `Card`)
- Test: `src/test/limit-indicator.test.tsx`

**Interfaces:**
- Consumes: `useLimits`, `worstWindow`, `severityToken` from `../api/limits`; `LimitsDTO`, `LimitWindow` from `@hanoman/shared`; DS `Card`, `ProgressBar`, `Tooltip`.
- Produces: `<LimitBadge/>` (self-fetching via `useLimits`, no props) and `<LimitWindows dto={LimitsDTO} />`.

- [ ] **Step 1: Write the failing render test**

Create `src/test/limit-indicator.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LimitWindows } from "../src/screens/LimitIndicator";
import type { LimitsDTO } from "@hanoman/shared";

const dto: LimitsDTO = {
  status: "ok", fetchedAt: "2026-07-11T06:00:00Z",
  windows: [
    { key: "session", label: "Sesi 5 jam", usedPct: 19, resetsAt: "2026-07-11T09:00:00Z", severity: "normal", isActive: false },
    { key: "weekly_all", label: "Mingguan", usedPct: 40, resetsAt: "2026-07-15T00:00:00Z", severity: "warning", isActive: true },
  ],
};

describe("LimitWindows", () => {
  it("renders each window label and percent", () => {
    render(<LimitWindows dto={dto} />);
    expect(screen.getByText("Sesi 5 jam")).toBeTruthy();
    expect(screen.getByText("Mingguan")).toBeTruthy();
    expect(screen.getByText(/19%/)).toBeTruthy();
    expect(screen.getByText(/40%/)).toBeTruthy();
  });
  it("shows unavailable message when no windows", () => {
    render(<LimitWindows dto={{ status: "unavailable", windows: [], fetchedAt: null }} />);
    expect(screen.getByText(/tidak tersedia|idle|belum login/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd src && pnpm vitest run test/limit-indicator.test.tsx`
Expected: FAIL — `Cannot find module '../src/screens/LimitIndicator'`.

- [ ] **Step 3: Implement `LimitIndicator.tsx`**

Create `src/src/screens/LimitIndicator.tsx`:

```tsx
import React from "react";
import type { LimitsDTO, LimitWindow } from "@hanoman/shared";
import { Card, ProgressBar, Tooltip } from "../ds";
import { useLimits, worstWindow, severityToken } from "../api/limits";

function resetLabel(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "reset segera";
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  return h >= 1 ? `reset ${h}j ${m}m` : `reset ${m}m`;
}
function agoLabel(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m <= 0 ? "baru saja" : `${m}m lalu`;
}

// Daftar window — dipakai popover badge DAN kartu Overview (satu presentasi).
export function LimitWindows({ dto }: { dto: LimitsDTO }) {
  if (!dto.windows.length)
    return (
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "4px 0" }}>
        {dto.status === "unavailable"
          ? "Limit tidak tersedia — Claude idle / belum login di host ini."
          : "Belum ada data limit."}
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {dto.windows.map((w) => {
        const tok = severityToken(w.severity);
        return (
          <div key={w.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-body)" }}>
                {w.label}{w.isActive ? " · aktif" : ""}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: tok.fg }}>{w.usedPct}%</span>
            </div>
            <ProgressBar value={w.usedPct} max={100} color={tok.fg} />
            {w.resetsAt && (
              <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{resetLabel(w.resetsAt)}</span>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 2 }}>
        {dto.status === "stale" ? `stale · diperbarui ${agoLabel(dto.fetchedAt)}` : `diperbarui ${agoLabel(dto.fetchedAt)}`}
      </div>
    </div>
  );
}

// Badge top bar — self-fetch via useLimits(), tanpa props. Shell cukup merender <LimitBadge/>.
export function LimitBadge() {
  const dto = useLimits();
  const worst = worstWindow(dto.windows);
  const [open, setOpen] = React.useState(false);
  const label = dto.status === "unavailable" || !worst ? "—" : `${worst.usedPct}%`;
  const tok = worst ? severityToken(worst.severity) : { fg: "var(--text-muted)", bg: "var(--bone-200)" };
  const dim = dto.status === "stale" ? 0.6 : 1;
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Limit Claude"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--border-hair)",
          background: tok.bg, color: tok.fg, opacity: dim, cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 12,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 999, background: tok.fg }} />
        {label}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 280,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))",
          padding: 14,
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Limit Claude</div>
          <LimitWindows dto={dto} />
        </div>
      )}
    </div>
  );
}
```

> Verify `ProgressBar` accepts `value`/`max`/`color` — check `src/src/ds/components/feedback.tsx`. If its prop names differ (e.g. `pct`), adapt the two `<ProgressBar>` usages to the real signature. If it has no color prop, wrap it in a `<div style={{ color: tok.fg }}>` or pass whatever it uses; do not invent props.

- [ ] **Step 4: Run — verify it passes**

Run: `cd src && pnpm vitest run test/limit-indicator.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render the badge in the top bar (Shell)**

In `src/src/ds/shell.tsx`, import at top:

```ts
import { LimitBadge } from "../screens/LimitIndicator";
```

and render it in the `<header>` just before `{actions}` (after the search block, around line 119):

```tsx
          <LimitBadge />
          {actions}
```

This makes the badge appear on every screen with **no change to the 9 `<Shell>` call sites** in `App.tsx` (the badge self-fetches via `useLimits`).

> Watch for an import cycle: `shell.tsx` → `LimitIndicator.tsx` → `../ds` (which re-exports `Shell`). `../ds/index.ts` exports `Shell` but `LimitIndicator` only imports `Card`/`ProgressBar`/`Tooltip` — ES modules handle this fine as long as `LimitIndicator` does not import `Shell`. Confirm the app builds (`cd src && pnpm build` or `pnpm vitest run`) after this step; if a cycle warning appears, import `Card`/`ProgressBar`/`Tooltip` from their concrete files (`../ds/components/surfaces`, `../ds/components/feedback`) instead of the barrel.

- [ ] **Step 6: Add the limits card to Overview**

In `src/src/screens/OverviewScreen.tsx`, import:

```ts
import { LimitWindows } from "./LimitIndicator";
import { useLimits } from "../api/limits";
```

Inside `OverviewScreen(...)`, call the hook near the top of the component body:

```ts
  const limits = useLimits();
```

and add a card alongside the existing ones (after the "Claude Code sedang jalan" `Card`, ~line 136):

```tsx
          <Card eyebrow="realtime · Claude" title="Limit langganan">
            <LimitWindows dto={limits} />
          </Card>
```

- [ ] **Step 7: Full frontend test + typecheck**

Run: `cd src && pnpm vitest run && pnpm tsc --noEmit`
Expected: PASS, no type errors. (If `tsc` script differs, use the repo's typecheck command from `src/package.json`.)

- [ ] **Step 8: Real boot verification (badge + card visible, updating)**

With the server running (Task 1 Step 9) and a fresh Keychain token, start the frontend dev server and confirm the badge shows a percent in the top bar and the Overview card lists the windows. A browser smoke via CDP (repo pattern) or a manual look both work; assert the badge text is a percent (not "—") when `status: "ok"`.

- [ ] **Step 9: Commit**

```bash
git add src/src/screens/LimitIndicator.tsx src/src/ds/shell.tsx src/src/screens/OverviewScreen.tsx src/test/limit-indicator.test.tsx
git commit -m "feat(spec-181): limit badge in top bar + limits card on Overview"
```

---

## Self-Review

**Spec coverage:**
- Semua window (5-jam + mingguan + Opus mingguan) → Task 1 `mapWindows` maps every `limits[]` entry (session/weekly_all/weekly_scoped incl. per-model). ✓
- Badge top bar + kartu Overview (keduanya, satu data path) → Task 3 `<LimitBadge>` (Shell) + Overview card, both via the single `useLimits` poll. ✓
- Realtime via 60s poll, no push channel → Task 2 singleton poller. ✓
- Token: Keychain-first / file-fallback, no self-refresh → Task 1 `readAccessToken`. ✓
- Status ok/stale/unavailable + severity colors → Task 1 DTO + `fallback()`; Task 2/3 `severityToken`. ✓
- Auth-gated, no DB/migration/ADR, no new deps → Global Constraints + Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. The one deferred confirmation (real field names) is de-risked by the captured fixture and reconciled in Task 1 Step 9. ✓

**Type consistency:** `LimitsDTO`/`LimitWindow`/`LimitSeverity` defined in Task 1, consumed unchanged in Tasks 2–3. `getLimits`, `worstWindow`, `severityToken`, `useLimits`, `LimitWindows`, `LimitBadge` names match across tasks. ✓
