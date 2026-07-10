import { describe, it, expect } from "vitest";
import { PIPELINES } from "../src/prompt";
describe("runner wiring", () => {
  it("has a pipeline for every flow", () =>
    expect(Object.keys(PIPELINES).sort()).toEqual(["feature", "qa", "reverse", "scaffold"]));
});
