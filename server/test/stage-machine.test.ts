import { describe, it, expect } from "vitest";
import { STAGES, nextStage, advance } from "../src/services/stage-machine";
describe("stage machine", () => {
  it("orders the six stages", () =>
    expect(STAGES).toEqual(["brainstorming","objective","spec-ready","planned","executing","done"]));
  it("advances brainstorming -> objective", () => expect(nextStage("brainstorming")).toBe("objective"));
  it("advances planned -> executing", () => expect(advance("planned")?.stage).toBe("executing"));
  it("returns null at terminal done", () => expect(nextStage("done")).toBeNull());
  it("done transition carries the sync toast", () =>
    expect(advance("executing")?.toastEvent).toBe("selesai — docs tersinkron"));
});
