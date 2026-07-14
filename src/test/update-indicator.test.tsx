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
  currentSha: "abc1234", checkoutSha: "def5678", branch: "main", local: { stale: false },
  remote: { status: "ok", behind: 0, fetchedAt: null }, updateAvailable: false,
  reason: null, command: "", newCommits: [], ...o,
});

describe("UpdateBadge", () => {
  it("tak render saat up-to-date", () => {
    hook = mk({});
    const { container } = render(<UpdateBadge />);
    expect(container.firstChild).toBeNull();
  });
  it("render pill + popover + perintah saat remote behind", () => {
    hook = mk({ updateAvailable: true, reason: "remote", remote: { status: "ok", behind: 2, fetchedAt: null },
      command: "git pull --ff-only && pnpm build && pnpm prod",
      newCommits: [{ sha: "c1", subject: "fix A" }, { sha: "c2", subject: "feat B" }] });
    render(<UpdateBadge />);
    const btn = screen.getByTitle("Update tersedia");
    expect(btn.textContent).toContain("Update · 2");
    fireEvent.click(btn);
    expect(screen.getByText(/2 commit baru di origin/)).toBeTruthy();
    expect(screen.getByText(/git pull --ff-only/)).toBeTruthy();
    expect(screen.getByText(/fix A/)).toBeTruthy();
  });
});
