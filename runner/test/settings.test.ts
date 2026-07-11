import { describe, it, expect } from "vitest";
import { guardSettings } from "../src/settings";

describe("guardSettings", () => {
  it("tanpa decisionFile: hanya PreToolUse (tak berubah)", () => {
    const s = guardSettings("guard-cmd");
    expect(Object.keys(s.hooks)).toEqual(["PreToolUse"]);
  });
  it("dengan decisionFile: tambah Notification + UserPromptSubmit menunjuk berkasnya", () => {
    const s = guardSettings("guard-cmd", "/repo/.worktrees/.decisions/sess1") as any;
    expect(s.hooks.Notification[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
    expect(s.hooks.Notification[0].hooks[0].command).toMatch(/grep/);
    expect(s.hooks.UserPromptSubmit[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe("guard-cmd");
  });
});
