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
