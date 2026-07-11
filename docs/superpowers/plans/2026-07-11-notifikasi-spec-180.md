# Notifikasi backlog selesai (SPEC-180) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saat sebuah backlog mencapai stage `done`, server mencatat notifikasi; frontend menampilkannya sebagai lonceng+dropdown, memunculkan toast + sound, dengan setting enable/disable dan pilihan durasi sound.

**Architecture:** Notifikasi dibuat server-side di dua titik persist stage yang sudah ada (`advanceStage` di `terminal.ts`, write-through `GET /specs`) tepat saat transisi ke `done`. Model `Notification` (`specId @unique` → idempoten terhadap poll 3s & dua jalur). Frontend: `NotificationsProvider` (poll `GET /notifications` tiap 10s, toast+sound saat ada yang baru, gated setting) + `NotificationBell` di topbar `Shell`. Setting `notifyDone`/`notifySound` menumpang blob `Setting` (tanpa migration). Sound = 3 file WAV yang dibangkitkan skrip.

**Tech Stack:** TypeScript strict, Node + Fastify + Prisma (Postgres), React 18 + Vite, Vitest (server: node+sequential DB; src: jsdom).

## Global Constraints

- TypeScript strict; test untuk tiap logika baru (CLAUDE.md).
- Ubah skema ⇒ **migration + ADR** (CLAUDE.md). Model baru `Notification` → ADR-0030.
- Jangan jalankan run di working tree utama; worktree ini detached HEAD (disengaja).
- Suite server dijalankan dengan DB test terisolasi. hanoman & hanoman_test terpisah — DB test butuh migrate sendiri (`migrate deploy`), kalau tidak setiap test server melempar P2022.
- Perbarui `internal/docs/**` yang tersentuh dalam commit yang sama (SoT konvensi).
- Ikuti design system (`internal/docs/design-system/**`): pakai token/komponen yang ada, jangan ciptakan warna/tipografi baru.
- Frontend: nada notif dari `/sounds/notify-<kind>.wav` (Vite serve `src/public/`).
- Nilai default setting harus identik di 3 tempat: `shared` `zNotification`-adjacent `zSetting`, server `DEFAULT_SETTING`, frontend `S_DEFAULTS`.

---

### Task 1: Skema `Notification` + migration + tipe shared + resetDb

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_add_notification/migration.sql` (via prisma CLI)
- Modify: `shared/src/entities.ts`
- Modify: `shared/src/api.ts`
- Modify: `server/test/factory.ts` (`resetDb`)
- Test: `server/test/notifications.test.ts`

**Interfaces:**
- Produces:
  - Prisma model `Notification { id, specId @unique, title, projectId?, createdAt, readAt? }`.
  - `zNotification` (zod) + `type Notification` di `@hanoman/shared`. Field tanggal = `z.string()` (JSON ISO).
  - `paths.notifications = "/api/notifications"`.
  - `resetDb()` juga `deleteMany` tabel notification.

- [x] **Step 1: Tambah model ke schema**

Di `server/prisma/schema.prisma`, setelah model `Setting`:

```prisma
// SPEC-180 · notifikasi backlog selesai. specId @unique = 1 notif per backlog (idempoten
// terhadap poll write-through 3s & dua jalur persist stage). readAt null = belum dibaca.
model Notification {
  id        String    @id @default(cuid())
  specId    String    @unique
  title     String
  projectId String?
  createdAt DateTime  @default(now())
  readAt    DateTime?
}
```

- [x] **Step 2: Buat + terapkan migration (deploy, BUKAN dev) lalu ke DB test**

⚠️ **Deviasi dari rencana awal (`migrate dev`):** DB `hanoman`/`hanoman_test` dibagi antar-worktree dan sudah memuat migration sibling `20260711120000_add_spec_base_head_sha` yang TIDAK ada di folder worktree ini. `migrate dev` akan mendeteksi drift dan menawarkan **reset** (hapus data + kolom sibling). Juga env sesi menunjuk `DATABASE_URL=hanoman_prod` + `NODE_ENV=production`, jadi tiap perintah prisma WAJIB override env.

Prosedur aman yang dipakai:
```bash
# migration.sql ditulis manual (CREATE TABLE + UNIQUE INDEX), timestamp non-tabrakan:
#   server/prisma/migrations/20260711140000_add_notification/migration.sql
cd server
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman      npx prisma migrate deploy
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman_test npx prisma migrate deploy
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman      npx prisma generate
```
Expected: tabel `Notification` ada di `hanoman` **dan** `hanoman_test`; `@prisma/client` punya `prisma.notification`. `migrate deploy` hanya menerapkan migration lokal yang pending (aditif) — tak menyentuh tabel lain, tak reset. (Catatan: satu deploy tanpa override sempat masuk ke `hanoman_prod` — aditif, tak merusak; dibiarkan karena tabel ini memang akan ikut rilis ke prod.)

- [x] **Step 3: Tipe shared**

Di `shared/src/entities.ts`, setelah `zSetting`/`type Setting`:

```ts
// SPEC-180 · notifikasi backlog selesai. Tanggal = string ISO (JSON). readAt null = unread.
export const zNotification = z.object({
  id: z.string(), specId: z.string(), title: z.string(),
  projectId: z.string().nullable(),
  createdAt: z.string(), readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof zNotification>;
```

Di `shared/src/api.ts`, dalam `paths`, setelah `settings`:

```ts
  notifications: `${API}/notifications`,
```

- [x] **Step 4: resetDb bersihkan notification**

Di `server/test/factory.ts`, `resetDb()` — tambahkan ke transaksi `deleteMany` (Notification tak punya FK ke tabel lain, urutan bebas):

```ts
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
    prisma.vps.deleteMany(),
  ]);
}
```

- [x] **Step 5: Tulis test yang gagal**

`server/test/notifications.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { zNotification } from "@hanoman/shared";

describe("Notification model", () => {
  beforeEach(async () => { await resetDb(); });

  it("membuat & membaca satu notifikasi; bentuknya lolos zNotification", async () => {
    await prisma.notification.create({ data: { specId: "SPEC-1", title: "judul", projectId: "p1" } });
    const row = await prisma.notification.findUniqueOrThrow({ where: { specId: "SPEC-1" } });
    // Fastify menserialisasi Date → ISO string; tiru untuk memvalidasi kontrak shared.
    const wire = { ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
    expect(zNotification.safeParse(wire).success).toBe(true);
  });

  it("specId unik: create kedua untuk spec yang sama melempar P2002", async () => {
    await prisma.notification.create({ data: { specId: "SPEC-2", title: "a", projectId: null } });
    await expect(prisma.notification.create({ data: { specId: "SPEC-2", title: "b", projectId: null } }))
      .rejects.toMatchObject({ code: "P2002" });
  });
});
```

- [x] **Step 6: Jalankan, pastikan lulus**

Run: `env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman pnpm --filter ./server exec vitest run notifications.test`
Expected: 2 PASS. (vitest menurunkan `hanoman_test` dari DATABASE_URL.)

- [x] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations shared/src/entities.ts shared/src/api.ts server/test/factory.ts server/test/notifications.test.ts
git commit -m "feat(server): model Notification + migration + tipe shared (SPEC-180)"
```

---

### Task 2: `recordCompletion` + pasang di kedua jalur persist stage

**Files:**
- Create: `server/src/services/notifications.ts`
- Modify: `server/src/routes/terminal.ts` (`advanceStage`)
- Modify: `server/src/routes/specs.ts` (write-through GET /specs)
- Test: `server/test/notifications.test.ts` (idempotensi), `server/test/terminal.route.test.ts` (integrasi done → notif)

**Interfaces:**
- Consumes: `prisma`, `stageForRun` (sudah ada).
- Produces: `recordCompletion(specId: string, title: string, projectId: string | null): Promise<void>` — insert notif, abaikan duplikat (P2002).

- [x] **Step 1: Tulis test yang gagal (idempotensi service)**

Tambah ke `server/test/notifications.test.ts`:

```ts
import { recordCompletion } from "../src/services/notifications";

describe("recordCompletion", () => {
  beforeEach(async () => { await resetDb(); });

  it("idempoten: dua panggilan untuk spec yang sama → satu baris", async () => {
    await recordCompletion("SPEC-3", "judul", "p1");
    await recordCompletion("SPEC-3", "judul", "p1");
    expect(await prisma.notification.count({ where: { specId: "SPEC-3" } })).toBe(1);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman pnpm --filter ./server exec vitest run notifications.test`
Expected: FAIL — `recordCompletion` belum ada (module not found).

- [x] **Step 3: Implementasi service**

`server/src/services/notifications.ts`:

```ts
import { prisma } from "../db";

// SPEC-180 · dipanggil tepat saat stage backlog masuk `done`. specId @unique membuat ini
// idempoten: poll write-through 3s dan advanceStage yang balapan hanya menyisakan satu baris —
// insert kedua kena P2002 dan diabaikan.
// ponytail: reopen backlog (SPEC-167/172) lalu selesai lagi TIDAK menotifikasi ulang karena
// barisnya sudah ada. Upgrade bila perlu: drop @unique + guard transisi via updateMany count.
export async function recordCompletion(specId: string, title: string, projectId: string | null): Promise<void> {
  await prisma.notification.create({ data: { specId, title, projectId } }).catch(() => { /* P2002: sudah ada */ });
}
```

- [x] **Step 4: Pasang di `advanceStage` (terminal.ts)**

Di `server/src/routes/terminal.ts`: import service dan catat saat next `done`. Ganti fungsi `advanceStage`:

```ts
import { recordCompletion } from "../services/notifications";
```

```ts
async function advanceStage(
  specId: string, repoDir: string, sessionId: string, flow: Flow, worktree: string,
): Promise<void> {
  const next = stageForRun(readPhases(phaseFilePath(repoDir, sessionId), flow), worktree, specId);
  if (!next) return;
  const spec = await prisma.spec.findUnique({ where: { id: specId }, select: { stage: true, title: true, projectId: true } });
  if (!spec || STAGES.indexOf(next) <= STAGES.indexOf(spec.stage as Stage)) return;
  await prisma.spec.update({ where: { id: specId }, data: { stage: next } });
  // SPEC-180 · transisi masuk `done` (guard di atas menjamin stage lama < done).
  if (next === "done") await recordCompletion(specId, spec.title, spec.projectId);
}
```

- [x] **Step 5: Pasang di write-through (specs.ts)**

Di `server/src/routes/specs.ts`, `GET /specs`: setelah `advanced.push`, catat done. Ubah blok `map` + persist agar notifikasi dibuat untuk entry yang masuk `done`:

```ts
import { recordCompletion } from "../services/notifications";
```

Ganti bagian dalam `.map((s) => { ... })` dan blok persist:

```ts
    const doneNow: { specId: string; title: string; projectId: string | null }[] = [];
    const out = specs.map((s) => {
      const entry = live.get(s.id);
      if (!entry) return s;
      const next = stageForRun(entry.phases, entry.cwd, s.id);
      if (!next || STAGES.indexOf(next) <= STAGES.indexOf(s.stage as Stage)) return s;
      advanced.push({ id: s.id, stage: next });
      if (next === "done") doneNow.push({ specId: s.id, title: s.title, projectId: s.projectId });
      return { ...s, stage: next };
    });
    if (advanced.length)
      await Promise.all(advanced.map((a) =>
        prisma.spec.update({ where: { id: a.id }, data: { stage: a.stage } }).catch(() => { })));
    // SPEC-180 · notif dibuat sesudah persist stage; recordCompletion idempoten (specId unik).
    await Promise.all(doneNow.map((d) => recordCompletion(d.specId, d.title, d.projectId)));
    return out;
```

- [x] **Step 6: Tulis test integrasi (done → notif) di terminal.route.test.ts**

Di `server/test/terminal.route.test.ts`, di dalam `describe` SPEC-173, extend kasus "DELETE mencapai done" (baris ~251) — tambahkan assert notif, dan tambah satu test write-through done. Sesudah test "DELETE mencapai done saat semua kotak plan sudah - [x]", tambahkan:

```ts
  it("DELETE yang mencapai done membuat satu notifikasi", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-914", projectId: "p1", stage: "planned", title: "Judul 914" });
    await start("SPEC-914");
    writePlan("spec-914", "- [x] a\n");
    appendFileSync(phaseFilePath(repoDir, "spec-914"), "Execute done\n");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-914" });
    const notif = await prisma.notification.findUnique({ where: { specId: "SPEC-914" } });
    expect(notif?.title).toBe("Judul 914");
  });
```

Pastikan `prisma` sudah di-import di file test (dipakai oleh test SPEC-173 yang ada — `import { prisma } from "../src/db"`).

- [x] **Step 7: Jalankan, pastikan lulus**

Run: `env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman pnpm --filter ./server exec vitest run notifications.test terminal.route`
Expected: notifications 3 PASS; terminal.route semua PASS termasuk kasus notif baru.

- [x] **Step 8: Commit**

```bash
git add server/src/services/notifications.ts server/src/routes/terminal.ts server/src/routes/specs.ts server/test/notifications.test.ts server/test/terminal.route.test.ts
git commit -m "feat(server): catat notifikasi saat backlog masuk done (SPEC-180)"
```

---

### Task 3: Rute `GET/POST read/DELETE /notifications`

**Files:**
- Create: `server/src/routes/notifications.ts`
- Modify: `server/src/app.ts` (register)
- Test: `server/test/notifications.route.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces (semua di belakang auth):
  - `GET /api/notifications` → `{ items: Notification[]; unread: number }` (≤50, `createdAt desc`).
  - `POST /api/notifications/read` → 204; set `readAt=now()` untuk semua `readAt: null`.
  - `DELETE /api/notifications` → 204; hapus semua.

- [x] **Step 1: Tulis test yang gagal**

`server/test/notifications.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => {
  await resetDb();
  await prisma.notification.create({ data: { specId: "SPEC-1", title: "satu", projectId: "p1" } });
  await prisma.notification.create({ data: { specId: "SPEC-2", title: "dua", projectId: "p1" } });
});

describe("notifications routes", () => {
  it("GET mengembalikan items terbaru dulu + hitungan unread", async () => {
    const res = await app.inject({ url: "/api/notifications" });
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.unread).toBe(2);
    // terbaru dulu: SPEC-2 dibuat setelah SPEC-1
    expect(body.items[0].specId).toBe("SPEC-2");
  });

  it("POST /read menandai semua terbaca → unread 0", async () => {
    expect((await app.inject({ method: "POST", url: "/api/notifications/read" })).statusCode).toBe(204);
    const res = await app.inject({ url: "/api/notifications" });
    expect(res.json().unread).toBe(0);
  });

  it("DELETE mengosongkan daftar", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/notifications" })).statusCode).toBe(204);
    const res = await app.inject({ url: "/api/notifications" });
    expect(res.json().items).toHaveLength(0);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman pnpm --filter ./server exec vitest run notifications.route`
Expected: FAIL — 404 (rute belum terdaftar).

- [x] **Step 3: Implementasi rute**

`server/src/routes/notifications.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";

// SPEC-180 · daftar notifikasi backlog selesai. Read-state global (satu readAt per baris),
// bukan per-user: workspace single-team. Rute di belakang gate auth (app.ts).
export default async function (app: FastifyInstance) {
  app.get("/notifications", async () => {
    const items = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    const unread = await prisma.notification.count({ where: { readAt: null } });
    return { items, unread };
  });
  app.post("/notifications/read", async (_req, reply) => {
    await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    return reply.code(204).send();
  });
  app.delete("/notifications", async (_req, reply) => {
    await prisma.notification.deleteMany({});
    return reply.code(204).send();
  });
}
```

- [x] **Step 4: Register di app.ts**

Di `server/src/app.ts`: import + register di scope `/api` (setelah `specs`):

```ts
import notifications from "./routes/notifications";
```
```ts
    await api.register(specs);
    await api.register(notifications);
```

- [x] **Step 5: Jalankan, pastikan lulus**

Run: `env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman pnpm --filter ./server exec vitest run notifications.route`
Expected: 3 PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/notifications.ts server/src/app.ts server/test/notifications.route.test.ts
git commit -m "feat(server): rute GET/POST read/DELETE notifications (SPEC-180)"
```

---

### Task 4: Aset sound WAV + `playNotifySound`

**Files:**
- Create: `scripts/gen-notify-sounds.mjs`
- Create: `src/public/sounds/notify-short.wav`, `notify-medium.wav`, `notify-long.wav` (dibangkitkan)
- Create: `src/src/notifications/sound.ts`

**Interfaces:**
- Produces: `type NotifySound = "off" | "short" | "medium" | "long"`; `playNotifySound(kind: NotifySound): void` — memutar `/sounds/notify-<kind>.wav`, no-op saat `"off"`, di-catch (autoplay bisa diblokir).

- [x] **Step 1: Skrip pembangkit WAV**

`scripts/gen-notify-sounds.mjs`:

```js
// SPEC-180 · membangkitkan 3 nada notifikasi (short/medium/long) sebagai WAV PCM 16-bit mono.
// Deterministik, in-repo — memenuhi pilihan "file audio bundled" tanpa mengunduh aset.
// Jalankan sekali: `node scripts/gen-notify-sounds.mjs`. Aman diulang (menimpa).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 22050;
function synth(segments) { // segments: [{ freq, dur }]
  const out = [];
  for (const { freq, dur } of segments) {
    const n = Math.floor(SR * dur);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.008, (dur - t) / 0.008); // attack/release 8ms → tanpa klik
      out.push(Math.sin(2 * Math.PI * freq * t) * env * 0.6);
    }
  }
  return out;
}
function wav(floats) {
  const data = Buffer.alloc(floats.length * 2);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    data.writeInt16LE((s * 32767) | 0, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const TONES = {
  "notify-short":  [{ freq: 880, dur: 0.15 }],
  "notify-medium": [{ freq: 660, dur: 0.18 }, { freq: 988, dur: 0.20 }],
  "notify-long":   [{ freq: 523.25, dur: 0.26 }, { freq: 659.25, dur: 0.26 }, { freq: 783.99, dur: 0.32 }],
};
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/public/sounds");
mkdirSync(dir, { recursive: true });
for (const [name, segs] of Object.entries(TONES)) {
  const buf = wav(synth(segs));
  if (buf.length <= 44) throw new Error(`wav ${name} kosong`);
  writeFileSync(resolve(dir, `${name}.wav`), buf);
  console.log(`wrote ${name}.wav (${buf.length} bytes)`);
}
```

- [x] **Step 2: Bangkitkan file**

Run: `node scripts/gen-notify-sounds.mjs`
Expected: 3 baris `wrote notify-*.wav (... bytes)`; file ada di `src/public/sounds/`.
Verify: `ls -l src/public/sounds/` menampilkan 3 `.wav` non-kosong.

- [x] **Step 3: Util pemutar**

`src/src/notifications/sound.ts`:

```ts
// SPEC-180 · nada notifikasi backlog selesai. Aset di src/public/sounds (Vite serve di root).
export type NotifySound = "off" | "short" | "medium" | "long";

export function playNotifySound(kind: NotifySound): void {
  if (kind === "off") return;
  try {
    // Autoplay bisa diblokir sebelum ada interaksi user; abaikan penolakannya.
    void new Audio(`/sounds/notify-${kind}.wav`).play().catch(() => { });
  } catch { /* lingkungan tanpa Audio (mis. test node) */ }
}
```

- [x] **Step 4: Commit**

```bash
git add scripts/gen-notify-sounds.mjs src/public/sounds src/src/notifications/sound.ts
git commit -m "feat(app): aset & util sound notifikasi (short/medium/long) (SPEC-180)"
```

---

### Task 5: API client + `NotificationsProvider` + helper `newSince`

**Files:**
- Modify: `src/src/api/client.ts`
- Create: `src/src/notifications/NotificationsContext.tsx`
- Test: `src/test/notifications-context.test.tsx`

**Interfaces:**
- Consumes: `api` client, `type Notification` (shared), `playNotifySound`/`NotifySound` (Task 4), `ShowToast` (ds, type-only), `type Setting` (shared).
- Produces:
  - `api.listNotifications()`, `api.markNotificationsRead()`, `api.clearNotifications()`.
  - `newSince(items: Notification[], baseline: string): Notification[]` — item dengan `createdAt > baseline` (ISO string comparable).
  - `maxAt(items: Notification[]): string` — `createdAt` terbesar, `""` bila kosong.
  - `<NotificationsProvider showToast={fn}>` + `useNotifications(): { items, unread, markAllRead(), clear() }`.

- [x] **Step 1: Metode api client**

Di `src/src/api/client.ts`: tambahkan tipe respons + metode. Import `Notification`:

```ts
import { paths, type ProjectView, type Spec, type Setting, type Notification, type VpsView, type VpsCheck, type AuthStatus, type UserView } from "@hanoman/shared";
```
Di dalam objek `api`, setelah `putSettings`:

```ts
  listNotifications: () => j<{ items: Notification[]; unread: number }>(paths.notifications),
  markNotificationsRead: () => j<void>(paths.notifications + "/read", { method: "POST" }),
  clearNotifications: () => j<void>(paths.notifications, { method: "DELETE" }),
```

- [x] **Step 2: Tulis test yang gagal (helper + gating)**

`src/test/notifications-context.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { newSince, maxAt } from "../src/notifications/NotificationsContext";

const n = (specId: string, createdAt: string) =>
  ({ id: specId, specId, title: specId, projectId: null, createdAt, readAt: null });

describe("newSince / maxAt", () => {
  it("maxAt: createdAt terbesar; kosong → ''", () => {
    expect(maxAt([])).toBe("");
    expect(maxAt([n("a", "2026-07-11T01:00:00.000Z"), n("b", "2026-07-11T03:00:00.000Z")]))
      .toBe("2026-07-11T03:00:00.000Z");
  });
  it("newSince: hanya yang lebih baru dari baseline", () => {
    const items = [n("a", "2026-07-11T01:00:00.000Z"), n("b", "2026-07-11T03:00:00.000Z")];
    expect(newSince(items, "2026-07-11T02:00:00.000Z").map((x) => x.specId)).toEqual(["b"]);
    expect(newSince(items, "2026-07-11T03:00:00.000Z")).toEqual([]);
  });
});
```

- [x] **Step 3: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run notifications-context`
Expected: FAIL — module `NotificationsContext` belum ada.

- [x] **Step 4: Implementasi provider + helper**

`src/src/notifications/NotificationsContext.tsx`:

```tsx
import React from "react";
import type { Notification, Setting } from "@hanoman/shared";
import type { ShowToast } from "../ds/kit";
import { api } from "../api/client";
import { playNotifySound, type NotifySound } from "./sound";

export function maxAt(items: Notification[]): string {
  return items.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), "");
}
export function newSince(items: Notification[], baseline: string): Notification[] {
  return items.filter((n) => n.createdAt > baseline);
}

type Ctx = { items: Notification[]; unread: number; markAllRead: () => void; clear: () => void };
// Nilai default aman: komponen yang merender <Shell> tanpa provider (mis. test) tak error.
// Di-export agar test bell bisa membungkus dengan value palsu (Task 6).
export const NotificationsContext = React.createContext<Ctx>({ items: [], unread: 0, markAllRead: () => { }, clear: () => { } });
export const useNotifications = () => React.useContext(NotificationsContext);

const POLL_MS = 10_000;

export function NotificationsProvider({ showToast, children }: { showToast: ShowToast; children: React.ReactNode }) {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  // baseline = createdAt terbesar yang sudah "dilihat". undefined = belum di-seed (mount pertama
  // TIDAK men-toast riwayat lama). Ref, bukan state: tak perlu memicu render.
  const baseline = React.useRef<string | undefined>(undefined);
  const soundRef = React.useRef<NotifySound>("short");
  const enabledRef = React.useRef(true);

  const tick = React.useCallback(async () => {
    let s: Setting | null = null;
    try { s = await api.getSettings(); } catch { /* biarkan nilai lama */ }
    if (s) { enabledRef.current = s.notifyDone; soundRef.current = (s.notifySound as NotifySound); }
    let data: { items: Notification[]; unread: number };
    try { data = await api.listNotifications(); } catch { return; }
    setItems(data.items); setUnread(data.unread);
    if (baseline.current === undefined) { baseline.current = maxAt(data.items); return; } // seed, no toast
    const fresh = newSince(data.items, baseline.current);
    baseline.current = maxAt(data.items) > baseline.current ? maxAt(data.items) : baseline.current;
    if (fresh.length && enabledRef.current) {
      const latest = fresh[0]; // items terbaru dulu (server orderBy desc)
      showToast(`${latest.specId} · "${latest.title}" selesai`, "ok", "check-circle-2");
      playNotifySound(soundRef.current);
    }
  }, [showToast]);

  React.useEffect(() => {
    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => clearInterval(t);
  }, [tick]);

  const markAllRead = React.useCallback(() => {
    setUnread(0);
    api.markNotificationsRead().catch(() => { });
  }, []);
  const clear = React.useCallback(() => {
    setItems([]); setUnread(0);
    api.clearNotifications().catch(() => { });
  }, []);

  return (
    <NotificationsContext.Provider value={{ items, unread, markAllRead, clear }}>
      {children}
    </NotificationsContext.Provider>
  );
}
```

- [x] **Step 5: Jalankan, pastikan lulus**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run notifications-context`
Expected: PASS (helper `newSince`/`maxAt`).

- [x] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/notifications/NotificationsContext.tsx src/test/notifications-context.test.tsx
git commit -m "feat(app): NotificationsProvider (poll 10s, toast+sound saat baru) + api client (SPEC-180)"
```

---

### Task 6: `NotificationBell` di topbar Shell + wrap App dengan provider

**Files:**
- Create: `src/src/notifications/NotificationBell.tsx`
- Modify: `src/src/ds/shell.tsx` (render bell di topbar)
- Modify: `src/src/App.tsx` (bungkus return dengan `NotificationsProvider`)
- Test: `src/test/notification-bell.test.tsx`

**Interfaces:**
- Consumes: `useNotifications()` (Task 5), `Icon` (dari `../ds/icon` — hindari barrel `../ds` agar tak ada siklus dengan shell).
- Produces: `<NotificationBell />` — tombol lonceng + badge unread; klik → dropdown daftar + "Tandai semua dibaca" + "Bersihkan". Membuka dropdown memanggil `markAllRead()`.

- [x] **Step 1: Tulis test yang gagal**

`src/test/notification-bell.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationBell } from "../src/notifications/NotificationBell";
import { useNotifications } from "../src/notifications/NotificationsContext";

// Uji presentasi murni: bungkus bell dengan provider context palsu lewat komponen kecil.
function Harness({ unread, items }: { unread: number; items: any[] }) {
  const ctx = { items, unread, markAllRead: () => {}, clear: () => {} };
  const Ctx = (NotificationsContext as any);
  return <Ctx.Provider value={ctx}><NotificationBell /></Ctx.Provider>;
}

import { NotificationsContext } from "../src/notifications/NotificationsContext";

describe("NotificationBell", () => {
  it("menampilkan badge unread", () => {
    render(<Harness unread={3} items={[]} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("klik lonceng membuka dropdown berisi judul notifikasi", () => {
    const items = [{ id: "1", specId: "SPEC-180", title: "Notifikasi", projectId: null, createdAt: new Date().toISOString(), readAt: null }];
    render(<Harness unread={1} items={items} />);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    expect(screen.getByText(/Notifikasi/)).toBeInTheDocument();
    expect(screen.getByText("Tandai semua dibaca")).toBeInTheDocument();
  });
});
```

Catatan: `NotificationsContext` sudah di-export dari `NotificationsContext.tsx` (Task 5 Step 4).

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run notification-bell`
Expected: FAIL — `NotificationBell` belum ada.

- [x] **Step 3: Implementasi bell**

`src/src/notifications/NotificationBell.tsx`:

```tsx
import React from "react";
import { Icon } from "../ds/icon";
import { useNotifications } from "./NotificationsContext";

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "baru saja";
  const m = Math.round(s / 60); if (m < 60) return `${m}m lalu`;
  const h = Math.round(m / 60); if (h < 24) return `${h}j lalu`;
  return `${Math.round(h / 24)}h lalu`;
}

export function NotificationBell() {
  const { items, unread, markAllRead, clear } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead(); // membuka = melihat
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button aria-label="Notifikasi" onClick={toggle} style={{
        position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 34, height: 34, border: "none", background: open ? "var(--bone-200)" : "transparent",
        borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-muted)",
      }}>
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span style={{
            position: "absolute", top: 4, right: 4, minWidth: 16, height: 16, padding: "0 4px",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "var(--clay-500)", color: "#fff", fontSize: 10, fontWeight: 700,
            borderRadius: "var(--radius-pill)", fontFamily: "var(--font-mono)", lineHeight: 1,
          }}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div role="menu" style={{
          position: "absolute", top: 40, right: 0, width: 320, maxHeight: 420, overflowY: "auto",
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", zIndex: 200, padding: 6,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px 6px" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>Notifikasi</span>
            {items.length > 0 && (
              <button onClick={clear} style={{ border: "none", background: "transparent", cursor: "pointer",
                color: "var(--text-subtle)", fontSize: 12, fontFamily: "var(--font-ui)" }}>Bersihkan</button>
            )}
          </div>
          {items.length === 0 ? (
            <div style={{ padding: "18px 10px", textAlign: "center", color: "var(--text-subtle)", fontSize: 13 }}>
              Belum ada notifikasi
            </div>
          ) : items.map((n) => (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
              borderRadius: "var(--radius-sm)" }}>
              <Icon name="check-circle-2" size={16} color="var(--leaf-500)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--text-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {n.specId} · {n.title}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>selesai · {timeAgo(n.createdAt)}</div>
              </div>
              {!n.readAt && <span style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />}
            </div>
          ))}
          {items.length > 0 && (
            <button onClick={markAllRead} style={{ width: "100%", marginTop: 4, padding: "8px", border: "none",
              borderTop: "1px solid var(--border-hair)", background: "transparent", cursor: "pointer",
              color: "var(--text-muted)", fontSize: 12.5, fontFamily: "var(--font-ui)" }}>Tandai semua dibaca</button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 4: Render bell di topbar Shell**

Di `src/src/ds/shell.tsx`: import bell dan sisipkan di topbar sebelum `{actions}`. Import di atas:

```ts
import { NotificationBell } from "../notifications/NotificationBell";
```
Di topbar, ubah baris `{actions}` (setelah blok `showSearch`):

```tsx
          <NotificationBell />
          {actions}
```

(Bell mengonsumsi context; tanpa provider ia merender 0 unread — aman untuk test yang merender Shell/screen langsung.)

**Catatan test App-level:** `src/test/app-flows.test.tsx` & `app-states.test.tsx` me-mock `../src/api/client` via factory dan kini me-mount provider. `tick()` sudah di-`try/catch` sehingga `api.listNotifications` yang undefined tak crash, tapi untuk bersih (tanpa warning act()) tambahkan ke objek `api` mock mereka: `listNotifications: vi.fn(async () => ({ items: [], unread: 0 }))`. `smoke.test.tsx` tak terpengaruh (auth gagal → AuthScreen, provider tak mount). Jalankan ketiganya di Step 6.

- [x] **Step 5: Bungkus App dengan provider**

Di `src/src/App.tsx`: import provider dan bungkus `return`:

```ts
import { NotificationsProvider } from "./notifications/NotificationsContext";
```
Ubah `return ( <> ... </> )` (sekitar baris 561) menjadi:

```tsx
  return (
    <NotificationsProvider showToast={showToast}>
      {screen}
      <NewSpecModal open={modal === "brief"} onClose={() => setModal(null)} projects={projectsView} defaultProject={proj ? proj.id : ""} onCreate={createSpec} />
      <NewProjectModal open={modal === "project"} onClose={() => setModal(null)} onCreate={createProject} />
      <EditProjectModal open={modal === "project-edit"} project={proj} onClose={() => setModal(null)} onSave={updateProject} />
      <Toast toast={toast} />
    </NotificationsProvider>
  );
```

- [x] **Step 6: Jalankan, pastikan lulus**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run notification-bell notifications-context app-flows app-states smoke`
Expected: semua PASS (App-level test hijau dengan mock `listNotifications` bila ditambahkan).

- [x] **Step 7: Commit**

```bash
git add src/src/notifications/NotificationBell.tsx src/src/notifications/NotificationsContext.tsx src/src/ds/shell.tsx src/src/App.tsx src/test/notification-bell.test.tsx
git commit -m "feat(app): lonceng notifikasi di topbar + provider di root (SPEC-180)"
```

---

### Task 7: Setting `notifyDone` + `notifySound` end-to-end

**Files:**
- Modify: `shared/src/entities.ts` (`zSetting`)
- Modify: `server/src/services/settings.ts` (`DEFAULT_SETTING`)
- Modify: `src/src/screens/SettingsScreen.tsx` (`S_DEFAULTS` + kartu Sesi)
- Test: `server/test/settings.test.ts`, `src/test/settings-nav.test.tsx`

**Interfaces:**
- Produces: `Setting.notifyDone: boolean` (default `true`), `Setting.notifySound: "off"|"short"|"medium"|"long"` (default `"short"`). UI di section "Sesi": toggle + select + tombol Preview.

- [x] **Step 1: Tulis test server yang gagal**

Di `server/test/settings.test.ts`, tambahkan test bahwa default memuat field baru:

```ts
  it("default memuat notifyDone + notifySound (SPEC-180)", () => {
    expect(DEFAULT_SETTING.notifyDone).toBe(true);
    expect(DEFAULT_SETTING.notifySound).toBe("short");
  });
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman pnpm --filter ./server exec vitest run settings.test`
Expected: FAIL — field belum ada.

- [x] **Step 3: Tambah field di shared + server default**

Di `shared/src/entities.ts`, `zSetting` — tambah dua field:

```ts
export const zSetting = z.object({
  model: z.string().default("claude-opus-4-8"),
  effort: z.string().default("xhigh"),
  autoDefault: z.boolean(),
  autoScaffold: z.boolean(),
  notifyFail: z.boolean(),
  notifyDone: z.boolean().default(true),                                   // SPEC-180
  notifySound: z.enum(["off", "short", "medium", "long"]).default("short"), // SPEC-180
});
```

(Default via `.default()` menjaga baris `Setting` lama yang belum punya field ini tetap lolos `safeParse` alih-alih jatuh ke `DEFAULT_SETTING` — sama seperti `model`/`effort`.)

Di `server/src/services/settings.ts`, `DEFAULT_SETTING`:

```ts
export const DEFAULT_SETTING: Setting = {
  ...STEP,
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
};
```

- [x] **Step 4: Jalankan test server, pastikan lulus**

Run: `env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman pnpm --filter ./server exec vitest run settings.test`
Expected: PASS.

- [x] **Step 5: Frontend — S_DEFAULTS + kartu Sesi + Preview**

Di `src/src/screens/SettingsScreen.tsx`:

`S_DEFAULTS` (setelah `notifyFail: true`):
```ts
const S_DEFAULTS: Setting = {
  model: "claude-opus-4-8", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
};
```

Import util sound di atas file:
```ts
import { playNotifySound, type NotifySound } from "../notifications/sound";
```

Opsi select sound (dekat `S_MODELS`/`S_EFFORT`):
```ts
const S_SOUNDS = [
  { value: "short", label: "Short" }, { value: "medium", label: "Medium" },
  { value: "long", label: "Long" }, { value: "off", label: "Senyap" },
];
```

Ganti kartu Sesi (blok `return ( // sesi ... )`) menjadi:
```tsx
    return ( // sesi
      <Card eyebrow="sesi" title="Sesi & notifikasi">
        <SettingRow title="Notifikasi backlog selesai"
          desc="Toast + sound saat sebuah backlog mencapai stage done. Daftar lonceng tetap terisi meski dimatikan.">
          <Switch checked={s.notifyDone} onChange={sw("notifyDone", "Notifikasi backlog selesai")} />
        </SettingRow>
        <SettingRow title="Sound notifikasi" desc="Durasi nada saat backlog selesai.">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Select size="sm" value={s.notifySound} options={S_SOUNDS} style={{ width: 130 }}
              onChange={(e) => save({ notifySound: e.target.value as NotifySound }, "Sound → " + e.target.value)} />
            <Button size="sm" variant="ghost" leftIcon="volume-2" disabled={s.notifySound === "off"}
              onClick={() => playNotifySound(s.notifySound as NotifySound)}>Preview</Button>
          </div>
        </SettingRow>
        <SettingRow title="Notifikasi saat sesi gagal" last desc="Kirim notifikasi ketika sesi Claude Code berakhir dengan error.">
          <Switch checked={s.notifyFail} onChange={sw("notifyFail", "Notifikasi gagal")} />
        </SettingRow>
      </Card>
    );
```

- [x] **Step 6: Test frontend — round-trip setting baru**

Di `src/test/settings-nav.test.tsx`: perbarui mock `getSettings` agar memuat field baru, dan tambah test bahwa toggle Sesi mem-PUT `notifyDone`. Ubah `beforeEach` mock:

```ts
  (api.getSettings as any).mockResolvedValue({ model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true, notifyDone: true, notifySound: "short" });
```

Tambah test:
```ts
  it("tab Sesi mem-PUT notifyDone saat toggle (SPEC-180)", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Sesi"));
    expect(await screen.findByText("Notifikasi backlog selesai")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("switch")[0]); // toggle pertama = notifyDone
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    const arg = (api.putSettings as any).mock.calls.at(-1)[0];
    expect(arg).toHaveProperty("notifyDone", false);
  });
```

(`Switch` ds sudah mengekspos `role="switch"` via `React.createElement`, jadi `getAllByRole("switch")[0]` valid — toggle pertama di kartu Sesi = `notifyDone`.)

- [x] **Step 7: Jalankan, pastikan lulus**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run settings-nav`
Expected: PASS (termasuk test lama yang kini ber-mock field baru).

- [x] **Step 8: Commit**

```bash
git add shared/src/entities.ts server/src/services/settings.ts src/src/screens/SettingsScreen.tsx server/test/settings.test.ts src/test/settings-nav.test.tsx
git commit -m "feat(app): setting notifyDone + notifySound (enable + pilih durasi) (SPEC-180)"
```

---

### Task 8: Verifikasi penuh + smoke API nyata + docs SoT

**Files:**
- Create: `internal/docs/adr/0030-notifikasi-backlog-selesai.md`
- Modify: `internal/docs/README.md` (index ADR)
- Modify: `internal/docs/architecture/**` (subsistem notifikasi + endpoint)
- Modify: `internal/docs/frontend/frontend-implementation.md` (lonceng, provider, settings)
- Modify: `docs/superpowers/plans/2026-07-11-notifikasi-spec-180.md` (centang task)

- [x] **Step 1: Suite penuh + typecheck**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman pnpm --filter ./server exec vitest run
env -u NODE_ENV pnpm --filter ./src exec vitest run
env -u NODE_ENV pnpm --filter ./shared exec vitest run
pnpm --filter ./server exec tsc --noEmit && pnpm --filter ./src exec tsc --noEmit && pnpm --filter ./shared exec tsc --noEmit
```
Expected: semua hijau, exit 0.

- [x] **Step 2: Smoke API nyata — notifikasi ujung ke ujung**

Boot server terhadap DB throwaway yang termigrasi (jangan hanoman_test — sibling test bisa men-truncate-nya di tengah smoke), lalu buktikan siklusnya. Contoh (sesuaikan bila perlu):

```bash
# DB smoke sekali pakai
SMOKE_DB=postgresql://hanoman:hanoman@localhost:5432/hanoman_smoke180
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c "DROP DATABASE IF EXISTS hanoman_smoke180; CREATE DATABASE hanoman_smoke180;"
DATABASE_URL=$SMOKE_DB pnpm --filter ./server exec prisma migrate deploy
# boot (requireAuth default; smoke pakai buildApp requireAuth:false via skrip node kecil, atau server.ts + login)
```
Skrip smoke node (scratchpad) memakai `buildApp({requireAuth:false})` + `app.inject`:
1. `makeProject` + `makeSpec` stage `executing`, sesi hidup dengan plan tercentang + `Execute done` → `GET /api/specs` men-derive `done` (write-through) → `GET /api/notifications` memuat 1 item, `unread=1`.
2. `POST /api/notifications/read` → `GET` `unread=0`.
3. `DELETE /api/notifications` → `GET` `items=[]`.

Expected: ketiga assert lulus. (Alternatif lebih ringan bila tmux tak tersedia di lingkungan smoke: panggil `recordCompletion` langsung lalu uji ketiga rute — tetap membuktikan rute + siklus baca/hapus.)

- [x] **Step 3: Smoke UI (opsional) — diganti build nyata**

Smoke browser headless dilewati (rapuh; app tanpa URL routing, POST /terminal/sessions men-spawn claude nyata). Sebagai gantinya: `vite build` sukses (1563 modul, `dist/sounds/notify-{short,medium,long}.wav` ter-ship) + unit test bell/provider/settings hijau membuktikan komponen + aset ter-bundle & merender.

Boot `pnpm --filter ./src dev` + server; login; picu satu penyelesaian; pastikan badge lonceng bertambah, dropdown memuat item, toast muncul, sound terputar (sekali interaksi user lebih dulu agar autoplay tak diblokir). Bila lingkungan headless, lewati dan andalkan Step 2 + unit test.

- [x] **Step 4: Tulis ADR-0030**

`internal/docs/adr/0030-notifikasi-backlog-selesai.md` — Context (awareness backlog selesai minim), Decision (model `Notification` `specId @unique`; dibuat server-side di dua titik persist saat transisi `done`; read-state global; poll 10s + toast/sound client; setting `notifyDone`/`notifySound` menumpang blob `Setting`), Consequences (idempoten; reopen tak re-notify — ceiling; tanpa push tab-tertutup). Status accepted, Date 2026-07-11, Spec SPEC-180.

- [x] **Step 5: Perbarui docs teknis + index**

- `internal/docs/README.md`: tambahkan baris index ADR-0030.
- `internal/docs/architecture/**`: catat subsistem notifikasi (model, endpoint, jalur pembuatan) di file arsitektur yang relevan.
- `internal/docs/frontend/frontend-implementation.md`: catat `NotificationsProvider`, `NotificationBell` di topbar, setting notifikasi, aset sound.

- [x] **Step 6: Centang semua task di plan + commit docs**

Pastikan tiap `- [ ]` di plan ini sudah `- [x]`. Commit:
```bash
git add internal/docs docs/superpowers/plans/2026-07-11-notifikasi-spec-180.md
git commit -m "docs(spec-180): ADR-0030 + arsitektur + frontend impl + centang plan (SPEC-180)"
```

---

## Catatan verifikasi lintas-task

- Server test SELALU dengan DB terisolasi: `env -u NODE_ENV DATABASE_URL=…/hanoman pnpm --filter ./server exec vitest run` (shell sesi bisa menunjuk prod; vitest menurunkan `_test`). DB test butuh `migrate deploy` sekali (Task 1 Step 2).
- Frontend test jsdom: `env -u NODE_ENV pnpm --filter ./src exec vitest run`.
- Worktree ini mungkin belum `pnpm install` / `prisma generate` — bila `@prisma/client` atau `prisma.notification` tak resolve, jalankan `pnpm install` di root lalu `pnpm --filter ./server exec prisma generate`.
