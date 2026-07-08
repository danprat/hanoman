import { describe, it, expect } from "vitest";
import { scanRepoDocs, readDocFile, writeDocFile, deleteDocFile, docAbsPath } from "../src/services/scan";
import { makeTempRepo } from "./factory";

describe("scanRepoDocs", () => {
  it("coverage = % of directories fully reachable from the index", () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
      "internal/docs/loose/orphan.md": "# orphan",
    });
    const { coverage, tree } = scanRepoDocs(dir);
    const linkedByCat = Object.fromEntries(tree.map((t) => [t.cat, t.linked]));
    // cats: internal/docs (README, reachable), internal/docs/product (prd, reachable),
    // internal/docs/loose (orphan, NOT reachable) -> 2/3 = 67.
    expect(coverage).toBe(67);
    expect(linkedByCat["internal/docs/product"]).toBe(true);
    expect(linkedByCat["internal/docs/loose"]).toBe(false);
  });

  it("null / missing repoDir -> empty", () => {
    expect(scanRepoDocs(null)).toEqual({ coverage: 0, tree: [] });
  });
});

describe("doc fs ops", () => {
  it("write then read back", () => {
    const dir = makeTempRepo({ "internal/docs/README.md": "# r" });
    writeDocFile(dir, "internal/docs/x.md", "# x");
    expect(readDocFile(dir, "internal/docs/x.md")).toBe("# x");
  });

  it("delete removes the file", () => {
    const dir = makeTempRepo({ "a.md": "# a" });
    expect(deleteDocFile(dir, "a.md")).toBe(true);
    expect(readDocFile(dir, "a.md")).toBeNull();
  });

  it("guard rejects traversal, non-md, and .git", () => {
    const dir = makeTempRepo({ "a.md": "# a" });
    expect(() => docAbsPath(dir, "../evil.md")).toThrow();
    expect(() => docAbsPath(dir, "notes.txt")).toThrow();
    expect(() => docAbsPath(dir, ".git/config.md")).toThrow();
  });
});
