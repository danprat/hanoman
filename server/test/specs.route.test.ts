import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec } from "./factory";
const app = buildApp();
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-140", projectId: "p1", stage: "brainstorming" });
  await makeSpec({ id: "SPEC-137", projectId: "p1", stage: "done" });
  await makeSpec({ id: "SPEC-142", projectId: "p1", stage: "planned" });
});
describe("specs routes", () => {
  it("filters by project", async () => {
    const res = await app.inject({ url: "/api/specs?project=p1" });
    expect(res.json().every((s: any) => s.projectId === "p1")).toBe(true);
  });
  it("creates a brief spec with next id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
      project: "p1", source: "brief", title: "New", priority: "sedang",
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } } });
    expect(res.statusCode).toBe(201); expect(res.json().id).toMatch(/^SPEC-\d+$/); expect(res.json().stage).toBe("brainstorming");
  });
  it("advances a spec", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-140/advance" });
    expect(res.json().stage).toBe("objective");
  });
  it("409 advancing a done spec", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-137/advance" });
    expect(res.statusCode).toBe(409);
  });
  it("deletes a spec", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/specs/SPEC-142" });
    expect(res.statusCode).toBe(204);
  });
});
