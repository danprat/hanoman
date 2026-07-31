import { describe, it, expect } from "vitest";
import {
  CAPABILITY_IDS, zCapability, CAPABILITIES, CAPABILITY_DOMAINS, grantsCapability,
  zAgentTokenCreate, zSetting,
} from "../src";

describe("agent capabilities", () => {
  // SPEC-409 · ADR-0091 · +domain `lead` (minta putusan & baca jejak) → 10 domain.
  it("has 10 domains × read/write = 20 capability ids, all in metadata", () => {
    expect(CAPABILITY_IDS.length).toBe(20);
    expect(new Set(CAPABILITY_IDS).size).toBe(20);
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

  it("CAPABILITY_DOMAINS covers every domain exactly once, in grid order", () => {
    const gridDomains = Array.from(new Set(CAPABILITIES.map((c) => c.domain)));
    expect(CAPABILITY_DOMAINS.map((d) => d.domain)).toEqual(gridDomains);
    for (const d of CAPABILITY_DOMAINS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.desc.length).toBeGreaterThan(0);
    }
  });

  it("SPEC-264: PRD, Errors, Help Desk are discoverable in domain labels/desc", () => {
    const blob = CAPABILITY_DOMAINS.map((d) => `${d.label} ${d.desc}`).join(" ").toLowerCase();
    expect(blob).toContain("prd");
    expect(blob).toContain("error");
    expect(blob).toContain("help desk");
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
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
    });
    expect(s.agentAccessEnabled).toBe(false);
  });
});
