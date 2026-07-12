import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Spec } from "@hanoman/shared";
import { TerminalScreen, PhaseStrip } from "../src/screens/TerminalScreen";

// TerminalPane membuka WebSocket + xterm (butuh canvas). jsdom tak punya keduanya; yang
// diuji di sini adalah komposisi grid, bukan rendering terminalnya.
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid="pane">{sessionId}</div>,
}));
const listTerminals = vi.fn();
const createTerminal = vi.fn();
const deleteTerminal = vi.fn();
const startSession = vi.fn();
const listSpecs = vi.fn();   // SPEC-198 · picker startable via API
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } },
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    deleteTerminal: (...a: unknown[]) => deleteTerminal(...a),
    listBranches: vi.fn(async () => ({ branches: [], remotes: [] })),
    startSession: (...a: unknown[]) => startSession(...a),
    listSpecs: (...a: unknown[]) => listSpecs(...a),
  },
}));
// SPEC-199 · daftar sesi kini didorong lewat WS siar; tangkap handler subscribe untuk mempush frame.
const ev = vi.hoisted(() => ({ handler: undefined as ((m: unknown) => void) | undefined }));
vi.mock("../src/api/events", () => ({
  subscribe: (fn: (m: unknown) => void) => { ev.handler = fn; return () => { ev.handler = undefined; }; },
}));

const projects = [{ id: "p1", name: "hanoman" }];
const LKEY = "hanoman.terminal.layout";
const WKEY = "hanoman.terminal.workspace";

const backlog: Spec[] = [
  { id: "SPEC-100", projectId: "p1", title: "Fitur A", source: "brief", stage: "brainstorming",
    priority: "tinggi", author: "human", objective: "obj A", payload: null, branchFrom: null, baseSha: null },
  { id: "SPEC-101", projectId: "p1", title: "Bug B", source: "qa", stage: "planned",
    priority: "sedang", author: "human", objective: "obj B", payload: null, branchFrom: null, baseSha: null },
  { id: "SPEC-102", projectId: "p1", title: "Selesai C", source: "brief", stage: "done",
    priority: "rendah", author: "human", objective: "obj C", payload: null, branchFrom: null, baseSha: null },
];

beforeEach(() => {
  localStorage.clear();
  listTerminals.mockReset(); createTerminal.mockReset(); deleteTerminal.mockReset();
  startSession.mockReset(); listSpecs.mockReset();
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

  it("sesi yang exited menampilkan badge Selesai + badan meredup (bukan suffix berakhir)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["done1111"] }));
    listTerminals.mockResolvedValue([{ id: "done1111", projectId: "p1", cwd: "/repo", exited: true }]);
    const { container } = render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.queryByText(/berakhir/)).toBeNull();
    expect(container.querySelector("[style*='opacity: 0.6']")).not.toBeNull();
  });

  it("sesi yang masih hidup tak menampilkan badge Selesai", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["live1111"] }));
    listTerminals.mockResolvedValue([{ id: "live1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  it("sesi menunggu keputusan menampilkan pill Menunggu keputusan (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["dec11111"] }));
    listTerminals.mockResolvedValue([{ id: "dec11111", projectId: "p1", cwd: "/repo", exited: false, decision: true }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Menunggu keputusan")).toBeInTheDocument();
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  it("exited menang atas decision: pill Selesai, bukan Menunggu (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["done2222"] }));
    listTerminals.mockResolvedValue([{ id: "done2222", projectId: "p1", cwd: "/repo", exited: true, decision: true }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
  });

  it("sesi bekerja (tanpa decision/exited) tak ada pill (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["run33333"] }));
    listTerminals.mockResolvedValue([{ id: "run33333", projectId: "p1", cwd: "/repo", exited: false, decision: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  it("frame WS sessions menyegarkan state decision live (SPEC-196/199)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["poll1111"] }));
    listTerminals.mockResolvedValue([{ id: "poll1111", projectId: "p1", cwd: "/repo", exited: false, decision: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
    // Push frame sessions dengan decision:true — persis yang server siarkan.
    await act(async () => {
      ev.handler?.({ t: "sessions", sessions: [{ id: "poll1111", projectId: "p1", cwd: "/repo", exited: false, decision: true }] });
    });
    expect(screen.getByText("Menunggu keputusan")).toBeInTheDocument();
  });
});

describe("TerminalScreen (Ambil backlog)", () => {
  it("membuka modal berisi spec yang bisa diambil — bukan yang done", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    expect(await screen.findByText("Fitur A")).toBeInTheDocument();
    expect(screen.getByText("Bug B")).toBeInTheDocument();
    expect(screen.queryByText("Selesai C")).toBeNull();       // done tak ditawarkan
  });

  it("spec yang sudah punya sesi hidup tak ditawarkan lagi", async () => {
    listTerminals.mockResolvedValue([
      { id: "spec-100", projectId: "p1", specId: "SPEC-100", flow: "feature", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ambil backlog" }));
    expect(await screen.findByText("Bug B")).toBeInTheDocument();
    expect(screen.queryByText("Fitur A")).toBeNull();          // sudah aktif
  });

  // SPEC-198 · filter picker kini via API (startable). Test memverifikasi PARAM yang dikirim.
  it("cari mengirim q ke API (startable, debounced)", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.change(await screen.findByLabelText("Cari backlog"), { target: { value: "bug" } });
    await waitFor(() => expect(listSpecs.mock.calls.at(-1)?.[0]).toMatchObject({ startable: true, q: "bug" }));
  });

  it("filter stage mengirim stage ke API (startable)", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.change(await screen.findByLabelText("Filter stage"), { target: { value: "planned" } });
    await waitFor(() => expect(listSpecs.mock.calls.at(-1)?.[0]).toMatchObject({ startable: true, stage: "planned" }));
  });

  it("filter prioritas mengirim priority ke API (startable)", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.change(await screen.findByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    await waitFor(() => expect(listSpecs.mock.calls.at(-1)?.[0]).toMatchObject({ startable: true, priority: "tinggi" }));
  });

  it("memilih spec memanggil startSession (flow qa) & menaruh sesinya di grid", async () => {
    listTerminals.mockResolvedValue([]);
    startSession.mockResolvedValue({ id: "spec101sess" });
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.click(await screen.findByText("Bug B"));         // SPEC-101, source qa
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("spec101sess"));
    expect(startSession).toHaveBeenCalledWith({ spec: "SPEC-101", flow: "qa" });
  });

  it("brief memakai flow feature", async () => {
    listTerminals.mockResolvedValue([]);
    startSession.mockResolvedValue({ id: "sfeat" });
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.click(await screen.findByText("Fitur A"));       // SPEC-100, source brief
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ spec: "SPEC-100", flow: "feature" }));
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

describe("TerminalScreen (layar penuh)", () => {
  const root = () => screen.getByTestId("terminal-root");

  it("tombol memaksimalkan screen, label & aria-pressed berbalik", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);

    const masuk = await screen.findByRole("button", { name: "Layar penuh" });
    expect(masuk).toHaveAttribute("aria-pressed", "false");
    expect(root()).not.toHaveStyle({ position: "fixed" });

    fireEvent.click(masuk);

    expect(root()).toHaveStyle({ position: "fixed", zIndex: "100" });
    expect(screen.getByRole("button", { name: "Keluar layar penuh" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("keluar mengembalikan tinggi normal", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: "Layar penuh" }));

    fireEvent.click(screen.getByRole("button", { name: "Keluar layar penuh" }));

    expect(root()).not.toHaveStyle({ position: "fixed" });
    expect(root()).toHaveStyle({ height: "calc(100vh - 180px)" });
    expect(screen.getByRole("button", { name: "Layar penuh" })).toBeInTheDocument();
  });

  it("kontrol tetap bekerja di dalam layar penuh", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");

    fireEvent.click(screen.getByRole("button", { name: "Layar penuh" }));

    // tabbar, gutter, toolbar: semuanya masih ada setelah chrome dilebur jadi satu baris
    expect(screen.getByRole("tab", { name: "Utama" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tutup kolom 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sesi baru" })).toBeInTheDocument();

    // dan benar-benar terhubung, bukan sekadar ter-render
    fireEvent.click(screen.getByRole("button", { name: "+ Kolom" }));
    expect(await screen.findByLabelText("Tutup kolom 2")).toBeInTheDocument();
    expect(root()).toHaveStyle({ position: "fixed" });   // tetap maximize
  });

  it("Escape TIDAK keluar dari layar penuh — Escape milik terminal", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: "Layar penuh" }));

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(root(), { key: "Escape" });

    expect(root()).toHaveStyle({ position: "fixed" });
    expect(screen.getByRole("button", { name: "Keluar layar penuh" })).toBeInTheDocument();
  });
});

// SPEC-175 · aksi rebase/merge di header Cell, hanya untuk sesi ber-specId.
describe("TerminalScreen · integrate (SPEC-175)", () => {
  it("Cell sesi ber-specId punya aksi Rebase / Merge; sesi tanpa spec tidak", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: ["spec1sess", "plain0000"] }));
    listTerminals.mockResolvedValue([
      { id: "spec1sess", projectId: "p1", specId: "SPEC-1", cwd: "/repo", exited: false },
      { id: "plain0000", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    const spec = { id: "SPEC-1", projectId: "p1", stage: "done", title: "t", source: "brief",
      priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null };
    render(<TerminalScreen projects={projects} onIntegrate={() => {}} specOf={() => spec as never} />);
    await waitFor(() => expect(screen.getAllByTestId("pane")).toHaveLength(2));
    expect(screen.getAllByTitle(/Rebase \/ Merge/i)).toHaveLength(1); // hanya sesi ber-spec
  });
});

// SPEC-162 · fase dilaporkan agen, server menyiarkannya lewat WS terminal. Strip ini hanya
// menggambar apa yang dilaporkan — ia tak menyimpulkan apa pun sendiri.
describe("PhaseStrip", () => {
  it("menandai tiap fase dengan state-nya", () => {
    render(<PhaseStrip phases={[
      { name: "Brainstorm", state: "done" },
      { name: "Objective", state: "active" },
      { name: "Spec", state: "pending" },
    ]} />);
    expect(screen.getByText("Brainstorm")).toHaveAttribute("data-state", "done");
    expect(screen.getByText("Objective")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Spec")).toHaveAttribute("data-state", "pending");
  });

  it("fase yang dilewati terbaca berbeda dari yang selesai", () => {
    render(<PhaseStrip phases={[{ name: "Plan", state: "skipped" }]} />);
    expect(screen.getByText("Plan")).toHaveAttribute("data-state", "skipped");
  });

  it("tanpa fase, tak menggambar apa pun (sesi project biasa)", () => {
    const { container } = render(<PhaseStrip phases={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
