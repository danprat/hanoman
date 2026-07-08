import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
describe("runs SSE", () => {
  beforeAll(async () => { await seed(); });
  it("streams event-stream content type and replays log", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/runs/RUN-8842/log", headers: { accept: "text/event-stream" } });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.payload).toContain("data:"); // replayed seed log lines
  });
});
