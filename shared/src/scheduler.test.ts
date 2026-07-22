import { describe, it, expect } from "vitest";
import { zScheduler, SCHEDULER_DEFAULTS, zSetting } from "./entities";

describe("zScheduler", () => {
  it("all defaults are OFF", () => {
    expect(SCHEDULER_DEFAULTS.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.paused).toBe(false);
    expect(SCHEDULER_DEFAULTS.maxConcurrent).toBe(2);
    expect(SCHEDULER_DEFAULTS.autonomy).toBe("butuh-keputusan");
    expect(SCHEDULER_DEFAULTS.sources.backlog.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.sources.errors.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.sources.errors.minCount).toBe(5);
    expect(SCHEDULER_DEFAULTS.sources.triase.everyMin).toBe(30);
  });
  it("parses {} to full defaults", () => {
    expect(zScheduler.parse({})).toEqual(SCHEDULER_DEFAULTS);
  });
  it("rejects maxConcurrent < 1", () => {
    expect(zScheduler.safeParse({ maxConcurrent: 0 }).success).toBe(false);
  });
});

describe("zSetting.scheduler backward-compat", () => {
  it("an old Setting row without a scheduler block still parses, filling defaults", () => {
    const old = {
      model: "claude-opus-4-8", effort: "xhigh",
      autoDefault: true, autoScaffold: true, notifyFail: true,
      notifyDone: true, notifySound: "short", notifyDecision: true,
      notifyDecisionSound: "alert", agentAccessEnabled: false,
    };
    const parsed = zSetting.parse(old);
    expect(parsed.scheduler).toEqual(SCHEDULER_DEFAULTS);
  });
});
