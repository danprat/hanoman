import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject } from "./factory";
const app = buildApp();
beforeAll(async () => { await resetDb(); await makeProject({ id: "p1" }); });
describe("projects routes", () => {
  it("lists project views", async () => {
    const res = await app.inject({ url: "/api/projects" });
    expect(res.statusCode).toBe(200); expect(res.json().length).toBe(1);
    expect(res.json()[0]).toHaveProperty("backlog");
  });
  it("creates a from-scratch project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects",
      payload: { name: "kirana", kind: "from-scratch", desc: "marketplace" } });
    expect(res.statusCode).toBe(201); expect(res.json().id).toBe("kirana");
  });
  it("409s on a duplicate project id (not 500)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects",
      payload: { name: "kirana", kind: "from-scratch", desc: "again" } }); // created above
    expect(res.statusCode).toBe(409);
  });
  it("scan recomputes coverage (body-less POST with json content-type)", async () => {
    // reproduces FST_ERR_CTP_EMPTY_JSON_BODY: json content-type but no body
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/scan",
      headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200); expect(typeof res.json().coverage).toBe("number");
  });
  it("rejects invalid create body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { kind: "x" } });
    expect(res.statusCode).toBe(400);
  });
});
