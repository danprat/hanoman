# WebSocket real-time (SPEC-199) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti kelima poll `setInterval` klien (board 3s, sesi 8s, notif 10s, limits 60s, vps 30s) dengan satu WebSocket siar global yang mendorong perubahan dari server.

**Architecture:** Hub siar server (`services/events.ts`) menjalankan SATU loop interval ref-counted (hidup hanya saat ada klien), meng-compute snapshot per-grup dengan cadence + dedup signature, dan mem-broadcast lewat route `GET /api/events/ws`. Klien punya satu koneksi singleton (`api/events.ts`) dengan `subscribe(handler)`; tiap consumer buang `setInterval`-nya dan pasang subscribe. Generalisasi pola siar `services/pty.ts` yang sudah terbukti — bukan bus event / Redis. Lihat spec `docs/superpowers/specs/2026-07-12-websocket-realtime-spec-199.md` dan ADR-0039.

**Tech Stack:** Fastify + `@fastify/websocket` (server, sudah terpasang), `ws` (test klien, sudah dep), React + `useSyncExternalStore` (klien), vitest, TypeScript strict.

## Global Constraints

- TypeScript strict; test untuk tiap logika orchestrasi.
- Endpoint HTTP GET (`/specs`, `/terminal/sessions`, `/notifications`, `/limits`, `/vps`) TETAP ADA — dipakai initial paint. Hanya `setInterval` klien yang dihapus.
- Auth: WS upgrade lewat gate `onRequest` scope `/api` (cookie `hn_session` same-origin) — tak ada kode auth baru.
- Update `internal/docs` yang tersentuh dalam commit yang sama (ADR-0039 sudah ditulis di fase spec; api-contract.md + frontend-implementation.md di Task 7).
- Node 24; `WebSocket` global tersedia untuk smoke script.
- Test server: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test` (hindari env sesi menunjuk prod; DB `_test` diderivasi vitest.config.ts).
- Jangan spawn `claude` sungguhan di test/smoke.

---

### Task 1: Wire contract di shared (`EventMsg`, `SessionDTO`, path)

**Files:**
- Modify: `shared/src/dto.ts` (tambah `SessionDTO` + `EventMsg`, akhir file)
- Modify: `shared/src/api.ts:29` (tambah `eventsWs` setelah `terminalWs`)

**Interfaces:**
- Produces: `SessionDTO`, `EventMsg` (union), `paths.eventsWs: string`. Dipakai server hub (Task 3), route (Task 4), klien (Task 5–6).

- [x] **Step 1: Tambah tipe kontrak di `shared/src/dto.ts`**

Di akhir file `shared/src/dto.ts`, tambah (import `Spec`/`Notification` dari entities di baris atas file — gabung dengan import yang ada bila perlu):

```typescript
import type { Spec, Notification } from "./entities";

// SPEC-199 · bentuk sesi di wire (cermin services/pty.ts SessionInfo & client TerminalSession).
export type SessionDTO = {
  id: string; projectId: string; specId?: string; flow?: string; cwd: string;
  exited: boolean; decision: boolean;
};

// SPEC-199 · frame siar dashboard (server → klien). Read-only feed: tak ada frame klien → server.
// Per-grup, bukan snapshot monolitik — perubahan satu grup tak mengirim ulang yang lain.
export type EventMsg =
  | { t: "specs"; specs: Spec[] }
  | { t: "sessions"; sessions: SessionDTO[] }
  | { t: "notifications"; items: Notification[]; unread: number }
  | { t: "limits"; limits: LimitsDTO }
  | { t: "vps"; vps: VpsView[] };
```

- [x] **Step 2: Tambah path `eventsWs` di `shared/src/api.ts`**

Setelah baris `terminalWs: (id) => ...` (baris 29), tambah:

```typescript
  eventsWs: `${API}/events/ws`,   // SPEC-199 · WebSocket siar dashboard (global, bukan per-sesi)
```

- [x] **Step 3: Verifikasi typecheck shared bersih**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && pnpm --filter @hanoman/shared build`
Expected: build sukses, tanpa error TS. Konfirmasi `paths.eventsWs === "/api/events/ws"`:
Run: `node -e "import('./shared/dist/api.js').then(m=>console.log(m.paths.eventsWs))"`
Expected: mencetak `/api/events/ws`

- [x] **Step 4: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts
git commit -m "feat(shared): kontrak EventMsg + path events WS (SPEC-199)"
```

---

### Task 2: Ekstrak snapshot builder server (tanpa drift HTTP↔WS)

Hub dan route HTTP harus hitung data yang sama. Ekstrak dua logika yang kini inline di route jadi service, lalu rewire route memanggilnya.

**Files:**
- Create: `server/src/services/live-specs.ts`
- Modify: `server/src/routes/specs.ts:39-70` (ganti body handler `GET /specs` jadi panggil `liveSpecs`)
- Modify: `server/src/services/notifications.ts` (tambah `notificationsFeed`)
- Modify: `server/src/routes/notifications.ts:8-13` (panggil `notificationsFeed`)
- Test: `server/test/specs.route.test.ts` + `server/test/notifications.route.test.ts` (yang ada — harus tetap hijau)

**Interfaces:**
- Produces: `liveSpecs(filter?: { project?: string; source?: string }): Promise<Spec[]>`; `notificationsFeed(): Promise<{ items: Notification[]; unread: number }>`. Dikonsumsi Task 3 (hub) + route.

- [x] **Step 1: Buat `server/src/services/live-specs.ts` (pindahkan logika stage-live dari route)**

```typescript
import type { Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { sessionPhasesBySpec } from "./pty";
import { stageForRun } from "./session-phases";
import { STAGES } from "./stage-machine";
import { recordCompletion } from "./notifications";

// SPEC-199 · dulu inline di GET /specs; kini dipakai route HTTP DAN hub siar (services/events.ts)
// supaya push WS dan pull HTTP tak pernah drift. Stage live diturunkan dari berkas fase sesi
// (SPEC-168), hanya maju (ADR-0008), write-through CAS (SPEC-197).
export async function liveSpecs(filter: { project?: string; source?: string } = {}) {
  const specs = await prisma.spec.findMany({
    where: { projectId: filter.project, source: filter.source }, orderBy: { id: "desc" },
  });
  const live = sessionPhasesBySpec();
  if (live.size === 0) return specs;
  const advanced: { id: string; from: Stage; stage: Stage }[] = [];
  const doneNow: { specId: string; title: string; projectId: string | null }[] = [];
  const out = specs.map((s) => {
    const entry = live.get(s.id);
    if (!entry) return s;
    const next = stageForRun(entry.phases, entry.cwd, s.id);
    if (!next || STAGES.indexOf(next) <= STAGES.indexOf(s.stage as Stage)) return s;
    advanced.push({ id: s.id, from: s.stage as Stage, stage: next });
    if (next === "done") doneNow.push({ specId: s.id, title: s.title, projectId: s.projectId });
    return { ...s, stage: next };
  });
  if (advanced.length)
    await Promise.all(advanced.map((a) =>
      prisma.spec.updateMany({ where: { id: a.id, stage: a.from }, data: { stage: a.stage } }).catch(() => {})));
  await Promise.all(doneNow.map((d) => recordCompletion(d.specId, d.title, d.projectId)));
  return out;
}
```

- [x] **Step 2: Rewire `GET /specs` di `server/src/routes/specs.ts` memakai `liveSpecs`**

Ganti seluruh handler `app.get("/specs", ...)` (baris 39–70) dengan:

```typescript
  app.get("/specs", async (req) => {
    const { project, source } = req.query as { project?: string; source?: string };
    return liveSpecs({ project, source });
  });
```

Tambah import di atas: `import { liveSpecs } from "../services/live-specs";`. Hapus import yang jadi tak terpakai di specs.ts BILA tak dipakai lagi di file itu: cek `sessionPhasesBySpec`, `stageForRun`, `STAGES`, `recordCompletion` — hapus barisnya hanya jika grep di specs.ts tak menemukan pemakaian lain.

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && grep -nE 'sessionPhasesBySpec|stageForRun|STAGES|recordCompletion' server/src/routes/specs.ts`
Expected: hanya baris import yang cocok (bila 0 pemakaian selain import → hapus importnya).

- [x] **Step 3: Tambah `notificationsFeed` di `server/src/services/notifications.ts`**

Di akhir file, tambah:

```typescript
// SPEC-199 · cermin GET /notifications: scan marker dulu, lalu daftar + hitungan unread.
// Dipakai route HTTP dan hub siar (services/events.ts).
export async function notificationsFeed(): Promise<{ items: Notification[]; unread: number }> {
  await scanDecisions();
  const items = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const unread = await prisma.notification.count({ where: { readAt: null } });
  return { items, unread };
}
```

Tambah import tipe di atas file: `import type { Notification } from "@hanoman/shared";`.

- [x] **Step 4: Rewire `GET /notifications` memakai `notificationsFeed`**

Di `server/src/routes/notifications.ts`, ganti isi handler GET (baris 8–13) jadi:

```typescript
  app.get("/notifications", async () => notificationsFeed());
```

Ubah import di baris 3 dari `import { scanDecisions } from "../services/notifications";` menjadi `import { notificationsFeed } from "../services/notifications";`. Hapus import `scanDecisions` bila tak dipakai lagi di route ini.

- [x] **Step 5: Jalankan test route yang ada — harus tetap hijau (logika tak berubah, cuma pindah)**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- specs.route notifications.route`
Expected: PASS semua (perilaku identik; ekstraksi murni).

- [x] **Step 6: Commit**

```bash
git add server/src/services/live-specs.ts server/src/routes/specs.ts server/src/services/notifications.ts server/src/routes/notifications.ts
git commit -m "refactor(server): ekstrak liveSpecs + notificationsFeed untuk dipakai hub siar (SPEC-199)"
```

---

### Task 3: Hub siar server (`services/events.ts`)

**Files:**
- Create: `server/src/services/events.ts`
- Test: `server/test/events.test.ts`

**Interfaces:**
- Consumes: `liveSpecs` (Task 2), `notificationsFeed` (Task 2), `listSessions` + `type Client` (pty.ts), `getLimits` (services/limits), `prisma`.
- Produces: `attach(c: Client): Promise<void>` (tambah klien + kirim snapshot penuh ke klien itu, start loop), `detach(c: Client): void`, `__tick(): Promise<void>` (satu iterasi loop — dipakai test & interval), `__reset(): void` (test-only: kosongkan klien + stop loop). Dikonsumsi Task 4 (route).

- [x] **Step 1: Tulis test gagal `server/test/events.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { attach, detach, __tick, __reset } from "../src/services/events";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { killAll } from "../src/services/pty";

// Klien perekam frame (lihat pty.test.ts) — cukup untuk menguji kontrak siar tanpa WS nyata.
function fakeClient() {
  const frames: { t: string; [k: string]: unknown }[] = [];
  return { frames, send: (m: string) => frames.push(JSON.parse(m)), close: () => {} };
}
const groups = (c: ReturnType<typeof fakeClient>) => new Set(c.frames.map((f) => f.t));

beforeEach(async () => { killAll(); await resetDb(); __reset(); });
afterEach(() => { __reset(); });

describe("events hub", () => {
  it("mengirim snapshot semua grup ke klien saat attach", async () => {
    const c = fakeClient();
    await attach(c);
    // tmux tak jalan → sessions/specs kosong tapi tetap terkirim; notifications/limits/vps ada.
    expect(groups(c).has("sessions")).toBe(true);
    expect(groups(c).has("specs")).toBe(true);
    expect(groups(c).has("notifications")).toBe(true);
    const nf = c.frames.find((f) => f.t === "notifications");
    expect(nf).toMatchObject({ unread: 0 });
    detach(c);
  });

  it("broadcast frame notifications saat data berubah, dedup saat tak berubah", async () => {
    const c = fakeClient();
    await attach(c);
    const before = c.frames.filter((f) => f.t === "notifications").length;
    await prisma.notification.create({ data: { specId: "SPEC-1", title: "x", projectId: "p1" } });
    await __tick(); await __tick(); await __tick(); // notifications: everyTicks 3
    const afterCreate = c.frames.filter((f) => f.t === "notifications").length;
    expect(afterCreate).toBeGreaterThan(before);
    // tick lagi tanpa perubahan → tak ada frame notifications baru (dedup signature)
    await __tick(); await __tick(); await __tick();
    expect(c.frames.filter((f) => f.t === "notifications").length).toBe(afterCreate);
    detach(c);
  });

  it("klien yang di-detach berhenti menerima frame", async () => {
    const c = fakeClient();
    await attach(c);
    detach(c);
    const n = c.frames.length;
    await prisma.notification.create({ data: { specId: "SPEC-2", title: "y", projectId: "p1" } });
    await __tick(); await __tick(); await __tick();
    expect(c.frames.length).toBe(n);
  });
});
```

- [x] **Step 2: Jalankan test — verifikasi gagal**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- events`
Expected: FAIL — `services/events` belum ada / `attach` undefined.

- [x] **Step 3: Implementasi `server/src/services/events.ts`**

```typescript
import type { Client } from "./pty";
import { listSessions } from "./pty";
import { liveSpecs } from "./live-specs";
import { notificationsFeed } from "./notifications";
import { getLimits } from "./limits";
import { prisma } from "../db";
import type { EventMsg } from "@hanoman/shared";

// SPEC-199 · satu WebSocket siar untuk seluruh data real-time dashboard (ADR-0039). Meniru
// pola siar services/pty.ts: satu Set klien, satu loop ref-counted, frame lahir hanya saat
// isinya berubah. Sumber (tmux/berkas/DB) poll-only — server yang men-poll, klien didorong.
const clients = new Set<Client>();
// Test menurunkan tick agar cepat; prod 1s. Loop cuma jalan saat ada klien.
const TICK_MS = Number(process.env.HANOMAN_EVENTS_TICK_MS) || 1000;

type Group = { everyTicks: number; last: string; build: () => Promise<EventMsg> };
// everyTicks = recompute tiap N detik: board 1s, notif 3s, vps 15s, limits 30s (cache 30s service).
const GROUPS: Group[] = [
  { everyTicks: 1,  last: "", build: async () => ({ t: "sessions", sessions: listSessions() }) },
  { everyTicks: 1,  last: "", build: async () => ({ t: "specs", specs: await liveSpecs() }) },
  { everyTicks: 3,  last: "", build: async () => ({ t: "notifications", ...(await notificationsFeed()) }) },
  // ponytail: cermin GET /vps (orderBy createdAt asc). Query sepele — tak diekstrak.
  { everyTicks: 15, last: "", build: async () => ({ t: "vps", vps: await prisma.vps.findMany({ orderBy: { createdAt: "asc" } }) }) },
  { everyTicks: 30, last: "", build: async () => ({ t: "limits", limits: await getLimits() }) },
];

function broadcast(msg: EventMsg): void {
  const s = JSON.stringify(msg);
  for (const c of clients) { try { c.send(s); } catch { clients.delete(c); } }
}

let tick = 0;
let busy = false;
let timer: NodeJS.Timeout | undefined;

// Satu iterasi: tiap grup yang jatuh temponya di-recompute; broadcast hanya saat signature berubah.
export async function __tick(): Promise<void> {
  if (busy) return;             // build bisa > TICK_MS (DB/tmux); jangan menumpuk
  busy = true;
  tick++;
  try {
    for (const g of GROUPS) {
      if (tick % g.everyTicks !== 0) continue;
      let msg: EventMsg;
      try { msg = await g.build(); } catch { continue; }
      const sig = JSON.stringify(msg);
      if (sig === g.last) continue;
      g.last = sig;
      broadcast(msg);
    }
  } finally { busy = false; }
}

function startLoop(): void {
  if (timer) return;
  timer = setInterval(() => { void __tick(); }, TICK_MS);
  timer.unref();
}
function stopLoop(): void {
  if (timer) { clearInterval(timer); timer = undefined; }
  tick = 0;
  for (const g of GROUPS) g.last = "";   // klien berikut mulai dari state segar
}

// Klien baru dapat snapshot penuh SEGERA (tak menunggu tick) — late joiner langsung tersinkron,
// persis scrollback di pty.attach. Dibangun fresh, lepas dari dedup broadcast.
export async function attach(c: Client): Promise<void> {
  clients.add(c);
  startLoop();
  for (const g of GROUPS) {
    try { c.send(JSON.stringify(await g.build())); } catch { return; }
  }
}

export function detach(c: Client): void {
  clients.delete(c);
  if (clients.size === 0) stopLoop();
}

// Test-only: kosongkan klien + hentikan loop + reset signature.
export function __reset(): void { clients.clear(); stopLoop(); }
```

- [x] **Step 4: Jalankan test — verifikasi lulus**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- events`
Expected: PASS ketiga test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/events.ts server/test/events.test.ts
git commit -m "feat(server): hub siar events dashboard, satu loop ref-counted + dedup (SPEC-199)"
```

---

### Task 4: Route WebSocket `GET /api/events/ws` + registrasi

**Files:**
- Create: `server/src/routes/events.ts`
- Modify: `server/src/app.ts:17` (import) + `:76` (register setelah `limits`)
- Test: `server/test/events.route.test.ts`

**Interfaces:**
- Consumes: `attach`, `detach` (Task 3), `type Client` (pty.ts).
- Produces: route `GET /api/events/ws` (WebSocket).

- [x] **Step 1: Tulis test gagal `server/test/events.route.test.ts` (WS nyata, mirror terminal.route.test.ts)**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { killAll } from "../src/services/pty";

const app = buildApp({ requireAuth: false });
let origin = "";
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
function connect() {
  const ws = new WebSocket(`ws://${origin}/api/events/ws`);
  const frames: { t: string; [k: string]: unknown }[] = [];
  ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString())));
  const opened = new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  return { ws, frames, opened };
}

beforeAll(async () => {
  process.env.HANOMAN_EVENTS_TICK_MS = "50";
  killAll(); await resetDb();
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); });

describe("events WS route", () => {
  it("kirim snapshot penuh saat connect", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "notifications"));
    expect(c.frames.some((f) => f.t === "sessions")).toBe(true);
    expect(c.frames.some((f) => f.t === "specs")).toBe(true);
    c.ws.close();
  });

  it("mendorong frame notifications saat baris baru lahir", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "notifications"));
    const before = c.frames.filter((f) => f.t === "notifications").length;
    await prisma.notification.create({ data: { specId: "SPEC-9", title: "z", projectId: "p1" } });
    await waitFor(() => c.frames.filter((f) => f.t === "notifications").length > before);
    const nf = c.frames.filter((f) => f.t === "notifications").pop() as { items: unknown[] };
    expect(nf.items.length).toBe(1);
    c.ws.close();
  });
});
```

- [x] **Step 2: Jalankan test — verifikasi gagal**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- events.route`
Expected: FAIL — route belum ada (WS `error`/close 404).

- [x] **Step 3: Buat `server/src/routes/events.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { attach, detach } from "../services/events";
import type { Client } from "../services/pty";

// SPEC-199 · WebSocket siar dashboard (ADR-0039). Auth diwarisi gate onRequest scope /api
// (cookie same-origin), sama seperti WS terminal. Read-only feed: frame masuk diabaikan.
export default async function (app: FastifyInstance) {
  app.get("/events/ws", { websocket: true }, (socket) => {
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    void attach(client);
    socket.on("close", () => detach(client));
  });
}
```

- [x] **Step 4: Registrasi di `server/src/app.ts`**

Tambah import setelah baris 17 (`import limits from "./routes/limits";`):

```typescript
import events from "./routes/events";
```

Tambah register setelah baris 76 (`await api.register(limits);`):

```typescript
    await api.register(events);
```

- [x] **Step 5: Jalankan test — verifikasi lulus**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test -- events.route`
Expected: PASS kedua test.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/events.ts server/src/app.ts
git commit -m "feat(server): route GET /api/events/ws siar dashboard (SPEC-199)"
```

---

### Task 5: Klien WebSocket singleton (`src/src/api/events.ts`)

**Files:**
- Create: `src/src/api/events.ts`
- Test: `src/src/api/events.test.ts`

**Interfaces:**
- Consumes: `paths.eventsWs`, `EventMsg` (Task 1).
- Produces: `subscribe(handler: (m: EventMsg) => void): () => void`. Dikonsumsi Task 6.

- [x] **Step 1: Tulis test gagal `src/src/api/events.test.ts` (mock WebSocket)**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock WebSocket global sebelum import modul (modul menyimpan referatnya via `new WebSocket`).
class FakeWS {
  static instances: FakeWS[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  readyState = 0; url: string;
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

beforeEach(() => { FakeWS.instances = []; (globalThis as any).WebSocket = FakeWS as unknown as typeof WebSocket; });
afterEach(() => { vi.restoreAllMocks(); });

describe("client events singleton", () => {
  it("membuka satu koneksi untuk banyak subscriber, meneruskan frame, menutup saat sub terakhir lepas", async () => {
    const { subscribe } = await import("./events");
    const got: string[] = [];
    const un1 = subscribe((m) => { if (m.t === "specs") got.push("a"); });
    const un2 = subscribe((m) => { if (m.t === "specs") got.push("b"); });
    expect(FakeWS.instances.length).toBe(1);      // satu koneksi dibagi
    FakeWS.instances[0].emit({ t: "specs", specs: [] });
    expect(got).toEqual(["a", "b"]);
    un1(); un2();
    expect(FakeWS.instances[0].readyState).toBe(3); // ditutup saat sub terakhir lepas
  });
});
```

- [x] **Step 2: Jalankan test — verifikasi gagal**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && pnpm --filter ./src test -- events`
Expected: FAIL — `./events` belum ada.

- [x] **Step 3: Implementasi `src/src/api/events.ts`**

```typescript
import { paths, type EventMsg } from "@hanoman/shared";

// SPEC-199 · satu koneksi WS dibagi semua consumer (ref-count, pola api/limits.ts). Server
// mendorong frame per-grup; tiap consumer filter berdasarkan msg.t. Reconnect backoff +
// tutup saat tab hidden (server kirim snapshot penuh tiap connect → state re-sync sendiri).
const subs = new Set<(m: EventMsg) => void>();
let ws: WebSocket | undefined;
let backoff = 500;
let intentionalClose = false;

function open(): void {
  if (ws || (typeof document !== "undefined" && document.hidden)) return;
  intentionalClose = false;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${scheme}//${location.host}${paths.eventsWs}`);
  ws.onopen = () => { backoff = 500; };
  ws.onmessage = (ev) => {
    let m: EventMsg;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    for (const s of subs) s(m);
  };
  ws.onclose = () => {
    ws = undefined;
    if (!intentionalClose && subs.size) {
      setTimeout(() => { if (subs.size) open(); }, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    }
  };
  ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
}

function close(): void { intentionalClose = true; try { ws?.close(); } catch { /* noop */ } ws = undefined; }

function onVisibility(): void {
  if (document.hidden) close();
  else if (subs.size) open();
}

export function subscribe(handler: (m: EventMsg) => void): () => void {
  subs.add(handler);
  if (subs.size === 1) {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    open();
  }
  return () => {
    subs.delete(handler);
    if (subs.size === 0) {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      close();
    }
  };
}
```

- [x] **Step 4: Jalankan test — verifikasi lulus**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && pnpm --filter ./src test -- events`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/api/events.ts src/src/api/events.test.ts
git commit -m "feat(web): klien WS singleton events, ref-count + reconnect (SPEC-199)"
```

---

### Task 6: Rewire kelima consumer (hapus setInterval → subscribe)

Pola sama di semua file: buang `setInterval`, pasang `subscribe` dari `api/events`, feed ke setter yang sudah ada. HTTP GET awal tetap.

**Files:**
- Modify: `src/src/App.tsx:320-338` (poll 3s board)
- Modify: `src/src/screens/TerminalScreen.tsx:27-46` (poll 8s sesi)
- Modify: `src/src/notifications/NotificationsContext.tsx:44,66-94` (poll 10s notif)
- Modify: `src/src/api/limits.ts:28-51` (poll 60s limits)
- Modify: `src/src/screens/VpsScreen.tsx:98-102` (poll 30s vps)

**Interfaces:**
- Consumes: `subscribe` (Task 5).

- [x] **Step 1: `App.tsx` — ganti poll 3s dengan subscribe**

Hapus blok `pollSigRef` + `React.useEffect` poll (baris 320–338). Ganti dengan:

```typescript
  // SPEC-199 · board didorong lewat WebSocket, bukan poll 3s. `load()` awal tetap (muat projects).
  React.useEffect(() => subscribe((m) => {
    if (m.t === "specs") setBacklog(m.specs);
    else if (m.t === "sessions") setSessions(m.sessions);
  }), []);
```

Tambah import: `import { subscribe } from "./api/events";`. Hapus `anySessionActive` (baris 316) bila tak dipakai lain — cek dengan grep; `activeSpecs` (baris 310) TETAP (dipakai render kartu).

Run: `grep -nE 'anySessionActive' src/src/App.tsx` → bila hanya deklarasinya, hapus baris itu.

- [x] **Step 2: `TerminalScreen.tsx` — ganti poll 8s dengan subscribe**

Buang `setInterval(... 8000)` + guard signature-nya. Ganti dengan subscribe yang men-`setSessions` pada frame `sessions`. Tambah `import { subscribe } from "../api/events";`. Pola:

```typescript
  React.useEffect(() => subscribe((m) => { if (m.t === "sessions") setSessions(m.sessions); }), []);
```

Pertahankan pemuatan awal `api.listTerminals()` yang sudah ada (paint pertama). Sesuaikan nama setter dengan yang ada di file (mis. `setSessions`).

- [x] **Step 3: `NotificationsContext.tsx` — ganti poll 10s dengan subscribe**

Ubah `tick` agar MENERIMA data yang didorong, bukan fetch. Ganti tanda tangan + isi:

```typescript
  // SPEC-199 · data notif didorong lewat WS (bukan poll 10s). Argumen = payload frame.
  const handle = React.useCallback((data: { items: Notification[]; unread: number }) => {
    setItems(data.items); setUnread(data.unread);
    if (baseline.current === undefined) { baseline.current = maxAt(data.items); return; }
    const fresh = newSince(data.items, baseline.current);
    const top = maxAt(data.items);
    if (top > baseline.current) baseline.current = top;
    const latest = fresh[0];
    if (latest) {
      const t = toastFor(latest, prefs.current);
      if (t.enabled) { showToast(t.msg, t.tone, t.icon); playNotifySound(t.sound); notifyOS(t.msg, latest, onOpenRef.current); }
    }
  }, [showToast]);
```

Ganti efek poll (baris 81–94) — buang `setInterval`/`tick`, pasang subscribe:

```typescript
  React.useEffect(() => {
    void loadPrefs();
    const unsub = subscribe((m) => { if (m.t === "notifications") handle({ items: m.items, unread: m.unread }); });
    const unlock = () => {
      unlockNotifySound();
      if ("Notification" in window && window.Notification.permission === "default") void window.Notification.requestPermission();
      window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { unsub(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, [handle, loadPrefs]);
```

Hapus `const POLL_MS = 10_000;` (baris 44). Tambah `import { subscribe } from "../api/events";`. `api.listNotifications` tak lagi dipakai di sini (dorong via WS) — biarkan import `api` bila masih dipakai `markAllRead`/`clear` (ya, dipakai).

- [x] **Step 4: `limits.ts` — ganti poll 60s dengan subscribe ke grup limits**

Ganti blok poller (baris 28–51) dengan:

```typescript
import { subscribe as subscribeEvents } from "./events";

// SPEC-199 · nilai limits didorong lewat WS (grup "limits"), bukan poll 60s. useLimits() tak berubah.
let state: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => {
      if (m.t === "limits") { state = m.limits; for (const s of subs) s(); }
    });
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && unsub) { unsub(); unsub = undefined; }
  };
}

export function useLimits(): LimitsDTO {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
```

Hapus import `api` bila tak dipakai lagi di file (cek: `worstWindow`/`severityToken`/`severityTone` tak pakai `api`). Pertahankan `useSyncExternalStore` import dan helper `worstWindow`/`severityToken`/`severityTone`.

Run: `grep -nE '\bapi\b' src/src/api/limits.ts` → bila 0 pemakaian selain import, hapus barisnya.

- [x] **Step 5: `VpsScreen.tsx` — ganti poll 30s dengan subscribe**

Ganti efek (baris 98–102) dengan:

```typescript
  React.useEffect(() => {
    load();
    return subscribe((m) => { if (m.t === "vps") { setList(m.vps); setStatus("ready"); } });
  }, [load]);
```

Tambah `import { subscribe } from "../api/events";`.

- [x] **Step 6: Typecheck + build klien**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && pnpm --filter ./src build`
Expected: build sukses, tanpa error TS (tak ada variabel/import yatim).

- [x] **Step 7: Jalankan test klien**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && pnpm --filter ./src test`
Expected: PASS (termasuk events.test.ts; test lain tak regresi).

- [x] **Step 8: Commit**

```bash
git add src/src/App.tsx src/src/screens/TerminalScreen.tsx src/src/notifications/NotificationsContext.tsx src/src/api/limits.ts src/src/screens/VpsScreen.tsx
git commit -m "feat(web): kelima consumer beralih dari poll ke WS subscribe (SPEC-199)"
```

---

### Task 7: Docs SoT + live smoke end-to-end

**Files:**
- Modify: `internal/docs/architecture/api-contract.md:3-5,115-129`
- Modify: `internal/docs/frontend/frontend-implementation.md:8-9` (+ baris 162-164, 208, 234 yang menyebut poll)
- Create (sementara, di scratchpad): skrip smoke

**Interfaces:** —

- [x] **Step 1: Update `api-contract.md`**

Ganti baris 3–5 (header transport) jadi menyebut dua WebSocket + hilangkan klaim "HTTP polling" untuk data real-time:

```markdown
REST + **WebSocket (terminal + events)** + HTTP GET (initial load). Semua di bawah `/api`. Tidak
ada SSE, tidak ada `/runs`, `/triggers`, maupun `/webhooks` — dicabut bersama runner headless
(ADR-0024). Data real-time dashboard (backlog/sesi/notifikasi/limits/vps) **didorong** lewat satu
WebSocket siar `GET /events/ws` (SPEC-199, ADR-0039) — bukan lagi polling. Terminal PTY punya
WebSocket per-sesi tersendiri.
```

Tambah blok endpoint baru setelah blok Terminal (setelah baris 129, sebelum `## VPS`):

```markdown
## Events (SPEC-199 · ADR-0039)
```
GET    /events/ws                    # WebSocket siar dashboard (global). Auth = gate /api (cookie).
#   server->klien (per-grup, saat berubah; snapshot penuh saat connect):
#     { t:"specs", specs } · { t:"sessions", sessions } · { t:"notifications", items, unread }
#     { t:"limits", limits } · { t:"vps", vps }
#   klien->server: — (read-only feed; frame masuk diabaikan)
```

> Satu loop server (cadence per-grup, dedup signature) menggantikan N-klien × poll. Endpoint HTTP
> GET tiap sumber tetap ada untuk paint pertama.
```

- [x] **Step 2: Update `frontend-implementation.md`**

Ganti baris 8–9 (bagian "Realtime") jadi:

```markdown
- Realtime: **WebSocket** untuk semua data live — satu WS siar dashboard `/events/ws`
  (backlog/sesi/notifikasi/limits/vps, SPEC-199/ADR-0039) + WS PTY per terminal
  (`/terminal/sessions/:id/ws`, frame `data`/`phase`/`exit`). Klien punya satu koneksi events
  singleton (`api/events.ts`, ref-count) yang di-`subscribe` tiap consumer. HTTP GET hanya untuk
  paint pertama. Tidak ada SSE, tidak ada poll `setInterval`.
```

Perbaiki kalimat yang menyebut poll agar akurat:
- Baris ~162-164 (`TerminalScreen mem-poll ... tiap ~8s`) → ganti jadi "menerima daftar sesi lewat WS siar (`/events/ws`), bukan poll".
- Baris ~208 (`daftar disegarkan lewat poll`) → "daftar disegarkan lewat WS siar".
- Baris ~234 (`jalur advanceStage menghentikan poll 3s board`) → hapus/ganti: "board didorong terus lewat WS; write-through stage tetap di `advanceStage`/`liveSpecs`".

Jalankan grep untuk menemukan baris persisnya sebelum edit:
Run: `grep -nE 'poll|8s|3s board|disegarkan' internal/docs/frontend/frontend-implementation.md`

- [x] **Step 3: Live smoke — boot server ke DB throwaway, connect WS nyata**

Ikuti memory "Live smoke: dedicated DB" (jangan pakai hanoman_test — sibling test bisa truncate). Buat DB throwaway + migrate + boot server di port non-8787, lalu connect `WebSocket` global (Node 24). Skrip di scratchpad:

Run:
```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199
SMOKE_DB="hanoman_smoke_199"
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c "DROP DATABASE IF EXISTS $SMOKE_DB;" -c "CREATE DATABASE $SMOKE_DB;"
export DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/$SMOKE_DB"
pnpm --filter ./server exec prisma migrate deploy
# boot tanpa auth util? auth aktif by default — smoke connect tanpa cookie akan 401.
# Pakai HANOMAN_EVENTS_TICK_MS kecil untuk push cepat. Bind 127.0.0.1, port 8799.
```

Karena route di belakang gate auth, smoke paling ringkas mem-boot app `buildApp({requireAuth:false})` lewat skrip node sementara + `app.listen({port:8799})`, connect `new WebSocket("ws://127.0.0.1:8799/api/events/ws")`, assert menerima frame `notifications`/`sessions`/`specs`, lalu `prisma.notification.create(...)` dan assert frame `notifications` baru datang. Tulis skrip ke `scratchpad/smoke-events.mjs` (impor dari `server/dist` setelah `pnpm --filter ./server build`, atau jalankan via tsx). Jalankan; PASS bila kedua assert terpenuhi. Bersihkan: `docker exec hanoman-db-1 psql -U hanoman -d hanoman -c "DROP DATABASE $SMOKE_DB;"`.

Expected: skrip mencetak frame yang diterima + "SMOKE OK".

- [x] **Step 4: Full test server + klien (regresi)**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-199 && env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test --no-file-parallelism && pnpm --filter ./src test`
Expected: seluruh suite PASS.

- [x] **Step 5: Commit docs**

```bash
git add internal/docs/architecture/api-contract.md internal/docs/frontend/frontend-implementation.md
git commit -m "docs(spec-199): api-contract + frontend realtime → WebSocket siar"
```

---

## Self-Review

**Spec coverage:** Kelima poll → Task 6 (App/Terminal/Notif/Limits/Vps). Hub siar + cadence + dedup → Task 3. Endpoint WS + auth → Task 4. Snapshot-on-connect/reconnect → Task 3 (attach) + Task 5 (klien). Kontrak pesan → Task 1. Anti-drift HTTP↔WS → Task 2 (liveSpecs/notificationsFeed). Docs + smoke → Task 7. Semua bagian spec terpetakan.

**Placeholder scan:** Tak ada TBD/TODO; tiap step berkode punya kode nyata; perintah + expected disertakan.

**Type consistency:** `EventMsg` (Task 1) dipakai konsisten di hub build (Task 3), route (Task 4), klien (Task 5) & consumer (Task 6). `subscribe(handler) => () => void` sama di Task 5 dan semua pemanggil Task 6. `liveSpecs()`/`notificationsFeed()` (Task 2) dipakai persis di Task 3. `attach`/`detach`/`__tick`/`__reset` (Task 3) dipakai Task 4 & test.
