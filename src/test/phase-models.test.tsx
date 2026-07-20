import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

// SPEC-238 · ADR-0057 — matrix model & effort per fase di tab "Model sesi".
vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), putSettings: vi.fn(), getConfig: vi.fn(), putConfig: vi.fn(), deleteConfig: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));

const SETTING = {
  model: "claude-opus-4-8", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  phaseModels: {},
};
const me = { id: "u1", email: "a@b.c" } as any;

beforeEach(() => {
  (api.getSettings as any).mockResolvedValue({ ...SETTING });
  (api.putSettings as any).mockResolvedValue({ ...SETTING });
});

describe("Matrix model & effort per fase (SPEC-238)", () => {
  it("tab Model menampilkan matrix per-fase + pilihan Fable/max/ultracode", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Model sesi"));
    expect(await screen.findByText(/Model & effort per fase/i)).toBeInTheDocument();
    // fase dari beberapa flow (Brainstorm/Execute muncul di >1 flow → getAllByText)
    expect(screen.getAllByText("Brainstorm").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Execute").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Audit").length).toBeGreaterThan(0); // di flow qa & audit
    // flow audit (SPEC-242): fase Laporan unik ke flow audit-only
    expect(screen.getByText("Laporan")).toBeInTheDocument();
    expect(screen.getByText("Audit-only")).toBeInTheDocument();
    // pilihan baru tersedia di option select
    expect(screen.getAllByText("Fable 5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("max").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ultracode").length).toBeGreaterThan(0);
  });

  it("mengubah model sebuah fase mem-PUT phaseModels", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Model sesi"));
    await screen.findByText(/Model & effort per fase/i);
    // combobox: [0]=model global, [1]=effort global, [2]=model fase pertama (Brainstorm feature)…
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(selects[2]!, { target: { value: "claude-sonnet-5" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    const putArg = (api.putSettings as any).mock.calls.at(-1)[0];
    expect(putArg.phaseModels.feature.Brainstorm.model).toBe("claude-sonnet-5");
  });
});
