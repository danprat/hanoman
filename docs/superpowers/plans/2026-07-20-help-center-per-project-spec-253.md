# Help Center per Project Implementation Plan (SPEC-253)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Aktifkan link publik keluhan per project → tiket → antrean triase → promosi ke `Spec` / tolak → status publik terpetakan otomatis, dengan lampiran gambar.

**Architecture:** Meniru error monitoring (SPEC-249/ADR-0060): dua model server-local baru (`Ticket`, `TicketAttachment`) + satu kolom `Project.helpEnabled` (hand-written migration); endpoint publik `/api/help/*` sebagai pengecualian sah gate `/api` (otorisasi `helpEnabled` + kunci opaque tiket, bukan cookie); jembatan `accept` membuat `Spec` (source baru `help`, tanpa migration — String+zod); kapabilitas file storage baru (upload dir server-local + `@fastify/multipart` + serving ber-auth); halaman publik lewat routing SPA baru; status publik derived. Notifikasi & rate-limit reuse pola existing.

**Tech Stack:** Fastify + Prisma (Postgres) + zod (`@hanoman/shared`) + React/TS (Vite) + `@fastify/multipart` (dependensi baru).

## Global Constraints

- TypeScript strict. Test tiap logika orchestrasi. Repo test: `env -u NODE_ENV -u DATABASE_URL vitest run --no-file-parallelism` (hindari env prod bocor).
- **Jangan ubah skema tanpa migration + ADR.** Menambah model: hand-write `migration.sql` + `migrate deploy` per DB (bukan `migrate dev` — reset saat drift worktree). DB test `hanoman_test` butuh `migrate deploy` sendiri; `prisma generate` sesudah skema berubah.
- Enum sebagai **String + zod** di `@hanoman/shared` (`enums.ts`), bukan enum Prisma.
- Server bind `127.0.0.1:8787`. Realtime dashboard lewat WS siar existing (notifikasi) + **HTTP polling** untuk area Triase (pola ErrorsScreen), **bukan** kanal WS baru.
- Docs SoT (`internal/docs/**`) diperbarui **dalam commit yang sama** & ter-link di `internal/docs/README.md`.
- Model server-local (`Ticket`/`TicketAttachment`) **tanpa** `version`/sync (pola `ErrorGroup`). `Project.helpEnabled` additive, diekspos di `ProjectView`.
- Worktree ini butuh `pnpm install` (bawa `@fastify/multipart`) + `prisma generate` sebelum test hijau.
- Batas lampiran: **≤3 berkas**, **≤5MB/berkas**, mime ∈ `image/png|image/jpeg|image/webp`. Berkas invalid di-skip, submit sisanya tetap jadi.
- `HANOMAN_UPLOAD_DIR` default `<cwd server>/data/uploads` — server-local, **di luar repoDir**, **tak disync**.
- ADR baru = **ADR-0061** (tertinggi saat ini 0060; tak ada collision lintas branch).

---

### Task 1: Skema Prisma + migration + enum/DTO tiket

**Files:**
- Modify: `server/prisma/schema.prisma` (tambah `Ticket`, `TicketAttachment`; kolom `Project.helpEnabled` + relasi `tickets`)
- Create: `server/prisma/migrations/2026072001_spec253_help_center/migration.sql`
- Modify: `shared/src/enums.ts` (tambah `zTicketCategory`, `zTicketStatus`; extend `zSpecSource`)
- Modify: `shared/src/dto.ts` (tambah `TicketView`/`TicketDetail`/help DTO; kolom `helpEnabled` di `zProjectView`)
- Test: `shared/src/enums.test.ts` (atau buat bila belum ada), `server/src/services/ticket.test.ts` (Task 3 pakai schema — di sini hanya enum test)

**Interfaces:**
- Produces: model Prisma `Ticket { id, projectId, number, category, title, detail, reporterEmail, status, accessKeyHash, specId?, createdAt, updatedAt, attachments }`, `TicketAttachment { id, ticketId, projectId, filename, mimeType, size, storageKey, createdAt }`; `Project.helpEnabled: boolean`. Zod `zTicketCategory` (`bug|fitur|pertanyaan|lainnya`), `zTicketStatus` (`new|accepted|rejected`). `zSpecSource` menerima `help`. `zProjectView.helpEnabled: boolean`.

- [x] **Step 1: Tulis test enum yang gagal**

Di `shared/src/enums.test.ts` (buat bila belum ada; pola vitest):
```ts
import { describe, it, expect } from "vitest";
import { zTicketCategory, zTicketStatus, zSpecSource } from "./enums";

describe("ticket enums", () => {
  it("kategori tiket valid & tolak lainnya", () => {
    for (const c of ["bug", "fitur", "pertanyaan", "lainnya"]) expect(zTicketCategory.parse(c)).toBe(c);
    expect(zTicketCategory.safeParse("spam").success).toBe(false);
  });
  it("status tiket valid", () => {
    for (const s of ["new", "accepted", "rejected"]) expect(zTicketStatus.parse(s)).toBe(s);
    expect(zTicketStatus.safeParse("closed").success).toBe(false);
  });
  it("source Spec menerima help", () => {
    expect(zSpecSource.parse("help")).toBe("help");
  });
});
```

- [x] **Step 2: Jalankan — gagal**

Run: `cd shared && npx vitest run src/enums.test.ts`
Expected: FAIL (`zTicketCategory` undefined / `help` ditolak).

- [x] **Step 3: Tambah enum di `shared/src/enums.ts`**

```ts
export const zSpecSource = z.enum(["brief", "qa", "audit", "help"]); // SPEC-253 · +help
export const zTicketCategory = z.enum(["bug", "fitur", "pertanyaan", "lainnya"]); // SPEC-253
export const zTicketStatus = z.enum(["new", "accepted", "rejected"]); // SPEC-253
```

- [x] **Step 4: Tambah model Prisma + kolom Project di `server/prisma/schema.prisma`**

Di `model Project` tambahkan (setelah `errorGroups ErrorGroup[]`):
```prisma
  helpEnabled Boolean @default(false) // SPEC-253 · opt-in Help Center publik
  tickets     Ticket[]
```
Tambah dua model baru:
```prisma
model Ticket {
  id            String   @id @default(cuid())
  projectId     String
  number        Int
  category      String
  title         String
  detail        String
  reporterEmail String
  status        String   @default("new")
  accessKeyHash String   @unique
  specId        String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @default(now())
  project       Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  attachments   TicketAttachment[]

  @@unique([projectId, number])
  @@index([projectId, createdAt])
}

model TicketAttachment {
  id         String   @id @default(cuid())
  ticketId   String
  projectId  String
  filename   String
  mimeType   String
  size       Int
  storageKey String
  createdAt  DateTime @default(now())
  ticket     Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  @@index([ticketId])
}
```

- [x] **Step 5: Tulis migration hand-written**

`server/prisma/migrations/2026072001_spec253_help_center/migration.sql`:
```sql
-- SPEC-253 · Help Center per project (Ticket + TicketAttachment + Project.helpEnabled)
ALTER TABLE "Project" ADD COLUMN "helpEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Ticket" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "reporterEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "accessKeyHash" TEXT NOT NULL,
  "specId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Ticket_accessKeyHash_key" ON "Ticket"("accessKeyHash");
CREATE UNIQUE INDEX "Ticket_projectId_number_key" ON "Ticket"("projectId", "number");
CREATE INDEX "Ticket_projectId_createdAt_idx" ON "Ticket"("projectId", "createdAt");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TicketAttachment" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [x] **Step 6: Tambah DTO di `shared/src/dto.ts`**

Di `zProjectView` tambah field:
```ts
  helpEnabled: z.boolean().default(false),   // SPEC-253 · Help Center publik aktif
```
Tambah DTO tiket (dekat DTO error, akhir file):
```ts
// SPEC-253 · Help Center
export const zTicketView = z.object({
  id: z.string(), projectId: z.string(), number: z.number().int(),
  category: z.string(), title: z.string(), reporterEmail: z.string(),
  status: z.string(), specId: z.string().nullable(), attachmentCount: z.number().int(),
  createdAt: z.string(),
});
export type TicketView = z.infer<typeof zTicketView>;
export const zTicketAttachmentView = z.object({
  id: z.string(), filename: z.string(), mimeType: z.string(), size: z.number().int(),
});
export const zTicketDetail = zTicketView.extend({
  detail: z.string(),
  attachments: z.array(zTicketAttachmentView),
});
export type TicketDetail = z.infer<typeof zTicketDetail>;
// halaman publik
export const zHelpInfo = z.object({ projectName: z.string(), categories: z.array(z.string()) });
export const zPublicTicketStatus = z.object({
  number: z.number().int(), category: z.string(), title: z.string(),
  status: z.string(), createdAt: z.string(),
});
export type PublicTicketStatus = z.infer<typeof zPublicTicketStatus>;
```

- [x] **Step 7: Migrate + generate + jalankan test**

Run:
```bash
cd server && npx prisma generate
DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman253" npx prisma migrate deploy || true
DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman253_test" npx prisma migrate deploy || true
cd ../shared && npx vitest run src/enums.test.ts
```
Expected: enum test PASS. (Sesuaikan DATABASE_URL/port ke DB dev lokal; pakai base unik `hanoman253` agar tak bentrok sibling — lihat catatan memory.)

- [x] **Step 8: Commit**

```bash
git add server/prisma shared/src/enums.ts shared/src/dto.ts shared/src/enums.test.ts
git commit -m "feat(spec-253): schema Ticket+TicketAttachment+Project.helpEnabled + enum/DTO"
```

---

### Task 2: Kapabilitas file storage (`services/uploads.ts`) + `@fastify/multipart`

**Files:**
- Create: `server/src/services/uploads.ts`
- Test: `server/src/services/uploads.test.ts`
- Modify: `server/package.json` (dependency `@fastify/multipart`)
- Modify: `shared/src/config-registry.ts` (daftarkan `HANOMAN_UPLOAD_DIR` opsional) — atau baca via `effectiveStr` langsung (pola HANOMAN_INGEST_*). Pilih: baca langsung `effectiveStr("HANOMAN_UPLOAD_DIR")` dengan fallback default (tanpa registry, cermin ingest).

**Interfaces:**
- Produces: `uploadDir(): string`, `saveUpload(buf: Buffer, mimeType: string): Promise<{ storageKey: string; size: number }>`, `readUpload(storageKey: string): Promise<Buffer>`, `deleteUpload(storageKey: string): Promise<void>`, `extFor(mimeType: string): string` (`image/png→.png`, dst). Semua sinkron ke FS lokal; nama opaque `<cuid>.<ext>`.

- [x] **Step 1: Test gagal**

`server/src/services/uploads.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { saveUpload, readUpload, deleteUpload, extFor } from "./uploads";

describe("uploads", () => {
  it("extFor memetakan mime gambar", () => {
    expect(extFor("image/png")).toBe(".png");
    expect(extFor("image/jpeg")).toBe(".jpg");
    expect(extFor("image/webp")).toBe(".webp");
  });
  it("save → read → delete round-trip", async () => {
    const buf = Buffer.from("PNGDATA");
    const { storageKey, size } = await saveUpload(buf, "image/png");
    expect(size).toBe(buf.length);
    expect(storageKey.endsWith(".png")).toBe(true);
    expect((await readUpload(storageKey)).equals(buf)).toBe(true);
    await deleteUpload(storageKey);
    await expect(readUpload(storageKey)).rejects.toThrow();
  });
});
```

- [x] **Step 2: Jalankan — gagal**

Run: `cd server && npx vitest run src/services/uploads.test.ts`
Expected: FAIL (module tak ada).

- [x] **Step 3: Implement `services/uploads.ts`**

```ts
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { effectiveStr } from "../config";

const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
export function extFor(mimeType: string): string { return EXT[mimeType] ?? ".bin"; }

export function uploadDir(): string {
  return resolve(effectiveStr("HANOMAN_UPLOAD_DIR") ?? join(process.cwd(), "data", "uploads"));
}
export async function saveUpload(buf: Buffer, mimeType: string): Promise<{ storageKey: string; size: number }> {
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const storageKey = `${randomUUID()}${extFor(mimeType)}`;
  await writeFile(join(dir, storageKey), buf);
  return { storageKey, size: buf.length };
}
export async function readUpload(storageKey: string): Promise<Buffer> {
  // storageKey selalu dari randomUUID()+ext (bukan input user) → tanpa traversal; jaga tetap basename.
  const safe = storageKey.replace(/[/\\]/g, "");
  return readFile(join(uploadDir(), safe));
}
export async function deleteUpload(storageKey: string): Promise<void> {
  const safe = storageKey.replace(/[/\\]/g, "");
  await unlink(join(uploadDir(), safe)).catch(() => {});
}
```

- [x] **Step 4: Tambah dependency**

Run: `cd server && pnpm add @fastify/multipart`
(Verifikasi versi kompatibel Fastify 4/5 yang dipakai repo — cek `server/package.json` `fastify` major dulu; pakai major `@fastify/multipart` yang cocok.)

- [x] **Step 5: Jalankan test**

Run: `cd server && HANOMAN_UPLOAD_DIR=/tmp/hn253-uploads npx vitest run src/services/uploads.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/services/uploads.ts server/src/services/uploads.test.ts server/package.json server/pnpm-lock.yaml ../pnpm-lock.yaml
git commit -m "feat(spec-253): file storage capability (uploads.ts) + @fastify/multipart"
```

---

### Task 3: Core ticket service — key, number, publicStatus

**Files:**
- Create: `server/src/services/ticket.ts`
- Test: `server/src/services/ticket.test.ts`

**Interfaces:**
- Produces:
  - `generateAccessKey(): { key: string; hash: string }` — `key = "hnm_tkt_" + randomBytes(24).hex`; `hash = sha256(key) hex`.
  - `hashAccessKey(key: string): string` — `sha256(key) hex`.
  - `publicStatus(ticketStatus: string, specStage?: string | null): string` — label publik.
  - `createTicket(input: { projectId, category, title, detail, reporterEmail }): Promise<{ ticket, key }>` — hitung `number` (max+1 per project) + kunci, insert, retry P2002.

- [x] **Step 1: Test gagal (murni: key + publicStatus)**

`server/src/services/ticket.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateAccessKey, hashAccessKey, publicStatus } from "./ticket";

describe("ticket key", () => {
  it("generate key + hash konsisten", () => {
    const { key, hash } = generateAccessKey();
    expect(key.startsWith("hnm_tkt_")).toBe(true);
    expect(hashAccessKey(key)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
describe("publicStatus", () => {
  it("new → Sedang ditinjau", () => expect(publicStatus("new")).toBe("Sedang ditinjau"));
  it("rejected → Ditutup", () => expect(publicStatus("rejected")).toBe("Ditutup"));
  it("accepted tanpa spec → Diterima", () => expect(publicStatus("accepted", null)).toBe("Diterima"));
  it("accepted + planned → Diterima", () => expect(publicStatus("accepted", "planned")).toBe("Diterima"));
  it("accepted + executing → Sedang dikerjakan", () => expect(publicStatus("accepted", "executing")).toBe("Sedang dikerjakan"));
  it("accepted + done → Selesai", () => expect(publicStatus("accepted", "done")).toBe("Selesai"));
});
```

- [x] **Step 2: Jalankan — gagal**

Run: `cd server && npx vitest run src/services/ticket.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `services/ticket.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";

export function hashAccessKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
export function generateAccessKey(): { key: string; hash: string } {
  const key = "hnm_tkt_" + randomBytes(24).toString("hex");
  return { key, hash: hashAccessKey(key) };
}

// Status publik diturunkan (ADR-0018/0019): tanpa jargon internal.
export function publicStatus(ticketStatus: string, specStage?: string | null): string {
  if (ticketStatus === "rejected") return "Ditutup";
  if (ticketStatus !== "accepted") return "Sedang ditinjau"; // new / apa pun belum ditriase
  if (specStage === "done") return "Selesai";
  if (specStage === "executing") return "Sedang dikerjakan";
  return "Diterima"; // brainstorming/objective/spec-ready/planned/null
}

export async function createTicket(input: {
  projectId: string; category: string; title: string; detail: string; reporterEmail: string;
}): Promise<{ ticket: Awaited<ReturnType<typeof prisma.ticket.create>>; key: string }> {
  const { key, hash } = generateAccessKey();
  for (let attempt = 0; attempt < 3; attempt++) {
    const max = await prisma.ticket.aggregate({ where: { projectId: input.projectId }, _max: { number: true } });
    const number = (max._max.number ?? 0) + 1;
    try {
      const ticket = await prisma.ticket.create({
        data: { ...input, number, accessKeyHash: hash, status: "new" },
      });
      return { ticket, key };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("gagal membuat tiket (nomor bentrok)");
}
```

- [x] **Step 4: Jalankan test murni**

Run: `cd server && npx vitest run src/services/ticket.test.ts`
Expected: PASS (test key + publicStatus; `createTicket` diuji lewat route Task 4/6).

- [x] **Step 5: Commit**

```bash
git add server/src/services/ticket.ts server/src/services/ticket.test.ts
git commit -m "feat(spec-253): ticket service — access key, number, publicStatus"
```

---

### Task 4: Endpoint publik `/api/help/*` + rate-limit + gate bypass

**Files:**
- Create: `server/src/routes/help.ts`
- Create: `server/src/services/help-ratelimit.ts`
- Test: `server/src/routes/help.test.ts`, `server/src/services/help-ratelimit.test.ts`
- Modify: `server/src/app.ts` (bypass `/api/help` + register route + register multipart)
- Modify: `shared/src/api.ts` (path helper `help`)

**Interfaces:**
- Consumes: `createTicket`, `generateAccessKey`/`hashAccessKey`, `publicStatus` (Task 3); `saveUpload`, `extFor` (Task 2).
- Produces: `helpRateOk(projectId: string, ip: string, now?: number): boolean` (dua bucket: per-IP & per-project); route `GET /api/help/:slug`, `POST /api/help/:slug/tickets` (multipart), `GET /api/help/:slug/tickets/:key`.

- [x] **Step 1: Test rate-limit gagal**

`server/src/services/help-ratelimit.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { helpRateOk, __resetHelpBuckets } from "./help-ratelimit";

describe("helpRateOk", () => {
  beforeEach(() => __resetHelpBuckets());
  it("membatasi per IP", () => {
    const t = 1_000_000;
    let ok = 0;
    for (let i = 0; i < 20; i++) if (helpRateOk("p1", "1.1.1.1", t)) ok++;
    expect(ok).toBeLessThan(20);        // bucket IP habis
  });
  it("project berbeda tak saling pengaruh", () => {
    const t = 1_000_000;
    for (let i = 0; i < 100; i++) helpRateOk("p1", "9.9.9.9", t);
    expect(helpRateOk("p2", "8.8.8.8", t)).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan — gagal**

Run: `cd server && npx vitest run src/services/help-ratelimit.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `services/help-ratelimit.ts`** (cermin `error-ingest.ts` token bucket)

```ts
import { effectiveInt } from "../config";
type Bucket = { tokens: number; ts: number };
const ipBuckets = new Map<string, Bucket>();
const projBuckets = new Map<string, Bucket>();

function take(map: Map<string, Bucket>, k: string, cap: number, now: number): boolean {
  const b = map.get(k) ?? { tokens: cap, ts: now };
  b.tokens = Math.min(cap, b.tokens + ((now - b.ts) * cap) / 60_000);
  b.ts = now;
  if (b.tokens < 1) { map.set(k, b); return false; }
  b.tokens -= 1; map.set(k, b); return true;
}
export function helpRateOk(projectId: string, ip: string, now = Date.now()): boolean {
  const ipCap = effectiveInt("HANOMAN_HELP_RATE_PER_MIN_IP") ?? 5;
  const projCap = effectiveInt("HANOMAN_HELP_RATE_PER_MIN_PROJECT") ?? 20;
  // ambil keduanya; gagal bila salah satu habis (evaluasi IP dulu agar konsumsi konsisten).
  const okIp = take(ipBuckets, ip, ipCap, now);
  const okProj = take(projBuckets, projectId, projCap, now);
  return okIp && okProj;
}
export function __resetHelpBuckets() { ipBuckets.clear(); projBuckets.clear(); }
```

- [x] **Step 4: Jalankan test rate-limit**

Run: `cd server && npx vitest run src/services/help-ratelimit.test.ts`
Expected: PASS.

- [x] **Step 5: Path helper `shared/src/api.ts`**

Di objek path (dekat `ingest`):
```ts
  // SPEC-253 · Help Center publik (bypass gate cookie; otorisasi helpEnabled + kunci opaque tiket).
  help: (slug: string) => `${API}/help/${encodeURIComponent(slug)}`,
  helpTickets: (slug: string) => `${API}/help/${encodeURIComponent(slug)}/tickets`,
  helpStatus: (slug: string, key: string) => `${API}/help/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(key)}`,
```

- [x] **Step 6: Implement `routes/help.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zTicketCategory } from "@hanoman/shared";
import { prisma } from "../db";
import { createTicket, hashAccessKey, publicStatus } from "../services/ticket";
import { saveUpload } from "../services/uploads";
import { helpRateOk } from "../services/help-ratelimit";

const CATEGORIES = ["bug", "fitur", "pertanyaan", "lainnya"];
const OK_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILES = 3, MAX_BYTES = 5 * 1024 * 1024;
const zField = z.object({
  category: zTicketCategory,
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(10_000),
  email: z.string().min(3).max(200),
});

export default async function (app: FastifyInstance) {
  // Info halaman publik. 404 generik bila project tak ada / helpEnabled=false.
  app.get("/help/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const p = await prisma.project.findUnique({ where: { id: slug } });
    if (!p || !p.helpEnabled) return reply.code(404).send({ error: "not found" });
    return { projectName: p.name, categories: CATEGORIES };
  });

  // Submit keluhan (multipart/form-data). Honeypot `hp` terisi → sukses palsu.
  app.post("/help/:slug/tickets", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const p = await prisma.project.findUnique({ where: { id: slug } });
    if (!p || !p.helpEnabled) return reply.code(404).send({ error: "not found" });
    if (!helpRateOk(slug, req.ip)) return reply.code(429).send({ error: "terlalu banyak permintaan" });

    const fields: Record<string, string> = {};
    const files: { buf: Buffer; mime: string; name: string }[] = [];
    // @fastify/multipart iterator; part.type "field" | "file".
    for await (const part of (req as any).parts()) {
      if (part.type === "file") {
        if (files.length >= MAX_FILES) { await part.toBuffer(); continue; } // skip kelebihan
        const buf = await part.toBuffer();
        if (buf.length <= MAX_BYTES && OK_MIME.has(part.mimetype)) {
          files.push({ buf, mime: part.mimetype, name: String(part.filename ?? "gambar") });
        } // invalid → di-skip, submit lanjut
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }
    if (fields.hp) return reply.code(200).send({ ok: true }); // honeypot: bot → sukses palsu, tak buat tiket

    const parsed = zField.safeParse({ category: fields.category, title: fields.title, detail: fields.detail, email: fields.email });
    if (!parsed.success) return reply.code(400).send({ error: "field wajib tak lengkap / tak valid" });

    const { ticket, key } = await createTicket({
      projectId: slug, category: parsed.data.category, title: parsed.data.title,
      detail: parsed.data.detail, reporterEmail: parsed.data.email,
    });
    for (const f of files) {
      const { storageKey, size } = await saveUpload(f.buf, f.mime);
      await prisma.ticketAttachment.create({
        data: { ticketId: ticket.id, projectId: slug, filename: f.name.slice(0, 200), mimeType: f.mime, size, storageKey },
      });
    }
    // Notifikasi tiket baru — lihat Task 5 (recordNewTicket dipanggil di sini bila sudah ada).
    const { recordNewTicket } = await import("../services/notifications");
    await recordNewTicket(ticket.id, slug, p.name, parsed.data.category, parsed.data.title);
    const statusPath = `/help/${encodeURIComponent(slug)}/status/${encodeURIComponent(key)}`;
    return reply.code(201).send({ number: ticket.number, key, statusPath });
  });

  // Cek status publik by kunci opaque. Scoped ke slug (isolasi).
  app.get("/help/:slug/tickets/:key", async (req, reply) => {
    const { slug, key } = req.params as { slug: string; key: string };
    const t = await prisma.ticket.findUnique({ where: { accessKeyHash: hashAccessKey(key) } });
    if (!t || t.projectId !== slug) return reply.code(404).send({ error: "not found" });
    let stage: string | null = null;
    if (t.specId) stage = (await prisma.spec.findUnique({ where: { id: t.specId } }))?.stage ?? null;
    return { number: t.number, category: t.category, title: t.title, status: publicStatus(t.status, stage), createdAt: t.createdAt.toISOString() };
  });
}
```

- [x] **Step 7: Wire `server/src/app.ts`**

Setelah baris bypass ingest, tambah:
```ts
        // SPEC-253 · halaman/submit/status Help Center dipanggil pengguna akhir tanpa sesi login;
        // route /api/help di-otorisasi helpEnabled + kunci opaque tiket sendiri (pengecualian sah gate).
        if (path.startsWith("/api/help")) return;
```
Import + register (dekat `ingest`):
```ts
import help from "./routes/help";
import fastifyMultipart from "@fastify/multipart";
```
Di dalam scope `/api` (sebelum register route, setelah `api.register(cookie)`):
```ts
    await api.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024, files: 3, fieldSize: 20_000 } });
```
Dan register route: `await api.register(help);` (di daftar register, dekat `ingest`).

- [x] **Step 8: Test route help (integration, DB test)**

`server/src/routes/help.test.ts` — pola test route existing (buildApp({requireAuth:false}) + inject). Contoh inti (lengkapi setup project via prisma):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { __resetHelpBuckets } from "../services/help-ratelimit";

const app = buildApp({ requireAuth: false });
beforeAll(async () => {
  await app.ready();
  await prisma.project.create({ data: { id: "hc-proj", name: "HC Proj", desc: "", kind: "existing", helpEnabled: true } });
  await prisma.project.create({ data: { id: "hc-off", name: "Off", desc: "", kind: "existing", helpEnabled: false } });
});
afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { projectId: { in: ["hc-proj", "hc-off"] } } });
  await prisma.project.deleteMany({ where: { id: { in: ["hc-proj", "hc-off"] } } });
  await app.close();
});

function form(fields: Record<string, string>) {
  const boundary = "----hc253"; const CRLF = "\r\n";
  let body = "";
  for (const [k, v] of Object.entries(fields)) body += `--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`;
  body += `--${boundary}--${CRLF}`;
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("help center public", () => {
  it("GET info hanya untuk helpEnabled", async () => {
    expect((await app.inject({ method: "GET", url: "/api/help/hc-proj" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/help/hc-off" })).statusCode).toBe(404);
  });
  it("submit valid → 201 + number + key + statusPath, lalu status Sedang ditinjau", async () => {
    __resetHelpBuckets();
    const f = form({ category: "bug", title: "Tak bisa login", detail: "Error 500", email: "a@b.c" });
    const res = await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...f });
    expect(res.statusCode).toBe(201);
    const { number, key } = res.json();
    expect(number).toBe(1);
    const st = await app.inject({ method: "GET", url: `/api/help/hc-proj/tickets/${key}` });
    expect(st.json().status).toBe("Sedang ditinjau");
  });
  it("field wajib kosong → 400, tak buat tiket", async () => {
    __resetHelpBuckets();
    const f = form({ category: "bug", title: "", detail: "x", email: "a@b.c" });
    expect((await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...f })).statusCode).toBe(400);
  });
  it("honeypot → 200 tanpa tiket", async () => {
    __resetHelpBuckets();
    const before = await prisma.ticket.count({ where: { projectId: "hc-proj" } });
    const f = form({ category: "bug", title: "spam", detail: "spam", email: "x@y.z", hp: "iambot" });
    expect((await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...f })).statusCode).toBe(200);
    expect(await prisma.ticket.count({ where: { projectId: "hc-proj" } })).toBe(before);
  });
  it("kunci salah / slug salah → 404", async () => {
    expect((await app.inject({ method: "GET", url: "/api/help/hc-proj/tickets/hnm_tkt_bogus" })).statusCode).toBe(404);
  });
});
```

- [x] **Step 9: Jalankan test route**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman253_test" HANOMAN_UPLOAD_DIR=/tmp/hn253-uploads npx vitest run src/routes/help.test.ts`
Expected: PASS.

- [x] **Step 10: Commit**

```bash
git add server/src/routes/help.ts server/src/services/help-ratelimit.ts server/src/services/help-ratelimit.test.ts server/src/routes/help.test.ts server/src/app.ts shared/src/api.ts
git commit -m "feat(spec-253): endpoint publik /api/help (info/submit/status) + rate-limit + gate bypass"
```

---

### Task 5: Manajemen Help Center per project + notifikasi tiket baru

**Files:**
- Modify: `server/src/routes/projects.ts` (GET/POST/DELETE `/projects/:id/help-center`)
- Modify: `server/src/services/project-view.ts` (`helpEnabled` di ProjectView)
- Modify: `server/src/services/notifications.ts` (`recordNewTicket`)
- Modify: `shared/src/api.ts` (path `projectHelpCenter`)
- Test: `server/src/routes/projects.test.ts` (tambah kasus help-center) + `server/src/services/notifications.test.ts` (bila ada; else di route help test)

**Interfaces:**
- Consumes: `helpEnabled` kolom (Task 1).
- Produces: `recordNewTicket(ticketId, projectId, projectName, category, title): Promise<void>` (Notification `type:"ticket"`, `key:"ticket:<id>"`). Route help-center enable/disable + `{ enabled, publicUrl }`.

- [x] **Step 1: Test help-center route gagal**

Tambah di `server/src/routes/projects.test.ts` (atau file baru `projects-help.test.ts`):
```ts
it("enable → disable help center", async () => {
  const en = await app.inject({ method: "POST", url: "/api/projects/hc-proj/help-center" });
  expect(en.statusCode).toBe(200);
  expect(en.json().enabled).toBe(true);
  expect(en.json().publicUrl).toContain("/help/hc-proj");
  const get = await app.inject({ method: "GET", url: "/api/projects/hc-proj/help-center" });
  expect(get.json().enabled).toBe(true);
  const dis = await app.inject({ method: "DELETE", url: "/api/projects/hc-proj/help-center" });
  expect(dis.statusCode).toBe(204);
  expect((await app.inject({ method: "GET", url: "/api/projects/hc-proj/help-center" })).json().enabled).toBe(false);
});
```

- [x] **Step 2: Jalankan — gagal** · Run: `cd server && ... npx vitest run src/routes/projects.test.ts` · Expected: FAIL (404 route).

- [x] **Step 3: Implement route di `server/src/routes/projects.ts`** (setelah blok ingest-key)

```ts
  // SPEC-253 · Help Center publik per project (opt-in). Link publik ke Project.id (slug).
  app.get("/projects/:id/help-center", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    return { enabled: p.helpEnabled, publicUrl: `${base}/help/${encodeURIComponent(id)}` };
  });
  app.post("/projects/:id/help-center", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    await prisma.project.update({ where: { id }, data: { helpEnabled: true } });
    await enqueueOutbox("project", id);
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    return { enabled: true, publicUrl: `${base}/help/${encodeURIComponent(id)}` };
  });
  app.delete("/projects/:id/help-center", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    await prisma.project.update({ where: { id }, data: { helpEnabled: false } });
    await enqueueOutbox("project", id);
    return reply.code(204).send();
  });
```

- [x] **Step 4: Ekspos `helpEnabled` di `server/src/services/project-view.ts`**

Di objek return `toProjectView`, tambah:
```ts
    helpEnabled: p.helpEnabled,   // SPEC-253
```

- [x] **Step 5: `recordNewTicket` di `server/src/services/notifications.ts`** (cermin `recordNewErrorGroup`)

```ts
export async function recordNewTicket(ticketId: string, projectId: string, projectName: string, category: string, title: string) {
  const short = title.length > 80 ? title.slice(0, 77) + "…" : title;
  const t = `Keluhan baru di "${projectName}": ${category}: ${short}`;
  await prisma.notification.create({
    data: { type: "ticket", key: `ticket:${ticketId}`, projectId, title: t },
  }).catch(() => { /* P2002: sudah ada */ });
}
```

- [x] **Step 6: Path helper `shared/src/api.ts`**

```ts
  projectHelpCenter: (id: string) => `${API}/projects/${encodeURIComponent(id)}/help-center`,
```

- [x] **Step 7: Jalankan test** · Run: `cd server && env ... DATABASE_URL=.../hanoman253_test npx vitest run src/routes/projects.test.ts` · Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add server/src/routes/projects.ts server/src/services/project-view.ts server/src/services/notifications.ts shared/src/api.ts shared/src/dto.ts server/src/routes/projects.test.ts
git commit -m "feat(spec-253): help-center enable/disable + helpEnabled in ProjectView + recordNewTicket"
```

---

### Task 6: Triase API — list/detail/serve-lampiran/accept/reject + retensi

**Files:**
- Create: `server/src/routes/tickets.ts`
- Test: `server/src/routes/tickets.test.ts`
- Modify: `server/src/app.ts` (register `tickets` — di belakang gate cookie)
- Modify: `shared/src/api.ts` (paths `tickets`, `ticket`, `ticketAttachment`, `ticketAccept`, `ticketReject`)
- Modify: `server/src/services/ticket.ts` (`pruneOldTickets` opportunistic)

**Interfaces:**
- Consumes: `publicStatus` tidak dipakai di sini; `saveUpload`/`readUpload`/`deleteUpload` (serve/prune); `nextSpecId`, `resolveRepoDir`, `enqueueOutbox` (accept, cermin escalate); `flowForSource("help")` sudah `feature`.
- Produces: routes `GET /tickets`, `GET /tickets/:id`, `GET /tickets/:id/attachments/:attId`, `POST /tickets/:id/accept`, `POST /tickets/:id/reject`. Envelope `GET /tickets` menyertakan `unreviewed` (jumlah status new dalam scope).

- [x] **Step 1: Test triase gagal (accept membuat Spec source help + idempoten + isolasi)**

`server/src/routes/tickets.test.ts` (setup project + tiket via prisma; app requireAuth:false):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { createTicket } from "../services/ticket";

const app = buildApp({ requireAuth: false });
let tId = "";
beforeAll(async () => {
  await app.ready();
  await prisma.project.create({ data: { id: "tri-proj", name: "Tri", desc: "", kind: "existing", helpEnabled: true } });
  const { ticket } = await createTicket({ projectId: "tri-proj", category: "bug", title: "X rusak", detail: "detail", reporterEmail: "r@e.co" });
  tId = ticket.id;
});
afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { projectId: "tri-proj" } });
  await prisma.spec.deleteMany({ where: { projectId: "tri-proj" } });
  await prisma.project.deleteMany({ where: { id: "tri-proj" } });
  await app.close();
});

describe("triage tickets", () => {
  it("list + unreviewed", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tickets?project=tri-proj" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
    expect(res.json().unreviewed).toBeGreaterThan(0);
  });
  it("accept → Spec source help + tautan dua arah + idempoten", async () => {
    const res = await app.inject({ method: "POST", url: `/api/tickets/${tId}/accept`, payload: { priority: "tinggi" } });
    expect(res.statusCode).toBe(201);
    const spec = res.json().spec;
    expect(spec.source).toBe("help");
    expect(spec.priority).toBe("tinggi");
    const t = await prisma.ticket.findUnique({ where: { id: tId } });
    expect(t?.status).toBe("accepted");
    expect(t?.specId).toBe(spec.id);
    // idempoten
    const again = await app.inject({ method: "POST", url: `/api/tickets/${tId}/accept` });
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyPromoted).toBe(true);
  });
  it("reject → status rejected", async () => {
    const { ticket } = await createTicket({ projectId: "tri-proj", category: "lainnya", title: "spam", detail: "d", reporterEmail: "s@s.s" });
    const res = await app.inject({ method: "POST", url: `/api/tickets/${ticket.id}/reject` });
    expect(res.statusCode).toBe(200);
    expect((await prisma.ticket.findUnique({ where: { id: ticket.id } }))?.status).toBe("rejected");
  });
});
```

- [x] **Step 2: Jalankan — gagal** · Run: `cd server && ... npx vitest run src/routes/tickets.test.ts` · Expected: FAIL.

- [x] **Step 3: Implement `routes/tickets.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { paginate } from "../services/paginate";
import { nextSpecId } from "../services/id";
import { resolveRepoDir } from "../services/local-binding";
import { enqueueOutbox } from "../services/outbox";
import { readUpload } from "../services/uploads";
import type { Ticket } from "@prisma/client";

const view = (t: Ticket & { _count?: { attachments: number } }) => ({
  id: t.id, projectId: t.projectId, number: t.number, category: t.category, title: t.title,
  reporterEmail: t.reporterEmail, status: t.status, specId: t.specId,
  attachmentCount: t._count?.attachments ?? 0, createdAt: t.createdAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  app.get("/tickets", async (req) => {
    const { project, status, q, page, limit } = req.query as Record<string, string | undefined>;
    const where: { projectId?: string; status?: string } = {};
    if (project) where.projectId = project;
    if (status) where.status = status;
    let rows = await prisma.ticket.findMany({ where, orderBy: { createdAt: "desc" }, include: { _count: { select: { attachments: true } } } });
    if (q) { const n = q.toLowerCase(); rows = rows.filter((t) => `${t.title} ${t.reporterEmail}`.toLowerCase().includes(n)); }
    const unreviewed = rows.filter((t) => t.status === "new").length;
    return { ...paginate(rows.map(view), page, limit), unreviewed };
  });

  app.get("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id }, include: { attachments: true, _count: { select: { attachments: true } } } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const spec = t.specId ? await prisma.spec.findUnique({ where: { id: t.specId } }) : null;
    return {
      ...view(t), detail: t.detail,
      attachments: t.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
      spec,
    };
  });

  app.get("/tickets/:id/attachments/:attId", async (req, reply) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const a = await prisma.ticketAttachment.findUnique({ where: { id: attId } });
    if (!a || a.ticketId !== id) return reply.code(404).send({ error: "not found" });
    const buf = await readUpload(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", a.mimeType);
    return reply.send(buf);
  });

  // Terima → Spec (source help, brief-shaped payload) + tautan dua arah. Idempoten (cermin escalate).
  app.post("/tickets/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id }, include: { _count: { select: { attachments: true } } } });
    if (!t) return reply.code(404).send({ error: "not found" });
    if (t.specId) {
      const spec = await prisma.spec.findUnique({ where: { id: t.specId } });
      return reply.code(200).send({ alreadyPromoted: true, spec });
    }
    const priority = (req.body as { priority?: string } | undefined)?.priority ?? "sedang";
    const author = req.user?.email ?? "system";
    const backlink = `Dari tiket Help Center #${t.number} (projek ${t.projectId}).`;
    const nAtt = t._count?.attachments ?? 0;
    const payload = {
      context: `${t.detail}\n\nKategori: ${t.category}\nPelapor: ${t.reporterEmail}\nLampiran: ${nAtt} berkas (lihat tiket di triase).\n${backlink}`,
      outcome: "", constraints: "",
    };
    const repoDir = await resolveRepoDir(t.projectId);
    let spec: Awaited<ReturnType<typeof prisma.spec.create>> | null = null;
    for (let attempt = 0; attempt < 3 && !spec; attempt++) {
      const sid = await nextSpecId(repoDir);
      try {
        spec = await prisma.spec.create({
          data: {
            id: sid, projectId: t.projectId, title: t.title, source: "help",
            stage: "brainstorming", priority, author: `Help · ${author}`,
            objective: `${t.category}: ${t.title}. ${backlink}`, payload,
          },
        });
      } catch (e) { if ((e as { code?: string }).code === "P2002" && attempt < 2) continue; throw e; }
    }
    await prisma.ticket.update({ where: { id }, data: { status: "accepted", specId: spec!.id } });
    await enqueueOutbox("spec", spec!.id);
    return reply.code(201).send({ spec });
  });

  app.post("/tickets/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({ where: { id }, data: { status: "rejected" } });
    return { id: updated.id, status: updated.status };
  });
}
```

- [x] **Step 4: Register di `server/src/app.ts`** (di belakang gate, dekat `errors`)

```ts
import tickets from "./routes/tickets";
// ...
    await api.register(tickets);  // SPEC-253 · triase (gate cookie)
```

- [x] **Step 5: Path helpers `shared/src/api.ts`**

```ts
  // SPEC-253 · triase
  tickets: `${API}/tickets`,
  ticket: (id: string) => `${API}/tickets/${id}`,
  ticketAttachment: (id: string, attId: string) => `${API}/tickets/${id}/attachments/${attId}`,
  ticketAccept: (id: string) => `${API}/tickets/${id}/accept`,
  ticketReject: (id: string) => `${API}/tickets/${id}/reject`,
```

- [x] **Step 6: Retensi opportunistic — `pruneOldTickets` di `services/ticket.ts` + panggil di submit**

Tambah di `services/ticket.ts`:
```ts
import { deleteUpload } from "./uploads";
export async function pruneOldTickets(now = Date.now()): Promise<void> {
  const days = Number(process.env.HANOMAN_TICKET_RETENTION_DAYS ?? 90);
  const cutoff = new Date(now - days * 86_400_000);
  const stale = await prisma.ticket.findMany({
    where: { status: "rejected", specId: null, createdAt: { lt: cutoff } },
    include: { attachments: true }, take: 50,
  });
  for (const t of stale) {
    for (const a of t.attachments) await deleteUpload(a.storageKey);
    await prisma.ticket.delete({ where: { id: t.id } }); // cascade attachments row
  }
}
```
Di `routes/help.ts` submit, setelah membuat tiket (fire-and-forget): `void (await import("../services/ticket")).pruneOldTickets();`

- [x] **Step 7: Jalankan test** · Run: `cd server && env ... DATABASE_URL=.../hanoman253_test HANOMAN_UPLOAD_DIR=/tmp/hn253-uploads npx vitest run src/routes/tickets.test.ts` · Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add server/src/routes/tickets.ts server/src/routes/tickets.test.ts server/src/app.ts shared/src/api.ts server/src/services/ticket.ts
git commit -m "feat(spec-253): triage API — list/detail/attachment/accept(help Spec)/reject + retensi"
```

---

### Task 7: Frontend publik — routing SPA + PublicHelpApp + client

**Files:**
- Create: `src/src/public/PublicHelpApp.tsx`, `src/src/public/public-help.css` (opsional), `src/src/api/help.ts`
- Modify: `src/src/main.tsx` (deteksi path `/help/`)
- Test: `src/src/test/public-help.test.tsx` (routing + submit → konfirmasi; jsdom + mock fetch)

**Interfaces:**
- Consumes: `apiPath.help/helpTickets/helpStatus` (Task 4).
- Produces: `PublicHelpApp` (parse `location.pathname`: `/help/:slug` → form; `/help/:slug/status/:key` → status). `helpApi` client: `getInfo(slug)`, `submit(slug, FormData)`, `status(slug, key)`.

- [x] **Step 1: Test routing gagal**

`src/src/test/public-help.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PublicHelpApp } from "../public/PublicHelpApp";

function setPath(p: string) { window.history.pushState({}, "", p); }
beforeEach(() => { vi.restoreAllMocks(); });

describe("PublicHelpApp routing", () => {
  it("render form untuk /help/:slug", async () => {
    setPath("/help/demo");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ projectName: "Demo", categories: ["bug","fitur","pertanyaan","lainnya"] }), { status: 200 }));
    render(<PublicHelpApp />);
    await waitFor(() => expect(screen.getByText(/Demo/)).toBeTruthy());
    expect(screen.getByLabelText(/detail/i)).toBeTruthy();
  });
  it("render status untuk /help/:slug/status/:key", async () => {
    setPath("/help/demo/status/hnm_tkt_x");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ number: 3, category: "bug", title: "T", status: "Diterima", createdAt: new Date().toISOString() }), { status: 200 }));
    render(<PublicHelpApp />);
    await waitFor(() => expect(screen.getByText(/Diterima/)).toBeTruthy());
  });
});
```

- [x] **Step 2: Jalankan — gagal** · Run: `cd src && npx vitest run src/test/public-help.test.tsx` · Expected: FAIL.

- [x] **Step 3: Implement `src/src/api/help.ts`**

```ts
import { apiPath } from "@hanoman/shared";
export const helpApi = {
  async getInfo(slug: string) {
    const r = await fetch(apiPath.help(slug));
    if (!r.ok) throw new Error("Help Center tak tersedia");
    return r.json() as Promise<{ projectName: string; categories: string[] }>;
  },
  async submit(slug: string, form: FormData) {
    const r = await fetch(apiPath.helpTickets(slug), { method: "POST", body: form });
    if (r.status === 429) throw new Error("Terlalu banyak permintaan, coba lagi nanti.");
    if (!r.ok) throw new Error("Gagal mengirim keluhan. Periksa isian wajib.");
    return r.json() as Promise<{ number: number; key: string; statusPath: string }>;
  },
  async status(slug: string, key: string) {
    const r = await fetch(apiPath.helpStatus(slug, key));
    if (!r.ok) throw new Error("Tiket tak ditemukan");
    return r.json() as Promise<{ number: number; category: string; title: string; status: string; createdAt: string }>;
  },
};
```

- [x] **Step 4: Implement `src/src/public/PublicHelpApp.tsx`**

Parse path, dua tampilan. Gunakan elemen form native + token DS (kelas `.hn-*` sudah ada via styles.css yang di-import di main). Kunci: `<label htmlFor>` untuk `getByLabelText`, field honeypot tersembunyi `name="hp"`, input file `accept="image/*"` (maks 3), tampilkan konfirmasi nomor + link status. (Tulis komponen penuh: state form, submit membangun `FormData`, tampilkan hasil; halaman status memanggil `helpApi.status`.) Layout minimal terpusat maks 640px, tanpa Shell/sidebar.

- [x] **Step 5: Wire `src/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "./ds/styles.css";
import "./app.css";
import App from "./App";
import { PublicHelpApp } from "./public/PublicHelpApp";
const isHelp = window.location.pathname.startsWith("/help/");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isHelp ? <PublicHelpApp /> : <App />}</React.StrictMode>
);
```

- [x] **Step 6: Jalankan test** · Run: `cd src && npx vitest run src/test/public-help.test.tsx` · Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/src/public src/src/api/help.ts src/src/main.tsx src/src/test/public-help.test.tsx
git commit -m "feat(spec-253): halaman publik Help Center (SPA routing /help/*) — form + konfirmasi + status"
```

---

### Task 8: Frontend triase + kartu Help Center + notifikasi ticket + docs SoT/ADR

**Files:**
- Create: `src/src/screens/TriageScreen.tsx`
- Modify: `src/src/ds/shell.tsx` (`HN_NAV` += triage), `src/src/App.tsx` (branch `section==="triage"` + client wiring), `src/src/api/client.ts` (metode tiket), `src/src/screens/ProjectDetailScreen.tsx` (`HelpCenterCard`), `src/src/notifications/NotificationBell.tsx` + `NotificationsContext.tsx` (cabang `ticket`)
- Test: `src/src/test/triage.test.tsx`
- Docs: `internal/docs/adr/0061-help-center-tiket-publik-triase.md` (BARU) + update `data-model.md`, `api-contract.md`, `security-standard.md`, `frontend-implementation.md`, `README.md`

**Interfaces:**
- Consumes: `apiPath.tickets/ticket/ticketAttachment/ticketAccept/ticketReject`, `apiPath.projectHelpCenter` (Task 5/6). `TicketView`/`TicketDetail` (Task 1).
- Produces: nav `triage`; `client.listTickets/getTicket/acceptTicket/rejectTicket/getHelpCenter/enableHelpCenter/disableHelpCenter`; toast/bell cabang `type==="ticket"`.

- [x] **Step 1: Test triase gagal**

`src/src/test/triage.test.tsx` — render `TriageScreen` dengan `fetch` mock daftar tiket → assert daftar tampil; klik detail → assert isi; klik Terima → assert `acceptTicket` terpanggil. (Pola `src/src/test` existing untuk screen; mock `api.client`.)

- [x] **Step 2: Jalankan — gagal** · Run: `cd src && npx vitest run src/test/triage.test.tsx` · Expected: FAIL.

- [x] **Step 3: Client methods `src/src/api/client.ts`** (cermin metode errors)

```ts
  listTickets: (params: string) => get<{ items: TicketView[]; total: number; page: number; pageSize: number; unreviewed: number }>(`${apiPath.tickets}${params}`),
  getTicket: (id: string) => get<TicketDetail & { spec: any }>(apiPath.ticket(id)),
  acceptTicket: (id: string, priority?: string) => post(apiPath.ticketAccept(id), { priority }),
  rejectTicket: (id: string) => post(apiPath.ticketReject(id), {}),
  getHelpCenter: (id: string) => get<{ enabled: boolean; publicUrl: string }>(apiPath.projectHelpCenter(id)),
  enableHelpCenter: (id: string) => post<{ enabled: boolean; publicUrl: string }>(apiPath.projectHelpCenter(id), {}),
  disableHelpCenter: (id: string) => del(apiPath.projectHelpCenter(id)),
```
(Sesuaikan ke helper `get/post/del` yang dipakai file itu; import `TicketView, TicketDetail`.)

- [x] **Step 4: `TriageScreen.tsx`** (cermin `ErrorsScreen.tsx`: self-fetch + silent poll 5s, master→detail, filter project/status/search)

Detail menampilkan lampiran via `<img src={apiPath.ticketAttachment(id, attId)} />` (ber-auth via cookie same-origin). Tombol **Terima** (Select prioritas + konfirmasi) → `api.acceptTicket` → `onAccepted(spec)`; **Tolak** → `window.confirm` → `api.rejectTicket`. Badge "belum ditinjau" dari `unreviewed`.

- [x] **Step 5: Nav + App wiring**

`ds/shell.tsx` `HN_NAV` += `{ key: "triage", label: "Triase", icon: "inbox" }` (dekat errors). `App.tsx`: import `TriageScreen`; branch `section === "triage"` (pola errors) merender `<Shell active="triage" title="Triase" …><TriageScreen onAccepted={(spec)=>{ setProjectFilter(spec.projectId); setSection("backlog"); showToast(...); }} /></Shell>`.

- [x] **Step 6: `HelpCenterCard` di `ProjectDetailScreen.tsx`** (cermin `DsnCard`)

Toggle enable/disable (`api.enableHelpCenter`/`disableHelpCenter`); saat aktif tampil `publicUrl` (mono) + tombol Salin.

- [x] **Step 7: Notifikasi cabang `ticket`**

`NotificationsContext.tsx` `toastFor`: `type === "ticket"` → tone info, icon `inbox`, msg = `title`, enabled true, target `{ section: "triage", projectFilter }`. `NotificationBell.tsx`: cabang `ticket` (icon `inbox`, label "keluhan baru", aksi "Lihat triase"). `zNotification.type` sudah `z.string()` longgar — verifikasi menerima `ticket` (jika enum, tambah).

- [x] **Step 8: Docs SoT + ADR-0061**

Tulis `internal/docs/adr/0061-help-center-tiket-publik-triase.md` (Konteks/Keputusan/Konsekuensi/Alternatif/Acceptance EARS — pola ADR-0060). Update `data-model.md` (Ticket/TicketAttachment/Project.helpEnabled), `api-contract.md` (`/api/help/*` + `/tickets*` + `/projects/:id/help-center`), `security-standard.md` (pengecualian Help Center + lampiran ber-auth + rate-limit/honeypot), `frontend-implementation.md` (SPA routing publik + TriageScreen + HelpCenterCard + notif ticket). Tambah link ADR-0061 di `internal/docs/README.md`.

- [x] **Step 9: Jalankan test frontend + build** · Run: `cd src && npx vitest run src/test/triage.test.tsx && npx tsc --noEmit && npx vite build` · Expected: PASS + build sukses.

- [x] **Step 10: Commit**

```bash
git add src/src internal/docs
git commit -m "feat(spec-253): triage UI + HelpCenterCard + notifikasi ticket + docs SoT/ADR-0061"
```

---

### Task 9: Verifikasi end-to-end nyata (live smoke) + full suite

**Files:** (tak ada file baru — verifikasi)

- [x] **Step 1: Boot server ke DB throwaway** (bukan hanoman_test — sibling bisa truncate; pola memory live-smoke)

```bash
cd server
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman253_smoke" HANOMAN_UPLOAD_DIR=/tmp/hn253-smoke \
  sh -c 'npx prisma migrate deploy && node --import tsx src/server.ts' &
# tunggu listen 8787
```

- [x] **Step 2: Curl jalur end-to-end** (auth: setup akun dulu → cookie; enable help; submit; status; triase; accept; status lagi)

```bash
# setup + login → simpan cookie
curl -s -c /tmp/hc.jar -X POST localhost:8787/api/auth/setup -H 'content-type: application/json' -d '{"email":"a@b.co","password":"password1"}'
# buat project + enable help center
curl -s -b /tmp/hc.jar -X POST localhost:8787/api/projects -H 'content-type: application/json' -d '{"name":"Demo","kind":"existing","desc":""}'
curl -s -b /tmp/hc.jar -X POST localhost:8787/api/projects/demo/help-center   # → { enabled, publicUrl }
# submit publik (multipart, tanpa cookie)
curl -s -X POST localhost:8787/api/help/demo/tickets -F category=bug -F title=Rusak -F detail=Detil -F email=r@e.co   # → { number, key, statusPath }
# cek status publik
curl -s localhost:8787/api/help/demo/tickets/<key>   # → status "Sedang ditinjau"
# triase list + accept
curl -s -b /tmp/hc.jar 'localhost:8787/api/tickets?project=demo'
curl -s -b /tmp/hc.jar -X POST localhost:8787/api/tickets/<id>/accept -H 'content-type: application/json' -d '{"priority":"tinggi"}'
# status lagi → "Diterima"
curl -s localhost:8787/api/help/demo/tickets/<key>
```
Expected: submit 201; status "Sedang ditinjau" → setelah accept "Diterima"; accept membuat Spec source `help`.

- [x] **Step 3: Uji halaman publik di browser (smoke opsional)** — buka `http://localhost:8787/help/demo` (butuh `vite build` + NODE_ENV=production untuk static, atau `vite dev` proxy). Verifikasi form tampil & submit menampilkan nomor + link.

- [x] **Step 4: Full test suite**

Run:
```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-253
env -u NODE_ENV -u DATABASE_URL DATABASE_URL="postgresql://hanoman:hanoman@localhost:5433/hanoman253_test" HANOMAN_UPLOAD_DIR=/tmp/hn253-uploads npx vitest run --no-file-parallelism
```
Expected: seluruh test hijau (shared + server + src). Fix sampai hijau.

- [x] **Step 5: Bersihkan smoke** (kill server, hapus DB smoke opsional) & pastikan diff bersih.

- [x] **Step 6: Centang semua `- [x]` di plan ini menjadi `- [x]`, lalu commit final**

```bash
git add docs/superpowers internal/docs
git commit -m "docs(spec-253): tandai plan Help Center selesai + verifikasi end-to-end"
```

---

## Self-Review (writing-plans)

**Spec coverage:** aktivasi per project (T5), link publik stabil (T5 publicUrl + T7), halaman publik+form+lampiran (T7 + T4 multipart), endpoint publik pengecualian gate (T4 app.ts), model Ticket/Attachment+migration (T1), triase inbox+badge+detail+lampiran (T6+T8), promosi→Spec source help prefilled+dua-arah+idempoten (T6), tolak (T6), status publik derived (T3 publicStatus + T4 route + T7 halaman), notifikasi in-app+bell/toast (T5+T8), rate-limit+honeypot (T4), isolasi antar-project (T4/T6 scoping), kunci opaque hash-at-rest (T3), retensi (T6), ADR+docs SoT (T8/T9). ✔ Semua acceptance PRD ter-map.

**Placeholder scan:** kode konkret di tiap step server/shared; T7/T8 frontend memberi kode kunci (client, main.tsx, notif) + instruksi presisi berbasis pola SPEC-249 yang terdokumentasi (ErrorsScreen/DsnCard) untuk komponen React besar — bukan "TODO". ✔

**Type consistency:** `publicStatus`, `createTicket`, `generateAccessKey`/`hashAccessKey`, `helpRateOk`, `recordNewTicket`, `saveUpload/readUpload/deleteUpload/extFor`, `TicketView`/`TicketDetail`, path helper `help*`/`ticket*`/`projectHelpCenter` konsisten lintas task. `source:"help"` lolos `zCreateSpec` superRefine (brief payload) & `flowForSource("help")==="feature"` tanpa perubahan. ✔
