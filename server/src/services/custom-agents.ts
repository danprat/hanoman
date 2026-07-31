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
  return effectiveAgents(globals, project).map((a) => ({
    name: a.name, description: a.description, instructions: a.instructions,
    tools: a.tools, model: a.model, mentions: a.mentions ?? [],
  }));
}

/**
 * ADR-0094 gotcha 2 · memeriksa graf global SAJA tidak cukup. Agen project boleh menimpa nama
 * global, jadi `g→h` yang asiklik di scope global bisa menjadi `g→h(project)→g` di dalam satu
 * project. Validasi berjalan atas scope global DAN setiap project yang punya custom agent.
 */
export function validateGraph(rows: CustomAgentRow[]): { scope: string; cycle: string[] } | null {
  const projectScopes = [...new Set(rows.map((r) => r.projectId).filter((p): p is string => p !== null))];
  const globals = rows.filter((r) => r.projectId === null).map(asCustomAgent);
  for (const scope of [null, ...projectScopes]) {
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
