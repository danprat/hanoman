# SPEC-257 — AI Agent capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beri AI agent eksternal kontrol penuh atas hanoman lewat **Agent Token** (Bearer, hash-at-rest) yang meng-auth ke REST `/api` existing, digerbang **capability scope per-domain read/write** yang dibuka manusia di Settings, plus master switch workspace.

**Architecture:** Seluruh fitur sudah REST di `/api` (digerbang cookie di `app.ts onRequest`). Kita tambah jalur auth kedua: token Bearer → `req.agent = { id, capabilities }`; gate memetakan route→capability dan menegakkan. Model `AgentToken` server-local (cermin DeviceToken). Manajemen token & master switch di Settings (cookie-only).

**Tech Stack:** TypeScript strict · Fastify · Prisma/Postgres · Zod (`@hanoman/shared`) · React+Vite (dashboard) · vitest.

## Global Constraints

- TypeScript strict; test tiap logika (vitest, jalankan `env -u NODE_ENV -u DATABASE_URL pnpm test` atau `pnpm --filter ./server test`, `--no-file-parallelism`).
- Jangan ubah skema tanpa migration + ADR: hand-write `migration.sql` + `prisma migrate deploy` per DB (dev + `_test`), lalu `prisma generate`. JANGAN `prisma migrate dev` (reset saat drift worktree).
- Hash-at-rest `sha256(token)`; plaintext token hanya balik SEKALI di POST; `tokenHash` tak pernah ke client/log; `timingSafeEqual` saat verifikasi.
- `AgentToken` server-local — TANPA kolom `version`/sync (cermin DeviceToken).
- Capability id valid = daftar tetap `CAPABILITY_IDS` di `@hanoman/shared` (satu sumber untuk server & UI).
- Ikuti design system (editorial, bone paper, brass) — cermin `DeviceTokensPanel` di `SettingsScreen.tsx`.
- Setiap task: perbarui docs SoT tersentuh dalam commit yang sama; centang checklist; boot server + curl endpoint tersentuh.
- ADR baru = **0065**. SPEC = **257**.

---

## File Structure

**Shared (`shared/src/`):**
- Create `shared/src/agent.ts` — `CAPABILITY_IDS`, `zCapability`, `CAPABILITIES` (metadata), `grantsCapability`, `zAgentTokenView`, `zAgentTokenCreate`, `zAgentTokenPatch`, `zCapabilityInfo`.
- Modify `shared/src/entities.ts` — `agentAccessEnabled` di `zSetting`.
- Modify `shared/src/api.ts` — `paths.agentTokens`, `paths.agentToken(id)`, `paths.agentCapabilities`.
- Modify `shared/src/index.ts` — `export * from "./agent"`.

**Prisma:**
- Modify `server/prisma/schema.prisma` — model `AgentToken`.
- Create `server/prisma/migrations/2026072100_spec257_agent_token/migration.sql`.

**Server (`server/src/`):**
- Create `server/src/services/agent-token.ts` — issue/verify/revoke/list/patch + hash.
- Create `server/src/services/agent-capabilities.ts` — `capabilityForRoute`, `checkAgentCapability`.
- Create `server/src/services/agent-auth.ts` — `agentTokenFromReq`, `authenticateAgent`.
- Modify `server/src/services/settings.ts` — `agentAccessEnabled: false` di `DEFAULT_SETTING`.
- Modify `server/src/app.ts` — jalur agent di `onRequest` + register route.
- Create `server/src/routes/agent-tokens.ts` — CRUD + katalog capability (cookie-only).

**Frontend (`src/src/`):**
- Modify `src/src/api/client.ts` — method agent-token.
- Modify `src/src/screens/SettingsScreen.tsx` — `AgentAccessPanel` + nav entry.

**Docs:** `internal/docs/architecture/{data-model,api-contract}.md`, `internal/docs/security/security-standard.md`, `internal/docs/adr/0065-ai-agent-capability-agent-token.md`, `internal/docs/README.md`, `internal/skills/hanoman/SKILL.md`.

---

## Task 1: Shared — capability catalog, agent DTOs, Setting.agentAccessEnabled

**Files:**
- Create: `shared/src/agent.ts`
- Modify: `shared/src/entities.ts` (zSetting)
- Modify: `shared/src/api.ts` (paths)
- Modify: `shared/src/index.ts` (export)
- Test: `shared/test/agent.test.ts`

**Interfaces:**
- Produces: `CAPABILITY_IDS: readonly string[]`, `zCapability`, `type Capability`, `CAPABILITIES: CapabilityInfo[]`, `grantsCapability(granted: string[], need: Capability): boolean`, `zAgentTokenView`/`AgentTokenView`, `zAgentTokenCreate`, `zAgentTokenPatch`, `zCapabilityInfo`/`CapabilityInfo`. `zSetting` gains `agentAccessEnabled: boolean` (default false). `paths.agentTokens`, `paths.agentToken(id)`, `paths.agentCapabilities`.

- [x] **Step 1: Write the failing test** — `shared/test/agent.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  CAPABILITY_IDS, zCapability, CAPABILITIES, grantsCapability,
  zAgentTokenCreate, zSetting,
} from "../src";

describe("agent capabilities", () => {
  it("has 9 domains × read/write = 18 capability ids, all in metadata", () => {
    expect(CAPABILITY_IDS.length).toBe(18);
    expect(new Set(CAPABILITY_IDS).size).toBe(18);
    expect(CAPABILITIES.map((c) => c.id).sort()).toEqual([...CAPABILITY_IDS].sort());
    expect(zCapability.safeParse("projects:read").success).toBe(true);
    expect(zCapability.safeParse("nope:read").success).toBe(false);
  });

  it("write implies read; unrelated caps do not grant", () => {
    expect(grantsCapability(["projects:write"], "projects:read")).toBe(true);
    expect(grantsCapability(["projects:read"], "projects:write")).toBe(false);
    expect(grantsCapability(["projects:read"], "projects:read")).toBe(true);
    expect(grantsCapability(["backlog:write"], "projects:read")).toBe(false);
    expect(grantsCapability([], "projects:read")).toBe(false);
  });

  it("high-risk caps are flagged", () => {
    const risky = CAPABILITIES.filter((c) => c.risk).map((c) => c.id);
    expect(risky).toContain("sessions:write");
    expect(risky).toContain("vps:write");
  });

  it("zAgentTokenCreate rejects unknown capability and empty name", () => {
    expect(zAgentTokenCreate.safeParse({ name: "bot", capabilities: ["projects:read"] }).success).toBe(true);
    expect(zAgentTokenCreate.safeParse({ name: "bot", capabilities: ["ghost:read"] }).success).toBe(false);
    expect(zAgentTokenCreate.safeParse({ name: "", capabilities: [] }).success).toBe(false);
  });

  it("zSetting defaults agentAccessEnabled to false", () => {
    const s = zSetting.parse({
      model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
    });
    expect(s.agentAccessEnabled).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hanoman/shared exec vitest run test/agent.test.ts`
Expected: FAIL — module `../src` has no export `CAPABILITY_IDS`.

- [x] **Step 3: Create `shared/src/agent.ts`**

```ts
import { z } from "zod";

// SPEC-257 · ADR-0065 · capability scope untuk agent token. "<domain>:<access>", write⊇read.
// Satu sumber untuk gate server (map route→cap) dan UI Settings (checkbox).
export const CAPABILITY_IDS = [
  "projects:read", "projects:write",
  "backlog:read", "backlog:write",
  "sessions:read", "sessions:write",
  "docs:read", "docs:write",
  "ide:read", "ide:write",
  "vps:read", "vps:write",
  "settings:read", "settings:write",
  "support:read", "support:write",
  "notifications:read", "notifications:write",
] as const;
export const zCapability = z.enum(CAPABILITY_IDS);
export type Capability = z.infer<typeof zCapability>;

export const zCapabilityInfo = z.object({
  id: zCapability, domain: z.string(), access: z.enum(["read", "write"]),
  label: z.string(), desc: z.string(), risk: z.enum(["rce", "exec"]).optional(),
});
export type CapabilityInfo = z.infer<typeof zCapabilityInfo>;

// Metadata untuk UI (label Indonesia). risk = high-risk badge.
export const CAPABILITIES: CapabilityInfo[] = [
  { id: "projects:read", domain: "projects", access: "read", label: "Projects — baca", desc: "Lihat daftar & detail project, branch, binding." },
  { id: "projects:write", domain: "projects", access: "write", label: "Projects — tulis", desc: "Buat/ubah/hapus project, rename, clone, DSN, Help Center." },
  { id: "backlog:read", domain: "backlog", access: "read", label: "Backlog — baca", desc: "Lihat spec/backlog, dokumen, review diff." },
  { id: "backlog:write", domain: "backlog", access: "write", label: "Backlog — tulis", desc: "Buat/ubah/hapus spec, integrate branch." },
  { id: "sessions:read", domain: "sessions", access: "read", label: "Sesi — baca", desc: "Lihat sesi terminal, fase, review." },
  { id: "sessions:write", domain: "sessions", access: "write", label: "Sesi — tulis", desc: "Jalankan sesi claude/shell, kirim input, tutup, integrate.", risk: "rce" },
  { id: "docs:read", domain: "docs", access: "read", label: "Docs — baca", desc: "Baca dokumen SoT project & PRD." },
  { id: "docs:write", domain: "docs", access: "write", label: "Docs — tulis", desc: "Tulis/hapus file .md project." },
  { id: "ide:read", domain: "ide", access: "read", label: "IDE/Git — baca", desc: "Lihat tree, file, status git, graph, commit, diff." },
  { id: "ide:write", domain: "ide", access: "write", label: "IDE/Git — tulis", desc: "Tulis file working tree, operasi git, kelola remote." },
  { id: "vps:read", domain: "vps", access: "read", label: "VPS — baca", desc: "Lihat VPS & checklist kepatuhan." },
  { id: "vps:write", domain: "vps", access: "write", label: "VPS — tulis", desc: "Kelola VPS, audit, harden, remediasi, konsol (remote exec).", risk: "exec" },
  { id: "settings:read", domain: "settings", access: "read", label: "Settings — baca", desc: "Baca setelan & config runtime." },
  { id: "settings:write", domain: "settings", access: "write", label: "Settings — tulis", desc: "Ubah setelan & config runtime." },
  { id: "support:read", domain: "support", access: "read", label: "Errors & Tiket — baca", desc: "Lihat error monitoring & tiket Help Center." },
  { id: "support:write", domain: "support", access: "write", label: "Errors & Tiket — tulis", desc: "Eskalasi error, ubah status, terima/tolak tiket." },
  { id: "notifications:read", domain: "notifications", access: "read", label: "Notifikasi — baca", desc: "Lihat notifikasi." },
  { id: "notifications:write", domain: "notifications", access: "write", label: "Notifikasi — tulis", desc: "Tandai terbaca / bersihkan notifikasi." },
];

// write meng-implikasikan read pada domain yang sama.
export function grantsCapability(granted: string[], need: Capability): boolean {
  if (granted.includes(need)) return true;
  if (need.endsWith(":read")) return granted.includes(need.replace(/:read$/, ":write"));
  return false;
}

export const zAgentTokenView = z.object({
  id: z.string(), name: z.string(), tokenPrefix: z.string(),
  capabilities: z.array(zCapability), enabled: z.boolean(),
  createdBy: z.string().nullable(), createdAt: z.string(),
  lastUsedAt: z.string().nullable(), revokedAt: z.string().nullable(),
});
export type AgentTokenView = z.infer<typeof zAgentTokenView>;

export const zAgentTokenCreate = z.object({
  name: z.string().min(1),
  capabilities: z.array(zCapability),
});
export const zAgentTokenPatch = z.object({
  name: z.string().min(1).optional(),
  capabilities: z.array(zCapability).optional(),
  enabled: z.boolean().optional(),
});
```

- [x] **Step 4: Add `agentAccessEnabled` to `zSetting`** — `shared/src/entities.ts`, dalam objek `zSetting` (setelah `notifyDecisionSound`):

```ts
  notifyDecisionSound: z.enum(NOTIFY_SOUNDS).default("alert"),            // SPEC-184
  agentAccessEnabled: z.boolean().default(false),                        // SPEC-257 · master switch akses AI agent
```

- [x] **Step 5: Add paths** — `shared/src/api.ts`, setelah blok `config`:

```ts
  // SPEC-257 · ADR-0065 · agent token (kelola cookie-only) + katalog capability
  agentTokens: `${API}/agent-tokens`,
  agentToken: (id: string) => `${API}/agent-tokens/${id}`,
  agentCapabilities: `${API}/agent-tokens/capabilities`,
```

- [x] **Step 6: Export** — `shared/src/index.ts`, tambah baris:

```ts
export * from "./agent";
```

- [x] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @hanoman/shared exec vitest run test/agent.test.ts && pnpm --filter @hanoman/shared typecheck`
Expected: PASS (5 test) + typecheck clean.

- [x] **Step 8: Commit**

```bash
git add shared/src/agent.ts shared/src/entities.ts shared/src/api.ts shared/src/index.ts shared/test/agent.test.ts
git commit -m "feat(spec-257): shared capability catalog + agent token DTOs + Setting.agentAccessEnabled"
```

---

## Task 2: DB — AgentToken model + migration + generate + data-model doc

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/2026072100_spec257_agent_token/migration.sql`
- Modify: `internal/docs/architecture/data-model.md`

**Interfaces:**
- Produces: `prisma.agentToken` model with fields `id, name, tokenHash(unique), tokenPrefix, capabilities(Json), enabled(default true), createdBy?, createdAt, lastUsedAt?, revokedAt?`.

- [ ] **Step 1: Add model to `server/prisma/schema.prisma`** (setelah `model DeviceToken { ... }`):

```prisma
// SPEC-257 · ADR-0065 · kredensial AI agent eksternal. Server-local (cermin DeviceToken, TAK disync).
// capabilities = Json string[] divalidasi zod (@hanoman/shared). tokenHash = sha256(plaintext).
model AgentToken {
  id           String    @id @default(cuid())
  name         String
  tokenHash    String    @unique
  tokenPrefix  String
  capabilities Json
  enabled      Boolean   @default(true)
  createdBy    String?
  createdAt    DateTime  @default(now())
  lastUsedAt   DateTime?
  revokedAt    DateTime?
}
```

- [ ] **Step 2: Hand-write migration** — `server/prisma/migrations/2026072100_spec257_agent_token/migration.sql`:

```sql
-- SPEC-257 · ADR-0065 · AgentToken (kredensial AI agent, server-local) + Setting.agentAccessEnabled (blob Json, tanpa DDL)
CREATE TABLE "AgentToken" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "capabilities" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentToken_tokenHash_key" ON "AgentToken"("tokenHash");
```

- [ ] **Step 3: Apply migration to dev + test DB, then generate**

Run (dev DB = `DATABASE_URL` di root `.env`; test DB = sibling `_test`):
```bash
pnpm --filter ./server exec prisma migrate deploy
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's#/\([^/?]*\)\(?\|$\)#/\1_test\2#')" \
  pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server exec prisma generate
```
Expected: kedua DB melaporkan migration `2026072100_spec257_agent_token` applied; generate sukses (Prisma Client memuat `AgentToken`).
(Bila `prisma migrate deploy` menolak karena drift sibling worktree, terapkan `migration.sql` langsung: `docker exec -i hanoman-db-1 psql -U hanoman -d hanoman < server/prisma/migrations/2026072100_spec257_agent_token/migration.sql` dan sekali lagi untuk `-d hanoman_test`, lalu `prisma generate`.)

- [ ] **Step 4: Verify Prisma Client sees the model**

Run: `pnpm --filter ./server exec tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); p.agentToken.count().then(n=>{console.log('agentToken rows:',n);process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `agentToken rows: 0` (table exists, empty).

- [ ] **Step 5: Update data-model doc** — `internal/docs/architecture/data-model.md`:
  - Di paragraf pembuka, tambahkan `AgentToken` ke daftar model pendukung (dekat `DeviceToken`).
  - Di bagian `## Setting`, tambah butir: `agentAccessEnabled` (Boolean, default false, SPEC-257/ADR-0065) — master switch akses AI agent; false → semua agent token ditolak.
  - Tambah section baru `## AgentToken (SPEC-257 · ADR-0065)` menjelaskan: server-local tanpa sync (cermin DeviceToken); `tokenHash=sha256` hash-at-rest tak pernah ke client; `capabilities` Json string[] divalidasi zod; `enabled`/`revokedAt` revocable; `createdBy` jejak audit; `lastUsedAt` audit ringan; capability = per-domain read/write, write⊇read; tak-boleh-didelegasikan (auth/agent-tokens/device-tokens/sync).

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/2026072100_spec257_agent_token internal/docs/architecture/data-model.md
git commit -m "feat(spec-257): AgentToken model + migration + data-model doc"
```

---

## Task 3: Server service — agent-token (issue/verify/revoke/list/patch)

**Files:**
- Create: `server/src/services/agent-token.ts`
- Test: `server/test/agent-token.service.test.ts`

**Interfaces:**
- Consumes: `prisma.agentToken` (Task 2), `Capability` (Task 1).
- Produces:
  - `issueAgentToken(input: { name: string; capabilities: string[]; createdBy?: string }): Promise<{ view: AgentTokenView; token: string }>`
  - `verifyAgentToken(token: string): Promise<{ id: string; capabilities: string[] } | null>` (null bila revoked/disabled/tak ada; bump `lastUsedAt` best-effort)
  - `listAgentTokens(): Promise<AgentTokenView[]>`
  - `patchAgentToken(id, patch: { name?; capabilities?; enabled? }): Promise<AgentTokenView | null>`
  - `revokeAgentToken(id): Promise<boolean>`
  - `toAgentTokenView(row): AgentTokenView`

- [ ] **Step 1: Write the failing test** — `server/test/agent-token.service.test.ts`

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  issueAgentToken, verifyAgentToken, listAgentTokens, patchAgentToken, revokeAgentToken,
} from "../src/services/agent-token";

const clean = async () => { await prisma.agentToken.deleteMany(); };
beforeEach(clean);
afterAll(clean);

describe("agent-token service", () => {
  it("issues a token: plaintext once, hash-at-rest, prefix hint", async () => {
    const { view, token } = await issueAgentToken({ name: "ci-bot", capabilities: ["projects:read"] });
    expect(token).toMatch(/^hnm_agt_[0-9a-f]{48}$/);
    expect(view.tokenPrefix).toBe(token.slice(0, 16));
    expect(view.capabilities).toEqual(["projects:read"]);
    expect(view.enabled).toBe(true);
    expect(view).not.toHaveProperty("tokenHash");
    const row = await prisma.agentToken.findUnique({ where: { id: view.id } });
    expect(row!.tokenHash).not.toContain(token);
  });

  it("verifies a valid token, rejects wrong/revoked/disabled, bumps lastUsedAt", async () => {
    const { view, token } = await issueAgentToken({ name: "bot", capabilities: ["backlog:write"] });
    const ok = await verifyAgentToken(token);
    expect(ok).toMatchObject({ id: view.id, capabilities: ["backlog:write"] });
    expect(await verifyAgentToken("hnm_agt_deadbeef")).toBeNull();

    await patchAgentToken(view.id, { enabled: false });
    expect(await verifyAgentToken(token)).toBeNull();
    await patchAgentToken(view.id, { enabled: true });
    expect(await verifyAgentToken(token)).not.toBeNull();

    await revokeAgentToken(view.id);
    expect(await verifyAgentToken(token)).toBeNull();
  });

  it("lists (no secrets) and patches capabilities", async () => {
    const { view } = await issueAgentToken({ name: "bot", capabilities: ["projects:read"] });
    const patched = await patchAgentToken(view.id, { capabilities: ["projects:read", "docs:write"], name: "bot2" });
    expect(patched!.capabilities).toEqual(["projects:read", "docs:write"]);
    expect(patched!.name).toBe("bot2");
    const list = await listAgentTokens();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("tokenHash");
    expect(await patchAgentToken("nope", { name: "x" })).toBeNull();
    expect(await revokeAgentToken("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./server exec vitest run test/agent-token.service.test.ts`
Expected: FAIL — cannot find module `../src/services/agent-token`.

- [ ] **Step 3: Create `server/src/services/agent-token.ts`**

```ts
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { AgentTokenView } from "@hanoman/shared";
import { prisma } from "../db";

// SPEC-257 · ADR-0065 · kredensial AI agent. Hash-at-rest (pola DeviceToken/ingest-key).
// Plaintext hanya lahir & tampil sekali; DB simpan sha256(token).
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

type Row = {
  id: string; name: string; tokenPrefix: string; capabilities: unknown; enabled: boolean;
  createdBy: string | null; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null;
};

export function toAgentTokenView(t: Row): AgentTokenView {
  return {
    id: t.id, name: t.name, tokenPrefix: t.tokenPrefix,
    capabilities: (Array.isArray(t.capabilities) ? t.capabilities : []) as string[],
    enabled: t.enabled, createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
  };
}

export async function issueAgentToken(input: { name: string; capabilities: string[]; createdBy?: string }):
  Promise<{ view: AgentTokenView; token: string }> {
  const token = "hnm_agt_" + randomBytes(24).toString("hex"); // 48 hex chars
  const row = await prisma.agentToken.create({
    data: {
      name: input.name, tokenHash: hash(token), tokenPrefix: token.slice(0, 16),
      capabilities: input.capabilities, createdBy: input.createdBy ?? null,
    },
  });
  return { view: toAgentTokenView(row as Row), token };
}

// Bandingkan lewat lookup by hash (unique) — konstan terhadap isi token via timingSafeEqual pada hash.
export async function verifyAgentToken(token: string): Promise<{ id: string; capabilities: string[] } | null> {
  if (!token) return null;
  const row = await prisma.agentToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!row || !row.enabled || row.revokedAt) return null;
  // timing-safe double-check (hash sudah unik; ini menjaga pola konsisten dgn ingest-key).
  const a = Buffer.from(hash(token), "hex");
  const b = Buffer.from(row.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await prisma.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { id: row.id, capabilities: (Array.isArray(row.capabilities) ? row.capabilities : []) as string[] };
}

export async function listAgentTokens(): Promise<AgentTokenView[]> {
  const rows = await prisma.agentToken.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => toAgentTokenView(r as Row));
}

export async function patchAgentToken(
  id: string, patch: { name?: string; capabilities?: string[]; enabled?: boolean },
): Promise<AgentTokenView | null> {
  const row = await prisma.agentToken.findUnique({ where: { id } });
  if (!row) return null;
  const updated = await prisma.agentToken.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.capabilities !== undefined ? { capabilities: patch.capabilities } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    },
  });
  return toAgentTokenView(updated as Row);
}

export async function revokeAgentToken(id: string): Promise<boolean> {
  const row = await prisma.agentToken.findUnique({ where: { id } });
  if (!row) return false;
  await prisma.agentToken.update({ where: { id }, data: { revokedAt: new Date() } });
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./server exec vitest run test/agent-token.service.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-token.ts server/test/agent-token.service.test.ts
git commit -m "feat(spec-257): agent-token service (issue/verify/revoke/list/patch, hash-at-rest)"
```

---

## Task 4: Server service — agent-capabilities (route→capability map)

**Files:**
- Create: `server/src/services/agent-capabilities.ts`
- Test: `server/test/agent-capabilities.test.ts`

**Interfaces:**
- Consumes: `Capability`, `grantsCapability` (Task 1).
- Produces:
  - `capabilityForRoute(method: string, path: string): Capability | "COOKIE_ONLY" | "GLOBAL_READ" | null` — path adalah `req.url` tanpa query (mis. `/api/projects/foo/docs/x.md`).
  - `checkAgentCapability(caps: string[], method: string, path: string): { ok: true } | { ok: false; status: 403; need?: string; reason: "cookie-only" | "capability" }`

- [ ] **Step 1: Write the failing test** — `server/test/agent-capabilities.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";

describe("capabilityForRoute", () => {
  const cases: [string, string, unknown][] = [
    ["GET", "/api/projects", "projects:read"],
    ["POST", "/api/projects", "projects:write"],
    ["GET", "/api/projects/foo", "projects:read"],
    ["POST", "/api/projects/foo/rename", "projects:write"],
    ["GET", "/api/projects/foo/branches", "projects:read"],
    ["PUT", "/api/projects/foo/binding", "projects:write"],
    ["GET", "/api/projects/foo/docs/README.md", "docs:read"],
    ["PUT", "/api/projects/foo/docs/x.md", "docs:write"],
    ["GET", "/api/projects/foo/prds", "docs:read"],
    ["GET", "/api/prds", "docs:read"],
    ["GET", "/api/projects/foo/tree", "ide:read"],
    ["POST", "/api/projects/foo/git", "ide:write"],
    ["GET", "/api/projects/foo/status", "ide:read"],
    ["POST", "/api/projects/foo/remotes", "ide:write"],
    ["GET", "/api/specs", "backlog:read"],
    ["POST", "/api/specs", "backlog:write"],
    ["POST", "/api/specs/SPEC-1/integrate", "backlog:write"],
    ["GET", "/api/terminal/sessions", "sessions:read"],
    ["POST", "/api/terminal/sessions", "sessions:write"],
    ["GET", "/api/terminal/sessions/abc/ws", "sessions:write"], // WS = kontrol interaktif
    ["GET", "/api/vps", "vps:read"],
    ["POST", "/api/vps/v1/harden", "vps:write"],
    ["GET", "/api/settings", "settings:read"],
    ["PUT", "/api/settings", "settings:write"],
    ["GET", "/api/config", "settings:read"],
    ["GET", "/api/errors", "support:read"],
    ["POST", "/api/errors/e1/escalate", "support:write"],
    ["GET", "/api/tickets", "support:read"],
    ["POST", "/api/tickets/t1/accept", "support:write"],
    ["GET", "/api/notifications", "notifications:read"],
    ["POST", "/api/notifications/read", "notifications:write"],
    ["GET", "/api/limits", "GLOBAL_READ"],
    ["GET", "/api/update", "GLOBAL_READ"],
    ["GET", "/api/events/ws", "GLOBAL_READ"],
    ["GET", "/api/fs/browse", "GLOBAL_READ"],
    ["GET", "/api/auth/users", "COOKIE_ONLY"],
    ["GET", "/api/agent-tokens", "COOKIE_ONLY"],
    ["POST", "/api/agent-tokens", "COOKIE_ONLY"],
    ["GET", "/api/device-tokens", "COOKIE_ONLY"],
    ["GET", "/api/sync/pull", "COOKIE_ONLY"],
    ["GET", "/api/nonsense", null],
  ];
  it.each(cases)("%s %s → %s", (m, p, want) => {
    expect(capabilityForRoute(m, p)).toBe(want);
  });
});

describe("checkAgentCapability", () => {
  it("allows when granted, write covers read, denies otherwise", () => {
    expect(checkAgentCapability(["projects:read"], "GET", "/api/projects")).toEqual({ ok: true });
    expect(checkAgentCapability(["projects:write"], "GET", "/api/projects")).toEqual({ ok: true });
    expect(checkAgentCapability(["projects:read"], "POST", "/api/projects"))
      .toMatchObject({ ok: false, status: 403, need: "projects:write", reason: "capability" });
    expect(checkAgentCapability(["projects:read"], "GET", "/api/auth/users"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    expect(checkAgentCapability(["projects:read"], "GET", "/api/nonsense"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    // GLOBAL_READ: token dengan capability apa pun boleh
    expect(checkAgentCapability(["projects:read"], "GET", "/api/limits")).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./server exec vitest run test/agent-capabilities.test.ts`
Expected: FAIL — cannot find module `../src/services/agent-capabilities`.

- [ ] **Step 3: Create `server/src/services/agent-capabilities.ts`**

```ts
import { grantsCapability, type Capability } from "@hanoman/shared";

// SPEC-257 · ADR-0065 · peta route→capability. path = req.url tanpa query (mis. /api/projects/foo/docs/x.md).
// write meng-implikasikan read (grantsCapability). Route tak dikenal → null → gate perlakukan cookie-only.
type Resolved = Capability | "COOKIE_ONLY" | "GLOBAL_READ" | null;

const IDE_SUBS = new Set([
  "tree", "file", "working-status", "file-diff", "graph", "commit", "git",
  "status", "stashes", "remotes", "compare", "archive", "pr-url",
]);

export function capabilityForRoute(method: string, path: string): Resolved {
  const read = method === "GET" || method === "HEAD";
  const rw = (d: string): Capability => `${d}:${read ? "read" : "write"}` as Capability;
  const seg = path.replace(/^\/api\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const top = seg[0] ?? "";

  // tak-boleh-didelegasikan
  if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync") return "COOKIE_ONLY";
  // read-only global (status)
  if (top === "limits" || top === "update" || top === "events" || top === "fs" || top === "health") return "GLOBAL_READ";
  if (top === "settings" || top === "config") return rw("settings");
  if (top === "specs") return rw("backlog");
  if (top === "notifications") return rw("notifications");
  if (top === "errors" || top === "tickets") return rw("support");
  if (top === "vps") return rw("vps");
  if (top === "prds") return rw("docs");
  if (top === "terminal") {
    if (seg[seg.length - 1] === "ws") return "sessions:write"; // WS = kontrol interaktif
    return rw("sessions");
  }
  if (top === "projects") {
    const sub = seg[2]; // seg[1] = :id
    if (sub === "docs" || sub === "prds") return rw("docs");
    if (sub && IDE_SUBS.has(sub)) return rw("ide");
    return rw("projects");
  }
  return null;
}

export function checkAgentCapability(caps: string[], method: string, path: string):
  { ok: true } | { ok: false; status: 403; need?: string; reason: "cookie-only" | "capability" } {
  const need = capabilityForRoute(method, path);
  if (need === "GLOBAL_READ") return { ok: true };
  if (need === "COOKIE_ONLY" || need === null) return { ok: false, status: 403, reason: "cookie-only" };
  if (grantsCapability(caps, need)) return { ok: true };
  return { ok: false, status: 403, need, reason: "capability" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./server exec vitest run test/agent-capabilities.test.ts`
Expected: PASS (all `it.each` rows + checkAgentCapability).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-capabilities.ts server/test/agent-capabilities.test.ts
git commit -m "feat(spec-257): route→capability map + checkAgentCapability"
```

---

## Task 5: Server — agent-auth + gate integration in app.ts (+ DEFAULT_SETTING)

**Files:**
- Create: `server/src/services/agent-auth.ts`
- Modify: `server/src/services/settings.ts` (DEFAULT_SETTING)
- Modify: `server/src/app.ts` (onRequest jalur agent)
- Test: `server/test/agent-gate.test.ts`

**Interfaces:**
- Consumes: `verifyAgentToken` (Task 3), `checkAgentCapability` (Task 4), `getSetting` (settings service).
- Produces:
  - `agentTokenFromReq(req): string | undefined` (Bearer header ATAU `?agent_token=` untuk WS).
  - `authenticateAgent(token): Promise<{ id: string; capabilities: string[] } | null>` (null bila master switch off / token invalid).
  - `req.agent?: { id: string; capabilities: string[] }` (module augmentation).
  - Gate: cookie user → akses penuh; agent token valid+ber-capability → lanjut; agent tanpa capability / cookie-only → **403**; token invalid/master off → **401**.

- [ ] **Step 1: Write the failing test** — `server/test/agent-gate.test.ts`

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";

const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean);
afterAll(clean);

const setMaster = (on: boolean) => prisma.setting.upsert({
  where: { id: 1 },
  update: { data: { model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: on } },
  create: { id: 1, data: { model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: on } },
});

describe("agent token gate", () => {
  it("no token → 401", async () => {
    expect((await app.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(401);
  });

  it("valid token + master ON + capability → 200; missing capability → 403", async () => {
    await setMaster(true);
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["projects:read"] });
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: h })).statusCode).toBe(200);
    // backlog:read tak diberikan → 403
    const r = await app.inject({ method: "GET", url: "/api/specs", headers: h });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: expect.any(String), need: "backlog:read" });
  });

  it("master switch OFF → valid token still 401", async () => {
    await setMaster(false);
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["projects:read"] });
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it("cookie-only route (agent-tokens, auth) → 403 for agent even with all caps", async () => {
    await setMaster(true);
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["settings:write", "projects:write"] });
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "GET", url: "/api/agent-tokens", headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/auth/users", headers: h })).statusCode).toBe(403);
  });

  it("revoked/disabled token → 401", async () => {
    await setMaster(true);
    const { token, view } = await issueAgentToken({ name: "bot", capabilities: ["projects:read"] });
    await prisma.agentToken.update({ where: { id: view.id }, data: { revokedAt: new Date() } });
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./server exec vitest run test/agent-gate.test.ts`
Expected: FAIL — agent token ignored, `/api/projects` returns 401 even with valid token+master on (jalur agent belum ada).

- [ ] **Step 3: Create `server/src/services/agent-auth.ts`**

```ts
import type { FastifyRequest } from "fastify";
import { verifyAgentToken } from "./agent-token";
import { getSetting } from "./settings";

// SPEC-257 · ADR-0065 · auth AI agent. Cermin req.user/req.device.
declare module "fastify" { interface FastifyRequest { agent?: { id: string; capabilities: string[] } } }

export function agentTokenFromReq(req: FastifyRequest): string | undefined {
  const h = req.headers["authorization"];
  if (typeof h === "string" && h.startsWith("Bearer ")) return h.slice(7);
  // WebSocket upgrade tak bisa set header di browser → terima ?agent_token=
  const q = (req.query as Record<string, unknown> | undefined)?.["agent_token"];
  return typeof q === "string" && q ? q : undefined;
}

// null bila master switch off / token invalid / disabled / revoked.
export async function authenticateAgent(token: string): Promise<{ id: string; capabilities: string[] } | null> {
  const { agentAccessEnabled } = await getSetting();
  if (!agentAccessEnabled) return null;
  return verifyAgentToken(token);
}
```

- [ ] **Step 4: Add `agentAccessEnabled` to `DEFAULT_SETTING`** — `server/src/services/settings.ts`, di objek `DEFAULT_SETTING`:

```ts
  notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false,   // SPEC-257 · akses AI agent off sampai dibuka manusia
```

- [ ] **Step 5: Wire the gate** — `server/src/app.ts`. Tambah import di dekat import auth:

```ts
import { agentTokenFromReq, authenticateAgent } from "./services/agent-auth";
import { checkAgentCapability } from "./services/agent-capabilities";
```

Ganti akhir hook `onRequest` (baris `if (!user) return reply.code(401)...`) dengan:

```ts
        if (user) return; // cookie sesi = akses penuh (tak ada RBAC, konsisten model sekarang)
        // SPEC-257 · ADR-0065 · jalur kedua: agent token (Bearer / ?agent_token= untuk WS).
        const agentTok = agentTokenFromReq(req);
        if (agentTok) {
          const agent = await authenticateAgent(agentTok);
          if (agent) {
            req.agent = agent;
            const path2 = req.url.split("?")[0] ?? req.url;
            const verdict = checkAgentCapability(agent.capabilities, req.method, path2);
            if (verdict.ok) return;
            return reply.code(403).send(
              verdict.reason === "cookie-only"
                ? { error: "cookie session required" }
                : { error: "capability required", need: verdict.need },
            );
          }
        }
        return reply.code(401).send({ error: "unauthorized" });
```

(Catatan: baris `const path = ...` untuk PUBLIC/bypass di atasnya tetap; `path2` dihitung ulang di scope ini agar jelas.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter ./server exec vitest run test/agent-gate.test.ts`
Expected: PASS (5 test).

- [ ] **Step 7: Run the full server auth suite (no regression)**

Run: `pnpm --filter ./server exec vitest run test/auth-routes.test.ts test/app.test.ts test/agent-gate.test.ts`
Expected: PASS — cookie flow tak berubah.

- [ ] **Step 8: Update security-standard doc** — `internal/docs/security/security-standard.md`: tambah bagian "Agent token (SPEC-257/ADR-0065)": jalur auth kedua Bearer/`?agent_token=`; hash-at-rest; master switch `Setting.agentAccessEnabled` (default off); capability per-domain read/write (write⊇read); tak-boleh-didelegasikan (auth/agent-tokens/device-tokens/sync → 403); `sessions:write`=RCE & `vps:write`=remote exec; revoke/disable/master instan. Cookie sesi = akses penuh (tak ada RBAC).

- [ ] **Step 9: Commit**

```bash
git add server/src/services/agent-auth.ts server/src/services/settings.ts server/src/app.ts server/test/agent-gate.test.ts internal/docs/security/security-standard.md
git commit -m "feat(spec-257): agent token auth gate (master switch + capability enforcement) + security doc"
```

---

## Task 6: Server route — /agent-tokens CRUD + capabilities catalog + api-contract doc

**Files:**
- Create: `server/src/routes/agent-tokens.ts`
- Modify: `server/src/app.ts` (register)
- Modify: `internal/docs/architecture/api-contract.md`
- Test: `server/test/agent-tokens.route.test.ts`

**Interfaces:**
- Consumes: `issueAgentToken/listAgentTokens/patchAgentToken/revokeAgentToken` (Task 3), `zAgentTokenCreate/zAgentTokenPatch/CAPABILITIES` (Task 1).
- Produces routes (cookie-only, warisan gate): `GET /agent-tokens`, `POST /agent-tokens`, `GET /agent-tokens/capabilities`, `PATCH /agent-tokens/:id`, `DELETE /agent-tokens/:id`.

- [ ] **Step 1: Write the failing test** — `server/test/agent-tokens.route.test.ts`

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean);
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return cookieOf(r);
}

describe("/agent-tokens routes (cookie-only)", () => {
  it("requires cookie session", async () => {
    expect((await app.inject({ method: "GET", url: "/api/agent-tokens" })).statusCode).toBe(401);
  });

  it("capabilities catalog lists 18 entries", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/api/agent-tokens/capabilities", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().capabilities).toHaveLength(18);
    expect(r.json().capabilities[0]).toMatchObject({ id: expect.any(String), domain: expect.any(String), access: expect.any(String) });
  });

  it("create → plaintext once; list hides secrets; patch; revoke", async () => {
    const cookie = await login();
    let r = await app.inject({ method: "POST", url: "/api/agent-tokens", headers: { cookie }, payload: { name: "ci", capabilities: ["projects:read"] } });
    expect(r.statusCode).toBe(201);
    expect(r.json().token).toMatch(/^hnm_agt_/);
    const id = r.json().id;

    r = await app.inject({ method: "GET", url: "/api/agent-tokens", headers: { cookie } });
    expect(r.json().items).toHaveLength(1);
    expect(JSON.stringify(r.json())).not.toContain("tokenHash");
    expect(r.json().items[0]).not.toHaveProperty("token");

    r = await app.inject({ method: "PATCH", url: `/api/agent-tokens/${id}`, headers: { cookie }, payload: { enabled: false, capabilities: ["projects:read", "docs:read"] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ enabled: false, capabilities: ["projects:read", "docs:read"] });

    expect((await app.inject({ method: "DELETE", url: `/api/agent-tokens/${id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/agent-tokens/nope`, headers: { cookie } })).statusCode).toBe(404);
  });

  it("rejects unknown capability (400) and empty name (400)", async () => {
    const cookie = await login();
    expect((await app.inject({ method: "POST", url: "/api/agent-tokens", headers: { cookie }, payload: { name: "x", capabilities: ["ghost:read"] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/agent-tokens", headers: { cookie }, payload: { name: "", capabilities: [] } })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./server exec vitest run test/agent-tokens.route.test.ts`
Expected: FAIL — `/api/agent-tokens` returns 403 (cookie-only default in gate) atau 404 (route belum diregister).

- [ ] **Step 3: Create `server/src/routes/agent-tokens.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { zAgentTokenCreate, zAgentTokenPatch, CAPABILITIES } from "@hanoman/shared";
import { issueAgentToken, listAgentTokens, patchAgentToken, revokeAgentToken } from "../services/agent-token";

// SPEC-257 · ADR-0065 · kelola agent token dari dashboard (cookie-only, warisan gate + peta COOKIE_ONLY).
// Plaintext token hanya balik di POST (sekali). List & patch tak pernah membuka rahasia.
export default async function (app: FastifyInstance) {
  // Static route sebelum "/:id" agar tak ketangkap param.
  app.get("/agent-tokens/capabilities", async () => ({ capabilities: CAPABILITIES }));

  app.get("/agent-tokens", async () => ({ items: await listAgentTokens() }));

  app.post("/agent-tokens", async (req, reply) => {
    const p = zAgentTokenCreate.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { view, token } = await issueAgentToken({ ...p.data, createdBy: req.user?.id });
    return reply.code(201).send({ ...view, token });
  });

  app.patch("/agent-tokens/:id", async (req, reply) => {
    const p = zAgentTokenPatch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { id } = req.params as { id: string };
    const view = await patchAgentToken(id, p.data);
    return view ? reply.send(view) : reply.code(404).send({ error: "not found" });
  });

  app.delete("/agent-tokens/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return (await revokeAgentToken(id)) ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
  });
}
```

- [ ] **Step 4: Register route** — `server/src/app.ts`: import + register (dekat `deviceTokens`):

```ts
import agentTokens from "./routes/agent-tokens";
```
```ts
    await api.register(deviceTokens);
    await api.register(agentTokens);   // SPEC-257 · kelola agent token (cookie-only)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter ./server exec vitest run test/agent-tokens.route.test.ts`
Expected: PASS (4 test).

- [ ] **Step 6: Update api-contract doc** — `internal/docs/architecture/api-contract.md`:
  - Di blok `> Auth` pembuka, tambah kalimat: jalur auth kedua **agent token** (`Authorization: Bearer` / `?agent_token=` untuk WS) digerbang capability per-domain (SPEC-257/ADR-0065); cookie sesi = akses penuh.
  - Tambah section `## Agent tokens (SPEC-257 · ADR-0065)` mencatat 5 endpoint (cookie-only), bentuk `AgentTokenView`, plaintext-sekali, katalog capability, dan tabel domain→capability + tak-boleh-didelegasikan + read-only global.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/agent-tokens.ts server/src/app.ts internal/docs/architecture/api-contract.md server/test/agent-tokens.route.test.ts
git commit -m "feat(spec-257): /agent-tokens CRUD + capability catalog route + api-contract doc"
```

---

## Task 7: Frontend — api client methods + Settings "Akses AI Agent" panel

**Files:**
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/SettingsScreen.tsx`
- Test: `src/test/agent-tokens.test.tsx`

**Interfaces:**
- Consumes: `paths.agentTokens/agentToken/agentCapabilities` (Task 1), `AgentTokenView`, `CapabilityInfo`, `Setting.agentAccessEnabled`.
- Produces api methods: `listAgentTokens`, `createAgentToken`, `patchAgentToken`, `revokeAgentToken`, `getAgentCapabilities`; UI `AgentAccessPanel` + nav "Akses AI Agent".

- [ ] **Step 1: Add api client methods** — `src/src/api/client.ts`. Tambah import type `AgentTokenView, CapabilityInfo` di baris import `@hanoman/shared`, lalu di objek `api` (dekat device token methods):

```ts
  // SPEC-257 · agent token (kelola cookie-only)
  getAgentCapabilities: () => j<{ capabilities: CapabilityInfo[] }>(paths.agentCapabilities),
  listAgentTokens: () => j<{ items: AgentTokenView[] }>(paths.agentTokens),
  createAgentToken: (b: { name: string; capabilities: string[] }) =>
    j<AgentTokenView & { token: string }>(paths.agentTokens, { method: "POST", ...body(b) }),
  patchAgentToken: (id: string, b: { name?: string; capabilities?: string[]; enabled?: boolean }) =>
    j<AgentTokenView>(paths.agentToken(id), { method: "PATCH", ...body(b) }),
  revokeAgentToken: (id: string) => j<void>(paths.agentToken(id), { method: "DELETE" }),
```

- [ ] **Step 2: Write the failing UI test** — `src/test/agent-tokens.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentAccessPanel } from "../src/screens/SettingsScreen";

vi.mock("../src/api/client", () => ({
  api: {
    getAgentCapabilities: vi.fn(),
    listAgentTokens: vi.fn(),
    createAgentToken: vi.fn(),
    patchAgentToken: vi.fn(),
    revokeAgentToken: vi.fn(),
  },
}));
import { api } from "../src/api/client";

const CAPS = [
  { id: "projects:read", domain: "projects", access: "read", label: "Projects — baca", desc: "" },
  { id: "projects:write", domain: "projects", access: "write", label: "Projects — tulis", desc: "" },
  { id: "sessions:write", domain: "sessions", access: "write", label: "Sesi — tulis", desc: "", risk: "rce" },
];

beforeEach(() => {
  (api.getAgentCapabilities as any).mockResolvedValue({ capabilities: CAPS });
  (api.listAgentTokens as any).mockResolvedValue({ items: [] });
  (api.createAgentToken as any).mockResolvedValue({ id: "t1", name: "ci", tokenPrefix: "hnm_agt_ab", capabilities: ["projects:read"], enabled: true, createdBy: null, createdAt: "2026-07-21T00:00:00Z", lastUsedAt: null, revokedAt: null, token: "hnm_agt_secret" });
});

describe("AgentAccessPanel", () => {
  it("creates a token and shows plaintext once", async () => {
    render(<AgentAccessPanel />);
    await waitFor(() => expect(api.listAgentTokens).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/nama token/i), { target: { value: "ci" } });
    fireEvent.click(screen.getByLabelText("projects:read"));
    fireEvent.click(screen.getByRole("button", { name: /buat token/i }));
    await waitFor(() => expect(api.createAgentToken).toHaveBeenCalledWith({ name: "ci", capabilities: ["projects:read"] }));
    await waitFor(() => expect(screen.getByText("hnm_agt_secret")).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter ./src exec vitest run test/agent-tokens.test.tsx`
Expected: FAIL — `AgentAccessPanel` belum diekspor dari SettingsScreen.

- [ ] **Step 4: Implement `AgentAccessPanel`** — `src/src/screens/SettingsScreen.tsx`. Tambah komponen (cermin `DeviceTokensPanel`, gunakan komponen UI existing seperti `Button`, `SettingRow`, dan pola toast). Ekspor bernama supaya bisa dites:

```tsx
export function AgentAccessPanel({ onToast }: { onToast?: ShowToast } = {}) {
  const [caps, setCaps] = React.useState<CapabilityInfo[]>([]);
  const [items, setItems] = React.useState<AgentTokenView[]>([]);
  const [name, setName] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [fresh, setFresh] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    api.listAgentTokens().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  React.useEffect(() => { api.getAgentCapabilities().then((r) => setCaps(r.capabilities)).catch(() => {}); load(); }, [load]);
  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  async function create() {
    if (!name.trim()) return;
    try {
      const r = await api.createAgentToken({ name: name.trim(), capabilities: picked });
      setFresh(r.token); setName(""); setPicked([]); load(); onToast?.("Token dibuat", "ok");
    } catch { onToast?.("Gagal membuat token", "err"); }
  }
  async function revoke(t: AgentTokenView) {
    try { await api.revokeAgentToken(t.id); load(); onToast?.("Token dicabut", "ok"); } catch { onToast?.("Gagal mencabut", "err"); }
  }
  async function setEnabled(t: AgentTokenView, enabled: boolean) {
    try { await api.patchAgentToken(t.id, { enabled }); load(); } catch { onToast?.("Gagal", "err"); }
  }
  const active = items.filter((t) => !t.revokedAt);
  return (
    <div>
      {fresh && (
        <div role="status">
          <code>{fresh}</code>
          <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(fresh); onToast?.("Disalin", "ok", "copy"); }}>Salin</Button>
          <span> · Simpan sekarang — takkan ditampilkan lagi.</span>
        </div>
      )}
      <div>
        <input placeholder="Nama token" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          {caps.map((c) => (
            <label key={c.id}>
              <input type="checkbox" aria-label={c.id} checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.label}{c.risk ? " ⚠" : ""}
            </label>
          ))}
        </div>
        <Button onClick={() => void create()}>Buat token</Button>
      </div>
      <ul>
        {active.map((t) => (
          <li key={t.id}>
            <span>{t.name}</span> <code>{t.tokenPrefix}…</code> <span>{t.capabilities.length} capability</span>
            <input type="checkbox" aria-label={`enabled-${t.id}`} checked={t.enabled} onChange={(e) => void setEnabled(t, e.target.checked)} />
            <Button size="sm" onClick={() => void revoke(t)}>Cabut</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```
Tambah import type di atas file: `import type { AgentTokenView, CapabilityInfo } from "@hanoman/shared";` (bila belum ada, gabung ke import `@hanoman/shared` existing).

- [ ] **Step 5: Add master switch + nav entry** — `src/src/screens/SettingsScreen.tsx`:
  - Di `prefs()` (bagian toggle Setting), tambah `SettingRow` "Akses AI agent" dengan switch `agentAccessEnabled` memakai helper `sw("agentAccessEnabled", "Akses AI agent")` (pola toggle existing) + teks peringatan singkat.
  - Di grup navigasi (`nav`), tambah item "Akses AI Agent" yang merender `<AgentAccessPanel onToast={onToast} />` (cermin cara `DeviceTokensPanel`/`ConfigPanel` dipanggil dari nav).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter ./src exec vitest run test/agent-tokens.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 7: Typecheck + existing settings tests (no regression)**

Run: `pnpm --filter ./src exec tsc --noEmit && pnpm --filter ./src exec vitest run test/settings-nav.test.tsx test/settings-no-matrix.test.tsx`
Expected: typecheck clean; settings tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/src/api/client.ts src/src/screens/SettingsScreen.tsx src/test/agent-tokens.test.tsx
git commit -m "feat(spec-257): Settings Akses AI Agent panel + agent token api client"
```

---

## Task 8: ADR-0065 + index link + SKILL + full verification (live curl)

**Files:**
- Create: `internal/docs/adr/0065-ai-agent-capability-agent-token.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:** none (dokumentasi + verifikasi end-to-end).

- [ ] **Step 1: Write ADR-0065** — `internal/docs/adr/0065-ai-agent-capability-agent-token.md`. Isi: Konteks (seluruh fitur sudah REST /api, digerbang cookie; kebutuhan agen eksternal full-control opt-in per fitur). Keputusan: Agent Token (Bearer, hash-at-rest, server-local, cermin DeviceToken) sebagai jalur auth kedua; capability per-domain read/write (write⊇read); master switch `Setting.agentAccessEnabled`; peta route→capability; tak-boleh-didelegasikan (auth/agent-tokens/device-tokens/sync); tanpa MCP (follow-on), tanpa RBAC (satu workspace), tanpa audit log per-aksi (cukup lastUsedAt). Konsekuensi: agent token memperluas permukaan auth tapi bukan permukaan eksekusi; `sessions:write`=RCE tetap dibatasi isolasi worktree (ADR-0037); privilege-escalation dicegah (kelola token cookie-only). Header: status Accepted, memperluas 0028 (auth), terkait 0037/0044/0060/0062.

- [ ] **Step 2: Link ADR di index** — `internal/docs/README.md`, di bagian `## adr` (paling atas daftar):

```markdown
- [0065 — AI agent capability: agent token + capability scope per-domain gating /api](adr/0065-ai-agent-capability-agent-token.md) — **memperluas 0028**, terkait 0037/0044 (SPEC-257)
```

- [ ] **Step 3: Update SKILL** — `internal/skills/hanoman/SKILL.md`: di daftar model pendukung/ADR yang sering diacu, sebut `AgentToken` (SPEC-257/ADR-0065) sebagai kredensial AI agent + capability scope; di Aturan Keamanan tambah satu baris jalur auth kedua agent token (Bearer, capability, master switch, tak-boleh-didelegasikan).

- [ ] **Step 4: Full test suite (server + shared + frontend)**

Run:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec vitest run
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run
```
Expected: semua hijau. Perbaiki regresi sampai hijau sebelum lanjut.

- [ ] **Step 5: Docs index integrity + coverage**

Run: `pnpm --filter ./server exec tsx -e "1" >/dev/null 2>&1; node -e "1"` (noop) lalu `hanoman docs index --check` bila CLI tersedia, else lewati.
Expected: index konsisten (ADR-0065 ter-link).

- [ ] **Step 6: Build + boot server + LIVE curl**

Boot server lokal terhadap DB migrated (bukan hanoman_test — pakai DB dev), lalu:
```bash
pnpm build   # verifikasi exit 0 (dist ter-stamp)
# di terminal terpisah: NODE_ENV=production node server/dist/server.js  (atau pnpm dev)
BASE=http://127.0.0.1:8787
# 1) setup/login → cookie
curl -s -c /tmp/agc.cookie -X POST $BASE/api/auth/setup -H 'content-type: application/json' -d '{"email":"a@b.co","password":"password1"}' >/dev/null || \
  curl -s -c /tmp/agc.cookie -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{"email":"a@b.co","password":"password1"}' >/dev/null
# 2) katalog capability
curl -s -b /tmp/agc.cookie $BASE/api/agent-tokens/capabilities | head -c 200; echo
# 3) nyalakan master switch (PUT /settings — ambil dulu, set agentAccessEnabled true)
S=$(curl -s -b /tmp/agc.cookie $BASE/api/settings)
curl -s -b /tmp/agc.cookie -X PUT $BASE/api/settings -H 'content-type: application/json' \
  -d "$(node -e "const s=$S; s.agentAccessEnabled=true; process.stdout.write(JSON.stringify(s))")" >/dev/null
# 4) buat agent token (projects:read saja)
TOK=$(curl -s -b /tmp/agc.cookie -X POST $BASE/api/agent-tokens -H 'content-type: application/json' -d '{"name":"curlbot","capabilities":["projects:read"]}' | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).token))")
echo "token=$TOK"
# 5) pakai token → projects (punya capability) = 200
curl -s -o /dev/null -w "projects(agent): %{http_code}\n" -H "authorization: Bearer $TOK" $BASE/api/projects
# 6) pakai token → specs (tak punya backlog:read) = 403
curl -s -o /dev/null -w "specs(agent): %{http_code}\n" -H "authorization: Bearer $TOK" $BASE/api/specs
# 7) pakai token → agent-tokens (cookie-only) = 403
curl -s -o /dev/null -w "agent-tokens(agent): %{http_code}\n" -H "authorization: Bearer $TOK" $BASE/api/agent-tokens
```
Expected: capability catalog JSON tampil; `projects(agent): 200`; `specs(agent): 403`; `agent-tokens(agent): 403`. (Bonus: matikan master switch lalu ulangi #5 → `401`.)

- [ ] **Step 7: Commit**

```bash
git add internal/docs/adr/0065-ai-agent-capability-agent-token.md internal/docs/README.md internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-257): ADR-0065 + index link + SKILL; verifikasi live curl"
```

---

## Self-Review

**Spec coverage:**
- Agent token (Bearer, hash-at-rest, revocable, plaintext-once) → Task 2/3.
- Capability per-domain read/write (write⊇read) + katalog → Task 1/4.
- Master switch `agentAccessEnabled` → Task 1/5.
- Gate (cookie penuh; agent capability; 401/403; WS `?agent_token=`) → Task 5.
- Tak-boleh-didelegasikan (auth/agent-tokens/device-tokens/sync) → Task 4/5.
- Endpoint `/agent-tokens` CRUD + capabilities → Task 6.
- UI Settings (master switch, list, create modal, revoke, plaintext-once) → Task 7.
- Docs SoT (data-model, api-contract, security, ADR, index, SKILL) → Task 2/5/6/8.
- Verifikasi nyata (unit + live curl) → Task 8.

**Placeholder scan:** tak ada TBD/TODO; tiap step berkode.

**Type consistency:** `capabilityForRoute`/`checkAgentCapability`/`grantsCapability`/`issueAgentToken`/`verifyAgentToken`/`patchAgentToken`/`revokeAgentToken`/`AgentTokenView`/`CapabilityInfo`/`zAgentTokenCreate`/`zAgentTokenPatch`/`agentAccessEnabled`/`req.agent` konsisten lintas Task 1→8.
