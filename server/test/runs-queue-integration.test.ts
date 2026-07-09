import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun, makeSetting } from "./factory";
import { prisma } from "../src/db";
import { publisher } from "../src/redis";
import { runsQueue } from "../src/queue";

const app = buildApp();
const pub = publisher();
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1", repoDir: process.cwd() });   // enqueueRun demands an absolute repoDir
  await makeSetting();
  await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
});
afterAll(async () => {
  await runsQueue.obliterate({ force: true });
  await runsQueue.close();
  await pub.quit();
  await app.close();
});

describe("runs SSE via redis", () => {
  it("relays a published event to the SSE stream", async () => {
    const p = app.inject({ method: "GET", url: "/api/runs/RUN-1/log", headers: { accept: "text/event-stream" } });
    // publish after the handler has subscribed; SSE ends after the first live event in test mode.
    setTimeout(() => { void pub.publish("run:RUN-1:events", JSON.stringify({ kind: "log", line: { t: "›", s: "hello-sse" } })); }, 50);
    const res = await p;
    expect(res.payload).toContain("hello-sse");
  });

  it("steer publishes and returns 202", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/steer", payload: { message: "go" } });
    expect(r.statusCode).toBe(202);
  });

  it("start enqueues a run and returns 202", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { project: "p1", flow: "feature", branchTo: "feat/x" } });
    expect(r.statusCode).toBe(202);
    expect(r.json().runId).toMatch(/^RUN-/);
    expect((await prisma.run.findUnique({ where: { id: r.json().runId } }))?.status).toBe("queued");
  });

  // ADR-0012: no spend guardrail. A large prior estimate must not block a new run.
  it("start still returns 202 after a large prior spend", async () => {
    await prisma.run.updateMany({ data: { cost: "~$9999.00" } });
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { project: "p1", flow: "feature", branchTo: "feat/x" } });
    expect(r.statusCode).toBe(202);
  });
});
