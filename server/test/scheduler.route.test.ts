import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { enqueue } from "../src/services/scheduler/queue";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.schedulerQueueItem.deleteMany(); await prisma.setting.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("scheduler routes", () => {
  it("GET /config returns all-off defaults", async () => {
    const r = await app.inject({ method: "GET", url: "/api/scheduler/config" });
    expect(r.statusCode).toBe(200);
    expect(r.json().enabled).toBe(false);
    expect(r.json().sources.errors.minCount).toBe(5);
  });
  it("PUT /config sets knobs incl. pause, GET reflects them", async () => {
    const body = { enabled: true, paused: true, maxConcurrent: 4, autonomy: "full-control",
      sources: { backlog: { enabled: true, everyMin: 5 }, errors: { enabled: false, everyMin: 15, minCount: 10 }, triase: { enabled: false, everyMin: 30 } } };
    const r = await app.inject({ method: "PUT", url: "/api/scheduler/config", payload: body });
    expect(r.statusCode).toBe(200);
    const g = await app.inject({ method: "GET", url: "/api/scheduler/config" });
    expect(g.json().paused).toBe(true);
    expect(g.json().maxConcurrent).toBe(4);
    expect(g.json().sources.backlog.everyMin).toBe(5);
  });
  it("PUT /config rejects invalid body (maxConcurrent 0)", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/scheduler/config", payload: { maxConcurrent: 0 } });
    expect(r.statusCode).toBe(400);
  });
  it("GET /state exposes cap, queue contents, and per-source next/last-run shape", async () => {
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    const r = await app.inject({ method: "GET", url: "/api/scheduler/state" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.cap).toBe(2);
    expect(b.queue.length).toBe(1);
    expect(b.queue[0].specId).toBe("SPEC-1");
    expect(b.sources.map((s: any) => s.id).sort()).toEqual(["backlog", "errors", "triase"]);
  });
});
