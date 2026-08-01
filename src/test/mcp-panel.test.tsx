import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("berganti klien mengganti bentuk konfigurasinya", () => {
    render(<McpPanel />);
    fireEvent.click(screen.getByRole("button", { name: /codex/i }));
    const snippet = screen.getByTestId("mcp-snippet").textContent ?? "";
    expect(snippet).toContain("[mcp_servers.hanoman]");
    expect(snippet).toContain('command = "hanoman"');
  });

  it("sakelar baca-saja menambahkan --read-only ke snippet", () => {
    render(<McpPanel />);
    expect(screen.getByTestId("mcp-snippet").textContent).not.toContain("--read-only");
    fireEvent.click(screen.getByRole("button", { name: /baca-saja/i }));
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
