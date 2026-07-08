import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("runs routes", () => {
  it("lists runs", async () => expect((await app.inject({ url: "/api/runs" })).json().length).toBe(5));
  it("gets a run with phases", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-8842" });
    expect(res.json().phases.length).toBeGreaterThan(0);
  });
  it("404 for missing run", async () =>
    expect((await app.inject({ url: "/api/runs/RUN-0000" })).statusCode).toBe(404));
  it.each(["steer","control","worktree","command"])("run-%s control path resolves (SPEC-003)", async (a) => {
    // empty body: steer/control/command fail validation (400), worktree is all-optional (200)
    expect((await app.inject({ method: "POST", url: `/api/runs/RUN-8842/${a}`, payload: {} })).statusCode).not.toBe(404);
  });
  it("SSE log endpoint streams event-stream (SPEC-003)", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-8842/log", headers: { accept: "text/event-stream" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
  });
});
