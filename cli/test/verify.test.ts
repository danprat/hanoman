import { describe, it, expect } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { scanCoverage } from "../src/verify";
import { makeRepo } from "./_fixture";
describe("scanCoverage (read-only, SPEC-160)", () => {
  it("all docs linked -> coverage 100", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    expect(scanCoverage(root).coverage).toBe(100);
  });
  it("an unlinked doc drops coverage and marks its category unlinked", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "product/blueprint.md": "y" } });
    const r = scanCoverage(root);
    expect(r.coverage).toBeLessThan(100);
    expect(r.cats.find((c) => c.category === "product")!.linked).toBe(false);
  });
  it("counts a doc reachable only through a sub-index", async () => {
    const { root } = await makeRepo({
      index: "- [adr](adr/README.md)\n",
      docs: { "adr/README.md": "- [0001](0001-x.md)\n", "adr/0001-x.md": "x" } });
    expect(scanCoverage(root).coverage).toBe(100);
  });
  it("no docs dir at all -> coverage 100, not a crash", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    rmSync(join(root, "internal/docs"), { recursive: true });
    expect(scanCoverage(root)).toEqual({ coverage: 100, cats: [] });
  });
  it("throws when docs exist but the index is missing", async () => {
    const { root } = await makeRepo({ docs: { "architecture/stack.md": "x" } });
    rmSync(join(root, "internal/docs/README.md"));
    expect(() => scanCoverage(root)).toThrow(/index Source of Truth tidak ada/);
  });
});
