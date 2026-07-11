import { describe, it, expect } from "vitest";
import { worstWindow, severityToken, severityTone } from "../src/api/limits";
import type { LimitWindow } from "@hanoman/shared";

const w = (over: Partial<LimitWindow>): LimitWindow => ({
  key: "k", label: "L", usedPct: 10, resetsAt: null, severity: "normal", isActive: false, ...over,
});

describe("worstWindow", () => {
  it("returns null for empty", () => expect(worstWindow([])).toBeNull());
  it("picks worst severity over higher percent", () => {
    const r = worstWindow([w({ key: "a", usedPct: 95, severity: "normal" }),
                           w({ key: "b", usedPct: 30, severity: "critical" })]);
    expect(r?.key).toBe("b");
  });
  it("tie-breaks equal severity by usedPct", () => {
    const r = worstWindow([w({ key: "a", usedPct: 40, severity: "warning" }),
                           w({ key: "b", usedPct: 80, severity: "warning" })]);
    expect(r?.key).toBe("b");
  });
});

describe("severityToken", () => {
  it("maps severities to status vars", () => {
    expect(severityToken("normal").fg).toContain("--status-ok");
    expect(severityToken("warning").fg).toContain("--status-warn");
    expect(severityToken("critical").fg).toContain("--status-err");
  });
});

describe("severityTone", () => {
  it("maps severities to DS tone names", () => {
    expect(severityTone("normal")).toBe("ok");
    expect(severityTone("warning")).toBe("warn");
    expect(severityTone("critical")).toBe("err");
  });
});
