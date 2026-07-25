import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

// SPEC-252 · ADR-0061 — picker model & effort per SESI saat Start (default = setting global).
vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), startSession: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));

const spec = { id: "SPEC-9", source: "qa", projectId: "p1" } as any;

beforeEach(() => {
  (api.getSettings as any).mockResolvedValue({ model: "claude-opus-5", effort: "xhigh" });
  (api.startSession as any).mockResolvedValue({ id: "spec-9" });
});

describe("StartSessionModal (SPEC-252)", () => {
  it("prefill dari setting global lalu mengirim model/effort terpilih ke startSession", async () => {
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    // prefill: model & effort global tampil di picker
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    expect(screen.getByLabelText("Effort")).toHaveValue("xhigh");
    // operator memilih model berbeda untuk sesi ini
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "claude-sonnet-5" } });
    fireEvent.click(screen.getByRole("button", { name: /Mulai/i }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      { spec: "SPEC-9", flow: "qa", model: "claude-sonnet-5", effort: "xhigh" }));
    expect(onStarted).toHaveBeenCalledWith("spec-9");
  });

  it("tak merender apa pun bila spec null", () => {
    const { container } = render(<StartSessionModal open spec={null} onClose={() => {}} onStarted={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
