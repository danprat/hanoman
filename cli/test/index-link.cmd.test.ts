import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/router";
import { makeRepo } from "./_fixture";
const io = (root: string, out: string[] = []) => ({ out, ctx: { cwd: root, env: {}, stdout: (s: string) => out.push(s), stderr: (s: string) => out.push(s) } });
describe("index + link", () => {
  it("--check fails on an unlinked doc, --fix then passes", async () => {
    const { root } = await makeRepo({ index: "# index\n\n## architecture\n- [stack](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    expect(await run(["docs", "index", "--check"], io(root).ctx)).toBe(1);
    expect(await run(["docs", "index", "--fix"], io(root).ctx)).toBe(0);
    expect(readFileSync(join(root, "internal/docs/README.md"), "utf8")).toContain("architecture/nfr.md");
    expect(await run(["docs", "index", "--check"], io(root).ctx)).toBe(0);
  });
  it("docs link adds a single doc under its category", async () => {
    const { root } = await makeRepo({ index: "# index\n", docs: { "security/security-standard.md": "x" } });
    expect(await run(["docs", "link", "security/security-standard.md"], io(root).ctx)).toBe(0);
    expect(readFileSync(join(root, "internal/docs/README.md"), "utf8")).toContain("security/security-standard.md");
  });
});
