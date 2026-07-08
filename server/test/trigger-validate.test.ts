import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("trigger create validation", () => {
  it("rejects an invalid cron schedule trigger", async () => {
    const r = await app.inject({ method: "POST", url: "/api/triggers", payload: { project: "arta", type: "schedule", detail: "banana", target: "audit" } });
    expect(r.statusCode).toBe(400);
  });
  it("accepts a valid interval trigger", async () => {
    const r = await app.inject({ method: "POST", url: "/api/triggers", payload: { project: "arta", type: "interval", detail: "6h", target: "plan + execute" } });
    expect(r.statusCode).toBe(201);
  });
});
