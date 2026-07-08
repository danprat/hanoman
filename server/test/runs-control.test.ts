import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun } from "./factory";
const app = buildApp();
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
});
describe("run control", () => {
  it("steer is accepted", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/steer", payload: { message: "pakai backoff 30s" } });
    expect(r.statusCode).toBe(202); expect(r.json().accepted).toBe(true);
  });
  it("rejects an invalid control action", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/control", payload: { action: "explode" } });
    expect(r.statusCode).toBe(400);
  });
  it("worktree switch updates branches", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/worktree", payload: { branchTo: "release/v1.0" } });
    expect(r.json().branchTo).toBe("release/v1.0");
  });
  it("command status returns lines", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/command", payload: { text: "status" } });
    expect(Array.isArray(r.json().lines)).toBe(true);
  });
});
