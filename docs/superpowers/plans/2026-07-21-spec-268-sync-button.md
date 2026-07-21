# SPEC-268 — Tombol Sync (backlog/errors/triase) + errors & tickets masuk record-sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) atau superpowers:subagent-driven-development. Steps pakai checkbox (`- [ ]`) untuk tracking.

**Goal:** Tombol "Sync" di Backlog/Errors/Triase memicu sinkron client↔hub sekali klik, dan errors + tickets ikut tersync (bukan hanya backlog).

**Architecture:** Tambah `version` ke `ErrorGroup`+`Ticket`; masukkan keduanya ke mesin record-sync (`SYNCED`/`FIELDS`); tambah primitif `publishLocal` agar write **asal-hub** (ingest error, tiket Help) masuk change-feed `SyncLog` (bisa di-pull client); helper role-aware `notifySynced` menggantikan/menambah `enqueueOutbox` di situs write; endpoint `POST /api/sync/now` (cookie) + tombol UI yang muncul hanya di instance client.

**Tech Stack:** Node/Fastify + Prisma/Postgres (server) · React+TS/Vite (client) · Vitest.

## Global Constraints

- TypeScript strict; test tiap logika orchestrasi.
- Jangan ubah skema tanpa migration + ADR (ADR-0066 sudah ditulis).
- DB dev/test **terisolasi**: shell menunjuk PROD (`DATABASE_URL=…/hanoman_prod`, `NODE_ENV=production`) — JANGAN dipakai. Pakai DB khusus **`hanoman268`** (test derive `hanoman268_test`). Jalankan test: `env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec vitest run --no-file-parallelism <file>`.
- Postgres di Docker container `hanoman-db-1` (user/pass `hanoman`, port 5432).
- Sync entity baru = `"errorGroup"`, `"ticket"` (camelCase, cocok `prisma.errorGroup`/`prisma.ticket`).
- Toast tone valid: `ok|err|warn|info`. Icon sync: `"rotate-ccw"` (dikonfirmasi ada).
- Update SoT tersentuh + link index di commit yang sama (Task 6).

---

### Task 1: Worktree setup + migration (kolom `version`)

**Files:**
- Modify: `server/prisma/schema.prisma` (model `ErrorGroup` ~baris 229, `Ticket` ~baris 270)
- Create: `server/prisma/migrations/2026072101_spec268_errorgroup_ticket_version/migration.sql`

**Interfaces:**
- Produces: kolom `ErrorGroup.version` & `Ticket.version` (Int, default 0) di DB + Prisma client.

- [x] **Step 1: Install deps + generate client (worktree baru)**

Run:
```bash
pnpm install
pnpm -C server exec prisma generate
```
Expected: sukses (worktree tanpa node_modules butuh ini).

- [x] **Step 2: Buat DB terisolasi hanoman268 + hanoman268_test**

Run:
```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman268;' 2>&1 | tail -1
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman268_test;' 2>&1 | tail -1
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec prisma migrate deploy
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268_test' pnpm -C server exec prisma migrate deploy
```
Expected: kedua DB tercipta (atau "already exists" — abaikan) & seluruh migrasi ter-apply.

- [x] **Step 3: Tambah kolom `version` di schema.prisma**

Di model `ErrorGroup`, tepat setelah baris `updatedAt DateTime @default(now())`, tambah:
```prisma
  version     Int      @default(0) // SPEC-268 · version-stamp sync (ADR-0066)
```
Di model `Ticket`, tepat setelah baris `updatedAt DateTime @default(now())`, tambah:
```prisma
  version       Int      @default(0) // SPEC-268 · version-stamp sync (ADR-0066)
```
Juga hapus/perbarui komentar "server-local, tanpa version/sync" di kedua model jadi "sync agregat/metadata, ADR-0066".

- [x] **Step 4: Tulis migration.sql**

Create `server/prisma/migrations/2026072101_spec268_errorgroup_ticket_version/migration.sql`:
```sql
-- SPEC-268 · ADR-0066 · ErrorGroup & Ticket masuk record-sync (version-stamp, ADR-0045)
ALTER TABLE "ErrorGroup" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ticket" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
```

- [x] **Step 5: Apply migration ke kedua DB + generate**

Run:
```bash
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec prisma migrate deploy
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268_test' pnpm -C server exec prisma migrate deploy
DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec prisma generate
```
Expected: migrasi `2026072101_spec268_...` ter-apply di kedua DB.

- [x] **Step 6: Verifikasi kolom ada**

Run:
```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman268_test -c '\d "ErrorGroup"' | grep version
docker exec hanoman-db-1 psql -U hanoman -d hanoman268_test -c '\d "Ticket"' | grep version
```
Expected: dua baris `version | integer | not null | default 0`.

- [x] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/2026072101_spec268_errorgroup_ticket_version
git commit -m "feat(spec-268): kolom version ErrorGroup & Ticket (record-sync, ADR-0066)"
```

---

### Task 2: Sync service — errorGroup + ticket + `publishLocal`

**Files:**
- Modify: `server/src/services/sync.ts`
- Test: `server/test/sync.service.test.ts`

**Interfaces:**
- Consumes: `applyPush`, `snapshot`, `pull` (existing).
- Produces:
  - `SYNCED` kini memuat `"errorGroup"`, `"ticket"`.
  - `publishLocal(entity: Entity, id: string): Promise<void>` — append `SyncLog` (version+1) + siar.

- [x] **Step 1: Tulis test gagal (append di `sync.service.test.ts`)**

Tambah di dalam `describe(...)` (setelah test terakhir). Perluas `clean()` di atas file jadi ikut menghapus errorGroup/ticket:
```ts
// (perluas const clean di baris ~5)
//   await prisma.ticket.deleteMany(); await prisma.errorEvent.deleteMany(); await prisma.errorGroup.deleteMany();
// letakkan SEBELUM prisma.project.deleteMany()
```
Test baru:
```ts
import { publishLocal } from "../src/services/sync";

it("errorGroup: snapshot berisi field bisnis, applyPush insert→v1 (SPEC-268)", async () => {
  await project();
  const r = await applyPush("errorGroup", "eg1", 0, {
    projectId: "p1", fingerprint: "fp", type: "TypeError", message: "boom",
    environment: "production", status: "new", count: 3,
    firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), specId: null,
  });
  expect(r).toMatchObject({ ok: true, version: 1 });
  const snap = await snapshot("errorGroup", "eg1");
  expect(snap?.data).toMatchObject({ type: "TypeError", status: "new", count: 3, fingerprint: "fp" });
});

it("ticket: snapshot menyertakan accessKeyHash, TIDAK ada lampiran (SPEC-268)", async () => {
  await project();
  await applyPush("ticket", "tk1", 0, {
    projectId: "p1", number: 1, category: "bug", title: "judul", detail: "isi",
    reporterEmail: "r@x.co", status: "new", accessKeyHash: "hashval", specId: null,
    createdAt: new Date().toISOString(),
  });
  const snap = await snapshot("ticket", "tk1");
  expect(snap?.data).toMatchObject({ number: 1, title: "judul", accessKeyHash: "hashval" });
  expect(snap?.data).not.toHaveProperty("attachments");
});

it("publishLocal: append SyncLog + naikkan version + panggil hook (SPEC-268)", async () => {
  await project();
  await prisma.errorGroup.create({ data: { id: "eg2", projectId: "p1", fingerprint: "fp2", type: "E", message: "m", environment: "production", count: 1 } });
  await publishLocal("errorGroup", "eg2");
  const log = await prisma.syncLog.findFirst({ where: { entity: "errorGroup", recordId: "eg2" }, orderBy: { seq: "desc" } });
  expect(log?.version).toBe(1);
  expect((log?.data as Record<string, unknown>).type).toBe("E");
  expect((await prisma.errorGroup.findUnique({ where: { id: "eg2" } }))?.version).toBe(1);
});
```

- [x] **Step 2: Run test → verifikasi GAGAL**

Run:
```bash
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec vitest run --no-file-parallelism test/sync.service.test.ts
```
Expected: FAIL (`publishLocal` tak ada / entity errorGroup tak dikenal).

- [x] **Step 3: Implement di `sync.ts`**

`SYNCED`:
```ts
export const SYNCED = ["project", "spec", "vps", "sessionResult", "errorGroup", "ticket"] as const;
```
`Delegate` type — tambah `update`:
```ts
type Delegate = {
  findUnique: (args: { where: { id: string }; select?: Record<string, boolean> }) => Promise<Record<string, unknown> | null>;
  upsert: (args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};
```
`DELEGATE` — tambah dua baris:
```ts
  errorGroup: prisma.errorGroup as unknown as Delegate,
  ticket: prisma.ticket as unknown as Delegate,
```
`FIELDS` — tambah:
```ts
  errorGroup: ["projectId", "fingerprint", "type", "message", "sampleStack", "environment", "status", "count", "firstSeenAt", "lastSeenAt", "specId"],
  ticket: ["projectId", "number", "category", "title", "detail", "reporterEmail", "status", "accessKeyHash", "specId", "createdAt"],
```
`DATE_FIELDS` — tambah:
```ts
  errorGroup: ["firstSeenAt", "lastSeenAt"],
  ticket: ["createdAt"],
```
Tambah fungsi (setelah `pull`):
```ts
// SPEC-268 · ADR-0066 · publish write LOKAL-asal ke change-feed (SyncLog) + siar. Melengkapi
// applyPush (write asal client-push): membuat write asal-hub (ingest error, tiket Help) bisa
// di-pull client. Menaikkan version agar optimistic-concurrency tetap konsisten.
export async function publishLocal(entity: Entity, id: string): Promise<void> {
  const snap = await snapshot(entity, id);
  if (!snap) return;
  const newVersion = snap.version + 1;
  await DELEGATE[entity].update({ where: { id }, data: { version: newVersion } });
  const log = await prisma.syncLog.create({
    data: { entity, recordId: id, version: newVersion, data: (snap.data ?? {}) as object, deviceId: null },
  });
  onAccepted?.({ entity, recordId: id, version: newVersion, data: snap.data ?? {}, seq: String(log.seq) });
}
```

- [x] **Step 4: Run test → verifikasi LULUS**

Run:
```bash
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec vitest run --no-file-parallelism test/sync.service.test.ts
```
Expected: PASS semua.

- [x] **Step 5: Commit**

```bash
git add server/src/services/sync.ts server/test/sync.service.test.ts
git commit -m "feat(spec-268): errorGroup & ticket masuk SYNCED + publishLocal (ADR-0066)"
```

---

### Task 3: `notifySynced` role-aware + wiring situs write

**Files:**
- Create: `server/src/services/sync-notify.ts`
- Create: `server/test/sync-notify.test.ts`
- Modify: `server/src/services/error-ingest.ts`, `server/src/routes/errors.ts`, `server/src/routes/help.ts`, `server/src/routes/tickets.ts`, `server/src/services/live-specs.ts`

**Interfaces:**
- Consumes: `enqueueOutbox` (outbox.ts), `publishLocal`+`isEntity` (sync.ts), `effectiveStr` (config).
- Produces: `notifySynced(entity: string, id: string): Promise<void>` (best-effort).

- [x] **Step 1: Tulis test gagal `server/test/sync-notify.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { notifySynced } from "../src/services/sync-notify";
import { listOutbox } from "../src/services/outbox";
import { setConfig, clearConfig } from "../src/config";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.errorEvent.deleteMany(); await prisma.errorGroup.deleteMany();
  await prisma.project.deleteMany(); await prisma.runtimeConfig.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function group() {
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "", kind: "existing" } });
  await prisma.errorGroup.create({ data: { id: "eg1", projectId: "p1", fingerprint: "f", type: "E", message: "m", environment: "production", count: 1 } });
}

describe("notifySynced (SPEC-268 ADR-0066)", () => {
  it("client (SYNC_SERVER_URL ada) → enqueueOutbox", async () => {
    await group();
    await setConfig("SYNC_SERVER_URL", "http://hub.example");
    try {
      await notifySynced("errorGroup", "eg1");
      expect((await listOutbox()).map((o) => o.recordId)).toContain("eg1");
      expect(await prisma.syncLog.count()).toBe(0);
    } finally { await clearConfig("SYNC_SERVER_URL"); }
  });

  it("hub (SYNC_SERVER_URL kosong) → publishLocal (append SyncLog)", async () => {
    await group();
    await notifySynced("errorGroup", "eg1");
    expect(await prisma.syncLog.count()).toBe(1);
    expect(await prisma.syncOutbox.count()).toBe(0);
  });
});
```
> Cek signature `setConfig`/`clearConfig` di `server/src/config.ts` — bila beda, sesuaikan (mis. via `prisma.runtimeConfig.upsert`). `effectiveStr` membaca override DB → env → default.

- [x] **Step 2: Run → GAGAL**

Run:
```bash
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec vitest run --no-file-parallelism test/sync-notify.test.ts
```
Expected: FAIL (module belum ada).

- [x] **Step 3: Buat `server/src/services/sync-notify.ts`**

```ts
import { effectiveStr } from "../config";
import { enqueueOutbox } from "./outbox";
import { publishLocal, isEntity } from "./sync";

// SPEC-268 · ADR-0066 · sebarkan write LOKAL ke peer, sadar-peran:
//  - client (SYNC_SERVER_URL ada) → enqueueOutbox → syncOnce push ke hub (perilaku lama).
//  - hub (SYNC_SERVER_URL kosong) → publishLocal → masuk change-feed sendiri → client pull.
// Best-effort: kegagalan TIDAK menggagalkan write utama.
export async function notifySynced(entity: string, id: string): Promise<void> {
  try {
    if (!isEntity(entity)) return;
    if (effectiveStr("SYNC_SERVER_URL")) await enqueueOutbox(entity, id);
    else await publishLocal(entity, id);
  } catch { /* jangan blok write utama */ }
}
```

- [x] **Step 4: Wire `error-ingest.ts`**

Tambah import teratas: `import { notifySynced } from "./sync-notify";`
Di `ingestError`, ubah baris terakhir sebelum `return { groupId, new: isNew };`:
```ts
  await pruneGroup(groupId);
  if (isNew) await notifySynced("errorGroup", groupId); // SPEC-268 · grup baru → feed (bukan tiap count)
  return { groupId, new: isNew };
```

- [x] **Step 5: Wire `routes/errors.ts`**

Ganti import `enqueueOutbox`:
```ts
import { notifySynced } from "../services/sync-notify";
```
Di handler `escalate`, ganti dua baris terakhir sebelum `return`:
```ts
    await prisma.errorGroup.update({ where: { id }, data: { status: "escalated", specId: spec!.id } });
    await notifySynced("spec", spec!.id);       // SPEC-213/268 · spec ke feed
    await notifySynced("errorGroup", id);        // SPEC-268 · status grup ke feed
    return reply.code(201).send({ spec });
```
Di handler `patch` (resolve), setelah `const updated = ...`:
```ts
    const updated = await prisma.errorGroup.update({ where: { id }, data: { status: parsed.data } });
    await notifySynced("errorGroup", id); // SPEC-268
    return { id: updated.id, status: updated.status };
```

- [x] **Step 6: Wire `routes/help.ts` (create ticket)**

Tambah import: `import { notifySynced } from "../services/sync-notify";`
Setelah tiket + lampiran dibuat (setelah loop `prisma.ticketAttachment.create`, sebelum `const statusPath`):
```ts
    await notifySynced("ticket", ticket.id); // SPEC-268 · tiket baru ke feed (metadata; lampiran tak disync)
```

- [x] **Step 7: Wire `routes/tickets.ts` (accept/reject)**

Ganti import `enqueueOutbox` → `import { notifySynced } from "../services/sync-notify";`
Di `accept`, ganti:
```ts
    await prisma.ticket.update({ where: { id }, data: { status: "accepted", specId: spec!.id } });
    await notifySynced("spec", spec!.id);  // SPEC-213/268
    await notifySynced("ticket", id);       // SPEC-268
    return reply.code(201).send({ spec });
```
Di `reject`, setelah `const updated = ...`:
```ts
    const updated = await prisma.ticket.update({ where: { id }, data: { status: "rejected" } });
    await notifySynced("ticket", id); // SPEC-268
    return { id: updated.id, status: updated.status };
```

- [x] **Step 8: Wire `services/live-specs.ts` (advance spec)**

Baca file; temukan `await enqueueOutbox("spec", id)` (SPEC-267, setelah CAS `count > 0`). Ganti jadi:
```ts
      await notifySynced("spec", id); // SPEC-267/268 · advance stage ke feed (hub publish / client push)
```
Tambah import `import { notifySynced } from "./sync-notify";` dan hapus import `enqueueOutbox` bila tak lagi dipakai di file itu.

- [x] **Step 9: Run notify + route tests → LULUS**

Run:
```bash
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec vitest run --no-file-parallelism test/sync-notify.test.ts test/errors.route.test.ts test/errors-escalate.route.test.ts test/tickets.test.ts test/help.test.ts
```
Expected: PASS (route lama tetap hijau; notify baru hijau).

- [x] **Step 10: Commit**

```bash
git add server/src/services/sync-notify.ts server/test/sync-notify.test.ts server/src/services/error-ingest.ts server/src/routes/errors.ts server/src/routes/help.ts server/src/routes/tickets.ts server/src/services/live-specs.ts
git commit -m "feat(spec-268): notifySynced (hub publish / client push) di situs write error/tiket/spec"
```

---

### Task 4: Pemicu manual — `syncNow` + `POST /api/sync/now` + client API

**Files:**
- Modify: `server/src/services/sync-client.ts`, `server/src/routes/sync.ts`
- Modify: `shared/src/api.ts` (paths), `src/src/api/client.ts`
- Test: `server/test/sync-client.test.ts` (append), `server/test/sync.route.test.ts` (append)

**Interfaces:**
- Produces:
  - `syncNow(): Promise<SyncStats | null>` (sync-client.ts) — null bila bukan client.
  - `POST /api/sync/now` → `{ ok:true, pulled, pushed, conflicts }` | `{ ok:false, reason:"not-configured" }`.
  - `paths.syncNow`, `api.syncNow()`.

- [x] **Step 1: Test gagal (append `sync-client.test.ts`)**

```ts
import { syncNow } from "../src/services/sync-client";
import { setConfig, clearConfig } from "../src/config";

it("syncNow: null bila SYNC_SERVER_URL/TOKEN kosong (bukan client)", async () => {
  await clearConfig("SYNC_SERVER_URL"); await clearConfig("SYNC_DEVICE_TOKEN");
  expect(await syncNow()).toBeNull();
});
```
> `clean()` di file itu sudah menghapus deviceToken/user/project; tambahkan `await prisma.runtimeConfig.deleteMany();` bila perlu agar config bersih.

- [x] **Step 2: Run → GAGAL**

Run:
```bash
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec vitest run --no-file-parallelism test/sync-client.test.ts
```
Expected: FAIL (`syncNow` tak ada).

- [x] **Step 3: Implement `syncNow` di `sync-client.ts`**

Setelah `export function fetchTransport(...)`:
```ts
// SPEC-268 · ADR-0066 · pemicu manual (tombol UI): satu siklus syncOnce memakai config efektif.
// null bila instance bukan client (tak ada hub tujuan) → tombol/endpoint melapor "not-configured".
export async function syncNow(): Promise<SyncStats | null> {
  const base = effectiveStr("SYNC_SERVER_URL");
  const token = effectiveStr("SYNC_DEVICE_TOKEN");
  if (!base || !token) return null;
  return syncOnce(fetchTransport(base, token));
}
```
(`effectiveStr` sudah di-import di file ini.)

- [x] **Step 4: Endpoint `POST /sync/now` di `routes/sync.ts`**

Tambah import: `import { syncNow } from "../services/sync-client";`
Tambah di dalam `export default async function (app)` (mis. sebelum `/sync/ws`):
```ts
  // SPEC-268 · ADR-0066 · pemicu sync manual (cookie-authed; aksi UI same-origin). TANPA
  // requireDeviceToken — digerbangi gate cookie /api. Non-delegatable ke agent (gate agent blok /sync).
  app.post("/sync/now", async () => {
    const stats = await syncNow();
    if (!stats) return { ok: false as const, reason: "not-configured" as const };
    return { ok: true as const, ...stats };
  });
```

- [x] **Step 5: Test route (append `sync.route.test.ts`)**

```ts
it("POST /sync/now → not-configured saat bukan client (SPEC-268)", async () => {
  const r = await app.inject({ method: "POST", url: "/api/sync/now" });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({ ok: false, reason: "not-configured" });
});
```
> Bila `sync.route.test.ts` mem-boot `buildApp()` dengan auth aktif, pakai pola yang sudah ada di file itu (mis. `buildApp({ requireAuth:false })` atau session cookie). Sesuaikan header agar 200, bukan 401.

- [x] **Step 6: Shared path + client API**

Di `shared/src/api.ts`, dalam objek `paths` dekat `config`, tambah:
```ts
  syncNow: `${API}/sync/now`,
```
Di `src/src/api/client.ts`, dalam objek `api`, tambah:
```ts
  syncNow: () => j<{ ok: boolean; reason?: string; pulled?: number; pushed?: number; conflicts?: number }>(paths.syncNow, { method: "POST" }),
```

- [x] **Step 7: Run server tests → LULUS**

Run:
```bash
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec vitest run --no-file-parallelism test/sync-client.test.ts test/sync.route.test.ts
```
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add server/src/services/sync-client.ts server/src/routes/sync.ts server/test/sync-client.test.ts server/test/sync.route.test.ts shared/src/api.ts src/src/api/client.ts
git commit -m "feat(spec-268): POST /api/sync/now + syncNow() + api.syncNow (pemicu manual)"
```

---

### Task 5: Frontend — `SyncButton` + `useSyncActive` + wiring 3 layar

**Files:**
- Create: `src/src/screens/SyncButton.tsx`
- Create: `src/test/sync-button.test.tsx`
- Modify: `src/src/screens/ErrorsScreen.tsx`, `src/src/screens/TriageScreen.tsx`, `src/src/screens/BacklogScreen.tsx`, `src/src/App.tsx`

**Interfaces:**
- Consumes: `api.getConfig()` (`.sync.running`), `api.syncNow()`.
- Produces: `<SyncButton onDone={() => void} onToast={ShowToast} />` (render hanya bila client).

- [x] **Step 1: Test gagal `src/test/sync-button.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const { getConfig, syncNow } = vi.hoisted(() => ({
  getConfig: vi.fn(async () => ({ entries: [], sync: { running: true, connected: true } })),
  syncNow: vi.fn(async () => ({ ok: true, pulled: 2, pushed: 1, conflicts: 0 })),
}));
vi.mock("../src/api/client", () => ({ api: { getConfig, syncNow }, ApiError: class extends Error {} }));

import { SyncButton } from "../src/screens/SyncButton";

describe("SyncButton (SPEC-268)", () => {
  it("render saat client, klik → syncNow + toast + onDone", async () => {
    const onDone = vi.fn(); const onToast = vi.fn();
    render(<SyncButton onDone={onDone} onToast={onToast} />);
    const btn = await screen.findByText("Sync");
    fireEvent.click(btn);
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("↓2 ↑1"), "ok", expect.anything());
  });

  it("tak render saat hub (sync.running=false)", async () => {
    getConfig.mockResolvedValueOnce({ entries: [], sync: { running: false, connected: false } } as never);
    // reset module cache: import ulang lewat isolateModules bila perlu; di sini uji via komponen kedua
    const { container } = render(<SyncButton onDone={vi.fn()} onToast={vi.fn()} />);
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    expect(container.textContent).not.toContain("Sync");
  });
});
```
> Cache modul `useSyncActive` bisa membuat test kedua memakai hasil pertama. Bila perlu, ekspor `__resetSyncActiveCache()` untuk test, atau jadikan test kedua file terpisah / pakai `vi.resetModules()`. Sesuaikan saat implement agar dua kondisi teruji.

- [x] **Step 2: Run → GAGAL**

Run:
```bash
env -u NODE_ENV pnpm -C src exec vitest run test/sync-button.test.tsx
```
Expected: FAIL (komponen belum ada). (Frontend test tak butuh DB.)

- [x] **Step 3: Buat `src/src/screens/SyncButton.tsx`**

```tsx
import React from "react";
import { Button } from "../ds";
import { api } from "../api/client";

// SPEC-268 · "instance ini client sync?" — di-cache modul (sekali fetch config). Reset untuk test.
let cached: Promise<boolean> | null = null;
export function __resetSyncActiveCache(): void { cached = null; }
export function useSyncActive(): boolean {
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    if (!cached) cached = api.getConfig().then((c) => c.sync?.running ?? false).catch(() => false);
    let alive = true;
    cached.then((v) => { if (alive) setActive(v); });
    return () => { alive = false; };
  }, []);
  return active;
}

// Tombol "Sync sekarang" — muncul hanya di instance client. POST /sync/now, toast hasil, reload (onDone).
export function SyncButton({ onDone, onToast }:
  { onDone: () => void; onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const active = useSyncActive();
  const [busy, setBusy] = React.useState(false);
  if (!active) return null;
  async function run() {
    setBusy(true);
    try {
      const r = await api.syncNow();
      if (!r.ok) onToast("Instance ini hub — tak ada sync manual", "info", "info");
      else onToast(`Sinkron: ↓${r.pulled ?? 0} ↑${r.pushed ?? 0}${r.conflicts ? ` · ${r.conflicts} konflik` : ""}`,
        r.conflicts ? "warn" : "ok", r.conflicts ? "triangle-alert" : "check");
      onDone();
    } catch { onToast("Gagal sync", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  return (
    <Button size="sm" variant="secondary" leftIcon="rotate-ccw" onClick={run} disabled={busy}>
      {busy ? "Menyinkron…" : "Sync"}
    </Button>
  );
}
```
> Bila test kondisi kedua butuh reset, panggil `__resetSyncActiveCache()` di `beforeEach` test / gunакan `vi.resetModules()`. Konfirmasi ikon `rotate-ccw` & tone `info` valid (sudah dicek).

- [x] **Step 4: Wire `ErrorsScreen.tsx`**

Import: `import { SyncButton } from "./SyncButton";`
Di toolbar, ganti blok spacer+Panduan (sekitar baris 158-159):
```tsx
        <span style={{ flex: 1 }} />
        <SyncButton onDone={() => load(true)} onToast={onToast} />
        <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => setGuideOpen(true)}>Panduan integrasi</Button>
```

- [x] **Step 5: Wire `TriageScreen.tsx`**

Import: `import { SyncButton } from "./SyncButton";`
Di toolbar, setelah badge `unreviewed` (sekitar baris 172), tambahkan spacer + tombol:
```tsx
        {unreviewed > 0 && <Badge tone="warn">{unreviewed} belum ditinjau</Badge>}
        <span style={{ flex: 1 }} />
        <SyncButton onDone={() => load(true)} onToast={onToast} />
```

- [x] **Step 6: Wire `BacklogScreen.tsx` (+ prop onToast)**

Tambah `onToast` ke destructuring props `BacklogScreen({ ... , dataVersion, onToast })` dan ke tipe param (`onToast: (msg: string, kind?: string, icon?: string) => void`).
Tambah state reload di dekat state lain: `const [syncNonce, setSyncNonce] = React.useState(0);`
Tambah `syncNonce` ke deps useEffect fetch (baris ~571 array deps).
Import: `import { SyncButton } from "./SyncButton";`
Di header kanan (baris ~582-585), tambah SyncButton sebelum/ sesudah `<span className="hn-eyebrow">{data.total} spec</span>`:
```tsx
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Tabs variant="pill" value={view} onChange={setView} tabs={VIEWS} aria-label="Mode tampilan" />
            <SyncButton onDone={() => setSyncNonce((n) => n + 1)} onToast={onToast} />
            <span className="hn-eyebrow">{data.total} spec</span>
          </div>
```

- [x] **Step 7: Wire `App.tsx` — pass onToast ke BacklogScreen**

Di render `<BacklogScreen ... />` (baris ~797), tambahkan prop `onToast={showToast}`.

- [x] **Step 8: Run frontend tests → LULUS**

Run:
```bash
env -u NODE_ENV pnpm -C src exec vitest run test/sync-button.test.tsx test/errors-screen.test.tsx test/triage.test.tsx test/backlog-board.test.tsx
```
Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add src/src/screens/SyncButton.tsx src/test/sync-button.test.tsx src/src/screens/ErrorsScreen.tsx src/src/screens/TriageScreen.tsx src/src/screens/BacklogScreen.tsx src/src/App.tsx
git commit -m "feat(spec-268): tombol Sync di Backlog/Errors/Triase (SyncButton + useSyncActive)"
```

---

### Task 6: SoT docs (commit yang sama dengan kode fitur)

**Files:**
- Modify: `internal/docs/README.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`

- [x] **Step 1: Link ADR-0066 di `internal/docs/README.md`**

Di bagian `## adr`, tepat di atas baris `- [0065 …]`, tambah:
```markdown
- [0066 — Errors & tickets masuk record-sync (publish asal-hub) + pemicu sync manual](adr/0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md) — **memperluas 0045**, terkait 0043/0046/0060/0062 (SPEC-268)
```

- [x] **Step 2: `data-model.md` — ErrorGroup/Ticket punya version & tersync**

Cari deskripsi `ErrorGroup`/`Ticket` (server-local). Perbarui menjadi: kini punya `version` & termasuk entitas sync record (agregat grup / metadata tiket; `ErrorEvent` & `TicketAttachment` tetap tak disync). Sebut ADR-0066.

- [x] **Step 3: `api-contract.md` — endpoint + ralat catatan sync**

- Tambah baris endpoint di bagian sync: `POST /api/sync/now` (cookie-authed) → `{ok, pulled, pushed, conflicts}` / `{ok:false, reason:"not-configured"}`; pemicu manual, non-delegatable agent.
- Ralat catatan "errors/tickets server-local (tanpa sync)" (baris ~349/380) → kini tersync record (agregat/metadata) via ADR-0066; **lampiran tetap server-local (tak disync)**.

- [x] **Step 4: Verifikasi integritas index**

Run:
```bash
pnpm -C server exec tsx ../cli/... 2>/dev/null || node -e "console.log('cek manual: ADR-0066 ter-link di README')"
```
> Bila ada CLI `hanoman docs index --check`, jalankan; else cek manual link ada.

- [x] **Step 5: Commit**

```bash
git add internal/docs/README.md internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md
git commit -m "docs(spec-268): SoT — ADR-0066 link + data-model/api-contract (errors/tickets tersync + /sync/now)"
```

---

### Task 7: Verifikasi penuh + smoke API nyata

**Files:** (tak ada perubahan kode; hanya jika ada temuan)

- [x] **Step 1: Seluruh suite server hijau**

Run:
```bash
env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' pnpm -C server exec vitest run --no-file-parallelism
```
Expected: semua PASS. (Fix regresi bila ada sebelum lanjut.)

- [x] **Step 2: Seluruh suite frontend hijau**

Run:
```bash
env -u NODE_ENV pnpm -C src exec vitest run
```
Expected: semua PASS.

- [x] **Step 3: Build server + shared (type-check)**

Run:
```bash
pnpm -C shared build && pnpm -C server build
```
Expected: exit 0 (strict TS bersih).

- [x] **Step 4: Smoke API nyata — boot + curl**

Boot server terhadap DB hanoman268 (bukan prod), lalu:
```bash
# di terminal terpisah / background:
#   env -u NODE_ENV DATABASE_URL='postgresql://hanoman:hanoman@localhost:5432/hanoman268' HANOMAN_TMUX_SOCKET=hanoman268 node server/dist/server.js
# setelah login/setup untuk cookie, atau boot dgn requireAuth off untuk smoke:
curl -s -X POST localhost:8787/api/sync/now | head
```
Expected: `{"ok":false,"reason":"not-configured"}` (instance ini hub). Verifikasi juga `GET /api/sync/pull?since=0` memuat baris `errorGroup`/`ticket` setelah ingest/tiket dummy (opsional).
> Gunakan port/DB/socket khusus agar tak bentrok sesi dev lain (memory: jangan port 8787 dgn DB dev bersama — pakai DB hanoman268 + socket khusus).

- [x] **Step 5: Ceklis plan penuh & pastikan tak ada `- [x]` tersisa**

Verifikasi semua kotak Task 1-7 tercentang.

## Self-Review (penulis plan)

- **Coverage vs spec/ADR:** version columns (T1) · SYNCED+publishLocal (T2) · notifySynced+wiring hub-publish (T3) · POST /sync/now+syncNow (T4) · tombol 3 layar+gate client (T5) · SoT (T6) · verifikasi+smoke (T7). AC-1..6 ADR-0066 tercakup (T4/T5=AC1/2, T3=AC3/4, T2=AC5/6).
- **Placeholder:** tak ada TBD; tiap step ada kode/perintah. Dua titik "sesuaikan bila signature beda" (setConfig, boot smoke) diberi instruksi konkret + fallback.
- **Type consistency:** entity string `"errorGroup"`/`"ticket"` konsisten lintas sync.ts/notify/test; `syncNow(): SyncStats|null`; `SyncButton` props sama di komponen & call-site; `paths.syncNow`/`api.syncNow` cocok.
