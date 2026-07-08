import { describe, it, expect } from "vitest";
import { STAGES, nextStage } from "../src/services/stage-machine";
describe("stage machine", () => {
  it("orders the six stages", () =>
    expect(STAGES).toEqual(["brainstorming","objective","spec-ready","planned","executing","done"]));
  it("advances brainstorming -> objective", () => expect(nextStage("brainstorming")).toBe("objective"));
  it("returns null at terminal done", () => expect(nextStage("done")).toBeNull());
});
