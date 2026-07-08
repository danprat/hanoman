import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";
describe("app", () => {
  it("health returns ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200); expect(res.json()).toEqual({ ok: true });
  });
  it("unknown run-control route is 404 (no stub)", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/api/runs/RUN-0000/control", payload: { action: "stop" } });
    expect(res.statusCode).toBe(404);
  });
});
