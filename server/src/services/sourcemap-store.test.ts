import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db";
import { saveSourceMap, findSourceMap, pruneReleases, basenameOf } from "./sourcemap-store";

const P = "smtest-proj";
beforeAll(async () => {
  await prisma.project.upsert({
    where: { id: P }, update: {},
    create: { id: P, name: "sm", desc: "", kind: "app" },
  });
});
afterAll(async () => { await prisma.project.delete({ where: { id: P } }).catch(() => {}); });

describe("basenameOf", () => {
  it("strips path + query + fragment", () => {
    expect(basenameOf("https://h/assets/index-4f3a2b.js?v=1#x")).toBe("index-4f3a2b.js");
    expect(basenameOf("/Users/x/app/dist/a.js")).toBe("a.js");
  });
});

describe("save/find roundtrip", () => {
  it("finds map by basename of frame filename", async () => {
    await saveSourceMap(P, "1.0.0", "index-4f3a2b.js", '{"version":3}');
    const got = await findSourceMap(P, "1.0.0", "https://cdn/assets/index-4f3a2b.js?v=9");
    expect(got).toBe('{"version":3}');
    expect(await findSourceMap(P, "1.0.0", "nope.js")).toBeNull();
    expect(await findSourceMap(P, "2.0.0", "index-4f3a2b.js")).toBeNull();
  });
  it("upsert replaces map bytes for same (project,release,filename)", async () => {
    await saveSourceMap(P, "up", "a.js", "{\"v\":1}");
    await saveSourceMap(P, "up", "a.js", "{\"v\":2}");
    expect(await findSourceMap(P, "up", "a.js")).toBe("{\"v\":2}");
    const rows = await prisma.sourceMapArtifact.findMany({ where: { projectId: P, release: "up", filename: "a.js" } });
    expect(rows.length).toBe(1);
  });
});

describe("retention", () => {
  it("keeps only N newest releases", async () => {
    for (const r of ["r1", "r2", "r3"]) await saveSourceMap(P, r, "b.js", "{}");
    await pruneReleases(P, 2);
    const rows = await prisma.sourceMapArtifact.findMany({ where: { projectId: P, filename: "b.js" } });
    const rels = new Set(rows.map((x) => x.release));
    expect(rels.has("r1")).toBe(false);
    expect(rels.size).toBe(2);
  });
});
