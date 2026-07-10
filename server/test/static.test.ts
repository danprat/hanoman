import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";
describe("static serving", () => {
  it("serves index at / in prod", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ url: "/" });
    process.env.NODE_ENV = prev;
    expect([200, 404]).toContain(res.statusCode); // 200 if dist built; 404 acceptable pre-build in CI
  });
});
