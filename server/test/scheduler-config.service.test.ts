import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { getScheduler, setScheduler } from "../src/services/scheduler/config";
import { getSetting } from "../src/services/settings";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = () => prisma.setting.deleteMany();
beforeEach(clean); afterAll(clean);

describe("scheduler config service", () => {
  it("returns all-off defaults when no Setting row exists", async () => {
    expect(await getScheduler()).toEqual(SCHEDULER_DEFAULTS);
  });
  it("setScheduler persists without clobbering other Setting fields", async () => {
    const before = await getSetting();
    const next = { ...SCHEDULER_DEFAULTS, enabled: true, maxConcurrent: 3 };
    await setScheduler(next);
    expect((await getScheduler()).enabled).toBe(true);
    expect((await getScheduler()).maxConcurrent).toBe(3);
    const after = await getSetting();
    expect(after.model).toBe(before.model);          // field non-scheduler utuh
    expect(after.notifyDone).toBe(before.notifyDone);
  });
});
