# Log Error Monitoring (Sentry ringan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use markdown task-checkbox syntax for tracking (unchecked → checked as each step completes). **STATUS: semua task selesai & terverifikasi.**

**Goal:** Jadikan hanoman Sentry ringan satu-workspace: ingest error ber-DSN per-project → grouping otomatis → area Error di dashboard → notifikasi grup baru → eskalasi 1-klik ke `Spec`.

**Architecture:** Dua model Prisma baru (`ErrorGroup`, `ErrorEvent`) + dua kolom `Project` (`ingestKeyHash`, `ingestKeyPrefix`). Endpoint ingest publik ber-DSN (bypass gate cookie, pola `/api/sync`), grouping deterministik via fingerprint, retensi opportunistic-on-write, rate-limit token-bucket in-memory. Notifikasi reuse model `Notification` (type `error`) + WS existing. Eskalasi reuse jalur pembuatan `Spec` (source qa). Frontend: area `errors` (silent HTTP polling), DSN mgmt di project detail, notif error. SDK Node+browser in-repo.

**Tech Stack:** Node/TS Fastify, Prisma/Postgres, React/TS/Vite, zod (`@hanoman/shared`), vitest.

## Global Constraints

- TypeScript strict; test tiap logika orchestrasi. Test repo: `vitest run --no-file-parallelism`, `env -u NODE_ENV -u DATABASE_URL`, base DB unik (mis. `DATABASE_URL=postgresql://hanoman:hanoman@localhost:5433/hanoman249` → test pakai `hanoman249_test`) untuk hindari truncate sibling.
- **Jangan ubah skema tanpa migration + ADR.** Hand-write `migration.sql` + `migrate deploy` per DB (dev + test), `prisma generate` sesudahnya. Jangan `migrate dev` (reset saat drift).
- Postgres di Docker: `docker exec hanoman-db-1 psql -U hanoman -d <db>`. DB dijaga kosong; jangan seed demo.
- Update `internal/docs/**` yang tersentuh dalam commit yang sama + link di `internal/docs/README.md`.
- **Tiap task execute selesai: centang checklist di file ini + test API nyata di local** (boot server + curl endpoint tersentuh), bukan hanya unit test.
- **ADR baru = 0060** (verifikasi ulang bebas lintas branch sebelum menulis). `ingestKeyHash` tak pernah ke client/log. Model error server-local (tanpa `version`/sync).
- Realtime: daftar Error = HTTP polling (pola silent-poll `GitGraph`). Notifikasi lewat WS existing. Jangan tambah kanal WS baru.

## File Structure

Dibuat:
- `server/prisma/migrations/2026072000_spec249_error_monitoring/migration.sql`
- `server/src/services/ingest-key.ts` — generate/format/hash/verify DSN key
- `server/src/services/error-fingerprint.ts` — fungsi murni (normalize, topFrame, fingerprint)
- `server/src/services/error-ingest.ts` — pemrosesan ingest (caps, rate-limit, upsert grup, event, retensi, notif)
- `server/src/routes/ingest.ts` — route publik `POST /api/ingest/:slug` (+ OPTIONS)
- `server/src/routes/errors.ts` — `GET /api/errors`, `GET /api/errors/:id`, `POST /api/errors/:id/escalate`, `PATCH /api/errors/:id`
- `src/screens/ErrorsScreen.tsx` — area Error + detail grup
- `sdk/node/hanoman-error.ts`, `sdk/browser/hanoman-error.js`, `sdk/README.md`
- `internal/docs/adr/0060-error-monitoring-ingest-ber-dsn.md`
- Test: `server/src/**/*.test.ts` (fingerprint, ingest-key, ingest, errors, escalate), `src/test/errors-screen.test.tsx`

Dimodifikasi:
- `server/prisma/schema.prisma`, `shared/src/{enums,entities,dto,api}.ts`
- `server/src/routes/projects.ts` (ingest-key endpoints), `server/src/services/project-view.ts` (expose monitoringEnabled/prefix)
- `server/src/app.ts` (register + bypass ingest), `server/src/services/notifications.ts` (recordNewErrorGroup)
- `src/api/client.ts`, `src/ds/shell.tsx`, `src/App.tsx`, `src/screens/types.ts`, `src/screens/ProjectDetailScreen.tsx`
- `src/notifications/{NotificationsContext.tsx,NotificationBell.tsx,target.ts}`
- `internal/docs/architecture/{data-model,api-contract}.md`, `internal/docs/security/security-standard.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/docs/README.md`

---

### Task 1: Skema + migration + tipe shared + ADR

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/2026072000_spec249_error_monitoring/migration.sql`
- Modify: `shared/src/enums.ts`, `shared/src/entities.ts`, `shared/src/dto.ts`, `shared/src/api.ts`
- Create: `internal/docs/adr/0060-error-monitoring-ingest-ber-dsn.md`
- Modify: `internal/docs/architecture/data-model.md`, `internal/docs/README.md`

**Interfaces:**
- Produces: model `ErrorGroup` (`id, projectId, fingerprint, type, message, sampleStack?, environment, status, count, firstSeenAt, lastSeenAt, specId?, createdAt, updatedAt`), `ErrorEvent` (`id, groupId, projectId, type, message, stack?, environment, release?, context?, receivedAt`), `Project.ingestKeyHash?`, `Project.ingestKeyPrefix?`.
- Produces (shared): `zErrorStatus = z.enum(["new","escalated","resolved"])`; `zIngestPayload`; `zErrorGroupView`; `zErrorEventView`; `zErrorGroupDetail`; `zIngestKeyView`; `zNotification.type` menerima `"error"`; `zQaPayload.fromErrorGroup?`; `paths.ingest/errors/error/errorEscalate/projectIngestKey`.

- [x] **Step 1: Tambah model ke `schema.prisma`** (setelah model `Vps`/sebelum akhir), dan dua kolom di `model Project`:

```prisma
// model Project — tambah dua kolom (additive, nullable):
  ingestKeyHash   String?  // SPEC-249 · sha256(ingest key) hex; null = monitoring off. Tak pernah ke client.
  ingestKeyPrefix String?  // SPEC-249 · ~12 char awal key untuk hint UI (bukan rahasia)
  errorGroups     ErrorGroup[]

// SPEC-249 · ADR-0060 · grup error per project (fingerprint dedup). Server-local (tanpa sync).
model ErrorGroup {
  id          String   @id @default(cuid())
  projectId   String
  fingerprint String
  type        String
  message     String
  sampleStack String?
  environment String
  status      String   @default("new") // new | escalated | resolved
  count       Int      @default(0)
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  specId      String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @default(now())
  project     Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  events      ErrorEvent[]

  @@unique([projectId, fingerprint])
  @@index([projectId, lastSeenAt])
}

// SPEC-249 · ADR-0060 · kejadian error mentah, dipangkas retensi (cap per grup + umur).
model ErrorEvent {
  id          String   @id @default(cuid())
  groupId     String
  projectId   String
  type        String
  message     String
  stack       String?
  environment String
  release     String?
  context     Json?
  receivedAt  DateTime @default(now())
  group       ErrorGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@index([groupId, receivedAt])
  @@index([projectId, receivedAt])
}
```

- [x] **Step 2: Tulis `migration.sql`** (hand-write; nama dir `2026072000_spec249_error_monitoring`):

```sql
-- Project: kolom ingest key (additive)
ALTER TABLE "Project" ADD COLUMN "ingestKeyHash" TEXT;
ALTER TABLE "Project" ADD COLUMN "ingestKeyPrefix" TEXT;

-- ErrorGroup
CREATE TABLE "ErrorGroup" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "sampleStack" TEXT,
  "environment" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "count" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "specId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ErrorGroup_projectId_fingerprint_key" ON "ErrorGroup"("projectId", "fingerprint");
CREATE INDEX "ErrorGroup_projectId_lastSeenAt_idx" ON "ErrorGroup"("projectId", "lastSeenAt");
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ErrorEvent
CREATE TABLE "ErrorEvent" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "environment" TEXT NOT NULL,
  "release" TEXT,
  "context" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ErrorEvent_groupId_receivedAt_idx" ON "ErrorEvent"("groupId", "receivedAt");
CREATE INDEX "ErrorEvent_projectId_receivedAt_idx" ON "ErrorEvent"("projectId", "receivedAt");
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ErrorGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [x] **Step 3: Terapkan migration ke DB dev + test, lalu generate**

```bash
cd server
# dev DB (sesuaikan DATABASE_URL sesi; base unik untuk hindari sibling)
DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman249" npx prisma migrate deploy
DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman249_test" npx prisma migrate deploy
npx prisma generate
```
Expected: "migrations applied" untuk kedua DB; generate sukses.

- [x] **Step 4: Tambah tipe shared.** `shared/src/enums.ts`:

```ts
export const zErrorStatus = z.enum(["new","escalated","resolved"]);
```

`shared/src/entities.ts` — extend zNotification.type & zQaPayload:

```ts
// zNotification.type:
  type: z.enum(["done", "decision", "error"]).default("done"),
// zQaPayload — tambah field jejak opsional (cermin fromAudit):
  fromErrorGroup: z.string().optional(),   // SPEC-249 · qa dari eskalasi error → tautan grup
```

`shared/src/dto.ts` — tambah:

```ts
import { zErrorStatus } from "./enums";

export const zIngestPayload = z.object({
  type: z.string().min(1).max(500),
  message: z.string().min(1),
  stack: z.string().optional(),
  environment: z.string().max(120).optional(),
  release: z.string().max(200).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type IngestPayload = z.infer<typeof zIngestPayload>;

export const zErrorGroupView = z.object({
  id: z.string(), projectId: z.string(), type: z.string(), message: z.string(),
  environment: z.string(), status: zErrorStatus, count: z.number().int(),
  firstSeenAt: z.string(), lastSeenAt: z.string(), specId: z.string().nullable(),
});
export type ErrorGroupView = z.infer<typeof zErrorGroupView>;

export const zErrorEventView = z.object({
  id: z.string(), type: z.string(), message: z.string(), stack: z.string().nullable(),
  environment: z.string(), release: z.string().nullable(), receivedAt: z.string(),
});
export type ErrorEventView = z.infer<typeof zErrorEventView>;

export const zErrorGroupDetail = zErrorGroupView.extend({
  sampleStack: z.string().nullable(),
  events: z.array(zErrorEventView),
});
export type ErrorGroupDetail = z.infer<typeof zErrorGroupDetail>;

export const zIngestKeyView = z.object({
  enabled: z.boolean(), prefix: z.string().nullable(),
  key: z.string().optional(), dsnUrl: z.string().optional(),  // key/dsnUrl hanya saat generate/rotate
});
export type IngestKeyView = z.infer<typeof zIngestKeyView>;
```

`shared/src/api.ts` `paths` — tambah:

```ts
  ingest: (slug: string) => `${API}/ingest/${encodeURIComponent(slug)}`,
  errors: `${API}/errors`,
  error: (id: string) => `${API}/errors/${id}`,
  errorEscalate: (id: string) => `${API}/errors/${id}/escalate`,
  projectIngestKey: (id: string) => `${API}/projects/${encodeURIComponent(id)}/ingest-key`,
```

- [x] **Step 5: Tulis ADR-0060** `internal/docs/adr/0060-error-monitoring-ingest-ber-dsn.md`: konteks (PRD, gate `/api` ADR-0028), keputusan (model baru ErrorGroup/ErrorEvent + kolom ingest key; ingest publik `POST /api/ingest/:slug` diotorisasi DSN hash-at-rest sebagai pengecualian sah gate; grouping fingerprint; retensi opportunistic; rate-limit in-memory; notif reuse; eskalasi reuse Spec qa), konsekuensi (model error server-local tanpa sync; DSN semi-publik utk browser; no grace on rotate). Status: Accepted. Link di `internal/docs/README.md` bagian `## adr`.

- [x] **Step 6: Update `data-model.md`** — bagian baru ErrorGroup/ErrorEvent + kolom ingest key Project; sesuaikan narasi jumlah model (tujuh → sembilan; catat error model server-local tanpa sync).

- [x] **Step 7: Compile check**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-249
pnpm -C shared build && pnpm -C server exec tsc --noEmit
```
Expected: no type errors.

- [x] **Step 8: Commit**

```bash
git add server/prisma shared/src internal/docs
git commit -m "feat(spec-249): schema ErrorGroup/ErrorEvent + ingest key + shared types + ADR-0060"
```

---

### Task 2: Ingest key (DSN) — service + endpoints project

**Files:**
- Create: `server/src/services/ingest-key.ts`
- Test: `server/src/services/ingest-key.test.ts`
- Modify: `server/src/routes/projects.ts`, `server/src/services/project-view.ts`
- Modify: `shared/src/dto.ts` (ProjectView: `monitoringEnabled`, `ingestKeyPrefix`), `src/screens/types.ts`, `src/api/client.ts`
- Test: `server/src/routes/projects-ingest-key.test.ts`

**Interfaces:**
- Consumes: `Project.ingestKeyHash/ingestKeyPrefix` (Task 1).
- Produces: `generateIngestKey(): { key, hash, prefix }`; `hashKey(key): string`; `verifyKey(key, hash): boolean` (timing-safe); `dsnUrl(slug, key, base): string`. Route: `POST/DELETE/GET /api/projects/:id/ingest-key`. `ProjectView.monitoringEnabled: boolean`, `ProjectView.ingestKeyPrefix: string | null`.

- [x] **Step 1: Test service** `ingest-key.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateIngestKey, hashKey, verifyKey } from "./ingest-key";

describe("ingest-key", () => {
  it("generates a prefixed key + matching hash + prefix hint", () => {
    const { key, hash, prefix } = generateIngestKey();
    expect(key).toMatch(/^hnm_ing_[a-f0-9]{32,}$/);
    expect(hashKey(key)).toBe(hash);
    expect(prefix.length).toBeLessThanOrEqual(16);
    expect(key.startsWith(prefix)).toBe(true);
  });
  it("verifies correct key and rejects wrong/empty", () => {
    const { key, hash } = generateIngestKey();
    expect(verifyKey(key, hash)).toBe(true);
    expect(verifyKey("hnm_ing_wrong", hash)).toBe(false);
    expect(verifyKey("", hash)).toBe(false);
    expect(verifyKey(key, null)).toBe(false);
  });
});
```

- [x] **Step 2: Run → fail** `pnpm -C server exec vitest run src/services/ingest-key.test.ts` → FAIL (module not found).

- [x] **Step 3: Implement `ingest-key.ts`**:

```ts
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateIngestKey(): { key: string; hash: string; prefix: string } {
  const key = "hnm_ing_" + randomBytes(24).toString("hex"); // 48 hex chars
  return { key, hash: hashKey(key), prefix: key.slice(0, 16) };
}

export function verifyKey(key: string, hash: string | null): boolean {
  if (!key || !hash) return false;
  const a = Buffer.from(hashKey(key), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function dsnUrl(slug: string, key: string, base: string): string {
  return `${base.replace(/\/$/, "")}/api/ingest/${encodeURIComponent(slug)}?key=${key}`;
}
```

- [x] **Step 4: Run → pass** `pnpm -C server exec vitest run src/services/ingest-key.test.ts` → PASS.

- [x] **Step 5: Expose di ProjectView.** `server/src/services/project-view.ts` `toProjectView` — tambah `monitoringEnabled: !!p.ingestKeyHash`, `ingestKeyPrefix: p.ingestKeyPrefix ?? null`. **Jangan** ikutkan `ingestKeyHash`. `shared/src/dto.ts` `zProjectView` (atau turunan) — tambah `monitoringEnabled: z.boolean()`, `ingestKeyPrefix: z.string().nullable()`. `src/screens/types.ts` `ProjectVM` — tambah dua field itu.

- [x] **Step 6: Endpoints project.** `server/src/routes/projects.ts` — tambah:

```ts
import { generateIngestKey, dsnUrl } from "../services/ingest-key";

app.get("/projects/:id/ingest-key", async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return reply.code(404).send({ error: "not found" });
  return { enabled: !!p.ingestKeyHash, prefix: p.ingestKeyPrefix ?? null };
});

app.post("/projects/:id/ingest-key", async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return reply.code(404).send({ error: "not found" });
  const { key, hash, prefix } = generateIngestKey();
  await prisma.project.update({ where: { id }, data: { ingestKeyHash: hash, ingestKeyPrefix: prefix } });
  const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
  return reply.code(201).send({ enabled: true, prefix, key, dsnUrl: dsnUrl(id, key, base) });
});

app.delete("/projects/:id/ingest-key", async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return reply.code(404).send({ error: "not found" });
  await prisma.project.update({ where: { id }, data: { ingestKeyHash: null, ingestKeyPrefix: null } });
  return reply.code(204).send();
});
```

- [x] **Step 7: Test route** `projects-ingest-key.test.ts` (pola test route lain, `buildApp({ requireAuth:false })`): POST membuat key (201, `key` + `dsnUrl` + `prefix`, `enabled:true`); GET setelahnya `{ enabled:true, prefix }` **tanpa** `key`; project view `monitoringEnabled:true`; DELETE → 204, GET `{ enabled:false, prefix:null }`; POST kedua (rotate) menghasilkan prefix berbeda. Verifikasi `ingestKeyHash` tak muncul di response project.

- [x] **Step 8: Client methods** `src/api/client.ts`:

```ts
getIngestKey: (id: string) => j<IngestKeyView>(paths.projectIngestKey(id)),
rotateIngestKey: (id: string) => j<IngestKeyView>(paths.projectIngestKey(id), { method: "POST" }),
revokeIngestKey: (id: string) => j<void>(paths.projectIngestKey(id), { method: "DELETE" }),
```

- [x] **Step 9: Run all + curl.** `env -u NODE_ENV -u DATABASE_URL pnpm -C server exec vitest run` → PASS. Boot server lokal (DB throwaway migrated), curl:

```bash
curl -sS -XPOST localhost:8799/api/projects/<slug>/ingest-key | jq   # {enabled,prefix,key,dsnUrl}
curl -sS localhost:8799/api/projects/<slug>/ingest-key | jq          # {enabled:true,prefix} tanpa key
curl -sS -XDELETE localhost:8799/api/projects/<slug>/ingest-key -i   # 204
```

- [x] **Step 10: Commit** `git commit -m "feat(spec-249): DSN ingest key service + project endpoints + ProjectView exposure"`

---

### Task 3: Fingerprint grouping (fungsi murni)

**Files:**
- Create: `server/src/services/error-fingerprint.ts`
- Test: `server/src/services/error-fingerprint.test.ts`

**Interfaces:**
- Produces: `normalizeMessage(msg: string): string`; `topFrame(stack?: string): string`; `fingerprint(type: string, message: string, stack?: string): string` (hex 32 char, deterministik).

- [x] **Step 1: Test** `error-fingerprint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeMessage, topFrame, fingerprint } from "./error-fingerprint";

describe("error-fingerprint", () => {
  it("normalizes volatile tokens so variants collapse", () => {
    const a = normalizeMessage("User 12345 not found at 0xABCDEF");
    const b = normalizeMessage("User 99 not found at 0x001122");
    expect(a).toBe(b);
  });
  it("collapses quoted strings and uuids", () => {
    expect(normalizeMessage(`Cannot read "abc"`)).toBe(normalizeMessage(`Cannot read "xyz"`));
    expect(normalizeMessage("id 550e8400-e29b-41d4-a716-446655440000"))
      .toBe(normalizeMessage("id 6ba7b810-9dad-11d1-80b4-00c04fd430c8"));
  });
  it("takes the top frame ignoring line/col and absolute path", () => {
    const stack = "Error: boom\n    at foo (/Users/x/app/a.js:10:5)\n    at bar (/Users/x/app/b.js:2:1)";
    const stack2 = "Error: boom\n    at foo (/srv/app/a.js:99:9)\n    at bar (/srv/app/b.js:1:1)";
    expect(topFrame(stack)).toBe(topFrame(stack2));
  });
  it("same shape → same fingerprint; different type → different", () => {
    const s1 = "Error: x\n    at foo (/a/a.js:1:1)";
    const s2 = "Error: x\n    at foo (/b/a.js:9:9)";
    expect(fingerprint("TypeError", "User 1 gone", s1)).toBe(fingerprint("TypeError", "User 2 gone", s2));
    expect(fingerprint("RangeError", "User 1 gone", s1)).not.toBe(fingerprint("TypeError", "User 1 gone", s1));
    expect(fingerprint("TypeError", "x")).toHaveLength(32);
  });
});
```

- [x] **Step 2: Run → fail.**

- [x] **Step 3: Implement `error-fingerprint.ts`**:

```ts
import { createHash } from "node:crypto";

export function normalizeMessage(msg: string): string {
  return (msg || "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/"[^"]*"|'[^']*'/g, "<str>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function topFrame(stack?: string): string {
  if (!stack) return "";
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    return line
      .replace(/:\d+:\d+/g, "")          // buang :line:col
      .replace(/\(([^)]*[\/\\])?([^\/\\)]+)\)/, "($2)")  // path absolut → basename
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

export function fingerprint(type: string, message: string, stack?: string): string {
  const basis = `${type}\n${normalizeMessage(message)}\n${topFrame(stack)}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
```

- [x] **Step 4: Run → pass.**

- [x] **Step 5: Commit** `git commit -m "feat(spec-249): deterministic error fingerprint (normalize + top frame)"`

---

### Task 4: Ingest endpoint (publik, DSN-auth, CORS, caps, rate-limit, grouping, retensi, notif)

**Files:**
- Create: `server/src/services/error-ingest.ts`, `server/src/routes/ingest.ts`
- Modify: `server/src/app.ts` (register `ingest` + bypass gate `/api/ingest`), `server/src/services/notifications.ts` (recordNewErrorGroup)
- Test: `server/src/services/error-ingest.test.ts`, `server/src/routes/ingest.test.ts`

**Interfaces:**
- Consumes: `verifyKey` (Task 2), `fingerprint` (Task 3), models (Task 1).
- Produces: `ingestError(projectId, payload): Promise<{ groupId, new }>`; `rateLimitOk(projectId): boolean` (in-memory); `recordNewErrorGroup(groupId, projectId, projectName, type, message): Promise<void>`. Route: `POST /api/ingest/:slug`, `OPTIONS /api/ingest/:slug`.

- [x] **Step 1: Test service** `error-ingest.test.ts` (DB-backed, buat Project fixture): 
  - kejadian pertama → grup baru (`new:true`, count 1); kejadian identik kedua → grup sama (`new:false`, count 2, `lastSeenAt` maju);
  - environment production + grup baru → 1 Notification `key="error:<groupId>"`; kejadian kedua tak menambah notif; environment non-production → tak ada notif;
  - retensi: setelah > cap (mis. set cap kecil via arg/const) kejadian, `errorEvent.count` untuk grup ≤ cap;
  - `message`/`stack` di-truncate ke caps.

- [x] **Step 2: Run → fail.**

- [x] **Step 3: Implement `error-ingest.ts`** (caps + rate-limit + upsert + retensi + notif). Konstanta tunable via `effectiveInt` (config) dengan default:

```ts
import { prisma } from "../db";
import { fingerprint } from "./error-fingerprint";
import { recordNewErrorGroup } from "./notifications";
import type { IngestPayload } from "@hanoman/shared";
import { effectiveInt } from "../config";

const MSG_CAP = 2_000, STACK_CAP = 16_000;
const EVENTS_PER_GROUP = () => effectiveInt("HANOMAN_ERROR_EVENTS_PER_GROUP") ?? 50;
const RETENTION_DAYS = () => effectiveInt("HANOMAN_ERROR_RETENTION_DAYS") ?? 30;
const RATE_PER_MIN = () => effectiveInt("HANOMAN_INGEST_RATE_PER_MIN") ?? 120;

// token-bucket in-memory per project (single-process; patuh "tanpa queue")
const buckets = new Map<string, { tokens: number; ts: number }>();
export function rateLimitOk(projectId: string, now = Date.now()): boolean {
  const cap = RATE_PER_MIN();
  const refillPerMs = cap / 60_000;
  const b = buckets.get(projectId) ?? { tokens: cap, ts: now };
  b.tokens = Math.min(cap, b.tokens + (now - b.ts) * refillPerMs);
  b.ts = now;
  if (b.tokens < 1) { buckets.set(projectId, b); return false; }
  b.tokens -= 1; buckets.set(projectId, b); return true;
}
export function __resetBuckets(): void { buckets.clear(); } // test-only

export async function ingestError(
  projectId: string, projectName: string, payload: IngestPayload,
): Promise<{ groupId: string; new: boolean }> {
  const type = payload.type.slice(0, 500);
  const message = payload.message.slice(0, MSG_CAP);
  const stack = payload.stack?.slice(0, STACK_CAP) ?? null;
  const environment = (payload.environment || "unknown").slice(0, 120);
  const fp = fingerprint(type, message, stack ?? undefined);

  const existing = await prisma.errorGroup.findUnique({
    where: { projectId_fingerprint: { projectId, fingerprint: fp } },
  });
  let groupId: string; let isNew = false;
  if (!existing) {
    const g = await prisma.errorGroup.create({
      data: { projectId, fingerprint: fp, type, message, sampleStack: stack, environment, count: 1 },
    }).catch(async (e) => {
      if ((e as { code?: string }).code === "P2002")   // balapan: dua ingest grup baru sama
        return prisma.errorGroup.findUnique({ where: { projectId_fingerprint: { projectId, fingerprint: fp } } });
      throw e;
    });
    groupId = g!.id; isNew = g!.count === 1 && g!.createdAt.getTime() === g!.lastSeenAt.getTime();
    if (isNew && environment === "production")
      await recordNewErrorGroup(groupId, projectId, projectName, type, message);
  } else {
    await prisma.errorGroup.update({
      where: { id: existing.id },
      data: { count: { increment: 1 }, lastSeenAt: new Date(), environment, updatedAt: new Date() },
    });
    groupId = existing.id;
  }
  await prisma.errorEvent.create({
    data: { groupId, projectId, type, message, stack, environment,
      release: payload.release ?? null, context: (payload.context ?? null) as object | null },
  });
  await pruneGroup(groupId);
  return { groupId, new: isNew };
}

// retensi opportunistic: sisakan cap terakhir + buang lebih tua dari retensi. Tanpa scheduler baru.
async function pruneGroup(groupId: string): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS() * 86_400_000);
  await prisma.errorEvent.deleteMany({ where: { groupId, receivedAt: { lt: cutoff } } });
  const keep = await prisma.errorEvent.findMany({
    where: { groupId }, orderBy: { receivedAt: "desc" }, take: EVENTS_PER_GROUP(), select: { id: true },
  });
  if (keep.length === EVENTS_PER_GROUP())
    await prisma.errorEvent.deleteMany({ where: { groupId, id: { notIn: keep.map((k) => k.id) } } });
}
```

- [x] **Step 4: `recordNewErrorGroup`** di `notifications.ts` (dedup `key`):

```ts
export async function recordNewErrorGroup(
  groupId: string, projectId: string, projectName: string, type: string, message: string,
): Promise<void> {
  const short = message.length > 80 ? message.slice(0, 77) + "…" : message;
  const title = `Error baru di "${projectName}": ${type}: ${short}`;
  await prisma.notification.create({
    data: { type: "error", key: `error:${groupId}`, projectId, title },
  }).catch(() => { /* P2002: sudah ada untuk grup ini */ });
}
```

- [x] **Step 5: Run service test → pass.**

- [x] **Step 6: Route `ingest.ts`** (CORS + DSN auth + validasi + rate-limit + caps + panggil service). Error generik (tak bocorkan project):

```ts
import type { FastifyInstance } from "fastify";
import { zIngestPayload } from "@hanoman/shared";
import { prisma } from "../db";
import { verifyKey } from "../services/ingest-key";
import { ingestError, rateLimitOk } from "../services/error-ingest";

const BODY_CAP = 64_000;
function cors(reply: any) {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-methods", "POST,OPTIONS");
  reply.header("access-control-allow-headers", "content-type,x-hanoman-dsn");
}

export default async function (app: FastifyInstance) {
  app.options("/ingest/:slug", async (_req, reply) => { cors(reply); return reply.code(204).send(); });
  app.post("/ingest/:slug", async (req, reply) => {
    cors(reply);
    const { slug } = req.params as { slug: string };
    const key = (req.query as { key?: string }).key ?? (req.headers["x-hanoman-dsn"] as string | undefined) ?? "";
    const raw = JSON.stringify(req.body ?? {});
    if (raw.length > BODY_CAP) return reply.code(413).send({ error: "payload too large" });
    const project = await prisma.project.findUnique({ where: { id: slug } });
    // generik: project/DSN salah sama-sama 401 (jangan enumerasi project)
    if (!project || !verifyKey(key, project.ingestKeyHash)) return reply.code(401).send({ error: "unauthorized" });
    if (!rateLimitOk(project.id)) return reply.code(429).send({ error: "rate limited" });
    const parsed = zIngestPayload.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid payload" });
    const r = await ingestError(project.id, project.name, parsed.data);
    return reply.code(202).send({ ok: true, groupId: r.groupId, new: r.new });
  });
}
```

- [x] **Step 7: Wire `app.ts`** — import `ingest`, register di scope `/api`, dan bypass gate:

```ts
// di PUBLIC bypass block, setelah cek /api/sync:
        if (path.startsWith("/api/ingest")) return;   // SPEC-249 · ingest ber-DSN, otentikasi di route
// di registrasi route:
    await api.register(ingest);
```

- [x] **Step 8: Test route `ingest.test.ts`** (`requireAuth:true` untuk buktikan bypass): buat Project + set ingest key (via service); POST `?key=` valid → 202 `{ok,groupId,new}`; key salah → 401; tanpa key → 401; slug tak ada → 401 (generik); payload invalid → 400; OPTIONS → 204 + header CORS; body > cap → 413; rate-limit (turunkan `HANOMAN_INGEST_RATE_PER_MIN` via config) → 429.

- [x] **Step 9: Run all + curl real ingest.** Boot server; generate DSN (Task 2 curl); lalu:

```bash
KEY=<key dari POST ingest-key>
curl -sS -XPOST "localhost:8799/api/ingest/<slug>?key=$KEY" \
  -H 'content-type: application/json' \
  -d '{"type":"TypeError","message":"x is undefined","stack":"Error\n    at f (/a/b.js:1:1)","environment":"production"}' | jq
# → {ok:true, groupId:"...", new:true}. POST lagi identik → new:false.
curl -sS -XPOST "localhost:8799/api/ingest/<slug>?key=bad" -d '{}' -i | head -1  # 401
```

- [x] **Step 10: Commit** `git commit -m "feat(spec-249): public DSN-authed ingest endpoint + grouping + rate-limit + retention + new-group notification"`

---

### Task 5: Errors list & detail API

**Files:**
- Create: `server/src/routes/errors.ts` (list + detail; escalate/patch ditambah Task 6)
- Modify: `server/src/app.ts` (register `errors`), `src/api/client.ts`
- Test: `server/src/routes/errors.test.ts`

**Interfaces:**
- Consumes: models (Task 1), `paginate` (`server/src/services/paginate.ts`).
- Produces: `GET /api/errors` (paginated `ErrorGroupView[]`), `GET /api/errors/:id` (`ErrorGroupDetail`). Client: `listErrors`, `getError`.

- [x] **Step 1: Test** `errors.test.ts`: seed 2 project + beberapa grup/event; `GET /errors` → semua grup urut lastSeenAt desc; `?project=` → filter; `?environment=production` → filter; `?status=new`; `?q=` cocok type/message; paginasi `page/limit`; `GET /errors/:id` → detail + array events (≤ N terakhir, urut desc); `GET /errors/unknown` → 404.

- [x] **Step 2: Run → fail.**

- [x] **Step 3: Implement `errors.ts` (list + detail)**:

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { paginate } from "../services/paginate";

const groupView = (g: any) => ({
  id: g.id, projectId: g.projectId, type: g.type, message: g.message, environment: g.environment,
  status: g.status, count: g.count, firstSeenAt: g.firstSeenAt, lastSeenAt: g.lastSeenAt, specId: g.specId,
});
const eventView = (e: any) => ({
  id: e.id, type: e.type, message: e.message, stack: e.stack, environment: e.environment,
  release: e.release, receivedAt: e.receivedAt,
});

export default async function (app: FastifyInstance) {
  app.get("/errors", async (req) => {
    const { project, environment, status, q, page, limit } = req.query as Record<string, string | undefined>;
    const where: any = {};
    if (project) where.projectId = project;
    if (environment) where.environment = environment;
    if (status) where.status = status;
    let groups = await prisma.errorGroup.findMany({ where, orderBy: { lastSeenAt: "desc" } });
    if (q) {
      const n = q.toLowerCase();
      groups = groups.filter((g) => `${g.type} ${g.message}`.toLowerCase().includes(n));
    }
    return paginate(groups.map(groupView), page, limit);
  });

  app.get("/errors/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    const events = await prisma.errorEvent.findMany({
      where: { groupId: id }, orderBy: { receivedAt: "desc" }, take: 50,
    });
    return { ...groupView(g), sampleStack: g.sampleStack, events: events.map(eventView) };
  });
}
```

- [x] **Step 4: Register + client.** `app.ts`: `await api.register(errors);`. `client.ts`:

```ts
listErrors: (params = {}) => j<Paginated<ErrorGroupView>>(paths.errors + qs(params)),
getError: (id: string) => j<ErrorGroupDetail>(paths.error(id)),
```

- [x] **Step 5: Run all + curl.** `GET /api/errors | jq`, `GET /api/errors/<id> | jq` (setelah ingest Task 4).

- [x] **Step 6: Commit** `git commit -m "feat(spec-249): errors list + detail API"`

---

### Task 6: Eskalasi grup → Spec

**Files:**
- Modify: `server/src/routes/errors.ts` (escalate + patch), `src/api/client.ts`
- Test: `server/src/routes/errors-escalate.test.ts`

**Interfaces:**
- Consumes: `nextSpecId` (`services/id.ts`), `resolveRepoDir` (`services/local-binding.ts`), `enqueueOutbox` (`services/outbox.ts`), models.
- Produces: `POST /api/errors/:id/escalate` → `{ spec, alreadyEscalated? }`; `PATCH /api/errors/:id` `{ status }`. Client: `escalateError`, `patchError`.

- [x] **Step 1: Test** `errors-escalate.test.ts`: buat project + grup (count 7, env production, message+stack); `POST /errors/:id/escalate` → 201 Spec (`source:"qa"`, title memuat type, payload `fromErrorGroup=<id>`, `actual` memuat message); grup jadi `status:"escalated"` + `specId=spec.id`; escalate kedua → `{ alreadyEscalated:true, spec:{ id: <same> } }` (tanpa buat Spec baru); `PATCH /errors/:id { status:"resolved" }` → grup resolved; grup tak ada → 404.

- [x] **Step 2: Run → fail.**

- [x] **Step 3: Implement escalate + patch di `errors.ts`**:

```ts
import { nextSpecId } from "../services/id";
import { resolveRepoDir } from "../services/local-binding";
import { enqueueOutbox } from "../services/outbox";
import { zErrorStatus } from "@hanoman/shared";

// dalam export default:
  app.post("/errors/:id/escalate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    if (g.specId) {
      const spec = await prisma.spec.findUnique({ where: { id: g.specId } });
      return reply.code(200).send({ alreadyEscalated: true, spec });
    }
    const short = g.message.length > 80 ? g.message.slice(0, 77) + "…" : g.message;
    const topStack = (g.sampleStack ?? "").split("\n").slice(0, 12).join("\n");
    const backlink = `Dari Error monitoring: grup ${g.id} (${g.count}×, ${g.environment}).`;
    const payload = {
      severity: "major" as const,
      steps: "Otomatis dari Error monitoring — reproduksi dari stack sampel.",
      expected: "Tidak ada error.",
      actual: `${g.type}: ${g.message}\n\n${topStack}\n\n${backlink}`,
      env: g.environment,
      fromErrorGroup: g.id,
    };
    const author = req.user?.email ?? "system";
    const repoDir = await resolveRepoDir(g.projectId);
    let spec: any = null;
    for (let attempt = 0; attempt < 3 && !spec; attempt++) {
      const sid = await nextSpecId(repoDir);
      try {
        spec = await prisma.spec.create({
          data: {
            id: sid, projectId: g.projectId, title: `${g.type}: ${short}`, source: "qa",
            stage: "brainstorming", priority: "tinggi", author: `QA · ${author}`,
            objective: `${g.type}: ${g.message}. ${backlink}`, payload,
          },
        });
      } catch (e) { if ((e as { code?: string }).code === "P2002" && attempt < 2) continue; throw e; }
    }
    await prisma.errorGroup.update({ where: { id }, data: { status: "escalated", specId: spec.id } });
    if (spec) await enqueueOutbox("spec", spec.id);
    return reply.code(201).send({ spec });
  });

  app.patch("/errors/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zErrorStatus.safeParse((req.body as { status?: string } | undefined)?.status);
    if (!parsed.success) return reply.code(400).send({ error: "status invalid" });
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.errorGroup.update({ where: { id }, data: { status: parsed.data } });
    return { id: updated.id, status: updated.status };
  });
```

- [x] **Step 4: Client** `client.ts`:

```ts
escalateError: (id: string) => j<{ spec: Spec; alreadyEscalated?: boolean }>(paths.errorEscalate(id), { method: "POST" }),
patchError: (id: string, status: string) => j<{ id: string; status: string }>(paths.error(id), { method: "PATCH", ...body({ status }) }),
```

- [x] **Step 5: Run all + curl.** `POST /api/errors/<id>/escalate | jq` → Spec; ulangi → `alreadyEscalated:true`; `PATCH /api/errors/<id>` `{"status":"resolved"}`.

- [x] **Step 6: Commit** `git commit -m "feat(spec-249): escalate error group → Spec (qa) + status patch"`

---

### Task 7: Frontend — area Errors (list + detail + escalate)

**Files:**
- Create: `src/screens/ErrorsScreen.tsx`
- Modify: `src/ds/shell.tsx` (HN_NAV), `src/App.tsx` (section branch + detail state)
- Test: `src/test/errors-screen.test.tsx`

**Interfaces:**
- Consumes: `api.listErrors`, `api.getError`, `api.escalateError` (Tasks 5-6).
- Produces: nav key `errors`; `ErrorsScreen` (self-fetch + silent poll pola `GitGraph`).

- [x] **Step 1: Nav** `src/ds/shell.tsx` `HN_NAV` — tambah `{ key: "errors", label: "Errors", icon: "triangle-alert" }` (mis. setelah backlog).

- [x] **Step 2: `ErrorsScreen.tsx`** — daftar grup (silent poll 5s, `!document.hidden`), filter environment + project, `Card`+`Badge`(count)+`StatusPill`(status)+relative last-seen; klik row → detail (state selection lokal): message, `sampleStack` (mono), env, first/last seen, count, tombol **"Eskalasi ke backlog"** (`api.escalateError` → callback `onEscalated(spec)`; jika `alreadyEscalated` tampil "→ SPEC-N"), tombol "Kembali". Pakai token DS (`--status-err`, `--bone-*`). StateBlock loading/error/empty.

- [x] **Step 3: Wire `App.tsx`** — `section === "errors"` branch render `<Shell active="errors" title="Errors" onNavigate={setSection}><ErrorsScreen projects={...} onEscalated={(spec)=>{ setSection("backlog"); ... }} /></Shell>` (pola VPS, tanpa `gate`).

- [x] **Step 4: Test `errors-screen.test.tsx`** (mock `api`): render daftar dari `listErrors` mock; klik row → detail (getError mock) tampil stack; klik "Eskalasi" → `escalateError` terpanggil + UI menandai escalated. Filter environment mengubah params `listErrors`.

- [x] **Step 5: Run** `env -u NODE_ENV -u DATABASE_URL pnpm -C src exec vitest run src/test/errors-screen.test.tsx` → PASS. Build front: `pnpm -C src build`.

- [x] **Step 6: Smoke UI** (opsional CDP / manual): boot dev, buka Errors, verifikasi daftar + detail + escalate. Minimal: `pnpm -C src build` hijau + test hijau.

- [x] **Step 7: Commit** `git commit -m "feat(spec-249): Errors area — group list, detail, escalate button"`

---

### Task 8: Frontend — DSN management di project detail

**Files:**
- Modify: `src/screens/ProjectDetailScreen.tsx`, `src/App.tsx` (handler rotate/revoke), `src/api/client.ts` (sudah ada dari Task 2)
- Test: `src/test/project-dsn.test.tsx`

**Interfaces:**
- Consumes: `api.getIngestKey`, `api.rotateIngestKey`, `api.revokeIngestKey`; `ProjectVM.monitoringEnabled`, `ProjectVM.ingestKeyPrefix`.
- Produces: kartu DSN di ProjectDetail.

- [x] **Step 1: Kartu DSN** di `ProjectDetailScreen.tsx`: bila `monitoringEnabled` tampil prefix (`hnm_ing_…` + mono) + tombol **Rotate** + **Revoke**; bila belum tampil tombol **Generate DSN**. On generate/rotate → panggil `api.rotateIngestKey(id)`, tampil `dsnUrl` **sekali** di kotak `--brass-100` + tombol **Salin** (pola `DeviceTokensPanel`), peringatan "hanya ditampilkan sekali". Revoke → konfirmasi → `api.revokeIngestKey`.

- [x] **Step 2: Test `project-dsn.test.tsx`** (mock api): project tanpa monitoring → tombol Generate; klik → `rotateIngestKey` + `dsnUrl` tampil sekali + copy; project dengan monitoring → prefix + Rotate/Revoke; Revoke → `revokeIngestKey` terpanggil.

- [x] **Step 3: Run** test → PASS; `pnpm -C src build` hijau.

- [x] **Step 4: Commit** `git commit -m "feat(spec-249): DSN management UI in project detail (generate/rotate/revoke, show-once)"`

---

### Task 9: Frontend — notifikasi error

**Files:**
- Modify: `src/notifications/NotificationsContext.tsx` (toastFor), `src/notifications/NotificationBell.tsx` (per-type branch), `src/notifications/target.ts` (route ke errors)
- Test: `src/test/notifications-error.test.tsx`

**Interfaces:**
- Consumes: `zNotification.type` `"error"` (Task 1).
- Produces: toast/bell/route untuk notif `error`.

- [x] **Step 1: `toastFor`** — case `type==="error"`: message dari `title`, tone `err` (→ `--status-err`), icon `triangle-alert`, sound (reuse `notifyDecisionSound`/setting error atau `notifyFail`). Enabled default true.

- [x] **Step 2: `NotificationBell`** — per-type branch untuk `error`: icon/label ("Error baru"). `target.ts` `notifTarget` — `type==="error"` → `{ section: "errors", projectFilter: n.projectId ?? undefined }`.

- [x] **Step 3: Test `notifications-error.test.tsx`** — notif `type:"error"` menghasilkan toast tone err + klik route ke `errors`.

- [x] **Step 4: Run** test → PASS; `pnpm -C src build` hijau.

- [x] **Step 5: Commit** `git commit -m "feat(spec-249): error notifications — toast, bell, click-through to Errors"`

---

### Task 10: SDK/snippet in-repo + docs SoT finalize

**Files:**
- Create: `sdk/node/hanoman-error.ts`, `sdk/browser/hanoman-error.js`, `sdk/README.md`
- Modify: `internal/docs/architecture/api-contract.md`, `internal/docs/security/security-standard.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/docs/README.md`

**Interfaces:**
- Produces: `initHanomanErrors({ dsn, environment?, release? })` + `captureError(err, ctx?)` (Node); snippet browser IIFE.

- [x] **Step 1: `sdk/node/hanoman-error.ts`**:

```ts
type InitOpts = { dsn: string; environment?: string; release?: string };
let cfg: InitOpts | null = null;

function post(body: unknown): void {
  if (!cfg) return;
  try {
    fetch(cfg.dsn, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .catch(() => {});   // hanoman down ≠ app crash
  } catch { /* swallow */ }
}

export function captureError(err: unknown, ctx?: Record<string, unknown>): void {
  const e = err as { name?: string; message?: string; stack?: string };
  post({
    type: e?.name || "Error", message: e?.message || String(err), stack: e?.stack,
    environment: cfg?.environment, release: cfg?.release, context: ctx,
  });
}

export function initHanomanErrors(opts: InitOpts): void {
  cfg = opts;
  process.on("uncaughtException", (e) => captureError(e));
  process.on("unhandledRejection", (e) => captureError(e));
}
```

- [x] **Step 2: `sdk/browser/hanoman-error.js`** (IIFE snippet):

```js
(function (dsn, opts) {
  opts = opts || {};
  function send(type, message, stack) {
    try {
      fetch(dsn, {
        method: "POST", keepalive: true, headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: type, message: message, stack: stack,
          environment: opts.environment, release: opts.release,
          context: { url: location.href } }),
      }).catch(function () {});
    } catch (e) { /* swallow */ }
  }
  window.addEventListener("error", function (e) {
    send((e.error && e.error.name) || "Error", e.message || String(e.error), e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason || {};
    send(r.name || "UnhandledRejection", r.message || String(r), r.stack);
  });
})(window.HANOMAN_DSN, window.HANOMAN_OPTS);
```

- [x] **Step 3: `sdk/README.md`** — cara pasang Node (`initHanomanErrors({ dsn: process.env.HANOMAN_DSN, environment: "production" })`) & browser (set `window.HANOMAN_DSN` + muat snippet), payload shape, catatan fire-and-forget + DSN dari hanoman project detail.

- [x] **Step 4: Update docs SoT** — `api-contract.md` (ingest + errors + ingest-key, tabel status), `security-standard.md` (pengecualian DSN gate + rate-limit + caps + isolasi antar-project), `frontend-implementation.md` (area Errors + DSN card + notif error), `README.md` index (pastikan ADR-0060 ter-link — sudah di Task 1; tambah link `sdk/README.md` bila kategori cocok, atau catat di api-contract).

- [x] **Step 5: Verifikasi coverage docs** `pnpm -C shared exec tsc --noEmit && node -e "require('child_process')"` — jalankan `hanoman docs scan` bila tersedia; minimal pastikan tak ada doc yatim yang baru.

- [x] **Step 6: Full suite hijau** `env -u NODE_ENV -u DATABASE_URL pnpm test` (atau per-workspace) → PASS. `pnpm -C src build` hijau.

- [x] **Step 7: Commit** `git commit -m "feat(spec-249): in-repo SDK (node+browser) + docs SoT (api-contract, security, frontend)"`

---

## Self-Review (diisi penulis plan)

- **Spec coverage:** Ingest+DSN → T1,T2,T4; grouping → T3,T4; area/filter/detail → T5,T7; notifikasi grup baru → T4,T9; eskalasi → T6,T7; keamanan/isolasi/retensi/rate-limit → T4,T10; SDK → T10; docs+ADR → T1,T10. Semua AC PRD terpetakan.
- **Placeholder scan:** kode konkret di tiap step; tak ada TODO/TBD.
- **Type consistency:** `ErrorGroupView`/`ErrorEventView`/`ErrorGroupDetail`/`IngestKeyView`/`IngestPayload` konsisten shared↔server↔client; `fingerprint`/`verifyKey`/`ingestError`/`recordNewErrorGroup` dipakai sesuai signature.
- **Angka tunable (Open questions PRD):** retensi 30 hari, cap 50 event/grup, rate 120/min — via `effectiveInt` (config), default aman.
