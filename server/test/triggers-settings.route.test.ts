import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("triggers + settings", () => {
  it("lists triggers", async () => expect((await app.inject({ url: "/api/triggers" })).json().length).toBe(6));
  it("creates a trigger", async () => {
    const res = await app.inject({ method: "POST", url: "/api/triggers", payload: {
      project: "arta", type: "commit", detail: "push → main", target: "plan + execute" } });
    expect(res.statusCode).toBe(201); expect(res.json().enabled).toBe(true);
  });
  it("toggles a trigger", async () => {
    const res = await app.inject({ method: "POST", url: "/api/triggers/t4/toggle" });
    expect(res.json().enabled).toBe(true); // t4 seeded false
  });
  it("gets and updates settings", async () => {
    const got = await app.inject({ url: "/api/settings" }); expect(got.json()).toHaveProperty("steps");
    const put = await app.inject({ method: "PUT", url: "/api/settings",
      payload: { ...(got.json() as Record<string, unknown>), maxConcurrent: 5 } });
    expect(put.json().maxConcurrent).toBe(5);
  });
});
