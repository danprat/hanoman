import { describe, it, expect } from "vitest";
import { buildArgs, guardSettings } from "../src/claude-cli";
import { deniesDangerous } from "../src/safety";
const GUARD = 'node "/x/hanoman.js" hook pretooluse';
const at = (a: string[], flag: string) => a[a.indexOf(flag) + 1];
describe("buildArgs", () => {
  it("streams json both ways and registers the guardrail hook", () => {
    const a = buildArgs({ cwd: "/w", model: "claude-opus-4-8" }, GUARD);
    expect(at(a, "--input-format")).toBe("stream-json");
    expect(at(a, "--output-format")).toBe("stream-json");
    expect(at(a, "--model")).toBe("claude-opus-4-8");
    // Unattended: nobody can answer a prompt. The hook, not the permission mode, is the gate.
    expect(a).toContain("--dangerously-skip-permissions");
    expect(a).not.toContain("--permission-mode");
    // A daily terminal session loads all three; a run must match it.
    expect(at(a, "--setting-sources")).toBe("user,project,local");
    expect(JSON.parse(at(a, "--settings")!)).toEqual(guardSettings(GUARD));
  });
  it("omits effort when unset, includes it when set", () => {
    expect(buildArgs({ cwd: "/w", model: "m" }, GUARD)).not.toContain("--effort");
    expect(at(buildArgs({ cwd: "/w", model: "m", effort: "xhigh" }, GUARD), "--effort")).toBe("xhigh");
  });
  it("never passes a spend cap — cost is an estimate, not a brake (ADR-0012)", () => {
    expect(buildArgs({ cwd: "/w", model: "m", effort: "low" }, GUARD)).not.toContain("--max-budget-usd");
  });
  it("keeps the variadic --disallowed-tools last so it swallows nothing", () => {
    const a = buildArgs({ cwd: "/w", model: "m", disallowedTools: ["Bash(rm -rf *)", "Edit"], effort: "low" }, GUARD);
    expect(a.slice(a.indexOf("--disallowed-tools"))).toEqual(["--disallowed-tools", "Bash(rm -rf *)", "Edit"]);
  });
});
describe("deniesDangerous", () => {
  it("denies what the coarse globs would let through, allows the rest", () => {
    expect(deniesDangerous("Bash", { command: "rm  -rf  /tmp/x" })).toBe(true);
    expect(deniesDangerous("Bash", { command: "git push --force upstream main" })).toBe(true);
    expect(deniesDangerous("Bash", { command: "git push origin feature/main-menu" })).toBe(true); // known over-block
    expect(deniesDangerous("Bash", { command: "rm -r build" })).toBe(false);
    expect(deniesDangerous("Edit", { command: "rm -rf /" })).toBe(false);
  });
});
