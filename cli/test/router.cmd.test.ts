import { describe, it, expect } from "vitest";
import { run } from "../src/router";
const ctx = () => {
  const err: string[] = [];
  return { c: { cwd: process.cwd(), env: {}, stdout: () => {}, stderr: (s: string) => err.push(s) }, err };
};
describe("router — guardrail Source of Truth dicabut (SPEC-160)", () => {
  it("`docs verify` is now an unknown command", async () => {
    const { c, err } = ctx();
    expect(await run(["docs", "verify"], c)).toBe(1);
    expect(err.join("")).toContain("unknown command");
  });
  it("`hook stop` is now an unknown command", async () => {
    const { c, err } = ctx();
    expect(await run(["hook", "stop"], c)).toBe(1);
    expect(err.join("")).toContain("unknown command");
  });
});
