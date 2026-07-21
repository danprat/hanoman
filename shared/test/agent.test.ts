import { describe, it, expect } from "vitest";
import {
  CAPABILITY_IDS, zCapability, CAPABILITIES, grantsCapability,
  zAgentTokenCreate, zSetting,
} from "../src";

describe("agent capabilities", () => {
  it("has 9 domains × read/write = 18 capability ids, all in metadata", () => {
    expect(CAPABILITY_IDS.length).toBe(18);
    expect(new Set(CAPABILITY_IDS).size).toBe(18);
    expect(CAPABILITIES.map((c) => c.id).sort()).toEqual([...CAPABILITY_IDS].sort());
    expect(zCapability.safeParse("projects:read").success).toBe(true);
    expect(zCapability.safeParse("nope:read").success).toBe(false);
  });

  it("write implies read; unrelated caps do not grant", () => {
    expect(grantsCapability(["projects:write"], "projects:read")).toBe(true);
    expect(grantsCapability(["projects:read"], "projects:write")).toBe(false);
    expect(grantsCapability(["projects:read"], "projects:read")).toBe(true);
    expect(grantsCapability(["backlog:write"], "projects:read")).toBe(false);
    expect(grantsCapability([], "projects:read")).toBe(false);
  });

  it("high-risk caps are flagged", () => {
    const risky = CAPABILITIES.filter((c) => c.risk).map((c) => c.id);
    expect(risky).toContain("sessions:write");
    expect(risky).toContain("vps:write");
  });

  it("zAgentTokenCreate rejects unknown capability and empty name", () => {
    expect(zAgentTokenCreate.safeParse({ name: "bot", capabilities: ["projects:read"] }).success).toBe(true);
    expect(zAgentTokenCreate.safeParse({ name: "bot", capabilities: ["ghost:read"] }).success).toBe(false);
    expect(zAgentTokenCreate.safeParse({ name: "", capabilities: [] }).success).toBe(false);
  });

  it("zSetting defaults agentAccessEnabled to false", () => {
    const s = zSetting.parse({
      model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
    });
    expect(s.agentAccessEnabled).toBe(false);
  });
});
