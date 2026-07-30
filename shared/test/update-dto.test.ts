import { describe, it, expect } from "vitest";
import type { UpdateStatus, EventMsg } from "../src/dto";

describe("UpdateStatus DTO", () => {
  it("bentuk terkini: tak ada update", () => {
    const u: UpdateStatus = {
      currentVersion: "0.1.0", latestVersion: "0.1.0",
      registry: { status: "ok", checkedAt: "2026-07-30T00:00:00Z" },
      updateAvailable: false, command: "", canApply: false,
    };
    expect(u.updateAvailable).toBe(false);
  });
  it("frame siar memuat update", () => {
    const u: UpdateStatus = {
      currentVersion: "0.1.0", latestVersion: "0.2.0",
      registry: { status: "ok", checkedAt: null },
      updateAvailable: true, command: "npm i -g hanoman@latest", canApply: true,
    };
    const msg: EventMsg = { t: "update", update: u };
    expect(msg.t).toBe("update");
  });
});
