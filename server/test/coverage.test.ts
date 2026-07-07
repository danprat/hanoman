import { describe, it, expect } from "vitest";
import { coverageOf, docStatusFor } from "../src/services/coverage";
describe("coverage", () => {
  it("all linked -> 100", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"b",linked:true}])).toBe(100));
  it("half linked -> 50", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"b",linked:false}])).toBe(50));
  it("counts a category once even with many files", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"a",linked:true},{category:"b",linked:false}])).toBe(50));
  it("empty -> 0", () => expect(coverageOf([])).toBe(0));
  it("status thresholds", () => {
    expect(docStatusFor(94)).toBe("ok"); expect(docStatusFor(75)).toBe("drift"); expect(docStatusFor(38)).toBe("broken"); });
});
