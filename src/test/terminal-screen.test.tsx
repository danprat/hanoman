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
const WKEY = "hanoman.terminal.workspace";

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

describe("TerminalScreen (grup)", () => {
  it("tabbar menampilkan grup 'Utama' hasil migrasi layout lama", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByRole("tab", { name: "Utama" })).toBeInTheDocument();
    expect(localStorage.getItem(LKEY)).toBeNull();
  });

  it("× grup nonaktif saat hanya ada satu grup", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Utama" });
    expect(screen.getByLabelText("Hapus grup Utama")).toBeDisabled();
  });

  it("pindah tab mengganti grid: pane grup lain tak dirender", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    // taruh sesi di grup "Utama"
    fireEvent.click(await screen.findByRole("button", { name: /aaaa11/ }));
    await waitFor(() => expect(screen.getByTestId("pane")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Grup baru" }));
    const tab2 = await screen.findByRole("tab", { name: "Grup 2" });
    expect(tab2).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("pane")).toBeNull();        // grid grup 2 kosong

    fireEvent.click(screen.getByRole("tab", { name: "Utama" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("menghapus grup melepas sesinya ke tray tanpa mematikannya", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: /aaaa11/ }));
    await waitFor(() => expect(screen.getByTestId("pane")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Grup baru" }));   // grup 2 aktif
    await screen.findByRole("tab", { name: "Grup 2" });
    fireEvent.click(screen.getByRole("tab", { name: "Utama" }));          // kembali ke Utama
    fireEvent.click(screen.getByLabelText("Hapus grup Utama"));

    await waitFor(() => expect(screen.getByRole("button", { name: /aaaa11/ })).toBeInTheDocument());
    expect(screen.queryByTestId("pane")).toBeNull();
    expect(deleteTerminal).not.toHaveBeenCalled();
  });

  it("rename grup: Enter menyimpan, Escape membatalkan", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Utama" });

    fireEvent.click(screen.getByLabelText("Ganti nama grup Utama"));
    const input = screen.getByLabelText("Nama grup");
    fireEvent.change(input, { target: { value: "Backlog" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("tab", { name: "Backlog" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Ganti nama grup Backlog"));
    const again = screen.getByLabelText("Nama grup");
    fireEvent.change(again, { target: { value: "dibuang" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(await screen.findByRole("tab", { name: "Backlog" })).toBeInTheDocument();
  });

  it("workspace tersimpan dipulihkan apa adanya (dua grup)", async () => {
    localStorage.setItem(WKEY, JSON.stringify({
      active: "g2",
      groups: [
        { id: "g1", name: "Backlog", layout: { rows: 1, cols: 1, cells: ["aaaa1111"] } },
        { id: "g2", name: "Debug", layout: { rows: 1, cols: 1, cells: ["bbbb2222"] } },
      ],
    }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("bbbb2222"));
    expect(screen.getByRole("tab", { name: "Debug" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("aaaa1111")).toBeNull();   // grup lain tak dirender, juga tak di tray
  });
});

describe("TerminalScreen (tutup kolom/baris)", () => {
  it("menutup kolom melepas sesinya ke tray tanpa mematikannya", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: [null, "aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));

    fireEvent.click(screen.getByLabelText("Tutup kolom 2"));

    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(screen.getByRole("button", { name: /aaaa11/ })).toBeInTheDocument();  // ada di tray
    expect(deleteTerminal).not.toHaveBeenCalled();                               // sesi tetap hidup
  });

  it("menutup baris melepas sesinya ke tray tanpa mematikannya", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 2, cols: 1, cells: [null, "aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));

    fireEvent.click(screen.getByLabelText("Tutup baris 2"));

    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(screen.getByRole("button", { name: /aaaa11/ })).toBeInTheDocument();
    expect(deleteTerminal).not.toHaveBeenCalled();
  });

  it("× kolom & baris nonaktif pada grid 1×1 (tak boleh menyusut ke nol)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByLabelText("Tutup kolom 1")).toBeDisabled();
    expect(screen.getByLabelText("Tutup baris 1")).toBeDisabled();
  });

  it("menutup kolom hanya mengubah grid grup aktif", async () => {
    localStorage.setItem(WKEY, JSON.stringify({
      active: "g2",
      groups: [
        { id: "g1", name: "Backlog", layout: { rows: 1, cols: 2, cells: [null, null] } },
        { id: "g2", name: "Debug", layout: { rows: 1, cols: 2, cells: [null, null] } },
      ],
    }));
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Debug" });

    fireEvent.click(screen.getByLabelText("Tutup kolom 2"));
    await waitFor(() => expect(screen.queryByLabelText("Tutup kolom 2")).toBeNull());

    fireEvent.click(screen.getByRole("tab", { name: "Backlog" }));
    expect(await screen.findByLabelText("Tutup kolom 2")).toBeInTheDocument();  // grup lain utuh
  });
});
