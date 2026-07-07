import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db";
import { seed } from "../prisma/seed";
import { docIndex, readDoc, writeDoc } from "../src/services/docs";
describe("docs service", () => {
  beforeAll(async () => { await seed(); });
  it("builds a tree grouped by category with coverage", async () => {
    const ix = await docIndex("loka-pos");
    expect(ix.tree.length).toBeGreaterThan(0);
    expect(ix.coverage).toBeGreaterThanOrEqual(0);
  });
  it("reads a seeded doc", async () => {
    const first = (await docIndex("loka-pos")).tree[0]!;
    const path = `${first.cat}/${first.files[0]}`;
    expect(typeof await readDoc("loka-pos", path)).toBe("string");
  });
  it("writes then reads back an edit", async () => {
    const first = (await docIndex("loka-pos")).tree[0]!;
    const path = `${first.cat}/${first.files[0]}`;
    await writeDoc("loka-pos", path, "# edited\nbody");
    expect(await readDoc("loka-pos", path)).toBe("# edited\nbody");
  });
  it("returns null for missing doc", async () => expect(await readDoc("loka-pos","nope/x.md")).toBeNull());
});
