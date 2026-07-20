import { describe, it, expect } from "vitest";
import { branchOptions, prdBranchOf } from "../src/screens/branch";

describe("prdBranchOf (SPEC-244)", () => {
  it("menurunkan branch prd/<slug> dari path dokumen PRD", () => {
    expect(prdBranchOf("docs/prd/funnel-v2.md")).toBe("prd/funnel-v2");
  });
});

describe("branchOptions remote label (SPEC-244)", () => {
  it("menandai branch yang hanya ada di origin dengan · origin", () => {
    const opts = branchOptions(["main", "prd/x"], new Set(["prd/x"]));
    expect(opts.find((o) => o.value === "prd/x")?.label).toBe("prd/x · origin");
    expect(opts.find((o) => o.value === "main")?.label).toBe("main");
  });
});
