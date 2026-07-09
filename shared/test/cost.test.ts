import { describe, it, expect } from "vitest";
import { fmtEstCost, parseEstCost } from "../src/cost";

describe("estimated cost", () => {
  it("formats as an estimate, never a bare invoice figure", () => {
    expect(fmtEstCost(0)).toBe("~$0.00");
    expect(fmtEstCost(0.0266974)).toBe("~$0.03");
  });
  it("round-trips through the budget parser", () => {
    expect(parseEstCost(fmtEstCost(12.345))).toBeCloseTo(12.35, 2);
  });
  // Rows written before the "~" prefix must still total correctly on the Overview tile.
  it("still parses legacy '$n' rows and junk", () => {
    expect(parseEstCost("$1.50")).toBe(1.5);
    expect(parseEstCost("—")).toBe(0);
    expect(parseEstCost(undefined)).toBe(0);
  });
});
