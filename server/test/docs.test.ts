import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makeProject, makeDocFile } from "./factory";
import { docIndex, readDoc, writeDoc } from "../src/services/docs";
describe("docs service", () => {
  beforeEach(async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await makeDocFile({ projectId: "p1", path: "product/prd.md", category: "product", content: "# prd" });
  });
  it("builds a tree grouped by category with coverage", async () => {
    const ix = await docIndex("p1");
    expect(ix.tree.length).toBeGreaterThan(0);
    expect(ix.coverage).toBeGreaterThanOrEqual(0);
  });
  it("reads a seeded doc", async () => {
    const first = (await docIndex("p1")).tree[0]!;
    const path = `${first.cat}/${first.files[0]}`;
    expect(typeof await readDoc("p1", path)).toBe("string");
  });
  it("writes then reads back an edit", async () => {
    const first = (await docIndex("p1")).tree[0]!;
    const path = `${first.cat}/${first.files[0]}`;
    await writeDoc("p1", path, "# edited\nbody");
    expect(await readDoc("p1", path)).toBe("# edited\nbody");
  });
  it("returns null for missing doc", async () => expect(await readDoc("p1","nope/x.md")).toBeNull());
});
