import { describe, it, expect } from "vitest";
import { run } from "../src/router";
import { makeRepo } from "./_fixture";
const cap = () => { const o: string[] = []; return { out: o, ctx: (root: string) => ({ cwd: root, env: {}, stdout: (s: string) => o.push(s), stderr: (s: string) => o.push(s) }) }; };
describe("docs verify command", () => {
  it("exit 0 on a clean repo", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n", docs: { "architecture/stack.md": "x" } });
    const c = cap();
    expect(await run(["docs", "verify", "--block-if-stale"], c.ctx(root))).toBe(0);
  });
  it("exit 1 when blocking on unlinked", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "architecture/nfr.md": "y" } });
    const c = cap();
    expect(await run(["docs", "verify", "--block-if-stale"], c.ctx(root))).toBe(1);
    expect(c.out.join("")).toContain("nfr.md");
  });
  it("without --block-if-stale reports but exits 0", async () => {
    const { root } = await makeRepo({ index: "\n", docs: { "architecture/nfr.md": "y" } });
    const c = cap();
    expect(await run(["docs", "verify"], c.ctx(root))).toBe(0);
  });
  it("--json emits structured result", async () => {
    const { root } = await makeRepo({ index: "\n", docs: { "architecture/nfr.md": "y" } });
    const c = cap();
    await run(["docs", "verify", "--json"], c.ctx(root));
    expect(JSON.parse(c.out.join("")).ok).toBe(false);
  });
});
