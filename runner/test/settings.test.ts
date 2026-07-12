import { describe, it, expect } from "vitest";
import { guardSettings } from "../src/settings";

describe("guardSettings", () => {
  it("tanpa decisionFile: tak ada hook (guardrail dicabut, ADR-0037)", () => {
    expect(guardSettings().hooks).toEqual({});
  });
  it("dengan decisionFile: Notification + UserPromptSubmit menunjuk berkasnya", () => {
    const s = guardSettings("/repo/.worktrees/.decisions/sess1") as any;
    expect(Object.keys(s.hooks).sort()).toEqual(["Notification", "UserPromptSubmit"]);
    expect(s.hooks.Notification[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
    expect(s.hooks.Notification[0].hooks[0].command).toMatch(/grep/);
    expect(s.hooks.UserPromptSubmit[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
  });
});
