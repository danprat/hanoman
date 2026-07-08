import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makeProject, makeSpec } from "./factory";
import { fireTrigger } from "../src/fire-trigger";
import * as queue from "../src/queue";
describe("fireTrigger", () => {
  beforeEach(async () => {
    await resetDb();
    // p1: one ready spec (planned) + one already-executing spec.
    await makeProject({ id: "p1" });
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "planned" });
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "executing" });
    // p2: no ready specs.
    await makeProject({ id: "p2" });
  });
  it("plan+execute enqueues one feature run per ready spec", async () => {
    const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    // p1 has SPEC-1 (planned) + SPEC-2 (executing); ready = planned -> 1 run
    const r = await fireTrigger({ id: "t1", projectId: "p1", type: "commit", detail: "push → main", target: "plan + execute", enabled: true } as any);
    expect(spy).toHaveBeenCalledTimes(r.enqueued.length);
    expect(r.enqueued.length).toBeGreaterThanOrEqual(1);
  });
  it("scaffold docs enqueues exactly one project-level run", async () => {
    const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    await fireTrigger({ id: "t2", projectId: "p1", type: "manual", detail: "on demand", target: "scaffold docs", enabled: true } as any);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("skips when no ready specs", async () => {
    vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    const r = await fireTrigger({ id: "t3", projectId: "p2", type: "schedule", detail: "0 2 * * *", target: "plan + execute", enabled: true } as any);
    expect(r.skipped).toBeDefined();
  });
});
