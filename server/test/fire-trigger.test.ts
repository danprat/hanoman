import { describe, it, expect, beforeAll, vi } from "vitest";
import { seed } from "../prisma/seed";
import { fireTrigger } from "../src/fire-trigger";
import * as queue from "../src/queue";
describe("fireTrigger", () => {
  beforeAll(async () => { await seed(); });
  it("plan+execute enqueues one feature run per ready spec", async () => {
    const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    // arta has SPEC-142 (planned) + SPEC-138 (executing); ready = planned -> 1 run
    const r = await fireTrigger({ id: "t1", projectId: "arta", type: "commit", detail: "push → main", target: "plan + execute", enabled: true } as any);
    expect(spy).toHaveBeenCalledTimes(r.enqueued.length);
    expect(r.enqueued.length).toBeGreaterThanOrEqual(1);
  });
  it("scaffold docs enqueues exactly one project-level run", async () => {
    const spy = vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    await fireTrigger({ id: "t3", projectId: "sembada", type: "manual", detail: "on demand", target: "scaffold docs", enabled: true } as any);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("skips when no ready specs", async () => {
    vi.spyOn(queue, "enqueueRun").mockResolvedValue({ enqueued: true });
    const r = await fireTrigger({ id: "tz", projectId: "gapura", type: "schedule", detail: "0 2 * * *", target: "plan + execute", enabled: true } as any);
    expect(r.skipped).toBeDefined();
  });
});
