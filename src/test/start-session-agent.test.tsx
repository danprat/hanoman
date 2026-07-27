import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), startSession: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));

import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

const spec: any = { id: "SPEC-338", source: "brief", title: "t", stage: "planned" };
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.startSession).mockResolvedValue({ id: "spec-338" } as any);
});

describe("StartSessionModal · agen (SPEC-338)", () => {
  it("default mengikuti Setting.agent (claude) dengan model claude", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("claude"));
    expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5");
  });

  it("memilih codex menukar daftar model & effort ke katalog codex", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));
    const opts = [...screen.getByLabelText("Model").querySelectorAll("option")].map((o) => o.value);
    expect(opts).toContain("gpt-5.6-luna");
    expect(opts).not.toContain("claude-opus-5");
    // SPEC-339 · codex tak punya `ultracode`; daftarnya kini juga per model, bukan satu untuk semua.
    const eff = [...screen.getByLabelText("Effort").querySelectorAll("option")].map((o) => o.value);
    expect(eff).toEqual(["ultra", "max", "xhigh", "high", "medium", "low"]);
  });

  it("mengirim agent + model codex ke POST /terminal/sessions", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Agen")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-338", agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" })));
  });

  it("Setting.agent codex → picker terbuka sudah di codex dengan default codex-nya", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "low" } }) as any);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("codex"));
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-terra");
    expect(screen.getByLabelText("Effort")).toHaveValue("low");
  });

  it("balik ke claude memulihkan default claude, bukan menyisakan model codex", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({ agent: "codex" }) as any);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "claude" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
  });

  it("daftar effort menyempit mengikuti model: Luna tanpa ultra", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));

    const effortsOf = () =>
      [...screen.getByLabelText("Effort").querySelectorAll("option")].map((o) => o.value);
    expect(effortsOf()).toEqual(["ultra", "max", "xhigh", "high", "medium", "low"]);

    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-luna"));
    expect(effortsOf()).toEqual(["max", "xhigh", "high", "medium", "low"]);
  });

  // Menurunkan effort HARUS terlihat di picker, bukan terjadi diam-diam saat sesi lahir.
  it("effort tak didukung turun ke xhigh saat model ditukar", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));
    fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "ultra" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(screen.getByLabelText("Effort")).toHaveValue("xhigh"));
  });
});
