import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../prisma/seed";
import { prisma } from "../src/db";
import { publisher } from "../src/redis";
import { runsQueue } from "../src/queue";

const app = buildApp();
const pub = publisher();
beforeAll(async () => { await seed(); });
afterAll(async () => {
  await runsQueue.obliterate({ force: true });
  await runsQueue.close();
  await pub.quit();
  await app.close();
});

describe("runs SSE via redis", () => {
  it("relays a published event to the SSE stream", async () => {
    const p = app.inject({ method: "GET", url: "/api/runs/RUN-8842/log", headers: { accept: "text/event-stream" } });
    // publish after the handler has subscribed; SSE ends after the first live event in test mode.
    setTimeout(() => { void pub.publish("run:RUN-8842:events", JSON.stringify({ kind: "log", line: { t: "›", s: "hello-sse" } })); }, 50);
    const res = await p;
    expect(res.payload).toContain("hello-sse");
  });

  it("steer publishes and returns 202", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-8842/steer", payload: { message: "go" } });
    expect(r.statusCode).toBe(202);
  });

  it("start enqueues a run and returns 202", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { project: "arta", flow: "feature", branchTo: "feat/x" } });
    expect(r.statusCode).toBe(202);
    expect(r.json().runId).toMatch(/^RUN-/);
    expect((await prisma.run.findUnique({ where: { id: r.json().runId } }))?.status).toBe("queued");
  });

  it("start returns 409 when today's spend >= dailyBudget", async () => {
    const s = await prisma.setting.findUniqueOrThrow({ where: { id: 1 } });
    await prisma.setting.update({ where: { id: 1 }, data: { data: { ...(s.data as any), dailyBudget: 0 } } });
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { project: "arta", flow: "feature", branchTo: "feat/x" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toMatch(/budget/i);
  });
});
