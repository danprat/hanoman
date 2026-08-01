# MCP server hanoman — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman menyediakan MCP server resmi (`hanoman mcp`) yang membungkus permukaan REST-nya sebagai 17 tool MCP, sehingga agen AI mana pun yang berbicara MCP bisa memakainya tanpa pembungkus khusus per-klien.

**Architecture:** Server MCP **stdio** yang berperan sebagai **HTTP client** ke `/api` dengan agent token — jadi gate otorisasi `onRequest` di `server/src/app.ts` tetap satu-satunya yang memutuskan, dan route cookie-only tak terjangkau secara struktural. Katalog tool (nama, JSON Schema, capability, mode, pemetaan REST, pemadat respons) hidup di `@hanoman/shared` sebagai data murni, dipakai **runtime MCP di CLI** dan **panel Settings di web** — satu sumber, tak bisa drift.

**Tech Stack:** TypeScript strict · `@modelcontextprotocol/server@^2.0.0` (+ `@modelcontextprotocol/core`, `zod@4` — transitif, **dibundel esbuild** ke `cli/dist/hanoman.js`, tidak masuk `RUNTIME_DEPS`) · vitest · React 18 + design system hanoman.

## Global Constraints

- **Tak ada endpoint server baru, tak ada perubahan skema Prisma, tak ada migration.** MCP server adalah klien REST.
- **Tak ada tool yang mengeksekusi:** dilarang `POST /api/terminal/sessions`, seluruh `/api/vps*`, `POST /api/specs/:id/integrate`, `DELETE /api/specs/:id`, dan `PATCH /api/specs/:id` dengan field `stage`/`confirmDelete`.
- **Tak ada tool untuk route cookie-only:** `/api/auth*`, `/api/agent-tokens*`, `/api/device-tokens*`, `/api/sync*`.
- **Agent token tak pernah muncul** di hasil tool, pesan galat, stderr, maupun contoh pemasangan. Token **hanya** dibaca dari env atau berkas — tak pernah dari flag CLI (ARGV terbaca `ps`, SPEC-402).
- **stdout milik JSON-RPC.** Perintah `mcp` tak boleh memanggil `ctx.stdout` sama sekali; diagnostik ke `ctx.stderr`.
- **Bahasa:** deskripsi tool & pesan galat dalam **bahasa Indonesia** (konsisten dengan `docs/agent-integration.md` dan seluruh UI).
- **Enum otoritatif** (`shared/src/enums.ts`, jangan disalin dari dokumen lama yang basi):
  `source` = `brief|qa|audit|help|goal` (**tanpa** `cross-audit`) · `priority` = `tinggi|sedang|rendah` ·
  `severity` = `critical|major|minor` · `stage` = `brainstorming|objective|spec-ready|planned|executing|done`.
- **Domain `errors` tidak ada.** `/api/errors*` dicabut SPEC-384/ADR-0092.
- **Versi skema tool:** `MCP_TOOL_SCHEMA_VERSION = 1`. Aditif dalam satu versi; mengganti/menghapus nama tool, menghapus parameter, atau membuat parameter opsional jadi wajib **menuntut naik versi**.
- **Scope verifikasi:** hanya test yang tersentuh. Test server WAJIB `--no-file-parallelism` **dan** `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (SPEC-479). Test web WAJIB `env -u NODE_ENV`.
- Dokumen `internal/docs` yang tersentuh diperbarui **dalam commit yang sama** dan ditaut di `internal/docs/README.md`.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/mcp-schema.ts` (baru) | Fragmen JSON Schema yang dipakai berulang: enum, payload per-source, parameter paginasi. Deskripsi yang memuat jebakan hidup di sini. Murni. |
| `shared/src/mcp-shape.ts` (baru) | Pemadat respons per-bentuk, amplop paginasi wrapper, plafon byte. Murni. |
| `shared/src/mcp-catalog.ts` (baru) | 17 definisi tool: nama, deskripsi, skema, capability, mode, pemetaan REST, pemadat. Murni. |
| `shared/src/mcp.ts` (baru) | Versi skema, `mcpToolsFor()`, `MCP_INSTRUCTIONS`, re-export ketiga berkas di atas. |
| `shared/src/index.ts` (ubah) | `export * from "./mcp"`. |
| `server/test/mcp-capability.test.ts` (baru) | Kontrak: capability katalog == `capabilityForRoute`; larangan cookie-only/eksekusi. |
| `cli/src/mcp/config.ts` (baru) | `resolveMcpConfig(argv, env, readFile)` → host/token/readOnly/maxBytes + daftar keluhan. Murni. |
| `cli/src/mcp/redact.ts` (baru) | `redactToken(text, token)`. Murni. |
| `cli/src/mcp/errors.ts` (baru) | `explainHttpError(...)` → kalimat yang bisa ditindaklanjuti. Murni. |
| `cli/src/mcp/client.ts` (baru) | Klien HTTP ber-Bearer + probe `/api/health` sekali saat 401. |
| `cli/src/mcp/server.ts` (baru) | Merakit `McpServer` dari katalog + caller. |
| `cli/src/commands/mcp.ts` (baru) | Perintah `hanoman mcp`: resolve config → rakit → `serveStdio` → tunggu stdin tutup. |
| `cli/src/router.ts` (ubah) | Route `mcp` + baris `--help`. |
| `cli/package.json` (ubah) | `@modelcontextprotocol/server` sebagai dependency. |
| `src/src/screens/McpPanel.tsx` (baru) | Kartu Settings: snippet pasang per klien + tabel tool. |
| `src/src/screens/SettingsScreen.tsx` (ubah) | Render `<McpPanel/>` di dalam tab "Akses AI Agent". |
| `internal/docs/adr/0099-mcp-server-hanoman.md` (baru) | Doc-of-record. |

---

### Task 1: Fragmen JSON Schema di `@hanoman/shared`

**Files:**
- Create: `shared/src/mcp-schema.ts`
- Test: `shared/src/mcp-schema.test.ts`

**Interfaces:**
- Consumes: `shared/src/enums.ts` (hanya sebagai rujukan nilai — jangan impor zod di berkas ini).
- Produces: `type JsonSchemaNode`, `type JsonSchemaObject`, konstanta `PRIORITY_ENUM`, `SOURCE_ENUM`, `SEVERITY_ENUM`, `STAGE_ENUM`, skema `BRIEF_PAYLOAD`, `QA_PAYLOAD`, `GOAL_PAYLOAD`, `SPEC_PAYLOAD_ONEOF`, `SOURCE_PAYLOAD_ALLOF`, helper `str()`, `enumStr()`, `boolean()`, `int()`, `obj()`, `PAGE_PARAMS`.

- [x] **Step 1: Tulis test yang gagal**

```ts
// shared/src/mcp-schema.test.ts
import { describe, expect, it } from "vitest";
import {
  PRIORITY_ENUM, SOURCE_ENUM, SEVERITY_ENUM, STAGE_ENUM,
  BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD, SOURCE_PAYLOAD_ALLOF, PAGE_PARAMS, obj, str,
} from "./mcp-schema";
import { zSpecSource, zPriority, zStage } from "./enums";

describe("mcp-schema", () => {
  it("enum-nya diturunkan dari sumber yang sama dengan zod, bukan disalin tangan", () => {
    expect(SOURCE_ENUM).toEqual(zSpecSource.options);
    expect(PRIORITY_ENUM).toEqual(zPriority.options);
    expect(STAGE_ENUM).toEqual(zStage.options);
    expect(SOURCE_ENUM).not.toContain("cross-audit"); // dicabut SPEC-384/ADR-0092
    expect(SEVERITY_ENUM).toEqual(["critical", "major", "minor"]);
  });

  it("tiap payload menutup dirinya (additionalProperties:false) supaya oneOf hanya cocok satu", () => {
    for (const p of [BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD]) {
      expect(p.additionalProperties).toBe(false);
      expect(p.required?.length).toBeGreaterThan(0);
    }
    expect(Object.keys(QA_PAYLOAD.properties)).toContain("severity");
    expect(Object.keys(GOAL_PAYLOAD.properties)).toContain("goal");
    expect(Object.keys(BRIEF_PAYLOAD.properties)).toContain("outcome");
  });

  it("mengikat source ke bentuk payload lewat allOf if/then — ketiga arah", () => {
    expect(SOURCE_PAYLOAD_ALLOF).toHaveLength(3);
    const branches = SOURCE_PAYLOAD_ALLOF.map((b) => JSON.stringify(b.if));
    expect(branches.some((b) => b.includes('"qa"'))).toBe(true);
    expect(branches.some((b) => b.includes('"goal"'))).toBe(true);
    expect(branches.some((b) => b.includes("brief") && b.includes("audit") && b.includes("help"))).toBe(true);
  });

  it("setiap properti punya description — skema tool dibaca model, bukan manusia", () => {
    const walk = (o: { properties: Record<string, { description?: string }> }) => {
      for (const [k, v] of Object.entries(o.properties))
        expect(v.description, `properti "${k}" tanpa description`).toBeTruthy();
    };
    walk(BRIEF_PAYLOAD); walk(QA_PAYLOAD); walk(GOAL_PAYLOAD);
    walk(obj({ properties: PAGE_PARAMS }));
  });

  it("obj()/str() menghasilkan node JSON Schema yang sah", () => {
    const o = obj({ properties: { a: str("teks a") }, required: ["a"] });
    expect(o).toEqual({ type: "object", properties: { a: { type: "string", description: "teks a" } }, required: ["a"], additionalProperties: false });
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/mcp-schema.test.ts`
Expected: FAIL — `Failed to resolve import "./mcp-schema"`.

- [x] **Step 3: Implementasi**

```ts
// shared/src/mcp-schema.ts
// SPEC-482 · ADR-0099 · fragmen JSON Schema untuk katalog tool MCP.
//
// Sengaja JSON Schema polos, BUKAN zod: (a) `tools/list` MCP memancarkan JSON Schema apa adanya —
// yang ditulis di sini adalah persis yang dibaca model di seberang; (b) panel Settings merender
// katalog yang sama tanpa perlu konverter; (c) repo memakai zod v3 sementara SDK MCP v2 memakai
// zod v4 — memilih JSON Schema membuat katalog bebas dari perselisihan itu.
//
// Deskripsi di sini BUKAN kosmetik. Batasan SPEC-482: "sebut jebakan yang sudah diketahui langsung
// di deskripsi parameter, jangan mengandalkan agen membaca dokumen terpisah". Dokumen terpisah bisa
// basi tanpa suara — `~/.claude/skills/hanoman/api-reference.md` masih memuat domain `errors` dan
// source `cross-audit` yang dicabut SPEC-384. Skema tool tak bisa basi diam-diam: ia dites.
import { zPriority, zSpecSource, zStage } from "./enums";

export type JsonSchemaNode = {
  type?: string;
  description?: string;
  enum?: readonly string[];
  const?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  items?: JsonSchemaNode;
  oneOf?: readonly JsonSchemaNode[];
  properties?: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  additionalProperties?: boolean;
};

export type JsonSchemaObject = JsonSchemaNode & {
  type: "object";
  properties: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  additionalProperties: boolean;
  allOf?: readonly IfThen[];
};

export type IfThen = { if: JsonSchemaNode; then: JsonSchemaNode };

export const str = (description: string, extra: Partial<JsonSchemaNode> = {}): JsonSchemaNode =>
  ({ type: "string", description, ...extra });
export const enumStr = (values: readonly string[], description: string): JsonSchemaNode =>
  ({ type: "string", enum: values, description });
export const bool = (description: string): JsonSchemaNode => ({ type: "boolean", description });
export const int = (description: string, extra: Partial<JsonSchemaNode> = {}): JsonSchemaNode =>
  ({ type: "integer", description, ...extra });

export function obj(o: {
  properties: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  allOf?: readonly IfThen[];
  description?: string;
}): JsonSchemaObject {
  return {
    type: "object",
    ...(o.description ? { description: o.description } : {}),
    properties: o.properties,
    ...(o.required ? { required: o.required } : {}),
    additionalProperties: false,
    ...(o.allOf ? { allOf: o.allOf } : {}),
  };
}

// Diturunkan dari zod, bukan disalin: enum yang disalin adalah enum yang akan basi.
export const PRIORITY_ENUM = zPriority.options;
export const SOURCE_ENUM = zSpecSource.options;
export const STAGE_ENUM = zStage.options;
export const SEVERITY_ENUM = ["critical", "major", "minor"] as const;

export const PRIORITY = enumStr(
  PRIORITY_ENUM,
  "Prioritas backlog. Nilainya bahasa Indonesia — `tinggi`, `sedang`, `rendah`. Bukan high/medium/low.",
);

export const BRIEF_PAYLOAD = obj({
  description:
    "Bentuk payload untuk source `brief`, `audit`, dan `help`. Keempat field wajib ada (boleh string kosong).",
  properties: {
    context: str("Kenapa ini muncul: keadaan hari ini dan apa yang menghambat."),
    outcome: str("Keadaan yang diinginkan setelah selesai. Dari sinilah `objective` backlog diturunkan server."),
    constraints: str("Batasan yang mengikat: yang tak boleh berubah, yang wajib dipertahankan."),
    priority: PRIORITY,
    fromAudit: str("Opsional. Id backlog audit asal (mis. `SPEC-371`) bila item ini naik dari sebuah audit."),
  },
  required: ["context", "outcome", "constraints", "priority"],
});

export const QA_PAYLOAD = obj({
  description:
    "Bentuk payload untuk source `qa`. Server menurunkan `priority` dari `severity` (minor → sedang, selain itu → tinggi), jadi `priority` di tingkat atas diabaikan untuk source ini.",
  properties: {
    severity: enumStr(SEVERITY_ENUM, "Keparahan temuan: `critical`, `major`, atau `minor`."),
    steps: str("Langkah reproduksi, satu per baris."),
    expected: str("Yang seharusnya terjadi."),
    actual: str("Yang sebenarnya terjadi. Dari sinilah `objective` backlog diturunkan server."),
    env: str("Lingkungan tempat temuan muncul: versi, browser, OS, instance."),
    fromAudit: str("Opsional. Id backlog audit asal (mis. `SPEC-371`)."),
  },
  required: ["severity", "steps", "expected", "actual", "env"],
});

export const GOAL_PAYLOAD = obj({
  description:
    "Bentuk payload untuk source `goal`. Sesi goal mengejar satu tujuan tanpa fase perencanaan (ADR-0089).",
  properties: {
    goal: str("Satu tujuan yang dikejar sesi. Dari sinilah `objective` backlog diturunkan server."),
    done: str("Bukti berhenti yang dituntut. Kosong berarti goal itu sendiri buktinya."),
    constraints: str("Batasan yang mengikat."),
    priority: PRIORITY,
  },
  required: ["goal", "done", "constraints", "priority"],
});

export const SPEC_PAYLOAD_ONEOF: JsonSchemaNode = {
  description:
    "Isi backlog. BENTUKNYA DITENTUKAN `source`: `qa` → {severity, steps, expected, actual, env}; `goal` → {goal, done, constraints, priority}; `brief`/`audit`/`help` → {context, outcome, constraints, priority}. Bentuk yang tak cocok ditolak sebelum dikirim.",
  oneOf: [BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD],
};

// Mengikat `source` ke bentuk `payload` di tingkat skema, sehingga kombinasi yang salah ditolak
// oleh KLIEN — bukan ditemukan lewat 400 `"bentuk payload tak cocok dengan source"` dari server.
export const SOURCE_PAYLOAD_ALLOF: readonly IfThen[] = [
  { if: { properties: { source: { const: "qa" } }, required: ["source"] }, then: { properties: { payload: QA_PAYLOAD } } },
  { if: { properties: { source: { const: "goal" } }, required: ["source"] }, then: { properties: { payload: GOAL_PAYLOAD } } },
  { if: { properties: { source: { enum: ["brief", "audit", "help"] } }, required: ["source"] }, then: { properties: { payload: BRIEF_PAYLOAD } } },
];

export const PAGE_PARAMS: Record<string, JsonSchemaNode> = {
  page: int("Halaman, mulai dari 1. Default 1.", { minimum: 1 }),
  limit: int("Jumlah item per halaman. Default 20, maksimum 100. Balasan tool dibatasi ukurannya — minta halaman berikutnya, jangan menaikkan limit sampai membanjiri konteks.", { minimum: 1, maximum: 100 }),
};

export const DATE_PARAMS: Record<string, JsonSchemaNode> = {
  dateField: enumStr(["created", "started"], "Sumbu tanggal: `created` (kapan item difilekan, default) atau `started` (kapan sesi pertamanya lahir). `started` MEMBUANG item yang belum pernah dikerjakan."),
  from: str("Batas bawah tanggal, format `YYYY-MM-DD`, INKLUSIF. Boleh sendirian tanpa `to`."),
  to: str("Batas atas tanggal, format `YYYY-MM-DD`, INKLUSIF. Boleh sendirian tanpa `from`."),
};
```

- [x] **Step 4: Jalankan test — pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/mcp-schema.test.ts`
Expected: PASS, 5 test.

- [x] **Step 5: Commit**

```bash
git add shared/src/mcp-schema.ts shared/src/mcp-schema.test.ts
git commit -m "feat(482): fragmen JSON Schema katalog tool MCP"
```

---

### Task 2: Pemadat respons, paginasi wrapper, plafon byte

**Files:**
- Create: `shared/src/mcp-shape.ts`
- Test: `shared/src/mcp-shape.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `clip(text, max)`, `pickFields(row, fields)`, `shapeProject`, `shapeProjectDetail`, `shapeSpec`, `shapeSpecDetail`, `shapeSession`, `shapeNotification`, `shapeTicket`, `shapeGithubIssue`, `shapeLeadDecision`, `paginateLocal(items, page, limit)`, `renderResult(value, maxBytes)`, konstanta `DEFAULT_MAX_BYTES = 24 * 1024`, `DEFAULT_LIMIT = 20`, `MAX_LIMIT = 100`.

- [x] **Step 1: Tulis test yang gagal**

```ts
// shared/src/mcp-shape.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT, DEFAULT_MAX_BYTES, MAX_LIMIT,
  clip, paginateLocal, renderResult, shapeProject, shapeSpec, shapeSpecDetail,
} from "./mcp-shape";

describe("clip", () => {
  it("memotong dan menandai potongan, tak diam-diam", () => {
    expect(clip("abcdefghij", 5)).toBe("abcde… (dipotong)");
  });
  it("tak menyentuh yang muat", () => {
    expect(clip("abc", 5)).toBe("abc");
  });
  it("nilai non-string lewat apa adanya", () => {
    expect(clip(null, 5)).toBe(null);
  });
});

describe("shapeProject", () => {
  it("membuang field berat dan menyisakan yang dipakai agen", () => {
    const row = {
      id: "hanoman", name: "hanoman", desc: "orchestrator", kind: "existing",
      repoDir: "/Users/x/hanoman", gitRemote: "git@github.com:x/y.git", stack: "ts",
      docStatus: "ok", coverage: 91, createdAt: "2026-01-01T00:00:00.000Z",
      binding: "/Users/x/hanoman", backlog: 284, topStage: "executing",
      session: { status: "running", phase: "Execute", flow: "feature" },
      activity: "2026-08-01", commit: "abc1234", helpEnabled: true,
      schedulerOptIn: true, leadOptIn: false,
    };
    expect(shapeProject(row)).toEqual({
      id: "hanoman", name: "hanoman", kind: "existing", desc: "orchestrator",
      backlog: 284, topStage: "executing", coverage: 91,
      schedulerOptIn: true, leadOptIn: false,
    });
  });
});

describe("shapeSpec", () => {
  const row = {
    id: "SPEC-482", projectId: "hanoman", title: "MCP server", source: "brief",
    stage: "brainstorming", priority: "sedang", author: "a@b.c",
    objective: "x".repeat(500),
    payload: { context: "c", outcome: "o", constraints: "k", priority: "sedang" },
    branchFrom: null, baseSha: null, headSha: null,
    createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
    dependsOn: [], blockedBy: [], version: 3, updatedAt: "2026-08-01T00:00:00.000Z",
  };
  it("ringkas: tanpa payload, objective dipotong 200", () => {
    const s = shapeSpec(row) as Record<string, unknown>;
    expect(s.payload).toBeUndefined();
    expect(String(s.objective)).toHaveLength(200 + "… (dipotong)".length);
    expect(s.id).toBe("SPEC-482");
    expect(s.startable).toBe(true); // stage != done
  });
  it("detail: payload utuh dan objective utuh", () => {
    const s = shapeSpecDetail(row) as Record<string, unknown>;
    expect(s.payload).toEqual(row.payload);
    expect(String(s.objective)).toHaveLength(500);
  });
});

describe("paginateLocal", () => {
  const items = Array.from({ length: 55 }, (_, i) => ({ i }));
  it("default 20 per halaman", () => {
    const r = paginateLocal(items, undefined, undefined);
    expect(r.items).toHaveLength(DEFAULT_LIMIT);
    expect(r).toMatchObject({ total: 55, page: 1, pageSize: DEFAULT_LIMIT });
  });
  it("halaman kedua melanjutkan, bukan mengulang", () => {
    expect(paginateLocal(items, 2, 20).items[0]).toEqual({ i: 20 });
  });
  it("limit dijepit ke MAX_LIMIT", () => {
    expect(paginateLocal(items, 1, 9999).pageSize).toBe(MAX_LIMIT);
  });
});

describe("renderResult", () => {
  it("di bawah plafon: JSON apa adanya", () => {
    const out = renderResult({ a: 1 }, DEFAULT_MAX_BYTES);
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });
  it("di atas plafon: JSON yang MASIH SAH plus penanda terbaca mesin", () => {
    const big = { items: Array.from({ length: 500 }, (_, i) => ({ i, pad: "x".repeat(200) })) };
    const out = renderResult(big, 2000);
    const parsed = JSON.parse(out) as { truncated: boolean; shown: number; total: number; hint: string; items: unknown[] };
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(500);
    expect(parsed.shown).toBeLessThan(500);
    expect(parsed.items).toHaveLength(parsed.shown);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(parsed.hint).toContain("page");
  });
  it("objek non-daftar yang kebesaran tetap JSON sah", () => {
    const out = renderResult({ blob: "y".repeat(10_000) }, 500);
    const parsed = JSON.parse(out) as { truncated: boolean };
    expect(parsed.truncated).toBe(true);
    expect(out.length).toBeLessThanOrEqual(500);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/mcp-shape.test.ts`
Expected: FAIL — `Failed to resolve import "./mcp-shape"`.

- [x] **Step 3: Implementasi**

```ts
// shared/src/mcp-shape.ts
// SPEC-482 · ADR-0099 · pemadat balasan tool MCP.
//
// Kenapa ada: `GET /projects` mengembalikan puluhan kilobita, dan konteks agen bukan tempat
// membuang isi tabel. Dua lapis — (1) proyeksi field per bentuk, (2) plafon byte yang memotong
// SAMBIL tetap menghasilkan JSON yang sah plus penanda terbaca mesin. JSON terpotong di tengah
// lebih buruk daripada tak dikirim: agen akan menganggapnya galat parsing, bukan batas.

export const DEFAULT_MAX_BYTES = 24 * 1024;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const OBJECTIVE_CLIP = 200;
const MARK = "… (dipotong)";

export function clip<T>(value: T, max: number): T | string {
  if (typeof value !== "string") return value;
  return value.length <= max ? value : value.slice(0, max) + MARK;
}

const pick = <K extends string>(row: Record<string, unknown>, keys: readonly K[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  return out;
};

export const shapeProject = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, ["id", "name", "kind", "desc", "backlog", "topStage", "coverage", "schedulerOptIn", "leadOptIn"]);

export const shapeProjectDetail = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, [
    "id", "name", "kind", "desc", "stack", "gitRemote", "docStatus", "coverage",
    "backlog", "topStage", "session", "activity", "commit",
    "helpEnabled", "schedulerOptIn", "leadOptIn", "createdAt",
  ]);

const SPEC_BASE = [
  "id", "projectId", "title", "source", "stage", "priority",
  "createdAt", "startedAt", "branchFrom", "dependsOn", "blockedBy",
] as const;

export function shapeSpec(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pick(row, SPEC_BASE),
    objective: clip(row.objective, OBJECTIVE_CLIP),
    // Turunan yang menghemat satu panggilan balik: "boleh diedit / belum dimulai" adalah pertanyaan
    // yang selalu diajukan agen sesudah membaca daftar, dan jawabannya sudah ada di kedua kolom ini.
    startable: row.stage !== "done",
    editable: row.stage === "brainstorming" && row.baseSha === null,
  };
}

export const shapeSpecDetail = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, [...SPEC_BASE, "objective", "payload", "author", "baseSha", "headSha", "updatedAt"]),
  startable: row.stage !== "done",
  editable: row.stage === "brainstorming" && row.baseSha === null,
});

export const shapeSession = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, ["id", "projectId", "specId", "flow", "agent", "branch", "exited", "exitCode", "decision"]);

export const shapeNotification = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, ["id", "type", "projectId", "specId", "sessionId", "createdAt", "readAt"]),
  title: clip(row.title, 300),
});

export const shapeTicket = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, ["id", "projectId", "number", "category", "title", "status", "specId", "attachmentCount", "createdAt"]);

export const shapeGithubIssue = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, ["id", "projectId", "repoSlug", "number", "title", "authorLogin", "labels", "url", "issueState", "status", "specId", "issueUpdatedAt"]),
  body: clip(row.body, 500),
});

export const shapeLeadDecision = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, ["id", "projectId", "specId", "sessionId", "gate", "kind", "status", "confidence", "action", "choice", "createdAt"]),
  question: clip(row.question, 300),
  answer: clip(row.answer, 500),
  reason: clip(row.reason, 500),
});

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export function paginateLocal<T>(items: T[], page?: number, limit?: number): Page<T> {
  const size = Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const p = Math.max(1, Math.floor(page ?? 1));
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size };
}

/**
 * JSON dengan plafon byte. Bila muat → apa adanya. Bila tidak → hasilnya TETAP JSON sah:
 * daftar dipangkas item demi item sampai muat, non-daftar diganti amplop bertanda. Penanda
 * `truncated`/`shown`/`total`/`hint` dibuat terbaca mesin supaya agen tahu ini batas, bukan galat.
 */
export function renderResult(value: unknown, maxBytes: number): string {
  const full = JSON.stringify(value);
  if (full.length <= maxBytes) return full;

  const asPage = value as { items?: unknown[]; total?: number; page?: number; pageSize?: number };
  if (Array.isArray(asPage.items)) {
    const total = typeof asPage.total === "number" ? asPage.total : asPage.items.length;
    const rest = { ...asPage } as Record<string, unknown>;
    delete rest.items;
    for (let n = asPage.items.length - 1; n >= 0; n--) {
      const candidate = JSON.stringify({
        ...rest,
        truncated: true, shown: n, total,
        hint: `balasan dipotong pada plafon ${maxBytes} byte — persempit filter atau minta halaman berikutnya lewat parameter page/limit`,
        items: asPage.items.slice(0, n),
      });
      if (candidate.length <= maxBytes) return candidate;
    }
  }
  const head = full.slice(0, Math.max(0, maxBytes - 320));
  return JSON.stringify({
    truncated: true, shown: 0, total: 1,
    hint: `balasan dipotong pada plafon ${maxBytes} byte — persempit permintaan atau ambil berkasnya lewat tool yang lebih spesifik (parameter page/limit tersedia di tool daftar)`,
    preview: head,
  }).slice(0, maxBytes);
}
```

- [x] **Step 4: Jalankan test — pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/mcp-shape.test.ts`
Expected: PASS, 11 test.

- [x] **Step 5: Commit**

```bash
git add shared/src/mcp-shape.ts shared/src/mcp-shape.test.ts
git commit -m "feat(482): pemadat balasan + paginasi + plafon byte tool MCP"
```

---

### Task 3: Katalog 17 tool + versi skema

**Files:**
- Create: `shared/src/mcp-catalog.ts`, `shared/src/mcp.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/mcp-catalog.test.ts`

**Interfaces:**
- Consumes: Task 1 (`mcp-schema.ts`), Task 2 (`mcp-shape.ts`).
- Produces:
  ```ts
  export type McpMode = "read" | "write";
  export type McpRequest = { method: "GET" | "POST" | "PATCH"; path: string; query?: Record<string, string> };
  export type McpToolDef = {
    name: string; title: string; description: string;
    inputSchema: JsonSchemaObject;
    mode: McpMode;
    capability: string | null;      // null = tak memanggil REST (hanoman_about)
    samplePath: string;             // path CONTOH untuk uji kontrak capability
    build(args: Record<string, unknown>): McpRequest | null;   // null = tak ada panggilan REST
    body?(args: Record<string, unknown>): unknown;
    shape(raw: unknown, args: Record<string, unknown>): unknown;
  };
  export const MCP_TOOLS: readonly McpToolDef[];
  export const MCP_TOOL_SCHEMA_VERSION = 1;
  export function mcpToolsFor(readOnly: boolean): readonly McpToolDef[];
  export const MCP_INSTRUCTIONS: string;
  ```

**Spesifikasi lengkap 17 tool** (semua `path` relatif terhadap `/api`):

| # | `name` | `mode` | `method` `path` | Parameter | `capability` | `shape` |
|---|---|---|---|---|---|---|
| 1 | `hanoman_about` | read | — (lokal) | — | `null` | — |
| 2 | `hanoman_projects_list` | read | `GET /projects` | `page`,`limit` | `projects:read` | `shapeProject` + `paginateLocal` |
| 3 | `hanoman_project_get` | read | `GET /projects/{project}` | `project`* | `projects:read` | `shapeProjectDetail` |
| 4 | `hanoman_backlog_search` | read | `GET /specs` | `project`,`source`,`stage`,`priority`,`startable`(bool),`q`,`dateField`,`from`,`to`,`page`,`limit` | `backlog:read` | `shapeSpec` per item |
| 5 | `hanoman_backlog_get` | read | `GET /specs?q={spec}` | `spec`* | `backlog:read` | cocok `id` persis → `shapeSpecDetail` |
| 6 | `hanoman_backlog_docs_list` | read | `GET /specs/{spec}/docs` | `spec`* | `backlog:read` | apa adanya |
| 7 | `hanoman_backlog_doc_read` | read | `GET /specs/{spec}/docs/{path}` | `spec`*,`path`* | `backlog:read` | apa adanya |
| 8 | `hanoman_sessions_list` | read | `GET /terminal/sessions` | `page`,`limit` | `sessions:read` | `shapeSession` + `paginateLocal` |
| 9 | `hanoman_notifications_list` | read | `GET /notifications` | `page`,`limit` | `notifications:read` | `shapeNotification` + `paginateLocal`, pertahankan `unread` |
| 10 | `hanoman_tickets_list` | read | `GET /tickets` | `project`,`status`,`page`,`limit` | `support:read` | `shapeTicket` + `paginateLocal` |
| 11 | `hanoman_ticket_get` | read | `GET /tickets/{ticket}` | `ticket`* | `support:read` | apa adanya |
| 12 | `hanoman_github_issues_list` | read | `GET /projects/{project}/github/issues` | `project`*,`status`,`page`,`limit` | `support:read` | `shapeGithubIssue` + `paginateLocal` |
| 13 | `hanoman_lead_decisions_list` | read | `GET /lead/decisions` | `project`,`spec`,`status`,`page`,`limit` | `lead:read` | `shapeLeadDecision` + `paginateLocal` |
| 14 | `hanoman_backlog_create` | write | `POST /specs` | `project`*,`source`*,`title`*,`priority`*,`payload`*,`branchFrom`,`dependsOn` | `backlog:write` | `shapeSpecDetail` |
| 15 | `hanoman_backlog_update` | write | `PATCH /specs/{spec}` | `spec`*,`title`,`priority`,`payload`,`dependsOn` | `backlog:write` | `shapeSpecDetail` |
| 16 | `hanoman_notifications_mark_read` | write | `POST /notifications/read` | — | `notifications:write` | apa adanya |
| 17 | `hanoman_lead_ask` | write | `POST /lead/decisions` | `project`*,`question`*,`spec`,`session`,`options`,`context` | `lead:write` | apa adanya |

`*` = wajib. Nama parameter sengaja `project`/`spec`/`ticket`/`session` (bukan `id`/`projectId`) supaya panggilan terbaca sendiri di transkrip agen.

- [x] **Step 1: Tulis test yang gagal**

```ts
// shared/src/mcp-catalog.test.ts
import { describe, expect, it } from "vitest";
import { MCP_TOOLS, MCP_TOOL_SCHEMA_VERSION, mcpToolsFor, MCP_INSTRUCTIONS } from "./mcp";

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("katalog tool MCP", () => {
  it("17 tool, semuanya berprefix hanoman_ dan namanya unik", () => {
    expect(MCP_TOOLS).toHaveLength(17);
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(17);
    for (const t of MCP_TOOLS) expect(t.name).toMatch(/^hanoman_[a-z0-9_]+$/);
  });

  it("mode baca-saja MENGHILANGKAN tool tulis, bukan menolaknya saat dipanggil", () => {
    const ro = mcpToolsFor(true);
    expect(ro.every((t) => t.mode === "read")).toBe(true);
    expect(ro).toHaveLength(13);
    expect(mcpToolsFor(false)).toHaveLength(17);
    expect(ro.map((t) => t.name)).not.toContain("hanoman_backlog_create");
  });

  it("tak ada tool yang mengeksekusi: /terminal hanya GET, /vps tak ada sama sekali", () => {
    for (const t of MCP_TOOLS) {
      expect(t.samplePath, t.name).not.toMatch(/^\/vps/);
      if (t.samplePath.startsWith("/terminal")) expect(t.sampleMethod, t.name).toBe("GET");
    }
    const paths = MCP_TOOLS.map((t) => t.samplePath);
    expect(paths).not.toContain("/terminal/sessions/new");
    expect(paths.some((p) => p.includes("integrate"))).toBe(false);
  });

  it("tak ada tool yang menyentuh route cookie-only", () => {
    for (const t of MCP_TOOLS)
      expect(t.samplePath, t.name).not.toMatch(/^\/(auth|agent-tokens|device-tokens|sync)\b/);
  });

  it("setiap tool punya deskripsi yang menyebut apa yang dikembalikan", () => {
    for (const t of MCP_TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.title.length, t.name).toBeGreaterThan(0);
    }
  });

  it("startable diekspos sebagai BOOLEAN — jebakan `startable=1` diabaikan senyap tak bisa terjadi", () => {
    const t = byName("hanoman_backlog_search");
    expect(t.inputSchema.properties.startable?.type).toBe("boolean");
    expect(t.build({ startable: true })?.query).toMatchObject({ startable: "true" });
    expect(t.build({ startable: false })?.query?.startable).toBeUndefined();
    expect(t.build({})?.query?.startable).toBeUndefined();
  });

  it("q dinyatakan tak menyentuh payload", () => {
    expect(byName("hanoman_backlog_search").inputSchema.properties.q?.description).toMatch(/payload/i);
  });

  it("backlog_create mengikat source ke bentuk payload lewat allOf", () => {
    const t = byName("hanoman_backlog_create");
    expect(t.inputSchema.allOf).toHaveLength(3);
    expect(t.inputSchema.properties.stage).toBeUndefined();  // stage selalu lahir brainstorming
    expect(t.inputSchema.properties.id).toBeUndefined();     // id diturunkan server
  });

  it("backlog_update hanya konten — tak ada stage/confirmDelete yang bisa menghapus artefak", () => {
    const t = byName("hanoman_backlog_update");
    expect(Object.keys(t.inputSchema.properties).sort())
      .toEqual(["dependsOn", "payload", "priority", "spec", "title"]);
  });

  it("backlog_get mencocokkan id PERSIS, bukan substring q", () => {
    const t = byName("hanoman_backlog_get");
    const raw = { items: [{ id: "SPEC-4820", stage: "done" }, { id: "SPEC-482", stage: "planned" }], total: 2, page: 1, pageSize: 50 };
    expect((t.shape(raw, { spec: "SPEC-482" }) as { id: string }).id).toBe("SPEC-482");
    expect(t.shape({ items: [], total: 0, page: 1, pageSize: 50 }, { spec: "SPEC-999" }))
      .toMatchObject({ error: expect.stringContaining("SPEC-999") });
  });

  it("versi skema tool ada dan disebut di instructions", () => {
    expect(MCP_TOOL_SCHEMA_VERSION).toBe(1);
    expect(MCP_INSTRUCTIONS).toContain(String(MCP_TOOL_SCHEMA_VERSION));
  });

  it("SNAPSHOT KONTRAK — nama tool + parameter wajib. Berubah = klien lama patah = WAJIB naik versi", () => {
    const snapshot = MCP_TOOLS.map((t) => `${t.name}(${[...(t.inputSchema.required ?? [])].sort().join(",")})`).sort();
    expect(snapshot).toEqual([
      "hanoman_about()",
      "hanoman_backlog_create(payload,priority,project,source,title)",
      "hanoman_backlog_doc_read(path,spec)",
      "hanoman_backlog_docs_list(spec)",
      "hanoman_backlog_get(spec)",
      "hanoman_backlog_search()",
      "hanoman_backlog_update(spec)",
      "hanoman_github_issues_list(project)",
      "hanoman_lead_ask(project,question)",
      "hanoman_lead_decisions_list()",
      "hanoman_notifications_list()",
      "hanoman_notifications_mark_read()",
      "hanoman_project_get(project)",
      "hanoman_projects_list()",
      "hanoman_sessions_list()",
      "hanoman_ticket_get(ticket)",
      "hanoman_tickets_list()",
    ]);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/mcp-catalog.test.ts`
Expected: FAIL — `Failed to resolve import "./mcp"`.

- [x] **Step 3: Implementasi katalog**

```ts
// shared/src/mcp-catalog.ts
// SPEC-482 · ADR-0099 · katalog tool MCP hanoman. Data murni: dipakai runtime MCP di CLI DAN
// panel Settings di web, jadi daftar capability yang harus dicentang manusia tak bisa drift dari
// yang benar-benar dituntut tool.
import {
  DATE_PARAMS, PAGE_PARAMS, PRIORITY, SOURCE_ENUM, SOURCE_PAYLOAD_ALLOF, SPEC_PAYLOAD_ONEOF,
  STAGE_ENUM, bool, enumStr, int, obj, str, type JsonSchemaObject,
} from "./mcp-schema";
import {
  paginateLocal, shapeGithubIssue, shapeLeadDecision, shapeNotification, shapeProject,
  shapeProjectDetail, shapeSession, shapeSpec, shapeSpecDetail, shapeTicket,
} from "./mcp-shape";

export type McpMode = "read" | "write";
export type McpRequest = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

export type McpToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  mode: McpMode;
  /** Capability REST yang dituntut. `null` = tool ini tak memanggil `/api` sama sekali. */
  capability: string | null;
  /** Path CONTOH (tanpa `/api`) untuk uji kontrak terhadap `capabilityForRoute`. */
  samplePath: string;
  /** Method contoh, dipakai uji kontrak yang sama. */
  sampleMethod: "GET" | "POST" | "PATCH";
  build(args: Args): McpRequest | null;
  shape(raw: unknown, args: Args): unknown;
};

type Args = Record<string, unknown>;
const s = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const enc = encodeURIComponent;

/** Query dari argumen: hanya yang terisi ikut. `undefined` tak pernah jadi string "undefined". */
function query(pairs: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) if (v !== undefined) out[k] = v;
  return out;
}

const pageArgs = (a: Args) => query({
  page: n(a.page) === undefined ? undefined : String(n(a.page)),
  limit: n(a.limit) === undefined ? undefined : String(n(a.limit)),
});

/** Amplop daftar dari server (`{items,total,page,pageSize}`) → item dipadatkan, amplop dijaga. */
function reshapePage(raw: unknown, fn: (r: Record<string, unknown>) => unknown): unknown {
  const p = raw as { items?: unknown[] };
  if (!Array.isArray(p?.items)) return raw;
  return { ...(raw as object), items: p.items.map((i) => fn(i as Record<string, unknown>)) };
}

/** Daftar mentah (`{items:[…]}` tanpa paginasi server) → dipadatkan lalu dipaginasi di wrapper. */
function localPage(raw: unknown, a: Args, fn: (r: Record<string, unknown>) => unknown, extra?: (raw: any) => object): unknown {
  const items = Array.isArray((raw as { items?: unknown[] })?.items)
    ? (raw as { items: unknown[] }).items
    : Array.isArray(raw) ? (raw as unknown[]) : [];
  return { ...paginateLocal(items.map((i) => fn(i as Record<string, unknown>)), n(a.page), n(a.limit)), ...(extra?.(raw) ?? {}) };
}

const ID_HINT = "Id backlog, mis. `SPEC-482` (huruf besar, dengan tanda hubung).";

export const MCP_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_about",
    title: "Tentang sambungan ini",
    description:
      "Instance hanoman mana yang sedang tersambung, versi skema tool, mode (baca-tulis / baca-saja), dan daftar tool yang aktif. Panggil ini lebih dulu bila ada tool yang menjawab 401 atau 403 — jawabannya menyebut host yang dipakai. Tool ini tak butuh token dan tak pernah menampilkan token.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/health", sampleMethod: "GET",
    build: () => null,
    shape: (raw) => raw,
  },
  {
    name: "hanoman_projects_list",
    title: "Daftar proyek",
    description:
      "Daftar seluruh proyek yang dikelola hanoman, dipadatkan ke field yang dipakai agen: id, nama, jenis, jumlah backlog, stage tertinggi, coverage docs, dan opt-in scheduler/lead. Untuk detail satu proyek pakai hanoman_project_get.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "projects:read", samplePath: "/projects", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/projects" }),
    shape: (raw, a) => localPage(raw, a, shapeProject),
  },
  {
    name: "hanoman_project_get",
    title: "Detail proyek",
    description:
      "Detail satu proyek: stack, remote git, status & coverage docs, ringkasan sesi berjalan, aktivitas terakhir, dan opt-in scheduler/lead. Path repo per-mesin sengaja tidak dikembalikan.",
    inputSchema: obj({
      properties: { project: str("Id proyek (slug huruf kecil), mis. `hanoman`. Ambil dari hanoman_projects_list.") },
      required: ["project"],
    }),
    mode: "read", capability: "projects:read", samplePath: "/projects/hanoman", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}` }),
    shape: (raw) => shapeProjectDetail(raw as Record<string, unknown>),
  },
  {
    name: "hanoman_backlog_search",
    title: "Cari backlog",
    description:
      "Cari & saring backlog lintas proyek. Stage yang dikembalikan sudah stage LIVE (diturunkan dari sesi berjalan), bukan nilai basi di database — tak perlu memanggil apa pun untuk menyegarkannya. Balasannya ringkas: `objective` dipotong 200 karakter dan `payload` tidak ikut; pakai hanoman_backlog_get untuk isi penuh satu item.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Tanpa ini, pencarian mencakup SEMUA proyek."),
        source: enumStr(SOURCE_ENUM, "Asal item. `cross-audit` sudah tidak ada."),
        stage: enumStr(STAGE_ENUM, "Stage live yang dicocokkan persis."),
        priority: PRIORITY,
        startable: bool("true = hanya item yang belum selesai (stage bukan `done`). false / tak diisi = semua item."),
        q: str("Substring, tanpa peduli huruf besar-kecil, dicocokkan ke `id + title + objective` saja. TIDAK menyentuh isi `payload` — kata yang hanya ada di konteks/outcome tak akan ketemu."),
        ...DATE_PARAMS,
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "backlog:read", samplePath: "/specs", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/specs",
      query: query({
        project: s(a.project), source: s(a.source), stage: s(a.stage), priority: s(a.priority),
        // Jebakan yang ditutup di sini: server hanya melihat string "true"; nilai lain diabaikan
        // SENYAP dan mengembalikan SELURUH backlog termasuk yang `done`. Skema tool memakai
        // boolean, dan `false` MENGHILANGKAN parameternya alih-alih mengirim "false".
        startable: a.startable === true ? "true" : undefined,
        q: s(a.q), dateField: s(a.dateField), from: s(a.from), to: s(a.to),
        page: n(a.page) === undefined ? undefined : String(n(a.page)),
        limit: n(a.limit) === undefined ? undefined : String(n(a.limit)),
      }),
    }),
    shape: (raw) => reshapePage(raw, shapeSpec),
  },
  {
    name: "hanoman_backlog_get",
    title: "Detail backlog",
    description:
      "Isi lengkap satu backlog item termasuk `payload`, `baseSha`/`headSha`, dan penanda `editable` (masih boleh diubah bila stage `brainstorming` dan belum pernah punya sesi).",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "read", capability: "backlog:read", samplePath: "/specs", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/specs", query: { q: String(a.spec), limit: "100" } }),
    // REST tak punya `GET /specs/:id`; `q` adalah SUBSTRING, jadi `SPEC-48` mengembalikan
    // SPEC-480…489. Pencocokan persis dilakukan di sini, bukan dipercayakan ke server.
    shape: (raw, a) => {
      const want = String(a.spec).trim().toLowerCase();
      const items = ((raw as { items?: unknown[] })?.items ?? []) as Record<string, unknown>[];
      const hit = items.find((i) => String(i.id).toLowerCase() === want);
      return hit
        ? shapeSpecDetail(hit)
        : { error: `backlog "${a.spec}" tidak ada. Cek ejaannya (bentuknya SPEC-nnn) atau cari dengan hanoman_backlog_search.` };
    },
  },
  {
    name: "hanoman_backlog_docs_list",
    title: "Dokumen hasil sesi",
    description:
      "Daftar dokumen yang dihasilkan sesi backlog ini (design doc, plan, laporan audit). Sumbernya freshest-wins: worktree sesi yang masih hidup menang atas checkout proyek. Isi berkasnya dibaca dengan hanoman_backlog_doc_read.",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "read", capability: "backlog:read", samplePath: "/specs/SPEC-1/docs", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/specs/${enc(String(a.spec))}/docs` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_doc_read",
    title: "Baca dokumen sesi",
    description:
      "Isi satu dokumen hasil sesi. `path` adalah jalur relatif yang persis seperti muncul di hanoman_backlog_docs_list. Balasan panjang dipotong pada plafon byte dan ditandai `truncated`.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        path: str("Jalur relatif dokumen, mis. `docs/superpowers/plans/2026-08-01-x.md`. Salin apa adanya dari hanoman_backlog_docs_list."),
      },
      required: ["spec", "path"],
    }),
    mode: "read", capability: "backlog:read", samplePath: "/specs/SPEC-1/docs/a.md", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/specs/${enc(String(a.spec))}/docs/${String(a.path).split("/").map(enc).join("/")}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_sessions_list",
    title: "Sesi berjalan",
    description:
      "Sesi agen yang hidup sekarang (sumber kebenarannya tmux, bukan database). `exited: true` berarti prosesnya sudah mati — `exitCode` bukan 0 berarti gagal. Tool ini hanya MEMBACA; membuat sesi baru tidak tersedia lewat MCP.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "sessions:read", samplePath: "/terminal/sessions", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/terminal/sessions" }),
    shape: (raw, a) => localPage(raw, a, shapeSession),
  },
  {
    name: "hanoman_notifications_list",
    title: "Notifikasi",
    description:
      "Notifikasi terbaru (50 teratas dari server) berikut jumlah yang belum dibaca. `type`: `done` (backlog selesai), `decision` (sesi menunggu jawaban manusia), `ticket`, `fail`, `lead`.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "notifications:read", samplePath: "/notifications", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/notifications" }),
    shape: (raw, a) => localPage(raw, a, shapeNotification, (r) => ({ unread: r?.unread ?? 0 })),
  },
  {
    name: "hanoman_tickets_list",
    title: "Tiket Help Center",
    description:
      "Tiket yang masuk lewat Help Center publik. `status`: `new` (belum ditriase), `accepted` (sudah jadi backlog — lihat `specId`), `rejected`.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Tanpa ini, seluruh proyek."),
        status: enumStr(["new", "accepted", "rejected"], "Status triase."),
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "support:read", samplePath: "/tickets", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/tickets", query: query({ project: s(a.project), status: s(a.status) }) }),
    shape: (raw, a) => localPage(raw, a, shapeTicket),
  },
  {
    name: "hanoman_ticket_get",
    title: "Detail tiket",
    description: "Isi lengkap satu tiket Help Center berikut daftar lampirannya.",
    inputSchema: obj({ properties: { ticket: str("Id tiket, seperti muncul di hanoman_tickets_list.") }, required: ["ticket"] }),
    mode: "read", capability: "support:read", samplePath: "/tickets/t1", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/tickets/${enc(String(a.ticket))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_github_issues_list",
    title: "Issue GitHub yang sudah ditarik",
    description:
      "Issue GitHub yang SUDAH ditarik ke hanoman untuk ditriase (record lokal, bukan panggilan langsung ke GitHub — daftarnya sesegar tarikan terakhir). Pull request tidak pernah ikut. Menarik ulang dari GitHub adalah tindakan manusia di dashboard.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        status: enumStr(["new", "accepted", "rejected"], "Status triase di hanoman (bukan status di GitHub — itu `issueState`)."),
        ...PAGE_PARAMS,
      },
      required: ["project"],
    }),
    mode: "read", capability: "support:read", samplePath: "/projects/hanoman/github/issues", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/github/issues`, query: query({ status: s(a.status) }) }),
    shape: (raw, a) => localPage(raw, a, shapeGithubIssue),
  },
  {
    name: "hanoman_lead_decisions_list",
    title: "Jejak keputusan hanoman-lead",
    description:
      "Jejak keputusan hanoman-lead, terbaru dulu. `status`: `berlaku`, `gagal`, `ditimpa`, `dibatalkan`. `confidence: ragu` berarti lead memutuskan tapi memilih opsi yang paling mudah dibatalkan.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        spec: str("Id backlog, mis. `SPEC-482`."),
        status: str("Status keputusan: `berlaku`, `gagal`, `ditimpa`, atau `dibatalkan`."),
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "lead:read", samplePath: "/lead/decisions", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/lead/decisions",
      query: query({ projectId: s(a.project), specId: s(a.spec), status: s(a.status) }),
    }),
    shape: (raw, a) => localPage(raw, a, shapeLeadDecision),
  },
  {
    name: "hanoman_backlog_create",
    title: "Buat backlog",
    description:
      "Buat satu backlog item baru. JANGAN kirim `id`, `stage`, atau `objective`: id diturunkan server (SPEC-nnn berikutnya), stage selalu lahir `brainstorming`, dan objective diturunkan dari payload. Bentuk `payload` ditentukan `source` dan sudah ditegakkan skema tool ini.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Proyek yang tak dikenal menjawab 404."),
        source: enumStr(SOURCE_ENUM, "Asal item: `brief` (fitur), `qa` (temuan bug), `audit` (telusur tanpa perbaikan), `help` (dari tiket), `goal` (kejar satu tujuan tanpa perencanaan)."),
        title: str("Judul singkat.", { minLength: 1 }),
        priority: PRIORITY,
        payload: SPEC_PAYLOAD_ONEOF,
        branchFrom: str("Opsional. Nama branch basis. Branch yang tak ada di repo proyek menjawab 400."),
        dependsOn: { type: "array", description: "Opsional. Id backlog yang harus selesai DAN ter-merge lebih dulu. Harus ada, satu proyek, bukan diri sendiri.", items: { type: "string" } },
      },
      required: ["project", "source", "title", "priority", "payload"],
      allOf: SOURCE_PAYLOAD_ALLOF,
    }),
    mode: "write", capability: "backlog:write", samplePath: "/specs", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/specs",
      body: {
        project: a.project, source: a.source, title: a.title, priority: a.priority, payload: a.payload,
        ...(s(a.branchFrom) ? { branchFrom: a.branchFrom } : {}),
        ...(Array.isArray(a.dependsOn) ? { dependsOn: a.dependsOn } : {}),
      },
    }),
    shape: (raw) => shapeSpecDetail(raw as Record<string, unknown>),
  },
  {
    name: "hanoman_backlog_update",
    title: "Ubah backlog yang belum dimulai",
    description:
      "Ubah judul, prioritas, isi, atau dependency sebuah backlog. Konten hanya bisa diubah selagi item BELUM DIMULAI (stage `brainstorming` dan belum pernah punya sesi); di luar itu server menjawab 409. Cek `editable` di hanoman_backlog_get lebih dulu. Mengubah stage, menghapus item, dan menjalankan integrate sengaja tidak tersedia lewat MCP.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        title: str("Judul baru."),
        priority: PRIORITY,
        payload: SPEC_PAYLOAD_ONEOF,
        dependsOn: { type: "array", description: "Ganti seluruh daftar dependency. `[]` mengosongkan. Ini SATU-SATUNYA field di sini yang masih boleh diubah setelah item dimulai.", items: { type: "string" } },
      },
      required: ["spec"],
    }),
    mode: "write", capability: "backlog:write", samplePath: "/specs/SPEC-1", sampleMethod: "PATCH",
    build: (a) => ({
      method: "PATCH", path: `/specs/${enc(String(a.spec))}`,
      body: {
        ...(s(a.title) ? { title: a.title } : {}),
        ...(s(a.priority) ? { priority: a.priority } : {}),
        ...(a.payload !== undefined ? { payload: a.payload } : {}),
        ...(Array.isArray(a.dependsOn) ? { dependsOn: a.dependsOn } : {}),
      },
    }),
    shape: (raw) => shapeSpecDetail(raw as Record<string, unknown>),
  },
  {
    name: "hanoman_notifications_mark_read",
    title: "Tandai notifikasi terbaca",
    description: "Tandai SELURUH notifikasi sebagai sudah dibaca. Tak ada varian per-item.",
    inputSchema: obj({ properties: {} }),
    mode: "write", capability: "notifications:write", samplePath: "/notifications/read", sampleMethod: "POST",
    build: () => ({ method: "POST", path: "/notifications/read", body: {} }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_ask",
    title: "Minta putusan hanoman-lead",
    description:
      "Minta putusan ke hanoman-lead saat menemui persimpangan yang biasanya butuh manusia. Jawabannya terbaca mesin (`decision`, `reason`, `refs`, `confidence`, `action`) dan `refs` hanya memuat rujukan yang benar-benar ada di repo. Panggilan ini melahirkan jejak permanen dan putusannya bisa menggerakkan sesi — pakai hanya saat memang buntu. 409 = lead tak aktif atau proyek belum opt-in: kembali ke perilaku biasa, berhenti dan tunggu manusia.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        question: str("Pertanyaannya, maksimum 8000 karakter."),
        spec: str("Opsional. Id backlog yang bersangkutan."),
        session: str("Opsional. Id sesi yang bersangkutan."),
        options: { type: "array", description: "Opsional. Pilihan yang tersedia, maksimum 20, masing-masing maksimum 2000 karakter. Lead memilih salah satunya.", items: { type: "string" } },
        context: str("Opsional. Konteks pendukung, maksimum 20.000 karakter."),
      },
      required: ["project", "question"],
    }),
    mode: "write", capability: "lead:write", samplePath: "/lead/decisions", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/lead/decisions",
      body: {
        projectId: a.project, question: a.question,
        ...(s(a.spec) ? { specId: a.spec } : {}),
        ...(s(a.session) ? { sessionId: a.session } : {}),
        ...(Array.isArray(a.options) ? { options: a.options } : {}),
        ...(s(a.context) ? { context: a.context } : {}),
      },
    }),
    shape: (raw) => raw,
  },
];
```

- [x] **Step 4: Implementasi `shared/src/mcp.ts` + ekspor**

```ts
// shared/src/mcp.ts
// SPEC-482 · ADR-0099 · permukaan publik katalog MCP.
export * from "./mcp-schema";
export * from "./mcp-shape";
export * from "./mcp-catalog";

import { MCP_TOOLS, type McpToolDef } from "./mcp-catalog";

/**
 * Versi skema tool. Kontraknya:
 *   ADITIF dalam satu versi — menambah tool, menambah parameter OPSIONAL, memperluas deskripsi.
 *   NAIK VERSI — mengganti/menghapus nama tool, menghapus parameter, menjadikan parameter opsional
 *   jadi wajib, atau mengubah bentuk hasil.
 * Ditegakkan test snapshot di `mcp-catalog.test.ts`: perubahan yang memutus klien lama tak bisa
 * lolos tanpa seseorang sengaja memperbarui snapshot DAN angka ini.
 */
export const MCP_TOOL_SCHEMA_VERSION = 1;

export function mcpToolsFor(readOnly: boolean): readonly McpToolDef[] {
  return readOnly ? MCP_TOOLS.filter((t) => t.mode === "read") : MCP_TOOLS;
}

export const MCP_INSTRUCTIONS = [
  `hanoman — orchestrator backlog + dashboard. Skema tool versi ${MCP_TOOL_SCHEMA_VERSION}.`,
  "",
  "Semua tool memanggil REST API hanoman dengan agent token yang dipasang manusia di konfigurasi klien MCP ini. Capability token menentukan apa yang boleh; bila sebuah tool menjawab kurang capability, sebutkan capability persisnya ke manusia — hanya manusia yang bisa menambahkannya di Settings → Akses AI Agent.",
  "",
  "Tool yang MENJALANKAN sesuatu sengaja tidak ada di sini: membuat sesi terminal (menjalankan agen di worktree) dan perintah VPS tidak tersedia lewat MCP, begitu pula merge/rebase, penghapusan backlog, dan perubahan stage.",
  "",
  "Balasan tool dibatasi ukurannya. Tool daftar menerima `page`/`limit`; balasan yang dipotong ditandai `truncated: true` berikut `shown`/`total` — itu batas ukuran, bukan galat.",
].join("\n");
```

Lalu di `shared/src/index.ts`, tambahkan **satu baris** setelah `export * from "./telegram";`:

```ts
export * from "./mcp";
```

- [x] **Step 5: Jalankan test — pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/mcp-catalog.test.ts shared/src/mcp-schema.test.ts shared/src/mcp-shape.test.ts`
Expected: PASS, 12 test di berkas katalog.

- [x] **Step 6: Typecheck shared**

Run: `pnpm --filter ./shared typecheck`
Expected: keluar 0, tanpa keluaran.

- [x] **Step 7: Commit**

```bash
git add shared/src/mcp-catalog.ts shared/src/mcp.ts shared/src/mcp-catalog.test.ts shared/src/index.ts
git commit -m "feat(482): katalog 17 tool MCP + versi skema"
```

---

### Task 4: Kontrak capability — katalog tak bisa memutar gate

**Files:**
- Create: `server/test/mcp-capability.test.ts`

**Interfaces:**
- Consumes: `MCP_TOOLS` (Task 3), `capabilityForRoute` (`server/src/services/agent-capabilities.ts`).
- Produces: — (uji saja)

Ini pengganti **mekanis** untuk janji "jangan ada cara memutar capability". `capabilityForRoute` hanya hidup di server, jadi ujinya harus di sini.

- [x] **Step 1: Tulis test yang gagal**

```ts
// server/test/mcp-capability.test.ts
// SPEC-482 · ADR-0099 · katalog MCP TIDAK boleh menjanjikan capability yang berbeda dari yang
// benar-benar ditegakkan gate `onRequest`. Peta route→capability hidup di server; katalognya di
// shared. Test ini satu-satunya tempat keduanya bertemu — tanpa ini, mengubah salah satu diam-diam
// membuat panel Settings menyuruh manusia mencentang capability yang salah.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@hanoman/shared";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const withApi = (p: string) => `/api${p}`;

describe("kontrak capability katalog MCP", () => {
  it("capability yang dijanjikan katalog == yang ditegakkan capabilityForRoute", () => {
    for (const t of MCP_TOOLS) {
      if (t.capability === null) continue;
      expect(capabilityForRoute(t.sampleMethod, withApi(t.samplePath)), t.name).toBe(t.capability);
    }
  });

  it("tak ada tool yang mendarat di route cookie-only atau route tak dikenal", () => {
    for (const t of MCP_TOOLS) {
      if (t.capability === null) continue;
      const r = capabilityForRoute(t.sampleMethod, withApi(t.samplePath));
      expect(r, t.name).not.toBe("COOKIE_ONLY");
      expect(r, t.name).not.toBeNull();
    }
  });

  it("hanoman_about hanya menyentuh /api/health yang memang GLOBAL_READ", () => {
    expect(capabilityForRoute("GET", "/api/health")).toBe("GLOBAL_READ");
  });

  it("tak ada tool yang bisa menjalankan sesi atau menyentuh VPS", () => {
    for (const t of MCP_TOOLS) {
      expect(t.samplePath, t.name).not.toMatch(/^\/vps/);
      if (t.samplePath.startsWith("/terminal")) expect(t.sampleMethod, t.name).toBe("GET");
    }
    // Kontrol positif: kalau seseorang menambahkannya kelak, peta memang menuntut sessions:write.
    expect(capabilityForRoute("POST", "/api/terminal/sessions")).toBe("sessions:write");
    expect(capabilityForRoute("POST", "/api/vps/1/run")).toBe("vps:write");
  });

  it("tak ada tool yang bisa merge/rebase, menghapus backlog, atau memundurkan stage", () => {
    for (const t of MCP_TOOLS) {
      expect(t.samplePath, t.name).not.toMatch(/integrate/);
      expect(t.sampleMethod, t.name).not.toBe("DELETE");
    }
    const update = MCP_TOOLS.find((t) => t.name === "hanoman_backlog_update")!;
    const body = update.build({ spec: "SPEC-1", title: "x", stage: "objective", confirmDelete: true })?.body as Record<string, unknown>;
    expect(body.stage).toBeUndefined();
    expect(body.confirmDelete).toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH lalu HIJAU**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/mcp-capability.test.ts
```
Expected: pertama kali MERAH bila ada `samplePath` yang salah tulis di katalog — perbaiki **katalognya**, bukan testnya. Sesudah itu PASS, 5 test.

- [x] **Step 3: Commit**

```bash
git add server/test/mcp-capability.test.ts
git commit -m "test(482): kontrak capability katalog MCP vs capabilityForRoute"
```

---

### Task 5: Konfigurasi & redaksi token

**Files:**
- Create: `cli/src/mcp/config.ts`, `cli/src/mcp/redact.ts`
- Test: `cli/test/mcp-config.test.ts`, `cli/test/mcp-redact.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_MAX_BYTES` dari `@hanoman/shared`.
- Produces:
  ```ts
  export type McpConfig = { host: string; token: string; readOnly: boolean; maxBytes: number; problems: string[] };
  export function resolveMcpConfig(argv: string[], env: Record<string, string | undefined>, readTokenFile: () => string | null): McpConfig;
  export function redactToken(text: string, token: string): string;
  ```

- [x] **Step 1: Tulis test yang gagal**

```ts
// cli/test/mcp-redact.test.ts
import { describe, expect, it } from "vitest";
import { redactToken } from "../src/mcp/redact";

describe("redactToken", () => {
  it("mengganti token yang dipakai, di mana pun ia muncul", () => {
    expect(redactToken("gagal auth hnm_agt_deadbeef di /api", "hnm_agt_deadbeef"))
      .toBe("gagal auth «token disembunyikan» di /api");
  });
  it("mengganti token LAIN juga — bentuknya, bukan cuma nilainya", () => {
    expect(redactToken("bocor: hnm_agt_0011aabb", "hnm_agt_zzzz")).toBe("bocor: «token disembunyikan»");
  });
  it("token kosong tak membuat seluruh teks tergantikan", () => {
    expect(redactToken("halo", "")).toBe("halo");
  });
  it("aman untuk token yang memuat karakter regex", () => {
    expect(redactToken("x a.b*c y", "a.b*c")).toBe("x «token disembunyikan» y");
  });
});
```

```ts
// cli/test/mcp-config.test.ts
import { describe, expect, it } from "vitest";
import { resolveMcpConfig } from "../src/mcp/config";

const noFile = () => null;

describe("resolveMcpConfig", () => {
  it("membaca host & token dari env", () => {
    const c = resolveMcpConfig([], { HANOMAN_HOST: "http://localhost:8787", HANOMAN_AGENT_TOKEN: "hnm_agt_x" }, noFile);
    expect(c).toMatchObject({ host: "http://localhost:8787", token: "hnm_agt_x", readOnly: false, problems: [] });
  });

  it("flag --host mengalahkan env", () => {
    const c = resolveMcpConfig(["--host", "https://a.example"], { HANOMAN_HOST: "http://b", HANOMAN_AGENT_TOKEN: "t" }, noFile);
    expect(c.host).toBe("https://a.example");
  });

  it("membuang garis miring di ujung host supaya path tak jadi ganda", () => {
    expect(resolveMcpConfig([], { HANOMAN_HOST: "http://x:8787/", HANOMAN_AGENT_TOKEN: "t" }, noFile).host).toBe("http://x:8787");
  });

  it("token TIDAK PERNAH dari flag — ARGV terbaca ps", () => {
    const c = resolveMcpConfig(["--token", "hnm_agt_rahasia"], { HANOMAN_HOST: "http://x" }, noFile);
    expect(c.token).toBe("");
    expect(c.problems.join(" ")).toContain("HANOMAN_AGENT_TOKEN");
    expect(c.problems.join(" ")).not.toContain("hnm_agt_rahasia");
  });

  it("jatuh ke berkas token bila env kosong", () => {
    const c = resolveMcpConfig([], { HANOMAN_HOST: "http://x" }, () => "  hnm_agt_dariberkas\n");
    expect(c.token).toBe("hnm_agt_dariberkas");
    expect(c.problems).toEqual([]);
  });

  it("host kosong jadi KELUHAN, bukan default diam-diam — token per-instance", () => {
    const c = resolveMcpConfig([], { HANOMAN_AGENT_TOKEN: "t" }, noFile);
    expect(c.host).toBe("");
    expect(c.problems.join(" ")).toContain("HANOMAN_HOST");
  });

  it("host tanpa skema ditolak dengan kalimat, bukan diperbaiki diam-diam", () => {
    const c = resolveMcpConfig([], { HANOMAN_HOST: "localhost:8787", HANOMAN_AGENT_TOKEN: "t" }, noFile);
    expect(c.problems.join(" ")).toMatch(/http:\/\/ atau https:\/\//);
  });

  it("mode baca-saja dari flag maupun env", () => {
    expect(resolveMcpConfig(["--read-only"], { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "t" }, noFile).readOnly).toBe(true);
    expect(resolveMcpConfig([], { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "t", HANOMAN_MCP_READ_ONLY: "1" }, noFile).readOnly).toBe(true);
    expect(resolveMcpConfig([], { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "t", HANOMAN_MCP_READ_ONLY: "0" }, noFile).readOnly).toBe(false);
  });

  it("maxBytes bisa disetel, nilai ngawur jatuh ke default", () => {
    expect(resolveMcpConfig(["--max-bytes", "4096"], { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "t" }, noFile).maxBytes).toBe(4096);
    expect(resolveMcpConfig([], { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "t", HANOMAN_MCP_MAX_BYTES: "abc" }, noFile).maxBytes).toBe(24 * 1024);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-config.test.ts cli/test/mcp-redact.test.ts`
Expected: FAIL — modul belum ada.

- [x] **Step 3: Implementasi**

```ts
// cli/src/mcp/redact.ts
// SPEC-482 · ADR-0099 · satu titik keluar untuk redaksi token. Dipasang di SEMUA teks yang
// meninggalkan proses (hasil tool, pesan galat, stderr) — bukan di tiap call site. SPEC-472
// membuktikan sekali cukup untuk gagal: pesan `execFile` memuat argv, dan argv memuat rahasia.
const MASK = "«token disembunyikan»";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactToken(text: string, token: string): string {
  let out = text;
  if (token.length > 0) out = out.split(token).join(MASK);
  // Bentuknya juga, bukan hanya nilainya: token instance LAIN yang kebetulan lewat tetap rahasia.
  return out.replace(/hnm_agt_[A-Za-z0-9_-]+/g, MASK);
}
```

```ts
// cli/src/mcp/config.ts
// SPEC-482 · ADR-0099 · resolusi konfigurasi `hanoman mcp`. Murni: argv + env + pembaca berkas
// disuntikkan, jadi seluruh percabangan bisa diuji tanpa filesystem.
import { DEFAULT_MAX_BYTES } from "@hanoman/shared";

export type McpConfig = {
  host: string;
  token: string;
  readOnly: boolean;
  maxBytes: number;
  /** Keluhan konfigurasi. Non-kosong = setiap panggilan tool menjawab dengan kalimat ini. */
  problems: string[];
};

const flagValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

export function resolveMcpConfig(
  argv: string[],
  env: Record<string, string | undefined>,
  readTokenFile: () => string | null,
): McpConfig {
  const problems: string[] = [];

  const host = (flagValue(argv, "--host") ?? env.HANOMAN_HOST ?? "").trim().replace(/\/+$/, "");
  if (!host) {
    problems.push(
      "HANOMAN_HOST belum diisi. Instance hanoman harus disebut eksplisit di konfigurasi klien MCP ini — agent token diterbitkan PER-INSTANCE, jadi tak ada default yang aman. Contoh: \"HANOMAN_HOST\": \"http://localhost:8787\".",
    );
  } else if (!/^https?:\/\//.test(host)) {
    problems.push(`HANOMAN_HOST "${host}" tak punya skema. Tulis lengkap dengan http:// atau https://.`);
  }

  // Token TIDAK PERNAH dari flag: seluruh ARGV proses ini terbaca `ps` oleh siapa pun di mesin
  // yang sama (SPEC-402 — prompt sesi hanoman hidup di ARGV, dan itulah cara ia bocor).
  const token = (env.HANOMAN_AGENT_TOKEN ?? readTokenFile() ?? "").trim();
  if (!token) {
    problems.push(
      "HANOMAN_AGENT_TOKEN belum diisi. Buat token di dashboard hanoman → Settings → Akses AI Agent, lalu pasang di blok \"env\" konfigurasi klien MCP ini (bukan sebagai argumen baris perintah).",
    );
  }
  if (argv.includes("--token")) {
    problems.push("Token tak boleh diberikan lewat --token: argumen baris perintah terbaca proses lain di mesin ini. Pakai variabel lingkungan HANOMAN_AGENT_TOKEN.");
  }

  const roFlag = argv.includes("--read-only");
  const roEnv = env.HANOMAN_MCP_READ_ONLY;
  const readOnly = roFlag || roEnv === "1" || roEnv === "true";

  const rawMax = flagValue(argv, "--max-bytes") ?? env.HANOMAN_MCP_MAX_BYTES;
  const parsed = rawMax === undefined ? NaN : Number(rawMax);
  const maxBytes = Number.isFinite(parsed) && parsed >= 512 ? Math.floor(parsed) : DEFAULT_MAX_BYTES;

  return { host, token, readOnly, maxBytes, problems };
}
```

- [x] **Step 4: Jalankan test — pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-config.test.ts cli/test/mcp-redact.test.ts`
Expected: PASS, 13 test.

- [x] **Step 5: Commit**

```bash
git add cli/src/mcp/config.ts cli/src/mcp/redact.ts cli/test/mcp-config.test.ts cli/test/mcp-redact.test.ts
git commit -m "feat(482): konfigurasi hanoman mcp + redaksi token"
```

---

### Task 6: Pemetaan galat yang bisa ditindaklanjuti

**Files:**
- Create: `cli/src/mcp/errors.ts`
- Test: `cli/test/mcp-errors.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  ```ts
  export type ErrorCtx = { host: string; hostAlive: boolean | null; toolName: string; method: string; path: string };
  export function explainHttpError(status: number, body: unknown, ctx: ErrorCtx): string;
  export function explainNetworkError(err: unknown, ctx: { host: string }): string;
  ```

- [x] **Step 1: Tulis test yang gagal**

```ts
// cli/test/mcp-errors.test.ts
import { describe, expect, it } from "vitest";
import { explainHttpError, explainNetworkError } from "../src/mcp/errors";

const ctx = (over: Partial<Parameters<typeof explainHttpError>[2]> = {}) => ({
  host: "http://localhost:8787", hostAlive: true as boolean | null,
  toolName: "hanoman_backlog_search", method: "GET", path: "/specs", ...over,
});

describe("explainNetworkError", () => {
  it("sambungan ditolak → server tak jalan / host salah", () => {
    const msg = explainNetworkError(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }), { host: "http://localhost:8787" });
    expect(msg).toContain("http://localhost:8787");
    expect(msg).toMatch(/belum jalan|tidak menerima/);
    expect(msg).toContain("HANOMAN_HOST");
  });
  it("nama host tak ketemu disebut sebagai salah tulis host", () => {
    const msg = explainNetworkError(Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }), { host: "https://salah.example" });
    expect(msg).toContain("salah.example");
    expect(msg).toMatch(/tak ditemukan|tidak ditemukan/);
  });
});

describe("explainHttpError", () => {
  it("401 saat host HIDUP → salah instance / master switch, bukan 401 telanjang", () => {
    const msg = explainHttpError(401, { error: "unauthorized" }, ctx({ hostAlive: true }));
    expect(msg).toContain("per-instance");
    expect(msg).toContain("Akses AI Agent");
    expect(msg).toContain("http://localhost:8787");
    expect(msg).not.toMatch(/hnm_agt/);
  });

  it("401 saat host TIDAK menjawab health → hostnya yang salah", () => {
    const msg = explainHttpError(401, { error: "unauthorized" }, ctx({ hostAlive: false }));
    expect(msg).toMatch(/bukan instance hanoman|tidak menjawab/);
  });

  it("403 capability menyebut capability PERSIS yang harus ditambahkan manusia", () => {
    const msg = explainHttpError(403, { error: "capability required", need: "backlog:write" }, ctx({ method: "POST" }));
    expect(msg).toContain("backlog:write");
    expect(msg).toContain("Settings");
    expect(msg).toMatch(/manusia/);
  });

  it("403 cookie-only dinyatakan permanen — jangan cari jalan lain", () => {
    const msg = explainHttpError(403, { error: "cookie session required" }, ctx({ path: "/agent-tokens" }));
    expect(msg).toMatch(/tak akan pernah|tidak akan pernah/);
  });

  it("400 zod flatten diterjemahkan per-field, bukan objek mentah", () => {
    const msg = explainHttpError(400, { error: { formErrors: [], fieldErrors: { payload: ["bentuk payload tak cocok dengan source"] } } }, ctx({ method: "POST", path: "/specs" }));
    expect(msg).toContain("payload");
    expect(msg).toContain("bentuk payload tak cocok dengan source");
    expect(msg).not.toContain("fieldErrors");
  });

  it("400 dengan error string diteruskan apa adanya", () => {
    expect(explainHttpError(400, { error: 'branch "x" tidak ada di repo project' }, ctx())).toContain('branch "x" tidak ada');
  });

  it("404 menyebut apa yang dicari", () => {
    expect(explainHttpError(404, { error: 'project "y" tidak ada' }, ctx({ path: "/projects/y" }))).toContain('project "y" tidak ada');
  });

  it("409 pada PATCH backlog menyebut syarat 'belum dimulai'", () => {
    const msg = explainHttpError(409, { error: "backlog item sudah dimulai — tak bisa diedit" }, ctx({ method: "PATCH", path: "/specs/SPEC-1", toolName: "hanoman_backlog_update" }));
    expect(msg).toContain("sudah dimulai");
    expect(msg).toContain("editable");
  });

  it("409 pada lead menyuruh kembali menunggu manusia", () => {
    const msg = explainHttpError(409, { error: "lead tak aktif" }, ctx({ method: "POST", path: "/lead/decisions", toolName: "hanoman_lead_ask" }));
    expect(msg).toMatch(/tunggu manusia|menunggu manusia/);
  });

  it("504 pada lead dinyatakan sudah tercatat & boleh diulang", () => {
    expect(explainHttpError(504, {}, ctx({ method: "POST", path: "/lead/decisions", toolName: "hanoman_lead_ask" }))).toMatch(/batas waktu/);
  });

  it("503 pada lead menyebut antre & Retry-After", () => {
    expect(explainHttpError(503, { error: "lead sibuk" }, ctx({ method: "POST", path: "/lead/decisions", toolName: "hanoman_lead_ask" }))).toMatch(/antre|sibuk/);
  });

  it("status lain menyimpan EKOR body, dibatasi 500 char", () => {
    const msg = explainHttpError(500, "x".repeat(4000) + "SEBAB-SEBENARNYA", ctx());
    expect(msg).toContain("SEBAB-SEBENARNYA");
    expect(msg.length).toBeLessThan(900);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-errors.test.ts`
Expected: FAIL — modul belum ada.

- [x] **Step 3: Implementasi**

```ts
// cli/src/mcp/errors.ts
// SPEC-482 · ADR-0099 · galat sebagai kalimat yang bisa ditindaklanjuti, bukan dump HTTP.
//
// Pelajaran SPEC-472: pesan galat yang tak menyebut sebabnya membuat 152 baris jejak identik
// sepanjang 552 char dengan nol informasi. Yang menyelamatkan bukan lebih banyak byte melainkan
// menyebut PERSIS apa yang harus diubah dan SIAPA yang bisa mengubahnya.
export type ErrorCtx = {
  host: string;
  /** Hasil probe `/api/health`. `null` = belum sempat diprobe. */
  hostAlive: boolean | null;
  toolName: string;
  method: string;
  path: string;
};

const TAIL = 500;
const tail = (s: string) => (s.length <= TAIL ? s : "…" + s.slice(-TAIL));

const errField = (body: unknown): unknown =>
  body !== null && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : undefined;

function flatten(err: unknown): string | null {
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object" && "fieldErrors" in err) {
    const fe = (err as { fieldErrors: Record<string, string[]> }).fieldErrors;
    const parts = Object.entries(fe).map(([k, v]) => `${k}: ${v.join("; ")}`);
    if (parts.length) return parts.join(" · ");
  }
  return null;
}

export function explainNetworkError(err: unknown, ctx: { host: string }): string {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code
    ?? (err as { code?: string })?.code ?? "";
  if (code === "ECONNREFUSED")
    return `Tidak ada hanoman di ${ctx.host} — sambungan tidak diterima. Pastikan \`hanoman start\` sedang jalan di sana, atau perbaiki HANOMAN_HOST di konfigurasi klien MCP ini.`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return `Nama host ${ctx.host} tak ditemukan. Periksa ejaan HANOMAN_HOST di konfigurasi klien MCP ini.`;
  if (code === "ECONNRESET" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT")
    return `Sambungan ke ${ctx.host} putus atau kehabisan waktu. Periksa jaringan dan reverse proxy di depan instance itu.`;
  return `Gagal menghubungi ${ctx.host}: ${tail(String((err as Error)?.message ?? err))}`;
}

export function explainHttpError(status: number, body: unknown, ctx: ErrorCtx): string {
  const raw = errField(body);
  const said = flatten(raw);
  const isLead = ctx.path.startsWith("/lead");

  if (status === 401) {
    return ctx.hostAlive === false
      ? `${ctx.host} tidak menjawab sebagai instance hanoman yang sehat. Periksa HANOMAN_HOST di konfigurasi klien MCP ini — token yang benar pun akan ditolak oleh alamat yang salah.`
      : `${ctx.host} hidup, tapi menolak token yang dipakai. Agent token diterbitkan PER-INSTANCE: token yang dibuat di instance lain SELALU 401 di sini, dan itu bukan bug. Yang perlu diperiksa manusia, berurutan: (1) HANOMAN_HOST menunjuk instance yang menerbitkan tokennya; (2) master switch di Settings → Akses AI Agent menyala; (3) tokennya belum dicabut atau dinonaktifkan.`;
  }

  if (status === 403) {
    const need = (body as { need?: string })?.need;
    if (need)
      return `Token yang dipakai kurang capability \`${need}\`. Ini tak bisa diakali dari sisi agen: MANUSIA harus menambahkan \`${need}\` ke token itu di Settings → Akses AI Agent. Sebutkan capability persis itu saat memintanya.`;
    return `Route ini sengaja hanya untuk sesi manusia yang login — agent token tak akan pernah bisa mengaksesnya, apa pun capability-nya (kelola user, agent token, device token, dan sync). Jangan cari jalan lain; sampaikan ke manusia bila memang perlu.`;
  }

  if (status === 400)
    return said
      ? `Permintaan ditolak: ${said}`
      : `Permintaan ditolak (400) oleh ${ctx.method} ${ctx.path}. ${tail(JSON.stringify(body ?? ""))}`;

  if (status === 404)
    return said ? `Tidak ditemukan: ${said}` : `Tidak ditemukan: ${ctx.method} ${ctx.path}.`;

  if (status === 409) {
    if (isLead)
      return `hanoman-lead tidak aktif untuk permintaan ini (lead mati, dijeda, atau proyeknya belum opt-in). Kembali ke perilaku biasa: berhenti dan tunggu manusia. ${said ?? ""}`.trim();
    if (ctx.toolName === "hanoman_backlog_update")
      return `${said ?? "Backlog item sudah dimulai"} — konten hanya bisa diubah selagi item belum dimulai (stage \`brainstorming\` dan belum pernah punya sesi). Cek field \`editable\` lewat hanoman_backlog_get sebelum mencoba lagi.`;
    return said ? `Bentrok: ${said}` : `Bentrok (409) pada ${ctx.method} ${ctx.path}.`;
  }

  if (status === 422)
    return said ? `Ditolak: ${said}` : `Ditolak (422) pada ${ctx.method} ${ctx.path}.`;

  if (status === 503 && isLead)
    return `hanoman-lead sedang penuh dan permintaan ini masuk antre lalu ditolak. Ini penolakan sementara — boleh diulang beberapa saat lagi. ${said ?? ""}`.trim();

  if (status === 504 && isLead)
    return `hanoman-lead tak berhasil memutuskan dalam batas waktunya. Kegagalannya sudah tercatat di jejak dan operator sudah dinotifikasi — jangan mengulang terus-menerus; lanjutkan tanpa putusan atau tunggu manusia.`;

  return `${ctx.method} ${ctx.path} menjawab ${status}. ${said ?? tail(typeof body === "string" ? body : JSON.stringify(body ?? ""))}`;
}
```

- [x] **Step 4: Jalankan test — pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-errors.test.ts`
Expected: PASS, 13 test.

- [x] **Step 5: Commit**

```bash
git add cli/src/mcp/errors.ts cli/test/mcp-errors.test.ts
git commit -m "feat(482): pemetaan galat MCP jadi kalimat yang bisa ditindaklanjuti"
```

---

### Task 7: Klien HTTP + probe `/api/health`

**Files:**
- Create: `cli/src/mcp/client.ts`
- Test: `cli/test/mcp-client.test.ts`

**Interfaces:**
- Consumes: Task 5 (`McpConfig`), Task 6 (`explainHttpError`, `explainNetworkError`), `McpRequest` dari `@hanoman/shared`.
- Produces:
  ```ts
  export type CallResult = { ok: true; body: unknown } | { ok: false; message: string };
  export type Caller = (req: McpRequest, toolName: string) => Promise<CallResult>;
  export function createCaller(cfg: McpConfig, fetchImpl: typeof fetch): Caller;
  ```

- [x] **Step 1: Tulis test yang gagal**

```ts
// cli/test/mcp-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { createCaller } from "../src/mcp/client";

const cfg = { host: "http://h:8787", token: "hnm_agt_secret", readOnly: false, maxBytes: 24576, problems: [] };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createCaller", () => {
  it("memasang Bearer dan merakit URL + query", async () => {
    const f = vi.fn(async () => json(200, { items: [] }));
    await createCaller(cfg, f as unknown as typeof fetch)({ method: "GET", path: "/specs", query: { project: "a b", startable: "true" } }, "t");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://h:8787/api/specs?project=a+b&startable=true");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hnm_agt_secret");
  });

  it("POST mengirim body JSON dengan content-type", async () => {
    const f = vi.fn(async () => json(201, { id: "SPEC-1" }));
    await createCaller(cfg, f as unknown as typeof fetch)({ method: "POST", path: "/specs", body: { a: 1 } }, "t");
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("401 memicu probe /api/health SEKALI, lalu di-cache untuk panggilan berikutnya", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/api/health") ? json(200, { ok: true }) : json(401, { error: "unauthorized" }));
    const call = createCaller(cfg, f as unknown as typeof fetch);
    const a = await call({ method: "GET", path: "/specs" }, "t");
    const b = await call({ method: "GET", path: "/projects" }, "t");
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect((a as { message: string }).message).toContain("per-instance");
    expect(f.mock.calls.filter(([u]) => String(u).endsWith("/api/health"))).toHaveLength(1);
  });

  it("401 saat health mati → pesan menyalahkan HOST, bukan token", async () => {
    const f = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/health")) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      return json(401, { error: "unauthorized" });
    });
    const r = await createCaller(cfg, f as unknown as typeof fetch)({ method: "GET", path: "/specs" }, "t");
    expect((r as { message: string }).message).toMatch(/HANOMAN_HOST/);
  });

  it("konfigurasi bermasalah → tak ada panggilan jaringan sama sekali, keluhannya yang dikembalikan", async () => {
    const f = vi.fn(async () => json(200, {}));
    const r = await createCaller({ ...cfg, token: "", problems: ["HANOMAN_AGENT_TOKEN belum diisi."] }, f as unknown as typeof fetch)({ method: "GET", path: "/specs" }, "t");
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toContain("HANOMAN_AGENT_TOKEN");
    expect(f).not.toHaveBeenCalled();
  });

  it("token tak pernah bocor ke pesan galat", async () => {
    const f = vi.fn(async () => json(500, "gagal memakai hnm_agt_secret"));
    const r = await createCaller(cfg, f as unknown as typeof fetch)({ method: "GET", path: "/specs" }, "t");
    expect((r as { message: string }).message).not.toContain("hnm_agt_secret");
    expect((r as { message: string }).message).toContain("«token disembunyikan»");
  });

  it("balasan bukan JSON tetap jadi kalimat, bukan lemparan", async () => {
    const f = vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    const r = await createCaller(cfg, f as unknown as typeof fetch)({ method: "GET", path: "/specs" }, "t");
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toContain("502");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-client.test.ts`
Expected: FAIL — modul belum ada.

- [x] **Step 3: Implementasi**

```ts
// cli/src/mcp/client.ts
// SPEC-482 · ADR-0099 · klien HTTP tunggal untuk seluruh tool MCP. Ia sengaja TIDAK tahu apa-apa
// soal katalog: yang diterimanya sudah berupa `McpRequest` hasil `build()`.
import type { McpRequest } from "@hanoman/shared";
import type { McpConfig } from "./config";
import { explainHttpError, explainNetworkError } from "./errors";
import { redactToken } from "./redact";

export type CallResult = { ok: true; body: unknown } | { ok: false; message: string };
export type Caller = (req: McpRequest, toolName: string) => Promise<CallResult>;

export function createCaller(cfg: McpConfig, fetchImpl: typeof fetch): Caller {
  // Probe `/api/health` (endpoint PUBLIK, tanpa auth) dijalankan SEKALI saat 401 pertama. Ia
  // satu-satunya yang bisa membedakan "host salah" dari "token salah" — keduanya tampak identik
  // sebagai 401 telanjang, dan menebaknya salah menyuruh manusia memeriksa hal yang keliru.
  let hostAlive: boolean | null = null;
  const mask = (s: string) => redactToken(s, cfg.token);

  const probe = async (): Promise<boolean> => {
    if (hostAlive !== null) return hostAlive;
    try {
      const r = await fetchImpl(`${cfg.host}/api/health`, { method: "GET" });
      hostAlive = r.ok;
    } catch { hostAlive = false; }
    return hostAlive;
  };

  return async (req, toolName) => {
    if (cfg.problems.length)
      return { ok: false, message: `Konfigurasi MCP hanoman belum lengkap:\n- ${cfg.problems.join("\n- ")}` };

    const qs = req.query && Object.keys(req.query).length ? `?${new URLSearchParams(req.query).toString()}` : "";
    const url = `${cfg.host}/api${req.path}${qs}`;
    const init: RequestInit = {
      method: req.method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/json",
        ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
    };

    let res: Response;
    try { res = await fetchImpl(url, init); }
    catch (e) { return { ok: false, message: mask(explainNetworkError(e, { host: cfg.host })) }; }

    const text = await res.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* biarkan sebagai teks */ }

    if (res.ok) return { ok: true, body };

    if (res.status === 401) await probe();
    return {
      ok: false,
      message: mask(explainHttpError(res.status, body, {
        host: cfg.host, hostAlive, toolName, method: req.method, path: req.path,
      })),
    };
  };
}
```

- [x] **Step 4: Jalankan test — pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-client.test.ts`
Expected: PASS, 7 test.

- [x] **Step 5: Commit**

```bash
git add cli/src/mcp/client.ts cli/test/mcp-client.test.ts
git commit -m "feat(482): klien HTTP MCP + probe health pembeda host vs token"
```

---

### Task 8: Rakit `McpServer` dari katalog

**Files:**
- Create: `cli/src/mcp/server.ts`
- Modify: `cli/package.json` (dependency `@modelcontextprotocol/server`)
- Test: `cli/test/mcp-server.test.ts`

**Interfaces:**
- Consumes: Task 3 (`mcpToolsFor`, `MCP_INSTRUCTIONS`, `MCP_TOOL_SCHEMA_VERSION`, `renderResult`), Task 5 (`McpConfig`, `redactToken`), Task 7 (`Caller`).
- Produces: `export function buildMcpServer(cfg: McpConfig, call: Caller, version: string): McpServer`

Catatan implementasi yang sudah **diverifikasi lewat spike** dan tak boleh ditebak ulang:
`fromJsonSchema(schema)` meneruskan JSON Schema apa adanya ke `tools/list`, memvalidasi argumen
**sebelum** handler jalan, dan mengembalikan `{content:[…], isError:true}` untuk argumen yang tak
sah — termasuk cabang `allOf`/`if`/`then`, sehingga kombinasi `source`+`payload` yang salah ditolak
di sisi klien dan tak pernah menjadi 400 di server.

- [x] **Step 1: Tambahkan dependency**

```bash
pnpm --filter ./cli add @modelcontextprotocol/server@^2.0.0
```
Expected: `cli/package.json` bertambah `"@modelcontextprotocol/server": "^2.0.0"` di `dependencies`.

- [x] **Step 2: Tulis test yang gagal**

```ts
// cli/test/mcp-server.test.ts
import { describe, expect, it, vi } from "vitest";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildMcpServer } from "../src/mcp/server";
import type { CallResult } from "../src/mcp/client";

/** Transport in-memory: `serveStdio` menerima `options.transport`, jadi loop protokol asli diuji. */
class PairedTransport {
  sent: Record<string, unknown>[] = [];
  onmessage?: (m: unknown) => void;
  onclose?: () => void;
  onerror?: (e: Error) => void;
  async start() { /* noop */ }
  async send(m: Record<string, unknown>) { this.sent.push(m); }
  async close() { this.onclose?.(); }
  feed(m: unknown) { this.onmessage?.(m); }
}

const cfg = { host: "http://h", token: "hnm_agt_secret", readOnly: false, maxBytes: 24576, problems: [] };
const tick = () => new Promise((r) => setTimeout(r, 30));

async function boot(over: Partial<typeof cfg> = {}, call = vi.fn(async (): Promise<CallResult> => ({ ok: true, body: { items: [], total: 0, page: 1, pageSize: 20 } }))) {
  const t = new PairedTransport();
  serveStdio(() => buildMcpServer({ ...cfg, ...over }, call, "9.9.9"), { transport: t as never });
  t.feed({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  await tick();
  return { t, call };
}
const reply = (t: PairedTransport, id: number) => t.sent.find((m) => m.id === id) as { result?: any };

describe("buildMcpServer", () => {
  it("initialize membawa instructions yang menyebut versi skema tool", async () => {
    const { t } = await boot();
    expect(reply(t, 1)?.result.instructions).toContain("versi 1");
    expect(reply(t, 1)?.result.serverInfo.name).toBe("hanoman");
  });

  it("tools/list: 17 tool di mode penuh, 13 di baca-saja", async () => {
    const { t } = await boot();
    t.feed({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await tick();
    expect(reply(t, 2)?.result.tools).toHaveLength(17);

    const ro = await boot({ readOnly: true });
    ro.t.feed({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await tick();
    const names = ro.t.sent.find((m) => m.id === 2) as { result: { tools: { name: string }[] } };
    expect(names.result.tools).toHaveLength(13);
    expect(names.result.tools.map((x) => x.name)).not.toContain("hanoman_backlog_create");
  });

  it("tools/call menerjemahkan argumen jadi permintaan REST yang benar", async () => {
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: true, body: { items: [], total: 0, page: 1, pageSize: 20 } }));
    const { t } = await boot({}, call);
    t.feed({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hanoman_backlog_search", arguments: { project: "hanoman", startable: true } } });
    await tick();
    expect(call.mock.calls[0]?.[0]).toMatchObject({ method: "GET", path: "/specs", query: { project: "hanoman", startable: "true" } });
  });

  it("payload yang tak cocok dengan source DITOLAK KLIEN — tak pernah sampai ke REST", async () => {
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: true, body: {} }));
    const { t } = await boot({}, call);
    t.feed({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "hanoman_backlog_create", arguments: {
      project: "p", source: "qa", title: "t", priority: "tinggi",
      payload: { context: "a", outcome: "b", constraints: "c", priority: "tinggi" },
    } } });
    await tick();
    expect(reply(t, 4)?.result.isError).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it("galat REST jadi isError berisi kalimat, bukan lemparan protokol", async () => {
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: false, message: "Token kurang capability `backlog:write`." }));
    const { t } = await boot({}, call);
    t.feed({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "hanoman_backlog_search", arguments: {} } });
    await tick();
    expect(reply(t, 5)?.result.isError).toBe(true);
    expect(reply(t, 5)?.result.content[0].text).toContain("backlog:write");
  });

  it("hasil dipotong pada plafon byte dan ditandai truncated", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `SPEC-${i}`, projectId: "p", title: "x".repeat(120), stage: "planned", priority: "sedang", objective: "o", createdAt: "c", startedAt: null, source: "brief", branchFrom: null, dependsOn: [], blockedBy: [], baseSha: null }));
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: true, body: { items: many, total: 300, page: 1, pageSize: 300 } }));
    const { t } = await boot({ maxBytes: 3000 }, call);
    t.feed({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "hanoman_backlog_search", arguments: {} } });
    await tick();
    const text = reply(t, 6)?.result.content[0].text as string;
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(JSON.parse(text).truncated).toBe(true);
  });

  it("hanoman_about menyebut host, mode, versi skema — dan TIDAK menyebut token", async () => {
    const { t } = await boot();
    t.feed({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "hanoman_about", arguments: {} } });
    await tick();
    const text = reply(t, 7)?.result.content[0].text as string;
    const about = JSON.parse(text) as Record<string, unknown>;
    expect(about).toMatchObject({ host: "http://h", mode: "baca-tulis", toolSchemaVersion: 1, hanomanCli: "9.9.9" });
    expect(text).not.toContain("hnm_agt_secret");
    expect(JSON.stringify(about)).not.toMatch(/token/i);
  });

  it("hanoman_about tetap menjawab meski konfigurasi bermasalah, dan menyebut keluhannya", async () => {
    const { t } = await boot({ token: "", problems: ["HANOMAN_AGENT_TOKEN belum diisi."] });
    t.feed({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "hanoman_about", arguments: {} } });
    await tick();
    expect(reply(t, 8)?.result.content[0].text).toContain("HANOMAN_AGENT_TOKEN belum diisi");
  });

  it("token tak pernah lolos ke hasil tool", async () => {
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: true, body: { bocor: "hnm_agt_secret" } }));
    const { t } = await boot({}, call);
    t.feed({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "hanoman_ticket_get", arguments: { ticket: "t1" } } });
    await tick();
    expect(reply(t, 9)?.result.content[0].text).not.toContain("hnm_agt_secret");
  });
});
```

- [x] **Step 3: Jalankan test — pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-server.test.ts`
Expected: FAIL — `Failed to resolve import "../src/mcp/server"`.

- [x] **Step 4: Implementasi**

```ts
// cli/src/mcp/server.ts
// SPEC-482 · ADR-0099 · merakit McpServer dari katalog. Berkas ini sengaja tipis: seluruh
// pengetahuan produk ada di katalog (`@hanoman/shared`), seluruh pengetahuan jaringan ada di
// `client.ts`. Yang tersisa di sini hanya perekatan protokol.
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { MCP_INSTRUCTIONS, MCP_TOOL_SCHEMA_VERSION, mcpToolsFor, renderResult } from "@hanoman/shared";
import type { McpConfig } from "./config";
import type { Caller } from "./client";
import { redactToken } from "./redact";

export function buildMcpServer(cfg: McpConfig, call: Caller, cliVersion: string): McpServer {
  const server = new McpServer({ name: "hanoman", version: cliVersion }, { instructions: MCP_INSTRUCTIONS });
  const tools = mcpToolsFor(cfg.readOnly);
  const mask = (s: string) => redactToken(s, cfg.token);
  const text = (s: string, isError = false) => ({ content: [{ type: "text" as const, text: mask(s) }], ...(isError ? { isError: true } : {}) });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        // Capability disebut di deskripsi supaya 403 bisa diantisipasi agen SEBELUM memanggil.
        description: tool.capability
          ? `${tool.description}\n\nButuh capability \`${tool.capability}\` pada agent token.`
          : tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema as never),
      },
      async (args: Record<string, unknown>) => {
        if (tool.name === "hanoman_about") {
          return text(renderResult({
            host: cfg.host || "(belum diisi)",
            mode: cfg.readOnly ? "baca-saja" : "baca-tulis",
            toolSchemaVersion: MCP_TOOL_SCHEMA_VERSION,
            hanomanCli: cliVersion,
            tools: tools.map((t) => ({ name: t.name, mode: t.mode, capability: t.capability })),
            // Keluhan konfigurasi ikut di sini supaya manusia punya satu tempat untuk melihat
            // kenapa semua tool lain menolak — klien MCP menyembunyikan stderr.
            problems: cfg.problems,
          }, cfg.maxBytes));
        }

        const req = tool.build(args);
        if (!req) return text(`Tool ${tool.name} tak punya panggilan REST.`, true);

        const r = await call(req, tool.name);
        if (!r.ok) return text(r.message, true);
        return text(renderResult(tool.shape(r.body, args), cfg.maxBytes));
      },
    );
  }
  return server;
}
```

- [x] **Step 5: Jalankan test — pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-server.test.ts`
Expected: PASS, 9 test.

- [x] **Step 6: Commit**

```bash
git add cli/src/mcp/server.ts cli/test/mcp-server.test.ts cli/package.json pnpm-lock.yaml
git commit -m "feat(482): rakit McpServer hanoman dari katalog tool"
```

---

### Task 9: Perintah `hanoman mcp` + router + bundle

**Files:**
- Create: `cli/src/commands/mcp.ts`
- Modify: `cli/src/router.ts`
- Test: `cli/test/route.test.ts` (tambah kasus), `cli/test/mcp-cmd.test.ts` (baru)

**Interfaces:**
- Consumes: Task 5 (`resolveMcpConfig`), Task 7 (`createCaller`), Task 8 (`buildMcpServer`), `currentVersion()` dari `cli/src/router.ts`.
- Produces: `export default async function mcp(argv: string[], ctx: Ctx): Promise<number>`

- [x] **Step 1: Tulis test yang gagal**

```ts
// cli/test/mcp-cmd.test.ts
import { describe, expect, it, vi } from "vitest";
import { route } from "../src/router";

describe("route mcp", () => {
  it("`hanoman mcp` masuk ke perintah mcp", () => {
    expect(route(["mcp"])).toEqual({ cmd: "mcp", args: [] });
  });
  it("flag ikut diteruskan", () => {
    expect(route(["mcp", "--read-only", "--host", "http://x"]))
      .toEqual({ cmd: "mcp", args: ["--read-only", "--host", "http://x"] });
  });
  it("tetap bukan `start` walaupun ada flag", () => {
    expect(route(["mcp", "--host", "http://x"]).cmd).toBe("mcp");
  });
});

describe("perintah mcp", () => {
  it("TIDAK PERNAH menulis ke stdout — stdout milik JSON-RPC", async () => {
    const mod = await import("../src/commands/mcp");
    const stdout = vi.fn();
    const stderr = vi.fn();
    // Konfigurasi kosong: perintah tetap berdiri (gagal-lunak) dan hanya mengeluh ke stderr.
    const p = mod.default(["--exit-after-boot"], {
      cwd: "/", env: {}, stdout, stderr,
    });
    await p;
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
    expect(stderr.mock.calls.join(" ")).toContain("HANOMAN_HOST");
  });
});
```

Tambahkan juga di `cli/test/route.test.ts` (di dalam `describe` yang sudah ada):

```ts
  it("SPEC-482 · mcp adalah perintahnya sendiri, bukan start ber-flag", () => {
    expect(route(["mcp"]).cmd).toBe("mcp");
    expect(route(["mcp", "--read-only"]).cmd).toBe("mcp");
  });
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-cmd.test.ts cli/test/route.test.ts`
Expected: FAIL — `route(["mcp"])` mengembalikan `{cmd:"unknown"}` dan modul perintah belum ada.

- [x] **Step 3: Implementasi perintah**

```ts
// cli/src/commands/mcp.ts
// SPEC-482 · ADR-0099 · `hanoman mcp` — MCP server stdio yang berperan sebagai klien REST hanoman.
//
// DUA aturan yang mengikat berkas ini:
//  1. stdout milik JSON-RPC. Satu byte diagnostik di sana merusak protokol dan klien MCP akan
//     melaporkannya sebagai "server rusak" tanpa sebab yang bisa dibaca. Semua ke stderr.
//  2. Konfigurasi kurang TIDAK mematikan proses. Klien MCP menyembunyikan stderr, jadi proses yang
//     mati hanya tampak sebagai "server gagal start". Server tetap berdiri, `tools/list` tetap
//     jalan, dan setiap panggilan menjawab dengan kalimat yang menyebut variabel yang harus diisi
//     — `hanoman_about` bahkan menjawab tanpa token sama sekali.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { Ctx } from "../router";
import { currentVersion } from "../router";
import { resolveMcpConfig } from "../mcp/config";
import { createCaller } from "../mcp/client";
import { buildMcpServer } from "../mcp/server";
import { redactToken } from "../mcp/redact";

const tokenFile = (env: Ctx["env"]): string | null => {
  const home = env.HANOMAN_HOME ?? join(homedir(), ".hanoman");
  try { return readFileSync(join(home, "agent-token"), "utf8"); } catch { return null; }
};

export default async function mcp(argv: string[], ctx: Ctx): Promise<number> {
  const cfg = resolveMcpConfig(argv, ctx.env, () => tokenFile(ctx.env));
  const say = (s: string) => ctx.stderr(redactToken(s, cfg.token) + "\n");

  say(`hanoman mcp ${currentVersion()} · host ${cfg.host || "(belum diisi)"} · mode ${cfg.readOnly ? "baca-saja" : "baca-tulis"}`);
  for (const p of cfg.problems) say(`peringatan: ${p}`);

  const call = createCaller(cfg, fetch);
  const handle = serveStdio(() => buildMcpServer(cfg, call, currentVersion()), {
    onerror: (e: unknown) => say(`galat transport: ${String((e as Error)?.message ?? e)}`),
  });

  // Jalur test: berdiri, laporkan, lalu pulang tanpa menahan proses.
  if (argv.includes("--exit-after-boot")) { handle.close(); return 0; }

  // Proses hidup selama klien memegang stdin. Saat klien menutupnya, transport tutup dan kita pulang.
  await new Promise<void>((resolve) => {
    process.stdin.once("close", resolve);
    process.stdin.once("end", resolve);
  });
  return 0;
}
```

- [x] **Step 4: Daftarkan di router**

Di `cli/src/router.ts`, pada `HELP`, sisipkan **setelah** baris `update [--check]`:

```
  mcp [--read-only]                         MCP server stdio untuk klien AI (Claude Code/Desktop,
    [--host <url>] [--max-bytes <n>]        Codex, Cursor, Copilot). Token dari HANOMAN_AGENT_TOKEN.
```

Di `route()`, ubah baris perintah tunggal menjadi (menambahkan `"mcp"`):

```ts
  if (group === "start" || group === "doctor" || group === "update" || group === "mcp")
    return { cmd: group, args: argv.slice(1) };
```

Di `run()`, sisipkan setelah baris `update`:

```ts
  if (cmd === "mcp")    return (await import("./commands/mcp")).default(args, ctx);
```

- [x] **Step 5: Jalankan test — pastikan HIJAU**

Run: `./node_modules/.bin/vitest run --dir cli cli/test/mcp-cmd.test.ts cli/test/route.test.ts cli/test/router.cmd.test.ts`
Expected: PASS.

- [x] **Step 6: Typecheck & build CLI, lalu buktikan bundle-nya bicara MCP**

```bash
pnpm --filter ./cli typecheck
pnpm build:cli
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | HANOMAN_HOST=http://localhost:1 HANOMAN_AGENT_TOKEN=hnm_agt_dummy node cli/dist/hanoman.js mcp 2>/dev/null \
 | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const l=b.trim().split("\n").map(JSON.parse);console.log("serverInfo",l[0].result.serverInfo.name,"| tools",l[1].result.tools.length);})'
```
Expected: `serverInfo hanoman | tools 17`

- [x] **Step 7: Commit**

```bash
git add cli/src/commands/mcp.ts cli/src/router.ts cli/test/mcp-cmd.test.ts cli/test/route.test.ts
git commit -m "feat(482): perintah hanoman mcp + routing + help"
```

---

### Task 10: Panel Settings — pemasangan siap salin

**Files:**
- Create: `src/src/screens/McpPanel.tsx`
- Modify: `src/src/screens/SettingsScreen.tsx`
- Test: `src/test/mcp-panel.test.tsx`

**Interfaces:**
- Consumes: `MCP_TOOLS`, `MCP_TOOL_SCHEMA_VERSION` dari `@hanoman/shared`; komponen `Card`, `Button` dari `../ds`.
- Produces: `export function McpPanel(): JSX.Element`

Snippet dirender untuk empat klien. **Token selalu placeholder** `hnm_agt_…` — panel ini memang tak
punya aksesnya (server hanya menyimpan sha256), dan batasan SPEC-482 melarangnya muncul di contoh
pemasangan.

- [x] **Step 1: Tulis test yang gagal**

```tsx
// src/test/mcp-panel.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { McpPanel } from "../src/screens/McpPanel";
import { MCP_TOOLS } from "@hanoman/shared";

describe("McpPanel", () => {
  it("menampilkan snippet Claude Code dengan host instance ini dan token PLACEHOLDER", () => {
    render(<McpPanel />);
    const snippet = screen.getByTestId("mcp-snippet").textContent ?? "";
    expect(snippet).toContain('"command": "hanoman"');
    expect(snippet).toContain('"args": ["mcp"]');
    expect(snippet).toContain(window.location.origin);
    expect(snippet).toContain("hnm_agt_…");
    expect(snippet).not.toMatch(/hnm_agt_[0-9a-f]{8}/);
  });

  it("berganti klien mengganti bentuk konfigurasinya", async () => {
    render(<McpPanel />);
    await userEvent.click(screen.getByRole("button", { name: /codex/i }));
    const snippet = screen.getByTestId("mcp-snippet").textContent ?? "";
    expect(snippet).toContain("[mcp_servers.hanoman]");
    expect(snippet).toContain('command = "hanoman"');
  });

  it("sakelar baca-saja menambahkan --read-only ke snippet", async () => {
    render(<McpPanel />);
    expect(screen.getByTestId("mcp-snippet").textContent).not.toContain("--read-only");
    await userEvent.click(screen.getByRole("button", { name: /baca-saja/i }));
    expect(screen.getByTestId("mcp-snippet").textContent).toContain("--read-only");
  });

  it("tabel tool bersumber dari katalog, bukan daftar tangan", () => {
    render(<McpPanel />);
    const table = screen.getByTestId("mcp-tools");
    for (const t of MCP_TOOLS) expect(within(table).getByText(t.name)).toBeTruthy();
    expect(within(table).getAllByText("backlog:write").length).toBeGreaterThan(0);
  });

  it("menyebut versi skema tool dan bahwa tool yang mengeksekusi tak ikut", () => {
    render(<McpPanel />);
    expect(screen.getByText(/skema tool versi 1/i)).toBeTruthy();
    expect(screen.getByText(/tidak tersedia lewat MCP/i)).toBeTruthy();
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/mcp-panel.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/screens/McpPanel"`.

- [x] **Step 3: Implementasi panel**

```tsx
// src/src/screens/McpPanel.tsx
// SPEC-482 · ADR-0099 · panduan pemasangan MCP siap salin. Ia duduk di tab "Akses AI Agent" karena
// memasang server dan memberi capability adalah SATU pekerjaan manusia — memisahkannya ke tab lain
// berarti setengah pekerjaan itu tak pernah terlihat.
//
// Tabel tool dirender dari `MCP_TOOLS` (@hanoman/shared) — sumber yang sama dengan runtime. Daftar
// capability yang ditulis tangan di panel adalah daftar yang akan basi.
import React from "react";
import { MCP_TOOLS, MCP_TOOL_SCHEMA_VERSION } from "@hanoman/shared";
import { Card, Button } from "../ds";

type Client = "claude-code" | "claude-desktop" | "codex" | "cursor";

const CLIENTS: { id: Client; label: string; hint: string }[] = [
  { id: "claude-code", label: "Claude Code", hint: "~/.claude.json — atau jalankan perintah `claude mcp add` di bawah." },
  { id: "claude-desktop", label: "Claude Desktop", hint: "Settings → Developer → Edit Config (claude_desktop_config.json)." },
  { id: "codex", label: "Codex", hint: "~/.codex/config.toml" },
  { id: "cursor", label: "Cursor / Copilot", hint: "~/.cursor/mcp.json atau .vscode/mcp.json di project." },
];

function snippetFor(client: Client, host: string, readOnly: boolean): string {
  const args = readOnly ? '["mcp", "--read-only"]' : '["mcp"]';
  const tomlArgs = readOnly ? '["mcp", "--read-only"]' : '["mcp"]';
  const json = `{
  "mcpServers": {
    "hanoman": {
      "command": "hanoman",
      "args": ${args},
      "env": {
        "HANOMAN_HOST": "${host}",
        "HANOMAN_AGENT_TOKEN": "hnm_agt_…"
      }
    }
  }
}`;
  if (client === "codex") {
    return `[mcp_servers.hanoman]
command = "hanoman"
args = ${tomlArgs}
env = { HANOMAN_HOST = "${host}", HANOMAN_AGENT_TOKEN = "hnm_agt_…" }`;
  }
  if (client === "claude-code") {
    return `${json}

# atau, sekali jalan:
claude mcp add hanoman --env HANOMAN_HOST=${host} --env HANOMAN_AGENT_TOKEN=hnm_agt_… -- hanoman mcp${readOnly ? " --read-only" : ""}`;
  }
  if (client === "cursor") return json.replace('"mcpServers"', '"servers"');
  return json;
}

export function McpPanel(): JSX.Element {
  const [client, setClient] = React.useState<Client>("claude-code");
  const [readOnly, setReadOnly] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const host = typeof window === "undefined" ? "http://localhost:8787" : window.location.origin;
  const snippet = snippetFor(client, host, readOnly);
  const active = CLIENTS.find((c) => c.id === client)!;

  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* klipboard tak tersedia — snippet tetap terlihat & bisa diblok manual */ }
  };

  return (
    <>
      <Card eyebrow="mcp" title="MCP server">
        <p>
          Agen AI mana pun yang berbicara MCP bisa memakai hanoman lewat <code>hanoman mcp</code> —
          tanpa pembungkus khusus per-klien. Ia memakai <strong>agent token yang sama</strong> dengan
          REST dan capability yang sama; buat tokennya di kartu di bawah, lalu tempel di konfigurasi
          klien. <strong>Skema tool versi {MCP_TOOL_SCHEMA_VERSION}.</strong>
        </p>
        <p>
          Prasyarat: <code>npm i -g hanoman</code> di mesin tempat klien AI-nya jalan. Host di bawah
          diisi otomatis dengan instance ini — <strong>agent token diterbitkan per-instance</strong>,
          jadi token dari instance lain akan selalu ditolak 401 di sini.
        </p>
        <p>
          Membuat sesi terminal dan perintah VPS <strong>tidak tersedia lewat MCP</strong>, begitu
          pula merge/rebase, penghapusan backlog, dan perubahan stage.
        </p>

        <div role="group" aria-label="Klien MCP">
          {CLIENTS.map((c) => (
            <Button key={c.id} variant={c.id === client ? "primary" : "ghost"} onClick={() => setClient(c.id)}>
              {c.label}
            </Button>
          ))}
          <Button variant={readOnly ? "primary" : "ghost"} onClick={() => setReadOnly((v) => !v)}>
            Mode baca-saja
          </Button>
        </div>

        <p>{active.hint}</p>
        <pre data-testid="mcp-snippet">{snippet}</pre>
        <Button onClick={copy}>{copied ? "Tersalin" : "Salin"}</Button>
      </Card>

      <Card eyebrow="tool" title="Tool yang tersedia">
        <p>
          Centang capability di bawah pada token yang dipakai. Mode baca-saja menyembunyikan seluruh
          tool bertanda <em>tulis</em>.
        </p>
        <table data-testid="mcp-tools">
          <thead><tr><th>Tool</th><th>Mode</th><th>Capability</th></tr></thead>
          <tbody>
            {MCP_TOOLS.map((t) => (
              <tr key={t.name}>
                <td><code>{t.name}</code><br /><small>{t.title}</small></td>
                <td>{t.mode === "read" ? "baca" : "tulis"}</td>
                <td>{t.capability ? <code>{t.capability}</code> : <small>—</small>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
```

- [x] **Step 4: Pasang di SettingsScreen**

Di `src/src/screens/SettingsScreen.tsx`:

1. Tambahkan impor di dekat impor screen lain:
```ts
import { McpPanel } from "./McpPanel";
```
2. Di dalam `AgentAccessPanel`, tepat **sebelum** `</>` penutup (setelah `<Card eyebrow="token" title="Agent tokens">…</Card>`), sisipkan:
```tsx
      <McpPanel />
```
Bila `AgentAccessPanel` mengembalikan satu elemen tanpa fragment, bungkus isinya dengan `<>…</>` lebih dulu.

- [x] **Step 5: Jalankan test — pastikan HIJAU**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/mcp-panel.test.tsx src/test/agent-tokens.test.tsx`
Expected: PASS. Bila `Button` tak menerima `variant="ghost"`, pakai varian yang memang ada di `src/src/ds` — periksa `ds/index.ts` lebih dulu, jangan mengarang prop.

- [x] **Step 6: Typecheck web**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/McpPanel.tsx src/src/screens/SettingsScreen.tsx src/test/mcp-panel.test.tsx
git commit -m "feat(482): panel Settings — pemasangan MCP siap salin + tabel tool"
```

---

### Task 11: ADR-0099 & dokumen yang tersentuh

**Files:**
- Create: `internal/docs/adr/0099-mcp-server-hanoman.md`
- Modify: `internal/docs/README.md`, `internal/docs/adr/README.md`, `docs/agent-integration.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/operations/npm-readme.md`, `AGENTS.md`, `internal/skills/hanoman/SKILL.md`, `internal/docs/frontend/frontend-implementation.md`

**Interfaces:** — (dokumentasi)

- [x] **Step 1: Pastikan nomor ADR belum diklaim di mana pun**

```bash
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git ls-tree -r --name-only "$r" -- internal/docs/adr 2>/dev/null
done | sort -u | grep -c '^internal/docs/adr/0099' || true
for w in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do ls "$w/internal/docs/adr" 2>/dev/null | grep '^0099' || true; done
```
Expected: nol kecocokan. Bila ada, pakai nomor berikutnya yang bebas dan sesuaikan seluruh rujukan.

- [x] **Step 2: Tulis ADR-0099**

`internal/docs/adr/0099-mcp-server-hanoman.md` — struktur mengikuti ADR lain di repo (Status · Konteks · Keputusan · Konsekuensi · Alternatif ditolak · Gotcha). Isi yang **wajib** ada:

- **Status:** Diterima · 2026-08-01 · SPEC-482. Memperluas ADR-0065 (agent token + capability); ADR-0087 (distribusi npm) & ADR-0037 tetap utuh; tak mengamandemen apa pun.
- **Konteks:** permukaan hanoman sudah REST penuh dengan jalur auth agen, tapi setiap klien AI harus menulis ulang pembungkusnya. Bukti konkret: skill `~/.claude/skills/hanoman` = helper `hnm` + `api-reference.md` 240 baris yang separuhnya jebakan (`payload` per `source`, `startable` hanya `true`, `q` tak menyentuh payload, cookie-only selalu 403) — dan dokumen itu sudah **basi**: masih memuat domain `errors` dan source `cross-audit`, dua-duanya dicabut SPEC-384/ADR-0092. Dokumen terpisah bisa basi tanpa suara.
- **Keputusan 1 — bentuk:** MCP server = **subcommand stdio di CLI** (`hanoman mcp`) yang berperan sebagai **klien REST**. Gate `onRequest` tetap satu-satunya otorisasi → tak ada jalur kedua, route cookie-only tak terjangkau **secara struktural**. stdio karena dukungannya merata; satu artefak distribusi karena `hanoman-sdk` sudah membuktikan paket kedua melenceng versinya (ADR-0092).
- **Keputusan 2 — katalog di `shared`:** data murni yang dipakai runtime CLI **dan** panel Settings. Uji kontrak di server mengikat `tool.capability` ke `capabilityForRoute` — pengganti mekanis untuk janji "tak ada cara memutar capability".
- **Keputusan 3 — batas tool:** 17 tool. `POST /terminal/sessions` dan `/vps*` **tidak ikut** (RCE efektif / remote exec); begitu pula `integrate`, `DELETE /specs/:id`, dan `PATCH stage`. Menyediakannya kelak menuntut opt-in eksplisit terpisah + penandaan berbahaya di deskripsi tool.
- **Keputusan 4 — mode baca-saja MENGHILANGKAN tool, bukan menolaknya.** Tool yang tak terlihat tak bisa dicoba.
- **Keputusan 5 — gagal-lunak saat start, jelaskan saat panggil.** Klien MCP menyembunyikan stderr; proses yang mati hanya tampak "server gagal". `hanoman_about` menjawab tanpa token.
- **Keputusan 6 — versi skema tool** `MCP_TOOL_SCHEMA_VERSION = 1`, aditif-dalam-versi, dijaga test snapshot.
- **Konsekuensi:** tanpa endpoint baru, tanpa skema, tanpa migration. Bundle `cli/dist/hanoman.js` bertambah ±750 KB (SDK + ajv + zod v4, dibundel esbuild) — `RUNTIME_DEPS` paket npm **tidak** bertambah.
- **Gotcha wajib (semuanya terukur saat spike, jangan "diperbaiki" tanpa mengulang pengukurannya):**
  1. **stdout milik JSON-RPC.** Satu byte diagnostik ke stdout merusak protokol; klien melaporkannya sebagai "server rusak" tanpa sebab. Perintah `mcp` tak pernah memanggil `ctx.stdout`.
  2. **`allOf`/`if`/`then` di JSON Schema ditegakkan validator SDK**, jadi `source: "qa"` dengan payload brief ditolak **di klien** dan tak pernah jadi 400 — itulah inti "agen dibimbing ke panggilan yang sah alih-alih menemukannya lewat 400".
  3. **401 telanjang tak bisa dibedakan** antara host salah / master switch mati / token dicabut. Probe `/api/health` (PUBLIC, tanpa auth) sekali saat 401 pertama adalah satu-satunya yang memisahkan "host salah" dari "token salah".
  4. **`GET /specs/:id` tidak ada**; `hanoman_backlog_get` memakai `q` yang **substring**, jadi pencocokan `id` persis dilakukan di wrapper — tanpa itu `SPEC-48` mengembalikan `SPEC-480…489`.
  5. **`startable` hanya menerima string `"true"`**; nilai lain diabaikan **senyap** dan mengembalikan seluruh backlog termasuk `done`. Skema tool memakai **boolean** dan `false` **menghilangkan** parameternya.
  6. **Token tak pernah dari flag** — ARGV terbaca `ps`, dan itulah persis cara prompt sesi bocor di SPEC-402.
  7. **Redaksi di satu titik keluar**, bukan per call site: SPEC-472 membuktikan sekali cukup untuk gagal.
  8. **Pemotongan harus tetap JSON sah.** JSON terpotong di tengah dibaca agen sebagai galat parsing, bukan batas ukuran.
- **Alternatif ditolak:** (a) endpoint MCP HTTP di Fastify — menjahit ulang jalur otorisasi, dukungan klien belum merata; (b) paket npm terpisah `hanoman-mcp` — artefak publish kedua yang versinya melenceng (pelajaran ADR-0092); (c) `@modelcontextprotocol/sdk@1` — menarik express, hono, jose, ajv, eventsource untuk sebuah server stdio; (d) tool `errors` — permukaannya sudah tak ada.

- [x] **Step 3: Taut ADR di DUA tempat**

`internal/docs/README.md` — sisipkan sebagai baris **pertama** daftar ADR:
```markdown
- [0099 — MCP server hanoman: subcommand stdio yang jadi klien REST, katalog tool di shared](adr/0099-mcp-server-hanoman.md)
```
`internal/docs/adr/README.md` — tambahkan narasi ADR-0099 mengikuti gaya entri di sana (apa yang diperluas, gotcha-nya).

- [x] **Step 4: Perbarui `docs/agent-integration.md`**

1. Ganti blok kutipan di §awal:
```markdown
> Ada **MCP server resmi** sejak SPEC-482 · ADR-0099 — lihat §8. Agen yang tak berbicara MCP tetap
> bisa memakai HTTP client apa pun. Akses dibuka **oleh manusia** di Settings; tanpa itu, semua
> token ditolak.
```
2. Tambahkan bagian baru `## 8. MCP server (SPEC-482 · ADR-0099)` berisi: satu paragraf apa itu, blok konfigurasi Claude Code/Desktop + Codex, catatan `--read-only`, catatan bahwa tool yang mengeksekusi tidak ikut, dan bahwa capability-nya sama persis dengan tabel §3.
3. Di tabel domain §3, **hapus** baris `errors` bila masih ada dan pastikan `support` berbunyi `/api/tickets*` saja.

- [x] **Step 5: Perbarui dokumen sisanya**

- `internal/docs/architecture/api-contract.md` — tambahkan satu paragraf di bagian pembuka: MCP server adalah **klien** kontrak ini, bukan permukaan kedua; tak ada endpoint yang lahir untuknya; katalog toolnya di `shared/src/mcp-catalog.ts` dan diikat ke `capabilityForRoute` oleh `server/test/mcp-capability.test.ts`.
- `internal/docs/operations/npm-readme.md` — tambahkan `hanoman mcp` ke daftar perintah + contoh konfigurasi klien.
- `AGENTS.md` — tambahkan `mcp` ke blok perintah CLI:
  ```
  hanoman mcp [--read-only]               MCP server stdio (klien: HANOMAN_HOST + HANOMAN_AGENT_TOKEN)
  ```
- `internal/skills/hanoman/SKILL.md` — satu butir di "Aturan Arsitektur" yang menyebut ADR-0099, bentuk stdio-klien-REST, katalog di shared, batas tool, dan gotcha 1–3 di atas.
- `internal/docs/frontend/frontend-implementation.md` — sebut `McpPanel` di tab Akses AI Agent.

- [x] **Step 6: Verifikasi integritas index**

Run: `node cli/dist/hanoman.js docs index --check`
Expected: keluar 0. Bila mengeluh dokumen tak ter-link, tautkan di `internal/docs/README.md`.

- [x] **Step 7: Commit**

```bash
git add internal/docs docs/agent-integration.md AGENTS.md internal/skills
git commit -m "docs(482): ADR-0099 MCP server + perbarui docs yang tersentuh"
```

---

### Task 12: Smoke end-to-end nyata + verifikasi akhir

**Files:** — (verifikasi)

**Interfaces:** Consumes semua task sebelumnya.

- [x] **Step 1: Boot server di DB & port terpisah**

```bash
export SMOKE_HOME="$(mktemp -d)"
export SMOKE_DB="file:$SMOKE_HOME/smoke.db"
pnpm --filter ./server exec prisma migrate deploy 2>&1 | tail -3
DATABASE_URL="$SMOKE_DB" HANOMAN_HOME="$SMOKE_HOME" PORT=8799 node server/dist/server.js &
echo $! > "$SMOKE_HOME/pid"
```
Bila `server/dist/server.js` belum ada: `pnpm --filter ./server build` lebih dulu.
Expected: `curl -s localhost:8799/api/health` → `{"ok":true}`.

- [x] **Step 2: Buat user + agent token lewat sesi cookie**

```bash
curl -s -X POST localhost:8799/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"smoke@x.test","password":"smoke-pass-482"}' -c "$SMOKE_HOME/jar" | head -c 200
curl -s -X POST localhost:8799/api/settings -b "$SMOKE_HOME/jar" -H 'content-type: application/json' \
  -d '{"agentAccessEnabled":true}' | head -c 200
TOKEN=$(curl -s -X POST localhost:8799/api/agent-tokens -b "$SMOKE_HOME/jar" -H 'content-type: application/json' \
  -d '{"name":"smoke-mcp","capabilities":["backlog:read","projects:read"]}' | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>console.log(JSON.parse(b).token))')
test -n "$TOKEN" && echo "token diterbitkan"
```
Bila bentuk body endpoint berbeda dari tebakan di atas, baca `server/src/routes/agent-tokens.ts` dan `settings.ts` lalu sesuaikan — **jangan** melewati langkah ini.

- [x] **Step 3: Jalankan MCP server sungguhan lewat stdio dan panggil tool**

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"hanoman_about","arguments":{}}}' \
 '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"hanoman_backlog_search","arguments":{"startable":true}}}' \
 '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"hanoman_backlog_create","arguments":{"project":"x","source":"brief","title":"t","priority":"tinggi","payload":{"context":"a","outcome":"b","constraints":"c","priority":"tinggi"}}}}' \
 | HANOMAN_HOST=http://localhost:8799 HANOMAN_AGENT_TOKEN="$TOKEN" node cli/dist/hanoman.js mcp 2>"$SMOKE_HOME/err"
```
Expected, diperiksa satu per satu:
- id 2 → **17** tool.
- id 3 → `hanoman_about` menyebut `"host":"http://localhost:8799"`, `"mode":"baca-tulis"`, `"toolSchemaVersion":1`, dan **tak memuat** token.
- id 4 → sukses (200) dengan amplop `{items,total,page,pageSize}`.
- id 5 → `isError: true` dengan pesan yang menyebut **`backlog:write`** — token smoke sengaja tak punya capability itu.
- `$SMOKE_HOME/err` **tak memuat** nilai `$TOKEN`.

- [x] **Step 4: Buktikan instance salah terbaca sebagai instance salah**

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"s","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"hanoman_backlog_search","arguments":{}}}' \
 | HANOMAN_HOST=http://localhost:8799 HANOMAN_AGENT_TOKEN=hnm_agt_tokeninstancelain node cli/dist/hanoman.js mcp 2>/dev/null | tail -1
```
Expected: `isError: true`, pesannya menyebut **per-instance** dan **Settings → Akses AI Agent**, bukan "401".

- [x] **Step 5: Buktikan mode baca-saja menyembunyikan tool tulis**

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"s","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | HANOMAN_HOST=http://localhost:8799 HANOMAN_AGENT_TOKEN="$TOKEN" node cli/dist/hanoman.js mcp --read-only 2>/dev/null | tail -1 \
 | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const t=JSON.parse(b).result.tools;console.log(t.length, t.some(x=>x.name.includes("create")));})'
```
Expected: `13 false`

- [x] **Step 6: Matikan server smoke PER-PID (jangan `pkill -f`)**

```bash
kill "$(cat "$SMOKE_HOME/pid")"
rm -rf "$SMOKE_HOME"
```

- [x] **Step 7: Jalankan seluruh test yang tersentuh**

```bash
env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest run --no-file-parallelism \
  shared/src/mcp-schema.test.ts shared/src/mcp-shape.test.ts shared/src/mcp-catalog.test.ts \
  server/test/mcp-capability.test.ts \
  cli/test/mcp-config.test.ts cli/test/mcp-redact.test.ts cli/test/mcp-errors.test.ts \
  cli/test/mcp-client.test.ts cli/test/mcp-server.test.ts cli/test/mcp-cmd.test.ts \
  cli/test/route.test.ts cli/test/router.cmd.test.ts \
  src/test/mcp-panel.test.tsx src/test/agent-tokens.test.tsx
```
Expected: seluruh berkas HIJAU, dan jumlah test yang **berjalan** > 0 — `--changed` menyalakan `passWithNoTests`, jadi "no test files" **bukan** bukti.

- [x] **Step 8: Typecheck paket yang tersentuh (satu per satu, bukan `-r`)**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./cli typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```
Expected: keempatnya keluar 0.

- [x] **Step 9: Commit akhir & push**

```bash
git add -A
git commit -m "feat(482): MCP server hanoman — 17 tool, mode baca-saja, panduan pemasangan"
git push origin HEAD:refs/heads/hanoman/spec-482
```

---

## Self-Review

**Cakupan spec:** §0 objective 1→Task 9 · 2→Task 3 · 3→Task 1+3 · 4→Task 4+6 · 5→Task 10 · 6→Task 3+8 · 7→Task 3+4 (larangan) · 8→Task 5+7+8 · 9→Task 2+8 · 10→Task 6+7 · 11→Task 3. §2 bentuk→Task 9 · §3 arsitektur→Task 1–3, 5–8 · §3.1 gerbang→Task 4 · §4 katalog→Task 3 · §4.1 jebakan→Task 1+3 · §5 ukuran→Task 2 · §6 galat→Task 6 · §7 token→Task 5+7+8 · §8 konfigurasi→Task 5+9 · §9 versi→Task 3 · §10 Settings→Task 10 · §11 pengujian→Task 12 · §12 docs→Task 11. Tak ada bagian spec tanpa task.

**Konsistensi tipe:** `McpToolDef` (Task 3) memakai `sampleMethod`, dan Task 4 memanggil `t.sampleMethod` — satu nama, dua tempat. `McpConfig` (Task 5) dikonsumsi apa adanya oleh Task 7 & 8. `CallResult` (Task 7) dikonsumsi Task 8. `renderResult`/`paginateLocal`/`shape*` (Task 2) dipakai Task 3 & 8, dan `mcp.ts` me-re-ekspor ketiganya sehingga `@hanoman/shared` adalah satu-satunya jalur impor bagi CLI dan web.
