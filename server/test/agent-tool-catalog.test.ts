import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpServerNames, agentToolCatalog, agentToolIds } from "../src/services/agent-tool-catalog";
import { DEFAULT_AGENT_TOOLS, ALL_TOOLS } from "@hanoman/shared";

// SPEC-484 · ADR-0101 keputusan 3 · nama tool MCP yang SEBENARNYA hanya bisa diketahui dengan
// menyambung ke servernya (= melahirkan proses, arah yang ditolak ADR-0094). Yang bisa dibaca
// tanpa proses adalah nama SERVER-nya, dari tiga berkas konfigurasi.

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

  // Terukur pada `~/.codex/config.toml` nyata saat smoke SPEC-484: sub-tabel milik satu server
  // (`[mcp_servers.context7.http_headers]`) melahirkan "server" palsu `context7.http_headers`,
  // yakni entri katalog `mcp__context7.http_headers__*` yang tak pernah bisa ada — persis kelas
  // kegagalan yang spec ini tutup (menawarkan pilihan yang tidak melakukan apa-apa).
  it("SUB-TABEL server bukan server tersendiri", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"),
      `[mcp_servers.context7]\ncommand = "npx"\n\n[mcp_servers.context7.http_headers]\nX = "1"\n\n` +
      `[mcp_servers.node_repl]\ncommand = "npx"\n\n[mcp_servers.node_repl.env]\nA = "b"\n`);
    expect(mcpServerNames()).toEqual(["context7", "node_repl"]);
  });

  it("nama ber-titik yang SUNGGUHAN (berkutip di TOML) tetap utuh", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), `[mcp_servers."my.server"]\ncommand = "npx"\n`);
    expect(mcpServerNames()).toEqual(["my.server"]);
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
