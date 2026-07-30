import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { UpdateStatus } from "@hanoman/shared";

// Badge self-fetch via useUpdate(); pakai nilai tetap agar render deterministik (pola limit-indicator).
let hook: UpdateStatus;
vi.mock("../src/api/update", async (orig) => ({
  ...(await orig<typeof import("../src/api/update")>()),
  useUpdate: () => hook,
}));
import { UpdateBadge } from "../src/screens/UpdateIndicator";

const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentVersion: "0.1.0", latestVersion: "0.1.0",
  registry: { status: "ok", checkedAt: null }, updateAvailable: false, command: "", ...o,
});

describe("UpdateBadge", () => {
  it("tak render saat up-to-date", () => {
    hook = mk({});
    const { container } = render(<UpdateBadge />);
    expect(container.firstChild).toBeNull();
  });
  it("render pill + popover + perintah npm saat versi baru terbit", () => {
    hook = mk({ updateAvailable: true, latestVersion: "0.2.0", command: "npm i -g hanoman@latest" });
    render(<UpdateBadge />);
    const btn = screen.getByTitle("Update tersedia");
    expect(btn.textContent).toContain("Update · 0.2.0");
    fireEvent.click(btn);
    expect(screen.getByText(/hanoman 0\.2\.0 tersedia/)).toBeTruthy();
    expect(screen.getByText(/npm i -g hanoman@latest/)).toBeTruthy();
    expect(screen.getByText(/terpasang 0\.1\.0 · tersedia 0\.2\.0/)).toBeTruthy();
  });
});
