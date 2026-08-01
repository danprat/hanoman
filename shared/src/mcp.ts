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
