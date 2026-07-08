import { describe, it, expect } from "vitest";
import { run } from "../src/router";
import { makeRepo } from "./_fixture";
describe("docs scan", () => {
  it("reports coverage + categories as json", async () => {
    const { root } = await makeRepo({ index: "- [s](architecture/stack.md)\n",
      docs: { "architecture/stack.md": "x", "product/blueprint.md": "y" } });
    const out: string[] = [];
    const code = await run(["docs", "scan", "--json"], { cwd: root, env: {}, stdout: (s) => out.push(s), stderr: () => {} });
    const j = JSON.parse(out.join(""));
    expect(code).toBe(0); expect(typeof j.coverage).toBe("number");
    expect(j.categories.find((c: any) => c.category === "product").linked).toBe(false);
  });
});
