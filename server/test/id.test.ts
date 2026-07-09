import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDb, makeProject, makeSpec } from "./factory";
import { nextSpecId, nextRunId } from "../src/services/id";
describe("id", () => {
  beforeEach(async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await makeSpec({ id: "SPEC-142", projectId: "p1" });
  });
  afterEach(() => { delete process.env.RUN_ID_FLOOR; });
  it("next spec id is one past the max", async () => expect(await nextSpecId()).toBe("SPEC-143"));
  it("next run id defaults to the 8800 floor", async () => expect(await nextRunId()).toBe("RUN-8801"));
  // Instance prod berbagi repoDir dengan dev tapi punya DB sendiri. Tanpa floor terpisah
  // keduanya mengalokasikan RUN-8801 dan addWorktree yang satu menghapus worktree yang lain.
  it("RUN_ID_FLOOR memberi prod namespace run id sendiri", async () => {
    process.env.RUN_ID_FLOOR = "90000";
    expect(await nextRunId()).toBe("RUN-90001");
  });
  it("RUN_ID_FLOOR yang tak masuk akal jatuh ke default, bukan NaN", async () => {
    process.env.RUN_ID_FLOOR = "abc";
    expect(await nextRunId()).toBe("RUN-8801");
  });
});
