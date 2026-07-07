import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
const app = buildApp();
beforeAll(async () => { await seed(); });
describe("projects routes", () => {
  it("lists project views", async () => {
    const res = await app.inject({ url: "/api/projects" });
    expect(res.statusCode).toBe(200); expect(res.json().length).toBe(6);
    expect(res.json()[0]).toHaveProperty("backlog");
  });
  it("creates a from-scratch project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects",
      payload: { name: "kirana", kind: "from-scratch", desc: "marketplace" } });
    expect(res.statusCode).toBe(201); expect(res.json().id).toBe("kirana");
  });
  it("scan recomputes coverage", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/loka-pos/scan" });
    expect(res.statusCode).toBe(200); expect(typeof res.json().coverage).toBe("number");
  });
  it("rejects invalid create body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { kind: "x" } });
    expect(res.statusCode).toBe(400);
  });
});
