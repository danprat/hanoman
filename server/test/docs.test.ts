import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makeProject, makeTempRepo } from "./factory";
import { docIndex, readDoc, writeDoc, deleteDoc } from "../src/services/docs";

let dir: string;
beforeEach(async () => {
  await resetDb();
  dir = makeTempRepo({
    "internal/docs/README.md": "- [prd](product/prd.md)",
    "internal/docs/product/prd.md": "# prd",
  });
  await makeProject({ id: "p1", repoDir: dir });
});

describe("docs service (fs-backed)", () => {
  it("builds tree + coverage from disk", async () => {
    const ix = await docIndex("p1");
    expect(ix.tree.length).toBeGreaterThan(0);
    expect(ix.coverage).toBe(100); // both dirs reachable from index
  });
  it("reads a real doc", async () =>
    expect(await readDoc("p1", "internal/docs/product/prd.md")).toBe("# prd"));
  it("writes then reads back", async () => {
    await writeDoc("p1", "internal/docs/product/prd.md", "# edited");
    expect(await readDoc("p1", "internal/docs/product/prd.md")).toBe("# edited");
  });
  it("deletes a doc", async () => {
    expect(await deleteDoc("p1", "internal/docs/product/prd.md")).toBe(true);
    expect(await readDoc("p1", "internal/docs/product/prd.md")).toBeNull();
  });
  it("null for a missing doc", async () =>
    expect(await readDoc("p1", "internal/docs/nope.md")).toBeNull());
});
