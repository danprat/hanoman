import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), putSettings: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.5", effort: "xhigh" }, ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings() as any);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SettingsScreen · kartu agen sesi (SPEC-338)", () => {
  it("mengubah agen default → PUT settings", async () => {
    openModel();
    const sel = await screen.findByLabelText("Agen default");
    fireEvent.change(sel, { target: { value: "codex" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "codex" })));
  });

  it("mengubah model codex → PUT settings menjaga effort codex", async () => {
    openModel();
    const sel = await screen.findByLabelText("Model codex");
    fireEvent.change(sel, { target: { value: "gpt-5.4" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codex: { model: "gpt-5.4", effort: "xhigh" } })));
  });

  it("mengubah effort codex → PUT settings menjaga model codex", async () => {
    openModel();
    const sel = await screen.findByLabelText("Effort codex");
    fireEvent.change(sel, { target: { value: "low" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codex: { model: "gpt-5.5", effort: "low" } })));
  });

  it("kartu model claude tetap ada berdampingan", async () => {
    openModel();
    expect(await screen.findByLabelText("Agen default")).toBeInTheDocument();
    expect(screen.getByText("Model sesi — default global")).toBeInTheDocument();
  });
});
