import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { collectViolations } from "../src/verify";
import { makeRepo } from "./_fixture";
describe("collectViolations", () => {
  it("clean repo -> no violations", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    expect(collectViolations(root).violations).toEqual([]);
  });
  it("unlinked doc -> unlinked violation", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    const v = collectViolations(root).violations;
    expect(v.some((x) => x.kind === "unlinked" && x.reason.includes("architecture/nfr.md"))).toBe(true);
  });
  it("src change without docs -> freshness violation", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    mkdirSync(join(root, "src"), { recursive: true }); writeFileSync(join(root, "src/a.ts"), "z");
    expect(collectViolations(root).violations.some((x) => x.kind === "freshness")).toBe(true);
  });
  it("coverage below threshold -> coverage violation", async () => {
    const { root } = await makeRepo({
      files: { "hanoman.config.json": JSON.stringify({ requireLinks: false, coverageThreshold: 100 }) },
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "product/blueprint.md": "y" } }); // product unlinked -> 50%
    expect(collectViolations(root).violations.some((x) => x.kind === "coverage")).toBe(true);
  });
});
