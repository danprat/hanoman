import { describe, it, expect } from "vitest";
import { scanRepoDocs, readDocFile, writeDocFile, deleteDocFile, docAbsPath } from "../src/services/scan";
import { makeTempRepo } from "./factory";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("scanRepoDocs", () => {
  it("coverage counts only categories inside docsDir, minus the index itself", async () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [prd](product/prd.md)",
      "internal/docs/product/prd.md": "# prd",
      "internal/docs/loose/orphan.md": "# orphan",
      "docs/plans/p.md": "# plan",
      "README.md": "# repo",
    });
    const { coverage, tree } = await scanRepoDocs(dir);
    // Yang diskor: product/prd.md (reachable) + loose/orphan.md (tidak) -> 1/2 = 50.
    // `internal/docs` sendiri hanya berisi index, yang tak pernah masuk denominator.
    expect(coverage).toBe(50);
    const byCat = Object.fromEntries(tree.map((t) => [t.cat, t]));
    expect(byCat["internal/docs/product"]!.scored).toBe(true);
    expect(byCat["internal/docs/product"]!.linked).toBe(true);
    expect(byCat["internal/docs/loose"]!.linked).toBe(false);
    expect(byCat["docs/plans"]!.scored).toBe(false);
    expect(byCat["."]!.scored).toBe(false);
  });

  it("follows a sub-index: docs reachable through adr/README.md count as linked", async () => {
    const dir = makeTempRepo({
      "internal/docs/README.md": "- [adr](adr/README.md)",
      "internal/docs/adr/README.md": "- [0001](0001-x.md)",
      "internal/docs/adr/0001-x.md": "# x",
    });
    expect((await scanRepoDocs(dir)).coverage).toBe(100);
  });

  it("repo without docsDir -> coverage 0, tree still lists markdown", async () => {
    const dir = makeTempRepo({ "README.md": "# r", "notes/a.md": "# a" });
    const { coverage, tree } = await scanRepoDocs(dir);
    expect(coverage).toBe(0);
    expect(tree.map((t) => t.cat).sort()).toEqual([".", "notes"]);
    expect(tree.every((t) => !t.scored)).toBe(true);
  });

  it("honors docsDir from hanoman.config.json", async () => {
    const dir = makeTempRepo({
      "hanoman.config.json": JSON.stringify({ docsDir: "spec" }),
      "spec/README.md": "- [a](a.md)",
      "spec/a.md": "# a",
      "internal/docs/x.md": "# x",
    });
    const { coverage, tree } = await scanRepoDocs(dir);
    expect(coverage).toBe(100);
    expect(tree.find((t) => t.cat === "internal/docs")!.scored).toBe(false);
  });

  it("null / missing repoDir -> empty", async () => {
    await expect(scanRepoDocs(null)).resolves.toEqual({ coverage: 0, tree: [] });
  });

  it("a directory that is not a git repo -> empty, no throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-nogit-"));
    await expect(scanRepoDocs(dir)).resolves.toEqual({ coverage: 0, tree: [] });
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
