import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeTempRepo } from "./factory";

const app = buildApp({ requireAuth: false });
const P = "internal/docs/product/prd.md";
let dir: string;
beforeEach(async () => {
  await resetDb();
  dir = makeTempRepo({
    "internal/docs/README.md": "- [prd](product/prd.md)",
    "internal/docs/product/prd.md": "# prd",
  });
  await makeProject({ id: "p1", repoDir: dir });
});

describe("docs routes (fs-backed)", () => {
  it("index has coverage + tree", async () => {
    const res = await app.inject({ url: "/api/projects/p1/docs" });
    expect(res.json()).toHaveProperty("coverage");
    expect(Array.isArray(res.json().tree)).toBe(true);
  });
  it("reads a doc", async () => {
    const res = await app.inject({ url: `/api/projects/p1/docs/${P}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("# prd");
  });
  it("edits and persists to disk", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/projects/p1/docs/${P}`, payload: { content: "# changed" } });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ url: `/api/projects/p1/docs/${P}` })).json().content).toBe("# changed");
  });
  it("deletes a doc (204 then 404)", async () => {
    expect((await app.inject({ method: "DELETE", url: `/api/projects/p1/docs/${P}` })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/projects/p1/docs/${P}` })).statusCode).toBe(404);
  });
  it("rejects a non-markdown write (400)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/projects/p1/docs/product/notes.txt", payload: { content: "x" } });
    expect(res.statusCode).toBe(400);
  });
});
