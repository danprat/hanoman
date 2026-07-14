# Server & Client Side — Hub Data + Instance Lokal Sinkron (SPEC-213) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) atau superpowers:subagent-driven-development untuk mengeksekusi task-demi-task. Step pakai checkbox (`- [ ]`).

**Goal:** Menjadikan satu instance hanoman sebagai hub data agregat (server) yang bisa disinkronkan dua-arah dengan instance lokal penuh (client) di tiap device, tanpa mengurangi satu fitur pun.

**Architecture:** Satu codebase, dua peran ditentukan konfigurasi. Sync = **server-to-server** (proses Node instance lokal ↔ hub) via `Authorization: Bearer <device-token>`; browser tetap same-origin ke instance lokalnya. Isi file dokumen mengalir lewat git remote (3-way merge); sync API hanya untuk record. Change-feed `SyncLog` (append-only, `seq` autoincrement) jadi kursor global yang menyatukan pull + realtime WS. Server-authoritative + optimistic concurrency (`version`/`baseVersion`).

**Tech Stack:** Fastify 4, Prisma 5 (Postgres), @fastify/websocket, vitest (`app.inject`), React+TS (Vite) frontend, `@hanoman/shared` (zod + tipe).

## Global Constraints

- TypeScript strict; test untuk tiap logika orchestrasi.
- Perubahan skema WAJIB: tulis `migration.sql` tangan + `prisma migrate deploy` ke DB `hanoman` DAN `hanoman_test` (worktree drift — `migrate dev` bisa reset). Setiap perubahan skema butuh ADR.
- Additive murni: kolom baru `NOT NULL` harus punya `DEFAULT`; tak boleh menghapus endpoint/fitur (AC-23..25).
- Jalankan test: dari root `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test <file>` (shell sesi menunjuk prod — memori). Typecheck: `pnpm -r typecheck`.
- Setelah tiap task: centang `- [x]`, boot server lokal + curl endpoint tersentuh (jangan hanya unit test), fixing sampai hijau sebelum lanjut.
- Entitas TAK disync: `Setting`, `Notification`, `User`, `Session`, `DeviceToken`, `LocalBinding`, `SyncOutbox`, `SyncState`, `SyncLog` (log itu sendiri feed, bukan entitas sync). Entitas tersync: `Project` (metadata), `Spec`, `Vps`, `SessionResult`.
- Never-sync fields: `Project.repoDir`, `Vps.keyPath`, `Vps.key*` (AC-7, AC-29).

---

## Fase 0 — Skema, migrasi, ADR fondasi

### Task 0.1: ADR fondasi (5 ADR)

**Files:**
- Create: `internal/docs/adr/0043-sync-arsitektur-hub-client-server-to-server.md`
- Create: `internal/docs/adr/0044-device-token-machine-identity.md`
- Create: `internal/docs/adr/0045-skema-sync-synclog-version-stamp.md`
- Create: `internal/docs/adr/0046-kanal-ws-sync-terpisah.md`
- Create: `internal/docs/adr/0047-activity-log-session-result.md`
- Modify: `internal/docs/adr/README.md` (index) — tambah 5 baris.

- [x] **Step 1:** Tulis tiap ADR (Konteks/Keputusan/Konsekuensi ≤ 25 baris) memuat keputusan dari design doc `docs/superpowers/specs/2026-07-14-server-client-sync-spec-213-design.md` (OQ-1..OQ-8). 0043: peran hub/local via `SYNC_SERVER_URL`, sync server-to-server, base URL sisi-server, konten file lewat git. 0044: DeviceToken hash-at-rest, Bearer, revocable, semua user boleh terbitkan. 0045: SyncLog change-feed + `version`/`baseVersion` + client-generated id + upsert dedup. 0046: kanal `/api/sync/ws` terpisah, token-authed pada upgrade. 0047: SessionResult append-only + whitelist + purge manual.
- [x] **Step 2:** Tambah 5 baris index ke `internal/docs/README.md` (index SoT sebenarnya) mengikuti format baris existing.
- [x] **Step 3:** (dilewati — index link cukup; coverage check dep-free opsional).
- [x] **Step 4: Commit** `git add internal/docs && git commit -m "docs(adr): 0043-0047 fondasi sync server-client (SPEC-213)"`

### Task 0.2: Skema Prisma — model & kolom baru

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260714100000_spec213_sync/migration.sql`

**Interfaces (Produces):** model `DeviceToken`, `SessionResult`, `SyncLog`, `LocalBinding`, `SyncOutbox`, `SyncState`; kolom `Project.gitRemote?`, `version`/`updatedAt` di `Project`/`Spec`/`Vps`/`SessionResult`.

- [x] **Step 1:** Tambahkan ke `schema.prisma`:

```prisma
model DeviceToken {
  id         String    @id @default(cuid())
  userId     String
  name       String
  tokenHash  String    @unique
  createdAt  DateTime  @default(now())
  lastSeenAt DateTime?
  revokedAt  DateTime?
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// SPEC-213 · ringkasan hasil sesi (activity log). Append-only; whitelist field (AC-20/21).
model SessionResult {
  id        String   @id
  projectId String
  specId    String?
  oldStage  String?
  newStage  String?
  commitSha String?
  branch    String?
  prUrl     String?
  status    String
  deviceId  String?
  author    String?
  version   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now())
}

// SPEC-213 · change-feed server-authoritative. seq = kursor global (AC-15/16).
model SyncLog {
  seq       BigInt   @id @default(autoincrement())
  entity    String
  recordId  String
  version   Int
  data      Json
  deviceId  String?
  createdAt DateTime @default(now())
  @@index([entity, recordId])
}

// SPEC-213 · LOCAL-ONLY (tak pernah disync): map projectId → repoDir per-device (AC-6/7).
model LocalBinding {
  projectId String   @id
  repoDir   String
  createdAt DateTime @default(now())
}

// SPEC-213 · LOCAL-ONLY: antre write lokal untuk push saat online (AC-17/18).
model SyncOutbox {
  id        String   @id @default(cuid())
  entity    String
  recordId  String
  createdAt DateTime @default(now())
  @@unique([entity, recordId])
}

// SPEC-213 · LOCAL-ONLY: kursor pull terakhir (singleton).
model SyncState {
  id     Int    @id @default(1)
  cursor String @default("0")
}
```

  Lalu tambah ke `model User`: `deviceTokens DeviceToken[]`. Tambah ke `Project`: `gitRemote String?`, `version Int @default(0)`, `updatedAt DateTime @default(now())`. Tambah ke `Spec`: `version Int @default(0)`, `updatedAt DateTime @default(now())`. Tambah ke `Vps`: `version Int @default(0)`, `updatedAt DateTime @default(now())`.

- [x] **Step 2:** Tulis `migration.sql` tangan (jangan `migrate dev` — reset risk):

```sql
-- SPEC-213 · sync server-client
ALTER TABLE "Project" ADD COLUMN "gitRemote" TEXT;
ALTER TABLE "Project" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Spec" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Spec" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Vps" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Vps" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "DeviceToken" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SessionResult" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "specId" TEXT, "oldStage" TEXT,
  "newStage" TEXT, "commitSha" TEXT, "branch" TEXT, "prUrl" TEXT, "status" TEXT NOT NULL,
  "deviceId" TEXT, "author" TEXT, "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncLog" (
  "seq" BIGSERIAL NOT NULL, "entity" TEXT NOT NULL, "recordId" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "data" JSONB NOT NULL, "deviceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("seq")
);
CREATE INDEX "SyncLog_entity_recordId_idx" ON "SyncLog"("entity", "recordId");

CREATE TABLE "LocalBinding" (
  "projectId" TEXT NOT NULL, "repoDir" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocalBinding_pkey" PRIMARY KEY ("projectId")
);

CREATE TABLE "SyncOutbox" (
  "id" TEXT NOT NULL, "entity" TEXT NOT NULL, "recordId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncOutbox_entity_recordId_key" ON "SyncOutbox"("entity", "recordId");

CREATE TABLE "SyncState" ("id" INTEGER NOT NULL DEFAULT 1, "cursor" TEXT NOT NULL DEFAULT '0',
  CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id"));
```

- [x] **Step 3:** Apply ke kedua DB + generate client:
```bash
cd server
env DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman" npx prisma migrate deploy
env DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_test" npx prisma migrate deploy
npx prisma generate
```
Expected: "migration(s) applied" pada keduanya; generate sukses.
- [x] **Step 4:** `pnpm -r typecheck` → PASS (skema baru dikenali).
- [x] **Step 5: Commit** `git add server/prisma && git commit -m "feat(server): skema sync — DeviceToken/SessionResult/SyncLog + version stamps (SPEC-213)"`

---

## Fase 1 — Identitas mesin (device token) · AC-1..AC-4

### Task 1.1: Service device-token (hash/issue/verify/revoke)

**Files:**
- Create: `server/src/services/device-token.ts`
- Test: `server/test/device-token.service.test.ts`

**Interfaces (Produces):**
- `newDeviceToken(): string` (plaintext, base64url 32B)
- `tokenHash(token: string): string` (sha256 hex)
- `issueDeviceToken(userId: string, name: string): Promise<{ id: string; name: string; token: string }>`
- `verifyDeviceToken(token: string): Promise<{ id: string; userId: string } | null>` (null bila revoked/absent; update `lastSeenAt`)
- `revokeDeviceToken(id: string): Promise<boolean>`

- [x] **Step 1: Failing test** `server/test/device-token.service.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { issueDeviceToken, verifyDeviceToken, revokeDeviceToken, tokenHash } from "../src/services/device-token";

const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };
beforeEach(clean); afterAll(clean);

async function user() { return prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } }); }

describe("device-token service", () => {
  it("issue returns plaintext once; hash stored, not plaintext", async () => {
    const u = await user();
    const t = await issueDeviceToken(u.id, "laptop");
    expect(t.token).toBeTruthy();
    const row = await prisma.deviceToken.findUnique({ where: { id: t.id } });
    expect(row?.tokenHash).toBe(tokenHash(t.token));
    expect(row?.tokenHash).not.toBe(t.token);
  });
  it("verify resolves to userId; revoke makes it fail", async () => {
    const u = await user();
    const t = await issueDeviceToken(u.id, "laptop");
    expect(await verifyDeviceToken(t.token)).toMatchObject({ userId: u.id });
    expect(await revokeDeviceToken(t.id)).toBe(true);
    expect(await verifyDeviceToken(t.token)).toBeNull();
  });
  it("unknown token → null", async () => { expect(await verifyDeviceToken("nope")).toBeNull(); });
});
```
- [x] **Step 2:** Run → FAIL (module belum ada). `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test device-token.service`
- [x] **Step 3:** Implement `server/src/services/device-token.ts`:
```ts
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../db";

export const newDeviceToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function issueDeviceToken(userId: string, name: string) {
  const token = newDeviceToken();
  const row = await prisma.deviceToken.create({ data: { userId, name, tokenHash: tokenHash(token) } });
  return { id: row.id, name: row.name, token };
}
export async function verifyDeviceToken(token: string) {
  const row = await prisma.deviceToken.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!row || row.revokedAt) return null;
  await prisma.deviceToken.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { id: row.id, userId: row.userId };
}
export async function revokeDeviceToken(id: string) {
  const row = await prisma.deviceToken.findUnique({ where: { id } });
  if (!row) return false;
  await prisma.deviceToken.update({ where: { id }, data: { revokedAt: new Date() } });
  return true;
}
```
- [x] **Step 4:** Run → PASS.
- [x] **Step 5: Commit** `git add server/src/services/device-token.ts server/test/device-token.service.test.ts && git commit -m "feat(server): service device-token issue/verify/revoke (SPEC-213)"`

### Task 1.2: Middleware `requireDeviceToken` + shared DTO

**Files:**
- Create: `server/src/services/device-auth.ts`
- Modify: `shared/src/dto.ts` (zod), `shared/src/entities.ts` (DeviceTokenView)
- Test: `server/test/device-auth.test.ts`

**Interfaces (Produces):**
- `requireDeviceToken(req, reply): Promise<void>` preHandler — set `req.device = { id, userId }` atau 401.
- `declare module "fastify" { interface FastifyRequest { device?: { id: string; userId: string } } }`
- shared: `zIssueDeviceToken = z.object({ name: z.string().min(1) })`, tipe `DeviceTokenView = { id, name, createdAt, lastSeenAt, revokedAt }`.

- [x] **Step 1: Failing test** `server/test/device-auth.test.ts`: build app kecil dengan route ber-preHandler `requireDeviceToken` yang balikkan `req.device`; assert 401 tanpa header, 200 + userId dengan `Authorization: Bearer <token>`, 401 setelah revoke. (Pakai `issueDeviceToken` untuk seed.)
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement `server/src/services/device-auth.ts`:
```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyDeviceToken } from "./device-token";

declare module "fastify" { interface FastifyRequest { device?: { id: string; userId: string } } }

export async function requireDeviceToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const h = req.headers["authorization"];
  const token = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : undefined;
  const dev = token ? await verifyDeviceToken(token) : null;
  if (!dev) { reply.code(401).send({ error: "device token required" }); return; }
  req.device = dev;
}
```
  Tambah ke `shared/src/dto.ts`: `export const zIssueDeviceToken = z.object({ name: z.string().min(1) });`. Tambah ke `shared/src/entities.ts`: tipe `DeviceTokenView`.
- [x] **Step 4:** Run → PASS; `pnpm -r typecheck` PASS.
- [x] **Step 5: Commit** `git commit -am "feat(server): requireDeviceToken preHandler + shared DTO (SPEC-213)"`

### Task 1.3: Routes `/api/device-tokens` (cookie-authed) + register

**Files:**
- Create: `server/src/routes/device-tokens.ts`
- Modify: `server/src/app.ts` (register)
- Test: `server/test/device-tokens.route.test.ts`

**Interfaces (Produces):** `POST /api/device-tokens` → `{ id, name, token }` (201, token sekali); `GET /api/device-tokens` → `DeviceTokenView[]`; `DELETE /api/device-tokens/:id` → 204/404.

- [x] **Step 1: Failing test** (build `buildApp()` gated, login flow spt `auth-routes.test.ts`): setup user → cookie; POST issue → 201 punya `token`; GET list → 1 item TANPA `token`/`tokenHash`; DELETE → 204; GET list item `revokedAt` != null. Tanpa cookie → 401.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement route (cookie gate warisan scope `/api`; pakai `req.user`):
```ts
import type { FastifyInstance } from "fastify";
import { zIssueDeviceToken } from "@hanoman/shared";
import { prisma } from "../db";
import { issueDeviceToken, revokeDeviceToken } from "../services/device-token";

const view = (t: { id: string; name: string; createdAt: Date; lastSeenAt: Date | null; revokedAt: Date | null }) =>
  ({ id: t.id, name: t.name, createdAt: t.createdAt.toISOString(),
     lastSeenAt: t.lastSeenAt?.toISOString() ?? null, revokedAt: t.revokedAt?.toISOString() ?? null });

export default async function (app: FastifyInstance) {
  app.get("/device-tokens", async (req) =>
    (await prisma.deviceToken.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" } })).map(view));
  app.post("/device-tokens", async (req, reply) => {
    const p = zIssueDeviceToken.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    return reply.code(201).send(await issueDeviceToken(req.user!.id, p.data.name));
  });
  app.delete("/device-tokens/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return (await revokeDeviceToken(id)) ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
  });
}
```
  Register di `app.ts`: import + `await api.register(deviceTokens);`.
- [x] **Step 4:** Run → PASS.
- [x] **Step 5: Live curl** boot server (lihat "Live smoke" di bawah), setup user, `curl -X POST .../api/device-tokens -d '{"name":"laptop"}'` → dapat token; GET list tanpa token field.
- [x] **Step 6: Commit** `git commit -am "feat(server): routes /device-tokens issue/list/revoke (SPEC-213)"`

---

## Fase 2 — Project tanpa path + gitRemote + binding lokal · AC-5..AC-8

### Task 2.1: Project tanpa path + gitRemote (server)

**Files:**
- Modify: `shared/src/dto.ts` (`zCreateProject.gitRemote`), `shared/src/entities.ts` (`zProject.gitRemote`)
- Modify: `server/src/routes/projects.ts` (terima gitRemote; create tanpa repoDir tetap 201)
- Modify: `server/src/services/project-view.ts` (sertakan gitRemote di view)
- Test: `server/test/projects.route.test.ts` (tambah kasus)

- [x] **Step 1: Failing test:** POST `/api/projects` `{ name:"hub-only", kind:"app", gitRemote:"https://github.com/x/y.git" }` (tanpa repoDir) → 201, view punya `repoDir:null` & `gitRemote` terisi; GET list memuatnya tanpa error (AC-5).
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Tambah `gitRemote: z.string().optional()` ke `zCreateProject` & `zUpdateProject`; `gitRemote: z.string().nullable().optional()` ke `zProject`. Di `projects.ts` create: `gitRemote: b.gitRemote ?? null`. Di `project-view.ts` sertakan `gitRemote`.
- [x] **Step 4:** Run → PASS.
- [x] **Step 5: Commit** `git commit -am "feat: project tanpa path + gitRemote di server (SPEC-213 AC-5)"`

### Task 2.2: LocalBinding service + routes (bind/clone/list, LOCAL-only)

**Files:**
- Create: `server/src/services/local-binding.ts`
- Create: `server/src/routes/bindings.ts`
- Modify: `server/src/app.ts` (register)
- Test: `server/test/bindings.route.test.ts`

**Interfaces (Produces):**
- `getBinding(projectId): Promise<string | null>` (repoDir lokal atau null)
- `setBinding(projectId, repoDir): Promise<void>`
- `resolveRepoDir(projectId): Promise<string | null>` — **binding lokal menang**; fallback `Project.repoDir` (untuk hub yang punya checkout sendiri).
- Routes: `GET /api/projects/:id/binding` → `{ repoDir: string|null }`; `PUT /api/projects/:id/binding` body `{ repoDir }` → 200; `POST /api/projects/:id/clone` body `{ dir }` → clone `gitRemote` ke `dir`, set binding, 201/409.

- [x] **Step 1: Failing test:** buat project server tanpa repoDir; PUT binding `{repoDir:"/tmp/x"}` → GET binding `{repoDir:"/tmp/x"}`; `resolveRepoDir` balik `/tmp/x`. Clone: project dengan `gitRemote` = path repo lokal hasil `makeRepoWithBranches` → POST clone ke dir sementara → 201 + binding terisi + dir berisi `.git`.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement service (Prisma `localBinding`) + route; clone via `spawnSync("git",["clone",gitRemote,dir])`. `resolveRepoDir` = binding ?? project.repoDir.
- [x] **Step 4:** Run → PASS.
- [x] **Step 5: Commit** `git commit -am "feat(server): LocalBinding bind/clone lokal per-device (SPEC-213 AC-6/7)"`

### Task 2.3: Guard spawn pakai resolveRepoDir + prompt bind

**Files:**
- Modify: `server/src/routes/terminal.ts` (atau service spawn) — sumber repoDir = `resolveRepoDir(projectId)`; bila null → 409 `{ error: "belum di-bind ke checkout lokal", needsBind: true }`.
- Modify: `server/src/routes/ide.ts` — `repoDir` resolver pakai `resolveRepoDir` (binding menang).
- Test: `server/test/spawn-guard.test.ts`

- [x] **Step 1: Failing test:** project tanpa repoDir & tanpa binding → POST spawn/terminal → 409 `needsBind:true` (AC-8); setelah PUT binding → tak lagi 409 karena repoDir.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Ganti sumber repoDir di jalur spawn/ide ke `resolveRepoDir`. Pertahankan pesan lama untuk kompat.
- [x] **Step 4:** Run → PASS; jalankan `terminal.route.test.ts`/`ide.route.test.ts` lama → tetap hijau (parity).
- [x] **Step 5: Commit** `git commit -am "feat(server): spawn guard pakai binding lokal, prompt bind (SPEC-213 AC-8)"`

---

## Fase 3 — Sync engine core (version-stamp + pull/push) · AC-9..AC-15

### Task 3.1: Service sync — apply/version/changefeed

**Files:**
- Create: `server/src/services/sync.ts`
- Test: `server/test/sync.service.test.ts`

**Interfaces (Produces):**
- `SYNCED = ["project","spec","vps","sessionResult"] as const`; `type Entity = ...`
- `snapshot(entity, id): Promise<{ version:number; data:Record<string,unknown> } | null>` — baca record + version, buang never-sync fields (repoDir/keyPath).
- `applyPush(entity, id, baseVersion, data, deviceId?): Promise<{ ok:true; version:number } | { ok:false; conflict:true; server: {version,data}|null }>` — insert bila absen; update bila `baseVersion===current`; else conflict. Setiap accept: `version = base+1`, tulis row `SyncLog`.
- `pull(sinceCursor: string, limit=500): Promise<{ cursor:string; records: {entity,recordId,version,data}[] }>` — SyncLog `seq > since`.

- [x] **Step 1: Failing test** (single test DB; entity `spec` di project seed):
  - insert (baseVersion 0, id baru) → `{ok:true,version:1}`; snapshot balik version 1.
  - push stale (baseVersion 0 lagi) → `{ok:false, conflict:true, server:{version:1}}` (AC-12) dan DB tak berubah.
  - push fresh (baseVersion 1) → `{ok:true,version:2}`.
  - `pull("0")` → memuat record terakhir dengan cursor = seq; `pull(cursor)` → kosong (idempoten, AC-15).
  - snapshot spec TIDAK memuat field never-sync; snapshot vps TIDAK memuat `keyPath`.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement `sync.ts`. Peta entity→Prisma delegate + whitelist kolom per entity (spec: id,projectId,title,source,stage,priority,author,objective,payload,branchFrom,baseSha,headSha,version; project: id,name,desc,kind,stack,gitRemote,version — TANPA repoDir; vps: id,name,host,port,user,health,audit,hardened,lastSeenAt,lastAuditAt,version — TANPA keyPath; sessionResult: semua whitelist). `applyPush` transaksi: baca current version → cek → upsert data + `version` → `syncLog.create`. `pull` baca SyncLog `where seq > BigInt(since) orderBy seq asc take limit`, cursor = `String(last.seq)`.
- [x] **Step 4:** Run → PASS.
- [x] **Step 5: Commit** `git commit -am "feat(server): sync service apply/pull/version + changefeed (SPEC-213 AC-9..15)"`

### Task 3.2: Routes `/api/sync/pull` + `/api/sync/push` (device-token) + author attribution

**Files:**
- Create: `server/src/routes/sync.ts`
- Modify: `server/src/app.ts` (register + tandai path sync sebagai bypass cookie-gate, enforce device token)
- Test: `server/test/sync.route.test.ts`

**Interfaces (Produces):** `GET /api/sync/pull?since=` (Bearer) → `{cursor,records}`; `POST /api/sync/push` (Bearer) body `{ records:[{entity,id,baseVersion,data}] }` → `{ results:[{id, ok, version?, conflict?, server?}] }`. Author record di-set dari `deviceToken.userId` bila kosong (AC-4).

- [x] **Step 1:** Di `app.ts` PUBLIC-bypass cookie gate untuk prefix `/api/sync` (ubah gate: `if (path.startsWith("/api/sync")) return;`), lalu route pakai preHandler `requireDeviceToken`.
- [x] **Step 2: Failing test:** tanpa Bearer → 401; dengan Bearer: push insert → `ok`, pull memuatnya; push stale → `conflict:true, server` (AC-13 diff = server data). Author kosong terisi user token.
- [x] **Step 3:** Run → FAIL.
- [x] **Step 4:** Implement route (loop records → `applyPush`), preHandler device token; set `author` dari lookup user email bila entity punya `author` & kosong.
- [x] **Step 5:** Run → PASS; live curl push+pull dengan token.
- [x] **Step 6: Commit** `git commit -am "feat(server): routes /sync/pull|push device-token + author attrib (SPEC-213)"`

---

## Fase 4 — Realtime + offline · AC-16..AC-19

### Task 4.1: Broadcast SyncLog ke WS `/api/sync/ws` (hub)

**Files:**
- Create: `server/src/services/sync-hub.ts` (Set klien + `broadcastSyncLog(row)`)
- Modify: `server/src/services/sync.ts` (panggil `broadcastSyncLog` sesudah `syncLog.create`)
- Create/Modify: `server/src/routes/sync.ts` (tambah `GET /sync/ws`, device-token pada upgrade)
- Test: `server/test/sync-ws.test.ts`

**Interfaces (Produces):** `attachSync(client)`, `detachSync(client)`, `broadcastSyncLog({entity,recordId,version,data})`.

- [x] **Step 1: Failing test:** buka WS `/api/sync/ws?token=<deviceToken>` (auth via query pada upgrade — cookie tak ada di server-to-server), lakukan `applyPush` → klien WS terima frame `{t:"sync",entity,recordId,version,data}` < 1 dtk. Tanpa token → upgrade ditolak (close/401).
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement `sync-hub.ts` (pola `events.ts`: Set klien, broadcast JSON). Di route WS handler, verifikasi `req.query.token` via `verifyDeviceToken`; gagal → `socket.close()`. `applyPush` memanggil `broadcastSyncLog`.
- [x] **Step 4:** Run → PASS.
- [x] **Step 5: Commit** `git commit -am "feat(server): WS /sync/ws siar changefeed token-authed (SPEC-213 AC-16)"`

### Task 4.2: Outbox lokal — enqueue di mutation sites

**Files:**
- Create: `server/src/services/outbox.ts` (`enqueueOutbox(entity, recordId)`, `listOutbox()`, `clearOutbox(entity, recordId)`)
- Modify: `server/src/routes/projects.ts`, `server/src/routes/specs.ts` (create/patch/stage), `server/src/services/vps-*` (update), `SessionResult` create — panggil `enqueueOutbox` sesudah write lokal.
- Test: `server/test/outbox.test.ts`

- [x] **Step 1: Failing test:** create project → `listOutbox()` memuat `{entity:"project",recordId:id}`; patch spec → outbox memuat spec; `clearOutbox` menghapus; unique (entity,recordId) tak duplikat.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement `outbox.ts` (upsert unique). Sisipkan `enqueueOutbox` di mutation sites (bungkus agar tak melempar bila tabel absen — best-effort).
- [x] **Step 4:** Run → PASS; test lama projects/specs tetap hijau.
- [x] **Step 5: Commit** `git commit -am "feat(server): outbox lokal enqueue di mutation sites (SPEC-213 AC-17)"`

### Task 4.3: Sync-client — pull-before-push drain + WS + reconnect

**Files:**
- Create: `server/src/services/sync-client.ts`
- Modify: `server/src/server.ts` (start `sync-client` bila `SYNC_SERVER_URL` set)
- Modify: `server/src/env.ts` (baca `SYNC_SERVER_URL`, `SYNC_DEVICE_TOKEN`)
- Test: `server/test/sync-client.test.ts`

**Interfaces (Produces):**
- `syncOnce(base:string, token:string): Promise<{ pulled:number; pushed:number; conflicts:number }>` — pull (apply ke DB lokal via `applyRemote`, majukan `SyncState.cursor`) LALU push tiap outbox (dgn baseVersion current) → sukses `clearOutbox`, konflik biarkan (AC-18).
- `applyRemote(entity, recordId, version, data)` — upsert record lokal ke `version`/data server (server-authoritative), TANPA menulis SyncLog/outbox.
- `startSyncClient()` — jadwalkan `syncOnce` + WS listener + reconnect backoff.

- [ ] **Step 1: Failing test** (satu proses, hub = `buildApp` inject; "client" = fungsi yang panggil hub lewat `app.inject` sebagai transport — suntik transport agar tak perlu socket nyata):
  - Seed outbox lokal 1 spec (belum di hub). `syncOnce` → pushed=1; hub `pull` memuat spec itu.
  - Simulasi record baru di hub → `syncOnce` → pulled≥1; record ada di DB lokal via `applyRemote`; cursor maju; run kedua pulled=0 (idempoten, AC-18/15).
  - Konflik: outbox record baseVersion basi → conflicts=1, outbox TETAP ada (tak hilang), DB lokal tak korup (AC-19).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `sync-client.ts` dengan transport injectable `(method,path,body,token)=>Promise<res>` (default `fetch(base+path)`, test pakai `app.inject`). `applyRemote` reuse peta entity `sync.ts` (ekspor helper `upsertLocal`). `startSyncClient` pakai WS `ws://`/`wss://` + backoff; on message → `applyRemote` + cursor; on reconnect → `syncOnce`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `server.ts`: `if (env.SYNC_SERVER_URL && env.SYNC_DEVICE_TOKEN) startSyncClient();`
- [ ] **Step 6: Commit** `git commit -am "feat(server): sync-client pull-before-push drain + WS reconnect (SPEC-213 AC-18/19)"`

---

## Fase 5 — Activity log (ringkasan hasil) · AC-20..AC-22

### Task 5.1: SessionResult — create (whitelist) + push via sync

**Files:**
- Create: `server/src/services/session-result.ts` (`recordSessionResult(input)` — whitelist, create lokal + enqueueOutbox)
- Modify: sesi/stage-transition site (mis. `server/src/services/live-specs.ts` atau tempat stage berpindah / commit) — panggil `recordSessionResult`.
- Modify: `shared/src/dto.ts` (`zSessionResult` whitelist)
- Test: `server/test/session-result.test.ts`

- [ ] **Step 1: Failing test:** `recordSessionResult({projectId,specId,oldStage,newStage,commitSha,branch,prUrl,status,deviceId,author})` → row tersimpan hanya field whitelist; input berisi field liar (`transcript`,`token`) → TIDAK tersimpan (AC-21). Outbox memuat sessionResult.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement service: pilih hanya field whitelist eksplisit; id = cuid; create; `enqueueOutbox("sessionResult", id)`. `zSessionResult` di shared.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(server): SessionResult whitelist + push via outbox (SPEC-213 AC-20/21)"`

### Task 5.2: Routes read + purge activity log + register

**Files:**
- Create: `server/src/routes/session-results.ts`
- Modify: `server/src/app.ts` (register, cookie-authed)
- Test: `server/test/session-results.route.test.ts`

**Interfaces (Produces):** `GET /api/session-results?projectId=&limit=` → `SessionResult[]` (desc createdAt); `DELETE /api/session-results?projectId=&before=<ISO>` → `{ purged:n }` (append-only kecuali purge manual, AC-22).

- [ ] **Step 1: Failing test:** seed 3 result (2 lama, 1 baru) → GET filter projectId; DELETE `before` menghapus yang lama saja, balik `{purged:2}`; tanpa cookie → 401.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement route + register.
- [ ] **Step 4:** Run → PASS; live curl.
- [ ] **Step 5: Commit** `git commit -am "feat(server): routes session-results read + purge (SPEC-213 AC-22)"`

---

## Fase 6 — VPS sync + gating key · AC-26..AC-29

### Task 6.1: Vps tersinkron (config/audit/health) — sudah lewat sync service; test + enqueue

**Files:**
- Modify: `server/src/services/vps-monitor.ts` / vps update sites — `enqueueOutbox("vps", id)` sesudah update health/audit.
- Test: `server/test/vps-sync.test.ts`

- [ ] **Step 1: Failing test:** update vps health → outbox memuat vps; `snapshot("vps",id)` TIDAK memuat `keyPath` (AC-29); `applyPush` vps update version.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Sisipkan enqueue di vps update sites; pastikan whitelist vps di `sync.ts` sudah exclude keyPath (Task 3.1).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(server): Vps ikut sync tanpa keyPath (SPEC-213 AC-26/29)"`

### Task 6.2: Gating aksi SSH pada key lokal

**Files:**
- Modify: `server/src/routes/vps.ts` — sebelum aksi SSH (test/audit/harden/console) cek `keyPath` ada di mesin ini (`fs.existsSync`); absen → 409 `{ error:"key VPS tidak ada di mesin ini", keyMissing:true }` (AC-28).
- Test: `server/test/vps-key-gate.test.ts`

- [ ] **Step 1: Failing test:** vps dengan `keyPath` menunjuk file tak-ada → POST audit → 409 `keyMissing:true`; keyPath ada (file temp) → tak 409 karena gate ini.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Tambah cek `existsSync(keyPath)` di jalur aksi SSH.
- [ ] **Step 4:** Run → PASS; test vps lama tetap hijau.
- [ ] **Step 5: Commit** `git commit -am "feat(server): gate aksi SSH VPS pada key lokal (SPEC-213 AC-27/28)"`

---

## Fase 7 — Preferensi lokal & parity · AC-23..AC-25, AC-30

### Task 7.1: Pastikan Setting/Notification tak tersync (test negatif)

**Files:**
- Test: `server/test/sync-exclusions.test.ts`

- [ ] **Step 1: Failing/verifikasi test:** `SYNCED` tidak memuat `setting`/`notification`/`deviceToken`/`localBinding`; `snapshot("setting",..)` tak ada (entity tak dikenal → null/throw ditangani). Mutasi Setting TIDAK menulis outbox (AC-30).
- [ ] **Step 2:** Run → PASS (bila sudah benar) atau perbaiki bila enqueue bocor.
- [ ] **Step 3: Commit** `git commit -am "test: preferensi lokal tak tersync (SPEC-213 AC-30)"`

### Task 7.2: Parity — snapshot endpoint & suite penuh hijau

**Files:**
- Create: `server/test/parity-endpoints.test.ts` (daftar route baseline ⊆ route sekarang)
- Docs: `internal/docs/operations/production.md` (bagian rollout hub/client — OQ-1)

- [ ] **Step 1:** Test parity: kumpulkan `app.printRoutes()`/route list; assert semua path baseline (health, auth, projects, specs, notifications, settings, docs, ide, fs, terminal, vps, limits, events) MASIH ada (AC-23; 0 hilang).
- [ ] **Step 2:** Run → PASS.
- [ ] **Step 3:** Tulis bagian rollout di `production.md`: prod sekarang = hub tanpa client; client opt-in set `SYNC_SERVER_URL`+`SYNC_DEVICE_TOKEN`; additive, backward-compatible (OQ-1).
- [ ] **Step 4:** Jalankan SELURUH suite server: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test` → semua hijau (metrik parity 100%).
- [ ] **Step 5: Commit** `git commit -am "test+docs: parity endpoint & rollout hub/client (SPEC-213 AC-23..25, OQ-1)"`

### Task 7.3: UI — kelola device token + lihat activity log

**Files:**
- Create/Modify: komponen React di `src/` (halaman Settings → "Device tokens"; panel "Activity" baca `/api/session-results`).
- Modify: `src/` api client bila perlu.
- Test: (opsional) komponen; minimal typecheck + smoke.

- [ ] **Step 1:** Tambah UI kelola device token (list + create menampilkan token sekali + revoke) dan panel activity log (baca session-results, filter project, tombol purge).
- [ ] **Step 2:** `pnpm --filter ./src build` → sukses; `pnpm -r typecheck` PASS.
- [ ] **Step 3:** Smoke browser via CDP (memori "browser-smoke-via-cdp") atau manual: token muncul sekali, list & revoke jalan.
- [ ] **Step 4: Commit** `git commit -am "feat(web): kelola device token + panel activity log (SPEC-213)"`

---

## Live smoke (dipakai tiap task backend)

Boot server ke DB throwaway migrated (memori "live-smoke-dedicated-db", jangan `hanoman_test`, jangan port 8787):
```bash
DB=hanoman_smoke213
docker compose exec -T db psql -U hanoman -d postgres -c "CREATE DATABASE $DB" 2>/dev/null || true
cd server && env DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/$DB" npx prisma migrate deploy
env -u NODE_ENV PORT=8813 DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/$DB" node dist/server.js &
# curl setup user → cookie → uji endpoint tersentuh; kill saat selesai.
```

## Self-Review (writing-plans)

- **Spec coverage:** AC-1..4 → Fase 1; AC-5..8 → Fase 2; AC-9..15 → Fase 3; AC-16..19 → Fase 4; AC-20..22 → Fase 5; AC-23..25 → Fase 7 (parity) + additive di semua; AC-26..29 → Fase 6; AC-30 → Fase 7. OQ-1 → 7.2 docs; OQ-2 → 1.3; OQ-3 → 4.1; OQ-4/7 → 1.2/3.2; OQ-5 → 5.1; OQ-6 → 3.1; OQ-8 → 0.2/5.x. Semua tercakup.
- **Placeholder scan:** kode konkret di tiap step backend; UI (7.3) ringkas by design (frontend same-origin, bukan inti PRD).
- **Type consistency:** `verifyDeviceToken→{id,userId}`, `requireDeviceToken` set `req.device`, `applyPush`/`pull`/`snapshot` signature konsisten Fase 3→4. `resolveRepoDir` dipakai Fase 2.3. `enqueueOutbox(entity,recordId)` konsisten Fase 4/5/6.
