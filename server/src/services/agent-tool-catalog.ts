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
