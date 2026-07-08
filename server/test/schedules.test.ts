import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "./factory";
import * as sch from "../src/schedules";
import { schedulesQueue } from "../src/schedules";
describe("schedules", () => {
  beforeEach(async () => { await resetDb(); });
  it("upserts a scheduler for an enabled schedule trigger", async () => {
    const spy = vi.spyOn(schedulesQueue, "upsertJobScheduler").mockResolvedValue({} as any);
    await sch.syncTrigger({ id: "t1", type: "schedule", detail: "0 2 * * *", enabled: true } as any);
    expect(spy).toHaveBeenCalledWith("t1", { pattern: "0 2 * * *" }, expect.objectContaining({ name: "fire" }));
  });
  it("removes the scheduler when disabled", async () => {
    const spy = vi.spyOn(schedulesQueue, "removeJobScheduler").mockResolvedValue(true as any);
    await sch.syncTrigger({ id: "t2", type: "schedule", detail: "0 2 * * *", enabled: false } as any);
    expect(spy).toHaveBeenCalledWith("t2");
  });
});
