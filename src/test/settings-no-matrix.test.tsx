import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

// SPEC-252 · ADR-0061 — matrix model/effort per fase (SPEC-238) DICABUT. Tab "Model sesi" hanya
// menyisakan default global; model/effort dipilih per sesi saat Start (StartSessionModal).
vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), putSettings: vi.fn(), getConfig: vi.fn(), putConfig: vi.fn(), deleteConfig: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));

const SETTING = {
  model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
};
const me = { id: "u1", email: "a@b.c" } as any;

beforeEach(() => {
  (api.getSettings as any).mockResolvedValue({ ...SETTING });
  (api.putSettings as any).mockResolvedValue({ ...SETTING });
});

describe("Settings tanpa matrix per-fase (SPEC-252)", () => {
  it("tab Model menampilkan default global TANPA matrix per-fase", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Model sesi"));
    // kartu default global tetap ada
    expect(await screen.findByText(/default global/i)).toBeInTheDocument();
    // matrix per-fase tidak ada lagi
    expect(screen.queryByText(/Model & effort per fase/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Laporan")).not.toBeInTheDocument();
  });

  it("mengubah model global mem-PUT { model } (bukan phaseModels)", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Model sesi"));
    await screen.findByText(/default global/i);
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(selects[0]!, { target: { value: "claude-sonnet-5" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    const putArg = (api.putSettings as any).mock.calls.at(-1)[0];
    expect(putArg.model).toBe("claude-sonnet-5");
    expect("phaseModels" in putArg).toBe(false);
  });
});
