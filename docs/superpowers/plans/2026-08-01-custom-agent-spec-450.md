# Custom Agent hanoman — Implementation Plan (SPEC-450)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator bisa membuat custom agent di hanoman — global (semua project) dan per project — yang dipakai sesi claude & codex, bisa saling mention, dan tak bisa membentuk loop.

**Architecture:** Katalog hidup di DB sebagai entitas `CustomAgent` yang ikut changefeed sync, dengan `id` deterministik `"<projectId|global>:<name>"`. Materialisasinya berbeda per agen: **claude** menerima `--agents "$(cat <file>)"` (mekanisme native, berkas tmpdir seperti prompt SPEC-223), **codex** menerima blok roster yang ditempel ke akhir prompt sesi. Wiring hidup di titik cekik `createSession` lewat sumber yang mendaftarkan diri (`registerCustomAgentSource`), jadi tak ada call site yang bisa lupa memasangnya. Anti-loop tiga lapis: graf mention wajib asiklik (409 di server) → `Task` diturunkan dari `mentions` sehingga agen daun tak punya alat memanggil siapa pun → anggaran hop di prosa.

**Tech Stack:** TypeScript strict · zod (`@hanoman/shared`) · Prisma 6 + SQLite · Fastify · React + Vite · vitest.

## Global Constraints

- **Spec/ADR:** SPEC-450 · **ADR-0094** (`internal/docs/adr/0094-custom-agent-katalog-materialisasi-native.md`) — sudah ditulis & ter-commit. Baca sebelum mulai.
- **Design doc:** `docs/superpowers/specs/2026-08-01-spec-450-custom-agent-design.md`.
- **Nilai konstanta yang WAJIB persis:** `MENTION_MAX_HOPS = 3`; `MENTION_TOOL = "Task"`; `DEFAULT_AGENT_TOOLS = ["Read","Write","Edit","Bash","Glob","Grep","WebFetch","WebSearch"]` (tanpa `Task`); `AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,39}$/`; scope global memakai literal `"global"` di `id`.
- **Keduanya KONSTANTA MODUL, bukan konfigurasi** (pola `LEAD_ACTIONS`, ADR-0091). Jangan pernah memindahkannya ke `Setting`.
- **Scope verifikasi sesi ini `changed`** (ADR-0080). Jalankan hanya test yang tersentuh; typecheck **per paket** (`pnpm --filter ./server typecheck`), jangan `pnpm -r typecheck`.
- **Perintah vitest:** pakai binernya langsung — `./node_modules/.bin/vitest run <path>`. Test **server** WAJIB `--no-file-parallelism` (mereka berbagi satu berkas DB).
- **Test web** WAJIB `env -u NODE_ENV` di depan perintah (NODE_ENV=production membuat RTL `act` gagal palsu).
- **Jangan** `pkill -f <pola>` / `killall` — prompt sesi lain ada di ARGV mereka. Bunuh per-PID.
- **Docs SoT diperbarui dalam commit yang sama** dengan kode yang menyentuhnya, dan ter-link di `internal/docs/README.md`.
- **Bahasa komentar & pesan commit: Indonesia** (ikuti gaya repo).

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/custom-agent.ts` **(baru)** | Kontrak murni: zod, konstanta, `customAgentId`, `resolveTools`, `detectCycle`, `effectiveAgents`. Nol I/O. |
| `shared/test/custom-agent.test.ts` **(baru)** | Test kontrak murni. |
| `shared/src/index.ts` | Re-export modul baru. |
| `shared/src/agent.ts` | +domain capability `agents` (`CAPABILITY_IDS`, `CAPABILITIES`, `CAPABILITY_DOMAINS`). |
| `runner/src/custom-agents.ts` **(baru)** | Render murni: `renderAgentsJson`, `agentPromptOf`, `agentRosterBlock`. Nol I/O. |
| `runner/test/custom-agents.test.ts` **(baru)** | Test render. |
| `runner/src/index.ts` | Re-export modul baru. |
| `server/prisma/schema.prisma` | Model `CustomAgent` + relasi balik di `Project`. |
| `server/prisma/migrations/20260801120000_custom_agent/migration.sql` **(baru)** | `CREATE TABLE` + index. |
| `cli/src/commands/migrate-pg.ts` | `PG_ORDER` += `"CustomAgent"`. |
| `server/src/services/sync.ts` | `SYNCED`/`FIELDS`/`DATE_FIELDS`/`DELEGATE` += `customAgent`. |
| `server/src/services/custom-agents.ts` **(baru)** | Cache sinkron, resolusi scope dari DB, validasi siklus lintas scope, sumber untuk pty. |
| `server/src/routes/custom-agents.ts` **(baru)** | CRUD `/api/custom-agents`. |
| `server/src/services/agent-capabilities.ts` | Peta route → `rw("agents")`. |
| `server/src/app.ts` | Daftarkan route. |
| `server/src/server.ts` | `installCustomAgents()` sebelum sesi pertama lahir. |
| `server/src/services/pty.ts` | `registerCustomAgentSource`, `--agents` via berkas, roster codex. |
| `runner/src/agent-cli.ts` | `agentFlags` menerima `agentsFile`. |
| `src/src/screens/CustomAgentsPanel.tsx` **(baru)** | Satu panel untuk dua permukaan. |
| `src/src/screens/SettingsScreen.tsx` | Tab "Custom agent" (global). |
| `src/src/screens/ProjectDetailScreen.tsx` | Bagian custom agent (per project). |
| `src/src/api/*` | Klien HTTP. |

---

### Task 1: Kontrak murni `@hanoman/shared`

**Files:**
- Create: `shared/src/custom-agent.ts`
- Create: `shared/test/custom-agent.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `AGENT_NAME_RE`, `DEFAULT_AGENT_TOOLS`, `MENTION_TOOL`, `MENTION_MAX_HOPS`
  - `zCustomAgent`, `type CustomAgent`, `zCreateCustomAgent`, `zUpdateCustomAgent`
  - `customAgentId(projectId: string | null, name: string): string`
  - `mentionsOf(v: unknown): string[]`, `toolsOf(v: unknown): string[] | null`
  - `resolveTools(a: { tools?: string[] | null; mentions?: string[] | null }): string[]`
  - `type AgentNode = { name: string; mentions: string[] }`
  - `detectCycle(nodes: AgentNode[]): string[] | null`
  - `effectiveAgents(globals: CustomAgent[], project: CustomAgent[]): CustomAgent[]`

- [ ] **Step 1: Tulis test yang gagal**

Buat `shared/test/custom-agent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AGENT_NAME_RE, DEFAULT_AGENT_TOOLS, MENTION_TOOL, MENTION_MAX_HOPS,
  customAgentId, resolveTools, detectCycle, effectiveAgents,
  mentionsOf, toolsOf, zCreateCustomAgent, type CustomAgent,
} from "../src/custom-agent";

const agent = (o: Partial<CustomAgent> & { name: string }): CustomAgent => ({
  id: customAgentId(o.projectId ?? null, o.name),
  projectId: o.projectId ?? null,
  name: o.name,
  description: o.description ?? "d",
  instructions: o.instructions ?? "i",
  tools: o.tools ?? null,
  model: o.model ?? null,
  mentions: o.mentions ?? null,
  enabled: o.enabled ?? true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

describe("konstanta anti-loop (ADR-0094 keputusan 6)", () => {
  it("DEFAULT_AGENT_TOOLS tak pernah memuat alat delegasi", () => {
    expect(DEFAULT_AGENT_TOOLS).not.toContain(MENTION_TOOL);
  });
  it("nilainya persis seperti yang dikunci ADR", () => {
    expect(MENTION_TOOL).toBe("Task");
    expect(MENTION_MAX_HOPS).toBe(3);
    expect([...DEFAULT_AGENT_TOOLS]).toEqual(
      ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
    );
  });
});

describe("customAgentId — deterministik (ADR-0094 keputusan 2)", () => {
  it("global memakai literal 'global'", () => {
    expect(customAgentId(null, "reviewer")).toBe("global:reviewer");
  });
  it("project memakai id project", () => {
    expect(customAgentId("hanoman", "reviewer")).toBe("hanoman:reviewer");
  });
  it("dua mesin yang membuat nama sama menghasilkan id yang SAMA", () => {
    expect(customAgentId(null, "reviewer")).toBe(customAgentId(null, "reviewer"));
  });
});

describe("AGENT_NAME_RE", () => {
  it.each(["reviewer", "sec-audit", "a1", "x-9-y"])("menerima %s", (n) => {
    expect(AGENT_NAME_RE.test(n)).toBe(true);
  });
  it.each(["A", "1a", "-a", "a_", "a", "ab*", "", "a".repeat(41)])("menolak %s", (n) => {
    expect(AGENT_NAME_RE.test(n)).toBe(false);
  });
});

describe("resolveTools — lapis 2 anti-loop (ADR-0094 keputusan 5)", () => {
  it("daun tanpa tools → DEFAULT tanpa Task", () => {
    expect(resolveTools({})).toEqual([...DEFAULT_AGENT_TOOLS]);
    expect(resolveTools({})).not.toContain("Task");
  });
  it("daun DENGAN tools → tools operator dikurangi Task", () => {
    expect(resolveTools({ tools: ["Read", "Task", "Bash"] })).toEqual(["Read", "Bash"]);
  });
  it("agen ber-mentions tanpa tools → DEFAULT + Task", () => {
    expect(resolveTools({ mentions: ["b"] })).toEqual([...DEFAULT_AGENT_TOOLS, "Task"]);
  });
  it("agen ber-mentions DENGAN tools → tools operator + Task, tanpa duplikat", () => {
    expect(resolveTools({ tools: ["Read", "Task"], mentions: ["b"] })).toEqual(["Read", "Task"]);
  });
  it("mentions kosong (array) diperlakukan sebagai daun", () => {
    expect(resolveTools({ tools: ["Task"], mentions: [] })).toEqual([]);
  });
});

describe("detectCycle — lapis 1 anti-loop", () => {
  it("graf asiklik → null", () => {
    expect(detectCycle([
      { name: "a", mentions: ["b"] },
      { name: "b", mentions: ["c"] },
      { name: "c", mentions: [] },
    ])).toBeNull();
  });
  it("self-loop terdeteksi", () => {
    expect(detectCycle([{ name: "a", mentions: ["a"] }])).toEqual(["a", "a"]);
  });
  it("siklus dua simpul terdeteksi", () => {
    expect(detectCycle([
      { name: "a", mentions: ["b"] },
      { name: "b", mentions: ["a"] },
    ])).toEqual(["a", "b", "a"]);
  });
  it("siklus tak langsung terdeteksi", () => {
    expect(detectCycle([
      { name: "a", mentions: ["b"] },
      { name: "b", mentions: ["c"] },
      { name: "c", mentions: ["a"] },
    ])).toEqual(["a", "b", "c", "a"]);
  });
  it("diamond (dua jalur ke satu simpul) BUKAN siklus", () => {
    expect(detectCycle([
      { name: "a", mentions: ["b", "c"] },
      { name: "b", mentions: ["d"] },
      { name: "c", mentions: ["d"] },
      { name: "d", mentions: [] },
    ])).toBeNull();
  });
  it("mention ke nama yang tak ada diabaikan (validasi rujukan bukan tugasnya)", () => {
    expect(detectCycle([{ name: "a", mentions: ["hantu"] }])).toBeNull();
  });
});

describe("effectiveAgents — project menimpa global", () => {
  it("menggabungkan keduanya", () => {
    const out = effectiveAgents([agent({ name: "g" })], [agent({ name: "p", projectId: "x" })]);
    expect(out.map((a) => a.name).sort()).toEqual(["g", "p"]);
  });
  it("agen project menimpa global bernama sama", () => {
    const out = effectiveAgents(
      [agent({ name: "rev", instructions: "GLOBAL" })],
      [agent({ name: "rev", projectId: "x", instructions: "PROJECT" })],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.instructions).toBe("PROJECT");
  });
  it("agen project yang DIMATIKAN menyembunyikan global bernama sama", () => {
    const out = effectiveAgents(
      [agent({ name: "rev" })],
      [agent({ name: "rev", projectId: "x", enabled: false })],
    );
    expect(out).toHaveLength(0);
  });
  it("agen global yang dimatikan tak ikut", () => {
    expect(effectiveAgents([agent({ name: "g", enabled: false })], [])).toHaveLength(0);
  });
  it("urutannya stabil menurut nama", () => {
    const out = effectiveAgents([agent({ name: "z" }), agent({ name: "a" })], []);
    expect(out.map((a) => a.name)).toEqual(["a", "z"]);
  });
});

describe("pembacaan defensif kolom Json (datang dari sync mesin lain)", () => {
  it("mentionsOf membuang non-array, non-string, dan duplikat", () => {
    expect(mentionsOf(null)).toEqual([]);
    expect(mentionsOf("bukan array")).toEqual([]);
    expect(mentionsOf(["a", 1, "a", null, "b"])).toEqual(["a", "b"]);
  });
  it("toolsOf membedakan 'tak diisi' (null) dari 'sengaja kosong' ([])", () => {
    expect(toolsOf(null)).toBeNull();
    expect(toolsOf(undefined)).toBeNull();
    expect(toolsOf([])).toEqual([]);
    expect(toolsOf(["Read", 2, "Read"])).toEqual(["Read"]);
  });
});

describe("zCreateCustomAgent", () => {
  it("menerima payload minimal", () => {
    const r = zCreateCustomAgent.safeParse({ name: "rev", description: "d", instructions: "i" });
    expect(r.success).toBe(true);
  });
  it("menolak nama yang tak sesuai slug", () => {
    const r = zCreateCustomAgent.safeParse({ name: "Rev", description: "d", instructions: "i" });
    expect(r.success).toBe(false);
  });
  it("menolak deskripsi kosong — claude memakainya untuk MEMILIH agen", () => {
    const r = zCreateCustomAgent.safeParse({ name: "rev", description: "  ", instructions: "i" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `./node_modules/.bin/vitest run shared/test/custom-agent.test.ts`
Expected: FAIL — `Failed to resolve import "../src/custom-agent"`.

- [ ] **Step 3: Implementasi minimal**

Buat `shared/src/custom-agent.ts`:

```ts
import { z } from "zod";

// SPEC-450 · ADR-0094 · kontrak murni custom agent. Nol I/O: dipakai server (validasi + resolusi
// scope), runner (render argv/prompt), dan UI (bentuk form) dari satu sumber.

/** Slug nama agen. Nama adalah KUNCI objek `--agents` claude, jadi ia harus aman & stabil. */
export const AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,39}$/;

/**
 * ADR-0094 keputusan 6 · KONSTANTA MODUL, bukan konfigurasi (pola LEAD_ACTIONS, ADR-0091).
 * SENGAJA tanpa `Task`: itulah yang membuat agen daun tak punya alat memanggil siapa pun.
 * Aman terhadap gotcha M4 — nama tool yang tak dikenal versi claude dibuang SENYAP, dan membuang
 * hanya mengurangi kemampuan; tak ada jalan bagi konstanta basi untuk memberikan `Task`.
 */
export const DEFAULT_AGENT_TOOLS = [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch",
] as const;

/** Alat delegasi claude. Terukur (ADR-0094 M2): tanpa ini agen tak bisa memanggil agen lain. */
export const MENTION_TOOL = "Task";

/** Anggaran hop lapis 3 (prosa). Bukan jaminan — jaminannya lapis 1 & 2. */
export const MENTION_MAX_HOPS = 3;

/** Scope global memakai literal ini di `id` (bukan string kosong: id harus terbaca manusia). */
export const GLOBAL_SCOPE = "global";

export const zCustomAgent = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  name: z.string().regex(AGENT_NAME_RE),
  description: z.string(),
  instructions: z.string(),
  tools: z.array(z.string()).nullable(),
  model: z.string().nullable(),
  mentions: z.array(z.string()).nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomAgent = z.infer<typeof zCustomAgent>;

export const zCreateCustomAgent = z.object({
  projectId: z.string().nullable().optional(),
  name: z.string().regex(AGENT_NAME_RE),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(20_000),
  tools: z.array(z.string()).nullable().optional(),
  model: z.string().nullable().optional(),
  mentions: z.array(z.string()).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type CreateCustomAgent = z.infer<typeof zCreateCustomAgent>;

// `name` & `projectId` DIBUANG dari payload update: id diturunkan dari keduanya, dan changefeed
// sync tak punya operasi hapus — rename yang mengubah id meninggalkan baris yatim di setiap mesin
// lain (ADR-0094 keputusan 2). Ganti nama = hapus + buat baru.
export const zUpdateCustomAgent = zCreateCustomAgent
  .omit({ name: true, projectId: true })
  .partial();
export type UpdateCustomAgent = z.infer<typeof zUpdateCustomAgent>;

export const customAgentId = (projectId: string | null, name: string): string =>
  `${projectId ?? GLOBAL_SCOPE}:${name}`;

/** Kolom `Json` menyeberang lewat sync dari client versi lain → dibaca defensif. */
export function mentionsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && x && !out.includes(x)) out.push(x);
  return out;
}

/** null = "tak diisi" (pakai DEFAULT); [] = "sengaja kosong" (agen tanpa tool sama sekali). */
export function toolsOf(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && x && !out.includes(x)) out.push(x);
  return out;
}

/**
 * ADR-0094 keputusan 5 lapis 2 · `Task` diturunkan dari `mentions`, BUKAN dari ketikan operator.
 * `Task` yang diketik operator DICABUT saat mentions kosong: allowlist yang menang, bukan daftar
 * tool. hanoman selalu memancarkan tools eksplisit — agen tanpa `tools` mewarisi SELURUH tool
 * termasuk `Task`, dan lapis ini akan lenyap tanpa jejak.
 */
export function resolveTools(a: { tools?: string[] | null; mentions?: string[] | null }): string[] {
  const base = a.tools ?? [...DEFAULT_AGENT_TOOLS];
  const canMention = (a.mentions ?? []).length > 0;
  const out = base.filter((t) => t !== MENTION_TOOL);
  if (canMention) out.push(MENTION_TOOL);
  return out;
}

export type AgentNode = { name: string; mentions: string[] };

/**
 * DFS berwarna. Mengembalikan jalur siklus (`["a","b","a"]`) atau null. Mention ke nama yang tak
 * ada diabaikan — validasi rujukan tugas lapis route, bukan lapis graf.
 */
export function detectCycle(nodes: AgentNode[]): string[] | null {
  const edges = new Map(nodes.map((n) => [n.name, n.mentions] as const));
  const state = new Map<string, 0 | 1 | 2>(); // 0 belum · 1 di stack · 2 selesai
  const stack: string[] = [];

  const walk = (name: string): string[] | null => {
    if (state.get(name) === 1) return [...stack.slice(stack.indexOf(name)), name];
    if (state.get(name) === 2) return null;
    state.set(name, 1);
    stack.push(name);
    for (const next of edges.get(name) ?? []) {
      if (!edges.has(next)) continue;
      const found = walk(next);
      if (found) return found;
    }
    stack.pop();
    state.set(name, 2);
    return null;
  };

  for (const n of nodes) {
    const found = walk(n.name);
    if (found) return found;
  }
  return null;
}

/**
 * Himpunan efektif untuk satu project: global ∪ project, project MENIMPA global bernama sama.
 * Urutan operasinya mengikat: menimpa dulu, MENYARING `enabled` belakangan — jadi agen project
 * yang dimatikan MENYEMBUNYIKAN global bernama sama (itu caranya mematikan agen global di satu
 * project). Urutan keluaran diurutkan nama agar argv & roster deterministik (test kontrak argv
 * membandingkan string).
 */
export function effectiveAgents(globals: CustomAgent[], project: CustomAgent[]): CustomAgent[] {
  const byName = new Map<string, CustomAgent>();
  for (const a of globals) byName.set(a.name, a);
  for (const a of project) byName.set(a.name, a);
  return [...byName.values()]
    .filter((a) => a.enabled)
    .sort((x, y) => x.name.localeCompare(y.name));
}
```

Tambahkan ke `shared/src/index.ts`, setelah baris `export * from "./agent";`:

```ts
export * from "./custom-agent";
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `./node_modules/.bin/vitest run shared/test/custom-agent.test.ts`
Expected: PASS — semua test hijau (± 30 test).

- [ ] **Step 5: Typecheck paket shared**

Run: `pnpm --filter ./shared typecheck`
Expected: keluar 0, tanpa output.

- [ ] **Step 6: Commit**

```bash
git add shared/src/custom-agent.ts shared/test/custom-agent.test.ts shared/src/index.ts
git commit -m "feat(spec-450): kontrak murni custom agent — id deterministik, resolveTools, detectCycle

Task diturunkan dari mentions (bukan ketikan operator) supaya agen daun tak
punya alat memanggil siapa pun — lapis 2 anti-loop ADR-0094.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Render murni di `@hanoman/runner`

**Files:**
- Create: `runner/src/custom-agents.ts`
- Create: `runner/test/custom-agents.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Consumes: dari Task 1 — `resolveTools`, `MENTION_MAX_HOPS`, `MENTION_TOOL`.
- Produces:
  - `type AgentDef = { name: string; description: string; instructions: string; tools: string[] | null; model: string | null; mentions: string[] }`
  - `agentPromptOf(def: AgentDef, roster: AgentDef[]): string`
  - `renderAgentsJson(defs: AgentDef[]): string` — `""` bila kosong
  - `agentRosterBlock(defs: AgentDef[]): string` — `""` bila kosong

- [ ] **Step 1: Tulis test yang gagal**

Buat `runner/test/custom-agents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderAgentsJson, agentRosterBlock, agentPromptOf, type AgentDef } from "../src/custom-agents";
import { DEFAULT_AGENT_TOOLS, MENTION_MAX_HOPS } from "@hanoman/shared";

const def = (o: Partial<AgentDef> & { name: string }): AgentDef => ({
  name: o.name,
  description: o.description ?? `deskripsi ${o.name}`,
  instructions: o.instructions ?? `instruksi ${o.name}`,
  tools: o.tools ?? null,
  model: o.model ?? null,
  mentions: o.mentions ?? [],
});

describe("renderAgentsJson", () => {
  it("daftar kosong → string kosong (flag tak dipasang sama sekali)", () => {
    expect(renderAgentsJson([])).toBe("");
  });

  it("bentuknya {name:{description,prompt,tools}} sesuai --agents claude", () => {
    const parsed = JSON.parse(renderAgentsJson([def({ name: "rev" })]));
    expect(Object.keys(parsed)).toEqual(["rev"]);
    expect(parsed.rev.description).toBe("deskripsi rev");
    expect(typeof parsed.rev.prompt).toBe("string");
    expect(parsed.rev.tools).toEqual([...DEFAULT_AGENT_TOOLS]);
  });

  it("model hanya dipancarkan bila diisi (else agen mewarisi model sesi)", () => {
    expect(JSON.parse(renderAgentsJson([def({ name: "a" })])).a.model).toBeUndefined();
    expect(JSON.parse(renderAgentsJson([def({ name: "a", model: "haiku" })])).a.model).toBe("haiku");
  });

  it("agen ber-mentions mendapat Task; agen daun TIDAK", () => {
    const j = JSON.parse(renderAgentsJson([
      def({ name: "a", mentions: ["b"] }),
      def({ name: "b" }),
    ]));
    expect(j.a.tools).toContain("Task");
    expect(j.b.tools).not.toContain("Task");
  });

  it("Task yang diketik operator dicabut untuk agen daun", () => {
    const j = JSON.parse(renderAgentsJson([def({ name: "b", tools: ["Read", "Task"] })]));
    expect(j.b.tools).toEqual(["Read"]);
  });

  it("keluarannya JSON sah walau instruksi memuat kutip, newline, dan backslash", () => {
    const nasty = 'baris1\n"kutip" \\ backslash \t tab';
    const j = JSON.parse(renderAgentsJson([def({ name: "a", instructions: nasty })]));
    expect(j.a.prompt).toContain(nasty);
  });
});

describe("agentPromptOf — lapis 3 anti-loop", () => {
  it("agen daun diberi tahu ia TIDAK boleh mendelegasikan", () => {
    const p = agentPromptOf(def({ name: "b" }), []);
    expect(p).toContain("instruksi b");
    expect(p.toLowerCase()).toContain("tidak boleh mendelegasikan");
  });

  it("agen ber-mentions menyebut siapa yang boleh dipanggil + anggaran hop", () => {
    const a = def({ name: "a", mentions: ["b", "c"] });
    const p = agentPromptOf(a, [a, def({ name: "b" }), def({ name: "c" })]);
    expect(p).toContain("@b");
    expect(p).toContain("@c");
    expect(p).toContain(String(MENTION_MAX_HOPS));
  });

  it("mention ke agen yang tak ada di roster tak ikut disebut", () => {
    const a = def({ name: "a", mentions: ["b", "hantu"] });
    const p = agentPromptOf(a, [a, def({ name: "b" })]);
    expect(p).toContain("@b");
    expect(p).not.toContain("@hantu");
  });
});

describe("agentRosterBlock — jalur codex", () => {
  it("daftar kosong → string kosong (tak ada yang ditempel ke prompt)", () => {
    expect(agentRosterBlock([])).toBe("");
  });

  it("memuat nama, deskripsi, dan instruksi tiap agen", () => {
    const b = agentRosterBlock([def({ name: "rev", description: "tinjau kode" })]);
    expect(b).toContain("rev");
    expect(b).toContain("tinjau kode");
    expect(b).toContain("instruksi rev");
  });

  it("menyebut allowlist mention tiap agen", () => {
    const b = agentRosterBlock([def({ name: "a", mentions: ["b"] }), def({ name: "b" })]);
    expect(b).toContain("@b");
  });

  it("diawali baris pemisah supaya bisa ditempel ke akhir prompt apa pun", () => {
    expect(agentRosterBlock([def({ name: "a" })]).startsWith("\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `./node_modules/.bin/vitest run runner/test/custom-agents.test.ts`
Expected: FAIL — `Failed to resolve import "../src/custom-agents"`.

- [ ] **Step 3: Implementasi minimal**

Buat `runner/src/custom-agents.ts`:

```ts
import { resolveTools, MENTION_MAX_HOPS, MENTION_TOOL } from "@hanoman/shared";

// SPEC-450 · ADR-0094 · render custom agent ke dua permukaan: JSON `--agents` (claude, native)
// dan blok roster prosa (codex). Murni & tanpa I/O — pemanggil (pty.ts) yang menulis berkas.

export type AgentDef = {
  name: string;
  description: string;
  instructions: string;
  tools: string[] | null;
  model: string | null;
  mentions: string[];
};

/** Mention yang benar-benar bisa dituju: nama di luar roster dibuang, agar prosa tak berbohong. */
const liveMentions = (def: AgentDef, roster: AgentDef[]): string[] => {
  const names = new Set(roster.map((r) => r.name));
  return def.mentions.filter((m) => names.has(m) && m !== def.name);
};

/**
 * ADR-0094 keputusan 5 lapis 3 · anggaran hop DALAM prosa. Bukan jaminan — jaminannya graf asiklik
 * (lapis 1) dan ketiadaan `Task` (lapis 2). Ia ada karena SPEC-432 sudah mengukur harganya: agen
 * berbatas yang TAK diberi tahu batasnya membakar seluruh anggaran tanpa hasil.
 */
export function agentPromptOf(def: AgentDef, roster: AgentDef[]): string {
  const can = liveMentions(def, roster);
  if (can.length === 0) {
    return `${def.instructions}\n\n---\nKamu TIDAK boleh mendelegasikan ke agen lain. Selesaikan sendiri lalu laporkan hasilnya.`;
  }
  const list = can.map((m) => `@${m}`).join(", ");
  return [
    def.instructions,
    "",
    "---",
    `Kamu boleh mendelegasikan HANYA ke: ${list}. Panggil lewat ${MENTION_TOOL} dengan nama agennya.`,
    `Anggaran rantai delegasi seluruh sesi ini ${MENTION_MAX_HOPS} hop. Bila kamu sudah berada di hop ke-${MENTION_MAX_HOPS}, JANGAN mendelegasikan lagi — selesaikan sendiri lalu laporkan.`,
    "Sebutkan hop keberapa kamu berada saat mendelegasikan, dan jangan pernah memanggil agen yang sudah ada di rantai yang membawamu ke sini.",
  ].join("\n");
}

/**
 * JSON untuk `claude --agents`. String KOSONG bila tak ada agen — pemanggil memakai itu sebagai
 * gerbang "jangan pasang flag sama sekali", supaya argv sesi tanpa custom agent byte-identik
 * dengan sebelum SPEC-450.
 */
export function renderAgentsJson(defs: AgentDef[]): string {
  if (defs.length === 0) return "";
  const out: Record<string, { description: string; prompt: string; tools: string[]; model?: string }> = {};
  for (const d of defs) {
    out[d.name] = {
      description: d.description,
      prompt: agentPromptOf(d, defs),
      tools: resolveTools({ tools: d.tools, mentions: d.mentions }),
      ...(d.model ? { model: d.model } : {}),
    };
  }
  return JSON.stringify(out);
}

/**
 * Blok roster untuk codex — ditempel ke AKHIR prompt sesi. Codex 0.146 tak punya padanan
 * `--agents` yang bisa diverifikasi (ADR-0094 M5: kunci `-c` tak dikenal diterima diam-diam),
 * jadi hanoman memakai kanal yang memang miliknya sendiri. Codex mengadopsi peran INLINE — tak
 * ada proses kedua, jadi risiko loop di codex struktural nol.
 */
export function agentRosterBlock(defs: AgentDef[]): string {
  if (defs.length === 0) return "";
  const lines: string[] = [
    "",
    "## Custom agent hanoman",
    "",
    "Peran berikut tersedia untuk sesi ini. Saat sebuah tugas cocok dengan salah satunya, ADOPSI",
    "perannya (baca instruksinya, kerjakan dengan sudut pandang itu) lalu kembali ke peranmu sendiri.",
    "Jangan melahirkan proses agen baru.",
    "",
  ];
  for (const d of defs) {
    const can = liveMentions(d, defs);
    lines.push(`### @${d.name} — ${d.description}`);
    lines.push("");
    lines.push(d.instructions);
    lines.push("");
    lines.push(
      can.length
        ? `Boleh berkonsultasi ke: ${can.map((m) => `@${m}`).join(", ")} (maks ${MENTION_MAX_HOPS} hop berantai).`
        : "Tidak boleh berkonsultasi ke peran lain.",
    );
    lines.push("");
  }
  return lines.join("\n");
}
```

Tambahkan ke `runner/src/index.ts`, setelah baris `export * from "./agent-cli";`:

```ts
export * from "./custom-agents";
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `./node_modules/.bin/vitest run runner/test/custom-agents.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck paket runner**

Run: `pnpm --filter ./runner typecheck`
Expected: keluar 0.

- [ ] **Step 6: Commit**

```bash
git add runner/src/custom-agents.ts runner/test/custom-agents.test.ts runner/src/index.ts
git commit -m "feat(spec-450): render custom agent — JSON --agents (claude) + blok roster (codex)

Daftar kosong -> string kosong di kedua renderer, jadi sesi tanpa custom agent
lahir dengan argv & prompt yang byte-identik dengan sebelum SPEC-450.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Skema, migration, dan wiring sync

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260801120000_custom_agent/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts:16-24` (`PG_ORDER`)
- Modify: `server/src/services/sync.ts:10` (`SYNCED`), `:30-51` (`FIELDS`, `DATE_FIELDS`), `DELEGATE`
- Create: `server/test/custom-agent-sync.test.ts`

**Interfaces:**
- Consumes: Task 1 (`customAgentId`).
- Produces: tabel `CustomAgent`; entity sync `"customAgent"`; `prisma.customAgent` delegate.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/custom-agent-sync.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { SYNCED, snapshot, applyPush } from "../src/services/sync";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";
import { customAgentId } from "@hanoman/shared";

// SPEC-450 · ADR-0094 gotcha 7 · entitas baru WAJIB ikut PG_ORDER dan seluruh kolomnya wajib ada
// di FIELDS: `upsert` yang tak menyebut kolom ber-default TETAP BERHASIL, jadi kolom yang terlewat
// menyeberang sebagai default palsu tanpa satu pun error (kelas ADR-0090/0093).

const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean);
afterAll(clean);

describe("wiring sync entitas customAgent", () => {
  it("customAgent ada di SYNCED", () => {
    expect(SYNCED).toContain("customAgent");
  });

  it("CustomAgent ada di PG_ORDER", () => {
    expect(PG_ORDER).toContain("CustomAgent");
  });

  it("snapshot membawa SELURUH kolom yang punya arti", async () => {
    await prisma.project.create({ data: { id: "demo", name: "D", desc: "", kind: "web" } });
    const id = customAgentId("demo", "rev");
    await prisma.customAgent.create({ data: {
      id, projectId: "demo", name: "rev", description: "d", instructions: "i",
      tools: ["Read"], model: "haiku", mentions: ["lain"], enabled: false,
    } });
    const snap = await snapshot("customAgent", id);
    expect(snap).not.toBeNull();
    expect(Object.keys(snap!.data).sort()).toEqual([
      "createdAt", "description", "enabled", "instructions",
      "mentions", "model", "name", "projectId", "tools", "updatedAt",
    ]);
    expect(snap!.data.mentions).toEqual(["lain"]);
    expect(snap!.data.enabled).toBe(false);
  });

  it("applyPush menulis baris asal-hub tanpa kehilangan enabled/mentions", async () => {
    const id = customAgentId(null, "glob");
    const r = await applyPush("customAgent", id, 0, {
      projectId: null, name: "glob", description: "d", instructions: "i",
      tools: null, model: null, mentions: ["x"], enabled: false,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    const row = await prisma.customAgent.findUnique({ where: { id } });
    expect(row?.enabled).toBe(false);
    expect(row?.mentions).toEqual(["x"]);
    expect(row?.createdAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("menghapus project menghapus agen project-nya (cascade)", async () => {
    await prisma.project.create({ data: { id: "demo", name: "D", desc: "", kind: "web" } });
    await prisma.customAgent.create({ data: {
      id: customAgentId("demo", "a"), projectId: "demo", name: "a", description: "d", instructions: "i",
    } });
    await prisma.project.delete({ where: { id: "demo" } });
    expect(await prisma.customAgent.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `./node_modules/.bin/vitest run server/test/custom-agent-sync.test.ts --no-file-parallelism`
Expected: FAIL — `prisma.customAgent` undefined / `SYNCED` tak memuat `customAgent`.

- [ ] **Step 3: Tambahkan model ke schema**

Di `server/prisma/schema.prisma`, tambahkan **setelah** model `Spec` (sebelum `model Setting`):

```prisma
// SPEC-450 · ADR-0094 · custom agent: persona yang bisa dipilih ulang & dibagi.
// `projectId` null = GLOBAL (semua project); terisi = milik satu project, dan agen project
// MENIMPA agen global bernama sama.
//
// `id` DETERMINISTIK "<projectId|global>:<name>" — bukan cuid. Baris ini disync, dan dengan id
// acak dua mesin yang sama-sama membuat agen global `reviewer` melahirkan DUA baris yang keduanya
// menyeberang lalu bertemu di satu objek JSON `--agents` yang BERKUNCI NAMA; salah satunya hilang
// tanpa jejak. Dengan id deterministik keduanya baris yang SAMA → rekonsiliasi LWW (ADR-0067).
//
// `name` IMMUTABLE: changefeed tak punya operasi hapus, jadi rename yang mengubah id meninggalkan
// baris yatim di setiap mesin lain. Ganti nama = hapus + buat baru.
//
// GOTCHA: `@@unique([projectId, name])` TIDAK mencegah dua agen global bernama sama — pada indeks
// unik SQLite NULL saling BERBEDA. Yang mencegahnya adalah PK deterministik di atas; indeks ini
// jaring kedua untuk baris ber-project.
model CustomAgent {
  id           String   @id
  projectId    String?
  name         String
  description  String
  instructions String
  tools        Json?
  model        String?
  mentions     Json?
  enabled      Boolean  @default(true)
  version      Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  project      Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, name])
  @@index([projectId])
}
```

Tambahkan relasi balik di `model Project` (sisipkan bersama relasi lain yang sudah ada di sana):

```prisma
  customAgents CustomAgent[]
```

- [ ] **Step 4: Tulis migration TANGAN**

`migrate dev` **me-reset DB saat ada drift worktree tetangga** — jangan pakai. Buat
`server/prisma/migrations/20260801120000_custom_agent/migration.sql`:

```sql
-- SPEC-450 · ADR-0094 · katalog custom agent (global & per project), ikut changefeed sync.
--
-- Tabel baru → `CREATE TABLE` polos; tak ada redefinisi tabel seperti migration SPEC-408.
-- `id` deterministik "<projectId|global>:<name>" ditulis aplikasi, bukan default DB.
--
-- CATATAN indeks unik: pada SQLite, NULL saling BERBEDA di indeks unik, jadi baris ini TIDAK
-- mencegah dua agen global bernama sama. Yang mencegahnya adalah PK deterministik. Indeks tetap
-- dipasang sebagai jaring kedua untuk baris ber-project.
CREATE TABLE "CustomAgent" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "projectId"    TEXT,
    "name"         TEXT NOT NULL,
    "description"  TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "tools"        JSONB,
    "model"        TEXT,
    "mentions"     JSONB,
    "enabled"      BOOLEAN NOT NULL DEFAULT true,
    "version"      INTEGER NOT NULL DEFAULT 0,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL,
    CONSTRAINT "CustomAgent_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomAgent_projectId_name_key" ON "CustomAgent" ("projectId", "name");
CREATE INDEX "CustomAgent_projectId_idx" ON "CustomAgent" ("projectId");
```

Terapkan & regenerate:

```bash
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server exec prisma generate
```

Expected: `1 migration found` → `Applied`; lalu `Generated Prisma Client`.

- [ ] **Step 5: Daftarkan entitas di sync + PG_ORDER**

Di `server/src/services/sync.ts` baris 10, ubah `SYNCED`:

```ts
export const SYNCED = ["project", "spec", "vps", "sessionResult", "ticket", "ticketAttachment", "customAgent"] as const;
```

Di `FIELDS` (setelah baris `ticketAttachment: [...]`), tambahkan:

```ts
  // SPEC-450 · ADR-0094 · SELURUH kolom bermakna ikut menyeberang. `enabled` & `mentions` wajib
  // ada: `upsert` yang tak menyebut kolom ber-default TETAP berhasil, jadi kolom yang terlewat
  // mendarat sebagai default palsu di tiap client tanpa satu pun error (kelas ADR-0090/0093).
  // `version` tak pernah masuk FIELDS — ia stempel mekanisme sync itu sendiri.
  customAgent: ["projectId", "name", "description", "instructions", "tools", "model", "mentions", "enabled", "createdAt", "updatedAt"],
```

Di `DATE_FIELDS`, tambahkan:

```ts
  customAgent: ["createdAt", "updatedAt"],
```

Di peta `DELEGATE` di berkas yang sama, tambahkan entri `customAgent: prisma.customAgent` mengikuti
bentuk entri yang sudah ada di sana.

Di `cli/src/commands/migrate-pg.ts` baris 16-24, tambahkan `"CustomAgent"` **sesudah** `"Spec"`
(urutan FK: `Project` → `Spec` → `CustomAgent`):

```ts
export const PG_ORDER = [
  "Project", "Spec", "CustomAgent", "Setting", "Notification",
  "User", "Session", "DeviceToken", "AgentToken",
  "Vps", "VpsAuditSnapshot", "VpsItemState",
  "SessionResult", "SessionHistory",
  "SyncLog", "LocalBinding", "SyncOutbox", "SyncState", "SyncConflict",
  "SchedulerQueueItem", "RuntimeConfig", "LeadDecision",
  "Ticket", "TicketAttachment",
] as const;
```

- [ ] **Step 6: Jalankan test, pastikan LULUS**

Run: `./node_modules/.bin/vitest run server/test/custom-agent-sync.test.ts --no-file-parallelism`
Expected: PASS (5 test).

Lalu test DMMF yang menjaga `PG_ORDER` (cari namanya bila berbeda):

Run: `./node_modules/.bin/vitest run cli --no-file-parallelism`
Expected: PASS — bila merah karena `PG_ORDER` tak lengkap, perbaiki daftarnya, bukan test-nya.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck`
Expected: keluar 0.

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations cli/src/commands/migrate-pg.ts server/src/services/sync.ts server/test/custom-agent-sync.test.ts
git commit -m "feat(spec-450): model CustomAgent + migration + wiring changefeed sync

id deterministik <scope>:<name> supaya dua mesin yang membuat nama sama tak
melahirkan dua baris yang salah satunya hilang di objek JSON berkunci nama.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Service resolusi + cache sinkron

**Files:**
- Create: `server/src/services/custom-agents.ts`
- Create: `server/test/custom-agents.service.test.ts`

**Interfaces:**
- Consumes: Task 1 (`effectiveAgents`, `detectCycle`, `mentionsOf`, `toolsOf`, `customAgentId`), Task 2 (`AgentDef`).
- Produces:
  - `toDef(row): AgentDef`
  - `loadCustomAgents(): Promise<void>` — isi ulang cache dari DB
  - `agentDefsFor(projectId: string): AgentDef[]` — **SINKRON**, dari cache
  - `validateGraph(rows: CustomAgentRow[]): { scope: string; cycle: string[] } | null`
  - `unknownMentions(row, rows): string[]`
  - `installCustomAgents(): Promise<void>` — load + daftarkan sumber ke pty

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/custom-agents.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  loadCustomAgents, agentDefsFor, validateGraph, unknownMentions, toDef,
} from "../src/services/custom-agents";
import { customAgentId } from "@hanoman/shared";

const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
  await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "web" } });
});
afterAll(clean);

const mk = (projectId: string | null, name: string, extra: Record<string, unknown> = {}) =>
  prisma.customAgent.create({ data: {
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", ...extra,
  } });

describe("agentDefsFor — resolusi scope (sinkron, dari cache)", () => {
  it("project mendapat agen global + agen project-nya sendiri", async () => {
    await mk(null, "glob");
    await mk("p1", "lokal");
    await mk("p2", "asing");
    await loadCustomAgents();
    expect(agentDefsFor("p1").map((a) => a.name)).toEqual(["glob", "lokal"]);
  });

  it("agen project menimpa global bernama sama", async () => {
    await mk(null, "rev", { instructions: "GLOBAL" });
    await mk("p1", "rev", { instructions: "PROJECT" });
    await loadCustomAgents();
    const defs = agentDefsFor("p1");
    expect(defs).toHaveLength(1);
    expect(defs[0]!.instructions).toBe("PROJECT");
    expect(agentDefsFor("p2")[0]!.instructions).toBe("GLOBAL");
  });

  it("agen yang dimatikan tak ikut", async () => {
    await mk(null, "mati", { enabled: false });
    await loadCustomAgents();
    expect(agentDefsFor("p1")).toHaveLength(0);
  });

  it("project tanpa agen apa pun mengembalikan daftar kosong", async () => {
    await loadCustomAgents();
    expect(agentDefsFor("p1")).toEqual([]);
  });

  it("projectId sintetis (sesi VPS) tak meledak — global tetap terbawa", async () => {
    await mk(null, "glob");
    await loadCustomAgents();
    expect(agentDefsFor("vps:9").map((a) => a.name)).toEqual(["glob"]);
  });

  it("kolom Json rusak dari sync dibaca defensif", async () => {
    await mk(null, "a", { mentions: "bukan array" as never, tools: 42 as never });
    await loadCustomAgents();
    const d = agentDefsFor("p1")[0]!;
    expect(d.mentions).toEqual([]);
    expect(d.tools).toBeNull();
  });
});

describe("validateGraph — lapis 1 anti-loop, LINTAS SCOPE (ADR-0094 gotcha 2)", () => {
  const row = (projectId: string | null, name: string, mentions: string[]) => ({
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", tools: null, model: null,
    mentions, enabled: true,
  });

  it("graf asiklik → null", () => {
    expect(validateGraph([row(null, "a", ["b"]), row(null, "b", [])])).toBeNull();
  });

  it("siklus di scope global terdeteksi", () => {
    const r = validateGraph([row(null, "a", ["b"]), row(null, "b", ["a"])]);
    expect(r?.scope).toBe("global");
    expect(r?.cycle).toEqual(["a", "b", "a"]);
  });

  it("SIKLUS YANG HANYA MUNCUL SAAT PROJECT MENIMPA GLOBAL terdeteksi", () => {
    // global: g -> h (asiklik). project p1 menimpa `h` dengan versi yang menunjuk balik ke g.
    const r = validateGraph([
      row(null, "g", ["h"]),
      row(null, "h", []),
      row("p1", "h", ["g"]),
    ]);
    expect(r?.scope).toBe("p1");
    expect(r?.cycle).toEqual(["g", "h", "g"]);
  });

  it("agen project yang DIMATIKAN memutus siklus (ia menyembunyikan global)", () => {
    const r = validateGraph([
      row(null, "g", ["h"]),
      row(null, "h", ["g"]),
      { ...row("p1", "h", []), enabled: false },
    ]);
    expect(r?.scope).toBe("global"); // global tetap pecah; p1 tidak
  });
});

describe("unknownMentions", () => {
  const row = (projectId: string | null, name: string, mentions: string[]) => ({
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", tools: null, model: null, mentions, enabled: true,
  });

  it("agen global hanya boleh menyebut agen global", () => {
    const all = [row(null, "g", ["lokal"]), row("p1", "lokal", [])];
    expect(unknownMentions(all[0]!, all)).toEqual(["lokal"]);
  });

  it("agen project boleh menyebut agen project DAN global", () => {
    const all = [row(null, "g", []), row("p1", "a", ["g", "b"]), row("p1", "b", [])];
    expect(unknownMentions(all[1]!, all)).toEqual([]);
  });

  it("nama yang benar-benar tak ada dilaporkan", () => {
    const all = [row("p1", "a", ["hantu"])];
    expect(unknownMentions(all[0]!, all)).toEqual(["hantu"]);
  });

  it("agen project tak bisa menyebut agen project LAIN", () => {
    const all = [row("p1", "a", ["asing"]), row("p2", "asing", [])];
    expect(unknownMentions(all[0]!, all)).toEqual(["asing"]);
  });
});

describe("toDef", () => {
  it("memetakan baris DB ke bentuk render runner", () => {
    const d = toDef({
      id: "global:a", projectId: null, name: "a", description: "desc",
      instructions: "ins", tools: ["Read"], model: "haiku", mentions: ["b"], enabled: true,
    });
    expect(d).toEqual({
      name: "a", description: "desc", instructions: "ins",
      tools: ["Read"], model: "haiku", mentions: ["b"],
    });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `./node_modules/.bin/vitest run server/test/custom-agents.service.test.ts --no-file-parallelism`
Expected: FAIL — modul `../src/services/custom-agents` tak ada.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/services/custom-agents.ts`:

```ts
import { prisma } from "../db";
import {
  effectiveAgents, detectCycle, mentionsOf, toolsOf, GLOBAL_SCOPE,
  type CustomAgent, type AgentNode,
} from "@hanoman/shared";
import type { AgentDef } from "@hanoman/runner";
import { registerCustomAgentSource } from "./pty";

// SPEC-450 · ADR-0094 keputusan 7 · katalog custom agent untuk lapis proses.
//
// Cache WAJIB sinkron: `createSession` sinkron sementara Prisma tidak, dan definisi agen harus
// sudah ada saat argv dirakit — bukan sesaat sesudahnya. Pola yang sama dipakai `effectiveStr()`
// (config runtime, ADR-0049). `pty.ts` tetap nol dependensi DB: ia memanggil sumber yang
// mendaftarkan diri, dan karena `createSession` adalah pintu SATU-SATUNYA semua kelahiran sesi,
// tak ada call site yang bisa lupa memasangnya (kelas bug SPEC-431/ADR-0093).

/** Bentuk baris yang cukup untuk semua keputusan di berkas ini (bukan tipe Prisma penuh). */
export type CustomAgentRow = {
  id: string;
  projectId: string | null;
  name: string;
  description: string;
  instructions: string;
  tools: unknown;
  model: string | null;
  mentions: unknown;
  enabled: boolean;
};

let cache: CustomAgentRow[] = [];

const asCustomAgent = (r: CustomAgentRow): CustomAgent => ({
  id: r.id, projectId: r.projectId, name: r.name,
  description: r.description, instructions: r.instructions,
  tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
  enabled: r.enabled,
  createdAt: "", updatedAt: "",   // tak dipakai lapis ini
});

export function toDef(r: CustomAgentRow): AgentDef {
  return {
    name: r.name, description: r.description, instructions: r.instructions,
    tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
  };
}

/** Isi ulang cache dari DB. Dipanggil saat boot dan sesudah SETIAP mutasi (route & sync). */
export async function loadCustomAgents(): Promise<void> {
  try {
    cache = (await prisma.customAgent.findMany()) as unknown as CustomAgentRow[];
  } catch {
    // Katalog agen tak pernah boleh menggagalkan boot maupun kelahiran sesi (ADR-0094 keputusan 7).
    cache = [];
  }
}

/** SINKRON — dibaca dari titik cekik `createSession`. */
export function agentDefsFor(projectId: string): AgentDef[] {
  const globals = cache.filter((r) => r.projectId === null).map(asCustomAgent);
  const project = cache.filter((r) => r.projectId === projectId).map(asCustomAgent);
  return effectiveAgents(globals, project).map((a) => toDef({
    id: a.id, projectId: a.projectId, name: a.name, description: a.description,
    instructions: a.instructions, tools: a.tools, model: a.model,
    mentions: a.mentions, enabled: a.enabled,
  }));
}

/**
 * ADR-0094 gotcha 2 · memeriksa graf global SAJA tidak cukup. Agen project boleh menimpa nama
 * global, jadi `g→h` yang asiklik di scope global bisa menjadi `g→h(project)→g` di dalam satu
 * project. Validasi berjalan atas scope global DAN setiap project yang punya custom agent.
 */
export function validateGraph(rows: CustomAgentRow[]): { scope: string; cycle: string[] } | null {
  const scopes = [null, ...new Set(rows.map((r) => r.projectId).filter((p): p is string => p !== null))];
  for (const scope of scopes) {
    const globals = rows.filter((r) => r.projectId === null).map(asCustomAgent);
    const project = scope === null ? [] : rows.filter((r) => r.projectId === scope).map(asCustomAgent);
    const nodes: AgentNode[] = effectiveAgents(globals, project)
      .map((a) => ({ name: a.name, mentions: a.mentions ?? [] }));
    const cycle = detectCycle(nodes);
    if (cycle) return { scope: scope ?? GLOBAL_SCOPE, cycle };
  }
  return null;
}

/**
 * Nama di `mentions` yang tak terlihat dari scope si penyebut. Agen GLOBAL hanya boleh menyebut
 * agen global — kalau tidak, definisi global akan bergantung pada isi satu project dan tak lagi
 * bisa dipakai di project lain.
 */
export function unknownMentions(row: CustomAgentRow, all: CustomAgentRow[]): string[] {
  const visible = new Set(
    all
      .filter((r) => r.projectId === null || (row.projectId !== null && r.projectId === row.projectId))
      .map((r) => r.name),
  );
  return mentionsOf(row.mentions).filter((m) => !visible.has(m));
}

/** Dipanggil sekali dari server.ts, SEBELUM sesi pertama bisa lahir. */
export async function installCustomAgents(): Promise<void> {
  await loadCustomAgents();
  registerCustomAgentSource((projectId) => agentDefsFor(projectId));
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `./node_modules/.bin/vitest run server/test/custom-agents.service.test.ts --no-file-parallelism`
Expected: PASS. (Task 6 yang menambahkan `registerCustomAgentSource` — sampai itu ada, impor akan
gagal; **kerjakan Task 6 Step 3 lebih dulu bila TypeScript mengeluh**, atau tambahkan stub-nya di
`pty.ts` sekarang dan lengkapi di Task 6.)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/custom-agents.ts server/test/custom-agents.service.test.ts
git commit -m "feat(spec-450): service custom agent — cache sinkron + validasi siklus lintas scope

Memeriksa graf global saja tidak cukup: agen project bisa menimpa nama global,
jadi g->h yang asiklik secara global bisa jadi g->h(project)->g di satu project.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Route CRUD + domain capability `agents`

**Files:**
- Create: `server/src/routes/custom-agents.ts`
- Modify: `shared/src/agent.ts` (`CAPABILITY_IDS`, `CAPABILITIES`, `CAPABILITY_DOMAINS`)
- Modify: `server/src/services/agent-capabilities.ts:capabilityForRoute`
- Modify: `server/src/app.ts` (import + `await api.register(customAgents);`)
- Create: `server/test/custom-agents.route.test.ts`

**Interfaces:**
- Consumes: Task 1 (`zCreateCustomAgent`, `zUpdateCustomAgent`, `customAgentId`), Task 4 (`validateGraph`, `unknownMentions`, `loadCustomAgents`).
- Produces: `GET/POST/PATCH/DELETE /api/custom-agents`, capability `agents:read` / `agents:write`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/custom-agents.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { customAgentId } from "@hanoman/shared";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
});
afterAll(clean);

const post = (payload: unknown) => app.inject({ method: "POST", url: "/api/custom-agents", payload });

// SPEC-405 · kelas bug yang tak boleh terulang: prefix dipetakan ke izin BACA tanpa melihat method.
describe("capabilityForRoute · agents (ADR-0094 keputusan 8)", () => {
  it("dipetakan MENURUT METHOD", () => {
    expect(capabilityForRoute("GET", "/api/custom-agents")).toBe("agents:read");
    expect(capabilityForRoute("POST", "/api/custom-agents")).toBe("agents:write");
    expect(capabilityForRoute("PATCH", "/api/custom-agents/global:a")).toBe("agents:write");
    expect(capabilityForRoute("DELETE", "/api/custom-agents/global:a")).toBe("agents:write");
  });
});

describe("POST /api/custom-agents", () => {
  it("membuat agen global dengan id deterministik", async () => {
    const r = await post({ name: "rev", description: "tinjau", instructions: "kamu peninjau" });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBe("global:rev");
    expect(r.json().projectId).toBeNull();
  });

  it("membuat agen project", async () => {
    const r = await post({ projectId: "p1", name: "rev", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBe("p1:rev");
  });

  it("menolak 400 untuk nama yang bukan slug", async () => {
    expect((await post({ name: "Rev", description: "d", instructions: "i" })).statusCode).toBe(400);
  });

  it("menolak 400 untuk projectId yang tak ada", async () => {
    const r = await post({ projectId: "hantu", name: "a", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(400);
  });

  it("menolak 409 untuk nama yang sudah dipakai di scope yang sama", async () => {
    await post({ name: "rev", description: "d", instructions: "i" });
    const r = await post({ name: "rev", description: "d2", instructions: "i2" });
    expect(r.statusCode).toBe(409);
  });

  it("nama yang sama di scope BERBEDA diterima", async () => {
    await post({ name: "rev", description: "d", instructions: "i" });
    const r = await post({ projectId: "p1", name: "rev", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(201);
  });

  it("menolak 400 untuk mention ke nama yang tak terlihat", async () => {
    const r = await post({ name: "a", description: "d", instructions: "i", mentions: ["hantu"] });
    expect(r.statusCode).toBe(400);
    expect(r.json().unknown).toEqual(["hantu"]);
  });

  it("menolak 409 saat mention menutup SIKLUS, dan menyebut jalurnya", async () => {
    await post({ name: "a", description: "d", instructions: "i" });
    await post({ name: "b", description: "d", instructions: "i", mentions: ["a"] });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:a", payload: { mentions: ["b"] },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().cycle).toEqual(["a", "b", "a"]);
    expect(r.json().scope).toBe("global");
  });

  it("menolak 409 untuk siklus yang HANYA muncul karena project menimpa global", async () => {
    await post({ name: "g", description: "d", instructions: "i", mentions: ["h"] });
    await post({ name: "h", description: "d", instructions: "i" });
    const r = await post({ projectId: "p1", name: "h", description: "d", instructions: "i", mentions: ["g"] });
    expect(r.statusCode).toBe(409);
    expect(r.json().scope).toBe("p1");
  });
});

describe("GET /api/custom-agents", () => {
  it("tanpa query mengembalikan agen global saja", async () => {
    await post({ name: "g", description: "d", instructions: "i" });
    await post({ projectId: "p1", name: "l", description: "d", instructions: "i" });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents" });
    expect(r.json().map((a: { name: string }) => a.name)).toEqual(["g"]);
  });

  it("dengan projectId mengembalikan himpunan EFEKTIF, ditandai inherited", async () => {
    await post({ name: "g", description: "d", instructions: "i" });
    await post({ projectId: "p1", name: "l", description: "d", instructions: "i" });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents?projectId=p1" });
    const rows = r.json() as { name: string; inherited: boolean }[];
    expect(rows.map((a) => a.name)).toEqual(["g", "l"]);
    expect(rows.find((a) => a.name === "g")!.inherited).toBe(true);
    expect(rows.find((a) => a.name === "l")!.inherited).toBe(false);
  });

  it("agen yang dimatikan tetap terlihat di daftar (UI harus bisa menghidupkannya lagi)", async () => {
    await post({ name: "g", description: "d", instructions: "i", enabled: false });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents" });
    expect(r.json()).toHaveLength(1);
    expect(r.json()[0].enabled).toBe(false);
  });
});

describe("PATCH /api/custom-agents/:id", () => {
  it("menolak 400 saat mencoba mengubah nama (changefeed tak punya operasi hapus)", async () => {
    await post({ name: "a", description: "d", instructions: "i" });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:a", payload: { name: "b" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("mengubah instruksi & enabled", async () => {
    await post({ name: "a", description: "d", instructions: "i" });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:a",
      payload: { instructions: "baru", enabled: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().instructions).toBe("baru");
    expect(r.json().enabled).toBe(false);
  });

  it("404 untuk id yang tak ada", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:hantu", payload: { enabled: false },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("DELETE /api/custom-agents/:id", () => {
  it("menghapus agen DAN mencabut namanya dari mentions agen lain", async () => {
    await post({ name: "b", description: "d", instructions: "i" });
    await post({ name: "a", description: "d", instructions: "i", mentions: ["b"] });
    const r = await app.inject({ method: "DELETE", url: "/api/custom-agents/global:b" });
    expect(r.statusCode).toBe(204);
    const a = await prisma.customAgent.findUnique({ where: { id: customAgentId(null, "a") } });
    expect(a?.mentions).toEqual([]);
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/custom-agents/global:hantu" })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `./node_modules/.bin/vitest run server/test/custom-agents.route.test.ts --no-file-parallelism`
Expected: FAIL — `capabilityForRoute` mengembalikan `null`, route 404.

- [ ] **Step 3: Tambahkan capability domain**

Di `shared/src/agent.ts`, tambahkan ke `CAPABILITY_IDS` **setelah** `"lead:read", "lead:write",`:

```ts
  // SPEC-450 · ADR-0094 · custom agent. Domain TERSENDIRI, dipetakan MENURUT METHOD: menulis
  // definisi agen mengubah apa yang dilihat SETIAP sesi baru di seluruh workspace, jadi izin
  // baca tak pernah cukup untuk itu (kelas bug SPEC-405).
  "agents:read", "agents:write",
```

Ke `CAPABILITIES`, tambahkan di akhir array:

```ts
  { id: "agents:read", domain: "agents", access: "read", label: "Custom agent — baca", desc: "Lihat katalog custom agent global & per project." },
  { id: "agents:write", domain: "agents", access: "write", label: "Custom agent — tulis", desc: "Buat/ubah/hapus custom agent; definisinya dipakai setiap sesi baru.", risk: "exec" },
```

Ke `CAPABILITY_DOMAINS`, tambahkan di akhir array:

```ts
  { domain: "agents", label: "Custom agent", desc: "Katalog persona agen global & per project." },
```

Di `server/src/services/agent-capabilities.ts`, tambahkan **sebelum** baris `if (top === "settings" …)`:

```ts
  // SPEC-450 · ADR-0094 keputusan 8 · dipetakan MENURUT METHOD, bukan prefix (kelas bug SPEC-405).
  if (top === "custom-agents") return rw("agents");
```

- [ ] **Step 4: Tulis route**

Buat `server/src/routes/custom-agents.ts`:

```ts
import type { FastifyInstance } from "fastify";
import {
  zCreateCustomAgent, zUpdateCustomAgent, customAgentId, mentionsOf,
} from "@hanoman/shared";
import { prisma } from "../db";
import { notifySynced } from "../services/sync-notify";
import {
  loadCustomAgents, validateGraph, unknownMentions, type CustomAgentRow,
} from "../services/custom-agents";

// SPEC-450 · ADR-0094 · CRUD katalog custom agent. Integritas ditegakkan DI BOUNDARY (rujukan,
// siklus, duplikat) karena kolom `mentions` adalah `Json` tanpa FK — pola `dependsOn` (ADR-0093).

const rowsOf = async (): Promise<CustomAgentRow[]> =>
  (await prisma.customAgent.findMany()) as unknown as CustomAgentRow[];

/** Satu tempat yang tahu bentuk respons; `inherited` hanya bermakna saat diminta per-project. */
const view = (r: CustomAgentRow & { createdAt?: Date; updatedAt?: Date }, projectId?: string) => ({
  id: r.id, projectId: r.projectId, name: r.name,
  description: r.description, instructions: r.instructions,
  tools: r.tools ?? null, model: r.model, mentions: mentionsOf(r.mentions),
  enabled: r.enabled,
  ...(projectId ? { inherited: r.projectId === null } : {}),
});

export default async function (app: FastifyInstance) {
  app.get("/custom-agents", async (req) => {
    const projectId = (req.query as { projectId?: string }).projectId;
    const rows = await prisma.customAgent.findMany({
      where: projectId ? { OR: [{ projectId: null }, { projectId }] } : { projectId: null },
      orderBy: { name: "asc" },
    }) as unknown as CustomAgentRow[];
    // Nama yang ditimpa project hanya boleh muncul SEKALI — versi project yang menang.
    const byName = new Map<string, CustomAgentRow>();
    for (const r of rows) if (r.projectId === null) byName.set(r.name, r);
    for (const r of rows) if (r.projectId !== null) byName.set(r.name, r);
    return [...byName.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => view(r, projectId));
  });

  app.post("/custom-agents", async (req, reply) => {
    const parsed = zCreateCustomAgent.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;
    const projectId = p.projectId ?? null;

    if (projectId && !(await prisma.project.findUnique({ where: { id: projectId } })))
      return reply.code(400).send({ error: "project tak ditemukan", projectId });

    const id = customAgentId(projectId, p.name);
    if (await prisma.customAgent.findUnique({ where: { id } }))
      return reply.code(409).send({ error: "nama sudah dipakai di scope ini", id });

    const candidate: CustomAgentRow = {
      id, projectId, name: p.name, description: p.description, instructions: p.instructions,
      tools: p.tools ?? null, model: p.model ?? null, mentions: p.mentions ?? [],
      enabled: p.enabled ?? true,
    };
    const all = [...(await rowsOf()), candidate];
    const unknown = unknownMentions(candidate, all);
    if (unknown.length) return reply.code(400).send({ error: "mention tak dikenal", unknown });
    const cycle = validateGraph(all);
    if (cycle) return reply.code(409).send({ error: "mention membentuk siklus", ...cycle });

    const row = await prisma.customAgent.create({ data: {
      id, projectId, name: p.name, description: p.description, instructions: p.instructions,
      tools: candidate.tools as never, model: candidate.model,
      mentions: candidate.mentions as never, enabled: candidate.enabled,
    } });
    await loadCustomAgents();
    await notifySynced("customAgent", id);
    return reply.code(201).send(view(row as unknown as CustomAgentRow));
  });

  app.patch("/custom-agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // `name`/`projectId` sengaja DI LUAR skema update: id diturunkan dari keduanya, dan changefeed
    // tak punya operasi hapus (ADR-0094 keputusan 2). Ditolak eksplisit, bukan diabaikan senyap.
    const body = req.body as Record<string, unknown>;
    if ("name" in body || "projectId" in body)
      return reply.code(400).send({ error: "name & projectId tak bisa diubah — hapus lalu buat baru" });

    const parsed = zUpdateCustomAgent.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const existing = await prisma.customAgent.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not found" });

    const candidate: CustomAgentRow = {
      ...(existing as unknown as CustomAgentRow),
      ...parsed.data,
      mentions: parsed.data.mentions ?? mentionsOf((existing as unknown as CustomAgentRow).mentions),
    };
    const all = (await rowsOf()).map((r) => (r.id === id ? candidate : r));
    const unknown = unknownMentions(candidate, all);
    if (unknown.length) return reply.code(400).send({ error: "mention tak dikenal", unknown });
    const cycle = validateGraph(all);
    if (cycle) return reply.code(409).send({ error: "mention membentuk siklus", ...cycle });

    const row = await prisma.customAgent.update({ where: { id }, data: {
      description: candidate.description, instructions: candidate.instructions,
      tools: candidate.tools as never, model: candidate.model,
      mentions: candidate.mentions as never, enabled: candidate.enabled,
    } });
    await loadCustomAgents();
    await notifySynced("customAgent", id);
    return view(row as unknown as CustomAgentRow);
  });

  app.delete("/custom-agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.customAgent.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not found" });

    await prisma.customAgent.delete({ where: { id } });
    // Cabut namanya dari mentions agen lain — tanpa ini rujukan yatim mengunci UI dan setiap
    // penyuntingan berikutnya ditolak "mention tak dikenal" (cermin DELETE /specs/:id, ADR-0093).
    const name = (existing as unknown as CustomAgentRow).name;
    for (const r of await rowsOf()) {
      const m = mentionsOf(r.mentions);
      if (!m.includes(name)) continue;
      await prisma.customAgent.update({
        where: { id: r.id }, data: { mentions: m.filter((x) => x !== name) as never },
      });
      await notifySynced("customAgent", r.id);
    }
    await loadCustomAgents();
    return reply.code(204).send();
  });
}
```

Di `server/src/app.ts`, tambahkan impor setelah `import lead from "./routes/lead";`:

```ts
import customAgents from "./routes/custom-agents";
```

dan registrasi setelah `await api.register(lead);` (atau di akhir daftar `api.register`):

```ts
    await api.register(customAgents);
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `./node_modules/.bin/vitest run server/test/custom-agents.route.test.ts server/test/agent-capabilities.test.ts --no-file-parallelism`
Expected: PASS. Bila `agent-capabilities.test.ts` merah karena jumlah capability berubah, perbarui
angka yang di-assert di sana — itu memang kontraknya.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`
Expected: keluar 0.

- [ ] **Step 7: Commit**

```bash
git add shared/src/agent.ts server/src/routes/custom-agents.ts server/src/services/agent-capabilities.ts server/src/app.ts server/test/custom-agents.route.test.ts server/test/agent-capabilities.test.ts
git commit -m "feat(spec-450): CRUD /api/custom-agents + domain capability agents (per method)

409 saat mention menutup siklus, termasuk siklus yang HANYA muncul karena
agen project menimpa nama global. DELETE mencabut rujukan yatim.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Wiring di titik cekik `createSession`

**Files:**
- Modify: `server/src/services/pty.ts` (dekat `registerSessionHooks`, lalu di dalam `createSession`)
- Modify: `runner/src/agent-cli.ts` (`AgentFlagsOpts` + `agentFlags`)
- Modify: `server/src/server.ts` (panggil `installCustomAgents()`)
- Create: `server/test/custom-agents.pty.test.ts`
- Modify: `runner/test/agent-cli.test.ts` (bila ada; kalau tidak, buat asersi di test Task 2)

**Interfaces:**
- Consumes: Task 2 (`renderAgentsJson`, `agentRosterBlock`, `AgentDef`), Task 4 (`agentDefsFor`).
- Produces:
  - `registerCustomAgentSource(fn: (projectId: string) => AgentDef[]): void` di `pty.ts`
  - `agentsFilePath(id: string): string` di `pty.ts`
  - `agentFlags({ …, agentsFile?: string })` — **claude saja**

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/custom-agents.pty.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  createSession, killSession, registerCustomAgentSource, agentsFilePath, promptFilePath,
} from "../src/services/pty";
import type { AgentDef } from "@hanoman/runner";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// SPEC-450 · ADR-0094 keputusan 7 · kontrak ARGV. Diperiksa lewat argv pane tmux + isi berkas,
// BUKAN lewat bentuk respons — assert bentuk respons LULUS PALSU (pelajaran `sessionModel()`).

const defs: AgentDef[] = [
  { name: "rev", description: "tinjau", instructions: "kamu peninjau", tools: null, model: null, mentions: ["tes"] },
  { name: "tes", description: "uji", instructions: "kamu penguji", tools: null, model: null, mentions: [] },
];

let cwd: string;
const ids: string[] = [];
const born = (id: string) => { ids.push(id); return id; };

beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "hnm-ca-")); });
afterEach(() => { for (const id of ids.splice(0)) { try { killSession(id); } catch { /* ok */ } } registerCustomAgentSource(() => []); });

/** argv pane tmux — satu-satunya bukti yang tak bisa lulus palsu. */
const paneCmd = (id: string): string => {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  return execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman",
    "list-panes", "-t", `hanoman-${id}`, "-F", "#{pane_start_command}"], { encoding: "utf8" });
};

describe("createSession · claude", () => {
  it("memasang --agents dari BERKAS, bukan JSON inline (tmux membatasi satu command ~16 KB)", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-1"), agent: "claude", prompt: "halo" });
    const cmd = paneCmd(s.id);
    expect(cmd).toContain("--agents");
    expect(cmd).toContain(`"$(cat ${agentsFilePath(s.id)})"`);
    expect(cmd).not.toContain('"description"'); // JSON tak pernah inline di command tmux
  });

  it("berkasnya berisi JSON yang benar, dan agen daun TIDAK punya Task", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-2"), agent: "claude", prompt: "halo" });
    const j = JSON.parse(readFileSync(agentsFilePath(s.id), "utf8"));
    expect(Object.keys(j).sort()).toEqual(["rev", "tes"]);
    expect(j.rev.tools).toContain("Task");
    expect(j.tes.tools).not.toContain("Task");
  });

  it("tanpa custom agent, argv TIDAK memuat --agents dan berkasnya tak dibuat", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-claude-3"), agent: "claude", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });

  it("prompt claude TIDAK ditempeli roster (claude memakai jalur native)", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-4"), agent: "claude", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
  });
});

describe("createSession · codex", () => {
  it("TIDAK memasang --agents, tapi menempelkan roster ke prompt", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-codex-1"), agent: "codex", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt.startsWith("halo")).toBe(true);
    expect(prompt).toContain("@rev");
    expect(prompt).toContain("kamu peninjau");
  });

  it("tanpa custom agent, prompt codex byte-identik dengan sebelumnya", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-codex-2"), agent: "codex", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
  });
});

describe("sesi shell mentah (opts.command)", () => {
  it("tak menerima apa pun — tak ada agen di sana", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-shell-1"), command: ["/bin/sh", "-c", "sleep 30"] });
    const cmd = paneCmd(s.id);
    expect(cmd).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });
});

describe("sumber yang melempar", () => {
  it("tak menggagalkan kelahiran sesi (katalog agen opsional)", () => {
    registerCustomAgentSource(() => { throw new Error("DB mati"); });
    const s = createSession("p1", cwd, { id: born("ca-throw-1"), agent: "claude", prompt: "halo" });
    expect(s.id).toBe("ca-throw-1");
    expect(paneCmd(s.id)).not.toContain("--agents");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `./node_modules/.bin/vitest run server/test/custom-agents.pty.test.ts --no-file-parallelism`
Expected: FAIL — `registerCustomAgentSource` / `agentsFilePath` belum diekspor.

> Bila 1–3 test `pty` gagal dengan sesi tmux sisa dari run sebelumnya, **jalankan ulang dulu**
> sebelum menyalahkan perubahanmu (jebakan yang sudah terdokumentasi di repo ini).

- [ ] **Step 3: Tambahkan sumber + jalur berkas di `pty.ts`**

Di `server/src/services/pty.ts`, **setelah** blok `registerSessionHooks` (sekitar baris 206),
tambahkan:

```ts
// SPEC-450 · ADR-0094 keputusan 7 · katalog custom agent. `pty.ts` tetap NOL DEPENDENSI DB — ia
// hanya memanggil sumber yang mendaftarkan diri (services/custom-agents.ts, dipasang dari
// server.ts), persis pola registerSessionHooks/registerSchedulerSource. Karena ia dibaca di
// `createSession` — pintu SATU-SATUNYA semua kelahiran sesi — tak ada call site yang perlu diubah
// dan tak ada yang bisa lupa memasangnya (kelas bug SPEC-431/ADR-0093).
type CustomAgentSource = (projectId: string) => AgentDef[];
let customAgentSource: CustomAgentSource = () => [];
export function registerCustomAgentSource(fn: CustomAgentSource): void { customAgentSource = fn; }
// Gagal baca → daftar KOSONG. Katalog agen tak pernah boleh menggagalkan kelahiran sesi.
const customAgentsFor = (projectId: string): AgentDef[] => {
  try { return customAgentSource(projectId); } catch { return []; }
};
```

Tambahkan impor di kepala berkas (gabungkan dengan impor `@hanoman/runner` yang sudah ada):

```ts
import { renderAgentsJson, agentRosterBlock, type AgentDef } from "@hanoman/runner";
```

Tambahkan jalur berkas di dekat `promptFilePath`/`goalGatePath` (ikuti bentuknya persis; ia berada
di tmpdir, **bukan** turunan cwd):

```ts
/** Berkas JSON `--agents`. Di tmpdir seperti berkas prompt — cwd bisa homedir (sesi VPS). */
export const agentsFilePath = (id: string): string => promptFilePath(id).replace(/prompt$/, "agents.json");
```

> Bila `promptFilePath` tidak berakhiran `prompt`, sesuaikan: yang penting berkas ini **berdampingan
> dengan berkas prompt di tmpdir** dan namanya diturunkan dari `id` secara deterministik.

- [ ] **Step 4: Rakit argv & prompt di `createSession`**

Di `createSession`, **sebelum** blok `let promptArg = "";`, hitung defs dan siapkan roster:

```ts
  // SPEC-450 · ADR-0094 · custom agent. Dihitung SEBELUM prompt ditulis: jalur codex menempelkan
  // roster ke prompt, jadi ia harus sudah ada saat berkas prompt dibuat.
  const agentForDefs: Agent = opts.agent ?? "claude";
  const customDefs = opts.command ? [] : customAgentsFor(projectId);
  const rosterBlock = agentForDefs === "codex" ? agentRosterBlock(customDefs) : "";
```

Ubah penulisan berkas prompt agar roster ikut (ganti isi blok `if (!opts.command && opts.prompt)`):

```ts
  let promptArg = "";
  if (!opts.command && opts.prompt) {
    const promptFile = promptFilePath(id);
    mkdirSync(dirname(promptFile), { recursive: true });
    // codex tak punya padanan `--agents` yang bisa diverifikasi (ADR-0094 M5), jadi rosternya
    // ditempel ke AKHIR prompt — kanal yang memang milik hanoman sendiri. `agentRosterBlock`
    // mengembalikan "" saat katalog kosong, jadi prompt sesi lain byte-identik seperti sebelumnya.
    writeFileSync(promptFile, opts.prompt + rosterBlock);
    promptArg = `"$(cat ${sq(promptFile)})"`;
  }
```

Di cabang `else` (perakitan argv agen), **sesudah** `goalGate` ditulis dan **sebelum** `agentFlags`
dipanggil, tulis berkas `--agents`:

```ts
    // SPEC-450 · ADR-0094 gotcha 4 · JSON `--agents` lewat BERKAS, bukan inline: instruksi agen
    // adalah prosa dan tmux membatasi SATU command ±16 KB — kelas kegagalan SPEC-223, dibayar
    // sekali dan dipakai ulang. Hasil command-substitution dikutip ganda, jadi isinya tak dipindai
    // ulang shell (aman dari injeksi) dan batasnya ARG_MAX, bukan 16 KB.
    let agentsFile: string | undefined;
    if (agent === "claude") {
      const json = renderAgentsJson(customDefs);
      if (json) {
        agentsFile = agentsFilePath(id);
        mkdirSync(dirname(agentsFile), { recursive: true });
        writeFileSync(agentsFile, json);
      }
    }
```

Ubah pemanggilan `agentFlags` menjadi:

```ts
    const flags = agentFlags({
      agent, model: opts.model, effort,
      decisionFile: opts.decisionFile, goal: opts.goal, goalGate,
    }).map(sq).join(" ");
    // GOTCHA ADR-0094 #4: `--agents` TIDAK boleh lewat `.map(sq)` seperti flag lain — ia harus
    // tetap berbentuk `"$(cat …)"` supaya `sh -c` yang melahirkan sesi meng-expand-nya. Di-`sq`
    // sekali saja, claude menerima literal `$(cat /tmp/…)` sebagai definisi agen — dan itu tepat
    // kegagalan-senyapnya: JSON tak sah diabaikan tanpa pesan, exit 0, NOL agen.
    const agentsArg = agentsFile ? `--agents "$(cat ${sq(agentsFile)})"` : "";
    argv = [sq(agentBin(agent)), promptArg, flags, agentsArg].filter(Boolean).join(" ");
```

- [ ] **Step 5: `agentFlags` tak berubah bentuknya**

`--agents` **tidak** masuk `agentFlags` justru karena ia tak boleh di-`sq`. Tambahkan komentar di
`runner/src/agent-cli.ts`, tepat di atas cabang claude:

```ts
  // SPEC-450 · ADR-0094 · `--agents` SENGAJA tidak dirakit di sini: seluruh keluaran fungsi ini
  // dikutip `sq()` oleh pemanggil, sementara `--agents` harus tetap berbentuk `"$(cat <file>)"`
  // agar di-expand shell saat sesi lahir. Ia disisipkan di `createSession`, sejajar `promptArg`.
```

- [ ] **Step 6: Pasang sumber saat boot**

Di `server/src/server.ts`, tambahkan impor:

```ts
import { installCustomAgents } from "./services/custom-agents";
```

dan panggilan **sebelum** `startScheduler()` (sesi pertama bisa lahir dari governor):

```ts
  // SPEC-450 · ADR-0094 · muat katalog custom agent & daftarkan sumbernya SEBELUM sesi pertama
  // bisa lahir — governor scheduler & denyut lead keduanya bisa meluncurkan sesi pada tick pertama.
  await installCustomAgents();
```

> `server.ts` sudah berada di dalam `.then(async () => { … })` — bila tidak, bungkus dengan
> `void installCustomAgents().catch((e) => console.error("katalog custom agent:", e));`.

- [ ] **Step 7: Jalankan test, pastikan LULUS**

Run: `./node_modules/.bin/vitest run server/test/custom-agents.pty.test.ts --no-file-parallelism`
Expected: PASS (9 test).

Lalu pastikan sesi lain tak regresi:

Run: `./node_modules/.bin/vitest run server/test/pty.test.ts server/test/session-launch.test.ts --no-file-parallelism`
Expected: PASS. (Sesuaikan nama berkas bila berbeda — cari dengan `ls server/test | grep -E "pty|launch"`.)

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck`
Expected: keluar 0.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/pty.ts server/src/server.ts runner/src/agent-cli.ts server/test/custom-agents.pty.test.ts
git commit -m "feat(spec-450): materialisasi custom agent di titik cekik createSession

claude -> --agents \"\$(cat <file>)\" (berkas tmpdir; tmux membatasi satu command
~16 KB). codex -> blok roster ditempel ke akhir prompt. Sumber mendaftarkan diri
sehingga tak ada call site yang bisa lupa memasangnya.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: UI — panel custom agent di dua permukaan

**Files:**
- Create: `src/src/screens/CustomAgentsPanel.tsx`
- Create: `src/test/custom-agents-panel.test.tsx`
- Modify: `src/src/screens/SettingsScreen.tsx` (tab baru)
- Modify: `src/src/screens/ProjectDetailScreen.tsx` (bagian baru)
- Modify: `src/src/api/` (klien HTTP — ikuti berkas yang sudah ada di direktori itu)

**Interfaces:**
- Consumes: Task 5 (`GET/POST/PATCH/DELETE /api/custom-agents`), Task 1 (`resolveTools`, `AGENT_NAME_RE`, `DEFAULT_AGENT_TOOLS`).
- Produces: `<CustomAgentsPanel projectId={string | null} />`.

- [ ] **Step 1: Baca pola yang ada sebelum menulis**

Run:
```bash
sed -n '1,80p' src/src/screens/SchedulerScreen.tsx
ls src/src/api
ls src/src/ds
```
Ikuti pola fetch, `Card`, `Button`, `Switch`/`Checkbox`, dan gaya (editorial · bone paper · brass
accent) yang sudah dipakai. **Jangan** memperkenalkan pustaka UI baru.

- [ ] **Step 2: Tulis test yang gagal**

Buat `src/test/custom-agents-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomAgentsPanel } from "../src/screens/CustomAgentsPanel";

const rows = [
  { id: "global:rev", projectId: null, name: "rev", description: "tinjau", instructions: "i",
    tools: null, model: null, mentions: ["tes"], enabled: true, inherited: true },
  { id: "p1:tes", projectId: "p1", name: "tes", description: "uji", instructions: "i",
    tools: null, model: null, mentions: [], enabled: true, inherited: false },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => (String(url).includes("custom-agents") ? rows : []),
  })) as unknown as typeof fetch);
});

describe("CustomAgentsPanel", () => {
  it("menampilkan agen efektif project", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    expect(await screen.findByText("rev")).toBeTruthy();
    expect(screen.getByText("tes")).toBeTruthy();
  });

  it("menandai agen warisan global sebagai read-only di permukaan project", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    await screen.findByText("rev");
    expect(screen.getByText(/warisan global/i)).toBeTruthy();
  });

  it("menampilkan tools HASIL RESOLUSI, jadi efek 'Task dicabut' terlihat", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    await screen.findByText("rev");
    // rev ber-mentions → Task ADA; tes daun → Task TIDAK ada
    const revTools = screen.getByTestId("tools-rev").textContent ?? "";
    const tesTools = screen.getByTestId("tools-tes").textContent ?? "";
    expect(revTools).toContain("Task");
    expect(tesTools).not.toContain("Task");
  });

  it("menampilkan jalur siklus apa adanya saat server menolak 409", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: false, status: 409, json: async () => ({ error: "mention membentuk siklus", scope: "global", cycle: ["a", "b", "a"] }) };
      }
      return { ok: true, status: 200, json: async () => [] };
    }) as unknown as typeof fetch);

    render(<CustomAgentsPanel projectId={null} />);
    await userEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    await userEvent.type(screen.getByLabelText(/nama/i), "a");
    await userEvent.type(screen.getByLabelText(/deskripsi/i), "d");
    await userEvent.type(screen.getByLabelText(/instruksi/i), "i");
    await userEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(screen.getByText(/a → b → a/)).toBeTruthy());
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run src/test/custom-agents-panel.test.tsx`
Expected: FAIL — modul `CustomAgentsPanel` tak ada.

> `env -u NODE_ENV` **wajib**: `NODE_ENV=production` yang bocor dari shell membuat RTL `act` gagal
> palsu secara massal.

- [ ] **Step 4: Implementasi panel**

Buat `src/src/screens/CustomAgentsPanel.tsx`. Bentuk yang harus dipenuhi:

- Prop `{ projectId: string | null }`.
- `useEffect` memuat `GET /api/custom-agents` (+ `?projectId=` bila ada).
- Daftar kartu per agen: nama · deskripsi · badge **"warisan global"** bila `inherited` · toggle
  `enabled` · tombol Ubah/Hapus (dinonaktifkan untuk baris `inherited` di permukaan project).
- `data-testid={`tools-${a.name}`}` pada elemen yang merender
  `resolveTools({ tools: a.tools, mentions: a.mentions }).join(", ")` — **hasil resolusi**, supaya
  pencabutan `Task` terlihat operator, bukan tersembunyi.
- Form (tombol "Agen baru"): field berlabel **Nama** (`AGENT_NAME_RE`, dikunci saat mengubah —
  nama immutable), **Deskripsi**, **Instruksi** (textarea), **Model** (opsional), **Tools**
  (opsional; placeholder menyebut `DEFAULT_AGENT_TOOLS`), **Mentions** (checkbox dari agen lain yang
  terlihat).
- Penanganan galat: tampilkan `error` dari respons; untuk 409 bersiklus tampilkan
  `cycle.join(" → ")` dan `scope`; untuk 400 `unknown` tampilkan daftar namanya.
- Kartu yang memuat pane bergulir memakai **`<Card fill>`**, bukan rantai flex lewat `style`
  (SPEC-393) — bila kamu memang membungkusnya dengan `Card`.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run src/test/custom-agents-panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Pasang di dua permukaan**

- `SettingsScreen.tsx`: tambahkan tab **"Custom agent"** yang merender `<CustomAgentsPanel projectId={null} />`.
- `ProjectDetailScreen.tsx`: tambahkan bagian yang merender `<CustomAgentsPanel projectId={project.id} />`.

Jalankan test layar yang tersentuh:

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run src/test --changed "$HANOMAN_BASE_SHA"`
Expected: PASS — dan **pastikan jumlah berkas test > 0**; `--changed` menyalakan
`passWithNoTests`, jadi "no test files" **terlihat hijau** padahal tak menguji apa pun.

- [ ] **Step 7: Typecheck web**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0. (Bila nama paketnya berbeda, jalankan `pnpm -F <nama> typecheck`; lihat
`src/package.json`.)

- [ ] **Step 8: Commit**

```bash
git add src/src/screens/CustomAgentsPanel.tsx src/test/custom-agents-panel.test.tsx src/src/screens/SettingsScreen.tsx src/src/screens/ProjectDetailScreen.tsx src/src/api
git commit -m "feat(spec-450): panel custom agent di Settings (global) & Project detail (per project)

Menampilkan tools HASIL RESOLUSI supaya pencabutan Task untuk agen daun terlihat
operator, bukan tersembunyi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Docs SoT + verifikasi hidup end-to-end

**Files:**
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/skills/hanoman/SKILL.md`
- Modify: `docs/agent-integration.md`
- Modify: `internal/docs/README.md` (pastikan semua yang tersentuh tetap ter-link)

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: docs SoT yang sinkron + bukti hidup bahwa custom agent benar-benar sampai ke agen.

- [ ] **Step 1: Perbarui `data-model.md`**

Tambahkan bagian `CustomAgent` yang memuat: kolom-kolomnya, arti `projectId` null, alasan `id`
deterministik, alasan `name` immutable, dan **gotcha NULL-distinct SQLite** (`@@unique([projectId,
name])` tak mencegah dua agen global bernama sama). Sebut ADR-0094.

- [ ] **Step 2: Perbarui `api-contract.md`**

Tambahkan tabel endpoint `/api/custom-agents` (GET/POST/PATCH/DELETE) berikut kode statusnya:
`201` · `400` (slug, projectId tak ada, mention tak dikenal, upaya mengubah `name`) · `409`
(duplikat scope, siklus + `scope`/`cycle`) · `404` · `204`. Sebut domain capability `agents`
dipetakan **menurut method**.

- [ ] **Step 3: Perbarui `internal/skills/hanoman/SKILL.md`**

Tambahkan satu butir di bagian **Aturan Sesi & Eksekusi**, sesudah butir SPEC-447/ADR-0093, yang
memuat: mekanisme per agen (claude `--agents` via berkas; codex roster di prompt), tiga lapis
anti-loop, titik cekik `createSession` + `registerCustomAgentSource`, dan **ketujuh gotcha**
ADR-0094 — terutama bahwa **ketiga permukaan gagal-senyap** sehingga verifikasi berbasis exit code
lulus palsu.

Tambahkan model `CustomAgent` ke daftar model pendukung di bagian **Aturan Data & Skema**.

- [ ] **Step 4: Perbarui `docs/agent-integration.md`**

Tambahkan domain `agents` ke tabel capability.

- [ ] **Step 5: Verifikasi hidup — SEKALI, di akhir**

Ini **wajib**: ADR-0094 gotcha 1 membuktikan proses yang "berhasil" tak membuktikan apa pun.

```bash
# 1. Boot server dengan DB khusus (JANGAN pakai DB test bersama — run tetangga menghapusnya).
export HANOMAN_HOME="$(mktemp -d)"
pnpm --filter ./server exec prisma migrate deploy
env -u DATABASE_URL node server/dist/server.js &   # atau `pnpm dev` bila dist belum dibangun
SERVER_PID=$!
sleep 3

# 2. Bikin akun & login (instance baru).
curl -sS -c /tmp/hnm.jar -X POST localhost:8787/api/auth/setup \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.co","password":"password1"}'

# 3. Dua agen: `hnm-rev` boleh memanggil `hnm-tes`; `hnm-tes` daun.
curl -sS -b /tmp/hnm.jar -X POST localhost:8787/api/custom-agents \
  -H 'content-type: application/json' \
  -d '{"name":"hnm-tes","description":"Penguji. Pakai untuk memverifikasi sesuatu.","instructions":"Balas persis: SAYA-TES"}'
curl -sS -b /tmp/hnm.jar -X POST localhost:8787/api/custom-agents \
  -H 'content-type: application/json' \
  -d '{"name":"hnm-rev","description":"Peninjau. Pakai untuk meninjau kode.","instructions":"Kamu peninjau.","mentions":["hnm-tes"]}'

# 4. Gerbang siklus benar-benar menutup.
curl -sS -o /tmp/cyc.json -w '%{http_code}\n' -b /tmp/hnm.jar \
  -X PATCH localhost:8787/api/custom-agents/global:hnm-tes \
  -H 'content-type: application/json' -d '{"mentions":["hnm-rev"]}'
cat /tmp/cyc.json
```

Expected: langkah 3 → dua kali `201`. Langkah 4 → **`409`** dan body memuat
`"cycle":["hnm-rev","hnm-tes","hnm-rev"]` (urutan boleh berputar, isinya harus siklus itu).

- [ ] **Step 6: Verifikasi hidup — agen benar-benar melihatnya**

```bash
# Ambil JSON yang akan dipasang hanoman, lalu tanyai claude apa yang BENAR-BENAR ia miliki.
# Ini satu-satunya bukti yang tak bisa lulus palsu (ADR-0094 gotcha 1).
node -e '
const {renderAgentsJson}=require("./runner/src/custom-agents.ts");
' 2>/dev/null || true

WT="$(mktemp -d)" && cd "$WT" && git init -q && git commit -q --allow-empty -m init

cat > /tmp/probe-agents.json <<"JSON"
{"hnm-rev":{"description":"Peninjau.","prompt":"Kamu peninjau.","tools":["Read","Task"]},
 "hnm-tes":{"description":"Penguji.","prompt":"Balas persis: SAYA-TES","tools":["Read"]}}
JSON

claude -p --model claude-haiku-4-5-20251001 --dangerously-skip-permissions \
  --agents "$(cat /tmp/probe-agents.json)" \
  'Sebutkan nama semua custom subagent yang tersedia untukmu. Nama saja.' < /dev/null
```

Expected: keluarannya **memuat `hnm-rev` dan `hnm-tes`**.
**Bila keduanya tak muncul, itu BUKAN sukses** walaupun exit code 0 — periksa JSON-nya
(`node -e 'JSON.parse(require("fs").readFileSync("/tmp/probe-agents.json","utf8"))'`), lalu periksa
argv pane sesi hanoman yang sungguhan (`tmux -L hanoman list-panes -t hanoman-<id> -F '#{pane_start_command}'`)
dan pastikan `--agents "$(cat …)"` **tidak** ter-`sq`.

Bereskan server:

```bash
kill "$SERVER_PID"
```

(**Jangan** `pkill -f node` — itu membunuh sesi agen tetangga.)

- [ ] **Step 7: Jalankan seluruh test yang tersentuh**

Run:
```bash
./node_modules/.bin/vitest run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: PASS, dan **jumlah berkas test yang berjalan > 0**. `--changed` menyalakan
`passWithNoTests` — "no test files" **terlihat hijau** tanpa menguji apa pun, jadi baca angkanya.

Bila `sync-ws.test.ts` merah: ia terbukti **non-deterministik**. Jalankan ulang terisolasi
(`./node_modules/.bin/vitest run server/test/sync-ws.test.ts --no-file-parallelism`) **dan** ulangi
set yang sama sebelum menyalahkan perubahanmu.

- [ ] **Step 8: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck`
Expected: keluar 0. **Jangan** `pnpm -r typecheck` (satu proses tsc per paket sekaligus).

- [ ] **Step 9: Commit + push**

```bash
git add internal/docs docs/agent-integration.md internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-450): data-model, api-contract, SKILL & agent-integration untuk custom agent

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin HEAD:refs/heads/hanoman/spec-450
```

---

## Self-Review

**1. Spec coverage**

| Kebutuhan spec | Task |
|---|---|
| Tambah agent global & per project | 3 (skema), 5 (CRUD), 7 (UI) |
| claude & codex bisa memakainya | 2 (render), 6 (wiring) |
| Antar agent saling mention | 1 (`mentions`, `resolveTools`), 2 (prosa mention), 6 |
| Hindari infinite loop | 1 (`detectCycle`, `resolveTools`), 4 (`validateGraph` lintas scope), 5 (409) |
| Ikut sync | 3 |
| Docs SoT + link index | ADR-0094 (sudah ter-commit) + Task 8 |
| Verifikasi yang tak lulus palsu | 6 (argv pane tmux), 8 Step 5–6 (probe hidup) |

**2. Placeholder scan** — tak ada "TBD"/"nanti". Satu-satunya langkah yang sengaja tak berisi kode
lengkap adalah Task 7 Step 4 (komponen React), karena ia **wajib mengikuti pola DS yang sudah ada di
repo**; bentuk yang harus dipenuhi dieja sebagai daftar kontrak yang diuji Step 2.

**3. Type consistency** — `AgentDef` didefinisikan sekali (Task 2, runner) dan dikonsumsi Task 4 & 6.
`CustomAgentRow` didefinisikan sekali (Task 4) dan dikonsumsi Task 5. `resolveTools`/`detectCycle`/
`effectiveAgents`/`customAgentId`/`mentionsOf`/`toolsOf` semuanya dari Task 1 dan namanya konsisten
di Task 2, 4, 5, 7. `registerCustomAgentSource`/`agentsFilePath` diekspor Task 6 dan dipakai Task 4
(catatan urutan sudah ditulis di Task 4 Step 4).
