import { describe, it, expect } from "vitest";
import { guardSettings } from "./settings";

type Hooks = { hooks: Record<string, { hooks: { type: string; prompt?: string; command?: string }[] }[]> };

describe("guardSettings", () => {
  it("tanpa goal: tak ada hook Stop sama sekali", () => {
    const s = guardSettings("/tmp/dec") as Hooks;
    expect(s.hooks.Stop).toBeUndefined();
    expect(s.hooks.Notification).toBeDefined();      // marker keputusan SPEC-184 tetap
    expect(s.hooks.UserPromptSubmit).toBeDefined();
  });

  it("dengan goal: Stop hook bertipe prompt berisi kondisinya", () => {
    const s = guardSettings("/tmp/dec", "berhenti hanya bila X") as Hooks;
    expect(s.hooks.Stop).toEqual([{ hooks: [{ type: "prompt", prompt: "berhenti hanya bila X" }] }]);
    expect(s.hooks.Notification).toBeDefined();      // tak merusak hook yang sudah ada
  });

  it("goal boleh berdiri tanpa decisionFile", () => {
    const s = guardSettings(undefined, "kondisi") as Hooks;
    expect(s.hooks.Stop?.[0]!.hooks[0]!.prompt).toBe("kondisi");
    expect(s.hooks.Notification).toBeUndefined();
  });

  it("goal kosong tidak memasang hook", () => {
    expect((guardSettings("/tmp/dec", "") as Hooks).hooks.Stop).toBeUndefined();
  });
});
