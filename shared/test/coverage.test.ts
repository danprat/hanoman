import { describe, it, expect } from "vitest";
import { coverageOf, docStatusFor } from "../src/index";
describe("coverage (shared)", () => {
  it("half linked -> 50", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"b",linked:false}])).toBe(50));
  it("status thresholds", () => {
    expect(docStatusFor(94)).toBe("ok"); expect(docStatusFor(75)).toBe("drift"); expect(docStatusFor(38)).toBe("broken"); });
});
