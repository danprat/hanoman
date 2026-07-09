import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TerminalScreen } from "../src/screens/TerminalScreen";

// TerminalPane membuka WebSocket dan me-mount xterm (butuh canvas). jsdom tidak punya
// keduanya, dan yang diuji di sini adalah tab strip — bukan rendering terminalnya.
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid="pane">{sessionId}</div>,
}));
const listTerminals = vi.fn();
const createTerminal = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    deleteTerminal: vi.fn(),
  },
}));

const projects = [{ id: "p1", name: "hanoman" }];

beforeEach(() => { listTerminals.mockReset(); createTerminal.mockReset(); });

describe("TerminalScreen", () => {
  it("shows an empty state when there are no sessions", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByText("Belum ada sesi terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("pane")).toBeNull();
  });

  it("renders one tab per session and mounts a pane for the active one", async () => {
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111");
  });

  it("marks an exited session so it is visibly dead", async () => {
    listTerminals.mockResolvedValue([{ id: "cccc3333", projectId: "p1", cwd: "/repo", exited: true }]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByText(/berakhir/i)).toBeInTheDocument();
  });
});
