import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TerminalScreen } from "../src/screens/TerminalScreen";

// TerminalPane membuka WebSocket + xterm (butuh canvas). jsdom tak punya keduanya; yang
// diuji di sini adalah komposisi grid, bukan rendering terminalnya.
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid="pane">{sessionId}</div>,
}));
const listTerminals = vi.fn();
const createTerminal = vi.fn();
const deleteTerminal = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    deleteTerminal: (...a: unknown[]) => deleteTerminal(...a),
  },
}));

const projects = [{ id: "p1", name: "hanoman" }];
const LKEY = "hanoman.terminal.layout";

beforeEach(() => {
  localStorage.clear();
  listTerminals.mockReset(); createTerminal.mockReset(); deleteTerminal.mockReset();
  deleteTerminal.mockResolvedValue(undefined);
});

describe("TerminalScreen (grid)", () => {
  it("empty state saat tak ada sesi & layout default kosong", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByText("Belum ada sesi terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("pane")).toBeNull();
  });

  it("me-mount satu pane per sel terisi — beberapa sekaligus", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: ["aaaa1111", "bbbb2222"] }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getAllByTestId("pane")).toHaveLength(2));
    expect(screen.getByText("aaaa1111")).toBeInTheDocument();
    expect(screen.getByText("bbbb2222")).toBeInTheDocument();
  });

  it("rekonsiliasi: sel yang sesinya sudah lenyap tak me-mount pane", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: ["aaaa1111", "dead0000"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getAllByTestId("pane")).toHaveLength(1));
  });

  it("Sesi baru menaruh sesi di sel kosong pertama", async () => {
    listTerminals.mockResolvedValue([]);
    createTerminal.mockResolvedValue({ id: "newsesi1" });
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("newsesi1"));
  });

  it("menempatkan sesi bebas dari tray ke sel kosong pertama", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    const chip = await screen.findByRole("button", { name: /aaaa11/ }); // chip tray
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("picker sel kosong menempatkan sesi bebas", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: [null, null] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    const picker = (await screen.findAllByLabelText("Pilih sesi untuk sel"))[0]!;
    fireEvent.change(picker, { target: { value: "aaaa1111" } });
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("Lepas mengosongkan sel tanpa mematikan sesi", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByText("lepas"));
    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(deleteTerminal).not.toHaveBeenCalled();
    // sesi masih ada → muncul kembali sebagai chip tray
    expect(screen.getByRole("button", { name: /aaaa11/ })).toBeInTheDocument();
  });

  it("Tutup (×) memanggil deleteTerminal", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Tutup sesi aaaa1111"));
    await waitFor(() => expect(deleteTerminal).toHaveBeenCalledWith("aaaa1111"));
  });
});
