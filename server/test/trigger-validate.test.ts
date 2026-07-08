import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject } from "./factory";
import { schedulesQueue } from "../src/schedules";
const app = buildApp();
beforeAll(async () => { await resetDb(); await makeProject({ id: "p1" }); });
// Creating a valid interval trigger registers a real scheduler in Redis; drop it.
afterAll(async () => { await schedulesQueue.obliterate({ force: true }); await schedulesQueue.close(); });
describe("trigger create validation", () => {
  it("rejects an invalid cron schedule trigger", async () => {
    const r = await app.inject({ method: "POST", url: "/api/triggers", payload: { project: "p1", type: "schedule", detail: "banana", target: "audit" } });
    expect(r.statusCode).toBe(400);
  });
  it("accepts a valid interval trigger", async () => {
    const r = await app.inject({ method: "POST", url: "/api/triggers", payload: { project: "p1", type: "interval", detail: "6h", target: "plan + execute" } });
    expect(r.statusCode).toBe(201);
  });
});
