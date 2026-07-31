import { describe, it, expect } from "vitest";
import { PIPELINES } from "../src/prompt";
describe("runner wiring", () => {
  it("has a pipeline for every flow", () =>
    // SPEC-407 · +goal (Goal → Verifikasi)
    expect(Object.keys(PIPELINES).sort()).toEqual(["audit", "breakdown", "feature", "goal", "prd", "qa", "reverse", "scaffold"]));
});
