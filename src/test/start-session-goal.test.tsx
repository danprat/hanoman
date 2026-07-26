import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), startSession: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));

import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

const spec: any = { id: "SPEC-332", source: "brief", title: "t", stage: "planned" };
const settings = (goal: { enabled: boolean; condition: string }) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings({ enabled: true, condition: "TEMPLATE-GLOBAL" }) as any);
  vi.mocked(api.startSession).mockResolvedValue({ id: "spec-332" } as any);
});

describe("StartSessionModal · mode goal", () => {
  it("prefill dari Setting global dan mengirim goal + goalCondition", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByDisplayValue("TEMPLATE-GLOBAL")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-332", goal: true, goalCondition: "TEMPLATE-GLOBAL" })));
  });

  it("toggle mati → goal:false, kondisi tak dikirim, textarea disembunyikan", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByDisplayValue("TEMPLATE-GLOBAL")).toBeNull();
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ goal: false, goalCondition: undefined })));
  });

  it("kondisi kosong → hanya goal:true (server memakai template/default)", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({ enabled: true, condition: "" }) as any);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ goal: true, goalCondition: undefined })));
  });
});
