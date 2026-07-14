import { describe, it, expect } from "vitest";
import type { UpdateStatus, EventMsg } from "../src/dto";

describe("UpdateStatus DTO", () => {
  it("membentuk status up-to-date yang valid", () => {
    const u: UpdateStatus = {
      currentSha: "abc1234", checkoutSha: "abc1234", branch: "main",
      local: { stale: false }, remote: { status: "ok", behind: 0, fetchedAt: null },
      updateAvailable: false, reason: null, command: "", newCommits: [],
    };
    expect(u.updateAvailable).toBe(false);
    expect(u.reason).toBeNull();
  });
  it("EventMsg menyempit pada t:update", () => {
    const m: EventMsg = { t: "update", update: {
      currentSha: "a", checkoutSha: "b", branch: null,
      local: { stale: true }, remote: { status: "unavailable", behind: 0, fetchedAt: null },
      updateAvailable: true, reason: "local", command: "pnpm build && pnpm prod", newCommits: [],
    } };
    if (m.t === "update") expect(m.update.reason).toBe("local");
    else throw new Error("narrowing gagal");
  });
});
