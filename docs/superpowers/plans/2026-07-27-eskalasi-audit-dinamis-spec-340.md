# SPEC-340 — Eskalasi audit dinamis (QA · Feature brief · PRD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit (dan cross-audit) bisa dieskalasi ke Finding QA, Feature brief, atau PRD — dengan hanoman merekomendasikan target yang cocok, terbaca mesin dari blok `json` di dokumen audit.

**Architecture:** Sesi audit menulis satu blok ```json kanonik `{escalation:{target,reason,alternatives,prefill}}` di dokumen audit SoT (pola manifest breakdown ADR-0069). Server mem-parse-nya sebagai **nilai turunan** (freshest-wins lewat `listSpecDocs`) dan menyajikannya di `GET /api/specs/:id/escalation` — tanpa kolom DB, tanpa migration. UI menyorot target rekomendasi tapi tetap menyediakan ketiganya; tiga aksi mem-prefill `NewSpecModal` (qa/brief) atau modal brief PRD (`POST /terminal/sessions {flow:"prd", branchFrom, fromAudit}`).

**Tech Stack:** TypeScript strict · zod (`@hanoman/shared`) · Fastify (server) · React + Vite (`src/`) · vitest (`vitest run --no-file-parallelism`) · Testing Library (frontend).

## Global Constraints

- **ADR acuan:** ADR-0076 (`internal/docs/adr/0076-eskalasi-audit-dinamis-manifest-rekomendasi.md`). Spec desain: `docs/superpowers/specs/2026-07-27-spec-340-eskalasi-audit-dinamis-design.md`.
- **TANPA perubahan skema Prisma dan TANPA migration.** Bila sebuah task terasa butuh kolom baru, itu tanda salah jalur — rekomendasi adalah nilai turunan dokumen (ADR-0018/0011).
- **Target eskalasi hanya empat nilai:** `"none" | "qa" | "brief" | "prd"`. Persis string itu, huruf kecil.
- **Parser harus defensif** — manifest ditulis agen. Tanpa blok / JSON rusak / target tak dikenal → `null`, **jangan** melempar.
- **Perilaku lama harus utuh**: `POST /terminal/sessions {flow:"prd"}` tanpa `branchFrom`/`fromAudit` tetap memakai worktree dari `"HEAD"` dan prompt tanpa blok audit. Tombol "Jadikan Finding QA" yang ada tak berubah bentuk.
- **Bahasa komentar & UI: Indonesia**, mengikuti gaya berkas sekitarnya (komentar menyebut nomor SPEC/ADR).
- **Perintah test repo:** `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism` (dari root; env prod di shell bikin puluhan test gagal palsu).
- **Test server butuh DB sendiri:** `DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340` (vitest memakai basis `<db>_test` → `hanoman340_test`), di-`migrate deploy` lebih dulu. Sibling worktree lain memakai `hanoman_test` dan akan men-truncate-nya di tengah run.
- **Commit per task** dengan prefix `feat(spec-340):` / `test(spec-340):` / `docs(spec-340):`.

---

## File Structure

| Berkas | Tanggung jawab | Task |
|---|---|---|
| `shared/src/entities.ts` (modify) | `zBriefPayload` menerima `fromAudit?` (kalau tidak, zod **menghapus** field itu di boundary) | 1 |
| `shared/src/dto.ts` (modify) | Kontrak `zAuditEscalation` + view endpoint + `zTerminalSession` varian prd | 1, 6 |
| `shared/test/escalation.test.ts` (create) | Test kontrak zod | 1 |
| `server/src/services/audit-escalation.ts` (create) | `parseEscalation` (murni) + `readEscalation` (freshest-wins) | 2 |
| `server/test/audit-escalation.test.ts` (create) | Unit parser + reader | 2 |
| `server/src/routes/specs.ts` (modify) | `GET /specs/:id/escalation` | 3 |
| `server/test/escalation.route.test.ts` (create) | Route test | 3 |
| `runner/src/prompt.ts` (modify) | Kontrak blok json di prompt audit & cross-audit; kontinuitas brief; `startPrdPrompt` ber-audit | 4, 5, 6 |
| `runner/src/types.ts` (modify) | Tipe `AuditDoc` untuk prompt PRD | 6 |
| `runner/test/escalation-prompt.test.ts` (create) | Test prompt audit/cross-audit/brief/prd | 4, 5, 6 |
| `server/src/routes/terminal.ts` (modify) | `flow:"prd"` menerima `branchFrom`/`fromAudit` | 6 |
| `server/test/prd-from-audit.route.test.ts` (create) | Route test sesi PRD dari audit | 6 |
| `src/src/api/client.ts` (modify) | `getEscalation`, `startPrd(…, opts?)` | 7 |
| `src/src/screens/BacklogScreen.tsx` (modify) | Blok "Tindak lanjut" tiga tombol + sorotan rekomendasi | 8 |
| `src/test/audit-escalation.test.tsx` (create) | RTL SpecDetail | 8 |
| `src/src/screens/PrdScreen.tsx` (modify) | Ekspor `NewPrdModal` + dukung `prefill` | 9 |
| `src/src/App.tsx` (modify) | `promoteToBrief`, `promoteToPrd`, modal PRD | 9 |
| `src/test/audit-escalation-app.test.tsx` (create) | RTL alur App | 9 |
| `internal/docs/**` | Sudah diperbarui di fase Spec — verifikasi ulang di Task 10 | 10 |

---

### Task 1: Kontrak `AuditEscalation` di `@hanoman/shared`

**Files:**
- Modify: `shared/src/entities.ts:20-21` (`zBriefPayload`)
- Modify: `shared/src/dto.ts` (tambah blok baru setelah `zBreakdownDoc`, sekitar baris 176)
- Test: `shared/test/escalation.test.ts` (create)

**Interfaces:**
- Consumes: —
- Produces:
  - `zEscalationTarget: z.ZodEnum<["none","qa","brief","prd"]>` · `type EscalationTarget`
  - `zEscalationPrefill` → `{ title: string; context: string; outcome: string; constraints: string; severity: string; steps: string }` (semua `.default("")`)
  - `zAuditEscalation` → `{ target: EscalationTarget; reason: string; alternatives: EscalationTarget[]; prefill: EscalationPrefill }`
  - `type AuditEscalation`
  - `zAuditEscalationView` → `{ escalation: AuditEscalation | null; docPath: string | null; live: boolean }` · `type AuditEscalationView`
  - `zBriefPayload` kini menerima `fromAudit?: string`

- [ ] **Step 1: Tulis test yang gagal**

Buat `shared/test/escalation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zAuditEscalation, zBriefPayload } from "../src";

describe("zAuditEscalation (SPEC-340 · ADR-0076)", () => {
  it("menerima manifest lengkap", () => {
    const r = zAuditEscalation.safeParse({
      target: "prd", reason: "kebutuhan produk baru", alternatives: ["brief"],
      prefill: { title: "Kuota tenant", context: "c", outcome: "o" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.target).toBe("prd");
      expect(r.data.alternatives).toEqual(["brief"]);
      expect(r.data.prefill.constraints).toBe("");   // default terisi
      expect(r.data.prefill.severity).toBe("");
    }
  });
  it("mengisi default saat hanya target yang ada", () => {
    const r = zAuditEscalation.safeParse({ target: "none" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.reason).toBe("");
      expect(r.data.alternatives).toEqual([]);
      expect(r.data.prefill.title).toBe("");
    }
  });
  it("menolak target di luar katalog", () => {
    expect(zAuditEscalation.safeParse({ target: "epic" }).success).toBe(false);
  });
  it("menolak alternatives ber-target asing", () => {
    expect(zAuditEscalation.safeParse({ target: "qa", alternatives: ["epic"] }).success).toBe(false);
  });
});

describe("zBriefPayload menerima fromAudit (SPEC-340)", () => {
  it("mempertahankan fromAudit alih-alih membuangnya", () => {
    const r = zBriefPayload.safeParse({
      context: "c", outcome: "o", constraints: "", priority: "tinggi", fromAudit: "SPEC-300" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.fromAudit).toBe("SPEC-300");
  });
  it("tetap sah tanpa fromAudit", () => {
    const r = zBriefPayload.safeParse({ context: "c", outcome: "o", constraints: "", priority: "sedang" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.fromAudit).toBeUndefined();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism shared/test/escalation.test.ts`
Expected: FAIL — `zAuditEscalation` tak ter-ekspor (`SyntaxError`/`undefined`), dan test `fromAudit` gagal karena zod membuangnya.

- [ ] **Step 3: Tambah `fromAudit` ke `zBriefPayload`**

Di `shared/src/entities.ts`, ganti:

```ts
export const zBriefPayload = z.object({
  context: z.string(), outcome: z.string(), constraints: z.string(), priority: zPriority });
```

menjadi:

```ts
export const zBriefPayload = z.object({
  context: z.string(), outcome: z.string(), constraints: z.string(), priority: zPriority,
  // SPEC-340 · ADR-0076 · brief yang DINAIKKAN dari audit. Tanpa field ini zod membuangnya di
  // boundary (objek non-strict) dan runner tak pernah melihat asal-usulnya. Cermin zQaPayload.
  fromAudit: z.string().optional() });
```

- [ ] **Step 4: Tambah kontrak escalation di `shared/src/dto.ts`**

Sisipkan tepat setelah blok `zBreakdownDoc`/`zBatchCreateSpec` (sekitar baris 184):

```ts
// SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit. Ditulis sesi audit sebagai SATU blok
// ```json di dokumen audit SoT (pola manifest breakdown, ADR-0069) lalu dibaca server sebagai
// NILAI TURUNAN (ADR-0018) — bukan kolom DB. Default longgar: manifest ditulis agen, jadi hanya
// `target` yang wajib; sisanya boleh absen.
export const zEscalationTarget = z.enum(["none", "qa", "brief", "prd"]);
export type EscalationTarget = z.infer<typeof zEscalationTarget>;

export const zEscalationPrefill = z.object({
  title: z.string().default(""),
  context: z.string().default(""),
  outcome: z.string().default(""),
  constraints: z.string().default(""),
  severity: z.string().default(""),   // hanya dipakai target qa
  steps: z.string().default(""),      // hanya dipakai target qa
});
export type EscalationPrefill = z.infer<typeof zEscalationPrefill>;

export const zAuditEscalation = z.object({
  target: zEscalationTarget,
  reason: z.string().default(""),
  alternatives: z.array(zEscalationTarget).default([]),
  prefill: zEscalationPrefill.default({}),
});
export type AuditEscalation = z.infer<typeof zAuditEscalation>;

// Respons GET /specs/:id/escalation. escalation null = belum ada rekomendasi terbaca
// (audit pra-SPEC-340, sesi masih berjalan, atau blok json rusak) — keadaan normal, bukan error.
export const zAuditEscalationView = z.object({
  escalation: zAuditEscalation.nullable(),
  docPath: z.string().nullable(),
  live: z.boolean(),
});
export type AuditEscalationView = z.infer<typeof zAuditEscalationView>;
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism shared/test/escalation.test.ts`
Expected: PASS (6 test).

Lalu pastikan tak ada regresi kontrak lama:
Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism shared`
Expected: seluruh test shared PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/entities.ts shared/src/dto.ts shared/test/escalation.test.ts
git commit -m "feat(spec-340): kontrak AuditEscalation + fromAudit di brief payload"
```

---

### Task 2: Service `audit-escalation` — parser defensif + pembaca freshest-wins

**Files:**
- Create: `server/src/services/audit-escalation.ts`
- Test: `server/test/audit-escalation.test.ts` (create)

**Interfaces:**
- Consumes: `zAuditEscalation`, `AuditEscalation` (Task 1); `listSpecDocs` dan `resolveDir` dari `server/src/services/spec-docs.ts`; `readDocFile(dir, relPath): string | null` dari `server/src/services/scan.ts`; `listSessions()` dari `server/src/services/pty.ts`.
- Produces:
  - `parseEscalation(md: string): AuditEscalation | null` — murni
  - `readEscalation(specId: string, sessions?: ReturnType<typeof listSessions>): Promise<{ escalation: AuditEscalation | null; docPath: string | null; live: boolean }>`
  - `readAuditDoc(specId: string, sessions?): Promise<{ path: string; content: string } | null>` — dipakai Task 6 untuk menyematkan isi audit ke prompt PRD

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/audit-escalation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseEscalation, readEscalation, readAuditDoc } from "../src/services/audit-escalation";
import { resetDb, makeProject, makeTempRepo, makeSpec } from "./factory";

const BLOCK = `# Audit SPEC-300

Temuan: kebutuhan produk baru.

## Rekomendasi eskalasi

\`\`\`json
{ "escalation": { "target": "prd", "reason": "lintas modul",
  "alternatives": ["brief"], "prefill": { "title": "Kuota tenant", "context": "c", "outcome": "o" } } }
\`\`\`
`;

describe("parseEscalation (SPEC-340 · murni)", () => {
  it("membaca blok json kanonik", () => {
    const e = parseEscalation(BLOCK);
    expect(e?.target).toBe("prd");
    expect(e?.reason).toBe("lintas modul");
    expect(e?.alternatives).toEqual(["brief"]);
    expect(e?.prefill.title).toBe("Kuota tenant");
  });
  it("null saat tak ada blok json", () => {
    expect(parseEscalation("# Audit\n\nprosa saja.")).toBeNull();
  });
  it("null saat json rusak", () => {
    expect(parseEscalation("```json\n{ \"escalation\": { target: prd }\n```")).toBeNull();
  });
  it("null saat target tak dikenal", () => {
    expect(parseEscalation('```json\n{ "escalation": { "target": "epic" } }\n```')).toBeNull();
  });
  it("null saat blok json tanpa kunci escalation", () => {
    expect(parseEscalation('```json\n{ "items": [] }\n```')).toBeNull();
  });
  it("memakai blok json PERTAMA", () => {
    const md = '```json\n{ "escalation": { "target": "qa" } }\n```\n\nlalu\n\n'
      + '```json\n{ "escalation": { "target": "prd" } }\n```';
    expect(parseEscalation(md)?.target).toBe("qa");
  });
  it("mengisi default untuk field yang absen", () => {
    const e = parseEscalation('```json\n{ "escalation": { "target": "none" } }\n```');
    expect(e?.reason).toBe("");
    expect(e?.alternatives).toEqual([]);
    expect(e?.prefill.outcome).toBe("");
  });
});

describe("readEscalation (SPEC-340 · freshest-wins)", () => {
  beforeEach(async () => { await resetDb(); });

  it("membaca dokumen audit dari repoDir", async () => {
    const dir = makeTempRepo({ "internal/docs/research/audit-spec-300-kuota.md": BLOCK });
    await makeProject({ id: "p1", repoDir: dir });
    await makeSpec({ id: "SPEC-300", projectId: "p1", source: "audit" });
    const r = await readEscalation("SPEC-300", []);
    expect(r.live).toBe(false);
    expect(r.docPath).toBe("internal/docs/research/audit-spec-300-kuota.md");
    expect(r.escalation?.target).toBe("prd");
  });

  it("escalation null (bukan lempar) saat dokumen audit tak ada", async () => {
    const dir = makeTempRepo({ "internal/docs/README.md": "# index" });
    await makeProject({ id: "p1", repoDir: dir });
    await makeSpec({ id: "SPEC-301", projectId: "p1", source: "audit" });
    const r = await readEscalation("SPEC-301", []);
    expect(r.escalation).toBeNull();
    expect(r.docPath).toBeNull();
  });

  it("cwd sesi HIDUP menang atas repoDir (live:true)", async () => {
    const repo = makeTempRepo({
      "internal/docs/research/audit-spec-302-x.md": '```json\n{ "escalation": { "target": "qa" } }\n```' });
    const live = makeTempRepo({
      "internal/docs/research/audit-spec-302-x.md": '```json\n{ "escalation": { "target": "prd" } }\n```' });
    await makeProject({ id: "p1", repoDir: repo });
    await makeSpec({ id: "SPEC-302", projectId: "p1", source: "audit" });
    const sessions = [{ id: "spec-302", projectId: "p1", specId: "SPEC-302", cwd: live, exited: false }] as any;
    const r = await readEscalation("SPEC-302", sessions);
    expect(r.live).toBe(true);
    expect(r.escalation?.target).toBe("prd");
  });
});

describe("readAuditDoc (SPEC-340 · penyematan ke prompt PRD)", () => {
  beforeEach(async () => { await resetDb(); });
  it("mengembalikan path + isi dokumen audit", async () => {
    const dir = makeTempRepo({ "internal/docs/research/audit-spec-303-y.md": BLOCK });
    await makeProject({ id: "p1", repoDir: dir });
    await makeSpec({ id: "SPEC-303", projectId: "p1", source: "audit" });
    const d = await readAuditDoc("SPEC-303", []);
    expect(d?.path).toContain("audit-spec-303-y.md");
    expect(d?.content).toContain("Temuan: kebutuhan produk baru.");
  });
  it("null saat spec tak punya dokumen audit", async () => {
    const dir = makeTempRepo({ "internal/docs/README.md": "# index" });
    await makeProject({ id: "p1", repoDir: dir });
    await makeSpec({ id: "SPEC-304", projectId: "p1", source: "audit" });
    expect(await readAuditDoc("SPEC-304", [])).toBeNull();
  });
});
```

> Catatan implementasi: `server/test/factory.ts` sudah menyediakan `resetDb`, `makeProject`,
> `makeTempRepo`. Bila `makeSpec` **belum** ada di factory, gunakan `prisma.spec.create` langsung
> dengan field wajib model `Spec` (`id, projectId, title, source, stage, priority, author,
> objective`) alih-alih menambah helper baru — periksa isi `factory.ts` lebih dulu.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 \
  env -u NODE_ENV pnpm vitest run --no-file-parallelism server/test/audit-escalation.test.ts
```
Expected: FAIL — `Cannot find module '../src/services/audit-escalation'`.

- [ ] **Step 3: Implementasi service**

Buat `server/src/services/audit-escalation.ts`:

```ts
import { zAuditEscalation, type AuditEscalation } from "@hanoman/shared";
import { listSpecDocs, resolveDir } from "./spec-docs";
import { readDocFile } from "./scan";
import { listSessions } from "./pty";

// SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit hidup di DOKUMEN audit sebagai satu blok
// ```json kanonik (pola manifest breakdown, ADR-0069) — bukan kolom DB (ADR-0018/0011).
// Defensif seperti parseBreakdown: manifest ditulis agen, jadi apa pun yang tak lolos zod → null.
export function parseEscalation(md: string): AuditEscalation | null {
  const m = md.match(/```json\s*([\s\S]*?)```/);   // blok PERTAMA, sama seperti parseBreakdown
  if (!m) return null;
  let data: unknown;
  try { data = JSON.parse(m[1]!); } catch { return null; }
  const raw = data && typeof data === "object" ? (data as { escalation?: unknown }).escalation : undefined;
  if (!raw) return null;
  const p = zAuditEscalation.safeParse(raw);
  return p.success ? p.data : null;
}

// Dokumen audit milik sebuah spec, dibaca freshest-wins: cwd sesi HIDUP > repoDir (resolveDir,
// SPEC-170). listSpecDocs sudah mengklasifikasi `research/audit-*` / `*-audit.md` sbg kind "audit"
// (SPEC-237); ambil yang pertama — urutannya sudah dipimpin kind audit.
async function findAuditDoc(
  specId: string, sessions: ReturnType<typeof listSessions>,
): Promise<{ dir: string; path: string; live: boolean } | null> {
  const dir = await resolveDir(specId, sessions);
  if (!dir) return null;
  const live = sessions.some((s) => s.specId === specId && !s.exited && s.cwd);
  const doc = (await listSpecDocs(specId, sessions)).find((d) => d.kind === "audit");
  return doc ? { dir, path: doc.path, live } : null;
}

export async function readAuditDoc(
  specId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ path: string; content: string } | null> {
  const found = await findAuditDoc(specId, sessions);
  if (!found) return null;
  const content = readDocFile(found.dir, found.path);
  return content === null ? null : { path: found.path, content };
}

export async function readEscalation(
  specId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ escalation: AuditEscalation | null; docPath: string | null; live: boolean }> {
  const found = await findAuditDoc(specId, sessions);
  if (!found) {
    // Tak ada dokumen audit sama sekali: tetap laporkan `live` apa adanya supaya UI bisa
    // membedakan "sesi sedang menulis" dari "audit lama tanpa rekomendasi".
    const live = sessions.some((s) => s.specId === specId && !s.exited && s.cwd);
    return { escalation: null, docPath: null, live };
  }
  const content = readDocFile(found.dir, found.path);
  return {
    escalation: content === null ? null : parseEscalation(content),
    docPath: found.path,
    live: found.live,
  };
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 \
  env -u NODE_ENV pnpm vitest run --no-file-parallelism server/test/audit-escalation.test.ts
```
Expected: PASS (12 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/audit-escalation.ts server/test/audit-escalation.test.ts
git commit -m "feat(spec-340): parser + pembaca rekomendasi eskalasi audit (freshest-wins)"
```

---

### Task 3: Endpoint `GET /specs/:id/escalation`

**Files:**
- Modify: `server/src/routes/specs.ts` (import di kepala berkas; route disisipkan tepat setelah `app.get("/specs/:id/docs/*", …)`, sekitar baris 202)
- Test: `server/test/escalation.route.test.ts` (create)

**Interfaces:**
- Consumes: `readEscalation` (Task 2)
- Produces: `GET /api/specs/:id/escalation` → `{ escalation, docPath, live }` (bentuk `AuditEscalationView`); 404 hanya bila spec tak ada di DB.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/escalation.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeTempRepo } from "./factory";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });

const spec = (id: string, extra: Record<string, unknown> = {}) => prisma.spec.create({
  data: { id, projectId: "p1", title: "audit " + id, source: "audit", stage: "done",
    priority: "sedang", author: "Audit · tester", objective: "menelusuri", ...extra },
});

describe("GET /specs/:id/escalation (SPEC-340 · ADR-0076)", () => {
  beforeEach(async () => { await resetDb(); });

  it("404 bila spec tak ada", async () => {
    await makeProject({ id: "p1", repoDir: makeTempRepo({ "internal/docs/README.md": "#" }) });
    const res = await app.inject({ url: "/api/specs/SPEC-999/escalation" });
    expect(res.statusCode).toBe(404);
  });

  it("200 + escalation null bila dokumen audit tak ada", async () => {
    await makeProject({ id: "p1", repoDir: makeTempRepo({ "internal/docs/README.md": "#" }) });
    await spec("SPEC-310");
    const res = await app.inject({ url: "/api/specs/SPEC-310/escalation" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ escalation: null, docPath: null, live: false });
  });

  it("200 + escalation null bila blok json rusak (bukan 5xx)", async () => {
    await makeProject({ id: "p1", repoDir: makeTempRepo({
      "internal/docs/research/audit-spec-311-x.md": "```json\n{ rusak\n```" }) });
    await spec("SPEC-311");
    const res = await app.inject({ url: "/api/specs/SPEC-311/escalation" });
    expect(res.statusCode).toBe(200);
    expect(res.json().escalation).toBeNull();
    expect(res.json().docPath).toContain("audit-spec-311-x.md");
  });

  it("200 + rekomendasi dari dokumen audit", async () => {
    await makeProject({ id: "p1", repoDir: makeTempRepo({
      "internal/docs/research/audit-spec-312-y.md":
        '# Audit\n\n```json\n{ "escalation": { "target": "brief", "reason": "fitur kecil",'
        + ' "alternatives": ["prd"], "prefill": { "title": "Ekspor CSV", "outcome": "bisa unduh" } } }\n```' }) });
    await spec("SPEC-312");
    const res = await app.inject({ url: "/api/specs/SPEC-312/escalation" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.escalation.target).toBe("brief");
    expect(body.escalation.reason).toBe("fitur kecil");
    expect(body.escalation.alternatives).toEqual(["prd"]);
    expect(body.escalation.prefill.title).toBe("Ekspor CSV");
    expect(body.live).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 \
  env -u NODE_ENV pnpm vitest run --no-file-parallelism server/test/escalation.route.test.ts
```
Expected: FAIL — semua non-404 balas 404 (route belum ada).

- [ ] **Step 3: Tambah route**

Di `server/src/routes/specs.ts`, tambahkan import di dekat import service lain (setelah baris `import { listSpecDocs, resolveDir } from "../services/spec-docs";`):

```ts
import { readEscalation } from "../services/audit-escalation";
```

Lalu sisipkan route tepat setelah handler `app.get("/specs/:id/docs/*", …)`:

```ts
  // SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit — NILAI TURUNAN dari blok ```json di
  // dokumen audit (freshest-wins), bukan kolom DB. Dokumen/blok tak ada atau rusak → 200 dengan
  // escalation:null; itu keadaan normal (audit pra-SPEC-340 / sesi masih menulis), bukan error.
  // 404 hanya bila spec-nya sendiri tak ada.
  app.get("/specs/:id/escalation", async (req, reply) => {
    const { id } = req.params as { id: string };
    const exists = await prisma.spec.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: "not found" });
    return readEscalation(id);
  });
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 \
  env -u NODE_ENV pnpm vitest run --no-file-parallelism server/test/escalation.route.test.ts
```
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/specs.ts server/test/escalation.route.test.ts
git commit -m "feat(spec-340): GET /specs/:id/escalation menyajikan rekomendasi audit"
```

---

### Task 4: Prompt audit & cross-audit menulis blok `json` rekomendasi

**Files:**
- Modify: `runner/src/prompt.ts:112-122` (`auditOnlyInstruction`) dan `runner/src/prompt.ts:383-388` (blok Laporan di `startCrossAuditPrompt`)
- Test: `runner/test/escalation-prompt.test.ts` (create)

**Interfaces:**
- Consumes: —
- Produces: konstanta modul `ESCALATION_CONTRACT: string` di `runner/src/prompt.ts` (di-`export` supaya bisa diuji dan dipakai kedua prompt).

- [ ] **Step 1: Tulis test yang gagal**

Buat `runner/test/escalation-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { startPrompt, startCrossAuditPrompt, ESCALATION_CONTRACT } from "../src/prompt";

const spec = {
  id: "SPEC-300", title: "Kenapa antrean menumpuk", source: "audit",
  priority: "tinggi", objective: "telusuri", payload: null,
} as any;

describe("kontrak escalation di prompt audit (SPEC-340 · ADR-0076)", () => {
  it("menyebut keempat target", () => {
    for (const t of ["none", "qa", "brief", "prd"]) expect(ESCALATION_CONTRACT).toContain(`"${t}"`);
  });
  it("mewajibkan blok json berkunci escalation", () => {
    expect(ESCALATION_CONTRACT).toContain("```json");
    expect(ESCALATION_CONTRACT).toContain("escalation");
    expect(ESCALATION_CONTRACT).toContain("prefill");
  });
  it("prompt flow audit memuat kontrak itu", () => {
    const p = startPrompt("audit" as any, spec, "hanoman/spec-300");
    expect(p).toContain(ESCALATION_CONTRACT);
  });
  it("prompt flow feature TIDAK memuat kontrak itu", () => {
    const p = startPrompt("feature" as any, { ...spec, source: "brief" }, "hanoman/spec-300");
    expect(p).not.toContain("```json");
  });
  it("prompt cross-audit berdokumen memuat kontrak itu", () => {
    const p = startCrossAuditPrompt({
      mode: "spec", spec: { ...spec, source: "cross-audit" }, branchTo: "hanoman/spec-300",
      main: { id: "p1", name: "P1", desc: "", stack: "" }, neighbors: [],
      worktree: "/tmp/wt", apiUrl: "http://127.0.0.1:8787", key: "hnm_xa_x",
    } as any);
    expect(p).toContain(ESCALATION_CONTRACT);
  });
});
```

> Sebelum menulis test cross-audit, **baca tanda tangan `startCrossAuditPrompt` di
> `runner/src/prompt.ts` dan contoh pemakaiannya di `runner/test/cross-audit-prompt.test.ts`**,
> lalu sesuaikan objek `ctx` di atas dengan bentuk `CrossAuditCtx` yang sebenarnya — jangan
> menebak field.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner/test/escalation-prompt.test.ts`
Expected: FAIL — `ESCALATION_CONTRACT` tak ter-ekspor.

- [ ] **Step 3: Tambah kontrak + pasang di kedua prompt**

Di `runner/src/prompt.ts`, tepat sebelum `auditOnlyInstruction`, tambahkan:

```ts
// SPEC-340 · ADR-0076 — rekomendasi tindak lanjut audit harus TERBACA MESIN, bukan prosa. Sesi
// audit menulis satu blok ```json kanonik di dokumen auditnya; server mem-parse-nya
// (services/audit-escalation.ts) dan UI menyorot target yang direkomendasikan. Pola manifest
// breakdown (ADR-0069): prosa untuk manusia + satu blok json untuk mesin, di dokumen yang sama.
export const ESCALATION_CONTRACT = [
  "REKOMENDASI ESKALASI (wajib, terbaca mesin). Di bagian akhir dokumen audit, tulis bagian",
  "`## Rekomendasi eskalasi` berisi penjelasan singkat untuk manusia, LALU tepat SATU blok ```json",
  "berbentuk persis seperti ini (satu-satunya blok json di dokumen itu):",
  "",
  "```json",
  '{ "escalation": { "target": "none|qa|brief|prd", "reason": "<alasan singkat>",',
  '  "alternatives": ["<target lain yang masuk akal>"],',
  '  "prefill": { "title": "", "context": "", "outcome": "", "constraints": "", "severity": "", "steps": "" } } }',
  "```",
  "",
  "Pilih `target` dari hasil auditmu, bukan default:",
  '- "qa" — bug / regresi / perilaku salah yang perlu diperbaiki. Isi `prefill.severity`',
  "  (critical|major|minor) dan `prefill.steps` (langkah reproduksi).",
  '- "brief" — kebutuhan/fitur yang bentuknya sudah jelas dan cakupannya satu backlog.',
  "  Isi `prefill.title`, `prefill.context`, `prefill.outcome`.",
  '- "prd" — kebutuhan produk yang besar, ambigu, atau lintas modul sehingga perlu dokumen PRD',
  "  lebih dulu. Isi `prefill.title`, `prefill.context`, `prefill.outcome`.",
  '- "none" — pertanyaannya sudah terjawab; tak perlu perbaikan maupun fitur baru.',
  "",
  "`alternatives` boleh array kosong. Jangan menulis blok json lain di dokumen itu.",
].join("\n");
```

Lalu ganti `auditOnlyInstruction` menjadi:

```ts
const auditOnlyInstruction = (flow: Flow): string =>
  flow !== "audit" ? "" :
    "Ini audit-only: investigasi SAJA, JANGAN menulis perbaikan kode apa pun. Fase Audit "
    + "(systematic-debugging): telusuri akar masalah / log / jawaban dan nilai apakah issue "
    + "terdefinisi dengan baik. Fase Laporan: tulis DOKUMEN AUDIT ke Source of Truth "
    + "`internal/docs/research/audit-<spec-id>-<slug>.md` (ikuti konvensi audit yang ada), tautkan "
    + "di `internal/docs/README.md`, memuat: keluhan/pertanyaan, temuan (dengan bukti/log), apakah "
    + "issue terdefinisi baik, dan rekomendasi tindak lanjut. Commit dokumen itu lalu push. "
    + "Tak ada kode fitur.\n\n" + ESCALATION_CONTRACT;
```

Dan di `startCrossAuditPrompt`, ganti kalimat Laporan yang berakhir `"naikkan jadi Finding QA di project <id>" (sebut project mana yang harus diperbaiki). JANGAN menulis perbaikan kode.` menjadi:

```ts
    `Fase Audit: telusuri akar masalah lintas project (log + kode kedua sisi). Fase Laporan: tulis DOKUMEN `
      + `AUDIT ke Source of Truth project utama \`internal/docs/research/audit-${spec.id.toLowerCase()}-${slug}.md\` `
      + `(ikuti konvensi audit yang ada), tautkan di \`internal/docs/README.md\`, memuat: keluhan/pertanyaan, `
      + `peta integrasi yang diaudit, temuan dengan BUKTI dari tiap project (kutipan kode + baris timeline `
      + `beserta waktunya), apakah issue terdefinisi baik, dan rekomendasi tindak lanjut — sebut project mana `
      + `yang harus ditindaklanjuti. JANGAN menulis perbaikan kode.`,
    ESCALATION_CONTRACT,
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner`
Expected: PASS — termasuk `prompt.test.ts` & `cross-audit-prompt.test.ts` lama. Bila ada test lama yang mengasesi frasa "dinaikkan jadi Finding QA", **perbarui asersinya** ke frasa baru (perilaku memang berubah secara sengaja) — jangan mengembalikan teks lama.

- [ ] **Step 5: Commit**

```bash
git add runner/src/prompt.ts runner/test/escalation-prompt.test.ts runner/test/prompt.test.ts runner/test/cross-audit-prompt.test.ts
git commit -m "feat(spec-340): prompt audit & cross-audit menulis blok json rekomendasi eskalasi"
```

---

### Task 5: Kontinuitas brief lanjutan audit (tanpa fase `skipped`)

**Files:**
- Modify: `runner/src/prompt.ts:124-137` (`auditContinuationInstruction`)
- Test: `runner/test/escalation-prompt.test.ts` (tambah `describe` baru)

**Interfaces:**
- Consumes: `ESCALATION_CONTRACT` tidak dipakai di sini; hanya `SpecBrief.payload.fromAudit`.
- Produces: `auditContinuationInstruction(flow, spec)` kini menyala untuk `flow === "qa"` **dan** `flow === "feature"`, dengan teks berbeda.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `runner/test/escalation-prompt.test.ts`:

```ts
describe("kontinuitas brief lanjutan audit (SPEC-340 · ADR-0076)", () => {
  const briefSpec = {
    id: "SPEC-320", title: "Ekspor CSV", source: "brief", priority: "sedang",
    objective: "bisa unduh", payload: { context: "c", outcome: "o", constraints: "", priority: "sedang", fromAudit: "SPEC-300" },
  } as any;

  it("feature + fromAudit menyebut dokumen auditnya", () => {
    const p = startPrompt("feature" as any, briefSpec, "hanoman/spec-320");
    expect(p).toContain("SPEC-300");
    expect(p).toContain("audit-spec-300");
  });
  it("feature + fromAudit TIDAK menyuruh menandai fase skipped", () => {
    const p = startPrompt("feature" as any, briefSpec, "hanoman/spec-320");
    expect(p).not.toContain("skipped");
  });
  it("feature TANPA fromAudit tak menyebut audit sama sekali", () => {
    const p = startPrompt("feature" as any, { ...briefSpec, payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } }, "hanoman/spec-320");
    expect(p).not.toContain("audit-spec-");
  });
  it("qa + fromAudit tetap menyuruh menandai Audit skipped (ADR-0059 utuh)", () => {
    const qaSpec = { ...briefSpec, source: "qa",
      payload: { severity: "major", steps: "s", expected: "e", actual: "a", env: "", fromAudit: "SPEC-300" } };
    const p = startPrompt("qa" as any, qaSpec, "hanoman/spec-320");
    expect(p).toContain("Audit skipped");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner/test/escalation-prompt.test.ts`
Expected: FAIL pada dua test pertama — `feature` belum pernah memuat klausa kontinuitas.

- [ ] **Step 3: Lebarkan `auditContinuationInstruction`**

Ganti fungsi itu di `runner/src/prompt.ts` menjadi:

```ts
// SPEC-244 · ADR-0059 — qa yang DINAIKKAN dari audit (payload.fromAudit) berjalan di branch audit,
// jadi dokumen audit sudah ada di worktree. Lewati fase Audit (jangan investigasi ulang), baca
// dokumen itu, tandai `Audit skipped`, lalu keputusan pasca-Audit ADR-0040.
// SPEC-340 · ADR-0076 — brief pun bisa dinaikkan dari audit. Bedanya SADAR: dokumen audit memuat
// TEMUAN, bukan bentuk solusi, jadi tak ada fase yang dilewati — Brainstorm tetap berjalan, hanya
// diberi bahan awal supaya tak menginvestigasi ulang dari nol.
const auditContinuationInstruction = (flow: Flow, spec: SpecBrief): string => {
  if (flow !== "qa" && flow !== "feature") return "";
  const fromAudit = spec.payload && typeof spec.payload === "object"
    ? (spec.payload as { fromAudit?: unknown }).fromAudit : undefined;
  if (typeof fromAudit !== "string" || !fromAudit) return "";
  const doc = `internal/docs/research/audit-${fromAudit.toLowerCase()}-*.md`;
  if (flow === "feature")
    return `Backlog brief ini LANJUTAN dari audit ${fromAudit}. Worktree ini lahir dari branch audit itu, `
      + `jadi dokumen audit sudah ada di ${doc}. BACA dokumen itu lebih dulu dan pakai sebagai bahan `
      + `fase Brainstorm & Objective — temuannya sudah terbukti, jangan menginvestigasi ulang dari nol. `
      + `Semua fase tetap dijalankan: dokumen audit memuat TEMUAN, bukan bentuk solusi, jadi perancangan `
      + `fitur tetap pekerjaanmu.`;
  return `Backlog qa ini LANJUTAN dari audit ${fromAudit}. Worktree ini lahir dari branch audit itu, `
    + `jadi dokumen audit sudah ada di ${doc}. `
    + "JANGAN mengulang investigasi fase Audit dari nol — baca dokumen audit itu sebagai temuan, "
    + "tandai fase Audit dilewati (`echo \"Audit skipped\" >> \"$HANOMAN_PHASE_FILE\"`), lalu ambil "
    + "keputusan pasca-Audit: perbaikan jelas & kecil → langsung Execute (tandai `Spec skipped` dan "
    + "`Plan skipped` bila sesuai); selain itu Spec → Plan → Execute penuh.";
};
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner`
Expected: PASS seluruh paket runner.

- [ ] **Step 5: Commit**

```bash
git add runner/src/prompt.ts runner/test/escalation-prompt.test.ts
git commit -m "feat(spec-340): klausa kontinuitas brief lanjutan audit (tanpa fase skipped)"
```

---

### Task 6: Sesi PRD dari audit — `branchFrom` + dokumen audit tersemat

**Files:**
- Modify: `runner/src/types.ts:25` (tambah tipe `AuditDoc`)
- Modify: `runner/src/prompt.ts:217-237` (`startPrdPrompt`)
- Modify: `shared/src/dto.ts:197` (varian `flow:"prd"` di `zTerminalSession`)
- Modify: `server/src/routes/terminal.ts:175-203` (cabang `flow === "prd"`)
- Test: `runner/test/escalation-prompt.test.ts` (tambah `describe`), `server/test/prd-from-audit.route.test.ts` (create)

**Interfaces:**
- Consumes: `readAuditDoc` (Task 2)
- Produces:
  - `runner/src/types.ts`: `export type AuditDoc = { id: string; path: string; content: string };`
  - `startPrdPrompt(project: ProjectBrief, brief: PrdBrief, branchTo: string, audit?: AuditDoc): string`
  - `zTerminalSession` varian prd: `{ project, flow:"prd", brief, branchFrom?: string, fromAudit?: string }`

- [ ] **Step 1: Tulis test prompt yang gagal**

Tambahkan ke `runner/test/escalation-prompt.test.ts`:

```ts
import { startPrdPrompt } from "../src/prompt";

describe("startPrdPrompt dengan dokumen audit tersemat (SPEC-340 · ADR-0076)", () => {
  const project = { id: "p1", name: "P1", desc: "", stack: "" };
  const brief = { title: "Kuota tenant", context: "c", outcome: "o" };

  it("menyematkan isi dokumen audit + id-nya", () => {
    const p = startPrdPrompt(project, brief, "prd/kuota-tenant",
      { id: "SPEC-300", path: "internal/docs/research/audit-spec-300-x.md", content: "TEMUAN PENTING" });
    expect(p).toContain("DOKUMEN AUDIT SPEC-300");
    expect(p).toContain("internal/docs/research/audit-spec-300-x.md");
    expect(p).toContain("TEMUAN PENTING");
  });
  it("tanpa audit, prompt persis seperti sebelumnya (tanpa blok audit)", () => {
    const p = startPrdPrompt(project, brief, "prd/kuota-tenant");
    expect(p).not.toContain("DOKUMEN AUDIT");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner/test/escalation-prompt.test.ts`
Expected: FAIL — argumen keempat diabaikan, "DOKUMEN AUDIT" tak muncul.

- [ ] **Step 3: Tambah tipe + parameter prompt**

Di `runner/src/types.ts`, tepat setelah `export type PrdBrief = …`:

```ts
// SPEC-340 · ADR-0076 · dokumen audit yang disematkan ke prompt sesi PRD hasil eskalasi audit.
// Isinya disematkan (bukan sekadar path) supaya prompt self-contained — cermin BreakdownPrd.
export type AuditDoc = { id: string; path: string; content: string };
```

Di `runner/src/prompt.ts`, ubah import tipe di baris 1 agar memuat `AuditDoc`, lalu ganti tanda tangan & isi `startPrdPrompt`:

```ts
export function startPrdPrompt(project: ProjectBrief, brief: PrdBrief, branchTo: string, audit?: AuditDoc): string {
  const slug = branchTo.slice(branchTo.lastIndexOf("/") + 1);
  // SPEC-340 · ADR-0076 · PRD hasil eskalasi audit: temuan audit adalah BAHAN brainstorm yang sudah
  // terbukti. Disematkan utuh (bukan path) agar prompt lepas dari status merge branch audit —
  // pola startBreakdownPrompt yang menyematkan isi PRD.
  const auditBlock = audit
    ? `=== DOKUMEN AUDIT ${audit.id} (${audit.path}) ===\nPRD ini adalah TINDAK LANJUT audit di bawah. `
      + `Pakai temuannya sebagai bahan brainstorm — jangan menginvestigasi ulang, dan jangan pula `
      + `menyalinnya mentah-mentah ke PRD.\n\n${audit.content}`
    : "";
  return [
    `hanoman prd. Kamu memandu PM/PO menyusun SATU dokumen PRD untuk project ini dari brief + `
      + `brainstorm. Keluaranmu HANYA dokumen PRD — JANGAN menulis kode fitur.`,
    phaseInstruction(PIPELINES.prd),
    `- Brainstorm: pandu PM secara interaktif. Ajukan SATU pertanyaan per giliran ke manusia di `
      + `terminal ini, tunggu jawabannya, perdalam brief sampai jelas (masalah, pengguna, scope, `
      + `metrik sukses). Jangan mengarang; topik yang PM belum jawab tandai sebagai open question.`,
    `- PRD: tulis dokumen ke \`docs/prd/${slug}.md\`. Awali dengan heading \`# <judul PRD>\`, lalu `
      + `bagian: Ringkasan · Masalah & konteks · Persona/pengguna · Goals & non-goals · Scope `
      + `(in/out) · User stories · Acceptance criteria (gaya EARS) · Metrik sukses · Open questions. `
      + `Isi lengkap dan spesifik dari hasil brainstorm, bukan kerangka kosong.`,
    skillInstruction(PIPELINES.prd),
    `Setelah PRD ditulis: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Bila remote `
      + `origin tidak ada, lewati push dan catat itu di terminal — jangan gagal diam-diam. Worktree `
      + `ini detached HEAD — memang disengaja. Manusia yang me-review lalu merge branch ${branchTo}.`,
    `Project ${project.id} · ${project.name}\nBrief — Judul: ${brief.title}\nKonteks: ${brief.context}\n`
      + `Outcome: ${brief.outcome}${brief.constraints ? `\nBatasan: ${brief.constraints}` : ""}`,
    auditBlock,
  ].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Jalankan test prompt, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism runner`
Expected: PASS.

- [ ] **Step 5: Tulis test route yang gagal**

Buat `server/test/prd-from-audit.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeTempRepo } from "./factory";
import { prisma } from "../src/db";

// Sesi PRD men-spawn agen sungguhan; jangan pernah biarkan test melakukannya.
vi.mock("../src/services/pty", async (orig) => {
  const real = await orig<typeof import("../src/services/pty")>();
  return { ...real, createSession: vi.fn((projectId: string, cwd: string, opts: any) => ({ id: opts.id, projectId, cwd, ...opts })),
    getSession: vi.fn(() => undefined), listSessions: vi.fn(() => []) };
});
vi.mock("@hanoman/runner", async (orig) => {
  const real = await orig<typeof import("@hanoman/runner")>();
  return { ...real, realGit: { ...real.realGit, addWorktree: vi.fn(() => "deadbeef") } };
});

const app = buildApp({ requireAuth: false });
const AUDIT_MD = "# Audit SPEC-300\n\nTEMUAN PENTING dari audit.";

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

async function seed() {
  const dir = makeTempRepo({ "internal/docs/research/audit-spec-300-x.md": AUDIT_MD });
  await makeProject({ id: "p1", repoDir: dir });
  await prisma.spec.create({ data: { id: "SPEC-300", projectId: "p1", title: "audit", source: "audit",
    stage: "done", priority: "sedang", author: "Audit · t", objective: "o" } });
  return dir;
}

describe("POST /terminal/sessions flow:prd dari audit (SPEC-340 · ADR-0076)", () => {
  it("memakai branchFrom untuk worktree & menyematkan dokumen audit ke prompt", async () => {
    await seed();
    const { realGit } = await import("@hanoman/runner");
    const { createSession } = await import("../src/services/pty");
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: {
      project: "p1", flow: "prd", brief: { title: "Kuota tenant", context: "c", outcome: "o" },
      branchFrom: "hanoman/spec-300", fromAudit: "SPEC-300" } });
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(realGit.addWorktree).mock.calls[0]?.[2]).toBe("hanoman/spec-300");
    const prompt = vi.mocked(createSession).mock.calls[0]?.[2]?.prompt as string;
    expect(prompt).toContain("DOKUMEN AUDIT SPEC-300");
    expect(prompt).toContain("TEMUAN PENTING dari audit.");
  });

  it("tanpa branchFrom/fromAudit: worktree dari HEAD & prompt polos (perilaku lama)", async () => {
    await seed();
    const { realGit } = await import("@hanoman/runner");
    const { createSession } = await import("../src/services/pty");
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: {
      project: "p1", flow: "prd", brief: { title: "PRD polos", context: "c", outcome: "o" } } });
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(realGit.addWorktree).mock.calls[0]?.[2]).toBe("HEAD");
    const prompt = vi.mocked(createSession).mock.calls[0]?.[2]?.prompt as string;
    expect(prompt).not.toContain("DOKUMEN AUDIT");
  });
});
```

> Sebelum menulis mock di atas, **buka `server/test/cross-audit-session.test.ts`** — ia sudah
> men-stub `pty`/`realGit` untuk route yang sama. Ikuti bentuk mock yang dipakai di sana persis
> alih-alih bentuk di atas bila berbeda; yang penting **tak ada `claude`/`codex` yang benar-benar
> di-spawn** dan `addWorktree` tak menyentuh git sungguhan.

- [ ] **Step 6: Jalankan test route, pastikan GAGAL**

Run:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 \
  env -u NODE_ENV pnpm vitest run --no-file-parallelism server/test/prd-from-audit.route.test.ts
```
Expected: FAIL — `branchFrom`/`fromAudit` ditolak/diabaikan zod, `addWorktree` dipanggil dengan `"HEAD"`.

- [ ] **Step 7: Lebarkan `zTerminalSession` + route prd**

Di `shared/src/dto.ts`, ganti varian prd:

```ts
  // SPEC-210 · sesi prd project-level di worktree sendiri; menghasilkan dokumen PRD dari brief.
  // SPEC-340 · ADR-0076 · eskalasi audit → PRD: branchFrom = branch audit (worktree lahir dari sana,
  // resolveCommit + fallback origin/<rev>), fromAudit = id spec audit (isi dokumennya disematkan ke
  // prompt). Keduanya opsional & independen; tanpa keduanya perilaku lama utuh.
  z.object({ project: z.string(), flow: z.literal("prd"), brief: zPrdBrief,
    branchFrom: z.string().min(1).optional(), fromAudit: z.string().min(1).optional() }),
```

Di `server/src/routes/terminal.ts`, tambahkan import:

```ts
import { readAuditDoc } from "../services/audit-escalation";
```

lalu di cabang `if (parsed.data.flow === "prd") { … }` ganti destrukturisasi & pembuatan worktree/sesi:

```ts
      const { brief, branchFrom, fromAudit } = parsed.data;
```

```ts
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        // SPEC-340 · ADR-0076 · PRD hasil eskalasi audit lahir dari branch auditnya.
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, branchFrom ?? "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      // SPEC-340 · isi dokumen audit (freshest-wins) disematkan ke prompt — prompt self-contained,
      // lepas dari status merge branch audit. Dokumen tak terbaca → PRD tetap jalan tanpa blok itu.
      const auditDoc = fromAudit ? await readAuditDoc(fromAudit) : null;
```

dan pada pembuatan sesi ganti argumen prompt:

```ts
        prompt: startPrdPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          brief, `prd/${slug}`,
          auditDoc ? { id: fromAudit!, path: auditDoc.path, content: auditDoc.content } : undefined),
```

- [ ] **Step 8: Jalankan test route, pastikan LULUS**

Run:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 \
  env -u NODE_ENV pnpm vitest run --no-file-parallelism server/test/prd-from-audit.route.test.ts
```
Expected: PASS (2 test).

- [ ] **Step 9: Commit**

```bash
git add runner/src/types.ts runner/src/prompt.ts shared/src/dto.ts server/src/routes/terminal.ts \
        runner/test/escalation-prompt.test.ts server/test/prd-from-audit.route.test.ts
git commit -m "feat(spec-340): sesi PRD dari audit (branchFrom + dokumen audit tersemat)"
```

---

### Task 7: Klien API — `getEscalation` + `startPrd` beropsi

**Files:**
- Modify: `src/src/api/client.ts:192-199` (blok PRD) dan blok `paths` di kepala berkas
- Test: `src/test/audit-escalation-client.test.ts` (create)

**Interfaces:**
- Consumes: `AuditEscalationView` (Task 1)
- Produces:
  - `api.getEscalation(specId: string): Promise<AuditEscalationView>`
  - `api.startPrd(project, brief, opts?: { branchFrom?: string; fromAudit?: string }): Promise<{ id: string }>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/audit-escalation-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../src/api/client";

const ok = (body: unknown) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
} as Response);

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => ok({}))); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("api.getEscalation (SPEC-340)", () => {
  it("memanggil GET /api/specs/:id/escalation", async () => {
    vi.mocked(fetch).mockReturnValue(ok({ escalation: { target: "prd" }, docPath: "d.md", live: false }));
    const r = await api.getEscalation("SPEC-300");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/api/specs/SPEC-300/escalation");
    expect(r.escalation?.target).toBe("prd");
  });
});

describe("api.startPrd meneruskan branchFrom/fromAudit (SPEC-340)", () => {
  it("menyertakan keduanya di body saat diberikan", async () => {
    vi.mocked(fetch).mockReturnValue(ok({ id: "prd-x" }));
    await api.startPrd("p1", { title: "T", context: "c", outcome: "o" },
      { branchFrom: "hanoman/spec-300", fromAudit: "SPEC-300" });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ project: "p1", flow: "prd", branchFrom: "hanoman/spec-300", fromAudit: "SPEC-300" });
  });
  it("tak mengirim key itu sama sekali saat opts kosong", async () => {
    vi.mocked(fetch).mockReturnValue(ok({ id: "prd-x" }));
    await api.startPrd("p1", { title: "T", context: "c", outcome: "o" });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty("branchFrom");
    expect(body).not.toHaveProperty("fromAudit");
  });
});
```

> **Sebelum menulis test ini, baca `src/test/api-client.test.ts`** dan tiru cara berkas itu men-stub
> `fetch` (bentuk `Response` mock & pembungkus `j()` bisa berbeda dari tebakan di atas). Sesuaikan.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism src/test/audit-escalation-client.test.ts`
Expected: FAIL — `api.getEscalation is not a function`.

- [ ] **Step 3: Tambah endpoint di klien**

Di `src/src/api/client.ts`, tambahkan path (di objek `paths`, dekat `spec(id)`):

```ts
  specEscalation: (id: string) => `${API}/specs/${encodeURIComponent(id)}/escalation`,
```

lalu ganti `startPrd` dan tambahkan `getEscalation` di blok PRD:

```ts
  // SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit (turunan dokumen audit).
  getEscalation: (id: string) => j<AuditEscalationView>(paths.specEscalation(id)),
  // SPEC-340 · opts = eskalasi audit → PRD: branchFrom (worktree dari branch audit) + fromAudit
  // (isi dokumen audit disematkan server ke prompt). Tanpa opts, body persis seperti sebelumnya.
  startPrd: (project: string, brief: { title: string; context: string; outcome: string; constraints?: string },
             opts?: { branchFrom?: string; fromAudit?: string }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({
      project, flow: "prd", brief,
      ...(opts?.branchFrom ? { branchFrom: opts.branchFrom } : {}),
      ...(opts?.fromAudit ? { fromAudit: opts.fromAudit } : {}) }) }),
```

Tambahkan `AuditEscalationView` ke import `@hanoman/shared` di kepala berkas.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism src/test/audit-escalation-client.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/test/audit-escalation-client.test.ts
git commit -m "feat(spec-340): klien API getEscalation + startPrd beropsi audit"
```

---

### Task 8: `SpecDetail` — tiga pintu eskalasi + sorotan rekomendasi

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx:91-100` (props `SpecDetail`), `:182-190` (blok promosi), `:527-540` (props `BacklogScreen` + penerusan)
- Test: `src/test/audit-escalation.test.tsx` (create)

**Interfaces:**
- Consumes: `api.getEscalation` (Task 7)
- Produces: props baru pada `SpecDetail` **dan** `BacklogScreen`:
  - `onPromoteToQa?: (s: Spec) => void` (sudah ada)
  - `onPromoteToBrief?: (s: Spec, e: AuditEscalation | null) => void`
  - `onPromoteToPrd?: (s: Spec, e: AuditEscalation | null) => void`
  - `onPromoteToQa` dipanggil dengan argumen kedua yang sama: ubah tanda tangannya jadi `(s: Spec, e: AuditEscalation | null) => void`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/audit-escalation.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";

const auditSpec = {
  id: "SPEC-300", projectId: "p1", title: "Kenapa antrean menumpuk", source: "audit",
  stage: "done", priority: "tinggi", author: "Audit · dena", objective: "telusuri",
  payload: { context: "c", outcome: "o", constraints: "", priority: "tinggi" },
  branchFrom: null, baseSha: null,
} as any;

const projects = [{ id: "p1", name: "P1" }] as any;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main"], remotes: [] } as any);
  vi.spyOn(api, "listSpecs").mockResolvedValue({ items: [auditSpec], total: 1 } as any);
});

async function openDetail(props: Record<string, unknown> = {}) {
  render(<BacklogScreen backlog={[auditSpec]} projects={projects} projectFilter="all"
    onProjectFilter={() => {}} initialDetailId="SPEC-300" {...props} />);
  await screen.findByText("Kenapa antrean menumpuk");
}

describe("SpecDetail eskalasi audit (SPEC-340 · ADR-0076)", () => {
  it("menampilkan tiga tombol eskalasi untuk source audit", async () => {
    vi.spyOn(api, "getEscalation").mockResolvedValue({ escalation: null, docPath: null, live: false } as any);
    await openDetail({ onPromoteToQa: () => {}, onPromoteToBrief: () => {}, onPromoteToPrd: () => {} });
    expect(await screen.findByRole("button", { name: /Jadikan Finding QA/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Jadikan Feature brief/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Jadikan PRD/i })).toBeTruthy();
  });

  it("menyorot target rekomendasi beserta alasannya", async () => {
    vi.spyOn(api, "getEscalation").mockResolvedValue({
      escalation: { target: "prd", reason: "lintas modul", alternatives: ["brief"],
        prefill: { title: "Kuota", context: "c", outcome: "o", constraints: "", severity: "", steps: "" } },
      docPath: "internal/docs/research/audit-spec-300-x.md", live: false } as any);
    await openDetail({ onPromoteToQa: () => {}, onPromoteToBrief: () => {}, onPromoteToPrd: () => {} });
    expect(await screen.findByText(/direkomendasikan hanoman/i)).toBeTruthy();
    expect(screen.getByText(/lintas modul/)).toBeTruthy();
  });

  it("target none merender catatan cukup jawaban, tombol tetap ada", async () => {
    vi.spyOn(api, "getEscalation").mockResolvedValue({
      escalation: { target: "none", reason: "sudah terjawab", alternatives: [],
        prefill: { title: "", context: "", outcome: "", constraints: "", severity: "", steps: "" } },
      docPath: "d.md", live: false } as any);
    await openDetail({ onPromoteToQa: () => {}, onPromoteToBrief: () => {}, onPromoteToPrd: () => {} });
    expect(await screen.findByText(/cukup jawaban/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Jadikan PRD/i })).toBeTruthy();
  });

  it("tombol brief memanggil onPromoteToBrief dengan rekomendasi", async () => {
    const esc = { target: "brief", reason: "fitur kecil", alternatives: [],
      prefill: { title: "Ekspor CSV", context: "c", outcome: "o", constraints: "", severity: "", steps: "" } };
    vi.spyOn(api, "getEscalation").mockResolvedValue({ escalation: esc, docPath: "d.md", live: false } as any);
    const onPromoteToBrief = vi.fn();
    await openDetail({ onPromoteToQa: () => {}, onPromoteToBrief, onPromoteToPrd: () => {} });
    await userEvent.click(await screen.findByRole("button", { name: /Jadikan Feature brief/i }));
    await waitFor(() => expect(onPromoteToBrief).toHaveBeenCalled());
    expect(onPromoteToBrief.mock.calls[0]?.[1]?.prefill?.title).toBe("Ekspor CSV");
  });

  it("cross-audit memperoleh tombol yang sama", async () => {
    vi.spyOn(api, "getEscalation").mockResolvedValue({ escalation: null, docPath: null, live: false } as any);
    const cross = { ...auditSpec, id: "SPEC-301", source: "cross-audit" };
    vi.spyOn(api, "listSpecs").mockResolvedValue({ items: [cross], total: 1 } as any);
    render(<BacklogScreen backlog={[cross]} projects={projects} projectFilter="all"
      onProjectFilter={() => {}} initialDetailId="SPEC-301"
      onPromoteToQa={() => {}} onPromoteToBrief={() => {}} onPromoteToPrd={() => {}} />);
    expect(await screen.findByRole("button", { name: /Jadikan PRD/i })).toBeTruthy();
  });

  it("source brief tak menampilkan tombol eskalasi apa pun", async () => {
    const brief = { ...auditSpec, id: "SPEC-302", source: "brief" };
    vi.spyOn(api, "listSpecs").mockResolvedValue({ items: [brief], total: 1 } as any);
    const getEsc = vi.spyOn(api, "getEscalation");
    render(<BacklogScreen backlog={[brief]} projects={projects} projectFilter="all"
      onProjectFilter={() => {}} initialDetailId="SPEC-302"
      onPromoteToQa={() => {}} onPromoteToBrief={() => {}} onPromoteToPrd={() => {}} />);
    await screen.findByText("Kenapa antrean menumpuk");
    expect(screen.queryByRole("button", { name: /Jadikan PRD/i })).toBeNull();
    expect(getEsc).not.toHaveBeenCalled();
  });
});
```

> Test frontend WAJIB dijalankan dengan `env -u NODE_ENV` — `NODE_ENV=production` di shell membuat
> React Testing Library gagal di `act()`.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism src/test/audit-escalation.test.tsx`
Expected: FAIL — hanya tombol "Jadikan Finding QA" yang ada.

- [ ] **Step 3: Implementasi blok "Tindak lanjut"**

Di `src/src/screens/BacklogScreen.tsx`:

(a) tambahkan import tipe di kepala berkas:

```ts
import type { AuditEscalation } from "@hanoman/shared";
```

(b) ganti props `SpecDetail`:

```tsx
function SpecDetail({ spec, onClose, onEditBranch, onRevertStage, onOpenReview, onStart, onIntegrate, onEditSpec, onPromoteToQa, onPromoteToBrief, onPromoteToPrd }:
  {
    spec: Spec | null; onClose: () => void; onEditBranch?: (s: Spec, b: string | null) => void;
    onRevertStage?: (s: Spec, target: string, confirmDelete?: boolean) => Promise<any>;
    onOpenReview?: (s: Spec) => void;
    onStart?: (s: Spec) => void;
    onIntegrate?: (s: Spec, op: "merge" | "rebase", target: string) => void;
    onEditSpec?: (s: Spec, patch: { title?: string; priority?: string; payload?: unknown }) => void;
    // SPEC-237 · naikkan audit → Finding QA. SPEC-340 · ADR-0076 · dua pintu lagi (brief & PRD);
    // argumen kedua = rekomendasi terbaca (null bila dokumen audit belum punya blok escalation).
    onPromoteToQa?: (s: Spec, e: AuditEscalation | null) => void;
    onPromoteToBrief?: (s: Spec, e: AuditEscalation | null) => void;
    onPromoteToPrd?: (s: Spec, e: AuditEscalation | null) => void;
  }) {
```

(c) tambahkan state + efek pemuatan, setelah state `editing`/`form` (tetap SEBELUM early-return `if (!spec)`):

```tsx
  // SPEC-340 · ADR-0076 · rekomendasi eskalasi (turunan dokumen audit). Hanya audit & cross-audit.
  const [esc, setEsc] = React.useState<AuditEscalation | null>(null);
  const escSpecId = spec && (spec.source === "audit" || spec.source === "cross-audit") ? spec.id : null;
  React.useEffect(() => {
    setEsc(null);
    if (!escSpecId) return;
    let alive = true;
    api.getEscalation?.(escSpecId)
      .then((r) => { if (alive) setEsc(r.escalation); })
      .catch(() => { if (alive) setEsc(null); });
    return () => { alive = false; };
  }, [escSpecId]);
```

(d) ganti blok promosi (`{spec.source === "audit" && onPromoteToQa && ( … )}`) dengan:

```tsx
        {/* SPEC-237 · audit tetap doc-of-record. SPEC-340 · ADR-0076 · tiga pintu eskalasi:
            target rekomendasi disorot (primary + badge), alternatif secondary, sisanya ghost —
            ketiganya selalu tersedia karena manusia yang terakhir memutuskan. */}
        {(spec.source === "audit" || spec.source === "cross-audit")
          && (onPromoteToQa || onPromoteToBrief || onPromoteToPrd) && (
          <div style={{ marginTop: 12 }}>
            <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Tindak lanjut</div>
            {esc && (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 8 }}>
                {esc.target === "none"
                  ? <>Audit menilai <strong>cukup jawaban</strong> — tak perlu perbaikan.</>
                  : <><Badge tone="brass" size="sm">direkomendasikan hanoman</Badge>{" "}
                      {ESC_LABEL[esc.target]}</>}
                {esc.reason ? <div style={{ marginTop: 4 }}>{esc.reason}</div> : null}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onPromoteToQa && (
                <Button size="sm" variant={escVariant(esc, "qa")} leftIcon="bug"
                  onClick={() => onPromoteToQa(spec, esc)}>Jadikan Finding QA</Button>
              )}
              {onPromoteToBrief && (
                <Button size="sm" variant={escVariant(esc, "brief")} leftIcon="lightbulb"
                  onClick={() => onPromoteToBrief(spec, esc)}>Jadikan Feature brief</Button>
              )}
              {onPromoteToPrd && (
                <Button size="sm" variant={escVariant(esc, "prd")} leftIcon="scroll-text"
                  onClick={() => onPromoteToPrd(spec, esc)}>Jadikan PRD</Button>
              )}
            </div>
          </div>
        )}
```

(e) tambahkan dua helper modul di dekat `DetailRow` (sebelum `SpecDetail`):

```tsx
// SPEC-340 · ADR-0076 · label & penekanan tombol menurut rekomendasi audit.
const ESC_LABEL: Record<string, string> = {
  qa: "Finding QA — ada yang perlu diperbaiki.",
  brief: "Feature brief — kebutuhan yang bentuknya sudah jelas.",
  prd: "PRD — kebutuhan produk yang perlu didefinisikan dulu.",
  none: "Cukup jawaban.",
};
function escVariant(e: AuditEscalation | null, target: string): "primary" | "secondary" {
  if (!e) return "secondary";
  if (e.target === target) return "primary";
  return "secondary";
}
```

(f) teruskan ketiga prop dari `BacklogScreen` ke `SpecDetail`: tambahkan `onPromoteToBrief`,
`onPromoteToPrd` di destrukturisasi props `BacklogScreen` (baris ~527) beserta tipenya (cermin
`onPromoteToQa` yang sudah ada), dan tambahkan keduanya di JSX `<SpecDetail … />`.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism src/test/audit-escalation.test.tsx src/test/backlog-board.test.tsx`
Expected: PASS. Bila `backlog-board.test.tsx` (test SPEC-237 lama) gagal karena tanda tangan
`onPromoteToQa` berubah, perbarui asersinya — pemanggilan kini membawa argumen kedua.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/test/audit-escalation.test.tsx src/test/backlog-board.test.tsx
git commit -m "feat(spec-340): tiga pintu eskalasi + sorotan rekomendasi di SpecDetail"
```

---

### Task 9: Wiring `App` — `promoteToBrief`, `promoteToPrd`, modal PRD ter-prefill

**Files:**
- Modify: `src/src/screens/PrdScreen.tsx:19-56` (`NewPrdModal` → di-`export` + terima `prefill` & `lockProject`)
- Modify: `src/src/App.tsx:766-810` (fungsi promote), `:493-495` (state), `:1060-1076` (render modal), `:936` (penerusan prop ke `BacklogScreen`)
- Test: `src/test/audit-escalation-app.test.tsx` (create)

**Interfaces:**
- Consumes: props `onPromoteToBrief`/`onPromoteToPrd` (Task 8); `api.startPrd(…, opts)` (Task 7)
- Produces: `NewPrdModal` ter-ekspor dengan props
  `{ projects, defaultProject, onClose, onCreate, prefill?: { title?: string; context?: string; outcome?: string; constraints?: string }, lockProject?: boolean }`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/audit-escalation-app.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewPrdModal } from "../src/screens/PrdScreen";

describe("NewPrdModal ter-prefill dari audit (SPEC-340 · ADR-0076)", () => {
  it("mengisi judul/konteks/outcome dari prefill", async () => {
    render(<NewPrdModal projects={[{ id: "p1", name: "P1" }] as any} defaultProject="p1"
      onClose={() => {}} onCreate={() => {}}
      prefill={{ title: "Kuota tenant", context: "dari audit", outcome: "kuota bisa diatur" }} />);
    expect((await screen.findByDisplayValue("Kuota tenant"))).toBeTruthy();
    expect(screen.getByDisplayValue("dari audit")).toBeTruthy();
    expect(screen.getByDisplayValue("kuota bisa diatur")).toBeTruthy();
  });

  it("meneruskan brief ter-prefill ke onCreate", async () => {
    const onCreate = vi.fn();
    render(<NewPrdModal projects={[{ id: "p1", name: "P1" }] as any} defaultProject="p1"
      onClose={() => {}} onCreate={onCreate} prefill={{ title: "Kuota tenant", context: "c", outcome: "o" }} />);
    await userEvent.click(screen.getByRole("button", { name: /brainstorm PRD/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]?.[0]).toBe("p1");
    expect(onCreate.mock.calls[0]?.[1]?.title).toBe("Kuota tenant");
  });
});
```

> **Baca `src/test/prd-screen.test.tsx` lebih dulu** untuk meniru cara berkas itu me-render layar
> PRD & memilih tombol; sesuaikan selektor bila label tombol berbeda dari tebakan di atas.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism src/test/audit-escalation-app.test.tsx`
Expected: FAIL — `NewPrdModal` tak ter-ekspor.

- [ ] **Step 3: Ekspor + prefill `NewPrdModal`**

Di `src/src/screens/PrdScreen.tsx`, ganti deklarasi & state awal:

```tsx
// SPEC-340 · ADR-0076 · dipakai juga oleh App untuk eskalasi audit → PRD (ter-prefill dari
// rekomendasi audit), karena itu di-export. `lockProject` mengunci pilihan project ke asal audit.
export function NewPrdModal({ projects, defaultProject, onClose, onCreate, prefill, lockProject }:
  { projects: ProjectVM[]; defaultProject: string; onClose: () => void;
    onCreate: (project: string, brief: PrdBriefForm) => void;
    prefill?: { title?: string; context?: string; outcome?: string; constraints?: string };
    lockProject?: boolean }) {
  const [project, setProject] = React.useState(defaultProject || projects[0]?.id || "");
  const [f, setF] = React.useState({
    title: prefill?.title ?? "", context: prefill?.context ?? "",
    outcome: prefill?.outcome ?? "", constraints: prefill?.constraints ?? "" });
```

dan tambahkan `disabled={lockProject}` pada `<Select aria-label="Project untuk PRD baru" … />`.

- [ ] **Step 4: Wiring di `App.tsx`**

(a) Tambah import: `import { PrdScreen, NewPrdModal, type PrdPrefill, type PrdBriefForm } from "./screens/PrdScreen";`
dan `import type { AuditEscalation } from "@hanoman/shared";`

(b) Tambah state di dekat `specPrefill` (baris ~495):

```tsx
  // SPEC-340 · ADR-0076 · eskalasi audit → PRD: modal brief PRD ter-prefill + asal auditnya.
  const [prdFromAudit, setPrdFromAudit] = React.useState<
    { project: string; branchFrom: string; fromAudit: string; title: string; context: string; outcome: string } | null>(null);
```

(c) Ganti `promoteToQa` dan tambahkan dua saudaranya (setelah baris ~810):

```tsx
  // SPEC-237 · naikkan audit → Finding QA (audit tetap doc-of-record). SPEC-340 · ADR-0076 ·
  // prefill kini boleh datang dari rekomendasi audit yang terbaca mesin; bila tak ada, jatuh ke
  // turunan lama (judul + objective audit) supaya audit pra-SPEC-340 tetap bisa dinaikkan.
  function promoteToQa(spec: Spec, e: AuditEscalation | null) {
    const pf = e?.prefill;
    setSpecPrefill({ project: spec.projectId, kind: "qa", title: pf?.title || spec.title,
      steps: (pf?.steps || `Dari audit ${spec.id}: ${spec.objective}`).slice(0, 500),
      actual: pf?.context || spec.objective,
      severity: pf?.severity && ["critical", "major", "minor"].includes(pf.severity) ? pf.severity : "major",
      // SPEC-244 · teruskan branch audit (hanoman/<audit-id>) + sinyal skip fase Audit (ADR-0059).
      branchFrom: `hanoman/${spec.id.toLowerCase()}`, fromAudit: spec.id });
    setModal("brief");
  }
  // SPEC-340 · ADR-0076 · audit → feature brief. Branch audit diteruskan supaya dokumen audit ada
  // di worktree; `fromAudit` membuat prompt memakainya sebagai bahan Brainstorm (tanpa skip fase).
  function promoteToBrief(spec: Spec, e: AuditEscalation | null) {
    const pf = e?.prefill;
    setSpecPrefill({ project: spec.projectId, kind: "brief", title: pf?.title || spec.title,
      context: pf?.context || `Dari audit ${spec.id}: ${spec.objective}`,
      outcome: pf?.outcome || "", branchFrom: `hanoman/${spec.id.toLowerCase()}`, fromAudit: spec.id });
    setModal("brief");
  }
  // SPEC-340 · ADR-0076 · audit → PRD. PRD bukan Spec (ADR-0041): yang dibuka modal brief PRD,
  // lalu sesi prd lahir dari branch audit dengan dokumen auditnya disematkan server ke prompt.
  function promoteToPrd(spec: Spec, e: AuditEscalation | null) {
    const pf = e?.prefill;
    setPrdFromAudit({ project: spec.projectId, branchFrom: `hanoman/${spec.id.toLowerCase()}`,
      fromAudit: spec.id, title: pf?.title || spec.title,
      context: pf?.context || `Dari audit ${spec.id}: ${spec.objective}`, outcome: pf?.outcome || "" });
  }
```

(d) Ganti `createSpec` agar brief pun membawa `fromAudit` (payload brief kini menerimanya, Task 1):

```tsx
      : { context: f.context, outcome: f.outcome, constraints: f.constraints, priority: f.priority,
          // SPEC-340 · ADR-0076 · brief yang dinaikkan dari audit membawa asal-usulnya ke prompt.
          ...(f.fromAudit ? { fromAudit: f.fromAudit } : {}) };
```

(e) Ganti `startPrd` agar meneruskan opsi, dan render modal PRD dari audit:

```tsx
  async function startPrd(project: string, brief: PrdBriefForm,
                          opts?: { branchFrom?: string; fromAudit?: string }) {
    try {
      const { id } = await api.startPrd(project, brief, opts);
      setSection("terminal");
      showToast(`PRD · sesi ${id} dimulai`, "info", "scroll-text");
    } catch { showToast("gagal mulai sesi PRD", "warn", "x-circle"); }
  }
```

> Pertahankan isi `catch`/toast asli berkas ini bila berbeda — yang berubah hanya parameter `opts`.

Di blok render (dekat `<NewSpecModal … />`, baris ~1064):

```tsx
        {/* SPEC-340 · ADR-0076 · eskalasi audit → PRD: brief PRD ter-prefill, project terkunci
            ke asal audit, sesi lahir dari branch audit dengan dokumen auditnya tersemat. */}
        {prdFromAudit && (
          <NewPrdModal projects={projectsView} defaultProject={prdFromAudit.project}
            lockProject
            prefill={{ title: prdFromAudit.title, context: prdFromAudit.context, outcome: prdFromAudit.outcome }}
            onClose={() => setPrdFromAudit(null)}
            onCreate={(project, brief) => {
              startPrd(project, brief, { branchFrom: prdFromAudit.branchFrom, fromAudit: prdFromAudit.fromAudit });
              setPrdFromAudit(null);
            }} />
        )}
```

(f) Teruskan kedua handler baru ke `BacklogScreen` (baris ~936):

```tsx
          onPromoteToQa={promoteToQa} onPromoteToBrief={promoteToBrief} onPromoteToPrd={promoteToPrd}
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism src`
Expected: seluruh test `src` PASS (termasuk `prd-screen.test.tsx` & `app-flows.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/src/App.tsx src/src/screens/PrdScreen.tsx src/test/audit-escalation-app.test.tsx
git commit -m "feat(spec-340): wiring App — eskalasi audit ke feature brief & PRD"
```

---

### Task 10: Verifikasi menyeluruh — typecheck, suite penuh, smoke API nyata, docs

**Files:**
- Modify (bila perlu): `internal/docs/architecture/api-contract.md`, `internal/docs/README.md`, `internal/skills/hanoman/SKILL.md`
- Test: seluruh repo

**Interfaces:**
- Consumes: semua task sebelumnya
- Produces: bukti verifikasi (output perintah) + docs SoT yang sinkron

- [ ] **Step 1: Typecheck seluruh workspace**

Run: `pnpm typecheck`
Expected: exit 0, tanpa error TS.

- [ ] **Step 2: Suite penuh**

Run:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 \
  env -u NODE_ENV pnpm vitest run --no-file-parallelism
```
Expected: semua paket (shared/server/src/runner/cli/sdk) PASS. Bila `hanoman340_test` belum ada:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340_test \
  pnpm --filter ./server exec prisma migrate deploy
```

- [ ] **Step 3: Boot server nyata + smoke `GET /specs/:id/escalation`**

Siapkan DB & repo uji, lalu:
```bash
DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server build
PORT=8797 DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman340 node server/dist/server.js &
```
- Buat user lewat `POST /api/auth/setup`, simpan cookie ke berkas.
- Buat project ber-`repoDir` menunjuk repo uji, tanam
  `internal/docs/research/audit-spec-900-x.md` berisi blok json `target: "prd"`, dan buat `Spec`
  `SPEC-900` (`source: "audit"`) lewat `POST /api/specs`.
- `curl -b cookies -s localhost:8797/api/specs/SPEC-900/escalation` →
  **harus** memuat `"target":"prd"` dan `"live":false`.
- Rusak blok json-nya di berkas, ulangi curl → **harus** 200 dengan `"escalation":null`.
- `curl -b cookies -s localhost:8797/api/specs/SPEC-901/escalation` (spec tak ada) → **harus** 404.

Jangan pakai port 8787 (dev sesi lain) dan jangan pakai DB `hanoman_test` (sibling vitest
men-truncate-nya di tengah smoke).

- [ ] **Step 4: Smoke `POST /terminal/sessions` flow prd dari audit**

Di repo uji, buat branch `hanoman/spec-900` lebih dulu (`git branch hanoman/spec-900`), lalu:
```bash
curl -b cookies -s -X POST localhost:8797/api/terminal/sessions \
  -H 'content-type: application/json' \
  -d '{"project":"<id>","flow":"prd","brief":{"title":"Kuota tenant","context":"c","outcome":"o"},"branchFrom":"hanoman/spec-900","fromAudit":"SPEC-900"}'
```
Expected: 201 `{ "id": "prd-kuota-tenant" }`, dan worktree `<repo>/.worktrees/prd-kuota-tenant` ada.
**Segera tutup sesinya** (`curl -X DELETE …/api/terminal/sessions/prd-kuota-tenant`) supaya tak
meninggalkan proses agen hidup. Catat: sesi ini men-spawn agen sungguhan — jalankan hanya sekali,
di repo uji throwaway, lalu hentikan.

- [ ] **Step 5: Sinkronkan docs SoT**

Periksa ulang bahwa yang berikut sudah menggambarkan implementasi final (ditulis di fase Spec —
perbaiki bila ada yang meleset saat implementasi):
- `internal/docs/architecture/api-contract.md` — `GET /specs/:id/escalation` + `flow:"prd"` ber-`branchFrom`/`fromAudit` + catatan `fromAudit` di `POST /specs`.
- `internal/docs/README.md` — baris ADR-0076 ter-link.
- `internal/skills/hanoman/SKILL.md` — tambahkan satu butir di "Aturan Sesi & Eksekusi" (dekat butir audit lintas project) yang menyebut: audit punya TIGA pintu eskalasi, rekomendasi = blok json di dokumen audit (turunan, bukan kolom), brief lanjutan audit tak melewati fase, PRD dari audit memakai `branchFrom` + penyematan dokumen.

- [ ] **Step 6: Verifikasi diff bersih & commit akhir**

```bash
git status --porcelain
git add -A
git commit -m "docs(spec-340): sinkronkan SKILL.md + hasil verifikasi eskalasi audit"
```
Expected: `git status --porcelain` kosong setelah commit.

- [ ] **Step 7: Verifikasi nomor ADR belum diklaim sibling, lalu push**

```bash
for b in $(git branch -a --format='%(refname:short)'); do git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null; done | grep -c '0076'
```
Bila ada branch **lain** yang sudah memakai 0076, renomori ADR ini ke nomor bebas berikutnya
(ubah nama berkas, header, dan semua rujukan `ADR-0076` di kode/komentar/docs) sebelum push.

```bash
git push origin HEAD:refs/heads/hanoman/spec-340
```

---

## Self-Review

**Spec coverage:**

| AC (ADR-0076 / design) | Task |
|---|---|
| AC-1 prompt mewajibkan blok json (audit + cross-audit) | 4 |
| AC-2 endpoint mengembalikan rekomendasi | 2, 3 |
| AC-3 dokumen/blok rusak → 200 `escalation:null` | 2, 3 |
| AC-4 freshest-wins `live:true` | 2 |
| AC-5 tiga tombol + sorotan (audit & cross-audit) | 8 |
| AC-6 brief ter-prefill + `branchFrom` + `fromAudit` | 1, 8, 9 |
| AC-7 klausa brief tanpa `skipped` | 5 |
| AC-8 PRD dari audit: `branchFrom` + dokumen tersemat | 6, 7, 9 |
| AC-9 jalur PRD lama tak berubah | 6 |
| AC-10 tanpa migration | seluruh plan (tak ada task menyentuh `schema.prisma`) |

**Placeholder scan:** tak ada TBD/TODO; setiap step yang mengubah kode memuat kodenya. Tiga step
memuat instruksi "baca berkas X lebih dulu lalu sesuaikan" — itu bukan placeholder melainkan pagar
terhadap tebakan bentuk mock/selektor yang tak bisa diverifikasi dari plan.

**Type consistency:** `AuditEscalation` (Task 1) dipakai konsisten di service (2), route (3),
klien (7), dan komponen (8, 9). `readAuditDoc` (Task 2) dikonsumsi Task 6 dengan bentuk
`{ path, content }` yang sama. `startPrdPrompt(project, brief, branchTo, audit?)` (Task 6) cocok
dengan pemanggilan di `routes/terminal.ts`. `onPromoteToQa` diubah tanda tangannya di Task 8 dan
implementasinya di Task 9 — keduanya `(s: Spec, e: AuditEscalation | null) => void`.
