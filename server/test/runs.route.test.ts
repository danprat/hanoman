import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun } from "./factory";
const app = buildApp();
beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
});
describe("runs routes", () => {
  it("lists runs", async () => expect((await app.inject({ url: "/api/runs" })).json().length).toBe(1));
  it("gets a run with phases", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1" });
    expect(res.json().phases.length).toBeGreaterThan(0);
  });
  it("404 for missing run", async () =>
    expect((await app.inject({ url: "/api/runs/RUN-0000" })).statusCode).toBe(404));
  it.each(["steer","control","worktree","command"])("run-%s control path resolves (SPEC-003)", async (a) => {
    // empty body: steer/control/command fail validation (400), worktree is all-optional (200)
    expect((await app.inject({ method: "POST", url: `/api/runs/RUN-1/${a}`, payload: {} })).statusCode).not.toBe(404);
  });
  it("409s deleting a run that is still active", async () =>
    expect((await app.inject({ method: "DELETE", url: "/api/runs/RUN-1" })).statusCode).toBe(409));
  it("deletes a run in a terminal state", async () => {
    await makeRun({ id: "RUN-2", projectId: "p1", status: "done" });
    expect((await app.inject({ method: "DELETE", url: "/api/runs/RUN-2" })).statusCode).toBe(204);
    expect((await app.inject({ url: "/api/runs/RUN-2" })).statusCode).toBe(404);
  });
  it("404s deleting an unknown run", async () =>
    expect((await app.inject({ method: "DELETE", url: "/api/runs/RUN-0000" })).statusCode).toBe(404));

  it("SSE log endpoint streams event-stream (SPEC-003)", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1/log", headers: { accept: "text/event-stream" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
  });
});
