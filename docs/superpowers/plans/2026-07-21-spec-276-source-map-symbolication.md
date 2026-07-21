# Source-map Symbolication (SPEC-276) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) with superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bikin stack trace error yang jelas & mudah di-solve dengan symbolication source-map server-side ala Sentry (browser minified → `.tsx` sumber + context lines + `in_app`), plus fix bug fingerprint yang memecah grup tiap deploy (Temuan B).

**Architecture:** SDK mengirim frame terstruktur (`function/filename/lineno/colno/in_app`) + unwrap `error.cause`. Project upload `.map` per `release` (auth DSN key). Server menyimpan frame mentah; saat detail grup dibuka, server symbolicate lazy pakai map yang tersedia + context lines. Semua field baru additive.

**Tech Stack:** TypeScript strict; server Fastify + Prisma (Postgres); `@jridgewell/trace-mapping` (server, symbolication); SDK tetap dependency-free; frontend React.

## Global Constraints

- Design/ADR: `docs/superpowers/specs/2026-07-21-spec-276-source-map-symbolication-design.md`, `internal/docs/adr/0070-symbolication-source-map-server-side.md`.
- Migration **additive only** + hand-written SQL + `migrate deploy` per DB (jangan `migrate dev` — reset di worktree drift). ADR wajib (sudah ADR-0070).
- Jangan jalankan run di working tree utama — ini worktree `.worktrees/spec-276`.
- Kolom stack V8 = 1-based; source-map spec = 0-based → resolver `column - 1`.
- SDK **tanpa dependency**. Server boleh nambah dep.
- Test DB terpisah (memory: sibling vitest truncates hanoman_test) → server tests pakai base DB unik + `migrate deploy`. Test env: `env -u NODE_ENV -u DATABASE_URL`.
- Update docs tersentuh dalam commit yang sama; link di `internal/docs/README.md`.

---

### Task 1: SDK — parse stack, in_app, cause unwrap

**Files:**
- Create: `sdk/src/stack.ts`
- Create: `sdk/test/stack.test.ts`
- Modify: `sdk/src/core.ts` (captureError kirim `frames` + cause-appended `stack`)
- Modify: `sdk/src/index.ts` (handler lempar error asli agar `cause` terbaca)

**Interfaces:**
- Produces:
  - `type Frame = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean }`
  - `parseStack(stack?: string): Frame[]` — parse baris `at ...`(V8) & `fn@url:line:col`(Firefox/Safari); TANPA set in_app.
  - `inApp(filename?: string): boolean` — false bila `node_modules`, `internal/` node, scheme `node:`; true selain itu (termasuk undefined? → false).
  - `framesFromStack(stack?: string): Frame[]` — `parseStack` lalu set `in_app`.
  - `collectStack(err: unknown, maxDepth?: number): string | undefined` — `err.stack` + rangkai `err.cause` ("Caused by: …") sampai maxDepth (default 5).

- [ ] **Step 1: Failing test** `sdk/test/stack.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseStack, inApp, framesFromStack, collectStack } from "../src/stack";

describe("parseStack", () => {
  it("parses V8 parenthesized + anonymous frames", () => {
    const s = [
      "Error: boom",
      "    at foo (/Users/x/app/src/a.ts:10:5)",
      "    at https://cdn.example.com/assets/index-4f3a2b.js:1:88421",
    ].join("\n");
    const f = parseStack(s);
    expect(f[0]).toEqual({ function: "foo", filename: "/Users/x/app/src/a.ts", lineno: 10, colno: 5 });
    expect(f[1]).toEqual({ function: undefined, filename: "https://cdn.example.com/assets/index-4f3a2b.js", lineno: 1, colno: 88421 });
  });
  it("parses Firefox/Safari frames (fn@url:line:col)", () => {
    const s = "foo@https://h/app.js:3:9\n@https://h/app.js:1:1";
    const f = parseStack(s);
    expect(f[0]).toEqual({ function: "foo", filename: "https://h/app.js", lineno: 3, colno: 9 });
    expect(f[1].function).toBeUndefined();
  });
});

describe("inApp", () => {
  it("marks own code in_app, vendor not", () => {
    expect(inApp("/Users/x/app/src/a.ts")).toBe(true);
    expect(inApp("/Users/x/app/node_modules/react/index.js")).toBe(false);
    expect(inApp("node:internal/process/task_queues")).toBe(false);
    expect(inApp(undefined)).toBe(false);
  });
});

describe("framesFromStack", () => {
  it("sets in_app per frame", () => {
    const s = "Error\n    at a (/app/src/a.ts:1:1)\n    at b (/app/node_modules/x/i.js:2:2)";
    const f = framesFromStack(s);
    expect(f[0].in_app).toBe(true);
    expect(f[1].in_app).toBe(false);
  });
});

describe("collectStack", () => {
  it("appends cause chain", () => {
    const cause = { stack: "Error: root\n    at r (/app/src/r.ts:9:1)" };
    const err = { stack: "Error: top\n    at t (/app/src/t.ts:1:1)", cause };
    const out = collectStack(err);
    expect(out).toContain("at t (/app/src/t.ts:1:1)");
    expect(out).toContain("Caused by:");
    expect(out).toContain("at r (/app/src/r.ts:9:1)");
  });
  it("undefined stack → undefined", () => {
    expect(collectStack({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL** `pnpm --filter hanoman-sdk test` (module not found)

- [ ] **Step 3: Implement** `sdk/src/stack.ts`

```ts
// hanoman-sdk stack parsing — dependency-free, isomorphic. Ubah stack string → frame terstruktur.
export type Frame = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean };

// Lokasi "file:line:col" bisa berupa path OS, URL, atau "<anonymous>". Ambil trailing :line:col.
function splitLoc(loc: string): { filename?: string; lineno?: number; colno?: number } {
  const m = loc.match(/^(.*?):(\d+):(\d+)$/);
  if (!m) return { filename: loc || undefined };
  return { filename: m[1] || undefined, lineno: Number(m[2]), colno: Number(m[3]) };
}

export function parseStack(stack?: string): Frame[] {
  if (!stack) return [];
  const out: Frame[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    // V8: "at fn (loc)"  |  "at loc"
    if (line.startsWith("at ")) {
      const body = line.slice(3).trim();
      const paren = body.match(/^(.*?)\s+\((.*)\)$/);
      if (paren) out.push({ function: paren[1] || undefined, ...splitLoc(paren[2]) });
      else out.push({ function: undefined, ...splitLoc(body) });
      continue;
    }
    // Firefox/Safari: "fn@loc"  |  "@loc"
    const at = line.match(/^([^@]*)@(.+)$/);
    if (at) out.push({ function: at[1] || undefined, ...splitLoc(at[2]) });
  }
  return out;
}

export function inApp(filename?: string): boolean {
  if (!filename) return false;
  if (filename.startsWith("node:")) return false;
  if (/[/\\]node_modules[/\\]/.test(filename)) return false;
  return true;
}

export function framesFromStack(stack?: string): Frame[] {
  return parseStack(stack).map((f) => ({ ...f, in_app: inApp(f.filename) }));
}

export function collectStack(err: unknown, maxDepth = 5): string | undefined {
  const seen = new Set<unknown>();
  let cur = err as { stack?: string; message?: string; name?: string; cause?: unknown } | undefined;
  let out: string | undefined;
  for (let d = 0; d < maxDepth && cur && !seen.has(cur); d++) {
    seen.add(cur);
    const piece = typeof cur.stack === "string" && cur.stack
      ? cur.stack
      : cur.message ? `${cur.name || "Error"}: ${cur.message}` : "";
    if (piece) out = out === undefined ? piece : `${out}\nCaused by: ${piece}`;
    cur = cur.cause as typeof cur;
  }
  return out;
}
```

- [ ] **Step 4: Wire into `sdk/src/core.ts`** — `captureError` pakai `collectStack` + `framesFromStack`:

```ts
import { collectStack, framesFromStack } from "./stack";
// ... di captureError, ganti body send():
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const c = cfg;
  const e = err as { name?: string; message?: string };
  const stack = collectStack(err);
  send({
    type: e?.name || "Error",
    message: e?.message || String(err),
    stack,
    frames: framesFromStack(stack),
    environment: c?.environment,
    release: c?.release,
    context,
  });
}
```

- [ ] **Step 5: `sdk/src/index.ts`** — lempar error asli (bukan sintetik) agar `cause` ada:

```ts
// installBrowserHandlers: pakai ev.error bila ada (Error asli → punya .cause/.stack)
g.addEventListener("error", (e: unknown) => {
  const ev = e as { error?: unknown; message?: string };
  captureError(ev.error ?? { name: "Error", message: ev.message || "Error" }, browserContext());
});
// unhandledrejection: reason apa adanya (Error/objek/primitif) → captureError sudah tahan banting
g.addEventListener("unhandledrejection", (e: unknown) => {
  const ev = e as { reason?: unknown };
  captureError(ev.reason ?? { name: "UnhandledRejection", message: "unhandled rejection" }, browserContext());
});
```

- [ ] **Step 6: Run → PASS** `pnpm --filter hanoman-sdk test`; build `pnpm --filter hanoman-sdk build`
- [ ] **Step 7: Bump SDK version** `sdk/package.json` `"version": "0.2.0"`
- [ ] **Step 8: Commit** `feat(spec-276): SDK kirim frame terstruktur + in_app + unwrap error.cause`

---

### Task 2: shared DTOs (frames, symbolicated, upload, release)

**Files:**
- Modify: `shared/src/dto.ts` (blok error monitoring ~L263-292)
- Test: `shared/test/dto.test.ts` (buat bila belum ada; kalau ada, tambah kasus)

**Interfaces:**
- Produces: `zStackFrame`, `StackFrame`, `zSymbolicatedFrame`, `SymbolicatedFrame`, `zSourceMapUpload`, `SourceMapUpload`; `zIngestPayload` +`frames?`; `zErrorGroupView` +`release`; `zErrorGroupDetail` +`sampleFrames`.

- [ ] **Step 1: Failing test** `shared/test/dto.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { zIngestPayload, zSourceMapUpload, zErrorGroupView } from "../src/dto";

describe("dto SPEC-276", () => {
  it("ingest payload accepts optional frames", () => {
    const r = zIngestPayload.safeParse({ type: "TypeError", message: "x",
      frames: [{ function: "f", filename: "a.js", lineno: 1, colno: 2, in_app: true }] });
    expect(r.success).toBe(true);
  });
  it("ingest payload valid without frames (backward compat)", () => {
    expect(zIngestPayload.safeParse({ type: "E", message: "x" }).success).toBe(true);
  });
  it("group view requires release (nullable)", () => {
    const r = zErrorGroupView.safeParse({ id: "1", projectId: "p", type: "E", message: "m",
      environment: "production", status: "new", count: 1, firstSeenAt: "t", lastSeenAt: "t",
      specId: null, release: null });
    expect(r.success).toBe(true);
  });
  it("sourcemap upload requires release + artifacts", () => {
    expect(zSourceMapUpload.safeParse({ release: "1.0.0",
      artifacts: [{ filename: "index-abc.js", map: "{}" }] }).success).toBe(true);
    expect(zSourceMapUpload.safeParse({ release: "1.0.0", artifacts: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared test`
- [ ] **Step 3: Implement** — edit `shared/src/dto.ts`:

```ts
// SPEC-276 · frame terstruktur (SDK→server) + symbolicated (server→UI) + upload source-map.
export const zStackFrame = z.object({
  function: z.string().max(500).optional(),
  filename: z.string().max(2000).optional(),
  lineno: z.number().int().optional(),
  colno: z.number().int().optional(),
  in_app: z.boolean().optional(),
});
export type StackFrame = z.infer<typeof zStackFrame>;

export const zSymbolicatedFrame = zStackFrame.extend({
  source: z.string().optional(),
  sourceLine: z.number().int().optional(),
  sourceColumn: z.number().int().optional(),
  contextLine: z.string().optional(),
  preContext: z.array(z.string()).optional(),
  postContext: z.array(z.string()).optional(),
  symbolicated: z.boolean(),
});
export type SymbolicatedFrame = z.infer<typeof zSymbolicatedFrame>;

export const zSourceMapUpload = z.object({
  release: z.string().min(1).max(200),
  artifacts: z.array(z.object({
    filename: z.string().min(1).max(2000),
    map: z.string().min(1),
    debugId: z.string().max(200).optional(),
  })).min(1).max(200),
});
export type SourceMapUpload = z.infer<typeof zSourceMapUpload>;
```

Ubah `zIngestPayload` → tambah `frames: z.array(zStackFrame).max(200).optional(),`.
Ubah `zErrorGroupView` → tambah `release: z.string().nullable(),`.
Ubah `zErrorGroupDetail` → `.extend({ sampleStack: z.string().nullable(), sampleFrames: z.array(zSymbolicatedFrame).nullable(), events: z.array(zErrorEventView) })`.

- [ ] **Step 4: Run → PASS**; build `pnpm --filter @hanoman/shared build`
- [ ] **Step 5: Commit** `feat(spec-276): DTO frames + symbolicated + sourcemap upload + release`

---

### Task 3: Schema migration (additive)

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260721000000_spec276_symbolication/migration.sql`

**Interfaces:**
- Produces: model `SourceMapArtifact`; `ErrorEvent.frames Json?`; `ErrorGroup.sampleFrames Json?` + `release String?`; `Project.sourceMaps SourceMapArtifact[]`.

- [ ] **Step 1: Edit `schema.prisma`** — tambah kolom & model:
  - `ErrorGroup`: tambah `sampleFrames Json?` dan `release String?` (setelah `sampleStack`).
  - `ErrorEvent`: tambah `frames Json?` (setelah `stack`).
  - `Project`: tambah relasi balik `sourceMaps SourceMapArtifact[]` (di daftar relasi).
  - Tambah model:

```prisma
// SPEC-276 · ADR-0070 · source-map ter-upload per release untuk symbolication. Byte map di
// HANOMAN_UPLOAD_DIR (server-local, TAK disync — cermin TicketAttachment biner & ErrorEvent).
model SourceMapArtifact {
  id         String   @id @default(cuid())
  projectId  String
  release    String
  filename   String   // basename artifact hasil-build (mis. index-4f3a2b.js) yang dipetakan map ini
  debugId    String?
  storageKey String   // berkas opaque (uuid.map) di upload dir
  size       Int
  createdAt  DateTime @default(now())
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, release, filename])
  @@index([projectId, release])
}
```

- [ ] **Step 2: Hand-write** `migration.sql`:

```sql
-- SPEC-276 · ADR-0070 · symbolication source-map (additive, aman VPS live)
CREATE TABLE "SourceMapArtifact" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "release" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "debugId" TEXT,
  "storageKey" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceMapArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceMapArtifact_projectId_release_filename_key" ON "SourceMapArtifact"("projectId", "release", "filename");
CREATE INDEX "SourceMapArtifact_projectId_release_idx" ON "SourceMapArtifact"("projectId", "release");
ALTER TABLE "SourceMapArtifact" ADD CONSTRAINT "SourceMapArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ErrorEvent" ADD COLUMN "frames" JSONB;
ALTER TABLE "ErrorGroup" ADD COLUMN "sampleFrames" JSONB;
ALTER TABLE "ErrorGroup" ADD COLUMN "release" TEXT;
```

- [ ] **Step 3: Apply per DB + generate** (dev + test base). Contoh:

```bash
cd server
DATABASE_URL=postgresql://hanoman:hanoman@localhost:5433/hanoman npx prisma migrate deploy
# test DB (base unik untuk hindari sibling truncate) — buat & migrate bila perlu
npx prisma generate
```

- [ ] **Step 4: Verify** `npx prisma migrate status` → up to date; `node -e "require('@prisma/client'); console.log('ok')"`.
- [ ] **Step 5: Commit** `feat(spec-276): migration additif SourceMapArtifact + frames/sampleFrames/release`

---

### Task 4: sourcemap-store service (save/find/retention)

**Files:**
- Create: `server/src/services/sourcemap-store.ts`
- Test: `server/src/services/sourcemap-store.test.ts`

**Interfaces:**
- Consumes: `uploadDir()` dari `./uploads`; `prisma` dari `../db`.
- Produces:
  - `basenameOf(ref: string): string` — buang query/fragment lalu segmen setelah `/`|`\`.
  - `saveSourceMap(projectId: string, release: string, filename: string, mapText: string, debugId?: string): Promise<{ id: string; storageKey: string; size: number }>` — tulis byte ke `uploadDir()/<uuid>.map`, upsert row (unique projectId+release+filename).
  - `findSourceMap(projectId: string, release: string, frameFilename: string): Promise<string | null>` — cocokkan `basenameOf(frameFilename)`; baca byte → string; null bila tak ada.
  - `pruneReleases(projectId: string, keep?: number): Promise<void>` — sisakan `keep` release terbaru (default 10) per project; hapus row + berkas release lama.

- [ ] **Step 1: Failing test** `server/src/services/sourcemap-store.test.ts` (pakai base DB unik; import prisma; bersih-bersih project test di afterEach).

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db";
import { saveSourceMap, findSourceMap, pruneReleases, basenameOf } from "./sourcemap-store";

const P = "smtest-proj";
beforeAll(async () => {
  await prisma.project.upsert({ where: { id: P }, update: {}, create: { id: P, name: "sm" } });
});
afterAll(async () => { await prisma.project.delete({ where: { id: P } }).catch(() => {}); });

describe("basenameOf", () => {
  it("strips path + query + fragment", () => {
    expect(basenameOf("https://h/assets/index-4f3a2b.js?v=1#x")).toBe("index-4f3a2b.js");
    expect(basenameOf("/Users/x/app/dist/a.js")).toBe("a.js");
  });
});

describe("save/find roundtrip", () => {
  it("finds map by basename of frame filename", async () => {
    await saveSourceMap(P, "1.0.0", "index-4f3a2b.js", '{"version":3}');
    const got = await findSourceMap(P, "1.0.0", "https://cdn/assets/index-4f3a2b.js?v=9");
    expect(got).toBe('{"version":3}');
    expect(await findSourceMap(P, "1.0.0", "nope.js")).toBeNull();
    expect(await findSourceMap(P, "2.0.0", "index-4f3a2b.js")).toBeNull();
  });
});

describe("retention", () => {
  it("keeps only N newest releases", async () => {
    for (const r of ["r1", "r2", "r3"]) await saveSourceMap(P, r, "a.js", "{}");
    await pruneReleases(P, 2);
    const rows = await prisma.sourceMapArtifact.findMany({ where: { projectId: P, filename: "a.js" } });
    const rels = new Set(rows.map((x) => x.release));
    expect(rels.has("r1")).toBe(false);
    expect(rels.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `sourcemap-store.ts`:

```ts
// SPEC-276 · ADR-0070 · simpan/temukan source-map per release. Byte di HANOMAN_UPLOAD_DIR (pola
// uploads.ts): server-local, di luar repoDir, TAK disync. Metadata di SourceMapArtifact.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../db";
import { uploadDir } from "./uploads";

export function basenameOf(ref: string): string {
  const clean = ref.split(/[?#]/)[0];
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || clean;
}

export async function saveSourceMap(
  projectId: string, release: string, filename: string, mapText: string, debugId?: string,
): Promise<{ id: string; storageKey: string; size: number }> {
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const base = basenameOf(filename);
  const storageKey = `${randomUUID()}.map`;
  const buf = Buffer.from(mapText, "utf8");
  await writeFile(join(dir, storageKey), buf);
  // upsert: bila map untuk (project,release,basename) sudah ada, ganti berkas & metadata.
  const prev = await prisma.sourceMapArtifact.findUnique({
    where: { projectId_release_filename: { projectId, release, filename: base } },
  });
  const row = await prisma.sourceMapArtifact.upsert({
    where: { projectId_release_filename: { projectId, release, filename: base } },
    update: { storageKey, size: buf.length, debugId: debugId ?? null },
    create: { projectId, release, filename: base, storageKey, size: buf.length, debugId: debugId ?? null },
  });
  if (prev && prev.storageKey !== storageKey)
    await unlink(join(dir, prev.storageKey)).catch(() => {});
  return { id: row.id, storageKey, size: buf.length };
}

export async function findSourceMap(
  projectId: string, release: string, frameFilename: string,
): Promise<string | null> {
  const base = basenameOf(frameFilename);
  const row = await prisma.sourceMapArtifact.findUnique({
    where: { projectId_release_filename: { projectId, release, filename: base } },
  });
  if (!row) return null;
  try {
    const buf = await readFile(join(uploadDir(), row.storageKey.replace(/[/\\]/g, "")));
    return buf.toString("utf8");
  } catch { return null; }
}

export async function pruneReleases(projectId: string, keep = 10): Promise<void> {
  const rows = await prisma.sourceMapArtifact.findMany({
    where: { projectId }, orderBy: { createdAt: "desc" },
  });
  const seen: string[] = [];
  for (const r of rows) if (!seen.includes(r.release)) seen.push(r.release);
  const keepSet = new Set(seen.slice(0, keep));
  const dir = uploadDir();
  for (const r of rows) if (!keepSet.has(r.release)) {
    await unlink(join(dir, r.storageKey.replace(/[/\\]/g, ""))).catch(() => {});
    await prisma.sourceMapArtifact.delete({ where: { id: r.id } }).catch(() => {});
  }
}
```

- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** `feat(spec-276): sourcemap-store save/find/retention`

---

### Task 5: symbolicate resolver (@jridgewell/trace-mapping)

**Files:**
- Modify: `server/package.json` (dep `@jridgewell/trace-mapping`)
- Create: `server/src/services/symbolicate.ts`
- Test: `server/src/services/symbolicate.test.ts`

**Interfaces:**
- Produces:
  - `type FrameLike = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean }`
  - `type MapLookup = (frameFilename: string) => string | null | Promise<string | null>`
  - `symbolicateFrames(frames: FrameLike[], lookup: MapLookup): Promise<SymbolicatedFrame[]>` — per frame: cari map via `lookup(filename)`; `originalPositionFor(tracer, { line: lineno, column: (colno ?? 1) - 1 })`; isi `source/sourceLine/sourceColumn`, `function = name || function`, `in_app = !source.includes("node_modules")`, context lines dari `sourceContentFor`. Gagal/map absen → frame apa adanya + `symbolicated:false`.

- [ ] **Step 1: Add dep** `server/package.json` dependencies: `"@jridgewell/trace-mapping": "^0.3.25"`, lalu `pnpm install`.

- [ ] **Step 2: Failing test** `server/src/services/symbolicate.test.ts` — pakai source-map buatan tangan. Bangun map dari sumber "known" via `@jridgewell/gen-mapping`? Hindari dep test tambahan: tulis map minimal manual dengan satu mapping.

```ts
import { describe, it, expect } from "vitest";
import { symbolicateFrames } from "./symbolicate";

// Map minimal: generated (line 1, col 10) → source "src/app.ts" (line 2, col 0), name "handleClick".
// Encoding VLQ untuk segmen [genCol=10, srcIdx=0, srcLine=2(0-based=1), srcCol=0, nameIdx=0]
// = "U,C,C,A,A" bukan trivial; pakai gen-mapping bila tersedia, else map literal terverifikasi.
const rawMap = JSON.stringify({
  version: 3,
  sources: ["src/app.ts"],
  sourcesContent: ["const a = 1;\nfunction handleClick() { throw new Error('x'); }\nconst b = 2;\n"],
  names: ["handleClick"],
  // mappings untuk generated line 1: segmen di kolom 10 → source[0] line 1(0-based) col 0 name[0]
  mappings: "UACCA",
});

describe("symbolicateFrames", () => {
  it("maps generated position to source + context lines (col-1 adjust)", async () => {
    const out = await symbolicateFrames(
      [{ function: "t", filename: "index-4f3a2b.js", lineno: 1, colno: 11 }],
      () => rawMap,
    );
    expect(out[0].symbolicated).toBe(true);
    expect(out[0].source).toBe("src/app.ts");
    expect(out[0].sourceLine).toBe(2);
    expect(out[0].contextLine).toContain("handleClick");
    expect(out[0].function).toBe("handleClick");
  });
  it("no map → raw frame, symbolicated false", async () => {
    const out = await symbolicateFrames([{ filename: "a.js", lineno: 1, colno: 1 }], () => null);
    expect(out[0].symbolicated).toBe(false);
    expect(out[0].filename).toBe("a.js");
  });
  it("bad map → symbolicated false, never throws", async () => {
    const out = await symbolicateFrames([{ filename: "a.js", lineno: 1, colno: 1 }], () => "not json");
    expect(out[0].symbolicated).toBe(false);
  });
});
```

> Catatan eksekusi: verifikasi `mappings` di atas benar-benar memetakan (genCol 10 → src line 1/0-based col 0 name 0) SAAT implement; bila VLQ tak cocok, generate map yang benar dengan `@jridgewell/gen-mapping` di test (dep sudah transitive dari trace-mapping) lalu `encodedMappings`/`toEncodedMap`. Yang WAJIB lulus adalah perilaku (source/line/context/col-1), bukan string mappings spesifik.

- [ ] **Step 3: Run → FAIL**
- [ ] **Step 4: Implement** `symbolicate.ts`:

```ts
// SPEC-276 · ADR-0070 · symbolication server-side: frame minified → posisi sumber + context lines.
// Gotcha: stack V8 pakai kolom 1-based; source-map spec 0-based → kurangi 1.
import { TraceMap, originalPositionFor, sourceContentFor } from "@jridgewell/trace-mapping";
import type { SymbolicatedFrame } from "@hanoman/shared";

export type FrameLike = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean };
export type MapLookup = (frameFilename: string) => string | null | Promise<string | null>;

const CONTEXT = 3;

export async function symbolicateFrames(frames: FrameLike[], lookup: MapLookup): Promise<SymbolicatedFrame[]> {
  const cache = new Map<string, TraceMap | null>();
  const out: SymbolicatedFrame[] = [];
  for (const f of frames) {
    const base: SymbolicatedFrame = { ...f, symbolicated: false };
    if (!f.filename || !f.lineno) { out.push(base); continue; }
    let tracer = cache.get(f.filename);
    if (tracer === undefined) {
      const text = await lookup(f.filename);
      try { tracer = text ? new TraceMap(text) : null; } catch { tracer = null; }
      cache.set(f.filename, tracer);
    }
    if (!tracer) { out.push(base); continue; }
    try {
      const pos = originalPositionFor(tracer, { line: f.lineno, column: (f.colno ?? 1) - 1 });
      if (pos.source == null || pos.line == null) { out.push(base); continue; }
      const content = sourceContentFor(tracer, pos.source);
      let contextLine: string | undefined, preContext: string[] | undefined, postContext: string[] | undefined;
      if (content != null) {
        const lines = content.split("\n");
        const idx = pos.line - 1; // pos.line 1-based
        contextLine = lines[idx];
        preContext = lines.slice(Math.max(0, idx - CONTEXT), idx);
        postContext = lines.slice(idx + 1, idx + 1 + CONTEXT);
      }
      out.push({
        ...f,
        function: pos.name ?? f.function,
        source: pos.source,
        sourceLine: pos.line,
        sourceColumn: pos.column ?? undefined,
        in_app: !/node_modules/.test(pos.source),
        contextLine, preContext, postContext,
        symbolicated: true,
      });
    } catch { out.push(base); }
  }
  return out;
}
```

- [ ] **Step 5: Run → PASS**
- [ ] **Step 6: Commit** `feat(spec-276): symbolicate resolver + @jridgewell/trace-mapping`

---

### Task 6: ingest wiring + fingerprint fix (Temuan B)

**Files:**
- Modify: `server/src/services/error-fingerprint.ts`
- Modify: `server/src/services/error-fingerprint.test.ts`
- Modify: `server/src/services/error-ingest.ts`

**Interfaces:**
- Consumes: `StackFrame` (shared).
- Produces: `normalizeBundleName(name: string): string`; `fingerprint(type, message, stack?, frames?)` (param `frames?: {function?;filename?;in_app?}[]`).

- [ ] **Step 1: Failing test** — tambah ke `error-fingerprint.test.ts`:

```ts
import { normalizeBundleName } from "./error-fingerprint";

it("normalizeBundleName strips content-hash", () => {
  expect(normalizeBundleName("index-4f3a2b.js")).toBe("index.js");
  expect(normalizeBundleName("index-9z8y7w.js")).toBe("index.js");
  expect(normalizeBundleName("app.a1b2c3d4.js")).toBe("app.js");
  expect(normalizeBundleName("d3-scale.js")).toBe("d3-scale.js");   // no digit → keep
  expect(normalizeBundleName("chart-v2.js")).toBe("chart-v2.js");   // too short → keep
});

it("Temuan B: hashed bundle groups stably across deploys (parenthesized)", () => {
  const a = "Error: x\n    at t (https://h/assets/index-4f3a2b.js:1:5)";
  const b = "Error: x\n    at t (https://h/assets/index-9z8y7w.js:9:9)";
  expect(fingerprint("Error", "x", a)).toBe(fingerprint("Error", "x", b));
});
it("Temuan B: hashed bundle groups stably across deploys (anonymous)", () => {
  const a = "Error: x\n    at https://h/assets/index-4f3a2b.js:1:5";
  const b = "Error: x\n    at https://h/assets/index-9z8y7w.js:9:9";
  expect(fingerprint("Error", "x", a)).toBe(fingerprint("Error", "x", b));
});
it("fingerprint prefers in_app frame when frames present", () => {
  const frames = [{ function: "handleClick", filename: "index-4f3a2b.js", in_app: true }];
  const frames2 = [{ function: "handleClick", filename: "index-9z8y7w.js", in_app: true }];
  expect(fingerprint("Error", "x", undefined, frames)).toBe(fingerprint("Error", "x", undefined, frames2));
});
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — `error-fingerprint.ts` (ganti `topFrame`, tambah helper, ubah `fingerprint`):

```ts
// Buang segmen content-hash pada basename bundle: "index-4f3a2b.js" → "index.js" (grup stabil
// lintas deploy, Temuan B audit SPEC-275). Hanya token ≥6 char yang MENGANDUNG digit yang di-strip.
export function normalizeBundleName(name: string): string {
  return name.replace(/([-.])(?=[a-z0-9_]*\d)[a-z0-9_]{6,}(\.[a-z0-9]+)$/i, "$2");
}

function baseOf(s: string): string {
  const clean = s.split(/[?#]/)[0];
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || clean;
}

// Frame teratas → "at fn (basename)" dengan basename ternormalisasi hash. Anonim & berkurung sama-sama
// direduksi ke basename (bukan URL/path penuh) agar tak volatile antar-deploy.
export function topFrame(stack?: string): string {
  if (!stack) return "";
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    return line
      .replace(/:\d+:\d+/g, "")
      .replace(/\(([^)]*)\)/g, (_m, inner) => `(${normalizeBundleName(baseOf(inner))})`)
      .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s()]+/gi, (m) => normalizeBundleName(baseOf(m)))
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

type FpFrame = { function?: string; filename?: string; in_app?: boolean };
function topFrameFromFrames(frames: FpFrame[]): string {
  const f = frames.find((x) => x.in_app) ?? frames[0];
  if (!f) return "";
  return `at ${f.function ?? "?"} (${normalizeBundleName(baseOf(f.filename ?? ""))})`;
}

export function fingerprint(type: string, message: string, stack?: string, frames?: FpFrame[]): string {
  const top = frames && frames.length ? topFrameFromFrames(frames) : topFrame(stack);
  const basis = `${type}\n${normalizeMessage(message)}\n${top}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
```

- [ ] **Step 4: Wire `error-ingest.ts`** — pakai frames + simpan release/sampleFrames/frames:
  - `const frames = payload.frames;`
  - `const fp = fingerprint(type, message, stack ?? undefined, frames);`
  - create group: tambah `sampleFrames: frames as object | undefined, release: payload.release ?? null` ke `data`.
  - update group (dua jalur: existing + P2002): tambah `release: payload.release ?? undefined` (undefined = tak ubah bila event ini tanpa release).
  - create event: tambah `frames: frames as object | undefined` ke `data`.

- [ ] **Step 5: Run → PASS** (fingerprint tests + ingest tests hijau)
- [ ] **Step 6: Commit** `fix(spec-276): fingerprint stabil lintas deploy (Temuan B) + ingest simpan frames/release`

---

### Task 7: routes — upload source-map + errors symbolication

**Files:**
- Modify: `server/src/routes/ingest.ts` (route upload)
- Modify: `server/src/routes/errors.ts` (release + sampleFrames symbolicated)
- Test: `server/src/routes/errors.route.test.ts` (buat/extend), `server/src/routes/ingest.route.test.ts` (extend)

**Interfaces:**
- Consumes: `zSourceMapUpload` (shared), `saveSourceMap`/`pruneReleases`/`findSourceMap` (sourcemap-store), `symbolicateFrames` (symbolicate).

- [ ] **Step 1: Failing route test** — buat/extend test yang: (a) POST ingest dengan frames + release lalu POST sourcemaps map valid → 202; (b) GET /errors/:id → `sampleFrames` tersimbolikasi (`symbolicated:true`, `source` benar) + `release` muncul. Pakai app builder yang ada (lihat pola test route lain: `buildApp`/`inject`).

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement upload route** — `ingest.ts`, tambah setelah handler ingest:

```ts
import { zSourceMapUpload } from "@hanoman/shared";
import { saveSourceMap, pruneReleases } from "../services/sourcemap-store";
const SOURCEMAP_CAP = 30 * 1024 * 1024;

app.options("/ingest/:slug/sourcemaps", async (_req, reply) => { cors(reply); return reply.code(204).send(); });
app.post("/ingest/:slug/sourcemaps", { bodyLimit: SOURCEMAP_CAP }, async (req, reply) => {
  cors(reply);
  const { slug } = req.params as { slug: string };
  const key = (req.query as { key?: string }).key ?? (req.headers["x-hanoman-dsn"] as string | undefined) ?? "";
  const project = await prisma.project.findUnique({ where: { id: slug } });
  if (!project || !verifyKey(key, project.ingestKeyHash)) return reply.code(401).send({ error: "unauthorized" });
  const parsed = zSourceMapUpload.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid payload" });
  const total = parsed.data.artifacts.reduce((n, a) => n + a.map.length, 0);
  if (total > SOURCEMAP_CAP) return reply.code(413).send({ error: "payload too large" });
  for (const a of parsed.data.artifacts)
    await saveSourceMap(project.id, parsed.data.release, a.filename, a.map, a.debugId);
  await pruneReleases(project.id);
  return reply.code(202).send({ ok: true, stored: parsed.data.artifacts.length });
});
```
(`import { verifyKey } from "../services/ingest-key";` sudah ada.)

- [ ] **Step 4: Implement errors symbolication** — `errors.ts`:
  - `groupView` += `release: g.release`.
  - Ganti handler `GET /errors/:id`:

```ts
import { symbolicateFrames } from "../services/symbolicate";
import { findSourceMap } from "../services/sourcemap-store";
// ...
app.get("/errors/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const g = await prisma.errorGroup.findUnique({ where: { id } });
  if (!g) return reply.code(404).send({ error: "not found" });
  const events = await prisma.errorEvent.findMany({
    where: { groupId: id }, orderBy: { receivedAt: "desc" }, take: 50,
  });
  const sampleFrames = Array.isArray(g.sampleFrames)
    ? await symbolicateFrames(g.sampleFrames as FrameLike[],
        (fn) => findSourceMap(g.projectId, g.release ?? "", fn))
    : null;
  return { ...groupView(g), sampleStack: g.sampleStack, sampleFrames, events: events.map(eventView) };
});
```
(`import type { FrameLike } from "../services/symbolicate";`)

- [ ] **Step 5: Run → PASS**
- [ ] **Step 6: Commit** `feat(spec-276): route upload source-map + symbolication di detail grup`

---

### Task 8: Frontend — frame list + release badge

**Files:**
- Modify: `src/src/screens/ErrorsScreen.tsx`

**Interfaces:**
- Consumes: `ErrorGroupDetail.sampleFrames: SymbolicatedFrame[] | null`, `.release`, `ErrorGroupView.release` (via shared).

- [ ] **Step 1: Implement `FrameList`** komponen dalam `ErrorsScreen.tsx` (render bila `g.sampleFrames?.length`, else fallback `<pre>{g.sampleStack}</pre>`):

```tsx
function FrameList({ frames }: { frames: import("@hanoman/shared").SymbolicatedFrame[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {frames.map((f, i) => {
        const loc = f.symbolicated
          ? `${f.source}:${f.sourceLine}${f.sourceColumn != null ? ":" + f.sourceColumn : ""}`
          : `${f.filename ?? "?"}${f.lineno != null ? ":" + f.lineno : ""}`;
        return (
          <div key={i} style={{
            padding: "6px 10px", borderRadius: "var(--radius-sm)",
            background: f.in_app ? "var(--bone-100)" : "transparent",
            border: "1px solid var(--border-hair)", opacity: f.in_app ? 1 : 0.7,
            fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          }}>
            <div style={{ color: "var(--text-strong)" }}>
              {f.function ?? "<anonymous>"} {f.symbolicated ? "" : "· raw"}
            </div>
            <div style={{ color: "var(--text-subtle)" }}>{loc}</div>
            {f.contextLine != null && (
              <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", color: "var(--text-body)" }}>{f.contextLine.trim()}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Ganti blok "Stack sampel"** di `GroupDetail` → render `FrameList` bila ada, else `<pre>`:

```tsx
{g.sampleFrames && g.sampleFrames.length > 0 ? (
  <div>
    <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Stack (symbolicated)</div>
    <FrameList frames={g.sampleFrames} />
  </div>
) : g.sampleStack ? (
  <div>
    <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Stack sampel</div>
    <pre style={{ /* gaya lama */ }}>{g.sampleStack}</pre>
  </div>
) : null}
```

- [ ] **Step 3: Tambah badge `release`** di baris meta `GroupDetail` (setelah env): `{g.release && <span>release: <b>{g.release}</b></span>}`. Di `GroupRow` meta tambahkan `{g.release ? ` · ${g.release}` : ""}`.
- [ ] **Step 4: Typecheck build** `pnpm --filter @hanoman/web build` (atau tsc) → hijau.
- [ ] **Step 5: Commit** `feat(spec-276): tampilkan frame symbolicated + release di Errors`

---

### Task 9: Docs + live verification

**Files:**
- Modify: `sdk/README.md` (upload source-map + `--enable-source-maps` + wajib `release`)
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`

- [ ] **Step 1: `sdk/README.md`** — tambah bagian "Source-map (stack jelas untuk build minified)": wajib set `release` sama di `init()` & saat upload; contoh upload `curl`/Node kecil ke `POST /api/ingest/<slug>/sourcemaps?key=...` body `{ release, artifacts:[{ filename, map }] }`; catatan Node `node --enable-source-maps` untuk fidelity backend.
- [ ] **Step 2: `data-model.md`** — dokumentasikan `SourceMapArtifact` + kolom baru `ErrorEvent.frames`, `ErrorGroup.sampleFrames/release`; tegaskan server-local/tak disync.
- [ ] **Step 3: `api-contract.md`** — dokumentasikan `POST /api/ingest/:slug/sourcemaps`, payload `frames?`, response `GET /errors` +`release`, `GET /errors/:id` +`sampleFrames`.
- [ ] **Step 4: Full test suite** `env -u NODE_ENV -u DATABASE_URL pnpm -r test` (server pakai base DB unik) → hijau.
- [ ] **Step 5: Live smoke** — boot server ke DB throwaway ter-migrate; buat project + DSN; `curl` POST ingest (dengan frames+release) → POST sourcemaps (map valid untuk filename frame) → GET /errors → GET /errors/:id; verifikasi `sampleFrames[].symbolicated=true`, `source` menunjuk `.ts`, `release` muncul. Simpan transcript ke scratchpad.
- [ ] **Step 6: Commit** `docs(spec-276): SDK README source-map upload + data-model/api-contract + verify`

---

## Self-Review

- **Spec coverage:** frames terstruktur (T1/T2), upload+store (T3/T4/T7), resolver+context+col-1 (T5), display (T8), fingerprint Temuan B (T6), in_app (T1/T5/T8), release surfaced (T2/T6/T7/T8), docs (T9). ✔
- **Placeholder scan:** semua step berisi kode/aksi nyata; satu catatan eksekusi eksplisit di T5 (verifikasi VLQ mappings; fallback gen-mapping) — bukan placeholder, tapi instruksi verifikasi. ✔
- **Type consistency:** `Frame`(SDK)/`StackFrame`(shared)/`FrameLike`(server) sengaja terpisah per-lapis; `SymbolicatedFrame` dipakai konsisten server↔shared↔UI; `fingerprint(type,message,stack?,frames?)` konsisten di T6. `basenameOf`(store) vs `baseOf`(fingerprint, private) — dua unit berbeda, sengaja. ✔
