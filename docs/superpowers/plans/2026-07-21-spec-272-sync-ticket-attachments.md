# Sync Lampiran Tiket (Hub → Local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat lampiran tiket Help Center ikut tersync dari hub ke local — metadata lewat change-feed, byte biner ditarik lazy saat pertama dibuka.

**Architecture:** `TicketAttachment` menjadi entity SYNCED (metadata saja). Hub mengekspos endpoint biner ber-device-token; local menarik byte on-demand lewat fetch-through lalu meng-cache-nya ke upload dir. Menghormati semangat ADR-0066 (biner tak masuk `SyncLog`).

**Tech Stack:** Fastify + TypeScript (server), Prisma 6 + Postgres, Vitest. Sync engine `server/src/services/sync.ts`.

## Global Constraints

- TypeScript strict; test untuk setiap logika orchestrasi/sync.
- Skema hanya berubah lewat migration hand-written + `migrate deploy` per DB (bukan `migrate dev` — mereset saat drift sibling worktree). Additive, aman untuk VPS live.
- Perbarui docs SoT `internal/docs/**` yang tersentuh dalam commit yang sama + tautkan di `internal/docs/README.md`.
- ADR baru: **ADR-0068**. SPEC: **SPEC-272**.
- Jalankan server test terhadap base DB unik agar tak ditruncate sibling: `DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272` → vitest menurunkan `hanoman272_test`. Selalu `env -u NODE_ENV` (shell menunjuk prod).
- Setelah tiap task: centang checklist + smoke API nyata di local (bukan cuma unit test).

## File Structure

- `server/prisma/schema.prisma` — tambah `version` + `updatedAt` pada `TicketAttachment`.
- `server/prisma/migrations/2026072103_spec272_ticket_attachment_sync/migration.sql` — migration additive.
- `server/src/services/sync.ts` — daftarkan `ticketAttachment` di `SYNCED`/`DELEGATE`/`FIELDS`/`DATE_FIELDS`.
- `server/src/routes/sync.ts` — endpoint biner hub `GET /sync/attachments/:storageKey`.
- `server/src/services/uploads.ts` — `readUploadOrFetch()` (fetch-through + cache).
- `server/src/routes/tickets.ts` — route serve lampiran pakai `readUploadOrFetch`.
- `server/src/routes/help.ts` — publish tiap lampiran baru ke feed (`notifySynced`).
- Test: `server/test/sync-exclusions.test.ts`, `server/test/sync.service.test.ts`, `server/test/sync.route.test.ts`, `server/src/services/uploads.test.ts`, `server/test/tickets.test.ts`.
- Docs: `internal/docs/adr/0068-*.md` + data-model/api-contract/architecture + `internal/docs/README.md`.

---

### Task 1: Skema + migration (kolom `version` & `updatedAt` pada `TicketAttachment`)

**Files:**
- Modify: `server/prisma/schema.prisma` (model `TicketAttachment`, sekitar baris 312-324)
- Create: `server/prisma/migrations/2026072103_spec272_ticket_attachment_sync/migration.sql`

**Interfaces:**
- Produces: kolom `TicketAttachment.version: Int (default 0)` dan `TicketAttachment.updatedAt: DateTime (@updatedAt)`. Prisma client meng-expose `prisma.ticketAttachment` dengan kedua field ini.

- [x] **Step 1: Tambah kolom di schema.prisma**

Di model `TicketAttachment`, setelah baris `ticket Ticket @relation(...)`, tambahkan:

```prisma
model TicketAttachment {
  id         String   @id @default(cuid())
  ticketId   String
  projectId  String   // denormal — isolasi & query murah (pola ErrorEvent.projectId)
  filename   String   // nama asli tersanitasi (display saja)
  mimeType   String   // image/png | image/jpeg | image/webp
  size       Int
  storageKey String   // nama berkas opaque di upload dir (uuid+ext)
  createdAt  DateTime @default(now())
  version    Int      @default(0) // SPEC-272 · version-stamp sync (ADR-0068)
  updatedAt  DateTime @updatedAt  // SPEC-272 · jam LWW (lampiran immutable → praktis konstan)
  ticket     Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  @@index([ticketId])
}
```

- [x] **Step 2: Tulis migration.sql**

Buat file `server/prisma/migrations/2026072103_spec272_ticket_attachment_sync/migration.sql`:

```sql
-- SPEC-272 · ADR-0068 · lampiran tiket masuk record-sync (metadata; biner lazy-fetch)
ALTER TABLE "TicketAttachment" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TicketAttachment" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
```

- [x] **Step 3: Terapkan migration ke DB dev + generate client**

Run:
```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman \
  pnpm --filter ./server exec prisma migrate deploy
env -u NODE_ENV pnpm --filter ./server exec prisma generate
```
Expected: "Applying migration `2026072103_spec272_ticket_attachment_sync`" lalu "Generated Prisma Client".

- [x] **Step 4: Terapkan migration ke DB test (base unik hanoman272_test)**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272_test \
  pnpm --filter ./server exec prisma migrate deploy
```
Expected: semua migration ter-apply (DB baru), exit 0. (Jika DB belum ada, buat dulu: `docker exec hanoman-db-1 createdb -U hanoman hanoman272_test` atau biarkan `migrate deploy` gagal → buat lalu ulangi.)

- [x] **Step 5: Verifikasi kolom ada**

Run:
```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -tAc "\d \"TicketAttachment\"" | grep -E "version|updatedAt"
```
Expected: dua baris menampilkan `version` dan `updatedAt`.

- [x] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/2026072103_spec272_ticket_attachment_sync/migration.sql
git commit -m "feat(spec-272): kolom version+updatedAt TicketAttachment (migration additive)"
```

---

### Task 2: Daftarkan `ticketAttachment` sebagai entity SYNCED

**Files:**
- Modify: `server/src/services/sync.ts` (SYNCED baris 8; DELEGATE ~16-24; FIELDS ~28-40; DATE_FIELDS ~42-46)
- Modify: `server/test/sync-exclusions.test.ts` (assertion daftar SYNCED)
- Modify: `server/test/sync.service.test.ts` (roundtrip metadata + clean)

**Interfaces:**
- Consumes: kolom `version`/`updatedAt` dari Task 1.
- Produces: `SYNCED` memuat `"ticketAttachment"`; `applyPush`/`pull`/`snapshot`/`backfillFeed` bekerja untuk entity ini. `FIELDS.ticketAttachment = ["ticketId","projectId","filename","mimeType","size","storageKey","createdAt","updatedAt"]`.

- [x] **Step 1: Update assertion di sync-exclusions.test.ts (failing test)**

Ganti assertion daftar SYNCED (sekitar baris 22-24) menjadi:

```ts
  it("SYNCED is exactly the authoritative entities (SPEC-272: +ticketAttachment)", () => {
    expect([...SYNCED].sort()).toEqual(
      ["errorGroup", "project", "sessionResult", "spec", "ticket", "ticketAttachment", "vps"],
    );
  });
```

- [x] **Step 2: Jalankan test → gagal**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run test/sync-exclusions.test.ts
```
Expected: FAIL — SYNCED belum memuat `ticketAttachment`.

- [x] **Step 3: Tambah ticketAttachment ke sync.ts**

Di `server/src/services/sync.ts`:

`SYNCED` (baris 8):
```ts
export const SYNCED = ["project", "spec", "vps", "sessionResult", "errorGroup", "ticket", "ticketAttachment"] as const;
```

`DELEGATE` (tambah entri terakhir sebelum `}`):
```ts
  ticketAttachment: prisma.ticketAttachment as unknown as Delegate,
```

`FIELDS` (tambah entri, biner `storageKey` sebagai pointer opaque — bukan isi file):
```ts
  // SPEC-272 · ADR-0068 · metadata lampiran (byte tak disync; ditarik lazy dari hub saat dibuka).
  ticketAttachment: ["ticketId", "projectId", "filename", "mimeType", "size", "storageKey", "createdAt", "updatedAt"],
```

`DATE_FIELDS` (tambah entri):
```ts
  ticketAttachment: ["createdAt", "updatedAt"],
```

- [x] **Step 4: Jalankan exclusions test → lulus**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run test/sync-exclusions.test.ts
```
Expected: PASS.

- [x] **Step 5: Tulis roundtrip metadata test (failing) di sync.service.test.ts**

Tambah `ticketAttachment` ke `clean()` (baris sebelum `prisma.ticket.deleteMany()`):
```ts
  await prisma.ticketAttachment.deleteMany();
```

Tambah test baru di dalam `describe`:
```ts
  it("ticketAttachment metadata roundtrip: push→pull membawa metadata, bukan byte (SPEC-272)", async () => {
    await project();
    await applyPush("ticket", "TCK-1", 0, {
      projectId: "p1", number: 1, category: "bug", title: "t", detail: "d",
      reporterEmail: "r@e.co", status: "new", accessKeyHash: "h", specId: null,
    });
    const r = await applyPush("ticketAttachment", "ATT-1", 0, {
      ticketId: "TCK-1", projectId: "p1", filename: "shot.png",
      mimeType: "image/png", size: 42, storageKey: "uuid-abc.png",
    });
    expect(r).toMatchObject({ ok: true, version: 1 });
    const snap = await snapshot("ticketAttachment", "ATT-1");
    expect(snap?.data).toMatchObject({ filename: "shot.png", storageKey: "uuid-abc.png", size: 42 });
    // metadata di feed, tak ada field byte/isi biner
    expect(Object.keys(snap!.data)).not.toContain("data");
    const feed = await pull("0");
    expect(feed.records.map((x) => x.recordId)).toContain("ATT-1");
  });
```

- [x] **Step 6: Jalankan → gagal lalu (dengan Step 3 sudah ada) lulus**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run test/sync.service.test.ts
```
Expected: PASS (implementasi Step 3 sudah menopang roundtrip).

- [x] **Step 7: Commit**

```bash
git add server/src/services/sync.ts server/test/sync-exclusions.test.ts server/test/sync.service.test.ts
git commit -m "feat(spec-272): ticketAttachment jadi entity SYNCED (metadata roundtrip)"
```

---

### Task 3: Endpoint biner di hub — `GET /sync/attachments/:storageKey`

**Files:**
- Modify: `server/src/routes/sync.ts` (tambah import `readUpload`; tambah route setelah `/sync/pull`)
- Modify: `server/test/sync.route.test.ts` (test guard + serve)

**Interfaces:**
- Consumes: `requireDeviceToken` preHandler (sudah ada), `readUpload` dari `../services/uploads`.
- Produces: `GET /api/sync/attachments/:storageKey` → 200 byte (content-type mime) untuk storageKey milik `TicketAttachment`; 404 bila tak dikenal/hilang; 401 tanpa device token.

- [x] **Step 1: Tulis test (failing) di sync.route.test.ts**

Tambah import di atas:
```ts
import { saveUpload } from "../src/services/uploads";
```
Tambah `prisma.ticketAttachment.deleteMany()` di awal `clean()`. Tambah test:
```ts
  it("GET /sync/attachments/:key — 401 tanpa token, 404 key asing, 200 byte untuk lampiran nyata (SPEC-272)", async () => {
    const { auth } = await tokenFor();
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    // 401 tanpa Bearer
    expect((await app.inject({ method: "GET", url: "/api/sync/attachments/x.png" })).statusCode).toBe(401);
    // 404 key asing
    expect((await app.inject({ method: "GET", url: "/api/sync/attachments/tidak-ada.png", headers: auth })).statusCode).toBe(404);
    // siapkan tiket + lampiran nyata
    const t = await prisma.ticket.create({ data: { id: "TCK-1", projectId: "p1", number: 1, category: "bug", title: "t", detail: "d", reporterEmail: "r@e.co", status: "new", accessKeyHash: "h" } });
    const { storageKey, size } = await saveUpload(Buffer.from("PNGBYTES"), "image/png");
    await prisma.ticketAttachment.create({ data: { ticketId: t.id, projectId: "p1", filename: "s.png", mimeType: "image/png", size, storageKey } });
    const ok = await app.inject({ method: "GET", url: `/api/sync/attachments/${storageKey}`, headers: auth });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("image/png");
    expect(ok.rawPayload.equals(Buffer.from("PNGBYTES"))).toBe(true);
  });
```

- [x] **Step 2: Jalankan → gagal**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run test/sync.route.test.ts
```
Expected: FAIL — route belum ada (404 untuk case 200).

- [x] **Step 3: Tambah route di sync.ts**

Tambah import di atas (setelah import lain):
```ts
import { readUpload } from "../services/uploads";
```
Tambah route tepat setelah handler `/sync/pull`:
```ts
  // SPEC-272 · ADR-0068 · byte lampiran untuk fetch-through client (device-token, bukan cookie).
  // Divalidasi milik TicketAttachment → cegah baca file arbitrer di upload dir.
  app.get("/sync/attachments/:storageKey", { preHandler: requireDeviceToken }, async (req, reply) => {
    const { storageKey } = req.params as { storageKey: string };
    const a = await prisma.ticketAttachment.findFirst({ where: { storageKey } });
    if (!a) return reply.code(404).send({ error: "not found" });
    const buf = await readUpload(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", a.mimeType);
    return reply.send(buf);
  });
```

- [x] **Step 4: Jalankan → lulus**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run test/sync.route.test.ts
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/sync.ts server/test/sync.route.test.ts
git commit -m "feat(spec-272): endpoint biner hub /sync/attachments/:key (device-token)"
```

---

### Task 4: Lazy fetch-through — `readUploadOrFetch` di uploads.ts

**Files:**
- Modify: `server/src/services/uploads.ts` (tambah `readUploadOrFetch`)
- Modify: `server/src/services/uploads.test.ts` (test hit lokal, miss tanpa config, miss dengan fetch)

**Interfaces:**
- Consumes: `effectiveStr("SYNC_SERVER_URL")`, `effectiveStr("SYNC_DEVICE_TOKEN")` dari `../config`; endpoint Task 3.
- Produces: `readUploadOrFetch(storageKey: string): Promise<Buffer>` — baca lokal; bila ENOENT & client sync → tarik dari hub, cache ke upload dir, kembalikan buffer; else throw.

- [x] **Step 1: Tulis test (failing) di uploads.test.ts**

Tambah import:
```ts
import { saveUpload, readUpload, deleteUpload, extFor, readUploadOrFetch } from "./uploads";
import { vi } from "vitest";
```
Tambah test di dalam `describe("uploads")`:
```ts
  it("readUploadOrFetch: hit lokal mengembalikan file tanpa fetch", async () => {
    const { storageKey } = await saveUpload(Buffer.from("LOCAL"), "image/png");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await readUploadOrFetch(storageKey)).equals(Buffer.from("LOCAL"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await deleteUpload(storageKey);
  });

  it("readUploadOrFetch: miss tanpa SYNC_SERVER_URL → throw", async () => {
    delete process.env.SYNC_SERVER_URL; delete process.env.SYNC_DEVICE_TOKEN;
    await expect(readUploadOrFetch("hilang.png")).rejects.toThrow();
  });

  it("readUploadOrFetch: miss + client sync → tarik dari hub lalu cache", async () => {
    process.env.SYNC_SERVER_URL = "https://hub.example";
    process.env.SYNC_DEVICE_TOKEN = "tok";
    const key = "fetched-abc.png";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from("REMOTE"), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const buf = await readUploadOrFetch(key);
    expect(buf.equals(Buffer.from("REMOTE"))).toBe(true);
    // dipanggil ke endpoint hub dengan Bearer
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://hub.example/api/sync/attachments/fetched-abc.png");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer tok" });
    // ter-cache: baca kedua tak fetch lagi
    fetchSpy.mockClear();
    expect((await readUploadOrFetch(key)).equals(Buffer.from("REMOTE"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await deleteUpload(key);
    delete process.env.SYNC_SERVER_URL; delete process.env.SYNC_DEVICE_TOKEN;
  });
```

- [x] **Step 2: Jalankan → gagal**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run src/services/uploads.test.ts
```
Expected: FAIL — `readUploadOrFetch` belum diekspor.

- [x] **Step 3: Implementasi readUploadOrFetch**

Di `server/src/services/uploads.ts`, tambah setelah `readUpload`:
```ts
// SPEC-272 · ADR-0068 · fetch-through lampiran: baca lokal; bila absen & instance ini CLIENT sync
// (SYNC_SERVER_URL+SYNC_DEVICE_TOKEN), tarik byte dari hub lalu cache ke upload dir. Di hub
// (SYNC_SERVER_URL kosong) tak ada fetch → perilaku sama seperti readUpload.
export async function readUploadOrFetch(storageKey: string): Promise<Buffer> {
  const safe = storageKey.replace(/[/\\]/g, "");
  const target = join(uploadDir(), safe);
  try {
    return await readFile(target);
  } catch {
    const base = effectiveStr("SYNC_SERVER_URL");
    const token = effectiveStr("SYNC_DEVICE_TOKEN");
    if (!base || !token) throw new Error(`lampiran ${safe} tak ada lokal & bukan client sync`);
    const res = await fetch(`${base.replace(/\/$/, "")}/api/sync/attachments/${encodeURIComponent(safe)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`fetch lampiran hub gagal: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(uploadDir(), { recursive: true });
    await writeFile(target, buf); // cache lokal untuk pembukaan berikutnya
    return buf;
  }
}
```

- [x] **Step 4: Jalankan → lulus**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run src/services/uploads.test.ts
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/uploads.ts server/src/services/uploads.test.ts
git commit -m "feat(spec-272): readUploadOrFetch fetch-through byte lampiran dari hub"
```

---

### Task 5: Wire serve route + publish lampiran baru ke feed

**Files:**
- Modify: `server/src/routes/tickets.ts` (import + route serve lampiran, baris ~9 & ~51-63)
- Modify: `server/src/routes/help.ts` (publish tiap lampiran baru, baris ~74-79)
- Modify: `server/test/tickets.test.ts` (serve lokal tetap jalan)

**Interfaces:**
- Consumes: `readUploadOrFetch` (Task 4), `notifySynced` (sudah dipakai di help.ts).
- Produces: route `GET /tickets/:id/attachments/:attId` memakai fetch-through; tiap lampiran baru → `notifySynced("ticketAttachment", att.id)`.

- [x] **Step 1: Ganti import di tickets.ts**

Baris 9:
```ts
import { readUploadOrFetch, deleteUpload } from "../services/uploads";
```

- [x] **Step 2: Pakai readUploadOrFetch di route serve lampiran**

Di handler `GET /tickets/:id/attachments/:attId` ganti baris `readUpload`:
```ts
    const buf = await readUploadOrFetch(a.storageKey).catch(() => null);
```

- [x] **Step 3: Publish lampiran baru ke feed di help.ts**

Di loop upload (`for (const f of files)`), setelah `prisma.ticketAttachment.create`, tangkap hasilnya & notifikasi:
```ts
    for (const f of files) {
      const { storageKey, size } = await saveUpload(f.buf, f.mime);
      const att = await prisma.ticketAttachment.create({
        data: { ticketId: ticket.id, projectId: slug, filename: f.name.slice(0, 200), mimeType: f.mime, size, storageKey },
      });
      await notifySynced("ticketAttachment", att.id); // SPEC-272 · metadata lampiran → feed
    }
```
Pastikan `notifySynced` sudah di-import di help.ts (bila belum: `import { notifySynced } from "../services/sync-notify";`).

- [x] **Step 4: Tulis test serve lokal (failing bila regresi) di tickets.test.ts**

Tambah test di dalam `describe("SPEC-253 · triase tiket", ...)`:
```ts
  it("serve lampiran membaca byte lokal (fetch-through no-op di hub) (SPEC-272)", async () => {
    const { saveUpload } = await import("../src/services/uploads");
    const { storageKey, size } = await saveUpload(Buffer.from("IMG"), "image/png");
    const att = await prisma.ticketAttachment.create({
      data: { ticketId: tId, projectId: "tri-proj", filename: "a.png", mimeType: "image/png", size, storageKey },
    });
    const res = await app.inject({ method: "GET", url: `/api/tickets/${tId}/attachments/${att.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.rawPayload.equals(Buffer.from("IMG"))).toBe(true);
  });
```

- [x] **Step 5: Jalankan test terkait**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run test/tickets.test.ts test/help.test.ts
```
Expected: PASS (serve pakai fetch-through; di test SYNC_SERVER_URL kosong → sama seperti readUpload).

- [x] **Step 6: Commit**

```bash
git add server/src/routes/tickets.ts server/src/routes/help.ts server/test/tickets.test.ts
git commit -m "feat(spec-272): serve lampiran via fetch-through + publish lampiran baru ke feed"
```

---

### Task 6: Docs SoT + ADR-0068 + smoke API nyata

**Files:**
- Create: `internal/docs/adr/0068-lampiran-tiket-masuk-record-sync.md`
- Modify: doc data-model, api-contract, architecture/sync yang relevan (temukan via `internal/docs/README.md`)
- Modify: `internal/docs/README.md` (tautkan ADR-0068 + doc tersentuh)

**Interfaces:**
- Consumes: seluruh perubahan Task 1-5.
- Produces: SoT selaras dengan implementasi.

- [ ] **Step 1: Tulis ADR-0068**

Buat `internal/docs/adr/0068-lampiran-tiket-masuk-record-sync.md` mengikuti format ADR-0066/0067 (Konteks / Keputusan / Konsekuensi). Isi inti:
- Konteks: ADR-0066 mengecualikan `TicketAttachment` dari sync → lampiran tak terlihat di local.
- Keputusan: `ticketAttachment` jadi entity SYNCED (metadata via `SyncLog`); byte biner **tidak** masuk feed, ditarik lazy dari hub lewat `GET /api/sync/attachments/:storageKey` (device-token), di-cache lokal. Arah hub→local.
- Konsekuensi: mencabut kalimat "lampiran biner tak disync" ADR-0066; kolom `version`/`updatedAt` ditambah; delete/tombstone & dua-arah tetap di luar scope.

- [ ] **Step 2: Update doc data-model & api-contract & architecture**

- data-model: dokumentasikan kolom baru `TicketAttachment.version`/`updatedAt` + statusnya sebagai entity SYNCED.
- api-contract: tambah `GET /api/sync/attachments/:storageKey` (device-token, 200 byte/401/404) + catatan serve lampiran local kini fetch-through.
- architecture/sync: catat lazy fetch-through & backfillFeed mencakup ticketAttachment.

- [ ] **Step 3: Tautkan di README SoT**

Tambah baris untuk ADR-0068 & doc tersentuh di `internal/docs/README.md`.

- [ ] **Step 4: Verifikasi coverage SoT (dep-free)**

Run:
```bash
env -u NODE_ENV pnpm --filter ./shared exec tsx src/coverage.ts 2>/dev/null || node --experimental-strip-types shared/src/coverage.ts
```
Expected: tak ada doc yatim/unreferenced baru (sesuaikan bila tool beda — lihat memory "Verify coverage without server").

- [ ] **Step 5: Smoke API nyata di local (WAJIB)**

Boot server terhadap DB throwaway lalu uji alur nyata:
```bash
# 1) siapkan DB smoke terpisah (bukan hanoman_test — bisa ditruncate sibling)
docker exec hanoman-db-1 createdb -U hanoman hanoman272_smoke 2>/dev/null || true
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272_smoke \
  pnpm --filter ./server exec prisma migrate deploy
# 2) build + boot di port bebas (hindari 8787 — ada dev sesi lain)
env -u NODE_ENV pnpm --filter ./server build
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272_smoke \
  HOST=127.0.0.1 PORT=8799 node server/dist/server.js &
sleep 2
```
Uji: buat project + tiket + lampiran (via prisma atau route help), lalu `curl -s http://127.0.0.1:8799/api/tickets/<id>/attachments/<attId> -o /tmp/att.png -w "%{http_code}\n"` → 200 & file byte benar. Matikan server smoke setelahnya (`kill %1`).

- [ ] **Step 6: Full suite (regresi) + commit docs**

Run:
```bash
env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman272 \
  pnpm --filter ./server exec vitest run --no-file-parallelism
```
Expected: seluruh suite hijau.

```bash
git add internal/docs/adr/0068-lampiran-tiket-masuk-record-sync.md internal/docs/README.md internal/docs
git commit -m "docs(spec-272): ADR-0068 lampiran tiket record-sync + data-model/api-contract"
```

---

## Catatan deploy (setelah merge)

VPS live: `git pull --ff-only` → `prisma migrate deploy` (migration additive, aman) → `pnpm build` (verifikasi exit 0) → `systemctl restart hanoman`. Restart menjalankan `backfillFeed()` yang mempublish lampiran lama ke feed sehingga tersedia untuk pull klien.
