import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseIndex, walkDocs, catStatus } from "../src/docs-model";
import { makeRepo } from "./_fixture";
describe("docs model", () => {
  it("parses linked relative paths from the index", async () => {
    const { root } = await makeRepo({
      index: "# index\n- [stack](architecture/stack.md)\n- [prd](requirements/prd.md)\n- [site](https://x.io)\n",
      docs: { "architecture/stack.md": "# stack", "requirements/prd.md": "# prd" } });
    const linked = parseIndex(join(root, "internal/docs/README.md"));
    expect(linked.has("architecture/stack.md")).toBe(true);
    expect([...linked].some((p) => p.startsWith("http"))).toBe(false);
  });
  it("walks docs including sub-indexes, skipping dotfiles", async () => {
    const { root } = await makeRepo({ index: "# i\n",
      docs: { "architecture/stack.md": "x", "adr/README.md": "y" } });
    const files = walkDocs(join(root, "internal/docs"));
    expect(files.sort()).toEqual(["README.md", "adr/README.md", "architecture/stack.md"]);
  });
  it("marks a category unlinked when a file is missing from the index", async () => {
    const { root } = await makeRepo({
      index: "- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    const files = walkDocs(join(root, "internal/docs"));
    const cats = catStatus(files, parseIndex(join(root, "internal/docs/README.md")));
    const arch = cats.find((c) => c.category === "architecture")!;
    expect(arch.linked).toBe(false); expect(arch.unlinkedFiles).toEqual(["architecture/nfr.md"]);
  });
});
