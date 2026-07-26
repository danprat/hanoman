import { describe, it, expect } from "vitest";
import { GOAL_MAX, defaultGoalCondition, resolveGoalCondition, goalOneLine } from "./goal";

const args = { flow: "feature" as const, specId: "SPEC-332", branchTo: "hanoman/spec-332" };

describe("goal condition", () => {
  it("default memuat identitas backlog, seluruh fase, gate plan, dan push", () => {
    const c = defaultGoalCondition(args);
    expect(c).toContain("SPEC-332");
    expect(c).toContain("Brainstorm → Objective → Spec → Plan → Execute");
    expect(c).toContain('cat "$HANOMAN_PHASE_FILE"');
    expect(c).toContain("docs/superpowers/plans/");
    expect(c).toContain("git push origin HEAD:refs/heads/hanoman/spec-332");
    expect(c.length).toBeLessThanOrEqual(GOAL_MAX);
  });

  it("flow tanpa Plan+Execute tak membawa gate plan", () => {
    const c = defaultGoalCondition({ ...args, flow: "audit" });
    expect(c).toContain("Audit → Laporan");
    expect(c).not.toContain("docs/superpowers/plans/");
    expect(c).toContain("git push");
  });

  it("resolve: override menang atas template, template menang atas default", () => {
    expect(resolveGoalCondition(args, "pakai ini", "template")).toBe("pakai ini");
    expect(resolveGoalCondition(args, "  ", "template")).toBe("template");
    expect(resolveGoalCondition(args, undefined, "")).toBe(defaultGoalCondition(args));
    expect(resolveGoalCondition(args, null, null)).toBe(defaultGoalCondition(args));
  });

  it("resolve memangkas kondisi di atas batas Claude Code", () => {
    expect(resolveGoalCondition(args, "x".repeat(GOAL_MAX + 500)).length).toBe(GOAL_MAX);
  });

  it("goalOneLine meratakan baris (Enter di tmux = submit)", () => {
    expect(goalOneLine("baris satu\n  baris dua\n\nbaris tiga ")).toBe("baris satu baris dua baris tiga");
  });
});
