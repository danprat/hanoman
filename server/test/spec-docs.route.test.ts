import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeTempRepo } from "./factory";

const app = buildApp();
const repo = makeTempRepo({
  "internal/docs/operations/spec-170-x-audit.md": "# audit\n\nbody",
  "docs/superpowers/specs/2026-07-11-x-spec-170-design.md": "# design",
  "docs/superpowers/plans/2026-07-11-x-spec-170.md": "# plan",
  "internal/docs/README.md": "root",
});
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1", repoDir: repo });
  await makeSpec({ id: "SPEC-170", projectId: "p1", stage: "done" });
  await makeSpec({ id: "SPEC-171", projectId: "p1", stage: "brainstorming" });
});

describe("GET /specs/:id/docs", () => {
  it("lists the item's docs by kind", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-170/docs" });
    expect(res.statusCode).toBe(200);
    expect(res.json().files.map((f: any) => f.kind)).toEqual(["audit", "spec", "plan"]);
  });
  it("returns file content", async () => {
    const res = await app.inject({
      url: "/api/specs/SPEC-170/docs/internal/docs/operations/spec-170-x-audit.md" });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain("# audit");
  });
  it("404 for a non-md / traversal path", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-170/docs/notes.txt" });
    expect(res.statusCode).toBe(404);
  });
  it("empty list for a spec with no docs", async () => {
    const res = await app.inject({ url: "/api/specs/SPEC-171/docs" });
    expect(res.json().files).toEqual([]);
  });
});
