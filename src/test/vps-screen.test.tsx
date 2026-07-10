import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const VPS = {
  id: "v1", name: "web-1", host: "203.0.113.10", port: 22, user: "deploy", keyPath: null,
  createdAt: "2026-07-10T00:00:00Z", lastSeenAt: null, health: null,
  lastAuditAt: null, audit: null, hardened: false,
};
vi.mock("../src/api/client", () => ({
  api: { listVps: vi.fn(async () => [VPS]) },
  ApiError: class extends Error {},
}));
import { VpsScreen, isReachable, hardenedLabel } from "../src/screens/VpsScreen";

describe("VpsScreen (SPEC-164)", () => {
  it("badge: belum diaudit → unknown; audit ada → hardened/belum", () => {
    expect(hardenedLabel(VPS as never)).toBe("unknown");
    expect(hardenedLabel({ ...VPS, lastAuditAt: "2026-07-10T01:00:00Z", hardened: true } as never)).toBe("hardened");
    expect(hardenedLabel({ ...VPS, lastAuditAt: "2026-07-10T01:00:00Z", hardened: false } as never)).toBe("belum");
  });
  it("reachable = lastSeenAt < 10 menit (2× interval healthcheck)", () => {
    const now = Date.parse("2026-07-10T10:00:00Z");
    expect(isReachable({ ...VPS, lastSeenAt: "2026-07-10T09:55:00Z" } as never, now)).toBe(true);
    expect(isReachable({ ...VPS, lastSeenAt: "2026-07-10T09:45:00Z" } as never, now)).toBe(false);
    expect(isReachable(VPS as never, now)).toBe(false);
  });
  it("render daftar dari api", async () => {
    render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
    expect(await screen.findByText("web-1")).toBeTruthy();
    expect(screen.getByText("deploy@203.0.113.10")).toBeTruthy();
  });
});
