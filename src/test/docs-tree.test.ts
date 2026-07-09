import { describe, it, expect } from "vitest";
import { buildTree, firstDoc } from "../src/screens/DocsWorkspace";

const cat = (c: string, ...files: string[]) => ({ cat: c, files, linked: true, scored: true });
const other = (c: string, ...files: string[]) => ({ cat: c, files, linked: false, scored: false });

describe("buildTree", () => {
  it("nests siblings under their shared parent instead of listing them flat", () => {
    const roots = buildTree([
      cat("internal/docs", "README.md"),
      cat("internal/docs/adr", "0001.md"),
      cat("internal/docs/architecture", "overview.md"),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.label).toBe("internal/docs"); // single-child chain folded
    expect(roots[0]!.kids.map((k) => k.label)).toEqual(["adr", "architecture"]);
    expect(roots[0]!.cat?.files).toEqual(["README.md"]);
  });

  it("folds a chain of file-less folders into one row", () => {
    const root = buildTree([cat("docs/superpowers/plans", "a.md"), cat("docs/superpowers/specs", "b.md")])[0]!;
    expect(root.label).toBe("docs/superpowers");
    expect(root.cat).toBeUndefined();
    expect(root.kids.map((k) => k.path)).toEqual(["docs/superpowers/plans", "docs/superpowers/specs"]);
  });

  it("keeps repo-root files at the top level and paths round-tripping", () => {
    const root = buildTree([cat(".", "README.md")])[0]!;
    expect(root.path).toBe(".");
    expect(root.path + "/" + root.cat!.files[0]).toBe("./README.md");
  });
});

describe("firstDoc", () => {
  it("never preselects a category that is not scored", () => {
    expect(firstDoc([other("docs/superpowers/plans", "p.md"), cat("internal/docs/adr", "0001.md")]))
      .toBe("internal/docs/adr/0001.md");
  });

  it("prefers a linked scored category over an unlinked one", () => {
    const unlinked = { cat: "internal/docs/loose", files: ["orphan.md"], linked: false, scored: true };
    expect(firstDoc([unlinked, cat("internal/docs/adr", "0001.md")])).toBe("internal/docs/adr/0001.md");
  });

  it("falls back to the first category when nothing is scored", () => {
    expect(firstDoc([other(".", "README.md")])).toBe("./README.md");
  });

  it("returns empty string for an empty tree", () => {
    expect(firstDoc([])).toBe("");
  });
});
