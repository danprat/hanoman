import { describe, it, expect, beforeEach } from "vitest";
import { registerSchedulerSource, listSources, clearSources, isDue, setLastRun } from "../src/services/scheduler/registry";

beforeEach(clearSources);

describe("scheduler registry", () => {
  it("registers and lists sources", () => {
    registerSchedulerSource({ id: "backlog", check: async () => {} });
    registerSchedulerSource({ id: "errors", check: async () => {} });
    expect(listSources().map((s) => s.id).sort()).toEqual(["backlog", "errors"]);
  });
  it("re-registering the same id replaces (no duplicate)", () => {
    registerSchedulerSource({ id: "backlog", check: async () => {} });
    registerSchedulerSource({ id: "backlog", check: async () => {} });
    expect(listSources().length).toBe(1);
  });
  it("isDue: true when never run, false within window, true after window", () => {
    const now = 1_000_000;
    expect(isDue("s", 15, now)).toBe(true);        // belum pernah
    setLastRun("s", now);
    expect(isDue("s", 15, now + 14 * 60_000)).toBe(false);  // 14 mnt < 15
    expect(isDue("s", 15, now + 15 * 60_000)).toBe(true);   // 15 mnt ≥ 15
  });
});
