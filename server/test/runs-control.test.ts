import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("run control", () => {
  it("steer is accepted", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/steer", payload: { message: "pakai backoff 30s" } });
    expect(r.statusCode).toBe(202); expect(r.json().accepted).toBe(true);
  });
  it("rejects an invalid control action", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/control", payload: { action: "explode" } });
    expect(r.statusCode).toBe(400);
  });
  it("worktree switch updates branches", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/worktree", payload: { branchTo: "release/v1.0" } });
    expect(r.json().branchTo).toBe("release/v1.0");
  });
  it("command status returns lines", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/command", payload: { text: "status" } });
    expect(Array.isArray(r.json().lines)).toBe(true);
  });
});
