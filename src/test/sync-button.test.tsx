import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getConfig, syncNow } = vi.hoisted(() => ({
  getConfig: vi.fn(async () => ({ entries: [], sync: { running: true, connected: true } })),
  syncNow: vi.fn(async () => ({ ok: true, pulled: 2, pushed: 1, conflicts: 0 })),
}));
vi.mock("../src/api/client", () => ({ api: { getConfig, syncNow }, ApiError: class extends Error {} }));

import { SyncButton, __resetSyncActiveCache } from "../src/screens/SyncButton";

beforeEach(() => {
  __resetSyncActiveCache();
  getConfig.mockResolvedValue({ entries: [], sync: { running: true, connected: true } });
  syncNow.mockResolvedValue({ ok: true, pulled: 2, pushed: 1, conflicts: 0 });
});

describe("SyncButton (SPEC-268)", () => {
  it("render saat client, klik → syncNow + toast + onDone", async () => {
    const onDone = vi.fn(); const onToast = vi.fn();
    render(<SyncButton onDone={onDone} onToast={onToast} />);
    const btn = await screen.findByText("Sync");
    fireEvent.click(btn);
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("↓2 ↑1"), "ok", expect.anything());
  });

  it("tak render saat hub (sync.running=false)", async () => {
    getConfig.mockResolvedValue({ entries: [], sync: { running: false, connected: false } } as never);
    const { container } = render(<SyncButton onDone={vi.fn()} onToast={vi.fn()} />);
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    expect(container.textContent ?? "").not.toContain("Sync");
  });
});
