import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeDocFile } from "./factory";
const app = buildApp();
const samplePath = "product/prd.md";
beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeDocFile({ projectId: "p1", path: samplePath, category: "product", content: "# prd" });
});
describe("docs routes", () => {
  it("returns index with coverage + tree", async () => {
    const res = await app.inject({ url: "/api/projects/p1/docs" });
    expect(res.json()).toHaveProperty("coverage"); expect(Array.isArray(res.json().tree)).toBe(true);
  });
  it("reads a doc", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${samplePath}` });
    expect(res.statusCode).toBe(200); expect(typeof res.json().content).toBe("string");
  });
  it("edits and persists a doc", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/projects/p1/docs/${samplePath}`,
      payload: { content: "# changed" } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ url: `/api/projects/p1/docs/${samplePath}` });
    expect(get.json().content).toBe("# changed");
  });
  it("404 for missing doc", async () =>
    expect((await app.inject({ url: "/api/projects/p1/docs/nope/x.md" })).statusCode).toBe(404));
});
