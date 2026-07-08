import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun } from "./factory";
describe("runs SSE", () => {
  beforeAll(async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running", log: [{ t: "$", s: "start" }] as any });
  });
  it("streams event-stream content type and replays log", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/runs/RUN-1/log", headers: { accept: "text/event-stream" } });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.payload).toContain("data:"); // replayed log lines
  });
});
