import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listCustomAgents = vi.fn();
const createCustomAgent = vi.fn();
const updateCustomAgent = vi.fn();
const deleteCustomAgent = vi.fn();

// `vi.mock` di-hoist ke atas berkas, jadi kelas yang dideklarasikan di scope modul masih TDZ
// saat factory-nya jalan → "Cannot access before initialization". `vi.hoisted` ikut terangkat.
const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class extends Error {
    status: number; detail: unknown;
    constructor(status: number, msg: string, detail: unknown = null) { super(msg); this.status = status; this.detail = detail; }
  },
}));
vi.mock("../src/api/client", () => ({
  api: {
    listCustomAgents: (p?: string) => listCustomAgents(p),
    createCustomAgent: (b: unknown) => createCustomAgent(b),
    updateCustomAgent: (id: string, b: unknown) => updateCustomAgent(id, b),
    deleteCustomAgent: (id: string) => deleteCustomAgent(id),
  },
  ApiError: FakeApiError,
}));

import { CustomAgentsPanel } from "../src/screens/CustomAgentsPanel";

const rows = [
  { id: "global:rev", projectId: null, name: "rev", description: "tinjau", instructions: "i",
    tools: null, model: null, mentions: ["tes"], enabled: true, inherited: true },
  { id: "p1:tes", projectId: "p1", name: "tes", description: "uji", instructions: "i",
    tools: null, model: null, mentions: [], enabled: true, inherited: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  listCustomAgents.mockResolvedValue(rows);
});

// `Checkbox`/`Switch` design system BUKAN <input>: onClick hidup di <span> di dalam <label>,
// jadi mengklik label = no-op dan test yang melakukannya "lulus" tanpa terjadi apa-apa
// (pelajaran SPEC-299/360/447).
const pick = (name: string) => fireEvent.click(screen.getByLabelText(name).firstElementChild!);

describe("CustomAgentsPanel", () => {
  it("menampilkan agen efektif project", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    expect(await screen.findByText("rev")).toBeTruthy();
    expect(screen.getByText("tes")).toBeTruthy();
    expect(listCustomAgents).toHaveBeenCalledWith("p1");
  });

  it("menandai agen warisan global sebagai read-only di permukaan project", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    await screen.findByText("rev");
    expect(screen.getByText(/warisan global/i)).toBeTruthy();
  });

  it("menampilkan tools HASIL RESOLUSI, jadi efek 'Task dicabut' terlihat", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    await screen.findByText("rev");
    // rev ber-mentions → Task ADA; tes daun → Task TIDAK ada. Ini lapis 2 anti-loop yang terlihat.
    expect(screen.getByTestId("tools-rev").textContent).toContain("Task");
    expect(screen.getByTestId("tools-tes").textContent).not.toContain("Task");
  });

  it("permukaan global hanya meminta agen global (tanpa projectId)", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    expect(listCustomAgents).toHaveBeenCalledWith(undefined);
    expect(screen.queryByText(/warisan global/i)).toBeNull();
  });

  it("menampilkan jalur siklus apa adanya saat server menolak 409", async () => {
    createCustomAgent.mockRejectedValue(new FakeApiError(409, "409",
      { error: "mention membentuk siklus", scope: "global", cycle: ["agn-a", "agn-b", "agn-a"] }));

    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agn-a" } });
    fireEvent.change(screen.getByLabelText("Deskripsi"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Instruksi"), { target: { value: "i" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));

    await waitFor(() => expect(screen.getByText(/agn-a → agn-b → agn-a/)).toBeTruthy());
    expect(screen.getByText(/scope global/i)).toBeTruthy();
  });

  it("menampilkan mention tak dikenal saat server menolak 400", async () => {
    createCustomAgent.mockRejectedValue(new FakeApiError(400, "400", { error: "mention tak dikenal", unknown: ["hantu"] }));

    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agn-a" } });
    fireEvent.change(screen.getByLabelText("Deskripsi"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Instruksi"), { target: { value: "i" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));

    await waitFor(() => expect(screen.getByText(/Mention tak dikenal: hantu/)).toBeTruthy());
  });

  it("mengirim tools kosong sebagai null (= pakai DEFAULT) dan mentions terpilih", async () => {
    createCustomAgent.mockResolvedValue(rows[0]);
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agn-baru" } });
    fireEvent.change(screen.getByLabelText("Deskripsi"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Instruksi"), { target: { value: "i" } });
    pick("Mention rev");
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));

    await waitFor(() => expect(createCustomAgent).toHaveBeenCalled());
    expect(createCustomAgent.mock.calls[0]![0]).toMatchObject({
      name: "agn-baru", projectId: null, tools: null, mentions: ["rev"], enabled: true,
    });
  });

  it("nama TAK bisa diubah saat mengedit (changefeed tak punya operasi hapus)", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    fireEvent.click(screen.getAllByRole("button", { name: /ubah/i })[0]!);
    expect((screen.getByLabelText("Nama") as HTMLInputElement).disabled).toBe(true);
  });

  it("menolak simpan saat nama bukan slug yang sah", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "Rev" } });
    expect((screen.getByRole("button", { name: /simpan/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
