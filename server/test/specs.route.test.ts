import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeRepoWithBranches } from "./factory";
const app = buildApp();
const brief = { context: "c", outcome: "o", constraints: "", priority: "sedang" as const };
beforeAll(async () => {
  await resetDb();
  // repo nyata: branch `main` + `dev`. Daftar branch-nya adalah whitelist validasi (SPEC-143).
  await makeProject({ id: "p1", repoDir: makeRepoWithBranches("dev") });
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
      project: "p1", source: "brief", title: "New", priority: "sedang", payload: brief } });
    expect(res.statusCode).toBe(201); expect(res.json().id).toMatch(/^SPEC-\d+$/); expect(res.json().stage).toBe("brainstorming");
  });

  // SPEC-143
  it("stores a valid branchFrom", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
      project: "p1", source: "brief", title: "B", priority: "sedang", branchFrom: "dev", payload: brief } });
    expect(res.statusCode).toBe(201);
    expect(res.json().branchFrom).toBe("dev");
  });
  it("rejects a branch that does not exist in the repo", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
      project: "p1", source: "brief", title: "B", priority: "sedang", branchFrom: "hantu", payload: brief } });
    expect(res.statusCode).toBe(400);
  });
  // Validasi branch memaksa POST memuat baris Project — efek samping yang diinginkan:
  // project tak dikenal jadi 404 jujur, bukan pelanggaran foreign-key.
  it("404s on an unknown project instead of a foreign-key blow-up", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
      project: "hantu", source: "brief", title: "B", priority: "sedang", payload: brief } });
    expect(res.statusCode).toBe(404);
  });
  it("defaults branchFrom to null when omitted (QA source too)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/specs", payload: {
      project: "p1", source: "qa", title: "Q", priority: "tinggi",
      payload: { severity: "major", steps: "s", expected: "e", actual: "a", env: "prod" } } });
    expect(res.statusCode).toBe(201);
    expect(res.json().branchFrom).toBeNull();
  });
  it("PATCH sets the branch", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: "dev" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().branchFrom).toBe("dev");
  });
  it("PATCH with null clears the branch back to the project default", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: null } });
    expect(res.statusCode).toBe(200);
    expect(res.json().branchFrom).toBeNull();
  });
  it("PATCH rejects an unknown branch", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-140", payload: { branchFrom: "hantu" } });
    expect(res.statusCode).toBe(400);
  });
  it("PATCH 404s on an unknown spec", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/specs/SPEC-999", payload: { branchFrom: null } });
    expect(res.statusCode).toBe(404);
  });

  it("deletes a spec", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/specs/SPEC-142" });
    expect(res.statusCode).toBe(204);
  });
});
