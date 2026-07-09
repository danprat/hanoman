import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeTrigger, makeSetting } from "./factory";
const app = buildApp();
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSetting();
  await makeTrigger({ id: "t1", projectId: "p1", type: "commit", detail: "push → main", enabled: true });
  await makeTrigger({ id: "t2", projectId: "p1", type: "commit", detail: "push → develop", target: "audit", enabled: false });
});
describe("triggers + settings", () => {
  it("lists triggers", async () => expect((await app.inject({ url: "/api/triggers" })).json().length).toBe(2));
  it("creates a trigger", async () => {
    const res = await app.inject({ method: "POST", url: "/api/triggers", payload: {
      project: "p1", type: "commit", detail: "push → main", target: "plan + execute" } });
    expect(res.statusCode).toBe(201); expect(res.json().enabled).toBe(true);
  });
  // Body-less POST dengan json content-type: mereproduksi FST_ERR_CTP_EMPTY_JSON_BODY.
  // Dulu dijaga test POST /scan, yang dihapus bersama endpoint-nya (SPEC-141).
  it("toggles a trigger (body-less POST with json content-type)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/triggers/t2/toggle",
      headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true); // t2 seeded false
  });
  it("deletes a trigger, then 404s", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/triggers/t1" })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/api/triggers/t1" })).statusCode).toBe(404);
  });
  it("gets and updates settings", async () => {
    const got = await app.inject({ url: "/api/settings" }); expect(got.json()).toHaveProperty("steps");
    const put = await app.inject({ method: "PUT", url: "/api/settings",
      payload: { ...(got.json() as Record<string, unknown>), maxConcurrent: 5 } });
    expect(put.json().maxConcurrent).toBe(5);
  });
});
