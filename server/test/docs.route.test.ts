import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

// SPEC-210 · endpoint PRD (freshest-wins). `dir` di-seed di beforeEach di atas.
describe("prds routes", () => {
  it("list + baca PRD dari repoDir", async () => {
    mkdirSync(join(dir, "docs/prd"), { recursive: true });
    writeFileSync(join(dir, "docs/prd/x.md"), "# PRD X\n\nisi");
    const list = await app.inject({ url: "/api/projects/p1/prds" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((i: { slug: string }) => i.slug)).toContain("x");
    const read = await app.inject({ url: "/api/projects/p1/prds/docs/prd/x.md" });
    expect(read.statusCode).toBe(200);
    expect(read.json().content).toContain("PRD X");
  });
  it("404 untuk path bukan docs/prd", async () => {
    const res = await app.inject({ url: "/api/projects/p1/prds/internal/docs/README.md" });
    expect(res.statusCode).toBe(404);
  });
});
