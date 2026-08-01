# SPEC-484 — Form Custom Agent berbasis katalog: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti tiga field bebas-ketik di form Custom Agent (tools/model/mention) dengan kontrol pilihan bersumber API, dan tambahkan field keempat `runtime` (claude|codex|warisi) yang menyaring roster saat sesi lahir.

**Architecture:** Katalog murni di `@hanoman/shared` (runtime, tool bawaan, model per-runtime, ekspansi `*`); penemuan server MCP di `server/src/services/agent-tool-catalog.ts` yang membaca tiga berkas konfigurasi secara **gagal-terbuka**; satu endpoint baca `GET /api/custom-agents/catalog`; validasi **keras** di `POST`/`PATCH` yang hanya menilai field yang **ada di payload**; penyaring runtime + ekspansi `*` di `agentDefsFor(projectId, agent)` di belakang `registerCustomAgentSource`, sehingga `pty.ts` tetap nol dependensi DB dan `createSession` tetap titik cekik tunggal.

**Tech Stack:** TypeScript strict · zod · Fastify · Prisma 6 (SQLite) · React 18 + Vite · Vitest + Testing Library.

## Global Constraints

- ADR acuan: **ADR-0101** (`internal/docs/adr/0101-form-custom-agent-katalog-runtime.md`), memperluas ADR-0094 & ADR-0074.
- `runtime` **nullable tanpa default**; `null` = "ikut sesi induk" (dipakai sesi claude **dan** codex). Tidak ada backfill.
- Katalog tool bawaan **persis** `DEFAULT_AGENT_TOOLS` — tidak ditambah nama yang belum diukur.
- `"*"` disimpan sebagai `tools: ["*"]`, **di-expand di `agentDefsFor()`**; `runner/src/custom-agents.ts` tak boleh pernah melihat `"*"`.
- `"*"` bercampur nama lain → **400**, bukan digabung.
- Validasi katalog hanya atas field yang **ada di payload**; `model` juga divalidasi bila **hanya `runtime`** yang berubah.
- Semua pembacaan berkas konfigurasi **gagal-terbuka** (hilang/rusak → sumber dilewati, tak pernah 500).
- `runtime` **wajib** masuk `FIELDS.customAgent` di `server/src/services/sync.ts`.
- Migration **ditulis tangan** lalu `pnpm --filter ./server exec prisma migrate deploy` — bukan `migrate dev`.
- Scope verifikasi = berkas yang berubah saja. Test server **wajib** `--no-file-parallelism` **dan** `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (SPEC-479). Test web wajib `env -u NODE_ENV`.
- Prosa UI & komentar kode berbahasa Indonesia, mengikuti berkas sekitarnya.

---

### Task 1: Kontrak katalog murni di `@hanoman/shared`

**Files:**
- Create: `shared/src/agent-catalog.ts`
- Create: `shared/src/agent-catalog.test.ts`
- Modify: `shared/src/index.ts:5` (tambah `export * from "./agent-catalog";`)

**Interfaces:**
- Consumes: `DEFAULT_AGENT_TOOLS`, `MENTION_TOOL` dari `shared/src/custom-agent.ts`; `MODELS`, `CODEX_MODELS` dari `shared/src/entities.ts`.
- Produces:
  - `AGENT_RUNTIMES: readonly ["claude","codex"]`, `type AgentRuntime`, `zAgentRuntime`
  - `ALL_TOOLS = "*"`
  - `type AgentToolInfo = { id: string; label: string; group: "shortcut"|"builtin"|"mcp" }`
  - `BUILTIN_AGENT_TOOLS: AgentToolInfo[]`
  - `ALL_TOOLS_ENTRY: AgentToolInfo`
  - `mcpToolEntry(server: string): AgentToolInfo`
  - `type AgentModelInfo = { id: string; label: string; runtime: AgentRuntime }`
  - `modelsForRuntime(rt: AgentRuntime | null): AgentModelInfo[]`
  - `expandTools(tools: string[] | null, catalogIds: string[]): string[] | null`
  - `type AgentCatalogView = { tools: AgentToolInfo[]; models: AgentModelInfo[]; runtimes: { id: AgentRuntime; label: string }[] }`

- [x] **Step 1: Tulis test yang gagal**

Create `shared/src/agent-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AGENT_RUNTIMES, ALL_TOOLS, ALL_TOOLS_ENTRY, BUILTIN_AGENT_TOOLS, mcpToolEntry,
  modelsForRuntime, expandTools, DEFAULT_AGENT_TOOLS, resolveTools, MENTION_TOOL,
} from "./index";

describe("AGENT_RUNTIMES", () => {
  it("hanya dua mesin sesi, urut claude → codex", () => {
    expect(AGENT_RUNTIMES).toEqual(["claude", "codex"]);
  });
});

describe("BUILTIN_AGENT_TOOLS", () => {
  // ADR-0101 keputusan 3 · katalog bawaan PERSIS DEFAULT_AGENT_TOOLS, bukan daftar kedua.
  // Nama yang belum diukur DIBUANG claude senyap (ADR-0094 M4) — menawarkannya berarti
  // menawarkan pilihan yang tidak melakukan apa-apa.
  it("persis DEFAULT_AGENT_TOOLS, tanpa Task", () => {
    expect(BUILTIN_AGENT_TOOLS.map((t) => t.id)).toEqual([...DEFAULT_AGENT_TOOLS]);
    expect(BUILTIN_AGENT_TOOLS.map((t) => t.id)).not.toContain(MENTION_TOOL);
  });
});

describe("mcpToolEntry", () => {
  it("membentuk id 'semua tool dari satu server'", () => {
    expect(mcpToolEntry("context7")).toEqual({
      id: "mcp__context7__*", label: "context7 — semua tool", group: "mcp",
    });
  });
});

describe("modelsForRuntime", () => {
  it("claude → hanya MODELS", () => {
    const m = modelsForRuntime("claude");
    expect(m.map((x) => x.id)).toContain("claude-opus-5");
    expect(m.every((x) => x.runtime === "claude")).toBe(true);
  });
  it("codex → hanya CODEX_MODELS", () => {
    const m = modelsForRuntime("codex");
    expect(m.map((x) => x.id)).toContain("gpt-5.6-sol");
    expect(m.every((x) => x.runtime === "codex")).toBe(true);
  });
  it("null (warisi) → GABUNGAN keduanya", () => {
    const ids = modelsForRuntime(null).map((x) => x.id);
    expect(ids).toContain("claude-opus-5");
    expect(ids).toContain("gpt-5.6-sol");
  });
});

describe("expandTools", () => {
  const catalog = ["Read", "Bash", "mcp__context7__*"];
  it("['*'] → seluruh id katalog", () => {
    expect(expandTools([ALL_TOOLS], catalog)).toEqual(catalog);
  });
  it("null tetap null (= pakai DEFAULT_AGENT_TOOLS)", () => {
    expect(expandTools(null, catalog)).toBeNull();
  });
  it("[] tetap [] (= sengaja tanpa tool)", () => {
    expect(expandTools([], catalog)).toEqual([]);
  });
  it("daftar eksplisit diteruskan apa adanya", () => {
    expect(expandTools(["Read"], catalog)).toEqual(["Read"]);
  });
  it("idempoten — hasil ekspansi tak memuat '*' lagi", () => {
    const once = expandTools([ALL_TOOLS], catalog)!;
    expect(expandTools(once, catalog)).toEqual(once);
    expect(once).not.toContain(ALL_TOOLS);
  });
  // GOTCHA ADR-0101: `*` TIDAK boleh diterjemahkan jadi `tools: null`. Agen tanpa `tools`
  // mewarisi SELURUH tool termasuk `Task`, dan lapis 2 anti-loop lenyap tanpa jejak.
  it("sesudah ekspansi, resolveTools TETAP mencabut Task untuk agen daun", () => {
    const tools = expandTools([ALL_TOOLS], [...catalog, MENTION_TOOL])!;
    expect(resolveTools({ tools, mentions: [] })).not.toContain(MENTION_TOOL);
    expect(resolveTools({ tools, mentions: ["lain"] })).toContain(MENTION_TOOL);
  });
});

describe("ALL_TOOLS_ENTRY", () => {
  it("pintasan ber-group sendiri supaya bisa ditaruh paling atas di UI", () => {
    expect(ALL_TOOLS_ENTRY.id).toBe(ALL_TOOLS);
    expect(ALL_TOOLS_ENTRY.group).toBe("shortcut");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/agent-catalog.test.ts`
Expected: FAIL — `Failed to resolve import` / `AGENT_RUNTIMES is not exported`.

- [x] **Step 3: Implementasi minimal**

Create `shared/src/agent-catalog.ts`:

```ts
import { z } from "zod";
import { DEFAULT_AGENT_TOOLS } from "./custom-agent";
import { MODELS, CODEX_MODELS } from "./entities";

// SPEC-484 · ADR-0101 · katalog pilihan form Custom Agent. Nol I/O: dipakai server (validasi +
// ekspansi `*`) dan UI (opsi dropdown) dari SATU sumber. Bagian yang butuh I/O — penemuan server
// MCP dari berkas konfigurasi — hidup di server (`services/agent-tool-catalog.ts`).

/** Mesin sesi (ADR-0074). Di definisi agen ia PENYARING, bukan pemilih proses. */
export const AGENT_RUNTIMES = ["claude", "codex"] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];
export const zAgentRuntime = z.enum(AGENT_RUNTIMES);

export const AGENT_RUNTIME_LABELS: Record<AgentRuntime, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
};

/**
 * Pintasan "semua tools". Disimpan sebagai `tools: ["*"]` — SENGAJA bukan `null`, sebab tiga
 * nilai ini wajib tetap berbeda: `null` = tak diisi (pakai DEFAULT_AGENT_TOOLS) · `[]` = sengaja
 * tanpa tool · `["*"]` = semua tool yang dikenal katalog.
 */
export const ALL_TOOLS = "*";

export type AgentToolInfo = { id: string; label: string; group: "shortcut" | "builtin" | "mcp" };

export const ALL_TOOLS_ENTRY: AgentToolInfo = {
  id: ALL_TOOLS, label: "Semua tools", group: "shortcut",
};

/**
 * ADR-0101 keputusan 3 · katalog bawaan PERSIS `DEFAULT_AGENT_TOOLS`, bukan daftar kedua yang
 * lebih panjang. ADR-0094 M4 mengukur nama tool tak dikenal DIBUANG claude tanpa satu pun pesan,
 * jadi menawarkan nama yang belum diukur berarti menawarkan pilihan yang tidak melakukan apa-apa.
 * `Task` tak pernah di sini: ia diturunkan dari `mentions` (lapis 2 anti-loop).
 */
export const BUILTIN_AGENT_TOOLS: AgentToolInfo[] = DEFAULT_AGENT_TOOLS.map((id) => ({
  id, label: id, group: "builtin" as const,
}));

/**
 * Satu entri per SERVER MCP. Nama tool aslinya hanya bisa diketahui dengan menyambung ke server
 * (= melahirkan proses, arah yang ditolak ADR-0094), sementara claude sendiri mengeja bentuk
 * "semua tool dari satu server" sebagai `mcp__<server>__*`.
 */
export const mcpToolEntry = (server: string): AgentToolInfo => ({
  id: `mcp__${server}__*`, label: `${server} — semua tool`, group: "mcp",
});

export type AgentModelInfo = { id: string; label: string; runtime: AgentRuntime };

/** Model yang sah untuk sebuah runtime. `null` (warisi) → GABUNGAN keduanya. */
export function modelsForRuntime(rt: AgentRuntime | null): AgentModelInfo[] {
  const claude: AgentModelInfo[] = MODELS.map((m) => ({ id: m.id, label: m.label, runtime: "claude" }));
  const codex: AgentModelInfo[] = CODEX_MODELS.map((m) => ({ id: m.id, label: m.label, runtime: "codex" }));
  if (rt === "claude") return claude;
  if (rt === "codex") return codex;
  return [...claude, ...codex];
}

/**
 * `["*"]` → seluruh id katalog; selain itu apa adanya. Idempoten (katalog tak pernah memuat `*`).
 * Dipanggil SEBELUM `resolveTools` — meneruskan `"*"` apa adanya membuat claude membuangnya
 * senyap, sementara menerjemahkannya jadi `null` membuat agen mewarisi SELURUH tool termasuk
 * `Task` dan lapis 2 anti-loop lenyap tanpa jejak (gotcha 5 ADR-0094).
 */
export function expandTools(tools: string[] | null, catalogIds: string[]): string[] | null {
  if (tools === null) return null;
  if (!tools.includes(ALL_TOOLS)) return tools;
  return catalogIds.filter((id) => id !== ALL_TOOLS);
}

export type AgentCatalogView = {
  tools: AgentToolInfo[];
  models: AgentModelInfo[];
  runtimes: { id: AgentRuntime; label: string }[];
};
```

Modify `shared/src/index.ts` — sisipkan setelah baris `export * from "./custom-agent";`:

```ts
export * from "./agent-catalog";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/agent-catalog.test.ts`
Expected: PASS, 12 test.

- [x] **Step 5: Commit**

```bash
git add shared/src/agent-catalog.ts shared/src/agent-catalog.test.ts shared/src/index.ts
git commit -m "feat(484): katalog pilihan custom agent di shared (runtime, tools, model, expand *)"
```

---

### Task 2: Kolom `runtime` di kontrak zod & view

**Files:**
- Modify: `shared/src/custom-agent.ts:28-61` (zCustomAgent, zCreateCustomAgent, CustomAgentView)
- Create: `shared/src/custom-agent-runtime.test.ts`

**Interfaces:**
- Consumes: `zAgentRuntime` (Task 1).
- Produces: `zCreateCustomAgent` menerima `runtime?: AgentRuntime | null`; `CustomAgentView.runtime: AgentRuntime | null`; `CustomAgent.runtime: AgentRuntime | null`; `runtimeOf(v: unknown): AgentRuntime | null`.

- [x] **Step 1: Tulis test yang gagal**

Create `shared/src/custom-agent-runtime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zCreateCustomAgent, zUpdateCustomAgent, runtimeOf } from "./index";

const base = { name: "rev", description: "d", instructions: "i" };

describe("zCreateCustomAgent · runtime", () => {
  it("menerima claude & codex", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "claude" }).success).toBe(true);
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "codex" }).success).toBe(true);
  });
  it("menerima null (= ikut sesi induk) dan absen", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: null }).success).toBe(true);
    expect(zCreateCustomAgent.safeParse(base).success).toBe(true);
  });
  it("MENOLAK nilai di luar AGENT_RUNTIMES", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "gemini" }).success).toBe(false);
  });
});

describe("zUpdateCustomAgent · runtime", () => {
  it("ikut terbawa sebagai field opsional", () => {
    expect(zUpdateCustomAgent.safeParse({ runtime: "codex" }).success).toBe(true);
    expect(zUpdateCustomAgent.safeParse({ runtime: "gemini" }).success).toBe(false);
  });
});

// Kolom ini menyeberang sync dari client versi lain — nilai asing tak boleh MENYARING HABIS
// seluruh roster, jadi ia dibaca defensif seperti kolom Json lain (ADR-0101 keputusan 1).
describe("runtimeOf", () => {
  it("mengembalikan nilai sah apa adanya", () => {
    expect(runtimeOf("claude")).toBe("claude");
    expect(runtimeOf("codex")).toBe("codex");
  });
  it("nilai asing / kosong → null (warisi), bukan dibuang", () => {
    expect(runtimeOf("gemini")).toBeNull();
    expect(runtimeOf(null)).toBeNull();
    expect(runtimeOf(undefined)).toBeNull();
    expect(runtimeOf(7)).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/custom-agent-runtime.test.ts`
Expected: FAIL — `runtimeOf is not a function` dan `runtime: "gemini"` lolos.

- [x] **Step 3: Implementasi minimal**

Di `shared/src/custom-agent.ts`, tambahkan konstanta runtime **di berkas ini**, bukan mengimpornya
dari `agent-catalog.ts`: berkas itu sudah membaca `DEFAULT_AGENT_TOOLS` dari sini, jadi impor
sebaliknya membuat siklus dan `DEFAULT_AGENT_TOOLS` terbaca `undefined` saat modul dievaluasi
(gejalanya `Cannot read properties of undefined (reading 'map')`, bukan galat impor). Sisipkan
setelah komentar kepala berkas:

```ts
export const AGENT_RUNTIMES = ["claude", "codex"] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];
export const zAgentRuntime = z.enum(AGENT_RUNTIMES);
export const AGENT_RUNTIME_LABELS: Record<AgentRuntime, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
};
```

…dan di `shared/src/agent-catalog.ts` ganti barisnya jadi
`import { DEFAULT_AGENT_TOOLS, type AgentRuntime } from "./custom-agent";` (impor SATU ARAH).

Tambahkan field ke `zCustomAgent` (setelah `mentions`):

```ts
  runtime: z.enum(AGENT_RUNTIMES).nullable(),
```

Tambahkan ke `zCreateCustomAgent` (setelah `mentions`):

```ts
  // SPEC-484 · ADR-0101 · PENYARING, bukan pemilih proses. null/absen = ikut sesi induk.
  runtime: z.enum(AGENT_RUNTIMES).nullable().optional(),
```

Tambahkan ke `CustomAgentView` (setelah `mentions: string[];`):

```ts
  runtime: AgentRuntime | null;
```

Tambahkan helper di bawah `toolsOf`:

```ts
/**
 * Kolom ini menyeberang sync dari client versi lain. Nilai asing dibaca sebagai `null` (warisi) —
 * katalog persona tak pernah boleh menyusut habis karena satu string yang tak dikenal.
 */
export function runtimeOf(v: unknown): AgentRuntime | null {
  return typeof v === "string" && (AGENT_RUNTIMES as readonly string[]).includes(v)
    ? (v as AgentRuntime)
    : null;
}
```

`zUpdateCustomAgent` tak perlu disentuh: ia `.omit({name,projectId}).partial()` dari `zCreateCustomAgent`, jadi `runtime` ikut otomatis.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `./node_modules/.bin/vitest run --dir shared shared/src/custom-agent-runtime.test.ts shared/src/agent-catalog.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/custom-agent.ts shared/src/custom-agent-runtime.test.ts
git commit -m "feat(484): kolom runtime di kontrak zod custom agent + runtimeOf defensif"
```

---

### Task 3: Skema Prisma, migration, dan sync

**Files:**
- Modify: `server/prisma/schema.prisma:76-93` (model `CustomAgent`)
- Create: `server/prisma/migrations/20260801230000_custom_agent_runtime/migration.sql`
- Modify: `server/src/services/sync.ts:56` (`FIELDS.customAgent`)
- Modify: `server/test/custom-agent-sync.test.ts`

**Interfaces:**
- Consumes: `runtimeOf` (Task 2).
- Produces: kolom DB `CustomAgent.runtime TEXT NULL`; `FIELDS.customAgent` memuat `"runtime"`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/custom-agent-sync.test.ts` (di dalam `describe("wiring sync entitas customAgent", …)`):

```ts
  // GOTCHA ADR-0101 #1 / ADR-0094 gotcha 7 · kolom yang terlewat di FIELDS menyeberang sebagai
  // DEFAULT PALSU tanpa satu pun error — `upsert` yang tak menyebut kolom nullable tetap berhasil.
  it("runtime ikut FIELDS.customAgent dan menyeberang lewat applyPush", async () => {
    expect(__FIELDS.customAgent).toContain("runtime");
    const id = customAgentId(null, "rt");
    await applyPush("customAgent", id, 0, {
      projectId: null, name: "rt", description: "d", instructions: "i",
      tools: null, model: null, mentions: [], runtime: "codex", enabled: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const row = await prisma.customAgent.findUnique({ where: { id } });
    expect(row?.runtime).toBe("codex");
  });
```

Pastikan berkas mengimpor `__FIELDS`:

```ts
import { SYNCED, snapshot, applyPush, __FIELDS } from "../src/services/sync";
```

(Sesuaikan dengan daftar import yang sudah ada di baris 1–10; tambahkan `__FIELDS` bila belum ada.)

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/custom-agent-sync.test.ts
```
Expected: FAIL — `expected [ … ] to contain 'runtime'`.

- [x] **Step 3: Implementasi minimal**

`server/prisma/schema.prisma` — tambahkan satu baris setelah `mentions Json?`:

```prisma
  runtime      String?  // SPEC-484 · ADR-0101 · penyaring mesin sesi; null = ikut sesi induk
```

Create `server/prisma/migrations/20260801230000_custom_agent_runtime/migration.sql`:

```sql
-- SPEC-484 · ADR-0101 · penyaring mesin sesi per definisi agen.
--
-- NULLABLE TANPA DEFAULT, dan itu yang membuat migration ini satu baris: setiap baris lama tetap
-- NULL = "ikut sesi induk" = perilaku ADR-0094 apa adanya, jadi tak ada backfill dan tak ada satu
-- pun roster yang berubah saat rilis ini mendarat. Larangan SQLite atas
-- `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` (migration SPEC-408) tak berlaku di sini justru karena
-- kolomnya tanpa default — tabel tak perlu diredefinisi.
ALTER TABLE "CustomAgent" ADD COLUMN "runtime" TEXT;
```

`server/src/services/sync.ts:56` — tambahkan `"runtime"` ke `FIELDS.customAgent`:

```ts
  customAgent: ["projectId", "name", "description", "instructions", "tools", "model", "mentions", "runtime", "enabled", "createdAt", "updatedAt"],
```

- [x] **Step 4: Terapkan migration + generate, lalu jalankan test**

```bash
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server exec prisma generate
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/custom-agent-sync.test.ts
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/src/services/sync.ts server/test/custom-agent-sync.test.ts
git commit -m "feat(484): kolom CustomAgent.runtime + migration + FIELDS sync"
```

---

### Task 4: Penemuan server MCP dari berkas konfigurasi

**Files:**
- Create: `server/src/services/agent-tool-catalog.ts`
- Create: `server/test/agent-tool-catalog.test.ts`

**Interfaces:**
- Consumes: `ALL_TOOLS_ENTRY`, `BUILTIN_AGENT_TOOLS`, `mcpToolEntry`, `AgentToolInfo` (Task 1).
- Produces:
  - `mcpServerNames(repoDir?: string | null): string[]`
  - `agentToolCatalog(repoDir?: string | null): AgentToolInfo[]`
  - `agentToolIds(repoDir?: string | null): string[]`

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/agent-tool-catalog.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { mcpServerNames, agentToolCatalog, agentToolIds } from "../src/services/agent-tool-catalog";
import { DEFAULT_AGENT_TOOLS, ALL_TOOLS } from "@hanoman/shared";

let home: string;
let repo: string;
const realHome = process.env.HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hnm-home-"));
  repo = mkdtempSync(join(tmpdir(), "hnm-repo-"));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("mcpServerNames", () => {
  it("membaca mcpServers global dari ~/.claude.json", () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      mcpServers: { context7: {}, gitnexus: {} },
    }));
    expect(mcpServerNames()).toEqual(["context7", "gitnexus"]);
  });

  it("membaca mcpServers per-path dari ~/.claude.json projects[<repoDir>]", () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      mcpServers: { context7: {} },
      projects: { [repo]: { mcpServers: { serena: {} } } },
    }));
    expect(mcpServerNames(repo)).toEqual(["context7", "serena"]);
  });

  it("membaca <repoDir>/.mcp.json", () => {
    writeFileSync(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { playwright: {} } }));
    expect(mcpServerNames(repo)).toEqual(["playwright"]);
  });

  it("membaca nama seksi [mcp_servers.<name>] dari ~/.codex/config.toml", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"),
      `model = "gpt-5.6-sol"\n\n[mcp_servers.zread]\ncommand = "npx"\n\n[mcp_servers.linear]\ncommand = "npx"\n`);
    expect(mcpServerNames()).toEqual(["linear", "zread"]);
  });

  it("dedup lintas sumber & urut deterministik", () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { zread: {}, context7: {} } }));
    writeFileSync(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { context7: {}, alpha: {} } }));
    expect(mcpServerNames(repo)).toEqual(["alpha", "context7", "zread"]);
  });

  // Katalog agen tak pernah boleh menggagalkan apa pun (ADR-0094 keputusan 7) — berkas rusak
  // MELEWATI sumber itu, bukan melempar.
  it("GAGAL-TERBUKA atas JSON rusak & berkas hilang", () => {
    writeFileSync(join(home, ".claude.json"), "{ bukan json");
    writeFileSync(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { ok: {} } }));
    expect(() => mcpServerNames(repo)).not.toThrow();
    expect(mcpServerNames(repo)).toEqual(["ok"]);
    expect(mcpServerNames("/tidak/ada")).toEqual([]);
  });

  it("mengabaikan mcpServers yang bukan objek", () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: ["a", "b"] }));
    expect(mcpServerNames()).toEqual([]);
  });
});

describe("agentToolCatalog", () => {
  it("pintasan '*' paling atas, lalu tool bawaan, lalu MCP", () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { context7: {} } }));
    const ids = agentToolCatalog().map((t) => t.id);
    expect(ids[0]).toBe(ALL_TOOLS);
    expect(ids.slice(1, 1 + DEFAULT_AGENT_TOOLS.length)).toEqual([...DEFAULT_AGENT_TOOLS]);
    expect(ids.at(-1)).toBe("mcp__context7__*");
  });

  it("agentToolIds = id saja, dipakai gerbang validasi & ekspansi '*'", () => {
    expect(agentToolIds()).toEqual(agentToolCatalog().map((t) => t.id));
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/agent-tool-catalog.test.ts
```
Expected: FAIL — `Failed to resolve import "../src/services/agent-tool-catalog"`.

- [x] **Step 3: Implementasi minimal**

Create `server/src/services/agent-tool-catalog.ts`:

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ALL_TOOLS_ENTRY, BUILTIN_AGENT_TOOLS, mcpToolEntry, type AgentToolInfo,
} from "@hanoman/shared";

// SPEC-484 · ADR-0101 keputusan 3 · katalog tool yang benar-benar bisa dipilih di mesin ini.
//
// Nama tool MCP yang SEBENARNYA hanya bisa diketahui dengan menyambung ke servernya — itu berarti
// melahirkan proses dari server hanoman, arah yang ditolak ADR-0094 dan yang pelajarannya sudah
// dibayar mahal di SPEC-448. Yang bisa dibaca tanpa proses adalah nama SERVER-nya, dan claude
// sendiri mengeja bentuk "semua tool dari satu server" sebagai `mcp__<server>__*`.
//
// SEMUA pembacaan GAGAL-TERBUKA: berkas hilang/rusak → sumber itu dilewati. Katalog agen tak
// pernah boleh menggagalkan boot, request, maupun kelahiran sesi (ADR-0094 keputusan 7).

/** `process.env.HOME` dibaca tiap panggilan, bukan sekali di modul — test menukarnya. */
const home = (): string => process.env.HOME || homedir();

const readJson = (path: string): Record<string, unknown> | null => {
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; }
  catch { return null; }
};

/** Kunci objek `mcpServers`. Bentuk lain (array, string, absen) → tak ada nama. */
const serversOf = (node: unknown): string[] => {
  const ms = (node as { mcpServers?: unknown } | null)?.mcpServers;
  if (!ms || typeof ms !== "object" || Array.isArray(ms)) return [];
  return Object.keys(ms as Record<string, unknown>);
};

/** Nama seksi `[mcp_servers.<name>]` di config.toml. Regex, bukan parser TOML — nol dependensi. */
const codexServers = (): string[] => {
  let text: string;
  try { text = readFileSync(join(home(), ".codex", "config.toml"), "utf8"); }
  catch { return []; }
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_.-]+))\]/gm)) {
    const name = m[1] ?? m[2];
    if (name) out.push(name);
  }
  return out;
};

/** Nama server MCP yang terdaftar untuk mesin ini (+ project bila `repoDir` diketahui). */
export function mcpServerNames(repoDir?: string | null): string[] {
  const names: string[] = [];

  const claudeJson = readJson(join(home(), ".claude.json"));
  names.push(...serversOf(claudeJson));
  if (repoDir) {
    const projects = (claudeJson as { projects?: Record<string, unknown> } | null)?.projects;
    if (projects && typeof projects === "object") names.push(...serversOf(projects[repoDir]));
    names.push(...serversOf(readJson(join(repoDir, ".mcp.json"))));
  }
  names.push(...codexServers());

  return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Katalog lengkap: pintasan `*` → tool bawaan → satu entri per server MCP. */
export function agentToolCatalog(repoDir?: string | null): AgentToolInfo[] {
  return [ALL_TOOLS_ENTRY, ...BUILTIN_AGENT_TOOLS, ...mcpServerNames(repoDir).map(mcpToolEntry)];
}

/** Id saja — dipakai gerbang validasi route dan ekspansi `*` saat sesi lahir. */
export const agentToolIds = (repoDir?: string | null): string[] =>
  agentToolCatalog(repoDir).map((t) => t.id);
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/agent-tool-catalog.test.ts
```
Expected: PASS, 9 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/agent-tool-catalog.ts server/test/agent-tool-catalog.test.ts
git commit -m "feat(484): penemuan server MCP dari tiga berkas konfigurasi (gagal-terbuka)"
```

---

### Task 5: Endpoint katalog + validasi keras di POST/PATCH

**Files:**
- Modify: `server/src/routes/custom-agents.ts` (seluruh berkas: `view()`, `GET /catalog`, validasi)
- Modify: `shared/src/api.ts:133` (path `customAgentCatalog`)
- Modify: `src/src/api/client.ts:415` (`getCustomAgentCatalog`)
- Modify: `server/test/custom-agents.route.test.ts`

**Interfaces:**
- Consumes: `agentToolIds` (Task 4), `modelsForRuntime`, `ALL_TOOLS`, `AgentCatalogView` (Task 1), `runtimeOf` (Task 2), `resolveRepoDir` dari `server/src/services/local-binding.ts`.
- Produces:
  - `GET /api/custom-agents/catalog?projectId=<id>` → `AgentCatalogView`
  - `view()` mengembalikan `runtime`
  - 400 `{ error, unknownTools: string[] }` · 400 `{ error, model, runtime }`
  - `api.getCustomAgentCatalog(projectId?)` di klien web

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/custom-agents.route.test.ts`:

```ts
describe("GET /api/custom-agents/catalog", () => {
  it("mengembalikan tools, models, dan runtimes", async () => {
    const r = await app.inject({ method: "GET", url: "/api/custom-agents/catalog" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.tools[0].id).toBe("*");
    expect(b.tools.map((t: { id: string }) => t.id)).toContain("Read");
    expect(b.models.map((m: { id: string }) => m.id)).toContain("claude-opus-5");
    expect(b.models.map((m: { id: string }) => m.id)).toContain("gpt-5.6-sol");
    expect(b.runtimes.map((x: { id: string }) => x.id)).toEqual(["claude", "codex"]);
  });

  it("dipetakan ke agents:read (baca, bukan tulis)", () => {
    expect(capabilityForRoute("GET", "/api/custom-agents/catalog")).toBe("agents:read");
  });
});

describe("validasi keras katalog (ADR-0101 keputusan 5)", () => {
  it("menolak 400 tool di luar katalog, menyebut nilainya", async () => {
    const r = await post({ name: "a", description: "d", instructions: "i", tools: ["Read", "read"] });
    expect(r.statusCode).toBe(400);
    expect(r.json().unknownTools).toEqual(["read"]);
  });

  it("menerima tool bawaan", async () => {
    const r = await post({ name: "a", description: "d", instructions: "i", tools: ["Read", "Bash"] });
    expect(r.statusCode).toBe(201);
    expect(r.json().tools).toEqual(["Read", "Bash"]);
  });

  it("menerima ['*'] sebagai satu-satunya entri", async () => {
    const r = await post({ name: "a", description: "d", instructions: "i", tools: ["*"] });
    expect(r.statusCode).toBe(201);
    expect(r.json().tools).toEqual(["*"]);
  });

  // GOTCHA ADR-0101 #3 · "semua tool DAN Read" tak punya makna berbeda dari "semua tool";
  // menerimanya berarti dua representasi untuk satu keadaan.
  it("menolak 400 '*' yang bercampur nama lain", async () => {
    const r = await post({ name: "a", description: "d", instructions: "i", tools: ["*", "Read"] });
    expect(r.statusCode).toBe(400);
  });

  it("menolak 400 model di luar katalog runtime-nya", async () => {
    const r = await post({ name: "a", description: "d", instructions: "i", runtime: "claude", model: "gpt-5.6-sol" });
    expect(r.statusCode).toBe(400);
    expect(r.json().model).toBe("gpt-5.6-sol");
  });

  it("menerima model codex untuk runtime codex", async () => {
    const r = await post({ name: "a", description: "d", instructions: "i", runtime: "codex", model: "gpt-5.6-sol" });
    expect(r.statusCode).toBe(201);
    expect(r.json().runtime).toBe("codex");
  });

  it("runtime null (warisi) menerima model kedua katalog", async () => {
    expect((await post({ name: "a", description: "d", instructions: "i", model: "claude-opus-5" })).statusCode).toBe(201);
    expect((await post({ name: "b", description: "d", instructions: "i", model: "gpt-5.6-sol" })).statusCode).toBe(201);
  });

  it("menolak 400 runtime di luar {claude,codex}", async () => {
    const r = await post({ name: "a", description: "d", instructions: "i", runtime: "gemini" });
    expect(r.statusCode).toBe(400);
  });
});

describe("PATCH · validasi HANYA atas field yang ada di payload", () => {
  // ADR-0101 keputusan 5 klausa kedua: tanpa ini gerbang keras mengunci saklar aktif/nonaktif
  // SETIAP baris warisan yang nilainya tak lagi ada di katalog.
  it("PATCH {enabled} pada baris ber-model asing tetap 200", async () => {
    const id = customAgentId(null, "lawas");
    await prisma.customAgent.create({ data: {
      id, projectId: null, name: "lawas", description: "d", instructions: "i",
      tools: ["ToolYangSudahTiada"] as never, model: "model-yang-sudah-tiada", mentions: [] as never,
    } });
    const r = await app.inject({ method: "PATCH", url: `/api/custom-agents/${id}`, payload: { enabled: false } });
    expect(r.statusCode).toBe(200);
    expect(r.json().enabled).toBe(false);
  });

  // GOTCHA ADR-0101 #4 · runtime EFEKTIF = payload.runtime bila ada, selain itu nilai baris.
  it("PATCH {model} divalidasi terhadap runtime BARIS, bukan gabungan", async () => {
    const id = customAgentId(null, "cdx");
    await prisma.customAgent.create({ data: {
      id, projectId: null, name: "cdx", description: "d", instructions: "i", mentions: [] as never,
      runtime: "codex",
    } });
    const r = await app.inject({ method: "PATCH", url: `/api/custom-agents/${id}`, payload: { model: "claude-opus-5" } });
    expect(r.statusCode).toBe(400);
  });

  it("PATCH {runtime} saja tetap memvalidasi model yang SUDAH tersimpan", async () => {
    const id = customAgentId(null, "sw");
    await prisma.customAgent.create({ data: {
      id, projectId: null, name: "sw", description: "d", instructions: "i", mentions: [] as never,
      model: "claude-opus-5",
    } });
    const r = await app.inject({ method: "PATCH", url: `/api/custom-agents/${id}`, payload: { runtime: "codex" } });
    expect(r.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/custom-agents.route.test.ts
```
Expected: FAIL — `GET /catalog` 404, dan seluruh test validasi keras.

- [ ] **Step 3: Implementasi minimal**

Ganti bagian atas `server/src/routes/custom-agents.ts` (import + `view`) menjadi:

```ts
import type { FastifyInstance } from "fastify";
import {
  zCreateCustomAgent, zUpdateCustomAgent, customAgentId, mentionsOf, toolsOf, runtimeOf,
  modelsForRuntime, ALL_TOOLS, AGENT_RUNTIMES, AGENT_RUNTIME_LABELS,
  type AgentRuntime, type AgentCatalogView,
} from "@hanoman/shared";
import { prisma } from "../db";
import { notifySynced } from "../services/sync-notify";
import { resolveRepoDir } from "../services/local-binding";
import { agentToolCatalog, agentToolIds } from "../services/agent-tool-catalog";
import {
  loadCustomAgents, validateGraph, unknownMentions, type CustomAgentRow,
} from "../services/custom-agents";

const rowsOf = async (): Promise<CustomAgentRow[]> =>
  (await prisma.customAgent.findMany()) as unknown as CustomAgentRow[];

const view = (r: CustomAgentRow, projectId?: string) => ({
  id: r.id, projectId: r.projectId, name: r.name,
  description: r.description, instructions: r.instructions,
  tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
  runtime: runtimeOf(r.runtime),
  enabled: r.enabled,
  ...(projectId ? { inherited: r.projectId === null } : {}),
});

/** repoDir project (bila ada) — sumber `<repoDir>/.mcp.json` & `projects[<repoDir>]`. */
const repoDirOf = async (projectId?: string | null): Promise<string | null> =>
  projectId ? await resolveRepoDir(projectId) : null;

/**
 * SPEC-484 · ADR-0101 keputusan 5 · gerbang katalog. Mengembalikan respons galat atau `null`.
 * Dipanggil HANYA atas field yang ada di payload — `PATCH {enabled}` pada baris warisan tak boleh
 * ikut terkunci oleh nilai yang tak lagi ada di katalog mesin ini.
 */
function toolsProblem(tools: string[] | null | undefined, catalogIds: string[]) {
  if (!tools || tools.length === 0) return null;
  if (tools.includes(ALL_TOOLS) && tools.length > 1) {
    // GOTCHA #3 · "semua tool DAN Read" bukan keadaan yang berbeda dari "semua tool".
    return { error: "pintasan * harus jadi satu-satunya pilihan tools", unknownTools: [] as string[] };
  }
  const unknownTools = tools.filter((t) => !catalogIds.includes(t));
  return unknownTools.length ? { error: "tool tak dikenal di mesin ini", unknownTools } : null;
}

function modelProblem(model: string | null | undefined, runtime: AgentRuntime | null) {
  if (!model) return null;
  const ok = modelsForRuntime(runtime).some((m) => m.id === model);
  return ok ? null : { error: "model tak dikenal untuk runtime ini", model, runtime };
}
```

Tambahkan route katalog **sebelum** `app.post`, di dalam `export default async function (app)`:

```ts
  // SPEC-484 · ADR-0101 · sumber daftar tools/model/runtime. Daftar MENTION sengaja tak di sini:
  // ia sudah hidup di `GET /custom-agents?projectId=` lengkap dengan aturan project-menimpa-global,
  // dan dua sumber untuk satu daftar adalah cara dua daftar mulai berbeda.
  app.get("/custom-agents/catalog", async (req): Promise<AgentCatalogView> => {
    const projectId = (req.query as { projectId?: string }).projectId;
    return {
      tools: agentToolCatalog(await repoDirOf(projectId)),
      models: modelsForRuntime(null),
      runtimes: AGENT_RUNTIMES.map((id) => ({ id, label: AGENT_RUNTIME_LABELS[id] })),
    };
  });
```

Di `app.post`, sisipkan setelah gerbang project & sebelum `const id = …`:

```ts
    const catalogIds = agentToolIds(await repoDirOf(projectId));
    const tp = toolsProblem(p.tools ?? null, catalogIds);
    if (tp) return reply.code(400).send(tp);
    const mp = modelProblem(p.model ?? null, p.runtime ?? null);
    if (mp) return reply.code(400).send(mp);
```

Ubah `candidate` dan `prisma.customAgent.create` di `app.post` agar membawa `runtime`:

```ts
    const candidate: CustomAgentRow = {
      id, projectId, name: p.name, description: p.description, instructions: p.instructions,
      tools: p.tools ?? null, model: p.model ?? null, mentions: p.mentions ?? [],
      runtime: p.runtime ?? null,
      enabled: p.enabled ?? true,
    };
```

```ts
    const row = await prisma.customAgent.create({ data: {
      id, projectId, name: p.name, description: p.description, instructions: p.instructions,
      tools: candidate.tools as never, model: candidate.model,
      mentions: candidate.mentions as never, runtime: candidate.runtime,
      enabled: candidate.enabled,
    } });
```

Di `app.patch`, sisipkan setelah `const before = existing as unknown as CustomAgentRow;`:

```ts
    // GOTCHA ADR-0101 #4 · runtime EFEKTIF, bukan `payload.runtime ?? null`: tanpa ini setiap
    // PATCH {model} pada agen codex divalidasi terhadap GABUNGAN katalog dan lolos untuk model
    // claude. `"runtime" in parsed.data` membedakan "tak dikirim" dari "dikirim null".
    const effRuntime: AgentRuntime | null =
      "runtime" in parsed.data ? (parsed.data.runtime ?? null) : runtimeOf(before.runtime);
    if (parsed.data.tools !== undefined) {
      const tp = toolsProblem(parsed.data.tools, agentToolIds(await repoDirOf(before.projectId)));
      if (tp) return reply.code(400).send(tp);
    }
    // `model` diperiksa juga saat HANYA runtime yang berubah — menukar runtime bisa membuat model
    // tersimpan jadi tak sah, dan menerimanya diam-diam mengembalikan bug yang spec ini tutup.
    if (parsed.data.model !== undefined || "runtime" in parsed.data) {
      const mp = modelProblem(
        parsed.data.model !== undefined ? parsed.data.model : before.model,
        effRuntime,
      );
      if (mp) return reply.code(400).send(mp);
    }
```

Ubah `candidate` & `update` di `app.patch`:

```ts
    const candidate: CustomAgentRow = {
      ...before,
      ...parsed.data,
      mentions: parsed.data.mentions ?? mentionsOf(before.mentions),
      tools: parsed.data.tools !== undefined ? parsed.data.tools : toolsOf(before.tools),
      runtime: effRuntime,
    };
```

```ts
    const row = await prisma.customAgent.update({ where: { id }, data: {
      description: candidate.description, instructions: candidate.instructions,
      tools: candidate.tools as never, model: candidate.model,
      mentions: candidate.mentions as never, runtime: candidate.runtime,
      enabled: candidate.enabled,
    } });
```

Tambahkan `runtime: unknown` ke `CustomAgentRow` di `server/src/services/custom-agents.ts:18-28`:

```ts
  mentions: unknown;
  runtime: unknown;
  enabled: boolean;
```

…dan sertakan di `asCustomAgent`/`toDef` (lihat Task 6; untuk task ini cukup tambahkan field ke tipe agar TypeScript hijau).

`shared/src/api.ts` — tambahkan setelah `customAgents:`:

```ts
  customAgentCatalog: `${API}/custom-agents/catalog`,
```

`src/src/api/client.ts` — tambahkan setelah `listCustomAgents`:

```ts
  getCustomAgentCatalog: (projectId?: string) =>
    j<AgentCatalogView>(paths.customAgentCatalog + qs(projectId ? { projectId } : {})),
```

…dan tambahkan `AgentCatalogView` ke daftar `import type { … } from "@hanoman/shared"` di baris 1.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/custom-agents.route.test.ts
pnpm --filter ./server typecheck
```
Expected: PASS semua; typecheck bersih.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/custom-agents.ts server/src/services/custom-agents.ts shared/src/api.ts src/src/api/client.ts server/test/custom-agents.route.test.ts
git commit -m "feat(484): endpoint katalog custom agent + validasi keras tools/model/runtime"
```

---

### Task 6: Penyaring runtime & ekspansi `*` saat sesi lahir

**Files:**
- Modify: `server/src/services/custom-agents.ts` (cache repoDir, `agentDefsFor(projectId, agent)`)
- Modify: `server/src/services/pty.ts:228-234, 305-307` (tanda tangan sumber + pemanggilan)
- Modify: `server/test/custom-agents.pty.test.ts`
- Modify: `server/test/custom-agents.service.test.ts`

**Interfaces:**
- Consumes: `agentToolIds` (Task 4), `expandTools`, `ALL_TOOLS` (Task 1), `runtimeOf` (Task 2), `Agent` dari `@hanoman/shared`.
- Produces:
  - `type CustomAgentSource = (projectId: string, agent: Agent) => AgentDef[]`
  - `agentDefsFor(projectId: string, agent: Agent): AgentDef[]`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/custom-agents.pty.test.ts`:

```ts
describe("penyaring runtime (SPEC-484 · ADR-0101)", () => {
  const mixed: (AgentDef & { runtime?: "claude" | "codex" | null })[] = [];

  it("sumber menerima agen sesi sebagai argumen KEDUA", () => {
    const seen: string[] = [];
    registerCustomAgentSource((_p, agent) => { seen.push(agent); return []; });
    const s = createSession("p1", cwd, { id: born("ca-rt-1"), agent: "codex", prompt: "halo" });
    expect(s.id).toBeTruthy();
    expect(seen).toContain("codex");
  });

  it("agen ber-runtime codex TIDAK masuk --agents sesi claude", () => {
    registerCustomAgentSource((_p, agent) =>
      agent === "claude"
        ? [{ name: "cl", description: "d", instructions: "i", tools: null, model: null, mentions: [] }]
        : []);
    const s = createSession("p1", cwd, { id: born("ca-rt-2"), agent: "claude", prompt: "halo" });
    expect(existsSync(agentsFilePath(s.id))).toBe(true);
    expect(readFileSync(agentsFilePath(s.id), "utf8")).toContain('"cl"');
  });

  it("katalog kosong untuk agen itu → --agents TIDAK dipasang sama sekali", () => {
    registerCustomAgentSource((_p, agent) =>
      agent === "codex"
        ? [{ name: "cx", description: "d", instructions: "i", tools: null, model: null, mentions: [] }]
        : []);
    const s = createSession("p1", cwd, { id: born("ca-rt-3"), agent: "claude", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });

  it("tools sudah TER-EXPAND saat sampai ke berkas --agents (tak ada '*' di JSON)", () => {
    registerCustomAgentSource(() => [
      { name: "all", description: "d", instructions: "i", tools: ["Read", "Bash"], model: null, mentions: [] },
    ]);
    const s = createSession("p1", cwd, { id: born("ca-rt-4"), agent: "claude", prompt: "halo" });
    const json = readFileSync(agentsFilePath(s.id), "utf8");
    expect(json).not.toContain('"*"');
    expect(json).toContain('"Read"');
  });
});
```

Tambahkan di `server/test/custom-agents.service.test.ts`:

```ts
describe("agentDefsFor · penyaring runtime & ekspansi * (SPEC-484)", () => {
  beforeEach(async () => {
    await prisma.customAgent.deleteMany();
    await prisma.customAgent.create({ data: {
      id: "global:warisi", projectId: null, name: "warisi", description: "d", instructions: "i",
      mentions: [] as never, runtime: null,
    } });
    await prisma.customAgent.create({ data: {
      id: "global:hanya-claude", projectId: null, name: "hanya-claude", description: "d", instructions: "i",
      mentions: [] as never, runtime: "claude",
    } });
    await prisma.customAgent.create({ data: {
      id: "global:hanya-codex", projectId: null, name: "hanya-codex", description: "d", instructions: "i",
      mentions: [] as never, runtime: "codex",
    } });
    await loadCustomAgents();
  });

  it("sesi claude melihat warisi + hanya-claude", () => {
    expect(agentDefsFor("p1", "claude").map((d) => d.name).sort())
      .toEqual(["hanya-claude", "warisi"]);
  });

  it("sesi codex melihat warisi + hanya-codex", () => {
    expect(agentDefsFor("p1", "codex").map((d) => d.name).sort())
      .toEqual(["hanya-codex", "warisi"]);
  });

  it("runtime asing dari sync dibaca sebagai warisi, bukan disaring habis", async () => {
    await prisma.customAgent.update({ where: { id: "global:warisi" }, data: { runtime: "gemini" } });
    await loadCustomAgents();
    expect(agentDefsFor("p1", "claude").map((d) => d.name)).toContain("warisi");
    expect(agentDefsFor("p1", "codex").map((d) => d.name)).toContain("warisi");
  });

  it("tools ['*'] di-EXPAND jadi daftar eksplisit, tak pernah diteruskan apa adanya", async () => {
    await prisma.customAgent.update({ where: { id: "global:warisi" }, data: { tools: ["*"] as never } });
    await loadCustomAgents();
    const def = agentDefsFor("p1", "claude").find((d) => d.name === "warisi")!;
    expect(def.tools).not.toBeNull();
    expect(def.tools).not.toContain("*");
    expect(def.tools).toContain("Read");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/custom-agents.pty.test.ts server/test/custom-agents.service.test.ts
```
Expected: FAIL — `agentDefsFor` menerima 1 argumen; sumber dipanggil tanpa `agent`.

- [ ] **Step 3: Implementasi minimal**

`server/src/services/pty.ts` — ubah tipe & helper (baris ~228–234):

```ts
// SPEC-484 · ADR-0101 · sumber kini menerima AGEN SESI: `runtime` di definisi agen adalah
// PENYARING, dan yang dipakai wajib agen sesi yang sebenarnya (`agentForDefs` di bawah), bukan
// `Setting.agent` — sesi bisa lahir dengan override per-request, dan membaca yang salah mengulang
// bug SPEC-377 dalam bentuk baru.
type CustomAgentSource = (projectId: string, agent: Agent) => AgentDef[];
let customAgentSource: CustomAgentSource = () => [];
export function registerCustomAgentSource(fn: CustomAgentSource): void { customAgentSource = fn; }
const customAgentsFor = (projectId: string, agent: Agent): AgentDef[] => {
  try { return customAgentSource(projectId, agent); } catch { return []; }
};
```

…dan pemanggilannya (baris ~307):

```ts
  const customDefs = opts.command ? [] : customAgentsFor(projectId, agentForDefs);
```

`server/src/services/custom-agents.ts` — ubah menjadi:

```ts
import { prisma } from "../db";
import {
  effectiveAgents, detectCycle, mentionsOf, toolsOf, runtimeOf, expandTools, GLOBAL_SCOPE,
  type CustomAgent, type AgentNode, type Agent,
} from "@hanoman/shared";
import type { AgentDef } from "@hanoman/runner";
import { registerCustomAgentSource } from "./pty";
import { agentToolIds } from "./agent-tool-catalog";
```

Tambahkan `runtime: unknown;` ke `CustomAgentRow` (sudah dilakukan di Task 5) dan `runtime` ke `asCustomAgent`:

```ts
const asCustomAgent = (r: CustomAgentRow): CustomAgent => ({
  id: r.id, projectId: r.projectId, name: r.name,
  description: r.description, instructions: r.instructions,
  tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
  runtime: runtimeOf(r.runtime),
  enabled: r.enabled,
  createdAt: "", updatedAt: "",   // tak dipakai lapis ini
});
```

Tambahkan cache repoDir dan isi di `loadCustomAgents`:

```ts
let cache: CustomAgentRow[] = [];
// repoDir per project untuk sumber MCP ber-scope project (`<repoDir>/.mcp.json`,
// `~/.claude.json` projects[<repoDir>]). Di-cache karena `agentDefsFor` SINKRON — ia dibaca dari
// `createSession`, sementara resolusi binding butuh DB. Di-refresh bersama katalog agen; binding
// yang berubah tanpa mutasi agen paling buruk membuat ekspansi `*` melewatkan server MCP
// ber-scope project sampai mutasi berikutnya.
let repoDirCache = new Map<string, string | null>();

export async function loadCustomAgents(): Promise<void> {
  try {
    cache = (await prisma.customAgent.findMany()) as unknown as CustomAgentRow[];
    const projects = await prisma.project.findMany({ select: { id: true, repoDir: true } });
    const bindings = await prisma.localBinding.findMany({ select: { projectId: true, repoDir: true } });
    const next = new Map<string, string | null>();
    for (const p of projects) next.set(p.id, p.repoDir ?? null);
    for (const b of bindings) next.set(b.projectId, b.repoDir ?? null);
    repoDirCache = next;
  } catch {
    // Katalog agen tak pernah boleh menggagalkan boot maupun kelahiran sesi (ADR-0094 keputusan 7).
    cache = [];
    repoDirCache = new Map();
  }
}
```

Ubah `agentDefsFor`:

```ts
/** SINKRON — dibaca dari titik cekik `createSession`. */
export function agentDefsFor(projectId: string, agent: Agent): AgentDef[] {
  const globals = cache.filter((r) => r.projectId === null).map(asCustomAgent);
  const project = cache.filter((r) => r.projectId === projectId).map(asCustomAgent);
  // SPEC-484 · ADR-0101 keputusan 2 · penyaring: null = ikut sesi induk (dipakai KEDUA mesin).
  const eff = effectiveAgents(globals, project)
    .filter((a) => a.runtime === null || a.runtime === agent);
  // Katalog hanya dihitung bila ada yang benar-benar memakai `*` — pembacaan berkas konfigurasi
  // tak perlu terjadi di setiap kelahiran sesi.
  const needsCatalog = eff.some((a) => (a.tools ?? []).includes("*"));
  const catalogIds = needsCatalog ? agentToolIds(repoDirCache.get(projectId) ?? null) : [];
  return eff.map((a) => ({
    name: a.name, description: a.description, instructions: a.instructions,
    tools: expandTools(a.tools, catalogIds), model: a.model, mentions: a.mentions ?? [],
  }));
}
```

Ubah `toDef` agar konsisten (dipakai test/utility):

```ts
export function toDef(r: CustomAgentRow): AgentDef {
  return {
    name: r.name, description: r.description, instructions: r.instructions,
    tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
  };
}
```

Ubah `installCustomAgents`:

```ts
export async function installCustomAgents(): Promise<void> {
  await loadCustomAgents();
  registerCustomAgentSource((projectId, agent) => agentDefsFor(projectId, agent));
}
```

Ubah pemanggil `agentDefsFor` di `server/test/custom-agents.route.test.ts` yang sudah ada agar meneruskan agen (`agentDefsFor("p1", "claude")`).

Tambahkan `runtime` ke `zCustomAgent`-turunan `CustomAgent` sudah dilakukan di Task 2, jadi `a.runtime` bertipe `AgentRuntime | null`.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --dir server --no-file-parallelism server/test/custom-agents.pty.test.ts server/test/custom-agents.service.test.ts server/test/custom-agents.route.test.ts
pnpm --filter ./server typecheck
```
Expected: PASS semua; typecheck bersih.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/custom-agents.ts server/src/services/pty.ts server/test/custom-agents.pty.test.ts server/test/custom-agents.service.test.ts server/test/custom-agents.route.test.ts
git commit -m "feat(484): penyaring runtime + ekspansi * di agentDefsFor, sumber pty membawa agen sesi"
```

---

### Task 7: Komponen DS `MultiSelect`

**Files:**
- Modify: `src/src/ds/components/forms.tsx` (tambahkan di akhir berkas)
- Modify: `src/src/ds/index.ts:5` (tambahkan `MultiSelect` ke ekspor `./components/forms`)
- Create: `src/test/ds-multiselect.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type MultiOption = { value: string; label: string; group?: string };
  export type MultiSelectProps = {
    options: MultiOption[];
    value: string[];
    onChange: (next: string[]) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    invalidValues?: string[];   // nilai yang tak ada di katalog → chip bertanda
    disabled?: boolean;
    "aria-label"?: string;
  };
  export function MultiSelect(props: MultiSelectProps): JSX.Element;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/ds-multiselect.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiSelect } from "../src/ds";

const options = [
  { value: "Read", label: "Read" },
  { value: "Bash", label: "Bash" },
  { value: "mcp__context7__*", label: "context7 — semua tool", group: "MCP" },
];

const open = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

describe("MultiSelect", () => {
  it("tertutup secara default; membuka menampilkan opsi ber-role option", () => {
    render(<MultiSelect aria-label="Tools" options={options} value={[]} onChange={() => {}} />);
    expect(screen.queryByRole("option")).toBeNull();
    open("Tools");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("pencarian menyaring opsi", () => {
    render(<MultiSelect aria-label="Tools" options={options} value={[]} onChange={() => {}} />);
    open("Tools");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "context" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("context7");
  });

  it("memilih opsi memanggil onChange dengan nilai yang bertambah", () => {
    const onChange = vi.fn();
    render(<MultiSelect aria-label="Tools" options={options} value={["Read"]} onChange={onChange} />);
    open("Tools");
    fireEvent.click(screen.getByRole("option", { name: /Bash/ }));
    expect(onChange).toHaveBeenCalledWith(["Read", "Bash"]);
  });

  it("memilih ulang opsi terpilih akan MENCABUTNYA", () => {
    const onChange = vi.fn();
    render(<MultiSelect aria-label="Tools" options={options} value={["Read"]} onChange={onChange} />);
    open("Tools");
    fireEvent.click(screen.getByRole("option", { name: /Read/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("chip menampilkan yang terpilih; tombol × mencabutnya", () => {
    const onChange = vi.fn();
    render(<MultiSelect aria-label="Tools" options={options} value={["Read", "Bash"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus Read" }));
    expect(onChange).toHaveBeenCalledWith(["Bash"]);
  });

  it("nilai di luar katalog dirender sebagai chip BERTANDA, bukan hilang", () => {
    render(<MultiSelect aria-label="Tools" options={options} value={["Read", "ToolHilang"]}
      invalidValues={["ToolHilang"]} onChange={() => {}} />);
    const chip = screen.getByTestId("chip-ToolHilang");
    expect(chip.textContent).toContain("ToolHilang");
    expect(chip.getAttribute("title")).toMatch(/tak ada di katalog/i);
  });

  it("pencarian tanpa hasil menampilkan emptyText", () => {
    render(<MultiSelect aria-label="Tools" options={options} value={[]} onChange={() => {}}
      emptyText="Tak ada yang cocok." />);
    open("Tools");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("Tak ada yang cocok.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/ds-multiselect.test.tsx`
Expected: FAIL — `MultiSelect is not exported`.

- [ ] **Step 3: Implementasi minimal**

Tambahkan di akhir `src/src/ds/components/forms.tsx`:

```tsx
// SPEC-484 · ADR-0101 · pilihan jamak ber-pencarian + chip. SENGAJA INLINE, bukan portal/popover:
// portal menuntut outside-click & focus-trap, dan opsinya harus bisa diuji lewat `getByRole`
// alih-alih menembak <span> di dalam <label> seperti Checkbox/Switch DS (jebakan SPEC-299/360/447).
export type MultiOption = { value: string; label: string; group?: string };
export type MultiSelectProps = {
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Nilai yang TAK ada di katalog — dirender sebagai chip bertanda, bukan dibuang senyap. */
  invalidValues?: string[];
  disabled?: boolean;
  style?: React.CSSProperties;
} & Record<string, any>;

export function MultiSelect({
  options, value, onChange, placeholder = "Pilih…", searchPlaceholder = "Cari…",
  emptyText = "Tak ada yang cocok.", invalidValues = [], disabled = false, style = {}, ...rest
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const label = (rest["aria-label"] as string) ?? placeholder;
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => `${o.label} ${o.value} ${o.group ?? ""}`.toLowerCase().includes(needle))
    : options;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, ...style } },
    value.length > 0 && React.createElement("div",
      { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
      value.map((v) => {
        const bad = invalidValues.includes(v);
        return React.createElement("span", {
          key: v, "data-testid": `chip-${v}`,
          title: bad ? "tak ada di katalog mesin ini" : undefined,
          style: {
            display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px",
            borderRadius: "var(--radius-pill)", fontSize: "var(--text-xs)",
            fontFamily: "var(--font-mono)",
            background: bad ? "var(--status-err-tint, var(--bone-200))" : "var(--bone-200)",
            color: bad ? "var(--status-err)" : "var(--text-strong)",
            border: `1px solid ${bad ? "var(--status-err)" : "var(--border-strong)"}`,
          },
        },
          bad ? "⚠ " : null,
          labelOf(v),
          React.createElement("button", {
            type: "button", "aria-label": `Hapus ${v}`, disabled,
            onClick: () => onChange(value.filter((x) => x !== v)),
            style: { border: "none", background: "transparent", cursor: "pointer",
              color: "inherit", padding: 0, lineHeight: 1, fontSize: "var(--text-sm)" },
          }, "×"));
      })),
    React.createElement(Button, {
      variant: "secondary", size: "sm", disabled,
      "aria-label": label, "aria-expanded": open,
      onClick: () => setOpen((v) => !v),
      rightIcon: open ? "chevron-up" : "chevron-down",
    }, value.length ? `${value.length} dipilih` : placeholder),
    open && React.createElement("div", {
      style: {
        display: "flex", flexDirection: "column", gap: 6, padding: 8,
        border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
        background: "var(--surface-card)",
      },
    },
      React.createElement(Input, {
        type: "search", role: "searchbox", size: "sm", value: q,
        placeholder: searchPlaceholder, "aria-label": `Cari ${label}`,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value),
      }),
      React.createElement("div", {
        role: "listbox", "aria-multiselectable": true,
        style: { display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto" },
      },
        shown.length === 0
          ? React.createElement("span", {
              style: { fontSize: "var(--text-xs)", color: "var(--text-subtle)", padding: "6px 4px" },
            }, emptyText)
          : shown.map((o) => React.createElement("button", {
              key: o.value, type: "button", role: "option",
              "aria-selected": value.includes(o.value), disabled,
              onClick: () => toggle(o.value),
              style: {
                display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                font: `var(--weight-medium) var(--text-sm)/1.3 var(--font-ui)`,
                color: value.includes(o.value) ? "var(--text-strong)" : "var(--text-body)",
              },
            },
              React.createElement(Icon, {
                name: value.includes(o.value) ? "check" : "circle", size: 14,
                color: value.includes(o.value) ? "var(--accent)" : "var(--text-subtle)",
              }),
              React.createElement("span", null, o.label),
              o.group && React.createElement("span", {
                style: { marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--text-subtle)" },
              }, o.group))))));
}
```

Modify `src/src/ds/index.ts:5`:

```ts
export { Button, IconButton, Input, Select, Checkbox, Switch, MultiSelect } from "./components/forms";
```

(Sesuaikan nama modul dengan yang sudah tertulis di baris itu — jangan mengubah path-nya.)

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/ds-multiselect.test.tsx`
Expected: PASS, 7 test.

- [ ] **Step 5: Commit**

```bash
git add src/src/ds/components/forms.tsx src/src/ds/index.ts src/test/ds-multiselect.test.tsx
git commit -m "feat(484): komponen DS MultiSelect (pencarian, chip, chip invalid bertanda)"
```

---

### Task 8: Form Custom Agent memakai empat kontrol pilihan

**Files:**
- Modify: `src/src/screens/CustomAgentsPanel.tsx` (Draft, load katalog, empat field, chip invalid, errorText)
- Modify: `src/test/custom-agents-panel.test.tsx`

**Interfaces:**
- Consumes: `api.getCustomAgentCatalog` (Task 5), `MultiSelect` (Task 7), `modelsForRuntime`, `ALL_TOOLS`, `AGENT_RUNTIME_LABELS`, `AgentCatalogView` (Task 1).
- Produces: form yang mengirim `{ description, instructions, tools: string[]|null, model: string|null, mentions: string[], runtime: AgentRuntime|null, enabled }`.

- [ ] **Step 1: Tulis test yang gagal**

Ganti isi mock api di `src/test/custom-agents-panel.test.tsx` agar memuat katalog, lalu tambahkan test:

```tsx
const getCustomAgentCatalog = vi.fn();
// … di dalam vi.mock("../src/api/client", …) tambahkan:
//   getCustomAgentCatalog: (p?: string) => getCustomAgentCatalog(p),

const catalog = {
  tools: [
    { id: "*", label: "Semua tools", group: "shortcut" },
    { id: "Read", label: "Read", group: "builtin" },
    { id: "Bash", label: "Bash", group: "builtin" },
    { id: "mcp__context7__*", label: "context7 — semua tool", group: "mcp" },
  ],
  models: [
    { id: "claude-opus-5", label: "Opus 5", runtime: "claude" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", runtime: "codex" },
  ],
  runtimes: [{ id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex CLI" }],
};
// beforeEach: getCustomAgentCatalog.mockResolvedValue(catalog);
```

```tsx
describe("CustomAgentsPanel · kontrol pilihan (SPEC-484)", () => {
  it("Tools memakai MultiSelect bersumber katalog API, bukan teks bebas", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Agen baru" }));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names.some((n) => n?.includes("Semua tools"))).toBe(true);
    expect(names.some((n) => n?.includes("context7"))).toBe(true);
    expect(getCustomAgentCatalog).toHaveBeenCalled();
  });

  it("memilih 'Semua tools (*)' MENGOSONGKAN pilihan lain, dan sebaliknya", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Agen baru" }));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("option", { name: /Read/ }));
    fireEvent.click(screen.getByRole("option", { name: /Semua tools/ }));
    expect(screen.queryByTestId("chip-Read")).toBeNull();
    expect(screen.getByTestId("chip-*")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Bash/ }));
    expect(screen.queryByTestId("chip-*")).toBeNull();
    expect(screen.getByTestId("chip-Bash")).toBeTruthy();
  });

  it("Model menyusut mengikuti Runtime", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Agen baru" }));
    const runtime = screen.getByLabelText("Runtime agent") as HTMLSelectElement;
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    expect([...model.options].map((o) => o.value)).toContain("gpt-5.6-sol");
    fireEvent.change(runtime, { target: { value: "claude" } });
    expect([...model.options].map((o) => o.value)).not.toContain("gpt-5.6-sol");
    expect([...model.options].map((o) => o.value)).toContain("claude-opus-5");
  });

  it("menukar runtime yang membuat model terpilih tak sah akan MENGOSONGKAN model", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Agen baru" }));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-sol" } });
    fireEvent.change(screen.getByLabelText("Runtime agent"), { target: { value: "claude" } });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("");
  });

  it("mengirim runtime & tools sebagai array saat simpan", async () => {
    createCustomAgent.mockResolvedValue({});
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Agen baru" }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "baru" } });
    fireEvent.change(screen.getByLabelText("Deskripsi"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Instruksi"), { target: { value: "i" } });
    fireEvent.change(screen.getByLabelText("Runtime agent"), { target: { value: "codex" } });
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("option", { name: /Read/ }));
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(createCustomAgent).toHaveBeenCalled());
    expect(createCustomAgent.mock.calls[0][0]).toMatchObject({
      name: "baru", runtime: "codex", tools: ["Read"],
    });
  });

  it("nilai lama di luar katalog jadi chip BERTANDA dan mengunci Simpan", async () => {
    listCustomAgents.mockResolvedValue([{
      id: "global:lawas", projectId: null, name: "lawas", description: "d", instructions: "i",
      tools: ["ToolHilang"], model: null, mentions: [], runtime: null, enabled: true,
    }]);
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ubah" }));
    expect(screen.getByTestId("chip-ToolHilang").getAttribute("title")).toMatch(/tak ada di katalog/i);
    expect((screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("kartu agen menampilkan pil runtime; warisi tak menampilkan apa pun", async () => {
    listCustomAgents.mockResolvedValue([
      { id: "global:a", projectId: null, name: "a", description: "d", instructions: "i",
        tools: null, model: null, mentions: [], runtime: "codex", enabled: true },
      { id: "global:b", projectId: null, name: "b", description: "d", instructions: "i",
        tools: null, model: null, mentions: [], runtime: null, enabled: true },
    ]);
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("a");
    expect(screen.getByTestId("runtime-a").textContent).toContain("codex");
    expect(screen.queryByTestId("runtime-b")).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/custom-agents-panel.test.tsx`
Expected: FAIL — `getCustomAgentCatalog is not a function`, `getByLabelText("Runtime agent")` tak ditemukan.

- [ ] **Step 3: Implementasi minimal**

Ubah `src/src/screens/CustomAgentsPanel.tsx`:

```tsx
import React from "react";
import { Card, Button, Badge, Input, Switch, MultiSelect, Select, Field, HnTextarea, StateBlock, Callout } from "../ds";
import { api, ApiError } from "../api/client";
import {
  AGENT_NAME_RE, DEFAULT_AGENT_TOOLS, ALL_TOOLS, resolveTools, modelsForRuntime,
  type CustomAgentView, type AgentCatalogView, type AgentRuntime,
} from "@hanoman/shared";

type Draft = {
  name: string; description: string; instructions: string;
  tools: string[]; model: string; mentions: string[]; runtime: string; enabled: boolean;
};

const emptyDraft = (): Draft => ({
  name: "", description: "", instructions: "", tools: [], model: "", mentions: [],
  runtime: "", enabled: true,
});

const draftOf = (a: CustomAgentView): Draft => ({
  name: a.name, description: a.description, instructions: a.instructions,
  tools: a.tools ?? [], model: a.model ?? "", mentions: a.mentions,
  runtime: a.runtime ?? "", enabled: a.enabled,
});
```

Hapus fungsi `parseTools`. Tambahkan state katalog di dalam komponen:

```tsx
  const [catalog, setCatalog] = React.useState<AgentCatalogView | null>(null);

  const load = React.useCallback(async () => {
    try { setRows(await api.listCustomAgents(projectId ?? undefined)); }
    catch (e) { setErr(errorText(e)); setRows([]); }
    // Katalog gagal dimuat TIDAK boleh menyembunyikan daftar agen: ia jatuh ke katalog kosong,
    // dan setiap nilai tersimpan lalu tampil sebagai chip bertanda — terlihat, bukan senyap.
    try { setCatalog(await api.getCustomAgentCatalog(projectId ?? undefined)); }
    catch { setCatalog({ tools: [], models: [], runtimes: [] }); }
  }, [projectId]);
```

Tambahkan turunan di bawah `nameValid`:

```tsx
  const runtime = (editing?.draft.runtime || null) as AgentRuntime | null;
  const toolOptions = (catalog?.tools ?? []).map((t) => ({ value: t.id, label: t.label, group: t.group === "mcp" ? "MCP" : undefined }));
  const toolIds = toolOptions.map((o) => o.value);
  const modelOptions = modelsForRuntime(runtime)
    .filter((m) => !catalog || catalog.models.some((c) => c.id === m.id))
    .map((m) => ({ value: m.id, label: runtime ? m.label : `${m.label} · ${m.runtime}` }));
  const mentionOptions = mentionable.map((m) => ({ value: m.name, label: m.name }));
  const invalidTools = (editing?.draft.tools ?? []).filter((t) => !toolIds.includes(t));
  const invalidMentions = (editing?.draft.mentions ?? []).filter((m) => !mentionOptions.some((o) => o.value === m));
  const modelInvalid = Boolean(editing?.draft.model) && !modelOptions.some((o) => o.value === editing!.draft.model);
  const blocked = invalidTools.length > 0 || invalidMentions.length > 0 || modelInvalid;

  /** `*` dan nama eksplisit saling meniadakan — cermin aturan server, ditegakkan di kontrol. */
  const setTools = (next: string[]) => {
    const justAddedAll = next.includes(ALL_TOOLS) && !editing!.draft.tools.includes(ALL_TOOLS);
    const clean = justAddedAll ? [ALL_TOOLS] : next.filter((t) => t !== ALL_TOOLS);
    setEditing({ ...editing!, draft: { ...editing!.draft, tools: clean } });
  };

  /** Menukar runtime yang membuat model terpilih tak sah MENGOSONGKANNYA — bukan mengirim 400. */
  const setRuntime = (next: string) => {
    const allowed = modelsForRuntime((next || null) as AgentRuntime | null).map((m) => m.id);
    const model = allowed.includes(editing!.draft.model) ? editing!.draft.model : "";
    setEditing({ ...editing!, draft: { ...editing!.draft, runtime: next, model } });
  };
```

Ubah `save()` agar mengirim bentuk baru:

```tsx
      const payload = {
        description: d.description, instructions: d.instructions,
        tools: d.tools.length ? d.tools : null, model: d.model || null,
        mentions: d.mentions, runtime: (d.runtime || null) as AgentRuntime | null,
        enabled: d.enabled,
      };
```

Ubah `errorText` agar menerjemahkan penolakan baru — sisipkan sebelum `if (typeof d.error === "string")`:

```tsx
  if (Array.isArray((d as { unknownTools?: string[] }).unknownTools) && (d as { unknownTools: string[] }).unknownTools.length) {
    return `Tool tak dikenal di mesin ini: ${(d as { unknownTools: string[] }).unknownTools.join(", ")}`;
  }
  if (typeof (d as { model?: string }).model === "string") {
    return `Model "${(d as { model: string }).model}" tak tersedia untuk runtime ${(d as { runtime?: string }).runtime ?? "warisi"}.`;
  }
```

…dan tambahkan `unknownTools?: string[]; model?: string; runtime?: string;` ke tipe `d` di baris destructuring.

Ganti empat `Field` di form (Tools/Model/Mention) dan tambahkan Runtime:

```tsx
          <Field label="Tools" hint={`Kosongkan untuk memakai default: ${DEFAULT_AGENT_TOOLS.join(", ")}. Alat delegasi (Task) diatur otomatis dari Mention.`}>
            <MultiSelect aria-label="Tools" options={toolOptions} value={editing.draft.tools}
              invalidValues={invalidTools} onChange={setTools}
              placeholder="Pilih tools…" searchPlaceholder="Cari tool…" />
          </Field>
          <Field label="Runtime agent" hint="Mesin sesi yang memakai agen ini. Kosongkan untuk ikut sesi induk (dipakai claude maupun codex).">
            <Select aria-label="Runtime agent" value={editing.draft.runtime}
              options={[{ value: "", label: "Ikut sesi induk" },
                ...(catalog?.runtimes ?? []).map((r) => ({ value: r.id, label: r.label }))]}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRuntime(e.target.value)} />
          </Field>
          <Field label="Model" hint="Kosongkan untuk mewarisi model sesi.">
            <Select aria-label="Model" value={editing.draft.model} invalid={modelInvalid}
              options={[{ value: "", label: "Ikut sesi induk" }, ...modelOptions,
                ...(modelInvalid ? [{ value: editing.draft.model, label: `⚠ ${editing.draft.model} — tak ada di katalog` }] : [])]}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, model: e.target.value } })} />
          </Field>
          <Field label="Mention" hint="Agen yang boleh dipanggil agen ini. Graf mention wajib asiklik — server menolak yang membentuk lingkaran.">
            <MultiSelect aria-label="Mention" options={mentionOptions} value={editing.draft.mentions}
              invalidValues={invalidMentions}
              onChange={(mentions) => setEditing({ ...editing, draft: { ...editing.draft, mentions } })}
              placeholder="Pilih agen…" searchPlaceholder="Cari agen…"
              emptyText="Belum ada agen lain." />
          </Field>
          {blocked && (
            <Callout tone="warn">
              Ada nilai yang tak ada di katalog mesin ini (ditandai ⚠). Buang dulu sebelum menyimpan —
              server menolak nilai yang tak dikenal.
            </Callout>
          )}
```

Ubah tombol Simpan:

```tsx
            <Button onClick={() => void save()} loading={busy} disabled={!nameValid || blocked}>Simpan</Button>
```

Tambahkan pil runtime di kartu, setelah badge `nonaktif`:

```tsx
              {a.runtime && <Badge tone="neutral" size="sm" data-testid={`runtime-${a.name}`}>{a.runtime}</Badge>}
```

Ubah baris resolusi tools di kartu agar `*` ikut ter-expand secara tampilan:

```tsx
        const shownTools = (a.tools ?? []).includes(ALL_TOOLS)
          ? (catalog?.tools ?? []).map((t) => t.id).filter((id) => id !== ALL_TOOLS)
          : a.tools;
        const tools = resolveTools({ tools: shownTools, mentions: a.mentions });
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src src/test/custom-agents-panel.test.tsx src/test/ds-multiselect.test.tsx
pnpm --filter ./src typecheck
```
Expected: PASS semua; typecheck bersih.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/CustomAgentsPanel.tsx src/test/custom-agents-panel.test.tsx
git commit -m "feat(484): form Custom Agent memakai dropdown tools/model/mention + runtime"
```

---

### Task 9: Docs Source of Truth + smoke endpoint nyata

**Files:**
- Modify: `internal/docs/architecture/data-model.md:427-438` (tabel kolom `CustomAgent`)
- Modify: `internal/docs/architecture/api-contract.md:846-856` (blok endpoint custom-agents)
- Modify: `internal/docs/design-system/design-system.md` (komponen `MultiSelect`)
- Modify: `internal/skills/hanoman/SKILL.md` (butir custom agent)

**Interfaces:**
- Consumes: seluruh perilaku Task 1–8.
- Produces: docs SoT sinkron; bukti endpoint hidup.

- [ ] **Step 1: Perbarui `data-model.md`**

Tambahkan baris ke tabel kolom `CustomAgent`, setelah `mentions`:

```markdown
| `runtime` | `String?` | **SPEC-484 · ADR-0101** · penyaring mesin sesi. `null` = **ikut sesi induk** (dipakai sesi claude **dan** codex — perilaku ADR-0094 apa adanya, jadi baris lama tak perlu backfill); `"claude"`/`"codex"` = hanya dimaterialisasi di sesi mesin itu. Nilai asing dari sync dibaca sebagai `null`. Ikut `FIELDS.customAgent`. |
```

Tambahkan satu butir penjelas di bawah tabel:

```markdown
- **`tools` punya TIGA nilai yang wajib tetap berbeda** (ADR-0101 keputusan 4): `null` = tak diisi
  (pakai `DEFAULT_AGENT_TOOLS`) · `[]` = sengaja tanpa tool · `["*"]` = semua tool yang dikenal
  katalog mesin ini. `["*"]` **di-expand** di `agentDefsFor()` sebelum `resolveTools`, tak pernah
  diteruskan apa adanya (claude membuangnya senyap) dan tak pernah diterjemahkan jadi `null` (agen
  tanpa `tools` mewarisi SELURUH tool termasuk `Task`, dan lapis 2 anti-loop lenyap tanpa jejak).
```

- [ ] **Step 2: Perbarui `api-contract.md`**

Ganti blok `custom-agents` menjadi:

```
GET    /api/custom-agents                 -> CustomAgentView[]        # agen GLOBAL saja
GET    /api/custom-agents?projectId=<id>  -> CustomAgentView[]        # himpunan EFEKTIF (global+project),
#                                            baris global bertanda `inherited: true`; nama yang ditimpa
#                                            project muncul SEKALI (versi project yang menang)
GET    /api/custom-agents/catalog[?projectId=<id>] -> AgentCatalogView
#      { tools: {id,label,group:"shortcut"|"builtin"|"mcp"}[], models: {id,label,runtime}[],
#        runtimes: {id,label}[] }   # SPEC-484 · ADR-0101 · sumber daftar untuk form.
#      tools = pintasan `*` + DEFAULT_AGENT_TOOLS + satu entri `mcp__<server>__*` per server MCP
#      yang ditemukan di ~/.claude.json (global + projects[<repoDir>]), <repoDir>/.mcp.json, dan
#      ~/.codex/config.toml — semuanya GAGAL-TERBUKA. Daftar MENTION sengaja TIDAK di sini: ia
#      sudah hidup di `GET /custom-agents?projectId=` lengkap dengan aturan project-menimpa-global.
POST   /api/custom-agents { projectId?, name, description, instructions, tools?, model?, mentions?, runtime?, enabled? }
#      -> 201 CustomAgentView
#         400 slug nama tak sah · projectId tak ada · mention tak dikenal { unknown: string[] }
#         400 tool tak dikenal { unknownTools: string[] } · `*` bercampur nama lain
#         400 model tak dikenal untuk runtime-nya { model, runtime } · runtime di luar {claude,codex}
#         409 nama sudah dipakai di scope itu · mention membentuk siklus { scope, cycle: string[] }
PATCH  /api/custom-agents/:id { description?, instructions?, tools?, model?, mentions?, runtime?, enabled? }
#      -> 200 CustomAgentView · 400 (termasuk upaya mengubah `name`/`projectId`) · 404 · 409 siklus
DELETE /api/custom-agents/:id -> 204     # mencabut nama itu dari `mentions` agen lain (tanpa rujukan yatim)
```

Tambahkan paragraf setelah blok `> **Anti-loop tiga lapis** …`:

```markdown
> **Validasi katalog KERAS, tapi hanya atas field yang ADA di payload** (SPEC-484 · ADR-0101
> keputusan 5). Nilai di luar katalog ditolak `400` yang **menyebut nilainya**; `PATCH { enabled }`
> pada baris warisan ber-`model`/`tools` asing **tetap 200**, sebab field itu tak ada di payload —
> tanpa klausa ini gerbangnya mengunci saklar aktif/nonaktif setiap baris lama. Satu pengecualian
> yang justru menegakkannya: `model` divalidasi **juga** saat hanya `runtime` yang berubah, memakai
> **runtime efektif** (`payload.runtime` bila ada, selain itu nilai baris).
>
> **`runtime` adalah PENYARING** — ia menyaring apa yang masuk roster sesi, bukan proses mana yang
> dijalankan. `null` = ikut sesi induk (kedua mesin). Penyaringnya di `agentDefsFor(projectId,
> agent)`, dan `agent` yang dipakai wajib agen sesi yang sebenarnya, bukan `Setting.agent`.
```

- [ ] **Step 3: Perbarui design-system + SKILL, lalu commit**

Tambahkan entri komponen di `internal/docs/design-system/design-system.md` (di daftar komponen form, mengikuti format yang sudah ada di sana):

```markdown
- **`MultiSelect`** (SPEC-484) — pilihan jamak ber-pencarian + chip. **Inline, bukan portal**:
  daftar opsinya muncul di bawah kontrol, jadi tak ada outside-click/focus-trap yang perlu dibayar
  dan opsinya ber-`role="option"` sehingga bisa diuji lewat `getByRole` (berbeda dari
  `Checkbox`/`Switch` yang bukan `<input>` — mengklik labelnya no-op). Prop `invalidValues`
  merender chip bertanda ⚠ untuk nilai yang tak ada di katalog: nilai lama **terlihat**, bukan
  hilang diam-diam.
```

Tambahkan di `internal/skills/hanoman/SKILL.md`, tepat setelah butir custom agent ADR-0094:

```markdown
- **Form Custom Agent berbasis katalog** (SPEC-484/ADR-0101, memperluas ADR-0094 & ADR-0074):
  `tools`/`model`/`mention` memakai kontrol pilihan bersumber `GET /api/custom-agents/catalog`,
  dan definisi agen punya kolom **`runtime`** (`claude`|`codex`|**null = ikut sesi induk**) yang
  **MENYARING** roster di `agentDefsFor(projectId, agent)` — bukan memilih proses; melahirkan codex
  dari dalam sesi claude adalah titik spawn ketiga (SPEC-448). Katalog tool = pintasan `*` +
  `DEFAULT_AGENT_TOOLS` + satu entri `mcp__<server>__*` per server MCP yang ditemukan di
  `~/.claude.json` (global + `projects[<repoDir>]`), `<repoDir>/.mcp.json`, dan
  `~/.codex/config.toml`, **semuanya gagal-terbuka**. **Empat gotcha:** `runtime` wajib masuk
  `FIELDS.customAgent` (kolom terlewat menyeberang sebagai default palsu tanpa error); `tools`
  punya TIGA nilai berbeda (`null` default · `[]` tanpa tool · `["*"]` semua) dan `["*"]`
  **di-expand sebelum `resolveTools`** — meneruskannya membuat claude membuangnya senyap,
  menerjemahkannya jadi `null` mencabut lapis 2 anti-loop; `"*"` bercampur nama lain **ditolak**;
  dan validasi katalog keras hanya atas field yang **ada di payload**, dengan `model` memakai
  **runtime efektif** supaya `PATCH {model}` pada agen codex tak lolos untuk model claude.
```

```bash
git add internal/docs internal/skills
git commit -m "docs(484): data-model, api-contract, design-system, SKILL untuk katalog custom agent"
```

- [ ] **Step 4: Smoke endpoint nyata (sekali di akhir)**

```bash
export HANOMAN_HOME="$(mktemp -d)"
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server build 2>/dev/null || pnpm --filter ./server exec tsc -p .
PORT=8799 HOST=127.0.0.1 node server/dist/server.js &
SRV=$!
sleep 4
curl -s "http://127.0.0.1:8799/api/custom-agents/catalog" | head -c 600; echo
curl -s -X POST "http://127.0.0.1:8799/api/custom-agents" -H 'content-type: application/json' \
  -d '{"name":"smoke","description":"d","instructions":"i","tools":["Read"],"runtime":"codex"}' ; echo
curl -s -X POST "http://127.0.0.1:8799/api/custom-agents" -H 'content-type: application/json' \
  -d '{"name":"smoke2","description":"d","instructions":"i","tools":["read"]}' ; echo
kill $SRV
```

Expected:
- katalog: JSON ber-`"tools"` yang entri pertamanya `"*"`, memuat `"Read"`, dan `"runtimes"` = claude+codex.
- POST pertama: `201` ber-`"runtime":"codex"`.
- POST kedua: `400` ber-`"unknownTools":["read"]`.

Bila ada yang tak sesuai, perbaiki sampai hijau **sebelum** melanjutkan.

- [ ] **Step 5: Verifikasi scope-terbatas terakhir + commit penutup**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV \
  ./node_modules/.bin/vitest run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
pnpm --filter ./server typecheck && pnpm --filter ./src typecheck && pnpm --filter ./shared typecheck
```

Expected: seluruh test yang tersentuh LULUS (pastikan jumlahnya **bukan nol** — `--changed`
menyalakan `passWithNoTests`, jadi "no test files" terlihat hijau padahal tak menguji apa pun),
typecheck ketiga paket bersih.

```bash
git add -A
git commit -m "chore(484): verifikasi scope-terbatas + smoke endpoint katalog custom agent"
```
