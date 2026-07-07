import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
let samplePath = "";
beforeAll(async () => { await seed();
  const ix = (await app.inject({ url: "/api/projects/loka-pos/docs" })).json();
  samplePath = `${ix.tree[0].cat}/${ix.tree[0].files[0]}`;
});
describe("docs routes", () => {
  it("returns index with coverage + tree", async () => {
    const res = await app.inject({ url: "/api/projects/loka-pos/docs" });
    expect(res.json()).toHaveProperty("coverage"); expect(Array.isArray(res.json().tree)).toBe(true);
  });
  it("reads a doc", async () => {
    const res = await app.inject({ url: `/api/projects/loka-pos/docs/${samplePath}` });
    expect(res.statusCode).toBe(200); expect(typeof res.json().content).toBe("string");
  });
  it("edits and persists a doc", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/projects/loka-pos/docs/${samplePath}`,
      payload: { content: "# changed" } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ url: `/api/projects/loka-pos/docs/${samplePath}` });
    expect(get.json().content).toBe("# changed");
  });
  it("404 for missing doc", async () =>
    expect((await app.inject({ url: "/api/projects/loka-pos/docs/nope/x.md" })).statusCode).toBe(404));
});
