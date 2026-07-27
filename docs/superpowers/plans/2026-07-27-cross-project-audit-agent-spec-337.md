# Agen Audit Lintas Project (SPEC-337) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu sesi `claude` yang lahir sudah tahu project mana saja yang saling bergantung, bisa membaca kode & docs semuanya, dan bisa menarik timeline error gabungan mereka kapan saja selama sesi berjalan.

**Architecture:** Relasi antar project menjadi data (`ProjectLink`, berarah, LOCAL-only). Flow baru `cross-audit` melahirkan sesi dengan **satu** worktree (project utama) + path checkout tetangga read-only di prompt, lewat dua pintu: backlog item (`Audit → Laporan`, berdokumen) dan sesi lepas (tanya-jawab). Sesi memegang **kunci audit** yang hidup di tmux option — kunci itu menggerbangi `GET /api/audit/logs`, endpoint read-only yang mengembalikan timeline `ErrorEvent` semua project ter-scope, tercampur dan terurut waktu.

**Tech Stack:** Node 20+ · TypeScript strict · Fastify · Prisma/PostgreSQL · tmux + node-pty · React 18 + Vite · Vitest · zod (`@hanoman/shared`).

## Global Constraints

- **ADR acuan:** [ADR-0075](../../../internal/docs/adr/0075-audit-lintas-project-projectlink-kunci-sesi.md). Desain lengkap: `docs/superpowers/specs/2026-07-27-spec-337-cross-project-audit-agent-design.md`.
- **Bahasa komentar & string UI:** Indonesia (ikuti gaya file yang disentuh). Nama simbol tetap Inggris.
- **Enum baru = `String` + zod di `@hanoman/shared`**, bukan enum Prisma (aturan data-model).
- **Migration ditulis tangan** + `prisma migrate deploy` per DB dengan env override — JANGAN `migrate dev` (reset saat ada drift worktree). Sesudahnya `prisma generate`.
- **DB test:** `DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337` → suite memakai `hanoman337_test`. Migrasikan DB itu sendiri sebelum menjalankan test server.
- **Perintah test:** `env -u NODE_ENV -u DATABASE_URL pnpm test` (env sesi bisa menunjuk prod) atau per paket seperti ditulis di tiap task. Test server WAJIB `--no-file-parallelism`.
- **Kunci audit TIDAK BOLEH** muncul di `SessionInfo`, `GET /terminal/sessions`, log, atau response mana pun.
- **`ProjectLink` LOCAL-only:** JANGAN menambahkannya ke `SYNCED`/`FIELDS` di `server/src/services/sync.ts`.
- **Nilai `kind` relasi:** `api` | `sdk` | `data` | `event` | `lainnya` (persis, huruf kecil).
- **Nama fase sesi cross-audit:** `Audit` lalu `Laporan` (persis — dipetakan `REACHED` yang sudah ada).
- **Prefix kunci audit:** `hnm_xa_` + 32 hex. **Header:** `X-Hanoman-Audit-Key`.
- Setiap task berakhir dengan commit; docs SoT sudah ditulis di fase Spec — jangan tulis ulang, cukup rujuk.

---

### Task 1: Model `ProjectLink` + resolusi tetangga

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Project` + model baru di akhir file)
- Create: `server/prisma/migrations/2026072701_spec337_project_link/migration.sql`
- Modify: `shared/src/enums.ts`
- Create: `server/src/services/project-links.ts`
- Test: `server/test/project-links.service.test.ts`

**Interfaces:**
- Consumes: `prisma` dari `server/src/db`.
- Produces:
  - `zLinkKind` (zod enum) dari `@hanoman/shared`
  - `type LinkDirection = "keluar" | "masuk"`
  - `type LinkView = { id, fromProjectId, toProjectId, kind, note, direction, other: { id, name } }`
  - `linksOf(projectId): Promise<ProjectLink[]>`
  - `neighborIds(projectId, links): string[]`
  - `linkViews(projectId, links): Promise<LinkView[]>`
  - `auditScopeOf(projectId): Promise<string[]>` — `[projectId, ...neighborIds]`

- [x] **Step 1: Tambahkan enum jenis relasi ke shared**

Di akhir `shared/src/enums.ts`:

```ts
export const zLinkKind = z.enum(["api","sdk","data","event","lainnya"]);  // SPEC-337 · ADR-0075 · jenis relasi antar project
```

- [x] **Step 2: Tambahkan model Prisma**

Di `server/prisma/schema.prisma`, pada model `Project`, tambahkan dua relasi balik tepat di bawah baris `sourceMaps  SourceMapArtifact[] …`:

```prisma
  linksOut    ProjectLink[] @relation("ProjectLinkFrom") // SPEC-337 · project ini bergantung pada …
  linksIn     ProjectLink[] @relation("ProjectLinkTo")   // SPEC-337 · … yang bergantung pada project ini
```

Lalu tambahkan model baru di akhir file:

```prisma
// SPEC-337 · ADR-0075 · relasi integrasi/dependency BERARAH antar project: from BERGANTUNG PADA to.
// LOCAL-only (tak masuk SYNCED): id cuid + unique pasangan bertabrakan saat upsert-by-id lintas device.
// onUpdate: Cascade → rename project (ADR-0064) merambat gratis; tak ada ref longgar baru.
model ProjectLink {
  id            String   @id @default(cuid())
  fromProjectId String
  toProjectId   String
  kind          String   // api | sdk | data | event | lainnya (zLinkKind)
  note          String   @default("") // bentuk integrasinya — disalin apa adanya ke prompt sesi audit lintas
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  from Project @relation("ProjectLinkFrom", fields: [fromProjectId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  to   Project @relation("ProjectLinkTo",   fields: [toProjectId],   references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([fromProjectId, toProjectId])
  @@index([toProjectId])
}
```

- [x] **Step 3: Tulis migration.sql**

Buat `server/prisma/migrations/2026072701_spec337_project_link/migration.sql`:

```sql
-- SPEC-337 · ADR-0075 · relasi integrasi/dependency antar project (LOCAL-only, tak disync).
-- Aditif: satu tabel baru. Tak menyentuh kolom mana pun yang sudah ada.
CREATE TABLE "ProjectLink" (
  "id"            TEXT NOT NULL,
  "fromProjectId" TEXT NOT NULL,
  "toProjectId"   TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "note"          TEXT NOT NULL DEFAULT '',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectLink_fromProjectId_toProjectId_key" ON "ProjectLink"("fromProjectId", "toProjectId");
CREATE INDEX "ProjectLink_toProjectId_idx" ON "ProjectLink"("toProjectId");

ALTER TABLE "ProjectLink" ADD CONSTRAINT "ProjectLink_fromProjectId_fkey"
  FOREIGN KEY ("fromProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectLink" ADD CONSTRAINT "ProjectLink_toProjectId_fkey"
  FOREIGN KEY ("toProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [x] **Step 4: Terapkan migration ke DB dev + test, lalu generate client**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-337
DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx prisma migrate deploy --schema server/prisma/schema.prisma
DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337_test" npx prisma migrate deploy --schema server/prisma/schema.prisma
npx prisma generate --schema server/prisma/schema.prisma
```

Bila DB `hanoman337`/`hanoman337_test` belum ada:

```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman337;'
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman337_test;'
```

Expected: `migrate deploy` mencetak `1 migration found` … `applied` (atau daftar migrasi yang menyusul) dan berakhir tanpa error; `generate` mencetak `Generated Prisma Client`.

- [x] **Step 5: Tulis test yang gagal untuk service tetangga**

Buat `server/test/project-links.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { linksOf, neighborIds, linkViews, auditScopeOf } from "../src/services/project-links";

const clean = async () => {
  await prisma.projectLink.deleteMany();
  await prisma.project.deleteMany();
};

beforeEach(async () => {
  await clean();
  await prisma.project.createMany({ data: [
    { id: "web", name: "Web", desc: "", kind: "existing" },
    { id: "api", name: "API", desc: "", kind: "existing" },
    { id: "sdk", name: "SDK", desc: "", kind: "existing" },
    { id: "lepas", name: "Lepas", desc: "", kind: "existing" },
  ] });
  await prisma.projectLink.create({ data: { fromProjectId: "web", toProjectId: "api", kind: "api", note: "web memanggil /api/orders" } });
  await prisma.projectLink.create({ data: { fromProjectId: "api", toProjectId: "sdk", kind: "sdk", note: "api memakai hanoman-sdk" } });
});
afterAll(clean);

describe("project-links", () => {
  it("mengambil relasi kedua arah milik satu project", async () => {
    const links = await linksOf("api");
    expect(links).toHaveLength(2);
  });

  it("menurunkan tetangga satu hop dari kedua arah, tanpa dirinya sendiri", async () => {
    expect((await linksOf("api")).length).toBe(2);
    expect(neighborIds("api", await linksOf("api")).sort()).toEqual(["sdk", "web"]);
    expect(neighborIds("web", await linksOf("web"))).toEqual(["api"]);
    expect(neighborIds("lepas", await linksOf("lepas"))).toEqual([]);
  });

  it("tidak mengikuti relasi transitif (satu hop saja)", async () => {
    expect(neighborIds("web", await linksOf("web"))).not.toContain("sdk");
  });

  it("memberi arah + nama lawan relatif project yang dilihat", async () => {
    const views = await linkViews("api", await linksOf("api"));
    const masuk = views.find((v) => v.direction === "masuk")!;
    const keluar = views.find((v) => v.direction === "keluar")!;
    expect(masuk.other).toEqual({ id: "web", name: "Web" });
    expect(masuk.kind).toBe("api");
    expect(keluar.other).toEqual({ id: "sdk", name: "SDK" });
    expect(keluar.note).toBe("api memakai hanoman-sdk");
  });

  it("scope audit = project utama lebih dulu, lalu tetangganya", async () => {
    const scope = await auditScopeOf("api");
    expect(scope[0]).toBe("api");
    expect(scope.slice(1).sort()).toEqual(["sdk", "web"]);
    expect(await auditScopeOf("lepas")).toEqual(["lepas"]);
  });

  it("hapus project menghapus relasi yang menyentuhnya (cascade FK)", async () => {
    await prisma.project.delete({ where: { id: "sdk" } });
    expect(await prisma.projectLink.count()).toBe(1);
  });
});
```

- [x] **Step 6: Jalankan test — harus gagal**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/project-links.service.test.ts --no-file-parallelism
```

Expected: FAIL — `Failed to resolve import "../src/services/project-links"`.

- [x] **Step 7: Implementasikan service**

Buat `server/src/services/project-links.ts`:

```ts
import { prisma } from "../db";
import type { ProjectLink } from "@prisma/client";

// SPEC-337 · ADR-0075 · relasi integrasi antar project. Berarah (from BERGANTUNG PADA to), tapi
// "tetangga" sebuah project selalu union KEDUA arah — issue integrasi tak peduli siapa pemanggil.
// Satu hop, bukan closure transitif: batasnya harus bisa diterangkan dalam satu kalimat.
export type LinkDirection = "keluar" | "masuk";
export type LinkView = {
  id: string; fromProjectId: string; toProjectId: string; kind: string; note: string;
  direction: LinkDirection; other: { id: string; name: string };
};

export const linksOf = (projectId: string): Promise<ProjectLink[]> =>
  prisma.projectLink.findMany({
    where: { OR: [{ fromProjectId: projectId }, { toProjectId: projectId }] },
    orderBy: { createdAt: "asc" },
  });

export function neighborIds(projectId: string, links: ProjectLink[]): string[] {
  const out = new Set<string>();
  for (const l of links) {
    const other = l.fromProjectId === projectId ? l.toProjectId : l.fromProjectId;
    if (other !== projectId) out.add(other);   // self-link ditolak di boundary, tapi jangan pernah jadi tetangga
  }
  return [...out];
}

export async function linkViews(projectId: string, links: ProjectLink[]): Promise<LinkView[]> {
  const ids = neighborIds(projectId, links);
  const rows = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(rows.map((p) => [p.id, p.name]));
  return links.map((l) => {
    const direction: LinkDirection = l.fromProjectId === projectId ? "keluar" : "masuk";
    const otherId = direction === "keluar" ? l.toProjectId : l.fromProjectId;
    return {
      id: l.id, fromProjectId: l.fromProjectId, toProjectId: l.toProjectId,
      kind: l.kind, note: l.note, direction,
      other: { id: otherId, name: names.get(otherId) ?? otherId },
    };
  });
}

// Scope sesi audit lintas: project utama DULU (urutan dipakai prompt), lalu tetangganya.
export async function auditScopeOf(projectId: string): Promise<string[]> {
  return [projectId, ...neighborIds(projectId, await linksOf(projectId))];
}
```

- [x] **Step 8: Jalankan test — harus lolos**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/project-links.service.test.ts --no-file-parallelism
```

Expected: PASS (6 test).

- [x] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations shared/src/enums.ts server/src/services/project-links.ts server/test/project-links.service.test.ts
git commit -m "feat(spec-337): model ProjectLink + resolusi tetangga satu hop"
```

---

### Task 2: CRUD relasi di API project

**Files:**
- Modify: `shared/src/dto.ts` (schema `zCreateLink`)
- Modify: `server/src/routes/projects.ts` (3 endpoint baru, di akhir handler default export)
- Test: `server/test/project-links.route.test.ts`

**Interfaces:**
- Consumes: `linksOf`, `linkViews` (Task 1); `zLinkKind` (Task 1).
- Produces:
  - `zCreateLink` = `z.object({ to: z.string().min(1), kind: zLinkKind, note: z.string().max(2000).optional() })`
  - `GET /api/projects/:id/links` → `{ links: LinkView[] }`
  - `POST /api/projects/:id/links` → 201 `LinkView`
  - `DELETE /api/projects/:id/links/:linkId` → 204

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/project-links.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.projectLink.deleteMany();
  await prisma.project.deleteMany();
};

beforeEach(async () => {
  await clean();
  await prisma.project.createMany({ data: [
    { id: "web", name: "Web", desc: "", kind: "existing" },
    { id: "api", name: "API", desc: "", kind: "existing" },
  ] });
});
afterAll(clean);

describe("relasi antar project", () => {
  it("membuat relasi berarah lalu mengembalikannya di kedua project", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/web/links",
      payload: { to: "api", kind: "api", note: "web memanggil /api/orders" } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ fromProjectId: "web", toProjectId: "api", kind: "api", direction: "keluar", other: { id: "api", name: "API" } });

    const dariWeb = (await app.inject({ method: "GET", url: "/api/projects/web/links" })).json().links;
    expect(dariWeb).toHaveLength(1);
    expect(dariWeb[0].direction).toBe("keluar");

    const dariApi = (await app.inject({ method: "GET", url: "/api/projects/api/links" })).json().links;
    expect(dariApi).toHaveLength(1);
    expect(dariApi[0].direction).toBe("masuk");
    expect(dariApi[0].other.id).toBe("web");
  });

  it("menolak self-link (400)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "web", kind: "api" } });
    expect(r.statusCode).toBe(400);
  });

  it("menolak kind di luar katalog (400)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "grpc" } });
    expect(r.statusCode).toBe(400);
  });

  it("404 bila project atau target tak ada", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/hantu/links", payload: { to: "api", kind: "api" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "hantu", kind: "api" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/projects/hantu/links" })).statusCode).toBe(404);
  });

  it("409 bila pasangan berarah sudah ada", async () => {
    await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "api" } });
    const r = await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "data" } });
    expect(r.statusCode).toBe(409);
  });

  it("mengizinkan arah sebaliknya sebagai relasi terpisah", async () => {
    await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "api" } });
    const r = await app.inject({ method: "POST", url: "/api/projects/api/links", payload: { to: "web", kind: "event" } });
    expect(r.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/projects/web/links" })).json().links).toHaveLength(2);
  });

  it("menghapus relasi dari kedua sisi, 404 bila tak menyentuh project itu", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/projects/web/links", payload: { to: "api", kind: "api" } })).json();
    await prisma.project.create({ data: { id: "lain", name: "Lain", desc: "", kind: "existing" } });
    expect((await app.inject({ method: "DELETE", url: `/api/projects/lain/links/${created.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/projects/api/links/${created.id}` })).statusCode).toBe(204);
    expect(await prisma.projectLink.count()).toBe(0);
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/project-links.route.test.ts --no-file-parallelism
```

Expected: FAIL — semua request menjawab 404 (route belum ada).

- [x] **Step 3: Tambahkan schema body ke shared**

Di `shared/src/dto.ts`, setelah blok `zRenameProject` (cari `export const zRenameProject`), tambahkan:

```ts
// SPEC-337 · ADR-0075 · relasi integrasi/dependency antar project (from = project di path, BERGANTUNG PADA to).
export const zCreateLink = z.object({
  to: z.string().min(1),
  kind: zLinkKind,
  note: z.string().max(2000).optional(),
});
export type CreateLink = z.infer<typeof zCreateLink>;
```

Pastikan `zLinkKind` ikut di-import/ekspor: `shared/src/dto.ts` sudah mengimpor dari `./enums` — tambahkan `zLinkKind` ke daftar import yang ada di bagian atas file.

- [x] **Step 4: Implementasikan route**

Di `server/src/routes/projects.ts`, tambahkan import:

```ts
import { zCreateProject, zUpdateProject, zRenameProject, zCreateLink } from "@hanoman/shared";
import { linksOf, linkViews } from "../services/project-links";
```

lalu tambahkan sebelum `}` penutup handler default export:

```ts
  // SPEC-337 · ADR-0075 · relasi integrasi/dependency antar project. LOCAL-only (tak disync):
  // JANGAN panggil notifySynced di sini. Ubah = hapus + tambah (tanpa PATCH).
  app.get("/projects/:id/links", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    return { links: await linkViews(id, await linksOf(id)) };
  });
  app.post("/projects/:id/links", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zCreateLink.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { to, kind, note } = parsed.data;
    if (to === id) return reply.code(400).send({ error: "project tak bisa bergantung pada dirinya sendiri" });
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    if (!(await prisma.project.findUnique({ where: { id: to } }))) return reply.code(404).send({ error: `project "${to}" tak ada` });
    const existing = await prisma.projectLink.findUnique({ where: { fromProjectId_toProjectId: { fromProjectId: id, toProjectId: to } } });
    if (existing) return reply.code(409).send({ error: `relasi ${id} → ${to} sudah ada` });
    const created = await prisma.projectLink.create({ data: { fromProjectId: id, toProjectId: to, kind, note: note ?? "" } });
    const [view] = await linkViews(id, [created]);
    return reply.code(201).send(view);
  });
  app.delete("/projects/:id/links/:linkId", async (req, reply) => {
    const { id, linkId } = req.params as { id: string; linkId: string };
    const link = await prisma.projectLink.findUnique({ where: { id: linkId } });
    // Relasi yang tak menyentuh project ini = 404 (bukan 403): pemiliknya tak perlu dibocorkan.
    if (!link || (link.fromProjectId !== id && link.toProjectId !== id))
      return reply.code(404).send({ error: "not found" });
    await prisma.projectLink.delete({ where: { id: linkId } });
    return reply.code(204).send();
  });
```

- [x] **Step 5: Jalankan test — harus lolos**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/project-links.route.test.ts --no-file-parallelism
```

Expected: PASS (7 test).

- [x] **Step 6: Commit**

```bash
git add shared/src/dto.ts server/src/routes/projects.ts server/test/project-links.route.test.ts
git commit -m "feat(spec-337): endpoint CRUD relasi integrasi antar project"
```

---

### Task 3: Kunci audit ber-scope sesi (tmux option + env sesi)

**Files:**
- Modify: `server/src/services/pty.ts` (`FMT`, `Pane`, `CreateOpts`, `createSession`, ekspor baru)
- Create: `server/src/services/audit-scope.ts`
- Test: `server/test/audit-scope.test.ts`

**Interfaces:**
- Consumes: `listPanes` internal pty.
- Produces:
  - `pty.auditSessionScope(key: string): string[] | null` — scope sesi HIDUP pemilik kunci; `null` bila tak cocok/mati/kosong
  - `CreateOpts.env?: Record<string, string>` — env tambahan di depan argv sesi
  - `CreateOpts.audit?: { key: string; projects: string[] }` — dipasang sebagai tmux option
  - `audit-scope.ts`: `AUDIT_KEY_HEADER = "x-hanoman-audit-key"`, `newAuditKey()`, `auditApiUrl()`, `auditScopeFromReq(req)`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/audit-scope.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createSession, killAll, listSessions } from "../src/services/pty";
import { auditScopeFromReq, newAuditKey, AUDIT_KEY_HEADER } from "../src/services/audit-scope";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const req = (key?: string) => ({ headers: key ? { [AUDIT_KEY_HEADER]: key } : {} });

beforeEach(() => killAll());
afterAll(() => killAll());

describe("kunci audit ber-scope sesi", () => {
  it("membuat kunci berprefiks hnm_xa_ yang tak pernah sama", () => {
    const a = newAuditKey(), b = newAuditKey();
    expect(a).toMatch(/^hnm_xa_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("mengembalikan scope sesi hidup pemilik kunci", () => {
    const key = newAuditKey();
    const cwd = mkdtempSync(join(tmpdir(), "hanoman-xa-"));
    createSession("web", cwd, { id: "xa-test", command: ["sleep", "30"], audit: { key, projects: ["web", "api"] } });
    expect(auditScopeFromReq(req(key))).toEqual(["web", "api"]);
  });

  it("null untuk kunci tak dikenal, kosong, atau tanpa header", () => {
    expect(auditScopeFromReq(req())).toBeNull();
    expect(auditScopeFromReq(req(""))).toBeNull();
    expect(auditScopeFromReq(req("hnm_xa_deadbeef"))).toBeNull();
  });

  it("null setelah sesinya mati", async () => {
    const key = newAuditKey();
    const cwd = mkdtempSync(join(tmpdir(), "hanoman-xa-"));
    createSession("web", cwd, { id: "xa-mati", command: ["true"], audit: { key, projects: ["web"] } });
    await new Promise((r) => setTimeout(r, 800));
    expect(auditScopeFromReq(req(key))).toBeNull();
  });

  it("kunci TIDAK PERNAH muncul di listSessions", () => {
    const key = newAuditKey();
    const cwd = mkdtempSync(join(tmpdir(), "hanoman-xa-"));
    createSession("web", cwd, { id: "xa-bocor", command: ["sleep", "30"], audit: { key, projects: ["web"] } });
    expect(JSON.stringify(listSessions())).not.toContain(key);
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/audit-scope.test.ts --no-file-parallelism
```

Expected: FAIL — `Failed to resolve import "../src/services/audit-scope"`.

- [x] **Step 3: Perluas pty.ts**

Di `server/src/services/pty.ts`:

(a) Perluas `FMT` — tambahkan dua field di akhir array:

```ts
const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}", "#{@hanoman_branch}",
  // SPEC-337 · ADR-0075 · kunci audit lintas project + scope-nya. Hidup di tmux (bukan DB): selamat
  // dari restart API, mati bersama pane. TAK PERNAH ikut ke SessionInfo/API — lihat listSessions.
  "#{@hanoman_audit_key}", "#{@hanoman_audit_projects}",
].join("\t");
```

(b) Perluas tipe `Pane` dan parsing `listPanes`:

```ts
type Pane = SessionInfo & { code: number; phaseFile?: string; decisionFile?: string; auditKey?: string; auditProjects?: string };
```

Di dalam `listPanes`, ganti baris destructuring dan objek yang dikembalikan:

```ts
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch, auditKey, auditProjects] = line.split("\t");
```

dan tambahkan dua field pada objek hasil (setelah `decisionFile: decisionFile || undefined,`):

```ts
      auditKey: auditKey || undefined,
      auditProjects: auditProjects || undefined,
```

(c) Tambahkan ekspor lookup, tepat setelah `export const getSession = …`:

```ts
// SPEC-337 · ADR-0075 · scope sesi cross-audit pemilik kunci. Hanya pane HIDUP yang dihitung —
// sesi mati = kunci mati, tanpa revoke. Scope kosong diperlakukan tak sah (sesi selalu punya
// minimal project-nya sendiri), jadi pemanggil tak pernah menerima daftar kosong yang menipu.
export function auditSessionScope(key: string): string[] | null {
  if (!key) return null;
  const p = listPanes().find((x) => x.auditKey === key && !x.exited);
  if (!p) return null;
  const scope = (p.auditProjects ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return scope.length ? scope : null;
}
```

(d) Perluas `CreateOpts`:

```ts
export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; branch?: string; prompt?: string; phaseFile?: string;
  decisionFile?: string; model?: string; effort?: string; command?: string[];
  // SPEC-332 · ADR-0073 · kondisi mode goal; kosong = mode goal mati untuk sesi ini.
  goal?: string;
  // SPEC-337 · ADR-0075 · env tambahan di depan argv sesi (mis. kunci+URL audit lintas).
  env?: Record<string, string>;
  // SPEC-337 · ADR-0075 · kunci audit + daftar project ter-scope, dipasang sebagai tmux option.
  audit?: { key: string; projects: string[] };
};
```

(e) Ganti blok pembangun `cmd` (yang sekarang hanya menangani `phaseFile`) dengan:

```ts
  // Env di depan perintah, bukan `new-session -e`: tmux menyerahkan sisa argv-nya ke shell,
  // jadi penugasan env bekerja di semua versi tmux sementara `-e` baru ada sejak 3.0.
  // Direktorinya dibuat di sini — `echo >> berkas` milik agen tak membuat direktori induk.
  const envPairs: string[] = [];
  if (opts.phaseFile) {
    mkdirSync(dirname(opts.phaseFile), { recursive: true });
    envPairs.push(`HANOMAN_PHASE_FILE=${sq(opts.phaseFile)}`);
  }
  // SPEC-337 · env sesi cross-audit (HANOMAN_AUDIT_KEY/URL) lewat jalur yang sama.
  for (const [k, v] of Object.entries(opts.env ?? {})) envPairs.push(`${k}=${sq(v)}`);
  const cmd = envPairs.length ? `${envPairs.join(" ")} ${argv}` : argv;
```

(f) Setelah baris `if (opts.decisionFile) tmux("set-option", …)`, tambahkan:

```ts
  // SPEC-337 · ADR-0075 · kunci audit + scope-nya. Dibaca auditSessionScope saat request masuk.
  if (opts.audit) {
    tmux("set-option", "-t", name(id), "@hanoman_audit_key", opts.audit.key);
    tmux("set-option", "-t", name(id), "@hanoman_audit_projects", opts.audit.projects.join(","));
  }
```

- [x] **Step 4: Implementasikan audit-scope.ts**

Buat `server/src/services/audit-scope.ts`:

```ts
import { randomBytes } from "node:crypto";
import { auditSessionScope } from "./pty";

// SPEC-337 · ADR-0075 · kunci audit lintas project: dipegang SESI claude milik hanoman sendiri
// (bukan agen eksternal — bandingkan ADR-0065). Hidup di tmux option, mati bersama pane-nya.
export const AUDIT_KEY_HEADER = "x-hanoman-audit-key";

export const newAuditKey = (): string => `hnm_xa_${randomBytes(16).toString("hex")}`;

// Sesi memanggil API di mesin yang sama; server bind 127.0.0.1 (ADR-0028).
export const auditApiUrl = (): string => `http://127.0.0.1:${process.env.PORT ?? 8787}/api/audit`;

// null = tak ada kunci sah → request harus lewat auth normal (cookie/agent token).
export function auditScopeFromReq(req: { headers: Record<string, unknown> }): string[] | null {
  const raw = req.headers[AUDIT_KEY_HEADER];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== "string" || !key) return null;
  return auditSessionScope(key);
}
```

- [x] **Step 5: Jalankan test — harus lolos**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/audit-scope.test.ts --no-file-parallelism
```

Expected: PASS (5 test).

- [x] **Step 6: Pastikan sesi lama tak rusak**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/terminal.route.test.ts --no-file-parallelism
```

Expected: PASS — perluasan `FMT`/env tak boleh menggeser field mana pun yang sudah dibaca.

- [x] **Step 7: Commit**

```bash
git add server/src/services/pty.ts server/src/services/audit-scope.ts server/test/audit-scope.test.ts
git commit -m "feat(spec-337): kunci audit ber-scope sesi di tmux option + env sesi"
```

---

### Task 4: `GET /api/audit/logs` — timeline error lintas project

**Files:**
- Create: `server/src/routes/audit.ts`
- Modify: `server/src/app.ts` (import, pengecualian gate, register)
- Test: `server/test/audit-logs.route.test.ts`

**Interfaces:**
- Consumes: `auditScopeFromReq`, `AUDIT_KEY_HEADER` (Task 3); `symbolicateFrames`/`findSourceMap` (SPEC-276).
- Produces:
  - `parseWhen(v: string | undefined, fallback: Date, now: Date): Date | null` (diekspor untuk test)
  - `GET /api/audit/logs` → `{ window, scope, groups, timeline }`
  - `GET /api/audit/logs/:groupId` → detail grup + events

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/audit-logs.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { parseWhen } from "../src/routes/audit";
import { createSession, killAll } from "../src/services/pty";
import { newAuditKey, AUDIT_KEY_HEADER } from "../src/services/audit-scope";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.errorEvent.deleteMany();
  await prisma.errorGroup.deleteMany();
  await prisma.projectLink.deleteMany();
  await prisma.project.deleteMany();
};

let key = "";
let webGroupId = "";
let lepasGroupId = "";

beforeEach(async () => {
  killAll();
  await clean();
  await prisma.project.createMany({ data: [
    { id: "web", name: "Web", desc: "", kind: "existing" },
    { id: "api", name: "API", desc: "", kind: "existing" },
    { id: "lepas", name: "Lepas", desc: "", kind: "existing" },
  ] });
  const now = Date.now();
  const g1 = await prisma.errorGroup.create({ data: { projectId: "web", fingerprint: "w1", type: "TypeError", message: "orders gagal dimuat", environment: "production", count: 3, lastSeenAt: new Date(now - 60_000) } });
  const g2 = await prisma.errorGroup.create({ data: { projectId: "api", fingerprint: "a1", type: "TimeoutError", message: "upstream timeout", environment: "production", count: 2, lastSeenAt: new Date(now - 61_000) } });
  const g3 = await prisma.errorGroup.create({ data: { projectId: "lepas", fingerprint: "l1", type: "Error", message: "bukan urusan kita", environment: "production", count: 1, lastSeenAt: new Date(now - 62_000) } });
  webGroupId = g1.id; lepasGroupId = g3.id;
  await prisma.errorEvent.createMany({ data: [
    { groupId: g1.id, projectId: "web", type: "TypeError", message: "orders gagal dimuat", environment: "production", receivedAt: new Date(now - 60_000) },
    { groupId: g2.id, projectId: "api", type: "TimeoutError", message: "upstream timeout", environment: "production", receivedAt: new Date(now - 61_000) },
    { groupId: g2.id, projectId: "api", type: "TimeoutError", message: "upstream timeout", environment: "dev", receivedAt: new Date(now - 62_000) },
    { groupId: g3.id, projectId: "lepas", type: "Error", message: "bukan urusan kita", environment: "production", receivedAt: new Date(now - 30_000) },
    // di luar jendela default 24 jam
    { groupId: g1.id, projectId: "web", type: "TypeError", message: "orders gagal dimuat", environment: "production", receivedAt: new Date(now - 3 * 86_400_000) },
  ] });
  key = newAuditKey();
  const cwd = mkdtempSync(join(tmpdir(), "hanoman-xa-"));
  createSession("web", cwd, { id: "xa-logs", command: ["sleep", "30"], audit: { key, projects: ["web", "api"] } });
});
afterAll(async () => { killAll(); await clean(); });

const hdr = { [AUDIT_KEY_HEADER]: key } as Record<string, string>;

describe("parseWhen", () => {
  const now = new Date("2026-07-27T12:00:00Z");
  it("menerima durasi relatif", () => {
    expect(parseWhen("24h", now, now)!.toISOString()).toBe("2026-07-26T12:00:00.000Z");
    expect(parseWhen("7d", now, now)!.toISOString()).toBe("2026-07-20T12:00:00.000Z");
    expect(parseWhen("30m", now, now)!.toISOString()).toBe("2026-07-27T11:30:00.000Z");
  });
  it("menerima ISO-8601 dan memakai fallback saat kosong", () => {
    expect(parseWhen("2026-07-01T00:00:00Z", now, now)!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(parseWhen(undefined, now, now)).toBe(now);
  });
  it("null untuk yang tak terparse", () => {
    expect(parseWhen("kemarin", now, now)).toBeNull();
  });
});

describe("GET /api/audit/logs", () => {
  it("mencampur & mengurutkan event semua project ter-scope", async () => {
    const r = await app.inject({ method: "GET", url: "/api/audit/logs", headers: { ...hdr } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.scope.map((p: { id: string }) => p.id).sort()).toEqual(["api", "web"]);
    const ids = b.timeline.map((e: { projectId: string }) => e.projectId);
    expect(ids).toContain("web");
    expect(ids).toContain("api");
    expect(ids).not.toContain("lepas");        // di luar scope sesi
    const at = b.timeline.map((e: { at: string }) => new Date(e.at).getTime());
    expect([...at].sort((x, y) => y - x)).toEqual(at);   // terurut desc
    expect(b.groups.map((g: { projectId: string }) => g.projectId)).not.toContain("lepas");
  });

  it("memotong di jendela waktu (default 24 jam)", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/audit/logs", headers: { ...hdr } })).json();
    expect(b.timeline).toHaveLength(3);       // event 3 hari lalu tak ikut
    const luas = (await app.inject({ method: "GET", url: "/api/audit/logs?since=7d", headers: { ...hdr } })).json();
    expect(luas.timeline).toHaveLength(4);
  });

  it("memfilter environment dan kata kunci", async () => {
    const dev = (await app.inject({ method: "GET", url: "/api/audit/logs?environment=dev&since=7d", headers: { ...hdr } })).json();
    expect(dev.timeline).toHaveLength(1);
    const q = (await app.inject({ method: "GET", url: "/api/audit/logs?q=timeout", headers: { ...hdr } })).json();
    expect(q.timeline.every((e: { projectId: string }) => e.projectId === "api")).toBe(true);
  });

  it("menyempitkan ke subset scope lewat ?projects=", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/audit/logs?projects=api", headers: { ...hdr } })).json();
    expect(b.timeline.every((e: { projectId: string }) => e.projectId === "api")).toBe(true);
  });

  it("403 bila meminta project di luar scope", async () => {
    const r = await app.inject({ method: "GET", url: "/api/audit/logs?projects=lepas", headers: { ...hdr } });
    expect(r.statusCode).toBe(403);
  });

  it("400 bila since tak terparse", async () => {
    const r = await app.inject({ method: "GET", url: "/api/audit/logs?since=kemarin", headers: { ...hdr } });
    expect(r.statusCode).toBe(400);
  });
});

describe("GET /api/audit/logs/:groupId", () => {
  it("mengembalikan detail grup di dalam scope", async () => {
    const r = await app.inject({ method: "GET", url: `/api/audit/logs/${webGroupId}`, headers: { ...hdr } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ projectId: "web", type: "TypeError" });
    expect(Array.isArray(r.json().events)).toBe(true);
  });

  it("404 untuk grup di luar scope", async () => {
    const r = await app.inject({ method: "GET", url: `/api/audit/logs/${lepasGroupId}`, headers: { ...hdr } });
    expect(r.statusCode).toBe(404);
  });
});
```

Test gate ditaruh **di file yang sama** (`audit-logs.route.test.ts`, blok `describe("gate /api/audit")`) alih-alih menyisip ke `agent-gate.test.ts` — kolokasi dengan endpoint yang digerbanginya:

```ts
describe("SPEC-337 · gate /api/audit", () => {
  it("401 tanpa kunci audit dan tanpa cookie", async () => {
    const gated = buildApp();   // requireAuth default true
    const r = await gated.inject({ method: "GET", url: "/api/audit/logs" });
    expect(r.statusCode).toBe(401);
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/audit-logs.route.test.ts --no-file-parallelism
```

Expected: FAIL — `Failed to resolve import "../src/routes/audit"`.

- [x] **Step 3: Implementasikan route**

Buat `server/src/routes/audit.ts`:

```ts
// SPEC-337 · ADR-0075 · permukaan baca log untuk SESI cross-audit milik hanoman sendiri.
// Read-only & ber-scope: hanya ErrorGroup/ErrorEvent project di scope sesi (utama + tetangga
// ProjectLink satu hop). Gate /api meloloskan prefix ini bila X-Hanoman-Audit-Key cocok dengan
// pane tmux HIDUP (app.ts) — cermin pengecualian DSN ingest (ADR-0060).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db";
import { auditScopeFromReq } from "../services/audit-scope";
import { symbolicateFrames, type FrameLike } from "../services/symbolicate";
import { findSourceMap } from "../services/sourcemap-store";
import type { ErrorGroup, ErrorEvent } from "@prisma/client";

const REL = /^(\d+)([mhd])$/;
const MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

// "24h" | "7d" | "30m" | ISO-8601. Kosong → fallback. null = tak terparse (route menjawab 400).
export function parseWhen(v: string | undefined, fallback: Date, now: Date): Date | null {
  if (!v) return fallback;
  const m = REL.exec(v.trim());
  if (m) return new Date(now.getTime() - Number(m[1]) * MS[m[2]!]!);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const groupView = (g: ErrorGroup) => ({
  id: g.id, projectId: g.projectId, type: g.type, message: g.message, environment: g.environment,
  release: g.release, status: g.status, count: g.count, firstSeenAt: g.firstSeenAt,
  lastSeenAt: g.lastSeenAt, specId: g.specId,
});
const timelineView = (e: ErrorEvent) => ({
  at: e.receivedAt, projectId: e.projectId, groupId: e.groupId,
  type: e.type, message: e.message, environment: e.environment, release: e.release,
});

// Kunci sesi → scope sesi. Tanpa kunci, satu-satunya pemanggil yang lolos gate adalah cookie
// sesi (akses penuh, tanpa RBAC) → seluruh project.
async function scopeFor(req: FastifyRequest): Promise<string[]> {
  const s = auditScopeFromReq(req as unknown as { headers: Record<string, unknown> });
  if (s) return s;
  return (await prisma.project.findMany({ select: { id: true } })).map((p) => p.id);
}

export default async function (app: FastifyInstance) {
  app.get("/audit/logs", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const now = new Date();
    const since = parseWhen(q.since, new Date(now.getTime() - MS.d!), now);
    const until = parseWhen(q.until, now, now);
    if (!since || !until) return reply.code(400).send({ error: "since/until tak terparse — pakai 24h, 7d, atau ISO-8601" });

    const scope = await scopeFor(req);
    let projects = scope;
    if (q.projects) {
      const want = q.projects.split(",").map((s) => s.trim()).filter(Boolean);
      const outside = want.filter((p) => !scope.includes(p));
      if (outside.length) return reply.code(403).send({ error: `di luar scope sesi: ${outside.join(", ")}` });
      if (want.length) projects = want;
    }

    const limit = Math.min(Number(q.limit) || 200, 1000);
    const needle = (q.q ?? "").trim().toLowerCase();
    const envWhere = q.environment ? { environment: q.environment } : {};

    // Timeline = event SEMUA project ter-scope, tercampur & terurut waktu — bukti korelasi lintas
    // project. Filter q dijalankan di memori (pola /errors), jadi ambil lebih banyak dulu lalu potong.
    const raw = await prisma.errorEvent.findMany({
      where: { projectId: { in: projects }, receivedAt: { gte: since, lte: until }, ...envWhere },
      orderBy: { receivedAt: "desc" }, take: needle ? 2000 : limit,
    });
    const events = (needle
      ? raw.filter((e) => `${e.type} ${e.message}`.toLowerCase().includes(needle))
      : raw).slice(0, limit);

    const rawGroups = await prisma.errorGroup.findMany({
      where: { projectId: { in: projects }, lastSeenAt: { gte: since }, ...envWhere },
      orderBy: { lastSeenAt: "desc" }, take: 200,
    });
    const groups = needle
      ? rawGroups.filter((g) => `${g.type} ${g.message}`.toLowerCase().includes(needle))
      : rawGroups;

    const names = await prisma.project.findMany({ where: { id: { in: projects } }, select: { id: true, name: true } });
    return {
      window: { since, until },
      scope: names,
      groups: groups.map(groupView),
      timeline: events.map(timelineView),
    };
  });

  app.get("/audit/logs/:groupId", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const scope = await scopeFor(req);
    const g = await prisma.errorGroup.findUnique({ where: { id: groupId } });
    // Grup di luar scope = 404, bukan 403: keberadaannya pun tak perlu bocor.
    if (!g || !scope.includes(g.projectId)) return reply.code(404).send({ error: "not found" });
    const events = await prisma.errorEvent.findMany({
      where: { groupId }, orderBy: { receivedAt: "desc" }, take: 50,
    });
    // SPEC-276 · symbolication lazy dengan map yang tersedia saat ini; map absen → frame apa adanya.
    const sampleFrames = Array.isArray(g.sampleFrames)
      ? await symbolicateFrames(g.sampleFrames as unknown as FrameLike[],
          (fn) => findSourceMap(g.projectId, g.release ?? "", fn))
      : null;
    return {
      ...groupView(g), sampleStack: g.sampleStack, sampleFrames,
      events: events.map((e) => ({
        id: e.id, at: e.receivedAt, type: e.type, message: e.message, stack: e.stack,
        environment: e.environment, release: e.release, context: e.context,
      })),
    };
  });
}
```

- [x] **Step 4: Daftarkan route + pengecualian gate**

Di `server/src/app.ts`:

(a) Tambahkan import setelah `import scheduler from "./routes/scheduler";`:

```ts
import audit from "./routes/audit";
import { auditScopeFromReq } from "./services/audit-scope";
```

(b) Di dalam hook `onRequest`, tepat setelah baris pengecualian `/api/help`, tambahkan:

```ts
        // SPEC-337 · ADR-0075 · sesi cross-audit milik hanoman sendiri memanggil /api/audit tanpa
        // cookie; diotorisasi kunci per-sesi yang hidup di tmux (mati bersama pane). Read-only &
        // ber-scope — cermin pengecualian /api/ingest. Kunci tak cocok → jatuh ke auth normal.
        if (path.startsWith("/api/audit/") && auditScopeFromReq(req)) return;
```

(c) Daftarkan route setelah `await api.register(scheduler);`:

```ts
    await api.register(audit);      // SPEC-337 · log lintas project untuk sesi cross-audit
```

- [x] **Step 5: Jalankan test — harus lolos**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/audit-logs.route.test.ts test/agent-gate.test.ts --no-file-parallelism
```

Expected: PASS (12 test di audit-logs + suite agent-gate tetap hijau).

- [x] **Step 6: Commit**

```bash
git add server/src/routes/audit.ts server/src/app.ts server/test/audit-logs.route.test.ts server/test/agent-gate.test.ts
git commit -m "feat(spec-337): GET /api/audit/logs — timeline error lintas project ber-scope sesi"
```

---

### Task 5: Flow `cross-audit` + prompt sesi

**Files:**
- Modify: `runner/src/types.ts` (`Flow`, tipe konteks baru)
- Modify: `runner/src/prompt.ts` (`PIPELINES`, `startCrossAuditPrompt`)
- Modify: `runner/src/index.ts` (ekspor)
- Modify: `shared/src/enums.ts` (`zSpecSource`)
- Modify: `shared/src/dto.ts` (`zFlow`, `flowForSource`, anggota union `zTerminalSession`)
- Modify: `server/src/routes/specs.ts` (prefix author)
- Test: `runner/test/cross-audit-prompt.test.ts`

**Interfaces:**
- Consumes: `SpecBrief` (sudah ada).
- Produces:
  - `type CrossAuditProject = { id: string; name: string; stack: string; repoDir: string | null; relation?: string; note?: string }`
  - `type CrossAuditCtx = { primary: CrossAuditProject; neighbors: CrossAuditProject[]; apiUrl: string; spec?: SpecBrief; branchTo?: string }`
  - `startCrossAuditPrompt(ctx: CrossAuditCtx, mode: "backlog" | "live"): string`
  - `PIPELINES["cross-audit"] = ["Audit", "Laporan"]`
  - `flowForSource("cross-audit") === "cross-audit"`

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/cross-audit-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { startCrossAuditPrompt, PIPELINES } from "../src/prompt";
import type { CrossAuditCtx } from "../src/types";

const ctx: CrossAuditCtx = {
  primary: { id: "web", name: "Web", stack: "React", repoDir: "/repo/web" },
  neighbors: [
    { id: "api", name: "API", stack: "Fastify", repoDir: "/repo/api", relation: "Web bergantung pada API (api)", note: "web memanggil /api/orders" },
    { id: "sdk", name: "SDK", stack: "TS", repoDir: null, relation: "SDK bergantung pada Web (sdk)", note: "" },
  ],
  apiUrl: "http://127.0.0.1:8787/api/audit",
};

describe("PIPELINES.cross-audit", () => {
  it("memakai fase audit-only yang sama", () => {
    expect(PIPELINES["cross-audit"]).toEqual(["Audit", "Laporan"]);
  });
});

describe("startCrossAuditPrompt", () => {
  it("memetakan semua project ter-scope beserta path & relasinya", () => {
    const p = startCrossAuditPrompt(ctx, "live");
    expect(p).toContain("/repo/web");
    expect(p).toContain("/repo/api");
    expect(p).toContain("web memanggil /api/orders");
    expect(p).toContain("Web bergantung pada API (api)");
  });

  it("menandai tetangga tanpa checkout lokal, bukan diam-diam menghilangkannya", () => {
    const p = startCrossAuditPrompt(ctx, "live");
    expect(p).toContain("sdk");
    expect(p).toMatch(/tak ada checkout lokal/i);
  });

  it("melarang menulis di luar worktree sendiri", () => {
    expect(startCrossAuditPrompt(ctx, "live")).toMatch(/read-only|JANGAN menulis/i);
  });

  it("mengajarkan cara menarik log dengan kunci sesi", () => {
    const p = startCrossAuditPrompt(ctx, "live");
    expect(p).toContain("$HANOMAN_AUDIT_KEY");
    expect(p).toContain("http://127.0.0.1:8787/api/audit");
    expect(p).toContain("X-Hanoman-Audit-Key");
  });

  it("mode live: tanpa fase, tanpa dokumen, tanpa push", () => {
    const p = startCrossAuditPrompt(ctx, "live");
    expect(p).not.toContain("HANOMAN_PHASE_FILE");
    expect(p).not.toContain("git push");
    expect(p).not.toContain("research/audit-");
  });

  it("mode backlog: fase Audit → Laporan, dokumen SoT, push, dan detail backlog", () => {
    const p = startCrossAuditPrompt({
      ...ctx,
      spec: { id: "SPEC-400", title: "Cek integrasi web↔api", source: "cross-audit", priority: "tinggi", objective: "temukan penyebab 500" },
      branchTo: "hanoman/spec-400",
    }, "backlog");
    expect(p).toContain("Audit → Laporan");
    expect(p).toContain("HANOMAN_PHASE_FILE");
    expect(p).toContain("internal/docs/research/audit-spec-400-");
    expect(p).toContain("git push origin HEAD:refs/heads/hanoman/spec-400");
    expect(p).toContain("SPEC-400");
    expect(p).toContain("superpowers:systematic-debugging");
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd runner && npx vitest run test/cross-audit-prompt.test.ts
```

Expected: FAIL — `startCrossAuditPrompt is not exported` / `PIPELINES["cross-audit"]` undefined.

- [x] **Step 3: Perluas tipe runner**

Di `runner/src/types.ts`, ganti baris `Flow` dan tambahkan tipe konteks di bawah `BreakdownPrd`:

```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "cross-audit";
```

```ts
// SPEC-337 · ADR-0075 · satu project di dalam scope sesi audit lintas. repoDir null = belum
// di-bind di mesin ini (tetap masuk scope log; prompt menandainya, bukan menyembunyikannya).
export type CrossAuditProject = {
  id: string; name: string; stack: string; repoDir: string | null;
  relation?: string;  // kalimat arah relasi terhadap project utama; kosong untuk project utama
  note?: string;      // catatan bentuk integrasi dari operator (ProjectLink.note)
};

// Konteks sesi audit lintas project. `spec`/`branchTo` hanya terisi di mode backlog.
export type CrossAuditCtx = {
  primary: CrossAuditProject;
  neighbors: CrossAuditProject[];
  apiUrl: string;          // nilai $HANOMAN_AUDIT_URL sesi ini
  spec?: SpecBrief;
  branchTo?: string;
};
```

- [x] **Step 4: Tulis builder prompt**

Di `runner/src/prompt.ts`:

(a) Tambahkan `cross-audit` ke `PIPELINES`:

```ts
export const PIPELINES: Record<Flow, readonly string[]> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"],
  prd: ["Brainstorm", "PRD"],
  audit: ["Audit", "Laporan"],
  breakdown: ["Analisis", "Breakdown"],
  // SPEC-337 · ADR-0075 · audit lintas project: fase & stage-map identik audit-only, scope-nya
  // yang berbeda (project utama + tetangga ProjectLink).
  "cross-audit": ["Audit", "Laporan"],
};
```

(b) Perluas import tipe di baris pertama file:

```ts
import type { Flow, SpecBrief, ProjectBrief, PrdBrief, BreakdownPrd, Autonomy, CrossAuditCtx, CrossAuditProject } from "./types";
```

(c) Tambahkan di akhir file:

```ts
// SPEC-337 · ADR-0075 · sesi audit lintas project. Satu worktree (project utama) + checkout
// tetangga READ-ONLY. Dua mode berbagi badan prompt yang sama: `backlog` (Spec, berfase,
// berdokumen, di-push) dan `live` (tanya-jawab di terminal, tanpa jejak).
const projectLine = (p: CrossAuditProject, primary: boolean): string => {
  const path = p.repoDir ?? "(tak ada checkout lokal di mesin ini — audit project ini dari log & docs saja)";
  const head = primary ? `- ${p.id} · ${p.name} · PROJECT UTAMA (worktree kamu)` : `- ${p.id} · ${p.name}`;
  return [
    head,
    `  stack: ${p.stack || "—"}`,
    `  path: ${path}`,
    ...(p.relation ? [`  relasi: ${p.relation}`] : []),
    ...(p.note ? [`  catatan integrasi: ${p.note}`] : []),
  ].join("\n");
};

const crossAuditLogGuide = (apiUrl: string): string =>
  [
    `Menarik log: hanoman memberi sesi ini kunci baca ber-scope di env \`$HANOMAN_AUDIT_KEY\` `
      + `(URL di \`$HANOMAN_AUDIT_URL\`, yaitu ${apiUrl}). Kunci ini HANYA membaca error project di atas, `
      + `dan mati saat sesi ini berakhir. Panggil berkali-kali sesuai kebutuhan — jangan puas dengan sekali tarik:`,
    "```bash",
    `curl -s -H "X-Hanoman-Audit-Key: $HANOMAN_AUDIT_KEY" "$HANOMAN_AUDIT_URL/logs?since=24h"`,
    `curl -s -H "X-Hanoman-Audit-Key: $HANOMAN_AUDIT_KEY" "$HANOMAN_AUDIT_URL/logs?since=7d&environment=production&q=timeout"`,
    `curl -s -H "X-Hanoman-Audit-Key: $HANOMAN_AUDIT_KEY" "$HANOMAN_AUDIT_URL/logs/<groupId>"   # detail + stack`,
    "```",
    `Bentuk jawabannya: \`timeline\` = error SEMUA project di atas, TERCAMPUR & terurut waktu — di situlah `
      + `korelasi lintas project terlihat (error di satu sisi tepat sesudah kegagalan di sisi lain). `
      + `\`groups\` = agregat berulang. Filter: \`since\`/\`until\` (\`24h\`|\`7d\`|ISO), \`environment\`, `
      + `\`q\`, \`projects\`, \`limit\`. Project yang tak punya data error: katakan itu terang-terangan lalu `
      + `bandingkan kontraknya di level kode — JANGAN mengarang log.`,
  ].join("\n");

const CROSS_AUDIT_FOCUS =
  "Fokus audit lintas: (1) kontrak API yang bergeser antara pemanggil & penyedia (path, bentuk payload, "
  + "kode status, header auth); (2) versi paket/SDK yang tertinggal di satu sisi; (3) error yang "
  + "BERKORELASI WAKTU di dua project; (4) environment/release yang tak sejalan antar sisi; (5) asumsi "
  + "auth, format tanggal/uang, retry & timeout yang berbeda. Setiap temuan harus bersandar pada bukti "
  + "dari KEDUA sisi — kutipan kode/kontrak dan/atau baris timeline, lengkap dengan waktunya.";

export function startCrossAuditPrompt(ctx: CrossAuditCtx, mode: "backlog" | "live"): string {
  const map = [projectLine(ctx.primary, true), ...ctx.neighbors.map((n) => projectLine(n, false))].join("\n");
  const scopeNote = ctx.neighbors.length
    ? ""
    : "CATATAN: project ini belum punya relasi integrasi terdaftar, jadi scope-nya hanya dirinya sendiri. "
      + "Katakan itu di awal jawabanmu — operator mungkin lupa mendaftarkan relasinya di kartu "
      + "\"Integrasi antar project\".";
  const head = [
    `hanoman cross-audit. Kamu mengaudit INTEGRASI ANTAR PROJECT — bukan satu project saja. `
      + `Semua project di bawah ini berada dalam scope-mu.`,
    `Project dalam scope:\n${map}`,
    scopeNote,
    `Aturan tulis: kamu HANYA boleh menulis di worktree-mu sendiri (\`${ctx.primary.repoDir ?? "worktree sesi ini"}\` `
      + `dan turunannya). Checkout project lain di atas bersifat READ-ONLY: baca sepuasnya, JANGAN menulis, `
      + `JANGAN commit, JANGAN menjalankan perintah yang mengubah isinya.`,
    crossAuditLogGuide(ctx.apiUrl),
    CROSS_AUDIT_FOCUS,
  ].filter(Boolean);

  if (mode === "live") {
    return [
      ...head,
      "Ini sesi TANYA-JAWAB: manusia menonton terminal ini dan akan bertanya. Jawab dengan bukti "
        + "(kutipan kode + baris log beserta waktunya), ringkas dan langsung. Tak ada fase, tak ada dokumen, "
        + "tak ada commit — kalau temuannya layak ditindaklanjuti, sarankan membuat backlog audit lintas.",
    ].join("\n\n");
  }

  const spec = ctx.spec!;
  const slug = spec.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    ...head,
    phaseInstruction(PIPELINES["cross-audit"]),
    `Fase Audit: telusuri akar masalah lintas project (log + kode kedua sisi). Fase Laporan: tulis DOKUMEN `
      + `AUDIT ke Source of Truth project utama \`internal/docs/research/audit-${spec.id.toLowerCase()}-${slug}.md\` `
      + `(ikuti konvensi audit yang ada), tautkan di \`internal/docs/README.md\`, memuat: keluhan/pertanyaan, `
      + `peta integrasi yang diaudit, temuan dengan BUKTI dari tiap project (kutipan kode + baris timeline `
      + `beserta waktunya), apakah issue terdefinisi baik, dan REKOMENDASI — "cukup jawaban" ATAU "naikkan `
      + `jadi Finding QA di project <id>" (sebut project mana yang harus diperbaiki). JANGAN menulis perbaikan kode.`,
    AUTONOMY_CLAUSE,
    skillInstruction(PIPELINES["cross-audit"]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${ctx.branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
```

- [x] **Step 5: Ekspor dari runner**

Periksa `runner/src/index.ts`; bila ia mengekspor simbol prompt satu per satu, tambahkan `startCrossAuditPrompt` dan tipe `CrossAuditCtx`/`CrossAuditProject`. Bila sudah `export * from "./prompt"` + `export * from "./types"`, tak ada yang perlu diubah.

- [x] **Step 6: Jalankan test runner — harus lolos**

```bash
cd runner && npx vitest run test/cross-audit-prompt.test.ts test/prompt.test.ts
```

Expected: PASS — termasuk suite prompt lama (perluasan `PIPELINES` tak boleh merusaknya).

- [x] **Step 7: Lebarkan enum source/flow + pemetaan**

Di `shared/src/enums.ts`:

```ts
export const zSpecSource = z.enum(["brief","qa","audit","cross-audit","help"]);  // SPEC-253 · +help · SPEC-337 · +cross-audit
```

Di `shared/src/dto.ts`:

```ts
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd", "audit", "breakdown", "cross-audit"]);
export type FlowName = z.infer<typeof zFlow>;
// SPEC-237 · satu-satunya pemetaan source → flow (client memakainya saat start sesi).
// qa → audit lalu execute perbaikan; audit → dokumen saja (Audit → Laporan, tanpa Execute).
// SPEC-337 · cross-audit → dokumen juga, tapi ber-scope project ini + tetangga ProjectLink-nya.
export function flowForSource(source: string): FlowName {
  return source === "qa" ? "qa"
    : source === "audit" ? "audit"
    : source === "cross-audit" ? "cross-audit"
    : "feature";
}
```

Tambahkan anggota union baru di `zTerminalSession`, tepat setelah anggota `breakdown`:

```ts
  // SPEC-337 · ADR-0075 · sesi audit lintas project LEPAS (tanya-jawab): tanpa Spec, tanpa fase.
  z.object({ project: z.string(), flow: z.literal("cross-audit") }),
```

- [x] **Step 8: Prefix author backlog cross-audit**

Di `server/src/routes/specs.ts` (± baris 92), ganti ekspresi `author`:

```ts
    author: isQa ? `QA · ${author}`
      : b.source === "audit" ? `Audit · ${author}`
      : b.source === "cross-audit" ? `Audit lintas · ${author}`   // SPEC-337 · asal item terbaca di backlog
      : author,
```

- [x] **Step 9: Jalankan test shared + server specs**

```bash
cd shared && npx vitest run
cd ../server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/specs.route.test.ts --no-file-parallelism
```

Expected: PASS keduanya.

- [x] **Step 10: Commit**

```bash
git add runner/src shared/src server/src/routes/specs.ts runner/test/cross-audit-prompt.test.ts
git commit -m "feat(spec-337): flow cross-audit + prompt sesi audit lintas project"
```

---

### Task 6: Peluncuran sesi cross-audit (backlog + lepas)

**Files:**
- Create: `server/src/services/cross-audit.ts`
- Modify: `server/src/services/session-launch.ts`
- Modify: `server/src/routes/terminal.ts`
- Test: `server/test/cross-audit-session.test.ts`

**Interfaces:**
- Consumes: `auditScopeOf`/`linksOf` (Task 1), `newAuditKey`/`auditApiUrl` (Task 3), `startCrossAuditPrompt` (Task 5), `resolveRepoDir`, `createSession`.
- Produces:
  - `buildCrossAuditCtx(primaryId: string): Promise<{ ctx: CrossAuditCtx; scope: string[] } | null>`
  - `crossAuditSessionOpts(scope: string[]): { key: string; audit: {…}; env: Record<string,string> }`
  - `POST /terminal/sessions { project, flow: "cross-audit" }` → 201 `{ id }`, id `xaudit-<projectId>`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/cross-audit-session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { buildCrossAuditCtx } from "../src/services/cross-audit";
import { killAll, getSession, listSessions, auditSessionScope } from "../src/services/pty";
import { makeRepoWithBranches } from "./factory";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Sesi men-spawn `claude` sungguhan bila tak distub. fixtures/fake-claude.sh mencetak argv lalu
// `exec cat` (tetap hidup) — pola yang sama dipakai terminal.route.test.ts.
process.env.HANOMAN_CLAUDE_BIN = resolve(import.meta.dirname, "fixtures/fake-claude.sh");

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.projectLink.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.localBinding.deleteMany();
  await prisma.project.deleteMany();
};

let webDir = "", apiDir = "";

beforeEach(async () => {
  killAll();
  await clean();
  webDir = makeRepoWithBranches();
  apiDir = makeRepoWithBranches();
  await prisma.project.createMany({ data: [
    { id: "web", name: "Web", desc: "", kind: "existing", repoDir: webDir, stack: "React" },
    { id: "api", name: "API", desc: "", kind: "existing", repoDir: apiDir, stack: "Fastify" },
    { id: "sdk", name: "SDK", desc: "", kind: "existing", repoDir: null, stack: "TS" },
  ] });
  await prisma.projectLink.create({ data: { fromProjectId: "web", toProjectId: "api", kind: "api", note: "web memanggil /api/orders" } });
  await prisma.projectLink.create({ data: { fromProjectId: "sdk", toProjectId: "web", kind: "sdk", note: "" } });
});
afterAll(async () => { killAll(); await clean(); });

describe("buildCrossAuditCtx", () => {
  it("menyusun scope + path checkout tetangga kedua arah", async () => {
    const built = (await buildCrossAuditCtx("web"))!;
    expect(built.scope[0]).toBe("web");
    expect(built.scope.slice(1).sort()).toEqual(["api", "sdk"]);
    expect(built.ctx.primary.repoDir).toBe(webDir);
    const api = built.ctx.neighbors.find((n) => n.id === "api")!;
    expect(api.repoDir).toBe(apiDir);
    expect(api.relation).toContain("bergantung pada");
    expect(api.note).toBe("web memanggil /api/orders");
    expect(built.ctx.neighbors.find((n) => n.id === "sdk")!.repoDir).toBeNull();
  });

  it("null untuk project yang tak ada", async () => {
    expect(await buildCrossAuditCtx("hantu")).toBeNull();
  });
});

describe("POST /terminal/sessions {project, flow:'cross-audit'}", () => {
  it("melahirkan sesi lepas ber-worktree, ber-kunci audit, tanpa flow/spec", async () => {
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    expect(id).toBe("xaudit-web");
    const s = getSession(id)!;
    expect(s.cwd).toContain("/.worktrees/xaudit-web");
    expect(existsSync(s.cwd)).toBe(true);
    expect(s.specId).toBeUndefined();
    expect(s.flow).toBeUndefined();       // sesi lepas tak menggerakkan stage apa pun
  });

  it("id deterministik: Start kedua menyambung, bukan melahirkan sesi baru", async () => {
    const a = (await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } })).json();
    expect(b.id).toBe(a.id);
    expect(listSessions().filter((s) => s.id === a.id)).toHaveLength(1);
  });

  it("kunci sesi memberi scope = project utama + tetangganya, dan tak bocor ke API", async () => {
    await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } });
    const sessions = await app.inject({ method: "GET", url: "/api/terminal/sessions" });
    expect(sessions.body).not.toContain("hnm_xa_");
    // Kunci hanya bisa ditemukan lewat tmux — ambil dari scope lookup dengan menebak? Tidak:
    // verifikasi lewat efeknya, yaitu request /api/audit/logs memakai kunci yang dipegang sesi.
    // Kunci diambil langsung dari tmux option di test ini:
    const { execFileSync } = await import("node:child_process");
    const socket = process.env.HANOMAN_TMUX_SOCKET ?? "hanoman";
    const key = execFileSync("tmux", ["-L", socket, "-f", "/dev/null", "show-options", "-v", "-t", "hanoman-xaudit-web", "@hanoman_audit_key"], { encoding: "utf8" }).trim();
    expect(key).toMatch(/^hnm_xa_[0-9a-f]{32}$/);
    expect(auditSessionScope(key)!.sort()).toEqual(["api", "sdk", "web"]);
  });

  it("404 untuk project yang tak ada", async () => {
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "hantu", flow: "cross-audit" } });
    expect(r.statusCode).toBe(404);
  });
});

describe("sesi backlog cross-audit", () => {
  it("lahir di worktree spec dengan kunci audit ber-scope tetangga", async () => {
    await prisma.spec.create({ data: {
      id: "SPEC-900", projectId: "web", title: "Audit integrasi web api", source: "cross-audit",
      stage: "brainstorming", priority: "tinggi", author: "Audit lintas · t@t", objective: "cek integrasi",
    } });
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec: "SPEC-900", flow: "cross-audit" } });
    expect(r.statusCode).toBe(201);
    const s = getSession(r.json().id)!;
    expect(s.specId).toBe("SPEC-900");
    expect(s.flow).toBe("cross-audit");
    const { execFileSync } = await import("node:child_process");
    const socket = process.env.HANOMAN_TMUX_SOCKET ?? "hanoman";
    const projects = execFileSync("tmux", ["-L", socket, "-f", "/dev/null", "show-options", "-v", "-t", `hanoman-${s.id}`, "@hanoman_audit_projects"], { encoding: "utf8" }).trim();
    expect(projects.split(",").sort()).toEqual(["api", "sdk", "web"]);
  });
});
```

> Catatan: sesi di test ini men-spawn `claude` sungguhan bila `HANOMAN_CLAUDE_BIN` tak diset. Ikuti pola `terminal.route.test.ts` — set `HANOMAN_CLAUDE_BIN` ke stub di `beforeEach` bila file itu melakukannya; kalau ia memakai variabel env dari `vitest.setup`, tak ada yang perlu ditambahkan.

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/cross-audit-session.test.ts --no-file-parallelism
```

Expected: FAIL — `Failed to resolve import "../src/services/cross-audit"`.

- [x] **Step 3: Implementasikan pembangun konteks**

Buat `server/src/services/cross-audit.ts`:

```ts
// SPEC-337 · ADR-0075 · menyiapkan sesi audit lintas project: peta project ter-scope (utama +
// tetangga ProjectLink satu hop, kedua arah) + kunci baca log seumur sesi.
import { prisma } from "../db";
import type { CrossAuditCtx, CrossAuditProject } from "@hanoman/runner";
import { resolveRepoDir } from "./local-binding";
import { linksOf, linkViews } from "./project-links";
import { newAuditKey, auditApiUrl } from "./audit-scope";

export type CrossAuditBuild = { ctx: CrossAuditCtx; scope: string[] };

export async function buildCrossAuditCtx(primaryId: string): Promise<CrossAuditBuild | null> {
  const primary = await prisma.project.findUnique({ where: { id: primaryId } });
  if (!primary) return null;

  const views = await linkViews(primaryId, await linksOf(primaryId));
  const rows = await prisma.project.findMany({ where: { id: { in: views.map((v) => v.other.id) } } });
  const byId = new Map(rows.map((p) => [p.id, p]));

  const neighbors: CrossAuditProject[] = [];
  for (const v of views) {
    const p = byId.get(v.other.id);
    if (!p) continue;
    // Kalimat arah, bukan panah mentah: prompt dibaca agen, dan "A bergantung pada B" tak ambigu.
    const relation = v.direction === "keluar"
      ? `${primary.name} bergantung pada ${p.name} (${v.kind})`
      : `${p.name} bergantung pada ${primary.name} (${v.kind})`;
    neighbors.push({
      id: p.id, name: p.name, stack: p.stack,
      repoDir: await resolveRepoDir(p.id),   // null = belum di-bind di mesin ini; prompt menandainya
      relation, note: v.note,
    });
  }

  return {
    ctx: {
      primary: {
        id: primary.id, name: primary.name, stack: primary.stack,
        repoDir: await resolveRepoDir(primary.id),
      },
      neighbors,
      apiUrl: auditApiUrl(),
    },
    scope: [primary.id, ...neighbors.map((n) => n.id)],
  };
}

// Opsi createSession untuk sesi cross-audit: kunci di tmux option + env yang dibaca agen.
export function crossAuditSessionOpts(scope: string[]): {
  audit: { key: string; projects: string[] }; env: Record<string, string>;
} {
  const key = newAuditKey();
  return {
    audit: { key, projects: scope },
    env: { HANOMAN_AUDIT_KEY: key, HANOMAN_AUDIT_URL: auditApiUrl() },
  };
}
```

- [x] **Step 4: Sambungkan ke jalur peluncuran backlog**

Di `server/src/services/session-launch.ts`:

(a) Perluas import:

```ts
import { realGit, startPrompt, continuePrompt, startCrossAuditPrompt, resolveGoalCondition, type Flow, type Autonomy } from "@hanoman/runner";
import { buildCrossAuditCtx, crossAuditSessionOpts } from "./cross-audit";
```

(b) Ganti blok `createSession(...)` di akhir fungsi dengan:

```ts
  // SPEC-337 · ADR-0075 · flow cross-audit: prompt ber-peta project + kunci baca log seumur sesi.
  // Flow lain tak tersentuh (prompt & opsi persis seperti sebelumnya).
  let prompt = isContinue
    ? continuePrompt(opts.flow, brief, `hanoman/${id}`, opts.autonomy)
    : startPrompt(opts.flow, brief, `hanoman/${id}`, opts.autonomy);
  let extra: { audit?: { key: string; projects: string[] }; env?: Record<string, string> } = {};
  if (opts.flow === "cross-audit") {
    const built = await buildCrossAuditCtx(spec.projectId);
    if (built) {
      prompt = startCrossAuditPrompt({ ...built.ctx, spec: brief, branchTo: `hanoman/${id}` }, "backlog");
      extra = crossAuditSessionOpts(built.scope);
    }
  }
  const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
    specId: spec.id, flow: opts.flow, model, effort, goal,
    phaseFile: phaseFilePath(repoDir, id),
    decisionFile: decisionFilePath(repoDir, id),
    prompt,
    ...extra,
  });
  return { id: s.id };
```

- [x] **Step 5: Tambahkan pintu sesi lepas di route terminal**

Di `server/src/routes/terminal.ts`:

(a) Perluas import runner + tambahkan import service:

```ts
import { realGit, startProjectPrompt, startPrdPrompt, startScaffoldPrompt, startBreakdownPrompt, startCrossAuditPrompt, type Flow } from "@hanoman/runner";
import { buildCrossAuditCtx, crossAuditSessionOpts } from "../services/cross-audit";
```

(b) Sisipkan cabang baru sebelum baris terakhir `const s = createSession(project.id, repoDir);`:

```ts
    // SPEC-337 · ADR-0075 · sesi audit LINTAS project yang lepas (tanya-jawab): worktree sendiri,
    // TANPA Spec/fase/branch → tak menggerakkan stage apa pun. Id deterministik dari project
    // (Start kedua = re-attach, ADR-0015). Kunci baca log ikut lahir & mati bersama sesi.
    if (parsed.data.flow === "cross-audit") {
      const id = `xaudit-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const built = await buildCrossAuditCtx(project.id);
      if (!built) return reply.code(404).send({ error: "project not found" });
      const { model, effort } = await sessionModel();
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, model, effort,
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startCrossAuditPrompt(built.ctx, "live"),
        ...crossAuditSessionOpts(built.scope),
      });
      return reply.code(201).send({ id: s.id });
    }
```

- [x] **Step 6: Jalankan test — harus lolos**

```bash
cd server && env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" npx vitest run test/cross-audit-session.test.ts test/terminal.route.test.ts --no-file-parallelism
```

Expected: PASS — sesi lepas & backlog lahir dengan kunci ber-scope; suite terminal lama tetap hijau.

- [x] **Step 7: Commit**

```bash
git add server/src/services/cross-audit.ts server/src/services/session-launch.ts server/src/routes/terminal.ts server/test/cross-audit-session.test.ts
git commit -m "feat(spec-337): peluncuran sesi cross-audit (backlog + lepas) berkunci audit"
```

---

### Task 7: UI — kartu Integrasi, tombol audit lintas, source backlog

**Files:**
- Modify: `src/src/api/client.ts` (paths + method)
- Create: `src/src/screens/ProjectLinksCard.tsx`
- Modify: `src/src/screens/ProjectDetailScreen.tsx`
- Modify: `src/src/App.tsx` (handler sesi lepas + tab NewSpecModal)
- Modify: `src/src/screens/BacklogScreen.tsx` (`SOURCE_META`)
- Test: `src/test/project-links-card.test.tsx`

**Interfaces:**
- Consumes: endpoint Task 2 & Task 6.
- Produces:
  - `api.listProjectLinks(id)`, `api.createProjectLink(id, body)`, `api.deleteProjectLink(id, linkId)`, `api.crossAudit(id)`
  - `<ProjectLinksCard p onToast onCrossAudit />`
  - `ProjectDetailScreen` prop baru `onCrossAudit?: () => void | Promise<void>`

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/project-links-card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ProjectLinksCard } from "../src/screens/ProjectLinksCard";
import { api } from "../src/api/client";
import type { ProjectVM } from "../src/screens/types";

const p = { id: "web", name: "Web" } as ProjectVM;
const others = [{ id: "api", name: "API" }, { id: "sdk", name: "SDK" }];

beforeEach(() => vi.restoreAllMocks());

describe("ProjectLinksCard", () => {
  it("menampilkan relasi yang ada dengan arah dan catatannya", async () => {
    vi.spyOn(api, "listProjectLinks").mockResolvedValue({ links: [
      { id: "l1", fromProjectId: "web", toProjectId: "api", kind: "api", note: "web memanggil /api/orders", direction: "keluar", other: { id: "api", name: "API" } },
    ] });
    render(<ProjectLinksCard p={p} others={others} onToast={() => {}} />);
    expect(await screen.findByText(/API/)).toBeTruthy();
    expect(screen.getByText(/web memanggil \/api\/orders/)).toBeTruthy();
  });

  it("menambah relasi lalu memuat ulang daftar", async () => {
    const list = vi.spyOn(api, "listProjectLinks")
      .mockResolvedValueOnce({ links: [] })
      .mockResolvedValueOnce({ links: [
        { id: "l1", fromProjectId: "web", toProjectId: "api", kind: "api", note: "", direction: "keluar", other: { id: "api", name: "API" } },
      ] });
    const create = vi.spyOn(api, "createProjectLink").mockResolvedValue({
      id: "l1", fromProjectId: "web", toProjectId: "api", kind: "api", note: "", direction: "keluar", other: { id: "api", name: "API" },
    });
    render(<ProjectLinksCard p={p} others={others} onToast={() => {}} />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Tambah relasi"));
    await waitFor(() => expect(create).toHaveBeenCalledWith("web", expect.objectContaining({ to: "api", kind: "api" })));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("tombol audit lintas mati saat belum ada relasi", async () => {
    vi.spyOn(api, "listProjectLinks").mockResolvedValue({ links: [] });
    const onCrossAudit = vi.fn();
    render(<ProjectLinksCard p={p} others={others} onToast={() => {}} onCrossAudit={onCrossAudit} />);
    const btn = await screen.findByText("Audit lintas project");
    fireEvent.click(btn.closest("button")!);
    expect(onCrossAudit).not.toHaveBeenCalled();
  });

  it("tombol audit lintas hidup begitu ada relasi", async () => {
    vi.spyOn(api, "listProjectLinks").mockResolvedValue({ links: [
      { id: "l1", fromProjectId: "web", toProjectId: "api", kind: "api", note: "", direction: "keluar", other: { id: "api", name: "API" } },
    ] });
    const onCrossAudit = vi.fn();
    render(<ProjectLinksCard p={p} others={others} onToast={() => {}} onCrossAudit={onCrossAudit} />);
    const btn = await screen.findByText("Audit lintas project");
    fireEvent.click(btn.closest("button")!);
    expect(onCrossAudit).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
cd src && env -u NODE_ENV npx vitest run test/project-links-card.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/screens/ProjectLinksCard"`.

- [x] **Step 3: Tambahkan method API client**

Di `src/src/api/client.ts`, tambahkan path (dekat `projectHelpCenter`):

```ts
  projectLinks: (id: string) => `/api/projects/${encodeURIComponent(id)}/links`,
  projectLink: (id: string, linkId: string) => `/api/projects/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}`,
```

dan method di objek `api` (setelah `disableHelpCenter`):

```ts
  // SPEC-337 · ADR-0075 · relasi integrasi antar project + sesi audit lintas (lepas).
  listProjectLinks: (id: string) => j<{ links: LinkView[] }>(paths.projectLinks(id)),
  createProjectLink: (id: string, b: { to: string; kind: string; note?: string }) =>
    j<LinkView>(paths.projectLinks(id), { method: "POST", ...body(b) }),
  deleteProjectLink: (id: string, linkId: string) =>
    j<void>(paths.projectLink(id, linkId), { method: "DELETE" }),
  crossAudit: (id: string) =>
    j<{ id: string }>(paths.sessions, { method: "POST", ...body({ project: id, flow: "cross-audit" }) }),
```

Tipe `LinkView` ditaruh di `shared/src/api.ts` (bersama `paths`) lalu diimpor — bukan didefinisikan ulang di client:

```ts
// SPEC-337 · bentuk LinkView server (server/src/services/project-links.ts).
export type LinkView = {
  id: string; fromProjectId: string; toProjectId: string; kind: string; note: string;
  direction: "keluar" | "masuk"; other: { id: string; name: string };
};
```

> `paths.sessions` sudah ada (dipakai `reverseDocs`). Bila namanya berbeda di file itu, pakai nama yang ada — jangan membuat path baru.

- [x] **Step 4: Buat kartu**

Buat `src/src/screens/ProjectLinksCard.tsx`:

```tsx
/* SPEC-337 · ADR-0075 · kartu "Integrasi antar project": deklarasikan relasi dependency, lalu
   buka sesi audit lintas dari sini. Relasi berarah (project ini bergantung pada X / X bergantung
   pada project ini); catatannya dibaca agen apa adanya saat sesi audit lahir. */
import React from "react";
import { Card, Badge, Button, Select, Input, Icon } from "../ds";
import { api, type LinkView } from "../api/client";
import type { ProjectVM } from "./types";

const KINDS = [
  { value: "api", label: "API" }, { value: "sdk", label: "SDK / paket" },
  { value: "data", label: "Data / DB" }, { value: "event", label: "Event / queue" },
  { value: "lainnya", label: "Lainnya" },
];

export function ProjectLinksCard({ p, others, onToast, onCrossAudit }:
  { p: ProjectVM; others: { id: string; name: string }[];
    onToast: (msg: string, kind?: string, icon?: string) => void;
    onCrossAudit?: () => void | Promise<void> }) {
  const [links, setLinks] = React.useState<LinkView[]>([]);
  const [to, setTo] = React.useState(others[0]?.id ?? "");
  const [kind, setKind] = React.useState("api");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setLinks((await api.listProjectLinks(p.id)).links); } catch { /* biarkan daftar apa adanya */ }
  }, [p.id]);
  React.useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!to) return;
    setBusy(true);
    try {
      await api.createProjectLink(p.id, { to, kind, note: note.trim() || undefined });
      setNote("");
      await load();
      onToast("Relasi ditambahkan", "ok", "link");
    } catch { onToast("Gagal menambah relasi · mungkin sudah ada", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function remove(l: LinkView) {
    if (!window.confirm(`Hapus relasi ${l.fromProjectId} → ${l.toProjectId}?`)) return;
    setBusy(true);
    try { await api.deleteProjectLink(p.id, l.id); await load(); onToast("Relasi dihapus", "ok", "link"); }
    catch { onToast("Gagal menghapus relasi", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  return (
    <Card eyebrow="integrasi" title="Integrasi antar project"
      actions={
        <Button size="sm" leftIcon="radar" disabled={!links.length || busy}
          onClick={() => { if (links.length) void onCrossAudit?.(); }}>
          Audit lintas project
        </Button>
      }>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Daftarkan project yang saling berintegrasi. Sesi audit lintas melihat semua project di sini sekaligus —
        kode, docs, dan log error-nya dalam satu timeline.
      </div>

      {links.length === 0
        ? <div style={{ fontSize: 12.5, color: "var(--text-subtle)", marginBottom: 12 }}>
            Belum ada relasi. Tambahkan satu agar audit lintas project bisa dibuka.
          </div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {links.map((l) => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Icon name={l.direction === "keluar" ? "arrow-right" : "arrow-left"} size={14} color="var(--text-subtle)" />
                <span style={{ fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{l.other.name}</span>
                <Badge tone="neutral" size="sm">{l.kind}</Badge>
                <span style={{ fontSize: 12, color: "var(--text-subtle)" }}>
                  {l.direction === "keluar" ? `${p.name} bergantung pada ${l.other.name}` : `${l.other.name} bergantung pada ${p.name}`}
                </span>
                {l.note && <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>{l.note}</span>}
                <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={busy} onClick={() => remove(l)}>Hapus</Button>
              </div>
            ))}
          </div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Select value={to} onChange={(e) => setTo(e.target.value)} style={{ minWidth: 160 }}
          options={others.map((o) => ({ value: o.id, label: o.name }))} />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ minWidth: 140 }} options={KINDS} />
        <Input value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 220 }}
          placeholder="bentuk integrasinya — mis. web memanggil /api/orders, auth lewat cookie" />
        <Button size="sm" leftIcon="plus" disabled={!to || busy} onClick={add}>Tambah relasi</Button>
      </div>
    </Card>
  );
}
```

- [x] **Step 5: Pasang kartu di detail project**

Di `src/src/screens/ProjectDetailScreen.tsx`:

(a) import: `import { ProjectLinksCard } from "./ProjectLinksCard";`

(b) tambahkan dua prop di signature `ProjectDetailScreen` (setelah `onProjectChanged`):

```tsx
    // SPEC-337 · project lain sebagai kandidat relasi + pembuka sesi audit lintas.
    others?: { id: string; name: string }[];
    onCrossAudit?: () => void | Promise<void>;
```

(c) render setelah `<HelpCenterCard … />`:

```tsx
      <ProjectLinksCard p={p} others={others ?? []} onToast={onToast} onCrossAudit={onCrossAudit} />
```

- [x] **Step 6: Sambungkan di App**

Di `src/src/App.tsx`:

(a) Tambahkan handler tepat setelah `scaffoldDocs`:

```tsx
  // SPEC-337 · ADR-0075 · sesi audit LINTAS project (lepas, tanya-jawab), lalu ke Terminal.
  async function crossAudit(p: ProjectVM) {
    try {
      const { id } = await api.crossAudit(p.id);
      setSection("terminal");
      showToast(p.id + " · audit lintas · sesi " + id + " dimulai", "info", "radar");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast(p.id + " · gagal mulai audit lintas" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
    }
  }
```

(b) Teruskan prop di pemakaian `<ProjectDetailScreen …>`:

```tsx
              others={projectsView.filter((x) => x.id !== proj.id).map((x) => ({ id: x.id, name: x.name }))}
              onCrossAudit={() => crossAudit(proj)}
```

(c) Tambahkan tab source di `NewSpecModal`. Ganti array `tabs` menjadi:

```tsx
          { value: "brief", label: "Feature brief", icon: "lightbulb" },
          { value: "qa", label: "QA finding", icon: "bug" },
          { value: "audit", label: "Audit", icon: "search" },
          { value: "cross-audit", label: "Audit lintas", icon: "radar" },
```

dan di atasnya tambahkan konstanta serta perluas teks/ikon:

```tsx
  const isAudit = f.kind === "audit";                       // SPEC-237 · audit-only (dokumen, tanpa perbaikan)
  const isCross = f.kind === "cross-audit";                 // SPEC-337 · audit lintas project (dokumen)
```

Ganti tiga ekspresi tampilan modal:

```tsx
    <Modal open={open} onClose={onClose} icon={isQa ? "bug" : isCross ? "radar" : isAudit ? "search" : "lightbulb"} eyebrow="human → hanoman"
      title={isQa ? "QA finding baru" : isCross ? "Audit lintas project baru" : isAudit ? "Audit baru" : "Feature brief baru"}
```

```tsx
        <Button size="sm" leftIcon={isQa ? "radar" : isCross ? "radar" : isAudit ? "search" : "messages-square"} onClick={submit}>
          {isQa ? "Filekan finding → audit" : isCross ? "Buat audit lintas → investigasi" : isAudit ? "Buat audit → investigasi" : "Buat brief → brainstorm"}
        </Button>
```

```tsx
          {isQa ? "Finding masuk lewat alur audit → spec → plan → execute. hanoman menelusuri akar masalah dulu."
            : isCross ? "Audit lintas melihat project ini BESERTA project yang berelasi dengannya (kartu Integrasi di detail project) — kode, docs, dan timeline error gabungan. Hasilnya dokumen audit, tanpa perbaikan kode."
            : isAudit ? "Audit HANYA menghasilkan dokumen (audit → laporan) — tanpa perbaikan kode. Bisa dinaikkan jadi Finding QA bila perlu diperbaiki."
            : "Brief masuk lewat alur brainstorm → objective → spec → plan → execute."}
```

(d) Payload cross-audit berbentuk brief — tak ada perubahan lain yang diperlukan (`source: f.kind` sudah meneruskan nilai tab).

- [x] **Step 7: Tambahkan tampilan source di backlog**

Di `src/src/screens/BacklogScreen.tsx`, tambahkan satu entri di `SOURCE_META`:

```ts
  "cross-audit": { label: "Audit lintas", icon: "radar", tone: "info", color: "var(--wind-600)" },
```

- [x] **Step 7b: Beri label sel Terminal untuk sesi audit lintas lepas**

Sesi lepas tak punya `specId`, jadi `cellLabel` hanya menampilkan nama project — tak terbedakan dari
terminal biasa. Di `src/src/screens/TerminalScreen.tsx` (± baris 261), ganti isi `cellLabel`:

```ts
function cellLabel(s: TerminalSession, nameOf: (pid: string) => string,
  titleOf?: (specId: string) => string | undefined): string {
  const proj = nameOf(s.projectId);
  const title = s.specId ? titleOf?.(s.specId) : undefined;
  if (s.specId) return `${proj} · ${s.specId}${title ? ` · ${title}` : ""}`;
  // SPEC-337 · sesi audit lintas LEPAS tak punya spec; tanpa penanda ia tampak seperti terminal biasa.
  return s.id.startsWith("xaudit-") ? `${proj} · audit lintas` : proj;
}
```

- [x] **Step 8: Jalankan test frontend — harus lolos**

```bash
cd src && env -u NODE_ENV npx vitest run test/project-links-card.test.tsx test/backlog-board.test.tsx test/app-flows.test.tsx
```

Expected: PASS (4 test kartu + suite backlog/app lama tetap hijau).

- [x] **Step 9: Typecheck seluruh workspace**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-337 && pnpm -r typecheck
```

Expected: exit 0, tanpa error TS.

- [x] **Step 10: Commit**

```bash
git add src/src src/test/project-links-card.test.tsx
git commit -m "feat(spec-337): kartu Integrasi antar project + pintu audit lintas di UI"
```

---

### Task 8: Verifikasi nyata (boot server + curl) & penutup

**Files:**
- Modify: `internal/docs/README.md` (hanya bila ada doc baru yang belum tertaut — periksa)
- Test: seluruh suite

- [ ] **Step 1: Jalankan seluruh suite**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-337
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" pnpm test
```

Expected: semua paket hijau. Test server berjalan dengan `--no-file-parallelism` (sudah di config paket).

- [ ] **Step 2: Boot server nyata di port terpisah**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-337
pnpm --filter ./server build
DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman337" PORT=8797 node server/dist/server.js &
sleep 2 && curl -s localhost:8797/api/health
```

Expected: `{"ok":true}` (atau bentuk health yang berlaku).

- [ ] **Step 3: Siapkan data & login, lalu uji CRUD relasi lewat curl**

```bash
# akun pertama (bila DB masih kosong) + cookie
curl -s -X POST localhost:8797/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"t@t.io","password":"rahasia123"}' -c /tmp/spec337.jar
curl -s -X POST localhost:8797/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"t@t.io","password":"rahasia123"}' -c /tmp/spec337.jar

# dua project + relasi
curl -s -X POST localhost:8797/api/projects -b /tmp/spec337.jar -H 'content-type: application/json' \
  -d '{"name":"web","kind":"existing","desc":"frontend"}'
curl -s -X POST localhost:8797/api/projects -b /tmp/spec337.jar -H 'content-type: application/json' \
  -d '{"name":"api","kind":"existing","desc":"backend"}'
curl -s -X POST localhost:8797/api/projects/web/links -b /tmp/spec337.jar -H 'content-type: application/json' \
  -d '{"to":"api","kind":"api","note":"web memanggil /api/orders"}'
curl -s localhost:8797/api/projects/api/links -b /tmp/spec337.jar
```

Expected: POST link → 201 dengan `direction:"keluar"`; GET dari sisi `api` → satu link `direction:"masuk"`, `other.id:"web"`.

- [ ] **Step 4: Seed error dua project lalu uji timeline lewat kunci sesi**

```bash
docker exec -i hanoman-db-1 psql -U hanoman -d hanoman337 <<'SQL'
INSERT INTO "ErrorGroup" (id,"projectId",fingerprint,type,message,environment,status,count,"firstSeenAt","lastSeenAt","createdAt","updatedAt",version)
VALUES ('g-web','web','fw','TypeError','orders gagal dimuat','production','new',3,now(),now(),now(),now(),0),
       ('g-api','api','fa','TimeoutError','upstream timeout','production','new',2,now(),now(),now(),now(),0);
INSERT INTO "ErrorEvent" (id,"groupId","projectId",type,message,environment,"receivedAt")
VALUES ('e1','g-web','web','TypeError','orders gagal dimuat','production',now() - interval '59 seconds'),
       ('e2','g-api','api','TimeoutError','upstream timeout','production',now() - interval '60 seconds');
SQL
```

Buka sesi audit lintas, ambil kuncinya dari tmux, lalu tarik timeline:

```bash
curl -s -X POST localhost:8797/api/terminal/sessions -b /tmp/spec337.jar -H 'content-type: application/json' \
  -d '{"project":"web","flow":"cross-audit"}'
KEY=$(tmux -L hanoman -f /dev/null show-options -v -t hanoman-xaudit-web @hanoman_audit_key)
echo "key=$KEY"
curl -s -H "X-Hanoman-Audit-Key: $KEY" "localhost:8797/api/audit/logs?since=24h" | head -c 1200
curl -s -o /dev/null -w '%{http_code}\n' "localhost:8797/api/audit/logs?since=24h"                       # tanpa kunci → 401
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Hanoman-Audit-Key: $KEY" "localhost:8797/api/audit/logs?projects=hantu"  # di luar scope → 403
curl -s -b /tmp/spec337.jar localhost:8797/api/terminal/sessions | grep -c hnm_xa_ || true               # harus 0
```

Expected: timeline memuat event `web` DAN `api` terurut waktu desc; tanpa kunci → `401`; `projects=hantu` → `403`; grep kunci di daftar sesi → `0`.

- [ ] **Step 5: Tutup sesi & verifikasi kunci ikut mati**

```bash
curl -s -X DELETE localhost:8797/api/terminal/sessions/xaudit-web -b /tmp/spec337.jar -o /dev/null -w '%{http_code}\n'
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Hanoman-Audit-Key: $KEY" "localhost:8797/api/audit/logs?since=24h"
```

Expected: DELETE → `204`; request berikutnya → `401` (kunci mati bersama pane).

- [ ] **Step 6: Matikan server smoke & bersihkan**

```bash
pkill -f "PORT=8797" || pkill -f "server/dist/server.js"
tmux -L hanoman kill-session -t hanoman-xaudit-web 2>/dev/null || true
```

- [ ] **Step 7: Periksa docs SoT masih sinkron**

```bash
grep -n "0074" internal/docs/README.md
grep -n "ProjectLink" internal/docs/architecture/data-model.md
grep -n "audit/logs" internal/docs/architecture/api-contract.md
```

Expected: masing-masing menemukan barisnya (docs ditulis di fase Spec — perbaiki hanya bila ada penyimpangan dari implementasi akhir, mis. nama field yang berubah).

- [ ] **Step 8: Commit penutup**

```bash
git add -A
git commit -m "test(spec-337): verifikasi nyata audit lintas project (server + curl)"
```

---

## Catatan untuk pelaksana

- **Jangan** menambahkan `projectLink` ke `SYNCED`/`FIELDS`/`DELEGATE` di `server/src/services/sync.ts` — LOCAL-only adalah keputusan ADR-0075, bukan kelalaian.
- **Jangan** menaruh kunci audit di response mana pun. Bila sebuah view perlu menandai "sesi ini punya akses log", pakai boolean, bukan kuncinya.
- Bila `tmux` menolak `set-option` untuk daftar project yang sangat panjang, potong scope pada 50 project pertama dan catat pemotongan itu di prompt — jangan gagal diam-diam.
- Sesi cross-audit **membaca** checkout project lain; kalau nanti ada kebutuhan menulis di sana, itu ADR baru, bukan tambalan di prompt.
