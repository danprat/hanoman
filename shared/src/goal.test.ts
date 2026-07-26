import { describe, it, expect } from "vitest";
import { zGoal, GOAL_DEFAULTS, zSetting } from "./entities";
import { zTerminalSession } from "./dto";

describe("zSetting.goal", () => {
  it("default mati dengan template kosong", () => {
    expect(GOAL_DEFAULTS).toEqual({ enabled: false, condition: "" });
    expect(zGoal.parse({})).toEqual(GOAL_DEFAULTS);
  });

  it("baris Setting lama tanpa blok goal tetap parse (tanpa migration)", () => {
    const old = {
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, notifyDone: true, notifySound: "short",
      notifyDecision: true, notifyDecisionSound: "alert",
    };
    expect(zSetting.parse(old).goal).toEqual(GOAL_DEFAULTS);
  });

  it("menolak kondisi di atas 4000 karakter", () => {
    expect(zGoal.safeParse({ enabled: true, condition: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("zTerminalSession varian spec", () => {
  it("menerima goal + goalCondition", () => {
    const r = zTerminalSession.safeParse({ spec: "SPEC-332", flow: "feature", goal: true, goalCondition: "kondisi" });
    expect(r.success && "goal" in r.data && r.data.goal).toBe(true);
    expect(r.success && "goalCondition" in r.data && r.data.goalCondition).toBe("kondisi");
  });

  it("tetap sah tanpa keduanya (ikut default global)", () => {
    const r = zTerminalSession.safeParse({ spec: "SPEC-332", flow: "feature" });
    expect(r.success).toBe(true);
  });

  it("menolak goalCondition di atas 4000 karakter", () => {
    const r = zTerminalSession.safeParse({ spec: "S", flow: "feature", goalCondition: "x".repeat(4001) });
    expect(r.success).toBe(false);
  });
});
